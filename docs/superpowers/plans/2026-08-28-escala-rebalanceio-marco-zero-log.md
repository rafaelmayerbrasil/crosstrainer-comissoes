# Escala — rebalanceio, marco zero e log · plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa. Os passos usam
> checkbox (`- [ ]`).

**Objetivo:** entregar os 8 pedidos do Rodrigo de 28/08/2026 na Escala Inteligente —
contagem 100% automática com marco zero configurável, rebalanceio por pessoa, log de alterações
por usuário, botão de publicar achável, "tirar do lote" e data legível — e levar a mesma lógica
para a Escala de Fim de Ano.

**Arquitetura:** a base já separa **motor puro** (`scale-engine.js`, sem Firebase) de
**serviço** (`scale-service.js`, Firestore + regras de negócio) de **tela**
(`professores-escala-smart.js`, HTML em template literal). O plano respeita essa divisão: toda
decisão nova nasce em função pura testável por `node`, o serviço grava, a tela desenha. O
histórico de alterações mora **dentro do documento da escala** para não esbarrar em
`audit_log`, que é Admin-only.

**Stack:** JS vanilla (UMD para os módulos puros), Firebase (Firestore), testes = scripts Node
com `assert`, rodados um a um (`node scripts/smoke-*.js`).

**Especificação:** `docs/superpowers/specs/2026-08-28-escala-rebalanceio-marco-zero-log-design.md`
— leia antes da Task 1.

---

# 🚦 ESTADO DA EXECUÇÃO — atualize esta seção a cada tarefa fechada

> **Última atualização:** 28/08/2026, sessão 60. Branch: **`escala-rebalanceio-log`**, saída de
> `main` (`e44b4a7`).
> **Nada foi para o staging. Nada foi para produção. Nenhuma escala foi tocada.**

| Tarefa | Estado |
|--------|--------|
| 1 · `dataDeCorte` | ✅ fechada — `bb28ab6` |
| 2 · marco zero no motor | ✅ fechada — `55acad7` + `c3a359b` (blindagem) |
| 3+4 · marco zero na tela + config | ✅ fechada — `67f973a` + `566da32` + `d521077` (rede de teste) |
| 5 · ajuste manual sai do motor | ✅ fechada — `b2cc98d` |
| 6 · ajuste manual sai da tela | ✅ fechada — `b96091d` |
| 7 · script que zera os ajustes | ✅ fechada — `bc4af5a` + `268b7b1` (ensaio não grava em disco) |
| 8 · helpers do histórico | ✅ fechada — `9c8f575` + `4447ce2` (rastro de falha, race documentada) |
| 9 · as 7 ações gravam histórico | ✅ fechada — `a808bf9` + `051e335` (quem mexeu, com teste) |
| 10 · `AuditService.log` aceita unidade | ✅ fechada — `920d997` |
| 11 · as duas telas de histórico | ✅ fechada — `5197593` + `98e216d` (escape) + `ae907f4` (nome do autor) |
| 12+13 · data legível + botão de publicar achável | ✅ fechadas — `70d1b55` + `d641b56` + `4d864e3` |
| 14 a 25 | ⬜ não começadas |

### ⚠️ Duas lacunas DECLARADAS das Tasks 12+13 (não corrigidas, por orçamento)

1. **`refazerBar` não tem teste que a CHAME.** A Task 13 tem duas metades: a barra persistente na
   tela de gestão e o botão no topo da prévia. **Só a segunda** é exercitada por chamada de função
   (`gerarPreviaLote` no sandbox `vm`); `renderEscalaGestao` é dublado em todos os smokes, então
   nenhum teste executa `refazerBar`. Dado o histórico deste projeto (a prévia que nunca rodou),
   **isto é exatamente a metade que costuma quebrar sem ninguém ver.** Cobrir na **Task 24**.
2. **`escalaRotuloPublicar` reescreve o dicionário de tipos** (`sabado→'sábado'` etc.) que já existe
   em `rotuloTipo`, no mesmo arquivo, só com capitalização diferente. Duas tabelas que vão divergir.
   Unificar quando alguém encostar nessa região.

### 🕳️ A varredura de data crua já deu falso negativo uma vez

`scripts/smoke-escala-data-formatada.js` tratava "linha sem `<`" como legítima. As três chamadas de
`profDateRow(s, \`${s.date} · …\`, …)` montavam o texto **sem HTML na própria linha** e só viravam
tela lá dentro — resultado: **data ISO crua na tela DO PROFESSOR**, e a varredura dizendo que estava
tudo certo. Apertada em `4d864e3`: linha sem HTML só é legítima se também **não** entregar o texto
como argumento a `profDateRow`/`escalaCardDoc`/`render*`/`*Html`. Se for afrouxar isso um dia,
lembre por que apertou.

### 💸 Mudança de método a partir da Task 12 (pedido do Rafael, limite semanal)

Até aqui cada tarefa gastou **3 subagentes** (implementador + revisor de spec + revisor de qualidade).
Não fecha o plano dentro do limite. A partir da Task 12:
- **uma revisão só**, cobrindo spec e qualidade — exceto **16, 17 e 20** (motor do rebalanceio), que
  mantêm as duas separadas;
- **tarefas pequenas agrupadas** num implementador só (12+13, 14+15, 21+22, 23+24+25);
- **correção pequena de revisão o coordenador aplica direto**, sem devolver ao implementador;
- o implementador **lê a tarefa no próprio plano** em vez de recebê-la colada (sai mais barato que
  o coordenador ler e colar);
- revisor roda **só os smokes que a tarefa toca**, não a suíte inteira.

### 🧪 Armadilha de sandbox `vm` (achada na Task 11)

Objeto criado **dentro** do sandbox tem protótipo de outro realm: `assert.deepStrictEqual` cru falha
comparando `{a:1}` do sandbox contra `{a:1}` do host, só pelo protótipo. Compare com
`JSON.parse(JSON.stringify(o))` antes. Strings e primitivos não sofrem disso.

### 🧪 O caminho de escrita do `zerar-ajustes-partida.js` FOI exercitado

Staging **não tem nenhum `ajuste` lançado** — os 6 documentos de `fairness_counter` lá são do
esquema antigo (`diasTrabalhados`/`divida`/`updatedAt`), sem o campo. Então o script, rodado
direto, só exercita o caminho "nada a fazer". Foi validado com **fixture descartável**
(`ajuste:3`, `ajuste:-2`, `ajuste:0`) e cleanup completo, duas vezes — antes e depois do conserto.
Provado: ensaio não grava (nem no banco, nem em disco), `--executar` zera só os não-zerados,
o backup traz os valores certos, `zeradoEm` vira `Timestamp` de verdade, a reentrada diz
"Nada a zerar", e os 6 documentos reais ficaram intactos campo a campo.

**Quando a Task 25 chegar, produção terá dados de verdade** — inclusive o `+3` da Heloísa. Rode o
ensaio e **confira a lista na mão** antes de aplicar.

### ✋ Não "limpe" o `<span>` do painel de Equilíbrio

A revisão de qualidade da Task 6 apontou (Minor) que o `<span>` da direita em
`renderEquilibrioPainel` ficou com `display:flex;align-items:center;gap:6px` envolvendo um único
nó de texto, agora que o botão saiu — e sugeriu simplificar. **Não simplifique:** a **Task 18**
devolve um botão a esse mesmo `<span>`, já como **Ajustar** do rebalanceio. O flex e o gap estão
esperando por ele.

### 🔗 Tasks 5 e 6 são um PAR — não separe

A Task 5 apagou `getFairness`/`saveAjustePartida`/`listAjustes` de `scale-service.js`, e a tela
**ainda os chama** até a Task 6 entrar. Entre um commit e outro a branch fica com a tela quebrada
(`TypeError: ScaleService.listAjustes is not a function`). **Nunca subir a Task 5 sem a 6.**
Levantado pela revisão de qualidade da Task 5.

### 📌 Achado fora de escopo, para o backlog

`scripts/diag-contador-escala.js` ainda lê `fairness_counter` e imprime a coluna "lançado na mão"
ao lado da contagem derivada. Depois da Task 5 essa coleção não tem **nenhum** caminho de escrita
vivo no app — o diagnóstico exibe um número congelado que já não afeta escala nenhuma, sem avisar
disso. Ou some com a coluna, ou põe a nota. Não bloqueia o plano.

## ✅ Tasks 3+4 — encerradas na sessão 60

A re-revisão de qualidade rodou sobre `git diff 67f973a 566da32` e confirmou os **6 achados
fechados de verdade**, lendo o código, sem problema novo introduzido.

**O buraco declarado foi medido e fechado.** O revisor regrediu de propósito os Important 1 e 2 e
provou que o teste **não pegava** nenhum dos dois (seguia 9/9 verde). `d521077` acrescentou o
assert que faltava: chama `renderTabPorPessoa()` e `escalaHistoricoAnoHtml()` de verdade no
sandbox, conta as ocorrências da nota, e verifica que ela **some** num ano posterior ao do marco.
Provado falhando nas duas regressões antes de entrar. Suíte da tela: **10/10**.

> ⚠️ **Armadilha achada aqui, vale para qualquer teste futuro de
> `escalaHistoricoAnoHtml`:** chamá-la num ano **sem nenhuma escala cadastrada** devolve `''` por
> um guard-clause anterior (`if (!linhas) return '';`). O teste passa por motivo errado. Sempre
> cadastre ao menos uma escala no ano que você está exercitando.

## Os 6 achados das Tasks 3+4 — ✅ todos conferidos no código (sessão 60)

Resolvidos assim, e cada item foi confirmado com `arquivo:linha` pela re-revisão:

1. helper único `escalaNotaMarcoHtml(c)` (~linha 254), usado em `renderEquilibrioPainel` (~316),
   `escalaHistoricoAnoHtml` (~662, que cobre os 3 call-sites, inclusive o modal "Abrir janela") e
   os cartões de `renderTabPorPessoa` (~623)
2. usa `c.deAno` e só renderiza quando `c.deAno !== '${ano}-01-01'`
3. `escalaContagens` valida `/^\d{4}-\d{2}-\d{2}$/` (~232-235), cai para `null` com `console.warn`
4. comentário de `escalaContagens` reescrito (~220-226), coerente com `whyTableHtml`
5. botão virou **"Voltar aos 12 meses"**, e o texto de apoio/`confirm` explicam o efeito
6. `<summary>` alinhado em `var(--blue)`

Texto original dos achados, para conferir contra o código:

1. **(Important)** A nota "Contando a partir de…" só está em `renderEquilibrioPainel`, mas o número
   do ano — já cortado pelo marco — aparece em **três** lugares: ali, em `escalaHistoricoAnoHtml()`
   (usada no modal **"Abrir janela de preferências"**, onde a gestão decide) e nos cartões da aba
   **Por pessoa** (que **nunca** renderiza o painel de Equilíbrio). Criar **um** helper
   (`escalaNotaMarcoHtml(c)`) e usá-lo nos três.
2. **(Important)** A nota mostra `c.marco` cru; deve mostrar `c.deAno`, e **só aparecer quando o
   corte de fato mudou** (`c.deAno !== '${ano}-01-01'`). Em ano posterior ao do marco, ele não corta
   mais nada e a nota estaria mentindo.
3. **(Important)** A tela lê `marcoZero` **sem** a validação de formato que `scale-service.js` já
   faz (~linhas 862-874). Valor malformado faria `escalaFmtBR` estourar e derrubar o render inteiro.
   Validar `^\d{4}-\d{2}-\d{2}$` e tratar como sem-marco se não casar.
4. **(Minor)** O comentário de `escalaContagens` diz que a tela corta "do mesmo jeito que o motor".
   Não corta: motor = `max(12 meses móveis, marco)`; tela = `max(1º de janeiro, marco)`. O arquivo
   já documenta a diferença em `whyTableHtml` — o comentário a contradiz.
5. **(Minor)** "Tirar o marco" estreia uma palavra que o usuário nunca viu no rótulo do campo.
   Trocar por algo que diga o efeito, ex.: **"Voltar aos 12 meses"**.
6. **(Minor)** O `<summary>` do novo `<details>` usa `var(--text2)`; os vizinhos usam `var(--blue)`.

**Não mexer:** `AuditService.log` sem `try/catch` — foi verificado que ele nunca lança (try/catch
interno), e é o padrão pré-existente do arquivo.

## Teste de tela das Tasks 3+4 — ✅ `566da32` + `d521077`

`scripts/smoke-escala-marco-zero.js` ganhou um segundo bloco IIFE em sandbox `vm`, no molde do
bloco final de `smoke-escala-contagem.js`, que **chama** as funções: `salvarMarcoZero` (caminho
feliz com audit, erro do save, confirm recusado, no-op), `renderConfigEscalaHtml` (não-Admin recebe
`''`), `escalaContagens` (com marco, sem marco, ano anterior ao marco, marco malformado) e
`renderTabPorPessoa`/`escalaHistoricoAnoHtml` (a nota do marco nos call-sites reais). **10/10.**

É o modelo a copiar nas próximas tarefas de tela.

## Como esta execução vem sendo conduzida

Skill `superpowers:subagent-driven-development`: **um subagente implementador por tarefa**, depois
**revisão de especificação**, depois **revisão de qualidade**, cada uma por um subagente novo. Só
avança quando as duas aprovam; achado da revisão volta para o **mesmo** implementador.

Vale a pena manter: **3 das 4 tarefas até agora voltaram com achado real** — nenhum deles teria
sido pego só rodando os testes.

Modelo: `sonnet` deu conta de tudo até aqui. Reserve o modelo mais capaz para as Tasks **16, 17 e
20** (motor do rebalanceio e a tela dele), que envolvem julgamento de projeto.

## Armadilhas de ambiente já descobertas (não redescubra)

- **`node` não está no PATH** da sessão de shell (Windows + nvm4w). Está em `/c/nvm4w/nodejs`
  (v22.22.2). Procure antes de concluir que node não existe.
- **Não edite por heredoc no shell** — o quoting deste ambiente mangla backslashes de forma
  inconsistente entre chamadas, o que estraga regex. Use a ferramenta de edição estruturada.
- **`git commit` cospe `failed to delete '.git/worktrees/...': Permission denied`.** É sujeira de
  worktrees antigas travadas, **não** tem relação com o commit — que passa normalmente. Ignore.
- Rode `node --check professores-escala-smart.js` depois de mexer nele: é template literal
  aninhado, e erro de sintaxe é a falha mais provável.

## Duas emendas ao plano, decididas durante a execução

Estão detalhadas mais abaixo, mas resumindo, porque valem para as tarefas que faltam:

1. **Nunca passe `ctx.marcoZero`.** Deixe `consolidate` ler a config sozinha — a blindagem de
   formato só existe nesse caminho.
2. **Teste de tela tem que chamar a função**, num sandbox `vm`, quando ela tiver efeito colateral
   ou for gate de permissão. `vm.createContext` já é padrão aqui (9 arquivos em `scripts/`).

---

## Antes de começar

```bash
git checkout main && git pull && git checkout -b escala-rebalanceio-log
```

⚠️ Sair de `main`, **não** de `comissoes-tradutor-pacto`. Comissões está esperando o Rodrigo e
não pode subir junto.

Verificação de que a base está verde antes de encostar em nada:

```bash
node scripts/smoke-scale-engine.js && node scripts/smoke-scale-service.js && node scripts/smoke-escala-contagem.js && node scripts/smoke-ajustes-escala-2508.js && node scripts/smoke-ajuste-contador-rotulo.js
```

---

## Mapa de arquivos

| Arquivo | Responsabilidade | Ação |
|---------|------------------|------|
| `scale-rebalance.js` | motor puro do rebalanceio (planeja movimentos, não grava) | **criar** |
| `scale-engine.js` | motor da consolidação | intocado |
| `scale-service.js` | Firestore + `dataDeCorte`, `fmtDataLonga`, `appendHistorico`, `diffEscalados`, `registrarHistorico`, `removeFromBatch`, `aplicarRebalanceamento` | modificar |
| `notify-service.js` | `resolveManagementUserIds` | modificar |
| `professores-shared.js` | `AuditService.log` aceita `unitId` | modificar |
| `professores-escala-smart.js` | telas: marco zero, rebalanceio, histórico, barra de publicar, tirar do lote, formato de data | modificar |
| `professores.html` | carregar `scale-rebalance.js` | modificar |
| `scripts/zerar-ajustes-partida.js` | migração: backup + zerar `fairness_counter.ajuste` | **criar** |
| `scripts/smoke-scale-rebalance.js` | motor do rebalanceio | **criar** |
| `scripts/smoke-escala-marco-zero.js` | marco zero ponta a ponta no serviço | **criar** |
| `scripts/smoke-escala-historico.js` | log: helpers puros + gravação | **criar** |
| `scripts/smoke-escala-data-formatada.js` | `fmtDataLonga` + varredura de data crua | **criar** |
| `scripts/smoke-escala-contagem.js`, `smoke-scale-service.js`, `smoke-ajustes-escala-2508.js`, `smoke-ajuste-contador-rotulo.js` | ancoravam o ajuste manual | modificar |
| `manual-admin.html`, `scripts/smoke-manual-atualizado.js` | rotina nova da gestão | modificar |

---

## 🧪 Como se testa tela neste projeto (decidido na revisão da Task 3+4)

Eu tinha suposto que os smokes de tela aqui só liam o texto do arquivo com regex. **Está errado**, e a
verificação corrigiu a suposição: `vm.createContext` já é padrão consolidado — **9 arquivos** de
`scripts/` usam, e `scripts/smoke-escala-contagem.js` (linhas ~460-516) já carrega
`professores-escala-smart.js` de verdade e **chama** `gerarPreviaLote('lote')` de ponta a ponta.
Aquele bloco nasceu justamente do conserto da prévia que nunca rodou.

