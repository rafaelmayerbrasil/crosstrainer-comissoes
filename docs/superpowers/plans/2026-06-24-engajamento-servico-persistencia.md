# Motor de Pontos — Camada de Serviço/Persistência (Plano 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir `EngagementService` — a camada que persiste o motor de pontos no Firestore (config, ciclos, lançamentos a partir de chamadas/substituições, leitura do placar), reusando o `points-engine.js` (puro, já testado) e validada por smoke Node com um Firestore fake.

**Architecture:** Um serviço UMD (`engagement-service.js`) no padrão dos serviços do projeto (`ModalityService` etc. em `professores-shared.js`), porém com **injeção de dependência**: cada método aceita um `deps` opcional (`{ db, ts, uid, PE, EC }`); no browser cai nos globais do app, no Node o smoke injeta um Firestore fake e o `PointsEngine`/`EngagementConfig`. Isso torna a orquestração (upsert idempotente, batch, montagem do placar) testável sem staging. As **regras de segurança Firestore NÃO entram neste plano** — vão no plano que for ao staging (regra de homologação do projeto). Telas de chamada/config = plano seguinte.

**Tech Stack:** JavaScript vanilla (UMD), Node `assert`. Firestore fake próprio (test support). Sem dependências externas.

**Spec:** `docs/superpowers/specs/2026-06-24-engajamento-pontos-escala-design.md` (seções 4.1–4.5, 8, 9, 10). **Depende do Plano 1** (`engagement-config.js`, `points-engine.js` já existem e exportam: `EngagementConfig.{DEFAULT_CONFIG,mergeConfig}`; `PointsEngine.{tempoDeCasaPontos,cycleIdFor,scoreboard,entriesFromAttendance,entryForSubstitution}`).

---

## File Structure

- `scripts/_fake-firestore.js` (criar) — Firestore fake mínimo p/ os smokes (collection/doc/get/set/add/where/orderBy/batch). Test support, reutilizável.
- `engagement-service.js` (criar, raiz) — `EngagementService`: config, ciclos, lançamentos, placar. Responsabilidade única: ponte entre `PointsEngine` e o Firestore.
- `scripts/smoke-engagement-service.js` (criar) — smoke do serviço com o fake (cresce a cada task).
- `professores.html` (modificar) — adicionar `<script>` de `engagement-config.js`, `points-engine.js`, `engagement-service.js` (ordem: config → engine → service), junto aos outros `<script src="professores-*.js">`. **Só adicionar tags; não alterar mais nada.**

> Convenção UMD (copiar de `points-engine.js`): wrapper `(function(root,factory){...})(...)` exportando via `module.exports` (Node) ou `root.EngagementService` (browser).

---

### Task 1: Firestore fake (test support)

**Files:**
- Create: `scripts/_fake-firestore.js`
- Test: (validado indiretamente pelos smokes das tasks seguintes; esta task tem auto-teste próprio abaixo)

- [ ] **Step 1: Write the failing test**

Create `scripts/smoke-fake-firestore.js`:
```javascript
'use strict';
// Roda: node scripts/smoke-fake-firestore.js
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');

(async () => {
  const db = makeFakeDb();

  // doc().set + get
  await db.collection('c').doc('a').set({ x: 1 });
  let d = await db.collection('c').doc('a').get();
  assert.ok(d.exists && d.id === 'a' && d.data().x === 1, 'set/get doc');

  // set sobrescreve (upsert idempotente por id)
  await db.collection('c').doc('a').set({ x: 2 });
  d = await db.collection('c').doc('a').get();
  assert.strictEqual(d.data().x, 2, 'set sobrescreve mesmo id');

  // add gera id
  const ref = await db.collection('c').add({ y: 9 });
  assert.ok(ref.id, 'add retorna id');

  // collection().get() lista todos
  const all = await db.collection('c').get();
  assert.strictEqual(all.docs.length, 2, 'a + add = 2 docs');

  // where(==)
  await db.collection('e').doc('e1').set({ personId: 'p1', pontos: 5 });
  await db.collection('e').doc('e2').set({ personId: 'p2', pontos: 3 });
  const w = await db.collection('e').where('personId', '==', 'p1').get();
  assert.strictEqual(w.docs.length, 1, 'where filtra');
  assert.strictEqual(w.docs[0].data().pontos, 5);

  // orderBy
  await db.collection('o').doc('o1').set({ inicio: '2026-07-01' });
  await db.collection('o').doc('o2').set({ inicio: '2026-01-01' });
  const ord = await db.collection('o').orderBy('inicio').get();
  assert.deepStrictEqual(ord.docs.map(x => x.data().inicio), ['2026-01-01', '2026-07-01'], 'orderBy asc');

  // batch.set + commit
  const b = db.batch();
  b.set(db.collection('c').doc('b1'), { z: 1 });
  b.set(db.collection('c').doc('b2'), { z: 2 });
  await b.commit();
  assert.strictEqual((await db.collection('c').get()).docs.length, 4, 'batch gravou 2');

  console.log('✓ smoke-fake-firestore: OK');
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-fake-firestore.js`
Expected: FAIL — `Cannot find module './_fake-firestore.js'`

