// scale-engine.js — núcleo puro da consolidação da escala especial (spec §6)
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScaleEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function norm(c) {
    return {
      id: c.id, modalityIds: c.modalityIds || [], primaryUnitId: c.primaryUnitId || null,
      merito: c.merito || 0, diasTrabalhados: c.diasTrabalhados || 0, divida: c.divida || 0,
      pref: c.pref || null,
    };
  }

  function isPiso(c, minMes) { return c.divida > 0 || c.diasTrabalhados < minMes; }

  function makeComparator(slot, minMes) {
    const prefRank = (p) => p.pref === 'quer' ? 0 : (p.pref === 'nao_quer' ? 2 : 1);
    const altRank = (p) => (p.primaryUnitId && p.primaryUnitId !== slot.unitId) ? 0 : 1;
    return function (a, b) {
      const pa = isPiso(a, minMes) ? 0 : 1, pb = isPiso(b, minMes) ? 0 : 1;
      if (pa !== pb) return pa - pb;                       // piso primeiro
      if (pa === 0) {                                      // ambos no piso
        if (b.divida !== a.divida) return b.divida - a.divida;             // mais dívida primeiro
        if (a.diasTrabalhados !== b.diasTrabalhados) return a.diasTrabalhados - b.diasTrabalhados; // menos dias
      }
      if (b.merito !== a.merito) return b.merito - a.merito;               // mais mérito
      if (prefRank(a) !== prefRank(b)) return prefRank(a) - prefRank(b);   // preferência
      if (altRank(a) !== altRank(b)) return altRank(a) - altRank(b);       // unidade alternada
      return String(a.id).localeCompare(String(b.id));                    // estável
    };
  }

  function consolidate(slots, candidates, opts) {
    opts = opts || {};
    const minMes = opts.minMes != null ? opts.minMes : 1;
    const pool = (candidates || []).map(norm);
    const assigned = new Set();
    const fairnessDelta = {};
    const assignments = (slots || []).map(slot => {
      const eligible = pool.filter(c =>
        !assigned.has(c.id) &&
        c.modalityIds.includes(slot.requiredModalityId) &&
        c.pref !== 'nao_posso'
      );
      if (eligible.length === 0) {
        return { slotId: slot.id, unitId: slot.unitId, personId: null, reason: 'sem_elegivel', explain: [] };
      }
      eligible.sort(makeComparator(slot, minMes));
      const pick = eligible[0];
      assigned.add(pick.id);
      const reason = isPiso(pick, minMes) ? 'justica' : 'merito';
      fairnessDelta[pick.id] = { dias: 1, dividaResolvida: pick.divida > 0 ? 1 : 0 };
      // explica a escolha: top candidatos ordenados com as métricas que decidiram
      const explain = eligible.slice(0, 4).map(c => ({
        personId: c.id, merito: c.merito, diasTrabalhados: c.diasTrabalhados, divida: c.divida, pref: c.pref,
      }));
      return { slotId: slot.id, unitId: slot.unitId, personId: pick.id, reason, explain };
    });
    return { assignments, fairnessDelta };
  }

  return { consolidate, isPiso };
});
