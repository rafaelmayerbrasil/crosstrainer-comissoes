# Plano D — Form de Usuários: profiles[] / moduleAccess / professorId

**Goal:** Evoluir o cadastro de Usuários do Comissões (`index.html`) para suportar **múltiplos perfis** (`profiles[]`), **`moduleAccess` derivado**, e **vínculo com professor** (`professorId`) — permitindo criar/editar um professor pela tela, sem editar Firestore na mão.

**Architecture:** Mantém `role` (o Comissões depende dele) e ADICIONA `profiles[]` + `moduleAccess` + `professorId`. Uma função `deriveUserModel(profiles)` calcula `moduleAccess` e o `role` primário a partir dos profiles. O form passa a ter checkboxes de perfil (multi) + um seletor de professor (condicional). Também fecha o furo de segregação: `index.html` passa a bloquear quem não tem `moduleAccess.comissoes`.

**Tech Stack:** vanilla JS. Validação: manual em staging. Toca em `index.html` (produção) — na branch `feature/shell-integrado`, regra #7.

**Decisão (sessão):** (a) evoluir o form existente no `index.html` (fonte única, §4.5).

## Modelo de dados (alvo)
Doc `users/{uid}`: `{ name, email, cpf, pix, role, profiles[], moduleAccess{comissoes,professores}, professorId|null, allowedUnits[], unitId, status, createdAt }`.

Derivação (a fonte da verdade passa a ser `profiles[]`):
```js
function deriveUserModel(profiles) {
  const has = (...ps) => profiles.some(p => ps.includes(p));
  const moduleAccess = {
    comissoes:   has('admin', 'vendedor'),
    professores: has('admin', 'admin_gestao', 'supervisao', 'professor', 'professor_estagiario'),
  };
  // role primário p/ compat com o Comissões (ACL/exibição):
  const role = profiles.includes('admin') ? 'admin'
             : profiles.includes('vendedor') ? 'vendedor'
             : (profiles[0] || 'vendedor');
  return { moduleAccess, role };
}
```
Perfis: `admin`, `admin_gestao`, `supervisao`, `professor`, `professor_estagiario`, `vendedor`.

---

## Task 1 — Helper `deriveUserModel` + smoke (TDD)
**Files:** Create `user-model.js` (compartilhado index.html + professores.html); Test `scripts/smoke-user-model.js`.

Motivo de arquivo compartilhado: a mesma derivação é usada no form (`index.html`) e na migração inline (`professores.js`). Evita DRY-drift como o que já causou bug (admin_gestao/pagamentos).

- [ ] Smoke primeiro (`scripts/smoke-user-model.js`): assert que
  - `['admin']` → moduleAccess {comissoes:true, professores:true}, role 'admin'.
  - `['vendedor']` → {comissoes:true, professores:false}, role 'vendedor'.
  - `['admin_gestao']` → {comissoes:false, professores:true}, role 'admin_gestao'.
  - `['professor']` → {comissoes:false, professores:true}, role 'professor'.
  - `['admin','professor']` → {comissoes:true, professores:true}, role 'admin'.
- [ ] Rodar → falha (módulo ausente).
- [ ] Criar `user-model.js` (UMD: `window.UserModel` / `module.exports`) com `deriveUserModel` + `PROFILE_LABELS` (admin→"Administrador", admin_gestao→"Admin/Gestão", supervisao→"Supervisão", professor→"Professor", professor_estagiario→"Professor (Estagiário)", vendedor→"Vendedor(a)").
- [ ] Rodar → passa.
- [ ] Commit.

## Task 2 — Carregar `user-model.js` nas duas páginas + alinhar migração
**Files:** Modify `index.html` (script tag); `professores.html` (script tag); `professores.js` (`migrateUserProfile` usa `UserModel.deriveUserModel`).

- [ ] `index.html`: `<script src="user-model.js"></script>` após `firebase-config.js`.
- [ ] `professores.html`: idem, antes de `professores.js`.
- [ ] `professores.js` `migrateUserProfile`: derivar via `UserModel.deriveUserModel(profile.profiles || [profile.role])` (mantém fallback). Garante que legado e form usam a MESMA regra.
- [ ] Smoke `node scripts/smoke-sidebar.js` + `smoke-user-model.js` continuam verdes. Commit.

