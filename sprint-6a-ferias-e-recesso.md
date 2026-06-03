# Sprint 6a — Férias e Recesso
**Objetivo:** Implementar fluxo completo de férias (CLT efetivo) e recesso (estagiário): professor solicita → admin/gestão aprova → CF de geração de classes pula datas aprovadas. Suporta divisão em até 3 períodos (padrão CLT).
**Pré-condições:** ✅ Sprints 1-5a validadas em staging.
**Duração estimada:** 1 semana (~5-6 dias úteis).

> 💡 **Proposta de quebra:** **6a (esta)** — solicitação + aprovação + bloqueio de agenda. **6b opcional** — cálculo de pagamento durante férias (1/3 constitucional CLT). 6a entrega o operacional, 6b o financeiro.

---

## 1. O que esta sprint entrega

Ao final desta sprint:
- Sidebar ganha **"🏖️ Férias e Recesso"** para todos perfis com módulo Professores
- **Tela do Professor:** ele solicita férias/recesso, vê histórico próprio, cancela enquanto pendente
- **Tela do Admin/Gestão:** lista de pedidos pendentes + aprovados + recusados, com filtros (status, teacher, unidade)
- **Solicitação multi-período:** até 3 períodos (padrão CLT), com validações
- **Aprovação/recusa pelo admin** com motivo opcional
- **CF `generateClassesForUpcomingWeeks` modificada:** consulta `vacation_requests` aprovadas e pula classes nesses dias pro professor afetado
- **Notificações in-app:** professor recebe quando aprovado/recusado; admin recebe quando há nova solicitação
- **Audit log** com `module: 'ferias'`
- **Smoke test** com 10 critérios via `scripts/admin.js smoke-6a` + fixture

---

## 2. Escopo claro

### ✅ ENTRA nesta sprint

| Item | Detalhes |
|------|----------|
| Sidebar "🏖️ Férias e Recesso" | Admin · admin_gestao · supervisao (gestão); professor · professor_estagiario (próprias) |
| Tela professor "Minhas Férias" | Lista próprias solicitações + botão "+ Nova solicitação" |
| Tela admin "Gerenciar Férias" | Lista pedidos com filtros (status: pendente/aprovada/recusada/cancelada, teacher, unidade) |
| Modal de solicitação | Tipo (auto-detectado: efetivo→férias, estagiário→recesso), até 3 períodos, motivo opcional |
| Validações CLT pra efetivo | 1º período ≥ 14 dias, demais ≥ 5 dias, total = 30 dias, antecedência ≥ 30 dias |
| Validações pra estagiário | Total ≤ 30 dias, antecedência ≥ 15 dias, mínimo 5 dias por período |
| Bloqueio pra eventual | UI mostra "sem direito formal — fale com gestão"; sem botão de solicitar |
| Aprovação/recusa pelo admin | Modal com motivo opcional + audit |
| Cancelamento pelo solicitante (se pending) | Botão "Cancelar pedido" enquanto status pendente |
| CF modificada | `generateClassesCore` consulta `vacation_requests where status='aprovada'` e pula candidates onde `teacherId + date` cai em período aprovado |
| Notif in-app | Tipos: `vacation_requested` (pra admins) · `vacation_approved` · `vacation_rejected` · `vacation_cancelled` (pra solicitante) |
| Audit log | `module: 'ferias'` em criação/aprovação/recusa/cancelamento |
| Smoke test | 10 critérios via script + fixture |

### ❌ NÃO ENTRA (vai pra Sprint 6b ou backlog)

