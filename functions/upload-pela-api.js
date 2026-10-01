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
    sem_vendedora: 'buscado sem a vendedora',
    vendedora_incompleta: 'vendedora incompleta',
  },

  /**
   * O dia foi buscado SEM a credencial da unidade: as linhas de contrato vêm sem
   * a vendedora. É o formato de antes de 30/09/2026 (não tem `comGateway` nem
   * `linhasBalcao`) ou uma busca em que a Function ficou sem a credencial. Em
   * produção, set/2026 no CP tinha 264 linhas assim — calcular o mês com elas
   * punha tudo em "Sem vendedor", sem erro nenhum na tela.
   */
  _semVendedora(doc) {
    if (doc.comGateway === true) return false;
    if (doc.comGateway === false) return true;
    return doc.linhasBalcao === undefined;      // dias gravados em 30/09 já têm `linhasBalcao`, ainda sem a marca
  },

  /**
   * O que a tela orienta depois da trava. Quando o único problema é a vendedora
   * (dia antigo ou busca que parou no limite de consultas), o caminho é buscar de
   * novo — não a planilha. Em 30/09/2026, em produção, a tela mandava para a
   * planilha depois de uma busca que só tinha batido no limite.
   */
  orientacaoDaTrava(diasProblema, depoisDeBuscar) {
    const soVendedora = (diasProblema || []).length > 0 &&
      diasProblema.every(d => d.situacao === 'sem_vendedora' || d.situacao === 'vendedora_incompleta');
    if (soVendedora) {
      return {
        abrirPlanilha: false,
        texto: depoisDeBuscar
          ? 'A busca tem um limite de consultas por vez e ainda não completou a vendedora destes dias: clique em "Buscar de novo agora" mais uma vez.'
          : 'Estes dias foram buscados sem a vendedora de cada venda: clique em "Buscar de novo agora" (em mês cheio, pode precisar de mais de uma vez).',
      };
    }
    return {
      abrirPlanilha: !!depoisDeBuscar,
      texto: depoisDeBuscar ? 'A Pacto ainda não entregou esses dias. Use a planilha abaixo.' : 'Se continuar falhando, use a planilha abaixo.',
    };
  },

  /** A busca não conseguiu completar a vendedora de algum contrato (limite da noite ou gateway fora). */
  _vendedoraIncompleta(doc) {
    return (doc.avisos || []).some(a => /^consultora a completar|^gateway: /.test(String((a && a.motivo) || '')));
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

  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  /**
   * A situação da atualização automática do mês, para o painel da gestão
   * (`periodos/{id}.automatico`, gravado pela madrugada). Vazio se não houver.
   */
  automaticoHtml(periodo) {
    const a = periodo && periodo.automatico;
    if (!a || !a.situacao) return '';
    const em = a.em && typeof a.em.toDate === 'function' ? a.em.toDate() : (a.em && !isNaN(new Date(a.em)) ? new Date(a.em) : null);
    const quando = em ? em.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' às') : '';
    const ate = a.dadosAte ? ' · dados até ' + this.diaCurto(a.dadosAte) : '';
    const caixa = (cor, titulo, texto) => `
      <div style="background:var(--${cor}-bg, rgba(0,0,0,0.04));border:1px solid var(--${cor});border-radius:10px;padding:12px 16px;margin-bottom:14px">
        <div style="font-size:11px;font-weight:800;color:var(--${cor});text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">${titulo}</div>
        <div style="font-size:13px;color:var(--text2);line-height:1.5">${texto}</div>
      </div>`;
    if (a.situacao === 'atualizado') {
      return `<div style="font-size:12px;color:var(--text3);margin:0 0 12px">🔄 Atualizado automaticamente pela Pacto${quando ? ' em ' + this._esc(quando) : ''}${this._esc(ate)}</div>`;
    }
    if (a.situacao === 'travado') {
      const dias = (a.diasProblema || []).map(d => this.diaCurto(d.dia)).join(', ');
      return caixa('red', '⚠️ A atualização automática parou',
        `Faltam dados da Pacto em <strong>${this._esc(dias)}</strong>. O mês mostra o último cálculo bom${quando ? ' (tentativa de ' + this._esc(quando) + ')' : ''}. ` +
        `Em <strong>Upload → Atualizar pela Pacto</strong> dá para buscar de novo; se continuar falhando, use a planilha.`);
    }
    if (a.situacao === 'congelado') {
      return caixa('blue', '🔒 Mês congelado', 'Os recibos deste mês já foram emitidos, então ele não se atualiza mais sozinho. ' +
        'Para mudar alguma coisa, use <strong>Upload → Atualizar pela Pacto</strong> (pede confirmação).');
    }
    if (a.situacao === 'erro') {
      return caixa('red', '⚠️ A atualização automática deu erro', this._esc(a.motivo || 'motivo desconhecido') +
        (quando ? ' (' + this._esc(quando) + ')' : '') + '. Tente em <strong>Upload → Atualizar pela Pacto</strong>.');
    }
    return '';
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
      // Dia sem a vendedora também trava: o mês sairia com venda de ninguém
      else if (this._semVendedora(doc)) diasProblema.push({ dia: d, situacao: 'sem_vendedora', motivo: '' });
      else if (this._vendedoraIncompleta(doc)) diasProblema.push({ dia: d, situacao: 'vendedora_incompleta', motivo: '' });
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
