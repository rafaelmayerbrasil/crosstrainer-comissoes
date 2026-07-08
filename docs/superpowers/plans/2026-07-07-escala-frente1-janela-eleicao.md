# Escala Inteligente · Frente 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o ciclo da janela de eleição da Escala Inteligente (janela manual com prazo, abrir várias em lote, prévia consolidada), a aba Escola Interna (líder manual), e o rename Chamada→Confirmar Presença — com aviso in-app via uma camada `notify` pronta pra e-mail.

**Architecture:** Estende os módulos UMD já existentes (`scale-service.js`, `notify-service.js` novo) com helpers puros testáveis por smoke Node (`_fake-firestore.js`), e a UI em `professores-escala-smart.js` renderiza sobre esses helpers. Toda lógica de regra vive em helpers puros ou no serviço (testados); a UI fica fina. Notificação in-app grava na coleção `notifications` no shape que o sino (`NotificationService` / `professores-shared.js`) já lê.

**Tech Stack:** HTML/CSS/JS vanilla (sem framework), módulos UMD, Firebase Firestore, smokes Node com `assert` + fake-firestore. Sem build step.

**Spec:** `docs/superpowers/specs/2026-07-07-escala-frente1-janela-eleicao-design.md`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Ação |
|---------|------------------|------|
| `notify-service.js` | Camada de notificação: fan-out por destinatário + abstração de canal (inapp hoje, email stub). Grava no shape de `notifications`. | **criar** |
| `scale-service.js` | + `openElection({closesAt,batchId})`, `closeElection` carimba, `listScalesByBatch`, `assignSlot` (líder manual), + helpers puros `isWindowOpen`, `filterByTimeframe`, `buildConsolidationMatrix`, `escolaInternaSlots` | modificar |
| `professores-escala-smart.js` | UI: toggle histórico, multi-seleção + abrir em lote, contagem regressiva no prof, tela Revisão de Fechamento, aba Escola Interna | modificar |
| `professores-nav.js` | rename `Chamada`→`Confirmar Presença` | modificar |
| `professores-engajamento.js` | pré-selecionar líder planejado (escala) na Confirmar Presença | modificar |
| `scripts/smoke-notify-service.js` | testes da camada notify | **criar** |
| `scripts/smoke-escala-frente1.js` | testes dos helpers/serviço novos da escala | **criar** |
| `scripts/smoke-sidebar.js` | atualizar asserção do label (se houver) | modificar |

**Ordem de execução:** Tasks 1–4 (serviços/helpers puros, TDD real) → Task 5 (rename) → Tasks 6–10 (UI sobre os helpers) → Task 11 (integração). Cada task commita ao final.

---

## Task 1: Camada `notify` — builder puro + send + resolver

**Files:**
- Create: `notify-service.js`
- Test: `scripts/smoke-notify-service.js`

Padrão UMD igual `scale-service.js`. `buildNotifDocs` é puro (testável direto); `send` grava; `resolveActiveTeacherUserIds` resolve papel→userIds (IO, testado com fake-db).

- [ ] **Step 1: Escrever o teste que falha**

Create `scripts/smoke-notify-service.js`:

```js
'use strict';
// Roda: node scripts/smoke-notify-service.js
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const NS = require('../notify-service.js');
const deps = (db) => ({ db, ts: () => 'TS' });

(async () => {
  // ── buildNotifDocs (puro) ──
  const docs = NS.buildNotifDocs({
    recipients: ['u1', 'u2'],
    type: 'scale_window_open',
    title: 'Janela aberta',
    body: 'Candidate-se até 20/07',
    link: { type: 'escala', id: 'b1' },
  });
  assert.strictEqual(docs.length, 2, 'um doc por destinatário');
  assert.strictEqual(docs[0].recipientUserId, 'u1');
  assert.strictEqual(docs[0].isRead, false, 'nasce não-lido');
  assert.strictEqual(docs[0].type, 'scale_window_open');
  assert.deepStrictEqual(docs[1].link, { type: 'escala', id: 'b1' });
  assert.deepStrictEqual(NS.buildNotifDocs({ recipients: [], type: 't' }), [], 'sem destinatário = vazio');
  console.log('✓ buildNotifDocs OK');

  // ── send inapp grava N docs em notifications ──
  const db = makeFakeDb();
  const d = deps(db);
  const r = await NS.send({ recipients: ['u1', 'u2'], type: 'scale_window_open', title: 'T', body: 'B', channels: ['inapp'] }, d);
  assert.ok(r.success && r.data.inapp === 2, 'gravou 2 notificações in-app');
  const all = await db.collection('notifications').get();
  assert.strictEqual(all.docs.length, 2, 'coleção notifications tem 2');
  assert.strictEqual(all.docs[0].data().isRead, false);
  console.log('✓ send inapp OK');

  // ── email é stub (não grava, não quebra) ──
  const r2 = await NS.send({ recipients: ['u1'], type: 't', channels: ['email'] }, d);
  assert.ok(r2.success && r2.data.email === 0, 'email é no-op nesta fase');
  console.log('✓ send email stub OK');

  // ── resolveActiveTeacherUserIds: teachers ativos → userIds ──
  await db.collection('teachers').doc('t1').set({ name: 'Ana', isActive: true, userId: 'uAna' });
  await db.collection('teachers').doc('t2').set({ name: 'Bia', isActive: true }); // sem userId → busca em users
  await db.collection('teachers').doc('t3').set({ name: 'Ex', isActive: false });  // inativo → fora
  await db.collection('users').doc('uBia').set({ professorId: 't2' });
  const ids = await NS.resolveActiveTeacherUserIds(d);
  assert.deepStrictEqual(ids.data.sort(), ['uAna', 'uBia'], 'resolve ativos com/sem userId, ignora inativo');
  console.log('✓ resolveActiveTeacherUserIds OK');

  console.log('\n✅ smoke-notify-service: tudo OK');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `node scripts/smoke-notify-service.js`
Expected: FAIL — `Cannot find module '../notify-service.js'`.

- [ ] **Step 3: Implementar `notify-service.js`**

Create `notify-service.js`:

```js
// notify-service.js — camada de notificação (in-app hoje; e-mail é ponto de extensão)
// Grava no shape da coleção `notifications` que o sino (NotificationService) já lê.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NotifyService = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function rdb(deps) { if (deps && deps.db) return deps.db; return (typeof db !== 'undefined') ? db : null; }
  function rts(deps) { if (deps && deps.ts) return deps.ts(); return (typeof serverTs === 'function') ? serverTs() : new Date().toISOString(); }

  // PURO: monta os docs de notificação (1 por destinatário) no shape do sino.
  function buildNotifDocs({ recipients, type, title, body, link }) {
    return (recipients || []).map(uid => ({
      recipientUserId: uid,
      type: type || 'geral',
      title: title || 'Notificação',
      body: body || '',
      link: link || null,
      isRead: false,
      readAt: null,
    }));
  }

  // Resolve professores ativos → userIds (via teacher.userId OU users.professorId).
  async function resolveActiveTeacherUserIds(deps) {
    try {
      const database = rdb(deps);
      const snap = await database.collection('teachers').where('isActive', '==', true).get();
      const out = [];
      for (const doc of snap.docs) {
        const t = doc.data();
        let uid = t.userId || null;
        if (!uid) {
          const us = await database.collection('users').where('professorId', '==', doc.id).get();
          if (us.docs.length) uid = us.docs[0].id;
        }
        if (uid) out.push(uid);
      }
      return { success: true, data: out };
    } catch (err) { console.error('[NotifyService.resolveActiveTeacherUserIds]', err); return { success: false, error: err.message }; }
  }

  // Dispara para os canais pedidos. channels default ['inapp'].
  // 'email' é stub declarado: assinatura pronta, sem envio nesta fase.
  async function send({ recipients, type, title, body, link, channels }, deps) {
    try {
      const chs = channels && channels.length ? channels : ['inapp'];
      const result = { inapp: 0, email: 0 };
      if (chs.includes('inapp')) {
        const docs = buildNotifDocs({ recipients, type, title, body, link });
        const database = rdb(deps);
        for (const nd of docs) {
          await database.collection('notifications').add(Object.assign({}, nd, { createdAt: rts(deps) }));
          result.inapp++;
        }
      }
      // 'email': ponto de extensão — quando a infra de e-mail entrar, enfileirar aqui.
      return { success: true, data: result };
    } catch (err) { console.error('[NotifyService.send]', err); return { success: false, error: err.message }; }
  }

  return { buildNotifDocs, resolveActiveTeacherUserIds, send };
});
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `node scripts/smoke-notify-service.js`
Expected: PASS — todas as linhas `✓` + `✅ smoke-notify-service: tudo OK`.

