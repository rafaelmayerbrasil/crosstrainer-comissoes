'use strict';
// Roda: node scripts/smoke-class-propagation.js
const assert = require('assert');
const CP = require('../class-propagation.js');

const novoSlot = { teacherId: 'novoT', modalityId: 'novoM', startTime: '19:00', endTime: '20:00', durationMinutes: 60 };
const hoje = '2026-07-12';
const aulas = [
  { id: 'a1', status: 'prevista',    monthClosingId: null,               dateISO: '2026-07-20' }, // futura intocada → atualiza
  { id: 'a2', status: 'prevista',    monthClosingId: null,               dateISO: '2026-07-27' }, // futura intocada → atualiza
  { id: 'a3', status: 'prevista',    monthClosingId: 'unit-cp_2026-07',  dateISO: '2026-07-22' }, // mês fechado → pula
  { id: 'a4', status: 'substituida', monthClosingId: null,               dateISO: '2026-07-24' }, // substituída → pula
  { id: 'a5', status: 'cancelada',   monthClosingId: null,               dateISO: '2026-07-29' }, // cancelada → pula
  { id: 'a6', status: 'prevista',    monthClosingId: null,               dateISO: '2026-07-05' }, // passada → pula
];
const r = CP.planClassUpdatesForSlot(novoSlot, aulas, hoje);
assert.strictEqual(r.eligibleCount, 2, 'só 2 elegíveis');
assert.deepStrictEqual(r.updates.map(u => u.classId).sort(), ['a1', 'a2'], 'ids errados');
assert.deepStrictEqual(r.updates[0].patch, {
  teacherId: 'novoT', originalTeacherId: 'novoT', modalityId: 'novoM',
  startTime: '19:00', endTime: '20:00', durationMinutes: 60,
}, 'patch errado (originalTeacherId deve acompanhar o novo titular)');
console.log('✓ intocadas atualizadas, resto pulado (mês fechado/substituída/cancelada/passada)');

// nenhuma elegível (realizada não conta) e input vazio
const r2 = CP.planClassUpdatesForSlot(novoSlot, [{ id: 'x', status: 'realizada', monthClosingId: null, dateISO: '2026-07-30' }], hoje);
assert.strictEqual(r2.eligibleCount, 0, 'realizada não é elegível');
assert.deepStrictEqual(CP.planClassUpdatesForSlot(novoSlot, [], hoje).updates, [], 'lista vazia → sem updates');
console.log('✓ sem elegíveis → eligibleCount 0');

// ════════════ predicado isUntouchedClass ════════════
const HOJE = '2026-07-12';
assert.strictEqual(CP.isUntouchedClass({ status: 'prevista', monthClosingId: null, dateISO: '2026-07-20' }, HOJE), true, 'prevista futura sem fechamento é intocada');
assert.strictEqual(CP.isUntouchedClass({ status: 'prevista', monthClosingId: null, dateISO: HOJE }, HOJE), true, 'hoje conta como intocada');
assert.strictEqual(CP.isUntouchedClass({ status: 'prevista', monthClosingId: 'u_2026-07', dateISO: '2026-07-20' }, HOJE), false, 'mês fechado não é intocada');
assert.strictEqual(CP.isUntouchedClass({ status: 'substituida', monthClosingId: null, dateISO: '2026-07-20' }, HOJE), false, 'substituída não é intocada');
assert.strictEqual(CP.isUntouchedClass({ status: 'cancelada', monthClosingId: null, dateISO: '2026-07-20' }, HOJE), false, 'cancelada não é intocada');
assert.strictEqual(CP.isUntouchedClass({ status: 'realizada', monthClosingId: null, dateISO: '2026-07-20' }, HOJE), false, 'realizada não é intocada');
assert.strictEqual(CP.isUntouchedClass({ status: 'prevista', monthClosingId: null, dateISO: '2026-07-05' }, HOJE), false, 'passada não é intocada');
console.log('✓ isUntouchedClass aceita só prevista + sem fechamento + de hoje em diante');

// ════════════ as duas cópias não podem divergir ════════════
// O deploy das Functions leva só functions/, então existe um gêmeo lá.
// Comparar COMPORTAMENTO, não texto: os cabeçalhos diferem de propósito.
const CPF = require('../functions/class-propagation.js');
const casos = [
  { status: 'prevista',    monthClosingId: null,        dateISO: '2026-07-20' },
  { status: 'prevista',    monthClosingId: 'u_2026-07', dateISO: '2026-07-20' },
  { status: 'substituida', monthClosingId: null,        dateISO: '2026-07-20' },
  { status: 'cancelada',   monthClosingId: null,        dateISO: '2026-07-20' },
  { status: 'realizada',   monthClosingId: null,        dateISO: '2026-07-20' },
  { status: 'prevista',    monthClosingId: null,        dateISO: '2026-07-05' },
  { status: 'prevista',    monthClosingId: null,        dateISO: HOJE },
];
casos.forEach(c => {
  assert.strictEqual(CPF.isUntouchedClass(c, HOJE), CP.isUntouchedClass(c, HOJE),
    `as duas cópias divergiram em isUntouchedClass(${JSON.stringify(c)})`);
});
console.log('✓ cópia da raiz e cópia de functions/ concordam');

console.log('\n✅ smoke-class-propagation OK');
