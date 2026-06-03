# Sprint 2 — Agenda Semanal (recorrente)
**Objetivo:** Tela funcional de Agenda Semanal por unidade. Admin/Gestão/Supervisão criam, editam e inativam slots recorrentes (template de grade horária). Slot livre por hora:minuto.
**Pré-condições:** ✅ Sprint 1 fechada (`teachers`, `modalities`, `units` populadas e validadas em staging) + ✅ Mini-sprint 1.5 fechada (`teacher_salaries` com `effectiveDate` + VR/VT/Outros).
**Duração estimada:** 1 a 1,5 semanas.

---

## 1. O que esta sprint entrega

Ao final desta sprint:
- Item "📅 Agenda" aparece na sidebar de admin / admin_gestao / supervisao
- Tela de Agenda Semanal renderiza grid de 7 dias × horários, com 1 unidade selecionada por vez (combo de unidade no topo)
- Admin/Gestão/Supervisão pode **criar** um slot recorrente (modal: dia da semana + hora início + hora fim + modalidade + professor + observações)
- Pode **editar** um slot existente (mesmo modal)
- Pode **inativar/reativar** um slot (slot inativo aparece esmaecido)
- Sistema **detecta e alerta** conflito de horário ao salvar:
  - Mesmo professor + mesmo dia + horário sobreposto = bloqueia
  - Mesma sala/horário com outro professor = warning, não bloqueia (academia pode ter 2 modalidades simultâneas)
- Toda operação gera entry em `audit_log` (`module: 'agenda'`, `entityType: 'schedule_slot'`)
- Security Rules das 3 novas coleções (`schedule_templates`, `schedule_slots`, `classes`) deployadas em staging
- Validação completa em staging com 9 critérios de aceite

---

## 2. Escopo claro

### ✅ ENTRA nesta sprint

| Item | Detalhes |
|------|----------|
| Sidebar item "📅 Agenda" | Visível para admin, admin_gestao, supervisao |
| Tela Agenda Semanal | Combo de unidade + grid 7 colunas (Seg–Dom) × horários ordenados |
| Bootstrap automático de template | Ao primeiro acesso de cada unidade, cria 1 `schedule_template` padrão chamado `Grade Padrão {nomeUnidade}` (admin não precisa pensar em templates múltiplos nesta sprint) |
| CRUD de `schedule_slots` | Criar, editar, inativar/reativar slots dentro do template padrão |
| Modal de slot | Dia(s) da semana — **multi-select em criação** (cria N slots em lote) / single em edição + horário início + horário fim (input time) + modalidade (select) + professor (select filtrado por modalidade) + observações |
| Conflito de horário | Detecção client-side antes de salvar + revalidação no SalaryService.upsert |
| Visual de slot no grid | Card colorido (cor por modalidade), nome do professor, horário, modalidade |
| Slot inativo | Aparece esmaecido no grid com badge "inativo" |
| Filtro de visualização | Toggle "Mostrar inativos" no header (default: oculto) |
| Audit log | Entry em cada criação/edição/inativação |
| Security Rules | `schedule_templates`, `schedule_slots`, `classes` deployadas em staging |
| Validação | Smoke test ponta-a-ponta com 9 critérios |

### ❌ NÃO ENTRA (vai para sprints futuros)

| Item | Sprint |
|------|--------|
| **Geração automática de `classes`** (Cloud Function semanal) | Sprint 3 |
| **Lançamento em Lote avançado** (criar slots em período de N meses com exclusões/feriados) | Sprint 2.5 ou 3 — modal já cria em vários dias da semana de uma vez, mas avançado (período/exclusões) fica pra depois |
| **Visão "Minha Agenda" do professor** | Sprint 3 |
| **Visão "Agenda Geral" do professor** | Sprint 3 |
| **Substituições** | Sprint 3 |
| **Aulas avulsas** (criar `classes` sem template) | Sprint 3 |
| **Status da aula** (prevista/realizada/cancelada) | Sprint 3 (depende de `classes`) |
| **Múltiplos templates por unidade** (ex: "Grade Verão", "Grade Inverno") | Sprint 2.5 |
| **Feriado/calendário** (ajuste automático de aulas em feriado) | Sprint 4 |
| **Drag-and-drop de slot** entre dias/horários | Backlog (UX) |
| **Visão mensal/anual** | Backlog (UX) — começamos só com semanal |

---

## 3. Arquivos a criar/modificar nesta sprint

