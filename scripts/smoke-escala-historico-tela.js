'use strict';
// Roda: node scripts/smoke-escala-historico-tela.js
//
// Fuso do PROCESSO fixado ANTES de qualquer `new Date()` — inclusive antes dos
// requires. Sem isso, cravar um horário esperado (ex.: '14:32') dependeria do
// fuso da máquina que roda o teste, e passaria/falharia por acaso. A gestão
// está em GMT-3 (America/Sao_Paulo) — é o fuso que `escalaHistoricoQuando`
// promete converter para.
process.env.TZ = 'America/Sao_Paulo';
//
// Task 11 (pedido 6 do Rodrigo, 28/08/2026: "log de alteração por usuário").
// O histórico já era gravado dentro do documento da escala (Task 8/9) — faltava
// aparecer na TELA, e o serviço grava ID onde deveria gravar NOME porque
// ninguém passava `nomePorId`.
//
// Molde copiado de scripts/smoke-escala-contagem.js (bloco "a prévia RODA e
// desenha") e do segundo bloco de scripts/smoke-escala-marco-zero.js: carrega
// professores-escala-smart.js DE VERDADE num sandbox `vm` e CHAMA as funções —
// não lê o texto do arquivo. É a mesma cicatriz da "prévia que nunca rodou"
// (24/08/2026): doze verificações passaram porque todas liam o arquivo,
// nenhuma chamava a função que ele descrevia.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

const src = fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8');

// Objeto criado DENTRO do sandbox `vm` tem prototype de OUTRO realm — mesmo
// com valores idênticos, `assert.deepStrictEqual` cru falha comparando
// protótipos diferentes (achado ao rodar este teste pela 1ª vez). O round-trip
// por JSON neutraliza isso: normaliza pro realm do host antes de comparar.
const plano = (o) => JSON.parse(JSON.stringify(o));

/** Sandbox novo a cada bloco — evita estado de um teste vazar pro outro. */
function novoSandbox() {
  const modal = { innerHTML: '' };
  const overlay = { style: {}, innerHTML: '' };
  const state = {
    toastCalls: [],
    scaleServiceCalls: { reassignSlot: [], swapSlots: [], consolidate: [] },
    loadBaseCalls: 0, renderCalls: 0,
    confirmReturn: true, confirmCalls: 0,
  };

  const sandbox = {
    console,
    document: {
      getElementById: (id) => (id === 'escalaModal' ? modal : id === 'escalaModalOverlay' ? overlay : { style: {}, innerHTML: '' }),
    },
    setTimeout, clearTimeout, Date, Math, JSON, Promise, Set, Map, Array, Object, String, Number,
    toast: (msg, type) => { state.toastCalls.push({ msg, type }); },
    confirm: () => { state.confirmCalls++; return state.confirmReturn; },
    ajudaBtn: () => '',
    AppState: { userProfile: {} },
    EngagementService: {
      listCycles: async () => ({ success: true, data: [{ id: 'c', inicio: '2026-01-01', fim: '2026-12-31' }] }),
      currentCycle: (cs) => cs[0],
      scoreboard: async () => ({ success: true, data: { total: 10 } }),
    },
    ScaleService: {
      tiposIrmaos: (t) => ((t === 'feriado' || t === 'domingo_especial') ? ['feriado', 'domingo_especial'] : [t || 'sabado']),
      contarPorPessoa: () => ({}),
      listScalesByBatch: async () => ({ success: true, data: [] }),
      listWindowQuotas: async () => ({ success: true, data: {} }),
      closeElection: async () => ({ success: true }),
      consolidate: async (id, ctx) => {
        state.scaleServiceCalls.consolidate.push({ id, ctx });
        return { success: true, data: { assignments: [] } };
      },
      reassignSlot: async (...args) => {
        state.scaleServiceCalls.reassignSlot.push(args);
        return { success: true, data: { changed: true, published: false } };
      },
      swapSlots: async (...args) => {
        state.scaleServiceCalls.swapSlots.push(args);
        return { success: true, data: { published: false } };
      },
      publishToAgenda: async () => ({ success: true, data: { created: 0 } }),
      listScales: async () => ({ success: true, data: [] }),
      ScaleConfigService: { get: async () => ({ success: true, data: { horarios: {} } }) },
    },
    UnitService: { list: async () => ({ success: true, data: [] }) },
    ModalityService: { list: async () => ({ success: true, data: [] }) },
    TeacherService: { list: async () => ({ success: true, data: [] }) },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'professores-escala-smart.js' });
  // `const EscalaSmartState` de topo de arquivo não vira propriedade do
  // sandbox sozinho — só function/var viram. Ponte explícita (mesmo truque de
  // smoke-escala-marco-zero.js).
  vm.runInContext('this.EscalaSmartState = EscalaSmartState;', sandbox);
  // Sobrescreve DEPOIS de rodar o script — escalaLoadBase/renderEscalaGestao
  // também são function-declarations (var-like) e um espião posto ANTES da
  // execução seria clobbered por elas.
  sandbox.escalaLoadBase = async () => { state.loadBaseCalls++; };
  sandbox.renderEscalaGestao = () => { state.renderCalls++; };
  return { sandbox, state, modal };
}

