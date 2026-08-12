'use strict';
// Roda: node scripts/smoke-escala-ferias.js
//
// Quem está de férias/recesso APROVADO não pode ser escalado (Rafael, 12/08/2026).
// Antes disso o motor só excluía quem marcasse "Não posso" — quem estava de
// férias e não respondia continuava elegível. Com 2 meses de janela aberta de
// uma vez, isso deixa de ser azar e vira rotina.
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const SE = require('../scale-engine.js');
const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'tester', SE });

// Timestamp do Firestore tem .toDate(); o helper também aceita Date e string.
const ts = (iso) => ({ toDate: () => new Date(iso + 'T12:00:00') });
const ferias = (teacherId, ini, fim, status = 'aprovada') =>
  ({ teacherId, status, periods: [{ startDate: ts(ini), endDate: ts(fim) }] });

(async () => {
  /* ── 1. personsOnVacation (puro) ─────────────────────────────────── */
  const docs = [
    ferias('p1', '2026-09-01', '2026-09-15'),
    ferias('p2', '2026-09-20', '2026-09-30', 'pendente'),   // não aprovada
    ferias('p3', '2026-10-01', '2026-10-10', 'rejeitada'),
    { teacherId: 'p4', status: 'aprovada', periods: [       // multi-período
      { startDate: ts('2026-09-05'), endDate: ts('2026-09-07') },
      { startDate: ts('2026-09-25'), endDate: ts('2026-09-28') },
    ] },
  ];

  assert.deepStrictEqual([...SS.personsOnVacation(docs, '2026-09-10')], ['p1'], 'só quem tem férias aprovadas cobrindo o dia');
  assert.ok(SS.personsOnVacation(docs, '2026-09-01').has('p1'), 'primeiro dia do período conta (inclusivo)');
  assert.ok(SS.personsOnVacation(docs, '2026-09-15').has('p1'), 'último dia do período conta (inclusivo)');
  assert.ok(!SS.personsOnVacation(docs, '2026-08-31').has('p1'), 'véspera não conta');
  assert.ok(!SS.personsOnVacation(docs, '2026-09-16').has('p1'), 'dia seguinte não conta');
  assert.ok(!SS.personsOnVacation(docs, '2026-09-25').has('p2'), 'pedido PENDENTE não bloqueia');
  assert.ok(!SS.personsOnVacation(docs, '2026-10-05').has('p3'), 'pedido REJEITADO não bloqueia');
  assert.ok(SS.personsOnVacation(docs, '2026-09-06').has('p4'), 'multi-período: 1º trecho');
  assert.ok(SS.personsOnVacation(docs, '2026-09-26').has('p4'), 'multi-período: 2º trecho');
  assert.ok(!SS.personsOnVacation(docs, '2026-09-15').has('p4'), 'multi-período: intervalo entre os trechos é livre');
  assert.strictEqual(SS.personsOnVacation(docs, null).size, 0, 'sem data, ninguém');
  assert.strictEqual(SS.personsOnVacation(null, '2026-09-10').size, 0, 'sem férias, ninguém');
  // Aceita string e Date além de Timestamp
  assert.ok(SS.personsOnVacation([{ teacherId: 'x', status: 'aprovada', periods: [{ startDate: '2026-09-01', endDate: '2026-09-05' }] }], '2026-09-03').has('x'), 'aceita string ISO');
  console.log('✓ personsOnVacation OK (aprovada, inclusivo, multi-período, formatos)');

  /* ── 2..4 consolidate ────────────────────────────────────────────
   * Cada cenário roda em banco NOVO: consolidar move o contador de justiça,
   * e reaproveitar o mesmo banco faria a justiça (e não as férias) decidir
   * a vaga seguinte — o teste passaria/falharia pelo motivo errado.
   */
  const teachers = [
    { id: 'p1', name: 'De Férias',  modalityIds: ['TOI'], primaryUnitId: 'u1' },
    { id: 'p9', name: 'Disponível', modalityIds: ['TOI'], primaryUnitId: 'u1' },
  ];
  // p1 tem MAIS mérito: sem a regra de férias, ele é sempre o escolhido.
  const ctxBase = { teachers, meritoById: { p1: 100, p9: 0 }, opts: { minMes: 1 } };

  async function consolidarSabado(vacations) {
    const d = deps(makeFakeDb());
    const sab = (await SS.createScale({
      date: '2026-09-05', tipo: 'sabado', name: 'Sábado 05/09',
      slots: [{ id: 's1', unitId: 'u1', requiredModalityId: 'TOI', assignedPersonId: null }],
    }, d)).data;
    const res = await SS.consolidate(sab.id, Object.assign({}, ctxBase, { vacations }), d);
    assert.ok(res.success, 'consolidate respondeu ok');
    return res.data.assignments[0];
  }

  assert.strictEqual((await consolidarSabado()).personId, 'p1', 'controle: sem férias, o mérito manda e p1 leva');
  assert.strictEqual((await consolidarSabado([ferias('p1', '2026-09-01', '2026-09-10')])).personId, 'p9',
    'p1 está de férias → a vaga vai pro p9, mesmo com menos mérito');
  console.log('✓ consolidate exclui quem está de férias (mesmo com mérito maior)');

  const todosFora = await consolidarSabado([ferias('p1', '2026-09-01', '2026-09-10'), ferias('p9', '2026-09-01', '2026-09-10')]);
  assert.strictEqual(todosFora.personId, null, 'vaga fica aberta em vez de escalar alguém de férias');
  assert.strictEqual(todosFora.reason, 'sem_elegivel', 'e a gestão vê o motivo');
  console.log('✓ vaga fica aberta quando não sobra ninguém — nunca escala de férias na marra');

  assert.strictEqual((await consolidarSabado([ferias('p1', '2026-10-01', '2026-10-10')])).personId, 'p1',
    'férias em outubro não bloqueiam o sábado de setembro');
  assert.strictEqual((await consolidarSabado([ferias('p1', '2026-09-01', '2026-09-10', 'pendente')])).personId, 'p1',
    'pedido de férias ainda PENDENTE não tira ninguém da escala');
  console.log('✓ férias fora da data (ou não aprovadas) não interferem');

  console.log('\n✓ smoke-escala-ferias: todos os casos passaram');
})().catch(e => { console.error('✗ FALHOU:', e.message); process.exit(1); });
