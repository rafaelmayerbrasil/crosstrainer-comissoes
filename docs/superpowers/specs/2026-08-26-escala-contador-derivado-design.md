# Escala Inteligente — o contador passa a ser contado (e mais 5 pedidos do Rodrigo)

**Data:** 26/08/2026
**Origem:** resposta do Rodrigo no grupo em 25/08/2026, depois de testar os 7 ajustes que
subiram no mesmo dia.
**Decisões:** Rafael, 26/08/2026.
**Estado do código:** `main` atualizado para `4c0adf4` (a pasta estava 50 commits atrás; os
textos da Pacto foram devolvidos por cima, e a sessão da Pacto virou **56**).

---

## 1. O problema, medido no banco de produção

Antes de escrever qualquer linha, li `special_scales` e `fairness_counter` de produção.
O Rodrigo está certo, e é pior do que ele viu:

| Pessoa | Contador diz | Escalas de verdade |
|---|---|---|
| **KARIN** | **1** | **3 sábados** — 05/09, 19/09, 17/10 |
| BRUNO CLAUDINO | 3 | 2 sábados + **4 feriados** |
| BRUNO OTHERO | 2 | 1 sábado + 4 feriados |
| HELOÍSA | 3 | 4 sábados |
| EDUARDA | 4 | 1 sábado + 1 feriado |
| ALAN | 3 | 2 sábados |
| JOÃO VITOR | 4 | 3 sábados + 2 feriados |
| LOUISE | 3 | 2 sábados |
| VAGNER | 2 | 1 sábado + 2 feriados |

**9 das 16 pessoas com o contador errado.**

### Por que erra

`fairness_counter/{personId}.diasTrabalhados` é um número guardado à parte, e só se mexe:

- na **primeira** consolidação de cada data (`consolidate` → `applyFairnessDelta`, protegido
  pelo `jaConsolidada`); e
- na troca manual de uma vaga (`reassignSlot`), e mesmo assim só se `fairnessApplied === true`.

Quando a gestão **remonta a prévia** ou **reconsolida** — que é o fluxo normal desde 24/08 — as
pessoas trocam de data e **o contador não é refeito**. Ele congela no resultado da primeira
montagem.

### O agravante: não é só tela

Esse número é **o insumo central do motor** (`diasTrabalhados`, no comparador). A Karin ficou
com 3 sábados justamente porque o contador dela estava travado em 1: o motor a via como a mais
atrasada e continuou dando dias pra ela. **O contador errado torceu a escala de setembro e
outubro, que já está publicada e já foi avisada por e-mail.**

E é um contador só para sábado e feriado — daí o pedido 4 do Rodrigo.

---

## 2. Os 8 pedidos e o veredito

| # | Pedido do Rodrigo | Veredito |
|---|---|---|
| 1 | Filtro por professor: onde e quando está escalado | Não existe. Tela nova. |
| 2 | O contador conta errado | Bug confirmado no dado. Causa acima. |
| 3 | Contador só da janela + relatório separado do ano | Hoje é um número só, cumulativo, sem período. |
| 4 | Feriados somando sábados | Confirmado: é o **mesmo** contador. A coluna se chama "Sábados" até na aba Feriados. |
| 5 | Quem pegou o sábado vizinho ao feriado não pega o feriado | A regra existe, mas só liga sábado com sábado (±7 dias). |
| 6 | Inverter entre unidades, não só dentro | `swapSlots` **já aceita qualquer par** do mesmo dia. Quem limita é a tela. |
| 7 | Só avisar depois de fechar e publicar | O **e-mail já está certo** (só `scale_confirmed`, só no publicar). O vazamento é a **prévia**, que deixa o professor ver no app antes. |
| 8 | Histórico do ano ao abrir a próxima janela | Não existe. |

---

## 3. Decisões tomadas (Rafael, 26/08)

1. **Contagem derivada das escalas** — não remendar o contador.
2. **O painel mostra a janela; o motor decide pelo ano.** Zerar de verdade nos dois faria o
   rodízio perder a memória: na 1ª data de cada janela todo mundo empata em zero e o desempate
   volta a ser o mérito, que é fixo — exatamente o defeito que quebrou agosto.
3. **Refaz setembro/outubro** e avisa o time de novo.
4. **A regra 5 vale como preferência forte**, que cede se não sobrar mais ninguém — igual às
   outras.
5. **Aba "Por pessoa"** dentro da Escala Inteligente.
6. **Mantém o ✏️** de correção manual, agora como *ajuste de partida*.
7. **Um mecanismo só** para inverter.

