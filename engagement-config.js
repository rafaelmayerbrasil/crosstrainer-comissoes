// engagement-config.js — configuração calibrável do motor de pontos (§4.1 do spec)
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EngagementConfig = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DEFAULT_CONFIG = {
    faixaAnos: 2,
    pts: {
      tempoCasaPorFaixa: 10,
      escolaInternaParticipar: 1,
      escolaInternaLiderar: 2,
      treinarComoAlunoEmOutro: 1,
      toiComoAluno: 1,
      reuniaoStaff: 8,
      proatividadeSubstituicao: 3,
      eventoInterno: 8,
      treinamentoObrigatorioPresenca: 8,
    },
    tetoMensalItensDiarios: null,
    penalidade: {
      treinoFaltaJustificada: 0,
      treinoFaltaSemAviso: -15,
    },
  };

  // Mescla rasa no topo + profunda nos blocos conhecidos (pts, penalidade). Não muta o default.
  function mergeConfig(overrides) {
    overrides = overrides || {};
    return {
      ...DEFAULT_CONFIG,
      ...overrides,
      pts: { ...DEFAULT_CONFIG.pts, ...(overrides.pts || {}) },
      penalidade: { ...DEFAULT_CONFIG.penalidade, ...(overrides.penalidade || {}) },
    };
  }

  return { DEFAULT_CONFIG, mergeConfig };
});
