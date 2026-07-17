# Plano B — Deep-link no Comissões (`index.html`)

**Goal:** Permitir abrir uma página específica do módulo Comissões via `index.html?page=<id>`, para que os links da seção **Administração** do módulo Professores (Usuários/Unidades/Auditoria, criados no Plano A) abram **direto** na tela certa em vez de cair no dashboard.

**Architecture:** Mudança aditiva mínima no `showApp()` do `index.html`: após o pouso default, ler `?page=` da URL e chamar a `navigateTo` existente (que já tem guardas de ACL e os hooks `loadUsers/loadUnits/loadAuditLog`). Sem `?page=`, o comportamento atual é idêntico.

**Tech Stack:** vanilla JS. Validação: manual em staging.

**Branch:** `feature/shell-integrado` (não mergear no `main` até homologar).

## ⚠️ Toca em produção (regra inviolável #1)

`index.html` é código de produção do Comissões (em uso). Esta mudança foi **autorizada pelo usuário** nesta sessão (decisão "deep-link / Tier 1"). É **aditiva**: só age quando há `?page=` na URL; o fluxo de login normal (sem parâmetro) permanece intacto. **Não** vai pra produção sem homologação + OK explícito (regra #7).

## Ponto de injeção (confirmado lendo o código)

`showApp()` em [index.html:3439-3455](../../../index.html): carrega `userProfile`, monta sidebar, e faz o pouso default (`navigateTo('dashboard')` admin / `navigateTo('meu-painel')` vendedor). A `navigateTo(page)` ([:3618](../../../index.html)) já valida ACL (vendedor → `meu-painel`) e já dispara `loadUsers/loadUnits/loadAuditLog` ([:3652-3654](../../../index.html)) para os ids `users`/`units`/`audit`.

## Task 1 — Override de deep-link no showApp

**Files:** Modify `index.html` (fim do `showApp()`, ~linha 3454)

- [ ] **Step 1:** Em `showApp()`, logo após `renderQuickUnitSelector();` (última linha antes do `}`), inserir:

```js
      // Deep-link: abre uma página específica via ?page=... (ex.: vindo do módulo Professores).
      // Aditivo — sem o parâmetro, o pouso default acima permanece. ACL é garantida pela navigateTo.
      const deepLinkPage = new URLSearchParams(location.search).get('page');
      if (deepLinkPage) navigateTo(deepLinkPage);
```

- [ ] **Step 2:** Sanity de sintaxe: `node --check index.html` não se aplica (HTML). Em vez disso, conferir visualmente que o bloco foi inserido dentro de `showApp()` e que o `}` da função fecha logo depois.

- [ ] **Step 3:** Commit:
```bash
git add index.html
git commit -m "feat(comissoes): deep-link via ?page= no showApp (abre Administracao vinda do Professores)"
```

- [ ] **Step 4 (checkpoint humano):** Deploy staging + validar:
```bash
firebase deploy --only hosting --project staging
```
  - Logado como **admin** no Professores → clicar **Administração → Usuários e Perfis**: deve abrir **direto** a "Gestão de Usuários" do Comissões (não o dashboard). Idem **Unidades** e **Auditoria**.
  - Login normal no Comissões (URL sem `?page=`): cai no **dashboard** como antes (comportamento inalterado).
  - `index.html?page=users` como **vendedor** (se testável): a ACL redireciona pra `meu-painel` (não vaza tela de admin).

## Critérios de aceite
1. Links de Administração do Professores abrem a tela correspondente do Comissões diretamente.
2. Login sem `?page=` mantém o pouso default (dashboard/meu-painel) — zero regressão.
3. ACL preservada (vendedor não acessa páginas de admin via deep-link).
4. Nenhuma outra parte do `index.html` alterada.
