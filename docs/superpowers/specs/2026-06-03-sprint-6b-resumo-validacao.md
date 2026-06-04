# Sprint 6b — Pagamento durante Férias — Resumo para Validação

**Commit:** `3bc71f8` no branch `main`
**Data:** 03/06/2026
**Status:** ⏳ Aguardando validação em staging

---

## 1. O que foi implementado

| # | Funcionalidade | Onde |
|---|---------------|------|
| 1 | **Modal único aprovação+pagamento** | `professores-ferias.js` — botão Aprovar abre modal com bloco "💰 Pagamento" embutido (3 modos + preview ao vivo). Botão "Adiar pagamento" registra `mode='deferred'` |
| 2 | **Cálculo automático efetivo** | `professores-shared.js` — `VacationPaymentService._calculateEfetivoAuto`: MAX(média 12m, último mês) + ⅓ CLT, filtra `valorHoras > 0`, mínimo 3 meses |
| 3 | **Cálculo automático estagiário** | `professores-shared.js` — `VacationPaymentService._calculateEstagiarioAuto`: bolsa × dias/30. Checkbox default MARCADO se `internMonthlyStipend > 0` (Lei 11.788/2008) |
| 4 | **Modo manual** | Alerta visual se `manual > 1,5× auto`. Observação obrigatória se valor=0 |
| 5 | **Modo sem pagamento** | `mode='none'`, justificativa obrigatória |
| 6 | **Modo adiado** | `mode='deferred'`, contador na sidebar conta pendentes |
| 7 | **Coluna "Pagamento" 6 estados** | Tabela admin: Pendente / Sem pagamento / Auto·R$X / Pago em mês/ano / Parcial |
| 8 | **Edição posterior** | Botão "✏️ Editar" enquanto `paidInClosingIds` vazio. Modal focado só no pagamento |
| 9 | **Contador sidebar** | `🏖️ Férias (N)` — listener onSnapshot, atualiza em tempo real |
| 10 | **closeMonth + férias** | `functions/index.js` — busca `vacation_requests` aprovadas do mês, mescla `vacationOnlyTeacherIds` (professor 100% férias não perdia pagamento), rateio proporcional se cruza meses, atualiza `paidInClosingIds` |
| 11 | **Linha "Férias" no fechamento** | `professores-fechamento.js` — tabela de detalhe mostra linha extra com período+valor. Totals com `totalGeral` |
| 12 | **Recibo A4 com Férias** | `receipt.html` + `professores-shared.js` — seção condicional com período, base, ⅓ CLT, valor |
| 13 | **Security Rules** | `firestore.rules` — supervisor BLOQUEADO de editar `payment.*` e `paidInClosingIds`. Só admin/admin_gestao |
| 14 | **Índice composto** | `firestore.indexes.json` — `vacation_requests(status, firstPeriodStart)` |
| 15 | **Backfill** | `scripts/backfill-vacation-denorm.js` — popula `firstPeriodStart`/`lastPeriodEnd` em legados 6a |
| 16 | **Comandos admin.js** | `vacation-preview`, `set-vacation-payment`, `smoke-6b` |
| 17 | **Denormalização na criação** | `VacationService.request()` grava `firstPeriodStart`/`lastPeriodEnd` em novos pedidos |

---

## 2. Arquivos alterados

```
11 files changed, +1437 −17

MODIFY  firestore.indexes.json          (+8 linhas — índice composto)
MODIFY  firestore.rules                 (+22 linhas — supervisor sem acesso)
MODIFY  functions/index.js              (+130 linhas — closeMonth férias + splitVacationAcrossMonth)
MODIFY  professores-fechamento.js       (+30 linhas — linha Férias + totais)
MODIFY  professores-ferias.js           (+350 linhas — modal aprovação+pagamento + coluna + edição)
MODIFY  professores-shared.js           (+550 linhas — VacationPaymentService + getEffectiveStipendAt + ReceiptService.update + VacationService.approve update)
MODIFY  professores.html                (+45 linhas — CSS bloco pagamento + badges + sidebar + recibo)
MODIFY  professores.js                  (+45 linhas — contador sidebar)
MODIFY  receipt.html                    (+28 linhas — seção Férias condicional)
MODIFY  scripts/admin.js                (+215 linhas — vacation-preview + set-vacation-payment + smoke-6b)
CREATE  scripts/backfill-vacation-denorm.js (70 linhas — script de backfill)
```

