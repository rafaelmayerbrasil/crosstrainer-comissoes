'use strict';
// Roda: node scripts/smoke-fim-do-diferimento.js
//
// ══════════════════════════════════════════════════════════════════════
// O DIFERIMENTO ACABOU EM AGOSTO/2026
// ══════════════════════════════════════════════════════════════════════
//
// A regra dos 30 dias (plano começa muito depois do pagamento → comissão vai
// para o mês do início) nasceu quando a comissão era do mês da VENDA. Sob
// regime de CAIXA ela contradiz o que está valendo: a comissão é do mês em que
// o dinheiro entrou, paga no dia 15 do mês seguinte.
//
// E não era só incoerência. A comissão diferida saía do mês do pagamento e
// NUNCA era somada em mês nenhum: em produção, 91 registros únicos desde
// janeiro/2025, todos com `status: 'pendente'`, R$ 6.318,17 que sumiram.
//
// ⚠️ O CORTE PRESERVA O PASSADO DE PROPÓSITO. Pagamento anterior a 2026-08
//    continua diferindo — são 20 meses de folhas já pagas, e re-subir um
//    arquivo antigo não pode reescrever o que a academia pagou.
//
// Desenho: docs/superpowers/specs/2026-09-09-fim-do-diferimento-design.md

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const CE = require(path.join(__dirname, '..', 'commission.js'));
const PA = require(path.join(__dirname, '..', 'pacto-adapter.js'));
const { readXlsx } = require(path.join(__dirname, 'lib-xlsx-min.js'));

let n = 0;
const ok = m => { n++; console.log('  ✔ ' + m); };

/** Uma venda de ativação com plano começando `diasDepois` do pagamento. */
function venda(dataPgto, diasDepois, extra) {
  const [d, m, a] = dataPgto.split('/').map(Number);
  const inicio = new Date(a, m - 1, d + diasDepois);
  const fim = new Date(a + 1, m - 1, d + diasDepois);
  const br = x => String(x.getDate()).padStart(2, '0') + '/'
    + String(x.getMonth() + 1).padStart(2, '0') + '/' + x.getFullYear();
  return {
    'Código': 'C1000', 'Cliente': 'FULANO DE TAL', 'Data': dataPgto,
    'Itens': `HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO (${br(inicio)} - ${br(fim)})`,
    'Valor Venda': 2388, 'Desconto Venda': 0, 'Desconto Recebimento': 0,
    'Valor Final': 2388, 'Valor Quitado/Recibo': 2388,
    'Origem': 'Balcão', 'Tipo de Venda': 'Renovação', 'Vendedor': 'KALI DUTRA',
    ...extra,
  };
}
const roda = v => CE.calculate([v], { ...CE.defaultConfig }, {});

console.log('\n=== 1. O corte por mês do PAGAMENTO ===\n');

// 1. antes do corte: continua diferindo — folha já paga não se reescreve
{
  const r = roda(venda('09/07/2026', 60));
  assert.strictEqual(r.deferred.length, 1,
    'pagamento de JULHO/2026 tem que continuar diferindo — o mês já foi pago com essa regra');
  assert.strictEqual(r.processed.length, 0);
  ok('pagamento antes de 2026-08 ainda difere (o passado fica como está)');
}

// 2. a partir do corte: nunca mais difere
{
  const r = roda(venda('17/08/2026', 60));
  assert.strictEqual(r.deferred.length, 0,
    'pagamento de AGOSTO/2026 não pode mais diferir — a comissão é do mês em que o dinheiro entrou');
  assert.strictEqual(r.processed.length, 1);
  ok('pagamento em 2026-08 não difere mais');
}

// 3. e nem no limite: o primeiro dia do mês do corte já vale
{
  assert.strictEqual(roda(venda('01/08/2026', 90)).deferred.length, 0, '01/08/2026 é depois do corte');
  assert.strictEqual(roda(venda('31/07/2026', 90)).deferred.length, 1, '31/07/2026 ainda é antes');
  ok('a virada é entre 31/07/2026 e 01/08/2026');
}

// 4. depois do corte também: setembro, outubro, o ano que vem
{
  ['05/09/2026', '20/12/2026', '10/03/2027'].forEach(d => {
    assert.strictEqual(roda(venda(d, 120)).deferred.length, 0, d + ' não pode diferir');
  });
  ok('nenhum pagamento posterior ao corte difere');
}

// 5. venda que já não diferia continua não diferindo (nada mudou para ela)
{
  const r = roda(venda('17/08/2026', 5));
  assert.strictEqual(r.deferred.length, 0);
  assert.strictEqual(r.processed.length, 1);
  ok('plano que começa logo segue entrando normalmente');
}

console.log('\n=== 2. O caso real que motivou a conversa ===\n');

