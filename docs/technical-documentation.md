# CrossTrainer Comissões — Documentação Técnica

> Mantida após cada mudança significativa na arquitetura ou comportamento do sistema.

**Última atualização:** 2026-04-19

---

## Visão Geral

Aplicação web single-page (SPA) em HTML/CSS/JS vanilla para gestão de comissões de vendedores em unidades CrossFit. Os dados são armazenados no Firebase Firestore e autenticados via Firebase Auth.

**Tecnologias:**
- Frontend: HTML + CSS inline + Vanilla JS (arquivo único `index.html`)
- Engine de comissões: `commission.js` (importado por `index.html`)
- Backend/DB: Firebase Firestore (NoSQL)
- Auth: Firebase Authentication
- Exportação: SheetJS (XLSX)

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
  Lançamentos individuais.
  ID = stableId (hash de vendedor|cliente|data|item|valorCaixa)
  type: "processed" | "excluded" | "deferred"
  uploadId, vendedor, cliente, item, data, valorCaixa
  p1valor, p1pct, p2bonus, category, label, isActivation
  Nota: itens removidos de uploads posteriores são DELETADOS fisicamente (desde 2026-04-19)

periodos/{periodId}/historico/{snapshotId}
  Snapshots de mudanças. Gerado após uploads, edições manuais e mudanças de config.
  triggerType: "upload" | "config_change" | "item_edit" | "item_add" | "item_delete"
  triggerLabel, triggeredBy, timestamp
  vendorSnapshots: { vendorName: { totalAntes, totalDepois, delta } }
  itemDeltas: [ { change: "added"|"removed"|"modified"|"valor_alterado_ignorado", vendorName, cliente, item, impacto,
                   valorOriginal?, valorNovo? } ]
    — valor_alterado_ignorado: mesmo contrato (vendedor|cliente|data|item), valorCaixa diferente. impacto=0.
  activeSnapshot?: [ { vendedor, cliente, item, data, categoria, label, valorCaixa, p1valor, p2bonus, total } ]
    — Apenas em triggerType === "upload". Foto dos itens ativos após o upload.
    — Disponível para uploads a partir de 2026-04-19.

comissoes_diferidas/{id}
  Comissões de planos com ativação futura (>30 dias após pagamento).
  sourcePeriodId, unitId, status ("pendente"|"ativado")
```

---

## Fluxo de Upload (`confirmUpload()`)

1. Processar arquivo Excel via `CommissionEngine.calculate()`
2. Carregar itens existentes do período do Firestore (deduplicação)
3. Salvar novos itens em batch (400/lote) com merge:false
   - Item já processado (mesmo stableId) → apenas atualizar `uploadId`
   - **Soft match** (mesmo softId, stableId diferente) → manter original, atualizar uploadId do original, não criar novo
   - Item inexistente/excluído → inserir/substituir
4. **Detectar soft matches:** construir `existingSoftMap` (softId → stableId/valorCaixa) e `newSoftIds`
   - Soft match = mesmo (vendedor|cliente|data|item), valorCaixa diferente
   - Item original preservado; delta `valor_alterado_ignorado` registrado com valorOriginal/valorNovo e impacto 0
5. **Detectar itens removidos:** stableIds em DB onde NÃO há match exato nem soft match no novo arquivo
6. **Deletar fisicamente** os itens removidos do Firestore (batch delete, 400/lote)
7. Coletar `activeItemsForSnapshot` (foto compacta dos itens processados)
7. Salvar snapshot no histórico com `activeSnapshot` (`saveHistoricoSnapshot`)
8. Salvar comissões diferidas em `comissoes_diferidas`
9. Atualizar `uploadId` e meta do período
10. Chamar `recalculatePeriod` para recomputar totais e `vendorSummary`

**StableId:** hash baseado em `vendedor|cliente|data|item|valorCaixa` — identifica o mesmo lançamento entre uploads.

**SoftId:** hash baseado em `vendedor|cliente|data|item` (sem valorCaixa) — identifica o mesmo contrato independente do valor pago. Usado para proteger comissões originais quando o valor muda em uploads posteriores.

---

## Engine de Comissões (`commission.js`)

- **P1:** Percentual sobre valor caixa (configurável por plano/categoria)
- **P2:** Bônus fixo por ativação (configurável)
- **P3:** Bônus de meta mensal da unidade
- **P4:** Conversão de vouchers em comissão (pool + individual)

---

## Funcionalidades do Histórico

### Snapshot (`saveHistoricoSnapshot`)
Salvo automaticamente após:
- Upload de arquivo (`triggerType: 'upload'`) — inclui `activeSnapshot`
- Mudança de configuração (`config_change`)
- Edição manual de item (`item_edit`, `item_add`, `item_delete`)

### Modal de Diff (`openHistoricoDiffModal`)
Aberto ao clicar no nome do arquivo no histórico (entradas de upload).
- Cards de resumo: adicionados / removidos / alterados / impacto líquido
- Tabela filtrável por tipo, vendedor, e busca por cliente
- Botão "Ver Snapshot completo" expande todos os itens ativos

### Exportação (`exportHistoricoXLS`)
Gera `.xlsx` com duas abas:
- **"Alterações"**: diff do upload (adicionados, removidos, alterados) com resumo
- **"Snapshot"**: todos os itens ativos após o upload, com subtotais por vendedor

### Cache em Memória
`window._historicoCache` armazenado ao carregar a aba Histórico.
Usado pelos botões XLS e pelo modal de diff para evitar releitura do Firestore.

---

## Histórico de Mudanças

### 2026-04-19 — Proteção de Comissão: Valor Alterado Ignorado
- **Feat:** `generateSoftId()`: hash de `vendedor|cliente|data|item` sem `valorCaixa` — identifica o mesmo contrato independente do valor pago.
- **Feat:** `existingSoftMap` e `newSoftIds` construídos durante upload para detecção de soft matches.
- **Bug fix:** Items com mesmo contrato mas valor diferente agora preservam a comissão original — o item original não é deletado e o novo valor não gera nova comissão.
- **Feat:** Delta `valor_alterado_ignorado` registrado no histórico com `valorOriginal` e `valorNovo`, impacto = 0.
- **UI:** Tipo exibido como "⚠️ Val. Alterado (ignorado)" em âmbar no card do histórico, modal de diff (com filtro) e exportação XLS (com coluna "Detalhe").

### 2026-04-19 — Upload Sync + Histórico Enriquecido + Exportação Excel
- **Bug fix:** `confirmUpload()` agora deleta fisicamente do Firestore os itens presentes no DB mas ausentes no novo arquivo. Anteriormente, esses itens permaneciam como "fantasmas" afetando totais e aparecendo repetidamente no histórico.
- **Feat:** `saveHistoricoSnapshot()` salva campo `activeSnapshot` nos snapshots de upload.
- **Feat:** Função `exportHistoricoXLS(snapshotData)` exporta histórico para Excel com abas "Alterações" e "Snapshot".
- **Feat:** Modal de diff (`#historicoDiffModal`) com cards de resumo, filtros, tabela e snapshot expandível.

### 2026-04-16 — Histórico de Comissões
- Implementação inicial do sistema de histórico com snapshots por upload, config_change e item_edit.
- Detecção de itens removidos no histórico (registro sem deleção física — corrigido em 2026-04-19).
- Timeline de histórico por vendedor e por admin.
