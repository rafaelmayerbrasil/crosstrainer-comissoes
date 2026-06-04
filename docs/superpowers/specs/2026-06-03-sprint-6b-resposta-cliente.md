# Sprint 6b — Resposta do Cliente

**Para:** Equipe de desenvolvimento
**De:** Rafael (cliente)
**Data:** 03/06/2026
**Assunto:** Resposta à avaliação `2026-06-03-sprint-6b-avaliacao-cliente.md`

---

## 📌 Instrução geral

**O playbook `sprint-6b-pagamento-ferias.md` foi revisado e está na versão 2.** Sigam essa versão como fonte única de verdade. Todas as decisões abaixo já estão refletidas lá em §6 (decisões D13-D19 novas) e em §10 (histórico de revisão).

**Não codem com base na versão antiga.** Leiam o playbook v2 integralmente antes de começar.

---

## 1. Respostas aos 6 pontos da avaliação

### Ponto 1 — Fluxo aprovação + pagamento → **Opção A (juntos)**

**Diferente da recomendação do time.** Razão: o cenário "admin aprova e esquece de definir pagamento" leva a férias não-paga após o fechamento mensal, que é IRREVERSÍVEL (regra inviolável #5). Vira problema trabalhista.

Como ficou: modal único com bloco "Pagamento" embutido. Botão secundário "Adiar pagamento" disponível como **escape consciente** (não default) — registra `payment.mode='deferred'`. Sidebar mostra contador `🏖️ Férias (N)` quando há pendências.

Ver D13 e Etapa 3 do playbook.

---

### Ponto 2 — Default do checkbox estagiário → **Condicional ao stipend**

**Diferente da recomendação do time.** Razão **legal**: Lei do Estágio (11.788/2008) Art. 13 §1º:

> "O recesso deverá ser remunerado quando o estagiário receber bolsa ou outra forma de contraprestação."

Default "desmarcado" sugerido era violação legal no caso geral (todos nossos estagiários ativos têm bolsa).

Como ficou:
- `teacher.internMonthlyStipend > 0` → checkbox **vem MARCADO** (lei obriga)
- `teacher.internMonthlyStipend === 0 ou null` → checkbox **vem desmarcado** (estágio sem bolsa, caso raro)

Em ambos os casos, admin pode reverter — mas o default reflete a realidade legal. Tooltip ou ícone "ℹ️" explica a regra na UI.

Ver D3 e Etapa 3.

---

### Ponto 3 — Alerta pós-aprovação → **Sem toast, mas com contador na sidebar**

**Como o Ponto 1 ficou A (juntos), esse ponto perdeu razão original.** Mas mantemos o contador `🏖️ Férias (N)` na sidebar pra cobrir o caso de admin usar "Adiar pagamento".

Ver D19 e Etapa 4.

---

### Ponto 4 — Preview do cálculo → **Opção A (mostrar)**, sem spinner

Concordo com a direção do time, **mas a estimativa "1-2s" está errada**. Query de 12 monthly_closings ordenada é ~300ms. UI não precisa de spinner.

Como ficou:
- Preview **ao vivo** dentro do modal
- Recalcula client-side quando admin troca modo (Auto/Manual) ou `payIntern` ou `manualValue`
- Cache local da query de 12 meses (busca 1x ao abrir modal, reusa)
- Sem spinner — UI sente instantânea

Ver D18 e Etapa 3.

---

### Ponto 5 — Observação obrigatória quando → **Sempre presente, obrigatória em 2 casos**

**Diferente da tabela do time.** Razão: no modo Auto, admin pode querer anotar contexto ("base inflada por aulas extras de janeiro"). Sem campo, contexto se perde.

Como ficou:

| Modo | Campo | Obrigatório? |
|------|-------|--------------|
| Automático | Sempre presente | Não |
| Manual com valor > 0 | Sempre presente | Não |
| Manual com valor = 0 | Sempre presente | **Sim** |
| Sem pagamento | Sempre presente | **Sim** |

Custo de UI = mesmo bloco em todos modos. Audit log fica mais rico.

Ver D15 e Etapa 3.

---

### Ponto 6 — Coluna "Pagamento" → **6 estados, não 4**

A tabela do time estava boa mas **faltava cobrir 2 estados reais**:
- Pagamento **parcial** (férias cruzando 2 meses, 1 fechado, 1 ainda não)
- **Sem pagamento registrado** (diferente de "Pendente — ainda não decidiu")

Como ficou:

| Estado | Mostra | Ação |
|--------|--------|------|
| Não aprovada | `—` | — |
| Aprovada, `mode='deferred'` ou ausente | `⏳ Pendente` | Link `💰 Definir` |
| Aprovada, `mode='none'` | `🚫 Sem pagamento` | Editar se não pago |
| Aprovada, mode∈[auto,manual], não pago | `Auto · R$ 7.200` | Editar |
| Aprovada, totalmente paga | `✓ Pago em jul/26` | — |
| Aprovada, parcialmente paga | `✓ Parcial · jun/26 · resta jul/26` | — |

Ver §5 Etapa 4 do playbook.

---

## 2. Pontos críticos que o time não levantou

Foram identificados na revisão e **estão no playbook como decisões e critérios obrigatórios**:

### A. Professor 100% férias no mês não receberia (BUG LATENTE)

A versão 1 da CF `closeMonth` busca apenas teachers com `validClasses`. Se um professor tira 30 dias seguidos cobrindo o mês inteiro, ele não aparece em `teacherIds` e **a férias dele não entra no fechamento** — silenciosamente perde o pagamento.

**Correção:** `closeMonth` agora **mescla** `teacherIds (com aulas)` ∪ `teacherIds (com férias paga no mês)`. Cria entry com `isVacationOnly: true`.

Ver D17, Snippet 4, e Critério 9.

### B. Base de cálculo subestimada em mês de baixa

Fórmula original "só média 12 meses" pode prejudicar professor que tem mês de baixa atípico no meio do histórico.

**Correção:** base = **`MAX(média 12 meses, valorHoras do último mês)`**. Mais defensável juridicamente — reflete a realidade salarial atual sem diluir.

Filtro adicional: ignorar meses passados com `valorHoras = 0` (já estavam em férias) pra não diluir a média.

Ver D2, Snippet 1 (`_calculateEfetivoAuto`), e Critério 3.

### C. Supervisor não pode mexer em pagamento

Permissão financeira deve ser restrita. Supervisor é perfil operacional.

**Correção:** Security Rule barra `update` em `vacation_requests.payment` ou `paidInClosingIds` se usuário não é `admin` ou `admin_gestao`. CF `closeMonth` usa Admin SDK e bypassa rules normalmente.

Ver D14, Etapa 1 (Security Rules), e Critério 8.

### D. Manual exorbitante sem aviso

Admin pode digitar valor errado em um zero a mais.

**Correção:** UI mostra **alerta visual silencioso** se `manual > 1,5 × auto`. Não bloqueia (autoridade do admin), apenas sinaliza.

Ver D16, Etapa 2 (último parágrafo), e Critério 7.

---

## 3. Itens obrigatórios antes do deploy em staging

**Não pular nenhum desses.** Estão listados nos riscos do playbook (§8) como CRÍTICOS.

1. **Rodar backfill** `scripts/backfill-vacation-denorm.js --project staging` — popula `firstPeriodStart` e `lastPeriodEnd` em vacation_requests legados do 6a. Sem isso, a query do `closeMonth` ignora férias antigas. Snippet 5 do playbook tem o código pronto.

2. **Deploy de índice composto** `(status, firstPeriodStart)` em `firestore.indexes.json`. Sem ele, query do `closeMonth` falha.

3. **Validar Critério 9** (professor 100% férias no mês) com fixture — esse cenário é crítico e fácil de regredir.

4. **Validar Critério 8** (supervisor sem acesso) com auth manual — não dá pra testar via Admin SDK (que bypassa rules).

---

## 4. Próximos passos

1. **Leiam o playbook v2 integralmente** — §10 explica cada mudança com razão.
2. **Sigam as 7 etapas em ordem.** Backfill é parte da Etapa 1 (não esquecer).
3. **Quando entregar em staging**, eu rodo `smoke-6b` + fixture igual fizemos com o 6a. Critérios 1-16 precisam passar antes de marcar a sprint como ✅.
4. **Não fazer deploy em produção.** Regra fechada: módulo só sobe em prod após TODAS as sprints homologadas em staging.
5. **Travou em algum trecho?** Anota o erro/diff e me chama — reviso o ponto específico.

---

**Boa sprint.** Foco no D17 (professor 100% férias) e no D3 (estagiário/Lei do Estágio) — esses dois são os mais sutis.

*— Rafael*
