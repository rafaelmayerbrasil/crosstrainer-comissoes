# Agenda Geral: visão por Dia (grade) + Semana/Mês (lista organizada) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a decisão do Rodrigo (12/08/2026, respondendo à proposta `proposta-agenda-geral.html`): a Agenda Geral ganha dois modos — **grade por horário × unidade** quando o filtro é um dia específico, e **lista organizada** (dia como marco, agrupado por unidade, selo só quando foge do normal) quando o filtro é semana ou mês.

**Architecture:** Tudo em `professores-agenda.js` (mesmo arquivo que já tem `AgendaGeralState`/`loadAgendaGeral`/`renderAgendaGeralContent`). Adiciona um `viewMode` ('day' | 'period') ao estado. Funções puras (sem DOM) fazem o agrupamento — testáveis pelo padrão de smoke test do repo (sandbox `vm` carregando os arquivos reais). Funções de render (com HTML) ficam finas, só chamando as puras. Reaproveita `colorForModality`, `shortenName`, `classDisplayName`, `classAccentColor`, `ProfHelpers.formatDateBR` já existentes — nada de duplicar.

**Tech Stack:** HTML/CSS/JS vanilla, Firebase Firestore (mesma query `classes` já usada), smoke test Node `vm` sandbox (padrão do repo, não é framework de teste).

---

## Contexto para quem for implementar

- `professores-agenda.js` já tem a tela "Agenda Geral" (`renderAgendaGeralPage`, `loadAgendaGeral`, `renderAgendaGeralContent`, `renderAgendaGeralGrouped`, `renderAgendaGeralCard`) e o estado `AgendaGeralState` (linha ~1368). Ela busca `classes` no Firestore por unidade + intervalo de datas, e filtra client-side por professor/modalidade.
- Filtros de período hoje: `MINHA_AGENDA_FILTERS` = `previous_week | current_week | next_week | month`, resolvidos em `getDateRangeForFilter(filter)` (linha ~789).
- **Não existe filtro de "dia"** — é a peça nova.
- `colorForModality(modalityId)` (linha ~66) devolve `{bg, border, text}` a partir da cor cadastrada na modalidade — é o que dá a cor certa pro selo/tag.
- `shortenName(fullName)` (linha ~367, **acabou de mudar nesta sessão** pra "Primeiro Nome I.") — usar em todo lugar que hoje usa `teacher.name` cru na Agenda Geral, pra manter consistência com a Agenda Semanal.
- `ProfHelpers.CLASS_STATUS_LABEL` / `CLASS_STATUS_COLOR` (em `professores-shared.js` ~1206) têm as chaves: `prevista, realizada, cancelada, nao_realizada, substituida`.
- O mockup aprovado por Rodrigo está em `C:\Users\ra058347\AppData\Local\Temp\claude\...\scratchpad\proposta-agenda-geral.html` (fora do repo, só referência visual — não precisa existir pra implementar, o HTML de cada opção está citado nas tasks abaixo).
- Suite de smoke do repo: `node scripts/smoke-*.js` (sem framework, `assert` + sandbox `vm`). Ver `scripts/smoke-agenda-cores-ordem.js` como modelo de como carregar `professores-shared.js` + `professores-agenda.js` num sandbox e testar funções puras exportadas como `const`/`function` de topo.
- **Não há service account de produção local** — todo teste roda com fixtures locais (smoke) ou contra o Firestore de **staging** (`firebase deploy --project staging` + scripts `validate-*` com REST API, se necessário). Este plano não mexe em Security Rules nem índices, então só precisa do deploy de hosting em staging pra verificar visualmente.

## File Structure

- Modify: `professores-agenda.js` — estado, funções puras novas, funções de render novas/alteradas, handlers de UI.
- Modify: `professores.html` — CSS novo (dentro do `<style>` já existente, seção "AGENDA GERAL filtros" ~linha 1490).
- Create: `scripts/smoke-agenda-geral-dia-lista.js` — smoke test das funções puras.

---

### Task 1: Estado — `viewMode` e `selectedDate`

**Files:**
- Modify: `professores-agenda.js:1368-1375` (`AgendaGeralState`)

- [ ] **Step 1: Adicionar os campos novos ao estado**

Substituir o bloco:

```js
const AgendaGeralState = {
  unitIds: [],          // multi-select
  modalityId: '',       // single ('' = todas)
  teacherId: '',        // single ('' = todos)
  filter: 'current_week',
  classes: [],
  loading: false,
};
```

por:

