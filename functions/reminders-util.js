// functions/reminders-util.js — lógica pura de lembretes de evento (testável sem Firebase).
'use strict';

const OFFSETS = [['7d', 7], ['4d', 4], ['1d', 1]];

// Quantos dias inteiros entre duas datas ISO 'YYYY-MM-DD' (b - a), via UTC (sem fuso).
function daysBetween(aISO, bISO) {
  const a = Date.UTC(+aISO.slice(0, 4), +aISO.slice(5, 7) - 1, +aISO.slice(8, 10));
  const b = Date.UTC(+bISO.slice(0, 4), +bISO.slice(5, 7) - 1, +bISO.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

// Offsets ('7d'/'4d'/'1d') devidos HOJE p/ um evento, excluindo os já enviados.
function dueReminderOffsets(eventDateISO, todayISO, sent) {
  const faltam = daysBetween(todayISO, eventDateISO);
  const jaEnviados = new Set(sent || []);
  return OFFSETS.filter(([label, n]) => n === faltam && !jaEnviados.has(label)).map(([label]) => label);
}

// Quem recebe lembrete: todos menos quem respondeu "Não vou" (going === false).
function reminderRecipients(rsvpDocs) {
  return (rsvpDocs || []).filter(r => r.going !== false).map(r => r.personId);
}

module.exports = { daysBetween, dueReminderOffsets, reminderRecipients };
