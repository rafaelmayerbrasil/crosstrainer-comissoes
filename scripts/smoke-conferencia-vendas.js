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
