# Design — PLR (Participação nos Lucros e Resultados) — substitui a planilha de avaliação

> **Data:** 2026-06-27 · **Status:** design (modo autônomo /loop — aguarda revisão async)
> **Origem:** respostas do Rodrigo (`docs/rodrigo-engajamento-escala-COMPLETO-respostas.txt` + `docs/perguntas-rodrigo-plr-followup.txt`).
> **Memória:** `novo-modulo-engajamento-pontos`. Planilha de referência: `Avaliação de Desempenho_mai2026_PP.xlsx`.

## 1. O que é

Submódulo que **substitui a planilha** de avaliação de desempenho: avaliadores lançam notas por bloco, o sistema calcula a **nota final** de cada colaborador e **rateia o pool** do PLR. 2×/ano (padrão jun/nov, datas configuráveis). Dado sensível (valores) → acesso restrito.

## 2. Decisões do Rodrigo (já fechadas) → tudo CONFIGURÁVEL

| Tema | Decisão |
|------|---------|
| Fórmula do rateio | `fatia = pool × (horas × nota) / Σ(horas × nota)` de todos os elegíveis |
| Horas | "horas do fechamento" = `monthly_closings.teachers[].totalHoras` somadas nos meses do ciclo |
| Blocos da nota | Profissional · Comportamental · Técnica · **Engajamento (bloco próprio)** · ~~Alunos~~ (fora desta rodada) |
| Pesos dos blocos | **CONFIGURÁVEIS no sistema** (somam 100). Peso de Alunos se redistribui nos demais nesta rodada |
| Engajamento | vem **automático do placar** (`EngagementService.scoreboard`), normalizado p/ 0–10 |
| Avaliadores | média **ponderada**; pesos **configuráveis**, default Coordenador Técnico = 2, Head Coach = 2, demais = 1 |
| Elegibilidade | **configurável**: default mín. **3 meses** de casa · saldo de pontos mínimo **desligado** · **estagiário entra** |
| Pool | a gestão **digita** por rodada |
| Ciclos | 2×/ano, datas configuráveis (padrão jun/nov) |

## 3. Modelo de dados (coleções novas)

### 3.1 `plr_config` (doc `default`, admin)
```
{
  blocos: [
    { id:'profissional',  label:'Profissional',  peso:30 },
    { id:'comportamental',label:'Comportamental', peso:30 },
    { id:'tecnica',       label:'Técnica',        peso:20 },
    { id:'engajamento',   label:'Engajamento',    peso:20, auto:true },   // auto = vem do placar
    // 'alunos' fica fora nesta rodada; quando entrar (Pacto), some-se aqui
  ],
  avaliadoresPeso: { '<uidCoordTecnico>': 2, '<uidHeadCoach>': 2 },        // ausentes = peso 1
  elegibilidade: { minMesesCasa:3, minSaldoPontos:null, estagiarioEntra:true },
  engajamentoNorm: 'proporcional_max',   // 10 × placar/placarMax do ciclo
  externalId: ''
}
```
> Pesos default (30/30/20/20) são chute inicial; a gestão ajusta na tela de config (Rodrigo não fixou %).

### 3.2 `plr_cycles`
`{ id, label, inicio, fim, pool, status, createdAt, externalId }` — `status` ∈ {aberto, fechado}. Datas do semestre (default jun–nov / dez–mai). `pool` digitado pela gestão.

### 3.3 `plr_evaluations`
`{ id:'${cycleId}__${evaluateeId}__${evaluatorId}', cycleId, evaluateeId, evaluatorId, notas:{ profissional, comportamental, tecnica }, parecer, createdAt, updatedAt }`
- 1 doc por (avaliado × avaliador). Notas 0–10 nos blocos **não-auto**. Idempotente por id.
- O peso do avaliador NÃO é gravado aqui — é lido do `plr_config.avaliadoresPeso` no cálculo (assim mudar o peso recalcula).

### 3.4 `plr_results` (snapshot ao fechar o ciclo — opcional p/ histórico)
`{ id:cycleId, geradoEm, pool, linhas:[{ pessoaId, horas, nota, fatia }], total }`. Enquanto aberto, o resultado é calculado on-the-fly.

## 4. `plr-engine.js` (puro, Node-testável)

- `blocoNotaPonderada(evaluations, blocoId, avaliadoresPeso)` → média ponderada das notas do bloco entre avaliadores (peso do config; default 1).
- `normalizarEngajamento(placar, placarMax)` → `placarMax>0 ? 10*placar/placarMax : 0`.
- `notaFinal(evaluateeId, evaluations, engajPts, engajMax, config)` →
  - p/ cada bloco não-auto: `blocoNotaPonderada`; bloco `engajamento`: `normalizarEngajamento`.
  - **redistribui** o peso de blocos ausentes (ex.: alunos fora) proporcionalmente aos presentes → soma de pesos efetiva = 100.
  - `nota = Σ blocoNota × pesoEfetivo/100` (0–10).
