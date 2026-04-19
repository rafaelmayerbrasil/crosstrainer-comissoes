# Upload Sync, Histórico Enriquecido e Exportação Excel — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir itens "fantasmas" no Firestore após re-upload, enriquecer snapshots do histórico com estado completo dos itens ativos, e adicionar exportação Excel + modal de diff para o histórico.

**Architecture:** Todas as mudanças estão em `index.html`. (1) `confirmUpload()` deleta fisicamente itens removidos antes de salvar o snapshot. (2) `saveHistoricoSnapshot()` recebe e armazena `activeSnapshot` para uploads. (3) Nova função `exportHistoricoXLS()` usa SheetJS para gerar arquivo com duas abas. (4) Novo modal fullscreen mostra diff detalhado ao clicar no nome do arquivo no histórico.

**Tech Stack:** Vanilla JS, Firebase Firestore (batch writes/deletes), SheetJS (XLSX já presente), HTML/CSS inline

**Repo:** `C:\Users\ra058347\OneDrive - intelbras.com.br\Documentos\GitHub\crosstrainer-comissoes`

---

## Mapa de Arquivos

| Arquivo | Mudança |
|---|---|
| `index.html` | Modificar `confirmUpload()` (linha ~4681), `saveHistoricoSnapshot()` (linha ~5263), `renderHistoricoTab()` (linha ~7184), adicionar `exportHistoricoXLS()` (após linha ~10396), adicionar modal HTML (antes da linha 10431) |
| `docs/technical-documentation.md` | Criar (novo) |

---

## Task 1: Batch Delete de Itens Removidos em `confirmUpload()`

**Files:**
- Modify: `index.html:4681-4694`

- [ ] **Step 1: Localizar o ponto de inserção**

Abrir `index.html`. Verificar que a linha 4681 termina o `forEach` que detecta itens removidos:
```javascript
        });
        // linha 4682: let afterVendorSummaryUpload = periodData.vendorSummary || {};
```

- [ ] **Step 2: Inserir o batch delete após a linha 4681**

Substituir o bloco das linhas 4681-4694 (do final do forEach até o fim da chamada de `saveHistoricoSnapshot`) por:

```javascript
        });

        // ── BATCH DELETE: remover do Firestore itens que saíram do arquivo ──
        const removedStableIds = Object.keys(existingProcessedData).filter(id => !newUploadIds.has(id));
        if (removedStableIds.length > 0) {
          console.log(`[confirmUpload] Deletando ${removedStableIds.length} itens removidos do período...`);
          for (let i = 0; i < removedStableIds.length; i += 400) {
            const delBatch = db.batch();
            removedStableIds.slice(i, i + 400).forEach(stableId => {
              delBatch.delete(itemsRef.doc(stableId));
            });
            await delBatch.commit();
          }
          console.log(`[confirmUpload] ${removedStableIds.length} itens removidos deletados do Firestore.`);
        }

        let afterVendorSummaryUpload = periodData.vendorSummary || {};
        try {
          const freshPeriodSnap = await db.collection('periodos').doc(periodId).get();
          if (freshPeriodSnap.exists) afterVendorSummaryUpload = freshPeriodSnap.data().vendorSummary || {};
        } catch (_e) {}
        await saveHistoricoSnapshot(
          periodId,
          { type: 'upload', label: `Upload: ${fileName}` },
          beforeVendorSummaryUpload,
          afterVendorSummaryUpload,
          { precomputedItemDeltas: uploadItemDeltas }
        );
```

- [ ] **Step 3: Verificar visualmente a mudança**

Confirmar que o código após a edição está correto: o `forEach` fecha na linha certa, o batch delete usa `itemsRef` (definido na linha 4603), e `removedStableIds` usa `existingProcessedData` e `newUploadIds` que já existem no escopo.

- [ ] **Step 4: Teste manual**

Abrir a aplicação no browser. Selecionar um período que já tenha lançamentos. Fazer upload de um arquivo menor (que não contenha alguns dos lançamentos existentes).

Verificar no Firebase Console (`periodos/{id}/itens`) que os itens ausentes no novo arquivo foram fisicamente deletados.