| Item | Sprint |
|------|--------|
| **Cálculo de pagamento de férias** (1/3 constitucional CLT) | Sprint 6b |
| **Recesso pago pro estagiário** (bolsa proporcional?) | Sprint 6b |
| **Controle anual** ("já tirou X dias este ano · faltam Y") | Sprint 6b |
| **Reabrir/editar férias já aprovada** | Backlog — exige workflow de revisão |
| **Cancelamento de aulas existentes** quando férias aprovada retroativamente | Backlog — CF apenas BLOQUEIA novas |
| **Notificação por email** | Sprint 7 (Brevo) |
| **Calendário visual de férias por unidade** | Backlog (UX) |
| **Vinculação automática com `internshipStartDate`** (estagiário 12 meses) | Backlog — admin valida manualmente |
| **Substituição automática durante férias** | Backlog — coberturas abertas (Sprint 3b) já cobrem |

---

## 3. Arquivos a criar/modificar

```
crosstrainer-comissoes/
├── functions/index.js                ← MOD — generateClassesCore consulta vacation_requests aprovadas
├── professores.html                   ← MOD — page-ferias + modais + CSS
├── professores.js                     ← MOD — PROF_PAGES (ferias pra todos) + handler
├── professores-shared.js              ← MOD — VacationService (solicitar, aprovar, recusar, cancelar, list)
├── professores-ferias.js              ← NOVO — telas (admin + professor) + modais
├── firestore.rules                    ← MOD — refinar regras pra vacation_requests
└── firestore.indexes.json             ← MOD — índice composto status+requestedAt
```

---

## 4. Schemas

### `vacation_requests/{id}` — Sprint 6a popula
```js
{
  teacherId: 'tch-lucas',
  teacherName: 'Lucas Mendes',
  teacherType: 'efetivo' | 'estagiario',          // 'eventual' bloqueado na UI
  unitId: 'unit-cp',                              // unidade principal do teacher (snapshot)

  type: 'ferias' | 'recesso',                     // auto: efetivo→ferias, estagiario→recesso

  periods: [
    { startDate: Timestamp, endDate: Timestamp, days: 15 },  // mínimo 1
    { startDate: Timestamp, endDate: Timestamp, days: 10 },  // opcional
    { startDate: Timestamp, endDate: Timestamp, days: 5 },   // opcional (máx 3)
  ],
  totalDays: 30,                                  // soma dos periods.days

  reason: 'férias programadas',                   // texto livre

  status: 'pendente' | 'aprovada' | 'recusada' | 'cancelada',

  // Solicitação
  requestedAt: Timestamp,
  requestedBy: 'uid-...',
  requestedByName: 'Lucas Mendes',

  // Resposta admin (aprovada ou recusada)
  respondedAt: Timestamp | null,
  respondedBy: 'uid-admin' | null,
  respondedByName: 'Admin Teste' | null,
  responseNote: string | null,

  // Cancelamento (se status = cancelada)
  cancelledAt: Timestamp | null,
  cancelledBy: 'uid-...' | null,
  cancelReason: string | null,

  createdAt, updatedAt,
}
```

### `notifications` — novos tipos
- `vacation_requested` — pra todos os admins/gestao da unidade do solicitante
- `vacation_approved` — pro solicitante
- `vacation_rejected` — pro solicitante
- `vacation_cancelled` — pro solicitante (se cancelado por admin) OU pros admins (se cancelado pelo solicitante)

---

## 5. Sequência de implementação

### Etapa 1 — Schema + Security Rules + Services (~1 dia)

#### Security Rules (refinar regra existente)
```js
match /vacation_requests/{id} {
  allow read: if isAuth() && (
    isAdmin() || isSuperv() ||
    resource.data.teacherId == uData().professorId
  );
  allow create: if isAuth() && hasProfModule()
    && request.resource.data.requestedBy == request.auth.uid
    && request.resource.data.status == 'pendente';
  allow update: if isAuth() && (
    isAdmin() || isSuperv() ||
    // Solicitante pode cancelar apenas se ainda pendente
    (resource.data.teacherId == uData().professorId
     && resource.data.status == 'pendente'
     && request.resource.data.status == 'cancelada')
  );
  allow delete: if false;
}
```

