# CrossTainer — Instruções Permanentes para o Claude

> Este arquivo é lido automaticamente em cada nova sessão. Mantém o Claude alinhado sem precisar de prompt manual.

## 🎯 Sobre o projeto

Sistema de gestão para academia CrossTainer. Dois módulos:

1. **Comissões** (existente) — `index.html` 10.829 linhas, em produção, **não tocar sem necessidade**
2. **Professores** (em construção) — agenda, substituições, fechamento, pagamentos, escalas

Stack: HTML/CSS/JS vanilla + Firebase (Auth + Firestore + Functions + Storage). Sem framework.

## 📚 Hierarquia de leitura — leia nesta ordem quando precisar

1. **`CONTEXTO_SESSAO.md`** — estado atual do projeto, decisões, próximos passos. **Sempre leia primeiro** ao começar uma sessão.
2. **`sprint-NN-NOME.md`** — playbook do sprint ativo (atualmente: `sprint-0B-infraestrutura.md`)
3. **`EspecificacaoTecnica_Modulo_Professores_CrossTainer_V1.md`** — spec técnica completa (16 seções + 4 matrizes). Consulte quando precisar de detalhe técnico de uma seção específica.
4. **`Proposta_Funcional_Consolidada_Modulo_Professores_CrossTainer_V3.md`** — requisitos funcionais (29 RFs, 23 RNs)
5. **`AgendaWireframes_design.html`** — wireframe aprovado pelo cliente. **Referência visual canônica** para implementação.

## 🚦 Protocolo de início de sessão

**Sempre:**
1. Ler `CONTEXTO_SESSAO.md` — especificamente a seção **🔖 ONDE PARAMOS** no topo
2. Identificar qual sprint está ativo
3. Ler o documento do sprint correspondente se existir
4. Confirmar com o usuário onde retomamos antes de executar qualquer ação

## ✏️ Protocolo de fim de sessão

**Sempre que houver mudança significativa:**
1. Atualizar `CONTEXTO_SESSAO.md` — seção **🔖 ONDE PARAMOS** + log da sessão
2. Atualizar status dos sprints na tabela
3. Se uma decisão foi tomada: atualizar tabela "Decisões M4 Resolvidas"
4. Se um arquivo foi criado/modificado: registrar no log

## 🛡️ Regras invioláveis

1. **Nunca alterar `index.html`, `commission.js`, `manifest.json` ou `sw.js` sem autorização explícita do usuário** — são código de produção em uso. Alterações cirúrgicas só quando estritamente necessário e sempre confirmando antes.

2. **Nunca commitar service accounts.** Já estão no `.gitignore`. Arquivos `serviceAccount-*.json` são credenciais privadas.

3. **Default dos comandos Firebase aponta para staging** (`.firebaserc`). Para deploy em produção: sempre `--project production` explícito.

4. **Não inventar lista de modalidades** — admin cadastra ao subir o sistema (decisão P01).

5. **`monthly_closings` com status='fechado' é IRREVERSÍVEL.** Security Rules + Cloud Function bloqueiam alteração.

6. **Dados salariais (`teacher_salaries`) — APENAS Admin.** Coleção separada justamente para isso. Nunca expor para outros perfis.

7. **🚨 PRODUÇÃO SÓ APÓS HOMOLOGAÇÃO COMPLETA EM STAGING.** Definido pelo usuário em 13/05/2026. Toda mudança nova (Security Rules, Cloud Functions, código de frontend) **DEVE** ser validada e homologada no projeto `crosstrainer-comissoes-staging` ANTES de qualquer `firebase deploy --project production`. Nunca propor "vamos subir em produção" sem antes confirmar que o staging foi validado e o usuário deu OK explícito. Nem mesmo para mudanças "pequenas".

8. **🏷️ NOME CORRETO DA MARCA é `CrossTainer` (sem o segundo "R" entre T e A).** Definido em 13/05/2026.
   - **CORRETO:** `CrossTainer` · `CROSSTAINER`
   - **ERRADO:** ~~`CrossTrainer`~~ · ~~`CROSSTRAINER`~~
   - Todo texto **visível ao usuário** em qualquer arquivo novo DEVE usar `CrossTainer` / `CROSSTAINER`.
   - IDs técnicos do Firebase (`crosstrainer-comissoes`, `crosstrainer-comissoes-staging`) **permanecem como estão** — são IDs estáveis e mudá-los seria caro/arriscado.
   - ✅ Branding dos arquivos de produção **corrigido em 12/06/2026** na branch (`index.html` 6 strings visíveis + `sw.js` header; `manifest.json` já estava certo) — vai pra produção junto com o módulo.
   - Wireframe `AgendaWireframes_design.html` tem o nome errado — não modificar (é referência do designer).

## 🧠 Estado atual em uma frase

**SISTEMA COMPLETO em staging (12/06/2026): 13 sprints + shell integrado + hub Pessoas + kit de homologação, tudo na branch `feature/shell-integrado` (não mergeada). Aguardando homologação do CLIENTE (roteiro publicado) → depois `docs/checklist-deploy-producao.md`.**