**Regra para toda tarefa de tela deste plano:** quando a função nova tiver **efeito colateral**
(grava, notifica, republica) ou for um **gate de permissão**, o teste tem que **chamá-la** num
sandbox `vm`, não procurar o texto dela no arquivo. Reaproveite o esqueleto de sandbox de
`smoke-escala-contagem.js`, acrescentando os globais que faltarem aos mocks.

Regex sobre o arquivo continua válido para uma coisa só: provar que algo **não existe mais**
(ver `smoke-ajuste-contador-rotulo.js`, Task 6). Ausência é o único fato que ler texto prova bem.

---

# BLOCO A — Marco zero e o fim do ajuste manual

## Task 1: `dataDeCorte` — o piso da contagem

**Arquivos:**
- Modificar: `scale-service.js` (perto de `dozeMesesAntes`, linha ~620)
- Criar: `scripts/smoke-escala-marco-zero.js`

- [ ] **Passo 1: escrever o teste que falha**

Criar `scripts/smoke-escala-marco-zero.js`:

```js
'use strict';
// Roda: node scripts/smoke-escala-marco-zero.js
//
// O marco zero é a resposta do Rafael (28/08/2026) ao pedido 3 do Rodrigo:
// "ignorar o histórico de papel, contar a partir de agora". Ele é um PISO da
// janela de 12 meses móveis, não um substituto: quando 01/09/2027 chegar, os
// 12 meses já são mais restritivos e o marco para de importar sozinho.
const assert = require('assert');
const SS = require('../scale-service.js');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

// ── dataDeCorte (puro) ──
{
  assert.strictEqual(SS.dataDeCorte('2026-10-17', null), '2025-10-17',
    'sem marco zero, vale a janela de 12 meses');
  assert.strictEqual(SS.dataDeCorte('2026-10-17', '2026-09-01'), '2026-09-01',
    'marco zero mais recente que os 12 meses manda');
  assert.strictEqual(SS.dataDeCorte('2027-10-17', '2026-09-01'), '2026-10-17',
    'quando os 12 meses passam do marco, o marco para de importar sozinho');
  assert.strictEqual(SS.dataDeCorte('2026-10-17', ''), '2025-10-17',
    'marco vazio é o mesmo que não ter marco');
  passou('dataDeCorte escolhe sempre o corte mais recente dos dois');
}

console.log(`\n${ok}/1 blocos OK`);
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node scripts/smoke-escala-marco-zero.js
```
Esperado: `TypeError: SS.dataDeCorte is not a function`

- [ ] **Passo 3: implementar**

Em `scale-service.js`, logo depois de `dozeMesesAntes`:

```js
  /**
   * PURO: de que data a contagem do rodízio começa a valer.
   *
   * Dois cortes, vence o mais recente: a janela de 12 meses móveis (que já
   * existia) e o MARCO ZERO configurável (Rafael, 28/08/2026 — "a contagem
   * começa em 01/09, e dá pra zerar na virada do ano"). O marco é um PISO, não
   * um substituto: passado um ano dele, os 12 meses voltam a mandar sozinhos e
   * ninguém precisa lembrar de mexer em nada.
   */
  function dataDeCorte(dataISO, marcoZero) {
    const doze = dozeMesesAntes(dataISO);
    if (!marcoZero) return doze;
    if (!doze) return marcoZero;
    return doze > marcoZero ? doze : marcoZero;
  }
```

E exportar: acrescentar `dataDeCorte` na lista de retorno (linha ~1082).

- [ ] **Passo 4: rodar e ver passar**

```bash
node scripts/smoke-escala-marco-zero.js
```
Esperado: `✓ dataDeCorte escolhe sempre o corte mais recente dos dois` e `1/1 blocos OK`

- [ ] **Passo 5: commit**

```bash
git add scale-service.js scripts/smoke-escala-marco-zero.js
git commit -m "feat(escala): dataDeCorte — marco zero como piso da janela de 12 meses"
```

---

## Task 2: o motor passa a respeitar o marco zero

**Arquivos:**
- Modificar: `scale-service.js:828-829` (dentro de `consolidate`)
- Modificar: `scripts/smoke-escala-marco-zero.js`

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar em `scripts/smoke-escala-marco-zero.js`, antes do `console.log` final:

```js
const makeFakeDb = require('./_fake-firestore.js');
const SE = require('../scale-engine.js');

// ── o motor respeita o marco zero ──
(async () => {
  const db = makeFakeDb();
  const d = { db, ts: () => 'TS', uid: () => 'tester', SE };

  const vaga = (id) => ({ id, unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: null, startTime: '08:00', endTime: '12:00' });
  const nova = async (date) => (await SS.createScale({ date, tipo: 'sabado', slots: [vaga('v1')] }, d)).data.id;

  // Histórico ANTES do marco: a ana pegou 3 sábados de agosto.
  const antigas = ['2026-08-01', '2026-08-08', '2026-08-15'].map(date => ({
    id: `old_${date}`, date, tipo: 'sabado',
    slots: [{ id: 'v1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: 'ana' }],
  }));

  const teachers = [
    { id: 'ana', modalityIds: ['TOI'] },
    { id: 'bru', modalityIds: ['TOI'] },
  ];
  const ctxBase = { teachers, meritoById: { ana: 100, bru: 0 }, scalesDoAno: antigas, opts: { minMes: 1 } };

  // SEM marco zero: os 3 sábados de agosto contam, a ana está atrás no rodízio.
  const semMarco = await nova('2026-09-05');
  await SS.consolidate(semMarco, Object.assign({}, ctxBase, { marcoZero: null }), d);
  const r1 = await SS.getScale(semMarco, d);
  assert.strictEqual(r1.data.slots[0].assignedPersonId, 'bru',
    'sem marco zero, agosto conta e a ana cede a vez');
  passou('sem marco zero, o histórico anterior pesa no rodízio');

  // COM marco zero em 01/09: agosto some da conta, empatam em 0, decide o mérito.
  const comMarco = await nova('2026-09-12');
  await SS.consolidate(comMarco, Object.assign({}, ctxBase, { marcoZero: '2026-09-01' }), d);
  const r2 = await SS.getScale(comMarco, d);
  assert.strictEqual(r2.data.slots[0].assignedPersonId, 'ana',
    'com marco zero, agosto não conta: empatam em 0 e o mérito desempata');
  passou('marco zero apaga o histórico anterior para o motor');

  // Sem ctx.marcoZero, lê da config — e a config manda.
  await SS.ScaleConfigService.save({ marcoZero: '2026-09-01' }, d);
  const daConfig = await nova('2026-09-19');
  await SS.consolidate(daConfig, ctxBase, d);
  const r3 = await SS.getScale(daConfig, d);
  assert.strictEqual(r3.data.slots[0].assignedPersonId, 'ana',
    'quem não passa ctx.marcoZero recebe o valor da config, não zero');
  passou('consolidate lê o marco zero da config quando o ctx não manda');

  console.log(`\n${ok}/4 blocos OK`);
})();
```

E remover o `console.log` antigo do fim do arquivo (o novo está dentro do async).

- [ ] **Passo 2: rodar e ver falhar**

```bash
node scripts/smoke-escala-marco-zero.js
```
Esperado: falha em `'com marco zero, agosto não conta'` — hoje `consolidate` ignora `marcoZero`
e a ana continua atrás no rodízio (vem `bru`).

- [ ] **Passo 3: implementar**

Em `scale-service.js`, dentro de `consolidate`, trocar as linhas 828-829:

```js
      const ate = scale.date;
      const de = dozeMesesAntes(scale.date);
```

por:

```js
      const ate = scale.date;
      // Marco zero: o ctx manda (é como os testes injetam), senão vale a config.
      // Ler AQUI DENTRO e não confiar no chamador é de propósito: chamador que
      // esquecesse de passar faria o rodízio decidir num universo diferente sem
      // erro nenhum — a falha silenciosa clássica desta base.
      let marcoZero = ctx.marcoZero;
      if (marcoZero === undefined) {
        const cfg = await ScaleConfigService.get(deps);
        marcoZero = (cfg.success && cfg.data && cfg.data.marcoZero) || null;
      }
      const de = dataDeCorte(scale.date, marcoZero);
```

E no JSDoc de `consolidate` (linha ~788), acrescentar à lista de chaves do `ctx`:

```
   *   - {string|null} marcoZero — data a partir da qual a contagem vale
   *     (`YYYY-MM-DD`). Se a chave NÃO vier, a função lê de `scale_config`;
   *     passar `null` explicitamente desliga o marco.
```

- [ ] **Passo 4: rodar e ver passar**

```bash
node scripts/smoke-escala-marco-zero.js && node scripts/smoke-escala-contagem.js && node scripts/smoke-scale-service.js
```
Esperado: `4/4 blocos OK` no primeiro, e os outros dois seguem passando (nenhum deles configura
`marcoZero`, então `dataDeCorte` devolve os 12 meses de sempre).

- [ ] **Passo 5: commit**

```bash
git add scale-service.js scripts/smoke-escala-marco-zero.js
git commit -m "feat(escala): consolidate respeita o marco zero da config"
```

---

> ⚠️ **Achado da revisão da Task 2, que vale para todas as tarefas seguintes:** o valor de
> `marcoZero` lido da config é blindado contra formato inválido dentro de `consolidate`, mas
> **`ctx.marcoZero` explícito não é** — ele passa direto para `dataDeCorte`. Hoje é seguro,
> porque o único caminho que usa `ctx.marcoZero` são os testes, com valores fixos.
>
> **Regra daqui pra frente: nenhuma tarefa da tela pode passar `ctx.marcoZero`.** Deixe
> `consolidate` ler a config sozinha — é uma leitura barata por data e é o que garante a
> blindagem. Se algum dia alguém quiser passar via `ctx` para economizar leituras num lote,
> **mova antes a validação de formato para dentro de `dataDeCorte`**, que é o ponto único e já
> testado isoladamente. Sem isso, a blindagem vira letra morta nesse caminho.

## Task 3: a tela conta a partir do marco zero

**Arquivos:**
- Modificar: `professores-escala-smart.js:215-227` (`escalaContagens`), `:280-294` (título do painel)

- [ ] **Passo 1: implementar `escalaContagens`**

Trocar a função inteira por:

```js
function escalaContagens(tipo) {
  const scales = EscalaSmartState.scales || [];
  const tipos = ScaleService.tiposIrmaos(tipo || 'sabado');
  const ano = String(EscalaSmartState.year);
  const lote = escalaJanelaDoTipo(tipo);
  // O marco zero corta o histórico do ano do mesmo jeito que corta o do motor —
  // senão a tela mostraria dias que o rodízio não enxerga, que é exatamente a
  // divergência silenciosa que esta frente existe pra matar.
  const marco = (EscalaSmartState.config || {}).marcoZero || null;
  const deAno = (marco && marco > `${ano}-01-01`) ? marco : `${ano}-01-01`;
  return {
    lote, marco, deAno,
    janela: lote.id
      ? ScaleService.contarPorPessoa(scales, { tipos, batchId: lote.id })
      : {},
    ano: ScaleService.contarPorPessoa(scales, { tipos, de: deAno, ate: `${ano}-12-31` }),
  };
}
```

- [ ] **Passo 2: dizer isso na tela**

Em `renderEquilibrioPainel`, trocar o `return` final (linha ~286) para acrescentar a linha do
marco logo abaixo do título:

```js
  const marcoHtml = c.marco
    ? `<div style="font-size:11px;color:var(--text3);margin-bottom:6px;">Contando a partir de ${ScaleService.fmtDataLonga(c.marco)}.</div>`
    : '';

  return `<div style="margin-bottom:14px;">
    <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">${titulo}</div>
    ${marcoHtml}
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;">
      ${bloco('abaixo', '#2a1414', 'var(--red)',   '↓', 'ainda não pegou nenhum')}
      ${bloco('media',  '#10241a', 'var(--green)', '=', 'na média')}
      ${bloco('acima',  '#2a2410', '#caa23a',      '↑', 'acima')}
    </div>
    ${foraHtml}
  </div>`;
```

⚠️ `ScaleService.fmtDataLonga` só existe a partir da **Task 12**. Até lá, use `escalaFmtBR(c.marco)`
e troque na Task 12 — ou execute a Task 12 antes desta. O plano assume a segunda opção não
tomada: deixe `escalaFmtBR` aqui e a Task 12 faz a troca.

- [ ] **Passo 3: verificar no navegador**

Abrir a Escala Inteligente no staging e conferir que o painel de Equilíbrio mostra
"Contando a partir de 01/09/2026" (depois da Task 4, que cria o campo).

- [ ] **Passo 4: commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala): a tela conta a partir do marco zero e diz isso"
```

---

## Task 4: tela de configuração do marco zero

**Arquivos:**
- Modificar: `professores-escala-smart.js` (nova função + chamada em `renderEscalaGestao`)

- [ ] **Passo 1: escrever a função**

Acrescentar antes de `renderEscalaGestao`:

```js
/**
 * ⚙️ Configurações da escala — hoje só o marco zero.
 *
 * `scale_config` é `write: isAdmin()` nas Security Rules, então o bloco só
 * aparece pra Admin: mostrar um campo que a Supervisão não consegue gravar
 * seria prometer o que a regra nega.
 */
function renderConfigEscalaHtml() {
  if (!(typeof isAdminGestao === 'function' && isAdminGestao())) return '';
  const marco = (EscalaSmartState.config || {}).marcoZero || '';
  return `<details style="margin-bottom:12px;">
    <summary style="cursor:pointer;font-size:13px;color:var(--text2);">⚙️ Configurações da escala</summary>
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px;margin-top:8px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px;">A contagem de justiça começa em</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:8px;">
        Tudo antes desta data não conta — nem na tela, nem na hora de montar a escala.
        Use na virada do ano para zerar o rodízio (ex.: 01/01/2027).
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="date" class="input" id="escalaMarcoZero" style="max-width:190px;" value="${marco}">
        <button class="btn-primary" onclick="salvarMarcoZero()">Salvar</button>
        ${marco ? `<button class="btn-secondary" onclick="salvarMarcoZero(true)">Tirar o marco</button>` : ''}
      </div>
    </div>
  </details>`;
}

async function salvarMarcoZero(limpar) {
  const el = document.getElementById('escalaMarcoZero');
  const antes = (EscalaSmartState.config || {}).marcoZero || null;
  const novo = limpar ? null : ((el && el.value) || null);
  if (novo && !/^\d{4}-\d{2}-\d{2}$/.test(novo)) { toast('Data inválida.', 'error'); return; }
  if (novo === antes) { toast('Nada mudou.', 'info'); return; }
  if (!confirm(`A contagem passa a começar em ${novo ? escalaFmtBR(novo) : '— sem marco —'}.\n\n`
             + `Isso muda o número que o rodízio usa para decidir quem trabalha. `
             + `Nenhuma escala já montada é alterada agora.\n\nContinuar?`)) return;
  const res = await ScaleService.ScaleConfigService.save({ marcoZero: novo });
  if (!res || res.success === false) { toast('Erro ao salvar: ' + ((res && res.error) || 'falha'), 'error'); return; }
  if (typeof AuditService === 'object') {
    await AuditService.log({
      type: 'scale_marco_zero', module: 'agenda',
      details: `Marco zero da contagem: ${antes || '—'} → ${novo || '—'}`,
      entityType: 'scale_config', entityId: 'default',
      before: { marcoZero: antes }, after: { marcoZero: novo },
    });
  }
  toast('Marco zero salvo.', 'success');
  await escalaLoadBase();
  renderEscalaGestao();
}
```

- [ ] **Passo 2: pendurar na tela**

Em `renderEscalaGestao`, no `container.innerHTML` final (linha ~445), acrescentar
`${renderConfigEscalaHtml()}` logo depois do `page-hdr` e antes de `renderEquilibrioPainel()`.

- [ ] **Passo 3: verificar no navegador**

No staging, como Admin: abrir a Escala Inteligente, abrir ⚙️ Configurações, gravar `2026-09-01`,
recarregar a página e confirmar que o valor voltou preenchido e que o painel de Equilíbrio
passou a dizer "Contando a partir de 01/09/2026".

- [ ] **Passo 4: commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala): tela para configurar o marco zero da contagem"
```

---

## Task 5: o ajuste manual sai do serviço e do motor

**Arquivos:**
- Modificar: `scale-service.js:505-536` (remover), `:852-864` (remover o uso), `:1082` (exports),
  `:755-793` (JSDoc)
- Modificar: `scripts/smoke-escala-contagem.js`, `scripts/smoke-scale-service.js`

- [ ] **Passo 1: escrever o teste que falha**

Em `scripts/smoke-escala-marco-zero.js`, dentro do bloco async, antes do `console.log` final:

```js
  // ── o ajuste manual não existe mais para o motor ──
  // Rodrigo usou o "+ dias fora" achando que editava o contador da janela e
  // levou a Heloísa de 4 para 7 (26/08). O caminho foi apagado: a contagem vem
  // SÓ das escalas. Este teste é de comportamento, não de texto — ler o arquivo
  // foi o que deixou a prévia quebrada passar 12 vezes.
  const semAjuste = await nova('2026-09-26');
  await SS.consolidate(semAjuste, Object.assign({}, ctxBase, { marcoZero: '2026-09-01' }), d);
  const esperado = (await SS.getScale(semAjuste, d)).data.slots[0].assignedPersonId;

  const comAjuste = await nova('2026-10-03');
  await SS.consolidate(comAjuste, Object.assign({}, ctxBase, {
    marcoZero: '2026-09-01', ajusteById: { ana: 99 },
  }), d);
  const obtido = (await SS.getScale(comAjuste, d)).data.slots[0].assignedPersonId;
  assert.strictEqual(obtido, esperado,
    'ajusteById é ignorado: mandar 99 dias não pode mudar quem é escolhido');

  assert.strictEqual(typeof SS.saveAjustePartida, 'undefined', 'saveAjustePartida foi removida');
  assert.strictEqual(typeof SS.listAjustes, 'undefined', 'listAjustes foi removida');
  assert.strictEqual(typeof SS.getFairness, 'undefined', 'getFairness foi removida');
  passou('o ajuste manual não influencia mais o motor');
```

