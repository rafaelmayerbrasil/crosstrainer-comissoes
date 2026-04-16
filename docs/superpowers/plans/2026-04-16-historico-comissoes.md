# Histórico de Alterações de Comissões — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar um snapshot de comissões por vendedor (com deltas de lançamentos) a cada recálculo do período, e exibir esse histórico para admin (todos os vendedores) e vendedor (apenas os próprios dados).

**Architecture:** A função `saveHistoricoSnapshot()` salva na subcoleção `periodos/{id}/historico/` sempre que houver mudança real nos valores. `recalculatePeriod()` recebe um `triggerContext` e chama o snapshot ao fim. `confirmUpload()` trata o caso de upload separadamente. Duas funções de UI renderizam o histórico: `renderHistoricoTab()` (admin) e `renderVendorHistoricoTab()` (vendedor).

**Tech Stack:** Vanilla JavaScript, Firebase Firestore, HTML/CSS inline

---

## File Map

- **Modify:** `index.html` — único arquivo. Todas as tarefas editam este arquivo.

---

## Task 1: Adicionar função `saveHistoricoSnapshot()`

**Files:**
- Modify: `index.html` (inserir antes da linha 5195 — antes de `recalculatePeriod`)

- [ ] **Step 1: Inserir a função antes de `recalculatePeriod`**

Localizar a linha:
```javascript
    async function recalculatePeriod(periodId) {
```
Inserir ANTES dela:

```javascript
    // ═══════════════════════════════════════════════════════════════
    // HISTÓRICO DE COMISSÕES
    // ═══════════════════════════════════════════════════════════════
    async function saveHistoricoSnapshot(periodId, triggerContext, beforeVendorSummary, afterVendorSummary, { beforeItemValues, processedItems, precomputedItemDeltas } = {}) {
      try {
        // Vendor-level deltas
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

        // Item-level deltas
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
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
          triggerType: triggerContext.type,
          triggerLabel: triggerContext.label,
          triggeredBy: {
            uid: currentUser ? currentUser.uid : '',
            name: currentUser ? (currentUser.displayName || currentUser.email.split('@')[0]) : 'Sistema'
          },
          vendorSnapshots,
          itemDeltas
        };
        await db.collection('periodos').doc(periodId).collection('historico').add(snapshot);
      } catch (e) {
        console.warn('[Histórico] Erro ao salvar snapshot:', e);
      }
    }

```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat: add saveHistoricoSnapshot() helper"
```

---

## Task 2: Modificar `recalculatePeriod()` para capturar e salvar snapshot

**Files:**
- Modify: `index.html` linhas 5195–5331

- [ ] **Step 1: Adicionar parâmetro `triggerContext` à assinatura**

Localizar:
```javascript
    async function recalculatePeriod(periodId) {
```
Substituir por:
```javascript
    async function recalculatePeriod(periodId, triggerContext) {
```

- [ ] **Step 2: Capturar `beforeVendorSummary` logo após ler `pData`**

Localizar (linha ~5200):
```javascript
      const currentUploadId = pData.uploadId;
```
Substituir por:
```javascript
      const currentUploadId = pData.uploadId;
      const beforeVendorSummary = pData.vendorSummary || {};
```

- [ ] **Step 3: Capturar `beforeItemValues` antes do loop de applyCommissionsToItem**

Localizar:
```javascript
      const processed = items.filter(d => d.type === 'processed');
      const cfg = { ...CommissionEngine.defaultConfig, ...unitConfig, ...(pData.metasMensais || {}) };
      
      // 1. Recalculate and Sync each item back to Firestore in batches
```
Substituir por:
```javascript
      const processed = items.filter(d => d.type === 'processed');
      const cfg = { ...CommissionEngine.defaultConfig, ...unitConfig, ...(pData.metasMensais || {}) };

      // HISTÓRICO: snapshot de valores antes do recálculo
      const beforeItemValues = {};
      if (triggerContext) {
        processed.forEach(item => {
          beforeItemValues[item._docId] = { p1: item.p1valor || 0, p2: item.p2bonus || 0 };
        });
      }

      // 1. Recalculate and Sync each item back to Firestore in batches
```

- [ ] **Step 4: Chamar `saveHistoricoSnapshot` após o `update` final do período**

Localizar (última linha de recalculatePeriod):
```javascript
      await db.collection('periodos').doc(periodId).update(removeUndefinedFields(rawUpdateData));
    }
```
Substituir por:
```javascript
      await db.collection('periodos').doc(periodId).update(removeUndefinedFields(rawUpdateData));

      // HISTÓRICO: salvar snapshot se houve triggerContext
      if (triggerContext) {
        await saveHistoricoSnapshot(periodId, triggerContext, beforeVendorSummary, vendorSummary, { beforeItemValues, processedItems: processed });
      }
    }
