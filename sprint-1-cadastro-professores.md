# Sprint 1 — Cadastro de Professores
**Objetivo:** Primeira tela funcional do módulo de Professores. CRUD completo de modalidades e professores (incluindo aba salarial restrita).
**Pré-condições:** ✅ Sprint 0-B homologado em staging
**Duração estimada:** 1,5 semanas

---

## 1. O que esta sprint entrega

Ao final desta sprint:
- Existe um arquivo `professores.html` independente do `index.html`, com sua própria sidebar
- Admin/Gestão pode cadastrar, editar, listar e inativar modalidades
- Admin/Gestão pode cadastrar, editar, listar e inativar professores (efetivo / estagiário / eventual)
- Aba Salarial dentro do cadastro de professor é **invisível** para perfis não-admin (não renderizada no DOM)
- CPF é mascarado tanto no armazenamento quanto na exibição
- Todo cadastro/edição gera entrada em `audit_log` com `before`/`after`
- O fluxo todo é homologado em staging antes de qualquer mudança em produção

---

## 2. Escopo claro

### ✅ ENTRA nesta sprint

| Item | Detalhes |
|------|----------|
| `professores.html` base | Shell de navegação (sidebar + topbar + área de páginas), reaproveitando 100% do design system do `index.html` |
| `firebase-config.js` linkado | Auto-detecção de staging/produção pelo hostname |
| Login + auth flow | `onAuthStateChanged`, leitura de `users/{uid}`, redirect se sem `moduleAccess.professores` |
| Sidebar dinâmica | Itens visíveis conforme `profiles[]` do user (admin vê tudo, outros perfis ainda não vão entrar nesta sprint) |
| Tela "Modalidades" (CRUD) | Lista + form simples (nome, descrição, ativo/inativo). Padrão visual da tela `units` do `index.html` |
| Tela "Professores" (lista + ficha) | Layout 2 colunas conforme wireframe |
| Filtros da lista | Chip filter: Todos / Efetivo / Estagiário / Eventual / Inativos |
| Busca textual | Por nome ou email |
| Form de cadastro/edição de professor | Modal ou inline, com validações da spec § 9.1 |
| Tabs da ficha | Dados gerais · Modalidades · Unidades · 🔒 Salarial · Histórico |
| Aba Salarial | Restrita ao Admin via dupla camada (frontend + Security Rules já deployadas) |
| CPF mascarado | Armazenamento e exibição como `***.456.789-**` |
| `audit_log` com before/after | Cada criação/edição registra estado anterior e novo |
| Histórico salarial | Subsection da aba Salarial mostrando alterações de remuneração |

### ❌ NÃO ENTRA (vai para sprints futuros)

| Item | Sprint |
|------|--------|
| Agenda semanal e tela de agenda | Sprint 2 |
| Lançamento em Lote | Sprint 2 |
| Substituições | Sprint 3 |
| Fechamento e pagamento | Sprint 4 |
| Escalas especiais | Sprint 5 |
| Férias e recesso | Sprint 6 |
| Notificações por email | Sprint 7 |
| Relatórios e exportações | Sprint 8 |
| Perfis adicionais (supervisão, professor, estagiário) | Validação Sprint 1 com admin; demais perfis testáveis após Sprint 3 |
| Migração de users de produção | Pendente — não bloqueia o desenvolvimento |
| Cloud Functions de negócio | A partir de Sprint 3 |

---

## 3. Arquivos a criar nesta sprint

```
crosstrainer-comissoes/
├── professores.html                   ← NOVO — shell + login + sidebar
├── professores.js                     ← NOVO — lógica geral (router, auth, state)
├── professores-cadastro.js            ← NOVO — telas de Professores e Modalidades
├── professores-shared.js              ← NOVO — TeacherService, ModalityService, AuditService, helpers
└── (arquivos existentes intocados)
```

Decisão arquitetural:
- **`professores.html`** carrega Firebase SDK + `firebase-config.js` + os 3 JS modulares
- **`professores-shared.js`** define os Services (sem framework, padrão objeto literal — igual ao `commission.js`)
- **`professores-cadastro.js`** define as telas de cadastro (renderizadores e handlers)
- **`professores.js`** é o entry point (auth state, router, build sidebar)

Por que separar em 3 JS ao invés de inline?
- Cache-friendly (cada sprint adiciona um JS novo, sem reupload do tudo)
- Mais fácil de revisar em pull request
- Mantém o padrão de modularização sutil (sem virar framework)

