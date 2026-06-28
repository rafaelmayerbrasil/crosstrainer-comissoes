# Publicar Escala na Agenda + Preferência (Prefiro/Pode ser/Não posso) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que a gestão publique a escala consolidada como aulas reais na agenda (idempotente, pagamento hora normal) e atualizar a preferência do colaborador para Prefiro/Pode ser/Não posso com marcação em lote.

**Architecture:** Camadas puras/injetáveis (`scale-engine.js`, `scale-service.js`) testadas por smoke Node com `_fake-firestore.js`; UI em `professores-escala-smart.js`. Publicar cria docs em `classes` taggeados com `specialScaleId`/`specialScaleSlotId` (idempotente). Horários das vagas vêm de `scale_config` (configurável).

**Tech Stack:** JS vanilla (UMD), Firebase Firestore, smokes Node + assert.

**Spec:** `docs/superpowers/specs/2026-06-27-publicar-escala-agenda-preferencia-design.md`

---

## File Structure

- `scale-engine.js` (modificar) — comparator entende `prefiro`/`pode_ser` (+ legado `quer`/`nao_quer`).
- `scale-service.js` (modificar) — `ScaleConfigService`, `templateSlots` com horários, `publishToAgenda`/`unpublishFromAgenda`.
- `professores-escala-smart.js` (modificar) — relabel + "Pode ser em todas" (colaborador); Publicar/Despublicar (gestão).
- `firestore.rules` (modificar) — `classes` create/delete pela gestão quando `specialScaleId`; `scale_config`.
- `scripts/smoke-scale-engine.js` / `scripts/smoke-scale-service.js` (modificar) — novos asserts.

---

## Task 1: Motor entende os novos códigos de preferência

**Files:**
- Modify: `scale-engine.js:19-21` (makeComparator/prefRank)
- Test: `scripts/smoke-scale-engine.js`

- [ ] **Step 1: Escrever asserts que falham** — adicionar ao fim do bloco de testes de `smoke-scale-engine.js`:

```js
// ── Preferência nova: prefiro puxa, pode_ser neutro, nao_posso filtra ──
{
  const slots = [{ id: 's1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: null }];
  const cands = [
    { id: 'a', modalityIds: ['TOI'], merito: 10, diasTrabalhados: 5, divida: 0, pref: 'pode_ser' },
    { id: 'b', modalityIds: ['TOI'], merito: 10, diasTrabalhados: 5, divida: 0, pref: 'prefiro' },
  ];
  const r = SE.consolidate(slots, cands, { minMes: 0 });
  assert.strictEqual(r.assignments[0].personId, 'b', 'prefiro ganha de pode_ser no empate');
}
{
  const slots = [{ id: 's1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: null }];
  const cands = [{ id: 'a', modalityIds: ['TOI'], merito: 99, divida: 0, diasTrabalhados: 9, pref: 'nao_posso' }];
  const r = SE.consolidate(slots, cands, { minMes: 0 });
  assert.strictEqual(r.assignments[0].personId, null, 'nao_posso filtra mesmo com mérito alto');
}
{
  // legado: quer ainda puxa, nao_quer ainda empurra
  const slots = [{ id: 's1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: null }];
  const cands = [
    { id: 'a', modalityIds: ['TOI'], merito: 10, diasTrabalhados: 5, divida: 0, pref: 'nao_quer' },
    { id: 'b', modalityIds: ['TOI'], merito: 10, diasTrabalhados: 5, divida: 0, pref: 'quer' },
  ];
  const r = SE.consolidate(slots, cands, { minMes: 0 });
  assert.strictEqual(r.assignments[0].personId, 'b', 'legado quer > nao_quer');
}
console.log('✓ smoke-scale-engine: preferência nova OK');
```

- [ ] **Step 2: Rodar e ver falhar** — `node scripts/smoke-scale-engine.js` → Esperado: AssertionError em "prefiro ganha…" (hoje `pode_ser` e `prefiro` têm o mesmo rank 1).

- [ ] **Step 3: Implementar** — em `scale-engine.js`, trocar `prefRank`:

```js
const prefRank = (p) => (p.pref === 'prefiro' || p.pref === 'quer') ? 0 : (p.pref === 'nao_quer' ? 2 : 1);
```

- [ ] **Step 4: Rodar e ver passar** — `node scripts/smoke-scale-engine.js` → Esperado: todos os `✓`.

- [ ] **Step 5: Commit**

```bash
git add scale-engine.js scripts/smoke-scale-engine.js
git commit -m "feat(escala): motor entende preferência prefiro/pode_ser (+ legado)"
```

