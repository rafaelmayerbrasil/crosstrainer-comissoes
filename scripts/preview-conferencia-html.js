'use strict';
// Roda: node scripts/preview-conferencia-html.js --project production --mes 2026-08
//
// SOMENTE LEITURA. Monta a tela de Conferência do Fechamento com os dados REAIS
// do Firestore e grava um .html pra olhar — sem browser, sem staging.
//
// Não é uma imitação da tela: carrega `professores-fechamento.js` num sandbox e
// chama `renderPreviewContent()`, as mesmas funções que os botões chamam. É a
// forma de ver a tela de verdade antes de qualquer clique humano — o buraco que
// aparece de novo e de novo neste projeto ([[previa-nunca-rodou]]).

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const Folha = require(path.join(raiz, 'closing-payroll.js'));

const args = process.argv.slice(2);
const projeto = args.includes('--project') ? args[args.indexOf('--project') + 1] : null;
const mesArg = args.includes('--mes') ? args[args.indexOf('--mes') + 1] : null;
if (!projeto || !mesArg) {
  console.error('Uso: node scripts/preview-conferencia-html.js --project <staging|production> --mes AAAA-MM');
  process.exit(1);
}
const [ANO, MES] = mesArg.split('-').map(Number);

admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))) });
const db = admin.firestore();

