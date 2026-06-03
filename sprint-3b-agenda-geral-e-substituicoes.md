# Sprint 3b — Agenda Geral + Substituições + Notificações in-app
**Objetivo:** Completar o ciclo do professor: ver agenda multi-unidade (somente leitura) + gerenciar trocas (substituição direta + cobertura aberta) + receber notificações in-app no sino do header.
**Pré-condições:** ✅ Sprint 3a fechada (geração de `classes` funcionando · `Minha Agenda` operacional · vínculo `users/{uid}.professorId` ↔ `teachers/{tid}`).
**Duração estimada:** 1 semana (~5 dias úteis).

---

## 1. O que esta sprint entrega

Ao final desta sprint:
- Sidebar do professor (e admin/gestão/supervisão) ganha item **"🌐 Agenda Geral"** — visão multi-unidade somente leitura sem expor dados financeiros de terceiros
- Sino de notificações no header com badge de contador (não-lidas)
- Dropdown lista notificações não-lidas; clicar marca como lida e some + navega pro contexto relevante
- Aba **"Lidas"** (acessível via link do dropdown) preserva histórico das últimas 50 notificações
- Modal de aula da **Minha Agenda** ganha 2 botões pro professor titular:
  - **"Pedir substituição direta"** — indica colega específico → notificação direcionada
  - **"Pedir cobertura aberta"** — sem substituto → notifica todos os aptos à modalidade
- Modal **"Inbox de pedidos"** mostra ao professor solicitações direcionadas a ele (aceitar/recusar) e oportunidades de cobertura (primeiro a clicar pega)
- Cloud Function `processSubstitutionAcceptance` (trigger Firestore onUpdate em `substitutions`) atualiza `classes/{id}.teacherId` + `classes.status = 'substituida'` + cria notificação pro titular
- Cloud Function `notifyTeachersAboutCoverage` (trigger Firestore onCreate em `coverage_applications`) cria N notificações pra todos os professores aptos à modalidade
- Tudo gera entries em `audit_log` (`module: 'agenda'` + `entityType: 'substitution' | 'coverage_application'`)
- Validação completa em staging com 10 critérios

---

## 2. Escopo claro

### ✅ ENTRA nesta sprint

| Item | Detalhes |
|------|----------|
| Sidebar item "🌐 Agenda Geral" | Visível para todos perfis com `moduleAccess.professores` |
| Tela "Agenda Geral" | Lista de aulas multi-unidade · filtros: unidade (multi-select) + modalidade + professor + período · sem campos financeiros · agrupada por dia |
| Sino de notificações no header | Badge com contador de não-lidas · pulse animado em nova notif · dropdown lista 10 últimas não-lidas |
| Aba "Lidas" | Mostra histórico das 50 últimas lidas · acessível via "Ver todas" no dropdown |
| Substituição direta (titular indica substituto) | Modal a partir da aula · select de professor (filtrado por modalidade) · motivo (textarea) · grava `substitutions/{id}` com status `pending` |
| Substituição direta (aceitar/recusar) | Item na inbox · botões Aceitar/Recusar · ao aceitar, CF atualiza `classes/{id}.teacherId` + `status = 'substituida'` |
| Cobertura aberta (sem substituto) | Modal a partir da aula · cria `coverage_applications/{id}` · CF dispara notificações pra todos aptos à modalidade |
| Cobertura aberta (pegar) | Item na inbox de oportunidades · botão "Quero cobrir" · primeiro a clicar pega (transação Firestore evita race condition) |
| Sem janela mínima — registro retroativo | Permite solicitar troca de aula já passada · flag `wasRetroactive` no doc · UI marca visualmente como "registro retroativo" |
| Cancelamento do pedido pelo titular | Enquanto status = `pending` ou `open`, titular pode cancelar |
| Cloud Functions | `processSubstitutionAcceptance` (trigger) + `notifyTeachersAboutCoverage` (trigger) |
| Audit log | Toda criação/aceite/recusa/cancelamento grava em `audit_log` com before/after |
| Notificação de feedback | Titular é notificado quando substituto aceita/recusa ou quando alguém pega cobertura |
| Smoke test | 10 cenários, validação humana |

