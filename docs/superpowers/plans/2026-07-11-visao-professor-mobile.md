# Visão do Professor — Otimização Mobile (1ª passada) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar a visão do professor nativa de celular — barra inferior fixa (5 destinos), cabeçalho compacto com sino, abas da Escala em chips, e ergonomia (toque/espaçamento) — tudo sob `@media ≤768px`, sem tocar no desktop.

**Architecture:** Um helper puro novo (`ProfNav.buildBottomNavModel`) decide os itens da barra por papel; `professores.html` ganha o markup do cabeçalho/barra + o CSS mobile; `professores.js` popula a barra, sincroniza o item ativo e o título no `navigateTo`, e espelha o badge do sino; a barra de abas do professor na Escala vira classes CSS (chip no mobile, underline no desktop).

**Tech Stack:** HTML/CSS/JS vanilla (UMD), smoke Node com `assert`. Verificação visual pelo preview em 375px.

**Spec:** `docs/superpowers/specs/2026-07-11-visao-professor-mobile-design.md`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Ação |
|---------|------------------|------|
| `professores-nav.js` | `buildBottomNavModel(profiles)` (puro) | modificar |
| `scripts/smoke-sidebar.js` | asserções do novo helper | modificar |
| `professores.html` | markup do cabeçalho mobile + barra inferior + CSS mobile (shell, chips, toque, safe-area) | modificar |
| `professores.js` | popular a barra, sync ativo/título no `navigateTo`, badge do sino no mobile | modificar |
| `professores-escala-smart.js` | barra de abas do professor com classes (pra virar chip no mobile) | modificar |

**Ordem:** Task 1 (modelo puro) → Task 2 (markup + CSS do shell) → Task 3 (wiring no JS) → Task 4 (abas → chips) → Task 5 (verificação + prints mobile).

---

## Task 1: `buildBottomNavModel` (puro) + smoke

**Files:**
- Modify: `professores-nav.js`
- Modify: `scripts/smoke-sidebar.js`

- [ ] **Step 1: Adicionar asserções ao smoke** — em `scripts/smoke-sidebar.js`, ANTES da linha final `console.log('✓ smoke-sidebar: todos os casos passaram');`, inserir:

```js
// 6) Barra inferior mobile — só professor; 5 itens na ordem, com labels curtos
const bnProf = Nav.buildBottomNavModel(['professor']);
assert.deepStrictEqual(bnProf.map(i => i.id),
  ['home', 'minha-agenda', 'escala-smart', 'engaj-placar', 'meus-pagamentos'],
  'Barra: ids/ordem errados p/ professor');
assert.deepStrictEqual(bnProf.map(i => i.label),
  ['Início', 'Agenda', 'Escala', 'Placar', 'Pagar'], 'Barra: labels curtos errados');
assert.ok(bnProf.every(i => i.icon), 'Barra: todo item tem ícone');
assert.deepStrictEqual(Nav.buildBottomNavModel(['professor_estagiario']).map(i => i.id),
  ['home', 'minha-agenda', 'escala-smart', 'engaj-placar', 'meus-pagamentos'],
  'Barra: estagiário deve ter os mesmos 5');
assert.deepStrictEqual(Nav.buildBottomNavModel(['admin']), [], 'Barra: admin não tem barra');
assert.deepStrictEqual(Nav.buildBottomNavModel(['supervisao']), [], 'Barra: supervisão não tem barra');
assert.deepStrictEqual(Nav.buildBottomNavModel(['admin', 'professor']), [],
  'Barra: gestão+professor usa o drawer (sem barra)');
assert.deepStrictEqual(Nav.buildBottomNavModel([]), [], 'Barra: vazio → sem barra');
console.log('✓ smoke-sidebar: buildBottomNavModel OK');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "C:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes" && node scripts/smoke-sidebar.js`
Expected: FAIL — `Nav.buildBottomNavModel is not a function`.

- [ ] **Step 3: Implementar em `professores-nav.js`** — logo APÓS a função `isAdmin` (perto da linha 72), inserir:

