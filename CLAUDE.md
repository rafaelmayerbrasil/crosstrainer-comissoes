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

> **🟡 DUAS DÚVIDAS DO GRUPO (31/08/2026) — 1 CORRIGIDA EM PRODUÇÃO, 1 PRONTA NO BRANCH.** **(a) Benny:** o e-mail de acesso do **Bruno Claudino** não era dele (`brunosilva@` no Auth, `bruno_claudinocl@` na ficha). Ele **nunca tinha entrado** e nunca conseguiria: o "esqueci minha senha" só funciona pelo endereço do Auth, e o Firebase responde "enviamos" mesmo quando o endereço não existe — silêncio, não erro. **✅ Corrigido em produção** (Auth + `users` + `audit_log`, backup em `backups/`). Varredura: 3 de 19 fichas divergiam; as outras 2 (Leonardo, Helena) **já entram** normalmente — é só o contato da ficha. **No branch:** CF **`changeLoginEmail`** (admin-only) + botão **"Alterar e-mail de acesso"** na aba Acesso e no aviso de divergência, mais `scripts/diag-emails-acesso.js`. **(b) Rodrigo:** *"como faz pra saber a unidade e quem tá escalado junto com você?"* — **dava, mas só pela Agenda Geral**, que ninguém abre pra isso; na Escala a linha dizia apenas "✓ Você está escalado". Agora a linha da escala **publicada** traz `📍 unidade · modalidade · horário` e `👥 quem mais está no dia`, em sábado, feriado e fim de ano (neste, a equipe é a **do dia**). Antes de publicar continua mudo, de propósito. **20 verificações novas · suíte 57/57 · manuais atualizados. ✅ HOMOLOGADO NO STAGING em 31/08** (CF + hosting no ar lá; escala conferida logada como professor — inclusive no celular — e a troca de e-mail exercitada nos 4 caminhos: troca, endereço já usado, professor barrado pelo servidor, reversão). ⚠️ **Falta o OK do Rafael e o deploy em produção** (`--project production` + `git push origin main`). Detalhe: `CONTEXTO_SESSAO.md` → sessão 61. Memória: [[email-acesso-vs-ficha]].

> **✅ REBALANCEIO, MARCO ZERO E LOG DA ESCALA — NO AR EM PRODUÇÃO (29/08/2026, `e44b4a7..b432d8b`).** As 25 tarefas do plano fecharam. A gestão ganhou: **marco zero** configurável da contagem de justiça · **fim do "+ dias fora"** (a contagem vem só das escalas) · **histórico de quem mexeu** em cada escala, com nome e hora local · botão **Ajustar** com **prévia e o porquê** de cada movimento · **Tirar do lote** · botão de publicar achável com o número real · datas por extenso · aba **Por pessoa** com filtro de janela · e a mesma lógica no **Fim de Ano**. Em produção: marco zero `2026-09-01`, o **`+3` da Heloísa zerado** (com backup), feriados 02/11 e 20/11 limpos. 🔴 **FALTA UMA COISA:** o aviso de ajuste em **data já publicada** nunca rodou contra o banco real — é `scale_confirmed`, um dos 5 tipos que viram **e-mail de verdade**, e a produção está com `modoTeste:false`; testar mandaria e-mail real sobre mudança que seria revertida. Para fechar: ligar `modoTeste:true` em `meta/email_config` (endereço de teste já cadastrado), testar, reverter, desligar. **A gestão vai ser a primeira a usar esse caminho.** 🐛 **8 defeitos foram pegos pelas revisões e pelo clique, nenhum pelos testes verdes** — o pior: ajustar um dia do Fim de Ano **apagaria a aula já realizada de outro dia** do mesmo período; e a prévia propunha reescrever **sábado que já aconteceu** (achado clicando no staging). 📋 **Decisão do Rafael (29/08):** "dois sábados seguidos" é **preferência**, não proibição — teto macio, igual ao motor. Detalhe: `CONTEXTO_SESSAO.md` → sessão 60.

