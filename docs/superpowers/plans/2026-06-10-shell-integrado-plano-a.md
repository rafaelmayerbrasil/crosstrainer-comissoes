# Plano A — Shell + Sidebar do Professores · Implementação

> **Para workers agênticos:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` pra implementar tarefa-a-tarefa. Passos usam checkbox (`- [ ]`).

**Goal:** Reorganizar a navegação do módulo Professores — eliminar a duplicação de seções, agrupar por domínio, e preparar a chrome integrada (seletor de módulo + seção Administração) — **sem tocar em código de produção** (`index.html` etc.).

**Architecture:** A configuração e a lógica de montagem da sidebar saem do `professores.js` para um novo arquivo **`professores-nav.js`** (puro, sem DOM, usável no browser e no Node). Uma função pura `buildSidebarModel(profiles, ctx)` decide grupos/ordem/seção-de-sistema/seletor; o `professores.js` só renderiza esse modelo no DOM. Isso torna a lógica **testável** (smoke em Node) e mata a causa-raiz da duplicação (render em ordem de array).

**Tech Stack:** HTML/CSS/JS vanilla (sem framework, sem bundler). Testes = scripts Node com `assert` nativo (padrão `scripts/smoke-*.js`). Validação de UI = manual em staging.

**Spec de referência:** [docs/superpowers/specs/2026-06-10-navegacao-shell-integrado-design.md](../specs/2026-06-10-navegacao-shell-integrado-design.md)

**Branch:** `feature/shell-integrado` (já criado; isolado do `main` pra não vazar pra prod).

---

## Estrutura de arquivos

- **Criar** `professores-nav.js` — config de navegação (`PROF_PAGES`, `PAGE_DEFINITIONS`, `SECTION_ORDER`, `SYSTEM_SECTION`) + funções puras (`buildSidebarModel`, `buildModuleSwitcher`). Exporta via `window.ProfNav` (browser) e `module.exports` (Node).
- **Criar** `scripts/smoke-sidebar.js` — testa as funções puras (sem duplicação, ordem correta, condicionais por perfil).
- **Modificar** `professores.html` — incluir `<script src="professores-nav.js">` antes de `professores.js`; adicionar CSS (`.sb-switcher`, `.sb-sys`); adicionar contêiner do seletor no `.sb-logo`.
- **Modificar** `professores.js` — remover `PROF_PAGES`/`PAGE_DEFINITIONS` locais (passam a vir de `ProfNav`); reescrever `buildSidebar()` pra renderizar o modelo; renderizar seletor + seção de sistema.

**Premissa de teste:** o projeto **não tem test runner** (jest/pytest). Lógica pura → smoke em Node (`node scripts/smoke-sidebar.js`). DOM/UI → checklist manual em staging. Não inventar framework.

---

## Task 1: Config de navegação + modelo puro (TDD via Node)

**Files:**
- Create: `professores-nav.js`
- Test: `scripts/smoke-sidebar.js`

- [ ] **Step 1: Escrever o smoke test (falhando primeiro)**

Create `scripts/smoke-sidebar.js`:

```js
'use strict';
// Smoke do modelo de sidebar (lógica pura, sem DOM). Roda: node scripts/smoke-sidebar.js
const assert = require('assert');
const Nav = require('../professores-nav.js');

function sections(model) { return model.groups.map(g => g.section); }
function ids(model) { return model.groups.flatMap(g => g.items.map(i => i.id)); }

// 1) Admin SEM vínculo de professor: nenhuma seção repetida + ordem por domínio + sem "Minha Agenda"
let m = Nav.buildSidebarModel(['admin'], { hasProfessorLink: false, moduleAccess: { professores: true } });
const secs = sections(m);
assert.deepStrictEqual(secs, [...new Set(secs)], 'Admin: seção repetida na sidebar');
assert.deepStrictEqual(secs, ['Agenda', 'Cadastros', 'Férias', 'Financeiro'], 'Admin: ordem/grupos errados');
assert.ok(!ids(m).includes('minha-agenda'), 'Admin sem vínculo não deve ver Minha Agenda');
assert.ok(!ids(m).includes('home'), 'Início não entra em grupo (é item solto)');