---

## 4. Desenho

### Peça 1 — O contador vira contagem

Função **pura** nova em `scale-service.js`, junto das outras puras (`personsOnAdjacentSaturday`,
`buildConsolidationMatrix`):

```js
/** @returns {Object<string, number>} personId → quantas vagas */
contarPorPessoa(scales, { tipos, batchId, de, ate, excluirDatas })
```

Conta as vagas atribuídas nas escalas que casam com o filtro. Sem I/O e sem Firestore — recebe a
lista que a tela já carregou (`ScaleService.listScales()` traz todas).

**O ajuste de partida** (`fairness_counter/{personId}.ajuste`, default 0) serve para lançar
agosto, que aconteceu pela grade antiga e não existe em `special_scales`. O ✏️ do painel passa a
escrever nesse campo. Ele entra **no número do ano e no motor**, e **nunca no número da janela** —
a janela é o que aconteceu nela, e ponto. Onde entra, aparece separado (`3 dias · 2 + 1 de
ajuste`) para ninguém confundir o contado com o lançado.

`diasTrabalhados` e `divida` do documento **saem de uso**. A dívida nunca foi incrementada por
nada no sistema — é código morto desde a origem.

**Onde a contagem entra:**

| Lugar | Filtro |
|---|---|
| Painel "Equilíbrio" | `batchId` da janela aberta, com o número do ano ao lado |
| Tabela "por quê?" | mesmo tipo da escala sendo montada |
| **Motor** (`diasTrabalhados`) | ano corrente, mesmo tipo, **+ ajuste** |
| Aba "Por pessoa" | ano, quebrado por tipo |

### Peça 2 — Sábado e feriado contam separado

A contagem filtra pelo `tipo` do documento. Montando um sábado, o motor olha sábados; montando
um feriado, olha feriados.

**Premissa:** sábado que é feriado conta em **Feriados** (o tipo do documento) e **continua
valendo como sábado** para a regra do descanso — que é o comportamento de hoje e a razão de a
regra ter nascido.

### Peça 3 — Janela × ano

- Painel do topo: **"Equilíbrio da janela aberta"**, com o número do ano ao lado de cada nome.
- Sem janela aberta, mostra a última fechada, dizendo qual é.
- Zerar por janela sai de graça: janela nova não tem ninguém escalado, começa em zero sozinha.
- **Relatório do ano** (pedido 8) aparece na aba "Por pessoa" **e** no modal de abrir janela —
  é o momento em que a gestão precisa dele.

### Peça 4 — Descanso perto do feriado

`personsOnAdjacentSaturday` vira `personsOnNearbyScale(scales, dateISO, dias = 7)`: quem já está
escalado em **qualquer** escala de tipo `sabado`/`feriado` a até 7 dias da data vai pro fim da
fila.

Cobre o pedido sem inventar regra nova: 07/09 é segunda, e os sábados 05/09 e 12/09 estão a 2 e
5 dias; 12/10 é segunda, com 10/10 e 17/10 a 2 e 5 dias. Entre sábados, o ±7 dá exatamente o
sábado anterior e o seguinte — o comportamento de hoje, preservado.

Continua **teto macio**: ordena pro fim da fila, não exclui. Vaga aberta vira aula que não
existe.

Escola Interna, evento e fim de ano seguem de fora.

### Peça 5 — Inverter qualquer par do dia

O serviço já faz. Muda só a tela: cada vaga ganha **"⇄ Inverter com…"**, listando as outras
vagas do dia como `PP · Hiit · Fulano`, mesma unidade primeiro. O botão de 1 clique do par
TOI/Hiit **sai** — um mecanismo só.

Quando a pessoa que vai receber a vaga não é habilitada na modalidade, a opção aparece num grupo
"Não habilitados nesta modalidade", como já acontece no seletor de troca.

Escala publicada republica na agenda, como hoje.

### Peça 6 — Nada aparece antes de publicar

Na tela do professor (`renderProfSabadosFeriados`), o gate passa de `status === 'consolidada'`
para **`published === true`**. Entre a prévia e a publicação ele lê *"A gestão está montando a
escala"* em vez de *"✓ Você está escalado"*.

Efeito colateral desejado: os feriados 02/11 e 20/11, hoje consolidados e **não publicados**,
somem da vista do time até a gestão publicar.

O e-mail não muda — já só sai no publicar.

### Peça 7 — Aba "Por pessoa"

Aba nova na Escala Inteligente (gestão). Escolhe a pessoa e vê:

