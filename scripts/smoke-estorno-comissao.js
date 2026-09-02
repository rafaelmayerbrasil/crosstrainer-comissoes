'use strict';
// Roda: node scripts/smoke-estorno-comissao.js
//
// ══════════════════════════════════════════════════════════════════════
// ESTORNO: cliente cancela dentro dos 30 dias e é reembolsado
// ══════════════════════════════════════════════════════════════════════
//
// Política do Rodrigo (01/09/2026): quem fecha plano longo tem 30 dias para
// testar. Se pedir cancelamento e reembolso, **a comissão paga sobre o primeiro
// pagamento é abatida da próxima comissão da vendedora**.
//
// ⚠️ O estorno NÃO aparece no `faturamento-recebido`: medido no export fechado
//    de agosto (619 linhas), zero valores negativos e zero linhas de estorno.
//    O relatório só mostra dinheiro ENTRANDO. As 15 linhas de "QUITAÇÃO DE
//    DINHEIRO - CANCELAMENTO" são o oposto — o aluno PAGANDO o acerto ao sair.
//    Por isso o estorno é registrado pela gestão, não detectado no arquivo.
//
// O que o sistema faz é o que ele sabe melhor que a pessoa: **calcular quanto
// foi pago** por aquele contrato, para ninguém digitar valor de cabeça.

