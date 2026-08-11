'use strict';
// Valida a regra de update de `classes` depois do bloco 3, via REST API (Admin
// SDK bypassaria as rules).
//
// O que mudou: antes só o TITULAR ORIGINAL podia atualizar a aula. Quem pegou a
// substituição virava `teacherId` da aula mas não conseguia nem avisar que ela
// não aconteceu — e a spec diz que os dois lados podem registrar.
//
// Roda: node scripts/validate-substituicao-rules.js
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
  if (!j.idToken) throw new Error('login falhou: ' + JSON.stringify(j));
  return { token: j.idToken, uid: j.localId };
}
const H = (t) => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });

// PATCH com updateMask pra mexer só no campo do aviso (é o que a tela faz)
async function avisar(classId, token) {
  const url = `${BASE}/classes/${classId}?updateMask.fieldPaths=avisoProfessor`;
  const r = await fetch(url, { method: 'PATCH', headers: H(token),
    body: JSON.stringify({ fields: { avisoProfessor: { mapValue: { fields: {
      tipo: { stringValue: 'nao_aconteceu' }, nota: { stringValue: '[teste rules]' },
    } } } } }) });
  return r.status;
}
async function get(p, t) { return (await fetch(`${BASE}/${p}`, { headers: H(t) })).status; }
async function getDoc(p, t) { const r = await fetch(`${BASE}/${p}`, { headers: H(t) }); return r.ok ? r.json() : null; }

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
  const uDoc = await getDoc(`users/${prof.uid}`, adm.token);
  const meuPid = uDoc && uDoc.fields && uDoc.fields.professorId && uDoc.fields.professorId.stringValue;
  if (!meuPid) { console.error('conta de demo sem professorId'); process.exit(1); }
  console.log(`professorId da conta de demo: ${meuPid}\n`);

  const OUTRO = '__rt_sub_outro_prof';
  const base = {
    unitId: '__rt_sub_unit', modalityId: '__rt_sub_mod', status: 'prevista',
    scheduledDate: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(2026, 7, 20, 15, 0, 0))),
    startTime: '12:00', endTime: '13:00', durationMinutes: 60, monthClosingId: null,
  };

  // 3 aulas: a minha, a que eu cobri, a que eu passei pra outro, e uma de terceiros
  const minha    = await db.collection('classes').add({ ...base, teacherId: meuPid, originalTeacherId: meuPid });
  const cobrindo = await db.collection('classes').add({ ...base, teacherId: meuPid, originalTeacherId: OUTRO });
  const passei   = await db.collection('classes').add({ ...base, teacherId: OUTRO, originalTeacherId: meuPid });
  const alheia   = await db.collection('classes').add({ ...base, teacherId: OUTRO, originalTeacherId: OUTRO });
  const fechada  = await db.collection('classes').add({ ...base, teacherId: meuPid, originalTeacherId: OUTRO, monthClosingId: '__rt_fechado' });

  try {
    check('professor LÊ aula (agenda precisa das duas consultas)', (await get(`classes/${passei.id}`, prof.token)) === 200, '200');

    check('avisa na aula DELE (allow)', (await avisar(minha.id, prof.token)) === 200, await avisar(minha.id, prof.token));
    check('avisa na aula que está COBRINDO (allow — era o furo do bloco 3)',
      (await avisar(cobrindo.id, prof.token)) === 200, await avisar(cobrindo.id, prof.token));
    check('avisa na aula que PASSOU pra outro (allow — segue sendo titular)',
      (await avisar(passei.id, prof.token)) === 200, await avisar(passei.id, prof.token));
    check('avisa em aula de OUTROS DOIS (deny)', (await avisar(alheia.id, prof.token)) === 403, await avisar(alheia.id, prof.token));
    check('avisa em aula de MÊS FECHADO (deny)', (await avisar(fechada.id, prof.token)) === 403, await avisar(fechada.id, prof.token));
  } finally {
    for (const r of [minha, cobrindo, passei, alheia, fechada]) await r.delete();
    const sobrou = (await db.collection('classes').where('unitId', '==', '__rt_sub_unit').get()).size;
    check(`cleanup completo (sobrou ${sobrou})`, sobrou === 0, sobrou);
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('\n💥', e.message || e); process.exit(1); });
