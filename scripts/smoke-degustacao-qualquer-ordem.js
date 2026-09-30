'use strict';
// Roda: node scripts/smoke-degustacao-qualquer-ordem.js
//
// A carga da Pacto é feita VÁRIAS vezes no mês, em qualquer ordem (Rafael,
// 29/09/2026). A degustação grátis só existe no relatório de VENDAS; se ele for
// registrado depois do recebido, ela tem que entrar no mês já calculado na hora,
// sem exigir subir o recebido de novo. E registrar de novo não pode duplicar.
//
// Roda as funções do index.html (recortadas por chaves) com um banco falso:
// `acrescentarDegustacoesNoPeriodo` e `configDaUnidade` de verdade.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const CE = require(path.join(raiz, 'commission.js'));
const PA = require(path.join(raiz, 'pacto-adapter.js'));

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

let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);

// O guardado no período pelo registro do relatório de vendas (formato real)
const LUIZ = {
  codigo: 'C4638', contrato: '4638', cliente: 'LUIZ HENRIQUE APPEL', data: '25/08/2026',
  itens: 'MÊS DEGUSTAÇÃO LIVRE. - 1 - cod. 155 (25/08/2026 - 24/09/2026)', tipoVenda: 'Novo Contrato',
  vendedor: 'BÁRBARA VIEIRA CARDOSO', divididaCom: [], unidade: 'PP', mes: '2026-08',
};

function montar({ periodo, itens, unidades, currentUnitId = 'cp' }) {
  const banco = {
    periodos: { pp_2026_08: null },
    itens: new Map(itens.map((d, k) => ['old' + k, d])),
  };
  const recalculados = [], auditoria = [], codigosGravados = [];
  const colecao = (nome, paiId) => ({
    doc: (id) => ({
      get: async () => {
        if (nome === 'units') return { exists: !!unidades[id], data: () => ({ config: unidades[id] }) };
        if (nome === 'periodos') return { exists: !!periodo, data: () => periodo };
        const d = banco.itens.get(id); return { exists: !!d, data: () => d };
      },
      collection: (sub) => colecao(sub, id),
      _id: id,
    }),
    get: async () => {
      if (nome === 'itens') {
        const docs = [...banco.itens.entries()].map(([id, d]) => ({ id, data: () => d }));
        return { docs, forEach: f => docs.forEach(f) };
      }
      return { docs: [], forEach: () => {} };
    },
    where: () => colecao(nome, paiId),
  });
  const db = {
    collection: nome => colecao(nome),
    batch: () => {
      const ops = [];
      return { set: (ref, obj) => ops.push([ref._id, obj]), commit: async () => ops.forEach(([id, o]) => banco.itens.set(id, o)) };
    },
  };
  const sb = {
    console, CommissionEngine: CE, PactoAdapter: PA, db, currentUnitId,
    unitConfig: { naoComissionaveis: ['RODRIGO'] },
    firebase: { firestore: { Timestamp: { fromDate: d => ({ ts: d.toISOString() }) } } },
    carregarCodigosPagosAnteriores: async () => [],
    gravarCodigosPagos: async (id, lista) => { codigosGravados.push(lista.length); },
    recalculatePeriod: async (id, ctx) => { recalculados.push({ id, ctx }); },
    logAudit: (t, d) => { auditoria.push(d); },
    // desde 30/09/2026 as funções da tela chamam comissoes-mes.js
    ComissoesMes: require(path.join(__dirname, '..', 'comissoes-mes.js')),
  };
  sb.comissoesMes = () => sb.ComissoesMes.criar({ db, Engine: CE,
    configAtual: u => (!u || u === sb.currentUnitId ? sb.unitConfig : undefined) });
  vm.createContext(sb);
  vm.runInContext([
    extrair('generateStableId'), extrair('idsComRepeticao'), extrair('configDaUnidade'), extrair('acrescentarDegustacoesNoPeriodo'),
  ].join('\n') + '\nthis.acrescentar = acrescentarDegustacoesNoPeriodo;', sb);
  return { sb, banco, recalculados, auditoria };
}

// Unidade do período (PP) ≠ unidade aberta na tela (CP): o voucher e o corte
// saem da config do PP, que vem do banco.
const UNIDADES = { pp: { voucherFixo: 10, naoComissionaveis: ['RODRIGO'] }, cp: { voucherFixo: 99 } };
const PERIODO_CALCULADO = { unitId: 'pp', uploadId: 'up_29_09', totals: { unitAtivacoes: 42 }, metasMensais: { meta: 35 } };