```js
const AgendaGeralState = {
  unitIds: [],          // multi-select
  modalityId: '',       // single ('' = todas)
  teacherId: '',        // single ('' = todos)
  viewMode: 'period',   // 'period' (semana/mês, lista) | 'day' (grade por horário)
  filter: 'current_week',
  selectedDate: null,   // Date (meia-noite local) — usado só quando viewMode==='day'
  classes: [],
  loading: false,
};

// Modos de visão da Agenda Geral (decisão do Rodrigo, 12/08: grade no dia, lista em semana/mês)
const AGENDA_GERAL_VIEW_MODES = [
  { id: 'period', label: 'Semana/Mês' },
  { id: 'day',    label: 'Dia' },
];
```

- [ ] **Step 2: Commit**

```bash
git add professores-agenda.js
git commit -m "wip(agenda-geral): estado do modo dia/periodo"
```
(Commit intermediário — pode ser squashado no final; não é obrigatório, mas ajuda a revisar em partes.)

---

### Task 2: Funções puras de data (dia selecionado)

**Files:**
- Modify: `professores-agenda.js` — logo depois de `getDateRangeForFilter` (linha ~789-820, achar o fim da função pelo próximo `}` de nível 0)
- Test: `scripts/smoke-agenda-geral-dia-lista.js` (criar)

- [ ] **Step 1: Escrever o teste (falha primeiro)**

Criar `scripts/smoke-agenda-geral-dia-lista.js`:

```js
'use strict';
// Smoke da Agenda Geral em 2 modos (12/08/2026): grade por horário quando o
// filtro é um dia, lista organizada (por unidade, selo só quando foge do
// normal) quando é semana/mês. Decisão do Rodrigo em resposta à proposta
// proposta-agenda-geral.html. Carrega os ARQUIVOS REAIS num sandbox mínimo.
//
// Roda: node scripts/smoke-agenda-geral-dia-lista.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');

const noop = () => {};
const chain = () => new Proxy(function () {}, { get: () => chain(), apply: () => chain() });
const sandbox = {
  console: { log: noop, warn: noop, error: noop },
  window: {}, document: { addEventListener: noop, getElementById: () => null },
  firebase: { firestore: Object.assign(chain(), { FieldValue: { serverTimestamp: noop }, Timestamp: { now: noop, fromDate: (d) => ({ toDate: () => d }) } }), auth: chain, apps: [] },
  db: chain(), auth: chain(),
  setTimeout, clearTimeout, Map, Set, Date, Math, JSON, String, Number, Array, Object, Boolean, RegExp, Promise, Error,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function carregar(arquivo) {
  vm.runInContext(fs.readFileSync(path.join(raiz, arquivo), 'utf8'), sandbox, { filename: arquivo });
}

carregar('professores-shared.js');
sandbox.ProfHelpers = sandbox.ProfHelpers || sandbox.window.ProfHelpers;
carregar('professores-agenda.js');

const {
  getDayRange, groupClassesByUnit, buildDayGrid, isAbnormalStatus, shortenName,
} = sandbox;
const AgendaState = vm.runInContext('AgendaState', sandbox);

// helper local pra criar Timestamp-like (mesma interface que o código real usa: .toDate())
function ts(d) { return { toDate: () => d }; }

// ════════════════ 1. getDayRange ════════════════
{
  const d = new Date(2026, 7, 15); // 15/08/2026 (mês 0-index)
  const { from, to } = getDayRange(d);
  assert.strictEqual(from.getHours(), 0);
  assert.strictEqual(from.getMinutes(), 0);
  assert.strictEqual(to.getHours(), 23);
  assert.strictEqual(to.getMinutes(), 59);
  assert.strictEqual(from.getDate(), 15);
  assert.strictEqual(to.getDate(), 15, 'não pode vazar pro dia seguinte');
  console.log('✓ getDayRange cobre só o dia (00:00 a 23:59:59)');
}

// ════════════════ 2. isAbnormalStatus ════════════════
{
  assert.strictEqual(isAbnormalStatus('prevista'), false, 'prevista é o normal, não pode virar selo');
  assert.strictEqual(isAbnormalStatus('realizada'), false, 'realizada também é resultado normal');
  assert.strictEqual(isAbnormalStatus('cancelada'), true);
  assert.strictEqual(isAbnormalStatus('substituida'), true);
  assert.strictEqual(isAbnormalStatus('nao_realizada'), true);
  console.log('✓ só cancelada/substituída/não-realizada viram selo — prevista e realizada ficam quietas');
}

// ════════════════ 3. groupClassesByUnit (Opção A — lista) ════════════════
{
  AgendaState.units = [{ id: 'u1', name: 'CrossTainer CP' }, { id: 'u2', name: 'CrossTainer PP' }];
  const classes = [
    { id: 'c1', unitId: 'u2', startTime: '08:00' },
    { id: 'c2', unitId: 'u1', startTime: '09:00' },
    { id: 'c3', unitId: 'u1', startTime: '07:00' },
  ];
  const groups = groupClassesByUnit(classes, AgendaState.units);
  assert.strictEqual(groups.length, 2, 'só entram unidades que têm aula');
  assert.strictEqual(groups[0].unit.id, 'u1', 'segue a ordem de AgendaState.units, não a ordem de chegada');
  assert.deepStrictEqual(groups[0].items.map(c => c.id), ['c3', 'c2'], 'dentro da unidade, ordena por horário');
  assert.strictEqual(groups[1].unit.id, 'u2');
  console.log('✓ agrupa por unidade na ordem do cadastro, aulas ordenadas por horário dentro do grupo');

  const vazio = groupClassesByUnit([], AgendaState.units);
  assert.deepStrictEqual(vazio, [], 'sem aula não pode gerar grupo fantasma');
  console.log('✓ sem aulas não gera grupo vazio');
}

// ════════════════ 4. buildDayGrid (Opção B — grade) ════════════════
{
  AgendaState.units = [{ id: 'u1', name: 'CrossTainer CP' }, { id: 'u2', name: 'CrossTainer PP' }];
  const classes = [
    { id: 'c1', unitId: 'u1', startTime: '08:00', endTime: '09:00' },
    { id: 'c2', unitId: 'u2', startTime: '08:00', endTime: '09:00' },
    { id: 'c3', unitId: 'u1', startTime: '08:00', endTime: '09:00' }, // 2ª aula no mesmo horário/unidade
    { id: 'c4', unitId: 'u2', startTime: '10:00', endTime: '11:00' },
  ];
  const grid = buildDayGrid(classes, ['u1', 'u2'], AgendaState.units);

  assert.strictEqual(grid.units.length, 2);
  assert.deepStrictEqual(grid.times, ['08:00', '10:00'], 'linhas = horários distintos, em ordem cronológica');

  const linha0800 = grid.rows.find(r => r.time === '08:00');
  assert.strictEqual(linha0800.cellsByUnit.u1.length, 2, 'duas aulas na mesma unidade/horário empilham na célula');
  assert.strictEqual(linha0800.cellsByUnit.u2.length, 1);

  const linha1000 = grid.rows.find(r => r.time === '10:00');
  assert.strictEqual(linha1000.cellsByUnit.u1.length, 0, 'célula sem aula fica com array vazio (não falta a chave)');
  console.log('✓ grade: linhas por horário distinto, colunas por unidade, células empilham aulas concorrentes');

  const gridVazia = buildDayGrid([], ['u1'], AgendaState.units);
  assert.deepStrictEqual(gridVazia.times, [], 'sem aula no dia, sem linha nenhuma');
  console.log('✓ dia sem aula nenhuma não gera linha');
}

// ════════════════ 5. shortenName (regressão do ajuste desta sessão) ════════════════
{
  assert.strictEqual(shortenName('Louise Gabrielle Alfeu dos Anjos'), 'Louise A.',
    'primeiro nome + inicial do ÚLTIMO sobrenome, não do primeiro');
  assert.strictEqual(shortenName('Rafael Brasil'), 'Rafael B.');
  assert.strictEqual(shortenName('Karin'), 'Karin', 'nome único não ganha ponto');
  assert.strictEqual(shortenName(''), '—');
  console.log('✓ shortenName no formato "Primeiro Nome I." (invertido do "I. Sobrenome" antigo)');
}

console.log('\n✅ smoke-agenda-geral-dia-lista OK');
```