```

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: recalculatePeriod captures historico snapshot"
```

---

## Task 3: Atualizar os 11 call sites de `recalculatePeriod()`

**Files:**
- Modify: `index.html`

Cada chamada recebe um segundo argumento `{ type, label }`. Localizar cada linha pelo contexto e substituir.

- [ ] **Step 1: Linha ~3770 — saveSettings (config change)**

Localizar:
```javascript
        await recalculatePeriod(currentPeriodId);
```
Dentro de `saveSettings()`. Substituir por:
```javascript
        await recalculatePeriod(currentPeriodId, { type: 'config_change', label: 'Configuração alterada' });
```

- [ ] **Step 2: Linha ~4859 — metas mensais**

Localizar a segunda chamada `await recalculatePeriod(currentPeriodId);` (contexto de metas mensais, após salvar `metasMensais`). Substituir por:
```javascript
        await recalculatePeriod(currentPeriodId, { type: 'config_change', label: 'Metas mensais atualizadas' });
```

- [ ] **Step 3: Linha ~4889 — ignorar registro**

Localizar a chamada em contexto de "ignorar" / `canceladoSemEstorno`. Substituir por:
```javascript
        await recalculatePeriod(currentPeriodId, { type: 'item_delete', label: 'Item removido/ignorado' });
```

- [ ] **Step 4: Linha ~4934 — restaurar registro**

Localizar a chamada em contexto de "restaurar". Substituir por:
```javascript
        await recalculatePeriod(currentPeriodId, { type: 'item_edit', label: 'Item restaurado' });
```

- [ ] **Step 5: Linha ~5034 — split de registro**

Localizar a chamada em contexto de "split". Substituir por:
```javascript
        await recalculatePeriod(currentPeriodId, { type: 'item_edit', label: 'Divisão de registro' });
```

- [ ] **Step 6: Linhas ~5176–5177 — mover registro (2 chamadas)**

Localizar as duas chamadas consecutivas em contexto de "mover para outro período". Substituir por:
```javascript
        await recalculatePeriod(currentPeriodId, { type: 'item_delete', label: 'Item movido para outro período' });
        await recalculatePeriod(targetPeriodId, { type: 'item_add', label: 'Item recebido de outro período' });
```

- [ ] **Step 7: Linha ~5186 — edição de registro**

Localizar a chamada em contexto de edição manual. Substituir por:
```javascript
        await recalculatePeriod(currentPeriodId, { type: 'item_edit', label: 'Edição manual de lançamento' });
```

- [ ] **Step 8: Linha ~7032 — bulk ignore**

Localizar a chamada dentro de `bulkIgnoreRecords` (ou equivalente). Substituir por:
```javascript
        await recalculatePeriod(currentPeriodId, { type: 'item_delete', label: 'Remoção em lote' });
```

- [ ] **Step 9: Linha ~7105 — bulk restore**

Localizar dentro de `bulkRestoreRecords`. Substituir por:
```javascript
        await recalculatePeriod(currentPeriodId, { type: 'item_edit', label: 'Restauração em lote' });
```

- [ ] **Step 10: Linha ~7214 — bulk edit**

Localizar dentro de `openBulkEditRecords` (bulk edit). Substituir por:
```javascript
        await recalculatePeriod(currentPeriodId, { type: 'item_edit', label: 'Edição em lote' });
```

- [ ] **Step 11: Commit**

