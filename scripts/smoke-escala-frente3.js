'use strict';
// Roda: node scripts/smoke-escala-frente3.js
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'tester' });

(async () => {
  const db = makeFakeDb();
  const d = deps(db);
  const ev = (await SS.createScale({ date: '2026-08-15', tipo: 'evento', name: 'Campeonato', slots: [], eventKind: 'externo' }, d)).data;

  // define staff: p1/p2 obrigatórios, p3 opcional
  const r = await SS.setEventStaff(ev.id, ['p1', 'p2'], ['p3'], d);
  assert.ok(r.success, 'setEventStaff ok');
  assert.deepStrictEqual(r.data.added.sort(), ['p1', 'p2', 'p3'], 'todos recém-adicionados');
  let list = (await SS.listEventRsvp(ev.id, d)).data;
  assert.strictEqual(list.length, 3, '3 no staff');
  const byId = Object.fromEntries(list.map(x => [x.personId, x]));
  assert.strictEqual(byId.p1.tier, 'obrigatorio'); assert.strictEqual(byId.p1.going, true, 'obrigatório nasce Vou');
  assert.strictEqual(byId.p3.tier, 'opcional');    assert.strictEqual(byId.p3.going, null, 'opcional nasce aberto');
  console.log('✓ setEventStaff defaults OK');

  // p3 responde Vou
  const rsvp = await SS.setRsvp(ev.id, 'p3', true, d);
  assert.ok(rsvp.success, 'setRsvp ok');
  // reconcilia: remove p2, mantém p1/p3 (preserva going), adiciona p4
  const r2 = await SS.setEventStaff(ev.id, ['p1'], ['p3', 'p4'], d);
  assert.deepStrictEqual(r2.data.added, ['p4'], 'só p4 é novo');
  list = (await SS.listEventRsvp(ev.id, d)).data;
  const ids = list.map(x => x.personId).sort();
  assert.deepStrictEqual(ids, ['p1', 'p3', 'p4'], 'p2 removido');
  const byId2 = Object.fromEntries(list.map(x => [x.personId, x]));
  assert.strictEqual(byId2.p3.going, true, 'resposta de p3 preservada');
  assert.strictEqual(byId2.p3.tier, 'opcional', 'p3 segue opcional');
  console.log('✓ setEventStaff reconcilia OK');

  // setRsvp em quem não é staff = erro
  const bad = await SS.setRsvp(ev.id, 'pX', true, d);
  assert.strictEqual(bad.success, false, 'não-staff não pode responder');
  console.log('✓ setRsvp guard OK');

  // ── summarizeRsvp (puro) ──
  const sum = SS.summarizeRsvp([
    { personId: 'a', going: true }, { personId: 'b', going: false },
    { personId: 'c', going: null }, { personId: 'd' },
  ]);
  assert.deepStrictEqual(sum.vao, ['a'], 'vão');
  assert.deepStrictEqual(sum.naoVao, ['b'], 'não vão');
  assert.deepStrictEqual(sum.semResposta.sort(), ['c', 'd'], 'sem resposta (null/undefined)');
  console.log('✓ summarizeRsvp OK');

  console.log('\n✅ smoke-escala-frente3 (Task 2) OK');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