---

## 3. Como testar em staging

### Pré-deploy (obrigatório)

```bash
# 1. Rodar backfill nos vacation_requests legados do 6a
node scripts/backfill-vacation-denorm.js --project staging
```

### Deploy

```bash
# 2. Deploy rules + indexes (aguardar index criar)
firebase deploy --only firestore:rules --project staging
firebase deploy --only firestore:indexes --project staging

# 3. Deploy functions + hosting
firebase deploy --only functions:closeMonth --project staging
firebase deploy --only hosting --project staging
```

### Smoke test

```bash
# 4. Rodar diagnóstico
node scripts/admin.js --project staging smoke-6b
```

### Validação manual (16 critérios)

| # | O que testar | Como |
|---|-------------|------|
| C1 | Modal único aprova+paga | Aprovar pedido pendente → 1 click define status+pagamento |
| C2 | Botão "Adiar" | Clicar "Adiar pagamento" → `mode='deferred'`, badge Pendente |
| C3 | MAX(média, último) | Efetivo com último mês > média → base = último mês |
| C4 | <3 meses bloqueia | Professor com 2 fechamentos → erro, força manual |
| C5 | Estagiário bolsa>0 default marcado | Estagiário com bolsa → checkbox vem MARCADO |
| C6 | Estagiário sem bolsa desmarcado | Estagiário sem bolsa → checkbox DESMARCADO |
| C7 | Manual >1.5× alerta | Digitar valor muito acima → alerta visual sem bloquear |
| C8 | Supervisor sem acesso | Login supervisor → tentar editar payment → permission-denied |
| C9 | Professor 100% férias | Fechar mês com professor só de férias → entry `isVacationOnly: true` |
| C10 | Férias no detalhe | Fechamento com férias → linha "🏖️ Férias" visível |
| C11 | Cruza 2 meses rateia | Férias 28/jun-12/jul → jun paga 3d, jul paga 12d |
| C12 | Recibo A4 | Imprimir recibo de mês com férias → seção Férias presente |
| C13 | Edição bloqueada pós-pago | `paidInClosingIds` preenchido → sem botão editar |
| C14 | Coluna 6 estados | Tabela admin com pedidos em todos estados → cada um formato correto |
| C15 | Contador sidebar | Aprovar com Adiar → contador sobe. Definir pagamento → desce |
| C16 | Audit+notif | `audit_log` tipo `vacation_payment_set`, notificação ao professor |

---

## 4. Schemas novos (para referência)

### `vacation_requests.payment`

```js
payment: {
  mode: 'auto' | 'manual' | 'none' | 'deferred',
  value: 1234.56,
  calculation: {
    baseMonthly, base12mAvg, baseLastMonth,
    monthsConsidered, proportionalBase, oneThirdValue,
    daysCount, formula: 'efetivo-clt-max' | 'estagiario-bolsa-proporcional'
  } | null,
  notes: string | null,
  setBy, setByName, setAt,
  updatedBy, updatedByName, updatedAt
}
```

### `monthly_closings.teachers[]` (campos novos)

```js
{
  vacationDaysInMonth: 5,
  vacationValue: 1234.56,
  vacationDetails: [{ vacationRequestId, periodStart, periodEnd, daysInMonth, fullPeriodDays, paymentMode, proportionalValue }],
  isVacationOnly: true | false
}
```

### `monthly_closings.totals` (campos novos)

```js
{
  totalVacationDays: 12,
  totalVacationValue: 4567.89,
  totalGeral: 23456.78  // totalValor + totalVacationValue
}
```

---

## 5. Pontos de atenção

1. **Backfill é OBRIGATÓRIO antes do deploy.** Sem ele, `closeMonth` ignora férias legadas do 6a que não têm `firstPeriodStart`/`lastPeriodEnd`
2. **Índice composto precisa existir** antes da query do `closeMonth` funcionar. O deploy de indexes é assíncrono — aguardar `state: READY` no console Firebase
3. **Supervisor barrado:** testar com conta supervisor real (não Admin SDK, que bypassa rules)
4. **Professor 100% férias (D17):** cenário mais sutil — validar com fixture dedicada
5. **Estagiário Lei do Estágio (D3):** checkbox default condicional ao `internMonthlyStipend > 0`

---

*Documento gerado em 03/06/2026 — Sprint 6b — CrossTainer Módulo Professores*
