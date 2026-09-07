# Painel "vendido × pago" — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar, na home da gestão e na da vendedora, quantas vendas foram fechadas e quantas viraram dinheiro — com o detalhe por pessoa na aba "A receber".

**Architecture:** Nenhum cálculo novo. `VendasAguardando.cruzar()` já separa `{pagas, aguardando, conferir}`; esta entrega acrescenta duas funções puras de contagem no mesmo módulo, um carregador único no `index.html` (`carregarVendidoXPago`) que faz a leitura do Firestore **uma vez** e alimenta as duas telas, e um construtor de HTML compartilhado (`blocoVendidoXPago`). Home e detalhe não podem divergir porque saem da mesma função.

**Tech Stack:** JS vanilla, sem framework. `vendas-aguardando.js` é módulo puro (roda em Node e no browser). Testes são smokes em Node com `assert`, rodados por `node scripts/smoke-*.js`.

**Spec:** `docs/superpowers/specs/2026-09-07-painel-vendido-x-pago-design.md`

---

## Estrutura de arquivos

| arquivo | responsabilidade | ação |
|---|---|---|
| `vendas-aguardando.js` | módulo puro: cruzar vendido × pago, **e agora contar** | modificar |
| `index.html` | carregador único, construtor de HTML, e os 3 pontos de uso | modificar |
| `scripts/smoke-vendido-x-pago.js` | prova as regras de contagem e exibição | criar |

**Por que a contagem vai no módulo puro e não no `index.html`:** é regra de negócio (a venda dividida conta para as duas vendedoras, mas conta uma vez no total do mês), e regra de negócio no `index.html` não tem teste. O `index.html` fica só com leitura do banco e HTML.

---

### Task 1: Contagem por vendedora (módulo puro)

**Files:**
- Modify: `vendas-aguardando.js` (acrescentar método ao objeto retornado pelo factory, depois de `daVendedora`)
- Test: `scripts/smoke-vendido-x-pago.js` (criar)

- [ ] **Step 1: Write the failing test**

Criar `scripts/smoke-vendido-x-pago.js`:

```js
'use strict';
// Roda: node scripts/smoke-vendido-x-pago.js
//
// O painel "vendido × pago" (spec 2026-09-07) mostra os mesmos números na home
// e na aba "A receber". Se as duas telas contarem por caminhos diferentes elas
// vão divergir um dia — então a contagem mora aqui, no módulo puro, e as duas
// telas chamam a MESMA função.
//
// ⚠️ Duas contagens diferentes de propósito:
//    • o total do MÊS conta VENDA (a dividida conta uma vez)
//    • a tabela POR VENDEDORA conta para as DUAS (a comissão é dividida)
//    Somar a coluna da tabela e comparar com o total do mês vai dar diferente,
//    e isso está certo. O teste trava esse comportamento para ninguém
//    "consertar" depois.

const assert = require('assert');
const path = require('path');
const VA = require(path.join(__dirname, '..', 'vendas-aguardando.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);

/** venda como `extrair` devolve, só com o que a contagem usa */
const venda = (contrato, cliente, vendedores, extra) => ({
  contrato, cliente, vendedores, data: '05/08/2026', situacao: 'Matrícula',
  valorContrato: 1000, inicio: '05/08/2026', ...extra,
});

const NAO_COM = ['RODRIGO', 'RAFAEL ROJAIS', 'BENNY ELAND', 'SISTEMA'];

// ════════════════════════════════════════════════════════════════════
// 1. Contagem por vendedora
// ════════════════════════════════════════════════════════════════════
{
  const cruzado = {
    pagas:      [venda('C1', 'ANA', ['KALI DUTRA'])],
    aguardando: [venda('C2', 'BIA', ['KALI DUTRA']), venda('C3', 'CLARA', ['RODRIGO'])],
    conferir:   [venda('C4', 'DORA', ['BÁRBARA VIEIRA CARDOSO'])],
  };
  const t = VA.contarPorVendedora(cruzado, NAO_COM);

  assert.deepStrictEqual(t['KALI DUTRA'],
    { vendidas: 2, pagas: 1, aguardando: 1, conferir: 0, naoComissionado: false });
  assert.deepStrictEqual(t['BÁRBARA VIEIRA CARDOSO'],
    { vendidas: 1, pagas: 0, aguardando: 0, conferir: 1, naoComissionado: false });
  assert.strictEqual(t['RODRIGO'].naoComissionado, true, 'o Rodrigo vende e não recebe');
  ok('conta vendidas/pagas/aguardando/conferir por vendedora e marca quem não recebe');
}

// ════════════════════════════════════════════════════════════════════
// 2. Venda dividida conta para as DUAS
// ════════════════════════════════════════════════════════════════════
{
  const t = VA.contarPorVendedora(
    { pagas: [venda('C9', 'ELE', ['KALI DUTRA', 'BÁRBARA VIEIRA CARDOSO'])], aguardando: [], conferir: [] },
    NAO_COM);
  assert.strictEqual(t['KALI DUTRA'].pagas, 1);
  assert.strictEqual(t['BÁRBARA VIEIRA CARDOSO'].pagas, 1);
  ok('venda dividida conta para as duas vendedoras');
}

// ════════════════════════════════════════════════════════════════════
// 3. Venda sem vendedora não some
// ════════════════════════════════════════════════════════════════════
{
  const t = VA.contarPorVendedora({ pagas: [], aguardando: [venda('C8', 'ORFA', [])], conferir: [] }, NAO_COM);
  assert.strictEqual(t['(sem vendedora)'].aguardando, 1, 'venda órfã tem que aparecer, não sumir');
  ok('venda sem vendedora aparece como "(sem vendedora)"');
}

console.log('\n' + n + '/' + n + ' casos passaram.');
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node scripts/smoke-vendido-x-pago.js
```