Ajustar o contador final para `5/5 blocos OK`.

⚠️ As duas datas do teste são vizinhas de 7 dias de nada nesta base (26/09 e 03/10 distam 7 dias
— a regra de vizinhança olha `scalesDoAno`, e a escala de 26/09 já estará gravada, mas **não**
está em `ctxBase.scalesDoAno`, que é a lista fixa `antigas`). Por isso as duas decidem no mesmo
universo e a comparação é justa.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node scripts/smoke-escala-marco-zero.js
```
Esperado: falha em `'saveAjustePartida foi removida'` (ainda existe) — e, dependendo da ordem,
antes disso em `'ajusteById é ignorado'`, porque hoje 99 dias jogam a ana pro fim da fila.

- [ ] **Passo 3: implementar**

1. Em `scale-service.js`, **apagar** as funções `getFairness` (linha ~509), `saveAjustePartida`
   (~517) e `listAjustes` (~527), junto com o bloco de comentário acima delas.
2. Em `consolidate`, trocar:

```js
      const ajustes = ctx.ajusteById || {};
      const fairnessById = {};
      teachers.forEach(t => {
        const ajuste = Math.max(0, Number(ajustes[t.id]) || 0);
        fairnessById[t.id] = {
          diasTrabalhados: (contagem[t.id] || 0) + ajuste,
          divida: 0,
        };
      });
```

por:

```js
      // A contagem vem SÓ das escalas. O "ajuste de partida" lançado na mão foi
      // aposentado em 28/08/2026 (pedido 1 do Rodrigo, aprovado pelo Rafael):
      // era um segundo caminho para o mesmo número, e foi por ele que a Heloísa
      // saiu de 4 para 7. Um caminho só não tem como divergir.
      const fairnessById = {};
      teachers.forEach(t => {
        fairnessById[t.id] = { diasTrabalhados: contagem[t.id] || 0, divida: 0 };
      });
```

3. Nos exports (linha ~1082), remover `getFairness, saveAjustePartida, listAjustes,`.
4. No JSDoc de `consolidate`, remover as linhas sobre `ajusteById` (~790-793) e a menção a ele
   na lista das três chaves que degradam o rodízio (~757).

- [ ] **Passo 4: consertar os testes que ancoravam o ajuste**

Em `scripts/smoke-scale-service.js`, apagar o bloco "── Ajuste de partida ──" (linhas ~45-56) e
a linha 100 (`'consolidar não mexe no ajuste de partida'`).

Em `scripts/smoke-escala-contagem.js`:
- apagar o bloco de `getFairness`/`saveAjustePartida`/`listAjustes` (linhas ~187-201)
- apagar o bloco que passa `ctx.ajusteById = { duda: 5 }` (~238)
- apagar as duas asserções de texto de UI (~328-329)
- no stub de `ScaleService` (~495), remover `listAjustes`

- [ ] **Passo 5: rodar e ver passar**

```bash
node scripts/smoke-escala-marco-zero.js && node scripts/smoke-scale-service.js && node scripts/smoke-escala-contagem.js && node scripts/smoke-scale-engine.js
```
Esperado: todos passam, `5/5 blocos OK` no primeiro.

- [ ] **Passo 6: commit**

```bash
git add scale-service.js scripts/smoke-escala-marco-zero.js scripts/smoke-scale-service.js scripts/smoke-escala-contagem.js
git commit -m "feat(escala): o ajuste manual sai do motor — a contagem vem so das escalas"
```

---

## Task 6: o ajuste manual sai da tela

**Arquivos:**
- Modificar: `professores-escala-smart.js:9` (state), `:120-121`, `:240`, `:253-261`, `:522`,
  `:533-536`, `:561`, `:571`, `:581`, `:1140-1190`, `:1593`, `:1873`, `:1902`
- Modificar: `scripts/smoke-ajustes-escala-2508.js:113`, `scripts/smoke-ajuste-contador-rotulo.js`

- [ ] **Passo 1: apagar da tela**

1. `EscalaSmartState` (linha 9): remover `ajusteMap: {},`
2. `escalaLoadBase` (linhas 120-121): remover as duas linhas do `listAjustes`
3. `renderEquilibrioPainel`: remover `const ajustes = …` (240); em `grupos[g].push`, remover
   `ajuste: (ajustes[t.id] || 0)`; na função `linha`, o `<span>` da direita vira:

```js
  const linha = (x) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:3px 0;font-size:12px;">
      <span>${escalaEsc(x.t.name)}</span>
      <span style="display:flex;align-items:center;gap:6px;color:var(--text2);white-space:nowrap;">
        ${x.n} nesta janela · ${x.ano} no ano
      </span>
    </div>`;
```

(o botão volta na Task 18, já como **Ajustar** do rebalanceio)

4. `renderTabPorPessoa`: remover `const ajuste = …` (522) e o cartão "Lançado na mão" (533-536)
5. `escalaHistoricoAnoHtml`: remover `const ajustes = …` (561), o `aj:` do `.map`, o
   `.filter(x => x.sab || x.fer || x.aj)` vira `.filter(x => x.sab || x.fer)`, a `<td>` do
   ajuste (571) e a `<th>` "Lançado na mão" (581)
6. **Apagar a função `ajustarContadorJustica` inteira** (linhas 1140-1190)
7. Remover as três linhas `ajusteById: EscalaSmartState.ajusteMap || {},` (1593, 1873, 1902) e
   os comentários de duas linhas acima de cada uma

- [ ] **Passo 2: consertar os smokes de texto**

`scripts/smoke-ajuste-contador-rotulo.js` inteiro deixa de fazer sentido — ele ancora o rótulo
do botão que está sendo apagado. **Substituir o conteúdo** por:

```js
'use strict';
// Roda: node scripts/smoke-ajuste-contador-rotulo.js
//
// O "+ dias fora" ACABOU em 28/08/2026 (pedido 1 do Rodrigo, aprovado pelo
// Rafael): a contagem vem só das escalas. Este arquivo virou a trava contra a
// volta dele — se alguém reintroduzir o caminho manual, quebra aqui.
const assert = require('assert');
const fs = require('fs');

const ui = fs.readFileSync(`${__dirname}/../professores-escala-smart.js`, 'utf8');
const svc = fs.readFileSync(`${__dirname}/../scale-service.js`, 'utf8');

assert.ok(!/ajustarContadorJustica/.test(ui), 'a função do ajuste manual não existe mais na tela');
assert.ok(!/ajusteMap/.test(ui), 'o mapa de ajustes saiu do estado da tela');
assert.ok(!/ajusteById/.test(ui), 'a tela não manda mais ajuste pro motor');
assert.ok(!/\+ dias fora/.test(ui), 'o botão "+ dias fora" saiu da tela');
assert.ok(!/saveAjustePartida|listAjustes|getFairness/.test(svc), 'o serviço não tem mais ajuste de partida');
assert.ok(!/ajusteById/.test(svc), 'o motor não lê mais ajuste de partida');

console.log('✓ smoke-ajuste-contador-rotulo: o ajuste manual não voltou (6/6)');
```

Em `scripts/smoke-ajustes-escala-2508.js`, apagar a asserção da linha 113
(`/ScaleService\.saveAjustePartida\(/`) e o comentário dela.

- [ ] **Passo 3: rodar**

```bash
node scripts/smoke-ajuste-contador-rotulo.js && node scripts/smoke-ajustes-escala-2508.js && node scripts/smoke-escala-contagem.js
```
Esperado: os três passam.

- [ ] **Passo 4: conferir no navegador**

Staging: abrir a Escala Inteligente, expandir os três blocos do painel de Equilíbrio e confirmar
que **nenhum** botão aparece ao lado dos nomes, e que a aba Por pessoa não mostra mais o cartão
"Lançado na mão". Console sem erro.

- [ ] **Passo 5: commit**

```bash
git add professores-escala-smart.js scripts/smoke-ajuste-contador-rotulo.js scripts/smoke-ajustes-escala-2508.js
git commit -m "feat(escala): o botao + dias fora sai da tela"
```

---

## Task 7: script de migração — zerar os ajustes gravados

**Arquivos:**
- Criar: `scripts/zerar-ajustes-partida.js`

- [ ] **Passo 1: escrever o script**

```js
'use strict';
// Roda: node scripts/zerar-ajustes-partida.js --project staging [--aplicar]
//
// O "ajuste de partida" (fairness_counter.ajuste) foi aposentado em 28/08/2026:
// era um segundo caminho para o contador de justiça, e foi por ele que a Heloísa
// saiu de 4 para 7 sábados. Zerar aqui NÃO mexe em escala nenhuma — muda o
// número, não a escala. Nenhuma data é remontada, nenhuma aula sai da agenda,
// ninguém é reavisado (Rafael, 28/08: "não mexa em nada").
//
// Sem --aplicar, só mostra o que faria.

const fs = require('fs');
const admin = require('firebase-admin');

const args = process.argv.slice(2);
const projeto = (args[args.indexOf('--project') + 1] || '').trim();
const aplicar = args.includes('--aplicar');
if (projeto !== 'staging' && projeto !== 'production') {
  console.error('Use: --project staging | --project production');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(`./serviceAccount-${projeto}.json`)),
});
const db = admin.firestore();

(async () => {
  const snap = await db.collection('fairness_counter').get();
  const nomes = {};
  (await db.collection('teachers').get()).docs.forEach(d => { nomes[d.id] = (d.data() || {}).name || d.id; });

  const linhas = snap.docs
    .map(d => ({ id: d.id, ajuste: Number((d.data() || {}).ajuste) || 0 }))
    .filter(x => x.ajuste !== 0);

  if (!linhas.length) { console.log('Nada a zerar: nenhum ajuste diferente de zero.'); process.exit(0); }

  const backup = `${__dirname}/../backups/fairness-ajustes-${projeto}-${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(backup, JSON.stringify(linhas, null, 2));
  console.log(`Backup: ${backup}\n`);

  console.log('Pessoa                          antes → depois');
  linhas.forEach(x => console.log(`${(nomes[x.id] || x.id).padEnd(30)}  ${String(x.ajuste).padStart(3)} → 0`));
  console.log(`\n${linhas.length} pessoa(s).`);

  if (!aplicar) { console.log('\n(simulação — rode com --aplicar para gravar)'); process.exit(0); }

  for (const x of linhas) {
    await db.collection('fairness_counter').doc(x.id).set({ ajuste: 0, zeradoEm: new Date().toISOString() }, { merge: true });
  }
  console.log(`\n✅ ${linhas.length} ajuste(s) zerado(s).`);
  process.exit(0);
})();
```

- [ ] **Passo 2: rodar em simulação no staging**

```bash
node scripts/zerar-ajustes-partida.js --project staging
```
Esperado: lista `pessoa antes → depois` e a linha `(simulação — rode com --aplicar para gravar)`.
Nenhuma escrita.

- [ ] **Passo 3: aplicar no staging**

```bash
node scripts/zerar-ajustes-partida.js --project staging --aplicar
```
Esperado: `✅ N ajuste(s) zerado(s).` e o arquivo de backup em `backups/`.

- [ ] **Passo 4: commit**

```bash
git add scripts/zerar-ajustes-partida.js
git commit -m "chore(escala): script para zerar os ajustes de partida, com backup"
```

⚠️ **Produção fica para a Task 25** (o rótulo "Task 24" acima era um erro de digitação já
existente no plano), depois da homologação (regra inviolável 7).

> 🚨 **Emenda (sessão 61, execução da Task 7).** O script foi implementado com **`--executar`**,
> não `--aplicar` como no texto acima — os três scripts de migração vizinhos
> (`apagar-aulas-julho.js`, `limpar-grade-em-dia-de-escala.js`, `refazer-escalas-com-rodizio.js`)
> usam todos `--executar` com o mesmo par de comentários `Ensaio:`/`Pra valer:`, e é essa a
> convenção real do projeto para "ensaio por padrão, só grava com a flag". O caminho do
> `serviceAccount` também seguiu o padrão dos vizinhos: `path.join(__dirname, ...)`, não
> `require('./...')`. E `zeradoEm` grava `admin.firestore.FieldValue.serverTimestamp()` (como
> `updatedAt` nos vizinhos), não `new Date().toISOString()` — é um campo simples, não dentro de
> array, então `serverTimestamp()` funciona normalmente. **A Task 25 (Passo 3, linhas com
> `zerar-ajustes-partida.js --project production`) precisa usar `--executar`, não `--aplicar`.**

---

# BLOCO B — Log de alterações

## Task 8: helpers puros do histórico

**Arquivos:**
- Modificar: `scale-service.js` (funções novas + exports)
- Criar: `scripts/smoke-escala-historico.js`

- [ ] **Passo 1: escrever o teste que falha**

```js
'use strict';
// Roda: node scripts/smoke-escala-historico.js
//
// Pedido 6 do Rodrigo (28/08/2026): "log de alteração por usuário". Hoje só a
// troca de vaga grava algo; consolidar, refazer, publicar, despublicar, inverter
// e tirar do lote não deixam rastro nenhum. E o pouco que é gravado não aparece:
// `audit_log` é read-only-Admin e a tela de Auditoria filtra por unidade.
// Por isso o histórico mora DENTRO do documento da escala.
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

// ── appendHistorico (puro) ──
{
  const e = (n) => ({ ts: `2026-08-28T00:00:0${n}.000Z`, uid: 'u', nome: 'Rodrigo', acao: 'publicada', detalhe: `#${n}` });
  let l = SS.appendHistorico(null, e(1), 3);
  assert.strictEqual(l.length, 1, 'lista vazia aceita a primeira entrada');
  l = SS.appendHistorico(l, e(2), 3);
  l = SS.appendHistorico(l, e(3), 3);
  l = SS.appendHistorico(l, e(4), 3);
  assert.strictEqual(l.length, 3, 'o cap corta a lista');
  assert.deepStrictEqual(l.map(x => x.detalhe), ['#2', '#3', '#4'], 'a mais VELHA é a que sai');
  passou('appendHistorico acumula e corta pelas mais velhas');
}

// ── diffEscalados (puro) ──
{
  const nomes = { hel: 'Heloísa', car: 'Carla', bru: 'Bruno' };
  const antes = [
    { id: 'cp_TOI', unitId: 'cp', requiredModalityName: 'TOI', assignedPersonId: 'hel' },
    { id: 'cp_HIIT', unitId: 'cp', requiredModalityName: 'Hiit', assignedPersonId: 'bru' },
  ];
  const depois = [
    { id: 'cp_TOI', unitId: 'cp', requiredModalityName: 'TOI', assignedPersonId: 'car' },
    { id: 'cp_HIIT', unitId: 'cp', requiredModalityName: 'Hiit', assignedPersonId: 'bru' },
  ];
  assert.strictEqual(SS.diffEscalados(antes, depois, nomes),
    'saiu Heloísa, entrou Carla (TOI)', 'diz quem saiu e quem entrou, por nome');
  assert.strictEqual(SS.diffEscalados(antes, antes, nomes), 'nada mudou',
    'sem mudança, diz que nada mudou');
  const vazia = [{ id: 'cp_TOI', unitId: 'cp', requiredModalityName: 'TOI', assignedPersonId: null }];
  assert.strictEqual(SS.diffEscalados(vazia, antes.slice(0, 1), nomes),
    'entrou Heloísa (TOI)', 'vaga que estava aberta só registra quem entrou');
  passou('diffEscalados descreve a mudança por nome');
}

console.log(`\n${ok}/2 blocos OK`);
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node scripts/smoke-escala-historico.js
```
Esperado: `TypeError: SS.appendHistorico is not a function`

- [ ] **Passo 3: implementar**

Em `scale-service.js`, antes de `consolidate`:

```js
  // ── Histórico da escala (pedido 6, 28/08/2026) ──────────────────────
  // Mora DENTRO do documento da escala, e não em `audit_log`, por um motivo
  // duro: `audit_log` é `allow read: if isAdmin()`. A Supervisão, que é gestão
  // para todo o resto da escala, não conseguiria ler — a tela nasceria invisível
  // para metade de quem precisa dela. `special_scales` já é legível pelo módulo.
  const HISTORICO_MAX = 50;

  /** PURO: acrescenta uma entrada e corta as mais velhas. */
  function appendHistorico(lista, entrada, max) {
    const cap = max || HISTORICO_MAX;
    const out = (Array.isArray(lista) ? lista.slice() : []).concat([entrada]);
    return out.length > cap ? out.slice(out.length - cap) : out;
  }

  /** PURO: o que mudou entre dois conjuntos de vagas, por NOME. */
  function diffEscalados(antes, depois, nomePorId) {
    const nome = (id) => (nomePorId && nomePorId[id]) || id;
    const mapa = {};
    (antes || []).forEach(s => { mapa[s.id] = { antes: s.assignedPersonId || null, slot: s }; });
    const partes = [];
    (depois || []).forEach(s => {
      const a = (mapa[s.id] || {}).antes || null;
      const b = s.assignedPersonId || null;
      if (a === b) return;
      const rot = s.requiredModalityName ? ` (${s.requiredModalityName})` : '';
      if (a && b) partes.push(`saiu ${nome(a)}, entrou ${nome(b)}${rot}`);
      else if (b) partes.push(`entrou ${nome(b)}${rot}`);
      else partes.push(`saiu ${nome(a)}${rot}`);
    });
    return partes.length ? partes.join(' · ') : 'nada mudou';
  }

  /**
   * Grava uma linha no histórico da escala. Efeito colateral: se falhar, NÃO
   * derruba a ação que estava sendo registrada — log perdido é ruim, ação
   * perdida pela metade é pior.
   *
   * `ts` é string ISO do cliente de propósito: o Firestore recusa
   * `serverTimestamp()` dentro de array.
   */
  async function registrarHistorico(scaleId, { acao, detalhe, nome }, deps) {
    try {
      const ref = rdb(deps).collection('special_scales').doc(scaleId);
      const doc = await ref.get();
      if (!doc.exists) return { success: false, error: 'Escala não encontrada' };
      const entrada = {
        ts: new Date().toISOString(), uid: ruid(deps) || null,
        nome: nome || null, acao: acao || 'alterada', detalhe: detalhe || '',
      };
      await ref.set({ historico: appendHistorico((doc.data() || {}).historico, entrada) }, { merge: true });
      return { success: true, data: entrada };
    } catch (err) {
      console.warn('[ScaleService.registrarHistorico] log perdido, ação mantida', err);
      return { success: false, error: err.message };
    }
  }