```bash
git add index.html
git commit -m "feat: pass triggerContext to all recalculatePeriod call sites"
```

---

## Task 4: Modificar `confirmUpload()` para salvar snapshot de upload

**Files:**
- Modify: `index.html` (função `confirmUpload`, linha ~4477)

- [ ] **Step 1: Carregar `beforeVendorSummary` antes de salvar o período**

Localizar dentro de `confirmUpload()`:
```javascript
        console.log('[confirmUpload] Iniciando confirmUpload para periodoId:', periodId);
        toast('Salvando...', 'info');
```
Inserir DEPOIS:
```javascript
        // HISTÓRICO: capturar estado anterior (se período já existia)
        let beforeVendorSummaryUpload = {};
        try {
          const existingPeriodSnap = await db.collection('periodos').doc(periodId).get();
          if (existingPeriodSnap.exists) beforeVendorSummaryUpload = existingPeriodSnap.data().vendorSummary || {};
        } catch (_e) {}

```

- [ ] **Step 2: Construir `uploadItemDeltas` e chamar `saveHistoricoSnapshot` após salvar itens**

Localizar (linha ~4630):
```javascript
        console.log(`[confirmUpload] Dedup: ${added} novos, ${replaced} substituídos, ${skipped} ignorados (já ativos).`);
```
Inserir DEPOIS:
```javascript
        // HISTÓRICO: construir deltas de itens adicionados neste upload
        const uploadItemDeltas = [];
        allItems.filter(d => d.type === 'processed').forEach(item => {
          const stableId = generateStableId(item);
          if (existingMap[stableId] !== 'processed') {
            uploadItemDeltas.push({
              vendorId: item.vendedor || '',
              vendorName: item.vendedor || '',
              change: 'added',
              cliente: item.cliente || '',
              item: item.item || '',
              data: item.data || '',
              impacto: Math.round(((item.p1valor || 0) + (item.p2bonus || 0)) * 100) / 100
            });
          }
        });

        await saveHistoricoSnapshot(
          periodId,
          { type: 'upload', label: `Upload: ${fileName}` },
          beforeVendorSummaryUpload,
          periodData.vendorSummary || {},
          { precomputedItemDeltas: uploadItemDeltas }
        );

```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: confirmUpload saves historico snapshot"
```

---

## Task 5: Adicionar aba "Histórico" na visão admin

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Adicionar botão da aba na string HTML dos tabs admin**

Localizar (linha ~5452):
```javascript
        <button class="tab-btn" onclick="switchDashTab('tabDiferidos',this)">⏳ Diferidos</button>
      </div>
```
Substituir por:
```javascript
        <button class="tab-btn" onclick="switchDashTab('tabDiferidos',this)">⏳ Diferidos</button>
        <button class="tab-btn" onclick="switchDashTab('tabHistorico',this)">📋 Histórico</button>
      </div>
```

- [ ] **Step 2: Adicionar div de conteúdo da aba na string HTML**

Localizar (linha ~5627):
```javascript
      <div id="tabDiferidos" style="display:none">
        <div id="diferidosContent"></div>
      </div> <!-- END tabDiferidos -->
      `;
```
Substituir por:
```javascript
      <div id="tabDiferidos" style="display:none">
        <div id="diferidosContent"></div>
      </div> <!-- END tabDiferidos -->

      <div id="tabHistorico" style="display:none">
        <div id="adminHistoricoContent"></div>
      </div> <!-- END tabHistorico -->
      `;
```

- [ ] **Step 3: Registrar `tabHistorico` no array de `switchDashTab`**

Localizar (linha ~6952):
```javascript
      const allTabs = ['tabResumo', 'tabRegistros', 'tabComissoes', 'tabAtivacoes', 'tabRelatorio', 'tabDiferidos'];
```
Substituir por:
```javascript
      const allTabs = ['tabResumo', 'tabRegistros', 'tabComissoes', 'tabAtivacoes', 'tabRelatorio', 'tabDiferidos', 'tabHistorico'];