Verificar que o dashboard/totais do período refletem o novo arquivo.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "fix: deletar fisicamente itens removidos no re-upload do período"
```

---

## Task 2: Campo `activeSnapshot` no Histórico

**Files:**
- Modify: `index.html:4688-4694` (chamada de saveHistoricoSnapshot em confirmUpload)
- Modify: `index.html:5263` (assinatura de saveHistoricoSnapshot)
- Modify: `index.html:5307-5317` (objeto snapshot)

- [ ] **Step 1: Adicionar coleta de `activeItemsForSnapshot` em `confirmUpload()`**

Imediatamente ANTES da linha que começa com `let afterVendorSummaryUpload` (linha ~4682), APÓS o bloco de batch delete adicionado na Task 1, inserir:

```javascript
        // ── ACTIVE SNAPSHOT: foto compacta dos itens ativos para o histórico ──
        const activeItemsForSnapshot = allItems
          .filter(d => d.type === 'processed')
          .map(d => ({
            vendedor: d.vendedor || '',
            cliente: d.cliente || '',
            item: d.item || '',
            data: d.data || '',
            categoria: d.category || '',
            label: d.label || '',
            valorCaixa: d.valorCaixa || 0,
            p1valor: d.p1valor || 0,
            p2bonus: d.p2bonus || 0,
            total: Math.round(((d.p1valor || 0) + (d.p2bonus || 0)) * 100) / 100
          }));
```

- [ ] **Step 2: Atualizar a chamada de `saveHistoricoSnapshot` em `confirmUpload()`**

Substituir o bloco de chamada existente:
```javascript
        await saveHistoricoSnapshot(
          periodId,
          { type: 'upload', label: `Upload: ${fileName}` },
          beforeVendorSummaryUpload,
          afterVendorSummaryUpload,
          { precomputedItemDeltas: uploadItemDeltas }
        );
```

Por:
```javascript
        await saveHistoricoSnapshot(
          periodId,
          { type: 'upload', label: `Upload: ${fileName}` },
          beforeVendorSummaryUpload,
          afterVendorSummaryUpload,
          { precomputedItemDeltas: uploadItemDeltas, activeItems: activeItemsForSnapshot }
        );
