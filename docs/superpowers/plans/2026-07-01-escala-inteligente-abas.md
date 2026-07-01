# Escala Inteligente em 4 abas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar a tela Escala Inteligente em 4 abas (Sábados · Feriados · Eventos · Fim de ano) conforme o feedback do Rodrigo, com sábados do ano em lista virtual, feriados sugeridos pela BrasilAPI, eventos com etiqueta interno/externo, e a tela legada "Escalas Especiais" fora do menu.

**Spec:** `docs/superpowers/specs/2026-07-01-escala-inteligente-abas-design.md`

**Architecture:** Helpers puros novos entram em `scale-service.js` (UMD, testável em Node via smokes com `_fake-firestore.js`). A UI (`professores-escala-smart.js`) ganha estado de aba/ano e um render por aba; o detalhe da escala, preferências, consolidação e publicação NÃO mudam. Nenhuma coleção nova; campo opcional `eventKind` em `special_scales`. Rules já permitem ler `meta/holidays_cache_*` (firestore.rules linha 283-285) — zero mudança de rules.

**Tech Stack:** JS vanilla + Firebase compat (padrão do projeto), smokes Node com `assert`, BrasilAPI (`https://brasilapi.com.br/api/feriados/v1/{ano}`).

**Convenções do projeto:** comentários em PT-BR; texto visível usa `CrossTainer`; commits na branch `feature/shell-integrado`; deploy só pra staging (default do `.firebaserc`), produção NUNCA.

**Gap latente corrigido de passagem:** hoje `criarEscala` (UI) monta slots SEM `startTime/endTime` e nunca lê `ScaleConfigService.horarios` — e `publishToAgenda` pula slot sem horário, então um sábado criado pela UI publicaria 0 aulas. O novo builder de slots da UI (Task 3) aplica os horários da config por tipo.

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `scale-service.js` | Modificar | + 4 helpers puros exportados (`saturdaysOfYear`, `mergeVirtualWithDocs`, `parseFeriados`, `isLegacyScaleDoc`); filtro de legado em `listScales`; `eventKind` em `createScale` |
| `scripts/smoke-escala-tabs.js` | Criar | Smoke Node dos helpers + filtro + eventKind |
| `professores-escala-smart.js` | Modificar | Abas (estado tab/ano), render por aba, criação contextual com horários da config, modais Data especial / Novo evento / Fim de ano; remove `openNovaEscala`/`onNovaEscalaTipo`/`criarEscala` antigos |
| `professores-nav.js` | Modificar | Remover `'escalas'` de `admin` e `supervisao` (esconde a tela legada) |
| `CONTEXTO_SESSAO.md` | Modificar | Log da sessão (final) |

---

### Task 1: Helpers puros em `scale-service.js`

**Files:**
- Modify: `scale-service.js` (helpers após `templateSlots`, ~linha 27; exports na linha 331)
- Create: `scripts/smoke-escala-tabs.js`

- [ ] **Step 1: Escrever o smoke que falha**

Criar `scripts/smoke-escala-tabs.js`:

