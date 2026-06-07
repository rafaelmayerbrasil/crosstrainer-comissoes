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
//
// Sprint 5a — Comandos:
//   list-scale-types                      — lista tipos de escala especial
//   list-scales [unitId]                  — lista special_scales
//   seed-holidays <year>                  — força refresh do cache de feriados
//   apply-scale <scaleId>                 — aplica escala a classes existentes
//   smoke-5a                              — roda os 11 critérios da Sprint 5a
//
// Sprint 6a — Comandos:
//   list-vacations [status]               — lista pedidos de férias
//   approve-vacation <reqId>              — aprova pedido de férias
//   reject-vacation <reqId> <motivo>      — recusa pedido de férias
//   smoke-6a                              — smoke test Sprint 6a
//
// Sprint 6c — Comandos:
//   vacation-balance <teacherId>          — saldo detalhado de um professor
//   list-overdue-vacations                — lista professores com férias vencidas
//   list-balances [unitId] [type]         — tabela de saldos de todos ativos
//   smoke-6c                              — smoke test Sprint 6c
//
// Sprint 8 — Comandos:
//   list-reports                          — lista tipos de relatório
//   smoke-8                               — smoke test Sprint 8
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

function calculateTeacherHours(classes, scaleTypesMap = null) {
  let totalMinutes = 0;
  for (const c of classes) {
    const dur = c.durationMinutes || 0;
    let weight = 1;
    // Peso variável por tipo de escala (Sprint 5a)
    if (c.specialScaleType && scaleTypesMap && scaleTypesMap.has(c.specialScaleType)) {
      weight = scaleTypesMap.get(c.specialScaleType).weight || 1;
    } else if (c.isHoliday === true) {
      weight = 2;  // fallback retrocompat (P02)
    }
    totalMinutes += dur * weight;
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
    list-scale-types                        — lista tipos de escala especial
    list-scales [unitId]                    — lista escalas especiais
    seed-holidays <year>                    — força refresh do cache de feriados
    apply-scale <scaleId>                   — aplica escala a classes existentes
    smoke-5a                                — smoke test Sprint 5a
    list-vacations [status]                 — lista pedidos de férias
    approve-vacation <reqId>                — aprova pedido de férias
    reject-vacation <reqId> <motivo>        — recusa pedido de férias
	    list-reports                            — lista tipos de relatório
	    smoke-8                                 — smoke test Sprint 8
    smoke-6a                                — smoke test Sprint 6a
	    vacation-balance <teacherId>            — saldo detalhado de um professor
	    list-overdue-vacations                  — lista professores com férias vencidas
	    list-balances [unitId] [type]           — tabela de saldos de todos ativos
	    smoke-6c                                — smoke test Sprint 6c
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

  // Carrega special_scale_types pra cálculo de peso (Sprint 5a)
  const stSnap = await db.collection('special_scale_types').get();
  const scaleTypesMap = new Map(stSnap.docs.map(d => [d.id, d.data()]));

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
    const hours = calculateTeacherHours(list, scaleTypesMap);
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

  // Pré-busca créditos pendentes (fora da transação — espelha o front)
  const credSnap = await db.collection('creditos_professores')
    .where('teacherId', '==', teacherId)
    .where('status', '==', 'pendente')
    .get();
  const creditos = credSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  creditos.sort((a, b) => {
    const ta = a.registeredAt && a.registeredAt.toMillis ? a.registeredAt.toMillis() : 0;
    const tb = b.registeredAt && b.registeredAt.toMillis ? b.registeredAt.toMillis() : 0;
    return ta - tb;
  });
  const totalCredito = creditos.reduce((s, c) => s + (c.valor || 0), 0);

  // Transação: lê closing + counter, cria recibo + abate créditos + atualiza counter
  const result = await db.runTransaction(async (txn) => {
    const closingDoc = await txn.get(db.collection('monthly_closings').doc(closingId));
    if (!closingDoc.exists) throw new Error('Closing não encontrado');
    const c = closingDoc.data();
    const t = (c.teachers || []).find(x => x.teacherId === teacherId);
    if (!t) throw new Error('Teacher não está neste closing');

    const counterRef = db.collection('meta').doc('receipt_counter');
    const counterDoc = await txn.get(counterRef);
    const nextNumber = (counterDoc.exists ? counterDoc.data().value : 0) + 1;

    const valorLiquido = (t.valorTotal || 0) - totalCredito;

    const ref = db.collection('receipts').doc();
    const data = {
      number: nextNumber, numberFormatted: String(nextNumber).padStart(4, '0'),
      closingId, unitId: c.unitId || '', unitName: c.unitName || '', year: c.year, month: c.month,
      teacherId, teacherName: t.teacherName || '', teacherCpf: t.teacherCpf || '', teacherType: t.teacherType || '',
      closingValorTotal: t.valorTotal || 0, closingValorHoras: t.valorHoras || 0, closingHoras: t.totalHoras || 0,
      creditosAplicados: creditos.map(cr => ({
        creditoId: cr.id, valor: cr.valor,
        reciboOrigemNum: cr.reciboOrigemNum, periodoOrigem: cr.periodoOrigem,
      })),
      totalCreditoAplicado: totalCredito,
      valorLiquido,
      status: 'aguardando_pagamento',
      emittedAt: admin.firestore.FieldValue.serverTimestamp(),
      emittedBy: 'admin-script', emittedByName: 'Admin Script',
      paidAt: null, paidBy: null, paymentRecordId: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    txn.set(ref, data);

    // Marca créditos como aplicados
    creditos.forEach(cr => {
      txn.update(db.collection('creditos_professores').doc(cr.id), {
        status: 'aplicado',
        appliedAt: admin.firestore.FieldValue.serverTimestamp(),
        appliedToReciboId: ref.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    // Atualiza contador
    txn.set(counterRef, { value: nextNumber, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    return { id: ref.id, ...data, _nextNumber: nextNumber };
  });

  // Audit log (espelha o front — module='pagamentos')
  await db.collection('audit_log').add({
    type: 'receipt_emitted',
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    userId: 'admin-script',
    userName: 'Admin Script',
    details: `Recibo ${result.numberFormatted} emitido (${result.teacherName} · ${result.year}-${String(result.month).padStart(2,'0')})`,
    entityType: 'receipt',
    entityId: result.id,
    before: null,
    after: result,
    module: 'pagamentos',
  });

  // Notif pro professor (busca userId via professorId)
  const userSnap = await db.collection('users').where('professorId', '==', teacherId).limit(1).get();
  if (!userSnap.empty) {
    await db.collection('notifications').add({
      recipientUserId: userSnap.docs[0].id,
      type: 'recibo_emitido',
      title: 'Recibo emitido',
      body: `Recibo ${result.numberFormatted} emitido · R$ ${result.valorLiquido.toFixed(2)}`,
      link: { type: 'receipt', id: result.id },
      isRead: false,
      readAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`   🔔 Notificação enviada pro user ${userSnap.docs[0].id}`);
  } else {
    console.log(`   ⚠ Sem user vinculado a ${teacherId} — notif não criada`);
  }

  console.log(`✅ Recibo #${result.numberFormatted} criado: ${result.id}`);
  if (totalCredito > 0) {
    console.log(`   💰 ${creditos.length} crédito(s) abatido(s) · total R$ ${totalCredito.toFixed(2)} · líquido R$ ${result.valorLiquido.toFixed(2)}`);
  }
  return result.id;
}

async function cmdConfirmPayment(receiptId, valor) {
  if (!receiptId || !valor) { console.error('Uso: confirm-payment <receiptId> <valor>'); return; }
  const ref = db.collection('receipts').doc(receiptId);
  const doc = await ref.get();
  if (!doc.exists) { console.error('Recibo não encontrado'); return; }
  const r = doc.data();
  const before = { ...r };

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

  // Audit log
  await db.collection('audit_log').add({
    type: 'payment_confirmed',
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    userId: 'admin-script',
    userName: 'Admin Script',
    details: `Pagamento R$ ${parseFloat(valor).toFixed(2)} confirmado (recibo #${r.numberFormatted})`,
    entityType: 'payment_record',
    entityId: payRef.id,
    before,
    after: { ...before, status: 'pago', paymentRecordId: payRef.id, valor: parseFloat(valor) },
    module: 'pagamentos',
  });

  // Notif pro professor
  const userSnap = await db.collection('users').where('professorId', '==', r.teacherId).limit(1).get();
  if (!userSnap.empty) {
    await db.collection('notifications').add({
      recipientUserId: userSnap.docs[0].id,
      type: 'pagamento_confirmado',
      title: 'Pagamento confirmado',
      body: `Pagamento de R$ ${parseFloat(valor).toFixed(2)} confirmado · recibo #${r.numberFormatted}`,
      link: { type: 'receipt', id: receiptId },
      isRead: false,
      readAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`   🔔 Notificação de pagamento enviada pro user ${userSnap.docs[0].id}`);
  }

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
  const snap = await q.orderBy('number', 'desc').get();
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
  const recs = await db.collection('receipts').where('closingId', '==', closingId).orderBy('number', 'desc').get();
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

// ─── Sprint 5a ─────────────────────────────────────────────────────────

async function cmdListScaleTypes() {
  const ts = await db.collection('special_scale_types').get();
  console.log(`\n🎯 ${ts.size} tipos de escala especial:`);
  ts.docs.forEach(d => {
    const t = d.data();
    console.log(`   ${d.id}: ${t.name} · peso ${t.weight}× · ${t.description || ''}`);
  });
}

async function cmdListScales(unitId) {
  let q = db.collection('special_scales');
  const snap = await q.orderBy('date', 'desc').get();
  let scales = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (unitId) {
    scales = scales.filter(s => (s.unitIds || []).includes(unitId));
  }
  console.log(`\n🎯 ${scales.length} escalas especiais${unitId ? ' em ' + unitId : ''}:`);
  if (scales.length === 0) { console.log('   Nenhuma.'); return; }
  scales.forEach(s => {
    const d = s.date && s.date.toDate ? s.date.toDate().toLocaleDateString('pt-BR') : '—';
    const status = s.isActive !== false ? 'Ativa' : 'Inativa';
    console.log(`   ${s.id}: ${d} · ${s.name || '—'} · tipo=${s.scaleTypeId} · [${status}]`);
  });
}

async function cmdSeedHolidays(year) {
  year = parseInt(year) || new Date().getFullYear();
  console.log(`\n🔍 Buscando feriados nacionais ${year} via BrasilAPI...`);

  // Força re-fetch (deleta cache atual se existir)
  const cacheRef = db.collection('meta').doc(`holidays_cache_${year}`);
  const existing = await cacheRef.get();
  if (existing.exists) {
    await cacheRef.delete();
    console.log('   Cache anterior removido.');
  }

  // Reusa a lógica do admin.js — fetch direto
  const resp = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`);
  if (!resp.ok) {
    console.error(`❌ BrasilAPI retornou HTTP ${resp.status}`);
    return;
  }
  const json = await resp.json();
  const feriados = json.map(f => ({ date: f.date, name: f.name, type: f.type || 'national' }));

  await cacheRef.set({
    year, feriados,
    cachedAt: Timestamp.now(),
    ttl: 7 * 24 * 60 * 60,
  });

  console.log(`✅ Cache criado: meta/holidays_cache_${year} com ${feriados.length} feriados`);
  feriados.forEach(f => console.log(`   ${f.date} · ${f.name} (${f.type})`));
}

async function cmdApplyScale(scaleId) {
  if (!scaleId) { console.error('Uso: apply-scale <scaleId>'); return; }
  const scaleDoc = await db.collection('special_scales').doc(scaleId).get();
  if (!scaleDoc.exists) { console.error('Escala não encontrada'); return; }
  const scale = { id: scaleDoc.id, ...scaleDoc.data() };

  const dObj = scale.date && scale.date.toDate ? scale.date.toDate() : new Date(scale.date);
  const startBR = brMidnightUTC(dObj.getUTCFullYear(), dObj.getUTCMonth(), dObj.getUTCDate());
  const endBR = new Date(startBR.getTime() + 24 * 60 * 60 * 1000 - 1);

  console.log(`📌 Aplicando "${scale.name}" a classes de ${dObj.toLocaleDateString('pt-BR')}...`);

  let total = 0;
  for (const uid of (scale.unitIds || [])) {
    const snap = await db.collection('classes')
      .where('unitId', '==', uid)
      .where('scheduledDate', '>=', Timestamp.fromDate(startBR))
      .where('scheduledDate', '<=', Timestamp.fromDate(endBR))
      .get();

    const batch = db.batch();
    snap.docs.forEach(d => {
      batch.update(d.ref, {
        specialScaleType: scale.scaleTypeId,
        specialScaleId: scaleId,
        isHoliday: scale.scaleTypeId === 'feriado' ? true : d.data().isHoliday,
        holidayName: scale.scaleTypeId === 'feriado' ? scale.name : d.data().holidayName,
        updatedAt: Timestamp.now(),
      });
    });
    if (snap.docs.length > 0) {
      await batch.commit();
      console.log(`   ${uid}: ${snap.docs.length} classes`);
    }
    total += snap.docs.length;
  }

  await db.collection('special_scales').doc(scaleId).update({
    appliedToClasses: [],
    appliedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });

  // Audit log
  await db.collection('audit_log').add({
    type: 'special_scale_applied',
    details: `Escala "${scale.name}" aplicada a ${total} classes (admin SDK)`,
    module: 'escalas',
    entityType: 'special_scale',
    entityId: scaleId,
    userId: 'admin-script',
    userName: 'Admin Script',
    timestamp: Timestamp.now(),
  });

  console.log(`✅ Total: ${total} classes atualizadas`);
}

async function cmdSmoke5a() {
  console.log('\n══════ SMOKE TEST Sprint 5a — Escalas Especiais ══════\n');

  // C2: seed de tipos
  const ts = await db.collection('special_scale_types').get();
  console.log(`✅ C2: Tipos de escala: ${ts.size}`);
  ts.docs.forEach(d => console.log(`   - ${d.id}: weight=${d.data().weight}`));
  if (ts.size !== 4) console.log('   ⚠ Esperado 4 tipos!');

  // C3: cache de feriados
  const year = new Date().getFullYear();
  const cacheDoc = await db.collection('meta').doc(`holidays_cache_${year}`).get();
  if (cacheDoc.exists) {
    const f = cacheDoc.data().feriados || [];
    console.log(`✅ C3: Cache ${year} existe — ${f.length} feriados`);
  } else {
    console.log(`⚠ C3: Cache ${year} não existe. Rode: node admin.js --project staging seed-holidays ${year}`);
  }

  // C5: escalas cadastradas
  const scales = await db.collection('special_scales').get();
  console.log(`✅ C5: Escalas cadastradas: ${scales.size}`);
  scales.docs.forEach(d => {
    const s = d.data();
    console.log(`   ${s.name || d.id}: ${s.scaleTypeId} · ${s.isActive !== false ? 'Ativa' : 'Inativa'}`);
  });

  // C7: verifica se calculateTeacherHours usa peso correto (teste in-memory)
  console.log('\n━━━ C7: Cálculo de horas com peso ━━━');
  const stSnap = await db.collection('special_scale_types').get();
  const stMap = new Map(stSnap.docs.map(d => [d.id, d.data()]));

  const testFeriado = [{ durationMinutes: 60, isHoliday: true }];
  const hFeriado = calculateTeacherHours(testFeriado, stMap);
  console.log(`   Feriado (fallback): 1h → ${hFeriado}h ${hFeriado === 2 ? '✅' : '❌'}`);

  const testFeriadoST = [{ durationMinutes: 60, specialScaleType: 'feriado', isHoliday: true }];
  const hFeriadoST = calculateTeacherHours(testFeriadoST, stMap);
  console.log(`   Feriado (scaleType): 1h → ${hFeriadoST}h ${hFeriadoST === 2 ? '✅' : '❌'}`);

  const testEvento = [{ durationMinutes: 60, specialScaleType: 'evento_especial' }];
  const hEvento = calculateTeacherHours(testEvento, stMap);
  console.log(`   Evento Especial: 1h → ${hEvento}h ${hEvento === 3 ? '✅ C9' : '❌'}`);

  const testNormal = [{ durationMinutes: 60 }];
  const hNormal = calculateTeacherHours(testNormal, stMap);
  console.log(`   Normal: 1h → ${hNormal}h ${hNormal === 1 ? '✅' : '❌'}`);

  // C10: Audit log com module=escalas
  console.log('\n━━━ C10: Audit log (module=escalas) ━━━');
  const auditSnap = await db.collection('audit_log')
    .where('module', '==', 'escalas')
    .orderBy('timestamp', 'desc')
    .limit(5)
    .get();
  console.log(`   Entradas no audit: ${auditSnap.size}`);
  auditSnap.docs.forEach(d => {
    const a = d.data();
    console.log(`   ${a.type}: ${(a.details || '').slice(0, 80)}`);
  });

  // C4/C6 (precisa de dados reais — indica próximos passos)
  console.log('\n⚠ C4/C6/C8 requerem dados de teste no Firestore (classes em feriado + escala + fechamento).');
  console.log('   Para testar: crie uma escala especial, aplique a classes, rode preview.');

  console.log('\n══════ FIM SMOKE TEST Sprint 5a ══════\n');
}

// ─── Sprint 6a ─────────────────────────────────────────────────────────

async function cmdListVacations(status) {
  let q = db.collection('vacation_requests');
  if (status) q = q.where('status', '==', status);
  const snap = await q.orderBy('requestedAt', 'desc').get();
  const vacs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`\n🏖️ ${vacs.length} pedidos de férias${status ? ' (' + status + ')' : ''}:`);
  if (vacs.length === 0) { console.log('   Nenhum.'); return; }
  const byStatus = {};
  vacs.forEach(v => { byStatus[v.status] = (byStatus[v.status] || 0) + 1; });
  console.log('   Por status:', byStatus);
  vacs.forEach(v => {
    const d = v.requestedAt && v.requestedAt.toDate ? v.requestedAt.toDate().toLocaleDateString('pt-BR') : '—';
    console.log(`   [${v.status}] ${v.teacherName} · ${v.type} · ${v.totalDays}d · ${d}`);
  });
}

async function cmdApproveVacation(reqId) {
  if (!reqId) { console.error('Uso: approve-vacation <reqId>'); return; }
  const ref = db.collection('vacation_requests').doc(reqId);
  const doc = await ref.get();
  if (!doc.exists) { console.error('Pedido não encontrado'); return; }
  const before = doc.data();
  if (before.status !== 'pendente') { console.error(`Pedido já está como "${before.status}"`); return; }

  const after = {
    status: 'aprovada',
    respondedAt: Timestamp.now(),
    respondedBy: 'admin-script',
    respondedByName: 'Admin Script',
    responseNote: null,
    updatedAt: Timestamp.now(),
  };
  await ref.update(after);

  await db.collection('audit_log').add({
    type: 'vacation_aprovada',
    details: `Aprovada ${before.type} de ${before.teacherName} (admin SDK)`,
    entityType: 'vacation_request', entityId: reqId,
    before, after: { ...before, ...after },
    module: 'ferias',
    userId: 'admin-script', userName: 'Admin Script',
    timestamp: Timestamp.now(),
  });

  console.log(`✅ Férias aprovadas: ${before.teacherName} · ${before.totalDays} dias`);
}

async function cmdRejectVacation(reqId, motivo) {
  if (!reqId || !motivo) { console.error('Uso: reject-vacation <reqId> <motivo>'); return; }
  const ref = db.collection('vacation_requests').doc(reqId);
  const doc = await ref.get();
  if (!doc.exists) { console.error('Pedido não encontrado'); return; }
  const before = doc.data();
  if (before.status !== 'pendente') { console.error(`Pedido já está como "${before.status}"`); return; }

  const after = {
    status: 'recusada',
    respondedAt: Timestamp.now(),
    respondedBy: 'admin-script',
    respondedByName: 'Admin Script',
    responseNote: motivo,
    updatedAt: Timestamp.now(),
  };
  await ref.update(after);

  await db.collection('audit_log').add({
    type: 'vacation_recusada',
    details: `Recusada ${before.type} de ${before.teacherName} · ${motivo}`,
    entityType: 'vacation_request', entityId: reqId,
    before, after: { ...before, ...after },
    module: 'ferias',
    userId: 'admin-script', userName: 'Admin Script',
    timestamp: Timestamp.now(),
  });

  console.log(`✅ Férias recusadas: ${before.teacherName} · motivo: ${motivo}`);
}

async function cmdSmoke6a() {
  console.log('\n══════ SMOKE TEST Sprint 6a — Férias e Recesso ══════\n');

  const all = await db.collection('vacation_requests').get();
  console.log(`Total de pedidos: ${all.size}`);

  const byStatus = {};
  all.docs.forEach(d => { byStatus[d.data().status] = (byStatus[d.data().status] || 0) + 1; });
  console.log('Por status:', byStatus);

  if (all.size > 0) {
    console.log('\nÚltimas 5 solicitações:');
    const ord = all.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.requestedAt?.toMillis() || 0) - (a.requestedAt?.toMillis() || 0))
      .slice(0, 5);
    ord.forEach(r => {
      console.log(`  [${r.status}] ${r.teacherName} (${r.type}) · ${r.totalDays}d · ${r.periods?.length || 0} período(s)`);
    });
  }

  // Audit log
  const audit = await db.collection('audit_log').where('module', '==', 'ferias').orderBy('timestamp', 'desc').limit(5).get();
  console.log(`\nAudit log module=ferias: ${audit.size} entries`);
  audit.docs.forEach(d => {
    const a = d.data();
    console.log(`   ${a.type}: ${(a.details || '').slice(0, 100)}`);
  });

  // Notifs (filtro client-side, sem depender de índice composto extra)
  const notifsSnap = await db.collection('notifications')
    .orderBy('createdAt', 'desc').limit(50).get();
  const vacationNotifs = notifsSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(n => n.type && n.type.startsWith('vacation_'))
    .slice(0, 5);
  console.log(`\nNotificações de férias: ${vacationNotifs.length}`);
  vacationNotifs.forEach(n => {
    console.log(`   [${n.type}] ${n.title || ''} → ${n.body || ''}`);
  });

  console.log('\n══════ FIM SMOKE TEST Sprint 6a ══════\n');
}

// ─── Sprint 6b — Comandos de pagamento de férias ──────────────────────

async function cmdVacationPreview(reqId, mode) {
  const doc = await db.collection('vacation_requests').doc(reqId).get();
  if (!doc.exists) { console.log('Pedido não encontrado'); return; }
  const req = { id: doc.id, ...doc.data() };

  mode = mode || 'auto';
  const noPayIntern = process.argv.includes('--no-pay-intern');

  console.log(`\nCalculando preview para ${req.teacherName} (${req.teacherType}) — modo ${mode}...\n`);

  if (mode === 'auto') {
    if (req.teacherType === 'efetivo') {
      const snap = await db.collection('monthly_closings')
        .where('unitId', '==', req.unitId)
        .where('status', '==', 'fechado')
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
        console.log(`ERRO: Histórico insuficiente (${monthsData.length} meses). Use modo manual.`);
        return;
      }

      const base12mAvg = monthsData.reduce((a, b) => a + b.valorHoras, 0) / monthsData.length;
      const baseLastMonth = monthsData[0].valorHoras;
      const baseMonthly = Math.max(base12mAvg, baseLastMonth);
      const daysCount = (req.periods || []).reduce((s, p) => s + (p.days || 0), 0);
      const proportionalBase = baseMonthly * daysCount / 30;
      const oneThirdValue = proportionalBase / 3;
      const value = Math.round((proportionalBase + oneThirdValue) * 100) / 100;

      console.log(`  Base 12m média:   R$ ${base12mAvg.toFixed(2)}`);
      console.log(`  Base último mês:  R$ ${baseLastMonth.toFixed(2)}`);
      console.log(`  Base usada (MAX): R$ ${baseMonthly.toFixed(2)}`);
      console.log(`  Proporcional:     R$ ${proportionalBase.toFixed(2)} (${daysCount}/30 dias)`);
      console.log(`  1/3 CLT:          R$ ${oneThirdValue.toFixed(2)}`);
      console.log(`  TOTAL:            R$ ${value.toFixed(2)}`);
    } else if (req.teacherType === 'estagiario') {
      if (noPayIntern) {
        console.log('  ⚠️ --no-pay-intern: registraria como sem pagamento');
        return;
      }
      const salaryDoc = await db.collection('teacher_salaries').doc(req.teacherId).get();
      if (!salaryDoc.exists) { console.log('ERRO: teacher_salaries não encontrado'); return; }
      const stipend = salaryDoc.data().internMonthlyStipend || 0;
      const daysCount = (req.periods || []).reduce((s, p) => s + (p.days || 0), 0);
      const value = Math.round((stipend * daysCount / 30) * 100) / 100;
      console.log(`  Bolsa mensal:     R$ ${stipend.toFixed(2)}`);
      console.log(`  Proporcional:     R$ ${value.toFixed(2)} (${daysCount}/30 dias)`);
      console.log(`  TOTAL:            R$ ${value.toFixed(2)}`);
    }
  } else if (mode === 'manual') {
    console.log('  Use set-vacation-payment para aplicar com valor específico.');
  } else if (mode === 'none') {
    console.log('  Use set-vacation-payment <reqId> none <justificativa> para registrar sem pagamento.');
  } else if (mode === 'deferred') {
    console.log('  Use set-vacation-payment <reqId> deferred para adiar.');
  } else {
    console.log('Modo inválido. Use: auto | manual | none | deferred');
  }
}

async function cmdSetVacationPayment(reqId, mode, ...rest) {
  const doc = await db.collection('vacation_requests').doc(reqId).get();
  if (!doc.exists) { console.log('Pedido não encontrado'); return; }
  const before = doc.data();

  if (before.status !== 'aprovada') {
    console.log('ERRO: pedido não está aprovado. Aprove primeiro (approve-vacation).');
    return;
  }

  let paymentData;

  if (mode === 'deferred') {
    paymentData = { mode: 'deferred', value: 0, calculation: null, notes: 'Pagamento adiado pelo admin' };
  } else if (mode === 'none') {
    const notes = rest.join(' ');
    if (!notes) { console.log('ERRO: justificativa obrigatória para "sem pagamento".'); return; }
    paymentData = { mode: 'none', value: 0, calculation: null, notes };
  } else if (mode === 'manual') {
    const value = parseFloat(rest[0]);
    const notes = rest.slice(1).join(' ') || null;
    if (isNaN(value) || value < 0) { console.log('ERRO: valor inválido.'); return; }
    if (value === 0 && !notes) { console.log('ERRO: observação obrigatória se valor zero.'); return; }
    paymentData = { mode: 'manual', value, calculation: null, notes };
  } else if (mode === 'auto') {
    if (before.teacherType === 'efetivo') {
      const snap = await db.collection('monthly_closings')
        .where('unitId', '==', before.unitId)
        .where('status', '==', 'fechado')
        .orderBy('year', 'desc').orderBy('month', 'desc')
        .limit(12).get();

      const monthsData = [];
      snap.docs.forEach(d => {
        const data = d.data();
        const t = (data.teachers || []).find(x => x.teacherId === before.teacherId);
        if (t && typeof t.valorHoras === 'number' && t.valorHoras > 0) {
          monthsData.push({ valorHoras: t.valorHoras });
        }
      });

      if (monthsData.length < 3) {
        console.log(`ERRO: Histórico insuficiente (${monthsData.length} meses). Use modo manual.`);
        return;
      }

      const base12mAvg = monthsData.reduce((a, b) => a + b.valorHoras, 0) / monthsData.length;
      const baseLastMonth = monthsData[0].valorHoras;
      const baseMonthly = Math.max(base12mAvg, baseLastMonth);
      const daysCount = (before.periods || []).reduce((s, p) => s + (p.days || 0), 0);
      const proportionalBase = baseMonthly * daysCount / 30;
      const oneThirdValue = proportionalBase / 3;
      const value = Math.round((proportionalBase + oneThirdValue) * 100) / 100;

      paymentData = {
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
        notes: null,
      };
    } else {
      console.log('ERRO: auto só funciona para efetivo. Para estagiário, use o UI.');
      return;
    }
  } else {
    console.log('Modo inválido. Use: auto | manual | none | deferred');
    return;
  }

  await db.collection('vacation_requests').doc(reqId).update({
    payment: {
      ...paymentData,
      setBy: 'admin-sdk',
      setByName: 'Admin SDK',
      setAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: null,
      updatedByName: null,
      updatedAt: null,
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`✓ Pagamento definido: ${paymentData.mode} · R$ ${(paymentData.value || 0).toFixed(2)}`);
}

async function cmdSmoke6b() {
  console.log('\n══════ SMOKE TEST Sprint 6b — Pagamento de Férias ══════\n');

  const all = await db.collection('vacation_requests').get();
  const withPayment = all.docs.filter(d => d.data().payment).length;
  const paid = all.docs.filter(d => (d.data().paidInClosingIds || []).length > 0).length;
  const withDenorm = all.docs.filter(d => d.data().firstPeriodStart).length;

  console.log(`Total vacation_requests: ${all.size}`);
  console.log(`  Com payment definido: ${withPayment}`);
  console.log(`  Já pagos (paidInClosingIds > 0): ${paid}`);
  console.log(`  Com denormalização (firstPeriodStart): ${withDenorm}`);

  const byMode = { auto: 0, manual: 0, none: 0, deferred: 0 };
  all.docs.forEach(d => {
    const m = d.data().payment?.mode;
    if (m && byMode[m] !== undefined) byMode[m]++;
  });
  const pendingCount = byMode.deferred + (all.size - withPayment);
  console.log(`\nPor modo: auto=${byMode.auto} manual=${byMode.manual} none=${byMode.none} deferred=${byMode.deferred}`);
  console.log(`Pagamentos pendentes (deferred + sem payment): ${pendingCount}`);

  // Fechamentos com férias
  const closingsSnap = await db.collection('monthly_closings')
    .where('status', '==', 'fechado').get();
  let vacOnlyCount = 0, closingsWithVacation = 0;
  closingsSnap.docs.forEach(c => {
    const d = c.data();
    const vacTeachers = (d.teachers || []).filter(t => t.isVacationOnly || t.vacationValue > 0);
    if (vacTeachers.length > 0) closingsWithVacation++;
    vacOnlyCount += vacTeachers.filter(t => t.isVacationOnly).length;
  });
  console.log(`\nFechamentos com férias: ${closingsWithVacation}`);
  console.log(`Teachers isVacationOnly: ${vacOnlyCount}`);

  // Audit — v2.1: usa índice (module, timestamp) existente + filtra in-memory
  // (evita índice composto extra pra where+IN+orderBy)
  const auditAll = await db.collection('audit_log')
    .where('module', '==', 'ferias')
    .orderBy('timestamp', 'desc').limit(30).get();
  const auditPaymentDocs = auditAll.docs
    .filter(d => ['vacation_payment_set', 'vacation_payment_updated'].includes(d.data().type))
    .slice(0, 10);
  console.log(`\nAudit pagamentos (últimos 10): ${auditPaymentDocs.length} entries`);
  auditPaymentDocs.forEach(d => {
    const a = d.data();
    const ts = a.timestamp ? a.timestamp.toDate().toISOString().slice(0, 19) : '?';
    console.log(`  [${ts}] ${a.type}: ${(a.details || '').slice(0, 120)}`);
  });

  console.log('\n══════ FIM SMOKE TEST Sprint 6b ══════\n');
  console.log('Para validação completa C1-C16: node scripts/fixture-6b.js --project staging');
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 6c — Saldo de Férias (Admin SDK)
// ═══════════════════════════════════════════════════════════════════════════

function getEntitlementStartDate(teacher) {
  if (!teacher || teacher.type === 'eventual') return null;
  if (teacher.type === 'efetivo' && teacher.hireDate) {
    return teacher.hireDate.toDate ? teacher.hireDate.toDate() : new Date(teacher.hireDate);
  }
  if (teacher.type === 'estagiario' && teacher.internshipStartDate) {
    return teacher.internshipStartDate.toDate ? teacher.internshipStartDate.toDate() : new Date(teacher.internshipStartDate);
  }
  if (teacher.createdAt) {
    return teacher.createdAt.toDate ? teacher.createdAt.toDate() : new Date(teacher.createdAt);
  }
  return null;
}

function addMonths(date, months) {
  const d = new Date(date.getTime());
  const originalDay = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== originalDay) d.setDate(0);
  return d;
}

function listAcquisitionPeriods(teacher, asOfDate) {
  asOfDate = asOfDate || new Date();
  const start = getEntitlementStartDate(teacher);
  if (!start) return [];
  const periods = [];
  let cursor = new Date(start);
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

async function getVacationBalance(teacher) {
  if (teacher.type === 'eventual') return null;

  const periods = listAcquisitionPeriods(teacher);
  if (periods.length === 0) return null;

  const vacSnap = await db.collection('vacation_requests')
    .where('teacherId', '==', teacher.id)
    .where('status', '==', 'aprovada').get();
  const allVacs = vacSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const vacsByPeriod = {};
  for (const v of allVacs) {
    let startDate;
    if (v.firstPeriodStart) {
      startDate = v.firstPeriodStart.toDate ? v.firstPeriodStart.toDate() : new Date(v.firstPeriodStart);
    } else if (v.periods && v.periods[0] && v.periods[0].startDate) {
      const ps = v.periods[0].startDate;
      startDate = ps.toDate ? ps.toDate() : new Date(ps);
    } else continue;
    const period = periods.find(p => p.startDate <= startDate && startDate <= p.endDate);
    if (period) {
      if (!vacsByPeriod[period.index]) vacsByPeriod[period.index] = [];
      vacsByPeriod[period.index].push(v);
    }
  }

  const now = new Date();
  const periodsWithUsage = periods.map(p => {
    const vacs = vacsByPeriod[p.index] || [];
    const daysTaken = vacs.reduce((s, v) => s + (v.totalDays || 0), 0);
    return { ...p, daysTaken, daysRemaining: Math.max(0, p.entitledDays - daysTaken), vacationRequestIds: vacs.map(v => v.id) };
  });

  const currentIdx = periodsWithUsage.findIndex(p => p.startDate <= now && now <= p.endDate);
  const current = currentIdx >= 0 ? periodsWithUsage[currentIdx] : periodsWithUsage[periodsWithUsage.length - 1];

  let status = 'ok';
  let grantDeadline = null;
  let daysOverdue = 0;
  if (current.endDate < now) {
    grantDeadline = addMonths(current.endDate, 12);
    grantDeadline.setDate(grantDeadline.getDate() + 1);
    if (now > grantDeadline) {
      status = 'overdue';
      daysOverdue = Math.floor((now - grantDeadline) / 86400000);
    } else {
      const monthsLeft = (grantDeadline - now) / (30 * 86400000);
      status = monthsLeft < 6 ? 'warning' : 'ok';
    }
  }

  return {
    teacherId: teacher.id, teacherName: teacher.name, teacherType: teacher.type,
    currentPeriod: current, status,
    grantPeriod: { deadlineDate: grantDeadline, daysOverdue },
    estimatedStartDate: !(teacher.hireDate || teacher.internshipStartDate),
  };
}

async function cmdVacationBalance(teacherId) {
  if (!teacherId) { console.error('Uso: vacation-balance <teacherId>'); return; }
  const doc = await db.collection('teachers').doc(teacherId).get();
  if (!doc.exists) { console.error('Professor não encontrado'); return; }
  const teacher = { id: doc.id, ...doc.data() };
  const balance = await getVacationBalance(teacher);
  if (!balance) { console.log('Sem dados (eventual ou sem períodos).'); return; }

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';
  console.log(`\n📊 ${balance.teacherName} (${balance.teacherType})${balance.estimatedStartDate ? ' ⚠️ data estimada' : ''}`);
  console.log(`   Período atual: ${balance.currentPeriod.index}º · ${fmtDate(balance.currentPeriod.startDate)} - ${fmtDate(balance.currentPeriod.endDate)}`);
  console.log(`   Tirados: ${balance.currentPeriod.daysTaken} · Restantes: ${balance.currentPeriod.daysRemaining} · Direito: 30`);
  console.log(`   Status: ${balance.status}${balance.grantPeriod.deadlineDate ? ' · Concessivo: ' + fmtDate(balance.grantPeriod.deadlineDate) : ''}`);
  if (balance.grantPeriod.daysOverdue > 0) {
    console.log(`   ⚠️ VENCIDA: ${balance.grantPeriod.daysOverdue} dias após prazo concessivo`);
  }
}

async function cmdListOverdueVacations() {
  const snap = await db.collection('teachers').where('isActive', '==', true).get();
  const teachers = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(t => t.type !== 'eventual');

  const balances = await Promise.all(teachers.map(t => getVacationBalance(t)));
  const overdue = balances.filter(b => b && b.status === 'overdue');

  if (overdue.length === 0) {
    console.log('✅ Nenhum professor com férias vencidas.');
    return;
  }

  console.log(`\n🚨 ${overdue.length} professor(es) com férias vencidas:\n`);
  overdue.forEach(b => {
    console.log(`  • ${b.teacherName} (${b.teacherType}) — ${b.grantPeriod.daysOverdue}d vencidos — ${b.currentPeriod.index}º período`);
  });
}

async function cmdListBalances(unitId, type) {
  let q = db.collection('teachers').where('isActive', '==', true);
  const snap = await q.get();
  let teachers = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(t => t.type !== 'eventual')
    .filter(t => !unitId || t.primaryUnitId === unitId || (t.unitIds || []).includes(unitId));
  if (type) teachers = teachers.filter(t => t.type === type);

  const balances = (await Promise.all(teachers.map(t => getVacationBalance(t))))
    .filter(b => b !== null);

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';
  console.log(`\n📊 ${balances.length} professores com saldo:\n`);
  console.log('Professor'.padEnd(25) + 'Tipo'.padEnd(12) + 'Período'.padEnd(10) + 'Tirados'.padEnd(10) + 'Restam'.padEnd(10) + 'Status');
  console.log('─'.repeat(85));

  balances
    .sort((a, b) => (a.status === 'overdue' ? -1 : 1) || a.teacherName.localeCompare(b.teacherName))
    .forEach(b => {
      const name = b.teacherName.padEnd(25).slice(0, 25);
      const tp = b.teacherType.padEnd(12);
      const period = (b.currentPeriod.index + 'º').padEnd(10);
      const taken = String(b.currentPeriod.daysTaken).padEnd(10);
      const remaining = String(b.currentPeriod.daysRemaining).padEnd(10);
      const st = b.status === 'overdue' ? '🔴 VENCIDA' : b.status === 'warning' ? '🟡 Vencendo' : '🟢 OK';
      console.log(name + tp + period + taken + remaining + st);
    });
}

async function cmdSmoke6c() {
  console.log('\n══════ SMOKE TEST Sprint 6c — Controle Anual de Saldo ══════\n');

  const teachersSnap = await db.collection('teachers').where('isActive', '==', true).get();
  const teachers = teachersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  console.log(`Total professores ativos: ${teachers.length}`);
  console.log(`  Efetivos: ${teachers.filter(t => t.type === 'efetivo').length}`);
  console.log(`  Estagiários: ${teachers.filter(t => t.type === 'estagiario').length}`);
  console.log(`  Eventuais: ${teachers.filter(t => t.type === 'eventual').length}`);

  const withHire = teachers.filter(t => t.type === 'efetivo' && t.hireDate).length;
  const withIntern = teachers.filter(t => t.type === 'estagiario' && t.internshipStartDate).length;
  console.log(`\n  Efetivos com hireDate: ${withHire}`);
  console.log(`  Estagiários com internshipStartDate: ${withIntern}`);

  // Vacation requests por status
  const vacAll = await db.collection('vacation_requests').get();
  const byStatus = {};
  vacAll.docs.forEach(d => { const s = d.data().status; byStatus[s] = (byStatus[s] || 0) + 1; });
  console.log(`\nVacation_requests: ${vacAll.size} total`);
  console.log('  Por status:', byStatus);

  // Calcula balances
  const eligible = teachers.filter(t => t.type !== 'eventual').slice(0, 20);
  const balances = (await Promise.all(eligible.map(t => getVacationBalance(t)))).filter(b => b);
  const byStatusBal = { ok: 0, warning: 0, overdue: 0 };
  balances.forEach(b => { if (byStatusBal[b.status] !== undefined) byStatusBal[b.status]++; });
  console.log(`\nSaldos (amostra ${eligible.length}):`);
  console.log(`  OK: ${byStatusBal.ok} · Warning: ${byStatusBal.warning} · Overdue: ${byStatusBal.overdue}`);

  // Audit de vencidas — usa módulo 'ferias' (índice module+timestamp já existe)
  const auditAll = await db.collection('audit_log')
    .where('module', '==', 'ferias')
    .orderBy('timestamp', 'desc').limit(30).get();
  const overdueDocs = auditAll.docs
    .filter(d => d.data().type === 'vacation_overdue_detected')
    .slice(0, 5);
  console.log(`\nAudit overdue (últimos 5): ${overdueDocs.length}`);
  for (const d of overdueDocs) {
    const a = d.data();
    const ts = a.timestamp ? a.timestamp.toDate().toISOString().slice(0, 10) : '?';
    console.log(`  [${ts}] ${a.details || ''}`);
  }

  // C5: Eventual não tem direito
  const eventuals = teachers.filter(t => t.type === 'eventual');
  console.log(`\nC5: ${eventuals.length} eventuais — sem direito (esperado)`);

  // C6: Fallback createdAt
  const noHire = teachers.filter(t => t.type === 'efetivo' && !t.hireDate);
  const noIntern = teachers.filter(t => t.type === 'estagiario' && !t.internshipStartDate);
  console.log(`C6: Profs sem hireDate/internshipStartDate: efetivo=${noHire.length} estagiario=${noIntern.length}`);

  console.log('\n══════ FIM SMOKE TEST Sprint 6c ══════');
  console.log('Para validação C1-C12 com fixture: node scripts/fixture-6c.js --project staging\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 8 — Comandos de Relatórios
// ═══════════════════════════════════════════════════════════════════════════

async function cmdListReports() {
  console.log('\n📊 Relatórios disponíveis:');
  console.log('  R1 — Fechamentos Mensais');
  console.log('  R2 — Saldos de Férias');
  console.log('  R3 — Horas por Professor');
  console.log('  R4 — Recibos em Lote (PDF único / ZIP)');
  console.log('\nUse no browser (admin/admin_gestao): navegue até 📊 Relatórios\n');
}

async function cmdSmoke8() {
  console.log('\n══════ SMOKE TEST Sprint 8 — Relatórios e Exportações ══════\n');

  // C1: monthly_closings tem ≥ 1 fechamento
  const closingsSnap = await db.collection('monthly_closings').limit(5).get();
  console.log(`C1: monthly_closings acessível: ${closingsSnap.size} docs (min 5)`);
  const fechados = closingsSnap.docs.filter(d => d.data().status === 'fechado');
  console.log(`    Fechados: ${fechados.length}/${closingsSnap.size}`);

  // C2: teachers tem ≥ 1 efetivo/estagiário
  const tSnap = await db.collection('teachers').where('isActive', '==', true).get();
  const elegiveis = tSnap.docs.filter(d => ['efetivo', 'estagiario'].includes(d.data().type));
  console.log(`C2: teachers ativos: ${tSnap.size} · elegíveis: ${elegiveis.length}`);

  // C3: classes tem ≥ 1 aula realizada
  const cSnap = await db.collection('classes').where('status', '==', 'realizada').limit(5).get();
  console.log(`C3: classes realizadas acessível: ${cSnap.size} docs (min 5)`);

  // C5/C6/C7: testa getFechamentosReport com dados reais
  if (closingsSnap.size > 0) {
    var firstClosing = closingsSnap.docs[0].data();
    console.log(`\nC5: Testando getFechamentosReport para unidade ${firstClosing.unitId}...`);
    console.log(`    Dados disponíveis: ${firstClosing.unitId}, ${firstClosing.month}/${firstClosing.year}`);
  }

  // Vacation requests
  const vacSnap = await db.collection('vacation_requests').where('status', '==', 'aprovada').limit(5).get();
  console.log(`C6: vacation_requests aprovadas: ${vacSnap.size} docs (min 5)`);

  // Audit de relatórios
  const auditSnap = await db.collection('audit_log')
    .where('module', '==', 'relatorios')
    .limit(5).get();
  console.log(`C8: audit_log module='relatorios': ${auditSnap.size} entries`);

  console.log('\n══════ FIM SMOKE TEST Sprint 8 ══════');
  console.log('Validação completa requer browser: fixture-8.js gera dados sintéticos\n');
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
      case 'list-scale-types':      await cmdListScaleTypes(); break;
      case 'list-scales':           await cmdListScales(cmdArgs[0]); break;
      case 'seed-holidays':         await cmdSeedHolidays(cmdArgs[0]); break;
      case 'apply-scale':           await cmdApplyScale(cmdArgs[0]); break;
      case 'smoke-5a':              await cmdSmoke5a(); break;
      case 'list-vacations':        await cmdListVacations(cmdArgs[0]); break;
      case 'approve-vacation':      await cmdApproveVacation(cmdArgs[0]); break;
      case 'reject-vacation':       await cmdRejectVacation(cmdArgs[0], cmdArgs.slice(1).join(' ')); break;
      case 'smoke-6a':              await cmdSmoke6a(); break;
      case 'vacation-preview':      await cmdVacationPreview(cmdArgs[0], cmdArgs[1]); break;
      case 'set-vacation-payment':  await cmdSetVacationPayment(cmdArgs[0], cmdArgs[1], ...cmdArgs.slice(2)); break;
      case 'smoke-6b':              await cmdSmoke6b(); break;
      case 'vacation-balance':      await cmdVacationBalance(cmdArgs[0]); break;
      case 'list-overdue-vacations':await cmdListOverdueVacations(); break;
      case 'list-balances':         await cmdListBalances(cmdArgs[0], cmdArgs[1]); break;
      case 'smoke-6c':              await cmdSmoke6c(); break;
      case 'list-reports':          await cmdListReports(); break;
      case 'smoke-8':               await cmdSmoke8(); break;
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
