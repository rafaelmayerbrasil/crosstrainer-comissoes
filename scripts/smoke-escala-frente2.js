'use strict';
// Roda: node scripts/smoke-escala-frente2.js
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'tester' });

(async () => {
  const db = makeFakeDb();
  const d = deps(db);

  // fim de ano com janela aberta
  const fa = (await SS.createScale({ date: '2026-12-21', tipo: 'fim_de_ano', name: 'Fim de ano 2026', slots: [
    { id: '2026-12-26_unit-cp_manha_1', day: '2026-12-26', unitId: 'unit-cp', shift: 'manha', startTime: '08:00', endTime: '12:00', requiredModalityId: null, assignedPersonId: null },
    { id: '2026-12-26_unit-cp_tarde_noite_1', day: '2026-12-26', unitId: 'unit-cp', shift: 'tarde_noite', startTime: '16:00', endTime: '21:00', requiredModalityId: null, assignedPersonId: null },
  ] }, d)).data;
  await SS.openElection(fa.id, { closesAt: '2999-01-01T00:00' }, d);

  // grava preferência por data dentro do prazo
  const ok = await SS.setDayPreference(fa.id, 'p1', '2026-12-26', 'prefiro', ['tarde_noite'], d);
  assert.ok(ok.success, 'setDayPreference dentro do prazo');
  const listed = await SS.listDayPreferences(fa.id, d);
  assert.strictEqual(listed.data.length, 1, 'uma pref por data');
  assert.strictEqual(listed.data[0].pref, 'prefiro');
  assert.deepStrictEqual(listed.data[0].excludedShifts, ['tarde_noite'], 'turno excluído gravado');
  assert.strictEqual(listed.data[0].date, '2026-12-26');
  console.log('✓ setDayPreference/listDayPreferences OK');

  // fora do prazo: recusa
  await SS.openElection(fa.id, { closesAt: '2000-01-01T00:00' }, d);
  const blocked = await SS.setDayPreference(fa.id, 'p1', '2026-12-26', 'prefiro', [], d);
  assert.strictEqual(blocked.success, false, 'recusa após prazo');
  assert.match(blocked.error, /encerrada|prazo/i);
  console.log('✓ setDayPreference respeita prazo OK');

  // ── dayPrefsToAvailability (puro) ──
  const av = SS.dayPrefsToAvailability([
    { personId: 'p1', date: '2026-12-26', pref: 'prefiro', excludedShifts: ['tarde_noite'] },
    { personId: 'p2', date: '2026-12-26', pref: 'nao_posso', excludedShifts: [] },
  ]);
  assert.strictEqual(av.p1['2026-12-26'].pref, 'prefiro', 'pref por data');
  assert.deepStrictEqual(av.p1['2026-12-26'].excludedShifts, ['tarde_noite']);
  assert.strictEqual(av.p2['2026-12-26'].pref, 'nao_posso');
  assert.deepStrictEqual(SS.dayPrefsToAvailability([]), {}, 'vazio = {}');
  console.log('✓ dayPrefsToAvailability OK');

  // ── isPersonAssigned (puro) ──
  const sc = { slots: [{ assignedPersonId: 'p1' }, { assignedPersonId: null }, { assignedPersonId: 'p3' }] };
  assert.strictEqual(SS.isPersonAssigned(sc, 'p1'), true, 'escalado');
  assert.strictEqual(SS.isPersonAssigned(sc, 'p2'), false, 'não escalado');
  assert.strictEqual(SS.isPersonAssigned({ slots: [] }, 'p1'), false, 'sem slots = false');
  assert.strictEqual(SS.isPersonAssigned(null, 'p1'), false, 'null = false');
  console.log('✓ isPersonAssigned OK');

  console.log('\n✅ smoke-escala-frente2 (Task 2) OK');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
