# Escala Inteligente · Frente 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao professor uma visão em abas da Escala Inteligente (candidatar onde cabe + consultar "onde estou/sou líder") e permitir candidatura por data no fim de ano (com exclusão de turno), respeitada na consolidação.

**Architecture:** Estende os helpers puros/serviço testáveis de `scale-service.js` (novos `scale_day_preferences` + `dayPrefsToAvailability` + `isPersonAssigned`, e `consolidateByDay` passa a respeitar preferência por dia×turno) e reescreve a visão do professor (`renderEscalaPrefs`) como abas espelhando as 5 categorias. Lógica de regra em helpers puros (smoke Node com fake-firestore); UI fina.

**Tech Stack:** HTML/CSS/JS vanilla (UMD), Firebase Firestore, smokes Node com `assert` + `scripts/_fake-firestore.js`. Sem build step.

**Spec:** `docs/superpowers/specs/2026-07-08-escala-frente2-visao-professor-design.md`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Ação |
|---------|------------------|------|
| `scale-service.js` | + `setDayPreference`/`listDayPreferences` (IO), + `dayPrefsToAvailability`/`isPersonAssigned` (puros), `consolidateByDay` respeita prefs por dia×turno | modificar |
| `professores-escala-smart.js` | `renderEscalaPrefs` vira visão em abas; candidatura sábado/feriado + read-only "onde estou"; fim de ano por data + toggles de turno; eventos/escola interna read-only. `escalaSetTab/Year/Timeframe` re-renderizam por papel | modificar |
| `firestore.rules` | regra `scale_day_preferences` (espelha `scale_preferences`) | modificar |
| `scripts/smoke-escala-frente2.js` | helpers puros + serviço (setDayPreference prazo, consolidateByDay por dia×turno) | **criar** |

**Ordem:** Tasks 1–3 (serviço/helpers, TDD) → Task 4 (rules) → Tasks 5–7 (UI) → Task 8 (verificação + deploy rules staging).

---

## Task 1: `scale-service.js` — `setDayPreference` + `listDayPreferences`

**Files:** Modify `scale-service.js`; Create `scripts/smoke-escala-frente2.js`.

Preferência por data do fim de ano. Doc id `${scaleId}__${personId}__${date}`. `setDayPreference` valida o prazo com `isWindowOpen` (igual `setPreference`).

- [ ] **Step 1: Criar `scripts/smoke-escala-frente2.js`**

```js
'use strict';
// Roda: node scripts/smoke-escala-frente2.js
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'tester' });

(async () => {
  const db = makeFakeDb();
  const d = deps(db);

  // fim de ano com janela aberta
  const fa = (await SS.createScale({ date: '2026-12-21', tipo: 'fim_de_ano', name: 'Fim de ano 2026', slots: [
    { id: '2026-12-26_unit-cp_manha_1', day: '2026-12-26', unitId: 'unit-cp', shift: 'manha', startTime: '08:00', endTime: '12:00', requiredModalityId: null, assignedPersonId: null },
    { id: '2026-12-26_unit-cp_tarde_noite_1', day: '2026-12-26', unitId: 'unit-cp', shift: 'tarde_noite', startTime: '16:00', endTime: '21:00', requiredModalityId: null, assignedPersonId: null },
  ] }, d)).data;
  await SS.openElection(fa.id, { closesAt: '2999-01-01T00:00' }, d);

  // grava preferência por data dentro do prazo
  const ok = await SS.setDayPreference(fa.id, 'p1', '2026-12-26', 'prefiro', ['tarde_noite'], d);
  assert.ok(ok.success, 'setDayPreference dentro do prazo');
  const listed = await SS.listDayPreferences(fa.id, d);
  assert.strictEqual(listed.data.length, 1, 'uma pref por data');
  assert.strictEqual(listed.data[0].pref, 'prefiro');
  assert.deepStrictEqual(listed.data[0].excludedShifts, ['tarde_noite'], 'turno excluído gravado');
  assert.strictEqual(listed.data[0].date, '2026-12-26');
  console.log('✓ setDayPreference/listDayPreferences OK');

  // fora do prazo: recusa
  await SS.openElection(fa.id, { closesAt: '2000-01-01T00:00' }, d);
  const blocked = await SS.setDayPreference(fa.id, 'p1', '2026-12-26', 'prefiro', [], d);
  assert.strictEqual(blocked.success, false, 'recusa após prazo');
  assert.match(blocked.error, /encerrada|prazo/i);
  console.log('✓ setDayPreference respeita prazo OK');

  console.log('\n✅ smoke-escala-frente2 (Task 1) OK');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "C:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes" && node scripts/smoke-escala-frente2.js`
Expected: FAIL — `SS.setDayPreference is not a function`.

- [ ] **Step 3: Implementar em `scale-service.js`** (após `setPreference`/`listPreferences`, perto da linha ~175):

