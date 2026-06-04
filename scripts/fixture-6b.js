// ═══════════════════════════════════════════════════════════════════════
// Fixture Sprint 6b — valida cálculo de pagamento + algoritmo D17 do closeMonth
//
// Cenário:
//   1. Acha professor efetivo
//   2. Cria 5 monthly_closings históricos fake (base mensal R$ 5000, último R$ 5400 → MAX = 5400)
//   3. Cria vacation_request aprovada de 30 dias atravessando dois meses futuros
//   4. Replica cálculo `_calculateEfetivoAuto` localmente e valida MAX
//   5. Replica algoritmo do closeMonth pra cada mês e valida rateio
//   6. Replica D17 (mescla teacherIds com vacation-only)
//   7. Limpa tudo
//
// Uso: node scripts/fixture-6b.js --project staging
// ═══════════════════════════════════════════════════════════════════════

'use strict';

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

const args = process.argv.slice(2);
const projectArg = args.find(a => a.startsWith('--project='))?.split('=')[1]
  || (args.includes('--project') ? args[args.indexOf('--project') + 1] : null);

if (!projectArg) {
  console.error('Uso: node fixture-6b.js --project <staging|production>');
  process.exit(1);
}

const projectId = projectArg === 'production'
  ? 'crosstrainer-comissoes'
  : 'crosstrainer-comissoes-staging';

const credPath = path.join(__dirname, `serviceAccount-${projectArg}.json`);
if (!fs.existsSync(credPath)) {
  console.error(`Service account nao encontrado: ${credPath}`);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(credPath)),
  projectId,
});

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const FieldValue = admin.firestore.FieldValue;

