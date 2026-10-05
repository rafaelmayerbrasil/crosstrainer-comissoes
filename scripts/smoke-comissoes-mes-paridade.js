'use strict';
// Roda: node scripts/smoke-comissoes-mes-paridade.js
//
// A gravação do mês saiu do index.html para comissoes-mes.js (30/09/2026) para o
// servidor atualizar o mês sozinho pelo MESMO código. Este teste prova que nada
// mudou: o mesmo cenário (1ª carga · recarga com venda a menos, a mais e valor
// mudado · recálculo depois de trocar a vendedora) roda pelo código ANTIGO da tela
// (congelado em scripts/fixtures/) e pelo módulo novo, e o banco tem que sair
// IGUAL, documento por documento, depois de cada passo. Dados INVENTADOS.

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

/** O módulo novo no mesmo relógio e sorteio do antigo (o uploadId usa os dois) */
async function rodarNovo() {
  const db = makeFakeDb();
  await C.semear(db);
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
  const fotos = [];
  async function carregar(linhas, nome) {
    const prep = await ops.preparar(C.comCabecalho(linhas), { unitId: C.UNIT, opcoes: { origem: 'api', dadosAte: '2026-10-11' } });
    assert.strictEqual(prep.tipo, 'ok', JSON.stringify(prep).slice(0, 200));
    await ops.gravar(prep, { unitId: C.UNIT, mes: C.MES, fileName: nome, origem: 'api', dadosAte: '2026-10-11' });
  }
  await carregar(C.linhasPasso1(), 'Pacto (API) · dados até 11/10');
  fotos.push(db._dump());
  await carregar(C.linhasPasso2(), 'Pacto (API) · dados até 11/10');
  fotos.push(db._dump());
  const pid = C.UNIT + '_' + C.MES;
  const itens = await db.collection('periodos').doc(pid).collection('itens').get();
  const alvo = itens.docs.find(d => d.data().codigo === 'C9108');
  await db.collection('periodos').doc(pid).collection('itens').doc(alvo.id).update({ vendedor: C.V1 });
  await ops.recalcularPeriodo(pid, { type: 'edit', label: 'Vendedora trocada' });
  fotos.push(db._dump());
  return fotos;
}

// O módulo novo LÊ o caderninho de contratos (mensalidade seguinte do plano recorrente, 05/10/2026) e o
// banco falso cria a coleção vazia só de ser lida: coleção vazia não é diferença de banco.
const semColecaoVazia = banco => Object.fromEntries(Object.entries(banco).filter(([, docs]) => Object.keys(docs || {}).length));

/** Primeira diferença entre dois bancos, com o caminho (para o erro dizer ONDE) */
function diferenca(a, b, onde = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = diferenca(a[k], b[k], onde + '/' + k);
      if (d) return d;
    }
  }
  const txt = v => String(JSON.stringify(v)).slice(0, 160);   // campo ausente de um lado = undefined
  return onde + ': antigo=' + txt(a) + ' · novo=' + txt(b);
}

(async () => {
  const velho = await antigo.rodar();
  const novo = await rodarNovo();
  const pid = C.UNIT + '_' + C.MES;
  ['1ª carga do mês', 'recarga (venda a menos, a mais, valor mudado)', 'recálculo depois de trocar a vendedora'].forEach((passo, i) => {
    const d = diferenca(semColecaoVazia(velho[i]), semColecaoVazia(novo[i]));
    assert.strictEqual(d, null, `passo ${i + 1} (${passo}) divergiu em ${d}`);
    const p = novo[i].periodos[pid];
    ok(`${passo}: banco idêntico (${Object.keys(novo[i]['periodos/' + pid + '/itens'] || {}).length} lançamentos, ` +
      `${p.totals.unitAtivacoes} ativações, ${Object.keys(novo[i]['periodos/' + pid + '/historico'] || {}).length} fotos no histórico)`);
  });
  // o cenário exercita o que importa (senão a paridade prova pouco)
  const f2 = novo[1];
  const hist = Object.values(f2['periodos/' + pid + '/historico']);
  const mudancas = hist.flatMap(h => (h.itemDeltas || []).map(x => x.change));
  assert.ok(mudancas.includes('added') && mudancas.includes('removed') && mudancas.includes('valor_alterado_ignorado'), mudancas.join(','));
  assert.ok(Object.values(novo[0].users).some(u => u.autoCreated && u.status === 'pendente'), 'vendedora nova cadastrada');
  assert.ok(Object.values(novo[0].users).some(u => (u.allowedUnits || []).includes(C.UNIT) && (u.allowedUnits || []).includes('unit-cp')), 'vendedora ganhou a unidade');
  assert.ok(novo[2].periodos[pid].vendorSummary[C.V1].ativacoes > novo[1].periodos[pid].vendorSummary[C.V1].ativacoes, 'o recálculo usou a vendedora editada');
  ok('o cenário passa por venda nova, removida, valor mudado, vendedora nova e edição');

  // a TELA de hoje (as cascas do index.html chamando o módulo) deixa o mesmo banco
  const tela = await antigo.rodar({ versao: 'atual' });
  ['1ª carga', 'recarga', 'recálculo'].forEach((passo, i) => {
    const d = diferenca(semColecaoVazia(velho[i]), semColecaoVazia(tela[i]));
    assert.strictEqual(d, null, `tela atual, passo ${i + 1} (${passo}) divergiu em ${d}`);
  });
  ok('as funções da tela de hoje (cascas chamando o módulo) deixam o banco idêntico ao código antigo nos 3 passos');

  // as duas cópias do módulo (tela e servidor) são idênticas
  const gemeo = path.join(raiz, 'functions', 'comissoes-mes.js');
  assert.ok(fs.existsSync(gemeo), 'falta functions/comissoes-mes.js');
  assert.strictEqual(fs.readFileSync(gemeo, 'utf8'), fs.readFileSync(path.join(raiz, 'comissoes-mes.js'), 'utf8'),
    'as duas cópias divergiram — o deploy de Functions só leva functions/');
  ok('a cópia de functions/ é idêntica à da raiz');

  console.log('\n✅ smoke-comissoes-mes-paridade: ' + n);
})().catch(e => { console.error(e); process.exit(1); });
