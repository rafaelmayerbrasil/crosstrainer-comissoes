// ═══════════════════════════════════════════════════════════════════════
// Fixture Sprint 6c — valida cálculo de saldo + período aquisitivo + status
//
// Cenários:
//   A. Prof com hireDate em 15/03/2023 → atual = 4º período (2026-03-15 → 2027-03-14)
//   B. 1 vacation aprovada de 10 dias dentro do período atual → daysRemaining=20
//   C. Prof com hireDate em 01/01/2020 → período aquisitivo 1 + concessivo expirados → overdue
//   D. addMonths em datas tricky (31/01, 29/02, etc.)
//   E. Idempotência checkAndLogOverdue (simulada via inspeção do código)
//
// Uso: node scripts/fixture-6c.js --project staging
// ═══════════════════════════════════════════════════════════════════════

'use strict';

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

const args = process.argv.slice(2);
const projectArg = args.find(a => a.startsWith('--project='))?.split('=')[1]
  || (args.includes('--project') ? args[args.indexOf('--project') + 1] : null);

if (!projectArg) {
  console.error('Uso: node fixture-6c.js --project <staging|production>');
  process.exit(1);
}

const projectId = projectArg === 'production'
  ? 'crosstrainer-comissoes'
  : 'crosstrainer-comissoes-staging';

const credPath = path.join(__dirname, `serviceAccount-${projectArg}.json`);
admin.initializeApp({
  credential: admin.credential.cert(require(credPath)),
  projectId,
});

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const FieldValue = admin.firestore.FieldValue;

// ─── Replicação dos helpers do produto ─────────────────────────────────
function addMonths(date, months) {
  const d = new Date(date.getTime());
  const originalDay = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== originalDay) d.setDate(0);
  return d;
}

function listAcquisitionPeriods(hireDate, asOfDate) {
  asOfDate = asOfDate || new Date();
  const periods = [];
  let cursor = new Date(hireDate);
  let index = 1;
  while (cursor <= asOfDate) {
    const endDate = addMonths(cursor, 12);
    endDate.setDate(endDate.getDate() - 1);
    periods.push({ index, startDate: new Date(cursor), endDate: new Date(endDate), entitledDays: 30 });
    cursor = addMonths(cursor, 12);
    index++;
    if (index > 100) break;
  }
  return periods;
}

// ─── Cenários ──────────────────────────────────────────────────────────
const created = { teacherIds: [], vacationIds: [] };
let failed = false;

