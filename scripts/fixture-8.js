// ═══════════════════════════════════════════════════════════════════════
// Fixture Sprint 8 — popula staging com dados pros 4 relatórios
//
// Cria:
//   - 1 monthly_closing fake com 3 professores (R1 + R4)
//   - 1 vacation_request aprovada com pagamento auto (R2 + R3 férias inclusas)
//   - 5 classes realizadas em unidade real (R3)
//   - Inclui nomes com acentos (R1, R4) pra testar encoding UTF-8 no PDF
//
// Uso: node scripts/fixture-8.js --project staging [cleanup]
// ═══════════════════════════════════════════════════════════════════════

'use strict';

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

const args = process.argv.slice(2);
const projectArg = args.find(a => a.startsWith('--project='))?.split('=')[1]
  || (args.includes('--project') ? args[args.indexOf('--project') + 1] : null);

if (projectArg !== 'staging') {
  console.error('Uso: node fixture-8.js --project staging [cleanup]');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccount-staging.json'))),
  projectId: 'crosstrainer-comissoes-staging',
});

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const FieldValue = admin.firestore.FieldValue;
const stateFile = path.join(__dirname, '.fixture-8-state.json');
const isCleanup = args.includes('cleanup');

(async () => {
  try {
    if (isCleanup) {
      await doCleanup();
    } else {
      await doSetup();
    }
  } catch (err) {
    console.error('ERRO:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  } finally {
    await admin.app().delete();
  }
})();

async function doSetup() {
  console.log('\n══════ FIXTURE Sprint 8 — Relatórios ══════\n');

  const created = { closingId: null, vacationId: null, classIds: [] };

  // ─── 1) Cria monthly_closings fake (R1 + R4) ────────────────────
  console.log('1) Criando monthly_closing fake com 3 professores...');
  const closingId = 'FIXTURE8_unit-cp_2026-04';
  created.closingId = closingId;
  await db.collection('monthly_closings').doc(closingId).set({
    unitId: 'unit-cp',
    year: 2026, month: 4,
    status: 'fechado',
    closedAt: FieldValue.serverTimestamp(),
    closedBy: 'fixture',
    closedByName: 'Fixture Script',
    totals: {
      classesRealizadas: 24, classesSubstituidas: 2,
      classesCanceladas: 0, classesNaoRealizadas: 0,
      totalHoras: 48, totalValor: 5760.00,
      totalVacationDays: 5, totalVacationValue: 833.33,
      totalGeral: 6593.33,
    },
    teachers: [
      {
        teacherId: 'fixture-prof-1',
        teacherName: 'João Conceição Acentuação',  // acentos pra testar UTF-8
        teacherType: 'efetivo',
        classesCount: 12, totalHoras: 24,
        hourlyRate: 120, effectiveDateUsed: '2026-01-01',
        valorHoras: 2880.00, mealAllowance: 200, transportAllowance: 150,
        otherBenefits: 0, totalOutros: 350,
        valorTotal: 3230.00,
        vacationDaysInMonth: 0, vacationValue: 0, vacationDetails: [],
        isVacationOnly: false,
      },
      {
        teacherId: 'fixture-prof-2',
        teacherName: 'Maria São Pedro Braga',
        teacherType: 'efetivo',
        classesCount: 12, totalHoras: 24,
        hourlyRate: 120, effectiveDateUsed: '2026-01-01',
        valorHoras: 2880.00, mealAllowance: 200, transportAllowance: 150,
        otherBenefits: 0, totalOutros: 350,
        valorTotal: 3230.00,
        vacationDaysInMonth: 5, vacationValue: 833.33, vacationDetails: [],
        isVacationOnly: false,
      },
      {
        teacherId: 'fixture-prof-3',
        teacherName: 'Antônio José Silvério',
        teacherType: 'estagiario',
        classesCount: 0, totalHoras: 0,
        hourlyRate: 0, effectiveDateUsed: null,
        valorHoras: 0, mealAllowance: 0, transportAllowance: 0,
        otherBenefits: 0, totalOutros: 0,
        valorTotal: 0,
        vacationDaysInMonth: 30, vacationValue: 1000.00, vacationDetails: [],
        isVacationOnly: true,
      },
    ],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`   OK ${closingId} (3 profs com acentos: João Conceição, Maria São Pedro, Antônio José)`);

  // ─── 2) Vacation_request aprovada (R2) ──────────────────────────
  console.log('\n2) Criando vacation_request aprovada com pagamento auto...');
  const today = new Date();
  const futureStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30);
  const futureEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 39);
  // Pega 1 teacher real pra associar
  const teacherSnap = await db.collection('teachers').where('isActive', '==', true).limit(1).get();
  if (teacherSnap.empty) throw new Error('Sem teacher ativo pra fixture');
  const realTeacher = { id: teacherSnap.docs[0].id, ...teacherSnap.docs[0].data() };

  const vacRef = db.collection('vacation_requests').doc();
  created.vacationId = vacRef.id;
  await vacRef.set({
    teacherId: realTeacher.id,
    teacherName: realTeacher.name,
    teacherType: realTeacher.type,
    unitId: realTeacher.primaryUnitId || 'unit-cp',
    type: realTeacher.type === 'estagiario' ? 'recesso' : 'ferias',
    periods: [{
      startDate: Timestamp.fromDate(futureStart),
      endDate: Timestamp.fromDate(futureEnd),
      days: 10,
    }],
    totalDays: 10,
    firstPeriodStart: Timestamp.fromDate(futureStart),
    lastPeriodEnd: Timestamp.fromDate(futureEnd),
    reason: 'FIXTURE-8',
    status: 'aprovada',
    requestedAt: FieldValue.serverTimestamp(),
    requestedBy: 'fixture',
    respondedAt: FieldValue.serverTimestamp(),
    respondedBy: 'fixture',
    payment: {
      mode: 'manual',
      value: 1500.00,
      calculation: null,
      notes: 'Fixture sprint 8',
      setBy: 'fixture', setByName: 'Fixture', setAt: FieldValue.serverTimestamp(),
      updatedBy: null, updatedByName: null, updatedAt: null,
    },
    paidInClosingIds: [],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`   OK ${vacRef.id} (${realTeacher.name}, 10 dias, R$ 1500)`);

  // ─── 3) Classes realizadas (R3) ──────────────────────────────────
  console.log('\n3) Criando 5 classes realizadas para R3...');
  const modSnap = await db.collection('modalities').limit(1).get();
  const modalityId = modSnap.empty ? 'mod-default' : modSnap.docs[0].id;
  const modalityName = modSnap.empty ? 'Modalidade Fixture' : modSnap.docs[0].data().name;

  for (let i = 0; i < 5; i++) {
    const classDate = new Date(2026, 3, 5 + i, 3, 0, 0, 0);  // 5-9/04/2026 BR midnight UTC
    const classRef = db.collection('classes').doc();
    created.classIds.push(classRef.id);
    await classRef.set({
      slotId: 'fixture-slot',
      templateId: null,
      unitId: 'unit-cp',
      teacherId: realTeacher.id,
      originalTeacherId: realTeacher.id,
      modalityId,
      scheduledDate: Timestamp.fromDate(classDate),
      startTime: '07:00', endTime: '08:00', durationMinutes: 60,
      status: 'realizada',
      isHoliday: false, holidayName: null, holidayType: null,
      specialScaleType: null, specialScaleId: null,
      cancellationReason: null, cancellationNote: null,
      adjustedBy: null, adjustedAt: null, adjustmentNote: null,
      monthClosingId: null,
      generatedAt: FieldValue.serverTimestamp(),
      generatedBy: 'fixture',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  console.log(`   OK 5 classes em 05-09/04/2026 (${realTeacher.name}, ${modalityName})`);

  fs.writeFileSync(stateFile, JSON.stringify(created, null, 2));
  console.log(`\nEstado salvo em ${stateFile}\n`);

  // ─── Checklist ─────────────────────────────────────────────────
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('  CHECKLIST DE VALIDAÇÃO — Sprint 8 (R1 a R4)');
  console.log('═════════════════════════════════════════════════════════════════\n');
  console.log('🌐 URL: https://crosstrainer-comissoes-staging.web.app/professores.html');
  console.log('Login: abluir@gmail.com (admin)\n');

  console.log('📋 SIDEBAR → "📊 Relatórios" (seção Financeiro)\n');

  console.log('  R1 — Fechamentos Mensais');
  console.log('    Filtros: unidade=unit-cp · ano=2026 · mês=4 (Abril)');
  console.log('    ▶ Excel: 3 linhas (João, Maria, Antônio) com acentos perfeitos · valores em R$');
  console.log('    ▶ PDF: header "CrossTainer ELITE" · tabela com acentos · totais R$\n');

  console.log('  R2 — Saldos de Férias');
  console.log('    Filtros: todos (ou unit-cp)');
  console.log('    ▶ Excel + PDF: tabela com badges/status · prof com vacation criado deve aparecer');
  console.log('    ▶ Lucas Mendes deve seguir VENCIDA (descoberta da Sprint 6c)\n');

  console.log('  R3 — Horas por Professor');
  console.log('    Filtros: período=01/04/2026 a 30/04/2026 · professor=' + realTeacher.name);
  console.log('    ▶ Excel: 2 sheets (Resumo + Detalhamento) · 5 aulas listadas');
  console.log('    ▶ PDF: tabela formatada · valores em R$\n');

  console.log('  R4 — Recibos em Lote');
  console.log('    Filtros: fechamento=FIXTURE8_unit-cp_2026-04 (Abril/2026)');
  console.log('    ▶ PDF único: 3 páginas (1 por prof) · header CrossTainer ELITE em cada');
  console.log('    ▶ ZIP: 3 PDFs (1 por prof) · nomes de arquivo sem acentos quebrados\n');

  console.log('⚠️ ATENÇÃO ESPECIAL aos nomes com acentos:');
  console.log('   "João Conceição Acentuação" / "Maria São Pedro Braga" / "Antônio José Silvério"');
  console.log('   No PDF, acentos NÃO podem virar "?" ou "□". Se virarem → bug de encoding UTF-8.\n');

  console.log('Após validar, rode CLEANUP:');
  console.log('   node scripts/fixture-8.js --project staging cleanup\n');
}

async function doCleanup() {
  if (!fs.existsSync(stateFile)) {
    console.log('Sem arquivo de estado — nada a limpar.');
    return;
  }
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  console.log('\n🧹 Cleanup de fixtures Sprint 8:\n');

  if (state.closingId) {
    await db.collection('monthly_closings').doc(state.closingId).delete();
    console.log(`  OK closing ${state.closingId} removido`);
  }
  if (state.vacationId) {
    await db.collection('vacation_requests').doc(state.vacationId).delete();
    console.log(`  OK vacation ${state.vacationId} removida`);
  }
  for (const cid of state.classIds || []) {
    await db.collection('classes').doc(cid).delete();
    console.log(`  OK class ${cid} removida`);
  }

  fs.unlinkSync(stateFile);
  console.log(`  OK ${stateFile} removido`);
  console.log('\nCleanup completo.\n');
}
