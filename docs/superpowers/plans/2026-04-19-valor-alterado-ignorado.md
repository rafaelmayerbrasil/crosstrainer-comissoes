# Proteção de Comissão — Valor Alterado Ignorado

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando o mesmo lançamento reaparece num upload com valor diferente, preservar a comissão original e registrar no histórico que foi identificado mas ignorado.

**Architecture:** Adicionar `generateSoftId()` (hash sem valorCaixa) ao lado de `generateStableId()`. Durante o upload, construir `existingSoftMap` e `newSoftIds` para detectar "mesmo contrato, valor diferente". Soft matches preservam o item original no Firestore e geram delta `valor_alterado_ignorado` no histórico. UI e exportação XLS atualizadas para exibir o novo tipo.

**Tech Stack:** Vanilla JS, Firebase Firestore (batch writes), SheetJS (XLSX)

**Repo:** `C:\Users\ra058347\OneDrive - intelbras.com.br\Documentos\GitHub\crosstrainer-comissoes`

---

## Mapa de Arquivos

| Arquivo | Mudança |
|---|---|
| `index.html` | `generateSoftId()` (novo, ~linha 4480), `confirmUpload()` (~4592–4695), `renderHistoricoTab()` (~7247), `renderHDMTable()` (~10612), `openHistoricoDiffModal()` HTML, `exportHistoricoXLS()` (~10461) |
| `docs/technical-documentation.md` | Atualizar seção de histórico e fluxo de upload |

---

## Task 1: `generateSoftId` + `existingSoftMap`

**Files:**
- Modify: `index.html:4479` (adicionar função após generateStableId)
- Modify: `index.html:4592-4598` (adicionar existingSoftMap ao bloco de carregamento)

- [ ] **Step 1: Adicionar `generateSoftId` imediatamente após `generateStableId` (linha 4479)**

Localizar a linha 4479 (`return 'id_' + Math.abs(hash).toString(36) + '_' + key.length;`) — a função `generateStableId` termina com `}` na linha 4480. Logo após essa chave, inserir:

```javascript
    function generateSoftId(item) {
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
    }
```

- [ ] **Step 2: Adicionar `existingSoftMap` no bloco de carregamento de itens existentes**

Localizar o bloco (~linha 4592):
```javascript
        const existingMap = {}; // stableId → type
        const existingProcessedData = {}; // stableId → item data (para detectar removidos no histórico)
        existingSnap.forEach(doc => {
          const d = doc.data();
          existingMap[doc.id] = d.type || 'processed';
          if ((d.type || 'processed') === 'processed') existingProcessedData[doc.id] = d;
        });
```

Substituir por:
```javascript
        const existingMap = {}; // stableId → type
        const existingProcessedData = {}; // stableId → item data (para detectar removidos no histórico)
        const existingSoftMap = {}; // softId → { stableId, valorCaixa } (para detectar valor alterado)
        existingSnap.forEach(doc => {
          const d = doc.data();
          existingMap[doc.id] = d.type || 'processed';
          if ((d.type || 'processed') === 'processed') {
            existingProcessedData[doc.id] = d;
            existingSoftMap[generateSoftId(d)] = { stableId: doc.id, valorCaixa: d.valorCaixa || 0 };
          }
        });
```

- [ ] **Step 3: Verificar que as duas funções existem e o mapa é populado**

```bash
grep -n "generateSoftId\|existingSoftMap" index.html | head -15
```

Esperado: linhas com `function generateSoftId`, `existingSoftMap`, `generateSoftId(d)`.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: adicionar generateSoftId e existingSoftMap para detecção de valor alterado"
```

---

## Task 2: Soft Match no Batch Write Loop

**Files:**
- Modify: `index.html:4625-4630` (dedup check no batch write)

- [ ] **Step 1: Adicionar detecção de soft match no batch write**

Localizar o bloco de dedup (~linha 4625):
```javascript
            if (existingType === 'processed') {
              skipped++;
              // Update uploadId so recalculatePeriod finds this item in re-uploads
              batch.update(itemsRef.doc(stableId), { uploadId });
              return;
            }
