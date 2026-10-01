'use strict';
// Valida, contra o Firestore de verdade do STAGING, as regras de `hour_declarations`
// ("Minhas horas do mês").
//
// O que precisa ser verdade:
//   · o professor grava e lê SÓ a própria declaração;
//   · ele nunca consegue se dar por validado — validar é o que ajusta as aulas
//     e, com elas, a folha. Sem essa trava bastaria o console do navegador
//     para alguém aprovar as próprias horas;
//   · depois de validada (ou fechada valendo a agenda), ele não mexe mais;
//   · a gestão faz tudo; ninguém apaga.
//
// Autentica por token temporário gerado pelo Admin SDK — sem senha no arquivo.
// Roda (depois de publicar as regras no staging):
//   node scripts/validar-regras-horas-do-mes.js
const admin = require('firebase-admin');

const API_KEY = 'AIzaSyC5wqYNNyrJBPXbBPK8gRxQxOPHTIW7TFo'; // staging (chave pública por natureza)
const PID = 'crosstrainer-comissoes-staging';
const RAIZ = `https://firestore.googleapis.com/v1/projects/${PID}/databases/(default)/documents`;
const COL = 'hour_declarations';

const UID_ADMIN = 'syZANHXh6MO1xw4UXpxGVTyFDcp1';   // dono.teste@
const UID_PROF  = 'MLjF8pMsSEeZkE2m8BvjwdR5RDF2';   // professor.teste@ (Marcos)
const MEU   = 'PhpOUDSxQzhFvn4WnXNB';               // ficha do Marcos
const OUTRO = 'o5soxgeWy1l0dintKzM2';               // ficha da Bruna
const MES = '2099-01';                              // mês que não existe: não encosta em dado de teste de ninguém
const ID_MEU = `${MEU}_${MES}`, ID_OUTRO = `${OUTRO}_${MES}`, ID_VALIDADA = `${MEU}_2099-02`;

admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-staging.json')) });
const db = admin.firestore();

let passou = 0, falhou = 0;
function checa(nome, real, esperado) {
  if (real === esperado) { passou++; console.log(`  ✓ ${nome} (HTTP ${real})`); }
  else { falhou++; console.log(`  ✗ ${nome} — esperava ${esperado}, veio ${real}`); }
}

async function tokenDe(uid) {
  const custom = await admin.auth().createCustomToken(uid);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }) });
  const j = await r.json();
  if (!j.idToken) throw new Error('nao consegui token pra ' + uid + ': ' + JSON.stringify(j));
  return j.idToken;
}
const cab = (t) => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });
const campos = (o) => ({ fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { stringValue: String(v) }])) });

async function criar(id, dados, token) {
  const r = await fetch(`${RAIZ}/${COL}?documentId=${encodeURIComponent(id)}`, { method: 'POST', headers: cab(token), body: JSON.stringify(campos(dados)) });
  return r.status;
}
async function mudar(id, dados, token) {
  const mascara = Object.keys(dados).map(k => 'updateMask.fieldPaths=' + k).join('&');
  const r = await fetch(`${RAIZ}/${COL}/${id}?${mascara}&currentDocument.exists=true`, { method: 'PATCH', headers: cab(token), body: JSON.stringify(campos(dados)) });
  return r.status;
}
async function ler(id, token) { return (await fetch(`${RAIZ}/${COL}/${id}`, { headers: cab(token) })).status; }
async function apagar(id, token) { return (await fetch(`${RAIZ}/${COL}/${id}`, { method: 'DELETE', headers: cab(token) })).status; }
/** A consulta que a tela faz: por pessoa e mês (ou sem filtro de pessoa, pra tentar ver a de todos). */
async function consultar(token, teacherId) {
  const filtros = [{ fieldFilter: { field: { fieldPath: 'mes' }, op: 'EQUAL', value: { stringValue: MES } } }];
  if (teacherId) filtros.push({ fieldFilter: { field: { fieldPath: 'teacherId' }, op: 'EQUAL', value: { stringValue: teacherId } } });
  const r = await fetch(`${RAIZ}:runQuery`, { method: 'POST', headers: cab(token),
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: COL }], where: { compositeFilter: { op: 'AND', filters: filtros } } } }) });
  const j = await r.json().catch(() => null);
  return { status: r.status, n: Array.isArray(j) ? j.filter(x => x.document).length : 0 };
}

