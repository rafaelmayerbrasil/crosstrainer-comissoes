# crosstrainer-comissoes

Sistema **CrossTainer Elite** — plataforma PWA para a gestão de uma rede de academias CrossTainer: comissões da equipe comercial e toda a rotina dos professores (agenda, escala, horas, fechamento e pagamento).

> O nome da marca é **CrossTainer**. `crosstrainer-comissoes` é só o identificador técnico do repositório e dos projetos do Firebase, e fica como está.

## 📦 Dois módulos, os dois em produção

| Módulo | Status | Arquivos principais |
|--------|--------|---------------------|
| **Comissões** (equipe comercial) | ✅ Em produção | `index.html`, `commission.js`, `sw.js`, `manifest.json`, `renovacoes.html`, `termometro.html` |
| **Professores** (agenda · escala · horas · fechamento) | ✅ Em produção desde 17/07/2026 | `professores.html`, `professores-*.js`, `functions/`, `firestore.rules` |

## 🎯 Módulo Comissões

Para vendedoras e gestão acompanharem comissões, metas e desempenho de vendas.

- **Painel da vendedora:** comissão acumulada (P1–P4), projeção de fim de mês, simulador, gamificação
- **Painel administrativo:** dashboard gerencial, edição e divisão de lançamentos, recibos em PDF, comparativo de períodos, pagamentos e créditos
- **Motor de comissões P1–P4** (`commission.js`): percentual sobre o caixa, bônus por contrato, meta da unidade, conversão de voucher
- **Regime de caixa** (de setembro/2026): a comissão é do mês em que o dinheiro entrou, uma vez só por contrato; estorno vira crédito no pagamento seguinte
- **Comissão automática pela API da Pacto** (de outubro/2026): o mês se recalcula sozinho toda madrugada; a planilha exportada virou plano B
- **Lista de renovações** das consultoras (`renovacoes.html`), **termômetro do mês** (`termometro.html`) e **meta sugerida** para mês sem meta
- **Regra do bônus da unidade** (de outubro/2026): três mínimos batidos = 100% · um não batido = 50% · dois ou mais = zera; mínimo individual pela jornada
- A mensalidade seguinte do mesmo plano recorrente **não é venda**, seja quem for que lançou

📄 Detalhe técnico: `DOCUMENTACAO.md` § Módulo Comissões

## 👥 Módulo Professores

Cadastro, agenda, escala, trocas, horas, fechamento mensal, pagamentos e férias.

**Pessoas e acesso**
- **Hub Pessoas:** cadastro único de professores, vendedoras, gestão e supervisão; ficha em abas; desligar e religar pessoa; trocar o e-mail de acesso pela tela
- **Aba Salarial só do Admin:** hora-aula ou bolsa, VR, VT (fixo **ou por dia trabalhado**), outros benefícios, histórico com data de vigência

**Agenda**
- **Grade de Horários** recorrente por unidade → aulas geradas 8 semanas adiante (toda segunda, 2h)
- **Minha Agenda** (professor) e **Agenda Geral** (gestão), com registro automático da aula realizada (todo dia, 3h)
- **Troca de professor da aula:** quem deu a aula registra → o dono confirma → a gestão confirma
- **Avisos dos professores:** o professor avisa atraso, saída ou aula que não aconteceu, e a gestão responde num clique
- **Notificações** no sino e por e-mail (5 tipos com prazo ou dinheiro)

**Escala Inteligente**
- Sábados, feriados, fim de ano, Escola Interna e eventos, com rodízio de verdade (contagem derivada das escalas), prévia antes de publicar e o porquê de cada vaga
- Preferência por data, cota por pessoa, folga mínima configurável, ajuste com prévia, histórico de quem mexeu
- **Copiar a escala para o WhatsApp**

**Horas e fechamento**
- **Minhas horas do mês:** o professor confere o mês, corrige o dia diferente e envia; a gestão valida, e validar ajusta as próprias aulas
- Hora em dois lugares conta uma vez; feriado conta em dobro; banco de horas do estagiário
- **Fechamento por pessoa/mês**, com conferência em blocos e checklist que trava o botão enquanto houver pendência
- **Vale-transporte por dia trabalhado:** dias com aula × passagens por dia × valor da passagem, com correção no mês
- **Pagamentos e recibos** (A4), créditos automáticos, **relatórios** em Excel e PDF

**Férias, engajamento e PLR**
- Férias e recesso (pedido, aprovação, pagamento com 1/3, saldo anual e alerta de férias vencidas)
- Engajamento (presença em eventos, pontos e placar) e PLR (avaliação de desempenho)

**Ajuda dentro do app:** item ❓ no menu e botão "?" nas telas, abrindo `manual-admin.html` ou `manual-professores.html` na seção certa.

📄 Detalhe técnico: `DOCUMENTACAO.md` § Módulo Professores

## 🛠️ Stack

- **Frontend:** HTML, CSS e JavaScript puro (um arquivo por módulo, sem framework)
- **Backend:** Firebase (Firestore · Authentication · Cloud Functions 2ª geração, Node 22 · Hosting)
- **Regras de negócio em módulos puros**, sem Firebase, testáveis fora do navegador; os que a Function também usa têm cópia gêmea em `functions/`, e um teste falha se as duas divergirem
- **Service Worker:** PWA no módulo Comissões
- **Integrações:** API da Pacto (vendas e renovações), SendGrid (e-mail), BrasilAPI (feriados)
- **Bibliotecas:** SheetJS, Chart.js, jsPDF, JSZip (com cópia local em `vendor/`)

