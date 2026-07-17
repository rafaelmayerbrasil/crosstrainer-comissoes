# Plano C — Home "Centro de Pendências"

**Goal:** Substituir a home neutra por um painel por perfil: **admin/gestão** vê pendências (férias a aprovar, substituições pendentes) + atalhos; **professor** vê próximas aulas de hoje, substituições pendentes + atalhos. Versão **enxuta** (sem KPIs pesados — design §5).

**Architecture:** Novo arquivo `professores-home.js` com `renderHomePage()` (+ helpers admin/professor). `navigateTo('home')` passa a despachar pra ele (já é chamado no login via `showApp()`). Cada contador é uma query simples em `try/catch` — se falhar, o chip é omitido (a home nunca quebra).

**Tech Stack:** vanilla JS. Validação: manual em staging. (Lógica é DOM/async → sem smoke; consistente com o resto do módulo.)

**Branch:** `feature/shell-integrado`.

## Fontes de dados (confirmadas no código)
- Férias a aprovar: `db.collection('vacation_requests').where('status','==','pendente')` → `.size`.
- Substituições pendentes (admin, geral): `db.collection('substitutions').where('status','==','pending')` → `.size`.
- Aulas do professor hoje: `ClassService.listByTeacher(professorId, {from, to})` ([professores-shared.js:~1249](../../../professores-shared.js)).
- Substituições do professor: `SubstitutionService.listPendingForSubstitute(uid)` ([:1620](../../../professores-shared.js)).
- Nome das modalidades: `db.collection('modalities').get()` → map id→name.
- Perfil: `isAdminGestao()`/`isSupervisao()` (gestão) vs professor; `getCurrentProfessorId()` (vínculo).

## Task 1 — `professores-home.js` + wiring
**Files:** Create `professores-home.js`; Modify `professores.html` (script tag + CSS); Modify `professores.js` (dispatch 'home').

- [ ] Criar `professores-home.js` com `renderHomePage()` + `renderHomeAdmin()` + `renderHomeProfessor()` (código na implementação).
- [ ] `professores.html`: incluir `<script src="professores-home.js">` antes de `professores.js`; adicionar CSS `.home-*`.
- [ ] `professores.js`: no `navigateTo`, adicionar `else if (pageId === 'home' && typeof renderHomePage === 'function') renderHomePage();`.
- [ ] Validar em staging (admin + professor).

## Critérios de aceite
1. Admin: saudação + faixa "Precisam de você" com contadores reais (férias a aprovar, substituições pendentes) que **linkam** pra seção certa; "Tudo em dia ✅" quando zero.
2. Professor: saudação + próximas aulas de hoje (hora + modalidade) + substituições pendentes; empty states quando não há.
3. Qualquer contador que falhe é omitido — a home nunca quebra.
4. Atalhos navegam via `navigateTo`. Código novo só no Professores; zero risco de prod.