- `elegivel(pessoa, config, refDate)` → `mesesCasa>=minMesesCasa` && (`estagiarioEntra` || type!=='estagiario'/'professor_estagiario') && (`minSaldoPontos==null` || saldo>=min).
- `distribuir(pool, pessoas)` onde `pessoas=[{id,horas,nota}]` → `denom=Σ horas*nota`; `fatia = denom>0 ? pool*(horas*nota)/denom : 0`. Arredonda p/ centavo; ajusta resíduo no maior.

## 5. `plr-service.js` (persistência + orquestração, injetável)

- `ConfigService.get/save` (`plr_config/default`, default embutido).
- `cycles`: list/get/save/close.
- `evaluations`: upsert (idempotente), listByCycle, listByEvaluatee.
- `computeResults(cycleId, ctx, deps)`:
  1. carrega config + ciclo + avaliações do ciclo.
  2. `ctx` traz: pessoas (com type, hireDate), `horasById` (somadas dos closings do período), `engajById` (placar do ciclo via scoreboard) → `engajMax`.
  3. filtra elegíveis; `notaFinal` por pessoa; `distribuir(pool, elegíveis)`.
  4. retorna linhas {pessoa, horas, nota, fatia, elegivel, motivoInelegivel}.
- `closeCycle(cycleId)` → grava `plr_results` snapshot + `status='fechado'`.

## 6. `professores-plr.js` (UI) — 3 telas

- **Config (admin):** pesos dos blocos (somam 100, valida) · pesos de avaliadores (marca Coord Técnico/Head Coach por pessoa) · elegibilidade (mín meses, saldo, estagiário).
- **Avaliação (avaliador):** escolhe colaborador → lança notas Profissional/Comportamental/Técnica (0–10) + parecer. Engajamento NÃO se digita (mostra a nota automática do placar). Salva → `plr_evaluations`.
- **Resultado (gestão):** escolhe ciclo, digita/edita `pool` → tabela: pessoa · horas (semestre) · nota final · fatia R$ · total = pool. Botão "Fechar ciclo" (snapshot, irreversível como `monthly_closings`).

## 7. Integrações

- **Engajamento:** `EngagementService.scoreboard(personId, hireISO, cycle)` → `total` = placar (vira nota normalizada). O ciclo do PLR pode reusar o `point_cycle` alinhado (datas).
- **Fechamento:** horas do semestre = Σ `monthly_closings.teachers[].totalHoras` dos meses do ciclo (todas as unidades). São as horas **pagas** (já com peso de data aplicado) — bate com "horas do fechamento" do Rodrigo.
- **Pessoas:** `type` (estagiário), `hireDate` (meses de casa).

## 8. Segurança (rules) — dado sensível

- `plr_config`, `plr_cycles`, `plr_results`: **read+write admin** (valores são sensíveis, como `teacher_salaries`). Leitura ampla NÃO.
- `plr_evaluations`: `create/update` pelo **próprio avaliador** (`evaluatorId == auth.uid`) **ou** admin; `read` admin (notas individuais são sensíveis). Sem delete.
- (Quem pode avaliar = quem a gestão definir; v1 = admin + os avaliadores marcados. Refino de papel de "avaliador" fica p/ depois — v1 admin lança/edita tudo, suficiente p/ substituir a planilha.)

## 9. Plano de testes

- **Engine (smoke Node):** média ponderada (Coord peso 2 puxa); normalização engajamento; redistribuição de peso quando bloco ausente; `notaFinal` 0–10; `distribuir` proporcional a horas×nota, Σ=0 → 0, soma das fatias = pool (resíduo no maior); elegibilidade (3 meses, estagiário, saldo).
- **Service (fake-firestore):** config default + save; upsert idempotente de avaliação; computeResults ponta a ponta com ctx fake.
- **Staging:** config pesos → lançar avaliações de 2 avaliadores (1 com peso 2) → conferir nota → digitar pool → conferir rateio soma = pool → fechar ciclo.

## 10. Fora de escopo (futuro)

- Nota dos alunos (vem da Pacto) — `blocos` ganha 'alunos' quando existir; já há a redistribuição.
- Papel formal de "avaliador" com permissão própria (v1 = admin).
- Recibo/PDF do PLR (reusar padrão de `ReceiptService` depois).

## 11. Ordem de build

1. `plr-engine.js` + smoke (núcleo puro).
2. `plr-service.js` + smoke (persistência/orquestração).
3. Rules + deploy/validação staging.
4. UI Config → Avaliação → Resultado.
5. E2E staging + deploy hosting.