// ── 1. escalaNomePorId: nome quando existe, id cru quando não ───────────
{
  const { sandbox } = novoSandbox();
  sandbox.EscalaSmartState.teacherMap = new Map([
    ['t1', { id: 't1', name: 'Fulano' }],
    ['t2', { id: 't2' }], // sem name
  ]);
  const out = sandbox.escalaNomePorId();
  assert.deepStrictEqual(plano(out), { t1: 'Fulano', t2: 't2' },
    'nome quando o professor tem name, id cru quando não tem');
  passou('escalaNomePorId devolve {id: nome} e cai no id sem name');
}

// ── 2. escalaHistoricoDaEscalaHtml: rótulo traduzido, escape, ordem, vazio ──
{
  const { sandbox } = novoSandbox();
  const scaleComHistorico = {
    historico: [
      { ts: '2026-08-28T09:00:00.000Z', uid: 'u1', nome: 'Ana', acao: 'consolidada', detalhe: 'entrou Ana' },
      { ts: '2026-08-28T10:00:00.000Z', uid: 'u2', nome: '<script>alert(1)</script>', acao: 'vaga_trocada', detalhe: 'saiu <b>X</b>, entrou Bruno' },
    ],
  };
  const html = sandbox.escalaHistoricoDaEscalaHtml(scaleComHistorico);

  assert.ok(html.includes('✋ Vaga trocada'), 'o rótulo traduzido aparece, não o código cru da ação');
  assert.ok(!html.includes('vaga_trocada'), 'o código "vaga_trocada" não vaza cru no HTML');
  assert.ok(!/<script>/.test(html), 'o <script> do nome NÃO entra cru no HTML — é dado vindo do banco');
  assert.ok(html.includes('&lt;script&gt;'), 'o <script> sai escapado');
  assert.ok(html.includes('&lt;b&gt;X&lt;/b&gt;'), 'o <b> do detalhe também sai escapado');
  passou('escalaHistoricoDaEscalaHtml traduz a ação e escapa nome/detalhe');

  const idxNovo = html.indexOf('entrou Bruno');   // ts 10:00 — mais nova
  const idxVelho = html.indexOf('entrou Ana');    // ts 09:00 — mais velha
  assert.ok(idxNovo !== -1 && idxVelho !== -1 && idxNovo < idxVelho,
    'a entrada mais NOVA (10:00) aparece ANTES da mais velha (09:00) — é o .reverse()');
  passou('escalaHistoricoDaEscalaHtml lista a mais nova primeiro');

  assert.strictEqual(sandbox.escalaHistoricoDaEscalaHtml({ historico: [] }), '', 'lista vazia devolve vazio');
  assert.strictEqual(sandbox.escalaHistoricoDaEscalaHtml({}), '', 'escala sem campo historico devolve vazio');
  assert.strictEqual(sandbox.escalaHistoricoDaEscalaHtml(null), '', 'escala null não estoura, devolve vazio');
  passou('escalaHistoricoDaEscalaHtml sem histórico devolve vazio, sem estourar');
}

