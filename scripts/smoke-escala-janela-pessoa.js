'use strict';
// Roda: node scripts/smoke-escala-janela-pessoa.js
//
// Task 15 (pedido 7a do Rodrigo, 28/08/2026): a aba Por pessoa passa a dizer
// de qual janela é cada data — e a filtrar por ela. Nasceu do mesmo defeito
// da Task 14: 02/11 e 20/11 foram consolidadas fora de qualquer janela, com
// gente escalada numa escala que ninguém abriu. Sem a coluna/filtro, essas
// datas ficavam indistinguíveis das demais na lista da pessoa.
//
// Molde: scripts/smoke-escala-marco-zero.js, bloco "rodarTestesDaTela" — carrega
// professores-escala-smart.js num sandbox `vm` com os globais dublados e CHAMA
// renderTabPorPessoa()/escalaSetPessoaJanela() de verdade, não só lê o texto.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SS = require('../scale-service.js');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

const src = fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8');

// A tela junta a tabela da pessoa com `${escalaHistoricoAnoHtml()}` no fim, que
// TAMBÉM usa `<tr>` sem atributo pras suas linhas, e o `<select>` do filtro
// (ANTES da tabela) lista o rótulo de todos os lotes da pessoa, filtro ligado
// ou não — contar/procurar no HTML inteiro pega as duas coisas erradas. Corta
// só as LINHAS da tabela "Por pessoa": de `<thead>` até o primeiro `</table>`.
const tabelaPessoa = (html) => html.slice(html.indexOf('<thead>'), html.indexOf('</table>') + '</table>'.length);

let renderCalls = 0;
const sandbox = {
  console,
  ScaleService: {
    tiposIrmaos: SS.tiposIrmaos,
    contarPorPessoa: SS.contarPorPessoa,
    fmtDataLonga: SS.fmtDataLonga,
  },
  isAdminGestao: () => true,
  isSupervisao: () => false,
  ajudaBtn: () => '',
  toast: () => {},
  confirm: () => true,
  document: { getElementById: () => null },
  AuditService: { log: async () => ({ success: true }) },
  AppState: { userProfile: null },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'professores-escala-smart.js' });
// `const`/`let` de topo (EscalaSmartState) não vira propriedade do sandbox —
// só `function`/`var` vira. Ponte explícita, igual ao molde.
vm.runInContext('this.EscalaSmartState = EscalaSmartState;', sandbox);
// Sobrescreve DEPOIS de rodar o script — senão a `function renderEscalaGestao(){}`
// do próprio arquivo clobbera o espião.
sandbox.renderEscalaGestao = () => { renderCalls++; };

sandbox.EscalaSmartState.year = 2026;
sandbox.EscalaSmartState.pessoaSel = 'ana';
sandbox.EscalaSmartState.pessoaJanela = 'todas';
sandbox.EscalaSmartState.janelaPorTipo = {};
sandbox.EscalaSmartState.teacherMap = new Map([['ana', { id: 'ana', name: 'Ana', isActive: true }]]);
sandbox.EscalaSmartState.units = [{ id: 'cp', name: 'CrossTainer CP' }];
sandbox.EscalaSmartState.modToi = { id: 'TOI' };
sandbox.EscalaSmartState.modHiit = { id: 'HIIT' };

const slot = (assignedPersonId) => ({ id: 'v1', unitId: 'cp', requiredModalityId: 'TOI', requiredModalityName: 'TOI', assignedPersonId });

sandbox.EscalaSmartState.scales = [
  // duas datas no MESMO lote — testa o rótulo de período (a mais antiga a mais nova)
  { id: 's1', date: '2026-09-05', tipo: 'sabado', windowBatchId: 'b1', status: 'consolidada', published: false, slots: [slot('ana')] },
  { id: 's2', date: '2026-09-12', tipo: 'sabado', windowBatchId: 'b1', status: 'consolidada', published: false, slots: [slot('ana')] },
  // consolidada fora de qualquer janela — o defeito que gerou o pedido (Task 14)
  { id: 's3', date: '2026-11-20', tipo: 'feriado', windowBatchId: null, status: 'consolidada', published: false, slots: [slot('ana')] },
];

// ── coluna Janela: período do lote nas duas primeiras, aviso na terceira ──
{
  const tbl = tabelaPessoa(sandbox.renderTabPorPessoa());
  assert.ok(/<th[^>]*>Janela<\/th>/.test(tbl), 'a tabela ganha a coluna Janela');
  assert.ok(/05\/09\/2026 a 12\/09\/2026/.test(tbl), 'o lote com 2 datas mostra o período completo');
  assert.ok(/⚠️ fora de janela/.test(tbl), 'a data sem lote mostra o aviso');
  passou('a coluna Janela mostra o período do lote e avisa quem está fora dele');
}

// ── filtro: "todas" mostra as 3, "fora" isola a órfã, o lote isola as 2 ──
{
  const semFiltro = tabelaPessoa(sandbox.renderTabPorPessoa());
  assert.strictEqual((semFiltro.match(/<tr>/g) || []).length, 3, 'sem filtro, as 3 datas aparecem');

  sandbox.escalaSetPessoaJanela('fora');
  assert.strictEqual(sandbox.EscalaSmartState.pessoaJanela, 'fora', 'o estado muda pro filtro escolhido');
  assert.strictEqual(renderCalls, 1, 'e a tela é re-renderizada (via renderEscalaGestao)');
  const soFora = tabelaPessoa(sandbox.renderTabPorPessoa());
  assert.strictEqual((soFora.match(/<tr>/g) || []).length, 1, 'filtro "fora": só a data sem lote aparece');
  assert.ok(/⚠️ fora de janela/.test(soFora), 'e ela mostra o aviso');
  assert.ok(!/05\/09\/2026 a 12\/09\/2026/.test(soFora), 'as datas do lote saem da lista');

  sandbox.escalaSetPessoaJanela('b1');
  const soLote = tabelaPessoa(sandbox.renderTabPorPessoa());
  assert.strictEqual((soLote.match(/<tr>/g) || []).length, 2, 'filtro pelo lote: só as 2 datas dele aparecem');
  assert.ok(!/⚠️ fora de janela/.test(soLote), 'a data órfã sai da lista');

  sandbox.escalaSetPessoaJanela('');
  assert.strictEqual(sandbox.EscalaSmartState.pessoaJanela, 'todas', 'valor vazio cai pro default "todas", não fica undefined');
  passou('o filtro isola o lote escolhido ou as datas fora de janela');
}

// ── o <select> do filtro lista os lotes da PESSOA, não todos os lotes existentes ──
{
  sandbox.EscalaSmartState.scales.push(
    { id: 's4', date: '2026-10-03', tipo: 'sabado', windowBatchId: 'b_outraPessoa', status: 'consolidada', published: false,
      slots: [{ id: 'v2', unitId: 'cp', requiredModalityId: 'TOI', requiredModalityName: 'TOI', assignedPersonId: 'bru' }] },
  );
  const html = sandbox.renderTabPorPessoa();
  assert.ok(/value="b1"/.test(html), 'o lote da própria pessoa aparece no filtro');
  assert.ok(!/value="b_outraPessoa"/.test(html), 'lote de outra pessoa não polui o filtro dela');
  sandbox.EscalaSmartState.scales.pop();
  passou('o filtro só lista os lotes em que a própria pessoa está escalada');
}

console.log(`\n${ok}/3 blocos OK`);
