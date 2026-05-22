# Sprint 4b — Pagamentos + Recibos · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar emissão de recibos, confirmação de pagamentos e sistema de crédito automático para fechar o ciclo financeiro do módulo Professores.

**Architecture:** 3 novos services client-side (ReceiptService, PaymentService, CreditService) + página standalone receipt.html + nova tela de pagamentos (admin) + painel "Meus Pagamentos" (professor). Numeração sequencial via transação Firestore. Sem Cloud Functions novas.

**Tech Stack:** HTML/CSS/JS vanilla + Firebase (Firestore + Auth) — mesmo stack do projeto.

---

## File Map

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `firestore.rules` | MOD | +creditos_professores +meta/receipt_counter |
| `firestore.indexes.json` | MOD | +3 índices compostos |
| `professores-shared.js` | MOD | +ReceiptService +PaymentService +CreditService +NOTIF_TYPE_META |
| `professores.js` | MOD | +sidebar items + routing + handlers |
| `professores.html` | MOD | +page-pagamentos +page-meus-pagamentos divs + script tag |
| `professores-pagamentos.js` | NOVO | Toda UI de pagamentos (admin + professor) |
| `receipt.html` | NOVO | Página standalone de impressão A4 |
| `scripts/admin.js` | MOD | +comandos smoke-4b |

---

### Task 1: Security Rules + Índices

**Files:**
- Modify: `firestore.rules:141-156` (receipts já existe, ajustar write), após linha 156 adicionar creditos + counter
- Modify: `firestore.indexes.json`

- [ ] **Step 1: Atualizar regra de receipts (já existe, ajustar write para isStrictAdmin)**

A regra atual permite `isAdmin()` (inclui admin_gestao). Ajustar para `isStrictAdmin()` conforme D4.

```js
// firestore.rules — substituir regra existente de receipts
match /receipts/{id} {
  allow read:  if isAuth() && (
                 isAdmin() ||
                 resource.data.teacherId == uData().professorId
               );
  allow write: if isAuth() && isStrictAdmin();
  allow delete: if false;
}
```

- [ ] **Step 2: Adicionar regras creditos_professores e meta/receipt_counter**

Após o bloco `monthly_closings`, adicionar:

```js
match /creditos_professores/{id} {
  allow read:  if isAuth() && (
                 isAdmin() ||
                 resource.data.teacherId == uData().professorId
               );
  allow write: if isAuth() && isStrictAdmin();
  allow delete: if false;
}

match /meta/receipt_counter {
  allow read:  if isAuth() && isAdmin();
  allow write: if isAuth() && isStrictAdmin();
}
```

- [ ] **Step 3: Adicionar 3 índices compostos em firestore.indexes.json**

Adicionar ao array `indexes`:

```json
{
  "collectionGroup": "receipts",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "closingId", "order": "ASCENDING" },
    { "fieldPath": "number",    "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "receipts",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "teacherId", "order": "ASCENDING" },
    { "fieldPath": "emittedAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "creditos_professores",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "teacherId", "order": "ASCENDING" },
    { "fieldPath": "status",    "order": "ASCENDING" }
  ]
}
```

- [ ] **Step 4: Deploy rules + indexes**

```bash
npx firebase deploy --only firestore:rules,firestore:indexes --project staging
```

- [ ] **Step 5: Commit**

```bash
git add firestore.rules firestore.indexes.json
git commit -m "feat: security rules + indexes para Sprint 4b (receipts, creditos, counter)"
```

---

### Task 2: ReceiptService + PaymentService + CreditService

**Files:**
- Modify: `professores-shared.js` — adicionar ~300 linhas após `ClosingService` (antes do bloco `window.ClosingService`)

- [ ] **Step 1: Adicionar NOTIF_TYPE_META novos tipos**

No objeto `NOTIF_TYPE_META` (linha ~1239), adicionar:

```js
recibo_emitido:       { icon: '📄', title: 'Recibo emitido' },
pagamento_confirmado: { icon: '💰', title: 'Pagamento confirmado' },
```

- [ ] **Step 2: Adicionar ReceiptService**

Inserir antes do bloco `window.ClosingService = ClosingService`:

