'use strict';
// Roda: node scripts/smoke-comissao-uma-vez.js
//
// ══════════════════════════════════════════════════════════════════════
// A REGRA: cada CONTRATO paga comissão UMA VEZ SÓ, no primeiro recebimento
// ══════════════════════════════════════════════════════════════════════
//
// Desde 01/09/2026 a comissão é do mês em que o dinheiro entrou (regime de
// caixa). O relatório `faturamento-recebido` traz UMA LINHA POR RECEBIMENTO —
// então um anual parcelado em 12× aparece doze vezes, uma por mês.
//
// Sem esta regra, a partir de setembro cada parcela pagaria comissão de novo:
// um anual de R$ 3.108 pagaria ~R$ 155 em vez de R$ 12,95, distribuído ao longo
// do ano e SEM NENHUM ERRO NA TELA. Em agosto isso não aparecia porque todo
// contrato antigo vinha marcado como `IMPORTAÇÃO` (a migração do TecnoFit) e o
// filtro de migrados o pegava. O contrato vendido na Pacto vem com o plano
// legível e escapa desse filtro.
//
// ⚠️ O PERIGO ESTÁ NO OUTRO LADO. Errar para "já pagou" faz vendedora não
//    receber, em silêncio — ninguém reclama do que não vê. Por isso:
//      · a regra alcança SÓ linha de contrato (`C<contrato>`), nunca avulso;
//      · o que é barrado sai LISTADO no balde `jaPagos`, com o motivo.
//
// Desenho: docs/superpowers/specs/2026-08-31-comissoes-regime-caixa-design.md

const assert = require('assert');
const path = require('path');
const PA = require(path.join(__dirname, '..', 'pacto-adapter.js'));
const CE = require(path.join(__dirname, '..', 'commission.js'));

// ─── Linha crua da Pacto, por POSIÇÃO (o cabeçalho tem `Responsável` duplicado) ───
const COL = {
  matricula: 1, nome: 2, cadastro: 3, resp1: 4, resp2: 5, produto: 6, contrato: 7,
  inicio: 8, termino: 9, duracao: 10, modalidades: 11, plano: 12, situacao: 13,
  lancamento: 14, valor: 15, forma: 16, condicao: 17, empresa: 18, turma: 19,
  categoria: 20, consultor: 21,
};
const CP = 'CROSSTAINER UNID. CAMPECHE (CP)';

function linha(o) {
  const r = [];
  for (let i = 0; i <= 21; i++) r[i] = '';
  const d = {
    nome: 'FULANO DE TAL', matricula: '1', cadastro: '01/08/2026',
    resp1: 'ERICA FAUSTINO', resp2: 'ERICA FAUSTINO', contrato: '0',
    inicio: '', termino: '', duracao: '0', modalidades: '', plano: '',
    situacao: '', lancamento: '05/08/2026', valor: '100,00',
    forma: 'CARTÃO DE CRÉDITO', condicao: '1X', empresa: CP,
    turma: '', categoria: '', produto: '', consultor: 'ERICA FAUSTINO',
    ...o,
  };
  Object.keys(COL).forEach(k => { r[COL[k]] = d[k] === undefined ? '' : d[k]; });
  return r;
}
const CABECALHO = linha({ nome: 'Nome Cliente' });
const traduz = (linhas, opts) => PA.traduzir([CABECALHO, ...linhas], { mes: '2026-08', ...opts });

// Anual parcelado vendido na Pacto: plano LEGÍVEL, então o filtro de migrados
// não o alcança. É exatamente o contrato que a regra nova precisa segurar.
const ANUAL_PARCELADO = {
  nome: 'JULIA DEL FABRO', contrato: '7078', duracao: '12',
  inicio: '06/08/2026', termino: '05/08/2027',
  produto: 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO | CP.',
  plano: 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO | CP.',
  situacao: 'Matrícula', valor: '259,00',
};

let n = 0;
const ok = msg => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + msg);

// ════════════════════════════════════════════════════════════════════
// 1. contratosDe — quais contratos uma lista de códigos representa
// ════════════════════════════════════════════════════════════════════
{
  // O código gravado no item é `C<contrato>` ou `A<matrícula>`, e ganha `-2`,
  // `-3`… quando o mesmo contrato aparece mais de uma vez no mesmo export.
  const s = PA.contratosDe(['C7078', 'C7078-2', 'C9101-3', 'A013225', 'A013225-2', '', null]);
  assert.ok(s.has('7078'), 'C7078 vira o contrato 7078');
  assert.ok(s.has('9101'), 'o sufixo -3 não atrapalha');
  assert.strictEqual(s.size, 2, 'só contratos entram — avulso (A) fica de fora');
  ok('contratosDe lê os códigos gravados e devolve só os números de contrato');
}

