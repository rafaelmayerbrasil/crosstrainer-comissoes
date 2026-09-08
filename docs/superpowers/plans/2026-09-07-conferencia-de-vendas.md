# Conferência de vendas — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deixar a gestão registrar o desfecho de uma venda que ainda não virou dinheiro — já foi paga · ainda a receber · não vamos cobrar — e mostrar a data em que a venda que se resolveu sozinha foi paga.

**Architecture:** Toda a regra vai para o módulo puro `vendas-aguardando.js`: `cruzar` passa a devolver `pagoEm` e `pagamentoQueBateu`, e duas funções novas (`opiniao` e `aplicarConferencias`) resolvem a ordem de precedência. O `index.html` só lê a coleção nova `vendas_conferencia`, desenha os botões e grava. Nenhum cálculo de comissão muda.

**Tech Stack:** JS vanilla, sem framework. `vendas-aguardando.js` é módulo puro (roda em Node e no browser). Testes são smokes em Node com `assert`, rodados por `node scripts/smoke-*.js`. Firestore com Security Rules em `firestore.rules`.

**Spec:** `docs/superpowers/specs/2026-09-07-conferencia-de-vendas-design.md`

---

## Estrutura de arquivos

| arquivo | responsabilidade | ação |
|---|---|---|
| `vendas-aguardando.js` | módulo puro: cruzar, opinar e aplicar as conferências | modificar |
| `index.html` | ler a coleção, desenhar os botões, gravar | modificar |
| `firestore.rules` | ler para quem vê o painel; escrever só Admin | modificar |
| `scripts/smoke-conferencia-vendas.js` | prova a precedência, a opinião e a trava do botão | criar |
| `scripts/homologar-vendido-x-pago.js` | passa a conferir a precedência contra o banco real | modificar |

**Por que a regra vai no módulo puro:** a ordem de precedência é regra de negócio, e regra no `index.html` não tem teste. É a mesma razão pela qual a contagem do painel foi para lá.

**⚠️ O arquivo `index.html` é CRLF.** Editar por script sem normalizar quebra as âncoras. O padrão usado nesta base:

```js
let s = fs.readFileSync(p, 'utf8').split('\r\n').join('\n');
// ...edições...
fs.writeFileSync(p, s.split('\n').join('\r\n'));
```

---

### Task 1: `pagoEm` — de qual mês veio o pagamento, e em que dia

Hoje `cruzar` recebe `pagos` como lista achatada de códigos e perde de qual mês cada um veio. Passa a aceitar também objetos, e a marcar a venda paga com o mês e a data.

**Files:**
- Modify: `vendas-aguardando.js` (o método `cruzar`)
- Test: `scripts/smoke-conferencia-vendas.js`

- [x] **Step 1: Write the failing test**

Criar `scripts/smoke-conferencia-vendas.js` com este conteúdo inteiro:

```js
'use strict';
// Roda: node scripts/smoke-conferencia-vendas.js
//
// A conferência de vendas (spec 2026-09-07) deixa a gestão registrar o desfecho
// de uma venda que não virou dinheiro, e mostra quando a que se resolveu
// sozinha foi paga.
//
// ⚠️ A regra que mais importa está no caso 4: uma marcação humana NUNCA pode
// esconder dinheiro que entrou de verdade. Se ela puder, esta tela mente.

const assert = require('assert');
const path = require('path');
const VA = require(path.join(__dirname, '..', 'vendas-aguardando.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);

/** venda como `extrair` devolve, só com o que a conferência usa */
const venda = (contrato, cliente, extra) => ({
  contrato, cliente, vendedores: ['KALI DUTRA'], data: '05/08/2026',
  situacao: 'Renovação', valorContrato: 1000, inicio: '05/08/2026', ...extra,
});

// ════════════════════════════════════════════════════════════════════
// 1. `pagoEm` diz de qual mês veio o dinheiro, e em que dia
// ════════════════════════════════════════════════════════════════════
// A venda de agosto paga em setembro sumia calada. Agora ela aparece como
// paga, com a data — que é a pergunta do Rafael em 07/09.
{
  const vendas = [venda('C4566', 'JAIR'), venda('C4647', 'RAQUEL')];

  // lista achatada de códigos: como sempre funcionou, tem que continuar valendo
  const velho = VA.cruzar(vendas, ['C4566'], []);
  assert.strictEqual(velho.pagas.length, 1);
  assert.strictEqual(velho.pagas[0].pagoEm, null,
    'sem saber o mês, `pagoEm` é null — nunca um mês inventado');

  // com o mês e a data
  const novo = VA.cruzar(vendas, [
    { codigo: 'C4566', mes: '2026-09', data: '12/09/2026' },
  ], []);
  assert.strictEqual(novo.pagas.length, 1);
  assert.deepStrictEqual(novo.pagas[0].pagoEm, { mes: '2026-09', data: '12/09/2026' });
  assert.strictEqual(novo.aguardando.length, 1, 'a RAQUEL continua aguardando');

  // sem a data, o mês sozinho já serve
  const soMes = VA.cruzar(vendas, [{ codigo: 'C4566', mes: '2026-09' }], []);
  assert.deepStrictEqual(soMes.pagas[0].pagoEm, { mes: '2026-09', data: null });

  ok('`pagoEm` traz o mês e o dia do pagamento, e null quando não dá para saber');
}

console.log('\n' + n + '/' + n + ' casos passaram.');
```

- [x] **Step 2: Run test to verify it fails**

```bash
node scripts/smoke-conferencia-vendas.js
```

Esperado: `AssertionError: sem saber o mês, 'pagoEm' é null — nunca um mês inventado` (hoje `pagoEm` é `undefined`, não `null`).

- [x] **Step 3: Write minimal implementation**

Em `vendas-aguardando.js`, trocar o começo do método `cruzar`. O trecho de hoje:

```js
    cruzar(vendas, pagos, clientesPagantes) {
      const jaPagou = PA.contratosDe(pagos);
```

passa a ser:

```js
    cruzar(vendas, pagos, clientesPagantes) {
      // `pagos` aceita duas formas, de propósito:
      //   • lista de códigos           — como sempre funcionou
      //   • [{ codigo, mes, data }]    — quando quem chama sabe de QUAL mês
      //     veio cada código, e aí a venda paga carrega essa informação.
      // O painel achatava tudo numa lista só e jogava o mês fora; era por isso
      // que a venda de agosto paga em setembro sumia calada.
      const ondePagou = {};
      const codigos = (pagos || []).map(p => {
        if (p && typeof p === 'object') {
          const num = String(p.codigo).replace(/^C/i, '');
          ondePagou[num] = { mes: p.mes || null, data: p.data || null };
          return p.codigo;
        }
        return p;
      });
      const jaPagou = PA.contratosDe(codigos);
```

E, dentro do laço, trocar a linha que empurra a venda paga. Hoje:

```js
        if (jaPagou.has(num)) { pagas.push(vl); return; }
```

passa a ser:

```js
        if (jaPagou.has(num)) { pagas.push({ ...vl, pagoEm: ondePagou[num] || null }); return; }
```

- [x] **Step 4: Run test to verify it passes**

```bash
node scripts/smoke-conferencia-vendas.js
```

Esperado: `1/1 casos passaram.`

Depois, a suíte inteira — este método é usado por outras telas:

```bash
for f in scripts/smoke-*.js; do case "$f" in *smoke-9.js) continue;; esac; node "$f" >/dev/null 2>&1 || echo "FALHOU: $f"; done; echo fim
```

Esperado: só `fim`.

- [x] **Step 5: Commit**

```bash
git add vendas-aguardando.js scripts/smoke-conferencia-vendas.js
git commit -m "feat(comissoes): cruzar diz de qual mes veio o pagamento"
```

---

### Task 2: `pagamentoQueBateu` — a prova do lado da pergunta

