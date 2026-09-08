'use strict';
// Roda: node scripts/smoke-vendido-x-pago.js
//
// O painel "vendido × pago" (spec 2026-09-07) mostra os mesmos números na home
// e na aba "A receber". Se as duas telas contarem por caminhos diferentes elas
// vão divergir um dia — então a contagem mora aqui, no módulo puro, e as duas
// telas chamam a MESMA função.
//
// ⚠️ Duas contagens diferentes de propósito:
//    • o total do MÊS conta VENDA (a dividida conta uma vez)
//    • a tabela POR VENDEDORA conta para as DUAS (a comissão é dividida)
//    Somar a coluna da tabela e comparar com o total do mês vai dar diferente,
//    e isso está certo. O teste trava esse comportamento para ninguém
//    "consertar" depois.

const assert = require('assert');
const path = require('path');
const VA = require(path.join(__dirname, '..', 'vendas-aguardando.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);

/** venda como `extrair` devolve, só com o que a contagem usa */
const venda = (contrato, cliente, vendedores, extra) => ({
  contrato, cliente, vendedores, data: '05/08/2026', situacao: 'Matrícula',
  valorContrato: 1000, inicio: '05/08/2026', ...extra,
});

const NAO_COM = ['RODRIGO', 'RAFAEL ROJAIS', 'BENNY ELAND', 'SISTEMA'];

// ════════════════════════════════════════════════════════════════════
// 1. Contagem por vendedora
// ════════════════════════════════════════════════════════════════════
{
  const cruzado = {
    pagas:      [venda('C1', 'ANA', ['KALI DUTRA'])],
    aguardando: [venda('C2', 'BIA', ['KALI DUTRA']), venda('C3', 'CLARA', ['RODRIGO'])],
    conferir:   [venda('C4', 'DORA', ['BÁRBARA VIEIRA CARDOSO'])],
  };
  const t = VA.contarPorVendedora(cruzado, NAO_COM);

  assert.deepStrictEqual(t['KALI DUTRA'],
    { vendidas: 2, pagas: 1, aguardando: 1, conferir: 0, naoComissionado: false });
  assert.deepStrictEqual(t['BÁRBARA VIEIRA CARDOSO'],
    { vendidas: 1, pagas: 0, aguardando: 0, conferir: 1, naoComissionado: false });
  assert.strictEqual(t['RODRIGO'].naoComissionado, true, 'o Rodrigo vende e não recebe');
  ok('conta vendidas/pagas/aguardando/conferir por vendedora e marca quem não recebe');
}

// ════════════════════════════════════════════════════════════════════
// 2. Venda dividida conta para as DUAS
// ════════════════════════════════════════════════════════════════════
{
  const t = VA.contarPorVendedora(
    { pagas: [venda('C9', 'ELE', ['KALI DUTRA', 'BÁRBARA VIEIRA CARDOSO'])], aguardando: [], conferir: [] },
    NAO_COM);
  assert.strictEqual(t['KALI DUTRA'].pagas, 1);
  assert.strictEqual(t['BÁRBARA VIEIRA CARDOSO'].pagas, 1);
  ok('venda dividida conta para as duas vendedoras');
}

// ════════════════════════════════════════════════════════════════════
// 3. Venda sem vendedora não some
// ════════════════════════════════════════════════════════════════════
{
  const t = VA.contarPorVendedora({ pagas: [], aguardando: [venda('C8', 'ORFA', [])], conferir: [] }, NAO_COM);
  assert.strictEqual(t['(sem vendedora)'].aguardando, 1, 'venda órfã tem que aparecer, não sumir');
  ok('venda sem vendedora aparece como "(sem vendedora)"');
}

// ════════════════════════════════════════════════════════════════════
// 4. O resumo do mês conta VENDA, não vendedora
// ════════════════════════════════════════════════════════════════════
{
  const cruzado = {
    pagas:      [venda('C1', 'ANA', ['KALI DUTRA', 'BÁRBARA VIEIRA CARDOSO'])],
    aguardando: [venda('C2', 'BIA', ['KALI DUTRA'])],
    conferir:   [venda('C3', 'CLARA', ['RODRIGO'])],
  };
  assert.deepStrictEqual(VA.resumo(cruzado),
    { vendidas: 3, pagas: 1, aguardando: 1, conferir: 1, naoCobrar: 0 });

  const porV = VA.contarPorVendedora(cruzado, NAO_COM);
  const somaTabela = Object.values(porV).reduce((s, v) => s + v.vendidas, 0);
  assert.strictEqual(somaTabela, 4, 'a tabela soma 4 porque a venda dividida conta 2×');
  assert.notStrictEqual(somaTabela, VA.resumo(cruzado).vendidas,
    'e isso é de propósito — não "consertar" igualando as duas');
  ok('o resumo do mês conta 3 vendas; a tabela por vendedora soma 4, de propósito');
}

// ════════════════════════════════════════════════════════════════════
// 5. Resumo de um mês vazio
// ════════════════════════════════════════════════════════════════════
{
  assert.deepStrictEqual(VA.resumo({ pagas: [], aguardando: [], conferir: [] }),
    { vendidas: 0, pagas: 0, aguardando: 0, conferir: 0, naoCobrar: 0 });
  ok('mês sem nenhuma venda devolve zeros (quem trata "não sei" é a tela)');
}

// ════════════════════════════════════════════════════════════════════
// 6. O % de conversão só vale em mês que já terminou
// ════════════════════════════════════════════════════════════════════
// No dia 7 quase nada foi cobrado ainda: setembro/2026 marcava 0% nas duas
// unidades. Mostrar isso ao lado do nome de alguém é convite pra injustiça.
{
  const hoje = new Date(2026, 8, 7);            // 07/09/2026
  assert.strictEqual(VA.mesFechado(2026, 8, hoje), true,  'agosto já terminou');
  assert.strictEqual(VA.mesFechado(2026, 9, hoje), false, 'setembro está correndo');
  assert.strictEqual(VA.mesFechado(2025, 12, hoje), true, 'ano anterior também');
  assert.strictEqual(VA.mesFechado(2026, 10, hoje), false, 'mês futuro não é fechado');
  ok('mesFechado separa o mês corrente do que já terminou');
}

// ════════════════════════════════════════════════════════════════════
// 7. Uma leitura só, usada pelas duas telas
// ════════════════════════════════════════════════════════════════════
// Se a home e a aba lerem o banco por caminhos diferentes, um dia divergem —
// e o painel perde a serventia. Esta é a trava estrutural.
{
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(/async function carregarVendidoXPago\(/.test(html),
    'precisa existir um carregador único');
  // Aqui são 2: a definição e a chamada da aba. A terceira (o preenchedor das
  // duas homes) nasce depois, e o teste dela aperta este número para 3.
  const usos = [...html.matchAll(/carregarVendidoXPago\(/g)];
  assert.ok(usos.length >= 2,
    'o carregador tem que existir e ser chamado pela aba — achei ' + usos.length);
  // Só os DOIS carregadores podem cruzar: o do mês aberto e o do arrasto de
  // meses anteriores. Qualquer outra chamada é uma tela lendo por fora, e é
  // por aí que os números começam a divergir.
  const semCarregadores = html
    .replace(/async function carregarVendidoXPago\([\s\S]*?\n    \}/, '')
    .replace(/async function carregarArrastoAnterior\([\s\S]*?\n    \}/, '');
  assert.ok(!/VendasAguardando\.cruzar\(/.test(semCarregadores),
    'ninguém pode chamar cruzar() fora dos dois carregadores');
  ok('a leitura do banco mora nos carregadores; ninguém cruza por fora');
}

// ════════════════════════════════════════════════════════════════════
// 8. O bloco dos três números, e o que ele faz quando falta dado
// ════════════════════════════════════════════════════════════════════
// Roda a função DE VERDADE, recortada do index.html — ler o texto do arquivo
// não provaria nada (lição de `previa-nunca-rodou`).
{
  const fs = require('fs'), vm = require('vm');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const ini = html.indexOf('function blocoVendidoXPago(');
  assert.ok(ini > 0, 'blocoVendidoXPago não existe');
  let nivel = 0, fim = -1;
  for (let j = html.indexOf('{', ini); j < html.length; j++) {
    if (html[j] === '{') nivel++;
    else if (html[j] === '}') { nivel--; if (!nivel) { fim = j + 1; break; } }
  }
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(html.slice(ini, fim), sandbox);
  const bloco = sandbox.blocoVendidoXPago;

  // (a) mês sem lista de vendas: "não sei", nunca "zero"
  const semLista = bloco({ temLista: false, year: 2026, month: 9, fechado: false }, {});
  assert.ok(/lista de vendas/i.test(semLista), 'tem que explicar que falta a lista');
  assert.ok(!/>\s*0\s*</.test(semLista), 'não pode mostrar zero: ' + semLista);

  // (b) mês corrente: sem percentual
  const corrente = bloco({
    temLista: true, year: 2026, month: 9, fechado: false,
    resumo: { vendidas: 25, pagas: 0, aguardando: 25, conferir: 0 },
  }, {});
  assert.ok(/25/.test(corrente), 'mostra as 25 vendidas');
  assert.ok(!/%/.test(corrente), 'mês corrente não mostra percentual: ' + corrente);

  // (c) mês fechado: com percentual
  const fechado = bloco({
    temLista: true, year: 2026, month: 8, fechado: true,
    resumo: { vendidas: 74, pagas: 68, aguardando: 4, conferir: 2 },
  }, {});
  assert.ok(/92%/.test(fechado), '68 de 74 é 92%: ' + fechado);

  // (d) "conferir" nunca soma com "aguardando"
  assert.ok(/2 delas|2 podem/i.test(fechado),
    'as 2 de conferir têm que sair como nota, não somadas no aguardando: ' + fechado);
  ok('o bloco: sem lista não vira zero, % só em mês fechado, conferir não soma');
}

// ════════════════════════════════════════════════════════════════════
// 9. Venda de mês anterior sai do arrasto sozinha quando o dinheiro entra
// ════════════════════════════════════════════════════════════════════
// É a regra que justifica o bloco separado: a venda velha que nunca virou
// dinheiro é a que merece conversa. Se ela some quando é paga, ninguém cobra
// à toa; se não some, o bloco vira lixo e ninguém olha.
{
  const vendasAgosto = [venda('C4566', 'JAIR', ['KALI DUTRA']), venda('C4647', 'RAQUEL', ['KALI DUTRA'])];
  const semPagar = VA.cruzar(vendasAgosto, [], []);
  assert.strictEqual(semPagar.aguardando.length, 2, 'nada pago ainda');

  const comSetembro = VA.cruzar(vendasAgosto, ['C4566'], []);
  assert.strictEqual(comSetembro.pagas.length, 1);
  assert.strictEqual(comSetembro.aguardando.length, 1);
  assert.strictEqual(comSetembro.aguardando[0].cliente, 'RAQUEL',
    'quem foi paga em outro mês tem que sair do arrasto');
  ok('venda de mês anterior sai do arrasto sozinha quando o pagamento entra');
}

// ════════════════════════════════════════════════════════════════════
// 10. O carregador do arrasto existe, lê só meses anteriores e ignora o legado
// ════════════════════════════════════════════════════════════════════
{
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(/async function carregarArrastoAnterior/.test(html), 'falta carregarArrastoAnterior');
  const i = html.indexOf('async function carregarArrastoAnterior(');
  const trecho = html.slice(i, i + 2000);
  assert.ok(/< *mesAtual/.test(trecho),
    'tem que recortar só os meses ANTERIORES ao aberto: ' + trecho);
  assert.ok(/2026-08/.test(trecho),
    'tem que ignorar o que veio antes da numeração da Pacto (julho é do TecnoFit)');
  ok('o arrasto lê só meses anteriores, e nada antes de 2026-08');
}

// ════════════════════════════════════════════════════════════════════
// 11. As duas homes mostram o bloco, e a vendedora só vê o dela
// ════════════════════════════════════════════════════════════════════
{
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  // Recorta o CORPO da funcao, nao uma janela de N caracteres: assim o teste
  // prova que a chamada esta DENTRO da home, e nao numa funcao vizinha.
  const corpo = nome => {
    const i = html.indexOf(nome);
    assert.ok(i >= 0, 'nao achei ' + nome);
    const fim = html.indexOf('\n    }\n', i);
    return html.slice(i, fim);
  };
  const gestao = corpo('function renderAdminDashboard(');
  const vendedora = corpo('async function loadVendorPeriod(');

  assert.ok(/vendidoXPagoHome/.test(gestao), 'a home da gestão precisa do espaço do bloco');
  assert.ok(/vendidoXPagoVendedora/.test(vendedora), 'a home da vendedora também');
  assert.ok(/preencherVendidoXPago\(/.test(gestao) && /preencherVendidoXPago\(/.test(vendedora),
    'as duas precisam chamar o preenchedor');

  // Agora sim são 3: definição + aba + preenchedor (que serve as duas homes)
  const usos = [...html.matchAll(/carregarVendidoXPago\(/g)];
  assert.ok(usos.length >= 3, 'a aba e o preenchedor têm que usar o carregador — achei ' + usos.length);

  const j = html.indexOf('async function preencherVendidoXPago(');
  const preench = html.slice(j, j + 1600);
  assert.ok(/soDe/.test(preench), 'o preenchedor precisa saber de quem é a visão');
  assert.ok(/daVendedora\(/.test(preench),
    'a visão da vendedora tem que filtrar pelas vendas dela, não mostrar as das colegas');
  assert.ok(/carregarArrastoAnterior\(/.test(preench),
    'o bloco precisa do arrasto de meses anteriores');
  ok('as duas homes mostram o bloco, e o da vendedora é filtrado');
}

// ════════════════════════════════════════════════════════════════════
// 12. A aba "A receber": cabeçalho, tabela por vendedora e arrasto
// ════════════════════════════════════════════════════════════════════
// O cabeçalho é o MESMO bloco da home — se a aba montasse o dela, um dia os
// dois números iam divergir na mesma tela e ninguém saberia em qual acreditar.
{
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const corpo = nome => {
    const j = html.indexOf(nome);
    assert.ok(j >= 0, 'nao achei ' + nome);
    return html.slice(j, html.indexOf('\n    }\n', j));
  };

  const aba = corpo('async function renderAReceberTab(');
  assert.ok(/blocoVendidoXPago\(/.test(aba), 'a aba mostra o mesmo cabeçalho da home');
  assert.ok(/tabelaPorVendedora\(/.test(aba), 'a aba mostra a tabela por vendedora');
  assert.ok(/carregarArrastoAnterior\(/.test(aba), 'e o arrasto de meses anteriores');

  const tab = corpo('function tabelaPorVendedora(');
  assert.ok(/soDe/.test(tab), 'a tabela comparativa é só da gestão');
  assert.ok(/naoComissionado/.test(tab), 'quem não recebe comissão sai marcado e sem %');
  assert.ok(/fechado/.test(tab), 'o % só aparece em mês fechado');
  ok('a aba tem cabeçalho, tabela por vendedora e arrasto');
}

// ════════════════════════════════════════════════════════════════════
// 13. A tabela e o filtro da vendedora, RODANDO
// ════════════════════════════════════════════════════════════════════
// O caso 12 só confere que o texto está no arquivo. Isso não prova nada —
// é literalmente como a prévia de 24/08 passou por 12 testes sem nunca ter
// rodado. Aqui as duas funções são recortadas do index.html e chamadas.
{
  const fs = require('fs'), vm = require('vm');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  /** recorta uma função do index.html contando chaves */
  const recortar = nome => {
    const ini = html.indexOf(nome);
    assert.ok(ini > 0, nome + ' não existe');
    let nivel = 0, fim = -1;
    for (let j = html.indexOf('{', ini); j < html.length; j++) {
      if (html[j] === '{') nivel++;
      else if (html[j] === '}') { nivel--; if (!nivel) { fim = j + 1; break; } }
    }
    return html.slice(ini, fim);
  };

  const sandbox = { console, VendasAguardando: VA };
  vm.createContext(sandbox);
  vm.runInContext(recortar('function tabelaPorVendedora('), sandbox);
  vm.runInContext(recortar('function visaoDe('), sandbox);
  const tabela = sandbox.tabelaPorVendedora;
  const visaoDe = sandbox.visaoDe;

  // (a) a vendedora não vê a tabela comparativa — é o número das colegas
  assert.strictEqual(tabela({ 'KALI DUTRA': { vendidas: 3, pagas: 1, aguardando: 2, conferir: 0 } },
                            true, 'KALI DUTRA'), '',
    'a vendedora não pode ver o número das colegas');

  // De proposito na ordem ERRADA: o RODRIGO vendeu menos e entra primeiro.
  // Se o fixture ja viesse ordenado, a assercao de ordem la embaixo passaria
  // mesmo sem ordenacao nenhuma - conferido por mutacao.
  const porVend = {
    'RODRIGO':     { vendidas: 2, pagas: 2, aguardando: 0, conferir: 0, naoComissionado: true },
    'KALI DUTRA':  { vendidas: 4, pagas: 3, aguardando: 1, conferir: 0, naoComissionado: false },
  };

  // (b) mês fechado: coluna de conversão, e quem não recebe sai sem %
  const fechada = tabela(porVend, true, '');
  assert.ok(/Convertido/.test(fechada), 'mês fechado mostra a conversão');
  assert.ok(/n[ãa]o comission/i.test(fechada), 'o RODRIGO tem que sair marcado');
  // A linha da pessoa, não a tabela inteira: o `width:100%` da <table> é um
  // "100%" que não tem nada a ver com conversão, e um teste frouxo passaria
  // por ele achando que provou alguma coisa.
  const linhaRodrigo = fechada.split('<tr>').find(l => /RODRIGO/.test(l)) || '';
  assert.ok(/>—</.test(linhaRodrigo),
    'quem não recebe comissão mostra travessão, não %: ' + linhaRodrigo);
  assert.ok(!/\d+%/.test(linhaRodrigo),
    'nenhum percentual na linha de quem não recebe: ' + linhaRodrigo);
  const linhaKali = fechada.split('<tr>').find(l => /KALI/.test(l)) || '';
  assert.ok(/75%/.test(linhaKali), 'a conversão sai na linha de quem recebe: ' + linhaKali);

  // (c) mês corrente: sem coluna de conversão, e a tela explica por quê
  const corrente = tabela(porVend, false, '');
  assert.ok(!/Convertido/.test(corrente), 'mês corrente não mostra conversão');
  assert.ok(/quando o m[êe]s fecha/i.test(corrente), 'tem que explicar por que a coluna sumiu');

  // (d) a ordem é por quem mais vendeu — a tabela é para comparar
  assert.ok(corrente.indexOf('KALI DUTRA') < corrente.indexOf('RODRIGO'),
    'quem vendeu mais vem primeiro');

  // (e) sem ninguém, a tabela some em vez de virar um quadro vazio
  assert.strictEqual(tabela({}, true, ''), '');

  // (f) visaoDe: a gestão vê tudo, a vendedora só o dela — e a dividida entra
  const cruzado = {
    pagas:      [venda('C1', 'ANA', ['KALI DUTRA', 'BÁRBARA VIEIRA CARDOSO'])],
    aguardando: [venda('C2', 'BIA', ['BÁRBARA VIEIRA CARDOSO'])],
    conferir:   [],
  };
  const d = { temLista: true, cruzado, resumo: VA.resumo(cruzado) };
  assert.strictEqual(visaoDe(d, ''), d, 'sem soDe devolve o mesmo objeto');
  const dela = visaoDe(d, 'KALI DUTRA');
  assert.deepStrictEqual(dela.resumo, { vendidas: 1, pagas: 1, aguardando: 0, conferir: 0, naoCobrar: 0 },
    'a Kali vê a venda dividida como dela, e não vê a da colega');
  assert.deepStrictEqual(d.resumo, { vendidas: 2, pagas: 1, aguardando: 1, conferir: 0, naoCobrar: 0 },
    'o objeto da gestão não pode ser mutado pelo filtro');

  // (g) mês sem lista: filtrar não pode inventar zeros
  const semLista = { temLista: false, cruzado: null, resumo: null };
  assert.strictEqual(visaoDe(semLista, 'KALI DUTRA'), semLista,
    'sem lista, "não sei" continua "não sei" para a vendedora também');

  ok('a tabela por vendedora e o filtro da vendedora rodam de verdade');
}

// ════════════════════════════════════════════════════════════════════
// 14. Registro de teste não é venda de ninguém
// ════════════════════════════════════════════════════════════════════
// Em produção existe `TESTE ENDEREÇO TECNOFIT` (contrato C7117, R$ 150,
// 25/08/2026, no nome do Rodrigo). Ele aparecia na conta de agosto e virava
// tarefa de cobrança no arrasto de setembro.
//
// ⚠️ O casamento é por PALAVRA INTEIRA, não por pedaço. Existe uma cliente
// de verdade chamada `ESTEFANE COUTINHO CAMPOS`, e foi exatamente um
// casamento por pedaço que quebrou o BIANUAL em produção (commit 6f0a15b).
{
  assert.strictEqual(VA.ehTeste({ cliente: 'TESTE ENDEREÇO TECNOFIT' }), true);
  assert.strictEqual(VA.ehTeste({ cliente: 'Cliente Teste' }), true, 'minúscula também');
  assert.strictEqual(VA.ehTeste({ cliente: 'ESTEFANE COUTINHO CAMPOS' }), false,
    'ESTEFANE é uma cliente de verdade — nunca pode ser confundida com teste');
  assert.strictEqual(VA.ehTeste({ cliente: 'CELESTE MARIA' }), false);
  assert.strictEqual(VA.ehTeste({}), false, 'sem nome não é teste');
  assert.strictEqual(VA.ehTeste({ cliente: '' }), false);
  ok('registro de teste é reconhecido por palavra inteira, sem pegar cliente real');
}

// ════════════════════════════════════════════════════════════════════
// 15. O teste sai dos três grupos e não conta em lugar nenhum
// ════════════════════════════════════════════════════════════════════
// Sai na origem, dentro de `cruzar`, e não só no arrasto: se saísse só de lá,
// a gestão abriria "A receber" de agosto e o veria na lista de vendas a
// cobrar, mas ele sumiria do arrasto de setembro — a mesma família de telas
// se contradizendo.
{
  const vendas = [
    venda('C1', 'ANA', ['KALI DUTRA']),
    venda('C7117', 'TESTE ENDEREÇO TECNOFIT', ['RODRIGO'], { valorContrato: 150 }),
    venda('C3', 'ESTEFANE COUTINHO CAMPOS', ['KALI DUTRA']),
  ];
  const c = VA.cruzar(vendas, [], []);

  assert.strictEqual(c.aguardando.length, 2, 'só as duas vendas de verdade aguardam');
  assert.ok(!c.aguardando.some(v => /TESTE/.test(v.cliente)), 'o teste não pode aguardar nada');
  assert.ok(c.aguardando.some(v => v.cliente === 'ESTEFANE COUTINHO CAMPOS'),
    'a ESTEFANE tem que continuar na conta');
  assert.strictEqual(c.testes.length, 1, 'o que saiu fica registrado, não some calado');
  assert.strictEqual(c.testes[0].contrato, 'C7117');

  // e o resumo não pode contá-lo
  assert.deepStrictEqual(VA.resumo(c), { vendidas: 2, pagas: 0, aguardando: 2, conferir: 0, naoCobrar: 0 });

  // nem a tabela por vendedora — o Rodrigo tinha 7 vendas em agosto, uma era esta
  const t = VA.contarPorVendedora(c, NAO_COM);
  assert.ok(!t['RODRIGO'], 'o Rodrigo não vendeu nada de verdade neste fixture');

  // um teste já pago também sai: ele não é venda em nenhum estado
  const pago = VA.cruzar(vendas, ['C7117'], []);
  assert.strictEqual(pago.pagas.length, 0, 'teste pago continua não sendo venda');
  assert.strictEqual(pago.testes.length, 1);

  // e um teste cujo cliente pagou outra coisa não pode cair no "conferir"
  const conf = VA.cruzar(vendas, [], ['TESTE ENDEREÇO TECNOFIT']);
  assert.strictEqual(conf.conferir.length, 0, 'teste nunca vira dúvida para a gestão');
  assert.strictEqual(conf.testes.length, 1);

  ok('o registro de teste sai dos três grupos, do resumo e da tabela');
}

// ════════════════════════════════════════════════════════════════════
// 16. A tela DIZ o que tirou — nada some calado
// ════════════════════════════════════════════════════════════════════
// Sumir sem avisar é como a gestão fica procurando um número que não bate.
// A vendedora não vê a nota: registro de teste é assunto de quem administra.
{
  const fs = require('fs'), vm = require('vm');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const ini = html.indexOf('function blocoVendidoXPago(');
  let nivel = 0, fim = -1;
  for (let j = html.indexOf('{', ini); j < html.length; j++) {
    if (html[j] === '{') nivel++;
    else if (html[j] === '}') { nivel--; if (!nivel) { fim = j + 1; break; } }
  }
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(html.slice(ini, fim), sandbox);
  const bloco = sandbox.blocoVendidoXPago;

  const base = {
    temLista: true, year: 2026, month: 8, fechado: true,
    resumo: { vendidas: 73, pagas: 68, aguardando: 3, conferir: 2 },
  };

  const comTeste = bloco({ ...base, cruzado: { testes: [{ cliente: 'TESTE ENDEREÇO TECNOFIT' }] } }, {});
  assert.ok(/teste/i.test(comTeste), 'a gestão tem que saber que 1 registro ficou de fora: ' + comTeste);

  const semTeste = bloco({ ...base, cruzado: { testes: [] } }, {});
  assert.ok(!/registro de teste/i.test(semTeste), 'sem teste nenhum, nenhuma nota');

  const daVendedora = bloco({ ...base, cruzado: { testes: [{ cliente: 'TESTE X' }] } }, { soDe: 'KALI DUTRA' });
  assert.ok(!/registro de teste/i.test(daVendedora),
    'a vendedora não precisa saber do registro de teste da gestão');

  ok('a tela avisa que tirou o registro de teste, e só para a gestão');
}

// ════════════════════════════════════════════════════════════════════
// 17. Rótulo de tela grudado no nome do cliente
// ════════════════════════════════════════════════════════════════════
// Em produção, a MARIANA MINGHELLI BECKER está cadastrada na Pacto como
// `MARIANA MINGHELLI BECKER  VISÃO GERAL CADASTRO VE` — um rótulo de
// interface vazou para dentro do campo do nome (e o "VE" ainda está cortado
// pelo limite do campo). É o ÚNICO caso assim em toda a base.
//
// 💰 Ela NÃO é registro de teste: é uma renovação ANUAL de R$ 2.598,57
// vendida pela Erica em 07/08/2026 e até hoje sem pagamento. Ela TEM que
// continuar no arrasto — o que se limpa é o nome, não a venda.
{
  const SUJO = 'MARIANA MINGHELLI BECKER  VISÃO GERAL CADASTRO VE';

  assert.strictEqual(VA.limparNome(SUJO), 'MARIANA MINGHELLI BECKER');
  assert.strictEqual(VA.limparNome('MARIANA MINGHELLI BECKER'), 'MARIANA MINGHELLI BECKER',
    'nome limpo não pode ser mexido');

  // ⚠️ O corte é ancorado no rótulo, NUNCA no espaço duplo: um espaço a mais
  // digitado por engano apagaria o sobrenome de alguém, calado.
  assert.strictEqual(VA.limparNome('ANA  PAULA SOUZA'), 'ANA PAULA SOUZA',
    'espaço duplo só colapsa, jamais corta');
  assert.strictEqual(VA.limparNome('MARIA GERAL DA SILVA'), 'MARIA GERAL DA SILVA',
    '"GERAL" sozinho é palavra de nome, não rótulo');
  assert.strictEqual(VA.limparNome('CADASTRO DE OLIVEIRA'), 'CADASTRO DE OLIVEIRA',
    'só o rótulo INTEIRO corta, e nada corta o começo do nome');

  // nunca devolve vazio — sem nome nenhum a tela não tem o que mostrar
  assert.strictEqual(VA.limparNome('VISÃO GERAL CADASTRO'), 'VISÃO GERAL CADASTRO',
    'se sobrar vazio, devolve o original: melhor feio que em branco');
  assert.strictEqual(VA.limparNome(''), '');
  assert.strictEqual(VA.limparNome(null), '');

  ok('rótulo de tela sai do nome, e nome de gente fica intacto');
}

// ════════════════════════════════════════════════════════════════════
// 18. O nome limpo vale na tela E no cruzamento por nome
// ════════════════════════════════════════════════════════════════════
// O grupo "conferir" existe porque a renovação troca de número de contrato e o
// dinheiro continua caindo no antigo — e ele casa por NOME. O caso da Mariana é
// justamente uma Renovação: com o nome sujo de um lado e limpo do outro, o
// sistema diria "não pagou" no mês em que ela pagar. São R$ 2.598,57.
{
  const SUJO = 'MARIANA MINGHELLI BECKER  VISÃO GERAL CADASTRO VE';
  const vendas = [venda('C4588', SUJO, ['ERICA FAUSTINO'], { valorContrato: 2598.57 })];

  // (a) sem pagamento nenhum: continua aguardando, com o nome limpo na tela
  const so = VA.cruzar(vendas, [], []);
  assert.strictEqual(so.aguardando.length, 1, 'a venda dela NÃO pode sumir — é dinheiro a receber');
  assert.strictEqual(so.aguardando[0].cliente, 'MARIANA MINGHELLI BECKER');
  assert.strictEqual(so.aguardando[0].clienteOriginal, SUJO,
    'o nome como está na Pacto fica guardado — nada é reescrito calado');

  // (b) o dinheiro entrou em OUTRO contrato, e o recebimento traz o nome LIMPO
  const conf = VA.cruzar(vendas, [], ['MARIANA MINGHELLI BECKER']);
  assert.strictEqual(conf.conferir.length, 1,
    'nome sujo de um lado e limpo do outro tinham que casar mesmo assim');
  assert.strictEqual(conf.aguardando.length, 0);

  // (c) e o contrário: o recebimento é que vem sujo
  const conf2 = VA.cruzar([venda('C4588', 'MARIANA MINGHELLI BECKER', ['ERICA FAUSTINO'])], [], [SUJO]);
  assert.strictEqual(conf2.conferir.length, 1, 'o lado sujo pode ser qualquer um dos dois');

  // (d) nome limpo continua não casando com pessoa diferente
  const outra = VA.cruzar(vendas, [], ['MARIANA FIGUEIREDO DE SA']);
  assert.strictEqual(outra.aguardando.length, 1, 'outra Mariana não é ela');

  ok('o nome limpo vale nos dois lados do cruzamento, e a venda não some');
}

console.log('\n' + n + '/' + n + ' casos passaram.');
