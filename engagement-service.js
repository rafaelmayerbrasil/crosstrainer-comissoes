// engagement-service.js — ponte entre PointsEngine e o Firestore (§4 do spec).
// Métodos aceitam `deps` opcional p/ teste em Node; no browser caem nos globais do app.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EngagementService = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Resolvers de dependência (typeof guards evitam ReferenceError no Node).
  function rdb(deps)  { if (deps && deps.db) return deps.db; return (typeof db !== 'undefined') ? db : null; }
  function rts(deps)  { if (deps && deps.ts) return deps.ts(); return (typeof serverTs === 'function') ? serverTs() : new Date().toISOString(); }
  function ruid(deps) { if (deps && deps.uid) return deps.uid(); return (typeof currentUserId === 'function') ? currentUserId() : null; }
  function rPE(deps)  { if (deps && deps.PE) return deps.PE; return PointsEngine; }
  function rEC(deps)  { if (deps && deps.EC) return deps.EC; return EngagementConfig; }

  const CONFIG_DOC = 'current';

  async function getConfig(deps) {
    try {
      const doc = await rdb(deps).collection('engagement_config').doc(CONFIG_DOC).get();
      const overrides = doc.exists ? (doc.data().overrides || {}) : {};
      return { success: true, data: rEC(deps).mergeConfig(overrides) };
    } catch (err) { return { success: false, error: err.message }; }
  }

  async function saveConfig(overrides, deps) {
    try {
      await rdb(deps).collection('engagement_config').doc(CONFIG_DOC)
        .set({ overrides: overrides || {}, updatedAt: rts(deps), updatedBy: ruid(deps) });
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  }

  async function recordAttendance(att, deps) {
    try {
      const database = rdb(deps);
      const cfg = (await getConfig(deps)).data;
      const entries = rPE(deps).entriesFromAttendance(att, cfg);
      const batch = database.batch();
      batch.set(database.collection('attendance').doc(att.id), {
        kind: att.kind, date: att.date, unitId: att.unitId || null,
        records: att.records || [], confirmedBy: att.confirmedBy || null,
        updatedAt: rts(deps), updatedBy: ruid(deps),
      });
      entries.forEach(e => {
        batch.set(database.collection('point_entries').doc(e.id), {
          personId: e.personId, tipo: e.tipo, refDate: e.refDate,
          pontos: e.pontos, origem: e.origem, createdAt: rts(deps),
        });
      });
      await batch.commit();
      return { success: true, data: { entriesCount: entries.length } };
    } catch (err) { return { success: false, error: err.message }; }
  }

  // NOTA (tech-debt): se um personId for REMOVIDO dos records num reprocesso,
  // a entry antiga fica órfã (este upsert não apaga). Tratar quando houver
  // edição de chamada na UI (plano de telas).

  return { getConfig, saveConfig, recordAttendance };
});
