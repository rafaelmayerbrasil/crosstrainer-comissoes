'use strict';
// Valida a regra de delete de special_scales via REST (Admin SDK ignoraria as regras).
// Roda: node scripts/validate-excluir-evento-rules.js
//
// A regra nova: gestão apaga EVENTO; qualquer outro tipo continua barrado, porque
// a consolidação de sábado/feriado já mexeu no contador de justiça. Professor não
// apaga nada. Fixture criada e limpa por Admin SDK.
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
const H = (t) => ({ Authorization: 'Bearer ' + t });

let passou = 0, falhou = 0;
function check(ok, desc) { console.log((ok ? '  ✓ ' : '  ✗ ') + desc); ok ? passou++ : falhou++; }

const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-staging.json')) });
}
const fs = admin.firestore();

const IDS = { evento: '__rt_del_evento', sabado: '__rt_del_sabado', evento2: '__rt_del_evento2' };

async function semear() {
  await fs.collection('special_scales').doc(IDS.evento).set({ tipo: 'evento', date: '2026-08-15', name: 'RT evento', slots: [] });
  await fs.collection('special_scales').doc(IDS.evento2).set({ tipo: 'evento', date: '2026-08-15', name: 'RT evento 2', slots: [] });
  await fs.collection('special_scales').doc(IDS.sabado).set({ tipo: 'sabado', date: '2026-08-22', name: 'RT sabado', slots: [], status: 'consolidada' });
}
async function limpar() {
  for (const id of Object.values(IDS)) await fs.collection('special_scales').doc(id).delete();
}

(async () => {
  await semear();
  const gestao = await signIn(ADMIN);
  const prof   = await signIn(PROF);
  const del = (id, tok) => fetch(`${BASE}/special_scales/${id}`, { method: 'DELETE', headers: H(tok) });

  console.log('1) Professor não apaga nada:');
  check((await del(IDS.evento, prof.token)).status === 403, 'professor barrado ao tentar apagar evento');

  console.log('\n2) Gestão apaga EVENTO:');
  const r2 = await del(IDS.evento, gestao.token);
  check(r2.status === 200, `evento apagado pela gestão (HTTP ${r2.status})`);
  check(!(await fs.collection('special_scales').doc(IDS.evento).get()).exists, 'sumiu de verdade do banco');

  console.log('\n3) Sábado consolidado continua protegido:');
  const r3 = await del(IDS.sabado, gestao.token);
  check(r3.status === 403, `nem a gestão apaga sábado (HTTP ${r3.status}) — o fairness já foi aplicado`);
  check((await fs.collection('special_scales').doc(IDS.sabado).get()).exists, 'o sábado continua lá');

  console.log('\n4) Limpeza:');
  await limpar();
  check(!(await fs.collection('special_scales').doc(IDS.sabado).get()).exists, 'fixture removida');

  console.log(`\n${falhou === 0 ? '✓' : '✗'} validate-excluir-evento-rules: ${passou} passaram, ${falhou} falharam`);
  process.exit(falhou === 0 ? 0 : 1);
})().catch(async e => { console.error('✗ ERRO:', e.message); try { await limpar(); } catch (_) {} process.exit(1); });
