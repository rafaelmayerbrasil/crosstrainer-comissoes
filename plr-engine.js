// plr-engine.js — núcleo puro do PLR (spec §4): nota ponderada + rateio do pool.
// Sem DOM, sem Firestore — Node-testável (igual scale-engine).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlrEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Média ponderada das notas de um bloco entre os avaliadores.
  // evals: [{ evaluatorId, notas:{ blocoId: number } }]. Peso default = 1.
  function blocoNotaPonderada(evals, blocoId, avaliadoresPeso) {
    const pesos = avaliadoresPeso || {};
    let somaNota = 0, somaPeso = 0;
    (evals || []).forEach(e => {
      const n = e.notas ? e.notas[blocoId] : undefined;
      if (typeof n !== 'number' || isNaN(n)) return;
      const p = pesos[e.evaluatorId] || 1;
      somaNota += n * p;
      somaPeso += p;
    });
    return somaPeso > 0 ? somaNota / somaPeso : 0;
  }

  // Placar de pontos → nota 0–10 (proporcional ao maior placar do ciclo).
  function normalizarEngajamento(placar, placarMax) {
    if (!placarMax || placarMax <= 0) return 0;
    const v = 10 * (placar || 0) / placarMax;
    return v < 0 ? 0 : (v > 10 ? 10 : v);
  }

  // Nota final 0–10 = soma ponderada dos blocos (peso efetivo = peso/Σpesos,
  // então blocos ausentes se redistribuem sozinhos).
  // evals = avaliações DESTE colaborador.
  function notaFinal(evals, engajPts, engajMax, config) {
    const blocos = (config && config.blocos) || [];
    const pesos = (config && config.avaliadoresPeso) || {};
    let soma = 0, somaPeso = 0;
    blocos.forEach(b => {
      const peso = b.peso || 0;
      if (peso <= 0) return;
      const nota = b.auto
        ? normalizarEngajamento(engajPts, engajMax)
        : blocoNotaPonderada(evals, b.id, pesos);
      soma += nota * peso;
      somaPeso += peso;
    });
    const n = somaPeso > 0 ? soma / somaPeso : 0;
    return Math.round(n * 100) / 100;
  }

  // Meses inteiros entre duas datas ISO 'YYYY-MM-DD'.
  function mesesEntre(hireISO, refISO) {
    if (!hireISO || !refISO) return 0;
    const h = new Date(hireISO + 'T00:00:00'), r = new Date(refISO + 'T00:00:00');
    if (isNaN(h) || isNaN(r)) return 0;
    let m = (r.getFullYear() - h.getFullYear()) * 12 + (r.getMonth() - h.getMonth());
    if (r.getDate() < h.getDate()) m -= 1;
    return m < 0 ? 0 : m;
  }

  // Elegibilidade configurável. pessoa: { type, hireDate(ISO), saldoPontos }.
  function elegivel(pessoa, config, refISO) {
    const el = (config && config.elegibilidade) || {};
    const minMeses = el.minMesesCasa != null ? el.minMesesCasa : 0;
    const meses = mesesEntre(pessoa.hireDate, refISO);
    if (meses < minMeses) return { ok: false, motivo: `menos de ${minMeses} meses de casa` };
    const isEstagiario = pessoa.type === 'estagiario' || pessoa.type === 'professor_estagiario';
    if (isEstagiario && el.estagiarioEntra === false) return { ok: false, motivo: 'estagiário não entra' };
    if (el.minSaldoPontos != null && (pessoa.saldoPontos || 0) < el.minSaldoPontos) {
      return { ok: false, motivo: `saldo de pontos < ${el.minSaldoPontos}` };
    }
    return { ok: true, motivo: null };
  }

  // Rateio: fatia = pool × (horas×nota) / Σ(horas×nota). Centavos exatos (resíduo no maior).
  function distribuir(pool, pessoas) {
    const ps = (pessoas || []).map(p => ({ id: p.id, horas: p.horas || 0, nota: p.nota || 0, peso: (p.horas || 0) * (p.nota || 0) }));
    const denom = ps.reduce((s, p) => s + p.peso, 0);
    if (denom <= 0 || !pool || pool <= 0) return ps.map(p => ({ id: p.id, fatia: 0 }));
    let linhas = ps.map(p => ({ id: p.id, fatia: Math.round((pool * p.peso / denom) * 100) / 100, peso: p.peso }));
    // ajuste de resíduo (centavos) no maior peso pra somar exatamente o pool
    const somaFatias = Math.round(linhas.reduce((s, l) => s + l.fatia, 0) * 100) / 100;
    const resto = Math.round((pool - somaFatias) * 100) / 100;
    if (resto !== 0 && linhas.length) {
      let idx = 0; for (let i = 1; i < linhas.length; i++) if (linhas[i].peso > linhas[idx].peso) idx = i;
      linhas[idx].fatia = Math.round((linhas[idx].fatia + resto) * 100) / 100;
    }
    return linhas.map(l => ({ id: l.id, fatia: l.fatia }));
  }

  return { blocoNotaPonderada, normalizarEngajamento, notaFinal, mesesEntre, elegivel, distribuir };
});