```

- [ ] **Step 4: Adicionar lazy load de histórico no `switchDashTab`**

Localizar (linha ~6969):
```javascript
        else if (tabId === 'tabDiferidos') renderDiferidosTab(data, periodId);
```
Substituir por:
```javascript
        else if (tabId === 'tabDiferidos') renderDiferidosTab(data, periodId);
        else if (tabId === 'tabHistorico') renderHistoricoTab(periodId);
```

- [ ] **Step 5: Adicionar função `renderHistoricoTab()`**

Localizar a linha com o bloco de comentário que separa o DASHBOARD TAB SWITCHER (linha ~6948):
```javascript
    // ═══════════════════════════════════════════════════════════════
    // DASHBOARD TAB SWITCHER
```
Inserir ANTES:
```javascript
    // ═══════════════════════════════════════════════════════════════
    // HISTÓRICO ADMIN TAB
    // ═══════════════════════════════════════════════════════════════
    async function renderHistoricoTab(periodId) {
      const el = document.getElementById('adminHistoricoContent');
      if (!el) return;
      el.innerHTML = '<p style="color:var(--text2);text-align:center;padding:40px">Carregando histórico...</p>';
      try {
        const snap = await db.collection('periodos').doc(periodId).collection('historico')
          .orderBy('timestamp', 'desc').limit(50).get();
        if (snap.empty) {
          el.innerHTML = '<p style="color:var(--text2);text-align:center;padding:40px">Nenhuma alteração registrada ainda. As alterações aparecerão aqui após o próximo upload ou mudança de configuração.</p>';
          return;
        }
        const snapshots = [];
        snap.forEach(doc => snapshots.push({ id: doc.id, ...doc.data() }));
        const typeIcons = { upload: '📤', config_change: '⚙️', item_edit: '✏️', item_add: '✚', item_delete: '✖' };
        let html = '<div style="display:flex;flex-direction:column;gap:12px;padding:16px">';
        snapshots.forEach(s => {
          const ts = s.timestamp && s.timestamp.toDate ? s.timestamp.toDate() : new Date();
          const dateStr = ts.toLocaleDateString('pt-BR') + ' ' + ts.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          const icon = typeIcons[s.triggerType] || '🔄';
          const totalDelta = Object.values(s.vendorSnapshots || {}).reduce((sum, v) => sum + (v.delta || 0), 0);
          const deltaColor = totalDelta >= 0 ? 'var(--green,#4caf50)' : '#e53935';
          const deltaSign = totalDelta >= 0 ? '+' : '';
          const vendorRows = Object.values(s.vendorSnapshots || {}).map(v => {
            const dc = v.delta >= 0 ? 'var(--green,#4caf50)' : '#e53935';
            const ds = v.delta >= 0 ? '+' : '';
            return `<tr>
              <td style="padding:6px 12px">${v.name}</td>
              <td style="padding:6px 12px;text-align:right">R$ ${(v.totalAntes || 0).toFixed(2).replace('.', ',')}</td>
              <td style="padding:6px 12px;text-align:right">R$ ${(v.totalDepois || 0).toFixed(2).replace('.', ',')}</td>
              <td style="padding:6px 12px;text-align:right;color:${dc};font-weight:700">${ds}R$ ${Math.abs(v.delta || 0).toFixed(2).replace('.', ',')}</td>
            </tr>`;
          }).join('');
          const itemRows = (s.itemDeltas || []).map(d => {
            const ic = (d.impacto || 0) >= 0 ? 'var(--green,#4caf50)' : '#e53935';
            const is = (d.impacto || 0) >= 0 ? '+' : '';
            const changeLabel = { added: '✚ Adicionado', removed: '✖ Removido', modified: '≠ Alterado', p3_recalc: '🎯 P3' }[d.change] || d.change;
            const detail = d.change === 'modified' && d.antes ? ` (era R$ ${(d.antes.total || 0).toFixed(2).replace('.', ',')})` : '';
            return `<tr style="font-size:11px">
              <td style="padding:4px 12px;color:var(--text2)">${d.vendorName || ''}</td>
              <td style="padding:4px 12px">${changeLabel}</td>
              <td style="padding:4px 12px">${d.cliente || '—'}</td>
              <td style="padding:4px 12px">${d.item || '—'}${detail}</td>
              <td style="padding:4px 12px;text-align:right;color:${ic};font-weight:600">${is}R$ ${Math.abs(d.impacto || 0).toFixed(2).replace('.', ',')}</td>
            </tr>`;
          }).join('');
          html += `
            <div style="border:1px solid var(--border,#333);border-radius:8px;overflow:hidden">
              <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;background:var(--card,#1e1e1e)" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'':'none'">
                <span style="font-size:16px">${icon}</span>
                <div style="flex:1">
                  <div style="font-weight:600;font-size:13px">${s.triggerLabel || s.triggerType}</div>
                  <div style="font-size:11px;color:var(--text2)">${dateStr} · por ${(s.triggeredBy && s.triggeredBy.name) || 'Sistema'}</div>
                </div>
                <div style="font-weight:700;color:${deltaColor}">${deltaSign}R$ ${Math.abs(totalDelta).toFixed(2).replace('.', ',')}</div>
              </div>
              <div style="display:none;padding:16px;background:var(--bg,#121212)">
                ${vendorRows ? `<table style="width:100%;border-collapse:collapse;margin-bottom:${itemRows ? 16 : 0}px;font-size:12px">
                  <thead><tr style="border-bottom:1px solid var(--border,#333)">
                    <th style="padding:6px 12px;text-align:left">Vendedor</th>
                    <th style="padding:6px 12px;text-align:right">Antes</th>
                    <th style="padding:6px 12px;text-align:right">Depois</th>
                    <th style="padding:6px 12px;text-align:right">Diferença</th>
                  </tr></thead><tbody>${vendorRows}</tbody></table>` : ''}
                ${itemRows ? `<div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Lançamentos afetados</div>
                  <table style="width:100%;border-collapse:collapse">
                    <thead><tr style="border-bottom:1px solid var(--border,#333)">
                      <th style="padding:4px 12px;text-align:left">Vendedor</th>
                      <th style="padding:4px 12px;text-align:left">Tipo</th>
                      <th style="padding:4px 12px;text-align:left">Cliente</th>
                      <th style="padding:4px 12px;text-align:left">Plano</th>
                      <th style="padding:4px 12px;text-align:right">Impacto</th>
                    </tr></thead><tbody>${itemRows}</tbody></table>` : ''}
              </div>
            </div>`;
        });
        html += '</div>';
        el.innerHTML = html;
      } catch (e) {
        el.innerHTML = '<p style="color:#e53935;text-align:center;padding:40px">Erro ao carregar histórico.</p>';
        console.error('[Histórico Admin]', e);
      }
    }

