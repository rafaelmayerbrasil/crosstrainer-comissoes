# API da Pacto como fonte oficial (opção A): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a gestão atualiza o mês das comissões com um clique ("Atualizar pela Pacto"), a partir do que a busca diária já trouxe da API, com vendedora do Campeche, balcão e degustação grátis. A planilha fica como plano B.

**Architecture:** a busca das 4h (`functions/pacto-sombra.js`) passa a usar também o **gateway** com a credencial de cada unidade: `contratos/{n}` dá a consultora e acha a degustação pela numeração, e `relFaturamentoRecebido/vendas` dá o balcão. Tudo continua virando linha no formato do export. Na tela, `handleFile` é dividido e o botão novo entrega as linhas da API ao **mesmo** caminho do arquivo (tradutor → motor → prévia → confirmar). `commission.js` não muda.

**Tech Stack:** HTML/JS vanilla, Firebase Functions v2 (Node 22), Firestore, testes em `node scripts/smoke-*.js` com banco falso (`scripts/_fake-firestore.js`) e Pacto falsa.

**Desenho:** `docs/superpowers/specs/2026-09-30-api-pacto-oficial-design.md` (ler antes).

**Regras do projeto que valem aqui:**
- Branch nova `api-pacto-oficial` **a partir de `renovacoes-metas-bonus`** (traz os secrets `PACTO_API_KEY_CP/PP` e o cliente do gateway).
- Todo módulo puro existe na raiz **e** em `functions/`, idênticos. O smoke falha se divergirem.
- `index.html`: editar **só com a ferramenta Edit** (nunca `String.replace` com `$'` no texto; ver memória `replace-com-cifrao-duplica-arquivo`). Depois de cada edição, conferir que existe **uma** `</html>` e que o arquivo tem ~12.9 mil linhas.
- Nada de CPF em disco, log ou banco: do gateway saem só os campos da lista branca.
- Staging é o padrão do Firebase. Produção só com o OK do Rafael.

---

## Mapa de arquivos

| Arquivo | O que muda |
|---|---|
| `functions/pacto-gateway-cliente.js` (novo) | Cliente HTTP do gateway: `contrato(n)`, `vendasDoDia(dia)`. Só leitura. |
| `pacto-api-linhas.js` + `functions/pacto-api-linhas.js` | CP passa a usar a consultora; `contratoDoGateway`, `linhaDeDegustacao`, `linhasDeBalcao`, `soPreenchidos` |
| `functions/pacto-sombra.js` | `buscarDia` completa a consultora e o balcão pelo gateway; `varrerContratosNovos`; `buscar` recebe `clientesGw` |
| `functions/renovacoes-montar.js` | gravação do caderninho com merge (não apaga consultora) |
| `functions/index.js` | secrets e clientes do gateway na busca das 4h e no botão manual; parâmetro `varrerDesde` |
| `firestore.rules` | `pacto_degustacoes`: leitura admin, escrita ninguém |
| `pacto-sombra-comparacao.js` | `compararVendedora` também no CP |
| `upload-pela-api.js` (novo, raiz) | Pura: monta o mês a partir dos dias e das degustações, e decide se trava |
| `index.html` | `handleFile` dividido em `processarPlanilha`; botão "Atualizar pela Pacto"; planilha recolhida; `origem`/`dadosAte` no período |
| `scripts/smoke-pacto-gateway-cliente.js` (novo) | cliente do gateway |
| `scripts/smoke-pacto-api-linhas.js` | casos novos |
| `scripts/smoke-pacto-sombra-busca.js` | casos novos |
| `scripts/smoke-upload-pela-api.js` (novo) | módulo puro + ganchos no `index.html` |
| `scripts/validar-regras-pacto-sombra.js` | caso de `pacto_degustacoes` |
| `scripts/comparar-api-oficial.js` (novo) | validação só de leitura contra produção |
| `manual-admin.html` | seção "Atualizar pela Pacto" |

---

### Task 0: Branch

- [ ] **Step 1:** `git switch -c api-pacto-oficial` (a partir de `renovacoes-metas-bonus`, árvore limpa).
- [ ] **Step 2:** Rodar a suíte inteira para ter a linha de base:
  `for f in scripts/smoke-*.js; do node "$f" >/dev/null 2>&1 || echo "FALHOU $f"; done`
  Esperado: só `smoke-9.js` (falha antiga, pede `--project`).

---

### Task 1: Cliente do gateway (`functions/pacto-gateway-cliente.js`)

**Files:** Create `functions/pacto-gateway-cliente.js`, `scripts/smoke-pacto-gateway-cliente.js`

Contrato da função:
- `criarClienteGateway({ fetch, credencial, base = GW, pausaMs = 1250, dormir })`
- `contrato(codigo)` → `{ situacao: 'ok', dados: null }` quando o número não existe (200 com `content` vazio). Quando existe → `{ situacao:'ok', dados: { codigo, consultor, lancou, plano, valor, tipo, situacao, lancamento: 'DD/MM/AAAA', vigenciaDe: 'DD/MM/AAAA', vigenciaAte: 'DD/MM/AAAA', cliente: { codigo, nome } } }`. **Lista branca**: nada de `cpf`, `pessoa`, `empresa`.
- `vendasDoDia(dia 'AAAA-MM-DD')` → `{ situacao:'ok', dados: [{ produto, valor, cliente, contrato, dia:'DD/MM/AAAA' }] }`. Usa `inicio=DD/MM&fim=DD/MM` (sem ano).
- Pausa entre chamadas (nunca a primeira). `falhou` tenta 1× de novo; `limite` espera 2500 ms e tenta 1× de novo. Usa `classificar` de `pacto-api-cliente.js` (credencial nunca no motivo).
- Datas `ms` da Pacto → dia em São Paulo (UTC−3): `new Date(ms - 3*3600e3).toISOString().slice(0,10)` → `DD/MM/AAAA`.

- [ ] **Step 1: teste que falha** (`scripts/smoke-pacto-gateway-cliente.js`), com Pacta falsa no padrão de `smoke-pacto-sombra-busca.js`:

```js
'use strict';
// Roda: node scripts/smoke-pacto-gateway-cliente.js — Pacto FALSA, dados inventados.
const assert = require('assert');
const path = require('path');
const { criarClienteGateway } = require(path.join(__dirname, '..', 'functions', 'pacto-gateway-cliente.js'));
let n = 0; const ok = m => console.log('✓ ' + (++n) + '. ' + m);
const CRED = 'cred-falsa-123';
function pacto(rotas) {
  const chamadas = [];
  const fetch = async (url, opts) => {
    chamadas.push({ url, opts });
    for (const [re, r] of rotas) if (re.test(url)) {
      const x = typeof r === 'function' ? r(chamadas.length) : r;
      return { status: x.status || 200, text: async () => JSON.stringify(x.body) };
    }
    return { status: 404, text: async () => 'nao previsto' };
  };
  return { fetch, chamadas };
}
const MS_25_08 = Date.UTC(2026, 7, 25, 20, 59, 20); // 17:59 em SP
const bruto = { codigo: 4638, tipo: 'MA', situacao: 'IN', descricaoPlano: 'MÊS DEGUSTAÇÃO LIVRE.', valor: 0,
  dataLancamento: MS_25_08, vigenciaDe: Date.UTC(2026, 7, 25, 3), vigenciaAte: Date.UTC(2026, 8, 24, 3),
  nomeConsultorReponsavel: 'CONSULTORA UM', responsavelLancamento: 'CONSULTORA UM',
  pessoaDTO: { codigo: 77, nome: 'CLIENTE FICTICIO' }, consultorResponsavel: { pessoa: { cpf: '999.888.777-66' } } };
(async () => {
  {
    const p = pacto([[/\/contratos\/4638$/, { body: { content: bruto } }], [/\/contratos\/4639$/, { body: { content: {} } }]]);
    const c = criarClienteGateway({ fetch: p.fetch, credencial: CRED, pausaMs: 0 });
    const r = await c.contrato(4638);
    assert.strictEqual(r.situacao, 'ok');
    assert.deepStrictEqual(r.dados, { codigo: '4638', consultor: 'CONSULTORA UM', lancou: 'CONSULTORA UM',
      plano: 'MÊS DEGUSTAÇÃO LIVRE.', valor: 0, tipo: 'MA', situacao: 'IN', lancamento: '25/08/2026',
      vigenciaDe: '25/08/2026', vigenciaAte: '24/09/2026', cliente: { codigo: '77', nome: 'CLIENTE FICTICIO' } });
    assert.ok(!JSON.stringify(r).includes('999.888'), 'CPF vazou');
    assert.strictEqual(p.chamadas[0].opts.headers.Authorization, CRED);
    assert.strictEqual(p.chamadas[0].opts.headers.empresaId, '1');
    const vazio = await c.contrato(4639);
    assert.deepStrictEqual(vazio, { situacao: 'ok', dados: null });
    ok('contrato: lista branca (sem CPF), datas em SP, número inexistente = dados null');
  }
  {
    const p = pacto([[/vendas\?inicio=25\/08&fim=25\/08$/, { body: { produtos: [
      { produto: 'ÁGUA SEM GÁS', listaVendas: [{ dataHoraVenda: '25/08/2026 10:00', valor: 5, nome: 'CLIENTE A', codigoContrato: 0 }] },
      { produto: 'PLANO', listaVendas: [{ dataHoraVenda: '25/08/2026 11:00', valor: 199, nome: 'CLIENTE B', codigoContrato: 4636 }] }] } } }]]);
    const c = criarClienteGateway({ fetch: p.fetch, credencial: CRED, pausaMs: 0 });
    const r = await c.vendasDoDia('2026-08-25');
    assert.strictEqual(r.situacao, 'ok');
    assert.deepStrictEqual(r.dados, [
      { produto: 'ÁGUA SEM GÁS', valor: 5, cliente: 'CLIENTE A', contrato: '0', dia: '25/08/2026' },
      { produto: 'PLANO', valor: 199, cliente: 'CLIENTE B', contrato: '4636', dia: '25/08/2026' }]);
    ok('vendas do dia: janela de um dia em DD/MM, lista achatada por produto');
  }
  {
    const pausas = [];
    const p = pacto([[/contratos/, n => n === 1 ? { status: 429, body: {} } : { body: { content: {} } }]]);
    const c = criarClienteGateway({ fetch: p.fetch, credencial: CRED, pausaMs: 1250, dormir: async ms => pausas.push(ms) });
    const r = await c.contrato(1);
    assert.strictEqual(r.situacao, 'ok');
    assert.deepStrictEqual(pausas, [2500], 'limite: espera 2,5 s e tenta uma vez');
    await c.contrato(2);
    assert.deepStrictEqual(pausas, [2500, 1250], 'pausa entre chamadas');
    ok('limite por segundo: espera e tenta uma vez; pausa de 1,25 s entre chamadas');
  }
  console.log('\n✅ smoke-pacto-gateway-cliente: ' + n);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2:** `node scripts/smoke-pacto-gateway-cliente.js`. Esperado: FAIL (`Cannot find module`).
- [ ] **Step 3: implementar** `functions/pacto-gateway-cliente.js`:

```js
'use strict';
// Cliente do GATEWAY da Pacto com a credencial POR UNIDADE — só LEITURA.
// Desenho: docs/superpowers/specs/2026-09-30-api-pacto-oficial-design.md §1–2
// Rotas: GET /contratos/{n} (consultora, quem lançou, plano, valor) e
// GET /importacao/psec/relFaturamentoRecebido/vendas (balcão). A credencial pode
// gravar e apagar na Pacto: nenhuma rota que grava entra aqui.
// ⚠️ A resposta do contrato traz CPF (da consultora e do aluno): só a lista
//    branca de `lerContrato` sai daqui. A credencial nunca vai para o motivo.
const { classificar } = require('./pacto-api-cliente.js');
const GW = 'https://apigw.pactosolucoes.com.br';

/** ms da Pacto → 'DD/MM/AAAA' em São Paulo (UTC−3 o ano todo desde 2019) */
function diaSP(ms) {
  if (typeof ms !== 'number') return '';
  const [a, m, d] = new Date(ms - 3 * 3600e3).toISOString().slice(0, 10).split('-');
  return d + '/' + m + '/' + a;
}

function lerContrato(c) {
  if (!c || c.codigo == null) return null;
  const p = c.pessoaDTO || {};
  return {
    codigo: String(c.codigo),
    consultor: c.nomeConsultorReponsavel || null,
    lancou: c.responsavelLancamento || null,
    plano: c.descricaoPlano || '',
    valor: Number(c.valor) || 0,
    tipo: c.tipo || '',
    situacao: c.situacao || '',
    lancamento: diaSP(c.dataLancamento),
    vigenciaDe: diaSP(c.vigenciaDe),
    vigenciaAte: diaSP(c.vigenciaAteAjustada || c.vigenciaAte),
    cliente: { codigo: p.codigo == null ? '' : String(p.codigo), nome: p.nome || '' },
  };
}