- [ ] **Step 2: Rodar e confirmar que falha (as funções ainda não existem)**

Run: `node scripts/smoke-agenda-geral-dia-lista.js`
Expected: `TypeError: getDayRange is not a function` (ou similar) — as próximas steps implementam.

- [ ] **Step 3: Implementar `getDayRange`**

Logo após a função `getDateRangeForFilter` existente (procurar o `}` que fecha o `switch`/função, linha ~820 — **não mexer** na função existente, só adicionar depois dela):

```js
/** Intervalo de um dia específico: 00:00:00 a 23:59:59 local. */
function getDayRange(date) {
  const from = new Date(date);
  from.setHours(0, 0, 0, 0);
  const to = new Date(date);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}
```

- [ ] **Step 4: Implementar `isAbnormalStatus`**

Mesma região (perto de `CLASS_STATUS_LABEL`/uso, pode ir logo abaixo de `getDayRange`):

```js
// Estados que fogem do previsto — só esses ganham selo na lista organizada
// (Opção A da proposta 12/08: "prevista" é o normal, não precisa se anunciar).
const AGENDA_GERAL_ABNORMAL_STATUSES = new Set(['cancelada', 'substituida', 'nao_realizada']);
function isAbnormalStatus(status) {
  return AGENDA_GERAL_ABNORMAL_STATUSES.has(status);
}
```

