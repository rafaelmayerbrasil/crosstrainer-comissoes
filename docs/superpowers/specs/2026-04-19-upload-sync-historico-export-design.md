# Design: Upload Sync, Histórico Enriquecido e Exportação Excel

**Data:** 2026-04-19  
**Status:** Aprovado  
**Contexto:** CrossTrainer Comissões — Dashboard de comissões para unidades CrossFit

---

## Problema

Quando um novo arquivo Excel é carregado para um período já existente, o sistema detecta itens removidos (presentes no DB mas ausentes no novo arquivo) e os registra no histórico com `change: 'removed'`. Porém, esses itens **nunca são deletados do Firestore**, causando três efeitos negativos:

1. Os mesmos itens "removidos" aparecem repetidamente em todos os uploads subsequentes
2. Os totais de comissão no dashboard não refletem o novo arquivo (itens fantasmas continuam somando)
3. Não é possível exportar a "foto" de um upload passado para análise

---

## Solução — 4 mudanças cirúrgicas

### 1. Correção do Upload — Batch Delete de Itens Removidos

**Arquivo:** `index.html` → função `confirmUpload()`

Após detectar `removedIds` (itens em DB ausentes no novo arquivo), executar batch delete no Firestore **antes** de salvar o snapshot do histórico:

```
1. Detectar removedIds  →  { stableId: itemData } do DB que não estão no novo arquivo
2. Batch delete no Firestore de todos os docs em removedIds
3. Salvar snapshot do histórico (estado "depois" já reflete a deleção)
4. Recalcular e gravar totais do período
```

Os `itemDeltas` com `change: 'removed'` continuam sendo registrados no histórico — nada se perde em termos de rastreabilidade.

### 2. Snapshot Completo no Histórico

**Arquivo:** `index.html` → função `saveHistoricoSnapshot()`

Para uploads de arquivo (`triggerType: 'upload'`), adicionar campo `activeSnapshot` ao documento do histórico contendo todos os itens ativos após o upload:

```js
activeSnapshot: [
  {
    vendedor, cliente, item, data, categoria, label,
    valorCaixa, p1valor, p2bonus, total
  },
  // ... todos os itens ativos do período
]
```

- Apenas para `triggerType === 'upload'` — config_change e item_edit não precisam
- Dados já estão em memória no momento do upload (sem custo extra de leitura)
- Tamanho estimado: 15–40 KB por snapshot (50–300 itens × campos compactos)

### 3. Exportação Excel — Função `exportHistoricoXLS(snapshotId)`

**Arquivo:** `index.html` — nova função, usa SheetJS (já presente no projeto)

Gera arquivo `.xlsx` com duas abas:

**Aba "Alterações"** (fonte: `itemDeltas` do snapshot):
- Colunas: Vendedor | Tipo | Cliente | Plano | Impacto R$
- Linha de resumo no topo: total adicionado, removido, líquido, nº itens afetados
- Ordenação: Vendedor → Tipo (Adicionado / Removido / Alterado)
- Formatação condicional: positivo verde, negativo vermelho

**Aba "Snapshot"** (fonte: `activeSnapshot` do snapshot):
- Colunas: Vendedor | Cliente | Plano/Item | Data | Categoria | Valor Caixa | P1 R$ | P2 R$ | Total
- Subtotal por vendedor
- Total geral na última linha
- Ordenação: Vendedor → Data

Nome do arquivo: `historico_{nomeArquivoOriginal}_{data}.xlsx`

Botão "⬇ Exportar XLS" aparece em cada entrada de upload no Histórico.

### 4. Modal de Diff — Visão Detalhada por Upload

**Arquivo:** `index.html` — novo modal, ativado ao clicar no nome do arquivo no Histórico

Layout:
```
┌─────────────────────────────────────────────────────────┐
│ 📄 nome_arquivo.xlsx    data/hora    [⬇ Exportar XLS]   │
├──────────┬─────────────┬────────────┬───────────────────┤
│ +R$ adic │  -R$ remov  │  ± alterado│  Impacto líquido  │
├──────────┴─────────────┴────────────┴───────────────────┤
│ Filtro: [Todos▼]  [Vendedor▼]   🔍 busca por cliente    │
├─────────────────────────────────────────────────────────┤
│ Tabela de itemDeltas filtrada e paginada                 │
├─────────────────────────────────────────────────────────┤
│ N itens ativos após este upload    [Ver Snapshot]        │
└─────────────────────────────────────────────────────────┘
```

- Cards de resumo com números grandes (fácil leitura rápida)
- Filtros: por tipo (Adicionado/Removido/Alterado) e por vendedor
- Busca em tempo real por nome do cliente
- "Ver Snapshot completo" expande tabela com todos os itens ativos do `activeSnapshot`
- Entradas de `config_change` e `item_edit` mantêm o comportamento expandível atual (sem modal)

### 5. Documentação Técnica do Projeto

**Arquivo:** `docs/technical-documentation.md`

Criar e manter atualizado a cada mudança importante. Cobre: arquitetura geral, coleções Firestore, fluxo de upload, lógica de comissões, histórico.

---

## Ordem de Implementação

1. Batch delete em `confirmUpload()` — corrige o bug imediatamente
2. Campo `activeSnapshot` em `saveHistoricoSnapshot()` — viabiliza o resto
3. Função `exportHistoricoXLS()` + botão no histórico
4. Modal de diff
5. Documentação técnica

---

## Não está no escopo

- Comparação arbitrária entre dois uploads (pode ser fase 2 depois que o modal de diff estiver maduro)
- Soft delete / reversão de uploads
- Alteração na lógica de cálculo de comissões