```js
  async function setDayPreference(scaleId, personId, date, pref, excludedShifts, deps) {
    try {
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      const nowISO = (deps && deps.now) ? deps.now() : nowLocalMinute();
      if (!isWindowOpen(scaleRes.data, nowISO)) return { success: false, error: 'Janela de preferências encerrada.' };
      await rdb(deps).collection('scale_day_preferences').doc(`${scaleId}__${personId}__${date}`)
        .set({ scaleId, personId, date, pref, excludedShifts: excludedShifts || [], updatedAt: rts(deps) });
      return { success: true };
    } catch (err) { console.error('[ScaleService.setDayPreference]', err); return { success: false, error: err.message }; }
  }

  async function listDayPreferences(scaleId, deps) {
    try {
      const snap = await rdb(deps).collection('scale_day_preferences').where('scaleId', '==', scaleId).get();
      return { success: true, data: snap.docs.map(dd => ({ id: dd.id, ...dd.data() })) };
    } catch (err) { console.error('[ScaleService.listDayPreferences]', err); return { success: false, error: err.message }; }
  }
```

- [ ] **Step 4: Exportar** `setDayPreference, listDayPreferences` no `return { ... }` final (após `listPreferences`).

- [ ] **Step 5: Rodar e ver passar**

Run: `node scripts/smoke-escala-frente2.js`
Expected: PASS — `✅ smoke-escala-frente2 (Task 1) OK`.

- [ ] **Step 6: Commit**

```bash
git add scale-service.js scripts/smoke-escala-frente2.js
git commit -m "feat(escala): preferencia por data do fim de ano (setDayPreference/listDayPreferences)"
```

---

## Task 2: `scale-service.js` — puros `dayPrefsToAvailability` + `isPersonAssigned`

**Files:** Modify `scale-service.js`; append to `scripts/smoke-escala-frente2.js`.

- [ ] **Step 1: Adicionar teste** — em `scripts/smoke-escala-frente2.js`, antes do log final, inserir:

```js
  // ── dayPrefsToAvailability (puro) ──
  const av = SS.dayPrefsToAvailability([
    { personId: 'p1', date: '2026-12-26', pref: 'prefiro', excludedShifts: ['tarde_noite'] },
    { personId: 'p2', date: '2026-12-26', pref: 'nao_posso', excludedShifts: [] },
  ]);
  assert.strictEqual(av.p1['2026-12-26'].pref, 'prefiro', 'pref por data');
  assert.deepStrictEqual(av.p1['2026-12-26'].excludedShifts, ['tarde_noite']);
  assert.strictEqual(av.p2['2026-12-26'].pref, 'nao_posso');
  assert.deepStrictEqual(SS.dayPrefsToAvailability([]), {}, 'vazio = {}');
  console.log('✓ dayPrefsToAvailability OK');

  // ── isPersonAssigned (puro) ──
  const sc = { slots: [{ assignedPersonId: 'p1' }, { assignedPersonId: null }, { assignedPersonId: 'p3' }] };
  assert.strictEqual(SS.isPersonAssigned(sc, 'p1'), true, 'escalado');
  assert.strictEqual(SS.isPersonAssigned(sc, 'p2'), false, 'não escalado');
  assert.strictEqual(SS.isPersonAssigned({ slots: [] }, 'p1'), false, 'sem slots = false');
  assert.strictEqual(SS.isPersonAssigned(null, 'p1'), false, 'null = false');
  console.log('✓ isPersonAssigned OK');
```

E trocar o log final para `console.log('\n✅ smoke-escala-frente2 (Task 2) OK');`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-escala-frente2.js`
Expected: FAIL — `SS.dayPrefsToAvailability is not a function`.

- [ ] **Step 3: Implementar** (perto de `buildCandidates`/`isWindowOpen`):

```js
  // PURO: [{personId,date,pref,excludedShifts}] → map[personId][date] = {pref, excludedShifts}
  function dayPrefsToAvailability(dayPrefs) {
    const out = {};
    (dayPrefs || []).forEach(p => {
      if (!p || !p.personId || !p.date) return;
      (out[p.personId] = out[p.personId] || {})[p.date] = {
        pref: p.pref || null,
        excludedShifts: p.excludedShifts || [],
      };
    });
    return out;
  }

  // PURO: a pessoa está em algum slot atribuído desta escala?
  function isPersonAssigned(scale, personId) {
    if (!scale || !personId) return false;
    return (scale.slots || []).some(s => s.assignedPersonId === personId);
  }
