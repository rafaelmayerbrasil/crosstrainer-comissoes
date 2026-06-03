# Sprint 4a — Fechamento Mensal (consolidação + congelamento)
**Objetivo:** Tela de fechamento mensal por unidade. Admin consolida todas as `classes` realizadas do mês, calcula horas trabalhadas e valor a pagar por professor (com base no `teacher_salaries` + VR/VT/Outros), e congela esses dados via `monthClosingId`. Sem fluxo de pagamento ainda.
**Pré-condições:** ✅ Sprint 3b validada · runbook de pendências executado (deploy do índice + bug D resolvido ou aceito).
**Duração estimada:** 1 semana (~5 dias úteis).

---

## 1. O que esta sprint entrega

Ao final desta sprint:
- Item "💰 Fechamento" aparece na sidebar de admin/admin_gestao (NÃO supervisão — fechamento é exclusivo do admin)
- Tela de fechamento mostra: dropdown de unidade + dropdown de mês/ano + botão "Fechar mês"
- Antes de fechar, exibe **preview** consolidado por professor: nº aulas realizadas, horas totais, valor estimado (R$/hora × horas + bolsa proporcional se estagiário + VR + VT + Outros)
- Botão "Fechar mês" executa a Cloud Function `closeMonth` que:
  - Cria doc em `monthly_closings/{closingId}`
  - Congela todas as `classes` daquele mês setando `monthClosingId` no doc de cada uma
  - Bloqueia edição posterior de status dessas classes
- Após fechamento, a tela mostra o resultado consolidado read-only
- Tela "Histórico de fechamentos" lista todos os meses fechados de uma unidade
- Operações geram `audit_log` com `module: 'fechamento'`
- Validação completa em staging com 10 critérios

---

## 2. Escopo claro

### ✅ ENTRA nesta sprint

| Item | Detalhes |
|------|----------|
| Sidebar item "💰 Fechamento" | Apenas para `admin` e `admin_gestao` |
| Tela de fechamento | Combo unidade + mês/ano + botão de preview + botão de fechar |
| Preview consolidado | Lista de professores com nº aulas, horas, valor estimado · não grava nada |
| Cálculo de horas | Soma `durationMinutes` das `classes` realizadas no mês ÷ 60 |
| Cálculo de valor (efetivo) | `horas × hourlyRate` + VR + VT + soma(Outros) |
| Cálculo de valor (estagiário) | `bolsa fixa` (capped no limite) + `proporcional × horas_excedentes` + VR + VT + soma(Outros) |
| Feriado ×2 | Aulas marcadas `isHoliday: true` contam 2× nas horas (P02) |
| Status que entram | Apenas `realizada` e `substituida` contam pro fechamento; `cancelada` e `nao_realizada` ficam de fora |
| CF `closeMonth` | Cria `monthly_closings/{id}` + batched update em `classes` setando `monthClosingId` |
| Bloqueio pós-fechamento | `ClassService.updateStatus` já tem proteção implementada na Sprint 3a (`monthClosingId != null → erro`) |
| Tela "Histórico de fechamentos" | Lista por unidade ordenada por ano/mês decrescente |
| Tela do fechamento específico | Detalhe do fechamento + lista de professores + valores · read-only se já fechado |
| Audit log | `monthly_closing_created` com `before/after` |

### ❌ NÃO ENTRA (vai pra Sprint 4b ou posterior)

| Item | Sprint |
|------|--------|
| Pagamento (`payment_records`) | Sprint 4b |
| Recibo PDF | Sprint 4b |
| Status pago/pendente por professor | Sprint 4b |
| Reabertura de mês fechado | Backlog (operação delicada, precisa workflow de aprovação) |
| Notificação ao professor sobre fechamento | Sprint 4b (junto com pagamento) |
| Comparativo vs mês anterior | Backlog (UX) |
| Export Excel/PDF | Backlog |
| Ajustes manuais pós-fechamento (correções) | Backlog (precisa workflow de revisão) |
| Feriados automáticos (CF detecta data e marca isHoliday) | Sprint 5 (junto com Escalas Especiais) |
| Vinculação com `comissoes_diferidas` (módulo Comissões) | Não previsto — módulos separados |

---

## 3. Arquivos a criar/modificar