// ── 3. escalaHistoricoGeralHtml: junta escalas, ordena, corta em 50, escapa ──
{
  const { sandbox } = novoSandbox();
  const TOTAL = 55;
  const scaleA = { id: 'a', name: 'Escala A', date: '2026-09-05', historico: [] };
  const scaleB = { id: 'b', name: 'Escala B', date: '2026-09-12', historico: [] };
  for (let i = 0; i < TOTAL; i++) {
    const ts = new Date(Date.UTC(2026, 7, 1, 0, i)).toISOString(); // minutos crescentes: i maior = mais novo
    const entrada = { ts, uid: 'u', nome: 'Fulano', acao: 'consolidada', detalhe: `MARCA_${String(i).padStart(3, '0')}_FIM` };
    (i < 28 ? scaleA : scaleB).historico.push(entrada);
  }
  sandbox.EscalaSmartState.scales = [scaleA, scaleB];
  const html = sandbox.escalaHistoricoGeralHtml();

  // as 5 mais VELHAS (i=0..4) ficam de fora do corte de 50
  for (let i = 0; i < 5; i++) {
    assert.ok(!html.includes(`MARCA_${String(i).padStart(3, '0')}_FIM`), `entrada ${i} (velha demais) fica de fora do corte de 50`);
  }
  for (let i = 5; i < TOTAL; i++) {
    assert.ok(html.includes(`MARCA_${String(i).padStart(3, '0')}_FIM`), `entrada ${i} aparece`);
  }
  assert.ok(html.includes('(50)'), 'o resumo mostra o total CORTADO (50), não o total real (55)');
  passou('escalaHistoricoGeralHtml junta as escalas, ordena da mais nova pra mais velha e corta em 50');

  sandbox.EscalaSmartState.scales = [{
    id: 'x', name: 'Escala X', date: '2026-09-19',
    historico: [{ ts: '2026-08-28T09:00:00.000Z', uid: 'u', nome: '<script>bad</script>', acao: 'publicada', detalhe: '<img onerror=1>' }],
  }];
  const htmlEsc = sandbox.escalaHistoricoGeralHtml();
  assert.ok(!/<script>|<img/.test(htmlEsc), 'nome e detalhe saem escapados no histórico geral também');
  assert.ok(htmlEsc.includes('Escala X'), 'o nome da escala aparece — é o que diz ONDE a alteração aconteceu');
  passou('escalaHistoricoGeralHtml escapa nome/detalhe e identifica em qual escala foi');

  sandbox.EscalaSmartState.scales = [];
  assert.strictEqual(sandbox.escalaHistoricoGeralHtml(), '', 'sem nenhuma escala carregada, devolve vazio');
  sandbox.EscalaSmartState.scales = [{ id: 'y', historico: [] }];
  assert.strictEqual(sandbox.escalaHistoricoGeralHtml(), '', 'escalas sem histórico nenhum, devolve vazio');
  passou('escalaHistoricoGeralHtml sem entrada nenhuma devolve vazio');
}

// ── 4. escalaHistoricoQuando: ISO em UTC vira hora LOCAL de quem lê ──────
// Achado do coordenador (revisão): `ts` é sempre UTC (`toISOString()`), e a
// gestão está em GMT-3 — mostrar cru deixava a hora 3h adiantada. O histórico
// existe pra dizer QUANDO; hora errada é a tela mentindo sobre um fato, a
// mesma classe de defeito que esta frente inteira (contador guardado, home
// contando fila do colega) existe para matar.
{
  const { sandbox } = novoSandbox();
  const quando = sandbox.escalaHistoricoQuando('2026-08-28T17:32:00.000Z');
  assert.strictEqual(quando, '28/08 14:32', 'UTC 17:32 vira 14:32 em GMT-3 (gestão), não 17:32 cru');
  passou('escalaHistoricoQuando converte UTC pra hora local de quem lê (GMT-3)');

  assert.strictEqual(sandbox.escalaHistoricoQuando(''), '—', 'ts vazio não estoura, devolve —');
  assert.strictEqual(sandbox.escalaHistoricoQuando(null), '—', 'ts null não estoura, devolve —');
  assert.strictEqual(sandbox.escalaHistoricoQuando(undefined), '—', 'ts undefined não estoura, devolve —');
  assert.strictEqual(sandbox.escalaHistoricoQuando('nao-e-data'), 'nao-e-data', 'ts inválido não estoura — devolve o valor cru, não quebra o render');
  passou('escalaHistoricoQuando não estoura com ts ausente/inválido');
}

