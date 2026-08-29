'use strict';
// Roda: node scripts/smoke-trocar-pessoa-escala.js
//
// A gestão discordar de UMA pessoa não pode custar refazer a escala inteira
// (Rafael, 12/08/2026). O risco da troca manual ERA silencioso: o contador de
// justiça era um número guardado, e se a troca não movesse o crédito, quem saiu
// ficava com um dia que não trabalhou. Desde 26/08/2026 não há crédito a mover
// — o número é CONTADO das escalas, então a troca entra na conta sozinha. Estes
// casos continuam valendo: são a prova de que a conta acompanha a vaga.
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const SE = require('../scale-engine.js');
const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'tester', SE });

// O "contador" virou contagem: pergunta-se às escalas, não a um documento.
const dias = async (d, pid) => {
  const todas = (await SS.listScales(d)).data;
  return SS.contarPorPessoa(todas, { tipos: ['sabado'] })[pid] || 0;
};

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

  /* ── 3. Vaga preenchida CONTA, consolidada ou não ────────────────── */
  // Mudou de propósito em 26/08/2026. Antes, escalar alguém numa escala que
  // ainda não tinha sido consolidada não creditava nada — o crédito dependia de
  // um `fairnessApplied` que a tela nem sempre gravava, e era por aí que o
  // contador se descolava da realidade. Agora vale o óbvio: se a pessoa está na
  // vaga, ela trabalha naquele dia, e portanto conta.
  d = deps(makeFakeDb());
  sab = await novaEscala(d);
  const r3 = await SS.reassignSlot(sab.id, 's1', 'p1', d);
  assert.ok(r3.success && r3.data.changed, 'troca aceita mesmo sem consolidação');
  assert.strictEqual(await dias(d, 'p1'), 1, 'quem está na vaga conta, consolidada ou não');
  console.log('✓ vaga preenchida conta sem depender de consolidação');

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

  /* ── 7. Fim de ano: a colisão é por DIA, não pela escala inteira ── */
  // Achado em 28/08/2026: pra sábado/feriado, uma escala = um dia, então
  // "outra vaga da escala" e "outra vaga do dia" sempre deram o mesmo
  // resultado. Fim de ano é um documento com o PERÍODO inteiro (vários
  // dias) — antes disto, quem trabalhava 20/12 nunca podia ser posto em
  // 27/12 pela troca manual. Estava em produção.
  d = deps(makeFakeDb());
  const fda = await (async () => (await SS.createScale({
    date: '2026-12-20', tipo: 'fim_de_ano', name: 'Fim de ano 2026',
    slots: [
      { id: 's_20_m', day: '2026-12-20', shift: 'manha',       unitId: 'cp', requiredModalityId: null, assignedPersonId: 'p1' },
      { id: 's_20_t', day: '2026-12-20', shift: 'tarde_noite', unitId: 'cp', requiredModalityId: null, assignedPersonId: null },
      { id: 's_27_m', day: '2026-12-27', shift: 'manha',       unitId: 'cp', requiredModalityId: null, assignedPersonId: null },
    ],
  }, d)).data)();

  const r7a = await SS.reassignSlot(fda.id, 's_27_m', 'p1', d);
  assert.ok(r7a.success && r7a.data.changed, 'a mesma pessoa pode trabalhar em outro DIA do período');

  const r7b = await SS.reassignSlot(fda.id, 's_20_t', 'p1', d);
  assert.ok(!r7b.success, 'mas não em dois turnos do MESMO dia');
  assert.ok(/já está/.test(r7b.error) && /outra vaga/.test(r7b.error), `com mensagem clara: "${r7b.error}"`);
  console.log('✓ fim de ano: colisão de vaga é por dia, não pelo período inteiro');

  // ── `day` só de um lado (documento legado / editado na mão) ───────────────
  // Aqui o certo é RECUSAR: errar recusando custa um clique; errar permitindo
  // põe a pessoa em duas vagas ao mesmo tempo, e ninguém percebe.
  const misto = (await SS.createScale({ date: '2026-12-24', tipo: 'fim_de_ano', slots: [
    { id: 'm_com', unitId: 'cp', day: '2026-12-24', requiredModalityId: 'TOI', assignedPersonId: 'p9' },
    { id: 'm_sem', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: null },
  ] }, d)).data;
  const rMisto = await SS.reassignSlot(misto.id, 'm_sem', 'p9', d);
  assert.ok(!rMisto.success, 'slot sem `day` não pode furar a colisão de quem já está no dia');
  console.log('✓ `day` faltando num dos lados recusa, em vez de permitir dupla escalação');

  console.log('\n✓ smoke-trocar-pessoa-escala: todos os casos passaram');
})().catch(e => { console.error('✗ FALHOU:', e.message); process.exit(1); });
