'use strict';
// Roda: node scripts/smoke-escala-frente2.js
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const SE = require('../scale-engine.js');
const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'tester', SE });

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

  // ── consolidateByDay respeita dia×turno ──
  const db2 = makeFakeDb(); const d2 = deps(db2);
  const fa2 = (await SS.createScale({ date: '2026-12-26', tipo: 'fim_de_ano', name: 'FdA', slots: [
    { id: 'd1_manha', day: '2026-12-26', unitId: 'u', shift: 'manha', startTime: '08:00', endTime: '12:00', requiredModalityId: null, assignedPersonId: null },
    { id: 'd1_tarde', day: '2026-12-26', unitId: 'u', shift: 'tarde_noite', startTime: '16:00', endTime: '21:00', requiredModalityId: null, assignedPersonId: null },
  ] }, d2)).data;
  // p1 só pode manhã (excluiu tarde), p2 não pode o dia todo, p3 livre
  await SS.openElection(fa2.id, { closesAt: '2999-01-01T00:00' }, d2);
  await SS.setDayPreference(fa2.id, 'p1', '2026-12-26', 'prefiro', ['tarde_noite'], d2);
  await SS.setDayPreference(fa2.id, 'p2', '2026-12-26', 'nao_posso', [], d2);
  const ctx = { teachers: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }, { id: 'p3', name: 'P3' }], meritoById: {}, opts: {} };
  const res = await SS.consolidateByDay(fa2.id, ctx, d2);
  assert.ok(res.success, 'consolidou');
  const g = (await SS.getScale(fa2.id, d2)).data;
  const manha = g.slots.find(s => s.id === 'd1_manha');
  const tarde = g.slots.find(s => s.id === 'd1_tarde');
  assert.notStrictEqual(manha.assignedPersonId, 'p2', 'p2 (nao_posso) não escalado de manhã');
  assert.notStrictEqual(tarde.assignedPersonId, 'p1', 'p1 (excluiu tarde) não escalado à tarde');
  assert.notStrictEqual(tarde.assignedPersonId, 'p2', 'p2 (nao_posso) não escalado à tarde');
  console.log('✓ consolidateByDay respeita dia×turno OK');

  // ── retrocompat: sem day prefs = todos disponíveis (não quebra) ──
  const db3 = makeFakeDb(); const d3 = deps(db3);
  const fa3 = (await SS.createScale({ date: '2026-12-27', tipo: 'fim_de_ano', name: 'FdA3', slots: [
    { id: 'x_manha', day: '2026-12-27', unitId: 'u', shift: 'manha', startTime: '08:00', endTime: '12:00', requiredModalityId: null, assignedPersonId: null },
  ] }, d3)).data;
  const res3 = await SS.consolidateByDay(fa3.id, { teachers: [{ id: 'pa', name: 'PA' }], meritoById: {}, opts: {} }, d3);
  assert.ok(res3.success, 'consolida sem day prefs');
  const g3 = (await SS.getScale(fa3.id, d3)).data;
  assert.strictEqual(g3.slots[0].assignedPersonId, 'pa', 'sem pref = disponível (retrocompat)');
  console.log('✓ consolidateByDay retrocompat OK');

  console.log('\n✅ smoke-escala-frente2 (Task 3) OK');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