| Sprint | Entrega | Status |
|--------|---------|--------|
| 1 | Cadastro de Professores + Modalidades + Aba Salarial restrita | ✅ |
| 1.5 | `effectiveDate` no histórico salarial + VR/VT/Outros | ✅ |
| 2 | Agenda Semanal + slot livre + multi-select de dias | ✅ |
| 3a | Geração de aulas (CF cron) + Minha Agenda | ✅ |
| 3b | Agenda Geral + Substituições (direta + cobertura) + Notif in-app | ✅ |
| 4a | Fechamento Mensal + cálculo de horas + congelamento | ✅ |
| 4b | Pagamentos + Recibos (HTML print A4) + Crédito automático | ✅ |
| 5a | Escalas Especiais (peso variável) + Detecção auto de feriado (BrasilAPI) | ✅ |
| 6a | Férias e Recesso (workflow CLT, multi-período, CF pula classes) | ✅ |
| **6b** | **Pagamento de Férias (1/3 CLT efetivo + bolsa estagiário + rateio mês-a-mês + recibo)** | **✅ 16/16** |
| 6c | Controle Anual de Saldo (período aquisitivo CLT + painel admin + soft warning + alerta vencidas) | ✅ 12/12 + 3 visuais |
| **8** | **Relatórios e Exportações (4 relatórios em Excel + PDF, client-side, lazy load CDN)** | **✅ R1·R2·R3·R4** |
| **9** | **Polimentos Finais (branding CrossTainer + empty states + recibo R4 html2canvas + CDN fallback + migrations + vendor/)** | **✅ deployado** |
| **Shell** | **Navegação integrada: sidebar por domínio + seletor de módulo + home centro de pendências + deep-links (sessão 32)** | **✅ validado** |
| **Hub** | **Hub Pessoas: cadastro unificado (união `teachers`⊕`users`), wizard, ficha 4 abas gated, `admin_gestao` DROPADO (sessão 33)** | **✅ REST 8/8 · UI 9/9** |
| **Entrega** | **Check geral (3 bugs corrigidos) + branding index.html + sw v3.1 + cache 5min + seed demo + manuais + roteiro (sessão 33)** | **✅ publicado** |

**Próxima ação:** cliente homologa pelo `roteiro-homologacao.html` no staging (acessos de demo: `dono.teste@` e `professor.teste@crosstainer.com`). Aprovado → executar `docs/checklist-deploy-producao.md` (2 decisões pendentes lá: antecedência de férias 5→30 dias · destino da tela legada de Usuários). **Compromisso pós-aprovação: visão do professor otimizada pra celular.**

## 🔧 Tech debt registrado (não bloqueia)

1. **Classes legadas em UTC midnight** (pré-Sprint 17 bug D fix): ✅ Migração aplicada em staging (18 classes, +3h). Produção nunca teve esse bug.
2. ~~`sw.js` cacheia agressivamente `professores.*`~~ ✅ **RESOLVIDO (12/06, autorizado):** sw v3.1 — JS same-origin é network-first; CDNs seguem cache-first. Cache de JS/CSS do hosting também caiu de 7 dias → 5 min (`firebase.json`).
3. **Audit log entries antigas** (Sprint 2/3a/3b) com `module: 'professores'` em vez de `'agenda'`: ✅ Migração aplicada em staging (35 entries, `professores` → `agenda`). Production mantém entries legadas.
4. **CDN externo como dependência** (Sprint 8): ✅ Fallback local em `/vendor/` (5 libs) + CDN como backup.
5. **CreditService race condition rara** no abate de créditos: aceito como tech debt (1 admin por vez em produção realística).
6. **Cross-region warning** (CFs em `us-central1`, triggers de Firestore default em `sa-east1`): cosmético, sem impacto funcional.
7. **Critérios 5/6 da Sprint 4a** (estagiário com/sem excedente) seguem sem validação direta — sem estagiário com aulas em staging.

## 🐛 Bugfix em produção (Comissões)

- Commit `6f0a15b` no `main` — regex word-boundary em `commission.js` corrige detecção de BIANUAL (era sobrescrita por ANUAL via substring). Identificado em prod com Isabella Haise · PP · Abr/2026 (Augusto César +R$ 35). Migração de 1 registro feita.
- Pendência: rodar audit BIANUAL legacy em outros meses/unidades (4 casos identificados em CP Abr não migrados).

## 🔐 Hotfix de segurança em produção (15/06/2026)

Falha real fechada: a regra de `/users` create em prod permitia `request.auth.uid == userId` → demitido com login Auth ativo recriava o próprio perfil como **admin** pelo form de recuperação. Confirmado explorável (Firebase Rules Test API).

**Deployado em prod:** regra `/users` → `allow create: if isAdmin();` (patch mínimo sobre as regras VIVAS de prod, ruleset `01538012…`) + frontend (`origin/main` `6f0a15b`→`02e0909`): `createUser`/`activateUser` gravam como admin (app secundário); form de recuperação neutralizado. Efeito: "Remover" + a regra já bloqueiam o acesso ao app sem o Console. Disable real do Auth = CF, fica pro módulo.

**⚠️ Pré-deploy do módulo:** a branch já tem o port equivalente (`2eed9d6`), mas `origin/main` ganhou `02e0909` que o `main` local NÃO tem (o `main` local está 26 commits à frente de `origin/main` = o módulo inteiro, não publicado). **Reconciliar antes de subir o módulo.** Detalhes: `docs/checklist-deploy-producao.md` + memória `hotfix-users-create-rule.md`.

Para detalhes completos: leia `CONTEXTO_SESSAO.md` (seção 🔖 ONDE PARAMOS).
Para visão técnica: leia `DOCUMENTACAO.md`.
Para índice do projeto: leia `README.md`.

## 🇧🇷 Idioma

Conversar em português brasileiro. Comentários em código também em português.
