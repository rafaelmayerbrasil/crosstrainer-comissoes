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

  // ⚠️ Pagamento anterior E valor que bate se contradizem — não é mais a data
  // decidindo sozinha (ver caso 9, sessão 2026-09-07: lançamento atrasado).
  const conflito = VA.opiniao(venda('C7130', 'X', { valorContrato: 2388, data: '27/08/2026' }),
    { codigo: 'C6867', valor: 2388, data: '12/08/2026' });
  assert.strictEqual(conflito.suspeita, 'nao_da_para_dizer');

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

// ════════════════════════════════════════════════════════════════════
// 8. O R$ do "porque" é brasileiro — vírgula decimal, nunca ponto cru
// ════════════════════════════════════════════════════════════════════
// Esta base já foi pega nisso na tela de fechamento da folha: `.toFixed(2)`
// cru sai "239.00", com PONTO — e o "porque" vai direto pra tela de quem
// administra a academia. Se alguém voltar pro `.toFixed(2)` cru, os dois
// asserts abaixo quebram.
{
  const semMilhar = VA.opiniao(
    venda('C7130', 'X', { valorContrato: 2388, data: '27/08/2026' }),
    { codigo: 'C6867', valor: 239, data: '04/08/2026' });
  assert.ok(semMilhar.porque.includes('R$ 239,00'),
    'esperava vírgula decimal (R$ 239,00): ' + semMilhar.porque);
  assert.ok(!semMilhar.porque.includes('R$ 239.00'),
    'ponto decimal cru vazou pro texto: ' + semMilhar.porque);

  const comMilhar = VA.opiniao(
    venda('C7130', 'X', { valorContrato: 2388, data: '01/08/2026' }),
    { codigo: 'C6867', valor: 2388, data: '15/08/2026' });
  assert.ok(comMilhar.porque.includes('R$ 2.388,00'),
    'esperava ponto de milhar + vírgula decimal (R$ 2.388,00): ' + comMilhar.porque);
  assert.ok(!comMilhar.porque.includes('R$ 2388.00') && !comMilhar.porque.includes('R$ 2,388.00'),
    'formato americano vazou pro texto: ' + comMilhar.porque);

  ok('o "porque" usa R$ no formato brasileiro (vírgula decimal, ponto de milhar), nunca ponto decimal cru');
}

// ════════════════════════════════════════════════════════════════════
// 9. Pagamento anterior e valor que bate se contradizem — a data não decide
//    mais sozinha (decisão do Rafael em 07/09/2026, revisão de código)
// ════════════════════════════════════════════════════════════════════
// Numa academia é comum o cliente pagar no dia da negociação e o contrato só
// ser lançado no sistema alguns dias depois: o pagamento é desta venda, só
// que datado antes de `venda.data` por causa do atraso de lançamento. Quando
// isso coincide com o valor batendo exato, a data e o valor apontam para
// lados opostos — e a resposta vira "não dá para dizer", com os dois fatos.
{
  // 1. pagamento anterior + valor exato → não dá para dizer, citando os dois
  //    valores e as duas datas
  const contradiz = VA.opiniao(
    venda('C7130', 'X', { valorContrato: 2388, data: '27/08/2026' }),
    { codigo: 'C6867', valor: 2388, data: '12/08/2026' });
  assert.strictEqual(contradiz.suspeita, 'nao_da_para_dizer');
  assert.ok(contradiz.porque.includes('R$ 2.388,00'),
    'tem que citar o valor pago: ' + contradiz.porque);
  assert.ok(contradiz.porque.includes('12/08/2026'),
    'tem que citar a data do pagamento: ' + contradiz.porque);
  assert.ok(contradiz.porque.includes('27/08/2026'),
    'tem que citar a data em que a venda foi fechada: ' + contradiz.porque);

  // 2. pagamento anterior + valor DIFERENTE → continua provavelmente_nao_paga
  //    (a Cátia continua exatamente como está)
  const catiaDeNovo = VA.opiniao(
    venda('C7130', 'CÁTIA TEREZINHA PEREIRA TORRES',
      { valorContrato: 2388, data: '27/08/2026', inicio: '02/09/2026' }),
    { codigo: 'C6867', valor: 199, data: '12/08/2026' });
  assert.strictEqual(catiaDeNovo.suspeita, 'provavelmente_nao_paga');

  // 3. valor exato + pagamento no mesmo dia ou depois → provavelmente_paga,
  //    citando os DOIS números de contrato (o desta venda e o do pagamento)
  const paga = VA.opiniao(
    venda('C7130', 'X', { valorContrato: 2388, data: '01/08/2026' }),
    { codigo: 'C6867', valor: 2388, data: '15/08/2026' });
  assert.strictEqual(paga.suspeita, 'provavelmente_paga');
  assert.ok(paga.porque.includes('C7130'),
    'tem que citar o contrato desta venda: ' + paga.porque);
  assert.ok(paga.porque.includes('C6867'),
    'tem que citar o contrato em que o dinheiro entrou: ' + paga.porque);

  // mesmo dia (não é "anterior") também conta como provavelmente_paga
  const mesmoDia = VA.opiniao(
    venda('C7130', 'X', { valorContrato: 2388, data: '15/08/2026' }),
    { codigo: 'C6867', valor: 2388, data: '15/08/2026' });
  assert.strictEqual(mesmoDia.suspeita, 'provavelmente_paga');

  ok('pagamento anterior e valor exato se contradizem: não dá para dizer, com os dois fatos');
}