```js
'use strict';
// Roda: node scripts/smoke-escala-tabs.js
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'tester' });

(async () => {
  // ── saturdaysOfYear ──
  const s26 = SS.saturdaysOfYear(2026);
  assert.strictEqual(s26.length, 52, '2026 tem 52 sábados');
  assert.strictEqual(s26[0], '2026-01-03', 'primeiro sábado de 2026');
  assert.strictEqual(s26[s26.length - 1], '2026-12-26', 'último sábado de 2026');
  s26.forEach(d => assert.strictEqual(new Date(d + 'T12:00:00').getDay(), 6, `${d} é sábado`));
  const s28 = SS.saturdaysOfYear(2028); // bissexto começando em sábado
  assert.strictEqual(s28[0], '2028-01-01', '2028 começa num sábado');
  assert.strictEqual(s28.length, 53, '2028 tem 53 sábados');
  console.log('✓ saturdaysOfYear OK');

  // ── mergeVirtualWithDocs ──
  const merged = SS.mergeVirtualWithDocs(
    ['2026-07-04', '2026-07-11', '2026-07-18'],
    [{ id: 'a', date: '2026-07-11', tipo: 'sabado' }, { id: 'b', date: '2026-07-11', tipo: 'sabado' }]
  );
  assert.strictEqual(merged.length, 3, 'uma linha por data');
  assert.strictEqual(merged[0].docs.length, 0, 'sem doc = lista vazia');
  assert.strictEqual(merged[1].docs.length, 2, 'dois docs na mesma data não quebra');
  assert.strictEqual(merged[1].date, '2026-07-11');
  assert.deepStrictEqual(SS.mergeVirtualWithDocs([], []), [], 'vazio ok');
  console.log('✓ mergeVirtualWithDocs OK');

  // ── parseFeriados ──
  const fer = SS.parseFeriados([
    { date: '2026-09-07', name: 'Independência do Brasil', type: 'national' },
    { date: 'xx', name: 'lixo' }, { name: 'sem data' }, null,
  ]);
  assert.deepStrictEqual(fer, [{ date: '2026-09-07', name: 'Independência do Brasil' }], 'só entrada válida passa');
  assert.deepStrictEqual(SS.parseFeriados(null), [], 'não-array = vazio');
  assert.deepStrictEqual(SS.parseFeriados({ erro: true }), [], 'objeto = vazio');
  console.log('✓ parseFeriados OK');

  // ── isLegacyScaleDoc ──
  assert.strictEqual(SS.isLegacyScaleDoc({ date: { seconds: 1781838000 }, name: 'fds' }), true, 'date Timestamp = legado');
  assert.strictEqual(SS.isLegacyScaleDoc({ date: '2026-07-04' }), true, 'sem tipo = legado');
  assert.strictEqual(SS.isLegacyScaleDoc(null), true, 'null = legado');
  assert.strictEqual(SS.isLegacyScaleDoc({ date: '2026-07-04', tipo: 'sabado' }), false, 'formato novo passa');
  console.log('✓ isLegacyScaleDoc OK');

  // ── listScales filtra legado ──
  const db = makeFakeDb();
  const d = deps(db);
  await db.collection('special_scales').doc('leg1').set({ date: { seconds: 1781838000 }, name: 'fds' });
  const cRes = await SS.createScale({ date: '2026-07-04', tipo: 'sabado', name: 'Sábado 04/07', slots: [] }, d);
  assert.ok(cRes.success, 'criou escala nova');
  const l = await SS.listScales(d);
  assert.strictEqual(l.data.length, 1, 'doc legado filtrado da lista');
  assert.strictEqual(l.data[0].tipo, 'sabado');
  console.log('✓ listScales filtra legado OK');

  // ── eventKind no createScale ──
  const eRes = await SS.createScale({ date: '2026-08-15', tipo: 'evento', name: 'Campeonato', slots: [], eventKind: 'externo' }, d);
  assert.strictEqual(eRes.data.eventKind, 'externo', 'eventKind persiste');
  const g = await SS.getScale(eRes.data.id, d);
  assert.strictEqual(g.data.eventKind, 'externo', 'eventKind lido de volta');
  const sRes = await SS.createScale({ date: '2026-07-11', tipo: 'sabado', name: 'Sáb', slots: [] }, d);
  assert.strictEqual(sRes.data.eventKind, null, 'sem eventKind = null');
  console.log('✓ eventKind OK');

  console.log('\n✅ smoke-escala-tabs: tudo OK');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-escala-tabs.js`
Expected: FAIL — `SS.saturdaysOfYear is not a function`

- [ ] **Step 3: Implementar os helpers**

Em `scale-service.js`, inserir após a função `templateSlots` (depois da linha 27):

```js
  // ── Helpers puros das abas (sábados virtuais / feriados / legado) ──
  function pad2(n) { return String(n).padStart(2, '0'); }

  // Todos os sábados de um ano, em ISO local (sem UTC pra não escorregar de dia)
  function saturdaysOfYear(year) {
    const out = [];
    const d = new Date(year, 0, 1);
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7)); // pula pro primeiro sábado
    while (d.getFullYear() === year) {
      out.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
      d.setDate(d.getDate() + 7);
    }
    return out;
  }

  // [{ date, docs: [escalas naquela data] }] preservando a ordem das datas
  function mergeVirtualWithDocs(dates, docs) {
    const byDate = {};
    (docs || []).forEach(doc => { (byDate[doc.date] = byDate[doc.date] || []).push(doc); });
    return (dates || []).map(date => ({ date, docs: byDate[date] || [] }));
  }

  // Shape da BrasilAPI: [{ date:'2026-09-07', name:'…', type:'national' }] → [{date,name}]
  function parseFeriados(json) {
    if (!Array.isArray(json)) return [];
    return json
      .filter(f => f && typeof f.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.date) && typeof f.name === 'string')
      .map(f => ({ date: f.date, name: f.name }));
  }

  // Docs pré-Escala Inteligente (tela legada): date Timestamp e/ou sem tipo
  function isLegacyScaleDoc(doc) {
    if (!doc) return true;
    if (typeof doc.tipo !== 'string' || !doc.tipo) return true;
    if (typeof doc.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.date)) return true;
    return false;
  }
```

Em `createScale` (linha ~61), adicionar `eventKind` ao doc:

```js
      const doc = {
        date: scale.date, name: scale.name || '', tipo: scale.tipo,
        eventKind: scale.eventKind || null,
        status: 'rascunho', slots: scale.slots || [], externalId: '',
        createdAt: rts(deps), createdBy: ruid(deps),
      };
```

Em `listScales` (linha ~81), filtrar legado:

```js
      const snap = await rdb(deps).collection('special_scales').orderBy('date').get();
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => !isLegacyScaleDoc(s));
      return { success: true, data };
```

