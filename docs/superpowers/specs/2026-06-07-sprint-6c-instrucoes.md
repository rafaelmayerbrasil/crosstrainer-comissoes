# Sprint 6c — Instruções pra Equipe de Desenvolvimento

**Para:** Equipe de desenvolvimento
**De:** Rafael (cliente)
**Data:** 07/06/2026
**Sprint:** 6c — Controle Anual de Saldo de Férias

---

## 📌 Instrução geral

**Playbook canônico:** [`sprint-6c-controle-anual-saldo.md`](../../../sprint-6c-controle-anual-saldo.md) (723 linhas, 5 snippets de código orientativos).

**Sigam a versão atual. Leiam integralmente antes de começar.** Diferente do 6b, **não há versão anterior** — é spec única e definitiva.

---

## 1. Resumo do escopo

| Item | Status |
|------|--------|
| **Saldo por professor** (já tirou X / faltam Y) | ✅ Entra |
| **Período aquisitivo CLT** por professor (12 meses de admissão) | ✅ Entra |
| **Alerta de férias vencidas** (>2 anos sem tirar) | ✅ Entra |
| **Painel histórico** anual por professor | ✅ Entra |
| Pagamento dobrado automático de vencidas | ❌ Backlog (admin trata manual via 6b) |
| Bloqueio hard de pedido excedente | ❌ Decisão fechada: soft warning |
| Carry forward entre períodos | ❌ Backlog (CLT não permite) |

---

## 2. Decisões fechadas com o cliente (não reavaliem)

| # | Decisão | Resposta |
|---|---------|----------|
| D1 | Escopo | **Pacote completo** — confirmado 07/06 |
| D2 | Validação ao exceder saldo | **Soft warning** (não bloqueia, mas exige justificativa) — confirmado 07/06 |
| D3 | Definição de "ano" | **Período aquisitivo CLT por professor** (12 meses a partir de hireDate / internshipStartDate) — confirmado 07/06 |
| D4 | Quem tem direito | Efetivo + estagiário. Eventual mantém comportamento 6a (sem direito) |
| D5 | Direito CLT estagiário | **30 dias por período aquisitivo** (Lei 11.788/2008) |
| D6 | Fallback se data ausente | Usa `teacher.createdAt` + flag `estimatedStartDate: true` |
| D7 | Status considerados no cálculo | **Apenas `status='aprovada'`** |
| D8 | Atribuição de férias a período | Pelo `firstPeriodStart` — onde cai o início |
| D9 | Período concessivo | **12 meses após o aquisitivo** (CLT Art. 134) |
| D11 | Carry forward | Não permite |
| D12 | Cache | Não — computado on-the-fly |
| D13 | Auditoria de vencidas | **1x por dia** (dedup via `metaDayKey`) |

---

## 3. Características da sprint

**Mais leve que 6b — atenção pra não overengineering:**

- ❌ **Sem nova coleção** — tudo computado on-the-fly a partir de `teachers` + `vacation_requests`
- ❌ **Sem nova Cloud Function**
- ❌ **Sem novos índices Firestore**
- ❌ **Sem alteração em Security Rules** — só leitura de dados já existentes
- ✅ **Frontend-only** — `professores-shared.js` + `professores-ferias.js` + `professores.html` + `professores.js`
- ✅ **Smoke e fixture** em `scripts/admin.js`

**Deploy esperado:** apenas `firebase deploy --only hosting --project staging`.

---

## 4. Sequência de implementação

7 etapas (~4-5 dias úteis no total):

1. **Etapa 1** (~1 dia) — Helpers de período aquisitivo + `VacationBalanceService` em `professores-shared.js`
2. **Etapa 2** (~1 dia) — UI Admin "📊 Saldos de Férias" com tabela + status colorido + modal detalhe
3. **Etapa 3** (~0,5 dia) — UI Professor "📊 Meu Saldo" com card + histórico
4. **Etapa 4** (~0,5 dia) — Aviso inline + soft warning no modal do 6a
5. **Etapa 5** (~0,5 dia) — Alerta de vencidas + `checkAndLogOverdue()` idempotente
6. **Etapa 6** (~0,5 dia) — Comandos `admin.js` + smoke-6c
7. **Etapa 7** (~0,5 dia) — Deploy + validação

