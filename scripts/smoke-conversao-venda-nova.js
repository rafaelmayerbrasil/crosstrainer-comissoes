'use strict';
// Roda: node scripts/smoke-conversao-venda-nova.js
//
// Decisão do Rafael (30/09/2026): conversão de degustação paga como VENDA NOVA,
// de outubro/2026 em diante. A Pacto registra a maioria como "renovação" (2,5%);
// a degustação é o 1º contrato, então o plano cheio vira "renovação" lá. Aqui ele
// passa a ser "novo" (5%) e conta em novos + retorno, não em renovações.
// Setembro e antes: como sempre. Dados INVENTADOS.

const assert = require('assert');
const path = require('path');
const CE = require(path.join(__dirname, '..', 'commission.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

const CAB = ['Código', 'Cliente', 'Data', 'Itens', 'Valor Venda', 'Desconto Venda', 'Desconto Recebimento', 'Valor Final', 'Valor Quitado/Recibo', 'Origem', 'Tipo de Venda', 'Vendedor'];
const linha = (cod, cliente, data, tipo) => [cod, cliente, data, 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO', '1000', '-', '-', '1000', '1000', 'BALCÃO', tipo, 'KALI'];
const degustacao = (cliente, ini, fim) => ({ isDegustacao: true, isContract: false, category: 'voucher', cliente, codigo: '31754161234',
  data: ini, item: `MÊS DEGUSTAÇÃO LIVRE (${ini} - ${fim})`, vendedor: 'KALI', type: 'processed' });

/* 1. outubro: renovação de quem fez degustação vira venda nova */
{
  const anteriores = [degustacao('Maria Silva', '10/09/2026', '10/10/2026')];
  const r = CE.calculate(CE.cleanRawData([CAB, linha('C1', 'MARIA SILVA', '15/10/2026', 'Renovação'), linha('C2', 'JOAO SOUZA', '15/10/2026', 'Renovação')]),
    { mes: '2026-10' }, {}, anteriores);
  const c1 = r.processed.find(d => d.codigo === 'C1'), c2 = r.processed.find(d => d.codigo === 'C2');
  assert.strictEqual(c1.category, 'novo', 'conversão paga como venda nova');
  assert.strictEqual(c1.categoriaPacto, 'renovacao', 'guarda como a Pacto registrou');
  assert.strictEqual(c1.conversaoDeDegustacao, true);
  assert.strictEqual(c1.p1valor, 50, '5% de 1000, não 2,5%');
  assert.ok(/convers/i.test(c1.label), c1.label);
  assert.strictEqual(c2.category, 'renovacao', 'renovação de quem não fez degustação continua renovação');
  assert.strictEqual(c2.p1valor, 25);
  assert.strictEqual(r.unitTotals.unitNovosRetorno, 1, 'conta em novos + retorno');
  assert.strictEqual(r.unitTotals.unitRenovacoes, 1);
  assert.strictEqual(r.p4result.conversoesMes, 1, 'e continua sendo conversão (R$ 30)');
  ok('outubro: renovação de quem fez degustação vira venda nova (5%, novos + retorno) e segue como conversão');
}

/* 2. setembro e antes: como sempre */
{
  const anteriores = [degustacao('Maria Silva', '10/08/2026', '10/09/2026')];
  const r = CE.calculate(CE.cleanRawData([CAB, linha('C1', 'MARIA SILVA', '15/09/2026', 'Renovação')]), { mes: '2026-09' }, {}, anteriores);
  assert.strictEqual(r.processed[0].category, 'renovacao');
  assert.strictEqual(r.processed[0].p1valor, 25);
  ok('setembro: renovação continua renovação — mês pago não muda');
}

/* 3. limites */
{
  const tarde = CE.calculate(CE.cleanRawData([CAB, linha('C1', 'MARIA SILVA', '30/11/2026', 'Renovação')]), { mes: '2026-11' }, {},
    [degustacao('Maria Silva', '10/09/2026', '10/10/2026')]);
  assert.strictEqual(tarde.processed[0].category, 'renovacao', 'mais de 45 dias depois do fim da degustação');
  const mensal = CE.calculate(CE.cleanRawData([CAB, [...linha('C1', 'MARIA SILVA', '15/10/2026', 'Renovação').slice(0, 3),
    'HIIT/MAROMBINHA | MENSAL | CP | 3X | PADRÃO', ...linha('C1', 'MARIA SILVA', '15/10/2026', 'Renovação').slice(4)]]), { mes: '2026-10' }, {},
    [degustacao('Maria Silva', '10/09/2026', '10/10/2026')]);
  assert.strictEqual(mensal.processed[0].category, 'renovacao', 'mensal não é plano cheio');
  const mesmoMes = CE.calculate(CE.cleanRawData([CAB, linha('C1', 'MARIA SILVA', '20/10/2026', 'Renovação')]), { mes: '2026-10' }, {},
    [degustacao('Maria Silva', '01/10/2026', '31/10/2026')]);
  assert.strictEqual(mesmoMes.processed[0].category, 'novo', 'degustação do próprio mês também vale');
  ok('limites: 45 dias, só plano cheio, degustação do mês anterior ou do próprio mês');
}

console.log('\n✅ smoke-conversao-venda-nova: ' + n);