### ❌ NÃO ENTRA (vai pra Sprint 4 ou posterior)

| Item | Sprint |
|------|--------|
| Notificações por email (Brevo) | Sprint 7 |
| Fechamento mensal | Sprint 4 |
| Pagamento da substituição | Sprint 4 (lógica: paga pro `teacherId` atual da aula, não pro original) |
| Aprovação da gestão antes do aceite (workflow extra) | Backlog — hoje aceite é automático |
| Múltiplos voluntários numa cobertura aberta (fila/escolha do titular) | Backlog — hoje primeiro a clicar pega |
| Histórico completo de solicitações do professor (tela dedicada) | Sprint 4 — pode entrar junto com fechamento |
| Notificação push (PWA) | Backlog |
| Notificação por SMS/WhatsApp | Sem plano |

---

## 3. Arquivos a criar/modificar

```
crosstrainer-comissoes/
├── functions/
│   └── index.js                        ← MOD — adicionar processSubstitutionAcceptance + notifyTeachersAboutCoverage
├── professores.html                     ← MOD — page-agenda-geral · modal substituição · modal cobertura · sino no header · dropdown notif · CSS
├── professores.js                       ← MOD — PROF_PAGES[*] += 'agenda-geral' · handler navigateTo · sino setup
├── professores-shared.js                ← MOD — SubstitutionService + CoverageService + NotificationService
├── professores-agenda.js                ← MOD — renderAgendaGeralPage · funções de substituição/cobertura
└── firestore.indexes.json               ← MOD — índices pra notifications + substitutions + coverage_applications
```

Decisão arquitetural:
- Manter padrão: Services em `professores-shared.js`, UI em `professores-agenda.js`
- Sino no header é UI global → entra em `professores.js` (já gerencia layout do shell)
- Se `professores-agenda.js` passar de 1500 linhas, refatorar em `professores-agenda.js` + `professores-substituicoes.js` em sprint posterior

---

## 4. Schemas

### `substitutions/{id}` — Sprint 3b cria pela primeira vez
```js
{
  classId: 'slot-abc_20260520',
  requestingTeacherId: 'tch-lucas',      // titular original
  requestingUserId: 'uid-lucas',          // pra Security Rule
  substituteTeacherId: 'tch-marcos',     // o substituto indicado
  substituteUserId: 'uid-marcos',
  reason: 'consulta médica',              // motivo do titular
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled',
  wasRetroactive: false,                  // true se aula já passou no momento do pedido
  isOfficial: true,                       // true = entrou na agenda oficial após aceite
  requestedAt: Timestamp,
  respondedAt: Timestamp | null,
  responseNote: string | null,            // se recusou, motivo
  createdBy: 'uid-lucas',
  updatedAt, updatedBy,
}
```

### `coverage_applications/{id}` — Sprint 3b cria pela primeira vez
```js
{
  classId: 'slot-abc_20260520',
  requestingTeacherId: 'tch-lucas',
  requestingUserId: 'uid-lucas',
  modalityId: 'mod-crossfit',             // pra filtrar professores aptos
  reason: 'preciso me ausentar',
  status: 'open' | 'taken' | 'cancelled',
  wasRetroactive: false,
  pickedByTeacherId: string | null,       // preenchido quando alguém pega
  pickedByUserId: string | null,
  pickedAt: Timestamp | null,
  notifiedUserIds: [],                    // pra audit: quem foi notificado
  requestedAt: Timestamp,
  createdBy, updatedAt, updatedBy,
}
```

### `notifications/{id}` — Sprint 3b cria pela primeira vez
```js
{
  recipientUserId: 'uid-marcos',          // dono da notificação
  type: 'substitution_requested' | 'substitution_accepted' | 'substitution_rejected'
      | 'coverage_available' | 'coverage_taken' | 'substitution_cancelled',
  title: 'Lucas pediu substituição',
  body: 'Aula de CrossFit · DOM 20/05 · 07:00–08:00',
  link: {                                 // pra navegar ao clicar
    type: 'class' | 'substitution' | 'coverage',
    id: 'slot-abc_20260520',
  },
  isRead: false,
  readAt: Timestamp | null,
  createdAt: Timestamp,
}
```

