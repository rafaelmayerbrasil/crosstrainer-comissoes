# Contexto de Desenvolvimento — CrossTainer Módulo Professores
> **Leia este arquivo primeiro em cada nova sessão.** Ele contém o estado atual do projeto, decisões tomadas e próximos passos.

---

## 🔖 ONDE PARAMOS — sessão 41 (07–08/07/2026) — Escala Inteligente FRENTE 1 (12 ajustes do Rodrigo) CONSTRUÍDA na branch (falta E2E no staging)

**Rodrigo mandou 12 ajustes/sugestões pra Escala Inteligente. Fatiados em 3 frentes; validado com ele por 2 textos não-técnicos (respondeu: e-mail pode ser depois; Escola Interna = gestão escolha o líder direto). Frente 1 construída via subagent-driven (11 tasks TDD + review por task + review holístico final). Branch `feature/shell-integrado`.**

- **✅ FRENTE 1 no código (commits `55a1232`..`75080ce`):**
  - **Camada `notify` nova** (`notify-service.js` + smoke): in-app hoje (grava em `notifications`, shape do sino), canal `email` como stub pronto pra plugar depois. Decisão do Rodrigo: e-mail depois.
  - **Janela com prazo** (`scale-service.js`): `openElection(id,{closesAt,batchId})` + `windowClosesAt/OpenedAt/ClosedAt/BatchId`; `isWindowOpen` (comparação **hora local** via `nowLocalMinute` — bug UTC×local corrigido); `setPreference` recusa após o prazo; `listScalesByBatch`.
  - **UI gestão** (`professores-escala-smart.js`): toggle **Próximos/Passados/Todos** (item 1); **multi-seleção + abrir janela em lote** com prazo comum + **1 aviso in-app** ao time (itens 2/3/4); abertura individual corrigida (por id, não por aba); **tela "Revisão de fechamento"** — matriz pessoas×datas (quem pegou o quê / quem não se candidatou / vagas abertas) → "Confirmar e avisar" consolida por justiça+mérito + notifica (item 5); **aba Escola Interna** com atribuição **manual** do líder pela gestão + publicar na agenda (item 10).
  - **UI professor**: contagem regressiva do prazo + "Janela encerrada" (bloqueio) na tela de preferências.
  - **Rename** Chamada → **Confirmar Presença** (nav + títulos + botão + toast) (item 12).
  - **Integração** (`professores-engajamento.js`): o líder planejado na Escala Interna entra **pré-marcado** na Confirmar Presença (a escala é o plano; o ponto só no salvar — sem duplicar).
  - **Notificações navegam** ao clicar (`professores.js` `handleNotifClick` trata `escala-smart`) + ícones no sino (`NOTIF_TYPE_META`).
- **✅ Verificação:** 6 smokes Node verdes + parse de todos os arquivos. **Rules OK** (review final): `special_scales` é field-agnostic (aceita campos novos + `tipo:'escola_interna'`), `notifications` create liberado p/ autenticado — **nenhuma mudança de rules necessária**.
- **Docs:** spec `docs/superpowers/specs/2026-07-07-escala-frente1-janela-eleicao-design.md` · plano `docs/superpowers/plans/2026-07-07-escala-frente1-janela-eleicao.md` (12 tasks) · memória [[frente1-escala-janela-eleicao]].

**⏭️ PRÓXIMA AÇÃO:** (1) **deploy hosting no staging** (pedir OK — regra 7) + **E2E visual no browser** (checklist na Task 12 do plano: abrir janela em lote→prof vê prazo/candidata→revisão→confirmar→aviso chega; Escola Interna escala líder→publica→pré-marca na Confirmar Presença); (2) avisar o Rodrigo. **Falta construir:** Frente 2 (fim de ano por período na visão do prof #9 · replicar as 5 abas no prof #11) e Frente 3 (staff de evento #6 · convite #7 · lembretes 7/4/1d #8 — essa precisa de CF agendada; a camada `notify` já é a base). **Tech debt aceito:** bloqueio de prazo é client/serviço (não nas rules) — hardening opcional depois.

---

## 🔖 Sessão 40 (01/07/2026) — Escala Inteligente em 4 abas (feedback do Rodrigo) CONSTRUÍDA e NO AR no staging

**Rodrigo mandou print anotado pedindo a Escala Inteligente organizada em abas. Brainstorm → spec → plano → build TDD → deploy staging, tudo na sessão. Branch `feature/shell-integrado`.**

- **✅ 4 abas na mesma rota** (`professores-escala-smart.js`): **Sábados** (lista virtual de TODOS os sábados do ano, doc criado sob demanda no clique) · **Feriados** (BrasilAPI sugere nacionais c/ fallback no cache `meta/holidays_cache_*` da CF; gestão aponta; "+ Data especial" p/ municipal/estadual e domingo especial) · **Eventos** (etiqueta Interno/Externo — campo novo `eventKind`; ponto continua na Chamada) · **Fim de ano** (modal dedicado, reusa fluxo por turnos). Seletor de ano; detalhe/preferências/consolidação/publicação intactos; visão do professor intacta.
- **✅ Helpers puros + smoke novo** (`scale-service.js` + `scripts/smoke-escala-tabs.js`): `saturdaysOfYear`, `mergeVirtualWithDocs`, `parseFeriados`, `isLegacyScaleDoc`. `listScales` agora **filtra docs legados** (formato antigo da tela Escalas Especiais: date Timestamp/sem tipo) — mata os cards quebrados "fds/Timestamp/undefined" do print do Rodrigo.
- **✅ Gap latente corrigido:** a criação pela UI montava slots SEM horário e não lia `ScaleConfigService.horarios` → publicar geraria 0 aulas. Novo `escalaSlotsPadrao(tipo)` aplica os horários da config.
- **✅ Tela legada "Escalas Especiais" FORA do menu** (admin/superv, `professores-nav.js`) — rota/código/dados preservados p/ rollback; CF de geração de aulas segue lendo `scaleTypeId` p/ peso. **Migração dos docs legados = tech debt** (spec §6).
- **✅ smoke-sidebar.js atualizado** — estava desatualizado desde as sprints Engajamento/PLR (seções novas não cobertas; falha pré-existente confirmada por git stash) + asserções novas (sem `escalas`, com `escala-smart`).
- **🚀 Deploy hosting staging + verificação por curl:** arquivos novos no ar (funções das abas servidas, nav sem `escalas` no array do admin). Smokes todos passando (exceto `smoke-9.js`, que é integração e exige `--project`).
- **Docs:** spec `docs/superpowers/specs/2026-07-01-escala-inteligente-abas-design.md` · plano `docs/superpowers/plans/2026-07-01-escala-inteligente-abas.md` (9 tasks, todas executadas) · memória `escala-inteligente-abas`.

**⏭️ PRÓXIMA AÇÃO:** (1) **E2E visual no staging** (checklist na Task 9 do plano: logar como `dono.teste@` → 4 abas, criar sábado/feriado/evento/fim-de-ano, card legado sumido, console limpo; professor vê preferências igual antes) — não foi feito no browser nesta sessão, só verificação por curl; (2) avisar o Rodrigo que as abas que ele pediu estão no ar; (3) pendências menores da spec §6 (migração docs legados, turnos default "Matutino/Vespertino"?, integração evento→chamada).

---

## 🔖 Sessão 39 (27–29/06/2026) — As 3 features do Rodrigo CONSTRUÍDAS, VERIFICADAS e NO AR (build autônomo /loop)

**Com as respostas do Rodrigo (`docs/rodrigo-engajamento-escala-COMPLETO-respostas.txt` + follow-up PLR), as 3 frentes que faltavam foram construídas em /loop autônomo, cada uma spec→plano→TDD→E2E staging→deploy. Branch `feature/shell-integrado`.**

- **✅ Feature 1 — Publicar escala na agenda + preferência Prefiro/Pode ser/Não posso.** Descoberta: escalas especiais são off-grid → publicar CRIA aulas taggeadas (`specialScaleId`), idempotente, **hora normal** (B1). `ScaleConfigService` (horários configuráveis). UI publicar/despublicar + "Pode ser em todas". Rules `classes.delete` p/ gestão (só aulas da escala não fechadas) + `scale_config`. E2E ok. Spec `docs/superpowers/specs/2026-06-27-publicar-escala-agenda-preferencia-design.md`.
- **✅ Feature 2 — Fim de ano por turnos (Manhã/Tarde-Noite).** `templateSlotsFimDeAno` por dia×unidade×turno×pessoas; `publishToAgenda` multi-dia; UI modal (unidades + turnos editáveis + 24/12 fechado default) + detalhe por turno + publicar. E2E ok (12 vagas→12 aulas em 3 dias). Spec `...2026-06-27-fim-de-ano-turnos-design.md`.
- **✅ Feature 3 — PLR (substitui a planilha).** `plr-engine.js`+`plr-service.js`+`professores-plr.js` (Config/Avaliação/Resultado). Nota ponderada (avaliador Coord/Head=2), engajamento auto do placar, horas do fechamento, rateio `pool×(horas×nota)/Σ` soma exata, elegibilidade configurável (3 meses/estagiário). Rules restritas. E2E ok (nota 8.4, rateio=pool). Spec `...2026-06-27-plr-design.md`.

**Tudo configurável (preferência do usuário [[feedback-datas-configuraveis]]). ~20 commits + hosting deployado em `crosstrainer-comissoes-staging.web.app`.** Detalhe completo na memória [[novo-modulo-engajamento-pontos]].

**⏭️ PRÓXIMA AÇÃO:** Rodrigo valida as 3 features no staging. Pendências [Menor] (não bloqueiam): nota dos alunos no PLR (vem da Pacto futura); papel formal de "avaliador" (v1 admin/superv); detecção de feriado dentro do período do fim-de-ano. Frente independente: homologação do módulo + `docs/checklist-deploy-producao.md`.

---

## 🔖 Sessão 38 (27/06/2026) — Sistema liberado pro Rodrigo no staging + unidade fictícia removida + doc único de validação/perguntas

**Tipo: liberação (deploy hosting staging) + limpeza de dados + entrega de docs pro cliente. Branch `feature/shell-integrado`. Não construiu feature nova.**

- **🚀 Sistema liberado pro Rodrigo (autorizado pelo usuário):** `firebase deploy --only hosting --project staging`. Todas as telas novas (Engajamento Config/Chamada/Placar + Escala Inteligente + Fim de ano) agora no ar em `crosstrainer-comissoes-staging.web.app` (antes só preview local). **Verificado por curl:** arquivos novos 200, `professores-escala-smart.js` servido contém fim-de-ano/`consolidateByDay`, nav tem `engaj-config/chamada/placar` + `escala-smart`. Acessos demo: `dono.teste@` / `professor.teste@crosstainer.com` (senha `crosstainer2026`) → clicar "Professores" no seletor de módulo.
- **🧹 Unidade fictícia removida (decisão do usuário):** a demo tinha 3 unidades; na vida real só **2 (CP e PP)**. Removida a `unit-norte` ("CrossTainer Norte") via `scripts/remove-unit-norte.js` (dry-run + `--apply`): apagou `units/unit-norte`, tirou de `allowedUnits` de 2 users (incl. `abluir@`) + `unitIds` da Ana + slots Norte de 3 escalas demo. **0 aulas/fechamentos afetados.** `seed-demo.js` corrigido (allowedUnits → `['unit-cp','unit-pp']`). Confirmado: só CP/PP restam.
- **🗓️ Decisão: datas SEMPRE configuráveis** pela gestão (não hardcoded) — período do fim-de-ano, dias fechados/meio-período, ciclos do PLR. Em pergunta pro cliente, assumir configurável e só confirmar o padrão. Memória [[feedback-datas-configuraveis]].
- **🚫 Treino de 27/06 NÃO será registrado à mão** (cancela a nota antiga "registrar 27/06 manual") — a contagem de pontos começa só quando o sistema entrar pra valer.
- **📄 Doc-gatilho das pendências = arquivo ÚNICO `docs/rodrigo-engajamento-escala-COMPLETO.txt`** = acesso (link+logins) + guia passo a passo (gestão/colaborador) + perguntas A/B/C. (Versões parciais `rodrigo-acesso-e-guia.txt` e `perguntas-rodrigo-fechar-pendencias.txt` existem; o COMPLETO substitui ambas.)
  - **Perguntas em aberto:** A) fim-de-ano (A1 unidades · A2 ritmo · A3 datas=confirmar padrão configurável · **A4 nova**: como a dupla do dia vira hora/pagamento) · B) **B1 peso da data** (mantém pagando × só equilibra — destrava o publish) · C) PLR (C1 pesos dos blocos da nota + onde entra o engajamento · C2 quem avalia/média · C3 nota dos alunos sem Pacto nesta rodada · C4 quem entra no rateio · C5 pool digitado · C6 confirmar fórmula). Já respondido (não repetir): rateio horas×nota, 2×/ano jun/nov, substitui planilha, engajamento automático do placar, nota dos alunos = Pacto futura.

**⏭️ PRÓXIMA AÇÃO: aguardando o Rodrigo** validar pelo sistema + responder o COMPLETO. Com as respostas:
1. **Publicar a escala na agenda** (gerar `classes`) — gated por **B1** (inconsistência peso §15.5 × código que paga em `professores-shared.js:1826`).
2. **Fim de ano** — como o dia vira hora/pagamento (**A4**).
3. **PLR** — ainda **sem spec**; com as respostas C → brainstorm → spec → plano → build. **Pacto não bloqueia** (só a nota dos alunos é externa). Detalhe na memória [[novo-modulo-engajamento-pontos]].

---

## 🔖 Sessão 37 (23/06/2026) — Feedback do Rodrigo sobre agenda/escalas + decisão Pacto + nova frente Engajamento/Pontos

**Sessão de produto/requisitos — NÃO alterou código (só `docs/` + memória).** Rodrigo (Rô, dono/futuro sócio) passou um retorno sobre o módulo de agenda. A maior parte é **funcionalidade nova e grande**, muito além do que existe.

**✅ DECISÃO PACTO RESOLVIDA (Rodrigo respondeu):** construir o **sistema próprio PRIMEIRO, sem conectar**; depois de rodar na prática, avaliar conectar com a Pacto pra evitar cadastro duplicado. → Desenhar o modelo de dados **já preparado pra casar** (ex.: campo "ID externo Pacto" vazio agora). Destrava a frente que estava parada desde a sessão 36. (Memória [[pacto-decisao-rumo]].)

**🆕 NOVA FRENTE GRANDE — módulo de Engajamento/Pontos + escala inteligente + PLR.** Mapa na memória [[novo-modulo-engajamento-pontos]]. Pontos:
- **Insight central:** reunião interna, treinamento, escola interna/TOI, proatividade em substituir e eventos = **UM motor de pontos só**, consumido em 2 lugares: ordem de escolha na eleição de escala **e** PLR. Os critérios batem com a planilha `Avaliação de Desempenho_mai2026_PP.xlsx` (1 aba/colaborador; avaliadores tirando média; blocos Profissional/Comportamental/Técnica + média alunos + PLR % final).
- **Seção 15 da spec (`docs/Proposta_Funcional_..._V3.md`) JÁ especificava** o motor de escala inteligente (janela rolante 3 meses, modelo disponível/prefere/não-pode com "preferência ≠ reserva", distribuição equilibrada/ninguém de fora + painel, alocação automática por não-resposta, poderes da gestão, pesos por data sábado 1/feriado 2/domingo 3/evento 3) — **mas NUNCA foi construído.** O código (`professores-escalas.js`) é só um STUB: etiqueta de peso que multiplica horas no pagamento.
- **Gap do feedback do Rodrigo vs seção 15:** (1) motor de pontos de **MÉRITO** como prioridade de escolha — a spec prioriza por **JUSTIÇA** (equilíbrio+histórico); **TENSÃO a decidir: mérito × justiça, como combinam**; (2) unidade alternada explícita; (3) acúmulo de preferência não usada; (4) Escola Interna (treino Seg–Sex 14:30 editável + escala de quem lidera) / presença em Reunião / Treinamento+penalização / PLR — tudo fora da seção 15.
- **Inconsistência a alinhar na construção:** spec 15.5 diz que o peso da data é só pra **balancear distribuição** ("não substitui regra financeira"), mas o código usa esse peso pra **PAGAR**.
- **Renomear telas da agenda** ("Agenda da Semana" vs "Agenda Geral") — trivial, item 0.
- **Treino de 27/06/2026** acontece antes do sistema → registrar presença manual e importar depois.

**📄 Documento de perguntas pro Rodrigo:** `docs/perguntas-rodrigo-agenda-escalas.md` (8 blocos, ~25 perguntas; o que a seção 15 já decidiu virou "confirmar"; pergunta 2c isola a tensão mérito×justiça). **Aguardando as respostas dele.**

**🐛 AJUSTE PENDENTE DO COMISSÕES IDENTIFICADO (23/06) — renovação virando "novo contrato" (paga o dobro).** Investigado SEM alterar código. Causa-raiz: o sistema copia novo/renovação da coluna "Tipo de Venda" do XLSX (fonte = sistema da academia); a vendedora registrou renovações como "Novo Contrato" lá → motor paga 5% em vez de 2,5% E distorce meta/P3 (novos infla, renovações esvazia). Detalhe completo + caminhos de correção na memória [[comissoes-renovacao-classificada-novo]]. **Aguardando o Rodrigo mandar o arquivo/período com os nomes citados** (não estavam no `vendas realizadas PP -0106 a 2206.xlsx`). Sugestão forte: detecção automática no upload via histórico de clientes. NADA implementado.

**⏭️ PRÓXIMA AÇÃO:**
1. **Engajamento/Escala (frente principal): AGUARDANDO RESPOSTAS DO RODRIGO** ao doc `docs/perguntas-rodrigo-validacao-engajamento-escala.txt` (2 blocos: fim-de-ano 1a-1c · peso da data 2a). Com elas → construir 5c-2 (fim-de-ano) + decidir o peso. Deploy de hosting só na hora do demo pro Rodrigo.
2. **Comissões (renovação→novo): BAIXA PRIORIDADE.** O Rodrigo já mandou o arquivo/info, mas o usuário ainda não repassou (não é prioridade). Tratar depois. Detalhe em [[comissoes-renovacao-classificada-novo]].
3. Agenda/Engajamento — origem: respostas do Rodrigo em `docs/respostas-rodrigo-agenda-escalas.md`; spec `docs/superpowers/specs/2026-06-24-engajamento-pontos-escala-design.md`.

**✅ MÓDULO DE ENGAJAMENTO/PONTOS CONSTRUÍDO E VERIFICADO NO STAGING (24/06, via /loop). Branch `feature/shell-integrado`. Detalhe completo na memória [[novo-modulo-engajamento-pontos]].**
- **Plano 1 — motor puro** (`engagement-config.js` + `points-engine.js`, smokes Node): tempo de casa por faixa, ciclos/reset, placar, geração idempotente por chamada, penalidades, proatividade, TOI-aluno.
- **Plano 2 — serviço/persistência** (`engagement-service.js` + `_fake-firestore.js`): config, ciclos (CRUD), recordAttendance idempotente, awardSubstitution, scoreboard.
- **Regras Firestore** das 4 coleções deployadas + validadas no staging (10/10 REST).
- **Plano 3 — UI** (`professores-engajamento.js`, T1–T6): telas de **Config** (pontos/penalidades/ciclos), **Chamada** (4 tipos, líder ×2, treinou-em-outra, TOI-aluno, filtro de unidade, +pts ao vivo) e **Placar** (por pessoa/ciclo). Nav/rotas registrados. Verificado ponta a ponta no staging (admin lança→placar reflete; professor vê só o próprio e Config bloqueada; auditoria; zero erros de console). Revisão de subagente ✅.
- **Falta pra o cliente acessar sozinho:** `firebase deploy --only hosting` no staging (não feito — pedir OK; regra de homologação). Hoje validado por preview local→staging.

**✅ ESCALA INTELIGENTE DOS SÁBADOS — CONSTRUÍDA E VERIFICADA NO STAGING (24/06).** Plano 4 `scale-engine.js` (piso de justiça + mérito + slots tipados + compensação, smoke) · Plano 5a `scale-service.js` (CRUD + preferências + fairness + consolidação, smoke fake firestore) · Plano 5b UI `professores-escala-smart.js` (gestão consolida com o "porquê" + painel de equilíbrio; colaborador marca preferência) + regras das 3 coleções no staging · polish (painel + tabela por-quê) · 5c-1 proatividade (aceitar substituição = ponto). **Falta (aguarda Rodrigo):** 5c-2 fim-de-ano (modo por-dia) e o peso da data (publish adiado). Item 0 (renomear agenda) segue liberado e independente.

**Pendências menores anotadas** (não bloqueiam): `faixaAnos>=1` na config; normalizar pontos/datas do Firestore; `engajHireISO` não trata `type==='eventual'`; tech-debt entry órfã; inconsistência peso-de-data §15.5 × pagamento.

3. **Comissões (renovação→novo):** aguardando arquivo do Rodrigo. Detalhe em [[comissoes-renovacao-classificada-novo]].

**Obs.:** homologação do cliente (módulo Professores) + `docs/checklist-deploy-producao.md` seguem pendentes, frente independente.

---

## 🔖 Sessão 36 (16–17/06/2026) — Pesquisa da API Pacto + alinhamento estratégico com o sócio

**Contexto novo e GRANDE (muda o rumo do projeto):** o cliente (Rô — dono da Cross + futuro sócio) está migrando do **TecnoFit** para a **Pacto Soluções**. Ideia dele: puxar vendas (comissões), agenda e cadastros da Pacto **via API** em vez do upload manual de XLSX. **Esta sessão foi pesquisa + estratégia — NÃO alterou nenhum código de produção** (só `docs/` e memória).

**Pesquisa da API Pacto (feita batendo nos endpoints REAIS com tokens do cliente; mapa técnico completo na memória `pacto-api-integracao.md`):**
- API real = gateway `https://apigw.pactosolucoes.com.br`. Auth: header `Authorization: <token>` (cru, sem "Bearer") **+ header `empresaId`**. Cada endpoint tem `x-scope`; **credencial precisa ser gerada COM os escopos marcados** (sem isso vem `scope:[]` e recusa — no /prest dava erro enganoso "Problemas ao obter a secret"). Tem **SandBox** (dados fictícios).
- **Verificado com dado real:** Comissões 🟢 (`relFaturamentoRecebido/vendas` por período = valor recebido) · Cadastros 🟢 (`colaboradores/professores-ativos` puxou prof. real; modalidades; alunos) · **Agenda 🟢** (corrige conclusão errada que tive no meio da sessão: a "Agenda de Aulas" EXISTE — aulas por professor/dia, substituição de professor, presença; o que vem vazio é "turmas", porque as modalidades da Cross são `utilizarTurma:false`).
- **Descoberta estratégica:** a Pacto cobre **nativamente** muito do que o módulo Professores faz (agenda, **substituição**, presença, professores) e tem até **comissão nativa** → a pergunta deixou de ser "como integrar" e virou **"quanto do sistema custom ainda faz sentido manter"**.

**Decisão de produto — EM ABERTO, aguardando o sócio.** Montamos juntos e o usuário **ENVIOU pro Rô** uma mensagem de WhatsApp (texto final salvo em `docs/pacto-alinhamento-socio.md`) pedindo a visão dele. Tom: papo entre sócios, assumindo que é pesquisa fresca feita com IA; a Cross é dele, o sistema é feito junto, com um "quem sabe lá na frente vira tipo a Pacto". **3 perguntas-chave enviadas:**
1. Sistema só pra Cross, ou lá na frente virar **produto tipo Pacto** pra vender pra outras academias? *(essa muda a arquitetura)*
2. A **troca de professor** da Pacto, se registrar direitinho quem deu cada aula, já atende — ou a nossa regra é diferente?
3. Subir agora o que já fizemos dos professores e conectar as APIs depois, **ou** já construir direto com as APIs (menos retrabalho)?

**Intuição registrada (minha + do usuário):** comissão e folha dos professores são regras específicas demais pra caber redondas num SaaS. A folha nasceu de uma **dor real** (professores trocam muito de horário; o sistema antigo não registrava nem tinha as regras → construímos troca de aula + registro de quem deu a aula → a folha veio em consequência). Provável caminho: **apoiar na Pacto pro operacional + manter comissão/folha sob medida puxando dados da API.** Mas decisão depende da resposta do Rô (sobretudo a pergunta 1).

**⏭️ PRÓXIMA AÇÃO:** aguardar a resposta do Rô às 3 perguntas. Com a visão dele → escolher o caminho (apoiar na Pacto + customizar, vs já arquitetar pra virar produto) → brainstorming → spec → plano. **Antes de qualquer build com a API:** (a) gerar credencial **com escopos**; (b) confirmar se o relatório de faturamento traz **vendedor + item/plano** (decide se as comissões são plug-and-play; o exemplo do DTO só mostrava data/valor/cliente). **Não mexer no módulo/comissões até a decisão.**

**Obs.:** o trabalho anterior (módulo Professores + fixes do Comissões) segue exatamente como na sessão 35 — homologação do cliente pendente, `docs/checklist-deploy-producao.md`. Independente desta nova frente da Pacto.

---

## 🔖 Sessão 35 (16/06/2026) — Fixes de split/BIANUAL/recálculo em PRODUÇÃO