```
crosstrainer-comissoes/
├── functions/
│   └── index.js                       ← MOD — adicionar closeMonth (callable)
├── professores.html                    ← MOD — page-fechamento · CSS
├── professores.js                      ← MOD — PROF_PAGES + handler
├── professores-shared.js               ← MOD — ClosingService + helpers de cálculo
├── professores-fechamento.js           ← NOVO — telas de fechamento + histórico
└── firestore.indexes.json              ← MOD — índices pra monthly_closings
```

Decisão arquitetural:
- Fechamento é domínio próprio → arquivo dedicado (`professores-fechamento.js`)
- Lógica de cálculo de horas/valores fica em `professores-shared.js` (`ClosingService.calculatePreview`) pra ser reutilizável tanto em preview client-side quanto em CF (replicada em `functions/index.js`)

---

## 4. Schemas

### `monthly_closings/{closingId}` — Sprint 4a cria pela primeira vez
ID composto: `${unitId}_${year}-${month}` (ex: `unit-cp_2026-05`)

```js
{
  unitId: 'unit-cp',
  year: 2026,
  month: 5,                              // 1-12

  status: 'fechado',                     // único valor nesta sprint (Sprint 4b adiciona 'pago')
  closedAt: Timestamp,
  closedBy: 'uid-admin',
  closedByName: 'Admin Teste',

  // Consolidação no momento do fechamento (snapshot)
  totals: {
    classesRealizadas: 87,
    classesSubstituidas: 5,
    classesCanceladas: 2,
    classesNaoRealizadas: 1,
    totalHoras: 95.5,
    totalValor: 8420.00,
  },

  // Por professor — array de objetos (até ~50 prof por unidade)
  teachers: [
    {
      teacherId: 'tch-lucas',
      teacherName: 'Lucas Mendes',
      teacherType: 'efetivo',
      classesCount: 22,                   // realizadas + substituídas (que ele assumiu)
      totalHoras: 24.5,
      hourlyRate: 65,                     // snapshot do teacher_salaries no momento
      effectiveDateUsed: Timestamp,       // qual entry do salaryHistory foi usada
      valorHoras: 1592.50,
      mealAllowance: 600,                 // snapshot
      transportAllowance: 250,
      otherBenefits: [{ nome: 'Plano Saúde', valor: 200 }],
      totalOutros: 200,
      valorTotal: 2642.50,                // valorHoras + meal + transport + outros
      isInternProportional: false,        // só true se estagiário com excedente
      internStipendUsed: null,            // só se estagiário (bolsa do mês)
      internExcessHours: null,            // só se estagiário (horas além do limite)
      internExcessValue: null,            // só se estagiário (proporcional do excedente)
    },
    // ...
  ],

  createdAt, updatedAt,
}
```

### Mudança em `classes/{classId}` — campo `monthClosingId` (já existe desde Sprint 3a)
- Estava `null` para todas as classes
- Sprint 4a vai preencher com o `closingId` correspondente ao mês fechado
- Sprint 3a já tem proteção: `ClassService.updateStatus` retorna erro se `monthClosingId != null`

---

## 5. Sequência de implementação

### Etapa 1 — Sidebar + roteamento + Security Rules (~0,5 dia)
- [ ] `professores.js`: `'fechamento'` em `PROF_PAGES[admin]` e `[admin_gestao]` apenas
- [ ] `PAGE_DEFINITIONS` += `{ id: 'fechamento', label: 'Fechamento', icon: '💰', section: 'Financeiro' }`
- [ ] HTML: `<div class="page" id="page-fechamento"></div>`
- [ ] Carregar `<script src="professores-fechamento.js">`
- [ ] `firestore.rules`: regra para `monthly_closings` — read/write apenas admin (não admin_gestao? confirmar D1)

### Etapa 2 — ClosingService + helpers de cálculo (~1 dia)
- [ ] `professores-shared.js`:
  - `ClosingService.preview(unitId, year, month)` — busca classes do mês, agrupa por professor, calcula horas e valor. Retorna estrutura igual à do schema (sem salvar).
  - `ClosingService.getClosingId(unitId, year, month)` → string composta
  - `ClosingService.list(unitId)` → lista fechamentos de uma unidade ordenados por ano/mês desc
  - `ClosingService.getById(closingId)` → detalhe
- [ ] Helpers de cálculo (puros):
  - `calculateTeacherHours(classes, teacher)` → horas (considera feriado ×2)
  - `calculateTeacherValue(teacher, salary, hours, monthDays)` → valor (branch por tipo: efetivo/estagiário)
  - `getEffectiveSalaryAt(salary, date)` → busca a entry de `salaryHistory` válida na data (com `effectiveDate <= date`)
