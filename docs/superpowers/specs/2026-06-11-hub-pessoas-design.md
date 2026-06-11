# Design — Hub único "Pessoas" (cadastro unificado) · CrossTainer

**Data:** 2026-06-11
**Autor:** sessão de brainstorming (cliente + Claude)
**Status:** aprovado no brainstorming · aguardando revisão do spec antes do plano de implementação
**Branch:** `feature/shell-integrado` (não mergeada no `main`)

---

## 1. Problema

Hoje a gestão de pessoas está fragmentada em duas telas com modelos diferentes:

- **"Gestão de Usuários"** no Comissões (`index.html`) — cria logins com perfis (evoluída na Plano D para multi-perfil + `professorId` + `moduleAccess`).
- **"Professores"** no módulo Professores (`professores.html`) — cadastra a entidade professor (dados, modalidades, aba Salarial gated).

Cadastrar um professor que usa o sistema exige passar pelas duas telas, em módulos diferentes, sem nada que indique a ordem ou o vínculo. O cliente decidiu (sessão 32) unificar num **hub único "Pessoas"** — "fazer certo já de início, mesmo que atrase a homologação" (opção A). A Plano D (commit `cefef06`) **vira fundação**: `user-model.js`, multi-perfil, `professorId` e segregação §4.7 são reaproveitados, não descartados.

---

## 2. Decisões travadas

