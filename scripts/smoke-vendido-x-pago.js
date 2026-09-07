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
    { vendidas: 3, pagas: 1, aguardando: 1, conferir: 1 });

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
    { vendidas: 0, pagas: 0, aguardando: 0, conferir: 0 });
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

console.log('\n' + n + '/' + n + ' casos passaram.');
