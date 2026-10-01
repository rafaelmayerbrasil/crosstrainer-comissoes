'use strict';
// Roda: node scripts/smoke-janela-metas.js
//
// ══════════════════════════════════════════════════════════════════════
// A JANELA "CONFIGURAR METAS DO MÊS" TEM QUE MOSTRAR AS METAS DO MÊS CERTO
// ══════════════════════════════════════════════════════════════════════
//
// 28/09/2026: a janela foi aberta em agosto do Príncipe (metas 35/41/49,
// corte individual 7) e apareceu o PADRÃO da unidade (50/57/65, corte 10).
// Salvar gravou o padrão por cima e zerou o P3 do mês — Kali R$ 1.310,61 →
// R$ 841,12. Causa: a janela preenchia a partir de `window.currentPeriodData`,
// uma cópia em memória que podia ser de OUTRO mês (setembro, sem metas
// próprias, cai no padrão). E nada na janela dizia de que mês eram os números.
//
// Agora a janela relê o período do banco ao abrir, diz o mês e a unidade no
// topo, avisa quando o mês ainda não tem metas próprias, só deixa salvar
// depois de carregar e grava no período para o qual foi aberta.
//
// Este teste RODA as funções do index.html (recortadas por chaves, não por
// quebra de linha — ver o recorte em arquivo CRLF) com DOM e banco falsos.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const CE = require(path.join(raiz, 'commission.js'));

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

const IDS = ['mm_meta', 'mm_metaFixo', 'mm_superMeta', 'mm_superFixo', 'mm_metaGold', 'mm_goldFixo',
  'mm_minNovos', 'mm_minRenov', 'mm_minVoucher', 'mm_minAtivIndiv',
  'mm_periodoLabel', 'mm_origem', 'mm_btnSalvar', 'metasMesModal', 'mm_textoTravas', 'mm_textoIndiv'];

// Metas de produção em 28/09/2026
const METAS_AGO_PP = { meta: 35, metaFixo: 300, superMeta: 41, superFixo: 600, metaGold: 49, goldFixo: 900,
  minNovos: 15, minRenov: 9, minVoucher: 4, minAtivacoesIndivP3: 7 };
const UNIT_PP = { name: 'CrossTainer PP', meta: 50, superMeta: 57, metaGold: 65, minNovos: 18, minRenov: 25, minVoucher: 7 };

function montar({ periodos, currentPeriodId, currentPeriodData, falhaLeitura = false }) {
  const els = {};
  IDS.forEach(id => {
    els[id] = { id, value: '', textContent: '', innerHTML: '', disabled: false, style: {},
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } } };
  });
  const gravados = [];
  const toasts = [];
  const recalculados = [];
  const db = {
    collection: (col) => ({
      doc: (id) => ({
        get: async () => {
          if (falhaLeitura) throw new Error('sem rede');
          const d = periodos[id];
          return { exists: !!d, id, data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined) };
        },
        set: async (obj, opt) => { gravados.push({ col, id, obj, opt }); },
      }),
    }),
  };
  const sb = {
    console, CommissionEngine: CE, db,
    document: { getElementById: id => els[id] || null },
    window: { currentPeriodData },
    unitConfig: UNIT_PP, currentUnitId: 'pp', currentPeriodId,
    toast: (m, t) => toasts.push({ m, t }),
    recalculatePeriod: async (id) => recalculados.push(id),
    loadPeriod: async () => {},
    logAudit: () => {},
    // desde 30/09/2026 a casca da tela chama comissoes-mes.js
    ComissoesMes: require(path.join(__dirname, '..', 'comissoes-mes.js')),
    // os textos da janela seguem a regra do bônus do mês (30/09/2026)
    MetasSugeridas: require(path.join(__dirname, '..', 'metas-sugeridas.js')),
  };
  vm.createContext(sb);
  ['openMetasMesModal', 'closeMetasMesModal', 'saveMetasMes', 'mesDoPeriodoId'].forEach(f => vm.runInContext(extrair(f), sb));
  // `var` do sandbox: as funções leem estes nomes como globais da página
  vm.runInContext('var metasMesPeriodId = null;', sb);
  return { sb, els, gravados, toasts, recalculados };
}

const PERIODOS = {
  'pp_2026-08': { unitId: 'pp', year: 2026, month: 8, metasMensais: METAS_AGO_PP },
  'pp_2026-09': { unitId: 'pp', year: 2026, month: 9 }, // sem metas próprias
  'cp_2026-08': { unitId: 'cp', year: 2026, month: 8, metasMensais: METAS_AGO_PP },
  'pp_2026-10': { unitId: 'pp', year: 2026, month: 10, metasMensais: METAS_AGO_PP },
};

