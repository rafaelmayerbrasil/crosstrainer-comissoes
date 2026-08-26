# Escala Inteligente — contador derivado + 5 pedidos do Rodrigo · Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o contador de justiça da escala ser **contado das escalas** em vez de guardado à parte — o que corrige de uma vez o contador errado, a separação sábado/feriado, o recorte por janela e o histórico do ano — e entregar junto os outros 4 pedidos do Rodrigo (descanso perto do feriado, inverter entre unidades, não mostrar antes de publicar, aba por pessoa).

**Architecture:** Duas funções **puras** novas em `scale-service.js` (`contarPorPessoa`, `personsOnNearbyScale`) viram a única fonte do número. `scale-engine.js` **não muda** — só muda de onde vem o `diasTrabalhados` que ele recebe. `fairness_counter` deixa de ser contador e passa a guardar só um **ajuste de partida** (para lançar agosto, que aconteceu pela grade antiga). A tela calcula as contagens em memória, com as escalas que já carrega.

**Tech Stack:** JavaScript vanilla (sem framework, sem build), Firebase Firestore, Node 22 para os smokes (`assert` + `scripts/_fake-firestore.js`).

**Spec:** `docs/superpowers/specs/2026-08-26-escala-contador-derivado-design.md`

---

## Contexto que o executor precisa antes de começar

- **O bug, medido em produção:** 9 das 16 pessoas com contador errado. Karin marca `1` e tem 3 sábados (05/09, 19/09, 17/10).
- **Por quê:** `fairness_counter.diasTrabalhados` só se mexe na **primeira** consolidação de cada data (`consolidate` → `applyFairnessDelta`, protegido por `jaConsolidada`) e na troca manual de vaga. Remontar a prévia troca as pessoas e não refaz a conta.
- **Por que é grave:** esse número é o insumo do motor. O contador travado da Karin em 1 é o que a fez pegar 3 sábados.
- **Regra de operação que não pode ser quebrada:** republicar escala **apaga e recria** as aulas — só mexer em data futura, senão aula "realizada" volta pra "prevista".
- **Teto macio:** toda regra de "cede a vez" **ordena pro fim da fila, nunca exclui**. Vaga aberta vira aula que não existe.

## Arquivos

| Arquivo | Responsabilidade | O que muda |
|---|---|---|
| `scale-service.js` | CRUD + consolidação + funções puras | `contarPorPessoa` e `personsOnNearbyScale` novas; `consolidate` passa a contar; `saveFairness`/`applyFairnessDelta` saem; `saveAjustePartida`/`listAjustes` entram |
| `scale-engine.js` | Motor puro de escolha | **Nada.** |
| `professores-escala-smart.js` | Tela da Escala Inteligente | Painel, ✏️, inverter, gate do professor, aba "Por pessoa", refazer janela |
| `scripts/smoke-escala-contagem.js` | **Novo** — testes das duas funções puras + motor com contagem | criado |
| `scripts/diag-contador-escala.js` | **Novo** — leitura de produção (só leitura) p/ conferir antes e depois | criado |
| `scripts/smoke-scale-service.js` | Regressão do serviço | trechos de fairness reescritos |
| `scripts/smoke-trocar-pessoa-escala.js` | Regressão da troca de vaga | trechos de fairness reescritos |
| `scripts/smoke-ajustes-escala-2508.js` | Regressão dos ajustes de 25/08 | seções 2 e 3 reescritas |

**Comando de regressão da escala** (usado várias vezes abaixo):

```bash
node scripts/smoke-escala-contagem.js && node scripts/smoke-scale-engine.js && node scripts/smoke-scale-service.js && node scripts/smoke-trocar-pessoa-escala.js && node scripts/smoke-ajustes-escala-2508.js && node scripts/smoke-escala-frente1.js && node scripts/smoke-escala-frente2.js && node scripts/smoke-escala-frente3.js && node scripts/smoke-escala-confirma-publica.js && node scripts/smoke-escala-ferias.js && node scripts/smoke-escala-tabs.js
```

---

### Task 1: `contarPorPessoa` — a função que substitui o contador

**Files:**
- Modify: `scale-service.js` (bloco das funções puras, logo antes de `personsOnAdjacentSaturday`)
- Test: `scripts/smoke-escala-contagem.js` (criar)

- [ ] **Step 1: Escrever o teste que falha**

Criar `scripts/smoke-escala-contagem.js`:

```js
'use strict';
// Roda: node scripts/smoke-escala-contagem.js
//
// O contador de justiça deixou de ser um número guardado e passou a ser CONTADO
// das escalas. Motivo (25/08/2026): em produção 9 das 16 pessoas estavam com o
// contador errado — a Karin marcava 1 e tinha 3 sábados — porque o número só se
// mexia na primeira montagem de cada data, e remontar a prévia troca as pessoas
// sem refazer a conta. Pior: esse número é o insumo do motor, então o contador
// travado da Karin foi o que a fez pegar 3 sábados.

const assert = require('assert');
const SS = require('../scale-service.js');

let ok = 0;
const passou = (msg) => { console.log('✓ ' + msg); ok++; };

const vaga = (id, pid) => ({ id, unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: pid || null });
const escala = (date, tipo, pessoas, batchId) => ({
  id: `sc_${date}_${tipo}`, date, tipo, windowBatchId: batchId || null,
  slots: pessoas.map((p, i) => vaga(`v${i}`, p)),
});

const ESCALAS = [
  escala('2026-09-05', 'sabado',  ['karin', 'bruno'], 'b1'),
  escala('2026-09-07', 'feriado', ['bruno', 'thay'],  'b2'),
  escala('2026-09-19', 'sabado',  ['karin', null],    'b1'),
  escala('2026-10-17', 'sabado',  ['karin'],          'b1'),
  escala('2026-11-14', 'evento',  ['karin']),
  escala('2025-09-06', 'sabado',  ['karin']),
];

// ── por tipo ──
{
  const sab = SS.contarPorPessoa(ESCALAS, { tipos: ['sabado'] });
  assert.strictEqual(sab.karin, 4, 'karin tem 3 sábados em 2026 + 1 em 2025');
  assert.strictEqual(sab.bruno, 1, 'bruno tem 1 sábado');
  assert.strictEqual(sab.thay, undefined, 'thay não tem sábado nenhum');
  assert.strictEqual(sab.evento, undefined, 'evento não é sábado');
  passou('conta por tipo e ignora os outros tipos');
}

// ── feriado NÃO soma sábado (pedido 4 do Rodrigo) ──
{
  const fer = SS.contarPorPessoa(ESCALAS, { tipos: ['feriado', 'domingo_especial'] });
  assert.strictEqual(fer.bruno, 1, 'bruno tem 1 feriado');
  assert.strictEqual(fer.karin, undefined, 'os 3 sábados da karin não entram em feriados');
  passou('feriado conta só feriado');
}

// ── por ano ──
{
  const ano = SS.contarPorPessoa(ESCALAS, { tipos: ['sabado'], de: '2026-01-01', ate: '2026-12-31' });
  assert.strictEqual(ano.karin, 3, 'o sábado de 2025 fica fora do ano de 2026');
  passou('recorta por período');
}

// ── por janela ──
{
  const j = SS.contarPorPessoa(ESCALAS, { tipos: ['sabado'], batchId: 'b1' });
  assert.strictEqual(j.karin, 3, 'karin tem 3 datas no lote b1');
  assert.strictEqual(j.bruno, 1, 'bruno tem 1');
  const j2 = SS.contarPorPessoa(ESCALAS, { tipos: ['feriado'], batchId: 'b1' });
  assert.deepStrictEqual(j2, {}, 'o lote b1 não tem feriado');
  passou('recorta por janela (lote)');
}

// ── excluirDatas: o coração do "refazer a janela" ──
// Ao remontar, as datas que ainda carregam a escala ANTIGA não podem entrar na
// conta — senão a escala velha empurra as pessoas erradas na escala nova.
{
  const c = SS.contarPorPessoa(ESCALAS, { tipos: ['sabado'], excluirDatas: ['2026-09-19', '2026-10-17'] });
  assert.strictEqual(c.karin, 2, 'sobram 05/09 e o de 2025');
  const cSet = SS.contarPorPessoa(ESCALAS, { tipos: ['sabado'], excluirDatas: new Set(['2026-09-19']) });
  assert.strictEqual(cSet.karin, 3, 'aceita Set do mesmo jeito que array');
  passou('excluirDatas tira as datas que estão sendo remontadas');
}

// ── vaga aberta não conta ──
{
  const c = SS.contarPorPessoa([escala('2026-09-26', 'sabado', [null, null])], { tipos: ['sabado'] });
  assert.deepStrictEqual(c, {}, 'vaga sem ninguém não conta pra ninguém');
  passou('vaga aberta não conta');
}

// ── sem filtro: conta tudo; entrada vazia não estoura ──
{
  assert.deepStrictEqual(SS.contarPorPessoa([], {}), {}, 'lista vazia devolve objeto vazio');
  assert.deepStrictEqual(SS.contarPorPessoa(null, null), {}, 'null não estoura');
  passou('entrada vazia é segura');
}

// ── tiposIrmaos ──
{
  assert.deepStrictEqual(SS.tiposIrmaos('sabado'), ['sabado']);
  assert.deepStrictEqual(SS.tiposIrmaos('feriado'), ['feriado', 'domingo_especial']);
  assert.deepStrictEqual(SS.tiposIrmaos('domingo_especial'), ['feriado', 'domingo_especial']);
  passou('feriado e domingo especial contam juntos');
}

console.log(`\n✓ smoke-escala-contagem: ${ok} seções OK`);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-escala-contagem.js`
Expected: FAIL — `TypeError: SS.contarPorPessoa is not a function`

- [ ] **Step 3: Implementar as duas funções puras**

Em `scale-service.js`, inserir **imediatamente antes** do comentário `/** * PURO: quem já está escalado no sábado imediatamente anterior ou seguinte.`:

```js
  /**
   * PURO: os tipos de escala que contam juntos. Feriado e domingo especial são
   * a mesma coisa pra quem olha ("dia especial que não é sábado") e a aba
   * Feriados sempre mostrou os dois.
   */
  function tiposIrmaos(tipo) {
    return (tipo === 'feriado' || tipo === 'domingo_especial')
      ? ['feriado', 'domingo_especial']
      : [tipo];
  }

  /**
   * PURO: quantas vagas cada pessoa tem nas escalas que casam com o filtro.
   *
   * Esta função É o contador de justiça. Até 25/08/2026 o número ficava guardado
   * em `fairness_counter` e só se mexia na PRIMEIRA montagem de cada data — então
   * remontar a prévia trocava as pessoas sem refazer a conta, e em produção 9 das
   * 16 pessoas estavam erradas (Karin marcava 1 e tinha 3 sábados). Contar na hora
   * não tem como divergir.
   *
   * @param {Array} scales lista de special_scales (a tela já carrega todas)
   * @param {{tipos?:string[], batchId?:string, de?:string, ate?:string,
   *          excluirDatas?:string[]|Set<string>}} filtro
   * @returns {Object<string, number>} personId → quantas vagas
   */
  function contarPorPessoa(scales, filtro) {
    const f = filtro || {};
    const tipos = (f.tipos && f.tipos.length) ? f.tipos : null;
    const excluir = (f.excluirDatas instanceof Set)
      ? f.excluirDatas : new Set(f.excluirDatas || []);
    const out = {};
    (scales || []).forEach(s => {
      if (!s || !s.date) return;
      if (tipos && tipos.indexOf(s.tipo) === -1) return;
      if (f.batchId && s.windowBatchId !== f.batchId) return;
      if (f.de && s.date < f.de) return;
      if (f.ate && s.date > f.ate) return;
      if (excluir.has(s.date)) return;
      (s.slots || []).forEach(sl => {
        const pid = sl && sl.assignedPersonId;
        if (!pid) return;
        out[pid] = (out[pid] || 0) + 1;
      });
    });
    return out;
  }
```

