// class-propagation.js — lógica pura: quais aulas de um slot editado atualizar.
// GEMEO: functions/class-propagation.js — o deploy das Functions so leva a pasta
// functions/, entao existe uma copia la. smoke-class-propagation.js compara o
// comportamento das duas e falha se divergirem.
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

  // A aula de HOJE que já terminou não deve nascer.
  // Cenário real (13/08/2026): mover um horário às 13h fazia o gerador criar a
  // aula das 07:00 de hoje — que nunca aconteceu como aula daquele dia, e ainda
  // assim entraria na conta de horas do mês.
  // Compara pelo FIM, não pelo início: aula em andamento ainda deve existir,
  // senão o professor que está dando aula agora fica sem onde registrar.
  // Vale só para HOJE — dia futuro nunca é pulado, dia passado não é assunto daqui.
  //   dateISO/hojeISO: 'YYYY-MM-DD' (BR) · endTime/agoraHHMM: 'HH:MM' (24h, BR)
  function hasAlreadyEndedToday(dateISO, endTime, hojeISO, agoraHHMM) {
    if (String(dateISO) !== String(hojeISO)) return false;
    if (!endTime || !agoraHHMM) return false;   // sem dado, não arrisca: cria
    return String(endTime) <= String(agoraHHMM);
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

  return { isUntouchedClass, hasAlreadyEndedToday, planClassUpdatesForSlot };
});
