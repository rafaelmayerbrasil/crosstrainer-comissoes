# Engajamento — UI (Plano 3) — Plano curto

> Executado em modo `/loop` (subagent-driven + verificação no preview). Estilo = **professores.html atual** (tema escuro, CSS vars/classes existentes). Consome `EngagementService` (pronto). Regras já no staging. **NÃO** inclui a escala dos sábados.

**Estilo de referência:** espelhar `professores-escalas.js` / `professores-cadastro.js` (page-hdr, page-toolbar, table-wrap, modal-overlay/modal, btn-primary/btn-sm, chips). Mockup aprovado da chamada: tica rápido presente/faltou, estrela líder ×2, "treinou em outra", +pts ao vivo, rodapé com total.

## Arquivos
- `professores-engajamento.js` (criar) — render functions do domínio: `renderEngajConfigPage`, `renderEngajChamadaPage`, `renderEngajPlacarPage` + modais/helpers. Expor no `window`.
- `professores-nav.js` (modificar) — nova seção **"Engajamento"**: páginas `engaj-config` (admin), `engaj-chamada` (admin/superv), `engaj-placar` (todos; professor vê só o próprio). Registrar em `PROF_PAGES` + `PAGE_DEFINITIONS` + `SECTION_ORDER`.
- `professores.js` (modificar) — `navigateTo`: dispatch das 3 páginas → render functions.
- `professores.html` (modificar) — 3 `<div class="page" id="page-engaj-config|engaj-chamada|engaj-placar">` + `<script src="professores-engajamento.js">`.

## Tarefas (uma por tela, verificar no preview antes de commitar)

**T1 — Scaffold (nav + roteamento + page divs + arquivo skeleton).**
- Registrar as 3 páginas (nav/rotas/divs) + `professores-engajamento.js` com as 3 render functions retornando um placeholder "em construção".
- Verificar: login admin no staging (via preview local) → as 3 entradas aparecem na sidebar na seção Engajamento e abrem a página certa. Screenshot. Commit.

**T2 — Config (admin).**
- `renderEngajConfigPage`: form com TODOS os valores de pontos (de `EngagementService.getConfig`) + penalidades + lista/CRUD de ciclos (`listCycles`/`saveCycle`). Salvar → `saveConfig`. Liberdade total da gestão.
- Verificar: editar um valor, salvar, recarregar → persiste no staging. Screenshot. Commit.

**T3 — Chamada (admin/superv).**
- `renderEngajChamadaPage`: seletor de tipo (escola interna / reunião / treinamento / evento) + data + unidade → lista de colaboradores (`TeacherService.list`, filtrar por unidade quando aplicável) → marcação rápida presente/faltou; escola interna: estrela líder (×2) + "treinou em outra"; treinamento: faltou justificado vs sem aviso; +pts ao vivo + rodapé total. Salvar → `EngagementService.recordAttendance`. Reunião: marca como "a confirmar" e só pontua quando a gestão confirma (campo `confirmedBy`).
- Verificar: lançar uma chamada de escola interna no staging → conferir entries via placar. Screenshot. Commit.

**T4 — Placar (todos).**
- `renderEngajPlacarPage`: seletor de ciclo (`listCycles` + `currentCycle`) → tabela de pessoas com total + breakdown por tipo (`scoreboard` por pessoa, tempo de casa pela data de admissão do teacher). Professor: só o próprio.
- Verificar: placar reflete a chamada da T3 no staging. Screenshot. Commit.

**T5 — Polimento + pendências do Plano 2.**
- Adicionar `console.error('[EngagementService.x]', err)` nos catches + `AuditService.log` nas mutações (`saveConfig`, `recordAttendance`, `awardSubstitution`, `saveCycle`).
- Empty states, dark mode, responsivo. Verificar no preview. Commit.

**T6 — Verificação final integrada no staging** (admin + professor) + deploy de hosting do staging se necessário pra o Rodrigo clicar. Reportar ao usuário com screenshots.

## Regras
- Só arquivos do módulo (`professores-*.js/html`, `professores-engajamento.js`). NUNCA `index.html`, `commission.js`, `manifest.json`, `sw.js`.
- Cada tela: construir → verificar no preview (login demo) → screenshot → commit → revisão por subagente (conformidade + qualidade).
- Parar e chamar o usuário ao concluir T6, ou se surgir decisão de produto não-delegada.