- [ ] **Step 5: Registrar o script no browser (carregamento)**

Modify `professores.html`: adicionar `<script src="notify-service.js"></script>` **antes** de `professores-escala-smart.js` e `professores-engajamento.js`. Localize a linha que carrega `scale-service.js` e adicione logo após:

```html
<script src="scale-service.js"></script>
<script src="notify-service.js"></script>
```

- [ ] **Step 6: Commit**

```bash
git add notify-service.js scripts/smoke-notify-service.js professores.html
git commit -m "feat(notify): camada de notificação in-app com canal email como stub"
```

---

## Task 2: `scale-service.js` — janela com prazo + lote (`openElection`, `listScalesByBatch`)

**Files:**
- Modify: `scale-service.js` (`openElection`, `closeElection`, novo `listScalesByBatch`)
- Test: `scripts/smoke-escala-frente1.js` (criar)

- [ ] **Step 1: Escrever o teste que falha**

Create `scripts/smoke-escala-frente1.js`:

```js
'use strict';
// Roda: node scripts/smoke-escala-frente1.js
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'tester' });

(async () => {
  const db = makeFakeDb();
  const d = deps(db);

  // cria 2 escalas e abre em lote com prazo + batchId
  const a = (await SS.createScale({ date: '2026-07-11', tipo: 'sabado', name: 'Sáb 11', slots: [] }, d)).data;
  const b = (await SS.createScale({ date: '2026-07-18', tipo: 'sabado', name: 'Sáb 18', slots: [] }, d)).data;
  await SS.openElection(a.id, { closesAt: '2026-07-08T23:59', batchId: 'batch1' }, d);
  await SS.openElection(b.id, { closesAt: '2026-07-08T23:59', batchId: 'batch1' }, d);

  const ga = (await SS.getScale(a.id, d)).data;
  assert.strictEqual(ga.status, 'janela_aberta', 'status vira janela_aberta');
  assert.strictEqual(ga.windowClosesAt, '2026-07-08T23:59', 'prazo gravado');
  assert.strictEqual(ga.windowBatchId, 'batch1', 'batchId gravado');
  assert.ok(ga.windowOpenedAt, 'carimbo de abertura');
  console.log('✓ openElection com prazo/batch OK');

  // listScalesByBatch agrupa só as do lote
  const byBatch = await SS.listScalesByBatch('batch1', d);
  assert.strictEqual(byBatch.data.length, 2, 'as 2 do lote');
  const ids = byBatch.data.map(s => s.id).sort();
  assert.deepStrictEqual(ids, [a.id, b.id].sort());
  console.log('✓ listScalesByBatch OK');

  // closeElection carimba fechamento
  await SS.closeElection(a.id, d);
  const ca = (await SS.getScale(a.id, d)).data;
  assert.strictEqual(ca.status, 'rascunho', 'volta pra rascunho ao fechar');
  assert.ok(ca.windowClosedAt, 'carimbo de fechamento');
  console.log('✓ closeElection carimba OK');

  console.log('\n✅ smoke-escala-frente1 (Task 2) OK');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-escala-frente1.js`
Expected: FAIL — `openElection` ignora o 2º argumento hoje; `windowClosesAt` fica `undefined`; `SS.listScalesByBatch is not a function`.

- [ ] **Step 3: Alterar `openElection`/`closeElection` e adicionar `listScalesByBatch`**

Em `scale-service.js`, **substituir** as linhas atuais (132-133):

```js
  async function openElection(id, deps)  { return setStatus(id, 'janela_aberta', deps); }
  async function closeElection(id, deps) { return setStatus(id, 'rascunho', deps); }
```

por:

```js
  async function openElection(id, opts, deps) {
    try {
      const patch = { status: 'janela_aberta', windowOpenedAt: rts(deps), windowClosedAt: null,
        updatedAt: rts(deps), updatedBy: ruid(deps) };
      if (opts && opts.closesAt) patch.windowClosesAt = opts.closesAt;
      if (opts && opts.batchId) patch.windowBatchId = opts.batchId;
      await rdb(deps).collection('special_scales').doc(id).set(patch, { merge: true });
      return { success: true };
    } catch (err) { console.error('[ScaleService.openElection]', err); return { success: false, error: err.message }; }
  }
  async function closeElection(id, deps) {
    try {
      await rdb(deps).collection('special_scales').doc(id)
        .set({ status: 'rascunho', windowClosedAt: rts(deps), updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      return { success: true };
    } catch (err) { console.error('[ScaleService.closeElection]', err); return { success: false, error: err.message }; }
  }

  async function listScalesByBatch(batchId, deps) {
    try {
      const snap = await rdb(deps).collection('special_scales').where('windowBatchId', '==', batchId).get();
      const data = snap.docs.map(dd => ({ id: dd.id, ...dd.data() })).filter(s => !isLegacyScaleDoc(s));
      return { success: true, data };
    } catch (err) { console.error('[ScaleService.listScalesByBatch]', err); return { success: false, error: err.message }; }
  }
```

- [ ] **Step 4: Exportar `listScalesByBatch` no return do módulo**

Em `scale-service.js`, no `return { ... }` final (linha ~378), adicionar `listScalesByBatch` após `closeElection`:

```js
  return { templateSlots, templateSlotsFimDeAno, datesInRange, saturdaysOfYear, mergeVirtualWithDocs, parseFeriados, isLegacyScaleDoc, ScaleConfigService, createScale, getScale, listScales, listScalesByBatch, openElection, closeElection, setStatus, setPreference, listPreferences, getFairness, saveFairness, applyFairnessDelta, buildCandidates, consolidate, consolidateByDay, publishToAgenda, unpublishFromAgenda };
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node scripts/smoke-escala-frente1.js`
Expected: PASS — `✅ smoke-escala-frente1 (Task 2) OK`.

- [ ] **Step 6: Atualizar o chamador existente de `openElection` na UI**

Em `professores-escala-smart.js`, a função `abrirJanelaEscala` (linha ~509) chama `ScaleService.openElection(id)`. Ela será reescrita na Task 7 (pra pedir prazo). Por ora, garantir que não quebre: `openElection(id)` sem `opts` ainda funciona (opts é opcional). **Nenhuma mudança necessária neste passo** — só confira que `abrirJanelaEscala` continua chamando `openElection(id)` e roda o smoke da Task 2.

- [ ] **Step 7: Commit**

```bash
git add scale-service.js scripts/smoke-escala-frente1.js
git commit -m "feat(escala): janela com prazo/lote (openElection opts + listScalesByBatch)"
```

---

## Task 3: `scale-service.js` — helper `isWindowOpen` + bloqueio de preferência pós-prazo

**Files:**
- Modify: `scale-service.js` (helper puro `isWindowOpen`; `setPreference` valida prazo)
- Test: `scripts/smoke-escala-frente1.js` (adicionar bloco)

- [ ] **Step 1: Adicionar o teste que falha**

Em `scripts/smoke-escala-frente1.js`, **antes** da linha final `console.log('\n✅ smoke-escala-frente1 (Task 2) OK');`, inserir:

```js
  // ── isWindowOpen (puro) ──
  assert.strictEqual(SS.isWindowOpen({ status: 'janela_aberta', windowClosesAt: '2026-07-10T23:59' }, '2026-07-08T10:00'), true, 'aberta antes do prazo');
  assert.strictEqual(SS.isWindowOpen({ status: 'janela_aberta', windowClosesAt: '2026-07-10T23:59' }, '2026-07-11T00:00'), false, 'fechada após o prazo');
  assert.strictEqual(SS.isWindowOpen({ status: 'janela_aberta' }, '2026-07-11T00:00'), true, 'sem prazo = aberta enquanto status permitir');
  assert.strictEqual(SS.isWindowOpen({ status: 'consolidada', windowClosesAt: '2999-01-01T00:00' }, '2026-07-08T10:00'), false, 'status não-aberto = fechada');
  console.log('✓ isWindowOpen OK');

  // ── setPreference recusa após o prazo ──
  const c = (await SS.createScale({ date: '2026-07-25', tipo: 'sabado', name: 'Sáb 25', slots: [] }, d)).data;
  await SS.openElection(c.id, { closesAt: '2000-01-01T00:00' }, d); // prazo no passado
  const blocked = await SS.setPreference(c.id, 'p1', 'prefiro', d);
  assert.strictEqual(blocked.success, false, 'preferência recusada após prazo');
  assert.match(blocked.error, /encerrada|prazo/i, 'mensagem de janela encerrada');
  // dentro do prazo passa
  await SS.openElection(c.id, { closesAt: '2999-01-01T00:00' }, d);
  const ok = await SS.setPreference(c.id, 'p1', 'prefiro', d);
  assert.ok(ok.success, 'preferência aceita dentro do prazo');
  console.log('✓ setPreference respeita prazo OK');
```

E trocar a linha final para `console.log('\n✅ smoke-escala-frente1 (Task 3) OK');`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-escala-frente1.js`
Expected: FAIL — `SS.isWindowOpen is not a function`.

- [ ] **Step 3: Implementar `isWindowOpen` e validar em `setPreference`**

Em `scale-service.js`, adicionar o helper puro logo após `isLegacyScaleDoc` (linha ~65):

```js
  // Janela aberta? status precisa ser 'janela_aberta' E (sem prazo OU nowISO <= windowClosesAt).
  // Comparação lexicográfica de ISO funciona porque o formato é ordenável.
  function isWindowOpen(scale, nowISO) {
    if (!scale || scale.status !== 'janela_aberta') return false;
    if (!scale.windowClosesAt) return true;
    return String(nowISO) <= String(scale.windowClosesAt);
  }
```

Em `setPreference` (linha ~135), **substituir** o corpo por uma versão que lê a escala e valida o prazo:

```js
  async function setPreference(scaleId, personId, pref, deps) {
    try {
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      const nowISO = (deps && deps.now) ? deps.now() : new Date().toISOString().slice(0, 16);
      if (!isWindowOpen(scaleRes.data, nowISO)) {
        return { success: false, error: 'Janela de preferências encerrada.' };
      }
      await rdb(deps).collection('scale_preferences').doc(`${scaleId}__${personId}`)
        .set({ scaleId, personId, pref, updatedAt: rts(deps) });
      return { success: true };
    } catch (err) { console.error('[ScaleService.setPreference]', err); return { success: false, error: err.message }; }
  }
