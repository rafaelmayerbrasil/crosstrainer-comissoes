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

console.log('\n' + n + '/' + n + ' casos passaram.');
