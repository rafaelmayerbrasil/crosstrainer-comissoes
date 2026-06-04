# Sprint 6b — Resultado da Validação

**Para:** Equipe de desenvolvimento
**De:** Rafael (cliente)
**Data:** 03/06/2026
**Status:** ⚠️ **NÃO PRONTA PARA DEPLOY EM STAGING** — 2 bugs bloqueadores + 1 cosmético

---

## 📊 Resumo executivo

Bom trabalho na entrega — **95% do escopo está implementado corretamente**, incluindo todos os pontos críticos do playbook v2 (D2 MAX base, D3 default condicional, D14 supervisor barrado, D17 merge teacherIds, modal único, alerta manual, coluna 5 estados).

Mas o **smoke + fixture rodados em staging acusaram 3 bugs** que impedem a sprint de fechar. Detalhes abaixo.

---

## 🔴 Bug 1 — BLOQUEADOR · Cálculo automático efetivo falha em runtime

### Diagnóstico
A query em `professores-shared.js` linha ~3005-3009:

```js
const snap = await db.collection('monthly_closings')
  .where('unitId', '==', req.unitId)
  .where('status', '==', 'fechado')          // ← causa o problema
  .orderBy('year', 'desc').orderBy('month', 'desc')
  .limit(12).get();
```

Exige índice composto `monthly_closings(unitId, status, year DESC, month DESC)` que **não foi declarado** em `firestore.indexes.json`.

Reproduzido em staging com a fixture-6b: **`FAILED_PRECONDITION` em 100% das chamadas**.

### Impacto
- Quebra **C1 (modal calcula auto)**, **C2 (MAX média)** e **C3 (último mês)** dos 16 critérios.
- Em produção, qualquer admin que selecionar "Automático" para efetivo recebe erro técnico.

### Solução recomendada
**Remover o filtro `where('status', '==', 'fechado')`.** Em `monthly_closings`, o único valor possível para `status` é `'fechado'` (`closeMonth` é o único produtor e sempre escreve esse valor — confirmado em `functions/index.js` linha 937). O filtro é redundante e usa o índice existente `monthly_closings(unitId, year DESC, month DESC)`.

```diff
  const snap = await db.collection('monthly_closings')
    .where('unitId', '==', req.unitId)
-   .where('status', '==', 'fechado')
    .orderBy('year', 'desc').orderBy('month', 'desc')
    .limit(12).get();
```

Alternativa (se quiser manter defensividade): adicionar índice composto `(unitId, status, year DESC, month DESC)` em `firestore.indexes.json`. Mas é overhead desnecessário pelo motivo acima.

---

## 🔴 Bug 2 — BLOQUEADOR · Rateio mês-a-mês inflado em 1 dia

### Diagnóstico
Em `functions/index.js` (helper `splitVacationAcrossMonth`) e replicado no playbook (Snippet 3):

```js
monthEnd.setUTCHours(23 + BR_OFFSET_HOURS, 59, 59, 999);
// ...
const days = Math.round((clipEnd - clipStart) / 86400000) + 1;
```

A combinação `setUTCHours(26, 59, 59, 999)` + `Math.round` produz arredondamento errado. Reproduzido com cálculo direto:

```
Período fixture: 18/jun/2026 → 17/jul/2026 (30 dias)
Junho:  clipStart = 18/jun 03:00 UTC  →  clipEnd = 01/jul 02:59:59.999 UTC
         diff em dias = 12.9999999... 
         Math.round = 13  →  +1 = 14    ❌ (correto: 13)
Julho:  clipStart = 01/jul 03:00 UTC   →  clipEnd = 17/jul 03:00 UTC
         diff em dias = 16.0 exato
         Math.round = 16  →  +1 = 17    ✅

Soma: 14 + 17 = 31 dias (deveria ser 30)
```

### Impacto
- Quebra **C11 (férias cruzando 2 meses)**.
- Em produção, professor recebe `(31/30) * valor_total` = **3,3% a mais** quando férias atravessa o limite de mês. Pode ser maior se cruzar 3 meses.
- `paidInClosingIds` fica correto, mas a soma dos `proportionalValue` excede o `payment.value` original.

### Solução
Trocar `Math.round` por `Math.floor`:

```diff
- const days = Math.round((clipEnd - clipStart) / 86400000) + 1;
+ const days = Math.floor((clipEnd - clipStart) / 86400000) + 1;
```

**Atenção:** essa correção precisa entrar em DOIS lugares:
- `functions/index.js` (CF `splitVacationAcrossMonth`)
- Qualquer cópia no playbook v2 — também está errado lá (foi originalmente meu erro de snippet, vou corrigir o playbook).

Após o fix, rodar fixture-6b — soma jun + jul = 30 dias = valor original.

---

## 🟡 Bug 3 — Cosmético · Smoke-6b falha em audit query

### Diagnóstico
Em `scripts/admin.js` (smoke-6b), query:

```js
db.collection('audit_log')
  .where('module', '==', 'ferias')
  .where('type', 'in', ['vacation_payment_set', 'vacation_payment_updated'])
  .orderBy('timestamp', 'desc').limit(10)
```

Combinação `where IN` + `orderBy` em outro campo exige índice composto `(module, type, timestamp)` que não está declarado.