async function limpar() {
  for (const id of [ID_MEU, ID_OUTRO, ID_VALIDADA, `${MEU}_errado`]) await db.collection(COL).doc(id).delete().catch(() => {});
}

(async () => {
  await limpar();
  try {
    const tAdmin = await tokenDe(UID_ADMIN);
    const tProf = await tokenDe(UID_PROF);

    console.log('O professor e a própria declaração:');
    const antes = await consultar(tProf, MEU);
    checa('consulta a própria antes de existir (é como a tela abre)', antes.status, 200);
    checa('cria a própria, como rascunho', await criar(ID_MEU, { teacherId: MEU, mes: MES, status: 'rascunho' }, tProf), 200);
    checa('lê a própria', await ler(ID_MEU, tProf), 200);
    checa('envia para a gestão', await mudar(ID_MEU, { status: 'enviada' }, tProf), 200);
    checa('volta atrás (rascunho de novo)', await mudar(ID_MEU, { status: 'rascunho' }, tProf), 200);

    console.log('\nO que ele NÃO pode:');
    checa('criar a declaração de outra pessoa', await criar(ID_OUTRO, { teacherId: OUTRO, mes: MES, status: 'rascunho' }, tProf), 403);
    checa('criar a própria com outro identificador', await criar(`${MEU}_errado`, { teacherId: MEU, mes: MES, status: 'rascunho' }, tProf), 403);
    checa('criar a própria já validada', await criar(ID_VALIDADA, { teacherId: MEU, mes: '2099-02', status: 'validada' }, tProf), 403);
    checa('se dar por validado', await mudar(ID_MEU, { status: 'validada' }, tProf), 403);
    checa('escrever quem validou', await mudar(ID_MEU, { validadaPor: UID_PROF }, tProf), 403);
    checa('escrever o que foi aplicado', await mudar(ID_MEU, { aplicado: 'x' }, tProf), 403);
    checa('fechar valendo a agenda por conta própria', await mudar(ID_MEU, { status: 'dispensada' }, tProf), 403);
    checa('passar a declaração para o nome de outro', await mudar(ID_MEU, { teacherId: OUTRO }, tProf), 403);
    checa('apagar a própria', await apagar(ID_MEU, tProf), 403);

    console.log('\nA de um colega:');
    await db.collection(COL).doc(ID_OUTRO).set({ teacherId: OUTRO, mes: MES, status: 'enviada' });
    checa('não lê', await ler(ID_OUTRO, tProf), 403);
    checa('não altera', await mudar(ID_OUTRO, { status: 'rascunho' }, tProf), 403);
    checa('não consulta a de todo mundo', (await consultar(tProf, null)).status, 403);
    const meu = await consultar(tProf, MEU);
    checa('a consulta dele devolve só a dele', meu.status === 200 && meu.n === 1 ? 200 : 0, 200);

    console.log('\nDepois de a gestão decidir:');
    await db.collection(COL).doc(ID_VALIDADA).set({ teacherId: MEU, mes: '2099-02', status: 'validada', validadaPor: UID_ADMIN });
    checa('validada: o professor não reabre', await mudar(ID_VALIDADA, { status: 'rascunho' }, tProf), 403);
    checa('validada: nem muda os dias', await mudar(ID_VALIDADA, { obs: 'x' }, tProf), 403);
    checa('validada: continua lendo', await ler(ID_VALIDADA, tProf), 200);

    console.log('\nA gestão:');
    checa('lê a de qualquer um', await ler(ID_OUTRO, tAdmin), 200);
    checa('consulta o mês inteiro', (await consultar(tAdmin, null)).status, 200);
    checa('valida', await mudar(ID_MEU, { status: 'validada', validadaPor: UID_ADMIN }, tAdmin), 200);
    checa('devolve', await mudar(ID_OUTRO, { status: 'devolvida', devolvidaPor: UID_ADMIN }, tAdmin), 200);
    checa('nem a gestão apaga', await apagar(ID_OUTRO, tAdmin), 403);
  } finally {
    await limpar();
  }
  console.log(`\n${passou} ✓ · ${falhou} ✗`);
  process.exit(falhou ? 1 : 0);
})().catch(e => { console.error('ERRO', e); process.exit(1); });
