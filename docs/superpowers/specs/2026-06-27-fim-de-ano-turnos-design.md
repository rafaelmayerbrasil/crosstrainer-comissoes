# Design — Fim de Ano por Turnos (Manhã / Tarde-Noite)

> **Data:** 2026-06-27 · **Status:** design (modo autônomo /loop — aguarda revisão async)
> **Origem:** respostas do Rodrigo (`docs/rodrigo-engajamento-escala-COMPLETO-respostas.txt`): A1/A4 + comentário "dividir por períodos manhã e tarde/noite"; A2 carga igual; A3 24/12 fechado default.
> **Base:** reusa a Feature 1 (`docs/superpowers/specs/2026-06-27-publicar-escala-agenda-preferencia-design.md`).

## 1. O que muda

Hoje o fim de ano gera **2 vagas/dia/unidade de dia inteiro** (`templateSlotsFimDeAno`, `for i=1..2`, sem horário). O Rodrigo pediu **turnos**: dividir o dia em **Manhã** e **Tarde/Noite**. Com turno, cada vaga ganha horário → a publicação na agenda (Feature 1) passa a funcionar pro fim de ano também.

## 2. Decisões (configurável-first)

| # | Decisão | Escolha |
|---|---------|---------|
| Turnos | quais e que horário | **Configuráveis** em `scale_config.fimDeAnoShifts`. Default: Manhã 08:00–12:00 · Tarde/Noite 16:00–21:00 |
| Pessoas/turno | quantos por turno por unidade | **Configurável** `scale_config.fimDeAnoPeoplePerShift`. **Default = 1** (1 manhã + 1 tarde/noite = mantém "2 pessoas/dia/unidade", agora por turno). *Decisão a confirmar com o usuário/Rodrigo; default cobre o caso descrito.* |
| 24/12 | fechado ou meio período | **Fechado por padrão** (A3), com opção da gestão **abrir** (checkbox no modal). Acaba o conceito de "meio período". |
| Unidades | quais abrem | **Seleção no modal** (checkboxes; todas marcadas por padrão). Refina o "gera p/ todas". |
| Carga | ritmo | A2: **distribuição justa por turnos** (reusa motor; cada pessoa ≤ 1 turno/dia; fairness espalha → todos com nº de turnos ~igual). Sem rodízio forçado. |

## 3. Modelo de dados

- `scale_config` (Feature 1) ganha:
  - `fimDeAnoShifts: [{ id:'manha', label:'Manhã', startTime:'08:00', endTime:'12:00' }, { id:'tarde_noite', label:'Tarde/Noite', startTime:'16:00', endTime:'21:00' }]`
  - `fimDeAnoPeoplePerShift: 1`
- Slot do fim de ano passa a ser: `{ id:'${day}_${unitId}_${shiftId}_${i}', day, unitId, shift:shiftId, startTime, endTime, requiredModalityId:null, assignedPersonId:null }`.

## 4. Componentes

- **`scale-service.js`**
  - `templateSlotsFimDeAno(period, units, shifts, peoplePerShift)` — gera por dia (não-fechado) × unidade × turno × pessoas, com `startTime/endTime` do turno. (`halfDays` deixa de ser usado; assinatura antiga sem `shifts` cai num default interno p/ compat de smoke.)
  - `ScaleConfigService` default ganha `fimDeAnoShifts` + `fimDeAnoPeoplePerShift`.
  - `publishToAgenda` — usar `s.day || scale.date` na `scheduledDate` (suporta multi-dia). `consolidateByDay` segue igual (agrupa por `day`; `assigned` no motor garante ≤1 turno/pessoa/dia).
- **`professores-escala-smart.js`**
  - Modal do fim de ano: período + **checkboxes de unidades** + **turnos editáveis** (horários) + **24/12 abre?** (checkbox, default fechado). `criarEscalaFimDeAno` monta `period` (24/12 em `closedDays` por default) e chama `templateSlotsFimDeAno` com shifts/peoplePerShift do config.
  - `renderFimDeAnoDetail`: mostrar por dia → unidade → **turno** (Manhã / Tarde-Noite) com a pessoa/vaga. Botão **Publicar/Despublicar** (reusa Feature 1) quando consolidada.
- **`scripts/smoke-scale-service.js`** — asserts de `templateSlotsFimDeAno` com turnos + publish multi-dia (scheduledDate por `day`).

## 5. Fluxo

1. Gestão abre "Nova escala → Fim de ano": escolhe período, unidades, turnos (default preenchido), 24/12 (fechado).
2. Cria → slots por dia×unidade×turno. Abre janela → colaboradores marcam preferência (Prefiro/Pode ser/Não posso — Feature 1).
3. Consolidar (`consolidateByDay`) → cada pessoa ≤1 turno/dia, carga espalhada. Não-escalados sinalizados (gestão lança férias — já existe).
4. **Publicar na agenda** (Feature 1, agora multi-dia) → cria 1 aula por turno preenchido, na data do dia, hora normal.

## 6. Pagamento

Hora normal (B1). "Feriado dobra" (A4) = folha via `isHoliday` — fora daqui (igual Feature 1). A aula publicada grava `isHoliday` quando o dia for feriado (deriva da data; refinamento futuro de detecção de feriado no período).

## 7. Testes

- **Service:** `templateSlotsFimDeAno` com 2 turnos × 1 pessoa = 2 vagas/dia/unidade, com horários certos; 24/12 em closedDays não gera; publish multi-dia grava `scheduledDate` por `day`.
- **Staging:** criar fim de ano (2 unidades, turnos default) → consolidar → ver manhã/tarde por dia → publicar → aulas nas datas certas com horários dos turnos → despublicar.

## 8. Fora de escopo

- Detecção automática de feriado dentro do período (hoje `isHoliday` por tipo; refinamento futuro).
- PLR (Feature 3).