Hoje a tela diz *"confira na Pacto"*. O sistema já sabe qual pagamento fez o nome bater; falta carregar essa informação até a tela.

**Files:**
- Modify: `vendas-aguardando.js` (o método `cruzar`)
- Test: `scripts/smoke-conferencia-vendas.js`

- [x] **Step 1: Write the failing test**

Acrescentar em `scripts/smoke-conferencia-vendas.js`, antes da linha `console.log(...)` final:

```js
// ════════════════════════════════════════════════════════════════════
// 2. A venda "a conferir" carrega o pagamento que fez o nome bater
// ════════════════════════════════════════════════════════════════════
// Sem isso a gestão tem que ir na Pacto procurar. Com isso, a conferência
// vira um olhar de cinco segundos.
{
  const vendas = [venda('C7130', 'CÁTIA TEREZINHA PEREIRA TORRES', { valorContrato: 2388 })];

  // lista de nomes: como sempre funcionou
  const soNome = VA.cruzar(vendas, [], ['CÁTIA TEREZINHA PEREIRA TORRES']);
  assert.strictEqual(soNome.conferir.length, 1);
  assert.strictEqual(soNome.conferir[0].pagamentoQueBateu, null,
    'sem o lançamento, não há prova para mostrar — null, nunca inventado');

  // com o lançamento inteiro
  const comItem = VA.cruzar(vendas, [], [
    { cliente: 'CÁTIA TEREZINHA PEREIRA TORRES', codigo: 'C6867', valor: 199, data: '12/08/2026' },
  ]);
  assert.strictEqual(comItem.conferir.length, 1);
  assert.deepStrictEqual(comItem.conferir[0].pagamentoQueBateu,
    { cliente: 'CÁTIA TEREZINHA PEREIRA TORRES', codigo: 'C6867', valor: 199, data: '12/08/2026' });

  // o nome sujo continua casando com o limpo, dos dois lados
  const sujo = VA.cruzar(
    [venda('C4588', 'MARIANA MINGHELLI BECKER  VISÃO GERAL CADASTRO VE')],
    [], [{ cliente: 'MARIANA MINGHELLI BECKER', codigo: 'C4000', valor: 50, data: '01/08/2026' }]);
  assert.strictEqual(sujo.conferir.length, 1, 'o limpador de nome continua valendo');
  assert.strictEqual(sujo.conferir[0].pagamentoQueBateu.codigo, 'C4000');

  ok('a venda a conferir carrega o pagamento que fez o nome bater');
}
```

- [x] **Step 2: Run test to verify it fails**

```bash
node scripts/smoke-conferencia-vendas.js
```

Esperado: `AssertionError: sem o lançamento, não há prova para mostrar — null, nunca inventado`

- [x] **Step 3: Write minimal implementation**

Em `vendas-aguardando.js`, dentro de `cruzar`, trocar a construção do `pagante`. Hoje:

```js
      // Os dois lados passam pelo mesmo limpador: o nome pode vir sujo do lado
      // da venda, do lado do recebimento, ou dos dois.
      const limpo = n => norm(this.limparNome(n));
      const pagante = new Set((clientesPagantes || []).map(limpo));
```

passa a ser:

```js
      // Os dois lados passam pelo mesmo limpador: o nome pode vir sujo do lado
      // da venda, do lado do recebimento, ou dos dois.
      const limpo = n => norm(this.limparNome(n));

      // `clientesPagantes` aceita duas formas, de propósito:
      //   • lista de nomes                            — como sempre funcionou
      //   • [{ cliente, codigo, valor, data }]        — o lançamento inteiro,
      //     que a tela mostra como PROVA ao lado da pergunta, em vez de mandar
      //     a gestão procurar na Pacto.
      const pagante = new Map();
      (clientesPagantes || []).forEach(c => {
        const nome = (c && typeof c === 'object') ? c.cliente : c;
        const chave = limpo(nome);
        if (!pagante.has(chave)) pagante.set(chave, (c && typeof c === 'object') ? c : null);
      });
```

E trocar o ramo do "conferir". Hoje:

```js
        if (pagante.has(norm(nome))) {
          conferir.push({ ...vl, motivoConferir: 'o cliente pagou no mês, mas em outro contrato — provável renovação que trocou de número' });
          return;
        }
```

passa a ser:

```js
        if (pagante.has(norm(nome))) {
          conferir.push({
            ...vl,
            motivoConferir: 'o cliente pagou no mês, mas em outro contrato — provável renovação que trocou de número',
            pagamentoQueBateu: pagante.get(norm(nome)) || null,
          });
          return;
        }
```

- [x] **Step 4: Run test to verify it passes**

```bash
node scripts/smoke-conferencia-vendas.js
```

Esperado: `2/2 casos passaram.`

E a suíte inteira:

```bash
for f in scripts/smoke-*.js; do case "$f" in *smoke-9.js) continue;; esac; node "$f" >/dev/null 2>&1 || echo "FALHOU: $f"; done; echo fim
```

Esperado: só `fim`.

- [x] **Step 5: Commit**

```bash
git add vendas-aguardando.js scripts/smoke-conferencia-vendas.js
git commit -m "feat(comissoes): a venda a conferir carrega o pagamento que bateu"
```

---

### Task 3: A opinião do sistema

Três opiniões, e nada além. A opinião **nunca decide** — ela só encurta o olhar.

**Files:**
- Modify: `vendas-aguardando.js` (método novo, depois de `ehTeste`)
- Test: `scripts/smoke-conferencia-vendas.js`

- [x] **Step 1: Write the failing test**

Acrescentar em `scripts/smoke-conferencia-vendas.js`, antes da linha final:

```js
// ════════════════════════════════════════════════════════════════════
// 3. A opinião do sistema, com os dois casos reais de produção
// ════════════════════════════════════════════════════════════════════
// A Amandha e a Cátia foram medidas na produção em 07/09/2026: as duas
// pagaram ANTES de a venda existir, R$ 239 e R$ 199 contra contratos anuais
// de R$ 2.388. Foi por isso que o sistema NÃO decide sozinho — se decidisse,
// a gestão pararia de acompanhar R$ 4.776.
{
  const catia = venda('C7130', 'CÁTIA TEREZINHA PEREIRA TORRES',
    { valorContrato: 2388, data: '27/08/2026', inicio: '02/09/2026' });

  const antes = VA.opiniao(catia, { codigo: 'C6867', valor: 199, data: '12/08/2026' });
  assert.strictEqual(antes.suspeita, 'provavelmente_nao_paga');
  assert.ok(/antes/i.test(antes.porque), 'o motivo tem que dizer que o pagamento é anterior: ' + antes.porque);

  const amandha = venda('C7070', 'AMANDHA MARCELA PEREIRA GERN TORRES',
    { valorContrato: 2388, data: '06/08/2026', inicio: '02/09/2026' });
  assert.strictEqual(VA.opiniao(amandha, { codigo: 'C5044', valor: 239, data: '04/08/2026' }).suspeita,
    'provavelmente_nao_paga');

  // valor bate com o contrato: aí sim é provável que seja esta venda
  const bate = VA.opiniao(venda('C7130', 'X', { valorContrato: 2388, data: '01/08/2026' }),
    { codigo: 'C6867', valor: 2388, data: '15/08/2026' });
  assert.strictEqual(bate.suspeita, 'provavelmente_paga');
  assert.ok(/valor/i.test(bate.porque), bate.porque);

  // ⚠️ Pagamento anterior GANHA do valor que bate: um pagamento feito antes de
  // a venda existir não pode ser dela, por mais que o número coincida.
  const conflito = VA.opiniao(venda('C7130', 'X', { valorContrato: 2388, data: '27/08/2026' }),
    { codigo: 'C6867', valor: 2388, data: '12/08/2026' });
  assert.strictEqual(conflito.suspeita, 'provavelmente_nao_paga');

  // nenhum sinal: a opinião admite que não sabe
  const nada = VA.opiniao(venda('C7130', 'X', { valorContrato: 2388, data: '01/08/2026' }),
    { codigo: 'C6867', valor: 700, data: '15/08/2026' });
  assert.strictEqual(nada.suspeita, 'nao_da_para_dizer');

  // sem pagamento nenhum não há o que opinar
  assert.strictEqual(VA.opiniao(catia, null).suspeita, 'nao_da_para_dizer');

  // data quebrada não pode explodir nem virar palpite
  assert.strictEqual(VA.opiniao(venda('C1', 'X', { data: '' }),
    { codigo: 'C2', valor: 10, data: 'xx' }).suspeita, 'nao_da_para_dizer');

  ok('a opinião cobre os dois casos reais e admite quando não sabe');
}
```