// 2) Admin COM vínculo: ganha grupo "Minhas aulas" com minha-agenda
m = Nav.buildSidebarModel(['admin'], { hasProfessorLink: true, moduleAccess: { professores: true } });
assert.ok(sections(m).includes('Minhas aulas'), 'Admin com vínculo deve ver Minhas aulas');
assert.ok(ids(m).includes('minha-agenda'), 'Admin com vínculo deve ver Minha Agenda');

// 3) Seção de sistema só pra admin
assert.ok(m.systemSection && m.systemSection.items.map(i => i.id).join(',') === 'users,units,audit',
  'Admin deve ter Administração com users,units,audit');
const prof = Nav.buildSidebarModel(['professor'], { hasProfessorLink: true, moduleAccess: { professores: true } });
assert.strictEqual(prof.systemSection, null, 'Professor NÃO pode ter seção de sistema');

// 4) Professor: itens corretos, sem cadastros/fechamento
const pIds = ids(prof);
assert.ok(pIds.includes('agenda-geral') && pIds.includes('minha-agenda') && pIds.includes('meus-pagamentos')
  && pIds.includes('ferias') && pIds.includes('meu-saldo'), 'Professor: itens faltando');
assert.ok(!pIds.includes('fechamento') && !pIds.includes('professores') && !pIds.includes('modalidades'),
  'Professor não pode ver itens de gestão');

// 5) Seletor de módulo: aparece só com 2+ módulos
const one = Nav.buildModuleSwitcher({ professores: true }, 'professores');
assert.strictEqual(one.show, false, '1 módulo → sem seletor');
const two = Nav.buildModuleSwitcher({ professores: true, comissoes: true }, 'professores');
assert.strictEqual(two.show, true, '2 módulos → com seletor');
assert.ok(two.modules.find(x => x.id === 'comissoes').href === 'index.html', 'Comissões aponta pro index.html');