```js
// ─── ReceiptService ─────────────────────────────────────────────────────

const ReceiptService = {
  /**
   * Emite um recibo individual com numeração atômica.
   * Transação: lê counter + cria recibo + abate créditos + atualiza counter.
   */
  async emit({ closingId, teacherId }) {
    if (!closingId || !teacherId) return { success: false, error: 'closingId e teacherId obrigatórios' };
    try {
      const counterRef = db.collection('meta').doc('receipt_counter');

      const result = await db.runTransaction(async (txn) => {
        // 1. Lê closing
        const closingDoc = await txn.get(db.collection('monthly_closings').doc(closingId));
        if (!closingDoc.exists) throw new Error('Fechamento não encontrado');
        const closing = closingDoc.data();
        const teacherEntry = (closing.teachers || []).find(t => t.teacherId === teacherId);
        if (!teacherEntry) throw new Error('Professor não está neste fechamento');

        // 2. Lê + incrementa contador
        const counterDoc = await txn.get(counterRef);
        const nextNumber = (counterDoc.exists ? counterDoc.data().value : 0) + 1;

        // 3. Busca créditos pendentes do professor (fora da transação — melhor assim
        //    pra evitar que a transação leia muitos docs. Se houver race, o crédito
        //    fica pendente pro próximo recibo — seguro.)
        const credSnap = await db.collection('creditos_professores')
          .where('teacherId', '==', teacherId)
          .where('status', '==', 'pendente')
          .get();
        const creditos = credSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Ordena FIFO por registeredAt
        creditos.sort((a, b) => {
          const ta = a.registeredAt && a.registeredAt.toMillis ? a.registeredAt.toMillis() : 0;
          const tb = b.registeredAt && b.registeredAt.toMillis ? b.registeredAt.toMillis() : 0;
          return ta - tb;
        });
        const totalCredito = creditos.reduce((s, c) => s + (c.valor || 0), 0);

        const valorLiquido = (teacherEntry.valorTotal || 0) - totalCredito;

        // 4. Cria o receipt
        const receiptRef = db.collection('receipts').doc();
        const receiptData = {
          number: nextNumber,
          numberFormatted: String(nextNumber).padStart(4, '0'),
          closingId,
          unitId: closing.unitId || '',
          unitName: closing.unitName || '',
          year: closing.year,
          month: closing.month,
          teacherId,
          teacherName: teacherEntry.teacherName || '',
          teacherCpf: teacherEntry.teacherCpf || '',
          teacherType: teacherEntry.teacherType || '',
          closingValorTotal: teacherEntry.valorTotal || 0,
          closingValorHoras: teacherEntry.valorHoras || 0,
          closingHoras: teacherEntry.totalHoras || 0,
          creditosAplicados: creditos.map(c => ({
            creditoId: c.id, valor: c.valor,
            reciboOrigemNum: c.reciboOrigemNum, periodoOrigem: c.periodoOrigem
          })),
          totalCreditoAplicado: totalCredito,
          valorLiquido,
          status: 'aguardando_pagamento',
          emittedAt: serverTs(), emittedBy: currentUserId(), emittedByName: currentUserName(),
          paidAt: null, paidBy: null, paymentRecordId: null,
          createdAt: serverTs(), updatedAt: serverTs(),
        };
        txn.set(receiptRef, receiptData);

        // 5. Marca créditos como aplicados
        creditos.forEach(c => {
          txn.update(db.collection('creditos_professores').doc(c.id), {
            status: 'aplicado',
            appliedAt: serverTs(),
            appliedToReciboId: receiptRef.id,
            updatedAt: serverTs(),
          });
        });

        // 6. Atualiza contador
        txn.set(counterRef, { value: nextNumber, updatedAt: serverTs() }, { merge: true });

        return { id: receiptRef.id, ...receiptData };
      });

      // Audit log (fora da transação)
      await AuditService.log({
        type: 'receipt_emitted',
        details: `Recibo ${result.numberFormatted} emitido (${result.teacherName} · ${result.year}-${String(result.month).padStart(2,'0')})`,
        entityType: 'receipt', entityId: result.id,
        before: null, after: result,
        module: 'pagamentos',
      });

      // Notificação pro professor
      const userSnap = await db.collection('users').where('professorId', '==', teacherId).limit(1).get();
      if (!userSnap.empty) {
        await NotificationService.create({
          recipientUserId: userSnap.docs[0].id,
          type: 'recibo_emitido',
          title: 'Recibo emitido',
          body: `Recibo ${result.numberFormatted} emitido · R$ ${result.valorLiquido.toFixed(2)}`,
          link: { type: 'receipt', id: result.id },
        });
      }

      return { success: true, data: result };
    } catch (err) {
      console.error('[ReceiptService.emit]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  /** Emissão em lote — loop sequencial pra garantir ordem de numeração. */
  async emitBatch({ closingId, teacherIds }) {
    const results = []; const errors = [];
    for (const teacherId of teacherIds) {
      const r = await this.emit({ closingId, teacherId });
      if (r.success) results.push(r.data);
      else errors.push({ teacherId, error: r.error });
    }
    return { success: errors.length === 0, data: { results, errors } };
  },

  /** Cancela recibo (só se aguardando_pagamento). Reverte créditos aplicados. */
  async cancel(receiptId) {
    if (!receiptId) return { success: false, error: 'receiptId obrigatório' };
    try {
      const ref = db.collection('receipts').doc(receiptId);
      const doc = await ref.get();
      if (!doc.exists) return { success: false, error: 'Recibo não encontrado' };
      const receipt = doc.data();
      if (receipt.status !== 'aguardando_pagamento') {
        return { success: false, error: 'Só é possível cancelar recibos com status aguardando_pagamento' };
      }

      // Reverte créditos aplicados para pendente
      const creditosAplicados = receipt.creditosAplicados || [];
      const batch = db.batch();
      for (const c of creditosAplicados) {
        if (c.creditoId) {
          batch.update(db.collection('creditos_professores').doc(c.creditoId), {
            status: 'pendente',
            appliedAt: null,
            appliedToReciboId: null,
            updatedAt: serverTs(),
          });
        }
      }
      // Marca recibo como cancelado
      batch.update(ref, {
        status: 'cancelado',
        updatedAt: serverTs(),
        creditosAplicados: [],
        totalCreditoAplicado: 0,
      });
      await batch.commit();

      await AuditService.log({
        type: 'receipt_cancelled',
        details: `Recibo ${receipt.numberFormatted} cancelado. ${creditosAplicados.length} crédito(s) revertido(s) para pendente.`,
        entityType: 'receipt', entityId: receiptId,
        before: receipt, after: { ...receipt, status: 'cancelado' },
        module: 'pagamentos',
      });

      return { success: true, data: { ...receipt, status: 'cancelado' } };
    } catch (err) {
      console.error('[ReceiptService.cancel]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async getById(receiptId) {
    try {
      const doc = await db.collection('receipts').doc(receiptId).get();
      if (!doc.exists) return { success: false, error: 'Recibo não encontrado' };
      return { success: true, data: { id: doc.id, ...doc.data() } };
    } catch (err) {
      console.error('[ReceiptService.getById]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async listByClosing(closingId) {
    try {
      const snap = await db.collection('receipts')
        .where('closingId', '==', closingId)
        .orderBy('number', 'asc')
        .get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[ReceiptService.listByClosing]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async listByTeacher(teacherId) {
    try {
      const snap = await db.collection('receipts')
        .where('teacherId', '==', teacherId)
        .orderBy('emittedAt', 'desc')
        .get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[ReceiptService.listByTeacher]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
};
```

- [ ] **Step 3: Adicionar PaymentService**

```js
// ─── PaymentService ──────────────────────────────────────────────────────

const PaymentService = {
  /** Confirma pagamento de um recibo. Cria payment_record + atualiza recibo. */
  async confirm(receiptId, { valor, metodo, obs } = {}) {
    if (!receiptId) return { success: false, error: 'receiptId obrigatório' };
    if (!valor || valor <= 0) return { success: false, error: 'Valor do pagamento deve ser > 0' };
    try {
      const receiptRef = db.collection('receipts').doc(receiptId);
      const receiptDoc = await receiptRef.get();
      if (!receiptDoc.exists) return { success: false, error: 'Recibo não encontrado' };
      const receipt = receiptDoc.data();
      if (receipt.status === 'cancelado') return { success: false, error: 'Recibo cancelado' };
      if (receipt.status === 'pago') return { success: false, error: 'Recibo já está pago' };

      // Cria payment_record
      const payRef = db.collection('payment_records').doc();
      const payData = {
        receiptId, receiptNumber: receipt.number,
        closingId: receipt.closingId, teacherId: receipt.teacherId,
        teacherName: receipt.teacherName, unitId: receipt.unitId,
        valor, metodo: metodo || 'outros', obs: obs || '',
        paidAt: serverTs(), paidBy: currentUserId(), paidByName: currentUserName(),
        createdAt: serverTs(), updatedAt: serverTs(),
      };
      await payRef.set(payData);

      // Atualiza recibo
      const afterReceipt = {
        ...receipt, status: 'pago', paidAt: serverTs(), paidBy: currentUserId(),
        paymentRecordId: payRef.id, updatedAt: serverTs(),
      };
      await receiptRef.update({
        status: 'pago', paidAt: serverTs(), paidBy: currentUserId(),
        paymentRecordId: payRef.id, updatedAt: serverTs(),
      });

      // Audit log
      await AuditService.log({
        type: 'payment_confirmed',
        details: `Pagamento confirmado · Recibo ${receipt.numberFormatted} · ${receipt.teacherName} · R$ ${valor.toFixed(2)}`,
        entityType: 'payment_record', entityId: payRef.id,
        before: receipt, after: afterReceipt,
        module: 'pagamentos',
      });

      // Notificação
      const userSnap = await db.collection('users').where('professorId', '==', receipt.teacherId).limit(1).get();
      if (!userSnap.empty) {
        await NotificationService.create({
          recipientUserId: userSnap.docs[0].id,
          type: 'pagamento_confirmado',
          title: 'Pagamento confirmado',
          body: `Pagamento de R$ ${valor.toFixed(2)} confirmado · Recibo ${receipt.numberFormatted}`,
          link: { type: 'receipt', id: receiptId },
        });
      }

      return { success: true, data: { id: payRef.id, ...payData } };
    } catch (err) {
      console.error('[PaymentService.confirm]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async listByClosing(closingId) {
    try {
      const snap = await db.collection('payment_records')
        .where('closingId', '==', closingId)
        .get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[PaymentService.listByClosing]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async listByTeacher(teacherId) {
    try {
      const snap = await db.collection('payment_records')
        .where('teacherId', '==', teacherId)
        .get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[PaymentService.listByTeacher]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
};
```

- [ ] **Step 4: Adicionar CreditService**