```js
  // Modelo puro da barra inferior mobile. Só pro papel professor (não gestão).
  // Retorna os 5 destinos fixos com label CURTO p/ caber na barra; [] pra gestão/desconhecido.
  const BOTTOM_NAV_IDS = ['home', 'minha-agenda', 'escala-smart', 'engaj-placar', 'meus-pagamentos'];
  const BOTTOM_NAV_LABELS = {
    'home': 'Início', 'minha-agenda': 'Agenda', 'escala-smart': 'Escala',
    'engaj-placar': 'Placar', 'meus-pagamentos': 'Pagar',
  };
  function buildBottomNavModel(profiles) {
    if (isManagement(profiles)) return [];
    const isProf = (profiles || []).some(p => p === 'professor' || p === 'professor_estagiario');
    if (!isProf) return [];
    return BOTTOM_NAV_IDS.map(id => {
      const def = PAGE_DEFINITIONS.find(d => d.id === id);
      return { id, label: BOTTOM_NAV_LABELS[id], icon: def ? def.icon : '' };
    });
  }
```

- [ ] **Step 4: Exportar** — no `return { ... }` final do módulo (perto da linha 109), adicionar `buildBottomNavModel` à lista de exports.

- [ ] **Step 5: Rodar e ver passar**

Run: `node scripts/smoke-sidebar.js`
Expected: PASS — inclui `✓ smoke-sidebar: buildBottomNavModel OK` e `✓ smoke-sidebar: todos os casos passaram`.

- [ ] **Step 6: Commit**

```bash
git add professores-nav.js scripts/smoke-sidebar.js
git commit -m "feat(mobile): buildBottomNavModel (barra inferior do professor)"
```
(A mensagem deve terminar com uma linha em branco seguida de:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
Não usar `--no-verify`. Warnings de `.git/worktrees/*` "Permission denied" são cruft pré-existente — o commit ainda entra; ignore.)

---

## Task 2: Markup do cabeçalho + barra + CSS mobile (`professores.html`)

**Files:** Modify `professores.html`. Sem teste de DOM — verificação por parse (Task 5 faz o E2E visual). **LER o shell antes** (`#appShell` começa perto da linha 1983; a sidebar/`.sb-user`/sino em 1985–2023; o bloco `@media (max-width:768px)` em ~1759).

- [ ] **Step 1: Adicionar o cabeçalho mobile** — logo APÓS a linha `<div class="app" id="appShell" style="display:none">` (~1983), inserir:

```html
    <!-- Mobile — cabeçalho compacto (☰ + título + sino). Só visível ≤768px via CSS. -->
    <header class="mobile-topbar" id="mobileTopbar">
      <button class="mtb-btn" onclick="toggleMenu()" aria-label="Abrir menu">☰</button>
      <span class="mtb-title" id="mobileTopbarTitle">Início</span>
      <button class="mtb-btn mtb-bell" id="mobileNotifBell" onclick="event.stopPropagation(); toggleNotifDropdown()" aria-label="Notificações">
        🔔<span class="mtb-badge" id="mobileNotifBadge" style="display:none;">0</span>
      </button>
    </header>
```

- [ ] **Step 2: Adicionar a barra inferior** — imediatamente ANTES do `</div>` que fecha `#appShell` (o último filho de `#appShell`; fica logo após o fechamento do elemento `.main`). Inserir:

```html
    <!-- Mobile — barra inferior de navegação. Populada por buildBottomNav() no professores.js. Só ≤768px. -->
    <nav class="bottom-nav" id="bottomNav" aria-label="Navegação rápida"></nav>
```

Se não estiver claro onde `#appShell` fecha, procure o comentário/o `</div>` que vem depois do bloco `.main`; a barra deve ser filha direta de `#appShell`, irmã da `.sidebar` e da `.main`.

- [ ] **Step 3: Adicionar o CSS** — imediatamente ANTES do `</style>` (fim do bloco de estilos), inserir:

```css
    /* ─── MOBILE — visão do professor: cabeçalho compacto + barra inferior ─── */
    .mobile-topbar { display: none; }
    .bottom-nav { display: none; }
    @media (max-width: 768px) {
      /* cabeçalho fixo */
      .mobile-topbar {
        display: flex; align-items: center; gap: 10px;
        position: fixed; top: 0; left: 0; right: 0; height: 52px; z-index: 60;
        padding: 0 12px; background: var(--surface1, #121216);
        border-bottom: 1px solid var(--border);
      }
      .mtb-btn {
        background: none; border: none; color: var(--text); font-size: 20px;
        min-width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;
        cursor: pointer; position: relative;
      }
      .mtb-title { flex: 1; font-size: 15px; font-weight: 500; color: var(--text); }
      .mtb-badge {
        position: absolute; top: 4px; right: 4px; background: var(--orange); color: #0a0a0a;
        font-size: 10px; font-weight: 700; border-radius: 9px; padding: 0 5px; line-height: 16px;
      }
      /* a barra inferior */
      .bottom-nav {
        display: flex; position: fixed; bottom: 0; left: 0; right: 0; z-index: 60;
        background: var(--surface1, #121216); border-top: 1px solid var(--border);
        padding-bottom: env(safe-area-inset-bottom);
      }
      .bottom-nav-item {
        flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;
        min-height: 52px; padding: 7px 2px 5px; background: none; border: none;
        color: var(--text2); font-size: 9px; cursor: pointer;
      }
      .bottom-nav-item .bn-icon { font-size: 20px; line-height: 1; }
      .bottom-nav-item.active { color: var(--orange); }
      /* esconde o ☰ flutuante antigo — o cabeçalho já tem o dele */
      .menu-toggle { display: none !important; }
      /* espaço p/ cabeçalho (topo) e barra (rodapé) não cobrirem conteúdo */
      .page { padding: 64px 14px calc(74px + env(safe-area-inset-bottom)) !important; }
      /* dropdown de notificação vira overlay (a sidebar está off-canvas no mobile) */
      #notifDropdown {
        position: fixed !important; top: 56px; right: 8px; left: 8px; width: auto !important;
        max-height: 70vh; overflow-y: auto; z-index: 70;
      }
      /* densidade: títulos display menores no celular */
      .page-hdr h1 { font-size: 20px; }
    }
```

- [ ] **Step 4: Verificar parse do HTML/CSS** (checa que o arquivo continua íntegro e o marcador novo existe)

Run: `cd "C:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes" && node -e "const s=require('fs').readFileSync('professores.html','utf8'); if(!s.includes('id=\"bottomNav\"')||!s.includes('id=\"mobileTopbar\"')) throw new Error('markup novo ausente'); if((s.match(/<style/g)||[]).length!==(s.match(/<\/style>/g)||[]).length) throw new Error('tags style desbalanceadas'); console.log('professores.html OK');"`
Expected: `professores.html OK`.

- [ ] **Step 5: Commit**

```bash
git add professores.html
git commit -m "feat(mobile): cabecalho compacto + barra inferior + CSS mobile do professor"
```
(trailer `Co-Authored-By:` como na Task 1)

---

## Task 3: Wiring no `professores.js` (popular barra, sync ativo/título, badge do sino)

**Files:** Modify `professores.js`. Sem teste de DOM — parse + smoke. **LER** `buildSidebar` (~384), o call-site do login (~222), `navigateTo` (~431–453), `updateNotifBellBadge` (~276).

- [ ] **Step 1: Adicionar `buildBottomNav()`** — logo APÓS a função `buildSidebar` (após a linha `}` que a fecha, ~418), inserir:

```js
/* ─── Barra inferior (mobile) ──────────────────────────────────── */
function buildBottomNav() {
  const nav = document.getElementById('bottomNav');
  if (!nav) return;
  const profiles = AppState.userProfile.profiles || [AppState.userProfile.role];
  const items = ProfNav.buildBottomNavModel(profiles);
  if (!items.length) { nav.style.display = 'none'; nav.innerHTML = ''; return; }
  nav.style.removeProperty('display'); // deixa o CSS (display:flex ≤768) decidir
  nav.innerHTML = items.map(it =>
    `<button class="bottom-nav-item ${it.id === AppState.currentPage ? 'active' : ''}" onclick="navigateTo('${it.id}')">
       <span class="bn-icon">${it.icon}</span>${it.label}
     </button>`).join('');
}

// Atualiza item ativo da barra + título do cabeçalho conforme a rota atual.
function syncMobileChrome() {
  document.querySelectorAll('.bottom-nav-item').forEach(el => {
    el.classList.toggle('active', el.getAttribute('onclick') === `navigateTo('${AppState.currentPage}')`);
  });
  const titleEl = document.getElementById('mobileTopbarTitle');
  if (titleEl) {
    const def = (ProfNav.PAGE_DEFINITIONS || []).find(d => d.id === AppState.currentPage);
    titleEl.textContent = def ? def.label : '';
  }
}
```