```

- [ ] **Step 3: Atualizar assinatura de `saveHistoricoSnapshot` (linha ~5263)**

Substituir:
```javascript
    async function saveHistoricoSnapshot(periodId, triggerContext, beforeVendorSummary, afterVendorSummary, { beforeItemValues, processedItems, precomputedItemDeltas } = {}) {
```

Por:
```javascript
    async function saveHistoricoSnapshot(periodId, triggerContext, beforeVendorSummary, afterVendorSummary, { beforeItemValues, processedItems, precomputedItemDeltas, activeItems } = {}) {
```

- [ ] **Step 4: Adicionar `activeSnapshot` ao objeto snapshot (linha ~5307-5317)**

Substituir:
```javascript
        const snapshot = {
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
          triggerType: triggerContext.type,
          triggerLabel: triggerContext.label,
          triggeredBy: {
            uid: currentUser ? currentUser.uid : '',
            name: userProfile?.name || currentUser?.email?.split('@')[0] || 'Sistema'
          },
          vendorSnapshots,
          itemDeltas
        };
```

Por:
```javascript
        const snapshot = {
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
          triggerType: triggerContext.type,
          triggerLabel: triggerContext.label,
          triggeredBy: {
            uid: currentUser ? currentUser.uid : '',
            name: userProfile?.name || currentUser?.email?.split('@')[0] || 'Sistema'
          },
          vendorSnapshots,
          itemDeltas,
          ...(triggerContext.type === 'upload' && activeItems && activeItems.length > 0
            ? { activeSnapshot: activeItems }
            : {})
        };
```

- [ ] **Step 5: Verificar no Firebase Console**

Fazer um upload de teste. Abrir o Firebase Console → `periodos/{id}/historico` → verificar que o documento mais recente possui o campo `activeSnapshot` com a lista compacta de itens.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: salvar activeSnapshot no histórico de uploads para viabilizar exportação"
```

---

## Task 3: Função `exportHistoricoXLS` + Botão no Histórico

**Files:**
- Modify: `index.html:10396` (adicionar função após exportPeriodToExcel)
- Modify: `index.html:7195-7260` (modificar renderHistoricoTab)

- [ ] **Step 1: Adicionar a função `exportHistoricoXLS` após `exportPeriodToExcel`**

A função `exportPeriodToExcel` termina com `}` por volta da linha 10396. Logo após essa chave de fechamento, inserir:

```javascript
    function exportHistoricoXLS(snapshotData) {
      try {
        if (!snapshotData) return toast('Dados do snapshot não disponíveis. Recarregue o histórico.', 'error');
        const { triggerLabel, timestamp, itemDeltas, activeSnapshot } = snapshotData;

        const sourceName = (triggerLabel || 'historico')
          .replace(/^Upload:\s*/i, '')
          .replace(/\s+/g, '_')
          .replace(/[^a-zA-Z0-9_\-\.]/g, '');
        const dateStr = timestamp && timestamp.toDate
          ? timestamp.toDate().toLocaleDateString('pt-BR').replace(/\//g, '-')
          : new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
        const fileName = `historico_${sourceName}_${dateStr}.xlsx`;

        // --- Aba "Alterações" ---
        const added   = (itemDeltas || []).filter(d => d.change === 'added');
        const removed = (itemDeltas || []).filter(d => d.change === 'removed');
        const modified = (itemDeltas || []).filter(d => d.change === 'modified');
        const totalAdded    = added.reduce((s, d) => s + Math.abs(d.impacto || 0), 0);
        const totalRemoved  = removed.reduce((s, d) => s + Math.abs(d.impacto || 0), 0);
        const totalModified = modified.reduce((s, d) => s + (d.impacto || 0), 0);
        const totalLiq = totalAdded - totalRemoved + totalModified;

        const altRows = [
          ['RESUMO', '', '', '', ''],
          ['Total Adicionado', '', '', '', totalAdded],
          ['Total Removido', '', '', '', -totalRemoved],
          ['Itens Alterados (líquido)', '', '', '', totalModified],
          ['Impacto Líquido', '', '', '', totalLiq],
          ['Itens Afetados', '', '', '', (itemDeltas || []).length],
          [],
          ['Vendedor', 'Tipo', 'Cliente', 'Plano / Item', 'Impacto R$'],
          ...added.map(d => [d.vendorName || '', 'Adicionado', d.cliente || '', d.item || '', Math.abs(d.impacto || 0)]),
          ...removed.map(d => [d.vendorName || '', 'Removido', d.cliente || '', d.item || '', -(Math.abs(d.impacto || 0))]),
          ...modified.map(d => [d.vendorName || '', 'Alterado', d.cliente || '', d.item || '', d.impacto || 0]),
        ];
        const wsAlt = XLSX.utils.aoa_to_sheet(altRows);

        // --- Aba "Snapshot" ---
        const snapItems = [...(activeSnapshot || [])].sort((a, b) => {
          if (a.vendedor < b.vendedor) return -1;
          if (a.vendedor > b.vendedor) return 1;
          return (a.data || '').localeCompare(b.data || '');
        });

        const snapRows = [['Vendedor', 'Cliente', 'Plano / Item', 'Data', 'Categoria', 'Valor Caixa', 'P1 R$', 'P2 R$', 'Total']];
        let lastVendor = null, vP1 = 0, vP2 = 0, vTotal = 0, gP1 = 0, gP2 = 0, gTotal = 0;
        snapItems.forEach(item => {
          if (lastVendor !== null && item.vendedor !== lastVendor) {
            snapRows.push(['', `Subtotal ${lastVendor}`, '', '', '', '', vP1, vP2, vTotal]);
            snapRows.push([]);
            vP1 = 0; vP2 = 0; vTotal = 0;
          }
          lastVendor = item.vendedor;
          vP1 += item.p1valor || 0; vP2 += item.p2bonus || 0; vTotal += item.total || 0;
          gP1 += item.p1valor || 0; gP2 += item.p2bonus || 0; gTotal += item.total || 0;
          snapRows.push([
            item.vendedor || '', item.cliente || '', item.item || '', item.data || '',
            item.label || item.categoria || '', item.valorCaixa || 0,
            item.p1valor || 0, item.p2bonus || 0, item.total || 0
          ]);
        });
        if (lastVendor !== null) snapRows.push(['', `Subtotal ${lastVendor}`, '', '', '', '', vP1, vP2, vTotal]);
        snapRows.push([]);
        snapRows.push(['TOTAL GERAL', '', '', '', '', '', gP1, gP2, gTotal]);
        const wsSnap = XLSX.utils.aoa_to_sheet(snapRows);

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, wsAlt, 'Alterações');
        XLSX.utils.book_append_sheet(wb, wsSnap, 'Snapshot');
        XLSX.writeFile(wb, fileName);
        toast('Exportação concluída!', 'success');
      } catch (e) {
        console.error('[exportHistoricoXLS]', e);
        toast('Erro ao exportar histórico: ' + e.message, 'error');
      }
    }
```

- [ ] **Step 2: Modificar `renderHistoricoTab` para cache e botão de exportação**

Localizar a linha 7195 em `renderHistoricoTab`:
```javascript
        const snapshots = [];
        snap.forEach(doc => snapshots.push({ id: doc.id, ...doc.data() }));
```

Substituir por (adiciona cache global):
```javascript
        const snapshots = [];
        window._historicoCache = window._historicoCache || {};
        snap.forEach(doc => {
          const s = { id: doc.id, ...doc.data() };
          snapshots.push(s);
          window._historicoCache[doc.id] = s;
        });
```

- [ ] **Step 3: Modificar o header do card para entradas de upload**

Localizar o bloco do header do card (linha ~7229-7238):
```javascript
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
```

Substituir por:
```javascript
          const isUpload = s.triggerType === 'upload';
          const labelHtml = isUpload
            ? `<span style="cursor:pointer;color:var(--orange,#e59f3e);text-decoration:underline" onclick="event.stopPropagation();openHistoricoDiffModal('${s.id}')">${s.triggerLabel || s.triggerType}</span>`
            : (s.triggerLabel || s.triggerType);
          const exportBtn = isUpload
            ? `<button onclick="event.stopPropagation();exportHistoricoXLS(window._historicoCache['${s.id}'])" style="padding:4px 10px;font-size:11px;background:var(--surface,#2a2a2a);border:1px solid var(--border,#444);border-radius:4px;color:var(--text,#eee);cursor:pointer;white-space:nowrap">⬇ XLS</button>`
            : '';
          html += `
            <div style="border:1px solid var(--border,#333);border-radius:8px;overflow:hidden">
              <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;background:var(--card,#1e1e1e)" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'':'none'">
                <span style="font-size:16px">${icon}</span>
                <div style="flex:1">
                  <div style="font-weight:600;font-size:13px">${labelHtml}</div>
                  <div style="font-size:11px;color:var(--text2)">${dateStr} · por ${(s.triggeredBy && s.triggeredBy.name) || 'Sistema'}</div>
                </div>
                ${exportBtn}
                <div style="font-weight:700;color:${deltaColor}">${deltaSign}R$ ${Math.abs(totalDelta).toFixed(2).replace('.', ',')}</div>
              </div>
```

- [ ] **Step 4: Verificar que a aba Histórico mostra o botão XLS**

Abrir o app, ir à aba Histórico. Verificar que cada entrada de upload mostra o botão "⬇ XLS" e que o nome do arquivo ficou sublinhado/laranja (clicável).

Clicar no botão XLS de um upload. Verificar que baixa um `.xlsx` com as abas "Alterações" e "Snapshot".

Se `activeSnapshot` não existir num snapshot antigo, a aba "Snapshot" estará vazia — isso é esperado. Novos uploads terão o campo.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: exportar histórico de upload para XLS com abas Alterações e Snapshot"
```

---

## Task 4: Modal de Diff do Histórico

**Files:**
- Modify: `index.html:10431` (adicionar HTML do modal antes de `</body>`)
- Modify: `index.html` (adicionar funções JS do modal após `exportHistoricoXLS`)

- [ ] **Step 1: Adicionar HTML do modal antes de `</body>` (linha 10431)**

Imediatamente antes de `</body>` (linha 10431), inserir:

```html
    <!-- ═══ MODAL: DIFF HISTÓRICO ═══ -->
    <div id="historicoDiffModal" class="modal" style="align-items:flex-start;padding:16px;overflow-y:auto">
      <div class="modal-content" style="max-width:1100px;width:100%;max-height:calc(100vh - 32px);overflow-y:auto;padding:0;border-radius:10px">
        <!-- Header -->
        <div style="display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--border,#333);position:sticky;top:0;background:var(--surface,#1e1e1e);z-index:10;border-radius:10px 10px 0 0">
          <span style="font-size:18px">📤</span>
          <div style="flex:1;min-width:0">
            <div id="hdmFilename" style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
            <div id="hdmMeta" style="font-size:11px;color:var(--text2)"></div>
          </div>
          <button onclick="exportHistoricoXLS(window._currentDiffSnapshot)" style="padding:6px 12px;font-size:12px;background:var(--surface,#2a2a2a);border:1px solid var(--border,#444);border-radius:6px;color:var(--text,#eee);cursor:pointer;white-space:nowrap">⬇ Exportar XLS</button>
          <button onclick="closeHistoricoDiffModal()" style="padding:6px 10px;font-size:14px;background:transparent;border:1px solid var(--border,#444);border-radius:6px;color:var(--text2);cursor:pointer;line-height:1">✕</button>
        </div>
        <!-- Cards de Resumo -->
        <div id="hdmCards" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px 20px;background:var(--bg,#121212)"></div>
        <!-- Filtros -->
        <div style="padding:0 20px 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:var(--bg,#121212)">
          <select id="hdmFilterType" onchange="renderHDMTable()" style="padding:6px 10px;font-size:12px;background:var(--surface,#1e1e1e);border:1px solid var(--border,#444);border-radius:6px;color:var(--text,#eee)">
            <option value="">Todos os tipos</option>
            <option value="added">✅ Adicionados</option>
            <option value="removed">❌ Removidos</option>
            <option value="modified">✏️ Alterados</option>
          </select>
          <select id="hdmFilterVendor" onchange="renderHDMTable()" style="padding:6px 10px;font-size:12px;background:var(--surface,#1e1e1e);border:1px solid var(--border,#444);border-radius:6px;color:var(--text,#eee)"></select>
          <input id="hdmSearch" oninput="renderHDMTable()" placeholder="🔍 Buscar por cliente..." style="padding:6px 10px;font-size:12px;background:var(--surface,#1e1e1e);border:1px solid var(--border,#444);border-radius:6px;color:var(--text,#eee);flex:1;min-width:160px">
        </div>
        <!-- Tabela de Deltas -->
        <div id="hdmTable" style="padding:0 20px 16px;background:var(--bg,#121212)"></div>
        <!-- Seção Snapshot -->
        <div style="border-top:1px solid var(--border,#333);background:var(--bg,#121212);border-radius:0 0 10px 10px">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px">
            <span id="hdmSnapshotCount" style="font-size:12px;color:var(--text2)"></span>
            <button id="hdmSnapshotBtn" onclick="toggleHDMSnapshot()" style="padding:6px 12px;font-size:12px;background:var(--surface,#1e1e1e);border:1px solid var(--border,#444);border-radius:6px;color:var(--text,#eee);cursor:pointer">Ver Snapshot completo</button>
          </div>
          <div id="hdmSnapshotTable" style="display:none;padding:0 20px 16px;overflow-x:auto"></div>
        </div>
      </div>
    </div>
```

- [ ] **Step 2: Adicionar funções JS do modal**

Logo após a função `exportHistoricoXLS` adicionada na Task 3, inserir:

```javascript
    function openHistoricoDiffModal(snapshotId) {
      const s = window._historicoCache && window._historicoCache[snapshotId];
      if (!s) return toast('Dados do histórico não encontrados. Recarregue a aba.', 'error');
      window._currentDiffSnapshot = s;

      // Header
      document.getElementById('hdmFilename').textContent = s.triggerLabel || '';
      const ts = s.timestamp && s.timestamp.toDate ? s.timestamp.toDate() : new Date();
      document.getElementById('hdmMeta').textContent =
        ts.toLocaleDateString('pt-BR') + ' ' + ts.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) +
        ' · por ' + ((s.triggeredBy && s.triggeredBy.name) || 'Sistema');

      // Cards de resumo
      const deltas  = s.itemDeltas || [];
      const added   = deltas.filter(d => d.change === 'added');
      const removed = deltas.filter(d => d.change === 'removed');
      const modified = deltas.filter(d => d.change === 'modified');
      const totAdd  = added.reduce((acc, d) => acc + Math.abs(d.impacto || 0), 0);
      const totRem  = removed.reduce((acc, d) => acc + Math.abs(d.impacto || 0), 0);
      const totMod  = modified.reduce((acc, d) => acc + (d.impacto || 0), 0);
      const liq = totAdd - totRem + totMod;
      document.getElementById('hdmCards').innerHTML = `
        <div style="background:var(--surface,#1e1e1e);border:1px solid var(--border,#333);border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:11px;color:var(--text2);margin-bottom:6px">Adicionados</div>
          <div style="font-size:22px;font-weight:700;color:#4caf50">+R$ ${totAdd.toFixed(2).replace('.',',')}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:4px">${added.length} itens</div>
        </div>
        <div style="background:var(--surface,#1e1e1e);border:1px solid var(--border,#333);border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:11px;color:var(--text2);margin-bottom:6px">Removidos</div>
          <div style="font-size:22px;font-weight:700;color:#e53935">-R$ ${totRem.toFixed(2).replace('.',',')}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:4px">${removed.length} itens</div>
        </div>
        <div style="background:var(--surface,#1e1e1e);border:1px solid var(--border,#333);border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:11px;color:var(--text2);margin-bottom:6px">Alterados</div>
          <div style="font-size:22px;font-weight:700;color:#ff9800">±R$ ${Math.abs(totMod).toFixed(2).replace('.',',')}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:4px">${modified.length} itens</div>
        </div>
        <div style="background:var(--surface,#1e1e1e);border:1px solid var(--border,#333);border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:11px;color:var(--text2);margin-bottom:6px">Impacto Líquido</div>
          <div style="font-size:22px;font-weight:700;color:${liq >= 0 ? '#4caf50' : '#e53935'}">${liq >= 0 ? '+' : ''}R$ ${liq.toFixed(2).replace('.',',')}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:4px">${deltas.length} itens afetados</div>
        </div>`;

      // Filtro de vendedor
      const vendors = [...new Set(deltas.map(d => d.vendorName).filter(Boolean))].sort();
      document.getElementById('hdmFilterVendor').innerHTML =
        '<option value="">Todos os vendedores</option>' +
        vendors.map(v => `<option value="${v}">${v}</option>`).join('');

      // Snapshot count
      const snapCount = (s.activeSnapshot || []).length;
      document.getElementById('hdmSnapshotCount').textContent =
        snapCount > 0 ? `${snapCount} itens ativos após este upload` : 'Snapshot não disponível (upload anterior à feature)';
      document.getElementById('hdmSnapshotTable').style.display = 'none';
      document.getElementById('hdmSnapshotBtn').textContent = 'Ver Snapshot completo';
      document.getElementById('hdmSnapshotBtn').style.display = snapCount > 0 ? '' : 'none';

      // Reset filtros
      document.getElementById('hdmFilterType').value = '';
      document.getElementById('hdmFilterVendor').value = '';
      document.getElementById('hdmSearch').value = '';

      renderHDMTable();
      document.getElementById('historicoDiffModal').classList.add('open');
    }

    function closeHistoricoDiffModal() {
      document.getElementById('historicoDiffModal').classList.remove('open');
      window._currentDiffSnapshot = null;
    }

    function renderHDMTable() {
      const s = window._currentDiffSnapshot;
      if (!s) return;
      const filterType   = document.getElementById('hdmFilterType').value;
      const filterVendor = document.getElementById('hdmFilterVendor').value;
      const search = (document.getElementById('hdmSearch').value || '').toLowerCase();
      const order = { added: 0, removed: 1, modified: 2 };

      const deltas = (s.itemDeltas || [])
        .filter(d => {
          if (filterType && d.change !== filterType) return false;
          if (filterVendor && d.vendorName !== filterVendor) return false;
          if (search && !(d.cliente || '').toLowerCase().includes(search)) return false;
          return true;
        })
        .sort((a, b) => {
          if ((a.vendorName || '') < (b.vendorName || '')) return -1;
          if ((a.vendorName || '') > (b.vendorName || '')) return 1;
          return (order[a.change] || 0) - (order[b.change] || 0);
        });

      const changeLabel = { added: '✅ Adicionado', removed: '❌ Removido', modified: '✏️ Alterado' };
      const changeColor = { added: '#4caf50', removed: '#e53935', modified: '#ff9800' };

      const rows = deltas.map(d => `
        <tr style="border-bottom:1px solid var(--border,#2a2a2a)">
          <td style="padding:6px 10px;font-size:12px">${d.vendorName || ''}</td>
          <td style="padding:6px 10px;font-size:12px;color:${changeColor[d.change] || '#eee'}">${changeLabel[d.change] || d.change}</td>
          <td style="padding:6px 10px;font-size:12px">${d.cliente || '—'}</td>
          <td style="padding:6px 10px;font-size:12px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.item || '—'}</td>
          <td style="padding:6px 10px;font-size:12px;text-align:right;font-weight:700;color:${(d.impacto || 0) >= 0 ? '#4caf50' : '#e53935'}">${(d.impacto || 0) >= 0 ? '+' : ''}R$ ${Math.abs(d.impacto || 0).toFixed(2).replace('.',',')}</td>
        </tr>`).join('');

      document.getElementById('hdmTable').innerHTML = rows.length
        ? `<table style="width:100%;border-collapse:collapse">
            <thead><tr style="border-bottom:2px solid var(--border,#333)">
              <th style="padding:6px 10px;text-align:left;font-size:11px;color:var(--text2)">Vendedor</th>
              <th style="padding:6px 10px;text-align:left;font-size:11px;color:var(--text2)">Tipo</th>
              <th style="padding:6px 10px;text-align:left;font-size:11px;color:var(--text2)">Cliente</th>
              <th style="padding:6px 10px;text-align:left;font-size:11px;color:var(--text2)">Plano / Item</th>
              <th style="padding:6px 10px;text-align:right;font-size:11px;color:var(--text2)">Impacto</th>
            </tr></thead><tbody>${rows}</tbody>
           </table>`
        : `<div style="padding:24px;text-align:center;color:var(--text2);font-size:13px">Nenhum item encontrado para os filtros selecionados.</div>`;
    }

    function toggleHDMSnapshot() {
      const s = window._currentDiffSnapshot;
      if (!s) return;
      const tableEl = document.getElementById('hdmSnapshotTable');
      const btnEl   = document.getElementById('hdmSnapshotBtn');
      if (tableEl.style.display !== 'none') {
        tableEl.style.display = 'none';
        btnEl.textContent = 'Ver Snapshot completo';
        return;
      }
      const items = [...(s.activeSnapshot || [])].sort((a, b) => {
        if ((a.vendedor || '') < (b.vendedor || '')) return -1;
        if ((a.vendedor || '') > (b.vendedor || '')) return 1;
        return (a.data || '').localeCompare(b.data || '');
      });
      const rows = items.map(item => `
        <tr style="border-bottom:1px solid var(--border,#2a2a2a)">
          <td style="padding:4px 8px;font-size:11px">${item.vendedor || ''}</td>
          <td style="padding:4px 8px;font-size:11px">${item.cliente || ''}</td>
          <td style="padding:4px 8px;font-size:11px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.item || ''}</td>
          <td style="padding:4px 8px;font-size:11px">${item.data || ''}</td>
          <td style="padding:4px 8px;font-size:11px">${item.label || item.categoria || ''}</td>
          <td style="padding:4px 8px;font-size:11px;text-align:right">R$ ${(item.valorCaixa || 0).toFixed(2).replace('.',',')}</td>
          <td style="padding:4px 8px;font-size:11px;text-align:right">R$ ${(item.p1valor || 0).toFixed(2).replace('.',',')}</td>
          <td style="padding:4px 8px;font-size:11px;text-align:right">R$ ${(item.p2bonus || 0).toFixed(2).replace('.',',')}</td>
          <td style="padding:4px 8px;font-size:11px;text-align:right;font-weight:700">R$ ${(item.total || 0).toFixed(2).replace('.',',')}</td>
        </tr>`).join('');
      tableEl.innerHTML = `<table style="width:100%;border-collapse:collapse;min-width:700px">
        <thead><tr style="border-bottom:2px solid var(--border,#333)">
          <th style="padding:4px 8px;text-align:left;font-size:10px;color:var(--text2)">Vendedor</th>
          <th style="padding:4px 8px;text-align:left;font-size:10px;color:var(--text2)">Cliente</th>
          <th style="padding:4px 8px;text-align:left;font-size:10px;color:var(--text2)">Plano / Item</th>
          <th style="padding:4px 8px;text-align:left;font-size:10px;color:var(--text2)">Data</th>
          <th style="padding:4px 8px;text-align:left;font-size:10px;color:var(--text2)">Categoria</th>
          <th style="padding:4px 8px;text-align:right;font-size:10px;color:var(--text2)">Vlr Caixa</th>
          <th style="padding:4px 8px;text-align:right;font-size:10px;color:var(--text2)">P1 R$</th>
          <th style="padding:4px 8px;text-align:right;font-size:10px;color:var(--text2)">P2 R$</th>
          <th style="padding:4px 8px;text-align:right;font-size:10px;color:var(--text2)">Total</th>
        </tr></thead><tbody>${rows}</tbody>
       </table>`;
      tableEl.style.display = '';
      btnEl.textContent = 'Ocultar Snapshot';
    }
```

- [ ] **Step 3: Verificar modal**

Abrir o app → aba Histórico → clicar no nome de um arquivo de upload (texto sublinhado/laranja).

Verificar que o modal abre, mostra os 4 cards de resumo, a tabela de itens, os filtros funcionam, e o botão "Ver Snapshot completo" expande a segunda tabela.

Verificar que o botão "✕" fecha o modal.

Verificar que "Exportar XLS" no modal também funciona.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: modal de diff detalhado para entradas de upload no histórico"
```

---

## Task 5: Documentação Técnica do Projeto

**Files:**
- Create: `docs/technical-documentation.md`

- [ ] **Step 1: Criar o arquivo de documentação técnica**

Criar `docs/technical-documentation.md` com o conteúdo definido no Step 2.

- [ ] **Step 2: Conteúdo inicial**

```markdown
# CrossTrainer Comissões — Documentação Técnica

> Mantida automaticamente. Atualizar após cada mudança significativa na arquitetura ou comportamento do sistema.

**Última atualização:** 2026-04-19

---

## Visão Geral

Aplicação web single-page (SPA) em HTML/CSS/JS vanilla para gestão de comissões de vendedores em unidades CrossFit. Os dados são armazenados no Firebase Firestore e autenticados via Firebase Auth.

**Tecnologias:**
- Frontend: HTML + CSS inline + Vanilla JS (arquivo único `index.html`)
- Backend/DB: Firebase Firestore (NoSQL)
- Auth: Firebase Authentication
- Exportação: SheetJS (XLSX)
- Engine de comissões: `commission.js` (importado por `index.html`)

---

## Estrutura de Coleções Firestore

```
users/{uid}
  name, email, role (admin|vendedor), allowedUnits[]

units/{unitId}
  name, config (taxas de comissão, planos de ativação, metas mensais)

periodos/{periodId}
  unitId, year, month
  uploadId         — ID único do upload mais recente
  fileName         — Nome do arquivo Excel
  vendorSummary    — Totais por vendedor (cache, atualizado por recalculatePeriod)
  totals           — Totais gerais do período
  p4result         — Resultado vouchers/pool
  metasMensais     — Overrides de config para o mês

periodos/{periodId}/itens/{stableId}
  Documentos de lançamentos individuais.
  ID = stableId (hash de vendedor|cliente|data|item|valorCaixa)
  type: "processed" | "excluded" | "deferred"
  uploadId, vendedor, cliente, item, data, valorCaixa
  p1valor, p1pct, p2bonus, category, label, isActivation

periodos/{periodId}/historico/{snapshotId}
  Snapshots de mudanças. Gerado automaticamente após uploads,
  edições manuais e mudanças de config.
  triggerType: "upload" | "config_change" | "item_edit" | "item_add" | "item_delete"
  triggerLabel, triggeredBy, timestamp
  vendorSnapshots: { vendorName: { totalAntes, totalDepois, delta } }
  itemDeltas: [ { change: "added"|"removed"|"modified", vendorName, cliente, item, impacto } ]
  activeSnapshot?: [ { vendedor, cliente, item, data, categoria, label, valorCaixa, p1valor, p2bonus, total } ]
    — Apenas em triggerType === "upload". Foto completa dos itens ativos após o upload.
    — Salvo a partir de 2026-04-19. Uploads anteriores não possuem este campo.

comissoes_diferidas/{id}
  Comissões de planos com ativação futura (>30 dias após pagamento).
  sourcePeriodId, unitId, status ("pendente"|"ativado")
```

---

## Fluxo de Upload (`confirmUpload()`)

1. Processar arquivo Excel via `CommissionEngine.calculate()`
2. Carregar itens existentes do período do Firestore (deduplicação)
3. Salvar novos itens em batch (400/lote) com merge:false
   - Item já processado → apenas atualizar uploadId
   - Item inexistente/excludido → inserir/substituir
4. **Detectar itens removidos:** IDs em DB mas ausentes no novo arquivo
5. **Deletar fisicamente** os itens removidos do Firestore (batch delete, 400/lote)
6. Construir `activeItemsForSnapshot` (foto dos itens ativos)
7. Salvar snapshot no histórico (`saveHistoricoSnapshot`)
8. Salvar comissões diferidas
9. Atualizar `uploadId` e meta do período
10. Chamar `recalculatePeriod` para recomputar totais e `vendorSummary`

**StableId:** `sha256(vendedor|cliente|data|item|valorCaixa)` — identifica o mesmo lançamento entre uploads.

---

## Engine de Comissões (`commission.js`)

- **P1:** Percentual sobre valor caixa (configurável por plano/categoria)
- **P2:** Bônus fixo por ativação (configurável)
- **P3:** Bônus de meta mensal da unidade
- **P4:** Conversão de vouchers em comissão (pool + individual)

---

## Histórico de Alterações

### 2026-04-19 — Upload Sync + Histórico Enriquecido + Exportação Excel
- **Bug fix:** `confirmUpload()` agora deleta fisicamente do Firestore itens presentes no DB mas ausentes no novo arquivo. Anteriormente, esses itens permaneciam como "fantasmas" e continuavam afetando os totais.
- **Feature:** `saveHistoricoSnapshot()` agora salva campo `activeSnapshot` nos snapshots de upload — foto compacta de todos os itens ativos após o upload.
- **Feature:** Função `exportHistoricoXLS(snapshotData)` exporta histórico de upload para Excel com duas abas: "Alterações" (diff) e "Snapshot" (estado completo).
- **Feature:** Modal de diff (`historicoDiffModal`) exibido ao clicar no nome do arquivo no Histórico — cards de resumo, tabela filtrável por tipo/vendedor/cliente, snapshot expandível.

### 2026-04-16 — Histórico de Comissões
- Implementação inicial do sistema de histórico com snapshots por upload, config_change e item_edit.
- Detecção de itens removidos no histórico (registro sem deleção física — corrigido em 2026-04-19).
```

- [ ] **Step 3: Commit**

```bash
git add docs/technical-documentation.md
git commit -m "docs: criar documentacao tecnica inicial do projeto"
```

---

## Task 6: Deploy

- [ ] **Step 1: Verificar build / lint**

```bash
cd "C:\Users\ra058347\OneDrive - intelbras.com.br\Documentos\GitHub\crosstrainer-comissoes"
```

Verificar se há script de deploy no `package.json` ou arquivo de configuração de hosting (Firebase Hosting, Vercel, etc.):
```bash
cat package.json 2>/dev/null || echo "sem package.json"
cat firebase.json 2>/dev/null || echo "sem firebase.json"
```

- [ ] **Step 2: Executar deploy**

Se Firebase Hosting:
```bash
firebase deploy --only hosting
```

Se outro provider, usar o comando de deploy correspondente.

- [ ] **Step 3: Verificar produção**

Abrir a URL de produção, navegar para um período, fazer upload de um arquivo de teste, verificar aba Histórico com botão XLS e modal de diff funcionando.
```