- [ ] **Step 3: Write minimal implementation**

Create `scripts/_fake-firestore.js`:
```javascript
'use strict';
// Firestore fake mínimo p/ smokes Node. Só o subconjunto usado pelo EngagementService.
// NÃO é produção — apenas test support.
module.exports = function makeFakeDb() {
  const store = {}; // store[col] = { id: data }
  const col = (name) => (store[name] = store[name] || {});
  let auto = 0;

  function docRef(name, id) {
    return {
      _col: name, _id: id,
      async get() {
        const data = col(name)[id];
        return { exists: data !== undefined, id, data: () => data };
      },
      async set(obj) { col(name)[id] = JSON.parse(JSON.stringify(obj)); },
    };
  }

  function query(name, filters, order) {
    return {
      where(field, op, val) { return query(name, filters.concat([[field, op, val]]), order); },
      orderBy(field) { return query(name, filters, field); },
      async get() {
        let rows = Object.keys(col(name)).map(id => ({ id, data: () => col(name)[id] }));
        filters.forEach(([f, op, v]) => { rows = rows.filter(r => r.data()[f] === v); });
        if (order) rows.sort((a, b) => (a.data()[order] > b.data()[order] ? 1 : a.data()[order] < b.data()[order] ? -1 : 0));
        return { docs: rows };
      },
    };
  }

  return {
    collection(name) {
      const q = query(name, [], null);
      return {
        doc(id) { return docRef(name, id || `auto_${++auto}`); },
        async add(obj) { const id = `auto_${++auto}`; await docRef(name, id).set(obj); return { id }; },
        where: q.where, orderBy: q.orderBy, get: q.get,
      };
    },
    batch() {
      const ops = [];
      return { set(ref, obj) { ops.push([ref, obj]); }, async commit() { for (const [ref, obj] of ops) await ref.set(obj); } };
    },
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/smoke-fake-firestore.js`
Expected: PASS — `✓ smoke-fake-firestore: OK`

- [ ] **Step 5: Commit**

```bash
git add scripts/_fake-firestore.js scripts/smoke-fake-firestore.js
git commit -m "test(engajamento): firestore fake p/ smokes do service"
```

---

### Task 2: `engagement-service.js` — config (get/save) + resolvers de dependência

**Files:**
- Create: `engagement-service.js`
- Test: `scripts/smoke-engagement-service.js`

- [ ] **Step 1: Write the failing test**

