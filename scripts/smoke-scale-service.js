'use strict';
// Roda: node scripts/smoke-scale-service.js
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const SE = require('../scale-engine.js');
const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'tester', SE });

(async () => {
  // templateSlots (puro)
  const slots = SS.templateSlots('sabado', [{ id: 'cp' }, { id: 'norte' }]);
  assert.strictEqual(slots.length, 4, '2 unidades x 2 papéis = 4 slots');
  assert.deepStrictEqual(slots.find(s => s.id === 'cp_TOI'), { id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: null, startTime: null, endTime: null });
  assert.strictEqual(SS.templateSlots('evento', [{ id: 'cp' }]).length, 0, 'evento sem template');

  const db = makeFakeDb();
  const d = deps(db);
  // createScale
  const cRes = await SS.createScale({ date: '2026-07-04', tipo: 'sabado', name: 'Sábado 04/07', slots }, d);
  assert.ok(cRes.success && cRes.data.id, 'criou escala');
  const id = cRes.data.id;
  let g = await SS.getScale(id, d);
  assert.strictEqual(g.data.status, 'rascunho', 'nasce rascunho');
  assert.strictEqual(g.data.slots.length, 4);

  // transições de status
  await SS.openElection(id, d);
  g = await SS.getScale(id, d);
  assert.strictEqual(g.data.status, 'janela_aberta', 'abriu eleição');

  // listScales
  const l = await SS.listScales(d);
  assert.strictEqual(l.data.length, 1);

  console.log('✓ smoke-scale-service: CRUD/template OK');

  // ── Preferências ──
  await SS.setPreference(id, 'ana', 'quer', d);
  await SS.setPreference(id, 'bru', 'nao_posso', d);
  await SS.setPreference(id, 'ana', 'nao_quer', d); // sobrescreve (idempotente por id)
  const prefs = await SS.listPreferences(id, d);
  assert.strictEqual(prefs.data.length, 2, 'ana(atualizada)+bru, sem duplicar');
  assert.strictEqual(prefs.data.find(p => p.personId === 'ana').pref, 'nao_quer', 'ana sobrescrita');

  // ── Fairness ──
  let f = await SS.getFairness('ana', d);
  assert.deepStrictEqual({ dias: f.data.diasTrabalhados, div: f.data.divida }, { dias: 0, div: 0 }, 'fairness default zero');
  await SS.saveFairness('ana', { diasTrabalhados: 3, divida: 2 }, d);
  await SS.applyFairnessDelta({ ana: { dias: 1, dividaResolvida: 1 } }, d);
  f = await SS.getFairness('ana', d);
  assert.strictEqual(f.data.diasTrabalhados, 4, 'dias 3+1');
  assert.strictEqual(f.data.divida, 1, 'dívida 2-1');

  console.log('✓ smoke-scale-service: preferências/fairness OK');

  // ── buildCandidates (puro) ──
  const cands = SS.buildCandidates({
    teachers: [{ id: 'ana', modalityIds: ['TOI'], primaryUnitId: 'cp' }],
    meritoById: { ana: 40 },
    fairnessById: { ana: { diasTrabalhados: 2, divida: 1 } },
    prefById: { ana: 'quer' },
  });
  assert.deepStrictEqual(cands[0], { id: 'ana', modalityIds: ['TOI'], primaryUnitId: 'cp', merito: 40, diasTrabalhados: 2, divida: 1, pref: 'quer' });

  // ── consolidate (orquestra + persiste) ── (pessoa nova 'zeca', fairness zero)
  const slotsToi = [{ id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: null }];
  const c2 = await SS.createScale({ date: '2026-07-11', tipo: 'sabado', name: 'S2', slots: slotsToi }, d);
  await SS.setPreference(c2.data.id, 'zeca', 'quer', d);
  const ctx = { teachers: [{ id: 'zeca', modalityIds: ['TOI'], primaryUnitId: 'cp' }], meritoById: { zeca: 40 } };
  const cons = await SS.consolidate(c2.data.id, ctx, d);
  assert.strictEqual(cons.data.assignments[0].personId, 'zeca', 'zeca alocada no TOI');
  const g2 = await SS.getScale(c2.data.id, d);
  assert.strictEqual(g2.data.status, 'consolidada', 'status consolidada');
  assert.strictEqual(g2.data.slots[0].assignedPersonId, 'zeca', 'slot gravado com a pessoa');
  const fa = await SS.getFairness('zeca', d);
  assert.strictEqual(fa.data.diasTrabalhados, 1, 'fairness incrementado pela consolidação');

  console.log('✓ smoke-scale-service: consolidate OK');

  // ── Fim de ano (por dia, duplas sem modalidade, carga espalhada) ──
  const feSlots = SS.templateSlotsFimDeAno({ start: '2026-12-21', end: '2026-12-23', closedDays: [], halfDays: ['2026-12-22'] }, [{ id: 'cp' }]);
  assert.strictEqual(feSlots.length, 6, '3 dias x 1 unidade x 2 = 6 vagas');
  assert.strictEqual(feSlots[0].requiredModalityId, null, 'vaga sem modalidade');
  assert.ok(feSlots.some(s => s.halfDay === true), 'meio período marcado');
  const fe = await SS.createScale({ date: '2026-12-21', tipo: 'fim_de_ano', name: 'Fim de ano 2026', slots: feSlots }, d);
  const feCtx = { teachers: [{ id: 'p1', modalityIds: [] }, { id: 'p2', modalityIds: [] }, { id: 'p3', modalityIds: [] }] };
  const feRes = await SS.consolidateByDay(fe.data.id, feCtx, d);
  assert.ok(feRes.success, 'consolidateByDay ok');
  assert.deepStrictEqual(feRes.data.naoEscalados, [], 'todos entraram (carga espalhada)');
  const dpp = feRes.data.diasTrabalhadosPorPessoa;
  assert.deepStrictEqual([dpp.p1.diasTrabalhados, dpp.p2.diasTrabalhados, dpp.p3.diasTrabalhados], [2, 2, 2], 'carga equilibrada 2-2-2');
  const feg = await SS.getScale(fe.data.id, d);
  assert.strictEqual(feg.data.status, 'consolidada');
  assert.ok(feg.data.slots.every(s => s.assignedPersonId), 'todas as 6 vagas preenchidas');

  console.log('✓ smoke-scale-service: fim de ano OK');

  // ── ScaleConfig (horários default configuráveis) ──
  const cfg0 = await SS.ScaleConfigService.get(d);
  assert.ok(cfg0.success && cfg0.data && cfg0.data.horarios, 'config nasce com horarios default');
  assert.strictEqual(cfg0.data.horarios.sabado.startTime, '08:00', 'default sábado 08:00');
  await SS.ScaleConfigService.save({ horarios: { sabado: { startTime: '07:00', endTime: '11:00' } } }, d);
  const cfg1 = await SS.ScaleConfigService.get(d);
  assert.strictEqual(cfg1.data.horarios.sabado.startTime, '07:00', 'config salva e persiste');
  const slotsT = SS.templateSlots('sabado', [{ id: 'cp' }], { startTime: '08:00', endTime: '12:00' });
  assert.strictEqual(slotsT[0].startTime, '08:00', 'slot herda startTime');
  assert.strictEqual(slotsT[0].endTime, '12:00', 'slot herda endTime');

  console.log('✓ smoke-scale-service: scale-config/horários OK');

  // ── Publicar / Despublicar (idempotente) ──
  const pubSlots = [
    { id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'modTOI', assignedPersonId: 'ana', startTime: '08:00', endTime: '12:00' },
    { id: 'cp_HIIT', unitId: 'cp', requiredModalityId: 'modHIIT', assignedPersonId: null, startTime: '08:00', endTime: '12:00' }, // vaga aberta
  ];
  const ps = await SS.createScale({ date: '2026-08-01', tipo: 'sabado', name: 'Pub', slots: pubSlots }, d);
  await SS.setStatus(ps.data.id, 'consolidada', d);
  const pub1 = await SS.publishToAgenda(ps.data.id, d);
  assert.strictEqual(pub1.data.created, 1, '1 aula criada (vaga aberta não gera)');
  assert.deepStrictEqual(pub1.data.vagasAbertas, ['cp_HIIT'], 'vaga aberta reportada');
  let clsSnap = await db.collection('classes').where('specialScaleId', '==', ps.data.id).get();
  assert.strictEqual(clsSnap.docs.length, 1, '1 aula no banco');
  assert.strictEqual(clsSnap.docs[0].data().teacherId, 'ana', 'aula com a professora certa');
  assert.strictEqual(clsSnap.docs[0].data().status, 'prevista', 'aula prevista');
  assert.strictEqual(clsSnap.docs[0].data().durationMinutes, 240, '08:00-12:00 = 240min');
  // republicar não duplica
  const pub2 = await SS.publishToAgenda(ps.data.id, d);
  assert.strictEqual(pub2.data.created, 1, 'republicar recria 1 (não acumula)');
  clsSnap = await db.collection('classes').where('specialScaleId', '==', ps.data.id).get();
  assert.strictEqual(clsSnap.docs.length, 1, 'continua 1 aula (idempotente)');
  // marca published
  const pg = await SS.getScale(ps.data.id, d);
  assert.strictEqual(pg.data.published, true, 'escala marcada como publicada');
  // despublicar remove
  const unp = await SS.unpublishFromAgenda(ps.data.id, d);
  assert.ok(unp.success && unp.data.removed === 1, 'despublicou 1 aula');
  clsSnap = await db.collection('classes').where('specialScaleId', '==', ps.data.id).get();
  assert.strictEqual(clsSnap.docs.length, 0, 'despublicou: 0 aulas');

  console.log('✓ smoke-scale-service: publicar/despublicar OK');
})();