```

- [ ] **Step 4: Exportar** `dayPrefsToAvailability, isPersonAssigned` no `return { ... }` final.

- [ ] **Step 5: Rodar e ver passar**

Run: `node scripts/smoke-escala-frente2.js`
Expected: PASS — `✓ dayPrefsToAvailability OK`, `✓ isPersonAssigned OK`, `✅ smoke-escala-frente2 (Task 2) OK`.

- [ ] **Step 6: Commit**

```bash
git add scale-service.js scripts/smoke-escala-frente2.js
git commit -m "feat(escala): helpers puros dayPrefsToAvailability e isPersonAssigned"
```

---

## Task 3: `consolidateByDay` respeita preferência por dia×turno

**Files:** Modify `scale-service.js` (`consolidateByDay`); append to `scripts/smoke-escala-frente2.js`.

O `consolidateByDay` atual lê `listPreferences` (pref única por escala) e roda `SE.consolidate(daySlots, candidates)` por dia. Muda para: ler `listDayPreferences` → `dayPrefsToAvailability`, e consolidar **por dia × turno**, filtrando candidatos inelegíveis (dia 'nao_posso' ou turno excluído) e passando a pref do dia como peso.

- [ ] **Step 1: Adicionar teste** — em `scripts/smoke-escala-frente2.js`, antes do log final:

```js
  // ── consolidateByDay respeita dia×turno ──
  const db2 = makeFakeDb(); const d2 = deps(db2);
  const fa2 = (await SS.createScale({ date: '2026-12-26', tipo: 'fim_de_ano', name: 'FdA', slots: [
    { id: 'd1_manha', day: '2026-12-26', unitId: 'u', shift: 'manha', startTime: '08:00', endTime: '12:00', requiredModalityId: null, assignedPersonId: null },
    { id: 'd1_tarde', day: '2026-12-26', unitId: 'u', shift: 'tarde_noite', startTime: '16:00', endTime: '21:00', requiredModalityId: null, assignedPersonId: null },
  ] }, d2)).data;
  // p1 só pode manhã (excluiu tarde), p2 não pode o dia todo, p3 livre
  await SS.openElection(fa2.id, { closesAt: '2999-01-01T00:00' }, d2);
  await SS.setDayPreference(fa2.id, 'p1', '2026-12-26', 'prefiro', ['tarde_noite'], d2);
  await SS.setDayPreference(fa2.id, 'p2', '2026-12-26', 'nao_posso', [], d2);
  const ctx = { teachers: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }, { id: 'p3', name: 'P3' }], meritoById: {}, opts: {} };
  const res = await SS.consolidateByDay(fa2.id, ctx, d2);
  assert.ok(res.success, 'consolidou');
  const g = (await SS.getScale(fa2.id, d2)).data;
  const manha = g.slots.find(s => s.id === 'd1_manha');
  const tarde = g.slots.find(s => s.id === 'd1_tarde');
  assert.notStrictEqual(manha.assignedPersonId, 'p2', 'p2 (nao_posso) não escalado de manhã');
  assert.notStrictEqual(tarde.assignedPersonId, 'p1', 'p1 (excluiu tarde) não escalado à tarde');
  assert.notStrictEqual(tarde.assignedPersonId, 'p2', 'p2 (nao_posso) não escalado à tarde');
  console.log('✓ consolidateByDay respeita dia×turno OK');

  // ── retrocompat: sem day prefs = todos disponíveis (não quebra) ──
  const db3 = makeFakeDb(); const d3 = deps(db3);
  const fa3 = (await SS.createScale({ date: '2026-12-27', tipo: 'fim_de_ano', name: 'FdA3', slots: [
    { id: 'x_manha', day: '2026-12-27', unitId: 'u', shift: 'manha', startTime: '08:00', endTime: '12:00', requiredModalityId: null, assignedPersonId: null },
  ] }, d3)).data;
  const res3 = await SS.consolidateByDay(fa3.id, { teachers: [{ id: 'pa', name: 'PA' }], meritoById: {}, opts: {} }, d3);
  assert.ok(res3.success, 'consolida sem day prefs');
  const g3 = (await SS.getScale(fa3.id, d3)).data;
  assert.strictEqual(g3.slots[0].assignedPersonId, 'pa', 'sem pref = disponível (retrocompat)');
  console.log('✓ consolidateByDay retrocompat OK');
```

E trocar o log final para `console.log('\n✅ smoke-escala-frente2 (Task 3) OK');`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-escala-frente2.js`
Expected: FAIL — a asserção `p1 (excluiu tarde) não escalado à tarde` falha (o `consolidateByDay` atual ignora exclusão de turno).

- [ ] **Step 3: Reescrever `consolidateByDay`** em `scale-service.js`. Substituir o corpo atual por:

```js
  async function consolidateByDay(scaleId, ctx, deps) {
    try {
      ctx = ctx || {};
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      const scale = scaleRes.data;
      const dpRes = await listDayPreferences(scaleId, deps);
      const avail = dayPrefsToAvailability(dpRes.data || []);
      const teachers = ctx.teachers || [];
      const SE = rSE(deps);
      const opts = { minMes: (ctx.opts && ctx.opts.minMes) || 999 };
      const slots = scale.slots || [];
      const days = [...new Set(slots.map(s => s.day))].sort();
      const working = {};
      const bySlot = {}, byReason = {}, byExplain = {};
      days.forEach(day => {
        const daySlots = slots.filter(s => s.day === day);
        const shifts = [...new Set(daySlots.map(s => s.shift || '_'))];
        shifts.forEach(shift => {
          const shiftSlots = daySlots.filter(s => (s.shift || '_') === shift);
          // elegíveis nesse dia×turno + pref (peso) por pessoa
          const prefById = {};
          const eligible = teachers.filter(t => {
            const a = (avail[t.id] || {})[day];
            if (!a) { return true; }                      // sem pref = disponível (retrocompat)
            if (a.pref === 'nao_posso') return false;      // dia bloqueado
            if ((a.excludedShifts || []).includes(shift)) return false; // turno bloqueado
            prefById[t.id] = a.pref || null;               // 'prefiro'/'pode_ser' como peso
            return true;
          });
          const candidates = buildCandidates({ teachers: eligible, meritoById: ctx.meritoById || {}, fairnessById: working, prefById });
          const result = SE.consolidate(shiftSlots, candidates, opts);
          result.assignments.forEach(a => { bySlot[a.slotId] = a.personId; byReason[a.slotId] = a.reason; byExplain[a.slotId] = a.explain || []; });
          Object.keys(result.fairnessDelta).forEach(pid => {
            working[pid] = working[pid] || { diasTrabalhados: 0, divida: 0 };
            working[pid].diasTrabalhados += (result.fairnessDelta[pid].dias || 0);
          });
        });
      });
      const newSlots = slots.map(s => Object.assign({}, s, {
        assignedPersonId: bySlot[s.id] !== undefined ? bySlot[s.id] : s.assignedPersonId,
        reason: byReason[s.id] !== undefined ? byReason[s.id] : (s.reason || null),
        explain: byExplain[s.id] !== undefined ? byExplain[s.id] : (s.explain || []),
      }));
      await rdb(deps).collection('special_scales').doc(scaleId)
        .set({ slots: newSlots, status: 'consolidada', updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      const escalados = new Set(Object.values(bySlot).filter(Boolean));
      const naoEscalados = teachers.filter(t => !escalados.has(t.id)).map(t => t.id);
      return { success: true, data: { naoEscalados, totalSlots: slots.length, diasTrabalhadosPorPessoa: working } };
    } catch (err) { console.error('[ScaleService.consolidateByDay]', err); return { success: false, error: err.message }; }
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node scripts/smoke-escala-frente2.js`
Expected: PASS — `✓ consolidateByDay respeita dia×turno OK`, `✓ consolidateByDay retrocompat OK`, `✅ smoke-escala-frente2 (Task 3) OK`.

- [ ] **Step 5: Regressão** — o fim de ano da Frente 1 usava `consolidateByDay` sem day-prefs; confirmar que os smokes existentes seguem verdes:

```bash
cd "C:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes" && node scripts/smoke-scale-service.js && node scripts/smoke-escala-frente1.js && node scripts/smoke-escala-tabs.js
```
Todos verdes.

- [ ] **Step 6: Commit**

```bash
git add scale-service.js scripts/smoke-escala-frente2.js
git commit -m "feat(escala): consolidateByDay respeita preferencia por dia e turno"
```

---

## Task 4: Regra Firestore de `scale_day_preferences`

**Files:** Modify `firestore.rules`.

- [ ] **Step 1: Adicionar a regra** — em `firestore.rules`, logo APÓS o bloco `match /scale_preferences/{id} { ... }` (perto da linha 236), inserir (espelha a de `scale_preferences`):

```
    // Preferência por data do fim de ano: colaborador grava a SUA (personId == professorId);
    // gestão grava qualquer uma. Doc id = `${scaleId}__${personId}__${date}`.
    match /scale_day_preferences/{id} {
      allow read:   if isAuth() && hasProfModule();
      allow create, update: if isAuth() && (
                      isAdmin() || isSuperv() ||
                      request.resource.data.personId == uData().professorId
                    );
      allow delete: if false;
    }
```

- [ ] **Step 2: Validar sintaxe das rules** (compila local, sem deploy):

```bash
cd "C:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes" && firebase deploy --only firestore:rules --project staging --dry-run 2>&1 | tail -5 || echo "IMPORTANTE: se --dry-run não existir nesta versão do CLI, apenas revise a sintaxe manualmente; o deploy real é na Task 8 com OK do usuário"
```
Expected: sem erro de compilação de rules. (Se o `--dry-run` não for suportado, seguir — o deploy real das rules é na Task 8.)

- [ ] **Step 3: Commit**

```bash
git add firestore.rules
git commit -m "feat(rules): regra de scale_day_preferences (preferencia por data do fim de ano)"
```

---

## Task 5: UI — visão do professor em abas (shell + Sábados/Feriados)

**Files:** Modify `professores-escala-smart.js`.