```
crosstrainer-comissoes/
├── professores.html                   ← MOD — adicionar página de agenda + modal + CSS
├── professores.js                     ← MOD — registrar 'agenda' em PROF_PAGES e PAGE_DEFINITIONS
├── professores-shared.js              ← MOD — ScheduleTemplateService + ScheduleSlotService + helpers de horário/conflito
├── professores-agenda.js              ← NOVO — telas e modais da agenda
├── firestore.rules                    ← MOD — regras pras 3 novas coleções
└── (demais arquivos intocados)
```

Decisão arquitetural:
- **Manter padrão** estabelecido na Sprint 1: services em `professores-shared.js`, UI específica em arquivo próprio.
- **Não consolidar** UI de agenda em `professores-cadastro.js` — agenda é domínio diferente e o arquivo já está em 1823 linhas.

---

## 4. Wireframe → código

Referência: `AgendaWireframes_design.html` (seção de agenda semanal).

| Elemento do wireframe | Componente no código |
|----------------------|---------------------|
| Combo "Unidade" no topo da tela | `renderAgendaToolbar()` em `professores-agenda.js` |
| Grid semanal 7 colunas | `renderWeeklyGrid()` |
| Card de slot dentro de uma célula | `renderSlotCard(slot)` com cor por modalidade |
| Botão "+ Novo slot" | Abre `openSlotModal(null)` |
| Click em slot existente | Abre `openSlotModal(slotId)` (modo edit) |
| Header com dias da semana | `renderWeekdayHeader()` |
| Modal "Novo slot / Editar slot" | Bloco `<div class="modal" id="slotModal">` em `professores.html` |
| Indicador de conflito | Toast `error` + texto vermelho dentro do modal |
| Toggle "Mostrar inativos" | Switch no topo da tela, hidrata `AgendaState.showInactive` |

---

## 5. Schemas — coleções tocadas

### `schedule_templates/{templateId}` — 1 por unidade (auto-criado)
```js
{
  unitId: 'unit-cp',
  name: 'Grade Padrão CrossTainer CP',
  isActive: true,
  validFrom: Timestamp,                 // = createdAt (sem janela de validade nesta sprint)
  validTo: null,
  createdAt, createdBy, updatedAt, updatedBy,
}
```

### `schedule_slots/{slotId}` — recorrente
```js
{
  templateId: 'tpl-cp-default',
  unitId: 'unit-cp',
  weekday: 1,                            // 0=Dom, 1=Seg, ..., 6=Sáb
  startTime: '07:00',                    // string HH:MM
  endTime: '08:00',                      // string HH:MM
  durationMinutes: 60,                   // calculado server-side / client-side antes de salvar
  modalityId: 'mod-crossfit',
  teacherId: 'tch-lucas',
  isActive: true,
  notes: '',
  createdAt, createdBy, updatedAt, updatedBy,
}
```

### `classes/{classId}` — **esqueleto somente** (não gerado nesta sprint)
Spec do schema já consolidado em `EspecificacaoTecnica § 2.7`. Security Rule criada nesta sprint mas geração é Sprint 3.

---

## 6. Sequência de implementação (ordem proposta)

Ordem importa. Não pular etapas.

### Etapa 1 — Sidebar + roteamento + Security Rules (~0,5 dia)
- [ ] Em `professores.js`: adicionar `'agenda'` em `PROF_PAGES` para `admin`, `admin_gestao`, `supervisao`
- [ ] Adicionar entrada em `PAGE_DEFINITIONS`: `{ id: 'agenda', label: 'Agenda', icon: '📅', section: 'Operação' }`
- [ ] Em `firestore.rules`: adicionar regras para `schedule_templates`, `schedule_slots`, `classes`:
  - `read`: qualquer usuário autenticado com `moduleAccess.professores`
  - `write`: admin OU admin_gestao OU supervisao
- [ ] Deploy das rules: `firebase deploy --only firestore:rules --project staging`
- [ ] Teste manual: criar `db.collection('schedule_templates').doc('test').set({...})` no console → admin OK, vendedor → permission-denied

### Etapa 2 — Services (~0,5 dia)
- [ ] Em `professores-shared.js`:
  - `ScheduleTemplateService.list(unitId)` · `getOrCreateDefault(unit)` · `update()` · `deactivate()`
  - `ScheduleSlotService.listByUnit(unitId, {includeInactive})` · `create()` · `update()` · `deactivate()` · `activate()`
  - Helpers: `parseTime('07:30')` → `{h:7, m:30}` · `minutesBetween('07:00','08:30')` → 90 · `slotsOverlap(a, b)` → bool
  - `detectConflict(slot, existingSlots)` → retorna array de slots em conflito (mesmo professor + mesmo weekday + sobreposição de horário)
