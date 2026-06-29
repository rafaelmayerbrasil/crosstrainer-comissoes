'use strict';
// Roda: node scripts/smoke-plr-engine.js
const assert = require('assert');
const E = require('../plr-engine.js');

// ── média ponderada (Coord peso 2 puxa) ──
const evals = [
  { evaluatorId: 'a', notas: { profissional: 8, comportamental: 7, tecnica: 6 } },
  { evaluatorId: 'coord', notas: { profissional: 9, comportamental: 9, tecnica: 9 } },
];
const pesos = { coord: 2 };
assert.strictEqual(Math.round(E.blocoNotaPonderada(evals, 'profissional', pesos) * 1000) / 1000, 8.667, 'prof ponderada (8*1+9*2)/3');
assert.strictEqual(E.blocoNotaPonderada([], 'profissional', pesos), 0, 'sem avaliação = 0');
assert.strictEqual(E.blocoNotaPonderada(evals, 'tecnica', null), 7.5, 'sem peso = média simples (6+9)/2');
console.log('✓ smoke-plr-engine: bloco ponderado OK');

// ── normalização engajamento ──
assert.strictEqual(E.normalizarEngajamento(30, 60), 5, '30/60 → 5');
assert.strictEqual(E.normalizarEngajamento(10, 0), 0, 'max 0 → 0');
assert.strictEqual(E.normalizarEngajamento(80, 40), 10, 'clamp em 10');
console.log('✓ smoke-plr-engine: normalização OK');

// ── nota final (blocos ponderados + engajamento auto) ──
const config = {
  blocos: [
    { id: 'profissional', peso: 30 }, { id: 'comportamental', peso: 30 },
    { id: 'tecnica', peso: 20 }, { id: 'engajamento', peso: 20, auto: true },
  ],
  avaliadoresPeso: { coord: 2 },
  elegibilidade: { minMesesCasa: 3, minSaldoPontos: null, estagiarioEntra: true },
};
assert.strictEqual(E.notaFinal(evals, 30, 60, config), 7.7, 'nota final ponderada = 7.70');
// redistribuição: se engajamento sai (peso 0), os pesos restantes se renormalizam
const cfgSemEngaj = { blocos: config.blocos.map(b => b.auto ? Object.assign({}, b, { peso: 0 }) : b), avaliadoresPeso: { coord: 2 } };
const nSemEngaj = E.notaFinal(evals, 30, 60, cfgSemEngaj);
assert.ok(nSemEngaj > 8.0 && nSemEngaj < 8.6, 'sem engajamento, nota sobe (só blocos avaliados)');
console.log('✓ smoke-plr-engine: nota final OK');

// ── elegibilidade ──
assert.strictEqual(E.mesesEntre('2026-01-01', '2026-06-27'), 5, '5 meses');
assert.strictEqual(E.elegivel({ type: 'efetivo', hireDate: '2026-04-01' }, config, '2026-06-27').ok, false, '2 meses < 3 = inelegível');
assert.strictEqual(E.elegivel({ type: 'efetivo', hireDate: '2026-01-01' }, config, '2026-06-27').ok, true, '5 meses = elegível');
assert.strictEqual(E.elegivel({ type: 'estagiario', hireDate: '2026-01-01' }, config, '2026-06-27').ok, true, 'estagiário entra (default)');
const cfgSemEstag = Object.assign({}, config, { elegibilidade: { minMesesCasa: 3, estagiarioEntra: false } });
assert.strictEqual(E.elegivel({ type: 'estagiario', hireDate: '2026-01-01' }, cfgSemEstag, '2026-06-27').ok, false, 'estagiário fora quando configurado');
console.log('✓ smoke-plr-engine: elegibilidade OK');

// ── rateio (soma exatamente o pool) ──
const dist = E.distribuir(4000, [{ id: 'x', horas: 100, nota: 8 }, { id: 'y', horas: 50, nota: 6 }]);
const soma = Math.round(dist.reduce((s, l) => s + l.fatia, 0) * 100) / 100;
assert.strictEqual(soma, 4000, 'soma das fatias = pool exato');
assert.strictEqual(dist.find(l => l.id === 'x').fatia, 2909.09, 'x = 4000*800/1100');
assert.deepStrictEqual(E.distribuir(4000, [{ id: 'z', horas: 0, nota: 0 }]), [{ id: 'z', fatia: 0 }], 'denom 0 → fatia 0');
console.log('✓ smoke-plr-engine: rateio OK');