```

Exportar `appendHistorico, diffEscalados, registrarHistorico` na linha ~1082.

- [ ] **Passo 4: rodar e ver passar**

```bash
node scripts/smoke-escala-historico.js
```
Esperado: `2/2 blocos OK`

- [ ] **Passo 5: commit**

```bash
git add scale-service.js scripts/smoke-escala-historico.js
git commit -m "feat(escala): helpers do historico dentro do documento da escala"
```

---

## Task 9: as ações do serviço passam a gravar histórico

**Arquivos:**
- Modificar: `scale-service.js` — `openElection`, `consolidate`, `consolidateByDay`,
  `publishToAgenda`, `unpublishFromAgenda`, `reassignSlot`, `swapSlots`
- Modificar: `scripts/smoke-escala-historico.js`

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar em `scripts/smoke-escala-historico.js`, antes do `console.log` final:

```js
const SE = require('../scale-engine.js');

(async () => {
  const db = makeFakeDb();
  const d = { db, ts: () => 'TS', uid: () => 'tester', SE };
  const slots = [{ id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'TOI', requiredModalityName: 'TOI', assignedPersonId: null, startTime: '08:00', endTime: '12:00' }];
  const id = (await SS.createScale({ date: '2026-09-05', tipo: 'sabado', slots }, d)).data.id;

  await SS.openElection(id, null, d);
  await SS.consolidate(id, { teachers: [{ id: 'ana', modalityIds: ['TOI'] }], meritoById: { ana: 1 }, scalesDoAno: [], marcoZero: null, opts: { minMes: 1 } }, d);
  await SS.publishToAgenda(id, d);
  await SS.reassignSlot(id, 'cp_TOI', 'bru', d);
  await SS.unpublishFromAgenda(id, d);

  // E o refazer se identifica como refazer, não como uma montagem qualquer.
  await SS.consolidate(id, { teachers: [{ id: 'ana', modalityIds: ['TOI'] }], meritoById: { ana: 1 }, scalesDoAno: [], marcoZero: null, opts: { minMes: 1 }, acaoHistorico: 'refeita' }, d);

  const h = (await SS.getScale(id, d)).data.historico || [];
  const acoes = h.map(x => x.acao);
  assert.deepStrictEqual(acoes, ['janela_aberta', 'consolidada', 'publicada', 'vaga_trocada', 'despublicada', 'refeita'],
    'as seis ações gravam, na ordem em que aconteceram, e refazer não se confunde com montar');
  assert.ok(h.every(x => typeof x.ts === 'string' && x.ts.length >= 20), 'toda entrada tem carimbo ISO');
  assert.ok(h.every(x => x.uid === 'tester'), 'toda entrada diz quem fez');
  assert.ok(/bru|entrou/.test(h[3].detalhe), 'a troca de vaga diz o que mudou');
  passou('as ações do serviço deixam rastro no documento da escala');

  console.log(`\n${ok}/3 blocos OK`);
})();
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node scripts/smoke-escala-historico.js
```
Esperado: `AssertionError` — `acoes` vem `[]`.

- [ ] **Passo 3: implementar**

Em cada função, logo antes do `return { success: true … }`:

`openElection` (após gravar o patch):
```js
      await registrarHistorico(scaleId, {
        acao: 'janela_aberta',
        detalhe: (opts && opts.closesAt) ? `janela até ${opts.closesAt}` : 'janela aberta',
      }, deps);
```

`consolidate` (depois do `.set({ slots: newSlots … })`, usando o `scale.slots` de antes):
```js
      // `ctx.acaoHistorico` deixa o REFAZER se identificar como tal. Sem isso,
      // refazer a janela gravaria "🧮 Montada" e a pergunta do Rodrigo — "alguém
      // mexeu?" — continuaria sem resposta, porque montar e REMONTAR ficariam
      // indistinguíveis no histórico.
      await registrarHistorico(scaleId, {
        acao: ctx.acaoHistorico || 'consolidada',
        detalhe: diffEscalados(scale.slots || [], newSlots, ctx.nomePorId || {}),
      }, deps);
```

`consolidateByDay` (mesmo padrão, com `acao: 'consolidada'` e
`detalhe: `${slots.length} vaga(s) em ${days.length} dia(s)``).

`publishToAgenda`:
```js
      await registrarHistorico(scaleId, {
        acao: 'publicada',
        detalhe: `${created} aula(s) na agenda${vagasAbertas.length ? ` · ${vagasAbertas.length} vaga(s) aberta(s)` : ''}`,
      }, deps);
```

`unpublishFromAgenda`:
```js
      await registrarHistorico(scaleId, { acao: 'despublicada', detalhe: `${res.removed} aula(s) removidas da agenda` }, deps);
```

`reassignSlot` (depois do `.set`, antes do `return`):
```js
      await registrarHistorico(scaleId, {
        acao: 'vaga_trocada',
        detalhe: diffEscalados([slot], slots.filter(s => s.id === slotId), (deps && deps.nomePorId) || {}),
      }, deps);
```

`swapSlots`:
```js
      await registrarHistorico(scaleId, {
        acao: 'invertida',
        detalhe: `${(deps && deps.nomePorId || {})[a.assignedPersonId] || a.assignedPersonId || '—'} ⇄ ${(deps && deps.nomePorId || {})[b.assignedPersonId] || b.assignedPersonId || '—'}`,
      }, deps);
```

⚠️ `nomePorId` chega por `ctx` em `consolidate` e por `deps` nas demais (que não têm `ctx`).
Quem chama pela tela passa `{ nomePorId }`; sem ele, o histórico mostra o id — feio, mas nunca
quebra. A tela passa a mandar na Task 11.

- [ ] **Passo 4: rodar e ver passar**

```bash
node scripts/smoke-escala-historico.js && node scripts/smoke-scale-service.js && node scripts/smoke-escala-contagem.js && node scripts/smoke-escala-marco-zero.js
```
Esperado: `3/3 blocos OK` no primeiro e os outros três seguem verdes.

- [ ] **Passo 5: commit**

```bash
git add scale-service.js scripts/smoke-escala-historico.js
git commit -m "feat(escala): consolidar, publicar, despublicar, trocar e inverter deixam rastro"
```

---

## Task 10: `AuditService.log` aceita unidade

**Arquivos:**
- Modificar: `professores-shared.js:291-313`

- [ ] **Passo 1: implementar**

Trocar a assinatura e o campo:

```js
  async log({ type, details, entityType, entityId, before, after, module, unitId }) {
```

e, dentro do `add`:

```js
        // Vinha SEMPRE null, e a tela de Auditoria filtra por unidade: o que era
        // gravado não aparecia para ninguém (achado em 28/08/2026). Continua
        // aceitando ausência — quem não sabe a unidade manda nada e o
        // comportamento é o de antes.
        unitId: unitId || null,
```

- [ ] **Passo 2: verificar que nada quebrou**

```bash
node scripts/smoke-9.js
```
Esperado: passa (nenhum chamador manda `unitId` ainda; o default é idêntico ao de hoje).

- [ ] **Passo 3: commit**

```bash
git add professores-shared.js
git commit -m "feat(auditoria): AuditService.log aceita unitId (default null, igual a hoje)"
```

> 🚨 **Achado da execução (sessão 60) — esta task abre uma porta que NINGUÉM atravessa.**
> Varri o plano inteiro: **nenhuma tarefa das 25 faz um chamador passar `unitId`.** A Task 10
> entrega só a capacidade; o comportamento continua idêntico ao de hoje em todos os 39 chamadores.
> Isso está correto para o escopo desta frente — **o log da escala foi resolvido de outro jeito**
> (mora dentro do documento da escala, Tasks 8 e 9, justamente porque `audit_log` é Admin-only).
> Mas não confunda: **a Task 10 NÃO conserta a invisibilidade do `audit_log`.**
>
> **O problema real, medido, é maior e é pré-existente:**
> - A tela de Auditoria **não é do módulo Professores** — ela mora em `index.html`
>   (`loadAuditLog()`, ~linha 8930), do módulo **Comissões**. As duas frentes escrevem na **mesma**
>   coleção `audit_log`: Comissões pelo `logAudit()` do `index.html` (que **preenche** `unitId`),
>   Professores pelo `AuditService.log` (que gravava **sempre `null`**).
> - A query é igualdade estrita: `.where('unitId','==',currentUnitId).orderBy('timestamp','desc')`.
>   **Não há "todas as unidades".** Logo, **todo** registro do módulo Professores desde sempre é
>   invisível para todo mundo, em qualquer filtro.
> - Sobrou ainda um segundo `unitId: null` **hardcoded** em `professores-shared.js` (~linha 4300),
>   numa escrita direta em `audit_log` que **não passa** pelo `AuditService.log` — quem for fechar
>   esse ciclo precisa pegar os dois caminhos.
> - `firestore.rules` não valida campo nenhum em `audit_log`, então preencher `unitId` no futuro
>   não quebra regra. Já o índice composto `unitId`+`timestamp` **não está** no
>   `firestore.indexes.json` rastreado, embora a tela do Comissões já rode essa query em produção —
>   ou seja, o índice existe na infra e o arquivo está dessincronizado. Conferir antes de mexer.
>
> **Fechar isso é trabalho de outra frente**, com seu próprio plano: são 39 chamadores, e a decisão
> de qual unidade cada evento pertence não é óbvia para eventos globais (o marco zero, por exemplo,
> vale para a academia inteira — não tem unidade para passar).

---

## Task 11: as duas telas de histórico

**Arquivos:**
- Modificar: `professores-escala-smart.js` — `renderEscalaDetail`, `renderEscalaGestao`, e os
  chamadores que passam `nomePorId`

- [ ] **Passo 1: helper de nomes + as duas telas**

Acrescentar perto de `escalaPersonName`:

```js
/** { personId: nome } — o histórico precisa de nome, não de id. */
function escalaNomePorId() {
  const out = {};
  EscalaSmartState.teacherMap.forEach((t, id) => { out[id] = t.name || id; });
  return out;
}

const ESCALA_ACAO_LABEL = {
  janela_aberta: '📨 Janela aberta', consolidada: '🧮 Montada', refeita: '🔄 Refeita',
  publicada: '📅 Publicada', despublicada: '↩️ Despublicada', invertida: '⇄ Invertida',
  vaga_trocada: '✋ Vaga trocada', rebalanceada: '⚖ Rebalanceada', tirada_do_lote: '🚫 Tirada do lote',
};

function escalaHistoricoLinha(h) {
  const quando = String(h.ts || '').slice(0, 16).replace('T', ' ');
  return `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);">
    <span style="color:var(--text3);">${quando}</span>
    · <b>${ESCALA_ACAO_LABEL[h.acao] || h.acao}</b>
    · ${escalaEsc(h.nome || h.uid || '—')}
    ${h.detalhe ? `<div style="color:var(--text2);margin-left:2px;">${escalaEsc(h.detalhe)}</div>` : ''}
  </div>`;
}

/** 🕐 Histórico desta escala — responde "alguém mexeu?" em 5 segundos. */
function escalaHistoricoDaEscalaHtml(scale) {
  const h = ((scale && scale.historico) || []).slice().reverse();
  if (!h.length) return '';
  return `<details style="margin-top:12px;">
    <summary style="cursor:pointer;font-size:12px;color:var(--blue);">🕐 Histórico desta escala (${h.length})</summary>
    <div style="margin-top:6px;">${h.map(escalaHistoricoLinha).join('')}</div>
  </details>`;
}

/** 📜 Últimas alterações do módulo — junta o histórico de tudo que está em memória. */
function escalaHistoricoGeralHtml() {
  const todas = [];
  (EscalaSmartState.scales || []).forEach(s => {
    (s.historico || []).forEach(h => todas.push(Object.assign({}, h, { data: s.date, nomeEscala: s.name || s.date })));
  });
  if (!todas.length) return '';
  todas.sort((a, b) => (a.ts > b.ts ? -1 : 1));
  const linhas = todas.slice(0, 50).map(h => `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);">
      <span style="color:var(--text3);">${String(h.ts || '').slice(0, 16).replace('T', ' ')}</span>
      · <b>${ESCALA_ACAO_LABEL[h.acao] || h.acao}</b>
      · ${escalaEsc(h.nome || h.uid || '—')}
      · <span style="color:var(--text2);">${escalaEsc(h.nomeEscala)}</span>
      ${h.detalhe ? `<div style="color:var(--text2);">${escalaEsc(h.detalhe)}</div>` : ''}
    </div>`).join('');
  return `<details style="margin-top:20px;">
    <summary style="cursor:pointer;font-size:13px;color:var(--blue);">📜 Últimas alterações do módulo (${Math.min(todas.length, 50)})</summary>
    <div style="margin-top:6px;">${linhas}</div>
  </details>`;
}
```

- [ ] **Passo 2: pendurar nas telas**

Em `renderEscalaDetail`, no `return` final do sábado/feriado, acrescentar
`${escalaHistoricoDaEscalaHtml(scale)}` antes do fechamento da `<div>` principal. Fazer o mesmo
em `renderFimDeAnoDetail`, `renderEscolaInternaDetail` e `renderEventoDetail`.

Em `renderEscalaGestao`, no `container.innerHTML` final, acrescentar
`${escalaHistoricoGeralHtml()}` logo antes da `<div id="escalaModalOverlay">`.

- [ ] **Passo 3: mandar os nomes para o serviço**

Nos pontos que chamam o serviço, passar `nomePorId`:

- `escalaMontarCtx()` (linha ~1865) — acrescentar `nomePorId: escalaNomePorId(),` ao objeto devolvido
- `gerarPreviaLote` (linha ~1732, logo depois do `const ctx = await escalaMontarCtx();`) —
  acrescentar a linha abaixo, para o refazer aparecer como refazer no histórico:

```js
  // Veio do 🔄 Refazer? Então o histórico diz "refeita", não "montada".
  ctx.acaoHistorico = (EscalaSmartState.remontando === batchId) ? 'refeita' : 'consolidada';
```
- `confirmarEAvisar` (o `ctx` da linha ~1893) — idem
- `consolidarEscala` (linha ~1549, o `ctx` local) — idem
- `trocarPessoaEscala` → `ScaleService.reassignSlot(scaleId, slotId, personId || null, { nomePorId: escalaNomePorId() })`
- `inverterVagasEscala` → `ScaleService.swapSlots(scaleId, slotAId, slotBId, { nomePorId: escalaNomePorId() })`

⚠️ `deps` no navegador é normalmente `undefined` (o serviço usa os globais `db`/`serverTs`).
Passar `{ nomePorId }` **não** pode quebrar isso: `rdb(deps)` faz `if (deps && deps.db) … else db`
— sem `db` no objeto, cai no global, que é o que queremos. Conferir isso ao rodar.

- [ ] **Passo 4: conferir no navegador**

Staging: publicar uma escala de teste, trocar uma vaga, despublicar. Abrir a data e conferir que
**🕐 Histórico desta escala** lista as três ações com nome de gente e horário. Conferir que
**📜 Últimas alterações do módulo** aparece no rodapé da tela com as mesmas linhas. Console sem
erro.

- [ ] **Passo 5: commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala): historico da escala e ultimas alteracoes do modulo na tela"
```

---

# BLOCO C — Tela

## Task 12: `fmtDataLonga` e a caça à data crua

**Arquivos:**
- Modificar: `scale-service.js` (função nova + export)
- Modificar: `professores-escala-smart.js:359` e os demais pontos da varredura
- Criar: `scripts/smoke-escala-data-formatada.js`

- [ ] **Passo 1: escrever o teste que falha**

```js
'use strict';
// Roda: node scripts/smoke-escala-data-formatada.js
//
// Pedido 8 do Rodrigo (28/08/2026): o cartão da escala imprimia `2026-11-20`
// cru. Duas partes aqui: (1) a função de formatar, testada de verdade — chamada,
// não lida; (2) uma varredura que QUEBRA se alguém voltar a interpolar data crua
// num pedaço de HTML, com lista de exceções explícita para os casos legítimos.
const assert = require('assert');
const fs = require('fs');
const SS = require('../scale-service.js');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

// ── fmtDataLonga (puro) ──
{
  assert.strictEqual(SS.fmtDataLonga('2026-11-20'), 'sexta-feira, 20/11/2026');
  assert.strictEqual(SS.fmtDataLonga('2026-09-05'), 'sábado, 05/09/2026');
  assert.strictEqual(SS.fmtDataLonga('2026-11-02'), 'segunda-feira, 02/11/2026');
  assert.strictEqual(SS.fmtDataLonga('2027-01-01'), 'sexta-feira, 01/01/2027', 'vira o ano sem escorregar');
  assert.strictEqual(SS.fmtDataLonga('2026-03-01'), 'domingo, 01/03/2026', 'primeiro dia do mês não volta pro anterior');
  assert.strictEqual(SS.fmtDataLonga(''), '', 'entrada vazia não quebra');
  assert.strictEqual(SS.fmtDataLonga('20/11/2026'), '20/11/2026', 'entrada fora do formato volta como veio');
  assert.strictEqual(SS.fmtDataLonga(null), '', 'null não quebra');
  passou('fmtDataLonga escreve o dia da semana e a data em português');
}

// ── varredura: data crua em HTML ──
{
  const arquivo = `${__dirname}/../professores-escala-smart.js`;
  const linhas = fs.readFileSync(arquivo, 'utf8').split('\n');

  // Interpolações de data que PODEM ser ISO cru, com o motivo:
  //  - value="${...}" de <input type="date">: o input exige ISO
  //  - argumento de onclick/função: id/chave, não texto pra humano
  //  - comparação/atribuição em JS puro (fora de template de HTML)
  const legitima = (l) =>
    /value="\$\{/.test(l) ||          // input type=date
    /onclick=|onchange=/.test(l) ||   // argumento de handler
    !/</.test(l);                     // linha sem HTML nenhum

  const suspeitas = linhas
    .map((l, i) => ({ n: i + 1, l }))
    .filter(x => /\$\{[^}]*\.date\}/.test(x.l) || /\$\{[^}]*\bday\}/.test(x.l))
    .filter(x => !legitima(x.l));

  assert.deepStrictEqual(suspeitas.map(x => x.n), [],
    'data crua em HTML — use ScaleService.fmtDataLonga ou escalaFmtBR:\n' +
    suspeitas.map(x => `  linha ${x.n}: ${x.l.trim().slice(0, 120)}`).join('\n'));
  passou('nenhuma data crua sobrou na tela da escala');
}

console.log(`\n${ok}/2 blocos OK`);
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node scripts/smoke-escala-data-formatada.js
```
Esperado: `TypeError: SS.fmtDataLonga is not a function`

- [ ] **Passo 3: implementar a função**

Em `scale-service.js`, perto de `dozeMesesAntes`:

```js
  // Dia da semana em array fixo: `Intl`/`toLocaleDateString` dependem do locale
  // do navegador, e a mesma tela mostraria "Friday" em quem estiver com o
  // sistema em inglês. Isto é texto de produto, não de sistema.
  const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

  /**
   * PURO: '2026-11-20' → 'sexta-feira, 20/11/2026'.
   *
   * O cartão da escala imprimia a data crua (Rodrigo, 28/08/2026). Mora no
   * serviço, e não na tela, pra que o teste CHAME a função em vez de ler o texto
   * do arquivo — a lição de 26/08. `T12:00:00` pelo mesmo motivo de
   * `dozeMesesAntes`: não escorregar de dia por fuso.
   */
  function fmtDataLonga(iso) {
    const s = String(iso == null ? '' : iso);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s + 'T12:00:00');
    if (isNaN(d)) return s;
    const [y, m, dd] = s.split('-');
    return `${DIAS_SEMANA[d.getDay()]}, ${dd}/${m}/${y}`;
  }
```

Exportar `fmtDataLonga`.

- [ ] **Passo 4: rodar — passa a 1ª parte, falha a varredura**

```bash
node scripts/smoke-escala-data-formatada.js
```
Esperado: primeiro bloco passa; o segundo lista pelo menos a linha 359
(`<div style="font-size:12px;color:var(--text2);">${s.date}`).

- [ ] **Passo 5: consertar a tela**

Em `escalaCardDoc` (linha ~359), trocar `${s.date}` por
`${ScaleService.fmtDataLonga(s.date)}`.

Em `renderFimDeAnoDetail`, trocar o helper local `fmtDay` por:
```js
  const fmtDay = (iso) => ScaleService.fmtDataLonga(iso).replace(/^(\w{3})\S*,/, '$1,');
```
(dia abreviado + data completa, que é o que cabe na coluna de 52px — se ficar apertado, aumente
`min-width` para 96px na mesma linha)

Corrigir **todas** as demais linhas que a varredura acusar, uma a uma.

Na Task 3, trocar `escalaFmtBR(c.marco)` por `ScaleService.fmtDataLonga(c.marco)`.

- [ ] **Passo 6: rodar e ver passar**

```bash
node scripts/smoke-escala-data-formatada.js
```
Esperado: `2/2 blocos OK`

- [ ] **Passo 7: commit**

```bash
git add scale-service.js professores-escala-smart.js scripts/smoke-escala-data-formatada.js
git commit -m "fix(escala): data do cartao vira 'sexta-feira, 20/11/2026' + trava contra data crua"
```

---

## Task 13: o botão de publicar fica achável

**Arquivos:**
- Modificar: `professores-escala-smart.js:421-443` (barra), `:1786-1848` (prévia)

- [ ] **Passo 1: helper do rótulo**

Acrescentar perto de `escalaHorario`:

```js
/**
 * "✅ Publicar as 8 datas de sábado na agenda e avisar".
 *
 * O botão dizia só "Publicar na agenda e avisar" e o Rodrigo não achou
 * (28/08/2026). Dizer o número e o tipo é o que faz ele ser reconhecido como
 * "o botão que falta apertar".
 */
function escalaRotuloPublicar(scales) {
  const n = (scales || []).length;
  const tipo = (scales && scales[0] && scales[0].tipo) || 'sabado';
  const rot = { sabado: 'sábado', feriado: 'feriado', domingo_especial: 'domingo especial', fim_de_ano: 'fim de ano' }[tipo] || 'escala';
  return n === 1
    ? `✅ Publicar 1 data de ${rot} na agenda e avisar`
    : `✅ Publicar as ${n} datas de ${rot} na agenda e avisar`;
}
```

- [ ] **Passo 2: a barra ganha o botão**

Trocar o corpo do `.map` de `refazerBar` (linhas 434-443) por:

```js
  const refazerBar = lotesMontados.map(b => {
    const doLote = scales.filter(s => s.windowBatchId === b);
    const datas = doLote.map(s => s.date).sort();
    const periodo = datas.length === 1 ? ScaleService.fmtDataLonga(datas[0])
      : `${escalaFmtBR(datas[0])} a ${escalaFmtBR(datas[datas.length - 1])}`;
    const pub = doLote.filter(s => s.published).length;
    const faltaPublicar = doLote.length - pub;
    // O botão de publicar mora AQUI e não só no rodapé da prévia: com a prévia
    // fechada, o lote montado ficava sem nenhuma pista de que faltava publicar.
    const btnPublicar = faltaPublicar
      ? `<button class="btn-primary" onclick="confirmarEAvisar('${b}')">${escalaRotuloPublicar(doLote)}</button>`
      : '';
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:${faltaPublicar ? '#3a2f1a' : 'var(--surface2)'};border:1px solid ${faltaPublicar ? '#caa23a' : 'var(--border)'};border-radius:10px;padding:10px 12px;margin-bottom:10px;">
        <span style="font-size:13px;color:var(--text2);">Escala montada para ${doLote.length} data(s): <b>${periodo}</b>${pub ? ` · ${pub} já publicada(s)` : ''}${faltaPublicar ? ` · <b style="color:#caa23a;">ainda não publicada</b>` : ''}</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">${btnPublicar}
          <button class="btn-secondary" onclick="refazerJanela('${b}')">🔄 Refazer</button></div>
      </div>`;
  }).join('');