- [ ] Teste manual via console: criar 1 template, criar 2 slots, ver `listByUnit` retornando ambos

### Etapa 3 — Shell da página + toolbar (~0,5 dia)
- [ ] `renderAgendaPage()` em `professores-agenda.js`
- [ ] Toolbar: combo `Unidade` (populado de `UnitService.list()`) + toggle `Mostrar inativos` + botão `+ Novo slot`
- [ ] State local: `AgendaState = { unitId, templateId, slots, showInactive, loading }`
- [ ] Empty state: se não há unidades cadastradas → mensagem orientando criar antes (link "ir para Unidades" futuro)
- [ ] Auto-bootstrap: ao selecionar unidade, chamar `getOrCreateDefault(unit)` → garante 1 template padrão antes de listar slots

### Etapa 4 — Grid semanal de visualização (~1 dia)
- [ ] `renderWeeklyGrid()` — 7 colunas (Seg, Ter, Qua, Qui, Sex, Sáb, Dom)
- [ ] Sem grade de horários fixa (slot livre): cada coluna lista slots ORDENADOS por `startTime`
- [ ] `renderSlotCard(slot)`: nome do professor (formato curto: "L. Mendes"), modalidade, horário, cor de fundo conforme modalidade
- [ ] Slot inativo: opacity 0.45 + badge "inativo" se `showInactive: true`; oculto se `showInactive: false`
- [ ] Cor por modalidade: usar um hash do modalityId pra cor consistente (paleta de 8-10 cores), com fallback cinza
- [ ] Click em card → `openSlotModal(slotId)`
- [ ] Empty state por dia: "Sem aulas" em cinza claro

### Etapa 5 — Modal de criação/edição de slot (~1 dia)
- [ ] Modal `slotModal` em `professores.html` (estilo `teacherModal`):
  - Dia da semana — chip toggle (7 chips, 1 selecionável)
  - Hora início — `<input type="time">`
  - Hora fim — `<input type="time">`
  - Duração — readonly, calculado via `oninput` (mostra "60 min")
  - Modalidade — `<select>` populado de `ModalityService.list()` filtrando ativas
  - Professor — `<select>` populado de `TeacherService.list()` filtrando ativos E que tenham `modalityIds` incluindo a modalidade selecionada (atualiza ao trocar modalidade)
  - Observações — `<textarea maxlength="200">`
- [ ] `SlotFormState` para estado do modal
- [ ] Validações:
  - Dia da semana selecionado
  - Hora início < hora fim
  - Duração ≥ 15 minutos
  - Modalidade selecionada
  - Professor selecionado
  - Professor está apto à modalidade (validação já refletida no select, mas reconfirmar)
- [ ] Detecção de conflito ao tentar salvar:
  - Buscar slots ativos do mesmo professor no mesmo weekday
  - Para cada, verificar sobreposição via `slotsOverlap`
  - Se há conflito → erro: "Conflito com slot já cadastrado (Lucas — Seg 07:30-08:30). Cancele ou ajuste horário."
- [ ] Submit → `ScheduleSlotService.create()` ou `update()` → reload da grade

### Etapa 6 — Inativar / reativar slot (~0,5 dia)
- [ ] Botão "Inativar" no modal de edição (vermelho, com confirm)
- [ ] Botão "Reativar" se já inativo
- [ ] Re-render do grid após operação
- [ ] Audit log: `slot_deactivated` / `slot_activated`

### Etapa 7 — Validação final em staging (~0,5 dia)
- [ ] Smoke test completo:
  1. Login admin → vê item "📅 Agenda" na sidebar
  2. Login vendedor → não vê (sem `moduleAccess.professores`)
  3. Selecionar unidade pela primeira vez → template padrão é criado automaticamente
  4. Criar 5 slots reais (Seg 07h CrossFit, Ter 08h Yoga, etc.) → todos aparecem no grid
  5. Tentar criar slot conflitante (mesmo professor, mesma faixa de horário) → erro clara
  6. Editar slot → muda no grid
  7. Inativar slot → some do grid (ou esmaece se "Mostrar inativos" ON)
  8. Verificar `audit_log` no Firestore Console (entries `slot_created`, `slot_updated`, `slot_deactivated`)
  9. Login supervisão → vê tudo + consegue criar/editar (mesma permissão de admin)
- [ ] Documentar resultados no log de sessões

---

## 7. Critérios de aceite

A sprint só pode ser dada como concluída quando **TODOS** os critérios abaixo passarem:

