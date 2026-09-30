'use strict';
// Roda: node scripts/smoke-ativacao-adiada.js
//
// Contrato que começa mais de 30 dias depois do pagamento (resposta do Rodrigo,
// 30/09/2026 — spec §5.6), de pagamentos de OUTUBRO/2026 em diante:
// o dinheiro (P1, P2, caixa do P3) fica no mês do pagamento; a CONTAGEM da
// ativação (unidade e vendedora) vai para o mês em que o plano começa. No mês do
// início, os adiados chegam pela configuração — sem re-upload (foi aí que o
// diferimento antigo quebrou: R$ 6.318,17 que nunca voltaram). Dados INVENTADOS.

const assert = require('assert');
const path = require('path');
const CE = require(path.join(__dirname, '..', 'commission.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

const CAB = ['Código', 'Cliente', 'Data', 'Itens', 'Valor Venda', 'Desconto Venda', 'Desconto Recebimento', 'Valor Final', 'Valor Quitado/Recibo', 'Origem', 'Tipo de Venda', 'Vendedor'];
const linha = (cod, data, inicio, fim, vendedor = 'KALI') => [cod, 'CLIENTE ' + cod, data,
  `HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO (${inicio} - ${fim})`, '1000', '-', '-', '1000', '1000', 'BALCÃO', 'Novo Contrato', vendedor];
const calc = (linhas, cfg) => CE.calculate(CE.cleanRawData([CAB, ...linhas]), cfg);

/* 1. outubro: pagou em 20/10 um anual que começa em 01/12 */
const out = calc([linha('C1', '20/10/2026', '01/12/2026', '30/11/2027'), linha('C2', '20/10/2026', '20/10/2026', '19/10/2027')], { mes: '2026-10' });
const c1 = out.processed.find(d => d.codigo === 'C1');
{
  assert.strictEqual(c1.ativacaoAdiadaPara, '2026-12');
  assert.ok(/01\/12\/2026/.test(c1.ativacaoAdiadaMotivo) && /dezembro|12\/2026/.test(c1.ativacaoAdiadaMotivo), c1.ativacaoAdiadaMotivo);
  assert.strictEqual(out.processed.find(d => d.codigo === 'C2').ativacaoAdiadaPara, undefined, 'começa no mês: conta agora');
  assert.strictEqual(out.unitTotals.unitAtivacoes, 1, 'a unidade conta só o C2 em outubro');
  assert.strictEqual(out.unitTotals.unitNovosRetorno, 1);
  assert.strictEqual(out.vendorData.KALI.ativacoes, 1, 'a vendedora também');
  assert.strictEqual(out.vendorData.KALI.caixaTotal, 2000, 'o dinheiro dos dois fica em outubro');
  assert.ok(c1.p1valor > 0, 'a comissão do C1 é paga em outubro');
  assert.strictEqual(out.unitTotals.unitCaixa, 2000);
  ok('outubro: comissão e dinheiro no mês do pagamento; a ativação do C1 fica para dezembro');
}

/* 2. dezembro: a ativação chega sem dinheiro */
{
  const dez = calc([linha('C3', '05/12/2026', '05/12/2026', '04/12/2027', 'ERICA')], { mes: '2026-12', ativacoesAdiadas: [c1] });
  assert.strictEqual(dez.unitTotals.unitAtivacoes, 2, 'C3 + o C1 adiado');
  assert.strictEqual(dez.unitTotals.unitNovosRetorno, 2);
  assert.strictEqual(dez.vendorData.KALI.ativacoes, 1, 'a ativação é da KALI, que vendeu');
  assert.strictEqual(dez.vendorData.KALI.caixaTotal, 0, 'sem dinheiro em dezembro');
  assert.strictEqual(dez.vendorData.KALI.p1total, 0, 'sem comissão de novo');
  assert.strictEqual(dez.unitTotals.unitCaixa, 1000);
  ok('dezembro: a ativação adiada conta para a unidade e para quem vendeu, sem dinheiro nem comissão');
}

/* 3. setembro e antes: nada muda */
{
  const set = calc([linha('C1', '20/09/2026', '01/11/2026', '31/10/2027'), linha('C2', '20/09/2026', '20/09/2026', '19/09/2027')], { mes: '2026-09' });
  assert.strictEqual(set.processed.find(d => d.codigo === 'C1').ativacaoAdiadaPara, undefined);
  assert.strictEqual(set.unitTotals.unitAtivacoes, 2);
  const limite = calc([linha('C1', '20/10/2026', '19/11/2026', '18/11/2027')], { mes: '2026-10' });
  assert.strictEqual(limite.processed[0].ativacaoAdiadaPara, undefined, '30 dias exatos: conta no mês');
  ok('setembro não adia nada; até 30 dias depois conta no mês do pagamento');
}

/* 4. a soma da unidade é uma função só, igual à conta de antes quando não há adiado */
{
  const itens = [
    { isActivation: true, category: 'novo' }, { isActivation: true, category: 'retorno', splitAtivacao: 0.5 },
    { isActivation: true, category: 'retorno', splitAtivacao: 0.5 }, { isActivation: true, category: 'renovacao' },
    { isActivation: true, category: 'voucher' }, { isActivation: false, category: 'avulsa' },
  ];
  const antes = f => CE.contagemDaUnidade(itens.reduce((s, d) => s + (f(d) ? (d.splitAtivacao || 1) : 0), 0));
  assert.deepStrictEqual(CE.contagensDaUnidade(itens), {
    unitAtivacoes: antes(d => d.isActivation), unitNovosRetorno: antes(d => d.category === 'novo' || d.category === 'retorno'),
    unitRenovacoes: antes(d => d.category === 'renovacao'), unitVouchers: antes(d => d.category === 'voucher'),
  });
  const com = CE.contagensDaUnidade([...itens, { isActivation: true, category: 'novo', ativacaoAdiadaPara: '2026-12' }],
    [{ isActivation: true, category: 'renovacao', splitAtivacao: 0.5 }, { isActivation: true, category: 'renovacao', splitAtivacao: 0.5 }]);
  assert.strictEqual(com.unitAtivacoes, 5, '5 daqui + 1 que chega − 1 que sai');
  assert.strictEqual(com.unitRenovacoes, 2);
  ok('contagensDaUnidade: igual à soma de antes sem adiados; tira o que sai e soma o que chega');
}

/* 5. configDoMes leva os adiados */
{
  assert.deepStrictEqual(CE.configDoMes({ mes: '2026-12', ativacoesAdiadas: [{ a: 1 }] }).ativacoesAdiadas, [{ a: 1 }]);
  assert.strictEqual(CE.configDoMes({ mes: '2026-12' }).ativacoesAdiadas, null);
  ok('configDoMes leva as ativações adiadas para o mês');
}

console.log('\n✅ smoke-ativacao-adiada: ' + n);
