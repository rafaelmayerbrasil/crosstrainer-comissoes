# Sprint 3a — Geração de Aulas + Minha Agenda
**Objetivo:** Sair do plano abstrato (slots recorrentes) e ter aulas REAIS com data exata sendo geradas e visualizadas pelo professor.
**Pré-condições:** ✅ Sprint 2 fechada (`schedule_slots` populados em staging) + ✅ Sprint 0-B (Cloud Functions configuradas).
**Duração estimada:** 1 semana.

---

## 1. O que esta sprint entrega

Ao final desta sprint:
- Cloud Function agendada (`generateClassesForUpcomingWeeks`) roda toda semana e cria instâncias de `classes` para as próximas 4 semanas a partir dos `schedule_slots` ativos
- Cloud Function callable (`generateClassesManual`) permite admin disparar geração manualmente para teste/correção
- Geração é **idempotente** — ID do doc composto por `${slotId}_${YYYYMMDD}` evita duplicatas se a CF rodar 2x
- Cada `classes` nasce com `status: 'prevista'`
- Sidebar do professor ganha item "📅 Minha Agenda"
- Tela "Minha Agenda" mostra as aulas do próprio professor logado, ordenadas por data, com filtros (semana atual / próxima / passadas)
- Admin/Gestão/Supervisão pode alterar status de uma aula via modal: `prevista`, `realizada`, `cancelada`, `não_realizada` (status `substituída` só via fluxo de Substituição — Sprint 3b)
- Toda alteração de status grava em `audit_log` com `before/after`
- Validação completa em staging com 8 critérios

---

## 2. Escopo claro

### ✅ ENTRA nesta sprint

| Item | Detalhes |
|------|----------|
| Cloud Function agendada | `generateClassesForUpcomingWeeks` — roda toda segunda-feira às 02:00 BRT, gera próximas 4 semanas |
| Cloud Function callable manual | `generateClassesManual({weeksAhead, dryRun})` — admin chama via console pra teste/preview |
| Geração idempotente | `classes/{slotId}_{YYYYMMDD}` — re-rodar não duplica |
| Detecção de exclusões | Pula slots inativos e weekdays sem slot ativo |
| Sidebar item "📅 Minha Agenda" | Visível para `professor` e `professor_estagiario` |
| Tela "Minha Agenda" | Lista de aulas do professor logado, agrupadas por dia, com filtros temporais |
| Vinculação `users/{uid}.professorId` → `teachers/{teacherId}` | Resolução: professor logado descobre suas aulas via `where('teacherId', '==', this.professorId)` |
| Modal de aula | Mostra detalhes + (para admin/gestão/supervisao) permite mudar status com motivo opcional |
| Status: prevista / realizada / cancelada / não_realizada | Substituída fica pra Sprint 3b |
| Audit log de mudança de status | `class_status_changed` com `before/after` |
| Filtro temporal | Semana atual · Próxima semana · Semana anterior · Mês inteiro |
| Empty state | "Nenhuma aula nesta semana" / "Você ainda não está vinculado a um cadastro de professor" |
| Smoke test | 8 cenários, validação humana |

### ❌ NÃO ENTRA (vai para Sprint 3b ou posterior)

| Item | Sprint |
|------|--------|
| Tela "Agenda Geral" (visão multi-unidade pelo professor) | Sprint 3b |
| Substituições (direta + cobertura aberta) | Sprint 3b |
| Status `substituída` | Sprint 3b (gerado pelo fluxo de substituição) |
| Notificações por email | Sprint 7 |
| Notificações in-app (sino no header) | Sprint 3b (junto com Substituições) |
| Feriado automático (CF detecta e marca isHoliday) | Sprint 4 |
| Fechamento mensal | Sprint 4 |
| Drag-and-drop pra reagendar | Backlog |

---

## 3. Arquivos a criar/modificar nesta sprint

