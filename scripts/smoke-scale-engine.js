'use strict';
// Roda: node scripts/smoke-scale-engine.js
const assert = require('assert');
const SE = require('../scale-engine.js');

const slots = [
  { id: 's_toi',  unitId: 'cp', requiredModalityId: 'TOI' },
  { id: 's_hiit', unitId: 'cp', requiredModalityId: 'HIIT' },
];
// Sem dívida e todos já bateram o mínimo (diasTrabalhados>=minMes) → decide por mérito.
const base = (over) => Object.assign({ modalityIds: [], primaryUnitId: 'cp', merito: 0, diasTrabalhados: 5, divida: 0, pref: null }, over);
const candidates = [
  base({ id: 'ana',   modalityIds: ['TOI', 'HIIT'], merito: 30 }),
  base({ id: 'bru',   modalityIds: ['HIIT'],        merito: 50 }),
  base({ id: 'cleo',  modalityIds: ['TOI'],         merito: 10 }),
];

const r = SE.consolidate(slots, candidates, { minMes: 1 });
const bySlot = Object.fromEntries(r.assignments.map(a => [a.slotId, a]));
// TOI: elegíveis ana(30) e cleo(10) → ana (maior mérito)
assert.strictEqual(bySlot.s_toi.personId, 'ana', 'TOI vai pra Ana (mérito)');
assert.strictEqual(bySlot.s_toi.reason, 'merito');
// HIIT: elegíveis bru(50) e ana(30) — mas ana já foi alocada → bru
assert.strictEqual(bySlot.s_hiit.personId, 'bru', 'HIIT vai pra Bru (Ana já alocada, sem dupla)');

// Slot sem elegível → personId null
const r2 = SE.consolidate([{ id: 'x', unitId: 'cp', requiredModalityId: 'YOGA' }], candidates, {});
assert.strictEqual(r2.assignments[0].personId, null, 'sem habilitado = vaga vazia');
assert.strictEqual(r2.assignments[0].reason, 'sem_elegivel');

// nao_posso exclui
const r3 = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
  [base({ id: 'ana', modalityIds: ['TOI'], merito: 99, pref: 'nao_posso' }), base({ id: 'cleo', modalityIds: ['TOI'], merito: 10 })], {});
assert.strictEqual(r3.assignments[0].personId, 'cleo', 'nao_posso exclui Ana mesmo com mérito alto');

// vaga SEM modalidade exigida (fim de ano) = qualquer colaborador elegível
const rAny = SE.consolidate([{ id: 'd', unitId: 'cp', requiredModalityId: null }],
  [base({ id: 'ze', modalityIds: [], merito: 7 }), base({ id: 'cleo', modalityIds: ['TOI'], merito: 3 })], {});
assert.strictEqual(rAny.assignments[0].personId, 'ze', 'sem modalidade: pega por mérito mesmo sem habilitação');

console.log('✓ smoke-scale-engine: elegibilidade/mérito OK');

// ── Piso de justiça ──
const b2 = (over) => Object.assign({ modalityIds: ['TOI'], primaryUnitId: 'cp', merito: 0, diasTrabalhados: 5, divida: 0, pref: null }, over);
// Ana tem mérito alto mas já trabalhou; Dora tem mérito baixo mas NÃO bateu o mínimo (dias 0) → piso ganha
const rPiso = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
  [b2({ id: 'ana', merito: 90, diasTrabalhados: 5 }), b2({ id: 'dora', merito: 5, diasTrabalhados: 0 })], { minMes: 1 });
assert.strictEqual(rPiso.assignments[0].personId, 'dora', 'piso (mínimo do mês) vence o mérito');
assert.strictEqual(rPiso.assignments[0].reason, 'justica');
assert.deepStrictEqual(rPiso.fairnessDelta.dora, { dias: 1, dividaResolvida: 0 }, 'dias +1, sem dívida');

// Dívida prioriza e é resolvida no delta
const rDiv = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
  [b2({ id: 'edu', merito: 5, diasTrabalhados: 0, divida: 0 }), b2({ id: 'fab', merito: 5, diasTrabalhados: 0, divida: 2 })], { minMes: 1 });
assert.strictEqual(rDiv.assignments[0].personId, 'fab', 'maior dívida escolhe primeiro');
assert.strictEqual(rDiv.fairnessDelta.fab.dividaResolvida, 1, 'dívida resolvida no delta');

console.log('✓ smoke-scale-engine: piso de justiça OK');

