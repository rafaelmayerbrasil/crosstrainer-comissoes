'use strict';
// Roda: node scripts/smoke-regra-minimos.js
//
// Regra nova do bônus da unidade (P3), da comissão de OUTUBRO/2026 em diante
// (spec 2026-09-29-renovacoes-metas-bonus-design.md §5, respostas do Rodrigo):
// bateu a faixa + os 3 mínimos → 100% · falhou 1 → 50% · falhou 2 ou 3 → zera.
// Até setembro vale a regra antiga (novos zera, renovação ×0,70, voucher ×0,85)
// — recalcular um mês passado NUNCA muda o valor. Dados INVENTADOS.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const CE = require(path.join(raiz, 'commission.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

const BASE = { meta: 50, superMeta: 57, metaGold: 65, minNovos: 18, minRenov: 16, minVoucher: 5,
  metaFixo: 300, superFixo: 600, goldFixo: 900, metaPct: 0.5, tetoMeta: 700, tetoSuper: 1000, tetoGold: 1300 };
const CAIXA = 20000;          // 0,5% → R$ 100 sobre o caixa
// ativações 58 = Super: fixo 600 + 100 = 700
const p3 = (mes, novos, renov, vouch, ativ = 58) => CE.calcP3(ativ, novos, renov, vouch, CAIXA, { ...BASE, mes }).final;

/* 1. a data do corte é fixa no código */
{
  assert.strictEqual(CE.INICIO_REGRA_MINIMOS, '2026-10');
  assert.strictEqual(CE.regraNovaDosMinimos({ mes: '2026-10' }), true);
  assert.strictEqual(CE.regraNovaDosMinimos({ mes: '2026-09' }), false);
  assert.strictEqual(CE.regraNovaDosMinimos({}), false, 'sem mês: regra antiga');
  ok('a regra nova começa em 2026-10, e sem mês vale a antiga');
}

/* 2. até setembro: exatamente a regra de hoje */
{
  for (const mes of ['2026-09', undefined]) {
    assert.strictEqual(p3(mes, 20, 16, 5), 700, 'tudo ok');
    assert.strictEqual(p3(mes, 17, 16, 5), 0, 'novos abaixo: zera');
    assert.strictEqual(p3(mes, 20, 15, 5), 490, 'renovação abaixo: ×0,70');
    assert.strictEqual(p3(mes, 20, 16, 4), 595, 'voucher abaixo: ×0,85');
    assert.strictEqual(p3(mes, 20, 15, 4), 416.5, 'os dois: ×0,70×0,85');
    assert.strictEqual(p3(mes, 20, 16, 5, 49), 0, 'abaixo da meta');
  }
  ok('setembro e sem mês: novos zera, renovação ×0,70, voucher ×0,85 — como sempre foi');
}

/* 3. de outubro em diante: 100 / 50 / 0 */
{
  assert.strictEqual(p3('2026-10', 20, 16, 5), 700, 'os 3 mínimos: 100%');
  assert.strictEqual(p3('2026-10', 17, 16, 5), 350, 'só novos abaixo: 50% (antes zerava)');
  assert.strictEqual(p3('2026-10', 20, 15, 5), 350, 'só renovação abaixo: 50%');
  assert.strictEqual(p3('2026-10', 20, 16, 4), 350, 'só voucher abaixo: 50%');
  assert.strictEqual(p3('2026-10', 20, 15, 4), 0, 'dois abaixo: zera');
  assert.strictEqual(p3('2026-10', 17, 15, 4), 0, 'três abaixo: zera');
  assert.strictEqual(p3('2026-10', 20, 16, 5, 49), 0, 'abaixo da meta: sem bônus');
  assert.strictEqual(p3('2026-11', 20, 16, 5, 70), 1000, 'Gold: 900 + 100');
  const r = CE.calcP3(58, 17, 16, 5, CAIXA, { ...BASE, mes: '2026-10' });
  assert.strictEqual(r.multiplier, 0.5);
  assert.strictEqual(r.regra, 'minimos');
  assert.ok(r.motivos.some(m => /Novos \+ retorno 17\/18/.test(m) && /metade/.test(m)), JSON.stringify(r.motivos));
  const r2 = CE.calcP3(58, 17, 15, 5, CAIXA, { ...BASE, mes: '2026-10' });
  assert.ok(r2.motivos.some(m => /zera/.test(m)), JSON.stringify(r2.motivos));
  assert.strictEqual(CE.calcP3(58, 17, 16, 5, CAIXA, { ...BASE, mes: '2026-09' }).regra, 'antiga');
  ok('outubro: 3 mínimos 100%, 1 falha 50% (inclusive novos), 2 ou 3 zera; motivos explicam');
}

