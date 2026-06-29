'use strict';
// Roda: node scripts/smoke-plr-service.js
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const PS = require('../plr-service.js');
const PE = require('../plr-engine.js');
const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'tester', PE });

(async () => {
  const db = makeFakeDb();
  const d = deps(db);

  // ── Config: default + save + persiste ──
  const c0 = await PS.ConfigService.get(d);
  assert.ok(c0.success && c0.data.blocos.length === 4, 'config default com 4 blocos');
  assert.strictEqual(c0.data.elegibilidade.minMesesCasa, 3, 'default 3 meses');
  await PS.ConfigService.save({ avaliadoresPeso: { coord: 2 } }, d);
  const c1 = await PS.ConfigService.get(d);
  assert.strictEqual(c1.data.avaliadoresPeso.coord, 2, 'peso do coord persiste');
  console.log('✓ smoke-plr-service: config OK');

  // ── Ciclos ──
  const cyc = await PS.saveCycle({ label: '2026/1', inicio: '2026-01-01', fim: '2026-06-30', pool: 4000 }, d);
  assert.ok(cyc.success && cyc.data.id, 'ciclo criado');
  const cid = cyc.data.id;
  const cg = await PS.getCycle(cid, d);
  assert.strictEqual(cg.data.pool, 4000, 'pool gravado');
  assert.strictEqual(cg.data.status, 'aberto', 'nasce aberto');
  const cl = await PS.listCycles(d);
  assert.strictEqual(cl.data.length, 1);
  console.log('✓ smoke-plr-service: ciclos OK');

  // ── Avaliações idempotentes ──
  await PS.upsertEvaluation({ cycleId: cid, evaluateeId: 'p1', evaluatorId: 'a', notas: { profissional: 8, comportamental: 7, tecnica: 6 } }, d);
  await PS.upsertEvaluation({ cycleId: cid, evaluateeId: 'p1', evaluatorId: 'coord', notas: { profissional: 9, comportamental: 9, tecnica: 9 } }, d);
  await PS.upsertEvaluation({ cycleId: cid, evaluateeId: 'p2', evaluatorId: 'a', notas: { profissional: 5, comportamental: 5, tecnica: 5 } }, d);
  await PS.upsertEvaluation({ cycleId: cid, evaluateeId: 'p1', evaluatorId: 'a', notas: { profissional: 8, comportamental: 7, tecnica: 6 }, parecer: 'ok' }, d); // re-upsert
  const evs = await PS.listEvaluationsByCycle(cid, d);
  assert.strictEqual(evs.data.length, 3, '3 avaliações (re-upsert não duplica)');
  console.log('✓ smoke-plr-service: avaliações OK');

  // ── computeResults ponta a ponta ──
  const ctx = {
    pessoas: [
      { id: 'p1', name: 'P1', type: 'efetivo', hireDate: '2026-01-01' },
      { id: 'p2', name: 'P2', type: 'efetivo', hireDate: '2026-01-01' },
      { id: 'p3', name: 'P3', type: 'efetivo', hireDate: '2026-06-01' }, // 0 meses → inelegível
    ],
    horasById: { p1: 100, p2: 50, p3: 80 },
    engajById: { p1: 60, p2: 30, p3: 0 },
  };
  const res = await PS.computeResults(cid, ctx, d);
  assert.ok(res.success, 'computeResults ok');
  const byId = Object.fromEntries(res.data.linhas.map(l => [l.pessoaId, l]));
  assert.strictEqual(byId.p1.nota, 8.7, 'p1 nota 8.70 (coord peso 2 + engaj 10)');
  assert.strictEqual(byId.p2.nota, 5.0, 'p2 nota 5.00');
  assert.strictEqual(byId.p3.elegivel, false, 'p3 inelegível (0 meses)');
  assert.strictEqual(byId.p3.fatia, 0, 'inelegível não recebe');
  assert.strictEqual(byId.p1.fatia, 3107.14, 'p1 fatia = 4000*870/1120');
  assert.strictEqual(res.data.total, 4000, 'soma das fatias = pool');
  console.log('✓ smoke-plr-service: computeResults OK');

  // ── closeCycle grava snapshot + status ──
  const close = await PS.closeCycle(cid, ctx, d);
  assert.ok(close.success, 'closeCycle ok');
  const cg2 = await PS.getCycle(cid, d);
  assert.strictEqual(cg2.data.status, 'fechado', 'ciclo fechado');
  const snap = await db.collection('plr_results').doc(cid).get();
  assert.ok(snap.exists && snap.data().total === 4000, 'snapshot gravado');
  console.log('✓ smoke-plr-service: closeCycle OK');
})();