- [x] **Step 2: Run test to verify it fails**

```bash
node scripts/smoke-conferencia-vendas.js
```

Esperado: `TypeError: VA.opiniao is not a function`

- [x] **Step 3: Write minimal implementation**

Em `vendas-aguardando.js`, acrescentar o método logo **depois** de `ehTeste` (antes do bloco de comentário que abre `cruzar`):

```js
    /**
     * O que o sistema ACHA sobre uma venda "a conferir" — e por quê.
     *
     * ⚠️ Opinião NUNCA decide. Foi a pergunta do Rafael em 07/09/2026 ("o
     * sistema não pode marcar sozinho?") e a resposta veio dos dois casos
     * reais de produção: a Amandha e a Cátia pagaram R$ 239 e R$ 199 ANTES de
     * a venda existir, contra renovações anuais de R$ 2.388 que só começavam
     * em setembro. Marcar "pago" sozinho faria a gestão parar de acompanhar
     * R$ 4.776.
     *
     * @param {Object} venda      item de `cruzar().conferir`
     * @param {Object} pagamento  `pagamentoQueBateu`, ou null
     * @returns {{suspeita: string, porque: string}}
     */
    opiniao(venda, pagamento) {
      const naoSei = { suspeita: 'nao_da_para_dizer',
        porque: 'Não dá para dizer pelo arquivo — vale conferir na Pacto.' };
      if (!venda || !pagamento) return naoSei;

      // dd/mm/aaaa → aaaammdd, para comparar como texto sem fuso nenhum
      const ord = d => {
        const m = String(d || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        return m ? m[3] + m[2] + m[1] : null;
      };
      const pago = ord(pagamento.data), fechada = ord(venda.data);

      // Pagamento anterior à venda ganha de tudo: dinheiro que entrou antes de
      // a venda existir não pode ser dela, por mais que o valor coincida.
      if (pago && fechada && pago < fechada) {
        return {
          suspeita: 'provavelmente_nao_paga',
          porque: 'O pagamento que bateu o nome foi de R$ ' + Number(pagamento.valor || 0).toFixed(2)
            + ' em ' + pagamento.data + ' — antes desta venda existir, fechada em ' + venda.data
            + '. Provavelmente é do plano anterior, e esta venda ainda não foi paga.',
        };
      }

      const valor = Number(pagamento.valor || 0);
      const contrato = Number(venda.valorContrato || 0);
      if (valor > 0 && contrato > 0 && Math.abs(valor - contrato) < 0.01) {
        return {
          suspeita: 'provavelmente_paga',
          porque: 'O valor pago (R$ ' + valor.toFixed(2) + ', no contrato ' + pagamento.codigo
            + ') bate com o valor deste contrato. Provavelmente é esta venda, com outro número.',
        };
      }

      return naoSei;
    },
```

- [x] **Step 4: Run test to verify it passes**

```bash
node scripts/smoke-conferencia-vendas.js
```

Esperado: `3/3 casos passaram.`

- [x] **Step 5: Commit**

```bash
git add vendas-aguardando.js scripts/smoke-conferencia-vendas.js
git commit -m "feat(comissoes): o sistema opina sobre a venda a conferir"
```

---

### Task 4: A ordem de quem manda

O coração do desenho. Sem ordem explícita a tela se contradiz.

**Files:**
- Modify: `vendas-aguardando.js` (método novo, depois de `opiniao`)
- Test: `scripts/smoke-conferencia-vendas.js`

- [x] **Step 1: Write the failing test**

Acrescentar em `scripts/smoke-conferencia-vendas.js`, antes da linha final:

```js
// ════════════════════════════════════════════════════════════════════
// 4. A ordem de quem manda — e o dinheiro sempre ganha
// ════════════════════════════════════════════════════════════════════
// ⚠️ ESTE É O CASO QUE MAIS IMPORTA. Se uma marcação humana puder esconder
// dinheiro que entrou de verdade, esta tela mente.
{
  const cruzado = {
    pagas:      [venda('C1', 'ANA')],
    aguardando: [venda('C2', 'BIA'), venda('C3', 'CLARA')],
    conferir:   [venda('C4', 'DORA')],
    testes:     [],
    porVendedora: {},
  };

  // (a) sem marcação nenhuma, nada muda
  const zero = VA.aplicarConferencias(cruzado, {});
  assert.strictEqual(zero.pagas.length, 1);
  assert.strictEqual(zero.aguardando.length, 2);
  assert.strictEqual(zero.conferir.length, 1);
  assert.strictEqual(zero.naoCobrar.length, 0);

  // (b) "já foi paga" vira paga; "não vamos cobrar" sai dos três
  const marcado = VA.aplicarConferencias(cruzado, {
    C4: { desfecho: 'paga_outro_contrato', por: 'Rafael', em: '07/09/2026' },
    C2: { desfecho: 'nao_cobrar', por: 'Rafael', em: '07/09/2026', observacao: 'cliente desistiu' },
    C3: { desfecho: 'a_receber', por: 'Rafael', em: '07/09/2026' },
  });
  assert.deepStrictEqual(marcado.pagas.map(v => v.contrato), ['C1', 'C4']);
  assert.deepStrictEqual(marcado.aguardando.map(v => v.contrato), ['C3']);
  assert.strictEqual(marcado.conferir.length, 0);
  assert.deepStrictEqual(marcado.naoCobrar.map(v => v.contrato), ['C2']);

  // a venda marcada carrega o registro, para a tela poder mostrar quem e quando
  assert.strictEqual(marcado.aguardando[0].conferencia.por, 'Rafael');
  assert.strictEqual(marcado.naoCobrar[0].conferencia.observacao, 'cliente desistiu');

  // (c) 🚨 O DINHEIRO SEMPRE GANHA: marcada "não vamos cobrar", mas o contrato
  //     apareceu nos recebimentos → volta a contar como paga, e a tela DIZ que
  //     estava marcada de outro jeito.
  const comDinheiro = VA.aplicarConferencias({
    ...cruzado,
    pagas: [venda('C1', 'ANA'), venda('C2', 'BIA')],   // a C2 foi paga de verdade
    aguardando: [venda('C3', 'CLARA')],
  }, { C2: { desfecho: 'nao_cobrar', por: 'Rafael', em: '07/09/2026' } });

  assert.deepStrictEqual(comDinheiro.pagas.map(v => v.contrato), ['C1', 'C2'],
    'pagamento de verdade GANHA da marcação humana');
  assert.strictEqual(comDinheiro.naoCobrar.length, 0);
  const c2 = comDinheiro.pagas.find(v => v.contrato === 'C2');
  assert.strictEqual(c2.marcacaoIgnorada.desfecho, 'nao_cobrar',
    'a tela precisa DIZER que havia uma marcação em contrário');

  // (d) a soma sempre fecha
  const soma = marcado.pagas.length + marcado.aguardando.length
             + marcado.conferir.length + marcado.naoCobrar.length;
  assert.strictEqual(soma, 4, 'vendidas = pagas + aguardando + conferir + naoCobrar');

  // (e) marcação de contrato que não existe no mês é ignorada, sem quebrar
  const fantasma = VA.aplicarConferencias(cruzado, { C999: { desfecho: 'nao_cobrar' } });
  assert.strictEqual(fantasma.naoCobrar.length, 0);

  // (f) desfecho desconhecido não move a venda de lugar
  const estranho = VA.aplicarConferencias(cruzado, { C2: { desfecho: 'sei_la' } });
  assert.deepStrictEqual(estranho.aguardando.map(v => v.contrato), ['C2', 'C3']);

  ok('a ordem de quem manda; e o dinheiro sempre ganha da marcação');
}

// ════════════════════════════════════════════════════════════════════
// 5. O resumo conta o "não vamos cobrar" à parte, sem tirar de "vendidas"
// ════════════════════════════════════════════════════════════════════
// A venda dada por perdida foi vendida de verdade: sai das que ainda esperam
// dinheiro, não da história do mês.
{
  const r = VA.resumo({
    pagas: [1, 2, 3], aguardando: [4], conferir: [5], naoCobrar: [6, 7],
  });
  assert.deepStrictEqual(r, { vendidas: 7, pagas: 3, aguardando: 1, conferir: 1, naoCobrar: 2 });

  // sem o grupo novo, continua valendo como antes
  const velho = VA.resumo({ pagas: [1], aguardando: [2], conferir: [] });
  assert.deepStrictEqual(velho, { vendidas: 2, pagas: 1, aguardando: 1, conferir: 0, naoCobrar: 0 });

  ok('o resumo conta o "não vamos cobrar" à parte, sem tirar de vendidas');
}
```

