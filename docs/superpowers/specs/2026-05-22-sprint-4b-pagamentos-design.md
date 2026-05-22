# Sprint 4b — Pagamentos + Recibos · Design Doc

**Data:** 2026-05-22
**Status:** Aprovado
**Playbook base:** `sprint-4b-pagamentos-recibos.md`

---

## 1. Visão geral

Fechar o ciclo financeiro do módulo Professores: após o fechamento mensal (Sprint 4a), admin emite recibos, confirma pagamentos e gerencia divergências via sistema de crédito automático.

**4 novas coleções:** `receipts`, `payment_records`, `creditos_professores`, `meta/receipt_counter`

---

## 2. Arquitetura

```
professores.html               ← nova page-pagamentos + meus-pagamentos
professores.js                 ← sidebar items + routing (admin + professor)
professores-pagamentos.js      ← NOVO — tela admin + painel professor
professores-shared.js          ← +ReceiptService +PaymentService +CreditService
receipt.html                   ← NOVO — standalone, impressão A4
functions/index.js             ← sem alterações (numeração é client-side via transação)
firestore.rules                ← +creditos_professores +meta/receipt_counter
firestore.indexes.json         ← +3 índices compostos
```

### Serviços (client-side, Firestore Web SDK)

| Service | Responsabilidade |
|---------|-----------------|
| `ReceiptService` | emit (transação), emitBatch, cancel, getById, listByClosing, listByTeacher |
| `PaymentService` | confirm, listByClosing, listByTeacher |
| `CreditService` | register, listPending, listHistory |

### Por que client-side e não Cloud Function?

- A transação de numeração sequencial funciona no client-side com `runTransaction`
- O módulo Comissões já usa esse padrão com sucesso
- Reduz complexidade de deploy (sem nova CF)
- Audit log + notificações já são client-side nos services existentes

---

## 3. Schemas (confirmados do playbook)

### `receipts/{receiptId}`
- `number`, `numberFormatted`, `closingId`, `unitId`, `unitName`, `year`, `month`
- `teacherId`, `teacherName`, `teacherCpf`, `teacherType`
- `closingValorTotal`, `closingValorHoras`, `closingHoras`
- `creditosAplicados[]`, `totalCreditoAplicado`, `valorLiquido`
- `status`: `aguardando_pagamento` | `pago` | `cancelado`
- `emittedAt`, `emittedBy`, `emittedByName`
- `paidAt`, `paidBy`, `paymentRecordId`
- `createdAt`, `updatedAt`

### `payment_records/{paymentId}`
- `receiptId`, `receiptNumber`, `closingId`, `teacherId`, `teacherName`, `unitId`
- `valor`, `metodo`, `obs`
- `paidAt`, `paidBy`, `paidByName`
- `createdAt`, `updatedAt`

### `creditos_professores/{creditoId}`
- `teacherId`, `teacherName`, `valor`
- `reciboOrigemId`, `reciboOrigemNum`, `periodoOrigem`, `motivo`
- `status`: `pendente` | `aplicado`
- `appliedAt`, `appliedToReciboId`
- `registeredAt`, `registeredBy`
- `createdAt`, `updatedAt`

### `meta/receipt_counter`
- `value`: number (último número emitido)
- `updatedAt`: timestamp

---

## 4. Decisões (12 do playbook + 2 da sessão)

| # | Decisão | Resposta |
|---|---------|----------|
| D1 | Geração de PDF | HTML imprimível via `window.print()` |
| D2 | Emissão | Individual + lote ("Emitir TODOS") |
| D3 | Sistema de crédito | Sim — mesma mecânica do módulo Comissões |
| D4 | Quem emite | Admin apenas (não admin_gestao) |
| D5 | Numeração | Global, contador atômico em `meta/receipt_counter` |
| D6 | Cancelar recibo | Sim, se `aguardando_pagamento` |
| D7 | Valor pagamento | Obrigatório, editável, > 0 |
| D8 | Método pagamento | Select: transferência, pix, dinheiro, outros |
| D9 | Crédito negativo | Sim — vira débito no próximo recibo |
| D10 | Visibilidade professor | Vê apenas os próprios recibos |
| D11 | Deploy produção | Não — aguarda homologação completa |
| D12 | Notificação email | Não nesta sprint — só in-app |
| **D13** | **Painel professor** | **Nova página na sidebar "💳 Meus Pagamentos"** |
| **D14** | **Cancelar recibo** | **Reverte créditos → pendente de novo + permite ajuste** |

---

## 5. UI

