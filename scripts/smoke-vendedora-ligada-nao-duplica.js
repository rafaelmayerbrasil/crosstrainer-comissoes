'use strict';
// Roda: node scripts/smoke-vendedora-ligada-nao-duplica.js
//
// Em 15/10/2026 a rodada das 4h criou cadastros pendentes repetidos para a
// Francini e a Isabela: o cadastro delas tinha sido encurtado ("FRANCINI CHAGAS",
// "ISABELA MARINHO") e ligado às comissões por `nomeNasComissoes`, mas a
// preparação do mês só procurava a vendedora pelo nome do cadastro.
// Este teste passa pela MESMA preparação que a tela e o servidor usam
// (comissoes-mes.js → preparar), num banco falso. Dados INVENTADOS.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const raiz = path.join(__dirname, '..');
const makeFakeDb = require('./_fake-firestore.js');
const C = require('./_comissoes-mes-cenario.js');
const antigo = require('./_comissoes-mes-antigo.js');

let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);

async function preparar(ajustarUsers) {
  const db = makeFakeDb();
  await C.semear(db);
  await ajustarUsers(db);
  const { sandbox } = antigo.ambiente(db);
  vm.runInContext(fs.readFileSync(path.join(raiz, 'comissoes-mes.js'), 'utf8'), sandbox, { filename: 'comissoes-mes.js' });
  const M = vm.runInContext('ComissoesMes', sandbox);
  const unitConfig = (await db.collection('units').doc(C.UNIT).get()).data().config;
  const ops = M.criar({
    db, FieldValue: sandbox.firebase.firestore.FieldValue, Timestamp: sandbox.firebase.firestore.Timestamp,
    Engine: sandbox.CommissionEngine, Adapter: sandbox.PactoAdapter, Jornada: sandbox.JornadaComercial,
    autor: () => ({ uid: 'admin-uid', name: 'Admin Teste' }),
    configAtual: unitId => (unitId === C.UNIT ? unitConfig : undefined),
  });
  const prep = await ops.preparar(C.comCabecalho(C.linhasPasso1()), { unitId: C.UNIT, opcoes: { origem: 'api', dadosAte: '2026-10-11' } });
  assert.strictEqual(prep.tipo, 'ok', JSON.stringify(prep).slice(0, 200));
  return { prep, M };
}

(async () => {
  // 1. O caso de 15/10: cadastro encurtado, ligado pelo nomeNasComissoes
  {
    const { prep } = await preparar(async db => {
      await db.collection('users').doc('u1').update({ name: 'VENDEDORA UM', nomeNasComissoes: C.V1 });
      await db.collection('users').doc('u2').update({ name: 'VENDEDORA DOIS', nomeNasComissoes: C.V2 });
    });
    assert.ok(prep.vendorNames.includes(C.V1) && prep.vendorNames.includes(C.V2), 'o cenário precisa ter as duas vendedoras');
    assert.ok(!prep.newVendors.includes(C.V1), 'V1 está ligada: não é vendedora nova');
    assert.ok(!prep.newVendors.includes(C.V2), 'V2 está ligada: não é vendedora nova');
    ok('cadastro encurtado e ligado pelo nomeNasComissoes não vira vendedora nova');
    // V2 é da outra unidade: ganha esta unidade NO cadastro dela, não num novo
    const upd = prep.usersToUpdateUnit.find(u => u.id === 'u2');
    assert.ok(upd && upd.allowedUnits.includes(C.UNIT), 'a unidade vai para o cadastro ligado');
    ok('a unidade nova vai para o cadastro ligado');
  }

  // 2. Sem ligação continua como sempre foi: pelo nome do cadastro
  {
    const { prep } = await preparar(async () => {});
    assert.ok(!prep.newVendors.includes(C.V1) && !prep.newVendors.includes(C.V2));
    ok('sem ligação, o nome igual ao do cadastro continua valendo');
  }

  // 3. Nome que ninguém tem continua virando cadastro pendente
  {
    const { prep } = await preparar(async db => {
      await db.collection('users').doc('u1').update({ name: 'OUTRA PESSOA', nomeNasComissoes: 'OUTRA PESSOA' });
    });
    assert.ok(prep.newVendors.includes(C.V1), 'V1 ninguém tem: é nova');
    ok('nome que ninguém tem continua virando cadastro pendente');
  }

  // 4. Já existe o pendente repetido E o cadastro ligado: vale o ligado
  {
    const { prep } = await preparar(async db => {
      await db.collection('users').doc('u0').set({ name: C.V2, role: 'vendedor', allowedUnits: [C.UNIT], status: 'pendente', autoCreated: true });
      await db.collection('users').doc('u2').update({ name: 'VENDEDORA DOIS', nomeNasComissoes: C.V2 });
    });
    const upd = prep.usersToUpdateUnit.find(u => u.id === 'u2');
    assert.ok(upd, 'mesmo com o pendente repetido no banco, o cadastro ligado é o encontrado');
    ok('com o pendente repetido no banco, o encontrado é o cadastro ligado');
  }

  // 5. A função pura: espaço e acento não separam pessoas
  {
    const { M } = await preparar(async () => {});
    const users = [{ id: 'a', name: 'ISABELA MARINHO', nomeNasComissoes: 'ISABELA MARINHO DA ROCHA' }];
    assert.strictEqual((M._cadastroDaVendedora('Isabela  Marinho da Rocha', users) || {}).id, 'a');
    assert.strictEqual(M._cadastroDaVendedora('ISABELA', users), null, 'pedaço do nome não basta');
    ok('maiúscula e espaço não separam; pedaço do nome não basta');
  }

  // 6. O gêmeo das Functions é o mesmo arquivo
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'functions', 'comissoes-mes.js'), 'utf8'),
    fs.readFileSync(path.join(raiz, 'comissoes-mes.js'), 'utf8'), 'functions/comissoes-mes.js divergiu');
  ok('functions/comissoes-mes.js igual ao da tela');

  console.log(`\n${n} verificações ✓`);
})().catch(e => { console.error('✗', e.message); process.exit(1); });