```

- [ ] **Step 4: Exportar `isWindowOpen`**

No `return { ... }` final, adicionar `isWindowOpen` após `isLegacyScaleDoc`.

- [ ] **Step 5: Rodar e ver passar**

Run: `node scripts/smoke-escala-frente1.js`
Expected: PASS — `✓ isWindowOpen OK`, `✓ setPreference respeita prazo OK`, `✅ smoke-escala-frente1 (Task 3) OK`.

- [ ] **Step 6: Commit**

```bash
git add scale-service.js scripts/smoke-escala-frente1.js
git commit -m "feat(escala): bloqueio de preferência após o prazo da janela (isWindowOpen)"
```

---

## Task 4: `scale-service.js` — helpers de matriz consolidada, timeframe, e Escola Interna

**Files:**
- Modify: `scale-service.js` (`filterByTimeframe`, `buildConsolidationMatrix`, `escolaInternaSlots`, `assignSlot`)
- Test: `scripts/smoke-escala-frente1.js` (adicionar bloco)

- [ ] **Step 1: Adicionar o teste que falha**

Em `scripts/smoke-escala-frente1.js`, antes da linha final, inserir:

```js
  // ── filterByTimeframe (puro): futuros ≥ hoje / passados < hoje ──
  const rows = [{ date: '2026-07-01' }, { date: '2026-07-08' }, { date: '2026-07-20' }];
  assert.deepStrictEqual(SS.filterByTimeframe(rows, '2026-07-08', 'futuros').map(r => r.date), ['2026-07-08', '2026-07-20'], 'futuros inclui hoje');
  assert.deepStrictEqual(SS.filterByTimeframe(rows, '2026-07-08', 'passados').map(r => r.date), ['2026-07-01'], 'passados < hoje');
  assert.strictEqual(SS.filterByTimeframe(rows, '2026-07-08', 'todos').length, 3, 'todos = tudo');
  console.log('✓ filterByTimeframe OK');

  // ── buildConsolidationMatrix (puro) ──
  const scales = [
    { id: 's1', date: '2026-07-11', name: 'Sáb 11', slots: [{ assignedPersonId: 'p1' }, { assignedPersonId: null }] },
    { id: 's2', date: '2026-07-18', name: 'Sáb 18', slots: [{ assignedPersonId: 'p2' }, { assignedPersonId: 'p1' }] },
  ];
  const prefs = { s1: [{ personId: 'p1', pref: 'prefiro' }], s2: [{ personId: 'p2', pref: 'pode_ser' }] };
  const people = [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bia' }, { id: 'p3', name: 'Caio' }];
  const m = SS.buildConsolidationMatrix(scales, prefs, people);
  assert.deepStrictEqual(m.semCandidatura.map(p => p.id), ['p3'], 'p3 não se candidatou a nada');
  assert.strictEqual(m.vagasAbertas, 1, 's1 tem 1 vaga aberta');
  const anaRow = m.grid.find(g => g.person.id === 'p1');
  assert.strictEqual(anaRow.cells.s1.pref, 'prefiro', 'Ana prefiro em s1');
  assert.strictEqual(anaRow.cells.s1.assigned, true, 'Ana escalada em s1');
  console.log('✓ buildConsolidationMatrix OK');

  // ── escolaInternaSlots (puro): 1 vaga de líder por unidade/sessão ──
  const eiSlots = SS.escolaInternaSlots([{ id: 'unit-cp', name: 'CP' }], { startTime: '14:30', endTime: '15:30' });
  assert.strictEqual(eiSlots.length, 1, '1 slot por unidade');
  assert.strictEqual(eiSlots[0].role, 'lider', 'slot é de líder');
  assert.strictEqual(eiSlots[0].startTime, '14:30');
  assert.strictEqual(eiSlots[0].assignedPersonId, null, 'nasce vago');
  console.log('✓ escolaInternaSlots OK');

  // ── assignSlot (IO): atribui líder manual sem consolidate ──
  const ei = (await SS.createScale({ date: '2026-07-13', tipo: 'escola_interna', name: 'Escola 13/07', slots: eiSlots }, d)).data;
  const as = await SS.assignSlot(ei.id, eiSlots[0].id, 'p1', d);
  assert.ok(as.success, 'atribuiu');
  const eiG = (await SS.getScale(ei.id, d)).data;
  assert.strictEqual(eiG.slots[0].assignedPersonId, 'p1', 'líder gravado no slot');
  // desatribuir com null
  await SS.assignSlot(ei.id, eiSlots[0].id, null, d);
  assert.strictEqual((await SS.getScale(ei.id, d)).data.slots[0].assignedPersonId, null, 'desatribuiu');
  console.log('✓ assignSlot OK');
```

Trocar a linha final para `console.log('\n✅ smoke-escala-frente1 (Task 4) OK');`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-escala-frente1.js`
Expected: FAIL — `SS.filterByTimeframe is not a function`.

- [ ] **Step 3: Implementar os 4 helpers**

Em `scale-service.js`, adicionar após `isWindowOpen`:

```js
  // Filtra linhas com {date:'YYYY-MM-DD'} por período relativo a todayISO.
  function filterByTimeframe(rows, todayISO, tf) {
    if (tf === 'todos') return (rows || []).slice();
    if (tf === 'passados') return (rows || []).filter(r => r.date < todayISO);
    return (rows || []).filter(r => r.date >= todayISO); // 'futuros' (default), inclui hoje
  }

  // Matriz da prévia de fechamento: pessoas × escalas.
  // prefsByScale: { scaleId: [{personId, pref}] }. people: [{id, name}].
  function buildConsolidationMatrix(scales, prefsByScale, people) {
    const prefLookup = {}; // prefLookup[scaleId][personId] = pref
    (scales || []).forEach(s => {
      prefLookup[s.id] = {};
      ((prefsByScale || {})[s.id] || []).forEach(p => { prefLookup[s.id][p.personId] = p.pref; });
    });
    const assignedByScale = {};
    (scales || []).forEach(s => {
      assignedByScale[s.id] = new Set((s.slots || []).map(sl => sl.assignedPersonId).filter(Boolean));
    });
    const grid = (people || []).map(person => {
      const cells = {};
      (scales || []).forEach(s => {
        cells[s.id] = {
          pref: (prefLookup[s.id] || {})[person.id] || null,
          assigned: assignedByScale[s.id].has(person.id),
        };
      });
      return { person, cells };
    });
    const semCandidatura = (people || []).filter(person =>
      (scales || []).every(s => !(prefLookup[s.id] || {})[person.id])
    );
    let vagasAbertas = 0;
    (scales || []).forEach(s => { (s.slots || []).forEach(sl => { if (!sl.assignedPersonId) vagasAbertas++; }); });
    return { grid, semCandidatura, vagasAbertas };
  }

  // Vagas da Escola Interna: 1 líder por unidade (sessão diária Seg–Sex, hora configurável).
  function escolaInternaSlots(units, times) {
    const t = times || {};
    return (units || []).map(u => ({
      id: `${u.id}_LIDER`, unitId: u.id, role: 'lider',
      requiredModalityId: null, assignedPersonId: null,
      startTime: t.startTime || '14:30', endTime: t.endTime || '15:30',
    }));
  }

  // Atribuição manual de pessoa a um slot (líder da Escola Interna, ou override).
  async function assignSlot(scaleId, slotId, personId, deps) {
    try {
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      const slots = (scaleRes.data.slots || []).map(s =>
        s.id === slotId ? Object.assign({}, s, { assignedPersonId: personId || null }) : s);
      await rdb(deps).collection('special_scales').doc(scaleId)
        .set({ slots, updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      return { success: true };
    } catch (err) { console.error('[ScaleService.assignSlot]', err); return { success: false, error: err.message }; }
  }
```

- [ ] **Step 4: Exportar os 4 no return do módulo**

Adicionar `filterByTimeframe, buildConsolidationMatrix, escolaInternaSlots, assignSlot` no `return { ... }` final.

- [ ] **Step 5: Rodar e ver passar**

Run: `node scripts/smoke-escala-frente1.js`
Expected: PASS — `✓ filterByTimeframe OK`, `✓ buildConsolidationMatrix OK`, `✓ escolaInternaSlots OK`, `✓ assignSlot OK`, `✅ smoke-escala-frente1 (Task 4) OK`.

- [ ] **Step 6: Commit**

```bash
git add scale-service.js scripts/smoke-escala-frente1.js
git commit -m "feat(escala): helpers puros de timeframe, matriz consolidada e Escola Interna"
```

---

## Task 5: Rename Chamada → Confirmar Presença

**Files:**
- Modify: `professores-nav.js:39`
- Modify: `professores-engajamento.js` (título da página engaj-chamada, se houver "Chamada" visível)
- Modify: `scripts/smoke-sidebar.js` (se asserta o label)

- [ ] **Step 1: Ver se o smoke da sidebar asserta o label antigo**

Run: `grep -n "Chamada" scripts/smoke-sidebar.js professores-engajamento.js professores-nav.js`
Expected: mostra `professores-nav.js:39` com `label: 'Chamada'` + eventuais títulos.

- [ ] **Step 2: Renomear no nav**

Em `professores-nav.js`, linha 39, trocar:

```js
    { id: 'engaj-chamada',  label: 'Chamada',           icon: '✅', section: 'Engajamento' },
```

por:

```js
    { id: 'engaj-chamada',  label: 'Confirmar Presença', icon: '✅', section: 'Engajamento' },
```

- [ ] **Step 3: Renomear o título da página (se existir "Chamada" visível)**

Em `professores-engajamento.js`, procurar o cabeçalho da tela de chamada (ex.: `<h1>...Chamada...`). Se houver um título visível "Chamada", trocar por "Confirmar Presença". Se o título já for genérico (ex.: usa o label do nav), nenhuma mudança. Use:

Run: `grep -n "Chamada" professores-engajamento.js`
E ajuste só os textos **visíveis ao usuário** (não IDs/keys como `engaj-chamada` ou `kind`).

- [ ] **Step 4: Atualizar o smoke da sidebar se necessário**

Se o Step 1 mostrou o label `'Chamada'` asserido em `scripts/smoke-sidebar.js`, trocar para `'Confirmar Presença'`. Rodar:

Run: `node scripts/smoke-sidebar.js`
Expected: PASS (ou o mesmo estado pré-existente documentado na sessão 40 — se já falhava por outro motivo, confirmar que a falha não é do label).

- [ ] **Step 5: Commit**

```bash
git add professores-nav.js professores-engajamento.js scripts/smoke-sidebar.js
git commit -m "feat(nav): renomeia Chamada para Confirmar Presenca"
```

---

## Task 6: UI — toggle "Mostrar passados" nas abas Sábados/Feriados/Eventos

**Files:**
- Modify: `professores-escala-smart.js` (state `timeframe`, toggle no header, aplica `filterByTimeframe`)

A lógica pura (`filterByTimeframe`) já está testada (Task 4). Aqui é só fiação de UI.

- [ ] **Step 1: Adicionar estado de timeframe**

Em `professores-escala-smart.js`, no `EscalaSmartState` (linha 9), adicionar `timeframe: 'futuros'`:

```js
const EscalaSmartState = { scales: [], units: [], modToi: null, modHiit: null, selectedId: null, teacherMap: new Map(), fairnessMap: new Map(), tab: 'sabado', year: new Date().getFullYear(), feriadosByYear: {}, config: null, timeframe: 'futuros' };
```

- [ ] **Step 2: Adicionar o toggle e o setter**

Em `professores-escala-smart.js`, adicionar após `escalaSetYear` (linha ~68):

```js
function escalaSetTimeframe(tf) { EscalaSmartState.timeframe = tf; renderEscalaGestao(); }
```

E no `renderEscalaGestao`, junto do `yearSel` (linha ~185), adicionar um toggle (só para abas com data — não fim de ano):

```js
  const tfSel = (tab === 'fim_de_ano' || tab === 'escola_interna') ? '' :
    `<div style="display:inline-flex;gap:4px;margin-right:8px;">
      ${['futuros', 'todos', 'passados'].map(v => `<button onclick="escalaSetTimeframe('${v}')" style="font-size:12px;padding:6px 10px;border-radius:8px;cursor:pointer;border:1px solid ${EscalaSmartState.timeframe === v ? 'var(--blue)' : 'var(--border)'};background:${EscalaSmartState.timeframe === v ? 'rgba(94,168,255,0.15)' : 'transparent'};color:${EscalaSmartState.timeframe === v ? '#5EA8FF' : 'var(--text2)'};">${v === 'futuros' ? 'Próximos' : v === 'passados' ? 'Passados' : 'Todos'}</button>`).join('')}
    </div>`;
```

E trocar a linha que monta o rodapé de filtros (linha ~200) para incluir `tfSel` antes do `yearSel`:

```js
    <div style="display:flex;justify-content:flex-end;align-items:center;margin-bottom:10px;">${tfSel}${yearSel}</div>
```

- [ ] **Step 3: Aplicar o filtro nas abas de data**

Em `renderTabSabados` (linha ~250), após montar `rows`, aplicar o timeframe usando `escalaTodayISO()`:

```js
function renderTabSabados(scales) {
  let rows = ScaleService.mergeVirtualWithDocs(
    ScaleService.saturdaysOfYear(EscalaSmartState.year),
    scales.filter(s => s.tipo === 'sabado')
  );
  rows = ScaleService.filterByTimeframe(rows, escalaTodayISO(), EscalaSmartState.timeframe);
  const com = rows.filter(r => r.docs.length).length;
  // ...restante idêntico
```

Em `renderTabFeriados` (linha ~230), aplicar em `docs` e `sugestoes` — envolver a lista final por `filterByTimeframe` usando o campo `date`. Após montar `docs` e `sugestoes`, filtrar:

```js
  const tf = EscalaSmartState.timeframe, today = escalaTodayISO();
  const docsF = ScaleService.filterByTimeframe(docs, today, tf);
  const sugF = ScaleService.filterByTimeframe(sugestoes, today, tf);
```

e usar `docsF`/`sugF` na montagem do HTML no lugar de `docs`/`sugestoes`.

Em `renderTabEventos` (linha ~220), trocar o filtro do `docs` para também aplicar timeframe:

```js
  let docs = scales.filter(s => s.tipo === 'evento' && s.date.startsWith(String(EscalaSmartState.year)));
  docs = ScaleService.filterByTimeframe(docs, escalaTodayISO(), EscalaSmartState.timeframe);
```

- [ ] **Step 4: Expor o setter globalmente**

No bloco de exports (linha ~632), adicionar:

```js
window.escalaSetTimeframe = escalaSetTimeframe;
```

- [ ] **Step 5: Verificação de sintaxe**

Run: `node -e "require('fs').readFileSync('professores-escala-smart.js','utf8'); new Function(require('fs').readFileSync('professores-escala-smart.js','utf8').replace(/^﻿/,'')); console.log('sintaxe OK')"`
Expected: `sintaxe OK` (não executa DOM; só valida parse).

- [ ] **Step 6: Commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala): toggle Proximos/Passados/Todos nas abas de data"
```

---

## Task 7: UI — multi-seleção + abrir janela em lote com prazo + aviso

**Files:**
- Modify: `professores-escala-smart.js` (checkboxes nas linhas, barra de ação, modal de prazo, `abrirJanelaLote`, reescreve `abrirJanelaEscala`)

- [ ] **Step 1: Estado de seleção**

Em `EscalaSmartState`, adicionar `selected: new Set()` (datas selecionadas para abrir em lote). Atualizar a linha do state:

```js
const EscalaSmartState = { /* ...campos existentes... */, timeframe: 'futuros', selected: new Set() };
```

- [ ] **Step 2: Checkbox nas linhas de sábado/feriado**

Em `renderTabSabados`, para cada linha SEM doc (a `div` com "Sem escala"), e para cada doc em rascunho, prefixar um checkbox. Ajustar o `body` para incluir, antes do conteúdo de cada linha:

```js
  const cb = (date) => `<input type="checkbox" onclick="event.stopPropagation();escalaToggleSel('${date}')" ${EscalaSmartState.selected.has(date) ? 'checked' : ''} style="margin-right:8px;">`;