```

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: admin Histórico tab with timeline and item deltas"
```

---

## Task 6: Adicionar aba "Histórico" na visão do vendedor

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Adicionar botão de aba no HTML estático (linha ~3186)**

Localizar:
```html
          <button class="tab-btn" onclick="switchVendorTab('vtabDiferidos',this)">⏳ Diferidos</button>
        </div>
```
Substituir por:
```html
          <button class="tab-btn" onclick="switchVendorTab('vtabDiferidos',this)">⏳ Diferidos</button>
          <button class="tab-btn" onclick="switchVendorTab('vtabHistorico',this)">📋 Histórico</button>
        </div>
```

- [ ] **Step 2: Adicionar div de conteúdo da aba no HTML estático (linha ~3199)**

Localizar:
```html
        <div id="vtabDiferidos" style="display:none">
          <div id="vendorDiferidosContent"></div>
        </div>
      </div>
```
Substituir por:
```html
        <div id="vtabDiferidos" style="display:none">
          <div id="vendorDiferidosContent"></div>
        </div>
        <div id="vtabHistorico" style="display:none">
          <div id="vendorHistoricoContent"></div>
        </div>
      </div>
```

- [ ] **Step 3: Registrar `vtabHistorico` no array de reset do `loadVendorPeriod`**

Localizar (linha ~6041):
```javascript
      ['vtabResumo','vtabComissoes','vtabAtivacoes','vtabDiferidos'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = id === 'vtabResumo' ? '' : 'none';
      });
```
Substituir por:
```javascript
      ['vtabResumo','vtabComissoes','vtabAtivacoes','vtabDiferidos','vtabHistorico'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = id === 'vtabResumo' ? '' : 'none';
      });
```