function criarClienteGateway({ fetch, credencial, base = GW, pausaMs = 1250, dormir }) {
  if (typeof fetch !== 'function') throw new Error('criarClienteGateway: fetch é obrigatório');
  if (!credencial) throw new Error('criarClienteGateway: credencial é obrigatória');
  const esperar = dormir || (ms => new Promise(r => setTimeout(r, ms)));
  let chamadas = 0;

  async function get(caminho, esperaMinima) {
    const espera = Math.max(chamadas > 0 ? pausaMs : 0, esperaMinima || 0);
    if (espera > 0) await esperar(espera);
    chamadas++;
    let res, texto;
    try {
      res = await fetch(base + caminho, { method: 'GET', headers: { Authorization: credencial, empresaId: '1', Accept: 'application/json' } });
      texto = await res.text();
    } catch (e) {
      return { situacao: 'falhou', motivo: 'rede: ' + String(e && e.message || e).split(credencial).join('<credencial>') };
    }
    return classificar(res.status, texto, credencial);
  }
  async function comRepeticao(caminho) {
    let r = await get(caminho);
    if (r.situacao === 'falhou') r = await get(caminho);
    else if (r.situacao === 'limite') r = await get(caminho, 2500);
    return r;
  }

  return {
    get chamadas() { return chamadas; },
    async contrato(codigo) {
      const r = await comRepeticao('/contratos/' + encodeURIComponent(String(codigo)));
      if (r.situacao !== 'ok') return r;
      return { situacao: 'ok', dados: lerContrato(r.dados && r.dados.content) };
    },
    async vendasDoDia(dia) {
      const dm = dia.slice(8, 10) + '/' + dia.slice(5, 7);
      const r = await comRepeticao('/importacao/psec/relFaturamentoRecebido/vendas?inicio=' + dm + '&fim=' + dm);
      if (r.situacao !== 'ok') return r;
      const d = r.dados || {};
      if (d.status && d.status !== 'sucesso' && !Array.isArray(d.produtos)) return { situacao: 'falhou', motivo: 'vendas: ' + String(d.message || d.status).slice(0, 120) };
      const out = [];
      (d.produtos || []).forEach(p => (p.listaVendas || []).forEach(v => out.push({
        produto: p.produto || '', valor: Number(v.valor) || 0, cliente: v.nome || '',
        contrato: v.codigoContrato ? String(v.codigoContrato) : '0',
        dia: String(v.dataHoraVenda || '').slice(0, 10),
      })));
      return { situacao: 'ok', dados: out };
    },
  };
}

