'use strict';
// Smoke da Agenda Geral em 2 modos (12/08/2026): grade por horário quando o
// filtro é um dia, lista organizada (por unidade, selo só quando foge do
// normal) quando é semana/mês. Decisão do Rodrigo em resposta à proposta
// proposta-agenda-geral.html. Carrega os ARQUIVOS REAIS num sandbox mínimo.
//
// Roda: node scripts/smoke-agenda-geral-dia-lista.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');

const noop = () => {};
const chain = () => new Proxy(function () {}, { get: () => chain(), apply: () => chain() });
const sandbox = {
  console: { log: noop, warn: noop, error: noop },
  window: {}, document: { addEventListener: noop, getElementById: () => null },
  firebase: { firestore: Object.assign(chain(), { FieldValue: { serverTimestamp: noop }, Timestamp: { now: noop, fromDate: (d) => ({ toDate: () => d }) } }), auth: chain, apps: [] },
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
sandbox.ProfHelpers = sandbox.ProfHelpers || sandbox.window.ProfHelpers;
carregar('professores-agenda.js');

const {
  getDayRange, groupClassesByUnit, buildDayGrid, isAbnormalStatus, shortenName,
} = sandbox;
const AgendaState = vm.runInContext('AgendaState', sandbox);

// ════════════════ 1. getDayRange ════════════════
{
  const d = new Date(2026, 7, 15); // 15/08/2026 (mês 0-index)
  const { from, to } = getDayRange(d);
  assert.strictEqual(from.getHours(), 0);
  assert.strictEqual(from.getMinutes(), 0);
  assert.strictEqual(to.getHours(), 23);
  assert.strictEqual(to.getMinutes(), 59);
  assert.strictEqual(from.getDate(), 15);
  assert.strictEqual(to.getDate(), 15, 'não pode vazar pro dia seguinte');
  console.log('✓ getDayRange cobre só o dia (00:00 a 23:59:59)');
}

// ════════════════ 2. isAbnormalStatus ════════════════
{
  assert.strictEqual(isAbnormalStatus('prevista'), false, 'prevista é o normal, não pode virar selo');
  assert.strictEqual(isAbnormalStatus('realizada'), false, 'realizada também é resultado normal');
  assert.strictEqual(isAbnormalStatus('cancelada'), true);
  assert.strictEqual(isAbnormalStatus('substituida'), true);
  assert.strictEqual(isAbnormalStatus('nao_realizada'), true);
  console.log('✓ só cancelada/substituída/não-realizada viram selo — prevista e realizada ficam quietas');
}

// ════════════════ 3. groupClassesByUnit (Opção A — lista) ════════════════
{
  AgendaState.units = [{ id: 'u1', name: 'CrossTainer CP' }, { id: 'u2', name: 'CrossTainer PP' }];
  const classes = [
    { id: 'c1', unitId: 'u2', startTime: '08:00' },
    { id: 'c2', unitId: 'u1', startTime: '09:00' },
    { id: 'c3', unitId: 'u1', startTime: '07:00' },
  ];
  // Array.from() força pra um array do realm do host — arrays criados DENTRO
  // do sandbox vm têm outro Array.prototype, e deepStrictEqual compara o
  // protótipo (falso-negativo, não bug real).
  const groups = groupClassesByUnit(classes, AgendaState.units);
  assert.strictEqual(groups.length, 2, 'só entram unidades que têm aula');
  assert.strictEqual(groups[0].unit.id, 'u1', 'segue a ordem de AgendaState.units, não a ordem de chegada');
  assert.deepStrictEqual(Array.from(groups[0].items, c => c.id), ['c3', 'c2'], 'dentro da unidade, ordena por horário');
  assert.strictEqual(groups[1].unit.id, 'u2');
  console.log('✓ agrupa por unidade na ordem do cadastro, aulas ordenadas por horário dentro do grupo');

  const vazio = groupClassesByUnit([], AgendaState.units);
  assert.strictEqual(vazio.length, 0, 'sem aula não pode gerar grupo fantasma');
  console.log('✓ sem aulas não gera grupo vazio');
}

// ════════════════ 4. buildDayGrid (Opção B — grade) ════════════════
{
  AgendaState.units = [{ id: 'u1', name: 'CrossTainer CP' }, { id: 'u2', name: 'CrossTainer PP' }];
  const classes = [
    { id: 'c1', unitId: 'u1', startTime: '08:00', endTime: '09:00' },
    { id: 'c2', unitId: 'u2', startTime: '08:00', endTime: '09:00' },
    { id: 'c3', unitId: 'u1', startTime: '08:00', endTime: '09:00' }, // 2ª aula no mesmo horário/unidade
    { id: 'c4', unitId: 'u2', startTime: '10:00', endTime: '11:00' },
  ];
  const grid = buildDayGrid(classes, ['u1', 'u2'], AgendaState.units);

  assert.strictEqual(grid.units.length, 2);
  assert.deepStrictEqual(Array.from(grid.times), ['08:00', '10:00'], 'linhas = horários distintos, em ordem cronológica');

  const linha0800 = grid.rows.find(r => r.time === '08:00');
  assert.strictEqual(linha0800.cellsByUnit.u1.length, 2, 'duas aulas na mesma unidade/horário empilham na célula');
  assert.strictEqual(linha0800.cellsByUnit.u2.length, 1);

  const linha1000 = grid.rows.find(r => r.time === '10:00');
  assert.strictEqual(linha1000.cellsByUnit.u1.length, 0, 'célula sem aula fica com array vazio (não falta a chave)');
  console.log('✓ grade: linhas por horário distinto, colunas por unidade, células empilham aulas concorrentes');

  const gridVazia = buildDayGrid([], ['u1'], AgendaState.units);
  assert.strictEqual(gridVazia.times.length, 0, 'sem aula no dia, sem linha nenhuma');
  console.log('✓ dia sem aula nenhuma não gera linha');
}

// ════════════════ 5. shortenName (regressão do ajuste desta sessão) ════════════════
{
  assert.strictEqual(shortenName('Louise Gabrielle Alfeu dos Anjos'), 'Louise A.',
    'primeiro nome + inicial do ÚLTIMO sobrenome, não do primeiro');
  assert.strictEqual(shortenName('Rafael Brasil'), 'Rafael B.');
  assert.strictEqual(shortenName('Karin'), 'Karin', 'nome único não ganha ponto');
  assert.strictEqual(shortenName(''), '—');
  console.log('✓ shortenName no formato "Primeiro Nome I." (invertido do "I. Sobrenome" antigo)');
}

console.log('\n✅ smoke-agenda-geral-dia-lista OK');
