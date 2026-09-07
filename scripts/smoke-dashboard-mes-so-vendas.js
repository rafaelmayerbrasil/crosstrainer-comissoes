'use strict';
// Roda: node scripts/smoke-dashboard-mes-so-vendas.js
//
// Subir o relatório de VENDAS cria o documento do período com `vendasDoMes` e
// mais nada — sem `totals`, sem `vendorSummary`, porque comissão nenhuma foi
// calculada. O mês passa a aparecer no seletor do Dashboard.
//
// Em 07/09/2026 isso derrubou a tela em produção: o Rafael subiu o relatório de
// vendas de setembro e o Dashboard virou
//   "Erro ao renderizar dashboard: Cannot read properties of undefined
//    (reading 'unitAtivacoes')"
// `renderAdminDashboard` já se protegia com `data.totals || {}`, mas guardava o
// resultado numa variável local — `data.totals` continuava indefinido, e
// `calcProjection(data)` lia `periodData.totals.unitAtivacoes` direto.
//
// Este smoke roda a função DE VERDADE, extraída do index.html: teste que só lê
// o texto do arquivo não pegaria isto (foi a lição de `previa-nunca-rodou`).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

/** Recorta `function nome(...) { ... }` do index.html, casando as chaves */
function extrair(nome) {
  const ini = html.indexOf('function ' + nome + '(');
  assert.ok(ini > 0, 'função ' + nome + ' não existe no index.html');
  let i = html.indexOf('{', ini), nivel = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') nivel++;
    else if (html[j] === '}') { nivel--; if (!nivel) return html.slice(ini, j + 1); }
  }
  throw new Error('não achei o fim de ' + nome);
}

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(extrair('calcProjection'), sandbox);

let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);

const hoje = new Date();
const mesAtual = { year: hoje.getFullYear(), month: hoje.getMonth() + 1 };

// ════════════════════════════════════════════════════════════════════
// 1. Mês com comissão processada: projeção normal
// ════════════════════════════════════════════════════════════════════
{
  const p = sandbox.calcProjection({
    ...mesAtual,
    totals: { unitAtivacoes: 10, unitCaixa: 5000, unitNovosRetorno: 6, unitRenovacoes: 3, unitVouchers: 1 },
  });
  assert.ok(p, 'mês corrente com totals tem que projetar');
  assert.ok(p.projAtiv >= 10, 'a projeção não pode ser menor que o realizado: ' + p.projAtiv);
  ok('mês com comissão processada projeta normalmente');
}

// ════════════════════════════════════════════════════════════════════
// 2. Mês que só tem o relatório de VENDAS: não pode quebrar
// ════════════════════════════════════════════════════════════════════
// É o documento exato que `registrarVendasDoPeriodo` grava.
{
  const soVendas = {
    unitId: 'cp', ...mesAtual,
    vendasDoMes: [{ contrato: 'C7150', cliente: 'FULANA', vendedores: ['ERICA FAUSTINO'] }],
  };
  let p, erro = null;
  try { p = sandbox.calcProjection(soVendas); } catch (e) { erro = e; }
  assert.strictEqual(erro, null, 'calcProjection quebrou num mês sem totals: ' + (erro && erro.message));
  assert.strictEqual(p, null, 'sem comissão processada não existe projeção — melhor nenhuma que uma de zeros');
  ok('mês que só tem o relatório de vendas não derruba o dashboard');
}

// ════════════════════════════════════════════════════════════════════
// 3. `totals` vazio também não pode quebrar
// ════════════════════════════════════════════════════════════════════
{
  let erro = null;
  try { sandbox.calcProjection({ ...mesAtual, totals: {} }); } catch (e) { erro = e; }
  assert.strictEqual(erro, null, 'totals vazio quebrou: ' + (erro && erro.message));
  ok('totals vazio também atravessa sem quebrar');
}

// ════════════════════════════════════════════════════════════════════
// 4. A tela explica o mês em vez de mostrar um dashboard zerado
// ════════════════════════════════════════════════════════════════════
{
  const render = extrair('renderAdminDashboard');
  assert.ok(/vendasDoMes/.test(render),
    'o dashboard precisa reconhecer o mês que só tem o relatório de vendas');
  assert.ok(/Faturamento Recebido|faturamento-recebido/i.test(render),
    'e dizer qual arquivo falta subir');
  ok('o dashboard avisa que falta o Faturamento Recebido, em vez de mostrar tudo zerado');
}

// ════════════════════════════════════════════════════════════════════
// 5. Nenhuma tela pode ler `data.totals` sem proteção
// ════════════════════════════════════════════════════════════════════
// A raiz do bug foi um `const t = periodData.totals` cru. Procura o padrão de
// volta, em qualquer lugar do arquivo — inclusive numa tela nova.
{
  const cruas = [...html.matchAll(/const t = (?:data|periodData|pData)\.totals;/g)];
  assert.strictEqual(cruas.length, 0,
    'ainda existe leitura crua de .totals — use `|| {}` ou saia antes: ' + cruas.map(m => m[0]).join(', '));
  ok('nenhuma tela lê data.totals sem proteção');
}

console.log('\n' + n + '/' + n + ' casos passaram.');
