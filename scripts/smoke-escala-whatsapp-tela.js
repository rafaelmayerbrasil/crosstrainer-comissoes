'use strict';
// Roda: node scripts/smoke-escala-whatsapp-tela.js
process.env.TZ = 'America/Sao_Paulo';
//
// A TELA do "Texto para o WhatsApp" (Rafael Rojais, 01/10/2026). O texto em si
// é função pura e está em scripts/smoke-escala-texto-whatsapp.js; aqui é o
// caminho do clique: o botão existe na tela de verdade, a janela abre no mês
// certo, só entra o que está PUBLICADO, e "Copiar" copia exatamente o que a
// gestão está vendo.
//
// Carrega professores-escala-smart.js num sandbox `vm` e CHAMA as funções —
// inclusive o `renderEscalaGestao` inteiro, pra provar que o botão é desenhado
// e não só que a função dele existe.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SS = require('../scale-service.js');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };
const src = fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8');

const v = (unitId, mod, pid) => ({ id: `${unitId}_${mod}`, unitId, requiredModalityId: mod, requiredModalityName: mod, assignedPersonId: pid, startTime: '08:00', endTime: '12:00' });
const esc = (date, tipo, published, pessoas) => ({
  id: 'e' + date, date, tipo, status: 'consolidada', published, name: `${tipo} ${date}`,
  slots: [v('cp', 'TOI', pessoas[0]), v('pp', 'TOI', pessoas[1])],
});
const ESCALAS = [
  esc('2026-09-26', 'sabado', true, ['thiago', 'louise']),
  esc('2026-10-03', 'sabado', true, ['bruno', 'vagner']),
  esc('2026-10-12', 'feriado', true, ['leo', 'alan']),
  esc('2026-10-17', 'sabado', false, ['thiago', 'vagner']),   // montada, NÃO publicada
  esc('2026-11-07', 'sabado', true, ['bruno', 'alan']),
  { id: 'ei', date: '2026-10-05', tipo: 'escola_interna', published: true, slots: [v('pp', 'TOI', 'bruno')] },
];
const FA = (day, unitId, shift, pid) => ({ id: `${day}_${unitId}_${shift}_1`, day, unitId, shift,
  startTime: shift === 'manha' ? '06:00' : '15:00', endTime: shift === 'manha' ? '12:00' : '21:00', requiredModalityId: null, assignedPersonId: pid });
const FIM_DE_ANO = { id: 'fda26', date: '2026-12-23', tipo: 'fim_de_ano', status: 'consolidada', published: true, name: 'Fim de ano 2026',
  slots: [FA('2026-12-23', 'cp', 'manha', 'bruno'), FA('2026-12-23', 'pp', 'tarde_noite', 'alan'), FA('2026-12-26', 'cp', 'manha', 'leo')] };
const EVENTOS = [
  { id: 'ev_passado', date: '2026-09-12', tipo: 'evento', name: 'Reunião do staff 12/09/2026', eventKind: 'interno', slots: [] },
  { id: 'ev_trilha', date: '2026-10-17', tipo: 'evento', name: 'Trilha da Lagoa 17/10/2026', eventKind: 'externo', slots: [] },
  { id: 'ev_games', date: '2026-11-21', tipo: 'evento', name: 'Beach Games 21/11/2026', eventKind: 'externo', slots: [] },
];
// ev_passado não está aqui de propósito: a leitura dele FALHA.
const RSVP = {
  ev_trilha: [{ personId: 'bruno', tier: 'obrigatorio', going: true }, { personId: 'alan', tier: 'opcional', going: null }],
  ev_games: [],
};
const PROFS = [['thiago', 'THIAGO VALENTIM'], ['louise', 'LOUISE GABRIELLE ALFEU'], ['bruno', 'BRUNO CLAUDINO'],
  ['vagner', 'VAGNER TEIXEIRA DE LIMA'], ['leo', 'LEONARDO SILVEIRA'], ['alan', 'ALAN BRITO']]
  .map(([id, name]) => ({ id, name, userId: 'u_' + id, isActive: true, modalityIds: ['TOI'] }));
const UNITS = [{ id: 'cp', name: 'CrossTainer Campeche' }, { id: 'pp', name: 'CrossTainer Príncipe' }];