```

- [ ] **Passo 3: o botão também no topo da prévia**

Em `renderPreviaLote`, trocar o cabeçalho do modal para:

```js
  const btnPublicar = `<button class="btn-primary" onclick="confirmarEAvisar('${batchId}')">${escalaRotuloPublicar(scales)}</button>`;

  modal.innerHTML = `
    <h2>Prévia da escala</h2>
    <p style="font-size:12px;color:var(--text2);">Nada foi publicado e ninguém foi avisado ainda. Confira, ajuste se precisar, e só então publique.</p>
    <div style="display:flex;justify-content:flex-end;margin:8px 0;">${btnPublicar}</div>
```

e o rodapé (linhas 1845-1848):

```js
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Fechar sem publicar</button>
      ${btnPublicar}
    </div>`;
```

- [ ] **Passo 4: conferir no navegador**

Staging: montar um lote de 2 sábados, fechar a prévia sem publicar, e confirmar que a barra da
tela principal ficou **amarela** dizendo "ainda não publicada" com o botão
"✅ Publicar as 2 datas de sábado na agenda e avisar". Clicar nele e confirmar que publica e
avisa (as aulas aparecem na Agenda Geral). Console sem erro.

- [ ] **Passo 5: commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala): botao de publicar com o numero real, na barra da tela e no topo da previa"
```

---

## Task 14: "Tirar do lote"

> ℹ️ **Nota (sessão 60).** A Task 8 levantou que `diffEscalados` percorre só `depois` — uma vaga
> que existisse em `antes` e sumisse em `depois` não seria relatada. **Aqui isso não morde:** o
> teste abaixo prova que `removeFromBatch` **mantém a vaga e limpa o ocupante**
> (`slots[0].assignedPersonId === null`), então o diff enxerga `a='ana' → b=null` e escreve
> "saiu Ana" corretamente. Só cuide de **não** passar a encolher o array de `slots` — se algum dia
> encolher, o histórico ficará mudo sobre quem saiu.

**Arquivos:**
- Modificar: `scale-service.js` (função nova + export), `professores-escala-smart.js`
- Modificar: `scripts/smoke-escala-historico.js`

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar no bloco async de `scripts/smoke-escala-historico.js`:

```js
  // ── tirar do lote (pedido 7b) ──
  const id2 = (await SS.createScale({ date: '2026-11-20', tipo: 'feriado', slots }, d)).data.id;
  await SS.openElection(id2, { batchId: 'b_nov' }, d);
  await SS.reassignSlot(id2, 'cp_TOI', 'ana', d);
  const outRes = await SS.removeFromBatch(id2, d);
  assert.ok(outRes.success, 'tirou do lote');
  const s2 = (await SS.getScale(id2, d)).data;
  assert.strictEqual(s2.windowBatchId, null, 'saiu do lote');
  assert.strictEqual(s2.status, 'rascunho', 'voltou pra rascunho');
  assert.strictEqual(s2.slots[0].assignedPersonId, null, 'as vagas foram limpas');
  assert.ok((s2.historico || []).some(h => h.acao === 'tirada_do_lote'), 'ficou registrado');
  passou('removeFromBatch limpa a data e deixa rastro');
```

E subir o contador final para `4/4`.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node scripts/smoke-escala-historico.js
```
Esperado: `TypeError: SS.removeFromBatch is not a function`

- [ ] **Passo 3: implementar**

Em `scale-service.js`, perto de `unpublishFromAgenda`:

```js
  /**
   * Tira uma data do lote: sai da janela, as vagas são limpas e ela volta pro
   * rascunho. Pedido 7 do Rodrigo (28/08/2026) — nasceu de 02/11 e 20/11, que
   * foram consolidados fora de qualquer janela e ficaram com gente escalada numa
   * escala que ninguém abriu.
   *
   * Se estiver publicada, despublica ANTES: deixar aula na agenda de uma escala
   * que voltou pro rascunho é o pior dos dois mundos.
   */
  async function removeFromBatch(scaleId, deps) {
    try {
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      const scale = scaleRes.data;
      if (scale.published) {
        const un = await unpublishFromAgenda(scaleId, deps);
        if (!un.success) return un;   // mês fechado: erro claro, não silêncio
      }
      const slots = (scale.slots || []).map(s => Object.assign({}, s, {
        assignedPersonId: null, reason: null, explain: [],
      }));
      await rdb(deps).collection('special_scales').doc(scaleId).set({
        slots, status: 'rascunho', windowBatchId: null, windowClosesAt: null,
        updatedAt: rts(deps), updatedBy: ruid(deps),
      }, { merge: true });
      await registrarHistorico(scaleId, {
        acao: 'tirada_do_lote',
        detalhe: `saiu do lote ${scale.windowBatchId || '—'}; ${(scale.slots || []).filter(s => s.assignedPersonId).length} vaga(s) limpa(s)`,
      }, deps);
      return { success: true, data: { erasBatchId: scale.windowBatchId || null } };
    } catch (err) { console.error('[ScaleService.removeFromBatch]', err); return { success: false, error: err.message }; }
  }
```

Exportar `removeFromBatch`.

- [ ] **Passo 4: rodar e ver passar**

```bash
node scripts/smoke-escala-historico.js
```
Esperado: `4/4 blocos OK`

- [ ] **Passo 5: botão na tela**

Em `professores-escala-smart.js`, acrescentar:

```js
async function tirarDoLote(scaleId) {
  const scale = EscalaSmartState.scales.find(s => s.id === scaleId) || {};
  const escalados = (scale.slots || []).filter(s => s.assignedPersonId).length;
  if (!confirm(`Tirar ${ScaleService.fmtDataLonga(scale.date)} do lote?\n\n`
    + `As ${escalados} vaga(s) são limpas, a data volta para rascunho e sai da janela.\n`
    + (scale.published ? `\n⚠️ Ela está PUBLICADA: as aulas saem da agenda agora. Quem já foi avisado NÃO é desavisado — fale com as pessoas.\n` : '')
    + `\nEla volta a existir quando você abrir uma janela nova que a inclua.\n\nContinuar?`)) return;
  const res = await ScaleService.removeFromBatch(scaleId);
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error', 9000); return; }
  toast('Data tirada do lote e zerada.', 'success');
  await escalaLoadBase();
  renderEscalaGestao();
}
```

Em `renderEscalaDetail`, no bloco de ações do sábado/feriado, acrescentar (só quando a data
ainda não aconteceu e tem lote ou gente escalada):

```js
    ${(!escalaEhPassada(scale.date) && (scale.windowBatchId || (scale.slots || []).some(s => s.assignedPersonId)))
      ? `<button class="btn-secondary" onclick="tirarDoLote('${scale.id}')">🚫 Tirar do lote</button>` : ''}
```

- [ ] **Passo 6: conferir no navegador**

Staging: abrir uma data consolidada futura, clicar em 🚫 Tirar do lote, confirmar. A data volta
a aparecer como **Rascunho**, sem ninguém nas vagas, e o 🕐 Histórico registra `🚫 Tirada do lote`.

- [ ] **Passo 7: commit**

```bash
git add scale-service.js professores-escala-smart.js scripts/smoke-escala-historico.js
git commit -m "feat(escala): tirar uma data do lote — limpa as vagas e volta pro rascunho"
```

---

## Task 15: a aba Por pessoa diz de qual janela é cada data

**Arquivos:**
- Modificar: `professores-escala-smart.js:477-550` (`renderTabPorPessoa`), state

- [ ] **Passo 1: state + helper**

Em `EscalaSmartState` (linha 9), acrescentar `pessoaJanela: 'todas',`.

Acrescentar perto de `escalaJanelaDoTipo`:

```js
/** Rótulo do lote: o período que ele cobre. `null` = data fora de qualquer janela. */
function escalaRotuloJanela(batchId) {
  if (!batchId) return null;
  const datas = (EscalaSmartState.scales || [])
    .filter(s => s.windowBatchId === batchId).map(s => s.date).sort();
  if (!datas.length) return batchId;
  return datas.length === 1 ? escalaFmtBR(datas[0])
    : `${escalaFmtBR(datas[0])} a ${escalaFmtBR(datas[datas.length - 1])}`;
}

function escalaSetPessoaJanela(v) { EscalaSmartState.pessoaJanela = v || 'todas'; renderEscalaGestao(); }
```

- [ ] **Passo 2: coluna + filtro**

Em `renderTabPorPessoa`, depois do `const linhas = [];`, montar a lista de lotes e o filtro, e
trocar o `forEach` que monta as linhas:

```js
  const filtro = EscalaSmartState.pessoaJanela || 'todas';
  const lotesDaPessoa = new Set();

  const brutas = [];
  (EscalaSmartState.scales || [])
    .filter(s => String(s.date || '').slice(0, 4) === ano)
    .sort((a, b) => (a.date > b.date ? 1 : -1))
    .forEach(s => {
      (s.slots || []).forEach(sl => {
        if (sl.assignedPersonId !== sel) return;
        if (s.windowBatchId) lotesDaPessoa.add(s.windowBatchId);
        brutas.push({ s, sl });
      });
    });

  brutas
    .filter(({ s }) => filtro === 'todas'
      || (filtro === 'fora' && !s.windowBatchId)
      || filtro === s.windowBatchId)
    .forEach(({ s, sl }) => {
      // Data consolidada fora de qualquer janela é o defeito que gerou o pedido:
      // 02/11 e 20/11 tinham gente escalada num lote que ninguém abriu.
      const janela = s.windowBatchId
        ? escalaEsc(escalaRotuloJanela(s.windowBatchId))
        : `<span style="color:#caa23a;">⚠️ fora de janela</span>`;
      linhas.push(`<tr>
        <td style="padding:4px 8px;">${escalaFmtBR(s.date)}</td>
        <td style="padding:4px 8px;">${rotuloTipo[s.tipo] || s.tipo}</td>
        <td style="padding:4px 8px;">${janela}</td>
        <td style="padding:4px 8px;">${escalaEsc(nomeUnidade(sl.unitId))}</td>
        <td style="padding:4px 8px;">${nomeMod(sl.requiredModalityId)}</td>
        <td style="padding:4px 8px;">${sl.startTime ? `${sl.startTime}–${sl.endTime || ''}` : '—'}</td>
        <td style="padding:4px 8px;color:${s.published ? 'var(--green)' : 'var(--text3)'};">${s.published ? '✓ publicada' : 'não publicada'}</td>
      </tr>`);
    });

  const filtroHtml = `<select class="input" style="max-width:260px;margin-left:8px;" onchange="escalaSetPessoaJanela(this.value)">
      <option value="todas" ${filtro === 'todas' ? 'selected' : ''}>Todas as janelas</option>
      ${[...lotesDaPessoa].map(b => `<option value="${b}" ${filtro === b ? 'selected' : ''}>${escalaEsc(escalaRotuloJanela(b))}</option>`).join('')}
      <option value="fora" ${filtro === 'fora' ? 'selected' : ''}>⚠️ Fora de janela</option>
    </select>`;
