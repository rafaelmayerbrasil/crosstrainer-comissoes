'use strict';
// Roda: node scripts/smoke-domingo-e-minhas-datas-tela.js
//
// ══════════════════════════════════════════════════════════════════════
// As telas CHAMADAS de verdade — não lidas como texto
// ══════════════════════════════════════════════════════════════════════
//
// Cicatriz da "prévia que nunca rodou" (24/08/2026): doze verificações passaram
// porque todas liam o arquivo e nenhuma chamava a função que ele descrevia. E do
// bug do upload da Pacto (01/09): `const` no topo de um script clássico não vira
// `window.X`, e só a execução de verdade mostra isso.
//
// Aqui rodam, dentro de um sandbox, os caminhos que mudaram em 03/09/2026: a aba
// "Minhas datas" da gestão que dá aula, a aba Feriados sem domingo, e a ficha de
// quem tem login e ainda não tem ficha de professor.
process.env.TZ = 'America/Sao_Paulo';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SS = require('../scale-service.js');
const PM = require('../pessoas-model.js');

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

const raiz = path.join(__dirname, '..');
const srcEscala = fs.readFileSync(path.join(raiz, 'professores-escala-smart.js'), 'utf8');
const srcPessoas = fs.readFileSync(path.join(raiz, 'professores-pessoas.js'), 'utf8');

// Feriados de 2026 como a BrasilAPI devolve — 15/11 é DOMINGO.
const FERIADOS_2026 = [
  { date: '2026-09-07', name: 'Independência do Brasil' },
  { date: '2026-11-15', name: 'Proclamação da República' },
  { date: '2026-11-20', name: 'Dia da consciência negra' },
];

const vaga = (id, unitId) => ({ id, unitId, requiredModalityId: 'mTOI',
  assignedPersonId: null, startTime: '08:00', endTime: '12:00' });

const sabadoAberto = {
  id: 'sc1', date: '2026-11-14', tipo: 'sabado', name: 'Sábado 14/11/2026',
  status: 'janela_aberta', windowBatchId: 'lote1', published: false,
  slots: [vaga('cp_TOI', 'cp')],
};

function sandboxEscala(opts) {
  const sb = {
    console: { log() {}, error() {}, warn() {} },
    setTimeout, clearTimeout, Date, Math, JSON, Promise, Set, Map, Array, Object, String, Number,
    document: { getElementById: () => ({ style: {}, innerHTML: '' }) },
    toast: () => {}, confirm: () => true, ajudaBtn: () => '',
    fetch: async () => ({ ok: true, json: async () => FERIADOS_2026 }),
    db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) },
    AppState: { userProfile: { professorId: opts.meuPid || null } },
    isAdminGestao: () => !!opts.gestao, isSupervisao: () => false,
    shortenName: (x) => String(x || ''),
    ScaleService: Object.assign({}, SS, {
      listScales: async () => ({ success: true, data: opts.scales || [] }),
      listPreferences: async () => ({ success: true, data: [] }),
      listWindowQuotas: async () => ({ success: true, data: {} }),
      listDayPreferences: async () => ({ success: true, data: [] }),
      listEventRsvp: async () => ({ success: true, data: [] }),
      ScaleConfigService: { get: async () => ({ success: true, data: { horarios: {} } }) },
    }),
    UnitService: { list: async () => ({ success: true, data: [{ id: 'cp', name: 'CrossTainer CP' }] }) },
    ModalityService: { list: async () => ({ success: true, data: [
      { id: 'mTOI', name: 'TOI' }, { id: 'mHIIT', name: 'Hiit Marombinha' }] }) },
    TeacherService: { list: async () => ({ success: true, data: [
      { id: 'rafael', name: 'Rafael Rojais', isActive: true, naoRemunerado: true }] }) },
    VacationService: { list: async () => ({ success: true, data: [] }) },
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(srcEscala, sb, { filename: 'professores-escala-smart.js' });
  vm.runInContext('this.EscalaSmartState = EscalaSmartState;', sb);
  return sb;
}