No `return` final (linha ~331), adicionar os 4 helpers ao objeto exportado:

```js
  return { templateSlots, templateSlotsFimDeAno, datesInRange, saturdaysOfYear, mergeVirtualWithDocs, parseFeriados, isLegacyScaleDoc, ScaleConfigService, createScale, getScale, listScales, openElection, closeElection, setStatus, setPreference, listPreferences, getFairness, saveFairness, applyFairnessDelta, buildCandidates, consolidate, consolidateByDay, publishToAgenda, unpublishFromAgenda };
```

- [ ] **Step 4: Rodar e ver passar (novo + regressão)**

Run: `node scripts/smoke-escala-tabs.js && node scripts/smoke-scale-service.js`
Expected: `✅ smoke-escala-tabs: tudo OK` e o smoke antigo segue passando

- [ ] **Step 5: Commit**

```bash
git add scale-service.js scripts/smoke-escala-tabs.js
git commit -m "feat(escala): helpers puros das abas (sábados do ano, merge, feriados, legado) + eventKind + filtro de docs legados"
```

---

### Task 2: UI base — estado de abas, carga de config/feriados, builder de slots com horário

**Files:**
- Modify: `professores-escala-smart.js:9` (estado), `:35-56` (escalaLoadBase), inserir helpers novos após `escalaTodayISO` (linha 27)

- [ ] **Step 1: Estado + constantes de aba**

Substituir a linha 9:

```js
const EscalaSmartState = { scales: [], units: [], modToi: null, modHiit: null, selectedId: null, teacherMap: new Map(), fairnessMap: new Map(), tab: 'sabado', year: new Date().getFullYear(), feriadosByYear: {}, config: null };
```

Após o array `ESCALA_STATUS_LABEL` (linha 18), adicionar:

```js
const ESCALA_TABS = [
  { id: 'sabado',     label: 'Sábados' },
  { id: 'feriado',    label: 'Feriados' },
  { id: 'evento',     label: 'Eventos' },
  { id: 'fim_de_ano', label: 'Fim de ano' },
];
```

- [ ] **Step 2: Carregar a config da escala junto com a base**

Em `escalaLoadBase()` (linha 35), incluir a config no `Promise.all`:

```js
async function escalaLoadBase() {
  const [scalesRes, unitsRes, modsRes, teachersRes, cfgRes] = await Promise.all([
    ScaleService.listScales(),
    (typeof UnitService === 'object' ? UnitService.list() : Promise.resolve({ success: true, data: [] })),
    ModalityService.list(),
    TeacherService.list(),
    ScaleService.ScaleConfigService.get(),
  ]);
  EscalaSmartState.config = cfgRes.success ? cfgRes.data : { horarios: {} };
```

(o resto da função permanece igual)

- [ ] **Step 3: Helpers novos da UI**

Inserir após `escalaTodayISO()` (linha 27):

```js
function escalaFmtBR(iso) { return iso.split('-').reverse().join('/'); }

// Slots-padrão (1 TOI + 1 Hiit por unidade) COM os horários da config por tipo.
// Sem horário o publishToAgenda pula o slot — por isso a config é obrigatória aqui.
function escalaSlotsPadrao(tipo) {
  const toi = EscalaSmartState.modToi, hiit = EscalaSmartState.modHiit;
  const hor = ((EscalaSmartState.config || {}).horarios || {})[tipo] || {};
  const slots = [];
  EscalaSmartState.units.forEach(u => {
    slots.push({ id: `${u.id}_TOI`,  unitId: u.id, requiredModalityId: toi.id,  requiredModalityName: 'TOI',  assignedPersonId: null, startTime: hor.startTime || '08:00', endTime: hor.endTime || '12:00' });
    slots.push({ id: `${u.id}_HIIT`, unitId: u.id, requiredModalityId: hiit.id, requiredModalityName: 'Hiit', assignedPersonId: null, startTime: hor.startTime || '08:00', endTime: hor.endTime || '12:00' });
  });
  return slots;
}

// Feriados nacionais do ano: BrasilAPI → fallback cache da CF → vazio (com aviso na aba)
async function escalaLoadFeriados(year) {
  if (EscalaSmartState.feriadosByYear[year]) return EscalaSmartState.feriadosByYear[year];
  let list = [];
  try {
    const resp = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`);
    if (resp.ok) list = ScaleService.parseFeriados(await resp.json());
  } catch (e) { /* offline: cai pro cache */ }
  if (!list.length) {
    try {
      const doc = await db.collection('meta').doc(`holidays_cache_${year}`).get();
      if (doc.exists) list = ScaleService.parseFeriados((doc.data() || {}).feriados);
    } catch (e) { /* sem cache: fica vazio */ }
  }
  EscalaSmartState.feriadosByYear[year] = list;
  return list;
}

