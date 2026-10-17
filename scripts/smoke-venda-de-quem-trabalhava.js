'use strict';
// Roda: node scripts/smoke-venda-de-quem-trabalhava.js
//
// A venda só fica com quem já trabalhava na data dela (16/10/2026). A Pacto põe
// em cada venda a consultora de HOJE do aluno; em set/2026 a carteira da Bárbara
// passou para a Isabela e vendas de 01–13/09 foram para a Isabela, que começou em
// 14/09. Regra do Rodrigo, escolhida pelo Rafael: `comercialInicio`/`comercialFim`
// no cadastro; fora disso a venda fica com quem estava, ou vai para "Sem Vendedor".
// Passa pela MESMA preparação + gravação que a tela e o servidor usam. Dados INVENTADOS.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const raiz = path.join(__dirname, '..');
const makeFakeDb = require('./_fake-firestore.js');
const C = require('./_comissoes-mes-cenario.js');
const antigo = require('./_comissoes-mes-antigo.js');
const L = require(path.join(raiz, 'pacto-api-linhas.js'));
const J = require(path.join(raiz, 'jornada-comercial.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);

// ── 1. A regra pura ──
{
  const isa = { comercialInicio: '2026-09-14' };
  assert.strictEqual(J.trabalhavaEm(isa, '13/09/2026'), false);
  assert.strictEqual(J.trabalhavaEm(isa, '14/09/2026'), true, 'o primeiro dia já é dela');
  const saiu = { comercialInicio: '2026-01-01', comercialFim: '2026-09-13' };
  assert.strictEqual(J.trabalhavaEm(saiu, '13/09/2026'), true, 'o último dia ainda é dela');
  assert.strictEqual(J.trabalhavaEm(saiu, '14/09/2026'), false);
  assert.strictEqual(J.trabalhavaEm({}, '01/01/2020'), true, 'sem data no cadastro, sem restrição');
  assert.strictEqual(J.trabalhavaEm(null, '01/01/2020'), true);
  assert.deepStrictEqual(J.validarPeriodo('2026-09-14', ''), []);
  assert.ok(J.validarPeriodo('2026-09-14', '2026-09-01').length, 'saída antes do começo');
  assert.ok(J.validarPeriodo('14/09/2026', '').length, 'formato errado');
  ok('trabalhavaEm: primeiro e último dia contam; sem data não restringe');
}
assert.strictEqual(fs.readFileSync(path.join(raiz, 'functions', 'jornada-comercial.js'), 'utf8'),
  fs.readFileSync(path.join(raiz, 'jornada-comercial.js'), 'utf8'), 'functions/jornada-comercial.js divergiu');
assert.strictEqual(fs.readFileSync(path.join(raiz, 'functions', 'comissoes-mes.js'), 'utf8'),
  fs.readFileSync(path.join(raiz, 'comissoes-mes.js'), 'utf8'), 'functions/comissoes-mes.js divergiu');
ok('gêmeos das Functions iguais (jornada-comercial.js e comissoes-mes.js)');

// ── 2. Pela gravação do mês, num banco falso ──
async function ambiente() {
  const db = makeFakeDb();
  await C.semear(db);
  const { sandbox } = antigo.ambiente(db);
  vm.runInContext(fs.readFileSync(path.join(raiz, 'jornada-comercial.js'), 'utf8'), sandbox, { filename: 'jornada-comercial.js' });
  vm.runInContext(fs.readFileSync(path.join(raiz, 'comissoes-mes.js'), 'utf8'), sandbox, { filename: 'comissoes-mes.js' });
  const M = vm.runInContext('ComissoesMes', sandbox);
  const unitConfig = (await db.collection('units').doc(C.UNIT).get()).data().config;
  const ops = M.criar({
    db, FieldValue: sandbox.firebase.firestore.FieldValue, Timestamp: sandbox.firebase.firestore.Timestamp,
    Engine: sandbox.CommissionEngine, Adapter: sandbox.PactoAdapter, Jornada: vm.runInContext('JornadaComercial', sandbox),
    autor: () => ({ uid: 'admin-uid', name: 'Admin Teste' }),
    configAtual: unitId => (unitId === C.UNIT ? unitConfig : undefined),
  });
  async function carregar(linhas) {
    const prep = await ops.preparar(C.comCabecalho(linhas), { unitId: C.UNIT, opcoes: { origem: 'api', dadosAte: '2026-10-11' } });
    assert.strictEqual(prep.tipo, 'ok', JSON.stringify(prep).slice(0, 200));
    return ops.gravar(prep, { unitId: C.UNIT, mes: C.MES, fileName: 'teste', origem: 'api', dadosAte: '2026-10-11' });
  }
  const itens = async () => (await db.collection('periodos').doc(C.UNIT + '_' + C.MES).collection('itens').get()).docs
    .map(d => ({ id: d.id, ...d.data() })).filter(i => (i.type || 'processed') === 'processed');
  return { db, M, carregar, itens };
}
// A carteira da V1 passou para a V2: a Pacto agora mostra a V2 nas vendas dos alunos da V1
const transferida = () => C.linhasPasso1().map(l => {
  if (l[L.COL.consultor] === C.V1) { l = l.slice(); l[L.COL.consultor] = C.V2; l[L.COL.resp1] = C.V2; l[L.COL.resp2] = C.V2; }
  return l;
});
const cliente = (lista, nome) => lista.filter(i => i.cliente === nome);

(async () => {
  // 2a. Carteira transferida: venda de antes da V2 começar fica com a V1
  {
    const { db, carregar, itens } = await ambiente();
    await carregar(C.linhasPasso1());
    const antes = await itens();
    await db.collection('users').doc('u2').update({ comercialInicio: '2026-10-05' });
    const r = await carregar(transferida());
    const depois = await itens();
    const a = cliente(depois, 'CLIENTE A');
    assert.strictEqual(a.length, 1);
    assert.strictEqual(a[0].vendedor, C.V1, 'venda de 02/10: a V2 só começou em 05/10');
    assert.strictEqual(a[0].id, cliente(antes, 'CLIENTE A')[0].id, 'é o MESMO lançamento (não apagou e recriou)');
    assert.strictEqual(cliente(depois, 'CLIENTE C')[0].vendedor, C.V1, 'venda de 04/10 também');
    const f = cliente(depois, 'CLIENTE F');
    assert.strictEqual(f.length, 2, 'os dois Monsters do mesmo dia continuam dois');
    assert.ok(f.every(i => i.vendedor === C.V2), 'venda de 06/10: a V2 já trabalhava, a Pacto manda');
    assert.ok(r.foraDaData >= 2);
    ok('carteira transferida: venda de antes do começo fica com quem estava; depois do começo, segue a Pacto');

    const p = (await db.collection('periodos').doc(C.UNIT + '_' + C.MES).get()).data();
    const deV2 = depois.filter(i => i.vendedor === C.V2 && i.data < '05/10/2026' && i.data.endsWith('/10/2026'));
    assert.strictEqual(deV2.length, 0, 'nenhuma venda da V2 antes de 05/10');
    assert.ok(p.vendorSummary[C.V1], 'a V1 continua no resumo do mês');
    ok('o resumo do mês é refeito com a venda na pessoa certa');

    // Ler de novo não muda nada
    const foto = JSON.stringify(depois.map(i => [i.id, i.vendedor]).sort());
    await carregar(transferida());
    assert.strictEqual(JSON.stringify((await itens()).map(i => [i.id, i.vendedor]).sort()), foto);
    ok('a leitura seguinte não mexe em nada');
  }

  // 2b. Primeira leitura já com a dona errada e ninguém antes: vai para Sem Vendedor
  {
    const { db, carregar, itens } = await ambiente();
    await db.collection('users').doc('u2').update({ comercialInicio: '2026-10-05' });
    await carregar(C.linhasPasso1());
    const b = cliente(await itens(), 'CLIENTE B')[0];
    assert.strictEqual(b.vendedor, 'Sem Vendedor', 'venda de 03/10 da V2, que começou em 05/10');
    assert.strictEqual(b.vendedoraNaPacto, C.V2, 'guarda quem a Pacto mostrava');
    ok('sem ninguém antes: "Sem Vendedor", guardando quem a Pacto mostrava');

    // A gestão escolhe a dona em Lançamentos (edita o campo) — a leitura seguinte respeita
    await db.collection('periodos').doc(C.UNIT + '_' + C.MES).collection('itens').doc(b.id).update({ vendedor: C.V1 });
    await carregar(C.linhasPasso1());
    const b2 = cliente(await itens(), 'CLIENTE B');
    assert.strictEqual(b2.length, 1);
    assert.strictEqual(b2[0].vendedor, C.V1, 'a escolha da gestão fica');
    ok('a escolha da gestão em Lançamentos fica nas leituras seguintes');
  }

  // 2c. Quem saiu: venda depois da saída não fica com ela
  {
    const { db, carregar, itens } = await ambiente();
    await db.collection('users').doc('u1').update({ comercialFim: '2026-10-03' });
    await carregar(C.linhasPasso1());
    const l = await itens();
    assert.strictEqual(cliente(l, 'CLIENTE A')[0].vendedor, C.V1, '02/10: ainda trabalhava');
    assert.strictEqual(cliente(l, 'CLIENTE C')[0].vendedor, 'Sem Vendedor', '04/10: já tinha saído');
    ok('quem saiu: venda depois da saída vai para "Sem Vendedor"');
  }

  // 2d. Sem data no cadastro, nada muda (o cenário de sempre)
  {
    const { carregar, itens } = await ambiente();
    const r = await carregar(C.linhasPasso1());
    assert.strictEqual(r.foraDaData, 0);
    assert.ok(!(await itens()).some(i => i.vendedoraNaPacto));
    ok('sem data no cadastro, nada muda');
  }

  console.log(`\n${n} verificações ✓`);
})().catch(e => { console.error('✗', e.message); process.exit(1); });