/* ── RODÍZIO ACIMA DO PISO (24/08/2026) ────────────────────────────────
 * Produção mostrou o defeito: as 44 vagas das 11 primeiras escalas foram
 * decididas por MÉRITO — o motor registrou "justiça" zero vezes. Bruno
 * Claudino e Karin pegaram os 11 sábados; onze pessoas ficaram com 1 dia.
 *
 * Causa: o rodízio só valia ABAIXO do piso (`diasTrabalhados < minMes`, com
 * minMes = 1). Todo mundo já tinha 1 dia, ninguém ficava no piso, e o motor
 * caía direto no mérito — um número fixo. Fora do piso, `diasTrabalhados` não
 * era nem consultado, então quem tinha mais mérito ganhava para sempre.
 *
 * Decisão do Rafael em 24/08/2026: "rodízio com mérito como desempate".
 */
{
  const p = (over) => Object.assign(
    { modalityIds: ['TOI'], primaryUnitId: 'cp', merito: 0, diasTrabalhados: 0, divida: 0, pref: null }, over);
  const slot = [{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }];

  // O caso real: os dois acima do piso, um trabalhou muito mais
  let r = SE.consolidate(slot,
    [p({ id: 'bruno', merito: 90, diasTrabalhados: 9 }), p({ id: 'alan', merito: 5, diasTrabalhados: 1 })],
    { minMes: 1 });
  assert.strictEqual(r.assignments[0].personId, 'alan',
    'quem trabalhou menos vem primeiro, mesmo com mérito menor — é rodízio, não ranking');
  assert.strictEqual(r.assignments[0].reason, 'justica',
    'e o motivo registrado é justiça, não mérito');

  // Empate de dias → aí sim o mérito decide (é o desempate)
  r = SE.consolidate(slot,
    [p({ id: 'bruno', merito: 90, diasTrabalhados: 4 }), p({ id: 'alan', merito: 5, diasTrabalhados: 4 })],
    { minMes: 1 });
  assert.strictEqual(r.assignments[0].personId, 'bruno', 'dias iguais → mérito desempata');
  assert.strictEqual(r.assignments[0].reason, 'merito', 'e o motivo é mérito');

  // Dívida continua na frente de tudo: quem deve dia paga primeiro
  r = SE.consolidate(slot,
    [p({ id: 'bruno', merito: 90, diasTrabalhados: 0, divida: 0 }), p({ id: 'alan', merito: 5, diasTrabalhados: 8, divida: 2 })],
    { minMes: 1 });
  assert.strictEqual(r.assignments[0].personId, 'alan', 'dívida vem antes do rodízio');

  // O que estava quebrado em produção: datas seguidas não podem cair sempre na
  // mesma pessoa havendo gente disponível que trabalhou menos.
  const pessoas = ['a', 'b', 'c', 'd'].map(id => p({ id, merito: id === 'a' ? 100 : 1 }));
  const dias = {};
  for (let i = 0; i < 8; i++) {
    const cands = pessoas.map(x => Object.assign({}, x, { diasTrabalhados: dias[x.id] || 0 }));
    const escolhido = SE.consolidate(slot, cands, { minMes: 1 }).assignments[0].personId;
    dias[escolhido] = (dias[escolhido] || 0) + 1;
  }
  assert.strictEqual(Object.keys(dias).length, 4, 'todo mundo entra no rodízio, não só o de maior mérito');
  const vezes = Object.values(dias);
  assert.ok(Math.max(...vezes) - Math.min(...vezes) <= 1,
    `8 datas entre 4 pessoas tem que ficar equilibrado, veio ${JSON.stringify(dias)}`);
}
console.log('✓ smoke-scale-engine: rodízio vale acima do piso, mérito só desempata');