```js
// ─── CreditService ────────────────────────────────────────────────────────

const CreditService = {
  /** Registra crédito (positivo = pagou a mais, negativo = pagou a menos). */
  async register({ teacherId, teacherName, valor, motivo, reciboOrigemId, reciboOrigemNum, periodoOrigem }) {
    if (!teacherId) return { success: false, error: 'teacherId obrigatório' };
    if (!valor || valor === 0) return { success: false, error: 'Valor do crédito não pode ser zero' };
    try {
      const ref = db.collection('creditos_professores').doc();
      const data = {
        teacherId, teacherName: teacherName || '',
        valor, motivo: motivo || '', reciboOrigemId: reciboOrigemId || null,
        reciboOrigemNum: reciboOrigemNum || null, periodoOrigem: periodoOrigem || '',
        status: 'pendente',
        appliedAt: null, appliedToReciboId: null,
        registeredAt: serverTs(), registeredBy: currentUserId(),
        createdAt: serverTs(), updatedAt: serverTs(),
      };
      await ref.set(data);

      await AuditService.log({
        type: 'credit_registered',
        details: `Crédito de R$ ${valor.toFixed(2)} registrado · ${teacherName || teacherId} · Motivo: ${motivo || '(não informado)'}`,
        entityType: 'credito_professor', entityId: ref.id,
        before: null, after: data,
        module: 'pagamentos',
      });

      return { success: true, data: { id: ref.id, ...data } };
    } catch (err) {
      console.error('[CreditService.register]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async listPending(teacherId) {
    try {
      const snap = await db.collection('creditos_professores')
        .where('teacherId', '==', teacherId)
        .where('status', '==', 'pendente')
        .get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[CreditService.listPending]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async listHistory(teacherId) {
    try {
      const snap = await db.collection('creditos_professores')
        .where('teacherId', '==', teacherId)
        .get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[CreditService.listHistory]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
};
```

- [ ] **Step 5: Adicionar exports no bloco window (final do arquivo)**

Adicionar após `window.ClosingService = ClosingService;`:

```js
window.ReceiptService = ReceiptService;
window.PaymentService = PaymentService;
window.CreditService  = CreditService;
```

- [ ] **Step 6: Commit**

```bash
git add professores-shared.js
git commit -m "feat: ReceiptService + PaymentService + CreditService (Sprint 4b)"
```

---

### Task 3: Sidebar + Routing (professores.js + professores.html)

**Files:**
- Modify: `professores.js:30-45` (PROF_PAGES + PAGE_DEFINITIONS)
- Modify: `professores.html:1784` (adicionar divs) + `professores.html:2227` (script tag)

- [ ] **Step 1: Adicionar 'pagamentos' e 'meus-pagamentos' ao PROF_PAGES**

```js
// professores.js — PROF_PAGES
const PROF_PAGES = {
  admin:                ['home', 'modalidades', 'professores', 'agenda', 'agenda-geral', 'minha-agenda', 'fechamento', 'pagamentos'],
  admin_gestao:         ['home', 'modalidades', 'professores', 'agenda', 'agenda-geral', 'minha-agenda', 'fechamento'],
  supervisao:           ['home', 'professores', 'agenda', 'agenda-geral', 'minha-agenda'],
  professor:            ['home', 'agenda-geral', 'minha-agenda', 'meus-pagamentos'],
  professor_estagiario: ['home', 'agenda-geral', 'minha-agenda', 'meus-pagamentos'],
};
```

- [ ] **Step 2: Adicionar entradas no PAGE_DEFINITIONS**

```js
// professores.js — PAGE_DEFINITIONS (adicionar após o item fechamento)
{ id: 'pagamentos',     label: 'Pagamentos',     icon: '💳', section: 'Financeiro' },
{ id: 'meus-pagamentos',label: 'Meus Pagamentos',icon: '💳', section: 'Financeiro' },
```

- [ ] **Step 3: Adicionar handler de roteamento no switch de páginas**

No `professores.js`, localizar o switch/case que renderiza páginas (onde `fechamento` chama `renderFechamentoPage()`) e adicionar:

```js
case 'pagamentos':
  if (typeof renderPagamentosPage === 'function') await renderPagamentosPage();
  break;
case 'meus-pagamentos':
  if (typeof renderMeusPagamentosPage === 'function') await renderMeusPagamentosPage();
  break;
```

- [ ] **Step 4: Adicionar divs no HTML**

Em `professores.html`, após `<div class="page" id="page-fechamento"></div>`:

```html
<div class="page" id="page-pagamentos"></div>
<div class="page" id="page-meus-pagamentos"></div>
```

- [ ] **Step 5: Adicionar script tag**

Em `professores.html`, após `<script src="professores-fechamento.js"></script>`:

```html
<script src="professores-pagamentos.js"></script>
```

- [ ] **Step 6: Commit**

```bash
git add professores.js professores.html
git commit -m "feat: sidebar + routing para Pagamentos e Meus Pagamentos"
```

---

### Task 4: Tela "Pagamentos" (admin) — professores-pagamentos.js

**Files:**
- Create: `professores-pagamentos.js`

- [ ] **Step 1: Criar arquivo com estrutura base**

```js
// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Módulo Professores · Pagamentos (Sprint 4b)
// ═══════════════════════════════════════════════════════════════════════

'use strict';

// ─── Estado local ────────────────────────────────────────────────────────
const PagState = {
  filterUnitIds: [],          // chips multi-select (vazio = todos)
  filterYear: new Date().getFullYear(),
  filterMonth: new Date().getMonth() + 1,
  filterStatus: null,         // 'pendente' | 'pago' | null = todos
  expandedClosingId: null,
  closings: [],
  receiptsByClosing: {},      // closingId → [receipts]
  paymentsByClosing: {},      // closingId → [payment_records]
};

// ─── Constantes ──────────────────────────────────────────────────────────
const PAGAMENTO_STATUS_LABEL = {
  aguardando_pagamento: 'Aguard. pagamento',
  pago: 'Pago',
  cancelado: 'Cancelado',
};

const METODO_LABEL = {
  transferencia: 'Transferência',
  pix: 'PIX',
  dinheiro: 'Dinheiro',
  outros: 'Outros',
};

const STATUS_CHIP_COLORS = {
  aguardando_pagamento: 'var(--yellow-bg)',
  pago: 'var(--green-bg)',
  cancelado: 'var(--red-bg)',
};
const STATUS_CHIP_TEXT = {
  aguardando_pagamento: 'var(--yellow)',
  pago: 'var(--green)',
  cancelado: 'var(--red)',
};

// ─── Render principal ────────────────────────────────────────────────────

async function renderPagamentosPage() {
  const page = document.getElementById('page-pagamentos');
  if (!page) return;

  // Só admin (não admin_gestao — D4)
  if (!isStrictAdmin()) {
    page.innerHTML = '<div class="empty-state"><p class="subtitle">Acesso restrito ao administrador.</p></div>';
    return;
  }

  page.innerHTML = '<div class="loading">Carregando…</div>';

  // Carrega dados
  const [unitRes, closingRes] = await Promise.all([
    UnitService.list(),
    ClosingService.list(),
  ]);

  if (!unitRes.success || !closingRes.success) {
    page.innerHTML = `<div class="empty-state"><p class="subtitle">Erro ao carregar: ${(unitRes.error || closingRes.error)}</p></div>`;
    return;
  }

  PagState.closings = closingRes.data || [];
  PagState.units = unitRes.data || [];

  applyPagFilters();
  renderPagamentosHTML(page);
}

function applyPagFilters() {
  // Filtra closings por unidade, ano/mês, status
  let filtered = [...PagState.closings];
  if (PagState.filterUnitIds.length > 0) {
    filtered = filtered.filter(c => PagState.filterUnitIds.includes(c.unitId));
  }
  if (PagState.filterYear) {
    filtered = filtered.filter(c => c.year === PagState.filterYear);
  }
  if (PagState.filterMonth) {
    filtered = filtered.filter(c => c.month === PagState.filterMonth);
  }
  PagState.filteredClosings = filtered;
}

function renderPagamentosHTML(page) {
  const { filteredClosings, units, filterUnitIds, filterYear, filterMonth, filterStatus } = PagState;

  let html = '';

  // ── Toolbar ──
  html += '<div class="pag-toolbar">';
  // Chips de unidade
  html += '<div class="chip-row">';
  html += '<span class="chip-label">Unidade:</span>';
  for (const u of (units || [])) {
    const active = filterUnitIds.length === 0 || filterUnitIds.includes(u.id);
    html += `<span class="chip ${active ? 'chip-active' : ''}" data-unit="${u.id}" onclick="toggleUnitFilter(this, '${u.id}')">${u.name}</span>`;
  }
  html += '</div>';
  // Select ano/mês
  html += '<div class="pag-period">';
  html += `<select onchange="setYearFilter(this.value)">${yearOptions(filterYear)}</select>`;
  html += `<select onchange="setMonthFilter(this.value)">${monthOptions(filterMonth)}</select>`;
  html += '</div>';
  // Chips de status
  html += '<div class="chip-row">';
  html += `<span class="chip ${!filterStatus ? 'chip-active' : ''}" onclick="setStatusFilter(null)">Todos</span>`;
  html += `<span class="chip ${filterStatus === 'pendente' ? 'chip-active' : ''}" onclick="setStatusFilter('pendente')">Pendentes</span>`;
  html += `<span class="chip ${filterStatus === 'pago' ? 'chip-active' : ''}" onclick="setStatusFilter('pago')">Pagos</span>`;
  html += '</div>';
  html += '</div>'; // .pag-toolbar

  // ── Lista de closings ──
  if (filteredClosings.length === 0) {
    html += '<div class="empty-state"><p class="subtitle">Nenhum fechamento encontrado para os filtros selecionados.</p></div>';
  } else {
    html += '<div class="pag-closing-list">';
    for (const closing of filteredClosings) {
      html += renderClosingCard(closing);
    }
    html += '</div>';
  }

  page.innerHTML = html;
}

function yearOptions(sel) {
  const y = new Date().getFullYear();
  let o = '';
  for (let i = y; i >= y - 2; i--) {
    o += `<option value="${i}" ${i === sel ? 'selected' : ''}>${i}</option>`;
  }
  return o;
}

function monthOptions(sel) {
  const names = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return names.map((n, i) => `<option value="${i + 1}" ${(i + 1) === sel ? 'selected' : ''}>${n}</option>`).join('');
}
```

