'use strict';
// Roda: node scripts/smoke-p3-ativacao-fracionada.js
//
// ══════════════════════════════════════════════════════════════════════
// A DIVISÃO NÃO PODE DERRUBAR A FAIXA DO P3 POR CAUSA DE CENTAVO DE CONTA
// ══════════════════════════════════════════════════════════════════════
//
// Achado em 28/09/2026, agosto do Príncipe. A unidade fez 41 ativações —
// exatamente a Super Meta (R$ 600 fixo). A gestão lançou duas divisões
// (Freiberger 50/50 e Jessica Dalla Lana 70/30) e a soma das frações deu
// 40,99999999999999 em ponto flutuante. `40,99999999999999 >= 41` é falso:
// a unidade caiu para a Meta (R$ 300) e o bolo do P3 encolheu R$ 300 — a Kali
// foi de R$ 1.288,62 para R$ 1.100,75 e a Bárbara de R$ 721,11 para
// R$ 608,98, SEM ERRO NENHUM NA TELA. A divisão só devia passar dinheiro de
// uma para a outra (a soma das duas é a mesma).
//
// O mesmo vale para o corte individual (`minAtivacoesIndivP3`): quem chega a
// 7 somando frações não pode ficar com 6,999… e perder o P3 inteiro.
//
// A regra da divisão (tela Regras, desde a v1, 09/03/2026): cada vendedora
// conta a PROPORÇÃO da ativação (0,7 / 0,3) e a venda conta UMA vez na
// unidade. Logo: na UNIDADE a contagem é sempre inteira (41, nunca 40,99 nem
// 40,1); por vendedora é fração, arredondada a 2 casas antes do corte.

const assert = require('assert');
const path = require('path');
const CE = require(path.join(__dirname, '..', 'commission.js'));

let n = 0;
const ok = (msg) => { n++; console.log('  ✓ ' + msg); };

// As 44 ativações de agosto/PP na ordem em que o banco as devolve, com as
// frações nas posições reais (Ana Tinti 0,7/0,3 · Jessica 0,7/0,3 ·
// Freiberger 0,5/0,5). O 0,30000000000000004 é o que está gravado (1 − 0,7).
function ativacoesAgostoPP() {
  const seq = new Array(44).fill(1);
  [[0, 0.7], [16, 0.7], [33, 0.3], [39, 0.5], [42, 0.5], [43, 0.30000000000000004]]
    .forEach(([i, v]) => { seq[i] = v; });
  return seq;
}

// Metas do mês de agosto/PP em produção (`metasMensais`)
const CFG_PP_AGO = {
  meta: 35, superMeta: 41, metaGold: 49, metaFixo: 300, superFixo: 600, goldFixo: 900,
  minNovos: 15, minRenov: 9, minVoucher: 4, minAtivacoesIndivP3: 7,
};
const cfg = { ...CE.defaultConfig, ...CFG_PP_AGO };

function item(vendedor, ativ, caixa) {
  return {
    vendedor, cliente: 'X', data: '10/08/2026', item: 'PLANO', category: 'novo',
    isActivation: true, isEligibleP3: true, isNaoCom: false,
    valorCaixa: caixa, p1valor: 0, p2bonus: 0, splitAtivacao: ativ,
  };
}