- [x] **Step 2: Run test to verify it fails**

```bash
node scripts/smoke-conferencia-vendas.js
```

Esperado: `TypeError: VA.aplicarConferencias is not a function`

- [x] **Step 3: Write minimal implementation**

**(a)** Em `vendas-aguardando.js`, acrescentar o método logo **depois** de `opiniao`:

```js
    /**
     * Aplica as marcações da gestão sobre os três grupos de `cruzar`.
     *
     * A ordem de quem manda, e ela é o coração desta tela:
     *   1. o contrato apareceu nos recebimentos  → PAGA. Ganha de tudo.
     *   2. senão, vale a marcação da gestão
     *   3. senão, o automático de `cruzar`
     *
     * 🚨 O DINHEIRO SEMPRE GANHA. Se alguém marcou "não vamos cobrar" e o
     * cliente pagou depois, a venda volta a contar como paga e leva
     * `marcacaoIgnorada` para a tela poder DIZER que havia marcação em
     * contrário. Uma marcação humana nunca pode esconder dinheiro que entrou:
     * é o que impede esta tela de mentir.
     *
     * @param {Object} cruzado        saída de `cruzar`
     * @param {Object} conferencias   contrato → { desfecho, observacao, por, em }
     * @returns {{pagas, aguardando, conferir, naoCobrar, testes, porVendedora}}
     */
    aplicarConferencias(cruzado, conferencias) {
      const c = cruzado || {};
      const marcas = conferencias || {};
      const de = v => marcas[v.contrato] || marcas[String(v.contrato).replace(/^C/i, '')] || null;

      // (1) quem já está em `pagas` veio dos recebimentos: nada mexe nisso.
      const pagas = (c.pagas || []).map(v => {
        const m = de(v);
        return (m && m.desfecho !== 'paga_outro_contrato') ? { ...v, marcacaoIgnorada: m } : v;
      });
      const aguardando = [], conferir = [], naoCobrar = [];

      // (2) e (3) para o resto
      [].concat(c.aguardando || [], c.conferir || []).forEach(v => {
        const m = de(v);
        const eraConferir = (c.conferir || []).indexOf(v) >= 0;
        if (!m) { (eraConferir ? conferir : aguardando).push(v); return; }
        const vm = { ...v, conferencia: m };
        if (m.desfecho === 'paga_outro_contrato') pagas.push(vm);
        else if (m.desfecho === 'nao_cobrar') naoCobrar.push(vm);
        else if (m.desfecho === 'a_receber') aguardando.push(vm);
        else (eraConferir ? conferir : aguardando).push(v);   // desfecho desconhecido: não move
      });

      return { ...c, pagas, aguardando, conferir, naoCobrar };
    },
```

**(b)** No mesmo arquivo, trocar o método `resumo` inteiro. Hoje:

```js
    resumo(cruzado) {
      const c = cruzado || {};
      const pagas = (c.pagas || []).length;
      const aguardando = (c.aguardando || []).length;
      const conferir = (c.conferir || []).length;
      return { vendidas: pagas + aguardando + conferir, pagas, aguardando, conferir };
    },
```

passa a ser:

```js
    resumo(cruzado) {
      const c = cruzado || {};
      const pagas = (c.pagas || []).length;
      const aguardando = (c.aguardando || []).length;
      const conferir = (c.conferir || []).length;
      // A venda dada por perdida foi vendida de verdade: sai das que ainda
      // esperam dinheiro, não da história do mês. Por isso ela continua em
      // `vendidas` e aparece como nota, fora dos três números.
      const naoCobrar = (c.naoCobrar || []).length;
      return { vendidas: pagas + aguardando + conferir + naoCobrar,
               pagas, aguardando, conferir, naoCobrar };
    },
```

- [x] **Step 4: Run test to verify it passes**

```bash
node scripts/smoke-conferencia-vendas.js
```

Esperado: `5/5 casos passaram.`

E a suíte inteira — `resumo` mudou de forma e é usada pelo painel:

```bash
for f in scripts/smoke-*.js; do case "$f" in *smoke-9.js) continue;; esac; node "$f" >/dev/null 2>&1 || echo "FALHOU: $f"; done; echo fim
```

Esperado: só `fim`. Se `smoke-vendido-x-pago.js` falhar num `deepStrictEqual` de `resumo`, é porque ele compara o objeto inteiro e agora existe `naoCobrar: 0` — acrescentar `naoCobrar: 0` nas comparações daquele arquivo, sem afrouxar para comparação parcial.

- [x] **Step 5: Commit**

```bash
git add vendas-aguardando.js scripts/smoke-conferencia-vendas.js scripts/smoke-vendido-x-pago.js
git commit -m "feat(comissoes): a ordem de quem manda na conferencia de vendas"
```

---

### Task 5: A regra do banco — ler quem vê o painel, escrever só Admin

**⚠️ Escrever a regra ANTES da tela.** Esconder o botão não basta: link direto existe, e foi assim que o vazamento de salário do fechamento aconteceu.

**Files:**
- Modify: `firestore.rules`
- Test: `scripts/smoke-conferencia-vendas.js`

- [x] **Step 1: Write the failing test**

Acrescentar em `scripts/smoke-conferencia-vendas.js`, antes da linha final:

```js
// ════════════════════════════════════════════════════════════════════
// 6. A regra do banco existe, e o write é só de Admin
// ════════════════════════════════════════════════════════════════════
// Esconder o botão não basta: link direto existe. Foi assim que o vazamento
// de salário do fechamento aconteceu.
{
  const fs = require('fs');
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  const i = rules.indexOf('match /vendas_conferencia/');
  assert.ok(i > 0, 'falta a regra de vendas_conferencia');
  const bloco = rules.slice(i, rules.indexOf('}', rules.indexOf('allow write', i)) + 1);

  assert.ok(/allow read:/.test(bloco), 'precisa liberar leitura para quem vê o painel');
  assert.ok(/allow write:[^;]*isAdmin\(\)/.test(bloco),
    'o write tem que exigir isAdmin() na REGRA, não só na tela: ' + bloco);
  assert.ok(!/allow read, write/.test(bloco),
    'read e write não podem sair na mesma linha — o write é mais restrito');

  ok('a regra existe e o write exige Admin no servidor');
}
```

- [x] **Step 2: Run test to verify it fails**