/** Roda o MESMO caminho da tela e devolve o HTML que a pessoa veria. */
async function htmlDaTela(opts) {
  const sb = sandboxEscala(opts);
  let html = '';
  sb.document.getElementById = () => ({
    style: {}, classList: { add() {}, remove() {}, contains: () => true },
    set innerHTML(v) { html = v; }, get innerHTML() { return html; },
  });
  sb.EscalaSmartState.tab = opts.tab || 'sabado';
  sb.EscalaSmartState.timeframe = 'todos';
  sb.EscalaSmartState.year = 2026;
  await sb.renderEscalaSmartPage();
  return { html, sb };
}

function sandboxPessoas() {
  const sb = {
    console: { log() {}, error() {}, warn() {} },
    Date, Math, JSON, Promise, Set, Map, Array, Object, String, Number,
    document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
    PessoasModel: PM, UserModel: { PROFILE_ORDER: [], PROFILE_LABELS: {} },
    isStrictAdmin: () => true, isSupervisao: () => false, canSeeSalary: () => true,
    escapeHtml: (x) => String(x == null ? '' : x),
    TYPE_LABEL: { efetivo: 'Efetivo' },
    ProfessoresState: { modalitiesMap: new Map(), unitsMap: new Map() },
    toast: () => {},
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(srcPessoas, sb, { filename: 'professores-pessoas.js' });
  return sb;
}

(async () => {

  // ═══ 1. Gestão COM ficha vê a aba "Minhas datas" ══════════════════
  {
    const { html } = await htmlDaTela({ gestao: true, meuPid: 'rafael', scales: [sabadoAberto] });
    assert.ok(/Minhas datas/.test(html),
      'a gestão que tem ficha de professor precisa ver a aba na barra');
    assert.ok(/Por pessoa/.test(html), 'a visão de gestão continua inteira');
    ok('gestão com ficha vê a aba "Minhas datas" na tela renderizada');
  }

  // ═══ 2. Gestão SEM ficha não vê ═══════════════════════════════════
  {
    const { html } = await htmlDaTela({ gestao: true, meuPid: null, scales: [sabadoAberto] });
    assert.ok(!/Minhas datas/.test(html),
      'gestão sem ficha não pode ver uma aba que não leva a lugar nenhum');
    ok('gestão sem ficha de professor não vê a aba');
  }

  // ═══ 3. A aba abre os botões de candidatura ═══════════════════════
  // É o pedido do Rafael Rojais. Se a aba existir e não trouxer os botões, não
  // resolvemos nada — só mudamos o lugar do problema.
  {
    const { html } = await htmlDaTela({
      gestao: true, meuPid: 'rafael', tab: 'minhas', scales: [sabadoAberto] });
    assert.ok(/Prefiro/.test(html) && /Pode ser/.test(html) && /Não posso/.test(html),
      'a aba precisa trazer os três botões de preferência');
    assert.ok(/Sábados/.test(html) && /Feriados/.test(html),
      'sábados e feriados vêm juntos: são lotes separados, com janelas próprias');
    assert.ok(/dias você quer/i.test(html),
      'a cota de dias também vale pra gestão que dá aula');
    ok('a aba "Minhas datas" traz os botões de candidatura de verdade');
  }

  // ═══ 4. Sem ficha, a aba explica em vez de ficar vazia ════════════
  {
    const sb = sandboxEscala({ gestao: true, meuPid: null, scales: [] });
    const html = await sb.renderMinhasDatas(null);
    assert.ok(/ficha de professor/i.test(html), 'a tela tem que dizer o que falta');
    assert.ok(/Pessoas/.test(html), 'e onde se resolve');
    ok('sem ficha, a aba diz o que falta e onde resolver');
  }

  // ═══ 5. Aba Feriados não oferece o domingo ════════════════════════
  {
    const { html } = await htmlDaTela({ gestao: true, meuPid: null, tab: 'feriado', scales: [] });

    assert.ok(/Independência do Brasil/.test(html),
      'o feriado de segunda continua sendo oferecido');
    assert.ok(!/criarEscalaData\('feriado','2026-11-15'/.test(html),
      'não pode existir botão de criar escala no domingo 15/11');
    assert.ok(/não abre no domingo/i.test(html),
      'a lista tem que EXPLICAR o sumiço — senão a gestão procura o 15/11 e não entende');
    assert.ok(/Proclamação da República/.test(html),
      'a nota nomeia o feriado que ficou de fora');
    ok('aba Feriados não oferece domingo e explica o porquê');
  }

  // ═══ 6. "Data especial" não oferece mais Domingo especial ═════════
  // Era o único caminho que restava pra criar escala em domingo.
  {
    const sb = sandboxEscala({ gestao: true, meuPid: null, scales: [] });
    let html = '';
    sb.document.getElementById = () => ({
      style: {}, classList: { add() {}, remove() {}, contains: () => true },
      set innerHTML(v) { html = v; }, get innerHTML() { return html; },
    });
    sb.openDataEspecial();
    assert.ok(!/domingo_especial/.test(html), 'a opção "Domingo especial" saiu do formulário');
    assert.ok(/não abre/i.test(html), 'o formulário avisa que domingo não é aceito');
    ok('"Data especial" não oferece mais criar escala em domingo');
  }

  // ═══ 7. A ficha de quem só tem login oferece criar a ficha ════════
  // Peça A vista pela tela: o botão que não existia.
  {
    const sb = sandboxPessoas();
    const soLogin = { key: 'U:u1', teacherId: null, uid: 'u1', name: 'Rafael Rojais',
      profiles: ['admin', 'professor'], teacher: null, user: { id: 'u1' } };

    assert.ok(sb.pessoaTabsFor(soLogin).some(t => t.id === 'professor'),
      'a ficha de quem só tem login precisa da aba Professor');

    const html = sb.renderPessoaTabProfessor(soLogin);
    assert.ok(/pessoaCriarFichaProfessor\('U:u1'\)/.test(html),
      'o botão precisa existir E chamar a função com a chave certa');
    assert.strictEqual(typeof sb.pessoaCriarFichaProfessor, 'function',
      'a função tem que existir de verdade — senão o botão chama o vazio');
    ok('a ficha de quem só tem login oferece criar a ficha de professor');
  }

  // ═══ 8. Ficha sem o perfil no login avisa o que falta ═════════════
  // Meio caminho é pior que nenhum: a pessoa entra no sorteio sem conseguir
  // abrir a tela pra se candidatar.
  {
    const sb = sandboxPessoas();
    const base = { key: 'T:t1', teacherId: 't1', uid: 'u1', name: 'Will Souza',
      teacher: { id: 't1', name: 'Will Souza', type: 'efetivo', unitIds: [], modalityIds: [], isActive: true },
      user: { id: 'u1' } };

    const semPerfil = sb.renderPessoaTabProfessor(Object.assign({}, base, { profiles: ['supervisao'] }));
    assert.ok(/perfil de professor/i.test(semPerfil) && /Acesso/.test(semPerfil),
      'ficha sem o perfil no login precisa avisar e apontar a aba Acesso');

    const comPerfil = sb.renderPessoaTabProfessor(Object.assign({}, base, { profiles: ['supervisao', 'professor'] }));
    assert.ok(!/perfil de professor/i.test(comPerfil),
      'com o perfil marcado, o aviso não pode aparecer');

    ok('ficha sem o perfil de professor no login avisa o que falta');
  }

  console.log(`\n${n}/${n} — telas do domingo e do "Minhas datas" ✅`);
})().catch(e => { console.error('\n❌ ' + e.message); process.exit(1); });