```

Acrescentar `<th style="padding:4px 8px;font-weight:400;">Janela</th>` no `<thead>`, entre
"Tipo" e "Unidade", e `${filtroHtml}` ao lado do `${seletor}` no primeiro `<div>` do `return`.

- [ ] **Passo 3: conferir no navegador**

Staging: aba Por pessoa, escolher alguém que tenha data em lote e data fora de lote. A coluna
Janela mostra o período nas primeiras e **⚠️ fora de janela** nas segundas; o filtro
"⚠️ Fora de janela" deixa só essas na tela.

- [ ] **Passo 4: commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala): aba Por pessoa mostra a janela de cada data e filtra por ela"
```

---

# BLOCO D — Rebalanceio

## Task 16: motor puro — reduzir

**Arquivos:**
- Criar: `scale-rebalance.js`, `scripts/smoke-scale-rebalance.js`
- Modificar: `professores.html`

- [ ] **Passo 1: escrever o teste que falha**

```js
'use strict';
// Roda: node scripts/smoke-scale-rebalance.js
//
// Pedido 2 do Rodrigo (28/08/2026): "ajustar a frequência de uma pessoa deve
// rebalancear os outros". Regra confirmada pelo Rafael no mesmo dia: tira de
// quem tem MAIS, empate desempata pela PONTUAÇÃO, empate de novo SORTEIA.
const assert = require('assert');
const RB = require('../scale-rebalance.js');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

const vaga = (id, mod, pid) => ({ id, unitId: 'cp', requiredModalityId: mod, requiredModalityName: mod, assignedPersonId: pid || null });
const data = (date, slots, published) => ({ scaleId: `sc_${date}`, date, published: !!published, slots });

// rng determinístico: sempre o primeiro da lista de empatados
const rngZero = () => 0;

// ── reduzir: sai de um dia e entra quem tem MENOS ──
{
  const datas = [
    data('2026-09-05', [vaga('v1', 'TOI', 'hel'), vaga('v2', 'HIIT', 'bru')]),
    data('2026-10-17', [vaga('v1', 'TOI', 'hel'), vaga('v2', 'HIIT', 'bru')]),
  ];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 10, dias: 2 },
    { id: 'bru', modalityIds: ['HIIT'], merito: 10, dias: 2 },
    { id: 'car', modalityIds: ['TOI'], merito: 5, dias: 0 },
    { id: 'duda', modalityIds: ['TOI'], merito: 9, dias: 1 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 1, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.atual, 2, 'ela tem 2 dias hoje');
  assert.ok(p.atingiu, 'chegou no alvo');
  assert.strictEqual(p.movimentos.length, 1, 'um movimento só');
  assert.strictEqual(p.movimentos[0].date, '2026-10-17', 'a data mais distante sai primeiro');
  assert.strictEqual(p.movimentos[0].saiId, 'hel');
  assert.strictEqual(p.movimentos[0].entraId, 'car', 'entra quem tem MENOS dias');
  passou('reduzir tira do dia mais distante e chama quem tem menos dias');
}

// ── empate no rodízio desempata pela pontuação ──
{
  const datas = [data('2026-10-17', [vaga('v1', 'TOI', 'hel')])];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 10, dias: 1 },
    { id: 'car', modalityIds: ['TOI'], merito: 5, dias: 0 },
    { id: 'duda', modalityIds: ['TOI'], merito: 9, dias: 0 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos[0].entraId, 'duda', 'empatados em 0 dias, ganha a maior pontuação');
  passou('empate no rodízio desempata pela pontuação');
}

// ── empate na pontuação sorteia ──
{
  const datas = [data('2026-10-17', [vaga('v1', 'TOI', 'hel')])];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 10, dias: 1 },
    { id: 'aaa', modalityIds: ['TOI'], merito: 5, dias: 0 },
    { id: 'zzz', modalityIds: ['TOI'], merito: 5, dias: 0 },
  ];
  const primeiro = RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos, rng: () => 0 });
  const segundo = RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos, rng: () => 0.99 });
  assert.strictEqual(primeiro.movimentos[0].entraId, 'aaa');
  assert.strictEqual(segundo.movimentos[0].entraId, 'zzz');
  passou('empate na pontuação vai pro sorteio');
}

// ── não deixa vaga aberta ──
{
  const datas = [data('2026-10-17', [vaga('v1', 'TOI', 'hel')])];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 10, dias: 1 },
    { id: 'bru', modalityIds: ['HIIT'], merito: 1, dias: 0 },   // não dá TOI
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos.length, 0, 'não mexeu');
  assert.strictEqual(p.atingiu, false, 'e diz que não chegou no alvo');
  assert.ok(/17\/10/.test(p.avisos.join(' ')), 'o aviso nomeia o dia que ficou como estava');
  passou('sem quem entrar, o dia fica como está e o aviso explica');
}

// ── férias e vizinhança ──
{
  const datas = [
    data('2026-10-10', [vaga('v1', 'TOI', 'car')]),
    data('2026-10-17', [vaga('v1', 'TOI', 'hel')]),
  ];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 10, dias: 1 },
    { id: 'car', modalityIds: ['TOI'], merito: 9, dias: 1 },   // pegou 10/10, vizinha de 17/10
    { id: 'duda', modalityIds: ['TOI'], merito: 1, dias: 0, indisponivel: ['2026-10-17'] },
    { id: 'edu', modalityIds: ['TOI'], merito: 1, dias: 5 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos[0].entraId, 'edu',
    'car está a 7 dias e duda de férias: sobra edu, mesmo com 5 dias');
  passou('respeita férias e a regra de não pegar dois sábados seguidos');
}

// ── nada a fazer ──
{
  const datas = [data('2026-10-17', [vaga('v1', 'TOI', 'hel')])];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 1, datas, candidatos: [{ id: 'hel', modalityIds: ['TOI'], merito: 1, dias: 1 }], rng: rngZero });
  assert.deepStrictEqual(p.movimentos, [], 'alvo igual ao atual não move nada');
  assert.ok(p.atingiu);
  passou('alvo igual ao atual não mexe em nada');
}

console.log(`\n${ok}/6 blocos OK`);
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node scripts/smoke-scale-rebalance.js
```
Esperado: `Cannot find module '../scale-rebalance.js'`

- [ ] **Passo 3: implementar**

Criar `scale-rebalance.js`:

```js
// scale-rebalance.js — motor PURO do rebalanceio por pessoa.
//
// A gestão põe 3 onde está 4 e o sistema tira a pessoa de um sábado chamando
// quem tem MENOS dias; põe 5 e tira de quem tem MAIS (Rodrigo, 28/08/2026).
// Regra de desempate confirmada pelo Rafael: dias → pontuação → sorteio.
//
// Devolve PLANO, não efeito: não lê nem grava nada. Quem aplica é o serviço,
// que também é quem republica a agenda e avisa as pessoas.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScaleRebalance = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DIA_MS = 86400000;

  function diasEntre(a, b) {
    const da = new Date(a + 'T12:00:00'), dbb = new Date(b + 'T12:00:00');
    if (isNaN(da) || isNaN(dbb)) return Infinity;
    return Math.abs(Math.round((dbb - da) / DIA_MS));
  }

  function fmtBR(iso) { return String(iso || '').split('-').reverse().join('/'); }

  /** Quem está em alguma vaga desta data, no estado ATUAL do plano. */
  function ocupantesDoDia(dataObj) {
    return new Set((dataObj.slots || []).map(s => s.assignedPersonId).filter(Boolean));
  }

  /** Está escalado numa data a até `vizinhanca` dias desta (fora ela própria)? */
  function temVizinha(estado, personId, dateISO, vizinhanca) {
    return estado.some(dt => dt.date !== dateISO
      && diasEntre(dt.date, dateISO) <= vizinhanca
      && ocupantesDoDia(dt).has(personId));
  }

  /** Sorteio determinístico dado o `rng` — os testes injetam. */
  function sortear(lista, rng) {
    if (lista.length <= 1) return lista[0];
    const r = typeof rng === 'function' ? rng() : Math.random();
    return lista[Math.min(lista.length - 1, Math.floor(r * lista.length))];
  }

  /**
   * Escolhe entre empatados: menor `chave` primeiro; empate → `desempate`
   * (maior primeiro); empate de novo → sorteio.
   */
  function melhor(lista, chave, desempate, rng) {
    if (!lista.length) return null;
    const minC = Math.min(...lista.map(chave));
    const a = lista.filter(x => chave(x) === minC);
    if (a.length === 1) return a[0];
    const maxD = Math.max(...a.map(desempate));
    const b = a.filter(x => desempate(x) === maxD);
    if (b.length === 1) return b[0];
    return sortear(b.slice().sort((x, y) => String(x.id).localeCompare(String(y.id))), rng);
  }

  function planejar({ pessoaId, alvo, datas, candidatos, vizinhanca, rng }) {
    const viz = (vizinhanca == null) ? 7 : vizinhanca;
    // Cópia profunda: o plano simula os movimentos sem tocar na entrada.
    const estado = (datas || []).map(dt => ({
      scaleId: dt.scaleId, date: dt.date, published: !!dt.published,
      slots: (dt.slots || []).map(s => Object.assign({}, s)),
    })).sort((a, b) => (a.date > b.date ? 1 : -1));

    const dias = {};
    const porId = {};
    (candidatos || []).forEach(c => {
      porId[c.id] = c;
      dias[c.id] = Number(c.dias) || 0;
    });
    const indisponivel = (id, date) =>
      ((porId[id] || {}).indisponivel || []).indexOf(date) !== -1;
    const habilitado = (id, modId) =>
      !modId || (((porId[id] || {}).modalityIds) || []).indexOf(modId) !== -1;
    const acimaDaCota = (id) => {
      const c = porId[id] || {};
      return (c.cota === 0 || c.cota > 0) && dias[id] >= c.cota;
    };

    const atual = estado.reduce((n, dt) =>
      n + (dt.slots || []).filter(s => s.assignedPersonId === pessoaId).length, 0);
    const movimentos = [], avisos = [];
    const alvoN = Math.max(0, Number(alvo) || 0);

    if (alvoN === atual) return { atual, alvo: alvoN, atingiu: true, movimentos, avisos };

    if (alvoN < atual) {
      // Sai da data NÃO publicada primeiro; entre iguais, da mais DISTANTE —
      // mexer no que está mais longe incomoda menos gente.
      const ordem = estado
        .filter(dt => (dt.slots || []).some(s => s.assignedPersonId === pessoaId))
        .sort((a, b) => (a.published === b.published)
          ? (a.date > b.date ? -1 : 1)
          : (a.published ? 1 : -1));

      let faltam = atual - alvoN;
      for (const dt of ordem) {
        if (!faltam) break;
        const slot = (dt.slots || []).find(s => s.assignedPersonId === pessoaId);
        if (!slot) continue;
        const noDia = ocupantesDoDia(dt);
        const elegiveis = (candidatos || []).filter(c =>
          c.id !== pessoaId &&
          habilitado(c.id, slot.requiredModalityId) &&
          !noDia.has(c.id) &&
          !indisponivel(c.id, dt.date) &&
          !temVizinha(estado, c.id, dt.date, viz));
        // Quem bateu a cota vai pro fim da fila (teto MACIO, igual ao motor).
        const preferidos = elegiveis.filter(c => !acimaDaCota(c.id));
        const pool = preferidos.length ? preferidos : elegiveis;
        const escolhido = melhor(pool, (c) => dias[c.id] || 0, (c) => Number(c.merito) || 0, rng);
        if (!escolhido) {
          avisos.push(`Não achei quem entrasse em ${fmtBR(dt.date)} — a vaga ficaria aberta. Não mexi nesse dia.`);
          continue;
        }
        slot.assignedPersonId = escolhido.id;
        dias[pessoaId] = Math.max(0, (dias[pessoaId] || 0) - 1);
        dias[escolhido.id] = (dias[escolhido.id] || 0) + 1;
        movimentos.push({
          scaleId: dt.scaleId, date: dt.date, published: dt.published,
          slotId: slot.id, unitId: slot.unitId,
          modalidade: slot.requiredModalityName || null,
          saiId: pessoaId, entraId: escolhido.id,
        });
        faltam--;
      }
      return { atual, alvo: alvoN, atingiu: faltam === 0, movimentos, avisos };
    }

    // alvoN > atual — implementado na Task 17
    return { atual, alvo: alvoN, atingiu: false, movimentos, avisos };
  }

  return { planejar };
});
```

- [ ] **Passo 4: rodar e ver passar**

```bash
node scripts/smoke-scale-rebalance.js
```
Esperado: `6/6 blocos OK`

- [ ] **Passo 5: carregar no navegador**

Em `professores.html`, acrescentar ao lado do `<script src="scale-engine.js">`:

```html
    <script src="scale-rebalance.js"></script>
```

- [ ] **Passo 6: commit**

```bash
git add scale-rebalance.js scripts/smoke-scale-rebalance.js professores.html
git commit -m "feat(escala): motor puro do rebalanceio — reduzir dias de uma pessoa"
```

---

## Task 17: motor puro — aumentar

**Arquivos:**
- Modificar: `scale-rebalance.js`, `scripts/smoke-scale-rebalance.js`

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar em `scripts/smoke-scale-rebalance.js`, antes do `console.log`:

```js
// ── aumentar: tira de quem tem MAIS ──
{
  const datas = [
    data('2026-09-05', [vaga('v1', 'TOI', 'bru')]),
    data('2026-10-17', [vaga('v1', 'TOI', 'edu')]),
  ];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 5, dias: 0 },
    { id: 'bru', modalityIds: ['TOI'], merito: 5, dias: 4 },
    { id: 'edu', modalityIds: ['TOI'], merito: 5, dias: 1 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 1, datas, candidatos, rng: rngZero });
  assert.ok(p.atingiu, 'chegou no alvo');
  assert.strictEqual(p.movimentos.length, 1);
  assert.strictEqual(p.movimentos[0].entraId, 'hel');
  assert.strictEqual(p.movimentos[0].saiId, 'bru', 'sai quem tem MAIS dias');
  assert.strictEqual(p.movimentos[0].date, '2026-09-05', 'a data mais próxima entra primeiro');
  passou('aumentar tira de quem tem mais dias');
}

// ── aumentar: empate em dias desempata pela MENOR pontuação ──
{
  const datas = [
    data('2026-09-05', [vaga('v1', 'TOI', 'bru')]),
    data('2026-09-26', [vaga('v1', 'TOI', 'edu')]),
  ];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 5, dias: 0 },
    { id: 'bru', modalityIds: ['TOI'], merito: 9, dias: 3 },
    { id: 'edu', modalityIds: ['TOI'], merito: 2, dias: 3 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 1, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos[0].saiId, 'edu',
    'empatados em 3 dias, quem sai é quem tem a MENOR pontuação');
  passou('aumentar: empate em dias sai o de menor pontuação');
}

// ── aumentar: ninguém tem mais dias que ela ──
{
  const datas = [data('2026-09-05', [vaga('v1', 'TOI', 'bru')])];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 5, dias: 3 },
    { id: 'bru', modalityIds: ['TOI'], merito: 5, dias: 1 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 4, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos.length, 0, 'não tira de quem já tem menos que ela');
  assert.strictEqual(p.atingiu, false);
  assert.ok(/05\/09/.test(p.avisos.join(' ')), 'o aviso nomeia o dia');
  passou('aumentar não tira de quem já tem menos dias que ela');
}
```

Subir o contador final para `9/9`.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node scripts/smoke-scale-rebalance.js
```
Esperado: falha em `'chegou no alvo'` — o ramo de aumentar devolve `atingiu:false` sem movimento.

- [ ] **Passo 3: implementar**

Em `scale-rebalance.js`, trocar o `// alvoN > atual — implementado na Task 17` e o `return`
seguinte por:

```js
    // Aumentar: entra em dia que ela não pega, tirando de quem tem MAIS dias.
    // Data NÃO publicada primeiro; entre iguais, a mais PRÓXIMA — quanto antes
    // ela voltar ao rodízio, menos a fila fica torta.
    const candidatas = estado
      .filter(dt => !ocupantesDoDia(dt).has(pessoaId))
      .filter(dt => !indisponivel(pessoaId, dt.date))
      .filter(dt => !temVizinha(estado, pessoaId, dt.date, viz))
      .sort((a, b) => (a.published === b.published)
        ? (a.date > b.date ? 1 : -1)
        : (a.published ? 1 : -1));

    let faltam = alvoN - atual;
    for (const dt of candidatas) {
      if (!faltam) break;
      // Só vale tirar de quem tem MAIS dias que ela — senão o rebalanceio
      // desequilibraria em vez de equilibrar.
      const alvos = (dt.slots || [])
        .filter(s => s.assignedPersonId && s.assignedPersonId !== pessoaId)
        .filter(s => habilitado(pessoaId, s.requiredModalityId))
        .filter(s => (dias[s.assignedPersonId] || 0) > (dias[pessoaId] || 0))
        .map(s => ({ slot: s, id: s.assignedPersonId }));
      if (!alvos.length) {
        avisos.push(`Em ${fmtBR(dt.date)} ninguém tem mais dias do que ela (ou a modalidade não bate). Não mexi nesse dia.`);
        continue;
      }
      // Sai quem tem MAIS dias → empate: MENOR pontuação → empate: sorteio.
      // `melhor` escolhe o menor da chave, então invertemos os dois sinais.
      const escolhido = melhor(alvos, (x) => -(dias[x.id] || 0), (x) => -(Number((porId[x.id] || {}).merito) || 0), rng);
      escolhido.slot.assignedPersonId = pessoaId;
      dias[escolhido.id] = Math.max(0, (dias[escolhido.id] || 0) - 1);
      dias[pessoaId] = (dias[pessoaId] || 0) + 1;
      movimentos.push({
        scaleId: dt.scaleId, date: dt.date, published: dt.published,
        slotId: escolhido.slot.id, unitId: escolhido.slot.unitId,
        modalidade: escolhido.slot.requiredModalityName || null,
        saiId: escolhido.id, entraId: pessoaId,
      });
      faltam--;
    }
    return { atual, alvo: alvoN, atingiu: faltam === 0, movimentos, avisos };
```

