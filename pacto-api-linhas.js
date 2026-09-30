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
          // A consultora vem do caderninho. No Campeche ela chega pelo GATEWAY
          // (`contratos/{n}` com a credencial da unidade, 30/09/2026) — o núcleo
          // nunca entregou. NÃO usar quem lançou o pagamento no lugar dela: daria
          // nome errado calado.
          const consultor = c && c.consultor;
          put('consultor', consultor || '');
          if (!consultor) avisos.push({ motivo: 'sem consultora conhecida para o contrato', contrato, recibo: p.codigo });
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

  // ─── Gateway por unidade (30/09/2026) ───
  // Desenho: docs/superpowers/specs/2026-09-30-api-pacto-oficial-design.md

  TIPO_SITUACAO: { MA: 'Matrícula', RE: 'Rematrícula', RN: 'Renovação' },

  /** Contrato lido do gateway (`lerContrato`) → formato do caderninho. Nada do aluno. */
  contratoDoGateway(g, unidade) {
    return {
      codigo: String(g.codigo),
      unidade,
      situacaoContrato: this.TIPO_SITUACAO[g.tipo] || '',
      nomePlano: g.plano || '',
      codigoPlano: null,
      vigenciaDe: g.vigenciaDe || '',
      vigenciaAte: g.vigenciaAte || '',
      numeroMeses: null,
      consultor: g.consultor || null,
      lancou: g.lancou || null,
      gw: true,                        // a consultora já foi perguntada ao gateway
    };
  },

  /**
   * Sem `consultor`/`lancou` nulos. Gravado com `merge`, o caderninho não perde a
   * consultora que o gateway trouxe quando o núcleo regrava o mesmo contrato.
   */
  soPreenchidos(c) {
    const o = { ...c };
    ['consultor', 'lancou'].forEach(k => { if (o[k] == null) delete o[k]; });
    return o;
  },

  /**
   * Contrato de valor zero do gateway como linha do export. Quem decide se é
   * degustação grátis é o `PactoAdapter.degustacoesGratis` — a mesma regra de
   * quando ela vinha pelo relatório de vendas.
   */
  linhaDeDegustacao(g, unidade) {
    const l = new Array(this.TAMANHO_LINHA).fill('');
    const put = (k, v) => { l[this.COL[k]] = v == null ? '' : v; };
    put('matricula', g.cliente && g.cliente.codigo);
    put('nome', g.cliente && g.cliente.nome);
    put('resp1', g.lancou || '');
    put('resp2', g.lancou || '');
    put('produto', g.plano);
    put('plano', g.plano);
    put('contrato', String(g.codigo));
    put('situacao', this.TIPO_SITUACAO[g.tipo] || '');
    put('inicio', g.vigenciaDe);
    put('termino', g.vigenciaAte);
    put('lancamento', g.lancamento);
    put('valor', '0,00');
    put('empresa', this.EMPRESA[unidade] || '');
    put('consultor', g.consultor || '');
    return l;
  },

  // Produto do relatório de vendas que é do CONTRATO, não do balcão: já vem
  // pelos pagamentos (ou é movimento que o motor exclui).
  PRODUTO_DE_CONTRATO: /^(PLANO|MATRICULA|QUITACAO|TAXA DE RENEGOCIA|1 AULA)/,

  /**
   * Vendas de balcão (água, Monster, camiseta) do relatório de vendas que NÃO
   * vieram nos pagamentos do núcleo — era a diferença que sobrava da sombra
   * (ago/2026: −R$ 226,50 no PP, −R$ 420,50 no CP). Cada linha avulsa já
   * existente casa UMA venda (mesmo cliente + dia + valor): duas águas iguais no
   * mesmo dia são duas vendas. Sem vendedora — o relatório não diz quem vendeu.
   */
  linhasDeBalcao({ vendas, linhas, unidade }) {
    const C = this.COL;
    const chave = (nome, dia, valor) => this._norm(nome) + '|' + dia + '|' + Math.round(Number(valor) * 100);
    const existentes = new Map();
    (linhas || []).forEach(l => {
      if (String(l[C.contrato] || '0') !== '0') return;
      const k = chave(l[C.nome], l[C.lancamento], this._valor(l[C.valor]));
      existentes.set(k, (existentes.get(k) || 0) + 1);
    });
    const saida = [];
    (vendas || []).forEach(v => {
      if (String(v.contrato || '0') !== '0') return;
      if (this.PRODUTO_DE_CONTRATO.test(this._norm(v.produto))) return;
      if (!(Number(v.valor) > 0)) return;
      const k = chave(v.cliente, v.dia, v.valor);
      if (existentes.get(k) > 0) { existentes.set(k, existentes.get(k) - 1); return; }
      const l = new Array(this.TAMANHO_LINHA).fill('');
      l[C.nome] = v.cliente || '';
      l[C.produto] = v.produto || '';
      l[C.contrato] = '0';
      l[C.lancamento] = v.dia || '';
      l[C.valor] = this.valorBR(v.valor);
      l[C.empresa] = this.EMPRESA[unidade] || '';
      saida.push(l);
    });
    return { linhas: saida };
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
   * Para o caminho que PAGA (o botão "Atualizar pela Pacto"): de cada contrato,
   * só as linhas do dia do PRIMEIRO pagamento no mês, somadas numa (as formas
   * juntas — PIX + débito é uma venda). Parcela de outro dia do mesmo mês fica
   * de fora e volta em `depois`, para a prévia mostrar.
   *
   * Por quê (sessão 79, 30/09/2026): o regime de caixa paga UMA vez por contrato,
   * sobre o primeiro pagamento. `consolidarPorContrato` soma o mês inteiro — a
   * Margarida (PP 4552, anual em 12× no cartão: 02/09 e 28/09) daria R$ 658 em
   * vez de R$ 329. O termômetro, que só conta ativação, segue com a soma do mês.
   * @returns {{linhas: Array, depois: Array<{contrato, dia, valor}>}}
   */
  primeiroPagamentoPorContrato(linhas) {
    const C = this.COL;
    const iso = d => { const m = String(d || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? m[3] + m[2] + m[1] : ''; };
    const primeiroDia = new Map();
    (linhas || []).forEach(l => {
      const c = String(l[C.contrato] || '');
      if (!c || c === '0') return;
      const d = iso(l[C.lancamento]);
      if (d && (!primeiroDia.has(c) || d < primeiroDia.get(c))) primeiroDia.set(c, d);
    });
    const saida = [], depois = [];
    const porContrato = new Map();
    (linhas || []).forEach(l => {
      const c = String(l[C.contrato] || '');
      if (!c || c === '0') { saida.push(l); return; }
      if (iso(l[C.lancamento]) !== primeiroDia.get(c)) {
        depois.push({ contrato: c, dia: l[C.lancamento], valor: this._valor(l[C.valor]) });
        return;
      }
      const atual = porContrato.get(c);
      if (!atual) { const copia = l.slice(); porContrato.set(c, copia); saida.push(copia); return; }
      atual[C.valor] = this.valorBR(this._valor(atual[C.valor]) + this._valor(l[C.valor]));
      const formas = new Set(String(atual[C.forma] || '').split(' + ').concat(String(l[C.forma] || '').split(' + ')).filter(Boolean));
      atual[C.forma] = [...formas].join(' + ');
    });
    return { linhas: saida, depois };
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
