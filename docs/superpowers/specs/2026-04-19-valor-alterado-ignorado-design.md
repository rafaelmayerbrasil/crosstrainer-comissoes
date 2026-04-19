# Design: Proteção de Comissão em Lançamentos com Valor Alterado

**Data:** 2026-04-19  
**Status:** Aprovado

---

## Problema

O `stableId` é um hash de `vendedor|cliente|data|item|valorCaixa`. Quando o mesmo lançamento reaparece em um upload posterior com o valor alterado, o sistema interpreta como dois itens distintos: deleta o original (perdendo a comissão calculada) e cria um novo com o valor atualizado (gerando comissão indevida).

**Regra de negócio:** a comissão é calculada apenas sobre o primeiro pagamento registrado. Se o valor mudar em uploads futuros, o registro original é preservado e o novo valor é ignorado para fins de comissão — mas registrado no histórico para rastreabilidade.

---

## Solução — 3 mudanças em `confirmUpload()`

### 1. `generateSoftId(item)` — identidade sem valor

Hash de `vendedor|cliente|data|item` sem `valorCaixa`. Identifica o mesmo contrato independente do valor pago.

### 2. Detecção de soft match durante o upload

Ao carregar itens existentes do DB, construir:
- `existingProcessedData` — stableId → item (já existe)  
- `existingSoftMap` — softId → `{ stableId, valorCaixa }` (NOVO)

Para cada item do novo arquivo, 3 casos:

| Caso | Ação |
|---|---|
| stableId existe no DB | Skip (comportamento atual) |
| softId existe, stableId diferente | **Soft match** — manter original, atualizar uploadId do original, registrar `valor_alterado_ignorado` |
| Nenhum match | Item novo — calcular comissão normalmente |

### 3. Lógica de deleção ajustada

```
removedStableIds = itens em DB onde:
  - stableId NÃO está no novo arquivo, E
  - softId NÃO está no novo arquivo
```

Items com soft match (mesmo contrato, valor diferente) **não são deletados**.

---

## Novo tipo de delta no histórico

```javascript
{
  change: 'valor_alterado_ignorado',
  vendorName, cliente, item, data,
  valorOriginal: 349.80,  // valor no DB (original comissionado)
  valorNovo: 399.80,       // valor que veio no novo arquivo (ignorado)
  impacto: 0               // sem impacto em comissão
}
```

**UI — card do Histórico:** `⚠️ Val. Alterado (ignorado)` com `(R$ 349,80 → R$ 399,80)`, impacto R$ 0,00  
**UI — modal de diff:** cor âmbar, filtrável pelo tipo  
**XLS aba "Alterações":** coluna "Valor Original" e "Valor Novo" adicionadas para este tipo  

---

## Não está no escopo

- Alterar o `valorCaixa` do item original
- Re-calcular comissão com o novo valor
- Qualquer mudança no `stableId` existente ou migração de dados