```

Substituir por:
```javascript
            if (existingType === 'processed') {
              skipped++;
              // Update uploadId so recalculatePeriod finds this item in re-uploads
              batch.update(itemsRef.doc(stableId), { uploadId });
              return;
            }
            // Soft match: mesmo contrato, valor diferente → manter original, não criar novo
            const softId = generateSoftId(item);
            if (existingSoftMap[softId] && existingSoftMap[softId].stableId !== stableId) {
              skipped++;
              // Atualiza uploadId do item ORIGINAL para rastreio
              batch.update(itemsRef.doc(existingSoftMap[softId].stableId), { uploadId });
              return;
            }
```

- [ ] **Step 2: Verificar a edição**

```bash
grep -n "Soft match: mesmo contrato" index.html
```

Esperado: uma linha com o comentário.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: pular item com valor alterado no batch write, mantendo original"
```

---

## Task 3: Deltas e Lógica de Deleção

**Files:**
- Modify: `index.html:4650-4695` (newUploadIds, deltas de added/removed, removedStableIds)

- [ ] **Step 1: Adicionar `newSoftIds` junto com `newUploadIds`**

Localizar a linha (~4650):
```javascript
        const newUploadIds = new Set(allItems.filter(d => d.type === 'processed').map(item => generateStableId(item)));
```

Substituir por:
```javascript
        const newUploadIds = new Set(allItems.filter(d => d.type === 'processed').map(item => generateStableId(item)));
        const newSoftIds   = new Set(allItems.filter(d => d.type === 'processed').map(item => generateSoftId(item)));
```

- [ ] **Step 2: Excluir soft matches da detecção de itens adicionados**

Localizar o bloco de 'added' (~linha 4652):
```javascript
        // Itens adicionados (não estavam como processed antes)
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
```

Substituir por:
```javascript
        // Itens adicionados (não estavam como processed antes e não são soft match)
        allItems.filter(d => d.type === 'processed').forEach(item => {
          const stableId = generateStableId(item);
          if (existingMap[stableId] === 'processed') return; // match exato, já existe
          if (existingSoftMap[generateSoftId(item)]) return; // soft match (valor alterado), registrado separadamente
          uploadItemDeltas.push({
            vendorId: item.vendedor || '',
            vendorName: item.vendedor || '',
            change: 'added',
            cliente: item.cliente || '',
            item: item.item || '',
            data: item.data || '',
            impacto: Math.round(((item.p1valor || 0) + (item.p2bonus || 0)) * 100) / 100
          });
        });

        // Itens com valor alterado (mesmo contrato, valorCaixa diferente → ignorado)
        allItems.filter(d => d.type === 'processed').forEach(item => {
          const stableId = generateStableId(item);
          if (existingMap[stableId] === 'processed') return; // match exato, não é alteração de valor
          const original = existingSoftMap[generateSoftId(item)];
          if (!original) return; // nenhum soft match
          uploadItemDeltas.push({
            vendorId: item.vendedor || '',
            vendorName: item.vendedor || '',
            change: 'valor_alterado_ignorado',
            cliente: item.cliente || '',
            item: item.item || '',
            data: item.data || '',
            valorOriginal: original.valorCaixa,
            valorNovo: item.valorCaixa || 0,
            impacto: 0
          });
        });
```

- [ ] **Step 3: Ajustar `removedStableIds` para excluir soft matches**

Localizar (~linha 4684):
```javascript
        const removedStableIds = Object.keys(existingProcessedData).filter(id => !newUploadIds.has(id));
```

Substituir por:
```javascript
        const removedStableIds = Object.keys(existingProcessedData).filter(id => {
          if (newUploadIds.has(id)) return false; // match exato → manter
          if (newSoftIds.has(generateSoftId(existingProcessedData[id]))) return false; // soft match → manter original
          return true; // sumiu do arquivo → deletar
        });
```

- [ ] **Step 4: Verificar as edições**

```bash
grep -n "newSoftIds\|valor_alterado_ignorado\|soft match" index.html | head -20
```

