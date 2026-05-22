// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Script administrativo (Admin SDK)
//
// Uso geral:
//   node scripts/admin.js --project <staging|production> <comando> [args]
//
// Setup (uma vez por ambiente):
//   1. Baixar service account: Firebase Console → Projeto → Configurações
//      → Service accounts → Generate new private key
//   2. Salvar como: scripts/serviceAccount-staging.json (ou -production.json)
//   3. O .gitignore já bloqueia esse arquivo.
//
// Comandos disponíveis:
//   help                                    — lista comandos
//   list-units                              — lista unidades cadastradas
//   list-classes <unitId> <year> <month>    — lista classes de um mês (BR)
//   list-teachers                           — lista todos os professores
//   list-closings <unitId>                  — lista monthly_closings de uma unidade
//   preview <unitId> <year> <month>         — calcula preview do fechamento (sem gravar)
//   smoke-4a <unitId> <year> <month>        — roda os critérios automatizáveis da Sprint 4a
//   check-frozen <unitId> <year> <month>    — verifica se classes do mês foram congeladas
//
// Sprint 4b — Comandos:
//   list-closing-teachers <closingId>   — lista profs de um closing
//   emit-receipt <closingId> <teacherId>— emite recibo via admin SDK
//   confirm-payment <receiptId> <valor> — confirma pagamento
//   register-credit <tId> <nome> <valor> <motivo> — registra crédito
//   list-receipts [unitId] [year] [month] — lista recibos
//   smoke-4b <closingId>                — smoke test Sprint 4b
//
// Sprint 4a — Smoke test:
//   Cobertos por este script: critérios 3, 4, 5, 6, 7, 10
//   Não cobertos (precisam UI ou auth de user): 1, 2, 8, 9
// ═══════════════════════════════════════════════════════════════════════

'use strict';

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

// ─── Parse args ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const projectArg = args.find(a => a.startsWith('--project='))?.split('=')[1]
  || (args.includes('--project') ? args[args.indexOf('--project') + 1] : null);

const positional = args.filter((a, i) => {
  if (a.startsWith('--')) return false;
  // Exclui o valor que vem depois de --project sem =
  if (i > 0 && args[i - 1] === '--project') return false;
  return true;
});

const cmd = positional[0];
const cmdArgs = positional.slice(1);

if (!projectArg) {
  console.error('❌ Faltou --project. Uso: node admin.js --project <staging|production> <comando>');
  process.exit(1);
}

const projectId = projectArg === 'production'
  ? 'crosstrainer-comissoes'
  : 'crosstrainer-comissoes-staging';

const saPath = path.join(__dirname, `serviceAccount-${projectArg}.json`);
if (!fs.existsSync(saPath)) {
  console.error(`❌ Service account não encontrado: ${saPath}`);
  console.error(`   Baixe do Firebase Console (projeto ${projectId}):`);
  console.error(`   Configurações → Service accounts → Generate new private key`);
  console.error(`   Salve como: ${saPath}`);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(saPath)),
  projectId,
});

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

// ─── Helpers BR (replicam functions/index.js) ────────────────────────
const BR_OFFSET_HOURS = 3;

function brMidnightUTC(year, month, day) {
  // month: 0-11 (estilo JS Date)
  return new Date(Date.UTC(year, month, day, BR_OFFSET_HOURS, 0, 0));
}

function brEndOfMonthUTC(year, month) {
  // Último ms antes da primeira meia-noite BR do próximo mês
  // month: 1-12
  return new Date(brMidnightUTC(year, month, 1).getTime() - 1);
}

function brStartOfMonthUTC(year, month) {
  // month: 1-12
  return brMidnightUTC(year, month - 1, 1);
}

function fmtBRL(v) {
  return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('pt-BR');
}

// ─── Replicação das funções de cálculo (espelha professores-shared.js) ──

function calculateTeacherHours(classes) {
  let totalMinutes = 0;
  for (const c of classes) {
    const dur = c.durationMinutes || 0;
    totalMinutes += (c.isHoliday === true) ? dur * 2 : dur;
  }
  return totalMinutes / 60;
}

