# Escala — rebalanceio, marco zero e log de alterações · design

> **Origem:** os 8 pedidos que o Rodrigo mandou em 28/08/2026 e as 7 respostas do Rafael no
> mesmo dia. Este documento é a especificação; o passo a passo de implementação está em
> `docs/superpowers/plans/2026-08-28-escala-rebalanceio-marco-zero-log.md`.
>
> **Estado:** decidido. Nada construído ainda.
> **Branch:** `escala-rebalanceio-log`, saindo de `main` (`e44b4a7`) — **não** de
> `comissoes-tradutor-pacto`. Comissões está esperando o Rodrigo e não pode ir junto.

---

## 0. As decisões que regem tudo

| # | Pergunta | Resposta (Rafael, 28/08/2026) |
|---|----------|-------------------------------|
| 1 | Regra do rebalanceio | Tira de quem tem **mais** dias; empate desempata pela **pontuação (mérito)**; empate de novo, **sorteia** |
| 2 | Data já publicada pode ser mexida? | **Pode.** "Por erros que podem acontecer no futuro pelos gestores" — e os **envolvidos e a gestão são avisados** |
| 3 | Setembro da Heloísa / escalas montadas | **Não mexer em nada.** Terminar as mudanças, testar, e aí eles publicam e avisam o Staff |
| 4 | Marco zero | **01/09/2026 até o fim do ano**, e tem que dar pra **zerar na virada** (ex.: 01/01/2027) → campo configurável |
| 5 | Feriados 02/11 e 20/11 | **Limpa e zera.** A janela ainda será aberta |
| 6 | Sábado 29/08 | Vai ter aula, mas **no modo antigo** (papel + grupo do Staff) — o sistema não entra nisso |
| 7 | Fim de ano | **Toda esta lógica vale para a Escala de Fim de Ano também** — as janelas serão abertas em breve |

**O que isso implica e não estava na pergunta:**

- A resposta 3 e o item 1 (zerar os ajustes lançados na mão) **não se contradizem**. Zerar o
  ajuste muda o *contador*, não muda *escala nenhuma*: nenhuma data é remontada, nenhuma aula
  sai da agenda, ninguém é reavisado. O `+3` da Heloísa some do número; o sábado dela em
  setembro fica exatamente onde está.
- A resposta 2 é uma mudança de postura: até hoje o sistema tratava "publicada" como quase
  imutável. Agora mexer é permitido, **desde que ninguém descubra sozinho** — daí o aviso
  obrigatório para quem sai, quem entra e a gestão.

---

## 1. Contagem automática — o ajuste manual acaba

**Hoje:** o painel de Equilíbrio tem um botão **"+ dias fora"** por pessoa que grava em
`fairness_counter/{personId}.ajuste`. Esse número **soma direto na fila do rodízio**
(`scale-service.js:852-864`) e no histórico do ano da tela. Foi ele que o Rodrigo usou achando
que editava o contador da janela, levando a Heloísa de 4 para 7.

**Fica:** o botão sai da tela, a função sai do código, o campo sai do motor. A contagem passa a
vir **só** das escalas, via `contarPorPessoa` — um caminho só, sem como divergir.

**O que morre:**

| Onde | O quê |
|------|-------|
| `scale-service.js` | `saveAjustePartida`, `listAjustes`, `getFairness`, e o bloco `ajustes`/`ajuste` dentro de `consolidate` |
| `professores-escala-smart.js` | `ajustarContadorJustica`, `EscalaSmartState.ajusteMap`, o botão em `renderEquilibrioPainel`, o cartão "Lançado na mão" em `renderTabPorPessoa`, a coluna homônima em `escalaHistoricoAnoHtml`, os 3 `ajusteById` do `ctx` |
| `scripts/` | os casos de `smoke-escala-contagem.js`, `smoke-scale-service.js`, `smoke-ajustes-escala-2508.js` e `smoke-ajuste-contador-rotulo.js` que ancoram o ajuste |

A coleção `fairness_counter` e a regra dela **ficam no lugar** — deixa de ser lida, e mexer em
Security Rules sem necessidade é risco de graça (regra inviolável 7 e o caso
[[rules-comissoes-orfas]]).

