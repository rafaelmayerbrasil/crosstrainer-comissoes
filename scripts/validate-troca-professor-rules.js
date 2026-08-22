'use strict';
// Valida a regra nova de `substitutions` (Task 3, 21/08/2026): fecha o furo em
// que qualquer um dos dois professores da troca escrevia `status: 'accepted'`
// direto pelo console do navegador e homologava a própria troca — disparando
// a CF `processSubstitutionAcceptance` e movendo a aula (e a hora paga) sem a
// gestão nunca ter visto o pedido. Agora só admin/supervisão escrevem
// 'accepted', e o create só nasce em 'pending'.
//
// + um segundo furo achado em revisão adversarial no mesmo dia: a regra
// restringia o STATUS que o professor podia escrever, mas não OS CAMPOS. Um
// professor que é parte do pedido podia reescrever `substituteTeacherId`/
// `substituteUserId` pra si mesmo, deixar `status: 'pending'` intocado (toda
// condição continuava batendo) e esperar — a gestão homologava um pedido de
// cara normal e a CF movia a aula pra quem reescreveu o campo, sem nunca
// passar por 'accepted' forjado. Mesma lógica valia pra `classId` (repontar
// pra outra aula) e pros campos de auditoria da homologação
// (`homologadoPor`/`semConfirmacaoDoProfessor`/`atorEhParte`). Fechado com
// `diff().affectedKeys().hasOnly([...])` restringindo o professor a
// status/respondedAt/responseNote/updatedAt/updatedBy — exatamente o que
// `SubstitutionService._mover` escreve nos três caminhos que um professor
// aciona (confirmar/recusar/cancelar).
//
// Via REST (não Admin SDK, que ignora as regras). Contas de demo do staging.
// Modelado em scripts/validate-substituicao-rules.js.
//
// ⚠️ NÃO RODAR AINDA: firestore.rules com a regra nova ainda não foi
// deployado em staging (isso é tarefa de uma etapa futura, depois da
// homologação). Rodando agora, staging ainda está com a regra antiga —
// os testes de "deny" falhariam pelo motivo errado (rule velha permite).
// Só rodar depois de `firebase deploy --only firestore:rules --project
// staging` com esta regra.
//
// Roda: node scripts/validate-troca-professor-rules.js
const admin = require('firebase-admin');

const API_KEY = 'AIzaSyC5wqYNNyrJBPXbBPK8gRxQxOPHTIW7TFo'; // staging
const PID = 'crosstrainer-comissoes-staging';
const BASE = `https://firestore.googleapis.com/v1/projects/${PID}/databases/(default)/documents`;
const ADMIN = { email: 'dono.teste@crosstainer.com', password: 'crosstainer2026' };
const PROF  = { email: 'professor.teste@crosstainer.com', password: 'crosstainer2026' };

async function signIn(c) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...c, returnSecureToken: true }) });
  const j = await r.json();
  if (!j.idToken) throw new Error('login falhou p/ ' + c.email + ': ' + JSON.stringify(j));
  return { token: j.idToken, uid: j.localId };
}
const H = (t) => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });

// PATCH com updateMask pra mexer só no status (é o que os métodos de
// SubstitutionService fazem — confirmar/homologar/recusar/cancelar).
async function patchStatus(id, status, token) {
  const url = `${BASE}/substitutions/${id}?updateMask.fieldPaths=status`;
  const r = await fetch(url, { method: 'PATCH', headers: H(token),
    body: JSON.stringify({ fields: { status: { stringValue: status } } }) });
  return r.status;
}
async function createViaRest(id, fields, token) {
  const r = await fetch(`${BASE}/substitutions?documentId=${id}`, {
    method: 'POST', headers: H(token), body: JSON.stringify({ fields }) });
  return r.status;
}
// PATCH genérico com updateMask cobrindo vários campos de uma vez — pra testar
// o allow-list (hasOnly) do bloco de update, não só o status isolado.
async function patchFields(id, fieldPaths, fields, token) {
  const mask = fieldPaths.map((p) => `updateMask.fieldPaths=${p}`).join('&');
  const url = `${BASE}/substitutions/${id}?${mask}`;
  const r = await fetch(url, { method: 'PATCH', headers: H(token), body: JSON.stringify({ fields }) });
  return r.status;
}
async function del(id, token) {
  const r = await fetch(`${BASE}/substitutions/${id}`, { method: 'DELETE', headers: H(token) });
  return r.status;
}

