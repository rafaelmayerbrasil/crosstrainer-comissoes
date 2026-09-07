'use strict';
// ===================================================================
// Homologa a correcao da recorrencia contra o Firestore de verdade
// ===================================================================
//
//   node scripts/homologar-recorrencia-agosto.js --project staging
//   node scripts/homologar-recorrencia-agosto.js --project production
//
// SOMENTE LEITURA.
//
// Refaz o caminho do upload da tela, na ordem em que o `index.html` faz:
//   1. `carregarCodigosPagosAnteriores(unitId, '2026-08')` — le do banco
//   2. `PactoAdapter.traduzir(linhas, { codigosPagos })`
//   3. `CommissionEngine.calculate(vendas, cfg)`
// Nada e recalculado por fora: o motor e o mesmo modulo que a tela carrega.
//
// Prova o que importa depois de 07/09/2026:
//   • as 7 cobrancas do robo caem em `jaPagos` — por causa do que foi gravado
//     em julho por `marcar-cobranca-robo-agosto.js`, nao por regra escondida
//   • nenhuma linha e mais excluida por "Renovacao automatica"
//   • as vendas no cartao recorrente saem listadas como aviso, nao somem
//   • a folha bate com `scripts/conferir-listas-vendedoras.js`, cenario C
const assert = require('assert');
const path = require('path');
const admin = require('firebase-admin');
const { readXlsx } = require(path.join(__dirname, 'lib-xlsx-min.js'));
const PA = require(path.join(__dirname, '..', 'pacto-adapter.js'));
const CE = require(path.join(__dirname, '..', 'commission.js'));

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const PROJETO = arg('--project');
if (!['staging', 'production'].includes(PROJETO)) {
  console.error('Uso: node scripts/homologar-recorrencia-agosto.js --project staging|production');
  process.exit(1);
}

const EXPORT_AGOSTO = path.join(__dirname, '..', 'relatorios pacto',
  'faturamento-recebido_6d85c17be56a3354e9142649a1c0a830_20260901_213346.xls');
const MES = '2026-08';
// A config NAO e escrita aqui: e lida do banco, do mesmo jeito que a tela le
// ({ defaultConfig, ...units/{id}.config, ...periodos/{id}.metasMensais }).
// Assim isto prova o que esta GRAVADO, nao o que eu acho que esta.
const ROBO = {
  CP: ['C7082', 'C7091'],
  PP: ['C4582', 'C4566', 'C4558', 'C4540', 'C4563'],
};
const FOLHA_ESPERADA = 4118.66;

admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-' + PROJETO + '.json')) });
const db = admin.firestore();
const brl = n => 'R$ ' + Number(n || 0).toFixed(2);
let n = 0;
const ok = m => console.log('  ok ' + (++n).toString().padStart(2) + '. ' + m);

/** O mesmo recorte do index.html: so periodos ANTERIORES ao mes do arquivo */
async function codigosPagosAnteriores(unitId, mesArquivo) {
  const snap = await db.collection('periodos').where('unitId', '==', unitId).get();
  const todos = new Set();
  snap.forEach(doc => {
    const m = String(doc.id).match(/(\d{4}-\d{2})$/);
    if (!m || m[1] >= mesArquivo) return;
    (doc.data().codigosPagos || []).forEach(c => todos.add(c));
  });
  return [...todos];
}