⚠️ `melhor` sorteia pelo `id` ordenado — em `alvos` a chave do sorteio é `x.id`, que existe.
Conferir que `sortear` recebe objetos com `.id` nos dois ramos.

- [ ] **Passo 4: rodar e ver passar**

```bash
node scripts/smoke-scale-rebalance.js
```
Esperado: `9/9 blocos OK`

- [ ] **Passo 5: commit**

```bash
git add scale-rebalance.js scripts/smoke-scale-rebalance.js
git commit -m "feat(escala): motor do rebalanceio — aumentar dias tirando de quem tem mais"
```

---

## Task 18: quem é a gestão, para avisar

**Arquivos:**
- Modificar: `notify-service.js`

- [ ] **Passo 1: implementar**

Acrescentar depois de `resolveActiveTeacherUserIds`:

```js
  /**
   * userIds de quem é gestão (admin ou supervisão).
   *
   * Rafael, 28/08/2026: mexer em data já publicada é permitido, desde que "seja
   * avisada aos envolvidos E À GESTÃO". Só existia o resolvedor de professores.
   */
  async function resolveManagementUserIds(deps) {
    try {
      const snap = await rdb(deps).collection('users').get();
      const out = [];
      snap.docs.forEach(doc => {
        const u = doc.data() || {};
        const papeis = [].concat(u.roles || [], u.role || [], u.perfil || []);
        if (papeis.some(p => p === 'admin' || p === 'supervisao' || p === 'admin_gestao')) out.push(doc.id);
      });
      return { success: true, data: out };
    } catch (err) { console.error('[NotifyService.resolveManagementUserIds]', err); return { success: false, error: err.message, data: [] }; }
  }
```

Exportar na linha final: `return { buildNotifDocs, resolveActiveTeacherUserIds, resolveManagementUserIds, send };`

- [ ] **Passo 2: conferir o nome dos papéis**

⚠️ Antes de fechar a task, **confirmar contra um documento real de `/users` no staging** quais
campos e valores existem (`roles`? `role`? `perfil`? `'supervisao'` ou `'supervisor'`?). O
código acima cobre as três formas; ajuste os valores para o que estiver lá e apague os que não
existirem. Uma lista vazia aqui significa gestão nunca avisada — falha silenciosa.

```bash
node scripts/admin.js --project staging
```

- [ ] **Passo 3: commit**

```bash
git add notify-service.js
git commit -m "feat(avisos): resolver os userIds da gestao"
```

---

## Task 19: o serviço aplica o rebalanceio

**Arquivos:**
- Modificar: `scale-service.js` (função nova + export)
- Modificar: `scripts/smoke-escala-historico.js`

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar no bloco async de `scripts/smoke-escala-historico.js`:

```js
  // ── aplicar rebalanceio ──
  const slots2 = [
    { id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'TOI', requiredModalityName: 'TOI', assignedPersonId: null, startTime: '08:00', endTime: '12:00' },
  ];
  const idR = (await SS.createScale({ date: '2026-12-05', tipo: 'sabado', slots: slots2 }, d)).data.id;
  await SS.reassignSlot(idR, 'cp_TOI', 'hel', d);
  const aplRes = await SS.aplicarRebalanceamento({
    pessoaId: 'hel',
    movimentos: [{ scaleId: idR, date: '2026-12-05', published: false, slotId: 'cp_TOI', unitId: 'cp', saiId: 'hel', entraId: 'car' }],
    nomePorId: { hel: 'Heloísa', car: 'Carla' },
    de: 1, para: 0,
  }, d);
  assert.ok(aplRes.success, 'aplicou');
  assert.strictEqual(aplRes.data.aplicados, 1, 'um movimento aplicado');
  const sR = (await SS.getScale(idR, d)).data;
  assert.strictEqual(sR.slots[0].assignedPersonId, 'car', 'a vaga mudou de dono');
  const hr = (sR.historico || []).filter(h => h.acao === 'rebalanceada');
  assert.strictEqual(hr.length, 1, 'gravou uma linha de rebalanceio');
  assert.ok(/Heloísa/.test(hr[0].detalhe) && /Carla/.test(hr[0].detalhe), 'com os dois nomes');
  passou('aplicarRebalanceamento move a vaga e registra por nome');
```

Subir o contador final para `5/5`.

- [ ] **Passo 2: rodar e ver falhar**

```bash
node scripts/smoke-escala-historico.js
```
Esperado: `TypeError: SS.aplicarRebalanceamento is not a function`

- [ ] **Passo 3: implementar**

Em `scale-service.js`, depois de `removeFromBatch`:

```js
  /**
   * Aplica um plano vindo de `ScaleRebalance.planejar`.
   *
   * Data publicada É mexida (Rafael, 28/08/2026: "por erros que podem acontecer
   * no futuro pelos gestores, deve ser possível alterar a data já publicada") —
   * mas nunca em silêncio: republica a agenda e devolve a lista de quem precisa
   * ser avisado. Quem avisa é a tela, que é quem tem NotifyService.
   *
   * Data NÃO publicada não gera aviso nenhum: o professor não enxerga escala não
   * publicada desde 26/08, e avisar seria contar o que ele não pode ver.
   */
  async function aplicarRebalanceamento({ pessoaId, movimentos, nomePorId, de, para }, deps) {
    const nome = (id) => (nomePorId && nomePorId[id]) || id;
    const aplicados = [], falhas = [], aRepublicar = new Set(), avisar = [];
    for (const mv of (movimentos || [])) {
      const res = await reassignSlot(mv.scaleId, mv.slotId, mv.entraId, deps);
      if (!res.success) { falhas.push(`${mv.date}: ${res.error}`); continue; }
      aplicados.push(mv);
      await registrarHistorico(mv.scaleId, {
        acao: 'rebalanceada',
        detalhe: `${nome(pessoaId)} ${de} → ${para}: saiu ${nome(mv.saiId)}, entrou ${nome(mv.entraId)}`
               + (mv.modalidade ? ` (${mv.modalidade})` : ''),
      }, deps);
      if (mv.published) { aRepublicar.add(mv.scaleId); avisar.push(mv); }
    }
    for (const scaleId of aRepublicar) {
      const pub = await publishToAgenda(scaleId, deps);
      if (!pub.success) falhas.push(`republicar ${scaleId}: ${pub.error}`);
    }
    return {
      success: falhas.length === 0,
      data: { aplicados: aplicados.length, movimentos: aplicados, avisar, republicadas: aRepublicar.size },
      error: falhas.length ? falhas.join(' · ') : undefined,
    };
  }
```

Exportar `aplicarRebalanceamento`.

- [ ] **Passo 4: rodar e ver passar**

```bash
node scripts/smoke-escala-historico.js && node scripts/smoke-scale-rebalance.js
```
Esperado: `5/5 blocos OK` e `9/9 blocos OK`.

- [ ] **Passo 5: commit**

```bash
git add scale-service.js scripts/smoke-escala-historico.js
git commit -m "feat(escala): servico aplica o rebalanceio, republica e devolve quem avisar"
```

---

## Task 20: o botão "Ajustar", a prévia e os avisos

**Arquivos:**
- Modificar: `professores-escala-smart.js`

- [ ] **Passo 1: montar a entrada do motor e abrir a prévia**

```js
/**
 * Ajustar quantos dias uma pessoa tem na janela. Ocupa o lugar do antigo
 * "+ dias fora" — que registrava dias de fora do sistema e o Rodrigo leu como
 * "editar este número". Este aqui faz o que ele queria: muda a escala de verdade
 * e rebalanceia os outros.
 */
async function abrirAjusteFrequencia(personId) {
  const tipo = EscalaSmartState.tab === 'feriado' ? 'feriado' : 'sabado';
  const c = escalaContagens(tipo);
  if (!c.lote.id) { toast('Não há janela para ajustar. Abra uma janela primeiro.', 'error'); return; }
  const atual = c.janela[personId] || 0;
  const nome = escalaPersonName(personId);

  const resp = prompt(
    `AJUSTAR ${tipo === 'feriado' ? 'FERIADOS' : 'SÁBADOS'} NESTA JANELA — ${nome}\n\n`
    + `Hoje: ${atual} nesta janela.\n\n`
    + `Digite quantos ela deve ter. O sistema rebalanceia os outros: se você baixar, `
    + `chama quem tem MENOS dias; se subir, tira de quem tem MAIS.\n\n`
    + `Você vê o que vai acontecer antes de qualquer mudança.`,
    String(atual));
  if (resp === null) return;
  const alvo = Number(String(resp).replace(',', '.'));
  if (!Number.isFinite(alvo) || alvo < 0) { toast('Informe um número igual ou maior que zero.', 'error'); return; }

  const datas = (EscalaSmartState.scales || [])
    .filter(s => s.windowBatchId === c.lote.id)
    .map(s => ({ scaleId: s.id, date: s.date, published: !!s.published, slots: (s.slots || []).map(x => Object.assign({}, x)) }));

  const ctx = await escalaMontarCtx();
  const feriasPorPessoa = {};
  (ctx.vacations || []).forEach(v => {
    if (!v || v.status !== 'aprovada' || !v.teacherId) return;
    feriasPorPessoa[v.teacherId] = feriasPorPessoa[v.teacherId] || [];
    datas.forEach(dt => {
      if (ScaleService.personsOnVacation([v], dt.date).has(v.teacherId)) feriasPorPessoa[v.teacherId].push(dt.date);
    });
  });

  const cotas = await ScaleService.listWindowQuotas(c.lote.id);
  const cotaById = cotas.success ? cotas.data : {};

  const candidatos = Array.from(EscalaSmartState.teacherMap.values())
    .filter(t => t.isActive !== false)
    .map(t => ({
      id: t.id, modalityIds: t.modalityIds || [],
      merito: ctx.meritoById[t.id] || 0,
      dias: c.janela[t.id] || 0,
      cota: (cotaById[t.id] === 0 || cotaById[t.id] > 0) ? cotaById[t.id] : null,
      indisponivel: feriasPorPessoa[t.id] || [],
    }));

  const plano = ScaleRebalance.planejar({ pessoaId: personId, alvo: Math.round(alvo), datas, candidatos });
  EscalaSmartState._planoAjuste = { plano, personId, de: atual, para: Math.round(alvo) };
  renderPreviaAjuste();
}
```

- [ ] **Passo 2: desenhar a prévia**

```js
function renderPreviaAjuste() {
  const st = EscalaSmartState._planoAjuste;
  if (!st) return;
  const { plano, personId, de, para } = st;
  const nome = escalaPersonName(personId);
  const nomeUnidade = (uid) => {
    const u = EscalaSmartState.units.find(x => x.id === uid) || {};
    return (u.name || uid || '').replace(/CrossTainer\s*/i, '') || uid;
  };
  const linhas = plano.movimentos.map(mv => `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
      <b>${ScaleService.fmtDataLonga(mv.date)}</b> · ${escalaEsc(nomeUnidade(mv.unitId))}${mv.modalidade ? ` (${mv.modalidade})` : ''}
      ${mv.published ? ' <span style="color:#caa23a;">· já publicada</span>' : ''}
      <div style="color:var(--text2);">sai ${escalaEsc(escalaPersonName(mv.saiId))} · entra <b>${escalaEsc(escalaPersonName(mv.entraId))}</b></div>
    </div>`).join('');
  const publicadas = plano.movimentos.filter(m => m.published).length;

  const modal = document.getElementById('escalaModal');
  const overlay = document.getElementById('escalaModalOverlay');
  modal.innerHTML = `
    <h2>${escalaEsc(nome)}: ${de} → ${para}</h2>
    <p style="font-size:12px;color:var(--text2);">Nada foi alterado ainda. Confira e confirme.</p>
    ${plano.movimentos.length ? `<div style="max-height:40vh;overflow:auto;margin:10px 0;">${linhas}</div>`
      : `<p style="color:var(--text2);">Nenhuma mudança possível.</p>`}
    ${plano.avisos.length ? `<div style="background:#3a2f1a;border:1px solid #caa23a;border-radius:8px;padding:10px;font-size:12px;margin:10px 0;">
      ${plano.avisos.map(a => escalaEsc(a)).join('<br>')}
    </div>` : ''}
    ${!plano.atingiu ? `<div style="font-size:12px;color:#caa23a;margin-bottom:8px;">Não deu para chegar em ${para}. As mudanças acima continuam valendo se você confirmar.</div>` : ''}
    ${publicadas ? `<div style="background:#3a1a1a;border:1px solid var(--red);border-radius:8px;padding:10px;font-size:12px;margin-bottom:8px;">
      ⚠️ ${publicadas} data(s) já publicada(s) serão mexidas. A agenda é refeita e <b>quem sai, quem entra e a gestão são avisados</b>.
    </div>` : ''}
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      ${plano.movimentos.length ? `<button class="btn-primary" onclick="aplicarAjusteFrequencia()">Aplicar estas mudanças</button>` : ''}
    </div>`;
  modal.style.display = 'block';
  if (overlay) overlay.style.display = 'block';
}
```

- [ ] **Passo 3: aplicar e avisar**

```js
async function aplicarAjusteFrequencia() {
  const st = EscalaSmartState._planoAjuste;
  if (!st) return;
  const { plano, personId, de, para } = st;
  toast('Aplicando…', 'info');
  const nomePorId = escalaNomePorId();
  const res = await ScaleService.aplicarRebalanceamento(
    { pessoaId: personId, movimentos: plano.movimentos, nomePorId, de, para },
    { nomePorId });

  const avisar = (res.data && res.data.avisar) || [];
  const uid = (pid) => (EscalaSmartState.teacherMap.get(pid) || {}).userId || null;
  const nomeUnidade = (u) => { const x = EscalaSmartState.units.find(y => y.id === u) || {}; return (x.name || u || '').replace(/CrossTainer\s*/i, '') || u; };
  let avisados = 0;
  for (const mv of avisar) {
    const onde = `${ScaleService.fmtDataLonga(mv.date)} · ${nomeUnidade(mv.unitId)}${mv.modalidade ? ` (${mv.modalidade})` : ''}`;
    if (uid(mv.saiId)) {
      await NotifyService.send({ recipients: [uid(mv.saiId)], type: 'scale_confirmed',
        title: 'Você saiu de um dia da escala',
        body: `A gestão ajustou a distribuição: você não trabalha mais em ${onde}. Sua agenda já está atualizada.`,
        link: { type: 'escala-smart', id: mv.scaleId }, channels: ['inapp'] });
      avisados++;
    }
    if (uid(mv.entraId)) {
      await NotifyService.send({ recipients: [uid(mv.entraId)], type: 'scale_confirmed',
        title: 'Você entrou em um dia da escala',
        body: `A gestão ajustou a distribuição: você trabalha em ${onde}. Já está na sua agenda.`,
        link: { type: 'escala-smart', id: mv.scaleId }, channels: ['inapp'] });
      avisados++;
    }
  }
  // A gestão é avisada sempre que houve mudança — publicada ou não.
  const ges = await NotifyService.resolveManagementUserIds();
  if (ges.success && ges.data.length && (res.data && res.data.aplicados)) {
    await NotifyService.send({ recipients: ges.data, type: 'scale_confirmed',
      title: 'Escala ajustada',
      body: `${escalaPersonName(personId)}: ${de} → ${para}. ${res.data.aplicados} troca(s)`
          + (avisar.length ? `, ${avisar.length} em data já publicada.` : '.'),
      link: { type: 'escala-smart', id: null }, channels: ['inapp'] });
  }

  if (!res.success) toast(`Aplicado em parte — falhou: ${res.error}`, 'error', 12000);
  else toast(`${res.data.aplicados} troca(s) aplicada(s)${avisados ? `, ${avisados} aviso(s) enviado(s)` : ''}.`, 'success', 7000);

  EscalaSmartState._planoAjuste = null;
  closeEscalaModal();
  await escalaLoadBase();
  renderEscalaGestao();
}
```

- [ ] **Passo 4: pendurar o botão**

Em `renderEquilibrioPainel`, a `linha` volta a ter botão — agora o certo:

```js
  const linha = (x) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:3px 0;font-size:12px;">
      <span>${escalaEsc(x.t.name)}</span>
      <span style="display:flex;align-items:center;gap:6px;color:var(--text2);white-space:nowrap;">
        ${x.n} nesta janela · ${x.ano} no ano
        <button class="btn-secondary" style="font-size:11px;padding:2px 8px;white-space:nowrap;"
                onclick="abrirAjusteFrequencia('${x.t.id}')"
                title="Mudar quantos dias esta pessoa tem nesta janela. O sistema rebalanceia os outros e mostra a prévia antes.">Ajustar</button>
      </span>
    </div>`;
```

E em `renderTabPorPessoa`, ao lado dos cartões:

```js
      <button class="btn-secondary" style="align-self:center;" onclick="abrirAjusteFrequencia('${sel}')">Ajustar nesta janela</button>