console.log('✓ smoke-sidebar: todos os casos passaram');
```

- [ ] **Step 2: Rodar o teste e confirmar que FALHA**

Run: `node scripts/smoke-sidebar.js`
Expected: FALHA com `Cannot find module '../professores-nav.js'`

- [ ] **Step 3: Criar `professores-nav.js` (config + funções puras)**

Create `professores-nav.js`:

```js
// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Módulo Professores · Configuração e modelo de navegação
// Puro (sem DOM). Usável no browser (window.ProfNav) e no Node (require).
// ═══════════════════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProfNav = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const PROF_PAGES = {
    admin:                ['home', 'modalidades', 'professores', 'agenda', 'agenda-geral', 'minha-agenda', 'fechamento', 'pagamentos', 'escalas', 'ferias', 'saldos-gestao', 'relatorios'],
    admin_gestao:         ['home', 'modalidades', 'professores', 'agenda', 'agenda-geral', 'minha-agenda', 'fechamento', 'pagamentos', 'escalas', 'ferias', 'saldos-gestao', 'relatorios'],
    supervisao:           ['home', 'professores', 'agenda', 'agenda-geral', 'minha-agenda', 'escalas', 'ferias', 'saldos-gestao'],
    professor:            ['home', 'agenda-geral', 'minha-agenda', 'meus-pagamentos', 'ferias', 'meu-saldo'],
    professor_estagiario: ['home', 'agenda-geral', 'minha-agenda', 'meus-pagamentos', 'ferias', 'meu-saldo'],
  };

  // section agora reflete o agrupamento por DOMÍNIO (decisão D3 do design).
  const PAGE_DEFINITIONS = [
    { id: 'home',           label: 'Início',            icon: '🏠', section: null },
    { id: 'agenda',         label: 'Agenda',            icon: '📅', section: 'Agenda' },
    { id: 'agenda-geral',   label: 'Agenda Geral',      icon: '🌐', section: 'Agenda' },
    { id: 'escalas',        label: 'Escalas Especiais', icon: '🎯', section: 'Agenda' },
    { id: 'professores',    label: 'Professores',       icon: '👥', section: 'Cadastros' },
    { id: 'modalidades',    label: 'Modalidades',       icon: '🏷️', section: 'Cadastros' },
    { id: 'ferias',         label: 'Férias e Recesso',  icon: '🏖️', section: 'Férias' },
    { id: 'saldos-gestao',  label: 'Saldos de Férias',  icon: '📊', section: 'Férias' },
    { id: 'meu-saldo',      label: 'Meu Saldo',         icon: '📊', section: 'Férias' },
    { id: 'fechamento',     label: 'Fechamento',        icon: '💰', section: 'Financeiro' },
    { id: 'pagamentos',     label: 'Pagamentos',        icon: '💳', section: 'Financeiro' },
    { id: 'meus-pagamentos',label: 'Meus Pagamentos',   icon: '💳', section: 'Financeiro' },
    { id: 'relatorios',     label: 'Relatórios',        icon: '📈', section: 'Financeiro' },
    { id: 'minha-agenda',   label: 'Minha Agenda',      icon: '📅', section: 'Minhas aulas' },
  ];

  const SECTION_ORDER = ['Agenda', 'Cadastros', 'Férias', 'Financeiro', 'Minhas aulas'];

  // Seção de sistema (cross-módulo). Links apontam pro Comissões com ?page=
  // (deep-link só funciona após o Plano B; antes disso cai na home do Comissões).
  const SYSTEM_SECTION = {
    label: 'Administração · sistema',
    items: [
      { id: 'users', label: 'Usuários e Perfis', icon: '🔑', href: 'index.html?page=users' },
      { id: 'units', label: 'Unidades',          icon: '🏢', href: 'index.html?page=units' },
      { id: 'audit', label: 'Auditoria',         icon: '📜', href: 'index.html?page=audit' },
    ],
  };

  const MODULE_LABELS = { comissoes: 'Comissões', professores: 'Professores' };
  const MODULE_HREF   = { comissoes: 'index.html', professores: 'professores.html' };

  function allowedPagesFor(profiles) {
    const all = (profiles || []).flatMap(p => PROF_PAGES[p] || []);
    return [...new Set(all)];
  }

  function isManagement(profiles) {
    return (profiles || []).some(p => ['admin', 'admin_gestao', 'supervisao'].includes(p));
  }
  function isAdmin(profiles) {
    return (profiles || []).some(p => ['admin', 'admin_gestao'].includes(p));
  }

  // Modelo puro da sidebar. ctx: { hasProfessorLink, moduleAccess }
  function buildSidebarModel(profiles, ctx) {
    ctx = ctx || {};
    let allowed = allowedPagesFor(profiles);

    // "Minha Agenda" pra perfil de gestão só com vínculo de professor (D refinamento).
    if (isManagement(profiles) && !ctx.hasProfessorLink) {
      allowed = allowed.filter(id => id !== 'minha-agenda');
    }

    const defs = PAGE_DEFINITIONS.filter(d => allowed.includes(d.id));

    const groups = [];
    SECTION_ORDER.forEach(section => {
      const items = defs.filter(d => d.section === section)
                        .map(d => ({ id: d.id, label: d.label, icon: d.icon }));
      if (items.length) groups.push({ section, items });
    });

    const home = defs.find(d => d.section === null) || null;
    const systemSection = isAdmin(profiles) ? SYSTEM_SECTION : null;
    const moduleSwitcher = buildModuleSwitcher(ctx.moduleAccess, 'professores');

    return { home, groups, systemSection, moduleSwitcher };
  }

  function buildModuleSwitcher(moduleAccess, activeId) {
    const ids = Object.keys(moduleAccess || {}).filter(k => moduleAccess[k]);
    if (ids.length < 2) return { show: false, modules: [] };
    const modules = ids.map(id => ({
      id, label: MODULE_LABELS[id] || id, href: MODULE_HREF[id] || '#', active: id === activeId,
    }));
    return { show: true, modules };
  }

  return { PROF_PAGES, PAGE_DEFINITIONS, SECTION_ORDER, SYSTEM_SECTION,
           allowedPagesFor, buildSidebarModel, buildModuleSwitcher };
});
```

- [ ] **Step 4: Rodar o teste e confirmar que PASSA**

Run: `node scripts/smoke-sidebar.js`
Expected: `✓ smoke-sidebar: todos os casos passaram`

- [ ] **Step 5: Commit**

```bash
git add professores-nav.js scripts/smoke-sidebar.js
git commit -m "feat(nav): config + modelo puro de sidebar (professores-nav.js) com smoke"
```

---

## Task 2: Renderizar o modelo no DOM (remove duplicação)

**Files:**
- Modify: `professores.html` (incluir o script; ~linha 1850 a sidebar)
- Modify: `professores.js:29-52` (remover config local) e `professores.js:402-424` (`buildSidebar`)

- [ ] **Step 1: Incluir `professores-nav.js` antes de `professores.js` no HTML**

Em `professores.html`, localizar a tag `<script src="professores.js"></script>` e inserir **antes** dela:

```html
<script src="professores-nav.js"></script>
```

(Se houver `professores-shared.js` carregado antes, manter `professores-nav.js` logo acima de `professores.js`; ele não depende de mais nada.)

- [ ] **Step 2: Remover `PROF_PAGES` e `PAGE_DEFINITIONS` locais do `professores.js`**

Em `professores.js`, **apagar** os blocos `const PROF_PAGES = {...}` ([29-35](../../../professores.js)) e `const PAGE_DEFINITIONS = [...]` ([37-52](../../../professores.js)), e no lugar referenciar o módulo:

```js
/* ─── Config de páginas/navegação (ver professores-nav.js) ──────── */
const PROF_PAGES = ProfNav.PROF_PAGES;
```

`getAllowedPages()` ([73-77](../../../professores.js)) continua funcionando (usa `PROF_PAGES`). `PAGE_DEFINITIONS` não é mais referenciado diretamente fora do `buildSidebar` — confirmar com busca antes de apagar (ver Step 4).

- [ ] **Step 3: Reescrever `buildSidebar()` pra renderizar o modelo**

Substituir a função `buildSidebar()` inteira ([professores.js:402-424](../../../professores.js)) por:

```js
function buildSidebar() {
  const nav = document.getElementById('sidebarNav');
  const profiles = AppState.userProfile.profiles || [AppState.userProfile.role];
  const model = ProfNav.buildSidebarModel(profiles, {
    hasProfessorLink: !!getCurrentProfessorId(),
    moduleAccess: AppState.userProfile.moduleAccess || {},
  });

  const itemHtml = (it) => {
    const active = it.id === AppState.currentPage ? 'active' : '';
    return `<div class="sb-item ${active}" onclick="navigateTo('${it.id}')">
              <span class="icon">${it.icon}</span>${it.label}
            </div>`;
  };

  let html = '';
  if (model.home) html += itemHtml(model.home);
  model.groups.forEach(g => {
    html += `<div class="sb-section">${g.section}</div>`;
    g.items.forEach(it => { html += itemHtml(it); });
  });

  // Seção de sistema (admin) — links externos pro Comissões
  if (model.systemSection) {
    html += `<div class="sb-section sb-sys-hdr">${model.systemSection.label}</div>`;
    model.systemSection.items.forEach(it => {
      html += `<a class="sb-item sb-sys" href="${it.href}">
                 <span class="icon">${it.icon}</span>${it.label}
               </a>`;
    });
  }

  nav.innerHTML = html;
  renderModuleSwitcher(model.moduleSwitcher); // Task 4
}

