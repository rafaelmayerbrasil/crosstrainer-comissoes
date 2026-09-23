'use strict';
// ═══════════════════════════════════════════════════════════════════
// A data do upload vira DATA no banco, e o painel sabe ler a antiga
// ═══════════════════════════════════════════════════════════════════
//
//   node scripts/smoke-data-do-upload.js
//
// Achado em 23/09/2026 conferindo produção: todo período gravava `uploadDate`
// como o mapa {_methodName: "FieldValue.serverTimestamp"}. A limpeza de campos
// vazios do confirmUpload reconhecia o marcador do Firebase pelo NOME da classe
// ('FieldValueImpl'), e no SDK minificado o nome é outro — então ela copiava o
// marcador campo a campo e o Firebase gravava a cópia como um mapa comum. O
// painel "vendido × pago" mostrava sempre "recebimentos até —".
//
// Os trechos são EXTRAÍDOS do index.html e EXECUTADOS — ler o texto não prova
// que funciona (lição da prévia da escala, que passou por 12 testes sem rodar).
// `INDEX_HTML=<caminho>` roda contra outra versão (para ver o teste falhar).

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(process.env.INDEX_HTML || path.join(__dirname, '..', 'index.html'), 'utf8')
  .replace(/\r\n/g, '\n');

let passos = 0;
const caso = (nome, fn) => { fn(); passos++; console.log('  ✅ ' + nome); };

const trecho = (ini, fim, deOnde = 0) => {
  const i = html.indexOf(ini, deOnde);
  assert.ok(i >= 0, 'não achei no index.html: ' + ini);
  const f = html.indexOf(fim, i);
  assert.ok(f > i, 'não achei o fim do trecho: ' + fim);
  return html.slice(i, f);
};

// ─── 1. o que o confirmUpload grava ───────────────────────────────
// Marcador com nome de classe minificado, igual ao SDK de verdade.
class Xq { constructor() { this._methodName = 'FieldValue.serverTimestamp'; } }
const MARCADOR = new Xq();
const firebase = { firestore: { FieldValue: { serverTimestamp: () => MARCADOR } } };

const bloco = trecho('const rawPeriodData = {', '// Save period summary');
const montar = new Function('firebase', 'currentUnitId', 'year', 'month', 'fileName', 'currentUser',
  'uploadId', 'result', 'finalP4Result', bloco + '\n return periodData;');
const gravado = montar(firebase, 'cp', '2026', '09', 'faturamento.xls', { uid: 'u1' }, 'mudcvd06gfirr',
  { unitTotals: { unitAtivacoes: 53 }, vendorData: { ERICA: { p1total: 1, p2total: 2, p3: undefined, grandTotal: 3 } } },
  { conversions: [], currentVouchers: [{ codigo: 'C1', dateObj: new Date(), dateVoucherEnd: new Date() }] });

caso('uploadDate chega ao Firebase como o próprio marcador, não como cópia', () => {
  assert.strictEqual(gravado.uploadDate, MARCADOR,
    'uploadDate foi copiado campo a campo — o banco guarda {_methodName} no lugar da data');
});
caso('a limpeza de campos vazios continua funcionando no resto', () => {
  assert.ok(!('p3' in gravado.vendorSummary.ERICA), 'campo undefined sobreviveu');
  assert.ok(!('dateObj' in gravado.p4result.currentVouchers[0]));
  assert.strictEqual(gravado.totals.unitAtivacoes, 53);
  assert.strictEqual(gravado.uploadId, 'mudcvd06gfirr');
});

// ─── 2. o painel lê a data, inclusive dos períodos já estragados ──
const fnData = trecho('function dataDoUpload(', '\n    }\n') + '\n    }';
const dataDoUpload = new Function(fnData + '\n return dataDoUpload;')();
const fnDt = trecho('const dt = ts => {', '};', html.indexOf('function dataDoUpload(')) + '};';
const dt = new Function(fnDt + '\n return dt;')();

caso('Timestamp de verdade → a data dele', () => {
  const d = new Date(Date.UTC(2026, 9, 5, 15));
  assert.strictEqual(dataDoUpload({ uploadDate: { toDate: () => d }, uploadId: 'mudcvd06gfirr' }), d);
});
caso('período antigo (mapa no lugar da data) → data tirada do uploadId', () => {
  // valores reais de cp_2026-09 em produção, subido na noite de 22/09/2026
  const d = dataDoUpload({ uploadDate: { _methodName: 'FieldValue.serverTimestamp' }, uploadId: 'mudcvd06gfirr' });
  assert.ok(d instanceof Date, 'não recuperou data nenhuma');
  assert.ok(d >= new Date('2026-09-22T12:00:00Z') && d <= new Date('2026-09-23T03:00:00Z'), 'data fora da noite de 22/09: ' + d.toISOString());
});
caso('sem uploadDate e sem uploadId plausível → null, não chuta', () => {
  assert.strictEqual(dataDoUpload({}), null);
  assert.strictEqual(dataDoUpload({ uploadId: 'zzzzzzzzzzzz' }), null);
  assert.strictEqual(dataDoUpload({ uploadId: 'abc' }), null);
  assert.strictEqual(dataDoUpload(undefined), null);
});
caso('o formatador do painel mostra Timestamp, Date e "—"', () => {
  const d = new Date(2026, 8, 22, 21, 0);
  assert.strictEqual(dt({ toDate: () => d }), '22/09/2026');
  assert.strictEqual(dt(d), '22/09/2026');
  assert.strictEqual(dt(null), '—');
  assert.strictEqual(dt({ _methodName: 'FieldValue.serverTimestamp' }), '—');
  assert.strictEqual(dt(new Date(NaN)), '—');
});
caso('o painel usa dataDoUpload, não o campo cru', () => {
  const corpo = trecho('async function carregarVendidoXPago(', 'fechado: VendasAguardando');
  assert.ok(/recebidosAtualizadosEm:\s*dataDoUpload\(pData\)/.test(corpo), 'recebidosAtualizadosEm não passa por dataDoUpload');
});

console.log(`\nsmoke-data-do-upload: ${passos}/${passos} ✅`);
