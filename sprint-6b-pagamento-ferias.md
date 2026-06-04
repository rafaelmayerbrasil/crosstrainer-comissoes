# Sprint 6b — Pagamento durante Férias
**Objetivo:** Implementar cálculo e registro de pagamento para férias (efetivo, CLT 1/3 constitucional) e recesso (estagiário, conforme Lei 11.788/2008). Integra com fechamento mensal (Sprint 4a) e recibo A4 (Sprint 4b). Não altera o bloqueio de agenda (responsabilidade do 6a).
**Pré-condições:** ✅ Sprints 1, 1.5, 2, 3a, 3b, 4a, 4b, 5a, 6a validadas em staging.
**Duração estimada:** 4-5 dias úteis.

> 📌 **Versão 2 (03/06/2026 — pós-revisão técnica).** Após avaliação do time + revisão profunda, este playbook foi corrigido em **6 pontos de UX/fluxo** e **4 pontos críticos**. Histórico de mudanças em §10.

---

## 1. O que esta sprint entrega

Ao final desta sprint:
- **Modal único de aprovação de férias** com bloco "Pagamento" embutido — admin resolve agenda + financeiro juntos (com escape "Adiar definição")
- **Modo Automático para efetivo:** calcula 1/3 constitucional usando `MAX(média 12 meses, valorHoras do último mês)` como base — protege contra férias em mês de baixa
- **Modo Automático para estagiário:** bolsa proporcional aos dias, com **checkbox default MARCADO se `internMonthlyStipend > 0`** (conformidade com Lei do Estágio)
- **Modo Manual:** admin digita valor — alerta visual silencioso se `manual > 1,5× auto`
- **Modo Sem pagamento:** registra como licença não-remunerada (não confundir com "pendente")
- **Cloud Function `closeMonth` modificada:** detecta férias do mês E garante entry no `teachers[]` mesmo para professor 100% em férias (sem aulas no mês)
- **Recibo HTML A4** ganha seção "🏖️ Férias" condicional com período + base + 1/3 + valor
- **Tela "Gerenciar Férias" (admin):** coluna "Pagamento" com 5 estados (Pendente / Auto · R$ X / Sem pagamento / Pago / Pago parcial)
- **Contador na sidebar** `🏖️ Férias (N)` quando há pagamentos adiados
- **Security Rules:** só `admin` e `admin_gestao` podem mexer em `payment.*` (supervisor não)
- **Audit log** com `module: 'ferias'` para mudanças de pagamento
- **Smoke test** com 10 critérios via `scripts/admin.js smoke-6b` + fixture

---

## 2. Escopo claro

### ✅ ENTRA nesta sprint

| Item | Detalhes |
|------|----------|
| Schema `vacation_requests.payment` | Sub-objeto com `mode`, `value`, `calculation`, `notes`, `setBy/At`, `updatedBy/At` |
| Schema `vacation_requests.paidInClosingIds` | Array de IDs de fechamentos que pagaram (1+ se cruza meses) |
| Schema `vacation_requests.firstPeriodStart` + `lastPeriodEnd` | Denormalização pra indexar por período (Firestore não indexa array of objects) |
| Cálculo efetivo modo auto | `MAX(média 12m valorHoras, valorHoras último mês)` × dias/30 + 1/3 constitucional |
| Cálculo estagiário modo auto | Bolsa mensal vigente (`internMonthlyStipend`) × dias / 30. Checkbox default condicional |
| Modo manual | Admin digita valor + observação livre. Alerta silencioso se > 1,5× auto |
| Modo "sem pagamento" | Registra com `value: 0` + justificativa obrigatória |
| Modal de aprovação JUNTO com pagamento | Resolve agenda + financeiro em uma decisão. Botão "Adiar definição" como escape consciente |
| Preview ao vivo | Cálculo atualiza em tempo real ao trocar modo / payIntern / manualValue, sem reabrir modal |
| Edição de pagamento após aprovação | Botão "Editar pagamento" enquanto `paidInClosingIds.length === 0` |
| `closeMonth` injeta férias do mês | Merge: `teacherIds com aulas` ∪ `teacherIds com férias paga no mês`. Garante professor 100% férias receba |
| Rateio mês-a-mês | Férias 28/jun-12/jul: jun paga 3d, jul paga 12d, `paidInClosingIds=[junId,julId]` |
| Linha "Férias" no recibo A4 | Período · base · 1/3 · valor; abaixo das horas e antes do total |
| Coluna "Pagamento" na lista admin | 5 estados: Pendente / Sem pagamento / Auto R$ X / Pago em / Pago parcial |
| Contador sidebar `🏖️ Férias (N)` | Mostra quantas férias aprovadas têm pagamento pendente |
| Security Rules — supervisor sem acesso ao `payment` | Só `admin` e `admin_gestao` editam o sub-objeto |
| Audit log | `module: 'ferias'` em definição/alteração de pagamento |
| Smoke test | 10 critérios via script + fixture |

### ❌ NÃO ENTRA (vai pra backlog ou sprint futura)