function escalaSetTab(t) { EscalaSmartState.tab = t; EscalaSmartState.selectedId = null; renderEscalaGestao(); }
function escalaSetYear(y) { EscalaSmartState.year = parseInt(y, 10); renderEscalaGestao(); }
```

- [ ] **Step 4: Criação contextual única**

Substituir a função `criarEscala` inteira (linhas 311-327) por:

```js
// Criação contextual usada pelas abas Sábados/Feriados/Eventos
async function criarEscalaData(tipo, date, name, eventKind) {
  if (!date) { toast('Informe a data.', 'error'); return; }
  const toi = EscalaSmartState.modToi, hiit = EscalaSmartState.modHiit;
  if (!toi || !hiit) { toast('Cadastre as modalidades TOI e Hiit antes.', 'error'); return; }
  const tipoLabel = (ESCALA_TIPOS.find(t => t.id === tipo) || {}).label || tipo;
  const payload = { date, tipo, name: name || `${tipoLabel} ${escalaFmtBR(date)}`, slots: escalaSlotsPadrao(tipo) };
  if (eventKind) payload.eventKind = eventKind;
  const res = await ScaleService.createScale(payload);
  if (res.success) { toast('Escala criada!', 'success'); closeEscalaModal(); EscalaSmartState.selectedId = res.data.id; renderEscalaGestao(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}
```

Nos exports de `window` (linhas 466-478): trocar `window.criarEscala = criarEscala;` por:

```js
window.criarEscalaData = criarEscalaData;
window.escalaSetTab = escalaSetTab;
window.escalaSetYear = escalaSetYear;
```

- [ ] **Step 5: Sintaxe**

Run: `node --check professores-escala-smart.js`
Expected: sem saída (OK) — a UI ainda referencia `openNovaEscala`/`criarEscala` antigos no HTML; eles serão trocados nas Tasks 3-6 (o arquivo compila, o fluxo antigo ainda funciona porque `openNovaEscala` continua existindo até a Task 6)

- [ ] **Step 6: Commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala-ui): estado de abas + config de horários na criação + loader de feriados (BrasilAPI+cache)"
```

---

### Task 3: Estrutura de abas no render da gestão + card unificado

**Files:**
- Modify: `professores-escala-smart.js:111-148` (`renderEscalaGestao`)

- [ ] **Step 1: Card de escala reutilizável**

Inserir antes de `renderEscalaGestao` (linha 110):

```js
function escalaCardDoc(s) {
  const sel = s.id === EscalaSmartState.selectedId;
  const statusColor = s.status === 'consolidada' ? 'var(--green)' : (s.status === 'janela_aberta' ? 'var(--blue)' : 'var(--text2)');
  const statusTxt = (ESCALA_STATUS_LABEL[s.status] || s.status) + (s.published ? ' · ✓ publicada' : '');
  const kindBadge = (s.tipo === 'evento' && s.eventKind)
    ? `<span style="font-size:11px;padding:2px 8px;border-radius:6px;background:${s.eventKind === 'externo' ? '#2a1a2e' : 'var(--surface3)'};color:${s.eventKind === 'externo' ? '#c77dff' : 'var(--text2)'};margin-left:6px;">${s.eventKind === 'externo' ? 'Externo' : 'Interno'}</span>` : '';
  return `<div onclick="selectEscala('${s.id}')" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;background:${sel ? 'var(--surface2)' : 'var(--surface)'};border:1px solid ${sel ? 'var(--blue)' : 'var(--border)'};border-radius:10px;padding:10px 12px;margin-bottom:6px;">
    <div><div style="font-weight:600;font-size:14px;">${s.name || s.date}${kindBadge}</div><div style="font-size:12px;color:var(--text2);">${s.date}</div></div>
    <span style="font-size:12px;font-weight:600;color:${statusColor};">${statusTxt}</span>
  </div>`;
}
```

- [ ] **Step 2: Reescrever `renderEscalaGestao` com abas**

Substituir a função inteira (linhas 111-148) por:

```js
async function renderEscalaGestao() {
  const container = document.getElementById('page-escala-smart');
  if (!container) return;
  container.innerHTML = `
    <div class="page-hdr"><h1>🗓️ Escala Inteligente</h1><p>Sábados/feriados: o sistema sugere por justiça + mérito; você ajusta e publica.</p></div>
    <div class="loading"><div class="spinner"></div> Carregando escalas…</div>`;

  await escalaLoadBase();
  if (EscalaSmartState.tab === 'feriado') await escalaLoadFeriados(EscalaSmartState.year);

  const scales = EscalaSmartState.scales;
  const tab = EscalaSmartState.tab;
  const tabsHtml = `<div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:12px;">` +
    ESCALA_TABS.map(t => {
      const on = t.id === tab;
      return `<button onclick="escalaSetTab('${t.id}')" style="background:none;border:none;border-bottom:2px solid ${on ? 'var(--blue)' : 'transparent'};color:${on ? 'var(--text)' : 'var(--text2)'};font-weight:${on ? '600' : '400'};font-size:14px;padding:8px 14px;cursor:pointer;">${t.label}</button>`;
    }).join('') + `</div>`;

  const y = EscalaSmartState.year;
  const yearSel = tab === 'fim_de_ano' ? '' :
    `<select class="input" style="width:auto;" onchange="escalaSetYear(this.value)">${[y - 1, y, y + 1].map(v => `<option value="${v}" ${v === y ? 'selected' : ''}>${v}</option>`).join('')}</select>`;

  let listHtml;
  if (tab === 'sabado')          listHtml = renderTabSabados(scales);
  else if (tab === 'feriado')    listHtml = renderTabFeriados(scales);
  else if (tab === 'evento')     listHtml = renderTabEventos(scales);
  else                           listHtml = renderTabFimDeAno(scales);

  const detail = EscalaSmartState.selectedId ? renderEscalaDetail(scales.find(s => s.id === EscalaSmartState.selectedId)) : '';

  container.innerHTML = `
    <div class="page-hdr"><h1>🗓️ Escala Inteligente</h1><p>Sábados/feriados: o sistema sugere por justiça + mérito; você ajusta e publica.</p></div>
    ${renderEquilibrioPainel()}
    ${tabsHtml}
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">${yearSel}</div>
    <div style="display:grid;grid-template-columns:minmax(220px,1fr) 2fr;gap:16px;align-items:start;">
      <div>${listHtml}</div>
      <div>${detail || '<p style="padding:20px;color:var(--text2);">Selecione uma escala à esquerda.</p>'}</div>
    </div>
    <div id="escalaModalOverlay" class="modal-overlay" style="display:none;"></div>
    <div id="escalaModal" class="modal" style="display:none;"></div>`;
}
```

Nota: o `page-toolbar` com o botão global "+ Nova escala" morreu aqui de propósito — as ações agora são por aba. Até a Task 4 existir, definir stubs temporários no fim do arquivo pra compilar (serão substituídos):

```js
function renderTabSabados()  { return '<p style="padding:20px;color:var(--text2);">…</p>'; }
function renderTabFeriados() { return '<p style="padding:20px;color:var(--text2);">…</p>'; }
function renderTabEventos()  { return '<p style="padding:20px;color:var(--text2);">…</p>'; }
function renderTabFimDeAno() { return '<p style="padding:20px;color:var(--text2);">…</p>'; }
```

- [ ] **Step 3: Sintaxe**

Run: `node --check professores-escala-smart.js`
Expected: OK

- [ ] **Step 4: Commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala-ui): barra de abas + seletor de ano + card unificado (stubs por aba)"
```

---

### Task 4: Aba Sábados (lista virtual do ano)

**Files:**
- Modify: `professores-escala-smart.js` (substituir o stub `renderTabSabados`)

- [ ] **Step 1: Implementar**

```js
function renderTabSabados(scales) {
  const rows = ScaleService.mergeVirtualWithDocs(
    ScaleService.saturdaysOfYear(EscalaSmartState.year),
    scales.filter(s => s.tipo === 'sabado')
  );
  const com = rows.filter(r => r.docs.length).length;
  const header = `<div style="font-size:12px;color:var(--text2);margin-bottom:8px;">${rows.length} sábados · ${com} com escala</div>`;
  const body = rows.map(r => r.docs.length
    ? r.docs.map(escalaCardDoc).join('')
    : `<div onclick="criarEscalaData('sabado','${r.date}')" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;background:transparent;border:1px dashed var(--border);border-radius:10px;padding:10px 12px;margin-bottom:6px;">
        <div style="font-size:14px;color:var(--text2);">Sábado ${escalaFmtBR(r.date)}</div>
        <span style="font-size:12px;color:var(--text3);">Sem escala · clique pra criar</span>
      </div>`
  ).join('');
  return header + body;
}
```

- [ ] **Step 2: Sintaxe + preview local**

Run: `node --check professores-escala-smart.js`
Expected: OK. Verificação visual fica pra Task 8 (E2E staging).

- [ ] **Step 3: Commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala-ui): aba Sábados — todos os sábados do ano, escala criada sob demanda"
```

---

### Task 5: Aba Feriados (BrasilAPI + Data especial manual)

**Files:**
- Modify: `professores-escala-smart.js` (substituir o stub `renderTabFeriados`; adicionar modal)

- [ ] **Step 1: Implementar o render**

```js
function renderTabFeriados(scales) {
  const y = EscalaSmartState.year;
  const feriados = EscalaSmartState.feriadosByYear[y] || [];
  const docs = scales.filter(s => (s.tipo === 'feriado' || s.tipo === 'domingo_especial') && s.date.startsWith(String(y)));
  const datasComDoc = new Set(docs.map(dd => dd.date));
  const sugestoes = feriados.filter(f => !datasComDoc.has(f.date));

  const topo = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
    <span style="font-size:12px;color:var(--text2);">A gestão aponta quais feriados terão escala.</span>
    <button class="btn-secondary" onclick="openDataEspecial()">+ Data especial</button></div>`;
  const aviso = feriados.length ? '' :
    `<p style="font-size:12px;color:#caa23a;margin:0 0 8px;">Não consegui carregar os feriados nacionais (API/cache indisponível) — adicione pelo "+ Data especial".</p>`;
  const docsHtml = docs.map(escalaCardDoc).join('');
  const sugHtml = sugestoes.map(f => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px dashed var(--border);border-radius:10px;padding:10px 12px;margin-bottom:6px;">
      <div><div style="font-size:14px;color:var(--text2);">${f.name}</div><div style="font-size:12px;color:var(--text3);">${escalaFmtBR(f.date)} · nacional</div></div>
      <button class="btn-secondary" style="font-size:12px;" onclick="criarEscalaData('feriado','${f.date}','${(f.name || '').replace(/'/g, '')}')">Criar escala</button>
    </div>`).join('');
  return topo + aviso + docsHtml + sugHtml;
}
```

- [ ] **Step 2: Modal "+ Data especial"**

Adicionar junto das funções de modal (após `closeEscalaModal`, linha ~309):

```js
function openDataEspecial() {
  const overlay = document.getElementById('escalaModalOverlay');
  const modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex';
  modal.style.display = 'block';
  modal.innerHTML = `
    <h2>Data especial</h2>
    <div class="form-group"><label>Nome <span style="color:var(--red);">*</span></label><input type="text" id="deNome" class="input" placeholder="Ex.: Aniversário da cidade"></div>
    <div class="form-group"><label>Data <span style="color:var(--red);">*</span></label><input type="date" id="deData" class="input" value="${escalaTodayISO()}"></div>
    <div class="form-group"><label>Tipo</label><select id="deTipo" class="input">
      <option value="feriado">Feriado (municipal/estadual)</option>
      <option value="domingo_especial">Domingo especial</option>
    </select></div>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      <button class="btn-primary" onclick="criarDataEspecial()">Criar</button>
    </div>`;
}

