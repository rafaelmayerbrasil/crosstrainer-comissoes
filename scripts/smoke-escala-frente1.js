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

  // ── isWindowOpen (puro) ──
  assert.strictEqual(SS.isWindowOpen({ status: 'janela_aberta', windowClosesAt: '2026-07-10T23:59' }, '2026-07-08T10:00'), true, 'aberta antes do prazo');
  assert.strictEqual(SS.isWindowOpen({ status: 'janela_aberta', windowClosesAt: '2026-07-10T23:59' }, '2026-07-11T00:00'), false, 'fechada após o prazo');
  assert.strictEqual(SS.isWindowOpen({ status: 'janela_aberta' }, '2026-07-11T00:00'), true, 'sem prazo = aberta enquanto status permitir');
  assert.strictEqual(SS.isWindowOpen({ status: 'consolidada', windowClosesAt: '2999-01-01T00:00' }, '2026-07-08T10:00'), false, 'status não-aberto = fechada');
  console.log('✓ isWindowOpen OK');

  // ── setPreference recusa após o prazo ──
  const c = (await SS.createScale({ date: '2026-07-25', tipo: 'sabado', name: 'Sáb 25', slots: [] }, d)).data;
  await SS.openElection(c.id, { closesAt: '2000-01-01T00:00' }, d); // prazo no passado
  const blocked = await SS.setPreference(c.id, 'p1', 'prefiro', d);
  assert.strictEqual(blocked.success, false, 'preferência recusada após prazo');
  assert.match(blocked.error, /encerrada|prazo/i, 'mensagem de janela encerrada');
  // dentro do prazo passa
  await SS.openElection(c.id, { closesAt: '2999-01-01T00:00' }, d);
  const ok = await SS.setPreference(c.id, 'p1', 'prefiro', d);
  assert.ok(ok.success, 'preferência aceita dentro do prazo');
  console.log('✓ setPreference respeita prazo OK');

  // ── nowLocalMinute (formato local, determinístico com data fixa) ──
  const fixed = new Date(2026, 6, 8, 9, 5); // 08/07/2026 09:05 local (mês 0-based)
  assert.strictEqual(SS.nowLocalMinute(fixed), '2026-07-08T09:05', 'formato YYYY-MM-DDTHH:MM local');
  assert.match(SS.nowLocalMinute(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'sem argumento = agora no formato certo');
  console.log('✓ nowLocalMinute OK');

  console.log('\n✅ smoke-escala-frente1 (Task 3) OK');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
