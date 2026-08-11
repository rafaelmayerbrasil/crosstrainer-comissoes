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
      // Falta em AULA (bloco 2, 07/08/2026). O Rodrigo pediu "punição máxima nos
      // pontos" pra falta injustificada e sem aviso — daí ser mais pesada que a
      // de treinamento. Valores editáveis pela gestão, como os demais.
      aulaFaltaJustificada: -5,
      aulaFaltaSemAviso: -25,
      // Atraso: por ocorrência, não por minuto. O desconto proporcional já
      // acontece no pagamento; aqui é o efeito no engajamento.
      aulaAtraso: -3,
    },
  };

  // Remove chaves null/undefined pra elas NÃO anularem o default no spread (M2:
  // campo vazio na UI virava null e zerava a pontuação → NaN no placar). 0 é preservado.
  function pruneNil(obj) {
    const out = {};
    Object.keys(obj || {}).forEach(k => { if (obj[k] != null) out[k] = obj[k]; });
    return out;
  }

  // Mescla rasa no topo + profunda nos blocos conhecidos (pts, penalidade). Não muta o default.
  function mergeConfig(overrides) {
    overrides = pruneNil(overrides);
    return {
      ...DEFAULT_CONFIG,
      ...overrides,
      pts: { ...DEFAULT_CONFIG.pts, ...pruneNil(overrides.pts) },
      penalidade: { ...DEFAULT_CONFIG.penalidade, ...pruneNil(overrides.penalidade) },
    };
  }

  return { DEFAULT_CONFIG, mergeConfig };
});
