'use strict';
// Smoke das correções de 04/08: ordem cronológica na agenda, rótulo de escala
// especial e cor por modalidade. Carrega os ARQUIVOS REAIS num sandbox com
// stubs mínimos de firebase — não reimplementa a lógica.
//
// Roda: node scripts/smoke-agenda-cores-ordem.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');

// ─── sandbox com o mínimo que os arquivos tocam no carregamento ─────────
const noop = () => {};
const chain = () => new Proxy(function () {}, { get: () => chain(), apply: () => chain() });
const sandbox = {
  console: { log: noop, warn: noop, error: noop },
  window: {}, document: { addEventListener: noop, getElementById: () => null },
  firebase: { firestore: Object.assign(chain(), { FieldValue: { serverTimestamp: noop }, Timestamp: { now: noop } }), auth: chain, apps: [] },
  db: chain(), auth: chain(),
  setTimeout, clearTimeout, Map, Set, Date, Math, JSON, String, Number, Array, Object, Boolean, RegExp, Promise, Error,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function carregar(arquivo) {
  vm.runInContext(fs.readFileSync(path.join(raiz, arquivo), 'utf8'), sandbox, { filename: arquivo });
}

carregar('substitution-flow.js');
// SubstitutionFlow entra pendurado em window (estilo UMD/browser); professores-shared.js
// lê o identificador solto — precisa estar no escopo do contexto antes de carregar.
sandbox.SubstitutionFlow = sandbox.window.SubstitutionFlow;
carregar('professores-shared.js');
// professores-agenda.js precisa dos globais que o shared expõe
sandbox.ProfHelpers = sandbox.ProfHelpers || sandbox.window.ProfHelpers;
carregar('professores-agenda.js');

// `function` de topo vira global no contexto; `const` (AgendaState, ProfHelpers)
// fica no escopo do script — esses precisam ser lidos avaliando a expressão.
const { sortByStartTime, classDisplayName, classAccentColor } = sandbox;
const AgendaState = vm.runInContext('AgendaState', sandbox);
const H = vm.runInContext('ProfHelpers', sandbox);

// ════════════════ 1. ordem cronológica ════════════════
{
  // exatamente a bagunça que apareceu no print do cliente
  const aulas = [
    { startTime: '09:00' }, { startTime: '18:30' }, { startTime: '14:00' },
    { startTime: '16:00' }, { startTime: '08:00' }, { startTime: '13:45' },
    { startTime: '14:30' }, { startTime: '07:00' },
  ];
  const ordenado = sortByStartTime(aulas.slice()).map(a => a.startTime);
  assert.deepStrictEqual(ordenado,
    ['07:00', '08:00', '09:00', '13:45', '14:00', '14:30', '16:00', '18:30'],
    'agenda deve ficar em ordem cronológica');
  console.log('✓ ordena as aulas do dia por horário');

  // meia-noite e horário sem zero à esquerda não podem furar a ordem
  assert.deepStrictEqual(
    sortByStartTime([{ startTime: '10:00' }, { startTime: '00:30' }, { startTime: '09:59' }]).map(a => a.startTime),
    ['00:30', '09:59', '10:00'], 'HH:MM com zero à esquerda ordena como texto');
  console.log('✓ 00:30 vem antes de 09:59 e de 10:00');

  assert.doesNotThrow(() => sortByStartTime([{ startTime: null }, { startTime: '08:00' }]),
    'não pode quebrar com horário ausente');
  console.log('✓ tolera aula sem horário');
}

// ════════════════ 2. rótulo da escala especial ════════════════
{
  AgendaState.modalitiesMap = new Map([['m1', { id: 'm1', name: 'TOI', color: '#FF8A3D' }]]);

  assert.strictEqual(classDisplayName({ modalityId: 'm1' }), 'TOI');
  console.log('✓ aula normal mostra o nome da modalidade');

  // era isso que aparecia como "—" na agenda do cliente
  assert.strictEqual(
    classDisplayName({ modalityId: null, specialScaleId: 'esc1', specialScaleType: 'escola_interna' }),
    'Escola Interna', 'escola interna precisa aparecer com nome');
  console.log('✓ Escola Interna deixa de aparecer como "—"');

  assert.strictEqual(
    classDisplayName({ modalityId: null, specialScaleId: 'e2', specialScaleType: 'evento' }), 'Evento');
  console.log('✓ evento também tem rótulo');

  // sem modalidade e sem escala: quem chama decide o fallback
  assert.strictEqual(classDisplayName({ modalityId: null }), null);
  console.log('✓ sem modalidade e sem escala devolve null');
}

// ════════════════ 3. cor por modalidade ════════════════
{
  AgendaState.modalitiesMap = new Map([
    ['m1', { id: 'm1', name: 'TOI', color: '#FF8A3D' }],
    ['m2', { id: 'm2', name: 'Antiga sem cor' }],
  ]);

  assert.strictEqual(classAccentColor({ modalityId: 'm1', status: 'prevista' }), '#FF8A3D');
  console.log('✓ usa a cor escolhida no cadastro da modalidade');

  // modalidade criada antes da cor existir não pode sumir da tela
  assert.strictEqual(
    classAccentColor({ modalityId: 'm2', status: 'prevista' }),
    H.CLASS_STATUS_COLOR.prevista.border, 'sem cor cai no status, como antes');
  console.log('✓ modalidade antiga sem cor continua funcionando');

  assert.strictEqual(
    classAccentColor({ modalityId: null, specialScaleType: 'escola_interna', status: 'prevista' }),
    H.SPECIAL_SCALE_COLOR);
  console.log('✓ escola interna tem cor própria');
}

// ════════════════ 4. paleta fechada ════════════════
{
  assert.ok(H.MODALITY_PALETTE.length >= 6, 'paleta precisa de opções suficientes');
  assert.strictEqual(new Set(H.MODALITY_PALETTE.map(c => c.hex.toLowerCase())).size,
    H.MODALITY_PALETTE.length, 'não pode ter cor repetida na paleta');
  console.log(`✓ paleta com ${H.MODALITY_PALETTE.length} cores distintas`);

  assert.strictEqual(H.isValidModalityColor('#FF8A3D'), true);
  assert.strictEqual(H.isValidModalityColor('#ff8a3d'), true, 'aceita maiúscula/minúscula');
  console.log('✓ aceita cor da paleta em qualquer caixa');

  // impede cor arbitrária vinda de fora do formulário
  [null, undefined, '', 'red', '#000000', '#123456', 'javascript:alert(1)', 42].forEach(v =>
    assert.strictEqual(H.isValidModalityColor(v), false, `deveria recusar ${JSON.stringify(v)}`));
  console.log('✓ recusa qualquer cor fora da paleta');

  assert.ok(H.isValidModalityColor(H.MODALITY_COLOR_DEFAULT), 'a cor padrão tem que estar na paleta');
  console.log('✓ cor padrão pertence à paleta');
}

console.log('\n✅ smoke-agenda-cores-ordem OK');
