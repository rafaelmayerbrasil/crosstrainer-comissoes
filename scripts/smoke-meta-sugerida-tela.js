'use strict';
// Roda: node scripts/smoke-meta-sugerida-tela.js
//
// A meta sugerida dentro do index.html: `proporMetaSeFaltar` é recortada do
// arquivo (por assinatura — o arquivo pode ter CRLF) e CHAMADA com um banco
// falso; os ganchos (abrir o mês, painel, recibo, janela de metas) são conferidos
// no texto. Dados INVENTADOS.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const makeFakeDb = require('./_fake-firestore.js');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

function recorta(ini, fim) {
  const a = html.indexOf(ini); const b = html.indexOf(fim, a + ini.length);
  assert.ok(a > 0 && b > a, 'não achei ' + ini);
  return html.slice(a, b);
}

(async () => {
  const fonte = recorta('async function proporMetaSeFaltar', 'function revisarMetaSugerida');
  async function montar({ admin = true, lista = true, comMeta = false } = {}) {
    const db = makeFakeDb();
    const S = (a, nr, r, v) => ({ unitAtivacoes: a, unitNovosRetorno: nr, unitRenovacoes: r, unitVouchers: v });
    const meses = { '2026-05': S(69, 33, 20, 6), '2026-06': S(58, 28, 17, 5), '2026-07': S(40, 20, 11, 11), '2026-08': S(63, 33, 16, 14), '2026-09': S(65, 30, 20, 8) };
    for (const [m, t] of Object.entries(meses)) {
      await db.collection('periodos').doc('unit-cp_' + m).set({ unitId: 'unit-cp', totals: t, metasMensais: m === '2026-09' ? { meta: 58, minVoucher: 10, minAtivacoesIndivP3: 10 } : {} });
      const ultimo = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5), 0)).toISOString().slice(0, 10);
      await db.collection('periodos').doc('unit-cp_' + m).collection('itens').doc('i').set({ type: 'processed', data: ultimo.split('-').reverse().join('/') });
    }
    await db.collection('periodos').doc('unit-cp_2026-10').set({ unitId: 'unit-cp', totals: S(3, 2, 1, 0), month: 10, year: 2026, ...(comMeta ? { metasMensais: { meta: 40 } } : {}) });
    if (lista) await db.collection('renovacoes_lista').doc('CP_2026-10').set({ situacao: 'ok', blocos: { renovacoes: new Array(20).fill({}) } });
    const chamadas = { recalc: [], audit: [], toast: [] };
    const sandbox = {
      db, console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, String, Number,
      currentUnitId: 'unit-cp', currentUser: { email: 'admin@teste' },
      userProfile: { role: admin ? 'admin' : 'vendedor' },
      firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
      MetasSugeridas: require(path.join(raiz, 'metas-sugeridas.js')),
      PactoAdapter: require(path.join(raiz, 'pacto-adapter.js')),
      recalculatePeriod: async (id, ctx) => { chamadas.recalc.push(id + ' ' + ctx.label); },
      logAudit: (t, msg) => { chamadas.audit.push(msg); },
      toast: (msg) => { chamadas.toast.push(msg); },
    };
    vm.createContext(sandbox);
    vm.runInContext(fonte, sandbox);
    const per = (await db.collection('periodos').doc('unit-cp_2026-10').get()).data();
    const r = await vm.runInContext('proporMetaSeFaltar', sandbox)('unit-cp_2026-10', per);
    const depois = (await db.collection('periodos').doc('unit-cp_2026-10').get()).data();
    return { r, depois, chamadas };
  }

  /* 1. admin abre outubro sem meta: grava a proposta marcada como sistema, recalcula e registra */
  {
    const { r, depois, chamadas } = await montar();
    assert.strictEqual(r, true);
    assert.strictEqual(depois.metasMensais.minRenov, 13, '65% das 20 renovações da lista');
    assert.strictEqual(depois.metasMensais.meta, depois.metasMensais.meta | 0);
    assert.strictEqual(depois.metaSugerida.origem, 'sistema');
    assert.strictEqual(depois.metaSugerida.revisadaPor, null);
    assert.ok(depois.metaSugerida.porque.meta && depois.metaSugerida.base.meses.length === 5);
    assert.deepStrictEqual(chamadas.recalc, ['unit-cp_2026-10 Meta do mês calculada pelo sistema']);
    assert.ok(/aguardando revisão/.test(chamadas.audit[0]));
    ok('admin abre outubro sem meta: proposta gravada como "sistema", recalculada, auditada');
  }

  /* 2. quem não propõe */
  {
    assert.strictEqual((await montar({ admin: false })).r, false, 'vendedora não grava meta');
    const c = await montar({ comMeta: true });
    assert.strictEqual(c.r, false); assert.strictEqual(c.depois.metasMensais.meta, 40, 'meta da gestão intocada');
    const semLista = await montar({ lista: false });
    assert.ok(/sem a lista de renovações/.test(semLista.depois.metaSugerida.porque.minRenov));
    ok('vendedora não propõe; mês com meta não é tocado; sem lista, a trava de renovação avisa');
  }

  /* 3. os ganchos na página */
  {
    const load = recorta('async function loadPeriod(periodId)', 'async function deletePeriod()');
    assert.ok(/await proporMetaSeFaltar\(periodId, doc\.data\(\)\)/.test(load), 'abrir o mês propõe');
    assert.ok(/MetasSugeridas\.avisoHtml\(data\)/.test(html), 'o painel mostra o aviso');
    const emitir = recorta('async function openEmitirReciboModal', 'async function confirmarEmissaoRecibos');
    assert.ok(/MetasSugeridas\.aguardandoRevisao\(pData\)[\s\S]{0,300}return;/.test(emitir), 'o recibo trava ao abrir');
    const confirmar = recorta('async function confirmarEmissaoRecibos', 'const reciboNum');
    assert.ok(/MetasSugeridas\.aguardandoRevisao\(pAtual\)[\s\S]{0,200}return;/.test(confirmar), 'e trava de novo ao confirmar');
    const salvar = recorta('async function saveMetasMes', 'async function deleteRecord');
    assert.ok(/metaSugerida: \{ revisadaPor:/.test(salvar), 'salvar a janela revisa a meta');
    assert.ok(/<script src="metas-sugeridas\.js\?v=\d{8}"><\/script>/.test(html));
    ok('ganchos: abrir o mês propõe, painel avisa, recibo trava (abrir e confirmar), janela de metas revisa');
  }

  console.log('\n✅ smoke-meta-sugerida-tela: ' + n);
})().catch(e => { console.error(e); process.exit(1); });
