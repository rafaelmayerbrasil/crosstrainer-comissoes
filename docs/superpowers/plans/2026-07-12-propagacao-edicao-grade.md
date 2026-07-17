# Propagação opcional da edição de grade · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans pra implementar task-a-task. Passos usam checkbox (`- [ ]`).

**Goal:** Ao salvar a edição de um slot da grade, oferecer (opt-in) atualizar as aulas futuras "intocadas" desse slot (professor/modalidade/horário), sem tocar em mês fechado/substituída/passada.

**Architecture:** Um helper puro novo (`class-propagation.js`) decide quais aulas atualizar e com que patch; dois métodos IO no `ClassService` (`professores-shared.js`) leem/aplicam via batch; o `professores-agenda.js` engancha no salvar-slot com um `confirm`. Client-side (gestão já tem `classes.update` nas rules) — sem CF, sem deploy de functions, sem índice novo.

**Tech Stack:** JS vanilla (UMD), Firestore (`db` global + `db.batch()`), smoke Node com `assert`.

**Spec:** `docs/superpowers/specs/2026-07-12-propagacao-edicao-grade-design.md`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Ação |
|---------|------------------|------|
| `class-propagation.js` | `planClassUpdatesForSlot` (puro) | **criar** |
| `scripts/smoke-class-propagation.js` | smoke do helper | **criar** |
| `professores-shared.js` | `ClassService.propagateSlotEditPlan` (lê+planeja) + `propagateSlotEditApply` (batch) | modificar |
| `professores.html` | `<script src="class-propagation.js">` antes de `professores-shared.js` | modificar |
| `professores-agenda.js` | hook no salvar-slot (guard + confirm + apply + toast) | modificar |

**Ordem:** Task 1 (puro+smoke) → Task 2 (IO no ClassService + script tag) → Task 3 (wiring no agenda) → Task 4 (verificação + E2E).

---

## Task 1: helper puro `class-propagation.js` + smoke

**Files:** Create `class-propagation.js`; Create `scripts/smoke-class-propagation.js`.

- [ ] **Step 1: Criar `scripts/smoke-class-propagation.js`:**

```js
'use strict';
// Roda: node scripts/smoke-class-propagation.js
const assert = require('assert');
const CP = require('../class-propagation.js');

const novoSlot = { teacherId: 'novoT', modalityId: 'novoM', startTime: '19:00', endTime: '20:00', durationMinutes: 60 };
const hoje = '2026-07-12';
const aulas = [
  { id: 'a1', status: 'prevista',    monthClosingId: null,               dateISO: '2026-07-20' }, // futura intocada → atualiza
  { id: 'a2', status: 'prevista',    monthClosingId: null,               dateISO: '2026-07-27' }, // futura intocada → atualiza
  { id: 'a3', status: 'prevista',    monthClosingId: 'unit-cp_2026-07',  dateISO: '2026-07-22' }, // mês fechado → pula
  { id: 'a4', status: 'substituida', monthClosingId: null,               dateISO: '2026-07-24' }, // substituída → pula
  { id: 'a5', status: 'cancelada',   monthClosingId: null,               dateISO: '2026-07-29' }, // cancelada → pula
  { id: 'a6', status: 'prevista',    monthClosingId: null,               dateISO: '2026-07-05' }, // passada → pula
];
const r = CP.planClassUpdatesForSlot(novoSlot, aulas, hoje);
assert.strictEqual(r.eligibleCount, 2, 'só 2 elegíveis');
assert.deepStrictEqual(r.updates.map(u => u.classId).sort(), ['a1', 'a2'], 'ids errados');
assert.deepStrictEqual(r.updates[0].patch, {
  teacherId: 'novoT', originalTeacherId: 'novoT', modalityId: 'novoM',
  startTime: '19:00', endTime: '20:00', durationMinutes: 60,
}, 'patch errado (originalTeacherId deve acompanhar o novo titular)');
console.log('✓ intocadas atualizadas, resto pulado (mês fechado/substituída/cancelada/passada)');

// nenhuma elegível (realizada não conta) e input vazio
const r2 = CP.planClassUpdatesForSlot(novoSlot, [{ id: 'x', status: 'realizada', monthClosingId: null, dateISO: '2026-07-30' }], hoje);
assert.strictEqual(r2.eligibleCount, 0, 'realizada não é elegível');
assert.deepStrictEqual(CP.planClassUpdatesForSlot(novoSlot, [], hoje).updates, [], 'lista vazia → sem updates');
console.log('✓ sem elegíveis → eligibleCount 0');

console.log('\n✅ smoke-class-propagation OK');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "C:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes" && node scripts/smoke-class-propagation.js`
Expected: FAIL — `Cannot find module '../class-propagation.js'`.

- [ ] **Step 3: Criar `class-propagation.js`:**

