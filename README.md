# crosstrainer-comissoes

Sistema CrossTainer Elite — plataforma PWA para gestão da operação completa de uma rede de academias CrossTainer.

## 📦 Dois módulos coexistindo

| Módulo | Status | Arquivos principais |
|--------|--------|---------------------|
| **Comissões** (vendedores · Performance) | ✅ Em produção | `index.html`, `commission.js`, `sw.js`, `manifest.json` |
| **Professores** (agenda · pagamento) | 🟡 Em desenvolvimento ativo (97% completo, em staging) | `professores.html`, `professores-*.js`, `functions/`, `firestore.rules` |

## 🎯 Módulo Comissões (produção · `rafaelmayerbrasil.github.io`)

Sistema para vendedoras e administradores acompanharem comissões, metas e desempenho de vendas.

- Painel da vendedora: comissão acumulada (P1-P4), projeção de fim de mês, simulador interativo, gamificação
- Painel administrativo: upload de fechamento, dashboard gerencial, edição/split de registros, emissão de recibos PDF, comparativo de períodos
- Motor de comissões P1-P4: percentual sobre caixa, bônus por contrato, meta da unidade, conversão de voucher
- Sistema de créditos automáticos pra divergências pós-pagamento
- Tratamento especial: upgrade de plano, renovação balcão, validação de mês único

📄 Detalhamento técnico: [DOCUMENTACAO.md](DOCUMENTACAO.md) § Módulo Comissões

## 👥 Módulo Professores (em homologação · staging)

Plataforma completa de gestão de professores: cadastro, agenda, substituições, fechamento mensal, pagamentos, recibos e escalas especiais.

**Funcionalidades entregues** (em staging, aguardando homologação final):

1. **Cadastro de Professores** — efetivo / estagiário / eventual, com vínculo a unidades e modalidades
2. **Aba Salarial restrita** — apenas Admin, com histórico de alterações, VR/VT/Outros e `effectiveDate`
3. **Agenda Semanal** — grade recorrente por unidade, slots livres, multi-select de dias em lote
4. **Geração automática de aulas** — Cloud Function gera 4 semanas adiante via cron semanal
5. **Minha Agenda** — professor vê próprias aulas filtradas
6. **Agenda Geral** — visão multi-unidade somente leitura
7. **Substituições** — direta (titular indica) + cobertura aberta (qualquer apto pega)
8. **Notificações in-app** — sino na sidebar com badge e dropdown
9. **Fechamento Mensal** — consolida horas, calcula valor por professor, congela aulas
10. **Pagamentos + Recibos** — emissão individual ou em lote, página de impressão A4, confirmação de pagamento
11. **Créditos automáticos** — divergências viram crédito abatido no próximo recibo
12. **Escalas Especiais** — sábado/feriado/eventos com pesos diferenciados (×1, ×2, ×3)
13. **Detecção automática de feriado nacional** — via BrasilAPI, cache 7 dias
14. **Férias e Recesso (Sprint 6a)** — workflow CLT completo: professor solicita até 3 períodos, admin aprova/recusa, CF pula classes nas datas aprovadas
15. **Pagamento de Férias (Sprint 6b)** — cálculo automático para efetivo (média 12 meses + 1/3 CLT) e estagiário (bolsa proporcional, Lei 11.788). Modo manual + sem pagamento + adiar. Integra com fechamento mensal + recibo A4. Rateio proporcional quando férias atravessa 2 meses
16. **Controle Anual de Saldo (Sprint 6c)** — painel admin "📊 Saldos de Férias" com badges 🟢🟡🔴 por professor. Painel professor "📊 Meu Saldo" com período aquisitivo CLT (12 meses de admissão) + histórico. Soft warning ao exceder saldo (alerta + justificativa obrigatória). Alerta automático de **férias vencidas** (CLT Art. 134 — pagamento dobrado se concessivo expirar)

**Em desenvolvimento ou pendentes:**

- Sprint 5b (opcional) — Workflow de aceite/recusa pelo professor + alocação automática
- Sprint 7 — Notificações por email (Brevo + Trigger Email)
- Sprint 8 — Relatórios + Exportações
- Polimentos finais — UX, bugs cosméticos, tech debt registrado em CLAUDE.md

📄 Detalhamento técnico: [DOCUMENTACAO.md](DOCUMENTACAO.md) § Módulo Professores

## 🛠️ Stack

- **Frontend:** HTML5/CSS3/Vanilla JS (módulos por arquivo, sem framework)
- **Backend:** Firebase (Firestore NoSQL · Authentication · Cloud Functions 2nd gen · Hosting)
- **Service Worker:** PWA offline + cache no módulo Comissões
- **Bibliotecas:** SheetJS (Excel), Chart.js (gráficos), BrasilAPI (feriados)

## ☁️ Ambientes

| Ambiente | Projeto Firebase | Hostname | Status |
|----------|------------------|----------|--------|
| **Produção** | `crosstrainer-comissoes` | `rafaelmayerbrasil.github.io/crosstrainer-comissoes` | Comissões ✅ · Professores ❌ (não deployado) |
| **Staging** | `crosstrainer-comissoes-staging` | `localhost:5000` ou `crosstrainer-comissoes-staging.web.app` | Comissões + Professores |

