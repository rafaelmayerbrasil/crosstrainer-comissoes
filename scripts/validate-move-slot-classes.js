'use strict';
// E2E da CF moveSlotClasses em STAGING — chama a função de verdade, autenticado.
// Prova as duas coisas que só aparecem chamando: que não sobra aula duplicada
// depois da troca, e que quem não é admin leva porta na cara.
//
// Uso: node scripts/validate-move-slot-classes.js
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const PROJECT = 'crosstrainer-comissoes-staging';
const REGION = 'us-central1';
const svcPath = path.join(__dirname, 'serviceAccount-staging.json');
if (!fs.existsSync(svcPath)) { console.error('Falta scripts/serviceAccount-staging.json'); process.exit(1); }
const cfg = fs.readFileSync(path.join(__dirname, '..', 'firebase-config.js'), 'utf8');
const apiKey = (cfg.match(/apiKey:\s*['"]([^'"]+)['"][\s\S]{0,120}?crosstrainer-comissoes-staging/) || [])[1];
if (!apiKey) { console.error('não achei a apiKey do staging'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(svcPath)), projectId: PROJECT });
const db = admin.firestore();

const ADMIN = { email: 'dono.teste@crosstainer.com', pass: 'crosstainer2026' };
const PROF  = { email: 'professor.teste@crosstainer.com', pass: 'crosstainer2026' };

let fails = 0, checks = 0;
const expect = (desc, got, want) => {
  const ok = got === want; checks++; if (!ok) fails++;
  console.log(`${ok ? '✓' : '✗'} ${desc} — esperado ${want}, veio ${got}`);
};

async function signIn(email, password) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const j = await r.json();
  if (!j.idToken) throw new Error(`login de ${email} falhou: ` + ((j.error && j.error.message) || '?'));
  return j.idToken;
}
async function chamar(idToken, payload) {
  const r = await fetch(`https://${REGION}-${PROJECT}.cloudfunctions.net/moveSlotClasses`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ data: payload }) });
  let body = null;
  try { body = await r.json(); } catch (_e) {}
  return { status: r.status, body };
}

const SLOT = 'zzmove_slot';

(async () => {
  const hoje = new Date();
  const d = n => { const x = new Date(hoje); x.setDate(x.getDate() + n); return x; };

  await db.collection('schedule_slots').doc(SLOT).set({
    unitId: 'zzmove_unit', weekday: 3, startTime: '07:00', endTime: '08:00',
    teacherId: 'zzmove_t', modalityId: 'zzmove_m', isActive: true, _fixture: true,
  });
  await db.collection('classes').doc('zzmove_c1').set({
    slotId: SLOT, status: 'prevista', monthClosingId: null, scheduledDate: d(7),
    unitId: 'zzmove_unit', teacherId: 'zzmove_t', _fixture: true });
  await db.collection('classes').doc('zzmove_c2').set({
    slotId: SLOT, status: 'cancelada', monthClosingId: null, scheduledDate: d(14),
    unitId: 'zzmove_unit', teacherId: 'zzmove_t', _fixture: true });
  console.log('fixture criada (1 slot, 1 aula intocada + 1 cancelada)\n');

  try {
    // 403 EXATO, não "qualquer erro": na primeira rodada a função estava sem
    // permissão de invocação e devolvia 401 pra todo mundo — o teste passou
    // pelo motivo errado. Exigir 403 garante que quem recusou foi o NOSSO
    // código de admin, e não a infraestrutura recusando todo mundo.
    const tkProf = await signIn(PROF.email, PROF.pass);
    const negado = await chamar(tkProf, { slotId: SLOT, dryRun: true });
    expect('professor recusado pela checagem de admin (403)', negado.status, 403);

    const tkAdmin = await signIn(ADMIN.email, ADMIN.pass);

    const seco = await chamar(tkAdmin, { slotId: SLOT, dryRun: true });
    expect('dryRun conta a intocada', seco.body && seco.body.result && seco.body.result.deleted, 1);
    expect('dryRun pula a cancelada', seco.body && seco.body.result && seco.body.result.skipped, 1);

    const antes = await db.collection('classes').where('slotId', '==', SLOT).get();
    expect('dryRun não apagou nada', antes.size, 2);

    const real = await chamar(tkAdmin, { slotId: SLOT, dryRun: false });
    expect('move real apaga a intocada', real.body && real.body.result && real.body.result.deleted, 1);

    const depois = await db.collection('classes').where('slotId', '==', SLOT).get();
    const porData = new Map();
    depois.docs.forEach(doc => {
      const dt = doc.data().scheduledDate.toDate();
      const k = dt.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      porData.set(k, (porData.get(k) || 0) + 1);
    });
    expect('nenhuma data ficou com aula duplicada', [...porData.values()].every(n => n === 1), true);
    expect('a cancelada continua lá', depois.docs.some(x => x.id === 'zzmove_c2'), true);
  } finally {
    console.log('\nlimpando fixture...');
    const restos = await db.collection('classes').where('slotId', '==', SLOT).get();
    for (const doc of restos.docs) await doc.ref.delete();
    await db.collection('schedule_slots').doc(SLOT).delete();
    console.log('fixture removida');
  }

  console.log(`\n${checks - fails}/${checks} verificações passaram`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
