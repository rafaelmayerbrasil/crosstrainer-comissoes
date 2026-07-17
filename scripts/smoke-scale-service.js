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
  await SS.openElection(id, null, d);
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
  await SS.openElection(c2.data.id, { closesAt: '2999-01-01T00:00' }, d); // janela aberta pra aceitar a preferência
  const pr = await SS.setPreference(c2.data.id, 'zeca', 'quer', d);
  assert.ok(pr.success, 'preferência gravada com janela aberta');
  const ctx = { teachers: [{ id: 'zeca', modalityIds: ['TOI'], primaryUnitId: 'cp' }], meritoById: { zeca: 40 } };
  const cons = await SS.consolidate(c2.data.id, ctx, d);
  assert.strictEqual(cons.data.assignments[0].personId, 'zeca', 'zeca alocada no TOI');
  const g2 = await SS.getScale(c2.data.id, d);
  assert.strictEqual(g2.data.status, 'consolidada', 'status consolidada');
  assert.strictEqual(g2.data.slots[0].assignedPersonId, 'zeca', 'slot gravado com a pessoa');
  const fa = await SS.getFairness('zeca', d);
  assert.strictEqual(fa.data.diasTrabalhados, 1, 'fairness incrementado pela consolidação');

  // A1: reconsolidar NÃO pode inflar o fairness de novo (era +1 a cada clique → corrompia justiça)
  await SS.consolidate(c2.data.id, ctx, d);
  const fa2 = await SS.getFairness('zeca', d);
  assert.strictEqual(fa2.data.diasTrabalhados, 1, 'reconsolidar não incrementa fairness de novo');

  console.log('✓ smoke-scale-service: consolidate OK');

  // ── Fim de ano (por dia, duplas sem modalidade, carga espalhada) ──
  const feSlots = SS.templateSlotsFimDeAno({ start: '2026-12-21', end: '2026-12-23', closedDays: [] }, [{ id: 'cp' }]);
  assert.strictEqual(feSlots.length, 6, '3 dias x 1 unidade x 2 turnos x 1 pessoa = 6 vagas');
  assert.strictEqual(feSlots[0].requiredModalityId, null, 'vaga sem modalidade');
  assert.ok(feSlots.some(s => s.shift === 'manha') && feSlots.some(s => s.shift === 'tarde_noite'), 'tem turnos manhã e tarde/noite');
  assert.strictEqual(feSlots.find(s => s.shift === 'manha').startTime, '08:00', 'manhã começa 08:00');
  assert.ok(feSlots.every(s => s.day && s.startTime && s.endTime), 'toda vaga tem dia e horário');
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

  // publish multi-dia: scheduledDate vem do slot.day
  await SS.setStatus(fe.data.id, 'consolidada', d);
  const pubFe = await SS.publishToAgenda(fe.data.id, d);
  assert.strictEqual(pubFe.data.created, 6, 'fim de ano publicou 6 aulas (1 por turno preenchido)');
  const feCls = await db.collection('classes').where('specialScaleId', '==', fe.data.id).get();
  const feDays = new Set(feCls.docs.map(c => c.data().scheduledDate));
  assert.ok(feDays.has('2026-12-21') && feDays.has('2026-12-23'), 'aulas em dias diferentes (scheduledDate por slot.day)');
  await SS.unpublishFromAgenda(fe.data.id, d);

  // M1: republicar NÃO duplica aula já congelada (mês fechado)
  const m1 = await SS.createScale({ date: '2026-08-01', tipo: 'sabado', name: 'S-M1', slots: [
    { id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: 'ana', startTime: '08:00', endTime: '12:00' },
  ] }, d);
  await SS.setStatus(m1.data.id, 'consolidada', d);
  const pubM1a = await SS.publishToAgenda(m1.data.id, d);
  assert.strictEqual(pubM1a.data.created, 1, 'M1: 1ª publicação cria 1 aula');
  // simula fechamento do mês na aula publicada
  const cls = await db.collection('classes').where('specialScaleId', '==', m1.data.id).get();
  await db.collection('classes').doc(cls.docs[0].id).set({ monthClosingId: 'mc-ago' }, { merge: true });
  const pubM1b = await SS.publishToAgenda(m1.data.id, d);
  assert.strictEqual(pubM1b.data.created, 0, 'M1: republicar não recria a aula congelada');
  assert.strictEqual(pubM1b.data.jaCongelados, 1, 'M1: slot contado como já congelado');
  const clsAfter = await db.collection('classes').where('specialScaleId', '==', m1.data.id).get();
  assert.strictEqual(clsAfter.docs.length, 1, 'M1: segue com 1 aula (sem duplicar)');
  console.log('✓ smoke-scale-service: M1 idempotência com mês fechado OK');

  console.log('✓ smoke-scale-service: fim de ano OK');

  // ── ScaleConfig (horários default configuráveis) ──
  const cfg0 = await SS.ScaleConfigService.get(d);
  assert.ok(cfg0.success && cfg0.data && cfg0.data.horarios, 'config nasce com horarios default');
  assert.strictEqual(cfg0.data.horarios.sabado.startTime, '08:00', 'default sábado 08:00');
  assert.ok(cfg0.data.fimDeAnoShifts && cfg0.data.fimDeAnoShifts.length === 2, 'config tem 2 turnos default (manhã/tarde-noite)');
  assert.strictEqual(cfg0.data.fimDeAnoPeoplePerShift, 1, 'default 1 pessoa por turno');
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
