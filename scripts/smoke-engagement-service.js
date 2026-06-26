'use strict';
// Roda: node scripts/smoke-engagement-service.js
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const ES = require('../engagement-service.js');
const EC = require('../engagement-config.js');
const PE = require('../points-engine.js');

// deps injetadas: db fake + timestamp/uid determinísticos + engine/config
function mkDeps(db) { return { db, ts: () => 'TS', uid: () => 'tester', PE, EC }; }

(async () => {
  const db = makeFakeDb();
  const deps = mkDeps(db);

  // getConfig sem doc → defaults
  let r = await ES.getConfig(deps);
  assert.ok(r.success && r.data.pts.reuniaoStaff === 8, 'getConfig defaults');

  // saveConfig grava overrides; getConfig mescla
  await ES.saveConfig({ pts: { reuniaoStaff: 12 } }, deps);
  r = await ES.getConfig(deps);
  assert.strictEqual(r.data.pts.reuniaoStaff, 12, 'override aplicado');
  assert.strictEqual(r.data.pts.escolaInternaParticipar, 1, 'demais preservados');

  console.log('✓ smoke-engagement-service: config OK');

  // ── recordAttendance ──
  const att = {
    id: 'att1', kind: 'escola_interna', date: '2026-03-05', unitId: 'unit-cp',
    records: [{ personId: 'p1', status: 'presente', role: 'lider' }, { personId: 'p2', status: 'presente' }],
  };
  let rec = await ES.recordAttendance(att, deps);
  assert.ok(rec.success && rec.data.entriesCount === 2, 'gerou 2 lançamentos');
  // doc da chamada gravado
  const attDoc = await db.collection('attendance').doc('att1').get();
  assert.ok(attDoc.exists && attDoc.data().kind === 'escola_interna', 'attendance gravado');
  // entries gravadas com id estável
  let e1 = await db.collection('point_entries').doc('att1:p1').get();
  assert.strictEqual(e1.data().pontos, 2, 'líder = 2 pts');
  // reprocessar: muda status do p1 p/ participante; não duplica, atualiza pontos
  att.records[0] = { personId: 'p1', status: 'presente' };
  rec = await ES.recordAttendance(att, deps);
  e1 = await db.collection('point_entries').doc('att1:p1').get();
  assert.strictEqual(e1.data().pontos, 1, 'reprocesso atualizou p/ 1 pt');
  const total = (await db.collection('point_entries').get()).docs.length;
  assert.strictEqual(total, 2, 'sem duplicação (ainda 2 entries: att1:p1, att1:p2)');

  console.log('✓ smoke-engagement-service: recordAttendance OK');

  // ── Substituição (proatividade) ──
  const sub = await ES.awardSubstitution('sub42', 'p1', '2026-03-12', deps);
  assert.strictEqual(sub.data.id, 'sub:sub42:p1');
  const subDoc = await db.collection('point_entries').doc('sub:sub42:p1').get();
  assert.strictEqual(subDoc.data().pontos, 3, 'proatividade = 3 pts');

  // ── Ciclos ──
  await ES.saveCycle({ id: 'c1', inicio: '2026-01-01', fim: '2026-06-30', label: '1º sem' }, deps);
  await ES.saveCycle({ id: 'c2', inicio: '2026-07-01', fim: '2026-12-31', label: '2º sem' }, deps);
  const cyc = await ES.listCycles(deps);
  assert.strictEqual(cyc.data.length, 2, '2 ciclos');
  assert.strictEqual(ES.currentCycle(cyc.data, '2026-03-15').id, 'c1', 'ciclo atual por data');
  // deleteCycle remove o ciclo
  await ES.deleteCycle('c2', deps);
  const cyc2 = await ES.listCycles(deps);
  assert.strictEqual(cyc2.data.length, 1, 'após deleteCycle resta 1');
  assert.strictEqual(cyc2.data[0].id, 'c1', 'c1 permaneceu');

  // ── Placar ── (p1: líder 1pt[att] já virou 1 + proatividade 3 = 4; + tempo de casa)
  // admissão 2024-06-01, fim do ciclo 2026-06-30 → 2 anos completos → faixa 1 → 20 pts
  const sb = await ES.scoreboard('p1', '2024-06-01', cyc.data[0], deps);
  assert.strictEqual(sb.data.tempoCasa, 20, 'tempo de casa');
  assert.strictEqual(sb.data.porTipo.proatividade_substituicao, 3);
  assert.strictEqual(sb.data.total, 1 /*escola_interna*/ + 3 /*subst*/ + 20 /*casa*/, 'total do placar');

  console.log('✓ smoke-engagement-service: placar/ciclos OK');
})();
