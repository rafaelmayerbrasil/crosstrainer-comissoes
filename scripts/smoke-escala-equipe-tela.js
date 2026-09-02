'use strict';
// Roda: node scripts/smoke-escala-equipe-tela.js
//
// A tela do professor CHAMADA de verdade — não lida como texto. É a cicatriz da
// "prévia que nunca rodou" (24/08/2026): doze verificações passaram porque todas
// liam o arquivo e nenhuma chamava a função que ele descrevia.
//
// O que se prova aqui: a linha da escala publicada passou a dizer ONDE o
// professor trabalha e COM QUEM (pergunta do Rodrigo em 31/08/2026), e continua
// não dizendo nada enquanto a gestão não publica.
process.env.TZ = 'America/Sao_Paulo';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SS = require('../scale-service.js');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

const src = fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8');

const vagaEu     = { id: 'cp_TOI',  unitId: 'cp', requiredModalityId: 'mTOI',  assignedPersonId: 'eu',      startTime: '08:00', endTime: '09:00' };
const vagaKarin  = { id: 'cp_HIIT', unitId: 'cp', requiredModalityId: 'mHIIT', assignedPersonId: 'karin',   startTime: '09:00', endTime: '10:00' };
const vagaHelo   = { id: 'pp_TOI',  unitId: 'pp', requiredModalityId: 'mTOI',  assignedPersonId: 'heloisa', startTime: '08:00', endTime: '09:00' };
const vagaAberta = { id: 'pp_HIIT', unitId: 'pp', requiredModalityId: 'mHIIT', assignedPersonId: null };

const escala = (extra) => Object.assign({
  id: 'sc1', date: '2099-09-05', tipo: 'sabado', status: 'consolidada', published: true,
  slots: [vagaEu, vagaKarin, vagaHelo, vagaAberta],
}, extra || {});

function novoSandbox(scales) {
  const sandbox = {
    console, setTimeout, clearTimeout, Date, Math, JSON, Promise, Set, Map, Array, Object, String, Number,
    document: { getElementById: () => ({ style: {}, innerHTML: '' }) },
    toast: () => {}, confirm: () => true, ajudaBtn: () => '',
    AppState: { userProfile: { professorId: 'eu' } },
    isAdminGestao: () => false, isSupervisao: () => false,
    shortenName: (n) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : p[0]; },
    // ScaleService REAL — só o que fala com o banco é dublê.
    ScaleService: Object.assign({}, SS, {
      listScales: async () => ({ success: true, data: scales }),
      listPreferences: async () => ({ success: true, data: [] }),
      listWindowQuotas: async () => ({ success: true, data: {} }),
      listDayPreferences: async () => ({ success: true, data: [] }),
      ScaleConfigService: { get: async () => ({ success: true, data: { horarios: {} } }) },
    }),
    UnitService: { list: async () => ({ success: true, data: [
      { id: 'cp', name: 'CrossTainer Centro Politecnico' },
      { id: 'pp', name: 'CrossTainer Portao' },
    ] }) },
    ModalityService: { list: async () => ({ success: true, data: [
      { id: 'mTOI', name: 'TOI' }, { id: 'mHIIT', name: 'Hiit Marombinha' },
    ] }) },
    TeacherService: { list: async () => ({ success: true, data: [
      { id: 'eu', name: 'Rafael Mayer', isActive: true },
      { id: 'karin', name: 'Karin Souza', isActive: true },
      { id: 'heloisa', name: 'Heloisa Lima', isActive: true },
    ] }) },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'professores-escala-smart.js' });
  vm.runInContext('this.EscalaSmartState = EscalaSmartState;', sandbox);
  return sandbox;
}

/** Roda o MESMO caminho da tela: carrega o estado e devolve o HTML da aba. */
async function htmlDaAba(scales) {
  const sb = novoSandbox(scales);
  sb.EscalaSmartState.timeframe = 'todos';
  await sb.renderEscalaPrefs();   // é aqui que units/modalidades são carregadas
  return sb.renderProfSabadosFeriados('eu', 'sabado');
}