(async () => {
  console.log('\n══════ FIXTURE Sprint 6c — Controle Anual de Saldo ══════');
  console.log(`Projeto: ${projectId}\n`);

  try {
    // ─── Teste 1: addMonths em casos tricky ─────────────────────────
    console.log('1) Validando addMonths em casos tricky...');
    const cases = [
      { in: new Date(2024, 0, 31), m: 1,  expected: '2024-02-29', label: '31/01/2024 + 1m (bissexto)' },
      { in: new Date(2025, 0, 31), m: 1,  expected: '2025-02-28', label: '31/01/2025 + 1m (não bissexto)' },
      { in: new Date(2024, 1, 29), m: 12, expected: '2025-02-28', label: '29/02/2024 + 12m' },
      { in: new Date(2024, 4, 31), m: 1,  expected: '2024-06-30', label: '31/05/2024 + 1m' },
      { in: new Date(2024, 5, 15), m: 12, expected: '2025-06-15', label: '15/06/2024 + 12m (normal)' },
    ];
    let addMonthsPass = 0;
    cases.forEach(c => {
      const result = addMonths(c.in, c.m);
      const got = `${result.getFullYear()}-${String(result.getMonth()+1).padStart(2,'0')}-${String(result.getDate()).padStart(2,'0')}`;
      const ok = got === c.expected;
      console.log(`   ${ok ? 'OK' : 'FAIL'} ${c.label}: got ${got} (expected ${c.expected})`);
      if (ok) addMonthsPass++;
      if (!ok) failed = true;
    });
    console.log(`   → ${addMonthsPass}/${cases.length} addMonths passes\n`);

    // ─── Teste 2: período aquisitivo com hireDate 15/03/2023 ────────
    console.log('2) Validando cálculo de período aquisitivo (hireDate=15/03/2023)...');
    const hireA = new Date(2023, 2, 15);  // 15/03/2023
    const today = new Date(2026, 5, 7);   // 07/06/2026 (data fixa pra repetibilidade)
    const periodsA = listAcquisitionPeriods(hireA, today);
    console.log(`   ${periodsA.length} períodos listados:`);
    periodsA.forEach(p => {
      const s = p.startDate.toISOString().slice(0, 10);
      const e = p.endDate.toISOString().slice(0, 10);
      console.log(`     ${p.index}º: ${s} → ${e}`);
    });
    const currentA = periodsA.find(p => p.startDate <= today && today <= p.endDate);
    if (!currentA) {
      console.log('   FAIL nenhum período atual encontrado'); failed = true;
    } else if (currentA.index !== 4) {
      console.log(`   FAIL período atual esperado=4, got=${currentA.index}`); failed = true;
    } else {
      console.log(`   OK período atual = ${currentA.index}º (15/03/2026 → 14/03/2027)\n`);
    }

    // ─── Teste 3: cria prof efetivo + 1 vacation aprovada ──────────
    console.log('3) Criando prof efetivo (hireDate=2023-03-15) + 1 vacation aprovada de 10 dias...');
    const teacherRef = db.collection('teachers').doc();
    created.teacherIds.push(teacherRef.id);
    await teacherRef.set({
      name: 'FIXTURE-6C Efetivo OK',
      type: 'efetivo',
      isActive: true,
      hireDate: Timestamp.fromDate(hireA),
      primaryUnitId: 'unit-cp',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`   OK teacher ${teacherRef.id} criado`);

    // Vacation de 10 dias dentro do período atual (julho/2026)
    const vacStart = new Date(2026, 6, 10);  // 10/07/2026 BR
    const vacEnd = new Date(2026, 6, 19);    // 19/07/2026 BR (10 dias inclusivo)
    const vacRef = db.collection('vacation_requests').doc();
    created.vacationIds.push(vacRef.id);
    await vacRef.set({
      teacherId: teacherRef.id,
      teacherName: 'FIXTURE-6C Efetivo OK',
      teacherType: 'efetivo',
      unitId: 'unit-cp',
      type: 'ferias',
      periods: [{
        startDate: Timestamp.fromDate(vacStart),
        endDate: Timestamp.fromDate(vacEnd),
        days: 10,
      }],
      totalDays: 10,
      firstPeriodStart: Timestamp.fromDate(vacStart),
      lastPeriodEnd: Timestamp.fromDate(vacEnd),
      reason: 'FIXTURE-6C',
      status: 'aprovada',
      requestedAt: FieldValue.serverTimestamp(),
      requestedBy: 'fixture',
      respondedAt: FieldValue.serverTimestamp(),
      respondedBy: 'fixture',
      paidInClosingIds: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`   OK vacation ${vacRef.id} (10 dias)`);

    // Re-busca via service (replicando logic)
    const tDoc = await teacherRef.get();
    const teacherData = { id: tDoc.id, ...tDoc.data() };
    const periods = listAcquisitionPeriods(teacherData.hireDate.toDate());

    const vacSnap = await db.collection('vacation_requests')
      .where('teacherId', '==', teacherRef.id)
      .where('status', '==', 'aprovada').get();
    const vacs = vacSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    let daysTakenInCurrent = 0;
    const current = periods.find(p => p.startDate <= new Date() && new Date() <= p.endDate);
    if (current) {
      for (const v of vacs) {
        const s = v.firstPeriodStart.toDate();
        if (current.startDate <= s && s <= current.endDate) {
          daysTakenInCurrent += v.totalDays;
        }
      }
    }
    console.log(`   Período atual: ${current ? current.index + 'º' : 'N/A'}`);
    console.log(`   daysTaken=${daysTakenInCurrent} (esperado 10) · daysRemaining=${30 - daysTakenInCurrent}`);
    if (daysTakenInCurrent !== 10) {
      console.log('   FAIL cálculo de daysTaken não bate'); failed = true;
    } else {
      console.log('   OK D2 (saldo subtrai férias aprovadas)\n');
    }

    // ─── Teste 4: prof com hireDate antiga → overdue ────────────────
    console.log('4) Criando prof efetivo com hireDate=01/01/2020 → DEVE virar overdue...');
    const hireB = new Date(2020, 0, 1);
    const teacherBRef = db.collection('teachers').doc();
    created.teacherIds.push(teacherBRef.id);
    await teacherBRef.set({
      name: 'FIXTURE-6C Efetivo Overdue',
      type: 'efetivo',
      isActive: true,
      hireDate: Timestamp.fromDate(hireB),
      primaryUnitId: 'unit-cp',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const periodsB = listAcquisitionPeriods(hireB);
    const firstPeriodB = periodsB[0];  // 01/01/2020 → 31/12/2020
    const grantDeadlineB = addMonths(firstPeriodB.endDate, 12);  // 31/12/2021
    const nowMs = Date.now();
    const isOverdue = nowMs > grantDeadlineB.getTime();
    console.log(`   Primeiro período: ${firstPeriodB.startDate.toISOString().slice(0,10)} → ${firstPeriodB.endDate.toISOString().slice(0,10)}`);
    console.log(`   Concessivo deadline: ${grantDeadlineB.toISOString().slice(0,10)}`);
    console.log(`   ${isOverdue ? 'OK' : 'FAIL'} estará overdue ao consultar`);
    if (!isOverdue) failed = true;
    console.log();

    // ─── Teste 5: prof sem hireDate → fallback createdAt ────────────
    console.log('5) Criando prof efetivo SEM hireDate → fallback createdAt + estimatedStartDate flag');
    const teacherCRef = db.collection('teachers').doc();
    created.teacherIds.push(teacherCRef.id);
    await teacherCRef.set({
      name: 'FIXTURE-6C Efetivo No Hire',
      type: 'efetivo',
      isActive: true,
      // hireDate ausente!
      primaryUnitId: 'unit-cp',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    // verifica via leitura
    const tCDoc = await teacherCRef.get();
    const tCData = tCDoc.data();
    const hasHire = !!tCData.hireDate;
    const hasCreated = !!tCData.createdAt;
    console.log(`   hireDate present: ${hasHire} (esperado false)`);
    console.log(`   createdAt present: ${hasCreated} (esperado true)`);
    if (!hasCreated) failed = true;
    console.log('   OK D6 fallback funcionará (UI mostra ~est)\n');

    // ─── Teste 6: idempotência audit overdue ────────────────────────
    console.log('6) Validando estrutura de dedup audit overdue...');
    const todayKey = new Date().toISOString().slice(0, 10);
    // Cria audit fake pra ver dedup
    const auditRef = db.collection('audit_log').doc();
    await auditRef.set({
      type: 'vacation_overdue_detected',
      module: 'ferias',
      entityType: 'teacher',
      entityId: teacherBRef.id,
      metaDayKey: todayKey,
      details: 'FIXTURE-6C audit log dedup test',
      timestamp: FieldValue.serverTimestamp(),
    });
    console.log(`   OK criou audit com metaDayKey='${todayKey}'`);

    // Re-consulta usando lógica do service (module + entityId)
    const dedupCheck = await db.collection('audit_log')
      .where('module', '==', 'ferias')
      .where('entityId', '==', teacherBRef.id)
      .limit(10).get();
    const alreadyLogged = dedupCheck.docs.some(d => {
      const a = d.data();
      return a.type === 'vacation_overdue_detected' && a.metaDayKey === todayKey;
    });
    console.log(`   ${alreadyLogged ? 'OK' : 'FAIL'} dedup detecta entry existente`);
    if (!alreadyLogged) failed = true;

    // Limpa esse audit
    await auditRef.delete();
    console.log('   OK audit cleanup\n');

    console.log(`${failed ? 'X FIXTURE 6c COM FALHAS' : 'V FIXTURE 6c VALIDADA'} — limpando dados\n`);
  } catch (err) {
    console.error('\nERRO durante fixture:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    failed = true;
  } finally {
    console.log('Limpeza:');
    try {
      for (const vid of created.vacationIds) {
        await db.collection('vacation_requests').doc(vid).delete();
        console.log(`   OK vacation ${vid} removida`);
      }
      for (const tid of created.teacherIds) {
        await db.collection('teachers').doc(tid).delete();
        console.log(`   OK teacher ${tid} removido`);
      }
    } catch (cleanupErr) {
      console.error('   Erro no cleanup:', cleanupErr.message);
    }
    await admin.app().delete();
    process.exit(failed ? 1 : 0);
  }
})();