- [ ] **Step 4: Exportar**

Em `scale-service.js`, na linha do `return { templateSlots, ... }` (a última do módulo), acrescentar `contarPorPessoa, tiposIrmaos,` logo depois de `buildConsolidationMatrix,`.

- [ ] **Step 5: Rodar e ver passar**

Run: `node scripts/smoke-escala-contagem.js`
Expected: PASS — `✓ smoke-escala-contagem: 7 seções OK`

- [ ] **Step 6: Commit**

```bash
git add scale-service.js scripts/smoke-escala-contagem.js
git commit -m "feat(escala): contarPorPessoa — o contador de justica vira contagem"
```

---

### Task 2: `personsOnNearbyScale` — descanso perto do feriado

**Files:**
- Modify: `scale-service.js` (substitui `personsOnAdjacentSaturday`)
- Modify: `scale-service.js:~700` (a chamada dentro de `consolidate`)
- Test: `scripts/smoke-escala-contagem.js` (acrescentar seção)

**Contexto:** hoje a regra só liga sábado com sábado, porque a função sai fora logo no começo se a data não for sábado (`d.getDay() !== 6`). O pedido do Rodrigo é que o feriado de meio de semana converse com os sábados vizinhos: 07/09 é segunda, e 05/09 e 12/09 estão a 2 e 5 dias.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `scripts/smoke-escala-contagem.js`, **antes** da linha `console.log(\`\n✓ smoke-escala-contagem...`:

```js
// ── descanso: quem trabalhou perto não pega a próxima ────────────────
// Rodrigo, 25/08/2026: "se o colaborador foi escalado sábado passado ou seguinte
// ao feriado em questão, preferencialmente não deverá escalado em sábados
// próximos imediatamente anterior ou posterior ao feriado".
const VIZINHAS = [
  escala('2026-09-05', 'sabado',  ['ana']),
  escala('2026-09-07', 'feriado', ['bia']),
  escala('2026-09-12', 'sabado',  ['ceu']),
  escala('2026-09-26', 'sabado',  ['dri']),
  escala('2026-09-19', 'evento',  ['edu']),
];
{
  // feriado de SEGUNDA enxerga os dois sábados ao lado — o pedido do Rodrigo
  const v = SS.personsOnNearbyScale(VIZINHAS, '2026-09-07');
  assert.ok(v.has('ana'), 'quem pegou o sábado 2 dias antes conta');
  assert.ok(v.has('ceu'), 'quem pegou o sábado 5 dias depois conta');
  assert.ok(!v.has('bia'), 'a própria data não conta contra si mesma');
  assert.ok(!v.has('dri'), 'sábado a 19 dias não conta');
  passou('feriado de meio de semana enxerga os sábados vizinhos');
}
{
  // e o caminho inverso: montando o sábado, quem pegou o feriado ao lado cede
  const v = SS.personsOnNearbyScale(VIZINHAS, '2026-09-05');
  assert.ok(v.has('bia'), 'quem pegou o feriado 2 dias depois cede a vez no sábado');
  passou('sábado enxerga o feriado vizinho');
}
{
  // o comportamento antigo (sábado com sábado a ±7) segue igual
  const v = SS.personsOnNearbyScale(VIZINHAS, '2026-09-12');
  assert.ok(v.has('ana'), 'sábado anterior (7 dias) conta — comportamento de sempre');
  assert.ok(!v.has('dri'), 'sábado a 14 dias não conta');
  passou('sábado com sábado a ±7 preservado');
}
{
  // evento e escola interna ficam de fora ("só pra sábado mesmo", Rafael 25/08)
  const v = SS.personsOnNearbyScale(VIZINHAS, '2026-09-26');
  assert.ok(!v.has('edu'), 'evento não entra na regra do descanso');
  passou('evento fica de fora');
}
{
  assert.strictEqual(SS.personsOnNearbyScale(VIZINHAS, null).size, 0, 'sem data devolve vazio');
  assert.strictEqual(SS.personsOnNearbyScale(null, '2026-09-05').size, 0, 'sem escalas devolve vazio');
  passou('entrada vazia é segura no descanso');
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-escala-contagem.js`
Expected: FAIL — `TypeError: SS.personsOnNearbyScale is not a function`

- [ ] **Step 3: Trocar a função**

Em `scale-service.js`, **substituir por inteiro** o bloco que começa em `/**` + `* PURO: quem já está escalado no sábado imediatamente anterior ou seguinte.` e termina no `}` de `personsOnAdjacentSaturday` (inclusive o `pad2` que ele usava, se não for usado por mais ninguém — confira com `grep -n "pad2" scale-service.js` antes de remover):

```js
  /**
   * PURO: quem já está escalado numa data de escala PERTO desta.
   *
   * Nasceu como "sábado imediatamente anterior ou seguinte" (Rafael, 25/08/2026:
   * "Para o professor não trabalhar em um sábado de feriado na sequência de um
   * sábado normal") e a função saía fora se a data não fosse sábado. Rodrigo,
   * 25/08, pediu o outro lado: quem pegou o sábado vizinho ao feriado também não
   * deve pegar o feriado. Uma distância só resolve os dois — 07/09 é segunda, e
   * os sábados 05/09 e 12/09 estão a 2 e 5 dias; entre sábados, ±7 dá exatamente
   * o anterior e o seguinte, que é o comportamento de sempre.
   *
   * A PRÓPRIA data fica de fora: uma escala não pode barrar os próprios
   * candidatos (quem já está numa vaga do dia já é barrado pelo motor).
   * Escola Interna, evento e fim de ano ficam de fora — "só pra sábado mesmo".
   *
   * @returns {Set<string>} teacherIds
   */
  function personsOnNearbyScale(scales, dateISO, dias) {
    const out = new Set();
    if (!dateISO) return out;
    const janela = (dias == null) ? 7 : dias;
    const base = new Date(dateISO + 'T12:00:00');
    if (isNaN(base)) return out;
    (scales || []).forEach(s => {
      if (!s || !s.date || s.date === dateISO) return;
      if (s.tipo !== 'sabado' && s.tipo !== 'feriado' && s.tipo !== 'domingo_especial') return;
      const d = new Date(s.date + 'T12:00:00');
      if (isNaN(d)) return;
      const dist = Math.abs(Math.round((d - base) / 86400000));
      if (dist > janela) return;
      (s.slots || []).forEach(sl => { if (sl.assignedPersonId) out.add(sl.assignedPersonId); });
    });
    return out;
  }
```

- [ ] **Step 4: Atualizar a chamada e o export**

Em `scale-service.js`, dentro de `consolidate`, trocar:

```js
      const vizinhoById = personsOnAdjacentSaturday(ctx.scalesDoAno || [], scale.date);
```

por:

```js
      const vizinhoById = personsOnNearbyScale(ctx.scalesDoAno || [], scale.date);
```

E no `return { ... }` final do módulo, trocar `personsOnAdjacentSaturday,` por `personsOnNearbyScale,`.

- [ ] **Step 5: Rodar e ver passar**

Run: `node scripts/smoke-escala-contagem.js`
Expected: PASS — `✓ smoke-escala-contagem: 12 seções OK`

- [ ] **Step 6: Achar quem mais chamava o nome antigo**

Run: `grep -rn "personsOnAdjacentSaturday" --include=*.js . | grep -v node_modules`
Expected: só `scripts/smoke-ajustes-escala-2508.js` (será tratado na Task 12). Se aparecer outro arquivo de produção, corrigir agora.

- [ ] **Step 7: Commit**

```bash
git add scale-service.js scripts/smoke-escala-contagem.js
git commit -m "feat(escala): o descanso passa a valer entre feriado e os sabados vizinhos"
```

---

### Task 3: `fairness_counter` vira ajuste de partida

**Files:**
- Modify: `scale-service.js` (`getFairness`, `saveFairness`, `applyFairnessDelta`, `reassignSlot`)

**Contexto:** `divida` nunca foi incrementada por nada no sistema — é código morto desde a origem. `diasTrabalhados` some como contador e o documento passa a guardar só `ajuste`: quantos dias lançar na mão para uma pessoa. Serve pra agosto, que aconteceu pela grade antiga e não existe em `special_scales`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `scripts/smoke-escala-contagem.js`, antes do `console.log` final:

```js
// ── ajuste de partida ────────────────────────────────────────────────
// Rafael, 25/08: "o que passou eles têm como ajustar manualmente?". Agosto
// aconteceu pela grade antiga e não existe em special_scales, então não há o
// que contar — só o que lançar.
(async () => {
  const makeFakeDb = require('./_fake-firestore.js');
  const SE = require('../scale-engine.js');
  const db = makeFakeDb();
  const d = { db, ts: () => 'TS', uid: () => 'tester', SE };

  const zero = await SS.getFairness('ana', d);
  assert.strictEqual(zero.data.ajuste, 0, 'sem documento, ajuste é zero');

  await SS.saveAjustePartida('ana', 3, d);
  const dep = await SS.getFairness('ana', d);
  assert.strictEqual(dep.data.ajuste, 3, 'ajuste gravado');

  await SS.saveAjustePartida('ana', -5, d);
  assert.strictEqual((await SS.getFairness('ana', d)).data.ajuste, 0, 'ajuste nunca fica negativo');

  await SS.saveAjustePartida('bru', 1, d);
  const todos = await SS.listAjustes(d);
  assert.deepStrictEqual(todos.data, { ana: 0, bru: 1 }, 'listAjustes traz todo mundo de uma vez');

  console.log('✓ ajuste de partida grava, lista e não fica negativo');
  console.log('\n✓ smoke-escala-contagem: todas as seções OK');
})();
```

