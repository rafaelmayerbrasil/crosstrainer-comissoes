'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Seed de DEMONSTRAÇÃO pro staging — aulas de Junho/2026 + pendências,
// pra homologação do cliente ver o sistema "vivo" (agendas, horas, fechamento).
// Tudo etiquetado 'seed-demo'.
// Roda:  node scripts/seed-demo.js            (cria)
//        node scripts/seed-demo.js --cleanup  (remove tudo do seed)
// ═══════════════════════════════════════════════════════════════════════
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-staging.json')) });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const FieldValue = admin.firestore.FieldValue;

// Teachers reais do staging (ids estáveis — conferidos em 12/06/2026)
const T = {
  lucas:  { id: 'QZw9fVWhf0r5jNnLj99B', mod: 'skT0j72evPDnB2Fu5wJm' }, // efetivo R$120/h · CrossFit
  ana:    { id: 'iMRf4L6N9dgCzCuzD9v3', mod: 'Fsqns4igjV0HnP4aFsOs' }, // estagiária bolsa 500
  teste:  { id: 'BWtYS5l6kNtkAMpTtBVw', mod: 'skT0j72evPDnB2Fu5wJm' }, // efetivo R$40/h
  pedro:  { id: '98Z7Yk8507FuE2YDh3xa', mod: 'Fsqns4igjV0HnP4aFsOs' }, // estagiário SEM salário (demo "Sem cadastro")
  marcos: { id: 'PhpOUDSxQzhFvn4WnXNB', mod: 'Fsqns4igjV0HnP4aFsOs' }, // eventual — ganha salário R$70/h no seed
};
const UNIT = 'unit-cp';
const HOJE = 12; // 12/06/2026 (sexta) — antes disso = realizada; a partir = prevista