```
crosstrainer-comissoes/
├── functions/
│   └── index.js                       ← MOD — adicionar generateClassesForUpcomingWeeks + Manual
├── professores.html                    ← MOD — page-minha-agenda + modal de aula + CSS
├── professores.js                      ← MOD — PROF_PAGES['professor'] + handler navigateTo
├── professores-shared.js               ← MOD — ClassService (list, get, updateStatus) + helpers de data
├── professores-agenda.js               ← MOD — funções de "Minha Agenda" (não é tela de admin, mas reuso de helpers)
└── firestore.indexes.json              ← MOD — índice composto pra query (teacherId + scheduledDate)
```

Decisão arquitetural:
- "Minha Agenda" vai em `professores-agenda.js` (mesmo domínio de agenda). Se o arquivo crescer demais (>1000 linhas), refatoramos em sprint posterior.
- Cloud Function fica em `functions/index.js` (mesmo padrão do `healthCheck`).

---

## 4. Schemas

### `classes/{classId}` — instância real gerada pela CF
ID composto: `${slotId}_${YYYYMMDD}` (ex: `slot-abc-123_20260520`)

```js
{
  slotId: 'slot-abc-123',
  templateId: 'tpl-cp-default',
  unitId: 'unit-cp',
  teacherId: 'tch-lucas',                // professor atual (igual originalTeacherId nesta sprint)
  originalTeacherId: 'tch-lucas',        // professor original do slot

  modalityId: 'mod-crossfit',
  scheduledDate: Timestamp,              // data exata da aula
  startTime: '07:00',
  endTime: '08:00',
  durationMinutes: 60,

  status: 'prevista',                    // prevista | realizada | cancelada | nao_realizada
  isHoliday: false,                      // Sprint 4 implementa detecção automática
  holidayName: null,
  holidayType: null,

  // Cancelamento (admin pode preencher)
  cancellationReason: null,              // motivo padronizado (futuro: select)
  cancellationNote: null,                // observação livre

  // Ajuste manual de status
  adjustedBy: null,                      // userId do último admin que mudou status
  adjustedAt: null,
  adjustmentNote: null,                  // motivo da mudança

  // Fechamento
  monthClosingId: null,                  // congelado ao fechar mês (Sprint 4)

  generatedAt: Timestamp,                // quando a CF gerou
  generatedBy: 'cf-scheduled' | 'cf-manual',
  createdAt, updatedAt,
}
```

---

## 5. Cloud Function — `generateClassesForUpcomingWeeks`

### Lógica
1. Query: `db.collection('schedule_slots').where('isActive', '==', true).get()`
2. Para cada slot:
   - Calcular as próximas 4 datas em que `data.getDay() === slot.weekday`
   - Para cada data, montar `classId = ${slotId}_${YYYYMMDD}`
   - `db.collection('classes').doc(classId).get()`
     - Se já existe: skip
     - Se não existe: criar com `status: 'prevista'`, `teacherId = slot.teacherId`, `originalTeacherId = slot.teacherId`, `generatedBy: 'cf-scheduled'`
3. Logar quantas foram criadas e quantas puladas

### Trigger
- Schedule: `0 2 * * 1` (toda segunda às 02:00) — timezone `America/Sao_Paulo`
- Timeout: 540s (limit padrão é o suficiente)
- Memory: 256 MiB

### Callable manual
- `generateClassesManual({ weeksAhead = 4, dryRun = false })`
- Verifica caller é admin via custom claim ou query em `users/{uid}.profiles`
- Se `dryRun`: retorna {created: 0, wouldCreate: N, sample: [...]}
- Útil pra:
  - Primeira execução (popular sem esperar segunda-feira)
  - Testar mudanças na lógica antes de schedule
  - Re-popular após admin mudar `schedule_slots`

### Idempotência crítica
ID composto `${slotId}_${YYYYMMDD}` garante que se a CF roda 2x na mesma semana, não duplica. Se admin **edita** um slot (muda horário/modalidade/professor), as `classes` já geradas mantêm os dados antigos congelados — comportamento aceito: mudança no slot afeta só as próximas gerações. Se admin quiser propagar pra aulas futuras já geradas, vira sprint posterior (regerar com confirmação).

---

## 6. Sequência de implementação