// ════════════════════════════════════════════════════════════════════
// 2. O contrato que já pagou não paga de novo
// ════════════════════════════════════════════════════════════════════
{
  const setembro = { ...ANUAL_PARCELADO, lancamento: '06/09/2026', valor: '259,00' };
  const r = PA.traduzir([CABECALHO, linha(setembro)], {
    mes: '2026-09',
    codigosPagos: ['C7078'],           // pagou em agosto
  });
  assert.strictEqual(r.vendas.length, 0, 'a parcela de setembro não vira venda');
  assert.strictEqual(r.jaPagos.length, 1, 'e sai listada, não some calada');
  assert.ok(/j[áa] pagou/i.test(r.jaPagos[0].motivo), 'com o motivo escrito: ' + r.jaPagos[0].motivo);
  assert.strictEqual(r.jaPagos[0].cliente, 'JULIA DEL FABRO');
  ok('parcela seguinte de contrato já comissionado NÃO paga de novo');
}

// ════════════════════════════════════════════════════════════════════
// 3. …e o primeiro recebimento paga normalmente
// ════════════════════════════════════════════════════════════════════
{
  const r = traduz([linha(ANUAL_PARCELADO)], { codigosPagos: ['C9999'] });
  assert.strictEqual(r.vendas.length, 1, 'contrato que nunca pagou atravessa');
  assert.strictEqual(r.vendas[0]['Código'], 'C7078');
  assert.strictEqual(r.jaPagos.length, 0);
  ok('primeiro recebimento do contrato paga normalmente');
}

// ════════════════════════════════════════════════════════════════════
// 4. 🚨 Avulso NUNCA é barrado — o código `A` é a matrícula do CLIENTE
// ════════════════════════════════════════════════════════════════════
{
  // Se a regra alcançasse avulso, a segunda aula que a mesma pessoa comprasse
  // seria bloqueada em silêncio: `A013225` é o número dela, não da venda.
  const aula = { nome: 'BÁRBARA ZANETTE', matricula: '013225', contrato: '0',
                 produto: '1 AULA', valor: '60,00', lancamento: '10/09/2026' };
  const r = PA.traduzir([CABECALHO, linha(aula)], {
    mes: '2026-09',
    codigosPagos: ['A013225'],         // ela já comprou uma aula antes
  });
  assert.strictEqual(r.vendas.length, 1, 'a segunda aula avulsa paga comissão');
  assert.strictEqual(r.jaPagos.length, 0);
  ok('avulso do mesmo cliente paga sempre — cada compra é uma venda');
}

// ════════════════════════════════════════════════════════════════════
// 5. Duas linhas do mesmo contrato no mesmo mês continuam contando uma vez
// ════════════════════════════════════════════════════════════════════
{
  // Taxa de matrícula vem em linha própria, ao lado do plano. O tradutor já
  // agrupava por contrato; a regra nova não pode transformar a segunda linha
  // em "já pagou" dentro do MESMO export.
  const taxa = { ...ANUAL_PARCELADO, produto: 'TAXA DE MATRÍCULA', plano: '', valor: '100,00' };
  const r = traduz([linha(ANUAL_PARCELADO), linha(taxa)]);
  assert.strictEqual(r.jaPagos.length, 0, 'nada é barrado dentro do mesmo arquivo');
  assert.strictEqual(r.vendas.length, 2, 'plano e taxa seguem as duas');
  ok('plano + taxa do mesmo contrato no mesmo mês não viram "já pagou"');
}

// ════════════════════════════════════════════════════════════════════
// 6. Sem a lista, o tradutor se comporta como antes
// ════════════════════════════════════════════════════════════════════
{
  const semLista = traduz([linha(ANUAL_PARCELADO)]);
  const listaVazia = traduz([linha(ANUAL_PARCELADO)], { codigosPagos: [] });
  assert.strictEqual(semLista.vendas.length, 1);
  assert.strictEqual(listaVazia.vendas.length, 1);
  assert.deepStrictEqual(semLista.jaPagos, []);
  ok('sem codigosPagos nada muda — a mudança é aditiva');
}