async function criarDataEspecial() {
  const nome = (document.getElementById('deNome').value || '').trim();
  const date = document.getElementById('deData').value;
  const tipo = document.getElementById('deTipo').value;
  if (!nome || !date) { toast('Informe nome e data.', 'error'); return; }
  await criarEscalaData(tipo, date, `${nome} ${escalaFmtBR(date)}`);
}
```

E nos exports de `window`:

```js
window.openDataEspecial = openDataEspecial;
window.criarDataEspecial = criarDataEspecial;
```

- [ ] **Step 3: Sintaxe**

Run: `node --check professores-escala-smart.js`
Expected: OK

- [ ] **Step 4: Commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala-ui): aba Feriados — BrasilAPI sugere, gestão aponta; + Data especial manual (municipal/domingo)"
```

---

### Task 6: Aba Eventos (interno/externo)

**Files:**
- Modify: `professores-escala-smart.js` (substituir o stub `renderTabEventos`; adicionar modal)

- [ ] **Step 1: Implementar o render**

```js
function renderTabEventos(scales) {
  const docs = scales.filter(s => s.tipo === 'evento' && s.date.startsWith(String(EscalaSmartState.year)));
  const topo = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
    <span style="font-size:12px;color:var(--text2);">Quem trabalha/representa no evento. Presença/ponto continua na Chamada do Engajamento.</span>
    <button class="btn-primary" onclick="openNovoEvento()">+ Novo evento</button></div>`;
  const body = docs.length ? docs.map(escalaCardDoc).join('')
    : `<p style="padding:20px;color:var(--text2);">Nenhum evento em ${EscalaSmartState.year}. Crie o primeiro.</p>`;
  return topo + body;
}
```

- [ ] **Step 2: Modal "+ Novo evento"**

Adicionar após `criarDataEspecial`:

```js
function openNovoEvento() {
  const overlay = document.getElementById('escalaModalOverlay');
  const modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex';
  modal.style.display = 'block';
  modal.innerHTML = `
    <h2>Novo evento</h2>
    <div class="form-group"><label>Nome <span style="color:var(--red);">*</span></label><input type="text" id="evNome" class="input" placeholder="Ex.: Campeonato interbox"></div>
    <div class="form-group"><label>Data <span style="color:var(--red);">*</span></label><input type="date" id="evData" class="input" value="${escalaTodayISO()}"></div>
    <div class="form-group"><label>Classificação</label><div style="display:flex;gap:14px;padding:4px 0;">
      <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;"><input type="radio" name="evKind" value="interno" checked> Interno (reunião, treinamento)</label>
      <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;"><input type="radio" name="evKind" value="externo"> Externo (campeonato, evento fora)</label>
    </div></div>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      <button class="btn-primary" onclick="criarNovoEvento()">Criar</button>
    </div>`;
}