Esperado: `TypeError: VA.contarPorVendedora is not a function`

- [ ] **Step 3: Write minimal implementation**

Em `vendas-aguardando.js`, logo **depois** do método `daVendedora` (é o último do objeto; acrescentar vírgula ao fim dele):

```js
    /**
     * Quanto cada vendedora vendeu e quanto virou dinheiro.
     *
     * ⚠️ A venda DIVIDIDA conta para as duas — é assim que a comissão dela é
     * paga. Por isso a soma desta tabela é MAIOR que o total do mês (ver
     * `resumo`), e isso não é bug: são perguntas diferentes.
     *
     * @param {{pagas, aguardando, conferir}} cruzado  saída de `cruzar`
     * @param {Array<string>} naoComissionaveis  `cfg.naoComissionaveis` do motor
     * @returns {Object} nome → {vendidas, pagas, aguardando, conferir, naoComissionado}
     */
    contarPorVendedora(cruzado, naoComissionaveis) {
      const naoCom = (naoComissionaveis || []).map(x => String(x).toUpperCase().trim());
      const out = {};
      const contar = (lista, campo) => (lista || []).forEach(v => {
        const nomes = (v.vendedores && v.vendedores.length) ? v.vendedores : ['(sem vendedora)'];
        nomes.forEach(nome => {
          const x = out[nome] = out[nome] || {
            vendidas: 0, pagas: 0, aguardando: 0, conferir: 0,
            // mesma regra do motor: `vendedor.includes(n)`
            naoComissionado: naoCom.some(nc => String(nome).toUpperCase().includes(nc)),
          };
          x[campo]++;
          x.vendidas++;
        });
      });
      contar(cruzado && cruzado.pagas, 'pagas');
      contar(cruzado && cruzado.aguardando, 'aguardando');
      contar(cruzado && cruzado.conferir, 'conferir');
      return out;
    },
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node scripts/smoke-vendido-x-pago.js
```

Esperado: `3/3 casos passaram.`

- [ ] **Step 5: Commit**

```bash
git add vendas-aguardando.js scripts/smoke-vendido-x-pago.js
git commit -m "feat(comissoes): contagem vendido x pago por vendedora"
```

---

### Task 2: O resumo do mês e o corte de mês fechado (módulo puro)

**Files:**
- Modify: `vendas-aguardando.js` (depois de `contarPorVendedora`)
- Test: `scripts/smoke-vendido-x-pago.js`

- [ ] **Step 1: Write the failing test**

Acrescentar em `scripts/smoke-vendido-x-pago.js`, **antes** da linha final `console.log(...)`:

```js
// ════════════════════════════════════════════════════════════════════
// 4. O resumo do mês conta VENDA, não vendedora
// ════════════════════════════════════════════════════════════════════
{
  const cruzado = {
    pagas:      [venda('C1', 'ANA', ['KALI DUTRA', 'BÁRBARA VIEIRA CARDOSO'])],
    aguardando: [venda('C2', 'BIA', ['KALI DUTRA'])],
    conferir:   [venda('C3', 'CLARA', ['RODRIGO'])],
  };
  assert.deepStrictEqual(VA.resumo(cruzado),
    { vendidas: 3, pagas: 1, aguardando: 1, conferir: 1 });

  const porV = VA.contarPorVendedora(cruzado, NAO_COM);
  const somaTabela = Object.values(porV).reduce((s, v) => s + v.vendidas, 0);
  assert.strictEqual(somaTabela, 4, 'a tabela soma 4 porque a venda dividida conta 2×');
  assert.notStrictEqual(somaTabela, VA.resumo(cruzado).vendidas,
    'e isso é de propósito — não "consertar" igualando as duas');
  ok('o resumo do mês conta 3 vendas; a tabela por vendedora soma 4, de propósito');
}

// ════════════════════════════════════════════════════════════════════
// 5. Resumo de um mês vazio
// ════════════════════════════════════════════════════════════════════
{
  assert.deepStrictEqual(VA.resumo({ pagas: [], aguardando: [], conferir: [] }),
    { vendidas: 0, pagas: 0, aguardando: 0, conferir: 0 });
  ok('mês sem nenhuma venda devolve zeros (quem trata "não sei" é a tela)');
}

// ════════════════════════════════════════════════════════════════════
// 6. O % de conversão só vale em mês que já terminou
// ════════════════════════════════════════════════════════════════════
// No dia 7 quase nada foi cobrado ainda: setembro/2026 marcava 0% nas duas
// unidades. Mostrar isso ao lado do nome de alguém é convite pra injustiça.
{
  const hoje = new Date(2026, 8, 7);            // 07/09/2026
  assert.strictEqual(VA.mesFechado(2026, 8, hoje), true,  'agosto já terminou');
  assert.strictEqual(VA.mesFechado(2026, 9, hoje), false, 'setembro está correndo');
  assert.strictEqual(VA.mesFechado(2025, 12, hoje), true, 'ano anterior também');
  assert.strictEqual(VA.mesFechado(2026, 10, hoje), false, 'mês futuro não é fechado');
  ok('mesFechado separa o mês corrente do que já terminou');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node scripts/smoke-vendido-x-pago.js
```

Esperado: `TypeError: VA.resumo is not a function`

- [ ] **Step 3: Write minimal implementation**

Em `vendas-aguardando.js`, depois de `contarPorVendedora`:

```js
    /**
     * Os três números do mês. Conta VENDA: a dividida conta uma vez só.
     * @param {{pagas, aguardando, conferir}} cruzado
     */
    resumo(cruzado) {
      const c = cruzado || {};
      const pagas = (c.pagas || []).length;
      const aguardando = (c.aguardando || []).length;
      const conferir = (c.conferir || []).length;
      return { vendidas: pagas + aguardando + conferir, pagas, aguardando, conferir };
    },

    /**
     * O mês já terminou? Só aí o % de conversão diz alguma coisa — no mês
     * corrente ele é baixo por construção, porque a cobrança ainda não caiu.
     * @param {number} year  @param {number} month  1-12
     * @param {Date} hoje  injetável para teste
     */
    mesFechado(year, month, hoje) {
      const d = hoje || new Date();
      const anoAtual = d.getFullYear(), mesAtual = d.getMonth() + 1;
      return year < anoAtual || (year === anoAtual && month < mesAtual);
    },
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node scripts/smoke-vendido-x-pago.js
```

Esperado: `6/6 casos passaram.`

- [ ] **Step 5: Commit**

```bash
git add vendas-aguardando.js scripts/smoke-vendido-x-pago.js
git commit -m "feat(comissoes): resumo do mes e corte de mes fechado"
```

---

### Task 3: O carregador único no index.html

**Files:**
- Modify: `index.html` — inserir **imediatamente antes** da linha `// Aba "A receber" — vendi e o dinheiro ainda não entrou` (hoje linha ~7567)
- Test: `scripts/smoke-vendido-x-pago.js`

- [ ] **Step 1: Write the failing test**

Acrescentar em `scripts/smoke-vendido-x-pago.js`, antes da linha final:

```js
// ════════════════════════════════════════════════════════════════════
// 7. Uma leitura só, usada pelas duas telas
// ════════════════════════════════════════════════════════════════════
// Se a home e a aba lerem o banco por caminhos diferentes, um dia divergem —
// e o painel perde a serventia. Esta é a trava estrutural.
{
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(/async function carregarVendidoXPago\(/.test(html),
    'precisa existir um carregador único');
  const usos = [...html.matchAll(/carregarVendidoXPago\(/g)];
  assert.ok(usos.length >= 3,
    'o carregador tem que ser chamado pela home da gestão, pela da vendedora e pela aba — achei ' + usos.length);
  assert.ok(!/VendasAguardando\.cruzar\(/.test(html.replace(/async function carregarVendidoXPago\([\s\S]*?\n    \}/, '')),
    'ninguém pode chamar cruzar() fora do carregador');
  ok('existe um carregador único e ninguém cruza por fora');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node scripts/smoke-vendido-x-pago.js
```

Esperado: `AssertionError: precisa existir um carregador único`

- [ ] **Step 3: Write minimal implementation**

Em `index.html`, antes do comentário `// Aba "A receber" — vendi e o dinheiro ainda não entrou`:

```js
    // ══════════════════════════════════════════════════════════════════
    // Painel "vendido × pago" — a leitura única
    // ══════════════════════════════════════════════════════════════════
    // A home da gestão, a home da vendedora e a aba "A receber" mostram os
    // mesmos números. Se cada uma buscasse por conta própria, um dia
    // divergiriam — e um painel que se contradiz não é usado. Toda leitura
    // passa por aqui.
    //
    // @param {string} periodId
    // @returns {{temLista, cruzado, resumo, porVendedora, fechado,
    //            vendasAtualizadasEm, recebidosAtualizadosEm, unitId, year, month}}
    async function carregarVendidoXPago(periodId) {
      const pDoc = await db.collection('periodos').doc(periodId).get();
      const pData = pDoc.exists ? pDoc.data() : {};
      const vendas = pData.vendasDoMes || [];
      const unitId = pData.unitId || currentUnitId;
      const base = {
        unitId, year: pData.year, month: pData.month,
        vendasAtualizadasEm: pData.vendasAtualizadasEm || null,
        recebidosAtualizadosEm: pData.uploadDate || null,
        fechado: VendasAguardando.mesFechado(pData.year, pData.month),
      };

      // Sem lista de vendas não é "zero" — é "não sei". Quem decide o que
      // mostrar é a tela; aqui só devolvemos a verdade.
      if (!vendas.length) return { ...base, temLista: false, cruzado: null, resumo: null, porVendedora: {} };

      // Um contrato deixa de aguardar quando aparece na memória de QUALQUER mês
      // desta unidade: venda de agosto paga em setembro já entrou.
      const snap = await db.collection('periodos').where('unitId', '==', unitId).get();
      const pagos = [];
      snap.forEach(d => (d.data().codigosPagos || []).forEach(c => pagos.push(c)));

      // Quem pagou algo DE CONTRATO no mês — separa a renovação que trocou de
      // número de quem não pagou nada. Bar e loja não contam.
      const itensSnap = await db.collection('periodos').doc(periodId).collection('itens').get();
      const clientesPagantes = [];
      itensSnap.forEach(d => {
        const it = d.data();
        if ((it.type || 'processed') !== 'processed') return;
        if (!/^C\d+/i.test(String(it.codigo || ''))) return;
        if (it.cliente) clientesPagantes.push(it.cliente);
      });

      const cfg = { ...CommissionEngine.defaultConfig, ...unitConfig };
      const cruzado = VendasAguardando.cruzar(vendas, pagos, clientesPagantes);
      return {
        ...base, temLista: true, cruzado,
        resumo: VendasAguardando.resumo(cruzado),
        porVendedora: VendasAguardando.contarPorVendedora(cruzado, cfg.naoComissionaveis),
      };
    }
```

Depois, dentro de `renderAReceberTab`, **substituir** o trecho que lê o período e cruza. Trocar estas linhas:

```js
        const pDoc = await db.collection('periodos').doc(periodId).get();
        const pData = pDoc.exists ? pDoc.data() : {};
        const vendas = pData.vendasDoMes || [];

        if (!vendas.length) {
```

por:

```js
        const dados = await carregarVendidoXPago(periodId);
        const vendas = dados.temLista ? dados.cruzado.pagas.concat(dados.cruzado.aguardando, dados.cruzado.conferir) : [];

        if (!dados.temLista) {
```

e remover o bloco que vai de `// Um contrato deixa de aguardar quando aparece na memória` até a linha `const r = VendasAguardando.cruzar(vendas, pagos, clientesPagantes);`, substituindo tudo por:

```js
        const r = dados.cruzado;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node scripts/smoke-vendido-x-pago.js && node scripts/smoke-vendas-aguardando.js
```

Esperado: `7/7 casos passaram.` no primeiro e `20/20` no segundo (a aba "A receber" não pode ter regredido).

- [ ] **Step 5: Commit**

```bash
git add index.html scripts/smoke-vendido-x-pago.js
git commit -m "refactor(comissoes): leitura unica do vendido x pago"
```

---

### Task 4: O bloco dos três números

**Files:**
- Modify: `index.html` — inserir logo depois de `carregarVendidoXPago`
- Test: `scripts/smoke-vendido-x-pago.js`

- [ ] **Step 1: Write the failing test**

Acrescentar em `scripts/smoke-vendido-x-pago.js`, antes da linha final:

```js
// ════════════════════════════════════════════════════════════════════
// 8. O bloco dos três números, e o que ele faz quando falta dado
// ════════════════════════════════════════════════════════════════════
// Roda a função DE VERDADE, recortada do index.html — ler o texto do arquivo
// não provaria nada (lição de `previa-nunca-rodou`).
{
  const fs = require('fs'), vm = require('vm');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const ini = html.indexOf('function blocoVendidoXPago(');
  assert.ok(ini > 0, 'blocoVendidoXPago não existe');
  let nivel = 0, fim = -1;
  for (let j = html.indexOf('{', ini); j < html.length; j++) {
    if (html[j] === '{') nivel++;
    else if (html[j] === '}') { nivel--; if (!nivel) { fim = j + 1; break; } }
  }
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(html.slice(ini, fim), sandbox);
  const bloco = sandbox.blocoVendidoXPago;

  // (a) mês sem lista de vendas: "não sei", nunca "zero"
  const semLista = bloco({ temLista: false, year: 2026, month: 9, fechado: false }, {});
  assert.ok(/lista de vendas/i.test(semLista), 'tem que explicar que falta a lista');
  assert.ok(!/>\s*0\s*</.test(semLista), 'não pode mostrar zero: ' + semLista);

  // (b) mês corrente: sem percentual
  const corrente = bloco({
    temLista: true, year: 2026, month: 9, fechado: false,
    resumo: { vendidas: 25, pagas: 0, aguardando: 25, conferir: 0 },
  }, {});
  assert.ok(/25/.test(corrente), 'mostra as 25 vendidas');
  assert.ok(!/%/.test(corrente), 'mês corrente não mostra percentual: ' + corrente);

  // (c) mês fechado: com percentual
  const fechado = bloco({
    temLista: true, year: 2026, month: 8, fechado: true,
    resumo: { vendidas: 74, pagas: 68, aguardando: 4, conferir: 2 },
  }, {});
  assert.ok(/92%/.test(fechado), '68 de 74 é 92%: ' + fechado);

  // (d) "conferir" nunca soma com "aguardando"
  assert.ok(/2 delas|2 podem/i.test(fechado),
    'as 2 de conferir têm que sair como nota, não somadas no aguardando: ' + fechado);
  ok('o bloco: sem lista não vira zero, % só em mês fechado, conferir não soma');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node scripts/smoke-vendido-x-pago.js
```

Esperado: `AssertionError: blocoVendidoXPago não existe`

- [ ] **Step 3: Write minimal implementation**

Em `index.html`, logo depois de `carregarVendidoXPago`:

```js
    /**
     * Os três números, iguais na home e na aba.
     *
     * @param {Object} d  saída de `carregarVendidoXPago`
     * @param {Object} opts  { soDe: nome da vendedora ('' = gestão), arrasto: n }
     */
    function blocoVendidoXPago(d, opts) {
      const o = opts || {};
      const titulo = o.soDe ? 'O QUE VOCÊ VENDEU' : 'VENDAS DO MÊS';

      // "Não sei" nunca vira "zero": um 0 ao lado do nome de alguém é uma
      // acusação falsa. Sem a lista, a tela pede o arquivo.
      if (!d.temLista) {
        return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px 20px;margin-bottom:18px">
          <div style="font-size:10px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px">${titulo}</div>
          <div style="font-size:12.5px;color:var(--text2);line-height:1.6">
            Este mês ainda não tem a <strong>lista de vendas</strong>. Sem ela não dá para dizer quanto do que foi vendido virou dinheiro.
            ${o.soDe ? 'Peça à gestão para subir' : 'Suba'} o relatório <strong>"Faturamento por Período"</strong> da Pacto em Upload.
          </div>
        </div>`;
      }

      const r = d.resumo;
      const dt = ts => { try { return ts.toDate().toLocaleDateString('pt-BR'); } catch (e) { return '—'; } };
      const pct = r.vendidas ? Math.round((r.pagas / r.vendidas) * 100) : 0;

      const num = (valor, rotulo, cor, nota) => `
        <div style="text-align:center;padding:0 10px">
          <div class="mono" style="font-size:30px;font-weight:800;color:${cor};line-height:1.1">${valor}</div>
          <div style="font-size:10.5px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-top:2px">${rotulo}</div>
          ${nota ? `<div style="font-size:10.5px;color:var(--text3);margin-top:3px">${nota}</div>` : ''}
        </div>`;

      return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px 20px;margin-bottom:18px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:12px">
          <div style="font-size:10px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:1.5px">${titulo}</div>
          <div style="font-size:10.5px;color:var(--text3)">
            vendas até ${dt(d.vendasAtualizadasEm)} · recebimentos até ${dt(d.recebidosAtualizadosEm)}
          </div>
        </div>
        <div style="display:flex;justify-content:space-around;align-items:flex-start">
          ${num(r.vendidas, 'vendidas', 'var(--text)')}
          ${num(r.pagas, 'pagas', 'var(--green)', d.fechado ? pct + '% do que vendeu' : '')}
          ${num(r.aguardando, 'aguardando', 'var(--orange)',
                (o.arrasto ? '+ ' + o.arrasto + ' de meses anteriores' : '')
                + (r.conferir ? (o.arrasto ? '<br>' : '') + r.conferir + ' delas podem já ter sido pagas em outro contrato' : ''))}
        </div>
      </div>`;
    }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node scripts/smoke-vendido-x-pago.js
```