- [ ] Teste manual via console: rodar `ClosingService.preview('unit-cp', 2026, 5)` e validar os totais

### Etapa 3 — Tela de fechamento (preview) (~1 dia)
- [ ] `professores-fechamento.js`:
  - `renderFechamentoPage()` — entry point
  - Toolbar: select unidade + select mês/ano + botão "Carregar preview"
  - Estado `FechamentoState`
- [ ] Renderiza tabela: 1 linha por professor com colunas: nome · tipo · classes · horas · R$ horas · VR · VT · Outros · TOTAL
- [ ] Footer: totalizações da unidade
- [ ] Botão "Fechar mês" — DESABILITADO se já fechado (vai cair na Etapa 5)
- [ ] Empty state: "Nenhuma aula encontrada no período"

### Etapa 4 — Cloud Function closeMonth (~1 dia)
- [ ] `functions/index.js`:
  - `closeMonth` (callable, valida admin) — recebe `{unitId, year, month}`
  - Idempotência: verifica se já existe `monthly_closings/${unitId}_${year}-${month}`, se sim retorna erro
  - Replica lógica de cálculo (igual ao preview client-side)
  - Cria `monthly_closings/{id}` + batched update em todas as `classes` daquele mês setando `monthClosingId`
  - Audit log `monthly_closing_created` com totais
  - Retorna `{success, closingId, totals}`
- [ ] Deploy: `firebase deploy --only functions --project staging`
- [ ] Teste via callable

### Etapa 5 — Tela de fechamento (modo fechado) + Confirmação (~0,5 dia)
- [ ] Quando o mês já está fechado:
  - Tela mostra título "Fechamento — Maio/2026 — CrossTainer CP — FECHADO em DD/MM"
  - Tabela read-only com dados do snapshot (não recalcula, usa `teachers[]` do doc)
  - Bloqueio total — sem botão de fechar de novo
- [ ] Quando preview e usuário clica "Fechar mês":
  - Modal de confirmação: "Confirma fechamento de Maio/2026? Após o fechamento, as N aulas deste período ficarão congeladas."
  - Aceita / Cancela
  - Aceita → chama callable `closeMonth` → ao sucesso, recarrega a tela no modo fechado

### Etapa 6 — Tela de Histórico de fechamentos (~0,5 dia)
- [ ] Submenu / botão "Histórico" no topo da tela de fechamento
- [ ] Tabela com 1 linha por fechamento: mês, total professores, total horas, total valor, link "Ver detalhe"
- [ ] Click no link reabre a tela de fechamento no modo `closed` daquele mês

### Etapa 7 — Smoke test (~0,5 dia)
- [ ] Criar dados de teste: garantir que tem `classes` realizadas + algumas substituídas em pp_2026-05 (mês corrente)
- [ ] Cenários listados na seção 7

---

## 6. Decisões importantes

| # | Decisão | Resposta |
|---|---------|----------|
| D1 | Admin_gestao pode fechar? | **Não — apenas `admin`.** Fechamento envolve dinheiro real, restrito ao mais alto nível. Admin_gestao só vê detalhes (read) |
| D2 | Aceitar fechamento parcial? | **Não.** Fecha o mês inteiro de uma unidade de uma vez. Se quiser ajustar individualmente, é antes de fechar (via status) |
| D3 | Reabertura de mês fechado | **Não nesta sprint.** Backlog se virar necessidade real |
| D4 | Cálculo de horas usa `durationMinutes` da `class` (snapshot) ou recalcula? | **Usa `durationMinutes`.** Snapshot é a fonte da verdade — pode ter sido ajustado manualmente |
| D5 | Feriado ×2 — somar 1 hora extra ou multiplicar valor? | **Multiplicar valor.** Mais simples e fiel à regra "feriado paga em dobro". Horas reportadas = horas reais; valor = horas reais × R$/h × (1 + qtd_feriados/qtd_total) — discutir antes de implementar |
| D6 | Cálculo do estagiário com excedente — qual o threshold? | **`internMonthlyLimitMinutes` do `teacher_salaries`.** Se horas trabalhadas ≤ limite, paga só a bolsa fixa. Se > limite, paga bolsa + (excedente × `internProportionalHourlyRate`) |
| D7 | Snapshot do salário — qual entry usar? | **`salaryHistory` com `effectiveDate <= último dia do mês`.** Última entry válida no fim do mês |
| D8 | VR/VT/Outros — proporcional aos dias trabalhados? | **Não nesta sprint** — paga o valor cheio definido em `teacher_salaries`. Proporcionalidade fica como backlog (regra varia muito por unidade) |
| D9 | Status que NÃO entram no fechamento | `cancelada`, `nao_realizada`. Aceitas: `realizada`, `substituida`. `prevista` no fim do mês = a aula nunca aconteceu, conta como `nao_realizada` automaticamente? **Decisão: aulas `prevista` no momento do fechamento são ignoradas (admin precisa ajustar status antes)** |
| D10 | Deploy em produção ao fim | **Não.** Aguarda homologação completa da Sprint 4 (4a + 4b) |

