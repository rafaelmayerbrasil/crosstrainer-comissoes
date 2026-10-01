// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Quais aulas a grade deve gerar (puro, sem Firestore)
//
// Recebe os horários da grade e a janela de datas; devolve os pares
// (horário, dia) que devem virar aula, já sem os dias de férias, os dias que
// pertencem a uma escala e a aula de hoje que já acabou.
//
// Vive em arquivo próprio para poder ser TESTADO rodando de verdade
// (scripts/smoke-gerador-nao-trava.js). Enquanto morava dentro da Cloud
// Function, só a regra "de quem é o dia" tinha teste — o laço, não.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const classPropagation = require('./class-propagation.js');
const escalaDia = require('./escala-dia.js');

// ─── Datas em horário de Brasília (UTC-3, sem horário de verão desde 2019) ───
const BR_OFFSET_HOURS = 3;
const BR_OFFSET_MS = BR_OFFSET_HOURS * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** O instante UTC que corresponde a (ano, mês 0-11, dia, 00:00) em Brasília. */
function brMidnightUTC(year, month, day) {
  return new Date(Date.UTC(year, month, day, BR_OFFSET_HOURS, 0, 0));
}
/** Ano, mês, dia e dia da semana de uma Date, em Brasília. */
function brComponents(date) {
  const shifted = new Date(date.getTime() - BR_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),       // 0-11
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),       // 0=Dom..6=Sáb
  };
}
/** YYYYMMDD em Brasília. */
function ymdFromDateBR(d) {
  const c = brComponents(d);
  return `${c.year}${String(c.month + 1).padStart(2, '0')}${String(c.day).padStart(2, '0')}`;
}
/** YYYY-MM-DD em Brasília. */
function ymdISOFromDateBR(d) {
  const c = brComponents(d);
  return `${c.year}-${String(c.month + 1).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
}
/** Fim da janela: `semanas` semanas depois do início, até 23:59:59 do último dia. */
function fimDaJanela(inicio, semanas) {
  return new Date(inicio.getTime() + (semanas * 7 * ONE_DAY_MS) + ONE_DAY_MS - 1);
}

/**
 * Os pares (horário da grade, dia) que devem virar aula na janela.
 *
 * 🚨 O laço dos dias é um `for`, e isso é de propósito. Era um `while` com o
 * avanço do dia escrito à mão antes de cada `continue`; a correção de
 * 24/08/2026 (dia de escala não é da grade) acrescentou um `continue` e
 * esqueceu o avanço. O gerador ficou preso no primeiro sábado escalado até o
 * tempo limite, toda segunda-feira, de 31/08 a 01/10 — cinco semanas sem gerar
 * uma aula, e horário novo da grade nunca virava aula. No `for`, pular o dia
 * não tem como deixar de avançar.
 *
 * @param {object}   p
 * @param {Array}    p.slots                   horários ativos da grade
 * @param {Date}     p.inicio                  00:00 de hoje em Brasília (brMidnightUTC)
 * @param {number}   p.semanas                 quantas semanas à frente
 * @param {Map}      p.feriadosByDate          'YYYY-MM-DD' → feriado nacional
 * @param {Map}      p.scalesByDate            'YYYY-MM-DD_unidade' → escala (escala-dia.js)
 * @param {Map}      p.vacationDatesByTeacher  professor → Set de 'YYYY-MM-DD' em férias
 * @param {string}   p.hojeISO                 hoje em Brasília
 * @param {string}   p.agoraHHMM               hora de agora em Brasília
 * @returns {{candidates:Array, vacationSkipped:number, pastTodaySkipped:number, escalaSkipped:number}}
 */
function comporCandidatos(p) {
  const slots = p.slots || [];
  const inicioMs = p.inicio.getTime();
  const fimMs = fimDaJanela(p.inicio, p.semanas).getTime();
  const feriadosByDate = p.feriadosByDate || new Map();
  const scalesByDate = p.scalesByDate || new Map();
  const vacationDatesByTeacher = p.vacationDatesByTeacher || new Map();
  let vacationSkipped = 0, pastTodaySkipped = 0, escalaSkipped = 0;
  const candidates = [];

  for (const slot of slots) {
    if (slot.weekday == null || !slot.startTime || !slot.endTime) continue;
    const feriasDaPessoa = vacationDatesByTeacher.get(slot.teacherId);

    for (let cursorMs = inicioMs; cursorMs <= fimMs; cursorMs += ONE_DAY_MS) {
      const cursor = new Date(cursorMs);
      if (brComponents(cursor).weekday !== slot.weekday) continue;
      const ymdStr = ymdISOFromDateBR(cursor);

      // Professor de férias nesse dia (Sprint 6a)
      if (feriasDaPessoa && feriasDaPessoa.has(ymdStr)) { vacationSkipped++; continue; }

      // Aula de HOJE que já terminou não nasce (decisão do Rafael, 13/08/2026).
      // Sem isso, mover um horário às 13h criava a aula das 07:00 de hoje, que
      // nunca aconteceu — e entrava na conta de horas do mês. O cron das
      // segundas 02:00 não é afetado: às 2 da manhã nenhuma aula do dia terminou.
      if (classPropagation.hasAlreadyEndedToday(ymdStr, slot.endTime, p.hojeISO, p.agoraHHMM)) { pastTodaySkipped++; continue; }

      const feriado = feriadosByDate.get(ymdStr);
      const scale = scalesByDate.get(`${ymdStr}_${slot.unitId}`);

      // Sábado, feriado e domingo especial pertencem à ESCALA: quem trabalha é
      // quem ela escalou, e a grade normal não vale nesse dia (24/08/2026 —
      // 07/09 tinha 78 aulas de segunda-feira comum, e cada sábado tinha dois
      // professores por modalidade).
      if (escalaDia.ehDonaDoDia(scale)) { escalaSkipped++; continue; }

      candidates.push({
        slotId: slot.id, slot, date: cursor,
        classId: `${slot.id}_${ymdFromDateBR(cursor)}`,
        extras: {
          isHoliday: !!feriado || !!(scale && scale.scaleTypeId === 'feriado'),
          holidayName: (feriado && feriado.name) || (scale && scale.scaleTypeId === 'feriado' ? scale.name : null),
          holidayType: (feriado && feriado.type) || null,
          specialScaleType: scale ? scale.scaleTypeId : (feriado ? 'feriado' : null),
          specialScaleId: scale ? scale.id : null,
        },
      });
    }
  }
  return { candidates, vacationSkipped, pastTodaySkipped, escalaSkipped };
}

module.exports = { brMidnightUTC, brComponents, ymdFromDateBR, ymdISOFromDateBR, fimDaJanela, comporCandidatos, ONE_DAY_MS, BR_OFFSET_HOURS, BR_OFFSET_MS };