> **✅ O CONTADOR DA ESCALA VIROU CONTAGEM — NO AR EM PRODUÇÃO (26/08/2026, `4c0adf4..83dde1f`).** O contador de justiça era um número **guardado** que só se mexia na 1ª montagem de cada data — e como o fluxo normal remonta a prévia, as pessoas trocavam de dia e a conta não acompanhava: **9 das 16 erradas em produção**, a Karin marcando `1` com 3 sábados. **Não era só tela:** esse número é o insumo do motor, então o contador travado num valor baixo fez o motor continuar dando sábados pra ela — **a escala real de set/out saiu torta por isso**. Agora o número é **contado das escalas** (`contarPorPessoa`, pura): não tem como divergir, e os contadores errados se corrigiram sozinhos, sem migração. **Remontar 3× seguidas dá o mesmo resultado.** Entregues os 8 pedidos do Rodrigo: aba **Por pessoa** · **feriado conta só feriado** · janela × ano (motor usa **12 meses móveis**, porque ano civil zerava o rodízio todo 1º de janeiro) · **descanso entre feriado e os sábados vizinhos**, dos dois lados · **inverter entre unidades** · **nada aparece pro professor antes de publicar** · histórico do ano ao abrir a janela. 🚨 **Achado que não era deste branch: a "Prévia antes de publicar" (24/08, `88a307e`) NUNCA rodou** — chamava `carregarEscalas()`, função inexistente: consolidava o lote no banco e estourava antes de desenhar. Doze verificações automatizadas passaram por cima porque **todas liam o texto do arquivo; nenhuma chamava a função**. Staging: **10/10** contra o Firestore real, **12/12** smokes da escala, **0 erro de console** — ⚠️ **sem clique humano**, os cliques do agente não chegam na página neste ambiente; a validação foi por chamada das mesmas funções que os botões chamam. ⚠️ **FALTA:** refazer set/out (a gestão faz sozinha pelo botão 🔄 Refazer) — e **antes disso**, confirmar com o Rodrigo se sábado e feriado devem ser **filas separadas** (como está) ou **carga total**: quem tem poucos sábados costuma ter muitos feriados. Detalhe: `CONTEXTO_SESSAO.md` → sessão 57. Memórias: [[escala-contador-derivado]] · [[previa-nunca-rodou]].

> **✅ OS 7 AJUSTES DO GRUPO — NO AR EM PRODUÇÃO (25/08/2026, `3ea5804..5295c41`).** Conferi os 7 pontos do grupo **na base de produção** antes de escrever código, e apareceu um **oitavo**: o sábado **29/08** dizia "sem escala" mas a agenda tinha 4 aulas da **grade antiga** — as mesmas 4 pessoas em todos os sábados de agosto, porque o rodízio nunca chegou a valer no mês. Publicar a escala por cima daria 8 professores no mesmo sábado; **Rafael autorizou e apaguei as 4** (backup em `scratchpad/`). Entregues: **(1)** a home contava `pending` (fila do colega) e cobrava a gestão por ela — 5 na tela, 0 de verdade; **(2)** **⇄ Inverter TOI/Hiit** num clique (não dava: o serviço barra quem já está em outra vaga do dia); **(3)** equilíbrio do ciclo **com nomes**, que revelou que os 3 "abaixo do mínimo" (Yasmin, Patrícia, Louiz Lume) **não dão TOI nem Hiit** e nunca seriam escalados — alerta eterno sem solução — mais **correção manual do contador**; **(4)** Reconsolidar/Despublicar explicados, e **reconsolidar passou a republicar** (deixava escala e agenda divergentes em silêncio); **(5)** marca **"não recebe por aula"** pro sócio que dá aula (Rafael Rojais; o Will recebe e a gestão cadastra); **(6)** **sábado que é feriado paga em dobro** (nenhum de 2026 cai em sábado; 2027 tem dois); **(7)** **mesma pessoa não pega dois sábados seguidos**, teto macio — nunca deixa vaga aberta. Suíte **44/44**, staging homologado por mim no navegador (inversão clicada de verdade, 0 erro de console). Um bug foi pego **pela homologação** e corrigido antes de subir (`80e878f`): o Reconsolidar lia o estado de publicação da memória do navegador, então na condição real de uso o aviso não aparecia e a agenda não era republicada — o conserto não consertava. ⚠️ **Falta:** criar a ficha do **Rafael Rojais** pela tela Pessoas com a marca "não recebe por aula" (a do Will é com a gestão). ⚠️ **Regra de operação:** reconsolidar só sábado que ainda não aconteceu — republicar recria as aulas e aula já "realizada" volta pra "prevista". Detalhe: `CONTEXTO_SESSAO.md` → sessão 55. Plano: `docs/superpowers/plans/2026-08-25-ajustes-escala-grupo.md`. Memória: [[rafael-rojais-da-aula-sem-receber]].

