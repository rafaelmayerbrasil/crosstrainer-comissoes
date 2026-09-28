'use strict';
// Roda: node scripts/smoke-simulador.js
//
// ══════════════════════════════════════════════════════════════════════
// O SIMULADOR "E SE..." DA VENDEDORA TEM QUE BATER COM O MOTOR
// ══════════════════════════════════════════════════════════════════════
//
// Achado em 28/09/2026, medido com os dados de produção. Dois defeitos:
//
// 1. META ERRADA. O simulador lia as metas de `window.currentPeriodData`, que
//    só existe na tela da GESTÃO. Na tela da vendedora caía no padrão da
//    unidade (50/57/65) em vez da meta do mês (ago/PP 35/41/49). Achando que a
//    unidade não batia a meta, "tirava" o P3 que ela já tinha: a Kali via
//    "+3 recorrentes = − R$ 346,64" quando o certo era + R$ 145,02.
//
// 2. P3 INTEIRO EM VEZ DA PARTE DELA. O P3 é um bolo da unidade, repartido
//    pelo caixa entre quem passou do corte individual. O simulador calculava o
//    bolo inteiro, e ainda com o caixa só dela no lugar do da unidade. A
//    Francini via "+3 recorrentes = + R$ 887,24" contra + R$ 235,09 de verdade.
//
// Agora a conta mora no motor (`agregadosP3` + `simularVendas`) e este teste
// compara, caso a caso, com o recálculo COMPLETO do motor com as vendas novas
// acrescentadas aos lançamentos. Também roda o `calcSimulator` do index.html
// com a cópia da gestão apontando para OUTRO mês, que era o defeito 1.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const CE = require(path.join(raiz, 'commission.js'));
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);