(async () => {
  // ── 6. gerarPreviaLote: acaoHistorico diz "refeita" só quando veio do 🔄 ──
  // A verificação mais valiosa da tarefa: é o fio que faz "refazer" não se
  // confundir com "montar" no histórico. Espiona o `ctx` que chega no
  // ScaleService.consolidate dublado — não lê o texto do arquivo.
  {
    const scalesLote = [{
      id: 's1', date: '2026-09-05', tipo: 'sabado', windowBatchId: 'lote1', status: 'janela_aberta',
      slots: [{ id: 'v1', unitId: 'u1', requiredModalityId: 'TOI', assignedPersonId: null }],
    }];
    const { sandbox, state } = novoSandbox();
    sandbox.ScaleService.listScalesByBatch = async () => ({ success: true, data: scalesLote });

    sandbox.EscalaSmartState.remontando = null;
    await sandbox.gerarPreviaLote('lote1');
    assert.strictEqual(state.scaleServiceCalls.consolidate.length, 1, 'consolidou 1 vez');
    assert.strictEqual(state.scaleServiceCalls.consolidate[0].ctx.acaoHistorico, 'consolidada',
      'sem remontando, o histórico registra "consolidada"');
    passou('gerarPreviaLote manda acaoHistorico="consolidada" fora do refazer');

    state.scaleServiceCalls.consolidate = [];
    sandbox.EscalaSmartState.remontando = 'lote1';
    await sandbox.gerarPreviaLote('lote1');
    assert.strictEqual(state.scaleServiceCalls.consolidate.length, 1, 'consolidou 1 vez (2º cenário)');
    assert.strictEqual(state.scaleServiceCalls.consolidate[0].ctx.acaoHistorico, 'refeita',
      'com remontando === batchId, o histórico registra "refeita"');
    passou('gerarPreviaLote manda acaoHistorico="refeita" quando veio do 🔄 Refazer');
  }

  // ── 7. trocarPessoaEscala e inverterVagasEscala passam {nomePorId} ───────
  {
    const { sandbox, state } = novoSandbox();
    sandbox.EscalaSmartState.teacherMap = new Map([
      ['ana', { id: 'ana', name: 'Ana', modalityIds: ['TOI'] }],
      ['bru', { id: 'bru', name: 'Bruno', modalityIds: ['TOI'] }],
    ]);

    await sandbox.trocarPessoaEscala('sc1', 'v1', 'bru');
    assert.strictEqual(state.scaleServiceCalls.reassignSlot.length, 1, 'chamou reassignSlot');
    const argsReassign = state.scaleServiceCalls.reassignSlot[0];
    assert.strictEqual(argsReassign.length, 4, 'passou os 4 argumentos — scaleId, slotId, personId e o deps');
    assert.deepStrictEqual(plano(argsReassign[3]), { nomePorId: { ana: 'Ana', bru: 'Bruno' } },
      'o 4º argumento carrega nomePorId, pronto pro histórico gravar NOME em vez de id');
    passou('trocarPessoaEscala passa {nomePorId} pro serviço');

    sandbox.EscalaSmartState.scales = [{
      id: 'sc2',
      slots: [
        { id: 'vA', unitId: 'u1', requiredModalityId: 'TOI', assignedPersonId: 'ana' },
        { id: 'vB', unitId: 'u1', requiredModalityId: 'TOI', assignedPersonId: 'bru' },
      ],
    }];
    await sandbox.inverterVagasEscala('sc2', 'vA', 'vB');
    assert.strictEqual(state.scaleServiceCalls.swapSlots.length, 1, 'chamou swapSlots');
    const argsSwap = state.scaleServiceCalls.swapSlots[0];
    assert.strictEqual(argsSwap.length, 4, 'passou os 4 argumentos — scaleId, slotAId, slotBId e o deps');
    assert.deepStrictEqual(plano(argsSwap[3]), { nomePorId: { ana: 'Ana', bru: 'Bruno' } },
      'o 4º argumento carrega nomePorId');
    assert.strictEqual(state.confirmCalls, 0, 'os dois são habilitados na modalidade — não precisa confirmar nada antes');
    passou('inverterVagasEscala passa {nomePorId} pro serviço');
  }

  console.log(`\n${ok} blocos OK`);
  console.log('\n✓ smoke-escala-historico-tela: todas as seções OK');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