- [ ] **Step 2: Adicionar renderClosingCard()**

```js
function renderClosingCard(closing) {
  const isExpanded = PagState.expandedClosingId === closing.id;
  const teachers = closing.teachers || [];
  const totalValor = teachers.reduce((s, t) => s + (t.valorTotal || 0), 0);
  const statusLabel = closing.status === 'fechado' ? 'fechado' : 'aberto';
  const statusBg = closing.status === 'fechado' ? 'var(--green-bg)' : 'var(--yellow-bg)';
  const statusColor = closing.status === 'fechado' ? 'var(--green)' : 'var(--yellow)';

  let card = `<div class="pag-closing-card ${isExpanded ? 'expanded' : ''}">`;
  // Header
  card += `<div class="pag-closing-header" onclick="toggleClosingCard('${closing.id}')" style="cursor:pointer;">`;
  card += `<div><strong>${closing.unitName || closing.unitId} · ${closing.month}/${closing.year}</strong>`;
  card += `<span class="badge" style="margin-left:8px;background:${statusBg};color:${statusColor};">${statusLabel}</span></div>`;
  card += `<div style="display:flex;align-items:center;gap:12px;">`;
  card += `<span style="font-size:12px;color:var(--text2);">${teachers.length} professores · Total ${fmt(totalValor)}</span>`;
  card += `<span style="font-size:18px;">${isExpanded ? '▼' : '▶'}</span>`;
  card += `</div></div>`;

  if (isExpanded) {
    // Toolbar: emitir todos
    const semRecibo = teachers.filter(t => !t.hasReceipt);
    card += `<div class="pag-card-toolbar">`;
    if (semRecibo.length > 0) {
      card += `<button class="btn btn-sm btn-primary" onclick="emitirTodos('${closing.id}')">📄 Emitir TODOS (${semRecibo.length})</button>`;
    }
    card += `</div>`;

    // Tabela
    card += `<table class="pag-teacher-table">`;
    card += `<thead><tr>
      <th>Professor</th><th>Tipo</th><th class="text-right">Horas</th><th class="text-right">Valor</th>
      <th>Recibo</th><th>Status</th><th class="text-right">Ações</th>
    </tr></thead><tbody>`;
    for (const t of teachers) {
      card += renderTeacherRow(closing, t);
    }
    card += `</tbody></table>`;
  }

  card += `</div>`;
  return card;
}
```

- [ ] **Step 3: Adicionar renderTeacherRow()**

```js
function renderTeacherRow(closing, t) {
  const receipt = t._receipt; // preenchido após carregar recibos do closing
  const payment = t._payment;

  const typeLabel = { efetivo: 'Efetivo', estagiario: 'Estagiário', eventual: 'Eventual' }[t.teacherType] || t.teacherType;
  const typeClass = t.teacherType === 'efetivo' ? 'chip-orange' : t.teacherType === 'estagiario' ? 'chip-green' : 'chip-yellow';

  let reciboCell = '<span style="color:var(--text2);">—</span>';
  let statusCell = `<span style="background:var(--yellow-bg);color:var(--yellow);padding:2px 8px;border-radius:4px;font-size:11px;">pendente</span>`;
  let actions = `<button class="btn btn-sm" onclick="emitirRecibo('${closing.id}', '${t.teacherId}')">📄 Emitir</button>`;

  if (receipt) {
    reciboCell = `<a href="receipt.html?id=${receipt.id}" target="_blank" style="color:var(--accent);">#${receipt.numberFormatted}</a>`;
    const st = receipt.status;
    const chipBg = STATUS_CHIP_COLORS[st] || 'var(--surface2)';
    const chipTxt = STATUS_CHIP_TEXT[st] || 'var(--text2)';
    statusCell = `<span style="background:${chipBg};color:${chipTxt};padding:2px 8px;border-radius:4px;font-size:11px;">${PAGAMENTO_STATUS_LABEL[st] || st}</span>`;

    actions = `<button class="btn btn-sm" onclick="window.open('receipt.html?id=${receipt.id}','_blank')">🖨️</button>`;
    if (receipt.status === 'aguardando_pagamento') {
      actions += ` <button class="btn btn-sm btn-success" onclick="confirmarPagamento('${receipt.id}')">💰 Pagar</button>`;
    }
    if (receipt.status === 'pago') {
      actions += ` <button class="btn btn-sm" onclick="registrarCredito('${receipt.id}')">🔁 Crédito</button>`;
    }
  }

  return `<tr>
    <td><strong>${t.teacherName}</strong></td>
    <td><span class="chip-mini ${typeClass}">${typeLabel}</span></td>
    <td class="text-right">${(t.totalHoras || 0).toFixed(1)}h</td>
    <td class="text-right">${fmt(t.valorTotal || 0)}</td>
    <td>${reciboCell}</td>
    <td>${statusCell}</td>
    <td class="text-right">${actions}</td>
  </tr>`;
}
```

- [ ] **Step 4: Adicionar handlers de interação (filtros, expand, ações)**

```js
function toggleUnitFilter(el, unitId) {
  const idx = PagState.filterUnitIds.indexOf(unitId);
  if (idx >= 0) PagState.filterUnitIds.splice(idx, 1);
  else PagState.filterUnitIds.push(unitId);
  applyPagFilters();
  const page = document.getElementById('page-pagamentos');
  if (page) renderPagamentosHTML(page);
}

function setYearFilter(y) { PagState.filterYear = parseInt(y); applyPagFilters(); const p = document.getElementById('page-pagamentos'); if (p) renderPagamentosHTML(p); }
function setMonthFilter(m) { PagState.filterMonth = parseInt(m); applyPagFilters(); const p = document.getElementById('page-pagamentos'); if (p) renderPagamentosHTML(p); }
function setStatusFilter(s) { PagState.filterStatus = s; applyPagFilters(); const p = document.getElementById('page-pagamentos'); if (p) renderPagamentosHTML(p); }