Detecção automática de ambiente via `firebase-config.js` (regra inviolável: só usa produção se hostname for exato).

## 📂 Estrutura de arquivos

```
crosstrainer-comissoes/
├── index.html, commission.js, sw.js, manifest.json   → Módulo Comissões (produção)
├── professores.html, professores-*.js                → Módulo Professores (staging)
├── receipt.html                                       → Página standalone de impressão de recibos
├── functions/                                         → Cloud Functions (Node 22)
│   └── index.js                                       → healthCheck, generateClasses*, processSubstitutionAcceptance, closeMonth, etc.
├── scripts/                                           → Utilitários Node.js (Admin SDK)
│   ├── admin.js                                       → Smoke tests automatizados (Sprints 4a, 4b, 5a)
│   ├── seed-special-scale-types.js                    → Popula tipos de escala especial
│   └── migrate-users-to-profiles.js                   → Migração de schema users
├── firestore.rules, firestore.indexes.json            → Configuração do Firestore
├── CLAUDE.md, CONTEXTO_SESSAO.md                      → Estado do desenvolvimento (memória do projeto)
├── DOCUMENTACAO.md                                    → Detalhes técnicos de cada módulo
├── sprint-*.md, runbook-*.md                          → Playbooks de cada sprint (8 sprints documentadas)
└── docs/                                              → Specs funcionais + técnicas do cliente
```

## 🚦 Pra começar (desenvolvimento)

```bash
# Setup uma vez
firebase login
cd functions && npm install
cd scripts && npm install
# Service account: baixar de Firebase Console → scripts/serviceAccount-staging.json (no .gitignore)

# Servidor local (módulo Professores)
firebase serve --only hosting --project staging
# Abre em http://localhost:5000/professores.html

# Smoke tests automatizados (Admin SDK)
cd scripts && node admin.js --project staging smoke-4a unit-cp 2026 5
cd scripts && node admin.js --project staging smoke-4b <closingId>
cd scripts && node admin.js --project staging smoke-5a

# Deploy em staging
firebase deploy --only firestore:rules --project staging
firebase deploy --only firestore:indexes --project staging
firebase deploy --only functions --project staging
firebase deploy --only hosting --project staging
```

## 📚 Documentos chave (ordem de leitura recomendada)

1. **[CLAUDE.md](CLAUDE.md)** — estado em uma frase (leia primeiro em cada sessão)
2. **[CONTEXTO_SESSAO.md](CONTEXTO_SESSAO.md)** — log completo de sessões, decisões e próximos passos
3. **[DOCUMENTACAO.md](DOCUMENTACAO.md)** — referência técnica detalhada de cada módulo
4. **Playbooks de Sprint** — instruções passo-a-passo de cada sprint:
   - [sprint-0B-infraestrutura.md](sprint-0B-infraestrutura.md)
   - [sprint-1-cadastro-professores.md](sprint-1-cadastro-professores.md)
   - [sprint-2-agenda.md](sprint-2-agenda.md)
   - [sprint-3a-aulas-e-minha-agenda.md](sprint-3a-aulas-e-minha-agenda.md)
   - [sprint-3b-agenda-geral-e-substituicoes.md](sprint-3b-agenda-geral-e-substituicoes.md)
   - [sprint-4a-fechamento-mensal.md](sprint-4a-fechamento-mensal.md)
   - [sprint-4b-pagamentos-recibos.md](sprint-4b-pagamentos-recibos.md)
   - [sprint-5a-escalas-e-feriados.md](sprint-5a-escalas-e-feriados.md)
   - [runbook-sprint-3b-finalize.md](runbook-sprint-3b-finalize.md)
5. **Specs do cliente** (em `docs/`):
   - `Proposta_Funcional_Consolidada_Modulo_Professores_CrossTainer_V3.md`
   - `EspecificacaoTecnica_Modulo_Professores_CrossTainer_V1.md`
   - `AgendaWireframes_design.html`

## 🤖 Regras invioláveis (somente leitura)

1. **Não tocar em `sw.js`** sem autorização explícita (serviço crítico de produção PWA).
2. **Nunca mexer no nome `CrossTainer` em produção** (atual `CrossTrainer` precisa correção controlada — anotada em pendências).
3. **Não fazer deploy em produção do módulo Professores** até homologação completa do cliente.
4. **Service account keys** (`scripts/serviceAccount-*.json`) NUNCA vão pro git (gitignored).
5. **Audit log** é append-only, nunca atualizar/deletar entries.
6. **Mês fechado** (`monthly_closings` com aulas congeladas) é imutável — não permite alterações em status de aulas dele.
7. **Histórico salarial** (`teacher_salaries.salaryHistory`) é append-only, com `effectiveDate` controlando aplicação retroativa.
8. **Dados salariais** (coleção `teacher_salaries`) só visíveis pra Admin (Security Rule + UI condicional).

---

**Última atualização:** 22/05/2026 · Sprint 5a validada em staging