function getEffectiveSalaryAt(salary, targetDate) {
  if (!salary) return null;
  const history = salary.salaryHistory || [];
  if (history.length === 0) return salary;
  const targetMs = targetDate.getTime();
  const validEntries = history.filter(e => {
    const ms = e.effectiveDate && e.effectiveDate.toMillis ? e.effectiveDate.toMillis() : 0;
    return ms <= targetMs;
  });
  if (validEntries.length === 0) return salary;
  // Rebobina mudanças com effectiveDate > targetDate (i.e. mais recentes que o alvo)
  const allHistory = [...history].sort((a, b) => {
    const ta = a.effectiveDate?.toMillis() || 0;
    const tb = b.effectiveDate?.toMillis() || 0;
    return tb - ta; // desc
  });
  const result = { ...salary };
  for (const entry of allHistory) {
    const entryMs = entry.effectiveDate?.toMillis() || 0;
    if (entryMs > targetMs && entry.field && entry.previousValue !== undefined) {
      // Rebobinar: aplica previousValue
      result[entry.field] = entry.previousValue;
    }
  }
  return result;
}

function calculateTeacherValue(teacher, salary, hours, lastDayOfMonth) {
  if (!salary) {
    return {
      valorHoras: 0, valorTotal: 0,
      isInternProportional: false,
      internStipendUsed: null,
      internExcessHours: null,
      internExcessValue: null,
      mealAllowance: 0, transportAllowance: 0, totalOutros: 0,
      hourlyRate: 0, effectiveDateUsed: null,
    };
  }
  const effective = getEffectiveSalaryAt(salary, lastDayOfMonth);
  const mealAllowance = effective.mealAllowance || 0;
  const transportAllowance = effective.transportAllowance || 0;
  const totalOutros = (effective.otherBenefits || []).reduce((s, o) => s + (o.valor || 0), 0);

  if (teacher.type === 'estagiario') {
    const limitMinutes = (typeof effective.internMonthlyLimitMinutes === 'number' && effective.internMonthlyLimitMinutes > 0)
      ? effective.internMonthlyLimitMinutes
      : (effective.internMonthlyLimitHours || 0) * 60;
    const limitHours = limitMinutes / 60;
    const stipend = effective.internMonthlyStipend || 0;
    const propRate = effective.internProportionalHourlyRate || 0;
    let valorHoras = stipend;
    let internExcessHours = null;
    let internExcessValue = null;
    let isInternProportional = false;
    if (hours > limitHours && propRate > 0) {
      isInternProportional = true;
      internExcessHours = hours - limitHours;
      internExcessValue = internExcessHours * propRate;
      valorHoras = stipend + internExcessValue;
    }
    return {
      valorHoras,
      valorTotal: valorHoras + mealAllowance + transportAllowance + totalOutros,
      isInternProportional,
      internStipendUsed: stipend,
      internExcessHours,
      internExcessValue,
      mealAllowance, transportAllowance, totalOutros,
      hourlyRate: null,
      effectiveDateUsed: null,
    };
  }
  // Efetivo / eventual
  const rate = effective.hourlyRate || 0;
  const valorHoras = hours * rate;
  return {
    valorHoras,
    valorTotal: valorHoras + mealAllowance + transportAllowance + totalOutros,
    isInternProportional: false,
    internStipendUsed: null,
    internExcessHours: null,
    internExcessValue: null,
    mealAllowance, transportAllowance, totalOutros,
    hourlyRate: rate,
    effectiveDateUsed: null,
  };
}

// ─── Queries reutilizáveis ───────────────────────────────────────────

