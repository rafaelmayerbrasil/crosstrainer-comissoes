'use strict';
// Smoke do bloco 1 (07/08): Escola Interna fora da conta de horas e vaga em uma
// unidade só. Usa as funções REAIS — ScaleService do arquivo e a regra de horas
// carregada de professores-shared.js num sandbox.
//
// Roda: node scripts/smoke-escola-interna-nao-paga.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ScaleService = require('../scale-service.js');

// ── carrega professores-shared.js pra usar calculateTeacherHours de verdade ──
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
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'substitution-flow.js'), 'utf8'), sandbox, { filename: 'substitution-flow.js' });
// SubstitutionFlow entra pendurado em window (estilo UMD/browser); professores-shared.js
// lê o identificador solto — precisa estar no escopo do contexto antes de carregar.
sandbox.SubstitutionFlow = sandbox.window.SubstitutionFlow;
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'professores-shared.js'), 'utf8'), sandbox, { filename: 'professores-shared.js' });
const calcHoras = vm.runInContext('calculateTeacherHours', sandbox);
const contaPra = vm.runInContext('classCountsForPay', sandbox);

const aula = (over) => Object.assign({ durationMinutes: 60, status: 'realizada' }, over);

// ════════════ 1. o que conta e o que não conta ════════════
{
  assert.strictEqual(contaPra(aula({})), true, 'aula normal conta');
  console.log('✓ aula normal entra na conta de horas');

  // publicadas a partir de 07/08 levam a marca
  assert.strictEqual(contaPra(aula({ remunerada: false })), false);
  console.log('✓ aula marcada como não remunerada fica de fora');

  // publicadas ANTES da marca existir — sem migrar dado
  assert.strictEqual(contaPra(aula({ specialScaleType: 'escola_interna' })), false,
    'escola interna antiga (sem a marca) também não pode contar');
  console.log('✓ Escola Interna antiga, sem a marca, também fica de fora');

  // outras escalas continuam pagando
  assert.strictEqual(contaPra(aula({ specialScaleType: 'feriado', remunerada: true })), true);
  assert.strictEqual(contaPra(aula({ specialScaleType: 'sabado', remunerada: true })), true);
  console.log('✓ feriado e sábado continuam contando');
}

// ════════════ 2. efeito no total de horas ════════════
{
  const semEscola = calcHoras([aula({}), aula({}), aula({})]);
  assert.strictEqual(semEscola, 3, '3 aulas de 1h = 3h');

  const comEscola = calcHoras([
    aula({}), aula({}), aula({}),
    aula({ remunerada: false }),                       // escola interna nova
    aula({ specialScaleType: 'escola_interna' }),      // escola interna antiga
  ]);
  assert.strictEqual(comEscola, 3, 'as duas de escola interna não podem somar');
  console.log('✓ Escola Interna não aumenta as horas do fechamento');

  // o caso real que motivou: 1h/dia por professor, todo dia útil
  const mesInteiro = [];
  for (let i = 0; i < 22; i++) mesInteiro.push(aula({ remunerada: false }));
  assert.strictEqual(calcHoras(mesInteiro), 0, 'um mês de escola interna = 0h pagas');
  console.log('✓ um mês inteiro de Escola Interna soma 0h (seriam 22h indevidas)');
}

// ════════════ 3. feriado segue pagando em dobro ════════════
{
  assert.strictEqual(calcHoras([aula({ isHoliday: true })]), 2,
    'feriado conta em dobro (decisão P02) — o cliente confirmou que mantém');
  console.log('✓ feriado continua valendo em dobro');
}

// ════════════ 4. vaga da Escola Interna em UMA unidade ════════════
{
  const cp = { id: 'cp', name: 'CP' }, pp = { id: 'pp', name: 'PP' };

  const um = ScaleService.escolaInternaSlots([pp], { startTime: '14:30', endTime: '15:30' });
  assert.strictEqual(um.length, 1, 'uma unidade = uma vaga');
  assert.strictEqual(um[0].unitId, 'pp');
  assert.strictEqual(um[0].role, 'lider');
  console.log('✓ gera uma vaga de líder na unidade escolhida');

  // era isso que deixava a CP eternamente "sem líder"
  const duas = ScaleService.escolaInternaSlots([pp, cp], {});
  assert.strictEqual(duas.length, 1, 'mesmo recebendo duas unidades, cria só uma vaga');
  assert.strictEqual(duas[0].unitId, 'pp', 'vale a primeira');
  console.log('✓ nunca cria vaga nas duas unidades ao mesmo tempo');

  assert.deepStrictEqual(ScaleService.escolaInternaSlots([], {}), []);
  assert.deepStrictEqual(ScaleService.escolaInternaSlots(null, {}), []);
  console.log('✓ sem unidade, não inventa vaga');

  const hora = ScaleService.escolaInternaSlots([cp], {});
  assert.strictEqual(hora[0].startTime, '14:30');
  assert.strictEqual(hora[0].endTime, '15:30');
  console.log('✓ horário padrão 14:30–15:30 quando não informado');
}

console.log('\n✅ smoke-escola-interna-nao-paga OK');
