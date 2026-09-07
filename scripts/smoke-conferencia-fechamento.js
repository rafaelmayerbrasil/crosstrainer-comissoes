'use strict';
// Roda: node scripts/smoke-conferencia-fechamento.js
//
// ══════════════════════════════════════════════════════════════════════
// A tela de conferência do fechamento — RENDERIZADA, não lida
// ══════════════════════════════════════════════════════════════════════
//
// Pedida pela gestão em 05/09/2026: "queria que o sistema fizesse tipo esse
// relatório, com as tabelas". Seis blocos, e o botão de fechar trava enquanto
// houver pendência.
//
// Este smoke monta um sandbox, executa professores-fechamento.js como <script>
// e CHAMA as funções com dado de verdade. Conferir que a string existe no
// arquivo já deixou passar uma tela inteira que nunca rodou ([[previa-nunca-rodou]]).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);

/* ── sandbox parecido com a página ───────────────────────────────── */
function montarTela({ admin = true } = {}) {
  const noop = () => {};
  const sandbox = {
    console: { log: noop, warn: noop, error: noop },
    Map, Set, Date, Math, JSON, String, Number, Array, Object, Boolean, RegExp, Promise, Error,
    document: { getElementById: () => null, addEventListener: noop },
    fmt: v => 'R$ ' + (Math.round((v || 0) * 100) / 100).toFixed(2).replace('.', ','),
    ajudaBtn: () => '',
    isStrictAdmin: () => admin,
    canSeeSalary: () => admin,
    isAdminGestao: () => admin,
    isSupervisao: () => !admin,
    navigateTo: noop,
    toast: noop,
    AgendaState: { teachersMap: new Map() },
    UnitService: { list: async () => ({ success: true, data: [] }) },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['substitution-flow.js', 'intern-hour-bank.js', 'closing-payroll.js']) {
    vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8'), sandbox, { filename: f });
  }
  // os UMD se penduram em window; a tela lê o identificador solto
  sandbox.SubstitutionFlow = sandbox.window.SubstitutionFlow;
  sandbox.InternHourBank = sandbox.window.InternHourBank;
  sandbox.ClosingPayroll = sandbox.window.ClosingPayroll;
  vm.runInContext(fs.readFileSync(path.join(raiz, 'professores-fechamento.js'), 'utf8'),
    sandbox, { filename: 'professores-fechamento.js' });
  return sandbox;
}

// `const FechamentoState` e as funções da tela vivem no escopo léxico do
// contexto, não como propriedade do sandbox — é preciso avaliar o nome lá dentro.
const dentro = (t, nome) => vm.runInContext(nome, t);

/** Uma prévia parecida com agosto/2026 de verdade. */
function previaDeAgosto() {
  return {
    year: 2026, month: 8,
    teachers: [
      { teacherId: 'edu', teacherName: 'EDUARDA SANTOS', teacherType: 'estagiario',
        classesCount: 132, totalHoras: 125.5, valorHoras: 1118.71, mealAllowance: 0,
        transportAllowance: 250, totalOutros: 0, otherBenefits: [], valorTotal: 1368.71,
        isIntern: true, isInternProportional: true, internLimitHours: 105.35,
        internContratoMes: 105.35, internExcessValue: 179.54, internExcessHours: 20.15,
        internSaldoFinal: 0, internExplicacao: 'Horas no mês: 125,5h · contrato: 105,35h',
        porUnidade: [{ unitId: 'unit-cp', unitName: 'CrossTainer CP', classesCount: 131, horas: 125.5 },
                     { unitId: 'unit-pp', unitName: 'CrossTainer PP', classesCount: 1, horas: 0 }],
        avisos: ['duas_unidades'] },
      { teacherId: 'thi', teacherName: 'THIAGO VALENTIM', teacherType: 'eventual',
        classesCount: 88, totalHoras: 76.25, valorHoras: 0, mealAllowance: 0,
        transportAllowance: 250, totalOutros: 0, otherBenefits: [], valorTotal: 250,
        isIntern: false, isInternProportional: false,
        porUnidade: [{ unitId: 'unit-pp', unitName: 'CrossTainer PP', classesCount: 88, horas: 76.25 }],
        avisos: ['sem_valor_hora'] },
    ],
    totals: { classesRealizadas: 220, totalHoras: 201.75, totalValor: 1618.71, unitIds: ['unit-cp', 'unit-pp'] },
    isEmpty: false,
    conferencia: {
      statusAulas: { realizada: 218, substituida: 2 },
      aulasNoMes: 220, aulasQuePagam: 220, ocorrencias: 0, ferias: [],
      unidades: [
        { unitId: 'unit-pp', unitName: 'CrossTainer PP', classesCount: 89, horas: 76.25, pessoas: 2 },
        { unitId: 'unit-cp', unitName: 'CrossTainer CP', classesCount: 131, horas: 125.5, pessoas: 1 },
      ],
    },
  };
}