**Migração de dados:** `scripts/zerar-ajustes-partida.js` — grava um backup JSON com o que
existia, zera todos os `ajuste`, e imprime um relatório pessoa a pessoa (antes → depois).
Roda no staging primeiro, e em produção só depois do OK.

**Trava contra volta:** teste que chama `consolidate` com `ctx.ajusteById = { fulano: 99 }` e
exige **o mesmo resultado** de quando não passa nada. Teste de comportamento, não de texto —
foi ler texto de arquivo que deixou a prévia quebrada passar 12 vezes ([[previa-nunca-rodou]]).

---

## 2. Rebalanceio — "Ajustar sábados nesta janela"

**O pedido:** a gestão põe **3** onde está **4** e o sistema tira a pessoa de um sábado e chama
quem tem **menos**; põe **5** e tira de quem tem **mais**.

### Motor puro novo: `scale-rebalance.js`

Arquivo novo, mesmo estilo de `scale-engine.js` (UMD, sem Firebase, sem `Date.now()`
implícito). Fica separado porque tem vocabulário próprio (alvo, doar, receber, sorteio) e o
motor de consolidação tem 125 linhas que não quero engordar.

```js
ScaleRebalance.planejar({
  pessoaId,      // quem está sendo ajustado
  alvo,          // quantos dias ela deve ter na janela
  datas,         // [{ scaleId, date, published, slots:[{id,unitId,requiredModalityId,day,assignedPersonId}] }] ASC
  candidatos,    // [{ id, modalityIds, merito, dias, cota, indisponivel:[datas] }]
  vizinhanca,    // dias de descanso entre datas (default 7)
  rng,           // () => [0,1) — default Math.random; os testes injetam
}) -> {
  atual, alvo, atingiu,
  movimentos: [{ scaleId, date, slotId, unitId, saiId, entraId, motivo }],
  avisos: [string]
}
```

**Puro de verdade:** não lê nem grava nada, não sorteia sozinho sem `rng`, e devolve **plano**,
não efeito. Quem aplica é a camada de serviço.

### Regras, na ordem

**Reduzir (`alvo < atual`)** — para cada dia que precisa sair:

1. **Qual dia sai primeiro:** data **não publicada** antes de publicada; entre iguais, a **mais
   distante** primeiro (mexer no que está mais longe incomoda menos gente).
2. **Quem entra no lugar:** candidato que
   - é habilitado na modalidade da vaga (`requiredModalityId`),
   - não é a própria pessoa,
   - não está em outra vaga **do mesmo dia**,
   - não está indisponível naquela data (férias aprovadas),
   - não está escalado numa data vizinha (±7 dias) — a regra de não pegar dois sábados
     seguidos vale aqui igual ao motor.
3. **Ordem entre os elegíveis:** **menos dias na janela** → **maior mérito** → **sorteio**.
   Quem já bateu a própria cota vai pro fim da fila (teto macio, igual ao motor: melhor
   escalar acima da cota do que deixar sábado sem professor).
4. Se ninguém for elegível: **não mexe nesse dia**, registra aviso
   `"Não achei quem entrasse em 17/10 — a vaga ficaria aberta. Não mexi nesse dia."` e tenta o
   próximo. Nunca deixa vaga aberta para cumprir uma meta.

**Aumentar (`alvo > atual`)** — para cada dia que precisa entrar:

1. **Onde entrar:** data em que a pessoa **não está** em vaga nenhuma, não está indisponível,
   e não é vizinha de um dia que ela já pegou. Não publicada antes de publicada; entre iguais,
   a **mais próxima** primeiro.
2. **De quem tirar:** ocupante de uma vaga cuja modalidade a pessoa dá, e que tenha **mais
   dias** que ela. Escolhe o de **mais dias** → empate: **menor mérito** → empate: **sorteio**.
3. Se ninguém tem mais dias que ela naquele dia: pula, com aviso.

