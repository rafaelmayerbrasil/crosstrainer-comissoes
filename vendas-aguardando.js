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

  // R$ em pt-BR, à mão — `toLocaleString('pt-BR')` depende do Node ter o ICU
  // completo (full-icu) e, sem ele, degrada em silêncio para o formato en-US
  // (ponto decimal). Este texto vai para a tela da gestão, então não pode
  // arriscar. Ponto de milhar entra porque contrato anual passa de R$ 1.000
  // com frequência (ex.: R$ 2.388,00) e "2388,00" sem separador lê pior.
  const moeda = valor => {
    const n = Number(valor || 0);
    const negativo = n < 0;
    const [inteiro, centavos] = Math.abs(n).toFixed(2).split('.');
    const comMilhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (negativo ? '-' : '') + comMilhar + ',' + centavos;
  };

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
     * ⚠️ A regra mora no `PactoAdapter` e é lida daqui, uma cópia só. Ela
     * precisa valer nos DOIS caminhos — o da venda (esta tela) e o do
     * recebimento, que alimenta o `commission.js`. Enquanto existiu só aqui, o
     * mesmo fantasma passou pelo outro lado e somou 1 ativação e R$ 768,00 ao
     * caixa do Príncipe em setembro/2026.
     *
     * @param {Object} venda  item de `extrair`
     */
    ehTeste(venda) {
      return PA.ehNomeDeTeste((venda && venda.cliente) || '');
    },

    /**
     * O que o sistema ACHA sobre uma venda "a conferir" — e por quê.
     *
     * ⚠️ Opinião NUNCA decide. Foi a pergunta do Rafael em 07/09/2026 ("o
     * sistema não pode marcar sozinho?") e a resposta veio dos dois casos
     * reais de produção: a Amandha e a Cátia pagaram R$ 239 e R$ 199 ANTES de
     * a venda existir, contra renovações anuais de R$ 2.388 que só começavam
     * em setembro. Marcar "pago" sozinho faria a gestão parar de acompanhar
     * R$ 4.776.
     *
     * @param {Object} venda      item de `cruzar().conferir`
     * @param {Object} pagamento  `pagamentoQueBateu`, ou null
     * @returns {{suspeita: string, porque: string}}
     */
    opiniao(venda, pagamento) {
      const naoSei = { suspeita: 'nao_da_para_dizer',
        porque: 'Não dá para dizer pelo arquivo — vale conferir na Pacto.' };
      if (!venda || !pagamento) return naoSei;

      // dd/mm/aaaa → aaaammdd, para comparar como texto sem fuso nenhum
      const ord = d => {
        const m = String(d || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        return m ? m[3] + m[2] + m[1] : null;
      };
      const pago = ord(pagamento.data), fechada = ord(venda.data);
      const pagamentoAnterior = !!(pago && fechada && pago < fechada);

      const valor = Number(pagamento.valor || 0);
      const contrato = Number(venda.valorContrato || 0);
      const valorBate = valor > 0 && contrato > 0 && Math.abs(valor - contrato) < 0.01;

      // Os dois sinais podem brigar. Numa academia é comum o cliente pagar no
      // dia da negociação e o contrato só ser lançado no sistema alguns dias
      // depois — aí o pagamento É desta venda, só que datado antes de
      // `venda.data` por causa do atraso de lançamento, não porque é de outro
      // plano. Se o valor bate exato com o contrato ao mesmo tempo que a data
      // vem antes, a data sozinha não pode decidir: ela e o valor apontam para
      // lados opostos, e a resposta honesta é admitir a briga.
      if (pagamentoAnterior && valorBate) {
        return {
          suspeita: 'nao_da_para_dizer',
          porque: 'O valor pago (R$ ' + moeda(valor) + ') é exatamente o valor deste contrato'
            + ' (R$ ' + moeda(contrato) + '), o que sugere que é esta venda. Mas o pagamento é'
            + ' de ' + pagamento.data + ', antes de esta venda ter sido fechada em ' + venda.data
            + ', o que sugere que é do plano anterior. Vale conferir na Pacto.',
        };
      }

      // Pagamento anterior à venda ganha de tudo quando o valor NÃO bate:
      // dinheiro que entrou antes de a venda existir, e num valor diferente,
      // não pode ser dela.
      if (pagamentoAnterior) {
        return {
          suspeita: 'provavelmente_nao_paga',
          porque: 'O pagamento que bateu o nome foi de R$ ' + moeda(pagamento.valor)
            + ' em ' + pagamento.data + ' — antes desta venda existir, fechada em ' + venda.data
            + '. Provavelmente é do plano anterior, e esta venda ainda não foi paga.',
        };
      }

      if (valorBate) {
        return {
          suspeita: 'provavelmente_paga',
          porque: 'O valor pago (R$ ' + moeda(valor) + ', no contrato ' + pagamento.codigo
            + ') bate com o valor do contrato ' + venda.contrato + ' desta venda.'
            + ' Provavelmente é esta venda, só que com outro número de contrato.',
        };
      }

      return naoSei;
    },

    /**
     * Aplica as marcações da gestão sobre os três grupos de `cruzar`.
     *
     * A ordem de quem manda, e ela é o coração desta tela:
     *   1. o contrato apareceu nos recebimentos  → PAGA. Ganha de tudo.
     *   2. senão, vale a marcação da gestão
     *   3. senão, o automático de `cruzar`
     *
     * 🚨 O DINHEIRO SEMPRE GANHA. Se alguém marcou "não vamos cobrar" e o
     * cliente pagou depois, a venda volta a contar como paga e leva
     * `marcacaoIgnorada` para a tela poder DIZER que havia marcação em
     * contrário. Uma marcação humana nunca pode esconder dinheiro que entrou:
     * é o que impede esta tela de mentir.
     *
     * @param {{pagas, aguardando, conferir}} cruzado  saída de `cruzar`
     * @param {Object<string, {desfecho: string, pagamentoApontado?: Object, observacao?: string, por?: string, em?: string}>} conferencias
     *        contrato → marcação da gestão. `desfecho` é `'paga'` (a venda foi
     *        explicada por um pagamento REAL, que vem em `pagamentoApontado`)
     *        ou `'cancelada'` (o cliente desistiu). Qualquer outro valor — ou
     *        ausente — é tratado como "sem marcação", e a venda fica onde
     *        estava.
     * @param {Object<string, {desfecho: string}>} [descartes]
     *        código do PAGAMENTO → marcação de que ele não é de venda nenhuma
     *        (`desfecho: 'sem_venda'`). É o que faz o sistema parar de
     *        perguntar por um pagamento já conferido: sem isso a pergunta
     *        volta amanhã, porque a lista é recalculada a cada abertura.
     * @returns {{pagas, aguardando, conferir, canceladas, testes, porVendedora}}
     *        mesma forma de `cruzar`, com o grupo novo `canceladas`; a venda
     *        marcada carrega `conferencia` (o registro inteiro), e a que teve
     *        a marcação ignorada pelo dinheiro carrega `marcacaoIgnorada`
     */
    aplicarConferencias(cruzado, conferencias, descartes) {
      const c = cruzado || {};
      const marcas = conferencias || {};
      const semVenda = descartes || {};
      const de = v => marcas[v.contrato] || marcas[String(v.contrato).replace(/^C/i, '')] || null;

      // (1) quem já está em `pagas` veio dos recebimentos: nada mexe nisso —
      // só leva o aviso de que existia marcação em contrário, se existir.
      const pagas = (c.pagas || []).map(v => {
        const m = de(v);
        return (m && m.desfecho !== 'paga') ? { ...v, marcacaoIgnorada: m } : v;
      });
      const aguardando = [], conferir = [], canceladas = [];

      // (2) e (3) para o resto: o automático de `cruzar` só vale quando a
      // gestão não marcou nada (ou marcou um desfecho que o código não conhece).
      [].concat(c.aguardando || [], c.conferir || []).forEach(v => {
        const m = de(v);
        const eraConferir = (c.conferir || []).indexOf(v) >= 0;
        // O pagamento que levantou a dúvida já foi conferido e descartado:
        // a venda continua na fila, mas a pergunta não volta.
        const paraFila = eraConferir
          && v.pagamentoQueBateu
          && semVenda[String(v.pagamentoQueBateu.codigo)];
        if (!m) { (eraConferir && !paraFila ? conferir : aguardando).push(v); return; }
        const vm = { ...v, conferencia: m };
        if (m.desfecho === 'paga') pagas.push(vm);
        else if (m.desfecho === 'cancelada') canceladas.push(vm);
        else (eraConferir && !paraFila ? conferir : aguardando).push(v);   // desconhecido: não move
      });

      return { ...c, pagas, aguardando, conferir, canceladas };
    },

    /**
     * As dúvidas vistas do lado do DINHEIRO — um pagamento, as vendas que ele
     * pode estar explicando.
     *
     * A tela pergunta *"este pagamento é de qual venda?"*, e não *"esta venda
     * foi paga?"*. A diferença não é cosmética: partindo da venda, dá para
     * marcar "paga" sem lastro nenhum; partindo do dinheiro, só existe pergunta
     * onde existe um recebimento de verdade no relatório. Foi a correção do
     * Rafael em 09/09/2026.
     *
     * O mesmo pagamento pode ter mais de uma venda candidata (a pessoa fechou
     * duas coisas no mês) — e aí é UMA pergunta com duas opções, não duas
     * perguntas.
     *
     * @param {{conferir}} cruzado  saída de `cruzar`/`aplicarConferencias`
     * @returns {Array<{pagamento: Object, candidatas: Array}>}
     */
    duvidasPorPagamento(cruzado) {
      const porCodigo = new Map();
      ((cruzado || {}).conferir || []).forEach(v => {
        const p = v.pagamentoQueBateu;
        if (!p) return;
        const k = String(p.codigo || p.cliente || '');
        if (!porCodigo.has(k)) porCodigo.set(k, { pagamento: p, candidatas: [] });
        porCodigo.get(k).candidatas.push(v);
      });
      return [...porCodigo.values()];
    },

    /**
     * O mesmo dinheiro não explica dois contratos.
     *
     * Sem esta trava, a gestão poderia apontar o pagamento de R$ 199 da Cátia
     * como sendo da renovação E de outra venda dela — e a conferência passaria
     * a mentir sobre o que já foi recebido.
     *
     * @param {Object} conferencias  contrato → marcação
     * @param {string} codigoPagamento  o pagamento que se quer apontar
     * @param {string} contratoDaVenda  a venda que o está apontando agora
     * @returns {?{contrato: string, cliente: string}} a venda que já o usa, ou null
     */
    pagamentoJaApontado(conferencias, codigoPagamento, contratoDaVenda) {
      const alvo = String(codigoPagamento || '');
      if (!alvo) return null;
      const meu = String(contratoDaVenda || '').replace(/^C/i, '');
      for (const [contrato, m] of Object.entries(conferencias || {})) {
        if (!m || m.desfecho !== 'paga' || !m.pagamentoApontado) continue;
        if (String(m.pagamentoApontado.codigo || '') !== alvo) continue;
        // A própria venda reapontando o mesmo pagamento não é conflito.
        if (String(contrato).replace(/^C/i, '') === meu) continue;
        return { contrato, cliente: m.cliente || '' };
      }
      return null;
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
        // Nome vazio (ou só espaço, que normaliza pra vazio) não é ninguém — gravar
        // essa chave faria QUALQUER venda com cliente vazio casar com ela e levar
        // pra tela o lançamento de uma pessoa completamente diferente como "prova".
        // O carregador da tela filtra `if (it.cliente)`, que deixa passar um nome
        // só com espaços — a trava certa é aqui, porque um módulo puro não pode
        // confiar em quem o chama.
        if (!chave) return;
        // Guarda o PRIMEIRO lançamento de cada cliente: se o mesmo nome aparecer
        // duas vezes, não há como saber qual dos dois bateu com ESTA venda — a
        // prova serve pra gestão abrir a Pacto e conferir, não pra decidir valor.
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
        const chaveNome = norm(nome);
        if (pagante.has(chaveNome)) {
          conferir.push({
            ...vl,
            motivoConferir: 'o cliente pagou no mês, mas em outro contrato — provável renovação que trocou de número',
            pagamentoQueBateu: pagante.get(chaveNome), // .has() já garantiu a chave — nunca undefined aqui
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
     * @param {{pagas, aguardando, conferir, canceladas}} cruzado  saída de `cruzar`/`aplicarConferencias`
     * @param {Array<string>} naoComissionaveis  `cfg.naoComissionaveis` do motor
     * @returns {Object} nome → {vendidas, pagas, aguardando, conferir, canceladas, naoComissionado}
     *        `vendidas = pagas + aguardando + conferir + canceladas` — por pessoa,
     *        não só no total do mês (ver `resumo`). Sem isso a soma da tabela por
     *        vendedora fica MENOR que o total, e a tela não explica por quê.
     */
    contarPorVendedora(cruzado, naoComissionaveis) {
      const naoCom = (naoComissionaveis || []).map(x => String(x).toUpperCase().trim());
      const out = {};
      const contar = (lista, campo) => (lista || []).forEach(v => {
        const nomes = (v.vendedores && v.vendedores.length) ? v.vendedores : ['(sem vendedora)'];
        nomes.forEach(nome => {
          const x = out[nome] = out[nome] || {
            vendidas: 0, pagas: 0, aguardando: 0, conferir: 0, canceladas: 0,
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
      contar(cruzado && cruzado.canceladas, 'canceladas');
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
      // A venda em que o cliente DESISTIU foi vendida de verdade: sai das que
      // ainda esperam dinheiro, não da história do mês. Por isso ela continua
      // em `vendidas` e aparece como nota, fora dos três números.
      const canceladas = (c.canceladas || []).length;
      return { vendidas: pagas + aguardando + conferir + canceladas,
               pagas, aguardando, conferir, canceladas };
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