> **🗓️ ESCALA CONSERTADA + 📧 E-MAIL NO AR (24–25/08/2026).** Rodrigo achou que a escala de sábado tinha saído errada — **as 11 estavam certas**. Errado era o resto: (a) a **grade normal continuava valendo** em dia de escala, porque o gerador procurava um formato de escala que a Escala Inteligente não grava desde que foi construída — **184 aulas fantasma, 259h**, incluindo **78 aulas de segunda-feira comum em cada feriado**; (b) o **rodízio nunca funcionou** — as 44 vagas saíram por mérito e "justiça" zero vezes, porque `diasTrabalhados` só era consultado abaixo de um piso que todo mundo já tinha passado: Bruno e Karin pegaram os 11 sábados. Agora é **rodízio primeiro, mérito só desempata**, e as 11 foram refeitas: de 6 pessoas para **16**. Entregues também os 4 pedidos do Rodrigo (**prévia antes de publicar** com o porquê, **aviso pessoal** pro escalado, **cota de quantos dias cada um quer**) — dois deles já existiam e ninguém sabia. **Fechado o vazamento de salário**: `monthly_closings` era legível por qualquer professor, virou só-Admin. **E-mail ligado** (SendGrid + extensão + CF `onNotificationCreated`), 5 tipos só, **mas cai no spam** até alguém autenticar o domínio no DNS. ⚠️ **Um defeito foi meu:** rodar `publishToAgenda` fora do navegador gravou a data como texto e as 44 aulas ficaram invisíveis — código, teste e dados corrigidos. Detalhe: `CONTEXTO_SESSAO.md` → sessão 54. Memórias: [[escala-grade-em-dia-de-escala]] · [[escala-rodizio-nunca-funcionou]] · [[avisos-por-email]].

> **⇄ TROCA DE PROFESSOR DA AULA — NO AR EM PRODUÇÃO (22/08/2026, `d455d9e`).** Quem deu a aula registra → o dono confirma → **a gestão confirma** → só aí a aula troca de nome e o pagamento acompanha. Vale até a folha fechar; se o professor não responde, a gestão confirma sozinha e fica registrado. Motor puro novo: `substitution-flow.js`. **Dois bugs que já estavam em produção foram junto:** (a) a caixa de substituições da gestão **nunca funcionou** — faltava índice, o erro virava "nenhum pedido pendente" (por isso agosto tem 1 troca registrada em 1.644 aulas, e duplicada); (b) **quem é só supervisão não recebia aviso de nada, inclusive férias**. Fechado também um 2º furo de segurança: o professor reescrevia `substituteTeacherId` pra si sem nunca escrever `accepted`. **74 aulas de 31/07 apagadas** (backup em `backups/`). ⚠️ **Nunca houve homologação humana no navegador** — a validação é toda automatizada (41/41 smokes, 13/13 REST, E2E pela tela real dirigido por mim). Detalhe: `CONTEXTO_SESSAO.md` → sessão 53. Memórias: [[troca-professor-aula]] · [[caixa-gestao-substituicoes-quebrada]].


