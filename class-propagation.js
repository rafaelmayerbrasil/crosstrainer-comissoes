// class-propagation.js — lógica pura: quais aulas de um slot editado atualizar.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ClassPropagation = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // novoSlot: { teacherId, modalityId, startTime, endTime, durationMinutes }
  // existingClasses: [{ id, status, monthClosingId, dateISO }]  (dateISO 'YYYY-MM-DD')
  // Retorna { updates: [{classId, patch}], eligibleCount } — só das aulas INTOCADAS:
  //   status 'prevista' + sem monthClosingId + dateISO >= hojeISO.
  function planClassUpdatesForSlot(novoSlot, existingClasses, hojeISO) {
    const updates = [];
    (existingClasses || []).forEach(c => {
      const intocada = c.status === 'prevista' && !c.monthClosingId && String(c.dateISO) >= String(hojeISO);
      if (!intocada) return;
      updates.push({
        classId: c.id,
        patch: {
          teacherId: novoSlot.teacherId,
          originalTeacherId: novoSlot.teacherId,
          modalityId: novoSlot.modalityId,
          startTime: novoSlot.startTime,
          endTime: novoSlot.endTime,
          durationMinutes: novoSlot.durationMinutes,
        },
      });
    });
    return { updates, eligibleCount: updates.length };
  }

  return { planClassUpdatesForSlot };
});
