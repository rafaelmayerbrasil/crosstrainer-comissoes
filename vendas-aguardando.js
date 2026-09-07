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
          cliente: PA.campo(l, 'nome'),
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
     * @param {Array<string>} pagos   códigos já comissionados, de QUALQUER mês
     * @param {Array<string>} clientesPagantes  clientes com recebimento DE CONTRATO
     *        no período (bar e loja não contam — pagar uma água não paga o plano)
     * Registro de teste sai antes dos três grupos e volta em `testes`, para a
     * tela poder DIZER que tirou. Sumir calado é como a gestão fica procurando
     * a diferença entre o número da tela e o que ela contou na mão.
     *
     * @returns {{aguardando, conferir, pagas, porVendedora, testes}}
     */
    cruzar(vendas, pagos, clientesPagantes) {
      const jaPagou = PA.contratosDe(pagos);
      const pagante = new Set((clientesPagantes || []).map(norm));
      const aguardando = [], conferir = [], pagas = [], testes = [];

      (vendas || []).forEach(v => {
        // Antes de tudo: teste não é venda em estado nenhum — nem pago, nem
        // aguardando, nem "conferir".
        if (this.ehTeste(v)) { testes.push(v); return; }
        const num = String(v.contrato).replace(/^C/i, '');
        if (jaPagou.has(num)) { pagas.push(v); return; }
        if (pagante.has(norm(v.cliente))) {
          conferir.push({ ...v, motivoConferir: 'o cliente pagou no mês, mas em outro contrato — provável renovação que trocou de número' });
          return;
        }
        aguardando.push(v);
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
