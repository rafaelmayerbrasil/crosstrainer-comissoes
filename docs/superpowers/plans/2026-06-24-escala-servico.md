# Escala Inteligente — Serviço/Persistência (Plano 5a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir `scale-service.js` — a camada que persiste a escala especial no Firestore (escalas com slots/template, preferências dos colaboradores, contador de justiça) e orquestra a consolidação reusando `ScaleEngine` (puro, já testado). Validado por smoke Node com Firestore fake.

**Architecture:** Serviço UMD com injeção de dependência (igual `engagement-service.js`): cada método aceita `deps` opcional (`{ db, ts, uid, SE }`); no browser cai nos globais, no Node o smoke injeta fake + `ScaleEngine`. A montagem de candidatos é uma função **pura** (`buildCandidates`) testável sem db. Regras Firestore das novas coleções + UI ficam para os planos seguintes (5b/5c).

**Tech Stack:** JavaScript vanilla (UMD), Node `assert`, fake firestore (`scripts/_fake-firestore.js`, já existe — estender se faltar método).

**Spec:** `docs/superpowers/specs/2026-06-24-engajamento-pontos-escala-design.md` §4.5–4.7, §6. **Depende do Plano 4** (`scale-engine.js` exporta `consolidate(slots, candidates, opts)`).

---

## File Structure

- `scale-service.js` (criar, raiz) — `ScaleService`: CRUD de escalas + template, preferências, fairness, `buildCandidates` (puro) e `consolidate` (orquestra). Responsabilidade única: ponte entre `ScaleEngine` e o Firestore.
- `scripts/smoke-scale-service.js` (criar) — smoke com fake firestore (cresce a cada task).
- `scripts/_fake-firestore.js` (modificar SE necessário) — já tem collection/doc/get/set/add/where/orderBy/batch/delete.

### Coleções (spec §4.5–4.7), todas com `externalId` vazio (futuro Pacto)
- `special_scales/{id}`: `{ date, name, tipo, status, slots:[{id,unitId,requiredModalityId,assignedPersonId}], externalId }` · `tipo` ∈ {sabado,feriado,domingo_especial,evento,fim_de_ano} · `status` ∈ {rascunho,janela_aberta,consolidada}.
- `scale_preferences/{scaleId__personId}`: `{ scaleId, personId, pref }` · `pref` ∈ {quer,nao_quer,nao_posso}.
- `fairness_counter/{personId}`: `{ personId, diasTrabalhados, divida }`.

---

### Task 1: `scale-service.js` — CRUD de escala + template + transições de status

**Files:**
- Create: `scale-service.js`
- Test: `scripts/smoke-scale-service.js`

`templateSlots(tipo, units)` (puro): para `sabado`/`feriado`/`domingo_especial`, gera por unidade 2 slots (`requiredModalityId: 'TOI'` e `'HIIT'`); para `evento`/`fim_de_ano`, retorna `[]` (montado à mão depois). Slot id = `${unitId}_${mod}`.

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
// Roda: node scripts/smoke-scale-service.js
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const SE = require('../scale-engine.js');
const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'tester', SE });