> **🟢 COMISSÕES — TRADUTOR DA PACTO CONSTRUÍDO (25/08/2026), 1 pergunta de R$ 2.360 pro Rodrigo.** O TecnoFit acabou; de agosto em diante só existe o export da Pacto. O tradutor está pronto: **`pacto-adapter.js`** (objeto puro estilo `commission.js`, sem Firebase) + `scripts/traduzir-export-pacto.js` + `scripts/lib-xlsx-write.js`, **29 + 8 + 4 casos de teste, suíte 42/42**. **Nada em `commission.js` nem no `index.html`.** Rodar: `node scripts/traduzir-export-pacto.js "<export>.xls" 2026-08` → gera `PACTO-<mês>-CP.xlsx`/`-PP.xlsx` + relatório de conferência. **Não commitado ainda.**
> **🚨 O achado grande:** rodar sobre julho deu **R$ 6.641** contra os **R$ 3.381** realmente pagos. O relatório é `faturamento-recebido` e a migração do TecnoFit entrou aos poucos — contrato antigo aparece com data de lançamento no dia da carga e `Data Início` lá atrás, e contado como venda **paga ativação e bônus de anual de novo**. Regra: `Plano`=`IMPORTAÇÃO` **e** início fora do mês = migração, fica fora. **✅ CONFIRMADO pelo dado (25/08):** cruzando com o "Relatório Faturamento por Período" (o que foi *vendido*), dos **62 migrados 50 nem aparecem lá**, e os 12 que aparecem são 6 cancelamentos + 6 ajustes de R$ 0,00 — **nenhum é venda de agosto**. Pro Rodrigo virou confirmação, não decisão. `--pagar-migrados` inclui, se ele disser o contrário.
> **🛑 ARMADILHA CARA, JÁ BLOQUEADA:** a Pacto tem **dois relatórios com as MESMAS 21 colunas nas mesmas posições**. O `faturamento` traz o **contrato inteiro**, o `faturamento-recebido` traz a **parcela** — contrato 7078: R$ 259,00 × **R$ 3.108,00 (12× exato)**. Como a comissão é 5% do valor quitado, o arquivo errado pagaria **R$ 155 em vez de R$ 12,95 por anual**, sem erro na tela — e **plano recorrente dá 1,0× nos dois**, então amostragem não pega. `PactoAdapter.detectarRelatorio()` **recusa** o errado (`Forma Pagamento` 100% preenchida num, 100% vazia no outro). **Usar sempre `faturamento-recebido_*.xls`.** **Julho NÃO serve de gabarito** (a migração aconteceu no meio dele). ⚠️ **O export usado é de 13/08 — meio mês**; pra pagar agosto, pedir o mês fechado.
> Decisões do Rafael em 25/08: **assumir LOCAL e marcar** (`[PLANO PRESUMIDO]`, inerte pro motor) · **script separado**. **Julho foi PAGO** com o que estava no sistema; a divergência (−R$ 121,68 / +R$ 508,12) está registrada — **não perseguir**. **🧭 Rumo de longo prazo:** unificar o CRM do Rodrigo + comissões + agenda num **sistema só, sem Pacto**, e talvez vender pra outras academias. **Leia antes de tocar em comissões:** `docs/superpowers/specs/2026-08-19-tradutor-pacto-comissoes-design.md` (vivo). **As perguntas pro Rodrigo AINDA NÃO FORAM ENVIADAS:** `memory/pendencias-rodrigo-comissoes-crm.md` (+ a dos migrados). Detalhe: `CONTEXTO_SESSAO.md` → sessão 56. Memórias: [[tradutor-pacto-construido]] · [[visao-sistema-unico-crm-comissoes]] · [[pendencias-rodrigo-comissoes-crm]] · [[migracao-relatorio-pacto-comissoes]] · [[pacto-api-integracao]].
>
> **✅ GRADE DE HORÁRIOS — NO AR EM PRODUÇÃO (13/08/2026, commit `4325b3f`):** renome "Agenda Semanal" → **Grade de Horários** · geração **4 → 8 semanas** · botão **"Gerar agenda agora"** · **troca de dia move as aulas já geradas, perguntando antes** (CF `moveSlotClasses`) · **aula de hoje que já terminou não é mais gerada** · prévia de horas que nunca funcionou pela Agenda Geral · campos travados por falta agora explicam o motivo. Homologado pelo Rafael. Detalhe: [[geracao-agenda-como-funciona]] · [[agenda-edicao-nao-propaga]].
>
> **🔐 SEGURANÇA (13/08/2026) — o cadastro livre do Firebase Auth está ABERTO.** Alerta do GitGuardian sobre "chave exposta" era **falso positivo** (Web API Key é pública por natureza — **não rotacionar**), mas levou ao achado: com a apiKey pública, qualquer pessoa autentica sem ser ninguém no sistema. `/units` e `/audit_log` passaram a exigir cadastro em `/users` — ✅ **já em produção**. Fechar a porta em si exige mover a criação de usuário para CF antes. Detalhe: [[cadastro-livre-auth-aberto]].
>
> **🚨 BUG DE PRODUÇÃO CORRIGIDO EM 13/08/2026 (commit `2b843e1`):** o deploy do módulo de Professores (17/07) substituiu o ruleset vivo de produção e deixou 4 coleções de Comissões sem regra — Pagamentos e Histórico quebrados, e o aviso de crédito da vendedora sumindo **em silêncio**. Antes de qualquer `firebase deploy --only firestore:rules --project production`, rodar `node scripts/validate-rules-comissoes.js`. Detalhe: [[rules-comissoes-orfas]].
>
> Pendências antigas de Comissões que continuam na fila: **(a)** audit BIANUAL legado (4 casos CP/Abril não migrados) e **(b)** renovação vindo como "Novo Contrato" da fonte, que paga o dobro — o caso (b) pode se resolver sozinho com a Pacto, já que a classificação passa a vir de `Situação Contrato` em vez de digitação da vendedora.


