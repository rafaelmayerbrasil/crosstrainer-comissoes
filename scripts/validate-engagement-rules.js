'use strict';
// Valida as regras Firestore do módulo de Engajamento via REST API (não Admin SDK,
// que bypassaria as regras). Usa as contas de demo do staging. Foca em casos que
// NÃO deixam lixo (point_entries/attendance são delete:false, então só testamos
// o DENY deles; o único doc criado — config de teste do admin — é apagado no fim).
// Roda: node scripts/validate-engagement-rules.js
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
  return j.idToken;
}
const H = (t) => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });
const FIELDS = { fields: { _ruletest: { booleanValue: true } } };

async function get(path, t)   { return (await fetch(`${BASE}/${path}`, { headers: H(t) })).status; }
async function patch(path, t) { return (await fetch(`${BASE}/${path}`, { method: 'PATCH', headers: H(t), body: JSON.stringify(FIELDS) })).status; }
async function del(path, t)   { return (await fetch(`${BASE}/${path}`, { method: 'DELETE', headers: H(t) })).status; }

let pass = 0, fail = 0;
function check(label, cond, got) {
  if (cond) { pass++; console.log(`  ✓ ${label} (HTTP ${got})`); }
  else { fail++; console.log(`  ✗ ${label} — INESPERADO HTTP ${got}`); }
}

(async () => {
  const adm = await signIn(ADMIN);
  const prof = await signIn(PROF);
  console.log('Logins OK (admin + professor).\n');

  // Professor
  check('professor LÊ engagement_config (allow)', (await get('engagement_config/current', prof)) !== 403, '≠403');
  check('professor ESCREVE engagement_config (deny)', (await patch('engagement_config/__rt_cfgP', prof)) === 403, 403);
  check('professor ESCREVE point_entries (deny)', (await patch('point_entries/__rt_peP', prof)) === 403, 403);
  check('professor ESCREVE attendance (deny)', (await patch('attendance/__rt_attP', prof)) === 403, 403);
  check('professor LÊ point_cycles (allow)', (await get('point_cycles/__nope', prof)) !== 403, '≠403');

  // Admin
  const wCfg = await patch('engagement_config/__rt_cfg', adm);
  check('admin ESCREVE engagement_config (allow)', wCfg === 200, wCfg);
  check('admin ESCREVE point_cycles (allow)', (await patch('point_cycles/__rt_cycle', adm)) === 200, '200');
  check('admin LÊ point_entries (allow)', (await get('point_entries/__nope', adm)) !== 403, '≠403');

  // Cleanup (config/cycles permitem delete por admin; point_entries/attendance são delete:false e não criamos doc)
  const dCfg = await del('engagement_config/__rt_cfg', adm);
  const dCyc = await del('point_cycles/__rt_cycle', adm);
  check('cleanup: admin APAGA config de teste', dCfg === 200, dCfg);
  check('cleanup: admin APAGA cycle de teste', dCyc === 200, dCyc);

  console.log(`\n${fail === 0 ? '✓' : '✗'} validate-engagement-rules: ${pass} ok, ${fail} falhas`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERRO:', e.message); process.exit(2); });
