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
   - Arquivos de produção atuais (`index.html`, `manifest.json`) com o nome errado serão corrigidos no momento do deploy do módulo de Professores em produção — registrado em `CONTEXTO_SESSAO.md` como pendência.
   - Wireframe `AgendaWireframes_design.html` tem o nome errado — não modificar (é referência do designer).

## 🧠 Estado atual em uma frase

**11 sprints implementadas em staging (07/06/2026, sessão 24). Sprint 6c deployada, aguardando validação do cliente. Projeto ~97% completo.**

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
| **6c** | **Controle Anual de Saldo (período aquisitivo CLT + painel admin + soft warning + alerta vencidas)** | **✅ 12/12 + 3 visuais** |

**Próxima ação:** **Sprint 8 — Relatórios e Exportações.** Playbook completo em `sprint-8-relatorios-exportacoes.md` (~900 linhas, 7 etapas, 12 critérios, 5 snippets-chave). Escopo: 4 relatórios (Fechamentos Mensais · Saldos de Férias · Horas por Professor · Recibos em Lote) em Excel + PDF, 100% client-side. Bibliotecas via CDN: SheetJS · jsPDF · jsPDF-autotable · JSZip. Decisões fixadas: ambos formatos desde início, geração browser, audit log de cada export. Instruções pro time em `docs/superpowers/specs/2026-06-07-sprint-8-instrucoes.md`. Estimativa: ~7-8 dias úteis. **Deploy em produção só ao fechar TODAS as sprints** — não fazemos sprint-a-sprint em prod.

## 🔧 Tech debt registrado (não bloqueia)

1. **Classes legadas em UTC midnight** (pré-Sprint 17 bug D fix): em produção não acontece (geração sempre BR após fix); em staging legado alguns filtros novos (apply-scale, regenerate) não casam. Migration opcional: +3h em `scheduledDate` das classes pré-fix.
2. **`sw.js` do módulo Comissões cacheia agressivamente** arquivos de `professores.*`. Workaround em dev: DevTools → Application → Service Workers → Unregister + Clear site data. Fix estrutural (excluir `professores.*` do scope) requer autorização explícita pra tocar no sw.js (regra inviolável #1).
3. **Cross-region warning** (CFs em `us-central1`, triggers de Firestore default em `sa-east1`): cosmético, sem impacto funcional.
4. **Audit log entries antigas** (Sprint 2/3a/3b) com `module: 'professores'` em vez de `'agenda'`: bug corrigido na sessão 17, entries novas saem corretas. Migration retroativa = backlog.
5. **CreditService race condition rara** no abate de créditos: aceito como tech debt (1 admin por vez em produção realística).
6. **Critérios 5/6 da Sprint 4a** (estagiário com/sem excedente) seguem sem validação direta — sem estagiário com aulas em staging.

## 🐛 Bugfix em produção (Comissões)

- Commit `6f0a15b` no `main` — regex word-boundary em `commission.js` corrige detecção de BIANUAL (era sobrescrita por ANUAL via substring). Identificado em prod com Isabella Haise · PP · Abr/2026 (Augusto César +R$ 35). Migração de 1 registro feita.
- Pendência: rodar audit BIANUAL legacy em outros meses/unidades (4 casos identificados em CP Abr não migrados).

Para detalhes completos: leia `CONTEXTO_SESSAO.md` (seção 🔖 ONDE PARAMOS).
Para visão técnica: leia `DOCUMENTACAO.md`.
Para índice do projeto: leia `README.md`.

## 🇧🇷 Idioma

Conversar em português brasileiro. Comentários em código também em português.
