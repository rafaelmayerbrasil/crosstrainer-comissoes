'use strict';
// Roda: node scripts/smoke-degustacao-gratis.js
//
// Degustação GRÁTIS (R$ 0,00) segue a regra de sempre do TecnoFit: entra, paga
// o voucher fixo e conta como ativação (decisão do Rafael, 29/09/2026).
//
// Ela não tem recebimento, então nunca aparece no `faturamento-recebido` — só
// no relatório de VENDAS. Caso real: LUIZ HENRIQUE APPEL, contrato 4638, PP,
// lançada em 25/08/2026 pela Kali, consultora Bárbara. Sem este caminho a
// venda some em silêncio: não paga o voucher e não conta na meta da unidade.
//
// A corrente testada é a da tela, chamando as funções de verdade:
//   relatório de vendas → PactoAdapter.degustacoesGratis (guardado no período)
//   relatório de recebidos → PactoAdapter.traduzir → juntarDegustacoes → CommissionEngine

const assert = require('assert');
const path = require('path');
const raiz = path.join(__dirname, '..');
const PA = require(path.join(raiz, 'pacto-adapter.js'));
const CE = require(path.join(raiz, 'commission.js'));

const PP = 'CROSSTAINER UNID. PRINCIPE (PP)';
const CP = 'CROSSTAINER UNID. CAMPECHE (CP)';
function linha(o) {
  const r = new Array(22).fill('');
  const d = {
    matricula: '1', nome: 'FULANO', cadastro: '01/08/2026',
    resp1: 'KALI LÓPEZ', resp2: 'KALI LÓPEZ', produto: '', contrato: '0',
    inicio: '', termino: '', duracao: '1', modalidades: '', plano: '', situacao: 'Matrícula',
    lancamento: '25/08/2026', valor: '0,00', forma: '',
    condicao: 'EM 1 VEZ - CARTÃO RECORRÊNCIA', empresa: PP, turma: '', categoria: '',
    consultor: 'KALI LÓPEZ', ...o,
  };
  Object.keys(PA.COL).forEach(k => { r[PA.COL[k]] = d[k] === undefined ? '' : d[k]; });
  return r;
}
const cab = linha({ nome: 'Nome Cliente', lancamento: 'Data Lançamento' });

// Um contrato de degustação no relatório de vendas vem em 3 linhas: matrícula,
// taxa de anuidade e o plano — as três de R$ 0,00 quando é grátis.
function degustacao(o) {
  const base = { plano: 'MÊS DEGUSTAÇÃO LIVRE.', inicio: '25/08/2026', termino: '24/09/2026', ...o };
  return [
    linha({ ...base, produto: 'MATRÍCULA', valor: '0,00' }),
    linha({ ...base, produto: 'TAXA DE ANUIDADE PLANO RECORRÊNCIA', valor: '0,00' }),
    linha({ ...base, produto: 'MÊS DEGUSTAÇÃO LIVRE. - 1 - cod. 155', valor: o.valorPlano || '0,00' }),
  ];
}

const relatorioVendas = [
  cab,
  // o caso real: grátis, lançada pela Kali, consultora Bárbara
  ...degustacao({ nome: 'LUIZ HENRIQUE APPEL', contrato: '4638', consultor: 'BÁRBARA VIEIRA CARDOSO' }),
  // degustação PAGA (R$ 89): vem pelo relatório de recebidos, aqui não entra
  ...degustacao({ nome: 'DIEGO PANELLA', contrato: '4655', valorPlano: '89,00', lancamento: '31/08/2026' }),
  // grátis no Campeche, consultora = Rodrigo → vai para quem lançou (regra de 24/09)
  ...degustacao({ nome: 'MIGUEL STADLER', contrato: '7090', empresa: CP, resp1: 'ERICA FAUSTINO',
                  resp2: 'ERICA FAUSTINO', consultor: 'RODRIGO ROJAIS', lancamento: '17/08/2026' }),
  // registro de teste da Pacto, grátis: não é cliente
  ...degustacao({ nome: 'TESTE ENDERECO TECNOFIT', contrato: '4700' }),
  // contrato de R$ 0,00 que NÃO é degustação (ajuste da migração): fora
  linha({ nome: 'CARLA AJUSTE', contrato: '4100', produto: 'IMPORTAÇÃO', plano: 'IMPORTAÇÃO',
          inicio: '07/01/2026', termino: '06/01/2027', duracao: '12', valor: '0,00' }),
  // grátis lançada em setembro: vai para o período de setembro
  ...degustacao({ nome: 'ANA SETEMBRO', contrato: '4800', lancamento: '02/09/2026',
                  inicio: '02/09/2026', termino: '01/10/2026' }),
];