module.exports = { criarClienteGateway, lerContrato, diaSP, GW };
```

- [ ] **Step 4:** Rodar de novo. Esperado: `✅ smoke-pacto-gateway-cliente: 3`.
- [ ] **Step 5: commit** `feat(pacto): cliente do gateway por unidade (contrato e vendas do dia), só leitura`.

---

### Task 2: Conversor (`pacto-api-linhas.js`, as duas cópias)

**Files:** Modify `pacto-api-linhas.js` (depois `cp pacto-api-linhas.js functions/`), `scripts/smoke-pacto-api-linhas.js`

Mudanças:
1. Em `montar`: tirar a exceção do CP. Fica `const consultor = c && c.consultor;`, `put('consultor', consultor || '')` e o aviso de "sem consultora" **nas duas unidades**. Atualizar o comentário: desde 30/09 a consultora do CP vem do gateway.
2. `contratoDoGateway(g, unidade)` → o formato do caderninho (`limparContrato`) a partir do `lerContrato` do gateway: `{ codigo, unidade, situacaoContrato: {MA:'Matrícula',RE:'Rematrícula',RN:'Renovação'}[g.tipo] || '', nomePlano: g.plano, codigoPlano: null, vigenciaDe, vigenciaAte, numeroMeses: null, consultor, lancou, gw: true }`.
3. `soPreenchidos(c)` → cópia sem `consultor`/`lancou` nulos (para gravar com `merge:true` sem apagar).
4. `linhaDeDegustacao(g, unidade)` → uma linha do export (`TAMANHO_LINHA` posições) com nome, contrato, produto=plano=`g.plano`, situação, início/término, lançamento, valor `'0,00'`, forma `''`, empresa, consultor, `resp1 = g.lancou`.
5. `linhasDeBalcao({ vendas, linhas, unidade })` → `{ linhas: [...], avisos: [...] }`. Entra o que tem `contrato === '0'`, **não** é produto de contrato (`/^(PLANO|MATR[IÍ]CULA|QUITA[CÇ][AÃ]O|TAXA DE RENEGOCIA|1 AULA)/` sobre o `_norm`), valor > 0, e não bate com uma linha já existente de contrato 0 com o mesmo cliente (norm) + dia + valor (cada linha existente casa uma vez só). Linha: produto, nome, lançamento, valor, empresa. Contrato `'0'`, sem vendedora.

- [ ] **Step 1: casos no smoke** (acrescentar antes da conferência das cópias):

```js
{
  // CP com consultora no caderninho: a linha leva a consultora e quem lançou
  const resumo = { pagamentos: [{ codigo: 1, data: '10/09/2026 09:00:00', responsavelLancamento: 'RECEPCAO',
    aluno: { codigo: 5, nome: 'CLIENTE X' }, formas: [{ formaPagamento: 'PIX', valor: 100 }],
    parcelasPagas: [{ codigo: 11, codigoContrato: 7001, valor: 100 }] }] };
  const contratos = new Map([['7001', { codigo: '7001', nomePlano: 'PLANO X', situacaoContrato: 'Matrícula', vigenciaDe: '10/09/2026', vigenciaAte: '09/10/2026', numeroMeses: 1, consultor: 'CONSULTORA CP', lancou: 'CONSULTORA CP' }]]);
  const m = L.montar({ resumo, contratos, unidade: 'CP' });
  assert.strictEqual(m.linhas[0][L.COL.consultor], 'CONSULTORA CP');
  assert.strictEqual(m.linhas[0][L.COL.resp1], 'CONSULTORA CP');
  assert.ok(!m.avisos.some(a => /sem consultora/.test(a.motivo)));
  ok('CP: a consultora do caderninho entra na linha, como no PP');
}
{
  const g = { codigo: '4638', consultor: 'C UM', lancou: 'C UM', plano: 'MÊS DEGUSTAÇÃO LIVRE.', valor: 0, tipo: 'MA', situacao: 'IN',
    lancamento: '25/08/2026', vigenciaDe: '25/08/2026', vigenciaAte: '24/09/2026', cliente: { codigo: '77', nome: 'CLIENTE D' } };
  const c = L.contratoDoGateway(g, 'PP');
  assert.strictEqual(c.situacaoContrato, 'Matrícula'); assert.strictEqual(c.gw, true); assert.strictEqual(c.consultor, 'C UM');
  assert.deepStrictEqual(Object.keys(L.soPreenchidos({ a: 1, consultor: null, lancou: null })), ['a']);
  const l = L.linhaDeDegustacao(g, 'PP');
  assert.strictEqual(l.length, L.TAMANHO_LINHA);
  assert.strictEqual(l[L.COL.contrato], '4638'); assert.strictEqual(l[L.COL.valor], '0,00');
  assert.strictEqual(l[L.COL.plano], 'MÊS DEGUSTAÇÃO LIVRE.'); assert.strictEqual(l[L.COL.lancamento], '25/08/2026');
  // o próprio tradutor reconhece como degustação grátis
  const PA = require(path.join(raiz, 'pacto-adapter.js'));
  const d = PA.degustacoesGratis(L.comCabecalho([l]));
  assert.strictEqual((d['PP|2026-08'] || []).length, 1, JSON.stringify(d));
  ok('degustação do gateway vira linha que o tradutor reconhece como degustação grátis');
}
{
  const linhas = [(() => { const l = new Array(L.TAMANHO_LINHA).fill(''); l[L.COL.contrato] = '0'; l[L.COL.nome] = 'CLIENTE A'; l[L.COL.lancamento] = '25/08/2026'; l[L.COL.valor] = '5,00'; return l; })()];
  const vendas = [
    { produto: 'ÁGUA SEM GÁS', valor: 5, cliente: 'Cliente A', contrato: '0', dia: '25/08/2026' },   // já veio pelos pagamentos
    { produto: 'ÁGUA SEM GÁS', valor: 5, cliente: 'Cliente A', contrato: '0', dia: '25/08/2026' },   // segunda água: entra
    { produto: 'MONSTER', valor: 12, cliente: 'CLIENTE B', contrato: '0', dia: '25/08/2026' },
    { produto: 'PLANO', valor: 199, cliente: 'CLIENTE C', contrato: '4636', dia: '25/08/2026' },
    { produto: 'MATRÍCULA', valor: 50, cliente: 'CLIENTE C', contrato: '0', dia: '25/08/2026' },
  ];
  const b = L.linhasDeBalcao({ vendas, linhas, unidade: 'CP' });
  assert.deepStrictEqual(b.linhas.map(l => l[L.COL.produto] + ' ' + l[L.COL.valor]), ['ÁGUA SEM GÁS 5,00', 'MONSTER 12,00']);
  assert.strictEqual(b.linhas[0][L.COL.contrato], '0'); assert.strictEqual(b.linhas[0][L.COL.consultor], '');
  ok('balcão: entra o que falta, cada linha existente casa uma vez, plano e matrícula ficam de fora');
}
```

- [ ] **Step 2:** `node scripts/smoke-pacto-api-linhas.js`. Esperado: FAIL (CP sem consultora / funções inexistentes).
- [ ] **Step 3: implementar** em `pacto-api-linhas.js` (dentro do objeto, antes de `consolidarPorContrato`):

```js
  TIPO_SITUACAO: { MA: 'Matrícula', RE: 'Rematrícula', RN: 'Renovação' },

  /** Contrato lido do gateway (`lerContrato`) → formato do caderninho. Marca `gw`. */
  contratoDoGateway(g, unidade) {
    return {
      codigo: String(g.codigo), unidade,
      situacaoContrato: this.TIPO_SITUACAO[g.tipo] || '',
      nomePlano: g.plano || '', codigoPlano: null,
      vigenciaDe: g.vigenciaDe || '', vigenciaAte: g.vigenciaAte || '',
      numeroMeses: null, consultor: g.consultor || null, lancou: g.lancou || null, gw: true,
    };
  },

  /** Sem `consultor`/`lancou` nulos: gravado com merge, não apaga o que o gateway trouxe */
  soPreenchidos(c) {
    const o = { ...c };
    ['consultor', 'lancou'].forEach(k => { if (o[k] == null) delete o[k]; });
    return o;
  },

  /** Degustação grátis (contrato de valor zero) como linha do export */
  linhaDeDegustacao(g, unidade) {
    const l = new Array(this.TAMANHO_LINHA).fill('');
    const put = (k, v) => { l[this.COL[k]] = v == null ? '' : v; };
    put('matricula', g.cliente && g.cliente.codigo); put('nome', g.cliente && g.cliente.nome);
    put('resp1', g.lancou || ''); put('resp2', g.lancou || '');
    put('produto', g.plano); put('plano', g.plano); put('contrato', String(g.codigo));
    put('situacao', this.TIPO_SITUACAO[g.tipo] || ''); put('inicio', g.vigenciaDe); put('termino', g.vigenciaAte);
    put('lancamento', g.lancamento); put('valor', '0,00');
    put('empresa', this.EMPRESA[unidade] || ''); put('consultor', g.consultor || '');
    return l;
  },

  PRODUTO_DE_CONTRATO: /^(PLANO|MATRICULA|QUITACAO|TAXA DE RENEGOCIA|1 AULA)/,

  /**
   * Vendas de balcão do relatório de vendas que NÃO vieram nos pagamentos.
   * Cada linha já existente (contrato 0) casa uma venda só: duas águas iguais no
   * mesmo dia são duas vendas. Sem vendedora — o relatório não diz quem vendeu.
   */
  linhasDeBalcao({ vendas, linhas, unidade }) {
    const C = this.COL;
    const chave = (nome, dia, valor) => this._norm(nome) + '|' + dia + '|' + (Math.round(Number(valor) * 100));
    const existentes = new Map();
    (linhas || []).forEach(l => {
      if (String(l[C.contrato] || '0') !== '0') return;
      const k = chave(l[C.nome], l[C.lancamento], this._valor(l[C.valor]));
      existentes.set(k, (existentes.get(k) || 0) + 1);
    });
    const saida = [], avisos = [];
    (vendas || []).forEach(v => {
      if (String(v.contrato || '0') !== '0') return;
      if (this.PRODUTO_DE_CONTRATO.test(this._norm(v.produto))) return;
      if (!(Number(v.valor) > 0)) return;
      const k = chave(v.cliente, v.dia, v.valor);
      if (existentes.get(k) > 0) { existentes.set(k, existentes.get(k) - 1); return; }
      const l = new Array(this.TAMANHO_LINHA).fill('');
      l[C.nome] = v.cliente || ''; l[C.produto] = v.produto || ''; l[C.contrato] = '0';
      l[C.lancamento] = v.dia; l[C.valor] = this.valorBR(v.valor); l[C.empresa] = this.EMPRESA[unidade] || '';
      saida.push(l);
    });
    return { linhas: saida, avisos };
  },