function novoSandbox(scales) {
  const els = {};
  const el = (id) => (els[id] = els[id] || { style: {}, innerHTML: '', value: '', select() { this.selecionou = true; } });
  const state = { toasts: [], copiados: [], clipboardFalha: false, rsvpLidos: [] };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document: { getElementById: el },
    navigator: { clipboard: { writeText: async (t) => { if (state.clipboardFalha) throw new Error('negado'); state.copiados.push(t); } } },
    fetch: async () => { throw new Error('sem rede no teste'); },
    db: { collection: () => { throw new Error('sem banco no teste'); } },
    setTimeout, clearTimeout, Date, Math, JSON, Promise, Set, Map, Array, Object, String, Number,
    toast: (msg, type) => { state.toasts.push({ msg, type }); },
    confirm: () => true,
    ajudaBtn: () => '',
    isAdminGestao: () => true,
    AppState: { userProfile: {} },
    ScaleService: Object.assign({}, SS, {
      listScales: async () => ({ success: true, data: scales }),
      listPreferences: async () => ({ success: true, data: [] }),
      listEventRsvp: async (id) => { state.rsvpLidos.push(id); return RSVP[id] ? { success: true, data: RSVP[id] } : { success: false, error: 'falhou' }; },
      ScaleConfigService: { get: async () => ({ success: true, data: { horarios: {} } }) },
    }),
    UnitService: { list: async () => ({ success: true, data: UNITS }) },
    ModalityService: { list: async () => ({ success: true, data: [{ id: 'TOI', name: 'TOI' }, { id: 'HIIT', name: 'Hiit' }] }) },
    TeacherService: { list: async () => ({ success: true, data: PROFS }) },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'professores-escala-smart.js' });
  vm.runInContext('this.EscalaSmartState = EscalaSmartState;', sandbox);
  sandbox.escalaTodayISO = () => '2026-10-01';
  sandbox.EscalaSmartState.year = 2026;
  return { sandbox, state, els };
}
const nomePorId = Object.fromEntries(PROFS.map(p => [p.id, p.name]));
const unidadePorId = { cp: 'CrossTainer Campeche', pp: 'CrossTainer Príncipe' };
const esperado = (datas, formato, titulo) => SS.textoParaWhatsApp(
  ESCALAS.filter(s => datas.indexOf(s.date) !== -1), { formato, titulo, nomePorId, unidadePorId, modalidadePorId: { TOI: 'TOI', HIIT: 'Hiit' } });
/** O que está dentro do <textarea> da janela. */
const textoNaJanela = (els) => {
  const m = els.escalaModal.innerHTML.match(/<textarea[^>]*id="escalaWhatsTexto"[^>]*>([\s\S]*?)<\/textarea>/);
  assert.ok(m, 'a janela tem o campo com o texto');
  return m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
};