let ok = 0;
function caso(nome, fn) { fn(); ok++; console.log('  ✓ ' + nome); }

console.log('smoke-degustacao-gratis');

// ─── 1. o relatório de vendas devolve só a degustação grátis ───
const degs = PA.degustacoesGratis(relatorioVendas);

caso('agrupa por unidade|mês e deixa de fora paga, teste e zero que não é degustação', () => {
  assert.deepStrictEqual(Object.keys(degs).sort(), ['CP|2026-08', 'PP|2026-08', 'PP|2026-09']);
  assert.deepStrictEqual(degs['PP|2026-08'].map(v => v.cliente), ['LUIZ HENRIQUE APPEL']);
});

caso('uma venda por contrato (a do plano), com valor zero e o código do contrato', () => {
  const [v] = degs['PP|2026-08'];
  assert.strictEqual(v.codigo, 'C4638');
  assert.strictEqual(v.contrato, '4638');
  assert.ok(/DEGUSTAÇÃO/.test(v.itens), v.itens);
  assert.strictEqual(v.tipoVenda, 'Novo Contrato');
  // e remontada no formato da planilha, com valor zero
  const venda = PA.vendaDaDegustacao(v);
  assert.strictEqual(venda['Código'], 'C4638');
  assert.strictEqual(venda['Valor Quitado/Recibo'], 0);
  assert.deepStrictEqual(PA.CABECALHO_SAIDA.filter(h => !(h in venda)), []);
});

caso('a venda é da consultora, como no relatório (não de quem lançou)', () => {
  assert.strictEqual(degs['PP|2026-08'][0].vendedor, 'BÁRBARA VIEIRA CARDOSO');
});

caso('consultora = Rodrigo (padrão da migração) → quem lançou, igual ao resto', () => {
  assert.strictEqual(degs['CP|2026-08'][0].vendedor, 'ERICA FAUSTINO');
});

caso('o que vai guardado no Firestore: chaves simples e nenhuma lista dentro de lista', () => {
  Object.values(degs).flat().forEach(d =>
    Object.keys(d).forEach(k => assert.ok(/^[a-zA-Z]+$/.test(k), 'chave ' + k)));
  const temAninhada = x => Array.isArray(x) ? x.some(Array.isArray) || x.some(temAninhada)
    : (x && typeof x === 'object') ? Object.values(x).some(temAninhada) : false;
  Object.values(degs).forEach(l => assert.ok(!temAninhada(l)));
});

// ─── 2. o upload do recebido junta a degustação guardada ───
// O recebido de agosto do PP: uma venda paga qualquer + a degustação paga do Diego.
const recebido = [
  cab,
  linha({ nome: 'JOANA PAGOU', contrato: '4600', produto: 'PLANO | RECORRENTE | LOCAL', plano: 'PLANO | RECORRENTE | LOCAL',
          valor: '419,00', forma: 'CARTÃO DE CRÉDITO', inicio: '10/08/2026', termino: '09/09/2026', lancamento: '10/08/2026' }),
  linha({ nome: 'DIEGO PANELLA', contrato: '4655', produto: 'MÊS DEGUSTAÇÃO LIVRE. - 1 - cod. 155',
          plano: 'MÊS DEGUSTAÇÃO LIVRE.', valor: '89,00', forma: 'PIX', inicio: '31/08/2026',
          termino: '30/09/2026', lancamento: '31/08/2026' }),
];
const trad = PA.traduzir(recebido, {});
const daUnidade = trad.porUnidade.PP;

