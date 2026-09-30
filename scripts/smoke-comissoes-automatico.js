'use strict';
// Roda: node scripts/smoke-comissoes-automatico.js
//
// O mês das comissões atualizado SOZINHO depois da busca das 4h (decisão do
// Rafael, 30/09/2026): só de out/2026 em diante; recibo emitido CONGELA; dia
// faltando na Pacto TRAVA e deixa o último cálculo bom; senão, grava pelos mesmos
// módulos do botão. Banco falso, dados INVENTADOS.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const makeFakeDb = require('./_fake-firestore.js');
const C = require('./_comissoes-mes-cenario.js');
const L = require(path.join(raiz, 'pacto-api-linhas.js'));
const PA = require(path.join(raiz, 'pacto-adapter.js'));
const A = require(path.join(raiz, 'functions', 'comissoes-automatico.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);
const FieldValue = { serverTimestamp: () => 'SERVER_TIMESTAMP' };
const Timestamp = { fromDate: d => ({ ts: d.toISOString() }) };
const HOJE = '2026-10-12';
const PID = C.UNIT + '_' + C.MES;

/** Os dias 01→11/10 da busca das 4h, com as linhas do cenário no dia de cada uma */
async function diasDaBusca(db, { faltando } = {}) {
  const porDia = {};
  C.linhasPasso1().forEach(l => {
    const [d, m, a] = l[L.COL.lancamento].split('/');
    (porDia[`${a}-${m}-${d}`] = porDia[`${a}-${m}-${d}`] || []).push(l);
  });
  for (let d = 1; d <= 11; d++) {
    const dia = '2026-10-' + String(d).padStart(2, '0');
    if (dia === faltando) continue;
    await db.collection('pacto_sombra_dias').doc('PP_' + dia).set({ unidade: 'PP', dia, situacao: 'buscado',
      linhas: JSON.stringify(porDia[dia] || []), buscadoEm: '2026-10-12T07:0' + (d % 10) + ':00Z' });
  }
}

async function rodar(db, mes = C.MES) {
  return A.atualizarMesAutomatico({ db, FieldValue, Timestamp, sigla: 'PP', mes, hoje: HOJE });
}

(async () => {
  {
    const db = makeFakeDb(); await C.semear(db); await diasDaBusca(db);
    const r = await rodar(db, '2026-09');
    assert.strictEqual(r.situacao, 'fora');
    assert.ok(!db._dump()['periodos/' + C.UNIT + '_2026-09/itens'] || Object.keys(db._dump()['periodos/' + C.UNIT + '_2026-09/itens']).length === 1, 'setembro não é tocado');
    ok('setembro fica fora: o automático começa em outubro/2026');
  }
  {
    const db = makeFakeDb(); await C.semear(db); await diasDaBusca(db);
    // degustação grátis achada pela varredura dos contratos
    const g = { codigo: '9200', consultor: C.V1, lancou: C.V1, plano: 'MÊS DEGUSTAÇÃO LIVRE.', valor: 0, tipo: 'MA', situacao: 'AT',
      lancamento: '09/10/2026', vigenciaDe: '09/10/2026', vigenciaAte: '08/11/2026', cliente: { codigo: '88', nome: 'CLIENTE DEGUSTA' } };
    const deg = Object.values(PA.degustacoesGratis(L.comCabecalho([L.linhaDeDegustacao(g, 'PP')]))).flat()[0];
    await db.collection('pacto_degustacoes').doc('PP_9200').set({ unidade: 'PP', contrato: '9200', mes: '2026-10', dia: '2026-10-09', degustacao: deg });
    const r = await rodar(db);
    assert.strictEqual(r.situacao, 'atualizado', JSON.stringify(r));
    const dump = db._dump();
    const per = dump.periodos[PID];
    assert.strictEqual(per.origem, 'api');
    assert.strictEqual(per.dadosAte, '2026-10-11');
    assert.ok(/Pacto \(automático\)/.test(per.fileName));
    assert.strictEqual(per.automatico.situacao, 'atualizado');
    assert.strictEqual(per.automatico.ativacoes, per.totals.unitAtivacoes);
    const itens = Object.values(dump['periodos/' + PID + '/itens']);
    assert.ok(itens.some(i => i.codigo === 'C9200' && i.isDegustacao), 'a degustação grátis entra');
    assert.ok(itens.some(i => i.codigo === 'C9101'), 'as vendas do mês entram');
    const hist = Object.values(dump['periodos/' + PID + '/historico']);
    assert.ok(hist.some(h => h.triggeredBy.name === 'Sistema (Pacto, madrugada)'), 'o histórico diz que foi o sistema');
    assert.ok(Object.values(dump.audit_log).some(a => /Automático: Pacto \(automático\)/.test(a.details) && a.userName === 'Sistema (Pacto, madrugada)'));
    ok(`outubro atualizado sozinho: ${per.totals.unitAtivacoes} ativações, degustação da varredura junto, histórico e auditoria em nome do sistema`);

    // rodar de novo no dia seguinte não duplica nada
    const antes = Object.keys(dump['periodos/' + PID + '/itens']).length;
    const r2 = await rodar(db);
    assert.strictEqual(r2.situacao, 'atualizado');
    assert.strictEqual(Object.keys(db._dump()['periodos/' + PID + '/itens']).length, antes);
    assert.strictEqual(r2.novos, 0);
    ok('rodar de novo não duplica lançamento');

    // a gestão troca a vendedora de um lançamento: a madrugada seguinte PRESERVA
    const doc = Object.entries(db._dump()['periodos/' + PID + '/itens']).find(([, i]) => i.codigo === 'C9108');
    await db.collection('periodos').doc(PID).collection('itens').doc(doc[0]).update({ vendedor: C.V1 });
    await rodar(db);
    assert.strictEqual(db._dump()['periodos/' + PID + '/itens'][doc[0]].vendedor, C.V1, 'a edição da gestão sobrevive ao automático');
    ok('a edição da gestão (vendedora trocada) sobrevive à atualização automática');

    // recibo emitido: CONGELA
    await db.collection('pagamentos').add({ periodId: PID, vendedor: C.V1, status: 'recibo_emitido' });
    await db.collection('pacto_sombra_dias').doc('PP_2026-10-10').set({ unidade: 'PP', dia: '2026-10-10', situacao: 'buscado',
      linhas: JSON.stringify([ (() => { const l = C.linhasPasso2().find(x => x[L.COL.contrato] === '9109'); l[L.COL.lancamento] = '10/10/2026'; return l; })() ]) });
    const itensAntes = JSON.stringify(db._dump()['periodos/' + PID + '/itens']);
    const r3 = await rodar(db);
    assert.strictEqual(r3.situacao, 'congelado');
    assert.strictEqual(JSON.stringify(db._dump()['periodos/' + PID + '/itens']), itensAntes, 'mês com recibo não muda');
    assert.strictEqual(db._dump().periodos[PID].automatico.situacao, 'congelado');
    ok('recibo emitido congela o mês: a venda nova do dia 10 não entra sozinha');
  }
  {
    // recibo CANCELADO não congela
    const db = makeFakeDb(); await C.semear(db); await diasDaBusca(db);
    await db.collection('pagamentos').add({ periodId: PID, vendedor: C.V1, status: 'cancelado' });
    assert.strictEqual((await rodar(db)).situacao, 'atualizado');
    ok('recibo cancelado não congela');
  }
  {
    // dia faltando: TRAVA e não grava lançamento nenhum
    const db = makeFakeDb(); await C.semear(db); await diasDaBusca(db, { faltando: '2026-10-05' });
    const r = await rodar(db);
    assert.strictEqual(r.situacao, 'travado');
    assert.deepStrictEqual(r.diasProblema, [{ dia: '2026-10-05', situacao: 'nao_buscado' }]);
    const dump = db._dump();
    assert.ok(!dump['periodos/' + PID + '/itens'], 'nada gravado com dia faltando');
    assert.strictEqual(dump.periodos[PID].automatico.situacao, 'travado');
    assert.ok(Object.values(dump.audit_log).some(a => /NÃO atualizado — faltam dados da Pacto em 05\/10/.test(a.details)));
    ok('dia faltando na Pacto trava: nada gravado, o painel e a auditoria dizem qual dia');
  }
  {
    // o gancho: roda no fim da busca das 4h, com os módulos gêmeos iguais
    const idx = fs.readFileSync(path.join(raiz, 'functions', 'index.js'), 'utf8');
    const rs = idx.slice(idx.indexOf('async function rodarSombra('), idx.indexOf('exports.buscarPactoSombra ='));
    assert.ok(/comissoesAutomatico\.atualizarMesAutomatico\(/.test(rs), 'a busca das 4h chama o automático');
    assert.ok(rs.indexOf('atualizarTermometro') < rs.indexOf('atualizarMesAutomatico'), 'depois do termômetro');
    ['comissoes-mes.js', 'jornada-comercial.js', 'metas-sugeridas.js', 'upload-pela-api.js', 'pacto-api-linhas.js', 'pacto-adapter.js', 'commission.js'].forEach(f =>
      assert.strictEqual(fs.readFileSync(path.join(raiz, 'functions', f), 'utf8'), fs.readFileSync(path.join(raiz, f), 'utf8'), f + ': as duas cópias divergiram'));
    ok('a busca das 4h chama o automático depois do termômetro; os 7 módulos são iguais na tela e no servidor');
  }
  console.log('\n✅ smoke-comissoes-automatico: ' + n);
})().catch(e => { console.error(e); process.exit(1); });