// Placeholder até a Task 4 implementar de verdade (evita ReferenceError neste passo)
function renderModuleSwitcher() {}
```

- [ ] **Step 4: Garantir que nada mais referencia `PAGE_DEFINITIONS` no `professores.js`**

Run: `grep -n "PAGE_DEFINITIONS" professores.js`
Expected: **nenhuma** ocorrência (a config vive só em `professores-nav.js`). Se aparecer, trocar por `ProfNav.PAGE_DEFINITIONS`.

- [ ] **Step 5: Validar na UI (staging) — sem duplicação**

Deploy: `firebase deploy --only hosting --project staging`
Abrir em janela anônima `https://crosstrainer-comissoes-staging.web.app/professores.html` (admin). Conferir:
- Nenhum cabeçalho de seção repetido.
- Ordem: Início · **Agenda** (Agenda, Agenda Geral, Escalas) · **Cadastros** (Professores, Modalidades) · **Férias** (Férias e Recesso, Saldos de Férias) · **Financeiro** (Fechamento, Pagamentos, Relatórios).
- Clicar itens navega normalmente (item ativo destaca).

- [ ] **Step 6: Commit**

```bash
git add professores.html professores.js
git commit -m "feat(nav): sidebar renderiza modelo agrupado (mata duplicacao de secoes)"
```

