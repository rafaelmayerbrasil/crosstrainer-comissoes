# Sprint 6c — Resultado da Validação

**Para:** Equipe de desenvolvimento
**De:** Rafael (cliente)
**Data:** 07/06/2026
**Status:** ✅ **ENTREGA APROVADA com 2 melhorias pendentes (não bloqueadoras)**

---

## 📊 Resumo executivo

Excelente entrega. **Cálculo de saldo, helpers e UI funcionam corretamente.** Inspeção de código + smoke + fixture autônoma validaram:
- Helper `addMonths` em 5/5 casos tricky (bissexto, fim de mês, ano normal)
- Cálculo de período aquisitivo: prof com hireDate=15/03/2023 → atual=4º em 07/06/2026 (15/03/2026-14/03/2027)
- Saldo subtrai corretamente: vacation aprovada 10 dias → daysRemaining=20
- Status overdue detectado para hireDate=01/01/2020 (concessivo expirado)
- Fallback `createdAt` funciona quando hireDate ausente
- Dedup do audit log via `metaDayKey` funcional

**2 issues encontradas, ambas NÃO BLOQUEADORAS:**

---

## 🟡 Issue 1 — Off-by-one em grantDeadline (baixo impacto)

### Diagnóstico
Em `professores-shared.js` (`VacationBalanceService.getBalance`):

```js
// Linhas ~3382-3383 (período atual)
grantDeadline = addMonths(current.endDate, 12);
grantDeadline.setDate(grantDeadline.getDate() + 1); // concessivo começa 1 dia após fim do aquisitivo
```

E também replicado em ~3397-3398 (history).

**Confusão semântica:** a variável se chama `grantDeadline` (limite/deadline) mas o `setDate(+1)` produz "1 dia APÓS o deadline correto".

**Cálculo correto:**
- Aquisitivo termina em `endDate` (ex: 14/03/2027)
- Concessivo começa em `endDate + 1 dia` (15/03/2027)
- Concessivo termina em `endDate + 12 meses` = 14/03/2028
- Deadline (último dia válido) = **`addMonths(endDate, 12)` SEM somar 1 dia**

### Impacto
- Professor fica em status `ok` ou `warning` por **1 dia extra** antes de virar `overdue`
- Em ~24 meses de janela total, 1 dia é irrelevante na prática
- Status `expired` no histórico também é detectado 1 dia depois

### Solução recomendada
**Remover o `setDate(+1)` em ambos os lugares**, OU **alterar comparação** de `now > grantDeadline` para `now >= grantDeadline`:

```diff
- grantDeadline = addMonths(current.endDate, 12);
- grantDeadline.setDate(grantDeadline.getDate() + 1);
+ grantDeadline = addMonths(current.endDate, 12);
```

Equivalente em history:
```diff
- const concessiveEnd = addMonths(p.endDate, 12);
- concessiveEnd.setDate(concessiveEnd.getDate() + 1);
+ const concessiveEnd = addMonths(p.endDate, 12);
```

---

## 🟡 Issue 2 — Admin sem balance warning no modal de criação em nome do prof

### Diagnóstico
- `openFeriasRequestModal` (modal do professor, linha ~370) tem `<div id="feriasBalanceWarning">`, seta `window._feriasTeacherId`, dispara `updateFeriasBalanceWarning()` nos onchange dos campos de data. ✓
- `openFeriasRequestModalAdmin` (modal do admin, linha ~414) **não tem** nenhum desses. Não há div de balance, não seta teacherId, não chama updateFeriasBalanceWarning.
- `submitFeriasRequestAdmin` (linha ~536) **não verifica saldo** nem captura `excessJustification`.

### Impacto
- Admin criando pedido em nome de prof não vê o aviso "📊 Seu saldo: X tirados, Y restantes"
- Se exceder, sistema não pede justificativa (cria pedido normal)
- Cálculo de saldo está correto — só a UX do admin não aproveita

### Mitigação parcial existente
- Admin tem checkbox "Forçar override de antecedência" (chamado `feriasForceOverride`) — sinaliza que sabe o que está fazendo
- Painel "📊 Saldos de Férias" mostra a info, então admin pode consultar antes
- Cancelamento posterior é possível enquanto pendente

