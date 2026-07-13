# Checklist — Deploy em Produção (módulo Professores + shell integrado)

> **Pré-requisito inviolável (regra #7):** homologação completa do cliente em staging APROVADA explicitamente.
> Produção = projeto Firebase `crosstrainer-comissoes` + GitHub Pages (github.io serve o `origin/main`).

> **⚠️ HOTFIX DE SEGURANÇA JÁ EM PRODUÇÃO (15/06/2026) — LER ANTES DO MERGE.**
> Foi deployado um hotfix pontual fora deste fluxo (falha de auto-promoção a admin no `/users` create):
> - **Regras de prod** já estão com `/users` `allow create: if isAdmin();` (patch mínimo sobre as regras antigas). O `firebase deploy --only firestore:rules` do passo 2 **substitui** isso pela versão endurecida do módulo — OK, é superset; só esteja ciente.
> - **`origin/main` (produção) ganhou o commit `02e0909`** (frontend do hotfix) que o **`main` local NÃO tem**. O `main` local está 26 commits à frente de `origin/main` (o módulo inteiro, não publicado) **e não inclui o hotfix**. A branch `feature/shell-integrado` tem o **port equivalente** (`2eed9d6`).
> - **CONSEQUÊNCIA:** o `git push origin main` do passo 3 vai ser **non-fast-forward** (origin tem `02e0909`). **Reconciliar antes:** `git checkout main && git merge origin/main` (traz o hotfix) e resolver o overlap nas funções `createUser`/`activateUser`/`showProfileRecovery` (a branch já tem a versão correta — manter a da branch). Validar que o resultado final tem o fix antes de publicar.
> - Detalhes: memória `hotfix-users-create-rule.md`.
>
> **⚠️ FIXES DE COMISSÕES TAMBÉM EM PRODUÇÃO (16/06/2026).** Além do hotfix, `origin/main` ganhou `3d6a30d`..`f6f23d5` (split P2, BIANUAL, recálculo completo, **raiz do upload preservando splits**, aba Divisões, fixes de UI) — também NÃO no `main` local. A branch `feature/shell-integrado` JÁ tem o port (cherry-pick `e4514bb`..`3b35d06`; sw.js mantido v3.1; branding CrossTainer preservado). Então o `git merge origin/main` da reconciliação vai casar conteúdo igual (hashes diferentes) — overlap em `commission.js`/`index.html`/`sw.js`: **manter a versão da branch** (já é a correta + tem branding + v3.1). Detalhes: memória `fix-split-bianual-recalc.md`.

## 0. Decisões a confirmar com o cliente ANTES do deploy

- [x] **Antecedência mínima de férias:** ✅ DECIDIDO (12/07) — **mantém 5 dias** em produção também (escolha do usuário; segue configurável pela gestão). Nenhuma mudança de constante necessária.
- [ ] **Tela legada de Usuários** (`index.html?page=users`): manter morta (fora do menu, já consertada) ou remover o código de vez?
- [ ] **Edição de grade NÃO propaga pras aulas já geradas** (a discutir com o Rodrigo). Hoje: a geração é só-inserção (ID `slot+data`, `functions/index.js:321`) e editar um slot mexe só no template (`professores-agenda.js:563`). Logo, alterar a agenda vale **só pra datas ainda não geradas** — as aulas das ~4 semanas já criadas mantêm os dados antigos; correção em aula já gerada é por **status** (cancelar/realizar) ou **substituição**, não pela grade. Decidir se o comportamento desejado é esse ou se precisa de uma **regeneração/propagação** ao editar a grade (precedente técnico viável: `regenerateClassesWithHolidays`). **Possível ajuste antes da produção.** Relacionado: a "Minha Agenda" do professor só expõe até *próxima semana / mês corrente* (`MINHA_AGENDA_FILTERS`), embora as aulas existam ~4 semanas à frente.

## 1. Pré-merge

- [x] Smokes verdes: `node scripts/smoke-user-model.js && node scripts/smoke-sidebar.js && node scripts/smoke-pessoas-model.js` — ✅ 3/3 verdes (12/07)
- [ ] **Reconciliar hotfix:** `git checkout main && git merge origin/main` (traz o `02e0909` do hotfix de segurança que está em prod mas não no main local) — ver aviso no topo
  - **📋 Avaliação de reconciliação (12/07, `git cherry` + inspeção):** `origin/main` tem 6 commits à frente do main local; divergência analisada:
    - **Segurança 100% coberta na branch:** commit `2eed9d6` (port do frontend `/users`: activateUser + form de recuperação neutralizado) É ancestral da branch **e** a regra `firestore.rules` `/users`→`isAdmin()` está presente. O `02e0909` aparece como `+` no cherry só por patch-id diferente — conteúdo presente.
    - **Split/BIANUAL/Divisões (Comissões):** 4 commits (`3d6a30d`,`6386ea8`,`c197593`,`f6f23d5`) com equivalente portado na branch (cherry `-`). ✓
    - **`222dba7`** (arredonda contadores no recálculo + bump sw): o *bump sw* é superado pelo **sw v3.1** da branch; a parte de `index.html` (~9 linhas) NÃO tem patch-equivalente — o `git merge origin/main` a traz de qualquer forma. **⚠️ Watch-item:** ao mergear a branch depois, `index.html` terá conflito (ambos os lados mexem muito nele) → resolver com cuidado preservando o arredondamento do `222dba7` + o branding/config da branch, e re-rodar os smokes do Comissões.
    - **Veredito:** plano do checklist (merge `origin/main`→`main`, depois a branch) é **seguro**; nada crítico falta. Único cuidado = conflito de `index.html` no dia.
- [ ] `git diff main..feature/shell-integrado --stat` revisado (sem arquivo inesperado)
- [ ] Merge: `git checkout main && git merge feature/shell-integrado` (sem squash — preservar histórico das sessões)
- [ ] Confirmar pós-merge que `/users` create exige admin e que `createUser`/`activateUser`/form de recuperação têm o fix (não regrediram)

## 2. Deploys Firebase (SEMPRE com `--project production` explícito)

Ordem importa — rules e índices antes do código que depende deles:

- [ ] `firebase deploy --only firestore:rules --project production`
- [ ] `firebase deploy --only firestore:indexes --project production`  ← inclui o índice de férias (teacherId+requestedAt) que faltava
- [ ] Aguardar build dos índices (console Firebase → Firestore → Indexes, todos READY)
- [ ] `firebase deploy --only functions --project production`  ← CFs nunca rodaram em prod (cron de geração de aulas, férias, email)
  - ⚠️ **Inclui o fix do TDZ (12/07):** `generateClassesCore` tinha `ReferenceError: Cannot access 'ONE_DAY_MS' before initialization` que quebrava TODA a geração de aulas (agendada + callable). Corrigido na branch — este deploy leva a versão boa. Sem ele, a geração de aulas nunca roda. Memória `fix-geracao-aulas-tdz`. Pós-deploy: forçar 1x o cron de geração (ou aguardar) e conferir que aulas são criadas.
- [ ] `firebase deploy --only hosting --project production`
- [ ] Validar rules em prod via REST (adaptar `scripts/validate-pessoas-rules.js` pro projectId/apiKey de produção + fixture temporária + cleanup)

## 3. GitHub Pages

- [ ] `git push origin main` (github.io serve o main — leva o index.html novo + professores.* + sw.js v3.1)
- [ ] Confirmar no navegador: github.io carrega, SW atualiza pra `crosstrainer-v3.1` (DevTools → Application → SW)

## 4. Setup inicial em produção (com o cliente, ~1h)

- [ ] Cadastrar **modalidades** (decisão P01 — admin cadastra, nada vem pré-pronto)
- [ ] Cadastrar **professores reais** pelo hub Pessoas (wizard), com salários (só admin) — vincular às unidades reais (CP e PP)
- [ ] Conferir perfis dos usuários existentes (vendedoras → vendedor; donos → admin) na aba Acesso da ficha
- [ ] Montar a agenda semanal (templates) e conferir a geração de aulas pelo cron no dia seguinte

## 5. Smoke pós-deploy em produção

- [ ] Login admin no Comissões: dashboard carrega · menu "Pessoas" abre o hub
- [ ] Login admin no Professores: 11 páginas abrem sem erro de console
- [ ] Professor real: Minha Agenda + Minhas Férias carregam
- [ ] Vendedora real: login no Comissões normal (não bloqueada)
- [ ] Branding: título/login mostram CROSSTAINER (sem o R)

## 6. Pós-homologação (não bloqueia o deploy)

- [ ] Remover fisicamente a tela `page-users` do index.html
- [ ] Audit BIANUAL legacy no Comissões (4 casos CP/Abr identificados — pendência antiga, independente do módulo)
- [ ] Recibos com vírgula BR (cosmético pré-existente)
- [ ] Reconciliar Proposta Funcional §4 com o drop do `admin_gestao`

## Rollback

- Hosting/Pages: `git revert` do merge + redeploy (código é estático, sem migração de dados).
- Rules/índices: redeploy da versão anterior do `firestore.rules`/`firestore.indexes.json` (git history).
- Functions: `firebase deploy --only functions --project production` da versão anterior.
- Dados: o deploy NÃO migra dados — risco de dado corrompido é zero no deploy em si.
