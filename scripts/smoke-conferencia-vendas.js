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

// ════════════════════════════════════════════════════════════════════
// 5. A venda "a conferir" carrega o pagamento que fez o nome bater
// ════════════════════════════════════════════════════════════════════
// Sem isso a gestão tem que ir na Pacto procurar. Com isso, a conferência
// vira um olhar de cinco segundos.
{
  const vendas = [venda('C7130', 'CÁTIA TEREZINHA PEREIRA TORRES', { valorContrato: 2388 })];

  // lista de nomes: como sempre funcionou
  const soNome = VA.cruzar(vendas, [], ['CÁTIA TEREZINHA PEREIRA TORRES']);
  assert.strictEqual(soNome.conferir.length, 1);
  assert.strictEqual(soNome.conferir[0].pagamentoQueBateu, null,
    'sem o lançamento, não há prova para mostrar — null, nunca inventado');

  // com o lançamento inteiro
  const comItem = VA.cruzar(vendas, [], [
    { cliente: 'CÁTIA TEREZINHA PEREIRA TORRES', codigo: 'C6867', valor: 199, data: '12/08/2026' },
  ]);
  assert.strictEqual(comItem.conferir.length, 1);
  assert.deepStrictEqual(comItem.conferir[0].pagamentoQueBateu,
    { cliente: 'CÁTIA TEREZINHA PEREIRA TORRES', codigo: 'C6867', valor: 199, data: '12/08/2026' });

  // o nome sujo continua casando com o limpo, dos dois lados
  const sujo = VA.cruzar(
    [venda('C4588', 'MARIANA MINGHELLI BECKER  VISÃO GERAL CADASTRO VE')],
    [], [{ cliente: 'MARIANA MINGHELLI BECKER', codigo: 'C4000', valor: 50, data: '01/08/2026' }]);
  assert.strictEqual(sujo.conferir.length, 1, 'o limpador de nome continua valendo');
  assert.strictEqual(sujo.conferir[0].pagamentoQueBateu.codigo, 'C4000');

  ok('a venda a conferir carrega o pagamento que fez o nome bater');
}

// ════════════════════════════════════════════════════════════════════
// 6. Cliente sem nome utilizável nunca vira prova de ninguém
// ════════════════════════════════════════════════════════════════════
// Achado da revisão do commit 03157cc: um lançamento sem `cliente` (ou com o
// nome normalizando pra vazio) gravava a chave '' no Map, e QUALQUER venda com
// cliente vazio casava com ele e carregava aquele lançamento como
// `pagamentoQueBateu` — prova de uma pessoa completamente diferente.
{
  // item sem `cliente`: não pode virar prova de uma venda com cliente vazio,
  // e a venda nem deve cair em "conferir" por causa dele
  const semNome = VA.cruzar(
    [venda('C4589', '')],
    [], [{ codigo: 'C999', valor: 42, data: '01/01/2026' }]);
  assert.strictEqual(semNome.conferir.length, 0,
    'sem nome utilizável no lançamento, a venda de cliente vazio não casa com nada');
  assert.strictEqual(semNome.aguardando.length, 1);

  // nome só com espaços: o mesmo tratamento — é o caso que o filtro
  // `if (it.cliente)` do carregador da tela deixa passar
  const soEspaco = VA.cruzar(
    [venda('C4590', '')],
    [], [{ cliente: '   ', codigo: 'C998', valor: 42, data: '01/01/2026' }]);
  assert.strictEqual(soEspaco.conferir.length, 0,
    'nome só de espaços normaliza pra vazio — mesma trava');
  assert.strictEqual(soEspaco.aguardando.length, 1);

  // `clientesPagantes` nulo não quebra
  assert.doesNotThrow(() => VA.cruzar([venda('C4591', 'ALGUEM')], [], null),
    '`clientesPagantes` nulo não pode quebrar');
  assert.strictEqual(VA.cruzar([venda('C4591', 'ALGUEM')], [], null).aguardando.length, 1);

  // mistura de string e objeto na mesma lista: cada um com seu tratamento
  const vendas = [venda('C4592', 'FULANA DE TAL'), venda('C4593', 'CICLANA SOUZA')];
  const mistura = VA.cruzar(vendas, [], [
    'FULANA DE TAL',
    { cliente: 'CICLANA SOUZA', codigo: 'C777', valor: 80, data: '02/01/2026' },
  ]);
  assert.strictEqual(mistura.conferir.length, 2);
  const porContrato = c => mistura.conferir.find(x => x.contrato === c);
  assert.strictEqual(porContrato('C4592').pagamentoQueBateu, null,
    'nome como string: sem lançamento, prova é null');
  assert.deepStrictEqual(porContrato('C4593').pagamentoQueBateu,
    { cliente: 'CICLANA SOUZA', codigo: 'C777', valor: 80, data: '02/01/2026' },
    'nome como objeto: prova é o lançamento inteiro');

  ok('cliente sem nome utilizável (ausente ou só espaços) nunca vira prova de ninguém');
}