- [ ] **Step 2: Chamar `buildBottomNav()` no login** — na função que roda após carregar o perfil, logo APÓS a linha `buildSidebar();` (~222), adicionar:

```js
  buildBottomNav();
```

- [ ] **Step 3: Sincronizar no `navigateTo`** — em `navigateTo`, logo APÓS a linha `buildSidebar();` (~453), adicionar:

```js
  syncMobileChrome();
```

- [ ] **Step 4: Espelhar o badge do sino no mobile** — em `updateNotifBellBadge` (~276), logo ANTES do `}` que fecha a função, adicionar:

```js
  const mBadge = document.getElementById('mobileNotifBadge');
  if (mBadge) {
    if (n === 0) { mBadge.style.display = 'none'; }
    else { mBadge.style.display = 'inline-block'; mBadge.textContent = n > 9 ? '9+' : String(n); }
  }
```

(`n` já é `NotifState.unread.length`, definido no início da função — reutilize.)

- [ ] **Step 5: Verificar parse + smoke**

Run: `cd "C:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes" && node -e "new Function(require('fs').readFileSync('professores.js','utf8').replace(/^\xEF\xBB\xBF/,'')); console.log('professores.js sintaxe OK')" && node scripts/smoke-sidebar.js >/dev/null && echo "smoke OK"`
Expected: `professores.js sintaxe OK` e `smoke OK`.

- [ ] **Step 6: Commit**

```bash
git add professores.js
git commit -m "feat(mobile): popular barra inferior + sync ativo/titulo + badge do sino no mobile"
```
(trailer `Co-Authored-By:`)

---

## Task 4: Abas da Escala do professor viram classes (chip no mobile)

**Files:** Modify `professores-escala-smart.js` (barra de abas em `renderEscalaPrefs`, ~905–909) e `professores.html` (CSS das classes). Hoje as abas usam estilo inline com `flex-wrap:wrap` + underline; trocamos por classes pra o mobile virar chip sem `!important`.

- [ ] **Step 1: Trocar o markup inline por classes** — em `professores-escala-smart.js`, substituir o bloco `tabsHtml` (linhas ~905–909):

```js
  const tabsHtml = `<div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:12px;flex-wrap:wrap;">` +
    ESCALA_TABS.map(t => {
      const on = t.id === tab;
      return `<button onclick="escalaSetTab('${t.id}')" style="background:none;border:none;border-bottom:2px solid ${on ? 'var(--blue)' : 'transparent'};color:${on ? 'var(--text)' : 'var(--text2)'};font-weight:${on ? '600' : '400'};font-size:14px;padding:8px 14px;cursor:pointer;">${t.label}</button>`;
    }).join('') + `</div>`;
```

por:

```js
  const tabsHtml = `<div class="escala-tabs">` +
    ESCALA_TABS.map(t =>
      `<button class="escala-tab${t.id === tab ? ' active' : ''}" onclick="escalaSetTab('${t.id}')">${t.label}</button>`
    ).join('') + `</div>`;
