# Escala Inteligente · Frente 3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o evento numa lista de staff (devem/poderiam participar) com RSVP Vou/Não vou, convite in-app ao selecionar, e lembretes automáticos 7/4/1d via Cloud Function agendada.

**Architecture:** Estende `scale-service.js` (staff/RSVP + helper puro `summarizeRsvp`), adiciona um módulo puro `functions/reminders-util.js` (datas/destinatários) consumido por uma CF nova `sendEventReminders` (in-app via `createNotification`), e a UI (`professores-escala-smart.js`) ganha o painel de staff na gestão e o RSVP acionável na aba Eventos do professor. Lógica em helpers puros testados por smoke Node; CF verificada no staging.

**Tech Stack:** HTML/CSS/JS vanilla (UMD), Firebase Firestore + Functions v2 (`onSchedule`), smokes Node com `assert` + `scripts/_fake-firestore.js`.

**Spec:** `docs/superpowers/specs/2026-07-10-escala-frente3-eventos-staff-design.md`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Ação |
|---------|------------------|------|
| `scale-service.js` | `setEventStaff`/`listEventRsvp`/`setRsvp` (IO) + `summarizeRsvp` (puro) | modificar |
| `functions/reminders-util.js` | puro: `dueReminderOffsets`, `reminderRecipients` | **criar** |
| `functions/index.js` | CF `sendEventReminders` (onSchedule) + `event_reminder` em `NOTIF_TYPE_TITLES` | modificar |
| `professores-escala-smart.js` | criação de evento sem TOI/Hiit; detalhe do evento = painel de staff (gestão); aba Eventos do professor acionável (Vou/Não vou) | modificar |
| `firestore.rules` | regra `event_rsvp` | modificar |
| `scripts/smoke-escala-frente3.js` | serviço + `summarizeRsvp` | **criar** |
| `scripts/smoke-event-reminders.js` | helpers puros da CF | **criar** |

**Ordem:** Tasks 1–2 (serviço/puro) → Task 3 (reminders-util puro) → Task 4 (rules) → Task 5 (CF) → Tasks 6–7 (UI) → Task 8 (verificação + deploy staging).

---

## Task 1: `scale-service.js` — staff + RSVP (IO)

**Files:** Modify `scale-service.js`; Create `scripts/smoke-escala-frente3.js`.

- [ ] **Step 1: Criar `scripts/smoke-escala-frente3.js`:**

```js
'use strict';
// Roda: node scripts/smoke-escala-frente3.js
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'tester' });

(async () => {
  const db = makeFakeDb();
  const d = deps(db);
  const ev = (await SS.createScale({ date: '2026-08-15', tipo: 'evento', name: 'Campeonato', slots: [], eventKind: 'externo' }, d)).data;

  // define staff: p1/p2 obrigatórios, p3 opcional
  const r = await SS.setEventStaff(ev.id, ['p1', 'p2'], ['p3'], d);
  assert.ok(r.success, 'setEventStaff ok');
  assert.deepStrictEqual(r.data.added.sort(), ['p1', 'p2', 'p3'], 'todos recém-adicionados');
  let list = (await SS.listEventRsvp(ev.id, d)).data;
  assert.strictEqual(list.length, 3, '3 no staff');
  const byId = Object.fromEntries(list.map(x => [x.personId, x]));
  assert.strictEqual(byId.p1.tier, 'obrigatorio'); assert.strictEqual(byId.p1.going, true, 'obrigatório nasce Vou');
  assert.strictEqual(byId.p3.tier, 'opcional');    assert.strictEqual(byId.p3.going, null, 'opcional nasce aberto');
  console.log('✓ setEventStaff defaults OK');

  // p3 responde Vou
  const rsvp = await SS.setRsvp(ev.id, 'p3', true, d);
  assert.ok(rsvp.success, 'setRsvp ok');
  // reconcilia: remove p2, mantém p1/p3 (preserva going), adiciona p4
  const r2 = await SS.setEventStaff(ev.id, ['p1'], ['p3', 'p4'], d);
  assert.deepStrictEqual(r2.data.added, ['p4'], 'só p4 é novo');
  list = (await SS.listEventRsvp(ev.id, d)).data;
  const ids = list.map(x => x.personId).sort();
  assert.deepStrictEqual(ids, ['p1', 'p3', 'p4'], 'p2 removido');
  const byId2 = Object.fromEntries(list.map(x => [x.personId, x]));
  assert.strictEqual(byId2.p3.going, true, 'resposta de p3 preservada');
  assert.strictEqual(byId2.p3.tier, 'opcional', 'p3 segue opcional');
  console.log('✓ setEventStaff reconcilia OK');

  // setRsvp em quem não é staff = erro
  const bad = await SS.setRsvp(ev.id, 'pX', true, d);
  assert.strictEqual(bad.success, false, 'não-staff não pode responder');
  console.log('✓ setRsvp guard OK');

  console.log('\n✅ smoke-escala-frente3 (Task 1) OK');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "C:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes" && node scripts/smoke-escala-frente3.js`