E **remover** a linha `console.log(\`\n✓ smoke-escala-contagem: ${ok} seções OK\`);` que existia no fim (o bloco assíncrono acima passa a fechar o arquivo).

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-escala-contagem.js`
Expected: FAIL — `TypeError: SS.saveAjustePartida is not a function`

- [ ] **Step 3: Trocar as três funções de fairness**

Em `scale-service.js`, substituir o bloco inteiro `getFairness` + `saveFairness` + `applyFairnessDelta` por:

```js
  /**
   * O que sobrou do antigo contador: um AJUSTE DE PARTIDA por pessoa.
   *
   * Até 25/08/2026 este documento guardava `diasTrabalhados` e `divida` e era o
   * contador de justiça — que vivia errado, porque só se mexia na primeira
   * montagem de cada data. Quem conta agora é `contarPorPessoa`, direto das
   * escalas. Sobrou o ajuste porque agosto aconteceu pela grade antiga e não
   * existe em `special_scales`: não há o que contar, só o que lançar.
   * (`divida` nunca foi incrementada por nada — era código morto desde a origem.)
   */
  async function getFairness(personId, deps) {
    try {
      const doc = await rdb(deps).collection('fairness_counter').doc(personId).get();
      const dados = doc.exists ? (doc.data() || {}) : {};
      return { success: true, data: { personId, ajuste: Math.max(0, Number(dados.ajuste) || 0) } };
    } catch (err) { console.error('[ScaleService.getFairness]', err); return { success: false, error: err.message }; }
  }

  async function saveAjustePartida(personId, ajuste, deps) {
    try {
      const n = Math.max(0, Math.round(Number(ajuste) || 0));
      await rdb(deps).collection('fairness_counter').doc(personId)
        .set({ personId, ajuste: n, updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      return { success: true, data: { ajuste: n } };
    } catch (err) { console.error('[ScaleService.saveAjustePartida]', err); return { success: false, error: err.message }; }
  }

  /** Todos os ajustes de uma vez — a tela lia um por pessoa, 16 leituras por render. */
  async function listAjustes(deps) {
    try {
      const snap = await rdb(deps).collection('fairness_counter').get();
      const out = {};
      snap.docs.forEach(doc => {
        const v = doc.data() || {};
        out[v.personId || doc.id] = Math.max(0, Number(v.ajuste) || 0);
      });
      return { success: true, data: out };
    } catch (err) { console.error('[ScaleService.listAjustes]', err); return { success: false, error: err.message, data: {} }; }
  }
```

- [ ] **Step 4: Tirar o acerto de contador do `reassignSlot`**

Em `scale-service.js`, dentro de `reassignSlot`, substituir o bloco:

```js
      let fairnessAjustada = false;
      if (scale.fairnessApplied === true) {
        if (antes) {
          const cur = (await getFairness(antes, deps)).data;
          await saveFairness(antes, { diasTrabalhados: Math.max(0, cur.diasTrabalhados - 1), divida: cur.divida }, deps);
        }
        if (depois) {
          const cur = (await getFairness(depois, deps)).data;
          await saveFairness(depois, { diasTrabalhados: cur.diasTrabalhados + 1, divida: cur.divida }, deps);
        }
        fairnessAjustada = true;
      }
      return { success: true, data: { changed: true, from: antes, to: depois, fairnessAjustada, published: !!scale.published } };
```

por:

```js
      // Não há contador pra acertar: quem conta é `contarPorPessoa`, e ela lê
      // esta escala que acabou de ser gravada. A troca manual entra na conta
      // sozinha, na próxima vez que alguém contar.
      return { success: true, data: { changed: true, from: antes, to: depois, published: !!scale.published } };
```

> **Nota:** `fairnessAjustada` deixa de existir. Quem lia esse campo: a tela, no passo abaixo.

- [ ] **Step 5: Tirar da tela a frase do contador acertado**

Em `professores-escala-smart.js`, dentro de `trocarPessoaEscala`, remover a linha:

```js
  if (res.data.fairnessAjustada) msg += ' Contador de justiça acertado.';
```

E conferir que ninguém mais lê o campo:

Run: `grep -rn "fairnessAjustada" --include=*.js . | grep -v node_modules`
Expected: só `scripts/smoke-trocar-pessoa-escala.js` (tratado na Task 12).

- [ ] **Step 6: Atualizar os exports**

No `return { ... }` final do módulo, trocar `getFairness, saveFairness, applyFairnessDelta,` por `getFairness, saveAjustePartida, listAjustes,`.

- [ ] **Step 7: Rodar e ver passar**

Run: `node scripts/smoke-escala-contagem.js`
Expected: PASS — termina com `✓ smoke-escala-contagem: todas as seções OK`

> **Daqui em diante:** toda seção nova do smoke entra **dentro do bloco assíncrono**, antes da
> linha `console.log('\n✓ smoke-escala-contagem: todas as seções OK');`.

- [ ] **Step 8: Commit**

```bash
git add scale-service.js professores-escala-smart.js scripts/smoke-escala-contagem.js
git commit -m "refactor(escala): fairness_counter vira ajuste de partida"
```

---

### Task 4: `consolidate` passa a contar

**Files:**
- Modify: `scale-service.js` (`consolidate`)
- Test: `scripts/smoke-escala-contagem.js`

- [ ] **Step 1: Escrever o teste que falha**

Dentro do bloco assíncrono criado na Task 3 (logo antes do `console.log('✓ ajuste de partida...')`), acrescentar:

```js
  // ── o motor decide pela CONTAGEM, não pelo número guardado ──────────
  // É o cerne do conserto: remontar duas vezes tem que dar o mesmo resultado.
  {
    const slots = [
      { id: 'v1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: null },
    ];
    await SS.createScale({ date: '2026-12-05', tipo: 'sabado', name: 'Sáb 05/12', slots }, d);
    const idNovo = (await SS.listScales(d)).data.find(s => s.date === '2026-12-05').id;

    // Cida já pegou 2 sábados do ano; Duda nenhum. O rodízio tem que dar pra Duda,
    // mesmo com a Cida tendo mais mérito.
    const historico = [
      { id: 'h1', date: '2026-11-07', tipo: 'sabado', slots: [{ id: 'a', assignedPersonId: 'cida' }] },
      { id: 'h2', date: '2026-11-21', tipo: 'sabado', slots: [{ id: 'a', assignedPersonId: 'cida' }] },
    ];
    const ctx = {
      teachers: [
        { id: 'cida', modalityIds: ['TOI'], primaryUnitId: 'cp' },
        { id: 'duda', modalityIds: ['TOI'], primaryUnitId: 'cp' },
      ],
      meritoById: { cida: 99, duda: 1 },
      opts: { minMes: 1 },
      scalesDoAno: historico,
    };
    const r1 = await SS.consolidate(idNovo, ctx, d);
    assert.strictEqual(r1.success, true, 'consolidou');
    assert.strictEqual(r1.data.assignments[0].personId, 'duda', 'quem trabalhou menos no ano vem antes do mérito');

    // Reconsolidar não pode mudar a resposta — era exatamente aqui que o contador
    // antigo travava e a escala saía torta.
    ctx.scalesDoAno = historico.concat((await SS.listScales(d)).data.filter(s => s.date === '2026-12-05'));
    const r2 = await SS.consolidate(idNovo, ctx, d);
    assert.strictEqual(r2.data.assignments[0].personId, 'duda', 'remontar dá o mesmo resultado');

    // Com o ajuste de partida, a Duda passa a estar na frente na conta e cede a vez.
    ctx.ajusteById = { duda: 5 };
    ctx.scalesDoAno = historico;
    const r3 = await SS.consolidate(idNovo, ctx, d);
    assert.strictEqual(r3.data.assignments[0].personId, 'cida', 'o ajuste de partida entra na conta do motor');
    console.log('✓ o motor decide pela contagem e remontar não muda a resposta');
  }
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-escala-contagem.js`
Expected: FAIL — `AssertionError: quem trabalhou menos no ano vem antes do mérito` (o motor ainda lê o contador guardado, que é zero pros dois, e o desempate cai no mérito → escolhe `cida`)

- [ ] **Step 3: Trocar a montagem do fairness dentro de `consolidate`**

Em `scale-service.js`, dentro de `consolidate`, substituir:

```js
      // A1: só a 1ª consolidação move o contador de justiça. Reconsolidar (o botão
      // existe) reaplicava o delta a cada clique e inflava o fairness — insumo central
      // do motor. Reconsolidação reajusta as atribuições, mas não recontabiliza justiça.
      const jaConsolidada = scale.status === 'consolidada' || scale.fairnessApplied === true;
```

por (remover a linha do `jaConsolidada` de vez):

```js
      // Nada de "só a 1ª consolidação conta": o número é CONTADO na hora, então
      // remontar quantas vezes quiser dá sempre a mesma resposta.
```

E substituir:

```js
      const fairnessById = {};
      for (const t of teachers) { fairnessById[t.id] = (await getFairness(t.id, deps)).data; }
```

por:

```js
      // O contador é contado das escalas: mesmo tipo desta data, no ano dela.
      // `excluirDatas` tira do bolo as datas que estão sendo remontadas nesta
      // rodada e ainda carregam a escala ANTIGA — contá-las empurraria as
      // pessoas erradas. A própria data sempre sai, pelo mesmo motivo.
      const ano = String(scale.date || '').slice(0, 4);
      const excluir = new Set(Array.from(ctx.excluirDatas || []));
      excluir.add(scale.date);
      const contagem = contarPorPessoa(ctx.scalesDoAno || [], {
        tipos: tiposIrmaos(scale.tipo),
        de: `${ano}-01-01`, ate: `${ano}-12-31`,
        excluirDatas: excluir,
      });
      const ajustes = ctx.ajusteById || {};
      const fairnessById = {};
      teachers.forEach(t => {
        fairnessById[t.id] = {
          diasTrabalhados: (contagem[t.id] || 0) + (ajustes[t.id] || 0),
          divida: 0,
        };
      });
```

E na gravação, tirar o `fairnessApplied` e o `applyFairnessDelta`:

```js
      await rdb(deps).collection('special_scales').doc(scaleId)
        .set({ slots: newSlots, status: 'consolidada', updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      return { success: true, data: { assignments: result.assignments } };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node scripts/smoke-escala-contagem.js`
Expected: PASS

- [ ] **Step 5: Conferir que ninguém mais fala de `fairnessApplied`**

Run: `grep -rn "fairnessApplied\|applyFairnessDelta\|saveFairness" --include=*.js . | grep -v node_modules`
Expected: só `scripts/refazer-escalas-com-rodizio.js` (script histórico de 24/08, não roda mais) e os smokes da Task 12. Nenhum arquivo de produção.

- [ ] **Step 6: Commit**

```bash
git add scale-service.js scripts/smoke-escala-contagem.js
git commit -m "feat(escala): o motor decide pela contagem das escalas"
```

---

### Task 5: A tela carrega ajustes e sabe qual é a janela

**Files:**
- Modify: `professores-escala-smart.js:9` (estado), `:100-124` (`escalaLoadBase`)

- [ ] **Step 1: Acrescentar os campos ao estado**

Em `professores-escala-smart.js`, linha 9, trocar `fairnessMap: new Map(),` por `ajusteMap: {}, janelaBatchId: null, janelaAberta: false, pessoaSel: null, remontando: null,`.

> **Esperado entre esta task e a próxima:** o painel de equilíbrio fica **vazio** (ele ainda lê
> `fairnessMap`, que agora não existe, e o `|| new Map()` faz ele devolver string vazia). Não é
> quebra — a Task 6 reescreve o painel. Não parar aqui.

- [ ] **Step 2: Trocar o carregamento**

Em `escalaLoadBase`, substituir:

```js
  // carrega o contador de justiça/compensação de cada colaborador ativo (p/ painel de equilíbrio)
  const fmap = new Map();
  for (const t of EscalaSmartState.teacherMap.values()) {
    if (t.isActive === false) continue;
    const fr = await ScaleService.getFairness(t.id);
    fmap.set(t.id, fr.success ? fr.data : { diasTrabalhados: 0, divida: 0 });
  }
  EscalaSmartState.fairnessMap = fmap;
```

por:

```js
  // Ajustes de partida (o que foi lançado na mão). O contador em si não se
  // carrega: ele é contado das escalas que já estão aqui.
  const aj = await ScaleService.listAjustes();
  EscalaSmartState.ajusteMap = aj.success ? aj.data : {};

  // Qual é "a janela": a que está aberta; se não há nenhuma aberta, a última
  // que existiu — é dela que a gestão acabou de falar.
  const lotes = {};
  EscalaSmartState.scales.forEach(s => {
    if (!s.windowBatchId) return;
    const l = lotes[s.windowBatchId] || (lotes[s.windowBatchId] = { id: s.windowBatchId, aberta: false, ultima: '' });
    if (s.status === 'janela_aberta') l.aberta = true;
    if (s.date > l.ultima) l.ultima = s.date;
  });
  const lista = Object.keys(lotes).map(k => lotes[k]);
  const aberta = lista.find(l => l.aberta);
  const recente = lista.slice().sort((a, b) => (a.ultima > b.ultima ? -1 : 1))[0];
  EscalaSmartState.janelaBatchId = ((aberta || recente) || {}).id || null;
  EscalaSmartState.janelaAberta = !!aberta;
```

- [ ] **Step 3: Verificar que a tela não quebra**

Run: `node -e "new Function(require('fs').readFileSync('professores-escala-smart.js','utf8'))" && echo SINTAXE_OK`
Expected: `SINTAXE_OK`

- [ ] **Step 4: Commit**

```bash
git add professores-escala-smart.js
git commit -m "refactor(escala): a tela carrega ajustes e identifica a janela do momento"
```

---

### Task 6: Painel de equilíbrio — janela e ano, sábado e feriado separados

**Files:**
- Modify: `professores-escala-smart.js` (`renderEquilibrioPainel`, e um helper novo antes dela)

- [ ] **Step 1: Escrever o teste estrutural que falha**

Acrescentar em `scripts/smoke-escala-contagem.js`, dentro do bloco assíncrono, antes do `console.log` final:

```js
  // ── a tela está ligada na contagem, não no contador velho ───────────
  {
    const fs = require('fs');
    const path = require('path');
    const ui = fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8');
    assert.ok(!/fairnessMap/.test(ui), 'a tela não pode mais guardar fairnessMap');
    assert.ok(/ScaleService\.contarPorPessoa\(/.test(ui), 'a tela conta pelas escalas');
    assert.ok(/ScaleService\.listAjustes\(/.test(ui), 'a tela carrega os ajustes de uma vez');
    assert.ok(/ScaleService\.saveAjustePartida\(/.test(ui), 'o lápis grava ajuste de partida');
    const painel = ui.slice(ui.indexOf('function renderEquilibrioPainel'), ui.indexOf('function whyTableHtml'));
    assert.ok(/no ano/.test(painel), 'o painel mostra o número do ano ao lado do da janela');
    console.log('✓ a tela usa a contagem derivada');
  }
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-escala-contagem.js`
Expected: FAIL — `AssertionError: a tela não pode mais guardar fairnessMap`

- [ ] **Step 3: Escrever o helper de contagem da tela**

Em `professores-escala-smart.js`, inserir **logo antes** de `function renderEquilibrioPainel()`:

```js
/**
 * Os dois números de cada pessoa: o da janela e o do ano.
 *
 * Rodrigo, 25/08/2026: "O contador deve considerar somente a janela aberta...
 * e em outro, um relatório separado, trazer quantas vezes quem foi escalado em
 * sábados e feriados". O painel mostra a janela; o motor decide pelo ano — se
 * zerasse nos dois, na 1ª data de cada janela todo mundo empataria em zero e o
 * desempate voltaria a ser o mérito, que é fixo. Foi o defeito que quebrou
 * agosto (Bruno e Karin nos 11 sábados).
 */
function escalaContagens(tipo) {
  const scales = EscalaSmartState.scales || [];
  const tipos = ScaleService.tiposIrmaos(tipo || 'sabado');
  const ano = String(EscalaSmartState.year);
  return {
    janela: EscalaSmartState.janelaBatchId
      ? ScaleService.contarPorPessoa(scales, { tipos, batchId: EscalaSmartState.janelaBatchId })
      : {},
    ano: ScaleService.contarPorPessoa(scales, { tipos, de: `${ano}-01-01`, ate: `${ano}-12-31` }),
  };
}
```

- [ ] **Step 4: Trocar o painel**

Substituir o corpo de `renderEquilibrioPainel()` (da linha `function renderEquilibrioPainel() {` até o `}` que fecha a função) por:

```js
function renderEquilibrioPainel() {
  const ativos = Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false);
  const dentro = ativos.filter(participaDoRodizio);
  const fora   = ativos.filter(t => !participaDoRodizio(t));
  if (!dentro.length) return '';

  // A aba manda no que se conta: na aba Feriados, feriado; nas outras, sábado.
  // (Rodrigo, 25/08: "Nessa seção de feriados deveria contar somente os feriados".)
  const tipo = EscalaSmartState.tab === 'feriado' ? 'feriado' : 'sabado';
  const rotuloTipo = tipo === 'feriado' ? 'feriados' : 'sábados';
  const c = escalaContagens(tipo);
  const ajustes = EscalaSmartState.ajusteMap || {};

  const dias = dentro.map(t => c.janela[t.id] || 0);
  const avg = dias.reduce((a, b) => a + b, 0) / dias.length;

  const grupos = { abaixo: [], media: [], acima: [] };
  dentro.forEach(t => {
    const n = c.janela[t.id] || 0;
    const g = (n < 1) ? 'abaixo' : (n > Math.ceil(avg) ? 'acima' : 'media');
    grupos[g].push({ t, n, ano: (c.ano[t.id] || 0), ajuste: (ajustes[t.id] || 0) });
  });
  Object.keys(grupos).forEach(k => grupos[k].sort((a, b) => a.n - b.n));

  const linha = (x) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:3px 0;font-size:12px;">
      <span>${escalaEsc(x.t.name)}</span>
      <span style="display:flex;align-items:center;gap:6px;color:var(--text2);white-space:nowrap;">
        ${x.n} nesta janela · ${x.ano}${x.ajuste ? ` + ${x.ajuste} de ajuste` : ''} no ano
        <button class="btn-secondary" style="font-size:11px;padding:2px 8px;"
                onclick="ajustarContadorJustica('${x.t.id}')" title="Lançar dias que aconteceram fora do sistema">✏️</button>
      </span>
    </div>`;

  const bloco = (chave, bg, color, icon, rotulo) => {
    const itens = grupos[chave];
    return `<details style="flex:1;min-width:190px;">
      <summary style="list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:6px 12px;border-radius:8px;background:${bg};color:${color};">
        ${icon} ${itens.length} ${rotulo}
      </summary>
      <div style="padding:6px 4px 0;">${itens.length ? itens.map(linha).join('') : '<span style="font-size:12px;color:var(--text3);">ninguém</span>'}</div>
    </details>`;
  };

  const foraHtml = fora.length
    ? `<div style="font-size:11px;color:var(--text3);margin-top:8px;">
         ${fora.length} pessoa${fora.length === 1 ? '' : 's'} fora do rodízio de sábado (não dá TOI nem Hiit):
         ${fora.map(t => escalaEsc(t.name)).join(' · ')}
       </div>`
    : '';

  const titulo = !EscalaSmartState.janelaBatchId
    ? `Equilíbrio — nenhuma janela ainda (${rotuloTipo})`
    : EscalaSmartState.janelaAberta
      ? `Equilíbrio da janela aberta (${rotuloTipo})`
      : `Equilíbrio da última janela (${rotuloTipo})`;

  return `<div style="margin-bottom:14px;">
    <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">${titulo}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;">
      ${bloco('abaixo', '#2a1414', 'var(--red)',   '↓', 'ainda não pegou nenhum')}
      ${bloco('media',  '#10241a', 'var(--green)', '=', 'na média')}
      ${bloco('acima',  '#2a2410', '#caa23a',      '↑', 'acima')}
    </div>
    ${foraHtml}
  </div>`;
}
```

- [ ] **Step 5: Trocar o lápis para gravar ajuste**

Substituir o corpo de `ajustarContadorJustica` por:

```js
async function ajustarContadorJustica(personId) {
  const atual = (EscalaSmartState.ajusteMap || {})[personId] || 0;
  const nome = escalaPersonName(personId);
  const resp = prompt(
    `Quantos dias de escala lançar na mão para ${nome}?\n\n` +
    `O sistema já conta sozinho tudo o que está nas escalas. Este número é só para ` +
    `o que aconteceu FORA delas — agosto, por exemplo, que rodou pela grade antiga.`,
    String(atual));
  if (resp === null) return;
  const n = Number(String(resp).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) { toast('Informe um número igual ou maior que zero.', 'error'); return; }

  const novo = Math.round(n);
  const res = await ScaleService.saveAjustePartida(personId, novo);
  if (!res || res.success === false) { toast('Erro ao salvar: ' + ((res && res.error) || 'falha'), 'error'); return; }

  // Mexer no insumo do motor sem deixar rastro seria pedir pra alguém depois não
  // entender por que o rodízio decidiu o que decidiu.
  if (typeof AuditService === 'object') {
    await AuditService.log({
      type: 'fairness_adjusted',
      details: `Ajuste de partida de "${nome}" alterado de ${atual} para ${novo}`,
      entityType: 'fairness_counter', entityId: personId,
      before: { ajuste: atual }, after: { ajuste: novo },
      module: 'agenda',
    });
  }
  toast(`Ajuste de ${nome}: ${novo} dia(s).`, 'success');
  await escalaLoadBase();
  renderEscalaGestao();
}
```

- [ ] **Step 6: Passar o ajuste para o motor**

Em `escalaMontarCtx()`, no objeto de retorno, acrescentar depois de `meritoById, opts: { minMes: 1 }, vacations: await escalaCarregarFerias(),`:

```js
    // O que foi lançado na mão (agosto, que rodou pela grade antiga) entra na
    // conta do motor — mas nunca no número da janela.
    ajusteById: EscalaSmartState.ajusteMap || {},
```

E fazer o mesmo no `ctx` montado dentro de `confirmarEAvisar` (o objeto que tem `meritoById, opts: { minMes: 1 },`).

- [ ] **Step 7: Rodar e ver passar**

Run: `node scripts/smoke-escala-contagem.js && node -e "new Function(require('fs').readFileSync('professores-escala-smart.js','utf8'))" && echo SINTAXE_OK`
Expected: PASS + `SINTAXE_OK`

- [ ] **Step 8: Commit**

```bash
git add professores-escala-smart.js scripts/smoke-escala-contagem.js
git commit -m "feat(escala): painel mostra a janela e o ano, com sabado e feriado separados"
```

---

### Task 7: A tabela "por quê?" para de chamar tudo de sábado

**Files:**
- Modify: `professores-escala-smart.js` (`whyTableHtml` e a chamada dentro de `renderEscalaDetail`)

- [ ] **Step 1: Mudar a assinatura**

Em `whyTableHtml(slot)`, trocar a primeira linha por `function whyTableHtml(slot, tipo) {` e, no `<thead>`, trocar:

```js
<th style="padding:3px 6px;font-weight:400;text-align:center;">Sábados</th>
```

por:

```js
<th style="padding:3px 6px;font-weight:400;text-align:center;">${(tipo === 'feriado' || tipo === 'domingo_especial') ? 'Feriados' : 'Sábados'}</th>
```

- [ ] **Step 2: Passar o tipo na chamada**

Em `renderEscalaDetail`, trocar `${filled ? whyTableHtml(slot) : ''}` por `${filled ? whyTableHtml(slot, scale.tipo) : ''}`.

- [ ] **Step 3: Conferir que não sobrou chamada antiga**

Run: `grep -n "whyTableHtml(" professores-escala-smart.js`
Expected: 2 linhas — a definição e a chamada com `scale.tipo`.

- [ ] **Step 4: Commit**

```bash
git add professores-escala-smart.js
git commit -m "fix(escala): a coluna do 'por que' usa o nome do tipo certo"
```

---

### Task 8: O professor só vê depois de publicado

**Files:**
- Modify: `professores-escala-smart.js` (`renderProfSabadosFeriados`)

**Contexto:** a prévia grava `status: 'consolidada'`, e a tela do professor libera a partir daí. Resultado: entre montar a prévia e publicar, o time inteiro já vê "✓ Você está escalado". O e-mail já está certo (só sai no publicar).

- [ ] **Step 1: Escrever o teste estrutural que falha**

Acrescentar em `scripts/smoke-escala-contagem.js`, no bloco assíncrono:

```js
  // ── nada aparece pro professor antes de publicar ────────────────────
  // Rodrigo, 25/08: "A publicação para os colaboradores... deve ocorrer somente
  // depois que a janela em questão de fato for fechada e publicada pela gestão".
  {
    const fs = require('fs');
    const path = require('path');
    const ui = fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8');
    const vista = ui.slice(ui.indexOf('async function renderProfSabadosFeriados'), ui.indexOf('function profDateRow'));
    assert.ok(!/s\.status !== 'consolidada'/.test(vista),
      'a vista do professor não pode mais liberar por status consolidada');
    assert.ok(/s\.published/.test(vista), 'a vista do professor depende de published');
    console.log('✓ o professor só vê a escala depois de publicada');
  }
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-escala-contagem.js`
Expected: FAIL — `a vista do professor não pode mais liberar por status consolidada`

- [ ] **Step 3: Trocar o gate**

Em `renderProfSabadosFeriados`, substituir:

```js
    if (s.status !== 'consolidada') {
      return profDateRow(
        s,
        `${s.date}${escalaHorario(s) ? ` · 🕗 ${escalaHorario(s)}` : ''} · Ainda não liberado`,
        `<span style="font-size:12px;color:var(--text3);">A gestão ainda não abriu as candidaturas</span>`
      );
    }
```

por:

```js
    // Consolidada NÃO é o mesmo que valendo. A prévia (24/08) grava
    // 'consolidada' e PARA — de propósito, pra gestão conferir e ajustar antes.
    // Liberar a vista aí é contar pro time uma escala que ainda vai mudar
    // (Rodrigo, 25/08). Quem manda é a publicação.
    if (!s.published) {
      const texto = s.status === 'consolidada'
        ? 'A gestão está montando a escala'
        : 'A gestão ainda não abriu as candidaturas';
      return profDateRow(
        s,
        `${s.date}${escalaHorario(s) ? ` · 🕗 ${escalaHorario(s)}` : ''} · Ainda não liberado`,
        `<span style="font-size:12px;color:var(--text3);">${texto}</span>`
      );
    }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node scripts/smoke-escala-contagem.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add professores-escala-smart.js scripts/smoke-escala-contagem.js
git commit -m "fix(escala): o professor so ve a escala depois de publicada"
```

---

### Task 9: Inverter com qualquer vaga do dia

**Files:**
- Modify: `professores-escala-smart.js` (`renderEscalaDetail`, `inverterVagasEscala`)

**Contexto:** `ScaleService.swapSlots` **já** troca qualquer par de vagas do mesmo dia — quem limita é a tela, que só oferece o par TOI/Hiit da mesma unidade. Rodrigo quer inverter entre unidades também ("um prof do TOI da PP ser invertido para o Hiit da CP").

- [ ] **Step 1: Escrever o teste estrutural que falha**

Acrescentar em `scripts/smoke-escala-contagem.js`, no bloco assíncrono:

```js
  // ── inverter entre unidades (pedido 6 do Rodrigo) ───────────────────
  {
    const fs = require('fs');
    const path = require('path');
    const ui = fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8');
    assert.ok(/Inverter com…/.test(ui), 'cada vaga oferece inverter com outra vaga do dia');
    assert.ok(/Outra unidade/.test(ui), 'as vagas de outra unidade aparecem no seletor');
    assert.ok(!/⇄ Inverter<\/button>/.test(ui), 'o botão antigo do par TOI/Hiit sai — um mecanismo só');
    console.log('✓ inverter vale entre unidades');
  }
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-escala-contagem.js`
Expected: FAIL — `cada vaga oferece inverter com outra vaga do dia`

- [ ] **Step 3: Escrever o seletor**

Em `renderEscalaDetail`, logo **depois** da função `pessoaOpts`, acrescentar:

```js
  // Inverter com QUALQUER vaga do dia — inclusive de outra unidade (Rodrigo,
  // 25/08: "um prof do TOI da PP ser invertido para o Hiit da CP"). O serviço
  // já fazia; era a tela que só oferecia o par da mesma unidade.
  const inverterSelect = (slot) => {
    const outras = (scale.slots || []).filter(s => s.id !== slot.id);
    if (!outras.length) return '';
    const rotulo = (s) => {
      const u = EscalaSmartState.units.find(x => x.id === s.unitId) || {};
      const uNome = (u.name || s.unitId || '').replace(/CrossTainer\s*/i, '') || s.unitId;
      const mod = s.requiredModalityName
        || (s.requiredModalityId === (EscalaSmartState.modToi || {}).id ? 'TOI' : 'Hiit');
      return `${uNome} · ${mod} · ${escalaPersonName(s.assignedPersonId) || 'vaga aberta'}`;
    };
    const opt = (s) => `<option value="${s.id}">${escalaEsc(rotulo(s))}</option>`;
    const mesma = outras.filter(s => s.unitId === slot.unitId);
    const fora  = outras.filter(s => s.unitId !== slot.unitId);
    return `<select class="input" style="width:100%;margin-top:6px;font-size:12px;"
            onchange="inverterVagasEscala('${scale.id}','${slot.id}',this.value)"
            title="Troca as duas pessoas de vaga">
      <option value="">⇄ Inverter com…</option>
      ${mesma.map(opt).join('')}
      ${fora.length ? `<optgroup label="Outra unidade">${fora.map(opt).join('')}</optgroup>` : ''}
    </select>`;
  };
```

- [ ] **Step 4: Usar o seletor no card e remover o botão antigo**

No card da vaga, logo depois do `<select ... trocarPessoaEscala ...>`, acrescentar `${inverterSelect(slot)}`.

E substituir o bloco do botão antigo:

```js
    // Com exatamente 2 vagas na unidade (o caso TOI + Hiit), oferece a inversão
    // direta. Com 3+ não dá pra adivinhar quais duas, então o botão some.
    const par = byUnit[uid];
    const btnInverter = (par.length === 2 && (par[0].assignedPersonId || par[1].assignedPersonId))
      ? `<button class="btn-secondary" style="font-size:12px;padding:4px 10px;"
                 onclick="inverterVagasEscala('${scale.id}','${par[0].id}','${par[1].id}')"
                 title="Troca as duas pessoas de modalidade">⇄ Inverter</button>`
      : '';
    unitsHtml += `<div style="margin-bottom:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
        <span style="font-size:13px;font-weight:500;">${unitName(uid)}</span>${btnInverter}
      </div>
```

por:

```js
    unitsHtml += `<div style="margin-bottom:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
        <span style="font-size:13px;font-weight:500;">${unitName(uid)}</span>
      </div>
```

- [ ] **Step 5: Avisar quando a pessoa não é habilitada**

Substituir o começo de `inverterVagasEscala` (até a linha `const res = await ScaleService.swapSlots(...)`, exclusive) por:

```js
async function inverterVagasEscala(scaleId, slotAId, slotBId) {
  if (!slotBId) return;                       // voltou pro rótulo "⇄ Inverter com…"
  const scale = EscalaSmartState.scales.find(s => s.id === scaleId) || {};
  const slots = scale.slots || [];
  const a = slots.find(s => s.id === slotAId) || {};
  const b = slots.find(s => s.id === slotBId) || {};
  // Inverter entre unidades pode pôr alguém numa modalidade que não é dele. A
  // gestão pode querer mesmo assim — mas vendo o que está fazendo.
  const habilitado = (pid, modId) => {
    if (!pid || !modId) return true;
    const t = EscalaSmartState.teacherMap.get(pid);
    return !t || (t.modalityIds || []).indexOf(modId) !== -1;
  };
  const avisos = [];
  if (!habilitado(b.assignedPersonId, a.requiredModalityId)) avisos.push(`${escalaPersonName(b.assignedPersonId)} não é habilitado(a) na modalidade da outra vaga`);
  if (!habilitado(a.assignedPersonId, b.requiredModalityId)) avisos.push(`${escalaPersonName(a.assignedPersonId)} não é habilitado(a) na modalidade da outra vaga`);
  if (avisos.length && !confirm(`⚠️ ${avisos.join('.\n')}.\n\nInverter mesmo assim?`)) { renderEscalaGestao(); return; }

  const res = await ScaleService.swapSlots(scaleId, slotAId, slotBId);
```

- [ ] **Step 6: Rodar e ver passar**

Run: `node scripts/smoke-escala-contagem.js && node -e "new Function(require('fs').readFileSync('professores-escala-smart.js','utf8'))" && echo SINTAXE_OK`
Expected: PASS + `SINTAXE_OK`

- [ ] **Step 7: Commit**

```bash
git add professores-escala-smart.js scripts/smoke-escala-contagem.js
git commit -m "feat(escala): inverter vale entre unidades, num mecanismo so"
```

---

### Task 10: Aba "Por pessoa"

**Files:**
- Modify: `professores-escala-smart.js` (`ESCALA_TABS`, `renderEscalaGestao`, funções novas, exports do `window`)

- [ ] **Step 1: Escrever o teste estrutural que falha**

Acrescentar em `scripts/smoke-escala-contagem.js`, no bloco assíncrono:

```js
  // ── aba Por pessoa (pedido 1 do Rodrigo) ────────────────────────────
  // "Deveria existir um filtro escolhendo qual professor/estagiário e mostrando
  // aonde e quando ele(a) está escalado."
  {
    const fs = require('fs');
    const path = require('path');
    const ui = fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8');
    assert.ok(/id: 'pessoa'/.test(ui), 'existe a aba pessoa');
    assert.ok(/function renderTabPorPessoa/.test(ui), 'existe a tela da aba');
    assert.ok(/window\.escalaSetPessoa\s*=/.test(ui), 'o seletor de pessoa está registrado');
    console.log('✓ aba Por pessoa existe e está ligada');
  }
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-escala-contagem.js`
Expected: FAIL — `existe a aba pessoa`

- [ ] **Step 3: Registrar a aba**

Em `ESCALA_TABS` (linha ~20), acrescentar como último item:

```js
  { id: 'pessoa',         label: 'Por pessoa' },
```

- [ ] **Step 4: Ligar no roteador de abas**

Em `renderEscalaGestao`, na cadeia de `if`, acrescentar **antes** do `else` final:

```js
  else if (tab === 'pessoa')           listHtml = renderTabPorPessoa();
```

E, na mesma função, esconder o painel de equilíbrio e o detalhe nessa aba — trocar `${renderEquilibrioPainel()}` por `${tab === 'pessoa' ? '' : renderEquilibrioPainel()}` e `<div>${detail || '<p style="padding:20px;color:var(--text2);">Selecione uma escala à esquerda.</p>'}</div>` por `<div>${tab === 'pessoa' ? '' : (detail || '<p style="padding:20px;color:var(--text2);">Selecione uma escala à esquerda.</p>')}</div>`.

Na mesma função, o grid de duas colunas fica ruim numa aba de coluna única: trocar
`<div style="display:grid;grid-template-columns:minmax(220px,1fr) 2fr;gap:16px;align-items:start;">`
por
`<div style="display:grid;grid-template-columns:${tab === 'pessoa' ? '1fr' : 'minmax(220px,1fr) 2fr'};gap:16px;align-items:start;">`.

- [ ] **Step 5: Escrever a tela**

Inserir, logo antes de `function renderTabFimDeAno(scales) {`:

```js
function escalaSetPessoa(pid) { EscalaSmartState.pessoaSel = pid || null; renderEscalaGestao(); }

/**
 * "Onde e quando fulano está escalado" — pedido 1 do Rodrigo (25/08/2026).
 *
 * Junta as três perguntas numa tela só: as datas da pessoa, quanto ela pegou
 * nesta janela e quanto pegou no ano (pedido 8: "quando for aberta a próxima
 * janela, trazer o histórico da quantidade das últimas escalas no ano").
 */
function renderTabPorPessoa() {
  const ativos = Array.from(EscalaSmartState.teacherMap.values())
    .filter(t => t.isActive !== false)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const sel = EscalaSmartState.pessoaSel;
  const seletor = `<select class="input" style="max-width:320px;" onchange="escalaSetPessoa(this.value)">
      <option value="">— escolha a pessoa —</option>
      ${ativos.map(t => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${escalaEsc(t.name)}</option>`).join('')}
    </select>`;

  if (!sel) {
    return `<div style="margin-bottom:12px;">${seletor}</div>
      ${escalaHistoricoAnoHtml()}`;
  }

  const ano = String(EscalaSmartState.year);
  const nomeUnidade = (uid) => {
    const u = EscalaSmartState.units.find(x => x.id === uid) || {};
    return (u.name || uid || '').replace(/CrossTainer\s*/i, '') || uid;
  };
  const nomeMod = (mid) => mid === (EscalaSmartState.modToi || {}).id ? 'TOI'
    : mid === (EscalaSmartState.modHiit || {}).id ? 'Hiit' : '—';
  const rotuloTipo = { sabado: 'Sábado', feriado: 'Feriado', domingo_especial: 'Domingo especial', evento: 'Evento', fim_de_ano: 'Fim de ano', escola_interna: 'Escola Interna' };

  const linhas = [];
  (EscalaSmartState.scales || [])
    .filter(s => String(s.date || '').slice(0, 4) === ano)
    .sort((a, b) => (a.date > b.date ? 1 : -1))
    .forEach(s => {
      (s.slots || []).forEach(sl => {
        if (sl.assignedPersonId !== sel) return;
        linhas.push(`<tr>
          <td style="padding:4px 8px;">${escalaFmtBR(s.date)}</td>
          <td style="padding:4px 8px;">${rotuloTipo[s.tipo] || s.tipo}</td>
          <td style="padding:4px 8px;">${escalaEsc(nomeUnidade(sl.unitId))}</td>
          <td style="padding:4px 8px;">${nomeMod(sl.requiredModalityId)}</td>
          <td style="padding:4px 8px;">${sl.startTime ? `${sl.startTime}–${sl.endTime || ''}` : '—'}</td>
          <td style="padding:4px 8px;color:${s.published ? 'var(--green)' : 'var(--text3)'};">${s.published ? '✓ publicada' : 'não publicada'}</td>
        </tr>`);
      });
    });

  const cSab = escalaContagens('sabado');
  const cFer = escalaContagens('feriado');
  const ajuste = (EscalaSmartState.ajusteMap || {})[sel] || 0;
  const cartao = (rot, jan, an) => `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;flex:1;min-width:150px;">
      <div style="font-size:11px;color:var(--text3);text-transform:uppercase;">${rot}</div>
      <div style="font-size:20px;font-weight:600;">${jan}</div>
      <div style="font-size:12px;color:var(--text2);">${an} no ano de ${ano}</div>
    </div>`;

  return `<div style="margin-bottom:12px;">${seletor}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
      ${cartao('Sábados nesta janela', cSab.janela[sel] || 0, cSab.ano[sel] || 0)}
      ${cartao('Feriados nesta janela', cFer.janela[sel] || 0, cFer.ano[sel] || 0)}
      ${ajuste ? `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;flex:1;min-width:150px;">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;">Lançado na mão</div>
        <div style="font-size:20px;font-weight:600;">${ajuste}</div>
        <div style="font-size:12px;color:var(--text2);">dias fora do sistema</div></div>` : ''}
    </div>
    ${linhas.length
      ? `<table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="color:var(--text2);text-align:left;">
            <th style="padding:4px 8px;font-weight:400;">Data</th>
            <th style="padding:4px 8px;font-weight:400;">Tipo</th>
            <th style="padding:4px 8px;font-weight:400;">Unidade</th>
            <th style="padding:4px 8px;font-weight:400;">Modalidade</th>
            <th style="padding:4px 8px;font-weight:400;">Horário</th>
            <th style="padding:4px 8px;font-weight:400;">Situação</th>
          </tr></thead><tbody>${linhas.join('')}</tbody></table>`
      : `<p style="padding:20px;color:var(--text2);">Nenhuma escala em ${ano} para esta pessoa.</p>`}
    ${escalaHistoricoAnoHtml()}`;
}

/**
 * Histórico do ano por pessoa — sábados e feriados separados.
 * Pedido 8 do Rodrigo: aparece aqui e também no modal de abrir janela, que é
 * quando a gestão precisa dele pra decidir.
 */
function escalaHistoricoAnoHtml() {
  const ano = String(EscalaSmartState.year);
  const cSab = escalaContagens('sabado');
  const cFer = escalaContagens('feriado');
  const ajustes = EscalaSmartState.ajusteMap || {};
  const ativos = Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false);
  const linhas = ativos
    .map(t => ({ t, sab: cSab.ano[t.id] || 0, fer: cFer.ano[t.id] || 0, aj: ajustes[t.id] || 0 }))
    .filter(x => x.sab || x.fer || x.aj)
    .sort((a, b) => (b.sab + b.fer) - (a.sab + a.fer))
    .map(x => `<tr>
      <td style="padding:3px 8px;">${escalaEsc(x.t.name)}</td>
      <td style="padding:3px 8px;text-align:center;">${x.sab}</td>
      <td style="padding:3px 8px;text-align:center;">${x.fer}</td>
      <td style="padding:3px 8px;text-align:center;color:var(--text3);">${x.aj || '—'}</td>
    </tr>`).join('');
  if (!linhas) return '';
  return `<details style="margin-top:16px;">
    <summary style="cursor:pointer;font-size:13px;color:var(--blue);">📊 Histórico de ${ano} — quantas vezes cada um</summary>
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;">
      <thead><tr style="color:var(--text2);text-align:left;">
        <th style="padding:3px 8px;font-weight:400;">Pessoa</th>
        <th style="padding:3px 8px;font-weight:400;text-align:center;">Sábados</th>
        <th style="padding:3px 8px;font-weight:400;text-align:center;">Feriados</th>
        <th style="padding:3px 8px;font-weight:400;text-align:center;">Lançado na mão</th>
      </tr></thead><tbody>${linhas}</tbody></table>
  </details>`;
}
```

- [ ] **Step 6: Mostrar o histórico ao abrir a janela**

Em `openAbrirJanelaModal`, dentro do `modal.innerHTML`, logo **depois** da linha do `<p style="font-size:12px;color:var(--text2);">Todos os professores ativos serão avisados...</p>`, acrescentar:

```js
    ${escalaHistoricoAnoHtml()}
```

- [ ] **Step 7: Exportar no `window`**

No fim do arquivo, junto dos outros, acrescentar:

```js
window.escalaSetPessoa = escalaSetPessoa;
window.renderTabPorPessoa = renderTabPorPessoa;
```

- [ ] **Step 8: Rodar e ver passar**

Run: `node scripts/smoke-escala-contagem.js && node -e "new Function(require('fs').readFileSync('professores-escala-smart.js','utf8'))" && echo SINTAXE_OK`
Expected: PASS + `SINTAXE_OK`

- [ ] **Step 9: Commit**

```bash
git add professores-escala-smart.js scripts/smoke-escala-contagem.js
git commit -m "feat(escala): aba Por pessoa e o historico do ano"
```

---

### Task 11: Refazer a janela

**Files:**
- Modify: `professores-escala-smart.js` (`gerarPreviaLote`, `renderEscalaGestao`, `confirmarEAvisar`, exports)

**Contexto:** ao remontar, as datas do lote que ainda carregam a escala **antiga** não podem entrar na conta. Sem isso, remontar a janela conta a escala velha e empurra as pessoas erradas — o problema que este plano existe pra resolver.

- [ ] **Step 1: Escrever o teste estrutural que falha**

Acrescentar em `scripts/smoke-escala-contagem.js`, no bloco assíncrono:

```js
  // ── refazer a janela ────────────────────────────────────────────────
  {
    const fs = require('fs');
    const path = require('path');
    const ui = fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8');
    const previa = ui.slice(ui.indexOf('async function gerarPreviaLote'), ui.indexOf('function renderPreviaLote'));
    assert.ok(/aRemontar/.test(previa), 'a prévia tira do bolo as datas que ainda vão ser remontadas');
    assert.ok(/excluirDatas/.test(previa), 'a prévia passa excluirDatas pro serviço');
    assert.ok(/window\.refazerJanela\s*=/.test(ui), 'o botão de refazer está registrado');
    assert.ok(/remontagem|foi refeita/.test(ui), 'o aviso de remontagem tem texto próprio');
    console.log('✓ refazer a janela existe e não conta a escala velha');
  }
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/smoke-escala-contagem.js`
Expected: FAIL — `a prévia tira do bolo as datas que ainda vão ser remontadas`

- [ ] **Step 3: Ensinar a prévia a ignorar a escala velha**

Em `gerarPreviaLote`, logo depois de `ctx.jaNoLoteById = {};`, acrescentar:

```js
  // As datas deste lote ficam FORA da conta até serem remontadas nesta rodada.
  // Enquanto carregam a escala antiga, contá-las empurraria as pessoas erradas
  // — é o que fazia remontar a prévia piorar a escala em vez de melhorar.
  const aRemontar = new Set(scales.map(s => s.date));
```

E, dentro do `for (const s of scales) {`, trocar:

```js
    ctx.scalesDoAno = montadas;
    const cons = await ScaleService.consolidate(s.id, ctx);
    if (!cons.success) { falhas.push(`${escalaFmtBR(s.date)}: ${cons.error}`); continue; }
    registrar(s, cons.data.assignments);
```

por:

```js
    ctx.scalesDoAno = montadas;
    ctx.excluirDatas = Array.from(aRemontar);
    const cons = await ScaleService.consolidate(s.id, ctx);
    if (!cons.success) { falhas.push(`${escalaFmtBR(s.date)}: ${cons.error}`); continue; }
    registrar(s, cons.data.assignments);
    aRemontar.delete(s.date);   // agora ela conta — já com a escala nova
```

- [ ] **Step 4: Escrever o botão**

Inserir, logo antes de `async function gerarPreviaLote(batchId) {`:

```js
/**
 * Refaz uma janela inteira que já foi montada (e possivelmente publicada).
 *
 * Existe por causa de setembro/outubro de 2026: a escala saiu de um contador
 * travado (a Karin marcava 1 e tinha 3 sábados), então as datas foram montadas
 * com a informação errada. Refazer é decisão da gestão — o time já foi avisado
 * das datas antigas e vai precisar ser avisado de novo.
 */
async function refazerJanela(batchId) {
  const doLote = (EscalaSmartState.scales || []).filter(s => s.windowBatchId === batchId);
  const publicadas = doLote.filter(s => s.published).length;
  const passadas = doLote.filter(s => s.date < escalaTodayISO()).length;
  if (passadas) {
    toast(`Esta janela tem ${passadas} data(s) que já aconteceram. Refazer republicaria aulas do passado — não dá.`, 'error', 9000);
    return;
  }
  const aviso = `Refazer a escala de ${doLote.length} data(s)?\n\n` +
    `O sistema monta tudo de novo, do zero, com a contagem correta. Você vê a prévia antes de publicar.\n\n` +
    (publicadas ? `⚠️ ${publicadas} data(s) já estão publicadas e o time já foi avisado. Ao publicar de novo, todos serão avisados de que a escala MUDOU.` : '');
  if (!confirm(aviso)) return;
  EscalaSmartState.remontando = batchId;
  await gerarPreviaLote(batchId);
}
```

- [ ] **Step 5: Mostrar a barra de refazer**

Em `renderEscalaGestao`, logo **depois** do bloco que define `revisaoBar`, acrescentar:

```js
  // Lotes já montados (nenhuma data em janela aberta) podem ser refeitos.
  const lotesMontados = [...new Set(scales
    .filter(s => s.windowBatchId && s.status === 'consolidada' && s.date >= escalaTodayISO())
    .map(s => s.windowBatchId))]
    .filter(b => !scales.some(s => s.windowBatchId === b && s.status === 'janela_aberta'));
  const refazerBar = (tab !== 'pessoa' && lotesMontados.length)
    ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:10px;">
        <span style="font-size:13px;color:var(--text2);">Já existe escala montada para uma janela futura.</span>
        <button class="btn-secondary" onclick="refazerJanela('${lotesMontados[0]}')">🔄 Refazer a janela</button>
      </div>` : '';
```

E, no `container.innerHTML`, trocar `${revisaoBar}` por `${revisaoBar}${refazerBar}`.

- [ ] **Step 6: Mudar o texto do aviso quando for remontagem**

Em `confirmarEAvisar`, trocar o bloco do aviso pessoal:

```js
    await NotifyService.send({
      recipients: [t.userId], type: 'scale_confirmed',
      title: linhas.length === 1 ? 'Você está escalado' : `Você está escalado em ${linhas.length} dias`,
      body: linhas.join(' · ') + '. Já está na sua agenda.',
      link: { type: 'escala-smart', id: batchId }, channels: ['inapp'],
    });
```

por:

```js
    const remontou = EscalaSmartState.remontando === batchId;
    await NotifyService.send({
      recipients: [t.userId], type: 'scale_confirmed',
      title: remontou
        ? 'A escala mudou — confira seus dias'
        : (linhas.length === 1 ? 'Você está escalado' : `Você está escalado em ${linhas.length} dias`),
      body: (remontou ? 'A escala foi refeita e o aviso anterior não vale mais. Seus dias agora são: ' : '')
        + linhas.join(' · ') + '. Já está na sua agenda.',
      link: { type: 'escala-smart', id: batchId }, channels: ['inapp'],
    });
```

E, no aviso de quem ficou de fora, trocar:

```js
        title: 'Escala definida',
        body: `A escala de ${datas} foi definida e você não entrou nesta janela. Na próxima você vem na frente.`,
```

por:

```js
        title: EscalaSmartState.remontando === batchId ? 'A escala mudou' : 'Escala definida',
        body: (EscalaSmartState.remontando === batchId
          ? `A escala de ${datas} foi refeita e você não entrou nesta janela — o aviso anterior não vale mais.`
          : `A escala de ${datas} foi definida e você não entrou nesta janela.`)
          + ' Na próxima você vem na frente.',
```

E, no fim de `confirmarEAvisar`, logo antes de `closeEscalaModal();`, acrescentar:

```js
  EscalaSmartState.remontando = null;
```

- [ ] **Step 7: Exportar no `window`**

Acrescentar no fim do arquivo:

```js
window.refazerJanela = refazerJanela;
```

- [ ] **Step 8: Rodar e ver passar**

Run: `node scripts/smoke-escala-contagem.js && node -e "new Function(require('fs').readFileSync('professores-escala-smart.js','utf8'))" && echo SINTAXE_OK`
Expected: PASS + `SINTAXE_OK`

- [ ] **Step 9: Commit**

```bash
git add professores-escala-smart.js scripts/smoke-escala-contagem.js
git commit -m "feat(escala): refazer a janela inteira, sem contar a escala velha"
```

---

### Task 12: Reescrever os smokes que falavam do contador antigo

**Files:**
- Modify: `scripts/smoke-scale-service.js`, `scripts/smoke-trocar-pessoa-escala.js`, `scripts/smoke-ajustes-escala-2508.js`

**Contexto:** os três afirmam sobre `getFairness`/`saveFairness`/`applyFairnessDelta`/`personsOnAdjacentSaturday`. Se ficarem como estão, ou quebram, ou (pior) passam a testar coisa que não existe mais.

- [ ] **Step 1: Ver o estrago**

Run: `node scripts/smoke-scale-service.js; node scripts/smoke-trocar-pessoa-escala.js; node scripts/smoke-ajustes-escala-2508.js`
Expected: os três falham com `TypeError: SS.saveFairness is not a function` ou assert de contador.

- [ ] **Step 2: `smoke-scale-service.js` — trocar o bloco de fairness**

Substituir:

```js
  let f = await SS.getFairness('ana', d);
```

…e as linhas seguintes que usam `saveFairness`/`applyFairnessDelta` (o bloco de ~5 linhas) por:

```js
  // O contador não é mais guardado: o documento só carrega o ajuste de partida.
  let f = await SS.getFairness('ana', d);
  assert.strictEqual(f.data.ajuste, 0, 'nasce sem ajuste');
  await SS.saveAjustePartida('ana', 3, d);
  f = await SS.getFairness('ana', d);
  assert.strictEqual(f.data.ajuste, 3, 'ajuste de partida gravado');
```

Substituir também o segundo trecho, logo depois do `assert` de `slot gravado com a pessoa`:

```js
  const fa = await SS.getFairness('zeca', d);
  assert.strictEqual(fa.data.diasTrabalhados, 1, 'fairness incrementado pela consolidação');

  // A1: reconsolidar NÃO pode inflar o fairness de novo (era +1 a cada clique → corrompia justiça)
  await SS.consolidate(c2.data.id, ctx, d);
  const fa2 = await SS.getFairness('zeca', d);
  assert.strictEqual(fa2.data.diasTrabalhados, 1, 'reconsolidar não incrementa fairness de novo');
```

por:

```js
  // Consolidar não escreve contador nenhum: quem conta é contarPorPessoa, e ela
  // lê a escala. O antigo cuidado de "reconsolidar não pode inflar o número"
  // deixa de existir junto com o número — remontar dá sempre a mesma resposta.
  const contagem = SS.contarPorPessoa((await SS.listScales(d)).data, { tipos: ['sabado'] });
  assert.strictEqual(contagem.zeca, 1, 'a contagem enxerga o zeca escalado');
  assert.strictEqual((await SS.getFairness('zeca', d)).data.ajuste, 0, 'consolidar não mexe no ajuste de partida');

  await SS.consolidate(c2.data.id, ctx, d);
  const contagem2 = SS.contarPorPessoa((await SS.listScales(d)).data, { tipos: ['sabado'] });
  assert.strictEqual(contagem2.zeca, 1, 'reconsolidar não infla a conta');
```

- [ ] **Step 3: `smoke-trocar-pessoa-escala.js` — contar em vez de ler o contador**

Substituir a linha 15:

```js
const dias = async (d, pid) => (await SS.getFairness(pid, d)).data.diasTrabalhados;
```

por:

```js
// O "contador" virou contagem: pergunta-se às escalas, não a um documento.
const dias = async (d, pid) => {
  const todas = (await SS.listScales(d)).data;
  return SS.contarPorPessoa(todas, { tipos: ['sabado'] })[pid] || 0;
};
```

Duas asserções mudam de valor porque o **comportamento** mudou — e mudou pra melhor. Na seção 1, remover a linha que exigia o aviso do campo que deixou de existir:

```js
  assert.ok(r.data.fairnessAjustada, 'avisa que mexeu no contador');
```

Na seção 3, substituir o bloco inteiro:

```js
  /* ── 3. Escala AINDA NÃO consolidada não mexe em contador ────────── */
  d = deps(makeFakeDb());
  sab = await novaEscala(d);
  const r3 = await SS.reassignSlot(sab.id, 's1', 'p1', d);
  assert.ok(r3.success && !r3.data.fairnessAjustada, 'sem consolidação, nada de contador');
  assert.strictEqual(await dias(d, 'p1'), 0, 'ninguém ganha dia numa escala que nunca foi contabilizada');
  console.log('✓ escala não consolidada não mexe na justiça');
```

por:

```js
  /* ── 3. Vaga preenchida CONTA, consolidada ou não ────────────────── */
  // Mudou de propósito em 26/08/2026. Antes, escalar alguém numa escala que
  // ainda não tinha sido consolidada não creditava nada — o crédito dependia de
  // um `fairnessApplied` que a tela nem sempre gravava, e era por aí que o
  // contador se descolava da realidade. Agora vale o óbvio: se a pessoa está na
  // vaga, ela trabalha naquele dia, e portanto conta.
  d = deps(makeFakeDb());
  sab = await novaEscala(d);
  const r3 = await SS.reassignSlot(sab.id, 's1', 'p1', d);
  assert.ok(r3.success && r3.data.changed, 'troca aceita mesmo sem consolidação');
  assert.strictEqual(await dias(d, 'p1'), 1, 'quem está na vaga conta, consolidada ou não');
  console.log('✓ vaga preenchida conta sem depender de consolidação');
```

Atualizar também o cabeçalho do arquivo, que descreve o risco antigo. Substituir as linhas 4–8 do comentário por:

```js
// A gestão discordar de UMA pessoa não pode custar refazer a escala inteira
// (Rafael, 12/08/2026). O risco da troca manual era silencioso: o contador de
// justiça era um número guardado, e se a troca não movesse o crédito, quem saiu
// ficava com um dia que não trabalhou. Desde 26/08/2026 não há crédito a mover —
// o número é CONTADO das escalas, então a troca entra na conta sozinha. Estes
// casos continuam valendo: são a prova de que a conta acompanha a vaga.
```

- [ ] **Step 4: `smoke-ajustes-escala-2508.js` — atualizar as seções 2 e 3**

Na seção 2 (inverter), substituir:

```js
    // Inverter não é escalar mais ninguém: o contador de justiça não se mexe.
    const fAna = (await SS.getFairness('ana', d)).data;
    assert.strictEqual(fAna.diasTrabalhados, 0, 'inverter não mexe no contador');
```

por:

```js
    // Inverter não é escalar mais ninguém: a conta do dia continua a mesma.
    const contagem = SS.contarPorPessoa((await SS.listScales(d)).data, { tipos: ['sabado'] });
    assert.strictEqual(contagem.ana, 1, 'ana segue com 1 dia depois de inverter');
    assert.strictEqual(contagem.bia, 1, 'bia segue com 1 dia depois de inverter');
```

E, no bloco estrutural logo abaixo, trocar:

```js
    assert.ok(/inverterVagasEscala\('\$\{scale\.id\}'/.test(ui), 'o botão ⇄ Inverter está desenhado');
```

por:

```js
    assert.ok(/Inverter com…/.test(ui), 'o seletor ⇄ Inverter com… está desenhado');
```

Na seção 3 (equilíbrio), trocar:

```js
    assert.ok(/ScaleService\.saveFairness\(/.test(ui),
      'a correção precisa gravar de verdade');
```

por:

```js
    assert.ok(/ScaleService\.saveAjustePartida\(/.test(ui),
      'a correção precisa gravar de verdade (agora como ajuste de partida)');
```

E, se houver referência a `personsOnAdjacentSaturday`, trocar por `personsOnNearbyScale`.

- [ ] **Step 5: Rodar a regressão inteira**

```bash
node scripts/smoke-escala-contagem.js && node scripts/smoke-scale-engine.js && node scripts/smoke-scale-service.js && node scripts/smoke-trocar-pessoa-escala.js && node scripts/smoke-ajustes-escala-2508.js && node scripts/smoke-escala-frente1.js && node scripts/smoke-escala-frente2.js && node scripts/smoke-escala-frente3.js && node scripts/smoke-escala-confirma-publica.js && node scripts/smoke-escala-ferias.js && node scripts/smoke-escala-tabs.js
```

Expected: todos com `✓`, nenhum `AssertionError`.

- [ ] **Step 6: Commit**

```bash
git add scripts/
git commit -m "test(escala): smokes acompanham o contador que virou contagem"
```

---

### Task 13: A ferramenta que confere o dado de produção

**Files:**
- Create: `scripts/diag-contador-escala.js`

**Contexto:** foi com esta leitura que o bug foi provado (9 de 16 errados). Ela precisa existir no repositório para conferir o antes e o depois do refazer — e para a próxima vez que alguém desconfiar do número.

- [ ] **Step 1: Criar o script (somente leitura)**

```js
'use strict';
// Roda: node scripts/diag-contador-escala.js --project production
//
// SOMENTE LEITURA. Compara, por pessoa, o que as escalas dizem com o ajuste de
// partida lançado na mão. Foi com esta leitura que o bug de 25/08/2026 foi
// provado: 9 das 16 pessoas com o contador errado, a Karin marcando 1 e tendo 3
// sábados. Depois do conserto, serve pra conferir o antes e o depois.
const admin = require('firebase-admin');
const path = require('path');
const SS = require('../scale-service.js');

const args = process.argv.slice(2);
const projeto = args.includes('--project') ? args[args.indexOf('--project') + 1] : null;
if (!projeto) { console.error('Faltou --project <staging|production>'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))) });
const db = admin.firestore();

(async () => {
  const [scalesSnap, ajusteSnap, teachSnap] = await Promise.all([
    db.collection('special_scales').get(),
    db.collection('fairness_counter').get(),
    db.collection('teachers').get(),
  ]);
  const nome = new Map(teachSnap.docs.map(d => [d.id, d.data().name || d.id]));
  const ajuste = {};
  ajusteSnap.docs.forEach(d => { const v = d.data() || {}; ajuste[v.personId || d.id] = Number(v.ajuste) || 0; });
  const scales = scalesSnap.docs.map(d => Object.assign({ id: d.id }, d.data()))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  console.log('=== ESCALAS DE SÁBADO E FERIADO ===');
  scales.filter(s => ['sabado', 'feriado', 'domingo_especial'].includes(s.tipo)).forEach(s => {
    const quem = (s.slots || []).filter(x => x.assignedPersonId)
      .map(x => nome.get(x.assignedPersonId) || x.assignedPersonId);
    console.log(`${s.date} ${String(s.tipo).padEnd(8)} status=${String(s.status).padEnd(13)} pub=${!!s.published} lote=${s.windowBatchId || '-'} => ${quem.join(', ') || '(vazio)'}`);
  });

  const sab = SS.contarPorPessoa(scales, { tipos: ['sabado'] });
  const fer = SS.contarPorPessoa(scales, { tipos: ['feriado', 'domingo_especial'] });

  console.log('\n=== POR PESSOA ===');
  const ids = new Set([].concat(Object.keys(sab), Object.keys(fer), Object.keys(ajuste)));
  Array.from(ids)
    .map(pid => ({ pid, n: nome.get(pid) || pid, s: sab[pid] || 0, f: fer[pid] || 0, a: ajuste[pid] || 0 }))
    .sort((a, b) => a.n.localeCompare(b.n))
    .forEach(l => console.log(`${l.n.padEnd(32)} sábados=${String(l.s).padStart(2)}  feriados=${String(l.f).padStart(2)}  lançado na mão=${l.a}`));

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Rodar contra produção (leitura pura, seguro)**

Run: `node scripts/diag-contador-escala.js --project production`
Expected: lista as escalas e, por pessoa, sábados e feriados **contados pela mesma função que o motor usa**.

- [ ] **Step 3: Commit**

```bash
git add scripts/diag-contador-escala.js
git commit -m "chore(escala): ferramenta que confere a contagem contra o banco"
```

---

### Task 14: Homologação no staging, com o app aberto

**Files:** nenhum — é execução.

> A homologação de 25/08 pegou um bug que 12 verificações automatizadas não pegaram (o estado de publicação lido da memória do navegador). Rodar o app não é opcional.

- [ ] **Step 1: Subir pro staging**

```bash
firebase deploy --only hosting --project staging
```

- [ ] **Step 2: Roteiro no navegador (staging), como gestão**

- [ ] Abrir Escala Inteligente → o painel diz "Equilíbrio da janela aberta" (ou "da última janela") e cada nome mostra `N nesta janela · M no ano`.
- [ ] Trocar para a aba **Feriados** → os números mudam e o painel diz "(feriados)".
- [ ] Abrir uma data → a tabela "por quê?" mostra a coluna **Feriados** na aba Feriados.
- [ ] Numa vaga, usar **⇄ Inverter com…** escolhendo uma vaga de **outra unidade** → as duas pessoas trocam; se alguma não for habilitada, aparece o aviso.
- [ ] **Refazer a janela** → confere a prévia → **duas vezes seguidas**, e o resultado tem que ser o mesmo nas duas.
- [ ] Aba **Por pessoa** → escolher alguém → as datas, os dois cartões e o histórico do ano batem com o que a lista mostra.
- [ ] ✏️ num nome → lançar 2 → o número do **ano** sobe 2, o da **janela** não muda.

- [ ] **Step 3: Roteiro como professor (staging)**

- [ ] Com a escala montada e **não publicada**: a tela do professor diz "A gestão está montando a escala" — e **não** "Você está escalado".
- [ ] Depois de publicar: aparece "✓ Você está escalado" e a aula está na agenda dele.

- [ ] **Step 4: Console limpo**

Abrir o console do navegador durante todo o roteiro. Expected: **0 erro**.

- [ ] **Step 5: Commit do que a homologação achar**

Se algo falhar, corrigir, rodar a regressão da Task 12 de novo e commitar antes de seguir.

---

### Task 15: Produção e o refazer de setembro/outubro

**Files:** nenhum — é execução. **Só depois do OK explícito do Rafael.**

- [ ] **Step 1: Publicar**

```bash
git push origin main
```

(É o GitHub Pages que serve os usuários — `firebase deploy --only hosting` **não** entrega.)

- [ ] **Step 2: Conferir no ar**

Abrir `https://rafaelmayerbrasil.github.io/crosstrainer-comissoes/professores.html`, confirmar que os arquivos vieram na versão nova e que o console está limpo.

- [ ] **Step 3: Conferir os contadores ANTES de refazer**

Rodar a leitura de produção (somente leitura) e guardar a saída:

```bash
node scripts/diag-contador-escala.js --project production > backups/contador-antes-2026-08-26.txt
```

(É o script da Task 13.)

- [ ] **Step 4: Refazer a janela pela tela**

- [ ] Escala Inteligente → **🔄 Refazer a janela** no lote dos sábados (`batch_1786921932940`, 9 datas de 05/09 a 31/10).
- [ ] Conferir a prévia: ninguém com 3 e alguém com 0; conferir o motivo de cada escolha.
- [ ] **Publicar na agenda e avisar** → o aviso tem que dizer que a escala **mudou**.
- [ ] Repetir para o lote dos feriados (`batch_1786921982328`, 07/09 e 12/10).
- [ ] Os feriados avulsos 02/11 e 20/11 (consolidados, não publicados) — reconsolidar cada um pelo botão que já existe e publicar.

- [ ] **Step 5: Conferir depois**

```bash
node scripts/diag-contador-escala.js --project production > backups/contador-depois-2026-08-26.txt
```

Expected: a contagem por pessoa bate com as escalas, e ninguém acumula 3 sábados enquanto alguém habilitado fica com 0.

- [ ] **Step 6: Fechar a sessão**

- [ ] Atualizar `CONTEXTO_SESSAO.md` (sessão nova no topo) e o "Estado atual em uma frase" do `CLAUDE.md`.
- [ ] Escrever a memória do que foi aprendido.
- [ ] Mandar pro Rodrigo o texto do que mudou, ponto a ponto com os 8 pedidos dele.

```bash
git add CONTEXTO_SESSAO.md CLAUDE.md
git commit -m "docs: sessao 57 — o contador da escala virou contagem"
git push origin main
```
