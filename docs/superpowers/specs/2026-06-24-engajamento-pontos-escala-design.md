# Design — Engajamento: Motor de Pontos + Escala Inteligente

> **Data:** 2026-06-24 · **Status:** aprovado (design) · **Origem:** feedback do Rodrigo (23/06/2026),
> respostas em `docs/respostas-rodrigo-agenda-escalas.md`. Memória: `novo-modulo-engajamento-pontos`.

## 1. Visão geral

Novo submódulo do Professores que transforma engajamento da equipe em **pontos**, e usa esses pontos
para (a) priorizar a **escala inteligente** de sábados/feriados/eventos e (b) alimentar o **PLR** (fase
posterior). Hoje "Escalas Especiais" (`professores-escalas.js`) é só uma etiqueta de peso que multiplica
horas no pagamento — este design substitui essa visão limitada pelo motor completo já previsto na seção 15
da `Proposta_Funcional_Consolidada_Modulo_Professores_CrossTainer_V3.md` (especificada, nunca construída),
estendida com a camada de mérito/pontos que o Rodrigo pediu.

**Princípio central confirmado com o cliente:** reunião, treinamento, escola interna, proatividade em
substituir e eventos são **um placar de pontos só**, consumido em dois lugares (escala + PLR).

## 2. Escopo e decomposição

Ordem de construção acordada: **(0)** renomear telas da agenda · **(1)** motor de pontos · **(2)** escala
inteligente · **(3)** PLR.

**Este spec cobre os itens 1 e 2.** Fora de escopo aqui:
- **Item 0 (renomear agenda):** trivial e independente — "Agenda" → "Agenda da Semana"; "Agenda Geral"
  mantém. Confirmado na resposta 1a. Vira um ajuste à parte.
- **Item 3 (PLR):** spec próprio depois. Aqui só garantimos o **contrato de dados** que o PLR vai consumir.
- **Integração Pacto:** só deixamos o modelo "preparado pra casar" (campo `externalId`). Conexão é futura
  (ver memória `pacto-decisao-rumo`).

## 3. Decisões de design (forks fechados no brainstorming)

| # | Decisão | Escolha |
|---|---------|---------|
| 2c | Mérito × justiça na escala | **Piso duro + mérito no resto**: garante o mínimo de todos primeiro; mérito decide vagas extras e empates |
| slots | Composição de vagas por data | **Template padrão ajustável**: sábado nasce 1 TOI + 1 Hiit/unidade; admin edita por data |
| 3a | Valores dos pontos | Padrões do Rodrigo, **tudo configurável**; teto nos itens diários fica para depois (default sem teto) |
| 3b | Reset do ciclo de pontos | **Configurável pelo admin** (começa alinhado ao ciclo do PLR) |
| 7a | Penalização por falta | **Desconto de pontos configurável** (sem aviso = pesado; justificada = só não ganha); cascateia p/ escala e PLR |

## 4. Modelo de dados (novas coleções)

> Todas as novas entidades ganham `externalId` (string, default vazio) para casar com a Pacto no futuro.

### 4.1 `engagement_config` (doc único, admin)
Valores-padrão (calibráveis):
- `pts.tempoCasaPorFaixa = 10` · `faixaAnos = 2` (0–2a=10, 2–4a=20, 4–6a=30…)
- `pts.escolaInternaParticipar = 1` (por dia) · `pts.escolaInternaLiderar = 2` (por dia)
- `pts.treinarComoAlunoEmOutro = 1` (por dia) · `pts.toiComoAluno = 1`
- `pts.reuniaoStaff = 8` · `pts.proatividadeSubstituicao = 3` · `pts.eventoInterno = 8`
- `pts.treinamentoObrigatorioPresenca = 8`
- `tetoMensalItensDiarios = null` (desligado; ligar depois se distorcer)
- `penalidade.treinoFaltaJustificada = 0` · `penalidade.treinoFaltaSemAviso = -15`
- `ciclo.modo = 'admin'` (datas definidas em `point_cycles`)