Esperado: linhas com `newSoftIds`, `valor_alterado_ignorado` e o comentário de soft match.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: detectar valor_alterado_ignorado e proteger item original de deleção"
```

---

## Task 4: UI — Histórico, Modal e Exportação XLS

**Files:**
- Modify: `index.html:7247-7255` (renderHistoricoTab itemRows)
- Modify: `index.html:10612-10613` (renderHDMTable changeLabel/changeColor)
- Modify: `index.html:10615-10622` (renderHDMTable rows template)
- Modify: `index.html:10730-10735` (modal filter options)
- Modify: `index.html:10461-10473` (exportHistoricoXLS altRows)

- [ ] **Step 1: Atualizar `renderHistoricoTab` — changeLabel e detail**

Localizar (~linha 7247):
```javascript
            const changeLabel = { added: '✚ Adicionado', removed: '✖ Removido', modified: '≠ Alterado', p3_recalc: '🎯 P3' }[d.change] || d.change;
            const detail = d.change === 'modified' && d.antes ? ` (era R$ ${(d.antes.total || 0).toFixed(2).replace('.', ',')})` : '';
```

Substituir por:
```javascript
            const changeLabel = { added: '✚ Adicionado', removed: '✖ Removido', modified: '≠ Alterado', p3_recalc: '🎯 P3', valor_alterado_ignorado: '⚠️ Val. Alterado (ignorado)' }[d.change] || d.change;
            const detail = d.change === 'modified' && d.antes
              ? ` (era R$ ${(d.antes.total || 0).toFixed(2).replace('.', ',')})`
              : d.change === 'valor_alterado_ignorado'
              ? ` (R$ ${(d.valorOriginal || 0).toFixed(2).replace('.', ',')} → R$ ${(d.valorNovo || 0).toFixed(2).replace('.', ',')})`
              : '';
```

- [ ] **Step 2: Atualizar `renderHDMTable` — changeLabel, changeColor e detail na linha**

Localizar (~linha 10612):
```javascript
      const changeLabel = { added: '✅ Adicionado', removed: '❌ Removido', modified: '✏️ Alterado' };
      const changeColor = { added: '#4caf50', removed: '#e53935', modified: '#ff9800' };
```

Substituir por:
```javascript
      const changeLabel = { added: '✅ Adicionado', removed: '❌ Removido', modified: '✏️ Alterado', valor_alterado_ignorado: '⚠️ Val. Alterado (ignorado)' };
      const changeColor = { added: '#4caf50', removed: '#e53935', modified: '#ff9800', valor_alterado_ignorado: '#ffc107' };
```

Localizar o template da linha no `rows` (~linha 10615):
```javascript
      const rows = deltas.map(d => `
        <tr style="border-bottom:1px solid var(--border,#2a2a2a)">
          <td style="padding:6px 10px;font-size:12px">${d.vendorName || ''}</td>
          <td style="padding:6px 10px;font-size:12px;color:${changeColor[d.change] || '#eee'}">${changeLabel[d.change] || d.change}</td>
          <td style="padding:6px 10px;font-size:12px">${d.cliente || '—'}</td>
          <td style="padding:6px 10px;font-size:12px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.item || '—'}</td>
          <td style="padding:6px 10px;font-size:12px;text-align:right;font-weight:700;color:${(d.impacto || 0) >= 0 ? '#4caf50' : '#e53935'}">${(d.impacto || 0) >= 0 ? '+' : ''}R$ ${Math.abs(d.impacto || 0).toFixed(2).replace('.',',')}</td>
        </tr>`).join('');
