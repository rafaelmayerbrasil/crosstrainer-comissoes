'use strict';
// Roda: node scripts/smoke-pacto-coluna-nova.js
//
// Em setembro/2026 a Pacto acrescentou a coluna `Quantidade` entre `Produto` e
// `Contrato`. O tradutor lia tudo por POSIÇÃO, então a partir dali cada campo
// andou uma casa: a assinatura ("Data Lançamento" na posição 14) deixou de
// casar, o arquivo não foi reconhecido como da Pacto e a tela disse "Nenhum
// dado encontrado no arquivo". Pior seria se a assinatura casasse por acaso:
// leria `Situação` no lugar da data e a data no lugar do valor, calado.
//
// A correção acha as colunas pelo NOME do cabeçalho e rearruma a linha no
// layout de sempre (`PactoAdapter.COL`). Este teste prova que o layout novo dá
// EXATAMENTE a mesma tradução do antigo — e que coluna faltando não é
// adivinhada.

const assert = require('assert');
const path = require('path');
const PA = require(path.join(__dirname, '..', 'pacto-adapter.js'));
const VA = require(path.join(__dirname, '..', 'vendas-aguardando.js'));

let n = 0;
const ok = msg => { n++; console.log('  ✓ ' + msg); };

// Cabeçalho real do export de agosto/2026 (com os espaços e o Responsável duplicado)
const CAB_ANTIGO = ['', 'Matrícula', 'Nome Cliente', 'Data Cadastro', 'Responsável ', 'Responsável ',
  'Produto', 'Contrato', 'Data Início', 'Data Término', 'Duração', 'Modalidades', 'Plano',
  'Situação Contrato', 'Data Lançamento', 'Valor', 'Forma Pagamento', 'Condição Pagamento',
  'Empresa', 'Turma', 'Categoria', 'Consultor ', '', ''];

function linha(o) {
  const r = new Array(24).fill('');
  const d = {
    nome: 'FULANO DE TAL', matricula: '1', cadastro: '01/09/2026',
    resp1: 'ERICA FAUSTINO', resp2: 'ERICA FAUSTINO', contrato: '0', inicio: '', termino: '',
    duracao: '0', modalidades: '', plano: '', situacao: '', lancamento: '05/09/2026',
    valor: '100,00', forma: 'CARTÃO DE CRÉDITO', condicao: '1X',
    empresa: '(CP) CROSSTAINER UNID. CAMPECHE ', turma: '', categoria: '', produto: '',
    consultor: 'ERICA FAUSTINO', ...o,
  };
  Object.keys(PA.COL).forEach(k => { r[PA.COL[k]] = d[k]; });
  return r;
}

