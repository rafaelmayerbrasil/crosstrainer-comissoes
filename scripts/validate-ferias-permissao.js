'use strict';
// Valida a correção do "Missing or insufficient permissions" ao solicitar férias.
// Roda: node scripts/validate-ferias-permissao.js
//
// O bug (12/08/2026): VacationService.request gravava o pedido e SÓ ENTÃO varria
// /users atrás dos admins pra notificar. A regra de /users só deixa cada um ler o
// próprio doc — então pro professor aquela varredura estourava DEPOIS do pedido já
// estar salvo. A tela mostrava erro num pedido que dera certo, a pessoa clicava de
// novo: o Leonardo ficou com 5 pedidos idênticos e a gestão sem aviso nenhum.
//
// Via REST (não Admin SDK, que ignora as regras). Contas de demo do staging.
const API_KEY = 'AIzaSyC5wqYNNyrJBPXbBPK8gRxQxOPHTIW7TFo'; // staging (firebase-config.js)
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

let passou = 0, falhou = 0;
function check(ok, desc) {
  console.log((ok ? '  ✓ ' : '  ✗ ') + desc);
  ok ? passou++ : falhou++;
}

(async () => {
  const admin = await signIn(ADMIN);
  const prof  = await signIn(PROF);

  // professorId da conta de professor (lendo o próprio doc — permitido)
  const meRes = await fetch(`${BASE}/users/${prof.uid}`, { headers: H(prof.token) });
  const me = await meRes.json();
  const professorId = me.fields && me.fields.professorId && me.fields.professorId.stringValue;
  if (!professorId) throw new Error('conta de professor sem professorId: ' + JSON.stringify(me));
  console.log('professorId da conta de teste:', professorId, '\n');

  /* ── 1. A varredura que quebrava tudo segue PROIBIDA ─────────────── */
  console.log('1) A consulta que o navegador fazia (procurar admins em /users):');
  const scan = await fetch(`${BASE}:runQuery`, {
    method: 'POST', headers: H(prof.token),
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'users' }],
      where: { fieldFilter: { field: { fieldPath: 'profiles' }, op: 'ARRAY_CONTAINS', value: { stringValue: 'admin' } } },
    } }),
  });
  check(scan.status === 403 || scan.status === 400,
    `professor continua SEM poder varrer /users (HTTP ${scan.status}) — a regra está certa, o erro era o código chamar isso`);

  /* ── 2. O professor consegue registrar o pedido ──────────────────── */
  console.log('\n2) Solicitação de férias pelo professor:');
  const docId = `__rt_ferias_${Date.now()}`;
  const body = { fields: {
    teacherId:       { stringValue: professorId },
    teacherName:     { stringValue: 'Professor Teste' },
    type:            { stringValue: 'ferias' },
    status:          { stringValue: 'pendente' },
    totalDays:       { integerValue: '10' },
    requestedBy:     { stringValue: prof.uid },
    periods:         { arrayValue: { values: [] } },
  } };
  const create = await fetch(`${BASE}/vacation_requests?documentId=${docId}`, {
    method: 'POST', headers: H(prof.token), body: JSON.stringify(body),
  });
  check(create.status === 200, `o pedido é gravado (HTTP ${create.status})`);

  /* ── 3. A CF avisa a gestão (ela roda com Admin SDK) ─────────────── */
  console.log('\n3) Aviso pra gestão — agora é a CF onVacationRequested que faz:');
  // Sem orderBy de propósito: filtro por igualdade + ordenação por outro campo
  // exige índice composto, e a query falharia calada — o teste diria "a CF não
  // avisou" quando o problema era o próprio teste.
  let achou = null;
  for (let i = 0; i < 12 && !achou; i++) {              // a CF é assíncrona
    await new Promise(r => setTimeout(r, 2500));
    const q = await fetch(`${BASE}:runQuery`, {
      method: 'POST', headers: H(admin.token),
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: 'notifications' }],
        // Filtra pelo DESTINATÁRIO: a regra de /notifications só deixa cada um ler
        // as próprias, e no Firestore regra não é filtro — sem isso a query é negada.
        where: { fieldFilter: { field: { fieldPath: 'recipientUserId' }, op: 'EQUAL', value: { stringValue: admin.uid } } },
        limit: 300,
      } }),
    });
    const rows = await q.json();
    if (!Array.isArray(rows)) { console.log('\n  ⚠️ query falhou:', JSON.stringify(rows).slice(0, 200)); break; }
    achou = rows.find(r => r.document && r.document.fields.link
      && JSON.stringify(r.document.fields.link).includes(docId));
    if (!achou) process.stdout.write(`  … aguardando a CF (${(i + 1) * 2.5}s)   \r`);
  }
  process.stdout.write('                                   \r');
  check(!!achou, achou ? 'a gestão foi notificada do pedido' : 'CF NÃO notificou em 30s');
  if (achou) {
    const corpo = achou.document.fields.body.stringValue;
    check(/solicitou/.test(corpo), `o texto do aviso faz sentido: "${corpo}"`);
  }

  /* ── limpeza ─────────────────────────────────────────────────────── */
  // Nem admin apaga vacation_requests/notifications pelas regras (proposital:
  // histórico de férias não se apaga). Limpeza do rastro de teste vai de Admin SDK.
  console.log('\n4) Limpeza (Admin SDK — as regras não deixam apagar, e está certo):');
  const fbAdmin = require('firebase-admin');
  if (!fbAdmin.apps.length) {
    fbAdmin.initializeApp({ credential: fbAdmin.credential.cert(require('./serviceAccount-staging.json')) });
  }
  const fs = fbAdmin.firestore();
  await fs.collection('vacation_requests').doc(docId).delete();
  check(!(await fs.collection('vacation_requests').doc(docId).get()).exists, 'pedido de teste removido');
  if (achou) {
    const nid = achou.document.name.split('/').pop();
    await fs.collection('notifications').doc(nid).delete();
    check(!(await fs.collection('notifications').doc(nid).get()).exists, 'notificação de teste removida');
  }

  console.log(`\n${falhou === 0 ? '✓' : '✗'} validate-ferias-permissao: ${passou} passaram, ${falhou} falharam`);
  process.exit(falhou === 0 ? 0 : 1);
})().catch(e => { console.error('✗ ERRO:', e.message); process.exit(1); });
