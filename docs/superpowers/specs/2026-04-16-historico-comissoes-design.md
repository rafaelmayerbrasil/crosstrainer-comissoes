# Histórico de Alterações de Comissões

**Data:** 2026-04-16  
**Status:** Aprovado

## Problema

Valores de comissão oscilam entre recálculos sem que vendedores ou admins consigam saber o que mudou. Todo recálculo sobrescreve os valores no Firestore sem guardar histórico.

## Solução

Salvar um snapshot dos valores por vendedor + deltas de lançamentos a cada recálculo que produza mudança real. Admin vê todos os vendedores; vendedor vê apenas os próprios dados.

---

## Estrutura de Dados

### Nova subcoleção: `periodos/{periodId}/historico/{snapshotId}`

```json
{
  "timestamp": "Firestore Timestamp",
  "triggerType": "upload | config_change | item_edit | item_add | item_delete",
  "triggerLabel": "Upload: vendas_abril.xlsx",
  "triggeredBy": { "uid": "string", "name": "string" },
  "vendorSnapshots": {
    "{vendorId}": {
      "name": "string",
      "totalAntes": 2700.00,
      "totalDepois": 2539.00,
      "delta": -161.00
    }
  },
  "itemDeltas": [
    {
      "vendorId": "string",
      "vendorName": "string",
      "change": "added | removed | modified | p3_recalc",
      "cliente": "string",
      "item": "string",
      "data": "string",
      "impacto": -20.00,
      "antes": { "p1": 0, "p2": 0, "total": 0 },
      "depois": { "p1": 0, "p2": 0, "total": 0 }
    }
  ]
}
```

**Regra:** snapshot só é salvo se houver diferença real (itemDeltas.length > 0 ou algum delta de vendor != 0).

---

## Mudanças Técnicas

### 1. `recalculatePeriod(periodId, triggerContext)`

Adicionar parâmetro `triggerContext = { type, label }`.

Fluxo novo:
1. Captura vendor totals atuais do documento do período ("antes")
2. Carrega itens atuais com seus valores P1/P2 ("antes")
3. Executa cálculo (já existente)
4. Salva novos valores no Firestore (já existente)
5. Computa itemDeltas comparando stableId antes x depois
6. Chama `saveHistoricoSnapshot()` se houver diferença

### 2. Nova função: `saveHistoricoSnapshot()`

Monta e salva o documento de snapshot na subcoleção `historico/`.

### 3. Call sites (5 pontos, 1 linha cada)

| Função | triggerContext |
|--------|----------------|
| `confirmUpload()` | `{ type: 'upload', label: 'Upload: ' + fileName }` |
| `saveSettings()` | `{ type: 'config_change', label: 'Configuração: ' + fieldLabel }` |
| `handleDeleteItem()` | `{ type: 'item_delete', label: 'Item removido' }` |
| `handleEditItem()` | `{ type: 'item_edit', label: 'Edição manual de item' }` |
| `handleAddItem()` | `{ type: 'item_add', label: 'Item adicionado manualmente' }` |

### 4. Novas funções de UI

- `loadHistorico(periodId)` — timeline do admin
- `renderHistoricoEvent(snapshot)` — detalhe expandido com tabela de vendedores + itemDeltas
- `loadVendorHistorico(periodId, vendorId)` — visão filtrada do vendedor

---

## UI

### Admin — nova aba "Histórico" no detalhe do período

- Lista de eventos (mais recente primeiro): data/hora | evento | por | impacto total
- Clique expande: tabela de vendedores com antes/depois/delta + lançamentos alterados
- Filtro por vendedor

### Vendedor — nova seção "Histórico do mês" no dashboard pessoal

- Seção colapsável abaixo do resumo de comissões
- Linha do tempo: data | motivo simplificado | impacto
- Expande para ver lançamentos afetados
- Mostra valor inicial do mês → valor atual → diferença total

**Diferenças admin vs. vendedor:**
- Vendedor vê só os próprios lançamentos
- Vendedor vê "Atualização de base" (não o nome do arquivo)
- Vendedor não vê quem fez a alteração

---

## O que NÃO muda

- `CommissionEngine` (commission.js) — intocado
- Coleções existentes no Firestore
- Regras de segurança (vendedor já tem leitura do período)
