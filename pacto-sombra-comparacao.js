// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Modo sombra: comparação API da Pacto × export arrastado
// ═══════════════════════════════════════════════════════════════════════
//
// Desenho: docs/superpowers/specs/2026-09-13-pacto-api-modo-sombra-design.md
//
// Puro: recebe as linhas dos dois lados (formato do export) e devolve o que a
// tela desenha. As ATIVAÇÕES dos dois lados saem do `pacto-adapter.js` e do
// `commission.js` reais, injetados — nenhuma regra de ativação mora aqui. Se
// os dois lados divergirem, é dado; nunca conta.
//
// O dinheiro (`recebido`) é somado direto da coluna Valor, antes do adapter:
// é o que entrou no caixa, não o que vira comissão.

const PactoSombraComparacao = {

  CAUSAS: {
    DIA: 'mesmo contrato em outro dia',
    CREDITO: 'crédito em conta',
    VALOR: 'parcela renegociada ou valor diferente',
    BALCAO: 'vendinha de balcão',
    SO_API: 'só na API',
    SO_ARQUIVO: 'só no arquivo',
  },

  _norm(s) {
    return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  },

  _r2(v) { return Math.round((Number(v) || 0) * 100) / 100; },

  /** 'dd/MM/yyyy' → 'AAAA-MM-DD' */
  _iso(dataBR) {
    const m = String(dataBR || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
  },

  /** Linhas de dado da unidade no mês (sem cabeçalho nem rodapé) */
  _doMes(linhas, Adapter, unidade, mes) {
    return (linhas || []).filter(l => {
      if (!l) return false;
      const dia = this._iso(Adapter.campo(l, 'lancamento'));
      return dia && dia.slice(0, 7) === mes && Adapter.unidadeDe(l) === unidade;
    });
  },

  _lado(linhas, { Adapter, Engine, unidade, mes, config }) {
    const doMes = this._doMes(linhas, Adapter, unidade, mes);
    const recebido = this._r2(doMes.reduce((s, l) => s + Adapter.valorBR(Adapter.campo(l, 'valor')), 0));

    const t = Adapter.traduzir(doMes, { mes });
    const vendas = (t.porUnidade && t.porUnidade[unidade]) || [];
    const rows = vendas.length ? Engine.cleanRawData([Adapter.CABECALHO_SAIDA, ...Adapter.paraPlanilha(vendas)]) : [];
    const cfg = Object.assign({}, Engine.defaultConfig, config || {});
    const { processed } = rows.length ? Engine.processRows(rows, cfg, {}) : { processed: [] };

    const ativacoes = { total: 0, novo: 0, renovacao: 0, retorno: 0, voucher: 0 };
    const porVendedora = {};
    processed.forEach(p => {
      if (!p.isActivation) return;
      const peso = p.splitAtivacao || 1;
      ativacoes.total += peso;
      if (ativacoes[p.category] !== undefined) ativacoes[p.category] += peso;
      porVendedora[p.vendedor] = (porVendedora[p.vendedor] || 0) + peso;
    });
    return {
      recebido, linhas: doMes.length, ativacoes, porVendedora,
      migrados: (t.migrados || []).length, descartadas: (t.descartadas || []).length,
      _doMes: doMes,
    };
  },

  _grupos(doMes, Adapter) {
    const g = new Map();
    doMes.forEach(l => {
      const nome = this._norm(Adapter.campo(l, 'nome'));
      const dia = this._iso(Adapter.campo(l, 'lancamento'));
      const k = nome + '|' + dia;
      if (!g.has(k)) g.set(k, { nome, cliente: Adapter.campo(l, 'nome'), dia, valor: 0, contratos: new Set(), formas: new Set(), produtos: [] });
      const o = g.get(k);
      o.valor += Adapter.valorBR(Adapter.campo(l, 'valor'));
      const c = Adapter.campo(l, 'contrato');
      if (c && c !== '0') o.contratos.add(c);
      o.formas.add(Adapter.campo(l, 'forma'));
      o.produtos.push(Adapter.campo(l, 'produto'));
    });
    return g;
  },

  /**
   * @param {Object} a
   * @param {Array}  a.linhasApi       linhas montadas pelo PactoApiLinhas (dos dias do mês)
   * @param {Array}  a.linhasArquivo   linhas cruas do export arrastado (cabeçalho pode vir junto)
   * @param {string} a.mes             'AAAA-MM'
   * @param {string} a.unidade         'CP' | 'PP'
   * @param {Array}  [a.foraApi]       foraDeProposito dos dias da API (para reconhecer crédito em conta)
   * @param {Object} [a.config]        metas do mês, se houver
   * @param {Object} a.Adapter         PactoAdapter
   * @param {Object} a.Engine          CommissionEngine
   */
  comparar({ linhasApi, linhasArquivo, mes, unidade, foraApi, config, Adapter, Engine }) {
    if (!Adapter || !Engine) throw new Error('comparar: Adapter e Engine são obrigatórios');
    const ctx = { Adapter, Engine, unidade, mes, config };
    const api = this._lado(linhasApi, ctx);
    const arquivo = this._lado(linhasArquivo, ctx);

    const gA = this._grupos(api._doMes, Adapter);
    const gX = this._grupos(arquivo._doMes, Adapter);
    delete api._doMes; delete arquivo._doMes;

    const creditoEmConta = new Set();
    (foraApi || []).forEach(f => {
      if (/crédito da conta/i.test(f.motivo || '')) String(f.contrato || '').split(',').filter(Boolean).forEach(c => creditoEmConta.add(c));
    });

    const chaves = new Set([...gA.keys(), ...gX.keys()]);
    const brutas = [];
    let batem = 0;
    chaves.forEach(k => {
      const a = gA.get(k), x = gX.get(k);
      const va = this._r2(a ? a.valor : 0), vx = this._r2(x ? x.valor : 0);
      if (Math.abs(va - vx) < 0.01) { batem++; return; }
      const contratos = new Set([...(a ? a.contratos : []), ...(x ? x.contratos : [])]);
      brutas.push({
        nome: (a || x).nome, cliente: (a || x).cliente, dia: (a || x).dia,
        api: va, arquivo: vx, diferenca: this._r2(va - vx),
        contratos: [...contratos].sort(),
        naApi: !!a, noArquivo: !!x,
        contratosNosDois: !!(a && x) && [...a.contratos].some(c => x.contratos.has(c)),
        produtosArquivo: x ? x.produtos : [],
      });
    });

    // Mesmo cliente e mesmos contratos, diferenças que somam zero no mês:
    // o arquivo juntou parcelas num dia e a API pôs cada uma no dia real.
    const saldo = new Map();
    brutas.forEach(d => {
      if (!d.contratos.length) return;
      const k = d.nome + '|' + d.contratos.join(',');
      saldo.set(k, this._r2((saldo.get(k) || 0) + d.diferenca));
    });

    const C = this.CAUSAS;
    const divergencias = brutas.map(d => {
      let causa;
      const kSaldo = d.nome + '|' + d.contratos.join(',');
      if (d.contratos.length && Math.abs(saldo.get(kSaldo) || 0) < 0.01) causa = C.DIA;
      else if (d.contratos.some(c => creditoEmConta.has(c))) causa = C.CREDITO;
      else if (d.contratosNosDois) causa = C.VALOR;
      else if (!d.naApi && !d.contratos.length) causa = C.BALCAO;
      else if (!d.noArquivo) causa = C.SO_API;
      else if (!d.naApi) causa = C.SO_ARQUIVO;
      else causa = C.VALOR;
      return { dia: d.dia, cliente: d.cliente, api: d.api, arquivo: d.arquivo, diferenca: d.diferenca, contratos: d.contratos, causa };
    }).sort((p, q) => (p.dia + p.cliente).localeCompare(q.dia + q.cliente));

    const porCausa = {};
    divergencias.forEach(d => {
      porCausa[d.causa] = porCausa[d.causa] || { qtd: 0, valor: 0 };
      porCausa[d.causa].qtd++;
      porCausa[d.causa].valor = this._r2(porCausa[d.causa].valor + d.diferenca);
    });

    return {
      api, arquivo, divergencias, porCausa,
      grupos: chaves.size, batem,
      diferenca: this._r2(api.recebido - arquivo.recebido),
      // No Campeche a Pacto não entrega consultora: comparar vendedora ali mentiria
      compararVendedora: unidade !== 'CP',
    };
  },
};

if (typeof module !== 'undefined') module.exports = PactoSombraComparacao;
if (typeof window !== 'undefined') window.PactoSombraComparacao = PactoSombraComparacao;