---

## 7. Critérios de aceite

| # | Critério | Como verificar |
|---|----------|---------------|
| 1 | Item "💰 Fechamento" aparece pra admin | Login admin → ver na sidebar seção "Financeiro" |
| 2 | Não aparece pra supervisao/professor | Login não-admin → item não visível |
| 3 | Preview calcula horas corretamente | Selecionar pp_2026-05 → soma das horas bate com soma manual de `durationMinutes / 60` das aulas |
| 4 | Valor efetivo correto | Lucas (efetivo · R$ 65/h · 24h) → 1560 + VR + VT + Outros |
| 5 | Valor estagiário sem excedente | Estagiário com 25h e limite 30h → paga só `internMonthlyStipend` + benefícios |
| 6 | Valor estagiário com excedente | Estagiário com 35h e limite 30h → paga bolsa + 5h × proporcional + benefícios |
| 7 | Status filtrados corretamente | Aulas `cancelada` e `nao_realizada` não aparecem na contagem |
| 8 | CloseMonth congela classes | Após fechar, abrir alguma class do mês e tentar mudar status → erro "Mês fechado" |
| 9 | Idempotência | Tentar fechar o mesmo mês 2× → erro "Já existe fechamento pra este período" |
| 10 | Histórico mostra fechamento | Aba histórico → linha com o fechamento recém-criado |

---

## 8. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|--------------|----------|
| Cálculo divergir entre client (preview) e CF (closeMonth) | 🟡 Média | Replicar lógica em helper puro, com testes consoles em ambos os ambientes |
| Mês fechado por engano | 🟡 Média | Modal de confirmação com aviso explícito. Operação inreversível na sprint 4a |
| Race condition: 2 admins fechando o mesmo mês | 🟢 Baixa | CF usa transação Firestore na criação do doc — primeiro a chegar pega |
| Bug D (fuso UTC↔BR) afetar agrupamento por mês | 🟡 Média | **Resolver via runbook antes da Sprint 4** (P2). Se não resolvido, decidir aceitar inconsistência ou bloquear Sprint 4 |
| Snapshot salarial errado se admin editou no meio do mês | 🟢 Baixa | `getEffectiveSalaryAt` busca pelo `effectiveDate <= último dia do mês` — funciona corretamente com o B-01 da mini-sprint 1.5 |
| Estagiário com bolsa partida no meio do mês | 🟡 Média | Sprint 4a NÃO trata proporcionalidade por dias — usa snapshot do dia do fechamento. Documentar como limitação |
| Performance do preview em unidades grandes (200+ aulas/mês) | 🟢 Baixa | Aceito. Indexação por unitId + scheduledDate já existe |

---

## 9. Após a sprint

Sprint 4a termina quando os 10 critérios passarem. Próximo passo:

- 🟢 **Sprint 4b** — Pagamentos + Recibos (`payment_records`, status pago/pendente, geração de recibo PDF, notificação ao professor)
- 🟢 **Sprint 5** — Escalas especiais (feriado/sábado/eventos com pesos diferenciados + detecção automática de feriado)
- 🟢 **Sprint 6** — Férias e recesso
- Ainda sem deploy em produção

---

## 10. O que esperar ao executar

1. Você abre nova sessão comigo dizendo "vamos pra Sprint 4a"
2. Eu releio este playbook + memória atualizada
3. Confirmo decisões D1-D10 se ainda válidas
4. Inicio pela Etapa 1 (sidebar + roteamento)
5. Vou marcando ✅ no checklist conforme implemento
6. Ao fim de cada bloco visualmente testável, paro pra você validar com clique humano
7. Smoke test no fim com 10 cenários
8. Memória atualizada na sessão correspondente
