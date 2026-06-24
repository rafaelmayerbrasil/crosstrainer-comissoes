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
