'use strict';
// Roda: node scripts/smoke-points-engine.js
const assert = require('assert');
const PE = require('../points-engine.js');
const EC = require('../engagement-config.js');
const cfg = EC.DEFAULT_CONFIG;

// tempoDeCasaPontos(admissao, ref, cfg)
assert.strictEqual(PE.tempoDeCasaPontos('2026-01-01', '2026-06-01', cfg), 10, '<1 ano = faixa 0 = 10');
assert.strictEqual(PE.tempoDeCasaPontos('2024-06-01', '2026-06-01', cfg), 20, '2 anos = faixa 1 = 20');
assert.strictEqual(PE.tempoDeCasaPontos('2023-06-01', '2026-06-01', cfg), 20, '3 anos = faixa 1 = 20');
assert.strictEqual(PE.tempoDeCasaPontos('2022-06-01', '2026-06-01', cfg), 30, '4 anos = faixa 2 = 30');
assert.strictEqual(PE.tempoDeCasaPontos(null, '2026-06-01', cfg), 0, 'sem admissão = 0');

console.log('✓ smoke-points-engine: tempo de casa OK');

// ── Ciclos ──
const cycles = [
  { id: 'c1', inicio: '2026-01-01', fim: '2026-06-30' },
  { id: 'c2', inicio: '2026-07-01', fim: '2026-12-31' },
];
assert.strictEqual(PE.cycleIdFor('2026-03-15', cycles), 'c1', 'data no 1º ciclo');
assert.strictEqual(PE.cycleIdFor('2026-07-01', cycles), 'c2', 'borda inicial inclusiva');
assert.strictEqual(PE.cycleIdFor('2026-12-31', cycles), 'c2', 'borda final inclusiva');
assert.strictEqual(PE.cycleIdFor('2025-12-31', cycles), null, 'fora de qualquer ciclo');

const entries = [
  { personId: 'p1', tipo: 'reuniao', refDate: '2026-03-01', pontos: 8 },
  { personId: 'p1', tipo: 'evento',  refDate: '2026-08-01', pontos: 8 },
];
assert.strictEqual(PE.entriesForCycle(entries, cycles[0]).length, 1, 'só 1 entry no c1');
assert.strictEqual(PE.entriesForCycle(entries, cycles[0])[0].refDate, '2026-03-01');

console.log('✓ smoke-points-engine: ciclos OK');