| Item | Destino |
|------|---------|
| Controle anual de saldo ("já tirou X / faltam Y") | Backlog — sprint 6c se for relevante |
| Validação de período aquisitivo (12 meses trabalhados) | Backlog — exige cálculo de meses a partir de `hireDate` |
| Pagamento de férias vencidas (>12 meses sem tirar) | Backlog — sem impacto operacional curto prazo |
| Antecipação 13º + férias (parcela única) | Backlog — RH paga via folha separada |
| Estorno automático se férias cancelada após pagar | Backlog — admin trata manual via `register-credit` (Sprint 4b) |
| Reabertura de fechamento já fechado pra incluir férias | Não. `monthly_closings` é IRREVERSÍVEL (regra inviolável #5). Admin avalia caso a caso |
| Notificação por email | Sprint 7 (Brevo) |
| Relatório anual de férias pagas | Sprint 8 (Relatórios) |
| Adicional de insalubridade / horas extras habituais na base | Backlog — fora do escopo atual (CrossTainer não tem esses campos) |

---

## 3. Arquivos a criar/modificar

```
crosstrainer-comissoes/
├── functions/index.js                ← MOD — closeMonth merge teacherIds + busca vacation_requests do mês
├── professores.html                   ← MOD — bloco pagamento no modal de aprovação + CSS recibo
├── professores-ferias.js              ← MOD — modal aprovação JUNTA + edição posterior + coluna pagamento
├── professores-shared.js              ← MOD — VacationPaymentService + getEffectiveStipendAt + helpers
├── professores-fechamento.js          ← MOD — exibe linha "Férias" no detalhe do professor
├── professores.js                     ← MOD — contador sidebar 🏖️ Férias (N)
├── receipt.html                       ← MOD — seção "Férias" condicional
├── firestore.rules                    ← MOD — supervisor sem acesso a payment + edição limitada
├── firestore.indexes.json             ← MOD — índice (status, firstPeriodStart)
└── scripts/
    ├── admin.js                       ← MOD — vacation-preview + set-vacation-payment + smoke-6b
    └── backfill-vacation-denorm.js   ← NOVO — popula firstPeriodStart/lastPeriodEnd em vacation_requests legados (6a)
```

---

## 4. Schemas

### `vacation_requests/{id}` — Sprint 6b adiciona `payment`, `paidInClosingIds`, denormalização

```js
{
  // ... campos do Sprint 6a permanecem inalterados ...
  
  // ─── Sprint 6b — denormalização pra indexar por período ───
  firstPeriodStart: Timestamp,                // min(periods[].startDate)
  lastPeriodEnd: Timestamp,                   // max(periods[].endDate)
  
  // ─── Sprint 6b — bloco de pagamento ─────────────────────
  payment: {
    mode: 'auto' | 'manual' | 'none' | 'deferred',  // 'deferred' = adiado pelo admin
    value: 0,                                  // valor total da férias (R$)
    
    calculation: {                             // preenchido só se mode='auto'
      baseMonthly: 0,                          // MAX(media12m, ultimoMes) pra efetivo; stipend pra estagiário
      base12mAvg: 0,                           // só efetivo — pra auditoria
      baseLastMonth: 0,                        // só efetivo — pra auditoria
      monthsConsidered: 12,                    // <12 se histórico curto (mín 3)
      proportionalBase: 0,                     // baseMonthly × diasFerias / 30
      oneThirdValue: 0,                        // só efetivo: proportionalBase / 3. Estagiário: 0
      daysCount: 30,                           // soma de periods.days
      formula: 'efetivo-clt-max' | 'estagiario-bolsa-proporcional',
    } | null,
    
    notes: string | null,                      // observação livre (até 500 chars). Obrigatório se mode='none' ou (mode='manual' & value=0)
    
    setBy: 'uid-admin',                        // quem definiu o pagamento (pode ser igual ao aprovador)
    setByName: 'Admin Teste',
    setAt: Timestamp,
    
    updatedBy: 'uid-admin' | null,             // se foi editado depois
    updatedByName: string | null,
    updatedAt: Timestamp | null,
  } | null,
  
  paidInClosingIds: ['unit-cp_2026-06', ...]   // array de IDs de monthly_closings onde foi pago (1+ se cruza meses)
}
```

### `monthly_closings/{id}.teachers[]` — Sprint 6b adiciona campos de férias por professor

```js
{
  // ... campos das Sprints 4a + 5a permanecem inalterados ...
  
  // ─── Sprint 6b — pagamento de férias incluído ───────────
  vacationDaysInMonth: 5,                      // dias de férias do prof que caíram nesse mês
  vacationValue: 1234.56,                      // valor proporcional pago no fechamento desse mês
  vacationDetails: [
    {
      vacationRequestId: 'vacReq-abc',
      periodStart: Timestamp,                  // recorte do período DENTRO do mês
      periodEnd: Timestamp,
      daysInMonth: 5,
      fullPeriodDays: 30,
      paymentMode: 'auto' | 'manual' | 'none',
      proportionalValue: 1234.56,
    }
  ],
  
  // NOVO: marca teacher que entrou no fechamento APENAS por férias (sem aulas)
  isVacationOnly: boolean,                     // true se classesCount === 0 mas vacationValue > 0
}
```

### `monthly_closings/{id}.totals` — Sprint 6b adiciona totalizadores

```js
{
  // ... campos existentes ...
  
  // ─── Sprint 6b ──────────────────────────────────────────
  totalVacationDays: 12,                       // soma de vacationDaysInMonth
  totalVacationValue: 4567.89,                 // soma de vacationValue
  totalGeral: 23456.78,                        // totalValor + totalVacationValue (conveniência)
}
```

---

## 5. Sequência de implementação

### Etapa 1 — Schema + Security Rules + Service base + Backfill (~0,5 dia)

#### Security Rules — supervisor SEM acesso a `payment.*`
```js
match /vacation_requests/{id} {
  // ... regras Sprint 6a permanecem ...
  
  // Sprint 6b — APENAS admin e admin_gestao podem mexer em payment.
  // Supervisor NÃO. Solicitante NUNCA.
  allow update: if isAuth() && (
    // (A) Mudanças que tocam payment ou paidInClosingIds — só admin estrito
    (
      request.resource.data.diff(resource.data).affectedKeys()
        .hasAny(['payment', 'paidInClosingIds'])
      && isAdmin()
      && (!('paidInClosingIds' in resource.data) || resource.data.paidInClosingIds.size() == 0)
      && request.resource.data.diff(resource.data).affectedKeys()
          .hasOnly(['payment', 'paidInClosingIds', 'updatedAt'])
    )
    ||
    // (B) Mudanças de status do 6a (admin, admin_gestao, supervisor)
    (
      !request.resource.data.diff(resource.data).affectedKeys().hasAny(['payment', 'paidInClosingIds'])
      && (isAdmin() || isSuperv())
    )
    ||
    // (C) Solicitante cancelando pendente (já existente 6a)
    ( ... lógica do 6a ... )
  );
}
```
> **Importante:** `isAdmin()` aqui = profile === 'admin' OU profile === 'admin_gestao'. Supervisor (`isSuperv()`) NÃO tem acesso. CF `closeMonth` opera via Admin SDK (bypassa rules) então a atualização de `paidInClosingIds` durante fechamento funciona normalmente.

#### Índice composto novo
```json
{
  "collectionGroup": "vacation_requests",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "firstPeriodStart", "order": "ASCENDING" }
  ]
}
```
> A query do `closeMonth` busca `status='aprovada' AND firstPeriodStart <= monthEnd`. Filtro adicional `lastPeriodEnd >= monthStart` aplicado client-side (CF) pra evitar índice triplo.

#### Backfill (rodar 1x antes do deploy)
- Script `scripts/backfill-vacation-denorm.js` (snippet 5) percorre todos `vacation_requests` e popula `firstPeriodStart`/`lastPeriodEnd` em registros legados do 6a.
- Idempotente: pula docs já preenchidos.

#### `VacationService.request` modificado
- Ao criar, calcular e gravar `firstPeriodStart`/`lastPeriodEnd` no mesmo `set`.

#### `VacationPaymentService` novo em `professores-shared.js`
- `calculateForRequest(req, opts)` — calcula sem persistir (snippet 1)
- `setPayment(reqId, paymentData)` — persiste + audit + notif (snippet 2)
- `updatePayment(reqId, paymentData)` — só permitido se `paidInClosingIds.length === 0`
- `previewMonthlyImpact(reqId, year, month)` — utilidade pra UI mostrar quanto vai cair no fechamento X
- Helper `getEffectiveStipendAt(salaryData, date)` — pega `internMonthlyStipend` vigente em uma data (espelha `getEffectiveSalaryAt`)

### Etapa 2 — Lógica de cálculo (~1 dia)

#### Cálculo efetivo (modo auto) — fórmula MAX
1. Busca os últimos 12 `monthly_closings` da unidade do professor (todos estão sempre status='fechado'), ordenado por year/month desc
2. Para cada um, pega `teachers[].valorHoras` (apenas horas — sem benefícios) do professor
3. Filtra apenas meses com `valorHoras > 0` (descarta meses 100% férias passados pra não diluir base)
4. `base12mAvg = soma / monthsConsidered` (12 ou menos se histórico curto)
5. `baseLastMonth = primeiro item da lista (mês mais recente com valorHoras > 0)`
6. **`baseMonthly = MAX(base12mAvg, baseLastMonth)`** ← protege férias em mês de baixa
7. `proportionalBase = baseMonthly × daysCount / 30`
8. `oneThirdValue = proportionalBase / 3`
9. `value = round((proportionalBase + oneThirdValue) × 100) / 100`

> Se `monthsConsidered < 3` → retornar erro "histórico insuficiente — defina pagamento manual".

#### Cálculo estagiário (modo auto)
1. Pega `internMonthlyStipend` vigente em `teacher_salaries.history` na data de início das férias (via `getEffectiveStipendAt`)
2. `proportionalBase = stipend × daysCount / 30`
3. `oneThirdValue = 0` (estagiário não tem 1/3 constitucional, Lei 11.788)
4. `value = round(proportionalBase × 100) / 100`

> Se `stipend === 0` ou ausente: retornar erro "Bolsa não definida — defina pagamento manual ou registre sem pagamento".

#### Modo manual
- Aceita qualquer `value >= 0`. `calculation: null`. 
- `notes` obrigatório se `value === 0`.

#### Alerta silencioso de manual exorbitante
- Se admin escolhe Manual e `value > 1,5 × autoValue` (quando auto é possível), UI mostra abaixo do input:
  ```
  ⚠️ Valor 213% acima do automático (R$ 7.200,00). Confirma?
  ```
- Sem bloquear envio. Só sinalizar.

### Etapa 3 — Modal de aprovação ÚNICO com bloco "Pagamento" (~1,5 dia)

> ⚠️ **Mudança vs. v1 do playbook:** decidido por Opção A (juntos). Aprovação + pagamento na mesma decisão. Escape "Adiar definição" disponível como botão secundário.

- [ ] Modal de aprovação (existente em `professores-ferias.js` do 6a) ganha seção "💰 Pagamento" abaixo do bloco de motivo
- [ ] Layout do bloco:

```
────────────────────────────────────────────
💰 Pagamento durante o período
────────────────────────────────────────────
○ Automático (recomendado)
○ Manual — digite o valor
○ Sem pagamento — registrar como licença

[Se Automático e teacher.type='estagiario':]
  Default checkbox: MARCADO se internMonthlyStipend > 0
                    DESMARCADO se internMonthlyStipend === 0 ou null
  ☐ Pagar bolsa proporcional ao recesso?
  
  ℹ️ Lei do Estágio (11.788/2008) exige pagamento de
     recesso quando há bolsa. Default reflete essa regra.

[Preview ao vivo — atualiza ao trocar opções:]
  📊 Base mensal: R$ 5.400,00
     ↳ média 12m: R$ 5.200,00 | último mês: R$ 5.400,00
     ↳ usado: MAX = R$ 5.400,00
  📊 Proporcional 30 dias: R$ 5.400,00
  📊 1/3 constitucional: R$ 1.800,00
  💵 Total: R$ 7.200,00

[Se Manual:]
  Valor: R$ [_______]
  [Se value > 1.5 × autoEstimate:]
    ⚠️ Valor 213% acima do automático (R$ 7.200,00).
  Observação (opcional): [textarea, sempre presente]
  [Se value === 0:]
    Observação (obrigatória *): [textarea]

[Se Sem pagamento:]
  Justificativa * (obrigatória): [textarea]

────────────────────────────────────────────
[Aprovar e definir pagamento]  [Adiar pagamento (registra Pendente)]  [Cancelar]
```

- [ ] **Botão primário**: "Aprovar e definir pagamento" — só habilita se bloco pagamento válido
- [ ] **Botão secundário**: "Adiar pagamento" — aprova com `payment: { mode: 'deferred', value: 0, notes: 'Pagamento adiado pelo admin' }`. Ação consciente, não default
- [ ] **Recálculo ao vivo**: troca de modo / `payIntern` / `manualValue` dispara recálculo client-side (cache da query de 12 meses pra não bater banco a cada mudança)
- [ ] **Sem spinner**: query de 12 meses roda <500ms; UI sente instantânea
- [ ] **Validação no submit**:
  - Modo auto efetivo: histórico ≥ 3 meses
  - Modo auto estagiário: bolsa > 0 quando `payIntern=true`
  - Modo manual: value ≥ 0; notes obrigatório se value=0
  - Modo none: notes obrigatório
- [ ] Após submit, `VacationService.approve(reqId, note, paymentData)` faz update único:
  - status: 'aprovada'
  - payment: { ...paymentData }
  - respondedAt/By/Note
  
### Etapa 4 — Edição posterior + Coluna "Pagamento" + Contador sidebar (~0,5 dia)

#### Coluna "Pagamento" na tabela admin de férias
5 estados (com classes CSS distintas):

| Estado | O que mostra | Ação |
|--------|-------------|------|
| Não aprovada (pendente/recusada/cancelada) | `—` | — |
| Aprovada, `payment.mode='deferred'` ou ausente | Badge laranja `⏳ Pendente` | Link `💰 Definir` |
| Aprovada, `mode='none'` | Badge cinza `🚫 Sem pagamento` | Link `✏️ Editar` se ainda não pago |
| Aprovada, `mode∈[auto,manual]`, `paidInClosingIds=[]` | `Auto · R$ 7.200,00` ou `Manual · R$ X` | Link `✏️ Editar` |
| Aprovada, `paidInClosingIds.length > 0`, totalmente pago | `✓ Pago em jul/26` | — (não editável) |
| Aprovada, `paidInClosingIds.length ≥ 1`, ainda falta mês | `✓ Parcial · jun/26 · resta jul/26` | — (não editável) |

> Pra detectar "parcial vs total": comparar `lastPeriodEnd` com mês mais recente em `paidInClosingIds`. Se ainda há mês não fechado dentro do período, é parcial.

#### Edição posterior (Botão "Editar pagamento")
- Aparece se `paidInClosingIds.length === 0`
- Abre modal **focado** (sem bloco aprovação, só bloco pagamento)
- Mesma UX do bloco da Etapa 3 (preview ao vivo, validações)
- Atualiza `payment.updatedBy/At` + audit `vacation_payment_updated`

#### Contador sidebar
- `🏖️ Férias (N)` onde N = `vacation_requests` com `status='aprovada' AND (payment é null OR payment.mode='deferred')`
- Listener em tempo real (`onSnapshot`) na coleção (admin/admin_gestao apenas)
- Atualiza ao definir/atualizar pagamento

### Etapa 5 — Integração `closeMonth` + recibo (~1,5 dia)

#### `closeMonth` CF — bloco NOVO entre §7 (agrupa por teacher) e §8 (calcula por professor)

```js
// Sprint 6b — busca férias do mês
const monthStart = brMidnightUTC(year, month - 1, 1);
const monthEnd = lastDayOfMonth;

const vacSnap = await firestore.collection('vacation_requests')
  .where('status', '==', 'aprovada')
  .where('firstPeriodStart', '<=', monthEnd)
  .get();

const vacsInMonth = vacSnap.docs
  .map(d => ({ id: d.id, ...d.data() }))
  .filter(v =>
       v.lastPeriodEnd && v.lastPeriodEnd.toDate() >= monthStart
    && v.unitId === unitId
    && v.payment
    && v.payment.value > 0
    && v.payment.mode !== 'deferred'
  );

// ⚠️ CRÍTICO: garante que professor 100% em férias (sem aulas) entre no fechamento
const vacationOnlyTeacherIds = vacsInMonth
  .map(v => v.teacherId)
  .filter(tid => !teacherIds.includes(tid));

// Mescla teacherIds — agora inclui quem tá só com férias paga no mês
const allTeacherIds = [...new Set([...teacherIds, ...vacationOnlyTeacherIds])];
```

- Buscar teachers e salaries também pros `vacationOnlyTeacherIds`
- No loop de `teacherResults`, criar entry pra cada `vacationOnlyTeacherId` com:
  - `classesCount: 0, totalHoras: 0, valorHoras: 0, valorTotal: 0`
  - `isVacationOnly: true`
- Para cada `v` em `vacsInMonth`, chamar `splitVacationAcrossMonth` (snippet 3) e adicionar a `tResult.vacationDaysInMonth/Value/Details`
- Atualizar `totals.totalVacationDays/Value/Geral`
- Após `txn.set(closingRef, ...)`, batched update em `vacation_requests` adicionando `closingId` em `paidInClosingIds` (snippet 4)

#### Recibo `receipt.html` — seção condicional
- Renderiza seção "🏖️ Férias" se `vacationDetails.length > 0`
- Cada detail vira uma linha com período + base + 1/3 + valor proporcional
- Caso `isVacationOnly=true`: rodapé inclui nota "Período sem aulas — pagamento exclusivo de férias"

### Etapa 6 — Comandos admin.js + Smoke test (~0,5 dia)

#### Comandos novos
```
vacation-preview <reqId> auto                    — calcula auto sem persistir
vacation-preview <reqId> auto --no-pay-intern   — pra estagiário sem bolsa proporcional
set-vacation-payment <reqId> auto               — aplica modo auto via admin SDK
set-vacation-payment <reqId> manual <valor> [obs]
set-vacation-payment <reqId> none <justificativa>
set-vacation-payment <reqId> deferred           — registra adiamento
smoke-6b                                         — 10 critérios automatizáveis
```

#### Cenários do smoke-6b
1. C1 — Efetivo com 12 meses de histórico → auto calcula `MAX(media, último)` corretamente
2. C2 — Efetivo com mês de baixa recente → MAX pega `media12m`, não dilui
3. C3 — Efetivo com mês de alta recente → MAX pega `baseLastMonth`, sobe base
4. C4 — Efetivo com <3 meses → bloqueia auto, força manual
5. C5 — Estagiário com bolsa > 0 → checkbox default marcado, auto calcula proporcional
6. C6 — Estagiário sem bolsa → checkbox default desmarcado, auto retorna erro
7. C7 — Manual com valor > 1,5× auto → audit log marca `notes: 'overpriced'` (futuramente)
8. C8 — Sem pagamento sem notes → erro de validação
9. C9 — Deferred → fechamento ignora, badge "Pendente" segue
10. C10 — Professor 100% férias no mês → entra no fechamento como `isVacationOnly: true`

### Etapa 7 — Deploy + Validação (~0,5 dia)

- [ ] Rodar `node scripts/backfill-vacation-denorm.js --project staging` (popula campos legados)
- [ ] Deploy:
  - `firebase deploy --only firestore:rules --project staging`
  - `firebase deploy --only firestore:indexes --project staging`
  - `firebase deploy --only functions:closeMonth --project staging`
- [ ] Rodar `node scripts/admin.js --project staging smoke-6b`
- [ ] Fixture completa: criar férias → aprovar com pagamento auto → fechar mês → conferir recibo + paidInClosingIds

---

## 6. Decisões importantes

| # | Decisão | Resposta |
|---|---------|----------|
| D1 | Escopo da sprint | **Somente pagamento.** Controle anual fica no backlog. Confirmado 03/06 |
| D2 | Base de cálculo efetivo | **`MAX(média 12 meses valorHoras, valorHoras último mês)`** × dias/30 + 1/3 proporcional. Protege férias em mês de baixa. **Atualizado v2** |
| D3 | Estagiário tem direito? | **Lei do Estágio (11.788/2008) exige pagamento quando há bolsa.** Checkbox default MARCADO se `internMonthlyStipend > 0`, desmarcado se = 0 ou ausente. Admin pode reverter caso a caso. **Atualizado v2** |
| D4 | Fórmula 1/3 constitucional | `proportionalBase / 3`. Total = `proportionalBase + 1/3`. Estagiário não tem 1/3 (Lei do Estágio) |
| D5 | Pagamento atravessa 2 meses | **Rateio proporcional.** Cada `monthly_closings` paga sua fração dos dias caídos no mês. `value` total no vacation_request; `proportionalValue` no closing |
| D6 | Onde aparece o valor | Linha "Férias" no detalhe do professor no fechamento + seção dedicada no recibo A4. Não vira coleção separada |
| D7 | Histórico insuficiente | **<3 meses → bloqueia modo auto, força manual.** Mensagem explica. <12 meses mas ≥3 → usa média do disponível |
| D8 | Edição de pagamento após aprovação | **Permitida enquanto `paidInClosingIds.length === 0`.** Após primeiro fechamento incluir, vira read-only |
| D9 | Cancelamento de férias paga | **Não estorna automaticamente.** Admin trata via `register-credit` (Sprint 4b) |
| D10 | Férias aprovada DEPOIS de mês fechado | **Não reabre fechamento.** Admin trata: paga no mês seguinte como ajuste manual ou não paga |
| D11 | Notificação ao professor | **Sim, in-app: `vacation_payment_set`** quando admin define pagamento. Email fica pra Sprint 7 |
| D12 | Deploy em produção | Não. Aguarda homologação completa do módulo |
| **D13** | **Fluxo aprovar+pagamento** | **JUNTOS no mesmo modal.** Botão "Adiar pagamento" como escape consciente (registra `mode='deferred'`). **Novo v2** |
| **D14** | **Quem define pagamento?** | **Apenas `admin` e `admin_gestao`.** Supervisor não tem acesso (controle financeiro). Security Rules barram. **Novo v2** |
| **D15** | **Observação no payment** | **Campo sempre presente em TODOS os modos.** Obrigatório só em `mode='none'` ou (`mode='manual' AND value=0`). **Novo v2** |
| **D16** | **Manual exorbitante** | **Alerta silencioso visual** se `manual > 1,5 × auto`. Não bloqueia. Audit registra. **Novo v2** |
| **D17** | **Professor 100% férias no mês** | **`closeMonth` mescla `teacherIds` com `vacationOnlyTeacherIds`.** Cria entry no fechamento mesmo sem aulas. Marca `isVacationOnly: true`. **Novo v2** |
| **D18** | **Preview do cálculo** | **Mostrar ao vivo no modal**, sem spinner. Recalcula client-side ao trocar modo/payIntern/manualValue. Cache local da query de 12 meses. **Novo v2** |
| **D19** | **Indicador de pagamentos pendentes** | **Contador na sidebar `🏖️ Férias (N)`** quando há aprovadas com `payment=null` ou `mode='deferred'`. Visível só pra admin/admin_gestao. **Novo v2** |

---

## 7. Critérios de aceite

| # | Critério | Como verificar |
|---|----------|---------------|
| 1 | Modal único aprova + paga | Aprovar pedido → status='aprovada' + payment populado em 1 click |
| 2 | Botão "Adiar pagamento" registra deferred | Click no botão secundário → payment.mode='deferred', badge "Pendente" aparece |
| 3 | Modo auto efetivo aplica MAX(média12m, último mês) | Lucas com média R$ 5000 e último mês R$ 5400 → base=5400. Inverte cenário → base=5000 |
| 4 | Modo auto bloqueia se histórico <3 meses | Professor com 2 fechamentos → erro + dropdown trava em manual |
| 5 | Estagiário com bolsa > 0 → default marcado | Ana (bolsa R$ 1000) → checkbox VEM marcado, auto calcula R$ 166,67 pra 5 dias |
| 6 | Estagiário sem bolsa → default desmarcado | Estagiário sem bolsa cadastrada → checkbox VEM desmarcado, sem cálculo |
| 7 | Manual > 1,5× auto mostra alerta | Auto = R$ 7200, manual = R$ 15.000 → alerta visual sem bloquear |
| 8 | Supervisor não consegue alterar payment | Login como supervisor → tenta UPDATE payment via console → permission-denied |
| 9 | Professor 100% férias no mês entra no fechamento | Lucas 100% jun em férias paga → fechamento jun tem entry Lucas `isVacationOnly: true` com `vacationValue > 0` |
| 10 | `closeMonth` injeta linha "Férias" no detalhe | Fechamento com férias → `teacherResults[Lucas].vacationValue > 0`, `paidInClosingIds` atualizado |
| 11 | Férias cruzando 2 meses rateia | 28/jun-12/jul · jun paga 3d · jul paga 12d · `paidInClosingIds=[junId,julId]` |
| 12 | Recibo A4 mostra seção "Férias" | Imprimir recibo de mês com férias paga → seção com período · base · 1/3 · valor |
| 13 | Edição só permitida se ainda não pago | `paidInClosingIds=[]` → botão visível · após fechamento → badge "Pago em..." |
| 14 | Coluna "Pagamento" mostra 5 estados | Tabela com pedidos em todos os estados → cada um exibe sinal correto |
| 15 | Contador sidebar atualiza ao vivo | Aprovar com "Adiar" → contador sobe; definir pagamento → contador desce |
| 16 | Audit log + notif registrados | `audit_log` com `module='ferias'` tipo `vacation_payment_set` · `notification` ao professor |

---

## 8. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|--------------|----------|
| Query de 12 meses do auto cálculo é lenta | 🟢 Baixa | 1 query ordenada com limit(12). Estimativa ~300ms. Cache local no modal pra evitar refazer ao trocar modo |
| Férias atravessando 2 meses calcula errado | 🟡 Média | Helper `splitVacationAcrossMonth` isolado e testado. Cenário C11 no smoke |
| Admin define manual exorbitante | 🟡 Média | Alerta visual silencioso + audit log. Sem bloqueio (autoridade do admin) |
| Recibo gerado antes do fechamento sem férias | 🟡 Média | `receipt.html` lê do `monthly_closings`. Documentado em D10 |
| Mudança de salário durante férias | 🟢 Baixa | Usa salário vigente em `effectiveDate ≤ período.startDate` (mesma lógica do fechamento) |
| `closeMonth` falha em férias legadas sem denormalização | 🔴 Alta sem backfill | **Backfill obrigatório antes do deploy.** Snippet 5. Idempotente |
| Esquecimento de pagamento após aprovação | 🟡 Média | Contador na sidebar + estado `deferred` explícito. Não default — é escolha consciente |
| Professor 100% férias não recebe | 🔴 Crítico se ignorado | D17: `closeMonth` mescla teacherIds. Cenário C9 no smoke (verificação obrigatória) |
| Supervisor altera pagamento por engano | 🟢 Baixa | Security Rules barram (D14). Cenário C8 no smoke |
| Lei do Estágio violada por default errado | 🔴 Crítico se A | D3 corrige: default condicional ao stipend. Cenário C5 valida |
| Cálculo de média ignora férias passadas | 🟢 Baixa | Filtro `valorHoras > 0` exclui meses 100% férias da média pra não diluir base. Documentado em §5 Etapa 2 |

---

## 9. Após a sprint

Sprint 6b termina quando os 16 critérios passarem. Próximo passo:
- 🟢 **Sprint 6c (opcional)** — Controle anual de saldo + validação período aquisitivo
- 🟢 **Sprint 7** — Notificações por email (Brevo)
- 🟢 **Sprint 8** — Relatórios + Exportações
- Aguarda **homologação completa do módulo** antes do deploy em produção (regra fechada 03/06/2026)

---

## 10. Histórico de revisão (v1 → v2)

Após avaliação técnica em 03/06/2026, time levantou 6 pontos de fluxo/UX. Revisão profunda corrigiu:

| # | v1 | v2 | Razão |
|---|----|----|----|
| Modal | Aprovação + pagamento separados (B) | **Juntos (A) + botão "Adiar"** | Risco de aprovar e esquecer pagamento → professor sem férias paga. Ver D13 |
| Estagiário default | Desmarcado (conservador) | **Marcado se bolsa > 0** | Lei 11.788/2008 Art. 13 §1º — descumprimento legal. Ver D3 |
| Base efetivo | Só média 12 meses | **MAX(média, último mês)** | Férias em mês de baixa diluiria base injustamente. Ver D2 |
| Modal Sem campo obs em Auto | — | **Campo sempre presente** | Anotações de contexto somem. Ver D15 |
| Coluna Pagamento estados | 4 estados | **6 estados** incluindo "Sem pagamento" e "Parcial" | "Pendente" vs "Sem pagamento" são coisas diferentes. Ver §5 Etapa 4 |
| Professor 100% férias | Não tratado (bug latente) | **closeMonth mescla teacherIds** | Cenário onde prof não receberia. Ver D17 |
| Supervisor + payment | Implícito (acesso possível) | **Bloqueado por Security Rule** | Controle financeiro. Ver D14 |
| Manual exorbitante | Sem aviso | **Alerta silencioso** | Erro humano em valores grandes. Ver D16 |
| Preview cálculo | Mostrar (1-2s spinner) | **Sem spinner, recalcula ao vivo** | Query é rápida. Ver D18 |
| Contador sidebar | — | **`🏖️ Férias (N)` quando há pendência** | Reforça visibilidade sem ruído. Ver D19 |

---

## 📋 Snippets-chave (pra desenvolvimento autônomo)

### Snippet 1 — `VacationPaymentService.calculateForRequest` (v2 com MAX e payIntern condicional)

```js
const VacationPaymentService = {
  
  async calculateForRequest(req, opts = {}) {
    if (!req || !req.teacherId || !Array.isArray(req.periods)) {
      return { success: false, error: 'vacation_request inválido' };
    }
    const mode = opts.mode || 'auto';
    const notes = (opts.notes || '').trim();
    
    if (mode === 'deferred') {
      return { success: true, data: { mode: 'deferred', value: 0, calculation: null,
        notes: notes || 'Pagamento adiado pelo admin' } };
    }
    
    if (mode === 'none') {
      if (!notes) {
        return { success: false, error: 'Justificativa obrigatória para "sem pagamento".' };
      }
      return { success: true, data: { mode: 'none', value: 0, calculation: null, notes } };
    }
    
    if (mode === 'manual') {
      const value = parseFloat(opts.manualValue);
      if (isNaN(value) || value < 0) {
        return { success: false, error: 'Valor manual inválido.' };
      }
      if (value === 0 && !notes) {
        return { success: false, error: 'Observação obrigatória se valor manual é zero.' };
      }
      return { success: true, data: { mode: 'manual', value, calculation: null, notes: notes || null } };
    }
    
    // mode === 'auto'
    if (req.teacherType === 'efetivo') {
      return this._calculateEfetivoAuto(req, notes);
    }
    if (req.teacherType === 'estagiario') {
      // payIntern: default condicional baseado em internMonthlyStipend
      // Se opts.payIntern explicitamente false → registra como none
      if (opts.payIntern === false) {
        return { success: true, data: {
          mode: 'none', value: 0, calculation: null,
          notes: notes || 'Estagiário sem bolsa proporcional nesta solicitação.',
        } };
      }
      return this._calculateEstagiarioAuto(req, notes);
    }
    return { success: false, error: 'Tipo de professor não suportado.' };
  },
  
  async _calculateEfetivoAuto(req, notes) {
    // v2.1: sem where('status','==','fechado') — único valor possível em monthly_closings,
    // filtro redundante que exige índice composto não declarado.
    const snap = await db.collection('monthly_closings')
      .where('unitId', '==', req.unitId)
      .orderBy('year', 'desc').orderBy('month', 'desc')
      .limit(12).get();
    
    // Filtra meses com valorHoras > 0 (descarta meses 100% férias passados)
    const monthsData = [];
    snap.docs.forEach(d => {
      const data = d.data();
      const t = (data.teachers || []).find(x => x.teacherId === req.teacherId);
      if (t && typeof t.valorHoras === 'number' && t.valorHoras > 0) {
        monthsData.push({ valorHoras: t.valorHoras, year: data.year, month: data.month });
      }
    });
    
    if (monthsData.length < 3) {
      return { success: false, error: `Histórico insuficiente (${monthsData.length} meses com horas). Defina pagamento manual.` };
    }
    
    const base12mAvg = monthsData.reduce((a, b) => a + b.valorHoras, 0) / monthsData.length;
    const baseLastMonth = monthsData[0].valorHoras;  // primeiro = mais recente (orderBy desc)
    const baseMonthly = Math.max(base12mAvg, baseLastMonth);
    
    const daysCount = (req.periods || []).reduce((s, p) => s + (p.days || 0), 0);
    const proportionalBase = baseMonthly * daysCount / 30;
    const oneThirdValue = proportionalBase / 3;
    const value = Math.round((proportionalBase + oneThirdValue) * 100) / 100;
    
    return {
      success: true,
      data: {
        mode: 'auto', value,
        calculation: {
          baseMonthly: Math.round(baseMonthly * 100) / 100,
          base12mAvg: Math.round(base12mAvg * 100) / 100,
          baseLastMonth: Math.round(baseLastMonth * 100) / 100,
          monthsConsidered: monthsData.length,
          oneThirdValue: Math.round(oneThirdValue * 100) / 100,
          proportionalBase: Math.round(proportionalBase * 100) / 100,
          daysCount,
          formula: 'efetivo-clt-max',
        },
        notes: notes || null,
      }
    };
  },
  
  async _calculateEstagiarioAuto(req, notes) {
    const earliestStart = req.periods.reduce((min, p) => {
      const d = p.startDate.toDate ? p.startDate.toDate() : new Date(p.startDate);
      return (!min || d < min) ? d : min;
    }, null);
    
    const salaryDoc = await db.collection('teacher_salaries').doc(req.teacherId).get();
    if (!salaryDoc.exists) {
      return { success: false, error: 'Cadastro salarial do estagiário não encontrado.' };
    }
    const stipend = getEffectiveStipendAt(salaryDoc.data(), earliestStart);
    if (!stipend || stipend <= 0) {
      return { success: false, error: 'Bolsa mensal não definida para esta data. Use modo manual ou registre como sem pagamento.' };
    }
    
    const daysCount = (req.periods || []).reduce((s, p) => s + (p.days || 0), 0);
    const proportionalBase = stipend * daysCount / 30;
    const value = Math.round(proportionalBase * 100) / 100;
    
    return {
      success: true,
      data: {
        mode: 'auto', value,
        calculation: {
          baseMonthly: stipend, base12mAvg: stipend, baseLastMonth: stipend,
          monthsConsidered: 1,
          oneThirdValue: 0, proportionalBase: value,
          daysCount, formula: 'estagiario-bolsa-proporcional',
        },
        notes: notes || null,
      }
    };
  },
};

// Helper pra default da UI (componente do modal usa pra decidir o estado inicial do checkbox)
function getInternPayDefault(teacher, salaryData) {
  if (teacher.type !== 'estagiario') return false;
  const stipend = getEffectiveStipendAt(salaryData, new Date());
  return stipend > 0;  // Lei do Estágio Art. 13 §1º
}
```

### Snippet 2 — `VacationPaymentService.setPayment` (com suporte a deferred)

```js
async setPayment(reqId, paymentData) {
  if (!reqId || !paymentData) return { success: false, error: 'Argumentos obrigatórios' };
  try {
    const ref = db.collection('vacation_requests').doc(reqId);
    const beforeDoc = await ref.get();
    if (!beforeDoc.exists) return { success: false, error: 'Pedido não encontrado' };
    const before = beforeDoc.data();
    
    if (before.status !== 'aprovada') {
      return { success: false, error: 'Só é possível definir pagamento em férias aprovadas.' };
    }
    if (Array.isArray(before.paidInClosingIds) && before.paidInClosingIds.length > 0) {
      return { success: false, error: 'Pagamento já foi processado em fechamento — não pode ser editado.' };
    }
    
    const uid = currentUserId();
    const isUpdate = before.payment && before.payment.setAt;
    
    const payment = {
      mode: paymentData.mode,
      value: paymentData.value || 0,
      calculation: paymentData.calculation || null,
      notes: paymentData.notes || null,
    };
    
    if (isUpdate) {
      payment.setBy = before.payment.setBy;
      payment.setByName = before.payment.setByName;
      payment.setAt = before.payment.setAt;
      payment.updatedBy = uid;
      payment.updatedByName = currentUserName();
      payment.updatedAt = serverTs();
    } else {
      payment.setBy = uid;
      payment.setByName = currentUserName();
      payment.setAt = serverTs();
      payment.updatedBy = null;
      payment.updatedByName = null;
      payment.updatedAt = null;
    }
    
    await ref.update({ payment, updatedAt: serverTs() });
    
    // Notif só pro professor (e só se NÃO é deferred)
    if (payment.mode !== 'deferred') {
      await NotificationService.create({
        recipientUserId: before.requestedBy,
        type: 'vacation_payment_set',
        title: isUpdate ? 'Pagamento de férias atualizado' : 'Pagamento de férias definido',
        body: payment.value > 0
          ? `${before.type} de ${before.totalDays} dias — R$ ${payment.value.toFixed(2)} (${payment.mode})`
          : `${before.type} de ${before.totalDays} dias registrada sem pagamento`,
        link: { type: 'vacation', id: reqId },
      });
    }
    
    await AuditService.log({
      type: isUpdate ? 'vacation_payment_updated' : 'vacation_payment_set',
      details: `${isUpdate ? 'Atualizado' : 'Definido'} pagamento de ${before.type} ${before.teacherName}: R$ ${payment.value.toFixed(2)} (${payment.mode})`,
      entityType: 'vacation_request', entityId: reqId,
      before: { payment: before.payment || null },
      after: { payment },
      module: 'ferias',
    });
    
    return { success: true, data: payment };
  } catch (err) {
    console.error('[VacationPaymentService.setPayment]', err);
    return { success: false, error: err.message };
  }
}
```

### Snippet 3 — Rateio proporcional para mês (CF `closeMonth`)

```js
function splitVacationAcrossMonth(vacReq, year, month) {
  const monthStart = brMidnightUTC(year, month - 1, 1);
  const monthEnd = brMidnightUTC(year, month, 0);
  monthEnd.setUTCHours(23 + BR_OFFSET_HOURS, 59, 59, 999);
  
  let daysInMonth = 0;
  const periodsClipped = [];
  
  for (const p of (vacReq.periods || [])) {
    const ps = p.startDate.toDate();
    const pe = p.endDate.toDate();
    
    const clipStart = ps < monthStart ? monthStart : ps;
    const clipEnd = pe > monthEnd ? monthEnd : pe;
    
    if (clipStart > clipEnd) continue;
    
    // ⚠️ CORREÇÃO v2.1 (03/06): usar Math.floor (não Math.round).
    // Quando o mês corrente termina (clipEnd = 23:59:59.999 BR = ms.999 do dia final),
    // a divisão por 86400000 retorna X.9999... e Math.round arredonda pra cima → inflado em 1 dia.
    const days = Math.floor((clipEnd - clipStart) / 86400000) + 1;
    daysInMonth += days;
    periodsClipped.push({ start: clipStart, end: clipEnd, days });
  }
  
  if (daysInMonth === 0) return null;
  
  const proportionalValue = Math.round(
    (vacReq.payment.value * daysInMonth / vacReq.totalDays) * 100
  ) / 100;
  
  return {
    vacationRequestId: vacReq.id,
    periodStart: admin.firestore.Timestamp.fromDate(periodsClipped[0].start),
    periodEnd: admin.firestore.Timestamp.fromDate(periodsClipped[periodsClipped.length-1].end),
    daysInMonth,
    fullPeriodDays: vacReq.totalDays,
    paymentMode: vacReq.payment.mode,
    proportionalValue,
  };
}
```

### Snippet 4 — Integração do `closeMonth` com merge de teacherIds (v2 — CRÍTICO)

```js
// Sprint 6b — entre §7 (agrupa por teacher) e §8 (calcula)
const monthStart = brMidnightUTC(year, month - 1, 1);
const monthEnd = lastDayOfMonth;

const vacSnap = await firestore.collection('vacation_requests')
  .where('status', '==', 'aprovada')
  .where('firstPeriodStart', '<=', monthEnd)
  .get();

const vacsInMonth = vacSnap.docs
  .map(d => ({ id: d.id, ...d.data() }))
  .filter(v =>
       v.lastPeriodEnd && v.lastPeriodEnd.toDate() >= monthStart
    && v.unitId === unitId
    && v.payment
    && v.payment.value > 0
    && v.payment.mode !== 'deferred'
  );

// ⚠️ CRÍTICO v2 — D17: merge teacherIds (com aulas) + teacherIds (só com férias paga)
const vacationOnlyTeacherIds = [...new Set(
  vacsInMonth.map(v => v.teacherId).filter(tid => !teacherIds.includes(tid))
)];
const allTeacherIds = [...new Set([...teacherIds, ...vacationOnlyTeacherIds])];

// Buscar teachers e salaries para o conjunto completo
for (const tid of vacationOnlyTeacherIds) {
  if (!teacherMap[tid]) {
    const doc = await firestore.collection('teachers').doc(tid).get();
    if (doc.exists) teacherMap[tid] = { id: doc.id, ...doc.data() };
  }
  if (!salaryMap[tid]) {
    try {
      const sdoc = await firestore.collection('teacher_salaries').doc(tid).get();
      if (sdoc.exists) salaryMap[tid] = { id: sdoc.id, ...sdoc.data() };
    } catch (_) {}
  }
}

// Criar entry no teacherResults pros vacation-only
for (const tid of vacationOnlyTeacherIds) {
  const teacher = teacherMap[tid] || { id: tid, name: '(desconhecido)', type: 'efetivo' };
  teacherResults.push({
    teacherId: tid,
    teacherName: teacher.name || '(desconhecido)',
    teacherType: teacher.type || 'efetivo',
    classesCount: 0,
    totalHoras: 0,
    hourlyRate: 0,
    effectiveDateUsed: null,
    valorHoras: 0, mealAllowance: 0, transportAllowance: 0, otherBenefits: 0,
    totalOutros: 0,
    valorTotal: 0,
    isInternProportional: false,
    internStipendUsed: null,
    internExcessHours: 0,
    internExcessValue: 0,
    isVacationOnly: true,                       // marca: só pra férias
    vacationDaysInMonth: 0,
    vacationValue: 0,
    vacationDetails: [],
  });
}

// Aplicar splits aos teacherResults
for (const v of vacsInMonth) {
  const split = splitVacationAcrossMonth(v, year, month);
  if (!split) continue;
  
  const tResult = teacherResults.find(t => t.teacherId === v.teacherId);
  if (!tResult) {
    logger.warn('[closeMonth] vacation sem teacher correspondente (não deveria)', { v: v.id });
    continue;
  }
  
  tResult.vacationDaysInMonth = (tResult.vacationDaysInMonth || 0) + split.daysInMonth;
  tResult.vacationValue = Math.round(((tResult.vacationValue || 0) + split.proportionalValue) * 100) / 100;
  tResult.vacationDetails = tResult.vacationDetails || [];
  tResult.vacationDetails.push(split);
}

// Totalizadores
totals.totalVacationDays = teacherResults.reduce((s, t) => s + (t.vacationDaysInMonth || 0), 0);
totals.totalVacationValue = Math.round(teacherResults.reduce((s, t) => s + (t.vacationValue || 0), 0) * 100) / 100;
totals.totalGeral = Math.round((totals.totalValor + totals.totalVacationValue) * 100) / 100;

// Após txn.set(closingRef, ...), atualiza paidInClosingIds
const vacBatch = firestore.batch();
for (const v of vacsInMonth) {
  vacBatch.update(firestore.collection('vacation_requests').doc(v.id), {
    paidInClosingIds: admin.firestore.FieldValue.arrayUnion(closingId),
    updatedAt: now,
  });
}
await vacBatch.commit();
```

### Snippet 5 — Backfill de campos denormalizados (one-shot, obrigatório antes do deploy)

```js
// scripts/backfill-vacation-denorm.js
// Roda 1x antes do deploy do 6b pra popular firstPeriodStart/lastPeriodEnd em requests legados do 6a
'use strict';
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const projectArg = process.argv.find(a => a.startsWith('--project='))?.split('=')[1] || 'staging';
const projectId = projectArg === 'production' ? 'crosstrainer-comissoes' : 'crosstrainer-comissoes-staging';
const credPath = path.join(__dirname, `serviceAccount-${projectArg}.json`);
admin.initializeApp({ credential: admin.credential.cert(require(credPath)), projectId });

const db = admin.firestore();

(async () => {
  const snap = await db.collection('vacation_requests').get();
  let updated = 0, skipped = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.firstPeriodStart && d.lastPeriodEnd) { skipped++; continue; }
    if (!Array.isArray(d.periods) || d.periods.length === 0) { skipped++; continue; }
    
    const firstStart = d.periods.reduce((min, p) => {
      const ts = p.startDate;
      return (!min || ts.toMillis() < min.toMillis()) ? ts : min;
    }, null);
    const lastEnd = d.periods.reduce((max, p) => {
      const ts = p.endDate;
      return (!max || ts.toMillis() > max.toMillis()) ? ts : max;
    }, null);
    
    await doc.ref.update({ firstPeriodStart: firstStart, lastPeriodEnd: lastEnd });
    updated++;
  }
  console.log(`Backfill: ${updated} requests atualizados · ${skipped} pulados`);
  await admin.app().delete();
})();
```

### Snippet 6 — Smoke-6b skeleton (em `scripts/admin.js`)

```js
async function cmdSmoke6b() {
  console.log('\n══════ SMOKE TEST Sprint 6b — Pagamento de Férias ══════\n');
  
  const all = await db.collection('vacation_requests').get();
  const withPayment = all.docs.filter(d => d.data().payment).length;
  const paid = all.docs.filter(d => (d.data().paidInClosingIds || []).length > 0).length;
  console.log(`Total: ${all.size} · Com payment definido: ${withPayment} · Já pagos: ${paid}`);
  
  const byMode = { auto: 0, manual: 0, none: 0, deferred: 0 };
  all.docs.forEach(d => {
    const m = d.data().payment?.mode;
    if (m && byMode[m] !== undefined) byMode[m]++;
  });
  console.log('Por modo:', byMode);
  
  const deferredCount = byMode.deferred;
  console.log(`\nPagamentos pendentes (deferred + sem payment): ${deferredCount + (all.size - withPayment)}`);
  
  // Verifica fechamentos com isVacationOnly
  const closingsSnap = await db.collection('monthly_closings')
    .where('status', '==', 'fechado').get();
  let vacationOnlyCount = 0;
  closingsSnap.docs.forEach(c => {
    const teachers = (c.data().teachers || []).filter(t => t.isVacationOnly);
    vacationOnlyCount += teachers.length;
  });
  console.log(`Teachers em fechamentos com isVacationOnly: ${vacationOnlyCount}`);
  
  // Audit
  const auditPayments = await db.collection('audit_log')
    .where('module', '==', 'ferias')
    .where('type', 'in', ['vacation_payment_set', 'vacation_payment_updated'])
    .orderBy('timestamp', 'desc').limit(10).get();
  console.log(`\nAudit pagamentos: ${auditPayments.size} entries`);
  auditPayments.docs.forEach(d => {
    const a = d.data();
    console.log(`   ${a.type}: ${(a.details || '').slice(0, 100)}`);
  });
  
  console.log('\n══════ FIM SMOKE TEST Sprint 6b ══════\n');
  console.log('Para validação completa C1-C16, rode também: node scripts/fixture-6b.js --project staging');
}
```

---

## 🔁 Observações finais

1. **Reuso de Sprint 4a:** `getEffectiveSalaryAt`, `calculateTeacherHours`, `calculateTeacherValue` já existem em `professores-shared.js` e replicados em `functions/index.js`. Não duplicar.
2. **Reuso de Sprint 4b:** `ReceiptService.print` já abre `receipt.html` em nova aba. Modificação é só no template HTML/CSS.
3. **Reuso de Sprint 6a:** `VacationService` permanece intacto. `VacationPaymentService` é Service novo separado.
4. **Reuso de Sprint 5a:** padrão de fixture (`scripts/fixture-Xa.js`) — espelhar o `fixture-6a.js` pro `fixture-6b.js` durante validação.
5. **Backfill é obrigatório:** sem ele, a query de `closeMonth` ignora vacation_requests legados do 6a.
6. **Timezone:** todas as datas em BR. `brMidnightUTC` e `brComponents` em `functions/index.js`.
7. **Conformidade legal:** D3 (estagiário) e D2 (MAX base) refletem CLT/Lei do Estágio. Mudanças nessas decisões precisam de aprovação do cliente.
8. **Quando travar:** chamar com erro/diff, revisão pontual do trecho.
