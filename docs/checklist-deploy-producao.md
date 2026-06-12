# Checklist — Deploy em Produção (módulo Professores + shell integrado)

> **Pré-requisito inviolável (regra #7):** homologação completa do cliente em staging APROVADA explicitamente.
> Produção = projeto Firebase `crosstrainer-comissoes` + GitHub Pages (github.io serve o `main`).

## 0. Decisões a confirmar com o cliente ANTES do deploy

- [ ] **Antecedência mínima de férias:** staging está com **5 dias** (relaxado pra teste); produção deve voltar pra **30**? (localizar a constante e ajustar antes do merge)
- [ ] **Tela legada de Usuários** (`index.html?page=users`): manter morta (fora do menu, já consertada) ou remover o código de vez?

## 1. Pré-merge

- [ ] Smokes verdes: `node scripts/smoke-user-model.js && node scripts/smoke-sidebar.js && node scripts/smoke-pessoas-model.js`
- [ ] `git diff main..feature/shell-integrado --stat` revisado (sem arquivo inesperado)
- [ ] Merge: `git checkout main && git merge feature/shell-integrado` (sem squash — preservar histórico das sessões)

## 2. Deploys Firebase (SEMPRE com `--project production` explícito)

Ordem importa — rules e índices antes do código que depende deles:

- [ ] `firebase deploy --only firestore:rules --project production`
- [ ] `firebase deploy --only firestore:indexes --project production`  ← inclui o índice de férias (teacherId+requestedAt) que faltava
- [ ] Aguardar build dos índices (console Firebase → Firestore → Indexes, todos READY)
- [ ] `firebase deploy --only functions --project production`  ← CFs nunca rodaram em prod (cron de geração de aulas, férias, email)
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