```

e inserir `${cb(r.date)}` no início da `div` de cada linha (com e sem escala). Fazer o mesmo em `renderTabFeriados` para as linhas de sugestão e docs em rascunho.

- [ ] **Step 3: Barra de ação quando há seleção**

No `renderEscalaGestao`, logo antes de `<div style="display:grid;grid-template-columns:...`, inserir a barra:

```js
    ${EscalaSmartState.selected.size ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface2);border:1px solid var(--blue);border-radius:10px;padding:10px 12px;margin-bottom:10px;">
      <span style="font-size:13px;">${EscalaSmartState.selected.size} data(s) selecionada(s)</span>
      <div style="display:flex;gap:8px;"><button class="btn-secondary" onclick="escalaLimparSel()">Limpar</button><button class="btn-primary" onclick="openAbrirLote()">📨 Abrir janela nas selecionadas</button></div>
    </div>` : ''}
```

- [ ] **Step 4: Toggle/limpar seleção + modal de prazo + abrir em lote**

Adicionar as funções (após `selectEscala`, linha ~507):

```js
function escalaToggleSel(date) {
  if (EscalaSmartState.selected.has(date)) EscalaSmartState.selected.delete(date);
  else EscalaSmartState.selected.add(date);
  renderEscalaGestao();
}
function escalaLimparSel() { EscalaSmartState.selected.clear(); renderEscalaGestao(); }

function openAbrirLote() {
  const overlay = document.getElementById('escalaModalOverlay'), modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex'; modal.style.display = 'block';
  const datas = Array.from(EscalaSmartState.selected).sort();
  modal.innerHTML = `
    <h2>Abrir janela de preferências</h2>
    <p style="font-size:13px;color:var(--text2);">${datas.length} data(s): ${datas.map(escalaFmtBR).join(', ')}</p>
    <div class="form-group"><label>Fecha em <span style="color:var(--red);">*</span></label>
      <input type="datetime-local" id="loteClosesAt" class="input"></div>
    <p style="font-size:12px;color:var(--text2);">Todos os professores ativos serão avisados no sistema para se candidatarem até essa data.</p>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      <button class="btn-primary" onclick="abrirJanelaLote()">Abrir e avisar</button>
    </div>`;
}

async function abrirJanelaLote() {
  const closesAt = document.getElementById('loteClosesAt').value;
  if (!closesAt) { toast('Informe a data-limite.', 'error'); return; }
  const datas = Array.from(EscalaSmartState.selected).sort();
  const batchId = 'batch_' + Date.now();
  const tipo = EscalaSmartState.tab === 'feriado' ? 'feriado' : 'sabado';
  toast('Abrindo janela…', 'info');
  for (const date of datas) {
    // acha doc existente da data ou cria
    let doc = EscalaSmartState.scales.find(s => s.date === date && s.tipo === tipo);
    if (!doc) {
      const res = await ScaleService.createScale({ date, tipo, name: `${tipo === 'feriado' ? 'Feriado' : 'Sábado'} ${escalaFmtBR(date)}`, slots: escalaSlotsPadrao(tipo) });
      if (!res.success) { toast('Erro ao criar ' + date, 'error'); continue; }
      doc = res.data;
    }
    await ScaleService.openElection(doc.id, { closesAt, batchId });
  }
  // aviso in-app único a todos os professores ativos
  const rec = await NotifyService.resolveActiveTeacherUserIds();
  if (rec.success && rec.data.length) {
    await NotifyService.send({
      recipients: rec.data, type: 'scale_window_open',
      title: 'Janela de escala aberta',
      body: `Candidate-se aos dias ${datas.map(escalaFmtBR).join(', ')} até ${escalaFmtBR(closesAt.slice(0, 10))}.`,
      link: { type: 'escala-smart', id: batchId }, channels: ['inapp'],
    });
  }
  toast(`Janela aberta em ${datas.length} data(s). Time avisado.`, 'success');
  EscalaSmartState.selected.clear();
  closeEscalaModal(); renderEscalaGestao();
}
```

- [ ] **Step 5: Reescrever `abrirJanelaEscala` (abrir individual com prazo)**

Substituir `abrirJanelaEscala` (linha ~509) para abrir o mesmo modal de prazo para 1 escala:

```js
async function abrirJanelaEscala(id) {
  const scale = EscalaSmartState.scales.find(s => s.id === id);
  if (!scale) return;
  EscalaSmartState.selected = new Set([scale.date]);
  openAbrirLote();
}
```

(reusa o fluxo de lote com 1 data; `abrirJanelaLote` cai no doc existente pelo `find`.)

- [ ] **Step 6: Exportar as novas funções**

No bloco de exports, adicionar:

```js
window.escalaToggleSel = escalaToggleSel;
window.escalaLimparSel = escalaLimparSel;
window.openAbrirLote = openAbrirLote;
window.abrirJanelaLote = abrirJanelaLote;
```

- [ ] **Step 7: Verificação de sintaxe**

Run: `node -e "new Function(require('fs').readFileSync('professores-escala-smart.js','utf8').replace(/^﻿/,'')); console.log('sintaxe OK')"`
Expected: `sintaxe OK`.

- [ ] **Step 8: Commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala): abrir janela em lote com prazo e aviso in-app ao time"
```