- as datas dela: data, tipo, unidade, modalidade e **publicada ou não**;
- os contadores: janela aberta e ano, sábados e feriados separados;
- o ajuste de partida, se houver.

Com filtro de ano, ordenado por data.

### Peça 8 — Refazer setembro/outubro

**Pela tela, não por script** — o caminho da prévia já existe, já foi homologado e já manda o
aviso certo.

1. Botão **"Refazer a janela"** na barra do lote, com confirmação explicando que a escala já foi
   avisada e que o time será avisado de novo.
2. Remonta **todas** as datas do lote ignorando as atribuições antigas **daquele lote**
   (`excluirDatas`) — senão a escala velha inflaria o contador e empurraria as pessoas erradas.
   O contador do ano fora do lote continua valendo, e vai somando data a data conforme monta —
   o mesmo mecanismo que a cota já usa no `jaNoLoteById`.
3. Prévia normal: a gestão confere e ajusta na mão se quiser.
4. **"Publicar e avisar"** republica na agenda e manda o aviso com texto de *remontagem*,
   deixando claro que a escala **mudou** e que o dia anterior não vale mais.

Alcance: as 9 datas de sábado do lote `batch_1786921932940` e os 2 feriados publicados do
`batch_1786921982328` (07/09 e 12/10). Os avulsos 02/11 e 20/11 (consolidados, não publicados)
são reconsolidados individualmente pelo botão que já existe.

⚠️ Todas as datas são futuras — a mais próxima é 05/09 —, então a regra de operação de 25/08
(*reconsolidar só sábado que ainda não aconteceu*) está respeitada.

---

## 5. O que não muda

- `scale-engine.js`: o comparador fica como está. Só muda **de onde vem** o `diasTrabalhados`.
- Cota por pessoa, férias, sábado-feriado pagando em dobro, marca "não recebe por aula".
- Fluxo da janela: abrir → candidatar → fechar → prévia → publicar.
- E-mail: tipos e gatilho.
- Escola Interna, eventos e fim de ano.

---

## 6. Testes

**Puros — sem navegador e sem Firebase:**

- `contarPorPessoa`: filtro por tipo, por lote, por período e com `excluirDatas`; vaga vazia não
  conta; escala de outro tipo não vaza.
- `personsOnNearbyScale`: sábado com sábado a ±7 (o comportamento antigo, preservado); feriado
  de segunda pegando os dois sábados; escala a 8 dias **não** pega; evento e Escola Interna
  fora.
- Motor com a contagem derivada: quem tem menos no ano vem antes; o ajuste de partida entra na
  conta; empate cai no mérito.

**Regressão obrigatória:** `smoke-scale-service.js`, `smoke-trocar-pessoa-escala.js` e
`smoke-ajustes-escala-2508.js` afirmam sobre `getFairness`/`saveFairness` e precisam ser
reescritos junto — não podem ficar verdes por acidente.

**No staging, com o app aberto:** remontar um lote duas vezes e conferir que o contador dá o
mesmo número nas duas; inverter duas vagas de unidades diferentes; abrir a tela do professor
antes e depois de publicar.

> A homologação de 25/08 pegou um bug que 12 verificações automatizadas não pegaram — o estado
> de publicação lido da memória do navegador. Rodar o app não é opcional.

---

## 7. Riscos

| Risco | Tratamento |
|---|---|
| **O time já foi avisado das datas de set/out, e elas vão mudar** | Decisão do Rafael. Aviso de remontagem com texto explícito de que a escala mudou. |
| Contar a cada render ficar lento | As escalas já estão todas em memória (`listScales`). São dezenas de documentos, não milhares. |
| O ✏️ virar porta dos fundos | Todo ajuste continua no `audit_log`, como já está, e aparece separado no painel. |
| Mais gente bloqueada pela regra dos 7 dias → vaga aberta | Teto macio: ordena, não exclui. Coberto por teste. |
| Republicar escala apaga e recria a aula | Só datas futuras; `publishToAgenda` já recusa mês fechado. |

---

## 8. Ordem de entrega

1. `contarPorPessoa` + `personsOnNearbyScale` — puros, com teste. Nada muda na tela ainda.
2. O motor passa a ler a contagem; smokes de regressão reescritos.
3. Painel de equilíbrio: janela + ano, sábado e feriado separados, ✏️ vira ajuste.
4. Gate do professor (`published`).
5. Inverter com qualquer vaga do dia.
6. Aba "Por pessoa" + histórico do ano no modal de abrir janela.
7. Homologação no staging, com o app aberto.
8. Produção e, por último, **refazer a janela de set/out e avisar o time**.