async function toggleClosingCard(closingId) {
  PagState.expandedClosingId = PagState.expandedClosingId === closingId ? null : closingId;
  if (PagState.expandedClosingId) {
    // Carrega recibos e pagamentos deste closing
    const [recRes, payRes] = await Promise.all([
      ReceiptService.listByClosing(closingId),
      PaymentService.listByClosing(closingId),
    ]);
    const receipts = recRes.success ? recRes.data : [];
    const payments = payRes.success ? payRes.data : [];

    // Injeta nos teachers do closing
    const closing = PagState.filteredClosings.find(c => c.id === closingId);
    if (closing && closing.teachers) {
      for (const t of closing.teachers) {
        t._receipt = receipts.find(r => r.teacherId === t.teacherId) || null;
        t._payment = payments.find(p => p.teacherId === t.teacherId) || null;
      }
    }
  }
  const page = document.getElementById('page-pagamentos');
  if (page) renderPagamentosHTML(page);
}

async function emitirRecibo(closingId, teacherId) {
  if (!confirm('Confirma a emissão do recibo?')) return;
  toast('Emitindo recibo…', 'info');
  const res = await ReceiptService.emit({ closingId, teacherId });
  if (res.success) {
    toast(`Recibo #${res.data.numberFormatted} emitido!`, 'success');
    // Recarrega o card expandido
    PagState.expandedClosingId = null;
    await toggleClosingCard(closingId);
  } else {
    toast('Erro: ' + res.error, 'error');
  }
}

async function emitirTodos(closingId) {
  const closing = PagState.filteredClosings.find(c => c.id === closingId);
  if (!closing) return;
  const semRecibo = (closing.teachers || []).filter(t => !t._receipt);
  if (semRecibo.length === 0) { toast('Todos já têm recibo.', 'info'); return; }
  if (!confirm(`Emitir ${semRecibo.length} recibos?`)) return;
  toast(`Emitindo ${semRecibo.length} recibos…`, 'info', 5000);
  const res = await ReceiptService.emitBatch({
    closingId,
    teacherIds: semRecibo.map(t => t.teacherId),
  });
  if (res.success) {
    toast(`${res.data.results.length} recibos emitidos!`, 'success');
    if (res.data.errors.length > 0) {
      console.warn('Erros no lote:', res.data.errors);
    }
  } else {
    toast('Erros na emissão em lote. Ver console.', 'error');
  }
  PagState.expandedClosingId = null;
  await toggleClosingCard(closingId);
}
```

- [ ] **Step 5: Adicionar modal de confirmação de pagamento + crédito**

```js
async function confirmarPagamento(receiptId) {
  const res = await ReceiptService.getById(receiptId);
  if (!res.success) { toast('Recibo não encontrado.', 'error'); return; }
  const rec = res.data;
  const valor = prompt(`Valor a pagar (R$):`, rec.valorLiquido.toFixed(2));
  if (!valor || isNaN(parseFloat(valor)) || parseFloat(valor) <= 0) return;
  const metodo = prompt('Método (transferencia, pix, dinheiro, outros):', 'transferencia');
  const obs = prompt('Observações (opcional):', '');

  toast('Confirmando pagamento…', 'info');
  const payRes = await PaymentService.confirm(receiptId, {
    valor: parseFloat(valor),
    metodo: metodo || 'outros',
    obs: obs || '',
  });
  if (payRes.success) {
    toast('Pagamento confirmado!', 'success');
    // Recarrega
    if (PagState.expandedClosingId) {
      const cid = PagState.expandedClosingId;
      PagState.expandedClosingId = null;
      await toggleClosingCard(cid);
    }
  } else {
    toast('Erro: ' + payRes.error, 'error');
  }
}

async function registrarCredito(receiptId) {
  const res = await ReceiptService.getById(receiptId);
  if (!res.success) { toast('Recibo não encontrado.', 'error'); return; }
  const rec = res.data;
  const valor = prompt('Valor do crédito (positivo = pagou a mais, negativo = faltou):', '0');
  if (!valor || isNaN(parseFloat(valor)) || parseFloat(valor) === 0) return;
  const motivo = prompt('Motivo:', 'Divergência pós-pagamento');

  toast('Registrando crédito…', 'info');
  const credRes = await CreditService.register({
    teacherId: rec.teacherId,
    teacherName: rec.teacherName,
    valor: parseFloat(valor),
    motivo: motivo || '',
    reciboOrigemId: receiptId,
    reciboOrigemNum: rec.number,
    periodoOrigem: `${rec.year}-${String(rec.month).padStart(2, '0')}`,
  });
  if (credRes.success) {
    toast('Crédito registrado!', 'success');
  } else {
    toast('Erro: ' + credRes.error, 'error');
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add professores-pagamentos.js
git commit -m "feat: tela de Pagamentos admin (Sprint 4b etapa 2)"
```

---

### Task 5: receipt.html — página standalone de impressão

**Files:**
- Create: `receipt.html`

- [ ] **Step 1: Criar receipt.html completo**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Recibo · CrossTainer</title>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"></script>
<script src="firebase-config.js"></script>
<style>
  @page { size: A4; margin: 1.5cm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    color: #111; background: #fff;
    font-size: 13px; line-height: 1.5;
  }
  .receipt { max-width: 720px; margin: 0 auto; padding: 30px; }
  .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 24px; }
  .header h1 { margin: 0; font-size: 26px; letter-spacing: 1px; font-weight: 800; }
  .header .sub { font-size: 13px; color: #444; margin-top: 4px; text-transform: uppercase; letter-spacing: 2px; }
  .header .number { font-size: 15px; color: #000; margin-top: 4px; font-weight: 700; }
  .info { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
  .info-block { padding: 10px 12px; background: #f5f5f5; border-radius: 4px; }
  .info-label { font-size: 9px; text-transform: uppercase; color: #888; letter-spacing: 0.5px; }
  .info-value { font-weight: 600; font-size: 13px; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  table th, table td { border-bottom: 1px solid #e0e0e0; padding: 10px 8px; text-align: left; font-size: 12px; }
  table th { background: #f0f0f0; font-weight: 700; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }
  .text-right { text-align: right; }
  .creditos { background: #fff8e6; padding: 10px 12px; border-left: 3px solid #f5a623; margin-bottom: 16px; font-size: 12px; border-radius: 2px; }
  .creditos .cred-title { font-weight: 700; margin-bottom: 2px; }
  .total { font-size: 22px; font-weight: 800; text-align: right; padding: 12px 16px;
    background: #000; color: #fff; border-radius: 4px; margin-top: 4px; }
  .extenso { font-size: 11px; font-style: italic; color: #666; margin-top: 4px; text-align: right; }
  .sig { margin-top: 60px; display: flex; justify-content: space-between; }
  .sig-line { width: 260px; border-top: 1px solid #000; padding-top: 6px; text-align: center; font-size: 12px; }
  .sig-line small { color: #888; font-size: 10px; }
  .footer { text-align: center; font-size: 10px; color: #aaa; margin-top: 30px; }
  .actions { text-align: center; margin: 24px 0; }
  .actions button { padding: 10px 28px; font-size: 14px; cursor: pointer; border-radius: 4px; border: 1px solid #000; background: #000; color: #fff; font-weight: 600; }
  .actions button:hover { background: #333; }
  .loading { text-align: center; padding: 60px; color: #888; }
  .error { text-align: center; padding: 60px; color: #c00; }
  @media print {
    .actions { display: none; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="receipt" id="receiptContent"><div class="loading">Carregando…</div></div>
<div class="actions"><button onclick="window.print()">🖨️ Imprimir</button></div>
<script>
(async () => {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { document.getElementById('receiptContent').innerHTML = '<div class="error">ID do recibo não informado.</div>'; return; }

  // Espera auth
  await new Promise((resolve, reject) => {
    const unsub = firebase.auth().onAuthStateChanged(u => {
      unsub();
      if (u) resolve(u);
      else { document.getElementById('receiptContent').innerHTML = '<div class="error">Você precisa estar logado. <a href="professores.html">Fazer login</a></div>'; reject(); }
    });
  });

  const db = firebase.firestore();
  const doc = await db.collection('receipts').doc(id).get();
  if (!doc.exists) { document.getElementById('receiptContent').innerHTML = '<div class="error">Recibo não encontrado.</div>'; return; }
  const r = doc.data();
  document.getElementById('receiptContent').innerHTML = renderReceipt(r);
})();

function renderReceipt(r) {
  const creditos = (r.creditosAplicados || []);
  let creditosHtml = '';
  if (creditos.length > 0 && r.totalCreditoAplicado > 0) {
    const linhas = creditos.map(c =>
      `Recibo #${String(c.reciboOrigemNum || 0).padStart(4,'0')} (${c.periodoOrigem || 'N/A'}): R$ ${(c.valor || 0).toFixed(2)}`
    ).join('<br>');
    creditosHtml = `<tr style="color:#2e7d32;"><td>(−) Crédito de períodos anteriores<br><span style="font-size:9px;">${linhas}</span></td><td class="text-right">−R$ ${r.totalCreditoAplicado.toFixed(2)}</td></tr>`;
  }

  let debitoHtml = '';
  if (r.totalCreditoAplicado < 0) {
    debitoHtml = `<div class="creditos"><div class="cred-title">⚠ Débito de período anterior</div>R$ ${Math.abs(r.totalCreditoAplicado).toFixed(2)}</div>`;
  }

  const monthNames = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const periodo = `${monthNames[r.month] || r.month} de ${r.year}`;

  const typeLabel = { efetivo: 'Efetivo(a)', estagiario: 'Estagiário(a)', eventual: 'Eventual' }[r.teacherType] || r.teacherType;

  return `
    <div class="header">
      <h1>CrossTainer</h1>
      <div class="sub">Recibo de Pagamento</div>
      <div class="number">Nº ${r.numberFormatted || '0000'} · ${periodo}</div>
    </div>
    <div class="info">
      <div class="info-block"><div class="info-label">Professor(a)</div><div class="info-value">${r.teacherName || ''}</div></div>
      <div class="info-block"><div class="info-label">Tipo de vínculo</div><div class="info-value">${typeLabel}</div></div>
      <div class="info-block"><div class="info-label">CPF</div><div class="info-value">${r.teacherCpf || ''}</div></div>
      <div class="info-block"><div class="info-label">Unidade</div><div class="info-value">${r.unitName || ''}</div></div>
    </div>
    <table>
      <thead><tr><th>Descrição</th><th class="text-right">Valor (R$)</th></tr></thead>
      <tbody>
        <tr><td>Horas trabalhadas (${(r.closingHoras || 0).toFixed(1)}h)</td><td class="text-right">${(r.closingValorHoras || 0).toFixed(2)}</td></tr>
        <tr><td><strong>Total bruto do fechamento</strong></td><td class="text-right"><strong>${(r.closingValorTotal || 0).toFixed(2)}</strong></td></tr>
        ${creditosHtml}
      </tbody>
    </table>
    ${debitoHtml}
    <div class="total">VALOR LÍQUIDO: R$ ${(r.valorLiquido || 0).toFixed(2)}</div>
    <div class="extenso">${numeroPorExtenso(r.valorLiquido || 0)}</div>
    <div class="sig">
      <div class="sig-line">${r.teacherName || ''}<br><small>Professor(a)</small></div>
      <div class="sig-line">${r.emittedByName || 'Administração'}<br><small>Emitido por</small></div>
    </div>
    <div class="footer">Emitido em ${new Date((r.emittedAt && r.emittedAt.toDate ? r.emittedAt.toDate() : Date.now())).toLocaleString('pt-BR')} · CrossTainer Sistema de Gestão</div>
  `;
}

