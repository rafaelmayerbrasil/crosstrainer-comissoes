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

  // O cabeçalho do export real, posição por posição (com os espaços e o
  // `Responsável` duplicado que a Pacto manda). O adapter reconhece o arquivo
  // por `Nome Cliente` + `Data Lançamento` — sem isto as linhas não entram.
  CABECALHO: ['', 'Matrícula', 'Nome Cliente', 'Data Cadastro', 'Responsável ', 'Responsável ',
    'Produto', 'Contrato', 'Data Início', 'Data Término', 'Duração', 'Modalidades', 'Plano',
    'Situação Contrato', 'Data Lançamento', 'Valor', 'Forma Pagamento', 'Condição Pagamento',
    'Empresa', 'Turma', 'Categoria', 'Consultor '],

  /** As linhas prontas para `PactoAdapter.traduzir`, cabeçalho na frente */
  comCabecalho(linhas) {
    return [this.CABECALHO.slice(), ...(linhas || [])];
  },

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
  limparContrato(c, unidade, consultor, lancou) {
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
      lancou: lancou || null,          // quem lançou o contrato (Responsável 1 do export)
    };
  },

  /**
   * contratosLancados → Map número do contrato → {consultor, lancou}. Entra
   * também o contrato sem consultora (a Pacto devolve vazio em alguns). Nada
   * do aluno sai daqui.
   */
  lancadosDoDia(resumo) {
    const m = new Map();
    ((resumo && resumo.contratosLancados) || []).forEach(c => {
      if (c && c.codigo != null) {
        m.set(String(c.codigo), { consultor: c.consultor || null, lancou: c.responsavelLancamento || null });
      }
    });
    return m;
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

  // "SALDO DEVEDOR (DÉBITO)" é dívida lançada na conta do aluno, não dinheiro
  // que entrou. Aparece na troca de plano: o contrato antigo é quitado com o
  // crédito que sobrou + saldo devedor, e o relatório de recebimentos lista o
  // movimento como "QUITAÇÃO DE DINHEIRO - CANCELAMENTO", que o motor exclui.
  // Pela API ele vinha com o nome do plano e virava ATIVAÇÃO (Ismael Aguero,
  // C7027, CP 03/09/2026: o termômetro dava 30 novos+retorno contra 29 do
  // oficial, justo no mínimo do P3). Único caso em 84 dias das duas unidades.
  _ehSaldoDevedor(forma) {
    return /SALDO\s+DEVEDOR/.test(this._norm(forma));
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

    let recebido = 0, pagamentosUsados = 0, parcelas = 0;

    pagamentos.forEach(p => {
      const formas = p.formas || [];
      const valorRecibo = this._soma(formas, f => f.valor);

      if (formas.length && formas.every(f => this._ehCreditoEmConta(f.formaPagamento) || this._ehSaldoDevedor(f.formaPagamento))) {
        // Firestore recusa `undefined`: todo campo aqui tem valor
        foraDeProposito.push({
          motivo: formas.some(f => this._ehSaldoDevedor(f.formaPagamento))
            ? 'pago com crédito e saldo devedor da conta do cliente (troca de plano) — não é dinheiro novo'
            : 'pago com crédito da conta do cliente — não é dinheiro novo',
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
        const contrato = x.codigoContrato ? String(x.codigoContrato) : '0';
        // Parcela de R$ 0,00 (camiseta de brinde, voucher grátis, parcela zerada
        // de contrato migrado): o relatório de recebimentos não lista. Deixá-la
        // entrar contava voucher a mais — o motor aceita degustação com valor zero.
        if (!(Number(x.valor) > 0)) {
          foraDeProposito.push({
            motivo: 'parcela de R$ 0,00 — o relatório de recebimentos não lista',
            recibo: p.codigo, valor: 0, contrato: contrato === '0' ? '' : contrato,
            produto: contrato === '0' ? (produtoDaParcela.get(String(x.codigo)) || x.descricao || '') : ((cad.get(contrato) || {}).nomePlano || x.descricao || ''),
          });
          return;
        }
        parcelas++;
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
          const consultor = unidade !== 'CP' ? (c && c.consultor) : null;
          if (unidade !== 'CP') {
            put('consultor', consultor || '');
            if (!consultor) avisos.push({ motivo: 'sem consultora conhecida para o contrato', contrato, recibo: p.codigo });
          }
          // As colunas Responsável também decidem vendedora quando a consultora
          // falta (ou é o robô da Pacto). Com consultora: como no export, 1 = quem
          // lançou o contrato, 2 = quem registrou o pagamento. Sem consultora:
          // vazias — só o robô do cartão fica, porque é ele que marca a cobrança
          // recorrente. Antes as duas levavam quem registrou o pagamento, e a
          // venda saía no nome da recepção (set/2026, PP: 8 vendas).
          const quemRegistrou = p.responsavelLancamento || '';
          if (consultor) {
            put('resp1', (c && c.lancou) || quemRegistrou);
            put('resp2', quemRegistrou);
          } else {
            put('resp1', '');
            put('resp2', /^RECORR[EÊ]NCIA$/i.test(quemRegistrou.trim()) ? quemRegistrou : '');
          }
        } else {
          put('produto', produtoDaParcela.get(String(x.codigo)) || x.descricao || '');
        }
        linhas.push(l);
      });
    });

    // ⚠️ NÃO somar `vendaAvulsa` paga sem recibo. Parecia ser a vendinha de
    // balcão que o arquivo mostra e a API não — mas conferido contra agosto
    // real (13/09/2026): dos 148 itens do PP só 3 estão no arquivo, e dos 57 do
    // CP nenhum. É outro conjunto, que nenhum dos dois relatórios conta como
    // dinheiro recebido. Mostrar esse total induziria a erro.

    return {
      linhas, foraDeProposito, avisos,
      totais: {
        recebido: Math.round(recebido * 100) / 100,
        pagamentos: pagamentosUsados,
        parcelas,
        estornos: { qtd: (r.estornos || []).length, valor: this._soma(r.estornos, e => e.pgtoEstornado) },
        estornosContrato: { qtd: (r.estornosContrato || []).length, valor: this._soma(r.estornosContrato, e => e.valorPagoEstornado) },
      },
    };
  },

  /** '1.234,56' → 1234.56 */
  _valor(txt) {
    const n = parseFloat(String(txt || '').replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
  },

  /**
   * Junta as parcelas do MESMO CONTRATO numa linha só — como o export faz.
   *
   * Para contar ATIVAÇÃO de um período com mais de um dia. Na API cada parcela
   * paga é uma linha com o nome do plano; um contrato com duas parcelas pagas no
   * mês virava duas linhas de plano e o motor contava duas ativações (13 a mais
   * no PP em agosto/2026, achado na homologação de 13/09). O export junta.
   *
   * Soma o valor, fica com a data mais antiga e as formas das duas. Não mexe
   * em linha avulsa (contrato 0) nem na entrada.
   */
  consolidarPorContrato(linhas) {
    const C = this.COL;
    const iso = d => { const m = String(d || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? m[3] + m[2] + m[1] : ''; };
    const saida = [];
    const porContrato = new Map();
    (linhas || []).forEach(l => {
      const c = String(l[C.contrato] || '');
      if (!c || c === '0') { saida.push(l); return; }
      const atual = porContrato.get(c);
      if (!atual) { const copia = l.slice(); porContrato.set(c, copia); saida.push(copia); return; }
      atual[C.valor] = this.valorBR(this._valor(atual[C.valor]) + this._valor(l[C.valor]));
      if (iso(l[C.lancamento]) && iso(l[C.lancamento]) < iso(atual[C.lancamento])) atual[C.lancamento] = l[C.lancamento];
      const formas = new Set(String(atual[C.forma] || '').split(' + ').concat(String(l[C.forma] || '').split(' + ')).filter(Boolean));
      atual[C.forma] = [...formas].join(' + ');
    });
    return saida;
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
