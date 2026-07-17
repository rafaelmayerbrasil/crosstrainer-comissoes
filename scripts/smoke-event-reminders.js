'use strict';
// Roda: node scripts/smoke-event-reminders.js
const assert = require('assert');
const RU = require('../functions/reminders-util.js');

// ── dueReminderOffsets ──
assert.deepStrictEqual(RU.dueReminderOffsets('2026-08-15', '2026-08-08', []), ['7d'], '7 dias antes');
assert.deepStrictEqual(RU.dueReminderOffsets('2026-08-15', '2026-08-11', []), ['4d'], '4 dias antes');
assert.deepStrictEqual(RU.dueReminderOffsets('2026-08-15', '2026-08-14', []), ['1d'], '1 dia antes');
assert.deepStrictEqual(RU.dueReminderOffsets('2026-08-15', '2026-08-10', []), [], 'dia sem offset = nada');
assert.deepStrictEqual(RU.dueReminderOffsets('2026-08-15', '2026-08-08', ['7d']), [], 'já enviado não repete');
assert.deepStrictEqual(RU.dueReminderOffsets('2026-08-15', '2026-08-16', []), [], 'evento já passou = nada');
console.log('✓ dueReminderOffsets OK');

// ── reminderRecipients ──
assert.deepStrictEqual(
  RU.reminderRecipients([{ personId: 'a', going: true }, { personId: 'b', going: false }, { personId: 'c', going: null }]).sort(),
  ['a', 'c'], 'exclui só quem respondeu Não vou');
assert.deepStrictEqual(RU.reminderRecipients([]), [], 'vazio');
console.log('✓ reminderRecipients OK');

console.log('\n✅ smoke-event-reminders OK');