{
  // Pré-condição: a soma crua realmente escorrega para baixo de 41
  const soma = ativacoesAgostoPP().reduce((s, x) => s + x, 0);
  assert.ok(soma < 41 && soma > 40.99, 'a sequência reproduz o ponto flutuante de produção: ' + soma);
  ok('as 44 ativações de agosto/PP somam ' + soma + ' (não 41)');
}
{
  // calcP3 recebendo a contagem quebrada tem que continuar na Super Meta
  const r = CE.calcP3(40.99999999999999, 22, 15, 4, 14228.42, cfg);
  assert.strictEqual(r.tier, 'super', 'faixa esperada super, veio ' + r.tier);
  assert.strictEqual(r.fixo, 600);
  ok('calcP3: 40,99999999999999 ativações contam como 41 → Super Meta (R$ 600)');
}
{
  // Novos/retorno é trava de ouro; renovações e vouchers são travas macias
  const r = CE.calcP3(41, 14.999999999999998, 15, 4, 10000, cfg);
  assert.ok(r.goldRules.novosOk, 'novos/retorno 14,999… deve contar como 15');
  const r2 = CE.calcP3(41, 22, 8.999999999999998, 3.9999999999999996, 10000, cfg);
  assert.ok(r2.softLocks.renovOk && r2.softLocks.voucherOk, 'renovações e vouchers idem');
  ok('as travas (novos, renovações, vouchers) também não escorregam por centavo de conta');
}
{
  // Corte individual: 1+1+1+1+0,1+0,1+0,8+1+1 dá 6,999999999999999
  const itens = [1, 1, 1, 1, 0.1, 0.1, 0.8, 1, 1].map(f => item('ANA', f, 100));
  for (let i = 0; i < 40; i++) itens.push(item('BIA', 1, 100));
  const vd = CE.buildVendorData(itens, {}, cfg);
  assert.ok(vd.ANA.ativacoes < 7, 'pré-condição: a soma crua escorrega (' + vd.ANA.ativacoes + ')');
  CE.applyP3Pool(vd, 47, 47, 15, 4, cfg);
  assert.ok(vd.ANA.p3 > 0, 'ANA com 7 ativações (somadas de frações) deve entrar no P3');
  ok('corte individual: 6,999… ativações contam como 7 e entram na divisão do P3');
}
{
  // O bolo inteiro: com a contagem de agosto/PP, é o da Super Meta
  const base = ativacoesAgostoPP().map((f, i) => item(i % 2 ? 'KALI' : 'BARBARA', f, 200));
  const vd = CE.buildVendorData(base, {}, cfg);
  const unit = base.reduce((s, d) => s + d.splitAtivacao, 0);
  assert.ok(unit < 41, 'pré-condição: a contagem crua é ' + unit);
  CE.applyP3Pool(vd, unit, 22, 15, 4, cfg);
  const bolo = Object.values(vd).reduce((s, v) => s + v.p3, 0);
  assert.ok(bolo >= 600, 'o bolo tem que ser da Super Meta (≥ R$ 600), veio R$ ' + bolo.toFixed(2));
  ok('applyP3Pool com a contagem de agosto/PP reparte o bolo da Super Meta: R$ ' + bolo.toFixed(2));
}
{
  // Na unidade a contagem é inteira, em qualquer caminho que a produza
  assert.strictEqual(CE.contagemDaUnidade(40.99999999999999), 41);
  assert.strictEqual(CE.contagemDaUnidade(58.00000000000001), 58);
  const base = ativacoesAgostoPP().map(f => item('KALI', f, 100));
  const r = CE.calcP3(base.reduce((s, d) => s + d.splitAtivacao, 0), 22, 15, 4, 0, cfg);
  assert.strictEqual(r.tier, 'super');
  ok('a unidade conta ativação inteira: 40,99999999999999 → 41, 58,00000000000001 → 58');
}
{
  // Por vendedora a regra continua a da tela Regras: a proporção da ativação
  const itens = [item('KALI', 0.7, 70), item('BABI', 0.30000000000000004, 30)];
  const vd = CE.buildVendorData(itens, {}, cfg);
  assert.strictEqual(CE.arredondaContagem(vd.KALI.ativacoes), 0.7);
  assert.strictEqual(CE.arredondaContagem(vd.BABI.ativacoes), 0.3);
  ok('por vendedora a divisão 70/30 continua dando 0,7 e 0,3 de ativação (regra da tela Regras)');
}

console.log('\n' + n + '/' + n + ' casos passaram.');
