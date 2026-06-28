// scale-service.js — persistência + orquestração da escala especial (spec §4.5-4.7, §6)
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScaleService = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function rdb(deps)  { if (deps && deps.db) return deps.db; return (typeof db !== 'undefined') ? db : null; }
  function rts(deps)  { if (deps && deps.ts) return deps.ts(); return (typeof serverTs === 'function') ? serverTs() : new Date().toISOString(); }
  function ruid(deps) { if (deps && deps.uid) return deps.uid(); return (typeof currentUserId === 'function') ? currentUserId() : null; }
  function rSE(deps)  { if (deps && deps.SE) return deps.SE; return ScaleEngine; }

  function templateSlots(tipo, units, times) {
    if (tipo === 'sabado' || tipo === 'feriado' || tipo === 'domingo_especial') {
      const t = times || {};
      const out = [];
      (units || []).forEach(u => {
        ['TOI', 'HIIT'].forEach(mod => out.push({
          id: `${u.id}_${mod}`, unitId: u.id, requiredModalityId: mod, assignedPersonId: null,
          startTime: t.startTime || null, endTime: t.endTime || null,
        }));
      });
      return out;
    }
    return [];
  }

  // ── Config da escala (horários-padrão das vagas, configurável pela gestão) ──
  const DEFAULT_HORARIOS = {
    sabado:           { startTime: '08:00', endTime: '12:00' },
    feriado:          { startTime: '08:00', endTime: '12:00' },
    domingo_especial: { startTime: '08:00', endTime: '12:00' },
    evento:           { startTime: '08:00', endTime: '12:00' },
  };
  const ScaleConfigService = {
    async get(deps) {
      try {
        const doc = await rdb(deps).collection('scale_config').doc('default').get();
        const base = {
          horarios: JSON.parse(JSON.stringify(DEFAULT_HORARIOS)),
          fimDeAnoShifts: JSON.parse(JSON.stringify(DEFAULT_FE_SHIFTS)),
          fimDeAnoPeoplePerShift: 1,
        };
        return { success: true, data: doc.exists ? Object.assign(base, doc.data()) : base };
      } catch (err) { console.error('[ScaleConfigService.get]', err); return { success: false, error: err.message }; }
    },
    async save(patch, deps) {
      try {
        await rdb(deps).collection('scale_config').doc('default')
          .set(Object.assign({ updatedAt: rts(deps) }, patch), { merge: true });
        return { success: true };
      } catch (err) { console.error('[ScaleConfigService.save]', err); return { success: false, error: err.message }; }
    },
  };

  async function createScale(scale, deps) {
    try {
      const database = rdb(deps);
      const ref = database.collection('special_scales').doc();
      const doc = {
        date: scale.date, name: scale.name || '', tipo: scale.tipo,
        status: 'rascunho', slots: scale.slots || [], externalId: '',
        createdAt: rts(deps), createdBy: ruid(deps),
      };
      await ref.set(doc);
      return { success: true, data: { id: ref.id, ...doc } };
    } catch (err) { console.error('[ScaleService.createScale]', err); return { success: false, error: err.message }; }
  }

  async function getScale(id, deps) {
    try {
      const doc = await rdb(deps).collection('special_scales').doc(id).get();
      if (!doc.exists) return { success: false, error: 'Escala não encontrada' };
      return { success: true, data: { id: doc.id, ...doc.data() } };
    } catch (err) { console.error('[ScaleService.getScale]', err); return { success: false, error: err.message }; }
  }

  async function listScales(deps) {
    try {
      const snap = await rdb(deps).collection('special_scales').orderBy('date').get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) { console.error('[ScaleService.listScales]', err); return { success: false, error: err.message }; }
  }

  async function setStatus(id, status, deps) {
    try {
      await rdb(deps).collection('special_scales').doc(id).set({ status, updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      return { success: true };
    } catch (err) { console.error('[ScaleService.setStatus]', err); return { success: false, error: err.message }; }
  }
  async function openElection(id, deps)  { return setStatus(id, 'janela_aberta', deps); }
  async function closeElection(id, deps) { return setStatus(id, 'rascunho', deps); }

  async function setPreference(scaleId, personId, pref, deps) {
    try {
      await rdb(deps).collection('scale_preferences').doc(`${scaleId}__${personId}`)
        .set({ scaleId, personId, pref, updatedAt: rts(deps) });
      return { success: true };
    } catch (err) { console.error('[ScaleService.setPreference]', err); return { success: false, error: err.message }; }
  }

  async function listPreferences(scaleId, deps) {
    try {
      const snap = await rdb(deps).collection('scale_preferences').where('scaleId', '==', scaleId).get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) { console.error('[ScaleService.listPreferences]', err); return { success: false, error: err.message }; }
  }

  async function getFairness(personId, deps) {
    try {
      const doc = await rdb(deps).collection('fairness_counter').doc(personId).get();
      const base = { personId, diasTrabalhados: 0, divida: 0 };
      return { success: true, data: doc.exists ? Object.assign(base, doc.data()) : base };
    } catch (err) { console.error('[ScaleService.getFairness]', err); return { success: false, error: err.message }; }
  }

  async function saveFairness(personId, vals, deps) {
    try {
      await rdb(deps).collection('fairness_counter').doc(personId)
        .set({ personId, diasTrabalhados: vals.diasTrabalhados || 0, divida: vals.divida || 0, updatedAt: rts(deps) });
      return { success: true };
    } catch (err) { console.error('[ScaleService.saveFairness]', err); return { success: false, error: err.message }; }
  }

  async function applyFairnessDelta(delta, deps) {
    try {
      for (const personId of Object.keys(delta || {})) {
        const cur = (await getFairness(personId, deps)).data;
        const dd = delta[personId];
        await saveFairness(personId, {
          diasTrabalhados: cur.diasTrabalhados + (dd.dias || 0),
          divida: Math.max(0, cur.divida - (dd.dividaResolvida || 0)),
        }, deps);
      }
      return { success: true };
    } catch (err) { console.error('[ScaleService.applyFairnessDelta]', err); return { success: false, error: err.message }; }
  }

  function buildCandidates(ctx) {
    const merito = ctx.meritoById || {};
    const fair = ctx.fairnessById || {};
    const pref = ctx.prefById || {};
    return (ctx.teachers || []).map(t => ({
      id: t.id, modalityIds: t.modalityIds || [], primaryUnitId: t.primaryUnitId || null,
      merito: merito[t.id] || 0,
      diasTrabalhados: (fair[t.id] && fair[t.id].diasTrabalhados) || 0,
      divida: (fair[t.id] && fair[t.id].divida) || 0,
      pref: pref[t.id] || null,
    }));
  }

  async function consolidate(scaleId, ctx, deps) {
    try {
      ctx = ctx || {};
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      const scale = scaleRes.data;
      const prefsRes = await listPreferences(scaleId, deps);
      const prefById = {};
      (prefsRes.data || []).forEach(p => { prefById[p.personId] = p.pref; });
      const teachers = ctx.teachers || [];
      const fairnessById = {};
      for (const t of teachers) { fairnessById[t.id] = (await getFairness(t.id, deps)).data; }
      const candidates = buildCandidates({ teachers, meritoById: ctx.meritoById || {}, fairnessById, prefById });
      const result = rSE(deps).consolidate(scale.slots || [], candidates, ctx.opts || {});
      const bySlot = {}, byReason = {}, byExplain = {};
      result.assignments.forEach(a => { bySlot[a.slotId] = a.personId; byReason[a.slotId] = a.reason; byExplain[a.slotId] = a.explain || []; });
      const newSlots = (scale.slots || []).map(s => Object.assign({}, s, {
        assignedPersonId: bySlot[s.id] !== undefined ? bySlot[s.id] : s.assignedPersonId,
        reason: byReason[s.id] !== undefined ? byReason[s.id] : (s.reason || null),
        explain: byExplain[s.id] !== undefined ? byExplain[s.id] : (s.explain || []),
      }));
      await rdb(deps).collection('special_scales').doc(scaleId)
        .set({ slots: newSlots, status: 'consolidada', updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      await applyFairnessDelta(result.fairnessDelta, deps);
      return { success: true, data: { assignments: result.assignments } };
    } catch (err) { console.error('[ScaleService.consolidate]', err); return { success: false, error: err.message }; }
  }

  // ── Fim de ano (§7) ──────────────────────────────────────────────
  function datesInRange(startISO, endISO) {
    const out = [];
    let d = new Date(startISO + 'T00:00:00');
    const end = new Date(endISO + 'T00:00:00');
    while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
    return out;
  }

  // Turnos-padrão do fim de ano (configuráveis via scale_config).
  const DEFAULT_FE_SHIFTS = [
    { id: 'manha',       label: 'Manhã',       startTime: '08:00', endTime: '12:00' },
    { id: 'tarde_noite', label: 'Tarde/Noite', startTime: '16:00', endTime: '21:00' },
  ];

  // Gera as vagas do fim de ano: por DIA (exceto fechados) × unidade × TURNO ×
  // pessoas/turno. SEM modalidade exigida. Cada vaga carrega o horário do turno
  // (pra publicar na agenda direto).
  function templateSlotsFimDeAno(period, units, shifts, peoplePerShift) {
    period = period || {};
    const sh = (shifts && shifts.length) ? shifts : DEFAULT_FE_SHIFTS;
    const ppl = peoplePerShift || 1;
    const closed = new Set(period.closedDays || []);
    const days = datesInRange(period.start, period.end).filter(d => !closed.has(d));
    const out = [];
    days.forEach(day => {
      (units || []).forEach(u => {
        sh.forEach(s => {
          for (let i = 1; i <= ppl; i++) {
            out.push({
              id: `${day}_${u.id}_${s.id}_${i}`, day, unitId: u.id, shift: s.id,
              startTime: s.startTime, endTime: s.endTime,
              requiredModalityId: null, assignedPersonId: null,
            });
          }
        });
      });
    });
    return out;
  }

  // Consolida o fim de ano DIA A DIA (permite repetição entre dias). A carga se
  // espalha sozinha: minMes alto deixa todo mundo "no piso", então o motor sempre
  // pega quem trabalhou MENOS dias no período (mérito/preferência desempatam).
  // Fairness é interno ao período (começa zero; não mistura com a rotação de sábados).
  async function consolidateByDay(scaleId, ctx, deps) {
    try {
      ctx = ctx || {};
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      const scale = scaleRes.data;
      const prefsRes = await listPreferences(scaleId, deps);
      const prefById = {};
      (prefsRes.data || []).forEach(p => { prefById[p.personId] = p.pref; });
      const teachers = ctx.teachers || [];
      const SE = rSE(deps);
      const opts = { minMes: (ctx.opts && ctx.opts.minMes) || 999 };
      const slots = scale.slots || [];
      const days = [...new Set(slots.map(s => s.day))].sort();
      const working = {};
      const bySlot = {}, byReason = {}, byExplain = {};
      days.forEach(day => {
        const daySlots = slots.filter(s => s.day === day);
        const candidates = buildCandidates({ teachers, meritoById: ctx.meritoById || {}, fairnessById: working, prefById });
        const result = SE.consolidate(daySlots, candidates, opts);
        result.assignments.forEach(a => { bySlot[a.slotId] = a.personId; byReason[a.slotId] = a.reason; byExplain[a.slotId] = a.explain || []; });
        Object.keys(result.fairnessDelta).forEach(pid => {
          working[pid] = working[pid] || { diasTrabalhados: 0, divida: 0 };
          working[pid].diasTrabalhados += (result.fairnessDelta[pid].dias || 0);
        });
      });
      const newSlots = slots.map(s => Object.assign({}, s, {
        assignedPersonId: bySlot[s.id] !== undefined ? bySlot[s.id] : s.assignedPersonId,
        reason: byReason[s.id] !== undefined ? byReason[s.id] : (s.reason || null),
        explain: byExplain[s.id] !== undefined ? byExplain[s.id] : (s.explain || []),
      }));
      await rdb(deps).collection('special_scales').doc(scaleId)
        .set({ slots: newSlots, status: 'consolidada', updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      const escalados = new Set(Object.values(bySlot).filter(Boolean));
      const naoEscalados = teachers.filter(t => !escalados.has(t.id)).map(t => t.id);
      return { success: true, data: { naoEscalados, totalSlots: slots.length, diasTrabalhadosPorPessoa: working } };
    } catch (err) { console.error('[ScaleService.consolidateByDay]', err); return { success: false, error: err.message }; }
  }

  // ── Publicar na agenda (§5) ──────────────────────────────────────
  // Escalas especiais são off-grid: publicar = CRIAR aulas taggeadas com
  // specialScaleId/specialScaleSlotId. Idempotente: republicar apaga e recria.
  function _slotMinutes(s) {
    const a = parseInt(s.startTime.slice(0, 2), 10) * 60 + parseInt(s.startTime.slice(3), 10);
    const b = parseInt(s.endTime.slice(0, 2), 10) * 60 + parseInt(s.endTime.slice(3), 10);
    return b - a;
  }

  async function _deleteScaleClasses(scaleId, deps) {
    const snap = await rdb(deps).collection('classes').where('specialScaleId', '==', scaleId).get();
    let blocked = false, removed = 0;
    for (const doc of snap.docs) {
      if (doc.data().monthClosingId) { blocked = true; continue; }
      await rdb(deps).collection('classes').doc(doc.id).delete();
      removed++;
    }
    return { removed, blocked };
  }

  async function publishToAgenda(scaleId, deps) {
    try {
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      const scale = scaleRes.data;
      await _deleteScaleClasses(scaleId, deps); // idempotência
      const slots = scale.slots || [];
      const vagasAbertas = [];
      let created = 0;
      for (const s of slots) {
        if (!s.assignedPersonId) { vagasAbertas.push(s.id); continue; }
        if (!s.startTime || !s.endTime) { vagasAbertas.push(s.id); continue; }
        // fim de ano: cada slot tem seu próprio dia; sábado/feriado usa a data da escala.
        const slotDay = s.day || scale.date;
        const dateVal = (typeof firebase !== 'undefined' && firebase.firestore)
          ? firebase.firestore.Timestamp.fromDate(new Date(slotDay + 'T00:00:00'))
          : slotDay;
        await rdb(deps).collection('classes').doc().set({
          unitId: s.unitId, teacherId: s.assignedPersonId, originalTeacherId: s.assignedPersonId,
          modalityId: s.requiredModalityId || null, startTime: s.startTime, endTime: s.endTime,
          durationMinutes: _slotMinutes(s), status: 'prevista',
          isHoliday: scale.tipo === 'feriado', holidayName: null, holidayType: null,
          cancellationReason: null, cancellationNote: null,
          adjustedBy: null, adjustedAt: null, adjustmentNote: null,
          scheduledDate: dateVal, generatedBy: 'escala-smart',
          specialScaleId: scaleId, specialScaleSlotId: s.id, specialScaleType: null,
          monthClosingId: null, createdAt: rts(deps), updatedAt: rts(deps),
        });
        created++;
      }
      await rdb(deps).collection('special_scales').doc(scaleId)
        .set({ published: true, updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      return { success: true, data: { created, vagasAbertas } };
    } catch (err) { console.error('[ScaleService.publishToAgenda]', err); return { success: false, error: err.message }; }
  }

  async function unpublishFromAgenda(scaleId, deps) {
    try {
      const res = await _deleteScaleClasses(scaleId, deps);
      if (res.blocked) return { success: false, error: 'Há aulas em mês fechado; não é possível despublicar.' };
      await rdb(deps).collection('special_scales').doc(scaleId)
        .set({ published: false, updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      return { success: true, data: { removed: res.removed } };
    } catch (err) { console.error('[ScaleService.unpublishFromAgenda]', err); return { success: false, error: err.message }; }
  }

  return { templateSlots, templateSlotsFimDeAno, datesInRange, ScaleConfigService, createScale, getScale, listScales, openElection, closeElection, setStatus, setPreference, listPreferences, getFairness, saveFairness, applyFairnessDelta, buildCandidates, consolidate, consolidateByDay, publishToAgenda, unpublishFromAgenda };
});
