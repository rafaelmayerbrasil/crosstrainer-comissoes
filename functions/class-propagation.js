// class-propagation.js — lógica pura: quais aulas de um slot editado atualizar.
// GEMEO: class-propagation.js na raiz (usado pelo navegador). Esta copia existe
// porque o deploy das Functions so leva a pasta functions/.
// smoke-class-propagation.js compara o comportamento das duas e falha se divergirem.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ClassPropagation = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // "Intocada" = ninguém mexeu nela e ela ainda vai acontecer.
  // Definição ÚNICA do sistema: quem quiser mexer em aula gerada passa por aqui.
  //   c: { status, monthClosingId, dateISO }  ·  hojeISO: 'YYYY-MM-DD' (fuso BR)
  function isUntouchedClass(c, hojeISO) {
    if (!c) return false;
    return c.status === 'prevista'
        && !c.monthClosingId
        && String(c.dateISO) >= String(hojeISO);
  }

  // novoSlot: { teacherId, modalityId, startTime, endTime, durationMinutes }
  // existingClasses: [{ id, status, monthClosingId, dateISO }]  (dateISO 'YYYY-MM-DD')
  // Retorna { updates: [{classId, patch}], eligibleCount } — só das aulas INTOCADAS.
  function planClassUpdatesForSlot(novoSlot, existingClasses, hojeISO) {
    const updates = [];
    (existingClasses || []).forEach(c => {
      if (!isUntouchedClass(c, hojeISO)) return;
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

  return { isUntouchedClass, planClassUpdatesForSlot };
});
