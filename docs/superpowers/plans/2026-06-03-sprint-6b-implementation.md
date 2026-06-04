# Sprint 6b — Pagamento durante Férias — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar cálculo e registro de pagamento para férias (efetivo, CLT 1/3) e recesso (estagiário, Lei 11.788/2008). Modal único aprovação+pagamento, integração com closeMonth, recibo A4, e contador sidebar.

**Architecture:** VacationPaymentService novo em professores-shared.js (cálculo + persistência). Modal de aprovação existente ganha bloco pagamento embutido com preview ao vivo. closeMonth modificado para detectar férias do mês e garantir entry para professor 100% férias. Recibo ganha seção condicional.

**Tech Stack:** HTML/CSS/JS vanilla + Firebase (Firestore, Functions, Auth). Sem framework.

**Source spec:** `sprint-6b-pagamento-ferias.md` (v2, 1002 linhas, 16 critérios)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `scripts/backfill-vacation-denorm.js` | CREATE | Popula firstPeriodStart/lastPeriodEnd em legados 6a |
| `professores-shared.js` | MODIFY | VacationPaymentService + getEffectiveStipendAt + window.ProfHelpers export |
| `firestore.rules` | MODIFY | Bloquear supervisor em payment.*, regras de edição |
| `firestore.indexes.json` | MODIFY | Índice (status, firstPeriodStart) |
| `professores-ferias.js` | MODIFY | Modal aprovação com bloco pagamento + coluna tabela + edição |
| `professores.html` | MODIFY | CSS bloco pagamento + coluna + sidebar counter |
| `professores.js` | MODIFY | Contador sidebar 🏖️ Férias (N) |
| `functions/index.js` | MODIFY | closeMonth: merge teacherIds + split vacation + paidInClosingIds |
| `professores-fechamento.js` | MODIFY | Linha "Férias" no detalhe do professor |
| `receipt.html` | MODIFY | Seção "🏖️ Férias" condicional |
| `scripts/admin.js` | MODIFY | Comandos vacation-preview + set-vacation-payment + smoke-6b |

---

### Task 1: Backfill de denormalização (Etapa 1)

**Files:**
- Create: `scripts/backfill-vacation-denorm.js`

- [ ] **Step 1: Criar script de backfill**

```js
// scripts/backfill-vacation-denorm.js
// Popula firstPeriodStart/lastPeriodEnd em vacation_requests legados do 6a.
// Idempotente: pula docs já preenchidos.
// Uso: node scripts/backfill-vacation-denorm.js --project staging

'use strict';
const admin = require('firebase-admin');
const path = require('path');

const projectArg = process.argv.find(a => a.startsWith('--project='))?.split('=')[1] || 'staging';
const projectId = projectArg === 'production' ? 'crosstrainer-comissoes' : 'crosstrainer-comissoes-staging';
const credPath = path.join(__dirname, `serviceAccount-${projectArg}.json`);

admin.initializeApp({
  credential: admin.credential.cert(require(credPath)),
  projectId,
});

const db = admin.firestore();

(async () => {
  const snap = await db.collection('vacation_requests').get();
  let updated = 0, skipped = 0, errors = 0;

  for (const doc of snap.docs) {
    const d = doc.data();

    if (d.firstPeriodStart && d.lastPeriodEnd) {
      skipped++;
      continue;
    }
    if (!Array.isArray(d.periods) || d.periods.length === 0) {
      skipped++;
      continue;
    }

    try {
      const firstStart = d.periods.reduce((min, p) => {
        const ts = p.startDate;
        return (!min || ts.toMillis() < min.toMillis()) ? ts : min;
      }, null);
      const lastEnd = d.periods.reduce((max, p) => {
        const ts = p.endDate;
        return (!max || ts.toMillis() > max.toMillis()) ? ts : max;
      }, null);

      await doc.ref.update({
        firstPeriodStart: firstStart,
        lastPeriodEnd: lastEnd,
      });
      updated++;
      console.log(`  ✓ ${doc.id}: ${d.teacherName} · ${d.totalDays} dias`);
    } catch (err) {
      errors++;
      console.error(`  ✗ ${doc.id}: ${err.message}`);
    }
  }

  console.log(`\nBackfill concluído: ${updated} atualizados · ${skipped} pulados · ${errors} erros`);
  await admin.app().delete();
})();
```

- [ ] **Step 2: Rodar backfill em staging**

```bash
node scripts/backfill-vacation-denorm.js --project staging
```

Expected: lista de requests atualizados, 0 erros.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-vacation-denorm.js
git commit -m "feat(sprint-6b): script de backfill firstPeriodStart/lastPeriodEnd para vacation_requests legados"
```

---

### Task 2: VacationService.request — gravar denormalização na criação (Etapa 1)

**Files:**
- Modify: `professores-shared.js` — método `VacationService.request()`

Localizar no `VacationService.request()` onde o doc é criado (próximo ao `db.collection('vacation_requests').add(...)`) e adicionar os dois campos denormalizados.

- [ ] **Step 1: Adicionar firstPeriodStart e lastPeriodEnd no doc de criação**

No `VacationService.request()`, localizar o objeto passado para `.add()` (contém `teacherId`, `teacherName`, `periods`, `totalDays`, `status`, etc.). Adicionar após `totalDays`:

```js
// ─── Sprint 6b — denormalização pra query por período ───
firstPeriodStart: periods[0].startDate,
lastPeriodEnd: periods[periods.length - 1].endDate,
```

E no início do método, após calcular `totalDays` e antes do `db.collection(...).add(...)`:

```js
// Normaliza períodos — garante que startDate/endDate são Timestamps ordenados
const sortedPeriods = [...periods].sort((a, b) => {
  const ta = a.startDate.toMillis ? a.startDate.toMillis() : new Date(a.startDate).getTime();
  const tb = b.startDate.toMillis ? b.startDate.toMillis() : new Date(b.startDate).getTime();
  return ta - tb;
});
```

E usar `sortedPeriods` no lugar de `periods` para `firstPeriodStart`/`lastPeriodEnd`.

- [ ] **Step 2: Verificar que não quebrou nada**

```bash
# Testar via console do navegador em staging:
# ProfHelpers.VacationService.request({...}) continua funcionando
```

- [ ] **Step 3: Commit**

```bash
git add professores-shared.js
git commit -m "feat(sprint-6b): VacationService.request grava firstPeriodStart/lastPeriodEnd"
```

---

### Task 3: VacationPaymentService + getEffectiveStipendAt (Etapa 1 + 2)

**Files:**
- Modify: `professores-shared.js`

Adicionar `getEffectiveStipendAt` (helper) e `VacationPaymentService` (4 métodos) após o bloco do `VacationService` existente (~linha 2874). Expor no `window.ProfHelpers`.

- [ ] **Step 1: Adicionar helper `getEffectiveStipendAt`**

Após `getEffectiveSalaryAt` (~linha 1762), adicionar:

```js
/**
 * Retorna o internMonthlyStipend vigente em uma data específica.
 * Espelha a lógica de getEffectiveSalaryAt: percorre salaryHistory
 * rebobinando mudanças com effectiveDate > targetDate.
 */
