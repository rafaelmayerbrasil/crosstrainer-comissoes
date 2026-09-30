'use strict';
// Roda o cenário pelo código ANTIGO da tela (referência congelada em
// scripts/fixtures/comissoes-mes-referencia.js.txt) num navegador de mentira,
// com banco falso, relógio e sorteio fixos. Devolve o banco depois de cada passo.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const raiz = path.join(__dirname, '..');
const makeFakeDb = require('./_fake-firestore.js');
const C = require('./_comissoes-mes-cenario.js');

const AGORA = Date.UTC(2026, 9, 12, 7, 30);   // 12/10/2026 04:30 em São Paulo

function ambiente(db) {
  const el = () => ({ value: '', style: {}, innerHTML: '', textContent: '', disabled: false, open: false,
    querySelector: () => null, classList: { add() {}, remove() {} } });
  const elementos = {};
  class DataFixa extends Date {
    constructor(...a) { if (a.length) super(...a); else super(AGORA); }
    static now() { return AGORA; }
  }
  const matematica = Object.create(Math);
  let semente = 0;
  matematica.random = () => ((semente = (semente * 9301 + 49297) % 233280) / 233280);
  const sandbox = {
    db, console: { log() {}, warn() {}, error() {}, info() {} },
    Date: DataFixa, Math: matematica, JSON, Object, Array, String, Number, Set, Map, Promise, RegExp, Error, parseInt, parseFloat, isNaN, Intl,
    firebase: { firestore: {
      FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
      Timestamp: { fromDate: d => ({ ts: d.toISOString() }) } } },
    document: { getElementById: id => (elementos[id] = elementos[id] || el()), querySelector: () => null, querySelectorAll: () => [] },
    toast() {}, logAudit() {}, loadPeriods: async () => {}, loadPeriod: async () => {},
    renderPreviewTable() {}, pactoResumoHtml: () => '', selectedPreviewKeys: new Set(),
    fmt: v => String(v), normalizeString: s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim(),
    globalPeriodsCache: {}, currentUnitId: C.UNIT, currentUser: { uid: 'admin-uid', email: 'admin@teste' },
    userProfile: { name: 'Admin Teste', role: 'admin' },
    CommissionEngine: require(path.join(raiz, 'commission.js')),
    PactoAdapter: require(path.join(raiz, 'pacto-adapter.js')),
    JornadaComercial: require(path.join(raiz, 'jornada-comercial.js')),
    VendasAguardando: require(path.join(raiz, 'vendas-aguardando.js')),
    pendingUpload: null,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return { sandbox, elementos };
}

/**
 * Recorta funções de primeiro nível do index.html pela assinatura, contando
 * chaves (a casca de uma linha termina na mesma linha; a longa, na chave que fecha).
 */
function extrairFuncoes(html, assinaturas) {
  return assinaturas.map(a => {
    const i = html.indexOf('    ' + a);
    if (i < 0) throw new Error('não achei no index.html: ' + a);
    let j = html.indexOf('{', i), prof = 0;
    for (; j < html.length; j++) {
      if (html[j] === '{') prof++;
      else if (html[j] === '}' && --prof === 0) break;
    }
    return html.slice(i, j + 1);
  }).join('\n\n');
}

const ASSINATURAS = ['function codigosDeContrato(', 'async function gravarCodigosPagos(', 'async function carregarCodigosPagosAnteriores(',
  'function generateStableId(', 'function idsComRepeticao(', 'function ehValorAlterado(', 'function generateSoftId(',
  'async function processarPlanilha(', 'async function autoRegisterVendors(', 'async function confirmUpload(',
  'async function saveHistoricoSnapshot(', 'function mesDoPeriodoId(', 'async function minimosDoPeriodo(',
  'async function ativacoesAdiadasPara(', 'async function configDaUnidade(', 'function comissoesMes(', 'async function recalculatePeriod('];

/**
 * @param {Object} [o]
 * @param {'referencia'|'atual'} [o.versao]  'referencia' = código congelado; 'atual' = o index.html de hoje + comissoes-mes.js
 */
async function rodar(o = {}) {
  const db = makeFakeDb();
  await C.semear(db);
  const { sandbox, elementos } = ambiente(db);
  sandbox.unitConfig = (await db.collection('units').doc(C.UNIT).get()).data().config;
  let fonte;
  if (o.versao === 'atual') {
    vm.runInContext(fs.readFileSync(path.join(raiz, 'comissoes-mes.js'), 'utf8'), sandbox, { filename: 'comissoes-mes.js' });
    fonte = extrairFuncoes(fs.readFileSync(path.join(raiz, 'index.html'), 'utf8'), ASSINATURAS);
  } else {
    fonte = fs.readFileSync(path.join(__dirname, 'fixtures', 'comissoes-mes-referencia.js.txt'), 'utf8');
  }
  // `let pendingUpload` do index.html vira global do sandbox (as funções o leem e gravam)
  vm.runInContext(fonte, sandbox, { filename: 'comissoes-mes-referencia.js' });
  const run = expr => vm.runInContext(expr, sandbox);
  const fotos = [];

  async function carregar(linhas, nome) {
    sandbox.__json = C.comCabecalho(linhas);
    await run(`processarPlanilha(__json, ${JSON.stringify(nome)}, { origem: 'api', dadosAte: '2026-10-11' })`);
    if (!run('pendingUpload')) throw new Error('processarPlanilha não preparou o upload');
    elementos.periodMonth.value = C.MES;
    await run('confirmUpload()');
  }

  await carregar(C.linhasPasso1(), 'Pacto (API) · dados até 11/10');
  fotos.push(db._dump());
  await carregar(C.linhasPasso2(), 'Pacto (API) · dados até 11/10');
  fotos.push(db._dump());
  // a gestão troca a vendedora de um lançamento e o mês é recalculado
  const pid = C.UNIT + '_' + C.MES;
  const itens = await db.collection('periodos').doc(pid).collection('itens').get();
  const alvo = itens.docs.find(d => d.data().codigo === 'C9108');
  await db.collection('periodos').doc(pid).collection('itens').doc(alvo.id).update({ vendedor: C.V1 });
  await run(`recalculatePeriod(${JSON.stringify(pid)}, { type: 'edit', label: 'Vendedora trocada' })`);
  fotos.push(db._dump());
  return fotos;
}

module.exports = { rodar, AGORA, ambiente, extrairFuncoes, ASSINATURAS };