```js
// class-propagation.js — lógica pura: quais aulas de um slot editado atualizar.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ClassPropagation = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // novoSlot: { teacherId, modalityId, startTime, endTime, durationMinutes }
  // existingClasses: [{ id, status, monthClosingId, dateISO }]  (dateISO 'YYYY-MM-DD')
  // Retorna { updates: [{classId, patch}], eligibleCount } — só das aulas INTOCADAS:
  //   status 'prevista' + sem monthClosingId + dateISO >= hojeISO.
  function planClassUpdatesForSlot(novoSlot, existingClasses, hojeISO) {
    const updates = [];
    (existingClasses || []).forEach(c => {
      const intocada = c.status === 'prevista' && !c.monthClosingId && String(c.dateISO) >= String(hojeISO);
      if (!intocada) return;
      updates.push({
        classId: c.id,
        patch: {
          teacherId: novoSlot.teacherId,
          originalTeacherId: novoSlot.teacherId,
          modalityId: novoSlot.modalityId,
          startTime: novoSlot.startTime,
          endTime: novoSlot.endTime,
          durationMinutes: novoSlot.durationMinutes,
        },
      });
    });
    return { updates, eligibleCount: updates.length };
  }

  return { planClassUpdatesForSlot };
});
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node scripts/smoke-class-propagation.js`
Expected: PASS — termina com `✅ smoke-class-propagation OK`.

- [ ] **Step 5: Commit**

