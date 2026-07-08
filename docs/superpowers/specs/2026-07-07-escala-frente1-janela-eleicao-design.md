# Design — Escala Inteligente · Frente 1 (janela de eleição + Escola Interna)

> **Data:** 2026-07-07 · **Status:** design aprovado em brainstorm com o usuário + validado com o Rodrigo
> **Origem:** feedback do Rodrigo (07/07) com 12 sugestões/ajustes para a Escala Inteligente.
> **Memória:** `novo-modulo-engajamento-pontos`, `escala-inteligente-abas`.
> **Base:** continua o trabalho de `2026-07-01-escala-inteligente-abas-design.md` (4 abas já no ar no staging).

## 1. Contexto

O Rodrigo mandou 12 ajustes para a Escala Inteligente após usar as 4 abas no staging.
Os itens se agrupam em **3 frentes** com dependência entre si. **Este spec cobre só a Frente 1** — o ciclo da janela de eleição (o coração), a aba Escola Interna e o rename. Frentes 2 e 3 viram specs próprios depois.

### Fatiamento das 12 sugestões

| # | Sugestão do Rodrigo | Frente |
|---|---------------------|--------|
| 1 | Só sábados/feriados daqui pra frente + aba de histórico do ano | **1** |
| 2 | Selecionar vários sábados/feriados e abrir as janelas de uma vez | **1** |
| 3 | Ao abrir a janela, avisar todos para se candidatarem | **1** (in-app) |
| 4 | Data de abertura/fechamento da janela configurável | **1** |
| 5 | Ao fechar, prévia consolidada (quem pegou o quê / quem não se candidatou / sugestão por pontos) antes de confirmar pra todos | **1** |
| 10 | Incluir a Escola Interna nas abas | **1** |
| 12 | Renomear "Chamada" → "Confirmar Presença" | **1** |
| 9 | Fim de ano: professor se candidata a cada data individualmente | 2 |
| 11 | Replicar as abas (Sábados/Feriados/Eventos/Fim de ano/Escola Interna) na visão do professor | 2 |
| 6 | Ao criar evento, marcar quem **deve** e quem **poderia** participar do staff | 3 |
| 7 | Convite por e-mail aos selecionados do evento | 3 |
| 8 | Lembrete 7d/4d/1d antes do evento | 3 |

## 2. Decisões fechadas (usuário + Rodrigo, 07/07)

| Tema | Decisão |
|------|---------|
| **E-mail (itens 3/7/8)** | **Aviso in-app agora, e-mail depois.** Sistema não tem infra de e-mail hoje (só `notifications` in-app). Nasce uma camada `notify` abstraída com o canal `email` como stub, pronta pra plugar. Confirmado pelo Rodrigo: "e-mail pode ser depois". |
| **Janela (item 4)** | **Manual com prazo visível.** A gestão clica "abrir janela" e define a data-limite de fechamento. O professor vê contagem regressiva. Passado o prazo, o sistema bloqueia novas preferências e a gestão consolida. **Sem Cloud Function nova.** |
| **Histórico (item 1)** | **Toggle "Mostrar passados" dentro de cada aba** (default: só datas ≥ hoje). Não é uma 5ª aba de histórico. |
| **Escola Interna (item 10)** | **Atribuição manual pela gestão, por necessidade técnica** — NÃO passa por rodízio automático (justiça+mérito) nem por janela de candidatura do time. Quem for escalado pra liderar ganha os pontos de liderança que já existem (`escolaInternaLiderar`). Confirmado pelo Rodrigo. |
| **Abrir várias (item 2)** | Multi-seleção nas linhas + ação em massa que abre todas com **prazo comum** e dispara **um** aviso. As escalas abertas juntas compartilham um `windowBatchId` pra agrupar na prévia consolidada. |

## 3. Modelo de dados

### 3.1 `special_scales` — campos novos (janela com prazo)

```
windowClosesAt : string ISO (data/hora-limite de fechamento) | null
windowOpenedAt : timestamp (carimbo de quando a janela abriu)  | null
windowClosedAt : timestamp (carimbo de quando fechou)          | null
windowBatchId  : string (id compartilhado quando abertas em lote) | null
```