### 4.2 `point_cycles`
`{ id, inicio, fim, label }` — janelas de 6 meses (ajustáveis). Começam alinhadas ao PLR.

### 4.3 `point_entries` (livro-razão — fonte da verdade)
`{ id, personId, tipo, refDate, pontos, cycleId, origem, createdBy, createdAt, externalId }`
- `tipo` ∈ {escola_interna, escola_interna_lider, treino_como_aluno, toi_aluno, reuniao, evento,
  treinamento_presenca, proatividade_substituicao, penalidade_treino, ajuste_manual}
- O **placar** de uma pessoa num ciclo = `Σ pontos` das entries do ciclo **+** tempo de casa (derivado da
  data de admissão, fora do reset). Tempo de casa NÃO é entry — é calculado on-the-fly.
- `ajuste_manual` permite correção pela gestão (auditável).

### 4.4 `attendance` (chamadas que geram entries)
`{ id, kind, date, unitId, records: [{personId, status, role?}], confirmedBy, externalId }`
- `kind` ∈ {escola_interna, reuniao, treinamento_obrigatorio, evento}
- Ticar/confirmar a chamada **gera/atualiza** as `point_entries` correspondentes (idempotente por
  `attendance.id` + personId, pra reprocessar sem duplicar).
- Reunião: `status` vira ponto só quando `confirmedBy` (gestão) preenchido.

### 4.5 `special_scales` (estende o conceito atual)
`{ id, date, name, tipo, template, slots: [...], window, status, externalId }`
- `tipo` ∈ {sabado, feriado, domingo_especial, evento, fim_de_ano} (peso de data mantido p/ balanceamento)
- `slots`: `[{ unitId, requiredModalityId, assignedPersonId|null }]`
- `status` ∈ {rascunho, janela_aberta, consolidada}
- Sábado: template auto = por unidade [TOI, Hiit]. Admin edita.

### 4.6 `scale_preferences`
`{ scaleId, personId, pref }` · `pref` ∈ {quer, nao_quer, nao_posso}. `nao_posso` é restrição dura.

### 4.7 `fairness_counter` (justiça/compensação — separado dos pontos)
Derivável das `special_scales` consolidadas, mas materializado p/ performance:
`{ personId, periodo, diasTrabalhados, dividaCompensacao }`. **NÃO zera com o ciclo de pontos.**

## 5. Componentes (arquivos)

Seguindo o padrão `professores-*.js` (vanilla, sem framework):
- `professores-engajamento.js` — telas de chamada (escola interna, reunião, treinamento, eventos) + placar.
- `engagement-service.js` (ou dentro de `professores-shared.js`) — `PointsService`: lançar/recalcular
  entries, somar placar, aplicar penalidade, virar ciclo. **Puro e testável** (Node-testável como o
  `CommissionEngine`).
- `professores-escalas.js` — **reescrito** do stub atual para o motor de escala (slots, preferências,
  consolidação). Mantém compatibilidade com o que o fechamento/pagamento lê (peso de data).
- `scale-engine.js` — `ScaleEngine.consolidate(scale, candidates, prefs, fairness, scoreboard)` →
  retorna alocação. **Puro, sem DOM, Node-testável** (é o coração; precisa de testes fortes).
- `engagement-config` na tela de configurações do admin.

## 6. Algoritmo de consolidação da escala (`ScaleEngine.consolidate`)

Para cada slot de uma `special_scale`:
1. **Candidatos** = pessoas habilitadas (`modalityIds` inclui `requiredModalityId`), sem `nao_posso`, sem
   férias/afastamento na data.
2. **Piso de justiça** = candidatos que ainda não bateram o mínimo do mês **ou** têm `dividaCompensacao > 0`
   sobem ao topo. Dentro do piso, ordena por dívida desc, depois mérito.
3. **Mérito** = os demais ordenados por placar (desc). Critério de desempate segue a ordem do Rodrigo
   (tempo de casa → escola interna → reunião → proatividade → eventos) — implementável como vetor de
   desempate.