---

## 4. Mapeamento wireframe → código

Referência: `AgendaWireframes_design.html` linhas 1963–2085.

| Elemento do wireframe | Componente no código | Observação |
|----------------------|---------------------|------------|
| Sidebar com 7 itens (👥 Professores ativo) | `buildSidebarProfessores()` em `professores.js` | Reusa CSS de `.sb-section`, `.sb-item` do `index.html` |
| Topbar: título + contador + busca + botão "+ Novo" | `renderProfessoresTopbar()` em `professores-cadastro.js` | Contador vem de `TeacherService.getCounts()` |
| Lista esquerda (280px) com filtros chip | `renderTeachersList(filters)` | Filtro chip controla `filters.type` e `filters.isActive` |
| Avatar (iniciais com cor por tipo) | função `avatarHtml(name, type)` | Função utilitária no `professores-shared.js` |
| Badge "12 meses em 28d" para estagiário | função `internAlertHtml(teacher)` | Calculada a partir de `internshipStartDate` |
| Header da ficha (nome, status, botões) | `renderTeacherHeader(teacher)` | Botão "Inativar" só pra admin |
| Tabs (Dados gerais / Modalidades / Unidades / 🔒 Salarial / Histórico) | `renderTeacherTabs(teacher, currentTab)` | Aba Salarial só é injetada no DOM se `canSeeSalary()` |
| Grid de dados gerais (2 colunas) | `renderTabDadosGerais(teacher)` | CPF mascarado já vem do banco |
| Aba Salarial com R$/hora e histórico | `renderTabSalarial(teacher, salary)` | Lê `teacher_salaries/{teacherId}` separadamente |
| Card específico estagiário (bolsa + limite + R$/h prop) | Branch dentro de `renderTabSalarial` | `if teacher.type === 'estagiario'` |
| Modal "+ Novo professor" | `openTeacherFormModal(teacher?)` | Reusa `.modal-overlay` do `index.html` |
| Tela Modalidades (não no wireframe) | Implementar padrão visual da tela `units` | Sem ficha — só lista + modal simples |

---

## 5. Modelo de dados utilizado

Já especificado em § 2.2 e § 2.3 da `EspecificacaoTecnica`. Resumo do que esta sprint cria/lê:

### `teachers/{teacherId}`
```js
{
  userId: null,                          // vínculo com users/{uid}, opcional nesta sprint
  name: 'Lucas Mendes da Silva',
  email: 'lucas.mendes@crosstrainer.com',
  phone: '(11) 98765-4321',
  cpf: '***.456.789-**',                 // já mascarado no banco — P05
  type: 'efetivo',                       // efetivo | estagiario | eventual
  unitIds: ['unit-cp', 'unit-norte'],
  primaryUnitId: 'unit-cp',
  modalityIds: ['mod-crossfit', 'mod-funcional'],
  hireDate: Timestamp,
  contractEndDate: null,                 // só estagiario
  internshipStartDate: null,             // só estagiario
  isActive: true,
  notes: '',
  createdAt, createdBy, updatedAt, updatedBy
}
```

### `teacher_salaries/{teacherId}` — bloqueada por Security Rule (só Admin)
```js
{
  teacherId: 'tch-001',
  remunerationType: 'hora_aula',         // hora_aula | bolsa | misto
  hourlyRate: 65,                        // efetivo / eventual
  internMonthlyStipend: null,            // só estagiario
  internMonthlyLimitHours: null,         // só estagiario
  internMonthlyLimitMinutes: null,
  internProportionalHourlyRate: null,
  salaryHistory: [
    { changedAt, changedBy, changedByName, field, previousValue, newValue }
  ],
  updatedAt, updatedBy
}
```

### `modalities/{modalityId}`
```js
{
  name: 'CrossFit',
  description: '',
  isActive: true,
  createdAt, createdBy
}
```

---

## 6. Sequência de implementação (ordem proposta)

Ordem importa pra construir de forma estável. Não pular etapas.

### Etapa 1 — Shell de `professores.html` (~1 dia)
- [ ] Estrutura base do HTML (head, fontes, scripts)
- [ ] Estilos copiados do `index.html` via `<link>` ou bloco `<style>` próprio (decidir durante)
- [ ] Login page idêntico ao do `index.html`
- [ ] App shell (sidebar + main)
- [ ] `firebase-config.js` linkado
- [ ] `onAuthStateChanged` com bloqueio de quem não tem `moduleAccess.professores`
- [ ] Smoke test: abre, faz login com `abluir@gmail.com`, vê app shell vazio