### Impacto
- **NÃO afeta produto** — somente o smoke local quebra na última etapa.
- Smoke já validou parte importante antes de chegar nessa query (counts, byMode, etc.).

### Solução recomendada
Refatorar query pra usar o índice existente `audit_log(module, timestamp)` + filtrar in-memory:

```js
const auditSnap = await db.collection('audit_log')
  .where('module', '==', 'ferias')
  .orderBy('timestamp', 'desc').limit(30).get();
const auditPayments = auditSnap.docs
  .filter(d => ['vacation_payment_set', 'vacation_payment_updated'].includes(d.data().type))
  .slice(0, 10);
```

---

## ✅ O que está CERTO (verificado em código)

| Item | Status | Onde |
|------|--------|------|
| D2 — MAX(média 12m, último mês) | ✅ | `professores-shared.js` linha ~3024-3026 |
| D3 — Default condicional estagiário (Lei do Estágio) | ✅ | `getInternPayDefault` linha ~3089 |
| D14 — Security Rules barram supervisor de payment | ✅ | `firestore.rules` linha ~205-217 |
| D17 — closeMonth mescla teacherIds + vacationOnlyTeacherIds | ✅ | `functions/index.js` linha ~798-830 |
| D17 — isVacationOnly: true setado corretamente | ✅ | `functions/index.js` linha ~862 |
| D18 — Preview ao vivo (recalcula em onchange) | ✅ | `professores-ferias.js` linha ~681 |
| Modal único com bloco "💰 Pagamento" embutido | ✅ | `professores-ferias.js` linha ~582-639 |
| Botão "Adiar pagamento" como secundário | ✅ | `professores-ferias.js` linha ~633, 790 |
| Alerta visual se manual > 1,5× auto | ✅ | `professores-ferias.js` linha ~696-701 |
| Coluna "Pagamento" com 5 estados visíveis + Parcial calculado | ✅ | `professores-ferias.js` linha ~135-200 |
| Notif `vacation_payment_set` ao professor | ✅ | `professores-shared.js` `setPayment` |
| Audit log `module='ferias'` | ✅ | Idem |
| Backfill idempotente | ✅ | `scripts/backfill-vacation-denorm.js` |
| Denormalização `firstPeriodStart`/`lastPeriodEnd` no create | ✅ | `VacationService.request` |
| `paidInClosingIds` atualizado por `closeMonth` | ✅ | `functions/index.js` linha ~979-990 |
| `monthly_closings.totals.totalGeral` computado | ✅ | `functions/index.js` linha ~925 |
| `VacationService.approve` aceita paymentData | ✅ | `professores-shared.js` linha 2793 |

**Cálculo MAX validado quantitativamente via fixture-6b:**
- 5 fechamentos históricos (4× R$ 5.000 + 1× R$ 5.400)
- Resultado: `base12mAvg=5080`, `baseLastMonth=5400`, `baseMonthly=MAX=5400` ✅
- 30 dias × 5400/30 = 5400 + 1/3 = 5400 + 1800 = **R$ 7.200** ✅
- Formula gravada: `efetivo-clt-max` ✅

---

## 📋 Itens não testados (sem fixture)

Os seguintes itens não foram testados ao vivo (validação só por inspeção de código):
- **C8** — supervisor sem acesso (precisa auth real, Admin SDK bypassa rules)
- **C12** — recibo A4 mostra seção Férias (inspeção do `receipt.html` parece OK)
- **C15** — contador sidebar em tempo real (listener `onSnapshot`)

Recomendo o time validar esses 3 manualmente no staging após corrigir bugs 1 e 2.

---

## 🎯 Próximos passos

### Para o time
1. **Corrigir Bug 1**: remover `where('status', '==', 'fechado')` em `_calculateEfetivoAuto`
2. **Corrigir Bug 2**: trocar `Math.round` por `Math.floor` em `splitVacationAcrossMonth`
3. **Corrigir Bug 3** (opcional): refatorar query do smoke-6b
4. **Re-commit** + **deploy** (rules, indexes, functions)
5. **Avisar quando estiver pronto** — eu rodo fixture-6b de novo

### Para mim (Rafael / Claude)
1. Corrigir o Snippet 3 no playbook v2 (`Math.round` → `Math.floor`) — bug originalmente meu
2. Após o time corrigir os bugs e re-deployar, rodar:
   ```bash
   node scripts/fixture-6b.js --project staging
   node scripts/admin.js --project staging smoke-6b
   ```
3. Validar manualmente C8, C12, C15 com login real

---

## 📁 Artefatos desta validação

- `scripts/fixture-6b.js` — fixture autônoma que cria histórico fake + valida cálculo + replica algoritmos do closeMonth. Reutilizável após o fix.
- Este documento — relatório formal.

---

**TL;DR:** entrega muito boa, mas 2 bugs precisam ser corrigidos antes do deploy:
1. Remover `where('status','==','fechado')` em `_calculateEfetivoAuto` (1 linha)
2. Trocar `Math.round` por `Math.floor` em `splitVacationAcrossMonth` (1 caractere)

Tempo estimado de correção: ~15 minutos + redeploy.

*— Rafael*