---

## Task 2: `ScaleConfigService` + horários nas vagas (configurável)

**Files:**
- Modify: `scale-service.js` (templateSlots + novo ScaleConfigService + export)
- Test: `scripts/smoke-scale-service.js`

- [ ] **Step 1: Escrever asserts que falham** — adicionar em `smoke-scale-service.js` antes do `console.log` final:

```js
// ── ScaleConfig (horários default configuráveis) ──
const cfg0 = await SS.ScaleConfigService.get(d);
assert.ok(cfg0.success && cfg0.data && cfg0.data.horarios, 'config nasce com horarios default');
await SS.ScaleConfigService.save({ horarios: { sabado: { startTime: '08:00', endTime: '12:00' } } }, d);
const cfg1 = await SS.ScaleConfigService.get(d);
assert.strictEqual(cfg1.data.horarios.sabado.startTime, '08:00', 'config salva e persiste');

// templateSlots herda horário quando passado
const slotsT = SS.templateSlots('sabado', [{ id: 'cp' }], { startTime: '08:00', endTime: '12:00' });
assert.strictEqual(slotsT[0].startTime, '08:00', 'slot herda startTime');
assert.strictEqual(slotsT[0].endTime, '12:00', 'slot herda endTime');
console.log('✓ smoke-scale-service: scale-config/horários OK');
```

- [ ] **Step 2: Rodar e ver falhar** — `node scripts/smoke-scale-service.js` → Esperado: TypeError `SS.ScaleConfigService is undefined`.

- [ ] **Step 3: Implementar** — em `scale-service.js`:

(a) `templateSlots` aceita `times`:

```js
function templateSlots(tipo, units, times) {
  if (tipo === 'sabado' || tipo === 'feriado' || tipo === 'domingo_especial') {
    const t = times || {};
    const out = [];
    (units || []).forEach(u => {
      ['TOI', 'HIIT'].forEach(mod => out.push({
        id: `${u.id}_${mod}`, unitId: u.id, requiredModalityId: mod, assignedPersonId: null,
        startTime: t.startTime || null, endTime: t.endTime || null,
      }));
    });
    return out;
  }
  return [];
}
```

(b) `ScaleConfigService` (doc único `scale_config/default`):

```js
const DEFAULT_HORARIOS = {
  sabado: { startTime: '08:00', endTime: '12:00' },
  feriado: { startTime: '08:00', endTime: '12:00' },
  domingo_especial: { startTime: '08:00', endTime: '12:00' },
  evento: { startTime: '08:00', endTime: '12:00' },
};
const ScaleConfigService = {
  async get(deps) {
    try {
      const doc = await rdb(deps).collection('scale_config').doc('default').get();
      const base = { horarios: JSON.parse(JSON.stringify(DEFAULT_HORARIOS)) };
      return { success: true, data: doc.exists ? Object.assign(base, doc.data()) : base };
    } catch (err) { console.error('[ScaleConfigService.get]', err); return { success: false, error: err.message }; }
  },
  async save(patch, deps) {
    try {
      await rdb(deps).collection('scale_config').doc('default')
        .set(Object.assign({ updatedAt: rts(deps) }, patch), { merge: true });
      return { success: true };
    } catch (err) { console.error('[ScaleConfigService.save]', err); return { success: false, error: err.message }; }
  },
};
```

(c) adicionar `ScaleConfigService` ao `return { ... }`.

- [ ] **Step 4: Rodar e ver passar** — `node scripts/smoke-scale-service.js` → Esperado: todos os `✓` incluindo o novo. (Os asserts antigos de `templateSlots` sem `times` continuam válidos: `startTime/endTime` ficam `null`, mas o `deepStrictEqual` da linha 13 quebra porque agora há campos novos — **ajustar** esse assert para incluir `startTime: null, endTime: null`.)

- [ ] **Step 5: Commit**

```bash
git add scale-service.js scripts/smoke-scale-service.js
git commit -m "feat(escala): ScaleConfigService + horários configuráveis nas vagas"
```

---

## Task 3: `publishToAgenda` / `unpublishFromAgenda` (idempotente)

**Files:**
- Modify: `scale-service.js` (novas funções + export)
- Test: `scripts/smoke-scale-service.js`

- [ ] **Step 1: Escrever asserts que falham** — adicionar em `smoke-scale-service.js`:

```js
// ── Publicar / Despublicar (idempotente) ──
const pubSlots = [
  { id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'modTOI', assignedPersonId: 'ana', startTime: '08:00', endTime: '12:00' },
  { id: 'cp_HIIT', unitId: 'cp', requiredModalityId: 'modHIIT', assignedPersonId: null, startTime: '08:00', endTime: '12:00' }, // vaga aberta
];
const ps = await SS.createScale({ date: '2026-08-01', tipo: 'sabado', name: 'Pub', slots: pubSlots }, d);
await SS.setStatus(ps.data.id, 'consolidada', d);
const pub1 = await SS.publishToAgenda(ps.data.id, d);
assert.strictEqual(pub1.data.created, 1, '1 aula criada (vaga aberta não gera)');
assert.deepStrictEqual(pub1.data.vagasAbertas, ['cp_HIIT'], 'vaga aberta reportada');
let cls = await db.collection('classes').where('specialScaleId', '==', ps.data.id).get();
assert.strictEqual(cls.docs.length, 1, '1 aula no banco');
assert.strictEqual(cls.docs[0].data().teacherId, 'ana');
assert.strictEqual(cls.docs[0].data().status, 'prevista');
// republicar não duplica
const pub2 = await SS.publishToAgenda(ps.data.id, d);
assert.strictEqual(pub2.data.created, 1, 'republicar recria 1 (não acumula)');
cls = await db.collection('classes').where('specialScaleId', '==', ps.data.id).get();
assert.strictEqual(cls.docs.length, 1, 'continua 1 aula (idempotente)');
// despublicar remove
const unp = await SS.unpublishFromAgenda(ps.data.id, d);
assert.ok(unp.success);
cls = await db.collection('classes').where('specialScaleId', '==', ps.data.id).get();
assert.strictEqual(cls.docs.length, 0, 'despublicou: 0 aulas');
console.log('✓ smoke-scale-service: publicar/despublicar OK');
```

- [ ] **Step 2: Rodar e ver falhar** — `node scripts/smoke-scale-service.js` → Esperado: TypeError `SS.publishToAgenda is undefined`.

- [ ] **Step 3: Implementar** — em `scale-service.js`:

```js
async function _deleteScaleClasses(scaleId, deps) {
  const snap = await rdb(deps).collection('classes').where('specialScaleId', '==', scaleId).get();
  let blocked = false;
  for (const doc of snap.docs) {
    if (doc.data().monthClosingId) { blocked = true; continue; }
    await rdb(deps).collection('classes').doc(doc.id).delete();
  }
  return { removed: snap.docs.length, blocked };
}

async function publishToAgenda(scaleId, deps) {
  try {
    const scaleRes = await getScale(scaleId, deps);
    if (!scaleRes.success) return scaleRes;
    const scale = scaleRes.data;
    await _deleteScaleClasses(scaleId, deps); // idempotência
    const slots = scale.slots || [];
    const vagasAbertas = [];
    let created = 0;
    const dateTs = scale.date; // ISO 'YYYY-MM-DD'; a UI converte p/ Timestamp ao gravar de verdade
    for (const s of slots) {
      if (!s.assignedPersonId || !s.startTime || !s.endTime) {
        if (!s.assignedPersonId) vagasAbertas.push(s.id);
        continue;
      }
      const mins = (parseInt(s.endTime.slice(0,2),10)*60+parseInt(s.endTime.slice(3),10)) -
                   (parseInt(s.startTime.slice(0,2),10)*60+parseInt(s.startTime.slice(3),10));
      await rdb(deps).collection('classes').doc().set({
        unitId: s.unitId, teacherId: s.assignedPersonId, originalTeacherId: s.assignedPersonId,
        modalityId: s.requiredModalityId || null, startTime: s.startTime, endTime: s.endTime,
        durationMinutes: mins, status: 'prevista',
        isHoliday: scale.tipo === 'feriado', holidayName: null, holidayType: null,
        scheduledDate: dateTs, generatedBy: 'escala-smart',
        specialScaleId: scaleId, specialScaleSlotId: s.id,
        specialScaleType: null, monthClosingId: null,
        createdAt: rts(deps), updatedAt: rts(deps),
      });
      created++;
    }
    await rdb(deps).collection('special_scales').doc(scaleId)
      .set({ published: true, updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
    return { success: true, data: { created, vagasAbertas } };
  } catch (err) { console.error('[ScaleService.publishToAgenda]', err); return { success: false, error: err.message }; }
}

async function unpublishFromAgenda(scaleId, deps) {
  try {
    const res = await _deleteScaleClasses(scaleId, deps);
    if (res.blocked) return { success: false, error: 'Há aulas em mês fechado; não é possível despublicar.' };
    await rdb(deps).collection('special_scales').doc(scaleId)
      .set({ published: false, updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
    return { success: true, data: { removed: res.removed } };
  } catch (err) { console.error('[ScaleService.unpublishFromAgenda]', err); return { success: false, error: err.message }; }
}
```

