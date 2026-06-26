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

  return { templateSlots, createScale, getScale, listScales, openElection, closeElection, setStatus };
});
