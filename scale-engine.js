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

  /**
   * Ordem de escolha — RODÍZIO primeiro, mérito só desempata.
   * (Rafael, 24/08/2026: "rodízio com mérito como desempate".)
   *
   * Era o contrário na prática: `diasTrabalhados` só entrava quando os dois
   * estavam ABAIXO do piso (`diasTrabalhados < minMes`, minMes=1). Como todo
   * mundo já tinha 1 dia, ninguém ficava no piso e o critério nem era
   * consultado — decidia o mérito, que é fixo. Em produção isso deu Bruno
   * Claudino e Karin nos 11 sábados seguidos, com onze pessoas em 1 dia, e o
   * motor registrando "merito" nas 44 vagas e "justica" em nenhuma.
   */
  function makeComparator(slot, minMes) {
    const prefRank = (p) => (p.pref === 'prefiro' || p.pref === 'quer') ? 0 : (p.pref === 'nao_quer' ? 2 : 1);
    const altRank = (p) => (p.primaryUnitId && p.primaryUnitId !== slot.unitId) ? 0 : 1;
    return function (a, b) {
      if (b.divida !== a.divida) return b.divida - a.divida;               // quem deve dia, paga primeiro
      if (a.diasTrabalhados !== b.diasTrabalhados)                         // quem trabalhou menos vem antes
        return a.diasTrabalhados - b.diasTrabalhados;
      if (b.merito !== a.merito) return b.merito - a.merito;               // desempate: mérito
      if (prefRank(a) !== prefRank(b)) return prefRank(a) - prefRank(b);   // depois, preferência
      if (altRank(a) !== altRank(b)) return altRank(a) - altRank(b);       // unidade alternada
      return String(a.id).localeCompare(String(b.id));                    // estável
    };
  }

  /**
   * Por que esta pessoa foi escolhida — comparando com quem ficou em segundo.
   * Antes o motivo saía de `isPiso`, que com todo mundo acima do piso dizia
   * "merito" sempre. Agora responde a pergunta que a gestão faz de verdade:
   * entrou porque trabalhou menos, porque devia, ou porque desempatou no mérito?
   */
  function motivoDaEscolha(escolhido, segundo, minMes) {
    if (!segundo) return isPiso(escolhido, minMes) ? 'justica' : 'merito';
    if (escolhido.divida !== segundo.divida) return 'justica';
    if (escolhido.diasTrabalhados !== segundo.diasTrabalhados) return 'justica';
    return 'merito';
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
        // vaga SEM modalidade exigida (ex.: fim de ano) = qualquer colaborador serve
        (!slot.requiredModalityId || c.modalityIds.includes(slot.requiredModalityId)) &&
        c.pref !== 'nao_posso'
      );
      if (eligible.length === 0) {
        return { slotId: slot.id, unitId: slot.unitId, personId: null, reason: 'sem_elegivel', explain: [] };
      }
      eligible.sort(makeComparator(slot, minMes));
      const pick = eligible[0];
      assigned.add(pick.id);
      const reason = motivoDaEscolha(pick, eligible[1], minMes);
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
