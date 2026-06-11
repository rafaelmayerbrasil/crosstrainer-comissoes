# Hub Pessoas — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hub único "Pessoas" no app Professores (lista união `teachers`⊕`users` + wizard "Nova pessoa" + ficha 4 abas gated), substituindo "Gestão de Usuários" do Comissões e a tela "Professores".

**Architecture:** Modelo puro de junção (`pessoas-model.js`, UMD igual ao `user-model.js`) + página `professores-pessoas.js` que reusa os modais existentes (`teacherModal`/`salaryModal` via hooks `onSaved`/`onClosed`) e os services (`TeacherService`/`SalaryService`/`UnitService`/`ModalityService`). Escritas progressivas (D13). Segurança real nas Security Rules, validada via REST API auth.

**Tech Stack:** HTML/CSS/JS vanilla + Firebase compat SDK (Auth/Firestore) + Node para smokes/fixtures (Admin SDK staging).

**Spec:** `docs/superpowers/specs/2026-06-11-hub-pessoas-design.md` (D1–D14)
**Branch:** `feature/shell-integrado` · **Staging only** — produção apenas via homologação (regra inviolável #7)

**Regras do projeto que este plano respeita:**
- `index.html` recebe **uma única troca de link de menu** (regra inviolável #1, D10).
- Deploy de rules **separado e explícito** (`firebase deploy --only firestore:rules`) + validação REST (Admin SDK bypassa rules).
- Nome da marca: `CrossTainer` em todo texto visível.
- Legado tolerado (NÃO mexer): referências a `admin_gestao` em `functions/index.js`, `storage.rules`, `professores-shared.js` (queries `array-contains-any ['admin','admin_gestao']`) e `professores-fechamento.js` (comentários) — são ramos mortos inofensivos sem usuários com esse perfil; remoção exigiria redeploy de CFs, fora de escopo.

---

## Mapa de arquivos

| Ação | Arquivo | Responsabilidade |
|------|---------|------------------|
| Modify | `user-model.js` | dropar `admin_gestao` (D2) |
| Modify | `scripts/smoke-user-model.js` | refletir 5 perfis |
| Modify | `professores-nav.js` | página `pessoas` em Cadastros (D14), dropar `admin_gestao`, SYSTEM_SECTION sem "Usuários" |
| Modify | `scripts/smoke-sidebar.js` | paridade supervisão + pessoas |
| Create | `pessoas-model.js` | junção pura users⊕teachers (D12) |
| Create | `scripts/smoke-pessoas-model.js` | smoke da junção (3 estados) |
| Modify | `professores-cadastro.js` | hooks `onSaved`/`onClosed` nos modais + gate de edição p/ supervisão |
| Create | `professores-pessoas.js` | página: lista + ficha 4 abas + wizard + modal Acesso |
| Modify | `professores.html` | div `page-pessoas`, 2 modais novos, 2 script tags |
| Modify | `professores.js` | dispatch `pessoas`, deep-link `?page=`, helpers sem `admin_gestao` |
| Modify | `index.html` | **só** a troca do item de menu "Usuários" → link pro hub (D10) |
| Modify | `firestore.rules` | `isAdmin()` sem `admin_gestao`; `teachers` update p/ supervisão |
| Create | `scripts/audit-admin-gestao.js` | checar dados antes do deploy de rules |
| Create | `scripts/fixture-pessoas.js` | fixture staging (3 estados + supervisão) |
| Create | `scripts/validate-pessoas-rules.js` | validação REST das rules |

---

### Task 1: Limpar `admin_gestao` do modelo de usuário

**Files:**
- Modify: `user-model.js`
- Test: `scripts/smoke-user-model.js`

- [ ] **Step 1: Atualizar o smoke pra esperar 5 perfis (test-first)**

Substituir o conteúdo de `scripts/smoke-user-model.js` por:

```js
'use strict';
// Smoke do user-model (derivação pura). Roda: node scripts/smoke-user-model.js
const assert = require('assert');
const UM = require('../user-model.js');

function check(profiles, expModule, expRole) {
  const { moduleAccess, role } = UM.deriveUserModel(profiles);
  assert.deepStrictEqual(moduleAccess, expModule, 'moduleAccess errado p/ ' + JSON.stringify(profiles));
  assert.strictEqual(role, expRole, 'role errado p/ ' + JSON.stringify(profiles));
}

check(['admin'],                 { comissoes: true,  professores: true  }, 'admin');
check(['vendedor'],              { comissoes: true,  professores: false }, 'vendedor');
check(['supervisao'],            { comissoes: false, professores: true  }, 'supervisao');
check(['professor'],             { comissoes: false, professores: true  }, 'professor');
check(['professor_estagiario'],  { comissoes: false, professores: true  }, 'professor_estagiario');
check(['admin', 'professor'],    { comissoes: true,  professores: true  }, 'admin');     // admin domina o role
check(['vendedor', 'supervisao'],{ comissoes: true,  professores: true  }, 'vendedor');  // vendedor domina sobre o primeiro

// admin_gestao foi DROPADO (D2 do hub Pessoas) — não pode existir no modelo
assert.ok(!UM.PROFILE_LABELS.admin_gestao, 'admin_gestao não pode ter label');
assert.ok(!UM.PROFILE_ORDER.includes('admin_gestao'), 'admin_gestao não pode estar em PROFILE_ORDER');

// Rótulos existem pros 5 perfis
['admin', 'supervisao', 'professor', 'professor_estagiario', 'vendedor']
  .forEach(p => assert.ok(UM.PROFILE_LABELS[p], 'falta label p/ ' + p));

console.log('✓ smoke-user-model: todos os casos passaram');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-user-model.js`
Expected: FAIL com `admin_gestao não pode ter label`

- [ ] **Step 3: Editar `user-model.js`**

Em `user-model.js`, aplicar 3 remoções:

1. Em `PROFILE_LABELS`, remover a linha `admin_gestao: 'Admin/Gestão',`
2. `PROFILE_ORDER` vira: `const PROFILE_ORDER = ['admin', 'supervisao', 'professor', 'professor_estagiario', 'vendedor'];`
3. `PROFESSORES_PROFILES` vira: `const PROFESSORES_PROFILES = ['admin', 'supervisao', 'professor', 'professor_estagiario'];`

- [ ] **Step 4: Rodar e ver passar**

Run: `node scripts/smoke-user-model.js`
Expected: `✓ smoke-user-model: todos os casos passaram`

- [ ] **Step 5: Commit**

```bash
git add user-model.js scripts/smoke-user-model.js
git commit -m "refactor(user-model): dropa admin_gestao (D2 hub Pessoas)"
```

---

### Task 2: Navegação — página `pessoas` em Cadastros + limpeza

**Files:**
- Modify: `professores-nav.js`
- Test: `scripts/smoke-sidebar.js`

- [ ] **Step 1: Atualizar o smoke (test-first)**

Substituir o conteúdo de `scripts/smoke-sidebar.js` por:

```js
'use strict';
// Smoke do modelo de sidebar (lógica pura, sem DOM). Roda: node scripts/smoke-sidebar.js
const assert = require('assert');
const Nav = require('../professores-nav.js');

function sections(model) { return model.groups.map(g => g.section); }
function ids(model) { return model.groups.flatMap(g => g.items.map(i => i.id)); }

// 1) Admin SEM vínculo de professor: nenhuma seção repetida + ordem por domínio + sem "Minha Agenda"
let m = Nav.buildSidebarModel(['admin'], { hasProfessorLink: false, moduleAccess: { professores: true } });
const secs = sections(m);
assert.deepStrictEqual(secs, [...new Set(secs)], 'Admin: seção repetida na sidebar');
assert.deepStrictEqual(secs, ['Agenda', 'Cadastros', 'Férias', 'Financeiro'], 'Admin: ordem/grupos errados');
assert.ok(!ids(m).includes('minha-agenda'), 'Admin sem vínculo não deve ver Minha Agenda');
assert.ok(!ids(m).includes('home'), 'Início não entra em grupo (é item solto)');

// 1b) Hub Pessoas (D11/D14): 'pessoas' em Cadastros, 'professores' NÃO existe mais
assert.ok(ids(m).includes('pessoas'), 'Admin deve ver Pessoas');
assert.ok(!ids(m).includes('professores'), 'Entrada Professores foi absorvida pelo hub (D11)');
const cadastros = m.groups.find(g => g.section === 'Cadastros');
assert.ok(cadastros.items.some(i => i.id === 'pessoas'), 'Pessoas fica na seção Cadastros (D14)');

// 2) Admin COM vínculo: ganha grupo "Minhas aulas" com minha-agenda
m = Nav.buildSidebarModel(['admin'], { hasProfessorLink: true, moduleAccess: { professores: true } });
assert.ok(sections(m).includes('Minhas aulas'), 'Admin com vínculo deve ver Minhas aulas');
assert.ok(ids(m).includes('minha-agenda'), 'Admin com vínculo deve ver Minha Agenda');

// 2b) admin_gestao DROPADO (D2): não existe em PROF_PAGES
assert.ok(!Nav.PROF_PAGES.admin_gestao, 'admin_gestao não pode existir em PROF_PAGES');

// 2c) Supervisão: vê Pessoas, mas NÃO vê fechamento/pagamentos/relatórios/modalidades
const sup = Nav.buildSidebarModel(['supervisao'], { hasProfessorLink: false, moduleAccess: { professores: true } });
const supIds = ids(sup);
assert.ok(supIds.includes('pessoas'), 'Supervisão deve ver Pessoas (D5)');
['fechamento', 'pagamentos', 'relatorios', 'modalidades'].forEach(id =>
  assert.ok(!supIds.includes(id), `Supervisão não pode ver ${id}`));
assert.strictEqual(sup.systemSection, null, 'Supervisão NÃO tem seção de sistema');

// 3) Seção de sistema só pra admin — e SEM o link de Usuários (virou o hub — D14)
assert.ok(m.systemSection && m.systemSection.items.map(i => i.id).join(',') === 'units,audit',
  'Admin deve ter Administração apenas com units,audit');
const prof = Nav.buildSidebarModel(['professor'], { hasProfessorLink: true, moduleAccess: { professores: true } });
assert.strictEqual(prof.systemSection, null, 'Professor NÃO pode ter seção de sistema');

// 4) Professor: itens corretos, sem cadastros/fechamento/pessoas
const pIds = ids(prof);
assert.ok(pIds.includes('agenda-geral') && pIds.includes('minha-agenda') && pIds.includes('meus-pagamentos')
  && pIds.includes('ferias') && pIds.includes('meu-saldo'), 'Professor: itens faltando');
assert.ok(!pIds.includes('fechamento') && !pIds.includes('pessoas') && !pIds.includes('modalidades'),
  'Professor não pode ver itens de gestão');

// 5) Seletor de módulo: aparece só com 2+ módulos
const one = Nav.buildModuleSwitcher({ professores: true }, 'professores');
assert.strictEqual(one.show, false, '1 módulo → sem seletor');
const two = Nav.buildModuleSwitcher({ professores: true, comissoes: true }, 'professores');
assert.strictEqual(two.show, true, '2 módulos → com seletor');
assert.ok(two.modules.find(x => x.id === 'comissoes').href === 'index.html', 'Comissões aponta pro index.html');

console.log('✓ smoke-sidebar: todos os casos passaram');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-sidebar.js`
Expected: FAIL com `Admin deve ver Pessoas`

- [ ] **Step 3: Editar `professores-nav.js`**

1. `PROF_PAGES` vira (chave `admin_gestao` removida; `professores`→`pessoas` em admin e supervisao):

```js
  const PROF_PAGES = {
    admin:                ['home', 'modalidades', 'pessoas', 'agenda', 'agenda-geral', 'minha-agenda', 'fechamento', 'pagamentos', 'escalas', 'ferias', 'saldos-gestao', 'relatorios'],
    supervisao:           ['home', 'pessoas', 'agenda', 'agenda-geral', 'minha-agenda', 'escalas', 'ferias', 'saldos-gestao'],
    professor:            ['home', 'agenda-geral', 'minha-agenda', 'meus-pagamentos', 'ferias', 'meu-saldo'],
    professor_estagiario: ['home', 'agenda-geral', 'minha-agenda', 'meus-pagamentos', 'ferias', 'meu-saldo'],
  };
```

2. Em `PAGE_DEFINITIONS`, substituir a linha do `professores` por:

```js
    { id: 'pessoas',        label: 'Pessoas',           icon: '👥', section: 'Cadastros' },
```

3. `SYSTEM_SECTION.items` perde o item `users` (D14):

```js
    items: [
      { id: 'units', label: 'Unidades',  icon: '🏢', href: 'index.html?page=units' },
      { id: 'audit', label: 'Auditoria', icon: '📜', href: 'index.html?page=audit' },
    ],
```

4. Helpers sem `admin_gestao`:

```js
  function isManagement(profiles) {
    return (profiles || []).some(p => ['admin', 'supervisao'].includes(p));
  }
  function isAdmin(profiles) {
    return (profiles || []).some(p => p === 'admin');
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node scripts/smoke-sidebar.js`
Expected: `✓ smoke-sidebar: todos os casos passaram`

- [ ] **Step 5: Commit**

```bash
git add professores-nav.js scripts/smoke-sidebar.js
git commit -m "feat(nav): pagina pessoas em Cadastros substitui Professores + dropa admin_gestao (D11/D14)"
```

---

### Task 3: Modelo puro da junção — `pessoas-model.js`

**Files:**
- Create: `pessoas-model.js`
- Test: `scripts/smoke-pessoas-model.js`

- [ ] **Step 1: Escrever o smoke (test-first)**

Criar `scripts/smoke-pessoas-model.js`:

```js
'use strict';
// Smoke do pessoas-model (junção pura users⊕teachers — D12). Roda: node scripts/smoke-pessoas-model.js
const assert = require('assert');
const PM = require('../pessoas-model.js');

const teachers = [
  { id: 't1', name: 'Bruno Sem Acesso', email: 'bruno@ct.com', type: 'efetivo' },
  { id: 't2', name: 'Ana Vinculada',    email: 'ana@ct.com',   type: 'estagiario' },
];
const users = [
  { id: 'u1', name: 'Carla Vendedora', email: 'carla@ct.com', profiles: ['vendedor'] },
  { id: 'u2', name: 'Ana Vinculada',   email: 'ana@ct.com',   profiles: ['professor_estagiario'], professorId: 't2' },
  { id: 'u3', name: 'Dono Admin',      email: 'dono@ct.com',  role: 'admin' }, // legado: sem profiles[]
];

const people = PM.buildPeople(users, teachers);

// 1) 4 pessoas: t1 (só teacher), t2+u2 (vinculados = 1), u1, u3
assert.strictEqual(people.length, 4, 'junção deve dar 4 pessoas');

// 2) Professor sem acesso: perfil implícito do type + hasAccess false
const bruno = people.find(p => p.key === 'T:t1');
assert.ok(bruno && !bruno.hasAccess && !bruno.uid, 'Bruno = teacher sem users doc');
assert.deepStrictEqual(bruno.profiles, ['professor'], 'perfil implícito pelo type efetivo');

// 3) Vinculada: merge — identidade do teacher (fonte da verdade, §3) + uid do user
const ana = people.find(p => p.key === 'T:t2');
assert.ok(ana && ana.hasAccess && ana.uid === 'u2' && ana.teacherId === 't2', 'Ana = vinculada');
assert.deepStrictEqual(ana.profiles, ['professor_estagiario']);
assert.ok(!people.find(p => p.key === 'U:u2'), 'user vinculado não duplica na lista');

// 4) Só de login: legado role → profiles
const dono = people.find(p => p.key === 'U:u3');
assert.deepStrictEqual(dono.profiles, ['admin'], 'role legado vira profiles');
assert.ok(dono.hasAccess && !dono.teacher, 'user-only não tem entidade teacher');

// 5) Ordenação por nome
assert.deepStrictEqual(people.map(p => p.name),
  ['Ana Vinculada', 'Bruno Sem Acesso', 'Carla Vendedora', 'Dono Admin'], 'ordenado por nome');

// 6) Filtros
assert.strictEqual(PM.filterPeople(people, { search: 'ana' }).length, 1, 'busca por nome');
assert.strictEqual(PM.filterPeople(people, { search: 'carla@ct.com' }).length, 1, 'busca por email');
assert.strictEqual(PM.filterPeople(people, { profile: 'professor' }).length, 1, 'filtro perfil implícito');
assert.strictEqual(PM.filterPeople(people, { profile: 'sem-acesso' }).length, 1, 'filtro sem-acesso');
assert.strictEqual(PM.filterPeople(people, {}).length, 4, 'sem filtro = todos');

// 7) professorId apontando pra teacher inexistente → pessoa user-only (vínculo quebrado não some)
const broken = PM.buildPeople([{ id: 'u9', name: 'Zé Quebrado', profiles: ['professor'], professorId: 'tX' }], teachers);
assert.ok(broken.find(p => p.key === 'U:u9'), 'vínculo quebrado vira user-only, não desaparece');

console.log('✓ smoke-pessoas-model: todos os casos passaram');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-pessoas-model.js`
Expected: FAIL com `Cannot find module '../pessoas-model.js'`

- [ ] **Step 3: Criar `pessoas-model.js`**

```js
// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Hub Pessoas · Modelo puro da junção (D12)
// Pessoa = teachers ⊕ users via users.professorId. Três estados válidos:
//   só teacher (professor sem acesso) · só user (login) · vinculados.
// Identidade da pessoa vinculada vem do teacher doc (fonte da verdade, §3).
// Browser: window.PessoasModel · Node: require('./pessoas-model.js')
// ═══════════════════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PessoasModel = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function profilesOf(user) {
    if (!user) return [];
    if (Array.isArray(user.profiles) && user.profiles.length) return user.profiles;
    return user.role ? [user.role] : [];
  }

  // Perfil implícito de um teacher sem login (type → perfil)
  function implicitProfiles(teacher) {
    return [teacher.type === 'estagiario' ? 'professor_estagiario' : 'professor'];
  }

  function buildPeople(users, teachers) {
    users = users || []; teachers = teachers || [];
    const teacherIds = new Set(teachers.map(t => t.id));
    const userByTeacher = new Map();
    users.forEach(u => {
      if (u.professorId && teacherIds.has(u.professorId) && !userByTeacher.has(u.professorId)) {
        userByTeacher.set(u.professorId, u);
      }
    });
    const mergedUids = new Set(Array.from(userByTeacher.values()).map(u => u.id));

    const people = teachers.map(t => {
      const u = userByTeacher.get(t.id) || null;
      return {
        key: 'T:' + t.id,
        teacherId: t.id,
        uid: u ? u.id : null,
        name: t.name || (u && u.name) || '',
        email: t.email || (u && u.email) || '',
        profiles: u ? profilesOf(u) : implicitProfiles(t),
        hasAccess: !!u,
        teacher: t,
        user: u,
      };
    });

    users.filter(u => !mergedUids.has(u.id)).forEach(u => {
      people.push({
        key: 'U:' + u.id,
        teacherId: null,
        uid: u.id,
        name: u.name || '',
        email: u.email || '',
        profiles: profilesOf(u),
        hasAccess: true,
        teacher: null,
        user: u,
      });
    });

    people.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
    return people;
  }

  function filterPeople(people, filters) {
    const q = ((filters && filters.search) || '').trim().toLowerCase();
    const prof = (filters && filters.profile) || 'all';
    return (people || []).filter(p => {
      if (q) {
        const inName = (p.name || '').toLowerCase().includes(q);
        const inEmail = (p.email || '').toLowerCase().includes(q);
        if (!inName && !inEmail) return false;
      }
      if (prof !== 'all') {
        if (prof === 'sem-acesso') return !p.hasAccess;
        if (!p.profiles.includes(prof)) return false;
      }
      return true;
    });
  }

  return { buildPeople, filterPeople, profilesOf, implicitProfiles };
});
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node scripts/smoke-pessoas-model.js`
Expected: `✓ smoke-pessoas-model: todos os casos passaram`

Run também (regressão): `node scripts/smoke-user-model.js && node scripts/smoke-sidebar.js`
Expected: ambos `✓`

- [ ] **Step 5: Commit**

```bash
git add pessoas-model.js scripts/smoke-pessoas-model.js
git commit -m "feat(pessoas): modelo puro da juncao users+teachers com smoke (D12)"
```

---

### Task 4: Hooks de reuso nos modais (`professores-cadastro.js`)

Permite ao wizard encadear os modais existentes (D13) sem duplicar forms.

**Files:**
- Modify: `professores-cadastro.js` (3 pontos: `TeacherFormState`/`saveTeacher`, `SalaryFormState`/`closeSalaryModal`, gate do `openTeacherModal`)

- [ ] **Step 1: Hook `onSaved` no fluxo do professor**

Em `professores-cadastro.js`, no objeto `TeacherFormState` (≈linha 919), adicionar o campo:

```js
  onSaved: null,   // hook do wizard Pessoas (D13): cb(teacherData) no lugar do refresh padrão
```

No fim de `saveTeacher()` (≈linha 1220), substituir o bloco:

```js
  closeTeacherModal();
  await renderProfessoresPage();
```

por:

```js
  const onSaved = TeacherFormState.onSaved;
  TeacherFormState.onSaved = null;
  closeTeacherModal();
  if (onSaved) await onSaved(result.data);   // wizard Pessoas segue o fluxo (D13)
  else await renderProfessoresPage();
```

E em `closeTeacherModal()` (≈linha 1009), adicionar a limpeza (cancelar = abortar wizard sem criar nada):

```js
function closeTeacherModal() {
  $f('teacherModal').classList.remove('open');
  TeacherFormState.editingId = null;
  TeacherFormState.onSaved = null;
}
```

⚠️ Ordem importa: `saveTeacher` lê o hook ANTES de chamar `closeTeacherModal()` (que o zera).

- [ ] **Step 2: Hook `onClosed` no fluxo salarial**

No objeto `SalaryFormState` (procurar `const SalaryFormState`), adicionar o campo:

```js
  onClosed: null,  // hook do wizard Pessoas: dispara ao fechar (salvo OU pulado), 1x
```

Substituir `closeSalaryModal()` (≈linha 1600) por:

```js
function closeSalaryModal() {
  const modal = document.getElementById('salaryModal');
  if (modal) modal.classList.remove('open');
  SalaryFormState.teacherId = null;
  const onClosed = SalaryFormState.onClosed;
  SalaryFormState.onClosed = null;
  if (onClosed) onClosed();   // wizard Pessoas: salvar OU fechar sem salvar = avança pro Acesso (D8/D13)
}
```

(`saveSalary()` já chama `closeSalaryModal()` no sucesso — o hook cobre os dois caminhos.)

- [ ] **Step 3: Gate de edição pra supervisão (D5/D9)**

Em `openTeacherModal(id = null)` (≈linha 928), substituir:

```js
  if (!isAdminGestao()) {
    toast('Você não tem permissão para gerenciar professores.', 'error');
    return;
  }
```

por:

```js
  // D5/D9 (hub Pessoas): admin cria e edita; supervisão SÓ edita existente
  const canManage = isAdminGestao() || (id && isSupervisao());
  if (!canManage) {
    toast('Você não tem permissão para gerenciar professores.', 'error');
    return;
  }
```

- [ ] **Step 4: Verificação estática + regressão dos smokes**

Run: `node -e "new Function(require('fs').readFileSync('professores-cadastro.js','utf8')); console.log('sintaxe ok')"`
Expected: `sintaxe ok`

Run: `node scripts/smoke-user-model.js && node scripts/smoke-sidebar.js && node scripts/smoke-pessoas-model.js`
Expected: 3× `✓`

- [ ] **Step 5: Commit**

```bash
git add professores-cadastro.js
git commit -m "feat(cadastro): hooks onSaved/onClosed nos modais + supervisao edita professor (D5/D13)"
```

---

### Task 5: Esqueleto da página Pessoas + roteamento + deep-link

**Files:**
- Create: `professores-pessoas.js` (parte 1: estado, load, lista)
- Modify: `professores.html` (div da página + script tags)
- Modify: `professores.js` (dispatch + deep-link + helpers sem `admin_gestao`)

- [ ] **Step 1: Criar `professores-pessoas.js` com estado + load + lista**

```js
// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Hub Pessoas (lista + wizard "Nova pessoa" + ficha 4 abas)
// Spec: docs/superpowers/specs/2026-06-11-hub-pessoas-design.md (D1–D14)
// Reusa: TeacherService/SalaryService/UnitService/ModalityService,
//        teacherModal + salaryModal (hooks da Task 4), PessoasModel, UserModel.
// Carrega teachers/modalidades/units nos containers do ProfessoresState
// de propósito: é o que os modais reusados leem.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

// Dono do sistema (D3) — perfil travado na UI; espelha OWNER_EMAIL do index.html
const PESSOAS_OWNER_EMAIL = 'abluir@gmail.com';

const PessoasState = {
  users: [],
  people: [],
  filters: { search: '', profile: 'all' },
  selectedKey: null,
  activeTab: 'identidade',
};

let PessoasAccessCtx = null; // { profiles: [], teacherId: string|null } durante o modal de Acesso

// ── Entry point — professores.js → navigateTo('pessoas') ────────────────
async function renderPessoasPage() {
  const page = document.getElementById('page-pessoas');
  if (!page) return;
  page.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando pessoas…</div>';

  const [tRes, mRes, uRes] = await Promise.all([
    TeacherService.list(),
    ModalityService.list(),
    UnitService.list(),
  ]);
  if (!tRes.success) {
    page.innerHTML = `
      <div class="page-toolbar"><div class="lhs"><h2>PESSOAS</h2></div></div>
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <h3>Erro ao carregar</h3>
        <p>${escapeHtml(tRes.error || 'Erro desconhecido')}</p>
        <button class="btn btn-outline" onclick="renderPessoasPage()">Tentar novamente</button>
      </div>`;
    return;
  }
  ProfessoresState.list = tRes.data;
  ProfessoresState.modalitiesMap = mRes.success ? new Map(mRes.data.map(m => [m.id, m])) : new Map();
  ProfessoresState.unitsMap = uRes.success ? new Map(uRes.data.map(u => [u.id, u])) : new Map();

  // users SÓ pra admin — supervisão não lê a coleção (D5, §7 do spec)
  PessoasState.users = [];
  if (isStrictAdmin()) {
    try {
      const snap = await db.collection('users').get();
      PessoasState.users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.warn('[pessoas] coleção users indisponível:', err);
    }
  }

  PessoasState.people = PessoasModel.buildPeople(PessoasState.users, tRes.data);
  if (PessoasState.selectedKey && !PessoasState.people.find(p => p.key === PessoasState.selectedKey)) {
    PessoasState.selectedKey = null;
  }
  renderPessoasContent();
}

// ── Render da lista (reusa o CSS do grid de professores) ────────────────
function renderPessoasContent() {
  const page = document.getElementById('page-pessoas');
  if (!page) return;
  const isAdm = isStrictAdmin();
  const filtered = PessoasModel.filterPeople(PessoasState.people, PessoasState.filters);
  const selected = PessoasState.people.find(p => p.key === PessoasState.selectedKey) || null;

  const total = PessoasState.people.length;
  const semAcesso = isAdm ? PessoasState.people.filter(p => !p.hasAccess).length : 0;

  const profileOptions = [
    { v: 'all', label: 'Todos os perfis' },
    ...UserModel.PROFILE_ORDER.map(pr => ({ v: pr, label: UserModel.PROFILE_LABELS[pr] })),
    ...(isAdm ? [{ v: 'sem-acesso', label: '— Sem acesso' }] : []),
  ];

  page.innerHTML = `
    <div class="page-toolbar">
      <div class="lhs">
        <h2>PESSOAS</h2>
        <div class="count">${total} pessoa${total !== 1 ? 's' : ''}${semAcesso ? ` · ${semAcesso} sem acesso` : ''}</div>
      </div>
      <div class="rhs">
        <input type="search" class="search-input" placeholder="🔍 Buscar por nome ou email…"
               value="${escapeHtml(PessoasState.filters.search)}"
               oninput="setPessoasSearch(this.value)">
        <select class="search-input" style="max-width:180px;" onchange="setPessoasProfileFilter(this.value)">
          ${profileOptions.map(o => `<option value="${o.v}" ${PessoasState.filters.profile === o.v ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
        ${isAdm ? '<button class="btn" onclick="openPessoaWizard()">+ Nova pessoa</button>' : ''}
      </div>
    </div>
    <div class="teachers-grid">
      <div class="teachers-list-container">
        <div class="teachers-list" id="pessoasList">
          ${filtered.length === 0
            ? '<div class="empty-state-small">Nenhuma pessoa encontrada com esses filtros.</div>'
            : filtered.map(p => renderPessoaListItem(p)).join('')}
        </div>
      </div>
      <div class="teachers-ficha" id="pessoaFicha">
        ${selected ? renderPessoaFicha(selected) : `
          <div class="empty-state">
            <div class="icon">👥</div>
            <h3>Selecione uma pessoa</h3>
            <p>Clique em alguém na lista pra ver a ficha completa.</p>
          </div>`}
      </div>
    </div>`;

  if (selected) afterPessoaFichaRender(selected);
}

function pessoaBadgesHtml(profiles) {
  return (profiles || []).map(pr =>
    `<span class="pill" style="font-size:9px;padding:2px 6px;margin-right:4px;">${UserModel.PROFILE_LABELS[pr] || pr}</span>`
  ).join('');
}

function renderPessoaListItem(p) {
  const isSelected = PessoasState.selectedKey === p.key;
  const avatarType = p.teacher ? p.teacher.type : 'efetivo';
  const accessBadge = isStrictAdmin()
    ? (p.hasAccess
        ? ''
        : '<span class="pill pill-inactive" style="font-size:9px;padding:2px 6px;">SEM ACESSO</span>')
    : '';
  return `
    <div class="teacher-list-item ${isSelected ? 'selected' : ''}" onclick="selectPessoa('${p.key}')">
      ${avatarHtml(p.name, avatarType, 36)}
      <div class="teacher-info">
        <div class="teacher-name">${escapeHtml(p.name)}</div>
        <div class="teacher-meta">${escapeHtml(p.email || '—')}</div>
        <div class="teacher-badges">${pessoaBadgesHtml(p.profiles)}${accessBadge}</div>
      </div>
    </div>`;
}

function selectPessoa(key) {
  if (PessoasState.selectedKey !== key) PessoasState.activeTab = 'identidade';
  PessoasState.selectedKey = key;
  renderPessoasContent();
}

let _pessoasSearchTimer = null;
function setPessoasSearch(value) {
  clearTimeout(_pessoasSearchTimer);
  _pessoasSearchTimer = setTimeout(() => {
    PessoasState.filters.search = value;
    renderPessoasContent();
    const inp = document.querySelector('#page-pessoas .search-input');
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }, 200);
}

function setPessoasProfileFilter(value) {
  PessoasState.filters.profile = value;
  renderPessoasContent();
}
```

(As funções `renderPessoaFicha`/`afterPessoaFichaRender`/`openPessoaWizard` vêm nas Tasks 6 e 7 — neste step, adicionar stubs temporários no fim do arquivo pra página não quebrar:)

```js
// stubs — substituídos nas Tasks 6 e 7
function renderPessoaFicha() { return ''; }
function afterPessoaFichaRender() {}
function openPessoaWizard() { toast('Wizard em construção.', 'info'); }
```

- [ ] **Step 2: Adicionar div da página + scripts em `professores.html`**

Depois da linha `<div class="page" id="page-professores"></div>` (linha ≈1946), adicionar:

```html
      <div class="page" id="page-pessoas"></div>
```

Na seção de scripts (≈linha 2405), depois de `<script src="user-model.js"></script>`, adicionar:

```html
  <script src="pessoas-model.js"></script>
```

E depois de `<script src="professores-home.js"></script>`, adicionar:

```html
  <script src="professores-pessoas.js"></script>
```

- [ ] **Step 3: Dispatch + deep-link + helpers em `professores.js`**

1. Em `navigateTo()` (≈linha 459), **substituir** o branch de `professores`:

```js
  } else if (pageId === 'professores' && typeof renderProfessoresPage === 'function') {
    renderProfessoresPage();
```

por:

```js
  } else if (pageId === 'pessoas' && typeof renderPessoasPage === 'function') {
    renderPessoasPage();
```

2. Em `showApp()` (≈linha 231), substituir:

```js
  // Roteamento inicial — sempre 'home' por enquanto
  navigateTo('home');
```

por:

```js
  // Deep-link ?page=... (espelho do Plano B no Comissões) — ex.: vindo do menu do index.html
  const wanted = new URLSearchParams(location.search).get('page');
  navigateTo(wanted && getAllowedPages().includes(wanted) ? wanted : 'home');
```

3. Helpers sem `admin_gestao` (≈linhas 37–40):

```js
function isAdminGestao() { return hasProfile('admin'); }  // admin_gestao dropado (D2) — nome mantido p/ não tocar os call sites
function isSupervisao()  { return hasProfile('supervisao'); }
function isProfessor()   { return hasProfile('professor') || hasProfile('professor_estagiario'); }
function canSeeSalary()  { return hasProfile('admin'); }  // D2: salário é só admin
```

4. Em `formatRoleLabel()` (≈linha 366), remover a linha `'admin_gestao':         'Gestão',`.

- [ ] **Step 4: Verificação estática + smokes**

Run: `node -e "new Function(require('fs').readFileSync('professores-pessoas.js','utf8')); new Function(require('fs').readFileSync('professores.js','utf8')); console.log('sintaxe ok')"`
Expected: `sintaxe ok`

Run: `node scripts/smoke-sidebar.js`
Expected: `✓`

- [ ] **Step 5: Commit**

```bash
git add professores-pessoas.js professores.html professores.js
git commit -m "feat(pessoas): pagina lista uniao + dispatch + deep-link ?page= + helpers sem admin_gestao"
```

---

### Task 6: Ficha da pessoa — 4 abas gated

**Files:**
- Modify: `professores-pessoas.js` (substituir os stubs `renderPessoaFicha`/`afterPessoaFichaRender`)

- [ ] **Step 1: Substituir os stubs pela ficha completa**

Remover os stubs `renderPessoaFicha` e `afterPessoaFichaRender` do fim do arquivo (o stub de `openPessoaWizard` permanece até a Task 7) e adicionar:

```js
// ── Ficha — 4 abas gated (D4/D5): Identidade · Professor · 🔒 Salário · 🔑 Acesso
function pessoaTabsFor(p) {
  const tabs = [{ id: 'identidade', label: 'Identidade' }];
  if (p.teacher) tabs.push({ id: 'professor', label: 'Professor' });
  if (p.teacher && canSeeSalary()) tabs.push({ id: 'salarial', label: '🔒 Salário' });
  if (isStrictAdmin()) tabs.push({ id: 'acesso', label: '🔑 Acesso' });
  return tabs;
}

function renderPessoaFicha(p) {
  const tabs = pessoaTabsFor(p);
  if (!tabs.find(t => t.id === PessoasState.activeTab)) PessoasState.activeTab = 'identidade';
  const avatarType = p.teacher ? p.teacher.type : 'efetivo';

  const noAccessBanner = (isStrictAdmin() && !p.hasAccess) ? `
    <div style="border:1px solid var(--yellow);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:13px;">
      ⚠️ Esta pessoa não tem acesso ao sistema.
      <a href="#" onclick="pessoaCriarAcesso('${p.key}');return false;" style="color:var(--orange);font-weight:600;">Criar acesso</a>
    </div>` : '';

  return `
    <div class="ficha-header">
      ${avatarHtml(p.name, avatarType, 56)}
      <div class="ficha-header-info">
        <div class="ficha-header-title">${escapeHtml(p.name)}</div>
        <div class="ficha-header-sub">${pessoaBadgesHtml(p.profiles)}</div>
      </div>
      ${isStrictAdmin() ? `
        <span class="pill ${p.hasAccess ? 'pill-active' : 'pill-inactive'}">
          ${p.hasAccess ? '● Com acesso' : 'Sem acesso'}
        </span>` : ''}
    </div>
    ${noAccessBanner}
    <div class="ficha-tabs">
      ${tabs.map(tab => `
        <button class="ficha-tab ${PessoasState.activeTab === tab.id ? 'active' : ''}"
                onclick="switchPessoaTab('${tab.id}')">${tab.label}</button>`).join('')}
    </div>
    <div class="ficha-tab-content" id="pessoaTabContent">
      ${renderPessoaTabContent(p)}
    </div>`;
}

function switchPessoaTab(tabId) {
  PessoasState.activeTab = tabId;
  const p = PessoasState.people.find(x => x.key === PessoasState.selectedKey);
  if (!p) return;
  const fichaEl = document.getElementById('pessoaFicha');
  if (fichaEl) fichaEl.innerHTML = renderPessoaFicha(p);
  afterPessoaFichaRender(p);
}

function afterPessoaFichaRender(p) {
  if (PessoasState.activeTab === 'salarial' && p.teacher) loadPessoaSalary(p);
}

function renderPessoaTabContent(p) {
  switch (PessoasState.activeTab) {
    case 'professor':  return renderPessoaTabProfessor(p);
    case 'salarial':
      if (!canSeeSalary()) { PessoasState.activeTab = 'identidade'; return renderPessoaTabIdentidade(p); }
      return '<div class="loading"><div class="spinner"></div> Carregando dados salariais…</div>';
    case 'acesso':
      if (!isStrictAdmin()) { PessoasState.activeTab = 'identidade'; return renderPessoaTabIdentidade(p); }
      return renderPessoaTabAcesso(p);
    default: return renderPessoaTabIdentidade(p);
  }
}

// ── Aba Identidade ──────────────────────────────────────────────────────
// Pessoa com entidade: leitura do teacher doc (fonte da verdade, §3) + Editar via teacherModal.
// Pessoa só de login: form inline (admin) gravando no users doc.
function renderPessoaTabIdentidade(p) {
  if (p.teacher) {
    const t = p.teacher;
    const canEdit = isStrictAdmin() || isSupervisao();
    return `
      <div class="info-grid">
        <div><div class="info-field-label">Nome completo</div><div class="info-field-value">${escapeHtml(t.name)}</div></div>
        <div><div class="info-field-label">CPF</div><div class="info-field-value mono">${escapeHtml(t.cpf || '—')}</div></div>
        <div><div class="info-field-label">E-mail</div><div class="info-field-value">${escapeHtml(t.email || '—')}</div></div>
        <div><div class="info-field-label">Telefone</div><div class="info-field-value">${escapeHtml(t.phone || '—')}</div></div>
      </div>
      ${canEdit ? `<div style="margin-top:12px;"><button class="btn btn-ghost btn-sm" onclick="pessoasEditTeacher('${t.id}')">Editar dados</button></div>` : ''}`;
  }
  const u = p.user || {};
  if (!isStrictAdmin()) {
    return `<div class="info-grid">
      <div><div class="info-field-label">Nome</div><div class="info-field-value">${escapeHtml(u.name || '—')}</div></div>
      <div><div class="info-field-label">E-mail</div><div class="info-field-value">${escapeHtml(u.email || '—')}</div></div>
    </div>`;
  }
  return `
    <div class="form-group"><label>Nome completo</label>
      <input type="text" id="pessoaIdName" value="${escapeHtml(u.name || '')}"></div>
    <div class="form-group"><label>CPF</label>
      <input type="text" id="pessoaIdCpf" value="${escapeHtml(u.cpf || '')}"></div>
    <div class="form-group"><label>Chave PIX</label>
      <input type="text" id="pessoaIdPix" value="${escapeHtml(u.pix || '')}"></div>
    <div class="form-group"><label>E-mail (login — não editável aqui)</label>
      <input type="text" value="${escapeHtml(u.email || '')}" disabled></div>
    <button class="btn" onclick="savePessoaIdentity('${p.key}')">Salvar identidade</button>`;
}

async function savePessoaIdentity(key) {
  const p = PessoasState.people.find(x => x.key === key);
  if (!p || !p.uid) return;
  const name = document.getElementById('pessoaIdName').value.trim();
  const cpf = document.getElementById('pessoaIdCpf').value.trim();
  const pix = document.getElementById('pessoaIdPix').value.trim();
  if (!name) { toast('Nome é obrigatório.', 'error'); return; }
  try {
    await db.collection('users').doc(p.uid).update({
      name, cpf, pix,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast('Identidade atualizada.', 'success');
    await renderPessoasPage();
  } catch (e) { toast('Erro: ' + e.message, 'error'); }
}

// Abre o teacherModal a partir do hub, com refresh de volta pro hub (Task 4)
function pessoasEditTeacher(teacherId) {
  TeacherFormState.onSaved = async () => { await renderPessoasPage(); };
  openTeacherModal(teacherId);
}

// ── Aba Professor ───────────────────────────────────────────────────────
function renderPessoaTabProfessor(p) {
  const t = p.teacher;
  const modNames = (t.modalityIds || [])
    .map(id => ProfessoresState.modalitiesMap.get(id)).filter(Boolean).map(m => m.name);
  const unitNames = (t.unitIds || [])
    .map(id => ProfessoresState.unitsMap.get(id)).filter(Boolean).map(u => u.name || u.id);
  const canEdit = isStrictAdmin() || isSupervisao();
  return `
    <div class="info-grid">
      <div><div class="info-field-label">Tipo</div><div class="info-field-value">${escapeHtml(TYPE_LABEL[t.type] || t.type)}</div></div>
      <div><div class="info-field-label">Status</div><div class="info-field-value">${t.isActive ? '● Ativo' : 'Inativo'}</div></div>
      <div><div class="info-field-label">Modalidades</div><div class="info-field-value">${escapeHtml(modNames.join(', ') || '—')}</div></div>
      <div><div class="info-field-label">Unidades</div><div class="info-field-value">${escapeHtml(unitNames.join(', ') || '—')}</div></div>
    </div>
    ${canEdit ? `<div style="margin-top:12px;"><button class="btn btn-ghost btn-sm" onclick="pessoasEditTeacher('${t.id}')">Editar dados de professor</button></div>` : ''}`;
}

// ── Aba 🔒 Salário (render próprio — evita ficar stale após salvar) ──────
async function loadPessoaSalary(p) {
  const res = await SalaryService.get(p.teacherId);
  const el = document.getElementById('pessoaTabContent');
  if (!el || PessoasState.activeTab !== 'salarial') return;
  if (!res.success) {
    el.innerHTML = `<div class="empty-state-small">⚠️ Erro ao carregar salário: ${escapeHtml(res.error || '')}</div>`;
    return;
  }
  ProfessoresState.salaryCache.set(p.teacherId, { data: res.data });
  el.innerHTML = renderPessoaSalarialInfo(p, res.data);
}

function renderPessoaSalarialInfo(p, s) {
  const fmt = v => (v == null ? '—' : 'R$ ' + Number(v).toFixed(2));
  const editBtn = `<div style="margin-top:12px;"><button class="btn btn-ghost btn-sm" onclick="pessoasEditSalary('${p.teacherId}')">${s ? 'Editar remuneração' : 'Cadastrar remuneração'}</button></div>`;
  if (!s) return `<div class="empty-state-small">Sem cadastro salarial — relatórios mostram "Sem cadastro" até preencher.</div>${editBtn}`;
  const isIntern = p.teacher.type === 'estagiario';
  return `
    <div class="info-grid">
      ${isIntern ? `
        <div><div class="info-field-label">Bolsa mensal</div><div class="info-field-value">${fmt(s.internMonthlyStipend)}</div></div>
        <div><div class="info-field-label">Limite mensal</div><div class="info-field-value">${s.internMonthlyLimitHours != null ? s.internMonthlyLimitHours + 'h' : '—'}</div></div>
      ` : `
        <div><div class="info-field-label">R$/hora</div><div class="info-field-value">${fmt(s.hourlyRate)}</div></div>
      `}
      <div><div class="info-field-label">Vale Refeição</div><div class="info-field-value">${fmt(s.mealAllowance)}</div></div>
      <div><div class="info-field-label">Vale Transporte</div><div class="info-field-value">${fmt(s.transportAllowance)}</div></div>
      <div><div class="info-field-label">Outros benefícios</div><div class="info-field-value">${(s.otherBenefits || []).map(b => escapeHtml(b.nome) + ' ' + fmt(b.valor)).join(' · ') || '—'}</div></div>
    </div>${editBtn}`;
}

function pessoasEditSalary(teacherId) {
  SalaryFormState.onClosed = () => switchPessoaTab('salarial'); // re-render (cache invalidado pelo saveSalary)
  openSalaryModal(teacherId);
}

// ── Aba 🔑 Acesso ───────────────────────────────────────────────────────
function renderPessoaTabAcesso(p) {
  if (!p.hasAccess) {
    return `
      <div class="empty-state-small">
        Esta pessoa não tem login no sistema.
      </div>
      <div style="margin-top:12px;"><button class="btn" onclick="pessoaCriarAcesso('${p.key}')">Criar acesso</button></div>`;
  }
  const u = p.user;
  const isOwnerPerson = (u.email || '').toLowerCase() === PESSOAS_OWNER_EMAIL;
  const profiles = PessoasModel.profilesOf(u);
  const { moduleAccess } = UserModel.deriveUserModel(profiles);
  const ownerNote = isOwnerPerson
    ? '<div class="empty-state-small">🔒 Conta do desenvolvedor (D3) — perfis travados, não editáveis pela UI.</div>' : '';
  const dis = isOwnerPerson ? 'disabled' : '';
  return `
    <div class="info-grid">
      <div><div class="info-field-label">E-mail de login</div><div class="info-field-value">${escapeHtml(u.email || '—')}</div></div>
      <div><div class="info-field-label">Módulos</div><div class="info-field-value">${moduleAccess.comissoes ? 'Comissões ' : ''}${moduleAccess.professores ? 'Professores' : ''}</div></div>
    </div>
    ${ownerNote}
    <div class="form-group" style="margin-top:12px;"><label>Perfis</label>
      <div id="pessoaProfilesChecks">
        ${UserModel.PROFILE_ORDER.map(pr => `
          <label style="display:block;margin:4px 0;">
            <input type="checkbox" value="${pr}" ${profiles.includes(pr) ? 'checked' : ''} ${dis}
                   onchange="pessoaProfileToggle(this)"> ${UserModel.PROFILE_LABELS[pr]}
          </label>`).join('')}
      </div>
    </div>
    <div class="form-group" id="pessoaUnitsWrap" style="display:${moduleAccess.comissoes ? '' : 'none'};">
      <label>Unidades (Comissões)</label>
      <div id="pessoaUnitsChecks">
        ${Array.from(ProfessoresState.unitsMap.values()).map(un => `
          <label style="display:block;margin:4px 0;">
            <input type="checkbox" value="${un.id}" ${(u.allowedUnits || []).includes(un.id) ? 'checked' : ''} ${dis}> ${escapeHtml(un.name || un.id)}
          </label>`).join('')}
      </div>
    </div>
    <div id="pessoaAcessoError" style="color:var(--red);font-size:12px;min-height:16px;"></div>
    ${isOwnerPerson ? '' : `<button class="btn" onclick="savePessoaAccessProfiles('${p.key}')">Salvar acesso</button>`}`;
}

// XOR professor/estagiário (D2 §3) + mostra/esconde unidades conforme derivação
function pessoaProfileToggle(cb) {
  if (cb.checked) {
    const other = cb.value === 'professor' ? 'professor_estagiario'
                : cb.value === 'professor_estagiario' ? 'professor' : null;
    if (other) {
      const o = document.querySelector(`#pessoaProfilesChecks input[value="${other}"]`);
      if (o) o.checked = false;
    }
  }
  const checked = Array.from(document.querySelectorAll('#pessoaProfilesChecks input:checked')).map(c => c.value);
  const { moduleAccess } = UserModel.deriveUserModel(checked);
  const wrap = document.getElementById('pessoaUnitsWrap');
  if (wrap) wrap.style.display = moduleAccess.comissoes ? '' : 'none';
}

async function savePessoaAccessProfiles(key) {
  const p = PessoasState.people.find(x => x.key === key);
  if (!p || !p.uid) return;
  const errEl = document.getElementById('pessoaAcessoError');
  errEl.textContent = '';
  const checked = Array.from(document.querySelectorAll('#pessoaProfilesChecks input:checked')).map(c => c.value);
  if (checked.length === 0) { errEl.textContent = 'Selecione ao menos um perfil.'; return; }
  const { moduleAccess, role } = UserModel.deriveUserModel(checked);
  let allowedUnits = (p.user && p.user.allowedUnits) || [];
  if (moduleAccess.comissoes) {
    allowedUnits = Array.from(document.querySelectorAll('#pessoaUnitsChecks input:checked')).map(c => c.value);
    if (allowedUnits.length === 0) { errEl.textContent = 'Selecione ao menos uma unidade (acesso ao Comissões).'; return; }
  }
  try {
    await db.collection('users').doc(p.uid).update({
      profiles: checked, role, moduleAccess, allowedUnits,
      unitId: allowedUnits[0] || null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast('Acesso atualizado.', 'success');
    await renderPessoasPage();
  } catch (e) { errEl.textContent = 'Erro: ' + e.message; }
}
```

- [ ] **Step 2: Verificação estática**

Run: `node -e "new Function(require('fs').readFileSync('professores-pessoas.js','utf8')); console.log('sintaxe ok')"`
Expected: `sintaxe ok`

- [ ] **Step 3: Commit**

```bash
git add professores-pessoas.js
git commit -m "feat(pessoas): ficha 4 abas gated — identidade, professor, salario, acesso (D4/D5)"
```

---

### Task 7: Wizard "Nova pessoa" + modal de Acesso

**Files:**
- Modify: `professores-pessoas.js` (substituir o stub `openPessoaWizard`)
- Modify: `professores.html` (markup dos 2 modais)

- [ ] **Step 1: Markup dos modais em `professores.html`**

Antes do comentário `<!-- ═════════ Firebase Config + Módulos JS ═════════ -->` (≈linha 2395), adicionar:

```html
  <!-- ═════════ Hub Pessoas — Wizard "Nova pessoa" (passo 1: perfis) ═════════ -->
  <div class="modal" id="pessoaWizardModal">
    <div class="modal-content">
      <div class="modal-header">
        <h3>Nova pessoa — Perfis</h3>
        <button class="close-btn" onclick="closePessoaWizard()">✕</button>
      </div>
      <div class="form-group">
        <label>Quais perfis essa pessoa tem? <span class="req">*</span></label>
        <div id="wizardProfilesChecks"></div>
        <div style="font-size:11px;color:var(--text3);margin-top:6px;">
          Professor e Professor (Estagiário) são exclusivos entre si.
          Se for professor, os próximos passos pedem os dados e o salário antes do acesso.
        </div>
      </div>
      <div id="wizardError" style="color:var(--red);font-size:12px;min-height:16px;"></div>
      <div class="form-actions">
        <button class="btn btn-ghost" onclick="closePessoaWizard()">Cancelar</button>
        <button class="btn" onclick="wizardAdvance()">Avançar →</button>
      </div>
    </div>
  </div>

  <!-- ═════════ Hub Pessoas — Passo Acesso (login) ═════════ -->
  <div class="modal" id="pessoaAccessModal">
    <div class="modal-content">
      <div class="modal-header">
        <h3>🔑 Acesso ao sistema</h3>
        <button class="close-btn" onclick="closeAccessModal()">✕</button>
      </div>
      <div id="accessResumo" style="font-size:13px;border:1px dashed var(--text3);border-radius:6px;padding:8px;margin-bottom:10px;"></div>
      <div class="form-group" id="accessNameWrap">
        <label>Nome completo <span class="req">*</span></label>
        <input type="text" id="accessName">
      </div>
      <div class="form-group">
        <label>E-mail de login <span class="req">*</span></label>
        <input type="email" id="accessEmail">
      </div>
      <div class="form-group">
        <label>Senha provisória <span class="req">*</span> (mín. 6 caracteres)</label>
        <input type="password" id="accessPass">
      </div>
      <div class="form-group" id="accessUnitsWrap" style="display:none;">
        <label>Unidades (Comissões) <span class="req">*</span></label>
        <div id="accessUnitsChecks"></div>
      </div>
      <div id="accessError" style="color:var(--red);font-size:12px;min-height:16px;"></div>
      <div class="form-actions">
        <button class="btn btn-ghost" id="accessSkipBtn" onclick="skipAccess()">Pular — criar sem acesso</button>
        <button class="btn" id="accessSaveBtn" onclick="savePessoaAccess()">Criar pessoa + acesso</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Substituir o stub do wizard em `professores-pessoas.js`**

Remover a linha `function openPessoaWizard() { toast('Wizard em construção.', 'info'); }` e adicionar:

```js
// ── Wizard "Nova pessoa" (D7/D9/D13) — admin-only, escritas progressivas ─
function openPessoaWizard() {
  if (!isStrictAdmin()) { toast('Apenas administradores podem criar pessoas.', 'error'); return; }
  const cont = document.getElementById('wizardProfilesChecks');
  cont.innerHTML = UserModel.PROFILE_ORDER.map(pr => `
    <label style="display:block;margin:4px 0;">
      <input type="checkbox" value="${pr}" onchange="wizardProfileToggle(this)"> ${UserModel.PROFILE_LABELS[pr]}
    </label>`).join('');
  document.getElementById('wizardError').textContent = '';
  document.getElementById('pessoaWizardModal').classList.add('open');
}

function closePessoaWizard() {
  document.getElementById('pessoaWizardModal').classList.remove('open');
}

function wizardProfileToggle(cb) {
  if (!cb.checked) return;
  const other = cb.value === 'professor' ? 'professor_estagiario'
              : cb.value === 'professor_estagiario' ? 'professor' : null;
  if (other) {
    const o = document.querySelector(`#wizardProfilesChecks input[value="${other}"]`);
    if (o) o.checked = false;
  }
}

function wizardAdvance() {
  const profiles = Array.from(document.querySelectorAll('#wizardProfilesChecks input:checked')).map(c => c.value);
  const errEl = document.getElementById('wizardError');
  if (profiles.length === 0) { errEl.textContent = 'Selecione ao menos um perfil.'; return; }
  closePessoaWizard();
  if (UserModel.isTeacherProfile(profiles)) startWizardTeacherStep(profiles);
  else openAccessModal({ profiles, teacherId: null }); // caminho curto: Acesso obrigatório (D7)
}

// Caminho professor: teacherModal → salaryModal → Acesso, via hooks da Task 4
function startWizardTeacherStep(profiles) {
  TeacherFormState.onSaved = async (teacher) => {
    const tRes = await TeacherService.list();           // openSalaryModal procura na lista
    if (tRes.success) ProfessoresState.list = tRes.data;
    toast(`Professor "${teacher.name}" criado. Agora o salário (feche o modal pra pular).`, 'info', 5000);
    SalaryFormState.onClosed = () => openAccessModal({ profiles, teacherId: teacher.id });
    openSalaryModal(teacher.id);
  };
  openTeacherModal();
  if (profiles.includes('professor_estagiario')) setTeacherType('estagiario');
}

// ── Passo Acesso ────────────────────────────────────────────────────────
function openAccessModal(opts) {
  PessoasAccessCtx = opts;
  const t = opts.teacherId ? ProfessoresState.list.find(x => x.id === opts.teacherId) : null;
  const { moduleAccess } = UserModel.deriveUserModel(opts.profiles);

  document.getElementById('accessResumo').innerHTML =
    `${t ? `<strong>${escapeHtml(t.name)}</strong> · ` : ''}Perfis: ` +
    opts.profiles.map(pr => UserModel.PROFILE_LABELS[pr] || pr).join(', ');
  document.getElementById('accessNameWrap').style.display = t ? 'none' : '';
  document.getElementById('accessName').value = '';
  document.getElementById('accessEmail').value = t ? (t.email || '') : '';
  document.getElementById('accessPass').value = '';
  document.getElementById('accessError').textContent = '';

  const unitsWrap = document.getElementById('accessUnitsWrap');
  if (moduleAccess.comissoes) {
    unitsWrap.style.display = '';
    document.getElementById('accessUnitsChecks').innerHTML =
      Array.from(ProfessoresState.unitsMap.values()).map(un => `
        <label style="display:block;margin:4px 0;">
          <input type="checkbox" value="${un.id}"> ${escapeHtml(un.name || un.id)}
        </label>`).join('');
  } else {
    unitsWrap.style.display = 'none';
  }

  // "Pular" só existe no caminho professor (D7) — sem entidade, o login É o registro
  document.getElementById('accessSkipBtn').style.display = opts.teacherId ? '' : 'none';
  const btn = document.getElementById('accessSaveBtn');
  btn.disabled = false; btn.textContent = 'Criar pessoa + acesso';
  document.getElementById('pessoaAccessModal').classList.add('open');
}

function closeAccessModal() {
  document.getElementById('pessoaAccessModal').classList.remove('open');
}

function skipAccess() {
  const ctx = PessoasAccessCtx;
  closeAccessModal();
  toast('Pessoa criada sem acesso — o login pode ser criado depois pela ficha.', 'info', 5000);
  PessoasState.selectedKey = ctx && ctx.teacherId ? 'T:' + ctx.teacherId : null;
  renderPessoasPage();
}

// "Criar acesso" a partir da ficha (banner / aba Acesso) — D8: estado recuperável
function pessoaCriarAcesso(key) {
  const p = PessoasState.people.find(x => x.key === key);
  if (!p || !p.teacherId) return;
  openAccessModal({ profiles: p.profiles, teacherId: p.teacherId });
}

function mapAccessAuthError(e) {
  const map = {
    'auth/email-already-in-use': 'E-mail já existe no sistema de autenticação. Se um cadastro anterior falhou no meio, contate o desenvolvedor pra recuperar o login.',
    'auth/invalid-email': 'E-mail inválido.',
    'auth/weak-password': 'Senha muito fraca. Use ao menos 6 caracteres.',
  };
  return map[e.code] || ('Erro: ' + (e.code || e.message));
}

async function savePessoaAccess() {
  const ctx = PessoasAccessCtx;
  const errEl = document.getElementById('accessError');
  errEl.textContent = '';
  const t = ctx.teacherId ? ProfessoresState.list.find(x => x.id === ctx.teacherId) : null;
  const name = t ? t.name : document.getElementById('accessName').value.trim();
  const email = document.getElementById('accessEmail').value.trim();
  const pass = document.getElementById('accessPass').value;

  if (!name) { errEl.textContent = 'Informe o nome.'; return; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errEl.textContent = 'E-mail inválido.'; return; }
  if (!pass || pass.length < 6) { errEl.textContent = 'Senha mín. 6 caracteres.'; return; }

  const { moduleAccess, role } = UserModel.deriveUserModel(ctx.profiles);
  let allowedUnits = [];
  if (moduleAccess.comissoes) {
    allowedUnits = Array.from(document.querySelectorAll('#accessUnitsChecks input:checked')).map(c => c.value);
    if (allowedUnits.length === 0) { errEl.textContent = 'Selecione ao menos uma unidade (acesso ao Comissões).'; return; }
  }

  const btn = document.getElementById('accessSaveBtn');
  btn.disabled = true; btn.textContent = 'Criando…';

  // ③ Auth user via app secondary (não desloga o admin)
  let newUid = null;
  try {
    const secondaryApp = firebase.apps.find(a => a.name === 'secondary')
      || firebase.initializeApp(window.FIREBASE_CONFIG, 'secondary');
    const secondaryAuth = secondaryApp.auth();
    const cred = await secondaryAuth.createUserWithEmailAndPassword(email, pass);
    newUid = cred.user.uid;
    await secondaryAuth.signOut();
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Criar pessoa + acesso';
    errEl.textContent = mapAccessAuthError(e);
    return; // D8: se a entidade existe, segue "sem acesso" — nada a desfazer
  }

  // ④ users doc gravado COMO ADMIN pelo db principal (rules: create só admin — §5 do spec)
  try {
    await db.collection('users').doc(newUid).set({
      name, email, role,
      profiles: ctx.profiles,
      moduleAccess,
      professorId: ctx.teacherId || null,
      allowedUnits,
      unitId: allowedUnits[0] || null,
      status: 'ativo',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Criar pessoa + acesso';
    errEl.textContent = 'Login criado no Auth, mas o perfil falhou: ' + e.message;
    return;
  }

  closeAccessModal();
  toast(`Pessoa "${name}" criada com acesso.`, 'success');
  PessoasState.selectedKey = ctx.teacherId ? 'T:' + ctx.teacherId : 'U:' + newUid;
  PessoasState.activeTab = 'identidade';
  await renderPessoasPage();
}
```

- [ ] **Step 3: Verificação estática + smokes**

Run: `node -e "new Function(require('fs').readFileSync('professores-pessoas.js','utf8')); console.log('sintaxe ok')"`
Expected: `sintaxe ok`

Run: `node scripts/smoke-user-model.js && node scripts/smoke-sidebar.js && node scripts/smoke-pessoas-model.js`
Expected: 3× `✓`

- [ ] **Step 4: Commit**

```bash
git add professores-pessoas.js professores.html
git commit -m "feat(pessoas): wizard Nova pessoa (perfis->modais reusados->acesso) + modal de acesso (D7/D9/D13)"
```

---

### Task 8: `index.html` — troca cirúrgica do link de menu (D10)

**Files:**
- Modify: `index.html:3612` (UMA linha — regra inviolável #1)

- [ ] **Step 1: Trocar o item de menu**

Em `index.html`, função `buildSidebar()` (linha ≈3612), substituir:

```js
        html += sbItem('users', '👥', 'Usuários');
```

por:

```js
        // D10 (hub Pessoas): gestão de usuários migrou pro hub no app Professores.
        // A tela page-users continua no código, sem entrada de menu.
        html += `<a class="sb-item" href="professores.html?page=pessoas" style="text-decoration:none;color:inherit;"><span class="icon">👥</span>Pessoas</a>`;
```

- [ ] **Step 2: Conferir que o diff do index.html tem SÓ essa mudança**

Run: `git diff --stat index.html && git diff index.html | head -30`
Expected: 1 chunk, ~3 linhas adicionadas / 1 removida, nada além da função buildSidebar.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(comissoes): menu Usuarios vira link pro hub Pessoas (D10, toque minimo regra #1)"
```

---

### Task 9: Auditoria de dados — `admin_gestao` em users

Antes de mudar as rules: confirmar que NINGUÉM tem o perfil que vai perder poder.

**Files:**
- Create: `scripts/audit-admin-gestao.js`

- [ ] **Step 1: Criar o script**

```js
'use strict';
// Audita users com admin_gestao (role ou profiles) ANTES do deploy de rules.
// Roda: node scripts/audit-admin-gestao.js   (staging via serviceAccount-staging.json)
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-staging.json')) });

(async () => {
  const snap = await admin.firestore().collection('users').get();
  const hits = [];
  snap.forEach(d => {
    const u = d.data();
    const ps = Array.isArray(u.profiles) ? u.profiles : [];
    if (u.role === 'admin_gestao' || ps.includes('admin_gestao')) {
      hits.push({ id: d.id, email: u.email || '—', role: u.role || '—', profiles: ps.join(',') });
    }
  });
  if (hits.length === 0) {
    console.log('✓ Nenhum usuário com admin_gestao — remoção das rules é segura.');
  } else {
    console.log('⚠ Usuários com admin_gestao encontrados — DECIDIR migração com o cliente antes do deploy de rules:');
    console.table(hits);
    process.exitCode = 1;
  }
  process.exit();
})();
```

- [ ] **Step 2: Rodar contra o staging**

Run: `node scripts/audit-admin-gestao.js`
Expected: `✓ Nenhum usuário com admin_gestao — remoção das rules é segura.`
**Se aparecer ⚠: PARAR e perguntar ao cliente como migrar esses usuários (provável → `admin` ou `supervisao`) antes de seguir pra Task 10.**

- [ ] **Step 3: Commit**

```bash
git add scripts/audit-admin-gestao.js
git commit -m "chore(scripts): auditoria de admin_gestao nos dados antes do deploy de rules"
```

---

### Task 10: Security Rules — `isAdmin()` sem `admin_gestao` + supervisão edita teacher

**Files:**
- Modify: `firestore.rules` (2 pontos)

- [ ] **Step 1: Editar as rules**

1. Linha 27, substituir:

```
    function isAdmin()      { return hasP('admin') || hasP('admin_gestao'); }
```

por:

```
    function isAdmin()      { return hasP('admin'); }   // admin_gestao dropado (hub Pessoas D2)
```

2. Bloco `match /teachers/{id}` (linhas ≈82-86), substituir:

```
    match /teachers/{id} {
      allow read:           if isAuth() && hasProfModule();
      allow create, update: if isAuth() && isAdmin();
      allow delete:         if false;
    }
```

por:

```
    match /teachers/{id} {
      allow read:   if isAuth() && hasProfModule();
      allow create: if isAuth() && isAdmin();                  // D9: só admin cria (wizard)
      allow update: if isAuth() && (isAdmin() || isSuperv());  // D5: supervisão edita Identidade/Professor
      allow delete: if false;
    }
```

- [ ] **Step 2: Deploy SÓ das rules no staging (explícito — lição registrada)**

Run: `firebase deploy --only firestore:rules`
Expected: `✔ Deploy complete!` no projeto `crosstrainer-comissoes-staging` (default do `.firebaserc`).

- [ ] **Step 3: Commit**

```bash
git add firestore.rules
git commit -m "feat(rules): isAdmin sem admin_gestao + supervisao atualiza teachers (D2/D5/D9)"
```

---

### Task 11: Fixture staging + validação REST das rules

**Files:**
- Create: `scripts/fixture-pessoas.js`
- Create: `scripts/validate-pessoas-rules.js`

- [ ] **Step 1: Criar a fixture (com `--cleanup`)**

`scripts/fixture-pessoas.js`:

```js
'use strict';
// Fixture do hub Pessoas (staging): 3 estados da junção + usuária de supervisão p/ validação REST.
// Roda:  node scripts/fixture-pessoas.js            (cria)
//        node scripts/fixture-pessoas.js --cleanup  (remove tudo)
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-staging.json')) });
const db = admin.firestore();
const auth = admin.auth();

const FIX = {
  teacherSemAcesso: { name: 'Fixture Pessoas SemAcesso', email: 'fix.pessoas.semacesso@teste.com' },
  teacherVinculado: { name: 'Fixture Pessoas Vinculado', email: 'fix.pessoas.prof@teste.com', pass: 'fixprof123' },
  supervisao:       { name: 'Fixture Pessoas Supervisao', email: 'fix.pessoas.superv@teste.com', pass: 'fixsuperv123' },
};

async function firstIds() {
  const mods = await db.collection('modalities').limit(1).get();
  const units = await db.collection('units').limit(1).get();
  if (mods.empty || units.empty) throw new Error('Staging precisa de >=1 modality e >=1 unit');
  return { modalityId: mods.docs[0].id, unitId: units.docs[0].id };
}

function teacherDoc(name, email, ids) {
  return {
    name, email, phone: '', cpf: '***.***.***-00', type: 'efetivo',
    unitIds: [ids.unitId], primaryUnitId: ids.unitId, modalityIds: [ids.modalityId],
    hireDate: admin.firestore.Timestamp.now(), isActive: true,
    notes: 'FIXTURE pessoas — pode apagar', createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: 'fixture',
  };
}

async function ensureAuthUser(email, pass, name) {
  try { const u = await auth.getUserByEmail(email); return u.uid; }
  catch { const u = await auth.createUser({ email, password: pass, displayName: name }); return u.uid; }
}

async function create() {
  const ids = await firstIds();
  // 1) teacher sem acesso
  const t1 = await db.collection('teachers').add(teacherDoc(FIX.teacherSemAcesso.name, FIX.teacherSemAcesso.email, ids));
  // 2) teacher + user vinculados
  const t2 = await db.collection('teachers').add(teacherDoc(FIX.teacherVinculado.name, FIX.teacherVinculado.email, ids));
  const profUid = await ensureAuthUser(FIX.teacherVinculado.email, FIX.teacherVinculado.pass, FIX.teacherVinculado.name);
  await db.collection('users').doc(profUid).set({
    name: FIX.teacherVinculado.name, email: FIX.teacherVinculado.email,
    role: 'professor', profiles: ['professor'],
    moduleAccess: { comissoes: false, professores: true },
    professorId: t2.id, status: 'ativo',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  // 3) supervisão (user-only)
  const supUid = await ensureAuthUser(FIX.supervisao.email, FIX.supervisao.pass, FIX.supervisao.name);
  await db.collection('users').doc(supUid).set({
    name: FIX.supervisao.name, email: FIX.supervisao.email,
    role: 'supervisao', profiles: ['supervisao'],
    moduleAccess: { comissoes: false, professores: true },
    professorId: null, status: 'ativo',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(JSON.stringify({
    teacherSemAcessoId: t1.id, teacherVinculadoId: t2.id,
    profUid, supUid,
    supervEmail: FIX.supervisao.email, supervPass: FIX.supervisao.pass,
    profEmail: FIX.teacherVinculado.email, profPass: FIX.teacherVinculado.pass,
  }, null, 2));
}

async function cleanup() {
  for (const f of [FIX.teacherSemAcesso, FIX.teacherVinculado, FIX.supervisao]) {
    try { const u = await auth.getUserByEmail(f.email); await auth.deleteUser(u.uid); await db.collection('users').doc(u.uid).delete(); console.log('auth+user removido:', f.email); } catch {}
  }
  const snap = await db.collection('teachers').where('notes', '==', 'FIXTURE pessoas — pode apagar').get();
  for (const d of snap.docs) { await d.ref.delete(); console.log('teacher removido:', d.id); }
  console.log('✓ cleanup completo');
}

(process.argv.includes('--cleanup') ? cleanup() : create()).then(() => process.exit());
```

- [ ] **Step 2: Criar a validação REST**

`scripts/validate-pessoas-rules.js`:

```js
'use strict';
// Valida as rules do hub Pessoas via REST (auth real — Admin SDK bypassa rules).
// Pré-req: node scripts/fixture-pessoas.js (passar os ids/uids impressos como env):
//   TEACHER_ID=<teacherVinculadoId> PROF_UID=<profUid> node scripts/validate-pessoas-rules.js
// A API key do staging vem do firebase-config.js (não é segredo).
const fs = require('fs');

const cfg = fs.readFileSync(require('path').join(__dirname, '..', 'firebase-config.js'), 'utf8');
const apiKey = (cfg.match(/apiKey:\s*['"]([^'"]+)['"]/) || [])[1];
const projectId = 'crosstrainer-comissoes-staging';
const TEACHER_ID = process.env.TEACHER_ID;
const PROF_UID = process.env.PROF_UID;
if (!apiKey || !TEACHER_ID || !PROF_UID) { console.error('Faltam apiKey/TEACHER_ID/PROF_UID'); process.exit(1); }

const SUP = { email: 'fix.pessoas.superv@teste.com', pass: 'fixsuperv123' };
const PROF = { email: 'fix.pessoas.prof@teste.com', pass: 'fixprof123' };
const FS = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

async function signIn(email, password) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('signIn falhou p/ ' + email + ': ' + JSON.stringify(j));
  return j.idToken;
}

async function call(token, method, path, body) {
  const r = await fetch(`${FS}/${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.status;
}

function expect(desc, got, want) {
  const ok = got === want;
  console.log(`${ok ? '✓' : '✗'} ${desc} — esperado ${want}, veio ${got}`);
  if (!ok) process.exitCode = 1;
}

(async () => {
  const sup = await signIn(SUP.email, SUP.pass);
  const prof = await signIn(PROF.email, PROF.pass);

  // Supervisão
  expect('supervisão LÊ teacher', await call(sup, 'GET', `teachers/${TEACHER_ID}`), 200);
  expect('supervisão NÃO lê teacher_salaries (regra #6)', await call(sup, 'GET', `teacher_salaries/${TEACHER_ID}`), 403);
  expect('supervisão ATUALIZA teacher (D5)', await call(sup, 'PATCH',
    `teachers/${TEACHER_ID}?updateMask.fieldPaths=notes`,
    { fields: { notes: { stringValue: 'FIXTURE pessoas — pode apagar' } } }), 200);
  expect('supervisão NÃO cria users (D9)', await call(sup, 'POST',
    `users?documentId=fix-superv-tenta-criar`,
    { fields: { name: { stringValue: 'x' } } }), 403);
  expect('supervisão NÃO lê users de outro', await call(sup, 'GET', `users/${PROF_UID}`), 403);

  // Professor
  expect('professor NÃO lê users de outro', await call(prof, 'GET', 'users/uid-de-outra-pessoa-qualquer'), 403);
  expect('professor NÃO atualiza teacher', await call(prof, 'PATCH',
    `teachers/${TEACHER_ID}?updateMask.fieldPaths=notes`,
    { fields: { notes: { stringValue: 'hack' } } }), 403);
  expect('professor NÃO lê teacher_salaries', await call(prof, 'GET', `teacher_salaries/${TEACHER_ID}`), 403);

  console.log(process.exitCode ? '✗ validação REST com FALHAS' : '✓ validação REST passou');
  process.exit();
})();
```

- [ ] **Step 3: Rodar fixture → validação → cleanup**

Run:
```bash
node scripts/fixture-pessoas.js
# copiar teacherVinculadoId e profUid do output:
TEACHER_ID=<id> PROF_UID=<uid> node scripts/validate-pessoas-rules.js
```
Expected: todas as linhas `✓` e `✓ validação REST passou`.
**Manter a fixture** pra validação de UI (Task 12) — cleanup roda lá no final.

- [ ] **Step 4: Commit**

```bash
git add scripts/fixture-pessoas.js scripts/validate-pessoas-rules.js
git commit -m "test(pessoas): fixture staging + validacao REST das rules (supervisao/professor)"
```

---

### Task 12: Deploy staging + verificação de UI + encerramento

**Files:**
- Modify: `CONTEXTO_SESSAO.md` (protocolo de fim de sessão)

- [ ] **Step 1: Regressão completa dos smokes**

Run: `node scripts/smoke-user-model.js && node scripts/smoke-sidebar.js && node scripts/smoke-pessoas-model.js && node scripts/smoke-9.js`
Expected: todos `✓` (se `smoke-9.js` exigir setup que não existe mais, reportar e seguir — os 3 primeiros são obrigatórios)

- [ ] **Step 2: Deploy hosting no staging**

Run: `firebase deploy --only hosting`
Expected: `✔ Deploy complete!` em `crosstrainer-comissoes-staging`

- [ ] **Step 3: Roteiro de validação UI (cliente, janela anônima no staging)**

Absorve a validação pendente da Plano D (§9 do spec). Apresentar ao cliente:

1. **Admin** → Professores: sidebar mostra **Cadastros → Pessoas** (sem "Professores"); Administração só com Unidades + Auditoria.
2. **Pessoas**: lista mostra todos (badges de perfis; fixture "Fixture Pessoas SemAcesso" com badge SEM ACESSO).
3. **Wizard professor**: + Nova pessoa → marcar Professor → modal de professor → salvar → modal salarial → salvar (ou fechar) → modal Acesso → **Pular** → pessoa aparece sem acesso, banner na ficha.
4. **Criar acesso depois**: ficha do recém-criado → "Criar acesso" → email/senha → vira "Com acesso".
5. **Wizard vendedor**: caminho curto Perfis → Acesso (sem botão Pular; exige unidade).
6. **Segregação (Plano D/B)**: logar com o professor da fixture no `index.html` → tela "Sem acesso ao módulo Comissões"; logar no `professores.html` → sidebar de professor + Minha Agenda (professorId vinculado).
7. **Supervisão**: logar com `fix.pessoas.superv@teste.com` → Pessoas mostra SÓ professores, sem coluna/badge de acesso, ficha sem abas Salário/Acesso, sem botão "+ Nova pessoa"; consegue editar dados do professor.
8. **Comissões → menu "Pessoas"**: logar admin no `index.html` → clicar "Pessoas" → abre o hub direto (deep-link).
9. **Dark mode** nos modais novos.

- [ ] **Step 4: Cleanup da fixture (obrigatório — padrão do projeto)**

Run: `node scripts/fixture-pessoas.js --cleanup`
Expected: `✓ cleanup completo`

- [ ] **Step 5: Atualizar `CONTEXTO_SESSAO.md` e commitar**

Atualizar a seção **🔖 ONDE PARAMOS**: hub Pessoas implementado em staging (spec + plano executado), validação UI pendente/feita, fixture limpa, branch `feature/shell-integrado` não mergeada.

```bash
git add CONTEXTO_SESSAO.md
git commit -m "docs(contexto): hub Pessoas implementado em staging - status da validacao"
```

---

## Riscos e mitigações (do spec §11 + descobertas do mapeamento)

| Risco | Mitigação no plano |
|-------|--------------------|
| Falha parcial auth-ok/users-doc-falhou no retry dá `email-already-in-use` | Mensagem orienta contatar o dev (mesma limitação que o `createUser` legado já tem); recuperável via Admin SDK |
| `renderTabSalarial` legado ficaria stale no hub | Aba Salário tem render próprio + `onClosed` re-renderiza |
| Tipo do teacher (efetivo/estagiário) pode divergir do perfil marcado no passo 1 | Pré-seleção `setTeacherType('estagiario')`; divergência manual não bloqueia (igual Plano D) — anotar como gap conhecido |
| Rules: perda de poder de `admin_gestao` em dados existentes | Task 9 audita ANTES do deploy; para e pergunta se achar alguém |
| `page-professores` continua no DOM | Inalcançável (fora de PROF_PAGES); remoção física fica pra depois da homologação |

## Fora de escopo (spec §10)

Visão Professor (preview do dev) · SPA única · remoção física da tela de Usuários do `index.html` · limpeza de `admin_gestao` em `functions/`, `storage.rules` e queries legadas de `professores-shared.js`.
