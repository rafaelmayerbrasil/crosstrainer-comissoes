// ═══════════════════════════════════════════════════════════════
// CrossTainer — Tradutor Pacto → Comissões v1.0
// ═══════════════════════════════════════════════════════════════
// O TecnoFit acabou no fim de julho/2026. De agosto em diante a única entrada
// de dados do módulo de Comissões é o export `faturamento-recebido` da Pacto,
// que traz as mesmas informações em outra ordem e com outros nomes.
//
// Esta peça traduz "linha da Pacto" → "venda que o CommissionEngine já entende".
// Objeto puro, no estilo do `commission.js`: sem Firebase, sem import, sem
// navegador. Roda nos três lugares sem reescrita — script Node hoje, plugado no
// `index.html` depois, alimentado pela API da Pacto no fim. Só muda o cano.
//
// NADA aqui toca `commission.js` nem `index.html`.
//
// Desenho e as medições que sustentam cada regra:
//   docs/superpowers/specs/2026-08-19-tradutor-pacto-comissoes-design.md
// Testes: node scripts/smoke-pacto-adapter.js
//         node scripts/smoke-pacto-ponta-a-ponta.js

const PactoAdapter = {

  // ─── Posições no export ───
  // Ler por POSIÇÃO, nunca por nome: o cabeçalho tem `Responsável` DUPLICADO
  // (4 e 5) e ler por nome faria uma das duas colunas sumir. São coisas
  // diferentes — #1 é quem LANÇOU, #2 é quem GEROU o lançamento.
  COL: {
    matricula: 1, nome: 2, cadastro: 3, resp1: 4, resp2: 5, produto: 6,
    contrato: 7, inicio: 8, termino: 9, duracao: 10, modalidades: 11,
    plano: 12, situacao: 13, lancamento: 14, valor: 15, forma: 16,
    condicao: 17, empresa: 18, turma: 19, categoria: 20, consultor: 21,
  },

  // Cabeçalho de saída — o formato que o módulo já ingere (era o do TecnoFit)
  CABECALHO_SAIDA: [
    'Código', 'Cliente', 'Data', 'Itens', 'Valor Venda', 'Desconto Venda',
    'Desconto Recebimento', 'Valor Final', 'Valor Quitado/Recibo', 'Origem',
    'Tipo de Venda', 'Vendedor',
  ],

  // Marca das linhas cujo plano foi presumido (os contratos "IMPORTAÇÃO").
  // ⚠️ O `classifyRow` decide TUDO por palavra-chave dentro do texto do item.
  // Qualquer palavra aqui que case com AULA/TAXA/FLEX/DEGUSTAÇÃO/MATRÍCULA
  // muda a comissão em silêncio. O caso 10 do smoke existe pra guardar isso.
  MARCA_PRESUMIDO: '[PLANO PRESUMIDO]',

  // Mesma pessoa com dois nomes nas duas plataformas. Sem unificar, a tela
  // cadastra uma pessoa nova (ela cria sozinha todo nome que não reconhece) e o
  // histórico racha em dois — o motor agrupa pelo TEXTO do vendedor.
  //
  // Conferido contra a base de PRODUÇÃO em 26/08 com
  // `scripts/conferir-vendedoras-pacto.js --producao`. Rodar de novo sempre que
  // aparecer nome novo no relatório.
  //   • KALI LÓPEZ (Pacto)    = KALI DUTRA (cadastro, vendedora)
  //   • RODRIGO ROJAIS (Pacto) = RODRIGO (cadastro; 140 linhas em 24 períodos)
  //     ⚠️ RAFAEL ROJAIS é OUTRO sócio, com 269 linhas próprias — não misturar.
  APELIDOS: {
    'KALI LÓPEZ': 'KALI DUTRA',
    'KALI LOPEZ': 'KALI DUTRA',
    'RODRIGO ROJAIS': 'RODRIGO',
  },

  // Rótulos de sistema que aparecem nas colunas de gente e não são vendedora.
  // `PACTO - MÉTODO DE GESTÃO` assina 221 das 386 linhas do Responsável#1 — é o
  // robô da migração. Tratá-lo como nome deixava 6 contratos sem vendedora e
  // ainda fazia o robô aparecer no ranking.
  GENERICOS: ['ADMINISTRADOR', 'RECORRENCIA', 'RECORRÊNCIA', 'SISTEMA'],
  PREFIXOS_GENERICOS: [/^PACTO\b/],

  // ─── Helpers de leitura ───
  campo(linha, nome) { return String(linha[this.COL[nome]] === undefined ? '' : linha[this.COL[nome]]).trim(); },

  /** "1.234,56" → 1234.56 · "" → 0 */
  valorBR(txt) {
    const s = String(txt || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  },

  /** "05/08/2026" → "2026-08" */
  mesDe(data) {
    const m = String(data || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? m[3] + '-' + m[2] : '';
  },

  /** Nome canônico da vendedora (caixa alta, espaços colapsados, apelido resolvido) */
  normalizarNome(nome) {
    const n = String(nome || '').trim().toUpperCase().replace(/\s+/g, ' ');
    return this.APELIDOS[n] || n;
  },

  ehGenerico(nome) {
    const n = String(nome || '').trim().toUpperCase();
    return this.GENERICOS.includes(n) || this.PREFIXOS_GENERICOS.some(re => re.test(n));
  },

  /**
   * Extrai as pessoas de verdade de uma coluna de nome, na ordem em que vêm.
   * A Pacto grava venda dividida como "ERICA FAUSTINO, FRANCINI DAS CHAGAS" no
   * mesmo campo — 9 linhas no export de agosto. Isso é ganho sobre o TecnoFit,
   * onde a divisão era declarada à mão depois.
   */
  pessoasEm(txt) {
    const vistos = [];
    String(txt || '').split(/\s*[;,]\s*/).forEach(bruto => {
      const n = bruto.trim();
      if (!n || this.ehGenerico(n)) return;
      const c = this.normalizarNome(n);
      if (!vistos.includes(c)) vistos.push(c);
    });
    return vistos;
  },

  ehImportacao(txt) { return String(txt || '').toUpperCase().includes('IMPORTA'); },

  /**
   * O arquivo é um export da Pacto?
   *
   * Existe para a tela de Upload decidir sozinha: se for da Pacto, traduz antes
   * de entregar ao motor; se não for, segue o caminho de sempre. O formato
   * antigo do TecnoFit ainda pode aparecer (arquivo guardado, re-upload de mês
   * fechado) e não pode quebrar.
   *
   * Assinatura: `Nome Cliente` na posição 2 e `Data Lançamento` na 14 — as duas
   * juntas, porque só uma delas casaria com planilha de outro assunto.
   */
  ehExportPacto(linhas) {
    return (linhas || []).slice(0, 5).some(l => {
      if (!l) return false;
      const nome = String(l[this.COL.nome] || '').trim().toUpperCase();
      const lanc = String(l[this.COL.lancamento] || '').trim().toUpperCase();
      return nome === 'NOME CLIENTE' && lanc.startsWith('DATA LAN');
    });
  },

  /**
   * Diz QUAL dos dois relatórios da Pacto é o arquivo. Existe porque eles têm
   * exatamente as mesmas 21 colunas nas mesmas posições — o tradutor engole os
   * dois sem reclamar — e só um serve para comissão:
   *
   *  • `faturamento-recebido`    → a PARCELA que entrou no caixa. **É este.**
   *  • `Faturamento por Período` → o contrato INTEIRO.
   *
   * Medido no mesmo contrato 7078: R$ 259,00 no recebido contra
   * R$ 3.108,00 no faturamento — 12× exato. Plano recorrente dá 1×, porque aí o
   * contrato é de um mês só; é justamente o que faz o engano passar despercebido
   * numa conferência por amostragem. Como `getValor` paga 5% sobre o valor
   * quitado, o arquivo errado pagaria R$ 155 em vez de R$ 12,95 em cada anual.
   *
   * Sinal: `Forma Pagamento` vem 100% preenchida no recebido e 100% vazia no
   * faturamento (386/386 contra 0/715 nos arquivos reais de agosto/2026).
   *
   * @returns {'recebido'|'faturamento'|'desconhecido'}
   */
  detectarRelatorio(linhas) {
    const dados = (linhas || []).filter(l => l && this.campo(l, 'nome')
      && !/^nome\s+cliente$/i.test(this.campo(l, 'nome'))
      && /^\d{2}\/\d{2}\/\d{4}/.test(this.campo(l, 'lancamento')));
    if (!dados.length) return 'desconhecido';
    return dados.some(l => this.campo(l, 'forma')) ? 'recebido' : 'faturamento';
  },

  /**
   * Conserta a grafia que quebra o `detectPeriodicidade()` do motor, que casa
   * por palavra inteira. Observado no export de agosto: "MENSA L" (com espaço
   * no meio) — o motor não acha MENSAL e o plano deixa de virar ativação.
   */
  normalizarPlano(txt) {
    return String(txt || '')
      .replace(/\bBIANUA\s+L\b/gi, 'BIANUAL')
      .replace(/\bANUA\s+L\b/gi, 'ANUAL')
      .replace(/\bMENSA\s+L\b/gi, 'MENSAL')
      .replace(/\bRECORRENT\s+E\b/gi, 'RECORRENTE')
      .replace(/\s{2,}/g, ' ')
      .trim();
  },

  /** O texto já diz a periodicidade? (usa o mesmo critério do motor) */
  temPeriodicidade(txt) {
    const t = String(txt || '').toUpperCase();
    return ['BIANUAL', 'ANUAL', 'RECORRENTE', 'MENSAL'].some(p => new RegExp('\\b' + p + '\\b').test(t));
  },

  /**
   * Recupera a periodicidade pela Duração, para os contratos "IMPORTAÇÃO" que
   * perderam o nome do plano na migração.
   *   12       → anual
   *   13 e 14  → anual com período de brinde (ex.: 20/12/2025 → 30/01/2027)
   *   24       → bianual
   *   1        → mensal; RECORRENTE quando cobrado em cartão recorrente
   *              (a diferença é R$ 5 de bônus P2)
   */
  periodicidadePorDuracao(duracao, forma) {
    const d = parseInt(String(duracao || '').trim(), 10);
    if (d === 24) return 'BIANUAL';
    if (d === 12 || d === 13 || d === 14) return 'ANUAL';
    if (d === 1) return /RECORRENTE/i.test(String(forma || '')) ? 'RECORRENTE' : 'MENSAL';
    return null;
  },

  // ─── Classificação da linha crua ───
  ehLinhaDeContrato(l) {
    const c = this.campo(l, 'contrato');
    return !!c && c !== '0';
  },

  /**
   * A cobrança passou pelo gateway antigo do TecnoFit.
   * ⚠️ Isto é FORMA DE PAGAMENTO, não carimbo de data: a migração do meio de
   * pagamento não terminou, então venda nova também aparece assim. Sozinho não
   * descarta nada — no export de 25/08 derrubaria 10 contratos que começaram em
   * agosto (R$ 2.960), com plano por extenso e vendedora identificada.
   */
  ehRecebimentoTecnofit(l) { return /TECNOFIT/i.test(this.campo(l, 'forma')); },

  /**
   * Contrato que começou num mês anterior ao do fechamento.
   * É ESTE o sinal de "dinheiro de contrato antigo chegando agora" — vale tanto
   * para a migração quanto para o gateway velho. Linha sem contrato (bar, loja)
   * não tem início e nunca é antiga.
   */
  comecouForaDoMes(l, mes) {
    if (!this.ehLinhaDeContrato(l)) return false;
    const inicio = this.mesDe(this.campo(l, 'inicio'));
    return !!inicio && inicio !== mes;
  },

  /**
   * Os números de contrato que uma lista de códigos já gravados representa.
   *
   * O `Código` de um item é `C<contrato>` (contrato) ou `A<matrícula>` (avulso),
   * com sufixo `-2`, `-3`… quando o mesmo aparece mais de uma vez no export.
   *
   * ⚠️ Só `C` entra. O `A` é o número da MATRÍCULA DO CLIENTE, não da venda —
   * incluí-lo bloquearia a segunda aula que a mesma pessoa comprasse, em
   * silêncio. Avulso paga sempre: cada compra é uma venda.
   *
   * @param {Array<string>|Set<string>} codigos  códigos gravados nos períodos anteriores
   * @returns {Set<string>} números de contrato ('7078'), sem prefixo nem sufixo
   */
  contratosDe(codigos) {
    const out = new Set();
    (codigos ? Array.from(codigos) : []).forEach(c => {
      const m = String(c || '').trim().match(/^C(\d+)/i);
      if (m) out.add(m[1]);
    });
    return out;
  },

  /** Acerto de contrato cancelado — entra caixa, mas não é venda */
  ehQuitacaoCancelamento(l) {
    const p = this.campo(l, 'produto').toUpperCase();
    return p.includes('QUITA') && p.includes('CANCELAMENTO');
  },

  /**
   * Contrato que já existia e só entrou na Pacto agora — registro da migração
   * do TecnoFit, não venda do mês.
   *
   * O relatório é `faturamento-recebido` e a migração foi entrando aos poucos:
   * cada contrato antigo apareceu com `Data Lançamento` no dia da carga e
   * `Data Início` lá atrás. Em agosto/2026 são 49 linhas, R$ 13.203 — mais que
   * todo o resto junto. Contadas como venda, um contrato de janeiro pagaria
   * ativação e bônus de anual em agosto. Rodando julho assim a conta deu
   * R$ 6.641 contra os R$ 3.381 que foram realmente pagos.
   *
   * O que separa é a COMBINAÇÃO: plano "IMPORTAÇÃO" (a marca da migração) e
   * início fora do mês. Sozinho nenhum dos dois serve — contrato vendido em
   * 31/07 e pago em 05/08 tem início fora do mês e é venda de verdade, e
   * contrato criado na Pacto em agosto pode vir com o plano em branco.
   *
   * ✅ Confirmado em 25/08 cruzando com o "Relatório Faturamento por Período"
   * (o que foi VENDIDO no mês): dos 62 contratos migrados, 50 nem aparecem lá,
   * e os 12 que aparecem são 6 quitações de cancelamento e 6 ajustes de R$ 0,00.
   * Nenhum é venda de agosto.
   *
   * ⚠️ Se o Rodrigo disser que é dinheiro novo entrando, `pagarMigrados` inclui
   * essas linhas. Elas continuam listadas nos dois casos.
   */
  ehMigrado(l, mes) {
    if (!this.comecouForaDoMes(l, mes)) return false;
    return this.ehImportacao(this.campo(l, 'plano')) || this.ehImportacao(this.campo(l, 'produto'));
  },

  /** Taxa que anda junto do contrato, em linha própria (matrícula, renegociação) */
  ehAcessorio(l) { return /MATR[IÍ]CULA|TAXA/i.test(this.campo(l, 'produto')); },

  /** Renovação automática: o robô lançou, ninguém vendeu → não paga comissão */
  ehAutomatica(l) { return this.campo(l, 'resp2').toUpperCase() === 'RECORRENCIA'; },

  unidadeDe(l) {
    const m = this.campo(l, 'empresa').match(/\((CP|PP)\)/i);
    return m ? m[1].toUpperCase() : '';
  },

  /**
   * Traduz o id da unidade do SISTEMA para a sigla que vem no arquivo.
   *
   * Não são a mesma coisa: no staging a unidade é `unit-cp`, em produção é
   * `cp`, e o arquivo traz `CROSSTAINER UNID. CAMPECHE (CP)`. Comparar o texto
   * cru dava "o arquivo não tem linhas da unidade UNIT-CP" com o arquivo certo
   * na mão (pego pelo Rafael no staging em 26/08).
   *
   * Compara só as letras e pela ponta, então cobre `cp`, `CP`, `unit-cp` e
   * `unit_cp` sem inventar regra nova a cada ambiente.
   *
   * @param {string} unitId          id da unidade no sistema
   * @param {string[]} disponiveis   siglas presentes no arquivo (ex.: ['CP','PP'])
   */
  siglaDaUnidade(unitId, disponiveis) {
    const norm = String(unitId || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (!norm) return '';
    return (disponiveis || []).find(s => norm.endsWith(String(s).toUpperCase())) || '';
  },

  /** Situação Contrato → Tipo de Venda no vocabulário do motor */
  tipoDeVenda(situacao) {
    const s = String(situacao || '').toLowerCase();
    if (s.includes('rematr')) return 'Retorno';
    if (s.includes('renov')) return 'Renovação';
    if (s.includes('matr')) return 'Novo Contrato';
    return '';
  },

  /**
   * A vendedora sai de `Consultor` e só.
   * `Responsável` NÃO serve de reserva geral: onde os dois estão preenchidos
   * eles concordam em 46% — um é quem lançou, o outro quem vendeu. Como reserva
   * geral pagaria a pessoa errada em mais da metade das vezes.
   * Cai no Responsável só quando não há conflito possível:
   *  • produto de balcão (água, camiseta): não existe "lançou ≠ vendeu";
   *  • sobrou UMA pessoa entre as duas colunas, descontados os rótulos de
   *    sistema (que ocupam coluna mas não disputam nada).
   * @returns {{vendedor: string, divididaCom: string[]}}
   */
  vendedorDe(l, ehContrato) {
    const doConsultor = this.pessoasEm(this.campo(l, 'consultor'));
    if (doConsultor.length) return { vendedor: doConsultor[0], divididaCom: doConsultor.slice(1) };

    const resp = [];
    [this.campo(l, 'resp1'), this.campo(l, 'resp2')].forEach(col =>
      this.pessoasEm(col).forEach(n => { if (!resp.includes(n)) resp.push(n); }));

    if (resp.length === 1) return { vendedor: resp[0], divididaCom: [] };
    if (resp.length > 1 && !ehContrato) return { vendedor: resp[0], divididaCom: [] };
    return { vendedor: '', divididaCom: [] };
  },

  /** "(03/08/2026 - 02/08/2027)" — o motor lê o início daqui pra adiar venda futura */
  periodoDe(l) {
    const i = this.campo(l, 'inicio'), f = this.campo(l, 'termino');
    if (!/\d/.test(i) || !/\d/.test(f)) return '';   // o relatório usa " - " quando não há data
    return ' (' + i + ' - ' + f + ')';
  },

  /**
   * Monta o `Itens`, que é o campo de onde o motor tira quase tudo.
   * Retorna { texto, presumido }.
   */
  itensDe(l, papel) {
    // Acessório e balcão: o produto da linha já é a descrição certa
    if (papel === 'acessorio' || papel === 'avulso') {
      return { texto: this.normalizarPlano(this.campo(l, 'produto')), presumido: false };
    }
    // Quitação de cancelamento: o motor já exclui qualquer item com RESCISÃO
    if (papel === 'rescisao') {
      return { texto: 'RESCISÃO CONTRATUAL — ' + this.campo(l, 'produto'), presumido: false };
    }

    const produto = this.normalizarPlano(this.campo(l, 'produto'));
    const plano = this.normalizarPlano(this.campo(l, 'plano'));
    const periodo = this.periodoDe(l);

    // 1. O texto legível do plano, quando existe
    for (const t of [produto, plano]) {
      if (t && !this.ehImportacao(t) && (this.temPeriodicidade(t) || t.includes('|'))) {
        return { texto: t + periodo, presumido: false };
      }
    }

    // 2. Contrato "IMPORTAÇÃO": periodicidade pela Duração, LOCAL por decisão
    if (this.ehImportacao(produto) || this.ehImportacao(plano)) {
      const per = this.periodicidadePorDuracao(this.campo(l, 'duracao'), this.campo(l, 'forma'));
      const base = 'PLANO IMPORTADO' + (per ? ' | ' + per + ' | LOCAL' : '');
      return { texto: base + ' ' + this.MARCA_PRESUMIDO + periodo, presumido: true };
    }

    // 3. Nada de plano no texto (voucher degustação, plano de crédito, etc.)
    return { texto: (produto || plano) + periodo, presumido: false };
  },

  /**
   * Define o papel de cada linha dentro de um contrato.
   * A taxa de matrícula vem em linha separada do plano, repetindo o mesmo
   * `Plano` do contrato — traduzir cada linha pelo `Plano` daria duas ativações
   * e dois bônus P2 no mesmo contrato, pagando dobrado.
   * Regra: só UMA linha por contrato é o plano. Se mais de uma disputa (as duas
   * "IMPORTAÇÃO" do contrato 6735: R$ 20 + R$ 195), vale a de maior valor.
   */
  papeisDoContrato(linhas) {
    const papeis = new Map();
    const candidatas = [];
    linhas.forEach(l => {
      if (this.ehQuitacaoCancelamento(l)) papeis.set(l, 'rescisao');
      else if (this.ehAcessorio(l)) papeis.set(l, 'acessorio');
      else candidatas.push(l);
    });
    if (!candidatas.length) return papeis;
    const plano = candidatas.reduce((a, b) =>
      this.valorBR(this.campo(b, 'valor')) > this.valorBR(this.campo(a, 'valor')) ? b : a);
    candidatas.forEach(l => papeis.set(l, l === plano ? 'plano' : 'acessorio'));
    return papeis;
  },

  // ─── Tradução ───
  /**
   * @param {Array<Array>} linhas  linhas cruas do export (célula por posição), cabeçalho incluído
   * @param {Object} opts  { mes: 'AAAA-MM', pagarMigrados: false, codigosPagos: [] }
   *   `codigosPagos` são os códigos já comissionados em períodos ANTERIORES
   *   (array ou Set). Cada contrato paga uma vez só — ver o balde `jaPagos`.
   * @returns {{vendas, marcadas, descartadas, migrados, jaPagos, avisos, porUnidade, mes, meses, relatorio}}
   */
  traduzir(linhas, opts) {
    const o = opts || {};
    const dados = (linhas || []).filter(l => {
      if (!l) return false;
      const nome = this.campo(l, 'nome');
      if (!nome || /^nome\s+cliente$/i.test(nome)) return false;      // cabeçalho
      return /^\d{2}\/\d{2}\/\d{4}/.test(this.campo(l, 'lancamento')); // e o rodapé junto
    });

    const meses = {};
    dados.forEach(l => { const m = this.mesDe(this.campo(l, 'lancamento')); if (m) meses[m] = (meses[m] || 0) + 1; });
    const mes = o.mes || Object.keys(meses).sort().pop() || '';

    const doMes = dados.filter(l => this.mesDe(this.campo(l, 'lancamento')) === mes);

    // Contratos que JÁ receberam comissão em algum mês anterior. Sob regime de
    // caixa o relatório traz uma linha por recebimento, então um anual
    // parcelado reaparece todo mês — e sem esta lista pagaria de novo a cada
    // parcela, sem erro nenhum na tela.
    const jaComissionados = this.contratosDe(o.codigosPagos);

    const descartadas = [], migrados = [], jaPagos = [], uteis = [];
    doMes.forEach(l => {
      const resumo = {
        cliente: this.campo(l, 'nome'), produto: this.campo(l, 'produto'),
        valor: this.valorBR(this.campo(l, 'valor')),
        inicio: this.campo(l, 'inicio'), duracao: this.campo(l, 'duracao'),
        unidade: this.unidadeDe(l),
      };
      // Gateway antigo + contrato que começou antes = dinheiro de contrato velho.
      // O gateway SOZINHO não descarta: venda nova também é cobrada por ele.
      if (this.ehRecebimentoTecnofit(l) && this.comecouForaDoMes(l, mes)) {
        descartadas.push({ ...resumo, motivo: 'RECEBIMENTO TECNOFIT + contrato começou em ' + resumo.inicio + ' — recebimento antigo' });
        return;
      }
      if (this.ehMigrado(l, mes)) {
        migrados.push({ ...resumo, motivo: 'contrato migrado do TecnoFit — começou em ' + resumo.inicio + ', não é venda deste mês' });
        if (!o.pagarMigrados) return;
      }
      // Cada contrato paga UMA VEZ SÓ, no primeiro recebimento. Vale só para
      // linha de contrato: avulso paga sempre, porque o código dele é a
      // matrícula do cliente e barrá-lo mataria a segunda compra da pessoa.
      if (this.ehLinhaDeContrato(l) && jaComissionados.has(this.campo(l, 'contrato'))) {
        jaPagos.push({ ...resumo, contrato: this.campo(l, 'contrato'),
          motivo: 'contrato ' + this.campo(l, 'contrato') + ' já pagou comissão em mês anterior — esta é parcela seguinte' });
        return;
      }
      uteis.push(l);
    });

    // Papel de cada linha: agrupa por contrato, avulsos ficam soltos
    const porContrato = new Map();
    uteis.forEach(l => {
      if (!this.ehLinhaDeContrato(l)) return;
      const c = this.campo(l, 'contrato');
      if (!porContrato.has(c)) porContrato.set(c, []);
      porContrato.get(c).push(l);
    });
    const papeis = new Map();
    porContrato.forEach(grupo => this.papeisDoContrato(grupo).forEach((v, k) => papeis.set(k, v)));

    const vendas = [], marcadas = [], avisos = [];
    const seq = {};

    uteis.forEach(l => {
      const ehContrato = this.ehLinhaDeContrato(l);
      const papel = ehContrato ? (papeis.get(l) || 'plano') : 'avulso';
      const { texto, presumido } = this.itensDe(l, papel);
      const valor = this.valorBR(this.campo(l, 'valor'));
      const { vendedor, divididaCom } = this.vendedorDe(l, ehContrato);
      const cliente = this.campo(l, 'nome');

      // Código estável dentro do export: contrato (ou matrícula) + ordem na chave.
      // ⚠️ `cleanRawData` descarta em SILÊNCIO linha com Código vazio.
      const chave = ehContrato ? 'C' + this.campo(l, 'contrato') : 'A' + this.campo(l, 'matricula');
      seq[chave] = (seq[chave] || 0) + 1;
      const codigo = seq[chave] > 1 ? chave + '-' + seq[chave] : chave;

      const venda = {
        'Código': codigo,
        'Cliente': cliente,
        'Data': this.campo(l, 'lancamento'),
        'Itens': texto,
        'Valor Venda': valor,
        'Desconto Venda': '-',
        'Desconto Recebimento': '-',
        'Valor Final': valor,
        'Valor Quitado/Recibo': valor,
        'Origem': this.ehAutomatica(l) ? 'Renovação automática' : 'Balcão',
        'Tipo de Venda': papel === 'plano' ? this.tipoDeVenda(this.campo(l, 'situacao')) : '',
        'Vendedor': vendedor,
        _unidade: this.unidadeDe(l),
        _contrato: this.campo(l, 'contrato'),
        _papel: papel,
        _presumido: presumido,
        _divididaCom: divididaCom,
      };

      vendas.push(venda);
      if (presumido) marcadas.push(venda);

      // A divisão em si só existe na tela de Comissões — aqui a venda fica com
      // a primeira e sai listada. O nome composto viraria vendedora fantasma.
      if (divididaCom.length) {
        avisos.push({
          motivo: 'venda dividida — aplicar a divisão na tela',
          cliente, valor, comQuem: divididaCom.join(', '),
          produto: this.campo(l, 'produto'),
        });
      }

      if (!vendedor && valor > 0 && papel !== 'rescisao') {
        avisos.push({
          motivo: 'sem vendedora identificada',
          cliente, produto: this.campo(l, 'produto'), valor,
          resp1: this.campo(l, 'resp1'), resp2: this.campo(l, 'resp2'),
        });
      }
      if (papel === 'plano' && presumido && !this.temPeriodicidade(texto)) {
        avisos.push({
          motivo: 'plano importado sem duração reconhecível — não vira ativação',
          cliente, duracao: this.campo(l, 'duracao'), valor,
        });
      }
      if (ehContrato && !this.unidadeDe(l)) {
        avisos.push({ motivo: 'unidade não reconhecida na coluna Empresa', cliente, empresa: this.campo(l, 'empresa') });
      }
    });

    const porUnidade = { CP: [], PP: [], '': [] };
    vendas.forEach(v => (porUnidade[v._unidade] || porUnidade['']).push(v));

    return { vendas, marcadas, descartadas, migrados, jaPagos, avisos, porUnidade, mes, meses,
             relatorio: this.detectarRelatorio(linhas) };
  },

  /** Tira os campos internos (`_algo`) — o que vai pra planilha */
  paraPlanilha(vendas) {
    return vendas.map(v => this.CABECALHO_SAIDA.map(h => v[h]));
  },
};

// Export for use in app
if (typeof module !== 'undefined') module.exports = PactoAdapter;