Expected: FAIL — `SS.setEventStaff is not a function`.

- [ ] **Step 3: Implementar em `scale-service.js`** (após `listPreferences`/`setDayPreference`, perto da linha ~270):

```js
  async function listEventRsvp(scaleId, deps) {
    try {
      const snap = await rdb(deps).collection('event_rsvp').where('scaleId', '==', scaleId).get();
      return { success: true, data: snap.docs.map(dd => ({ id: dd.id, ...dd.data() })) };
    } catch (err) { console.error('[ScaleService.listEventRsvp]', err); return { success: false, error: err.message }; }
  }

  // Reconcilia o staff do evento. obrigatorios/opcionais = arrays de personId.
  // Novo obrigatório nasce going:true; novo opcional nasce going:null; preserva going de quem já existia.
  // Remove do staff quem saiu das listas. Retorna { added:[personId dos novos] }.
  async function setEventStaff(scaleId, obrigatorios, opcionais, deps) {
    try {
      const database = rdb(deps);
      const existing = {};
      (await listEventRsvp(scaleId, deps)).data.forEach(r => { existing[r.personId] = r; });
      const desired = []
        .concat((obrigatorios || []).map(pid => ({ pid, tier: 'obrigatorio' })))
        .concat((opcionais || []).map(pid => ({ pid, tier: 'opcional' })));
      const desiredIds = new Set(desired.map(x => x.pid));
      const added = [];
      for (const { pid, tier } of desired) {
        const prev = existing[pid];
        const doc = {
          scaleId, personId: pid, tier,
          going: prev ? prev.going : (tier === 'obrigatorio' ? true : null),
          invitedAt: prev ? (prev.invitedAt || rts(deps)) : rts(deps),
          respondedAt: prev ? (prev.respondedAt || null) : null,
        };
        await database.collection('event_rsvp').doc(`${scaleId}__${pid}`).set(doc);
        if (!prev) added.push(pid);
      }
      for (const pid of Object.keys(existing)) {
        if (!desiredIds.has(pid)) await database.collection('event_rsvp').doc(`${scaleId}__${pid}`).delete();
      }
      return { success: true, data: { added } };
    } catch (err) { console.error('[ScaleService.setEventStaff]', err); return { success: false, error: err.message }; }
  }

  async function setRsvp(scaleId, personId, going, deps) {
    try {
      const ref = rdb(deps).collection('event_rsvp').doc(`${scaleId}__${personId}`);
      const cur = await ref.get();
      if (!cur.exists) return { success: false, error: 'Você não está no staff deste evento.' };
      await ref.set({ going, respondedAt: rts(deps) }, { merge: true });
      return { success: true };
    } catch (err) { console.error('[ScaleService.setRsvp]', err); return { success: false, error: err.message }; }
  }
```

- [ ] **Step 4: Exportar** `setEventStaff, listEventRsvp, setRsvp` no `return { ... }` final.

- [ ] **Step 5: Rodar e ver passar**

Run: `node scripts/smoke-escala-frente3.js`
Expected: PASS — `✅ smoke-escala-frente3 (Task 1) OK`.

- [ ] **Step 6: Commit**

