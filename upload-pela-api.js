// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — "Atualizar pela Pacto": o mês das comissões a partir da API
// ═══════════════════════════════════════════════════════════════════════
//
// Desenho: docs/superpowers/specs/2026-09-30-api-pacto-oficial-design.md §2.4
//
// A busca das 4h grava cada dia em `pacto_sombra_dias` (linhas no formato do
// export). Este módulo junta os dias de um mês, decide se dá para usar e
// entrega as linhas prontas para o MESMO caminho do arquivo arrastado
// (`processarPlanilha` no index.html). A planilha virou plano B.
//
// Puro: sem Firebase, sem DOM. `window.UploadPelaApi` e `module.exports`.

const UploadPelaApi = {
  // Dia sem resposta boa da Pacto: o mês não pode ser montado com ele
  VERMELHAS: ['falhou', 'credencial_recusada', 'limite'],

  ROTULO: {
    falhou: 'falhou',
    credencial_recusada: 'credencial recusada',
    limite: 'parou no limite da Pacto',
    nao_buscado: 'não buscado',
  },

  _somar(dia, n) {
    const d = new Date(dia + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  },

  _ultimoDoMes(mes) {
    const [a, m] = mes.split('-').map(Number);
    return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  },

  /** 'AAAA-MM-DD' → 'DD/MM' */
  diaCurto(dia) {
    return String(dia || '').slice(8, 10) + '/' + String(dia || '').slice(5, 7);
  },

  /** Meses que dá para atualizar: o corrente e, até o dia 10, o anterior (a busca das 4h relê os dois) */
  mesesOferecidos(hoje) {
    const atual = hoje.slice(0, 7);
    if (Number(hoje.slice(8, 10)) > 10) return [atual];
    return [atual, this._somar(atual + '-01', -1).slice(0, 7)];
  },

  /**
   * Monta o mês a partir dos dias buscados.
   * @param {Object} a
   * @param {Array}  a.docs         `pacto_sombra_dias` da unidade (qualquer mês; filtra aqui)
   * @param {Array}  a.degustacoes  `pacto_degustacoes` da unidade (filtra o mês aqui)
   * @param {string} a.mes          'AAAA-MM'
   * @param {string} a.hoje         'AAAA-MM-DD' em São Paulo
   * @param {Object} a.ApiLinhas    PactoApiLinhas (cabeçalho e consolidação por contrato)
   * @returns {{trava, diasProblema, vazios, json, parcelasDepois, degustacoes, dadosAte, buscadoEm, avisos}}
   */
  montar({ docs, degustacoes, mes, hoje, ApiLinhas }) {
    if (!ApiLinhas) throw new Error('UploadPelaApi.montar: ApiLinhas é obrigatório');
    const ontem = this._somar(hoje, -1);
    const fimMes = this._ultimoDoMes(mes);
    const ate = ontem < fimMes ? ontem : fimMes;
    const doMes = (docs || []).filter(d => d && d.dia >= mes + '-01' && d.dia <= ate);
    const porDia = new Map(doMes.map(d => [d.dia, d]));

    const diasProblema = [], vazios = [];
    let buscadoEm = null;
    for (let d = mes + '-01'; d <= ate; d = this._somar(d, 1)) {
      const doc = porDia.get(d);
      if (!doc) { diasProblema.push({ dia: d, situacao: 'nao_buscado', motivo: '' }); continue; }
      if (this.VERMELHAS.includes(doc.situacao)) diasProblema.push({ dia: d, situacao: doc.situacao, motivo: doc.motivo || '' });
      if (doc.situacao === 'vazio_conferir') vazios.push(d);
      const b = doc.buscadoEm;
      const t = b && typeof b.toDate === 'function' ? b.toDate().toISOString() : (b ? String(b) : null);
      if (t && (!buscadoEm || t < buscadoEm)) buscadoEm = t;   // a busca MAIS ANTIGA do mês
    }

    const linhas = doMes.slice().sort((a, b) => a.dia.localeCompare(b.dia))
      .flatMap(d => (d.linhas ? JSON.parse(d.linhas) : []));
    const avisos = doMes.flatMap(d => (d.avisos || []).map(a => Object.assign({ dia: d.dia }, a)));
    // Uma linha por CONTRATO, só com o dia do PRIMEIRO pagamento (as formas desse
    // dia somadas): o regime de caixa paga uma vez, sobre o primeiro pagamento.
    // Na API cada parcela é uma linha — sem isto o PP contava 60 ativações contra
    // 46 (13/09/2026), e somar o mês pagaria o anual em 12× sobre o dobro (sessão 79).
    const p = ApiLinhas.primeiroPagamentoPorContrato(linhas);

    return {
      trava: diasProblema.length > 0,
      diasProblema,
      vazios,
      json: ApiLinhas.comCabecalho(p.linhas),
      parcelasDepois: p.depois,
      degustacoes: (degustacoes || []).filter(d => d && d.mes === mes && d.degustacao).map(d => d.degustacao),
      dadosAte: ate,
      buscadoEm,
      avisos,
    };
  },
};

if (typeof module !== 'undefined') module.exports = UploadPelaApi;
if (typeof window !== 'undefined') window.UploadPelaApi = UploadPelaApi;
