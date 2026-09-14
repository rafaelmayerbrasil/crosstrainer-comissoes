'use strict';
// Roda: node scripts/smoke-pacto-sombra-comparacao.js
//
// A comparação do modo sombra: API × export arrastado, por cliente+dia, com a
// causa de cada divergência. Ativações saem do adapter e do motor REAIS.
// Dados INVENTADOS — o repositório é público.

const assert = require('assert');
const path = require('path');

const raiz = path.join(__dirname, '..');
const C = require(path.join(raiz, 'pacto-sombra-comparacao.js'));
const PA = require(path.join(raiz, 'pacto-adapter.js'));
const CE = require(path.join(raiz, 'commission.js'));
const L = require(path.join(raiz, 'pacto-api-linhas.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

const EMP = { CP: L.EMPRESA.CP, PP: L.EMPRESA.PP };
const ANUAL = 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO.';
function linha(o) {
  const r = new Array(22).fill('');
  const d = { matricula: '1', nome: 'FULANO FICTICIO', resp1: 'CONSULTORA TESTE UM', resp2: 'CONSULTORA TESTE UM',
    produto: '', contrato: '0', inicio: '', termino: '', duracao: '', plano: '', situacao: '',
    lancamento: '05/08/2026', valor: '10,00', forma: 'PIX', empresa: EMP.PP, consultor: 'CONSULTORA TESTE UM', ...o };
  Object.keys(PA.COL).forEach(k => { if (d[k] !== undefined) r[PA.COL[k]] = d[k]; });
  return r;
}
const contrato = (nome, num, dia, valor, extra) => linha({ nome, contrato: String(num), produto: ANUAL, plano: ANUAL,
  situacao: 'Matrícula', inicio: '01/08/2026', termino: '31/07/2027', duracao: '12', lancamento: dia, valor, ...(extra || {}) });

const base = { mes: '2026-08', unidade: 'PP', Adapter: PA, Engine: CE, ApiLinhas: L };

/* 1. tudo igual: nenhuma divergência, ativações iguais */
{
  const linhas = [contrato('CLIENTE UM', 100, '05/08/2026', '239,00'), linha({ nome: 'CLIENTE DOIS', produto: 'ÁGUA', valor: '5,00' })];
  const r = C.comparar({ ...base, linhasApi: linhas, linhasArquivo: [L.CABECALHO, ...linhas] });
  assert.strictEqual(r.divergencias.length, 0);
  assert.strictEqual(r.grupos, 2); assert.strictEqual(r.batem, 2);
  assert.strictEqual(r.api.recebido, 244); assert.strictEqual(r.arquivo.recebido, 244);
  assert.strictEqual(r.api.ativacoes.total, 1); assert.strictEqual(r.api.ativacoes.novo, 1);
  assert.deepStrictEqual(r.api.ativacoes, r.arquivo.ativacoes);
  assert.strictEqual(r.diferenca, 0);
  ok('lados iguais: zero divergência, mesmo recebido, mesmas ativações; cabeçalho do arquivo é ignorado');
}

/* 2. as causas */
{
  const api = [
    // mesmo contrato em outro dia: API em dois dias, arquivo junta no primeiro
    contrato('CLIENTE DIA', 200, '12/08/2026', '259,00'), contrato('CLIENTE DIA', 200, '28/08/2026', '259,00'),
    // parcela renegociada: mesmo contrato, valores diferentes
    contrato('CLIENTE RENEG', 300, '14/08/2026', '199,00'),
    // só na API: avulsa com recibo
    linha({ nome: 'CLIENTE SOAPI', produto: 'VENDA AVULSA', valor: '50,00', lancamento: '20/08/2026' }),
  ];
  const arquivo = [
    contrato('CLIENTE DIA', 200, '12/08/2026', '518,00'),
    contrato('CLIENTE RENEG', 300, '14/08/2026', '47,80'),
    // vendinha de balcão que a API não tem em pagamentos
    linha({ nome: 'PASSANTE', produto: 'SOFT BAR', valor: '12,00', lancamento: '10/08/2026' }),
    // crédito em conta: a API tirou (foraDeProposito), o arquivo tem como recorrente
    contrato('CLIENTE CREDITO', 400, '03/08/2026', '74,36', { forma: 'CARTÃO RECORRENTE' }),
    // só no arquivo, com contrato
    contrato('CLIENTE SOARQ', 500, '25/08/2026', '100,00'),
  ];
  const foraApi = [{ motivo: 'pago com crédito da conta do cliente — não é dinheiro novo', contrato: '400', valor: 74.36 }];
  const r = C.comparar({ ...base, linhasApi: api, linhasArquivo: arquivo, foraApi });
  const causa = nome => r.divergencias.filter(d => d.cliente === nome).map(d => d.causa);
  assert.deepStrictEqual(causa('CLIENTE DIA'), [C.CAUSAS.DIA, C.CAUSAS.DIA], JSON.stringify(r.divergencias));
  assert.deepStrictEqual(causa('CLIENTE RENEG'), [C.CAUSAS.VALOR]);
  assert.deepStrictEqual(causa('CLIENTE SOAPI'), [C.CAUSAS.SO_API]);
  assert.deepStrictEqual(causa('PASSANTE'), [C.CAUSAS.BALCAO]);
  assert.deepStrictEqual(causa('CLIENTE CREDITO'), [C.CAUSAS.CREDITO]);
  assert.deepStrictEqual(causa('CLIENTE SOARQ'), [C.CAUSAS.SO_ARQUIVO]);
  ok('as seis causas: outro dia, renegociada, só API, balcão, crédito em conta, só arquivo');

  const soma = Object.values(r.porCausa).reduce((s, x) => s + x.valor, 0);
  assert.strictEqual(Math.round(soma * 100) / 100, r.diferenca, 'as causas explicam a diferença inteira');
  assert.strictEqual(r.porCausa[C.CAUSAS.DIA].valor, 0, 'dia trocado zera no mês');
  // API: 259 + 259 + 199 + 50 = 767 · arquivo: 518 + 47,80 + 12 + 74,36 + 100 = 752,16
  assert.strictEqual(r.diferenca, 14.84);
  ok('a soma por causa fecha exatamente a diferença do mês');

  const dias = r.divergencias.map(d => d.dia);
  assert.deepStrictEqual(dias, [...dias].sort(), 'em ordem de dia');
  ok('divergências em ordem de dia');
}

/* 3. matrícula separada no arquivo não muda ativação */
{
  const api = [contrato('CLIENTE MAT', 600, '12/08/2026', '319,00')];
  const arquivo = [
    linha({ nome: 'CLIENTE MAT', contrato: '600', produto: 'MATRÍCULA', plano: ANUAL, situacao: 'Matrícula',
      inicio: '01/08/2026', termino: '31/07/2027', duracao: '12', lancamento: '12/08/2026', valor: '100,00' }),
    contrato('CLIENTE MAT', 600, '12/08/2026', '219,00'),
  ];
  const r = C.comparar({ ...base, linhasApi: api, linhasArquivo: arquivo });
  assert.strictEqual(r.divergencias.length, 0, 'o valor somado do dia é o mesmo');
  assert.strictEqual(r.api.ativacoes.total, 1);
  assert.strictEqual(r.arquivo.ativacoes.total, 1, 'a matrícula não é ativação a mais');
  ok('matrícula em linha separada no arquivo: mesma soma e mesma ativação');
}

/* 3b. duas parcelas do mesmo contrato em dias diferentes = UMA ativação */
{
  const api = [contrato('CLIENTE DUAS', 800, '12/08/2026', '259,00'), contrato('CLIENTE DUAS', 800, '28/08/2026', '259,00')];
  const arquivo = [contrato('CLIENTE DUAS', 800, '12/08/2026', '518,00')];
  const r = C.comparar({ ...base, linhasApi: api, linhasArquivo: arquivo });
  assert.strictEqual(r.api.ativacoes.total, 1, 'duas parcelas não podem virar duas ativações: ' + r.api.ativacoes.total);
  assert.deepStrictEqual(r.api.ativacoes, r.arquivo.ativacoes);
  assert.strictEqual(r.api.recebido, 518, 'o dinheiro continua somado');
  assert.ok(r.divergencias.length && r.divergencias.every(d => d.causa === C.CAUSAS.DIA), 'e a divergência por dia continua com a data real');
  ok('duas parcelas do mesmo contrato no mês contam uma ativação, e o dinheiro segue por dia');
}

/* 4. só a unidade e o mês pedidos */
{
  const api = [contrato('CLIENTE PP', 700, '05/08/2026', '100,00'),
    contrato('CLIENTE CP', 701, '05/08/2026', '100,00', { empresa: EMP.CP }),
    contrato('CLIENTE JULHO', 702, '31/07/2026', '100,00')];
  const r = C.comparar({ ...base, linhasApi: api, linhasArquivo: [] });
  assert.strictEqual(r.api.linhas, 1);
  assert.strictEqual(r.api.recebido, 100);
  ok('filtra a unidade e o mês antes de somar');
}

/* 5. Campeche não compara vendedora */
{
  const r = C.comparar({ ...base, unidade: 'CP', linhasApi: [], linhasArquivo: [] });
  assert.strictEqual(r.compararVendedora, false);
  assert.strictEqual(C.comparar({ ...base, linhasApi: [], linhasArquivo: [] }).compararVendedora, true);
  assert.strictEqual(r.api.ativacoes.total, 0);
  ok('no Campeche a vendedora não é comparada; lados vazios não quebram');
}

/* 6. sem Adapter/Engine é erro, não silêncio */
{
  assert.throws(() => C.comparar({ mes: '2026-08', unidade: 'PP', linhasApi: [], linhasArquivo: [] }), /obrigatórios/);
  assert.throws(() => C.comparar({ ...base, ApiLinhas: undefined, linhasApi: [], linhasArquivo: [] }), /ApiLinhas/);
  ok('sem o adapter e o motor a comparação recusa');
}

console.log('\n✅ smoke-pacto-sombra-comparacao: ' + n + '/9');