Decisão D-Notif: notificação **some da inbox principal** quando lida (`isRead = true`). Permanece no Firestore (acessível via aba "Lidas" que filtra `isRead == true` ordenado por `readAt DESC limit 50`).

---

## 5. Sequência de implementação

### Etapa 1 — Tela "Agenda Geral" + sidebar (~1 dia)
- [ ] `PROF_PAGES[*]` += `'agenda-geral'` em `professores.js`
- [ ] Nova entrada `PAGE_DEFINITIONS`: `{id:'agenda-geral', label:'Agenda Geral', icon:'🌐', section:'Operação'}`
- [ ] `<div class="page" id="page-agenda-geral"></div>` em `professores.html`
- [ ] `renderAgendaGeralPage()` em `professores-agenda.js`
- [ ] Filtros: chip multi-select de unidades, select de modalidade, select de professor, chip filtro temporal (mesmo padrão de Minha Agenda)
- [ ] Query: `db.collection('classes').where('unitId', 'in', [...]).where('scheduledDate', '>=', from).where('scheduledDate', '<=', to)`
- [ ] Render agrupado por dia (mesmo componente da Minha Agenda) mas mostra **professor + modalidade + unidade** em cada card (sem valor/hora)
- [ ] Click no card abre modal somente-leitura (sem botões de edição pra não-admin)

### Etapa 2 — NotificationService + sino no header (~1 dia)
- [ ] `professores-shared.js`: `NotificationService.listUnread(userId)` · `listRead(userId, limit=50)` · `markAsRead(notifId)` · `markAllAsRead(userId)` · `_create(data)` (uso interno do CF, mas frontend usa também pra notif manuais)
- [ ] Sino HTML no header de `professores.html` (depois do nome do user)
- [ ] Função `setupNotificationsBell()` em `professores.js` — carrega notif não-lidas a cada 60s + Firestore real-time listener
- [ ] Dropdown HTML + CSS: lista as 10 últimas não-lidas, cada uma com type icon, title, body, timestamp relativo ("2h atrás")
- [ ] Click na notif: `markAsRead` + navega via `link` (se for class, abre Minha Agenda + modal da aula; se for substitution/coverage, abre Inbox de Pedidos)
- [ ] Link "Ver todas" no fim do dropdown → abre modal/painel com aba "Não lidas" e "Lidas"
- [ ] Índice composto pra notifications: `(recipientUserId ASC, isRead ASC, createdAt DESC)` em `firestore.indexes.json`

### Etapa 3 — Substituição direta (modal solicitar + inbox + aceitar/recusar) (~1,5 dia)
- [ ] `SubstitutionService` em shared: `create({classId, substituteTeacherId, reason})` · `accept(subId, note?)` · `reject(subId, note)` · `cancel(subId)` · `listForSubstitute(userId, statuses)`
- [ ] Modal "Solicitar substituição" em HTML — abre a partir do modal da aula (Minha Agenda) com botão "Pedir substituição direta"
  - Select de professor (filtrado pela modalidade da aula, excluindo o próprio titular)
  - Textarea motivo (até 500 chars)
  - Aviso visível se aula é no passado: "Esta aula já passou — solicitação será marcada como retroativa"
- [ ] Submit grava em `substitutions` + cria notif pro substituto via `NotificationService._create`
- [ ] "Inbox de pedidos" — nova seção dentro do modal "Ver todas" notificações OU tela separada (decidir em D5 do playbook)
- [ ] Botões Aceitar / Recusar (com textarea motivo opcional)
- [ ] Aceite chama `SubstitutionService.accept(subId)` → atualiza `substitutions.status = 'accepted'` → CF detecta e executa lógica server-side
- [ ] Cancelamento pelo titular: botão na própria notificação ou no modal da aula (se status pending)