#### Service em `professores-shared.js`:
- `VacationService.request({teacherId, type, periods, reason})` — cria pending + valida regras
- `VacationService.approve(reqId, note?)` — só admin/gestao, audit log + notif
- `VacationService.reject(reqId, note)` — idem, com motivo
- `VacationService.cancel(reqId)` — solicitante (se pending) OU admin (qualquer)
- `VacationService.listByTeacher(teacherId, statuses?)` — pro painel do professor
- `VacationService.listAll(filters?)` — pra gestão (status, unitId, year)
- Validações dentro do `request`:
  - Eventual → erro "sem direito formal"
  - 1-3 períodos
  - Períodos não se sobrepõem
  - Datas futuras (não permite retroativo nessa sprint)
  - Antecedência mínima (30 dias efetivo, 15 dias estagiário) — admin pode forçar
  - Efetivo: 1º período ≥ 14 dias, demais ≥ 5, total = 30
  - Estagiário: mínimo 5 dias por período, total ≤ 30

### Etapa 2 — UI Professor "Minhas Férias" (~1 dia)
- [ ] Sidebar item visível pra professor/professor_estagiario
- [ ] `renderMinhasFeriasPage()` em `professores-ferias.js`
- [ ] Tabela com solicitações próprias (data, tipo, períodos, status, ações)
- [ ] Botão "+ Nova solicitação"
- [ ] Modal de solicitação:
  - Tipo (auto-detectado, read-only)
  - Until 3 períodos (botão "+ Adicionar período" enquanto < 3)
  - Cada período: data início + data fim → calcula `days` automaticamente
  - Motivo (textarea opcional)
  - Validações na hora (antecedência, sobreposição, regras CLT)
- [ ] Empty state se professor é eventual

### Etapa 3 — UI Admin "Gerenciar Férias" (~1 dia)
- [ ] Sidebar item visível pra admin/admin_gestao/supervisao
- [ ] `renderFeriasPage()` em `professores-ferias.js`
- [ ] Filtros: chip de status (todos/pendente/aprovada/recusada/cancelada) + select de teacher + select de unidade
- [ ] Tabela: teacher · tipo · períodos resumidos · total dias · solicitado em · status · ações
- [ ] Linha pendente: botões "✓ Aprovar" + "✗ Recusar"
- [ ] Linha aprovada: botão "Cancelar" (admin pode reverter)
- [ ] Modal de aprovação/recusa: motivo opcional (obrigatório se recusa)

### Etapa 4 — CF `generateClassesCore` modificada (~1 dia)
- [ ] Antes do loop principal de candidates, buscar `vacation_requests where status='aprovada'`
- [ ] Construir `Map<teacherId, Set<YYYY-MM-DD>>` com todas as datas BR de períodos aprovados
- [ ] Dentro do loop, pular candidate se `vacationByTeacher.get(slot.teacherId)?.has(ymdBR)`
- [ ] Logar quantos candidates foram pulados por férias

### Etapa 5 — Notificações in-app (~0,5 dia)
- [ ] Adicionar tipos novos em `NOTIF_TYPE_META` (professores-shared.js + functions/index.js)
- [ ] `VacationService.request` → notif pra admins da unidade do solicitante
- [ ] `VacationService.approve/reject/cancel` → notif pro solicitante (ou pro admin se foi solicitante quem cancelou)

### Etapa 6 — Comandos admin.js + Smoke test (~0,5 dia)
- [ ] `scripts/admin.js`:
  - `list-vacations [status]` — lista pedidos
  - `approve-vacation <reqId>` — aprova via admin SDK
  - `reject-vacation <reqId> <motivo>` — recusa
  - `smoke-6a` — roda critérios automatizáveis
- [ ] Cenários listados em §7

### Etapa 7 — Deploy + Validação (~0,5 dia)
- [ ] Deploy:
  - `firebase deploy --only firestore:rules --project staging`
  - `firebase deploy --only firestore:indexes --project staging`
  - `firebase deploy --only functions:generateClassesForUpcomingWeeks,functions:generateClassesManual --project staging`