### Etapa 1 — Vinculação user ↔ teacher (~0,5 dia)
- [ ] Decidir: `users/{uid}.professorId` ou query reversa por email?
- [ ] Helper em `professores.js`: `getCurrentProfessorId()` que lê `AppState.userProfile.professorId`
- [ ] Migração inline opcional: se user é `professor` e não tem `professorId`, tentar match por email com `teachers/{tid}.email`
- [ ] Teste manual: setar `users/{abluir-uid}.professorId = 'tch-lucas'` no console pra teste

### Etapa 2 — Cloud Function (~1 dia)
- [ ] Adicionar `onSchedule` em `functions/index.js`
- [ ] Implementar `generateClassesForUpcomingWeeks` (lógica acima)
- [ ] Implementar `generateClassesManual` (callable, com `dryRun`)
- [ ] Deploy: `firebase deploy --only functions --project staging`
- [ ] Smoke test via console: criar 2 slots, chamar `generateClassesManual({weeksAhead:2})`, ver classes no Firestore
- [ ] Verificar idempotência: chamar de novo, confirmar que nada duplica

### Etapa 3 — Índice composto + Services (~0,5 dia)
- [ ] `firestore.indexes.json`: índice composto `classes (teacherId ASC, scheduledDate ASC)` pra query do professor
- [ ] Deploy: `firebase deploy --only firestore:indexes --project staging`
- [ ] `professores-shared.js`: `ClassService.listByTeacher(teacherId, {from, to})` · `getById(classId)` · `updateStatus(classId, newStatus, note?)`
- [ ] Helpers: `getStartOfWeek(date)`, `getEndOfWeek(date)`, `formatDateBR(timestamp)`

### Etapa 4 — Sidebar + roteamento (~0,5 dia)
- [ ] `professores.js`: adicionar `'minha-agenda'` em `PROF_PAGES['professor']` e `['professor_estagiario']`
- [ ] Nova entrada em `PAGE_DEFINITIONS`: `{ id: 'minha-agenda', label: 'Minha Agenda', icon: '📅', section: 'Minhas aulas' }`
- [ ] Handler em `navigateTo`: chamar `renderMinhaAgendaPage()`
- [ ] Adicionar `<div class="page" id="page-minha-agenda"></div>` em `professores.html`

### Etapa 5 — Tela "Minha Agenda" (~1,5 dia)
- [ ] `renderMinhaAgendaPage()` em `professores-agenda.js`
- [ ] Verifica `getCurrentProfessorId()`. Se vazio: empty state explicativo + instrução pro admin
- [ ] Toolbar: filtro temporal (chip toggle: Semana atual · Próxima · Anterior · Mês inteiro)
- [ ] Carrega via `ClassService.listByTeacher(profId, {from, to})`
- [ ] Render agrupado por data (cards verticais)
- [ ] Cada card: horário + modalidade + unidade + status (badge colorido) + cor de borda por status
- [ ] Click em card → abre modal de aula

### Etapa 6 — Modal de aula (~1 dia)
- [ ] Modal `classModal` em `professores.html`
- [ ] Mostra: data formatada · horário · modalidade · unidade · professor · status atual · status histórico (do audit_log)
- [ ] **Se professor logado**: read-only com nota "Para mudar status, fale com a gestão"
- [ ] **Se admin/gestão/supervisao**: select de status + textarea de motivo (opcional) + botão Salvar
- [ ] Submit → `ClassService.updateStatus(classId, newStatus, note)` → reload da lista

### Etapa 7 — Smoke test em staging (~0,5 dia)
- [ ] Criar 3-5 slots em diferentes dias da semana via tela de Agenda (já existe da Sprint 2)
- [ ] Chamar `generateClassesManual()` via console
- [ ] Verificar `classes` no Firestore: número correto, datas certas, `status: 'prevista'`
- [ ] Re-chamar `generateClassesManual()` → nenhum duplicado criado
- [ ] Vincular `users/{abluir-uid}.professorId` a um teacher existente
- [ ] Login como admin → ver "Minha Agenda" (admin também pode ter `professorId` pra teste)
- [ ] Mudar status de uma aula via modal → audit_log registra
- [ ] Documentar resultados no log de sessões

