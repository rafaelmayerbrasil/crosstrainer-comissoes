// ═══════════════════════════════════════════════════════════════
// CrossTrainer — Commission Engine v2.0
// All P1-P4 rules, meta, tripé, splits, non-commissionable
// ═══════════════════════════════════════════════════════════════

const CommissionEngine = {

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
    naoComissionaveis: ['RODRIGO', 'RAFAEL ROJAIS', 'BENNY ELAND', 'SISTEMA'],
    campoValor: 'auto',
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

    // ── Hard exclusions ──
    if (item.includes('RESCISÃO') || item.includes('RESCISAO'))
      return { ...r, excluded: true, excludeReason: 'Rescisão contratual' };

    if (item.includes('WELLHUB') || item.includes('GYMPASS') || tipoVenda === 'Gympass')
      return { ...r, excluded: true, excludeReason: 'Gympass/Wellhub' };

    if (item.includes('TOTALPASS') || item.includes('TOTAL PASS') || tipoVenda === 'TotalPass')
      return { ...r, excluded: true, excludeReason: 'TotalPass' };

    // ── Recorrente + Renovação automática ──
    if (item.includes('RECORRENTE') && (tipoVenda === 'Renovação' || origem.includes('RENOVAÇÃO AUTOMÁTICA') || origem.includes('RENOVACAO AUTOMATICA')))
      return { ...r, excluded: true, excludeReason: 'Renovação automática (recorrente)' };

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

    // Aulas avulsas / pacotes
    if (/^\d+\s*AULAS?\s*[\(\-]/.test(item) || /PACOTE\s+\d+\s*AULAS?/.test(item)) {
      r.category = 'avulsa'; r.label = 'Aula/Pacote avulso';
      r.isActivation = false; r.isEligibleP3 = true;
      if (isRenovacao) r.category = 'avulsa_renov';
      return r;
    }

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
      r.category = 'diferenca'; r.label = 'Diferença de contrato';
      r.isActivation = false; r.isEligibleP3 = true;
      return r;
    }

    // Avaliação física
    if (item.includes('AVALIACAO') || item.includes('AVALIAÇÃO')) {
      r.category = 'avaliacao'; r.label = 'Avaliação física';
      r.isActivation = false; r.isEligibleP3 = true;
      return r;
    }

    // Grupo Corrida
    if (item.includes('GRUPO') && item.includes('CORRIDA')) {
      r.category = 'grupo_corrida'; r.label = 'Grupo Corrida';
      r.isActivation = false; r.isEligibleP3 = true;
      return r;
    }

    // ── Contracts (Plans) ──
    if (item.includes('BIANUAL')) r.periodicidade = 'BIANUAL';
    else if (item.includes('ANUAL')) r.periodicidade = 'ANUAL';
    else if (item.includes('RECORRENTE')) r.periodicidade = 'RECORRENTE';
    else if (item.includes('MENSAL')) r.periodicidade = 'MENSAL';

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

  // ─── Get value from row ───
  getValor(row, config) {
    const campo = config.campoValor;
    if (campo && campo !== 'auto') {
      const v = parseFloat(row[campo]);
      if (!isNaN(v)) return v;
    }
    const tries = ['Valor Quitado/Recibo', 'Valor Final', 'Valor Venda'];
    for (const f of tries) {
      const v = parseFloat(row[f]);
      if (!isNaN(v) && v !== 0) return v;
    }
    return 0;
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

  // ─── Process all rows ───
  processRows(rawRows, config, splits = {}) {
    const cfg = { ...this.defaultConfig, ...config };
    const pctNovo = cfg.pctNovo / 100;
    const pctRenov = cfg.pctRenov / 100;
    const naoComList = cfg.naoComissionaveis.map(n => n.toUpperCase().trim());

    const processed = [];
    const excluded = [];

    rawRows.forEach((row, idx) => {
      const info = this.classifyRow(row);

      if (info.excluded) {
        excluded.push({ ...row, _idx: idx, _reason: info.excludeReason });
        return;
      }

      const valor = this.getValor(row, cfg);
      if (valor <= 0 && !info.isDegustacao) {
        excluded.push({ ...row, _idx: idx, _reason: 'Valor zero ou negativo' });
        return;
      }

      const vendedor = String(row['Vendedor'] || '').trim();
      const isNaoCom = naoComList.some(n => vendedor.toUpperCase().includes(n));
      const codigo = String(row['Código'] || row['Codigo'] || '').trim();

      // P1
      let p1pct = 0, p1valor = 0;
      if (info.isDegustacao) {
        p1valor = cfg.voucherFixo;
      } else if (info.category === 'renovacao' || info.category === 'avulsa_renov') {
        p1pct = pctRenov;
        p1valor = valor * pctRenov;
      } else {
        p1pct = pctNovo;
        p1valor = valor * pctNovo;
      }

      // P2
      let p2bonus = info.isContract ? this.getP2Bonus(info.periodicidade, info.abrangencia, cfg) : 0;

      // Non-commissionable: zero P1 and P2
      if (isNaoCom) { p1valor = 0; p2bonus = 0; }

      // Date
      const dt = row['Data'];
      let dateStr = dt instanceof Date ? dt.toLocaleDateString('pt-BR') : String(dt || '');
      let dateObj = dt instanceof Date ? dt : null;
      if (!dateObj && typeof dt === 'string') {
        const parts = dt.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (parts) dateObj = new Date(parts[3], parts[2] - 1, parts[1]);
      }

      processed.push({
        _idx: idx,
        codigo, cliente: row['Cliente'] || '', data: dateStr, dateObj,
        item: String(row['Itens'] || ''), tipoVenda: String(row['Tipo de Venda'] || ''),
        vendedor, origem: String(row['Origem'] || ''),
        ...info, valorCaixa: valor,
        p1pct, p1valor, p2bonus,
        totalP1P2: p1valor + p2bonus,
        isNaoCom,
      });
    });

    return { processed, excluded };
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
    const rows = [];
    for (let i = hi + 1; i < json.length; i++) {
      const row = json[i];
      if (!row || row.length < 3) continue;
      const o = {};
      headers.forEach((h, idx) => { o[h] = row[idx] !== undefined ? row[idx] : ''; });
      // Skip junk rows
      const cod = String(o['Código'] || o['Codigo'] || '');
      if (cod === 'Total' || cod === 'METAS' || cod.startsWith('Você') || cod === '') continue;
      if (!o['Cliente'] && !o['Itens']) continue;
      rows.push(o);
    }
    return rows;
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
      const ativFactor = eff.splitWith ? 0.5 : 1;
      const valueFactor = eff.splitWith ? eff.splitRatio : 1;

      // Original vendor
      init(d.vendedor);
      const v = vd[d.vendedor];
      v.p1total += eff.p1valor;
      v.p2total += eff.p2bonus;
      v.caixaTotal += d.valorCaixa * valueFactor;
      if (d.isEligibleP3 && !d.isNaoCom) v.caixaP3Eligible += d.valorCaixa * valueFactor;
      if (d.isActivation) v.ativacoes += ativFactor;
      // Category counts
      if (d.category === 'novo') v.novos += ativFactor;
      else if (d.category === 'renovacao') v.renovacoes += ativFactor;
      else if (d.category === 'retorno') v.retornos += ativFactor;
      else if (d.category === 'voucher') v.vouchers += ativFactor;
      else if (d.category === 'avulsa' || d.category === 'avulsa_renov') v.avulsas += ativFactor;
      else v.outros += ativFactor;
      v.rows.push(d);

      // Split partner
      if (eff.splitWith) {
        const partnerRatio = 1 - eff.splitRatio;
        init(eff.splitWith);
        const sv = vd[eff.splitWith];
        sv.p1total += d.p1valor * partnerRatio;
        sv.p2total += d.p2bonus * partnerRatio;
        sv.caixaTotal += d.valorCaixa * partnerRatio;
        if (d.isEligibleP3 && !d.isNaoCom) sv.caixaP3Eligible += d.valorCaixa * partnerRatio;
        if (d.isActivation) sv.ativacoes += 0.5;
        if (d.category === 'novo') sv.novos += 0.5;
        else if (d.category === 'renovacao') sv.renovacoes += 0.5;
        else if (d.category === 'retorno') sv.retornos += 0.5;
        else if (d.category === 'voucher') sv.vouchers += 0.5;
        else if (d.category === 'avulsa' || d.category === 'avulsa_renov') sv.avulsas += 0.5;
        else sv.outros += 0.5;
      }
    });

    return vd;
  },

  // ─── P3: Meta bonus per vendor ───
  calcP3(unitAtivacoes, unitNovosRetorno, unitRenovacoes, unitVouchers, vendorP3Base, config) {
    const cfg = { ...this.defaultConfig, ...config };
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

    // Golden rules
    if (!result.goldRules.ativOk) { result.motivos.push('Não atingiu faixa de ativações'); return result; }
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

  // ─── P4: Voucher conversion bonus ───
  calcP4(currentProcessed, previousProcessed, config) {
    const cfg = { ...this.defaultConfig, ...config };
    const naoComList = cfg.naoComissionaveis.map(n => n.toUpperCase().trim());

    // Find vouchers from previous period (or current)
    const allItems = [...(previousProcessed || []), ...currentProcessed];
    const vouchers = allItems.filter(d => d.isDegustacao && d.dateObj);

    // Find conversions in current period
    const contracts = currentProcessed.filter(d =>
      d.isContract &&
      ['BIANUAL', 'ANUAL', 'RECORRENTE'].includes(d.periodicidade) &&
      d.dateObj &&
      (d.category === 'novo' || d.category === 'retorno')
    );

    const conversions = [];
    const usedVouchers = new Set();

    contracts.forEach(contract => {
      if (!contract.codigo) return;

      // Find matching voucher for same client
      const matchingVoucher = vouchers.find(v =>
        v.codigo === contract.codigo &&
        !usedVouchers.has(v._idx + '_' + v.codigo) &&
        contract.dateObj && v.dateObj &&
        (contract.dateObj - v.dateObj) / (1000 * 60 * 60 * 24) <= cfg.prazoConversaoDias &&
        (contract.dateObj - v.dateObj) >= 0
      );

      if (matchingVoucher) {
        usedVouchers.add(matchingVoucher._idx + '_' + matchingVoucher.codigo);
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

    // P4b: Pool calculation
    // Vouchers ativos nos últimos 45 dias (from end of current month)
    const vouchersAtivos45d = vouchers.length; // simplified: all vouchers in dataset
    const conversoesMes = conversions.filter(c => !c.isNaoCom).length;

    let metaVoucher = Math.max(Math.ceil(vouchersAtivos45d * cfg.poolVoucherMetaPct), cfg.poolVoucherMinMeta);
    let superMetaVoucher = Math.max(Math.ceil(vouchersAtivos45d * cfg.poolVoucherSuperPct), cfg.poolVoucherMinSuper);

    let pool = 0;
    let poolTier = null;
    if (conversoesMes >= superMetaVoucher) { pool = cfg.poolVoucherSuper; poolTier = 'super'; }
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
      vouchersAtivos45d,
      conversoesMes,
      metaVoucher, superMetaVoucher,
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
    const { processed, excluded } = this.processRows(unique, cfg, splits);

    // Build vendor data
    const vendorData = this.buildVendorData(processed, splits, cfg);

    // Unit totals
    const unitNovosRetorno = processed.filter(d => d.category === 'novo' || d.category === 'retorno').length;
    const unitRenovacoes = processed.filter(d => d.category === 'renovacao').length;
    const unitVouchers = processed.filter(d => d.category === 'voucher').length;
    const unitAtivacoes = processed.filter(d => d.isActivation).length;
    const unitCaixa = processed.reduce((s, d) => s + d.valorCaixa, 0);

    // P3 per vendor
    Object.entries(vendorData).forEach(([name, v]) => {
      if (v.isNaoCom) { v.p3 = 0; v.p3detail = { tier: null, final: 0, tierLabel: 'N/C' }; return; }
      const p3 = this.calcP3(unitAtivacoes, unitNovosRetorno, unitRenovacoes, unitVouchers, v.caixaP3Eligible, cfg);
      v.p3 = p3.final;
      v.p3detail = p3;
    });

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
      processed, excluded, dupes,
      vendorData,
      unitTotals: { unitAtivacoes, unitNovosRetorno, unitRenovacoes, unitVouchers, unitCaixa },
      p4result,
      config: cfg,
    };
  },
};

// Export for use in app
if (typeof module !== 'undefined') module.exports = CommissionEngine;