> **📌 ÚLTIMO DEPLOY (12/08, sessão 47 — commit `25549d8`, já em produção):** Rodrigo achou que reunião/treinamento/trilha/beach games não existiam — **existiam desde julho**, o problema era achabilidade (criar é em `Agenda → Escala Inteligente → aba Eventos`, pontuar é em `Engajamento → Confirmar Presença`). Entregue: atalho **"+ Criar evento na Escala"** na chamada, **pré-marcação de quem respondeu "Vou"**, e a **Ajuda dentro do app** (item ❓ no menu abrindo o manual do perfil na âncora da tela + botão "?" contextual em 4 telas) — `professores-ajuda.js` novo, `scripts/smoke-ajuda-evento.js` 6/6. Uma folha de presença por tipo+data+unidade é **regra de operação, não bug** (decisão do Rafael). Detalhe: `CONTEXTO_SESSAO.md` → sessão 47.


**✅ MÓDULO PROFESSORES NO AR EM PRODUÇÃO (deploy feito 17/07, sessão 43): Rodrigo aprovou → checklist A–D executado (merge `028ff21`, Firebase rules/índices/9 functions/hosting, `git push origin main`, verificado no github.io). `main` mergeado. AGORA (3 frentes, nenhuma bloqueia): (1) SETUP inicial via planilha `modelo-carga-inicial.xlsx` → loader `seed-producao` (testar staging) + Seção 5 smoke autenticado; (2) MANUAIS Fase 1 feita (artifact publicado p/ validar) → Fase 2 = "Ajuda" no menu + "?" contextuais via staging; (3) ENDURECER FECHAMENTO (reabertura-se-não-pago) via staging. Frente-2 futura: ponto eletrônico TecnoPonto. DETALHE: `CONTEXTO_SESSAO.md` → "▶️▶️ RETOMAR NA PRÓXIMA SESSÃO".**

> **Onde paramos em detalhe:** `CONTEXTO_SESSAO.md` → seção **🔖 ONDE PARAMOS (sessão 42)**, sub-bloco **▶️ RETOMAR AQUI**. Contas de demo (senha `crosstainer2026`): `dono.teste@` · `professor.teste@` (Marcos) · `professor2.teste@` (Bruna). Memórias-chave: [[fix-geracao-aulas-tdz]] · [[projeto-visao-professor-mobile]] · [[frente3-escala-eventos-staff]].
>
> **🕰️ Histórico (jun/2026):** engajamento/escala/PLR construídos em 23–27/06; frentes 1–3 da escala + eventos em jul. Detalhe nas sessões 38–41 de `CONTEXTO_SESSAO.md`.

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
| **Troca** | **Troca de professor da aula: registra → o outro confirma → a gestão homologa; trava o fechamento; 2 furos de segurança + 2 bugs de produção (sessão 53)** | **✅ produção 22/08** |
| **Escala** | **Grade parou de valer em dia de escala (184 aulas fantasma) + rodízio passou a valer de verdade (6→16 pessoas) + prévia + cota por pessoa (sessão 54)** | **✅ produção 24/08** |
| **E-mail** | **Avisos por e-mail: SendGrid + extensão + CF `onNotificationCreated`, 5 tipos com prazo ou dinheiro (sessão 54)** | **✅ ligado · ⚠️ cai no spam até autenticar o domínio** |
| **Contagem** | **O contador de justiça virou contagem derivada das escalas + os 8 pedidos do Rodrigo; a prévia que nunca rodou (sessão 57)** | **✅ produção 26/08 · ⚠️ falta a gestão refazer set/out** |
| **Rebalanceio** | **Ajustar quantos dias cada um tem, com prévia e o porquê · marco zero da contagem · histórico de quem mexeu · tirar do lote · datas por extenso · Fim de Ano junto (sessão 60)** | **✅ produção 29/08 · 🔴 o aviso em data publicada nunca rodou contra o banco real** |