- [ ] Smoke test via UI + script

---

## 6. Decisões importantes

| # | Decisão | Resposta |
|---|---------|----------|
| D1 | Workflow | **Professor solicita → admin/gestão aprova ou recusa.** Confirmado |
| D2 | Divisão de períodos | **Até 3 períodos** (padrão CLT). Confirmado |
| D3 | Bloqueio de agenda | **CF não gera classes nas datas aprovadas.** Confirmado |
| D4 | Eventual tem direito? | **Não nesta sprint.** UI mostra mensagem; pode tirar fora do sistema. Backlog: tratar caso a caso |
| D5 | Antecedência mínima | **30 dias efetivo · 15 dias estagiário.** Configurável via const em `professores-shared.js`. Admin pode forçar override marcando checkbox no modal |
| D6 | Regras CLT pra efetivo | 1º período ≥ 14 dias · demais ≥ 5 · soma exata = 30 dias. **Estagiário:** ≥ 5 dias por período · soma ≤ 30 (pode tirar menos) |
| D7 | Cancelamento após aprovação | **Sim, admin pode cancelar** (não o solicitante após aprovação). Sem custo de "desfazer" classes já bloqueadas (CF apenas pula futuros) |
| D8 | Classes já geradas em datas de férias | **Não cancela automaticamente.** Admin marca status manual via modal de aula (Sprint 3a). Backlog: callable `cancelClassesInVacation` |
| D9 | Limite anual ("já tirou X dias") | **Backlog 6b.** Sprint 6a só checa antecedência + regras CLT por solicitação |
| D10 | Pagamento durante férias | **Backlog 6b.** Sprint 6a apenas BLOQUEIA agenda, fechamento pode pagar errado se férias remunerada → admin trata manual |
| D11 | Datas no passado | **Não permite** nesta sprint (admin futuramente cadastra retroativo via outro fluxo se precisar) |
| D12 | Deploy em produção | Não. Aguarda homologação completa do módulo |

---

## 7. Critérios de aceite

| # | Critério | Como verificar |
|---|----------|---------------|
| 1 | Sidebar "🏖️ Férias" pra todos perfis (módulo) | Login de admin, gestão, professor — ver item visível |
| 2 | Professor cria solicitação válida (1 período) | Lucas (efetivo) solicita 30 dias contínuos → criada como `pendente` |
| 3 | Validação CLT efetivo bloqueia inválido | Tentar 2 períodos: 10+20 (1º < 14) → erro |
| 4 | Solicitação multi-período (até 3) | Lucas pede 14+10+6 dias → aceita (total=30, 1º≥14, demais≥5) |
| 5 | Eventual bloqueado | Login como teacher type='eventual' → tela mostra mensagem, sem botão criar |
| 6 | Admin aprova pedido | Click "Aprovar" → status `aprovada` · notif pro Lucas · audit log |
| 7 | Admin recusa com motivo | Click "Recusar" + motivo → status `recusada` · notif pro Lucas com motivo |
| 8 | CF pula classes nas férias aprovadas | Após aprovação, chamar `generateClassesManual` → classes do Lucas nos dias de férias NÃO são criadas |
| 9 | Notificações criadas corretamente | `notifications` com tipos `vacation_*` chegam ao destinatário certo |
| 10 | Audit log com `module='ferias'` | Cada operação registrada · zero regressão em outros módulos |

---

## 8. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|--------------|----------|
| CF demora a verificar férias (N+1 reads) | 🟡 Média | Pré-busca via `where('status', '==', 'aprovada')` uma vez no início do core, monta Map em memória |
| Sobreposição de períodos não detectada | 🟡 Média | Validação client-side + server-side via Service |
| Admin aprova férias retroativa | 🟢 Baixa | UI bloqueia datas passadas. Backend rejeita |
| Cancelar férias aprovada não cancela classes já geradas | 🟢 Baixa | Documentado em D8. Admin trata manual ou via callable backlog |
| Estagiário sem `internshipStartDate` solicita | 🟡 Média | Sprint 6b adiciona validação de 12 meses. 6a aceita qualquer estagiário (manual) |
| Confusão UI quando professor logado tem `professorId` apontando pra outro | 🟢 Baixa | Já tratado pelo `getCurrentProfessorId()` (Sprint 3a) |

