// ═══════════════════════════════════════════════════════════════════════
// Fixture Plano C — popula 1 férias PENDENTE + 1 substituição PENDING no
// staging, pra acender os chips de pendência da home do admin.
//
// Uso: node scripts/fixture-home-c.js --project staging [cleanup]
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const projectArg = args.find(a => a.startsWith('--project='))?.split('=')[1]
  || (args.includes('--project') ? args[args.indexOf('--project') + 1] : null);
if (projectArg !== 'staging') {
  console.error('Uso: node fixture-home-c.js --project staging [cleanup]');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccount-staging.json'))),
  projectId: 'crosstrainer-comissoes-staging',
});
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const FieldValue = admin.firestore.FieldValue;
const stateFile = path.join(__dirname, '.fixture-home-c-state.json');
const isCleanup = args.includes('cleanup');

(async () => {
  try { isCleanup ? await doCleanup() : await doSetup(); }
  catch (e) { console.error('ERRO:', e.message); if (process.env.DEBUG) console.error(e.stack); process.exit(1); }
  finally { await admin.app().delete(); }
})();

async function doSetup() {
  console.log('\n══════ FIXTURE Plano C — pendências da home ══════\n');
  const created = { vacationId: null, substitutionId: null };

  // Pega 2 professores ativos + 1 aula qualquer
  const tSnap = await db.collection('teachers').where('isActive', '==', true).limit(2).get();
  if (tSnap.empty) throw new Error('Sem teacher ativo no staging');
  const t1 = { id: tSnap.docs[0].id, ...tSnap.docs[0].data() };
  const t2 = tSnap.docs[1] ? { id: tSnap.docs[1].id, ...tSnap.docs[1].data() } : t1;

  const cSnap = await db.collection('classes').limit(1).get();
  const classId = cSnap.empty ? 'fixture-class' : cSnap.docs[0].id;

  // 1) Férias PENDENTE (entra em "férias a aprovar")
  const now = new Date();
  const startD = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30);
  const endD = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 39);
  const vacRef = db.collection('vacation_requests').doc();
  created.vacationId = vacRef.id;
  await vacRef.set({
    teacherId: t1.id,
    teacherName: t1.name || 'Professor',
    teacherType: t1.type || 'efetivo',
    unitId: t1.primaryUnitId || 'unit-cp',
    type: t1.type === 'estagiario' ? 'recesso' : 'ferias',
    periods: [{ startDate: Timestamp.fromDate(startD), endDate: Timestamp.fromDate(endD), days: 10 }],
    totalDays: 10,
    firstPeriodStart: Timestamp.fromDate(startD),
    lastPeriodEnd: Timestamp.fromDate(endD),
    reason: 'FIXTURE-C',
    status: 'pendente',
    requestedAt: FieldValue.serverTimestamp(),
    requestedBy: 'fixture',
    respondedAt: null, respondedBy: null,
    payment: null,
    paidInClosingIds: [],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`OK férias PENDENTE ${vacRef.id} (${t1.name})`);

  // 2) Substituição PENDING (entra em "substituições pendentes")
  const subRef = db.collection('substitutions').doc();
  created.substitutionId = subRef.id;
  await subRef.set({
    classId,
    requestingTeacherId: t1.id,
    requestingUserId: 'fixture',
    substituteTeacherId: t2.id,
    substituteUserId: null,
    reason: 'FIXTURE-C',
    status: 'pending',
    wasRetroactive: false,
    isOfficial: false,
    requestedAt: FieldValue.serverTimestamp(),
    respondedAt: null, responseNote: null,
    createdBy: 'fixture',
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: 'fixture',
  });
  console.log(`OK substituição PENDING ${subRef.id} (${t1.name} → ${t2.name})`);

  fs.writeFileSync(stateFile, JSON.stringify(created, null, 2));
  console.log('\n═════════════════════════════════════════════════');
  console.log('  HOME DO ADMIN deve mostrar:');
  console.log('  ⚠ Precisam de você → "1 férias a aprovar" + "1 substituição pendente"');
  console.log('  Clicar nos chips navega pra Férias / Agenda Geral.');
  console.log('═════════════════════════════════════════════════');
  console.log('\nCleanup: node scripts/fixture-home-c.js --project staging cleanup\n');
}

async function doCleanup() {
  if (!fs.existsSync(stateFile)) { console.log('Sem estado — nada a limpar.'); return; }
  const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  console.log('\n🧹 Cleanup fixture Plano C:\n');
  if (s.vacationId) { await db.collection('vacation_requests').doc(s.vacationId).delete(); console.log('  OK férias removida'); }
  if (s.substitutionId) { await db.collection('substitutions').doc(s.substitutionId).delete(); console.log('  OK substituição removida'); }
  fs.unlinkSync(stateFile);
  console.log('  Cleanup completo.\n');
}
