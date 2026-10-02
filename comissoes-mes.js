// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — a gravação do mês das comissões, UMA conta só
// ═══════════════════════════════════════════════════════════════════════
//
// Desenho: docs/superpowers/specs/2026-09-30-api-pacto-oficial-design.md §7
//
// Até 30/09/2026 isto morava dentro do index.html (processarPlanilha,
// confirmUpload, recalculatePeriod e auxiliares). Saiu para cá para o servidor
// atualizar o mês SOZINHO toda madrugada pelo MESMO código da tela — a conta
// copiada em dois lugares foi o que fez o fechamento pagar R$ 7.580,84 a mais.
// A tela continua com os mesmos nomes de função, só cuidando de botão e prévia.
//
// Existe na raiz (a tela) e em functions/ (o servidor), idênticos; o teste
// scripts/smoke-comissoes-mes-paridade.js prova que o banco sai IGUAL ao do
// código antigo e falha se as duas cópias divergirem.
//
// Sem DOM. O banco entra injetado: o Firestore do navegador (compat) e o Admin
// SDK têm a mesma forma; só FieldValue/Timestamp mudam e também entram por fora.

const ComissoesMes = {

  // ─── Puras (movidas da tela como estavam) ───────────────────────────

  /** Os códigos de contrato que já pagaram comissão neste período (a regra do "uma vez só") */
  codigosDeContrato(itens) {
    const PAGO = new Set(['processed', 'deferred']);
    const s = new Set();
    (itens || []).forEach(d => {
      if (!PAGO.has(d.type || 'processed')) return;
      const m = String(d.codigo || '').trim().match(/^C\d+/i);
      if (m) s.add(m[0].toUpperCase());
    });
    return [...s].sort();
  },

  generateStableId(item) {
    const key = [
      (item.vendedor || '').toString().trim().toUpperCase(),
      (item.cliente || '').toString().trim().toUpperCase(),
      (item.data || '').toString().replace(/\//g, ''),
      (item.item || '').toString().trim().toUpperCase(),
      Number(item.valorCaixa || 0).toFixed(2)
    ].join('|');
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash) + key.charCodeAt(i);
      hash |= 0;
    }
    return 'id_' + Math.abs(hash).toString(36) + '_' + key.length;
  },

  // A identidade de cada item de UM upload, contando as repetições (25/09/2026):
  // sete Monsters iguais do mesmo dia davam o MESMO id e ficava um. A 1ª
  // ocorrência mantém o id de sempre; as seguintes ganham _2, _3…
  idsComRepeticao(itens) {
    const vistos = {};
    return itens.map(item => {
      const base = this.generateStableId(item);
      vistos[base] = (vistos[base] || 0) + 1;
      return vistos[base] === 1 ? base : base + '_' + vistos[base];
    });
  },

  // "Mesmo lançamento com o valor mudado" só vale quando o valor MUDOU de fato:
  // olha TODOS os valores já gravados daquele lançamento.
  ehValorAlterado(valoresExistentes, item) {
    const vals = valoresExistentes.get(this.generateSoftId(item));
    return !!vals && !vals.has(Number(item.valorCaixa || 0).toFixed(2));
  },

  generateSoftId(item) {
    const key = [
      (item.vendedor || '').toString().trim().toUpperCase(),
      (item.cliente || '').toString().trim().toUpperCase(),
      (item.data || '').toString().replace(/\//g, ''),
      (item.item || '').toString().trim().toUpperCase()
    ].join('|');
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash) + key.charCodeAt(i);
      hash |= 0;
    }
    return 'soft_' + Math.abs(hash).toString(36) + '_' + key.length;
  },

  /** 'cp_2026-10' → '2026-10' */
  mesDoPeriodoId(periodId) {
    return (String(periodId || '').match(/(\d{4}-\d{2})$/) || [])[1] || null;
  },

  _normalizar(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  },

  /** Tira `undefined` (o Firestore recusa), sem mexer em Date nem em marcador do Firebase */
  _semIndefinidos(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date || (obj.constructor && obj.constructor.name === 'FieldValueImpl')) return obj;
    if (Array.isArray(obj)) return obj.map(i => this._semIndefinidos(i));
    const clean = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      clean[k] = this._semIndefinidos(v);
    }
    return clean;
  },

  // ─── As operações que falam com o banco ─────────────────────────────

  /**
   * @param {Object} deps
   * @param {Object} deps.db          Firestore (compat do navegador ou Admin SDK)
   * @param {Object} deps.FieldValue  firebase.firestore.FieldValue | admin.firestore.FieldValue
   * @param {Object} deps.Timestamp   firebase.firestore.Timestamp | admin.firestore.Timestamp
   * @param {Object} deps.Engine      CommissionEngine
   * @param {Object} deps.Adapter     PactoAdapter
   * @param {Object} deps.Jornada     JornadaComercial
   * @param {Object} deps.autor       { uid, name } — quem grava (histórico e cadastro)
   * @param {Function} [deps.configAtual]  unitId → config em memória da unidade aberta na tela (ou undefined)
   * @param {Object} [deps.log]       { info, warn, error }
   */
  criar(deps) {
    const M = this;
    const { db, FieldValue, Timestamp, Engine, Adapter, Jornada } = deps;
    // `autor` pode ser função: a tela lê quem está logado na hora de gravar
    const quem = () => (typeof deps.autor === 'function' ? deps.autor() : deps.autor) || { uid: '', name: 'Sistema' };
    const log = deps.log || { info() {}, warn() {}, error() {} };
    const PERIODOS = 'periodos';

    const ops = {
      /** A config da unidade: a aberta na tela vem da memória (pode ter acabado de ser editada); a outra, do banco */
      async configDaUnidade(unitId) {
        const naTela = deps.configAtual ? deps.configAtual(unitId) : undefined;
        if (naTela !== undefined) return naTela;
        const doc = await db.collection('units').doc(unitId).get();
        return (doc.exists && doc.data().config) || Engine.defaultConfig;
      },

      /** Grava no doc do período a lista derivada dos itens reais */
      async gravarCodigosPagos(periodId, itens) {
        try {
          const codigosPagos = M.codigosDeContrato(itens);
          await db.collection(PERIODOS).doc(periodId).set({ codigosPagos }, { merge: true });
          log.info(`[codigosPagos] ${periodId}: ${codigosPagos.length} contratos comissionados.`);
        } catch (e) {
          // Não derruba o upload: `reconstruirCodigosPagos` refaz a partir dos itens
          log.error('[codigosPagos] falhou em ' + periodId + ':', e.message);
        }
      },

      /** Contratos que já pagaram comissão nesta unidade ANTES do mês (o recorte deixa re-subir o mesmo mês) */
      async carregarCodigosPagosAnteriores(unitId, mesArquivo) {
        if (!mesArquivo) return [];
        const snap = await db.collection(PERIODOS).where('unitId', '==', unitId).get();
        const todos = new Set();
        snap.forEach(doc => {
          const m = String(doc.id).match(/(\d{4}-\d{2})$/);
          if (!m || m[1] >= mesArquivo) return;
          (doc.data().codigosPagos || []).forEach(c => todos.add(c));
        });
        return [...todos];
      },

      /** Mínimo individual de cada vendedora no mês, pela jornada do cadastro (out/2026+) */
      async minimosDoPeriodo(mes, unitCfg, pData) {
        if (!mes || mes < Engine.INICIO_REGRA_MINIMOS) return null;
        try {
          const snap = await db.collection('users').get();
          return Jornada.minimosDoMes(snap.docs.map(d => d.data()), mes, { ...Engine.defaultConfig, ...(unitCfg || {}) });
        } catch (e) {
          return (pData && pData.minimosPorPessoa) || null;
        }
      },

      /** Itens de meses anteriores cuja ativação foi adiada para `mes` (contrato que começa depois) */
      async ativacoesAdiadasPara(unitId, mes) {
        if (!mes || mes < Engine.INICIO_REGRA_MINIMOS) return [];
        const [a, m] = mes.split('-').map(Number);
        const desde = new Date(Date.UTC(a, m - 14, 1)).toISOString().slice(0, 7);
        const snap = await db.collection(PERIODOS).where('unitId', '==', unitId).get();
        const out = [];
        for (const d of snap.docs) {
          const pm = M.mesDoPeriodoId(d.id);
          if (!pm || pm >= mes || pm < desde) continue;
          const itens = await db.collection(PERIODOS).doc(d.id).collection('itens').where('ativacaoAdiadaPara', '==', mes).get();
          itens.forEach(x => { const it = x.data(); if (it.type === 'processed') out.push(it); });
        }
        return out;
      },

      /** Foto do que mudou (por vendedora e por lançamento) no histórico do período */
      async salvarHistorico(periodId, triggerContext, beforeVendorSummary, afterVendorSummary, { beforeItemValues, processedItems, precomputedItemDeltas, activeItems } = {}) {
        try {
          const vendorSnapshots = {};
          let hasVendorChange = false;
          const allVendors = new Set([...Object.keys(beforeVendorSummary || {}), ...Object.keys(afterVendorSummary || {})]);
          allVendors.forEach(name => {
            const antes = (beforeVendorSummary[name] || {}).grandTotal || 0;
            const depois = (afterVendorSummary[name] || {}).grandTotal || 0;
            const delta = Math.round((depois - antes) * 100) / 100;
            if (Math.abs(delta) >= 0.01) {
              vendorSnapshots[name] = { name, totalAntes: antes, totalDepois: depois, delta };
              hasVendorChange = true;
            }
          });

          let itemDeltas = [];
          if (precomputedItemDeltas) {
            itemDeltas = precomputedItemDeltas;
          } else if (beforeItemValues && processedItems) {
            processedItems.forEach(item => {
              const bef = beforeItemValues[item._docId];
              if (!bef) return;
              const beforeTotal = (bef.p1 || 0) + (bef.p2 || 0);
              const afterTotal = (item.p1valor || 0) + (item.p2bonus || 0);
              if (Math.abs(afterTotal - beforeTotal) >= 0.01) {
                itemDeltas.push({
                  vendorId: item.vendedor || '',
                  vendorName: item.vendedor || '',
                  change: 'modified',
                  cliente: item.cliente || '',
                  item: item.item || '',
                  data: item.data || '',
                  antes: { p1: bef.p1, p2: bef.p2, total: beforeTotal },
                  depois: { p1: item.p1valor || 0, p2: item.p2bonus || 0, total: afterTotal },
                  impacto: Math.round((afterTotal - beforeTotal) * 100) / 100
                });
              }
            });
          }

          if (!hasVendorChange && itemDeltas.length === 0) return;

          const snapshot = {
            timestamp: FieldValue.serverTimestamp(),
            triggerType: triggerContext.type,
            triggerLabel: triggerContext.label,
            triggeredBy: { uid: quem().uid || '', name: quem().name || 'Sistema' },
            vendorSnapshots,
            itemDeltas,
            ...(triggerContext.type === 'upload' && activeItems && activeItems.length > 0
              ? { activeSnapshot: activeItems }
              : {})
          };
          await db.collection(PERIODOS).doc(periodId).collection('historico').add(snapshot);
        } catch (e) {
          log.warn('[Histórico] Erro ao salvar snapshot:', e);
        }
      },

      /** Vendedora nova vira cadastro pendente; a que já existe ganha a unidade */
      async registrarVendedoras(unitId, newVendors, usersToUpdateUnit) {
        const batch = db.batch();
        let count = 0;
        (newVendors || []).forEach(name => {
          const ref = db.collection('users').doc();
          batch.set(ref, {
            name, email: '', role: 'vendedor', unitId,
            allowedUnits: [unitId], status: 'pendente', autoCreated: true,
            createdAt: FieldValue.serverTimestamp()
          });
          count++;
        });
        (usersToUpdateUnit || []).forEach(u => {
          batch.update(db.collection('users').doc(u.id), { allowedUnits: u.allowedUnits });
          count++;
        });
        if (count > 0) await batch.commit();
        return count;
      },

      /**
       * O cálculo de um arquivo (ou das linhas da API) para uma unidade, sem gravar.
       * @returns {Object} `{ tipo: 'ok', rawRows, result, pacto, newVendors, usersToUpdateUnit, vendorNames, detectedPeriod }`
       *   ou `{ tipo: 'vendas', vendasPorGrupo, degustacoesGratis, json }` (relatório de vendas: só conferência)
       *   ou `{ tipo: 'outraUnidade', outras }` · `{ tipo: 'vazio' }` · `{ tipo: 'variosMeses', meses: [[mes, qtd]] }`
       */
      async preparar(json, { unitId, opcoes } = {}) {
        opcoes = opcoes || {};
        let pacto = null;
        if (Adapter && Adapter.ehExportPacto(json)) {
          // Traduz duas vezes de propósito: a primeira só para descobrir de que MÊS
          // é o arquivo — sem isso um re-upload barraria as próprias linhas.
          const mesArquivo = Adapter.traduzir(json, {}).mes;
          const codigosPagos = await ops.carregarCodigosPagosAnteriores(unitId, mesArquivo);
          pacto = Adapter.traduzir(json, { codigosPagos });
          // O id da unidade (`unit-cp`, `cp`) não é a sigla do arquivo (`(CP)`)
          const sigla = Adapter.siglaDaUnidade(unitId, Object.keys(pacto.porUnidade).filter(k => k));

          // O "Faturamento por Período" (VENDAS) é PROIBIDO no cálculo — traz o
          // contrato inteiro, pagaria 12× num anual. Serve só à conferência.
          if (pacto.relatorio !== 'recebido') {
            return { tipo: 'vendas', json, pacto };
          }

          const vendasUnidade = pacto.porUnidade[sigla] || [];
          if (!vendasUnidade.length) {
            const outras = Object.entries(pacto.porUnidade)
              .filter(([u, v]) => u && v.length).map(([u, v]) => `${u} (${v.length})`).join(', ');
            return { tipo: 'outraUnidade', outras };
          }
          // Degustação GRÁTIS: sem recebimento, guardada no período pelo relatório
          // de vendas (29/09/2026) ou achada pela varredura da API (30/09/2026).
          let degustacoesGuardadas = [];
          try {
            const per = await db.collection(PERIODOS).doc(`${unitId}_${pacto.mes}`).get();
            degustacoesGuardadas = (per.exists && per.data().degustacoesGratis) || [];
          } catch (e) {
            pacto.avisos = [...(pacto.avisos || []), { motivo: 'não consegui ler as degustações grátis do mês (' + e.message + ') — suba de novo antes de pagar', cliente: '' }];
          }
          if (opcoes.degustacoes && opcoes.degustacoes.length) {
            const porContrato = new Map(degustacoesGuardadas.map(d => [String(d.contrato), d]));
            opcoes.degustacoes.forEach(d => { if (!porContrato.has(String(d.contrato))) porContrato.set(String(d.contrato), d); });
            degustacoesGuardadas = [...porContrato.values()];
          }
          const juntas = Adapter.juntarDegustacoes(vendasUnidade, degustacoesGuardadas, codigosPagos);
          pacto.degustacoesIncluidas = juntas.incluidas;
          json = [Adapter.CABECALHO_SAIDA, ...Adapter.paraPlanilha(juntas.vendas)];
        }

        const rawRows = Engine.cleanRawData(json);
        if (rawRows.length === 0) return { tipo: 'vazio' };

        const monthCount = Engine.detectMonths(rawRows);
        const sortedMonths = Object.entries(monthCount).sort((a, b) => b[1] - a[1]);
        const detectedPeriod = sortedMonths[0] && sortedMonths[0][0];
        if (sortedMonths.length > 1) return { tipo: 'variosMeses', meses: sortedMonths };

        // Mês anterior: as degustações dele servem ao P4 da prévia
        let previousProcessed = [];
        if (detectedPeriod) {
          try {
            const [yr, mo] = detectedPeriod.split('-');
            const prevMonthDate = new Date(parseInt(yr), parseInt(mo) - 1, 0);
            const prevPeriodId = `${unitId}_${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;
            const prevSnap = await db.collection(PERIODOS).doc(prevPeriodId).collection('itens').where('type', '==', 'processed').get();
            prevSnap.forEach(doc => previousProcessed.push(doc.data()));
          } catch (e) { log.warn('Could not load previous period for P4 preview:', e); }
        }

        const cfg = { ...Engine.defaultConfig, ...(await ops.configDaUnidade(unitId)) };
        const result = Engine.calculate(rawRows, cfg, {}, previousProcessed);

        // Quem precisa ser cadastrada, ou ganhar a unidade
        const existingSnap = await db.collection('users').get();
        const allUsers = [];
        existingSnap.forEach(doc => allUsers.push({ id: doc.id, ...doc.data() }));
        const vendorNames = Object.keys(result.vendorData).filter(n => n !== 'Sem Vendedor');
        const newVendors = [];
        const usersToUpdateUnit = [];
        vendorNames.forEach(vName => {
          const normV = M._normalizar(vName);
          const found = allUsers.find(u => M._normalizar(u.name) === normV);
          if (!found) {
            newVendors.push(vName);
          } else {
            const allowed = found.allowedUnits || (found.unitId ? [found.unitId] : []);
            if (!allowed.includes(unitId)) {
              usersToUpdateUnit.push({ id: found.id, name: found.name, allowedUnits: [...allowed, unitId] });
            }
          }
        });

        return { tipo: 'ok', rawRows, result, pacto, newVendors, usersToUpdateUnit, vendorNames, detectedPeriod };
      },

      /**
       * Grava o que `preparar` calculou: o período, os lançamentos (com a
       * deduplicação que preserva divisão, edição e valor original), apaga o que
       * sumiu, recalcula, `codigosPagos`, histórico e diferidas.
       * @returns {{ periodId, skipped, added, replaced, removidos, diferidos, itens }}
       */
      async gravar(preparado, { unitId, mes, fileName, origem, dadosAte }) {
        const [year, month] = mes.split('-');
        const periodId = `${unitId}_${year}-${month}`;
        const { result, newVendors, usersToUpdateUnit } = preparado;

        let beforeVendorSummaryUpload = {};
        try {
          const existingPeriodSnap = await db.collection(PERIODOS).doc(periodId).get();
          if (existingPeriodSnap.exists) beforeVendorSummaryUpload = existingPeriodSnap.data().vendorSummary || {};
        } catch (_e) {}

        await ops.registrarVendedoras(unitId, newVendors, usersToUpdateUnit);

        const finalP4Result = result.p4result;
        const uploadId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

        const rawPeriodData = {
          unitId, year: parseInt(year), month: parseInt(month),
          fileName,
          // De onde veio (30/09/2026): 'api' = Pacto (automático ou botão); 'planilha' = arquivo
          origem: origem || 'planilha',
          dadosAte: dadosAte || null,
          uploadedBy: quem().uid,
          uploadId,
          totals: result.unitTotals,
          vendorSummary: Object.fromEntries(
            Object.entries(result.vendorData).map(([name, v]) => [name, {
              p1: v.p1total, p2: v.p2total, p3: v.p3, p4i: v.p4individual, p4p: v.p4pool,
              grandTotal: v.grandTotal, ativacoes: v.ativacoes,
              novos: v.novos, renovacoes: v.renovacoes, retornos: v.retornos, vouchers: v.vouchers,
              caixa: v.caixaTotal, isNaoCom: v.isNaoCom,
            }])
          ),
          p4result: {
            ...finalP4Result,
            conversions: (finalP4Result.conversions || []).map(c => ({ ...c })),
            currentVouchers: (finalP4Result.currentVouchers || []).map(v => {
              const cv = { ...v };
              delete cv.dateObj;
              delete cv.dateVoucherEnd;
              return cv;
            })
          },
        };
        // A data entra DEPOIS da limpeza: o marcador do Firebase não sobrevive a ela
        const periodData = { ...M._semIndefinidos(rawPeriodData), uploadDate: FieldValue.serverTimestamp() };
        await db.collection(PERIODOS).doc(periodId).set(periodData, { merge: true });

        // ── Deduplicação: o que já existe no período ──
        const existingSnap = await db.collection(PERIODOS).doc(periodId).collection('itens').get();
        const existingMap = {};
        const existingProcessedData = {};
        const existingSoftMap = {};
        const existingSoftValores = new Map();
        existingSnap.forEach(doc => {
          const d = doc.data();
          existingMap[doc.id] = d.type || 'processed';
          if ((d.type || 'processed') === 'processed') {
            existingProcessedData[doc.id] = d;
            const s = M.generateSoftId(d);
            existingSoftMap[s] = { stableId: doc.id, valorCaixa: d.valorCaixa || 0 };
            if (!existingSoftValores.has(s)) existingSoftValores.set(s, new Set());
            existingSoftValores.get(s).add(Number(d.valorCaixa || 0).toFixed(2));
          }
        });

        // Venda já DIVIDIDA: não re-adiciona o cheio e não apaga as pernas (16/06/2026)
        const splitBaseKey = (d) => {
          const baseItem = String(d.item || '').replace(/\s*\(Split:[^)]*\)\s*$/i, '').trim().toUpperCase();
          return String(d.cliente || '').trim().toUpperCase() + '|' + String(d.data || '').replace(/\//g, '') + '|' + baseItem;
        };
        const existingSplitBases = new Set();
        existingSnap.forEach(doc => {
          const d = doc.data();
          if ((d.type || 'processed') === 'processed' && (d.originalSplitId || String(d.item || '').includes('(Split:'))) {
            existingSplitBases.add(splitBaseKey(d));
          }
        });

        const itemsRef = db.collection(PERIODOS).doc(periodId).collection('itens');
        const allItems = [...result.processed.map(d => ({ ...d, type: 'processed' })), ...result.excluded.map(d => ({ ...d, type: 'excluded' })), ...(result.deferred || []).map(d => ({ ...d, type: 'deferred' }))]
          .filter(d => {
            const hasContent = (d.vendedor || '').trim() || (d.cliente || '').trim() || (d.item || '').trim();
            const hasValue = (d.valorCaixa || 0) > 0;
            const isDegust = d.isDegustacao === true;
            return hasContent || hasValue || isDegust;
          });
        const idsUpload = M.idsComRepeticao(allItems);
        const idDe = new Map(allItems.map((d, k) => [d, idsUpload[k]]));

        let skipped = 0, replaced = 0, added = 0;
        for (let i = 0; i < allItems.length; i += 400) {
          const batch = db.batch();
          allItems.slice(i, i + 400).forEach(item => {
            const stableId = idDe.get(item);
            const existingType = existingMap[stableId];
            if (item.type === 'processed' && existingSplitBases.has(splitBaseKey(item))) { skipped++; return; }
            // Já existe ATIVO → fica o gravado (preserva edição); INATIVO → substitui
            if (existingType === 'processed') {
              skipped++;
              batch.update(itemsRef.doc(stableId), { uploadId });
              return;
            }
            // Mesmo lançamento com o valor mudado → fica o original
            const softId = M.generateSoftId(item);
            if (existingSoftMap[softId] && existingSoftMap[softId].stableId !== stableId && M.ehValorAlterado(existingSoftValores, item)) {
              skipped++;
              batch.update(itemsRef.doc(existingSoftMap[softId].stableId), { uploadId });
              return;
            }
            if (existingType) replaced++; else added++;
            const ref = itemsRef.doc(stableId);
            const clean = { uploadId };
            Object.entries(item).forEach(([k, v]) => {
              if (v instanceof Date) clean[k] = Timestamp.fromDate(v);
              else if (typeof v !== 'function' && v !== undefined) clean[k] = v;
            });
            delete clean.dateObj;
            delete clean.dateVoucherEnd;
            batch.set(ref, clean, { merge: false });
          });
          await batch.commit();
        }
        log.info(`[gravar] ${periodId}: ${added} novos, ${replaced} substituídos, ${skipped} ignorados (já ativos).`);

        // ── Histórico: adicionados, valor alterado, removidos ──
        const uploadItemDeltas = [];
        const newUploadIds = new Set(allItems.filter(d => d.type === 'processed').map(item => idDe.get(item)));
        const newSoftValores = new Map();
        allItems.filter(d => d.type === 'processed').forEach(item => {
          const s = M.generateSoftId(item);
          if (!newSoftValores.has(s)) newSoftValores.set(s, new Set());
          newSoftValores.get(s).add(Number(item.valorCaixa || 0).toFixed(2));
        });
        const ficaPorValorAlterado = (existente) => {
          const vals = newSoftValores.get(M.generateSoftId(existente));
          return !!vals && !vals.has(Number(existente.valorCaixa || 0).toFixed(2));
        };
        allItems.filter(d => d.type === 'processed').forEach(item => {
          const stableId = idDe.get(item);
          if (existingMap[stableId] === 'processed') return;
          if (M.ehValorAlterado(existingSoftValores, item)) return;
          if (existingSplitBases.has(splitBaseKey(item))) return;
          uploadItemDeltas.push({
            vendorId: item.vendedor || '', vendorName: item.vendedor || '', change: 'added',
            cliente: item.cliente || '', item: item.item || '', data: item.data || '',
            impacto: Math.round(((item.p1valor || 0) + (item.p2bonus || 0)) * 100) / 100
          });
        });
        allItems.filter(d => d.type === 'processed').forEach(item => {
          const stableId = idDe.get(item);
          if (existingMap[stableId] === 'processed') return;
          if (!M.ehValorAlterado(existingSoftValores, item)) return;
          const original = existingSoftMap[M.generateSoftId(item)];
          uploadItemDeltas.push({
            vendorId: item.vendedor || '', vendorName: item.vendedor || '', change: 'valor_alterado_ignorado',
            cliente: item.cliente || '', item: item.item || '', data: item.data || '',
            valorOriginal: original.valorCaixa, valorNovo: item.valorCaixa || 0, impacto: 0
          });
        });
        Object.entries(existingProcessedData).forEach(([stableId, item]) => {
          if (!newUploadIds.has(stableId) && !ficaPorValorAlterado(item)) {
            uploadItemDeltas.push({
              vendorId: item.vendedor || '', vendorName: item.vendedor || '', change: 'removed',
              cliente: item.cliente || '', item: item.item || '', data: item.data || '',
              impacto: -Math.round(((item.p1valor || 0) + (item.p2bonus || 0)) * 100) / 100
            });
          }
        });

        // ── Apaga o que saiu da fonte (menos original de valor alterado e pernas de divisão) ──
        const removedStableIds = Object.keys(existingProcessedData).filter(id => {
          if (newUploadIds.has(id)) return false;
          if (ficaPorValorAlterado(existingProcessedData[id])) return false;
          if (existingProcessedData[id].originalSplitId) return false;
          if (String(existingProcessedData[id].item || '').includes('(Split:')) return false;
          return true;
        });
        for (let i = 0; i < removedStableIds.length; i += 400) {
          const delBatch = db.batch();
          removedStableIds.slice(i, i + 400).forEach(stableId => delBatch.delete(itemsRef.doc(stableId)));
          await delBatch.commit();
        }

        // ── Recalcula a partir do que ficou gravado ──
        const itens = await ops.recalcularPeriodo(periodId, null);

        const activeItemsForSnapshot = itens
          .filter(d => d.type === 'processed')
          .map(d => ({
            vendedor: d.vendedor || '', cliente: d.cliente || '', item: d.item || '', data: d.data || '',
            categoria: d.category || d.categoria || '', label: d.label || '',
            valorCaixa: d.valorCaixa || 0, p1valor: d.p1valor || 0, p2bonus: d.p2bonus || 0,
            total: Math.round(((d.p1valor || 0) + (d.p2bonus || 0)) * 100) / 100
          }));

        // Quem não pode pagar de novo no mês que vem (derivado dos ITENS reais)
        await ops.gravarCodigosPagos(periodId, itens);

        let afterVendorSummaryUpload = periodData.vendorSummary || {};
        try {
          const freshPeriodSnap = await db.collection(PERIODOS).doc(periodId).get();
          if (freshPeriodSnap.exists) afterVendorSummaryUpload = freshPeriodSnap.data().vendorSummary || {};
        } catch (_e) {}
        await ops.salvarHistorico(periodId, { type: 'upload', label: `Upload: ${fileName}` },
          beforeVendorSummaryUpload, afterVendorSummaryUpload,
          { precomputedItemDeltas: uploadItemDeltas, activeItems: activeItemsForSnapshot });

        // Diferidas (regra antiga, encerrada em ago/2026 — mantida para arquivo antigo)
        const diferidos = (result.deferred || []).length;
        for (let i = 0; i < diferidos; i += 400) {
          const deferBatch = db.batch();
          result.deferred.slice(i, i + 400).forEach(d => {
            const ref = db.collection('comissoes_diferidas').doc();
            const clean = {};
            Object.entries(d).forEach(([k, v]) => {
              if (v instanceof Date) clean[k] = Timestamp.fromDate(v);
              else if (typeof v !== 'function' && v !== undefined) clean[k] = v;
            });
            delete clean.dateObj;
            clean.sourcePeriodId = periodId;
            clean.unitId = unitId;
            clean.status = 'pendente';
            deferBatch.set(ref, clean);
          });
          await deferBatch.commit();
        }

        return { periodId, skipped, added, replaced, removidos: removedStableIds.length, diferidos, itens };
      },

      /**
       * Mês sem meta (out/2026+): grava a meta que o sistema propõe, marcada como
       * "aguardando revisão" — o recibo trava até a gestão revisar. NÃO recalcula:
       * quem chama recalcula (a tela avisa; o automático registra).
       * @returns {{ proposto: boolean, motivo?: 'nao_precisa'|'sem_historico', campos?, porque? }}
       */
      async proporMeta(periodId, data, { ehAdmin }) {
        const Metas = deps.Metas;
        const mes = (String(periodId).match(/(\d{4}-\d{2})$/) || [])[1];
        if (!Metas || !Metas.precisaPropor({ mes, periodo: data, ehAdmin })) return { proposto: false, motivo: 'nao_precisa' };
        const unitId = data.unitId || String(periodId).replace(/_\d{4}-\d{2}$/, '');
        const desde = (() => { const [a, m] = mes.split('-').map(Number); return new Date(Date.UTC(a, m - 14, 1)).toISOString().slice(0, 7); })();
        const snap = await db.collection(PERIODOS).where('unitId', '==', unitId).get();
        const periodos = [];
        for (const d of snap.docs) {
          const pm = (d.id.match(/(\d{4}-\d{2})$/) || [])[1];
          if (!pm || pm >= mes || pm < desde) continue;
          const itens = await db.collection(PERIODOS).doc(d.id).collection('itens').where('type', '==', 'processed').get();
          periodos.push({ mes: pm, data: d.data(), maiorDia: Metas.maiorData(itens.docs.map(x => x.data().data)) });
        }
        const { serie, metas } = Metas.serieDosPeriodos(periodos, mes);
        // Renovações que vencem no mês = Bloco 1 da lista de renovações, se já existir
        const sigla = Adapter.siglaDaUnidade(unitId, ['CP', 'PP']);
        let renovacaoBase = null;
        let renovadosAntes = 0;     // já renovados antes de o mês começar: só entra no porquê
        try {
          const l = await db.collection('renovacoes_lista').doc(sigla + '_' + mes).get();
          if (l.exists && l.data().situacao === 'ok') {
            const bloco1 = l.data().blocos.renovacoes || [];
            renovacaoBase = bloco1.length;
            renovadosAntes = bloco1.filter(x => x && x.renovouAntesDoMes).length;
          }
        } catch (e) { log.warn('lista de renovações indisponível:', e.message); }
        // % acima da média dos vouchers: configuração da unidade (decisão do Rafael, 30/09)
        const cfgUnidade = { ...Engine.defaultConfig, ...(await ops.configDaUnidade(unitId)) };
        const r = Metas.sugerir({ mes, serie, metasAnteriores: metas, renovacaoBase, renovadosAntes, pctVoucherAcima: cfgUnidade.pctVoucherAcimaDaMedia });
        if (!r.confiavel) return { proposto: false, motivo: 'sem_historico' };
        await db.collection(PERIODOS).doc(periodId).set({
          metasMensais: r.campos,
          metaSugerida: { origem: 'sistema', revisadaPor: null, porque: r.porque, base: r.base,
            geradaPor: quem().email || 'admin', geradaEm: FieldValue.serverTimestamp() },
        }, { merge: true });
        return { proposto: true, campos: r.campos, porque: r.porque };
      },

      /**
       * Refaz a conta do período a partir de TODOS os lançamentos gravados.
       * @returns {Array} os itens (com `_docId`) — a tela guarda no cache dela
       */
      async recalcularPeriodo(periodId, triggerContext) {
        if (!periodId) return [];
        const pDoc = await db.collection(PERIODOS).doc(periodId).get();
        if (!pDoc.exists) return [];
        const pData = pDoc.data();
        const beforeVendorSummary = pData.vendorSummary || {};

        // Sempre o conjunto COMPLETO do banco (B3, 15/06/2026)
        const items = [];
        const itemsSnap = await db.collection(PERIODOS).doc(periodId).collection('itens').get();
        itemsSnap.forEach(doc => items.push({ _docId: doc.id, ...doc.data() }));

        const processed = items.filter(d => d.type === 'processed');
        const unidadeDoPeriodo = pData.unitId || String(periodId).replace(/_\d{4}-\d{2}$/, '');
        const unitCfgPeriodo = await ops.configDaUnidade(unidadeDoPeriodo);
        const mesDoPeriodo = M.mesDoPeriodoId(periodId);
        const minimosPorPessoa = await ops.minimosDoPeriodo(mesDoPeriodo, unitCfgPeriodo, pData);
        const ativacoesAdiadas = await ops.ativacoesAdiadasPara(unidadeDoPeriodo, mesDoPeriodo);
        const cfg = Engine.configDoMes({ unitConfig: unitCfgPeriodo, metasMensais: pData.metasMensais, mes: mesDoPeriodo, minimosPorPessoa, ativacoesAdiadas });

        const beforeItemValues = {};
        if (triggerContext) {
          processed.forEach(item => { beforeItemValues[item._docId] = { p1: item.p1valor || 0, p2: item.p2bonus || 0 }; });
        }

        // Mês anterior: degustações para o P4 e a conversão como venda nova
        let previousProcessed = [];
        try {
          const currentYear = parseInt(periodId.split('_')[1].split('-')[0]);
          const currentMonth = parseInt(periodId.split('_')[1].split('-')[1]);
          const prevMonthDate = new Date(currentYear, currentMonth - 1, 0);
          const prevPeriodId = `${unidadeDoPeriodo}_${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;
          const prevDoc = await db.collection(PERIODOS).doc(prevPeriodId).get();
          if (prevDoc.exists) {
            const prevUploadId = prevDoc.data().uploadId;
            const prevQuery = prevUploadId
              ? db.collection(PERIODOS).doc(prevPeriodId).collection('itens').where('uploadId', '==', prevUploadId).where('type', '==', 'processed')
              : db.collection(PERIODOS).doc(prevPeriodId).collection('itens').where('type', '==', 'processed');
            const prevSnap = await prevQuery.get();
            prevSnap.forEach(doc => previousProcessed.push(doc.data()));
          }
        } catch (e) { log.warn('Could not load previous period for recalculate P4:', e); }

        Engine.marcarConversoesComoNovas(processed, previousProcessed, cfg);

        // 1. Refaz a comissão de cada lançamento e grava (lotes de 400)
        try {
          for (let i = 0; i < processed.length; i += 400) {
            const batch = db.batch();
            processed.slice(i, i + 400).forEach(item => {
              Engine.applyCommissionsToItem(item, cfg);
              batch.update(db.collection(PERIODOS).doc(periodId).collection('itens').doc(item._docId), {
                p1valor: item.p1valor, p1pct: item.p1pct, p2bonus: item.p2bonus,
                isActivation: item.isActivation, isNaoCom: item.isNaoCom, label: item.label,
                category: item.category || null,
                ...(item.conversaoDeDegustacao ? { conversaoDeDegustacao: true, categoriaPacto: item.categoriaPacto || 'renovacao' } : {})
              });
            });
            await batch.commit();
          }
        } catch (syncErr) {
          log.error('Error syncing items during recalculation:', syncErr);
        }

        // 2. Por vendedora, a partir dos lançamentos atualizados
        const vendorData = Engine.buildVendorData(processed, {}, cfg);
        const { unitAtivacoes, unitNovosRetorno, unitRenovacoes, unitVouchers } = Engine.contagensDaUnidade(processed, cfg.ativacoesAdiadas);
        const unitCaixa = processed.reduce((s, d) => s + (d.valorCaixa || 0), 0);
        Engine.applyP3Pool(vendorData, unitAtivacoes, unitNovosRetorno, unitRenovacoes, unitVouchers, cfg);
        const p4result = Engine.calcP4(processed, previousProcessed, cfg);
        p4result.conversions.forEach(c => { if (vendorData[c.vendedora] && !c.isNaoCom) vendorData[c.vendedora].p4individual += c.bonus; });
        Object.entries(p4result.vendorPool).forEach(([name, amount]) => { if (vendorData[name]) vendorData[name].p4pool += amount; });
        Object.values(vendorData).forEach(v => { v.grandTotal = v.p1total + v.p2total + v.p3 + v.p4individual + v.p4pool; });

        const r2 = x => Math.round((x || 0) * 100) / 100;
        const vendorSummary = Object.fromEntries(Object.entries(vendorData).map(([name, v]) => [name, {
          p1: v.p1total, p2: v.p2total, p3: v.p3, p4i: v.p4individual, p4p: v.p4pool,
          grandTotal: v.grandTotal, ativacoes: r2(v.ativacoes),
          novos: r2(v.novos), renovacoes: r2(v.renovacoes), retornos: r2(v.retornos), vouchers: r2(v.vouchers),
          caixa: v.caixaTotal,
          p3base: v.caixaP3Eligible || 0,
          isNaoCom: v.isNaoCom,
          p3Tier: v.p3detail ? v.p3detail.tierLabel : '',
          p3Motivos: (v.p3detail && v.p3detail.motivos) || [],
          p3fixo: (v.p3detail && v.p3detail.fixo) || 0,
          p3pct: (v.p3detail && v.p3detail.pctValor) || 0,
          p3bruto: (v.p3detail && v.p3detail.bruto) || 0,
          p3multiplier: (v.p3detail && v.p3detail.multiplier) || 1
        }]));

        const rawUpdateData = {
          totals: { unitAtivacoes: r2(unitAtivacoes), unitNovosRetorno: r2(unitNovosRetorno), unitRenovacoes: r2(unitRenovacoes), unitVouchers: r2(unitVouchers), unitCaixa: r2(unitCaixa) },
          minimosPorPessoa: minimosPorPessoa || null,
          vendorSummary,
          p4result: {
            ...p4result,
            currentVouchers: p4result.currentVouchers.map(v => { const cv = { ...v }; delete cv.dateObj; return cv; })
          }
        };
        const limpar = (obj) => {
          const clean = {};
          for (const [k, v] of Object.entries(obj)) {
            if (v === undefined) continue;
            if (v !== null && typeof v === 'object' && !(v instanceof Date) && !(v.constructor && v.constructor.name === 'FieldValueImpl')) {
              clean[k] = Array.isArray(v) ? v.map(i => typeof i === 'object' ? limpar(i) : (i === undefined ? null : i)) : limpar(v);
            } else {
              clean[k] = v;
            }
          }
          return clean;
        };
        await db.collection(PERIODOS).doc(periodId).update(limpar(rawUpdateData));

        if (triggerContext) {
          await ops.salvarHistorico(periodId, triggerContext, beforeVendorSummary, vendorSummary, { beforeItemValues, processedItems: processed });
        }
        return items;
      },
    };
    return ops;
  },
};

if (typeof module !== 'undefined') module.exports = ComissoesMes;
if (typeof window !== 'undefined') window.ComissoesMes = ComissoesMes;