/** Valor por extenso simplificado (PT-BR). */
function numeroPorExtenso(valor) {
  if (!valor || valor === 0) return 'Zero reais';
  const inteiro = Math.floor(valor);
  const centavos = Math.round((valor - inteiro) * 100);

  const unidades = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
    'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const dezenas = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const centenas = ['', 'cem', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

  function centena(n) {
    if (n === 0) return '';
    if (n === 100) return 'cem';
    if (n < 20) return unidades[n];
    if (n < 100) {
      const d = Math.floor(n / 10), u = n % 10;
      return dezenas[d] + (u ? ' e ' + unidades[u] : '');
    }
    const c = Math.floor(n / 100), resto = n % 100;
    let r = centenas[c];
    if (resto === 0) return r;
    return r + ' e ' + centena(resto);
  }

  function milhar(n) {
    if (n < 1000) return centena(n);
    const m = Math.floor(n / 1000), resto = n % 1000;
    const mMil = m === 1 ? 'mil' : centena(m) + ' mil';
    if (resto === 0) return mMil;
    return mMil + (resto < 100 ? ' e ' : ' ') + centena(resto);
  }

  let ext = milhar(inteiro);
  ext = ext.charAt(0).toUpperCase() + ext.slice(1);
  ext += inteiro === 1 ? ' real' : ' reais';
  if (centavos > 0) {
    ext += ' e ' + centena(centavos) + (centavos === 1 ? ' centavo' : ' centavos');
  }
  return ext;
}
</script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add receipt.html
git commit -m "feat: pagina de impressao de recibo A4 (receipt.html)"
```

---

### Task 6: Painel "Meus Pagamentos" (professor)

**Files:**
- Modify: `professores-pagamentos.js` — adicionar `renderMeusPagamentosPage()`

- [ ] **Step 1: Adicionar renderMeusPagamentosPage()**

```js
// ─── Painel do Professor ─────────────────────────────────────────────────