---

## Task 8: UI (professor) — contagem regressiva + bloqueio após prazo

**Files:**
- Modify: `professores-escala-smart.js` (`renderEscalaPrefs`: mostra prazo, desabilita após o limite)

- [ ] **Step 1: Mostrar prazo e desabilitar após o limite**

Em `renderEscalaPrefs` (linha ~561), ao montar cada linha (`rows`), incluir o prazo e desabilitar os botões se a janela fechou. Substituir a montagem de `rows` por:

```js
  const nowISO = new Date().toISOString().slice(0, 16);
  const rows = abertas.map(s => {
    const open = ScaleService.isWindowOpen(s, nowISO);
    const prazo = s.windowClosesAt ? `Fecha em ${escalaFmtBR(s.windowClosesAt.slice(0, 10))}` : 'Sem prazo definido';
    const botoes = open
      ? `${pbtn(s.id, 'prefiro', 'Prefiro', 'var(--green)')}${pbtn(s.id, 'pode_ser', 'Pode ser', '#5EA8FF')}${pbtn(s.id, 'nao_posso', 'Não posso', 'var(--red)')}`
      : `<span style="font-size:12px;color:var(--red);">Janela encerrada</span>`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;flex-wrap:wrap;">
      <div><div style="font-weight:600;font-size:14px;">${s.name || s.date}</div><div style="font-size:12px;color:var(--text2);">${s.date} · ${prazo}</div></div>
      <div style="display:flex;gap:6px;">${botoes}</div>
    </div>`;
  }).join('');
```

- [ ] **Step 2: Filtrar janelas realmente abertas na carga**

Em `renderEscalaPrefs`, onde monta `abertas` (linha ~570), manter `status==='janela_aberta'` (o prazo é tratado por linha, mostrando "encerrada" quando vencido — evita sumir a escala de vista abruptamente). Nenhuma mudança extra necessária.

- [ ] **Step 3: Verificação de sintaxe**

Run: `node -e "new Function(require('fs').readFileSync('professores-escala-smart.js','utf8').replace(/^﻿/,'')); console.log('sintaxe OK')"`
Expected: `sintaxe OK`.

- [ ] **Step 4: Commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala): prazo visivel e bloqueio na visao de preferencias do professor"
```

---

## Task 9: UI — tela "Revisão de fechamento" (prévia consolidada + confirmar)

**Files:**
- Modify: `professores-escala-smart.js` (`abrirRevisaoLote`, `renderRevisaoFechamento`, `confirmarEAvisar`)

Usa `buildConsolidationMatrix` (Task 4) + `consolidate` (existente) + `NotifyService`.

- [ ] **Step 1: Botão de revisão na barra de ação (para lotes abertos)**

No `renderEscalaGestao`, adicionar — abaixo da barra de seleção — um alerta quando houver escalas com janela aberta e `windowBatchId`, oferecendo revisar. Após carregar `scales`, computar os batches abertos:

```js
  const batchesAbertos = [...new Set(scales.filter(s => s.status === 'janela_aberta' && s.windowBatchId).map(s => s.windowBatchId))];
  const revisaoBar = batchesAbertos.length
    ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:#1a2a3a;border:1px solid var(--blue);border-radius:10px;padding:10px 12px;margin-bottom:10px;">
        <span style="font-size:13px;color:var(--blue);">Há ${batchesAbertos.length} janela(s) em andamento. Feche e revise antes de confirmar.</span>
        <button class="btn-primary" onclick="abrirRevisaoLote('${batchesAbertos[0]}')">🧮 Revisar fechamento</button>
      </div>` : '';
```

e inserir `${revisaoBar}` logo após `${tabsHtml}` no template do container.

- [ ] **Step 2: Montar e renderizar a revisão**

Adicionar as funções (após `abrirJanelaLote`):

```js
async function abrirRevisaoLote(batchId) {
  toast('Carregando revisão…', 'info');
  const byBatch = await ScaleService.listScalesByBatch(batchId);
  if (!byBatch.success || !byBatch.data.length) { toast('Lote não encontrado.', 'error'); return; }
  const scales = byBatch.data;
  // carrega preferências de cada escala
  const prefsByScale = {};
  for (const s of scales) {
    const pr = await ScaleService.listPreferences(s.id);
    prefsByScale[s.id] = pr.success ? pr.data : [];
  }
  const people = Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false).map(t => ({ id: t.id, name: t.name }));
  const matrix = ScaleService.buildConsolidationMatrix(scales, prefsByScale, people);
  renderRevisaoFechamento(batchId, scales, matrix);
}