```bash
git add scale-service.js scripts/smoke-escala-frente3.js
git commit -m "feat(escala): staff e RSVP de evento (setEventStaff/listEventRsvp/setRsvp)"
```

---

## Task 2: `scale-service.js` — `summarizeRsvp` (puro)

**Files:** Modify `scale-service.js`; append to `scripts/smoke-escala-frente3.js`.

- [ ] **Step 1: Adicionar teste** — em `scripts/smoke-escala-frente3.js`, antes do log final, inserir:

```js
  // ── summarizeRsvp (puro) ──
  const sum = SS.summarizeRsvp([
    { personId: 'a', going: true }, { personId: 'b', going: false },
    { personId: 'c', going: null }, { personId: 'd' },
  ]);
  assert.deepStrictEqual(sum.vao, ['a'], 'vão');
  assert.deepStrictEqual(sum.naoVao, ['b'], 'não vão');
  assert.deepStrictEqual(sum.semResposta.sort(), ['c', 'd'], 'sem resposta (null/undefined)');
  console.log('✓ summarizeRsvp OK');
```

E trocar o log final para `console.log('\n✅ smoke-escala-frente3 (Task 2) OK');`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-escala-frente3.js`
Expected: FAIL — `SS.summarizeRsvp is not a function`.

- [ ] **Step 3: Implementar** (perto de `buildConsolidationMatrix`/`dayPrefsToAvailability`):

```js
  // PURO: separa os RSVP por resposta. going: true=vai, false=não vai, null/undefined=sem resposta.
  function summarizeRsvp(rsvpDocs) {
    const out = { vao: [], naoVao: [], semResposta: [] };
    (rsvpDocs || []).forEach(r => {
      if (r.going === true) out.vao.push(r.personId);
      else if (r.going === false) out.naoVao.push(r.personId);
      else out.semResposta.push(r.personId);
    });
    return out;
  }
```

- [ ] **Step 4: Exportar** `summarizeRsvp` no `return { ... }`.

- [ ] **Step 5: Rodar e ver passar**

Run: `node scripts/smoke-escala-frente3.js`
Expected: PASS — `✓ summarizeRsvp OK`, `✅ smoke-escala-frente3 (Task 2) OK`.

- [ ] **Step 6: Commit**

```bash
git add scale-service.js scripts/smoke-escala-frente3.js
git commit -m "feat(escala): summarizeRsvp (consolidado do staff)"
```

---

## Task 3: `functions/reminders-util.js` — helpers puros da CF

**Files:** Create `functions/reminders-util.js`, `scripts/smoke-event-reminders.js`.

- [ ] **Step 1: Criar `scripts/smoke-event-reminders.js`:**

```js
'use strict';
// Roda: node scripts/smoke-event-reminders.js
const assert = require('assert');
const RU = require('../functions/reminders-util.js');

// ── dueReminderOffsets ──
assert.deepStrictEqual(RU.dueReminderOffsets('2026-08-15', '2026-08-08', []), ['7d'], '7 dias antes');
assert.deepStrictEqual(RU.dueReminderOffsets('2026-08-15', '2026-08-11', []), ['4d'], '4 dias antes');
assert.deepStrictEqual(RU.dueReminderOffsets('2026-08-15', '2026-08-14', []), ['1d'], '1 dia antes');
assert.deepStrictEqual(RU.dueReminderOffsets('2026-08-15', '2026-08-10', []), [], 'dia sem offset = nada');
assert.deepStrictEqual(RU.dueReminderOffsets('2026-08-15', '2026-08-08', ['7d']), [], 'já enviado não repete');
assert.deepStrictEqual(RU.dueReminderOffsets('2026-08-15', '2026-08-16', []), [], 'evento já passou = nada');
console.log('✓ dueReminderOffsets OK');

// ── reminderRecipients ──
assert.deepStrictEqual(
  RU.reminderRecipients([{ personId: 'a', going: true }, { personId: 'b', going: false }, { personId: 'c', going: null }]).sort(),
  ['a', 'c'], 'exclui só quem respondeu Não vou');
assert.deepStrictEqual(RU.reminderRecipients([]), [], 'vazio');
console.log('✓ reminderRecipients OK');

