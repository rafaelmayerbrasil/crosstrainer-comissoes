# Design — Navegação integrada (shell + sidebar + home) · CrossTainer

**Data:** 2026-06-10
**Autor:** sessão de brainstorming (cliente + Claude)
**Status:** aprovado no brainstorming · aguardando revisão do spec antes do plano de implementação

---

## 1. Problema

A sidebar atual do módulo Professores está confusa e com **cabeçalhos de seção repetidos** (OPERAÇÃO e FINANCEIRO aparecem duas vezes cada). A home/Início ainda mostra **cards de status de sprint** (placeholder de desenvolvimento), não um painel pensado pro usuário final. E não há um modelo claro de como Professores e Comissões convivem numa navegação única — sendo que a diretriz do cliente é **integrar tudo**.

### Causa raiz da duplicação (confirmada no código)

A sidebar é renderizada percorrendo o array `PAGE_DEFINITIONS` ([professores.js:37-52](../../../professores.js)) **na ordem de definição**, imprimindo o cabeçalho da seção toda vez que a seção do item muda. Como itens da mesma seção estão **espalhados** no array (ex.: `agenda` e `escalas` são ambos "Operação", mas com itens "Financeiro" no meio), o mesmo cabeçalho é impresso em blocos não-contíguos → aparece repetido. Não é problema de CSS; é de ordenação/agrupamento na renderização.

---

## 2. Decisões travadas no brainstorming

| # | Decisão | Escolha |
|---|---------|---------|
| D1 | Escopo | **Desenhar o shell integrado agora**, aplicando a parte do Professores primeiro |
| D2 | Padrão de navegação | **Seletor de módulo no header; a sidebar troca de módulo** (um módulo por vez) |
| D3 | Agrupamento da sidebar do Professores | **Por domínio:** Início · Agenda · Cadastros · Férias · Financeiro |
| D4 | Home / Início | **Centro de pendências** (saudação + "precisam de você" + KPIs + atalhos), começando enxuto |
| D5 | Cadastros de sistema | **Compartilhados** numa área de Administração (Usuários/Perfis, Unidades, Auditoria), reaproveitando o que já existe no Comissões — não duplicar (§4.5) |
| D6 | Tela de Usuários e Perfis | Precisa de evolução (ver §7) — registrada como **dependência/fase futura**, com decisão (a) editar `index.html` vs (b) tela nova unificada **a confirmar** |

Princípio transversal: **esta é uma reorganização de apresentação, não de permissões.** Quem vê o quê continua governado por `PROF_PAGES` ([professores.js:29-35](../../../professores.js)) e pela matriz de acesso §4.8 da Proposta Funcional. Nada de novo acesso é concedido aqui.

---

## 3. Modelo de navegação — shell integrado (D1, D2)

Uma **chrome de navegação compartilhada** entre os módulos, composta de:

- **Header:** marca `CrossTainer` · **seletor de módulo** (pílulas Comissões / Professores) · seletor de unidade ▾ · toggle de tema · menu do usuário.
- **Sidebar:** itens do **módulo ativo** + seção fixa de **Administração · sistema** (admin) no rodapé.

### Seletor de módulo (dirigido por `moduleAccess`, §4.6)

- Renderizado **dinamicamente** a partir de `moduleAccess{}` do usuário: mostra só os módulos autorizados.
- **Degrada graciosamente:** usuário com **1 módulo só** (vendedora → Comissões; professor → Professores) **não vê o seletor** — entra direto no seu módulo. O seletor só aparece pra quem tem 2+ módulos (tipicamente admin).
- Mantém a **segregação §4.7**: a tela nunca mistura itens de Comissões e Professores.

### Realidade de implementação