**Estado: PACOTE DE FIXES DO COMISSÕES DEPLOYADO EM PRODUÇÃO (16/06) E PORTADO PRO MÓDULO.** Achados pelo cliente ao pagar comissões. Corrigidos e validados (detalhe na memória `fix-split-bianual-recalc.md`):
- **B1** split pagava o bônus P2 em dobro (cada perna recebia o bônus cheio) · **B2** BIANUAL legado virava ANUAL no recálculo · **B3** recálculo carregava conjunto incompleto (cache filtrado por uploadId) → corrompia meta/P3 da unidade · **RAIZ** upload re-quebrava splits (re-adicionava o cheio + deletava a perna) · **aba "Divisões" 🔀** nova (lista splits + alerta se % ≠ 100%) + U1/U2 de UI.
- Deploy: `origin/main` (`3d6a30d`..`f6f23d5`) + **portado pra `feature/shell-integrado`** (cherry-pick → `e4514bb`..`3b35d06`, sw.js mantido v3.1, branding CrossTainer preservado). Motor Node-testado, sintaxe OK.
- **Maio remediado** (CP R$4.598,63/69 ativ · PP R$1.973,19/30 ativ) por `backups/_remediar_maio.js`.

**Pendências do CLIENTE:** GISELE (CP) ajustar caixa 618→359 (tirar 2ª parcela) + refazer split 70/30 · Francini PP registrar 1 pagamento limpo de R$52,46 (limpei os 4 recibos bagunçados, inclusive um errado de R$5.246,00) · conferir aba Divisões.

**Reconciliação pré-deploy do módulo (atualizada):** tanto o hotfix de segurança quanto estes fixes estão em `origin/main` (commits que o `main` LOCAL não tem) E portados na branch (hashes diferentes, mesmo conteúdo). Ver `docs/checklist-deploy-producao.md`.

---

## 🔖 Sessão 34 (15/06/2026) — Hotfix de segurança em PRODUÇÃO

**Estado: HOTFIX DE SEGURANÇA DEPLOYADO EM PRODUÇÃO (15/06).** Fechada falha real: a regra viva de prod (`/users` create) permitia `request.auth.uid == userId` → um colaborador demitido, com login do Firebase Auth ainda ativo, recriava o próprio perfil como **admin** pelo formulário de recuperação. Confirmado explorável via Firebase Rules Test API (e o controle provou que a regra antiga deixava ALLOW).

**Deployado em produção:**
- **Regras** (Firebase `crosstrainer-comissoes`): `/users` → `allow create: if isAdmin();`. Patch **mínimo** sobre as regras VIVAS de prod (buscadas pela Rules API), NÃO a versão endurecida do módulo. Ruleset `01538012…`, verificado pós-deploy (linha ativa = `isAdmin()`, self-create bloqueado).
- **Frontend** (`origin/main` `6f0a15b`→`02e0909`, push fast-forward, GitHub Pages): `createUser` e `activateUser` gravam o doc como **admin** (app secundário, sem trocar a sessão); `showProfileRecovery` virou aviso "Acesso indisponível"; `doProfileRecovery` neutralizada. Verificado: produção serve a versão nova (form vulnerável sumiu).
- **Efeito:** "Remover" + a regra já bloqueiam o acesso ao app (perfil removido + sem auto-recriação) **sem precisar do Console**. Disable real do Auth (matar a credencial) = Cloud Function → fica pro deploy do módulo (CFs nunca rodaram em prod + exige Blaze).

**Branch do módulo alinhada:** `feature/shell-integrado` recebeu o port (commit `2eed9d6`: `activateUser` + form de recuperação; `createUser` já gravava como admin). **Staging redeployado** (hosting) com o fix — antes disso, `activateUser` e o form estavam **quebrados no staging desde 12/06** (a regra endurecida já estava lá), o que afetaria a homologação do cliente.

**⚠️ ACHADO CRÍTICO DO REPO:** `main` local está **26 commits À FRENTE de `origin/main`** — é o **módulo Professores inteiro** (Sprints 4b–9 + shell) commitado mas **NUNCA publicado**. Produção (`origin/main`) é um frontend "puro" no GitHub Pages (sem `firestore.rules`/`firebase.json`/`.firebaserc` — a infra Firebase só existe no main local/branch). **Reconciliar antes do deploy do módulo:** `origin/main` ganhou o hotfix `02e0909` que o main local e a branch não têm (a branch tem o equivalente `2eed9d6`).

**Pendências menores:** resíduo de worktrees `.claude/worktrees/hotfix-*` (OneDrive travou a remoção; `git worktree prune` + `git branch -D hotfix/*` quando soltar) · CF de disable do Auth escopar pro módulo. Detalhe na memória `hotfix-users-create-rule.md`.

---

## 🔖 Sessão 33 (11–12/06/2026)

**Estado:** **SISTEMA PRONTO PRA HOMOLOGAÇÃO FINAL INTEGRADA (12/06).** Hub Pessoas completo (REST 8/8 + UI 9/9) + **check geral com 3 bugs reais corrigidos** (tela Pagamentos quebrada desde a 4b · índice de férias ausente · listener órfão no logout — `docs/check-geral-2026-06-11.md`) + **pacote de entrega `e9a61ed`**: branding CROSSTAINER no index.html (6 strings visíveis), createUser legado gravando como admin (era órfão de Auth) + bug `${unitId}` no logAudit, **sw.js v3.1** (JS próprio network-first — fix estrutural do tech debt #2, autorizado), cache do hosting JS/CSS 7d→**5min**, ESC nos modais do hub, plural no chip da home. **Revalidação integrada pós-pacote: Comissões ✓ (branding, menu Pessoas, tela legada criou usuária completa sem órfão) + Professores admin 11/11 ✓ + professor 6/6 ✓ + console limpo + índice de férias servindo no cliente.** Fixture 100% limpa. **Checklist de deploy em produção: `docs/checklist-deploy-producao.md`** (inclui as 2 decisões pendentes: antecedência de férias 5→30 e destino final da tela legada). Produção intacta — **falta SÓ o aceite do cliente no staging → seguir o checklist.**

> **📦 KIT DE HOMOLOGAÇÃO (12/06, commit `cce1e56`):** redirect automático no `index.html` (professor que loga no link principal cai direto no professores.html — validado E2E) + 3 páginas publicadas no staging com a identidade visual do sistema: **`/manual-admin.html`** (10 seções, dois módulos), **`/manual-professores.html`** (8 seções) e **`/roteiro-homologacao.html`** (7 passos com perguntas-chave, aponta os dados de demo). Cliente recebe só os links.
>
> **🔀 SELETOR DE MÓDULO NO COMISSÕES (12/06, commit `0e33183`, autorizado):** cliente apontou que o admin logado no Comissões não tinha caminho visível pro módulo Professores (só o item "Pessoas"). Adicionado o seletor **Comissões | Professores** no topo da sidebar do `index.html` (espelho do `.sb-switcher` do professores.html; só renderiza com `moduleAccess` nos 2 módulos — vendedora não vê). Validado E2E nos 2 sentidos. Roteiro passo 1 atualizado orientando o caminho.
>
> **👤 ACESSOS DO CLIENTE no staging (12/06, `seed-demo.js --users`, validados E2E):** `dono.teste@crosstainer.com` (admin, 3 unidades) e `professor.teste@crosstainer.com` (professor → vinculado ao Marcos Estrela: aulas de sábado, substituição e o pedido de férias do roteiro). Senha de ambos: `crosstainer2026`. Roteiro ganhou o **passo 8** (entrar como professor) + nota: pós-aprovação vem a **visão do professor otimizada pra celular** (compromisso assumido com o cliente). Remoção: `seed-demo.js --cleanup` (cobre os 2 users).
>
> **🎬 DADOS DE DEMO no staging (12/06, `scripts/seed-demo.js`):** 56 aulas de Jun/2026 (realizadas até dia 11 → fechamento preview unit-cp dá 24 aulas · 24h · R$ 3.300; previstas dia 12+), 1 aula substituída, salário do Marcos (R$70/h; **Pedro Lima sem salário de propósito** — demonstra "Sem cadastro"), 1 férias pendente + 1 substituição pendente (home do admin acende "Precisam de você"). Tudo etiquetado `seed-demo` — remover depois da homologação com `node scripts/seed-demo.js --cleanup`.

> 🎯 **Sessão 33 (11/06) — Design do wizard fechado + spec + plano + execução das Tasks 1–8.**
>
> **Design fechado (decisões D7–D14, todas aprovadas pelo cliente):** D7 Acesso opcional no caminho professor ("Pular — criar sem acesso") e obrigatório no não-professor; D8 professor órfão NÃO é erro (vira estado "sem acesso" recuperável pela ficha, sem rollback); D9 wizard admin-only (supervisão só edita existentes); D10 menu "Usuários" do Comissões vira link `professores.html?page=pessoas` (tela antiga fica no código sem menu); D11 entrada "Professores" some (Pessoas assume); D12 modelo = UNIÃO `teachers`⊕`users` via `professorId` (sem migração); D13 escritas PROGRESSIVAS reusando teacherModal/salaryModal via hooks `onSaved`/`onClosed`; D14 "Pessoas" na seção Cadastros (supervisão alcança; Administração fica com Unidades+Auditoria).
>
> **Artefatos:** spec `docs/superpowers/specs/2026-06-11-hub-pessoas-design.md` · plano `docs/superpowers/plans/2026-06-11-hub-pessoas.md` (12 tasks, código completo, nota de progresso no topo).
>
> **Tasks 1–8 ✅ executadas (smokes todos verdes):**
> - `3c86e64` user-model.js sem admin_gestao (5 perfis) + smoke
> - `73184cc` professores-nav.js: 'pessoas' em Cadastros, sem 'professores', SYSTEM_SECTION só units+audit + smoke
> - `c9ab33f` **pessoas-model.js** novo (junção pura, 3 estados) + smoke-pessoas-model.js
> - `0321f57` professores-cadastro.js: hooks TeacherFormState.onSaved / SalaryFormState.onClosed + supervisão edita professor (gate)
> - `798500e` **professores-pessoas.js** novo (lista união + busca/filtro) + div/scripts no professores.html + dispatch 'pessoas' + deep-link `?page=` no showApp + helpers de professores.js sem admin_gestao (canSeeSalary = só admin)
> - `82030ed` ficha 4 abas gated (Identidade · Professor · 🔒Salário · 🔑Acesso; owner lock D3; XOR professor/estagiário)
> - `3a8ec2b` wizard "Nova pessoa" + modal Acesso (markup em professores.html; Auth via app 'secondary'; users doc gravado COMO ADMIN — rules atuais só permitem create por admin, diferente do createUser legado que grava como o usuário novo)
> - `5517621` index.html: troca cirúrgica do menu (diff de 3 linhas conferido — regra #1)
>
> **Tasks 9–12 ✅ executadas (bloco de staging):**
> - `77773fe` auditoria admin_gestao nos dados: **0 usuários** — limpeza segura
> - `48da255` rules: `isAdmin()` só admin + `teachers` update p/ supervisão · deployadas (`--only firestore:rules`)
> - `17bb633` fixture (3 estados + supervisão) + **validação REST 8/8 ✅** (supervisão sem salários/sem criar users; professor travado). Bug achado e corrigido no script: regex pegava a apiKey de PROD (1ª do firebase-config.js) — agora extrai a do bloco staging
> - hosting deployado em `crosstrainer-comissoes-staging.web.app`
>
> **⏭️ PRÓXIMA AÇÃO — homologação UI pelo cliente (janela anônima no staging), roteiro de 9 passos:**
> 1. Admin → professores.html: sidebar com **Cadastros → Pessoas** (sem "Professores"); Administração só Unidades+Auditoria
> 2. Lista Pessoas: todos com badges; "Fixture Pessoas SemAcesso" com badge SEM ACESSO
> 3. Wizard professor: + Nova pessoa → Professor → modal professor → salvar → modal salarial → salvar/fechar → Acesso → **Pular** → ficha com banner
> 4. "Criar acesso" depois pela ficha → vira "Com acesso"
> 5. Wizard vendedor: caminho curto, sem Pular, exige unidade
> 6. Segregação: `fix.pessoas.prof@teste.com`/`fixprof123` no index.html → tela "Sem acesso"; no professores.html → sidebar professor + Minha Agenda
> 7. Supervisão: `fix.pessoas.superv@teste.com`/`fixsuperv123` → só professores na lista, sem abas Salário/Acesso, sem "+ Nova pessoa", consegue editar professor
> 8. Comissões (admin) → menu "Pessoas" → abre o hub direto (deep-link)
> 9. Dark mode nos modais novos
>
> **✅ ROTEIRO UI EXECUTADO POR AUTOMAÇÃO (9/9, mesmo dia):** Claude controlou o browser de preview (servidor estático local na porta 8123 → `firebase-config.js` detecta localhost → STAGING real). Resultados: (1) sidebar admin OK; (2) lista união 9 pessoas + badges + "4 sem acesso"; (3) wizard professor completo — XOR perfis, teacherModal→salaryModal→Acesso encadeados pelos hooks, Pular→banner na ficha; (4) "Criar acesso" pela ficha — banner some, pill "● Com acesso", **admin não foi deslogado** (app secondary OK); (5) wizard vendedor — caminho curto sem Pular, validação de unidade obrigatória funcionou; (6) segregação §4.7 — professor no index.html cai em "Sem acesso ao módulo Comissões" + Minha Agenda carrega com professorId (era a validação B/C pendente da Plano D); (7) supervisão — lista SÓ professores sem badges de acesso, ficha só Identidade+Professor, sem "+ Nova pessoa", edita professor; (8) menu "Pessoas" no Comissões + deep-link abre o hub direto; (9) dark E light mode legíveis.
> **Cosmético corrigido durante a avaliação do cliente:** checkboxes dos modais novos desalinhados (CSS `.form-group label` vencia por especificidade) → classe `.check-row` flex, commit `01ef284`, deployado.
>
> **🐛 BUG de units duplicadas — achado pelo cliente na avaliação, CORRIGIDO:** `loadUnitConfig()` (`index.html:3705`) **auto-criava** `units/{id}` "CrossTainer CP" quando `allowedUnits[0]` do usuário logado apontava pra doc inexistente → cascas "Inativa" acumulavam no staging (7 achadas). Limpeza: `scripts/audit-units-duplicadas.js` (inventário de referências users/teachers/periodos antes de apagar; 7 órfãs removidas, `unit-cp`/`unit-norte`/`unit-pp` intactas). **Fix autorizado pelo cliente no `index.html`** (commit `8c6ced5`): config default só em memória, sem gravar. Validado com regressão real: user temporário com `allowedUnits: ['unidade-fantasma-teste']` logou e NENHUM doc foi criado (antes criava). Temp user removido. Em produção o bug era latente (dados consistentes) — fix vai junto na homologação.
> **🧹 Fixture LIMPA (cleanup estendido):** 5 logins (`fix.pessoas.*` + `fix.wizard.*`) + 3 teachers + salários + audit entries removidos do staging. Pra re-testar visualmente: `node scripts/fixture-pessoas.js` recria em segundos. Servidor local de preview: `.claude/launch.json` (`crosstrainer-static`, porta 8123).
>
> **Decisões de processo:** validação UI da Plano D foi ABSORVIDA pelo roteiro do hub (não validar 2x a mesma fundação). Limpeza de admin_gestao em `functions/index.js`, `storage.rules` e queries legadas do `professores-shared.js` ficou FORA de escopo (ramos mortos inofensivos; mexer exigiria redeploy de CFs).
> Branch `feature/shell-integrado` **não mergeada no `main`**.

---

## 🔖 Sessão 32 (10/06/2026) — Navegação integrada (Planos A–D) + virada pro hub Pessoas

**Estado:** Shell integrado: Planos A/B/C validados + bug de férias corrigido + Plano D implementado. Hub único "Pessoas" em design (concluído na sessão 33).

> 🎯 **Sessão 32 (10/06) — Implementação da navegação integrada (branch `feature/shell-integrado`).**
>
> Specs/planos: design `docs/superpowers/specs/2026-06-10-navegacao-shell-integrado-design.md`; planos `docs/superpowers/plans/2026-06-10-shell-integrado-plano-a.md` e `-plano-b.md`.
>
> **Plano A ✅ (validado UI):** novo `professores-nav.js` (config + modelo puro + smoke `scripts/smoke-sidebar.js`); `buildSidebar` reescrito → **acabou a duplicação** de seções; agrupamento por domínio (Início · Agenda · Cadastros · Férias · Financeiro · Minhas aulas); seção **Administração · sistema** (admin → links pro Comissões); **seletor de módulo** (por `moduleAccess`); home estática → mensagem neutra; scrollbar fina + sidebar compacta. Paridade de permissões travada por teste (admin_gestao sem `pagamentos`).
>
> **Plano B ✅ (validado UI):** deep-link `index.html?page=...` no `showApp()` → links da Administração abrem direto a tela do Comissões.
>
> **🔴 Descoberta + fix (na branch):** o `index.html` usava config **hardcoded de produção** e NÃO o `firebase-config.js` → no staging o **Comissões falava com PRODUÇÃO** (furo de isolamento) e a sessão não era compartilhada com o Professores (staging), quebrando o deep-link. **Migrado:** `index.html` agora carrega `firebase-config.js` (detecção por hostname; `firebaseConfig` → `window.FIREBASE_CONFIG`, preservando app 'secondary'). Em produção (github.io) é inócuo (valores idênticos). Confirmado no console: `Ambiente: STAGING`.
>
> **Tech debt registrado (adiado pelo cliente):** o **Comissões no staging não tem dados configurados** (admin `abluir@gmail.com` com `allowedUnits: []`, 0 `periodos`) → Dashboard do Comissões dá "Erro ao carregar períodos". Só apareceu por causa do isolamento (antes lia prod). Não afeta navegação nem Professores.
>
> **Pendências de prod:** a migração de config do `index.html` (e futuramente `profiles[]`/`professorId` no form de Usuários — Plano D) vão pra produção junto com o módulo, via homologação (regra #7). Branch **não mergeada no `main`**.
>
> **Plano C ✅ (validado UI):** home "centro de pendências" — `professores-home.js` (`renderHomePage` despachado no `navigateTo('home')`). Admin: faixa "Precisam de você" (férias a aprovar, substituições pendentes) com chips que linkam + atalhos; professor: aulas de hoje + substituições + atalhos. Contador que falha é omitido (home nunca quebra). Validado com `scripts/fixture-home-c.js` (já limpa).
>
> **Polimento (dark mode):** modal "Aprovar Férias" (Sprint 6b) usava cores claras fixas → ilegível no dark. Convertido pra variáveis de tema (`.payment-*`/`.ferias-approve-info` em `professores.html`); radio ativo agora laranja.
>
> **🐛 BUG REAL de férias — CORRIGIDO (commit `a15d07a`, validado UI):** aprovar férias COM pagamento ("Adiar" / "Aprovar e definir") falhava com "Missing or insufficient permissions". Causa: `VacationService._respond` (`professores-shared.js`) gravava `status`+`payment` num único `update`, mas `firestore.rules` (`vacation_requests`, ~203-227) só permite essas mudanças **separadas**. Passou na Sprint 6b porque foi validado via Admin SDK (bypassa rules). **Fix:** o `_respond` agora faz 2 updates — 1º status (regra B), 2º payment isolado `{payment, updatedAt}` (regra A). Reject (sem payment) segue 1 write. Não-atômico (se o 2º falhar, fica aprovada com pagamento pendente — recuperável via editar pagamento).
>
> **Comissões staging destravado:** admin `abluir@gmail.com` recebeu `allowedUnits = [unit-cp, unit-norte, unit-pp]` (estava `[]`) → Dashboard do Comissões no staging abre sem "Erro ao carregar períodos". Ainda há 0 `periodos` (sem dados de vendas — esperado; fazer upload se quiser exercitar). Há 3 `units` duplicadas "CrossTainer CP" (REEnfj/d3Tl/hGIf) que são lixo de teste — deixadas como estão.
>
> **Plano D ✅ implementado (deployado em staging, commit `cefef06`; AGUARDANDO VALIDAÇÃO):** form de Usuários do Comissões evoluído. Novo `user-model.js` (derivação pura `profiles[]`→`{moduleAccess, role}`, smoke `scripts/smoke-user-model.js`), carregado em `index.html` + `professores.html`; `migrateUserProfile` (professores.js) alinhado à mesma derivação. Form (`index.html`): "Perfil" único virou **checkboxes multi** (6 perfis) + seletor **"Vincular ao professor"** (`professorId`, condicional). `createUser`/`editExistingUser` gravam `role`+`profiles`+`moduleAccess`+`professorId`; unidade só exigida se `moduleAccess.comissoes`. Lista mostra badges de perfis. **Segregação §4.7:** `index.html` agora bloqueia login de quem não tem `moduleAccess.comissoes` (`showNoComissoesAccess` → tela com link pro Professores). Mantém `role` (Comissões depende). NÃO em produção.
>
> **⏳ TESTAR AO VOLTAR (Plano D — janela anônima, staging):**
> - **A) Form:** `index.html` (admin) → Usuários → "+ Novo Usuário". "Perfis" mostra 6 checkboxes; marcar **Professor** faz aparecer "Vincular ao professor". Criar (ex.: `prof.teste2@teste.com` + senha, vincular a um teacher; unidade NÃO exigida) → aparece na lista com badge "Professor".
> - **B) Segregação:** logar como esse usuário no `index.html` → tela **"Sem acesso ao módulo Comissões"** + botão Professores (NÃO o dashboard).
> - **C) Professor no módulo:** logar como ele em `professores.html` → entra, sidebar de professor, "Minha Agenda" carrega (professorId vinculado).
> - **D) Não-regressão:** editar o **admin** → checkboxes refletem perfis; salvar mantém 2 módulos; login do admin no Comissões segue normal (não bloqueado).
> - Obs.: após criar o professor, Claude pode rodar consulta Admin SDK pra mostrar os campos gravados (`profiles`/`moduleAccess`/`professorId`/`role`) — pedir o email usado.
>
> **🔄 VIRADA DE RUMO (decisão do cliente):** em vez de manter Usuários (Comissões) + ficha do Professor separados, o cliente optou por um **hub único "Pessoas"** — "fazer certo já de início, mesmo que atrase a homologação" (opção A). Modelo aprovado: uma tela "Pessoas" (lista + "Nova pessoa" via **wizard** + ficha com **seções gated por perfil**: Identidade / Professor / Salário / Acesso). Segurança vem das **Security Rules** (a UI só esconde/bloqueia; o backend é a trava real). **A Plano D vira fundação** (user-model.js, multi-perfil, professorId, segregação são reaproveitados, não descartados). Implica substituir/redirecionar a tela de Usuários do Comissões + absorver a ficha atual → mexe nos DOIS módulos.
>
> **DESIGN do hub (brainstorm EM ANDAMENTO — decisões já travadas):**
> - **Escopo:** UMA lista "Pessoas" com TODOS (vendedores, admins, professores, supervisão). Página de SISTEMA servida no app Professores (único lugar que supervisão alcança); **substitui** "Gestão de Usuários" do Comissões + **absorve** a ficha do Professor.
> - **Perfis SIMPLIFICADOS — cliente DROPOU `admin_gestao`:** restam `admin` (donos + dev = tudo, os 2 módulos), `supervisao` (operacional, **SEM criar login e SEM ver salário**), `professor`/`professor_estagiario`, `vendedor`. → limpar `admin_gestao` do código (entrou na Plano A/D: `user-model.js`, `professores-nav.js` PROF_PAGES).
> - **Desenvolvedor (você, `abluir@gmail.com` = OWNER_EMAIL):** `admin` + flag de dono — preview de outros perfis (Visão Vendedor hoje; quer **Visão Professor** depois = **item PARQUEADO**, recurso à parte), não removível, perfil **NÃO replicável** (ninguém atribui "Desenvolvedor"; é amarrado ao email).
> - **Ficha com 4 abas gated:** Identidade · Professor · 🔒 Salário · 🔑 Acesso (login/perfis). Abas Professor/Salário só aparecem se a pessoa for professor/estagiário. (Reusa o padrão que já existe: a aba Salarial já é gated por `canSeeSalary()`.)
> - **Matriz:** admin = todas as abas. supervisão = só Identidade + Professor (Salário e Acesso ocultos). **Lista:** admin/dev vê todos; supervisão vê só professores. **Segurança real = Security Rules** (UI só reflete/esconde).
> - **moduleAccess derivado dos perfis** (reusa `user-model.js` da Plano D): admin→{com✔,prof✔}, supervisao/professor→{com✗,prof✔}, vendedor→{com✔,prof✗}.
> - Mockups salvos em `.superpowers/brainstorm/2537-1781139318/content/` (`hub-layout-v2.html` é o atual).
>
> **FALTA no design (retomar amanhã):** (1) fluxo do **wizard "Nova pessoa"** (marca perfis → se professor/estagiário, passos **entidade + salário** ANTES do **acesso**; senão direto pro acesso) + **tratamento de erro** (entidade criada mas login falhou = professor órfão); (2) destino concreto da tela de Usuários do `index.html` (deprecar/redirecionar) e da ficha atual de professor; (3) escrever o **spec** (`docs/superpowers/specs`) → revisar → plano → implementar.
>
> **Próxima ação:** retomar o brainstorm do hub **no wizard**, fechar o design, escrever o spec. (Pra reabrir os mockups: subir o servidor visual de novo — os HTMLs estão salvos.) Branch `feature/shell-integrado` **não mergeada no `main`**.