const trocaAberta = (status) => ({
  id: 's' + Math.random(), status, registradoPor: 'substituto',
  requestingTeacherId: 'edu', substituteTeacherId: 'thi',
  classDate: { toDate: () => new Date(2026, 7, 28) },
});

/** Renderiza a prévia e devolve o HTML que a tela escreveu. */
function renderizar(t, { trocas = [], trocasErro = null, prev = previaDeAgosto() } = {}) {
  let html = '';
  t.document.getElementById = (id) => {
    if (id === 'fechamentoContent') return { set innerHTML(v) { html = v; }, get innerHTML() { return html; } };
    return null;
  };
  const st = dentro(t, 'FechamentoState');
  st.previewData = prev;
  st.selectedYear = 2026;
  st.selectedMonth = 8;
  st.filtroUnitId = '';
  st.trocasAbertas = trocasErro ? null : trocas;
  st.trocasErro = trocasErro;
  dentro(t, 'renderPreviewContent')();
  return html;
}

/* ── 1. os seis blocos aparecem ──────────────────────────────────── */
{
  const t = montarTela();
  const html = renderizar(t, { trocas: [trocaAberta('pending')] });
  for (const titulo of ['1 · Antes de fechar', '2 · A folha do mês', '3 · Bolsistas',
                        '4 · Trocas em aberto', '5 · Cadastro com problema', '6 · Custo por unidade']) {
    assert.ok(html.indexOf(titulo) !== -1, 'faltou o bloco "' + titulo + '"');
  }
  ok('os seis blocos são desenhados');
}

/* ── 2. troca aberta TRAVA o botão de fechar ─────────────────────── */
{
  const t = montarTela();
  const html = renderizar(t, { trocas: [trocaAberta('pending')] });
  assert.ok(/Resolva as pendências primeiro/.test(html),
    'com troca em aberto o botão tem que dizer o que falta');
  const btn = html.slice(html.lastIndexOf('<button'), html.length);
  assert.ok(/disabled/.test(btn), 'e estar desabilitado — fechar é irreversível');
  ok('troca em aberto trava o botão de fechar');
}

/* ── 3. sem pendência, o botão libera ────────────────────────────── */
{
  const t = montarTela();
  const prev = previaDeAgosto();
  prev.teachers = prev.teachers.filter(x => x.teacherId !== 'thi');  // tira o cadastro errado
  const html = renderizar(t, { trocas: [], prev });
  assert.ok(/🔒 Fechar mês/.test(html), 'sem pendência o botão volta a ser "Fechar mês"');
  assert.ok(!/Resolva as pendências primeiro/.test(html), 'e não fala mais em pendência');
  ok('sem pendência o botão libera');
}

/* ── 4. cadastro sem valor/hora também trava ─────────────────────── */
{
  const t = montarTela();
  const html = renderizar(t, { trocas: [] });   // Thiago segue na lista, com aviso
  assert.ok(/Resolva as pendências primeiro/.test(html),
    'aula valendo R$ 0,00 não pode ser fechada em silêncio');
  assert.ok(/THIAGO VALENTIM/.test(html) && /Cadastro com problema/.test(html),
    'e a tela tem que dizer de quem é o problema');
  ok('cadastro sem valor/hora trava e aparece com nome');
}

/* ── 5. falha ao checar trocas trava (falha FECHADA) ─────────────── */
{
  const t = montarTela();
  const html = renderizar(t, { trocasErro: 'deu ruim na consulta' });
  assert.ok(/Resolva as pendências primeiro/.test(html),
    'sem saber das trocas, não se fecha o mês');
  assert.ok(/Não consegui verificar/.test(html), 'e a tela diz que não conseguiu verificar');
  ok('falha ao checar trocas trava o fechamento (falha fechada)');
}

/* ── 6. a folha mostra as duas unidades numa linha só ────────────── */
{
  const t = montarTela();
  const html = renderizar(t, { trocas: [] });
  const linhasEduarda = (html.match(/EDUARDA SANTOS/g) || []).length;
  assert.ok(linhasEduarda >= 1, 'a Eduarda tem que aparecer');
  assert.ok(/CP 125\.5h|CP 125,5h/.test(html.replace(/&nbsp;/g, ' ')),
    'e a divisão por unidade fica visível na linha dela');
  ok('quem dá aula nas duas unidades aparece em uma linha, com a divisão');
}