```bash
node scripts/smoke-conferencia-vendas.js
```

Esperado: `AssertionError: falta a regra de vendas_conferencia`

- [x] **Step 3: Write minimal implementation**

Em `firestore.rules`, acrescentar o bloco logo **depois** do bloco `match /periodos/{id} { ... }` (que termina na linha com `}` fechando o `match /historico`):

```
    // Conferência de vendas — o desfecho que a gestão registra sobre uma venda
    // que ainda não virou dinheiro (spec 2026-09-07).
    //
    // Mora FORA do documento do período de propósito: re-subir o arquivo da
    // Pacto reescreve o período, e a decisão sumiria em silêncio.
    //
    // ⚠️ read e write são DIFERENTES. A vendedora precisa ver o desfecho das
    // vendas dela; só Admin registra. Esconder o botão não basta — link direto
    // existe, e foi assim que o vazamento de salário do fechamento aconteceu.
    match /vendas_conferencia/{id} {
      allow read:  if isAuth() && hasProfile() && hasComModule();
      allow write: if isAuth() && hasProfile() && isAdmin();
    }
```

- [x] **Step 4: Run test to verify it passes**

```bash
node scripts/smoke-conferencia-vendas.js
```

Esperado: `6/6 casos passaram.`

E o validador de regras de Comissões, que existe justamente porque um deploy já deixou coleções sem regra:

```bash
node scripts/validate-rules-comissoes.js
```

Esperado: sem erro.

- [x] **Step 5: Commit**

```bash
git add firestore.rules scripts/smoke-conferencia-vendas.js
git commit -m "feat(comissoes): rule da conferencia de vendas, write so admin"
```

---

### Task 6: O carregador lê as conferências e o mês de cada pagamento

**Files:**
- Modify: `index.html` — `carregarVendidoXPago` e `carregarArrastoAnterior`
- Test: `scripts/smoke-conferencia-vendas.js`

- [x] **Step 1: Write the failing test**

Acrescentar em `scripts/smoke-conferencia-vendas.js`, antes da linha final:

```js
// ════════════════════════════════════════════════════════════════════
// 7. O carregador para de achatar o mês, e lê as conferências
// ════════════════════════════════════════════════════════════════════
{
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const i = html.indexOf('async function carregarVendidoXPago(');
  assert.ok(i > 0, 'falta carregarVendidoXPago');
  const carregador = html.slice(i, html.indexOf('\n    }\n', i));

  assert.ok(/vendas_conferencia/.test(carregador),
    'o carregador tem que ler as conferências');
  assert.ok(/aplicarConferencias\(/.test(carregador),
    'e aplicá-las antes de resumir');
  // Casa com `{ codigo: c, mes, data }` — o `mes` entra abreviado, então
  // procurar por "mes:" daria falso negativo.
  assert.ok(/pagos.push({[^}]*mes/.test(carregador),
    'os códigos pagos têm que carregar de qual mês vieram');
  assert.ok(/codigo:/.test(carregador),
    'e o lançamento inteiro tem que ir como prova');

  // a conta só pode ser feita DEPOIS de aplicar as marcações, senão o resumo
  // e a tabela contam a venda no grupo errado
  assert.ok(carregador.indexOf('aplicarConferencias(') < carregador.indexOf('VendasAguardando.resumo('),
    'aplicar as conferências vem ANTES de resumir');

  ok('o carregador lê as conferências e guarda de qual mês veio cada pagamento');
}
```

- [x] **Step 2: Run test to verify it fails**

```bash
node scripts/smoke-conferencia-vendas.js
```

Esperado: `AssertionError: o carregador tem que ler as conferências`

- [x] **Step 3: Write minimal implementation**

Em `index.html`, dentro de `carregarVendidoXPago`, trocar o trecho que monta `pagos`. Hoje:

```js
      // Um contrato deixa de aguardar quando aparece na memória de QUALQUER mês
      // desta unidade: venda de agosto paga em setembro já entrou.
      const snap = await db.collection('periodos').where('unitId', '==', unitId).get();
      const pagos = [];
      snap.forEach(d => (d.data().codigosPagos || []).forEach(c => pagos.push(c)));
```

passa a ser:

```js
      // Um contrato deixa de aguardar quando aparece na memória de QUALQUER mês
      // desta unidade: venda de agosto paga em setembro já entrou.
      //
      // Guardamos de QUAL mês veio cada código: achatar tudo numa lista só era
      // o que fazia a venda paga depois sumir calada, sem dizer quando.
      const snap = await db.collection('periodos').where('unitId', '==', unitId).get();
      const pagos = [];
      const mesesQuePagaram = new Set();
      snap.forEach(d => {
        const m = String(d.id).match(/(\d{4}-\d{2})$/);
        const mes = m ? m[1] : null;
        (d.data().codigosPagos || []).forEach(c => {
          pagos.push({ codigo: c, mes, data: null });
          if (mes) mesesQuePagaram.add(mes);
        });
      });

      // A data exata sai do lançamento, no mês que pagou. São poucas leituras:
      // uma por mês da unidade que tenha recebimento.
      for (const mes of mesesQuePagaram) {
        const itens = await db.collection('periodos').doc(unitId + '_' + mes).collection('itens').get();
        const porCodigo = {};
        itens.forEach(d => {
          const it = d.data();
          if ((it.type || 'processed') !== 'processed') return;
          if (it.data) porCodigo[String(it.codigo || '').replace(/-\d+$/, '')] = it.data;
        });
        pagos.forEach(p => { if (p.mes === mes && porCodigo[p.codigo]) p.data = porCodigo[p.codigo]; });
      }
```

Ainda em `carregarVendidoXPago`, trocar a montagem de `clientesPagantes`. Hoje:

```js
      const clientesPagantes = [];
      itensSnap.forEach(d => {
        const it = d.data();
        if ((it.type || 'processed') !== 'processed') return;
        if (!/^C\d+/i.test(String(it.codigo || ''))) return;
        if (it.cliente) clientesPagantes.push(it.cliente);
      });
```

passa a ser:

```js
      // Vai o lançamento INTEIRO, não só o nome: é ele que a tela mostra como
      // prova ao lado da pergunta, em vez de mandar a gestão procurar na Pacto.
      const clientesPagantes = [];
      itensSnap.forEach(d => {
        const it = d.data();
        if ((it.type || 'processed') !== 'processed') return;
        if (!/^C\d+/i.test(String(it.codigo || ''))) return;
        if (it.cliente) clientesPagantes.push({
          cliente: it.cliente, codigo: it.codigo,
          valor: it.valorCaixa || 0, data: it.data || null,
        });
      });
```

E trocar o `return` final do carregador. Hoje:

```js
      const cfg = { ...CommissionEngine.defaultConfig, ...unitConfig };
      const cruzado = VendasAguardando.cruzar(vendas, pagos, clientesPagantes);
      return {
        ...base, temLista: true, cruzado,
        resumo: VendasAguardando.resumo(cruzado),
        porVendedora: VendasAguardando.contarPorVendedora(cruzado, cfg.naoComissionaveis),
      };
```

passa a ser:

```js
      const cfg = { ...CommissionEngine.defaultConfig, ...unitConfig };

      // As marcações da gestão. Moram fora do documento do mês: re-subir o
      // arquivo da Pacto reescreve o período, e a decisão sumiria em silêncio.
      const confSnap = await db.collection('vendas_conferencia')
        .where('unitId', '==', unitId).get();
      const conferencias = {};
      confSnap.forEach(d => { const x = d.data(); if (x.contrato) conferencias[x.contrato] = x; });

      // Aplicar ANTES de resumir e de contar por vendedora — senão a venda é
      // contada no grupo errado.
      const cruzado = VendasAguardando.aplicarConferencias(
        VendasAguardando.cruzar(vendas, pagos, clientesPagantes), conferencias);

      return {
        ...base, temLista: true, cruzado, conferencias,
        resumo: VendasAguardando.resumo(cruzado),
        porVendedora: VendasAguardando.contarPorVendedora(cruzado, cfg.naoComissionaveis),
      };
```

