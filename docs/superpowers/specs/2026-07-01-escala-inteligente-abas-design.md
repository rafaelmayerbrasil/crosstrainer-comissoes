# Design — Escala Inteligente em 4 abas (Sábados · Feriados · Eventos · Fim de ano)

> **Data:** 2026-07-01 · **Status:** design aprovado em brainstorm com o usuário
> **Origem:** feedback do Rodrigo (01/07, print anotado da tela Escala Inteligente no staging).
> **Memória:** `novo-modulo-engajamento-pontos`.

## 1. O que é

Reorganização da tela **Escala Inteligente** (`professores-escala-smart.js`) em **4 abas**, conforme rabisco do Rodrigo:

1. **Sábados** — apresenta **todos os sábados do ano** com o status da escala de cada um
2. **Feriados** — a gestão **aponta** quais feriados terão escala (sugestão automática + manual)
3. **Eventos** — reuniões, treinamentos, campeonatos, com etiqueta **Interno/Externo**
4. **Fim de ano** — período de horário reduzido por turnos (reusa o fluxo já construído)

Aproveita a tipagem que **já existe** nos docs (`tipo`: `sabado`/`feriado`/`domingo_especial`/`evento`/`fim_de_ano`). O detalhe da escala (slots, preferências, consolidação justiça+mérito, publicar na agenda) **não muda** — é compartilhado pelas 4 abas. A visão do professor (marcar preferência) **não muda**.

## 2. Decisões fechadas com o usuário (01/07)

| Tema | Decisão |
|------|---------|
| Tela legada "Escalas Especiais" | **Sai do menu** (admin/supervisão) em `professores-nav.js`; código e dados intactos (a CF de geração de aulas segue lendo `scaleTypeId` p/ peso). **Migração dos docs antigos = depois** (tech debt) |
| Docs formato antigo na lista | A Escala Inteligente **filtra** docs sem `tipo` ou com `date` não-string (mata os cards quebrados "fds"/`Timestamp(...)`/`undefined` do print) |
| Aba Sábados | **Lista virtual + doc sob demanda**: todos os sábados do ano por cálculo (nada gravado); clicar num sábado sem escala cria o doc na hora |
| Aba Feriados | **BrasilAPI sugere + gestão confirma**: nacionais do ano listados; "criar escala" por linha; "+ Data especial" p/ municipal/estadual e domingo especial |
| Aba Eventos | **Escala de evento simples**: mesmo motor dos sábados + etiqueta `eventKind` interno/externo. Ponto de presença continua SÓ na Chamada do Engajamento (sem acoplar) |
| Arquitetura | **Abas client-side na mesma rota** (`EscalaSmartState.tab`), sem novos itens de menu |

## 3. UI — estrutura da tela (gestão)

```
🗓️ Escala Inteligente
[painel de equilíbrio do ciclo]            ← global, acima das abas (como hoje)
[ Sábados | Feriados | Eventos | Fim de ano ]
─────────────────────────────────────────────
<conteúdo da aba> + <detalhe da escala selecionada>   ← layout 2 colunas mantido
```

- `EscalaSmartState.tab` (`'sabado' | 'feriado' | 'evento' | 'fim_de_ano'`), default `'sabado'`.
- O botão global "+ Nova escala" **sai**; cada aba tem a própria ação contextual (§4).
- O painel de detalhe à direita (renderEscalaDetail / renderFimDeAnoDetail) permanece idêntico.
- Selecionar escala continua via `selectEscala(id)`; trocar de aba limpa `selectedId`.
- **Professor**: `renderEscalaPrefs()` inalterada (lista as janelas abertas, marca Prefiro/Pode ser/Não posso).

## 4. Comportamento por aba

### 4.1 Sábados
- Seletor de **ano** (default ano corrente; permite próximo ano).
- Helper puro `saturdaysOfYear(year)` → array de ISO dates (cálculo local, nada gravado).
- Merge por data com os docs `tipo='sabado'` existentes → cada linha mostra:
  - **Com doc:** nome + status atual (Rascunho / Janela aberta / Consolidada; + "Publicada" quando `publishedAt`).
  - **Sem doc:** "Sem escala — clique pra criar".
- Clique numa linha sem doc → `criarEscala`-equivalente com `tipo='sabado'`, slots do template atual (1 TOI + 1 Hiit por unidade), status rascunho, e abre o detalhe.
- Contador no topo: "52 sábados · N com escala".