Hoje Comissões (`index.html`) e Professores (`professores.html`) são **duas páginas separadas**. "Integrar" nesta fase = a sidebar do Professores ganha o seletor que **aponta para a outra página** e adota a mesma chrome visual. Unificar de fato numa SPA única exigiria mexer no `index.html` (regra inviolável #1) — fora de escopo agora.

---

## 4. Sidebar do Professores — por domínio (D3)

Render passa a **agrupar por seção** (itens da mesma seção sempre contíguos, cabeçalho impresso uma única vez). Ordem e grupos:

### Visão Admin / Gestão
```
🏠 Início
AGENDA       → 📅 Agenda · 🌐 Agenda Geral · 🎯 Escalas Especiais
CADASTROS    → 👥 Professores · 🏷️ Modalidades
FÉRIAS       → 🏖️ Férias e Recesso · 📊 Saldos de Férias
FINANCEIRO   → 💰 Fechamento · 💳 Pagamentos · 📈 Relatórios
(MINHAS AULAS→ 📅 Minha Agenda)   ← condicional: só se o usuário tiver vínculo de professor
ADMINISTRAÇÃO· sistema → 🔑 Usuários e Perfis · 🏢 Unidades · 📜 Auditoria   ← só admin/admin_gestao
```

### Visão Professor / Estagiário
```
🏠 Início
MINHAS AULAS → 🌐 Agenda Geral · 📅 Minha Agenda
FINANCEIRO   → 💳 Meus Pagamentos
FÉRIAS       → 🏖️ Férias e Recesso · 📊 Meu Saldo
```

### Visão Supervisão
Subconjunto operacional (sem salarial), conforme `PROF_PAGES.supervisao`:
```
🏠 Início
AGENDA       → 📅 Agenda · 🌐 Agenda Geral · 🎯 Escalas Especiais
CADASTROS    → 👥 Professores
FÉRIAS       → 🏖️ Férias e Recesso · 📊 Saldos de Férias
```

### Refinamentos
- **"Substituições" não é item de menu** — acontece dentro de Agenda Geral / Minha Agenda (como já é hoje e como o wireframe previa).
- **"Minha Agenda" condicional:** para admin/admin_gestao, só aparece se `getCurrentProfessorId()` ([professores.js:69](../../../professores.js)) retornar vínculo. Admin puro não vê.
- Reaproveitar os mesmos `PAGE_DEFINITIONS` (ids/labels/ícones), mudando apenas `section` e a **forma de renderizar** (agrupado). Onde o label difere por perfil (`pagamentos` vs `meus-pagamentos`, `saldos-gestao` vs `meu-saldo`), a lógica atual já resolve via `PROF_PAGES`.

---

## 5. Home / Início — centro de pendências (D4)

Substitui os cards de status de sprint. Conteúdo por persona, começando **enxuto** (faixa de pendências + atalhos) e com KPIs como incremento posterior.

### Admin / Gestão
- **Saudação:** "Olá, {nome} 👋 — {unidade ativa} · {mês/ano}".
- **⚠ Precisam de você** (faixa de pendências, com contadores reais e link pra ação):
  - Fechamentos em aberto (mês corrente sem `monthly_closings` status `fechado` por unidade).
  - Férias a aprovar (`vacation_requests` status `pendente`).
  - Substituições/coberturas em aberto.
- **KPIs** (fase 2): profs ativos · aulas na semana · férias vencendo.
- **Atalhos:** Agenda · Fechamento · Relatórios (e demais conforme perfil).

### Professor / Estagiário
- **Saudação** + data.
- **📅 Próximas aulas de hoje** (da agenda do professor).
- **🔄 Substituições pendentes** (recebidas/enviadas a responder).
- **KPIs:** prévia de horas do mês · saldo de dias de férias.

Fonte dos contadores: coleções já existentes (`monthly_closings`, `vacation_requests`, `classes`, solicitações de substituição). A home é **leitura** — não cria/edita nada, só direciona.

---

## 6. Cadastros: sistema vs módulo (D5)

| Cadastro | Tipo | Vive em |
|----------|------|---------|
| Usuários / Perfis (login + `profiles[]` + `moduleAccess{}` + acesso a unidades) | 🔵 Sistema (compartilhado) | Administração · já no Comissões |
| Unidades (CNPJ, razão social, endereço) | 🔵 Sistema (compartilhado) | Administração · já no Comissões |
| Auditoria (log de ações) | 🔵 Sistema (compartilhado) | Administração |
| Professores (entidade: nome, CPF, valor/hora, modalidades, unidades) | 🟠 Módulo Professores | grupo Cadastros |
| Modalidades (catálogo de aulas) | 🟠 Módulo Professores | grupo Cadastros |

- A seção **Administração · sistema** fica fixada no rodapé da sidebar, **separada visualmente** dos itens do módulo, e aparece **igual** em qualquer módulo. Só `admin`/`admin_gestao`.
- **"Professores" (entidade) ≠ "Usuários" (login).** Ligam-se por `professorId`. O grupo Cadastros do módulo contém só Professores + Modalidades; Usuários/Unidades **não** entram lá.
- **Fonte única** (§4.5): a Administração reaproveita as telas que já existem no Comissões — não recria um cadastro paralelo.

---

## 7. Dependência — evolução da tela de Usuários e Perfis (D6)

**Estado atual** ([index.html:2964-2998](../../../index.html)): o formulário "Novo Usuário" só captura **Perfil = {vendedor, admin}** (papel único) + Acesso às Unidades. **Não** há `profiles[]`, `moduleAccess{}` nem `professorId`. Hoje o vínculo login↔professor é setado **manualmente no Firestore** (decisão D7, [professores.js:67-70](../../../professores.js)).

**Para um usuário "ser professor" pela UI, a tela precisa de 3 adições:**

1. **Perfil expandido e múltiplo** (`profiles[]`, §4.6): `admin`, `admin_gestao`, `supervisao`, `professor`, `professor_estagiario`, `vendedor` — permitindo combinações (ex.: admin que também dá aula).
2. **`moduleAccess{}`** — preferencialmente **derivado automaticamente** dos perfis (professor* / admin_gestao / supervisao → `professores:true`; vendedor → `comissoes:true`; admin → ambos), sem fricção pro operador.
3. **Vínculo `professorId`** — quando o perfil for `professor`/`professor_estagiario`, campo para escolher a **entidade-professor** (coleção `teachers`) que aquele login representa, substituindo a edição manual no Firestore.

**Decisão de implementação a confirmar:**
- **(a)** editar o formulário existente no `index.html` → exige **autorização explícita** pra tocar em código de produção (regra inviolável #1); ou
- **(b)** construir uma tela de Usuários **nova e unificada** na área compartilhada de Administração (código novo), com o Comissões apontando pra ela depois.

Esta dependência **não bloqueia** as §3-§6 (reorganização de sidebar + home são código novo do Professores). É uma fase própria.

---

## 8. Fora de escopo (não-objetivos)

- Reescrever ou mover as telas de Usuários/Unidades/Auditoria do `index.html` agora (regra #1).
- Unificar Comissões e Professores numa SPA única.
- Alterar **quem tem acesso a quê** (permissões/`PROF_PAGES`/matriz §4.8).
- Mexer no `sw.js`, `manifest.json` ou no wireframe `AgendaWireframes_design.html`.
- A tela evoluída de Usuários (§7) — desenhada aqui como dependência, implementada em fase própria.

---

## 9. Restrições e diretrizes

- **Regra inviolável #1:** não tocar em `index.html`/`commission.js`/`sw.js`/`manifest.json` sem autorização explícita. A integração desta fase é só no lado Professores (código novo) + link pro Comissões.
- **Regra inviolável #7:** tudo validado e homologado em **staging** antes de qualquer deploy em produção.
- **Regra inviolável #8:** textos visíveis usam **CrossTainer** (nunca CrossTrainer); IDs técnicos do Firebase permanecem.
- **§4.7:** segregação estrita Comissões ↔ Professores no menu dinâmico.
- **Idioma:** PT-BR na UI e nos comentários de código.

---

## 10. Critérios de aceite

1. A sidebar do Professores **não tem cabeçalho de seção repetido** em nenhum perfil.
2. Itens agrupados por domínio conforme §4 (admin, professor, supervisão).
3. "Minha Agenda" só aparece pra admin com vínculo de professor.
4. Seção **Administração · sistema** visível só a admin/admin_gestao, separada dos itens do módulo.
5. **Seletor de módulo** aparece só quando `moduleAccess` tem 2+ módulos; com 1 módulo, entra direto sem seletor.
6. Home substitui os cards de sprint por: saudação + faixa de pendências (contadores reais, com link) + atalhos; versão professor mostra próximas aulas + substituições pendentes.
7. Nenhuma mudança de permissão de acesso (paridade com `PROF_PAGES`/§4.8).
8. Nenhuma alteração em arquivos de produção do Comissões; validado em staging.

---

## Referências
- Proposta Funcional Consolidada V3 — §4 (Perfis), §4.5 (fonte única), §4.6 (`profiles[]`/`moduleAccess{}`/menu dinâmico), §4.7 (segregação), §4.8 (matriz de acesso).
- `professores.js` — `PROF_PAGES` (29-35), `PAGE_DEFINITIONS` (37-52), `getCurrentProfessorId` (69).
- `index.html` — Gestão de Usuários (2964), formulário (2982-2998), Gestão de Unidades (3010), Auditoria (3049).
- `AgendaWireframes_design.html` — referência visual aprovada (navegação por abas).