```

Substituir por:
```javascript
      const rows = deltas.map(d => {
        const itemDetail = d.change === 'valor_alterado_ignorado'
          ? ` <span style="font-size:10px;opacity:0.7">(R$ ${(d.valorOriginal || 0).toFixed(2).replace('.',',')} → R$ ${(d.valorNovo || 0).toFixed(2).replace('.',',')})</span>`
          : '';
        const impactoColor = d.change === 'valor_alterado_ignorado' ? '#ffc107' : ((d.impacto || 0) >= 0 ? '#4caf50' : '#e53935');
        const impactoText = d.change === 'valor_alterado_ignorado' ? '—' : `${(d.impacto || 0) >= 0 ? '+' : ''}R$ ${Math.abs(d.impacto || 0).toFixed(2).replace('.',',')}`;
        return `<tr style="border-bottom:1px solid var(--border,#2a2a2a)">
          <td style="padding:6px 10px;font-size:12px">${d.vendorName || ''}</td>
          <td style="padding:6px 10px;font-size:12px;color:${changeColor[d.change] || '#eee'}">${changeLabel[d.change] || d.change}</td>
          <td style="padding:6px 10px;font-size:12px">${d.cliente || '—'}</td>
          <td style="padding:6px 10px;font-size:12px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.item || '—'}${itemDetail}</td>
          <td style="padding:6px 10px;font-size:12px;text-align:right;font-weight:700;color:${impactoColor}">${impactoText}</td>
        </tr>`;
      }).join('');
```

- [ ] **Step 3: Adicionar opção de filtro no modal**

Localizar no HTML do modal (~linha 10730):
```html
        <select id="hdmFilterType" onchange="renderHDMTable()" style="padding:6px 10px;font-size:12px;background:var(--surface,#1e1e1e);border:1px solid var(--border,#444);border-radius:6px;color:var(--text,#eee)">
          <option value="">Todos os tipos</option>
          <option value="added">✅ Adicionados</option>
          <option value="removed">❌ Removidos</option>
          <option value="modified">✏️ Alterados</option>
        </select>
```

Substituir por:
```html
        <select id="hdmFilterType" onchange="renderHDMTable()" style="padding:6px 10px;font-size:12px;background:var(--surface,#1e1e1e);border:1px solid var(--border,#444);border-radius:6px;color:var(--text,#eee)">
          <option value="">Todos os tipos</option>
          <option value="added">✅ Adicionados</option>
          <option value="removed">❌ Removidos</option>
          <option value="modified">✏️ Alterados</option>
          <option value="valor_alterado_ignorado">⚠️ Val. Alterado (ignorado)</option>
        </select>
```

- [ ] **Step 4: Atualizar `exportHistoricoXLS` — aba Alterações**

Localizar a seção de filtros e altRows (~linha 10444):
```javascript
        const added    = (itemDeltas || []).filter(d => d.change === 'added');
        const removed  = (itemDeltas || []).filter(d => d.change === 'removed');
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
```

Substituir por:
```javascript
        const added          = (itemDeltas || []).filter(d => d.change === 'added');
        const removed        = (itemDeltas || []).filter(d => d.change === 'removed');
        const modified       = (itemDeltas || []).filter(d => d.change === 'modified');
        const valorAlterado  = (itemDeltas || []).filter(d => d.change === 'valor_alterado_ignorado');
        const totalAdded    = added.reduce((s, d) => s + Math.abs(d.impacto || 0), 0);
        const totalRemoved  = removed.reduce((s, d) => s + Math.abs(d.impacto || 0), 0);
        const totalModified = modified.reduce((s, d) => s + (d.impacto || 0), 0);
        const totalLiq = totalAdded - totalRemoved + totalModified;

        const altRows = [
          ['RESUMO', '', '', '', '', ''],
          ['Total Adicionado', '', '', '', totalAdded, ''],
          ['Total Removido', '', '', '', -totalRemoved, ''],
          ['Itens Alterados (líquido)', '', '', '', totalModified, ''],
          ['Impacto Líquido', '', '', '', totalLiq, ''],
          ['Itens Afetados', '', '', '', (itemDeltas || []).length, ''],
          ['Val. Alterado (ignorado)', '', '', '', 0, valorAlterado.length + ' ocorrência(s)'],
          [],
          ['Vendedor', 'Tipo', 'Cliente', 'Plano / Item', 'Impacto R$', 'Detalhe'],
          ...added.map(d => [d.vendorName || '', 'Adicionado', d.cliente || '', d.item || '', Math.abs(d.impacto || 0), '']),
          ...removed.map(d => [d.vendorName || '', 'Removido', d.cliente || '', d.item || '', -(Math.abs(d.impacto || 0)), '']),
          ...modified.map(d => [d.vendorName || '', 'Alterado', d.cliente || '', d.item || '', d.impacto || 0, '']),
          ...valorAlterado.map(d => [d.vendorName || '', 'Val. Alterado (ignorado)', d.cliente || '', d.item || '', 0, `R$ ${(d.valorOriginal||0).toFixed(2)} → R$ ${(d.valorNovo||0).toFixed(2)}`]),
        ];
