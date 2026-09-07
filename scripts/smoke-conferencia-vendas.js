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

// ════════════════════════════════════════════════════════════════════
// 2. O código pago em dois meses: vence o menor mês, não o último lido
// ════════════════════════════════════════════════════════════════════
// `codigosPagos` é a memória de "cada contrato paga uma vez só" do regime de
// caixa. Reprocessar um mês ANTERIOR pode reintroduzir um código que já
// estava num mês posterior — já aconteceu (7 códigos de cobrança automática
// repostos em julho por script). Quem monta esta lista percorre uma consulta
// do Firestore SEM `orderBy`, então a ordem não é garantida cronológica —
// por isso o teste exige o MESMO resultado nas duas ordens.
{
  const vendas = [venda('C4566', 'JAIR')];

  const setembroPrimeiro = VA.cruzar(vendas, [
    { codigo: 'C4566', mes: '2026-09', data: '05/09/2026' },
    { codigo: 'C4566', mes: '2026-08', data: '20/08/2026' },
  ], []);
  const agostoPrimeiro = VA.cruzar(vendas, [
    { codigo: 'C4566', mes: '2026-08', data: '20/08/2026' },
    { codigo: 'C4566', mes: '2026-09', data: '05/09/2026' },
  ], []);

  assert.deepStrictEqual(setembroPrimeiro.pagas[0].pagoEm, { mes: '2026-08', data: '20/08/2026' },
    'vence o menor mês, mesmo quando setembro chega primeiro no array');
  assert.deepStrictEqual(agostoPrimeiro.pagas[0].pagoEm, { mes: '2026-08', data: '20/08/2026' });
  assert.deepStrictEqual(setembroPrimeiro.pagas[0].pagoEm, agostoPrimeiro.pagas[0].pagoEm,
    'a ordem do array não pode mudar o resultado');

  ok('código pago em dois meses: vence o menor mês, nas duas ordens');
}

// ════════════════════════════════════════════════════════════════════
// 3. `pagos` nulo e objeto sem `codigo` não quebram `cruzar`
// ════════════════════════════════════════════════════════════════════
{
  const vendas = [venda('C4566', 'JAIR')];

  assert.doesNotThrow(() => VA.cruzar(vendas, null, []), '`pagos` nulo não pode quebrar');
  const semPagos = VA.cruzar(vendas, null, []);
  assert.strictEqual(semPagos.aguardando.length, 1);

  assert.doesNotThrow(() => VA.cruzar(vendas, [{ mes: '2026-09', data: '05/09/2026' }], []),
    'objeto sem `codigo` não pode quebrar');
  const semCodigo = VA.cruzar(vendas, [{ mes: '2026-09', data: '05/09/2026' }], []);
  assert.strictEqual(semCodigo.pagas.length, 0, 'sem código, nenhuma venda casa — não é "pago"');
  assert.strictEqual(semCodigo.aguardando.length, 1);

  ok('`pagos` nulo e objeto sem `codigo` não quebram `cruzar`');
}

// ════════════════════════════════════════════════════════════════════
// 4. Mês ausente de um dos lados não apaga um mês conhecido
// ════════════════════════════════════════════════════════════════════
// Sob a mesma regra do caso 2 (menor mês vence), um `mes` ausente é "não sei",
// nunca "vence tudo". Testado nas duas ordens de chegada.
{
  const vendas = [venda('C4566', 'JAIR'), venda('C4647', 'RAQUEL')];

  // conhecido primeiro, depois um registro do mesmo código sem mês
  const conhecidoDepoisNulo = VA.cruzar(vendas, [
    { codigo: 'C4566', mes: '2026-08', data: '20/08/2026' },
    { codigo: 'C4566' },
  ], []);
  assert.deepStrictEqual(conhecidoDepoisNulo.pagas[0].pagoEm, { mes: '2026-08', data: '20/08/2026' },
    'o registro sem mês não pode apagar o mês já conhecido');

  // sem mês primeiro, depois o mesmo código com mês conhecido
  const nuloDepoisConhecido = VA.cruzar(vendas, [
    { codigo: 'C4647' },
    { codigo: 'C4647', mes: '2026-08', data: '20/08/2026' },
  ], []);
  assert.deepStrictEqual(nuloDepoisConhecido.pagas[0].pagoEm, { mes: '2026-08', data: '20/08/2026' },
    'o mês conhecido que chega depois ainda deve valer — não fica preso no null');

  ok('mês ausente de um dos lados nunca apaga um mês conhecido, em nenhuma ordem');
}

console.log('\n' + n + '/' + n + ' casos passaram.');