Esperado: `8/8 casos passaram.`

- [ ] **Step 5: Commit**

```bash
git add index.html scripts/smoke-vendido-x-pago.js
git commit -m "feat(comissoes): bloco dos tres numeros do vendido x pago"
```

---

### Task 5: O arrasto de meses anteriores

**Files:**
- Modify: `index.html` — depois de `blocoVendidoXPago`
- Test: `scripts/smoke-vendido-x-pago.js`

- [ ] **Step 1: Write the failing test**

Acrescentar em `scripts/smoke-vendido-x-pago.js`, antes da linha final:

```js
// ════════════════════════════════════════════════════════════════════
// 9. Venda de mês anterior sai do arrasto sozinha quando o dinheiro entra
// ════════════════════════════════════════════════════════════════════
// É a regra que justifica o bloco separado: a venda velha que nunca virou
// dinheiro é a que merece conversa. Se ela some quando é paga, ninguém cobra
// à toa; se não some, o bloco vira lixo e ninguém olha.
{
  const vendasAgosto = [venda('C4566', 'JAIR', ['KALI DUTRA']), venda('C4647', 'RAQUEL', ['KALI DUTRA'])];
  const semPagar = VA.cruzar(vendasAgosto, [], []);
  assert.strictEqual(semPagar.aguardando.length, 2, 'nada pago ainda');

  const comSetembro = VA.cruzar(vendasAgosto, ['C4566'], []);
  assert.strictEqual(comSetembro.pagas.length, 1);
  assert.strictEqual(comSetembro.aguardando.length, 1);
  assert.strictEqual(comSetembro.aguardando[0].cliente, 'RAQUEL',
    'quem foi paga em outro mês tem que sair do arrasto');
  ok('venda de mês anterior sai do arrasto sozinha quando o pagamento entra');
}

// ════════════════════════════════════════════════════════════════════
// 10. O carregador do arrasto existe e não lê o mês corrente
// ════════════════════════════════════════════════════════════════════
{
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(/async function carregarArrastoAnterior\(/.test(html), 'falta carregarArrastoAnterior');
  const trecho = html.slice(html.indexOf('async function carregarArrastoAnterior('),
                            html.indexOf('async function carregarArrastoAnterior(') + 1800);
  assert.ok(/<\s*mesAtual|mes <|\.id\)/.test(trecho),
    'tem que recortar só os meses ANTERIORES ao aberto');
  ok('o arrasto lê só meses anteriores');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node scripts/smoke-vendido-x-pago.js
```

Esperado: `AssertionError: falta carregarArrastoAnterior`

- [ ] **Step 3: Write minimal implementation**

Em `index.html`, depois de `blocoVendidoXPago`:

```js
    /**
     * O que foi vendido em meses ANTERIORES e até hoje não virou dinheiro.
     *
     * É o que merece conversa: a venda de ontem ainda não teve tempo de ser
     * cobrada; a de dois meses atrás, teve. Por isso vive num bloco separado,
     * e não somada com o mês aberto.
     *
     * ⚠️ Não lê nada anterior a 2026-08: julho e antes foram calculados com a
     * numeração do TecnoFit, e `codigosPagos` não tem código da Pacto — todas
     * as vendas apareceriam como paradas para sempre. Ver o desenho em
     * docs/superpowers/specs/2026-09-07-painel-vendido-x-pago-design.md.
     *
     * @returns {Array} vendas em aberto, cada uma com `_mes` e `_diasParada`
     */
    async function carregarArrastoAnterior(unitId, mesAtual) {
      const PRIMEIRO_MES = '2026-08';
      const snap = await db.collection('periodos').where('unitId', '==', unitId).get();
      const docs = [];
      const pagos = [];
      snap.forEach(d => {
        const m = String(d.id).match(/(\d{4}-\d{2})$/);
        (d.data().codigosPagos || []).forEach(c => pagos.push(c));
        if (m && m[1] >= PRIMEIRO_MES && m[1] < mesAtual) docs.push({ mes: m[1], ...d.data() });
      });

      const fora = [];
      const hoje = new Date();
      docs.sort((a, b) => a.mes.localeCompare(b.mes)).forEach(p => {
        const r = VendasAguardando.cruzar(p.vendasDoMes || [], pagos, []);
        r.aguardando.forEach(v => {
          const [dd, mm, aa] = String(v.data || '').split('/');
          const quando = aa ? new Date(Number(aa), Number(mm) - 1, Number(dd)) : null;
          fora.push({
            ...v, _mes: p.mes,
            _diasParada: quando ? Math.round((hoje - quando) / 86400000) : null,
          });
        });
      });
      return fora;
    }
```

