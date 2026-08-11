'use strict';
// Valida as regras do banco de horas (bloco 2) via REST API — não Admin SDK,
// que bypassaria as regras. Usa as contas de demo do staging.
//
// A regra: intern_hour_balances e intern_hour_movements são SÓ LEITURA pelo app.
// Quem escreve é o fechamento, pela Cloud Function (Admin SDK ignora as regras).
// O saldo é consequência de um mês fechado, não um campo editável — nem pelo
// admin, senão o número deixa de ter lastro no que aconteceu.
//
// Leitura: gestão vê tudo; o estagiário vê só o próprio saldo.
//
// Pré-requisito: o doc de saldo do professor de demo é semeado aqui pelo Admin
// SDK (scripts/serviceAccount-staging.json) e apagado no fim.
//
// Roda: node scripts/validate-banco-horas-rules.js
const path = require('path');
const admin = require('firebase-admin');

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

async function get(p, t)         { return (await fetch(`${BASE}/${p}`, { headers: H(t) })).status; }
async function patch(p, t, body) { return (await fetch(`${BASE}/${p}`, { method: 'PATCH', headers: H(t), body: JSON.stringify(body) })).status; }
async function del(p, t)         { return (await fetch(`${BASE}/${p}`, { method: 'DELETE', headers: H(t) })).status; }
async function getDoc(p, t) {
  const r = await fetch(`${BASE}/${p}`, { headers: H(t) });
  return r.ok ? r.json() : null;
}

let pass = 0, fail = 0;
function check(label, cond, got) {
  if (cond) { pass++; console.log(`  ✓ ${label} (HTTP ${got})`); }
  else { fail++; console.log(`  ✗ ${label} — INESPERADO HTTP ${got}`); }
}

(async () => {
  admin.initializeApp({
    credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccount-staging.json'))),
    projectId: PID,
  });
  const db = admin.firestore();

  const adm = await signIn(ADMIN);
  const prof = await signIn(PROF);
  console.log('Logins OK (admin + professor).');

  const uDoc = await getDoc(`users/${prof.uid}`, adm.token);
  const myPid = uDoc && uDoc.fields && uDoc.fields.professorId && uDoc.fields.professorId.stringValue;
  if (!myPid) {
    console.error(`\n✗ A conta ${PROF.email} não tem professorId em users/${prof.uid}.`);
    process.exit(1);
  }
  const outroPid = '__rt_outro_estagiario';
  const movMeu = `${myPid}_2026-08`;
  const movOutro = `${outroPid}_2026-08`;
  console.log(`professorId da conta de demo: ${myPid}\n`);

  // ── Semeia como a CF faria (Admin SDK, ignora as regras) ──
  await db.collection('intern_hour_balances').doc(myPid).set({ teacherId: myPid, saldoHoras: -12, ultimoMes: '2026-08' });
  await db.collection('intern_hour_balances').doc(outroPid).set({ teacherId: outroPid, saldoHoras: -5, ultimoMes: '2026-08' });
  await db.collection('intern_hour_movements').doc(movMeu).set({ teacherId: myPid, year: 2026, month: 8, mes: '2026-08', saldoFinal: -12 });
  await db.collection('intern_hour_movements').doc(movOutro).set({ teacherId: outroPid, year: 2026, month: 8, mes: '2026-08', saldoFinal: -5 });
  console.log('Semeado pelo Admin SDK (é assim que a CF grava).\n');

  // ── Leitura ──
  const rMeu = await get(`intern_hour_balances/${myPid}`, prof.token);
  check('professor LÊ o próprio saldo (allow)', rMeu === 200, rMeu);
  const rOutro = await get(`intern_hour_balances/${outroPid}`, prof.token);
  check('professor LÊ o saldo de OUTRO (deny)', rOutro === 403, rOutro);
  const rAdm = await get(`intern_hour_balances/${outroPid}`, adm.token);
  check('gestão LÊ qualquer saldo (allow)', rAdm === 200, rAdm);

  const mMeu = await get(`intern_hour_movements/${movMeu}`, prof.token);
  check('professor LÊ o próprio movimento (allow)', mMeu === 200, mMeu);
  const mOutro = await get(`intern_hour_movements/${movOutro}`, prof.token);
  check('professor LÊ movimento de OUTRO (deny)', mOutro === 403, mOutro);
  const mAdm = await get(`intern_hour_movements/${movOutro}`, adm.token);
  check('gestão LÊ qualquer movimento (allow)', mAdm === 200, mAdm);

  // ── Escrita: NINGUÉM pelo app ──
  const saldoFields = { fields: { teacherId: { stringValue: myPid }, saldoHoras: { doubleValue: 0 } } };
  const wProf = await patch(`intern_hour_balances/${myPid}`, prof.token, saldoFields);
  check('professor ZERA o próprio saldo (deny)', wProf === 403, wProf);
  const wAdm = await patch(`intern_hour_balances/${myPid}`, adm.token, saldoFields);
  check('ADMIN edita saldo pelo app (deny — só a CF do fechamento)', wAdm === 403, wAdm);
  const wMov = await patch(`intern_hour_movements/${movMeu}`, adm.token,
    { fields: { saldoFinal: { doubleValue: 0 } } });
  check('admin edita movimento pelo app (deny)', wMov === 403, wMov);
  const dAdm = await del(`intern_hour_balances/${myPid}`, adm.token);
  check('admin APAGA saldo pelo app (deny)', dAdm === 403, dAdm);

  // ── Cleanup (Admin SDK, já que o app não pode apagar) ──
  await db.collection('intern_hour_balances').doc(myPid).delete();
  await db.collection('intern_hour_balances').doc(outroPid).delete();
  await db.collection('intern_hour_movements').doc(movMeu).delete();
  await db.collection('intern_hour_movements').doc(movOutro).delete();
  const sobrouSaldo = (await db.collection('intern_hour_balances').get()).size;
  const sobrouMov = (await db.collection('intern_hour_movements').get()).size;
  check(`cleanup completo (saldos=${sobrouSaldo}, movimentos=${sobrouMov})`, sobrouSaldo === 0 && sobrouMov === 0, 'n/a');

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