**Snippets 1-5 do playbook** têm código orientativo pra cada uma. Não precisam ser copiados ipsis litteris — usem como guia.

---

## 5. 12 Critérios de aceite

Listados no §7 do playbook. Vou validar cada um após a entrega via inspeção de código + fixture-6c + UI manual.

---

## 6. Atenção em pontos delicados

### A. Cálculo de `addMonths` com fim de mês

Caso esperado: prof admitido em 31/01/2024.
- `addMonths(31/01/2024, 1)` → não pode virar 03/03 (overflow do Date JS). Deve voltar pra 29/02/2024 (ano bissexto) ou 28/02 (ano comum).
- Helper do Snippet 1 trata isso. **Não confiem em `setMonth` direto sem cuidado.**

### B. Filtro de `status='aprovada'`

- Cancelada (após aprovação) NÃO conta no saldo. Status virou 'cancelada' → não entra no `where`.
- Pendente NÃO conta. Pode entrar na UI como "aviso adicional" ("X pedidos pendentes deste prof"), mas não no saldo numérico.

### C. Atribuição de férias entre períodos aquisitivos

- Critério oficial: **pelo `firstPeriodStart`**. Se cai em período 3, conta em período 3 — mesmo que avance pro 4.
- Simplifica matemática e evita ambiguidade.

### D. Idempotência do audit de vencidas

- Dedup via campo novo `metaDayKey: 'YYYY-MM-DD'` em `audit_log`.
- Query antes de gravar: se já existe entry hoje pro mesmo `entityId`, **pula**.
- Sem esse cuidado, o painel admin gera 1 audit cada vez que abre = ruído.

### E. Fallback de data ausente

- Se prof não tem `hireDate` nem `internshipStartDate`, usar `createdAt`. Marcar `estimatedStartDate: true`.
- UI deve mostrar isso com ícone ou badge ~est ("data estimada — confirme com admin").
- Admin pode editar o cadastro pra corrigir a data correta.

---

## 7. Pré-deploy checklist

Antes de pedir validação minha:

- [ ] Todos os arquivos rodam `node --check` ou linter local sem erro
- [ ] Testem o cálculo de `addMonths` em pelo menos 3 casos extremos (31/01 + 1m, 28/02 + 12m, 31/12 + 1m)
- [ ] Verifiquem que prof eventual NÃO aparece na tabela admin (filtrado no `getAllBalances`)
- [ ] Confirmem que `checkAndLogOverdue` é idempotente (chamar 2x no mesmo dia → 1 audit)
- [ ] Soft warning REALMENTE deixa criar o pedido (não vire bloqueio sem querer)

---

## 8. Próximos passos

1. **Leiam o playbook integralmente** — especialmente §6 (decisões), §7 (critérios) e Snippets 1-5
2. **Sigam as 7 etapas em ordem.** Mudanças de ordem geralmente quebram dependências
3. **Quando entregar em staging**, eu rodo:
   - Inspeção de código nos pontos críticos (helpers `addMonths`, `getBalance`, soft warning)
   - `smoke-6c` + fixture-6c
   - UI manual (painel admin + painel professor + modal solicitação com excesso)
4. **Não fazer deploy em produção.** Regra mantida: módulo só vai pra prod quando TODAS as sprints estiverem ✅

**Estimativa total:** 4-5 dias úteis pra entregar + 1 dia minha pra validar.

---

**Boa sprint.** Foco no D9 (período concessivo CLT) e D6 (fallback de data) — esses são os mais sutis.

*— Rafael*