### Etapa 4 — Cobertura aberta (modal pedir + inbox de oportunidades + pegar) (~1 dia)
- [ ] `CoverageService` em shared: `request({classId, reason})` · `pick(coverageId)` (transação Firestore pra evitar 2 professores pegarem) · `cancel(covId)` · `listOpenForUser(userId)`
- [ ] Modal "Pedir cobertura aberta" no HTML — abre a partir do modal da aula com botão dedicado
  - Apenas textarea motivo (sem select de substituto)
  - Mesmo aviso retroativo
- [ ] Submit grava em `coverage_applications` com status `open` → CF `notifyTeachersAboutCoverage` é disparada automaticamente
- [ ] "Inbox de oportunidades" — coberturas abertas onde o user logado é apto à modalidade
- [ ] Botão "Quero cobrir" → `CoverageService.pick(covId)` em transação:
  ```
  txn.get(covRef) → se status === 'open' → set status='taken', pickedBy*, pickedAt
                  → senão throw "Já foi pega por outro professor"
  ```
- [ ] Cancelamento pelo titular: botão similar à substituição direta

### Etapa 5 — Cloud Functions (~0,5 dia)
- [ ] `processSubstitutionAcceptance` (trigger Firestore `onDocumentUpdated('substitutions/{subId}')`):
  - Roda quando `before.status === 'pending' && after.status === 'accepted'`
  - Atualiza `classes/{classId}`: `teacherId = substituteTeacherId`, `status = 'substituida'`
  - Cria notification pro titular (`substitution_accepted`)
  - Audit log
- [ ] `notifyTeachersAboutCoverage` (trigger `onDocumentCreated('coverage_applications/{covId}')`):
  - Busca todos `teachers` ativos com `modalityIds includes modalityId`
  - Pra cada um: cria notification (`coverage_available`)
  - Atualiza `coverage_applications/{covId}.notifiedUserIds = [...]`
- [ ] (Bônus) `processCoveragePick` (trigger `onDocumentUpdated('coverage_applications/{covId}')`):
  - Roda quando `before.status === 'open' && after.status === 'taken'`
  - Atualiza `classes/{classId}`: `teacherId = pickedByTeacherId`, `status = 'substituida'`
  - Notifica titular (`coverage_taken`)
  - Audit log
- [ ] Deploy: `firebase deploy --only functions --project staging`

### Etapa 6 — Smoke test (~0,5 dia)
- [ ] Criar 2 users de teste com perfil `professor` em staging (se ainda não tem) — vincular cada um a teachers diferentes via `users/{uid}.professorId`
- [ ] Cenários listados na seção 7

---

## 6. Decisões importantes

| # | Decisão | Resposta |
|---|---------|----------|
| D1 | Cobertura aberta — quem vê? | **Todos professores aptos à modalidade** (cross-unidade). Confirmado na sessão 14 |
| D2 | Notificação lida — some ou fica? | **Some da inbox principal**. Aba "Lidas" preserva histórico (limit 50) |
| D3 | Janela mínima pra solicitar | **Sem janela**. Permite registro retroativo. Flag `wasRetroactive` marca visualmente |
| D4 | Cobertura aberta com múltiplos voluntários | **Primeiro a clicar pega** (transação Firestore). Fila/escolha do titular = backlog |
| D5 | Onde mostra a inbox de pedidos? | **Aba dedicada na sidebar?** Ou modal "Ver todas notificações"? **Decisão: link "Inbox" no dropdown do sino** → abre modal com 2 abas: "Pedidos pra mim" + "Oportunidades pra mim". Tela dedicada na sidebar = backlog se virar incômodo |
| D6 | Aceite automático ou requer aprovação gestão? | **Automático** (sem workflow extra). Backlog se cliente pedir auditoria adicional |
| D7 | Notificações da Agenda Geral? | **Não** nesta sprint. Agenda Geral é só visualização, sem ações que disparem notif |
| D8 | Como evitar spam de notif na cobertura aberta? | Limitar pra modalidades específicas (D1). Se professor não tem modalidade habilitada, não vê. Backlog: opt-out por professor |
| D9 | Substituto pode desistir após aceitar? | **Não nesta sprint**. Aceite é definitivo. Backlog se precisar |
| D10 | Deploy em produção ao fim? | **Não**. Aguarda homologação completa |