```

e trocar em `montar` o bloco `// No Campeche a Pacto não entrega consultora…` por:

```js
          // Consultora do caderninho — no Campeche vem do gateway desde 30/09/2026
          // (`contratos/{n}` com a credencial da unidade). NÃO usar quem lançou o
          // pagamento no lugar dela: daria nome errado calado.
          const consultor = c && c.consultor;
          put('consultor', consultor || '');
          if (!consultor) avisos.push({ motivo: 'sem consultora conhecida para o contrato', contrato, recibo: p.codigo });
```

- [ ] **Step 4:** `cp pacto-api-linhas.js functions/pacto-api-linhas.js` e rodar `node scripts/smoke-pacto-api-linhas.js` e `node scripts/smoke-pacto-sombra-ponta-a-ponta.js`, `smoke-pacto-termometro.js`, `smoke-pacto-sombra-comparacao.js`. Esperado: tudo verde. Se um caso antigo afirmava "CP sem consultora", atualizar esse caso para a regra nova (e só esse).
- [ ] **Step 5: commit** `feat(pacto-api-linhas): consultora do CP, degustação e balcão do gateway`.

---

### Task 3: Busca diária usa o gateway (`functions/pacto-sombra.js`)

**Files:** Modify `functions/pacto-sombra.js`, `scripts/smoke-pacto-sombra-busca.js`

Mudanças em `buscarDia({ db, cliente, gw, unidade, dia, agora })`:
1. Toda gravação no caderninho vira `set(L.soPreenchidos(x), { merge: true })`.
2. Depois de montar o `Map contratos`, para cada contrato **sem consultora e sem `gw: true`**, se houver `gw`: `const r = await gw.contrato(codigo)`. Se `ok` e `dados`: junta `consultor`, `lancou` e `gw: true` ao contrato e grava com merge. Se `limite` ou `credencial_recusada`: para de consultar o gateway nesse dia e empurra um aviso `{ motivo: 'gateway: ' + situacao }`. Se `falhou`: segue para o próximo.
3. Balcão: se houver `gw` e o `dia` for do ano corrente (`dia.slice(0,4) === String(new Date().getFullYear())`, com uma função `anoCorrente` injetável para teste via `agoraAno`), `const v = await gw.vendasDoDia(dia)`. Com `ok`, `L.linhasDeBalcao({ vendas: v.dados, linhas: m.linhas, unidade })` e as linhas vão para o fim de `m.linhas`, com o valor somado a `totais.recebido` e em `totais.balcao`. Sem `ok`, aviso `'vendas de balcão: ' + motivo` (não derruba o dia).
4. Retorna também `maiorContrato` (o maior número dos contratos pagos do dia, numérico).

`buscar({ db, cliente, clientesGw, unidades, dias, agora, varrerDesde })` passa `gw: clientesGw && clientesGw[unidade]` e, no fim, para cada unidade com `gw`, chama `varrerContratosNovos` (Task 4) com `ate = maiorContrato + 30`.

- [ ] **Step 1: casos no smoke** (Pacto falsa com as rotas do núcleo **e** do gateway; `clientesGw` criado com `criarClienteGateway({ fetch, credencial, pausaMs: 0 })`):
  - CP: pagamento do contrato 7001 com o caderninho vazio → núcleo devolve o contrato sem consultora → gateway `contratos/7001` devolve `nomeConsultorReponsavel: 'CONSULTORA CP'` → a linha gravada no dia tem `CONSULTORA CP` na coluna consultor e o caderninho `CP_7001` tem `consultor`, `gw: true`, e **nenhum** campo `cpf`.
  - Segunda busca do mesmo dia: o gateway **não** é chamado de novo para o 7001 (contar chamadas de `/contratos/`).
  - O núcleo regravando o mesmo aluno (outro contrato do cliente) não apaga a consultora do 7001 (merge).
  - Balcão: `vendas?inicio=10/09&fim=10/09` com uma água de CLIENTE X → a linha de balcão aparece e `totais.balcao === 5`.
  - Gateway com 429 duas vezes → o dia é gravado `buscado`, com aviso `gateway: limite`.
- [ ] **Step 2:** rodar, ver falhar.
- [ ] **Step 3:** implementar as mudanças acima, sem mexer no resto da função.
- [ ] **Step 4:** `node scripts/smoke-pacto-sombra-busca.js` verde, mais os casos antigos.
- [ ] **Step 5: commit** `feat(pacto-sombra): consultora e balcão pelo gateway; caderninho gravado com merge`.

---

### Task 4: Varredura de contratos novos, com degustação (`functions/pacto-sombra.js`)

**Files:** Modify `functions/pacto-sombra.js`, `scripts/smoke-pacto-sombra-busca.js`

```js
const COL_SEQ = 'pacto_contratos_seq';
const COL_DEGUSTACOES = 'pacto_degustacoes';
const FOLGA_VARREDURA = 30;      // maior buraco medido na numeração: 18 (PP, set/2026)
const JANELA_INICIAL = 150;      // sem marca: volta ~1 mês de contratos

/**
 * Consulta pelo gateway os números de contrato desde o último varrido até `ate`.
 * Contrato achado → caderninho (com consultora). Degustação grátis → `pacto_degustacoes`.
 * A marca fica no MAIOR NÚMERO QUE EXISTE: número ainda não usado pode nascer amanhã.
 */
async function varrerContratosNovos({ db, gw, unidade, ate, desde, agora }) {
  const PA = require('./pacto-adapter.js');
  const quando = agora ? agora() : new Date().toISOString();
  const ref = db.collection(COL_SEQ).doc(unidade);
  const s = await ref.get();
  let n = desde != null ? Number(desde) : (s.exists ? s.data().ultimo + 1 : ate - JANELA_INICIAL);
  let ultimo = s.exists ? s.data().ultimo : null, achados = 0, degustacoes = 0, parouPor = null;
  for (; n <= ate; n++) {
    const r = await gw.contrato(n);
    if (r.situacao === 'limite' || r.situacao === 'credencial_recusada') { parouPor = r.situacao; break; }
    if (r.situacao !== 'ok' || !r.dados) continue;
    achados++;
    ultimo = Math.max(ultimo || 0, n);
    await db.collection(COL_CONTRATOS).doc(unidade + '_' + n).set({ ...L.contratoDoGateway(r.dados, unidade), atualizadoEm: quando }, { merge: true });
    const linha = L.linhaDeDegustacao(r.dados, unidade);
    const d = PA.degustacoesGratis(L.comCabecalho([linha]));
    const lista = Object.values(d).flat();
    if (r.dados.valor === 0 && lista.length) {
      degustacoes++;
      const [dd, mm, aa] = r.dados.lancamento.split('/');
      await db.collection(COL_DEGUSTACOES).doc(unidade + '_' + n).set({
        unidade, contrato: String(n), mes: aa + '-' + mm, dia: aa + '-' + mm + '-' + dd,
        degustacao: lista[0], atualizadoEm: quando });
    }
  }
  if (ultimo != null) await ref.set({ ultimo, atualizadoEm: quando }, { merge: true });
  return { achados, degustacoes, ultimo, parouPor };
}
```