- [ ] **Step 5: Rodar de novo — deve avançar (falhar em `groupClassesByUnit`)**

Run: `node scripts/smoke-agenda-geral-dia-lista.js`
Expected: passa os blocos 1 e 2, falha em `groupClassesByUnit is not a function`.

- [ ] **Step 6: Commit**

```bash
git add professores-agenda.js scripts/smoke-agenda-geral-dia-lista.js
git commit -m "wip(agenda-geral): getDayRange + isAbnormalStatus"
```

---

### Task 3: `groupClassesByUnit` (Opção A) e `buildDayGrid` (Opção B) — funções puras

**Files:**
- Modify: `professores-agenda.js` — logo após `sortByStartTime` (linha ~929-931) ou perto de `renderAgendaGeralGrouped` (~1553), à escolha, mas manter as funções puras juntas e **antes** de qualquer função que as chame.
- Test: `scripts/smoke-agenda-geral-dia-lista.js` (já escrito na Task 2)

- [ ] **Step 1: Implementar `groupClassesByUnit`**

```js
/**
 * Agrupa aulas por unidade, na ORDEM do cadastro de unidades (não na ordem
 * de chegada do Firestore) — pra lista sempre mostrar CP antes de PP, por
 * exemplo, do jeito que o time já espera ver. Só entram unidades com aula.
 */
function groupClassesByUnit(classes, units) {
  const byUnitId = new Map();
  classes.forEach(c => {
    if (!byUnitId.has(c.unitId)) byUnitId.set(c.unitId, []);
    byUnitId.get(c.unitId).push(c);
  });
  const groups = [];
  units.forEach(unit => {
    const items = byUnitId.get(unit.id);
    if (items && items.length > 0) {
      groups.push({ unit, items: sortByStartTime(items.slice()) });
    }
  });
  return groups;
}
```

- [ ] **Step 2: Implementar `buildDayGrid`**

```js
/**
 * Monta a grade da Opção B: linhas = horários distintos que têm pelo menos
 * uma aula no dia (não a grade cheia 00:00-23:00 — ninguém quer rolar past
 * 40 linhas vazias), colunas = unidades selecionadas, na ordem do cadastro.
 * Célula pode ter mais de uma aula (duas turmas no mesmo horário/unidade).
 */
function buildDayGrid(classes, unitIds, allUnits) {
  const units = allUnits.filter(u => unitIds.includes(u.id));
  const timesSet = new Set(classes.map(c => c.startTime).filter(Boolean));
  const times = Array.from(timesSet).sort((a, b) => a.localeCompare(b));

  const rows = times.map(time => {
    const cellsByUnit = {};
    units.forEach(u => { cellsByUnit[u.id] = []; });
    classes
      .filter(c => c.startTime === time)
      .forEach(c => { if (cellsByUnit[c.unitId]) cellsByUnit[c.unitId].push(c); });
    return { time, cellsByUnit };
  });

  return { units, times, rows };
}
```

- [ ] **Step 3: Rodar o smoke inteiro — deve passar tudo**

Run: `node scripts/smoke-agenda-geral-dia-lista.js`
Expected: `✅ smoke-agenda-geral-dia-lista OK`

- [ ] **Step 4: Commit**

```bash
git add professores-agenda.js
git commit -m "feat(agenda-geral): funcoes puras de agrupamento (lista por unidade + grade por horario)"
```

---

### Task 4: Handlers de UI — trocar de modo, navegar dia

**Files:**
- Modify: `professores-agenda.js` — perto dos handlers existentes `setAgendaGeralFilter`/`toggleAgendaGeralUnit` (linha ~1525-1551)

- [ ] **Step 1: Alterar `loadAgendaGeral` pra usar o intervalo certo conforme o modo**

Trocar (linha ~1417-1421):

```js
async function loadAgendaGeral() {
  AgendaGeralState.loading = true;
  const { from, to } = getDateRangeForFilter(AgendaGeralState.filter);
```

por:

```js
async function loadAgendaGeral() {
  AgendaGeralState.loading = true;
  if (AgendaGeralState.viewMode === 'day' && !AgendaGeralState.selectedDate) {
    AgendaGeralState.selectedDate = new Date();
    AgendaGeralState.selectedDate.setHours(0, 0, 0, 0);
  }
  const { from, to } = AgendaGeralState.viewMode === 'day'
    ? getDayRange(AgendaGeralState.selectedDate)
    : getDateRangeForFilter(AgendaGeralState.filter);
```

(o resto da função continua igual — só a origem de `from`/`to` mudou.)

- [ ] **Step 2: Adicionar os handlers novos**

Logo depois de `setAgendaGeralFilter` (linha ~1525-1529):