console.log('\n✅ smoke-event-reminders OK');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-event-reminders.js`
Expected: FAIL — `Cannot find module '../functions/reminders-util.js'`.

- [ ] **Step 3: Criar `functions/reminders-util.js`** (CommonJS puro, sem deps Firebase):

```js
// functions/reminders-util.js — lógica pura de lembretes de evento (testável sem Firebase).
'use strict';

const OFFSETS = [['7d', 7], ['4d', 4], ['1d', 1]];

// Quantos dias inteiros entre duas datas ISO 'YYYY-MM-DD' (b - a), via UTC (sem fuso).
function daysBetween(aISO, bISO) {
  const a = Date.UTC(+aISO.slice(0, 4), +aISO.slice(5, 7) - 1, +aISO.slice(8, 10));
  const b = Date.UTC(+bISO.slice(0, 4), +bISO.slice(5, 7) - 1, +bISO.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

// Offsets ('7d'/'4d'/'1d') devidos HOJE p/ um evento, excluindo os já enviados.
function dueReminderOffsets(eventDateISO, todayISO, sent) {
  const faltam = daysBetween(todayISO, eventDateISO);
  const jaEnviados = new Set(sent || []);
  return OFFSETS.filter(([label, n]) => n === faltam && !jaEnviados.has(label)).map(([label]) => label);
}

// Quem recebe lembrete: todos menos quem respondeu "Não vou" (going === false).
function reminderRecipients(rsvpDocs) {
  return (rsvpDocs || []).filter(r => r.going !== false).map(r => r.personId);
}

module.exports = { daysBetween, dueReminderOffsets, reminderRecipients };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node scripts/smoke-event-reminders.js`
Expected: PASS — `✓ dueReminderOffsets OK`, `✓ reminderRecipients OK`, `✅ smoke-event-reminders OK`.

- [ ] **Step 5: Commit**

```bash
git add functions/reminders-util.js scripts/smoke-event-reminders.js
git commit -m "feat(functions): reminders-util puro (offsets 7/4/1d + destinatarios)"
```

---

## Task 4: Regra Firestore de `event_rsvp`

**Files:** Modify `firestore.rules`.

- [ ] **Step 1: Adicionar a regra** — em `firestore.rules`, logo APÓS o bloco `match /scale_day_preferences/{id} { ... }`, inserir:

```
    // RSVP de staff de evento: colaborador grava a SUA resposta (personId == professorId);
    // gestão monta/remove o staff. Doc id = `${eventId}__${personId}`.
    match /event_rsvp/{id} {
      allow read:   if isAuth() && hasProfModule();
      allow create, update: if isAuth() && (
                      isAdmin() || isSuperv() ||
                      request.resource.data.personId == uData().professorId
                    );
      allow delete: if isAuth() && (isAdmin() || isSuperv());
    }
```

- [ ] **Step 2: Conferir sintaxe** — a compilação real das rules acontece no deploy (Task 8). Revisar visualmente que o bloco espelha `scale_preferences` (com `delete` liberado p/ gestão, pois `setEventStaff` remove quem sai do staff).

- [ ] **Step 3: Commit**

```bash
git add firestore.rules
git commit -m "feat(rules): regra de event_rsvp (staff de evento)"
```

---

## Task 5: CF `sendEventReminders` (`functions/index.js`)

**Files:** Modify `functions/index.js`.

Usa `reminders-util.js` (Task 3) + `createNotification` (já existe). Resolve personId→userId como `notifyTeachersAboutCoverage`.

- [ ] **Step 1: Adicionar `event_reminder` em `NOTIF_TYPE_TITLES`** — localizar o objeto `NOTIF_TYPE_TITLES` (perto da linha 485) e adicionar a entrada:

```js
  event_reminder:         'Lembrete de evento',
```

- [ ] **Step 2: Adicionar a CF** — em `functions/index.js`, perto das outras `onSchedule`/notificações (após `notifyTeachersAboutCoverage`, por volta da linha 613), inserir:

```js
const remindersUtil = require('./reminders-util.js');

/**
 * sendEventReminders — CF agendada (diária). Lembra o staff de eventos a 7/4/1 dia,
 * exceto quem respondeu "Não vou". Idempotente via special_scales.remindersSent.
 */
exports.sendEventReminders = onSchedule({
  schedule: '0 9 * * *',
  timeZone: 'America/Sao_Paulo',
  region: 'us-central1',
  memory: '256MiB',
}, async () => {
  const firestore = db();
  const todayISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD
  logger.info('[sendEventReminders] Iniciando', todayISO);
  try {
    const snap = await firestore.collection('special_scales').where('tipo', '==', 'evento').get();
    for (const doc of snap.docs) {
      const ev = doc.data();
      if (typeof ev.date !== 'string') continue;
      const sent = Array.isArray(ev.remindersSent) ? ev.remindersSent : [];
      const due = remindersUtil.dueReminderOffsets(ev.date, todayISO, sent);
      if (!due.length) continue;

      const rsvpSnap = await firestore.collection('event_rsvp').where('scaleId', '==', doc.id).get();
      const recipients = remindersUtil.reminderRecipients(rsvpSnap.docs.map(d => d.data()));
      const faltam = remindersUtil.daysBetween(todayISO, ev.date);
      for (const personId of recipients) {
        let userId = null;
        const tDoc = await firestore.collection('teachers').doc(personId).get();
        if (tDoc.exists) userId = tDoc.data().userId || null;
        if (!userId) {
          const us = await firestore.collection('users').where('professorId', '==', personId).limit(1).get();
          if (!us.empty) userId = us.docs[0].id;
        }
        if (!userId) continue;
        await createNotification({
          recipientUserId: userId,
          type: 'event_reminder',
          body: `Lembrete: ${ev.name || 'evento'} em ${faltam} dia(s).`,
          link: { type: 'escala-smart', id: doc.id },
        });
      }
      await firestore.collection('special_scales').doc(doc.id).update({ remindersSent: sent.concat(due) });
      logger.info('[sendEventReminders] Enviado', doc.id, due, 'p/', recipients.length);
    }
  } catch (err) {
    logger.error('[sendEventReminders] FALHA', err);
    throw err;
  }
});
```

- [ ] **Step 3: Verificar sintaxe do arquivo de Functions**

Run: `cd "C:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes" && node -e "require('./functions/reminders-util.js'); new Function(require('fs').readFileSync('functions/index.js','utf8')); console.log('functions sintaxe OK')"`
Expected: `functions sintaxe OK`. (Não executa a CF; só valida parse + que o util carrega.)

- [ ] **Step 4: Commit**

```bash
git add functions/index.js
git commit -m "feat(functions): CF agendada sendEventReminders (lembretes 7/4/1d in-app)"
```

---

## Task 6: UI gestão — evento sem TOI/Hiit + painel de staff

**Files:** Modify `professores-escala-smart.js`. No DOM test — parse check. **LER o arquivo primeiro.**

- [ ] **Step 1: Criação de evento sem TOI/Hiit.** Em `criarNovoEvento` (ou onde o evento chama `criarEscalaData('evento', …)`), passar **slots vazios**. Localizar `criarNovoEvento` e trocar a criação para não usar `escalaSlotsPadrao('evento')`. Se a criação passa por `criarEscalaData(tipo, date, name, eventKind)` que monta `slots: escalaSlotsPadrao(tipo)`, ajustar para: quando `tipo === 'evento'`, usar `slots: []`. Ex., em `criarEscalaData`:

```js
  const payload = { date, tipo, name: name || `${tipoLabel} ${escalaFmtBR(date)}`, slots: tipo === 'evento' ? [] : escalaSlotsPadrao(tipo) };
```

- [ ] **Step 2: Carregar o RSVP do evento selecionado.** Em `renderEscalaGestao`, após `await escalaLoadBase();`, adicionar:

```js
  EscalaSmartState.eventoRsvp = null;
  if (EscalaSmartState.selectedId) {
    const sel = EscalaSmartState.scales.find(s => s.id === EscalaSmartState.selectedId);
    if (sel && sel.tipo === 'evento') {
      const rr = await ScaleService.listEventRsvp(sel.id);
      EscalaSmartState.eventoRsvp = new Map((rr.success ? rr.data : []).map(r => [r.personId, r]));
    }
  }
```

- [ ] **Step 3: Dispatch do detalhe do evento.** Em `renderEscalaDetail`, adicionar no topo (junto dos outros branches por tipo):

```js
  if (scale.tipo === 'evento') return renderEventoDetail(scale);
```

- [ ] **Step 4: `renderEventoDetail` + save + consolidado.** Adicionar (após `renderEscolaInternaDetail`):

```js
function renderEventoDetail(scale) {
  const rsvp = EscalaSmartState.eventoRsvp || new Map();
  const ativos = Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false);
  const tierDe = (pid) => { const r = rsvp.get(pid); return r ? r.tier : ''; };
  const linhas = ativos.map(t => {
    const tier = tierDe(t.id);
    const opt = (val, label) => `<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;margin-right:10px;"><input type="radio" name="staff_${t.id}" value="${val}" ${tier === val || (val === '' && !tier) ? 'checked' : ''}> ${label}</label>`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:13px;">${t.name}</span>
      <div>${opt('obrigatorio', 'Deve')}${opt('opcional', 'Poderia')}${opt('', 'Fora')}</div>
    </div>`;
  }).join('');

  const sum = ScaleService.summarizeRsvp(Array.from(rsvp.values()));
  const nome = (pid) => { const t = EscalaSmartState.teacherMap.get(pid); return t ? t.name : pid; };
  const bloco = (titulo, ids, cor) => ids.length
    ? `<div style="font-size:12px;margin-top:6px;"><span style="color:${cor};font-weight:600;">${titulo} (${ids.length}):</span> ${ids.map(nome).join(', ')}</div>` : '';
  const consolidado = rsvp.size
    ? `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-top:12px;">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em;">Confirmações</div>
        ${bloco('Vão', sum.vao, 'var(--green)')}${bloco('Não vão', sum.naoVao, 'var(--red)')}${bloco('Sem resposta', sum.semResposta, '#caa23a')}
      </div>` : '';

  const kindBadge = scale.eventKind === 'externo' ? 'Externo' : 'Interno';
  return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;">
    <div style="margin-bottom:12px;"><div style="font-weight:600;">${scale.name || scale.date}</div>
      <div style="font-size:12px;color:var(--text2);">${scale.date} · ${kindBadge}</div></div>
    <div style="font-size:13px;font-weight:500;margin-bottom:6px;">Staff — quem deve / poderia participar</div>
    <div style="max-height:40vh;overflow:auto;">${linhas || '<p style="color:var(--text2);">Nenhum colaborador ativo.</p>'}</div>
    <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button class="btn-primary" onclick="salvarStaffEvento('${scale.id}')">Salvar staff e convidar</button></div>
    ${consolidado}
  </div>`;
}

async function salvarStaffEvento(scaleId) {
  const obrigatorios = [], opcionais = [];
  Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false).forEach(t => {
    const sel = document.querySelector(`input[name="staff_${t.id}"]:checked`);
    const v = sel ? sel.value : '';
    if (v === 'obrigatorio') obrigatorios.push(t.id);
    else if (v === 'opcional') opcionais.push(t.id);
  });
  const res = await ScaleService.setEventStaff(scaleId, obrigatorios, opcionais);
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); return; }
  // convite in-app só p/ os recém-adicionados
  const novos = res.data.added || [];
  if (novos.length) {
    const scale = EscalaSmartState.scales.find(s => s.id === scaleId) || {};
    const recipientIds = [];
    for (const pid of novos) {
      const t = EscalaSmartState.teacherMap.get(pid);
      let uid = t && t.userId ? t.userId : null;
      if (!uid) { try { const us = await db.collection('users').where('professorId', '==', pid).limit(1).get(); if (!us.empty) uid = us.docs[0].id; } catch (e) {} }
      if (uid) recipientIds.push(uid);
    }
    if (recipientIds.length) {
      await NotifyService.send({ recipients: recipientIds, type: 'event_invite', title: 'Convite de evento',
        body: `Você está no staff de ${scale.name || 'um evento'} (${escalaFmtBR(scale.date)}). Confirme presença.`,
        link: { type: 'escala-smart', id: scaleId }, channels: ['inapp'] });
    }
  }
  toast('Staff salvo. Convite enviado aos novos.', 'success');
  renderEscalaGestao();
}
```

- [ ] **Step 5: Exportar** — adicionar `window.salvarStaffEvento = salvarStaffEvento;`.

- [ ] **Step 6: Adicionar `event_invite` em `NOTIF_TYPE_META`** (`professores-shared.js`) para o ícone do sino — junto das entradas `scale_*` (perto da linha 1352):

```js
  event_invite:            { icon: '📣', title: 'Convite de evento' },
  event_reminder:          { icon: '⏰', title: 'Lembrete de evento' },