const assert = require('assert');
const path = require('path');
const EC = require(path.join(__dirname, '..', 'estorno-comissao.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

// Itens como o sistema guarda no período (subcoleção `itens`)
const item = o => ({
  type: 'processed', codigo: 'C7078', cliente: 'JULIA DEL FABRO',
  vendedor: 'ERICA FAUSTINO', item: 'HIIT/MAROMBINHA | ANUAL | LOCAL',
  data: '06/08/2026', valorCaixa: 259, p1valor: 12.95, p2bonus: 15,
  isNaoCom: false, ...o,
});

// ════════════════════════════════════════════════════════════════════
// 1. Quanto aquele contrato pagou de comissão
// ════════════════════════════════════════════════════════════════════
{
  const r = EC.comissaoDoContrato([item()], 'C7078');
  assert.strictEqual(r.total, 27.95, 'P1 + P2');
  assert.deepStrictEqual(Object.keys(r.porVendedora), ['ERICA FAUSTINO']);
  assert.strictEqual(r.porVendedora['ERICA FAUSTINO'], 27.95);
  assert.strictEqual(r.itens.length, 1);
  ok('soma P1 + P2 do contrato e diz de quem era');
}

// ════════════════════════════════════════════════════════════════════
// 2. A taxa de matrícula faz parte da mesma venda
// ════════════════════════════════════════════════════════════════════
{
  // Ela vem em linha própria, ao lado do plano, com o mesmo contrato. Deixá-la
  // de fora devolveria menos do que foi pago.
  const r = EC.comissaoDoContrato([
    item(),
    item({ codigo: 'C7078-2', item: 'TAXA DE MATRÍCULA', valorCaixa: 100, p1valor: 5, p2bonus: 0 }),
  ], 'C7078');
  assert.strictEqual(r.total, 32.95);
  assert.strictEqual(r.itens.length, 2, 'as duas linhas do contrato entram');
  ok('taxa de matrícula do mesmo contrato entra na conta (o sufixo -2 não separa)');
}

// ════════════════════════════════════════════════════════════════════
// 3. Venda dividida devolve de cada uma, na proporção que recebeu
// ════════════════════════════════════════════════════════════════════
{
  const r = EC.comissaoDoContrato([
    item({ vendedor: 'ERICA FAUSTINO',     p1valor: 6.48, p2bonus: 7.5 }),
    item({ vendedor: 'FRANCINI DAS CHAGAS', p1valor: 6.47, p2bonus: 7.5 }),
  ], 'C7078');
  assert.strictEqual(r.porVendedora['ERICA FAUSTINO'], 13.98);
  assert.strictEqual(r.porVendedora['FRANCINI DAS CHAGAS'], 13.97);
  assert.strictEqual(r.total, 27.95, 'a soma continua sendo o que a venda pagou');
  ok('venda dividida gera devolução de cada uma, no que cada uma recebeu');
}

// ════════════════════════════════════════════════════════════════════
// 4. Quem não recebe comissão não devolve nada
// ════════════════════════════════════════════════════════════════════
{
  // Rafael Rojais e Benny estão marcados como não comissionados: o contrato
  // deles nunca gerou comissão, então não há o que estornar.
  const r = EC.comissaoDoContrato([
    item({ vendedor: 'RODRIGO ROJAIS', isNaoCom: true, p1valor: 0, p2bonus: 0 }),
  ], 'C7078');
  assert.strictEqual(r.total, 0);
  assert.deepStrictEqual(r.porVendedora, {});
  ok('vendedor não comissionado não entra no estorno');
}

// ════════════════════════════════════════════════════════════════════
// 5. Item excluído do cálculo não pagou nada
// ════════════════════════════════════════════════════════════════════
{
  const r = EC.comissaoDoContrato([
    item(),
    item({ codigo: 'C7078-2', type: 'excluded', p1valor: 99, p2bonus: 99 }),
  ], 'C7078');
  assert.strictEqual(r.total, 27.95, 'a linha excluída não conta');
  ok('linha excluída do cálculo fica fora do estorno');
}

// ════════════════════════════════════════════════════════════════════
// 6. Contrato de outro cliente não é tocado
// ════════════════════════════════════════════════════════════════════
{
  const r = EC.comissaoDoContrato([
    item(),
    item({ codigo: 'C9101', cliente: 'OUTRA PESSOA', p1valor: 50, p2bonus: 50 }),
  ], 'C7078');
  assert.strictEqual(r.total, 27.95);
  assert.strictEqual(r.itens.length, 1);
  ok('estorno de um contrato não alcança o contrato do vizinho');
}

// ════════════════════════════════════════════════════════════════════
// 7. Contrato que não existe no período — a tela precisa saber
// ════════════════════════════════════════════════════════════════════
{
  const r = EC.comissaoDoContrato([item()], 'C0000');
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.itens.length, 0);
  assert.strictEqual(r.encontrado, false, 'diz que não achou, em vez de devolver zero calado');
  ok('contrato não encontrado é dito, não vira zero silencioso');
}

// ════════════════════════════════════════════════════════════════════
// 8. Os créditos a lançar, prontos para o mecanismo que já existe
// ════════════════════════════════════════════════════════════════════
{
  const cr = EC.creditosDoEstorno({
    itens: [item({ p1valor: 12.95, p2bonus: 15 })],
    contrato: 'C7078', unitId: 'cp',
    periodoLabel: 'Agosto 2026', periodoId: 'cp_2026-08',
    motivo: 'cancelamento em 12/09 dentro dos 30 dias',
  });
  assert.strictEqual(cr.length, 1);
  const c = cr[0];
  assert.strictEqual(c.vendedor, 'ERICA FAUSTINO');
  assert.strictEqual(c.valor, 27.95);
  assert.strictEqual(c.unitId, 'cp');
  assert.strictEqual(c.status, 'pendente', 'nasce pendente — é assim que o pagamento o encontra');
  assert.strictEqual(c.origem, 'estorno');
  assert.ok(/C7078/.test(c.obs), 'a observação diz de qual contrato veio: ' + c.obs);
  assert.ok(/JULIA DEL FABRO/.test(c.obs), 'e de qual cliente');
  assert.ok(/30 dias/.test(c.obs), 'e o motivo que a gestão escreveu');
  ok('gera o crédito pendente no formato que o pagamento já sabe abater');
}

// ════════════════════════════════════════════════════════════════════
// 9. Sem comissão paga, não se inventa crédito
// ════════════════════════════════════════════════════════════════════
{
  const cr = EC.creditosDoEstorno({
    itens: [item({ vendedor: 'RODRIGO ROJAIS', isNaoCom: true, p1valor: 0, p2bonus: 0 })],
    contrato: 'C7078', unitId: 'cp', periodoLabel: 'Agosto 2026', periodoId: 'cp_2026-08',
  });
  assert.deepStrictEqual(cr, [], 'nada a devolver, nenhum crédito');
  ok('contrato sem comissão paga não gera crédito de R$ 0,00');
}

// ════════════════════════════════════════════════════════════════════
// 10. Centavos não se perdem nem se multiplicam
// ════════════════════════════════════════════════════════════════════
{
  const r = EC.comissaoDoContrato([
    item({ p1valor: 2.9875000000000003, p2bonus: 15 }),   // valor real, do banco
  ], 'C7078');
  assert.strictEqual(r.total, 17.99, 'arredonda em 2 casas, uma vez só');
  ok('centavos arredondados em duas casas, como o resto do módulo');
}

// ════════════════════════════════════════════════════════════════════
// 11. 🚨 O contrato tem que sair da memória de já-comissionados
// ════════════════════════════════════════════════════════════════════
{
  // Se o aluno voltar meses depois, é venda nova e paga comissão de novo. Manter
  // o contrato na lista o deixaria bloqueado para sempre, em silêncio — o mesmo
  // falso negativo mudo que a regra "uma vez só" precisa evitar.
  const antes = ['C5000', 'C7078', 'C9101'];
  const depois = EC.removerDaMemoria(antes, 'C7078');
  assert.deepStrictEqual(depois, ['C5000', 'C9101']);
  assert.deepStrictEqual(EC.removerDaMemoria(['C7078-2', 'C7078'], 'C7078'), [],
    'tira também as linhas com sufixo do mesmo contrato');
  assert.deepStrictEqual(EC.removerDaMemoria(antes, 'C0000'), antes, 'contrato ausente não mexe em nada');
  ok('o contrato estornado sai da memória — se o aluno voltar, é venda nova');
}

// ════════════════════════════════════════════════════════════════════
// PARTE 2 — a LIGAÇÃO com a tela, executada de verdade
// ════════════════════════════════════════════════════════════════════
// Motor certo e tela que não chama é o defeito mais caro que já tivemos aqui.
// Então as funções são EXTRAÍDAS do `index.html` e RODADAS contra um Firestore
// falso, com um DOM mínimo — não basta procurar o texto no arquivo.

const fs = require('fs');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

{
  assert.ok(html.includes('<script src="estorno-comissao.js"></script>'), 'a tela carrega o módulo');
  assert.ok(html.includes('onclick="openEstornoModal()"'), 'e tem o botão de registrar estorno');
  assert.ok(html.includes('EstornoComissao.creditosDoEstorno('), 'que gera os créditos pelo módulo');
  assert.ok(html.includes('EstornoComissao.removerDaMemoria('), 'e tira o contrato da memória');
  ok('a tela carrega o módulo, tem o botão e usa as duas funções');
}

const inicio = html.indexOf('    const ESTORNO_MESES_BUSCA = 6;');
const fim = html.indexOf('    function openComplementar(vendedor, periodId, periodLabel, diff) {');
assert.ok(inicio > 0 && fim > inicio, 'bloco do estorno localizado no index.html');

const makeFakeDb = require(path.join(__dirname, '_fake-firestore.js'));
const db = makeFakeDb();

// DOM mínimo: só o que estas funções tocam
const campos = {};
const els = {};
const el = id => (els[id] = els[id] || {
  get value() { return campos[id] || ''; },
  set value(v) { campos[id] = v; },
  set innerHTML(v) { campos['#' + id] = v; },
  get innerHTML() { return campos['#' + id] || ''; },
  set textContent(v) { campos['@' + id] = v; },
  get textContent() { return campos['@' + id] || ''; },
  classList: { add() {}, remove() {} },
  focus() {},
});
const janela = {};
let auditado = '', avisado = '';
const ambiente = {
  db, window: janela,
  document: { getElementById: el },
  currentUnitId: 'cp',
  currentUser: { uid: 'admin-1' },
  EstornoComissao: EC,
  fmt: v => Number(v || 0).toFixed(2).replace('.', ','),
  toast: m => { avisado = m; },
  logAudit: (t, m) => { auditado = t + '|' + m; },
  closePagModal() {}, loadPagamentos() {},
  firebase: { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } },
  setTimeout: fn => fn(),
  console: { log() {}, error() {} },
};
const nomes = Object.keys(ambiente);
const tela = new Function(...nomes, html.slice(inicio, fim) +
  '\n return { openEstornoModal, buscarParaEstorno, confirmarEstorno };'
)(...nomes.map(k => ambiente[k]));