(async () => {
  // ── 1. publicada: unidade, modalidade e colegas na própria linha ──
  const h = await htmlDaAba([escala()]);
  assert.ok(h.includes('Você está escalado'), 'continua dizendo que ele está escalado');
  assert.ok(h.includes('CrossTainer Centro Politecnico'), 'a UNIDADE dele aparece — era a pergunta do Rodrigo');
  assert.ok(h.includes('TOI'), 'a modalidade da vaga dele aparece');
  assert.ok(h.includes('08:00'), 'o horário da vaga dele aparece');
  passou('escala publicada mostra unidade, modalidade e horário do professor');

  assert.ok(h.includes('Karin S.'), 'o colega da mesma unidade aparece');
  assert.ok(h.includes('Heloisa L.'), 'e o da outra unidade também — "quem tá escalado junto"');
  assert.ok(h.includes('CrossTainer Portao'), 'com a unidade de cada colega');
  passou('mostra quem mais está escalado no dia, com a unidade de cada um');

  const depoisDoComVoce = h.split('Com você')[1] || '';
  assert.ok(depoisDoComVoce, 'o rótulo "Com você" existe quando ele está escalado');
  assert.ok(!/vaga aberta|undefined|null/.test(depoisDoComVoce), 'vaga sem ninguém não vira colega fantasma');
  passou('vaga aberta não aparece como colega');

  // ── 2. não publicada: nada vaza ──
  const hRasc = await htmlDaAba([escala({ published: false })]);
  assert.ok(hRasc.includes('montando a escala'), 'segue dizendo que a gestão ainda está montando');
  assert.ok(!hRasc.includes('Karin S.') && !hRasc.includes('Heloisa L.'),
    'nenhum nome de colega antes de publicar — a escala ainda vai mudar');
  assert.ok(!hRasc.includes('CrossTainer Centro Politecnico'), 'nem a unidade vaza antes de publicar');
  passou('escala não publicada não mostra unidade nem colegas');

  // ── 3. quem NÃO foi escalado vê o time, sem posto próprio ──
  const hFora = await htmlDaAba([escala({ slots: [{ ...vagaEu, assignedPersonId: 'karin' }, vagaHelo] })]);
  assert.ok(hFora.includes('Não escalado desta vez'), 'segue dizendo que ele não foi escalado');
  assert.ok(hFora.includes('Escalados:'), 'o rótulo muda de "Com você" para "Escalados"');
  assert.ok(hFora.includes('Karin S.') && hFora.includes('Heloisa L.'), 'e ele vê quem vai trabalhar');
  assert.ok(!hFora.includes('\u{1F4CD}'), 'sem vaga própria, não há linha de posto');
  passou('quem não foi escalado vê o time do dia, sem posto próprio');

  // ── 4. fim de ano: a equipe sai por DIA, dentro do período ──
  {
    const fda = {
      id: 'fda', tipo: 'fim_de_ano', date: '2026-12-24', name: 'Fim de ano', status: 'consolidada', published: true,
      slots: [
        { id: 'd24_cp', day: '2026-12-24', unitId: 'cp', shift: 'manha',       assignedPersonId: 'eu',      startTime: '08:00', endTime: '12:00' },
        { id: 'd24_pp', day: '2026-12-24', unitId: 'pp', shift: 'manha',       assignedPersonId: 'karin',   startTime: '08:00', endTime: '12:00' },
        { id: 'd26_cp', day: '2026-12-26', unitId: 'cp', shift: 'tarde_noite', assignedPersonId: 'heloisa', startTime: '14:00', endTime: '20:00' },
      ],
    };
    const sb = novoSandbox([fda]);
    sb.EscalaSmartState.timeframe = 'todos';
    await sb.renderEscalaPrefs();
    const h = await sb.renderProfFimDeAno('eu');

    const dia24 = h.split('26/12')[0];
    assert.ok(dia24.includes('Karin S.'), 'no dia 24 aparece quem trabalha com ele naquele dia');
    assert.ok(!dia24.includes('Heloisa L.'), 'e NÃO aparece quem trabalha em outro dia do mesmo período');
    assert.ok(dia24.includes('Manhã'), 'o turno da vaga aparece no lugar da modalidade');
    assert.ok(dia24.includes('CrossTainer Centro Politecnico'), 'com a unidade do dia');
    passou('fim de ano mostra a equipe DAQUELE dia, não a do período inteiro');
  }

  // ── 5. dado sujo do banco não vira HTML ──
  const sb = novoSandbox([]);
  sb.EscalaSmartState.units = [{ id: 'cp', name: '<img onerror=1>' }];
  sb.EscalaSmartState.modMap = new Map();
  sb.EscalaSmartState.teacherMap = new Map([['karin', { id: 'karin', name: '<script>alert(1)</script>' }]]);
  const hEsc = sb.escalaEquipeHtml(escala({ slots: [vagaEu, vagaKarin] }), 'eu');
  assert.ok(!/<script>|<img/.test(hEsc), 'nome de pessoa e de unidade saem escapados');
  assert.ok(hEsc.includes('&lt;script&gt;') && hEsc.includes('&lt;img'), 'saem escapados de fato');
  passou('nome de unidade/pessoa vindo do banco sai escapado');

  console.log('\n' + ok + '/' + ok + ' verificações passaram.');
})().catch(e => { console.error('\nFALHOU: ' + e.message); process.exit(1); });