Em `carregarArrastoAnterior`, aplicar as mesmas marcações para a venda dada por perdida sair do arrasto. Trocar o trecho de hoje:

```js
      const fora = [];
      const hoje = new Date();
      docs.sort((a, b) => a.mes.localeCompare(b.mes)).forEach(pr => {
        const r = VendasAguardando.cruzar(pr.vendasDoMes || [], pagos, []);
```

por:

```js
      // As mesmas marcações da gestão: a venda dada por perdida sai do arrasto,
      // senão essa lista só cresce até virar ruído que ninguém olha.
      const confSnap = await db.collection('vendas_conferencia')
        .where('unitId', '==', unitId).get();
      const conferencias = {};
      confSnap.forEach(d => { const x = d.data(); if (x.contrato) conferencias[x.contrato] = x; });

      const fora = [];
      const hoje = new Date();
      docs.sort((a, b) => a.mes.localeCompare(b.mes)).forEach(pr => {
        const r = VendasAguardando.aplicarConferencias(
          VendasAguardando.cruzar(pr.vendasDoMes || [], pagos, []), conferencias);
```

- [x] **Step 4: Run test to verify it passes**

```bash
node scripts/smoke-conferencia-vendas.js
```

Esperado: `7/7 casos passaram.`

E a suíte inteira:

```bash
for f in scripts/smoke-*.js; do case "$f" in *smoke-9.js) continue;; esac; node "$f" >/dev/null 2>&1 || echo "FALHOU: $f"; done; echo fim
```

Esperado: só `fim`.

- [x] **Step 5: Commit**

```bash
git add index.html scripts/smoke-conferencia-vendas.js
git commit -m "feat(comissoes): o carregador le as conferencias e o mes do pagamento"
```

---

### Task 7: A tela — os botões, a opinião e o "pago em"

**Files:**
- Modify: `index.html` — `blocoVendidoXPago` e `renderAReceberTab`
- Test: `scripts/smoke-conferencia-vendas.js`

- [x] **Step 1: Write the failing test**

Acrescentar em `scripts/smoke-conferencia-vendas.js`, antes da linha final:

```js
// ════════════════════════════════════════════════════════════════════
// 8. A tela: botões só para Admin, opinião junto, e "pago em"
// ════════════════════════════════════════════════════════════════════
// Roda a função DE VERDADE, recortada do index.html — ler o texto do arquivo
// não provaria nada (lição de `previa-nunca-rodou`).
{
  const fs = require('fs'), vm = require('vm');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const recortar = nome => {
    const ini = html.indexOf(nome);
    assert.ok(ini > 0, nome + ' não existe');
    let nivel = 0, fim = -1;
    for (let j = html.indexOf('{', ini); j < html.length; j++) {
      if (html[j] === '{') nivel++;
      else if (html[j] === '}') { nivel--; if (!nivel) { fim = j + 1; break; } }
    }
    return html.slice(ini, fim);
  };
  const sandbox = { console, VendasAguardando: VA };
  vm.createContext(sandbox);
  vm.runInContext(recortar('function linhaConferencia('), sandbox);
  const linha = sandbox.linhaConferencia;

  const catia = venda('C7130', 'CÁTIA TEREZINHA PEREIRA TORRES', {
    valorContrato: 2388, data: '27/08/2026',
    pagamentoQueBateu: { codigo: 'C6867', valor: 199, data: '12/08/2026' },
  });

  // (a) Admin vê os três botões e a opinião
  const adm = linha(catia, true);
  assert.ok(/Já foi paga/.test(adm) && /Ainda a receber/.test(adm) && /Não vamos cobrar/.test(adm),
    'Admin precisa dos três botões: ' + adm);
  assert.ok(/antes desta venda existir/.test(adm), 'a opinião tem que aparecer: ' + adm);
  assert.ok(/C6867/.test(adm), 'a prova (o contrato que pagou) tem que aparecer');

  // (b) quem não é Admin vê a opinião e NENHUM botão
  const vend = linha(catia, false);
  assert.ok(/antes desta venda existir/.test(vend), 'a explicação é para todos');
  assert.ok(!/<button/i.test(vend), 'quem não é Admin não pode ter botão: ' + vend);

  // (c) venda já marcada mostra quem decidiu e quando, e não repete os botões
  const marcada = linha({ ...catia,
    conferencia: { desfecho: 'nao_cobrar', por: 'Rafael', em: '07/09/2026', observacao: 'desistiu' } },
    true);
  assert.ok(/Rafael/.test(marcada) && /07\/09\/2026/.test(marcada),
    'tem que dizer quem decidiu e quando: ' + marcada);
  assert.ok(/desistiu/.test(marcada), 'a observação aparece');

  // (d) 🚨 marcação atropelada pelo dinheiro tem que APARECER
  const atropelada = linha({ ...catia,
    marcacaoIgnorada: { desfecho: 'nao_cobrar', por: 'Rafael', em: '07/09/2026' },
    pagoEm: { mes: '2026-09', data: '12/09/2026' } }, true);
  assert.ok(/12\/09\/2026/.test(atropelada), 'a data do pagamento tem que aparecer');
  assert.ok(/n[ãa]o vamos cobrar|marcad/i.test(atropelada),
    'a tela tem que DIZER que havia marcação em contrário: ' + atropelada);

  ok('a tela mostra opinião para todos, botões só para Admin, e o pagamento ganha');
}
```

- [x] **Step 2: Run test to verify it fails**

```bash
node scripts/smoke-conferencia-vendas.js
```

Esperado: `AssertionError: function linhaConferencia( não existe`

- [x] **Step 3: Write minimal implementation**

**(a)** Em `index.html`, acrescentar a função logo **antes** de `async function renderAReceberTab(`:

```js
    // ══════════════════════════════════════════════════════════════════
    // A linha de conferência de uma venda
    // ══════════════════════════════════════════════════════════════════
    // Autocontida de propósito: nada de `db`, `userProfile` ou DOM aqui dentro.
    // Recebe a venda e se quem olha é Admin, e devolve HTML.
    //
    // @param {Object} v        venda de aguardando/conferir/naoCobrar/pagas
    // @param {boolean} admin   quem olha pode registrar?
    // @returns {string} HTML
    function linhaConferencia(v, admin) {
      const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const nota = t => `<div style="font-size:11.5px;color:var(--text3);margin-top:4px">${t}</div>`;

      // 🚨 O dinheiro ganhou de uma marcação em contrário: a tela TEM que dizer,
      // senão parece que o sistema esqueceu o que a gestão decidiu.
      if (v.marcacaoIgnorada) {
        const q = { paga_outro_contrato: 'já foi paga', a_receber: 'ainda a receber',
                    nao_cobrar: 'não vamos cobrar' }[v.marcacaoIgnorada.desfecho] || v.marcacaoIgnorada.desfecho;
        return nota(`💰 O pagamento entrou${v.pagoEm && v.pagoEm.data ? ' em <strong>' + esc(v.pagoEm.data) + '</strong>' : ''}, `
          + `apesar de esta venda estar marcada como <strong>"${esc(q)}"</strong>`
          + `${v.marcacaoIgnorada.por ? ' por ' + esc(v.marcacaoIgnorada.por) : ''}. O pagamento vale.`);
      }

      if (v.pagoEm && v.pagoEm.data) return nota(`💰 Pago em <strong>${esc(v.pagoEm.data)}</strong>`);

      // Já conferida: mostra quem decidiu e quando, e não repete os botões.
      if (v.conferencia) {
        const q = { paga_outro_contrato: 'Já foi paga', a_receber: 'Ainda a receber',
                    nao_cobrar: 'Não vamos cobrar' }[v.conferencia.desfecho] || v.conferencia.desfecho;
        return nota(`✓ <strong>${esc(q)}</strong> — ${esc(v.conferencia.por || '—')}`
          + `${v.conferencia.em ? ', ' + esc(v.conferencia.em) : ''}`
          + `${v.conferencia.observacao ? '<br><em>' + esc(v.conferencia.observacao) + '</em>' : ''}`);
      }

      // A opinião do sistema é para TODOS — ela explica, não decide.
      let html = '';
      if (v.pagamentoQueBateu) {
        const op = VendasAguardando.opiniao(v, v.pagamentoQueBateu);
        html += nota(`⚠️ ${esc(op.porque)}`);
      }

      if (!admin) return html;

      const b = (desfecho, rotulo, cor) => `<button type="button" class="btn-sm"
        style="border:1px solid ${cor};color:${cor};background:transparent;border-radius:6px;padding:3px 9px;font-size:11px;margin-right:6px;cursor:pointer"
        onclick="registrarConferencia('${esc(v.contrato)}','${desfecho}')">${rotulo}</button>`;

      return html + `<div style="margin-top:6px">
        ${b('paga_outro_contrato', 'Já foi paga', 'var(--green)')}
        ${b('a_receber', 'Ainda a receber', 'var(--orange)')}
        ${b('nao_cobrar', 'Não vamos cobrar', 'var(--red)')}
      </div>`;
    }
```