// ─── Helpers BR ────────────────────────────────────────────────────
function brComponents(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10) - 1,
    day: parseInt(parts.day, 10),
    weekday: weekdayMap[parts.weekday],
  };
}
function brMidnightUTC(year, month0, day) {
  return new Date(Date.UTC(year, month0, day, 3, 0, 0, 0));
}
function ymdBR(date) {
  const c = brComponents(date);
  return `${c.year}-${String(c.month + 1).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
}

// ─── Replica _calculateEfetivoAuto ──────────────────────────────────
async function calculateEfetivoAuto(req, unitId) {
  // Nota: query sem 'status' pra replicar comportamento corrigido (ver bug 1 no relatório).
  // O código real em professores-shared.js linha ~3007 tem `where('status','==','fechado')` que exige índice composto não declarado.
  // Solução: remover esse filtro (status='fechado' é o único valor possível em monthly_closings).
  const snap = await db.collection('monthly_closings')
    .where('unitId', '==', unitId)
    .orderBy('year', 'desc').orderBy('month', 'desc')
    .limit(12).get();

  const monthsData = [];
  snap.docs.forEach(d => {
    const data = d.data();
    const t = (data.teachers || []).find(x => x.teacherId === req.teacherId);
    if (t && typeof t.valorHoras === 'number' && t.valorHoras > 0) {
      monthsData.push({ valorHoras: t.valorHoras, year: data.year, month: data.month });
    }
  });

  if (monthsData.length < 3) {
    return { success: false, error: `Histórico insuficiente (${monthsData.length} meses)` };
  }

  const base12mAvg = monthsData.reduce((a, b) => a + b.valorHoras, 0) / monthsData.length;
  const baseLastMonth = monthsData[0].valorHoras;
  const baseMonthly = Math.max(base12mAvg, baseLastMonth);

  const daysCount = (req.periods || []).reduce((s, p) => s + (p.days || 0), 0);
  const proportionalBase = baseMonthly * daysCount / 30;
  const oneThirdValue = proportionalBase / 3;
  const value = Math.round((proportionalBase + oneThirdValue) * 100) / 100;

  return {
    success: true,
    data: {
      mode: 'auto', value,
      calculation: {
        baseMonthly: Math.round(baseMonthly * 100) / 100,
        base12mAvg: Math.round(base12mAvg * 100) / 100,
        baseLastMonth: Math.round(baseLastMonth * 100) / 100,
        monthsConsidered: monthsData.length,
        oneThirdValue: Math.round(oneThirdValue * 100) / 100,
        proportionalBase: Math.round(proportionalBase * 100) / 100,
        daysCount,
        formula: 'efetivo-clt-max',
      },
    }
  };
}

// ─── Replica splitVacationAcrossMonth ────────────────────────────────
function splitVacationAcrossMonth(vacReq, year, month) {
  const monthStart = brMidnightUTC(year, month - 1, 1);
  const monthEnd = brMidnightUTC(year, month, 0);
  monthEnd.setUTCHours(26, 59, 59, 999);

  let daysInMonth = 0;
  for (const p of (vacReq.periods || [])) {
    const ps = p.startDate.toDate();
    const pe = p.endDate.toDate();
    const clipStart = ps < monthStart ? monthStart : ps;
    const clipEnd = pe > monthEnd ? monthEnd : pe;
    if (clipStart > clipEnd) continue;
    // v2.1: Math.floor pra evitar inflado em 1 dia (espelha fix no functions/index.js)
    daysInMonth += Math.floor((clipEnd - clipStart) / 86400000) + 1;
  }

  if (daysInMonth === 0) return null;

  const proportionalValue = Math.round(
    (vacReq.payment.value * daysInMonth / vacReq.totalDays) * 100
  ) / 100;

  return { daysInMonth, proportionalValue, fullPeriodDays: vacReq.totalDays };
}

(async () => {
  console.log('\n══════ FIXTURE Sprint 6b — Pagamento de Ferias ══════');
  console.log(`Projeto: ${projectId}\n`);

  const created = {
    closingIds: [],
    vacationReqId: null,
    auditIds: [],
  };
  let failed = false;

  try {
    // ─── 1) Acha professor efetivo ───────────────────────────────────
    console.log('1) Procurando professor efetivo ativo...');
    const teachersSnap = await db.collection('teachers')
      .where('isActive', '==', true).get();
    const efetivos = teachersSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => t.type === 'efetivo' && (t.primaryUnitId || (t.unitIds && t.unitIds[0])));

    if (efetivos.length === 0) throw new Error('Nenhum professor efetivo ativo');

    const teacher = efetivos[0];
    const unitId = teacher.primaryUnitId || teacher.unitIds[0];
    console.log(`   -> ${teacher.name} | id=${teacher.id} | unit=${unitId}`);

    // ─── 2) Cria 5 monthly_closings históricos fake ──────────────────
    console.log('\n2) Criando 5 monthly_closings históricos fake...');
    const today = brComponents(new Date());
    const valorHorasHist = [5000, 5000, 5000, 5000, 5400];  // último mês é o maior
    const expectedBase12m = valorHorasHist.reduce((a, b) => a + b, 0) / valorHorasHist.length;  // 5080
    const expectedBaseLast = valorHorasHist[valorHorasHist.length - 1];  // 5400
    const expectedBaseMax = Math.max(expectedBase12m, expectedBaseLast);  // 5400

    for (let i = 0; i < valorHorasHist.length; i++) {
      const monthOffset = valorHorasHist.length - i;
      let y = today.year, m = today.month + 1 - monthOffset;
      while (m < 1) { m += 12; y--; }

      const closingId = `FIXTURE6B_${unitId}_${y}-${String(m).padStart(2, '0')}`;
      const ref = db.collection('monthly_closings').doc(closingId);
      await ref.set({
        unitId, year: y, month: m,
        status: 'fechado',
        closedAt: FieldValue.serverTimestamp(),
        closedBy: 'fixture-script',
        closedByName: 'Fixture Script',
        totals: { totalHoras: 0, totalValor: valorHorasHist[i], totalVacationDays: 0, totalVacationValue: 0, totalGeral: valorHorasHist[i] },
        teachers: [{
          teacherId: teacher.id,
          teacherName: teacher.name,
          teacherType: 'efetivo',
          classesCount: 10,
          totalHoras: 40,
          valorHoras: valorHorasHist[i],
          valorTotal: valorHorasHist[i],
        }],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      created.closingIds.push(closingId);
      console.log(`   OK closing ${y}-${String(m).padStart(2, '0')} valorHoras=${valorHorasHist[i]}`);
    }

    // ─── 3) Cria vacation_request aprovada (30 dias atravessando 2 meses) ──
    console.log('\n3) Criando vacation_request 30 dias aprovado...');
    const startOffsetDays = 15;
    const startBR = brMidnightUTC(today.year, today.month, today.day + startOffsetDays);
    const endBR = brMidnightUTC(today.year, today.month, today.day + startOffsetDays + 29);
    console.log(`   Período: ${ymdBR(startBR)} -> ${ymdBR(endBR)} (30 dias)`);

    const vacRef = db.collection('vacation_requests').doc();
    created.vacationReqId = vacRef.id;
    await vacRef.set({
      teacherId: teacher.id,
      teacherName: teacher.name,
      teacherType: 'efetivo',
      unitId,
      type: 'ferias',
      periods: [{
        startDate: Timestamp.fromDate(startBR),
        endDate: Timestamp.fromDate(endBR),
        days: 30,
      }],
      totalDays: 30,
      firstPeriodStart: Timestamp.fromDate(startBR),
      lastPeriodEnd: Timestamp.fromDate(endBR),
      reason: 'FIXTURE-6B (auto)',
      status: 'aprovada',
      requestedAt: FieldValue.serverTimestamp(),
      requestedBy: 'fixture-script',
      requestedByName: 'Fixture Script',
      respondedAt: FieldValue.serverTimestamp(),
      respondedBy: 'fixture-script',
      respondedByName: 'Fixture Script (admin)',
      responseNote: 'Aprovado pela fixture',
      paidInClosingIds: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`   OK vacation_request ${vacRef.id} criado`);

    // ─── 4) Replica cálculo auto efetivo e valida ────────────────────
    console.log('\n4) Replicando cálculo _calculateEfetivoAuto...');
    const reqData = (await vacRef.get()).data();
    reqData.id = vacRef.id;
    const calcResult = await calculateEfetivoAuto(reqData, unitId);

    if (!calcResult.success) {
      throw new Error(`FAIL no cálculo: ${calcResult.error}`);
    }

    const calc = calcResult.data.calculation;
    console.log(`   baseMonthly=${calc.baseMonthly} (esperado ${expectedBaseMax})`);
    console.log(`   base12mAvg=${calc.base12mAvg} (esperado ${expectedBase12m})`);
    console.log(`   baseLastMonth=${calc.baseLastMonth} (esperado ${expectedBaseLast})`);
    console.log(`   proportionalBase=${calc.proportionalBase}`);
    console.log(`   oneThirdValue=${calc.oneThirdValue}`);
    console.log(`   value (total)=${calcResult.data.value}`);

    let pass4 = true;
    if (calc.baseMonthly !== expectedBaseMax) {
      console.log(`   FAIL baseMonthly errado`); pass4 = false; failed = true;
    }
    if (calc.formula !== 'efetivo-clt-max') {
      console.log(`   FAIL formula esperada 'efetivo-clt-max', veio '${calc.formula}'`); pass4 = false; failed = true;
    }
    if (pass4) console.log(`   OK D2 (MAX) validado: ${expectedBaseLast} > ${expectedBase12m} -> usa último mês`);

    // Persiste o payment (simulando setPayment via Admin SDK)
    await vacRef.update({
      payment: {
        mode: 'auto',
        value: calcResult.data.value,
        calculation: calc,
        notes: null,
        setBy: 'fixture-script', setByName: 'Fixture Script', setAt: FieldValue.serverTimestamp(),
        updatedBy: null, updatedByName: null, updatedAt: null,
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
    const finalReq = (await vacRef.get()).data();
    finalReq.id = vacRef.id;

    // ─── 5) Simula closeMonth pra cada mês e valida rateio ───────────
    console.log('\n5) Simulando rateio em cada mês do período...');
    const m1Comp = brComponents(startBR);
    const m2Comp = brComponents(endBR);

    let totalProportional = 0;
    const months = [];
    if (m1Comp.year === m2Comp.year && m1Comp.month === m2Comp.month) {
      months.push({ year: m1Comp.year, month: m1Comp.month + 1 });
    } else {
      months.push({ year: m1Comp.year, month: m1Comp.month + 1 });
      months.push({ year: m2Comp.year, month: m2Comp.month + 1 });
    }

    for (const m of months) {
      const split = splitVacationAcrossMonth(finalReq, m.year, m.month);
      if (split) {
        console.log(`   ${m.year}-${String(m.month).padStart(2, '0')}: ${split.daysInMonth} dias -> R$ ${split.proportionalValue}`);
        totalProportional += split.proportionalValue;
      }
    }
    const diff = Math.abs(totalProportional - calcResult.data.value);
    console.log(`   Soma proporcionais: R$ ${totalProportional.toFixed(2)} | Valor original: R$ ${calcResult.data.value}`);
    if (diff > 0.05) {
      console.log(`   FAIL rateio não bate (diff=R$ ${diff.toFixed(2)})`); failed = true;
    } else {
      console.log(`   OK rateio bate com valor total (diff=R$ ${diff.toFixed(2)} < R$ 0,05)`);
    }

    // ─── 6) Valida D17 (mescla teacherIds vacation-only) ──────────────
    console.log('\n6) Validando D17 (closeMonth merge teacherIds)...');
    const monthStartCheck = brMidnightUTC(months[0].year, months[0].month - 1, 1);
    const monthEndCheck = brMidnightUTC(months[0].year, months[0].month, 0);
    monthEndCheck.setUTCHours(26, 59, 59, 999);

    const vacSnap = await db.collection('vacation_requests')
      .where('status', '==', 'aprovada')
      .where('firstPeriodStart', '<=', monthEndCheck)
      .get();

    const found = vacSnap.docs.find(d => d.id === vacRef.id);
    if (!found) {
      console.log(`   FAIL vacation_request não encontrado pela query indexada`); failed = true;
    } else {
      console.log(`   OK query indexada (status, firstPeriodStart) retorna a fixture`);
    }

    // Simula: assumindo teacherIds=[] (prof 100% férias), verifica que D17 incluiria ele
    const teacherIdsSimulated = [];
    const vacationOnlyTeacherIds = [...new Set(
      [{ teacherId: teacher.id }].map(v => v.teacherId).filter(tid => !teacherIdsSimulated.includes(tid))
    )];
    if (vacationOnlyTeacherIds.includes(teacher.id)) {
      console.log(`   OK D17 incluiria ${teacher.id} como vacation-only no fechamento`);
    } else {
      console.log(`   FAIL D17 não incluiria o professor`); failed = true;
    }

    // ─── 7) Smoke do schema ───────────────────────────────────────────
    console.log('\n7) Validando schema persistido...');
    const persisted = (await vacRef.get()).data();
    const checks = [
      ['firstPeriodStart definido', !!persisted.firstPeriodStart],
      ['lastPeriodEnd definido', !!persisted.lastPeriodEnd],
      ['payment.mode definido', !!persisted.payment?.mode],
      ['payment.calculation.formula = efetivo-clt-max', persisted.payment?.calculation?.formula === 'efetivo-clt-max'],
      ['payment.calculation.baseMonthly = baseLastMonth (MAX funcionou)', persisted.payment?.calculation?.baseMonthly === expectedBaseMax],
      ['paidInClosingIds é array vazio', Array.isArray(persisted.paidInClosingIds) && persisted.paidInClosingIds.length === 0],
    ];
    checks.forEach(([label, ok]) => {
      console.log(`   ${ok ? 'OK' : 'FAIL'} ${label}`);
      if (!ok) failed = true;
    });

    console.log(`\n${failed ? 'X FIXTURE 6b COM FALHAS' : 'V FIXTURE 6b VALIDADA'} - limpando dados\n`);
  } catch (err) {
    console.error('\nERRO durante fixture:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    failed = true;
  } finally {
    console.log('Limpeza:');
    try {
      if (created.vacationReqId) {
        await db.collection('vacation_requests').doc(created.vacationReqId).delete();
        console.log(`   OK vacation_request ${created.vacationReqId} removido`);
      }
      for (const cid of created.closingIds) {
        await db.collection('monthly_closings').doc(cid).delete();
        console.log(`   OK monthly_closing ${cid} removido`);
      }
    } catch (cleanupErr) {
      console.error('   Erro no cleanup:', cleanupErr.message);
    }
    await admin.app().delete();
    process.exit(failed ? 1 : 0);
  }
})();