async function renderMeusPagamentosPage() {
  const page = document.getElementById('page-meus-pagamentos');
  if (!page) return;

  const professorId = getCurrentProfessorId();
  if (!professorId) {
    page.innerHTML = `<div class="empty-state"><p class="subtitle">Nenhum professor vinculado ao seu usuário.</p><p style="color:var(--text2);margin-top:4px;">Solicite ao administrador que vincule seu cadastro.</p></div>`;
    return;
  }

  page.innerHTML = '<div class="loading">Carregando…</div>';

  const [recRes, credRes] = await Promise.all([
    ReceiptService.listByTeacher(professorId),
    CreditService.listHistory(professorId),
  ]);

  if (!recRes.success) {
    page.innerHTML = `<div class="empty-state"><p class="subtitle">Erro ao carregar: ${recRes.error}</p></div>`;
    return;
  }

  const recibos = recRes.data || [];
  const creditos = credRes.success ? credRes.data : [];
  const pendentes = creditos.filter(c => c.status === 'pendente');
  const aplicados = creditos.filter(c => c.status === 'aplicado');

  let html = '';

  // Créditos pendentes (destaque no topo)
  if (pendentes.length > 0) {
    html += '<div class="creditos-alert">';
    html += '<h3>⚠ Créditos / Débitos pendentes</h3>';
    for (const c of pendentes) {
      const sinal = c.valor > 0 ? '+' : '';
      html += `<div class="credito-item">
        <span>${sinal}R$ ${(c.valor || 0).toFixed(2)}</span>
        <span style="font-size:11px;color:var(--text2);">${c.motivo || ''} · ${c.periodoOrigem || ''}</span>
      </div>`;
    }
    html += '</div>';
  }

  // Lista de recibos agrupados por unidade × mês
  if (recibos.length === 0) {
    html += '<div class="empty-state"><p class="subtitle">Nenhum recibo encontrado.</p></div>';
  } else {
    // Agrupa
    const grupos = {};
    for (const r of recibos) {
      const key = `${r.unitId}_${r.year}-${r.month}`;
      if (!grupos[key]) grupos[key] = { unitName: r.unitName, year: r.year, month: r.month, recibos: [] };
      grupos[key].recibos.push(r);
    }

    html += '<div class="meus-recibos-list">';
    for (const [key, g] of Object.entries(grupos)) {
      html += `<div class="meus-recibos-card">
        <div class="meus-recibos-header"><strong>${g.unitName} · ${g.month}/${g.year}</strong> <span style="color:var(--text2);">${g.recibos.length} recibo(s)</span></div>
        <table><tbody>`;
      for (const r of g.recibos) {
        const stLabel = { aguardando_pagamento: 'Aguardando', pago: 'Pago', cancelado: 'Cancelado' }[r.status] || r.status;
        html += `<tr>
          <td><a href="receipt.html?id=${r.id}" target="_blank" style="color:var(--accent);">#${r.numberFormatted}</a></td>
          <td>${stLabel}</td>
          <td class="text-right">${fmt(r.valorLiquido)}</td>
          <td><button class="btn btn-sm" onclick="window.open('receipt.html?id=${r.id}','_blank')">🖨️</button></td>
        </tr>`;
      }
      html += `</tbody></table></div>`;
    }
    html += '</div>';
  }

  // Histórico de créditos (resumo)
  if (aplicados.length > 0) {
    html += '<details style="margin-top:20px;"><summary style="cursor:pointer;font-size:13px;color:var(--text2);">Histórico de créditos aplicados (' + aplicados.length + ')</summary>';
    html += '<div style="margin-top:8px;font-size:12px;">';
    for (const c of aplicados) {
      html += `<div style="padding:4px 0;border-bottom:1px solid var(--border);">
        R$ ${(c.valor || 0).toFixed(2)} · ${c.periodoOrigem || ''} · ${c.motivo || ''}
        <span style="color:var(--text2);">→ aplicado em recibo #${String(c.reciboOrigemNum || 0).padStart(4,'0')}</span>
      </div>`;
    }
    html += '</div></details>';
  }

  page.innerHTML = html;
}
```

- [ ] **Step 2: Commit**

```bash
git add professores-pagamentos.js
git commit -m "feat: painel Meus Pagamentos do professor (Sprint 4b etapa 6)"
```

---

### Task 7: CSS para telas de pagamento

**Files:**
- Modify: `professores.html` — adicionar bloco `<style>` para classes de pagamento

- [ ] **Step 1: Adicionar CSS inline no head de professores.html**

Antes de `</style>` no `<head>`:

```css
/* ─── Pagamentos (Sprint 4b) ─── */
.pag-toolbar { display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-bottom:20px; }
.chip-row { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
.chip-label { font-size:11px; color:var(--text2); text-transform:uppercase; letter-spacing:0.5px; }
.chip { padding:5px 12px; border-radius:6px; font-size:12px; cursor:pointer; background:var(--surface2); border:1px solid var(--border); color:var(--text2); transition:all .15s; }
.chip:hover { border-color:var(--accent); color:var(--text); }
.chip.chip-active { background:var(--accent); color:#fff; border-color:var(--accent); }
.chip-mini { padding:2px 8px; border-radius:4px; font-size:10px; font-weight:600; display:inline-block; }
.chip-mini.chip-orange { background:var(--orange-glow); color:var(--orange); }
.chip-mini.chip-green { background:var(--green-bg); color:var(--green); }
.chip-mini.chip-yellow { background:var(--yellow-bg); color:var(--yellow); }
.pag-period { display:flex; gap:8px; }
.pag-period select { background:var(--surface2); border:1px solid var(--border); border-radius:6px; padding:6px 12px; font-size:13px; color:var(--text); }
.pag-closing-list { display:flex; flex-direction:column; gap:12px; }
.pag-closing-card { border:1px solid var(--border); border-radius:10px; overflow:hidden; background:var(--surface); }
.pag-closing-card.expanded { border-color:var(--accent); }
.pag-closing-header { padding:12px 16px; background:var(--surface2); display:flex; justify-content:space-between; align-items:center; }
.pag-closing-card.expanded .pag-closing-header { background:var(--accent); color:#fff; }
.pag-card-toolbar { padding:8px 16px; background:var(--surface1); border-bottom:1px solid var(--border); display:flex; justify-content:flex-end; }
.pag-teacher-table { width:100%; border-collapse:collapse; font-size:13px; }
.pag-teacher-table th { padding:8px 16px; text-align:left; background:var(--surface3); font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:var(--text2); }
.pag-teacher-table td { padding:10px 16px; border-bottom:1px solid var(--border); }
.pag-teacher-table .text-right { text-align:right; }

.creditos-alert { background:var(--yellow-bg); border:1px solid var(--yellow); border-radius:8px; padding:16px; margin-bottom:20px; }
.creditos-alert h3 { margin:0 0 8px; font-size:14px; color:var(--yellow); }
.credito-item { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid rgba(253,216,53,0.2); font-size:13px; }
.meus-recibos-list { display:flex; flex-direction:column; gap:12px; }
.meus-recibos-card { border:1px solid var(--border); border-radius:10px; overflow:hidden; }
.meus-recibos-header { padding:10px 16px; background:var(--surface2); font-size:14px; display:flex; justify-content:space-between; }
.meus-recibos-card table { width:100%; border-collapse:collapse; font-size:13px; }
.meus-recibos-card td { padding:8px 16px; border-bottom:1px solid var(--border); }
```

- [ ] **Step 2: Commit**

```bash
git add professores.html
git commit -m "feat: CSS para telas de pagamentos (Sprint 4b)"
```

---

### Task 8: Smoke test — scripts/admin.js

**Files:**
- Modify: `scripts/admin.js`

- [ ] **Step 1: Adicionar comandos smoke-4b**

Adicionar ao switch de comandos:

```js
// ─── Sprint 4b ─────────────────────────────────────────────────────────

async function cmdListClosingTeachers(closingId) {
  const doc = await db.collection('monthly_closings').doc(closingId).get();
  if (!doc.exists) { console.error('Closing não encontrado'); return; }
  const c = doc.data();
  console.log(`\n${c.unitName} · ${c.month}/${c.year} · status: ${c.status}`);
  console.log(`Teachers (${(c.teachers || []).length}):`);
  (c.teachers || []).forEach(t => {
    console.log(`  ${t.teacherName} (${t.teacherType}) — ${t.totalHoras}h · ${fmt(t.valorTotal)}`);
  });
}

async function cmdEmitReceipt(closingId, teacherId) {
  console.log(`Emitindo recibo para teacherId=${teacherId} no closing ${closingId}...`);
  const counterRef = db.collection('meta').doc('receipt_counter');
  const counterDoc = await counterRef.get();
  const nextNumber = (counterDoc.exists ? counterDoc.data().value : 0) + 1;

  const closingDoc = await db.collection('monthly_closings').doc(closingId).get();
  const c = closingDoc.data();
  const t = (c.teachers || []).find(x => x.teacherId === teacherId);
  if (!t) { console.error('Teacher não encontrado no closing'); return; }

  const ref = db.collection('receipts').doc();
  await ref.set({
    number: nextNumber, numberFormatted: String(nextNumber).padStart(4, '0'),
    closingId, unitId: c.unitId, unitName: c.unitName, year: c.year, month: c.month,
    teacherId, teacherName: t.teacherName, teacherCpf: t.teacherCpf || '', teacherType: t.teacherType,
    closingValorTotal: t.valorTotal, closingValorHoras: t.valorHoras, closingHoras: t.totalHoras,
    creditosAplicados: [], totalCreditoAplicado: 0, valorLiquido: t.valorTotal,
    status: 'aguardando_pagamento',
    emittedAt: admin.firestore.FieldValue.serverTimestamp(),
    emittedBy: 'admin-script', emittedByName: 'Admin Script',
    paidAt: null, paidBy: null, paymentRecordId: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await counterRef.set({ value: nextNumber, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  console.log(`✅ Recibo #${String(nextNumber).padStart(4,'0')} criado: ${ref.id}`);
  return ref.id;
}

async function cmdConfirmPayment(receiptId, valor) {
  const ref = db.collection('receipts').doc(receiptId);
  const doc = await ref.get();
  if (!doc.exists) { console.error('Recibo não encontrado'); return; }
  const r = doc.data();
  const payRef = db.collection('payment_records').doc();
  await payRef.set({
    receiptId, receiptNumber: r.number, closingId: r.closingId,
    teacherId: r.teacherId, teacherName: r.teacherName, unitId: r.unitId,
    valor: parseFloat(valor), metodo: 'script', obs: 'smoke test',
    paidAt: admin.firestore.FieldValue.serverTimestamp(),
    paidBy: 'admin-script', paidByName: 'Admin Script',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await ref.update({
    status: 'pago', paidAt: admin.firestore.FieldValue.serverTimestamp(),
    paidBy: 'admin-script', paymentRecordId: payRef.id,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✅ Pagamento confirmado: ${payRef.id}`);
}

async function cmdRegisterCredit(teacherId, teacherName, valor, motivo) {
  const ref = db.collection('creditos_professores').doc();
  await ref.set({
    teacherId, teacherName, valor: parseFloat(valor), motivo: motivo || '',
    reciboOrigemId: null, reciboOrigemNum: null, periodoOrigem: '',
    status: 'pendente', appliedAt: null, appliedToReciboId: null,
    registeredAt: admin.firestore.FieldValue.serverTimestamp(),
    registeredBy: 'admin-script',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✅ Crédito registrado: ${ref.id}`);
}

async function cmdListReceipts(unitId, year, month) {
  let q = db.collection('receipts');
  if (year) q = q.where('year', '==', parseInt(year));
  if (month) q = q.where('month', '==', parseInt(month));
  // Filtra por unitId client-side
  const snap = await q.orderBy('number', 'asc').get();
  const recibos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(r => !unitId || r.unitId === unitId);
  console.log(`\nRecibos (${recibos.length}):`);
  recibos.forEach(r => {
    console.log(`  #${r.numberFormatted} ${r.teacherName} · ${r.unitName} ${r.month}/${r.year} · ${fmt(r.valorLiquido)} [${r.status}]`);
  });
}

async function cmdSmoke4b(closingId) {
  if (!closingId) { console.error('Uso: smoke-4b <closingId>'); return; }
  console.log('\n══════ SMOKE TEST Sprint 4b ══════\n');

  // C1: Ver closing
  const closing = await db.collection('monthly_closings').doc(closingId).get();
  if (!closing.exists) { console.error('❌ C1: Closing não encontrado'); return; }
  console.log('✅ C1: Closing existe');
  const c = closing.data();
  const teachers = c.teachers || [];
  console.log(`   ${c.unitName} · ${c.month}/${c.year} · ${teachers.length} professores`);

  // C2: Lista recibos
  const recs = await db.collection('receipts').where('closingId', '==', closingId).orderBy('number', 'asc').get();
  console.log(`✅ C2-C3: Recibos já emitidos: ${recs.size}`);

  // C4: Contador atual
  const counter = await db.collection('meta').doc('receipt_counter').get();
  console.log(`✅ C4: Contador atual: ${counter.exists ? counter.data().value : 0}`);

  // C5: Créditos pendentes
  const creds = await db.collection('creditos_professores').where('status', '==', 'pendente').get();
  console.log(`✅ C5: Créditos pendentes (geral): ${creds.size}`);
  creds.docs.forEach(d => {
    const c = d.data();
    console.log(`   ${c.teacherName}: R$ ${c.valor.toFixed(2)} · ${c.motivo}`);
  });

  // C6: Payment records
  const pays = await db.collection('payment_records').where('closingId', '==', closingId).get();
  console.log(`✅ C6: Pagamentos confirmados deste closing: ${pays.size}`);
  pays.docs.forEach(d => {
    const p = d.data();
    console.log(`   ${p.teacherName}: R$ ${p.valor.toFixed(2)} · ${p.metodo}`);
  });

  // C7: Verifica se todos teachers têm recibo (opcional)
  const semRecibo = teachers.filter(t => {
    return !recs.docs.some(r => r.data().teacherId === t.teacherId);
  });
  if (semRecibo.length > 0) {
    console.log(`\n📋 Professores sem recibo (${semRecibo.length}):`);
    semRecibo.forEach(t => console.log(`   - ${t.teacherName} (${t.teacherId})`));
  } else {
    console.log('\n✅ Todos professores têm recibo.');
  }

  console.log('\n══════ FIM SMOKE TEST ══════\n');
}
```

Adicionar no switch de comandos:

```js
case 'list-closing-teachers': return cmdListClosingTeachers(cmdArgs[0]);
case 'emit-receipt':          return cmdEmitReceipt(cmdArgs[0], cmdArgs[1]);
case 'confirm-payment':       return cmdConfirmPayment(cmdArgs[0], parseFloat(cmdArgs[1]));
case 'register-credit':       return cmdRegisterCredit(cmdArgs[0], cmdArgs[1], parseFloat(cmdArgs[2]), cmdArgs[3]);
case 'list-receipts':         return cmdListReceipts(cmdArgs[0], cmdArgs[1], cmdArgs[2]);
case 'smoke-4b':              return cmdSmoke4b(cmdArgs[0]);
```

E atualizar o help:

```js
case 'help': {
  console.log('Comandos disponíveis:');
  console.log('  list-units                              — lista unidades');
  console.log('  list-classes <unitId> <year> <month>    — lista classes');
  console.log('  list-teachers                           — lista professores');
  console.log('  list-closings <unitId>                  — lista fechamentos');
  console.log('  list-closing-teachers <closingId>       — lista profs de um closing');
  console.log('  preview <unitId> <year> <month>         — preview fechamento');
  console.log('  smoke-4a <unitId> <year> <month>        — smoke test Sprint 4a');
  console.log('  check-frozen <unitId> <year> <month>    — verifica congelamento');
  console.log('  emit-receipt <closingId> <teacherId>    — emite recibo (admin SDK)');
  console.log('  confirm-payment <receiptId> <valor>     — confirma pagamento');
  console.log('  register-credit <tId> <nome> <valor> <motivo> — registra crédito');
  console.log('  list-receipts [unitId] [year] [month]   — lista recibos');
  console.log('  smoke-4b <closingId>                    — smoke test Sprint 4b');
  break;
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/admin.js
git commit -m "feat: comandos smoke-4b no admin.js (Sprint 4b etapa 8)"
```

---

### Task 9: Deploy + Smoke test

- [ ] **Step 1: Deploy firestore rules + indexes (se não feito no Task 1)**

```bash
npx firebase deploy --only firestore:rules,firestore:indexes --project staging
```

- [ ] **Step 2: Abrir staging no navegador e testar manualmente**

- Login admin → sidebar mostra "💳 Pagamentos"
- Login admin_gestao → NÃO mostra "💳 Pagamentos"
- Login professor → sidebar mostra "💳 Meus Pagamentos"
- Admin: selecionar unidade, mês → ver closings
- Expandir closing → ver professores
- Emitir recibo individual → abre receipt.html em nova aba
- Emitir TODOS → N recibos sequenciais
- Confirmar pagamento → status muda pra pago
- Registrar crédito → creditos_professores criado
- Professor: vê "Meus Pagamentos" com recibos próprios

- [ ] **Step 3: Rodar smoke test via admin.js**

```bash
node scripts/admin.js --project staging smoke-4b unit-cp_2026-05
```

- [ ] **Step 4: Commit final (se houver ajustes)**

```bash
git add -A
git commit -m "chore: ajustes finais Sprint 4b"
```