// ════════════════════════════════════════════════════════════════════
// 10. A ordem de quem manda — e o dinheiro sempre ganha
// ════════════════════════════════════════════════════════════════════
// ⚠️ ESTE É O CASO QUE MAIS IMPORTA. Se uma marcação humana puder esconder
// dinheiro que entrou de verdade, esta tela mente.
{
  const cruzado = {
    pagas:      [venda('C1', 'ANA')],
    aguardando: [venda('C2', 'BIA'), venda('C3', 'CLARA')],
    conferir:   [venda('C4', 'DORA')],
    testes:     [],
    porVendedora: {},
  };

  // (a) sem marcação nenhuma, nada muda
  const zero = VA.aplicarConferencias(cruzado, {});
  assert.strictEqual(zero.pagas.length, 1);
  assert.strictEqual(zero.aguardando.length, 2);
  assert.strictEqual(zero.conferir.length, 1);
  assert.strictEqual(zero.naoCobrar.length, 0);

  // (b) "já foi paga" vira paga; "não vamos cobrar" sai dos três
  const marcado = VA.aplicarConferencias(cruzado, {
    C4: { desfecho: 'paga_outro_contrato', por: 'Rafael', em: '07/09/2026' },
    C2: { desfecho: 'nao_cobrar', por: 'Rafael', em: '07/09/2026', observacao: 'cliente desistiu' },
    C3: { desfecho: 'a_receber', por: 'Rafael', em: '07/09/2026' },
  });
  assert.deepStrictEqual(marcado.pagas.map(v => v.contrato), ['C1', 'C4']);
  assert.deepStrictEqual(marcado.aguardando.map(v => v.contrato), ['C3']);
  assert.strictEqual(marcado.conferir.length, 0);
  assert.deepStrictEqual(marcado.naoCobrar.map(v => v.contrato), ['C2']);

  // a venda marcada carrega o registro, para a tela poder mostrar quem e quando
  assert.strictEqual(marcado.aguardando[0].conferencia.por, 'Rafael');
  assert.strictEqual(marcado.naoCobrar[0].conferencia.observacao, 'cliente desistiu');

  // (c) 🚨 O DINHEIRO SEMPRE GANHA: marcada "não vamos cobrar", mas o contrato
  //     apareceu nos recebimentos → volta a contar como paga, e a tela DIZ que
  //     estava marcada de outro jeito.
  const comDinheiro = VA.aplicarConferencias({
    ...cruzado,
    pagas: [venda('C1', 'ANA'), venda('C2', 'BIA')],   // a C2 foi paga de verdade
    aguardando: [venda('C3', 'CLARA')],
  }, { C2: { desfecho: 'nao_cobrar', por: 'Rafael', em: '07/09/2026' } });

  assert.deepStrictEqual(comDinheiro.pagas.map(v => v.contrato), ['C1', 'C2'],
    'pagamento de verdade GANHA da marcação humana');
  assert.strictEqual(comDinheiro.naoCobrar.length, 0);
  const c2 = comDinheiro.pagas.find(v => v.contrato === 'C2');
  assert.strictEqual(c2.marcacaoIgnorada.desfecho, 'nao_cobrar',
    'a tela precisa DIZER que havia uma marcação em contrário');

  // (d) a soma sempre fecha
  const soma = marcado.pagas.length + marcado.aguardando.length
             + marcado.conferir.length + marcado.naoCobrar.length;
  assert.strictEqual(soma, 4, 'vendidas = pagas + aguardando + conferir + naoCobrar');

  // (e) marcação de contrato que não existe no mês é ignorada, sem quebrar
  const fantasma = VA.aplicarConferencias(cruzado, { C999: { desfecho: 'nao_cobrar' } });
  assert.strictEqual(fantasma.naoCobrar.length, 0);

  // (f) desfecho desconhecido não move a venda de lugar
  const estranho = VA.aplicarConferencias(cruzado, { C2: { desfecho: 'sei_la' } });
  assert.deepStrictEqual(estranho.aguardando.map(v => v.contrato), ['C2', 'C3']);

  ok('a ordem de quem manda; e o dinheiro sempre ganha da marcação');
}