/* ── COTA: quantos dias a pessoa QUER na janela (24/08/2026) ───────────
 * Rodrigo: "perguntar para os candidatos a trabalhar aos sábados — quantas
 * vezes gostaria de trabalhar nessa janela; tem gente que precisa de mais, e
 * tem gente que de menos, mas fazer essa escala inteligentemente".
 *
 * A cota é TETO MACIO: quem já bateu o que pediu vai pro fim da fila, mas ainda
 * pode ser escalado se não sobrar mais ninguém — melhor alguém acima da cota do
 * que o sábado sem professor.
 */
{
  const p = (over) => Object.assign(
    { modalityIds: ['TOI'], primaryUnitId: 'cp', merito: 0, diasTrabalhados: 0, divida: 0, pref: null,
      cotaDesejada: null, jaNoLote: 0 }, over);
  const slot = [{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }];

  // Quem já bateu a própria cota cede a vez, mesmo tendo trabalhado menos no geral
  let r = SE.consolidate(slot, [
    p({ id: 'quer1', cotaDesejada: 1, jaNoLote: 1, diasTrabalhados: 0 }),
    p({ id: 'quer4', cotaDesejada: 4, jaNoLote: 1, diasTrabalhados: 5 }),
  ], { minMes: 1 });
  assert.strictEqual(r.assignments[0].personId, 'quer4',
    'quem pediu 4 e só tem 1 ainda quer trabalhar; quem pediu 1 e já tem 1 cede');
  assert.strictEqual(r.assignments[0].reason, 'cota', 'e o motivo registrado é a cota');

  // Sem cota declarada = sem teto: entra no rodízio normal
  r = SE.consolidate(slot, [
    p({ id: 'semcota', diasTrabalhados: 1 }),
    p({ id: 'comcota', cotaDesejada: 3, jaNoLote: 0, diasTrabalhados: 5 }),
  ], { minMes: 1 });
  assert.strictEqual(r.assignments[0].personId, 'semcota',
    'ninguém acima da cota → decide o rodízio normal');

  // Cota zero = "não quero nenhum": vai pro fim, mas não é excluído
  r = SE.consolidate(slot, [p({ id: 'zero', cotaDesejada: 0, jaNoLote: 0 })], { minMes: 1 });
  assert.strictEqual(r.assignments[0].personId, 'zero',
    'se não sobra mais ninguém, escala assim mesmo — melhor que sábado sem professor');

  // Todo mundo dentro da cota → o rodízio decide, como antes
  r = SE.consolidate(slot, [
    p({ id: 'a', cotaDesejada: 3, jaNoLote: 1, diasTrabalhados: 4 }),
    p({ id: 'b', cotaDesejada: 3, jaNoLote: 1, diasTrabalhados: 2 }),
  ], { minMes: 1 });
  assert.strictEqual(r.assignments[0].personId, 'b', 'dentro da cota, vale quem trabalhou menos');
}
console.log('✓ smoke-scale-engine: cota de dias por pessoa (teto macio)');

// ── Preferência e unidade alternada (desempate, mesmo mérito/piso) ──
const b3 = (over) => Object.assign({ modalityIds: ['TOI'], primaryUnitId: 'cp', merito: 20, diasTrabalhados: 5, divida: 0, pref: null }, over);
// Mesmo mérito; gabi quer, hugo neutro → gabi
const rPref = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
  [b3({ id: 'gabi', pref: 'quer' }), b3({ id: 'hugo', pref: null })], {});
assert.strictEqual(rPref.assignments[0].personId, 'gabi', 'quem marcou "quer" desempata pra cima');

// nao_quer vai pro fim (mesmo mérito)
const rNao = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
  [b3({ id: 'ian', pref: 'nao_quer' }), b3({ id: 'joa', pref: null })], {});
assert.strictEqual(rNao.assignments[0].personId, 'joa', '"nao_quer" cede a vaga');

// unidade alternada desempata quando mérito e preferência empatam
const rAlt = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
  [b3({ id: 'kim', primaryUnitId: 'cp' }), b3({ id: 'leo', primaryUnitId: 'norte' })], {});
assert.strictEqual(rAlt.assignments[0].personId, 'leo', 'quem é de outra unidade (alternada) desempata');

console.log('✓ smoke-scale-engine: preferência/unidade alternada OK');

// ── Preferência NOVA: prefiro puxa, pode_ser neutro, nao_posso filtra ──
{
  const r = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
    [b3({ id: 'mara', pref: 'pode_ser' }), b3({ id: 'nina', pref: 'prefiro' })], {});
  assert.strictEqual(r.assignments[0].personId, 'nina', 'prefiro ganha de pode_ser no empate');
}
{
  const r = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
    [b3({ id: 'olga', merito: 99, pref: 'nao_posso' }), b3({ id: 'paty', merito: 1 })], {});
  assert.strictEqual(r.assignments[0].personId, 'paty', 'nao_posso filtra mesmo com mérito alto');
}
{
  // legado: quer ainda puxa acima de nao_quer
  const r = SE.consolidate([{ id: 's', unitId: 'cp', requiredModalityId: 'TOI' }],
    [b3({ id: 'rai', pref: 'nao_quer' }), b3({ id: 'sol', pref: 'quer' })], {});
  assert.strictEqual(r.assignments[0].personId, 'sol', 'legado quer > nao_quer');
}
console.log('✓ smoke-scale-engine: preferência nova (prefiro/pode_ser) OK');
