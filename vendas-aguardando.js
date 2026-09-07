// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — "Vendi, aguardando pagamento"
// Puro (sem DOM, sem Firebase). Browser (window.VendasAguardando) e Node.
//
// Pedido do Rodrigo em 01/09/2026: sob regime de caixa a comissão só nasce
// quando o dinheiro entra, então a vendedora precisa ver onde está o que ela
// vendeu. Sem isso ela compara a lista dela com o pagamento, não bate, e conclui
// que o sistema errou — o atrito que a mudança de regime cria.
//
// ⚠️ POR QUE PRECISA DE UM SEGUNDO ARQUIVO
// O `faturamento-recebido` traz RECEBIMENTOS: venda não paga não existe nele.
// Medido em agosto/2026 — a renovação anual de 19/08 do Príncipe não aparece em
// nenhuma das 619 linhas. Quem sabe o que foi VENDIDO é o outro relatório da
// Pacto, o `faturamento`, com as MESMAS 21 colunas.
//
// 🛑 São dois arquivos gêmeos e o de vendas traz o CONTRATO INTEIRO (R$ 3.108
//    num anual de 12×) em vez da parcela. Ele NUNCA pode alimentar o cálculo —
//    pagaria 12× a mais. Aqui ele entra só para conferência, e
//    `ehRelatorioDeVendas()` recusa o outro.
//
// 🔑 O cruzamento reaproveita a memória que já existe: um contrato deixa de
//    aguardar quando aparece em `codigosPagos` de QUALQUER mês. Venda de agosto
//    paga em setembro sai da lista sozinha, sem ninguém mexer.
// ═══════════════════════════════════════════════════════════════════════
(function (root, factory) {
  // ⚠️ `pacto-adapter.js` declara `const PactoAdapter = {...}` no topo do
  // arquivo — e `const` em script clássico NÃO vira `window.PactoAdapter`.
  // Ele existe só no escopo global léxico. Procurar em `root` devolvia
  // undefined e o upload morria com "Cannot read properties of undefined
  // (reading 'campo')". No Node não aparecia, porque lá é `require`.
  const PA = (typeof module !== 'undefined' && module.exports)
    ? require('./pacto-adapter.js')
    : (root.PactoAdapter || (typeof PactoAdapter !== 'undefined' ? PactoAdapter : null));
  const api = factory(PA);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VendasAguardando = api;
})(typeof window !== 'undefined' ? window : globalThis, function (PA) {
  'use strict';

  // Tira acento também: o mesmo cliente vem "CÁTIA" num relatório e "CATIA" no
  // outro, e sem isso a mesma pessoa vira duas.
  const norm = s => String(s || '').trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

  // Rótulos de interface que vazaram para dentro do campo do nome, na Pacto.
  //
  // ⚠️ Lista curta de propósito, e só com o que foi VISTO no dado real. Cada
  // entrada nova é risco de comer o sobrenome de alguém — e apagar meia venda
  // em silêncio é pior que mostrar um nome feio. Antes de acrescentar, rodar
  // uma varredura na base e conferir quem mais casaria.
  //
  // ⚠️ E o corte é ancorado no RÓTULO, nunca no espaço duplo: um espaço a mais
  // digitado por engano cortaria "ANA  PAULA SOUZA" em "ANA".
  const ROTULOS = ['VISAO GERAL'];

  return {
    /** Só o relatório de VENDAS entra por aqui — o de recebimentos é o outro caminho */
    ehRelatorioDeVendas(linhas) {
      return PA.ehExportPacto(linhas) && PA.detectarRelatorio(linhas) === 'faturamento';
    },

    /**
     * Lê o relatório de vendas e devolve as vendas agrupadas por unidade e mês.
     *
     * Fica de fora o que não é venda esperando dinheiro: avulso (é pago na hora),
     * contrato migrado do TecnoFit, renovação automática (não paga comissão),
     * quitação de cancelamento e linha de valor zero.
     *
     * @returns {Object} { 'CP|2026-08': [venda, …], … }
     */
    extrair(linhas) {
      const dados = (linhas || []).filter(l => {
        if (!l) return false;
        const nome = PA.campo(l, 'nome');
        if (!nome || /^nome\s+cliente$/i.test(nome)) return false;
        return /^\d{2}\/\d{2}\/\d{4}/.test(PA.campo(l, 'lancamento'));
      });

      const out = {};
      const vistos = new Set();
      dados.forEach(l => {
        if (!PA.ehLinhaDeContrato(l)) return;                    // avulso é pago na hora
        const mes = PA.mesDe(PA.campo(l, 'lancamento'));
        if (!mes) return;
        if (PA.ehMigrado(l, mes)) return;                        // contrato antigo, não é venda
        if (PA.ehQuitacaoCancelamento(l)) return;
        // Cobrança no cartão recorrente NÃO é filtro: quase sempre é venda de
        // gente (ver `PactoAdapter.ehCobrancaRecorrente`). Até 07/09/2026 esta
        // linha sumia daqui junto com a comissão dela.
        const valor = PA.valorBR(PA.campo(l, 'valor'));
        if (!valor) return;

        const unidade = PA.unidadeDe(l);
        const contrato = 'C' + PA.campo(l, 'contrato');
        const chave = unidade + '|' + mes;
        if (vistos.has(chave + '|' + contrato)) return;          // taxa + plano = uma venda
        vistos.add(chave + '|' + contrato);

        const { vendedor, divididaCom } = PA.vendedorDe(l, true);
        (out[chave] = out[chave] || []).push({
          contrato,
          cliente: this.limparNome(PA.campo(l, 'nome')),
          // Guardado só quando difere: é por ele que a gestão acha a pessoa na
          // Pacto para arrumar o cadastro na origem.
          clienteOriginal: PA.campo(l, 'nome'),
          vendedores: [vendedor, ...(divididaCom || [])].filter(Boolean),
          data: PA.campo(l, 'lancamento'),
          inicio: PA.campo(l, 'inicio'),
          situacao: PA.campo(l, 'situacao'),
          plano: PA.campo(l, 'plano') || PA.campo(l, 'produto'),
          valorContrato: valor,
          // ⚠️ Rótulo obrigatório: este valor é o CONTRATO INTEIRO, não a
          // comissão. Sem isso a tela prometeria 12× o que a pessoa vai receber.
          avisoValor: 'valor do contrato, não da comissão',
          unidade, mes,
        });
      });
      return out;
    },

    /**
     * Tira do nome do cliente o rótulo de tela que a Pacto deixou grudar.
     *
     * Em produção existe um caso, e um só:
     * `MARIANA MINGHELLI BECKER  VISÃO GERAL CADASTRO VE` (o "VE" cortado pelo
     * limite do campo). Ela é cliente de VERDADE — renovação anual de
     * R$ 2.598,57 vendida em 07/08/2026 e até hoje sem pagamento. O que se
     * limpa aqui é o NOME, nunca a venda: ela tem que continuar no arrasto.
     *
     * Serve a duas coisas: o nome sair certo na tela, e o cruzamento por nome
     * voltar a funcionar. O grupo "conferir" casa cliente pagante por NOME —
     * com o nome sujo de um lado e limpo do outro, uma renovação já paga em
     * outro contrato apareceria como "não pagou".
     *
     * Nunca devolve vazio: se sobrasse nada, é melhor o nome feio que branco.
     *
     * @param {string} nome
     * @returns {string} o nome sem o rótulo; o original, se não houver o que tirar
     */
    limparNome(nome) {
      const cru = String(nome || '').replace(/\s+/g, ' ').trim();
      if (!cru) return '';
      const semAcento = norm(cru);
      for (const rotulo of ROTULOS) {
        const i = semAcento.indexOf(rotulo);
        // Só corta se o rótulo começar em palavra, e se sobrar nome antes dele.
        if (i > 0 && /\s/.test(semAcento[i - 1])) {
          const limpo = cru.slice(0, i).trim();
          if (limpo) return limpo;
        }
      }
      return cru;
    },

    /**
     * Registro de teste — não é venda de ninguém.
     *
     * Em produção existe `TESTE ENDEREÇO TECNOFIT` (contrato C7117, R$ 150,
     * 25/08/2026). Ele entrava na contagem do mês e virava tarefa de cobrança
     * no arrasto, ao lado de gente de verdade.
     *
     * ⚠️ O casamento é por PALAVRA INTEIRA, e não por pedaço do nome. Existe
     * uma cliente chamada `ESTEFANE COUTINHO CAMPOS`, e foi exatamente um
     * casamento por pedaço que fez o BIANUAL ser lido como ANUAL em produção
     * (commit 6f0a15b). Um falso positivo aqui apaga a venda de alguém.
     *
     * @param {Object} venda  item de `extrair`
     */
    ehTeste(venda) {
      return /(^|[^A-Za-zÀ-ÿ])TESTES?([^A-Za-zÀ-ÿ]|$)/i.test(String((venda && venda.cliente) || ''));
    },

    /**
     * Separa o que ainda espera pagamento do que já recebeu.
     *
     * ⚠️ SÓ O NÚMERO DO CONTRATO NÃO BASTA — medido no dado real de agosto/2026.
     * Quando o aluno renova, a Pacto cria um contrato NOVO, mas a cobrança do mês
     * pode continuar caindo no contrato ANTIGO (o migrado do TecnoFit, que segue
     * vivo). A Cátia é o caso: renovação no contrato 7130 em 27/08, e o dinheiro
     * dela entrou no contrato 6867 em 12/08. Cruzando só por número, a venda dela
     * parecia parada — e a comissão já tinha sido paga.
     *
     * Por isso o resultado tem TRÊS grupos, e não dois. O do meio não é chute: é
     * a pergunta que só a gestão responde, mostrada em vez de escondida.
     *
     * @param {Array} vendas          saída de `extrair`, de um mês/unidade
     * @param {Array<string|{codigo,mes,data}>} pagos  códigos já comissionados,
     *        de QUALQUER mês — lista achatada de códigos (de sempre) ou objetos
     *        `{ codigo, mes, data }` quando quem chama sabe de qual mês veio cada um
     * @param {Array<string|{cliente,codigo,valor,data}>} clientesPagantes  clientes
     *        com recebimento DE CONTRATO no período (bar e loja não contam — pagar
     *        uma água não paga o plano) — lista achatada de nomes (de sempre) ou
     *        objetos com o lançamento inteiro, quando quem chama tem essa prova
     *        para mostrar ao lado da pergunta em vez de mandar a gestão procurar
     *        na Pacto
     * Registro de teste sai antes dos três grupos e volta em `testes`, para a
     * tela poder DIZER que tirou. Sumir calado é como a gestão fica procurando
     * a diferença entre o número da tela e o que ela contou na mão.
     *
     * @returns {{aguardando, conferir, pagas, porVendedora, testes}} as vendas em
     *        `pagas` trazem `pagoEm: {mes, data} | null` — null quando `pagos` só
     *        informou o código, sem dizer de qual mês veio o pagamento. As vendas
     *        em `conferir` trazem `pagamentoQueBateu: {cliente,codigo,valor,data} | null`
     *        — null quando `clientesPagantes` só informou o nome, sem o lançamento
     */
    cruzar(vendas, pagos, clientesPagantes) {
      // `pagos` aceita duas formas, de propósito:
      //   • lista de códigos           — como sempre funcionou
      //   • [{ codigo, mes, data }]    — quando quem chama sabe de QUAL mês
      //     veio cada código, e aí a venda paga carrega essa informação.
      // O painel achatava tudo numa lista só e jogava o mês fora; era por isso
      // que a venda de agosto paga em setembro sumia calada.
      const ondePagou = {};
      const codigos = (pagos || []).map(p => {
        if (p && typeof p === 'object') {
          if (p.codigo) {
            // ⚠️ Mesma exigência do `contratosDe` logo abaixo: sem o prefixo
            // `C` esta chave nunca bate com `jaPagou` e a entrada fica morta.
            // O formato não é livre — é o que separa "número de contrato" de
            // qualquer outro número solto.
            const num = String(p.codigo).replace(/^C/i, '');
            // Vence o PRIMEIRO mês, não o último a ser lido. Sob regime de
            // caixa o contrato paga uma vez só, no primeiro pagamento — é
            // esse mês que levou a comissão na folha. E a ordem em que os
            // meses chegam aqui não é garantida: quem monta esta lista
            // percorre uma consulta do Firestore sem ordenação. Reprocessar
            // um mês ANTERIOR pode reintroduzir um código que já estava num
            // mês posterior — já aconteceu (7 códigos de cobrança automática
            // repostos em julho por script) — e mostrar o mês posterior
            // diria à gestão que o dinheiro entrou depois do que entrou.
            // Mês desconhecido (null) nunca vence um mês já conhecido, dos
            // dois lados: um `p.mes` ausente não sobrescreve nada, e um
            // `ondePagou[num].mes` ausente perde para qualquer mês real.
            if (!ondePagou[num] || (p.mes && (!ondePagou[num].mes || p.mes < ondePagou[num].mes))) {
              ondePagou[num] = { mes: p.mes || null, data: p.data || null };
            }
          }
          return p.codigo;
        }
        return p;
      });
      const jaPagou = PA.contratosDe(codigos);
      // Os dois lados passam pelo mesmo limpador: o nome pode vir sujo do lado
      // da venda, do lado do recebimento, ou dos dois.
      const limpo = n => norm(this.limparNome(n));

      // `clientesPagantes` aceita duas formas, de propósito:
      //   • lista de nomes                            — como sempre funcionou
      //   • [{ cliente, codigo, valor, data }]        — o lançamento inteiro,
      //     que a tela mostra como PROVA ao lado da pergunta, em vez de mandar
      //     a gestão procurar na Pacto.
      const pagante = new Map();
      (clientesPagantes || []).forEach(c => {
        const nome = (c && typeof c === 'object') ? c.cliente : c;
        const chave = limpo(nome);
        if (!pagante.has(chave)) pagante.set(chave, (c && typeof c === 'object') ? c : null);
      });
      const aguardando = [], conferir = [], pagas = [], testes = [];

      (vendas || []).forEach(v => {
        // Antes de tudo: teste não é venda em estado nenhum — nem pago, nem
        // aguardando, nem "conferir".
        if (this.ehTeste(v)) { testes.push(v); return; }

        // O nome chega aqui limpo mesmo quando foi GRAVADO sujo: os períodos
        // que já estão no banco vieram de antes desta limpeza.
        const nome = this.limparNome(v.cliente);
        const vl = nome === v.cliente ? v : { ...v, cliente: nome, clienteOriginal: v.cliente };

        const num = String(vl.contrato).replace(/^C/i, '');
        if (jaPagou.has(num)) { pagas.push({ ...vl, pagoEm: ondePagou[num] || null }); return; }
        if (pagante.has(norm(nome))) {
          conferir.push({
            ...vl,
            motivoConferir: 'o cliente pagou no mês, mas em outro contrato — provável renovação que trocou de número',
            pagamentoQueBateu: pagante.get(norm(nome)) || null,
          });
          return;
        }
        aguardando.push(vl);
      });

      const porVendedora = {};
      aguardando.forEach(v => {
        (v.vendedores.length ? v.vendedores : ['(sem vendedora)']).forEach(nome => {
          const x = porVendedora[nome] = porVendedora[nome] || { quantidade: 0, valorContratos: 0 };
          x.quantidade++;
          x.valorContratos = Math.round((x.valorContratos + v.valorContrato) * 100) / 100;
        });
      });
      return { aguardando, conferir, pagas, porVendedora, testes };
    },

    /** As vendas de uma pessoa — a dividida conta para as duas */
    daVendedora(vendas, nome) {
      const alvo = norm(nome);
      return (vendas || []).filter(v => v.vendedores.some(x => norm(x) === alvo));
    },

    /**
     * Quanto cada vendedora vendeu e quanto virou dinheiro.
     *
     * ⚠️ A venda DIVIDIDA conta para as duas — é assim que a comissão dela é
     * paga. Por isso a soma desta tabela é MAIOR que o total do mês (ver
     * `resumo`), e isso não é bug: são perguntas diferentes.
     *
     * @param {{pagas, aguardando, conferir}} cruzado  saída de `cruzar`
     * @param {Array<string>} naoComissionaveis  `cfg.naoComissionaveis` do motor
     * @returns {Object} nome → {vendidas, pagas, aguardando, conferir, naoComissionado}
     */
    contarPorVendedora(cruzado, naoComissionaveis) {
      const naoCom = (naoComissionaveis || []).map(x => String(x).toUpperCase().trim());
      const out = {};
      const contar = (lista, campo) => (lista || []).forEach(v => {
        const nomes = (v.vendedores && v.vendedores.length) ? v.vendedores : ['(sem vendedora)'];
        nomes.forEach(nome => {
          const x = out[nome] = out[nome] || {
            vendidas: 0, pagas: 0, aguardando: 0, conferir: 0,
            // mesma regra do motor: `vendedor.includes(n)`
            naoComissionado: naoCom.some(nc => String(nome).toUpperCase().includes(nc)),
          };
          x[campo]++;
          x.vendidas++;
        });
      });
      contar(cruzado && cruzado.pagas, 'pagas');
      contar(cruzado && cruzado.aguardando, 'aguardando');
      contar(cruzado && cruzado.conferir, 'conferir');
      return out;
    },

    /**
     * Os três números do mês. Conta VENDA: a dividida conta uma vez só.
     * @param {{pagas, aguardando, conferir}} cruzado
     */
    resumo(cruzado) {
      const c = cruzado || {};
      const pagas = (c.pagas || []).length;
      const aguardando = (c.aguardando || []).length;
      const conferir = (c.conferir || []).length;
      return { vendidas: pagas + aguardando + conferir, pagas, aguardando, conferir };
    },

    /**
     * O mês já terminou? Só aí o % de conversão diz alguma coisa — no mês
     * corrente ele é baixo por construção, porque a cobrança ainda não caiu.
     * @param {number} year  @param {number} month  1-12
     * @param {Date} hoje  injetável para teste
     */
    mesFechado(year, month, hoje) {
      const d = hoje || new Date();
      const anoAtual = d.getFullYear(), mesAtual = d.getMonth() + 1;
      return year < anoAtual || (year === anoAtual && month < mesAtual);
    },
  };
});
