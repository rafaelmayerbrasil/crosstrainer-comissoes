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

  return { completedYears, tempoDeCasaPontos };
});
