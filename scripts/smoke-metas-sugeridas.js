'use strict';
// Roda: node scripts/smoke-metas-sugeridas.js
//
// Meta sugerida pelo sistema (parte B da spec 2026-09-29-renovacoes-metas-bonus-design.md §4,
// com as respostas do Rodrigo de 29/09). Chama o módulo puro com dados INVENTADOS.

const assert = require('assert');
const path = require('path');
const MS = require(path.join(__dirname, '..', 'metas-sugeridas.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

// série de meses FECHADOS: ativações, novos+retorno, renovações, vouchers
const S = (a, nr, r, v, completo = true) => ({ ativacoes: a, novosRetorno: nr, renovacoes: r, vouchers: v, completo });
const SERIE = {
  '2025-10': S(40, 20, 12, 4),
  '2026-03': S(69, 35, 18, 11), '2026-04': S(47, 22, 15, 9), '2026-05': S(69, 33, 20, 6),
  '2026-06': S(58, 28, 17, 5), '2026-07': S(40, 20, 11, 11), '2026-08': S(63, 33, 16, 14),
  '2026-09': S(65, 30, 20, 8),
};
const METAS = {
  '2026-07': { meta: 55, minNovos: 18, minRenov: 13, minVoucher: 6, minAtivacoesIndivP3: 10 },
  '2026-08': { meta: 50, minNovos: 18, minRenov: 13, minVoucher: 6, minAtivacoesIndivP3: 10 },
  '2026-09': { meta: 58, minNovos: 18, minRenov: 16, minVoucher: 10, minAtivacoesIndivP3: 10 },
};

/* 1. a fórmula do Rodrigo e a média de 6 meses */
{
  const r = MS.sugerir({ mes: '2026-10', serie: SERIE, metasAnteriores: METAS, renovacaoBase: 30, formula: 'rodrigo' });
  // 50% set (65) + 25% média jul–set (56) + 15% out/2025 (40), reescalado por 0,9
  const esperado = Math.round((0.5 * 65 + 0.25 * ((65 + 63 + 40) / 3) + 0.15 * 40) / 0.9);
  assert.strictEqual(r.campos.meta, esperado);
  assert.strictEqual(r.confiavel, true);
  assert.ok(/50% do mês anterior/.test(r.porque.meta) && /65/.test(r.porque.meta), r.porque.meta);
  const m6 = MS.sugerir({ mes: '2026-10', serie: SERIE, metasAnteriores: METAS, renovacaoBase: 30, formula: 'media6' });
  assert.strictEqual(m6.campos.meta, Math.round((47 + 69 + 58 + 40 + 63 + 65) / 6));
  ok('meta: fórmula do Rodrigo (50/25/15, reescalada) e a média de 6 meses, com o porquê');
}

/* 2. Super e Gold, e os mínimos do mês (um conjunto só, resposta 2 do Rodrigo) */
{
  const r = MS.sugerir({ mes: '2026-10', serie: SERIE, metasAnteriores: METAS, renovacaoBase: 30, formula: 'media6' });
  const meta = r.campos.meta;                                      // 57
  assert.strictEqual(r.campos.superMeta, Math.round(meta * 1.15));
  assert.strictEqual(r.campos.metaGold, Math.round(meta * 1.30));
  assert.strictEqual(r.campos.minNovos, Math.ceil(meta * 0.35), '35% da meta, arredondado para cima');
  assert.strictEqual(r.campos.minRenov, Math.ceil(30 * 0.65), '65% das renovações que vencem no mês');
  assert.ok(/65%/.test(r.porque.minRenov) && /30/.test(r.porque.minRenov));
  assert.strictEqual(r.campos.minAtivacoesIndivP3, 10, 'repete o último definido');
  ok('Super ×1,15 · Gold ×1,30 · novos 35% da meta · renovação 65% da base · corte individual repetido');
}

/* 3. voucher: média × fator da prática recente (a base de vouchers ainda não foi definida pelo Rodrigo) */
{
  const r = MS.sugerir({ mes: '2026-10', serie: SERIE, metasAnteriores: METAS, renovacaoBase: 30, formula: 'media6' });
  // últimos 3 meses com meta: jul, ago, set — fator = média(minVoucher ÷ média dos 6 anteriores)
  const med6 = mes => { const ms = Object.keys(SERIE).filter(m => m < mes).sort().slice(-6); return ms.reduce((s, m) => s + SERIE[m].vouchers, 0) / ms.length; };
  const fator = (6 / med6('2026-07') + 6 / med6('2026-08') + 10 / med6('2026-09')) / 3;
  assert.strictEqual(r.campos.minVoucher, Math.round(med6('2026-10') * fator));
  assert.ok(/média/.test(r.porque.minVoucher) && /fator/.test(r.porque.minVoucher), r.porque.minVoucher);
  ok('voucher pela média dos 6 meses × fator da prática recente da gestão');
}

/* 4. sem lista de renovações: renovação cai para a média × fator, e diz por quê */
{
  const r = MS.sugerir({ mes: '2026-10', serie: SERIE, metasAnteriores: METAS, renovacaoBase: null, formula: 'media6' });
  assert.ok(r.campos.minRenov > 0);
  assert.ok(/sem a lista de renovações/i.test(r.porque.minRenov), r.porque.minRenov);
  ok('sem a lista de renovações do mês, a trava de renovação usa a média × fator e avisa');
}

/* 5. mês parcial é pulado; fórmula do Rodrigo cai para a versão sem o ano anterior quando falta */
{
  const serie = { ...SERIE, '2026-09': S(19, 9, 5, 0, false) };      // setembro subido só até o dia 8
  const r = MS.sugerir({ mes: '2026-10', serie, metasAnteriores: METAS, renovacaoBase: 30, formula: 'media6' });
  assert.strictEqual(r.campos.meta, Math.round((69 + 47 + 69 + 58 + 40 + 63) / 6), 'setembro parcial fora; a janela busca março');
  assert.deepStrictEqual(r.base.parciaisIgnorados, ['2026-09']);
  const semAno = { ...SERIE }; delete semAno['2025-10'];
  const r2 = MS.sugerir({ mes: '2026-10', serie: semAno, metasAnteriores: METAS, renovacaoBase: 30, formula: 'rodrigo' });
  assert.strictEqual(r2.campos.meta, Math.round((0.5 * 65 + 0.25 * ((65 + 63 + 40) / 3)) / 0.75));
  assert.ok(/sem o mesmo mês do ano anterior/.test(r2.porque.meta), r2.porque.meta);
  ok('mês parcial pulado e dito; sem o mesmo mês do ano anterior, a fórmula reescala sem ele');
}

/* 6. histórico curto e limites */
{
  const curta = { '2026-08': S(63, 33, 16, 14), '2026-09': S(65, 30, 20, 8) };
  const r = MS.sugerir({ mes: '2026-10', serie: curta, metasAnteriores: {}, renovacaoBase: 30, formula: 'rodrigo' });
  assert.strictEqual(r.confiavel, false, 'menos de 3 meses: não propõe');
  assert.strictEqual(r.campos, null);
  const r2 = MS.sugerir({ mes: '2026-10', serie: SERIE, metasAnteriores: METAS, renovacaoBase: 3, formula: 'media6' });
  assert.ok(r2.campos.minRenov <= 3, 'a trava nunca passa da base');
  const r3 = MS.sugerir({ mes: '2026-10', serie: SERIE, metasAnteriores: METAS, renovacaoBase: 0, formula: 'media6' });
  assert.strictEqual(r3.campos.minRenov, 0);
  ok('menos de 3 meses completos não propõe; trava de renovação nunca maior que a base');
}

/* 7. ativação fracionária e mês corrente */
{
  const serie = { ...SERIE, '2026-04': S(47.3, 22, 15, 9) };
  const r = MS.sugerir({ mes: '2026-10', serie, metasAnteriores: METAS, renovacaoBase: 30, formula: 'media6' });
  assert.ok(Number.isInteger(r.campos.meta));
  const r2 = MS.sugerir({ mes: '2026-09', serie: SERIE, metasAnteriores: METAS, renovacaoBase: 30, formula: 'media6' });
  assert.ok(!r2.base.meses.includes('2026-09'), 'o próprio mês nunca entra na conta');
  ok('decimal não quebra; o mês proposto nunca entra na própria conta');
}

/* 8. mês completo: o dado tem que chegar ao fim do mês (tolerância de 2 dias para fim de semana) */
{
  assert.strictEqual(MS.mesCompleto('2026-08', '2026-08-31'), true);
  assert.strictEqual(MS.mesCompleto('2026-08', '2026-08-29'), true, 'sábado 29 com domingo 30 e segunda 31 sem venda');
  assert.strictEqual(MS.mesCompleto('2026-09', '2026-09-08'), false, 'setembro subido até o dia 8');
  assert.strictEqual(MS.mesCompleto('2026-02', '2026-02-27'), true);
  assert.strictEqual(MS.mesCompleto('2026-09', null), false);
  assert.strictEqual(MS.maiorData(['05/09/2026', '28/09/2026', 'x', '', null]), '2026-09-28');
  ok('mês completo quando o maior dia dos dados chega a 2 dias do fim');
}

console.log('\n✅ smoke-metas-sugeridas: ' + n);