`buscar` junta o `maiorContrato` de cada dia por unidade e, se houver `gw`, chama `varrerContratosNovos({ db, gw, unidade, ate: maior + FOLGA_VARREDURA, desde: varrerDesde && varrerDesde[unidade], agora })`. O resultado vai em `resultados.varredura[unidade]`. Exportar `varrerContratosNovos`, `COL_SEQ`, `COL_DEGUSTACOES`.

- [ ] **Step 1: casos no smoke:**
  - Gateway falso com 4636 (anual pago), 4637 (vazio), 4638 (degustação R$ 0), 4604-like (plano de crédito R$ 0), 4640. `varrerContratosNovos({ desde: 4636, ate: 4645 })` → `pacto_degustacoes` tem **só** `PP_4638`, com `mes: '2026-08'` e `degustacao.codigo === 'C4638'`; `pacto_contratos_seq/PP.ultimo === 4640` (não 4645); caderninho tem os 4 contratos existentes.
  - Segunda chamada sem `desde` começa em 4641.
  - `limite` no meio → para e `parouPor: 'limite'`, e a marca fica no último existente antes dele.
- [ ] **Step 2:** rodar, ver falhar. **Step 3:** implementar. **Step 4:** verde.
- [ ] **Step 5: commit** `feat(pacto-sombra): varredura de contratos novos acha a degustação grátis`.

---

### Task 5: A lista de renovações não apaga a consultora (`functions/renovacoes-montar.js`)

- [ ] **Step 1:** Em `scripts/smoke-renovacoes-montar.js`, acrescentar: caderninho `CP_7001` com `consultor: 'CONSULTORA CP', gw: true`; o núcleo devolve o 7001 de novo (mesmo aluno) → depois de `completarContratos`, o `CP_7001` continua com `CONSULTORA CP`.
- [ ] **Step 2:** ver falhar. **Step 3:** trocar a gravação por `await db.collection(COL_CONTRATOS).doc(unidade + '_' + codigo).set(L.soPreenchidos(limpo), { merge: true });` e, em `mapa[codigo]`, usar o doc mesclado (reler ou `{ ...(existente), ...soPreenchidos }`). Tirar a condição `unidade !== 'CP'` da consulta a `pacto_consultoras`, que é inofensiva no CP.
- [ ] **Step 4:** `node scripts/smoke-renovacoes-montar.js` verde. **Step 5: commit** `fix(renovacoes): regravar o caderninho não apaga a consultora do gateway`.

---

### Task 6: Functions (`functions/index.js`)

- [ ] **Step 1:** Mover as declarações `PACTO_API_KEY_CP`/`_PP` para junto de `PACTO_API_KEY` (bloco do modo sombra) e tirar a declaração duplicada do bloco das renovações.
- [ ] **Step 2:** `rodarSombra(dias, unidades, opcoes = {})`:

```js
  const pactoGateway = require('./pacto-gateway-cliente.js');
  const clientesGw = {
    CP: pactoGateway.criarClienteGateway({ fetch, credencial: PACTO_API_KEY_CP.value() }),
    PP: pactoGateway.criarClienteGateway({ fetch, credencial: PACTO_API_KEY_PP.value() }),
  };
  const r = await pactoSombra.buscar({ db: db(), cliente, clientesGw, dias, unidades,
    varrerDesde: opcoes.varrerDesde || null, agora: () => admin.firestore.FieldValue.serverTimestamp() });
```

e o log inclui `varredura: r.varredura`.
- [ ] **Step 3:** `buscarPactoSombra` e `buscarPactoSombraManual` ganham `secrets: [PACTO_API_KEY, PACTO_API_KEY_CP, PACTO_API_KEY_PP]`. O manual aceita `data.varrerDesde` (`{CP?: number, PP?: number}`, só inteiros positivos) e devolve `varredura`.
- [ ] **Step 4:** `cd functions && node -e "require('./index.js')"` sem erro de sintaxe (o carregamento pode reclamar de `admin`, mas não de sintaxe; usar `node --check index.js`).
- [ ] **Step 5: commit** `feat(functions): busca diária com as credenciais por unidade do gateway`.

---

### Task 7: Regras (`firestore.rules`)

- [ ] **Step 1:** Depois do `match /pacto_contratos/{id}`:

```
    // Degustação grátis achada pela numeração dos contratos (30/09/2026). Traz o
    // nome do cliente: só admin lê, só a Function grava.
    match /pacto_degustacoes/{id} {
      allow read:  if isAuth() && isAdmin();
      allow write: if false;
    }
```

- [ ] **Step 2:** em `scripts/validar-regras-pacto-sombra.js`, casos: admin lê `pacto_degustacoes`, vendedora não lê, admin não grava.
- [ ] **Step 3:** `node scripts/validate-rules-comissoes.js` verde. Deploy **só staging**: `firebase deploy --only firestore:rules` e rodar `node scripts/validar-regras-pacto-sombra.js` contra o staging.
- [ ] **Step 4: commit** `feat(rules): pacto_degustacoes só admin lê`.

---

### Task 8: Comparação (`pacto-sombra-comparacao.js`)

- [ ] **Step 1:** Em `scripts/smoke-pacto-sombra-comparacao.js:132`, esperar `compararVendedora === true` também no CP.
- [ ] **Step 2:** ver falhar. **Step 3:** `compararVendedora: true` com comentário "desde 30/09 o CP tem consultora pelo gateway". **Step 4:** verde. **Step 5: commit**.

---

### Task 9: `handleFile` dividido (`index.html`)

**Files:** Modify `index.html` (só com Edit), `scripts/smoke-upload-pacto-tela.js`

- [ ] **Step 1: teste** em `smoke-upload-pacto-tela.js` (parte estrutural):