**Em ambos:** o contador `dias` é atualizado **a cada movimento** dentro do plano — quem sai
perde um, quem entra ganha um. Sem isso, pedir 3 movimentos escolheria a mesma vítima três
vezes.

**Se não deu para chegar no alvo:** `atingiu: false` + avisos dizendo o porquê, e os movimentos
que **deram** continuam valendo. A tela mostra os dois.

### Prévia e aplicação

A tela mostra a prévia antes de qualquer gravação:

```
Heloísa: 4 → 3 sábados nesta janela

17/10 · Príncipe (TOI)   sai Heloísa · entra Beltrano
                         Beltrano tem 1 sábado nesta janela, Heloísa tem 4

⚠️ 24/10 não foi mexido: ninguém habilitado estava livre nesse dia.

[Cancelar]  [Aplicar estas mudanças]
```

**Aplicar** = para cada movimento, `ScaleService.reassignSlot(scaleId, slotId, entraId)`.
Depois, por data:

- data **publicada** → `publishToAgenda` de novo (idempotente, respeita mês fechado) **e avisa**:
  - quem **saiu**: *"Você saiu da escala de 17/10 (Príncipe, 08:00–12:00). A gestão ajustou a
    distribuição."*
  - quem **entrou**: *"Você entrou na escala de 17/10 · Príncipe 08:00–12:00 (TOI). Já está na
    sua agenda."*
- data **não publicada** → não avisa ninguém (o professor não enxerga escala não publicada
  desde 26/08 — avisar seria contar o que ele não pode ver).
- **a gestão é avisada sempre**, num aviso só: *"Fulano ajustou a escala da Heloísa (4 → 3):
  1 troca em 17/10."*

Precisa de `NotifyService.resolveManagementUserIds()` — não existe hoje; hoje só existe
`resolveActiveTeacherUserIds`.

### Onde fica o botão

Substitui o **"+ dias fora"** no painel de Equilíbrio, com o rótulo **"Ajustar"**, e aparece
também na aba **Por pessoa**. Na aba Feriados ajusta feriados; nas outras, sábados.

---

## 3. Marco zero — "a contagem começa em ___"

Campo novo em `scale_config/default`: **`marcoZero: 'YYYY-MM-DD' | null`**. Valor inicial
**`2026-09-01`**.

**Efeito, em todo lugar que conta:**

```js
// PURO, em scale-service.js
function dataDeCorte(dataISO, marcoZero) {
  const doze = dozeMesesAntes(dataISO);
  if (!marcoZero) return doze;
  if (!doze) return marcoZero;
  return doze > marcoZero ? doze : marcoZero;   // o mais recente dos dois manda
}
```

- **Motor** (`consolidate`): `de = dataDeCorte(scale.date, marcoZero)` no lugar de
  `dozeMesesAntes(scale.date)`. O marco **não substitui** a janela de 12 meses móveis — ele é
  um **piso**. Quando 01/09/2027 chegar, os 12 meses já serão mais restritivos que um marco de
  2026 e o marco para de importar sozinho, sem ninguém mexer.
- **Tela** (`escalaContagens`): o número "no ano" passa a contar de
  `max(${ano}-01-01, marcoZero)`. O painel diz em letra pequena: *"Contando a partir de
  01/09/2026."*
- **Histórico do ano** (`escalaHistoricoAnoHtml`) e **aba Por pessoa**: mesmo corte.

**De onde `consolidate` lê:** do próprio `scale_config`, dentro da função. `ctx.marcoZero`
continua aceito e tem precedência (é como os testes injetam). Ler lá dentro custa 1 leitura por
data consolidada e evita a falha silenciosa clássica desta base: chamador que esquece de passar
e o rodízio decide num universo diferente sem erro nenhum.

**Configuração:** bloco novo **⚙️ Configurações da escala** dentro da tela da Escala
Inteligente, só para Admin (`scale_config` já é `write: isAdmin()`). Campo de data + texto:

> *A contagem de justiça começa nesta data. Tudo antes dela não conta — nem na tela, nem na
> hora de montar a escala. Use na virada do ano para zerar o rodízio (ex.: 01/01/2027).*

Trocar o marco zero **grava no log** (item 6).

