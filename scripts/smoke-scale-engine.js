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

// ── Piso de justiça ──
const b2 = (over) => Object.assign({ modalityIds: ['TOI'], primaryUnitId: 'cp', merito: 0, diasTrabalhados: 5, divida: 0, pref: null }, over);
// Ana tem mérito alto mas já trabalhou; Dora tem mérito baixo mas NÃO bateu o mínimo (dias 0) → piso ganha
const rPiso = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
  [b2({ id: 'ana', merito: 90, diasTrabalhados: 5 }), b2({ id: 'dora', merito: 5, diasTrabalhados: 0 })], { minMes: 1 });
assert.strictEqual(rPiso.assignments[0].personId, 'dora', 'piso (mínimo do mês) vence o mérito');
assert.strictEqual(rPiso.assignments[0].reason, 'justica');
assert.deepStrictEqual(rPiso.fairnessDelta.dora, { dias: 1, dividaResolvida: 0 }, 'dias +1, sem dívida');

// Dívida prioriza e é resolvida no delta
const rDiv = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
  [b2({ id: 'edu', merito: 5, diasTrabalhados: 0, divida: 0 }), b2({ id: 'fab', merito: 5, diasTrabalhados: 0, divida: 2 })], { minMes: 1 });
assert.strictEqual(rDiv.assignments[0].personId, 'fab', 'maior dívida escolhe primeiro');
assert.strictEqual(rDiv.fairnessDelta.fab.dividaResolvida, 1, 'dívida resolvida no delta');

console.log('✓ smoke-scale-engine: piso de justiça OK');

// ── Preferência e unidade alternada (desempate, mesmo mérito/piso) ──
const b3 = (over) => Object.assign({ modalityIds: ['TOI'], primaryUnitId: 'cp', merito: 20, diasTrabalhados: 5, divida: 0, pref: null }, over);
// Mesmo mérito; gabi quer, hugo neutro → gabi
const rPref = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
  [b3({ id: 'gabi', pref: 'quer' }), b3({ id: 'hugo', pref: null })], {});
assert.strictEqual(rPref.assignments[0].personId, 'gabi', 'quem marcou "quer" desempata pra cima');

// nao_quer vai pro fim (mesmo mérito)
const rNao = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
  [b3({ id: 'ian', pref: 'nao_quer' }), b3({ id: 'joa', pref: null })], {});
assert.strictEqual(rNao.assignments[0].personId, 'joa', '"nao_quer" cede a vaga');

// unidade alternada desempata quando mérito e preferência empatam
const rAlt = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
  [b3({ id: 'kim', primaryUnitId: 'cp' }), b3({ id: 'leo', primaryUnitId: 'norte' })], {});
assert.strictEqual(rAlt.assignments[0].personId, 'leo', 'quem é de outra unidade (alternada) desempata');

console.log('✓ smoke-scale-engine: preferência/unidade alternada OK');