function classDoc(teacher, day, startTime, endTime, statusOverride) {
  const [h] = startTime.split(':');
  const isPast = day < HOJE;
  return {
    slotId: null, templateId: null,
    unitId: UNIT,
    teacherId: teacher.id,
    originalTeacherId: teacher.id,
    modalityId: teacher.mod,
    startTime, endTime,
    durationMinutes: 60,
    status: statusOverride || (isPast ? 'realizada' : 'prevista'),
    isHoliday: false, holidayName: null, holidayType: null,
    cancellationReason: null, cancellationNote: null,
    adjustedBy: null, adjustedAt: null, adjustmentNote: null,
    generatedBy: 'seed-demo',
    monthClosingId: null,
    scheduledDate: Timestamp.fromDate(new Date(2026, 5, day)), // meia-noite BR
    createdAt: FieldValue.serverTimestamp(),
    generatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function create() {
  // 0) Salário do Marcos (eventual, hora-aula) — Pedro Lima fica SEM de propósito
  await db.collection('teacher_salaries').doc(T.marcos.id).set({
    remunerationType: 'hora_aula', hourlyRate: 70,
    internMonthlyStipend: null, internMonthlyLimitHours: null,
    internMonthlyLimitMinutes: null, internProportionalHourlyRate: null,
    mealAllowance: null, transportAllowance: null, otherBenefits: null,
    effectiveDate: Timestamp.fromDate(new Date(2026, 0, 5)),
    effectiveNote: 'seed-demo',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log('✓ salário Marcos Estrela (R$70/h)');

  // 1) Aulas de Junho/2026 (1=segunda … 27=sábado)
  const segQuaSex = [1, 3, 5, 8, 10, 12, 15, 17, 19, 22, 24, 26];
  const terQui    = [2, 4, 9, 11, 16, 18, 23, 25];
  const segQua    = [1, 3, 8, 10, 15, 17, 22, 24];
  const sabados   = [6, 13, 20, 27];

  const docs = [];
  segQuaSex.forEach(d => {
    docs.push(classDoc(T.lucas, d, '06:00', '07:00'));
    docs.push(classDoc(T.lucas, d, '18:00', '19:00'));
  });
  terQui.forEach(d => {
    docs.push(classDoc(T.ana, d, '09:00', '10:00'));
    docs.push(classDoc(T.teste, d, '18:00', '19:00'));
  });
  segQua.forEach(d => docs.push(classDoc(T.pedro, d, '19:00', '20:00')));
  sabados.forEach(d => {
    docs.push(classDoc(T.marcos, d, '09:00', '10:00'));
    docs.push(classDoc(T.marcos, d, '10:00', '11:00'));
  });

  // Toque de realismo: a aula do Lucas de 05/06 18:00 foi SUBSTITUÍDA pelo Marcos
  const subIdx = docs.findIndex(c => c.teacherId === T.lucas.id && c.startTime === '18:00'
    && c.scheduledDate.toDate().getDate() === 5);
  if (subIdx >= 0) {
    docs[subIdx].teacherId = T.marcos.id;
    docs[subIdx].status = 'substituida';
    docs[subIdx].adjustmentNote = 'Substituição aceita (seed-demo)';
  }

  let batch = db.batch(); let n = 0; const refs = [];
  for (const c of docs) {
    const ref = db.collection('classes').doc();
    refs.push(ref.id);
    batch.set(ref, c);
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
  console.log(`✓ ${docs.length} aulas de Junho/2026 criadas (realizadas até dia ${HOJE - 1}, previstas depois)`);

  // 2) Férias PENDENTE do Marcos (~daqui 30 dias) — acende a home do admin
  const start = new Date(2026, 6, 13), end = new Date(2026, 6, 22);
  const vac = await db.collection('vacation_requests').add({
    teacherId: T.marcos.id, teacherName: 'Marcos Estrela', teacherType: 'eventual',
    unitId: UNIT, type: 'ferias',
    periods: [{ startDate: Timestamp.fromDate(start), endDate: Timestamp.fromDate(end), days: 10 }],
    totalDays: 10,
    firstPeriodStart: Timestamp.fromDate(start), lastPeriodEnd: Timestamp.fromDate(end),
    reason: 'seed-demo', status: 'pendente',
    requestedAt: FieldValue.serverTimestamp(), requestedBy: 'seed-demo',
    respondedAt: null, respondedBy: null, payment: null, paidInClosingIds: [],
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  console.log('✓ férias pendente (Marcos, 13–22/07):', vac.id);

  // 3) Substituição PENDING (Lucas pediu, Ana substituta — aula de 19/06 06:00)
  const sub = await db.collection('substitutions').add({
    classId: refs[0] || null,
    requestingTeacherId: T.lucas.id, requestingUserId: 'seed-demo',
    substituteTeacherId: T.ana.id, substituteUserId: null,
    reason: 'seed-demo', status: 'pending',
    wasRetroactive: false, isOfficial: false,
    requestedAt: FieldValue.serverTimestamp(),
    respondedAt: null, responseNote: null,
    createdBy: 'seed-demo', updatedAt: FieldValue.serverTimestamp(), updatedBy: 'seed-demo',
  });
  console.log('✓ substituição pendente:', sub.id);
  console.log('\n══ DEMO PRONTA — agenda geral, fechamento Jun/2026, relatórios e home com pendências ══');
}

async function cleanup() {
  const cls = await db.collection('classes').where('generatedBy', '==', 'seed-demo').get();
  let batch = db.batch(); let n = 0;
  cls.forEach(d => { batch.delete(d.ref); n++; });
  if (n) await batch.commit();
  console.log(`✓ ${n} aulas seed-demo removidas`);
  for (const col of ['vacation_requests', 'substitutions']) {
    const s = await db.collection(col).where('reason', '==', 'seed-demo').get();
    for (const d of s.docs) await d.ref.delete();
    console.log(`✓ ${col}: ${s.size} removido(s)`);
  }
  console.log('✓ cleanup seed-demo completo (salário do Marcos mantido — cadastro básico)');
}

// ── Usuários de demonstração pro CLIENTE (visão admin + visão professor) ──
const DEMO_USERS = [
  { email: 'dono.teste@crosstainer.com', pass: 'crosstainer2026', name: 'Dono (Teste)',
    profiles: ['admin'], role: 'admin',
    moduleAccess: { comissoes: true, professores: true },
    professorId: null, allowedUnits: ['unit-cp', 'unit-norte', 'unit-pp'], unitId: 'unit-cp' },
  { email: 'professor.teste@crosstainer.com', pass: 'crosstainer2026', name: 'Marcos Estrela',
    profiles: ['professor'], role: 'professor',
    moduleAccess: { comissoes: false, professores: true },
    professorId: T.marcos.id, allowedUnits: [], unitId: null },
];

async function createUsers() {
  const auth = admin.auth();
  for (const u of DEMO_USERS) {
    let uid;
    try { uid = (await auth.getUserByEmail(u.email)).uid; }
    catch { uid = (await auth.createUser({ email: u.email, password: u.pass, displayName: u.name })).uid; }
    await db.collection('users').doc(uid).set({
      name: u.name, email: u.email, role: u.role, profiles: u.profiles,
      moduleAccess: u.moduleAccess, professorId: u.professorId,
      allowedUnits: u.allowedUnits, unitId: u.unitId, status: 'ativo',
      createdAt: FieldValue.serverTimestamp(),
    });
    console.log(`✓ ${u.email} (${u.profiles.join(',')})${u.professorId ? ' → vinculado ao Marcos Estrela' : ''}`);
  }
}

async function cleanupUsers() {
  const auth = admin.auth();
  for (const u of DEMO_USERS) {
    try {
      const a = await auth.getUserByEmail(u.email);
      await auth.deleteUser(a.uid);
      await db.collection('users').doc(a.uid).delete();
      console.log('✓ removido:', u.email);
    } catch {}
  }
}

(process.argv.includes('--cleanup') ? cleanup().then(cleanupUsers)
  : process.argv.includes('--users') ? createUsers()
  : create()).then(() => process.exit());