- `openElection(id, { closesAt, batchId })` grava `status='janela_aberta'`, `windowClosesAt`, `windowOpenedAt`, `windowBatchId`.
- Fechar a janela (manual ou por prazo atingido no clique de consolidar) grava `windowClosedAt` e volta `status` conforme o fluxo (`rascunho`/`consolidada`).
- Docs antigos sem esses campos continuam válidos (tudo opcional/null).

### 3.2 Escola Interna — reaproveita `special_scales`

- Novo `tipo: 'escola_interna'`.
- Slots com `assignedPersonId` preenchido **direto pela gestão** (sem `consolidate`). Sem preferências, sem janela.
- Cada slot representa uma sessão (dia/hora/unidade) com um **líder** escalado.
- `role: 'lider'` marcado no slot pra conectar com os pontos de liderança.
- Publica na agenda pelo mesmo `publishToAgenda` já existente (o slot já carrega `startTime`/`endTime`).

### 3.3 `scale_preferences` — sem mudança de shape

O bloqueio pós-prazo é aplicado no `setPreference` (checa `windowClosesAt` da escala) + esconder botões no client. Reforço em Security Rules fica como melhoria (fora do caminho crítico) — a regra pode ler `windowClosesAt` via `get()` do doc pai.

## 4. Camada `notify` (nova)

Arquivo novo `notify-service.js` (padrão UMD como os outros serviços):

```js
NotifyService.send({
  recipients: [userId, ...],   // ou { role: 'professor' } → resolve ativos
  type:   'scale_window_open', // string de tipo
  title:  '...',
  body:   '...',
  link:   { type: 'escala', id },
  channels: ['inapp'],         // 'email' existe mas é stub por ora
})
```

- **Hoje:** para `channels:['inapp']`, grava N docs na coleção `notifications` (mesmo shape que `createNotification` das Functions usa — sino que já existe no app).
- **Amanhã:** o canal `'email'` já tem a assinatura; quando a infra de e-mail entrar (Frente futura), pluga aqui sem mexer nos chamadores.
- Resolver `recipients` por papel (professores ativos) reusa o mapa de `teachers` → `users.professorId` (mesma lógica de `notifyTeachersAboutCoverage`).
- **Escopo Frente 1:** só o disparo do item 3 (janela aberta) e o de confirmação (item 5) usam a camada. Itens 7/8 (evento) são Frente 3.

## 5. Comportamento por feature

### 5.1 Item 1 — futuros + histórico

- Cada aba (Sábados/Feriados/Eventos) filtra por padrão **datas ≥ hoje**.
- Toggle "Mostrar passados" (por aba, estado em `EscalaSmartState`) revela o ano todo.
- Sábados: `saturdaysOfYear(year)` já dá o ano; o filtro é só de exibição.

### 5.2 Item 2 — abrir várias com prazo comum

- Checkbox nas linhas de sábado/feriado (virtuais e com doc).
- Barra de ação "Abrir janela nas selecionadas (N)" → abre um modal pedindo **data-limite de fechamento**.
- Ao confirmar: para cada data selecionada, cria o doc se não existir (`escalaSlotsPadrao`) e chama `openElection` com um `windowBatchId` comum + o `closesAt`.
- Dispara **um** `NotifyService.send` pra todos os professores ativos ("Janela de escolha aberta — candidate-se até DD/MM").

### 5.3 Item 3 — aviso ao abrir

- Coberto por 5.2 (o disparo único na abertura em lote) e também no abrir individual (`abrirJanelaEscala` passa a pedir a data-limite + notificar).

### 5.4 Item 4 — prazo visível + bloqueio

- Modal de abertura pede `windowClosesAt`.
- Na visão do professor (`renderEscalaPrefs`): mostra "fecha em DD/MM às HH:MM" / contagem regressiva; passado o prazo, os botões Prefiro/Pode ser/Não posso ficam desabilitados com aviso "janela encerrada".
- `setPreference` recusa se `now > windowClosesAt`.

### 5.5 Item 5 — prévia consolidada antes de confirmar

- Nova tela/painel **"Revisão de fechamento"** acionada por `windowBatchId` (ou por escala individual).
- Mostra uma **matriz pessoas × datas**:
  - quem se candidatou a qual data (Prefiro/Pode ser),
  - **quem não se candidatou a nada** (lista destacada),
  - o **preenchimento sugerido pelo motor** (justiça+mérito) para as vagas ainda abertas — reusa `consolidate`/`ScaleEngine`.