---

## 4. O botão de publicar que ele não achou

Três mudanças:

**(a) O nome.** Hoje: `✅ Publicar na agenda e avisar`. Passa a dizer o número real e o tipo:

```
✅ Publicar as 8 datas de sábado na agenda e avisar
✅ Publicar 1 data de feriado na agenda e avisar     (singular)
```

**(b) Barra fixa na tela principal.** Hoje só existe a barra do 🔄 Refazer, e ela aparece para
lote consolidado. Ela vira **uma barra por lote com os dois botões**:

```
Escala montada para 8 data(s): 05/09/2026 a 24/10/2026 · ainda não publicada
                                     [✅ Publicar as 8 datas…]  [🔄 Refazer]
```

Quando todas as datas do lote já estão publicadas, o botão de publicar some e a barra diz
`· 8 publicada(s)` como hoje.

**(c) No topo da prévia também**, para quem não rola até o fim. Mesmo texto, mesma ação.

---

## 5. Heloísa e as escalas montadas — não mexer

Resposta 3 é explícita. Nesta frente:

- ❌ **não** refazer setembro nem outubro
- ❌ **não** despublicar nada
- ❌ **não** reavisar ninguém
- ✅ zerar os ajustes lançados na mão (item 1) — muda o **contador**, não a **escala**
- ✅ entregar as mudanças, testar no staging, e **eles** decidem quando publicar e avisar o Staff

O relatório de `zerar-ajustes-partida.js` (antes → depois, por pessoa) é o que documenta o
sumiço do `+3`.

---

## 6. Log de alteração por usuário

**Hoje:** só a troca de vaga grava alguma coisa (`AuditService.log`, tipo `fairness_adjusted` e
o da troca). Consolidar, refazer, abrir janela, publicar, despublicar, inverter e tirar do lote
**não geram registro nenhum**. E o que é gravado não aparece: a tela de Auditoria filtra por
unidade, e `AuditService.log` grava `unitId: null`.

**Pior:** `audit_log` é `allow read: if isAdmin()`. Supervisão — que é gestão para todo o resto
da escala — **não consegue ler**. Uma tela de histórico apoiada só em `audit_log` nasceria
invisível para metade de quem precisa dela.

**Solução: o histórico mora no próprio documento da escala.**

Campo novo em `special_scales/{id}`:

```js
historico: [
  { ts: '2026-08-28T14:03:11.000Z', uid: 'abc', nome: 'Rodrigo',
    acao: 'refeita', detalhe: 'saiu Heloísa, entrou Carla (Príncipe · TOI)' },
  …
]
```

- `ts` é **string ISO do cliente**, não `serverTimestamp()` — o Firestore recusa sentinel
  dentro de array.
- Cap de **50 entradas** por escala, mantendo as mais novas. Helper puro
  `ScaleService.appendHistorico(lista, entrada, max)`, testado sozinho.
- Regra: `special_scales` já é `read: hasProfModule()` / `write: isAdmin() || isSuperv()`.
  **Nenhuma Security Rule muda.**
- `AuditService.log` continua sendo chamado em paralelo onde já é hoje — o trilho do Admin não
  regride. Ganha um parâmetro opcional `unitId` (default `null`, comportamento igual) para
  quando a ação tem unidade conhecida.

**Ações que passam a gravar:**

| Ação | `acao` | `detalhe` |
|------|--------|-----------|
| Abrir janela | `janela_aberta` | `"janela até 30/08 · lote de 8 datas"` |
| Consolidar / prévia | `consolidada` | `"montada: CP Fulano (TOI), Beltrano (Hiit)…"` |
| Refazer | `refeita` | `"saiu Heloísa, entrou Carla (Príncipe · TOI)"` — **antes → depois por nome** |
| Publicar | `publicada` | `"4 aula(s) na agenda · 16 pessoa(s) avisada(s)"` |
| Despublicar | `despublicada` | `"4 aula(s) removidas da agenda"` |
| Inverter | `invertida` | `"Fulano ⇄ Beltrano (TOI ⇄ Hiit)"` |
| Trocar vaga | `vaga_trocada` | `"saiu Fulano, entrou Beltrano (CP · TOI)"` |
| Rebalancear | `rebalanceada` | `"Heloísa 4 → 3: saiu dela, entrou Beltrano"` |
| Tirar do lote | `tirada_do_lote` | `"saiu do lote b_2026-09; vagas limpas"` |
| Marco zero | `marco_zero` | gravado no `audit_log` (não é de uma escala) |