```

- [ ] **Step 2: Adicionar o CSS das classes** — em `professores.html`, imediatamente ANTES do `</style>` (pode ser logo após o bloco mobile da Task 2), inserir:

```css
    /* ─── Abas da Escala (professor) — desktop: underline; mobile: chips ─── */
    .escala-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 12px; flex-wrap: wrap; }
    .escala-tab {
      background: none; border: none; border-bottom: 2px solid transparent;
      color: var(--text2); font-weight: 400; font-size: 14px; padding: 8px 14px; cursor: pointer;
    }
    .escala-tab.active { border-bottom-color: var(--blue); color: var(--text); font-weight: 600; }
    @media (max-width: 768px) {
      .escala-tabs { gap: 6px; border-bottom: none; }
      .escala-tab {
        border: 1px solid var(--border); border-radius: 16px; padding: 8px 14px;
        min-height: 40px; background: var(--surface2, #1c1c22);
      }
      .escala-tab.active {
        border-color: var(--orange); background: var(--orange); color: #0a0a0a; font-weight: 600;
      }
    }
```

- [ ] **Step 3: Verificar parse + smoke**

Run: `cd "C:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes" && node -e "new Function(require('fs').readFileSync('professores-escala-smart.js','utf8').replace(/^\xEF\xBB\xBF/,'')); const s=require('fs').readFileSync('professores.html','utf8'); if(!s.includes('.escala-tab')) throw new Error('CSS das abas ausente'); console.log('OK');" && node scripts/smoke-escala-frente3.js >/dev/null && echo "smoke frente3 OK"`
Expected: `OK` e `smoke frente3 OK`.

- [ ] **Step 4: Commit**

```bash
git add professores-escala-smart.js professores.html
git commit -m "feat(mobile): abas da Escala do professor em chips no celular"
```
(trailer `Co-Authored-By:`)

---

## Task 5: Verificação final + prints mobile antes/depois

**Files:** nenhum (verificação). Sem deploy.

- [ ] **Step 1: Suíte de smokes + parse**

```bash
cd "C:/Users/ra058347/OneDrive - intelbras.com.br/Documentos/GitHub/crosstrainer-comissoes" && node scripts/smoke-sidebar.js && node scripts/smoke-escala-frente3.js && node scripts/smoke-escala-frente2.js && node scripts/smoke-escala-frente1.js && node scripts/smoke-scale-service.js && node scripts/smoke-escala-tabs.js && node scripts/smoke-notify-service.js && node -e "new Function(require('fs').readFileSync('professores.js','utf8').replace(/^\xEF\xBB\xBF/,'')); new Function(require('fs').readFileSync('professores-escala-smart.js','utf8').replace(/^\xEF\xBB\xBF/,'')); require('./professores-nav.js'); console.log('parse OK')"
```
Expected: todos verdes + `parse OK`.

- [ ] **Step 2: E2E visual no preview (375px)** — subir o servidor estático (`crosstrainer-static`, porta 8123), viewport mobile, logar como `professor.teste@crosstainer.com` / `crosstainer2026` (login via SDK: `firebase.auth().signInWithEmailAndPassword(...)`), e capturar **antes/depois**:
- [ ] Home: cabeçalho compacto (☰ + "Início" + 🔔) + barra inferior com "Início" ativo.
- [ ] Escala → Eventos: abas em **chips** (ativa laranja) + barra inferior com "Escala" ativo. (Se precisar de um evento com o professor no staff, semear via admin no console e limpar no fim — como já feito antes.)
- [ ] Minha Agenda e Pagamentos: barra troca o item ativo ao navegar; título do cabeçalho muda.
- [ ] Sino: badge aparece no cabeçalho; tocar abre o dropdown como overlay (não escondido atrás da sidebar).
- [ ] **Regressão:** logar como `dono.teste@crosstainer.com` (admin) no mobile → **NÃO** aparece a barra inferior (só o drawer). E no viewport desktop (≥1000px) o layout do professor segue **idêntico** ao de antes (sidebar normal, sem cabeçalho/barra).

- [ ] **Step 3: (se algo falhar no E2E)** corrigir no fonte, re-rodar Step 1, re-verificar no preview, e commitar o ajuste.

---

## Notas de execução

- **Regra §1 do CLAUDE.md:** `professores.html` é do módulo (não é produção do Comissões) — pode ser editado; mantenha as mudanças sob `@media ≤768px` / classes novas pra não afetar desktop nem o Comissões.
- **Sem deploy** nesta leva — é frontend/CSS; sobe junto quando você decidir (mesmo hosting do staging). Produção só após homologação (CLAUDE.md §7).
- **Gestão no mobile** ganha só o cabeçalho compacto (☰+título+sino), sem a barra inferior — segue usando o drawer.
- `position: fixed` da barra + teclado virtual: as telas principais do professor não têm inputs longos; aceitável nesta passada.
