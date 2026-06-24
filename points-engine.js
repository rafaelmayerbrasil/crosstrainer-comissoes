// points-engine.js — núcleo puro do motor de pontos (§4.3 do spec)
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PointsEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // anos completos entre duas datas ISO (YYYY-MM-DD)
  function completedYears(fromISO, toISO) {
    const a = new Date(fromISO), b = new Date(toISO);
    let years = b.getFullYear() - a.getFullYear();
    const anniv = new Date(b.getFullYear(), a.getMonth(), a.getDate());
    if (b < anniv) years -= 1;
    return Math.max(0, years);
  }

  function tempoDeCasaPontos(admissaoISO, refISO, cfg) {
    if (!admissaoISO) return 0;
    const anos = completedYears(admissaoISO, refISO);
    const faixa = Math.floor(anos / cfg.faixaAnos);
    return (faixa + 1) * cfg.pts.tempoCasaPorFaixa;
  }

  function cycleIdFor(refISO, cycles) {
    const found = (cycles || []).find(c => refISO >= c.inicio && refISO <= c.fim);
    return found ? found.id : null;
  }

  function entriesForCycle(entries, cycle) {
    return (entries || []).filter(e => e.refDate >= cycle.inicio && e.refDate <= cycle.fim);
  }

  function scoreboard(entries, cycle, tempoCasaPts) {
    const noCiclo = entriesForCycle(entries, cycle);
    const porTipo = {};
    let somaEntries = 0;
    noCiclo.forEach(e => {
      porTipo[e.tipo] = (porTipo[e.tipo] || 0) + e.pontos;
      somaEntries += e.pontos;
    });
    const tempoCasa = tempoCasaPts || 0;
    return { porTipo, tempoCasa, total: somaEntries + tempoCasa };
  }

  return { completedYears, tempoDeCasaPontos, cycleIdFor, entriesForCycle, scoreboard };
});