// ════════════════════════════════════════════════════════════════════
// 7. Comportamental: o motor de verdade concorda com o que sobrou
// ════════════════════════════════════════════════════════════════════
{
  // Agosto: paga. Setembro: a mesma parcela, mesmo valor, não paga nada.
  const rAgo = traduz([linha(ANUAL_PARCELADO)]);
  const vendasAgo = rAgo.porUnidade['CP'].map(v => {
    const o = {}; PA.CABECALHO_SAIDA.forEach(h => o[h] = v[h]); return o;
  });
  const ago = CE.calculate(vendasAgo, CE.defaultConfig, {});
  const totalAgo = Object.values(ago.vendorData).reduce((s, d) => s + (d.p1total || 0) + (d.p2total || 0), 0);
  assert.ok(totalAgo > 0, 'agosto paga comissão de verdade: R$ ' + totalAgo.toFixed(2));

  const rSet = PA.traduzir([CABECALHO, linha({ ...ANUAL_PARCELADO, lancamento: '06/09/2026' })],
    { mes: '2026-09', codigosPagos: ['C7078'] });
  const vendasSet = (rSet.porUnidade['CP'] || []).map(v => {
    const o = {}; PA.CABECALHO_SAIDA.forEach(h => o[h] = v[h]); return o;
  });
  const set = CE.calculate(vendasSet, CE.defaultConfig, {});
  const totalSet = Object.values(set.vendorData).reduce((s, d) => s + (d.p1total || 0) + (d.p2total || 0), 0);
  assert.strictEqual(totalSet, 0, 'setembro paga ZERO pelo mesmo contrato');
  ok('ponta a ponta no motor real: paga em agosto, zero em setembro');
}

// ════════════════════════════════════════════════════════════════════
// 8. A ativação acompanha — não conta duas vezes
// ════════════════════════════════════════════════════════════════════
{
  const rSet = PA.traduzir([CABECALHO, linha({ ...ANUAL_PARCELADO, lancamento: '06/09/2026' })],
    { mes: '2026-09', codigosPagos: ['C7078'] });
  const vendas = (rSet.porUnidade['CP'] || []).map(v => {
    const o = {}; PA.CABECALHO_SAIDA.forEach(h => o[h] = v[h]); return o;
  });
  const res = CE.calculate(vendas, CE.defaultConfig, {});
  const ativ = Object.values(res.vendorData).reduce((s, d) => s + (d.ativacoes || 0), 0);
  assert.strictEqual(ativ, 0, 'a parcela não conta ativação — senão inflaria a meta');
  ok('parcela seguinte não conta ativação para a meta');
}

// ════════════════════════════════════════════════════════════════════
// 9. codigosPagos aceita Set, além de array
// ════════════════════════════════════════════════════════════════════
{
  const r = PA.traduzir([CABECALHO, linha({ ...ANUAL_PARCELADO, lancamento: '06/09/2026' })],
    { mes: '2026-09', codigosPagos: new Set(['C7078']) });
  assert.strictEqual(r.vendas.length, 0, 'Set funciona igual ao array');
  ok('codigosPagos aceita array ou Set');
}

// ════════════════════════════════════════════════════════════════════
// PARTE 2 — a LIGAÇÃO com a tela
// ════════════════════════════════════════════════════════════════════
// O motor pode estar perfeito e a tela nunca chamar. Foi assim que a "Prévia
// antes de publicar" da escala passou por 12 testes verdes sem nunca rodar:
// todos liam o texto do arquivo, nenhum chamava a função. Aqui as funções do
// `index.html` são EXTRAÍDAS e EXECUTADAS de verdade, contra um Firestore falso.

const fs = require('fs');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

{
  const iCarrega = html.indexOf('carregarCodigosPagosAnteriores(currentUnitId');
  const iTraduz = html.indexOf('PactoAdapter.traduzir(json, { codigosPagos })');
  assert.ok(iCarrega > 0, 'a tela precisa carregar os códigos já pagos');
  assert.ok(iTraduz > iCarrega, 'e passar para o tradutor DEPOIS de carregar');
  assert.ok(html.includes('await gravarCodigosPagos(periodId, cachedPeriodItems)'),
    'o upload precisa gravar a lista, derivada dos itens reais do período');
  assert.ok(html.includes('pacto.jaPagos'), 'e a prévia precisa mostrar o que foi barrado');
  ok('a tela carrega, passa, grava e mostra — as quatro pontas ligadas');
}