---

## 7. Critérios de aceite

| # | Critério | Como verificar |
|---|----------|---------------|
| 1 | CF agendada deploya sem erro | `firebase functions:list --project staging` mostra `generateClassesForUpcomingWeeks` schedule |
| 2 | Geração manual cria classes corretas | `generateClassesManual({weeksAhead:4})` cria N×4 classes (N = nº de slots ativos) |
| 3 | Geração é idempotente | Re-rodar → `{created:0, skipped: N×4}` |
| 4 | Status default é 'prevista' | Todo doc gerado tem `status: 'prevista'` |
| 5 | Sidebar do professor mostra "Minha Agenda" | Login como user com `profiles:['professor']` → item aparece |
| 6 | Lista de aulas filtra por professor logado | Vincular `professorId`, recarregar → só aulas desse professor aparecem |
| 7 | Mudança de status é audit-logged | Mudar pra 'cancelada' → entry `class_status_changed` em audit_log |
| 8 | Zero regressão | Outras telas (Modalidades, Professores, Agenda, ficha+aba salarial) seguem funcionando |

---

## 8. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|--------------|----------|
| Índice composto demora pra construir em staging | 🟢 Baixa | Coleção `classes` ainda pequena. Build < 1 min |
| Cloud Function quota — 4 semanas × 50 slots = 200 docs/semana | 🟢 Baixa | Plano Spark suporta. Monitorar se passar de 1000/semana |
| Professor logado sem `professorId` vinculado | 🟡 Média | Empty state amigável + instrução clara. Admin precisa vincular manualmente nesta sprint |
| CF roda mas professor edita slot depois → classes futuras "desatualizadas" | 🟡 Média | Aceito: mudança no slot só afeta futuras gerações. Documentar como decisão D5 |
| Confusão entre `teacherId` e `originalTeacherId` em `classes` | 🟡 Média | Nesta sprint sempre são iguais. Divergem só com Substituições (Sprint 3b) |
| CF callable acionada por não-admin | 🟢 Baixa | Validação no início da função: ler `users/{uid}` e checar profiles |

---

## 9. Definições importantes para começar

| # | Decisão | Resposta |
|---|---------|----------|
| D1 | Sprint inteira ou quebrar? | **3a + 3b separadas.** Confirmado na sessão 12. 3a = geração + Minha Agenda. 3b = Agenda Geral + Substituições |
| D2 | Notificações por email? | **Não.** In-app fica pra 3b. Email = Sprint 7 |
| D3 | Janela de geração | **4 semanas rolling.** CF roda toda segunda 02:00 BRT |
| D4 | Quem pode mudar status da aula? | **Admin / admin_gestao / supervisao.** Professor visualiza. Spec § 6.3 implica que regra é da gestão |
| D5 | Mudança no slot afeta classes já geradas? | **Não.** Slot alterado afeta só próximas gerações. Classes existentes ficam congeladas. Regerar manualmente se precisar |
| D6 | Default automático "realizada"? | **Não nesta sprint.** Status vira `prevista` na geração e fica assim até admin ajustar. RF6.3 sugere automação, mas implementar agora atrapalha validação. Vira backlog |
| D7 | Como vincula `users/{uid}` ↔ `teachers/{tid}`? | **Campo `professorId` em `users/{uid}`.** Setado manualmente nesta sprint. Auto-match por email = backlog |
| D8 | Aulas no passado: editáveis? | **Sim, admin pode editar status de aula passada.** Sprint 4 (Fechamento) congela aulas com `monthClosingId` |
| D9 | Deploy em produção ao fim? | **Não.** Aguarda homologação completa do módulo |

---

## 10. Após a sprint

Sprint 3a termina quando os 8 critérios passarem. Próximo passo:

- 🟢 **Sprint 3b** — Agenda Geral (multi-unidade, read-only) + Substituições (direta + cobertura aberta) + notificações in-app (sino no header)
- 🟢 **Sprint 4** — Fechamento mensal + cálculo de horas + feriado automático
- 🟢 **Sprint 5** — Escalas especiais
- Ainda sem deploy em produção
