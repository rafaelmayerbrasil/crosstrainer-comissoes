// intern-hour-bank.js — banco de horas do estagiário (bloco 2c, decidido 07/08/2026)
// GEMEO: intern-hour-bank.js na raiz (usado pelo navegador). Esta copia existe
// porque o deploy das Functions so leva a pasta functions/.
// smoke-banco-horas-estagiario.js compara as duas e falha se divergirem.
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

  /**
   * Fecha (ou re-fecha) o mês somando ao que outro fechamento do mesmo mês já viu.
   *
   * O fechamento é POR UNIDADE. Quem dá aula na CP e na PP tem o mesmo mês fechado
   * duas vezes, e cada um sozinho enxerga só metade das horas — compararia meia
   * grade com o contrato inteiro e registraria dívida de um mês cumprido.
   *
   * A saída é: recalcular o mês INTEIRO a partir do saldo que existia ANTES do mês
   * e pagar só a diferença do que aquele mês já pagou. Serve também de proteção
   * contra reprocessar o mesmo fechamento (não paga a mesma hora duas vezes).
   *
   * @param horasNovas   horas que ESTE fechamento está trazendo
   * @param contratoMes  horas contratadas no mês (use contratoDoMes)
   * @param movimento    o que já foi registrado pro mesmo mês, ou null
   *                     `{ horasTrabalhadas, horasPagas, saldoAnterior }`
   * @param saldoAtual   saldo gravado hoje (só usado quando não há movimento)
   */
  function revisarMes(horasNovas, contratoMes, movimento, saldoAtual) {
    const mov = movimento || null;
    const saldoAnterior = mov ? Math.min(0, num(mov.saldoAnterior)) : Math.min(0, num(saldoAtual));
    const horasTrabalhadas = (mov ? Math.max(0, num(mov.horasTrabalhadas)) : 0) + Math.max(0, num(horasNovas));

    const r = fecharMes(horasTrabalhadas, contratoMes, saldoAnterior);
    const jaPagas = mov ? Math.max(0, num(mov.horasPagas)) : 0;

    return {
      ...r,
      horasTrabalhadas,
      saldoAnterior,
      // nunca negativo: se o mês encolher numa revisão, não se cobra hora de volta
      horasPagasAgora: Math.max(0, r.horasPagas - jaPagas),
    };
  }

  /**
   * O mês inteiro do estagiário em uma conta só — contrato, saldo, extras e valor.
   *
   * É o ÚNICO lugar onde essa conta é feita: o fechamento (Cloud Function) e a
   * prévia da tela chamam esta função. Se cada um fizesse a sua, o admin veria um
   * valor na prévia e pagaria outro no fechamento.
   *
   * A bolsa NUNCA encolhe — trabalhar a menos vira saldo de horas, não desconto
   * (bolsa de estágio é vinculada à carga horária do termo).
   *
   * @param {{
   *   horas, limiteHoras, stipend, propRate,
   *   diasNoMes, diasAfastado, movimento, saldoAtual
   * }} p
   */
  function calcularMesEstagiario(p) {
    const o = p || {};
    const horas = Math.max(0, num(o.horas));
    const limiteHoras = num(o.limiteHoras);
    const stipend = num(o.stipend);
    const propRate = num(o.propRate);

    // Sem contrato cadastrado não dá pra comparar nada: paga a bolsa e AVISA.
    // Chutar contrato zero pagaria o mês inteiro como hora extra.
    if (limiteHoras <= 0) {
      return {
        semContrato: true,
        contratoMes: 0, horasTrabalhadas: horas, saldoAnterior: Math.min(0, num(o.saldoAtual)),
        diff: 0, horasQuitadas: 0, horasPagas: 0, horasPagasAgora: 0,
        saldoFinal: Math.min(0, num(o.saldoAtual)),
        valorExtra: 0, valorHoras: stipend, stipend,
        explicacao: `Horas no mês: ${horas.toFixed(2).replace('.', ',')}h. Contrato de horas não cadastrado — pago só a bolsa, sem banco de horas.`,
      };
    }

    const contratoMes = contratoDoMes(limiteHoras, o.diasNoMes, o.diasAfastado);
    const r = revisarMes(horas, contratoMes, o.movimento, o.saldoAtual);
    const valorExtra = Math.round(r.horasPagasAgora * propRate * 100) / 100;

    return {
      semContrato: false,
      contratoMes,
      horasTrabalhadas: r.horasTrabalhadas,
      saldoAnterior: r.saldoAnterior,
      diff: r.diff,
      horasQuitadas: r.horasQuitadas,
      horasPagas: r.horasPagas,
      horasPagasAgora: r.horasPagasAgora,
      saldoFinal: r.saldoFinal,
      valorExtra,
      valorHoras: stipend + valorExtra,
      stipend,
      explicacao: explicar(r, contratoMes, r.horasTrabalhadas),
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

  return { contratoDoMes, fecharMes, revisarMes, calcularMesEstagiario, explicar };
});