**Próxima ação (sessão 45+):** ✅ **CARGA INICIAL FEITA (29/07)** — a academia começou a usar. Em produção: 113 slots da grade, **475 aulas** (29/07→26/08), 16 professores com login, 8 modalidades, template CP+PP, `THAYNARA SILA`→`SILVA`. Ferramentas: `scripts/seed-carga-inicial.js` (+`lib-xlsx-min.js`, `gerar-aulas.js`) — tudo marcado com `seedSource` p/ rollback via `--cleanup`. Aulas geradas por **force-run do job do Cloud Scheduler** (o cron é `0 2 * * 1`, só segundas). Também no ar: **Desligar/Religar pessoa** (CF `setPersonAccess` + botão no Hub e no Comissões, E2E 14/14) e a rule de `delete` de `/users` só p/ `status=='pendente'` (7/7). Pendências: (1) **CAMILA SANTOS** cadastrada mas sem aula na grade — confirmar com Rodrigo; (2) **Yoga/TOI Mobility/TOI Combate** sem grade por decisão — lembrar que aula fora da grade NÃO entra no fechamento; (3) propagação da edição de grade **não cobre troca de dia da semana** (`professores-agenda.js:575`); (4) manuais **Fase 2**; (5) **endurecer fechamento**.

> ⚠️ **O site que os usuários acessam é o GitHub Pages** (`rafaelmayerbrasil.github.io/crosstrainer-comissoes/`), que serve o **`main`**. `firebase-config.js` só trata esse host como produção — qualquer outro (inclusive `crosstrainer-comissoes.web.app`) cai em **staging**, de propósito. Logo: **publicar pro usuário = `git push origin main`**, não `firebase deploy --only hosting`.

## 🔧 Tech debt registrado (não bloqueia)

1. **Classes legadas em UTC midnight** (pré-Sprint 17 bug D fix): ✅ Migração aplicada em staging (18 classes, +3h). Produção nunca teve esse bug.
2. ~~`sw.js` cacheia agressivamente `professores.*`~~ ✅ **RESOLVIDO (12/06, autorizado):** sw v3.1 — JS same-origin é network-first; CDNs seguem cache-first. Cache de JS/CSS do hosting também caiu de 7 dias → 5 min (`firebase.json`).
3. **Audit log entries antigas** (Sprint 2/3a/3b) com `module: 'professores'` em vez de `'agenda'`: ✅ Migração aplicada em staging (35 entries, `professores` → `agenda`). Production mantém entries legadas.
4. **CDN externo como dependência** (Sprint 8): ✅ Fallback local em `/vendor/` (5 libs) + CDN como backup.
5. **CreditService race condition rara** no abate de créditos: aceito como tech debt (1 admin por vez em produção realística).
6. **Cross-region warning** (CFs em `us-central1`, triggers de Firestore default em `sa-east1`): cosmético, sem impacto funcional.
7. **Critérios 5/6 da Sprint 4a** (estagiário com/sem excedente) seguem sem validação direta — sem estagiário com aulas em staging.
8. **`ScaleService.registrarHistorico` race condition rara** no histórico da escala: read-modify-write sem transação, duas ações simultâneas na MESMA escala podem perder uma linha; aceito como tech debt (é log de auditoria, não insumo do motor).

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