/* ── 7. o bloco de bolsistas mostra contrato × horas ─────────────── */
{
  const t = montarTela();
  const html = renderizar(t, { trocas: [] });
  const bloco = html.slice(html.indexOf('3 · Bolsistas'), html.indexOf('4 · Trocas em aberto'));
  assert.ok(/105,35h/.test(bloco), 'contrato da Eduarda');
  assert.ok(/125,50h/.test(bloco), 'horas dela');
  assert.ok(/\+20,15h/.test(bloco), 'e o excedente');
  assert.ok(/179,54/.test(bloco), 'com o valor da hora extra');
  ok('o bloco de bolsistas responde a pergunta da Benny (contrato × horas × extra)');
}

/* ── 8. supervisão não vê a tela ─────────────────────────────────── */
{
  const t = montarTela({ admin: false });
  let html = '';
  t.document.getElementById = (id) =>
    id === 'page-fechamento' ? { set innerHTML(v) { html = v; }, get innerHTML() { return html; } } : null;
  // renderFechamentoPage é async; a trava é a primeira coisa e não espera nada
  dentro(t, 'renderFechamentoPage')();
  assert.ok(/só do Administrador/i.test(html),
    'a tela mostra bolsa, VR, VT e total de todo mundo — supervisão não entra');
  assert.ok(!/Carregar preview/.test(html), 'e não desenha a barra de ferramentas');
  ok('supervisão vê a explicação, não os salários');
}

/* ── 9. admin vê a tela normalmente ──────────────────────────────── */
{
  const t = montarTela({ admin: true });
  const escrito = {};
  // Elemento de mentira pra qualquer id: o admin passa da trava e a tela segue
  // desenhando, então não dá pra devolver null como no caso da supervisão.
  t.document.getElementById = (id) => {
    if (!escrito[id]) escrito[id] = { innerHTML: '', textContent: '', classList: { add() {}, remove() {}, toggle() {} } };
    return escrito[id];
  };
  dentro(t, 'renderFechamentoPage')();
  assert.ok(!/só do Administrador/i.test(escrito['page-fechamento'].innerHTML),
    'o admin não pode ser barrado');
  ok('admin não é barrado');
}

/* ── 10. mês sem aula não quebra a tela ──────────────────────────── */
{
  const t = montarTela();
  const html = renderizar(t, {
    trocas: [],
    prev: { year: 2026, month: 1, teachers: [], totals: { classesRealizadas: 0, totalHoras: 0, totalValor: 0 }, isEmpty: true },
  });
  assert.ok(/Nenhuma aula encontrada/.test(html), 'mês vazio tem que dizer que está vazio');
  ok('mês sem aula não quebra a tela');
}

/* ── 11. o checklist DIZ QUEM está com cadastro errado ───────────── */
{
  // Pedido do Rafael em 07/09/2026, olhando a tela no staging: "2 pessoa(s)
  // com aula valendo R$ 0,00" não diz de quem se trata. Quem lê tem que saber
  // o nome sem precisar clicar.
  const t = montarTela();
  const html = renderizar(t, { trocas: [] });
  const bloco1 = html.slice(html.indexOf('1 · Antes de fechar'), html.indexOf('2 · A folha do mês'));
  assert.ok(/THIAGO VALENTIM/.test(bloco1),
    'o nome de quem está com cadastro errado tem que aparecer na própria linha');
  ok('o checklist diz QUEM está com cadastro errado');
}

/* ── 12. com muita gente, mostra alguns e diz quantos faltam ─────── */
{
  const t = montarTela();
  const prev = previaDeAgosto();
  const base = prev.teachers[1];
  prev.teachers = ['ANA', 'BENTO', 'CARLOS', 'DIRCE', 'ELIAS'].map((nome, i) =>
    Object.assign({}, base, { teacherId: 'p' + i, teacherName: nome }));
  const html = renderizar(t, { trocas: [], prev });
  const bloco1 = html.slice(html.indexOf('1 · Antes de fechar'), html.indexOf('2 · A folha do mês'));
  assert.ok(/ANA/.test(bloco1) && /BENTO/.test(bloco1), 'os primeiros nomes aparecem');
  assert.ok(/e mais 2/.test(bloco1),
    'com muita gente a linha não pode virar um parágrafo — mostra alguns e diz quantos faltam');
  assert.ok(/ELIAS/.test(html), 'mas todos aparecem no bloco de cadastro, mais abaixo');
  ok('com muita gente, a linha mostra alguns e diz quantos faltam');
}