### 4.2 Feriados
- **Fonte automática:** fetch client-side `https://brasilapi.com.br/api/feriados/v1/{ano}`;
  **fallback 1:** doc `meta/holidays_cache_{ano}` (a CF do Sprint 5a já mantém esse cache);
  **fallback 2:** lista vazia + aviso "não foi possível carregar; adicione manualmente".
- Merge por data com docs `tipo='feriado'` e `tipo='domingo_especial'`:
  - Feriado da API **sem** doc → linha com botão **"Criar escala"** (cria doc `tipo='feriado'`, nome do feriado, slots template).
  - Doc existente (API ou manual) → linha com status; clique abre o detalhe.
- **"+ Data especial"** (modal): nome + data + tipo (`feriado` p/ municipal/estadual · `domingo_especial`). Cria o doc direto (apontar = criar a escala em rascunho). Docs manuais aparecem marcados "(manual)".
- Ordena por data; seletor de ano compartilhado com a aba Sábados.

### 4.3 Eventos
- Lista docs `tipo='evento'` (todos os anos ou filtrado pelo ano do seletor — filtrado, p/ consistência).
- **"+ Novo evento"** (modal): nome + data + classificação **Interno/Externo** → campo novo `eventKind: 'interno'|'externo'` no doc (só etiqueta visual, badge na lista; sem efeito no motor).
- Slots, preferências, consolidação e publicação idênticos aos sábados.
- Nota informativa na aba: presença/ponto de reunião e treinamento continuam sendo lançados na **Chamada do Engajamento**.

### 4.4 Fim de ano
- Lista docs `tipo='fim_de_ano'`.
- **"+ Configurar período"** abre o modal atual **direto no modo fim de ano** (período + unidades + turnos com horários editáveis + toggle 24/12; fechado 25/12, 31/12, 01/01) — o `select` de tipo do modal antigo morre junto com o botão global.
- Detalhe por dia×turno (`renderFimDeAnoDetail`) e `consolidateByDay`/`publishToAgenda` inalterados.
- **Anotação p/ o Rodrigo:** turnos default hoje são "Manhã" e "Tarde/Noite"; ele falou "matutino e vespertino" — nomes são editáveis por escala, confirmar se quer trocar o default.

## 5. Dados e regras

- **Nenhuma coleção nova.** `special_scales` ganha o campo opcional `eventKind` (só em `tipo='evento'`).
- **Filtro de formato antigo** em `listScales`/na UI: ignora doc sem `tipo` string ou com `date` que não seja string ISO `YYYY-MM-DD`.
- **Rules:** adicionar leitura de `meta/holidays_cache_*` p/ usuários autenticados do módulo (hoje só a CF escreve via Admin SDK; sem rule de read o fallback 1 não funciona). Escrita continua bloqueada no cliente.
- **Nav:** remover `'escalas'` dos arrays `admin` e `supervisao` em `professores-nav.js` (item "Escalas Especiais" some do menu; página/rotas/código permanecem p/ rollback fácil).

## 6. Fora de escopo (registrado, não bloqueia)

1. **Migração dos docs legados** de `special_scales` (formato Timestamp/sem tipo) → tech debt; a tela nova só filtra.
2. Integração evento → chamada do Engajamento (escalado vira presença esperada) — avaliar depois que o fluxo de pontos estiver validado pelo Rodrigo.
3. Renomear turnos default p/ Matutino/Vespertino — confirmar com o Rodrigo (hoje editável por escala).
4. Peso da data no pagamento (inconsistência §15.5 × `professores-shared.js`) — segue como pendência própria, fora desta feature.

## 7. Testes

- **Smoke Node (padrão do projeto):** helpers puros extraídos e testados sem Firestore:
  - `saturdaysOfYear(year)` — conta certa (52/53), tudo sábado, ISO válido;
  - `mergeVirtualWithDocs(virtualDates, docs)` — status certo com/sem doc, doc duplicado na mesma data não quebra;
  - `parseFeriados(json)` — shape da BrasilAPI → `{date, name}`; entrada inválida → lista vazia;
  - filtro de formato antigo — doc legado (date Timestamp, sem tipo) é excluído, doc novo passa.
- **E2E no staging (manual, roteiro):** cada aba renderiza; criar sábado sob demanda; criar feriado da API + manual; criar evento interno/externo; fim de ano via aba; card legado sumiu; professor segue vendo preferências; console limpo.
