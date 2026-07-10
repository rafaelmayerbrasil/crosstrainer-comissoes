# Design — Escala Inteligente · Frente 3 (eventos: staff + convite + lembretes)

> **Data:** 2026-07-10 · **Status:** design aprovado em brainstorm (usuário) + validado pelo Rodrigo ("evento = lista de staff… concordo com todas as sugestões").
> **Base:** continua Frentes 1 e 2 (no staging). **Memória:** [[frente2-escala-visao-professor]].

## 1. Contexto

Frente 3 (última das 3) dos 12 ajustes do Rodrigo — **eventos**:

| # | Sugestão |
|---|----------|
| #6 | Ao criar evento, selecionar quem **deve** e quem **poderia** participar do staff |
| #7 | Os selecionados recebem convite solicitando presença |
| #8 | Lembrete **7d / 4d / 1d** antes do evento aos envolvidos |

Hoje o evento é uma escala (`tipo:'evento'`, etiqueta `eventKind` Interno/Externo) que, herdado da Frente 1, ainda cria vagas TOI/Hiit por unidade — sem sentido pra evento. Rodrigo confirmou: **evento passa a ser só a lista de staff**.

## 2. Decisões fechadas (Rodrigo, 08/07)

| Tema | Decisão |
|------|---------|
| **Modelo** | Evento = **lista de staff** em 2 níveis (**devem** / **poderiam** participar). Sem vagas TOI/Hiit. |
| **RSVP** | Cada membro do staff responde **Vou / Não vou**. **Obrigatório** nasce `going:true` (Vou) e pode trocar; **opcional** nasce em aberto (`null`) e a pessoa preenche. |
| **Convite (#7)** | Ao ser selecionado, recebe **aviso in-app** ("Você está no staff de X — confirme presença"). |
| **Lembretes (#8)** | **7/4/1d** antes, via **Cloud Function agendada diária**, para todos **exceto quem respondeu "Não vou"** (ou seja: "Vou" + quem não respondeu recebem). |
| **Prazo** | **Sem prazo** — pode responder/mudar até o dia do evento. |
| **E-mail** | In-app agora (convite via `NotifyService`; lembrete via `createNotification` da CF). E-mail depois (canal stub). |

## 3. Modelo de dados

### 3.1 Evento (`special_scales`, `tipo:'evento'`)
- Criação **sem** slots TOI/Hiit (slots vazios). `eventKind` mantido.
- Campo novo `remindersSent: []` — offsets de lembrete já disparados (idempotência), ex.: `['7d','4d']`.

### 3.2 `event_rsvp` (nova coleção)
Doc id `${eventId}__${personId}` (espelha `scale_preferences`):
```
{ scaleId, personId, tier: 'obrigatorio' | 'opcional',
  going: true | false | null, invitedAt, respondedAt }
```

## 4. Serviço (`scale-service.js`)

- `setEventStaff(scaleId, obrigatorios, opcionais, deps)` — reconcilia o staff: para cada pessoa das listas cria/atualiza o `event_rsvp` (novo obrigatório → `going:true`; novo opcional → `going:null`; **preserva** `going` de quem já respondia); remove `event_rsvp` de quem saiu das listas. Retorna `{ added:[personId], ... }` (os recém-adicionados, p/ o convite).
- `listEventRsvp(scaleId, deps)` — lista os `event_rsvp` do evento.
- `setRsvp(scaleId, personId, going, deps)` — grava a resposta do próprio professor (`going` true/false) + `respondedAt`.
- `summarizeRsvp(rsvpDocs)` — **puro**: `{ vao:[], naoVao:[], semResposta:[] }` (por `going` true/false/null).

## 5. UI

### 5.1 Gestão — detalhe do evento (`professores-escala-smart.js`)
- Substitui o detalhe genérico do evento por um painel de **staff**: dois seletores de pessoas (**Devem** / **Poderiam**). "Salvar staff" → `setEventStaff` + dispara **um** `NotifyService.send` (convite) aos **recém-adicionados**.
- **Consolidado**: quem **Vai** / **Não vai** / **Não respondeu**, por nível (via `summarizeRsvp`).
- Criação de evento (`criarNovoEvento`/`criarEscalaData` para `tipo:'evento'`) passa a criar **slots vazios** (remove TOI/Hiit).

### 5.2 Professor — aba Eventos (torna-se acionável)
- A aba Eventos (read-only na Frente 2) passa a mostrar, nos eventos em que ele é staff, botões **Vou / Não vou** refletindo/gravando o `going` dele (via `setRsvp`). Presença real p/ ponto segue na Confirmar Presença.

## 6. Lembretes — Cloud Function (`functions/index.js` + `functions/reminders-util.js`)

- **`functions/reminders-util.js`** (puro CommonJS, sem deps Firebase): 
  - `dueReminderOffsets(eventDateISO, todayISO, sent)` → subconjunto de `['7d','4d','1d']` cujos dias-de-antecedência batem com `eventDate - today` e ainda não estão em `sent`.
  - `reminderRecipients(rsvpDocs)` → `personId[]` com `going !== false`.
- **`exports.sendEventReminders = onSchedule(...)`** (diária): varre `special_scales` `tipo:'evento'` futuros; para cada, `dueReminderOffsets`; se houver offset devido, resolve `event_rsvp` → `reminderRecipients` → `createNotification` (in-app) a cada um → grava o offset em `remindersSent`. Usa `createNotification` que já existe nas Functions. Região igual às CFs existentes.

## 7. Regras (`firestore.rules`)
- `event_rsvp`: espelha `scale_preferences` — read p/ módulo; create/update p/ admin/superv **ou** `personId == professorId`; sem delete pelo cliente (a remoção do staff é feita pela gestão via `setEventStaff`; ajustar a regra p/ permitir delete por admin/superv). **Deploy necessário.**

## 8. Testes
- **Puros** (smoke Node): `summarizeRsvp`; `dueReminderOffsets` (7/4/1 dia; já enviado não repete; datas fora não disparam); `reminderRecipients` (exclui "Não vou").
- **Serviço** (fake-firestore): `setEventStaff` (defaults por nível, preserva resposta, remove quem saiu, retorna adicionados); `setRsvp`.
- **E2E staging** (inclui **deploy da CF nova** + rules): gestão monta staff → convite chega → professor responde Vou/Não vou → gestão vê consolidado → (simular data) lembrete dispara p/ quem não recusou.

## 9. Fora de escopo (4ª rodada — retorno do Rodrigo 08/07)
Tabela informativa da gestão (escalado × compareceu); Escola Interna como calendário mensal; mínimo de preferências (cota justa calculada); substituição lançada pelo substituto (aprovação + ajuste de horas); ajustes prontos (data 2x, escalar manual, detalhes do fim de ano). Cada um no seu ciclo depois.

## 10. Riscos / atenção
- **Remoção das vagas TOI/Hiit dos eventos** só afeta eventos NOVOS; eventos antigos com slots seguem existindo (inertes — o detalhe passa a mostrar staff). Sem migração.
- **CF nova** = primeira função agendada desta leva; validar região/execução no staging antes de confiar nos lembretes.
- **Idempotência** dos lembretes via `remindersSent` no doc do evento (a CF roda 1×/dia; o offset só dispara uma vez).
- Bloqueio/prazo: não há (decisão) — RSVP aberto até o evento.