/* ── 13. o "Ver" leva ao bloco que lista todos ───────────────────── */
{
  const t = montarTela();
  const html = renderizar(t, { trocas: [] });
  assert.ok(/id="bloco-cadastro-problema"/.test(html),
    'o bloco de cadastro precisa de âncora pra onde o botão leva');
  const bloco1 = html.slice(html.indexOf('1 · Antes de fechar'), html.indexOf('2 · A folha do mês'));
  assert.ok(/verCadastrosComProblema\(\)/.test(bloco1),
    'o botão da linha tem que levar ao bloco, não a uma tela onde a pessoa se perde');
  ok('o "Ver" leva ao bloco que lista todos');
}

/* ── 14. cada linha do bloco abre a ficha DAQUELA pessoa ─────────── */
{
  const t = montarTela();
  const html = renderizar(t, { trocas: [] });
  const bloco5 = html.slice(html.indexOf('5 · Cadastro com problema'), html.indexOf('6 · Custo por unidade'));
  assert.ok(/abrirFichaDaPessoa\('thi'/.test(bloco5),
    'da linha da pessoa tem que dar pra ir direto na ficha DELA, já na aba certa');
  ok('cada linha do bloco abre a ficha daquela pessoa');
}

/* ── 15. abrirFichaDaPessoa leva à ficha certa, na aba certa ─────── */
{
  // O botão do bloco 5 aponta pra esta função — e apontar não é funcionar.
  // Aqui ela é CHAMADA de verdade, com professores-pessoas.js carregado como
  // <script>, e se confere onde a tela de Pessoas foi parar.
  const noop = () => {};
  const sandbox = {
    console: { log: noop, warn: noop, error: noop },
    Map, Set, Date, Math, JSON, String, Number, Array, Object, Boolean, RegExp, Promise, Error,
    document: { getElementById: () => null, querySelector: () => null, addEventListener: noop },
    setTimeout, clearTimeout,
    navigateTo: (p) => { sandbox._foiPara = p; },
    isStrictAdmin: () => true, isAdminGestao: () => true, isSupervisao: () => false,
    canSeeSalary: () => true, isSuperv: () => false,
    escapeHtml: (x) => String(x == null ? '' : x),
    fmt: () => '', toast: noop,
    AppState: { currentUser: { uid: 'u1' } },
    db: new Proxy(function () {}, { get: () => () => {}, apply: () => ({}) }),
    firebase: { firestore: () => ({}), auth: () => ({}), apps: [] },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(raiz, 'pessoas-model.js'), 'utf8'), sandbox,
    { filename: 'pessoas-model.js' });
  sandbox.PessoasModel = sandbox.window.PessoasModel;
  vm.runInContext(fs.readFileSync(path.join(raiz, 'professores-pessoas.js'), 'utf8'), sandbox,
    { filename: 'professores-pessoas.js' });

  const st = vm.runInContext('PessoasState', sandbox);
  // deixa a tela num estado "sujo", como fica depois de alguém filtrar
  st.filters = { search: 'zzz', profile: 'professor' };
  st.selectedKey = null;
  st.activeTab = 'identidade';

  vm.runInContext('abrirFichaDaPessoa', sandbox)('BU1SQbcMUlRnFC4Dx5Yq');

  assert.strictEqual(st.selectedKey, 'T:BU1SQbcMUlRnFC4Dx5Yq',
    'a ficha selecionada é a da pessoa que veio do fechamento');
  assert.strictEqual(st.activeTab, 'salarial',
    'e abre na aba Salarial, que é onde o problema se conserta');
  assert.strictEqual(st.filters.search, '',
    'a busca anterior é limpa — abrir a tela e não achar ninguém é pior que não ter botão');
  assert.strictEqual(st.filters.profile, 'all', 'e o filtro de perfil volta ao padrão da tela');
  assert.strictEqual(sandbox._foiPara, 'pessoas', 'e a navegação acontece de fato');

  // id vazio não pode navegar pra lugar nenhum
  sandbox._foiPara = null;
  vm.runInContext('abrirFichaDaPessoa', sandbox)('');
  assert.strictEqual(sandbox._foiPara, null, 'sem id, não navega');
  ok('abrirFichaDaPessoa leva à ficha certa, na aba certa, com a lista limpa');
}

console.log('');
console.log('✅ smoke-conferencia-fechamento: ' + n + ' casos');