```js
{
  assert.ok(/async function processarPlanilha\(json, nomeFonte, opcoes\)/.test(html), 'o caminho comum existe');
  const hf = html.slice(html.indexOf('function handleFile(file)'), html.indexOf('async function autoRegisterVendors'));
  assert.ok(/await processarPlanilha\(json, file\.name, \{ origem: 'planilha' \}\)/.test(hf), 'o arquivo passa pelo caminho comum');
  assert.ok(!/file\.name/.test(html.slice(html.indexOf('async function processarPlanilha'), html.indexOf('async function autoRegisterVendors')).replace(/processarPlanilha\(json, file\.name/, '')), 'o caminho comum não conhece arquivo');
  ok('handleFile só lê o arquivo; o resto é processarPlanilha, o mesmo do botão da API');
}
```

- [ ] **Step 2:** ver falhar.
- [ ] **Step 3:** No `index.html`:
  1. `reader.onload` passa a: ler o `json` e chamar `await processarPlanilha(json, file.name, { origem: 'planilha' });`, com o mesmo `try/catch` de hoje.
  2. Todo o corpo que vinha depois da leitura (do `let pacto = null;` até o `toast('Arquivo processado…')`) passa para `async function processarPlanilha(json, nomeFonte, opcoes) { opcoes = opcoes || {}; … }`, logo **antes** de `function handleFile`.
  3. Dentro dele, `file.name` vira `nomeFonte` (em `pendingUpload` e em `📋 Pré-visualização:`).
  4. `pendingUpload` ganha `origem: opcoes.origem || 'planilha', dadosAte: opcoes.dadosAte || null`.
  5. As degustações: `degustacoesGuardadas = [...guardadas do período, ...(opcoes.degustacoes || [])]`, sem repetir contrato (`new Map` por `contrato`).
  6. Em `confirmUpload`, `rawPeriodData` ganha `origem: pendingUpload.origem || 'planilha'` e `dadosAte: pendingUpload.dadosAte || null`, e o `logAudit('upload', …)` inclui `· origem: ${pendingUpload.origem}`.
- [ ] **Step 4:** Conferir `grep -c '</html>' index.html` = 1 e `wc -l`. Rodar `smoke-upload-pacto-tela.js`, `smoke-modulos-no-browser.js`, `smoke-data-do-upload.js` e `smoke-meta-sugerida-tela.js`: verdes.
- [ ] **Step 5: commit** `refactor(upload): arquivo e API pelo mesmo caminho (processarPlanilha)`.

---

### Task 10: O botão "Atualizar pela Pacto" (`upload-pela-api.js` + `index.html`)

**Files:** Create `upload-pela-api.js`, `scripts/smoke-upload-pela-api.js`; Modify `index.html`

`upload-pela-api.js` (puro, `window.UploadPelaApi` + `module.exports`), usando `PactoSombraTela`-like lógica própria (não depende da tela da sombra):

```js
const UploadPelaApi = {
  VERMELHAS: ['falhou', 'credencial_recusada', 'limite'],
  _somar(dia, n) { const d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); },
  /** Meses oferecidos: o corrente e, até o dia 10, o anterior */
  mesesOferecidos(hoje) {
    const atual = hoje.slice(0, 7);
    if (Number(hoje.slice(8)) > 10) return [atual];
    return [atual, this._somar(atual + '-01', -1).slice(0, 7)];
  },
  /**
   * @param {Array} docs  pacto_sombra_dias da unidade e do mês
   * @param {Array} degustacoes  pacto_degustacoes da unidade e do mês
   * @returns {{trava, diasProblema, vazios, json, degustacoes, dadosAte, buscadoEm, avisos}}
   */
  montar({ docs, degustacoes, mes, hoje, ApiLinhas }) {
    const porDia = new Map((docs || []).map(d => [d.dia, d]));
    const ontem = this._somar(hoje, -1);
    const fimMes = this._somar(this._somar(mes + '-01', 32).slice(0, 7) + '-01', -1);
    const ate = ontem < fimMes ? ontem : fimMes;
    const diasProblema = [], vazios = [];
    let buscadoEm = null;
    for (let d = mes + '-01'; d <= ate; d = this._somar(d, 1)) {
      const doc = porDia.get(d);
      if (!doc) { diasProblema.push({ dia: d, situacao: 'nao_buscado' }); continue; }
      if (this.VERMELHAS.includes(doc.situacao)) diasProblema.push({ dia: d, situacao: doc.situacao, motivo: doc.motivo || '' });
      if (doc.situacao === 'vazio_conferir') vazios.push(d);
      const t = doc.buscadoEm && (doc.buscadoEm.toDate ? doc.buscadoEm.toDate().toISOString() : String(doc.buscadoEm));
      if (t && (!buscadoEm || t < buscadoEm)) buscadoEm = t;   // a busca MAIS ANTIGA do mês
    }
    const linhas = [...porDia.values()].filter(d => d.dia >= mes + '-01' && d.dia <= ate)
      .sort((a, b) => a.dia.localeCompare(b.dia)).flatMap(d => (d.linhas ? JSON.parse(d.linhas) : []));
    const avisos = [...porDia.values()].flatMap(d => (d.avisos || []).map(a => ({ dia: d.dia, ...a })));
    return {
      trava: diasProblema.length > 0, diasProblema, vazios,
      json: ApiLinhas.comCabecalho(ApiLinhas.consolidarPorContrato(linhas)),
      degustacoes: (degustacoes || []).map(d => d.degustacao).filter(Boolean),
      dadosAte: ate, buscadoEm, avisos,
    };
  },
};
```

