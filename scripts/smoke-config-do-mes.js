'use strict';
// Roda: node scripts/smoke-config-do-mes.js
//
// Regra nova do bônus (out/2026): o motor precisa saber DE QUE MÊS é a conta.
// Este teste guarda o index.html: toda configuração que junta as metas do mês
// passa por CommissionEngine.configDoMes, e as chamadas que calculam o bônus
// fora do `calculate` (recálculo, prévia do upload, simulador, recibo) levam o mês.
// Lê o texto de propósito — a conta em si é testada em smoke-regra-minimos.js.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

function trecho(ini, fim) {
  const a = html.indexOf(ini); const b = html.indexOf(fim, a + ini.length);
  assert.ok(a > 0 && b > a, 'não achei ' + ini);
  return html.slice(a, b);
}

/* 1. nenhuma configuração com metas do mês montada à mão */
{
  const soltas = html.split(/\r?\n/).filter(l => /\.\.\.CommissionEngine\.defaultConfig/.test(l) && /metasMensais/.test(l));
  assert.deepStrictEqual(soltas, [], 'montagem sem o mês:\n' + soltas.join('\n'));
  const usos = (html.match(/CommissionEngine\.configDoMes\(/g) || []).length;
  assert.ok(usos >= 13, 'configDoMes em todos os lugares: ' + usos);
  ok('toda configuração com metas do mês passa por configDoMes (' + (html.match(/CommissionEngine\.configDoMes\(/g) || []).length + ' lugares)');
}

/* 2. os caminhos que calculam o bônus fora do calculate levam o mês */
{
  const recalc = trecho('async function recalculatePeriod(periodId, triggerContext)', 'CommissionEngine.applyP3Pool(vendorData');
  assert.ok(/mes: mesDoPeriodo, minimosPorPessoa/.test(recalc), 'o recálculo leva o mês e os mínimos por pessoa');
  assert.ok(/minimosPorPessoa: minimosPorPessoa \|\| null/.test(html), 'e grava os mínimos no período');
  const previa = trecho('function refreshPreviewTotals()', 'CommissionEngine.applyP3Pool(');
  assert.ok(/mes: CommissionEngine\.mesDosItens\(processed\)/.test(previa), 'a prévia do upload leva o mês do arquivo');
  assert.ok(/minhas: myData, nome: window\.currentSimNome/.test(html), 'o simulador sabe de quem é o mínimo');
  assert.ok(/vs\.p3base \|\| vs\.caixa \|\| 0, CommissionEngine\.configDoMes\(/.test(html), 'o recibo reconstruído leva o mês');
  assert.ok(/<script src="jornada-comercial\.js\?v=\d{8}"><\/script>/.test(html));
  ok('recálculo, prévia do upload, simulador e recibo levam o mês; o mínimo por pessoa é gravado');
}

/* 3. a tela de Regras e a configuração falam da regra nova */
{
  assert.ok(/A partir da comissão de OUTUBRO\/2026/.test(html));
  assert.ok(/key: 'minIndivIntegral'/.test(html) && /key: 'minIndiv30h'/.test(html) && /key: 'pctAdaptacao'/.test(html));
  ok('Regras explicam a regra nova; a configuração tem os mínimos de jornada');
}

console.log('\n✅ smoke-config-do-mes: ' + n);