4. **Preferência** modula: `quer` puxa pra cima, `nao_quer` empurra pra baixo, dentro da faixa de mérito.
5. **Unidade alternada**: leve bônus de preferência (desempate), não filtro.
6. Atribui; atualiza `fairness_counter`; preferência não usada → crédito p/ próxima janela.

Saída auditável: por slot, quem entrou e **por quê** (piso? mérito? preferência?).

## 7. Fim de ano (caso especial)

`special_scale` com `tipo='fim_de_ano'`: template de **duplas por dia** (dia inteiro), com dias fechados
(25/12, 31/12, 01/01) e meio período (24/12) marcados como não-escaláveis/parciais. Eleição igual às
outras. **Regra de borda:** ao consolidar, quem **não foi escalado em nenhum dia** do bloco é marcado
como **férias** no módulo de Férias existente (não desconta como folga normal — é o combinado do Rodrigo).
Integração: cria solicitação/registro de férias aprovado para esses períodos.

## 8. Penalização

No registro de `attendance` de `treinamento_obrigatorio`, cada ausência gera uma `point_entry` de
`tipo=penalidade_treino`:
- `status=falta_justificada` → `penalidade.treinoFaltaJustificada` (default 0).
- `status=falta_sem_aviso` → `penalidade.treinoFaltaSemAviso` (default -15, configurável).
Como é entry no placar, cascateia automaticamente para a prioridade de escala e para o PLR.

## 9. Integrações com o que já existe

- **Modalidades** (`modalityIds` nos teachers): habilitação dos slots. Pré-requisito: TOI e
  Hiit/Marombinha precisam existir como modalidades e os professores estarem marcados.
- **Substituições** (Sprint 3b): ao aceitar cobertura de colega → dispara `proatividade_substituicao`.
- **Férias** (Sprint 6a): integração do fim de ano (não-escalado → férias) + exclusão de quem está de
  férias dos candidatos da escala.
- **Fechamento/Pagamento**: a escala consolidada vira agenda oficial (como na seção 15.8) e o peso de data
  segue alimentando horas. **Atenção à inconsistência registrada:** spec 15.5 diz que o peso é só p/
  balanceamento; o código atual usa p/ pagar. Resolver na implementação (decisão de produto: manter o uso
  financeiro atual e adicionar o peso de balanceamento como conceito separado, ou unificar).

## 10. Contrato para o PLR (fase 3)

`PointsService.scoreboard(personId, cycleId)` retorna `{ porTipo: {...}, total, horasNoCiclo }`. O PLR vai
ler: notas de "participa de reunião/treino/escola/substitui" **automáticas** desse retorno (resposta 8d).
A nota dos alunos virá do **módulo da Pacto** no futuro (resposta 8b) — campo previsto, fonte externa.

## 11. Fora de escopo / decisões adiadas

- Fórmula completa do PLR (pool ÷ horas × nota) — fase 3.
- Automatizar a escolha de quem **lidera** a escola interna (hoje manual; Rodrigo topou automatizar depois).
- Teto mensal nos itens diários (default desligado; ligar se distorcer na prática).
- Conexão real com a Pacto.

## 12. Riscos / pré-requisitos

- **Dados de habilitação:** sem `modalityIds` corretos nos professores, a escala não filtra. Validar antes.
- **Treino de 27/06/2026** acontece antes do sistema: registrar presença manual e importar como
  `attendance` depois.
- `ScaleEngine` e `PointsService` são o núcleo — exigem testes Node fortes (padrão do `CommissionEngine`).

## 13. Plano de testes (resumo)

- `PointsService`: lançamento idempotente, soma de placar, tempo de casa por faixa, virada de ciclo
  (zera tudo menos tempo de casa), penalidades.
- `ScaleEngine`: piso de justiça antes do mérito; habilitação filtra; `nao_posso` é duro; compensação
  prioriza; preferência não usada acumula; fim de ano → não-escalado vira férias.
