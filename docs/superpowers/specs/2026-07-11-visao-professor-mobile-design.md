# Visão do Professor — Otimização Mobile (1ª passada) · Design

**Data:** 2026-07-11
**Compromisso de origem:** memória `projeto-visao-professor-mobile` — o acesso do professor é majoritariamente por celular; otimizar a visão dele pra mobile.

## Objetivo

Tornar a visão do professor **nativa de celular**, sem tocar no desktop. Foco em navegação e ergonomia globais (não redesenho tela-a-tela). Base já é responsiva (drawer no ☰ a partir de 768px); esta passada troca o padrão de navegação por uma **barra inferior**, traz o **sino** pra um cabeçalho compacto, e faz uma **varredura leve** de espaçamento/toque que vale pra todas as telas de uma vez.

## Não-objetivos

- **Desktop intocado.** Todo CSS novo fica sob `@media (max-width: 768px)`; JS novo só age quando a barra é aplicável.
- **Sem redesenho interno tela-a-tela.** Cards/tabelas internos ficam como estão (a varredura global já melhora todos).
- **Gestão (admin/supervisão) segue no drawer.** A barra inferior é só pro papel professor. Estender pra gestão fica pra depois, se pedido.

## Decisões (travadas no brainstorm)

| # | Decisão | Escolha |
|---|---------|---------|
| 1 | Padrão de navegação mobile | **Barra inferior fixa** (drawer no ☰ continua pros itens secundários) |
| 2 | Itens fixos da barra (5) | **Início · Minha Agenda · Escala · Placar · Pagamentos** |
| 3 | Profundidade da passada | **Shell global + varredura leve** (aplicada globalmente; sem reescrever telas) |
| 4 | Abas da Escala no celular | **Chips que quebram em 2 linhas** (tudo visível, sem scroll horizontal) |

Os 5 itens mapeiam direto pras páginas existentes do professor:
`Início→home` · `Minha Agenda→minha-agenda` · `Escala→escala-smart` · `Placar→engaj-placar` · `Pagamentos→meus-pagamentos`. (Todas em `PROF_PAGES.professor`.)

## Arquitetura / Componentes

### 1. Barra inferior (nova) — mobile + professor

- **Modelo puro novo** em `professores-nav.js`: `ProfNav.buildBottomNavModel(profiles)` → retorna a lista ordenada dos 5 itens `{ id, label, icon }` **só quando o papel é professor** (professor / professor_estagiario) e **não é gestão** (`isManagement` falso). Gestão → retorna `[]` (barra não aparece). Os `label` são as **formas curtas** pra caber na barra (o destino real está entre parênteses): `Início` (home), `Agenda` (minha-agenda), `Escala` (escala-smart), `Placar` (engaj-placar), `Pagar` (meus-pagamentos). Não há conflito com "Agenda Geral" — essa fica só no ☰. Ícones = os emojis já usados em `PAGE_DEFINITIONS`.
- **Render** em `professores.js`: monta `<nav class="bottom-nav">` com os itens do modelo; cada item chama `navigateTo(id)`. Renderiza uma vez após o login (junto do render da sidebar).
- **Item ativo:** reaproveita `AppState.currentPage`. O `navigateTo` já limpa/aplica `.active` na sidebar (linha ~452); estende-se pra também sincronizar `.bottom-nav-item.active`. Se a rota atual não é um dos 5 (ex.: Férias, aberta pelo ☰), nenhum item fica aceso — comportamento aceitável.
- **CSS** (`professores.html`, `@media ≤768px`): barra fixa no rodapé (`position: fixed; bottom: 0`), 5 colunas iguais, ícone (emoji, consistente com o app) + label ~9–10px, ativo em `--orange`. Respeita `padding-bottom: env(safe-area-inset-bottom)` (barra de gestos do iPhone). Escondida por padrão (desktop) — só `display:flex` sob o breakpoint.

### 2. Cabeçalho compacto fixo — mobile

