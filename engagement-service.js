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

  return { getConfig, saveConfig };
});