(async () => {
  /* ── 1. O botão é desenhado na tela de verdade ─────────────────────── */
  {
    const { sandbox, els } = novoSandbox(ESCALAS);
    for (const tab of ['sabado', 'feriado']) {
      sandbox.EscalaSmartState.tab = tab;
      await sandbox.renderEscalaGestao();
      assert.ok(/onclick="abrirTextoWhatsApp\(\)"/.test(els['page-escala-smart'].innerHTML),
        `aba ${tab}: o botão do texto para o WhatsApp está na tela`);
    }
    passou('o botão aparece nas abas Sábados e Feriados da tela real');
  }

  /* ── 1b. Em destaque, com o verbo "Copiar", e nas outras abas também ── */
  // Rafael Rojais pediu o recurso em 01/10 e em 06/10 perguntou "como faz para
  // copiar a escala para WhatsApp?" — o botão era cinza, na linha dos filtros,
  // e se chamava "Texto para o WhatsApp".
  {
    const { sandbox, els } = novoSandbox(ESCALAS.concat([FIM_DE_ANO], EVENTOS));
    const html = () => els['page-escala-smart'].innerHTML;
    const botao = () => (html().match(/<button class="([^"]*)"[^>]*onclick="abrirTextoWhatsApp\(\)"[^>]*>([^<]*)<\/button>/) || []);
    for (const [tab, rotulo] of [['sabado', 'Copiar a escala para o WhatsApp'], ['feriado', 'Copiar a escala para o WhatsApp'],
      ['pessoa', 'Copiar a escala para o WhatsApp'], ['fim_de_ano', 'Copiar a escala para o WhatsApp'],
      ['escola_interna', 'Copiar as sessões para o WhatsApp'], ['evento', 'Copiar a convocação para o WhatsApp']]) {
      sandbox.EscalaSmartState.tab = tab;
      await sandbox.renderEscalaGestao();
      const [, classe, texto] = botao();
      assert.strictEqual(classe, 'btn-primary', `aba ${tab}: o botão é o de destaque, não o cinza`);
      assert.ok(texto && texto.includes(rotulo), `aba ${tab}: o botão diz "${rotulo}" (veio "${texto}")`);
      // Logo abaixo das abas: antes da lista e do painel da escala aberta.
      assert.ok(html().indexOf('abrirTextoWhatsApp()') < html().indexOf('grid-template-columns'),
        `aba ${tab}: a faixa vem antes da lista`);
    }
    sandbox.EscalaSmartState.tab = 'minhas';
    await sandbox.renderEscalaGestao();
    assert.ok(!/abrirTextoWhatsApp/.test(html()), 'aba Minhas datas: sem a faixa (é a candidatura da própria pessoa)');
    passou('a faixa de destaque aparece em todas as abas da gestão, menos em Minhas datas');
  }

  /* ── 2. Abre no mês que vem pela frente, só com o que está publicado ── */
  {
    const { sandbox, state, els } = novoSandbox(ESCALAS);
    await sandbox.escalaLoadBase();
    sandbox.abrirTextoWhatsApp();
    assert.strictEqual(els.escalaModal.style.display, 'block', 'a janela abriu');
    assert.strictEqual(textoNaJanela(els), esperado(['2026-10-03', '2026-10-12'], 'dia', 'ESCALA DE OUTUBRO'),
      'outubro (o mês de hoje), por dia, com sábado E feriado — e sem o 17/10, que não foi publicado');
    const html = els.escalaModal.innerHTML;
    assert.ok(/17\/10/.test(html) && /não publicad/.test(html), 'a janela diz qual data ficou de fora por não estar publicada');
    assert.ok(/<option value="2026-09"/.test(html) && /<option value="2026-10" selected/.test(html) && /<option value="2026-11"/.test(html),
      'os meses que têm escala publicada estão no seletor, com outubro escolhido');
    passou('abre em outubro, só com as datas publicadas, e avisa o que ficou de fora');

    sandbox.escalaWhatsSet('formato', 'pessoa');
    assert.strictEqual(textoNaJanela(els), esperado(['2026-10-03', '2026-10-12'], 'pessoa', 'ESCALA DE OUTUBRO'), 'trocar o formato redesenha por pessoa');
    sandbox.escalaWhatsSet('mes', '2026-11');
    assert.strictEqual(textoNaJanela(els), esperado(['2026-11-07'], 'pessoa', 'ESCALA DE NOVEMBRO'), 'trocar o mês mantém o formato escolhido');
    assert.ok(!/não publicad/.test(els.escalaModal.innerHTML), 'novembro não tem data montada sem publicar: sem o aviso');
    passou('trocar formato e mês redesenha o texto');

    /* ── 3. Copiar copia exatamente o que está na janela ──────────────── */
    await sandbox.copiarTextoWhatsApp();
    assert.deepStrictEqual(state.copiados, [esperado(['2026-11-07'], 'pessoa', 'ESCALA DE NOVEMBRO')],
      'foi pra área de transferência o mesmo texto da janela');
    passou('"Copiar" manda pra área de transferência o texto que a gestão está vendo');
  }

  /* ── 4. Navegador que nega a cópia: seleciona e ensina o caminho ───── */
  {
    const { sandbox, state, els } = novoSandbox(ESCALAS);
    await sandbox.escalaLoadBase();
    sandbox.abrirTextoWhatsApp();
    state.clipboardFalha = true;
    await sandbox.copiarTextoWhatsApp();
    assert.strictEqual(state.copiados.length, 0);
    assert.ok(els.escalaWhatsTexto.selecionou, 'o texto fica selecionado pra copiar na mão');
    assert.ok(state.toasts.some(t => /Ctrl\+C/.test(t.msg)), 'e a tela diz como');
    passou('cópia negada pelo navegador: o texto fica selecionado e a tela explica');
  }

  /* ── 5. Mês que já passou inteiro e nada publicado ─────────────────── */
  {
    const { sandbox, els } = novoSandbox(ESCALAS);
    await sandbox.escalaLoadBase();
    sandbox.escalaTodayISO = () => '2026-12-15';   // nada publicado daqui pra frente
    sandbox.abrirTextoWhatsApp();
    assert.ok(/<option value="2026-11" selected/.test(els.escalaModal.innerHTML), 'sem data futura, abre no último mês publicado');
    passou('sem escala futura, a janela abre no último mês que tem escala');
  }
  {
    const { sandbox, els } = novoSandbox(ESCALAS.filter(s => !s.published));
    await sandbox.escalaLoadBase();
    sandbox.abrirTextoWhatsApp();
    assert.ok(/Nenhuma escala publicada/.test(els.escalaModal.innerHTML), 'diz por que não há texto');
    assert.ok(!/<textarea/.test(els.escalaModal.innerHTML), 'e não mostra um campo vazio');
    passou('nada publicado: a janela explica em vez de mostrar texto vazio');
  }

  /* ── 6. Aba Por pessoa: abre o mesmo texto, já no formato por pessoa ── */
  {
    const { sandbox, els } = novoSandbox(ESCALAS);
    await sandbox.escalaLoadBase();
    sandbox.EscalaSmartState.tab = 'pessoa';
    sandbox.abrirTextoWhatsApp();
    assert.strictEqual(textoNaJanela(els), esperado(['2026-10-03', '2026-10-12'], 'pessoa', 'ESCALA DE OUTUBRO'));
    passou('aba Por pessoa: a janela abre com sábados e feriados no formato por pessoa');
  }

  /* ── 7. Fim de ano: o período publicado, por dia e por pessoa ───────── */
  {
    const { sandbox, state, els } = novoSandbox(ESCALAS.concat([FIM_DE_ANO]));
    await sandbox.escalaLoadBase();
    sandbox.EscalaSmartState.tab = 'fim_de_ano';
    sandbox.abrirTextoWhatsApp();
    const opts = (formato) => ({ formato, titulo: 'FIM DE ANO 2026', nomePorId, unidadePorId });
    assert.strictEqual(textoNaJanela(els), SS.textoFimDeAnoWhatsApp(FIM_DE_ANO, opts('dia')), 'abre com o período publicado, por dia');
    assert.ok(/<option value="fda26" selected>Fim de ano 2026</.test(els.escalaModal.innerHTML), 'o período aparece no seletor');
    sandbox.escalaWhatsSet('formato', 'pessoa');
    assert.strictEqual(textoNaJanela(els), SS.textoFimDeAnoWhatsApp(FIM_DE_ANO, opts('pessoa')), 'e troca para por pessoa');
    await sandbox.copiarTextoWhatsApp();
    assert.deepStrictEqual(state.copiados, [SS.textoFimDeAnoWhatsApp(FIM_DE_ANO, opts('pessoa'))], 'copia o que está na janela');
    passou('fim de ano: abre o período publicado, troca de formato e copia o que mostra');
  }
  {
    const { sandbox, els } = novoSandbox(ESCALAS.concat([Object.assign({}, FIM_DE_ANO, { published: false })]));
    await sandbox.escalaLoadBase();
    sandbox.EscalaSmartState.tab = 'fim_de_ano';
    sandbox.abrirTextoWhatsApp();
    assert.ok(/ainda não foi publicado/.test(els.escalaModal.innerHTML) && !/<textarea/.test(els.escalaModal.innerHTML),
      'período montado e não publicado: a janela diz por que não há texto');
    passou('fim de ano não publicado: a janela explica em vez de mostrar o que o professor ainda não vê');
  }

  /* ── 8. Escola Interna: as sessões publicadas do mês ────────────────── */
  {
    const EI = (date, published, pid) => ({ id: 'ei' + date, date, tipo: 'escola_interna', published,
      slots: [{ id: 'pp_lider', unitId: 'pp', assignedPersonId: pid, startTime: '14:30', endTime: '15:30' }] });
    const sessoes = [EI('2026-10-08', true, 'bruno'), EI('2026-10-15', true, null), EI('2026-10-22', false, 'alan'), EI('2026-11-05', true, 'leo')];
    const { sandbox, els } = novoSandbox(sessoes);
    await sandbox.escalaLoadBase();
    sandbox.EscalaSmartState.tab = 'escola_interna';
    sandbox.abrirTextoWhatsApp();
    assert.strictEqual(textoNaJanela(els), SS.textoEscolaInternaWhatsApp(sessoes.slice(0, 2),
      { titulo: 'ESCOLA INTERNA DE OUTUBRO', nomePorId, unidadePorId }), 'outubro, só as sessões publicadas');
    const html = els.escalaModal.innerHTML;
    assert.ok(/22\/10/.test(html) && /não publicad/.test(html), 'e diz qual sessão ficou de fora por não estar publicada');
    assert.ok(!/escalaWhatsSet\('formato'/.test(html), 'Escola Interna não tem "por dia / por pessoa"');
    sandbox.escalaWhatsSet('mes', '2026-11');
    assert.ok(textoNaJanela(els).includes('ESCOLA INTERNA DE NOVEMBRO') && textoNaJanela(els).includes('líder Leonardo Silveira'));
    passou('Escola Interna: sessões publicadas do mês, com aviso do que ficou de fora');
  }

  /* ── 9. Evento: a convocação, com as respostas lidas do banco ───────── */
  {
    const { sandbox, state, els } = novoSandbox(ESCALAS.concat(EVENTOS));
    await sandbox.escalaLoadBase();
    sandbox.EscalaSmartState.tab = 'evento';
    const abrindo = sandbox.abrirTextoWhatsApp();
    assert.ok(/Lendo as respostas/.test(els.escalaModal.innerHTML) && !/<textarea/.test(els.escalaModal.innerHTML),
      'enquanto lê as respostas, a janela diz que está lendo — não mostra texto pela metade');
    await abrindo;
    assert.deepStrictEqual(state.rsvpLidos, ['ev_trilha'], 'leu as respostas do PRÓXIMO evento (hoje é 01/10), não do que já passou');
    assert.strictEqual(textoNaJanela(els), SS.textoEventoWhatsApp(EVENTOS[1], RSVP.ev_trilha, { nomePorId }));
    const html = els.escalaModal.innerHTML;
    assert.ok(/<option value="ev_trilha" selected>Trilha da Lagoa · 17\/10</.test(html) && /<option value="ev_games">Beach Games · 21\/11</.test(html),
      'o seletor traz os eventos que ainda vão acontecer, sem a data repetida no nome');
    assert.ok(!/ev_passado/.test(html), 'evento que já passou não entra na lista');
    await sandbox.copiarTextoWhatsApp();
    assert.deepStrictEqual(state.copiados, [SS.textoEventoWhatsApp(EVENTOS[1], RSVP.ev_trilha, { nomePorId })]);
    passou('evento: abre no próximo evento, lê as respostas e copia a convocação');

    await sandbox.escalaWhatsSet('scaleId', 'ev_games');
    assert.deepStrictEqual(state.rsvpLidos, ['ev_trilha', 'ev_games'], 'trocar de evento lê as respostas dele');
    assert.ok(/Ninguém foi convidado/.test(els.escalaModal.innerHTML) && !/<textarea/.test(els.escalaModal.innerHTML)
      && !/copiarTextoWhatsApp/.test(els.escalaModal.innerHTML), 'evento sem convidados: explica, sem campo vazio nem botão Copiar');
    passou('evento sem convidados: a janela explica o que falta');

    // O evento aberto no painel da direita já vem escolhido — mesmo sendo passado.
    sandbox.EscalaSmartState.selectedId = 'ev_passado';
    await sandbox.abrirTextoWhatsApp();
    assert.ok(/<option value="ev_passado" selected/.test(els.escalaModal.innerHTML), 'o evento selecionado na tela é o que abre');
    assert.ok(/Não consegui ler as respostas/.test(els.escalaModal.innerHTML), 'falha de leitura vira aviso, não texto vazio');
    passou('evento: o que está aberto no painel vem escolhido, e falha de leitura é dita na tela');

    // "Se alguém responder depois, é só abrir de novo": abrir de novo relê.
    sandbox.EscalaSmartState.selectedId = 'ev_trilha';
    await sandbox.abrirTextoWhatsApp();
    RSVP.ev_trilha[1].going = true;   // o Alan respondeu
    sandbox.closeEscalaModal();
    await sandbox.abrirTextoWhatsApp();
    assert.deepStrictEqual(state.rsvpLidos.slice(-2), ['ev_trilha', 'ev_trilha'], 'cada abertura lê as respostas de novo');
    assert.ok(/Vão: Alan Brito e Bruno Claudino/.test(textoNaJanela(els)) && !/Falta responder/.test(textoNaJanela(els)),
      'e o texto traz a resposta nova:\n' + textoNaJanela(els));
    passou('evento: abrir de novo relê as respostas, então o texto acompanha quem respondeu depois');
  }

  console.log(`\n${ok} verificações ✓`);
})().catch(e => { console.error('✗', e.stack || e.message); process.exit(1); });

