// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — API da Pacto → linhas no formato do export
// ═══════════════════════════════════════════════════════════════════════
//
// Modo sombra (desenho: docs/superpowers/specs/2026-09-13-pacto-api-modo-sombra-design.md).
//
// Transforma a resposta do `resumoPeriodo` da Pacto em linhas IGUAIS às do
// export `faturamento-recebido`, para que o `pacto-adapter.js` e o
// `commission.js` que já estão no ar façam o resto sem mudar uma linha.
// Se a API e o arquivo divergirem, a diferença tem que ser de DADO, nunca de
// regra — a conta copiada em dois lugares foi o que fez o fechamento pagar
// R$ 7.580,84 a mais em agosto.
//
// Puro: sem Firebase, sem rede, sem DOM. Existe na raiz (a tela) e em
// functions/ (o servidor); `scripts/smoke-pacto-api-linhas.js` falha se as
// duas cópias divergirem.
//
// ⚠️ NUNCA copiar CPF, nascimento, telefone ou e-mail para a saída. A resposta
//    da Pacto traz esses campos; o conversor lê só o que precisa.

const PactoApiLinhas = {

  // Mesmas posições do `PactoAdapter.COL` — o export tem uma coluna vazia na frente
  COL: {
    matricula: 1, nome: 2, cadastro: 3, resp1: 4, resp2: 5, produto: 6,
    contrato: 7, inicio: 8, termino: 9, duracao: 10, modalidades: 11,
    plano: 12, situacao: 13, lancamento: 14, valor: 15, forma: 16,
    condicao: 17, empresa: 18, turma: 19, categoria: 20, consultor: 21,
  },
  TAMANHO_LINHA: 22,

  EMPRESA: {
    CP: 'CROSSTAINER UNID. CAMPECHE (CP)',
    PP: 'CROSSTAINER UNID. PEQ PRÍNCIPE (PP)',
  },

  CAMPOS_PROIBIDOS: ['cpf', 'cpfResponsavel', 'dataNascimento', 'matriculaSesc',
    'telefone', 'telCelular', 'telResidencial', 'email', 'rg'],

  /** 1234.5 → '1.234,50' — o formato do export, que o adapter lê com `valorBR` */
  valorBR(n) {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    const [int, dec] = Math.abs(v).toFixed(2).split('.');
    return (v < 0 ? '-' : '') + int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + dec;
  },

  /** '05/08/2026 10:11:12' → '05/08/2026' */
  diaBR(data) {
    const m = String(data || '').match(/^(\d{2}\/\d{2}\/\d{4})/);
    return m ? m[1] : '';
  },

  _norm(s) {
    return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().trim();
  },

  _soma(lista, f) {
    return Math.round((lista || []).reduce((s, x) => s + (Number(f(x)) || 0), 0) * 100) / 100;
  },

  /**
   * O que o caderninho de contratos guarda. Lista branca: só estes campos saem,
   * venha o que vier da Pacto.
   */
  limparContrato(c, unidade, consultor) {
    return {
      codigo: String(c.codigo),
      unidade,
      situacaoContrato: c.situacaoContrato || '',
      nomePlano: c.nomePlano || '',
      codigoPlano: c.codigoPlano == null ? null : c.codigoPlano,
      vigenciaDe: c.vigenciaDe || '',
      vigenciaAte: c.vigenciaAteAjustada || c.vigenciaAte || '',
      numeroMeses: c.numeroMeses == null ? null : c.numeroMeses,
      consultor: consultor || null,
    };
  },

  /** contratosLancados → Map número do contrato → consultora (vazio no Campeche) */
  consultoresLancados(resumo) {
    const m = new Map();
    ((resumo && resumo.contratosLancados) || []).forEach(c => {
      if (c && c.codigo != null && c.consultor) m.set(String(c.codigo), c.consultor);
    });
    return m;
  },

  _ehCreditoEmConta(forma) {
    return /CREDITO\s+CONTA\s+CLIENTE/.test(this._norm(forma));
  },

  /**
   * @param {Object} a
   * @param {Object} a.resumo     resposta do resumoPeriodo
   * @param {Map}    a.contratos  número do contrato → limparContrato(...)
   * @param {string} a.unidade    'CP' | 'PP'
   * @param {string} a.dia        'AAAA-MM-DD' (só informativo)
   */
  montar({ resumo, contratos, unidade }) {
    const r = resumo || {};
    const cad = contratos || new Map();
    const linhas = [], foraDeProposito = [], avisos = [];
    const pagamentos = r.pagamentos || [];
    const avulsas = r.vendaAvulsa || [];

    // parcela de venda avulsa → produto vendido
    const produtoDaParcela = new Map();
    avulsas.forEach(v => (v.vendaAvulsaParcela || []).forEach(p => produtoDaParcela.set(String(p.codigo), v.produto || '')));

    const parcelasComRecibo = new Set();
    pagamentos.forEach(p => (p.parcelasPagas || []).forEach(x => parcelasComRecibo.add(String(x.codigo))));

    let recebido = 0, pagamentosUsados = 0, parcelas = 0;

    pagamentos.forEach(p => {
      const formas = p.formas || [];
      const valorRecibo = this._soma(formas, f => f.valor);

      if (formas.length && formas.every(f => this._ehCreditoEmConta(f.formaPagamento))) {
        // Firestore recusa `undefined`: todo campo aqui tem valor
        foraDeProposito.push({
          motivo: 'pago com crédito da conta do cliente — não é dinheiro novo',
          recibo: p.codigo, valor: valorRecibo,
          contrato: (p.parcelasPagas || []).map(x => x.codigoContrato).filter(Boolean).map(String).join(','),
        });
        return;
      }

      pagamentosUsados++;
      recebido += valorRecibo;
      const aluno = p.aluno || {};
      const forma = formas.map(f => f.formaPagamento).filter(Boolean).join(' + ');

      (p.parcelasPagas || []).forEach(x => {
        parcelas++;
        const contrato = x.codigoContrato ? String(x.codigoContrato) : '0';
        const l = new Array(this.TAMANHO_LINHA).fill('');
        const put = (k, v) => { l[this.COL[k]] = v == null ? '' : v; };

        put('matricula', aluno.codigo == null ? '' : String(aluno.codigo));
        put('nome', aluno.nome || '');
        put('resp1', p.responsavelLancamento || '');
        put('resp2', p.responsavelLancamento || '');
        put('contrato', contrato);
        put('lancamento', this.diaBR(p.data));
        put('valor', this.valorBR(x.valor));
        put('forma', forma);
        put('empresa', this.EMPRESA[unidade] || '');

        if (contrato !== '0') {
          const c = cad.get(contrato);
          if (!c) {
            avisos.push({ motivo: 'contrato sem dados na Pacto — não conta como ativação', contrato, recibo: p.codigo });
            put('produto', x.descricao || '');
          } else {
            put('produto', c.nomePlano);
            put('plano', c.nomePlano);
            put('situacao', c.situacaoContrato);
            put('inicio', c.vigenciaDe);
            put('termino', c.vigenciaAte);
            put('duracao', c.numeroMeses == null ? '' : String(c.numeroMeses));
          }
          // No Campeche a Pacto não entrega consultora (contratosLancados vem
          // vazio). NÃO usar quem lançou o pagamento: daria nome errado calado.
          if (unidade !== 'CP') {
            const consultor = c && c.consultor;
            put('consultor', consultor || '');
            if (!consultor) avisos.push({ motivo: 'sem consultora conhecida para o contrato', contrato, recibo: p.codigo });
          }
        } else {
          put('produto', produtoDaParcela.get(String(x.codigo)) || x.descricao || '');
        }
        linhas.push(l);
      });
    });

    // Vendinha de balcão paga sem recibo: fica num bloco separado da API e,
    // somada sem cuidado, duplicaria. Só informativo — não mexe em ativação.
    const semRecibo = avulsas.filter(v => {
      const ps = v.vendaAvulsaParcela || [];
      return ps.length && ps.some(p => p.situacao === 'PG') && !ps.some(p => parcelasComRecibo.has(String(p.codigo)));
    });
    semRecibo.forEach(v => foraDeProposito.push({
      motivo: 'venda de balcão sem recibo — só informativo', venda: v.codigo, produto: v.produto || '',
      valor: Math.round((Number(v.totalFinal) || 0) * 100) / 100,
    }));

    return {
      linhas, foraDeProposito, avisos,
      totais: {
        recebido: Math.round(recebido * 100) / 100,
        pagamentos: pagamentosUsados,
        parcelas,
        vendinhasSemRecibo: { qtd: semRecibo.length, valor: this._soma(semRecibo, v => v.totalFinal) },
        estornos: { qtd: (r.estornos || []).length, valor: this._soma(r.estornos, e => e.pgtoEstornado) },
        estornosContrato: { qtd: (r.estornosContrato || []).length, valor: this._soma(r.estornosContrato, e => e.valorPagoEstornado) },
      },
    };
  },

  /**
   * Situação de um dia buscado. Dia que falhou NUNCA passa por dia sem venda:
   * a Pacto já respondeu "sucesso" com tudo zerado quando algo estava errado.
   */
  situacaoDoDia({ erro, resumo, avisos }) {
    if (erro && erro.situacao) return erro.situacao;
    const pags = (resumo && resumo.pagamentos) || [];
    if (!pags.length) return 'vazio_conferir';
    if ((avisos || []).some(a => /sem dados na Pacto/.test(a.motivo || ''))) return 'parcial';
    return 'buscado';
  },
};

if (typeof module !== 'undefined') module.exports = PactoApiLinhas;
if (typeof window !== 'undefined') window.PactoApiLinhas = PactoApiLinhas;