caso('junta a degustação grátis às vendas da unidade', () => {
  const r = PA.juntarDegustacoes(daUnidade, degs['PP|2026-08'], []);
  assert.strictEqual(r.vendas.length, daUnidade.length + 1);
  assert.deepStrictEqual(r.incluidas.map(v => v['Cliente']), ['LUIZ HENRIQUE APPEL']);
});

caso('não duplica se o contrato já veio no recebido (passou a ter pagamento)', () => {
  const r = PA.juntarDegustacoes(daUnidade, [{ ...degs['PP|2026-08'][0], codigo: 'C4655', contrato: '4655' }], []);
  assert.strictEqual(r.incluidas.length, 0);
});

caso('não paga de novo contrato que já pagou comissão em mês anterior', () => {
  const r = PA.juntarDegustacoes(daUnidade, degs['PP|2026-08'], ['C4638']);
  assert.strictEqual(r.incluidas.length, 0);
});

caso('sem degustação guardada, as vendas passam iguais', () => {
  const r = PA.juntarDegustacoes(daUnidade, undefined, []);
  assert.strictEqual(r.vendas, daUnidade);
  assert.strictEqual(r.incluidas.length, 0);
});

// ─── 2b. relatório de vendas registrado DEPOIS do recebido: em qualquer ordem ───
caso('mês já calculado sem a degustação → falta acrescentar', () => {
  const itens = [{ codigo: 'C4600' }, { codigo: 'C4655' }, { codigo: 'A123' }];
  assert.deepStrictEqual(PA.degustacoesQueFaltam(degs['PP|2026-08'], itens, []).map(d => d.codigo), ['C4638']);
});

caso('carga repetida: a degustação já gravada (ou uma perna da divisão dela) não entra de novo', () => {
  assert.strictEqual(PA.degustacoesQueFaltam(degs['PP|2026-08'], [{ codigo: 'C4638' }], []).length, 0);
  assert.strictEqual(PA.degustacoesQueFaltam(degs['PP|2026-08'], [{ codigo: 'C4638-2' }], []).length, 0);
});

caso('contrato que já pagou comissão em mês anterior não entra', () => {
  assert.strictEqual(PA.degustacoesQueFaltam(degs['PP|2026-08'], [], ['C4638']).length, 0);
});

// ─── 3. o motor paga pela regra do TecnoFit ───
function calcular(vendas) {
  const rows = CE.cleanRawData([PA.CABECALHO_SAIDA, ...PA.paraPlanilha(vendas)]);
  return CE.calculate(rows, { ...CE.defaultConfig });
}

caso('o motor paga o voucher fixo e conta uma ativação a mais', () => {
  const sem = calcular(daUnidade);
  const com = calcular(PA.juntarDegustacoes(daUnidade, degs['PP|2026-08'], []).vendas);
  const luiz = com.processed.find(d => d.cliente === 'LUIZ HENRIQUE APPEL');
  assert.ok(luiz, 'a degustação grátis não chegou ao motor');
  assert.strictEqual(luiz.category, 'voucher');
  assert.strictEqual(luiz.isActivation, true);
  assert.strictEqual(luiz.p1valor, CE.defaultConfig.voucherFixo);
  assert.strictEqual(luiz.vendedor, 'BÁRBARA VIEIRA CARDOSO');
  assert.strictEqual(com.unitTotals.unitAtivacoes, sem.unitTotals.unitAtivacoes + 1);
  assert.strictEqual(com.unitTotals.unitVouchers, sem.unitTotals.unitVouchers + 1);
  assert.strictEqual(com.unitTotals.unitCaixa, sem.unitTotals.unitCaixa);
});

console.log(`\n${ok} casos ok`);
