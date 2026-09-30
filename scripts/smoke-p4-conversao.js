'use strict';
// Roda: node scripts/smoke-p4-conversao.js
//
// Conversão de voucher (P4) a partir de OUTUBRO/2026 (spec 2026-09-29 §5.6):
// • reconhece a conversão pelo NOME do cliente (na Pacto a degustação e o plano
//   cheio são contratos com números diferentes — desde a migração nenhuma
//   conversão casava pelo código: 0 em jul/ago/set, medido em 30/09/2026);
// • aceita a conversão que a Pacto registra como "renovação";
// • degraus 30% → R$ 150 · 40% → R$ 300 · 50% → R$ 450 (resposta do Rodrigo, 30/09);
// • R$ 30 por conversão continua.
// Setembro e antes: exatamente como era. Dados INVENTADOS.

const assert = require('assert');
const path = require('path');
const CE = require(path.join(__dirname, '..', 'commission.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

// 10 degustações em setembro (código do TecnoFit/Pacto diferente do contrato novo)
const vouchers = Array.from({ length: 10 }, (_, i) => ({
  isDegustacao: true, isContract: false, category: 'voucher', cliente: 'Cliente ' + i, codigo: '3175416' + (1000 + i),
  data: '10/09/2026', item: 'MÊS DEGUSTAÇÃO LIVRE (10/09/2026 - 10/10/2026)', vendedor: 'KALI',
}));
const contrato = (i, categoria, dia = '15/10/2026') => ({
  isContract: true, periodicidade: 'ANUAL', category: categoria, cliente: 'CLIENTE ' + i, codigo: 'C' + (9000 + i),
  data: dia, item: 'HIIT | ANUAL', vendedor: 'KALI',
});
const p4 = (qtd, mes, categoria = 'renovacao') =>
  CE.calcP4(Array.from({ length: qtd }, (_, i) => contrato(i, categoria)), vouchers.map(v => ({ ...v })), { mes });

/* 1. outubro: casa pelo nome, aceita "renovação", degraus 30/40/50% */
{
  const r5 = p4(5, '2026-10');
  assert.strictEqual(r5.conversoesMes, 5, 'pelo nome, mesmo com códigos diferentes e categoria renovação');
  assert.strictEqual(r5.poolTier, 'gold'); assert.strictEqual(r5.pool, 450);
  assert.strictEqual(r5.conversions.every(c => c.bonus === 30), true, 'R$ 30 por conversão continua');
  assert.strictEqual(r5.vendorPool.KALI, 450);
  const r4 = p4(4, '2026-10');
  assert.strictEqual(r4.poolTier, 'super'); assert.strictEqual(r4.pool, 300, '40% de 10');
  const r3 = p4(3, '2026-10');
  assert.strictEqual(r3.poolTier, 'meta'); assert.strictEqual(r3.pool, 150, '30% de 10');
  assert.strictEqual(p4(2, '2026-10').pool, 0);
  assert.strictEqual(r5.metaVoucher, 3); assert.strictEqual(r5.superMetaVoucher, 4); assert.strictEqual(r5.goldMetaVoucher, 5);
  ok('outubro: reconhece pelo nome (inclusive "renovação"); 30% → R$ 150, 40% → R$ 300, 50% → R$ 450; R$ 30 cada');
}

/* 2. setembro e antes: igual a sempre (pelo código, só novo/retorno, sem Gold) */
{
  const r = p4(5, '2026-09');
  assert.strictEqual(r.conversoesMes, 0, 'pelo código não casa — como está no ar');
  assert.strictEqual(r.pool, 0);
  assert.strictEqual(r.goldMetaVoucher, undefined, 'sem degrau Gold');
  // o caso que sempre funcionou (mesmo código, venda nova) continua funcionando
  const antigo = CE.calcP4([{ ...contrato(1, 'novo', '15/09/2026'), codigo: '3175416' + 1001 }], vouchers.map(v => ({ ...v, data: '20/08/2026', item: 'MÊS DEGUSTAÇÃO LIVRE (20/08/2026 - 20/09/2026)' })), { mes: '2026-09' });
  assert.strictEqual(antigo.conversoesMes, 1);
  ok('setembro: mesmo resultado de hoje, recalcular não muda mês pago');
}

/* 3. limites da conversão em outubro */
{
  const tarde = CE.calcP4([contrato(1, 'novo', '30/11/2026')], vouchers.map(v => ({ ...v })), { mes: '2026-10' });
  assert.strictEqual(tarde.conversoesMes, 0, 'mais de 45 dias depois do fim da degustação');
  const semVoucher = CE.calcP4([{ ...contrato(1, 'renovacao'), cliente: 'OUTRA PESSOA' }], vouchers.map(v => ({ ...v })), { mes: '2026-10' });
  assert.strictEqual(semVoucher.conversoesMes, 0, 'renovação de quem não fez degustação não é conversão');
  const mensal = CE.calcP4([{ ...contrato(1, 'novo'), periodicidade: 'MENSAL' }], vouchers.map(v => ({ ...v })), { mes: '2026-10' });
  assert.strictEqual(mensal.conversoesMes, 0, 'mensal não é plano cheio');
  const duas = CE.calcP4([contrato(1, 'novo'), { ...contrato(1, 'novo'), codigo: 'C9999' }], vouchers.map(v => ({ ...v })), { mes: '2026-10' });
  assert.strictEqual(duas.conversoesMes, 1, 'a mesma degustação converte uma vez só');
  ok('outubro: prazo de 45 dias, só quem fez degustação, só plano cheio, uma conversão por degustação');
}

console.log('\n✅ smoke-p4-conversao: ' + n);