### Etapa 2 — Services base (~0,5 dia)
- [ ] `professores-shared.js` com:
  - `ModalityService.list() / create() / update() / deactivate()`
  - `TeacherService.list() / getById() / create() / update() / deactivate() / getCounts()`
  - `TeacherService.getSalary() / updateSalary()` (separado por Security Rule)
  - `AuditService.log(...)` com before/after
  - Helpers: `mascararCpf()`, `avatarHtml()`, `internAlertHtml()`
- [ ] Teste manual via console: criar 2 modalidades e 1 professor via `await TeacherService.create(...)`

### Etapa 3 — Tela de Modalidades (~0,5 dia)
- [ ] Sidebar item "🏷️ Modalidades"
- [ ] Lista simples (tabela ou cards)
- [ ] Botão "+ Nova modalidade" → modal
- [ ] Edição → modal
- [ ] Inativar → atualização de `isActive: false`
- [ ] Teste de aceite: criar 5 modalidades de exemplo (CrossFit, Funcional, Yoga, Pilates, Natação)

### Etapa 4 — Tela de Professores — lista (~1 dia)
- [ ] Sidebar item "👥 Professores" ativo
- [ ] Topbar com contador, busca, botão "+ Novo professor"
- [ ] Lista esquerda 280px com filtros chip
- [ ] Avatar com cor por tipo
- [ ] Badge "Inativo" para inativos
- [ ] Click em professor seleciona e prepara ficha (vazia ainda)
- [ ] Teste: criar 3 professores via Console e ver na lista

### Etapa 5 — Ficha do professor — Dados gerais + Modalidades + Unidades + Histórico (~1,5 dias)
- [ ] Header com avatar grande, nome em Bebas Neue, status, botões Editar/Inativar
- [ ] Tabs (sem a aba Salarial ainda)
- [ ] Aba Dados gerais: grid 2 colunas com todos os campos
- [ ] Aba Modalidades: chips com as modalidades vinculadas + botão "+ Adicionar"
- [ ] Aba Unidades: chips com as unidades vinculadas + indicação de principal
- [ ] Aba Histórico: ver `audit_log` filtrado por `entityType='teacher' AND entityId=teacherId`

### Etapa 6 — Modal de criação/edição (~1 dia)
- [ ] Form completo com todos os campos
- [ ] Validações conforme spec § 9.1
- [ ] Máscara de CPF (input recebe completo, ao salvar persiste mascarado)
- [ ] Multi-select de modalidades (busca em `modalities`)
- [ ] Multi-select de unidades + escolha de principal
- [ ] Campos condicionais: `contractEndDate` e `internshipStartDate` aparecem só se `type='estagiario'`
- [ ] Submit → `TeacherService.create()` ou `.update()` → log com before/after
- [ ] Teste: criar professor efetivo, estagiário e eventual; editar um deles; ver entry em audit_log

### Etapa 7 — Aba Salarial (RF26 + RN19) (~1 dia)
- [ ] Tab "🔒 Salarial" **só é injetada no DOM** se `canSeeSalary()`
- [ ] Para efetivo/eventual: exibir tipo de remuneração + R$/hora + cálculo do feriado (×2)
- [ ] Para estagiário: bolsa fixa + limite mensal (h) + R$/h proporcional + início do estágio
- [ ] Form de edição abre modal específico
- [ ] Toda alteração de valor adiciona entry em `salaryHistory[]`
- [ ] Tabela de histórico salarial visível
- [ ] Teste de aceite: logar como admin → vê aba; logar como professor de teste → aba não aparece

### Etapa 8 — Validação final em staging (~0,5 dia)
- [ ] Smoke test completo:
  1. Login admin → vê todas as telas + aba salarial
  2. Login professor → ainda não tem menu (mostrar mensagem "sem acesso a essas telas" para evitar erro)
  3. Criar 5 modalidades + 5 professores (1 efetivo, 2 estagiário, 1 eventual, 1 efetivo inativo)
  4. Editar dados salariais de um deles → confirmar entry em `salaryHistory`
  5. Inativar um professor → confirmar `isActive: false`
  6. Verificar audit_log no Firestore Console
- [ ] Documentar resultados no log de sessões

---

## 7. Critérios de aceite

A sprint só pode ser dada como concluída quando **TODOS** os critérios abaixo passarem:

| # | Critério | Como verificar |
|---|----------|---------------|
| 1 | Login no `professores.html` funciona | Acessar localmente → fazer login com admin de teste |
| 2 | User sem `moduleAccess.professores` é bloqueado | Logar com user que não tenha o módulo → mensagem de acesso negado |
| 3 | CRUD de modalidades funciona ponta a ponta | Criar, editar, inativar 3 modalidades; verificar no Firestore |
| 4 | CRUD de professor funciona ponta a ponta | Criar efetivo, estagiário e eventual; editar 1; inativar 1 |
| 5 | CPF é mascarado | Cadastrar com `123.456.789-00` → no banco fica `***.456.789-**` |
| 6 | Aba Salarial NÃO aparece para não-admin | Logar com `professor@teste.com` → tab `🔒 Salarial` não renderizada |
| 7 | Aba Salarial bloqueada também na camada de dados | Inspect → tentar fetch `teacher_salaries/X` → permission-denied |
| 8 | Histórico salarial registra alterações | Mudar valor → entry em `salaryHistory[]` aparece |
| 9 | Audit log com before/after gravado | Cada criação/edição cria entry com `before`, `after`, `module:'professores'`, `entityType`, `entityId` |
| 10 | Layout fiel ao wireframe | Comparação visual lado-a-lado com `AgendaWireframes_design.html` |
| 11 | Módulo de Comissões intocado | Login no `index.html` continua funcionando normal — zero regressão |

---

## 8. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|--------------|----------|
| Quebrar `index.html` ao compartilhar CSS | 🟡 Média | NÃO compartilhar CSS por enquanto. Bloco `<style>` próprio em `professores.html`. Refatorar depois |
| Layout não bater pixel-perfect com wireframe | 🟡 Média | Abrir wireframe lado-a-lado durante desenvolvimento |
| User digita CPF e perdemos os 6 dígitos centrais | 🟢 Baixa | Decisão de design: ao salvar, mascaramos antes de gravar. Se admin precisar do CPF completo, alterar política depois (P05 — confirmado mascarado) |
| Sem dados de seed em `modalities` → cadastro de professor falha | 🟡 Média | Etapa 3 (Modalidades) vem antes de Etapa 4-7 (Professores). Validar populando 5 modalidades antes |
| Security Rule bloqueia leitura legítima de `teacher_salaries` no frontend | 🟢 Baixa | Já validado no Sprint 0-B com `test-auth.html` — admin tem acesso. Tem fallback se permission-denied: ocultar aba |
| Concorrência: dois admins editando o mesmo professor ao mesmo tempo | 🟢 Baixa | Aceitamos last-write-wins por enquanto. Audit log preserva histórico das alterações |

---

## 9. Definições importantes para começar

Algumas decisões precisam estar firmadas antes de codar:

| # | Decisão | Resposta |
|---|---------|----------|
| D1 | `professores.html` reusa CSS do `index.html` por `<link>` externo ou bloco próprio? | **Bloco próprio nesta sprint.** Refatorar pra CSS compartilhado em sprint posterior |
| D2 | Modais usam o padrão do `index.html` (`.modal-overlay`)? | **Sim** — copia o CSS do modal genérico |
| D3 | Sidebar reaproveita estrutura do `index.html`? | **Sim** — mesma estrutura, mesmas classes |
| D4 | Mobile responsivo nesta sprint? | **Não no escopo formal.** Estrutura responsiva básica vai surgir mas validação mobile completa fica para Sprint 2 (que tem agenda mobile) |
| D5 | Quantas modalidades de seed devemos criar para testar? | **5** — CrossFit, Funcional, Yoga, Pilates, Natação |
| D6 | Quantos professores de teste? | **5** — 1 efetivo, 2 estagiários, 1 eventual, 1 efetivo inativo |
| D7 | O campo `userId` em `teachers` precisa ser preenchido nesta sprint? | **Não obrigatório.** Vai ser usado quando os professores realmente logarem. Por enquanto, cadastro funciona sem |
| D8 | Vamos deployar em produção ao fim da sprint? | **Não.** Aguarda decisão de homologação completa (regra inviolável #7) |

---

## 10. Após a sprint

Sprint 1 termina quando todos os critérios estiverem ✅. Próximos passos:
- 🟢 Sprint 2 (Agenda semanal + Lançamento em Lote) — desbloqueada
- Ainda sem deploy em produção
- `professores.html` continua sendo melhorado pelas próximas sprints
