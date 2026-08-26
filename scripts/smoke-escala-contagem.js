'use strict';
// Roda: node scripts/smoke-escala-contagem.js
//
// O contador de justiça deixou de ser um número guardado e passou a ser CONTADO
// das escalas. Motivo (25/08/2026): em produção 9 das 16 pessoas estavam com o
// contador errado — a Karin marcava 1 e tinha 3 sábados — porque o número só se
// mexia na primeira montagem de cada data, e remontar a prévia troca as pessoas
// sem refazer a conta. Pior: esse número é o insumo do motor, então o contador
// travado da Karin foi o que a fez pegar 3 sábados.

const assert = require('assert');
const SS = require('../scale-service.js');

let ok = 0;
const passou = (msg) => { console.log('✓ ' + msg); ok++; };

const vaga = (id, pid) => ({ id, unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: pid || null });
const escala = (date, tipo, pessoas, batchId) => ({
  id: `sc_${date}_${tipo}`, date, tipo, windowBatchId: batchId || null,
  slots: pessoas.map((p, i) => vaga(`v${i}`, p)),
});

const ESCALAS = [
  escala('2026-09-05', 'sabado',  ['karin', 'bruno'], 'b1'),
  escala('2026-09-07', 'feriado', ['bruno', 'thay'],  'b2'),
  escala('2026-09-19', 'sabado',  ['karin', null],    'b1'),
  escala('2026-10-17', 'sabado',  ['karin'],          'b1'),
  escala('2026-11-14', 'evento',  ['karin']),
  escala('2025-09-06', 'sabado',  ['karin']),
];

// ── por tipo ──
{
  const sab = SS.contarPorPessoa(ESCALAS, { tipos: ['sabado'] });
  assert.strictEqual(sab.karin, 4, 'karin tem 3 sábados em 2026 + 1 em 2025');
  assert.strictEqual(sab.bruno, 1, 'bruno tem 1 sábado');
  assert.strictEqual(sab.thay, undefined, 'thay não tem sábado nenhum');
  assert.strictEqual(sab.evento, undefined, 'evento não é sábado');
  passou('conta por tipo e ignora os outros tipos');
}

// ── feriado NÃO soma sábado (pedido 4 do Rodrigo) ──
{
  const fer = SS.contarPorPessoa(ESCALAS, { tipos: ['feriado', 'domingo_especial'] });
  assert.strictEqual(fer.bruno, 1, 'bruno tem 1 feriado');
  assert.strictEqual(fer.karin, undefined, 'os 3 sábados da karin não entram em feriados');
  passou('feriado conta só feriado');
}

// ── por ano ──
{
  const ano = SS.contarPorPessoa(ESCALAS, { tipos: ['sabado'], de: '2026-01-01', ate: '2026-12-31' });
  assert.strictEqual(ano.karin, 3, 'o sábado de 2025 fica fora do ano de 2026');
  passou('recorta por período');
}

// ── por janela ──
{
  const j = SS.contarPorPessoa(ESCALAS, { tipos: ['sabado'], batchId: 'b1' });
  assert.strictEqual(j.karin, 3, 'karin tem 3 datas no lote b1');
  assert.strictEqual(j.bruno, 1, 'bruno tem 1');
  const j2 = SS.contarPorPessoa(ESCALAS, { tipos: ['feriado'], batchId: 'b1' });
  assert.deepStrictEqual(j2, {}, 'o lote b1 não tem feriado');
  passou('recorta por janela (lote)');
}

// ── excluirDatas: o coração do "refazer a janela" ──
// Ao remontar, as datas que ainda carregam a escala ANTIGA não podem entrar na
// conta — senão a escala velha empurra as pessoas erradas na escala nova.
{
  const c = SS.contarPorPessoa(ESCALAS, { tipos: ['sabado'], excluirDatas: ['2026-09-19', '2026-10-17'] });
  assert.strictEqual(c.karin, 2, 'sobram 05/09 e o de 2025');
  const cSet = SS.contarPorPessoa(ESCALAS, { tipos: ['sabado'], excluirDatas: new Set(['2026-09-19']) });
  assert.strictEqual(cSet.karin, 3, 'aceita Set do mesmo jeito que array');
  passou('excluirDatas tira as datas que estão sendo remontadas');
}

// ── vaga aberta não conta ──
{
  const c = SS.contarPorPessoa([escala('2026-09-26', 'sabado', [null, null])], { tipos: ['sabado'] });
  assert.deepStrictEqual(c, {}, 'vaga sem ninguém não conta pra ninguém');
  passou('vaga aberta não conta');
}

// ── sem filtro: conta tudo; entrada vazia não estoura ──
{
  assert.deepStrictEqual(SS.contarPorPessoa([], {}), {}, 'lista vazia devolve objeto vazio');
  assert.deepStrictEqual(SS.contarPorPessoa(null, null), {}, 'null não estoura');
  passou('entrada vazia é segura');
}

// ── tiposIrmaos ──
{
  assert.deepStrictEqual(SS.tiposIrmaos('sabado'), ['sabado']);
  assert.deepStrictEqual(SS.tiposIrmaos('feriado'), ['feriado', 'domingo_especial']);
  assert.deepStrictEqual(SS.tiposIrmaos('domingo_especial'), ['feriado', 'domingo_especial']);
  passou('feriado e domingo especial contam juntos');
}

console.log(`\n✓ smoke-escala-contagem: ${ok} seções OK`);