(async () => {
  // O período como o sistema o guarda, com os itens da venda
  await db.collection('periodos').doc('cp_2026-08').set({
    unitId: 'cp', periodLabel: 'Agosto 2026', codigosPagos: ['C7078', 'C9101'],
  });
  const itensRef = db.collection('periodos').doc('cp_2026-08').collection('itens');
  await itensRef.doc('i1').set(item());                                   // plano, C7078
  await itensRef.doc('i2').set(item({ codigo: 'C7078-2', item: 'TAXA DE MATRÍCULA', p1valor: 5, p2bonus: 0 }));
  await itensRef.doc('i3').set(item({ codigo: 'C9101', cliente: 'OUTRA PESSOA', p1valor: 50, p2bonus: 50 }));
  await itensRef.doc('i4').set(item({ codigo: 'A013225', cliente: 'JULIA DEL FABRO', item: '1 AULA' }));

  {
    campos['estornoBusca'] = 'julia';
    await tela.buscarParaEstorno();
    const achados = janela._estornoAchados || [];
    assert.strictEqual(achados.length, 1, 'acha o contrato da Julia, e só ele');
    assert.strictEqual(achados[0].contrato, 'C7078');
    assert.strictEqual(achados[0].r.total, 32.95, 'plano + taxa');
    ok('busca por nome acha o contrato certo, somando plano e taxa');
  }
  {
    // A aula avulsa dela apareceu na busca? Não pode: avulso não tem contrato.
    const achados = janela._estornoAchados || [];
    assert.ok(!achados.some(a => a.contrato.startsWith('A')), 'nenhum código de avulso na lista');
    ok('venda avulsa não entra na busca de estorno');
  }
  {
    campos['estornoBusca'] = '7078';
    await tela.buscarParaEstorno();
    assert.strictEqual((janela._estornoAchados || []).length, 1, 'busca pelo número do contrato também acha');
    ok('busca pelo número do contrato funciona igual');
  }
  {
    // Sem motivo, não grava — é o que explica o desconto no recibo dela
    campos['estornoMotivo0'] = '';
    await tela.confirmarEstorno(0);
    const cr = await db.collection('creditos').get();
    assert.strictEqual(cr.docs.length, 0, 'nada gravado');
    assert.ok(/motivo/i.test(campos['@pagModalError'] || ''), 'e a tela diz por quê: ' + campos['@pagModalError']);
    ok('estorno sem motivo é recusado, com a razão na tela');
  }
  {
    campos['estornoMotivo0'] = 'cancelou em 12/09, reembolso pago';
    await tela.confirmarEstorno(0);

    const cr = await db.collection('creditos').get();
    assert.strictEqual(cr.docs.length, 1, 'um crédito, para a vendedora da venda');
    const c = cr.docs[0].data();
    assert.strictEqual(c.vendedor, 'ERICA FAUSTINO');
    assert.strictEqual(c.valor, 32.95);
    assert.strictEqual(c.status, 'pendente');
    assert.strictEqual(c.unitId, 'cp');
    assert.ok(/12\/09/.test(c.obs), 'o motivo escrito pela gestão fica no crédito');
    ok('grava o crédito pendente que o próximo pagamento vai abater');
  }
  {
    const p = await db.collection('periodos').doc('cp_2026-08').get();
    assert.deepStrictEqual(p.data().codigosPagos, ['C9101'],
      'C7078 saiu da memória; o contrato do vizinho ficou');
    ok('o contrato estornado sai da memória e o do vizinho não é tocado');
  }
  {
    assert.ok(/^pagamento_ajuste\|/.test(auditado), 'entra no log de auditoria');
    assert.ok(/C7078/.test(auditado) && /ERICA/.test(auditado), 'com contrato e vendedora: ' + auditado.slice(0, 90));
    assert.ok(/Estorno/.test(avisado), 'e a tela confirma para quem clicou: ' + avisado);
    ok('fica registrado na auditoria e confirmado na tela');
  }

  console.log('\n' + n + '/' + n + ' casos passaram.');
})().catch(e => { console.error('\n✗ FALHOU:', e.message); process.exit(1); });