> **Nota:** o arrasto usa `clientesPagantes` vazio de propósito. Esse terceiro grupo ("conferir") depende dos itens do mês em questão, e aqui interessa só a pergunta binária "entrou dinheiro neste contrato, em qualquer mês?". Uma venda que o cliente pagou por outro contrato aparece no arrasto e a gestão resolve olhando — melhor aparecer a mais que sumir.

- [ ] **Step 4: Run test to verify it passes**

```bash
node scripts/smoke-vendido-x-pago.js
```

Esperado: `10/10 casos passaram.`

- [ ] **Step 5: Commit**

```bash
git add index.html scripts/smoke-vendido-x-pago.js
git commit -m "feat(comissoes): arrasto de vendas de meses anteriores"
```

---

### Task 6: Plugar nas duas homes

**Files:**
- Modify: `index.html` — `renderAdminDashboard` (~6098) e `loadVendorPeriod` (~6740)
- Test: `scripts/smoke-vendido-x-pago.js`

- [ ] **Step 1: Write the failing test**

Acrescentar em `scripts/smoke-vendido-x-pago.js`, antes da linha final:

```js
// ════════════════════════════════════════════════════════════════════
// 11. As duas homes mostram o bloco, e a vendedora só vê o dela
// ════════════════════════════════════════════════════════════════════
{
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  const corte = i => html.slice(i, i + 9000);
  const gestao = corte(html.indexOf('function renderAdminDashboard('));
  const vendedora = corte(html.indexOf('async function loadVendorPeriod('));

  assert.ok(/vendidoXPagoHome/.test(gestao), 'a home da gestão precisa do espaço do bloco');
  assert.ok(/vendidoXPagoVendedora/.test(vendedora), 'a home da vendedora também');
  assert.ok(/preencherVendidoXPago\(/.test(gestao) && /preencherVendidoXPago\(/.test(vendedora),
    'as duas precisam chamar o preenchedor');

  const preench = html.slice(html.indexOf('async function preencherVendidoXPago('),
                             html.indexOf('async function preencherVendidoXPago(') + 1400);
  assert.ok(/soDe/.test(preench), 'o preenchedor precisa saber de quem é a visão');
  assert.ok(/daVendedora\(/.test(preench),
    'a visão da vendedora tem que filtrar pelas vendas dela, não mostrar as das colegas');
  ok('as duas homes mostram o bloco, e o da vendedora é filtrado');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node scripts/smoke-vendido-x-pago.js
```

Esperado: `AssertionError: a home da gestão precisa do espaço do bloco`

- [ ] **Step 3: Write minimal implementation**

**(a)** Em `index.html`, depois de `carregarArrastoAnterior`, acrescentar o preenchedor:

```js
    /**
     * Desenha o bloco num elemento. O `renderAdminDashboard` é síncrono, então
     * a home deixa o espaço vazio e este preenchedor chega depois.
     * @param {string} elId  @param {string} periodId
     * @param {string} soDe  nome da vendedora; '' = visão da gestão
     */
    async function preencherVendidoXPago(elId, periodId, soDe) {
      const el = document.getElementById(elId);
      if (!el || !periodId) return;
      try {
        const d = await carregarVendidoXPago(periodId);
        let dados = d, arrasto = 0;
        if (d.temLista && soDe) {
          // A vendedora vê só o que é dela — inclusive a venda dividida.
          const cruzado = {
            pagas: VendasAguardando.daVendedora(d.cruzado.pagas, soDe),
            aguardando: VendasAguardando.daVendedora(d.cruzado.aguardando, soDe),
            conferir: VendasAguardando.daVendedora(d.cruzado.conferir, soDe),
          };
          dados = { ...d, cruzado, resumo: VendasAguardando.resumo(cruzado) };
        }
        if (d.temLista && d.year && d.month) {
          const mes = d.year + '-' + String(d.month).padStart(2, '0');
          let velhas = await carregarArrastoAnterior(d.unitId, mes);
          if (soDe) velhas = VendasAguardando.daVendedora(velhas, soDe);
          arrasto = velhas.length;
        }
        el.innerHTML = blocoVendidoXPago(dados, { soDe, arrasto });
      } catch (e) {
        el.innerHTML = '';   // o painel é acessório: não pode derrubar a home
        console.error('[vendidoXPago]', e);
      }
    }
```

**(b)** Em `renderAdminDashboard`, trocar a linha que hoje é:

```js
        let html = avisoSoVendas + `
```

por:

```js
        let html = avisoSoVendas + '<div id="vendidoXPagoHome"></div>' + `
```

e, ao fim da função, **logo depois** da linha `document.getElementById('dashboardContent').innerHTML = html;` (hoje linha ~6342), acrescentar:

```js
        // O bloco chega depois: `renderAdminDashboard` é síncrono e a leitura
        // do banco não é. Mesmo padrão de `loadVendorItems`/`loadVendorHistory`.
        preencherVendidoXPago('vendidoXPagoHome', periodId, '');
```

**(c)** Em `loadVendorPeriod`, na `// ── Stats row ──`, trocar:

```js
      // ── Stats row ──
      html += `<div class="stats-row">
```

por:

```js
      html += '<div id="vendidoXPagoVendedora"></div>';

      // ── Stats row ──
      html += `<div class="stats-row">
```

e, no fim da função, **logo depois** de `el.innerHTML = html;` (hoje linha ~7003, ao lado de `loadVendorItems(myName);`), acrescentar:

```js
      preencherVendidoXPago('vendidoXPagoVendedora', periodId, myName);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node scripts/smoke-vendido-x-pago.js
```

Esperado: `11/11 casos passaram.`

- [ ] **Step 5: Commit**

```bash
git add index.html scripts/smoke-vendido-x-pago.js
git commit -m "feat(comissoes): bloco vendido x pago nas duas homes"
```

---

### Task 7: A tabela por vendedora e o arrasto na aba "A receber"

**Files:**
- Modify: `index.html` — `renderAReceberTab`
- Test: `scripts/smoke-vendido-x-pago.js`

- [ ] **Step 1: Write the failing test**

Acrescentar em `scripts/smoke-vendido-x-pago.js`, antes da linha final:

```js
// ════════════════════════════════════════════════════════════════════
// 12. A aba: cabeçalho, tabela por vendedora e arrasto
// ════════════════════════════════════════════════════════════════════
{
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const aba = html.slice(html.indexOf('async function renderAReceberTab('),
                         html.indexOf('async function renderAReceberTab(') + 9000);

  assert.ok(/blocoVendidoXPago\(/.test(aba), 'a aba mostra o mesmo cabeçalho da home');
  assert.ok(/tabelaPorVendedora\(/.test(aba), 'a aba mostra a tabela por vendedora');
  assert.ok(/carregarArrastoAnterior\(/.test(aba), 'e o arrasto de meses anteriores');

  const tab = html.slice(html.indexOf('function tabelaPorVendedora('),
                         html.indexOf('function tabelaPorVendedora(') + 2600);
  assert.ok(/soDe/.test(tab), 'a tabela comparativa é só da gestão');
  assert.ok(/naoComissionado/.test(tab), 'quem não recebe comissão sai marcado e sem %');
  assert.ok(/fechado/.test(tab), 'o % só aparece em mês fechado');
  ok('a aba tem cabeçalho, tabela por vendedora e arrasto');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node scripts/smoke-vendido-x-pago.js
```

Esperado: `AssertionError: a aba mostra o mesmo cabeçalho da home`

- [ ] **Step 3: Write minimal implementation**

**(a)** Em `index.html`, depois de `blocoVendidoXPago`, acrescentar:

```js
    /**
     * Vendido × pago por pessoa. Só a gestão vê — a vendedora não vê o número
     * das colegas, que é o padrão do sistema.
     *
     * ⚠️ A soma da coluna "vendidas" é MAIOR que o total do mês quando existe
     * venda dividida: ela conta para as duas, porque a comissão dela é
     * dividida. Está certo, e a nota no rodapé diz isso.
     */
    function tabelaPorVendedora(porVendedora, fechado, soDe) {
      if (soDe) return '';
      const linhas = Object.entries(porVendedora || {}).sort((a, b) => b[1].vendidas - a[1].vendidas);
      if (!linhas.length) return '';
      return `<div class="table-wrap" style="margin-bottom:18px">
        <table style="width:100%">
          <thead><tr>
            <th>Vendedora</th>
            <th style="text-align:right">Vendidas</th>
            <th style="text-align:right">Pagas</th>
            <th style="text-align:right">Aguardando</th>
            <th style="text-align:right">Conferir</th>
            ${fechado ? '<th style="text-align:right">Convertido</th>' : ''}
          </tr></thead>
          <tbody>
            ${linhas.map(([nome, v]) => `<tr>
              <td style="font-weight:600">${nome}${v.naoComissionado
                ? ' <span style="font-size:10px;color:var(--text3);font-weight:400">(não comissionado)</span>' : ''}</td>
              <td style="text-align:right">${v.vendidas}</td>
              <td style="text-align:right;color:var(--green)">${v.pagas}</td>
              <td style="text-align:right;color:${v.aguardando ? 'var(--orange)' : 'var(--text3)'}">${v.aguardando}</td>
              <td style="text-align:right;color:${v.conferir ? 'var(--yellow)' : 'var(--text3)'}">${v.conferir}</td>
              ${fechado ? `<td style="text-align:right">${v.naoComissionado ? '—'
                : Math.round((v.pagas / v.vendidas) * 100) + '%'}</td>` : ''}
            </tr>`).join('')}
          </tbody>
        </table>
        <div style="font-size:11px;color:var(--text3);margin-top:8px">
          Venda dividida conta para as duas vendedoras — por isso a coluna soma mais que o total do mês.
          ${fechado ? '' : 'A coluna de conversão aparece quando o mês fecha: no mês corrente a cobrança ainda está caindo.'}
        </div>
      </div>`;
    }
```

**(b)** Em `renderAReceberTab`, logo depois de `const r = dados.cruzado;`, acrescentar:

```js
        const mesDoPeriodo = dados.year + '-' + String(dados.month).padStart(2, '0');
        let velhas = await carregarArrastoAnterior(dados.unitId, mesDoPeriodo);
        if (soDe) velhas = VendasAguardando.daVendedora(velhas, soDe);
        const cabecalho = blocoVendidoXPago(
          soDe ? { ...dados, resumo: VendasAguardando.resumo({
            pagas: VendasAguardando.daVendedora(r.pagas, soDe),
            aguardando: VendasAguardando.daVendedora(r.aguardando, soDe),
            conferir: VendasAguardando.daVendedora(r.conferir, soDe),
          }) } : dados,
          { soDe, arrasto: velhas.length });
        const tabela = tabelaPorVendedora(dados.porVendedora, dados.fechado, soDe);
        const blocoArrasto = !velhas.length ? '' : `
          <div style="background:var(--red-bg);border:1px solid var(--red);border-radius:10px;padding:16px;margin:18px 0">
            <div style="font-size:13px;font-weight:700;margin-bottom:4px">
              🕰️ ${velhas.length} venda(s) arrastando de meses anteriores
            </div>
            <div style="font-size:12px;color:var(--text2);margin-bottom:10px">
              Fechadas antes deste mês e até hoje sem pagamento identificado. São estas que merecem conversa.
            </div>
            <div style="font-size:12px">
              ${velhas.map(v => `<div style="padding:3px 0">• <strong>${v.cliente}</strong> — contrato ${v.contrato} · ${v._mes} · ${v._diasParada != null ? v._diasParada + ' dias parada' : 'sem data'}${v.vendedores.length ? ' · ' + v.vendedores.join(', ') : ''}</div>`).join('')}
            </div>
          </div>`;
```