---

## Task 3: Seção Administração (sistema) — CSS + verificação por perfil

**Files:**
- Modify: `professores.html` (CSS perto da `.sb-section`, ~linha 175)

- [ ] **Step 1: Adicionar CSS da seção de sistema**

Em `professores.html`, logo após a regra `.sb-section { ... }` (~[175](../../../professores.html)), inserir:

```css
.sb-sys-hdr { margin-top: 14px; border-top: 1px solid var(--border); padding-top: 12px; color: var(--orange); }
a.sb-item.sb-sys { text-decoration: none; }
a.sb-item.sb-sys:hover { background: var(--surface2); }
```

- [ ] **Step 2: Validar na UI (staging) — Administração só pra admin**

Deploy: `firebase deploy --only hosting --project staging`. Em janela anônima:
- Como **admin**: a seção **Administração · sistema** aparece no fim da sidebar com Usuários e Perfis · Unidades · Auditoria, separada por uma linha.
- Clicar "Usuários e Perfis" abre o Comissões (`index.html`). Hoje cai na home do Comissões — **comportamento esperado** até o Plano B ligar o deep-link.
- Logar como **professor** (ou usar usuário sem perfil admin): a seção **NÃO aparece**.

- [ ] **Step 3: Commit**

```bash
git add professores.html
git commit -m "feat(nav): estilo da secao Administracao (sistema) na sidebar"
```

---

## Task 4: Seletor de módulo (dirigido por moduleAccess)

**Files:**
- Modify: `professores.html` (contêiner no `.sb-logo` ~linha 1845; CSS ~175)
- Modify: `professores.js` (implementar `renderModuleSwitcher`, substituindo o placeholder da Task 2)

- [ ] **Step 1: Adicionar o contêiner do seletor no HTML**

Em `professores.html`, dentro de `.sb-logo`, logo após o bloco `.sb-logo-text` (~[1849](../../../professores.html)), inserir:

```html
<div class="sb-switcher" id="sbSwitcher" style="display:none;"></div>
```

- [ ] **Step 2: Adicionar CSS do seletor**

Em `professores.html`, perto do CSS da sidebar (~175), inserir:

```css
.sb-switcher { display: flex; gap: 6px; padding: 8px 12px 4px; }
.sb-switcher a { font-size: 11px; padding: 3px 10px; border-radius: 999px; text-decoration: none;
  border: 1px solid var(--border); color: var(--text3); }
.sb-switcher a.active { background: var(--orange); color: #1e293b; border-color: var(--orange); font-weight: 700; }
```

- [ ] **Step 3: Implementar `renderModuleSwitcher` (substituir o placeholder)**

Em `professores.js`, **remover** a função placeholder `function renderModuleSwitcher() {}` (criada na Task 2) e adicionar:

```js
function renderModuleSwitcher(sw) {
  const el = document.getElementById('sbSwitcher');
  if (!el) return;
  if (!sw || !sw.show) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'flex';
  el.innerHTML = sw.modules.map(m =>
    `<a href="${m.href}" class="${m.active ? 'active' : ''}">${m.label}</a>`
  ).join('');
}
```