let pass = 0, fail = 0;
const check = (label, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${label} (HTTP ${got})`); }
  else { fail++; console.log(`  ✗ ${label} — INESPERADO HTTP ${got}`); }
};

(async () => {
  admin.initializeApp({
    credential: admin.credential.cert(require('./serviceAccount-staging.json')),
    projectId: PID,
  });
  const db = admin.firestore();

  const adm = await signIn(ADMIN);
  const prof = await signIn(PROF);
  console.log(`uid do professor de teste: ${prof.uid}\n`);

  // O outro lado da troca não precisa ser um login real: nenhum teste faz
  // signIn como substituto, só o professor (parte) e o admin (gestão) — a
  // regra olha requestingUserId/substituteUserId como strings, não valida
  // que existe uma conta por trás.
  const FAKE_SUB = '__rt_troca_fake_substituto';
  const FAKE_A = '__rt_troca_fake_parte_a';
  const FAKE_B = '__rt_troca_fake_parte_b';

  const base = (status, requestingUserId, substituteUserId) => ({
    classId: '__rt_troca_class',
    requestingTeacherId: '__rt_troca_prof_a',
    requestingUserId,
    substituteTeacherId: '__rt_troca_prof_b',
    substituteUserId,
    registradoPor: 'titular',
    status,
    reason: '[teste rules — validate-troca-professor-rules]',
    isOfficial: false,
    wasRetroactive: false,
  });

  // docA: professor confirma o próprio pedido (pending → aguardando_gestao)
  // docB: professor tenta pular direto pra accepted (pending → accepted)
  // docC: já confirmado, professor tenta homologar (aguardando_gestao → accepted)
  // docD: já confirmado, ADMIN homologa (aguardando_gestao → accepted)
  // docE: professor não é nenhuma das duas partes do pedido
  // docF: professor reescreve substituteTeacherId pra si mesmo, status intocado
  //       (o segundo furo: homologa sem nunca escrever 'accepted')
  // docG: professor confirma mexendo em status + responseNote juntos (caminho
  //       legítimo — prova que o allow-list não quebrou o SubstitutionService)
  // docH: DECISIVO — mimetiza o after{} exato que _mover manda no 'confirmar'
  //       (status, isOfficial, updatedAt, updatedBy, respondedAt), reenviando
  //       isOfficial com o MESMO valor que o doc já tem (false). Prova que
  //       affectedKeys() é por valor, não por presença no payload — é a razão
  //       de isOfficial poder ficar fora do hasOnly da regra. Se isto der 403,
  //       affectedKeys() não é por valor como a doc do Firebase diz, e a regra
  //       precisa acrescentar 'isOfficial' no hasOnly.
  // docI: gêmeo negativo — mesmo isOfficial no PATCH, mas mudando de valor
  //       (true). Sem isto, docH sozinho não distingue "reenviar sem mudar
  //       passa" de "o campo não é vigiado": se docI também desse 200, o
  //       campo estaria livre pra qualquer valor, não só o que já tinha.
  const docA = await db.collection('substitutions').add(base('pending', prof.uid, FAKE_SUB));
  const docB = await db.collection('substitutions').add(base('pending', prof.uid, FAKE_SUB));
  const docC = await db.collection('substitutions').add(base('aguardando_gestao', prof.uid, FAKE_SUB));
  const docD = await db.collection('substitutions').add(base('aguardando_gestao', prof.uid, FAKE_SUB));
  const docE = await db.collection('substitutions').add(base('pending', FAKE_A, FAKE_B));
  const docF = await db.collection('substitutions').add(base('pending', prof.uid, FAKE_SUB));
  const docG = await db.collection('substitutions').add(base('pending', prof.uid, FAKE_SUB));
  const docH = await db.collection('substitutions').add(base('pending', prof.uid, FAKE_SUB));
  const docI = await db.collection('substitutions').add(base('pending', prof.uid, FAKE_SUB));

  const criadosPeloTeste = [docA.id, docB.id, docC.id, docD.id, docE.id, docF.id, docG.id, docH.id, docI.id];

  try {
    let s;

    s = await patchStatus(docA.id, 'aguardando_gestao', prof.token);
    check('professor confirma o próprio pedido: pending → aguardando_gestao (allow)', s === 200, s);

    s = await patchStatus(docB.id, 'accepted', prof.token);
    check('professor NÃO homologa direto: pending → accepted (deny — o furo fechado)', s === 403, s);

    s = await patchStatus(docC.id, 'accepted', prof.token);
    check('professor NÃO homologa mesmo já confirmado: aguardando_gestao → accepted (deny)', s === 403, s);

    s = await patchStatus(docD.id, 'accepted', adm.token);
    check('admin homologa: aguardando_gestao → accepted (allow)', s === 200, s);

    s = await patchStatus(docE.id, 'aguardando_gestao', prof.token);
    check('professor que não é parte do pedido não mexe nele (deny)', s === 403, s);

    s = await patchFields(docF.id, ['substituteTeacherId'],
      { substituteTeacherId: { stringValue: prof.uid } }, prof.token);
    check('professor NÃO reescreve substituteTeacherId pra si (deny — o 2º furo, homologa sem nunca escrever accepted)',
      s === 403, s);

    s = await patchFields(docG.id, ['status', 'responseNote'], {
      status: { stringValue: 'aguardando_gestao' },
      responseNote: { stringValue: 'nota de teste' },
    }, prof.token);
    check('professor confirma mexendo em status + responseNote juntos (allow — o allow-list não quebrou o caminho legítimo)',
      s === 200, s);

    // DECISIVO: reenvia isOfficial:false (valor que o doc já tem) junto do
    // resto do after{} que _mover.confirmar realmente escreve. Se isto virar
    // 403 algum dia, é porque affectedKeys() deixou de ser por valor — e a
    // regra precisa passar a listar 'isOfficial' no hasOnly.
    s = await patchFields(docH.id, ['status', 'isOfficial', 'updatedAt', 'updatedBy', 'respondedAt'], {
      status: { stringValue: 'aguardando_gestao' },
      isOfficial: { booleanValue: false },
      updatedAt: { timestampValue: new Date().toISOString() },
      updatedBy: { stringValue: prof.uid },
      respondedAt: { timestampValue: new Date().toISOString() },
    }, prof.token);
    check('professor reenvia isOfficial:false (igual ao doc) junto do after{} real do confirmar (allow — reenviado sem mudar não conta como alteração)',
      s === 200, s);

    // Gêmeo negativo do teste acima: mesmos campos, mas isOfficial MUDA de
    // valor (true). Sem este, o teste decisivo sozinho não provaria que o
    // campo é vigiado — só que reenviar o valor igual passa.
    s = await patchFields(docI.id, ['status', 'isOfficial'], {
      status: { stringValue: 'aguardando_gestao' },
      isOfficial: { booleanValue: true },
    }, prof.token);
    check('professor NÃO muda isOfficial pra true (deny — aqui sim o campo está sendo alterado de verdade)',
      s === 403, s);

    const novoId = '__rt_troca_create_accepted';
    s = await createViaRest(novoId, {
      classId: { stringValue: '__rt_troca_class' },
      requestingTeacherId: { stringValue: '__rt_troca_prof_a' },
      requestingUserId: { stringValue: prof.uid },
      substituteTeacherId: { stringValue: '__rt_troca_prof_b' },
      substituteUserId: { stringValue: FAKE_SUB },
      registradoPor: { stringValue: 'titular' },
      status: { stringValue: 'accepted' },
    }, prof.token);
    check('professor não cria pedido já nascendo accepted (deny — forjaria homologação)', s === 403, s);
    if (s === 200) criadosPeloTeste.push(novoId); // não deveria acontecer, mas limpa se acontecer

    s = await del(docA.id, prof.token);
    check('professor não apaga pedido (deny — allow delete: if false)', s === 403, s);

    s = await del(docD.id, adm.token);
    check('admin também não apaga pedido (deny — sem exceção nem pra gestão)', s === 403, s);
  } finally {
    for (const id of criadosPeloTeste) await db.collection('substitutions').doc(id).delete();
    const sobrou = (await db.collection('substitutions').where('classId', '==', '__rt_troca_class').get()).size;
    check(`cleanup completo (sobrou ${sobrou})`, sobrou === 0, sobrou);
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('\n💥', e.message || e); process.exit(1); });