Reescreve `renderEscalaPrefs` como visão em abas. `escalaSetTab`/`escalaSetYear`/`escalaSetTimeframe` passam a re-renderizar por papel (via `renderEscalaSmartPage`). No DOM test — verificar por parse. **LER o arquivo antes** (a `renderEscalaPrefs` atual, o `pbtn`, `escalaLoadFeriados`, `ESCALA_TABS`, `escalaProfId`, `escalaFmtBR`, `escalaTodayISO`, `ScaleService.isWindowOpen/nowLocalMinute/filterByTimeframe/isPersonAssigned`).

- [ ] **Step 1: `escalaSetTab/Year/Timeframe` re-renderizam por papel.** Trocar as 3 funções (perto das linhas 67-69) para chamar `renderEscalaSmartPage()` (que roteia gestão×professor) em vez de `renderEscalaGestao()`:

```js
function escalaSetTab(t) { EscalaSmartState.tab = t; EscalaSmartState.selectedId = null; renderEscalaSmartPage(); }
function escalaSetYear(y) { EscalaSmartState.year = parseInt(y, 10); renderEscalaSmartPage(); }
function escalaSetTimeframe(tf) { EscalaSmartState.timeframe = tf; renderEscalaSmartPage(); }
```

- [ ] **Step 2: Reescrever `renderEscalaPrefs`** para carregar dados e renderizar a barra de abas + timeframe + conteúdo da aba. Substituir a função inteira por:

```js
async function renderEscalaPrefs() {
  const container = document.getElementById('page-escala-smart');
  if (!container) return;
  container.innerHTML = `<div class="page-hdr"><h1>🗓️ Escala — minhas datas</h1><p>Candidate-se onde a janela estiver aberta; consulte onde você está escalado.</p></div>
    <div class="loading"><div class="spinner"></div> Carregando…</div>`;

  const pid = escalaProfId();
  const [scalesRes, teachersRes] = await Promise.all([ScaleService.listScales(), TeacherService.list()]);
  EscalaSmartState.scales = scalesRes.success ? scalesRes.data : [];
  EscalaSmartState.teacherMap = new Map((teachersRes.success ? teachersRes.data : []).map(t => [t.id, t]));
  if (EscalaSmartState.tab === 'feriado') await escalaLoadFeriados(EscalaSmartState.year);

  const tab = EscalaSmartState.tab;
  const tabsHtml = `<div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:12px;flex-wrap:wrap;">` +
    ESCALA_TABS.map(t => {
      const on = t.id === tab;
      return `<button onclick="escalaSetTab('${t.id}')" style="background:none;border:none;border-bottom:2px solid ${on ? 'var(--blue)' : 'transparent'};color:${on ? 'var(--text)' : 'var(--text2)'};font-weight:${on ? '600' : '400'};font-size:14px;padding:8px 14px;cursor:pointer;">${t.label}</button>`;
    }).join('') + `</div>`;

  let body;
  if (tab === 'sabado' || tab === 'feriado') body = await renderProfSabadosFeriados(pid, tab);
  else if (tab === 'fim_de_ano')                body = await renderProfFimDeAno(pid);
  else if (tab === 'evento')                    body = renderProfEventos();
  else                                          body = renderProfEscolaInterna(pid);

  container.innerHTML = `<div class="page-hdr"><h1>🗓️ Escala — minhas datas</h1><p>Candidate-se onde a janela estiver aberta; consulte onde você está escalado.</p></div>
    ${tabsHtml}
    ${body}`;
}
```

- [ ] **Step 3: Aba Sábados/Feriados do professor.** Adicionar (perto de `renderEscalaPrefs`):

```js
async function renderProfSabadosFeriados(pid, tab) {
  const tipos = tab === 'sabado' ? ['sabado'] : ['feriado', 'domingo_especial'];
  let escalas = EscalaSmartState.scales.filter(s => tipos.includes(s.tipo));
  escalas = ScaleService.filterByTimeframe(escalas, escalaTodayISO(), EscalaSmartState.timeframe);
  if (!escalas.length) return `<p style="padding:20px;color:var(--text2);">Nenhuma data ${tab === 'sabado' ? 'de sábado' : 'de feriado'} ${EscalaSmartState.timeframe === 'futuros' ? 'próxima' : ''}.</p>`;

  // atalho "Pode ser em todas" quando há janela aberta na aba (reusa marcarPodeSerTodas, que já existe/exportado)
  const temAberta = escalas.some(s => s.status === 'janela_aberta');
  const atalho = temAberta
    ? `<div style="padding:0 0 12px;"><button onclick="marcarPodeSerTodas()" style="font-size:13px;padding:8px 14px;border-radius:8px;cursor:pointer;background:rgba(94,168,255,0.15);color:#5EA8FF;border:1px solid #5EA8FF;">✓ Marcar "Pode ser" em todas as janelas abertas</button></div>`
    : '';

  // preferências atuais do professor nas janelas abertas
  const nowISO = ScaleService.nowLocalMinute();
  const prefByScale = {};
  for (const s of escalas) {
    if (s.status === 'janela_aberta') {
      const pr = await ScaleService.listPreferences(s.id);
      const mine = (pr.success ? pr.data : []).find(p => p.personId === pid);
      prefByScale[s.id] = mine ? mine.pref : null;
    }
  }
  const pbtn = (sid, pref, label, color) => {
    const active = prefByScale[sid] === pref;
    const style = active ? `background:${color};color:#0a0a0a;border:1px solid ${color};font-weight:600;` : `background:transparent;color:var(--text2);border:1px solid var(--border);`;
    return `<button onclick="marcarPref('${sid}','${pref}')" style="font-size:13px;padding:7px 12px;border-radius:8px;cursor:pointer;${style}">${label}</button>`;
  };
  return atalho + escalas.map(s => {
    const open = ScaleService.isWindowOpen(s, nowISO);
    let right;
    if (s.status === 'janela_aberta') {
      const prazo = s.windowClosesAt ? `Fecha em ${escalaFmtBR(s.windowClosesAt.slice(0, 10))}` : 'Sem prazo';
      right = open
        ? `<div style="display:flex;gap:6px;">${pbtn(s.id, 'prefiro', 'Prefiro', 'var(--green)')}${pbtn(s.id, 'pode_ser', 'Pode ser', '#5EA8FF')}${pbtn(s.id, 'nao_posso', 'Não posso', 'var(--red)')}</div>`
        : `<span style="font-size:12px;color:var(--red);">Janela encerrada</span>`;
      return profDateRow(s, `${s.date} · ${prazo}`, right);
    }
    // consolidada/publicada → read-only "onde estou"
    const escalado = ScaleService.isPersonAssigned(s, pid);
    right = escalado
      ? `<span style="font-size:12px;color:var(--green);font-weight:600;">✓ Você está escalado</span>`
      : `<span style="font-size:12px;color:var(--text3);">Não escalado</span>`;
    return profDateRow(s, `${s.date} · ${ESCALA_STATUS_LABEL[s.status] || s.status}`, right);
  }).join('');
}