function renderRevisaoFechamento(batchId, scales, matrix) {
  const overlay = document.getElementById('escalaModalOverlay'), modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex'; modal.style.display = 'block';
  const prefTxt = (p) => p === 'prefiro' ? '★' : p === 'pode_ser' ? '✓' : p === 'nao_posso' ? '✕' : '·';
  const head = `<tr><th style="text-align:left;padding:4px 8px;">Pessoa</th>${scales.map(s => `<th style="padding:4px 8px;font-weight:400;font-size:11px;">${escalaFmtBR(s.date)}</th>`).join('')}</tr>`;
  const body = matrix.grid.map(g => `<tr>
    <td style="padding:4px 8px;${matrix.semCandidatura.some(p => p.id === g.person.id) ? 'color:var(--text3);' : ''}">${g.person.name}</td>
    ${scales.map(s => { const c = g.cells[s.id]; return `<td style="text-align:center;padding:4px 8px;${c.assigned ? 'background:var(--surface3);font-weight:600;' : ''}">${prefTxt(c.pref)}</td>`; }).join('')}
  </tr>`).join('');
  const semCand = matrix.semCandidatura.length
    ? `<p style="font-size:12px;color:#caa23a;margin:8px 0;">Não se candidataram a nada: ${matrix.semCandidatura.map(p => p.name).join(', ')}</p>` : '';
  modal.innerHTML = `
    <h2>Revisão de fechamento</h2>
    <p style="font-size:12px;color:var(--text2);">★ prefiro · ✓ pode ser · ✕ não posso · célula destacada = escalado. Vagas abertas: ${matrix.vagasAbertas}.</p>
    <div style="overflow:auto;max-height:50vh;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    ${semCand}
    <p style="font-size:12px;color:var(--text2);">Ao confirmar, o sistema consolida as vagas abertas por justiça+mérito e avisa todos no sistema.</p>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Fechar</button>
      <button class="btn-primary" onclick="confirmarEAvisar('${batchId}')">✅ Confirmar escala e avisar todos</button>
    </div>`;
}
```

- [ ] **Step 3: Confirmar = consolida cada escala + avisa**

Adicionar:

```js
async function confirmarEAvisar(batchId) {
  const byBatch = await ScaleService.listScalesByBatch(batchId);
  if (!byBatch.success) { toast('Erro ao carregar lote.', 'error'); return; }
  toast('Consolidando…', 'info');
  // reusa o mesmo contexto do consolidarEscala (mérito + opts)
  const teachers = Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false);
  const cyclesRes = await EngagementService.listCycles();
  const cycles = (cyclesRes.success && cyclesRes.data.length) ? cyclesRes.data : [{ id: '_all', inicio: '1900-01-01', fim: escalaTodayISO() }];
  const cycle = (typeof EngagementService.currentCycle === 'function' ? EngagementService.currentCycle(cycles, escalaTodayISO()) : null) || cycles[0];
  const meritoById = {};
  for (const t of teachers) {
    const hire = (t.hireDate && t.hireDate.toDate) ? t.hireDate.toDate().toISOString().slice(0, 10) : null;
    const sb = await EngagementService.scoreboard(t.id, hire, cycle);
    meritoById[t.id] = sb.success ? sb.data.total : 0;
  }
  const ctx = { teachers: teachers.map(t => ({ id: t.id, name: t.name, modalityIds: t.modalityIds || [], primaryUnitId: t.primaryUnitId })), meritoById, opts: { minMes: 1 } };
  for (const s of byBatch.data) {
    await ScaleService.closeElection(s.id);          // carimba fechamento
    await ScaleService.consolidate(s.id, ctx);       // preenche vagas por justiça+mérito
  }
  // avisa todos
  const rec = await NotifyService.resolveActiveTeacherUserIds();
  if (rec.success && rec.data.length) {
    const datas = byBatch.data.map(s => escalaFmtBR(s.date)).join(', ');
    await NotifyService.send({ recipients: rec.data, type: 'scale_confirmed', title: 'Escala confirmada', body: `A escala dos dias ${datas} foi definida. Confira sua agenda.`, link: { type: 'escala-smart', id: batchId }, channels: ['inapp'] });
  }
  toast('Escala confirmada e time avisado.', 'success');
  closeEscalaModal(); renderEscalaGestao();
}
```

- [ ] **Step 4: Exportar**

```js
window.abrirRevisaoLote = abrirRevisaoLote;
window.confirmarEAvisar = confirmarEAvisar;
```

- [ ] **Step 5: Verificação de sintaxe**

Run: `node -e "new Function(require('fs').readFileSync('professores-escala-smart.js','utf8').replace(/^﻿/,'')); console.log('sintaxe OK')"`
Expected: `sintaxe OK`.

- [ ] **Step 6: Commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala): tela de revisao de fechamento (previa consolidada + confirmar e avisar)"
```

---

## Task 10: UI — aba Escola Interna (líder manual pela gestão)

**Files:**
- Modify: `professores-escala-smart.js` (aba, lista, criação de sessão, atribuição de líder, publicar)

- [ ] **Step 1: Registrar a aba**

Em `professores-escala-smart.js`, adicionar em `ESCALA_TABS` (linha 19) a aba:

```js
const ESCALA_TABS = [
  { id: 'sabado',        label: 'Sábados' },
  { id: 'feriado',       label: 'Feriados' },
  { id: 'evento',        label: 'Eventos' },
  { id: 'fim_de_ano',    label: 'Fim de ano' },
  { id: 'escola_interna',label: 'Escola Interna' },
];
```

E garantir que `ESCALA_TIPOS` já tem `escola_interna` — se não tiver, adicionar `{ id: 'escola_interna', label: 'Escola Interna' }`.

- [ ] **Step 2: Roteamento da aba**

Em `renderEscalaGestao`, no bloco que escolhe `listHtml` (linha ~189), adicionar o ramo:

```js
  if (tab === 'sabado')               listHtml = renderTabSabados(scales);
  else if (tab === 'feriado')         listHtml = renderTabFeriados(scales);
  else if (tab === 'evento')          listHtml = renderTabEventos(scales);
  else if (tab === 'escola_interna')  listHtml = renderTabEscolaInterna(scales);
  else                                listHtml = renderTabFimDeAno(scales);
```

- [ ] **Step 3: Lista da aba + criação de sessão**

Adicionar (após `renderTabEventos`):

```js
function renderTabEscolaInterna(scales) {
  const docs = scales.filter(s => s.tipo === 'escola_interna' && s.date.startsWith(String(EscalaSmartState.year)));
  const docsF = ScaleService.filterByTimeframe(docs, escalaTodayISO(), EscalaSmartState.timeframe);
  const topo = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
    <span style="font-size:12px;color:var(--text2);">A gestão escolhe quem lidera cada dia (por necessidade técnica). Quem lidera ganha os pontos de liderança.</span>
    <button class="btn-primary" onclick="openNovaEscolaInterna()">+ Nova sessão</button></div>`;
  const body = docsF.length ? docsF.map(escalaCardDoc).join('')
    : `<p style="padding:20px;color:var(--text2);">Nenhuma sessão de Escola Interna em ${EscalaSmartState.year}.</p>`;
  return topo + body;
}

function openNovaEscolaInterna() {
  const overlay = document.getElementById('escalaModalOverlay'), modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex'; modal.style.display = 'block';
  const unitOpts = EscalaSmartState.units.map(u => `<option value="${u.id}">${u.name || u.id}</option>`).join('');
  modal.innerHTML = `
    <h2>Nova sessão de Escola Interna</h2>
    <div class="form-group"><label>Data <span style="color:var(--red);">*</span></label><input type="date" id="eiData" class="input" value="${escalaTodayISO()}"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div class="form-group"><label>Início</label><input type="time" id="eiIni" class="input" value="14:30"></div>
      <div class="form-group"><label>Fim</label><input type="time" id="eiFim" class="input" value="15:30"></div>
    </div>
    <div class="form-group"><label>Unidades</label><div style="padding:4px 0;">${EscalaSmartState.units.map(u => `<label style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-size:13px;"><input type="checkbox" class="eiUnit" value="${u.id}" checked> ${u.name || u.id}</label>`).join('')}</div></div>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      <button class="btn-primary" onclick="criarEscolaInterna()">Criar</button>
    </div>`;
}

async function criarEscolaInterna() {
  const date = document.getElementById('eiData').value;
  const startTime = document.getElementById('eiIni').value, endTime = document.getElementById('eiFim').value;
  const selUnits = Array.from(document.querySelectorAll('.eiUnit:checked')).map(c => c.value);
  if (!date || !selUnits.length) { toast('Informe data e ao menos uma unidade.', 'error'); return; }
  const units = EscalaSmartState.units.filter(u => selUnits.includes(u.id));
  const slots = ScaleService.escolaInternaSlots(units, { startTime, endTime });
  const res = await ScaleService.createScale({ date, tipo: 'escola_interna', name: `Escola Interna ${escalaFmtBR(date)}`, slots });
  if (res.success) { toast('Sessão criada!', 'success'); closeEscalaModal(); EscalaSmartState.tab = 'escola_interna'; EscalaSmartState.selectedId = res.data.id; renderEscalaGestao(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}
```

- [ ] **Step 4: Detalhe com atribuição manual do líder**

Em `renderEscalaDetail` (linha ~326), adicionar no topo um ramo para escola interna que rende um detalhe próprio:

```js
function renderEscalaDetail(scale) {
  if (!scale) return '';
  if (scale.tipo === 'fim_de_ano') return renderFimDeAnoDetail(scale);
  if (scale.tipo === 'escola_interna') return renderEscolaInternaDetail(scale);
  // ...restante idêntico
```

E adicionar a função de detalhe (após `renderFimDeAnoDetail`):

```js
function renderEscolaInternaDetail(scale) {
  const unitName = (uid) => { const u = EscalaSmartState.units.find(x => x.id === uid); return u ? u.name : uid; };
  const opts = (sel) => `<option value="">— escolher líder —</option>` +
    Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false)
      .map(t => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${t.name}</option>`).join('');
  const cards = (scale.slots || []).map(slot => `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:6px;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <div><div style="font-size:13px;font-weight:500;">${unitName(slot.unitId)}</div><div style="font-size:12px;color:var(--text2);">${slot.startTime}–${slot.endTime} · líder</div></div>
      <select class="input" style="width:auto;" onchange="atribuirLider('${scale.id}','${slot.id}',this.value)">${opts(slot.assignedPersonId)}</select>
    </div></div>`).join('');
  const actions = `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
    ${scale.published ? `<span style="font-size:12px;color:var(--green);margin-right:auto;">✓ publicada na agenda</span>` : ''}
    ${!scale.published ? `<button class="btn-primary" onclick="publicarEscala('${scale.id}')">📅 Publicar na agenda</button>` : `<button class="btn-secondary" onclick="despublicarEscala('${scale.id}')">↩️ Despublicar</button>`}
  </div>`;
  return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;">
    <div style="margin-bottom:12px;"><div style="font-weight:600;">${scale.name || scale.date}</div>
      <div style="font-size:12px;color:var(--text2);">${scale.date} · atribuição manual do líder</div></div>
    ${cards || '<p style="color:var(--text2);">Sem sessões.</p>'}
    ${actions}
  </div>`;
}

async function atribuirLider(scaleId, slotId, personId) {
  const res = await ScaleService.assignSlot(scaleId, slotId, personId || null);
  if (res.success) { toast('Líder atualizado.', 'success'); await escalaLoadBase(); renderEscalaGestao(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}
```