Na tela (`index.html`):
1. `<script src="upload-pela-api.js?v=20261001"></script>` e `pacto-api-linhas.js?v=20261001` (se ainda não carregado no `index.html`; conferir com grep) **depois** do `pacto-adapter.js`.
2. Na `#page-upload`, antes do `#uploadZone`: um bloco `#uploadApi` com o título "Atualizar pela Pacto", o seletor de mês (`UploadPelaApi.mesesOferecidos(hojeSP)`), o botão `🔄 Atualizar pela Pacto` (`onclick="atualizarPelaPacto()"`) e a linha de estado. O `#uploadZone` fica dentro de `<details id="uploadPlanilhaB"><summary>▸ Usar planilha (só se a Pacto falhar)</summary>…</details>`. O `#periodMonthGroup`, `#uploadPreview` e `#uploadActions` ficam **fora** do `<details>` (servem aos dois).
3. `async function atualizarPelaPacto()`:
   - sigla da unidade (`PactoAdapter.siglaDaUnidade(currentUnitId, ['CP','PP'])`), mês escolhido;
   - lê `pacto_sombra_dias` `where('unidade','==',sigla)` e filtra `dia` do mês; lê `pacto_degustacoes` `where('unidade','==',sigla)` e filtra `mes`;
   - `const m = UploadPelaApi.montar({ docs, degustacoes, mes, hoje: hojeSP(), ApiLinhas: PactoApiLinhas })`;
   - `m.trava` → mostra os dias (DD/MM + situação), o botão "🔁 Buscar de novo agora" (chama a callable `buscarPactoSombraManual` com `{ unidades:[sigla], de: primeiroDiaProblema, ate: ultimoDiaProblema }` e depois repete `atualizarPelaPacto`) e a frase "Se continuar falhando, use a planilha abaixo" com o `<details>` aberto. **Não chama `processarPlanilha`.**
   - Senão: `await processarPlanilha(m.json, 'Pacto (API) · dados até ' + DD/MM, { origem: 'api', dadosAte: m.dadosAte, degustacoes: m.degustacoes })`, e escreve na linha de estado os dias `vazio_conferir` e a hora da busca mais antiga.
   - O botão só aparece para admin (a tela de Upload já é só admin).

- [ ] **Step 1: teste** `scripts/smoke-upload-pela-api.js`:
  - `mesesOferecidos('2026-10-05')` → `['2026-10','2026-09']`; `('2026-10-11')` → `['2026-10']`.
  - `montar` com os dias 01 e 02 de setembro buscados, 03 `falhou` e `hoje='2026-09-04'` → `trava: true`, `diasProblema[0].dia === '2026-09-03'`.
  - Faltando o dia 02 → `nao_buscado` trava.
  - Tudo buscado, com o mesmo contrato pago em dois dias → `json` tem cabeçalho + **uma** linha do contrato (consolidado), `dadosAte === '2026-09-03'`.
  - Mês passado inteiro (`mes='2026-09'`, `hoje='2026-10-05'`) → `dadosAte === '2026-09-30'` e o dia 01/10 não entra.
  - `degustacoes` devolve os objetos `degustacao`.
  - Ganchos no `index.html` (recorte por assinatura, arquivo CRLF-seguro): `upload-pela-api.js` carregado; `function atualizarPelaPacto` existe e chama `UploadPelaApi.montar(` e `processarPlanilha(m.json,` com `origem: 'api'`; em trava **não** chama `processarPlanilha` (o `return` vem antes); `<details id="uploadPlanilhaB"` envolve o `uploadZone`.
- [ ] **Step 2:** ver falhar. **Step 3:** implementar (módulo, e `index.html` com Edit). Conferir `</html>` único e o tamanho.
- [ ] **Step 4:** `smoke-upload-pela-api.js` verde, mais `smoke-modulos-no-browser.js` (acrescentar `UploadPelaApi` à lista de módulos exercitados, chamando `mesesOferecidos`).
- [ ] **Step 5: commit** `feat(upload): botão "Atualizar pela Pacto" — planilha vira plano B`.

---

### Task 11: Validação contra produção (`scripts/comparar-api-oficial.js`, só leitura)

Refaz agosto e setembro, por unidade:
1. Lê de **produção** `pacto_sombra_dias` do mês (as linhas já gravadas pela busca de produção).
2. Completa localmente a consultora das linhas sem consultora: `criarClienteGateway` com `pacto-credencial-cp.txt`/`-pp.txt` (lidos do disco, **nunca impressos**) e `contrato(n)` para cada contrato distinto, preenchendo `consultor`/`resp1` como o conversor faria.
3. Acrescenta o balcão (`vendasDoDia` dia a dia + `linhasDeBalcao`) e as degustações achadas por `varrerContratosNovos` rodado **em memória** (banco falso) nas faixas PP 4555–4760 / CP 7025–7275.
4. `UploadPelaApi.montar` → `PactoAdapter.traduzir` (com os `codigosPagos` anteriores de produção) → `juntarDegustacoes` → `CommissionEngine.calculate` com a config do mês (`configDoMes`, `metasMensais` de produção).
5. Compara com o `vendorSummary` e os `totals` gravados em produção: por vendedora (ativações, P1+P2, P3, total) e contrato a contrato (os que só existem de um lado, com a causa da `PactoSombraComparacao`).
6. Imprime só primeiro nome de vendedora e número de contrato, **nunca nome de cliente**. Grava o relatório completo em `scratchpad`.

- [ ] **Step 1:** escrever o script. **Step 2:** rodar `node scripts/comparar-api-oficial.js --mes 2026-08` e `--mes 2026-09`.
- [ ] **Step 3:** Critério: toda diferença com causa conhecida (dia, crédito em conta, parcela renegociada — a API vence —, balcão sem vendedora, só no arquivo/só na API explicado). Se alguma não tiver causa, **parar** e investigar antes de seguir.
- [ ] **Step 4: commit** `chore: comparar-api-oficial (ago/set pela API × produção, só leitura)` e anotar os números no desenho, numa seção nova "Validação".

---

### Task 12: Staging, manual e registro

- [ ] **Step 1:** Suíte inteira verde (só `smoke-9.js` fora).
- [ ] **Step 2:** Deploy staging: `firebase deploy --only functions:buscarPactoSombra,functions:buscarPactoSombraManual,functions:montarListaRenovacoes,functions:montarListaRenovacoesManual` e `firebase deploy --only hosting`.
- [ ] **Step 3:** Carga no staging pela callable manual (script `scripts/homologar-api-oficial.js`, com a service account do staging e um token de admin de teste, no padrão de `homologar-pacto-sombra.js`): agosto e setembro em blocos de 7 dias, com `varrerDesde {PP: 4555, CP: 7025}` no primeiro bloco. Conferir no banco do staging: as linhas do CP com consultora, `pacto_degustacoes` só com `PP_4638`, o balcão presente e **nenhum `cpf`** em `pacto_contratos`/`pacto_degustacoes` (`scripts/varrer-cpf-sombra.js`).
- [ ] **Step 4:** `manual-admin.html`: seção "🔄 Atualizar pela Pacto" (o que faz, quando trava, a planilha como plano B) e âncora no `smoke-manual-atualizado.js`.
- [ ] **Step 5:** `CONTEXTO_SESSAO.md` (sessão 78 parte 2 → estado real), memória `api-pacto-oficial`, commit.
- [ ] **Step 6:** Entregar ao Rafael para homologar no staging: clicar "Atualizar pela Pacto" em setembro nas duas unidades e conferir a prévia. **Produção só com o OK dele**, e depois da entrega das renovações (que leva os secrets por unidade para a produção).
