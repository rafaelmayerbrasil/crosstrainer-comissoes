// ═══════════════════════════════════════════════════════════════════════
// Fixture R3 — Pedro Lima (estagiário SEM cadastro salarial)
//
// Objetivo: validar o caso "—" (noSalaryData) do R3 da Sprint 9.
// Cria 2 classes 'realizada' pro Pedro Lima (98Z7Yk8507FuE2YDh3xa) em
// 03-04/06/2026. Como ele NÃO tem doc em teacher_salaries, o R3 deve
// mostrar a coluna Valor como "—" (não R$ 0,00) + tooltip.
//
// Também serve de prova do fix do typo 'substituicao'→'substituida':
// o Lucas (aulas substituida de maio) deve aparecer junto no mesmo período.
//
// Uso: node scripts/fixture-r3-pedro.js --project staging [cleanup]
// ═══════════════════════════════════════════════════════════════════════

'use strict';

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

const args = process.argv.slice(2);
const projectArg = args.find(a => a.startsWith('--project='))?.split('=')[1]
  || (args.includes('--project') ? args[args.indexOf('--project') + 1] : null);

if (projectArg !== 'staging') {
  console.error('Uso: node fixture-r3-pedro.js --project staging [cleanup]');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccount-staging.json'))),
  projectId: 'crosstrainer-comissoes-staging',
});

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const FieldValue = admin.firestore.FieldValue;
const stateFile = path.join(__dirname, '.fixture-r3-pedro-state.json');
const isCleanup = args.includes('cleanup');

const PEDRO_ID = '98Z7Yk8507FuE2YDh3xa';
const MODALITY_ID = '62tVnkzhphB4SRTsO7M3'; // Pilates

(async () => {
  try {
    if (isCleanup) await doCleanup();
    else await doSetup();
  } catch (err) {
    console.error('ERRO:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  } finally {
    await admin.app().delete();
  }
})();

async function doSetup() {
  console.log('\n══════ FIXTURE R3 — Pedro Lima (sem cadastro salarial) ══════\n');

  // Sanidade: Pedro existe e NÃO tem salário (senão a fixture não testa "—")
  const pedro = await db.collection('teachers').doc(PEDRO_ID).get();
  if (!pedro.exists) throw new Error('Pedro Lima não encontrado — id mudou?');
  const sal = await db.collection('teacher_salaries').doc(PEDRO_ID).get();
  if (sal.exists) {
    console.warn('⚠️  ATENÇÃO: Pedro Lima TEM doc de salário agora — o caso "—" pode não disparar.');
  } else {
    console.log('OK Pedro Lima sem teacher_salaries (caso "—" válido).');
  }

  const created = { classIds: [] };

  // 2 aulas 'realizada' em 03-04/06/2026 ao meio-dia (longe de qualquer
  // boundary de fuso → cai com folga dentro do range padrão do R3).
  for (let i = 0; i < 2; i++) {
    const classDate = new Date(2026, 5, 3 + i, 12, 0, 0, 0); // 03 e 04/06/2026
    const ref = db.collection('classes').doc();
    created.classIds.push(ref.id);
    await ref.set({
      slotId: 'fixture-r3-pedro',
      templateId: null,
      unitId: 'unit-cp',
      teacherId: PEDRO_ID,
      originalTeacherId: PEDRO_ID,
      modalityId: MODALITY_ID,
      scheduledDate: Timestamp.fromDate(classDate),
      startTime: '07:00', endTime: '08:00', durationMinutes: 60,
      status: 'realizada',
      isHoliday: false, holidayName: null, holidayType: null,
      specialScaleType: null, specialScaleId: null,
      cancellationReason: null, cancellationNote: null,
      adjustedBy: null, adjustedAt: null, adjustmentNote: null,
      monthClosingId: null,
      generatedAt: FieldValue.serverTimestamp(),
      generatedBy: 'fixture-r3-pedro',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`OK class ${ref.id} — Pedro Lima · realizada · ${classDate.toLocaleDateString('pt-BR')}`);
  }

  fs.writeFileSync(stateFile, JSON.stringify(created, null, 2));
  console.log(`\nEstado salvo em ${stateFile}`);

  console.log('\n═════════════════════════════════════════════════════════════════');
  console.log('  CHECKLIST — R3 Horas por Professor');
  console.log('═════════════════════════════════════════════════════════════════\n');
  console.log('🌐 https://crosstrainer-comissoes-staging.web.app/professores.html (admin)');
  console.log('📋 Sidebar → 📊 Relatórios → card "Horas por Professor"\n');
  console.log('Filtros: Unidade=Todas · Professor=Todos · 01/05/2026 a 10/06/2026 · Buscar\n');
  console.log('  ✅ Lucas Mendes da Silva · efetivo · 2 aulas · R$ 240,00');
  console.log('       (prova do fix substituicao→substituida — aulas de maio)');
  console.log('  ✅ Pedro Lima · estagiário · 2 aulas · "—" na coluna Valor');
  console.log('       (hover mostra "Cadastro salarial incompleto")');
  console.log('  ✅ Exportar Excel → célula do Pedro = "Sem cadastro" (texto, não 0)\n');
  console.log('Após validar, rode CLEANUP:');
  console.log('  node scripts/fixture-r3-pedro.js --project staging cleanup\n');
}

async function doCleanup() {
  if (!fs.existsSync(stateFile)) {
    console.log('Sem arquivo de estado — nada a limpar.');
    return;
  }
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  console.log('\n🧹 Cleanup fixture R3 — Pedro Lima:\n');
  for (const cid of state.classIds || []) {
    await db.collection('classes').doc(cid).delete();
    console.log(`  OK class ${cid} removida`);
  }
  fs.unlinkSync(stateFile);
  console.log(`  OK ${stateFile} removido\n  Cleanup completo.\n`);
}
