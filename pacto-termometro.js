// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Termômetro do mês: a conta
// ═══════════════════════════════════════════════════════════════════════
//
// Desenho: docs/superpowers/specs/2026-09-22-termometro-do-mes-design.md
//
// Puro: recebe os dias buscados pela API da Pacto (modo sombra) e devolve SÓ
// totais da unidade — nenhum nome de cliente ou de vendedora, porque o
// resultado é lido pela supervisão. É prévia: não mexe em comissão.
//
// A conta é a do upload oficial, com as peças injetadas: linhas do mês →
// consolidar por contrato (a API tem uma linha por PARCELA) → PactoAdapter.traduzir
// com os contratos já comissionados antes (regime de caixa) → paraPlanilha →
// cleanRawData → CommissionEngine.calculate. A faixa sai do calcP3 do motor.
// Nenhuma regra de ativação ou de meta mora aqui.
//
// ⚠️ Gêmeo em functions/pacto-termometro.js — o deploy de Functions só leva
// functions/. O smoke falha se as duas cópias divergirem.

const PactoTermometro = {

  _r2(v) { return Math.round((Number(v) || 0) * 100) / 100; },

  _somarDias(dia, n) {
    const d = new Date(dia + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  },

  /** 'dd/MM/yyyy' → 'AAAA-MM-DD' */
  _iso(dataBR) {
    const m = String(dataBR || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
  },

  /** Dias do mês que já podiam ter sido buscados: do dia 1º até ontem. */
  diasEsperados(mes, hoje) {
    const ontem = this._somarDias(hoje, -1);
    const dias = [];
    for (let d = mes + '-01'; d.slice(0, 7) === mes && d <= ontem; d = this._somarDias(d, 1)) dias.push(d);
    return dias;
  },

  /**
   * @param {Object} a
   * @param {Array}  a.docs          documentos de `pacto_sombra_dias` da unidade (qualquer mês)
   * @param {string} a.mes           'AAAA-MM'
   * @param {string} a.unidade       'CP' | 'PP'
   * @param {string} a.hoje          'AAAA-MM-DD' (São Paulo)
   * @param {Array}  [a.codigosPagos] contratos comissionados em meses ANTERIORES ('C7001'…)
   * @param {Object} [a.config]      config já somada (unidade + meta do mês), sem o padrão
   * @param {boolean}[a.metaDoMes]   a gestão configurou a meta deste mês?
   */
  calcularMes({ docs, mes, unidade, hoje, codigosPagos, config, metaDoMes, Adapter, Engine, ApiLinhas }) {
    if (!Adapter || !Engine || !ApiLinhas) throw new Error('calcularMes: Adapter, Engine e ApiLinhas são obrigatórios');

    const doMes = (docs || []).filter(d => String(d.dia || '').slice(0, 7) === mes)
      .sort((a, b) => a.dia.localeCompare(b.dia));
    const linhas = doMes.flatMap(d => (d.linhas ? JSON.parse(d.linhas) : []))
      .filter(l => this._iso(Adapter.campo(l, 'lancamento')).slice(0, 7) === mes && Adapter.unidadeDe(l) === unidade);

    const recebido = this._r2(linhas.reduce((s, l) => s + Adapter.valorBR(Adapter.campo(l, 'valor')), 0));

    const t = Adapter.traduzir(ApiLinhas.consolidarPorContrato(linhas), { mes, codigosPagos: codigosPagos || [] });
    const vendas = (t.porUnidade && t.porUnidade[unidade]) || [];
    const cfg = Object.assign({}, Engine.defaultConfig, config || {});
    const rows = vendas.length ? Engine.cleanRawData([Adapter.CABECALHO_SAIDA, ...Adapter.paraPlanilha(vendas)]) : [];
    const u = rows.length
      ? Engine.calculate(rows, cfg).unitTotals
      : { unitAtivacoes: 0, unitNovosRetorno: 0, unitRenovacoes: 0, unitVouchers: 0 };

    // por categoria, para a tela (o motor só devolve os agregados do prêmio)
    const cat = { novo: 0, renovacao: 0, retorno: 0, voucher: 0 };
    if (rows.length) {
      Engine.processRows(Engine.deduplicate(rows).unique, cfg, {}).processed.forEach(p => {
        if (p.isActivation && cat[p.category] !== undefined) cat[p.category] += (p.splitAtivacao || 1);
      });
    }

    const p3 = Engine.calcP3(u.unitAtivacoes, u.unitNovosRetorno, u.unitRenovacoes, u.unitVouchers, 0, cfg);
    const faixas = {
      meta: cfg.meta, superMeta: cfg.superMeta, metaGold: cfg.metaGold,
      minNovos: cfg.minNovos, minRenov: cfg.minRenov, minVoucher: cfg.minVoucher,
      multFalhaRenov: cfg.multFalhaRenov, multFalhaVoucher: cfg.multFalhaVoucher,
    };

    const esperados = this.diasEsperados(mes, hoje);
    const porDia = new Map(doMes.map(d => [d.dia, d.situacao || 'nao_buscado']));
    const COM_RESPOSTA = ['buscado', 'vazio_conferir', 'parcial'];
    const problemas = esperados
      .map(dia => ({ dia, situacao: porDia.get(dia) || 'nao_buscado' }))
      .filter(p => p.situacao !== 'buscado');
    const comResposta = esperados.filter(dia => COM_RESPOSTA.includes(porDia.get(dia)));

    return {
      unidade, mes,
      recebido,
      ativacoes: {
        total: u.unitAtivacoes, novo: cat.novo, renovacao: cat.renovacao, retorno: cat.retorno, voucher: cat.voucher,
        novosRetorno: u.unitNovosRetorno,
      },
      jaPagos: (t.jaPagos || []).length,
      migrados: (t.migrados || []).length,
      faixas,
      faixaAtual: p3.tier,
      faltaPara: {
        meta: Math.max(0, faixas.meta - u.unitAtivacoes),
        superMeta: Math.max(0, faixas.superMeta - u.unitAtivacoes),
        metaGold: Math.max(0, faixas.metaGold - u.unitAtivacoes),
      },
      metaDoMes: !!metaDoMes,
      dias: {
        esperados: esperados.length,
        ateDia: comResposta.length ? comResposta[comResposta.length - 1] : null,
        problemas,
      },
    };
  },
};

if (typeof module !== 'undefined') module.exports = PactoTermometro;
if (typeof window !== 'undefined') window.PactoTermometro = PactoTermometro;