// 6. MARCELO ALVES DE PAULA: pagou 17/08/2026, plano começa 21/08/2027.
//    A Francini receberia em AGOSTO DE 2027 por dinheiro que entrou agora.
{
  const marcelo = {
    'Código': 'C4640-2', 'Cliente': 'MARCELO ALVES DE PAULA', 'Data': '17/08/2026',
    'Itens': 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO | PP. - 12 (21/08/2027 - 14/08/2028)',
    'Valor Venda': 159.17, 'Desconto Venda': 0, 'Desconto Recebimento': 0,
    'Valor Final': 159.17, 'Valor Quitado/Recibo': 159.17,
    'Origem': 'Balcão', 'Tipo de Venda': 'Renovação', 'Vendedor': 'FRANCINI DAS CHAGAS',
  };
  const r = roda(marcelo);
  assert.strictEqual(r.deferred.length, 0, 'o Marcelo não pode mais ser adiado para 2027');
  assert.strictEqual(r.processed.length, 1);
  assert.ok(r.processed[0].totalP1P2 > 0, 'e tem que gerar comissão de verdade');
  ok('o Marcelo (pago 17/08/2026, plano começa 21/08/2027) paga comissão agora');
}

console.log('\n=== 3. Contra os arquivos reais da Pacto ===\n');

const ler = f => {
  const wb = readXlsx(path.join(__dirname, '..', 'relatorios pacto', f));
  const aba = wb.sheet(wb.sheetNames[0]);
  return Object.keys(aba).map(Number).sort((a, b) => a - b).map(k => aba[k]);
};
const puro = v => { const o = {}; PA.CABECALHO_SAIDA.forEach(h => o[h] = v[h]); return o; };
function unidade(arquivo, mes, sigla) {
  const t = PA.traduzir(ler(arquivo), { mes });
  return CE.calculate((t.porUnidade[sigla] || []).map(puro), { ...CE.defaultConfig }, {});
}

// 7. agosto/2026, Príncipe: as 3 diferidas voltam para a folha
{
  const r = unidade('faturamento-recebido_6d85c17be56a3354e9142649a1c0a830_20260901_213346.xls', '2026-08', 'PP');
  assert.strictEqual(r.deferred.length, 0, 'agosto não pode ter diferida nenhuma');
  assert.strictEqual(r.unitTotals.unitAtivacoes, 44,
    'o Príncipe passa de 41 para 44 ativações — e isso entra na régua da meta');
  assert.strictEqual(Number(r.unitTotals.unitCaixa.toFixed(2)), 17142.20,
    'e o caixa sobe R$ 3.508,17, que estava fora da conta da unidade');
  ok('Príncipe/agosto: 44 ativações e caixa R$ 17.142,20, sem nenhuma diferida');
}

// 8. o Campeche de agosto não muda — não tinha diferida nenhuma
{
  const r = unidade('faturamento-recebido_6d85c17be56a3354e9142649a1c0a830_20260901_213346.xls', '2026-08', 'CP');
  assert.strictEqual(r.deferred.length, 0);
  assert.strictEqual(r.unitTotals.unitAtivacoes, 65, 'o Campeche fica igual');
  ok('Campeche/agosto segue com 65 ativações — nada a mudar lá');
}

// 9. setembro: zero diferidas nos dois lados
{
  ['CP', 'PP'].forEach(u => {
    const r = unidade('faturamento-recebido_01 a 080926.xls', '2026-09', u);
    assert.strictEqual(r.deferred.length, 0, u + ' de setembro não pode diferir nada');
  });
  ok('setembro (01–08/09) não gera diferida nenhuma');
}

console.log('\n=== 4. A tela ===\n');

// 10. nenhum botão leva mais às abas de diferidos, nos DOIS perfis
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(!/switchDashTab\('tabDiferidos'/.test(html),
    'a gestão não pode ter mais o botão da aba Diferidos');
  assert.ok(!/switchVendorTab\('vtabDiferidos'/.test(html),
    'a vendedora não pode ter mais o botão da aba Diferidos');
  assert.ok(!/Regra dos 30 dias/.test(html),
    'o texto "Regra dos 30 dias" tem que sair da tela — a regra não vale mais');
  ok('nenhum caminho na tela leva às abas de diferidos');
}

// 11. a constante existe e está documentada no motor
{
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'commission.js'), 'utf8');
  assert.ok(/FIM_DO_DIFERIMENTO/.test(fonte), 'o corte tem que ter nome, não ser um literal solto');
  assert.strictEqual(CE.FIM_DO_DIFERIMENTO, '2026-08');
  ok('o corte é uma constante nomeada no commission.js');
}

console.log('\n' + n + '/' + n + ' ✅\n');