(async () => {
  // templateSlots (puro)
  const slots = SS.templateSlots('sabado', [{ id: 'cp' }, { id: 'norte' }]);
  assert.strictEqual(slots.length, 4, '2 unidades x 2 papéis = 4 slots');
  assert.deepStrictEqual(slots.find(s => s.id === 'cp_TOI'), { id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: null });
  assert.strictEqual(SS.templateSlots('evento', [{ id: 'cp' }]).length, 0, 'evento sem template');

  const db = makeFakeDb();
  const d = deps(db);
  // createScale
  const cRes = await SS.createScale({ date: '2026-07-04', tipo: 'sabado', name: 'Sábado 04/07', slots }, d);
  assert.ok(cRes.success && cRes.data.id, 'criou escala');
  const id = cRes.data.id;
  let g = await SS.getScale(id, d);
  assert.strictEqual(g.data.status, 'rascunho', 'nasce rascunho');
  assert.strictEqual(g.data.slots.length, 4);

  // transições de status
  await SS.openElection(id, d);
  g = await SS.getScale(id, d);
  assert.strictEqual(g.data.status, 'janela_aberta', 'abriu eleição');

  // listScales
  const l = await SS.listScales(d);
  assert.strictEqual(l.data.length, 1);

  console.log('✓ smoke-scale-service: CRUD/template OK');
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-scale-service.js`
Expected: FAIL — `Cannot find module '../scale-service.js'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// scale-service.js — persistência + orquestração da escala especial (spec §4.5-4.7, §6)
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScaleService = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function rdb(deps)  { if (deps && deps.db) return deps.db; return (typeof db !== 'undefined') ? db : null; }
  function rts(deps)  { if (deps && deps.ts) return deps.ts(); return (typeof serverTs === 'function') ? serverTs() : new Date().toISOString(); }
  function ruid(deps) { if (deps && deps.uid) return deps.uid(); return (typeof currentUserId === 'function') ? currentUserId() : null; }
  function rSE(deps)  { if (deps && deps.SE) return deps.SE; return ScaleEngine; }

  function templateSlots(tipo, units) {
    if (tipo === 'sabado' || tipo === 'feriado' || tipo === 'domingo_especial') {
      const out = [];
      (units || []).forEach(u => {
        ['TOI', 'HIIT'].forEach(mod => out.push({ id: `${u.id}_${mod}`, unitId: u.id, requiredModalityId: mod, assignedPersonId: null }));
      });
      return out;
    }
    return [];
  }

  async function createScale(scale, deps) {
    try {
      const database = rdb(deps);
      const ref = database.collection('special_scales').doc();
      const doc = {
        date: scale.date, name: scale.name || '', tipo: scale.tipo,
        status: 'rascunho', slots: scale.slots || [], externalId: '',
        createdAt: rts(deps), createdBy: ruid(deps),
      };
      await ref.set(doc);
      return { success: true, data: { id: ref.id, ...doc } };
    } catch (err) { console.error('[ScaleService.createScale]', err); return { success: false, error: err.message }; }
  }

  async function getScale(id, deps) {
    try {
      const doc = await rdb(deps).collection('special_scales').doc(id).get();
      if (!doc.exists) return { success: false, error: 'Escala não encontrada' };
      return { success: true, data: { id: doc.id, ...doc.data() } };
    } catch (err) { console.error('[ScaleService.getScale]', err); return { success: false, error: err.message }; }
  }

  async function listScales(deps) {
    try {
      const snap = await rdb(deps).collection('special_scales').orderBy('date').get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) { console.error('[ScaleService.listScales]', err); return { success: false, error: err.message }; }
  }

  async function setStatus(id, status, deps) {
    try {
      await rdb(deps).collection('special_scales').doc(id).set({ status, updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      return { success: true };
    } catch (err) { console.error('[ScaleService.setStatus]', err); return { success: false, error: err.message }; }
  }
  async function openElection(id, deps)  { return setStatus(id, 'janela_aberta', deps); }
  async function closeElection(id, deps) { return setStatus(id, 'rascunho', deps); }

  return { templateSlots, createScale, getScale, listScales, openElection, closeElection, setStatus };
});
```

> O fake firestore precisa de `doc().set(obj, {merge:true})`. Se `set` ainda não aceitar o 2º arg de merge, ajuste `scripts/_fake-firestore.js` no `docRef.set` para mesclar quando `opts && opts.merge` (Object.assign no existente) — e rode o smoke do fake (`node scripts/smoke-fake-firestore.js`) p/ garantir que nada quebrou.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/smoke-scale-service.js`
Expected: PASS — `✓ smoke-scale-service: CRUD/template OK`

- [ ] **Step 5: Commit**

```bash
git add scale-service.js scripts/smoke-scale-service.js scripts/_fake-firestore.js
git commit -m "feat(escala): ScaleService CRUD + template de slots + smoke"
```

---

### Task 2: preferências + fairness

**Files:**
- Modify: `scale-service.js`
- Test: `scripts/smoke-scale-service.js` (acrescentar)

`setPreference(scaleId, personId, pref)` → doc id determinístico `${scaleId}__${personId}` (idempotente). `listPreferences(scaleId)`. `getFairness(personId)` (default `{diasTrabalhados:0,divida:0}`). `applyFairnessDelta(delta)` (delta = `{personId:{dias,dividaResolvida}}` do ScaleEngine) → soma dias, subtrai dívida resolvida (piso 0).

- [ ] **Step 1: Write the failing test** (antes do último `console.log`)

```javascript
  // ── Preferências ──
  await SS.setPreference(id, 'ana', 'quer', d);
  await SS.setPreference(id, 'bru', 'nao_posso', d);
  await SS.setPreference(id, 'ana', 'nao_quer', d); // sobrescreve (idempotente por id)
  const prefs = await SS.listPreferences(id, d);
  assert.strictEqual(prefs.data.length, 2, 'ana(atualizada)+bru, sem duplicar');
  assert.strictEqual(prefs.data.find(p => p.personId === 'ana').pref, 'nao_quer', 'ana sobrescrita');

  // ── Fairness ──
  let f = await SS.getFairness('ana', d);
  assert.deepStrictEqual({ dias: f.data.diasTrabalhados, div: f.data.divida }, { dias: 0, div: 0 }, 'fairness default zero');
  // pré-carrega dívida e aplica delta do engine
  await SS.saveFairness('ana', { diasTrabalhados: 3, divida: 2 }, d);
  await SS.applyFairnessDelta({ ana: { dias: 1, dividaResolvida: 1 } }, d);
  f = await SS.getFairness('ana', d);
  assert.strictEqual(f.data.diasTrabalhados, 4, 'dias 3+1');
  assert.strictEqual(f.data.divida, 1, 'dívida 2-1');

  console.log('✓ smoke-scale-service: preferências/fairness OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-scale-service.js`
Expected: FAIL — `TypeError: SS.setPreference is not a function`

- [ ] **Step 3: Write minimal implementation** (adicionar antes do `return` e exportar)

```javascript
  async function setPreference(scaleId, personId, pref, deps) {
    try {
      await rdb(deps).collection('scale_preferences').doc(`${scaleId}__${personId}`)
        .set({ scaleId, personId, pref, updatedAt: rts(deps) });
      return { success: true };
    } catch (err) { console.error('[ScaleService.setPreference]', err); return { success: false, error: err.message }; }
  }

  async function listPreferences(scaleId, deps) {
    try {
      const snap = await rdb(deps).collection('scale_preferences').where('scaleId', '==', scaleId).get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) { console.error('[ScaleService.listPreferences]', err); return { success: false, error: err.message }; }
  }

  async function getFairness(personId, deps) {
    try {
      const doc = await rdb(deps).collection('fairness_counter').doc(personId).get();
      const base = { personId, diasTrabalhados: 0, divida: 0 };
      return { success: true, data: doc.exists ? Object.assign(base, doc.data()) : base };
    } catch (err) { console.error('[ScaleService.getFairness]', err); return { success: false, error: err.message }; }
  }

  async function saveFairness(personId, vals, deps) {
    try {
      await rdb(deps).collection('fairness_counter').doc(personId)
        .set({ personId, diasTrabalhados: vals.diasTrabalhados || 0, divida: vals.divida || 0, updatedAt: rts(deps) });
      return { success: true };
    } catch (err) { console.error('[ScaleService.saveFairness]', err); return { success: false, error: err.message }; }
  }

  async function applyFairnessDelta(delta, deps) {
    try {
      for (const personId of Object.keys(delta || {})) {
        const cur = (await getFairness(personId, deps)).data;
        const dd = delta[personId];
        await saveFairness(personId, {
          diasTrabalhados: cur.diasTrabalhados + (dd.dias || 0),
          divida: Math.max(0, cur.divida - (dd.dividaResolvida || 0)),
        }, deps);
      }
      return { success: true };
    } catch (err) { console.error('[ScaleService.applyFairnessDelta]', err); return { success: false, error: err.message }; }
  }
```

`return { templateSlots, createScale, getScale, listScales, openElection, closeElection, setStatus, setPreference, listPreferences, getFairness, saveFairness, applyFairnessDelta };`

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/smoke-scale-service.js`
Expected: PASS — termina com `✓ smoke-scale-service: preferências/fairness OK`

- [ ] **Step 5: Commit**

```bash
git add scale-service.js scripts/smoke-scale-service.js
git commit -m "feat(escala): preferências + fairness counter + smoke"
```

---

### Task 3: `buildCandidates` (puro) + `consolidate` (orquestra ScaleEngine + persiste)

**Files:**
- Modify: `scale-service.js`
- Test: `scripts/smoke-scale-service.js` (acrescentar)

`buildCandidates({ teachers, meritoById, fairnessById, prefById })` (puro) → array no formato do `ScaleEngine` (`{id, modalityIds, primaryUnitId, merito, diasTrabalhados, divida, pref}`).
`consolidate(scaleId, ctx, deps)`: carrega a escala + preferências; usa `ctx.teachers` e `ctx.meritoById` (injetados pelo caller — na UI virão de `TeacherService`/`EngagementService`; no smoke, do teste); carrega fairness de cada teacher; chama `buildCandidates` + `rSE(deps).consolidate(slots, candidates, opts)`; grava `slots[].assignedPersonId` + `status='consolidada'`; aplica `applyFairnessDelta`. Retorna `{assignments}`.

- [ ] **Step 1: Write the failing test** (antes do último `console.log`)

```javascript
  // ── buildCandidates (puro) ──
  const cands = SS.buildCandidates({
    teachers: [{ id: 'ana', modalityIds: ['TOI'], primaryUnitId: 'cp' }],
    meritoById: { ana: 40 },
    fairnessById: { ana: { diasTrabalhados: 2, divida: 1 } },
    prefById: { ana: 'quer' },
  });
  assert.deepStrictEqual(cands[0], { id: 'ana', modalityIds: ['TOI'], primaryUnitId: 'cp', merito: 40, diasTrabalhados: 2, divida: 1, pref: 'quer' });

  // ── consolidate (orquestra + persiste) ──
  // nova escala só com slot TOI em cp; ana habilitada
  const slotsToi = [{ id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: null }];
  const c2 = await SS.createScale({ date: '2026-07-11', tipo: 'sabado', name: 'S2', slots: slotsToi }, d);
  await SS.setPreference(c2.data.id, 'ana', 'quer', d);
  const ctx = { teachers: [{ id: 'ana', modalityIds: ['TOI'], primaryUnitId: 'cp' }], meritoById: { ana: 40 } };
  const cons = await SS.consolidate(c2.data.id, ctx, d);
  assert.strictEqual(cons.data.assignments[0].personId, 'ana', 'ana alocada no TOI');
  const g2 = await SS.getScale(c2.data.id, d);
  assert.strictEqual(g2.data.status, 'consolidada', 'status consolidada');
  assert.strictEqual(g2.data.slots[0].assignedPersonId, 'ana', 'slot gravado com a pessoa');
  const fa = await SS.getFairness('ana', d);
  assert.strictEqual(fa.data.diasTrabalhados, 1, 'fairness incrementado pela consolidação');

  console.log('✓ smoke-scale-service: consolidate OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-scale-service.js`
Expected: FAIL — `TypeError: SS.buildCandidates is not a function`

- [ ] **Step 3: Write minimal implementation** (adicionar antes do `return` e exportar)

```javascript
  function buildCandidates(ctx) {
    const merito = ctx.meritoById || {};
    const fair = ctx.fairnessById || {};
    const pref = ctx.prefById || {};
    return (ctx.teachers || []).map(t => ({
      id: t.id, modalityIds: t.modalityIds || [], primaryUnitId: t.primaryUnitId || null,
      merito: merito[t.id] || 0,
      diasTrabalhados: (fair[t.id] && fair[t.id].diasTrabalhados) || 0,
      divida: (fair[t.id] && fair[t.id].divida) || 0,
      pref: pref[t.id] || null,
    }));
  }

  async function consolidate(scaleId, ctx, deps) {
    try {
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      const scale = scaleRes.data;
      const prefsRes = await listPreferences(scaleId, deps);
      const prefById = {};
      (prefsRes.data || []).forEach(p => { prefById[p.personId] = p.pref; });
      const teachers = ctx.teachers || [];
      const fairnessById = {};
      for (const t of teachers) { fairnessById[t.id] = (await getFairness(t.id, deps)).data; }
      const candidates = buildCandidates({ teachers, meritoById: ctx.meritoById || {}, fairnessById, prefById });
      const result = rSE(deps).consolidate(scale.slots || [], candidates, ctx.opts || {});
      // grava assignedPersonId nos slots
      const bySlot = {};
      result.assignments.forEach(a => { bySlot[a.slotId] = a.personId; });
      const newSlots = (scale.slots || []).map(s => Object.assign({}, s, { assignedPersonId: bySlot[s.id] !== undefined ? bySlot[s.id] : s.assignedPersonId }));
      await rdb(deps).collection('special_scales').doc(scaleId)
        .set({ slots: newSlots, status: 'consolidada', updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      await applyFairnessDelta(result.fairnessDelta, deps);
      return { success: true, data: { assignments: result.assignments } };
    } catch (err) { console.error('[ScaleService.consolidate]', err); return { success: false, error: err.message }; }
  }
```

`return { templateSlots, createScale, getScale, listScales, openElection, closeElection, setStatus, setPreference, listPreferences, getFairness, saveFairness, applyFairnessDelta, buildCandidates, consolidate };`

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/smoke-scale-service.js`
Expected: PASS — termina com `✓ smoke-scale-service: consolidate OK`

- [ ] **Step 5: Commit**

```bash
git add scale-service.js scripts/smoke-scale-service.js
git commit -m "feat(escala): buildCandidates + consolidate (orquestra ScaleEngine) + smoke"
```

---

## Self-Review

**1. Spec coverage:**
- §4.5 special_scales (slots/template/status) → Task 1 ✓
- §4.6 scale_preferences (id determinístico, idempotente) → Task 2 ✓
- §4.7 fairness_counter (default, delta) → Task 2 ✓
- §6 consolidação: monta candidatos (habilitação/mérito/fairness/pref) + chama ScaleEngine + persiste slots + aplica fairness → Task 3 ✓
- **Fora deste plano:** regras Firestore das 3 coleções (vão no plano de staging); UI (5b); fim de ano §7 + integração substituição (5c); janela de eleição/acúmulo entre janelas.

**2. Placeholder scan:** sem TBD/TODO; todo passo com código/comando real. A nota sobre `set(obj,{merge:true})` no fake é uma instrução concreta de ajuste, não placeholder.

**3. Type consistency:** candidate de `buildCandidates` bate com o contrato do `ScaleEngine.consolidate` (Plano 4); `fairnessDelta` (`{personId:{dias,dividaResolvida}}`) consumido por `applyFairnessDelta` é o mesmo produzido pelo `ScaleEngine`; shapes de `special_scales`/`scale_preferences`/`fairness_counter` consistentes entre métodos.

---

## Próximo
- **Plano 5b — UI da escala:** gestão cria data + abre janela; colaborador marca quer/não/não-posso; gestão consolida (mostra o porquê de cada escolha) + painel de equilíbrio. Verificar no preview/staging.
- **Plano 5c — fim de ano + integrações:** template de duplas dia-inteiro + dias fechados; não-escalado vira **férias** (módulo de Férias); proatividade de substituição → `EngagementService.awardSubstitution`.
- Regras Firestore das 3 coleções + validação REST no staging (com a UI).