**(c)** No `el.innerHTML` final de `renderAReceberTab`, trocar a primeira linha do template:

```js
        el.innerHTML = `
          ${!lista.length ? blocoConferir : ''}
```

por:

```js
        el.innerHTML = `
          ${cabecalho}
          ${tabela}
          ${blocoArrasto}
          ${!lista.length ? blocoConferir : ''}
```

**(d)** No caminho de saída antecipada "tudo pago" (o bloco verde `✅`), trocar:

```js
          el.innerHTML = `
            <div style="background:var(--green-bg);
```

por:

```js
          el.innerHTML = cabecalho + tabela + blocoArrasto + `
            <div style="background:var(--green-bg);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node scripts/smoke-vendido-x-pago.js && node scripts/smoke-vendas-aguardando.js
```

Esperado: `12/12 casos passaram.` e `20/20 casos passaram.`

- [ ] **Step 5: Commit**

```bash
git add index.html scripts/smoke-vendido-x-pago.js
git commit -m "feat(comissoes): tabela por vendedora e arrasto na aba A receber"
```

---

### Task 8: Suíte, cache-buster e homologação no staging

**Files:**
- Modify: `index.html` (bump do `?v=`)
- Test: suíte inteira

- [ ] **Step 1: Rodar a suíte inteira**

```bash
for f in scripts/smoke-*.js; do case "$f" in *smoke-9.js) continue;; esac; node "$f" >/dev/null 2>&1 || echo "FALHOU: $f"; done; echo fim
```

Esperado: só `fim`, sem nenhum `FALHOU`.

- [ ] **Step 2: Bump do cache-buster**

Em `index.html`, trocar as quatro ocorrências de `?v=20260907` por `?v=` seguido da data de hoje (formato `AAAAMMDD`). Sem isso o navegador serve o JS antigo depois do deploy e o painel não aparece — `smoke-upload-pacto-tela.js` falha se algum dos quatro perder o `?v=`, mas não sabe se a data mudou.

- [ ] **Step 3: Publicar no staging e conferir no navegador**

```bash
firebase deploy --only hosting
```

Depois, no navegador, na página do staging, rodar no console:

```js
typeof carregarVendidoXPago === 'function' &&
typeof blocoVendidoXPago === 'function' &&
typeof tabelaPorVendedora === 'function' &&
blocoVendidoXPago({temLista:false, year:2026, month:9, fechado:false}, {}).includes('lista de vendas')
```

Esperado: `true`, e nenhum erro no console.

- [ ] **Step 4: Homologar contra o Firestore do staging**

Conferir que os números da tela batem com os do banco:

```bash
node scripts/conferir-listas-vendedoras.js
```

E, com o staging aberto no navegador, abrir o Dashboard de agosto e a aba "A receber" e conferir que o cabeçalho, a tabela e o arrasto mostram o mesmo número.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "chore(comissoes): bump do cache-buster do painel vendido x pago"
```

---

### Task 9: Produção

- [ ] **Step 1: Pedir o OK explícito ao Rafael**

Regra 7 do `CLAUDE.md`: produção só depois de homologação completa no staging, com OK explícito. Mostrar o que foi homologado e o que ainda não foi clicado por gente.

- [ ] **Step 2: Publicar**

```bash
git push origin main
```

(É o GitHub Pages que serve o usuário — `firebase deploy --only hosting` publica o staging, não a produção.)

- [ ] **Step 3: Conferir no ar**

```bash
curl -s "https://rafaelmayerbrasil.github.io/crosstrainer-comissoes/index.html" | grep -c "vendidoXPagoHome"
```

Esperado: `1` ou mais. Se vier `0`, o GitHub Pages ainda está publicando — esperar e repetir.

- [ ] **Step 4: Registrar a sessão**

Atualizar `CONTEXTO_SESSAO.md` com o que entrou, o que foi homologado e o que **não** foi clicado por gente. Commitar.

---

## Números reais para conferir a implementação

Depois de plugado, o painel tem que mostrar exatamente isto em produção (medido em 07/09/2026):

| período | vendidas | pagas | aguardando | conferir |
|---|---:|---:|---:|---:|
| `cp_2026-08` | 74 | 68 | 4 | 2 |
| `pp_2026-08` | 59 | 43 | 16 | 0 |
| `cp_2026-09` | 14 | 0 | 14 | 0 |
| `pp_2026-09` | 11 | 0 | 11 | 0 |

Tabela por vendedora, Príncipe/agosto: Kali 21/14 (67%) · Rodrigo 19/13 *(não comissionado)* · Bárbara 12/9 (75%) · Erica 5/3 (60%) · Francini 3/3 (100%) · Benny 1/1 *(não comissionado)*.

Se algum número divergir, o problema é a implementação, não o dado — estes saíram de `VendasAguardando.cruzar` contra o Firestore de produção.