| # | Decisão | Escolha |
|---|---------|---------|
| D1 | Escopo | **Uma lista "Pessoas"** com todos (vendedores, admins, professores, supervisão), servida no app Professores; **substitui** "Gestão de Usuários" do Comissões e **absorve** a ficha do Professor |
| D2 | Perfis | Simplificados: `admin` · `supervisao` · `professor` · `professor_estagiario` · `vendedor`. **`admin_gestao` dropado** — limpar do código |
| D3 | Desenvolvedor | `admin` + flag amarrada ao `OWNER_EMAIL` (`abluir@gmail.com`); não aparece no wizard, não é replicável nem removível pela UI |
| D4 | Ficha | 4 abas gated: **Identidade · Professor · 🔒 Salário · 🔑 Acesso**. Professor/Salário só se a pessoa for professor/estagiário |
| D5 | Matriz | Admin = todas as abas e todas as pessoas. Supervisão = só Identidade + Professor, e na lista vê **só professores**. Segurança real = Security Rules (UI só esconde) |
| D6 | `moduleAccess` | Derivado de `profiles[]` via `user-model.js` (Plano D): admin→{com✔,prof✔}; supervisao/professor→{com✗,prof✔}; vendedor→{com✔,prof✗} |
| D7 | Passo Acesso do wizard | **Opcional** no caminho professor ("Pular — criar sem acesso"); pessoa sem login é estado válido, com banner "Criar acesso" na ficha. **Obrigatório** no caminho não-professor (sem entidade, o login É o registro) |
| D8 | Professor órfão | Não existe como erro: se a criação do login falhar no fim do wizard, a pessoa fica no estado "sem acesso" (D7) — recuperável pela ficha, **sem rollback** |
| D9 | Quem cria | Wizard **admin-only**. Supervisão só consulta/edita Identidade + Professor de pessoas existentes |
| D10 | Tela de Usuários do Comissões | Link "Usuários" da Administração passa a apontar pro hub Pessoas; tela antiga do `index.html` **fica no código, sem entrada de menu** (toque mínimo — regra inviolável #1) |
| D11 | Entrada "Professores" no menu | **Some** — Pessoas assume (lista filtrável por perfil). Uma única porta de entrada |
| D12 | Modelo de dados | **União das 2 coleções** (`teachers` ⊕ `users` via `professorId`). Sem coleção nova, sem migração |

---

## 3. Modelo de dados — união (D12)

Uma "pessoa" é a junção de `teachers` e `users` via `users.professorId`. Três estados válidos:

| Estado | Composição | Exemplo |
|--------|-----------|---------|
| Professor **sem acesso** | só teacher doc | professor que dá aula mas não usa o sistema (admin agenda por ele); ou login que falhou no wizard (D8) |
| Pessoa **só de login** | só users doc | vendedor, admin, supervisão |
| Professor **com acesso** | teacher doc + users doc vinculados | professor que usa Minha Agenda |

Regras do modelo:

- **Fonte da verdade de identidade** (nome/email) para pessoa vinculada = **teacher doc**; toda leitura de identidade prefere o teacher doc quando há vínculo. O users doc é espelhado no save **apenas quando o editor é admin** (supervisão não tem write em `users` — §7); divergência eventual no users doc é cosmética, nunca lida como identidade de pessoa vinculada. Para pessoa só de login, identidade vive no users doc.
- `role` + `moduleAccess` continuam **derivados** de `profiles[]` por `deriveUserModel` (`user-model.js`) — `role` é mantido porque o Comissões depende dele.
- `professor` e `professor_estagiario` são **mutuamente exclusivos** (validação no wizard e na ficha).
- Combinações multi-perfil seguem livres fora disso (ex.: admin+professor = dono que dá aula).
- Perfil "Desenvolvedor" **não é um perfil persistido**: é `admin` + checagem `OWNER_EMAIL` em runtime (D3).
- **Zero migração**: dados existentes em staging/produção já estão num dos três estados.

---

## 4. Lista Pessoas

- **Local:** página nova `pessoas` no app Professores, seção **Administração · sistema** da sidebar (substitui o link "Usuários e Perfis" e a entrada "Professores" de Cadastros — D10/D11).
- **Colunas:** Nome · Perfis (badges, reusa as da Plano D) · Acesso (✓ tem login / "—" sem acesso) · ação abrir ficha.
- **Busca** por nome/email + **filtro por perfil**.
- **Visibilidade:** admin vê todos. **Supervisão vê só professores — e a lista dela consulta apenas `teachers`**, sem read em `users` (simplifica as Rules, §7).
- Botão **"+ Nova pessoa"** (wizard) só para admin (D9).

---

## 5. Wizard "Nova pessoa" (admin-only)

### Caminho professor/estagiário — 4 passos
1. **Perfis** — checkboxes dos 5 perfis (D2); validação: ≥1 perfil; professor XOR estagiário.
2. **Dados de professor** — mesmos campos da ficha atual (Sprint 1: nome, modalidades, tipo de contrato etc.).
3. **🔒 Salário** — mesmos campos da aba Salarial atual (valor hora/bolsa, VR/VT/Outros, `effectiveDate`).
4. **🔑 Acesso** — resumo do que será criado + email/senha. Botões: **"Criar pessoa + acesso"** ou **"Pular — criar sem acesso"** (D7).

### Caminho não-professor — 2 passos
1. **Perfis** → 2. **🔑 Acesso (obrigatório)** — sem botão pular (D7).

### Escritas — só na conclusão, nesta ordem
① teacher doc → ② salary doc (`teacher_salaries`) → ③ Auth user (app Firebase `secondary`, mesmo padrão do `createUser` atual — não desloga o admin) → ④ users doc `{profiles, role, moduleAccess, professorId}`.

### Falhas parciais (D8 — sem rollback)
- Falha em ③ ou ④ → pessoa existe **sem acesso**: toast explicando + ficha aberta na aba Acesso com banner "Criar acesso".
- Falha em ② → professor criado com aba Salário vazia (relatórios já mostram "Sem cadastro" — comportamento da Sprint 9); toast orienta completar pela ficha.
- "Pular" no passo 4 → fluxo termina após ②, estado "sem acesso" por escolha.

---

## 6. Ficha — 4 abas gated (D4, D5)

| Aba | Conteúdo | Quem vê |
|-----|----------|---------|
| **Identidade** | nome, email, telefone, badges de perfis (somente leitura aqui) | admin + supervisão |
| **Professor** | dados da entidade (modalidades, contrato) — só se professor/estagiário | admin + supervisão |
| **🔒 Salário** | aba Salarial atual, gated por `canSeeSalary()` (padrão existente) — só se professor/estagiário | só admin |
| **🔑 Acesso** | estado do login; **"Criar acesso"** (quando sem login — banner ⚠️ no topo da ficha); **edição de perfis** (checkboxes — é daqui que deriva `moduleAccess`); email de login | só admin |

- Perfis são **editados na aba Acesso**, não na Identidade (a edição de perfis mexe em login/derivações).
- Para o `OWNER_EMAIL`: aba Acesso mostra os perfis travados (não removível — D3).
- Supervisão **edita** Identidade + Professor (operacional); Salário e Acesso nem renderizam pra ela.

---

## 7. Security Rules

A UI esconde/bloqueia, mas a **trava real são as Rules**. O plano de implementação inclui uma auditoria das rules atuais de `users`, `teachers` e `teacher_salaries`, garantindo:

- **`users`:** create/update/delete **só admin**. Supervisão não precisa de read (a lista dela lê só `teachers` — §4).
- **`teachers`:** read para admin + supervisão (+ professor lê o próprio, como hoje); write admin + supervisão (Identidade/Professor são editáveis por ela — D5/D9: criação via wizard é admin, mas edição operacional é permitida).
- **`teacher_salaries`:** **só admin** (regra inviolável #6 — já é assim, confirmar).

**Validação obrigatória via REST API auth** (Admin SDK bypassa rules — lição da sessão 32, bug das férias).

---

## 8. Mudanças por módulo

### `professores.html` / módulo Professores
- Página nova `pessoas` (lista + wizard + ficha) — arquivo novo `professores-pessoas.js` seguindo o padrão dos demais (`professores-home.js` etc.).
- `professores-nav.js`: entrada "Pessoas" em Administração · sistema; **remover** "Usuários e Perfis" (link pro Comissões) e "Professores" (Cadastros); **dropar `admin_gestao`** de `PROF_PAGES` e config.
- `user-model.js`: dropar `admin_gestao` da derivação; ajustar `scripts/smoke-user-model.js`.
- Ficha antiga de professor: a página `professores` (Sprint 1) deixa de ter entrada de menu; rotas internas que abram ficha de professor passam a abrir a ficha de Pessoa.

### `index.html` / Comissões (cirúrgico — regra inviolável #1)
- Trocar a entrada de menu "Gestão de Usuários" por **link pro hub** (`professores.html?page=pessoas` — deep-link reverso do Plano B). Tela antiga fica no código, inacessível por menu (D10).
- Nada além disso. As mudanças da Plano D no `index.html` (segregação §4.7, `user-model.js` carregado) permanecem como estão.

### Pendência de produção
Tudo vai pra produção **junto com o módulo**, via homologação completa em staging (regra inviolável #7).

---

## 9. Testes e validação

1. **Smoke `user-model`** atualizado (sem `admin_gestao`).
2. **Smoke novo `pessoas-model`** — junção pura dos 3 estados (só teacher / só user / vinculado), busca e filtro.
3. **Fixture staging autônoma** + validação de **Rules via REST API auth**: supervisão não lê `teacher_salaries` nem escreve `users`; professor não lê pessoas alheias.
4. **Roteiro UI manual** (janela anônima, staging) — **absorve a validação pendente da Plano D** (decisão de hoje: não validar o roteiro A/B/C/D antigo em separado; testes A/D validavam UI que este hub substitui; B/C — segregação §4.7 e login de professor — entram neste roteiro).

---

## 10. Fora de escopo / parqueado

- **"Visão Professor"** (preview de perfil pro desenvolvedor) — item parqueado, recurso à parte.
- **SPA única** (fundir `index.html` + `professores.html`) — fora de escopo, como no design da navegação.
- **Dados do Comissões em staging** (0 `periodos`, units duplicadas) — tech debt registrado, não bloqueia.
- **Remoção física da tela de Usuários** do `index.html` — fica pra depois da homologação do hub (toque mínimo agora).

## 11. Riscos

| Risco | Mitigação |
|-------|-----------|
| Escritas em sequência sem transação (4 docs) | D8: cada falha parcial cai num estado válido e recuperável pela ficha; ordem de escrita escolhida pra isso |
| Identidade duplicada (teacher.name vs users.name divergirem) | Fonte da verdade definida (§3) + espelhamento no save; smoke cobre |
| Rules permissivas passarem despercebidas | Validação REST API auth obrigatória (§7) |
| Mexer no `index.html` além do necessário | D10 limita a 1 troca de link de menu; revisão de diff antes do commit |

---

## Referências

- `CONTEXTO_SESSAO.md` — sessão 32 (decisões originais do hub) e sessão 33 (decisões D7–D12)
- `docs/superpowers/specs/2026-06-10-navegacao-shell-integrado-design.md` — design da navegação (Planos A–D)
- Mockups: `.superpowers/brainstorm/2537-1781139318/content/hub-layout-v2.html` (layout) e `.superpowers/brainstorm/766-1781180880/content/wizard-telas.html` (wizard)
- Proposta Funcional V3 §4.5–§4.8 (matriz de acesso e segregação)