- Botão "Confirmar escala e avisar todos" → roda `consolidate` em cada escala do lote + dispara `NotifyService.send` de confirmação ("Escala dos dias X, Y, Z publicada").
- É um reshape de fluxo em cima do `consolidate` que já existe — não é motor novo.

### 5.6 Item 10 — aba Escola Interna

- 5ª aba `escola_interna`.
- **Sem janela, sem preferência, sem consolidate.** A gestão:
  - cria as sessões (dia/hora/unidade),
  - **escolhe o líder** de cada uma num select de professores (atribuição manual direta no slot),
  - publica na agenda (`publishToAgenda`).
- Conexão com pontos: o slot marca `role:'lider'`; o líder escalado ganha os pontos de liderança que já existem hoje (`escolaInternaLiderar`). O ponto continua sendo **confirmado na "Confirmar Presença"** (ex-Chamada) — o líder planejado entra **pré-selecionado** lá.
- **Ponto de integração a detalhar no plano:** como a sessão planejada (escala) pré-preenche o líder na Confirmar Presença sem duplicar contagem de pontos (a presença é a fonte de verdade do ponto; a escala é só o plano).

### 5.7 Item 12 — rename

- `professores-nav.js:39`: label `'Chamada'` → `'Confirmar Presença'`.
- Ajustar cabeçalho da página `engaj-chamada` em `professores-engajamento.js` se houver título "Chamada" visível.
- Atualizar `smoke-sidebar.js` se ele asserta o label antigo.

## 6. Componentes e arquivos

| Arquivo | Mudança |
|---------|---------|
| `notify-service.js` | **novo** — camada de notificação (in-app hoje, e-mail stub) |
| `scale-service.js` | `openElection` recebe `{closesAt, batchId}`; `setPreference` valida prazo; helpers p/ Escola Interna (criar sessão, atribuir líder); listar por `windowBatchId` |
| `professores-escala-smart.js` | toggle histórico; multi-seleção + barra de ação; modal de abertura com data-limite; contagem regressiva no professor; tela "Revisão de fechamento"; aba + fluxo Escola Interna |
| `professores-nav.js` | rename Chamada; incluir aba/rota Escola Interna se precisar de item de menu (provável que não — é aba interna da Escala) |
| `professores-engajamento.js` | pré-selecionar líder planejado na Confirmar Presença (integração 5.6) |
| `firestore.rules` | (melhoria) bloqueio de preferência pós-prazo; permitir campos novos em `special_scales` |
| `scripts/smoke-*.js` | smoke novo para os helpers puros (prazo, batch, escola interna) + atualizar `smoke-sidebar.js` |

## 7. Testes

- **Helpers puros** (Node smoke, sem Firestore): validação de prazo (antes/depois), agrupamento por `windowBatchId`, montagem da matriz da prévia consolidada, montagem de slots da Escola Interna.
- **Serviço** (fake-firestore, como os smokes existentes): `openElection` com prazo/batch, `setPreference` recusando pós-prazo, atribuição manual de líder.
- **E2E staging** (checklist no plano): abrir janela em lote → professor vê prazo e candidata → gestão fecha → prévia consolidada → confirmar → aviso in-app chega → Escola Interna: gestão escala líder → publica → aparece pré-selecionado na Confirmar Presença.
- Regra do projeto: homologação em staging antes de qualquer produção (CLAUDE.md §7).

## 8. Fora de escopo (Frentes 2 e 3)

- **Frente 2:** fim de ano por período individual na visão do prof (#9); replicar as 5 abas na visão do professor (#11).
- **Frente 3:** staff do evento deve/poderia (#6); convite (#7) e lembretes 7d/4d/1d (#8) — o #8 exige uma Cloud Function agendada diária; a camada `notify` desta frente já serve de base.
- **E-mail real:** frente própria depois (canal `email` do `NotifyService`).

## 9. Riscos / pontos de atenção

- **Bloqueio pós-prazo** é primariamente client-side nesta frente; um professor com o app aberto no limite do prazo poderia gravar preferência tardia. Aceitável (baixo impacto; a gestão revê na prévia). Reforço em Rules é melhoria.
- **Integração Escola Interna ↔ Confirmar Presença** (5.6) é o ponto mais delicado — precisa não duplicar pontos. A presença é a fonte de verdade; a escala é só o plano/sugestão.
- **Docs legados** de escala seguem filtrados (`isLegacyScaleDoc`), sem migração aqui.