Adicionar `publishToAgenda, unpublishFromAgenda` ao `return`.

> Nota de produção: na UI, `scheduledDate` deve virar `firebase.firestore.Timestamp` da data da escala (meia-noite local). No smoke o fake guarda a string — ok pro teste de criação/contagem.

- [ ] **Step 4: Rodar e ver passar** — `node scripts/smoke-scale-service.js` → Esperado: todos os `✓`.

- [ ] **Step 5: Commit**

```bash
git add scale-service.js scripts/smoke-scale-service.js
git commit -m "feat(escala): publishToAgenda/unpublishFromAgenda idempotentes"
```

---

## Task 4: UI colaborador — relabel + "Pode ser em todas"

**Files:**
- Modify: `professores-escala-smart.js:84` (prefLabel), `:380-389` (pbtn + linha de botões), `:386-393` (cabeçalho/lote)

- [ ] **Step 1: Atualizar `prefLabel`** (linha ~84):

```js
const prefLabel = (p) => p === 'prefiro' ? 'prefiro' : (p === 'pode_ser' ? 'pode ser' : (p === 'nao_posso' ? 'não posso' : (p === 'quer' ? 'prefiro' : (p === 'nao_quer' ? '—' : '—'))));
```

- [ ] **Step 2: Trocar a linha de botões** (linha ~388) por:

```js
<div style="display:flex;gap:6px;">${pbtn(s.id, 'prefiro', 'Prefiro', 'var(--green)')}${pbtn(s.id, 'pode_ser', 'Pode ser', '#5EA8FF')}${pbtn(s.id, 'nao_posso', 'Não posso', 'var(--red)')}</div>
```

- [ ] **Step 3: Adicionar botão "Pode ser em todas"** — no `container.innerHTML` do `renderEscalaPrefs` (após o `page-hdr`, antes de `${rows}`):

```js
<div style="padding:0 0 12px;"><button onclick="marcarPodeSerTodas()" style="font-size:13px;padding:8px 14px;border-radius:8px;cursor:pointer;background:rgba(94,168,255,0.15);color:#5EA8FF;border:1px solid #5EA8FF;">✓ Marcar "Pode ser" em todas</button></div>
```

E adicionar a função:

```js
async function marcarPodeSerTodas() {
  const pid = escalaProfId();
  if (!pid) { toast('Seu perfil não está vinculado a um professor.', 'error'); return; }
  const scalesRes = await ScaleService.listScales();
  const abertas = (scalesRes.success ? scalesRes.data : []).filter(s => s.status === 'janela_aberta');
  for (const s of abertas) { await ScaleService.setPreference(s.id, pid, 'pode_ser'); }
  toast('Marcado "Pode ser" em todas as escalas abertas.', 'success');
  renderEscalaPrefs();
}
```

- [ ] **Step 4: Verificação manual no staging** (Task 7 cobre o passo a passo). Sem smoke (é DOM).

