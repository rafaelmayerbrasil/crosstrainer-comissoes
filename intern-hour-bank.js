// intern-hour-bank.js — banco de horas do estagiário (bloco 2c, decidido 07/08/2026)
//
// Regra combinada com o Rodrigo:
//   • trabalhou MAIS que o contrato → recebe bolsa + as horas a mais, no mês
//   • trabalhou MENOS               → recebe a BOLSA CHEIA, e as horas que
//                                     faltaram viram saldo NEGATIVO
//   • mês seguinte com extras       → as extras primeiro QUITAM o saldo; só o
//                                     que sobrar é pago
//
// "Descontar" é abater de horas futuras, NUNCA reduzir a bolsa — bolsa de
// estágio é vinculada à carga horária do termo, e reduzi-la é terreno jurídico
// delicado. O saldo só vai pra baixo de zero: sobra nunca vira crédito, é paga.
//
// Sem teto. Estágio encerrado com saldo negativo encerra sem dívida financeira.
// Começa zerado em agosto/2026.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InternHourBank = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const num = (v, def = 0) => (typeof v === 'number' && isFinite(v)) ? v : def;

  /**
   * Contrato do mês, já descontando afastamento (férias/recesso).
   *
   * Sem isso, quem tirou férias apareceria como se tivesse trabalhado a menos e
   * acumularia dívida por estar de férias — o que seria absurdo.
   *
   * @param limiteMensal horas contratadas no mês
   * @param diasNoMes / diasAfastado
   */
  function contratoDoMes(limiteMensal, diasNoMes, diasAfastado) {
    const lim = num(limiteMensal);
    const total = num(diasNoMes);
    const fora = num(diasAfastado);
    if (lim <= 0 || total <= 0) return lim;
    if (fora <= 0) return lim;
    if (fora >= total) return 0;
    return lim * ((total - fora) / total);
  }

  /**
   * Fecha o mês do estagiário.
   *
   * @param horasTrabalhadas horas efetivas do mês (já com as ocorrências aplicadas)
   * @param contratoMes      horas contratadas no mês (use contratoDoMes)
   * @param saldoAnterior    saldo acumulado, ≤ 0 (negativo = deve horas)
   * @returns {
   *   horasPagas,      // horas extras que entram no pagamento deste mês
   *   horasQuitadas,   // quanto do saldo foi abatido pelas extras
   *   saldoFinal,      // novo saldo acumulado (≤ 0)
   *   diff             // trabalhadas − contrato (informativo)
   * }
   */
  function fecharMes(horasTrabalhadas, contratoMes, saldoAnterior) {
    const trabalhadas = Math.max(0, num(horasTrabalhadas));
    const contrato = Math.max(0, num(contratoMes));
    // saldo é sempre ≤ 0; positivo vindo de fora é tratado como zero
    const saldo = Math.min(0, num(saldoAnterior));
    const diff = trabalhadas - contrato;

    if (diff > 0) {
      // Trabalhou a mais: as extras primeiro quitam a dívida
      const divida = -saldo;
      const horasQuitadas = Math.min(diff, divida);
      return {
        horasPagas: diff - horasQuitadas,
        horasQuitadas,
        saldoFinal: saldo + horasQuitadas,   // caminha em direção a zero
        diff,
      };
    }

    // Trabalhou a menos (ou exato): bolsa cheia, e a diferença vira dívida
    return {
      horasPagas: 0,
      horasQuitadas: 0,
      saldoFinal: saldo + diff,              // diff ≤ 0 → fica mais negativo
      diff,
    };
  }

  /** Texto pro recibo e pra tela — sem isso ninguém confia no número. */
  function explicar(r, contratoMes, horasTrabalhadas) {
    const h = n => `${(Math.round(n * 100) / 100).toString().replace('.', ',')}h`;
    const linhas = [
      `Horas no mês: ${h(horasTrabalhadas)} · contrato: ${h(contratoMes)}`,
    ];
    if (r.diff > 0) {
      linhas.push(`Trabalhou ${h(r.diff)} a mais.`);
      if (r.horasQuitadas > 0) linhas.push(`${h(r.horasQuitadas)} abateram o saldo devedor.`);
      linhas.push(r.horasPagas > 0
        ? `${h(r.horasPagas)} pagas como adicional.`
        : `Nada a pagar de adicional: as horas a mais foram usadas pra abater o saldo.`);
    } else if (r.diff < 0) {
      linhas.push(`Trabalhou ${h(-r.diff)} a menos — bolsa paga integralmente.`);
      linhas.push(`Essas horas ficam no saldo pra abater quando trabalhar a mais.`);
    } else {
      linhas.push('Bateu exatamente o contrato.');
    }
    linhas.push(r.saldoFinal < 0
      ? `Saldo a compensar: ${h(-r.saldoFinal)}.`
      : 'Saldo zerado.');
    return linhas.join(' ');
  }

  return { contratoDoMes, fecharMes, explicar };
});