(async () => {
  // 1. recebido já subido, vendas registrado depois → entra agora
  {
    const t = montar({ periodo: PERIODO_CALCULADO, itens: [{ codigo: 'C4600', type: 'processed', valorCaixa: 419 }], unidades: UNIDADES });
    const r = await t.sb.acrescentar('pp_2026-08', 'pp', '2026-08', [LUIZ]);
    assert.deepStrictEqual(r.map(d => d.cliente), ['LUIZ HENRIQUE APPEL']);
    const novo = [...t.banco.itens.values()].find(d => d.cliente === 'LUIZ HENRIQUE APPEL');
    assert.ok(novo, 'o item não foi gravado');
    assert.strictEqual(novo.type, 'processed');
    assert.strictEqual(novo.category, 'voucher');
    assert.strictEqual(novo.isActivation, true);
    assert.strictEqual(novo.valorCaixa, 0);
    assert.strictEqual(novo.vendedor, 'BÁRBARA VIEIRA CARDOSO');
    assert.strictEqual(novo.uploadId, 'up_29_09', 'sem o uploadId do mês o P4 do mês seguinte não acha o voucher');
    assert.strictEqual(novo.p1valor, 10, 'voucher da config do PP, não da unidade aberta na tela');
    assert.ok(!('dateObj' in novo));
    assert.strictEqual(t.recalculados.length, 1);
    assert.strictEqual(t.recalculados[0].id, 'pp_2026-08');
    assert.strictEqual(t.auditoria.length, 1);
    ok('mês já calculado: a degustação grátis entra na hora e o mês é recalculado (config da unidade do período)');
  }

  // 2. registrar o mesmo relatório de novo (carga repetida) não duplica
  {
    const t = montar({ periodo: PERIODO_CALCULADO, itens: [], unidades: UNIDADES });
    await t.sb.acrescentar('pp_2026-08', 'pp', '2026-08', [LUIZ]);
    const antes = t.banco.itens.size;
    const r = await t.sb.acrescentar('pp_2026-08', 'pp', '2026-08', [LUIZ]);
    assert.strictEqual(r.length, 0);
    assert.strictEqual(t.banco.itens.size, antes);
    assert.strictEqual(t.recalculados.length, 1, 'recalculou à toa');
    ok('carga repetida: não duplica e não recalcula à toa');
  }

  // 3. o recebido subido depois gera o MESMO id → o upload reconhece e não duplica
  {
    const t = montar({ periodo: PERIODO_CALCULADO, itens: [], unidades: UNIDADES });
    await t.sb.acrescentar('pp_2026-08', 'pp', '2026-08', [LUIZ]);
    const idGravado = [...t.banco.itens.keys()].find(k => t.banco.itens.get(k).cliente === 'LUIZ HENRIQUE APPEL');
    const pelaJuncao = PA.juntarDegustacoes([], [LUIZ], []).vendas;
    const rows = CE.cleanRawData([PA.CABECALHO_SAIDA, ...PA.paraPlanilha(pelaJuncao)]);
    const item = CE.processRows(rows, { ...CE.defaultConfig, ...UNIDADES.pp }).processed[0];
    assert.strictEqual(t.sb.idsComRepeticao([item])[0], idGravado);
    ok('o upload do recebido que vem depois gera o mesmo id — o dedup do upload a reconhece');
  }

  // 4. mês ainda não calculado: só fica guardada, nada é gravado nem recalculado
  {
    const t = montar({ periodo: { unitId: 'pp', vendasDoMes: [] }, itens: [], unidades: UNIDADES });
    const r = await t.sb.acrescentar('pp_2026-08', 'pp', '2026-08', [LUIZ]);
    assert.strictEqual(r.length, 0);
    assert.strictEqual(t.banco.itens.size, 0);
    assert.strictEqual(t.recalculados.length, 0);
    ok('mês sem cálculo: não grava nada — o upload do recebido a junta');
  }

  // 5. o contrato passou a ter pagamento e veio pelo recebido → não entra a de zero
  {
    const t = montar({ periodo: PERIODO_CALCULADO, itens: [{ codigo: 'C4638', type: 'processed', valorCaixa: 89 }], unidades: UNIDADES });
    const r = await t.sb.acrescentar('pp_2026-08', 'pp', '2026-08', [LUIZ]);
    assert.strictEqual(r.length, 0);
    ok('contrato que já veio pago no recebido: não paga voucher duas vezes');
  }

  // 6. recalculatePeriod usa a unidade do PERÍODO, não a aberta na tela
  {
    // desde 30/09/2026 o recálculo mora em comissoes-mes.js e a tela só chama
    assert.ok(/comissoesMes\(\)\.recalcularPeriodo\(/.test(extrair('recalculatePeriod')), 'a tela recalcula pelo módulo');
    const mod = require('fs').readFileSync(path.join(__dirname, '..', 'comissoes-mes.js'), 'utf8');
    const fn = mod.slice(mod.indexOf('async recalcularPeriodo('), mod.indexOf('Engine.marcarConversoesComoNovas'));
    assert.ok(/configDaUnidade\(unidadeDoPeriodo\)/.test(fn), 'recalculatePeriod ainda lê a unitConfig da tela');
    assert.ok(/\$\{unidadeDoPeriodo\}_\$\{prevMonthDate/.test(fn), 'o P4 ainda procura o mês anterior na unidade da tela');
    assert.ok(!/\$\{currentUnitId\}_\$\{prevMonthDate/.test(fn));
    ok('o recálculo usa a config e o mês anterior da unidade do período');
  }

  console.log(`\n✅ smoke-degustacao-qualquer-ordem: ${n}/${n}`);
})().catch(e => { console.error(e); process.exit(1); });