- [ ] **Step 5: Commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala): preferência Prefiro/Pode ser/Não posso + marcar em lote"
```

---

## Task 5: UI gestão — Publicar / Despublicar

**Files:**
- Modify: `professores-escala-smart.js` (detalhe da escala da gestão — perto de `:187`/`:233`, onde há botões por status)

- [ ] **Step 1: Adicionar botões quando `status === 'consolidada'`** no bloco de detalhe da gestão:

```js
${scale.status === 'consolidada' && !scale.published ? `<button class="btn-primary" onclick="publicarEscala('${scale.id}')">📅 Publicar na agenda</button>` : ''}
${scale.published ? `<button class="btn-secondary" onclick="despublicarEscala('${scale.id}')">↩️ Despublicar</button> <span style="color:var(--green);font-size:13px;">✓ publicada na agenda</span>` : ''}
```

- [ ] **Step 2: Adicionar handlers** (perto de `consolidarEscala`):

```js
async function publicarEscala(scaleId) {
  if (!confirm('Publicar a escala como aulas na agenda?')) return;
  const res = await ScaleService.publishToAgenda(scaleId, { db, ts: serverTs, uid: currentUserId, SE: ScaleEngine });
  if (!res.success) { toast('Erro: ' + res.error, 'error'); return; }
  let msg = `${res.data.created} aula(s) publicada(s).`;
  if (res.data.vagasAbertas.length) msg += ` ${res.data.vagasAbertas.length} vaga(s) aberta(s) sem aula.`;
  toast(msg, 'success');
  renderEscalaGestao();
}
async function despublicarEscala(scaleId) {
  if (!confirm('Remover as aulas publicadas desta escala?')) return;
  const res = await ScaleService.unpublishFromAgenda(scaleId, { db, ts: serverTs, uid: currentUserId, SE: ScaleEngine });
  if (!res.success) { toast('Erro: ' + res.error, 'error'); return; }
  toast('Escala despublicada.', 'success');
  renderEscalaGestao();
}
```

> A UI deve passar `scheduledDate` como Timestamp. Como `publishToAgenda` recebe a escala já gravada, ajustar lá dentro: se `firebase` existir e `scale.date` for string, gravar `firebase.firestore.Timestamp.fromDate(new Date(scale.date + 'T00:00:00'))`. (No browser `firebase` existe; no smoke não — guardar a string.) Implementar com guarda: `const dateTs = (typeof firebase !== 'undefined' && firebase.firestore) ? firebase.firestore.Timestamp.fromDate(new Date(scale.date + 'T00:00:00')) : scale.date;`

- [ ] **Step 3: Verificação no staging** (Task 7).

- [ ] **Step 4: Commit**

```bash
git add professores-escala-smart.js scale-service.js
git commit -m "feat(escala): UI gestão publicar/despublicar na agenda"
```

---

## Task 6: Security Rules

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: `classes`** — permitir create/delete pela gestão quando `specialScaleId` presente e sem `monthClosingId`. Localizar o match de `/classes/{id}` e adicionar (mantendo o que já existe):

```
allow create: if isGestao() && request.resource.data.specialScaleId is string
              && request.resource.data.monthClosingId == null;
allow delete: if isGestao() && resource.data.specialScaleId is string
              && resource.data.monthClosingId == null;
```

(usar o helper de papel existente nas regras — `isGestao()`/`isAdmin()` conforme o arquivo).

- [ ] **Step 2: `scale_config`** — adicionar match:

```
match /scale_config/{id} {
  allow read: if isModulo();
  allow write: if isAdmin();
}
```

- [ ] **Step 3: Deploy + validação** — `firebase deploy --only firestore:rules --project staging`; validar create/delete por gestão e bloqueio sem `specialScaleId` (script REST no padrão de `scripts/validate-engagement-rules.js`).

- [ ] **Step 4: Commit**

```bash
git add firestore.rules
git commit -m "feat(escala): rules p/ publicar aulas da escala + scale_config"
```

---

## Task 7: Verificação ponta-a-ponta no staging

- [ ] **Step 1:** `preview_start` (crosstrainer-static, professores.html → staging). Login `dono.teste@` / `crosstainer2026`.
- [ ] **Step 2:** Escala Inteligente → criar sábado, abrir janela, consolidar. Conferir vagas + motivos.
- [ ] **Step 3:** Publicar na agenda → conferir toast (N aulas / vagas abertas). Ir na Agenda Geral na data → as aulas aparecem com o professor certo e horário do config.
- [ ] **Step 4:** Despublicar → as aulas somem da agenda.
- [ ] **Step 5:** Login `professor.teste@` → Escala: ver rótulos Prefiro/Pode ser/Não posso; clicar "Pode ser em todas" → persiste. Console limpo em tudo.
- [ ] **Step 6:** Commit de quaisquer ajustes + atualizar memória/CONTEXTO.

---

## Self-Review (feito)

- **Cobertura da spec:** §3 preferência → Tasks 1,4; §4 dados/horários → Tasks 2,3; §5 fluxo publicar → Tasks 3,5; §6 componentes → todas; §6 rules → Task 6; §8 testes → smokes nas Tasks 1-3 + Task 7. OK.
- **Placeholders:** nenhum — todo passo tem código/comando reais.
- **Consistência de tipos:** `publishToAgenda(scaleId, deps)` / `unpublishFromAgenda(scaleId, deps)` / `ScaleConfigService.get/save(deps)` usados igual no smoke e na UI; `pref` ∈ `prefiro|pode_ser|nao_posso` (+ legado) consistente entre engine e UI; tag `specialScaleId`/`specialScaleSlotId` igual em publish/unpublish/rules.
- **Ajuste necessário registrado:** o assert antigo de `templateSlots` (smoke-scale-service linha ~13) ganha `startTime:null,endTime:null` (Task 2 Step 4).
