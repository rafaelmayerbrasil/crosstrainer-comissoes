'use strict';
// Roda: node scripts/smoke-horas-do-mes-ligacoes.js
process.env.TZ = 'America/Sao_Paulo';
//
// "Minhas horas do mês" — onde a tela se LIGA ao resto: quem é avisado, o que
// trava o fechamento, quem vê o quê no menu.
//
// O risco aqui é o de sempre neste projeto: a pessoa faz a parte dela e a
// informação morre (caixa de substituições, trocas paradas, 21 avisos de aula
// sem resposta). Horas enviadas que ninguém vê seriam o quarto caso.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('../hour-declaration.js');

const raiz = path.join(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8').replace(/\r\n/g, '\n');
let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

/* ── 1. O módulo das Functions é o mesmo da tela ───────────────────── */
{
  assert.strictEqual(ler('functions/hour-declaration.js'), ler('hour-declaration.js'),
    'functions/hour-declaration.js tem que ser gêmeo do da raiz — a regra de quando avisar a gestão não pode existir em duas versões');
  passou('functions/hour-declaration.js é idêntico ao da raiz');
}

/* ── 2. Quando a gestão é avisada ──────────────────────────────────── */
{
  const env = { status: 'enviada', mes: '2026-09', resumo: { minutosAgenda: 8370, minutosInformados: 10035 } };
  assert.strictEqual(H.enviouAgora({ status: 'rascunho' }, env), true, 'rascunho → enviada: avisa');
  assert.strictEqual(H.enviouAgora({ status: 'devolvida' }, env), true, 'devolvida → enviada de novo: avisa');
  assert.strictEqual(H.enviouAgora(null, env), true, 'já nasceu enviada: avisa');
  assert.strictEqual(H.enviouAgora(env, env), false, 'continua enviada (outra gravação qualquer): não avisa de novo');
  assert.strictEqual(H.enviouAgora({ status: 'rascunho' }, Object.assign({}, env, { semDiferenca: true })), false,
    '"tudo igual à agenda" não pede OK — avisar criaria fila à toa');
  assert.strictEqual(H.enviouAgora({ status: 'rascunho' }, Object.assign({}, env, { lancadaPelaGestao: true })), false,
    'o que a própria gestão lançou não avisa a gestão');
  assert.strictEqual(H.enviouAgora(env, { status: 'validada' }), false);
  assert.strictEqual(H.enviouAgora(env, null), false);

  const txt = H.avisoParaGestao('THEO ROSA', env);
  assert.ok(/THEO ROSA/.test(txt) && /setembro\/2026/.test(txt) && /167h15/.test(txt) && /139h30/.test(txt) && /\+27h45/.test(txt), txt);
  assert.ok(/Horas do mês/.test(txt), 'e diz onde resolver');
  assert.ok(/enviou as horas de outubro\/2026\./.test(H.avisoParaGestao('X', { mes: '2026-10' })), 'sem o resumo gravado, o aviso sai sem a conta — não com "NaN"');
  passou('a gestão é avisada quando o professor envia horas com diferença — e só então');

  const fn = ler('functions/index.js');
  assert.ok(/exports\.onHourDeclarationSent = onDocumentWritten\(\{\s*document: 'hour_declarations\/\{id\}'/.test(fn), 'existe o gatilho na coleção certa');
  assert.ok(/hourDeclaration\.enviouAgora\(before, after\)/.test(fn) && /type: 'horas_enviadas'/.test(fn) && /listAdminUserIds\(\)/.test(fn),
    'ele usa a regra do módulo e avisa admin e supervisão');
  assert.ok(/horas_enviadas:\s+'Horas do mês a validar'/.test(fn), 'o aviso tem título');
  passou('a Function onHourDeclarationSent avisa a gestão pelo sino');
}

/* ── 3. O lembrete do professor ────────────────────────────────────── */
{
  assert.strictEqual(H.lembrete(null, '2026-10', '2026-11-03'), 'conferir', 'o mês acabou e ele não conferiu');
  assert.strictEqual(H.lembrete({ status: 'rascunho' }, '2026-10', '2026-11-03'), 'conferir', 'começou e não enviou');
  assert.strictEqual(H.lembrete(null, '2026-10', '2026-10-20'), null, 'mês em andamento: não cobra');
  assert.strictEqual(H.lembrete({ status: 'devolvida' }, '2026-10', '2026-10-20'), 'devolvida', 'devolvida cobra sempre');
  ['enviada', 'validada', 'dispensada'].forEach(s =>
    assert.strictEqual(H.lembrete({ status: s }, '2026-10', '2026-11-03'), null, s + ': nada a lembrar'));
  const home = ler('professores-home.js');
  assert.ok(/HourDeclaration\.lembrete\(/.test(home) && /navigateTo\('minhas-horas'\)/.test(home), 'a home do professor usa o lembrete e leva à tela');
  assert.ok(/HourDeclarationService\.aValidar\(\)/.test(home) && /horasGestaoAbrirMes\(/.test(home), 'a home da gestão mostra quantas pessoas esperam o OK');
  passou('a home lembra o professor de conferir e a gestão de validar');
}

/* ── 4. Menu: quem vê o quê ────────────────────────────────────────── */
{
  const Nav = require('../professores-nav.js');
  ['professor', 'professor_estagiario'].forEach(p => {
    assert.ok(Nav.allowedPagesFor([p]).includes('minhas-horas'), p + ' tem Minhas horas');
    assert.ok(!Nav.allowedPagesFor([p]).includes('horas-do-mes'), p + ' não tem a tela da gestão');
  });
  ['admin', 'supervisao'].forEach(p => assert.ok(Nav.allowedPagesFor([p]).includes('horas-do-mes'), p + ' tem Horas do mês'));
  const ids = (m) => m.groups.flatMap(g => g.items.map(i => i.id));
  const semFicha = Nav.buildSidebarModel(['admin'], { hasProfessorLink: false, moduleAccess: { professores: true } });
  const comFicha = Nav.buildSidebarModel(['admin'], { hasProfessorLink: true, moduleAccess: { professores: true } });
  assert.ok(!ids(semFicha).includes('minhas-horas') && ids(semFicha).includes('horas-do-mes'), 'gestão sem ficha não vê "Minhas horas" (não tem aula pra conferir)');
  assert.ok(ids(comFicha).includes('minhas-horas'), 'gestão que dá aula vê');
  passou('menu: professor confere as dele, gestão valida, gestão que dá aula tem as duas');

  const html = ler('professores.html');
  assert.ok(/id="page-minhas-horas"/.test(html) && /id="page-horas-do-mes"/.test(html), 'as duas páginas existem');
  const ordem = [...html.matchAll(/<script src="([a-z0-9-]+\.js)\?v=\d{8}[a-z]?"><\/script>/g)].map(m => m[1]);
  const pos = (f) => ordem.indexOf(f);
  assert.ok(pos('hour-declaration.js') !== -1 && pos('professores-horas.js') !== -1, 'os dois arquivos são carregados');
  assert.ok(pos('hour-declaration.js') < pos('professores-horas.js') && pos('hour-declaration.js') < pos('professores-fechamento.js'),
    'as contas carregam antes de quem as usa');
  const app = ler('professores.js');
  assert.ok(/pageId === 'minhas-horas'[^\n]*renderMinhasHorasPage/.test(app) && /pageId === 'horas-do-mes'[^\n]*renderHorasGestaoPage/.test(app), 'as rotas abrem as telas');
  assert.ok(/link\.type === 'minhas-horas' \|\| link\.type === 'horas-do-mes'/.test(app), 'clicar no aviso do sino leva à tela');
  const shared = ler('professores-shared.js');
  ['horas_enviadas', 'horas_validadas', 'horas_devolvidas', 'horas_dispensadas'].forEach(t =>
    assert.ok(new RegExp(t + ':\\s+\\{ icon').test(shared), 'o sino conhece o tipo ' + t));
  passou('a página carrega as peças na ordem, abre as rotas e o sino conhece os avisos');
}

/* ── 5. Regras de acesso ───────────────────────────────────────────── */
{
  const rules = ler('firestore.rules');
  const bloco = rules.slice(rules.indexOf('match /hour_declarations/{id}'), rules.indexOf('match /substitutions/{id}'));
  assert.ok(bloco.length > 200, 'existe regra para hour_declarations');
  assert.ok(/resource\.data\.teacherId == uData\(\)\.professorId/.test(bloco), 'o professor só lê a própria');
  assert.ok(/request\.resource\.data\.status in \['rascunho', 'enviada', 'devolvida'\]/.test(bloco), 'e não consegue se dar por validado');
  assert.ok(/hasAny\(\['validadaPor', 'validadaEm', 'aplicado'/.test(bloco), 'nem escrever os campos da validação');
  assert.ok(/allow delete: if false;/.test(bloco), 'declaração não se apaga');
  passou('regras: o professor escreve só a própria declaração e nunca a validação');
}

/* ── 6. O fechamento trava ─────────────────────────────────────────── */
{
  const montar = (declaracoes, falha) => {
    const noop = () => {};
    const sandbox = {
      console: { log: noop, warn: noop, error: noop },
      Map, Set, Date, Math, JSON, String, Number, Array, Object, Boolean, RegExp, Promise, Error,
      document: { getElementById: () => null, addEventListener: noop },
      escapeHtml: (s) => String(s == null ? '' : s),
      fmt: (v) => String(v), ajudaBtn: () => '', isStrictAdmin: () => true, canSeeSalary: () => true,
      isAdminGestao: () => true, isSupervisao: () => false, navigateTo: noop, toast: noop,
      AgendaState: { teachersMap: new Map() },
      UnitService: { list: async () => ({ success: true, data: [] }) },
      HourDeclaration: H,
      HourDeclarationService: { doMes: async (mes) => { if (falha) throw new Error('sem permissão'); return declaracoes.filter(d => d.mes === mes); } },
    };
    sandbox.window = sandbox; sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    for (const f of ['substitution-flow.js', 'intern-hour-bank.js', 'closing-payroll.js']) {
      vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8'), sandbox, { filename: f });
    }
    sandbox.SubstitutionFlow = sandbox.window.SubstitutionFlow;
    sandbox.InternHourBank = sandbox.window.InternHourBank;
    sandbox.ClosingPayroll = sandbox.window.ClosingPayroll;
    vm.runInContext(fs.readFileSync(path.join(raiz, 'professores-fechamento.js'), 'utf8'), sandbox, { filename: 'professores-fechamento.js' });
    return sandbox;
  };
  const previa = {
    conferencia: { aulasNoMes: 10, aulasQuePagam: 10, statusAulas: {}, ocorrencias: 0, ferias: [] },
    teachers: [
      { teacherId: 'theo', teacherName: 'THEO ROSA', classesCount: 80, avisos: [], porUnidade: [] },
      { teacherId: 'bia', teacherName: 'BIA LIMA', classesCount: 6, avisos: [], porUnidade: [] },
      { teacherId: 'vag', teacherName: 'VAGNER TEIXEIRA', classesCount: 12, avisos: [], porUnidade: [] },
      { teacherId: 'edu', teacherName: 'EDUARDA BOLSA', classesCount: 0, avisos: [], porUnidade: [] },   // só bolsa, sem aula
    ],
  };
  const checklist = async (t, ano, mes) => {
    const st = vm.runInContext('FechamentoState', t);
    st.previewData = previa; st.selectedYear = ano; st.selectedMonth = mes;
    st.trocasAbertas = []; st.trocasErro = null; st.avisosPendentes = []; st.avisosErro = null;
    await vm.runInContext('carregarHorasPendentes', t)();
    return JSON.parse(JSON.stringify(vm.runInContext('montarChecklist', t)(previa)));
  };
  const decls = [
    { teacherId: 'theo', mes: '2026-10', status: 'enviada' },
    { teacherId: 'vag', mes: '2026-10', status: 'validada' },
    { teacherId: 'theo', mes: '2026-09', status: 'enviada' },
  ];

  (async () => {
    // outubro: a conferência já é cobrada
    let itens = await checklist(montar(decls), 2026, 10);
    const esperando = itens.find(i => /esperando o seu OK/.test(i.titulo));
    assert.ok(esperando && esperando.nivel === 'bloqueia' && /THEO ROSA/.test(esperando.situacao), 'horas enviadas e não validadas travam, com o nome');
    assert.strictEqual(esperando.acao.fn, 'horasGestaoAbrirMes(2026,10)', 'o botão abre a lista da gestão JÁ no mês do fechamento');
    const naoConf = itens.find(i => /não conferidas/.test(i.titulo));
    assert.ok(naoConf && naoConf.nivel === 'bloqueia' && /BIA LIMA/.test(naoConf.situacao), 'quem não conferiu trava, com o nome');
    assert.ok(!/VAGNER/.test(naoConf.situacao) && !/EDUARDA/.test(naoConf.situacao), 'validado não trava; e quem não tem aula no mês não tem o que conferir');
    assert.strictEqual(naoConf.acao.rotulo, 'Ver as horas', 'com o atalho pra ver as horas antes de decidir');
    passou('fechamento de outubro/2026: horas a validar e não conferidas travam, com nome e atalho');

    // setembro: enviada trava, "não conferiu" ainda não
    itens = await checklist(montar(decls), 2026, 9);
    assert.ok(itens.some(i => /esperando o seu OK/.test(i.titulo) && i.nivel === 'bloqueia'), 'em setembro, o que foi ENVIADO trava do mesmo jeito');
    assert.ok(!itens.some(i => /não conferidas/.test(i.titulo)), 'mas ninguém é cobrado por não ter conferido um mês anterior à tela existir');
    itens = await checklist(montar([]), 2026, 9);
    const livre = itens.find(i => i.titulo === 'Horas do mês');
    assert.ok(livre && livre.nivel === 'ok', 'setembro sem nada enviado não trava');
    passou('setembro/2026: só trava o que foi enviado; não conferir ainda não é cobrado');

    // não deu pra checar: falha fechada
    itens = await checklist(montar([], true), 2026, 10);
    const erro = itens.find(i => i.titulo === 'Horas do mês');
    assert.ok(erro && erro.nivel === 'bloqueia' && /Não consegui verificar/.test(erro.situacao), 'sem conseguir checar, não fecha');
    passou('se a checagem falha, o fechamento trava (fechar é irreversível)');

    console.log(`\n${ok} verificações ✓`);
  })().catch(e => { console.error('✗', e.stack || e.message); process.exit(1); });
}
