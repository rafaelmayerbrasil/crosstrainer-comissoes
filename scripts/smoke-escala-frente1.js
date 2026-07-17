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

  // ── filterByTimeframe (puro): futuros ≥ hoje / passados < hoje ──
  const rows = [{ date: '2026-07-01' }, { date: '2026-07-08' }, { date: '2026-07-20' }];
  assert.deepStrictEqual(SS.filterByTimeframe(rows, '2026-07-08', 'futuros').map(r => r.date), ['2026-07-08', '2026-07-20'], 'futuros inclui hoje');
  assert.deepStrictEqual(SS.filterByTimeframe(rows, '2026-07-08', 'passados').map(r => r.date), ['2026-07-01'], 'passados < hoje');
  assert.strictEqual(SS.filterByTimeframe(rows, '2026-07-08', 'todos').length, 3, 'todos = tudo');
  console.log('✓ filterByTimeframe OK');

  // ── buildConsolidationMatrix (puro) ──
  const scales = [
    { id: 's1', date: '2026-07-11', name: 'Sáb 11', slots: [{ assignedPersonId: 'p1' }, { assignedPersonId: null }] },
    { id: 's2', date: '2026-07-18', name: 'Sáb 18', slots: [{ assignedPersonId: 'p2' }, { assignedPersonId: 'p1' }] },
  ];
  const prefs = { s1: [{ personId: 'p1', pref: 'prefiro' }], s2: [{ personId: 'p2', pref: 'pode_ser' }] };
  const people = [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bia' }, { id: 'p3', name: 'Caio' }];
  const m = SS.buildConsolidationMatrix(scales, prefs, people);
  assert.deepStrictEqual(m.semCandidatura.map(p => p.id), ['p3'], 'p3 não se candidatou a nada');
  assert.strictEqual(m.vagasAbertas, 1, 's1 tem 1 vaga aberta');
  const anaRow = m.grid.find(g => g.person.id === 'p1');
  assert.strictEqual(anaRow.cells.s1.pref, 'prefiro', 'Ana prefiro em s1');
  assert.strictEqual(anaRow.cells.s1.assigned, true, 'Ana escalada em s1');
  console.log('✓ buildConsolidationMatrix OK');

  // ── escolaInternaSlots (puro): 1 vaga de líder por unidade/sessão ──
  const eiSlots = SS.escolaInternaSlots([{ id: 'unit-cp', name: 'CP' }], { startTime: '14:30', endTime: '15:30' });
  assert.strictEqual(eiSlots.length, 1, '1 slot por unidade');
  assert.strictEqual(eiSlots[0].role, 'lider', 'slot é de líder');
  assert.strictEqual(eiSlots[0].startTime, '14:30');
  assert.strictEqual(eiSlots[0].assignedPersonId, null, 'nasce vago');
  console.log('✓ escolaInternaSlots OK');

  // ── assignSlot (IO): atribui líder manual sem consolidate ──
  const ei = (await SS.createScale({ date: '2026-07-13', tipo: 'escola_interna', name: 'Escola 13/07', slots: eiSlots }, d)).data;
  const as = await SS.assignSlot(ei.id, eiSlots[0].id, 'p1', d);
  assert.ok(as.success, 'atribuiu');
  const eiG = (await SS.getScale(ei.id, d)).data;
  assert.strictEqual(eiG.slots[0].assignedPersonId, 'p1', 'líder gravado no slot');
  // desatribuir com null
  await SS.assignSlot(ei.id, eiSlots[0].id, null, d);
  assert.strictEqual((await SS.getScale(ei.id, d)).data.slots[0].assignedPersonId, null, 'desatribuiu');
  console.log('✓ assignSlot OK');

  console.log('\n✅ smoke-escala-frente1 (Task 4) OK');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