const PLANO = {
  ANUAL_LOCAL: { caixa: 3108, texto: 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO', bonus: 'bonusAnualLocal' },
  RECORRENTE: { caixa: 419, texto: 'ACESSO LIVRE | RECORRENTE | FLEX | ILIMITADO | PADRÃO', bonus: 'bonusRecorrente' },
};

// Lançamento já processado, como o motor grava
function item(vendedor, caixa, cfg, { ativ = 1, cat = 'novo', texto = 'HIIT/MAROMBINHA | MENSAL | LOCAL' } = {}) {
  const it = { vendedor, cliente: 'X', data: '10/08/2026', item: texto, category: cat, valorCaixa: caixa * ativ,
    isEligibleP3: true, isNaoCom: false, splitAtivacao: ativ, tipoVenda: 'Novo Contrato', origem: 'Balcão' };
  CE.applyCommissionsToItem(it, cfg);
  return it;
}

// O que o motor faz de verdade com uma lista de lançamentos
function motor(items, cfg) {
  const vd = CE.buildVendorData(items, {}, cfg);
  const conta = k => items.reduce((s, d) => s + (k(d) ? (d.splitAtivacao || 1) : 0), 0);
  const totais = {
    unitAtivacoes: CE.contagemDaUnidade(conta(d => d.isActivation)),
    unitNovosRetorno: CE.contagemDaUnidade(conta(d => d.category === 'novo' || d.category === 'retorno')),
    unitRenovacoes: CE.contagemDaUnidade(conta(d => d.category === 'renovacao')),
    unitVouchers: CE.contagemDaUnidade(conta(d => d.category === 'voucher')),
  };
  CE.applyP3Pool(vd, totais.unitAtivacoes, totais.unitNovosRetorno, totais.unitRenovacoes, totais.unitVouchers, cfg);
  // Mesmo formato do vendorSummary gravado pelo recalculatePeriod
  const resumo = {};
  Object.entries(vd).forEach(([nome, v]) => {
    resumo[nome] = { p1: v.p1total, p2: v.p2total, p3: v.p3, grandTotal: v.p1total + v.p2total + v.p3,
      ativacoes: v.ativacoes, caixa: v.caixaTotal, p3base: v.caixaP3Eligible || 0, isNaoCom: v.isNaoCom };
  });
  return { resumo, totais };
}

// Compara simulador × motor para "quem fecha mais qt vendas do plano"
function compara(items, cfg, quem, tipo, qt) {
  const antes = motor(items, cfg);
  const novos = [];
  for (let i = 0; i < qt; i++) novos.push(item(quem, PLANO[tipo].caixa, cfg, { texto: PLANO[tipo].texto }));
  const depois = motor(items.concat(novos), cfg);
  const real = depois.resumo[quem].grandTotal - antes.resumo[quem].grandTotal;

  const sim = CE.simularVendas({
    minhas: antes.resumo[quem], totais: antes.totais,
    agregados: CE.agregadosP3(antes.resumo, quem, cfg),
    qt, valorCaixa: PLANO[tipo].caixa, bonusP2: cfg[PLANO[tipo].bonus], config: cfg,
  });
  return { real, sim };
}

const CFG_PP_AGO = { ...CE.defaultConfig, meta: 35, superMeta: 41, metaGold: 49, metaFixo: 300, superFixo: 600,
  goldFixo: 900, minNovos: 15, minRenov: 0, minVoucher: 0, minAtivacoesIndivP3: 7 };

// Unidade com duas vendedoras que dividem o P3 (como o Campeche)
function duasVendedoras(qtA, qtB, cfg) {
  const out = [];
  for (let i = 0; i < qtA; i++) out.push(item('ANA', 300, cfg));
  for (let i = 0; i < qtB; i++) out.push(item('BIA', 300, cfg));
  return out;
}

{
  // Duas vendedoras dividindo o bolo: o simulador dá a PARTE dela
  const items = duasVendedoras(20, 18, CFG_PP_AGO);
  for (const [tipo, qt] of [['RECORRENTE', 3], ['ANUAL_LOCAL', 5]]) {
    const { real, sim } = compara(items, CFG_PP_AGO, 'ANA', tipo, qt);
    assert.ok(Math.abs(sim.total - real) < 0.05, `${tipo}×${qt}: simulador ${sim.total.toFixed(2)} × motor ${real.toFixed(2)}`);
  }
  ok('duas vendedoras dividindo o P3: o simulador bate com o motor (parte dela, não o bolo inteiro)');
}
{
  // Cruzar a faixa: 40 ativações, Super Meta em 41 — uma venda a mais muda o bolo
  const items = duasVendedoras(22, 18, CFG_PP_AGO);
  const { real, sim } = compara(items, CFG_PP_AGO, 'ANA', 'RECORRENTE', 1);
  assert.ok(Math.abs(sim.total - real) < 0.05, `simulador ${sim.total.toFixed(2)} × motor ${real.toFixed(2)}`);
  assert.ok(sim.dP3 > 100, 'passar para a Super Meta tem que aparecer no P3: ' + sim.dP3.toFixed(2));
  ok('cruzando da Meta para a Super Meta: o salto do P3 aparece e bate com o motor (+R$ ' + sim.dP3.toFixed(2) + ' de P3)');
}
{
  // Cruzar o corte individual: quem tem 6 com corte 7 passa a entrar na divisão
  const items = duasVendedoras(6, 34, CFG_PP_AGO);
  const { real, sim } = compara(items, CFG_PP_AGO, 'ANA', 'RECORRENTE', 1);
  assert.ok(Math.abs(sim.total - real) < 0.05, `simulador ${sim.total.toFixed(2)} × motor ${real.toFixed(2)}`);
  assert.ok(sim.dP3 > 0, 'entrar no corte tem que render P3');
  ok('cruzando o corte individual (6 → 7): ela passa a entrar no P3 e o simulador acompanha');
}
{
  // Venda dividida no mês (fração de ativação) não atrapalha a conta
  const items = duasVendedoras(20, 20, CFG_PP_AGO);
  items.push(item('ANA', 300, CFG_PP_AGO, { ativ: 0.7 }), item('BIA', 300, CFG_PP_AGO, { ativ: 0.30000000000000004 }));
  const { real, sim } = compara(items, CFG_PP_AGO, 'BIA', 'ANUAL_LOCAL', 2);
  assert.ok(Math.abs(sim.total - real) < 0.05, `simulador ${sim.total.toFixed(2)} × motor ${real.toFixed(2)}`);
  ok('mês com venda dividida (0,7 / 0,3): o simulador segue batendo com o motor');
}
{
  // Não-comissionável (Rodrigo, Benny) não entra na base do P3
  const items = duasVendedoras(20, 18, CFG_PP_AGO);
  const cfg = { ...CFG_PP_AGO, naoComissionaveis: ['RODRIGO'] };
  for (let i = 0; i < 5; i++) items.push(item('RODRIGO', 500, cfg));
  items.forEach(it => { it.isNaoCom = it.vendedor === 'RODRIGO'; });
  const { real, sim } = compara(items, cfg, 'ANA', 'RECORRENTE', 3);
  assert.ok(Math.abs(sim.total - real) < 0.05, `simulador ${sim.total.toFixed(2)} × motor ${real.toFixed(2)}`);
  ok('não-comissionável fica fora da base do P3, como no motor');
}
{
  // Vender mais nunca pode aparecer como perda
  const items = duasVendedoras(21, 20, CFG_PP_AGO);
  for (const qt of [1, 2, 3, 5, 10]) {
    const { sim } = compara(items, CFG_PP_AGO, 'ANA', 'RECORRENTE', qt);
    assert.ok(sim.total > 0 && sim.dP3 >= 0, `+${qt}: ${sim.total.toFixed(2)} (P3 ${sim.dP3.toFixed(2)})`);
  }
  ok('vender mais nunca aparece como perda (o "− R$ 346,64" da Kali)');
}
{
  // Os agregados não carregam nome nem valor de colega
  const { resumo } = motor(duasVendedoras(20, 18, CFG_PP_AGO), CFG_PP_AGO);
  const ag = CE.agregadosP3(resumo, 'ANA', CFG_PP_AGO);
  assert.deepStrictEqual(Object.keys(ag).sort(), ['baseOutrasElegiveis', 'baseUnidade']);
  assert.ok(!JSON.stringify(ag).includes('BIA'));
  ok('os totais que a tela guarda são só somas da unidade — nenhum nome de colega');
}

// ════════════════════════════════════════════════════════════════════
// A TELA: calcSimulator usa as metas do mês que a VENDEDORA está vendo
// ════════════════════════════════════════════════════════════════════
function extrair(nome) {
  const ini = html.indexOf('function ' + nome + '(');
  assert.ok(ini > 0, 'função ' + nome + ' não existe no index.html');
  let nivel = 0;
  for (let j = html.indexOf('{', ini); j < html.length; j++) {
    if (html[j] === '{') nivel++;
    else if (html[j] === '}') { nivel--; if (!nivel) return html.slice(ini, j + 1); }
  }
  throw new Error('não achei o fim de ' + nome);
}
{
  const items = duasVendedoras(20, 18, CFG_PP_AGO);
  const { resumo, totais } = motor(items, CFG_PP_AGO);
  const { real } = compara(items, CFG_PP_AGO, 'ANA', 'RECORRENTE', 3);

  const els = { simQt: { value: '3' }, simTipo: { value: 'RECORRENTE' }, simResult: { innerHTML: '' } };
  const sb = {
    console, CommissionEngine: CE, Math, Number, parseInt,
    fmt: v => Number(v).toFixed(2).replace('.', ','),
    document: { getElementById: id => els[id] || null },
    // A cópia da GESTÃO aponta para outro mês (sem metas) — era de onde o simulador lia
    window: {
      currentPeriodData: { metasMensais: null },
      currentVendorSummary: { ANA: resumo.ANA },
      currentVendorMyName: 'ANA',
      currentUnitTotals: totais,
      currentVendorCfg: CFG_PP_AGO,
      currentSimAgregados: CE.agregadosP3(resumo, 'ANA', CFG_PP_AGO),
    },
    unitConfig: { meta: 50, superMeta: 57, metaGold: 65 }, // padrão da unidade: o que NÃO pode valer
  };
  vm.createContext(sb);
  vm.runInContext(extrair('updateSimulatorUI') + '\n' + extrair('calcSimulator'), sb);
  sb.updateSimulatorUI();
  const esperado = real.toFixed(2).replace('.', ',');
  assert.ok(els.simResult.innerHTML.includes(esperado),
    'a tela mostra o aumento certo (R$ ' + esperado + '); mostrou: ' + els.simResult.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200));
  ok('a tela usa as metas do mês da vendedora, não a cópia da gestão: mostra + R$ ' + esperado);
}
{
  // Quem abre o painel da vendedora grava as metas do mês e os agregados para o simulador
  const carregar = extrair('loadVendorPeriod');
  assert.ok(/window\.currentVendorCfg\s*=\s*cfg/.test(carregar), 'o painel guarda as metas do mês que abriu');
  assert.ok(/window\.currentSimAgregados\s*=\s*CommissionEngine\.agregadosP3\(/.test(carregar), 'e os agregados do P3');
  // Olha o USO no código (o comentário que explica o defeito cita o nome antigo)
  assert.ok(!/currentPeriodData\s*&&|currentPeriodData\.metasMensais/.test(extrair('calcSimulator')),
    'o simulador não lê mais a cópia da gestão');
  ok('o painel da vendedora entrega ao simulador as metas e os totais do mês que ela abriu');
}

console.log('\n' + n + '/' + n + ' casos passaram.');