**Duas telas:**

1. **🕐 Histórico desta escala** — `<details>` dentro de `renderEscalaDetail`, lendo
   `scale.historico`. É o que responde "alguém mexeu?" em 5 segundos.
2. **📜 Últimas alterações do módulo** — `<details>` no rodapé da tela da Escala Inteligente,
   juntando o `historico` de todas as escalas já carregadas em memória, ordenado do mais novo,
   top 50. Sem query nova, sem índice novo.

O diff de nomes do refazer sai de um helper puro
`ScaleService.diffEscalados(slotsAntes, slotsDepois, nomePorId)`.

---

## 7. Feriados de novembro e "tirar do lote"

### (a) Aba Por pessoa: de qual janela é cada data

A tabela ganha coluna **Janela**:

- data com `windowBatchId` → o período do lote (`05/09 a 24/10`)
- data **sem** `windowBatchId` mas consolidada → **⚠️ fora de janela**

E um `<select>` de filtro: **Todas · \<cada lote\> · Fora de janela**. É o "só desta janela" do
pedido, servindo também para achar as órfãs.

### (b) Botão "Tirar do lote"

`ScaleService.removeFromBatch(scaleId)` — em cada data de sábado/feriado/domingo especial:

1. se estiver publicada, `unpublishFromAgenda` primeiro (aborta se houver aula em mês fechado —
   erro claro, não silêncio)
2. limpa as vagas (`assignedPersonId: null`, `reason: null`, `explain: []`)
3. `status: 'rascunho'`, `windowBatchId: null`, `windowClosesAt: null`
4. grava no histórico

Botão em `renderEscalaDetail`, com confirmação que diz o que acontece — inclusive que **quem já
foi avisado não é desavisado**, o mesmo cuidado do Despublicar.

### (c) Os dois feriados de novembro

02/11 e 20/11 foram consolidados em 25/08 fora de qualquer janela. Resposta 5: **limpa e zera**.
Feito pela própria tela, com o botão novo, no staging e depois em produção — sem script de
migração, porque o caminho da tela é o que a gestão vai usar de novo amanhã.

---

## 8. Formato de data

`escalaCardDoc` (`professores-escala-smart.js:359`) imprime `${s.date}` cru: **`2026-11-20`**.

Helper puro em `scale-service.js` (não na UI — assim o teste chama a função em vez de ler o
arquivo):

```js
ScaleService.fmtDataLonga('2026-11-20')  // → 'sexta-feira, 20/11/2026'
```

Dias da semana em array fixo (sem `Intl`, sem depender de locale do navegador), data lida com
`T12:00:00` para não escorregar de fuso — mesma convenção de `dozeMesesAntes` e
`personsOnNearbyScale`. Entrada inválida devolve a entrada, sem quebrar a tela.

**Varredura:** todos os pontos do módulo que imprimem data crua passam a usar `fmtDataLonga` ou
`escalaFmtBR`, conforme o espaço. **Não** entram na varredura: `value="${...}"` de
`<input type="date">` e argumentos de `onclick` — esses **têm** que ser ISO.

**Trava:** `scripts/smoke-escala-data-formatada.js` com duas partes —
(1) testes de comportamento de `fmtDataLonga` (dias da semana corretos, virada de mês, entrada
inválida); (2) varredura do arquivo listando **toda** interpolação `${…date}` e comparando com
uma **lista de exceções explícita**. Interpolação nova que não esteja na lista **quebra o
teste**, e quem a escreveu decide: formata, ou justifica na lista.

---

## 9. Fim de ano — a mesma lógica (resposta 7)

O que vale e o que não vale, item por item:

| Item | Fim de ano |
|------|-----------|
| 1 · sem ajuste manual | ✅ vale — `consolidateByDay` nunca usou ajuste; o botão sumindo já resolve |
| 2 · rebalanceio | ✅ vale — "Ajustar dias neste período", mesmo motor puro |
| 3 · marco zero | ➖ **não se aplica**: a justiça do fim de ano é **interna ao período** (começa do zero, `consolidateByDay` linha 953) — é uma fila própria, de turnos diários, que nunca conversou com a de sábados. Fica registrado aqui para ninguém "corrigir" isso depois achando que é bug |
| 4 · botão de publicar | ✅ vale — rótulo com o número real de dias + barra "montado, não publicado" na tela |
| 5 · não mexer | ✅ vale |
| 6 · log | ✅ vale — mesmo `historico[]` |
| 7a · janela na aba Por pessoa | ✅ vale — linha de fim de ano mostra o nome do período |
| 7b · tirar do lote | ➖ **não se aplica**: fim de ano não é lote de datas, é **um documento** com muitos dias. Tirar um dia é editar o período, outra frente |
| 8 · formato de data | ✅ vale — o detalhe do fim de ano imprime `20/12` sem ano; passa a `sáb, 20/12/2026` |

**🐛 Achado que o item 2 desenterra:** `reassignSlot` (`scale-service.js:177`) recusa pôr alguém
que já está em **qualquer outra vaga da escala**. Para sábado isso está certo — uma escala é um
dia. Para **fim de ano**, uma escala é o **período inteiro**: quem trabalha 20/12 **nunca** pode
ser posto em 27/12 pela troca manual. É um defeito que já está em produção e que a gestão
provavelmente leu como "não deixa trocar". Correção: a colisão passa a ser por **dia** quando a
vaga tem `day`:

```js
const mesmoDia = (s) => (s.day || null) === (slot.day || null);
if (depois && (scale.slots || []).some(s => s.id !== slotId && mesmoDia(s) && s.assignedPersonId === depois))
```

Para sábado/feriado `day` é `undefined` nos dois lados → comportamento idêntico ao de hoje.

---

## 10. O que NÃO está nesta frente

- **Sábado 29/08** — resposta 6: acontece no papel. O sistema não é envolvido.
- **Refazer setembro/outubro** — resposta 3. Depois, pela gestão, com o botão 🔄 Refazer.
- **Fila única sábado+feriado** (carga total em vez de filas separadas) — pergunta antiga,
  ainda sem resposta do Rodrigo. Continua como está: **filas separadas**.
- **Tirar um dia do período de fim de ano** — ver item 9.
- **Mexer em Security Rules** — nada nesta frente precisa.

---

## 11. Ordem de construção e risco

| Bloco | O quê | Risco |
|-------|-------|-------|
| A | Marco zero + fim do ajuste manual + migração | **Alto** — mexe no insumo do motor |
| B | Log (`historico[]`) | Baixo — só adiciona |
| C | Tela: publicar, tirar do lote, janela na aba, formato de data | Baixo |
| D | Rebalanceio (motor + serviço + tela + avisos) | **Alto** — grava, republica e notifica |
| E | Fim de ano: `reassignSlot` por dia + rebalanceio + rótulos | Médio |
| F | Dados: zerar ajustes · limpar 02/11 e 20/11 | Médio — produção |

**A ordem importa:** A antes de D porque o rebalanceio decide com o mesmo contador; B antes de
C e D porque toda ação nova já nasce registrada.

**Homologação:** staging, com o Rafael clicando de verdade. A lição de 26/08 vale inteira —
teste que lê o texto do arquivo **não prova que a função roda** ([[previa-nunca-rodou]]), e
teste que confere "a função foi chamada" não prova **com quê** ([[upload-pacto-pela-tela]]).
Produção só depois do OK explícito (regra inviolável 7).

**Manual:** rebalanceio, marco zero, tirar do lote e o histórico mudam a rotina da gestão →
entram no `manual-admin.html` e nos assuntos de `scripts/smoke-manual-atualizado.js`
([[manual-envelhece-em-silencio]]).
