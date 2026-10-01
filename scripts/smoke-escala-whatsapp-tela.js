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
const PROFS = [['thiago', 'THIAGO VALENTIM'], ['louise', 'LOUISE GABRIELLE ALFEU'], ['bruno', 'BRUNO CLAUDINO'],
  ['vagner', 'VAGNER TEIXEIRA DE LIMA'], ['leo', 'LEONARDO SILVEIRA'], ['alan', 'ALAN BRITO']]
  .map(([id, name]) => ({ id, name, userId: 'u_' + id, isActive: true, modalityIds: ['TOI'] }));
const UNITS = [{ id: 'cp', name: 'CrossTainer Campeche' }, { id: 'pp', name: 'CrossTainer Príncipe' }];

function novoSandbox(scales) {
  const els = {};
  const el = (id) => (els[id] = els[id] || { style: {}, innerHTML: '', value: '', select() { this.selecionou = true; } });
  const state = { toasts: [], copiados: [], clipboardFalha: false };
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
    sandbox.EscalaSmartState.tab = 'evento';
    await sandbox.renderEscalaGestao();
    assert.ok(!/abrirTextoWhatsApp/.test(els['page-escala-smart'].innerHTML), 'aba Eventos: sem o botão (o texto é só de sábado e feriado)');
    passou('o botão aparece nas abas Sábados e Feriados da tela real, e só nelas');
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

  console.log(`\n${ok} verificações ✓`);
})().catch(e => { console.error('✗', e.stack || e.message); process.exit(1); });