**(b)** Ainda em `index.html`, acrescentar logo depois de `linhaConferencia` a função que grava:

```js
    /**
     * Grava o desfecho de uma venda. Só Admin — e a REGRA do banco também
     * exige, porque esconder o botão não basta: link direto existe.
     * @param {string} contrato  @param {string} desfecho
     */
    async function registrarConferencia(contrato, desfecho) {
      if (userProfile?.role !== 'admin') return;
      const rotulo = { paga_outro_contrato: 'Já foi paga', a_receber: 'Ainda a receber',
                       nao_cobrar: 'Não vamos cobrar' }[desfecho] || desfecho;
      const observacao = prompt(`"${rotulo}" — contrato ${contrato}.\n\nObservação (opcional):`, '');
      if (observacao === null) return;   // cancelou

      const dados = currentVendidoXPago || {};
      const todas = [].concat(dados.cruzado?.aguardando || [], dados.cruzado?.conferir || [],
                              dados.cruzado?.naoCobrar || []);
      const v = todas.find(x => String(x.contrato) === String(contrato)) || {};
      try {
        await db.collection('vendas_conferencia').doc(currentUnitId + '_' + contrato).set({
          unitId: currentUnitId, contrato, cliente: v.cliente || '',
          mesDaVenda: (dados.year || '') + '-' + String(dados.month || '').padStart(2, '0'),
          valorContrato: v.valorContrato || 0,
          desfecho, observacao: observacao || '',
          por: userProfile?.name || currentUser?.email || '—',
          porUid: currentUser?.uid || '',
          em: new Date().toLocaleDateString('pt-BR'),
          emTs: firebase.firestore.FieldValue.serverTimestamp(),
        });
        await logAudit('conferencia_venda', { contrato, desfecho, observacao, cliente: v.cliente });
        renderAReceberTab('aReceberContent', currentPeriodId, '');
      } catch (e) {
        alert('Não foi possível registrar: ' + e.message);
      }
    }
```

**(c)** Guardar a última leitura para o gravador achar a venda sem ler o banco de novo.

Primeiro, declarar a variável junto das outras de estado do arquivo, na linha de cima de `let auditCache = [];`:

```js
    // A última leitura do painel — `registrarConferencia` acha a venda aqui.
    let currentVendidoXPago = null;
```

Depois, em `carregarVendidoXPago`, trocar o `return` final. Como ele está ao fim da Task 6:

```js
      return {
        ...base, temLista: true, cruzado, conferencias,
        resumo: VendasAguardando.resumo(cruzado),
        porVendedora: VendasAguardando.contarPorVendedora(cruzado, cfg.naoComissionaveis),
      };
```

passa a ser:

```js
      currentVendidoXPago = {
        ...base, temLista: true, cruzado, conferencias,
        resumo: VendasAguardando.resumo(cruzado),
        porVendedora: VendasAguardando.contarPorVendedora(cruzado, cfg.naoComissionaveis),
      };
      return currentVendidoXPago;
```

⚠️ Há um segundo `return` mais acima na função, o do mês **sem lista de vendas**. Trocar ele também, para o estado não ficar preso na leitura anterior:

```js
      if (!vendas.length) return { ...base, temLista: false, cruzado: null, resumo: null, porVendedora: {} };
```

passa a ser:

```js
      if (!vendas.length) {
        currentVendidoXPago = { ...base, temLista: false, cruzado: null, resumo: null, porVendedora: {} };
        return currentVendidoXPago;
      }
```

**(d)** Em `renderAReceberTab`, mostrar a linha em cada venda da tabela. Trocar:

```js
                    <td>${v.situacao || '—'}</td>
```

por:

```js
                    <td>${v.situacao || '—'}${linhaConferencia(v, userProfile?.role === 'admin')}</td>
```

E, no bloco `blocoConferir`, trocar:

```js
              ${conferir.map(v => `<div style="padding:3px 0">• <strong>${v.cliente}</strong> — contrato ${v.contrato} · ${v.situacao || ''} · fechada em ${v.data}${v.vendedores.length ? ' · ' + v.vendedores.join(', ') : ''}</div>`).join('')}
```

por:

```js
              ${conferir.map(v => `<div style="padding:6px 0;border-top:1px solid var(--border)">• <strong>${v.cliente}</strong> — contrato ${v.contrato} · ${v.situacao || ''} · fechada em ${v.data}${v.vendedores.length ? ' · ' + v.vendedores.join(', ') : ''}${linhaConferencia(v, userProfile?.role === 'admin')}</div>`).join('')}
```

**(e)** Em `blocoVendidoXPago`, mostrar o "não vamos cobrar" como nota. Trocar:

```js
      const testes = ((d.cruzado && d.cruzado.testes) || []).length;
```

por:

```js
      const testes = ((d.cruzado && d.cruzado.testes) || []).length;

      // A venda dada por perdida foi vendida de verdade: sai das que ainda
      // esperam dinheiro, não da história do mês. Por isso é nota, não número.
      const perdidas = (d.resumo && d.resumo.naoCobrar) || 0;
      const notaPerdidas = perdidas ? `
        <div style="font-size:10.5px;color:var(--text3);margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
          ${perdidas} venda${perdidas > 1 ? 's' : ''} que não ${perdidas > 1 ? 'serão' : 'será'} cobrada${perdidas > 1 ? 's' : ''}, por decisão da gestão.
        </div>` : '';
```

E, na mesma função, trocar:

```js
        ${notaTeste}
      </div>`;
```

por:

```js
        ${notaPerdidas}
        ${notaTeste}
      </div>`;
```

- [x] **Step 4: Run test to verify it passes**

```bash
node scripts/smoke-conferencia-vendas.js
```

Esperado: `8/8 casos passaram.`

E a suíte inteira:

```bash
for f in scripts/smoke-*.js; do case "$f" in *smoke-9.js) continue;; esac; node "$f" >/dev/null 2>&1 || echo "FALHOU: $f"; done; echo fim
```

Esperado: só `fim`.

- [x] **Step 5: Commit**

```bash
git add index.html scripts/smoke-conferencia-vendas.js
git commit -m "feat(comissoes): botoes de conferencia, opiniao do sistema e pago em"
```

---

### Task 8: A homologação contra o banco real

**Files:**
- Modify: `scripts/homologar-vendido-x-pago.js`

- [x] **Step 1: Acrescentar a conferência da precedência**

Em `scripts/homologar-vendido-x-pago.js`, dentro de `carregar()`, trocar:

```js
  const cruzado = VA.cruzar(vendas, pagos, clientesPagantes);
```

por:

```js
  const confSnap = await db.collection('vendas_conferencia').where('unitId', '==', unitId).get();
  const conferencias = {};
  confSnap.forEach(d => { const x = d.data(); if (x.contrato) conferencias[x.contrato] = x; });
  const cruzado = VA.aplicarConferencias(VA.cruzar(vendas, pagos, clientesPagantes), conferencias);
```

E, no laço principal do script, logo depois do bloco `if (SEM_TESTE_EM_LUGAR_NENHUM) { ... }`, acrescentar:

```js
    // 🚨 Nenhuma marcação humana pode ter escondido um pagamento real.
    const escondidos = (d.cruzado.naoCobrar || []).filter(v => v.pagoEm);
    conferir(escondidos.length === 0,
      periodId + ': nenhuma marcacao escondendo pagamento real'
      + (escondidos.length ? ' (' + escondidos.map(v => v.cliente).join(', ') + ')' : ''));

    const r2 = d.resumo;
    conferir(r2.vendidas === r2.pagas + r2.aguardando + r2.conferir + (r2.naoCobrar || 0),
      periodId + ': vendidas = pagas + aguardando + conferir + naoCobrar');

    if ((d.cruzado.naoCobrar || []).length) {
      console.log('  nao serao cobradas: '
        + d.cruzado.naoCobrar.map(v => v.cliente + ' (' + (v.conferencia?.por || '?') + ')').join(', '));
    }
```

- [x] **Step 2: Rodar contra a produção**

```bash
node scripts/homologar-vendido-x-pago.js --project production
```

Esperado: todas as linhas `OK`, nenhuma `FALHA`. Como ainda não há nenhuma conferência gravada, os grupos devem sair idênticos aos de hoje — Campeche/agosto 73·68·3·2 e Príncipe/agosto 59·43·16·0.

- [x] **Step 3: Commit**

```bash
git add scripts/homologar-vendido-x-pago.js
git commit -m "test(comissoes): homologacao confere a precedencia da conferencia"
```

---

### Task 9: Staging

- [x] **Step 1: Rodar a suíte inteira**

```bash
for f in scripts/smoke-*.js; do case "$f" in *smoke-9.js) continue;; esac; node "$f" >/dev/null 2>&1 || echo "FALHOU: $f"; done; echo fim
```

Esperado: só `fim`.

- [x] **Step 2: Bump do cache-buster**

Em `index.html`, trocar as quatro ocorrências de `?v=20260910` por um valor **diferente e com 8 dígitos** (`smoke-upload-pacto-tela.js` exige `\?v=\d{8}`). Se o deploy for no dia 08/09, usar `20260908`; se for outro deploy no mesmo dia do anterior, avançar a data em um dia. Sem isso o navegador serve o JS antigo e os botões não aparecem.

- [x] **Step 3: Publicar a regra e o hosting no staging**

⚠️ **A regra vai ANTES do hosting.** A tela nova grava numa coleção que sem regra é negada.

```bash
node scripts/validate-rules-comissoes.js
firebase deploy --only firestore:rules
firebase deploy --only hosting
```

- [x] **Step 4: Conferir no navegador do staging**

No console da página do staging:

```js
typeof VendasAguardando.aplicarConferencias === 'function' &&
typeof VendasAguardando.opiniao === 'function' &&
typeof linhaConferencia === 'function' &&
typeof registrarConferencia === 'function' &&
!/\<button/i.test(linhaConferencia({contrato:'C1', pagamentoQueBateu:{codigo:'C2',valor:1,data:'01/08/2026'}}, false))
```

Esperado: `true`, e nenhum erro no console.

- [x] **Step 5: Clicar de verdade, logado como Admin**

Abrir o Dashboard → aba "A receber" de agosto e:

1. Marcar uma venda como **"Não vamos cobrar"** com uma observação. Conferir que ela sai dos três números e vira a nota embaixo.
2. Recarregar a página. **A marcação tem que continuar lá** — é o que prova que ela não vive na memória do navegador.
3. Abrir setembro e conferir que essa venda **saiu do arrasto**.
4. Marcar de novo como **"Ainda a receber"**. Conferir que ela volta para aguardando com *"conferida em ... por ..."*.
5. Entrar com um login de **vendedora** do staging e conferir que ela **vê o desfecho e a observação, e nenhum botão**.

   ⚠️ **As contas de demo do staging (`dono.teste@`, `professor.teste@`, `professor2.teste@`) são de admin e de professor — nenhuma é vendedora.** Antes deste passo, criar uma pela tela Pessoas, ou pedir ao Rafael um login de vendedora do staging. Sem isso, o passo mais importante da permissão fica sem prova: a trava da regra do banco protege a ESCRITA, mas quem garante que a vendedora consegue LER o desfecho é este clique.

- [x] **Step 6: Homologar contra o Firestore do staging**

```bash
node scripts/homologar-vendido-x-pago.js --project staging
```

Esperado: todas `OK`.

- [x] **Step 7: Commit**

```bash
git add index.html
git commit -m "chore(comissoes): bump do cache-buster da conferencia de vendas"
```

---

### Task 10: Produção

- [x] **Step 1: Pedir o OK explícito ao Rafael**

Regra 7 do `CLAUDE.md`: produção só depois de homologação completa no staging, com OK explícito. Mostrar o que foi clicado e o que não foi.

- [x] **Step 2: Publicar a regra ANTES do frontend**

```bash
node scripts/validate-rules-comissoes.js
firebase deploy --only firestore:rules --project production
```

⚠️ `validate-rules-comissoes.js` existe porque um deploy de regras já deixou quatro coleções de Comissões sem regra em produção, e Pagamentos e Histórico quebraram em silêncio. Não pular.

- [x] **Step 3: Publicar o frontend**

```bash
git push origin main
```

(É o GitHub Pages que serve o usuário — `firebase deploy --only hosting` publica o staging.)

- [x] **Step 4: Conferir no ar**

```bash
curl -s "https://rafaelmayerbrasil.github.io/crosstrainer-comissoes/vendas-aguardando.js" | grep -c "aplicarConferencias"
```

Esperado: `1` ou mais. Se vier `0`, o GitHub Pages ainda está publicando — esperar e repetir.

- [x] **Step 5: Homologar contra a produção**

```bash
node scripts/homologar-vendido-x-pago.js --project production
```

Esperado: todas `OK`.

- [x] **Step 6: Registrar a sessão**

Atualizar `CONTEXTO_SESSAO.md` com o que entrou, o que foi clicado por gente e o que não foi. Commitar.

---

## O que este plano NÃO faz

- **Não muda nenhum cálculo de comissão.** A conta sai dos recebimentos (`itens`); esta é uma camada de registro por cima. Nenhum dos três desfechos move um centavo.
- Nenhuma Cloud Function.
- Nada no fechamento da folha de professores.
- Não arruma o cadastro da Mariana na Pacto — isso continua com a gestão.

## Números para conferir a implementação

Sem nenhuma conferência gravada, os grupos têm que sair idênticos aos de hoje (medidos em produção em 07/09/2026):

| período | vendidas | pagas | aguardando | conferir |
|---|---:|---:|---:|---:|
| `cp_2026-08` | 73 | 68 | 3 | 2 |
| `pp_2026-08` | 59 | 43 | 16 | 0 |
| `cp_2026-09` | 14 | 0 | 14 | 0 |
| `pp_2026-09` | 11 | 0 | 11 | 0 |

As duas vendas "a conferir" do Campeche são a **Amandha** (C7070) e a **Cátia** (C7130). As duas têm que sair com a opinião *provavelmente ainda não foi paga* — os pagamentos que bateram o nome foram de R$ 239 em 04/08 e R$ 199 em 12/08, ambos anteriores às vendas, contra contratos anuais de R$ 2.388.