(async () => {
  const inicio = new Date(ANO, MES - 1, 1, 0, 0, 0);
  const fim = new Date(ANO, MES, 0, 23, 59, 59, 999);

  const [unitsSnap, teachSnap, salSnap, stSnap, balSnap, movSnap, subsSnap, vacSnap] = await Promise.all([
    db.collection('units').get(),
    db.collection('teachers').get(),
    db.collection('teacher_salaries').get(),
    db.collection('special_scale_types').get(),
    db.collection('intern_hour_balances').get(),
    db.collection('intern_hour_movements').get(),
    db.collection('substitutions').get(),
    db.collection('vacation_requests').where('status', '==', 'aprovada').get(),
  ]);
  const clsSnap = await db.collection('classes')
    .where('scheduledDate', '>=', inicio).where('scheduledDate', '<=', fim).get();

  const units = new Map(unitsSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
  const teachers = new Map(teachSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
  const salaries = new Map(salSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
  const scaleTypes = new Map(stSnap.docs.map(d => [d.id, d.data()]));
  const classes = clsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const bancos = {};
  balSnap.docs.forEach(d => { bancos[d.id] = { saldo: d.data().saldoHoras || 0, movimento: null, diasAfastado: 0 }; });
  movSnap.docs.forEach(d => {
    const m = d.data();
    if (m.mes !== `${ANO}-${String(MES).padStart(2, '0')}`) return;
    bancos[m.teacherId] = Object.assign(bancos[m.teacherId] || { saldo: 0, diasAfastado: 0 }, { movimento: m });
  });

  const folha = Folha.montarFolha({
    classes, teachers, salaries, scaleTypes, units,
    ano: ANO, mes: MES, ultimoDiaDoMes: fim, bancos,
  });

  // ── o mesmo material de conferência que ClosingService.preview monta ──
  const statusAulas = {};
  classes.forEach(c => { const k = c.status || '(sem status)'; statusAulas[k] = (statusAulas[k] || 0) + 1; });
  const validas = classes.filter(c => Folha.STATUS_QUE_PAGAM.indexOf(c.status) !== -1);
  const ocorrencias = classes.filter(c =>
    c.faltaTipo || c.atrasoMinutos > 0 || c.saidaAntecipadaMinutos > 0 || c.horaExtraMinutos > 0);
  const ferias = vacSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(v =>
    v.firstPeriodStart && v.lastPeriodEnd
    && v.firstPeriodStart.toDate() <= fim && v.lastPeriodEnd.toDate() >= inicio);

  const mapaUn = new Map();
  for (const p of folha.pessoas) {
    for (const u of p.porUnidade) {
      if (!mapaUn.has(u.unitId)) mapaUn.set(u.unitId, { unitId: u.unitId, classesCount: 0, horas: 0, pessoas: 0 });
      const a = mapaUn.get(u.unitId);
      a.classesCount += u.classesCount; a.horas += u.horas; a.pessoas += 1;
    }
  }
  const unidades = [...mapaUn.values()].map(u => ({
    ...u, horas: Math.round(u.horas * 100) / 100,
    unitName: (units.get(u.unitId) || {}).name || u.unitId,
  })).sort((a, b) => b.horas - a.horas);

  const trocasAbertas = subsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(s => s.status === 'pending' || s.status === 'aguardando_gestao')
    .filter(s => { const d = s.classDate && s.classDate.toDate && s.classDate.toDate(); return d && d >= inicio && d <= fim; });

  // ── roda a TELA de verdade ───────────────────────────────────────────
  const noop = () => {};
  let htmlDaTela = '';
  const sandbox = {
    console: { log: noop, warn: noop, error: noop },
    Map, Set, Date, Math, JSON, String, Number, Array, Object, Boolean, RegExp, Promise, Error,
    document: {
      getElementById: (id) => id === 'fechamentoContent'
        ? { set innerHTML(v) { htmlDaTela = v; }, get innerHTML() { return htmlDaTela; } } : null,
      addEventListener: noop,
    },
    // o MESMO fmt de professores-shared.js — um preview com formatação
    // diferente da tela real seria um preview mentiroso
    fmt: v => (typeof v !== 'number' || isNaN(v)) ? '—'
      : 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ajudaBtn: () => '', isStrictAdmin: () => true, canSeeSalary: () => true,
    isAdminGestao: () => true, isSupervisao: () => false, navigateTo: noop, toast: noop,
    AgendaState: { teachersMap: new Map([...teachers.entries()]) },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['substitution-flow.js', 'intern-hour-bank.js', 'closing-payroll.js']) {
    vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8'), sandbox, { filename: f });
  }
  sandbox.SubstitutionFlow = sandbox.window.SubstitutionFlow;
  sandbox.InternHourBank = sandbox.window.InternHourBank;
  sandbox.ClosingPayroll = sandbox.window.ClosingPayroll;
  vm.runInContext(fs.readFileSync(path.join(raiz, 'professores-fechamento.js'), 'utf8'),
    sandbox, { filename: 'professores-fechamento.js' });

  const st = vm.runInContext('FechamentoState', sandbox);
  st.units = [...units.values()];
  st.selectedYear = ANO; st.selectedMonth = MES; st.filtroUnitId = '';
  st.trocasAbertas = trocasAbertas; st.trocasErro = null;
  st.previewData = {
    year: ANO, month: MES,
    teachers: folha.pessoas, totals: folha.totais, isEmpty: folha.pessoas.length === 0,
    conferencia: {
      statusAulas, aulasNoMes: classes.length, aulasQuePagam: validas.length,
      ocorrencias: ocorrencias.length, ferias, unidades,
    },
  };
  vm.runInContext('renderPreviewContent', sandbox)();

  // ── embrulha com o CSS da própria página ─────────────────────────────
  const pagina = fs.readFileSync(path.join(raiz, 'professores.html'), 'utf8');
  const css = (pagina.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
  const saida = path.join(__dirname, '..', 'scratchpad', `conferencia-${mesArg}-${projeto}.html`);
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.writeFileSync(saida, `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conferência do Fechamento — ${mesArg}</title>
<style>${css}</style></head>
<body class="dark"><div class="main" style="padding:20px;max-width:1200px;margin:0 auto;">
  <div class="page-hdr"><h1>💰 Fechamento Mensal</h1>
    <p>Consolidar aulas do mês, calcular valores e congelar período.</p></div>
  <div style="font-size:12px;color:var(--text2);margin-bottom:14px;">
    Tela renderizada fora do navegador com os dados reais de <b>${mesArg}</b> (${projeto}),
    em ${new Date().toLocaleString('pt-BR')}. Botões não funcionam aqui.</div>
  ${htmlDaTela}
</div></body></html>`, 'utf8');

  console.log('\n✅ tela renderizada com dados reais:');
  console.log('   ' + saida);
  console.log(`   ${folha.pessoas.length} pessoas · ${validas.length} aulas · ` +
    `R$ ${folha.totais.totalValor.toFixed(2).replace('.', ',')} · ${trocasAbertas.length} troca(s) em aberto`);
  process.exit(0);
})().catch(e => { console.error('✗', e); process.exit(1); });
