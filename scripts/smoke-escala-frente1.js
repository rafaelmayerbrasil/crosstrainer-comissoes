'use strict';
// Roda: node scripts/smoke-escala-frente1.js
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'tester' });

(async () => {
  const db = makeFakeDb();
  const d = deps(db);

  // cria 2 escalas e abre em lote com prazo + batchId
  const a = (await SS.createScale({ date: '2026-07-11', tipo: 'sabado', name: 'Sáb 11', slots: [] }, d)).data;
  const b = (await SS.createScale({ date: '2026-07-18', tipo: 'sabado', name: 'Sáb 18', slots: [] }, d)).data;
  await SS.openElection(a.id, { closesAt: '2026-07-08T23:59', batchId: 'batch1' }, d);
  await SS.openElection(b.id, { closesAt: '2026-07-08T23:59', batchId: 'batch1' }, d);

  const ga = (await SS.getScale(a.id, d)).data;
  assert.strictEqual(ga.status, 'janela_aberta', 'status vira janela_aberta');
  assert.strictEqual(ga.windowClosesAt, '2026-07-08T23:59', 'prazo gravado');
  assert.strictEqual(ga.windowBatchId, 'batch1', 'batchId gravado');
  assert.ok(ga.windowOpenedAt, 'carimbo de abertura');
  console.log('✓ openElection com prazo/batch OK');

  // listScalesByBatch agrupa só as do lote
  const byBatch = await SS.listScalesByBatch('batch1', d);
  assert.strictEqual(byBatch.data.length, 2, 'as 2 do lote');
  const ids = byBatch.data.map(s => s.id).sort();
  assert.deepStrictEqual(ids, [a.id, b.id].sort());
  console.log('✓ listScalesByBatch OK');

  // closeElection carimba fechamento
  await SS.closeElection(a.id, d);
  const ca = (await SS.getScale(a.id, d)).data;
  assert.strictEqual(ca.status, 'rascunho', 'volta pra rascunho ao fechar');
  assert.ok(ca.windowClosedAt, 'carimbo de fechamento');
  console.log('✓ closeElection carimba OK');

  console.log('\n✅ smoke-escala-frente1 (Task 2) OK');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
