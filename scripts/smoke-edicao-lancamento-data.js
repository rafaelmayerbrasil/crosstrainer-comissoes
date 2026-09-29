'use strict';
// Roda: node scripts/smoke-edicao-lancamento-data.js
//
// A janela "Editar Lançamento" abria com a DATA vazia (29/09/2026, print do
// Rafael ao trocar o vendedor da degustação do Luiz Henrique Appel). A conversão
// dd/mm/aaaa → aaaa-mm-dd saía com espaços ("2026-08 -25 "), que o campo de data
// recusa. Como o campo é obrigatório, não dava para salvar sem digitar a data de
// novo — e digitar uma data de outro mês MUDA o lançamento de período.
//
// Em 29/09/2026 também: a lista de vendedores só mostrava o nome já escrito, e a
// edição passou a mudar só o vendedor e o cancelamento (decisão do Rafael).
//
// Roda as funções do index.html com DOM e banco falsos.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extrair(nome) {
  const ini = html.indexOf('function ' + nome + '(');
  assert.ok(ini > 0, 'função ' + nome + ' não existe no index.html');
  const inicio = html.lastIndexOf('async ', ini) === ini - 6 ? ini - 6 : ini;
  let nivel = 0;
  for (let j = html.indexOf('{', ini); j < html.length; j++) {
    if (html[j] === '{') nivel++;
    else if (html[j] === '}') { nivel--; if (!nivel) return html.slice(inicio, j + 1); }
  }
  throw new Error('não achei o fim de ' + nome);
}

// Campo de data como o navegador: valor fora de aaaa-mm-dd vira vazio
let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);

function campo(tipo) {
  let v = '';
  return {
    type: tipo, checked: false, textContent: '', classList: { add() {} },
    get value() { return v; },
    set value(x) { v = (tipo === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(x))) ? '' : String(x); },
  };
}

const CE = require(path.join(__dirname, '..', 'commission.js'));

// Itens do mês (o que alimenta a lista de vendedores)
const DO_MES = [
  { vendedor: 'KALI DUTRA' }, { vendedor: 'BÁRBARA VIEIRA CARDOSO' }, { vendedor: 'FRANCINI DAS CHAGAS' },
  { vendedor: 'ERICA FAUSTINO' }, { vendedor: 'KALI DUTRA' }, { vendedor: 'Sem Vendedor' },
];

function montar(item) {
  const els = {};
  ['recId', 'recVend', 'recCli', 'recItem', 'recCaixa', 'recTipo', 'recCat', 'recAjusteP1', 'recAjusteP2', 'recCancelado',
    'recordModalTitle', 'recordModal', 'recVendSel', 'recAjustesBloco', 'recAvisoLeitura', 'recForm']
    .forEach(id => { els[id] = campo('text'); els[id].style = {}; els[id].innerHTML = ''; els[id].focus = () => {}; els[id].reset = () => {}; });
  els.recData = campo('date'); els.recData.style = {};
  const gravados = [], recalculos = [];
  const doc = id => ({
    get: async () => ({ exists: true, data: () => JSON.parse(JSON.stringify(item)) }),
    update: async d => gravados.push({ id, d }), set: async d => gravados.push({ id, d, set: true }), delete: async () => gravados.push({ id, del: true }),
  });
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({}) }), set: async () => {}, collection: () => ({ doc }) }) }) };
  const sb = {
    document: { getElementById: id => els[id] }, db, currentPeriodId: 'pp_2026-08', currentUnitId: 'pp',
    currentPeriodItems: DO_MES, CommissionEngine: CE, unitConfig: {}, globalPeriodsCache: {},
    toast: () => {}, logAudit: () => {}, fmt: n => String(n), closeRecordModal: () => {},
    recalculatePeriod: async (id, c) => recalculos.push(id), renderAdminDashboard: () => {}, renderRecordsTable: () => {},
    loadPeriods: async () => {}, generateStableId: () => 'novo',
  };
  vm.createContext(sb);
  vm.runInContext(['openEditRecordModal', 'montarListaVendedores', 'travarDadosDaFonte', 'escolherVendedorLancamento', 'saveRecord']
    .map(extrair).join(';\n') + ';\nthis.abrir = openEditRecordModal; this.salvar = saveRecord; this.escolher = escolherVendedorLancamento;', sb);
  return { sb, els, gravados, recalculos };
}