---

## 7. Critérios de aceite

| # | Critério | Como verificar |
|---|----------|---------------|
| 1 | Sidebar "🌐 Agenda Geral" aparece pra todos os perfis (com módulo) | Login admin + login professor → item visível |
| 2 | Agenda Geral mostra aulas de múltiplas unidades, sem dados financeiros | Selecionar 2+ unidades nos filtros → lista combina · não há campos R$/hora visíveis |
| 3 | Sino exibe contador de não-lidas | Criar 3 notif manuais via console pro user logado → badge mostra "3" |
| 4 | Click em notif marca como lida e some do dropdown | Click → badge decrementa · notif some · acessível via "Lidas" |
| 5 | Substituição direta — fluxo completo | Lucas pede sub pro Marcos → Marcos vê na inbox → aceita → `classes.teacherId` atualiza pra Marcos · `status = 'substituida'` · Lucas recebe notif `substitution_accepted` |
| 6 | Recusa de substituição direta | Marcos recusa → `substitutions.status = 'rejected'` · Lucas notificado · `classes` inalterada |
| 7 | Cobertura aberta — fluxo completo | Lucas abre cobertura sem substituto → CF dispara notif pra todos os aptos à modalidade · primeiro a clicar pega · `classes` atualiza · titular notificado |
| 8 | Race condition na cobertura | 2 abas tentando pegar a mesma cobertura quase simultaneamente → uma sucede, outra recebe erro claro "Já foi pega por outro professor" |
| 9 | Retroatividade marcada visualmente | Solicitar substituição de aula passada → modal mostra aviso · histórico marca `wasRetroactive: true` · UI exibe badge "retroativo" |
| 10 | Audit log + zero regressão | Cada operação gera entry em audit_log · todas telas anteriores (Modalidades, Professores, Agenda, Minha Agenda) continuam funcionando |

---

## 8. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|--------------|----------|
| Cloud Function de notificação em massa quebra cota (100 professores × 1 cobertura) | 🟢 Baixa | Plano Spark aguenta. Monitorar via `firebase functions:log` |
| Race condition na cobertura (2 picks ao mesmo tempo) | 🟡 Média | Mitigado por transação Firestore (`db.runTransaction`) |
| Notificações em tempo real consomem muita leitura (snapshot listener sempre ativo) | 🟡 Média | Aceito. Listener só pra contagem de não-lidas, leve. Refresh manual com botão "atualizar" se cota apertar |
| Confusão visual entre "Pedidos pra mim" e "Oportunidades pra mim" no modal | 🟡 Média | Tabs separadas com contadores. Cores diferentes pros tipos de notif |
| Substituição retroativa pode confundir audit | 🟢 Baixa | Flag `wasRetroactive` no doc + badge visual + audit log com timestamp original da aula vs timestamp da solicitação |
| Professor cancela aceite após dar errado | 🟢 Baixa | D9: não permitido nesta sprint. Se virar problema real, abre backlog |
| Cobertura "esquecida" (ninguém pega) | 🟡 Média | Sem fluxo automático. Gestão acompanha via tela própria — fica pra Sprint 4 (Fechamento) que vai consolidar essas pendências |

---

## 9. Após a sprint

Sprint 3b termina quando os 10 critérios passarem. Próximo passo:

- 🟢 **Sprint 4** — Fechamento mensal + cálculo de horas (paga pro `teacherId` atual da aula, não pro `originalTeacherId`) + feriado automático
- 🟢 **Sprint 5** — Escalas especiais (sábados, feriados, eventos)
- 🟢 **Sprint 6** — Férias e recesso
- 🟢 **Sprint 7** — Brevo + Trigger Email (notificações por email duplicando as in-app)