async function criarNovoEvento() {
  const nome = (document.getElementById('evNome').value || '').trim();
  const date = document.getElementById('evData').value;
  const kind = (document.querySelector('input[name="evKind"]:checked') || {}).value || 'interno';
  if (!nome || !date) { toast('Informe nome e data.', 'error'); return; }
  await criarEscalaData('evento', date, `${nome} ${escalaFmtBR(date)}`, kind);
}
```

E nos exports de `window`:

```js
window.openNovoEvento = openNovoEvento;
window.criarNovoEvento = criarNovoEvento;
```

- [ ] **Step 3: Sintaxe**

Run: `node --check professores-escala-smart.js`
Expected: OK

- [ ] **Step 4: Commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala-ui): aba Eventos — escala de evento com etiqueta interno/externo"
```

---

### Task 7: Aba Fim de ano + aposentar o fluxo antigo de criação

**Files:**
- Modify: `professores-escala-smart.js` (substituir stub `renderTabFimDeAno`; transformar `openNovaEscala` em `openNovaEscalaFimDeAno`; remover `onNovaEscalaTipo` e o select de tipo)

- [ ] **Step 1: Render da aba**

```js
function renderTabFimDeAno(scales) {
  const docs = scales.filter(s => s.tipo === 'fim_de_ano');
  const topo = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
    <span style="font-size:12px;color:var(--text2);">Período de horário reduzido, por turnos — a gestão define as datas.</span>
    <button class="btn-primary" onclick="openNovaEscalaFimDeAno()">+ Configurar período</button></div>`;
  const body = docs.length ? docs.map(escalaCardDoc).join('')
    : `<p style="padding:20px;color:var(--text2);">Nenhum período de fim de ano configurado.</p>`;
  return topo + body;
}
```

- [ ] **Step 2: Modal só de fim de ano**

Substituir `openNovaEscala` (linhas 259-298) e REMOVER `onNovaEscalaTipo` (linhas 300-305). O novo modal é o corpo atual do modo fim-de-ano, sem o select de tipo e sem o campo de data única:

```js
function openNovaEscalaFimDeAno() {
  const overlay = document.getElementById('escalaModalOverlay');
  const modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex';
  modal.style.display = 'block';
  const y = new Date().getFullYear();
  const unitChecks = EscalaSmartState.units.map(u =>
    `<label style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-size:13px;"><input type="checkbox" class="feUnit" value="${u.id}" checked> ${u.name || u.id}</label>`
  ).join('') || '<span style="font-size:12px;color:var(--text3);">Nenhuma unidade cadastrada.</span>';
  modal.innerHTML = `
    <h2>Fim de ano — horário reduzido</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div class="form-group"><label>Início</label><input type="date" id="feInicio" class="input" value="${y}-12-21"></div>
      <div class="form-group"><label>Fim</label><input type="date" id="feFim" class="input" value="${y + 1}-01-02"></div>
    </div>
    <div class="form-group"><label>Unidades abertas</label><div style="padding:4px 0;">${unitChecks}</div></div>
    <div class="form-group"><label>Turnos (horário reduzido)</label>
      <div style="display:grid;grid-template-columns:auto 1fr 1fr;gap:8px;align-items:center;">
        <span style="font-size:13px;">Manhã</span>
        <input type="time" id="feManhaIni" class="input" value="08:00">
        <input type="time" id="feManhaFim" class="input" value="12:00">
        <span style="font-size:13px;">Tarde/Noite</span>
        <input type="time" id="feTardeIni" class="input" value="16:00">
        <input type="time" id="feTardeFim" class="input" value="21:00">
      </div>
    </div>
    <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;margin-bottom:6px;"><input type="checkbox" id="feAbrir24"> Abrir 24/12 (por padrão fechado)</label>
    <p style="font-size:12px;color:var(--text2);">Vagas por dia × unidade × turno (1 pessoa/turno). Fechado 25/12, 31/12 e 01/01. Ajuste as datas a cada ano.</p>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      <button class="btn-primary" onclick="criarEscalaFimDeAno()">Criar</button>
    </div>`;
}
```

`criarEscalaFimDeAno` (linhas 329-349) permanece igual — só garantir que o toast de sucesso também troca a aba: na linha do sucesso, trocar por:

```js
  if (res.success) { toast('Escala de fim de ano criada!', 'success'); closeEscalaModal(); EscalaSmartState.tab = 'fim_de_ano'; EscalaSmartState.selectedId = res.data.id; renderEscalaGestao(); }
