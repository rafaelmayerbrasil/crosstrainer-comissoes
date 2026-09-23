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

// ─── 3. "até" é o último dia DENTRO do relatório, não o dia do upload ─
// O Rafael pegou ao homologar (23/09/2026): export tirado em 22/09 e subido
// em 23/09 aparecia como "recebimentos até 23/09" — e não há nada do dia 23.
const vm = require('vm');
const recortar = nome => {
  const ini = html.indexOf(nome);
  assert.ok(ini >= 0, nome + ' não existe no index.html');
  let nivel = 0, fim = -1;
  for (let j = html.indexOf('{', ini); j < html.length; j++) {
    if (html[j] === '{') nivel++;
    else if (html[j] === '}') { nivel--; if (!nivel) { fim = j + 1; break; } }
  }
  return html.slice(ini, fim);
};
const ctx = {
  console,
  VendasAguardando: require(path.join(__dirname, '..', 'vendas-aguardando.js')),
  CommissionEngine: require(path.join(__dirname, '..', 'commission.js')),
  unitConfig: {}, currentUnitId: 'cp', currentVendidoXPago: null, db: null,
};
vm.createContext(ctx);
['function dataDoUpload(', 'function ultimoDia(', 'async function carregarVendidoXPago(', 'function blocoVendidoXPago(']
  .forEach(n => vm.runInContext(recortar(n), ctx));

caso('ultimoDia pega o dia mais recente e ignora o que não é data', () => {
  const d = ctx.ultimoDia(['01/09/2026', '22/09/2026', '', null, 'lixo', '15/09/2026 10:30']);
  assert.strictEqual(d.toLocaleDateString('pt-BR'), '22/09/2026');
  assert.strictEqual(ctx.ultimoDia([]), null);
  assert.strictEqual(ctx.ultimoDia(undefined), null);
  // atravessa o mês e o ano sem comparar texto (texto diria 31/08 > 01/09)
  assert.strictEqual(ctx.ultimoDia(['31/08/2026', '01/09/2026']).toLocaleDateString('pt-BR'), '01/09/2026');
});

// banco falso, só o que o carregador usa
const snapDe = docs => ({ forEach: fn => docs.forEach(fn), docs, size: docs.length });
const docDe = (id, dados) => ({ id, exists: !!dados, data: () => dados });
const fakeDb = (periodos, itens) => ({
  collection(nome) {
    if (nome === 'periodos') return {
      doc: id => ({
        get: async () => docDe(id, periodos[id]),
        collection: () => ({ get: async () => snapDe((itens[id] || []).map((x, i) => docDe('i' + i, x))) }),
      }),
      where: (campo, _op, valor) => ({ get: async () =>
        snapDe(Object.entries(periodos).filter(([, p]) => p[campo] === valor).map(([id, p]) => docDe(id, p))) }),
    };
    if (nome === 'vendas_conferencia') return { where: () => ({ get: async () => snapDe([]) }) };
    throw new Error('coleção inesperada: ' + nome);
  },
});

(async () => {
  const venda = (contrato, cliente, data) => ({ contrato, cliente, clienteOriginal: cliente, vendedores: ['ERICA'],
    data, inicio: data, situacao: 'Matrícula', plano: 'X | MENSAL', valorContrato: 100 });
  ctx.db = fakeDb({
    'cp_2026-09': {
      unitId: 'cp', year: 2026, month: 9,
      uploadId: 'mudcvd06gfirr', uploadDate: { _methodName: 'FieldValue.serverTimestamp' },
      // subido em 23/09. O Date nasce DENTRO do contexto, como no navegador
      // (um Date de fora falha no `instanceof Date` de lá).
      vendasAtualizadasEm: { toDate: () => vm.runInContext('new Date(2026, 8, 23, 20, 40)', ctx) },
      vendasDoMes: [venda('C1', 'ANA', '01/09/2026'), venda('C2', 'BIA', '21/09/2026')],
      codigosPagos: ['C1'],
    },
  }, {
    'cp_2026-09': [
      { type: 'processed', codigo: 'C1', cliente: 'ANA', data: '01/09/2026', valorCaixa: 100, vendedor: 'ERICA' },
      { type: 'processed', codigo: 'A9', cliente: 'PASSANTE', data: '20/09/2026', valorCaixa: 5 },
      { type: 'excluded', codigo: 'C3', cliente: 'CARLA', data: '22/09/2026', valorCaixa: 7 },
    ],
  });
  const d = await ctx.carregarVendidoXPago('cp_2026-09');

  caso('o carregador devolve o último dia de cada relatório', () => {
    assert.strictEqual(d.vendasAte.toLocaleDateString('pt-BR'), '21/09/2026');
    // a linha excluída também estava no arquivo
    assert.strictEqual(d.recebidosAte.toLocaleDateString('pt-BR'), '22/09/2026');
  });
  caso('o quadro diz "até" com o dia DOS DADOS, e o dia do upload fica só na dica', () => {
    const bloco = ctx.blocoVendidoXPago(d, {});
    const visivel = bloco.replace(/title="[^"]*"/g, '');
    assert.ok(/vendas até 21\/09\/2026 · recebimentos até 22\/09\/2026/.test(visivel),
      'texto visível errado: ' + (visivel.match(/vendas até[^<]*/) || [''])[0].trim());
    assert.ok(!/23\/09\/2026/.test(visivel), 'o dia do upload (23/09) não pode aparecer como "até"');
    assert.ok(/title="[^"]*subidos em[^"]*23\/09\/2026/.test(bloco), 'a dica deve dizer quando o arquivo subiu: ' + (bloco.match(/title="[^"]*"/g) || []).join(' | '));
  });
  console.log(`\nsmoke-data-do-upload: ${passos}/${passos} ✅`);
})().catch(e => { console.error(e); process.exit(1); });
