'use strict';
// Smoke do bloco 2 (07/08): ocorrências afetando as horas pagas.
// Carrega professores-shared.js REAL num sandbox — não reimplementa a regra.
//
// Roda: node scripts/smoke-ocorrencias-horas.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

const minutos = vm.runInContext('classEffectiveMinutes', sandbox);
const calcHoras = vm.runInContext('calculateTeacherHours', sandbox);

const aula = o => Object.assign({ durationMinutes: 60, status: 'realizada' }, o);

// ════════════ aula normal ════════════
{
  assert.strictEqual(minutos(aula({})), 60);
  console.log('✓ aula sem ocorrência vale a duração cheia');
}

// ════════════ atraso ════════════
{
  assert.strictEqual(minutos(aula({ atrasoMinutos: 15 })), 45);
  console.log('✓ atraso de 15 min: paga 45 de 60');

  // não pode virar crédito negativo e contaminar as outras aulas
  assert.strictEqual(minutos(aula({ atrasoMinutos: 90 })), 0,
    'atraso maior que a aula zera, não fica negativo');
  console.log('✓ atraso maior que a aula zera (não vira desconto de outra)');
}

// ════════════ saída antecipada ════════════
{
  assert.strictEqual(minutos(aula({ saidaAntecipadaMinutos: 20 })), 40);
  console.log('✓ saída antecipada desconta proporcional');

  assert.strictEqual(minutos(aula({ atrasoMinutos: 10, saidaAntecipadaMinutos: 10 })), 40,
    'atraso e saída somam');
  console.log('✓ atraso + saída antecipada somam os descontos');
}

// ════════════ hora extra ════════════
{
  assert.strictEqual(minutos(aula({ horaExtraMinutos: 30 })), 90);
  console.log('✓ hora extra soma proporcional');

  assert.strictEqual(minutos(aula({ atrasoMinutos: 15, horaExtraMinutos: 15 })), 60,
    'chegou tarde mas ficou depois: se compensa');
  console.log('✓ atraso compensado por hora extra fecha a conta');
}

// ════════════ falta ════════════
{
  assert.strictEqual(minutos(aula({ faltaTipo: 'sem_aviso' })), 0);
  assert.strictEqual(minutos(aula({ faltaTipo: 'justificada' })), 0);
  console.log('✓ falta zera as horas — não deu a aula, não recebe (Rodrigo, 07/08)');

  // falta manda em tudo, mesmo com hora extra lançada por engano
  assert.strictEqual(minutos(aula({ faltaTipo: 'sem_aviso', horaExtraMinutos: 60 })), 0);
  console.log('✓ falta manda mesmo se houver extra lançada junto');
}

// ════════════ efeito no total do mês ════════════
{
  const mes = [
    aula({}), aula({}), aula({}), aula({}),        // 4 normais = 240
    aula({ atrasoMinutos: 30 }),                    // 30
    aula({ faltaTipo: 'sem_aviso' }),               // 0
    aula({ horaExtraMinutos: 60 }),                 // 120
  ];
  assert.strictEqual(calcHoras(mes), (240 + 30 + 0 + 120) / 60);
  console.log('✓ total do mês reflete atraso, falta e extra (6.5h)');

  // sem as ocorrências seriam 7 aulas × 1h = 7h
  assert.notStrictEqual(calcHoras(mes), 7);
  console.log('✓ e é diferente de contar tudo cheio (7h)');
}

// ════════════ ocorrência não fura as outras regras ════════════
{
  // Escola Interna com hora extra continua não pagando
  assert.strictEqual(calcHoras([aula({ remunerada: false, horaExtraMinutos: 60 })]), 0);
  console.log('✓ Escola Interna não paga nem com hora extra lançada');

  // feriado em dobro incide sobre os minutos JÁ ajustados
  assert.strictEqual(calcHoras([aula({ isHoliday: true, atrasoMinutos: 30 })]), 1,
    '30 min efetivos × peso 2 = 60 min = 1h');
  console.log('✓ o dobro do feriado incide sobre os minutos já descontados');
}

// ════════════ valores estranhos não quebram ════════════
{
  assert.strictEqual(minutos(aula({ atrasoMinutos: null })), 60);
  assert.strictEqual(minutos(aula({ atrasoMinutos: -30 })), 60, 'negativo é ignorado, não vira bônus');
  assert.strictEqual(minutos(aula({ horaExtraMinutos: -30 })), 60);
  assert.strictEqual(minutos(null), 0);
  assert.strictEqual(minutos(aula({ durationMinutes: 0, horaExtraMinutos: 30 })), 30);
  console.log('✓ nulo, negativo e ausente não quebram nem viram bônus');
}

console.log('\n✅ smoke-ocorrencias-horas OK');
