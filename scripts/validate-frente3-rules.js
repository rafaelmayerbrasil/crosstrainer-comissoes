'use strict';
// Valida a regra Firestore de `event_rsvp` (Frente 3) via REST API — não Admin SDK,
// que bypassaria as regras. Usa as contas de demo do staging.
// A regra: read = prof-module; create/update = admin|superv| (personId == meu professorId);
// delete = admin|superv. O teste chave é o professor gravar a SUA linha (allow) vs a de
// outro (deny). Descobre o professorId da conta prof lendo users/{uid} como admin.
// Todo doc criado é apagado no fim (admin faz o delete, pois prof não pode deletar).
// Roda: node scripts/validate-frente3-rules.js
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
// event_rsvp gravado pela regra: personId é o campo que casa com o professorId do autor.
const rsvpFields = (personId) => ({ fields: {
  scaleId:   { stringValue: '__rt_evt' },
  personId:  { stringValue: personId },
  tier:      { stringValue: 'opcional' },
  going:     { booleanValue: true },
} });

async function get(path, t)        { return (await fetch(`${BASE}/${path}`, { headers: H(t) })).status; }
async function patch(path, t, body){ return (await fetch(`${BASE}/${path}`, { method: 'PATCH', headers: H(t), body: JSON.stringify(body) })).status; }
async function del(path, t)        { return (await fetch(`${BASE}/${path}`, { method: 'DELETE', headers: H(t) })).status; }

async function getDoc(path, t) {
  const r = await fetch(`${BASE}/${path}`, { headers: H(t) });
  return r.ok ? r.json() : null;
}

let pass = 0, fail = 0;
function check(label, cond, got) {
  if (cond) { pass++; console.log(`  ✓ ${label} (HTTP ${got})`); }
  else { fail++; console.log(`  ✗ ${label} — INESPERADO HTTP ${got}`); }
}

(async () => {
  const adm = await signIn(ADMIN);
  const prof = await signIn(PROF);
  console.log('Logins OK (admin + professor).');

  // Descobre o professorId vinculado à conta de demo do professor (users/{uid}).
  const uDoc = await getDoc(`users/${prof.uid}`, adm.token);
  const myPid = uDoc && uDoc.fields && uDoc.fields.professorId && uDoc.fields.professorId.stringValue;
  if (!myPid) {
    console.error(`\n✗ A conta ${PROF.email} não tem professorId em users/${prof.uid} — ` +
      `a regra de create/update do professor depende disso. Vincule a conta a um professor no Hub Pessoas.`);
    process.exit(1);
  }
  console.log(`professorId da conta de demo: ${myPid}\n`);

  const myDocId = `__rt_evt__${myPid}`;

  // ── Professor ──
  check('professor LÊ event_rsvp (allow)', (await get('event_rsvp/__nope', prof.token)) !== 403, '≠403');
  const wMine = await patch(`event_rsvp/${myDocId}`, prof.token, rsvpFields(myPid));
  check('professor GRAVA a SUA linha (personId == meu) (allow)', wMine === 200, wMine);
  const wOther = await patch('event_rsvp/__rt_evt__someone_else', prof.token, rsvpFields('someone_else'));
  check('professor GRAVA linha de OUTRO (personId != meu) (deny)', wOther === 403, wOther);
  const dMine = await del(`event_rsvp/${myDocId}`, prof.token);
  check('professor DELETA a própria linha (deny — só gestão)', dMine === 403, dMine);

  // ── Admin ──
  const wAdm = await patch('event_rsvp/__rt_evt__admin', adm.token, rsvpFields('qualquer'));
  check('admin GRAVA event_rsvp (allow)', wAdm === 200, wAdm);

  // ── Cleanup (admin deleta tudo que criamos; prof não pode) ──
  const dA = await del(`event_rsvp/${myDocId}`, adm.token);
  const dB = await del('event_rsvp/__rt_evt__admin', adm.token);
  check('cleanup: admin APAGA a linha do professor', dA === 200, dA);
  check('cleanup: admin APAGA a linha do admin', dB === 200, dB);
  // A tentativa de "outro" foi negada (403), então não há doc a limpar lá.

  console.log(`\n${fail === 0 ? '✓' : '✗'} validate-frente3-rules: ${pass} ok, ${fail} falhas`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERRO:', e.message); process.exit(2); });
