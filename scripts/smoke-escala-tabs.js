'use strict';
// Roda: node scripts/smoke-escala-tabs.js
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'tester' });

(async () => {
  // ── saturdaysOfYear ──
  const s26 = SS.saturdaysOfYear(2026);
  assert.strictEqual(s26.length, 52, '2026 tem 52 sábados');
  assert.strictEqual(s26[0], '2026-01-03', 'primeiro sábado de 2026');
  assert.strictEqual(s26[s26.length - 1], '2026-12-26', 'último sábado de 2026');
  s26.forEach(d => assert.strictEqual(new Date(d + 'T12:00:00').getDay(), 6, `${d} é sábado`));
  const s28 = SS.saturdaysOfYear(2028); // bissexto começando em sábado
  assert.strictEqual(s28[0], '2028-01-01', '2028 começa num sábado');
  assert.strictEqual(s28.length, 53, '2028 tem 53 sábados');
  console.log('✓ saturdaysOfYear OK');

  // ── mergeVirtualWithDocs ──
  const merged = SS.mergeVirtualWithDocs(
    ['2026-07-04', '2026-07-11', '2026-07-18'],
    [{ id: 'a', date: '2026-07-11', tipo: 'sabado' }, { id: 'b', date: '2026-07-11', tipo: 'sabado' }]
  );
  assert.strictEqual(merged.length, 3, 'uma linha por data');
  assert.strictEqual(merged[0].docs.length, 0, 'sem doc = lista vazia');
  assert.strictEqual(merged[1].docs.length, 2, 'dois docs na mesma data não quebra');
  assert.strictEqual(merged[1].date, '2026-07-11');
  assert.deepStrictEqual(SS.mergeVirtualWithDocs([], []), [], 'vazio ok');
  console.log('✓ mergeVirtualWithDocs OK');

  // ── parseFeriados ──
  const fer = SS.parseFeriados([
    { date: '2026-09-07', name: 'Independência do Brasil', type: 'national' },
    { date: 'xx', name: 'lixo' }, { name: 'sem data' }, null,
  ]);
  assert.deepStrictEqual(fer, [{ date: '2026-09-07', name: 'Independência do Brasil' }], 'só entrada válida passa');
  assert.deepStrictEqual(SS.parseFeriados(null), [], 'não-array = vazio');
  assert.deepStrictEqual(SS.parseFeriados({ erro: true }), [], 'objeto = vazio');
  console.log('✓ parseFeriados OK');

  // ── isLegacyScaleDoc ──
  assert.strictEqual(SS.isLegacyScaleDoc({ date: { seconds: 1781838000 }, name: 'fds' }), true, 'date Timestamp = legado');
  assert.strictEqual(SS.isLegacyScaleDoc({ date: '2026-07-04' }), true, 'sem tipo = legado');
  assert.strictEqual(SS.isLegacyScaleDoc(null), true, 'null = legado');
  assert.strictEqual(SS.isLegacyScaleDoc({ date: '2026-07-04', tipo: 'sabado' }), false, 'formato novo passa');
  console.log('✓ isLegacyScaleDoc OK');

  // ── listScales filtra legado ──
  const db = makeFakeDb();
  const d = deps(db);
  await db.collection('special_scales').doc('leg1').set({ date: { seconds: 1781838000 }, name: 'fds' });
  const cRes = await SS.createScale({ date: '2026-07-04', tipo: 'sabado', name: 'Sábado 04/07', slots: [] }, d);
  assert.ok(cRes.success, 'criou escala nova');
  const l = await SS.listScales(d);
  assert.strictEqual(l.data.length, 1, 'doc legado filtrado da lista');
  assert.strictEqual(l.data[0].tipo, 'sabado');
  console.log('✓ listScales filtra legado OK');

  // ── eventKind no createScale ──
  const eRes = await SS.createScale({ date: '2026-08-15', tipo: 'evento', name: 'Campeonato', slots: [], eventKind: 'externo' }, d);
  assert.strictEqual(eRes.data.eventKind, 'externo', 'eventKind persiste');
  const g = await SS.getScale(eRes.data.id, d);
  assert.strictEqual(g.data.eventKind, 'externo', 'eventKind lido de volta');
  const sRes = await SS.createScale({ date: '2026-07-11', tipo: 'sabado', name: 'Sáb', slots: [] }, d);
  assert.strictEqual(sRes.data.eventKind, null, 'sem eventKind = null');
  console.log('✓ eventKind OK');

  console.log('\n✅ smoke-escala-tabs: tudo OK');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
