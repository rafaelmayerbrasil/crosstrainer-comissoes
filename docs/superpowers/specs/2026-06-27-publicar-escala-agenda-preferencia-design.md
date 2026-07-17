# Design — Publicar Escala na Agenda + Preferência (Prefiro / Pode ser / Não posso)

> **Data:** 2026-06-27 · **Status:** design (produzido em modo autônomo /loop — aguarda revisão async do usuário)
> **Origem:** respostas do Rodrigo em `docs/rodrigo-engajamento-escala-COMPLETO-respostas.txt` (B1 = separar; relabel da preferência).
> **Memória:** `novo-modulo-engajamento-pontos`.

## 1. Contexto e descobertas (verificadas no staging)

- A **escala consolidada** (`special_scales`) atribui uma pessoa a um slot `(data, unidade, modalidade)` — mas o slot **não tem horário**. Status: `rascunho → janela_aberta → consolidada`.
- A **grade semanal** (`schedule_slots`) no staging só tem dias úteis (weekday 1/2/3/5). **Sábados (6) e domingos (0) NÃO estão na grade.** As aulas de sábado existentes vieram do `seed-demo` (`slotId=null`), não da CF de geração.
- **Conclusão:** escalas especiais (sábado/feriado/domingo/evento) são **off-grid**. Publicar ⇒ **CRIAR** aulas (`classes`), não reatribuir. Não há risco de duplicar com a grade; o único risco é **publicar 2×** → resolvido por **idempotência** (tag `specialScaleId`/`specialScaleSlotId` nas aulas + republicar apaga e recria).
- **B1 (decisão do Rodrigo):** os pontos/peso da escala servem **só pra montar a escala**, **não entram no pagamento**. Aula publicada = pagamento por **hora normal**. O "feriado dobra" (A4) é regra de **folha**, separada — ver §7.

## 2. Escopo

**Nesta feature (IN):**
1. **Relabel da preferência** do colaborador: `Quero/Não quero/Não posso` → **`Prefiro / Pode ser / Não posso`** + marcação **"Pode ser" em lote**.
2. **Publicar** a escala consolidada → cria aulas reais na agenda.
3. **Despublicar / republicar** idempotente.
4. **Horário das vagas configurável** (default configurável + edição por escala).

**Fora (outras features, OUT):**
- Fim de ano por **turnos manhã/tarde-noite** (precisa do modelo de turnos — feature própria).
- "Feriado dobra" no fechamento (regra de folha — só deixamos o `isHoliday` gravado).
- PLR.

## 3. Preferência — novo modelo

- **Rótulos:** Prefiro / Pode ser / Não posso. **Códigos internos:** `prefiro` / `pode_ser` / `nao_posso`.
- **Semântica no motor:** `prefiro` puxa pra cima (desempate de preferência), `pode_ser` é neutro, `nao_posso` é **restrição dura** (filtra o candidato). O antigo `nao_quer` (soft-down) **deixa de existir**.
- **Compat retroativa** (dados demo no staging usam `quer`/`nao_quer`): no `ScaleEngine`, `prefRank`: `prefiro|quer → 0`; `nao_quer → 2` (legado tolerado); demais (`pode_ser`/null) → 1. `nao_posso` segue filtrado como hoje.
- **UX colaborador:** botão **"Marcar 'Pode ser' em todas"** aplica `pode_ser` a todas as escalas com janela aberta de uma vez (Rodrigo: "marcar essa opção para todas as datas que pode ser escalado"). Cada escala ainda permite ajustar Prefiro / Não posso individualmente.

## 4. Publicar — modelo de dados

- **`scale_config`** (doc único, admin — **configurável**): horários-padrão das vagas por `tipo` (sábado/feriado/domingo_especial/evento). Ex.: `{ sabado: { startTime:'08:00', endTime:'12:00' }, ... }`. Editável na tela de config.
- **`special_scales.slots[]`** ganha `startTime`/`endTime` (herda do `scale_config` por `tipo`; **editável por escala**). `published` (bool) no doc da escala.
- **`classes`** geradas no publish: `{ unitId, teacherId=assignedPersonId, originalTeacherId, modalityId (real resolvido), startTime, endTime, durationMinutes, scheduledDate=data da escala, status:'prevista', isHoliday (deriva do tipo/feriado), generatedBy:'escala-smart', specialScaleId, specialScaleSlotId, monthClosingId:null, ... }`.

## 5. Fluxo

1. Gestão **consolida** (já existe) → `status='consolidada'`, slots com `assignedPersonId`.
2. **"Publicar na agenda"** → `ScaleService.publishToAgenda(scaleId)`: para cada slot **com pessoa E com horário**, cria uma `class` taggeada. Marca `published=true`. Slot **sem pessoa** (vaga aberta) → não gera aula, retorna na lista de pendências.
3. **"Despublicar"** → apaga as `classes` com `specialScaleId==scaleId` e `published=false` — **bloqueado se alguma aula estiver em mês fechado** (`monthClosingId`).
4. **Republicar** = despublicar + publicar (idempotente; nunca duplica).

## 6. Componentes (seguindo o padrão `professores-*.js` / serviços puros)

- **`scale-engine.js`** — `makeComparator` entende os novos códigos de preferência. Puro, smoke Node.
- **`scale-service.js`** — `publishToAgenda(scaleId, deps)` / `unpublishFromAgenda(scaleId, deps)` (idempotentes, injetáveis, smoke fake-firestore). `templateSlots` herda horários do `scale_config`. `ScaleConfigService.get/save`.
- **`professores-escala-smart.js`** — gestão: botões **Publicar / Despublicar** + lista de vagas abertas; colaborador: rótulos novos + **"Pode ser em todas"**. Edição de horário por vaga.
- **`firestore.rules`** — `classes`: permitir **create/delete pela gestão** quando `specialScaleId` presente e mês não fechado; `scale_config`: read módulo / write admin.

## 7. Pagamento (relação com a folha)

- Aula da escala = **hora normal** (B1). Sem peso de engajamento no cálculo.
- **Feriado dobra (A4)** = regra de **folha**, tratada no fechamento via `isHoliday` — **fora desta feature**. A aula publicada já grava `isHoliday` pra quando essa regra entrar. (Hoje o fechamento multiplica por `special_scale_types.weight`; a unificação "peso só pra escala × dobra de feriado na folha" é decisão da feature de pagamento, registrada na memória.)

## 8. Plano de testes

- **Engine:** `prefiro` puxa, `pode_ser` neutro, `nao_posso` filtra; legado `quer`/`nao_quer` ainda ordena (smoke).
- **Service:** publish cria N aulas (1 por vaga preenchida com horário); republish **não duplica**; unpublish remove; **mês fechado bloqueia**; vaga aberta **não** gera.
- **Staging:** consolidar → publicar → conferir na Agenda Geral (aula com professor certo, hora normal) → despublicar → some.

## 9. Riscos / decisões

- **Horário obrigatório pra publicar:** vaga sem horário não publica → UI exige (default vem do `scale_config`).
- **Mês fechado:** nunca publicar/despublicar aula em mês fechado.
- **Resolução de modalidade real** (TOI/HIIT → id): reusar o que a UI da escala já faz ao montar slots.
- **Decisão registrada:** publicar **cria** (não reatribui) porque a escala é off-grid — se no futuro sábados entrarem na grade, revisar pra evitar duplicação (a tag `specialScaleId` já permite detectar).