async function fetchClassesInMonth(unitId, year, month) {
  // year, month: 1-12 em BR
  const start = brStartOfMonthUTC(year, month);
  const end   = brEndOfMonthUTC(year, month);
  const snap = await db.collection('classes')
    .where('unitId', '==', unitId)
    .where('scheduledDate', '>=', Timestamp.fromDate(start))
    .where('scheduledDate', '<=', Timestamp.fromDate(end))
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function fetchTeachersMap() {
  const snap = await db.collection('teachers').get();
  const map = new Map();
  snap.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
  return map;
}

async function fetchSalary(teacherId) {
  const doc = await db.collection('teacher_salaries').doc(teacherId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function fetchUnitsMap() {
  const snap = await db.collection('units').get();
  const map = new Map();
  snap.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
  return map;
}

// ─── Comandos ────────────────────────────────────────────────────────

async function cmdHelp() {
  console.log(`
  Comandos:
    list-units                              — lista unidades
    list-teachers                           — lista professores
    list-classes <unitId> <year> <month>    — lista classes de um mês BR
    list-closings <unitId>                  — lista monthly_closings
    preview <unitId> <year> <month>         — calcula preview do fechamento
    smoke-4a <unitId> <year> <month>        — roda critérios automatizáveis (3,4,5,6,7,10)
    check-frozen <unitId> <year> <month>    — verifica congelamento (critério 8)
    list-closing-teachers <closingId>       — lista profs de um closing
    emit-receipt <closingId> <teacherId>    — emite recibo (admin SDK)
    confirm-payment <receiptId> <valor>     — confirma pagamento
    register-credit <tId> <nome> <valor> <motivo> — registra crédito
    list-receipts [unitId] [year] [month]   — lista recibos
    smoke-4b <closingId>                    — smoke test Sprint 4b
`);
}

async function cmdListUnits() {
  const units = await fetchUnitsMap();
  console.log(`\n📍 ${units.size} unidades:`);
  console.table(Array.from(units.values()).map(u => ({ id: u.id, name: u.name || '—' })));
}

async function cmdListTeachers() {
  const map = await fetchTeachersMap();
  console.log(`\n👥 ${map.size} professores:`);
  console.table(Array.from(map.values()).map(t => ({
    id: t.id,
    name: t.name,
    type: t.type,
    isActive: t.isActive !== false,
  })));
}

async function cmdListClasses(unitId, year, month) {
  if (!unitId || !year || !month) {
    console.error('Uso: list-classes <unitId> <year> <month>'); process.exit(1);
  }
  year = parseInt(year); month = parseInt(month);
  const classes = await fetchClassesInMonth(unitId, year, month);
  console.log(`\n📅 ${classes.length} classes em ${unitId} (${year}-${String(month).padStart(2,'0')} BR)`);
  const byStatus = {};
  classes.forEach(c => { byStatus[c.status] = (byStatus[c.status] || 0) + 1; });
  console.log('Por status:', byStatus);
  console.table(classes.slice(0, 10).map(c => ({
    id: c.id,
    teacherId: c.teacherId,
    scheduledDate: fmtDate(c.scheduledDate),
    startTime: c.startTime,
    durationMin: c.durationMinutes,
    status: c.status,
    isHoliday: c.isHoliday,
    monthClosingId: c.monthClosingId || '—',
  })));
  if (classes.length > 10) console.log(`(+ ${classes.length - 10} mais — total ${classes.length})`);
}

async function cmdListClosings(unitId) {
  if (!unitId) { console.error('Uso: list-closings <unitId>'); process.exit(1); }
  const snap = await db.collection('monthly_closings').where('unitId', '==', unitId).get();
  const closings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (closings.length === 0) {
    console.log(`\n📜 Nenhum fechamento em ${unitId}`);
    return closings;
  }
  closings.sort((a, b) => (b.year * 100 + b.month) - (a.year * 100 + a.month));
  console.log(`\n📜 ${closings.length} fechamentos em ${unitId}:`);
  console.table(closings.map(c => ({
    id: c.id,
    ano_mes: `${c.year}-${String(c.month).padStart(2, '0')}`,
    closedAt: fmtDate(c.closedAt),
    aulas: c.totals?.classesRealizadas || 0,
    horas: (c.totals?.totalHoras || 0).toFixed(2),
    total: fmtBRL(c.totals?.totalValor || 0),
  })));
  return closings;
}

async function cmdPreview(unitId, year, month) {
  if (!unitId || !year || !month) {
    console.error('Uso: preview <unitId> <year> <month>'); process.exit(1);
  }
  year = parseInt(year); month = parseInt(month);

  const classes = await fetchClassesInMonth(unitId, year, month);
  console.log(`\n📊 Preview: ${unitId} / ${year}-${String(month).padStart(2,'0')}`);
  console.log(`   Total classes no mês BR: ${classes.length}`);

  const byStatus = {};
  classes.forEach(c => { byStatus[c.status] = (byStatus[c.status] || 0) + 1; });
  console.log('   Por status:', byStatus);

  const valid = classes.filter(c => c.status === 'realizada' || c.status === 'substituida');
  console.log(`   Entram no fechamento (realizada+substituida): ${valid.length}\n`);

  if (valid.length === 0) {
    console.log('Nenhuma aula válida pra fechar nesse mês.');
    return { teachers: [], totals: {} };
  }

  const teachersMap = await fetchTeachersMap();
  const lastDay = brEndOfMonthUTC(year, month);

  const byTeacher = new Map();
  valid.forEach(c => {
    if (!byTeacher.has(c.teacherId)) byTeacher.set(c.teacherId, []);
    byTeacher.get(c.teacherId).push(c);
  });

  const results = [];
  let grandTotal = 0;
  for (const [teacherId, list] of byTeacher.entries()) {
    const teacher = teachersMap.get(teacherId);
    if (!teacher) {
      console.warn(`   ⚠ teacherId ${teacherId} não encontrado`);
      continue;
    }
    const salary = await fetchSalary(teacherId);
    const hours = calculateTeacherHours(list);
    const value = calculateTeacherValue(teacher, salary, hours, lastDay);

    grandTotal += value.valorTotal;
    results.push({
      teacher: teacher.name,
      type: teacher.type,
      aulas: list.length,
      horas: hours.toFixed(2),
      r_por_h: value.hourlyRate ? fmtBRL(value.hourlyRate) : '—',
      valor_horas: fmtBRL(value.valorHoras),
      vr: fmtBRL(value.mealAllowance),
      vt: fmtBRL(value.transportAllowance),
      outros: fmtBRL(value.totalOutros),
      excedente: value.isInternProportional
        ? `${value.internExcessHours?.toFixed(2)}h × ${fmtBRL(salary?.internProportionalHourlyRate || 0)}`
        : '—',
      total: fmtBRL(value.valorTotal),
    });
  }
  console.table(results);
  console.log(`\n💰 TOTAL DA UNIDADE: ${fmtBRL(grandTotal)}\n`);

  return { teachers: results, totals: { totalValor: grandTotal, classesValidas: valid.length } };
}

async function cmdCheckFrozen(unitId, year, month) {
  if (!unitId || !year || !month) {
    console.error('Uso: check-frozen <unitId> <year> <month>'); process.exit(1);
  }
  year = parseInt(year); month = parseInt(month);
  const closingId = `${unitId}_${year}-${String(month).padStart(2,'0')}`;

  const closing = await db.collection('monthly_closings').doc(closingId).get();
  if (!closing.exists) {
    console.log(`\n❌ Fechamento ${closingId} NÃO existe — mês ainda não foi fechado.`);
    return false;
  }
  console.log(`\n✅ Fechamento ${closingId} existe (criado em ${fmtDate(closing.data().closedAt)})`);

  const classes = await fetchClassesInMonth(unitId, year, month);
  const congeladas = classes.filter(c => c.monthClosingId === closingId);
  const naoCongeladas = classes.filter(c => !c.monthClosingId);
  const outroClosing = classes.filter(c => c.monthClosingId && c.monthClosingId !== closingId);

  console.log(`   Classes do mês BR: ${classes.length}`);
  console.log(`   ✅ Congeladas no closing certo: ${congeladas.length}`);
  console.log(`   ❌ Sem monthClosingId: ${naoCongeladas.length}`);
  if (outroClosing.length > 0) {
    console.log(`   ⚠ Em closing diferente: ${outroClosing.length}`);
    outroClosing.slice(0, 3).forEach(c => console.log(`      ${c.id} → ${c.monthClosingId}`));
  }

  return naoCongeladas.length === 0 && classes.length > 0;
}

async function cmdSmoke4a(unitId, year, month) {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('   SMOKE TEST Sprint 4a — Fechamento Mensal');
  console.log('══════════════════════════════════════════════════════════\n');

  if (!unitId || !year || !month) {
    console.error('Uso: smoke-4a <unitId> <year> <month>'); process.exit(1);
  }
  year = parseInt(year); month = parseInt(month);

  console.log('━━━ Critério 3 — Preview calcula horas ━━━');
  const previewResult = await cmdPreview(unitId, year, month);

  console.log('━━━ Critério 4 — Valor efetivo ━━━');
  const efetivos = previewResult.teachers.filter(t => t.type === 'efetivo' || t.type === 'eventual');
  if (efetivos.length > 0) {
    console.log(`   ${efetivos.length} efetivo/eventual encontrados.`);
    efetivos.forEach(t => {
      console.log(`   → ${t.teacher}: ${t.horas}h × ${t.r_por_h} + VR ${t.vr} + VT ${t.vt} + Outros ${t.outros} = ${t.total}`);
    });
  } else {
    console.log('   ⚠ Nenhum professor efetivo/eventual no mês.');
  }

  console.log('\n━━━ Critério 5/6 — Estagiário (com e sem excedente) ━━━');
  const estagios = previewResult.teachers.filter(t => t.type === 'estagiario');
  if (estagios.length > 0) {
    console.log(`   ${estagios.length} estagiário(s) encontrados.`);
    estagios.forEach(t => {
      const proporcional = t.excedente !== '—';
      console.log(`   → ${t.teacher} (${proporcional ? 'COM' : 'SEM'} excedente): ${t.horas}h · valor ${t.valor_horas} · total ${t.total}`);
      if (proporcional) console.log(`     Excedente: ${t.excedente}`);
    });
  } else {
    console.log('   ⚠ Nenhum estagiário no mês. Critérios 5 e 6 não testáveis com dados atuais.');
  }

  console.log('\n━━━ Critério 7 — Status filtrados ━━━');
  const allClasses = await fetchClassesInMonth(unitId, year, month);
  const byStatus = {};
  allClasses.forEach(c => { byStatus[c.status] = (byStatus[c.status] || 0) + 1; });
  console.log('   Distribuição:', byStatus);
  const filtrados = (byStatus.cancelada || 0) + (byStatus.nao_realizada || 0) + (byStatus.prevista || 0);
  console.log(`   Filtrados (não entram no fechamento): ${filtrados}`);
  console.log(`   Validos (entram): ${(byStatus.realizada || 0) + (byStatus.substituida || 0)}`);

  console.log('\n━━━ Critério 10 — Histórico ━━━');
  await cmdListClosings(unitId);

  console.log('\n━━━ Critério 8 — Verificação de congelamento ━━━');
  await cmdCheckFrozen(unitId, year, month);

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('Não automatizados (precisam UI ou auth de user):');
  console.log('  ❓ 1 — sidebar mostra "💰 Fechamento"');
  console.log('  ❓ 2 — não aparece pra professor/supervisor');
  console.log('  ❓ 9 — idempotência (precisa chamar closeMonth 2× via callable)');
  console.log('══════════════════════════════════════════════════════════\n');
}

// ─── Sprint 4b ─────────────────────────────────────────────────────────

async function cmdListClosingTeachers(closingId) {
  if (!closingId) { console.error('Uso: list-closing-teachers <closingId>'); return; }
  const doc = await db.collection('monthly_closings').doc(closingId).get();
  if (!doc.exists) { console.error('Closing não encontrado'); return; }
  const c = doc.data();
  console.log(`\n${c.unitName || c.unitId} · ${c.month}/${c.year} · status: ${c.status}`);
  console.log(`Teachers (${(c.teachers || []).length}):`);
  (c.teachers || []).forEach(t => {
    console.log(`  ${t.teacherName} (${t.teacherType}) — ${(t.totalHoras||0).toFixed(1)}h · R$ ${(t.valorTotal||0).toFixed(2)}`);
  });
}

async function cmdEmitReceipt(closingId, teacherId) {
  if (!closingId || !teacherId) { console.error('Uso: emit-receipt <closingId> <teacherId>'); return; }
  console.log(`Emitindo recibo para teacherId=${teacherId} no closing ${closingId}...`);

  const counterRef = db.collection('meta').doc('receipt_counter');
  const counterDoc = await counterRef.get();
  const nextNumber = (counterDoc.exists ? counterDoc.data().value : 0) + 1;

  const closingDoc = await db.collection('monthly_closings').doc(closingId).get();
  if (!closingDoc.exists) { console.error('Closing não encontrado'); return; }
  const c = closingDoc.data();
  const t = (c.teachers || []).find(x => x.teacherId === teacherId);
  if (!t) { console.error('Teacher não encontrado no closing'); return; }

  const ref = db.collection('receipts').doc();
  const data = {
    number: nextNumber, numberFormatted: String(nextNumber).padStart(4, '0'),
    closingId, unitId: c.unitId || '', unitName: c.unitName || '', year: c.year, month: c.month,
    teacherId, teacherName: t.teacherName || '', teacherCpf: t.teacherCpf || '', teacherType: t.teacherType || '',
    closingValorTotal: t.valorTotal || 0, closingValorHoras: t.valorHoras || 0, closingHoras: t.totalHoras || 0,
    creditosAplicados: [], totalCreditoAplicado: 0, valorLiquido: t.valorTotal || 0,
    status: 'aguardando_pagamento',
    emittedAt: admin.firestore.FieldValue.serverTimestamp(),
    emittedBy: 'admin-script', emittedByName: 'Admin Script',
    paidAt: null, paidBy: null, paymentRecordId: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await ref.set(data);
  await counterRef.set({ value: nextNumber, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  console.log(`✅ Recibo #${String(nextNumber).padStart(4,'0')} criado: ${ref.id}`);
  return ref.id;
}

async function cmdConfirmPayment(receiptId, valor) {
  if (!receiptId || !valor) { console.error('Uso: confirm-payment <receiptId> <valor>'); return; }
  const ref = db.collection('receipts').doc(receiptId);
  const doc = await ref.get();
  if (!doc.exists) { console.error('Recibo não encontrado'); return; }
  const r = doc.data();

  const payRef = db.collection('payment_records').doc();
  await payRef.set({
    receiptId, receiptNumber: r.number, closingId: r.closingId,
    teacherId: r.teacherId, teacherName: r.teacherName, unitId: r.unitId,
    valor: parseFloat(valor), metodo: 'script', obs: 'smoke test',
    paidAt: admin.firestore.FieldValue.serverTimestamp(),
    paidBy: 'admin-script', paidByName: 'Admin Script',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await ref.update({
    status: 'pago', paidAt: admin.firestore.FieldValue.serverTimestamp(),
    paidBy: 'admin-script', paymentRecordId: payRef.id,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✅ Pagamento confirmado: ${payRef.id} · R$ ${parseFloat(valor).toFixed(2)}`);
}

async function cmdRegisterCredit(teacherId, teacherName, valor, motivo) {
  if (!teacherId || !valor) { console.error('Uso: register-credit <teacherId> <teacherName> <valor> <motivo>'); return; }
  const ref = db.collection('creditos_professores').doc();
  await ref.set({
    teacherId, teacherName: teacherName || '', valor: parseFloat(valor), motivo: motivo || '',
    reciboOrigemId: null, reciboOrigemNum: null, periodoOrigem: '',
    status: 'pendente', appliedAt: null, appliedToReciboId: null,
    registeredAt: admin.firestore.FieldValue.serverTimestamp(),
    registeredBy: 'admin-script',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✅ Crédito registrado: ${ref.id} · ${teacherName} · R$ ${parseFloat(valor).toFixed(2)}`);
}

async function cmdListReceipts(unitId, year, month) {
  let q = db.collection('receipts');
  if (year) q = q.where('year', '==', parseInt(year));
  if (month) q = q.where('month', '==', parseInt(month));
  const snap = await q.orderBy('number', 'asc').get();
  const recibos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(r => !unitId || r.unitId === unitId);
  console.log(`\nRecibos (${recibos.length}):`);
  recibos.forEach(r => {
    console.log(`  #${r.numberFormatted} ${r.teacherName} · ${r.unitName} ${r.month}/${r.year} · R$ ${(r.valorLiquido||0).toFixed(2)} [${r.status}]`);
  });
}

async function cmdSmoke4b(closingId) {
  if (!closingId) { console.error('Uso: smoke-4b <closingId>'); return; }
  console.log('\n══════ SMOKE TEST Sprint 4b ══════\n');

  // C1: Ver closing
  const closing = await db.collection('monthly_closings').doc(closingId).get();
  if (!closing.exists) { console.error('❌ C1: Closing não encontrado'); return; }
  console.log('✅ C1: Closing existe');
  const c = closing.data();
  const teachers = c.teachers || [];
  console.log(`   Unidade: ${c.unitName || c.unitId} · ${c.month}/${c.year} · ${teachers.length} professores`);

  // C2-C3: Lista recibos
  const recs = await db.collection('receipts').where('closingId', '==', closingId).orderBy('number', 'asc').get();
  console.log(`✅ C2-C3: Recibos deste closing: ${recs.size}`);
  recs.docs.forEach(d => {
    const r = d.data();
    console.log(`   #${r.numberFormatted} ${r.teacherName} · R$ ${(r.valorLiquido||0).toFixed(2)} [${r.status}]`);
  });

  // C4: Contador
  const counter = await db.collection('meta').doc('receipt_counter').get();
  console.log(`✅ C4: Contador sequencial: ${counter.exists ? counter.data().value : 'não inicializado'}`);

  // C5: Créditos pendentes
  const creds = await db.collection('creditos_professores').where('status', '==', 'pendente').get();
  console.log(`✅ C5: Créditos pendentes (geral): ${creds.size}`);
  creds.docs.forEach(d => {
    const cr = d.data();
    console.log(`   ${cr.teacherName}: R$ ${(cr.valor||0).toFixed(2)} · ${cr.motivo || ''}`);
  });

  // C6: Pagamentos
  const pays = await db.collection('payment_records').where('closingId', '==', closingId).get();
  console.log(`✅ C6: Pagamentos confirmados deste closing: ${pays.size}`);
  pays.docs.forEach(d => {
    const p = d.data();
    console.log(`   ${p.teacherName}: R$ ${(p.valor||0).toFixed(2)} · ${p.metodo || ''}`);
  });

  // C7: Professores sem recibo
  const semRecibo = teachers.filter(t => !recs.docs.some(r => r.data().teacherId === t.teacherId));
  if (semRecibo.length > 0) {
    console.log(`\n📋 Professores sem recibo (${semRecibo.length}):`);
    semRecibo.forEach(t => console.log(`   - ${t.teacherName} (${t.teacherId})`));
  } else {
    console.log('\n✅ C7: Todos professores têm recibo.');
  }

  console.log('\n══════ FIM SMOKE TEST ══════\n');
}

// ─── Dispatch ────────────────────────────────────────────────────────
(async () => {
  try {
    switch (cmd) {
      case 'help':         await cmdHelp(); break;
      case 'list-units':   await cmdListUnits(); break;
      case 'list-teachers':await cmdListTeachers(); break;
      case 'list-classes': await cmdListClasses(...cmdArgs); break;
      case 'list-closings':await cmdListClosings(...cmdArgs); break;
      case 'preview':      await cmdPreview(...cmdArgs); break;
      case 'check-frozen': await cmdCheckFrozen(...cmdArgs); break;
      case 'smoke-4a':              await cmdSmoke4a(...cmdArgs); break;
      case 'list-closing-teachers': await cmdListClosingTeachers(cmdArgs[0]); break;
      case 'emit-receipt':          await cmdEmitReceipt(cmdArgs[0], cmdArgs[1]); break;
      case 'confirm-payment':       await cmdConfirmPayment(cmdArgs[0], parseFloat(cmdArgs[1])); break;
      case 'register-credit':       await cmdRegisterCredit(cmdArgs[0], cmdArgs[1], parseFloat(cmdArgs[2]), cmdArgs[3]); break;
      case 'list-receipts':         await cmdListReceipts(cmdArgs[0], cmdArgs[1], cmdArgs[2]); break;
      case 'smoke-4b':              await cmdSmoke4b(cmdArgs[0]); break;
      default:
        if (cmd) console.error(`❌ Comando desconhecido: ${cmd}`);
        await cmdHelp();
    }
  } catch (err) {
    console.error('❌ Erro:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  } finally {
    await admin.app().delete();
  }
})();