```

- [ ] **Step 7: Parse check**

Run: `cd "C:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes" && node -e "new Function(require('fs').readFileSync('professores-escala-smart.js','utf8').replace(/^\xEF\xBB\xBF/,'')); new Function(require('fs').readFileSync('professores-shared.js','utf8').replace(/^\xEF\xBB\xBF/,'')); console.log('sintaxe OK')" && node scripts/smoke-escala-frente3.js >/dev/null && echo "smoke OK"`
Expected: ambos OK.

- [ ] **Step 8: Commit**

```bash
git add professores-escala-smart.js professores-shared.js
git commit -m "feat(escala): evento vira painel de staff na gestao (selecao + convite + consolidado)"
```

---

## Task 7: UI professor — aba Eventos acionável (Vou / Não vou)

**Files:** Modify `professores-escala-smart.js`.

- [ ] **Step 1: Tornar `renderProfEventos` async e com RSVP.** Substituir a função `renderProfEventos()` (read-only, da Frente 2) por:

```js
async function renderProfEventos() {
  const pid = escalaProfId();
  let docs = EscalaSmartState.scales.filter(s => s.tipo === 'evento');
  docs = ScaleService.filterByTimeframe(docs, escalaTodayISO(), EscalaSmartState.timeframe);
  if (!docs.length) return `<p style="padding:20px;color:var(--text2);">Nenhum evento ${EscalaSmartState.timeframe === 'futuros' ? 'próximo' : ''}.</p>`;
  const parts = [];
  for (const s of docs) {
    const rr = await ScaleService.listEventRsvp(s.id);
    const mine = (rr.success ? rr.data : []).find(r => r.personId === pid);
    const kind = s.eventKind === 'externo' ? 'Externo' : 'Interno';
    let right;
    if (mine) {
      const rbtn = (val, label, color) => {
        const active = mine.going === val;
        const style = active ? `background:${color};color:#0a0a0a;border:1px solid ${color};font-weight:600;` : `background:transparent;color:var(--text2);border:1px solid var(--border);`;
        return `<button onclick="responderEvento('${s.id}',${val})" style="font-size:13px;padding:7px 12px;border-radius:8px;cursor:pointer;${style}">${label}</button>`;
      };
      right = `<div style="display:flex;gap:6px;">${rbtn(true, 'Vou', 'var(--green)')}${rbtn(false, 'Não vou', 'var(--red)')}</div>`;
    } else {
      right = `<span style="font-size:12px;color:var(--text3);">informativo</span>`;
    }
    parts.push(`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;flex-wrap:wrap;">
      <div><div style="font-weight:600;font-size:14px;">${s.name || s.date}</div><div style="font-size:12px;color:var(--text2);">${escalaFmtBR(s.date)} · ${kind}${mine && mine.tier === 'obrigatorio' ? ' · você deve participar' : (mine ? ' · você poderia participar' : '')}</div></div>
      ${right}
    </div>`);
  }
  return parts.join('');
}

