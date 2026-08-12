'use strict';
// Valida via REST que o professor informa a ocorrência mas NÃO grava horas.
// Roda: node scripts/validate-aviso-ocorrencia-rules.js
//
// O professor passou a poder informar atraso/hora extra (12/08/2026). Como esses
// minutos viram folha de pagamento, quem grava os campos oficiais continua sendo
// a gestão. Sem a trava, bastava o console do navegador pra alguém se creditar
// horas — este teste é justamente a tentativa de fazer isso.
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

let passou = 0, falhou = 0;
function check(ok, desc) { console.log((ok ? '  ✓ ' : '  ✗ ') + desc); ok ? passou++ : falhou++; }

const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-staging.json')) });
}
const fs = admin.firestore();
const CID = '__rt_aviso_ocorrencia';

// PATCH com updateMask: só os campos listados entram no diff da regra.
function patch(token, campos, body) {
  const mask = campos.map(f => `updateMask.fieldPaths=${f}`).join('&');
  return fetch(`${BASE}/classes/${CID}?${mask}`, { method: 'PATCH', headers: H(token), body: JSON.stringify(body) });
}
const aviso = (min) => ({ fields: { avisoProfessor: { mapValue: { fields: {
  tipo: { stringValue: 'ocorrencia' },
  atrasoMinutos: { integerValue: String(min) },
} } } } });

(async () => {
  const prof = await signIn(PROF);
  const gestao = await signIn(ADMIN);

  // A aula precisa ser DO professor de teste
  const me = await (await fetch(`${BASE}/users/${prof.uid}`, { headers: H(prof.token) })).json();
  const professorId = me.fields.professorId.stringValue;
  await fs.collection('classes').doc(CID).set({
    teacherId: professorId, originalTeacherId: professorId, monthClosingId: null,
    status: 'realizada', atrasoMinutos: 0, horaExtraMinutos: 0,
    scheduledDate: admin.firestore.Timestamp.now(), startTime: '08:00', endTime: '09:00',
  });

  console.log('1) O professor consegue avisar:');
  const r1 = await patch(prof.token, ['avisoProfessor'], aviso(15));
  check(r1.status === 200, `aviso gravado pelo professor (HTTP ${r1.status})`);
  check((await fs.collection('classes').doc(CID).get()).data().avisoProfessor.atrasoMinutos === 15, 'com o valor que ele informou');

  console.log('\n2) …mas NÃO consegue se creditar horas direto:');
  const r2 = await patch(prof.token, ['atrasoMinutos'], { fields: { atrasoMinutos: { integerValue: '120' } } });
  check(r2.status === 403, `gravar atrasoMinutos é bloqueado (HTTP ${r2.status})`);
  const r3 = await patch(prof.token, ['horaExtraMinutos'], { fields: { horaExtraMinutos: { integerValue: '300' } } });
  check(r3.status === 403, `gravar horaExtraMinutos é bloqueado (HTTP ${r3.status})`);
  const r4 = await patch(prof.token, ['avisoProfessor', 'horaExtraMinutos'],
    { fields: { avisoProfessor: { mapValue: { fields: { tipo: { stringValue: 'ocorrencia' } } } }, horaExtraMinutos: { integerValue: '300' } } });
  check(r4.status === 403, `nem escondendo a hora extra junto com o aviso (HTTP ${r4.status})`);
  const depois = (await fs.collection('classes').doc(CID).get()).data();
  check(depois.atrasoMinutos === 0 && depois.horaExtraMinutos === 0, 'os campos oficiais seguem zerados');

  console.log('\n3) A gestão confirma normalmente:');
  const r5 = await patch(gestao.token, ['atrasoMinutos', 'avisoProfessor'],
    { fields: { atrasoMinutos: { integerValue: '15' }, avisoProfessor: { nullValue: null } } });
  check(r5.status === 200, `gestão grava as horas e limpa o aviso (HTTP ${r5.status})`);
  const final = (await fs.collection('classes').doc(CID).get()).data();
  check(final.atrasoMinutos === 15 && final.avisoProfessor === null, 'valor oficial gravado e aviso resolvido');

  console.log('\n4) Limpeza:');
  await fs.collection('classes').doc(CID).delete();
  check(!(await fs.collection('classes').doc(CID).get()).exists, 'aula de teste removida');

  console.log(`\n${falhou === 0 ? '✓' : '✗'} validate-aviso-ocorrencia-rules: ${passou} passaram, ${falhou} falharam`);
  process.exit(falhou === 0 ? 0 : 1);
})().catch(async e => {
  console.error('✗ ERRO:', e.message);
  try { await fs.collection('classes').doc(CID).delete(); } catch (_) {}
  process.exit(1);
});