- [ ] **Step 4: Validar na UI (staging) — seletor só com 2+ módulos**

Deploy: `firebase deploy --only hosting --project staging`. Em janela anônima:
- Como **admin com `moduleAccess` = { comissoes, professores }**: aparecem as pílulas **Comissões / Professores**, com "Professores" ativa. Clicar "Comissões" vai pro `index.html`.
- Como **professor** (só `moduleAccess.professores`): **sem** seletor (só a marca).

> Nota: se o `moduleAccess` do usuário de teste não estiver populado, a migração inline do `professores.js` ("Migração inline de profiles[] e moduleAccess{}") deve preenchê-lo no load. Se o seletor não aparecer pra um admin que tem ambos, conferir `users/{uid}.moduleAccess` no Firestore staging.

- [ ] **Step 5: Atualizar o smoke (cobre o render? não — é DOM). Rodar o smoke da Task 1 pra garantir que nada quebrou na lógica**

Run: `node scripts/smoke-sidebar.js`
Expected: `✓ smoke-sidebar: todos os casos passaram`

- [ ] **Step 6: Commit**

```bash
git add professores.html professores.js
git commit -m "feat(nav): seletor de modulo na sidebar (dirigido por moduleAccess)"
```

---

## Task 5: Limpeza da home estática que virou redundante (opcional, escopo mínimo)

> A home "centro de pendências" é o **Plano C**. Aqui só garantimos que a home atual não fica órfã/confusa após a reorg. Mudança mínima.

**Files:**
- Modify: `professores.html:1896-1946` (conteúdo do `#page-home`)

- [ ] **Step 1: Substituir os cards de status de sprint por um placeholder neutro**

Trocar o conteúdo de `.placeholder-grid` ([1902-1945](../../../professores.html)) por uma mensagem simples (o painel real vem no Plano C):

```html
<div class="page-empty">
  <p>Selecione uma seção no menu lateral. O painel de pendências chega em breve.</p>
</div>
```

- [ ] **Step 2: Validar na UI (staging)**

Deploy staging + janela anônima: a home não mostra mais "Em construção · Sprint 1"; mostra a mensagem neutra.

- [ ] **Step 3: Commit**

```bash
git add professores.html
git commit -m "chore(home): remove cards de status de sprint (painel real vira Plano C)"
```

---

## Self-review (preenchido)

- **Cobertura do spec:** §3 (seletor de módulo) → Task 4; §4 (sidebar por domínio + duplicação + Minha Agenda condicional) → Tasks 1-3; §6 (Administração compartilhada) → Tasks 1+3. §5 (home) e §7 (form Usuários) **fora deste plano** (Planos C e D, declarados no design). ✔
- **Placeholders:** nenhum "TODO/TBD"; todo código está completo. O único `renderModuleSwitcher` vazio é um **stub intencional** criado na Task 2 e substituído na Task 4 (documentado). ✔
- **Consistência de tipos:** `buildSidebarModel` retorna `{ home, groups, systemSection, moduleSwitcher }`; `buildSidebar` consome exatamente esses campos; `renderModuleSwitcher(sw)` usa `sw.show`/`sw.modules[].{label,href,active}` — coerente com `buildModuleSwitcher`. ✔
- **Escopo:** plano isolado, entrega software funcionando (sidebar limpa + seletor + Administração), sem tocar em produção. ✔

## Notas de risco / execução

- **Branch:** tudo em `feature/shell-integrado`. Não mergear no `main` até homologar (deploy de prod sai do `main`).
- **Regra #1:** este plano não toca `index.html`/`commission.js`/`sw.js`/`manifest.json`. Os links da Administração/seletor só *apontam* pro `index.html`.
- **Regra #7:** validar em staging; produção só depois de homologação + OK explícito.
- **Regra #8:** textos novos usam **CrossTainer**.
- Depois deste plano: **Plano B** (deep-link no `index.html`, autorizado conforme decisão da sessão), **Plano C** (home), **Plano D** (form Usuários).