### Solução recomendada
Adicionar no modal admin:
1. Após o `<select id="feriasTeacherSelect">`, listener `onchange` setando `window._feriasTeacherId = e.target.value` e chamando `updateFeriasBalanceWarning()`
2. Adicionar `<div id="feriasBalanceWarning">` abaixo do select
3. Nos inputs de data dos períodos, repetir `onchange="updateFeriasBalanceWarning()"`
4. Em `submitFeriasRequestAdmin`, replicar lógica de soft warning de `submitFeriasRequestComSaldo` (ou extrair função compartilhada)

---

## ✅ O que está CERTO

Validado por inspeção de código + smoke + fixture autônoma (`scripts/fixture-6c.js`):

| Item | Status | Validação |
|------|--------|-----------|
| D1 Pacote completo (4 entregas) | ✅ | Código + painéis + smoke |
| D2 Soft warning para professor | ✅ | Função `renderBalanceWarning` + `submitFeriasRequestComSaldo` |
| D3 Período aquisitivo CLT | ✅ | Fixture: 4 períodos calculados certinho |
| D4 Eventual sem direito | ✅ | `getEntitlementStartDate` retorna null |
| D5 Estagiário 30 dias | ✅ | `entitledDays: 30` no helper |
| D6 Fallback createdAt + flag | ✅ | Fixture criou prof sem hireDate → flag setada |
| D7 Filtro status='aprovada' | ✅ | Linha 3333 do shared |
| D8 Atribuição por firstPeriodStart | ✅ | Linha 3341 do shared |
| D11 Sem carry forward | ✅ | Cálculo isolado por período |
| D12 Computado on-the-fly | ✅ | Sem nova coleção, sem cache |
| D13 Audit dedup metaDayKey | ✅ | Fixture confirmou query de dedup |
| addMonths em casos tricky | ✅ 5/5 | 31/01+1m, 29/02+12m, etc. |
| Painel admin com alert-overdue-card | ✅ | Estrutura HTML + filtro `overdueCount` |
| Painel professor (renderMeuSaldoPage) | ✅ | Função exposta |
| Modal detalhe (openBalanceDetailModal) | ✅ | Função exposta |
| Status badges 🟢🟡🔴 | ✅ | `statusLabel` no admin |
| `updateFeriasBalanceWarning` ao vivo | ✅ | onchange nos inputs de data (prof) |
| `checkAndLogOverdue` em background | ✅ | Chamada ao final de `renderSaldosGestaoPage` |

---

## 📋 Itens não testados ao vivo (sem login real)

Os seguintes itens não foram testados visualmente (validação só por inspeção de código + fixture):
- **C5** — Painel professor "📊 Meu Saldo" renderiza com login de professor real
- **C9** — Card vermelho de vencidas aparece visualmente no topo do painel admin
- **C6/C7** — Modal de solicitação mostra warning visual ao exceder

Recomendo validação manual rápida em staging (~5 min) após corrigir Issues 1 e 2.

---

## 🎯 Próximos passos

### Para o time
1. **Corrigir Issue 1** (off-by-one) — 2 linhas no `professores-shared.js`
2. **Corrigir Issue 2** (admin sem balance warning) — ~30 linhas no `professores-ferias.js`
3. **Re-commit** + deploy hosting
4. **Avisar quando estiver pronto** — eu re-rodo fixture-6c + valido visualmente

### Para Rafael
1. Após o time corrigir, validar visualmente:
   - Login professor → painel "📊 Meu Saldo" + modal solicitar férias com warning
   - Login admin → painel "📊 Saldos de Férias" com badges + criar pedido em nome de prof excedendo saldo (após fix do Issue 2)

---

## 📁 Artefatos desta validação

- `scripts/fixture-6c.js` — fixture autônoma que valida addMonths + período aquisitivo + saldo + overdue + dedup, com cleanup completo. Reutilizável após o fix.
- Este documento — relatório formal.

---

**TL;DR:** entrega muito boa, com 2 ajustes finos:
1. Remover `setDate(+1)` em `grantDeadline` (2 linhas) — corrige off-by-one
2. Adicionar balance warning no modal admin (~30 linhas) — paridade com fluxo do professor

Tempo estimado de correção: ~20 minutos + redeploy hosting.

*— Rafael*
