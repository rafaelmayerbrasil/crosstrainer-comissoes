'use strict';
// Roda: node scripts/smoke-scale-service.js
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const SE = require('../scale-engine.js');
const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'tester', SE });

(async () => {
  // templateSlots (puro)
  const slots = SS.templateSlots('sabado', [{ id: 'cp' }, { id: 'norte' }]);
  assert.strictEqual(slots.length, 4, '2 unidades x 2 papéis = 4 slots');
  assert.deepStrictEqual(slots.find(s => s.id === 'cp_TOI'), { id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: null });
  assert.strictEqual(SS.templateSlots('evento', [{ id: 'cp' }]).length, 0, 'evento sem template');

  const db = makeFakeDb();
  const d = deps(db);
  // createScale
  const cRes = await SS.createScale({ date: '2026-07-04', tipo: 'sabado', name: 'Sábado 04/07', slots }, d);
  assert.ok(cRes.success && cRes.data.id, 'criou escala');
  const id = cRes.data.id;
  let g = await SS.getScale(id, d);
  assert.strictEqual(g.data.status, 'rascunho', 'nasce rascunho');
  assert.strictEqual(g.data.slots.length, 4);

  // transições de status
  await SS.openElection(id, d);
  g = await SS.getScale(id, d);
  assert.strictEqual(g.data.status, 'janela_aberta', 'abriu eleição');

  // listScales
  const l = await SS.listScales(d);
  assert.strictEqual(l.data.length, 1);

  console.log('✓ smoke-scale-service: CRUD/template OK');
})();