- [ ] **Step 5: Exportar as novas funções**

```js
window.renderTabEscolaInterna = renderTabEscolaInterna;
window.openNovaEscolaInterna = openNovaEscolaInterna;
window.criarEscolaInterna = criarEscolaInterna;
window.atribuirLider = atribuirLider;
```

- [ ] **Step 6: Verificação de sintaxe**

Run: `node -e "new Function(require('fs').readFileSync('professores-escala-smart.js','utf8').replace(/^﻿/,'')); console.log('sintaxe OK')"`
Expected: `sintaxe OK`.

- [ ] **Step 7: Commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala): aba Escola Interna com atribuicao manual do lider"
```

---

## Task 11: Integração — líder planejado pré-selecionado na Confirmar Presença

**Files:**
- Modify: `professores-engajamento.js` (ao carregar a chamada de `escola_interna`, pré-marcar como líder quem foi escalado na Escola Interna daquele dia/unidade)

Regra: a **presença é a fonte de verdade do ponto**; a escala é só o plano. A pré-seleção não lança ponto — só facilita a marcação. Sem duplicação.

- [ ] **Step 1: Carregar o plano da escala ao abrir a chamada**

Em `professores-engajamento.js`, na função que carrega a chamada (`EngajChamadaState` é populado; procure onde `st.kind === 'escola_interna'` e a data/unidade são conhecidas — a carga da lista de professores). Adicionar, na carga, a busca do plano:

```js
// pré-seleção do líder planejado (Escala Interna → Confirmar Presença)
async function carregarLiderPlanejado(dateISO, unitId) {
  if (!window.ScaleService) return null;
  const res = await ScaleService.listScales();
  if (!res.success) return null;
  const doc = res.data.find(s => s.tipo === 'escola_interna' && s.date === dateISO);
  if (!doc) return null;
  const slot = (doc.slots || []).find(sl => sl.unitId === unitId && sl.role === 'lider' && sl.assignedPersonId);
  return slot ? slot.assignedPersonId : null;
}
```

- [ ] **Step 2: Aplicar a pré-seleção ao montar a chamada**

Onde a chamada de `escola_interna` monta `st.marks` (ou renderiza os controles por professor), consultar `carregarLiderPlanejado(st.date, st.unitId)` e, se retornar um `personId` e ele ainda não tiver marca, pré-marcar como líder. Localize a função de render/carregamento da chamada e, antes de renderizar as linhas, faça:

```js
  if (st.kind === 'escola_interna' && st.date && st.unitId) {
    const liderId = await carregarLiderPlanejado(st.date, st.unitId);
    if (liderId && !st.marks[liderId]) {
      st.marks[liderId] = { status: 'presente', role: 'lider' };
    }
  }
```

Ajuste o nome dos campos (`st.date`, `st.unitId`, `st.marks`) aos nomes reais do `EngajChamadaState` (linha 165 de `professores-engajamento.js` mostra o shape: `{ kind, date, unitId, ..., marks }`). A marca é só sugestão — a gestão confirma/edita antes de salvar (o ponto só é lançado no salvar, via `recordAttendance`).

- [ ] **Step 3: Verificação de sintaxe**

Run: `node -e "new Function(require('fs').readFileSync('professores-engajamento.js','utf8').replace(/^﻿/,'')); console.log('sintaxe OK')"`
Expected: `sintaxe OK`.

- [ ] **Step 4: Commit**

```bash
git add professores-engajamento.js
git commit -m "feat(engajamento): pre-seleciona lider planejado da Escola Interna na Confirmar Presenca"
```

---

## Task 12: Rodar todos os smokes + checklist E2E staging

**Files:** nenhum (verificação)

- [ ] **Step 1: Rodar toda a suíte de smokes**

Run:
```bash
node scripts/smoke-notify-service.js && node scripts/smoke-escala-frente1.js && node scripts/smoke-escala-tabs.js && node scripts/smoke-engagement-service.js
```
Expected: todos terminam com `✅ ... OK`, exit 0.

- [ ] **Step 2: Verificação de sintaxe de todos os arquivos tocados**

Run:
```bash
for f in notify-service.js scale-service.js professores-escala-smart.js professores-engajamento.js professores-nav.js; do node -e "new Function(require('fs').readFileSync('$f','utf8').replace(/^﻿/,'')); console.log('$f OK')"; done
```
Expected: uma linha `OK` por arquivo.

- [ ] **Step 3: Checklist E2E no staging (browser, logado como `dono.teste@`)**

Seguindo a regra do projeto (homologação em staging antes de prod). Deploy de hosting no staging e validar:
- [ ] Menu mostra **"Confirmar Presença"** (não "Chamada").
- [ ] Aba Sábados: toggle Próximos/Passados/Todos filtra as datas.
- [ ] Selecionar 2 sábados → "Abrir janela nas selecionadas" → definir prazo → confirma → toast "time avisado".
- [ ] Logar como `professor.teste@` → vê as 2 janelas com prazo; marca preferência; após o prazo (ajustar prazo pra passado) vê "Janela encerrada" e botões somem.
- [ ] Voltar como gestão → "Revisar fechamento" → matriz mostra candidaturas + quem não se candidatou + vagas abertas → "Confirmar e avisar" → escalas consolidadas + notificação chega ao professor.
- [ ] Aba Escola Interna → "Nova sessão" → escolher líder no select → publicar na agenda.
- [ ] Abrir "Confirmar Presença" (escola interna) na mesma data/unidade → o líder escalado aparece pré-marcado.
- [ ] Console limpo (sem erros).

- [ ] **Step 4: Commit final (se houver ajuste de E2E)**

```bash
git add -A
git commit -m "chore(escala): ajustes de E2E da Frente 1 no staging"
```

---

## Notas de execução

- **Sem produção nesta rodada.** Regra 7 do CLAUDE.md: homologação completa em staging antes de qualquer `firebase deploy --project production`.
- **Rules:** o bloqueio de preferência pós-prazo é client-side + no serviço (`setPreference`). Reforço em `firestore.rules` (regra lê `windowClosesAt` via `get()`) é melhoria opcional — anotar como tech debt se não entrar nesta rodada.
- **Escopo:** Frentes 2 (visão do professor por abas + fim de ano por período) e 3 (staff de evento + convite + lembretes 7/4/1d com CF agendada) ficam para specs próprios. A camada `notify` desta frente já é a base da Frente 3.
- **Escola Interna ↔ pontos:** a escala é o **plano**; o ponto só é lançado quando a presença é salva na Confirmar Presença (`recordAttendance`). A pré-seleção não duplica.
