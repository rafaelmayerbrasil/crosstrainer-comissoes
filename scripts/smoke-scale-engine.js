'use strict';
// Roda: node scripts/smoke-scale-engine.js
const assert = require('assert');
const SE = require('../scale-engine.js');

const slots = [
  { id: 's_toi',  unitId: 'cp', requiredModalityId: 'TOI' },
  { id: 's_hiit', unitId: 'cp', requiredModalityId: 'HIIT' },
];
// Sem dívida e todos já bateram o mínimo (diasTrabalhados>=minMes) → decide por mérito.
const base = (over) => Object.assign({ modalityIds: [], primaryUnitId: 'cp', merito: 0, diasTrabalhados: 5, divida: 0, pref: null }, over);
const candidates = [
  base({ id: 'ana',   modalityIds: ['TOI', 'HIIT'], merito: 30 }),
  base({ id: 'bru',   modalityIds: ['HIIT'],        merito: 50 }),
  base({ id: 'cleo',  modalityIds: ['TOI'],         merito: 10 }),
];

const r = SE.consolidate(slots, candidates, { minMes: 1 });
const bySlot = Object.fromEntries(r.assignments.map(a => [a.slotId, a]));
// TOI: elegíveis ana(30) e cleo(10) → ana (maior mérito)
assert.strictEqual(bySlot.s_toi.personId, 'ana', 'TOI vai pra Ana (mérito)');
assert.strictEqual(bySlot.s_toi.reason, 'merito');
// HIIT: elegíveis bru(50) e ana(30) — mas ana já foi alocada → bru
assert.strictEqual(bySlot.s_hiit.personId, 'bru', 'HIIT vai pra Bru (Ana já alocada, sem dupla)');

// Slot sem elegível → personId null
const r2 = SE.consolidate([{ id: 'x', unitId: 'cp', requiredModalityId: 'YOGA' }], candidates, {});
assert.strictEqual(r2.assignments[0].personId, null, 'sem habilitado = vaga vazia');
assert.strictEqual(r2.assignments[0].reason, 'sem_elegivel');

// nao_posso exclui
const r3 = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
  [base({ id: 'ana', modalityIds: ['TOI'], merito: 99, pref: 'nao_posso' }), base({ id: 'cleo', modalityIds: ['TOI'], merito: 10 })], {});
assert.strictEqual(r3.assignments[0].personId, 'cleo', 'nao_posso exclui Ana mesmo com mérito alto');

console.log('✓ smoke-scale-engine: elegibilidade/mérito OK');