Create `scripts/smoke-engagement-service.js`:
```javascript
'use strict';
// Roda: node scripts/smoke-engagement-service.js
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const ES = require('../engagement-service.js');
const EC = require('../engagement-config.js');
const PE = require('../points-engine.js');

// deps injetadas: db fake + timestamp/uid determinísticos + engine/config
function mkDeps(db) { return { db, ts: () => 'TS', uid: () => 'tester', PE, EC }; }

(async () => {
  const db = makeFakeDb();
  const deps = mkDeps(db);

  // getConfig sem doc → defaults
  let r = await ES.getConfig(deps);
  assert.ok(r.success && r.data.pts.reuniaoStaff === 8, 'getConfig defaults');

  // saveConfig grava overrides; getConfig mescla
  await ES.saveConfig({ pts: { reuniaoStaff: 12 } }, deps);
  r = await ES.getConfig(deps);
  assert.strictEqual(r.data.pts.reuniaoStaff, 12, 'override aplicado');
  assert.strictEqual(r.data.pts.escolaInternaParticipar, 1, 'demais preservados');

  console.log('✓ smoke-engagement-service: config OK');
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-engagement-service.js`
Expected: FAIL — `Cannot find module '../engagement-service.js'`

- [ ] **Step 3: Write minimal implementation**

Create `engagement-service.js`:
```javascript
// engagement-service.js — ponte entre PointsEngine e o Firestore (§4 do spec).
// Métodos aceitam `deps` opcional p/ teste em Node; no browser caem nos globais do app.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EngagementService = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Resolvers de dependência (typeof guards evitam ReferenceError no Node).
  function rdb(deps)  { if (deps && deps.db) return deps.db; return (typeof db !== 'undefined') ? db : null; }
  function rts(deps)  { if (deps && deps.ts) return deps.ts(); return (typeof serverTs === 'function') ? serverTs() : new Date().toISOString(); }
  function ruid(deps) { if (deps && deps.uid) return deps.uid(); return (typeof currentUserId === 'function') ? currentUserId() : null; }
  function rPE(deps)  { if (deps && deps.PE) return deps.PE; return PointsEngine; }
  function rEC(deps)  { if (deps && deps.EC) return deps.EC; return EngagementConfig; }

  const CONFIG_DOC = 'current';

  async function getConfig(deps) {
    try {
      const doc = await rdb(deps).collection('engagement_config').doc(CONFIG_DOC).get();
      const overrides = doc.exists ? (doc.data().overrides || {}) : {};
      return { success: true, data: rEC(deps).mergeConfig(overrides) };
    } catch (err) { return { success: false, error: err.message }; }
  }

  async function saveConfig(overrides, deps) {
    try {
      await rdb(deps).collection('engagement_config').doc(CONFIG_DOC)
        .set({ overrides: overrides || {}, updatedAt: rts(deps), updatedBy: ruid(deps) });
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  }

  return { getConfig, saveConfig };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/smoke-engagement-service.js`
Expected: PASS — `✓ smoke-engagement-service: config OK`

- [ ] **Step 5: Commit**

```bash
git add engagement-service.js scripts/smoke-engagement-service.js
git commit -m "feat(engajamento): EngagementService config (get/save) + smoke"
```

---

### Task 3: `engagement-service.js` — `recordAttendance` (chamada → lançamentos idempotentes)

**Files:**
- Modify: `engagement-service.js`
- Test: `scripts/smoke-engagement-service.js` (acrescentar)

Grava o doc da chamada em `attendance/{att.id}` e faz upsert das entries (id estável `att.id:personId`) em `point_entries` via batch. Reprocessar a mesma chamada NÃO duplica e atualiza os pontos.

- [ ] **Step 1: Write the failing test** (acrescentar antes do último `console.log`)

```javascript
  // ── recordAttendance ──
  const att = {
    id: 'att1', kind: 'escola_interna', date: '2026-03-05', unitId: 'unit-cp',
    records: [{ personId: 'p1', status: 'presente', role: 'lider' }, { personId: 'p2', status: 'presente' }],
  };
  let rec = await ES.recordAttendance(att, deps);
  assert.ok(rec.success && rec.data.entriesCount === 2, 'gerou 2 lançamentos');
  // doc da chamada gravado
  const attDoc = await db.collection('attendance').doc('att1').get();
  assert.ok(attDoc.exists && attDoc.data().kind === 'escola_interna', 'attendance gravado');
  // entries gravadas com id estável
  let e1 = await db.collection('point_entries').doc('att1:p1').get();
  assert.strictEqual(e1.data().pontos, 2, 'líder = 2 pts');
  // reprocessar: muda status do p1 p/ participante; não duplica, atualiza pontos
  att.records[0] = { personId: 'p1', status: 'presente' };
  rec = await ES.recordAttendance(att, deps);
  e1 = await db.collection('point_entries').doc('att1:p1').get();
  assert.strictEqual(e1.data().pontos, 1, 'reprocesso atualizou p/ 1 pt');
  const total = (await db.collection('point_entries').get()).docs.length;
  assert.strictEqual(total, 2, 'sem duplicação (ainda 2 entries: att1:p1, att1:p2)');

  console.log('✓ smoke-engagement-service: recordAttendance OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-engagement-service.js`