| # | Critério | Como verificar |
|---|----------|---------------|
| 1 | Item "📅 Agenda" aparece na sidebar do admin | Login com `abluir@gmail.com` → ver item no menu |
| 2 | Vendedor não vê agenda | Login com user vendedor → módulo professores nem aparece (`moduleAccess.professores: false`) |
| 3 | Template padrão criado automaticamente | Selecionar unidade nova → Firestore mostra novo doc em `schedule_templates` |
| 4 | CRUD de slot funciona ponta a ponta | Criar, editar, inativar 3 slots |
| 5 | Conflito de horário é detectado | Tentar criar slot do mesmo professor em horário sobreposto → erro |
| 6 | Slot inativo respeita toggle "Mostrar inativos" | Toggle OFF → some · ON → aparece esmaecido com badge |
| 7 | Cor por modalidade é consistente | Mesma modalidade = mesma cor em todos os dias |
| 8 | Audit log com before/after gravado | Cada criação/edição cria entry com `module:'agenda'`, `entityType:'schedule_slot'` |
| 9 | Módulo de Comissões e Cadastro intocados | Login no `index.html` e em `professores.html` (outras telas) sem regressão |

---

## 8. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|--------------|----------|
| Grid renderizado pesado em telas com 50+ slots | 🟢 Baixa | Renderização vanilla sem virtualization. Se passar de 100 slots por unidade, considerar truncar visualmente |
| Conflito não detectado em race condition (2 admins criam ao mesmo tempo) | 🟡 Média | Aceitamos last-write-wins. Audit log preserva histórico. Validação client + revalidação server-side em sprint posterior |
| Modalidade ou professor cadastrado depois quebra slots existentes | 🟢 Baixa | Slot grava `modalityId` e `teacherId` — render trata "não encontrado" com fallback gracioso |
| Wireframe de agenda não bate pixel-perfect | 🟡 Média | Abrir `AgendaWireframes_design.html` lado-a-lado durante desenvolvimento |
| Slot com `weekday` fora de [0,6] por bug no select | 🟢 Baixa | Validação client + Security Rule (em sprint posterior, regra de schema validation) |
| Cloud Function de geração de `classes` será preciso depois | 🟡 Média | Schema de `classes` já documentado (§ 2.7 spec técnica). Geração entra na Sprint 3, sem retrabalho de schema |

---

## 9. Definições importantes para começar

| # | Decisão | Resposta |
|---|---------|----------|
| D1 | Slot livre (qualquer hora:minuto) ou slot fixo (06h, 07h, 08h...) ? | **Slot livre.** Confirmado na sessão 11 (17/05/2026). `<input type="time">` aceita qualquer horário |
| D2 | Múltiplos templates por unidade nesta sprint? | **Não.** 1 template padrão por unidade, criado automaticamente. Templates múltiplos = backlog Sprint 2.5 |
| D3 | Geração automática de `classes` semanais? | **Não nesta sprint.** Apenas slots recorrentes. Cloud Function de geração = Sprint 3 |
| D4 | Lançamento em Lote? | **Não nesta sprint.** Vai para Sprint 2.5 ou 3 dependendo do feedback após esta |
| D5 | Visão semanal mostra dias da semana de quando? | **Sempre a "semana padrão"** — dias da semana abstratos (Seg/Ter/...), sem datas reais. Datas reais entram com `classes` na Sprint 3 |
| D6 | Conflito de horário do mesmo professor: bloqueia ou alerta? | **Bloqueia** (modal mostra erro e não salva). Mesmo horário com OUTRO professor: permitido (sala compartilhada é caso comum) |
| D7 | Slot inativo: oculto por default? | **Sim** — toggle "Mostrar inativos" no header (default: OFF) |
| D8 | Quantos slots de teste validar? | **5–8 slots** distribuídos em pelo menos 3 dias diferentes e 2 modalidades diferentes |
| D9 | Vamos deployar em produção ao fim da sprint? | **Não.** Aguarda decisão de homologação completa do módulo (regra inviolável #7) |

---

## 10. Após a sprint

Sprint 2 termina quando todos os critérios estiverem ✅. Próximos passos:

- 🟢 **Sprint 2.5 (opcional)** — Lançamento em Lote + múltiplos templates por unidade
- 🟢 **Sprint 3** — Geração de `classes` (Cloud Function semanal) + visões do professor (Minha Agenda + Agenda Geral) + Substituições
- Ainda sem deploy em produção
- `professores.html` continua sendo melhorado
- Wireframe de agenda já validado lado-a-lado com implementação real