const LUIZ = { vendedor: 'BÁRBARA VIEIRA CARDOSO', cliente: 'LUIZ HENRIQUE APPEL', data: '25/08/2026',
  item: 'MÊS DEGUSTAÇÃO LIVRE. - 1 - cod. 155 (25/08/2026 - 24/09/2026)', valorCaixa: 0, tipoVenda: 'Novo Contrato',
  category: 'voucher', isDegustacao: true, codigo: 'C4638' };

(async () => {
  {
    const t = montar(LUIZ);
    await t.sb.abrir('x');
    assert.strictEqual(t.els.recData.value, '2026-08-25', 'a data do lançamento não chegou ao campo');
    ok('a janela abre com a data do lançamento no campo (25/08/2026 → 2026-08-25)');

    const h = t.els.recVendSel.innerHTML;
    ['KALI DUTRA', 'BÁRBARA VIEIRA CARDOSO', 'FRANCINI DAS CHAGAS', 'ERICA FAUSTINO', 'Outro nome'].forEach(n => assert.ok(h.includes(n), 'falta ' + n + ' na lista'));
    assert.strictEqual((h.match(/KALI DUTRA/g) || []).length, 2, 'nome repetido na lista');   // value + texto, uma opção
    assert.ok(!h.includes('Sem Vendedor'));
    assert.strictEqual(t.els.recVendSel.value, 'BÁRBARA VIEIRA CARDOSO');
    ok('a lista de vendedores traz todos os do mês (sem repetir), com o atual marcado');

    ['recCli', 'recData', 'recCaixa', 'recItem', 'recTipo'].forEach(id => assert.strictEqual(t.els[id].readOnly, true, id + ' editável'));
    assert.strictEqual(t.els.recCat.disabled, true);
    assert.strictEqual(t.els.recAjustesBloco.style.display, 'none');
    ok('na edição, cliente/data/valor/plano/tipo/categoria ficam só leitura e os ajustes de P1/P2 somem');

    // troca para a Kali e salva: só o vendedor muda
    t.els.recVendSel.value = 'KALI DUTRA'; t.sb.escolher();
    t.els.recCaixa.value = '999';               // mesmo que alguém force o campo…
    t.els.recCat.value = '';                    // …ou a categoria não esteja na lista da janela
    await t.sb.salvar({ preventDefault() {} });
    const up = t.gravados.find(g => !g.set && !g.del);
    assert.ok(up, 'não gravou');
    assert.strictEqual(up.d.vendedor, 'KALI DUTRA');
    assert.strictEqual(up.d.valorCaixa, 0);
    assert.strictEqual(up.d.category, 'voucher');
    assert.strictEqual(up.d.data, '25/08/2026');
    assert.strictEqual(up.d.item, LUIZ.item);
    assert.ok(!t.gravados.some(g => g.del), 'o lançamento mudou de mês');
    assert.deepStrictEqual(t.recalculos, ['pp_2026-08']);
    ok('salvar a edição muda só o vendedor; valor, categoria, data e plano ficam os da Pacto, e o mês é recalculado');
  }
  {
    const t = montar(LUIZ);
    await t.sb.abrir('x');
    t.els.recCancelado.checked = true;
    await t.sb.salvar({ preventDefault() {} });
    const up = t.gravados.find(g => !g.set && !g.del);
    assert.strictEqual(up.d.canceladoSemEstorno, true);
    assert.strictEqual(up.d.vendedor, 'BÁRBARA VIEIRA CARDOSO');
    ok('marcar o cancelamento grava o cancelamento e mantém o vendedor');
  }
  {
    const t = montar(LUIZ);
    await t.sb.abrir('x');
    t.els.recVendSel.value = '__outro__'; t.sb.escolher();
    assert.strictEqual(t.els.recVend.style.display, '');
    t.els.recVend.value = 'nova vendedora';
    await t.sb.salvar({ preventDefault() {} });
    assert.strictEqual(t.gravados.find(g => !g.set && !g.del).d.vendedor, 'NOVA VENDEDORA');
    ok('"Outro nome…" abre o campo de texto e grava o nome digitado');
  }
  {
    const t = montar({ vendedor: 'KALI DUTRA', data: '' });
    await t.sb.abrir('x');
    assert.strictEqual(t.els.recData.value, '');
    ok('lançamento sem data continua abrindo, com o campo vazio');
  }
  console.log(`
✅ smoke-edicao-lancamento-data: ${n}/${n}`);
})().catch(e => { console.error(e); process.exit(1); });
