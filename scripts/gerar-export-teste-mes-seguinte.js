// Gera um export FICTÍCIO de setembro a partir do de agosto, empurrando as datas
// de lançamento um mês. Serve só para ver, na tela do staging, a regra "uma vez
// só por contrato" barrando as parcelas. NÃO usar em produção.
const path = require('path');
const { readXlsx } = require('./lib-xlsx-min.js');
const { escreverXlsx } = require('./lib-xlsx-write.js');
const PA = require('../pacto-adapter.js');

const ARQ = path.join(__dirname, '..', 'relatorios pacto',
  'faturamento-recebido_6d85c17be56a3354e9142649a1c0a830_20260901_213346.xls');
const wb = readXlsx(ARQ);
const aba = wb.sheet(wb.sheetNames[0]);
const linhas = Object.keys(aba).map(Number).sort((a, b) => a - b).map(k => aba[k]);

const saida = linhas.map((l, i) => {
  if (i === 0) return l;
  const c = l.slice();
  c[PA.COL.lancamento] = String(c[PA.COL.lancamento]).replace(/^(\d{2})\/08\/2026/, '$1/09/2026');
  return c;
});
const destino = path.join(__dirname, '..', 'relatorios pacto', 'TESTE-setembro-ficticio.xlsx');
escreverXlsx(destino, 'Faturamento Recebido', saida);
console.log('gerado:', destino, '·', saida.length, 'linhas');