```js
function setAgendaGeralViewMode(mode) {
  if (AgendaGeralState.viewMode === mode) return;
  AgendaGeralState.viewMode = mode;
  if (mode === 'day' && !AgendaGeralState.selectedDate) {
    AgendaGeralState.selectedDate = new Date();
    AgendaGeralState.selectedDate.setHours(0, 0, 0, 0);
  }
  loadAgendaGeral();
}

function setAgendaGeralDate(isoDate) {
  // input[type=date] manda "YYYY-MM-DD" já em horário local ao construir com partes soltas
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return;
  AgendaGeralState.selectedDate = new Date(y, m - 1, d);
  loadAgendaGeral();
}

function shiftAgendaGeralDate(deltaDays) {
  const d = new Date(AgendaGeralState.selectedDate);
  d.setDate(d.getDate() + deltaDays);
  AgendaGeralState.selectedDate = d;
  loadAgendaGeral();
}

/** "YYYY-MM-DD" em horário local, pro value do <input type="date">. */
function isoDateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
```

**Por que `new Date(y, m-1, d)` e não `new Date(isoDate)`:** `new Date('2026-08-15')` é interpretado como UTC meia-noite pelo motor JS, o que em fuso BR (UTC-3) vira 14/08 21:00 — o dia visualmente selecionado no input viraria o dia errado no filtro. Construir com partes soltas usa horário local direto.

- [ ] **Step 3: Commit**

```bash
git add professores-agenda.js
git commit -m "feat(agenda-geral): handlers de troca de modo e navegacao de dia"
```

---

### Task 5: Render — toolbar com toggle de modo + navegação de dia

**Files:**
- Modify: `professores-agenda.js:1463-1517` (`renderAgendaGeralContent`)

- [ ] **Step 1: Reescrever `renderAgendaGeralContent`**

Substituir a função inteira por:

