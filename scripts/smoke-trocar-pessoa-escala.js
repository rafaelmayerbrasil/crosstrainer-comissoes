'use strict';
// Roda: node scripts/smoke-trocar-pessoa-escala.js
//
// A gestão discordar de UMA pessoa não pode custar refazer a escala inteira
// (Rafael, 12/08/2026). O risco da troca manual é silencioso: o contador de
// JUSTIÇA já foi creditado na consolidação. Se a troca não mover o crédito,
// quem saiu fica com um dia que não trabalhou e quem entrou trabalha de graça
// no rodízio — e o motor passa a decidir errado pra sempre.
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const SE = require('../scale-engine.js');
const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'tester', SE });

const dias = async (d, pid) => (await SS.getFairness(pid, d)).data.diasTrabalhados;

async function novaEscala(d, slots) {
  return (await SS.createScale({
    date: '2026-09-05', tipo: 'sabado', name: 'Sábado 05/09',
    slots: slots || [{ id: 's1', unitId: 'u1', requiredModalityId: 'TOI', assignedPersonId: null }],
  }, d)).data;
}
const teachers = [
  { id: 'p1', name: 'Escolhido',  modalityIds: ['TOI'], primaryUnitId: 'u1' },
  { id: 'p2', name: 'Substituto', modalityIds: ['TOI'], primaryUnitId: 'u1' },
];
const ctx = { teachers, meritoById: { p1: 100, p2: 0 }, opts: { minMes: 1 } };

(async () => {
  /* ── 1. Troca move o crédito de justiça junto ────────────────────── */
  let d = deps(makeFakeDb());
  let sab = await novaEscala(d);
  await SS.consolidate(sab.id, ctx, d);
  assert.strictEqual(await dias(d, 'p1'), 1, 'consolidação creditou o dia pro escolhido');
  assert.strictEqual(await dias(d, 'p2'), 0, 'e não pro outro');

  const r = await SS.reassignSlot(sab.id, 's1', 'p2', d);
  assert.ok(r.success && r.data.changed, 'troca aceita');
  assert.ok(r.data.fairnessAjustada, 'avisa que mexeu no contador');
  assert.strictEqual(await dias(d, 'p1'), 0, 'quem SAIU devolve o dia');
  assert.strictEqual(await dias(d, 'p2'), 1, 'quem ENTROU recebe o dia');

  const slot = (await SS.getScale(sab.id, d)).data.slots[0];
  assert.strictEqual(slot.assignedPersonId, 'p2', 'a vaga é do novo');
  assert.strictEqual(slot.reason, 'manual', 'marcado como escolha da gestão, não justiça/mérito');
  assert.deepStrictEqual(slot.explain, [], 'a tabela do "porquê" não fica mentindo');
  console.log('✓ troca move o crédito de justiça (o rodízio não se corrompe)');

  /* ── 2. Esvaziar a vaga devolve o dia e não credita ninguém ──────── */
  const r2 = await SS.reassignSlot(sab.id, 's1', null, d);
  assert.ok(r2.success && r2.data.changed);
  assert.strictEqual(await dias(d, 'p2'), 0, 'quem saiu devolve o dia');
  assert.strictEqual((await SS.getScale(sab.id, d)).data.slots[0].assignedPersonId, null, 'vaga volta a ficar aberta');
  console.log('✓ esvaziar a vaga devolve o crédito');

  /* ── 3. Escala AINDA NÃO consolidada não mexe em contador ────────── */
  d = deps(makeFakeDb());
  sab = await novaEscala(d);
  const r3 = await SS.reassignSlot(sab.id, 's1', 'p1', d);
  assert.ok(r3.success && !r3.data.fairnessAjustada, 'sem consolidação, nada de contador');
  assert.strictEqual(await dias(d, 'p1'), 0, 'ninguém ganha dia numa escala que nunca foi contabilizada');
  console.log('✓ escala não consolidada não mexe na justiça');

  /* ── 4. Mesma pessoa em duas vagas do mesmo dia é recusado ───────── */
  d = deps(makeFakeDb());
  sab = await novaEscala(d, [
    { id: 's1', unitId: 'u1', requiredModalityId: 'TOI',  assignedPersonId: 'p1' },
    { id: 's2', unitId: 'u1', requiredModalityId: 'HIIT', assignedPersonId: 'p2' },
  ]);
  const r4 = await SS.reassignSlot(sab.id, 's2', 'p1', d);
  assert.ok(!r4.success, 'recusa duplicar a pessoa no mesmo dia');
  assert.ok(/outra vaga/i.test(r4.error), `com mensagem clara: "${r4.error}"`);
  console.log('✓ ninguém cobre duas vagas no mesmo dia');

  /* ── 5. Trocar pela MESMA pessoa não faz nada ────────────────────── */
  const r5 = await SS.reassignSlot(sab.id, 's1', 'p1', d);
  assert.ok(r5.success && r5.data.changed === false, 'no-op, sem mexer em contador');
  console.log('✓ trocar pela mesma pessoa é no-op');

  /* ── 6. Vaga inexistente ─────────────────────────────────────────── */
  const r6 = await SS.reassignSlot(sab.id, 'nao_existe', 'p1', d);
  assert.ok(!r6.success && /vaga não encontrada/i.test(r6.error), 'slot inválido tratado');
  console.log('✓ vaga inexistente tratada');

  console.log('\n✓ smoke-trocar-pessoa-escala: todos os casos passaram');
})().catch(e => { console.error('✗ FALHOU:', e.message); process.exit(1); });