(async () => {
  console.log('homologando em ' + PROJETO + ' — agosto/2026\n');

  const wb = readXlsx(EXPORT_AGOSTO);
  const aba = wb.sheet(wb.sheetNames[0]);
  const linhas = Object.keys(aba).map(Number).sort((a, b) => a - b).map(k => aba[k]);

  const unidades = [];
  const snapU = await db.collection('units').get();
  snapU.forEach(d => unidades.push(d.id));

  let folha = 0;
  for (const sigla of ['CP', 'PP']) {
    const unitId = unidades.find(u => PA.siglaDaUnidade(u, ['CP', 'PP']) === sigla);
    assert.ok(unitId, 'unidade ' + sigla + ' nao encontrada em /units: ' + unidades.join(', '));

    const periodoId = (await db.collection('periodos').get()).docs
      .map(d => d.id).find(id => id.endsWith('_' + MES) && (id.startsWith(unitId + '_')));
    assert.ok(periodoId, 'periodo de agosto de ' + unitId + ' nao encontrado');
    const codigosPagos = await codigosPagosAnteriores(unitId, MES);
    console.log('--- ' + sigla + ' (' + unitId + ') · ' + codigosPagos.length + ' contratos ja pagos antes de agosto ---');

    ROBO[sigla].forEach(c => assert.ok(codigosPagos.includes(c),
      c + ' nao esta em codigosPagos anteriores — rode marcar-cobranca-robo-agosto.js --apply'));
    ok('os ' + ROBO[sigla].length + ' contratos do robo vieram do banco, nao de regra escondida');

    const r = PA.traduzir(linhas, { mes: MES, codigosPagos });
    const barrados = r.jaPagos.map(j => 'C' + j.contrato);
    ROBO[sigla].forEach(c => assert.ok(barrados.includes(c), c + ' devia estar em jaPagos, veio: ' + barrados.join(', ')));
    ok('as cobrancas do robo caem em jaPagos, com o motivo escrito');

    const vendas = (r.porUnidade[sigla] || []).map(v => { const o = {}; PA.CABECALHO_SAIDA.forEach(h => o[h] = v[h]); return o; });
    assert.ok(!vendas.some(v => /autom/i.test(v['Origem'] || '')),
      'nenhuma venda pode sair com Origem = Renovacao automatica');
    ok('nenhuma linha e mais excluida por origem');

    const avisosRec = (r.avisos || []).filter(a => /cart[ãa]o recorrente/i.test(a.motivo || '') && a.unidade === sigla);
    assert.ok(avisosRec.length > 0, 'as vendas no cartao recorrente tem que sair listadas');
    ok(avisosRec.length + ' vendas no cartao recorrente saem como aviso, para alguem olhar');

    const unitCfg = ((await db.collection('units').doc(unitId).get()).data() || {}).config || {};
    const pDoc = await db.collection('periodos').doc(periodoId).get();
    const metasMensais = (pDoc.data() || {}).metasMensais || {};
    assert.ok(Object.keys(metasMensais).length, periodoId + ' esta sem metasMensais — rode metas-agosto-2026.js --apply');
    ok('metas do mes vieram do banco: ' + metasMensais.meta + '/' + metasMensais.superMeta + '/' + metasMensais.metaGold +
       ' · minRenov ' + metasMensais.minRenov + ' · minIndivP3 ' + (unitCfg.minAtivacoesIndivP3 ?? CE.defaultConfig.minAtivacoesIndivP3));
    const res = CE.calculate(vendas, { ...CE.defaultConfig, ...unitCfg, ...metasMensais }, {});
    const ut = res.unitTotals;
    let subtotal = 0;
    Object.entries(res.vendorData).forEach(([nome, v]) => {
      if (v.isNaoCom) return;
      const t = v.p1total + v.p2total + v.p3 + (v.p4individual || 0) + (v.p4pool || 0);
      subtotal += t;
      console.log('       ' + nome.padEnd(24) + 'ativ=' + String(v.ativacoes).padStart(3) + '   ' + brl(t).padStart(12));
    });
    console.log('       ' + ut.unitAtivacoes + ' ativacoes · caixa ' + brl(ut.unitCaixa) + ' · subtotal ' + brl(subtotal));
    folha += subtotal;
  }

  assert.strictEqual(Math.round(folha * 100) / 100, FOLHA_ESPERADA,
    'folha de agosto: esperado ' + brl(FOLHA_ESPERADA) + ', veio ' + brl(folha));
  ok('folha de agosto bate com a conferencia: ' + brl(folha));

  console.log('\n' + n + '/' + n + ' verificacoes passaram em ' + PROJETO + '.');
  process.exit(0);
})().catch(e => { console.error('\nFALHOU: ' + e.message); process.exit(1); });
