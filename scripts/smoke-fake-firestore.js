'use strict';
// Roda: node scripts/smoke-fake-firestore.js
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');

(async () => {
  const db = makeFakeDb();

  // doc().set + get
  await db.collection('c').doc('a').set({ x: 1 });
  let d = await db.collection('c').doc('a').get();
  assert.ok(d.exists && d.id === 'a' && d.data().x === 1, 'set/get doc');

  // set sobrescreve (upsert idempotente por id)
  await db.collection('c').doc('a').set({ x: 2 });
  d = await db.collection('c').doc('a').get();
  assert.strictEqual(d.data().x, 2, 'set sobrescreve mesmo id');

  // add gera id
  const ref = await db.collection('c').add({ y: 9 });
  assert.ok(ref.id, 'add retorna id');

  // collection().get() lista todos
  const all = await db.collection('c').get();
  assert.strictEqual(all.docs.length, 2, 'a + add = 2 docs');

  // where(==)
  await db.collection('e').doc('e1').set({ personId: 'p1', pontos: 5 });
  await db.collection('e').doc('e2').set({ personId: 'p2', pontos: 3 });
  const w = await db.collection('e').where('personId', '==', 'p1').get();
  assert.strictEqual(w.docs.length, 1, 'where filtra');
  assert.strictEqual(w.docs[0].data().pontos, 5);

  // orderBy
  await db.collection('o').doc('o1').set({ inicio: '2026-07-01' });
  await db.collection('o').doc('o2').set({ inicio: '2026-01-01' });
  const ord = await db.collection('o').orderBy('inicio').get();
  assert.deepStrictEqual(ord.docs.map(x => x.data().inicio), ['2026-01-01', '2026-07-01'], 'orderBy asc');

  // batch.set + commit
  const b = db.batch();
  b.set(db.collection('c').doc('b1'), { z: 1 });
  b.set(db.collection('c').doc('b2'), { z: 2 });
  await b.commit();
  assert.strictEqual((await db.collection('c').get()).docs.length, 4, 'batch gravou 2');

  console.log('✓ smoke-fake-firestore: OK');
})();