```

- [ ] **Step 5: Verificar edições**

```bash
grep -n "valor_alterado_ignorado\|Val. Alterado" index.html | head -20
```

Esperado: ocorrências em renderHistoricoTab, renderHDMTable, modal HTML e exportHistoricoXLS.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: exibir valor_alterado_ignorado no histórico, modal de diff e exportação XLS"
```

---

## Task 5: Atualizar Documentação Técnica

**Files:**
- Modify: `docs/technical-documentation.md`

- [ ] **Step 1: Atualizar seção do fluxo de upload**

No arquivo `docs/technical-documentation.md`, na seção "Fluxo de Upload", atualizar o passo 4 e adicionar o passo 5 novo:

Substituir:
```
4. **Detectar itens removidos:** IDs em DB ausentes no novo arquivo
5. **Deletar fisicamente** os itens removidos do Firestore (batch delete, 400/lote)
6. Coletar `activeItemsForSnapshot` (foto compacta dos itens processados)
```

Por:
```
4. **Detectar soft matches:** items com mesmo (vendedor|cliente|data|item) mas valorCaixa diferente
   - Manter item original no DB, atualizar uploadId do original
   - Registrar como `valor_alterado_ignorado` nos deltas do histórico
5. **Detectar itens removidos:** IDs sem match exato NEM soft match no novo arquivo
6. **Deletar fisicamente** os itens removidos do Firestore (batch delete, 400/lote)
7. Coletar `activeItemsForSnapshot` (foto compacta dos itens processados)
```

- [ ] **Step 2: Adicionar entrada no Histórico de Mudanças**

Adicionar ao início da seção "Histórico de Mudanças":

```markdown
### 2026-04-19 — Proteção de Comissão: Valor Alterado Ignorado
- **Feat:** `generateSoftId()`: hash de vendedor|cliente|data|item sem valorCaixa, identifica o mesmo contrato independente do valor pago.
- **Feat:** `existingSoftMap` e `newSoftIds` construídos durante upload para detecção de soft matches.
- **Bug fix:** Items com mesmo contrato mas valor diferente agora preservam a comissão original — o item original não é deletado e o novo valor não gera nova comissão.
- **Feat:** Delta `valor_alterado_ignorado` registrado no histórico com `valorOriginal` e `valorNovo`.
- **UI:** Tipo exibido como "⚠️ Val. Alterado (ignorado)" em âmbar no card do histórico, modal de diff (com filtro) e exportação XLS (com coluna "Detalhe").
```

- [ ] **Step 3: Commit**

```bash
git add docs/technical-documentation.md docs/superpowers/specs/2026-04-19-valor-alterado-ignorado-design.md docs/superpowers/plans/2026-04-19-valor-alterado-ignorado.md
git commit -m "docs: documentar proteção de comissão para valor alterado ignorado"
```

---

## Task 6: Deploy

- [ ] **Step 1: Push para publicar**

```bash
cd "C:\Users\ra058347\OneDrive - intelbras.com.br\Documentos\GitHub\crosstrainer-comissoes"
git push origin main
```

- [ ] **Step 2: Verificar produção**

Abrir a aplicação. Fazer upload de um arquivo para um período que já tenha lançamentos, com pelo menos um item cujo `valorCaixa` foi alterado.

Verificar na aba Histórico que aparece o delta "⚠️ Val. Alterado (ignorado)" com os valores original e novo.

Verificar que o item original permanece no Firestore com a comissão intacta.