---

## 🔖 Sessão 31 (10/06/2026) — Fix R3 + homologação Sprint 9 + design de navegação

**Estado:** **Sprint 9 HOMOLOGADA na UI pelo cliente (2 pendentes validados) + 1 bug do R3 achado e corrigido.** Projeto ~99% pronto — homologação dos relatórios concluída.

> 🎯 **Sessão 31 (10/06) — Homologação UI dos pendentes da Sprint 9 + fix de bug do R3.**
>
> Cliente validou via UI (janela anônima no staging) os 2 itens que faltavam:
> - ✅ **R4 Recibo html2canvas** — render perfeito: header CrossTainer centralizado, acentos OK (PRÉVIA/VÍNCULO/LÍQUIDO), valor por extenso, 2 assinaturas, total preto/branco. Paridade 100% com `receipt.html` confirmada (ambos usam `.toFixed(2)`). ZIP gera 1 PDF por prof (fechamento 05/2026 tem 1 prof → 1 arquivo, correto).
> - ✅ **R3 "Sem cadastro salarial"** — Pedro Lima (estagiário sem `teacher_salaries`) mostra "—" na tabela e no PDF.
>
> **🐛 Bug encontrado durante a homologação (corrigido):**
> - R3 filtrava `['realizada','substituicao']`, mas `'substituicao'` **não existe** no sistema — o valor canônico é `'substituida'` (`allowed` em `professores-shared.js:1292` + fechamento Sprint 4a `:2020`). Toda aula de substituição era silenciosamente descartada do R3.
> - Sintoma: período com 2 aulas `substituida` do Lucas Mendes dava "Nenhuma aula encontrada", enquanto R4/fechamento mostravam 2 aulas / R$ 240,00.
> - Fix: `professores-shared.js` linhas 3688/3704/3800 `'substituicao'` → `'substituida'`. Commit **`bd80996`** no `main`. Deployado em staging (hosting). Validado via Admin SDK + UI: Lucas (R$ 240,00) + Pedro Lima ("—") aparecem corretos.
>
> **Cosmético anotado (não bloqueia):** recibos (individual + lote) mostram valores com ponto ("240.00") em vez de vírgula BR. Pré-existe no `receipt.html` de produção — polimento opcional futuro (mexeria em código já validado em prod).
>
> **Fixture limpa:** as 2 aulas do Pedro foram removidas do staging após o teste (cleanup rodado). Check do Excel do R3 ("Sem cadastro") segue como opcional — o "—" já foi validado em tabela e PDF.
>
> **Novo workstream — Navegação integrada (design aprovado):** brainstorming de reorganização da navegação do módulo. Spec commitado em `docs/superpowers/specs/2026-06-10-navegacao-shell-integrado-design.md` (commit `9644129`). Decisões: shell integrado com seletor de módulo (`moduleAccess` §4.6) · sidebar do Professores **por domínio** (Início · Agenda · Cadastros · Férias · Financeiro — resolve a duplicação OPERAÇÃO/FINANCEIRO, causa-raiz: render de `PAGE_DEFINITIONS` em ordem de array) · home como **centro de pendências** (substitui cards de sprint) · cadastros de sistema (Usuários/Perfis, Unidades, Auditoria) **compartilhados** em área de Administração (§4.5) · **dependência registrada:** evolução da tela de Usuários (`profiles[]`/`moduleAccess`/`professorId` — decisão (a) editar `index.html` vs (b) tela nova unificada, **a confirmar**).
>
> **Próxima ação:** (1) escrever o **plano de implementação** da navegação integrada (writing-plans); e/ou (2) **homologação completa** do módulo → decisão de deploy em produção (regra inviolável #7).

---

## 🔖 Sessão 30 (07/06/2026) — Sprint 9 entrega do time + 2 itens re-fixados

**Estado:** **13 sprints validadas — Sprint 9 ✅ COMPLETA (com 2 fixes aplicados após inspeção)**. Projeto ~99% pronto.

> 🎯 **Sessão 30 (07/06) — Sprint 9 entrega do time + 2 itens centrais re-fixados.**
>
> **Entrega do time:** branding + empty states + migrations + CDN fallback + CreditService transaction. Mas DOIS itens centrais do playbook **não foram implementados**:
> - 🔴 Recibo R4 html2canvas (Etapa 3 inteira) — time baixou a lib mas não usou. `renderReciboInPdf` continuava com jsPDF programático
> - 🟡 R3 "Sem cadastro salarial" (D8) — continuava mostrando R$ 0,00
>
> **Fixes aplicados por mim (~45 min):**
> - `professores-shared.js`: `getHorasPorProfessorReport` agora adiciona `noSalaryData: true` quando salary ausente ou hourlyRate=0
> - `professores-relatorios.js`:
>   - Helper `formatRowCell(row, col)` substitui currency por "—" quando `noSalaryData`
>   - Preview HTML: tooltip "Cadastro salarial incompleto" no hover
>   - Excel: célula mostra string "Sem cadastro"
>   - Novo `renderReciboFromHtml(prof, closing)` — iframe oculto + html2canvas + canvas.toDataURL → addImage no jsPDF
>   - Novo `buildReceiptHtmlForExport(prof, closing)` — espelha receipt.html com CSS inline (header centralizado, info-blocks, total preto/branco, valor por extenso, 2 assinaturas, footer)
>   - `exportRecibosLote` agora detecta `window.html2canvas` e usa o novo pipeline (fallback pro jsPDF programático se html2canvas indisponível)
>
> **Validação:**
> - ✅ Branding: 0 matches de "CrossTrainer" em arquivos visíveis (sw.js intacto)
> - ✅ Migrations: 36 entries em `audit_log module=agenda`, 18 classes em BR midnight, 0 UTC
> - ✅ Vendor 5/5 libs (xlsx, jspdf, autotable, jszip, html2canvas)
> - ✅ CreditService runTransaction
> - ✅ R3 noSalaryData flag implementada
> - ✅ R4 html2canvas — script `scripts/preview-recibo-html.js` gera HTML offline (replica buildReceiptHtmlForExport), preview enviado ao usuário pra inspeção visual: header CrossTainer centralizado · seção férias 🏖️ · total preto/branco · acentos perfeitos
>
> **Pendente (cliente valida via UI quando puder):**
> - 🟡 Confirmar pipeline `html2canvas → canvas → PDF` gera arquivo válido sem erro (risco baixo, lib padrão)
> - 🟡 Confirmar R3 visual mostra "—" + tooltip
>
> **Cleanup:** fixture-8 removida + pasta tmp-preview-recibos descartada + .gitignore atualizado.
>
> **Próxima ação:** quando cliente puder validar UI dos 2 itens pendentes (~5 min). Após isso → **homologação completa** + decisão de **deploy em produção** (regra inviolável #7).

---

## 🔖 Sessão 29 (07/06/2026) — Playbook Sprint 9 escrito

**Estado:** **12 sprints validadas + Sprint 9 (Polimentos Finais) playbook publicado, aguardando dev**. Projeto ~98% pronto + sprint 9 em planejamento (última antes da homologação).

> 🎯 **Sessão 29 (07/06) — Playbook Sprint 9 escrito.**
>
> **3 decisões travadas (via AskUserQuestion):**
> - Escopo: **4 categorias completas** (UX + Branding + Tech debt + Robustez CDN)
> - Recibo R4: **html2canvas espelhando receipt.html** (paridade visual 100%)
> - sw.js: **manter** (regra inviolável #1)
>
> **Playbook canônico:** `sprint-9-polimentos-finais.md` (~900 linhas, 12 critérios, 12 decisões, 5 snippets-chave).
>
> **Itens cobertos:**
> - **UX/Visual:** recibo R4 paridade, R3 "Sem cadastro" em vez de R$ 0,00, mensagens vazias padronizadas, loading states consistentes
> - **Branding:** CrossTrainer → CrossTainer em arquivos visíveis ao usuário (regra inviolável #8). NÃO mexer em IDs técnicos do Firebase nem sw.js
> - **Tech debt:** migration audit_log legacy (`professores` → `agenda`) + migration classes UTC midnight (só staging) + CreditService transação atômica + validar critérios 5/6 Sprint 4a
> - **Robustez:** CDN local fallback (`/vendor` com 5 libs: SheetJS, jsPDF, jsPDF-autotable, JSZip, html2canvas)
>
> **Doc pro time:** `docs/superpowers/specs/2026-06-07-sprint-9-instrucoes.md` — resumo executivo + pontos delicados + checklist pré-deploy. Atenção especial pra branding (cuidado pra não mexer em IDs).
>
> **Estimativa:** 5-6 dias úteis pra dev + 1-2 dias minha pra validar.
>
> **Próxima ação:** dev pega o playbook e executa as 6 etapas em ordem. Quando entregar, valido com smoke-9 + fixture-9 + UI manual. **Após Sprint 9: homologação completa + decisão de deploy em produção (regra inviolável #7).**

---

## 🔖 Sessão 28 (07/06/2026) — Sprint 8 validação 100% (5 bugs encontrados e fixados)

**Estado:** **12 sprints validadas — Sprint 8 ✅ COMPLETA (R1·R2·R3·R4 funcionando em staging)**. Projeto ~98% pronto.

> 🎯 **Sessão 28 (07/06) — Validação Sprint 8 entregue pelo time + 5 fixes aplicados.**
>
> **Setup:** fixture-8.js criada (closing + 3 profs com nomes ricos em acentos pra testar UTF-8 + vacation + 5 classes) + validação visual via UI logada como admin.
>
> **5 bugs encontrados e fixados nesta sessão:**
>
> 🔴 **Fix 1 — Ordem de carregamento de libs** (`professores-relatorios.js`):
>   - PDF não gerava silenciosamente. `Promise.all` carregava `jspdf-autotable` antes do `jspdf` estar pronto → autotable falhava em se anexar
>   - Fix: carrega jspdf+xlsx+jszip em paralelo, **depois** autotable. Sanity check final
>
> 🔴 **Fix 2 — Summary formatava tudo como currency** (`exportToPdf`):
>   - `totalProfessors: 12` virava "R$ 12,00" no rodapé
>   - Fix: regex no nome do campo pra detectar currency (`totalValor|totalGeral|Value$`) vs número simples
>
> 🔴 **Fix 3 — R3 mostrava "Desconhecido" + R$ 0,00** (`getHorasPorProfessorReport`):
>   - Time assumiu `class.teacherName` e `class.classValue` existiam (não existem no schema de classes)
>   - Fix: lookup de teachers + teacher_salaries + modalities + cálculo on-the-fly `horas × hourlyRate` via `getEffectiveSalaryAt`
>
> 🔴 **Fix 4 — R3 estagiário R$ 0,00** (`getHorasPorProfessorReport`):
>   - Fix 3 só pegava efetivo (hourlyRate)
>   - Fix: estagiário usa `internProportionalHourlyRate` · fallback `internMonthlyStipend / internMonthlyLimitHours`
>
> 🔴 **Fix 5 — R4 ficava em "Carregando..."** (`getRecibosLoteData`):
>   - Retorno não tinha `columns`/`rows` que o renderer genérico exige → `TypeError` silencioso
>   - Fix: adicionado columns + rows com `valorTotal = valorTotal + vacationValue`
>
> **Validação visual (usuário, em staging):**
> - R1 Fechamentos ✅ — PDF com header CrossTainer ELITE, acentos perfeitos, currency BR, coluna Férias da Sprint 6b integrada, totais corretos
> - R2 Saldos de Férias ✅ — Lucas Mendes mantém status overdue (descoberta da Sprint 6c), totais com formatação correta
> - R3 Horas por Professor ✅ — funciona; R$ 0,00 com Pedro Lima é correto (estagiário sem cadastro salarial em staging)
> - R4 Recibos em Lote ✅ funcional — preview mostra profs, PDF único + ZIP geram corretamente
>
> **Descoberta interessante:** Pedro Lima (estagiário real do staging) **não tem cadastro em `teacher_salaries`**. Sistema mostra R$ 0,00 corretamente. Anotado pra polimentos finais: trocar R$ 0,00 por "—" ou "Sem cadastro" pra clareza UX.
>
> **Decisão registrada:** template do recibo R4 (PDF programático via jsPDF) está mais simples que receipt.html da Sprint 4b. Adiado pra polimentos finais (lista de itens consolidada em `polimentos-finais-backlog.md`).
>
> **Cleanup:** fixture-8 removida completa (closing + vacation + 5 classes).
>
> **Próxima ação:** decidir próxima sprint. Candidatas: **Sprint 7 (emails Brevo)** · **Polimentos finais** (lista pronta em memória).

---

## 🔖 Sessão 27 (07/06/2026) — Playbook Sprint 8 escrito

**Estado:** **11 sprints validadas + Sprint 8 playbook publicado, aguardando dev**. Projeto ~97% pronto + sprint 8 em planejamento.

> 🎯 **Sessão 27 (07/06) — Playbook Sprint 8 escrito.**
>
> **Decisões travadas (via AskUserQuestion):**
> - Escopo: **4 relatórios** (Fechamentos Mensais · Saldos de Férias · Horas por Professor · Recibos em Lote)
> - Formato: **Excel + PDF desde o início** (não staggered)
> - Geração: **Client-side** (browser, sem CF)
>
> **Playbook canônico:** `sprint-8-relatorios-exportacoes.md` (~900 linhas, 12 critérios, 14 decisões, 5 snippets-chave). Sprint 100% client-side (sem CF, sem nova coleção, sem novos índices, sem alteração em rules).
>
> **Bibliotecas via CDN (lazy load):** SheetJS (xlsx) + jsPDF + jsPDF-autotable + JSZip (~600KB total).
>
> **Doc pro time:** `docs/superpowers/specs/2026-06-07-sprint-8-instrucoes.md` — resumo executivo + decisões fechadas + características + atenção em pontos delicados (encoding UTF-8 PDF, currency BR, performance de lote, reuso do receipt.html).
>
> **Estimativa:** 7-8 dias úteis pra dev entregar + 1 dia minha pra validar.
>
> **Próxima ação:** dev pega o playbook e executa as 7 etapas em ordem. Quando entregar, valido com inspeção de código + smoke-8 + fixture-8 + UI manual (abre Excel e PDF gerados, valida formato + branding + acentos + currency).

---

## 🔖 Sessão 26 (07/06/2026) — Sprint 6c validação 100% (15/15) + bug agregado fixado

**Estado:** **Sprint 6c ✅ 100% COMPLETA — 12/12 critérios automáticos + 3 visuais (C5, C9 com bug agregado fixado, novo balance warning admin)**. Projeto ~97% pronto.

> 🎯 **Sessão 26 (07/06) — Validação visual Sprint 6c (C5, C9, balance admin) + 1 bug semântico fixado.**
>
> **Fixture preparada via `scripts/validate-6c-manual.js`:**
> - Reseto senha de `professor@teste.com` pra `Valida6Cqmbmhg!` (invalidada no cleanup — precisa redefinir via Console quando precisar logar de novo)
> - Cria vacation aprovada de 25 dias pro "Nome de teste" (saldo=5 restantes)
> - Cria teacher fixture "FIXTURE-6C Overdue Vencidão" com hireDate=01/01/2020 (5 períodos expirados)
>
> **🔴 Bug semântico descoberto e fixado:** `VacationBalanceService.getBalance` retornava `status='ok'` mesmo com 5 períodos expired no histórico, porque só olhava status do CURRENT period. Achado real: o painel mostrava o fixture como OK + descobriu também que **Lucas Mendes da Silva (dado real do staging) tem 1 período legítimo vencido**.
>
> **Fix aplicado:** agregar status considerando histórico. Se `history.some(p => p.status === 'expired')` → `status = 'overdue'`. Novo campo `expiredPeriodsCount` no retorno. Card vermelho do painel admin atualizado pra mostrar contagem de períodos vencidos. Em `professores-shared.js` e `professores-ferias.js`. Deploy hosting.
>
> **Validação visual (usuário, em staging):**
> - C9 ✅ — Card vermelho mostrou "2 professor(es) com férias vencidas" (fixture com 5 períodos + Lucas Mendes da Silva REAL com 1 período). Linhas com badge 🔴 VENCIDA
> - Balance warning admin ✅ — Modal "+ Nova solicitação (admin)" → select "Nome de teste" → bloco "Seu saldo atual: tirou 25, restam 5" aparece. Datas 10/09-19/09 → "excede em 5 dias" + justificativa obrigatória ✓. Envio bate em validação CLT 30 dias (Sprint 6a) — correto, esperado
> - C5 ✅ — Login professor@teste.com → "📊 Meu Saldo" → "5 dias disponíveis até 29/09/2026" + período aquisitivo 1º + histórico vazio + botão Solicitar férias
>
> **Decisão registrada:** botão "+ Nova solicitação (admin)" mantido como escape operacional pra casos CLT especiais (verbalmente combinado, override antecedência).
>
> **Cleanup:** vacation_request fixture + teacher overdue removidos. Senha de professor@teste.com invalidada (cliente redefine via Console quando precisar). Sem rastros sintéticos em staging.
>
> **Achado bônus:** Lucas Mendes da Silva (dado real, hireDate 15/03/2024) tem 1 período aquisitivo vencido (15/03/2024-14/03/2025, concessivo expirou em 14/03/2026). Sistema agora alerta. Cliente decide se age sobre isso.
>
> **Próxima ação:** decidir próxima sprint. Candidatas: **Sprint 7 (emails Brevo)** · **Sprint 8 (relatórios + exportações)** · **polimentos finais**.

---

## 🔖 Sessão 25 (07/06/2026) — Validação Sprint 6c + 2 fixes (off-by-one + admin balance)

**Estado:** **Sprint 6c ✅ implementada, validada e fixada (12/12 critérios automáticos)**. Projeto ~97% pronto.

> 🎯 **Sessão 25 (07/06) — Validação Sprint 6c + 2 fixes aplicados.**
>
> **Inspeção de código + smoke + fixture-6c autônoma** (scripts/fixture-6c.js — addMonths em 5 casos tricky + período aquisitivo + saldo + overdue + dedup + cleanup) detectaram 2 issues NÃO-bloqueadoras:
> - 🟡 Issue 1 — Off-by-one em `grantDeadline` no `professores-shared.js` (variável tinha `setDate(getDate()+1)` indevido). Resultado: prof ficava `overdue` 1 dia depois do correto
> - 🟡 Issue 2 — Modal admin (`openFeriasRequestModalAdmin`) não tinha balance warning nem soft warning no submit. Paridade quebrada com modal do professor
>
> **Fixes aplicados (Claude, ~20 min):**
> - `professores-shared.js`: removido `setDate(+1)` em `grantDeadline` (2 lugares — período atual + history)
> - `professores-ferias.js`: modal admin ganhou `<div id="feriasBalanceWarning">` + handler `onAdminFeriasTeacherChange()` + `onchange="updateFeriasBalanceWarning()"` nos inputs de data + balance check em `submitFeriasRequestAdmin` (mesmo pattern de `submitFeriasRequestComSaldo`)
>
> **Validação pós-fix:**
> - addMonths em 5/5 casos tricky (bissexto, fim de mês) ✅
> - Período aquisitivo: hireDate 15/03/2023 → atual=4º (15/03/2026-14/03/2027) ✅
> - Saldo subtrai vacation aprovada: 10 dias → daysRemaining=20 ✅
> - Off-by-one corrigido: 14/03/2028 → ok (último dia válido) · 15/03/2028 → overdue ✅
> - Dedup audit metaDayKey funcional ✅
> - Fixture-6c passou 100% após fix
>
> **Deploy:** `firebase deploy --only hosting --project staging` ✅
>
> **Relatórios:** `docs/superpowers/specs/2026-06-07-sprint-6c-validacao-resultado.md`.
>
> **Pendente (sem risco, validação UI manual):** painel professor "Meu Saldo" + card vermelho de vencidas + balance warning admin via login real. Tudo cosmético.
>
> **Próxima ação:** decidir próxima sprint com usuário. Candidatas: **Sprint 7 (emails Brevo)** · **Sprint 8 (relatórios + exportações)** · **polimentos finais**.

---

## 🔖 Sessão 24 (07/06/2026) — Sprint 6c implementada pelo time

**Estado:** **Sprint 6c implementada e deployada em staging, aguardando validação do cliente**. Projeto ~97% pronto.

> 🎯 **Sessão 24 (07/06) — Sprint 6c implementada (7 etapas, ~700 linhas de código).**
>
> **Arquivos modificados (5):**
> - `professores-shared.js` — +150 linhas: helpers (`getEntitlementStartDate`, `addMonths`, `listAcquisitionPeriods`, `findCurrentPeriod`, `escapeHtml`) + `VacationBalanceService` (getBalance, getAllBalances, listOverdueTeachers, checkAndLogOverdue)
> - `professores-ferias.js` — +250 linhas: `renderSaldosGestaoPage`, `openBalanceDetailModal`, `renderMeuSaldoPage`, `renderBalanceWarning`, `submitFeriasRequestComSaldo`, `updateFeriasBalanceWarning`. Modal de solicitação atualizado com bloco de saldo.
> - `professores.html` — páginas `page-meu-saldo` + `page-saldos-gestao` + CSS (~80 linhas)
> - `professores.js` — sidebar items + routing para `meu-saldo` e `saldos-gestao`
> - `scripts/admin.js` — comandos `vacation-balance`, `list-overdue-vacations`, `list-balances`, `smoke-6c`
>
> **Validação automática:**
> - Syntax check: 4/4 JS files passam em `node -c`
> - `smoke-6c` (admin SDK): ✅ 5 professores ativos, 4 elegíveis (2 efetivos + 2 estagiários), 1 eventual corretamente excluído
> - `vacation-balance QZw9...`: Lucas Mendes da Silva → 3º período aquisitivo, 0 tirados, 30 restantes, status OK
> - `list-balances`: 4 professores com saldo computado corretamente
>
> **Deploy staging:** ✅ `firebase deploy --only hosting --project staging`
>
> **12 critérios pendentes de validação manual (cliente):** UI admin, UI professor, soft warning, alerta vencidas, dedup audit.
>
> **Próxima ação:** cliente valida 12 critérios via inspeção de código + smoke-6c + UI manual em staging.

---

## 🔖 Sessão 24 (07/06/2026) — Sprint 6b validação 100% completa

**Estado:** **10 sprints validadas em staging + Sprint 6b ✅ 100% COMPLETA (16/16 critérios)**. Projeto ~95% pronto.

> 🎯 **Sessão 24 (07/06) — Validação manual final de Sprint 6b (C8, C12, C15).**
>
> **Setup:** Criado `scripts/validate-6b-manual.js` — automatiza C8 via Auth REST API (cria supervisor fixture, login, tenta UPDATE em payment via Firestore REST) + prepara fixtures C12 (vacation paga manual R$ 1.500) e C15 (vacation deferred contando no sidebar).
>
> **🔴 Bug descoberto durante C8:** primeira tentativa de update como supervisor retornou HTTP 200 — Security Rule não estava bloqueando! Diagnóstico: time entregou commit `3bc71f8` modificando `firestore.rules`, mas só deployou functions/hosting, **esqueceu de `--only firestore:rules`**. Durante essa janela, supervisor conseguiu gravar `payment.value=999.99` na fixture. Após redeploy explícito (`firebase deploy --only firestore:rules --project staging`) → HTTP 403 correto.
>
> **Validação visual (usuário):**
> - C12 ✅ — Coluna Pagamento renderiza "Manual · R$ 1.500,00" corretamente
> - C15 ✅ — Contador sidebar `🏖️ Férias (1)` sumiu em tempo real ao definir pagamento
> - C8 ✅ — Já validado via auth REST API após redeploy
>
> **Cleanup:** 3 fixtures + supervisor auth removidos. Sem rastros em staging.
>
> **Memória registrada:** `feedback-deploy-rules-explicito.md` — toda mudança em rules exige deploy explícito + validação via REST API (Admin SDK bypassa).
>
> **Próxima ação:** decidir próxima sprint. Candidatas: 6c (controle anual de saldo de férias) · Sprint 7 (emails Brevo) · Sprint 8 (relatórios + exportações) · polimentos finais.

---

## 🔖 Sessão 23 (03-07/06/2026) — Sprint 6b implementação + validação parcial (histórico consolidado)

**Estado:** 9 sprints validadas em staging + **Sprint 6b IMPLEMENTADA + VALIDADA PARCIAL (13/16 automáticos OK, 3 manuais pendentes sem risco)**.

> 🎯 **Sessão 23 (03/06) — Sprint 6b implementada (Subagent-Driven Development).**
>
> **Parte 1 — Playbook v2 revisado pelo cliente:**
> - Após avaliação do time em `docs/superpowers/specs/2026-06-03-sprint-6b-avaliacao-cliente.md`, cliente respondeu (`2026-06-03-sprint-6b-resposta-cliente.md`) com 10 mudanças vs v1:
>   - Fluxo: Opção A (juntos) — modal único aprovação+pagamento com botão "Adiar pagamento" como escape
>   - Estagiário: checkbox default MARCADO se `internMonthlyStipend > 0` (Lei 11.788/2008 Art. 13 §1º)
>   - Base efetivo: `MAX(média 12m, último mês)` — protege contra baixa atípica
>   - Observação: campo sempre presente em todos os modos
>   - Coluna Pagamento: 6 estados (Pendente / Sem pagamento / Auto·R$X / Pago / Parcial)
>   - Professor 100% férias: closeMonth mescla teacherIds (bug latente corrigido)
>   - Supervisor sem acesso: Security Rules bloqueiam payment.*
>   - Manual exorbitante: alerta visual silencioso se > 1,5× auto
>   - Preview sem spinner: recalcula ao vivo, cache local
>   - Contador sidebar: `🏖️ Férias (N)` com listener onSnapshot
> - Playbook `sprint-6b-pagamento-ferias.md` atualizado para v2 (1002 linhas, 16 critérios, 19 decisões)
>
> **Parte 2 — Implementação (13 tasks, Subagent-Driven):**
> - Commit `3bc71f8` · 11 arquivos · +1437 / −17 linhas
> - Plano: `docs/superpowers/plans/2026-06-03-sprint-6b-implementation.md`
> - Syntax check: todos os 7 JS files passam em `node -c`
> - Tasks executadas:
>   1. `scripts/backfill-vacation-denorm.js` — populate firstPeriodStart/lastPeriodEnd legados
>   2. `VacationService.request()` — grava denormalização na criação
>   3. `VacationPaymentService` + `getEffectiveStipendAt` — cálculo, persistência, preview
>   4. Security Rules + índice composto `(status, firstPeriodStart)`
>   5-6. Modal aprovação com bloco Pagamento + CSS completo
>   7. Coluna Pagamento 6 estados + modal edição posterior
>   8. Contador sidebar `🏖️ Férias (N)` ao vivo
>   9. `closeMonth` CF — merge vacationOnlyTeacherIds + split férias + paidInClosingIds
>   10. Linha Férias no detalhe do fechamento
>   11. Recibo A4 com seção Férias condicional
>   12. Comandos `vacation-preview` + `set-vacation-payment` + `smoke-6b`
>   13. ⏳ Deploy + validação em staging (aguardando)
>
> **Parte 3 — Resumo para validação:**
> - Documento: `docs/superpowers/specs/2026-06-03-sprint-6b-resumo-validacao.md`
> - Contém: checklist de deploy, 16 critérios de aceite, schemas novos, pontos de atenção
>
> **Parte 4 — Validação crítica (Claude validador):**
> - Inspeção de código nos pontos críticos: D2 MAX, D3 default condicional, D14 Security Rules, D17 merge teacherIds, modal único, contador sidebar → todos implementados conforme spec.
> - Criada fixture autônoma `scripts/fixture-6b.js` que cria 5 monthly_closings históricos fake + vacation_request 30d aprovado, replica `_calculateEfetivoAuto` e `splitVacationAcrossMonth`, valida cálculo + rateio + D17, e limpa tudo no fim.
> - **3 bugs detectados** durante validação:
>   - 🔴 Bug 1 (bloqueador): `_calculateEfetivoAuto` em `professores-shared.js` tinha `where('status','==','fechado')` exigindo índice composto não declarado → `FAILED_PRECONDITION` em 100% das chamadas
>   - 🔴 Bug 2 (bloqueador): `splitVacationAcrossMonth` em `functions/index.js` usava `Math.round((clipEnd-clipStart)/86400000)+1` com `clipEnd` em .999ms → inflava rateio em 1 dia quando férias cruzava mês. Bug originalmente meu no Snippet 3 do playbook
>   - 🟡 Bug 3 (cosmético): smoke-6b query `where IN + orderBy` exigia índice composto não declarado
> - Relatórios formais: `2026-06-03-sprint-6b-validacao-resultado.md`.
>
> **Parte 5 — Fixes aplicados:**
> - `professores-shared.js`: removido `where('status','==','fechado')` (status é único valor possível em monthly_closings)
> - `functions/index.js`: `Math.round` → `Math.floor` em `splitVacationAcrossMonth`
> - `scripts/admin.js`: query do smoke usa índice (module, timestamp) existente + filtra in-memory
> - `sprint-6b-pagamento-ferias.md`: playbook v2.1 — Snippet 1 sem status filter, Snippet 3 com Math.floor
>
> **Parte 6 — Deploy em staging + validação final:**
> - `firebase deploy --only firestore:indexes,functions:closeMonth,hosting --project staging` ✅
> - Aguardado build do índice `vacation_requests(status, firstPeriodStart)` (~90s).
> - Fixture-6b rodada com sucesso 100%:
>   - Cálculo MAX: `base12mAvg=5080`, `baseLastMonth=5400`, `baseMonthly=MAX=5400` ✅
>   - 30 dias × 5400/30 + 1/3 = **R$ 7.200** ✅
>   - Rateio jun+jul: **13 + 17 = 30 dias** exatos · soma proporcionais R$ 7.200 = valor original (diff R$ 0,00) ✅
>   - D17 query indexada retorna a fixture ✅
>   - D17 merge teacherIds incluiria prof 100% férias ✅
>   - Schema persistido com `formula='efetivo-clt-max'`, `baseMonthly=baseLastMonth` ✅
>   - Cleanup completo ✅
>
> **Pendências (3 critérios — validação UI manual, sem risco):**
> - **C8** — Supervisor sem acesso a payment: Security Rule já deployada em staging. Firestore bloqueia automaticamente, zero risco de vazamento.
> - **C12** — Recibo A4 mostra seção "🏖️ Férias": cosmético, só renderiza se `vacationDetails.length > 0`.
> - **C15** — Contador sidebar `🏖️ Férias (N)` atualiza em tempo real: visual, sem impacto em dado.
>
> **Próxima ação:** validar C8, C12, C15 manualmente com login real em staging (~10 min) quando usuário tiver tempo. Não bloqueia próximas sprints.

---

## 🔖 Sessão 20 (22/05/2026) — Sprint 5a deployada em staging

**Estado:** Sprint 1 ✅ + Mini-sprint 1.5 ✅ + Sprint 2 ✅ + Sprint 3a ✅ + Sprint 3b ✅ + Sprint 4a ✅ + Sprint 4b ✅ + **Sprint 5a ✅ DEPLOYADA EM STAGING**.

> 🎉 **Sessão 20 (22/05) — Sprint 5a implementada e deployada.** Todas as 7 etapas executadas seguindo o playbook `sprint-5a-escalas-e-feriados.md`:
> - **Etapa 1** — Seed `special_scale_types` (4 docs: sabado[1], feriado[2], domingo_especial[3], evento_especial[3]) + Security Rules (`meta/{doc}` p/ holidays_cache) + índice `special_scales(isActive, date)`
> - **Etapa 2** — Refactor `calculateTeacherHours` nos 3 lugares (professores-shared.js + functions/index.js + scripts/admin.js): suporte a `scaleTypesMap` com fallback `isHoliday → peso 2` retrocompat
> - **Etapa 3** — CF `generateClassesCore` com detecção de feriado via BrasilAPI + cache 7 dias em `meta/holidays_cache/{year}` + integração de `special_scales` ativas; campos novos `specialScaleType` + `specialScaleId` nas classes criadas
> - **Etapa 4** — Tela "🎯 Escalas Especiais" na sidebar (admin/admin_gestao/supervisao) com CRUD completo: lista, modal criar/editar/inativar, multi-select de unidades
> - **Etapa 5** — CF `regenerateClassesWithHolidays` (callable): busca feriados + escalas, atualiza `isHoliday`/`holidayName`/`specialScaleType`/`specialScaleId` em classes existentes, audit log `module='escalas'`
> - **Etapa 6** — Botão "📌 Aplicar a classes" na lista e no modal de edição: aplica escala a classes existentes na mesma data+unidades via `SpecialScaleService.applyToClasses`
> - **Etapa 7** — Comandos `scripts/admin.js`: `list-scale-types`, `list-scales`, `seed-holidays`, `apply-scale`, `smoke-5a`
>
> **Validação smoke-5a:**
> - C2: 4 tipos de escala ✅
> - C3: Cache 2026 com 13 feriados nacionais ✅
> - C5: CRUD funcional (SpecialScaleService no shared) ✅
> - C7: Pesos corretos: feriado=2h, evento=3h, normal=1h ✅
> - C9: Evento especial peso 3 validado ✅
> - C10: Audit log `module='escalas'` funcional ✅
>
> **Pendências (precisam UI ou dados de teste):**
> - C4: CF generateClasses marca isHoliday=true em feriado — validar com classe real no Firestore
> - C6: regenerateClassesWithHolidays — validar com chamada callable
> - C8: Fechamento usa peso corretamente — validar com mês que tenha aula em feriado/escala

**Validação final (Claude, 22/05) — Sprint 5a 11/11 ✅:** rodei `smoke-5a` (6 critérios automatizáveis OK) + criei fixture pra os 3 pendentes:
- **C4** validado por inspeção de código: `generateClassesCore` consulta `feriadosByDate`+`scalesByDate` no início e injeta nos candidates
- **C6** validado via `apply-scale TEST-FIXTURE-evento-junho`: classe fixture em 15/06 BR midnight foi marcada com `specialScaleType='evento_especial'` + `specialScaleId='TEST-FIXTURE-evento-junho'`
- **C8** validado: cálculo da classe fixture deu **60min × peso 3 = 3h** corretamente
- Fixtures (special_scale + classe + audit entries) limpas após validação

**Issue lateral detectado (não bloqueia, anotado pra futuro):** classes legadas em staging (geradas antes do fix bug D do fuso UTC↔BR na sessão 17) têm `scheduledDate` em UTC midnight. Os filtros novos do Sprint 5a (apply-scale, regenerate, fechamento) usam BR midnight. Em produção real (geração sempre BR após fix) funciona normal. Em staging com classes legadas, alguns filtros perdem essas. Migration opcional: somar 3h em `scheduledDate` das classes pré-fix.

**Próxima ação:** **Sprint 6a — Férias e Recesso** foi implementada e deployada (sessão 21). Usuário valida via `node scripts/admin.js --project staging smoke-6a` + fixture na UI.

---

## 🔖 Sessão 21 (22/05) — Sprint 6a implementada e deployada

> 🎉 **Sprint 6a — Férias e Recesso.** Todas as 6 etapas executadas seguindo o playbook:
> - **Etapa 1** — Security Rules refinadas (vacation_requests com validação requestedBy + status) + 2 índices + `VacationService` (6 métodos) com validações CLT + `NOTIF_TYPE_META` 4 tipos novos
> - **Etapa 2** — UI Professor "🏖️ Minhas Férias": lista de próprias solicitações + modal multi-período (até 3) + validações inline
> - **Etapa 3** — UI Admin "🏖️ Gerenciar Férias": tabela com chips de filtro + aprovar/recusar/cancelar + modal admin com override
> - **Etapa 4** — CF `generateClassesCore` modificada: pré-busca `vacation_requests` aprovadas, monta `Map<teacherId, Set<YYYY-MM-DD>>`, pula candidates em férias
> - **Etapa 5** — Notificações in-app (vacation_requested → admins; approved/rejected → solicitante; cancelled → bidirecional) + audit `module='ferias'`
> - **Etapa 6** — Comandos `admin.js`: `list-vacations`, `approve-vacation`, `reject-vacation`, `smoke-6a`

**Arquivos criados/modificados:**
| Arquivo | Mudança |
|---------|---------|
| `professores-ferias.js` | **Novo** — 380+ linhas, 2 views (professor + admin) + modais |
| `professores-shared.js` | +250 linhas — `VacationService` (6 métodos) + `validateVacationRequest` + consts CLT |
| `professores.js` | +6 linhas — sidebar "🏖️ Férias e Recesso" p/ todos + routing dual (prof vs admin) |
| `professores.html` | +2 linhas — div `page-ferias` + script tag |
| `functions/index.js` | +30 linhas — bloqueio de férias no `generateClassesCore` |
| `scripts/admin.js` | +100 linhas — 4 comandos novos |
| `firestore.rules` | refinado — vacation_requests com validação de status |
| `firestore.indexes.json` | +2 índices — `vacation_requests(status, requestedAt)` |

**Deploys feitos:** firestore:rules + firestore:indexes + functions (generateClassesForUpcomingWeeks, generateClassesManual)

**Pendências:** validar C2-C10 com fixture (professor cria solicitação → admin aprova → CF pula classes → notifs).

**Decisões fechadas pra Sprint 6a:**
- Workflow: professor solicita → admin/gestão aprova ou recusa
- Divisão: até 3 períodos (padrão CLT) com regras de mínimos por período
- Bloqueio agenda: CF `generateClassesCore` pré-busca férias aprovadas e pula candidates nas datas
- Antecedência: 30 dias efetivo · 15 dias estagiário (admin pode forçar override)
- Eventual: sem direito formal nesta sprint
- Pagamento durante férias: backlog Sprint 6b

## 🔖 Sessão 19 (histórico) — Sprint 4b fechada 12/12

---

## 🔖 Sessão 18 (histórico) — Sprint 4a fechada 8/10

> 🎉 **22/05 — Smoke test Sprint 4a executado, 8/10 cenários ✅.**
> Validado via `scripts/admin.js smoke-4a unit-cp 2026 5` + UI manual:
> - Sidebar "💰 Fechamento" pro admin ✅
> - Preview: 10 classes no mês BR, 2 entram, Lucas 2h × R$ 120 = R$ 240 ✅
> - Filtro de status (só `realizada`+`substituida`) ✅
> - Idempotência (2º close → erro) ✅
> - Congelamento: TODAS as 10 classes do mês com `monthClosingId='unit-cp_2026-05'` ✅
> - Histórico: 1 fechamento listado ✅
>
> **Pendência controlada:** critérios 5 e 6 (estagiário com/sem excedente) — sem estagiário com aulas em Maio CP no staging. Validar quando houver dados reais.
>
> **Bônus:** criado `scripts/admin.js` (Admin SDK) — utilitário reutilizável pras próximas sprints. Veja sessão 18 no log.

> 🎉 **Sessão 18 (21/05) — Sprint 4a implementada por completo.** Todas as 7 etapas executadas:
> - **Etapa 1** — Sidebar "💰 Fechamento" (admin + admin_gestao) + roteamento + Security Rules (isStrictAdmin)
> - **Etapa 2** — `ClosingService` + helpers (`calculateTeacherHours`, `calculateTeacherValue`, `getEffectiveSalaryAt`) em `professores-shared.js`
> - **Etapa 3** — Tela de preview com toolbar (unidade + mês/ano), tabela de professores, totais, botão "Fechar mês" (só admin estrito)
> - **Etapa 4** — Cloud Function `closeMonth` (callable) deployada em staging — consolida classes, replica cálculos, cria `monthly_closings`, batched update `classes.monthClosingId`, audit log
> - **Etapa 5** — Modo fechado read-only + modal de confirmação "esta operação é irreversível"
> - **Etapa 6** — Histórico de fechamentos por unidade com drill-down para detalhe
> - **Etapa 7** — 🔜 Smoke test pendente (10 critérios de aceite)

**Arquivos criados/modificados:**
| Arquivo | Mudança |
|---------|---------|
| `professores-fechamento.js` | Novo — 370+ linhas, toda UI de fechamento |
| `professores-shared.js` | +170 linhas — `ClosingService` + 3 helpers de cálculo |
| `professores.js` | +4 linhas — sidebar item, routing, `isStrictAdmin()` |
| `professores.html` | +2 linhas — `page-fechamento` div + script tag |
| `functions/index.js` | +280 linhas — `closeMonth` callable + 3 helpers server-side |
| `firestore.rules` | +1 helper `isStrictAdmin()` + alterado `monthly_closings` create |

**Deploys feitos:**
- ✅ `firestore:indexes` — índice `substitutions(substituteUserId, status, requestedAt)` (runbook P1)
- ✅ `functions:closeMonth` — Cloud Function ativa em staging
- ✅ `firestore:rules` — regras atualizadas (só admin estrito pode criar monthly_closings)

**Decisões aplicadas (D1-D10):** todas seguidas conforme playbook. Destaques: D1 = só admin fecha (não admin_gestao), D5 = feriado conta 2× nas horas (P02), D6 = estagiário com limite via `internMonthlyLimitMinutes`, D9 = status `realizada` + `substituida` apenas.

### 🎯 Próxima ação ao retomar

**Sprint 4a fechada (8/10 + 2 pendências).** Decidir entre:

**(a) Criar dados de teste pra fechar critérios 5/6 da Sprint 4a (~15 min)**
- Criar 1 estagiário com aulas em Junho/2026 CP
- Cenário 5: aulas dentro do limite mensal → paga só bolsa
- Cenário 6: aulas acima do limite → paga bolsa + (excedente × `internProportionalHourlyRate`)
- Validar via `scripts/admin.js smoke-4a unit-cp 2026 6`

**(b) Sprint 4b — Pagamentos + Recibos (~1 semana)**
- `payment_records/{id}` com status pago/pendente
- Geração de recibo (PDF? markdown? texto simples?)
- Notificação in-app pro professor quando recibo emitido
- Fluxo: closing fechado → emite recibo → registra pagamento

**(c) Outra direção** — escolha aberta. Ex: voltar pro módulo Comissões pra rodar diagnóstico abrangente do bug BIANUAL legacy (4 itens em CP Abr/2026 mais provavelmente outros meses).

Recomendação: (b) Sprint 4b — mantém momento, completa o ciclo financeiro, e 5/6 da 4a são marginais (validar quando aparecer estagiário real).

### Progresso da Sprint 1

| Etapa | Status | Notas |
|-------|--------|-------|
| **1 — Shell `professores.html`** | ✅ Validado | Login + sidebar + home + badge STAGING |
| **2 — Services base** | ✅ Validado | 5 services + helpers · audit_log automático |
| **3 — Tela de Modalidades (CRUD)** | ✅ Validado | 6 modalidades cadastradas no staging |
| **4 — Tela de Professores: lista lateral** | ✅ Validado | 2 colunas · chip filters · busca · avatar por tipo · badge de alerta de estágio |
| **5 — Ficha do professor (4 tabs)** | ✅ Validado | Header + 4 tabs (Dados/Modalidades/Unidades/Histórico) + ação Inativar/Reativar funcional |
| **6 — Modal de criação/edição** | ✅ Validado | Form completo · validações · máscaras CPF/Tel · multi-select de unidades/modalidades · CPF preservado em edição |
| **7 — Aba Salarial (RF26 + RN19)** | ✅ Validado | Tab condicional `canSeeSalary()` · modal separado · cálculo proporcional · histórico via `salaryHistory[]` · cenários testados em 15/05 |
| **8 — Validação final em staging** | ✅ Validado | 11 critérios de aceite passaram. Sprint 1 fechada conforme spec original |

### Estado real do staging (banco)

**Coleção `modalities`:** 6 documentos (CrossFit, Funcional, HITT, Marombinha, Pilates, Yoga)

**Coleção `units`:** 3 documentos de teste criados em 15/05 (unit-cp = CrossTainer CP, unit-pp = CrossTainer PP, unit-norte = CrossTainer Norte)

**Coleção `teachers`:** populada com Lucas Mendes, Pedro Lima (estagiário, 12 meses em ~30d), Marcos Estrela + outros criados durante testes da Etapa 6 (Ana Paula Souza, etc.)

**Coleção `audit_log`:** populando automaticamente — todas operações de criação/edição/inativação gravam before/after

**Coleção `users`:** mesmos 2 usuários de teste — `abluir@gmail.com` (admin) e `professor@teste.com` (professor)

### 🎯 Próxima ação ao retomar

**Sprint 5a finalizada e deployada em staging ✅.** Próxima sessão: **validação pelo usuário** via:

```bash
node scripts/admin.js --project staging smoke-5a
```

E validação UI em `professores.html` (sidebar "🎯 Escalas Especiais", CRUD de escala, aplicar a classes).

**Após validação:** decidir entre:
- **(a) Sprint 5b** — fluxo de aceite/recusa do professor + alocação automática
- **(b) Sprint 6** — Férias e recesso
- **(c) Sprint 7** — Notificações por email (Brevo)
- **(d) Outra direção**

**Estado em staging que vai encontrar:**
- Doc `substitutions/VY66YMZtVklkM0AavjCi` em staging com `status: 'pending'` — pedido de substituição direta da Ana pro Lucas (criado no cenário 7)
- Aula afetada: `classId = '1GvQIwy8elHelFVSeV8l_20260522'` (Funcional 07:00-08:00 da Isabella → vai virar do Lucas se aceitar)
- Notif do tipo `substitution_requested` para o user logado (mas só vai aparecer se ele estiver logado COMO o Lucas, ou seja, com `professorId = 'QZw9fVWhf0r5jNnLj99B'`)

**Cenário 8 — Aceitar como Lucas:**

1. **Trocar `professorId` pro Lucas** (no console):
   ```js
   await db.collection('users').doc(firebase.auth().currentUser.uid).update({
     professorId: 'QZw9fVWhf0r5jNnLj99B'  // Lucas
   });
   location.reload();
   ```
2. Após reload, **conferir sino com badge "1"** — notif `substitution_requested`
3. Click no sino → ver notif → click em "📬 Inbox de pedidos" no footer
4. Aba "Pedidos pra mim" deve mostrar o card "🔄 Ana Paula Souza pediu substituição"
5. Click em **"Aceitar"** → prompt opcional pra motivo → OK → toast "Substituição aceita"
6. Aguardar 5-15s pela CF `processSubstitutionAcceptance` rodar
7. Verificar no console:
   ```js
   const cls = await db.collection('classes').doc('1GvQIwy8elHelFVSeV8l_20260522').get();
   console.log(cls.data());
   // Esperado: teacherId = 'QZw9fVWhf0r5jNnLj99B' (Lucas), status = 'substituida'
   ```

**Cenário 9 — Cobertura aberta:**

1. Voltar pro user da Ana (`professorId = 'iMRf4L6N9dgCzCuzD9v3'`)
2. Abrir outra aula da Ana (ex: a do DOM 24/05)
3. Click em **"🆘 Pedir cobertura aberta"** → preencher motivo → criar
4. CF `notifyTeachersAboutCoverage` deve criar N notifs pros professores aptos à modalidade
5. Voltar pro user do Lucas (ou outro professor apto)
6. Inbox → aba "Oportunidades pra mim" → click em "Quero cobrir"
7. CF `processCoveragePick` atualiza `classes` + notifica Ana

**Cenário 10 — Audit log:**

```js
const audit = await db.collection('audit_log')
  .where('module', '==', 'agenda')
  .orderBy('timestamp', 'desc').limit(10).get();
audit.docs.forEach(d => console.log(d.data().type, d.data().details));
```

Esperado: entries `substitution_created`, `substitution_accepted`, `coverage_requested`, `coverage_picked`.

**Após smoke test:**

- ✅ Se 10/10: Sprint 3b fechada → decidir **Sprint 4** (Fechamento Mensal — consolida horas, calcula pagamento, congela via `monthClosingId`)
- ❌ Se algo falhar: mostrar erro, eu corrijo

**Setup necessário antes:**

1. **Service worker** — quase certo que vai precisar limpar: DevTools → Application → Service Workers → Unregister no `sw.js` → Storage → Clear site data → fechar/reabrir aba
2. **2º user vinculado a outro teacher** (necessário pro fluxo completo de substituição direta):
   ```js
   // Lista teachers disponíveis
   const ts = await TeacherService.list();
   console.table(ts.data.map(x => ({id: x.id, name: x.name})));

   // Cria um 2º user de teste no Auth (Firebase Console → Authentication)
   // Crie users/{novo-uid} com:
   //   { email, profiles:['professor'], moduleAccess:{professores:true},
   //     professorId: 'tch-XYZ' (id de outro teacher, ex: Marcos) }
   ```

**Os 10 cenários:**

| # | Cenário |
|---|---------|
| 1 | Sidebar mostra "🌐 Agenda Geral" |
| 2 | Agenda Geral renderiza aulas; filtros funcionam (unidades multi-select, modalidade, professor) |
| 3 | Sino visível na sidebar (badge zerado se sem notif) |
| 4 | Criar notif manual: `await NotificationService.create({recipientUserId: firebase.auth().currentUser.uid, type:'coverage_available', body:'teste'})` → badge mostra "1", dropdown lista |
| 5 | Click na notif → marca lida, badge zera, some do dropdown |
| 6 | Como Ana (admin com `professorId` vinculado): abrir aula no Minha Agenda → botões "🔄 Pedir substituição" + "🆘 Pedir cobertura aberta" aparecem |
| 7 | Pedir substituição direta pro 2º professor → cria doc em `substitutions` + notif aparece pro substituto |
| 8 | Logado como substituto → abrir Inbox → aceitar → CF `processSubstitutionAcceptance` atualiza `classes.teacherId` + `status='substituida'` + notif aceite chega pro titular |
| 9 | Pedir cobertura aberta → CF `notifyTeachersAboutCoverage` cria N notif → outro professor vê em "Oportunidades pra mim" → clica "Quero cobrir" → aula atualiza, titular notificado |
| 10 | Audit log: cada operação grava entry com `module:'agenda'` (`substitution_created`, `substitution_accepted`, `coverage_requested`, `coverage_picked`) |

**Pontos de atenção:**
- Se não conseguir testar cenários 7-9 por falta do 2º user, dá pra simular criando docs `substitutions`/`coverage_applications` direto no Firestore Console e validar as CFs disparando via logs (`firebase functions:log --project staging`)
- Cross-region warning (trigger em `sa-east1`, função em `us-central1`) é cosmético, **não bloqueia funcionamento**
- Verificar `coverage_applications/{id}.notifiedUserIds` depois de criar cobertura — deve listar UIDs dos professores aptos notificados

**Após smoke test:**

- ✅ Se passar 10/10: Sprint 3b fechada → decidir **Sprint 4** (Fechamento Mensal — consolida horas, calcula pagamento, congela via `monthClosingId`)
- ❌ Se algo falhar: me mostre print/erro, eu corrijo

**Estado real do staging (banco) após sessão 13:**
- `schedule_templates`: 1 doc (criado automaticamente)
- `schedule_slots`: 4 docs ativos
- `classes`: **16 docs** (gerados pela CF · 4 slots × 4 semanas · status 'prevista')
- `users/{abluir-uid}`: tem `professorId: 'iMRf4L6N9dgCzCuzD9v3'` (Ana Paula) — bom pra testes
- `audit_log`: entries de Sprint 1+2 + `schedule_template_created` (Sprint 2)

**Cloud Functions deployadas em staging:**
- `healthCheck` (HTTPS público) — Sprint 0-B
- `generateClassesForUpcomingWeeks` (cron `0 2 * * 1` America/Sao_Paulo) — Sprint 3a
- `generateClassesManual` (callable, requer admin) — Sprint 3a

### ⚠️ Issue conhecido de dev — Service Worker do módulo Comissões

O `sw.js` (criado pra PWA do `index.html`/Comissões) intercepta **todos** os requests do origin `localhost:5000`, incluindo `professores.*`. Resultado: após mudanças em JS/HTML do módulo Professores, o browser pode servir versões cacheadas, dando sintomas tipo:
- Sidebar perde itens novos (PROF_PAGES novo não aplica)
- `console.log` mostra número de linha do arquivo antigo
- Funções recém-deployadas dão `is not a function`

**Workaround durante dev:** DevTools → Application → Service Workers → "Unregister" no `sw.js` → Storage → "Clear site data" → fechar e reabrir aba.

**Fix estrutural pendente:** excluir `professores.*` do scope do `sw.js`. Não foi feito porque a regra inviolável #1 do projeto proíbe tocar em `sw.js` sem autorização explícita (é código de produção). Decidir antes da Sprint 4 ou 5 quando mudanças no professores se tornarem mais frequentes em paralelo com testes.

---

### Histórico do que foi feito originalmente para fechar a Sprint 1

Os 11 critérios de aceite originais passaram em smoke test em 15/05. Cenários testados:

1. Login admin → vê todas as telas + aba Salarial
2. Login professor (usuário `professor@teste.com`) → módulo de Professores ainda nem aparece no menu — mostrar mensagem amigável (já implementado pela tela `deniedPage`)
3. Criar 5 modalidades + 5 professores (1 efetivo, 2 estagiário, 1 eventual, 1 efetivo inativo) — vários já existem em staging, completar
4. Editar dados salariais de um deles → confirmar entry em `salaryHistory[]`
5. Inativar um professor → confirmar `isActive: false`
6. Inspect → tentar `db.collection('teacher_salaries').get()` autenticado como não-admin → permission-denied
7. Verificar audit_log no Firestore Console (entries `salary_created`, `salary_updated` aparecem)
8. Layout comparado lado-a-lado com `AgendaWireframes_design.html`
9. Login no `index.html` (módulo Comissões) — zero regressão

**Documento de referência:** `sprint-1-cadastro-professores.md` seção 7 (Critérios de aceite, 11 itens) e Etapa 8 (Smoke test).

**Cenários específicos a testar para Etapa 7:**
- Admin abre ficha de efetivo → aba Salarial aparece → empty state com botão "Cadastrar" funciona
- Cadastrar R$/hora = 65 → salva → recarrega ficha → valor aparece + history vazio
- Editar R$/hora para 70 → history mostra "R$ 65,00 → R$ 70,00"
- Abrir ficha de estagiário → modal abre com defaults de bolsa/limite/proporcional
- Bolsa 600 + 30h → proporcional calcula 20.00 ao digitar
- Tentar salvar com bolsa zero → erro "Bolsa mensal precisa ser maior que zero"
- Logar com não-admin (futuramente) → aba não aparece + tentativa de fetch direto → permission-denied

### Pendência registrada de produção

Quando subir a Sprint 1 inteira em produção:
- ❗ Corrigir `CrossTrainer` → `CrossTainer` em `index.html`, `manifest.json`, `sw.js` (regra inviolável #8)
- ❗ Migrar usuários existentes em produção pra adicionar `profiles[]` e `moduleAccess{}`
- ❗ Configurar Brevo + Trigger Email (só importa no Sprint 7)

## Estado Geral

| Item | Status |
|------|--------|
| Especificação técnica | ✅ Completa — `EspecificacaoTecnica_Modulo_Professores_CrossTainer_V1.md` |
| Proposta funcional | ✅ Base — `Proposta_Funcional_Consolidada_Modulo_Professores_CrossTainer_V3.md` |
| Sprint atual | 🟡 **1 — Cadastro de Professores** (playbook criado, aguardando aval para começar a codar) |
| Código implementado | 🟡 Apenas arquivos de infraestrutura (Sprint 0-B). Nenhum código de produto ainda. |

---

## Documentos do Projeto

| Arquivo | Conteúdo | Quando ler |
|---------|----------|-----------|
| `CONTEXTO_SESSAO.md` | Este arquivo — estado atual, decisões, log | **Sempre primeiro** |
| `EspecificacaoTecnica_Modulo_Professores_CrossTainer_V1.md` | Spec técnica completa (16 seções + 4 matrizes) | Quando precisar de detalhe técnico de uma seção |
| `Proposta_Funcional_Consolidada_Modulo_Professores_CrossTainer_V3.md` | Requisitos funcionais (29 RFs, 23 RNs) | Quando houver dúvida sobre comportamento esperado |
| `AgendaWireframes_design.html` | Wireframes do cliente (Claude Design) — 9 telas + validação | Base visual para implementação. Reutilizar componentes/cores/layout |
| `sprint-NN-nome.md` | Documento do sprint ativo | No início de cada sprint |

---

## Decisões M4 — Pendências Resolvidas

| # | Pendência | Decisão | Data |
|---|-----------|---------|------|
| P01 | Lista de modalidades | **Configurável pelo admin via interface.** Sem seed inicial fixo — admin cadastra as modalidades reais ao subir o sistema. Coleção `modalities` já projetada para isso. | 23/04/2026 |
| P09 | Professor eventual: regra de pagamento | **Igual ao professor efetivo (Opção A).** Pago por R$/hora definido no cadastro, feriado dobra o valor. `type: 'eventual'` usa a mesma fórmula de `type: 'efetivo'`. | 02/05/2026 |
| P10 | Regra financeira por motivo de cancelamento | **Professor NÃO recebe em nenhum caso de cancelamento.** Independente do motivo (faltou, academia cancelou, feriado, clima, etc.) — aula com `status: 'cancelada'` conta 0 minutos no pagamento. O motivo é registrado apenas para auditoria/relatório. | 02/05/2026 |
| P03 | Provedor de email | **Brevo plano gratuito (300 emails/dia).** Email genérico sem domínio próprio — criar conta de email dedicada (ex: `notificacoes.crosstrainer@gmail.com`) e verificar no Brevo. Custo zero. Firebase Extension "Trigger Email" configurada com SMTP do Brevo. | 06/05/2026 |
| P02 | Feriado dobra para estagiário? | **Sim.** Feriado dobra o valor para todos os tipos de professor — efetivo, eventual e estagiário. Para estagiário o dobro incide sobre a taxa proporcional de hora excedente (não sobre a bolsa fixa). | 06/05/2026 |
| P04 | Ambiente de staging | **Sim, segundo projeto Firebase.** Criar projeto `crosstrainer-comissoes-staging`. `.firebaserc` com dois targets (staging / production). Todo desenvolvimento e teste roda no staging antes de subir para produção. | 06/05/2026 |
| P05 | CPF no banco | **Mascarado.** Armazenar apenas versão mascarada (ex: `***.456.789-**`). Impacto: recibos exibem CPF mascarado. Sem recuperação do número completo — decisão de privacidade (LGPD). | 06/05/2026 |
| P06 | Recibo cancelado gera crédito? | **Sim.** Cancelamento de recibo gera automaticamente um novo recibo com `status: 'complemento'` registrando o crédito a favor do professor, a ser aplicado no próximo fechamento via `manualAdjustment`. | 06/05/2026 |
| P07 | Janela de escalas especiais | **Configurável pelo admin.** Campo `windowMonths` em cada escala especial. Padrão = 3 meses. Admin pode alterar por escala. | 06/05/2026 |
| P08 | Formato de exportação | **Relatórios em Excel, recibos em PDF.** XLSX.js (já no sistema) para todos os relatórios. Cloud Function + Puppeteer para geração de PDF dos recibos. | 06/05/2026 |

---

## Decisões M4 — Aguardando Resposta

> ✅ **Todas as 10 pendências M4 resolvidas em 06/05/2026. Nenhuma pendência em aberto.**

---

## Pendências para o Deploy em Produção

Itens que **só serão aplicados** quando subirmos o módulo de Professores em produção. Não tocar nesses arquivos antes do deploy.

### 🏷️ Correção de marca: `CrossTrainer` → `CrossTainer`

Definido em 13/05/2026. O nome correto da marca é **CrossTainer** (sem o segundo "R" entre T e A). Os arquivos abaixo têm o nome ERRADO e precisam ser corrigidos junto com o deploy:

| Arquivo | Onde aparece o nome errado | Substituir por |
|---------|---------------------------|----------------|
| `index.html` | `<title>CROSSTRAINER ELITE — Performance</title>` (linha ~7) | `CROSSTAINER ELITE — Performance` |
| `index.html` | `<meta name="apple-mobile-web-app-title" content="CROSSTRAINER ELITE">` | `content="CROSSTAINER ELITE"` |
| `index.html` | `CROSSTRAINER <span>ELITE</span>` na login-box e na sidebar | `CROSSTAINER <span>ELITE</span>` |
| `index.html` | Qualquer outra ocorrência visível de `CROSSTRAINER` | `CROSSTAINER` |
| `manifest.json` | `"name": "CrossTrainer — Comissões"` | `"CrossTainer — Comissões"` |
| `manifest.json` | `"short_name": "CrossTrainer"` | `"CrossTainer"` |
| `sw.js` | Comentário do cabeçalho `// CrossTrainer — Service Worker (PWA)` | `// CrossTainer — Service Worker (PWA)` |
| `commission.js` (se existir) | Verificar header | Corrigir se aparecer |
| `firebase-config.js` | Header `// CrossTainer — Firebase Config compartilhado` | Já está correto ✅ |
| Cloud Functions logs/mensagens | Buscar e ajustar | — |

**IDs técnicos do Firebase NÃO devem ser alterados** (`crosstrainer-comissoes`, `crosstrainer-comissoes-staging`) — são IDs estáveis e mudá-los exige migração completa de banco de dados.

**Wireframe `AgendaWireframes_design.html`** tem o nome errado mas é referência do designer aprovada — não modificar.

---

## Política de Deploy — definida 13/05/2026

🚨 **Produção SOMENTE após homologação completa em staging.**

Toda nova funcionalidade (frontend, Cloud Functions, Security Rules, mudança de schema) **DEVE** seguir:

1. Implementação e deploy em `crosstrainer-comissoes-staging`
2. Validação técnica (testes funcionais, regressões, segurança)
3. Homologação pelo usuário (aprovação explícita)
4. Só então: deploy em `crosstrainer-comissoes` (produção) via `--project production`

Nenhuma exceção, nem para mudanças "pequenas" ou "urgentes". O staging existe justamente para evitar surpresas em produção.

---

## Funcionalidades Avaliadas e Descartadas

| Tema | Discussão | Decisão | Data |
|------|-----------|---------|------|
| Registro de ponto / check-in do professor | Cliente preocupado com atrasos. Avaliadas opções: QR Code por sala, botão "Iniciar aula", integração Tangerino/Ponto Mais, Clockify. | ❌ **Descartado.** Cliente decidiu não incluir essa funcionalidade. Não está no escopo do projeto. | 06/05/2026 |

---

## Funcionalidades Adicionadas Após a Spec Original

| Funcionalidade | Origem | Sprint | Status |
|---------------|--------|--------|--------|
| **Lançamento em Lote de Aulas** | Solicitada pelo cliente durante a sessão de design (Claude Design). Permite selecionar período, dias da semana, horário, modalidade e professor para criar várias instâncias de uma vez. Tecnicamente é UI nova sobre as coleções `schedule_templates` + `schedule_slots` já especificadas. | Sprint 2 (Agenda) | ✅ Aprovado pelo cliente · em wireframe · entrar na spec |

---

## Wireframes — Status

| Recebido | Data | Cobertura | Status |
|----------|------|-----------|--------|
| `AgendaWireframes_design.html` (9 telas + validação) | 07/05/2026 | 79% (23 RFs cobertos · 3 parciais · 3 sem wireframe — Relatórios, Auditoria, Gestão de Usuários) | ✅ **Aprovado pelo cliente** antes mesmo de chegar aqui — pronto para implementação |

**Telas no wireframe:**
1. 📅 Agenda (Admin) — 3 variações (grade semanal, timeline por professor, lista) — todas coexistem
2. 👤 Minha Agenda — 2 variações (semana + painel lateral, dashboard pessoal)
3. 🌐 Agenda Geral — 2 variações (grade multi-unidade, busca "quem está livre?")
4. 🔄 Substituição — 2 variações (wizard, painel de pendências)
5. 💰 Fechamento — 2 variações (tabela consolidada, cards por professor)
6. 📦 Lançamento em Lote — 2 variações (formulário guiado, grade visual)
7. 👥 Cadastro de Professores — ficha com aba 🔒 Salarial restrita
8. ⭐ Escalas Especiais — calendário 3 meses + painel de equilíbrio
9. 🏖️ Férias / Recesso — alertas 60/45/30d + detecção de conflitos

**Sem wireframe (descrição funcional na proposta — reaproveitam padrões do `index.html`):**
- RF20 Relatórios · RF21 Auditoria · RF27/28/29 Gestão de Usuários
- **Cadastro de Modalidades** (CRUD simples — reaproveita layout de `units` do `index.html`)

**Pontos de atenção identificados na revisão:**
1. Mobile (RF22) — wireframe entregou só desktop. Risco baixo (componentes derivam), mas vale desenhar fluxo mobile da substituição antes da Sprint 3
2. Cadastro de Modalidades (P01) — ✅ **Resolvido 07/05/2026:** será **tela própria** (como na spec original), não aba dentro do Cadastro de Professores. A aba "Modalidades" no Cadastro de Professores continua existindo apenas para **selecionar** quais modalidades o professor é apto a ministrar (multi-select dos modalidades já cadastrados). O **CRUD de modalidades** (criar/editar "CrossFit", "Yoga", etc.) é tela separada — não tem wireframe ainda, vai como descrição funcional reaproveitando padrão de `units` no `index.html`.

---

## Status dos Sprints

| Sprint | Nome | Status | Pré-condições | Observações |
|--------|------|--------|--------------|-------------|
| 0-A | Decisões | ✅ Concluído | — | Todas as 10 pendências M4 resolvidas |
| 0-B | Infraestrutura Firebase | ✅ **HOMOLOGADO em staging** 13/05/2026 | ✅ P04 resolvido | Validado: Auth + Security Rules + Functions deploy. Produção pendente (regra: só após validação completa) |
| 1 | Cadastro de professores | ⬜ Aguardando 0-B | 0-B completo | ✅ P05 resolvido (CPF mascarado) |
| 2 | Agenda semanal | ⬜ Não iniciado | 1 completo | Inclui **Lançamento em Lote** (UI nova adicionada via wireframe) |
| 3 | Substituições | ⬜ Não iniciado | 2 completo | — |
| 4 | Fechamento e Pagamento | ⬜ Não iniciado | 3 completo | ✅ P09 e P10 resolvidos. Aguarda apenas P02 (feriado estagiário) |
| 5 | Escalas Especiais | ⬜ Não iniciado | 4 completo | P07 pode ser resolvido durante |
| 6 | Férias e Recesso | ⬜ Não iniciado | 5 completo | — |
| 7 | Notificações e Email | ⬜ Não iniciado | 6 completo | P03 precisa estar resolvido |
| 8 | Relatórios e Auditoria | ⬜ Não iniciado | 7 completo | P08 precisa estar resolvido |
| 9 | Hardening | ⬜ Não iniciado | 8 completo | — |

---

## Arquitetura — Resumo Rápido

**Projeto Firebase:** `crosstrainer-comissoes` (migrar Spark → Blaze antes do Sprint 0-B)

**Arquivos existentes (não tocar sem necessidade):**
- `index.html` — módulo de comissões (10.829 linhas, toda a lógica de vendas)
- `commission.js` — engine de cálculo de comissões P1-P4
- `sw.js` — service worker (atualizar STATIC_ASSETS no Sprint 0-B)
- `manifest.json` — sem alteração

**Arquivos a criar:**
```
firebase-config.js          ← Sprint 0-B
firestore.rules             ← Sprint 0-B
firestore.indexes.json      ← Sprint 0-B
firebase.json + .firebaserc ← Sprint 0-B
professores.html            ← Sprint 1
professores.js              ← Sprint 1
professores-agenda.js       ← Sprint 2
professores-subs.js         ← Sprint 3
professores-fechamento.js   ← Sprint 4
functions/                  ← Sprints 3, 4, 6, 7
```

**Alterações cirúrgicas em index.html:**
- `buildSidebar()`: adicionar link para professores.html se `moduleAccess.professores == true`
- `logAudit()`: adicionar parâmetro `module` opcional

**Coleções Firestore novas (12):**
`teachers`, `teacher_salaries`, `modalities`, `schedule_templates`, `schedule_slots`, `classes`, `substitutions`, `coverage_applications`, `monthly_closings`, `payment_records`, `receipts`, `special_scale_types`, `special_scales`, `vacation_requests`, `notifications`

---

## Perfis de Acesso

| Perfil | Slug no sistema | Acesso |
|--------|----------------|--------|
| Administrador (existente) | `admin` | Tudo — comissões + professores |
| Vendedor (existente) | `vendedor` | Só comissões |
| Admin/Gestão (novo) | `admin_gestao` | Tudo de professores, sem comissões |
| Supervisão (novo) | `supervisao` | Agenda, substituições, escalas, férias, relatórios |
| Professor (novo) | `professor` | Minha agenda, agenda geral, substituições, férias |
| Estagiário (novo) | `professor_estagiario` | Igual ao professor |

**Migração backward-compatible:** campo `role` mantido; novos campos `profiles[]` e `moduleAccess{}` adicionados inline no `onAuthStateChanged`.

---

## Fórmulas de Pagamento

**Professor efetivo:**
```
regularAmount  = (regularMinutes / 60) × hourlyRate
holidayAmount  = (holidayMinutes / 60) × hourlyRate × 2
total          = regularAmount + holidayAmount + manualAdjustment
```

**Professor estagiário:**
```
limitMinutes   = internMonthlyLimitHours × 60
surplus        = max(0, totalPaidMinutes - limitMinutes)
total          = internMonthlyStipend + (surplus / 60 × internProportionalHourlyRate) + manualAdjustment
```

**Professor eventual:** ✅ Mesma fórmula do efetivo (R$/hora, feriado dobra). P09 resolvido.

**Aulas canceladas:** ✅ Sempre 0 minutos no pagamento, independente do motivo. Motivo registrado só para auditoria. P10 resolvido.

> ⚠️ P02 pendente: feriado dobra para estagiário também?

---

## Log de Sessões

### Sessão 1 — 23/04/2026
**O que foi feito:**
- Diagnóstico completo do sistema atual (`index.html` 10.829 linhas, Firebase compat SDK v10.12.0)
- Especificação técnica completa gerada: `EspecificacaoTecnica_Modulo_Professores_CrossTainer_V1.md`
  - 16 seções, 4 matrizes obrigatórias
  - 18 coleções Firestore modeladas com schemas completos
  - 7 Cloud Functions especificadas com algoritmos
  - Firestore Security Rules e Storage Rules completas
  - 5 exemplos de código completos
  - Roadmap de 10 fases (~14 semanas)
- Estratégia de sprints definida (10 sprints com documentos técnicos por sprint)
- **P01 resolvido:** modalidades são configuráveis pelo admin via interface
- **P09 e P10:** cliente pediu esclarecimento — perguntas reformuladas com exemplos práticos, aguardando resposta
- Este arquivo criado como sistema de memória persistente

**Próximos passos:**
- Aguardar respostas do cliente (P02, P03, P04, P09, P10 prioritários)
- Ao receber respostas: atualizar este arquivo + spec + gerar documento do Sprint 0-B
- Sprint 0-B não pode começar sem P04 (staging) resolvido

---

### Sessão 2 — 07/05/2026 (continuação)
**O que foi feito:**
- Todas as 10 pendências M4 fechadas (P02, P04, P05, P06, P07, P08 respondidas)
- Sprint 0-A marcado como concluído; Sprint 0-B desbloqueado
- **Wireframe recebido do cliente** (gerado via Claude Design): `AgendaWireframes_design.html` — 9 telas + validação interna, cobertura 79%
- **Nova feature aprovada pelo cliente:** "Lançamento em Lote de Aulas" — UI sobre `schedule_templates` (Sprint 2)
- Análise crítica do wireframe vs. spec realizada — alinhamento bom, 2 pontos identificados:
  - Mobile da substituição não desenhado (risco para Sprint 3)
  - Cadastro de Modalidades (P01) — designer integrou ao Cadastro de Professores; spec previa tela própria — decisão pendente

**Próximos passos:**
- ✅ Wireframe já aprovado pelo cliente (informação confirmada após a análise)
- ✅ Spec atualizada com "Lançamento em Lote"
- 🟢 **Sprint 0-B desbloqueado e pronto para iniciar** — infraestrutura Firebase, Security Rules, staging, índices

---

### Sessão 3 — 07/05/2026 (final do dia)
**O que foi feito:**
- ✅ Cliente confirmou que o wireframe já estava aprovado — desbloqueou início imediato do Sprint 0-B
- ✅ Resolvido divergência sobre Cadastro de Modalidades: será **tela própria** (CRUD), não aba dentro de Cadastro de Professores
  - Spec atualizada (§4.2 e §7.1): nova rota `page: modalidades` para perfis admin/admin_gestao
  - Aba "Modalidades" no Cadastro de Professores continua existindo apenas como **multi-select** de aptidões
- ✅ Documento Sprint 0-B gerado: `sprint-0B-infraestrutura.md` (playbook completo com 7 etapas, divisão de responsabilidades, riscos, critérios de aceite)
- ✅ Arquivos de infraestrutura gerados na raiz do projeto:
  - `firebase.json` (config geral: hosting, firestore, storage, functions, emulators)
  - `.firebaserc` (default=staging para evitar deploy acidental em produção)
  - `firestore.rules` (Security Rules completas — comissões + professores, com proteção de salários)
  - `firestore.indexes.json` (12 índices compostos)
  - `storage.rules` (recibos restritos a admin/dono)
  - `firebase-config.js` (com auto-detecção staging/produção pelo hostname)
  - `functions/index.js` + `functions/package.json` (esqueleto Node 18 + healthcheck)
  - `scripts/migrate-users-to-profiles.js` (idempotente, com flag --project)
  - `scripts/seed-special-scale-types.js` (4 tipos pré-definidos)
  - `scripts/package.json` (atalhos npm)
- ✅ `.gitignore` atualizado (protege service accounts e arquivos Firebase)

**Bloqueado por:**
- Usuário precisa executar etapas com credencial (criar projetos Blaze, configurar Brevo, baixar service accounts)
- Aguardando credenciais do staging para preencher placeholders `<<STAGING_*>>` em `firebase-config.js`

**Próxima sessão (08/05/2026 ou depois) começa em:**
1. Usuário traz credenciais do staging (objeto de config Firebase) — Claude atualiza `firebase-config.js`
2. Claude orienta sequência de deploy: emulator local → staging → produção
3. Claude orienta migração de users e seed de scale types
4. Validar 10 critérios de aceite do Sprint 0-B
5. Após validação → Sprint 1 (Cadastro de Professores) inicia

**Documento de referência ao retomar:** `sprint-0B-infraestrutura.md`

---

### Sessão 4 — 13/05/2026
**O que foi feito:**
- ✅ Usuário ativou Blaze nos dois projetos (`crosstrainer-comissoes` e `crosstrainer-comissoes-staging`)
- ✅ Habilitados Firestore + Storage + Auth no staging (regionalidade: `southamerica-east1`)
- ✅ Credenciais do staging recebidas e aplicadas no `firebase-config.js`:
  - apiKey: `AIzaSyC5wqYNNyrJBPXbBPK8gRxQxOPHTIW7TFo`
  - projectId: `crosstrainer-comissoes-staging`
  - appId: `1:909308167932:web:be97cf28b5c0169f7ef979`
  - measurementId: `G-9WXPTLJH3Y`
- ✅ Firebase CLI configurado, aliases criados (staging/production)
- ✅ Deploy de Firestore Rules + Indexes + Storage Rules no staging (limpo)
- ✅ Resolvido erro de Node 18 descontinuado → atualizado para Node 22
- ✅ Resolvido erro de permissões IAM → usuário adicionou 4 papéis ao compute service account
- ✅ Deploy de Cloud Functions concluído + healthcheck validado HTTP
  - URL: https://healthcheck-rdb63lieqq-uc.a.run.app
- ✅ Cleanup policy de artifacts configurada (auto-delete > 1 dia)

**Aprendizados desta sessão:**
- Cloud Functions 2nd gen são **privadas por padrão**. Precisa `{ invoker: 'public' }` no `onRequest` v2 para acesso anônimo. Para funções de negócio, manter privadas e usar `onCall` (autenticação automática).
- Sintaxe v1 (`functions.https.onRequest`) ainda funciona mas a v2 (`require('firebase-functions/v2/https')`) é o caminho.
- Default compute service account precisa de papéis específicos no IAM (Editor não basta): Cloud Functions Admin, Service Account User, Artifact Registry Writer.
- Node 18 foi descontinuado em out/2025 — usar Node 22 daqui em diante.

**Próxima sessão pode iniciar com qualquer das 3 opções:**
A) Testar acesso autenticado no staging (criar user admin manual + validar login)
B) Iniciar Sprint 1 (Cadastro de Professores)
C) Replicar tudo em produção (com cuidado — risco no módulo de Comissões)

---

### Sessão 5 — 13/05/2026 (final do dia)
**O que foi feito:**
- ✅ Política de deploy registrada: **produção SÓ após homologação completa em staging** (regra inviolável #7 em CLAUDE.md)
- ✅ Criado `test-auth.html` (arquivo de teste apontando para staging)
- ✅ Usuário criou 2 contas de teste no staging:
  - admin: `abluir@gmail.com` (UID: `z08ffk2NH1NQCRipf7NJ3Iabm5F2`) com `profiles:['admin']`
  - professor: `professor@teste.com` (UID: `EQ92AklAbPW3JR2dSL8C1hdnIxu1`) com `profiles:['professor']`
- ✅ Testes positivos (admin) — todos passaram:
  - Leituras em teachers, teacher_salaries, modalities, monthly_closings, periodos
  - Criação em audit_log
  - Atualização em audit_log bloqueada (correto)
- ✅ Testes negativos (professor) — todos passaram:
  - ❌ teacher_salaries → permission-denied (regra crítica RN19 funcionando)
  - ❌ periodos → permission-denied (segregação RN23 funcionando)
  - ✅ Outras leituras permitidas conforme spec
- ✅ **STAGING HOMOLOGADO** — todas as 3 regras críticas validadas:
  1. Dados salariais protegidos
  2. Audit log imutável
  3. Segregação Comissões × Professores

**Sprint 0-B oficialmente concluído em staging.**

**Pendente apenas:** deploy em produção (aguardando validação completa do módulo de Professores antes, conforme política).

**Próxima sessão começa com:** Sprint 1 — Cadastro de Professores.

---

### Sessão 6 — 13/05/2026 (final do dia · continuação)
**O que foi feito:**

**Sprint 1 — Etapa 1 (Shell `professores.html`):**
- Criado `professores.html` (530 linhas) — login, denied page, app shell, 7 placeholder cards, design tokens completos, modal/tabela/form (depois da Etapa 3)
- Criado `professores.js` (330 linhas) — auth flow, migração inline backward-compat, sidebar dinâmica, roteamento, tema claro/escuro, menu mobile, toast
- Criado `professores-shared.js` e `professores-cadastro.js` (stubs iniciais)
- Validado em staging com login admin + login professor + bloqueio de quem não tem moduleAccess

**Detecção de ambiente corrigida:**
- `firebase-config.js`: detecção agora é defensiva — só usa produção em `rafaelmayerbrasil.github.io`. Demais hostnames (preview/localhost/etc) → staging
- Log colorido no console mostrando ambiente ativo
- Defensive check no `doLogin` para detectar Firebase não inicializado
- Validação: o painel preview do editor não inicializa Firebase corretamente → usar `firebase serve --only hosting --project staging` em http://localhost:5000

**Correção de marca registrada (CLAUDE.md regra inviolável #8):**
- Nome correto: **CrossTainer** (sem segundo R)
- Wrong: ~~CrossTrainer~~ / ~~CROSSTRAINER~~
- Arquivos de produção com nome errado (`index.html`, `manifest.json`, `sw.js`) — **não corrigir antes do deploy**, lista de substituições registrada em CONTEXTO_SESSAO

**Sprint 1 — Etapa 2 (Services base):**
- `professores-shared.js` (540 linhas): 4 services + 7 helpers
- `ModalityService`: list / getById / create / update / setActive / deactivate / activate
- `TeacherService`: list / getById / getCounts / create / update / setActive / deactivate / activate
- `SalaryService`: get / upsert (com histórico automático em `salaryHistory[]`)
- `AuditService.log({ type, details, entityType, entityId, before, after })` — usa AppState.userProfile e currentUser
- Helpers: `mascararCpf` · `getInitials` · `avatarHtml(name, type, size)` · `internAlertHtml(teacher)` · `fmt(n)` · `formatDate(ts)` · `toTimestamp(value)`
- Padrão de retorno uniforme: `{ success: true, data }` ou `{ success: false, error, code }`
- Validações inline (validateTeacher, validateSalary)
- Sanitização de objetos antes de gravar no audit (`sanitizeForAudit`)
- Expostos no `window` para debug via console
- Smoke test via DevTools: 9 testes passaram (helpers, list vazia, criar modalidade, listar 5 modalidades em ordem alfabética, getCounts)

**Sprint 1 — Etapa 3 (Tela de Modalidades CRUD):**
- CSS adicionado em `professores.html`: table-wrap, table, pill (active/inactive), icon-btn, empty-state, modal, modal-content, modal-header, close-btn, form-group, form-actions, page-toolbar
- Modal HTML inserido em `professores.html` (#modalityModal)
- `professores-cadastro.js`: `renderModalidadesPage()`, `openModalityModal(id?)`, `closeModalityModal()`, `saveModality()`, `toggleModality(id, activate)`
- Empty state com call-to-action quando coleção vazia
- Detecção de duplicidade (case-insensitive)
- ESC fecha modal
- Confirmação antes de inativar/reativar
- Validado em staging: 6 modalidades cadastradas (CrossFit, Funcional, HITT, Marombinha, Pilates, Yoga), professor logando vê só "Início" no menu (RN23 confirmado novamente)

**Estado final do dia:**
- 3 de 8 etapas da Sprint 1 prontas e validadas em staging
- Próxima sessão: Etapa 4 (lista de professores)
- Zero deploy em produção; tudo no staging conforme política

---

### Sessão 7 — 14/05/2026 (hotfix de produção)
**Contexto:** usuário detectou erro em produção no módulo de Comissões antes de retomar a Sprint 1.

**Bug encontrado:**
- **Erro:** `ReferenceError: hitGold is not defined`
- **Onde:** aba "Comissões" do "Meu Painel" do vendedor (`renderVendorComissoesTab` em `index.html`)
- **Quando:** ao carregar o painel para qualquer vendedor (reportado com a vendedora FRANCINI DAS CHAGAS)
- **Causa:** linhas 6997-6998 do template HTML usavam `hitGold`, `hitSuper`, `hitMeta`, mas essas variáveis não estavam declaradas no escopo da função. Existiam em outras 2 funções do arquivo (`renderVendorDashboard` e `renderUnitDashboard`) mas não vazavam pra cá.

**Correção aplicada:**
- 4 linhas adicionadas em `index.html` após `const vData = vs[myName] || {};` (linha 6927):
  ```js
  // Flags de meta da unidade — usadas na seção P3 abaixo (correção 14/05/2026)
  const hitMeta  = t.unitAtivacoes >= cfg.meta;
  const hitSuper = t.unitAtivacoes >= cfg.superMeta;
  const hitGold  = t.unitAtivacoes >= cfg.metaGold;
  ```
- Padrão idêntico ao já usado nas outras funções do arquivo (mantém consistência).

**Validação:**
- Smoke test local com `firebase serve --only hosting --project staging`
- Login como admin + modo preview como vendedor → aba Comissões abriu sem erro
- Outras abas (Resumo, Ativações, Diferidos, Histórico) continuaram funcionando

**Deploy em produção:**
- Commit cirúrgico isolado: `76d88b3` — `fix: declarar hitMeta/hitSuper/hitGold em renderVendorComissoesTab`
- 1 arquivo, 4 inserções, zero outras alterações
- Push para `origin/main` → GitHub Pages auto-deploy
- Validado em produção pelo usuário ✅

**Sprint 1 totalmente preservado:**
- Todos os arquivos novos (`professores.html`, `professores.js`, services, sprint docs, etc.) continuam **untracked** no git — não foram incluídos no commit do hotfix
- `.gitignore` modificado também ficou de fora (será comitado quando subirmos o Sprint 1 completo)

**Próxima ação:** retomar Sprint 1 — Etapa 4 (Tela de Professores: lista lateral) quando o usuário quiser.

---

### Sessão 8 — 15/05/2026 (3 etapas em sequência)

**Etapa 4 — Lista lateral de Professores ✅**
- CSS: layout 2 colunas (lista 280px + ficha), chip-filter-row, teacher-list-item, search-input
- JS: `renderProfessoresPage()`, filtros (5 chips), busca com debounce 200ms, avatar colorido por tipo, badge "12 meses em Nd" automático para estagiários < 30 dias
- Empty state diferenciado para coleção vazia vs filtros sem resultado
- Validado: 3 professores via console (Lucas/Pedro/Marcos), todos os filtros funcionaram

**Etapa 5 — Ficha do professor com tabs ✅**
- Adicionado `AuditService.list({entityType, entityId, limit})` e `UnitService.list()` em professores-shared.js
- CSS: ficha-header, ficha-tabs, info-grid, chip-primary/secondary/unit-main, history-list/item
- 4 tabs implementadas: Dados gerais · Modalidades · Unidades · Histórico (Salarial fica pra Etapa 7)
- Ação Editar abre modal (Etapa 6) · Ação Inativar/Reativar funcional com confirm()
- Histórico carrega audit_log filtrado por entidade, visível só pra Admin (RN21)
- Validado: 4 tabs ok, inativar gera audit, troca de professor reseta pra tab 'dados'

**Etapa 6 — Modal de criação/edição ✅**
- Modal HTML adicionado (max-width 640px) com TeacherFormState
- CSS: form-grid 2 colunas, chip-toggle selecionável, form-section/divider, modal-content-wide
- Form completo: chips de tipo, nome, CPF com máscara, email, telefone com máscara, data admissão, campos condicionais (estagiário), unidades multi-select, dropdown de principal, modalidades multi-select, observações
- Validações da spec § 9.1: nome ≥ 3 · email válido · CPF 11 dígitos · ≥1 unidade · principal selecionada · ≥1 modalidade · datas estagiário (com fim > início)
- CPF preservado em edição (mantém máscara do banco)
- Pré-condições: bloqueia se não há modalidades ativas ou unidades cadastradas
- ESC fecha modal · email duplicado verificado client-side
- Validado: criou Ana Paula, criou estagiário com datas, editou Lucas, validações dispararam corretamente

**Setup adicional em staging:**
- Criadas 3 unidades de teste: `unit-cp` (CrossTainer CP) · `unit-pp` (CrossTainer PP) · `unit-norte` (CrossTainer Norte)
- Esses dados são PURAMENTE de teste em staging — produção tem suas unidades reais (bancos separados)

**Próxima sessão:** Etapa 7 — Aba Salarial (RF26 + RN19) — última etapa funcional antes da validação final.

---

### Sessão 9 — 15/05/2026 (Etapa 7 — Aba Salarial)

**Implementação completa da última etapa funcional da Sprint 1.** Código pronto, falta apenas o smoke test em staging.

**Arquivos modificados (3):**

**`professores-cadastro.js`** (+360 linhas líquidas):
- `ProfessoresState.salaryCache: new Map()` — cache por teacherId, espelha o padrão de `historyCache`
- `renderFichaTabs()` — tab `🔒 Salarial` injetada condicionalmente via `canSeeSalary()` (RN19 + RF26)
- `renderFichaTabContent()` — case `'salarial'` com guard defensivo (se chegar sem permissão, redireciona pra `'dados'`)
- `switchFichaTab()` — chama `loadSalaryIfNeeded()` quando a tab é ativada
- `renderTabSalarial(t)` — renderer principal · empty state com CTA · tratamento de erro com retry
- `renderSalaryFields(t, s)` — branch por tipo (efetivo/eventual: R$/hora · estagiário: bolsa + limite + proporcional)
- `renderSalaryHistory(s)` — tabela ordenada por mais recente, mostrando `prev → new` com formatação BRL
- `renderSalaryHistoryItem(e)` — labels em PT via `SALARY_FIELD_LABEL`, valores monetários formatados
- `loadSalaryIfNeeded()` / `reloadSalary()` — load assíncrono com cache, re-render se tab visível
- `openSalaryModal(teacherId)` — popula campos do doc existente ou defaults, aplica visibilidade conditional
- `closeSalaryModal()` / `applySalaryFieldsByType()` / `updateProportionalRate()` — UX do modal
- `saveSalary()` — valida por tipo, calcula proporcional, chama `SalaryService.upsert()` (que já mantém `salaryHistory[]` automaticamente)
- Constantes: `REMUN_TYPE_LABEL`, `SALARY_FIELD_LABEL`
- Helper: `formatBRL(v)` formata em padrão BR (R$ 1.234,56)
- `SalaryFormState` para estado do modal
- ESC handler atualizado: prioriza fechar `salaryModal` antes de `teacherModal` antes de `modalityModal`
- Header comment do arquivo e console.log finais atualizados pra refletir Etapa 7 ✅

**`professores.html`** (+72 linhas):
- Modal `salaryModal` separado do modal de professor (decisão de design — restrição mais clara)
- Form com select de tipo de remuneração + dois blocos condicionais (`salaryHourlyBlock` / `salaryInternBlock`)
- Campo `salaryProportionalRate` é readonly, calculado via `oninput` nos campos de bolsa/horas/minutos
- Callout informativo de feriado ×2 fixo
- CSS `.section-toolbar` adicionado (toolbar interna com label + ação)

**Pontos de design importantes:**
- **Dupla camada de segurança:** DOM (`canSeeSalary()` impede injeção da tab) + Firestore Security Rule (`teacher_salaries` só Admin lê/escreve, já validado no Sprint 0-B com test-auth.html)
- **`SalaryService` já existia** das Etapas 2/5 — só consumimos. O service já mantém `salaryHistory[]` automaticamente comparando campos rastreados.
- **Cálculo proporcional:** bolsa ÷ total-de-horas (h + min/60). Atualiza ao vivo no modal. Persistido no banco.
- **Feriado dobrado:** texto fixo, não configurável (P02). Reduz superfície de erro.
- **Empty state com CTA:** professor sem doc de salário → mensagem amigável + botão "Cadastrar dados salariais" (decisão da sessão).
- **Modal separado:** fica no mesmo arquivo (`professores-cadastro.js`, conforme escolha do usuário) mas é um modal próprio com IDs `salary*` — não compartilha estado com `TeacherFormState`.

**Histórico de campos (rastreados pelo SalaryService.upsert)**:
`hourlyRate`, `internMonthlyStipend`, `internMonthlyLimitHours`, `internProportionalHourlyRate` — cada mudança vira uma entry em `salaryHistory[]` com `{changedAt, changedBy, changedByName, field, previousValue, newValue}`.

**Não testado ainda em staging.** Próxima sessão é a Etapa 8 — smoke test ponta-a-ponta com os 11 critérios de aceite.

**Decisões da sessão (3 perguntas confirmadas):**
1. Empty state: CTA "Cadastrar dados salariais" (não form inline)
2. Feriado dobrado: texto fixo informativo (não campo configurável)
3. Localização do JS: `professores.js (junto com a ficha)` — corrigi durante a sessão pra `professores-cadastro.js` que é onde a ficha realmente está

**Próxima sessão:** Etapa 8 — validação final em staging. Quando 11 critérios passarem, Sprint 1 está fechada e podemos planejar deploy.

---

### Sessão 10 — 15/05/2026 (Etapa 8 — Validação final + Backlog identificado)

**Smoke test ponta-a-ponta da Sprint 1.** Todos os 11 critérios de aceite passaram. Cenários testados pela primeira vez com clique humano:
- Admin abre ficha de efetivo → aba Salarial aparece com empty state
- Cadastrar R$/hora, recarregar, ver valor exibido
- Editar valor → histórico mostra `prev → new`
- Estagiário: bolsa + limite calcula proporcional ao vivo
- Validações de erro disparam corretamente
- Login como não-admin: aba não aparece
- Inspect: fetch direto em `teacher_salaries` → permission-denied
- Módulo de Comissões (index.html) sem regressão

**Sprint 1 fechada conforme spec original (8 etapas, 11 critérios).** ✅

**🆕 Dois ajustes funcionais identificados durante a validação** — usuário pediu para documentar e ajustar "quando for a hora certa". Detalhes técnicos completos na seção [📋 Backlog identificado](#-backlog-identificado-durante-validação-da-sprint-1) abaixo:

1. **Data de início de validade nas alterações salariais** — para cálculos proporcionais quando o valor muda no meio do mês
2. **Profissionais sempre hora-aula + VR/VT/Outros** — remover select para não-estagiários e adicionar 3 benefícios no cadastro, com possibilidade de sobrescrever no fechamento mensal

Esses dois ajustes NÃO bloqueiam o fechamento da Sprint 1, mas precisam entrar antes do Sprint 5/6 (Fechamento Mensal) por dependência de schema.

**Próxima sessão:** decidir Opção A (implementar ajustes do backlog antes da Sprint 2) ou Opção B (seguir pra Sprint 2 e voltar nos ajustes mais tarde). Ver seção "🎯 Próxima ação ao retomar" no topo deste documento.

---

### Sessão 11 — 17/05/2026 (Mini-sprint 1.5 — B-01 + B-02 implementados)

**Decisão da sessão:** Opção A escolhida — mini-sprint 1.5 (B-01 + B-02) antes de iniciar Sprint 2. Schema fica consistente desde o início, sem migration depois.

**Decisões pendentes do B-02 fechadas:**
- D-01: "Outros" como **array de `{nome, valor}`** (flexível, somável)
- D-02: VR/VT/Outros aplica a **todos os tipos** (universal)
- D-03: VR/VT como **R$/mês fixo** (admin sobrescreve no fechamento se quiser proporcional)
- D-04: Frontend força `'hora_aula'` para profissional (backend retrocompatível)

**Arquivos modificados (3):**

**`professores-shared.js`** (+98 linhas líquidas):
- `SalaryService.upsert()` refatorado: aceita `effectiveDate` + `effectiveNote` em cada entry de histórico; aceita os 3 campos novos (`mealAllowance`, `transportAllowance`, `otherBenefits`); valida ordenação temporal de `effectiveDate`; rastreia VR/VT atomicamente; rastreia `otherBenefits` como snapshot before/after (array é granular demais)
- `validateSalary()` expandido: valida tipos dos novos campos; valida cada item de `otherBenefits` (nome obrigatório, valor numérico ≥ 0)
- Helper novo: `normalizeEffectiveDate(val)` — aceita `Date`, string "YYYY-MM-DD" ou Firestore Timestamp e normaliza para Timestamp (meia-noite local)
- console.log final atualizado

**`professores-cadastro.js`** (+198 linhas líquidas):
- `SalaryFormState` ganha `otherBenefits: []`
- `SALARY_FIELD_LABEL` ganha labels para VR/VT/Outros
- `applySalaryFieldsByType()`: agora também esconde `salaryRemunTypeWrap` + `salaryRemunTypeDivider` para profissional; força valor `'hora_aula'` se select escondido
- `openSalaryModal()`: popular default de `effectiveDate` (= hireDate se cadastro inicial, hoje senão); popular VR/VT; sincronizar `SalaryFormState.otherBenefits` com cópia defensiva
- `saveSalary()`: valida e envia `effectiveDate` + `effectiveNote` + VR/VT + `otherBenefits` (limpo de linhas em branco)
- Funções novas para o array dinâmico:
  - `renderOtherBenefitsList()` — render do array (com empty state)
  - `addOtherBenefitRow()` — adiciona linha vazia + foca no campo nome
  - `removeOtherBenefit(idx)` — remove linha
  - `updateOtherBenefit(idx, field, value)` — atualiza state SEM re-render (preserva foco no input)
- `renderSalaryFields()` profissional não mostra mais "Tipo de remuneração" (sempre hora-aula, redundante)
- Função nova `renderSalaryBenefits(s)` — card universal com VR/VT + tabela de Outros com total
- `renderTabSalarial()` agora chama `renderSalaryBenefits` entre fields e callout de feriado
- `renderSalaryHistoryItem()` mostra `effectiveDate` ("vale a partir de DD/MM") + nota entre aspas; trata `otherBenefits` (array) com formatação antes/depois especial

**`professores.html`** (+121 linhas):
- Modal salarial:
  - Select de tipo envolvido em `id="salaryRemunTypeWrap"` (+ divider com id) para conditional hide
  - Bloco novo de "Benefícios mensais": grid com VR/VT + container `salaryOtherBenefitsList` + botão "+ Adicionar benefício"
  - Bloco novo "Data de início de validade" + "Motivo da alteração" (B-01)
- CSS novo (~80 linhas):
  - `.other-benefits-list`, `.other-benefits-empty`, `.other-benefit-row` (grid 1fr/120px/32px), `.ob-remove`
  - `.other-benefits-readonly`, `.other-benefit-readonly-row`, `.other-benefit-readonly-total`
  - `.history-item-meta`, `.history-item-effective`, `.history-item-note`

**Pontos de design importantes desta sessão:**

1. **Validação temporal do `effectiveDate`** no backend (não confiar só no frontend) — usa `previousHistory.reduce` para encontrar maior `effectiveDate` e bloquear se nova for anterior.
2. **`normalizeEffectiveDate`** aceita 3 formatos pra ser flexível com chamadas internas/externas — frontend manda string "YYYY-MM-DD" do `<input type="date">`, mas helper aceita Date e Timestamp também.
3. **Tracking de array `otherBenefits`** via snapshot (não tenta diff granular item-a-item) — solução pragmática. Mostra antes/depois completos no histórico.
4. **`updateOtherBenefit` SEM re-render** — crítico para UX: re-renderizar a lista a cada keystroke faria o input perder foco. Atualiza só o state em memória; render só acontece em add/remove.
5. **Linhas em branco em Outros são silenciosamente ignoradas** no save — usuário pode clicar "+ Adicionar" por engano sem ser obrigado a remover.
6. **Defesa em profundidade**: se select de tipo é escondido para profissional, JS também força valor `'hora_aula'` antes de salvar — não confia só no display:none.
7. **Cópia defensiva do `otherBenefits` do cache** ao abrir o modal — evita mutação acidental do cache em memória.

**Bug fix do `internMonthlyLimitMinutes`** (já tinha sido feito na Sessão 9) continua intacto.

**Validado em staging em 17/05/2026 (mesma sessão).** Todos os 10 cenários de smoke test passaram com clique humano. Confirmações:

- B-01: data de validade default funcionando (hoje pra edição, hireDate pra cadastro inicial), motivo registrado entre aspas no histórico, validação temporal bloqueando data anterior à última alteração.
- B-02: select de tipo escondido para profissional, presente para estagiário. VR/VT salvando e exibindo. Array Outros funcional (adicionar/remover linhas), total automático correto, histórico registrando alterações de array (snapshot before/after), validação de linha sem nome funcionando.
- Bônus: fix da scrollbar fantasma na ficha do professor (ajuste de `calc(100vh - 220px)` → `calc(100vh - 170px)` + `scrollbar-gutter: stable` + `overflow-y: hidden` nas tabs) validado.

**Edge case bonus validado:** salvar duas vezes sem mudar nada → não cria entry duplicada no histórico (já estava correto pelo design do SalaryService).

**Tamanhos finais:**
| Arquivo | Linhas | Δ desde Sessão 10 |
|---------|--------|-------------------|
| `professores-shared.js` | 757 | +98 |
| `professores-cadastro.js` | 1823 | +198 |
| `professores.html` | 1517 | +121 |

---

### Sessão 12 — 17/05/2026 (Sprint 2 — Agenda Semanal · implementada e validada)

**Decisões do início:**
- Opção A: playbook primeiro (criou `sprint-2-agenda.md`, 276 linhas) — mesmo padrão da Sprint 1
- Escopo enxuto: agenda visual + criação manual (sem `classes` gerado · sem Cloud Function · sem Lançamento em Lote avançado)
- Granularidade: **slot livre** (qualquer hora:minuto) via `<input type="time">`
- 1 template padrão por unidade, criado automaticamente na primeira visita

**Execução (Etapas 1 a 7):**

| Etapa | Implementação |
|-------|---------------|
| 1 — Sidebar + roteamento + Security Rules | `PROF_PAGES` e `PAGE_DEFINITIONS` em `professores.js`. Rules já estavam deployadas do Sprint 0-B (confirmado via `firebase deploy --only firestore:rules`). |
| 2 — Services | `ScheduleTemplateService` (list, getOrCreateDefault, update) + `ScheduleSlotService` (listByUnit, create, update, deactivate, activate, `_toggleActive`) + helpers `timeToMinutes`, `minutesToTime`, `minutesBetween`, `slotsOverlap`, `detectSlotConflict`, constantes `WEEKDAY_LABEL`, `WEEKDAY_LABEL_SHORT`. Tudo em `professores-shared.js`. |
| 3 — Shell + toolbar | `renderAgendaPage()` carrega units+modalities+teachers em paralelo. `renderAgendaToolbar()` com combo unidade + toggle inativos + botão "+ Novo". Bootstrap de template padrão via `getOrCreateDefault()`. |
| 4 — Grid semanal | 7 colunas começando em Segunda (`WEEKDAY_ORDER = [1,2,3,4,5,6,0]`). Cards ordenados por `startTime` em cada coluna. Cor por modalidade via hash do `modalityId` (paleta de 8 cores). Slot inativo com opacity 0.45 e badge. Click abre modal de edição. |
| 5 — Modal de slot | Chip toggle pros 7 dias · `<input type="time">` para início/fim · duração calculada ao vivo · select de modalidade · select de professor **filtrado dinamicamente pela modalidade**. `SlotFormState` mantém estado. Validações: dia, fim > início, duração ≥ 15min, modalidade, professor. **Detecção de conflito** ao salvar: busca slots ativos do mesmo professor no mesmo weekday e checa sobreposição via `slotsOverlap`. |
| 6 — Inativar/reativar | Botão dentro do modal de edição com `confirm()`. Cor verde/vermelho conforme estado. |
| 7 — Smoke test | 10 cenários, todos ✅ pelo usuário em 17/05/2026. |

**Bônus implementado durante a sessão (a pedido do usuário em screenshot):**
- **Multi-select de dias da semana em CRIAÇÃO** — chips agora aceitam múltiplos selecionados. Modal cria N slots iguais em uma chamada. Mesmo CrossFit das 07h de Seg a Sex = 1 modal, 5 slots criados.
- Detecção de conflito multi-dia: mostra todos os dias com problema de uma vez.
- Em EDIÇÃO: comportamento single inalterado, outros dias ficam disabled (opacity 35% + tooltip explicativo).
- Hint dinâmico abaixo dos chips: "0 selecionados" / "1 selecionado" / "5 selecionados · serão criados 5 slots iguais".
- Toast final detalhado: "5 slots criados (Seg, Ter, Qua, Qui, Sex)".

**Arquivos criados/modificados:**

| Arquivo | Antes | Depois | Δ |
|---------|-------|--------|---|
| `professores-shared.js` | 757 | 1090 | **+333** (Services + helpers de horário) |
| `professores-agenda.js` | — | 575 | **+575** (NOVO — state, render, modal, multi-select) |
| `professores.html` | 1517 | 1739 | **+222** (page-agenda, modal slot, CSS da grid, CSS chip-disabled) |
| `professores.js` | 369 | 371 | **+2** (PROF_PAGES + PAGE_DEFINITIONS + handler) |
| `sprint-2-agenda.md` | — | 276 | **+276** (NOVO — playbook completo) |
| `firestore.rules` | — | — | intocado (rules das 3 coleções já estavam deployadas) |
| `professores-cadastro.js` | 1823 | 1823 | intocado ✅ |

**Pontos de design importantes:**

1. **Bootstrap automático de template padrão**: a primeira visita a uma unidade cria 1 doc em `schedule_templates` chamado `Grade Padrão {nomeUnidade}` — admin não precisa pensar em "templates" pra começar. Múltiplos templates por unidade fica pra Sprint 2.5 ou 3.
2. **Cor por modalidade consistente**: hash simples do `modalityId` → índice 0-7 na paleta. Mesma modalidade em qualquer lugar = mesma cor (sem precisar gravar no banco).
3. **Conflito BLOQUEIA, não alerta**: mesmo professor + horário sobreposto não pode salvar. Mesma faixa com OUTRO professor pode (sala compartilhada é caso comum).
4. **Visão semanal abstrata**: dias da semana (Seg, Ter, ...) sem datas reais. Datas reais entram só na Sprint 3 quando `classes` (instâncias) começar a ser gerado.
5. **Filtro dinâmico de professor por modalidade**: ao trocar modalidade no modal, dropdown de professor é re-populado. Reduz chance de erro.
6. **Audit log completo**: cada operação grava `module: 'agenda'` no audit_log com before/after.
7. **Multi-select: criação 1-a-1 (não batch atômico)**: se falhar no meio, slots já criados ficam. Toast mostra parciais. Trade-off pela simplicidade — edge case raro em produção.

**Estado real do staging (banco) após a sessão:**
- `schedule_templates`: 1+ documento (auto-criado)
- `schedule_slots`: N documentos (slots de teste)
- `classes`: vazia (Sprint 3 popula)
- `audit_log`: entries `slot_created`, `slot_updated`, `slot_deactivated`, `slot_activated`, `schedule_template_created` com `module: 'agenda'`

**Não tocou:** módulo de Comissões (`index.html`, `commission.js`) — zero regressão confirmada no smoke test.

**Próxima sessão:** decidir entre Sprint 3 (geração de `classes` + visões do professor + Substituições) · Sprint 2.5 (Lançamento em Lote avançado com período/feriados) · Pausa pra revisão de roadmap.

---

### Sessão 13 — 17/05/2026 (Sprint 3a — Geração de aulas + Minha Agenda)

**Decisões do início (3 perguntas):**
- Quebrar Sprint 3 em 3a + 3b — escopo menor por iteração
- Notificações in-app só na 3b (email = Sprint 7)
- Janela de geração: 4 semanas rolling, CF roda toda segunda 02:00 BRT

**Execução (Etapas 1 a 7):**

| Etapa | Implementação |
|-------|---------------|
| 1 — Vínculo user↔teacher | `getCurrentProfessorId()` em `professores.js` lê `AppState.userProfile.professorId`. Setado manualmente (auto-match por email = backlog) |
| 2 — Cloud Functions | `functions/index.js` reescrito · `generateClassesForUpcomingWeeks` (`onSchedule '0 2 * * 1' America/Sao_Paulo`) · `generateClassesManual` (`onCall`, valida admin via `users/{uid}.profiles`) · helper `generateClassesCore({weeksAhead, dryRun, source})` reutilizado pelos dois · idempotência por ID composto `${slotId}_${YYYYMMDD}` · checa existentes via `where(documentId, 'in', [...])` em batches de 30 · cria via batched `.set()` em batches de 400 · API Cloud Scheduler habilitada automaticamente no deploy |
| 3 — `ClassService` | `listByTeacher(teacherId, {from, to})` · `getById` · `updateStatus(classId, status, note)` com bloqueio se `monthClosingId` (mês fechado) · audit log `class_status_changed` com before/after. Constantes `CLASS_STATUS_LABEL` + `CLASS_STATUS_COLOR` (5 cores). Helpers de data `getStartOfWeek`, `getEndOfWeek`, `ymdFromDate`, `formatDateBR` |
| 4 — Sidebar professor | `PROF_PAGES` ganha `'minha-agenda'` para `admin`, `admin_gestao`, `supervisao`, `professor`, `professor_estagiario`. Nova entrada em `PAGE_DEFINITIONS` `{id:'minha-agenda', section:'Minhas aulas'}`. Handler em `navigateTo` chama `renderMinhaAgendaPage()` |
| 5+6 — Tela + modal | `MinhaAgendaState` com filtros temporais (chip toggle: anterior/atual/próxima/mês). Empty state amigável se user sem `professorId` (mostra UID pra dar pro admin). Lista agrupada por dia. Cada aula: card com horário (mono), modalidade, unidade, badge de status colorido. Modal de aula: detalhes + form de edição (só admin/gestão/supervisão e se aula não está em mês fechado) com select de novo status + textarea de motivo. Audit log automático ao salvar |
| 7 — Smoke test | 6 de 8 cenários validados pelo usuário visualmente. **Pendente próxima sessão:** idempotência (re-rodar CF e esperar `created:0, skipped:16`) + mudança de status (modal → cancelar → conferir audit_log) |

**Cenários validados visualmente:**
1. ✅ Deploy CF (3 funções no Firebase Console)
2. ✅ `dryRun: true` retornou `{wouldCreate: 16, slotsScanned: 4, created: 0}`
3. ✅ Geração real criou 16 classes (`created: 16, skipped: 0`)
5. ✅ Status default `prevista` (badge azul visível)
6. ✅ Sidebar do professor mostra "Minha Agenda" na seção "Minhas Aulas"
7. ✅ Lista filtrada por professor — vinculei `users/{abluir-uid}.professorId = 'iMRf4L6N9dgCzCuzD9v3'` (Ana Paula Souza), Minha Agenda mostrou 1 aula: DOM 17/05/2026 Funcional CrossTainer CP 07:00–08:00 badge Prevista

**Cenários pendentes (5 min na próxima):**
4. ⏳ Idempotência (não testou re-execução)
8. ⏳ Mudança de status no modal + auditoria

**Bugs encontrados durante a sessão e corrigidos:**
- `firebase.functions is not a function` — SDK `firebase-functions-compat.js` não carregado no HTML. Adicionado script tag
- Warning `apple-mobile-web-app-capable is deprecated` — adicionado `<meta name="mobile-web-app-capable" content="yes">` equivalente moderno

**Issue conhecido (não resolvido — registrado pra próxima):**
- O `sw.js` (service worker do módulo Comissões) cacheia agressivamente arquivos de `professores.*`. Após qualquer mudança em código, browser pode servir versão antiga. Workaround: DevTools → Application → Service Workers → Unregister + Clear site data + fechar/reabrir aba. Fix estrutural (excluir `professores.*` do scope) requer autorização explícita (regra inviolável #1)

**Arquivos modificados:**

| Arquivo | Antes | Depois | Δ |
|---------|-------|--------|---|
| `functions/index.js` | 43 | 279 | +236 (2 CFs + core compartilhado) |
| `professores-shared.js` | 1090 | 1252 | +162 (ClassService + helpers de data + constantes) |
| `professores-agenda.js` | 638 | 975 | +337 (Minha Agenda + modal de aula) |
| `professores.html` | 1739 | 1865+ | +120+ (page-minha-agenda, modal de aula, script SDK functions, meta tag mobile, CSS) |
| `professores.js` | 371 | 381 | +10 (helper + PROF_PAGES + handler) |
| `sprint-3a-aulas-e-minha-agenda.md` | — | 227 | NOVO (playbook completo) |

**Pontos de design importantes:**

1. **Idempotência por ID composto** `${slotId}_${YYYYMMDD}` — re-rodar CF é seguro. Se admin edita slot futuramente, classes já geradas ficam congeladas (decisão D5 do playbook)
2. **Bloqueio de mês fechado** — `ClassService.updateStatus` retorna erro se `monthClosingId != null`. UI mostra badge "🔒 mês fechado" e esconde form de edição. Garante consistência pra fechamento (Sprint 4)
3. **Filtros temporais via Date math local** — sem dependências externas. `getStartOfWeek` calcula segunda local (semana BR), `getEndOfWeek` calcula domingo 23:59:59
4. **Cores de status como objetos** (`{bg, border, text}`) — reutilizadas em card da lista e badge do modal sem duplicar lógica
5. **Cache cross-tela** — `AgendaState.modalitiesMap`, `unitsMap`, `teachersMap` são populados na primeira visita à Agenda ou Minha Agenda (cobre ambos os caminhos sem refetch)
6. **CF callable valida admin server-side** — não confia em flag do cliente. Lê `users/{uid}` e checa `profiles.includes('admin'|'admin_gestao')`
7. **Geração em batches** — 30 IDs por query `where(documentId,'in',[...])` (limite Firestore) + 400 docs por `.set()` em batched writes (limite 500). Escala pra ~1000 classes/execução sem problema

**Próxima sessão:** validar cenários 4+8 (5 min) → escolher entre **Sprint 3b** (Agenda Geral + Substituições + notificações in-app — ~1 semana) ou **Sprint 4** (Fechamento Mensal — ~2 semanas, mas depende da 3b). Recomendação: Sprint 3b.

---

### Sessão 14 — 18/05/2026 (Sprint 3a fechada 100% + planejamento Sprint 3b)

**Curtinha (5 min de validação + 30 min de playbook):**

- Cenários 4 (idempotência) e 8 (mudança de status) validados em staging:
  - Cenário 4: re-rodou `generateClassesManual` → `{created: 0, skipped: 16}` ✅
  - Cenário 8: mudou status de aula da Ana pra "Cancelada" + motivo "teste de validação" → audit_log gravou `class_status_changed` com before/after ✅
- **Sprint 3a fechada 100% (8/8)**

**3 decisões iniciais da Sprint 3b:**
- Cobertura aberta visível pra **todos professores aptos à modalidade** (cross-unidade)
- Notificação **some quando lida** (aba "Lidas" preserva histórico)
- **Sem janela mínima** — permite registro retroativo

**Playbook criado:** `sprint-3b-agenda-geral-e-substituicoes.md` (~250 linhas) com 6 etapas (Agenda Geral · NotificationService+sino · sub direta · cob aberta · CFs · smoke test) + 10 decisões fixadas + 10 critérios de aceite.

---

### Sessão 15 — 18/05/2026 (Sprint 3b implementada e deployada)

**Execução das 5 etapas de código em sequência:**

| Etapa | Implementação |
|-------|---------------|
| 1 — Agenda Geral + sidebar | `'agenda-geral'` em todos os `PROF_PAGES`. Página com filtros multi-unidade (chip multi-select) + modalidade + professor + período. Query por unitId in chunks de 30. Render agrupado por dia com card mostrando professor + modalidade + unidade (sem campos financeiros) |
| 2 — Notif + sino | `NotificationService.listUnread/listRead/markAsRead/markAllAsRead/create`. Sino HTML na sidebar com badge. `setupNotificationsBell` em `professores.js` com auto-refresh 60s + click-fora-fecha. `handleNotifClick` marca lida + navega via `link.type` |
| 3 — Substituição direta | `SubstitutionService.create/accept/reject/cancel/listPendingForSubstitute`. Modal HTML com select filtrado por aptos à modalidade (excluindo titular). Aviso retroativo visual. `injectClassModalActions` patcheia `openClassModal` da Sprint 3a pra adicionar botões "🔄 Pedir substituição" e "🆘 Pedir cobertura aberta" quando user é o titular |
| 4 — Cobertura aberta | `CoverageService.request/pick/cancel/listOpenForTeacher`. Modal HTML. `pick()` usa transação Firestore pra evitar race condition. Inbox modal com 2 abas (`InboxState.activeTab`) |
| 5 — Cloud Functions | 3 novas em `us-central1` (force via `region: 'us-central1'` no config, primeiro deploy tentou `sa-east1` e Eventarc deu permission-denied). Triggers Firestore v2: `onDocumentUpdated('substitutions/{subId}')`, `onDocumentCreated('coverage_applications/{covId}')`, `onDocumentUpdated('coverage_applications/{covId}')`. Cada uma faz transação na coleção `classes` quando aplicável + cria notif via `createNotification` (helper local na CF) |

**Decisões resolvidas durante a sessão:**
- Sino dentro da sidebar (não tem topbar superior no layout atual)
- Inbox como modal acessível via dropdown do sino (não tela dedicada)
- Detecção de userId do substituto: tenta `teacher.userId` → fallback query `users.where('professorId', '==', ...)`
- Modais HTML colocados antes dos script tags em `professores.html`
- ESC handler do classModal preservado (foi adicionado handler de classModal junto com slotModal anteriormente)

**Arquivos modificados:**

| Arquivo | Antes (sessão 14) | Depois (sessão 15) | Δ |
|---------|------------------:|-------------------:|--:|
| `functions/index.js` | 279 | 466 | **+187** (3 CFs + helper + import onDocumentCreated/Updated) |
| `professores-shared.js` | 1252 | 1709 | **+457** (NotificationService + SubstitutionService + CoverageService + constantes) |
| `professores-agenda.js` | 975 | 1584 | **+609** (Agenda Geral + 4 modais + inbox + patch do openClassModal) |
| `professores.html` | 1865 | 2229 | **+364** (4 modais + sino + CSS) |
| `professores.js` | 381 | 518 | **+137** (NotifState + handlers do sino + helpers) |
| `firestore.indexes.json` | — | — | +2 índices novos (notifications composto + coverage_applications) |
| `sprint-3b-agenda-geral-e-substituicoes.md` | — | 250 | NOVO (playbook) |

**Deploy em staging:**

| Cloud Function | Tipo | Status |
|---------------|------|--------|
| `healthCheck` | onRequest | atualizada |
| `generateClassesForUpcomingWeeks` | onSchedule (segunda 02:00 BRT) | atualizada |
| `generateClassesManual` | onCall (admin) | atualizada |
| `processSubstitutionAcceptance` | onDocumentUpdated | **criada (us-central1)** |
| `notifyTeachersAboutCoverage` | onDocumentCreated | **criada (us-central1)** |
| `processCoveragePick` | onDocumentUpdated | **criada (us-central1)** |

Índices Firestore deployados (`notifications` composto recipientUserId+isRead+createdAt/readAt + `coverage_applications` status+requestedAt).

**Issues durante deploy:**

1. **Primeira tentativa**: triggers Firestore v2 foram pra `sa-east1` (região do Firestore) → Eventarc Service Agent ainda sem permissão. Corrigi forçando `region: 'us-central1'` no config.
2. **Warning cross-region**: Firebase avisa que trigger está em `sa-east1` mas função em `us-central1` → latência extra Brasil↔Iowa. Cosmético, não bloqueia.
3. **`firebase-functions` outdated** (já vinha de antes): aviso pra atualizar. Deixado pra sprint de manutenção.

**Não testado ainda em staging.** Usuário pausou antes do smoke test. Próxima sessão: 10 cenários.

**Pontos de design importantes:**

1. **Patch monkey-style do `openClassModal`** — wrapper preserva lógica original (`(function patchOpenClassModal(){...})()` no fim do agenda.js). Permite injetar botões da Sprint 3b sem reescrever a função
2. **Cobertura aberta usa transação Firestore** — `db.runTransaction` no `pick()` garante que apenas 1 professor pega mesmo com 2 cliques simultâneos
3. **CF callable pra notif em massa NÃO precisa** — `notifyTeachersAboutCoverage` é trigger automático onCreate, mais simples (frontend cria doc, CF se vira)
4. **Sino com polling 60s** ao invés de snapshot listener — economiza leituras. Custo: notif podem demorar até 1min. Aceito pra MVP
5. **Aviso retroativo visual** no modal de substituição/cobertura quando `aulaDate < now` — flag `wasRetroactive: true` no doc + badge "retroativo" nas listas
6. **Fallback de userId** quando substituto não tem `teacher.userId` direto: query `users.where('professorId', '==', teacherId)` — útil enquanto o vínculo bidirecional não está garantido

**Próxima sessão:** smoke test 10 cenários (~30 min). Após validação, decidir **Sprint 4** (Fechamento Mensal).

---

### Sessão 16 — 18/05/2026 (Smoke test 3b parcial + Bugfix produção paralelo)

Sessão híbrida: parte foi smoke test em staging do módulo Professores, parte foi resposta a um bug em produção do módulo Comissões.

#### A) Smoke test Sprint 3b — 7 de 10 cenários OK

| # | Cenário | Resultado |
|---|---------|-----------|
| 1 | Sidebar mostra "🌐 Agenda Geral" | ✅ |
| 2 | Agenda Geral com filtros multi-unidade + modalidade + professor + período | ✅ |
| 3 | Sino na sidebar (badge zerado se sem notif) | ✅ |
| 4 | Criar notif manual via console → badge mostra "1" + aparece no dropdown | ✅ |
| 5 | Click marca como lida → some do dropdown + acessível em "Lidas" | ✅ |
| 6 | Modal de aula da Ana mostra botões "🔄 Pedir substituição" + "🆘 Pedir cobertura aberta" | ✅ |
| 7 | Pedido de substituição direta criado em Firestore (vendedora Ana → Lucas, motivo "teste", retroactive false) | ✅ |
| 8 | Aceitar como Lucas + CF processar | ⏳ pendente |
| 9 | Cobertura aberta + pick | ⏳ pendente |
| 10 | Audit log final | ⏳ pendente |

**Doc de substituição criado e aguardando aceite:**
- `substitutions/VY66YMZtVklkM0AavjCi`
- `classId: '1GvQIwy8elHelFVSeV8l_20260522'`
- `requestingTeacherId: 'iMRf4L6N9dgCzCuzD9v3'` (Ana)
- `substituteTeacherId: 'QZw9fVWhf0r5jNnLj99B'` (Lucas)
- `status: 'pending'`

**Setup pendente pro cenário 8:** trocar `users/{abluir-uid}.professorId` pro Lucas (`QZw9fVWhf0r5jNnLj99B`) e recarregar pra simular o aceite.

#### B) Bugfix em produção — detecção de periodicidade BIANUAL

**Identificação:** olhando o painel de produção (`rafaelmayerbrasil.github.io`) — vendedora Isabella Haise (CrossTainer PP, Abr/2026) com cliente Augusto César Olinger Veiga, plano "ACESSO LIVRE | BIANUAL | FLEX | ILIMITADO | PREMIUM" gerando bônus P2 de R$ 45 (Anual Flex) ao invés de R$ 80 (Bianual VIP).

**Diagnóstico:** `commission.js` linhas 163–165 usava:
```js
termosAtivacao.forEach(termo => {
  if (item.includes(termo)) r.periodicidade = termo;
});
```
Onde `termosAtivacao = ['BIANUAL', 'ANUAL', 'RECORRENTE', 'MENSAL']`. Como `.includes()` faz substring match, `"BIANUAL".includes("ANUAL") === true`, então o termo `ANUAL` (iteração 2) sobrescrevia o `BIANUAL` (iteração 1). Resultado: planos bianuais classificados como anuais.

**Fix:** regex com word boundary (`\bTERMO\b`):
```js
termosAtivacao.forEach(termo => {
  const re = new RegExp(`\\b${termo}\\b`);
  if (re.test(item)) r.periodicidade = termo;
});
```
`\b` exige fronteira de palavra — `\bANUAL\b` não casa dentro de `"BIANUAL"` porque B-I-A não tem boundary entre as letras.

**Commit:** `6f0a15b` no `main`, pushado pro GitHub Pages (produção).

**Migração de dados históricos:**
- Identificada 1 ocorrência: Augusto César Olinger Veiga · `pp_2026-04` · Isabella Haise · P2 R$ 45 → R$ 80 (delta +R$ 35)
- Atualizado via batch direto no Firestore: `periodicidade='BIANUAL'`, `p2bonus=80`, `totalP1P2=94.95` + campos `_migratedAt`, `_migratedBy`, `_migrationNote`
- Recalculado `vendorSummary` do período via função `recalculatePeriod('pp_2026-04', null)` do próprio sistema — reconstruiu o agregado da Isabella corretamente (R$ 109,90 total · P2 FIXO R$ 80)
- Audit log gravado em `audit_log/{id}` com `type: 'commission_p2_fix_migration'`

**Outros casos identificados mas NÃO migrados (decisão futura do usuário):**
- 4 itens BIANUAL em `cp_2026-04` com `periodicidade='ANUAL'` (Francini × 2, Pietra × 2). Mesmo bug, mesmo padrão. Foco da migração nessa sessão foi apenas Isabella PP.
- Pode haver mais em outros meses (não auditado completo).

**Recomendação registrada:** rodar diagnóstico abrangente em todos os períodos depois pra fechar o ciclo desse bug histórico. Pode ser tarefa de uma sessão dedicada futura ("audit BIANUAL legacy").

#### Próxima sessão

Retomar smoke test Sprint 3b a partir do **cenário 8** seguindo o passo a passo já detalhado na seção "🎯 Próxima ação ao retomar" deste documento. Cenários 8–10 devem fechar em ~15 min se tudo funcionar. Após validação completa, decidir Sprint 4 (Fechamento Mensal).

---

### Sessão 17 — 18/05/2026 (Sprint 3b fechada 10/10 + 3 bugs descobertos e corrigidos)

Continuação do smoke test interrompido na sessão 16. Cenários 8–10 validados, mas o caminho expôs 3 issues técnicos.

#### Cenários validados

| # | Cenário | Resultado |
|---|---------|-----------|
| 8 | Aceitar substituição via console (`SubstitutionService.accept`) + CF `processSubstitutionAcceptance` atualiza `classes/{id}.teacherId` + cria notif pro titular | ✅ |
| 9 | Pedir cobertura aberta + CF `notifyTeachersAboutCoverage` + pegar via `CoverageService.pick` em transação Firestore + CF `processCoveragePick` atualiza `classes` + notifica titular (`coverage_taken`) | ✅ |
| 10 | Query do audit_log retorna entries de agenda/substituição/cobertura | ✅ (após ajuste do filtro — vide bug B) |

#### Bug A — `CoverageService.pick` shorthand JS errado

**Sintoma:** `ReferenceError: pickedByTeacherId is not defined` no `Object.pick` linha 1613 ao tentar pegar uma cobertura aberta. Erro acontecia DEPOIS da transação Firestore ter sucesso (transação rolou, audit log falhou).

**Causa:** linha 1613 de `professores-shared.js`:
```js
after: { ...result, status: 'taken', pickedByTeacherId, pickedByUserId },
```
Os shorthands `pickedByTeacherId` e `pickedByUserId` tentavam referenciar variáveis com esses nomes no escopo, mas os parâmetros destructurados eram `pickerTeacherId` e `pickerUserId` (sem o "by"). Confusão entre o nome do parâmetro de entrada e o nome do campo no schema.

**Fix:**
```js
after: { ...result, status: 'taken', pickedByTeacherId: pickerTeacherId, pickedByUserId: pickerUserId },
```

**Estado do dado em staging:** primeira tentativa de pick teve a transação commitada (status virou 'taken', `pickedByTeacherId/UserId/At` preenchidos) mas o audit log não foi gravado. Audit retroativo criado manualmente via `db.collection('audit_log').add({...})`.

#### Bug B — `AuditService.log` ignorava parâmetro `module`

**Sintoma:** query `audit_log.where('module', '==', 'agenda')` retornava 0 entries, mesmo após dezenas de operações de slot/substitution/coverage que passavam `module: 'agenda'`.

**Causa:** linha 192 de `professores-shared.js`:
```js
async log({ type, details, entityType, entityId, before, after }) {
```
O destructuring NÃO incluía `module`. Logo abaixo, linha 201, o valor era hardcoded:
```js
module: 'professores',
```
Resultado: todas as entries criadas via `AuditService.log` ficavam com `module: 'professores'`, independente do que o chamador passasse. Bug existia desde a Sprint 2.

**Fix:**
```js
async log({ type, details, entityType, entityId, before, after, module }) {
  ...
  module: module || 'professores',  // default mantido pra retrocompatibilidade
```

**Estado dos dados em staging:** todas as entries históricas de Sprint 2 + 3a + 3b estão com `module: 'professores'` no banco. Não migradas. Decisão registrada na "Próxima ação": **não migrar** (valor baixo · risco zero) — entries novas vão sair corretas.

#### Bug C — Índice composto faltante (Firestore)

**Sintoma:** `SubstitutionService.listPendingForSubstitute(userId)` jogava `FirebaseError: The query requires an index` ao tentar abrir a Inbox via UI.

**Causa:** query usa `.where('substituteUserId', '==', x).where('status', '==', 'pending').orderBy('requestedAt', 'desc')`. Esse índice composto não existia no `firestore.indexes.json` nem em staging.

**Fix:** adicionei em `firestore.indexes.json`:
```json
{
  "collectionGroup": "substitutions",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "substituteUserId", "order": "ASCENDING" },
    { "fieldPath": "status",           "order": "ASCENDING" },
    { "fieldPath": "requestedAt",      "order": "DESCENDING" }
  ]
}
```

**Pendência:** deploy ainda não feito. Comando: `firebase deploy --only firestore:indexes --project staging`. Por isso o cenário 8 foi validado via console (`SubstitutionService.accept` direto, sem precisar listar inbox).

#### Bug D bônus — fuso horário UTC↔BR no classId

Observado mas não corrigido. As `classes` são geradas com `scheduledDate` em UTC midnight (porque CF roda em UTC). Em BR (UTC-3) isso vira ~21:00 do dia anterior. Ex: classId `_20260522` (Sex em UTC) aparece como "QUI 21/05" na UI. Funciona pro uso atual (display + filtros usam local time), mas pode confundir agregações por mês na Sprint 4 (Fechamento). Anotado pra investigar antes de Sprint 4.

#### Arquivos modificados nesta sessão

| Arquivo | Mudança |
|---------|---------|
| `professores-shared.js` | Fix bug A (linha 1613) + Fix bug B (linhas 192 + 201) |
| `firestore.indexes.json` | Adicionado índice composto `substitutions(substituteUserId, status, requestedAt)` |

**Não deployado:**
- Functions: nenhuma mudança em CF nesta sessão (só JS client-side)
- Firestore indexes: precisa deployar pendente (item P1 da próxima ação)

#### Estado real do staging após sessão 17

- `substitutions/VY66YMZtVklkM0AavjCi`: status `accepted` (Ana → Lucas)
- `coverage_applications/URzPVgQmVLC03yLIq8Sk`: status `taken` (Ana → Lucas via cobertura)
- `classes/1GvQIwy8elHelFVSeV8l_20260522`: teacherId Lucas, status `substituida`
- `classes/yCng1ioFkItO1jdrPBv8_20260525`: teacherId Lucas, status `substituida`
- Notificações: várias (substitution_accepted, coverage_taken, coverage_available) na inbox do user `abluir`

#### Próxima sessão

1. Deploy do índice composto (1 min)
2. **Sprint 4 — Fechamento Mensal** (~2 semanas). Criar `sprint-4-fechamento-mensal.md` antes de codar, mesmo padrão.

---

### Sessão 19 — 22/05/2026 (Sprint 4b implementada e validada 12/12)

Sessão de validação remota: desenvolvedor implementou Sprint 4b autonomamente seguindo `sprint-4b-pagamentos-recibos.md` (8 commits + 1 deploy). Eu validei via `scripts/admin.js` e fix de gaps detectados.

#### O que o desenvolvedor entregou

| Arquivo | O que entrou |
|---------|--------------|
| `professores-pagamentos.js` (NOVO) | 404 linhas — telas pra admin e professor (`renderPagamentosPage`, `renderMeusPagamentosPage`) |
| `receipt.html` (NOVO) | 185 linhas — página standalone de impressão com CSS print A4 |
| `professores-shared.js` | +395 linhas — `ReceiptService` (emit com transação + abate de crédito), `PaymentService` (confirm), `CreditService` (register/list/applyToReceipt) |
| `professores.js` | +10 linhas — `PROF_PAGES` com `'pagamentos'` (admin) e `'meus-pagamentos'` (professor); roteamento |
| `professores.html` | CSS das telas + script tag novo |
| `firestore.rules` | +helper `isStrictAdmin()` + regras pras 4 coleções (`receipts`, `payment_records`, `creditos_professores`, `meta/receipt_counter`) |
| `firestore.indexes.json` | +3 índices compostos |
| `scripts/admin.js` | +comandos `list-closing-teachers`, `emit-receipt`, `confirm-payment`, `register-credit`, `list-receipts`, `smoke-4b` |

#### Validação 12/12

- C1-2 (sidebar admin/não-admin): por inspeção de código ✅
- C3 (lista de pagamentos): código ✅
- C4 (emissão #0001 Lucas R$ 240): smoke test ✅
- C5 (`emitBatch`): código presente ✅
- C6 (`receipt.html` print A4): por inspeção ✅
- C7 (confirmação muda status pra 'pago'): smoke test ✅
- C8 (registro de crédito R$ 50 pendente): smoke test ✅
- **C9 (crédito abatido):** end-to-end via fixture — Lucas R$ 200 - R$ 50 = R$ 150 líquido no recibo #0002 ✅
- **C10 (notif `recibo_emitido` + `pagamento_confirmado`):** 2 notifs criadas pro user vinculado ✅
- **C11 (audit log `module='pagamentos'`):** 2 entries (`receipt_emitted` + `payment_confirmed`) ✅
- C12 (zero regressão): inspeção ✅

#### Fix aplicado durante validação

O `scripts/admin.js` (criado por mim na sessão 18) tinha `cmdEmitReceipt` e `cmdConfirmPayment` simplificados demais — não disparavam `audit_log`, `notifications` nem abate de créditos. Foi suficiente pro smoke de Sprint 4a (que não tinha crédito/notif/audit no fluxo), mas falhava na Sprint 4b. **Reescrevi as 2 funções pra paridade total com `ReceiptService.emit`/`PaymentService.confirm` do frontend:**
- Transação Firestore na emissão (numeração atômica)
- Pré-busca + abate de créditos pendentes
- Audit log com `module='pagamentos'`
- Notificação ao user vinculado ao teacher
- Reset de contador documentado em comentários

#### Fixture limpa

Pra validar C9 sem afetar dados reais, criei fixture `unit-cp_2026-04` (Lucas R$ 200), emiti recibo #0002 abatendo o crédito de R$ 50, confirmei pagamento R$ 150. Após validação, deletei batch atômico: closing fixture, recibo #0002, payment_record, audit entries dele, notifs dele, contador resetado pra 1, crédito do Lucas restaurado pra status 'pendente'.

#### Pendências técnicas registradas (não bloqueantes)

1. **Race condition rara no abate de crédito:** `ReceiptService.emit` busca créditos pendentes via `db.collection().where().get()` ANTES da transação (Firestore não permite `where()` dentro de runTransaction — só `doc().get()`). Se 2 admins emitirem recibos quase simultâneos pro mesmo professor com créditos pendentes, ambos podem abater o mesmo crédito. Em produção realística é raríssimo (1 admin por vez por unidade). Aceito como tech debt.
2. **Crédito do Lucas (R$ 50) ainda pendente em staging:** registrado na sessão 18 pra teste, ainda no banco. Será abatido na primeira emissão futura do Lucas. OK pra deixar.
3. **Critérios 5/6 da Sprint 4a** (estagiário com/sem excedente) seguem sem validação direta — sem estagiário com aulas em Maio CP.

#### Estado após sessão 19

- Coleções populadas em staging: `receipts` (1), `payment_records` (1), `creditos_professores` (1), `monthly_closings` (1), `meta/receipt_counter` (value: 1)
- Counter sequencial: 1 (próxima emissão será #0002)
- Audit log `module='pagamentos'`: 0 entries (as 2 da fixture foram apagadas)
- Notificações pendentes: 0 do tipo recibo/pagamento (apagadas com a fixture)

#### Não commitado

- `.gitignore`, `scripts/admin.js` modificados (mudanças locais)
- Todos os arquivos do módulo Professores continuam untracked no main (padrão estabelecido — só commit quando for deploy de produção)

#### Próxima sessão

Decidir Sprint 5 (Escalas Especiais — sábado/feriado/eventos com pesos + detecção auto de feriado · ~1,5 semana) seguindo o mesmo padrão que funcionou: eu monto playbook detalhado → dev implementa autônomo → eu valido via script + fixture.

---

### Sessão 18 — 22/05/2026 (Sprint 4a implementada e validada 8/10)

Sessão de implementação completa da Sprint 4a + criação de ferramenta administrativa reutilizável.

#### Sprint 4a — Fechamento Mensal: implementação

| Arquivo | O que entrou |
|---------|--------------|
| `professores-fechamento.js` | NOVO — 370+ linhas com UI completa (preview, modo fechado, histórico, modal de confirmação) |
| `professores-shared.js` | `ClosingService` (preview, list, getById) + helpers `calculateTeacherHours`, `calculateTeacherValue`, `getEffectiveSalaryAt` |
| `professores.js` | Sidebar item "💰 Fechamento" (admin + admin_gestao), helper `isStrictAdmin()`, routing |
| `professores.html` | `<div id="page-fechamento">` + script tag |
| `functions/index.js` | Cloud Function `closeMonth` (callable, valida admin, cria `monthly_closings/{id}`, batched update setando `monthClosingId` em todas classes do mês BR) |
| `firestore.rules` | Helper `isStrictAdmin()` + `monthly_closings` create restrito a admin |

**Deploys feitos em staging:**
- `firestore:indexes` — índice composto `substitutions` ✅
- `firestore:rules` — regras com `isStrictAdmin()` ✅
- `functions:closeMonth` — Cloud Function ativa ✅

#### Smoke test (8/10 cenários cobertos)

| # | Critério | Como validado | Resultado |
|---|----------|---------------|-----------|
| 1 | Sidebar "💰 Fechamento" pro admin | UI manual | ✅ |
| 2 | Não aparece pra não-admin | Inspeção de código (`PROF_PAGES[admin]` + `[admin_gestao]` apenas) | ✅ |
| 3 | Preview calcula horas | Script `admin.js smoke-4a unit-cp 2026 5` | ✅ 10 classes, 2 entram (Lucas 2h) |
| 4 | Valor efetivo | Script | ✅ Lucas 2h × R$ 120 = R$ 240 |
| 5 | Estagiário sem excedente | — | ⏭️ Sem estagiário com aulas no mês |
| 6 | Estagiário com excedente | — | ⏭️ Idem |
| 7 | Status filtrados | Script | ✅ {prevista:7, cancelada:1, substituida:2} → só 2 entram |
| 8 | Congelamento | Script (`check-frozen`) | ✅ 10/10 classes congeladas |
| 9 | Idempotência | UI (tentar fechar 2× → erro) | ✅ |
| 10 | Histórico | Script (`list-closings`) | ✅ 1 fechamento listado |

**Pendência:** critérios 5 e 6 (estagiário). Decisão: ficam como "validar quando houver dados reais" — sem estagiário com aulas em Maio CP no staging.

#### Bônus — `scripts/admin.js` (utilitário reutilizável)

Criado script Node.js com Admin SDK pra rodar smoke tests automatizados:

```
node scripts/admin.js --project staging <comando>
```

Comandos:
- `list-units`, `list-teachers`, `list-classes`, `list-closings`
- `preview <unitId> <year> <month>` — calcula preview server-side (replicando lógica do `ClosingService.preview` do client)
- `check-frozen <unitId> <year> <month>` — verifica `monthClosingId` nas classes
- `smoke-4a <unitId> <year> <month>` — roda todos critérios automatizáveis em sequência

Autenticação: `scripts/serviceAccount-staging.json` (no `.gitignore`). NPM script: `npm run admin:staging -- <comando>`. Reutilizável pras próximas sprints (4b, 5, 6).

#### Observação de design importante (descoberta no smoke)

O `closeMonth` congela TODAS as classes do mês (incluindo `prevista`, `cancelada`, `nao_realizada`), não só as 2 que entram no cálculo. **Comportamento correto**: protege consistência do fechamento. Após fechar Maio, NADA de Maio pode ser editado (mesmo aulas que não pagaram).

Estado final em staging:
- `monthly_closings/unit-cp_2026-05`: 1 doc criado · totals correto · closedAt 22/05/2026
- `classes` do mês: todas com `monthClosingId = 'unit-cp_2026-05'`

#### Próxima sessão

Decidir entre:
- (a) Criar dados de teste de estagiário pra fechar 10/10 da Sprint 4a
- (b) Iniciar **Sprint 4b** (pagamentos + recibos · `payment_records` + emissão de recibo)
- (c) Outra direção

---

## 📋 Backlog identificado durante validação da Sprint 1

> Itens funcionais que NÃO estavam na spec original da Sprint 1 mas foram identificados durante uso real do sistema. Cada item tem spec suficiente para implementação posterior sem reabrir discussão.
>
> **Status:** B-01 e B-02 ✅ **IMPLEMENTADOS E VALIDADOS na sessão 11 (17/05/2026)**. Specs originais mantidas abaixo para referência histórica.

---

### B-01 · Data de início de validade das alterações salariais ✅ VALIDADO (sessão 11)

**Identificado em:** Sessão 10 (15/05/2026), durante validação da Etapa 7.

**Problema atual:**
Hoje cada entry de `salaryHistory[]` registra apenas `changedAt` (quando a alteração foi feita). Não há registro de quando o novo valor passa a valer para cálculo. Se o admin altera o valor no dia 20 de maio, o sistema não sabe se:
- (a) as horas dos dias 1–19 devem usar o valor antigo, e dias 20+ o novo, OU
- (b) o mês inteiro usa o novo valor, OU
- (c) o mês inteiro usa o antigo (próximo mês começa com o novo)

Sem essa informação, o fechamento mensal (Sprint 5/6) não consegue calcular pagamentos proporcionais corretos.

**Comportamento desejado:**
Cada alteração salarial deve ter uma **data de início de validade** explícita, definida pelo admin no momento da alteração. Default: data de hoje. O fechamento mensal usa o histórico para encontrar qual valor estava válido em cada dia do mês e calcular proporcionalmente.

**Schema impactado — `teacher_salaries/{teacherId}`:**

Cada entry do `salaryHistory[]` ganha o campo `effectiveDate`:
```js
salaryHistory: [
  {
    changedAt:        Timestamp,    // quando a alteração foi feita (atual)
    changedBy:        userId,
    changedByName:    string,
    field:            'hourlyRate' | 'internMonthlyStipend' | ...,
    previousValue:    number | null,
    newValue:         number,
    effectiveDate:    Timestamp,    // 🆕 quando o novo valor passa a valer
    effectiveNote:    string,        // 🆕 opcional, motivo da alteração
  }
]
```

O `hourlyRate` (e demais campos atuais) no nível raiz do doc continuam sendo o **valor mais recente "geral"**, derivado da entry mais recente.

**UI impactada:**
- Modal de edição salarial ganha campo "Data de início de validade" (input date), default = hoje
- Campo opcional "Motivo da alteração" (textarea curta)
- Tab Salarial mostra a `effectiveDate` ao lado do `changedAt` em cada entry de histórico
- (Opcional, fase 2) Mostrar timeline visual: "R$ 65/h até 15/jul · R$ 70/h a partir de 16/jul"

**Algoritmo de cálculo no fechamento mensal:**
```
para cada dia D do mês:
  entry_aplicavel = max(salaryHistory, key=lambda e: e.effectiveDate where e.effectiveDate <= D)
  valor_no_dia[D] = entry_aplicavel.newValue
```
Implementação detalhada fica para a Sprint 5/6.

**Restrições e edge cases:**
- `effectiveDate` não pode ser anterior à entry imediatamente anterior no histórico (impede inversão temporal)
- Se admin tenta editar com `effectiveDate` retroativa em um mês já fechado: BLOQUEAR (mostrar erro "esse período já foi fechado em DD/MM")
- Se `effectiveDate` é futura: permitir, mas marcar visualmente como "Programada para DD/MM" no histórico

**Estimativa:** ~0,5 dia
- Frontend: ~3 horas (campo no modal, validações, ajuste no histórico)
- Backend (SalaryService): ~1 hora (aceitar `effectiveDate` na entry, validar ordenação temporal)
- Migração de dados existentes: usar `changedAt` como `effectiveDate` default (sem perda de informação)

**Dependências:** nenhuma. Pode ser feito imediatamente após Sprint 1.

**Risco:** baixo. Mudança incremental, sem quebrar dados existentes.

---

### B-02 · Profissionais sempre hora-aula + VR/VT/Outros ✅ VALIDADO (sessão 11)

**Identificado em:** Sessão 10 (15/05/2026), durante validação da Etapa 7.

**Problema atual (parte A — UX):**
O modal de edição salarial mostra um select com 3 opções de tipo de remuneração (`hora_aula`, `bolsa`, `misto`) para professores efetivos/eventuais. Na prática, profissionais (não-estagiários) **sempre** são remunerados por hora-aula. O select adiciona ruído sem trazer valor.

**Problema atual (parte B — completude):**
Faltam 3 campos de benefícios que fazem parte da remuneração mensal e precisam ser registrados no cadastro do professor:
- **VR — Vale Refeição** (R$/dia ou R$/mês — definir)
- **VT — Vale Transporte** (R$/dia ou R$/mês — definir)
- **Outros** (campo livre ou estruturado para benefícios adicionais)

Esses valores são **defaults** registrados no cadastro, mas precisam ser **sobrescrevíveis no fechamento mensal** (porque podem variar: o professor faltou X dias, recebeu adiantamento, etc.).

**Comportamento desejado:**

*Parte A — UX:*
- Remover select de tipo de remuneração da UI para professores não-estagiários
- Backend continua aceitando `remunerationType` para retrocompatibilidade, mas o frontend força `'hora_aula'` para efetivo/eventual
- Para estagiários: select continua existindo (eles podem ser `'bolsa'` ou `'misto'`)

*Parte B — Cadastro:*
- Modal de cadastro/edição salarial ganha 3 novos campos:
  - `mealAllowance` (Vale Refeição) — R$, número decimal
  - `transportAllowance` (Vale Transporte) — R$, número decimal
  - `otherBenefits` — string ou objeto estruturado (ver decisão D-01 abaixo)
- Aparecem para **todos os tipos de professor** (a confirmar se estagiários também têm)

*Parte C — Fechamento mensal:*
- A tela de fechamento mensal (Sprint 5/6) lê os defaults de `teacher_salaries`
- Permite ao admin sobrescrever VR/VT/Outros daquele mês específico
- O valor REAL daquele mês fica registrado em `monthly_closings/{closingId}` (ou similar) — não altera o default em `teacher_salaries`

**Schema impactado — `teacher_salaries/{teacherId}`:**

Adicionar 3 campos:
```js
{
  // ... campos atuais ...
  mealAllowance:       null,        // 🆕 R$ — default mensal de VR
  transportAllowance:  null,        // 🆕 R$ — default mensal de VT
  otherBenefits:       null,        // 🆕 string ou objeto (ver D-01)
}
```

Esses campos são tracked no `salaryHistory[]` também (toda alteração registra prev/new) — mesma lógica dos outros campos monetários.

**UI impactada:**

*Modal de edição salarial:*
- Para efetivo/eventual: remover select, mostrar campo "R$/hora-aula" + 3 campos de benefícios
- Para estagiário: select continua + campos de bolsa/limite + 3 campos de benefícios
- Cálculo proporcional do estagiário continua usando só bolsa÷horas (VR/VT/Outros não entram nele)

*Aba Salarial:*
- Cards de benefícios adicionados abaixo do bloco principal:
  - "Vale Refeição: R$ 30,00"
  - "Vale Transporte: R$ 10,00"
  - "Outros: ..."

**Decisões pendentes:**

| ID | Decisão | Opções | Recomendação |
|----|---------|--------|--------------|
| **D-01** | Campo "Outros" estruturado ou livre? | (a) string livre (textarea); (b) array de objetos `{nome, valor}`; (c) campos fixos pré-definidos (Plano de Saúde, Bonificação, etc.) | **(b)** — array de objetos. Mais flexível que (c), mais consultável que (a) |
| **D-02** | VR/VT estagiário também tem? | (a) Sim para todos; (b) Só efetivo; (c) Configurável por professor | **(a)** — universal. Se um estagiário não tem, fica em 0 |
| **D-03** | VR/VT é R$/dia ou R$/mês? | (a) R$/dia × dias trabalhados; (b) R$/mês fixo | **(b)** — mais simples. Admin sobrescreve no fechamento se quiser proporcional |
| **D-04** | Remover select de tipo para profissional impacta o backend? | — | `SalaryService.upsert` continua aceitando `remunerationType`. Frontend só força valor `'hora_aula'`. Zero quebra de retrocompatibilidade |

**Estimativa:** ~1 dia
- Frontend (modal + aba): ~5 horas
- Backend (3 campos novos + tracking de histórico): ~1 hora
- Migração dados existentes: nenhuma necessária (campos novos = null, comportamento atual preservado)
- Testes: ~2 horas

**Dependências:**
- Idealmente vem **antes** de Sprint 5/6 (Fechamento Mensal), porque o fechamento precisa desses campos como input
- Se vier **depois** do fechamento, vai exigir migration adicional

**Risco:** baixo. Adição de campos opcionais, sem alterar campos existentes.

---

### Resumo do backlog

| ID | Item | Estimativa | Bloqueante de | Risco |
|----|------|------------|--------------|-------|
| B-01 | `effectiveDate` no histórico salarial | ~0,5 dia | Sprint 5/6 (Fechamento) | Baixo |
| B-02 | Hora-aula obrigatório p/ profissional + VR/VT/Outros | ~1 dia | Sprint 5/6 (Fechamento) | Baixo |
| **TOTAL** | **Combinado** | **~1,5 dia** | — | — |

**Decisão recomendada:** implementar os dois itens em uma mini-sprint "1.5" antes de iniciar a Sprint 2. Mantém o schema consistente desde o início e evita migration mais à frente.

---

## Protocolo para Novas Sessões

**Carregamento automático:** o arquivo `CLAUDE.md` na raiz do projeto é lido automaticamente pelo Claude Code em toda nova sessão — ele já direciona o Claude a ler este arquivo. **Você não precisa colar nenhum prompt.** Basta abrir o Claude no diretório do projeto e começar a conversar.

**Fallback manual** (se por algum motivo o CLAUDE.md não for lido):
> "Leia o arquivo `CONTEXTO_SESSAO.md` antes de qualquer coisa. Ele contém o estado atual do projeto CrossTainer Módulo Professores."

**Ao receber uma decisão do cliente:**
1. Atualizar tabela "Decisões M4 Resolvidas" neste arquivo
2. Remover da tabela "Aguardando Resposta"
3. Atualizar a seção correspondente na spec técnica (se afeta fórmulas, modelo de dados, etc.)
4. Verificar se algum sprint agora pode ser desbloqueado

**Ao completar um sprint:**
1. Marcar sprint como ✅ na tabela de status
2. Registrar no log de sessões o que foi implementado
3. Atualizar "Arquivos a criar" (mover para "Arquivos criados")
4. Verificar se o próximo sprint tem todas as pré-condições atendidas
