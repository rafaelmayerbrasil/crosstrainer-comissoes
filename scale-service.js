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

  function templateSlots(tipo, units) {
    if (tipo === 'sabado' || tipo === 'feriado' || tipo === 'domingo_especial') {
      const out = [];
      (units || []).forEach(u => {
        ['TOI', 'HIIT'].forEach(mod => out.push({ id: `${u.id}_${mod}`, unitId: u.id, requiredModalityId: mod, assignedPersonId: null }));
      });
      return out;
    }
    return [];
  }

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

  return { templateSlots, createScale, getScale, listScales, openElection, closeElection, setStatus, setPreference, listPreferences, getFairness, saveFairness, applyFairnessDelta, buildCandidates, consolidate };
});
