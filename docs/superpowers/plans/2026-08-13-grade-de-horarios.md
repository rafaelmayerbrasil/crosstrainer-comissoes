# Grade de Horários — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renomear a Agenda Semanal para Grade de Horários, gerar aulas 8 semanas à frente, dar um botão de geração sob demanda, e fazer a troca de dia da semana mover as aulas futuras já criadas.

**Architecture:** A regra de "aula intocada" vira um predicado único em `class-propagation.js`, com cópia gêmea em `functions/` (o deploy das Functions só leva aquela pasta). A movimentação de aulas roda numa Cloud Function callable admin-only (`moveSlotClasses`) que apaga as intocadas e chama o gerador existente para recriar no dia novo — assim feriado, escala especial e férias continuam sendo respeitados de graça, e a regra de `delete` de `classes` não precisa ser afrouxada.

**Tech Stack:** JS vanilla (sem framework), Firebase Functions v2 (Node 22), Firestore, testes como scripts Node com `assert`.

**Spec:** `docs/superpowers/specs/2026-08-13-grade-de-horarios-design.md`

---

### Task 1: Predicado único de "aula intocada"

Hoje o critério está embutido dentro de `planClassUpdatesForSlot`. A CF nova precisa do mesmo critério, e duas definições que podem divergir são um bug esperando acontecer.

**Files:**
- Modify: `class-propagation.js`
- Create: `functions/class-propagation.js` (gêmeo — ver cabeçalho de `intern-hour-bank.js` para o padrão)
- Modify: `scripts/smoke-class-propagation.js`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao final de `scripts/smoke-class-propagation.js`, antes do `console.log` final:

```js
// ════════════ predicado isUntouchedClass ════════════
const HOJE = '2026-07-12';
assert.strictEqual(CP.isUntouchedClass({ status: 'prevista', monthClosingId: null, dateISO: '2026-07-20' }, HOJE), true, 'prevista futura sem fechamento é intocada');
assert.strictEqual(CP.isUntouchedClass({ status: 'prevista', monthClosingId: null, dateISO: HOJE }, HOJE), true, 'hoje conta como intocada');
assert.strictEqual(CP.isUntouchedClass({ status: 'prevista', monthClosingId: 'u_2026-07', dateISO: '2026-07-20' }, HOJE), false, 'mês fechado não é intocada');
assert.strictEqual(CP.isUntouchedClass({ status: 'substituida', monthClosingId: null, dateISO: '2026-07-20' }, HOJE), false, 'substituída não é intocada');
assert.strictEqual(CP.isUntouchedClass({ status: 'cancelada', monthClosingId: null, dateISO: '2026-07-20' }, HOJE), false, 'cancelada não é intocada');
assert.strictEqual(CP.isUntouchedClass({ status: 'realizada', monthClosingId: null, dateISO: '2026-07-20' }, HOJE), false, 'realizada não é intocada');
assert.strictEqual(CP.isUntouchedClass({ status: 'prevista', monthClosingId: null, dateISO: '2026-07-05' }, HOJE), false, 'passada não é intocada');
console.log('✓ isUntouchedClass aceita só prevista + sem fechamento + de hoje em diante');

// ════════════ as duas cópias não podem divergir ════════════
// O deploy das Functions leva só functions/, então existe um gêmeo lá.
// Comparar COMPORTAMENTO, não texto: os cabeçalhos diferem de propósito.
const CPF = require('../functions/class-propagation.js');
const casos = [
  { status: 'prevista',    monthClosingId: null,        dateISO: '2026-07-20' },
  { status: 'prevista',    monthClosingId: 'u_2026-07', dateISO: '2026-07-20' },
  { status: 'substituida', monthClosingId: null,        dateISO: '2026-07-20' },
  { status: 'cancelada',   monthClosingId: null,        dateISO: '2026-07-20' },
  { status: 'realizada',   monthClosingId: null,        dateISO: '2026-07-20' },
  { status: 'prevista',    monthClosingId: null,        dateISO: '2026-07-05' },
  { status: 'prevista',    monthClosingId: null,        dateISO: HOJE },
];
casos.forEach(c => {
  assert.strictEqual(CPF.isUntouchedClass(c, HOJE), CP.isUntouchedClass(c, HOJE),
    `as duas cópias divergiram em isUntouchedClass(${JSON.stringify(c)})`);
});
console.log('✓ cópia da raiz e cópia de functions/ concordam');
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node scripts/smoke-class-propagation.js`
Expected: FAIL — `TypeError: CP.isUntouchedClass is not a function`

- [ ] **Step 3: Implementar o predicado em `class-propagation.js`**

Substituir o corpo do módulo (mantendo o wrapper UMD) por:

```js
// class-propagation.js — lógica pura: quais aulas de um slot editado atualizar.
// GEMEO: functions/class-propagation.js — o deploy das Functions so leva a pasta
// functions/, entao existe uma copia la. smoke-class-propagation.js compara o
// comportamento das duas e falha se divergirem.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ClassPropagation = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // "Intocada" = ninguém mexeu nela e ela ainda vai acontecer.
  // Definição única do sistema: quem quiser mexer em aula gerada passa por aqui.
  //   c: { status, monthClosingId, dateISO }  ·  hojeISO: 'YYYY-MM-DD' (fuso BR)
  function isUntouchedClass(c, hojeISO) {
    if (!c) return false;
    return c.status === 'prevista'
        && !c.monthClosingId
        && String(c.dateISO) >= String(hojeISO);
  }

  // novoSlot: { teacherId, modalityId, startTime, endTime, durationMinutes }
  // existingClasses: [{ id, status, monthClosingId, dateISO }]  (dateISO 'YYYY-MM-DD')
  // Retorna { updates: [{classId, patch}], eligibleCount } — só das aulas INTOCADAS.
  function planClassUpdatesForSlot(novoSlot, existingClasses, hojeISO) {
    const updates = [];
    (existingClasses || []).forEach(c => {
      if (!isUntouchedClass(c, hojeISO)) return;
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

  return { isUntouchedClass, planClassUpdatesForSlot };
});
```

- [ ] **Step 4: Criar o gêmeo `functions/class-propagation.js`**

Cópia byte a byte do arquivo acima, trocando apenas as 3 linhas do cabeçalho por:

```js
// class-propagation.js — lógica pura: quais aulas de um slot editado atualizar.
// GEMEO: class-propagation.js na raiz (usado pelo navegador). Esta copia existe
// porque o deploy das Functions so leva a pasta functions/.
// smoke-class-propagation.js compara o comportamento das duas e falha se divergirem.
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `node scripts/smoke-class-propagation.js`
Expected: PASS, terminando em `✅ smoke-class-propagation OK`

- [ ] **Step 6: Commit**

```bash
git add class-propagation.js functions/class-propagation.js scripts/smoke-class-propagation.js
git commit -m "refactor(agenda): extrai isUntouchedClass como definicao unica + gemeo em functions/"
```

---

### Task 2: Horizonte de 8 semanas

**Files:**
- Modify: `functions/index.js` (cron ~linha 418, default da callable ~linha 462, comentário ~linha 406)

- [ ] **Step 1: Trocar o default da callable**

Em `functions/index.js`, dentro de `generateClassesManual`:

```js
  const weeksAhead = Number.isFinite(data.weeksAhead) && data.weeksAhead > 0 && data.weeksAhead <= 52
    ? Math.floor(data.weeksAhead)
    : 8;
```

- [ ] **Step 2: Trocar o cron e o comentário**

Substituir o bloco do agendado:

```js
/**
 * Scheduled — roda toda segunda às 02:00 BRT e gera as próximas 8 semanas.
 * Schedule cron: minuto 0, hora 2, dia qualquer, mês qualquer, dia-semana 1 (segunda).
 *
 * 8 semanas (e não 4) por decisão do Rodrigo em 13/08/2026: é o mesmo horizonte
 * da janela de eleição da escala inteligente de sábados e feriados. Se mudar
 * aqui, mudar lá também — os dois horizontes devem continuar batendo.
 */