// ─── Executa as funções da tela de verdade ───
const inicio = html.indexOf('    /** Os códigos de contrato comissionados num conjunto de itens do período */');
const fim = html.indexOf('    function handleFile(file) {');
assert.ok(inicio > 0 && fim > inicio, 'bloco das funções de códigos pagos localizado no index.html');
const fonte = html.slice(inicio, fim);

const makeFakeDb = require(path.join(__dirname, '_fake-firestore.js'));
const db = makeFakeDb();
const janela = {};
const tela = new Function('db', 'window', 'console', fonte +
  '\n return { codigosDeContrato, gravarCodigosPagos, reconstruirCodigosPagos, carregarCodigosPagosAnteriores };'
)(db, janela, { log() {}, error() {} });

(async () => {
  {
    const cods = tela.codigosDeContrato([
      { type: 'processed', codigo: 'C7078' },
      { type: 'processed', codigo: 'C7078-2' },
      { type: 'processed', codigo: 'A013225' },   // avulso não entra
      { type: 'excluded',  codigo: 'C9999' },     // excluído não pagou nada
      { type: 'processed', codigo: '' },
    ]);
    assert.deepStrictEqual(cods, ['C7078'], 'só contrato, sem duplicata, sem excluído');
    ok('codigosDeContrato ignora avulso e item excluído');
  }
  {
    await db.collection('periodos').doc('cp_2026-08').set({ unitId: 'cp' });
    await db.collection('periodos').doc('cp_2026-08').collection('itens').doc('i1')
      .set({ type: 'processed', codigo: 'C7078' });
    await db.collection('periodos').doc('cp_2026-08').collection('itens').doc('i2')
      .set({ type: 'processed', codigo: 'A013225' });
    const refeito = await tela.reconstruirCodigosPagos('cp_2026-08');
    assert.deepStrictEqual(refeito, ['C7078']);
    const doc = await db.collection('periodos').doc('cp_2026-08').get();
    assert.deepStrictEqual(doc.data().codigosPagos, ['C7078'], 'e grava no doc do período');
    ok('reconstruirCodigosPagos refaz a lista a partir dos itens — a fonte é o item');
  }
  {
    // O recorte por mês é o que permite RE-SUBIR o mesmo mês sem que ele barre
    // as próprias linhas com os códigos que ele mesmo gravou.
    await db.collection('periodos').doc('cp_2026-07').set({ unitId: 'cp', codigosPagos: ['C5000'] });
    await db.collection('periodos').doc('pp_2026-07').set({ unitId: 'pp', codigosPagos: ['C6000'] });

    const paraSetembro = await tela.carregarCodigosPagosAnteriores('cp', '2026-09');
    assert.deepStrictEqual(paraSetembro.sort(), ['C5000', 'C7078'], 'setembro vê julho e agosto');

    const paraAgosto = await tela.carregarCodigosPagosAnteriores('cp', '2026-08');
    assert.deepStrictEqual(paraAgosto, ['C5000'], 'agosto NÃO vê os próprios códigos');

    const outraUnidade = await tela.carregarCodigosPagosAnteriores('pp', '2026-09');
    assert.deepStrictEqual(outraUnidade, ['C6000'], 'e não enxerga a unidade vizinha');
    ok('re-subir o mesmo mês não barra as próprias linhas, e uma unidade não vê a outra');
  }
  {
    // Ponta a ponta: o que a tela carregou alimenta o tradutor e barra a parcela
    const codigosPagos = await tela.carregarCodigosPagosAnteriores('cp', '2026-09');
    const r = PA.traduzir([CABECALHO, linha({ ...ANUAL_PARCELADO, lancamento: '06/09/2026' })],
      { mes: '2026-09', codigosPagos });
    assert.strictEqual(r.vendas.length, 0, 'a parcela de setembro é barrada pelo que veio do banco');
    assert.strictEqual(r.jaPagos.length, 1);
    ok('ponta a ponta: banco → tela → tradutor, e a parcela não paga');
  }

  console.log('\n' + n + '/' + n + ' casos passaram.');
})().catch(e => { console.error('\n✗ FALHOU:', e.message); process.exit(1); });