## ☁️ Ambientes

| Ambiente | Projeto Firebase | Endereço | Uso |
|----------|------------------|----------|-----|
| **Produção** | `crosstrainer-comissoes` | `rafaelmayerbrasil.github.io/crosstrainer-comissoes` | O que os usuários acessam |
| **Staging** | `crosstrainer-comissoes-staging` | `crosstrainer-comissoes-staging.web.app` | Homologação antes de qualquer publicação |

- `firebase-config.js` escolhe o ambiente pelo endereço: **só o GitHub Pages é produção**; qualquer outro cai em staging, de propósito.
- **Produção tem duas portas.** O site é o GitHub Pages, que serve o `main`: publicar para o usuário é `git push origin main`. Regras, índices e Functions vão pelo Firebase, sempre com `--project production` explícito.
- O padrão dos comandos do Firebase é o staging (`.firebaserc`).

## 📂 Estrutura de arquivos

```
crosstrainer-comissoes/
├── index.html, commission.js, sw.js, manifest.json   → Comissões (não alterar sem autorização)
├── renovacoes.*, termometro.*, pacto-*.js             → Renovações, termômetro e integração com a Pacto
├── comissoes-mes.js, metas-sugeridas.js, jornada-comercial.js, estorno-comissao.js, upload-pela-api.js
├── professores.html, professores-*.js                 → Telas do módulo Professores
├── closing-payroll.js                                 → A conta da folha do mês (inclui o vale-transporte)
├── hour-declaration.js, intern-hour-bank.js           → Horas do mês e banco de horas do estagiário
├── scale-engine.js, scale-rebalance.js, scale-service.js → Escala Inteligente
├── substitution-flow.js, class-avisos.js, class-propagation.js
├── pessoas-model.js, user-model.js                    → Junção de pessoas e derivação de acesso
├── manual-admin.html, manual-professores.html         → Manuais (abertos pela Ajuda do app)
├── receipt.html                                       → Impressão de recibos
├── vendor/                                            → Cópia local das bibliotecas
├── functions/                                         → Cloud Functions (index.js + cópias gêmeas dos módulos puros)
├── scripts/                                           → Testes, homologações e utilitários (Node, Admin SDK)
│   ├── smoke-*.js                                     → Suíte local (não toca o banco)
│   ├── e2e-*-staging.js, validate-*.js, validar-*.js  → Ponta a ponta e regras, contra o staging
│   └── homologar-*.js, diag-*.js, conferir-*.js       → Conferências só de leitura
├── firestore.rules, firestore.indexes.json, storage.rules
├── CLAUDE.md, CONTEXTO_SESSAO.md                      → Estado e histórico do desenvolvimento
├── DOCUMENTACAO.md                                    → Referência técnica (fora do git, só no disco)
├── sprint-*.md, runbook-*.md                          → Playbooks das sprints
└── docs/                                              → Propostas, conversas com a gestão, superpowers/{specs,plans}
```

## 🚦 Para começar (desenvolvimento)

```bash
# Uma vez
firebase login
cd functions && npm install
cd scripts && npm install
# Service account: Firebase Console → scripts/serviceAccount-staging.json (está no .gitignore)

# Suíte local (só o smoke-9 falha; é antigo)
for f in scripts/smoke-*.js; do node "$f" > /dev/null 2>&1 || echo "FALHOU $f"; done

# Publicar no staging
firebase deploy --only firestore:rules --project staging
firebase deploy --only functions:<nome> --project staging
firebase deploy --only hosting --project staging
```

Antes de publicar regras em produção: `node scripts/validate-rules-comissoes.js`.
Ao mudar um arquivo de tela, trocar o `?v=` dele em `professores.html` (ou no `index.html`), senão o navegador serve o antigo.

## 📚 Documentos (ordem de leitura)

1. **[CLAUDE.md](CLAUDE.md)** — regras do projeto e o estado atual resumido
2. **[CONTEXTO_SESSAO.md](CONTEXTO_SESSAO.md)** — onde paramos, decisões e o registro de cada sessão
3. **`DOCUMENTACAO.md`** — referência técnica de cada módulo (fora do git)
4. **`docs/superpowers/specs/` e `plans/`** — desenho e plano de cada entrega grande
5. **Playbooks de sprint** (`sprint-*.md`) — a construção original do módulo Professores
6. **Especificação e proposta funcional** — `EspecificacaoTecnica_Modulo_Professores_CrossTainer_V1.md`, `Proposta_Funcional_Consolidada_Modulo_Professores_CrossTainer_V3.md`, `AgendaWireframes_design.html`

## 🤖 Regras invioláveis

1. **Não alterar `index.html`, `commission.js`, `manifest.json` ou `sw.js`** sem autorização explícita.
2. **Produção só depois de homologar no staging** e com o OK explícito do responsável.
3. **Service accounts e credenciais** (`scripts/serviceAccount-*.json`, `pacto-credencial*`) nunca vão para o git.
4. **Dados salariais** (`teacher_salaries`, `monthly_closings`, `payroll_config`, `payroll_adjustments`) são só do Admin.
5. **Mês fechado é irreversível:** regras e Function bloqueiam alteração.
6. **`audit_log` só recebe registros novos;** nunca atualizar nem apagar.
7. **A marca é `CrossTainer`** em todo texto visível; os identificadores do Firebase não mudam.

---

**Última atualização:** 06/10/2026 · sessão 89 (vale-transporte por dia trabalhado em produção)