const ANTIGO = [
  CAB_ANTIGO,
  linha({ nome: 'ANA PAULA', contrato: '7150', duracao: '12', inicio: '02/09/2026', termino: '01/09/2027',
    produto: 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO | CP.',
    plano: 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO | CP.', situacao: 'Matrícula', valor: '259,00' }),
  linha({ nome: 'ANA PAULA', contrato: '7150', produto: 'MATRÍCULA', situacao: 'Matrícula', valor: '100,00' }),
  linha({ nome: 'BRUNO SOUZA', produto: '1 AULA', valor: '60,00', forma: 'PIX',
    empresa: '(PP) CROSSTAINER UNID. PEQ PRÍNCIPE ', resp1: 'KALI LÓPEZ', resp2: 'KALI LÓPEZ', consultor: 'KALI LÓPEZ' }),
  linha({ nome: 'CARLA DIAS', contrato: '7160', duracao: '1', inicio: '10/09/2026', termino: '09/10/2026',
    produto: 'TOI | RECORRENTE | ILIMITADO | PADRÃO.', plano: 'TOI | RECORRENTE | ILIMITADO | PADRÃO.',
    situacao: 'Renovação', valor: '1.289,90', resp2: 'RECORRENCIA' }),
  ['', '', 'Total', '', '', '', '', '', '', '', '', '', '', '', '', '1.808,90'],   // rodapé
];

// Layout de setembro/2026: `Quantidade` inserida depois de `Produto`
const comQuantidade = (linhas, pos = 7) => linhas.map((l, i) => {
  const c = l.slice();
  c.splice(pos, 0, i === 0 ? 'Quantidade' : (c[2] && c[2] !== 'Total' ? '1' : ''));
  return c;
});
const NOVO = comQuantidade(ANTIGO);

// ─── 1. o arquivo novo é reconhecido ───
assert.strictEqual(PA.ehExportPacto(NOVO), true, 'layout novo não reconhecido');
assert.strictEqual(PA.ehExportPacto(ANTIGO), true, 'layout antigo deixou de ser reconhecido');
ok('o export com a coluna Quantidade é reconhecido como da Pacto');

// ─── 2. qual relatório é continua certo ───
assert.strictEqual(PA.detectarRelatorio(NOVO), 'recebido');
const semForma = rows => rows.map((l, i) => { const c = l.slice(); if (i > 0) c[PA.COL.forma] = ''; return c; });
assert.strictEqual(PA.detectarRelatorio(comQuantidade(semForma(ANTIGO))), 'faturamento');
ok('recebido × faturamento continua detectado no layout novo');

// ─── 3. a tradução é idêntica nos dois layouts ───
const tAnt = PA.traduzir(ANTIGO, {});
const tNov = PA.traduzir(NOVO, {});
assert.strictEqual(tNov.mes, '2026-09');
assert.ok(tAnt.vendas.length >= 3, 'fixture não produziu vendas: ' + tAnt.vendas.length);
assert.deepStrictEqual(tNov, tAnt);
assert.deepStrictEqual(PA.paraPlanilha(tNov.porUnidade.CP), PA.paraPlanilha(tAnt.porUnidade.CP));
ok('a tradução do layout novo é idêntica à do antigo (' + tAnt.vendas.length + ' vendas)');

// ─── 4. a conferência de vendas também ───
assert.deepStrictEqual(VA.extrair(comQuantidade(semForma(ANTIGO))), VA.extrair(semForma(ANTIGO)));
assert.ok(Object.keys(VA.extrair(semForma(ANTIGO))).length > 0, 'fixture de vendas vazia');
ok('o relatório de vendas com a coluna nova dá as mesmas vendas para conferência');

// ─── 5. a coluna nova em qualquer lugar, e mais de uma ───
const embaralhado = comQuantidade(comQuantidade(ANTIGO, 1), 20);
assert.deepStrictEqual(PA.traduzir(embaralhado, {}), tAnt);
ok('coluna nova em outra posição (ou duas colunas novas) não muda nada');

// ─── 6. o layout antigo passa intocado, e normalizar duas vezes não muda ───
assert.strictEqual(PA.normalizarColunas(ANTIGO), ANTIGO, 'layout antigo deveria voltar o mesmo array');
const uma = PA.normalizarColunas(NOVO);
assert.strictEqual(PA.normalizarColunas(uma), uma);
assert.strictEqual(uma[0][PA.COL.lancamento].trim(), 'Data Lançamento');
assert.strictEqual(uma[0][PA.COL.resp1].trim(), 'Responsável');
assert.strictEqual(uma[0][PA.COL.resp2].trim(), 'Responsável');
ok('layout antigo volta sem cópia; normalizar é idempotente e mantém os dois Responsável');

// ─── 7. coluna que SUMIU não é adivinhada ───
const semValor = NOVO.map(l => l.filter((_, i) => i !== 17));   // 17 = Valor no layout novo
assert.strictEqual(PA.ehExportPacto(semValor), false, 'arquivo sem a coluna Valor foi aceito');
ok('arquivo sem uma coluna obrigatória continua recusado, sem ler campo errado');

// ─── 8. linhas sem cabeçalho (as da API, montadas já no layout) passam direto ───
const semCab = ANTIGO.slice(1);
assert.strictEqual(PA.normalizarColunas(semCab), semCab);
ok('linhas sem cabeçalho (modo sombra) passam direto');

console.log('\n' + n + '/' + n + ' casos passaram.');