```

- [ ] **Passo 5: homologar no navegador (obrigatório)**

Staging, com um lote de sábados montado e **não publicado**:
1. Baixar alguém de 2 para 1 → a prévia mostra "sai X, entra Y"; aplicar; conferir na lista que
   a vaga mudou de dono e que o 🕐 Histórico registra `⚖ Rebalanceada`.
2. Subir alguém de 0 para 1 → conferir que sai quem tem mais dias.
3. Repetir com o lote **publicado** → conferir que a aula na Agenda Geral mudou de professor e
   que os dois envolvidos receberam o aviso no sino.
4. Pedir um alvo impossível (ex.: 9) → conferir que a prévia mostra os avisos e não trava.
5. Console sem erro em todos os passos.

- [ ] **Passo 6: commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala): botao Ajustar com previa, rebalanceio e aviso a quem sai, quem entra e a gestao"
```

---

# BLOCO E — Fim de ano

## Task 21: `reassignSlot` colide por DIA, não por escala

**Arquivos:**
- Modificar: `scale-service.js:176-179`
- Modificar: `scripts/smoke-scale-service.js`

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar em `scripts/smoke-scale-service.js`, depois do bloco de `reassignSlot`:

```js
  // ── fim de ano: a colisão é por DIA, não pela escala inteira ──
  // Achado em 28/08/2026: `reassignSlot` recusava quem já estava em QUALQUER
  // outra vaga da escala. Pra sábado está certo (uma escala = um dia); pro fim
  // de ano, uma escala é o PERÍODO inteiro — quem trabalha 20/12 nunca podia ser
  // posto em 27/12 pela troca manual. Estava em produção.
  const fdaSlots = [
    { id: 's_20_m', day: '2026-12-20', shift: 'manha', unitId: 'cp', requiredModalityId: null, assignedPersonId: 'ana', startTime: '08:00', endTime: '12:00' },
    { id: 's_20_t', day: '2026-12-20', shift: 'tarde_noite', unitId: 'cp', requiredModalityId: null, assignedPersonId: null, startTime: '16:00', endTime: '21:00' },
    { id: 's_27_m', day: '2026-12-27', shift: 'manha', unitId: 'cp', requiredModalityId: null, assignedPersonId: null, startTime: '08:00', endTime: '12:00' },
  ];
  const fdaId = (await SS.createScale({ date: '2026-12-20', tipo: 'fim_de_ano', slots: fdaSlots }, d)).data.id;

  const outroDia = await SS.reassignSlot(fdaId, 's_27_m', 'ana', d);
  assert.ok(outroDia.success, 'a mesma pessoa pode trabalhar em outro DIA do período');

  const mesmoDia = await SS.reassignSlot(fdaId, 's_20_t', 'ana', d);
  assert.strictEqual(mesmoDia.success, false, 'mas não em dois turnos do MESMO dia');
  assert.ok(/já está/.test(mesmoDia.error), 'e o erro diz o porquê');
  console.log('✓ smoke-scale-service: colisão de vaga é por dia no fim de ano');
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node scripts/smoke-scale-service.js
```
Esperado: falha em `'a mesma pessoa pode trabalhar em outro DIA do período'`.

- [ ] **Passo 3: implementar**

Em `scale-service.js`, trocar as linhas 176-179:

```js
      // Ninguém cobre duas vagas no mesmo dia — o motor já respeita isso.
      // A colisão é por DIA: no fim de ano uma escala é o PERÍODO inteiro, e
      // comparar contra a escala toda proibia a mesma pessoa em dias
      // diferentes. Em sábado/feriado `day` é undefined dos dois lados, então o
      // comportamento é idêntico ao de sempre. (28/08/2026)
      const mesmoDia = (s) => (s.day || null) === (slot.day || null);
      if (depois && (scale.slots || []).some(s => s.id !== slotId && mesmoDia(s) && s.assignedPersonId === depois)) {
        return { success: false, error: 'Essa pessoa já está em outra vaga deste dia.' };
      }
```

- [ ] **Passo 4: rodar e ver passar**

```bash
node scripts/smoke-scale-service.js && node scripts/smoke-trocar-pessoa-escala.js && node scripts/smoke-escala-historico.js
```
Esperado: todos passam.

- [ ] **Passo 5: commit**

```bash
git add scale-service.js scripts/smoke-scale-service.js
git commit -m "fix(escala): no fim de ano a colisao de vaga e por dia, nao pelo periodo inteiro"
```

---

## Task 22: fim de ano — rebalanceio, botão de publicar e data

**Arquivos:**
- Modificar: `professores-escala-smart.js` (`renderFimDeAnoDetail`, `abrirAjusteFrequencia`)

- [ ] **Passo 1: o rebalanceio enxerga o fim de ano**

Em `abrirAjusteFrequencia`, antes de montar `datas`, tratar a aba de fim de ano — uma escala,
muitos dias:

```js
  // Fim de ano é UM documento com muitos dias: cada dia vira uma "data" para o
  // motor, todas apontando pro mesmo scaleId. A justiça do fim de ano é interna
  // ao período (`consolidateByDay` começa do zero), então os dias contados aqui
  // são os DESTE período, não os do rodízio de sábado.
  let datas, contagemLocal = null;
  if (EscalaSmartState.tab === 'fim_de_ano') {
    const fda = EscalaSmartState.scales.find(s => s.id === EscalaSmartState.selectedId && s.tipo === 'fim_de_ano');
    if (!fda) { toast('Selecione o período de fim de ano primeiro.', 'error'); return; }
    const porDia = {};
    (fda.slots || []).forEach(sl => { (porDia[sl.day] = porDia[sl.day] || []).push(Object.assign({}, sl)); });
    datas = Object.keys(porDia).sort().map(day => ({ scaleId: fda.id, date: day, published: !!fda.published, slots: porDia[day] }));
    contagemLocal = {};
    (fda.slots || []).forEach(sl => { if (sl.assignedPersonId) contagemLocal[sl.assignedPersonId] = (contagemLocal[sl.assignedPersonId] || 0) + 1; });
  } else {
    datas = (EscalaSmartState.scales || [])
      .filter(s => s.windowBatchId === c.lote.id)
      .map(s => ({ scaleId: s.id, date: s.date, published: !!s.published, slots: (s.slots || []).map(x => Object.assign({}, x)) }));
  }
```

E onde `candidatos` usa `dias: c.janela[t.id] || 0`, trocar por:

```js
      dias: contagemLocal ? (contagemLocal[t.id] || 0) : (c.janela[t.id] || 0),
```

Idem para `atual`: quando `contagemLocal` existe, `atual = contagemLocal[personId] || 0`, e a
guarda `if (!c.lote.id)` só vale quando **não** é fim de ano:

```js
  if (!contagemLocal && !c.lote.id) { toast('Não há janela para ajustar. Abra uma janela primeiro.', 'error'); return; }
```

⚠️ No fim de ano a vaga não tem `requiredModalityId` (é `null`), então `habilitado` devolve
`true` para todo mundo — que é o comportamento certo: qualquer colaborador serve.

- [ ] **Passo 2: botão de publicar e "montado, não publicado"**

Em `renderFimDeAnoDetail`, trocar o bloco `actions` para:

```js
  const naoPublicado = consolidated && !scale.published;
  const actions = `
    ${naoPublicado ? `<div style="background:#3a2f1a;border:1px solid #caa23a;border-radius:8px;padding:10px 12px;margin-top:12px;font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
      <span>Período montado para <b>${days.length} dia(s)</b> · <b style="color:#caa23a;">ainda não publicado</b></span>
      <button class="btn-primary" onclick="publicarEscala('${scale.id}')">✅ Publicar os ${days.length} dias na agenda</button>
    </div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:flex-end;margin-top:12px;">
    ${scale.published ? `<span style="font-size:12px;color:var(--green);margin-right:auto;">✓ publicada na agenda</span>` : ''}
    ${scale.status === 'rascunho' ? `<button class="btn-secondary" onclick="abrirJanelaEscala('${scale.id}')">📨 Abrir janela de preferências</button>` : ''}
    <button class="btn-primary" onclick="consolidarEscala('${scale.id}')">🧮 ${consolidated ? 'Reconsolidar' : 'Consolidar'}</button>
    ${scale.published ? `<button class="btn-secondary" onclick="despublicarEscala('${scale.id}')">↩️ Despublicar</button>` : ''}
  </div>`;
```

- [ ] **Passo 3: rodar a varredura de data**

```bash
node scripts/smoke-escala-data-formatada.js
```
Esperado: `2/2 blocos OK` — se acusar linha nova do fim de ano, formatar com `fmtDataLonga`.

- [ ] **Passo 4: homologar no navegador**

Staging: criar um período de fim de ano de 3 dias, consolidar, conferir a barra amarela
"ainda não publicado" com o botão. Depois, com o período selecionado, usar **Ajustar** numa
pessoa e conferir que o plano só mexe em dias do período e nunca põe a mesma pessoa em dois
turnos do mesmo dia.

- [ ] **Passo 5: commit**

```bash
git add professores-escala-smart.js
git commit -m "feat(escala): fim de ano ganha rebalanceio, botao de publicar com o numero e data por extenso"
```

---

# BLOCO F — Fechar

## Task 23: manual e trava do manual

**Arquivos:**
- Modificar: `manual-admin.html`, `scripts/smoke-manual-atualizado.js`

- [ ] **Passo 1: escrever a trava primeiro**

Em `scripts/smoke-manual-atualizado.js`, acrescentar aos assuntos obrigatórios do manual-admin:

```js
  ['Ajustar', 'o botão que muda quantos dias uma pessoa tem na janela'],
  ['marco zero', 'de quando a contagem começa a valer'],
  ['Tirar do lote', 'como zerar uma data que entrou errado'],
  ['Histórico desta escala', 'onde ver quem mexeu'],
```

(siga o formato exato dos pares já existentes no arquivo)

- [ ] **Passo 2: rodar e ver falhar**

```bash
node scripts/smoke-manual-atualizado.js
```
Esperado: falha listando os quatro assuntos ausentes.

- [ ] **Passo 3: escrever os blocos no manual**

Em `manual-admin.html`, na seção da Escala Inteligente, quatro blocos novos, no mesmo tom dos
existentes (texto de gente, sem jargão):

1. **Ajustar quantos dias uma pessoa tem** — onde fica o botão, que ele mostra a prévia antes,
   que baixar chama quem tem menos e subir tira de quem tem mais, que férias e a regra de não
   pegar dois sábados seguidos são respeitadas, e que **data já publicada pode ser mexida — e
   aí quem sai, quem entra e a gestão são avisados**.
2. **De quando a contagem começa (marco zero)** — o que é, onde configurar (só Admin), e o uso
   na virada do ano.
3. **Tirar uma data do lote** — o que acontece (vagas limpas, volta pra rascunho, sai da agenda
   se estava publicada) e o aviso de que quem já foi avisado **não** é desavisado.
4. **Quem mexeu na escala** — o 🕐 Histórico dentro de cada data e as 📜 Últimas alterações do
   módulo no rodapé.

E **remover** do manual qualquer menção ao "+ dias fora", que deixou de existir.

> 🚨 **Emenda (sessão 60, achado da revisão da Task 6).** Depois da Task 6 o manual ficou
> **órfão na hora**: `manual-admin.html` (~linhas 294-297) ainda tem a seção
> *"📊 Equilíbrio da janela — e o botão '+ dias fora'"* ensinando um botão que não existe mais na
> tela. E `scripts/smoke-manual-atualizado.js` **passou 8/8 mesmo assim** — ele só verifica
> **presença** de assunto, nunca **ausência** de recurso morto. É a memória
> [[manual-envelhece-em-silencio]] acontecendo de novo, agora ao contrário.
>
> Por isso, acrescente à trava do Passo 1 também as asserções de **ausência**:
>
> ```js
> assert.ok(!/\+ dias fora/.test(manualAdmin), 'o manual não ensina mais o botão que foi apagado');
> assert.ok(!/Lançado na mão/.test(manualAdmin), 'a coluna que saiu da tela saiu do manual');
> ```
>
> Ausência é o único fato que ler texto prova bem — e é justamente o que faltava aqui.

- [ ] **Passo 4: rodar e ver passar**

```bash
node scripts/smoke-manual-atualizado.js
```
Esperado: passa, sem link morto.

- [ ] **Passo 5: commit**

```bash
git add manual-admin.html scripts/smoke-manual-atualizado.js
git commit -m "docs(manual): ajustar, marco zero, tirar do lote e historico da escala"
```

---

## Task 24: suíte inteira + homologação no staging

- [ ] **Passo 1: rodar tudo o que toca escala**

```bash
node scripts/smoke-scale-engine.js && node scripts/smoke-scale-rebalance.js && node scripts/smoke-scale-service.js && node scripts/smoke-escala-contagem.js && node scripts/smoke-escala-marco-zero.js && node scripts/smoke-escala-historico.js && node scripts/smoke-escala-data-formatada.js && node scripts/smoke-escala-ferias.js && node scripts/smoke-escala-frente1.js && node scripts/smoke-escala-frente2.js && node scripts/smoke-escala-frente3.js && node scripts/smoke-escala-tabs.js && node scripts/smoke-escala-confirma-publica.js && node scripts/smoke-escala-dona-do-dia.js && node scripts/smoke-trocar-pessoa-escala.js && node scripts/smoke-ajustes-escala-2508.js && node scripts/smoke-ajuste-contador-rotulo.js && node scripts/smoke-manual-atualizado.js && node scripts/smoke-css-vars.js
```
Esperado: **todos** passam. Anotar o total para o relatório da sessão.

- [ ] **Passo 2: deploy no staging**

```bash
firebase deploy --only hosting --project staging
```

- [ ] **Passo 3: roteiro de homologação com o Rafael, clicando de verdade**

Não é opcional e não é substituível pelos smokes — a prévia que nunca rodou passou por 12
verificações automatizadas.

1. ⚙️ Configurações → gravar marco zero `01/09/2026`; conferir que o painel de Equilíbrio passa
   a dizer "Contando a partir de sábado, 01/09/2026" e que os números do ano mudaram.
2. Painel de Equilíbrio: confirmar que **não existe** mais "+ dias fora" e que o botão
   **Ajustar** aparece.
3. Ajustar alguém para baixo num lote **não publicado** → prévia → aplicar → conferir a lista.
4. Ajustar alguém para cima num lote **publicado** → aplicar → conferir a aula trocada na
   Agenda Geral e os avisos no sino dos dois envolvidos e da gestão.
5. Fechar a prévia de um lote montado sem publicar → conferir a barra amarela com
   "✅ Publicar as N datas de sábado na agenda e avisar" na tela principal.
6. Abrir uma data qualquer → 🕐 Histórico desta escala com as ações do dia.
7. Rodapé → 📜 Últimas alterações do módulo.
8. Aba Por pessoa → coluna Janela + filtro "⚠️ Fora de janela".
9. Cartões de escala mostrando "sexta-feira, 20/11/2026".
10. 🚫 Tirar do lote numa data de teste.
11. Fim de ano: consolidar, barra "ainda não publicado", Ajustar, e a mesma pessoa em dois dias
    diferentes do período.
12. **Console sem erro** em todos os passos.

- [ ] **Passo 4: registrar o resultado**

Atualizar `CONTEXTO_SESSAO.md` (seção 🔖 ONDE PARAMOS + log da sessão) e o
`CLAUDE.md` ("Estado atual em uma frase") com o que foi homologado, o que falta e o que ficou
de fora.

- [ ] **Passo 5: commit**

```bash
git add CONTEXTO_SESSAO.md CLAUDE.md
git commit -m "docs: sessao 59 — rebalanceio, marco zero e log homologados no staging"
```

---

## Task 25: dados de produção (só depois do OK explícito)

⚠️ **Regra inviolável 7:** nada aqui roda antes de o Rafael dizer que homologou. Nenhuma escala
é remontada, nenhuma data é republicada (resposta 3: *"não mexa em nada"*).

- [ ] **Passo 1: publicar o código**

```bash
git checkout main && git merge escala-rebalanceio-log && git push origin main
```

O site dos usuários é o GitHub Pages servindo o `main` — `firebase deploy --only hosting`
**não** entrega ([[publicar-para-usuario-github-pages]]).

- [ ] **Passo 2: marco zero em produção**

Pela tela, como Admin: ⚙️ Configurações → `01/09/2026` → Salvar. Conferir na tela que o painel
passou a dizer a data.

- [ ] **Passo 3: zerar os ajustes**

```bash
node scripts/zerar-ajustes-partida.js --project production
```
Conferir o relatório (deve aparecer o `+3` da Heloísa). Só então:

```bash
node scripts/zerar-ajustes-partida.js --project production --executar
```

- [ ] **Passo 4: limpar 02/11 e 20/11**

Pela tela, com o botão 🚫 Tirar do lote em cada uma das duas datas. Confirmar depois na aba
**Por pessoa** que o filtro "⚠️ Fora de janela" não devolve mais nenhuma linha nessas datas.

- [ ] **Passo 5: conferir que nada mais mudou**

Na aba Sábados, confirmar que **setembro e outubro continuam publicados com as mesmas pessoas**
— nenhuma data foi remontada. É a resposta 3 do Rafael, e a verificação é olhar.

- [ ] **Passo 6: avisar**

Mandar para o Rafael o resumo do que foi para produção e o que ele precisa decidir: quando
refazer setembro/outubro (botão 🔄 Refazer) e quando abrir a janela de novembro, que vai pegar
02/11 e 20/11 já limpos.

---

## Fora do escopo desta frente

- Refazer setembro/outubro (resposta 3 — a gestão decide quando)
- Sábado 29/08 (resposta 6 — acontece no papel)
- Fila única sábado+feriado (pergunta antiga, sem resposta do Rodrigo)
- Tirar um dia do período de fim de ano
- Qualquer mudança em Security Rules