/* 4. mínimo individual por pessoa (só de outubro em diante) */
{
  const cfgOut = { ...BASE, mes: '2026-10', minAtivacoesIndivP3: 10, minimosPorPessoa: { 'ERICA SOUZA': 18, 'FRANCINI': 12, 'ISA': 12 } };
  assert.strictEqual(CE.minimoIndividual('ERICA SOUZA', cfgOut), 18);
  assert.strictEqual(CE.minimoIndividual('FRANCINI MARTINS', cfgOut), 12, 'nome do cadastro contido no da venda, palavra inteira');
  assert.strictEqual(CE.minimoIndividual('LUISA', cfgOut), 10, 'ISA não casa dentro de LUISA');
  assert.strictEqual(CE.minimoIndividual('KALI', cfgOut), 10, 'sem jornada: o mínimo do mês');
  assert.strictEqual(CE.minimoIndividual('ERICA SOUZA', { ...cfgOut, mes: '2026-09' }), 10, 'setembro: ignora o mapa');
  assert.strictEqual(CE.minimoIndividual('X', { ...BASE }), 10, 'sem nada: 10, como hoje');
  ok('mínimo individual: por pessoa de outubro em diante, casando por palavra; senão o do mês');
}

/* 5. o rateio respeita o mínimo de cada uma */
{
  const vd = () => ({
    'ERICA SOUZA': { ativacoes: 15, caixaP3Eligible: 10000, isNaoCom: false },
    'FRANCINI': { ativacoes: 13, caixaP3Eligible: 10000, isNaoCom: false },
  });
  const out = vd();
  CE.applyP3Pool(out, 58, 20, 16, 5, { ...CE.defaultConfig, ...BASE, mes: '2026-10', minAtivacoesIndivP3: 10, minimosPorPessoa: { 'ERICA SOUZA': 18, FRANCINI: 12 } });
  assert.strictEqual(out['ERICA SOUZA'].p3, 0, '15 contra 18: fora do rateio');
  assert.strictEqual(out.FRANCINI.p3, 700, '13 contra 12: leva o bolo inteiro');
  assert.ok(out['ERICA SOUZA'].p3detail.motivos.some(m => /mínimo individual de 18/.test(m)));
  const set = vd();
  CE.applyP3Pool(set, 58, 20, 16, 5, { ...CE.defaultConfig, ...BASE, mes: '2026-09', minAtivacoesIndivP3: 10, minimosPorPessoa: { 'ERICA SOUZA': 18, FRANCINI: 12 } });
  assert.strictEqual(set['ERICA SOUZA'].p3, 350); assert.strictEqual(set.FRANCINI.p3, 350);
  ok('rateio: em outubro cada uma contra o próprio mínimo; em setembro, o mínimo único de sempre');
}