- [ ] **Step 4: Registrar `vtabHistorico` no array de `switchVendorTab`**

Localizar (linha ~6540):
```javascript
      ['vtabResumo','vtabComissoes','vtabAtivacoes','vtabDiferidos'].forEach(id => {
```
Substituir por:
```javascript
      ['vtabResumo','vtabComissoes','vtabAtivacoes','vtabDiferidos','vtabHistorico'].forEach(id => {
```

- [ ] **Step 5: Adicionar lazy load no `switchVendorTab`**

Localizar (linha ~6557):
```javascript
        else if (tabId === 'vtabDiferidos') renderVendorDiferidosTab(data, periodId, myName);
```
Substituir por:
```javascript
        else if (tabId === 'vtabDiferidos') renderVendorDiferidosTab(data, periodId, myName);
        else if (tabId === 'vtabHistorico') renderVendorHistoricoTab(periodId, myName);
```

- [ ] **Step 6: Adicionar função `renderVendorHistoricoTab()`**

Localizar:
```javascript
    // ═══════════════════════════════════════════════════════════════
    // VENDOR TABS SWITCHER
```
Inserir ANTES:
```javascript
    // ═══════════════════════════════════════════════════════════════
    // HISTÓRICO VENDEDOR TAB
    // ═══════════════════════════════════════════════════════════════
    async function renderVendorHistoricoTab(periodId, vendorName) {
      const el = document.getElementById('vendorHistoricoContent');
      if (!el) return;
      el.innerHTML = '<p style="color:var(--text2);text-align:center;padding:40px">Carregando histórico...</p>';
      try {
        const snap = await db.collection('periodos').doc(periodId).collection('historico')
          .orderBy('timestamp', 'desc').limit(50).get();
        const snapshots = [];
        snap.forEach(doc => snapshots.push({ id: doc.id, ...doc.data() }));
        const nameUpper = (vendorName || '').toUpperCase();
        const findMyEntry = (vendorSnapshots) => Object.entries(vendorSnapshots || {}).find(([k]) => k.toUpperCase() === nameUpper || k.toUpperCase().includes(nameUpper));
        const mySnapshots = snapshots.filter(s => !!findMyEntry(s.vendorSnapshots));
        if (mySnapshots.length === 0) {
          el.innerHTML = '<p style="color:var(--text2);text-align:center;padding:40px">Nenhuma alteração registrada para você este mês.</p>';
          return;
        }
        const oldest = [...mySnapshots].reverse()[0];
        const oldestEntry = findMyEntry(oldest.vendorSnapshots);
        const initialTotal = oldestEntry ? (oldestEntry[1].totalAntes || 0) : 0;
        const newestEntry = findMyEntry(mySnapshots[0].vendorSnapshots);
        const currentTotal = newestEntry ? (newestEntry[1].totalDepois || 0) : 0;
        const totalVariation = currentTotal - initialTotal;
        const triggerLabels = { upload: 'Atualização de base', config_change: 'Ajuste de configuração', item_edit: 'Correção de lançamento', item_add: 'Lançamento adicionado', item_delete: 'Lançamento removido' };
        const headerColor = totalVariation >= 0 ? 'var(--green,#4caf50)' : '#e53935';
        const headerSign = totalVariation >= 0 ? '+' : '';
        let html = `<div style="background:var(--card,#1e1e1e);border-radius:8px;padding:16px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:1px">Variação no mês</div>
            <div style="font-size:20px;font-weight:700;margin-top:4px;color:${headerColor}">${headerSign}R$ ${Math.abs(totalVariation).toFixed(2).replace('.', ',')}</div>
          </div>
          <div style="text-align:right;font-size:12px;color:var(--text2)">
            <div>Início: R$ ${initialTotal.toFixed(2).replace('.', ',')}</div>
            <div>Atual: R$ ${currentTotal.toFixed(2).replace('.', ',')}</div>
          </div>
        </div><div style="display:flex;flex-direction:column;gap:8px">`;
        mySnapshots.forEach(s => {
          const ts = s.timestamp && s.timestamp.toDate ? s.timestamp.toDate() : new Date();
          const dateStr = ts.toLocaleDateString('pt-BR') + ' ' + ts.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          const myEntry = findMyEntry(s.vendorSnapshots);
          if (!myEntry) return;
          const myDelta = myEntry[1].delta || 0;
          const dc = myDelta >= 0 ? 'var(--green,#4caf50)' : '#e53935';
          const ds = myDelta >= 0 ? '+' : '';
          const label = triggerLabels[s.triggerType] || s.triggerLabel || s.triggerType;
          const myItems = (s.itemDeltas || []).filter(d => (d.vendorId || '').toUpperCase() === nameUpper || (d.vendorId || '').toUpperCase().includes(nameUpper));
          const itemRows = myItems.map(d => {
            const ic = (d.impacto || 0) >= 0 ? 'var(--green,#4caf50)' : '#e53935';
            const is = (d.impacto || 0) >= 0 ? '+' : '';
            const changeIcon = { added: '✚', removed: '✖', modified: '≠', p3_recalc: '🎯' }[d.change] || '•';
            const detail = d.change === 'modified' && d.antes ? ` (era R$ ${(d.antes.total || 0).toFixed(2).replace('.', ',')})` : '';
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border,#333);font-size:11px">
              <span style="color:var(--text2)">${changeIcon} ${d.cliente || '—'} · ${d.item || '—'}${detail}</span>
              <span style="color:${ic};font-weight:600;white-space:nowrap;margin-left:8px">${is}R$ ${Math.abs(d.impacto || 0).toFixed(2).replace('.', ',')}</span>
            </div>`;
          }).join('');
          html += `<div style="border:1px solid var(--border,#333);border-radius:8px;overflow:hidden">
            <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'':'none'">
              <div style="flex:1">
                <div style="font-weight:600;font-size:13px">${label}</div>
                <div style="font-size:11px;color:var(--text2)">${dateStr}</div>
              </div>
              <div style="font-weight:700;color:${dc}">${ds}R$ ${Math.abs(myDelta).toFixed(2).replace('.', ',')}</div>
            </div>
            ${myItems.length > 0 ? `<div style="display:none;padding:12px 16px;background:var(--bg,#121212)">${itemRows}</div>` : '<div style="display:none"></div>'}
          </div>`;
        });
        html += '</div>';
        el.innerHTML = html;
      } catch (e) {
        el.innerHTML = '<p style="color:#e53935;text-align:center;padding:40px">Erro ao carregar histórico.</p>';
        console.error('[Histórico Vendedor]', e);
      }
    }

