'use strict';
// Roda: node scripts/smoke-vale-transporte-tela.js
process.env.TZ = 'America/Sao_Paulo';
//
// Vale-transporte por dia trabalhado — as TELAS e as ligações.
//
// Este teste RODA o código: o serviço (PayrollVtService + a prévia do
// fechamento) contra um banco falso, a conferência do fechamento com os
// botões de verdade, e o formulário do cadastro salarial. Confere também que
// a Function de fechamento entrega à conta o mesmo material que a tela.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const makeFakeDb = require('./_fake-firestore.js');

const raiz = path.join(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
let n = 0;
const ok = (m) => console.log('✓ ' + (++n) + '. ' + m);
const texto = (html) => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const D = (d) => `2026-09-${String(d).padStart(2, '0')}`;
const uteis = []; for (let d = 1; d <= 30; d++) { const w = new Date(2026, 8, d).getDay(); if (w >= 1 && w <= 5 && d !== 7) uteis.push(d); }

/** Recorta do professores-shared.js um `const Nome = { ... };` de nível zero. */
function recorta(src, nome) {
  const ini = src.indexOf('const ' + nome + ' = {');
  assert.ok(ini !== -1, 'não achei ' + nome);
  const fim = src.indexOf('\n};', ini);
  assert.ok(fim !== -1, 'não achei o fim de ' + nome);
  const trecho = src.slice(ini, fim + 3);
  assert.ok(trecho.length < 60000, nome + ': o recorte ficou grande demais — o fim não foi achado (arquivo em CRLF?)');
  return trecho;
}

async function semear(db) {
  let seq = 0;
  const aula = (tid, dia, extra) => db.collection('classes').doc('c' + (++seq)).set(Object.assign({
    teacherId: tid, originalTeacherId: tid, unitId: 'unit-cp', scheduledDate: new Date(dia + 'T00:00:00'),
    startTime: '07:00', endTime: '08:00', durationMinutes: 60, status: 'realizada' }, extra || {}));
  for (const d of uteis) await aula('edu', D(d));
  await aula('edu', D(5), { specialScaleType: 'sabado' });
  await aula('edu', D(7), { specialScaleType: 'feriado', isHoliday: true });
  for (const d of uteis.slice(0, 17)) await aula('carla', D(d));
  await db.collection('teachers').doc('edu').set({ name: 'EDUARDA SANTOS', type: 'estagiario' });
  await db.collection('teachers').doc('carla').set({ name: 'CARLA FANTI', type: 'efetivo' });
  await db.collection('teacher_salaries').doc('edu').set({ remunerationType: 'bolsa', internMonthlyStipend: 800, internMonthlyLimitHours: 100,
    internProportionalHourlyRate: 10, transportAllowance: 250, vtPorDia: true, vtPassagensPorDia: 2 });
  await db.collection('teacher_salaries').doc('carla').set({ remunerationType: 'hora_aula', hourlyRate: 50, transportAllowance: 150, mealAllowance: 100 });
}

function novoApp(db) {
  const els = new Map();
  const el = (id) => { if (!els.has(id)) els.set(id, { id, innerHTML: '', textContent: '', value: '', style: {}, checked: false, disabled: false, title: '' }); return els.get(id); };
  const st = { toasts: [], confirms: [], prompts: [], respostas: [], audits: [] };
  const noop = () => {};
  const sb = {
    console: { log: noop, warn: noop, error: (...a) => st.toasts.push({ msg: 'console.error ' + a.join(' '), type: 'console' }) },
    Map, Set, Date, Math, JSON, String, Number, Array, Object, Boolean, RegExp, Promise, Error, parseFloat, parseInt, isNaN,
    document: { getElementById: el, addEventListener: noop, querySelectorAll: () => [] },
    db, firebase: { firestore: { FieldValue: { delete: () => ({ __apaga: true }), serverTimestamp: () => 'TS' }, Timestamp: { now: () => ({ toMillis: () => Date.now() }) } } },
    serverTs: () => 'TS', currentUserId: () => 'u_admin', currentUserName: () => 'Admin',
    escapeHtml: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    fmt: (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ','),
    toast: (msg, type) => st.toasts.push({ msg, type }),
    confirm: (m) => { st.confirms.push(m); return true; },
    prompt: (m) => { st.prompts.push(m); return st.respostas.length ? st.respostas.shift() : null; },
    ajudaBtn: () => '', isStrictAdmin: () => true, canSeeSalary: () => true, isAdminGestao: () => true, isSupervisao: () => false, navigateTo: noop,
    AgendaState: { teachersMap: new Map() },
    AuditService: { log: async (o) => { st.audits.push(o.type); } },
    UnitService: { list: async () => ({ success: true, data: [{ id: 'unit-cp', name: 'CrossTainer CP' }] }) },
    InternHourBankService: { getSaldo: async () => ({ success: true, data: { saldoHoras: 0 } }), getMovimento: async () => ({ success: true, data: null }) },
    HourDeclaration: require('../hour-declaration.js'),
    HourDeclarationService: { doMes: async () => [], aulasDoMes: async () => [], tiposDeEscala: async () => new Map() },
    SubstitutionService: { listAbertasNoPeriodo: async () => ({ success: true, data: [] }) },
    ClassService: { listAvisosPendentes: async () => ({ success: true, data: [] }) },
    ClassAvisos: { doMes: () => [] },
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of ['substitution-flow.js', 'intern-hour-bank.js', 'closing-payroll.js']) vm.runInContext(ler(f), sb, { filename: f });
  sb.SubstitutionFlow = sb.window.SubstitutionFlow; sb.InternHourBank = sb.window.InternHourBank; sb.ClosingPayroll = sb.window.ClosingPayroll;
  const shared = ler('professores-shared.js').replace(/\r\n/g, '\n');
  vm.runInContext(recorta(shared, 'PayrollVtService') + '\n' + recorta(shared, 'ClosingService')
    + '\nwindow.PayrollVtService = PayrollVtService; window.ClosingService = ClosingService;', sb, { filename: 'professores-shared.js (recorte)' });
  vm.runInContext(ler('professores-fechamento.js'), sb, { filename: 'professores-fechamento.js' });
  return { sb, st, el };
}

(async () => {
  const db = makeFakeDb();
  await semear(db);
  const app = novoApp(db);
  const { sb, st } = app;
  const estado = () => vm.runInContext('FechamentoState', sb);
  const previa = async () => { const r = await sb.ClosingService.preview(2026, 9); assert.ok(r.success, 'a prévia falhou: ' + r.error); return r.data; };
  const linha = (data, id) => data.teachers.find(t => t.teacherId === id);

  /* ── 1. Sem valor da passagem: a prévia acusa e o checklist trava ──── */
  {
    const data = await previa();
    assert.ok(linha(data, 'edu').vt.semTarifa === true && linha(data, 'edu').transportAllowance === 0);
    assert.strictEqual(linha(data, 'carla').transportAllowance, 150, 'quem tem VT fixo não depende da passagem');
    Object.assign(estado(), { previewData: data, selectedYear: 2026, selectedMonth: 9, trocasAbertas: [], avisosPendentes: [] });
    const itens = JSON.parse(JSON.stringify(vm.runInContext('montarChecklist', sb)(data)));
    const trava = itens.find(i => /Vale-transporte/.test(i.titulo));
    assert.ok(trava && trava.nivel === 'bloqueia' && /EDUARDA SANTOS/.test(trava.situacao) && trava.acao.fn === 'vtAlterarTarifa()', 'trava com o nome e o botão que resolve');
    ok('sem o valor da passagem, o fechamento trava dizendo quem e como resolver');
  }

  /* ── 2. A gestão informa o valor da passagem pela tela ─────────────── */
  {
    sb.loadFechamentoPreview = async () => { estado().previewData = await previa(); };
    vm.runInContext('loadFechamentoPreview = window.loadFechamentoPreview', sb);
    st.respostas = ['6,20', '2026-09'];
    await sb.vtAlterarTarifa();
    const cfg = (await db.collection('payroll_config').doc('vale_transporte').get()).data();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(cfg.tarifas)), [{ desde: '2026-09', valor: 6.2 }]);
    assert.ok(/setembro\/2026/.test(st.confirms[0]) && /R\$ 6,20/.test(st.confirms[0]), 'confirma o valor e o mês antes de gravar');
    assert.ok(st.audits.indexOf('vt_tarifa_alterada') !== -1, 'fica na auditoria');
    const edu = linha(estado().previewData, 'edu');
    assert.strictEqual(edu.transportAllowance, 285.2, '21 úteis + 1 sábado + 1 feriado = 23 dias × 2 × 6,20');
    assert.strictEqual(edu.valorTotal, 1085.2, 'bolsa 800 + VT 285,20');

    st.respostas = ['abc']; st.toasts.length = 0;
    await sb.vtAlterarTarifa();
    assert.ok(st.toasts.some(t => t.type === 'error'), 'valor que não é número é recusado');
    assert.strictEqual((await sb.PayrollVtService.setTarifa('2026-13', 6)).success, false, 'mês inexistente é recusado');
    assert.strictEqual((await sb.PayrollVtService.setTarifa('2026-11', 7)).success, true);
    assert.strictEqual((await previa()).vt.tarifa, 6.2, 'a tarifa de novembro não mexe em setembro');
    ok('valor da passagem configurável pela conferência, com mês de início');
  }

  /* ── 3. O bloco da conferência mostra a conta aberta ───────────────── */
  {
    const data = await previa();
    const html = vm.runInContext('renderBlocoVt', sb)(data);
    const t = texto(html);
    assert.ok(/Valor da passagem neste mês: R\$ 6,20/.test(t) && /desde setembro\/2026/.test(t) && /muda para R\$ 7,00 em novembro\/2026/.test(t), 'o valor vigente e a próxima mudança');
    assert.ok(/EDUARDA SANTOS 21 dias úteis \+ 1 sábado \+ 1 feriado = 23 dias × 2 passagens × R\$ 6,20 R\$ 285,20/.test(t), 'a conta da Eduarda, por extenso: ' + t.slice(0, 600));
    assert.ok(/CARLA FANTI valor fixo do cadastro R\$ 150,00/.test(t), 'e quem tem valor fixo aparece como fixo');
    assert.ok(/vtCorrigir\('edu'\)/.test(html) && /vtAlterarTarifa\(\)/.test(html));
    assert.ok(/total R\$ 435,20/.test(t), 'com o total do bloco');
    const tabela = vm.runInContext('renderTeacherTable', sb)(data.teachers, data.totals, false);
    assert.ok(/23 dias × 2/.test(texto(tabela)), 'na folha, a célula do VT diz de onde veio');
    ok('conferência: a conta do VT aparece aberta, pessoa a pessoa');
  }

  /* ── 4. Corrigir o VT de uma pessoa no mês ─────────────────────────── */
  {
    st.respostas = ['260', '']; st.toasts.length = 0;
    await sb.vtCorrigir('edu');
    assert.ok(st.toasts.some(t => t.type === 'error' && /motivo/.test(t.msg)), 'sem motivo não grava');
    assert.ok(!(await db.collection('payroll_adjustments').doc('2026-09').get()).exists);

    st.respostas = ['260,00', 'faltou dois dias e veio de carona'];
    await sb.vtCorrigir('edu');
    const aj = (await db.collection('payroll_adjustments').doc('2026-09').get()).data();
    assert.deepStrictEqual({ v: aj.vt.edu.valor, m: aj.vt.edu.motivo, por: aj.vt.edu.por }, { v: 260, m: 'faltou dois dias e veio de carona', por: 'u_admin' });
    let edu = linha(estado().previewData, 'edu');
    assert.ok(edu.transportAllowance === 260 && edu.vt.ajustado && edu.vt.calculado === 285.2 && edu.valorTotal === 1060, 'o total da pessoa acompanha a correção');
    const t = texto(vm.runInContext('renderBlocoVt', sb)(estado().previewData));
    assert.ok(/R\$ 285,20 R\$ 260,00 corrigido: faltou dois dias e veio de carona/.test(t) && /Voltar ao calculado/.test(t), 'a tela mostra calculado, corrigido e o motivo');

    // o VT fixo também pode ser corrigido
    st.respostas = ['120', 'afastada uma semana'];
    await sb.vtCorrigir('carla');
    assert.strictEqual(linha(estado().previewData, 'carla').transportAllowance, 120);
    assert.strictEqual(linha(estado().previewData, 'edu').transportAllowance, 260, 'corrigir uma pessoa não desfaz a correção da outra');

    await sb.vtDesfazer('edu');
    edu = linha(estado().previewData, 'edu');
    assert.ok(edu.transportAllowance === 285.2 && !edu.vt.ajustado, 'voltar ao calculado desfaz');
    assert.ok(st.audits.indexOf('vt_ajustado') !== -1 && st.audits.indexOf('vt_ajuste_desfeito') !== -1);
    ok('o VT do mês é editável no fechamento, com motivo, e dá para voltar ao calculado');
  }

  /* ── 5. A Function entrega à conta o mesmo material ────────────────── */
  {
    const cf = ler('functions/index.js');
    assert.ok(/collection\('payroll_config'\)\.doc\('vale_transporte'\)/.test(cf) && /collection\('payroll_adjustments'\)\.doc\(closingId\)/.test(cf), 'lê a mesma tarifa e os mesmos ajustes, pelo id do fechamento');
    assert.ok(/aulas: classes, vtConfig, ajusteVt: ajustesVt\[tid\] \|\| null/.test(cf), 'e passa para valorDoProfessor');
    assert.ok(/vt: value\.vt \|\| null/.test(cf), 'a conta do VT fica gravada no mês fechado');
    assert.ok(/semTarifa/.test(cf), 'sem valor da passagem, a Function recusa fechar');
    // e a conta, pelo caminho da Function, dá o mesmo que a prévia
    const P = require('../functions/closing-payroll.js');
    const aulas = (await db.collection('classes').where('teacherId', '==', 'edu').get()).docs.map(d => d.data());
    const sal = (await db.collection('teacher_salaries').doc('edu').get()).data();
    const cfg = (await db.collection('payroll_config').doc('vale_transporte').get()).data();
    const v = P.valorDoProfessor({ id: 'edu', type: 'estagiario' }, sal, 23, new Date(Date.UTC(2026, 9, 0, 26, 59, 59, 999)), { aulas, vtConfig: cfg, ajusteVt: null });
    assert.strictEqual(v.transportAllowance, linha(estado().previewData, 'edu').transportAllowance, 'Function e prévia: o mesmo VT');
    ok('a Function de fechamento usa a mesma conta, com a mesma tarifa e os mesmos ajustes');
  }

  /* ── 6. Regras: só o Admin, e mês fechado não aceita correção ──────── */
  {
    const r = ler('firestore.rules');
    const bloco = r.slice(r.indexOf('match /payroll_config/{id}'), r.indexOf('match /teachers/{id}'));
    assert.ok(/match \/payroll_config\/\{id\} \{\s+allow read, write: if isAuth\(\) && isAdmin\(\);/.test(bloco));
    assert.ok(/match \/payroll_adjustments\/\{id\}/.test(bloco) && /allow read: if isAuth\(\) && isAdmin\(\);/.test(bloco));
    assert.ok(/!exists\(\/databases\/\$\(database\)\/documents\/monthly_closings\/\$\(id\)\)/.test(bloco), 'mês fechado não aceita mais correção');
    assert.ok(/allow delete: if false;/.test(bloco));
    ok('regras: valor da passagem e correções são só do Admin; mês fechado é intocável');
  }

  /* ── 7. Cadastro salarial: a marca e as passagens por dia ──────────── */
  {
    const html = ler('professores.html');
    assert.ok(/id="salaryVtPorDia"/.test(html) && /id="salaryVtPassagens"/.test(html) && /Vale-transporte por dia trabalhado/.test(html));
    const cad = ler('professores-cadastro.js');
    assert.ok(/data\.vtPorDia = vtPorDia;/.test(cad) && /data\.vtPassagensPorDia = vtPorDia \? passagens : null;/.test(cad), 'o formulário grava a marca e as passagens');
    const sh = ler('professores-shared.js');
    assert.ok(/vtPorDia:\s+salaryData\.vtPorDia\s+\?\? \(before && before\.vtPorDia\)\s+\?\? false/.test(sh), 'e o serviço persiste (sem apagar ao salvar outro campo)');
    // o botão de ligar/desligar roda de verdade
    const els = new Map();
    const el = (id) => { if (!els.has(id)) els.set(id, { style: {}, checked: false, disabled: false, title: '' }); return els.get(id); };
    const sbx = { document: { getElementById: el }, window: {} };
    vm.createContext(sbx);
    const fn = cad.replace(/\r\n/g, '\n');
    vm.runInContext(fn.slice(fn.indexOf('function salaryVtToggle()'), fn.indexOf('window.salaryVtToggle')), sbx);
    el('salaryVtPorDia').checked = true; sbx.salaryVtToggle();
    assert.ok(el('salaryTransportAllowance').disabled === true && el('salaryVtPorDiaBox').style.display === '', 'marcado: mostra as passagens e trava o valor fixo');
    el('salaryVtPorDia').checked = false; sbx.salaryVtToggle();
    assert.ok(el('salaryTransportAllowance').disabled === false && el('salaryVtPorDiaBox').style.display === 'none');
    ok('cadastro salarial: marca "por dia trabalhado" e passagens por dia');
  }

  /* ── 8. As telas novas carregam a versão nova ──────────────────────── */
  {
    const html = ler('professores.html');
    const v = (f) => (new RegExp(f.replace('.', '\\.') + '\\?v=(\\d{8}[a-z]?)').exec(html) || [])[1];
    ['closing-payroll.js', 'professores-shared.js', 'professores-cadastro.js', 'professores-fechamento.js', 'professores-pessoas.js'].forEach(f =>
      assert.ok(v(f) >= '20261007', `${f} precisa de ?v= novo (está ${v(f)}) — senão o navegador serve o arquivo antigo`));
    ok('os arquivos alterados estão com ?v= novo');
  }

  assert.ok(!st.toasts.some(t => t.type === 'console'), 'nenhum erro de console no caminho: ' + JSON.stringify(st.toasts.filter(t => t.type === 'console')));
  console.log(`\n${n} verificações ✓`);
})().catch(e => { console.error('✗', e.stack || e.message); process.exit(1); });