/* 6. simulador e agregados usam o mesmo mínimo */
{
  const cfg = { ...CE.defaultConfig, ...BASE, mes: '2026-10', minAtivacoesIndivP3: 10, minimosPorPessoa: { BARBARA: 12 } };
  const resumo = { KALI: { ativacoes: 11, p3base: 5000 }, BARBARA: { ativacoes: 11, p3base: 5000 } };
  const ag = CE.agregadosP3(resumo, 'KALI', cfg);
  assert.strictEqual(ag.baseOutrasElegiveis, 0, 'a Bárbara (11 contra 12) não é elegível em outubro');
  const ag9 = CE.agregadosP3(resumo, 'KALI', { ...cfg, mes: '2026-09' });
  assert.strictEqual(ag9.baseOutrasElegiveis, 5000, 'em setembro é (11 contra 10)');
  const sim = CE.simularVendas({ minhas: { ativacoes: 11, p3base: 5000 }, nome: 'KALI', totais: { unitAtivacoes: 56, unitNovosRetorno: 20, unitRenovacoes: 16, unitVouchers: 5 },
    agregados: ag, qt: 1, valorCaixa: 200, bonusP2: 20, config: { ...cfg, minimosPorPessoa: { KALI: 12 } } });
  assert.strictEqual(sim.p3Antes, 0, '11 contra 12: fora');
  assert.ok(sim.p3Depois > 0, '12 contra 12: dentro');
  ok('agregados e simulador "E se…" usam o mínimo da pessoa e a regra do mês');
}

/* 7. configDoMes e o mês descoberto pelos itens */
{
  const c = CE.configDoMes({ unitConfig: { meta: 40 }, metasMensais: { meta: 45 }, mes: '2026-10', minimosPorPessoa: { A: 1 } });
  assert.strictEqual(c.meta, 45); assert.strictEqual(c.mes, '2026-10'); assert.deepStrictEqual(c.minimosPorPessoa, { A: 1 });
  assert.strictEqual(c.pctNovo, CE.defaultConfig.pctNovo, 'parte do padrão');
  assert.strictEqual(CE.configDoMes({}).mes, null);
  assert.strictEqual(CE.mesDosItens([{ data: '05/10/2026' }, { data: '06/10/2026' }, { data: '30/09/2026' }]), '2026-10', 'o mês da maioria');
  assert.strictEqual(CE.mesDosItens([]), null);
  ok('configDoMes junta padrão + unidade + meta do mês + mês; mesDosItens acha o mês pela maioria dos itens');
}

/* 9. calculate(): sem `mes` na configuração, descobre pelo mês das vendas */
{
  const CAB = ['Código', 'Cliente', 'Data', 'Itens', 'Valor Venda', 'Desconto Venda', 'Desconto Recebimento', 'Valor Final', 'Valor Quitado/Recibo', 'Origem', 'Tipo de Venda', 'Vendedor'];
  const linha = (cod, data) => [cod, 'CLIENTE ' + cod, data, 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO', '100', '-', '-', '100', '100', 'BALCÃO', 'Novo Contrato', 'KALI'];
  const out = CE.calculate(CE.cleanRawData([CAB, linha('C1', '05/10/2026'), linha('C2', '06/10/2026')]), { ...BASE });
  assert.strictEqual(out.config.mes, '2026-10');
  const set = CE.calculate(CE.cleanRawData([CAB, linha('C1', '05/09/2026')]), { ...BASE });
  assert.strictEqual(set.config.mes, '2026-09');
  const dado = CE.calculate(CE.cleanRawData([CAB, linha('C1', '05/10/2026')]), { ...BASE, mes: '2026-09' });
  assert.strictEqual(dado.config.mes, '2026-09', 'o mês informado manda');
  ok('calculate descobre o mês pelas vendas quando a tela não informa; o informado manda');
}

/* 8. a cópia de functions/ é idêntica */
{
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'functions', 'commission.js'), 'utf8'), fs.readFileSync(path.join(raiz, 'commission.js'), 'utf8'));
  ok('functions/commission.js idêntico ao da raiz');
}

console.log('\n✅ smoke-regra-minimos: ' + n);