```

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: vendor Histórico tab with personal commission timeline"
```

---

## Task 7: Push para GitHub

- [ ] **Step 1: Verificar status final**

```bash
git log --oneline -8
git status
```
Expected: branch `claude/infallible-engelbart`, working tree clean.

- [ ] **Step 2: Push da branch**

```bash
git push -u origin claude/infallible-engelbart
```

- [ ] **Step 3: Criar Pull Request**

```bash
gh pr create \
  --title "feat: histórico de alterações de comissões" \
  --body "## Resumo

- Salva snapshot de comissões por vendedor a cada recálculo (upload, config, edição de item)
- Admin vê aba 'Histórico' no período com timeline de eventos, antes/depois por vendedor e lançamentos afetados
- Vendedor vê aba 'Histórico' no painel pessoal com variação do mês e detalhes de cada alteração
- Snapshots salvos na subcoleção \`periodos/{id}/historico/\` no Firestore
- Zero mudanças na lógica de cálculo (CommissionEngine intocado)

## Como testar
- Fazer um upload de arquivo e abrir aba Histórico no período → deve aparecer evento com deltas
- Alterar uma configuração e recalcular → novo evento aparece com motivo 'Configuração alterada'
- Vendedor abre aba Histórico → vê apenas os próprios dados com variação total do mês

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```