Expected: FAIL — `TypeError: ES.recordAttendance is not a function`

- [ ] **Step 3: Write minimal implementation** (adicionar antes do `return` e exportar)

```javascript
  async function recordAttendance(att, deps) {
    try {
      const database = rdb(deps);
      const cfg = (await getConfig(deps)).data;
      const entries = rPE(deps).entriesFromAttendance(att, cfg);
      const batch = database.batch();
      batch.set(database.collection('attendance').doc(att.id), {
        kind: att.kind, date: att.date, unitId: att.unitId || null,
        records: att.records || [], confirmedBy: att.confirmedBy || null,
        updatedAt: rts(deps), updatedBy: ruid(deps),
      });
      entries.forEach(e => {
        batch.set(database.collection('point_entries').doc(e.id), {
          personId: e.personId, tipo: e.tipo, refDate: e.refDate,
          pontos: e.pontos, origem: e.origem, createdAt: rts(deps),
        });
      });
      await batch.commit();
      return { success: true, data: { entriesCount: entries.length } };
    } catch (err) { return { success: false, error: err.message }; }
  }
```

`return { getConfig, saveConfig, recordAttendance };`

> NOTA (registrar como tech-debt no commit body): se um `personId` for REMOVIDO dos records num reprocesso, a entry antiga fica órfã (este upsert não apaga). Tratar quando houver edição de chamada na UI (plano de telas).

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/smoke-engagement-service.js`
Expected: PASS — termina com `✓ smoke-engagement-service: recordAttendance OK`

- [ ] **Step 5: Commit**

```bash
git add engagement-service.js scripts/smoke-engagement-service.js
git commit -m "feat(engajamento): EngagementService.recordAttendance (upsert idempotente) + smoke"
```

---

### Task 4: `engagement-service.js` — substituição, placar e ciclos

**Files:**
- Modify: `engagement-service.js`
- Test: `scripts/smoke-engagement-service.js` (acrescentar)

`awardSubstitution` (proatividade, §9), `entriesForPerson`, `scoreboard` (§10, usa tempo de casa pela data de admissão), e CRUD mínimo de ciclos (`listCycles`/`saveCycle`) + `currentCycle` (via `PointsEngine.cycleIdFor`).

- [ ] **Step 1: Write the failing test** (acrescentar antes do último `console.log`)

```javascript
  // ── Substituição (proatividade) ──
  const sub = await ES.awardSubstitution('sub42', 'p1', '2026-03-12', deps);
  assert.strictEqual(sub.data.id, 'sub:sub42:p1');
  const subDoc = await db.collection('point_entries').doc('sub:sub42:p1').get();
  assert.strictEqual(subDoc.data().pontos, 3, 'proatividade = 3 pts');

  // ── Ciclos ──
  await ES.saveCycle({ id: 'c1', inicio: '2026-01-01', fim: '2026-06-30', label: '1º sem' }, deps);
  await ES.saveCycle({ id: 'c2', inicio: '2026-07-01', fim: '2026-12-31', label: '2º sem' }, deps);
  const cyc = await ES.listCycles(deps);
  assert.strictEqual(cyc.data.length, 2, '2 ciclos');
  assert.strictEqual(ES.currentCycle(cyc.data, '2026-03-15').id, 'c1', 'ciclo atual por data');

  // ── Placar ── (p1: líder 1pt[att] já virou 1 + proatividade 3 = 4; + tempo de casa)
  // admissão 2024-06-01, fim do ciclo 2026-06-30 → 2 anos completos → faixa 1 → 20 pts
  const sb = await ES.scoreboard('p1', '2024-06-01', cyc.data[0], deps);
  assert.strictEqual(sb.data.tempoCasa, 20, 'tempo de casa');
  assert.strictEqual(sb.data.porTipo.proatividade_substituicao, 3);
  assert.strictEqual(sb.data.total, 1 /*escola_interna*/ + 3 /*subst*/ + 20 /*casa*/, 'total do placar');

  console.log('✓ smoke-engagement-service: placar/ciclos OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-engagement-service.js`
Expected: FAIL — `TypeError: ES.awardSubstitution is not a function`

- [ ] **Step 3: Write minimal implementation** (adicionar antes do `return` e exportar)

```javascript
  async function awardSubstitution(subId, personId, dateISO, deps) {
    try {
      const cfg = (await getConfig(deps)).data;
      const e = rPE(deps).entryForSubstitution(subId, personId, dateISO, cfg);
      await rdb(deps).collection('point_entries').doc(e.id).set({
        personId: e.personId, tipo: e.tipo, refDate: e.refDate,
        pontos: e.pontos, origem: e.origem, createdAt: rts(deps),
      });
      return { success: true, data: { id: e.id } };
    } catch (err) { return { success: false, error: err.message }; }
  }

  async function entriesForPerson(personId, deps) {
    const snap = await rdb(deps).collection('point_entries').where('personId', '==', personId).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function scoreboard(personId, admissaoISO, cycle, deps) {
    try {
      const cfg = (await getConfig(deps)).data;
      const entries = await entriesForPerson(personId, deps);
      const tempoCasa = rPE(deps).tempoDeCasaPontos(admissaoISO, cycle.fim, cfg);
      return { success: true, data: rPE(deps).scoreboard(entries, cycle, tempoCasa) };
    } catch (err) { return { success: false, error: err.message }; }
  }

  async function listCycles(deps) {
    try {
      const snap = await rdb(deps).collection('point_cycles').orderBy('inicio').get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) { return { success: false, error: err.message }; }
  }

  async function saveCycle(cycle, deps) {
    try {
      const database = rdb(deps);
      const id = cycle.id || database.collection('point_cycles').doc().id;
      await database.collection('point_cycles').doc(id).set({
        inicio: cycle.inicio, fim: cycle.fim, label: cycle.label || '',
        updatedAt: rts(deps), updatedBy: ruid(deps),
      });
      return { success: true, data: { id } };
    } catch (err) { return { success: false, error: err.message }; }
  }

  function currentCycle(cycles, refISO) {
    const id = rPE({ PE: PointsEngine }).cycleIdFor
      ? PointsEngine.cycleIdFor(refISO, cycles)
      : null;
    return cycles.find(c => c.id === id) || null;
  }
```

> Atenção `currentCycle`: no Node o smoke usa `PointsEngine` via require global do módulo já carregado em `ES`? Não — `currentCycle` é síncrona e pura; reescreva-a SEM depender de `rPE(deps)` (que é async-free mas precisa do PE). Use a forma direta abaixo, que funciona no browser (global `PointsEngine`) e no Node (o smoke requer `points-engine.js`, que registra em `globalThis`/`module`):

```javascript
  function currentCycle(cycles, refISO) {
    const PEref = (typeof PointsEngine !== 'undefined') ? PointsEngine : require('./points-engine.js');
    const id = PEref.cycleIdFor(refISO, cycles);
    return cycles.find(c => c.id === id) || null;
  }
```
(No browser `require` nunca é chamado porque `PointsEngine` existe; no Node `PointsEngine` é undefined e o `require('./points-engine.js')` resolve a partir da raiz — ajuste o caminho relativo se necessário ao rodar o smoke a partir da raiz: o módulo está na raiz, então de dentro de `engagement-service.js` (raiz) o caminho é `./points-engine.js`.)

`return { getConfig, saveConfig, recordAttendance, awardSubstitution, entriesForPerson, scoreboard, listCycles, saveCycle, currentCycle };`

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/smoke-engagement-service.js`
Expected: PASS — termina com `✓ smoke-engagement-service: placar/ciclos OK`

- [ ] **Step 5: Commit**

```bash
git add engagement-service.js scripts/smoke-engagement-service.js
git commit -m "feat(engajamento): EngagementService placar/substituição/ciclos + smoke"
```

---

### Task 5: Carregar os módulos no `professores.html`

**Files:**
- Modify: `professores.html` (só adicionar 3 tags `<script>`)

- [ ] **Step 1: Localizar o bloco de scripts**

Run: `grep -n 'professores-shared.js\|points-engine\|professores-escalas.js' "professores.html"`
Expected: ver a linha do `<script src="professores-shared.js"></script>` (e que `points-engine`/`engagement-*` ainda NÃO aparecem).

- [ ] **Step 2: Adicionar as 3 tags**

Logo APÓS a tag `<script src="professores-shared.js"></script>`, inserir (nesta ordem):
```html
  <script src="engagement-config.js"></script>
  <script src="points-engine.js"></script>
  <script src="engagement-service.js"></script>
```
(Ordem importa: config e engine antes do service. Devem vir depois do firebase init e do `professores-shared.js`, que define `db`/`serverTs`/`currentUserId`.)

- [ ] **Step 3: Verificar que as tags estão presentes e em ordem**

Run: `grep -n 'engagement-config.js\|points-engine.js\|engagement-service.js' "professores.html"`
Expected: as 3 linhas, na ordem config → engine → service, logo após `professores-shared.js`.

- [ ] **Step 4: Verificar sintaxe dos módulos sob Node (não quebra o browser)**

Run: `node -e "require('./engagement-config.js');require('./points-engine.js');require('./engagement-service.js');console.log('modules load OK')"`
Expected: `modules load OK` (sem erro de sintaxe).

- [ ] **Step 5: Commit**

```bash
git add professores.html
git commit -m "chore(engajamento): carrega config/engine/service no professores.html"
```

---

## Self-Review

**1. Spec coverage:**
- §4.1 config persistida + mesclada → Task 2 ✓
- §4.2 ciclos (CRUD + ciclo atual) → Task 4 ✓
- §4.3 placar lido do Firestore + tempo de casa → Task 4 ✓
- §4.4 chamada → lançamentos idempotentes (batch, id estável) → Task 3 ✓
- §8 penalização: já vem pronta do `entriesFromAttendance` (Plano 1); `recordAttendance` só persiste → Task 3 ✓
- §9 proatividade via substituição → Task 4 (`awardSubstitution`) ✓
- §10 contrato pro PLR: `scoreboard()` retorna `{porTipo,tempoCasa,total}` lido do banco → Task 4 ✓
- **Fora deste plano (próximos):** regras de segurança Firestore (vão no plano de staging, regra de homologação); telas de chamada/config/ciclos (plano de UI); escala inteligente.

**2. Placeholder scan:** sem TBD/TODO; todo passo tem código real e comando exato. A "NOTA" da Task 3 (entry órfã em reprocesso com remoção) é tech-debt consciente, registrada no commit, não um placeholder de implementação.

**3. Type consistency:** shape de `point_entries` gravado (`{personId,tipo,refDate,pontos,origem,createdAt}`) é o mesmo nas Tasks 3 e 4; `deps` (`{db,ts,uid,PE,EC}`) idêntico em todos os métodos; nomes batem com o Plano 1 (`entriesFromAttendance`, `entryForSubstitution`, `tempoDeCasaPontos`, `scoreboard`, `cycleIdFor`). `scoreboard()` consome o cycle `{id,inicio,fim}` produzido por `saveCycle`/`listCycles`.

---

## Próximos planos (roadmap)

- **Plano 3 — Telas de chamada + config + ciclos** (UI consumindo `EngagementService`) + regras Firestore + validação REST no staging.
- **Plano 4 — Escala inteligente (engine puro `scale-engine.js`)**: piso de justiça + mérito + slots tipados + compensação (TDD por smoke).
- **Plano 5 — Escala: persistência + UI + integrações** (férias no fim de ano, proatividade disparada pela substituição existente).