async function responderEvento(scaleId, going) {
  const pid = escalaProfId();
  if (!pid) { toast('Seu perfil não está vinculado a um professor.', 'error'); return; }
  const res = await ScaleService.setRsvp(scaleId, pid, going);
  if (res.success) { toast(going ? 'Presença confirmada!' : 'Ok, marcado como não vou.', 'success'); renderEscalaPrefs(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}
```

- [ ] **Step 2: `renderProfEventos` agora é async — ajustar o dispatch.** Em `renderEscalaPrefs`, a linha `else if (tab === 'evento') body = renderProfEventos();` passa a `body = await renderProfEventos();`.

- [ ] **Step 3: Exportar** — adicionar `window.responderEvento = responderEvento;`.

- [ ] **Step 4: Parse check**

Run: `node -e "new Function(require('fs').readFileSync('professores-escala-smart.js','utf8').replace(/^\xEF\xBB\xBF/,'')); console.log('sintaxe OK')" && node scripts/smoke-escala-frente3.js >/dev/null && echo "smoke OK"`
Expected: ambos OK.

- [ ] **Step 5: Commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala): aba Eventos do professor acionavel (RSVP Vou/Nao vou)"
```

---

## Task 8: Verificação final + deploy staging

**Files:** nenhum (verificação + deploy).

- [ ] **Step 1: Suíte de smokes + parse**

```bash
cd "C:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes" && node scripts/smoke-escala-frente3.js && node scripts/smoke-event-reminders.js && node scripts/smoke-escala-frente2.js && node scripts/smoke-escala-frente1.js && node scripts/smoke-scale-service.js && node scripts/smoke-escala-tabs.js && node scripts/smoke-notify-service.js && node -e "new Function(require('fs').readFileSync('professores-escala-smart.js','utf8').replace(/^\xEF\xBB\xBF/,'')); require('./functions/reminders-util.js'); console.log('parse OK')"
```
Expected: todos verdes.

- [ ] **Step 2: Deploy no staging** (PEDIR OK — regra 7; inclui **rules + functions + hosting**; a CF nova precisa ir):

```bash
cd "C:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes" && firebase deploy --only firestore:rules,functions:sendEventReminders,hosting --project staging
```

- [ ] **Step 3: Validar a regra `event_rsvp` por REST** (token de professor; Admin SDK bypassa) — professor grava a SUA resposta (personId == professorId) OK; grava a de outro = negado. Registrar.

- [ ] **Step 4: Checklist E2E staging** (`dono.teste@` e `professor.teste@`):
- [ ] Criar um evento novo — não gera mais vagas TOI/Hiit; o detalhe mostra o painel de staff.
- [ ] Marcar alguns Deve / Poderia → "Salvar staff e convidar" → o convite in-app chega aos selecionados.
- [ ] Professor (staff): aba Eventos mostra Vou / Não vou; obrigatório já vem "Vou"; opcional em aberto; responder reflete no consolidado da gestão.
- [ ] Consolidado da gestão mostra Vão / Não vão / Sem resposta.
- [ ] **Lembretes:** validar a CF — pelo console de Functions (logs) e/ou criar um evento com data a 7/4/1 dia e disparar a CF manualmente (ou aguardar o agendamento) → notificação chega a quem não recusou; `remindersSent` grava o offset (não repete).
- [ ] Console limpo.

- [ ] **Step 5: Commit (se houver ajuste de E2E)**

```bash
git add -A && git commit -m "chore(escala): ajustes de E2E da Frente 3 no staging"
```

---

## Notas de execução

- **CF nova** — primeira função agendada desta leva. O deploy de `functions:sendEventReminders` sobe só ela. Validar região/execução no staging (logs). Idempotência via `remindersSent` no doc do evento.
- **Rules OBRIGATÓRIAS no staging** antes do RSVP do professor (`event_rsvp`).
- **Eventos antigos** com slots TOI/Hiit seguem existindo (inertes) — sem migração; o detalhe passa a mostrar staff.
- **Fora de escopo (4ª rodada):** tabela gestão (escalado×compareceu), calendário mensal da Escola Interna, mínimo de preferências (cota justa calculada), substituição lançada pelo substituto (aprovação + ajuste de horas), e os ajustes prontos (data 2x, escalar manual, detalhes do fim de ano). Cada um no seu ciclo.
- **Produção só após homologação** (CLAUDE.md §7).