---

## 9. Após a sprint

Sprint 6a termina quando os 10 critérios passarem. Próximo passo:
- 🟢 **Sprint 6b (opcional)** — Cálculo de pagamento de férias (1/3 constitucional CLT) + controle anual de saldo + recesso pago de estagiário
- 🟢 **Sprint 7** — Notificações por email (Brevo + Trigger Email)
- 🟢 **Sprint 8** — Relatórios + Exportações
- Aguarda homologação completa antes do deploy em produção

---

## 📋 Snippets-chave (pra desenvolvimento autônomo)

### Snippet 1 — Validações em `VacationService.request`

```js
const ANTECEDENCIA_EFETIVO = 30;    // dias
const ANTECEDENCIA_ESTAGIARIO = 15;
const FERIAS_TOTAL_EFETIVO = 30;
const PRIMEIRO_PERIODO_MIN = 14;
const DEMAIS_PERIODOS_MIN = 5;
const RECESSO_MAX_ESTAGIARIO = 30;

function validateVacationRequest({ teacher, type, periods, force = false }) {
  if (teacher.type === 'eventual') {
    return 'Professores eventuais não têm direito formal a férias/recesso. Fale com a gestão.';
  }
  if (!Array.isArray(periods) || periods.length === 0 || periods.length > 3) {
    return 'Informe entre 1 e 3 períodos.';
  }
  // Calcula dias de cada período (inclusivo)
  const periodsWithDays = periods.map(p => {
    const start = p.startDate.toDate ? p.startDate.toDate() : new Date(p.startDate);
    const end = p.endDate.toDate ? p.endDate.toDate() : new Date(p.endDate);
    const days = Math.round((end - start) / 86400000) + 1;
    return { ...p, days, _start: start, _end: end };
  });

  // Datas futuras
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const p of periodsWithDays) {
    if (p._start < today) return 'Datas no passado não são permitidas.';
    if (p._end < p._start) return 'Data fim anterior à data início em um dos períodos.';
  }

  // Sobreposição
  for (let i = 0; i < periodsWithDays.length; i++) {
    for (let j = i + 1; j < periodsWithDays.length; j++) {
      if (periodsWithDays[i]._start <= periodsWithDays[j]._end && periodsWithDays[j]._start <= periodsWithDays[i]._end) {
        return 'Períodos se sobrepõem.';
      }
    }
  }

  // Antecedência
  if (!force) {
    const earliest = periodsWithDays.map(p => p._start).reduce((a, b) => a < b ? a : b);
    const diasAteIniciar = Math.round((earliest - today) / 86400000);
    const minAnt = teacher.type === 'efetivo' ? ANTECEDENCIA_EFETIVO : ANTECEDENCIA_ESTAGIARIO;
    if (diasAteIniciar < minAnt) {
      return `Antecedência mínima de ${minAnt} dias não atendida (faltam ${diasAteIniciar} dias).`;
    }
  }

  const totalDays = periodsWithDays.reduce((s, p) => s + p.days, 0);

  if (teacher.type === 'efetivo') {
    if (totalDays !== FERIAS_TOTAL_EFETIVO) {
      return `CLT exige total de ${FERIAS_TOTAL_EFETIVO} dias para efetivo (informado: ${totalDays}).`;
    }
    if (periodsWithDays.length > 1) {
      const sorted = [...periodsWithDays].sort((a, b) => b.days - a.days);
      if (sorted[0].days < PRIMEIRO_PERIODO_MIN) {
        return `1º período deve ter no mínimo ${PRIMEIRO_PERIODO_MIN} dias (CLT).`;
      }
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].days < DEMAIS_PERIODOS_MIN) {
          return `Demais períodos devem ter no mínimo ${DEMAIS_PERIODOS_MIN} dias cada.`;
        }
      }
    }
  } else if (teacher.type === 'estagiario') {
    if (totalDays > RECESSO_MAX_ESTAGIARIO) {
      return `Recesso máximo de ${RECESSO_MAX_ESTAGIARIO} dias (informado: ${totalDays}).`;
    }
    if (periodsWithDays.some(p => p.days < DEMAIS_PERIODOS_MIN)) {
      return `Mínimo ${DEMAIS_PERIODOS_MIN} dias por período.`;
    }
  }

  return null;  // OK
}
```