// ════════════════════════════════════════════════════════════════════
// 11. O resumo conta o "não vamos cobrar" à parte, sem tirar de "vendidas"
// ════════════════════════════════════════════════════════════════════
// A venda dada por perdida foi vendida de verdade: sai das que ainda esperam
// dinheiro, não da história do mês.
{
  const r = VA.resumo({
    pagas: [1, 2, 3], aguardando: [4], conferir: [5], naoCobrar: [6, 7],
  });
  assert.deepStrictEqual(r, { vendidas: 7, pagas: 3, aguardando: 1, conferir: 1, naoCobrar: 2 });

  // sem o grupo novo, continua valendo como antes
  const velho = VA.resumo({ pagas: [1], aguardando: [2], conferir: [] });
  assert.deepStrictEqual(velho, { vendidas: 2, pagas: 1, aguardando: 1, conferir: 0, naoCobrar: 0 });

  ok('o resumo conta o "não vamos cobrar" à parte, sem tirar de vendidas');
}

// ════════════════════════════════════════════════════════════════════
// 12. A regra do banco existe, e o write é só de Admin
// ════════════════════════════════════════════════════════════════════
// Esconder o botão não basta: link direto existe. Foi assim que o vazamento
// de salário do fechamento aconteceu.
{
  const fs = require('fs');
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  const i = rules.indexOf('match /vendas_conferencia/');
  assert.ok(i > 0, 'falta a regra de vendas_conferencia');
  const bloco = rules.slice(i, rules.indexOf('}', rules.indexOf('allow write', i)) + 1);

  assert.ok(/allow read:/.test(bloco), 'precisa liberar leitura para quem vê o painel');
  assert.ok(/allow write:[^;]*isAdmin\(\)/.test(bloco),
    'o write tem que exigir isAdmin() na REGRA, não só na tela: ' + bloco);
  assert.ok(!/allow read, write/.test(bloco),
    'read e write não podem sair na mesma linha — o write é mais restrito');

  ok('a regra existe e o write exige Admin no servidor');
}

// ════════════════════════════════════════════════════════════════════
// 13. O carregador para de achatar o mês, e lê as conferências
// ════════════════════════════════════════════════════════════════════
{
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const i = html.indexOf('async function carregarVendidoXPago(');
  assert.ok(i > 0, 'falta carregarVendidoXPago');
  // index.html é CRLF de ponta a ponta — '\n    }\n' nunca casa (não há LF
  // solto no arquivo) e o indexOf volta -1, que faz slice(i, -1) engolir
  // quase o arquivo inteiro em vez de só a função. Recorte tem que ser CRLF.
  const carregador = html.slice(i, html.indexOf('\r\n    }\r\n', i));

  assert.ok(/vendas_conferencia/.test(carregador),
    'o carregador tem que ler as conferências');
  assert.ok(/aplicarConferencias\(/.test(carregador),
    'e aplicá-las antes de resumir');
  // Casa com `{ codigo: c, mes, data }` — o `mes` entra abreviado, então
  // procurar por "mes:" daria falso negativo.
  assert.ok(/pagos\.push\(\{[^}]*\bmes\b/.test(carregador),
    'os códigos pagos têm que carregar de qual mês vieram');
  assert.ok(/codigo:/.test(carregador),
    'e o lançamento inteiro tem que ir como prova');

  // a conta só pode ser feita DEPOIS de aplicar as marcações, senão o resumo
  // e a tabela contam a venda no grupo errado
  assert.ok(carregador.indexOf('aplicarConferencias(') < carregador.indexOf('VendasAguardando.resumo('),
    'aplicar as conferências vem ANTES de resumir');

  ok('o carregador lê as conferências e guarda de qual mês veio cada pagamento');
}

console.log('\n' + n + '/' + n + ' casos passaram.');
