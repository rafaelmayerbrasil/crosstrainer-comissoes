# Check Geral do Sistema — pré-revisão final do cliente

> **Propósito:** varredura completa (erros + design) antes da revisão final do cliente.
> **Retomada:** se a sessão cair, continuar do primeiro item ⬜ abaixo. Branch `feature/shell-integrado`, staging.

## Checklist

- [x] 1. Mecânico: smokes (3/3 ✓) + sintaxe de 15 arquivos JS (15/15 ✓)
- [x] 2. UI admin — 11 páginas varridas; todas renderizam. **1 bug real achado e corrigido** (ver Achados)
- [x] 3. UI professor — 6 páginas varridas; 2 achados reais (índice + listener), ambos corrigidos
- [x] 4. Design: lista/wizard/ficha OK em dark e light (screenshots conferidos); ESC não fecha os 2 modais novos (cosmético)
- [x] 5. Code review do diff `main..HEAD` — 1 achado médio (createUser legado) + cosméticos; suspeita de 'pending' descartada (é o valor canônico)
- [ ] 6. Consolidar achados + reportar ao cliente (em andamento)

## Achados

- 🔴 **CORRIGIDO (`359d5bc`):** tela **Pagamentos** quebrada desde a Sprint 4b — `renderPagamentosPage` chamava `ClosingService.list()` sem `unitId` (obrigatório) → "Erro ao carregar: unitId obrigatório" pra QUALQUER usuário. Fix: busca fechamentos por unidade e agrega. Validado na UI: Mai/2026 mostra `unit-cp · fechado · 1 prof · R$ 240,00`.
- 🔴 **CORRIGIDO (`ddaf542`):** "Minhas Férias" do professor falhava silenciosamente — índice composto `vacation_requests (teacherId ASC, requestedAt DESC)` exigido pela query NUNCA esteve no `firestore.indexes.json` (criado à mão no console na 6a e perdido). UI mascarava com "Histórico 0". Índice declarado + deployado (aguardar build de minutos).
- 🟡 **CORRIGIDO (`ddaf542`):** listener `onSnapshot` do contador de férias (admin) não era derrubado no logout → spam de `permission-denied` no console ao trocar de usuário na mesma aba. Agora guarda unsubscribe e derruba no signOut.
- 🟠 **ABERTO (pede autorização — index.html):** a tela LEGADA de Usuários do Comissões (ainda alcançável por `index.html?page=users`) grava o users doc **como o usuário novo** via `secondaryDb` — as rules atuais negam (create só admin) → criar usuário por lá deixa **Auth órfão**. Caminho oficial é o hub (que grava como admin, correto). Fix de 1 linha: trocar `secondaryDb` → `db`. Alternativa: aceitar como tela morta e remover na pós-homologação.
- 🟡 **ABERTO (decisão de deploy):** `firebase.json` serve JS/CSS com `Cache-Control: max-age=604800` (7 dias) — após cada deploy, usuários podem rodar JS velho por dias (staging E produção). Recomendo discutir no checklist de deploy: baixar pra `max-age=300` ou versionar os scripts (`?v=`).
- 🟢 Cosméticos: ESC não fecha os modais novos do hub (X funciona); ternário singular/plural inerte no chip de férias da home; cache do preview exige hard-refresh após deploy (consequência do item acima).

## Estado da retomada

- Fixture: usar `node scripts/fixture-pessoas.js --admin-only` (admin `fix.pessoas.admin@teste.com`/`fixadmin123`); cleanup ao final do check.
- Preview: server `crosstrainer-static` (porta 8123, `.claude/launch.json`); staging detectado por localhost.