### Tela "Pagamentos" (admin)
- Sidebar item "💳 Pagamentos" (`PROF_PAGES.admin` apenas — paridade com D4)
- Filtros: chips de unidade + select ano/mês + chip status (pago/pendente/parcial)
- Cards de fechamento agrupados por unidade × mês, expansíveis
- Card expandido: toolbar "Emitir TODOS" + tabela por professor
- Colunas: nome · tipo · horas · valor · recibo nº · status · ações
- Ações por linha: Emitir (sem recibo) / Imprimir + Confirmar pgto (com recibo)
- Modal de confirmação de emissão com resumo do valor
- Modal de confirmação de pagamento: valor, método, obs

### Tela "Meus Pagamentos" (professor)
- Sidebar item "💳 Meus Pagamentos" (`PROF_PAGES.professor` e `professor_estagiario`)
- Lista recibos próprios agrupados por unidade × mês
- Mostra créditos pendentes em destaque
- Click no recibo → abre `receipt.html?id=X` (read-only)

### Página de recibo (`receipt.html`)
- Standalone, carrega Firebase CDN, autentica, busca por ID na URL
- Layout A4 com @media print
- Seções: header (logo + nº + período), dados professor, tabela de valores, créditos/débitos, valor líquido + extenso, assinaturas
- Botão "Imprimir" visível só na tela (some no print)

---

## 6. Regras de negócio

1. **Numeração sequencial atômica:** `runTransaction` lê contador, incrementa, cria recibo, aplica créditos — tudo em uma transação
2. **EmitBatch sequencial:** loop (não Promise.all) pra garantir ordem dos números
3. **Abate de créditos FIFO:** ordena por `registeredAt`, abate na ordem
4. **Cancelamento com reversão:** recibo.status = `cancelado` + todos os créditos do `creditosAplicados[]` voltam a `pendente` + audit log
5. **Professor sem userId:** aceito — admin notifica fora do sistema. Alerta visual no painel admin
6. **Fechamento é pré-requisito:** só emite recibo pra closing com status `fechado`

---

## 7. Security Rules

```js
match /receipts/{id} {
  allow read: if isAuth() && (isAdmin() || resource.data.teacherId == uData().professorId);
  allow write: if isAuth() && isStrictAdmin();
  allow delete: if false;
}
match /payment_records/{id} {
  allow read: if isAuth() && (isAdmin() || resource.data.teacherId == uData().professorId);
  allow write: if isAuth() && isStrictAdmin();
}
match /creditos_professores/{id} {
  allow read: if isAuth() && (isAdmin() || resource.data.teacherId == uData().professorId);
  allow write: if isAuth() && isStrictAdmin();
}
match /meta/receipt_counter {
  allow read: if isAuth() && isAdmin();
  allow write: if isAuth() && isStrictAdmin();
}
```

---

## 8. Índices Firestore

```json
// receipts por closing
{ "collectionGroup": "receipts", "fields": [
  { "fieldPath": "closingId", "order": "ASCENDING" },
  { "fieldPath": "number", "order": "DESCENDING" } ] }

// receipts por teacher
{ "collectionGroup": "receipts", "fields": [
  { "fieldPath": "teacherId", "order": "ASCENDING" },
  { "fieldPath": "emittedAt", "order": "DESCENDING" } ] }

// creditos pendentes por teacher
{ "collectionGroup": "creditos_professores", "fields": [
  { "fieldPath": "teacherId", "order": "ASCENDING" },
  { "fieldPath": "status", "order": "ASCENDING" } ] }
```

---

## 9. Sequência de implementação (8 etapas)

| Etapa | Descrição | Arquivos |
|--------|----------|---------|
| 1 | Schema + Security Rules + Services | `firestore.rules`, `firestore.indexes.json`, `professores-shared.js` |
| 2 | Tela "Pagamentos" (admin) | `professores-pagamentos.js`, `professores.html`, `professores.js` |
| 3 | Emissão + receipt.html | `receipt.html`, lógica de transação |
| 4 | Confirmação de pagamento | Modal + `PaymentService.confirm()` |
| 5 | Sistema de crédito | `CreditService` + abate automático no emit |
| 6 | Painel "Meus Pagamentos" (professor) | `professores-pagamentos.js` (renderProfessor) |
| 7 | Notificações in-app | `NOTIF_TYPE_META` + chamadas nos services |
| 8 | Smoke test (12 critérios) | `scripts/admin.js` + validação UI |

---

## 10. Notificações

Adicionar ao `NOTIF_TYPE_META`:
```js
recibo_emitido:       { icon: '📄', title: 'Recibo emitido' },
pagamento_confirmado: { icon: '💰', title: 'Pagamento confirmado' },
```

---

## 11. Critérios de aceite (12)

Mesmos do playbook §7. Resumo: sidebar admin, restrição admin_gestao, lista closings, emissão individual, emissão lote, impressão, confirmação pgto, crédito, abate automático, notificação, audit log, zero regressão.
