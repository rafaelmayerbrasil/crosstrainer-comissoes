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

    // Aulas avulsas / pacotes / Qualquer item com "AULA"
    if (item.includes('AULA') || item.includes('AVULSA') || item.includes('DIÁRIA') || item.includes('DIARIA') || /^\d+\s*AULAS?/.test(item) || /PACOTE\s+\d+\s*AULAS?/.test(item)) {
      r.category = 'avulsa'; r.label = 'Aula/Pacote avulso';
      r.isActivation = false; r.isEligibleP3 = true;
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

  // ─── Quick category mapper (used for restore/toggle) ───
  mapCategory(itemStr, tipoVendaStr) {
    const item = (itemStr || '').toUpperCase().trim();
    const tipo = (tipoVendaStr || '').toLowerCase().trim();

    if (item.includes('GRUPO') && item.includes('CORRIDA')) return 'excluded';
    if (item.includes('PERMUTA') || tipo.includes('permuta')) return 'excluded';
    if (item.includes('DEGUSTAÇÃO') || item.includes('DEGUSTACAO') || item.includes('MÊS DEGUSTAÇÃO'))
      return 'voucher';
    if (item.includes('AULA') || item.includes('AVULSA') || item.includes('DIÁRIA') || item.includes('DIARIA') || /^\d+\s*AULAS?/.test(item) || /PACOTE\s+\d+\s*AULAS?/.test(item))
      return 'avulsa';
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

  // ─── Process all rows ───
  processRows(rawRows, config, splits = {}) {
    const cfg = { ...this.defaultConfig, ...config };
    const pctNovo = cfg.pctNovo / 100;
    const pctRenov = cfg.pctRenov / 100;
    const naoComList = cfg.naoComissionaveis.map(n => n.toUpperCase().trim());

    const processed = [];
    const excluded = [];
    const deferred = [];

    rawRows.forEach((row, idx) => {
      const info = this.classifyRow(row);

      if (info.excluded) {
        const valor = this.getValor(row, cfg);
        excluded.push({
          _idx: idx, _reason: info.excludeReason, _group: info.excludeGroup || '',
          vendedor: String(row['Vendedor'] || '').trim() || 'Sem Vendedor',
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

      const valor = this.getValor(row, cfg);
      if (valor <= 0 && !info.isDegustacao) {
        // Completely drop 0-value items from analysis
        return;
      }

      const vendedor = String(row['Vendedor'] || '').trim() || 'Sem Vendedor';
      const isNaoCom = naoComList.some(n => vendedor.toUpperCase().includes(n));
      const codigo = String(row['Código'] || row['Codigo'] || '').trim();

      // --- New Flags & Manual Adjustments ---
      const hasManualP1 = row.manualP1 !== undefined && row.manualP1 !== null;
      const hasManualP2 = row.manualP2 !== undefined && row.manualP2 !== null;
      const isCancelado = row.canceladoSemEstorno === true;

      // P1
      let p1pct = 0, p1valor = 0;
      if (hasManualP1) {
        p1valor = parseFloat(row.manualP1) || 0;
      } else if (info.isDegustacao) {
        p1valor = cfg.voucherFixo;
      } else if (info.category === 'renovacao') {
        p1pct = pctRenov;
        p1valor = valor * pctRenov;
      } else {
        p1pct = pctNovo;
        p1valor = valor * pctNovo;
      }

      // P2
      let p2bonus = 0;
      if (hasManualP2) {
        p2bonus = parseFloat(row.manualP2) || 0;
      } else if (isCancelado) {
        p2bonus = 0;
      } else if (info.isContract) {
        p2bonus = this.getP2Bonus(info.periodicidade, info.abrangencia, cfg);
      }

      // ── Contagem de Ativação (P3) ──
      // A regra de Cancelado Sem Estorno agora MANTÉM a ativação, portanto não vamos zerar isActivation
      let isActivation = info.isActivation;

      // Non-commissionable: zero P1 and P2 (unless manual override is intentionally set? 
      // Rule: isNaoCom typically means 0. We'll stick to that unless manual is present)
      if (isNaoCom && !hasManualP1) p1valor = 0;
      if (isNaoCom && !hasManualP2) p2bonus = 0;

      // Date
      const dt = row['Data'];
      let dateStr = dt instanceof Date ? dt.toLocaleDateString('pt-BR') : String(dt || '');
      let dateObj = dt instanceof Date ? dt : null;
      if (!dateObj && typeof dt === 'string') {
        const parts = dt.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (parts) dateObj = new Date(parts[3], parts[2] - 1, parts[1]);
      }

      const dateVoucherEnd = info.isDegustacao ? this.parseStartDate(row['Itens'])?.endDate : null;

      processed.push({
        _idx: idx,
        codigo, cliente: row['Cliente'] || '', data: dateStr, dateObj,
        item: String(row['Itens'] || ''), tipoVenda: String(row['Tipo de Venda'] || ''),
        vendedor, origem: String(row['Origem'] || ''),
        ...info, valorCaixa: valor,
        dateVoucherEnd,
        p1pct, p1valor, p2bonus,
        totalP1P2: p1valor + p2bonus,
        isNaoCom,
        isActivation, // update with cancelado logic
        canceladoSemEstorno: isCancelado,
        manualP1: row.manualP1,
        manualP2: row.manualP2,
        planStartDate: null, planEndDate: null,
      });

      // ── Deferral check: plan start > 30 days from payment → defer ──
      const lastItem = processed[processed.length - 1];
      const planDates = this.parseStartDate(row['Itens']);
      if (planDates) {
        lastItem.planStartDate = planDates.startStr;
        lastItem.planEndDate = planDates.endStr;
        if (dateObj && info.isActivation) {
          const diffDays = Math.round((planDates.startDate - dateObj) / (1000 * 60 * 60 * 24));
          if (diffDays > 30) {
            // Remove from processed, add to deferred
            processed.pop();
            const deferMonth = `${planDates.startDate.getFullYear()}-${String(planDates.startDate.getMonth() + 1).padStart(2, '0')}`;
            deferred.push({
              ...lastItem,
              isDeferredItem: true,
              deferToMonth: deferMonth,
              deferReason: `Início em ${planDates.startStr} (${diffDays}d após pgto ${dateStr})`,
            });
          }
        }
      }
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
      else if (d.category === 'avulsa') v.avulsas += ativFactor;
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
        else if (d.category === 'avulsa') sv.avulsas += 0.5;
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

    // Find conversions in current period
    const contracts = curr.filter(d =>
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
      const matchingVoucher = vouchers.find(v => {
        const baseDate = v.dateVoucherEnd || v.dateObj; // Prefer end date, fallback to emission
        return v.codigo === contract.codigo &&
          !usedVouchers.has(v._idx + '_' + v.codigo) &&
          contract.dateObj && baseDate &&
          (contract.dateObj - baseDate) / (1000 * 60 * 60 * 24) <= cfg.prazoConversaoDias &&
          (contract.dateObj - v.dateObj) >= 0 // Contract must still be after emission
      });

      if (matchingVoucher) {
        const vKey = matchingVoucher._idx + '_' + matchingVoucher.codigo;
        usedVouchers.add(vKey);
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
        const vKey = v._idx + '_' + v.codigo;
        const isConverted = usedVouchers.has(vKey);
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
      currentVouchers,
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
    const { processed, excluded, deferred } = this.processRows(unique, cfg, splits);

    // Build vendor data
    const vendorData = this.buildVendorData(processed, splits, cfg);

    // Unit totals
    const unitNovosRetorno = processed.reduce((s, d) => s + ((d.category === 'novo' || d.category === 'retorno') ? (d.splitAtivacao || 1) : 0), 0);
    const unitRenovacoes = processed.reduce((s, d) => s + ((d.category === 'renovacao') ? (d.splitAtivacao || 1) : 0), 0);
    const unitVouchers = processed.reduce((s, d) => s + ((d.category === 'voucher') ? (d.splitAtivacao || 1) : 0), 0);
    const unitAtivacoes = processed.reduce((s, d) => s + (d.isActivation ? (d.splitAtivacao || 1) : 0), 0);
    const unitCaixa = processed.reduce((s, d) => s + (d.valorCaixa || 0), 0);

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