### Snippet 2 — `VacationService.request`

```js
const VacationService = {
  async request({ teacherId, periods, reason, force = false }) {
    if (!teacherId) return { success: false, error: 'teacherId obrigatório' };
    try {
      const teacherDoc = await db.collection('teachers').doc(teacherId).get();
      if (!teacherDoc.exists) return { success: false, error: 'Professor não encontrado' };
      const teacher = teacherDoc.data();

      const type = teacher.type === 'estagiario' ? 'recesso' : 'ferias';

      const validationErr = validateVacationRequest({ teacher, type, periods, force });
      if (validationErr) return { success: false, error: validationErr };

      // Normaliza períodos (Timestamps + days)
      const normalizedPeriods = periods.map(p => {
        const start = p.startDate.toDate ? p.startDate.toDate() : new Date(p.startDate);
        const end = p.endDate.toDate ? p.endDate.toDate() : new Date(p.endDate);
        const days = Math.round((end - start) / 86400000) + 1;
        return {
          startDate: firebase.firestore.Timestamp.fromDate(start),
          endDate: firebase.firestore.Timestamp.fromDate(end),
          days,
        };
      });
      const totalDays = normalizedPeriods.reduce((s, p) => s + p.days, 0);

      const ref = db.collection('vacation_requests').doc();
      const uid = currentUserId();
      const data = {
        teacherId,
        teacherName: teacher.name,
        teacherType: teacher.type,
        unitId: teacher.primaryUnitId || (teacher.unitIds && teacher.unitIds[0]) || null,
        type,
        periods: normalizedPeriods,
        totalDays,
        reason: (reason || '').toString().slice(0, 500),
        status: 'pendente',
        requestedAt: serverTs(),
        requestedBy: uid,
        requestedByName: currentUserName(),
        respondedAt: null, respondedBy: null, respondedByName: null, responseNote: null,
        cancelledAt: null, cancelledBy: null, cancelReason: null,
        createdAt: serverTs(), updatedAt: serverTs(),
      };
      await ref.set(data);

      // Notif pros admins (busca users com profile admin ou admin_gestao)
      const adminsSnap = await db.collection('users')
        .where('profiles', 'array-contains-any', ['admin', 'admin_gestao'])
        .get();
      for (const u of adminsSnap.docs) {
        await NotificationService.create({
          recipientUserId: u.id,
          type: 'vacation_requested',
          body: `${teacher.name} (${teacher.type}) solicitou ${type} · ${totalDays} dias`,
          link: { type: 'vacation', id: ref.id },
        });
      }

      await AuditService.log({
        type: 'vacation_requested',
        details: `Solicitação de ${type} criada (${teacher.name} · ${totalDays} dias)`,
        entityType: 'vacation_request', entityId: ref.id,
        before: null, after: { ...data, id: ref.id },
        module: 'ferias',
      });

      return { success: true, data: { id: ref.id, ...data } };
    } catch (err) {
      console.error('[VacationService.request]', err);
      return { success: false, error: err.message };
    }
  },

  async approve(reqId, note = '') { return this._respond(reqId, 'aprovada', note); },
  async reject(reqId, note) {
    if (!note) return { success: false, error: 'Motivo da recusa é obrigatório' };
    return this._respond(reqId, 'recusada', note);
  },

  async _respond(reqId, status, note) {
    try {
      const ref = db.collection('vacation_requests').doc(reqId);
      const before = (await ref.get()).data();
      if (!before) return { success: false, error: 'Pedido não encontrado' };
      if (before.status !== 'pendente') return { success: false, error: `Pedido já está como "${before.status}"` };

      const uid = currentUserId();
      const after = {
        status,
        respondedAt: serverTs(),
        respondedBy: uid,
        respondedByName: currentUserName(),
        responseNote: (note || '').toString().slice(0, 500) || null,
        updatedAt: serverTs(),
      };
      await ref.update(after);

      // Notif pro solicitante
      await NotificationService.create({
        recipientUserId: before.requestedBy,
        type: status === 'aprovada' ? 'vacation_approved' : 'vacation_rejected',
        body: status === 'aprovada'
          ? `Suas ${before.type} foram aprovadas (${before.totalDays} dias)`
          : `Suas ${before.type} foram recusadas. Motivo: ${note}`,
        link: { type: 'vacation', id: reqId },
      });

      await AuditService.log({
        type: `vacation_${status}`,
        details: `${status === 'aprovada' ? 'Aprovada' : 'Recusada'} ${before.type} de ${before.teacherName}${note ? ` · ${note}` : ''}`,
        entityType: 'vacation_request', entityId: reqId,
        before, after: { ...before, ...after },
        module: 'ferias',
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async cancel(reqId, reason = '') {
    try {
      const ref = db.collection('vacation_requests').doc(reqId);
      const before = (await ref.get()).data();
      if (!before) return { success: false, error: 'Pedido não encontrado' };
      const uid = currentUserId();
      const after = {
        status: 'cancelada',
        cancelledAt: serverTs(),
        cancelledBy: uid,
        cancelReason: (reason || '').toString().slice(0, 500) || null,
        updatedAt: serverTs(),
      };
      await ref.update(after);
      await NotificationService.create({
        recipientUserId: before.requestedBy === uid
          // Cancelado pelo próprio solicitante: notifica admins
          ? before.requestedBy  // (placeholder; logic mais robusta busca admins)
          : before.requestedBy, // Cancelado por admin: notifica solicitante
        type: 'vacation_cancelled',
        body: `Pedido de ${before.type} foi cancelado.`,
        link: { type: 'vacation', id: reqId },
      });
      await AuditService.log({
        type: 'vacation_cancelled',
        details: `Pedido de ${before.type} cancelado (${before.teacherName})`,
        entityType: 'vacation_request', entityId: reqId,
        before, after: { ...before, ...after },
        module: 'ferias',
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async listByTeacher(teacherId) {
    const snap = await db.collection('vacation_requests')
      .where('teacherId', '==', teacherId)
      .orderBy('requestedAt', 'desc')
      .get();
    return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
  },

  async listAll({ status, unitId } = {}) {
    let q = db.collection('vacation_requests');
    if (status) q = q.where('status', '==', status);
    if (unitId) q = q.where('unitId', '==', unitId);
    const snap = await q.orderBy('requestedAt', 'desc').get();
    return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
  },
};
```