```js
function renderAgendaGeralContent() {
  const page = document.getElementById('page-agenda-geral');
  const total = AgendaGeralState.classes.length;
  const mode = AgendaGeralState.viewMode;

  const countLabel = mode === 'day'
    ? ProfHelpers.formatDateBR(AgendaGeralState.selectedDate)
    : (MINHA_AGENDA_FILTERS.find(f => f.id === AgendaGeralState.filter)?.label || '');

  const modOpts = ['<option value="">Todas modalidades</option>'].concat(
    Array.from(AgendaState.modalitiesMap.values())
      .filter(m => m.isActive !== false)
      .map(m => `<option value="${escapeHtml(m.id)}" ${m.id === AgendaGeralState.modalityId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`)
  ).join('');

  const teacherOpts = ['<option value="">Todos professores</option>'].concat(
    Array.from(AgendaState.teachersMap.values())
      .filter(t => t.isActive !== false)
      .map(t => `<option value="${escapeHtml(t.id)}" ${t.id === AgendaGeralState.teacherId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`)
  ).join('');

  const modeToggleHtml = AGENDA_GERAL_VIEW_MODES.map(m => `
    <span class="chip ${m.id === mode ? 'chip-active' : ''}" onclick="setAgendaGeralViewMode('${m.id}')">${m.label}</span>
  `).join('');

  const periodChipsHtml = MINHA_AGENDA_FILTERS.map(f => `
    <span class="chip ${f.id === AgendaGeralState.filter ? 'chip-active' : ''}"
          onclick="setAgendaGeralFilter('${f.id}')">${f.label}</span>
  `).join('');

  const dayNavHtml = `
    <div class="agenda-geral-daynav">
      <button type="button" class="btn btn-outline btn-sm" onclick="shiftAgendaGeralDate(-1)" title="Dia anterior">◀</button>
      <input type="date" class="input" value="${isoDateInputValue(AgendaGeralState.selectedDate)}" onchange="setAgendaGeralDate(this.value)">
      <button type="button" class="btn btn-outline btn-sm" onclick="shiftAgendaGeralDate(1)" title="Dia seguinte">▶</button>
    </div>
  `;

  page.innerHTML = `
    <div class="page-toolbar">
      <div class="lhs">
        <h2>AGENDA GERAL</h2>
        <div class="count">${total} aula${total === 1 ? '' : 's'} · ${countLabel}</div>
      </div>
      <div class="rhs agenda-geral-toolbar-controls">
        <div class="minha-agenda-filters">${modeToggleHtml}</div>
        ${mode === 'day'
          ? dayNavHtml
          : `<div class="minha-agenda-filters">${periodChipsHtml}</div>`
        }
      </div>
    </div>

    <div class="agenda-geral-filters">
      <div class="agenda-geral-units">
        <span class="filter-label">Unidades:</span>
        ${AgendaState.units.map(u => `
          <span class="chip ${AgendaGeralState.unitIds.includes(u.id) ? 'chip-active' : ''}"
                onclick="toggleAgendaGeralUnit('${escapeHtml(u.id)}')">${escapeHtml(u.name || u.id)}</span>
        `).join('')}
      </div>
      <div class="agenda-geral-selects">
        <label class="agenda-unit-select"><span>Professor:</span>
          <select onchange="setAgendaGeralTeacher(this.value)">${teacherOpts}</select></label>
        <label class="agenda-unit-select"><span>Modalidade:</span>
          <select onchange="setAgendaGeralModality(this.value)">${modOpts}</select></label>
        ${(AgendaGeralState.teacherId || AgendaGeralState.modalityId)
          ? `<a href="#" onclick="limparFiltrosAgendaGeral();return false;" style="font-size:12px;color:var(--orange);">limpar filtros</a>` : ''}
      </div>
    </div>

    ${total === 0
      ? `<div class="empty-state-small" style="padding:48px 24px;">Nenhuma aula ${mode === 'day' ? 'nesse dia' : 'nos filtros selecionados'}.</div>`
      : (mode === 'day'
          ? renderAgendaGeralDayGrid(AgendaGeralState.classes)
          : renderAgendaGeralList(AgendaGeralState.classes))
    }
  `;
}
```

Nota: `renderAgendaGeralGrouped`/`renderAgendaGeralCard` (as funções antigas de lista) são **substituídas** por `renderAgendaGeralList` na Task 6 — não sobra chamada pra elas depois desta task, então dá pra apagar as antigas junto com a Task 6 (não deixar código morto).

- [ ] **Step 2: Commit**

```bash
git add professores-agenda.js
git commit -m "feat(agenda-geral): toolbar com toggle dia/periodo e navegacao de data"
```

---

### Task 6: Render — Opção A (lista organizada) e Opção B (grade)

**Files:**
- Modify: `professores-agenda.js` — substitui `renderAgendaGeralGrouped` e `renderAgendaGeralCard` (linha ~1553-1594) por `renderAgendaGeralList` + `renderAgendaGeralListRow` + `renderAgendaGeralDayGrid`.

- [ ] **Step 1: Apagar as funções antigas e escrever as novas**

Remover `renderAgendaGeralGrouped` e `renderAgendaGeralCard` inteiras (linha ~1553-1594) e colocar no lugar:

```js
// ── Opção A — lista organizada (semana/mês) ─────────────────────────────
// Dia como marco grande, aulas agrupadas por unidade dentro do dia, selo de
// estado só quando foge do normal. Decisão do Rodrigo, 12/08/2026.
function renderAgendaGeralList(classes) {
  const groups = new Map();
  classes.forEach(c => {
    const d = c.scheduledDate.toDate ? c.scheduledDate.toDate() : new Date(c.scheduledDate);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (!groups.has(key)) groups.set(key, { date: d, items: [] });
    groups.get(key).items.push(c);
  });

  return `
    <div class="geral-list">
      ${Array.from(groups.values()).map(g => {
        const unitGroups = groupClassesByUnit(g.items, AgendaState.units);
        const numUnidades = unitGroups.length;
        return `
          <div class="geral-day-head">
            <span class="geral-day-num">${String(g.date.getDate()).padStart(2, '0')}</span>
            <span class="geral-day-wd">${ProfHelpers.WEEKDAY_LABEL[g.date.getDay()]}</span>
            <span class="geral-day-count">${g.items.length} aula${g.items.length === 1 ? '' : 's'} · ${numUnidades} unidade${numUnidades === 1 ? '' : 's'}</span>
          </div>
          ${unitGroups.map(ug => `
            <div class="geral-unit-head">${escapeHtml(ug.unit.name || ug.unit.id)}</div>
            ${ug.items.map(renderAgendaGeralListRow).join('')}
          `).join('')}
        `;
      }).join('')}
    </div>
  `;
}

function renderAgendaGeralListRow(cls) {
  const teacher = AgendaState.teachersMap.get(cls.teacherId);
  const modColor = colorForModality(cls.modalityId);
  const nome = classDisplayName(cls) || '—';
  const abnormal = isAbnormalStatus(cls.status);
  const sColor = ProfHelpers.CLASS_STATUS_COLOR[cls.status] || ProfHelpers.CLASS_STATUS_COLOR.prevista;
  const sLabel = ProfHelpers.CLASS_STATUS_LABEL[cls.status] || cls.status;

  return `
    <div class="geral-row" onclick="openClassModal('${cls.id}')">
      <span class="geral-row-time">${cls.startTime}<small>até ${cls.endTime}</small></span>
      <span class="geral-row-who">
        <span class="geral-row-teacher">${escapeHtml(teacher ? shortenName(teacher.name) : '—')}</span>
        <span class="geral-row-mod" style="background:${modColor.bg};color:${modColor.text};">${escapeHtml(nome)}</span>
      </span>
      <span class="geral-row-status">
        ${abnormal ? `<span class="class-status-badge" style="background:${sColor.bg};color:${sColor.text};border:1px solid ${sColor.border};">${sLabel}</span>` : ''}
      </span>
    </div>
  `;
}

// ── Opção B — grade por horário × unidade (dia específico) ──────────────
// Mesma linguagem visual da Agenda Semanal, mas por data real em vez de
// semana-modelo. Decisão do Rodrigo, 12/08/2026.
function renderAgendaGeralDayGrid(classes) {
  const grid = buildDayGrid(classes, AgendaGeralState.unitIds, AgendaState.units);

  if (grid.times.length === 0) {
    return `<div class="empty-state-small" style="padding:48px 24px;">Nenhuma aula nesse dia.</div>`;
  }

  return `
    <div class="geral-daygrid-wrap">
      <div class="geral-daygrid" style="grid-template-columns:76px repeat(${grid.units.length}, minmax(160px,1fr));">
        <div class="geral-daygrid-head"></div>
        ${grid.units.map(u => `<div class="geral-daygrid-head">${escapeHtml(u.name || u.id)}</div>`).join('')}
        ${grid.rows.map(row => `
          <div class="geral-daygrid-time">${row.time}</div>
          ${grid.units.map(u => {
            const items = row.cellsByUnit[u.id] || [];
            if (items.length === 0) return `<div class="geral-daygrid-cell"><span class="geral-daygrid-empty">sem aula</span></div>`;
            return `<div class="geral-daygrid-cell">${items.map(renderAgendaGeralDayGridCard).join('')}</div>`;
          }).join('')}
        `).join('')}
      </div>
    </div>
  `;
}

function renderAgendaGeralDayGridCard(cls) {
  const teacher = AgendaState.teachersMap.get(cls.teacherId);
  const modColor = colorForModality(cls.modalityId);
  const nome = classDisplayName(cls) || '—';
  return `
    <div class="geral-daygrid-card" style="background:${modColor.bg};border-left:3px solid ${modColor.border};" onclick="openClassModal('${cls.id}')">
      <div class="geral-daygrid-card-mod" style="color:${modColor.text};">${escapeHtml(nome)}</div>
      <div class="geral-daygrid-card-who">${escapeHtml(teacher ? shortenName(teacher.name) : '—')}</div>
    </div>
  `;
}
```

- [ ] **Step 2: Rodar a suite completa de smoke — nada pode quebrar**

Run: `for f in scripts/smoke-*.js; do echo "== $f =="; node "$f" || echo "FALHOU: $f"; done`
Expected: todo mundo `✅`, exceto `smoke-9.js` (esse já falha hoje por exigir `--project`, não é regressão).

- [ ] **Step 3: Commit**

```bash
git add professores-agenda.js
git commit -m "feat(agenda-geral): lista organizada por unidade + grade por horario no dia"
```

---

### Task 7: CSS

**Files:**
- Modify: `professores.html` — dentro do `<style>`, logo após o bloco `.agenda-geral-*` existente (linha ~1490-1527).

- [ ] **Step 1: Adicionar o CSS novo**

```css
/* ─── Sprint agenda-geral-dia-lista (12/08) — toggle dia/período + navegação de data ── */
.agenda-geral-toolbar-controls {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.agenda-geral-daynav {
  display: flex;
  align-items: center;
  gap: 8px;
}
.agenda-geral-daynav input[type="date"] {
  padding: 5px 8px;
  font-size: 12px;
  background: var(--surface2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.btn-sm { padding: 4px 10px; font-size: 12px; }

/* ── Opção A — lista organizada ─────────────────────────────────────── */
.geral-list { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
.geral-day-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 14px 2px 8px;
  border-bottom: 2px solid var(--border);
  margin-top: 18px;
}
.geral-day-head:first-child { margin-top: 0; }
.geral-day-num { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; font-family: 'JetBrains Mono', monospace; }
.geral-day-wd { font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--orange); }
.geral-day-count { margin-left: auto; font-size: 11.5px; color: var(--text3); }

.geral-unit-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--text3);
}

.geral-row {
  display: grid;
  grid-template-columns: 92px 1fr auto;
  align-items: center;
  gap: 14px;
  padding: 9px 4px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background .12s;
}
.geral-row:hover { background: var(--surface2); }
.geral-row-time {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.geral-row-time small { display: block; font-size: 10.5px; font-weight: 400; color: var(--text3); }
.geral-row-who { display: flex; flex-direction: column; gap: 3px; }
.geral-row-teacher { font-size: 13px; font-weight: 600; color: var(--text); }
.geral-row-mod {
  display: inline-block;
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: .02em;
}

@media (max-width: 700px) {
  .geral-row { grid-template-columns: 1fr; gap: 4px; }
  .geral-row-status { text-align: left; }
}

/* ── Opção B — grade por horário × unidade ──────────────────────────── */
.geral-daygrid-wrap { overflow-x: auto; margin-top: 6px; }
.geral-daygrid {
  display: grid;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  min-width: 480px;
}
.geral-daygrid-head {
  padding: 9px 12px;
  background: var(--surface2);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--text2);
  border-bottom: 1px solid var(--border);
}
.geral-daygrid-time {
  padding: 10px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: var(--text2);
  background: var(--surface);
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.geral-daygrid-cell {
  padding: 8px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 52px;
}
.geral-daygrid-empty { font-size: 11px; color: var(--text3); font-style: italic; }
.geral-daygrid-card {
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: transform .12s;
}
.geral-daygrid-card:hover { transform: translateY(-1px); }
.geral-daygrid-card-mod { font-size: 11px; font-weight: 700; }
.geral-daygrid-card-who { font-size: 11px; color: var(--text); margin-top: 1px; }
```

- [ ] **Step 2: Commit**

```bash
git add professores.html
git commit -m "feat(agenda-geral): css da lista organizada e da grade por horario"
```

---

### Task 8: Verificação em staging + manual

**Files:** nenhum arquivo novo — só deploy e checagem.

- [ ] **Step 1: Rodar a suite completa de smoke uma última vez**

Run: `for f in scripts/smoke-*.js; do node "$f" > /dev/null && echo "OK: $f" || echo "FALHOU: $f"; done`
Expected: tudo `OK`, exceto `smoke-9.js` (esperado).

- [ ] **Step 2: Deploy hosting em staging**

Run: `firebase deploy --only hosting --project staging`
Expected: link de staging publicado sem erro.

- [ ] **Step 3: Checagem manual no browser (staging, autenticado)**

- Abrir Agenda Geral → confirmar chip "Semana/Mês" ativo por padrão, lista com dia em destaque, aulas agrupadas por unidade, sem selo em aula "Prevista".
- Forçar uma aula com status `cancelada` ou `substituida` (via dado de teste já existente em staging) → confirmar que SÓ essa linha mostra selo.
- Clicar no chip "Dia" → confirmar navegação ◀ / input de data / ▶, grade com horários em linha e unidades em coluna, célula "sem aula" quando vazia, duas aulas empilhadas quando concorrem no mesmo horário/unidade.
- Testar em mobile width (375px) → grade deve rolar lateralmente sem quebrar o layout da página; lista deve continuar em coluna única.
- Aplicar filtro de Professor/Modalidade em cada modo → confirmar que filtra igual nos dois.
- Clicar num card/linha → modal de detalhe da aula abre normalmente (mesma função `openClassModal` de antes, não deveria ter regredido).

- [ ] **Step 4: Atualizar `CONTEXTO_SESSAO.md`**

Registrar em nova entrada (ou continuando a sessão 48): A+B implementado no staging, aguardando validação/aceite do Rodrigo antes de ir pra produção (`git push origin main`, conforme regra do projeto).

- [ ] **Step 5: Commit final (se sobrar algo solto) e não fazer push pra produção sem autorização**

```bash
git status
```

Se tudo já commitado nas tasks anteriores, não sobra nada aqui. **Não rodar `git push origin main`** — produção só entra depois do Rodrigo validar no staging (regra do projeto, `CLAUDE.md`).

---

## Self-review (feito ao escrever este plano)

- **Cobertura do requisito:** grade no dia (Task 6, `renderAgendaGeralDayGrid`) ✓; lista organizada em semana/mês (Task 6, `renderAgendaGeralList`) ✓; navegação de dia com setas (Task 4/5) ✓; filtros de unidade/professor/modalidade continuam funcionando nos dois modos, porque `loadAgendaGeral` não mudou a parte de filtro client-side (Task 4, só trocou a origem do intervalo de datas) ✓; selo só quando foge do normal (Task 3 `isAbnormalStatus` + Task 6) ✓.
- **Sem placeholder:** todas as funções têm corpo completo, nenhum "TODO" ou "implementar depois".
- **Consistência de nomes:** `groupClassesByUnit`, `buildDayGrid`, `getDayRange`, `isAbnormalStatus`, `renderAgendaGeralList`, `renderAgendaGeralListRow`, `renderAgendaGeralDayGrid`, `renderAgendaGeralDayGridCard`, `setAgendaGeralViewMode`, `setAgendaGeralDate`, `shiftAgendaGeralDate`, `isoDateInputValue` — usados de forma idêntica entre a task que define e as tasks que consomem (conferido a mão).