function getEffectiveStipendAt(salaryData, date) {
  if (!salaryData) return 0;
  let stipend = salaryData.internMonthlyStipend || 0;
  const targetMs = date.getTime();

  if (!Array.isArray(salaryData.salaryHistory) || salaryData.salaryHistory.length === 0) {
    return stipend;
  }

  const sorted = [...salaryData.salaryHistory].sort((a, b) => {
    const ta = (a.effectiveDate && a.effectiveDate.toMillis) ? a.effectiveDate.toMillis() : 0;
    const tb = (b.effectiveDate && b.effectiveDate.toMillis) ? b.effectiveDate.toMillis() : 0;
    return tb - ta;
  });

  for (const entry of sorted) {
    const entryMs = (entry.effectiveDate && entry.effectiveDate.toMillis) ? entry.effectiveDate.toMillis() : 0;
    if (entryMs > targetMs && entry.field === 'internMonthlyStipend') {
      stipend = entry.previousValue;
    }
  }

  return stipend;
}
```

- [ ] **Step 2: Adicionar `VacationPaymentService`**

Após o fim do `VacationService` (~linha 2874), adicionar o serviço completo. Usar o Snippet 1 (v2 com MAX e payIntern condicional) + Snippet 2 (com suporte a deferred) do playbook.

```js
const VacationPaymentService = {

  // ─── calculateForRequest ───
  async calculateForRequest(req, opts = {}) {
    if (!req || !req.teacherId || !Array.isArray(req.periods)) {
      return { success: false, error: 'vacation_request inválido' };
    }
    const mode = opts.mode || 'auto';
    const notes = (opts.notes || '').trim();

    if (mode === 'deferred') {
      return { success: true, data: { mode: 'deferred', value: 0, calculation: null, notes: notes || 'Pagamento adiado pelo admin' } };
    }

    if (mode === 'none') {
      if (!notes) return { success: false, error: 'Justificativa obrigatória para "sem pagamento".' };
      return { success: true, data: { mode: 'none', value: 0, calculation: null, notes } };
    }

    if (mode === 'manual') {
      const value = parseFloat(opts.manualValue);
      if (isNaN(value) || value < 0) return { success: false, error: 'Valor manual inválido.' };
      if (value === 0 && !notes) return { success: false, error: 'Observação obrigatória se valor manual é zero.' };
      return { success: true, data: { mode: 'manual', value, calculation: null, notes: notes || null } };
    }

    // mode === 'auto'
    if (req.teacherType === 'efetivo') return this._calculateEfetivoAuto(req, notes);
    if (req.teacherType === 'estagiario') {
      if (opts.payIntern === false) {
        return { success: true, data: { mode: 'none', value: 0, calculation: null, notes: notes || 'Estagiário sem bolsa proporcional nesta solicitação.' } };
      }
      return this._calculateEstagiarioAuto(req, notes);
    }
    return { success: false, error: 'Tipo de professor não suportado.' };
  },

  // ─── _calculateEfetivoAuto (v2 com MAX) ───
  async _calculateEfetivoAuto(req, notes) {
    const db = firebase.firestore();
    const snap = await db.collection('monthly_closings')
      .where('unitId', '==', req.unitId)
      .where('status', '==', 'fechado')
      .orderBy('year', 'desc').orderBy('month', 'desc')
      .limit(12).get();

    const monthsData = [];
    snap.docs.forEach(d => {
      const data = d.data();
      const t = (data.teachers || []).find(x => x.teacherId === req.teacherId);
      if (t && typeof t.valorHoras === 'number' && t.valorHoras > 0) {
        monthsData.push({ valorHoras: t.valorHoras, year: data.year, month: data.month });
      }
    });

    if (monthsData.length < 3) {
      return { success: false, error: `Histórico insuficiente (${monthsData.length} meses com horas). Defina pagamento manual.` };
    }

    const base12mAvg = monthsData.reduce((a, b) => a + b.valorHoras, 0) / monthsData.length;
    const baseLastMonth = monthsData[0].valorHoras;
    const baseMonthly = Math.max(base12mAvg, baseLastMonth);

    const daysCount = (req.periods || []).reduce((s, p) => s + (p.days || 0), 0);
    const proportionalBase = baseMonthly * daysCount / 30;
    const oneThirdValue = proportionalBase / 3;
    const value = Math.round((proportionalBase + oneThirdValue) * 100) / 100;

    return {
      success: true,
      data: {
        mode: 'auto', value,
        calculation: {
          baseMonthly: Math.round(baseMonthly * 100) / 100,
          base12mAvg: Math.round(base12mAvg * 100) / 100,
          baseLastMonth: Math.round(baseLastMonth * 100) / 100,
          monthsConsidered: monthsData.length,
          oneThirdValue: Math.round(oneThirdValue * 100) / 100,
          proportionalBase: Math.round(proportionalBase * 100) / 100,
          daysCount,
          formula: 'efetivo-clt-max',
        },
        notes: notes || null,
      }
    };
  },

  // ─── _calculateEstagiarioAuto ───
  async _calculateEstagiarioAuto(req, notes) {
    const db = firebase.firestore();
    const earliestStart = req.periods.reduce((min, p) => {
      const d = p.startDate.toDate ? p.startDate.toDate() : new Date(p.startDate);
      return (!min || d < min) ? d : min;
    }, null);

    const salaryDoc = await db.collection('teacher_salaries').doc(req.teacherId).get();
    if (!salaryDoc.exists) {
      return { success: false, error: 'Cadastro salarial do estagiário não encontrado.' };
    }
    const stipend = getEffectiveStipendAt(salaryDoc.data(), earliestStart);
    if (!stipend || stipend <= 0) {
      return { success: false, error: 'Bolsa mensal não definida para esta data. Use modo manual ou registre como sem pagamento.' };
    }

    const daysCount = (req.periods || []).reduce((s, p) => s + (p.days || 0), 0);
    const proportionalBase = stipend * daysCount / 30;
    const value = Math.round(proportionalBase * 100) / 100;

    return {
      success: true,
      data: {
        mode: 'auto', value,
        calculation: {
          baseMonthly: stipend, base12mAvg: stipend, baseLastMonth: stipend,
          monthsConsidered: 1,
          oneThirdValue: 0, proportionalBase: value,
          daysCount, formula: 'estagiario-bolsa-proporcional',
        },
        notes: notes || null,
      }
    };
  },

  // ─── getInternPayDefault (helper pra UI) ───
  getInternPayDefault(teacher, salaryData) {
    if (teacher.type !== 'estagiario') return false;
    const stipend = getEffectiveStipendAt(salaryData, new Date());
    return stipend > 0;
  },

  // ─── setPayment ───
  async setPayment(reqId, paymentData) {
    if (!reqId || !paymentData) return { success: false, error: 'Argumentos obrigatórios' };
    const db = firebase.firestore();
    try {
      const ref = db.collection('vacation_requests').doc(reqId);
      const beforeDoc = await ref.get();
      if (!beforeDoc.exists) return { success: false, error: 'Pedido não encontrado' };
      const before = beforeDoc.data();

      if (before.status !== 'aprovada') {
        return { success: false, error: 'Só é possível definir pagamento em férias aprovadas.' };
      }
      if (Array.isArray(before.paidInClosingIds) && before.paidInClosingIds.length > 0) {
        return { success: false, error: 'Pagamento já foi processado em fechamento — não pode ser editado.' };
      }

      const uid = currentUserId();
      const isUpdate = before.payment && before.payment.setAt;

      const payment = {
        mode: paymentData.mode,
        value: paymentData.value || 0,
        calculation: paymentData.calculation || null,
        notes: paymentData.notes || null,
      };

      if (isUpdate) {
        payment.setBy = before.payment.setBy;
        payment.setByName = before.payment.setByName;
        payment.setAt = before.payment.setAt;
        payment.updatedBy = uid;
        payment.updatedByName = currentUserName();
        payment.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      } else {
        payment.setBy = uid;
        payment.setByName = currentUserName();
        payment.setAt = firebase.firestore.FieldValue.serverTimestamp();
        payment.updatedBy = null;
        payment.updatedByName = null;
        payment.updatedAt = null;
      }

      await ref.update({
        payment,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      // Notificação ao professor (só se NÃO é deferred)
      if (payment.mode !== 'deferred') {
        await NotificationService.create({
          recipientUserId: before.requestedBy,
          type: 'vacation_payment_set',
          title: isUpdate ? 'Pagamento de férias atualizado' : 'Pagamento de férias definido',
          body: payment.value > 0
            ? `${before.type} de ${before.totalDays} dias — R$ ${payment.value.toFixed(2)} (${payment.mode})`
            : `${before.type} de ${before.totalDays} dias registrada sem pagamento`,
          link: { type: 'vacation', id: reqId },
        });
      }

      await AuditService.log({
        type: isUpdate ? 'vacation_payment_updated' : 'vacation_payment_set',
        details: `${isUpdate ? 'Atualizado' : 'Definido'} pagamento de ${before.type} ${before.teacherName}: R$ ${payment.value.toFixed(2)} (${payment.mode})`,
        entityType: 'vacation_request', entityId: reqId,
        before: { payment: before.payment || null },
        after: { payment },
        module: 'ferias',
      });

      return { success: true, data: payment };
    } catch (err) {
      console.error('[VacationPaymentService.setPayment]', err);
      return { success: false, error: err.message };
    }
  },

  // ─── updatePayment (alias para edição — mesma validação do setPayment) ───
  async updatePayment(reqId, paymentData) {
    return this.setPayment(reqId, paymentData);
  },

  // ─── previewMonthlyImpact ───
  async previewMonthlyImpact(reqId, year, month) {
    // Busca o request e calcula quanto cairia num fechamento hipotético
    const db = firebase.firestore();
    const doc = await db.collection('vacation_requests').doc(reqId).get();
    if (!doc.exists) return { success: false, error: 'Pedido não encontrado' };
    const req = { id: doc.id, ...doc.data() };
    if (!req.payment || req.payment.value <= 0) {
      return { success: false, error: 'Pedido sem pagamento definido' };
    }

    // Recorta os períodos ao mês
    const monthStart = new Date(Date.UTC(year, month - 1, 1, 3, 0, 0));
    const monthEnd = new Date(Date.UTC(year, month, 0, 3, 0, 0));
    monthEnd.setUTCHours(26, 59, 59, 999);

    let daysInMonth = 0;
    for (const p of (req.periods || [])) {
      const ps = p.startDate.toDate();
      const pe = p.endDate.toDate();
      const clipStart = ps < monthStart ? monthStart : ps;
      const clipEnd = pe > monthEnd ? monthEnd : pe;
      if (clipStart > clipEnd) continue;
      daysInMonth += Math.round((clipEnd - clipStart) / 86400000) + 1;
    }

    if (daysInMonth === 0) return { success: true, data: { daysInMonth: 0, proportionalValue: 0 } };

    const proportionalValue = Math.round((req.payment.value * daysInMonth / req.totalDays) * 100) / 100;
    return { success: true, data: { daysInMonth, proportionalValue } };
  },
};
```

- [ ] **Step 3: Exportar no window.ProfHelpers**

Adicionar no objeto `window.ProfHelpers` (após `CreditService`):

```js
// Sprint 6b — VacationPaymentService
VacationPaymentService,
getEffectiveStipendAt,
```

- [ ] **Step 4: Commit**

```bash
git add professores-shared.js
git commit -m "feat(sprint-6b): VacationPaymentService + getEffectiveStipendAt + getInternPayDefault"
```

---

### Task 4: Security Rules + Índice (Etapa 1)

**Files:**
- Modify: `firestore.rules`
- Modify: `firestore.indexes.json`

- [ ] **Step 1: Atualizar regra de update em vacation_requests**

Localizar o bloco `match /vacation_requests/{id}` em `firestore.rules`. Substituir a regra `allow update` existente:

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
    // (A) Mudanças que tocam payment ou paidInClosingIds
    // APENAS admin/admin_gestao (supervisor NÃO)
    // Só permitido enquanto paidInClosingIds vazio
    (
      request.resource.data.diff(resource.data).affectedKeys()
        .hasAny(['payment', 'paidInClosingIds'])
      && isAdmin()
      && (!('paidInClosingIds' in resource.data) || resource.data.paidInClosingIds.size() == 0)
      && request.resource.data.diff(resource.data).affectedKeys()
          .hasOnly(['payment', 'paidInClosingIds', 'updatedAt'])
    )
    ||
    // (B) Mudanças de status (admin, admin_gestao, supervisor)
    (
      !request.resource.data.diff(resource.data).affectedKeys().hasAny(['payment', 'paidInClosingIds'])
      && (isAdmin() || isSuperv())
    )
    ||
    // (C) Solicitante cancelando pendente
    (resource.data.requestedBy == request.auth.uid
     && resource.data.status == 'pendente'
     && request.resource.data.status == 'cancelada'
     && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'cancelledAt', 'cancelledBy', 'cancelledByName', 'cancelledReason', 'updatedAt']))
  );
}
```

- [ ] **Step 2: Adicionar índice composto em firestore.indexes.json**

Adicionar ao array `indexes`:

```json
{
  "collectionGroup": "vacation_requests",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "firstPeriodStart", "order": "ASCENDING" }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add firestore.rules firestore.indexes.json
git commit -m "feat(sprint-6b): security rules — supervisor sem acesso a payment + índice vacation_requests(status,firstPeriodStart)"
```

---

### Task 5: Modal de aprovação com bloco "Pagamento" (Etapa 3)

**Files:**
- Modify: `professores-ferias.js`

O modal de aprovação atual é disparado pelo botão `aprovarVacation(reqId)`. Mudar a abordagem: ao invés de `confirm()` + `VacationService.approve()`, abrir um modal com o bloco de pagamento embutido.

- [ ] **Step 1: Criar função `openApproveWithPaymentModal(req)` **

Adicionar nova função após `aprovarVacation` existente (~linha 459):

```js
async function openApproveWithPaymentModal(reqId) {
  const db = firebase.firestore();
  const doc = await db.collection('vacation_requests').doc(reqId).get();
  if (!doc.exists) { toast('Pedido não encontrado', 'error'); return; }
  const req = { id: doc.id, ...doc.data() };

  const modal = document.getElementById('feriasModal');
  const content = document.getElementById('feriasModalContent');
  if (!modal || !content) return;

  // Pré-carrega dados necessários pro preview
  let salaryData = null;
  try {
    const sDoc = await db.collection('teacher_salaries').doc(req.teacherId).get();
    if (sDoc.exists) salaryData = sDoc.data();
  } catch (_) {}

  // Calcula estimativa auto pra referência (modo manual alerta)
  let autoEstimate = null;
  if (req.teacherType === 'efetivo') {
    const calc = await VacationPaymentService._calculateEfetivoAuto(req, '');
    if (calc.success) autoEstimate = calc.data.value;
  }

  const showManualAlert = (manualVal) => {
    const alertEl = document.getElementById('manualAlert');
    if (!alertEl) return;
    if (autoEstimate && manualVal > autoEstimate * 1.5) {
      const pct = Math.round(manualVal / autoEstimate * 100);
      alertEl.style.display = 'block';
      alertEl.innerHTML = `⚠️ Valor ${pct}% acima do automático (R$ ${autoEstimate.toFixed(2)}). Confirme.`;
    } else {
      alertEl.style.display = 'none';
    }
  };

  const isEstagiario = req.teacherType === 'estagiario';
  const defaultPayIntern = VacationPaymentService.getInternPayDefault(
    { type: req.teacherType }, salaryData
  );

  content.innerHTML = `
    <h3>Aprovar Férias — ${escapeHtml(req.teacherName)}</h3>
    <div class="ferias-approve-info">
      <span>📅 ${formatPeriodos(req.periods)}</span>
      <span>📐 ${req.totalDays} dias</span>
      <span>🏖️ ${escapeHtml(req.type)}</span>
    </div>

    <div class="form-group">
      <label>Nota de aprovação (opcional)</label>
      <textarea id="approveNote" rows="2" placeholder="Ex: Aprovado conforme planejamento."></textarea>
    </div>

    <hr>

    <div class="payment-block">
      <h4>💰 Pagamento durante o período</h4>

      <div class="payment-mode-selector">
        <label class="payment-radio ${req.teacherType === 'efetivo' ? 'active' : ''}">
          <input type="radio" name="paymentMode" value="auto" checked
            onchange="window._switchPaymentMode('auto')"> Automático
        </label>
        <label class="payment-radio">
          <input type="radio" name="paymentMode" value="manual"
            onchange="window._switchPaymentMode('manual')"> Manual
        </label>
        <label class="payment-radio">
          <input type="radio" name="paymentMode" value="none"
            onchange="window._switchPaymentMode('none')"> Sem pagamento
        </label>
      </div>

      <div id="paymentInternCheck" style="display:${isEstagiario ? 'block' : 'none'};margin:12px 0;">
        <label class="checkbox-label">
          <input type="checkbox" id="payIntern" ${defaultPayIntern ? 'checked' : ''}
            onchange="window._recalcPaymentPreview()">
          Pagar bolsa proporcional ao recesso?
        </label>
        <small class="helper-text">ℹ️ Lei do Estágio (11.788/2008) exige pagamento de recesso quando há bolsa.</small>
      </div>

      <div id="paymentPreview" class="payment-preview" style="display:block;">
        <div class="preview-loader">Calculando...</div>
      </div>

      <div id="paymentManualFields" style="display:none;">
        <div class="form-group">
          <label>Valor (R$)</label>
          <input type="number" id="manualValue" min="0" step="0.01" placeholder="0,00"
            oninput="window._recalcPaymentPreview()">
        </div>
        <div id="manualAlert" class="alert-warning" style="display:none;"></div>
      </div>

      <div id="paymentNoneFields" style="display:none;">
        <div class="form-group">
          <label>Justificativa *</label>
          <textarea id="noneJustification" rows="2" placeholder="Ex: Licença não remunerada"></textarea>
        </div>
      </div>

      <div class="form-group" id="paymentNotesGroup">
        <label>Observação</label>
        <textarea id="paymentNotes" rows="2" placeholder="(opcional)"></textarea>
      </div>
    </div>

    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="window._deferPayment('${reqId}')">Adiar pagamento</button>
      <button class="btn btn-secondary" onclick="closeModal('feriasModal')">Cancelar</button>
      <button class="btn btn-primary" id="btnApprovePayment" onclick="window._submitApproveWithPayment('${reqId}')">
        ✅ Aprovar e definir pagamento
      </button>
    </div>
  `;

  // Expõe estado no window pra callbacks
  window._paymentReq = req;
  window._paymentAutoEstimate = autoEstimate;
  window._paymentSalaryData = salaryData;

  modal.style.display = 'flex';

  // Dispara preview inicial
  _recalcPaymentPreview();
}
```

- [ ] **Step 2: Criar funções auxiliares (switch, recalc, submit, defer)**

```js
// ─── Helpers expostos ao window (chamados pelos onclick do innerHTML) ───

window._switchPaymentMode = function(mode) {
  document.getElementById('paymentPreview').style.display = (mode === 'auto') ? 'block' : 'none';
  document.getElementById('paymentManualFields').style.display = (mode === 'manual') ? 'block' : 'none';
  document.getElementById('paymentNoneFields').style.display = (mode === 'none') ? 'block' : 'none';
  document.getElementById('paymentInternCheck').style.display =
    (mode === 'auto' && window._paymentReq && window._paymentReq.teacherType === 'estagiario') ? 'block' : 'none';

  // Atualiza labels de rádio
  document.querySelectorAll('.payment-radio').forEach(el => el.classList.remove('active'));
  document.querySelector(`.payment-radio input[value="${mode}"]`)?.closest('.payment-radio')?.classList.add('active');

  // Observação sempre visível, mas obrigatória muda
  const notesGroup = document.getElementById('paymentNotesGroup');
  const notesLabel = notesGroup?.querySelector('label');
  if (mode === 'none') {
    if (notesLabel) notesLabel.innerHTML = 'Observação *';
  } else {
    if (notesLabel) notesLabel.innerHTML = 'Observação';
  }

  window._recalcPaymentPreview();
};

window._recalcPaymentPreview = async function() {
  const req = window._paymentReq;
  if (!req) return;

  const mode = document.querySelector('input[name="paymentMode"]:checked')?.value || 'auto';
  const previewDiv = document.getElementById('paymentPreview');
  if (!previewDiv) return;

  if (mode !== 'auto') {
    // Modo manual/none: esconde preview ou mostra alerta se manual
    if (mode === 'manual') {
      const val = parseFloat(document.getElementById('manualValue')?.value || '0');
      showManualAlertInline(val);
    }
    previewDiv.style.display = 'none';
    return;
  }

  previewDiv.style.display = 'block';
  previewDiv.innerHTML = '<div class="preview-loader">Calculando...</div>';

  const payIntern = document.getElementById('payIntern')?.checked;
  const notes = document.getElementById('paymentNotes')?.value || '';

  const result = await VacationPaymentService.calculateForRequest(req, {
    mode: 'auto',
    payIntern: req.teacherType === 'estagiario' ? payIntern : undefined,
    notes,
  });

  if (!result.success) {
    previewDiv.innerHTML = `<div class="preview-error">${escapeHtml(result.error)}</div>`;
    return;
  }

  const d = result.data;
  const calc = d.calculation || {};
  let html = '';

  if (calc.formula === 'efetivo-clt-max') {
    html += `
      <div class="preview-line"><span>Base mensal</span><span class="mono">${fmt(calc.baseMonthly)}</span></div>
      <div class="preview-sub">↳ média 12m: ${fmt(calc.base12mAvg)} | último mês: ${fmt(calc.baseLastMonth)}</div>
      <div class="preview-sub">↳ usado: MAX = ${fmt(calc.baseMonthly)}</div>
      <div class="preview-line"><span>Proporcional ${calc.daysCount} dias</span><span class="mono">${fmt(calc.proportionalBase)}</span></div>
      <div class="preview-line"><span>⅓ constitucional</span><span class="mono">${fmt(calc.oneThirdValue)}</span></div>
    `;
  } else if (calc.formula === 'estagiario-bolsa-proporcional') {
    html += `
      <div class="preview-line"><span>Bolsa mensal</span><span class="mono">${fmt(calc.baseMonthly)}</span></div>
      <div class="preview-line"><span>Proporcional ${calc.daysCount} dias</span><span class="mono">${fmt(calc.proportionalBase)}</span></div>
    `;
  }

  html += `<div class="preview-total"><span>💵 Total</span><span class="mono">${fmt(d.value)}</span></div>`;
  html += `<div class="preview-info">${calc.monthsConsidered} meses considerados</div>`;
  previewDiv.innerHTML = html;
};

window._submitApproveWithPayment = async function(reqId) {
  const mode = document.querySelector('input[name="paymentMode"]:checked')?.value || 'auto';
  const note = document.getElementById('approveNote')?.value?.trim() || '';
  const notes = document.getElementById('paymentNotes')?.value?.trim() || '';

  // Validações
  if (mode === 'none' && !notes) {
    toast('Justificativa obrigatória para "Sem pagamento".', 'error'); return;
  }

  let paymentData;
  if (mode === 'auto') {
    const payIntern = document.getElementById('payIntern')?.checked;
    const result = await VacationPaymentService.calculateForRequest(window._paymentReq, {
      mode: 'auto',
      payIntern: window._paymentReq.teacherType === 'estagiario' ? payIntern : undefined,
      notes,
    });
    if (!result.success) { toast(result.error, 'error'); return; }
    paymentData = result.data;
  } else if (mode === 'manual') {
    const val = parseFloat(document.getElementById('manualValue')?.value || '0');
    if (isNaN(val) || val < 0) { toast('Valor manual inválido.', 'error'); return; }
    if (val === 0 && !notes) { toast('Observação obrigatória se valor é zero.', 'error'); return; }
    paymentData = { mode: 'manual', value: val, calculation: null, notes: notes || null };
  } else {
    paymentData = { mode: 'none', value: 0, calculation: null, notes };
  }

  // Aprova + define pagamento
  const approveRes = await VacationService.approve(reqId, note, paymentData);
  if (approveRes.success) {
    toast('Férias aprovadas com pagamento definido!', 'success');
    closeModal('feriasModal');
    await renderFeriasGestaoPage();
  } else {
    toast('Erro: ' + (approveRes.error || 'Falha'), 'error');
  }
};

window._deferPayment = async function(reqId) {
  if (!confirm('Adiar definição de pagamento? As férias serão aprovadas, mas o pagamento ficará pendente.')) return;

  const note = document.getElementById('approveNote')?.value?.trim() || '';
  const paymentData = { mode: 'deferred', value: 0, calculation: null, notes: 'Pagamento adiado pelo admin' };

  const res = await VacationService.approve(reqId, note, paymentData);
  if (res.success) {
    toast('Férias aprovadas (pagamento pendente).', 'success');
    closeModal('feriasModal');
    await renderFeriasGestaoPage();
  } else {
    toast('Erro: ' + (res.error || 'Falha'), 'error');
  }
};

// Helper inline (não poluir escopo global com função duplicada)
function showManualAlertInline(val) {
  const el = document.getElementById('manualAlert');
  if (!el) return;
  const est = window._paymentAutoEstimate;
  if (est && val > est * 1.5) {
    el.style.display = 'block';
    el.innerHTML = `⚠️ Valor ${Math.round(val/est*100)}% acima do automático (R$ ${est.toFixed(2)}). Confirme.`;
  } else {
    el.style.display = 'none';
  }
}
```

- [ ] **Step 3: Modificar `aprovarVacation` existente**

Substituir a função `aprovarVacation` atual:

```js
async function aprovarVacation(reqId) {
  await openApproveWithPaymentModal(reqId);
}
```

- [ ] **Step 4: Modificar `VacationService.approve` para aceitar paymentData**

Em `professores-shared.js`, localizar `VacationService.approve` (que delega para `_respond`). Modificar:

```js
// VacationService.approve — agora aceita paymentData opcional
async approve(reqId, note = '', paymentData = null) {
  return this._respond(reqId, 'aprovada', note, paymentData);
},
```

E em `_respond`, ao fazer o update do doc, incluir `payment` se `paymentData` for fornecido:

No objeto passado para `ref.update({...})` dentro de `_respond`, adicionar condicionalmente:

```js
const updateData = {
  status,
  respondedAt: firebase.firestore.FieldValue.serverTimestamp(),
  respondedBy: currentUserId(),
  respondedByName: currentUserName(),
  responseNote: note || null,
  updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
};

// Sprint 6b — se veio paymentData, inclui no mesmo update
if (paymentData) {
  updateData.payment = {
    mode: paymentData.mode,
    value: paymentData.value || 0,
    calculation: paymentData.calculation || null,
    notes: paymentData.notes || null,
    setBy: currentUserId(),
    setByName: currentUserName(),
    setAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: null,
    updatedByName: null,
    updatedAt: null,
  };

  // Notificação de pagamento (junto com a de aprovação)
  if (paymentData.mode !== 'deferred') {
    await NotificationService.create({
      recipientUserId: before.requestedBy,
      type: 'vacation_payment_set',
      title: 'Pagamento de férias definido',
      body: paymentData.value > 0
        ? `${before.type} de ${before.totalDays} dias — R$ ${paymentData.value.toFixed(2)} (${paymentData.mode})`
        : `${before.type} de ${before.totalDays} dias registrada sem pagamento`,
      link: { type: 'vacation', id: reqId },
    });
  }

  await AuditService.log({
    type: 'vacation_payment_set',
    details: `Definido pagamento de ${before.type} ${before.teacherName}: R$ ${(paymentData.value || 0).toFixed(2)} (${paymentData.mode})`,
    entityType: 'vacation_request', entityId: reqId,
    before: { payment: null },
    after: { payment: updateData.payment },
    module: 'ferias',
  });
}

await ref.update(updateData);
```

- [ ] **Step 5: Expor novas funções ao window**

No final de `professores-ferias.js`, adicionar aos exports:

```js
window.openApproveWithPaymentModal = openApproveWithPaymentModal;
```

- [ ] **Step 6: Commit**

```bash
git add professores-ferias.js professores-shared.js
git commit -m "feat(sprint-6b): modal único aprovação+pagamento com preview ao vivo e botão Adiar"
```

---

### Task 6: CSS do bloco de pagamento (Etapa 3)

**Files:**
- Modify: `professores.html`

- [ ] **Step 1: Adicionar CSS no `<style>` de professores.html**

Adicionar ao final do bloco `<style>` existente:

```css
/* ─── Sprint 6b — Bloco de Pagamento no Modal ─── */
.payment-block {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 16px;
  margin: 12px 0;
}
.payment-block h4 {
  margin: 0 0 12px 0;
  font-size: 15px;
  color: #1e293b;
}
.payment-mode-selector {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.payment-radio {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid #cbd5e1;
  border-radius: 20px;
  font-size: 13px;
  cursor: pointer;
  background: #fff;
  transition: all 0.15s;
}
.payment-radio.active {
  border-color: #3b82f6;
  background: #eff6ff;
  color: #1e40af;
}
.payment-radio input { accent-color: #3b82f6; }

.payment-preview {
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 12px;
  font-size: 13px;
}
.payment-preview .preview-line {
  display: flex;
  justify-content: space-between;
  color: #475569;
  margin-bottom: 4px;
}
.payment-preview .preview-sub {
  font-size: 11px;
  color: #94a3b8;
  margin-bottom: 4px;
  padding-left: 8px;
}
.payment-preview .preview-total {
  display: flex;
  justify-content: space-between;
  font-weight: 700;
  color: #0f172a;
  font-size: 15px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #cbd5e1;
}
.payment-preview .preview-info {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 4px;
}
.payment-preview .preview-error {
  color: #dc2626;
  font-size: 13px;
}
.payment-preview .preview-loader {
  color: #94a3b8;
  font-size: 13px;
}

.alert-warning {
  background: #fef3c7;
  border: 1px solid #fcd34d;
  color: #92400e;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  margin: 8px 0;
}
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}
.helper-text {
  display: block;
  font-size: 11px;
  color: #64748b;
  margin-top: 4px;
}

/* ─── Sprint 6b — Coluna Pagamento na tabela ─── */
.payment-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.payment-badge.pending { background: #fef3c7; color: #92400e; }
.payment-badge.none { background: #f1f5f9; color: #64748b; }
.payment-badge.defined { background: #dbeafe; color: #1e40af; }
.payment-badge.paid { background: #dcfce7; color: #166534; }
.payment-badge.partial { background: #e0e7ff; color: #3730a3; }

.payment-action {
  font-size: 12px;
  cursor: pointer;
  color: #3b82f6;
  white-space: nowrap;
}
.payment-action:hover { text-decoration: underline; }

/* ─── Sprint 6b — Sidebar counter ─── */
.sidebar-counter {
  display: inline-block;
  background: #f59e0b;
  color: #fff;
  border-radius: 10px;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 700;
  margin-left: 6px;
  vertical-align: middle;
}

/* ─── Sprint 6b — Seção Férias no recibo ─── */
.receipt-vacation {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 2px solid #e2e8f0;
}
.receipt-vacation h3 {
  font-size: 15px;
  margin-bottom: 8px;
  color: #1e293b;
}
.vacation-line {
  margin-bottom: 12px;
  font-size: 12px;
  color: #475569;
}
.vacation-line .calc-detail {
  font-size: 11px;
  color: #94a3b8;
  margin: 4px 0;
}
.vacation-line .value {
  font-weight: 700;
  font-size: 14px;
  color: #0f172a;
}

/* ─── Sprint 6b — Linha Férias no detalhe do fechamento ─── */
tr.row-vacation td {
  background: #fefce8;
  font-size: 12px;
}
tr.row-vacation-only td {
  background: #fffbeb;
  border-left: 3px solid #f59e0b;
}
```

- [ ] **Step 2: Commit**

```bash
git add professores.html
git commit -m "feat(sprint-6b): CSS bloco pagamento + coluna tabela + sidebar + recibo + fechamento"
```

---

### Task 7: Coluna "Pagamento" na tabela + Edição posterior (Etapa 4)

**Files:**
- Modify: `professores-ferias.js`

- [ ] **Step 1: Adicionar coluna "Pagamento" no `renderFeriasGestaoPage`**

Na tabela de gestão (função `renderFeriasGestaoPage`), adicionar `<th>Pagamento</th>` após `<th>Ações</th>` no thead.

Na linha de cada request, adicionar `<td>` com a lógica dos 6 estados:

```js
// Dentro do map que gera as linhas da tabela:
function renderPaymentCell(req) {
  if (!['aprovada'].includes(req.status)) return '<td class="mono" style="color:#94a3b8;">—</td>';

  const payment = req.payment;
  const paidIds = req.paidInClosingIds || [];

  // Estado 1: deferred ou ausente
  if (!payment || payment.mode === 'deferred') {
    return `<td>
      <span class="payment-badge pending">⏳ Pendente</span>
      <br><span class="payment-action" onclick="openEditPaymentModal('${req.id}')">💰 Definir</span>
    </td>`;
  }

  // Estado 2: sem pagamento
  if (payment.mode === 'none') {
    return `<td>
      <span class="payment-badge none">🚫 Sem pagamento</span>
      ${paidIds.length === 0 ? `<br><span class="payment-action" onclick="openEditPaymentModal('${req.id}')">✏️ Editar</span>` : ''}
    </td>`;
  }

  // Estado 3: auto/manual definido, não pago
  if (paidIds.length === 0) {
    const label = payment.mode === 'auto' ? 'Auto' : 'Manual';
    return `<td>
      <span class="payment-badge defined">${label} · ${fmt(payment.value)}</span>
      <br><span class="payment-action" onclick="openEditPaymentModal('${req.id}')">✏️ Editar</span>
    </td>`;
  }

  // Estado 4/5: pago (total ou parcial)
  const lastPeriodEnd = req.lastPeriodEnd ? req.lastPeriodEnd.toDate() : null;
  const paidMonths = paidIds.map(id => {
    const parts = id.split('_');
    const [unit, ym] = [parts[0], parts[1]]; // "unit-cp_2026-06"
    const [y, m] = (ym || '').split('-');
    return { id, year: parseInt(y), month: parseInt(m) };
  }).filter(p => !isNaN(p.month));

  const lastPaidMonth = paidMonths.reduce((max, p) => {
    const val = p.year * 12 + p.month;
    return val > max.val ? { val, month: p.month, year: p.year } : max;
  }, { val: 0, month: 0, year: 0 });

  const mesNome = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  if (lastPeriodEnd && lastPaidMonth.year) {
    const endMonth = lastPeriodEnd.getUTCMonth() + 1;
    const endYear = lastPeriodEnd.getUTCFullYear();
    const endVal = endYear * 12 + endMonth;
    const paidVal = lastPaidMonth.year * 12 + lastPaidMonth.month;

    if (paidVal < endVal) {
      // Parcial
      return `<td><span class="payment-badge partial">✓ Parcial · ${mesNome[lastPaidMonth.month]}/${String(lastPaidMonth.year).slice(2)} · resta ${mesNome[endMonth]}/${String(endYear).slice(2)}</span></td>`;
    }
  }

  // Totalmente pago
  return `<td><span class="payment-badge paid">✓ Pago em ${mesNome[lastPaidMonth.month]}/${String(lastPaidMonth.year).slice(2)}</span></td>`;
}
```

- [ ] **Step 2: Criar modal de edição de pagamento**

```js
async function openEditPaymentModal(reqId) {
  const db = firebase.firestore();
  const doc = await db.collection('vacation_requests').doc(reqId).get();
  if (!doc.exists) { toast('Pedido não encontrado', 'error'); return; }
  const req = { id: doc.id, ...doc.data() };

  if ((req.paidInClosingIds || []).length > 0) {
    toast('Pagamento já processado em fechamento — não pode ser editado.', 'error');
    return;
  }

  const modal = document.getElementById('feriasModal');
  const content = document.getElementById('feriasModalContent');
  if (!modal || !content) return;

  const existingPayment = req.payment || {};
  const currentMode = existingPayment.mode || 'auto';

  // Pré-carrega estimativa auto
  let autoEstimate = null;
  if (req.teacherType === 'efetivo') {
    const calc = await VacationPaymentService._calculateEfetivoAuto(req, '');
    if (calc.success) autoEstimate = calc.data.value;
  }

  window._paymentReq = req;
  window._paymentAutoEstimate = autoEstimate;

  content.innerHTML = `
    <h3>✏️ Editar Pagamento</h3>
    <div class="ferias-approve-info">
      <span>${escapeHtml(req.teacherName)}</span>
      <span>📅 ${formatPeriodos(req.periods)}</span>
      <span>📐 ${req.totalDays} dias</span>
    </div>

    <div class="payment-block">
      <div class="payment-mode-selector">
        <label class="payment-radio ${currentMode === 'auto' ? 'active' : ''}">
          <input type="radio" name="paymentMode" value="auto" ${currentMode === 'auto' ? 'checked' : ''}
            onchange="window._switchPaymentMode('auto')"> Automático
        </label>
        <label class="payment-radio ${currentMode === 'manual' ? 'active' : ''}">
          <input type="radio" name="paymentMode" value="manual" ${currentMode === 'manual' ? 'checked' : ''}
            onchange="window._switchPaymentMode('manual')"> Manual
        </label>
        <label class="payment-radio ${currentMode === 'none' ? 'active' : ''}">
          <input type="radio" name="paymentMode" value="none" ${currentMode === 'none' ? 'checked' : ''}
            onchange="window._switchPaymentMode('none')"> Sem pagamento
        </label>
      </div>

      <div id="paymentPreview" style="display:${currentMode === 'auto' ? 'block' : 'none'};"></div>

      <div id="paymentManualFields" style="display:${currentMode === 'manual' ? 'block' : 'none'};">
        <div class="form-group">
          <label>Valor (R$)</label>
          <input type="number" id="manualValue" min="0" step="0.01" value="${existingPayment.value || ''}"
            oninput="window._recalcPaymentPreview()">
        </div>
        <div id="manualAlert" class="alert-warning" style="display:none;"></div>
      </div>

      <div id="paymentNoneFields" style="display:${currentMode === 'none' ? 'block' : 'none'};">
        <p style="font-size:13px;color:#64748b;">Registrar como licença não remunerada.</p>
      </div>

      <div class="form-group" id="paymentNotesGroup">
        <label>Observação</label>
        <textarea id="paymentNotes" rows="2" placeholder="(opcional)">${escapeHtml(existingPayment.notes || '')}</textarea>
      </div>
    </div>

    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal('feriasModal')">Cancelar</button>
      <button class="btn btn-primary" onclick="window._submitEditPayment('${reqId}')">💾 Salvar pagamento</button>
    </div>
  `;

  if (currentMode === 'auto') _recalcPaymentPreview();
  modal.style.display = 'flex';
}

window._submitEditPayment = async function(reqId) {
  const mode = document.querySelector('input[name="paymentMode"]:checked')?.value || 'auto';
  const notes = document.getElementById('paymentNotes')?.value?.trim() || '';

  let paymentData;
  if (mode === 'auto') {
    const result = await VacationPaymentService.calculateForRequest(window._paymentReq, { mode: 'auto', notes });
    if (!result.success) { toast(result.error, 'error'); return; }
    paymentData = result.data;
  } else if (mode === 'manual') {
    const val = parseFloat(document.getElementById('manualValue')?.value || '0');
    if (isNaN(val) || val < 0) { toast('Valor inválido.', 'error'); return; }
    if (val === 0 && !notes) { toast('Observação obrigatória se valor é zero.', 'error'); return; }
    paymentData = { mode: 'manual', value: val, calculation: null, notes: notes || null };
  } else {
    if (!notes) { toast('Justificativa obrigatória.', 'error'); return; }
    paymentData = { mode: 'none', value: 0, calculation: null, notes };
  }

  const res = await VacationPaymentService.updatePayment(reqId, paymentData);
  if (res.success) {
    toast('Pagamento atualizado!', 'success');
    closeModal('feriasModal');
    await renderFeriasGestaoPage();
  } else {
    toast('Erro: ' + (res.error || 'Falha'), 'error');
  }
};
```

- [ ] **Step 3: Expor ao window**

```js
window.openEditPaymentModal = openEditPaymentModal;
```

- [ ] **Step 4: Commit**

```bash
git add professores-ferias.js
git commit -m "feat(sprint-6b): coluna Pagamento 6 estados + modal edição posterior"
```

---

### Task 8: Contador sidebar 🏖️ Férias (N) (Etapa 4)

**Files:**
- Modify: `professores.js`

- [ ] **Step 1: Adicionar listener e contador**

Encontrar a função que renderiza a sidebar (provavelmente `renderSidebar` ou `buildSidebar`). Adicionar listener Firestore que conta férias com pagamento pendente.

```js
// ─── Sprint 6b — Contador de férias pendentes ───
function setupVacationCounter() {
  const currentUser = getCurrentUser();
  if (!currentUser) return;
  const profile = currentUser.profile || '';
  if (profile !== 'admin' && profile !== 'admin_gestao') return;

  const db = firebase.firestore();
  db.collection('vacation_requests')
    .where('status', '==', 'aprovada')
    .onSnapshot(snap => {
      let count = 0;
      snap.docs.forEach(d => {
        const payment = d.data().payment;
        if (!payment || payment.mode === 'deferred') count++;
      });

      const badge = document.getElementById('vacationPendingBadge');
      if (!badge) {
        // Cria o badge se não existe — insere após o item "🏖️ Férias" na sidebar
        const feriasLink = document.querySelector('.nav-item[data-page="ferias"]');
        if (feriasLink && count > 0) {
          const span = document.createElement('span');
          span.id = 'vacationPendingBadge';
          span.className = 'sidebar-counter';
          span.textContent = count;
          feriasLink.appendChild(span);
        }
      } else {
        if (count > 0) {
          badge.textContent = count;
          badge.style.display = 'inline-block';
        } else {
          badge.style.display = 'none';
        }
      }
    }, err => {
      console.warn('[vacationCounter]', err);
    });
}

// Chamar no init da página
document.addEventListener('DOMContentLoaded', () => {
  // ... init existente ...
  setupVacationCounter();
});
```

- [ ] **Step 2: Commit**

```bash
git add professores.js
git commit -m "feat(sprint-6b): contador sidebar 🏖️ Férias (N) para pagamentos pendentes"
```

---

### Task 9: closeMonth — merge teacherIds + férias do mês (Etapa 5)

**Files:**
- Modify: `functions/index.js`

- [ ] **Step 1: Adicionar helper `splitVacationAcrossMonth` server-side**

Adicionar após `calculateTeacherValueCF`:

```js
// Sprint 6b — recorta período de férias ao mês corrente
function splitVacationAcrossMonth(vacReq, year, month) {
  const monthStart = brMidnightUTC(year, month - 1, 1);
  const monthEnd = brMidnightUTC(year, month, 0);
  monthEnd.setUTCHours(23 + BR_OFFSET_HOURS, 59, 59, 999);

  let daysInMonth = 0;
  const periodsClipped = [];

  for (const p of (vacReq.periods || [])) {
    const ps = p.startDate.toDate();
    const pe = p.endDate.toDate();

    const clipStart = ps < monthStart ? monthStart : ps;
    const clipEnd = pe > monthEnd ? monthEnd : pe;

    if (clipStart > clipEnd) continue;

    const days = Math.round((clipEnd - clipStart) / 86400000) + 1;
    daysInMonth += days;
    periodsClipped.push({ start: clipStart, end: clipEnd, days });
  }

  if (daysInMonth === 0) return null;

  const totalDays = vacReq.totalDays || 0;
  const proportionalValue = totalDays > 0
    ? Math.round((vacReq.payment.value * daysInMonth / totalDays) * 100) / 100
    : 0;

  return {
    vacationRequestId: vacReq.id,
    periodStart: admin.firestore.Timestamp.fromDate(periodsClipped[0].start),
    periodEnd: admin.firestore.Timestamp.fromDate(periodsClipped[periodsClipped.length - 1].end),
    daysInMonth,
    fullPeriodDays: totalDays,
    paymentMode: vacReq.payment.mode,
    proportionalValue,
  };
}
```

- [ ] **Step 2: Inserir bloco de férias no closeMonth**

No `closeMonth`, após a seção §7 (agrupar classes por teacher e montar `teacherIds` array) e ANTES de §8 (calcular `teacherResults`), inserir:

```js
// ═══════════════════════════════════════════════════
// Sprint 6b — busca férias aprovadas do mês
// ═══════════════════════════════════════════════════
const vacSnap = await firestore.collection('vacation_requests')
  .where('status', '==', 'aprovada')
  .where('firstPeriodStart', '<=', monthEnd)
  .get();

const vacsInMonth = vacSnap.docs
  .map(d => ({ id: d.id, ...d.data() }))
  .filter(v =>
       v.lastPeriodEnd && v.lastPeriodEnd.toDate() >= monthStart
    && v.unitId === unitId
    && v.payment
    && v.payment.value > 0
    && v.payment.mode !== 'deferred'
  );

// CRÍTICO (D17): garante que professor 100% em férias entre no fechamento
const vacationOnlyTeacherIds = [...new Set(
  vacsInMonth.map(v => v.teacherId).filter(tid => !teacherIds.includes(tid))
)];
const allTeacherIds = [...new Set([...teacherIds, ...vacationOnlyTeacherIds])];

// Buscar teachers e salaries pros vacation-only
for (const tid of vacationOnlyTeacherIds) {
  if (!teacherMap[tid]) {
    const tDoc = await firestore.collection('teachers').doc(tid).get();
    if (tDoc.exists) teacherMap[tid] = { id: tDoc.id, ...tDoc.data() };
  }
  if (!salaryMap[tid]) {
    try {
      const sDoc = await firestore.collection('teacher_salaries').doc(tid).get();
      if (sDoc.exists) salaryMap[tid] = { id: sDoc.id, ...sDoc.data() };
    } catch (_) {}
  }
}

// Usar allTeacherIds daqui pra frente (substituir teacherIds nas seções seguintes)
// teacherIds = allTeacherIds;  // override silencioso
```

- [ ] **Step 3: Adicionar entries vacation-only no teacherResults**

No loop que monta `teacherResults`, ANTES de processar os grupos de aulas, adicionar:

```js
// Sprint 6b — entries vacation-only (professores sem aulas no mês)
for (const tid of vacationOnlyTeacherIds) {
  const teacher = teacherMap[tid] || { id: tid, name: '(desconhecido)', type: 'efetivo' };
  teacherResults.push({
    teacherId: tid,
    teacherName: teacher.name || '(desconhecido)',
    teacherType: teacher.type || 'efetivo',
    classesCount: 0,
    totalHoras: 0,
    hourlyRate: 0,
    effectiveDateUsed: null,
    valorHoras: 0, mealAllowance: 0, transportAllowance: 0, otherBenefits: 0,
    totalOutros: 0,
    valorTotal: 0,
    isInternProportional: false,
    internStipendUsed: null,
    internExcessHours: 0,
    internExcessValue: 0,
    isVacationOnly: true,
    vacationDaysInMonth: 0,
    vacationValue: 0,
    vacationDetails: [],
  });
}
```

- [ ] **Step 4: Aplicar splits de férias aos teacherResults**

Após o loop de cálculo de `teacherResults` (depois de todos os teachers terem sido processados):

```js
// Sprint 6b — aplicar férias do mês aos teacherResults
for (const v of vacsInMonth) {
  const split = splitVacationAcrossMonth(v, year, month);
  if (!split) continue;

  const tResult = teacherResults.find(t => t.teacherId === v.teacherId);
  if (!tResult) {
    logger.warn('[closeMonth] vacation sem teacher correspondente', { vacationId: v.id });
    continue;
  }

  tResult.vacationDaysInMonth = (tResult.vacationDaysInMonth || 0) + split.daysInMonth;
  tResult.vacationValue = Math.round(((tResult.vacationValue || 0) + split.proportionalValue) * 100) / 100;
  tResult.vacationDetails = tResult.vacationDetails || [];
  tResult.vacationDetails.push(split);
}
```

- [ ] **Step 5: Atualizar totals e paidInClosingIds**

No objeto `totals` (antes de `closingData`), adicionar:

```js
totals.totalVacationDays = teacherResults.reduce((s, t) => s + (t.vacationDaysInMonth || 0), 0);
totals.totalVacationValue = Math.round(teacherResults.reduce((s, t) => s + (t.vacationValue || 0), 0) * 100) / 100;
totals.totalGeral = Math.round((totals.totalValor + totals.totalVacationValue) * 100) / 100;
```

Após `txn.set(closingRef, closingData)`, adicionar batch update de `paidInClosingIds`:

```js
// Sprint 6b — atualiza paidInClosingIds nos vacation_requests processados
if (vacsInMonth.length > 0) {
  const vacBatch = firestore.batch();
  for (const v of vacsInMonth) {
    vacBatch.update(firestore.collection('vacation_requests').doc(v.id), {
      paidInClosingIds: admin.firestore.FieldValue.arrayUnion(closingId),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await vacBatch.commit();
  logger.info('[closeMonth] paidInClosingIds atualizados', { count: vacsInMonth.length });
}
```

- [ ] **Step 6: Commit**

```bash
git add functions/index.js
git commit -m "feat(sprint-6b): closeMonth — merge vacationOnlyTeacherIds + split férias + paidInClosingIds"
```

---

### Task 10: Detalhe do professor no fechamento — linha "Férias" (Etapa 5)

**Files:**
- Modify: `professores-fechamento.js`

- [ ] **Step 1: Adicionar linha de férias na tabela de detalhe**

Em `renderTeacherTable()` (ou equivalente), após a linha que renderiza `valorTotal` de cada teacher, adicionar condicionalmente:

```js
// Sprint 6b — linha extra se teacher tem férias no mês
const hasVacation = t.vacationValue > 0;
const vacRow = hasVacation ? `
<tr class="${t.isVacationOnly ? 'row-vacation-only' : 'row-vacation'}">
  <td colspan="${readOnly ? 8 : 9}" style="text-align:right;font-size:12px;">
    🏖️ Férias: ${(t.vacationDetails || []).map(vd =>
      `${vd.daysInMonth} dia(s) · ${vd.paymentMode} · total ${fmt(vd.proportionalValue)}`
    ).join(' | ')}
    ${t.isVacationOnly ? '<br><em>Período sem aulas — pagamento exclusivo de férias</em>' : ''}
  </td>
</tr>
` : '';
// Inserir vacRow após a <tr> do teacher
```

Ajustar o `tfoot` de totais para incluir a linha de férias:

```js
// No tfoot, após a linha de valorTotal:
${(totals.totalVacationValue || 0) > 0 ? `
<tr>
  <td colspan="${7}" style="text-align:right;font-weight:600;">🏖️ Total Férias</td>
  <td class="mono" style="text-align:right;font-weight:700;">${fmt(totals.totalVacationValue)}</td>
</tr>
<tr>
  <td colspan="${7}" style="text-align:right;font-weight:700;font-size:14px;">💵 TOTAL GERAL (horas + férias)</td>
  <td class="mono" style="text-align:right;font-weight:700;font-size:14px;">${fmt(totals.totalGeral)}</td>
</tr>
` : ''}
```

- [ ] **Step 2: Commit**

```bash
git add professores-fechamento.js
git commit -m "feat(sprint-6b): linha Férias no detalhe do professor + totais no fechamento"
```

---

### Task 11: Recibo A4 — seção "Férias" condicional (Etapa 5)

**Files:**
- Modify: `receipt.html`

- [ ] **Step 1: Adicionar seção de férias no template de recibo**

No `receipt.html`, localizar o bloco após `</tbody>` (após créditos) e ANTES do `<div class="total">`. Adicionar:

```html
<!-- Sprint 6b — Seção Férias (condicional) -->
{{#if hasVacation}}
<section class="receipt-section receipt-vacation">
  <h3>🏖️ Férias</h3>
  {{#each vacationDetails}}
  <div class="vacation-line">
    <div>Período: {{periodStart}} a {{periodEnd}} ({{daysInMonth}} dias)</div>
    {{#if isAuto}}
    <div class="calc-detail">
      Base mensal: R$ {{baseMonthly}}<br>
      Proporcional: R$ {{proportionalBase}} ({{daysInMonth}}/30)<br>
      1/3 constitucional: R$ {{oneThirdValue}}
    </div>
    {{/if}}
    <div class="value">R$ {{proportionalValue}}</div>
  </div>
  {{/each}}
  {{#if isVacationOnly}}
  <p style="font-size:11px;color:#94a3b8;margin-top:8px;">
    Período sem aulas — pagamento exclusivo de férias
  </p>
  {{/if}}
</section>
{{/if}}
```

- [ ] **Step 2: Atualizar `renderReceipt` para incluir dados de férias**

Em `professores-shared.js` (ou onde `ReceiptService` prepara os dados), adicionar ao objeto passado para o template:

```js
// Sprint 6b — dados de férias pro recibo
const teacherData = closing.teachers.find(t => t.teacherId === teacherId);
const vacDetails = (teacherData && teacherData.vacationDetails) || [];
const hasVacation = vacDetails.length > 0;

const receiptData = {
  // ... campos existentes ...
  hasVacation,
  vacationDetails: vacDetails.map(vd => ({
    periodStart: formatDate(vd.periodStart),
    periodEnd: formatDate(vd.periodEnd),
    daysInMonth: vd.daysInMonth,
    isAuto: vd.paymentMode === 'auto',
    baseMonthly: fmt(vd.baseMonthly || 0),
    proportionalBase: fmt(vd.proportionalBase || vd.proportionalValue || 0),
    oneThirdValue: fmt(vd.oneThirdValue || 0),
    proportionalValue: fmt(vd.proportionalValue),
  })),
  isVacationOnly: teacherData && teacherData.isVacationOnly,
  // ... resto ...
};
```

- [ ] **Step 3: Commit**

```bash
git add receipt.html professores-shared.js
git commit -m "feat(sprint-6b): seção Férias condicional no recibo A4"
```

---

### Task 12: Comandos admin.js + smoke-6b (Etapa 6)

**Files:**
- Modify: `scripts/admin.js`

- [ ] **Step 1: Adicionar comandos novos**

```js
// ─── Sprint 6b — comandos de pagamento de férias ───

async function cmdVacationPreview(reqId, mode) {
  const doc = await db.collection('vacation_requests').doc(reqId).get();
  if (!doc.exists) { console.log('Pedido não encontrado'); return; }
  const req = { id: doc.id, ...doc.data() };

  mode = mode || 'auto';
  const opts = { mode };

  // Detecta --no-pay-intern
  if (process.argv.includes('--no-pay-intern')) {
    opts.payIntern = false;
  }

  // Simula cálculo client-side (acesso direto ao Firestore via Admin SDK)
  console.log(`\nCalculando preview para ${req.teacherName} (${req.teacherType}) — modo ${mode}...\n`);

  if (mode === 'auto') {
    if (req.teacherType === 'efetivo') {
      const snap = await db.collection('monthly_closings')
        .where('unitId', '==', req.unitId)
        .where('status', '==', 'fechado')
        .orderBy('year', 'desc').orderBy('month', 'desc')
        .limit(12).get();

      const monthsData = [];
      snap.docs.forEach(d => {
        const data = d.data();
        const t = (data.teachers || []).find(x => x.teacherId === req.teacherId);
        if (t && typeof t.valorHoras === 'number' && t.valorHoras > 0) {
          monthsData.push({ valorHoras: t.valorHoras, year: data.year, month: data.month });
        }
      });

      if (monthsData.length < 3) {
        console.log(`ERRO: Histórico insuficiente (${monthsData.length} meses). Use modo manual.`);
        return;
      }

      const base12mAvg = monthsData.reduce((a, b) => a + b.valorHoras, 0) / monthsData.length;
      const baseLastMonth = monthsData[0].valorHoras;
      const baseMonthly = Math.max(base12mAvg, baseLastMonth);
      const daysCount = (req.periods || []).reduce((s, p) => s + (p.days || 0), 0);
      const proportionalBase = baseMonthly * daysCount / 30;
      const oneThirdValue = proportionalBase / 3;
      const value = Math.round((proportionalBase + oneThirdValue) * 100) / 100;

      console.log(`  Base 12m média:  R$ ${base12mAvg.toFixed(2)}`);
      console.log(`  Base último mês: R$ ${baseLastMonth.toFixed(2)}`);
      console.log(`  Base usada (MAX): R$ ${baseMonthly.toFixed(2)}`);
      console.log(`  Proporcional:    R$ ${proportionalBase.toFixed(2)} (${daysCount}/30 dias)`);
      console.log(`  1/3 CLT:         R$ ${oneThirdValue.toFixed(2)}`);
      console.log(`  TOTAL:           R$ ${value.toFixed(2)}`);
    } else if (req.teacherType === 'estagiario') {
      const salaryDoc = await db.collection('teacher_salaries').doc(req.teacherId).get();
      if (!salaryDoc.exists) { console.log('ERRO: teacher_salaries não encontrado'); return; }
      const stipend = salaryDoc.data().internMonthlyStipend || 0;
      const daysCount = (req.periods || []).reduce((s, p) => s + (p.days || 0), 0);
      const value = Math.round((stipend * daysCount / 30) * 100) / 100;
      console.log(`  Bolsa mensal:    R$ ${stipend.toFixed(2)}`);
      console.log(`  Proporcional:    R$ ${value.toFixed(2)} (${daysCount}/30 dias)`);
      console.log(`  TOTAL:           R$ ${value.toFixed(2)}`);
    }
  } else {
    console.log('  (Use set-vacation-payment para aplicar)');
  }
}

async function cmdSetVacationPayment(reqId, mode, ...rest) {
  const doc = await db.collection('vacation_requests').doc(reqId).get();
  if (!doc.exists) { console.log('Pedido não encontrado'); return; }
  const before = doc.data();

  if (before.status !== 'aprovada') {
    console.log('ERRO: pedido não está aprovado');
    return;
  }

  let paymentData;

  if (mode === 'deferred') {
    paymentData = { mode: 'deferred', value: 0, calculation: null, notes: 'Pagamento adiado pelo admin' };
  } else if (mode === 'none') {
    const notes = rest.join(' ');
    if (!notes) { console.log('ERRO: justificativa obrigatória'); return; }
    paymentData = { mode: 'none', value: 0, calculation: null, notes };
  } else if (mode === 'manual') {
    const value = parseFloat(rest[0]);
    const notes = rest.slice(1).join(' ') || null;
    if (isNaN(value) || value < 0) { console.log('ERRO: valor inválido'); return; }
    if (value === 0 && !notes) { console.log('ERRO: observação obrigatória se valor zero'); return; }
    paymentData = { mode: 'manual', value, calculation: null, notes };
  } else if (mode === 'auto') {
    // Usa a mesma lógica da CF (simplificada server-side)
    // Aqui vamos delegar ao cálculo client-side printando e depois aplicando
    console.log('Use vacation-preview primeiro para ver o cálculo, depois set-vacation-payment manual com o valor.');
    return;
  } else {
    console.log('Modo inválido. Use: auto | manual | none | deferred');
    return;
  }

  await db.collection('vacation_requests').doc(reqId).update({
    payment: {
      ...paymentData,
      setBy: 'admin-sdk',
      setByName: 'Admin SDK',
      setAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: null,
      updatedByName: null,
      updatedAt: null,
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`✓ Pagamento definido: ${paymentData.mode} · R$ ${paymentData.value.toFixed(2)}`);
}

async function cmdSmoke6b() {
  console.log('\n══════ SMOKE TEST Sprint 6b — Pagamento de Férias ══════\n');

  const all = await db.collection('vacation_requests').get();
  const withPayment = all.docs.filter(d => d.data().payment).length;
  const paid = all.docs.filter(d => (d.data().paidInClosingIds || []).length > 0).length;
  const withDenorm = all.docs.filter(d => d.data().firstPeriodStart).length;

  console.log(`Total vacation_requests: ${all.size}`);
  console.log(`  Com payment definido: ${withPayment}`);
  console.log(`  Já pagos (paidInClosingIds > 0): ${paid}`);
  console.log(`  Com denormalização (firstPeriodStart): ${withDenorm}`);

  const byMode = { auto: 0, manual: 0, none: 0, deferred: 0 };
  all.docs.forEach(d => {
    const m = d.data().payment?.mode;
    if (m && byMode[m] !== undefined) byMode[m]++;
  });
  const pendingCount = byMode.deferred + (all.size - withPayment);
  console.log(`\nPor modo: auto=${byMode.auto} manual=${byMode.manual} none=${byMode.none} deferred=${byMode.deferred}`);
  console.log(`Pagamentos pendentes: ${pendingCount}`);

  // Verifica fechamentos com isVacationOnly
  const closingsSnap = await db.collection('monthly_closings')
    .where('status', '==', 'fechado').get();
  let vacOnlyCount = 0, closingsWithVacation = 0;
  closingsSnap.docs.forEach(c => {
    const d = c.data();
    const vacTeachers = (d.teachers || []).filter(t => t.isVacationOnly || t.vacationValue > 0);
    if (vacTeachers.length > 0) closingsWithVacation++;
    vacOnlyCount += vacTeachers.filter(t => t.isVacationOnly).length;
  });
  console.log(`\nFechamentos com férias: ${closingsWithVacation}`);
  console.log(`Teachers isVacationOnly: ${vacOnlyCount}`);

  // Audit
  const auditPayments = await db.collection('audit_log')
    .where('module', '==', 'ferias')
    .where('type', 'in', ['vacation_payment_set', 'vacation_payment_updated'])
    .orderBy('timestamp', 'desc').limit(10).get();
  console.log(`\nAudit pagamentos (últimos 10): ${auditPayments.size} entries`);
  auditPayments.docs.forEach(d => {
    const a = d.data();
    const ts = a.timestamp ? a.timestamp.toDate().toISOString().slice(0, 19) : '?';
    console.log(`  [${ts}] ${a.type}: ${(a.details || '').slice(0, 120)}`);
  });

  console.log('\n══════ FIM SMOKE TEST Sprint 6b ══════\n');
  console.log('Para validação completa C1-C16: node scripts/fixture-6b.js --project staging');
}
```

- [ ] **Step 2: Registrar comandos no switch**

No `switch (cmd)` principal:

```js
case 'vacation-preview':      await cmdVacationPreview(cmdArgs[0], cmdArgs[1]); break;
case 'set-vacation-payment':  await cmdSetVacationPayment(cmdArgs[0], cmdArgs[1], ...cmdArgs.slice(2)); break;
case 'smoke-6b':              await cmdSmoke6b(); break;
```

- [ ] **Step 3: Commit**

```bash
git add scripts/admin.js
git commit -m "feat(sprint-6b): comandos vacation-preview + set-vacation-payment + smoke-6b"
```

---

### Task 13: Deploy em staging + smoke test (Etapa 7)

- [ ] **Step 1: Rodar backfill (obrigatório antes do deploy)**

```bash
node scripts/backfill-vacation-denorm.js --project staging
```

Expected: lista de requests com firstPeriodStart/lastPeriodEnd populados.

- [ ] **Step 2: Deploy Security Rules + Índices**

```bash
firebase deploy --only firestore:rules --project staging
firebase deploy --only firestore:indexes --project staging
```

- [ ] **Step 3: Deploy Cloud Function closeMonth**

```bash
firebase deploy --only functions:closeMonth --project staging
```

- [ ] **Step 4: Deploy frontend (Hosting)**

```bash
firebase deploy --only hosting --project staging
```

- [ ] **Step 5: Rodar smoke-6b**

```bash
node scripts/admin.js --project staging smoke-6b
```

Expected: total de requests, contagem por modo, fechamentos com férias, audit entries.

- [ ] **Step 6: Validar via fixture (criar e rodar fixture-6b.js)**

Criar `scripts/fixture-6b.js` espelhando o padrão do `fixture-6a.js`. Passos:
1. Criar vacation_request via Admin SDK com status='aprovada' e payment preenchido
2. Rodar closeMonth no mês correspondente
3. Verificar: teacher entry no fechamento com vacationValue > 0
4. Verificar: paidInClosingIds atualizado
5. Limpar dados de teste

```bash
node scripts/fixture-6b.js --project staging
```

- [ ] **Step 7: Commit final**

```bash
git add scripts/fixture-6b.js
git commit -m "feat(sprint-6b): fixture-6b — validação end-to-end de pagamento de férias"
```

---

## Self-Review Checklist

- [ ] Spec coverage: cada um dos 16 critérios de aceite coberto por pelo menos uma task
- [ ] Placeholder scan: zero TBD/TODO no plano
- [ ] Type consistency: `payment.mode` usa `'deferred'` (não `'deferido'`) em todos os lugares
- [ ] Segurança: supervisor barrado em Security Rules (D14) + client-side (if profile check no modal)
- [ ] D17 crítico: `closeMonth` mescla teacherIds com vacationOnlyTeacherIds
- [ ] D3 legal: checkbox default condicional ao stipend respeita Lei do Estágio

---

*Plano escrito em 03/06/2026 — baseado no playbook sprint-6b-pagamento-ferias.md v2*