```bash
git add class-propagation.js scripts/smoke-class-propagation.js
git commit -m "feat(grade): planClassUpdatesForSlot (puro) — quais aulas propagar na edicao de slot"
```
(Terminar a mensagem com uma linha em branco seguida de `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Não usar `--no-verify`. Warnings de `.git/worktrees/*` "Permission denied" são cruft pré-existente — o commit entra; ignore.)

---

## Task 2: IO no `ClassService` + carregar o script

**Files:** Modify `professores-shared.js` (objeto `ClassService`, começa na linha 1241); Modify `professores.html`.

- [ ] **Step 1: LER** `professores-shared.js` em volta da linha 1241–1330 pra confirmar o estilo dos métodos do `ClassService` (async, `db.collection('classes')`, retorno `{success,...}`/`{success:false,error,code}`).

- [ ] **Step 2: Adicionar 2 métodos ao objeto `ClassService`** — inserir logo APÓS o método `getById` (fecha ~linha 1283, antes do bloco de comentário de `updateStatus`):

```js
  // Propagação opt-in da edição de grade: LÊ as aulas do slot e planeja quais
  // "intocadas" atualizar (via ClassPropagation puro). NÃO grava.
  async propagateSlotEditPlan(slotId, novoSlot) {
    if (!slotId) return { success: false, error: 'slotId obrigatório' };
    try {
      const snap = await db.collection('classes').where('slotId', '==', slotId).get();
      const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const aulas = snap.docs.map(d => {
        const c = d.data();
        const dt = (c.scheduledDate && c.scheduledDate.toDate) ? c.scheduledDate.toDate() : new Date(c.scheduledDate);
        const dateISO = dt.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        return { id: d.id, status: c.status, monthClosingId: c.monthClosingId || null, dateISO };
      });
      const { updates, eligibleCount } = ClassPropagation.planClassUpdatesForSlot(novoSlot, aulas, hojeISO);
      return { success: true, updates, eligibleCount };
    } catch (err) {
      console.error('[ClassService.propagateSlotEditPlan]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  // Aplica as atualizações planejadas via batch. updates: [{classId, patch}].
  async propagateSlotEditApply(updates) {
    if (!Array.isArray(updates) || updates.length === 0) return { success: true, updated: 0 };
    try {
      const batch = db.batch();
      updates.forEach(u => {
        batch.update(db.collection('classes').doc(u.classId), {
          ...u.patch, updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
      return { success: true, updated: updates.length };
    } catch (err) {
      console.error('[ClassService.propagateSlotEditApply]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
```

(Atenção: os métodos do objeto são separados por vírgula — garantir a vírgula após `getById` e após o novo `propagateSlotEditApply`, mantendo o objeto válido.)

- [ ] **Step 3: Carregar `class-propagation.js`** — em `professores.html`, localizar a linha `<script src="professores-shared.js"></script>` e inserir IMEDIATAMENTE ANTES dela:

```html
    <script src="class-propagation.js"></script>
```
(Ordem importa: `ClassService` referencia `ClassPropagation`.)

- [ ] **Step 4: Parse check**

Run: `cd "C:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes" && node -e "new Function(require('fs').readFileSync('professores-shared.js','utf8').replace(/^\xEF\xBB\xBF/,'')); const s=require('fs').readFileSync('professores.html','utf8'); if(!s.includes('class-propagation.js')) throw new Error('script tag ausente'); console.log('OK');" && node scripts/smoke-class-propagation.js >/dev/null && echo "smoke OK"`
Expected: `OK` e `smoke OK`.

- [ ] **Step 5: Commit**

```bash
git add professores-shared.js professores.html
git commit -m "feat(grade): ClassService.propagateSlotEdit{Plan,Apply} + carrega class-propagation.js"
```
(trailer `Co-Authored-By:` como na Task 1)

---

## Task 3: Hook no salvar-slot (`professores-agenda.js`)

**Files:** Modify `professores-agenda.js`. **LER** o entorno das linhas 500 e 555–600 antes (a função de salvar; `endMin`/`startMin` na linha ~500; ramo de edição em ~560–568; `toast(toastMsg)` em ~598).

- [ ] **Step 1: Inserir o hook** — no ramo de EDIÇÃO, logo APÓS a linha `toastMsg = 'Slot atualizado.';`, inserir:

```js
    // Propagação opt-in: se o dia da semana ficou igual e algum campo propagável
    // mudou, oferece atualizar as aulas futuras "intocadas" desse slot.
    const oldSlot = AgendaState.slots.find(s => s.id === SlotFormState.editingId) || {};
    const novoWeekday = SlotFormState.weekdays[0];
    const mudouCampo = oldSlot.teacherId !== teacherId || oldSlot.modalityId !== modalityId
                    || oldSlot.startTime !== startTime || oldSlot.endTime !== endTime;
    if (oldSlot.weekday === novoWeekday && mudouCampo) {
      const novoSlot = { teacherId, modalityId, startTime, endTime, durationMinutes: endMin - startMin };
      const plan = await ClassService.propagateSlotEditPlan(SlotFormState.editingId, novoSlot);
      if (plan.success && plan.eligibleCount > 0
          && confirm(`Aplicar também às ${plan.eligibleCount} próximas aulas já criadas?`)) {
        const ap = await ClassService.propagateSlotEditApply(plan.updates);
        if (ap.success) toastMsg = `Slot atualizado. ${ap.updated} aula(s) futura(s) atualizada(s).`;
        else toast('Slot salvo, mas falhou ao propagar: ' + (ap.error || ''), 'error');
      }
    }
```

(Contexto: `teacherId`, `modalityId`, `startTime`, `endTime`, `endMin`, `startMin` já estão no escopo da função de salvar; `AgendaState.slots` tem o slot antigo — mesmo padrão de `handleSlotToggleActive`.)

- [ ] **Step 2: Parse check + smokes**

Run: `cd "C:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes" && node -e "new Function(require('fs').readFileSync('professores-agenda.js','utf8').replace(/^\xEF\xBB\xBF/,'')); console.log('professores-agenda.js sintaxe OK')" && node scripts/smoke-class-propagation.js >/dev/null && echo "smoke OK"`
Expected: `professores-agenda.js sintaxe OK` e `smoke OK`.

- [ ] **Step 3: Commit**

```bash
git add professores-agenda.js
git commit -m "feat(grade): oferecer propagacao das aulas futuras ao salvar edicao de slot"
```
(trailer `Co-Authored-By:`)

---

## Task 4: Verificação final + E2E no staging

**Files:** nenhum (verificação). Sem deploy (prep — sobe junto com hosting quando o módulo for pra produção; produção só após homologação, CLAUDE.md §7).

- [ ] **Step 1: Suíte de smokes + parse**

```bash
cd "C:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes" && node scripts/smoke-class-propagation.js && node scripts/smoke-sidebar.js && node scripts/smoke-scale-service.js && node scripts/smoke-escala-frente3.js && node -e "new Function(require('fs').readFileSync('professores-agenda.js','utf8').replace(/^\xEF\xBB\xBF/,'')); new Function(require('fs').readFileSync('professores-shared.js','utf8').replace(/^\xEF\xBB\xBF/,'')); require('./class-propagation.js'); console.log('parse OK')"
```
Expected: todos verdes + `parse OK`.

- [ ] **Step 2: E2E no preview (servidor `crosstrainer-static`, fala com o staging)** — logar como `dono.teste@crosstainer.com` (admin), ir na **Agenda** (grade) da unidade CP:
- [ ] Editar um slot **do Marcos** (professorId `PhpOUDSxQzhFvn4WnXNB`) que tem aulas futuras `prevista` — trocar a **modalidade** e/ou o **horário** (manter o dia da semana) → Salvar.
- [ ] Aparece o confirm "Aplicar também às N próximas aulas já criadas?" → responder **Sim**.
- [ ] Toast mostra "Slot atualizado. N aula(s) futura(s) atualizada(s)."
- [ ] Conferir (via Minha Agenda do Marcos, ou Firestore com Admin SDK) que as aulas `prevista` futuras do slot mudaram os campos; e que **uma aula passada** e **uma substituída** (se houver) **NÃO** mudaram.
- [ ] Repetir editando o **dia da semana** de um slot → **não** aparece o confirm (propagação não é oferecida).
- [ ] Console limpo.

- [ ] **Step 3: (se algo falhar)** corrigir no fonte, re-rodar Step 1, re-verificar no preview, commitar o ajuste.

---

## Notas de execução

- **Sem CF, sem índice novo** (query por `slotId` é igualdade simples) — sobe com o hosting.
- Só **gestão** edita grade → o `classes.update` client-side é legítimo (firestore.rules:108). A proteção de **mês fechado** é da lógica (`!monthClosingId` no helper), não das rules — coberta pelo smoke.
- `writeBatch` ≤ 500 ops — folgado (~4-5 aulas/slot).