### Snippet 3 — Modificar `generateClassesCore` (functions/index.js)

Adicionar ANTES do loop principal de candidates:

```js
// Sprint 6a — pré-busca férias/recessos aprovados
const vacSnap = await firestore.collection('vacation_requests')
  .where('status', '==', 'aprovada').get();
const vacationDatesByTeacher = new Map();  // teacherId → Set<'YYYY-MM-DD'>
vacSnap.docs.forEach(d => {
  const v = d.data();
  if (!v.teacherId || !Array.isArray(v.periods)) return;
  if (!vacationDatesByTeacher.has(v.teacherId)) {
    vacationDatesByTeacher.set(v.teacherId, new Set());
  }
  const set = vacationDatesByTeacher.get(v.teacherId);
  v.periods.forEach(p => {
    let cur = p.startDate.toDate();
    const end = p.endDate.toDate();
    while (cur <= end) {
      const c = brComponents(cur);
      const ymd = `${c.year}-${String(c.month + 1).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
      set.add(ymd);
      cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
    }
  });
});
```

E DENTRO do loop, ao construir candidates, adicionar filtro:

```js
const ymdISO = ymdISOFromDateBR(dateClone);  // 'YYYY-MM-DD'
const teacherVacations = vacationDatesByTeacher.get(slot.teacherId);
if (teacherVacations && teacherVacations.has(ymdISO)) {
  continue;  // Pula esse candidate — professor de férias nesse dia
}
```

### Snippet 4 — Security Rules

```js
// firestore.rules — substituir bloco existente de vacation_requests
match /vacation_requests/{id} {
  allow read: if isAuth() && (
    isAdmin() || isSuperv() ||
    resource.data.teacherId == uData().professorId
  );
  allow create: if isAuth() && hasProfModule()
    && request.resource.data.requestedBy == request.auth.uid
    && request.resource.data.status == 'pendente';
  allow update: if isAuth() && (
    // Admin/gestão pode mudar status (aprovar/recusar/cancelar)
    isAdmin() || isSuperv() ||
    // Solicitante pode cancelar se ainda pendente
    (resource.data.requestedBy == request.auth.uid
     && resource.data.status == 'pendente'
     && request.resource.data.status == 'cancelada')
  );
  allow delete: if false;
}
```

### Snippet 5 — Índice composto pra filtro

```json
{
  "collectionGroup": "vacation_requests",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status",      "order": "ASCENDING" },
    { "fieldPath": "requestedAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "vacation_requests",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "unitId",      "order": "ASCENDING" },
    { "fieldPath": "status",      "order": "ASCENDING" },
    { "fieldPath": "requestedAt", "order": "DESCENDING" }
  ]
}
```

### Snippet 6 — Comando smoke-6a no admin.js

```js
async function cmdSmoke6a() {
  console.log('\n══════ SMOKE TEST Sprint 6a ══════\n');

  const all = await db.collection('vacation_requests').get();
  console.log(`Total de pedidos: ${all.size}`);

  const byStatus = {};
  all.docs.forEach(d => { byStatus[d.data().status] = (byStatus[d.data().status] || 0) + 1; });
  console.log('Por status:', byStatus);

  console.log('\nÚltimas 5 solicitações:');
  const ord = all.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.requestedAt?.toMillis() || 0) - (a.requestedAt?.toMillis() || 0))
    .slice(0, 5);
  ord.forEach(r => {
    console.log(`  [${r.status}] ${r.teacherName} (${r.type}) · ${r.totalDays}d · ${r.periods?.length} período(s)`);
  });

  // Audit log
  const audit = await db.collection('audit_log').where('module', '==', 'ferias').get();
  console.log(`\nAudit log module=ferias: ${audit.size} entries`);

  console.log('\n══════ FIM SMOKE TEST Sprint 6a ══════');
}
```

---

## 🚨 Dicas finais

1. **Server-side validation:** repete `validateVacationRequest` no service. Client validate é UX, server é segurança.
2. **Cache da lista de férias no CF:** se a CF executar 4x/mês, custa 4 reads pra vacation_requests. Irrelevante.
3. **Antecedência admin pode forçar?** Sim — checkbox "Admin override" no modal de solicitação (visível apenas pra admin/gestão criando em nome de outro). Senão, validação roda normal.
4. **Timezone:** todas as datas em BR (consistente com Sprint 5a). `brMidnightUTC` e `brComponents` já existem.
5. **Sprint 6b** vai precisar do `internshipStartDate` do estagiário pra validar "12 meses trabalhados". Por ora, aceitar qualquer estagiário.
6. **Quando travar:** me chama com erro/diff, eu reviso o trecho específico.