- No mobile, o topo vira uma faixa slim fixa: **☰** (esquerda, abre o drawer com a lista completa: Agenda Geral, Férias, Meu Saldo) + **título da página atual** (label de `PAGE_DEFINITIONS` pela `AppState.currentPage`) + **🔔 sino** (direita, com o contador de não-lidas).
- **Por que o sino sobe:** hoje o sino mora no rodapé da sidebar; com o drawer fechado o professor não vê notificação — e a Frente 3 depende disso (convite/lembrete de evento). No mobile o sino passa a viver no cabeçalho. No desktop segue onde está.
- Reaproveita o markup/handler de sino já existentes (badge de contagem, `handleNotifClick`), só reposiciona via CSS no mobile e injeta o gatilho no cabeçalho.

### 3. Varredura leve global — mobile (`@media ≤768px`)

- **Espaço pra barra:** `.page` ganha `padding-bottom` = altura da barra + safe-area, pra nada ficar coberto.
- **Toques ≥ ~44px:** itens de nav, chips de aba e botões de ação (ex.: Vou/Não vou) com altura mínima confortável.
- **Tiras de abas → chips que quebram:** a barra de abas da Escala (`Sábados/Feriados/Eventos/Fim de ano/Escola Interna`) vira `flex-wrap: wrap` com estilo de pílula (ativa em laranja), em vez de overflow horizontal. Demais tiras/filtros do professor que já quebram seguem iguais.
- **Densidade do topo:** títulos em fonte display (ex.: "ESCALA — MINHAS DATAS") e paddings do topo reduzidos no celular pra sobrar tela pro conteúdo.
- **Safe-area insets** aplicados no rodapé (barra) e, se necessário, laterais.

## Modelo de dados (o único com lógica testável)

`buildBottomNavModel(profiles)`:
- professor / professor_estagiario, sem papel de gestão → `[{home},{minha-agenda},{escala-smart},{engaj-placar},{meus-pagamentos}]` nessa ordem, com labels curtos.
- inclui algum papel de gestão (admin/supervisão) → `[]`.
- vazio/desconhecido → `[]`.

Puro (sem DOM), no `professores-nav.js`, testado por smoke Node (`window.ProfNav`/`require`).

## Arquivos tocados

| Arquivo | O quê | Ação |
|---------|-------|------|
| `professores-nav.js` | `buildBottomNavModel(profiles)` (puro) | modificar |
| `scripts/smoke-sidebar.js` (smoke de nav já existente) | asserções do `buildBottomNavModel` | estender |
| `professores.js` | render da barra inferior + sino no cabeçalho + sync do ativo no `navigateTo` | modificar |
| `professores.html` | markup do cabeçalho/barra + CSS mobile (barra, cabeçalho, chips, toques, safe-area) | modificar |

## Verificação

- **Smoke Node** do `buildBottomNavModel` (professor → 5 itens na ordem; estagiário → idem; admin/superv → `[]`).
- **Parse** dos arquivos alterados.
- **Prints reais mobile antes/depois** no preview (375px), logando como `professor.teste@`: Início, Escala→Eventos (chips + RSVP), Minha Agenda, Pagamentos — barra inferior visível, sino no topo, abas em chips, item ativo correto ao navegar. E um check rápido de que **admin/superv NÃO ganham a barra** e o **desktop segue idêntico**.

## Riscos / Observações

- **Regra inviolável §1 do CLAUDE.md:** `professores.html` é do módulo (não é produção do Comissões) — pode ser alterado; mas mudanças cirúrgicas e sob o breakpoint mobile pra não afetar o desktop nem o Comissões.
- `position: fixed` da barra + teclado virtual: em telas com input (poucas na visão do professor) a barra pode sobrepor; aceitável nesta passada (sem inputs longos nas telas principais do professor).
- Eventos antigos e demais telas seguem funcionando — mudança é de shell/CSS, não de dados.