function profDateRow(s, sub, right) {
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;flex-wrap:wrap;">
    <div><div style="font-weight:600;font-size:14px;">${s.name || s.date}</div><div style="font-size:12px;color:var(--text2);">${sub}</div></div>
    ${right}
  </div>`;
}
```

(`marcarPref` já existe e já é exportado — reutiliza. Mas ele chama `renderEscalaPrefs()` no fim; confirme que continua re-renderizando a visão do professor — sim, pois `renderEscalaPrefs` é a visão do professor.)

- [ ] **Step 4: Placeholders temporários** para as outras abas (implementadas nas Tasks 6 e 7) — adicionar stubs pra o parse não quebrar nesta task:

```js
async function renderProfFimDeAno(pid) { return `<p style="padding:20px;color:var(--text2);">(fim de ano — Task 6)</p>`; }
function renderProfEventos() { return `<p style="padding:20px;color:var(--text2);">(eventos — Task 7)</p>`; }
function renderProfEscolaInterna(pid) { return `<p style="padding:20px;color:var(--text2);">(escola interna — Task 7)</p>`; }
```

- [ ] **Step 5: Parse check**

Run: `node -e "new Function(require('fs').readFileSync('professores-escala-smart.js','utf8').replace(/^\xEF\xBB\xBF/,'')); console.log('sintaxe OK')"`
Expected: `sintaxe OK`.

- [ ] **Step 6: Commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala): visao do professor em abas (Sabados/Feriados candidatar + onde estou)"
```

---

## Task 6: UI — aba Fim de ano do professor (por data + turno)

**Files:** Modify `professores-escala-smart.js` (substituir o stub `renderProfFimDeAno`).

- [ ] **Step 1: Implementar `renderProfFimDeAno`** — substituir o stub por:

```js
async function renderProfFimDeAno(pid) {
  const escalas = EscalaSmartState.scales.filter(s => s.tipo === 'fim_de_ano');
  if (!escalas.length) return `<p style="padding:20px;color:var(--text2);">Nenhum período de fim de ano.</p>`;
  const nowISO = ScaleService.nowLocalMinute();
  let html = '';
  for (const s of escalas) {
    const open = ScaleService.isWindowOpen(s, nowISO);
    const dias = [...new Set((s.slots || []).map(sl => sl.day))].sort();
    const shiftsByDay = {};
    dias.forEach(day => { shiftsByDay[day] = [...new Set((s.slots || []).filter(sl => sl.day === day).map(sl => sl.shift))]; });
    // preferências por data do professor
    const dpRes = await ScaleService.listDayPreferences(s.id);
    const mine = {};
    (dpRes.success ? dpRes.data : []).filter(p => p.personId === pid).forEach(p => { mine[p.date] = p; });

    const cabecalho = `<div style="font-weight:600;margin:4px 0 8px;">${s.name || s.date}${open ? '' : ` · <span style="color:var(--red);font-size:12px;">janela encerrada</span>`}</div>`;
    const diasHtml = dias.map(day => {
      const cur = mine[day] || { pref: null, excludedShifts: [] };
      const shifts = shiftsByDay[day];
      const shiftLabel = (sid) => sid === 'manha' ? 'Manhã' : (sid === 'tarde_noite' ? 'Tarde/Noite' : sid);
      const pbtn = (pref, label, color) => {
        const active = cur.pref === pref;
        const style = active ? `background:${color};color:#0a0a0a;border:1px solid ${color};font-weight:600;` : `background:transparent;color:var(--text2);border:1px solid var(--border);`;
        return `<button ${open ? '' : 'disabled'} onclick="marcarDiaFdA('${s.id}','${day}','${pref}')" style="font-size:12px;padding:6px 10px;border-radius:8px;cursor:${open ? 'pointer' : 'not-allowed'};opacity:${open ? 1 : 0.5};${style}">${label}</button>`;
      };
      // toggles de turno só quando pref != nao_posso
      const turnos = (cur.pref && cur.pref !== 'nao_posso')
        ? shifts.map(sh => {
            const excl = (cur.excludedShifts || []).includes(sh);
            return `<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;margin-right:10px;color:${excl ? 'var(--text3)' : 'var(--text2)'};"><input type="checkbox" ${excl ? '' : 'checked'} ${open ? '' : 'disabled'} onchange="toggleTurnoFdA('${s.id}','${day}','${sh}')"> ${shiftLabel(sh)}</label>`;
          }).join('')
        : '';
      return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:6px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <span style="font-weight:600;font-size:13px;">${escalaFmtBR(day)}</span>
          <div style="display:flex;gap:6px;">${pbtn('prefiro', 'Prefiro', 'var(--green)')}${pbtn('pode_ser', 'Pode ser', '#5EA8FF')}${pbtn('nao_posso', 'Não posso', 'var(--red)')}</div>
        </div>
        ${turnos ? `<div style="margin-top:8px;">${turnos}</div>` : ''}
      </div>`;
    }).join('');
    html += cabecalho + diasHtml;
  }
  return html;
}
```

- [ ] **Step 2: Handlers de marcação** — adicionar (perto de `marcarPref`):

```js
async function marcarDiaFdA(scaleId, date, pref) {
  const pid = escalaProfId();
  if (!pid) { toast('Seu perfil não está vinculado a um professor.', 'error'); return; }
  // preserva os turnos excluídos já marcados
  const dpRes = await ScaleService.listDayPreferences(scaleId);
  const cur = (dpRes.success ? dpRes.data : []).find(p => p.personId === pid && p.date === date);
  const excluded = pref === 'nao_posso' ? [] : (cur ? cur.excludedShifts || [] : []);
  const res = await ScaleService.setDayPreference(scaleId, pid, date, pref, excluded);
  if (res.success) { toast('Preferência registrada!', 'success'); renderEscalaPrefs(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}

async function toggleTurnoFdA(scaleId, date, shift) {
  const pid = escalaProfId();
  if (!pid) return;
  const dpRes = await ScaleService.listDayPreferences(scaleId);
  const cur = (dpRes.success ? dpRes.data : []).find(p => p.personId === pid && p.date === date);
  if (!cur || !cur.pref) { toast('Marque Prefiro/Pode ser antes de ajustar o turno.', 'info'); return; }
  const set = new Set(cur.excludedShifts || []);
  if (set.has(shift)) set.delete(shift); else set.add(shift);
  const res = await ScaleService.setDayPreference(scaleId, pid, date, cur.pref, Array.from(set));
  if (res.success) renderEscalaPrefs();
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}
```

- [ ] **Step 3: Exportar** — adicionar no bloco de exports:

```js
window.marcarDiaFdA = marcarDiaFdA;
window.toggleTurnoFdA = toggleTurnoFdA;
```

- [ ] **Step 4: Parse check**

Run: `node -e "new Function(require('fs').readFileSync('professores-escala-smart.js','utf8').replace(/^\xEF\xBB\xBF/,'')); console.log('sintaxe OK')"`
Expected: `sintaxe OK`.

- [ ] **Step 5: Commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala): fim de ano na visao do professor (candidatura por data + turno)"
```

---

## Task 7: UI — abas Eventos e Escola Interna do professor (read-only)

**Files:** Modify `professores-escala-smart.js` (substituir os stubs `renderProfEventos`/`renderProfEscolaInterna`).

- [ ] **Step 1: Implementar `renderProfEventos`** (read-only informativo):

```js
function renderProfEventos() {
  let docs = EscalaSmartState.scales.filter(s => s.tipo === 'evento');
  docs = ScaleService.filterByTimeframe(docs, escalaTodayISO(), EscalaSmartState.timeframe);
  if (!docs.length) return `<p style="padding:20px;color:var(--text2);">Nenhum evento ${EscalaSmartState.timeframe === 'futuros' ? 'próximo' : ''}.</p>`;
  return docs.map(s => {
    const kind = s.eventKind === 'externo' ? 'Externo' : 'Interno';
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;">
      <div><div style="font-weight:600;font-size:14px;">${s.name || s.date}</div><div style="font-size:12px;color:var(--text2);">${escalaFmtBR(s.date)} · ${kind}</div></div>
      <span style="font-size:12px;color:var(--text3);">informativo</span>
    </div>`;
  }).join('');
}
```

- [ ] **Step 2: Implementar `renderProfEscolaInterna`** (read-only, destaca onde o professor lidera):

```js
function renderProfEscolaInterna(pid) {
  let docs = EscalaSmartState.scales.filter(s => s.tipo === 'escola_interna');
  docs = ScaleService.filterByTimeframe(docs, escalaTodayISO(), EscalaSmartState.timeframe);
  if (!docs.length) return `<p style="padding:20px;color:var(--text2);">Nenhuma sessão de Escola Interna ${EscalaSmartState.timeframe === 'futuros' ? 'próxima' : ''}.</p>`;
  return docs.map(s => {
    const souLider = (s.slots || []).some(sl => sl.role === 'lider' && sl.assignedPersonId === pid);
    const right = souLider
      ? `<span style="font-size:12px;color:#caa23a;font-weight:600;">★ Você lidera</span>`
      : `<span style="font-size:12px;color:var(--text3);">—</span>`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;">
      <div><div style="font-weight:600;font-size:14px;">${s.name || s.date}</div><div style="font-size:12px;color:var(--text2);">${escalaFmtBR(s.date)}</div></div>
      ${right}
    </div>`;
  }).join('');
}
```

- [ ] **Step 3: Parse check**

Run: `node -e "new Function(require('fs').readFileSync('professores-escala-smart.js','utf8').replace(/^\xEF\xBB\xBF/,'')); console.log('sintaxe OK')"`
Expected: `sintaxe OK`.

- [ ] **Step 4: Commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala): abas Eventos e Escola Interna na visao do professor (read-only)"
```

---

## Task 8: Verificação final + deploy das rules no staging

**Files:** nenhum (verificação + deploy).

- [ ] **Step 1: Suíte de smokes + parse**

```bash
cd "C:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes" && node scripts/smoke-escala-frente2.js && node scripts/smoke-escala-frente1.js && node scripts/smoke-scale-service.js && node scripts/smoke-escala-tabs.js && node scripts/smoke-notify-service.js && node -e "new Function(require('fs').readFileSync('professores-escala-smart.js','utf8').replace(/^\xEF\xBB\xBF/,'')); console.log('escala-smart OK')"
```
Expected: todos verdes.

- [ ] **Step 2: Deploy das rules + hosting no staging** (PEDIR OK ao usuário antes — regra 7; a coleção `scale_day_preferences` PRECISA da regra no ar senão o professor não grava):

```bash
cd "C:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes" && firebase deploy --only firestore:rules,hosting --project staging
```

- [ ] **Step 3: Validar a regra por REST** (Admin SDK bypassa rules — usar token de professor). Seguir o padrão de validação do projeto ([[feedback-deploy-rules-explicito]]): confirmar que um professor consegue gravar `scale_day_preferences` com o próprio `personId` e é negado com outro. Registrar o resultado.

- [ ] **Step 4: Checklist E2E staging** (browser, `professor.teste@` e `dono.teste@`):
- [ ] Professor vê as **5 abas**; datas futuras por padrão (toggle Próximos/Passados funciona).
- [ ] Sábados/Feriados: janela aberta → marca Prefiro/Pode ser/Não posso; consolidada → "✓ Você está escalado" / "Não escalado".
- [ ] Fim de ano: marca o dia (Prefiro/Pode ser/Não posso); com o dia marcado, **desmarca um turno**; após o prazo, tudo read-only.
- [ ] Eventos: lista informativa. Escola Interna: destaca "★ Você lidera" onde aplicável.
- [ ] Gestão consolida o fim de ano e a preferência por dia×turno é respeitada (quem excluiu Tarde-Noite não cai à tarde).
- [ ] Console limpo.

- [ ] **Step 5: Commit (se houver ajuste de E2E)**

```bash
git add -A && git commit -m "chore(escala): ajustes de E2E da Frente 2 no staging"
```

---

## Notas de execução

- **Rules OBRIGATÓRIAS no staging** antes do E2E do professor (diferente da Frente 1, que não precisou de rules novas). Sem a regra de `scale_day_preferences`, o `setDayPreference` do professor falha por permissão.
- **`consolidateByDay`**: retrocompat garantida (sem `scale_day_preferences` = todos disponíveis) — escalas de fim de ano da Frente 1 seguem consolidando igual.
- **Fora de escopo:** Frente 3 (staff de evento + convite + lembretes 7/4/1d) — a aba Eventos do professor fica informativa até lá.
- **Produção só após homologação** (CLAUDE.md §7).
