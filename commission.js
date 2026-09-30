// ═══════════════════════════════════════════════════════════════
// CrossTainer — Commission Engine v2.0
// All P1-P4 rules, meta, tripé, splits, non-commissionable
// ═══════════════════════════════════════════════════════════════

const CommissionEngine = {

  /**
   * O mês em que o DIFERIMENTO deixou de existir.
   *
   * A regra dos 30 dias (plano começa muito depois do pagamento → a comissão vai
   * para o mês do início) nasceu quando a comissão era do mês da VENDA, e servia
   * para não pagar por contrato que o cliente ainda podia desistir de usar.
   *
   * Sob REGIME DE CAIXA ela contradiz o que está valendo: a comissão é do mês em
   * que o dinheiro entrou, paga no dia 15 do mês seguinte — quando o aluno começa
   * a treinar não entra na conta. E a desistência já tem outro dono: é estorno,
   * que vira crédito no pagamento seguinte.
   *
   * ⚠️ Não era só incoerência. A comissão diferida saía do mês do pagamento e
   *    NUNCA era somada em mês nenhum — nada no sistema lê `comissoes_diferidas`
   *    para pagar. Em produção: 91 registros únicos desde janeiro/2025, todos com
   *    `status: 'pendente'`, R$ 6.318,17 que sumiram sem ninguém ver.
   *
   * ⚠️ O CORTE PRESERVA O PASSADO DE PROPÓSITO. Pagamento anterior a este mês
   *    continua diferindo: são 20 meses de folhas já pagas, e re-subir um arquivo
   *    antigo não pode reescrever o que a academia pagou.
   *
   * É uma data FIXA, contra a regra geral do projeto de deixar datas com a
   * gestão, porque não é data de calendário da operação — é o dia em que uma
   * regra de negócio mudou. Editável, ela convidaria alguém a mover o marco e
   * reescrever, sem querer, uma folha já paga.
   *
   * Decidido pelo Rafael em 09/09/2026. Agosto é o primeiro mês pago sob caixa.
   * Desenho: docs/superpowers/specs/2026-09-09-fim-do-diferimento-design.md
   */
  FIM_DO_DIFERIMENTO: '2026-08',

  /**
   * Regra nova do bônus da unidade (P3), pedida pelo Rodrigo em 29/09/2026 para
   * valer na comissão de OUTUBRO (paga em novembro): um conjunto só de mínimos
   * para Meta, Super e Gold; bateu a faixa + os 3 mínimos → 100%; falhou 1 →
   * 50%; falhou 2 ou 3 → zera. E o mínimo individual passa a ser por pessoa
   * (jornada no cadastro). Até setembro vale a regra antiga, sempre.
   *
   * Data FIXA pelo mesmo motivo do FIM_DO_DIFERIMENTO: é o dia em que uma regra
   * mudou, e editável alguém reescreveria uma folha paga sem querer.
   * Desenho: docs/superpowers/specs/2026-09-29-renovacoes-metas-bonus-design.md §5
   */
  INICIO_REGRA_MINIMOS: '2026-10',

  /** A regra nova vale para esta configuração? Precisa de `cfg.mes`; sem ele, a antiga. */
  regraNovaDosMinimos(cfg) {
    return !!(cfg && cfg.mes && cfg.mes >= this.INICIO_REGRA_MINIMOS);
  },

  /**
   * A configuração de um mês: padrão + unidade + metas do mês + QUAL mês é.
   * Todo lugar que calcula ou mostra o bônus monta a configuração por aqui —
   * sem o mês, o motor não sabe qual regra vale.
   */
  configDoMes({ unitConfig, metasMensais, mes, minimosPorPessoa, ativacoesAdiadas } = {}) {
    return {
      ...this.defaultConfig, ...(unitConfig || {}), ...(metasMensais || {}),
      mes: mes || null, minimosPorPessoa: minimosPorPessoa || null,
      // itens de meses anteriores cuja ativação conta neste mês (contrato que começa depois)
      ativacoesAdiadas: ativacoesAdiadas || null,
    };
  },

  /**
   * Ativações, novos+retorno, renovações e vouchers da UNIDADE — uma conta só
   * (antes cada tela somava na mão). Tira os itens cuja ativação foi adiada
   * para outro mês e soma os que chegam de meses anteriores.
   */
  contagensDaUnidade(processed, adiadas) {
    const todos = (processed || []).filter(d => d && !d.ativacaoAdiadaPara)
      .concat((adiadas || []).filter(d => d && d.isActivation));
    const soma = f => this.contagemDaUnidade(todos.reduce((s, d) => s + (f(d) ? (d.splitAtivacao || 1) : 0), 0));
    return {
      unitAtivacoes: soma(d => d.isActivation),
      unitNovosRetorno: soma(d => d.category === 'novo' || d.category === 'retorno'),
      unitRenovacoes: soma(d => d.category === 'renovacao'),
      unitVouchers: soma(d => d.category === 'voucher'),
    };
  },

  /** O mês ('AAAA-MM') da maioria dos itens — rede de segurança quando `cfg.mes` não veio. */
  mesDosItens(itens) {
    const cont = {};
    (itens || []).forEach(d => {
      const m = String((d && d.data) || '').match(/^\d{2}\/(\d{2})\/(\d{4})/);
      if (m) cont[m[2] + '-' + m[1]] = (cont[m[2] + '-' + m[1]] || 0) + 1;
    });
    const ord = Object.entries(cont).sort((a, b) => b[1] - a[1]);
    return ord.length ? ord[0][0] : null;
  },

  _normNome(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  },

  /**
   * Mínimo de ativações para a vendedora entrar no rateio do P3. De outubro em
   * diante, o da jornada dela (`cfg.minimosPorPessoa`, montado do cadastro); o
   * nome do cadastro casa com o da venda por palavra inteira. Senão, o do mês.
   */
  minimoIndividual(nome, cfg) {
    const padrao = cfg && cfg.minAtivacoesIndivP3 !== undefined && cfg.minAtivacoesIndivP3 !== null ? cfg.minAtivacoesIndivP3 : 10;
    if (!this.regraNovaDosMinimos(cfg) || !cfg.minimosPorPessoa) return padrao;
    const alvo = ' ' + this._normNome(nome) + ' ';
    for (const [k, v] of Object.entries(cfg.minimosPorPessoa)) {
      const kk = this._normNome(k);
      if (kk && typeof v === 'number' && alvo.includes(' ' + kk + ' ')) return v;
    }
    return padrao;
  },

  // ─── Default config ───
  defaultConfig: {
    pctNovo: 5,
    pctRenov: 2.5,
    voucherFixo: 10,
    bonusBianual: 80,
    bonusAnualFlex: 45,
    bonusAnualLocal: 30,
    bonusRecorrente: 20,
    bonusMensal: 15,
    meta: 50,
    superMeta: 57,
    metaGold: 65,
    metaFixo: 300,
    superFixo: 600,
    goldFixo: 900,
    metaPct: 0.5,
    tetoMeta: 700,
    tetoSuper: 1000,
    tetoGold: 1300,
    minNovos: 18,
    minRenov: 25,
    minVoucher: 7,
    multFalhaRenov: 0.70,
    multFalhaVoucher: 0.85,
    bonusConversaoVoucher: 30,
    prazoConversaoDias: 45,
    poolVoucherMeta: 150,
    poolVoucherSuper: 300,
    poolVoucherMetaPct: 0.30,
    poolVoucherSuperPct: 0.375,
    poolVoucherMinMeta: 3,
    poolVoucherMinSuper: 4,
    // Degraus da conversão de out/2026 em diante (30% · 40% · 50% → R$ 150 · 300 · 450)
    poolVoucherSuperPctMinimos: 0.40,
    poolVoucherGold: 450,
    poolVoucherGoldPct: 0.50,
    poolVoucherMinGold: 5,
    naoComissionaveis: ['RODRIGO', 'RAFAEL ROJAIS', 'BENNY ELAND', 'SISTEMA'],
    campoValor: 'auto',
    badgeFera: 15,
    badgeImparavel: 20,
    badgeBolso: 2000,
    badgeTopPerf: 3000,
    badgeCaca: 8,
    badgeRei: 8,
    badgeMestre: 5,
    badgeEmChamas: 3,
    badgeMaratonista: 6,
    badgeLenda: 3,
    badgeTopRanking: 5,
    badgeConsistente: 6,
    planosAtivacao: ['BIANUAL', 'ANUAL', 'RECORRENTE', 'MENSAL'],
    minAtivacoesIndivP3: 10,
    // Mínimo individual pela jornada da vendedora (out/2026 em diante, jornada-comercial.js)
    minIndivIntegral: 18,
    minIndiv30h: 12,
    pctAdaptacao: 50,
    // Meta sugerida: mínimo de vouchers = média dos 6 meses + este % (decisão da gestão)
    pctVoucherAcimaDaMedia: 10,
  },

  // ─── Classify a row from the Excel ───
  classifyRow(row) {
    const item = String(row['Itens'] || '').toUpperCase().trim();
    const tipoVenda = String(row['Tipo de Venda'] || '').trim();
    const origem = String(row['Origem'] || '').toUpperCase().trim();

    const r = {
      excluded: false, excludeReason: '',
      category: 'outro', label: '',
      isContract: false,
      periodicidade: null, abrangencia: null,
      isActivation: false,
      isEligibleP3: true,
      isDegustacao: false,
    };

    // ── PRIORITY: Aula / Pacote — regular vendor gets 5% P1, but NOT a plan unit ──
    if (item.includes('AULA') || item.includes('AVULSA') || item.includes('DIÁRIA') || item.includes('DIARIA') || /^\d+\s*AULAS?/.test(item) || /PACOTE\s+\d+\s*AULAS?/.test(item)) {
      if (!item.includes('AULA EXPERIMENTAL') && !item.includes('EXPERIMENTAL')) {
        r.category = 'avulsa'; r.label = 'Aula/Pacote avulso';
        r.isActivation = false; r.isEligibleP3 = true;
        return r;
      }
    }

    // ── Hard exclusions ──
    if (item.includes('RESCISÃO') || item.includes('RESCISAO'))
      return { ...r, excluded: true, excludeReason: 'Rescisão contratual' };

    if (item.includes('WELLHUB') || item.includes('GYMPASS') || tipoVenda === 'Gympass')
      return { ...r, excluded: true, excludeReason: 'Gympass/Wellhub', excludeGroup: 'gympass' };

    if (item.includes('TOTALPASS') || item.includes('TOTAL PASS') || tipoVenda === 'TotalPass')
      return { ...r, excluded: true, excludeReason: 'TotalPass', excludeGroup: 'totalpass' };

    // ── Grupo Corrida — comissão é do professor, não da vendedora ──
    if (item.includes('GRUPO') && item.includes('CORRIDA'))
      return { ...r, excluded: true, excludeReason: 'Grupo Corrida (comissão do professor)' };

    // ── Permuta — não é venda, não gera comissão, mas rastrear ──
    if (item.includes('PERMUTA') || tipoVenda.toUpperCase().includes('PERMUTA'))
      return { ...r, excluded: true, excludeReason: 'Permuta', excludeGroup: 'permuta' };

    // ── Renovação automática (qualquer item com Origem = Renovação Automática) ──
    if (origem.includes('RENOVAÇÃO AUTOMÁTICA') || origem.includes('RENOVACAO AUTOMATICA') || origem.includes('RENOVACAO AUTOMATICA'))
      return { ...r, excluded: true, excludeReason: 'Renovação automática' };

    // ── Recorrente + Renovação (tipo de venda) ──
    if (item.includes('RECORRENTE') && tipoVenda.toLowerCase().includes('renova')) {
      if (!origem.includes('BALCÃO') && !origem.includes('BALCAO')) {
        return { ...r, excluded: true, excludeReason: 'Renovação de recorrente' };
      }
    }

    // ── Identify type ──
    const isNovo = tipoVenda.toLowerCase().includes('novo');
    const isRetorno = tipoVenda.toLowerCase().includes('retorno');
    const isRenovacao = tipoVenda.toLowerCase().includes('renova');

    // Voucher / Degustação
    if (item.includes('DEGUSTAÇÃO') || item.includes('DEGUSTACAO') || item.includes('MÊS DEGUSTAÇÃO')) {
      r.category = 'voucher'; r.label = 'Voucher'; r.isActivation = true; r.isDegustacao = true;
      r.isEligibleP3 = false;
      return r;
    }

    // Aulas avulsas / pacotes handled above in PRIORITY section

    // Aula experimental
    if (item.includes('AULA EXPERIMENTAL') || item.includes('EXPERIMENTAL')) {
      r.category = 'experimental'; r.label = 'Aula experimental';
      r.isActivation = false; r.isEligibleP3 = true;
      return r;
    }

    // Matrícula / Taxa
    if (item.includes('MATRÍCULA') || item.includes('MATRICULA') || item.includes('TAXA')) {
      r.category = 'matricula'; r.label = 'Taxa/Matrícula';
      r.isActivation = false; r.isEligibleP3 = true;
      return r;
    }

    // Diferença no valor
    if (item.includes('DIFERENÇA') || item.includes('DIFERENCA')) {
      if (item.includes('VALOR DO CONTRATO ALTERADO')) {
        r.category = 'upgrade'; r.label = 'Upgrade de Plano';
        r.isActivation = false; r.isEligibleP3 = false; // Apenas P1 (5%)
      } else {
        r.category = 'diferenca'; r.label = 'Diferença de contrato';
        r.isActivation = false; r.isEligibleP3 = true;
      }
      return r;
    }

    // Avaliação física
    if (item.includes('AVALIACAO') || item.includes('AVALIAÇÃO')) {
      r.category = 'avaliacao'; r.label = 'Avaliação física';
      r.isActivation = false; r.isEligibleP3 = true;
      return r;
    }

    // ── Contracts (Plans) ──
    // Fix 18/05/2026 (word boundary) extraído pra detectPeriodicidade() em 15/06/2026,
    // pra reuso no recálculo (applyCommissionsToItem). Evita "ANUAL" casar em "BIANUAL".
    r.periodicidade = this.detectPeriodicidade(item, this.currentConfig);

    if (item.includes('FLEX')) r.abrangencia = 'FLEX';
    else r.abrangencia = 'LOCAL';

    if (r.periodicidade) {
      r.isContract = true;
      r.isActivation = true;
      if (isRenovacao) { r.category = 'renovacao'; r.label = 'Renovação'; }
      else if (isRetorno) { r.category = 'retorno'; r.label = 'Retorno'; }
      else { r.category = 'novo'; r.label = 'Novo'; }
      return r;
    }

    // ── Fallback ──
    if (isRenovacao) { r.category = 'renovacao'; r.label = 'Renovação'; }
    else if (isRetorno) { r.category = 'retorno'; r.label = 'Retorno'; }
    else if (isNovo) { r.category = 'novo'; r.label = 'Novo'; }
    else { r.category = 'outro'; r.label = 'Outro'; }

    r.isActivation = false;
    r.isEligibleP3 = true;
    return r;
  },

  // ─── Quick category mapper (used for restore/toggle) ───
  mapCategory(itemStr, tipoVendaStr) {
    const item = (itemStr || '').toUpperCase().trim();
    const tipo = (tipoVendaStr || '').toLowerCase().trim();

    if (item.includes('GRUPO') && item.includes('CORRIDA')) return 'excluded';
    if (item.includes('PERMUTA') || tipo.includes('permuta')) return 'excluded';
    if (item.includes('DEGUSTAÇÃO') || item.includes('DEGUSTACAO') || item.includes('MÊS DEGUSTAÇÃO'))
      return 'voucher';
    if (item.includes('AULA') || item.includes('AVULSA') || item.includes('DIÁRIA') || item.includes('DIARIA') || /^\d+\s*AULAS?/.test(item) || /PACOTE\s+\d+\s*AULAS?/.test(item)) {
      if (!item.includes('AULA EXPERIMENTAL') && !item.includes('EXPERIMENTAL')) return 'avulsa';
    }
    if (item.includes('MATRÍCULA') || item.includes('MATRICULA') || item.includes('TAXA'))
      return 'matricula';
    if (item.includes('DIFERENÇA') || item.includes('DIFERENCA'))
      return 'diferenca';
    if (item.includes('AVALIACAO') || item.includes('AVALIAÇÃO'))
      return 'avaliacao';
    if (item.includes('AULA EXPERIMENTAL') || item.includes('EXPERIMENTAL'))
      return 'experimental';
    if (item.includes('GRUPO') && item.includes('CORRIDA'))
      return 'grupo_corrida';
    if (tipo.includes('renova')) return 'renovacao';
    if (tipo.includes('retorno')) return 'retorno';
    if (tipo.includes('novo')) return 'novo';
    return 'outro';
  },

  // ─── Detecta periodicidade do plano a partir do texto do item (word boundary) ───
  // Reusado por classifyRow (upload) e applyCommissionsToItem (recálculo). Word boundary
  // evita que "ANUAL" case dentro de "BIANUAL". Retorna o termo ou null.
  detectPeriodicidade(itemStr, config) {
    const item = String(itemStr || '').toUpperCase();
    const termos = (config && config.planosAtivacao) || this.defaultConfig.planosAtivacao;
    let found = null;
    termos.forEach(termo => {
      if (new RegExp(`\\b${termo}\\b`).test(item)) found = termo;
    });
    return found;
  },

  // ─── Extract plan start date from Itens field ───
  // Pattern: "ANUAL, TREINO HIIT (02/02/2026 - 02/02/2027)" → 02/02/2026
  parseStartDate(itemStr) {
    const match = String(itemStr || '').match(/\((\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})\)/);
    if (!match) return null;
    return {
      startDate: new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1])),
      startStr: `${match[1]}/${match[2]}/${match[3]}`,
      endDate: new Date(parseInt(match[6]), parseInt(match[5]) - 1, parseInt(match[4])),
      endStr: `${match[4]}/${match[5]}/${match[6]}`,
    };
  },

  // ─── Get value from row ───
  // Regra: somente "Valor Quitado/Recibo" é válido para comissão.
  // Se não foi quitado (0 ou ausente), não gera comissão no mês.
  getValor(row, config) {
    const campo = config.campoValor;
    if (campo && campo !== 'auto') {
      const v = parseFloat(row[campo]);
      if (!isNaN(v)) return v;
    }
    return parseFloat(row['Valor Quitado/Recibo']) || 0;
  },

  // ─── P2: Fixed bonus ───
  getP2Bonus(periodicidade, abrangencia, config) {
    if (periodicidade === 'BIANUAL') return config.bonusBianual;
    if (periodicidade === 'ANUAL' && abrangencia === 'FLEX') return config.bonusAnualFlex;
    if (periodicidade === 'ANUAL') return config.bonusAnualLocal;
    if (periodicidade === 'RECORRENTE') return config.bonusRecorrente;
    if (periodicidade === 'MENSAL') return config.bonusMensal;
    return 0;
  },

  // ─── Re-calculate commissions for a single item (used for edits and recalcs) ───
  applyCommissionsToItem(item, config) {
    const cfg = { ...this.defaultConfig, ...config };
    const pctNovo = cfg.pctNovo / 100;
    const pctRenov = cfg.pctRenov / 100;
    const naoComList = (cfg.naoComissionaveis || []).map(n => n.toUpperCase().trim());

    // 1. Re-evaluate activation status using dynamic terms
    const itemString = (item.item || '').toUpperCase();
    const terms = cfg.planosAtivacao || this.defaultConfig.planosAtivacao;
    item.isActivation = terms.some(t => itemString.includes(t)) || ['novo', 'retorno', 'renovacao', 'voucher'].includes(item.category);

    // B2 (15/06/2026): re-deriva periodicidade/abrangência do TEXTO do item, não confia no
    // campo gravado. Corrige registros legados gravados como ANUAL antes do fix de 18/05
    // (BIANUAL→ANUAL via substring). Sem manualP2, o recálculo agora paga o bônus certo.
    const derivedPeriod = this.detectPeriodicidade(item.item, cfg);
    if (derivedPeriod) {
      item.periodicidade = derivedPeriod;
      item.isContract = true;
      item.abrangencia = itemString.includes('FLEX') ? 'FLEX' : 'LOCAL';
    }

    // 2. Determine P1
    const hasManualP1 = item.manualP1 !== undefined && item.manualP1 !== null;
    const valor = parseFloat(item.valorCaixa) || 0;

    if (hasManualP1) {
      item.p1valor = parseFloat(item.manualP1) || 0;
      item.p1pct = valor > 0 ? item.p1valor / valor : 0;
    } else if (item.isDegustacao || item.category === 'voucher') {
      item.p1valor = cfg.voucherFixo;
      item.p1pct = 0;
    } else if (item.category === 'renovacao') {
      item.p1pct = pctRenov;
      item.p1valor = valor * pctRenov;
    } else {
      item.p1pct = pctNovo;
      item.p1valor = valor * pctNovo;
    }

    // 3. Determine P2
    const hasManualP2 = item.manualP2 !== undefined && item.manualP2 !== null;
    const isCancelado = item.canceladoSemEstorno === true;

    if (hasManualP2) {
      item.p2bonus = parseFloat(item.manualP2) || 0;
    } else if (isCancelado) {
      item.p2bonus = 0;
      // Exception: canceled contracts still count as activation (unit goal)
      // but they don't generate the contract bonus (P2)
      // and their value doesn't count for the vendor's P3 percentage
      item.isEligibleP3 = false;
    } else if (item.isContract) {
      // B1 (15/06/2026): escala o bônus pelo ratio do split (splitAtivacao). Sem isso, cada
      // perna recebia o bônus cheio → pagava em dobro. P1 já respeita o split via valorCaixa
      // (que é gravado escalado); o P2 é valor fixo, então precisa do fator aqui.
      item.p2bonus = this.getP2Bonus(item.periodicidade, item.abrangencia, cfg) * (item.splitAtivacao || 1);
    } else {
      item.p2bonus = 0; // Ensure it's reset if no longer a contract
    }

    // 4. Non-commissionable check
    const vendedor = (item.vendedor || '').toUpperCase();
    const isNaoCom = naoComList.some(n => vendedor.includes(n));
    item.isNaoCom = isNaoCom;

    if (isNaoCom) {
      if (!hasManualP1) item.p1valor = 0;
      if (!hasManualP2) item.p2bonus = 0;
    }

    item.totalP1P2 = (item.p1valor || 0) + (item.p2bonus || 0);
    return item;
  },

  // ─── Process all rows ───
  processRows(rawRows, config, splits = {}) {
    const cfg = { ...this.defaultConfig, ...config };
    this.currentConfig = cfg; // Store for classifyRow access

    const processed = [];
    const excluded = [];
    const deferred = [];

    rawRows.forEach((row, idx) => {
      const info = this.classifyRow(row);
      const valor = this.getValor(row, cfg);

      if (info.excluded) {
        excluded.push({
          _idx: idx, _reason: info.excludeReason, _group: info.excludeGroup || '',
          vendedor: String(row['Vendedor'] || '').trim().replace(/\s+/g, ' ') || 'Sem Vendedor',
          cliente: row['Cliente'] || '',
          item: String(row['Itens'] || ''),
          tipoVenda: String(row['Tipo de Venda'] || ''),
          data: row['Data'] instanceof Date ? row['Data'].toLocaleDateString('pt-BR') : String(row['Data'] || ''),
          origem: String(row['Origem'] || ''),
          valorCaixa: valor,
          ...info,
        });
        return;
      }

      if (valor <= 0 && !info.isDegustacao) {
        // Only show in excluded if there's a meaningful "Valor Final" > 0 (sold but not settled)
        const valorFinal = parseFloat(row['Valor Final']) || parseFloat(row['Valor Venda']) || 0;
        if (valorFinal > 0) {
          excluded.push({
            _idx: idx,
            _reason: `Pagamento pendente (Valor Quitado/Recibo = R$ 0, Valor Final = R$ ${valorFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`,
            _group: 'pagamento_pendente',
            vendedor: String(row['Vendedor'] || '').trim().replace(/\s+/g, ' ') || 'Sem Vendedor',
            cliente: row['Cliente'] || '',
            item: String(row['Itens'] || ''),
            tipoVenda: String(row['Tipo de Venda'] || ''),
            data: row['Data'] instanceof Date ? row['Data'].toLocaleDateString('pt-BR') : String(row['Data'] || ''),
            origem: String(row['Origem'] || ''),
            valorCaixa: 0,
            valorFinalPendente: valorFinal,
            ...info,
          });
        }
        return;
      }

      const vendedor = String(row['Vendedor'] || '').trim().replace(/\s+/g, ' ') || 'Sem Vendedor';
      const codigo = String(row['Código'] || row['Codigo'] || '').trim();

      // Date normalization
      const dt = row['Data'];
      let dateStr = dt instanceof Date ? dt.toLocaleDateString('pt-BR') : String(dt || '');
      let dateObj = dt instanceof Date ? dt : null;
      if (!dateObj && typeof dt === 'string') {
        const parts = dt.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (parts) dateObj = new Date(parts[3], parts[2] - 1, parts[1]);
      }

      const item = {
        _idx: idx,
        codigo, cliente: row['Cliente'] || '', data: dateStr, dateObj,
        item: String(row['Itens'] || ''), tipoVenda: String(row['Tipo de Venda'] || ''),
        vendedor, origem: String(row['Origem'] || ''),
        valorCaixa: valor,
        manualP1: row.manualP1,
        manualP2: row.manualP2,
        canceladoSemEstorno: row.canceladoSemEstorno,
        ...info
      };

      // APPLY COMMISSIONS
      this.applyCommissionsToItem(item, cfg);

      const dateVoucherEnd = info.isDegustacao ? this.parseStartDate(row['Itens'])?.endDate : null;
      item.dateVoucherEnd = dateVoucherEnd;

      // ── Diferimento: plano começa > 30 dias depois do pagamento ──
      // Encerrado em `FIM_DO_DIFERIMENTO` (ver a constante, no topo). O corte
      // olha o mês do PAGAMENTO, não o do início do plano: é o mês do pagamento
      // que diz sob qual regra aquela folha foi (ou vai ser) paga.
      const planDates = this.parseStartDate(row['Itens']);
      if (planDates) {
        item.planStartDate = planDates.startStr;
        item.planEndDate = planDates.endStr;
        const mesPgto = dateObj
          ? `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`
          : '';
        const aindaDifere = mesPgto && mesPgto < this.FIM_DO_DIFERIMENTO;
        if (dateObj && item.isActivation && aindaDifere) {
          const diffDays = Math.round((planDates.startDate - dateObj) / (1000 * 60 * 60 * 24));
          if (diffDays > 30) {
            const deferMonth = `${planDates.startDate.getFullYear()}-${String(planDates.startDate.getMonth() + 1).padStart(2, '0')}`;
            deferred.push({
              ...item,
              isDeferredItem: true,
              deferToMonth: deferMonth,
              deferReason: `Início em ${planDates.startStr} (${diffDays}d após pgto ${dateStr})`,
            });
            return; // Skip adding to processed
          }
        }
        // Regra de out/2026 (resposta do Rodrigo, 30/09): plano que começa mais de
        // 30 dias depois do pagamento — o DINHEIRO fica aqui (P1, P2, caixa do P3),
        // só a CONTAGEM da ativação vai para o mês do início. O mês do início busca
        // estes itens nos meses anteriores (configDoMes.ativacoesAdiadas).
        if (dateObj && item.isActivation && mesPgto && mesPgto >= this.INICIO_REGRA_MINIMOS) {
          const diffDays = Math.round((planDates.startDate - dateObj) / (1000 * 60 * 60 * 24));
          if (diffDays > 30) {
            const mesInicio = `${planDates.startDate.getFullYear()}-${String(planDates.startDate.getMonth() + 1).padStart(2, '0')}`;
            item.ativacaoAdiadaPara = mesInicio;
            item.ativacaoAdiadaMotivo = `Começa em ${planDates.startStr} (${diffDays} dias depois do pagamento): a comissão é deste mês, a ativação conta em ${mesInicio.slice(5)}/${mesInicio.slice(0, 4)}`;
          }
        }
      }

      processed.push(item);
    });

    return { processed, excluded, deferred };
  },

  // ─── Deduplication ───
  deduplicate(rows) {
    const seen = new Set();
    const unique = [];
    const dupes = [];

    rows.forEach(row => {
      const key = `${row['Código'] || ''}|${row['Itens'] || ''}|${row['Data'] || ''}|${row['Valor Quitado/Recibo'] || row['Valor Final'] || ''}`;
      if (seen.has(key)) {
        dupes.push(row);
      } else {
        seen.add(key);
        unique.push(row);
      }
    });
    return { unique, dupes };
  },

  // ─── Clean raw data (remove footer junk) ───
  cleanRawData(json) {
    let hi = 0;
    for (let i = 0; i < Math.min(json.length, 10); i++) {
      if (json[i].map(c => String(c).toLowerCase()).some(c => c.includes('cliente') || c.includes('itens') || c.includes('código'))) {
        hi = i; break;
      }
    }
    const headers = json[hi].map(h => String(h).trim());
    // Standardize headers to avoid case-sensitivity issues
    const stdHeaders = headers.map(h => {
      const lower = h.toLowerCase();
      if (lower.includes('código') || lower.includes('codigo')) return 'Código';
      if (lower === 'cliente') return 'Cliente';
      if (lower === 'data') return 'Data';
      if (lower === 'itens') return 'Itens';
      if (lower === 'valor venda') return 'Valor Venda';
      if (lower === 'valor final') return 'Valor Final';
      if (lower.includes('quitado') || lower.includes('recibo')) return 'Valor Quitado/Recibo';
      if (lower === 'origem') return 'Origem';
      if (lower === 'tipo de venda' || lower === 'tipo') return 'Tipo de Venda';
      if (lower === 'vendedor') return 'Vendedor';
      return h;
    });

    const rows = [];
    for (let i = hi + 1; i < json.length; i++) {
      const row = json[i];
      if (!row || row.length < 3) continue;
      const o = {};
      stdHeaders.forEach((sh, idx) => {
        if (!o[sh]) o[sh] = row[idx] !== undefined ? row[idx] : '';
      });
      // Skip junk rows
      const cod = String(o['Código'] || o['Codigo'] || '').trim().toUpperCase();
      if (cod === 'TOTAL') break; // Desconsiderar tudo abaixo da linha de total
      if (cod === 'METAS' || cod.startsWith('VOCÊ') || cod === '') continue;
      if (!String(o['Cliente'] || '').trim() && !String(o['Itens'] || '').trim()) continue;
      // Skip rows with no vendedor AND no client AND no item (completely empty data)
      if (!String(o['Vendedor'] || '').trim() && !String(o['Cliente'] || '').trim() && !String(o['Itens'] || '').trim()) continue;
      // Skip rows where ALL value fields are zero or empty
      const hasValue = ['Valor Quitado/Recibo', 'Valor Final', 'Valor Venda'].some(f => parseFloat(o[f]) > 0);
      const hasDegust = String(o['Itens'] || '').toUpperCase().includes('DEGUST');
      if (!hasValue && !hasDegust && !String(o['Cliente'] || '').trim()) continue;
      rows.push(o);
    }
    return rows;
  },

  // ─── Detect all months present in the data ───
  detectMonths(rows) {
    const monthCount = {};
    rows.forEach(row => {
      const dt = row['Data'];
      let d = dt instanceof Date ? dt : null;
      if (!d && typeof dt === 'string') {
        const parts = dt.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (parts) d = new Date(parts[3], parts[2] - 1, parts[1]);
      }
      if (d && !isNaN(d)) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthCount[key] = (monthCount[key] || 0) + 1;
      }
    });
    return monthCount;
  },

  // ─── Apply splits to get effective values ───
  getEffective(d, splits) {
    const split = splits[d._idx];
    if (!split) return { p1valor: d.p1valor, p2bonus: d.p2bonus, totalP1P2: d.totalP1P2, splitWith: null, splitRatio: 1 };
    const ratio = split.ratio || 0.5;
    return {
      p1valor: d.p1valor * ratio,
      p2bonus: d.p2bonus * ratio,
      totalP1P2: d.totalP1P2 * ratio,
      splitWith: split.vendedor,
      splitRatio: ratio,
    };
  },

  // ─── Build per-vendor aggregated data ───
  buildVendorData(processedData, splits, config) {
    const cfg = { ...this.defaultConfig, ...config };
    const naoComList = cfg.naoComissionaveis.map(n => n.toUpperCase().trim());
    const vd = {};

    const init = (name) => {
      if (!vd[name]) vd[name] = {
        p1total: 0, p2total: 0, p3: 0, p4individual: 0, p4pool: 0,
        novos: 0, renovacoes: 0, retornos: 0, vouchers: 0, avulsas: 0, outros: 0,
        caixaTotal: 0, caixaP3Eligible: 0,
        ativacoes: 0, conversoes: 0,
        isNaoCom: naoComList.some(n => name.toUpperCase().includes(n)),
        rows: [],
      };
    };

    processedData.forEach(d => {
      const eff = this.getEffective(d, splits);
      // Pre-split items (from saveSplitRecord) already have scaled values and
      // splitAtivacao set. When splits map is empty (recalculatePeriod path),
      // use the stored splitAtivacao instead of the legacy 0.5 hardcoded factor.
      const isPreSplit = !eff.splitWith && (d.splitAtivacao || 1) < 1;
      const ativFactor = eff.splitWith ? 0.5 : (isPreSplit ? d.splitAtivacao : 1);
      const valueFactor = eff.splitWith ? eff.splitRatio : 1;

      // Original vendor
      init(d.vendedor);
      const v = vd[d.vendedor];
      v.p1total += eff.p1valor;
      v.p2total += eff.p2bonus;
      v.caixaTotal += d.valorCaixa * valueFactor;
      if (d.isEligibleP3 && !d.isNaoCom) v.caixaP3Eligible += d.valorCaixa * valueFactor;
      // Ativação adiada (out/2026+): o dinheiro fica, a contagem vai para o mês do início
      const contaAqui = !d.ativacaoAdiadaPara;
      if (d.isActivation && contaAqui) v.ativacoes += ativFactor;
      // Category counts
      if (!contaAqui) { /* conta no mês do início */ }
      else if (d.category === 'novo') v.novos += ativFactor;
      else if (d.category === 'renovacao') v.renovacoes += ativFactor;
      else if (d.category === 'retorno') v.retornos += ativFactor;
      else if (d.category === 'voucher') v.vouchers += ativFactor;
      else if (d.category === 'avulsa') v.avulsas += ativFactor;
      else v.outros += ativFactor;
      v.rows.push(d);

      // Split partner (only for upload-time splits where splits map is active;
      // pre-split items already have the partner as a separate Firestore document,
      // so we skip the virtual partner injection to avoid double-counting.)
      if (eff.splitWith && !isPreSplit) {
        const partnerRatio = 1 - eff.splitRatio;
        init(eff.splitWith);
        const sv = vd[eff.splitWith];
        sv.p1total += d.p1valor * partnerRatio;
        sv.p2total += d.p2bonus * partnerRatio;
        sv.caixaTotal += d.valorCaixa * partnerRatio;
        if (d.isEligibleP3 && !d.isNaoCom) sv.caixaP3Eligible += d.valorCaixa * partnerRatio;
        if (d.isActivation && contaAqui) sv.ativacoes += 0.5;
        if (!contaAqui) { /* conta no mês do início */ }
        else if (d.category === 'novo') sv.novos += 0.5;
        else if (d.category === 'renovacao') sv.renovacoes += 0.5;
        else if (d.category === 'retorno') sv.retornos += 0.5;
        else if (d.category === 'voucher') sv.vouchers += 0.5;
        else if (d.category === 'avulsa') sv.avulsas += 0.5;
        else sv.outros += 0.5;
      }
    });

    // Ativações que chegam de meses anteriores (contrato que começou agora):
    // contam para quem vendeu, sem dinheiro nem comissão — já foram pagos no mês do pagamento.
    (cfg.ativacoesAdiadas || []).forEach(d => {
      if (!d || !d.isActivation) return;
      const nome = d.vendedor || 'Sem Vendedor';
      init(nome);
      const f = d.splitAtivacao || 1;
      const v = vd[nome];
      v.ativacoes += f;
      if (d.category === 'novo') v.novos += f;
      else if (d.category === 'renovacao') v.renovacoes += f;
      else if (d.category === 'retorno') v.retornos += f;
      else if (d.category === 'voucher') v.vouchers += f;
      v.ativacoesDeOutroMes = (v.ativacoesDeOutroMes || 0) + f;
    });

    return vd;
  },

  // Regra da divisão (tela Regras, desde a v1): cada vendedora conta a PROPORÇÃO
  // da ativação (0,7 / 0,3; 0,5 / 0,5) e a venda conta UMA vez na unidade.
  // Por vendedora a contagem é fracionada, até centésimos: arredondar a 2 casas
  // absorve o resto de ponto flutuante (0,30000000000000004).
  arredondaContagem(x) {
    return Math.round((Number(x) || 0) * 100) / 100;
  },

  // Na UNIDADE a contagem é sempre inteira: as pernas de uma venda dividida
  // somam 1. Sem isto, 40,99999999999999 não alcançava a faixa de 41.
  contagemDaUnidade(x) {
    return Math.round(Number(x) || 0);
  },

  // ─── P3: Meta bonus per vendor ───
  calcP3(unitAtivacoes, unitNovosRetorno, unitRenovacoes, unitVouchers, vendorP3Base, config) {
    const cfg = { ...this.defaultConfig, ...config };
    // Divisões somam frações (0,7 + 0,3…) e o ponto flutuante devolve 40,999…
    // em vez de 41 — agosto/2026 no PP caiu da Super Meta para a Meta assim.
    unitAtivacoes = this.contagemDaUnidade(unitAtivacoes);
    unitNovosRetorno = this.contagemDaUnidade(unitNovosRetorno);
    unitRenovacoes = this.contagemDaUnidade(unitRenovacoes);
    unitVouchers = this.contagemDaUnidade(unitVouchers);
    const metaPct = cfg.metaPct / 100;

    const result = {
      tier: null, tierLabel: '', fixo: 0, pctValor: 0, bruto: 0, teto: 0,
      multiplier: 1, motivos: [], final: 0,
      goldRules: { ativOk: false, novosOk: false },
      softLocks: { renovOk: true, voucherOk: true },
    };

    // Determine tier
    if (unitAtivacoes >= cfg.metaGold) { result.tier = 'gold'; result.tierLabel = 'Meta Gold'; }
    else if (unitAtivacoes >= cfg.superMeta) { result.tier = 'super'; result.tierLabel = 'Super Meta'; }
    else if (unitAtivacoes >= cfg.meta) { result.tier = 'meta'; result.tierLabel = 'Meta'; }

    result.goldRules.ativOk = result.tier !== null;
    result.goldRules.novosOk = unitNovosRetorno >= cfg.minNovos;
    result.regra = this.regraNovaDosMinimos(cfg) ? 'minimos' : 'antiga';

    // Golden rules
    if (!result.goldRules.ativOk) { result.motivos.push('Não atingiu faixa de ativações'); return result; }

    // ── Regra nova (outubro/2026 em diante): 3 mínimos → 100% · 1 falha → 50% · 2+ → zera ──
    if (result.regra === 'minimos') {
      if (result.tier === 'gold') { result.fixo = cfg.goldFixo; result.teto = cfg.tetoGold; }
      else if (result.tier === 'super') { result.fixo = cfg.superFixo; result.teto = cfg.tetoSuper; }
      else { result.fixo = cfg.metaFixo; result.teto = cfg.tetoMeta; }
      result.pctValor = vendorP3Base * metaPct;
      result.bruto = Math.min(result.fixo + result.pctValor, result.teto);
      result.softLocks.renovOk = unitRenovacoes >= cfg.minRenov;
      result.softLocks.voucherOk = unitVouchers >= cfg.minVoucher;
      const falhas = [];
      if (!result.goldRules.novosOk) falhas.push(`Novos + retorno ${unitNovosRetorno}/${cfg.minNovos}`);
      if (!result.softLocks.renovOk) falhas.push(`Renovações ${unitRenovacoes}/${cfg.minRenov}`);
      if (!result.softLocks.voucherOk) falhas.push(`Vouchers ${unitVouchers}/${cfg.minVoucher}`);
      result.multiplier = falhas.length === 0 ? 1 : (falhas.length === 1 ? 0.5 : 0);
      const efeito = falhas.length === 1 ? ' → metade do bônus (1 mínimo não batido)' : ` → bônus zera (${falhas.length} mínimos não batidos)`;
      falhas.forEach(f => result.motivos.push(f + efeito));
      result.final = Math.round(result.bruto * result.multiplier * 100) / 100;
      return result;
    }
    if (!result.goldRules.novosOk) { result.motivos.push(`Mín. novos/retorno: ${unitNovosRetorno}/${cfg.minNovos}`); return result; }

    // Tier values
    if (result.tier === 'gold') { result.fixo = cfg.goldFixo; result.teto = cfg.tetoGold; }
    else if (result.tier === 'super') { result.fixo = cfg.superFixo; result.teto = cfg.tetoSuper; }
    else { result.fixo = cfg.metaFixo; result.teto = cfg.tetoMeta; }

    result.pctValor = vendorP3Base * metaPct;
    result.bruto = Math.min(result.fixo + result.pctValor, result.teto);

    // Soft locks
    result.softLocks.renovOk = unitRenovacoes >= cfg.minRenov;
    result.softLocks.voucherOk = unitVouchers >= cfg.minVoucher;

    result.multiplier = 1;
    if (!result.softLocks.renovOk) {
      result.multiplier *= cfg.multFalhaRenov;
      result.motivos.push(`Renovações ${unitRenovacoes}/${cfg.minRenov} → ×${cfg.multFalhaRenov}`);
    }
    if (!result.softLocks.voucherOk) {
      result.multiplier *= cfg.multFalhaVoucher;
      result.motivos.push(`Vouchers ${unitVouchers}/${cfg.minVoucher} → ×${cfg.multFalhaVoucher}`);
    }

    result.final = Math.round(result.bruto * result.multiplier * 100) / 100;
    return result;
  },

  // ─── Apply P3 Pool (rateio proporcional) to all vendors ───
  // Calcula o Bolo da Unidade uma vez e distribui proporcionalmente ao caixa
  // apenas para vendedoras que atingiram o mínimo individual de ativações.
  applyP3Pool(vendorData, unitAtivacoes, unitNovosRetorno, unitRenovacoes, unitVouchers, cfg) {
    // Mínimo de cada vendedora: o da jornada dela de outubro/2026 em diante, senão o do mês
    const minDe = nome => this.minimoIndividual(nome, cfg);

    // Base caixa P3 = soma de todos os vendors não-comissionáveis excluídos
    const unitCaixaP3 = Object.values(vendorData).reduce(
      (s, v) => s + (v.isNaoCom ? 0 : (v.caixaP3Eligible || 0)), 0
    );

    // Calcula o Pool da Unidade uma única vez
    const p3Pool = this.calcP3(unitAtivacoes, unitNovosRetorno, unitRenovacoes, unitVouchers, unitCaixaP3, cfg);

    // Soma o caixaP3Eligible APENAS das vendedoras elegíveis (ativações >= mínimo)
    const atingiu = (nome, v) => this.arredondaContagem(v.ativacoes) >= minDe(nome);
    const totalCaixaElegiveis = Object.entries(vendorData)
      .filter(([nome, v]) => !v.isNaoCom && atingiu(nome, v))
      .reduce((s, [, v]) => s + (v.caixaP3Eligible || 0), 0);

    Object.entries(vendorData).forEach(([name, v]) => {
      if (v.isNaoCom) {
        v.p3 = 0;
        v.p3detail = { tier: null, final: 0, tierLabel: 'N/C', motivos: [] };
        return;
      }
      if (!atingiu(name, v)) {
        v.p3 = 0;
        v.p3detail = {
          ...p3Pool,
          final: 0,
          motivos: [...(p3Pool.motivos || []), `Não atingiu o mínimo individual de ${minDe(name)} ativações.`],
        };
        return;
      }
      // Vendedora elegível — fatia proporcional ao caixa
      let share = 0;
      if (totalCaixaElegiveis > 0 && p3Pool.final > 0) {
        share = Math.round((v.caixaP3Eligible / totalCaixaElegiveis) * p3Pool.final * 100) / 100;
      }
      v.p3 = share;
      v.p3detail = { ...p3Pool, final: share };
    });
  },

  // ─── Simulador "E se..." da vendedora ───
  // Até 28/09/2026 a tela calculava o bolo INTEIRO do P3 com o caixa só dela e
  // as metas padrão da unidade: a Kali via "+3 recorrentes = − R$ 346,64"
  // quando o certo era + R$ 145,02. Agora a conta segue a do applyP3Pool.

  // Somas da unidade que o simulador precisa — sem nome nem valor de colega.
  // `resumo` é o vendorSummary gravado (p3base = caixa elegível ao P3).
  agregadosP3(resumo, minhaVendedora, config) {
    const cfg = { ...this.defaultConfig, ...config };
    let baseUnidade = 0, baseOutrasElegiveis = 0;
    Object.entries(resumo || {}).forEach(([nome, v]) => {
      if (!v || v.isNaoCom) return;
      const base = v.p3base !== undefined ? v.p3base : (v.caixa || 0);
      baseUnidade += base;
      if (nome !== minhaVendedora && this.arredondaContagem(v.ativacoes) >= this.minimoIndividual(nome, cfg)) baseOutrasElegiveis += base;
    });
    return { baseUnidade, baseOutrasElegiveis };
  },

  // Quanto ELA ganha fechando mais `qt` vendas novas de um plano (P1 + P2 + a
  // parte dela no P3). A diferença do P3 é sempre medida contra a mesma conta
  // sem as vendas novas, para não misturar com o que está gravado.
  // `nome`: o da vendedora no resumo do mês (o mínimo dela pode ser o da jornada, out/2026+)
  simularVendas({ minhas, nome, totais, agregados, qt, valorCaixa, bonusP2, config }) {
    const cfg = { ...this.defaultConfig, ...config };
    const minAtiv = this.minimoIndividual(nome, cfg);
    const t = totais || {};
    const ag = agregados || { baseUnidade: 0, baseOutrasElegiveis: 0 };
    const minhaBase0 = minhas.p3base !== undefined ? minhas.p3base : (minhas.caixa || 0);

    const minhaParteP3 = (n) => {
      const extra = valorCaixa * n;
      const bolo = this.calcP3((t.unitAtivacoes || 0) + n, (t.unitNovosRetorno || 0) + n,
        t.unitRenovacoes || 0, t.unitVouchers || 0, ag.baseUnidade + extra, cfg).final;
      if (minhas.isNaoCom || this.arredondaContagem((minhas.ativacoes || 0) + n) < minAtiv) return 0;
      const minhaBase = minhaBase0 + extra;
      const elegiveis = ag.baseOutrasElegiveis + minhaBase;
      if (elegiveis <= 0 || bolo <= 0) return 0;
      return Math.round((minhaBase / elegiveis) * bolo * 100) / 100;
    };

    const dP1 = minhas.isNaoCom ? 0 : valorCaixa * qt * (cfg.pctNovo / 100);
    const dP2 = minhas.isNaoCom ? 0 : (bonusP2 || 0) * qt;
    const p3Antes = minhaParteP3(0);
    const p3Depois = minhaParteP3(qt);
    const dP3 = p3Depois - p3Antes;
    return { dP1, dP2, dP3, p3Antes, p3Depois, total: dP1 + dP2 + dP3 };
  },

  /** 'dd/mm/aaaa' (ou Date/Timestamp) → Date, ou null */
  _dataDoItem(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v.toDate === 'function') return v.toDate();
    const m = String(v).match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
  },

  /**
   * Decisão do Rafael (30/09/2026): conversão de degustação paga como VENDA NOVA
   * de out/2026 em diante. A Pacto registra o plano cheio de quem fez degustação
   * como "renovação" (a degustação é o 1º contrato): aqui ele vira "novo" — P1 de
   * venda nova e conta em novos + retorno. Mesmo casamento do P4: nome do cliente,
   * plano cheio, depois da degustação e até `prazoConversaoDias` do fim dela.
   * Guarda `categoriaPacto` e `conversaoDeDegustacao`. Até setembro, nada muda.
   * @returns {number} quantos itens mudaram
   */
  marcarConversoesComoNovas(processed, previousProcessed, config) {
    const cfg = { ...this.defaultConfig, ...config };
    if (!this.regraNovaDosMinimos(cfg)) return 0;
    const degustacoes = [...(previousProcessed || []), ...(processed || [])]
      .filter(v => v && v.isDegustacao)
      .map(v => {
        const ini = this._dataDoItem(v.dateObj || v.data);
        const datas = this.parseStartDate(v.item);
        const fim = this._dataDoItem(v.dateVoucherEnd) || (datas && datas.endDate) || ini;
        return { nome: this._normNome(v.cliente), ini, fim };
      })
      .filter(v => v.nome && v.ini);
    let mudou = 0;
    (processed || []).forEach(d => {
      if (!d || d.category !== 'renovacao' || !d.isContract || d.conversaoDeDegustacao) return;
      if (!['BIANUAL', 'ANUAL', 'RECORRENTE'].includes(d.periodicidade)) return;
      const quando = this._dataDoItem(d.dateObj || d.data);
      const nome = this._normNome(d.cliente);
      if (!quando || !nome) return;
      const achou = degustacoes.some(v => v.nome === nome && quando - v.ini >= 0 &&
        (quando - v.fim) / (1000 * 60 * 60 * 24) <= cfg.prazoConversaoDias);
      if (!achou) return;
      d.categoriaPacto = 'renovacao';
      d.category = 'novo';
      d.conversaoDeDegustacao = true;
      d.label = 'Novo (conversão de degustação)';
      this.applyCommissionsToItem(d, cfg);
      mudou++;
    });
    return mudou;
  },

  // ─── P4: Voucher conversion bonus ───
  calcP4(currentProcessed, previousProcessed, config) {
    const cfg = { ...this.defaultConfig, ...config };
    const naoComList = cfg.naoComissionaveis.map(n => n.toUpperCase().trim());

    const rehydrate = d => {
      if (!d.dateObj && d.data && typeof d.data === 'string') {
        const parts = d.data.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (parts) d.dateObj = new Date(parts[3], parts[2] - 1, parts[1]);
      }
      if (!d.dateVoucherEnd && d.isDegustacao && d.item) {
        // Try to rehydrate end date from item string if missing in saved data
        const dates = this.parseStartDate(d.item);
        if (dates) d.dateVoucherEnd = dates.endDate;
      } else if (d.dateVoucherEnd && !(d.dateVoucherEnd instanceof Date)) {
        // Firestore timestamp to Date
        if (d.dateVoucherEnd.toDate) d.dateVoucherEnd = d.dateVoucherEnd.toDate();
        else d.dateVoucherEnd = new Date(d.dateVoucherEnd);
      }
      return d;
    };
    const curr = (currentProcessed || []).map(rehydrate);
    const prev = (previousProcessed || []).map(rehydrate);

    // Find vouchers from previous period (or current)
    const allItems = [...prev, ...curr];
    const vouchers = allItems.filter(d => d.isDegustacao && d.dateObj);

    // Regra de out/2026 (spec 2026-09-29 §5.6): na Pacto a degustação e o plano
    // cheio são contratos com NÚMEROS diferentes, e a conversão costuma vir como
    // "renovação" — desde a migração nenhuma conversão casava (0 em jul/ago/set,
    // medido em 30/09/2026). De outubro em diante casa também pelo NOME do cliente
    // e aceita a renovação de quem fez degustação. Até setembro, como sempre foi.
    const nova = this.regraNovaDosMinimos(cfg);
    const chaveV = v => v._idx + '_' + v.codigo + '_' + this._normNome(v.cliente);

    // Find conversions in current period
    const contracts = curr.filter(d =>
      d.isContract &&
      ['BIANUAL', 'ANUAL', 'RECORRENTE'].includes(d.periodicidade) &&
      d.dateObj &&
      (d.category === 'novo' || d.category === 'retorno' || (nova && d.category === 'renovacao')) &&
      d.canceladoSemEstorno !== true
    );

    const conversions = [];
    const usedVouchers = new Set();

    contracts.forEach(contract => {
      if (!contract.codigo) return;

      // Find matching voucher for same client
      const matchingVoucher = vouchers.find(v => {
        const baseDate = v.dateVoucherEnd || v.dateObj; // Prefer end date, fallback to emission
        const mesmoCliente = v.codigo === contract.codigo ||
          (nova && this._normNome(v.cliente) && this._normNome(v.cliente) === this._normNome(contract.cliente));
        return mesmoCliente &&
          !usedVouchers.has(chaveV(v)) &&
          contract.dateObj && baseDate &&
          (contract.dateObj - baseDate) / (1000 * 60 * 60 * 24) <= cfg.prazoConversaoDias &&
          (contract.dateObj - v.dateObj) >= 0 // Contract must still be after emission
      });

      if (matchingVoucher) {
        usedVouchers.add(chaveV(matchingVoucher));
        const isNaoCom = naoComList.some(n => contract.vendedor.toUpperCase().includes(n));
        conversions.push({
          cliente: contract.cliente,
          codigo: contract.codigo,
          dataVoucher: matchingVoucher.data,
          dataConversao: contract.data,
          plano: contract.periodicidade + (contract.abrangencia ? ' ' + contract.abrangencia : ''),
          vendedora: contract.vendedor,
          bonus: isNaoCom ? 0 : cfg.bonusConversaoVoucher,
          isNaoCom,
        });
      }
    });

    // NEW: List vouchers emitted in CURRENT period and check their conversion status
    const currentVouchers = curr
      .filter(d => d.isDegustacao && d.dateObj)
      .map(v => {
        const isConverted = usedVouchers.has(chaveV(v));
        return {
          ...v,
          status: isConverted ? 'CONVERTIDO' : 'PENDENTE'
        };
      });

    // P4b: Pool calculation
    // Vouchers ativos nos últimos 45 dias (from end of current month)
    const vouchersAtivos45d = vouchers.length; // simplified: all vouchers in dataset
    const conversoesMes = conversions.filter(c => !c.isNaoCom).length;

    let metaVoucher = Math.max(Math.ceil(vouchersAtivos45d * cfg.poolVoucherMetaPct), cfg.poolVoucherMinMeta);
    // Out/2026 em diante (resposta do Rodrigo, 30/09): 30% · 40% · 50% → R$ 150 · 300 · 450
    let superMetaVoucher = Math.max(Math.ceil(vouchersAtivos45d * (nova ? cfg.poolVoucherSuperPctMinimos : cfg.poolVoucherSuperPct)), cfg.poolVoucherMinSuper);
    const goldMetaVoucher = nova ? Math.max(Math.ceil(vouchersAtivos45d * cfg.poolVoucherGoldPct), cfg.poolVoucherMinGold) : undefined;

    let pool = 0;
    let poolTier = null;
    if (nova && conversoesMes >= goldMetaVoucher) { pool = cfg.poolVoucherGold; poolTier = 'gold'; }
    else if (conversoesMes >= superMetaVoucher) { pool = cfg.poolVoucherSuper; poolTier = 'super'; }
    else if (conversoesMes >= metaVoucher) { pool = cfg.poolVoucherMeta; poolTier = 'meta'; }

    // Distribute pool proportionally
    const vendorConversions = {};
    conversions.filter(c => !c.isNaoCom).forEach(c => {
      vendorConversions[c.vendedora] = (vendorConversions[c.vendedora] || 0) + 1;
    });
    const totalConversoes = Object.values(vendorConversions).reduce((s, v) => s + v, 0);
    const vendorPool = {};
    if (totalConversoes > 0 && pool > 0) {
      Object.entries(vendorConversions).forEach(([name, count]) => {
        vendorPool[name] = Math.round(pool * (count / totalConversoes) * 100) / 100;
      });
    }

    return {
      conversions,
      currentVouchers,
      vouchersAtivos45d,
      conversoesMes,
      metaVoucher, superMetaVoucher,
      ...(nova ? { goldMetaVoucher } : {}),   // sem undefined: o resultado vai para o Firestore
      pool, poolTier,
      vendorConversions,
      vendorPool,
    };
  },

  // ─── Full calculation ───
  calculate(rawRows, config, splits = {}, previousProcessed = null) {
    const cfg = { ...this.defaultConfig, ...config };

    // Clean and deduplicate
    const { unique, dupes } = this.deduplicate(rawRows);

    // Process
    const { processed, excluded, deferred } = this.processRows(unique, cfg, splits);
    // Rede de segurança da regra dos mínimos (out/2026): sem o mês na configuração,
    // vale o mês das vendas — um mês antigo nunca ganha a regra nova por esquecimento.
    if (!cfg.mes) cfg.mes = this.mesDosItens(processed);

    // Conversão de degustação paga como venda nova (out/2026+, decisão do Rafael 30/09)
    this.marcarConversoesComoNovas(processed, previousProcessed, cfg);

    // Build vendor data
    const vendorData = this.buildVendorData(processed, splits, cfg);

    // Unit totals
    const { unitNovosRetorno, unitRenovacoes, unitVouchers, unitAtivacoes } = this.contagensDaUnidade(processed, cfg.ativacoesAdiadas);
    const unitCaixa = processed.reduce((s, d) => s + (d.valorCaixa || 0), 0);

    // P3 per vendor (pool-based rateio proporcional)
    this.applyP3Pool(vendorData, unitAtivacoes, unitNovosRetorno, unitRenovacoes, unitVouchers, cfg);

    // P4
    const p4result = this.calcP4(processed, previousProcessed, cfg);
    // Apply P4 to vendors
    p4result.conversions.forEach(c => {
      if (vendorData[c.vendedora] && !c.isNaoCom) {
        vendorData[c.vendedora].p4individual += c.bonus;
      }
    });
    Object.entries(p4result.vendorPool).forEach(([name, amount]) => {
      if (vendorData[name]) vendorData[name].p4pool += amount;
    });

    // Grand totals per vendor
    Object.values(vendorData).forEach(v => {
      v.grandTotal = v.p1total + v.p2total + v.p3 + v.p4individual + v.p4pool;
    });

    return {
      processed, excluded, deferred, dupes,
      vendorData,
      unitTotals: { unitAtivacoes, unitNovosRetorno, unitRenovacoes, unitVouchers, unitCaixa },
      p4result,
      config: cfg,
    };
  },
};

// Export for use in app
if (typeof module !== 'undefined') module.exports = CommissionEngine;