exports.generateClassesForUpcomingWeeks = onSchedule({
  schedule: '0 2 * * 1',
  timeZone: 'America/Sao_Paulo',
  memory: '256MiB',
  timeoutSeconds: 540,
}, async (event) => {
  logger.info('[generateClassesForUpcomingWeeks] Iniciando geração agendada');
  try {
    const result = await generateClassesCore({
      weeksAhead: 8,
      dryRun: false,
      source: 'cf-scheduled',
    });
```

- [ ] **Step 3: Ajustar o default do core e seu JSDoc**

Na assinatura de `generateClassesCore`:

```js
 * @param {number} opts.weeksAhead — quantas semanas à frente gerar (default 8)
```
```js
async function generateClassesCore({ weeksAhead = 8, dryRun = false, source = 'cf-manual' } = {}) {
```

- [ ] **Step 4: Verificar que não sobrou "4 semanas" na documentação da geração**

Run: `grep -n "4 semanas\|weeksAhead = 4\|weeksAhead: 4" functions/index.js`
Expected: nenhuma linha (saída vazia)

- [ ] **Step 5: Commit**

```bash
git add functions/index.js
git commit -m "feat(agenda): gera 8 semanas a frente em vez de 4 (mesmo horizonte da escala)"
```

---

### Task 3: Cloud Function `moveSlotClasses`

**Files:**
- Modify: `functions/index.js` (adicionar após `generateClassesManual`)

- [ ] **Step 1: Importar o gêmeo no topo do arquivo**

Junto dos outros `require` de `functions/index.js`:

```js
const classPropagation = require('./class-propagation.js');
```

- [ ] **Step 2: Escrever a função**

Acrescentar em `functions/index.js`, logo depois do bloco de `generateClassesManual`:

```js
// ═══════════════════════════════════════════════════════════════════════
// Troca de dia da semana de um slot — move as aulas futuras intocadas
// ═══════════════════════════════════════════════════════════════════════
//
// Por que apagar e regerar em vez de mudar a data das aulas existentes:
// o classId embute a data (`${slotId}_${YYYYMMDD}`). Alterar a data por dentro
// deixaria o id inconsistente com o conteúdo, e a geração — que é idempotente
// POR ESSE ID — criaria uma segunda aula na data nova. Duplicata garantida.
//
// Por que no servidor: a rule de `classes` só permite delete de aula de escala
// especial, de propósito (proteção do fechamento). Em vez de afrouxar a rule,
// a operação roda aqui com Admin SDK, restrita a admin.
exports.moveSlotClasses = onCall({
  memory: '256MiB',
  timeoutSeconds: 540,
}, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'É preciso estar autenticado.');
  }
  const userDoc = await db().collection('users').doc(request.auth.uid).get();
  if (!userDoc.exists) {
    throw new HttpsError('permission-denied', 'Usuário sem perfil cadastrado.');
  }
  const userData = userDoc.data();
  const profiles = userData.profiles || (userData.role ? [userData.role] : []);
  if (!profiles.includes('admin') && !profiles.includes('admin_gestao')) {
    throw new HttpsError('permission-denied', 'Apenas admin/gestão pode mover aulas.');
  }

  const data = request.data || {};
  const slotId = String(data.slotId || '').trim();
  const dryRun = data.dryRun === true;
  if (!slotId) throw new HttpsError('invalid-argument', 'slotId obrigatório.');

  const t0 = Date.now();
  const firestore = db();

  const slotDoc = await firestore.collection('schedule_slots').doc(slotId).get();
  if (!slotDoc.exists) throw new HttpsError('not-found', 'Slot não encontrado.');

  const hojeISO = ymdISOFromDateBR(new Date());
  const snap = await firestore.collection('classes').where('slotId', '==', slotId).get();

  const paraApagar = [];
  let skipped = 0;
  snap.docs.forEach(d => {
    const c = d.data();
    const dt = c.scheduledDate && c.scheduledDate.toDate ? c.scheduledDate.toDate() : new Date(c.scheduledDate);
    const alvo = { status: c.status, monthClosingId: c.monthClosingId || null, dateISO: ymdISOFromDateBR(dt) };
    if (classPropagation.isUntouchedClass(alvo, hojeISO)) paraApagar.push(d.id);
    else skipped++;
  });

  if (dryRun) {
    return { deleted: paraApagar.length, created: 0, skipped, dryRun: true, durationMs: Date.now() - t0 };
  }

  const BATCH_LIMIT = 400;
  for (let i = 0; i < paraApagar.length; i += BATCH_LIMIT) {
    const batch = firestore.batch();
    paraApagar.slice(i, i + BATCH_LIMIT).forEach(id => batch.delete(firestore.collection('classes').doc(id)));
    await batch.commit();
  }
  logger.info('[moveSlotClasses] apagadas', { slotId, deleted: paraApagar.length, skipped });

  // Regera. O gerador é idempotente e já respeita feriado, escala especial e
  // férias — por isso reaproveitá-lo é mais seguro do que mover na mão.
  const gen = await generateClassesCore({ weeksAhead: 8, dryRun: false, source: 'cf-move-slot' });

  return {
    deleted: paraApagar.length,
    created: gen.created,
    skipped,
    dryRun: false,
    durationMs: Date.now() - t0,
  };
});
```

- [ ] **Step 3: Registrar a função no cabeçalho do arquivo**

Na lista de funções implementadas, acrescentar:

```
//   ✅ moveSlotClasses (callable) .............. 13/08/2026
```

- [ ] **Step 4: Verificar que `ymdISOFromDateBR` existe antes de usar**

Run: `grep -n "function ymdISOFromDateBR" functions/index.js`
Expected: uma linha com a definição. Se não existir, PARE — a função foi renomeada e o código acima precisa usar o nome real.

- [ ] **Step 5: Checar sintaxe**

Run: `node --check functions/index.js`
Expected: sem saída (sucesso)

- [ ] **Step 6: Commit**

```bash
git add functions/index.js
git commit -m "feat(agenda): CF moveSlotClasses — apaga aulas intocadas e regera no dia novo"
```

---

### Task 4: Serviços no cliente

**Files:**
- Modify: `professores-shared.js` (dentro de `ClassService`, após `propagateSlotEditApply`, ~linha 1396)

- [ ] **Step 1: Adicionar os dois métodos**

```js
  /**
   * Troca de dia da semana: apaga as aulas futuras intocadas do slot e regera.
   * Roda numa Cloud Function porque a rule de `classes` não permite delete de
   * aula da grade pelo cliente (proteção do fechamento) — ver spec de 13/08/2026.
   * dryRun: true devolve as contagens sem escrever nada (é o que monta a pergunta).
   */
  async moveSlotClasses(slotId, { dryRun = false } = {}) {
    if (!slotId) return { success: false, error: 'slotId obrigatório' };
    try {
      const callable = firebase.functions().httpsCallable('moveSlotClasses');
      const res = await callable({ slotId, dryRun });
      return { success: true, ...(res.data || {}) };
    } catch (err) {
      console.error('[ClassService.moveSlotClasses]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  /** Dispara a geração de aulas sob demanda (admin). */
  async generateNow(weeksAhead = 8) {
    try {
      const callable = firebase.functions().httpsCallable('generateClassesManual');
      const res = await callable({ weeksAhead });
      return { success: true, ...(res.data || {}) };
    } catch (err) {
      console.error('[ClassService.generateNow]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
```

- [ ] **Step 2: Checar sintaxe**

Run: `node --check professores-shared.js`
Expected: sem saída

- [ ] **Step 3: Commit**

```bash
git add professores-shared.js
git commit -m "feat(agenda): ClassService.moveSlotClasses e generateNow"
```

---

### Task 5: Botão "Gerar agenda agora"

**Files:**
- Modify: `professores-agenda.js` (toolbar ~linha 308; função nova junto das outras ações)

- [ ] **Step 1: Adicionar o botão na toolbar**

Substituir a linha do botão `+ Novo slot` por:

```html
        <button class="btn btn-outline btn-sm" id="btnGerarAgenda" onclick="gerarAgendaAgora()"
          title="Cria as aulas das próximas 8 semanas sem esperar a geração automática de segunda-feira">⚡ Gerar agenda agora</button>
        <button class="btn btn-primary btn-sm" onclick="openSlotModal(null)">+ Novo slot</button>
```

- [ ] **Step 2: Implementar a função**

Acrescentar em `professores-agenda.js`, antes de `function renderWeeklyGrid`:

```js
// Geração sob demanda. A automática roda toda segunda às 02:00; este botão existe
// pra quem acabou de cadastrar horário novo e não quer esperar até segunda.
async function gerarAgendaAgora() {
  if (!isAdminGestao()) {
    toast('Apenas a administração pode gerar a agenda.', 'error');
    return;
  }
  if (!confirm('Gerar as aulas das próximas 8 semanas agora?\n\nAulas que já existem não são duplicadas.')) return;

  const btn = document.getElementById('btnGerarAgenda');
  const textoOriginal = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Gerando…'; }

  const res = await ClassService.generateNow(8);

  if (btn) { btn.disabled = false; btn.innerHTML = textoOriginal; }

  if (!res.success) {
    toast('Não consegui gerar: ' + (res.error || 'erro desconhecido'), 'error', 7000);
    return;
  }
  toast(res.created > 0
    ? `${res.created} aula(s) criada(s) nas próximas 8 semanas.`
    : 'Nenhuma aula nova — a agenda das próximas 8 semanas já estava completa.', 'success', 6000);
}
```

- [ ] **Step 3: Checar sintaxe**

Run: `node --check professores-agenda.js`
Expected: sem saída

- [ ] **Step 4: Commit**

```bash
git add professores-agenda.js
git commit -m "feat(agenda): botao Gerar agenda agora na Grade de Horarios"
```

---

### Task 6: Troca de dia da semana

**Files:**
- Modify: `professores-agenda.js` (`renderSlotWeekdayChips` ~481, `setSlotWeekday` ~520, `saveSlot` ~681)

- [ ] **Step 1: Destravar os chips em edição (seleção única)**

Substituir `renderSlotWeekdayChips` por:

```js
function renderSlotWeekdayChips() {
  const wrap = document.getElementById('slotWeekdayChips');
  if (!wrap) return;
  const isEditing = !!SlotFormState.editingId;

  wrap.innerHTML = WEEKDAY_ORDER.map(w => {
    const isSelected = SlotFormState.weekdays.includes(w);
    const cls = ['chip-toggle'];
    if (isSelected) cls.push('selected');
    const title = isEditing
      ? (isSelected ? 'Dia atual deste horário' : 'Clique para mover este horário para cá')
      : (isSelected ? 'Clique para remover' : 'Clique para adicionar');
    return `<span class="${cls.join(' ')}" data-weekday="${w}" onclick="setSlotWeekday(${w})" title="${title}">${ProfHelpers.WEEKDAY_LABEL_SHORT[w]}</span>`;
  }).join('');

  const hint = document.getElementById('slotWeekdayHint');
  if (hint) {
    if (isEditing) {
      const original = SlotFormState.originalWeekday;
      const atual = SlotFormState.weekdays[0];
      hint.textContent = atual === original
        ? `Dia atual: ${ProfHelpers.WEEKDAY_LABEL[atual].toUpperCase()}. Clique em outro dia para mover este horário.`
        : `Vai mudar de ${ProfHelpers.WEEKDAY_LABEL[original].toUpperCase()} para ${ProfHelpers.WEEKDAY_LABEL[atual].toUpperCase()} — as aulas futuras acompanham (o sistema confirma antes).`;
    } else {
      const dias = SlotFormState.weekdays.slice().sort((a, b) => a - b)
        .map(w => ProfHelpers.WEEKDAY_LABEL[w]);
      const n = dias.length;
      hint.textContent = n === 0
        ? '⚠ Selecione ao menos um dia.'
        : n === 1
          ? `Será criado em: ${dias[0].toUpperCase()} · clique em outros dias para criar em lote.`
          : `Serão criados ${n} slots: ${dias.join(', ').toUpperCase()}.`;
    }
  }
}
```

- [ ] **Step 2: Trocar o comportamento de clique**

Substituir `setSlotWeekday` por:

```js
function setSlotWeekday(w) {
  if (SlotFormState.editingId) {
    // Edição mexe em UM slot: seleção única, clicar em outro dia move.
    SlotFormState.weekdays = [w];
    renderSlotWeekdayChips();
    return;
  }
  const idx = SlotFormState.weekdays.indexOf(w);
  if (idx >= 0) SlotFormState.weekdays.splice(idx, 1);  // toggle off
  else SlotFormState.weekdays.push(w);                   // toggle on
  renderSlotWeekdayChips();
}
```

- [ ] **Step 3: Guardar o dia original ao abrir o modal**

Em `openSlotModal`, logo após a linha que define `SlotFormState.weekdays`:

```js
  SlotFormState.weekdays = editing ? [editing.weekday] : [SlotFormState.lastWeekday || 1];
  SlotFormState.originalWeekday = editing ? editing.weekday : null;
```

E acrescentar o campo na declaração de `SlotFormState`:

```js
const SlotFormState = {
  editingId: null,
  weekdays: [1],   // CRIAÇÃO aceita múltiplos dias (lança N slots em lote).
                   // EDIÇÃO usa seleção única: trocar o dia move o horário.
  originalWeekday: null,  // dia com que o modal abriu — detecta a troca no save
  lastWeekday: 1,  // último dia usado na sessão — vira o padrão do próximo slot
};
```

- [ ] **Step 4: Tratar a troca no save**

Em `saveSlot`, substituir o bloco `if (SlotFormState.editingId) { ... }` (que começa em ~681) por:

```js
  if (SlotFormState.editingId) {
    // EDIÇÃO: só 1 slot.
    const oldSlot = AgendaState.slots.find(s => s.id === SlotFormState.editingId) || {};
    const novoWeekday = SlotFormState.weekdays[0];
    const mudouDia = oldSlot.weekday !== undefined && oldSlot.weekday !== novoWeekday;

    // Troca de dia: perguntar ANTES de gravar qualquer coisa. Se a pessoa
    // cancelar, nada é salvo — salvar a grade e deixar as aulas no dia velho
    // é exatamente a inconsistência que motivou esta mudança.
    let moverAulas = false;
    if (mudouDia) {
      const previa = await ClassService.moveSlotClasses(SlotFormState.editingId, { dryRun: true });
      if (!previa.success) {
        btn.disabled = false; btn.textContent = 'Salvar';
        errEl.textContent = 'Não consegui verificar as aulas deste horário: ' + (previa.error || '');
        return;
      }
      const de = ProfHelpers.WEEKDAY_LABEL[oldSlot.weekday];
      const para = ProfHelpers.WEEKDAY_LABEL[novoWeekday];
      if (previa.deleted > 0) {
        const ok = confirm(
          `Você está mudando de ${de} para ${para}.\n\n` +
          `Existem ${previa.deleted} aula(s) futura(s) na ${de}. Elas serão movidas para a ${para}.\n` +
          `Aulas já substituídas, canceladas ou de mês fechado ficam onde estão.\n\n` +
          `Confirma?`
        );
        if (!ok) { btn.disabled = false; btn.textContent = 'Salvar'; return; }
        moverAulas = true;
      }
      // Sem aula futura intocada → não pergunta nada, mas AINDA ASSIM chama o
      // move depois de salvar: é ele que regera as aulas no dia novo. Sem isso,
      // o dia novo ficaria vazio até a geração automática de segunda-feira.
      moverAulas = true;
    }

    const slotData = { ...baseSlotData, weekday: novoWeekday };
    const res = await ScheduleSlotService.update(SlotFormState.editingId, slotData);
    if (!res.success) {
      btn.disabled = false; btn.textContent = 'Salvar';
      errEl.textContent = res.error || 'Erro ao salvar.'; return;
    }
    toastMsg = 'Slot atualizado.';

    if (moverAulas) {
      btn.textContent = 'Movendo aulas…';
      const mv = await ClassService.moveSlotClasses(SlotFormState.editingId, { dryRun: false });
      if (mv.success) {
        toastMsg = mv.deleted > 0
          ? `Horário movido para ${ProfHelpers.WEEKDAY_LABEL[novoWeekday]}. ${mv.deleted} aula(s) movida(s).`
          : `Horário movido para ${ProfHelpers.WEEKDAY_LABEL[novoWeekday]}.`;
      } else {
        toast('Horário salvo, mas falhou ao mover as aulas: ' + (mv.error || ''), 'error', 7000);
      }
    } else if (!mudouDia) {
      // Mesmo dia: propagação in-place dos outros campos (comportamento de 12/07).
      const mudouCampo = oldSlot.teacherId !== teacherId || oldSlot.modalityId !== modalityId
                      || oldSlot.startTime !== startTime || oldSlot.endTime !== endTime;
      if (mudouCampo) {
        const novoSlot = { teacherId, modalityId, startTime, endTime, durationMinutes: endMin - startMin };
        const plan = await ClassService.propagateSlotEditPlan(SlotFormState.editingId, novoSlot);
        if (plan.success && plan.eligibleCount > 0
            && confirm(`Aplicar também às ${plan.eligibleCount} próximas aulas já criadas?`)) {
          const ap = await ClassService.propagateSlotEditApply(plan.updates);
          if (ap.success) toastMsg = `Slot atualizado. ${ap.updated} aula(s) futura(s) atualizada(s).`;
          else toast('Slot salvo, mas falhou ao propagar: ' + (ap.error || ''), 'error');
        }
      }
    }
  } else {
```

- [ ] **Step 5: Checar sintaxe**

Run: `node --check professores-agenda.js`
Expected: sem saída

- [ ] **Step 6: Commit**

```bash
git add professores-agenda.js
git commit -m "feat(agenda): troca de dia da semana move as aulas futuras, perguntando antes"
```

---

### Task 7: Renome para "Grade de Horários"

**Files:**
- Modify: `professores-nav.js:24`
- Modify: `professores-agenda.js` (3 títulos: ~95, ~129, ~288)
- Modify: `professores-ajuda.js:64-68`

- [ ] **Step 1: Renomear o item de menu**

Em `professores-nav.js`, trocar a linha 24 por:

```js
    { id: 'agenda',         label: 'Grade de Horários', icon: '📅', section: 'Agenda' },
```

O `id` continua `agenda` — trocá-lo quebraria deep-links, o mapa da ajuda e as listas de permissão por perfil, sem ganho nenhum para o usuário.

- [ ] **Step 2: Renomear os títulos da tela**

Em `professores-agenda.js`, trocar as 3 ocorrências de `<h2>AGENDA SEMANAL</h2>` por `<h2>GRADE DE HORÁRIOS</h2>`.

Run para confirmar: `grep -c "GRADE DE HORÁRIOS" professores-agenda.js`
Expected: `3`

- [ ] **Step 3: Atualizar a ajuda**

Em `professores-ajuda.js`, substituir o bloco `'agenda'` por:

```js
  'agenda': {
    titulo: 'Grade de Horários',
    texto: 'Esta é a grade fixa da semana: qual professor dá qual aula, em que dia e horário. '
         + 'As aulas do dia a dia são geradas automaticamente a partir daqui — toda segunda, para as 8 semanas seguintes. '
         + 'Com pressa? O botão "Gerar agenda agora" cria as aulas na hora. '
         + 'Mudou um horário? O sistema pergunta se você quer aplicar às aulas futuras já criadas. '
         + 'Trocou o dia da semana? As aulas futuras são movidas junto, também com confirmação. '
         + 'Em qualquer caso, aula já substituída, cancelada ou de mês fechado nunca é alterada.',
  },
```

- [ ] **Step 4: Confirmar que não sobrou nome antigo visível**

Run: `grep -rn "AGENDA SEMANAL\|Agenda Semanal" professores-agenda.js professores-nav.js professores-ajuda.js professores.html professores-shared.js`
Expected: só comentários de código (linhas iniciadas por `//` ou `/*`). Nenhum texto que apareça na tela.

- [ ] **Step 5: Rodar a suíte que protege o visual**

Run: `node scripts/smoke-css-vars.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add professores-nav.js professores-agenda.js professores-ajuda.js
git commit -m "feat(agenda): renomeia Agenda Semanal para Grade de Horarios (menu, telas e ajuda)"
```

---

### Task 8: Validação em staging

Nada vai para produção sem isto (CLAUDE.md §7).

**Files:**
- Create: `scripts/smoke-grade-horarios.js`

- [ ] **Step 1: Escrever o smoke de integração**

```js
'use strict';
// Prova em STAGING que a troca de dia move só as aulas intocadas.
// Fixture própria, cleanup completo. Uso: node scripts/smoke-grade-horarios.js
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const CP = require('../class-propagation.js');

const PROJECT = 'crosstrainer-comissoes-staging';
const svcPath = path.join(__dirname, 'serviceAccount-staging.json');
if (!fs.existsSync(svcPath)) { console.error('Falta scripts/serviceAccount-staging.json'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(svcPath)), projectId: PROJECT });
const db = admin.firestore();

let fails = 0, checks = 0;
const expect = (desc, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want); checks++; if (!ok) fails++;
  console.log(`${ok ? '✓' : '✗'} ${desc} — esperado ${JSON.stringify(want)}, veio ${JSON.stringify(got)}`);
};

const SLOT = 'zzgrade_slot';
const criados = [SLOT];

(async () => {
  const hoje = new Date();
  const d = n => { const x = new Date(hoje); x.setDate(x.getDate() + n); return x; };

  await db.collection('schedule_slots').doc(SLOT).set({
    unitId: 'zzgrade_unit', weekday: 2, startTime: '07:00', endTime: '08:00',
    teacherId: 'zzgrade_t', modalityId: 'zzgrade_m', isActive: true, _fixture: true,
  });

  const aulas = [
    ['zzgrade_c1', 'prevista',    null,            d(7)],   // intocada → some
    ['zzgrade_c2', 'prevista',    null,            d(14)],  // intocada → some
    ['zzgrade_c3', 'substituida', null,            d(7)],   // fica
    ['zzgrade_c4', 'cancelada',   null,            d(14)],  // fica
    ['zzgrade_c5', 'prevista',    'zz_2026-08',    d(7)],   // mês fechado → fica
    ['zzgrade_c6', 'prevista',    null,            d(-7)],  // passada → fica
  ];
  for (const [id, status, closing, data] of aulas) {
    await db.collection('classes').doc(id).set({
      slotId: SLOT, status, monthClosingId: closing, scheduledDate: data,
      unitId: 'zzgrade_unit', teacherId: 'zzgrade_t', _fixture: true,
    });
    criados.push(id);
  }
  console.log('fixture criada\n');

  try {
    // Espelha o que a CF faz, usando o MESMO predicado — se a CF divergir daqui,
    // o smoke autenticado da UI pega; aqui garantimos a regra.
    const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const snap = await db.collection('classes').where('slotId', '==', SLOT).get();
    const intocadas = [], mantidas = [];
    snap.docs.forEach(doc => {
      const c = doc.data();
      const dt = c.scheduledDate.toDate ? c.scheduledDate.toDate() : new Date(c.scheduledDate);
      const alvo = { status: c.status, monthClosingId: c.monthClosingId || null,
                     dateISO: dt.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) };
      (CP.isUntouchedClass(alvo, hojeISO) ? intocadas : mantidas).push(doc.id);
    });

    expect('só as 2 intocadas são movidas', intocadas.sort(), ['zzgrade_c1', 'zzgrade_c2']);
    expect('as outras 4 ficam onde estão', mantidas.sort(),
      ['zzgrade_c3', 'zzgrade_c4', 'zzgrade_c5', 'zzgrade_c6']);
  } finally {
    console.log('\nlimpando fixture...');
    for (const id of criados) {
      await db.collection(id === SLOT ? 'schedule_slots' : 'classes').doc(id).delete();
    }
    console.log('fixture removida');
  }

  console.log(`\n${checks - fails}/${checks} verificações passaram`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
```

- [ ] **Step 2: Rodar o smoke**

Run: `node scripts/smoke-grade-horarios.js`
Expected: `2/2 verificações passaram` e "fixture removida"

- [ ] **Step 3: Rodar a suíte inteira**

Run: `node scripts/smoke-class-propagation.js && node scripts/smoke-css-vars.js && node scripts/smoke-config-lock.js`
Expected: todos PASS

- [ ] **Step 4: Deploy no staging**

```bash
firebase deploy --only functions:generateClassesManual,functions:generateClassesForUpcomingWeeks,functions:moveSlotClasses --project staging
firebase deploy --only hosting --project staging
```
Expected: `Deploy complete!` nas duas

- [ ] **Step 5: E2E autenticado contra a CF de verdade**

O smoke do Step 1 prova a *regra*; este prova a *função no ar* — inclusive as duas
coisas que só aparecem chamando de verdade: que não sobra aula duplicada, e que
quem não é admin leva porta na cara.

Criar `scripts/validate-move-slot-classes.js`:

```js
'use strict';
// E2E da CF moveSlotClasses em STAGING. Uso: node scripts/validate-move-slot-classes.js
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const PROJECT = 'crosstrainer-comissoes-staging';
const REGION = 'us-central1';
const svcPath = path.join(__dirname, 'serviceAccount-staging.json');
if (!fs.existsSync(svcPath)) { console.error('Falta scripts/serviceAccount-staging.json'); process.exit(1); }
const cfg = fs.readFileSync(path.join(__dirname, '..', 'firebase-config.js'), 'utf8');
const apiKey = (cfg.match(/apiKey:\s*['"]([^'"]+)['"][\s\S]{0,120}?crosstrainer-comissoes-staging/) || [])[1];
if (!apiKey) { console.error('não achei a apiKey do staging'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(svcPath)), projectId: PROJECT });
const db = admin.firestore();

const ADMIN = { email: 'dono.teste@crosstainer.com', pass: 'crosstainer2026' };
const PROF  = { email: 'professor.teste@crosstainer.com', pass: 'crosstainer2026' };

let fails = 0, checks = 0;
const expect = (desc, got, want) => {
  const ok = got === want; checks++; if (!ok) fails++;
  console.log(`${ok ? '✓' : '✗'} ${desc} — esperado ${want}, veio ${got}`);
};
async function signIn(email, password) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const j = await r.json();
  if (!j.idToken) throw new Error('login falhou: ' + ((j.error && j.error.message) || '?'));
  return j.idToken;
}
async function chamar(idToken, payload) {
  const r = await fetch(`https://${REGION}-${PROJECT}.cloudfunctions.net/moveSlotClasses`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ data: payload }) });
  return { status: r.status, body: await r.json() };
}

const SLOT = 'zzmove_slot';
(async () => {
  const hoje = new Date();
  const d = n => { const x = new Date(hoje); x.setDate(x.getDate() + n); return x; };
  await db.collection('schedule_slots').doc(SLOT).set({
    unitId: 'zzmove_unit', weekday: 3, startTime: '07:00', endTime: '08:00',
    teacherId: 'zzmove_t', modalityId: 'zzmove_m', isActive: true, _fixture: true });
  await db.collection('classes').doc('zzmove_c1').set({
    slotId: SLOT, status: 'prevista', monthClosingId: null, scheduledDate: d(7),
    unitId: 'zzmove_unit', teacherId: 'zzmove_t', _fixture: true });
  await db.collection('classes').doc('zzmove_c2').set({
    slotId: SLOT, status: 'cancelada', monthClosingId: null, scheduledDate: d(14),
    unitId: 'zzmove_unit', teacherId: 'zzmove_t', _fixture: true });
  console.log('fixture criada\n');

  try {
    const tkProf = await signIn(PROF.email, PROF.pass);
    const negado = await chamar(tkProf, { slotId: SLOT, dryRun: true });
    expect('professor NÃO pode mover aulas', negado.status !== 200, true);

    const tkAdmin = await signIn(ADMIN.email, ADMIN.pass);
    const seco = await chamar(tkAdmin, { slotId: SLOT, dryRun: true });
    expect('dryRun conta 1 intocada', seco.body?.result?.deleted, 1);
    expect('dryRun pula a cancelada', seco.body?.result?.skipped, 1);

    const antes = await db.collection('classes').where('slotId', '==', SLOT).get();
    expect('dryRun não apagou nada', antes.size, 2);

    const real = await chamar(tkAdmin, { slotId: SLOT, dryRun: false });
    expect('move real apaga a intocada', real.body?.result?.deleted, 1);

    const depois = await db.collection('classes').where('slotId', '==', SLOT).get();
    const porData = new Map();
    depois.docs.forEach(doc => {
      const dt = doc.data().scheduledDate.toDate();
      const k = dt.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      porData.set(k, (porData.get(k) || 0) + 1);
    });
    expect('nenhuma data com aula duplicada', [...porData.values()].every(n => n === 1), true);
    expect('a cancelada continua lá', depois.docs.some(x => x.id === 'zzmove_c2'), true);
  } finally {
    console.log('\nlimpando fixture...');
    const restos = await db.collection('classes').where('slotId', '==', SLOT).get();
    for (const doc of restos.docs) await doc.ref.delete();
    await db.collection('schedule_slots').doc(SLOT).delete();
    console.log('fixture removida');
  }
  console.log(`\n${checks - fails}/${checks} verificações passaram`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
```

Run: `node scripts/validate-move-slot-classes.js`
Expected: `7/7 verificações passaram`

Sobre feriado e férias no dia novo: são garantidos **por construção**, não por teste
próprio — quem cria as aulas é o `generateClassesCore`, que já trata os dois e já é
coberto pelos testes da Sprint 3a/6a. Reaproveitá-lo foi justamente a razão de
apagar-e-regerar em vez de mover na mão.

- [ ] **Step 6: Roteiro manual no staging (a fazer COM o usuário)**

1. Menu mostra **Grade de Horários**; o título da tela também.
2. Botão **⚡ Gerar agenda agora** → confirma → mostra quantas aulas criou.
3. Abrir um horário existente: os dias agora são clicáveis; clicar em outro dia muda o texto de ajuda abaixo dos chips.
4. Salvar com dia trocado → aparece a pergunta com o número certo de aulas.
5. **Cancelar** → nada muda (conferir que o dia do horário continua o antigo na grade).
6. **Confirmar** → o horário muda de dia e as aulas aparecem no dia novo na Agenda Geral.
7. Abrir a ajuda (`?`) da tela → texto novo, sem "ajusta na Agenda Geral".

- [ ] **Step 7: Commit**

```bash
git add scripts/smoke-grade-horarios.js scripts/validate-move-slot-classes.js
git commit -m "test(agenda): smoke da regra + E2E da CF moveSlotClasses no staging"
```

---

## Depois do plano

Produção **só** após o roteiro manual homologado e OK explícito do usuário (CLAUDE.md §7). O deploy de produção é:

```bash
firebase deploy --only functions:generateClassesManual,functions:generateClassesForUpcomingWeeks,functions:moveSlotClasses --project production
git push origin main
```

Lembrar: o site dos usuários é o GitHub Pages servindo o `main`, então o `git push` é o que publica o front. O `firebase deploy --only hosting` não entrega.