(async () => {
  {
    // O caso de 28/09: janela aberta em agosto com a cópia de SETEMBRO na memória
    const t = montar({ periodos: PERIODOS, currentPeriodId: 'pp_2026-08', currentPeriodData: PERIODOS['pp_2026-09'] });
    await t.sb.openMetasMesModal();
    assert.strictEqual(Number(t.els.mm_meta.value), 35, 'meta de agosto é 35, veio ' + t.els.mm_meta.value);
    assert.strictEqual(Number(t.els.mm_superMeta.value), 41);
    assert.strictEqual(Number(t.els.mm_metaGold.value), 49);
    assert.strictEqual(Number(t.els.mm_minAtivIndiv.value), 7, 'corte de agosto é 7, veio ' + t.els.mm_minAtivIndiv.value);
    ok('aberta em ago/PP com a cópia de setembro na memória, mostra 35/41/49 e corte 7 (o banco manda)');
  }
  {
    // E salvar sem mexer grava exatamente o que estava lá
    const t = montar({ periodos: PERIODOS, currentPeriodId: 'pp_2026-08', currentPeriodData: PERIODOS['pp_2026-09'] });
    await t.sb.openMetasMesModal();
    await t.sb.saveMetasMes();
    assert.strictEqual(t.gravados.length, 1);
    assert.strictEqual(t.gravados[0].id, 'pp_2026-08');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(t.gravados[0].obj.metasMensais)), METAS_AGO_PP, 'salvar sem mexer não pode mudar nada');
    ok('abrir e salvar sem mexer grava as mesmas metas, no mesmo mês');
  }
  {
    // A janela diz de que mês e de que unidade são os números
    const t = montar({ periodos: PERIODOS, currentPeriodId: 'pp_2026-08', currentPeriodData: null });
    await t.sb.openMetasMesModal();
    const rotulo = t.els.mm_periodoLabel.textContent;
    assert.ok(/ago/i.test(rotulo) && /2026/.test(rotulo), 'o mês aparece no topo: "' + rotulo + '"');
    assert.ok(/PP/.test(rotulo), 'a unidade aparece no topo: "' + rotulo + '"');
    assert.ok(/próprias/i.test(t.els.mm_origem.textContent), 'mês com metas próprias diz isso: "' + t.els.mm_origem.textContent + '"');
    ok('o topo da janela diz o mês e a unidade: "' + rotulo + '"');
  }
  {
    // Mês SEM metas próprias: avisa que os números são o padrão da unidade
    const t = montar({ periodos: PERIODOS, currentPeriodId: 'pp_2026-09', currentPeriodData: PERIODOS['pp_2026-08'] });
    await t.sb.openMetasMesModal();
    assert.strictEqual(Number(t.els.mm_meta.value), 50, 'setembro sem metas cai no padrão da unidade (50)');
    assert.ok(/padrão da unidade/i.test(t.els.mm_origem.textContent),
      'avisa que é o padrão: "' + t.els.mm_origem.textContent + '"');
    ok('mês sem metas próprias avisa que os números são o padrão da unidade');
  }
  {
    // Não dá para salvar antes de carregar, nem se a leitura falhar
    const t = montar({ periodos: PERIODOS, currentPeriodId: 'pp_2026-08', currentPeriodData: null, falhaLeitura: true });
    await t.sb.openMetasMesModal();
    assert.ok(t.els.mm_btnSalvar.disabled, 'botão de salvar fica travado se não leu o mês');
    await t.sb.saveMetasMes();
    assert.strictEqual(t.gravados.length, 0, 'nada é gravado sem ter lido o mês');
    assert.ok(t.toasts.some(x => x.t === 'error'), 'e a pessoa fica sabendo');
    ok('se não conseguiu ler o mês, a janela não deixa salvar e avisa');
  }
  {
    // Trocou de mês com a janela aberta: não grava no mês errado
    const t = montar({ periodos: PERIODOS, currentPeriodId: 'pp_2026-08', currentPeriodData: null });
    await t.sb.openMetasMesModal();
    vm.runInContext("currentPeriodId = 'pp_2026-09';", t.sb);
    await t.sb.saveMetasMes();
    assert.strictEqual(t.gravados.length, 0, 'não grava em setembro o que foi aberto em agosto');
    assert.ok(t.toasts.some(x => x.t === 'error' && /abra/i.test(x.m)), 'pede para abrir de novo');
    ok('se o mês mudou com a janela aberta, não grava e pede para abrir de novo');
  }
  {
    // Período de outra unidade: não preenche com a config da unidade errada
    const t = montar({ periodos: PERIODOS, currentPeriodId: 'cp_2026-08', currentPeriodData: null });
    await t.sb.openMetasMesModal();
    assert.ok(t.els.mm_btnSalvar.disabled, 'período do CP com a unidade PP aberta: travado');
    assert.ok(t.toasts.some(x => x.t === 'error'));
    ok('período de outra unidade não abre para edição');
  }
  {
    // Os dois textos explicam a regra do bônus que vale NO MÊS aberto (homologação de 30/09/2026)
    const ago = montar({ periodos: PERIODOS, currentPeriodId: 'pp_2026-08', currentPeriodData: null });
    await ago.sb.openMetasMesModal();
    assert.ok(/sofre redução/.test(ago.els.mm_textoTravas.innerHTML), 'agosto: regra antiga');
    assert.ok(/Padrão da casa/.test(ago.els.mm_textoIndiv.innerHTML));
    const out = montar({ periodos: PERIODOS, currentPeriodId: 'pp_2026-10', currentPeriodData: null });
    await out.sb.openMetasMesModal();
    assert.ok(/metade/.test(out.els.mm_textoTravas.innerHTML) && /zera/.test(out.els.mm_textoTravas.innerHTML), 'outubro: 100/50/0');
    assert.ok(/jornada/.test(out.els.mm_textoIndiv.innerHTML) && /18/.test(out.els.mm_textoIndiv.innerHTML) && !/undefined/.test(out.els.mm_textoIndiv.innerHTML), out.els.mm_textoIndiv.innerHTML);
    assert.ok(!out.els.mm_btnSalvar.disabled, 'e a janela abre normalmente');
    ok('os textos da janela seguem a regra do mês: antiga em agosto, 100/50/0 e jornada em outubro');
  }

  console.log('\n' + n + '/' + n + ' casos passaram.');
})().catch(e => { console.error('\n✗ FALHOU:', e.message); process.exit(1); });