## Task 3 — Form: perfis multi + seletor de professor
**Files:** Modify `index.html` (markup do form ~2982-2992; `showEditUser` ~3890; CSS).

- [ ] Trocar `<select id="newUserRole">` por um bloco de **checkboxes** `name="userProfile"` (6 perfis) `id="newUserProfiles"`.
- [ ] Adicionar grupo `#professorLinkGroup` (escondido) com `<select id="newUserProfessorId">` populado de `db.collection('teachers')` (id → name). Mostra quando algum perfil professor/estagiário está marcado (onchange nos checkboxes).
- [ ] `showEditUser` (popular edição): marcar checkboxes a partir de `d.profiles || [d.role]`; setar `#newUserProfessorId` = `d.professorId`; popular teachers; aplicar visibilidade do grupo.
- [ ] CSS dos checkboxes de perfil (reusar `.checkbox-label`/estilo de units). Commit (sem deploy ainda).

## Task 4 — Save (create + edit) grava o modelo novo
**Files:** Modify `index.html` (`createUser` ~3946; `editExistingUser` ~3926).

- [ ] Ler `profiles` dos checkboxes marcados; validar ≥1 perfil. Ler `professorId` (null se grupo escondido/sem perfil professor).
- [ ] `const { moduleAccess, role } = UserModel.deriveUserModel(profiles);`
- [ ] `createUser`: no `secondaryDb...set({...})` incluir `role, profiles, moduleAccess, professorId, ...` (mantém name/email/cpf/pix/allowedUnits/unitId/status/createdAt).
- [ ] `editExistingUser`: no `update({...})` incluir `role, profiles, moduleAccess, professorId`.
- [ ] Validação: se `moduleAccess.comissoes` for false E não houver unidade, não exigir unidade (units só fazem sentido pro Comissões). Manter exigência de unidade só quando `moduleAccess.comissoes`.
- [ ] Commit.

## Task 5 — Exibição: badges de perfil na lista
**Files:** Modify `index.html` (`loadUsers` render da linha — ler função antes de editar).

- [ ] Trocar o badge único de `role` por badges de `profiles` (usar `UserModel.PROFILE_LABELS`). Fallback p/ `[role]` se `profiles` ausente.
- [ ] Commit.

## Task 6 — Segregação: bloquear sem moduleAccess.comissoes
**Files:** Modify `index.html` (`onAuthStateChanged` ~3283, ramo `doc.exists`).

- [ ] Após carregar `userProfile`, derivar `moduleAccess` (de `profiles` ou via `migrateUserProfile`-equivalente) e, se `comissoes !== true`, **não** entrar: mostrar mensagem "Sem acesso ao módulo Comissões" com link pra `professores.html`, e `auth.signOut()` ou tela dedicada. (Espelha o bloqueio que o `professores.js` já faz pra `moduleAccess.professores`.)
- [ ] ⚠️ Mudança de comportamento do login do Comissões — destacar na validação.
- [ ] Commit.

## Task 7 — Deploy staging + validação
- [ ] `firebase deploy --only hosting --project staging`.
- [ ] Criar usuário professor (perfil "Professor" + vincular a um teacher) → confere `users/{uid}` no Firestore: `profiles:['professor']`, `moduleAccess:{comissoes:false,professores:true}`, `professorId` setado, `role:'professor'`.
- [ ] Logar como esse usuário no `professores.html` → entra no módulo, sidebar de professor, "Minha Agenda" vinculada. No `index.html` → **bloqueado** (sem Comissões).
- [ ] Admin existente: editar → checkboxes refletem perfis; salvar mantém acesso aos dois módulos. Vendedora existente segue só Comissões.
- [ ] Migração inline: usuário legado (só `role`) ao logar no Professores ganha `profiles`/`moduleAccess` coerentes.

## Fora de escopo
- Migração em massa de usuários legados (a inline já cobre на demanda).
- UI de edição de `moduleAccess` manual (é derivado).

## Critérios de aceite
1. Form cria/edita usuário com `profiles[]` (multi), `moduleAccess` derivado, `professorId` vinculado quando professor.
2. `role` continua coerente (Comissões não quebra).
3. Professor-only é bloqueado no Comissões e entra no Professores.
4. Derivação compartilhada (`user-model.js`) usada por form e migração — sem DRY-drift.
5. Validado em staging; nada em produção.
