// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Estorno de comissão (cancelamento com reembolso em 30 dias)
// Puro (sem DOM, sem Firebase). Browser (window.EstornoComissao) e Node.
//
// Política do Rodrigo (01/09/2026): quem fecha plano longo tem 30 dias para
// testar. Pedindo cancelamento e reembolso, a comissão paga sobre o primeiro
// pagamento é abatida da próxima comissão da vendedora.
//
// ⚠️ POR QUE ISTO É REGISTRO DA GESTÃO E NÃO DETECÇÃO AUTOMÁTICA
// O estorno não aparece no `faturamento-recebido` da Pacto: medido no export
// fechado de agosto/2026 (619 linhas), zero valores negativos e zero linhas de
// estorno. O relatório mostra só dinheiro ENTRANDO — as 15 linhas de "QUITAÇÃO
// DE DINHEIRO - CANCELAMENTO" são o oposto, o aluno pagando o acerto ao sair.
// E a condição da política (dentro de 30 dias, com reembolso) é uma decisão da
// gestão, que arquivo nenhum expressa.
//
// O que o sistema faz é a parte que ele sabe melhor que a pessoa: calcular
// QUANTO foi pago por aquele contrato, para ninguém digitar valor de cabeça.
//
// Fora de escopo por decisão: o P3 (rateio de meta) não é recalculado. Mexer
// nele reabriria o fechamento de um mês já pago para redistribuir o rateio
// entre todo mundo. O que volta é P1 + P2, que é a comissão daquela venda.
// ═══════════════════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EstornoComissao = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const cent = n => Math.round((Number(n) || 0) * 100) / 100;

  /** 'C7078-2' → 'C7078' — o sufixo separa linhas do mesmo contrato, não contratos */
  function base(codigo) {
    const m = String(codigo || '').trim().match(/^([CA]\d+)/i);
    return m ? m[1].toUpperCase() : '';
  }

  return {
    base,

    /**
     * Quanto de comissão um contrato pagou, e para quem.
     *
     * @param {Array<Object>} itens  itens do período (a subcoleção `itens`)
     * @param {string} contrato      código do contrato, com ou sem sufixo
     * @returns {{encontrado, total, porVendedora, itens}}
     */
    comissaoDoContrato(itens, contrato) {
      const alvo = base(contrato);
      const doContrato = (itens || []).filter(d =>
        (d.type || 'processed') === 'processed' && base(d.codigo) === alvo && alvo);

      const porVendedora = {};
      doContrato.forEach(d => {
        if (d.isNaoCom) return;                       // nunca recebeu, não devolve
        const v = (d.p1valor || 0) + (d.p2bonus || 0);
        if (!v) return;
        const nome = d.vendedor || '';
        if (!nome) return;
        porVendedora[nome] = cent((porVendedora[nome] || 0) + v);
      });

      const total = cent(Object.values(porVendedora).reduce((s, v) => s + v, 0));
      return { encontrado: doContrato.length > 0, total, porVendedora, itens: doContrato };
    },

    /**
     * Os créditos a lançar, já no formato que o pagamento sabe abater.
     * Nascem `pendente` porque é assim que a tela de Pagamentos os encontra.
     *
     * @param {Object} o  { itens, contrato, unitId, periodoLabel, periodoId, motivo }
     * @returns {Array<Object>} um crédito por vendedora que recebeu
     */
    creditosDoEstorno(o) {
      const r = this.comissaoDoContrato(o.itens, o.contrato);
      const cliente = (r.itens[0] || {}).cliente || '';
      return Object.entries(r.porVendedora)
        .filter(([, valor]) => valor > 0)             // sem comissão paga, nada a devolver
        .map(([vendedor, valor]) => ({
          unitId: o.unitId,
          vendedor,
          valor,
          status: 'pendente',
          origem: 'estorno',
          contrato: base(o.contrato),
          cliente,
          periodoOrigem: o.periodoLabel || '',
          periodoOrigemId: o.periodoId || '',
          obs: 'Estorno do contrato ' + base(o.contrato)
             + (cliente ? ' (' + cliente + ')' : '')
             + (o.motivo ? ' — ' + o.motivo : ''),
        }));
    },

    /**
     * Tira o contrato da lista de já-comissionados.
     *
     * Se o aluno voltar meses depois é venda nova e paga comissão de novo.
     * Deixá-lo na lista o bloquearia para sempre, em silêncio — o mesmo falso
     * negativo mudo que a regra "uma vez só" existe para evitar.
     */
    removerDaMemoria(codigosPagos, contrato) {
      const alvo = base(contrato);
      return (codigosPagos || []).filter(c => base(c) !== alvo);
    },
  };
});