// ════════════════════════════════════════════════════════════════════
// 7. A opinião do sistema, com os dois casos reais de produção
// ════════════════════════════════════════════════════════════════════
// A Amandha e a Cátia foram medidas na produção em 07/09/2026: as duas
// pagaram ANTES de a venda existir, R$ 239 e R$ 199 contra contratos anuais
// de R$ 2.388. Foi por isso que o sistema NÃO decide sozinho — se decidisse,
// a gestão pararia de acompanhar R$ 4.776.
{
  const catia = venda('C7130', 'CÁTIA TEREZINHA PEREIRA TORRES',
    { valorContrato: 2388, data: '27/08/2026', inicio: '02/09/2026' });

  const antes = VA.opiniao(catia, { codigo: 'C6867', valor: 199, data: '12/08/2026' });
  assert.strictEqual(antes.suspeita, 'provavelmente_nao_paga');
  assert.ok(/antes/i.test(antes.porque), 'o motivo tem que dizer que o pagamento é anterior: ' + antes.porque);

  const amandha = venda('C7070', 'AMANDHA MARCELA PEREIRA GERN TORRES',
    { valorContrato: 2388, data: '06/08/2026', inicio: '02/09/2026' });
  assert.strictEqual(VA.opiniao(amandha, { codigo: 'C5044', valor: 239, data: '04/08/2026' }).suspeita,
    'provavelmente_nao_paga');

  // valor bate com o contrato: aí sim é provável que seja esta venda
  const bate = VA.opiniao(venda('C7130', 'X', { valorContrato: 2388, data: '01/08/2026' }),
    { codigo: 'C6867', valor: 2388, data: '15/08/2026' });
  assert.strictEqual(bate.suspeita, 'provavelmente_paga');
  assert.ok(/valor/i.test(bate.porque), bate.porque);

  // ⚠️ Pagamento anterior GANHA do valor que bate: um pagamento feito antes de
  // a venda existir não pode ser dela, por mais que o número coincida.
  const conflito = VA.opiniao(venda('C7130', 'X', { valorContrato: 2388, data: '27/08/2026' }),
    { codigo: 'C6867', valor: 2388, data: '12/08/2026' });
  assert.strictEqual(conflito.suspeita, 'provavelmente_nao_paga');

  // nenhum sinal: a opinião admite que não sabe
  const nada = VA.opiniao(venda('C7130', 'X', { valorContrato: 2388, data: '01/08/2026' }),
    { codigo: 'C6867', valor: 700, data: '15/08/2026' });
  assert.strictEqual(nada.suspeita, 'nao_da_para_dizer');

  // sem pagamento nenhum não há o que opinar
  assert.strictEqual(VA.opiniao(catia, null).suspeita, 'nao_da_para_dizer');

  // data quebrada não pode explodir nem virar palpite
  assert.strictEqual(VA.opiniao(venda('C1', 'X', { data: '' }),
    { codigo: 'C2', valor: 10, data: 'xx' }).suspeita, 'nao_da_para_dizer');

  ok('a opinião cobre os dois casos reais e admite quando não sabe');
}

console.log('\n' + n + '/' + n + ' casos passaram.');