```

- [ ] **Step 3: Limpar exports antigos**

Nos exports de `window` (fim do arquivo): remover `window.openNovaEscala`, `window.onNovaEscalaTipo`; adicionar:

```js
window.openNovaEscalaFimDeAno = openNovaEscalaFimDeAno;
window.criarEscalaFimDeAno = criarEscalaFimDeAno;
```

Remover também os stubs temporários da Task 3 (as 4 funções reais já existem).

- [ ] **Step 4: Sintaxe + conferência de referências mortas**

Run: `node --check professores-escala-smart.js && grep -n "openNovaEscala\b\|onNovaEscalaTipo\|criarEscala(" professores-escala-smart.js professores.html professores-nav.js`
Expected: `node --check` OK; grep sem nenhuma referência a `openNovaEscala(`/`onNovaEscalaTipo` fora da definição nova `openNovaEscalaFimDeAno`

- [ ] **Step 5: Commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala-ui): aba Fim de ano — modal dedicado; remove botão global + select de tipo"
```

---

### Task 8: Esconder a tela legada "Escalas Especiais" do menu

**Files:**
- Modify: `professores-nav.js:14-15`

- [ ] **Step 1: Remover `'escalas'` dos perfis de gestão**

Linha 14 (admin) e linha 15 (supervisao): remover o item `'escalas',` do array — os demais itens ficam como estão. A entrada `{ id: 'escalas', ... }` do catálogo de páginas (linha ~25) PERMANECE (rota e código intactos p/ rollback e deep-link).

- [ ] **Step 2: Sintaxe + smoke da sidebar**

Run: `node --check professores-nav.js && node scripts/smoke-sidebar.js`
Expected: OK (se o smoke da sidebar assertar a presença de 'escalas', ajustar a asserção — a remoção é intencional)

- [ ] **Step 3: Commit**

```bash
git add professores-nav.js scripts/smoke-sidebar.js
git commit -m "feat(nav): esconde tela legada Escalas Especiais do menu (rota preservada); Escala Inteligente assume"
```

---

### Task 9: Verificação final + deploy staging + E2E

**Files:**
- Modify: `CONTEXTO_SESSAO.md` (log da sessão)

- [ ] **Step 1: Bateria completa de smokes + sintaxe**

Run (Git Bash): `for f in scripts/smoke-*.js; do node "$f" || exit 1; done && node --check scale-service.js && node --check professores-escala-smart.js && node --check professores-nav.js`
Expected: todos os smokes passam, sintaxe OK

- [ ] **Step 2: Deploy hosting no staging**

Run: `firebase deploy --only hosting` (default = staging pelo `.firebaserc`; NUNCA `--project production`)
Expected: deploy OK em `crosstrainer-comissoes-staging.web.app`

- [ ] **Step 3: E2E manual no staging (checklist da spec §7)**

Login `dono.teste@crosstainer.com` (senha demo) → módulo Professores → Escala Inteligente:
- [ ] 4 abas renderizam; painel de equilíbrio acima; sem botão global "+ Nova escala"
- [ ] Sábados: ano corrente lista ~52 linhas; sábados com escala existente mostram status; card legado "fds"/Timestamp NÃO aparece
- [ ] Clicar num sábado sem escala → escala criada (rascunho) e detalhe abre; slots têm horário (config)
- [ ] Feriados: nacionais listados; "Criar escala" num feriado funciona; "+ Data especial" cria manual (municipal e domingo especial)
- [ ] Eventos: "+ Novo evento" interno e externo; badge aparece; consolidação/preferências funcionam
- [ ] Fim de ano: "+ Configurar período" abre modal direto; criação funciona; detalhe por dia×turno igual antes
- [ ] Menu: "Escalas Especiais" sumiu p/ admin; "Escala Inteligente" presente
- [ ] Login `professor.teste@crosstainer.com`: tela de preferências igual antes; janelas abertas aparecem; sem tela de gestão
- [ ] Console do navegador sem erros

- [ ] **Step 4: Atualizar CONTEXTO_SESSAO.md + commit final**

Adicionar sessão no topo do `CONTEXTO_SESSAO.md` (padrão das sessões anteriores): o que foi construído, decisões (esconder legada/migração depois), pendência de migração dos docs legados como tech debt, aguardando validação do Rodrigo.

```bash
git add CONTEXTO_SESSAO.md
git commit -m "docs(contexto): sessão — Escala Inteligente em 4 abas construída e no staging"
```

---

## Self-review (feito na escrita)

- **Cobertura da spec:** §3 estrutura→Task 3 · §4.1→Task 4 · §4.2→Tasks 2+5 · §4.3→Task 6 · §4.4→Task 7 · §5 dados/filtro/eventKind→Task 1 · §5 nav→Task 8 · §5 rules→já existentes (verificado, sem task) · §7 testes→Tasks 1 e 9.
- **Placeholders:** nenhum — todo step tem código/comando completo.
- **Consistência de nomes:** `criarEscalaData`, `escalaSlotsPadrao`, `escalaLoadFeriados`, `escalaSetTab/Year`, `escalaCardDoc`, `renderTab{Sabados,Feriados,Eventos,FimDeAno}`, `openDataEspecial`/`criarDataEspecial`, `openNovoEvento`/`criarNovoEvento`, `openNovaEscalaFimDeAno` — conferidos entre tasks (definição × uso × exports).
