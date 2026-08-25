// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Cloud Functions Entry Point
// Módulo de Professores
//
// Funções implementadas:
//   ✅ healthCheck ............................. Sprint 0-B
//   ✅ generateClassesForUpcomingWeeks (cron) .. Sprint 3a
//   ✅ generateClassesManual (callable) ........ Sprint 3a
//   ✅ moveSlotClasses (callable) .............. 13/08/2026
//
// Próximas:
//   - processSubstitutionAcceptance ............ Sprint 3b
//   - closeMonth ............................... Sprint 4
//   - calculatePayment ......................... Sprint 4
//   - generateReceipt .......................... Sprint 4
//   - autoAllocateSpecialScale ................. Sprint 5
//   - checkVacationAlerts (cron) ............... Sprint 6
//   - sendNotification (Firestore trigger) ..... Sprint 7
// ═══════════════════════════════════════════════════════════════════════

const admin = require('firebase-admin');
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const remindersUtil = require('./reminders-util.js');
const internBank = require('./intern-hour-bank.js');
const classPropagation = require('./class-propagation.js');
const emailConfig = require('./email-config.js');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = () => admin.firestore();

// ─── Healthcheck ──────────────────────────────────────────────────────
exports.healthCheck = onRequest({ invoker: 'public' }, (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    project: process.env.GCLOUD_PROJECT || 'unknown',
    nodeVersion: process.version,
    message: 'CrossTainer Cloud Functions ativas'
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SPRINT 3a — GERAÇÃO DE INSTÂNCIAS DE AULA (classes)
// ═══════════════════════════════════════════════════════════════════════
//
// Estratégia:
//   1. Lista todos schedule_slots ativos
//   2. Para cada slot, calcula as próximas N semanas de datas em que
//      weekday(data) === slot.weekday
//   3. Compõe classId = `${slotId}_${YYYYMMDD}` (idempotência: re-rodar
//      não cria duplicata)
//   4. Verifica em batches quais classIds já existem; cria só os que faltam
//
// Performance: cresce com (slots × semanas). Pra 100 slots × 8 semanas:
//   - ~800 classes potenciais por execução
//   - reads via .where(documentId, 'in', [...]) em batches de 30
//   - writes via batched .set() em batches de 400 (limite Firestore: 500)
// ─────────────────────────────────────────────────────────────────────

// ─── Helpers de timezone BR (UTC-3, sem DST desde 2019) ────────────────
// Bug D corrigido em 18/05/2026: a CF rodava em UTC e usava .getDate()/.getDay()
// que retornavam dia/weekday UTC. Como admin define agenda em BR, isso causava
// classes geradas pra Sexta UTC (= Quinta 21h BR) quando o admin queria Sexta BR.
// Fix: toda lógica de iteração agora é em "BR midnight" representado como UTC+3h.

const BR_OFFSET_HOURS = 3;
const BR_OFFSET_MS = BR_OFFSET_HOURS * 60 * 60 * 1000;

/** Retorna o instante UTC que corresponde a (year, month, day, 00:00) horário BR. */
function brMidnightUTC(year, month, day) {
  return new Date(Date.UTC(year, month, day, BR_OFFSET_HOURS, 0, 0));
}

/** Componentes BR de uma Date (que pode estar em qualquer fuso). */
function brComponents(date) {
  const shifted = new Date(date.getTime() - BR_OFFSET_MS);
  return {
    year:    shifted.getUTCFullYear(),
    month:   shifted.getUTCMonth(),       // 0-11
    day:     shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),         // 0=Dom..6=Sáb
  };
}

/** YYYYMMDD em BR a partir de uma Date. */
function ymdFromDateBR(d) {
  const c = brComponents(d);
  return `${c.year}${String(c.month + 1).padStart(2, '0')}${String(c.day).padStart(2, '0')}`;
}

/** YYYY-MM-DD em BR a partir de uma Date (formato ISO para comparação). */
function ymdISOFromDateBR(d) {
  const c = brComponents(d);
  return `${c.year}-${String(c.month + 1).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
}

/** HH:MM em BR a partir de uma Date — usado pra saber se a aula de hoje já acabou. */
function hhmmFromDateBR(d) {
  const shifted = new Date(d.getTime() - BR_OFFSET_MS);
  return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
}

// Sprint 6b — recorta período de férias ao mês corrente
function splitVacationAcrossMonth(vacReq, year, month) {
  const monthStart = brMidnightUTC(year, month - 1, 1);
  const monthEnd = brMidnightUTC(year, month, 0);
  monthEnd.setUTCHours(23 + BR_OFFSET_HOURS, 59, 59, 999);

  let daysInMonth = 0;
  const periodsClipped = [];

  for (const p of (vacReq.periods || [])) {
    const ps = p.startDate.toDate();
    const pe = p.endDate.toDate();

    const clipStart = ps < monthStart ? monthStart : ps;
    const clipEnd = pe > monthEnd ? monthEnd : pe;

    if (clipStart > clipEnd) continue;

    // v2.1: Math.floor (não Math.round). clipEnd termina em .999ms do dia BR final,
    // diff/86400000 retorna X.9999... e Math.round inflava em 1 dia.
    const days = Math.floor((clipEnd - clipStart) / 86400000) + 1;
    daysInMonth += days;
    periodsClipped.push({ start: clipStart, end: clipEnd, days });
  }

  if (daysInMonth === 0) return null;

  const paymentCalc = vacReq.payment && vacReq.payment.calculation;

  return {
    vacationRequestId: vacReq.id,
    periodStart: admin.firestore.Timestamp.fromDate(periodsClipped[0].start),
    periodEnd: admin.firestore.Timestamp.fromDate(periodsClipped[periodsClipped.length - 1].end),
    daysInMonth,
    fullPeriodDays: vacReq.totalDays,
    paymentMode: vacReq.payment.mode,
    proportionalValue: vacReq.totalDays > 0
      ? Math.round((vacReq.payment.value * daysInMonth / vacReq.totalDays) * 100) / 100
      : 0,
    // Sprint 6b — campos para exibição no recibo A4
    baseMonthly: paymentCalc ? (paymentCalc.baseMonthly || 0) : 0,
    proportionalBase: paymentCalc ? (paymentCalc.proportionalBase || 0) : 0,
    oneThirdValue: paymentCalc ? (paymentCalc.oneThirdValue || 0) : 0,
  };
}

// ─── Cache de feriados (Sprint 5a) ─────────────────────────────────────
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 dias

async function getFeriadosForYear(year) {
  const firestore = db();
  const cacheRef = firestore.collection('meta').doc(`holidays_cache_${year}`);
  const cacheDoc = await cacheRef.get();

  if (cacheDoc.exists) {
    const data = cacheDoc.data();
    const ageMs = Date.now() - (data.cachedAt?.toMillis() || 0);
    if (ageMs < CACHE_TTL_MS && Array.isArray(data.feriados)) {
      return data.feriados;
    }
  }

  // Fetch da BrasilAPI
  try {
    const resp = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const feriados = json.map(f => ({
      date: f.date,       // 'YYYY-MM-DD'
      name: f.name,
      type: f.type || 'national',
    }));
    await cacheRef.set({
      year, feriados,
      cachedAt: admin.firestore.FieldValue.serverTimestamp(),
      ttl: CACHE_TTL_MS / 1000,
    });
    logger.info(`[getFeriadosForYear] Fetched ${feriados.length} feriados pra ${year}`);
    return feriados;
  } catch (err) {
    logger.error('[getFeriadosForYear] FALHA', err);
    // Se tem cache antigo, usa mesmo expirado (degradação graciosa)
    if (cacheDoc.exists) {
      logger.warn('[getFeriadosForYear] Usando cache expirado pq API falhou');
      return cacheDoc.data().feriados || [];
    }
    return [];
  }
}

// ─── Escalas especiais: leitura única (22/08/2026) ─────────────────────
//
// A consulta era `.where('isActive','==',true)` e exigia `s.unitIds` — o
// formato das "Escalas Especiais" da Sprint 5a. A Escala Inteligente, feita
// depois, grava OUTRO formato: `status: 'consolidada'` e a unidade dentro de
// cada vaga (`slots[].unitId`). Nenhum documento novo tem `isActive` nem
// `unitIds`, então a consulta voltava ZERO: pro gerador, escala nenhuma nunca
// existiu. Resultado em produção — 184 aulas da grade em cima de dias que são
// da escala, incluindo 78 aulas de segunda-feira normal em cada feriado
// nacional (259h que entrariam no fechamento).
//
// Lê os dois formatos porque a coleção tem histórico dos dois.

const escalaDia = require('./escala-dia.js');
const escalaEhDonaDoDia = escalaDia.ehDonaDoDia;

/** Mapa 'YYYY-MM-DD_unitId' → escala normalizada. Regras em escala-dia.js. */
async function carregarEscalasPorDiaUnidade(firestore) {
  const snap = await firestore.collection('special_scales').get();
  return escalaDia.montarMapa(snap.docs.map(d => ({ id: d.id, data: d.data() })));
}

/**
 * Núcleo da geração — reutilizado pela scheduled e pela callable.
 * Toda a iteração de datas e cálculo de weekday é feita em horário BR.
 * @param {object} opts
 * @param {number} opts.weeksAhead — quantas semanas à frente gerar (default 8)
 * @param {boolean} opts.dryRun — se true, não escreve nada e retorna preview
 * @param {string} opts.source — 'cf-scheduled' | 'cf-manual'
 * @returns {{created, skipped, dryRun, sample, slotsScanned, durationMs}}
 */
async function generateClassesCore({ weeksAhead = 8, dryRun = false, source = 'cf-manual' } = {}) {
  const t0 = Date.now();
  const firestore = db();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // Janela em horário BR:
  //   início = hoje em BR 00:00
  //   fim    = hoje + weeksAhead semanas, BR 23:59:59
  const nowComponents = brComponents(new Date());
  const todayBR = brMidnightUTC(nowComponents.year, nowComponents.month, nowComponents.day);
  const endBR = new Date(todayBR.getTime() + (weeksAhead * 7 * 24 * 60 * 60 * 1000) + (24 * 60 * 60 * 1000) - 1);

  // 1) Lista slots ativos
  const slotsSnap = await firestore.collection('schedule_slots').where('isActive', '==', true).get();
  const slots = slotsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // 1b) Monta mapa de feriados nacionais (BrasilAPI + cache)
  const yearsToCheck = new Set();
  const cursorIter = new Date(todayBR);
  while (cursorIter.getTime() <= endBR.getTime()) {
    yearsToCheck.add(brComponents(cursorIter).year);
    cursorIter.setTime(cursorIter.getTime() + ONE_DAY_MS);
  }
  const feriadosByDate = new Map();
  for (const yr of yearsToCheck) {
    const list = await getFeriadosForYear(yr);
    list.forEach(f => feriadosByDate.set(f.date, f));
  }

  // 1c) Busca special_scales que valem (lê os dois formatos — ver o helper)
  const scalesByDate = await carregarEscalasPorDiaUnidade(firestore);

  // 1d) Busca férias/recessos aprovados (Sprint 6a)
  const vacSnap = await firestore.collection('vacation_requests')
    .where('status', '==', 'aprovada').get();
  const vacationDatesByTeacher = new Map();  // teacherId → Set<'YYYY-MM-DD'>
  vacSnap.docs.forEach(d => {
    const v = d.data();
    if (!v.teacherId || !Array.isArray(v.periods)) return;
    if (!vacationDatesByTeacher.has(v.teacherId)) {
      vacationDatesByTeacher.set(v.teacherId, new Set());
    }
    const set = vacationDatesByTeacher.get(v.teacherId);
    v.periods.forEach(p => {
      let cur = p.startDate.toDate();
      const end = p.endDate.toDate();
      while (cur <= end) {
        const c = brComponents(cur);
        const ymd = `${c.year}-${String(c.month + 1).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
        set.add(ymd);
        cur = new Date(cur.getTime() + 86400000);
      }
    });
  });

  let vacationSkippedCount = 0;
  let pastTodaySkippedCount = 0;
  let escalaSkippedCount = 0;   // dia que pertence a uma escala (sábado/feriado)

  // Referência de "agora" em BR, pra não criar aula de hoje que já terminou.
  const agoraBR = new Date();
  const hojeISO = ymdISOFromDateBR(agoraBR);
  const agoraHHMM = hhmmFromDateBR(agoraBR);

  // 2) Compõe todos os pares (slot, data) candidatos — iterando em dias BR
  const candidates = [];   // [{ slotId, slot, date, classId, extras }]
  for (const slot of slots) {
    if (slot.weekday == null || !slot.startTime || !slot.endTime) continue;
    let cursorMs = todayBR.getTime();
    while (cursorMs <= endBR.getTime()) {
      const cursor = new Date(cursorMs);
      const c = brComponents(cursor);
      if (c.weekday === slot.weekday) {
        // Sprint 6a — pula se professor está de férias nesse dia
        const ymdStr = ymdISOFromDateBR(cursor);
        const teacherVacations = vacationDatesByTeacher.get(slot.teacherId);
        if (teacherVacations && teacherVacations.has(ymdStr)) {
          vacationSkippedCount++;
          cursorMs += ONE_DAY_MS;
          continue;
        }

        // Aula de HOJE que já terminou não nasce (decisão do Rafael, 13/08/2026).
        // Sem isso, mover um horário às 13h criava a aula das 07:00 de hoje, que
        // nunca aconteceu — e entrava na conta de horas do mês como se tivesse
        // acontecido. O cron das segundas 02:00 não é afetado: às 2 da manhã
        // nenhuma aula do dia terminou ainda.
        if (classPropagation.hasAlreadyEndedToday(ymdStr, slot.endTime, hojeISO, agoraHHMM)) {
          pastTodaySkippedCount++;
          cursorMs += ONE_DAY_MS;
          continue;
        }

        const classId = `${slot.id}_${ymdFromDateBR(cursor)}`;
        const feriado = feriadosByDate.get(ymdStr);
        const scale = scalesByDate.get(`${ymdStr}_${slot.unitId}`);

        // Sábado, feriado e domingo especial pertencem à ESCALA: quem trabalha
        // é quem ela escalou, e a grade normal não vale nesse dia. Antes a
        // escala só servia de etiqueta e a grade era gerada do mesmo jeito —
        // por isso 07/09 (feriado) tinha 78 aulas de segunda-feira comum
        // agendadas, e cada sábado tinha 2 professores por modalidade.
        if (escalaEhDonaDoDia(scale)) {
          escalaSkippedCount++;
          continue;
        }

        const extras = {
          isHoliday: !!feriado || (scale && scale.scaleTypeId === 'feriado'),
          holidayName: (feriado && feriado.name) || (scale && scale.scaleTypeId === 'feriado' ? scale.name : null),
          holidayType: (feriado && feriado.type) || null,
          specialScaleType: scale ? scale.scaleTypeId : (feriado ? 'feriado' : null),
          specialScaleId: scale ? scale.id : null,
        };

        candidates.push({ slotId: slot.id, slot, date: cursor, classId, extras });
      }
      cursorMs += ONE_DAY_MS;
    }
  }

  if (candidates.length === 0) {
    return {
      created: 0, skipped: 0, dryRun, sample: [],
      slotsScanned: slots.length, durationMs: Date.now() - t0,
    };
  }

  // 3) Verifica quais já existem — batches de 30 IDs (limite do `in`)
  const existingIds = new Set();
  const CHUNK = 30;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    const ids = chunk.map(c => c.classId);
    const snap = await firestore.collection('classes')
      .where(admin.firestore.FieldPath.documentId(), 'in', ids)
      .get();
    snap.docs.forEach(d => existingIds.add(d.id));
  }

  // 4) Filtra os que precisam ser criados
  const toCreate = candidates.filter(c => !existingIds.has(c.classId));
  const sample = toCreate.slice(0, 5).map(c => ({
    classId: c.classId,
    date: ymdFromDateBR(c.date),
    weekday: c.slot.weekday,
    startTime: c.slot.startTime,
  }));

  // 5) Em dry-run, retorna preview
  if (dryRun) {
    return {
      created: 0,
      skipped: existingIds.size,
      wouldCreate: toCreate.length,
      vacationSkipped: vacationSkippedCount,
      pastTodaySkipped: pastTodaySkippedCount,
    escalaSkipped: escalaSkippedCount,
      dryRun: true,
      sample,
      slotsScanned: slots.length,
      durationMs: Date.now() - t0,
    };
  }

  // 6) Cria em batches de 400 (Firestore limit é 500, deixo margem)
  const BATCH_LIMIT = 400;
  let batch = firestore.batch();
  let inBatch = 0;
  const commits = [];

  for (const c of toCreate) {
    const data = {
      slotId: c.slotId,
      templateId: c.slot.templateId || null,
      unitId: c.slot.unitId,
      teacherId: c.slot.teacherId,
      originalTeacherId: c.slot.teacherId,
      modalityId: c.slot.modalityId,
      scheduledDate: admin.firestore.Timestamp.fromDate(c.date),
      startTime: c.slot.startTime,
      endTime: c.slot.endTime,
      durationMinutes: c.slot.durationMinutes || 0,

      status: 'prevista',
      isHoliday: c.extras.isHoliday || false,
      holidayName: c.extras.holidayName || null,
      holidayType: c.extras.holidayType || null,
      specialScaleType: c.extras.specialScaleType || null,
      specialScaleId: c.extras.specialScaleId || null,

      cancellationReason: null,
      cancellationNote: null,
      adjustedBy: null,
      adjustedAt: null,
      adjustmentNote: null,

      monthClosingId: null,

      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      generatedBy: source,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    batch.set(firestore.collection('classes').doc(c.classId), data);
    inBatch++;
    if (inBatch >= BATCH_LIMIT) {
      commits.push(batch.commit());
      batch = firestore.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) commits.push(batch.commit());
  await Promise.all(commits);

  return {
    created: toCreate.length,
    skipped: existingIds.size,
    vacationSkipped: vacationSkippedCount,
    pastTodaySkipped: pastTodaySkippedCount,
    escalaSkipped: escalaSkippedCount,
    dryRun: false,
    sample,
    slotsScanned: slots.length,
    durationMs: Date.now() - t0,
  };
}

/**
 * Scheduled — roda toda segunda às 02:00 BRT e gera as próximas 8 semanas.
 * Schedule cron: minuto 0, hora 2, dia qualquer, mês qualquer, dia-semana 1 (segunda).
 *
 * 8 semanas (e não 4) por decisão do Rodrigo em 13/08/2026: é o mesmo horizonte
 * da janela de eleição da escala inteligente de sábados e feriados. Se mudar
 * aqui, mudar lá também — os dois horizontes devem continuar batendo.
 */
exports.generateClassesForUpcomingWeeks = onSchedule({
  schedule: '0 2 * * 1',
  timeZone: 'America/Sao_Paulo',
  memory: '256MiB',
  timeoutSeconds: 540,
}, async (event) => {
  logger.info('[generateClassesForUpcomingWeeks] Iniciando geração agendada');
  try {
    const result = await generateClassesCore({
      weeksAhead: 8,
      dryRun: false,
      source: 'cf-scheduled',
    });
    logger.info('[generateClassesForUpcomingWeeks] Concluído', result);
  } catch (err) {
    logger.error('[generateClassesForUpcomingWeeks] FALHA', err);
    throw err;
  }
});

/**
 * Callable — admin pode chamar manualmente via console JS:
 *   const fn = firebase.functions().httpsCallable('generateClassesManual');
 *   const res = await fn({ weeksAhead: 8, dryRun: true });
 *   console.log(res.data);
 *
 * Validação: caller precisa ter profile 'admin' ou 'admin_gestao' em users/{uid}.
 */
exports.generateClassesManual = onCall({
  memory: '256MiB',
  timeoutSeconds: 540,
}, async (request) => {
  // Auth
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'É preciso estar autenticado.');
  }

  // Verifica se é admin (lê users/{uid})
  const userDoc = await db().collection('users').doc(request.auth.uid).get();
  if (!userDoc.exists) {
    throw new HttpsError('permission-denied', 'Usuário sem perfil cadastrado.');
  }
  const userData = userDoc.data();
  const profiles = userData.profiles || (userData.role ? [userData.role] : []);
  const isAdmin = profiles.includes('admin') || profiles.includes('admin_gestao');
  if (!isAdmin) {
    throw new HttpsError('permission-denied', 'Apenas admin/gestão pode disparar geração manual.');
  }

  // Params
  const data = request.data || {};
  const weeksAhead = Number.isFinite(data.weeksAhead) && data.weeksAhead > 0 && data.weeksAhead <= 52
    ? Math.floor(data.weeksAhead)
    : 8;
  const dryRun = data.dryRun === true;

  logger.info('[generateClassesManual] Chamado por', request.auth.uid, { weeksAhead, dryRun });

  try {
    const result = await generateClassesCore({
      weeksAhead,
      dryRun,
      source: 'cf-manual',
    });
    logger.info('[generateClassesManual] Concluído', result);
    return result;
  } catch (err) {
    logger.error('[generateClassesManual] FALHA', err);
    throw new HttpsError('internal', err.message || 'Falha na geração');
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Troca de dia da semana de um slot — move as aulas futuras intocadas
// ═══════════════════════════════════════════════════════════════════════
//
// Por que APAGAR E REGERAR em vez de mudar a data das aulas existentes:
// o classId embute a data (`${slotId}_${YYYYMMDD}`). Alterar a data por dentro
// deixaria o id inconsistente com o conteúdo, e a geração — que é idempotente
// POR ESSE ID — criaria uma segunda aula na data nova. Duplicata garantida.
//
// Por que NO SERVIDOR: a rule de `classes` só permite delete de aula de escala
// especial, de propósito (proteção do fechamento). Em vez de afrouxar a rule,
// a operação roda aqui com Admin SDK, restrita a admin.
//
// De brinde, regerar pelo generateClassesCore mantém feriado, escala especial
// e férias sendo respeitados — mover na mão exigiria reimplementar tudo isso.
exports.moveSlotClasses = onCall({
  memory: '256MiB',
  timeoutSeconds: 540,
  // A função NASCE sem permissão de invocação e responde 401 da infraestrutura
  // (antes de rodar uma linha do nosso código) — foi o que aconteceu no primeiro
  // deploy em staging. Quem protege de verdade é a checagem de admin abaixo,
  // igual às outras callables.
  invoker: 'public',
}, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'É preciso estar autenticado.');
  }
  const userDoc = await db().collection('users').doc(request.auth.uid).get();
  if (!userDoc.exists) {
    throw new HttpsError('permission-denied', 'Usuário sem perfil cadastrado.');
  }
  const userData = userDoc.data();
  const profiles = userData.profiles || (userData.role ? [userData.role] : []);
  if (!profiles.includes('admin') && !profiles.includes('admin_gestao')) {
    throw new HttpsError('permission-denied', 'Apenas admin/gestão pode mover aulas.');
  }

  const data = request.data || {};
  const slotId = String(data.slotId || '').trim();
  const dryRun = data.dryRun === true;
  if (!slotId) throw new HttpsError('invalid-argument', 'slotId obrigatório.');

  const t0 = Date.now();
  const firestore = db();

  const slotDoc = await firestore.collection('schedule_slots').doc(slotId).get();
  if (!slotDoc.exists) throw new HttpsError('not-found', 'Slot não encontrado.');

  const hojeISO = ymdISOFromDateBR(new Date());
  const snap = await firestore.collection('classes').where('slotId', '==', slotId).get();

  const paraApagar = [];
  let skipped = 0;
  snap.docs.forEach(d => {
    const c = d.data();
    const dt = c.scheduledDate && c.scheduledDate.toDate ? c.scheduledDate.toDate() : new Date(c.scheduledDate);
    const alvo = {
      status: c.status,
      monthClosingId: c.monthClosingId || null,
      dateISO: ymdISOFromDateBR(dt),
    };
    if (classPropagation.isUntouchedClass(alvo, hojeISO)) paraApagar.push(d.id);
    else skipped++;
  });

  if (dryRun) {
    return { deleted: paraApagar.length, created: 0, skipped, dryRun: true, durationMs: Date.now() - t0 };
  }

  const BATCH_LIMIT = 400;
  for (let i = 0; i < paraApagar.length; i += BATCH_LIMIT) {
    const batch = firestore.batch();
    paraApagar.slice(i, i + BATCH_LIMIT).forEach(id => batch.delete(firestore.collection('classes').doc(id)));
    await batch.commit();
  }
  logger.info('[moveSlotClasses] apagadas', { slotId, deleted: paraApagar.length, skipped });

  const gen = await generateClassesCore({ weeksAhead: 8, dryRun: false, source: 'cf-move-slot' });
  logger.info('[moveSlotClasses] regerado', { slotId, created: gen.created });

  return {
    deleted: paraApagar.length,
    created: gen.created,
    skipped,
    dryRun: false,
    durationMs: Date.now() - t0,
  };
});

// ═══════════════════════════════════════════════════════════════════════
// SPRINT 3b — SUBSTITUIÇÕES + COBERTURA + NOTIFICAÇÕES
// ═══════════════════════════════════════════════════════════════════════

const NOTIF_TYPE_TITLES = {
  substitution_requested:       'Pedido de substituição',
  substitution_aguardando_gestao: 'Troca esperando você',
  // "Aceita" era o vocabulário de quando o aceite do colega já valia. Agora quem
  // dá a palavra final é a gestão, e a tela toda fala "confirmada" — o título
  // tinha ficado para trás (22/08/2026).
  substitution_accepted:  'Troca confirmada',
  substitution_rejected:  'Substituição recusada',
  substitution_cancelled: 'Substituição cancelada',
  coverage_available:     'Cobertura disponível',
  coverage_taken:         'Cobertura aceita',
  coverage_cancelled:     'Cobertura cancelada',
  event_reminder:         'Lembrete de evento',
  vacation_requested:     'Nova solicitação de férias',
  vacation_cancelled:     'Pedido de férias cancelado',
};

/** Admins/gestão que devem receber avisos de férias. Só CF chama (lê /users). */
async function listAdminUserIds() {
  // 'supervisao' entrou em 21/08/2026: quem é só supervisão homologa troca de
  // professor e aprova férias, mas nunca era avisado — a lista ficou parada no
  // 'admin_gestao', que foi dropado em 11/06/2026. Mantido aqui só pra não
  // deixar cair aviso de doc antigo que ainda tenha o perfil velho.
  const snap = await db().collection('users')
    .where('profiles', 'array-contains-any', ['admin', 'admin_gestao', 'supervisao'])
    .get();
  return [...new Set(snap.docs.map(d => d.id))];
}

async function createNotification({ recipientUserId, type, body, link = null }) {
  if (!recipientUserId || !type) return;
  await db().collection('notifications').add({
    recipientUserId,
    type,
    title: NOTIF_TYPE_TITLES[type] || 'Notificação',
    body: body || '',
    link,
    isRead: false,
    readAt: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * processSubstitutionAcceptance — trigger Firestore.
 * Dispara quando substitutions/{subId} é atualizado e status muda pra 'accepted'.
 * Atualiza classes/{classId}.teacherId + status='substituida' + notifica titular.
 */
exports.processSubstitutionAcceptance = onDocumentUpdated({
  document: 'substitutions/{subId}',
  region: 'us-central1',
}, async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!before || !after) return;
  if (before.status === after.status) return;

  const subId = event.params.subId;

  // Degrau novo (21/08/2026): os dois professores concordaram, falta a gestão.
  // O aviso sai daqui porque o navegador do professor não pode varrer /users —
  // foi exatamente isso que engoliu os pedidos de férias em agosto.
  if (after.status === 'aguardando_gestao') {
    try {
      const admins = await listAdminUserIds();
      for (const userId of admins) {
        await createNotification({
          recipientUserId: userId,
          type: 'substitution_aguardando_gestao',
          body: 'Uma troca de professor foi confirmada pelos dois e espera você. Confirme em Substituições.',
          link: { type: 'substitution', id: subId },
        });
      }
      logger.info('[processSubstitutionAcceptance] Gestão avisada', admins.length, subId);
    } catch (err) {
      // Não relança: o pedido está gravado e vale. Falhar aqui só perde o aviso.
      logger.error('[processSubstitutionAcceptance] FALHA ao avisar gestão', subId, err);
    }
    return;
  }

  if (after.status !== 'accepted') return;

  logger.info('[processSubstitutionAcceptance] Processing accepted sub', subId);

  try {
    const firestore = db();
    const classRef = firestore.collection('classes').doc(after.classId);
    await firestore.runTransaction(async (txn) => {
      const classDoc = await txn.get(classRef);
      if (!classDoc.exists) throw new Error('Class not found: ' + after.classId);
      const cls = classDoc.data();
      if (cls.monthClosingId) throw new Error('Class in closed month, cannot apply substitution');
      txn.update(classRef, {
        teacherId: after.substituteTeacherId,
        status: 'substituida',
        adjustedBy: after.updatedBy || null,
        adjustedAt: admin.firestore.FieldValue.serverTimestamp(),
        adjustmentNote: after.semConfirmacaoDoProfessor
          ? `Troca confirmada pela gestão sem a resposta do professor (sub:${subId})`
          : `Troca confirmada pela gestão (sub:${subId})`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    // Avisa os dois lados: quem registrou e quem confirmou.
    const avisados = [after.requestingUserId, after.substituteUserId].filter(Boolean);
    for (const userId of new Set(avisados)) {
      await createNotification({
        recipientUserId: userId,
        type: 'substitution_accepted',
        body: 'A troca de professor foi confirmada pela gestão. A aula já está no nome certo.',
        link: { type: 'class', id: after.classId },
      });
    }
    logger.info('[processSubstitutionAcceptance] OK', subId);
  } catch (err) {
    logger.error('[processSubstitutionAcceptance] FALHA', err);
  }
});

/**
 * notifyTeachersAboutCoverage — trigger Firestore.
 * Dispara quando coverage_applications/{covId} é criada.
 * Busca professores ativos com modalidade compatível e cria 1 notificação pra cada.
 */
/**
 * onVacationRequested — avisa a gestão que entrou pedido de férias/recesso.
 *
 * Isso era feito no navegador, mas a regra de /users só deixa cada um ler o
 * próprio doc: pro professor a varredura por admins estourava permissão DEPOIS
 * de gravar o pedido. A tela mostrava erro num pedido que tinha dado certo, a
 * pessoa clicava de novo, e a gestão não recebia aviso nenhum (12/08/2026 —
 * Benny travado, Leonardo com 5 pedidos idênticos). Aqui roda com Admin SDK.
 */
/**
 * onNotificationCreated — o aviso do sino também vira e-mail, quando for o caso.
 *
 * Liga num lugar só: todo aviso do sistema passa por `notifications`, então não
 * precisa mexer em nenhuma tela nem em nenhum outro gatilho. As regras de QUAIS
 * tipos viram e-mail e COMO fica o texto vivem em email-config.js (puro,
 * testado em scripts/smoke-email.js).
 *
 * Quem envia de fato é a extensão do Firebase lendo a coleção `mail`. Aqui só
 * se escreve o pedido.
 *
 * Nasce DESLIGADO: sem `meta/email_config` com `ativo: true`, não sai nada.
 * E com `modoTeste`, tudo é desviado pra um endereço só — e-mail alcança gente
 * de verdade e não tem desfazer.
 */
exports.onNotificationCreated = onDocumentCreated({
  document: 'notifications/{notifId}',
  region: 'us-central1',
}, async (event) => {
  const notif = event.data && event.data.data();
  if (!notif) return;

  try {
    const firestore = db();
    const cfgDoc = await firestore.collection('meta').doc('email_config').get();
    const cfg = cfgDoc.exists ? cfgDoc.data() : null;

    if (!emailConfig.deveEnviar(notif, cfg)) return;
    if (!notif.recipientUserId) return;

    // E-mail de quem vai receber: o de LOGIN, que é o que a pessoa usa e
    // reconhece. O da ficha pode ser outro — 4 professores estavam assim em
    // 24/08/2026, e um deles nem existia como caixa. [[ficha-nao-e-login]]
    let email = null, nome = null;
    try {
      const u = await admin.auth().getUser(notif.recipientUserId);
      email = u.email || null;
      nome = u.displayName || null;
    } catch (e) { /* sem conta de auth: cai no /users abaixo */ }

    const uDoc = await firestore.collection('users').doc(notif.recipientUserId).get();
    if (uDoc.exists) {
      const u = uDoc.data();
      email = email || u.email || null;
      nome = nome || u.name || null;
    }

    const msg = emailConfig.montarEmail(notif, { nome, email }, cfg);
    if (!msg) {
      logger.info('[onNotificationCreated] sem e-mail utilizável', notif.recipientUserId, notif.type);
      return;
    }

    await firestore.collection('mail').add({
      to: [msg.para],
      message: { subject: msg.subject, text: msg.text, html: msg.html },
      // rastro pra conferir depois qual aviso gerou qual e-mail
      _origem: { notifId: event.params.notifId, type: notif.type, recipientUserId: notif.recipientUserId },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    logger.info('[onNotificationCreated] e-mail enfileirado', notif.type, '→', msg.para);
  } catch (err) {
    // Nunca relança: o aviso do sino já está gravado e vale por si. Falhar aqui
    // só perde o e-mail — não pode derrubar a notificação.
    logger.error('[onNotificationCreated] FALHA ao enfileirar e-mail', err);
  }
});

exports.onVacationRequested = onDocumentCreated({
  document: 'vacation_requests/{reqId}',
  region: 'us-central1',
}, async (event) => {
  const req = event.data && event.data.data();
  if (!req || req.status !== 'pendente') return;
  const reqId = event.params.reqId;
  logger.info('[onVacationRequested] Iniciando', reqId);

  try {
    const admins = await listAdminUserIds();
    const dias = req.totalDays != null ? `${req.totalDays} dias` : 'período a confirmar';
    const quem = req.teacherName || 'Colaborador';
    const tipo = req.type === 'recesso' ? 'recesso' : 'férias';
    for (const userId of admins) {
      await createNotification({
        recipientUserId: userId,
        type: 'vacation_requested',
        body: `${quem} solicitou ${tipo} · ${dias}. Aprove ou recuse em Férias e Recesso.`,
        link: { type: 'vacation', id: reqId },
      });
    }
    logger.info('[onVacationRequested] Avisados', admins.length, 'admin(s) sobre', reqId);
  } catch (err) {
    // Não relança: o pedido já está gravado e vale. Falhar aqui só perderia o aviso.
    logger.error('[onVacationRequested] FALHA ao avisar gestão', reqId, err);
  }
});

/**
 * onVacationCancelled — avisa a gestão quando o PRÓPRIO solicitante cancela.
 *
 * Contrapartida da onVacationRequested: o cliente não pode varrer /users, então
 * esse aviso também sai daqui. Quando quem cancela é a gestão, o aviso vai direto
 * pro solicitante lá no cliente (escrita direcionada, permitida) — e aqui a gente
 * não faz nada pra não notificar duas vezes.
 */
exports.onVacationCancelled = onDocumentUpdated({
  document: 'vacation_requests/{reqId}',
  region: 'us-central1',
}, async (event) => {
  const before = event.data.before.data();
  const after  = event.data.after.data();
  if (!before || !after) return;
  if (before.status === after.status || after.status !== 'cancelada') return;
  // Só o cancelamento feito pelo próprio solicitante precisa de aviso daqui.
  if (!after.cancelledBy || after.cancelledBy !== after.requestedBy) return;

  const reqId = event.params.reqId;
  try {
    const admins = await listAdminUserIds();
    const quem = after.teacherName || 'Colaborador';
    const tipo = after.type === 'recesso' ? 'recesso' : 'férias';
    for (const userId of admins) {
      await createNotification({
        recipientUserId: userId,
        type: 'vacation_cancelled',
        body: `${quem} cancelou o pedido de ${tipo}.`,
        link: { type: 'vacation', id: reqId },
      });
    }
    logger.info('[onVacationCancelled] Avisados', admins.length, 'admin(s) sobre', reqId);
  } catch (err) {
    logger.error('[onVacationCancelled] FALHA ao avisar gestão', reqId, err);
  }
});

exports.notifyTeachersAboutCoverage = onDocumentCreated({
  document: 'coverage_applications/{covId}',
  region: 'us-central1',
}, async (event) => {
  const cov = event.data.data();
  if (!cov || cov.status !== 'open') return;
  const covId = event.params.covId;
  logger.info('[notifyTeachersAboutCoverage] Iniciando', covId);

  try {
    const firestore = db();
    // 1) Busca todos teachers ativos com a modalidade
    const teachersSnap = await firestore.collection('teachers')
      .where('isActive', '==', true)
      .get();
    const eligibleTeachers = teachersSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => Array.isArray(t.modalityIds) && t.modalityIds.includes(cov.modalityId))
      .filter(t => t.id !== cov.requestingTeacherId);  // não notifica o próprio titular

    // 2) Pra cada teacher, descobre o userId (via teacher.userId OU query users.professorId)
    const notifiedUserIds = [];
    for (const t of eligibleTeachers) {
      let userId = t.userId || null;
      if (!userId) {
        try {
          const us = await firestore.collection('users').where('professorId', '==', t.id).limit(1).get();
          if (!us.empty) userId = us.docs[0].id;
        } catch (e) { /* ignore */ }
      }
      if (!userId) continue;

      await createNotification({
        recipientUserId: userId,
        type: 'coverage_available',
        body: `Cobertura disponível (${cov.reason || 'sem motivo informado'})`,
        link: { type: 'coverage', id: covId },
      });
      notifiedUserIds.push(userId);
    }

    // 3) Registra no doc da cobertura quem foi notificado
    await firestore.collection('coverage_applications').doc(covId).update({
      notifiedUserIds,
    });

    logger.info('[notifyTeachersAboutCoverage] Notificados', notifiedUserIds.length, 'professores', covId);
  } catch (err) {
    logger.error('[notifyTeachersAboutCoverage] FALHA', err);
  }
});

/**
 * sendEventReminders — CF agendada (diária). Lembra o staff de eventos a 7/4/1 dia,
 * exceto quem respondeu "Não vou". Idempotente via special_scales.remindersSent.
 */
// ═══════════════════════════════════════════════════════════════════════
// REGISTRO AUTOMÁTICO DA AULA DADA
//
// A aula vira 'realizada' sozinha DEPOIS que o horário passou. A gestão só
// lança o que fugiu do normal (falta, atraso, saída antecipada, hora extra).
//
// Por quê: até 07/08/2026 havia 383 aulas passadas e 382 ainda 'prevista' —
// ninguém nunca marcou nenhuma. O fechamento só conta 'realizada'/'substituida',
// então agosto fecharia com 1 aula na academia inteira. Marcar uma a uma, com
// ~75 aulas/dia, é inviável: a ferramenta não servia pro volume.
//
// O cliente aceitou conscientemente a inversão do ônus: antes, silêncio = ninguém
// recebia; agora, silêncio = todos recebem. As travas são a janela de correção
// (livre até fechar o mês) e o próprio fechamento.
// ═══════════════════════════════════════════════════════════════════════

// Antes disso o sistema não estava em uso de verdade — julho fica fora da folha
// (decisão do Rodrigo: "começa a valer de agosto em diante").
const AUTO_CONFIRM_DESDE = '2026-08-01';

/** YYYY-MM-DD (horário BR) de uma Date. */
function brYMD(date) {
  const c = brComponents(date);
  const p = n => String(n).padStart(2, '0');
  return `${c.year}-${p(c.month + 1)}-${p(c.day)}`;
}

/** Dias em que a academia não abriu — a gestão marca na tela. */
async function getDiasSemExpediente() {
  try {
    const doc = await db().collection('scale_config').doc('default').get();
    const arr = doc.exists ? doc.data().diasSemExpediente : null;
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (e) {
    logger.warn('[getDiasSemExpediente] falhou, assumindo nenhum', e.message);
    return new Set();
  }
}

/**
 * Confirma as aulas cujo horário já terminou.
 * Idempotente: só mexe em 'prevista', fora de mês fechado, e nunca no futuro.
 */
async function autoConfirmarAulasCore({ dryRun = false } = {}) {
  const firestore = db();
  const agora = new Date();
  const hojeYMD = brYMD(agora);
  const fechados = await getDiasSemExpediente();

  // Só o passado: pega tudo até ontem, e de hoje só o que já terminou.
  const limite = brMidnightUTC(
    brComponents(agora).year, brComponents(agora).month, brComponents(agora).day + 1);

  const snap = await firestore.collection('classes')
    .where('status', '==', 'prevista')
    .where('scheduledDate', '<', limite)
    .get();

  // brComponents só devolve ano/mês/dia/weekday — a hora vem do mesmo deslocamento.
  const agoraHHMM = (() => {
    const s = new Date(agora.getTime() - BR_OFFSET_MS);
    return `${String(s.getUTCHours()).padStart(2, '0')}:${String(s.getUTCMinutes()).padStart(2, '0')}`;
  })();

  let confirmadas = 0, puladas = { antesDeAgosto: 0, semExpediente: 0, mesFechado: 0, aindaNaoTerminou: 0 };
  const batchWrites = [];

  snap.docs.forEach(d => {
    const c = d.data();
    const dia = c.scheduledDate && c.scheduledDate.toDate ? brYMD(c.scheduledDate.toDate()) : null;
    if (!dia) return;

    if (dia < AUTO_CONFIRM_DESDE) { puladas.antesDeAgosto++; return; }
    if (fechados.has(dia)) { puladas.semExpediente++; return; }
    if (c.monthClosingId) { puladas.mesFechado++; return; }
    // Aula de hoje só conta depois do horário de término
    if (dia === hojeYMD && c.endTime && c.endTime > agoraHHMM) { puladas.aindaNaoTerminou++; return; }

    batchWrites.push({ ref: d.ref, id: d.id });
    confirmadas++;
  });

  if (!dryRun) {
    for (let i = 0; i < batchWrites.length; i += 400) {
      const batch = firestore.batch();
      batchWrites.slice(i, i + 400).forEach(w => batch.update(w.ref, {
        status: 'realizada',
        registroAutomatico: true,   // distingue de "conferido por gente" no relatório
        confirmadaEm: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }));
      await batch.commit();
    }
  }

  logger.info('[autoConfirmarAulas]', { confirmadas, puladas, dryRun });
  return { confirmadas, puladas, dryRun };
}

/** Roda todo dia às 03:00 BR — depois do fim de qualquer aula do dia anterior. */
exports.autoConfirmarAulas = onSchedule({
  schedule: '0 3 * * *',
  timeZone: 'America/Sao_Paulo',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 540,
}, async () => {
  try { await autoConfirmarAulasCore({}); }
  catch (err) { logger.error('[autoConfirmarAulas] FALHA', err); throw err; }
});

/** Disparo manual pela gestão (também serve pra recuperar dias perdidos). */
exports.autoConfirmarAulasManual = onCall({
  memory: '256MiB', timeoutSeconds: 540,
}, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'É preciso estar autenticado.');
  }
  const userDoc = await db().collection('users').doc(request.auth.uid).get();
  if (!userDoc.exists) throw new HttpsError('permission-denied', 'Usuário sem perfil.');
  const u = userDoc.data();
  const profiles = u.profiles || (u.role ? [u.role] : []);
  if (!profiles.includes('admin') && !profiles.includes('supervisao')) {
    throw new HttpsError('permission-denied', 'Apenas gestão pode confirmar aulas em lote.');
  }
  try {
    return await autoConfirmarAulasCore({ dryRun: (request.data || {}).dryRun === true });
  } catch (err) {
    logger.error('[autoConfirmarAulasManual] FALHA', err);
    throw new HttpsError('internal', err.message || 'Falha ao confirmar aulas.');
  }
});

exports.sendEventReminders = onSchedule({
  schedule: '0 9 * * *',
  timeZone: 'America/Sao_Paulo',
  region: 'us-central1',
  memory: '256MiB',
}, async () => {
  const firestore = db();
  const todayISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD
  logger.info('[sendEventReminders] Iniciando', todayISO);
  try {
    const snap = await firestore.collection('special_scales').where('tipo', '==', 'evento').get();
    for (const doc of snap.docs) {
      const ev = doc.data();
      if (typeof ev.date !== 'string') continue;
      const sent = Array.isArray(ev.remindersSent) ? ev.remindersSent : [];
      const due = remindersUtil.dueReminderOffsets(ev.date, todayISO, sent);
      if (!due.length) continue;

      const rsvpSnap = await firestore.collection('event_rsvp').where('scaleId', '==', doc.id).get();
      const recipients = remindersUtil.reminderRecipients(rsvpSnap.docs.map(d => d.data()));
      const faltam = remindersUtil.daysBetween(todayISO, ev.date);
      for (const personId of recipients) {
        if (!personId) continue;
        let userId = null;
        const tDoc = await firestore.collection('teachers').doc(personId).get();
        if (tDoc.exists) userId = tDoc.data().userId || null;
        if (!userId) {
          const us = await firestore.collection('users').where('professorId', '==', personId).limit(1).get();
          if (!us.empty) userId = us.docs[0].id;
        }
        if (!userId) continue;
        await createNotification({
          recipientUserId: userId,
          type: 'event_reminder',
          body: `Lembrete: ${ev.name || 'evento'} em ${faltam} dia(s).`,
          link: { type: 'escala-smart', id: doc.id },
        });
      }
      await firestore.collection('special_scales').doc(doc.id).update({ remindersSent: sent.concat(due) });
      logger.info('[sendEventReminders] Enviado', doc.id, due, 'p/', recipients.length);
    }
  } catch (err) {
    logger.error('[sendEventReminders] FALHA', err);
    throw err;
  }
});

/**
 * processCoveragePick — trigger Firestore.
 * Dispara quando coverage_applications muda status pra 'taken'.
 * Atualiza classes + notifica titular.
 */
exports.processCoveragePick = onDocumentUpdated({
  document: 'coverage_applications/{covId}',
  region: 'us-central1',
}, async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!before || !after) return;
  if (before.status === after.status) return;
  if (after.status !== 'taken') return;

  const covId = event.params.covId;
  logger.info('[processCoveragePick] Processing pick', covId);

  try {
    const firestore = db();
    const classRef = firestore.collection('classes').doc(after.classId);
    await firestore.runTransaction(async (txn) => {
      const classDoc = await txn.get(classRef);
      if (!classDoc.exists) throw new Error('Class not found: ' + after.classId);
      const cls = classDoc.data();
      if (cls.monthClosingId) throw new Error('Class in closed month, cannot apply coverage');
      txn.update(classRef, {
        teacherId: after.pickedByTeacherId,
        status: 'substituida',
        adjustedBy: after.pickedByUserId || null,
        adjustedAt: admin.firestore.FieldValue.serverTimestamp(),
        adjustmentNote: `Cobertura pega (cov:${covId})`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    if (after.requestingUserId) {
      await createNotification({
        recipientUserId: after.requestingUserId,
        type: 'coverage_taken',
        body: 'Sua cobertura foi aceita por outro professor.',
        link: { type: 'class', id: after.classId },
      });
    }
    logger.info('[processCoveragePick] OK', covId);
  } catch (err) {
    logger.error('[processCoveragePick] FALHA', err);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// SPRINT 4a — FECHAMENTO MENSAL (closeMonth)
// ═══════════════════════════════════════════════════════════════════════
//
// Fluxo:
//   1. Admin chama closeMonth({ unitId, year, month }) via callable
//   2. Valida permissão (apenas admin, não admin_gestao — D1)
//   3. Verifica idempotência (monthly_closings já existe?)
//   4. Consolida classes da unidade no mês (realizada + substituida)
//   5. Busca dados de teacher + salary
//   6. Calcula horas e valores (mesma lógica do client-side)
//   7. Cria doc em monthly_closings + batched update em classes
//   8. Audit log
// ──────────────────────────────────────────────────────────────────────

/**
 * closeMonth — callable. Consolida e congela um mês.
 *
 * Permissão: apenas admin (não admin_gestao). D1.
 * Idempotente: se monthly_closings/{unitId}_{year}-{month} já existe, retorna erro.
 *
 * Transação: cria o doc de fechamento via runTransaction (previne race condition).
 * Classes são atualizadas em batches de 400 após a transação.
 */
exports.closeMonth = onCall({
  memory: '512MiB',
  timeoutSeconds: 540,
}, async (request) => {
  // ── Auth ──────────────────────────────────────────────────────────
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'É preciso estar autenticado.');
  }

  const firestore = db();
  const userDoc = await firestore.collection('users').doc(request.auth.uid).get();
  if (!userDoc.exists) {
    throw new HttpsError('permission-denied', 'Usuário sem perfil cadastrado.');
  }

  const userData = userDoc.data();
  const profiles = userData.profiles || (userData.role ? [userData.role] : []);
  // D1 — apenas admin (não admin_gestao)
  if (!profiles.includes('admin')) {
    throw new HttpsError('permission-denied', 'Apenas o Administrador pode fechar um mês.');
  }

  // ── Params ────────────────────────────────────────────────────────
  const reqData = request.data || {};
  const { unitId, year, month } = reqData;

  if (!unitId || !year || !month) {
    throw new HttpsError('invalid-argument', 'unitId, year e month são obrigatórios.');
  }

  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new HttpsError('invalid-argument', 'Ano inválido.');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new HttpsError('invalid-argument', 'Mês inválido (1-12).');
  }

  const closingId = `${unitId}_${year}-${String(month).padStart(2, '0')}`;
  const closingRef = firestore.collection('monthly_closings').doc(closingId);

  logger.info('[closeMonth] Iniciado por', request.auth.uid, { unitId, year, month, closingId });

  try {
    // ── 1) Define intervalo do mês em BR (Bug D) ──────────────────
    // Mesma lógica da CF generateClasses: usa BR midnight representado como UTC+3
    const startDate = brMidnightUTC(year, month - 1, 1);                          // dia 1, 00:00 BR
    const lastDayUTC = new Date(Date.UTC(year, month, 0));                        // último dia do mês, 00:00 UTC
    const endDate = new Date(Date.UTC(
      lastDayUTC.getUTCFullYear(), lastDayUTC.getUTCMonth(), lastDayUTC.getUTCDate(),
      23 + BR_OFFSET_HOURS, 59, 59, 999
    ));

    // lastDayOfMonth movido pra cá (Sprint 6b precisa antes do bloco de férias)
    const lastDayOfMonth = new Date(Date.UTC(year, month, 0, 23 + BR_OFFSET_HOURS, 59, 59, 999));

    // ── 2) Query classes da unidade no intervalo ───────────────────
    const classesSnap = await firestore.collection('classes')
      .where('unitId', '==', unitId)
      .where('scheduledDate', '>=', startDate)
      .where('scheduledDate', '<=', endDate)
      .get();

    const allClasses = classesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // ── 3) Filtra status que contam (D9) ───────────────────────────
    const validClasses = allClasses.filter(c =>
      c.status === 'realizada' || c.status === 'substituida'
    );

    if (validClasses.length === 0) {
      throw new HttpsError('failed-precondition', 'Nenhuma aula realizada/substituída no período para fechar.');
    }

    // ── 4) Extrai teacherIds únicos ─────────────────────────────────
    const teacherIds = [...new Set(validClasses.map(c => c.teacherId).filter(Boolean))];

    // ── 5) Busca teachers ───────────────────────────────────────────
    const teacherMap = {};
    await Promise.all(teacherIds.map(async (tid) => {
      const doc = await firestore.collection('teachers').doc(tid).get();
      if (doc.exists) teacherMap[tid] = { id: doc.id, ...doc.data() };
    }));

    // ── 6) Busca salaries ───────────────────────────────────────────
    const salaryMap = {};
    await Promise.all(teacherIds.map(async (tid) => {
      try {
        const doc = await firestore.collection('teacher_salaries').doc(tid).get();
        if (doc.exists) salaryMap[tid] = { id: doc.id, ...doc.data() };
      } catch (_) { /* ignore */ }
    }));

    // ── 7) Agrupa classes por teacher ───────────────────────────────
    const grouped = {};
    for (const c of validClasses) {
      if (!grouped[c.teacherId]) grouped[c.teacherId] = [];
      grouped[c.teacherId].push(c);
    }

    // ═══════════════════════════════════════════════════════
    // Sprint 6b — busca férias aprovadas do mês
    // ═══════════════════════════════════════════════════════
    const monthStart = brMidnightUTC(year, month - 1, 1);
    const monthEnd = lastDayOfMonth;

    const vacSnap = await firestore.collection('vacation_requests')
      .where('status', '==', 'aprovada')
      .where('firstPeriodStart', '<=', monthEnd)
      .get();

    const vacsInMonth = vacSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(v =>
           v.lastPeriodEnd && v.lastPeriodEnd.toDate() >= monthStart
        && v.unitId === unitId
        && v.payment
        && v.payment.value > 0
        && v.payment.mode !== 'deferred'
      );

    // CRÍTICO (D17): garante que professor 100% em férias entre no fechamento
    const vacationOnlyTeacherIds = [...new Set(
      vacsInMonth.map(v => v.teacherId).filter(tid => !teacherIds.includes(tid))
    )];

    // Buscar teachers e salaries pros vacation-only
    for (const tid of vacationOnlyTeacherIds) {
      if (!teacherMap[tid]) {
        const tDoc = await firestore.collection('teachers').doc(tid).get();
        if (tDoc.exists) teacherMap[tid] = { id: tDoc.id, ...tDoc.data() };
      }
      if (!salaryMap[tid]) {
        try {
          const sDoc = await firestore.collection('teacher_salaries').doc(tid).get();
          if (sDoc.exists) salaryMap[tid] = { id: sDoc.id, ...sDoc.data() };
        } catch (_) {}
      }
    }

    // ── 8) Calcula por professor (replica lógica client-side) ──────

    // Carrega special_scale_types pra cálculo de peso (Sprint 5a)
    const stSnap = await firestore.collection('special_scale_types').get();
    const scaleTypesMap = new Map(stSnap.docs.map(d => [d.id, d.data()]));

    const teacherResults = [];
    // (o valor total é somado dos resultados em buildTotals — o banco de horas
    //  altera o valor do estagiário depois deste laço)
    let totalHoras = 0, totalClassesCount = 0;
    let totalCanceladas = 0, totalNaoRealizadas = 0;

    // Conta canceladas/não-realizadas (informativo, não entram no cálculo)
    for (const c of allClasses) {
      if (c.status === 'cancelada') totalCanceladas++;
      if (c.status === 'nao_realizada') totalNaoRealizadas++;
    }

    // Sprint 6b — entries vacation-only (professores sem aulas no mês)
    for (const tid of vacationOnlyTeacherIds) {
      const teacher = teacherMap[tid] || { id: tid, name: '(desconhecido)', type: 'efetivo' };
      teacherResults.push({
        teacherId: tid,
        teacherName: teacher.name || '(desconhecido)',
        teacherType: teacher.type || 'efetivo',
        classesCount: 0,
        totalHoras: 0,
        hourlyRate: 0,
        effectiveDateUsed: null,
        valorHoras: 0, mealAllowance: 0, transportAllowance: 0, otherBenefits: 0,
        totalOutros: 0,
        valorTotal: 0,
        isInternProportional: false,
        internStipendUsed: null,
        internExcessHours: 0,
        internExcessValue: 0,
        isVacationOnly: true,
        vacationDaysInMonth: 0,
        vacationValue: 0,
        vacationDetails: [],
      });
    }

    for (const [tid, classes] of Object.entries(grouped)) {
      const teacher = teacherMap[tid] || { id: tid, name: '(desconhecido)', type: 'efetivo' };
      const salary = salaryMap[tid] || null;

      const hours = calculateTeacherHoursCF(classes, scaleTypesMap);
      const value = calculateTeacherValueCF(teacher, salary, hours, lastDayOfMonth);

      teacherResults.push({
        teacherId: tid,
        teacherName: teacher.name || '(desconhecido)',
        teacherType: teacher.type || 'efetivo',
        classesCount: classes.length,
        totalHoras: hours,
        hourlyRate: value.hourlyRate || 0,
        effectiveDateUsed: value.effectiveDateUsed || null,
        valorHoras: value.valorHoras,
        mealAllowance: value.mealAllowance,
        transportAllowance: value.transportAllowance,
        otherBenefits: value.otherBenefits,
        totalOutros: value.totalOutros,
        valorTotal: value.total,
        isInternProportional: value.isInternProportional,
        internStipendUsed: value.internStipendUsed,
        internExcessHours: value.internExcessHours,
        internExcessValue: value.internExcessValue,
        // Banco de horas (bloco 2): guardados aqui pra a conta ser refeita dentro
        // da transação, já com o saldo lido sem risco de corrida.
        isIntern: value.isIntern === true,
        internLimitHours: value.internLimitHours != null ? value.internLimitHours : null,
        internPropRate: value.internPropRate != null ? value.internPropRate : null,
      });

      totalHoras += hours;
      totalClassesCount += classes.length;
    }

    // Sprint 6b — aplicar férias do mês aos teacherResults
    for (const v of vacsInMonth) {
      const split = splitVacationAcrossMonth(v, year, month);
      if (!split) continue;

      const tResult = teacherResults.find(t => t.teacherId === v.teacherId);
      if (!tResult) {
        logger.warn('[closeMonth] vacation sem teacher correspondente', { vacationId: v.id });
        continue;
      }

      tResult.vacationDaysInMonth = (tResult.vacationDaysInMonth || 0) + split.daysInMonth;
      tResult.vacationValue = Math.round(((tResult.vacationValue || 0) + split.proportionalValue) * 100) / 100;
      tResult.vacationDetails = tResult.vacationDetails || [];
      tResult.vacationDetails.push(split);
    }

    teacherResults.sort((a, b) => a.teacherName.localeCompare(b.teacherName, 'pt'));

    // Totais derivados dos resultados — refeitos depois do banco de horas, que
    // muda o valor pago aos estagiários.
    const diasNoMes = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const buildTotals = (results) => {
      const valor = Math.round(results.reduce((s, t) => s + (t.valorTotal || 0), 0) * 100) / 100;
      const ferias = Math.round(results.reduce((s, t) => s + (t.vacationValue || 0), 0) * 100) / 100;
      return {
        classesRealizadas: totalClassesCount,
        classesSubstituidas: validClasses.filter(c => c.status === 'substituida').length,
        classesCanceladas: totalCanceladas,
        classesNaoRealizadas: totalNaoRealizadas,
        totalHoras: Math.round(totalHoras * 100) / 100,
        totalValor: valor,
        // Sprint 6b — férias
        totalVacationDays: results.reduce((s, t) => s + (t.vacationDaysInMonth || 0), 0),
        totalVacationValue: ferias,
        totalGeral: Math.round((valor + ferias) * 100) / 100,
      };
    };

    // ── 9) Cria monthly_closings (com transação anti-race) ────────
    //
    // BANCO DE HORAS DO ESTAGIÁRIO (bloco 2, 07/08/2026) — dentro da transação
    // porque o saldo é lido e reescrito: duas unidades fechando o mesmo mês ao
    // mesmo tempo não podem ler o mesmo saldo e gravar por cima uma da outra.
    //
    // O saldo só se move no fechamento (decisão do Rodrigo). Reabrir o mês tem
    // que desfazer o movimento — por isso ele fica gravado inteiro, com o saldo
    // de onde partiu.
    const now = admin.firestore.FieldValue.serverTimestamp();
    const mesRef = `${year}-${String(month).padStart(2, '0')}`;
    const internos = teacherResults.filter(t => t.isIntern === true);

    let closingData = null;

    await firestore.runTransaction(async (txn) => {
      const existing = await txn.get(closingRef);
      if (existing.exists) {
        throw new Error('Já existe um fechamento para este período.');
      }

      // ── leituras (todas antes de qualquer escrita) ──
      const bancoRefs = internos.map(t => ({
        teacherId: t.teacherId,
        saldoRef: firestore.collection('intern_hour_balances').doc(t.teacherId),
        movRef: firestore.collection('intern_hour_movements').doc(`${t.teacherId}_${mesRef}`),
      }));
      const bancoSnaps = await Promise.all(bancoRefs.map(async (b) => ({
        ...b,
        saldo: await txn.get(b.saldoRef),
        mov: await txn.get(b.movRef),
      })));

      // ── conta do estagiário (refeita a cada tentativa, sem mutar o original) ──
      const finalResults = teacherResults.map(t => ({ ...t }));
      const escritasBanco = [];

      for (const b of bancoSnaps) {
        const t = finalResults.find(x => x.teacherId === b.teacherId);
        if (!t) continue;

        const saldoAtual = b.saldo.exists ? (b.saldo.data().saldoHoras || 0) : 0;
        const movimento = b.mov.exists ? b.mov.data() : null;

        const conta = internBank.calcularMesEstagiario({
          horas: t.totalHoras,
          limiteHoras: t.internLimitHours,
          stipend: t.internStipendUsed || 0,
          propRate: t.internPropRate,
          diasNoMes,
          diasAfastado: t.vacationDaysInMonth || 0,
          movimento,
          saldoAtual,
        });

        // O que a tela e o recibo mostram: a conta aberta.
        t.valorHoras = conta.valorHoras;
        t.valorTotal = Math.round((conta.valorHoras + (t.mealAllowance || 0)
          + (t.transportAllowance || 0) + (t.totalOutros || 0)) * 100) / 100;
        t.isInternProportional = conta.valorExtra > 0;
        t.internExcessHours = conta.horasPagasAgora;
        t.internExcessValue = conta.valorExtra;
        t.internContratoMes = conta.contratoMes;
        t.internHorasNoMes = conta.horasTrabalhadas;
        t.internSaldoAnterior = conta.saldoAnterior;
        t.internHorasQuitadas = conta.horasQuitadas;
        t.internSaldoFinal = conta.saldoFinal;
        t.internSemContrato = conta.semContrato;
        t.internExplicacao = conta.explicacao;

        escritasBanco.push({ b, conta });
      }

      // O doc de fechamento é legível por qualquer usuário do módulo, então não
      // guarda o contrato nem o valor/hora do estagiário — servem só pra fazer a
      // conta aqui dentro.
      finalResults.forEach(t => { delete t.internLimitHours; delete t.internPropRate; });

      const finalTotals = buildTotals(finalResults);

      closingData = {
        unitId,
        year,
        month,
        status: 'fechado',
        closedAt: now,
        closedBy: request.auth.uid,
        closedByName: userData.name || userData.email || request.auth.uid,
        totals: finalTotals,
        teachers: finalResults,
        createdAt: now,
        updatedAt: now,
      };

      // ── escritas ──
      txn.set(closingRef, closingData);

      for (const { b, conta } of escritasBanco) {
        if (conta.semContrato) continue;  // sem contrato não mexe no saldo

        txn.set(b.saldoRef, {
          teacherId: b.teacherId,
          saldoHoras: conta.saldoFinal,
          ultimoMes: mesRef,
          ultimoFechamentoId: closingId,
          updatedAt: now,
        }, { merge: true });

        txn.set(b.movRef, {
          teacherId: b.teacherId,
          year, month, mes: mesRef,
          horasTrabalhadas: conta.horasTrabalhadas,
          contratoMes: conta.contratoMes,
          saldoAnterior: conta.saldoAnterior,   // pra reabertura conseguir voltar atrás
          horasQuitadas: conta.horasQuitadas,
          horasPagas: conta.horasPagas,
          saldoFinal: conta.saldoFinal,
          diasAfastado: (finalResults.find(x => x.teacherId === b.teacherId) || {}).vacationDaysInMonth || 0,
          closingIds: admin.firestore.FieldValue.arrayUnion(closingId),
          unitIds: admin.firestore.FieldValue.arrayUnion(unitId),
          updatedAt: now,
        }, { merge: true });
      }
    });

    const totals = closingData.totals;
    logger.info('[closeMonth] banco de horas', {
      estagiarios: internos.length,
      saldos: (closingData.teachers || []).filter(t => t.isIntern)
        .map(t => `${t.teacherName}: ${t.internSaldoFinal}h`),
    });

    // ── 10) Batched update nas classes ──────────────────────────────
    const allClassIds = allClasses.map(c => c.id);
    const BATCH_LIMIT = 400;
    const batches = [];
    let batch = firestore.batch();
    let inBatch = 0;

    for (const classId of allClassIds) {
      batch.update(firestore.collection('classes').doc(classId), {
        monthClosingId: closingId,
        updatedAt: now,
      });
      inBatch++;
      if (inBatch >= BATCH_LIMIT) {
        batches.push(batch.commit());
        batch = firestore.batch();
        inBatch = 0;
      }
    }
    if (inBatch > 0) {
      batches.push(batch.commit());
    }
    await Promise.all(batches);

    // Sprint 6b — atualiza paidInClosingIds nos vacation_requests processados
    if (vacsInMonth.length > 0) {
      const vacBatch = firestore.batch();
      for (const v of vacsInMonth) {
        vacBatch.update(firestore.collection('vacation_requests').doc(v.id), {
          paidInClosingIds: admin.firestore.FieldValue.arrayUnion(closingId),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      await vacBatch.commit();
      logger.info('[closeMonth] paidInClosingIds atualizados', { count: vacsInMonth.length });
    }

    logger.info('[closeMonth] Batched update', allClassIds.length, 'classes em', batches.length, 'batches');

    // ── 11) Audit log ───────────────────────────────────────────────
    await firestore.collection('audit_log').add({
      type: 'monthly_closing_created',
      details: `Fechamento ${closingId} criado — ${totals.classesRealizadas} aulas, ${fmtCF(totals.totalValor)}`,
      module: 'fechamento',
      entityType: 'monthly_closing',
      entityId: closingId,
      before: null,
      after: closingData,
      userId: request.auth.uid,
      userName: userData.name || userData.email || request.auth.uid,
      role: profiles.join(','),
      unitId,
      timestamp: now,
    });

    logger.info('[closeMonth] OK', { closingId, totals });

    return {
      success: true,
      closingId,
      totals,
    };
  } catch (err) {
    logger.error('[closeMonth] FALHA', err.message || err);
    if (err instanceof HttpsError) throw err;
    throw new HttpsError(
      err.message && err.message.includes('Já existe') ? 'already-exists' : 'internal',
      err.message || 'Falha ao fechar mês'
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════
// SPRINT 5a — REGENERA CAMPOS DE FERIADO/ESCALA EM CLASSES EXISTENTES
// ═══════════════════════════════════════════════════════════════════════

exports.regenerateClassesWithHolidays = onCall({
  memory: '256MiB',
  timeoutSeconds: 540,
}, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'É preciso estar autenticado.');
  }

  const userDoc = await db().collection('users').doc(request.auth.uid).get();
  if (!userDoc.exists) {
    throw new HttpsError('permission-denied', 'Usuário sem perfil cadastrado.');
  }
  const userData = userDoc.data();
  const profiles = userData.profiles || (userData.role ? [userData.role] : []);
  const isAdmin = profiles.includes('admin') || profiles.includes('admin_gestao') || profiles.includes('supervisao');
  if (!isAdmin) {
    throw new HttpsError('permission-denied', 'Apenas admin/gestão/supervisão pode regenerar.');
  }

  const data = request.data || {};
  const unitId = data.unitId || null;
  const year = data.year || null;
  const month = data.month || null;
  const firestore = db();

  try {
    // 1) Monta mapa de feriados
    const yearsToCheck = new Set();
    if (year) yearsToCheck.add(year);
    else {
      const now = new Date();
      yearsToCheck.add(now.getFullYear());
    }

    const feriadosByDate = new Map();
    for (const yr of yearsToCheck) {
      const list = await getFeriadosForYear(yr);
      list.forEach(f => feriadosByDate.set(f.date, f));
    }

    // 2) Busca special_scales que valem (mesmo leitor da geração)
    const scalesByDate = await carregarEscalasPorDiaUnidade(firestore);

    // 3) Query classes no escopo
    let q = firestore.collection('classes');
    if (unitId) q = q.where('unitId', '==', unitId);
    if (year && month) {
      const start = brMidnightUTC(year, month - 1, 1);
      const end = new Date(brMidnightUTC(year, month, 1).getTime() - 1);
      q = q.where('scheduledDate', '>=', admin.firestore.Timestamp.fromDate(start))
           .where('scheduledDate', '<=', admin.firestore.Timestamp.fromDate(end));
    }
    const snap = await q.get();
    const allClasses = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    logger.info(`[regenerateClassesWithHolidays] ${allClasses.length} classes no escopo`);

    // 4) Para cada classe, recalcula campos de feriado/escala
    let updatedCount = 0;
    const BATCH_LIMIT = 400;
    let batch = firestore.batch();
    let inBatch = 0;
    const commits = [];

    for (const c of allClasses) {
      const dObj = c.scheduledDate && c.scheduledDate.toDate
        ? c.scheduledDate.toDate() : new Date(c.scheduledDate);
      const ymd = ymdISOFromDateBR(dObj);
      const feriado = feriadosByDate.get(ymd);
      const scale = scalesByDate.get(`${ymd}_${c.unitId}`);

      const newHoliday = !!(feriado || (scale && scale.scaleTypeId === 'feriado'));
      const newHolidayName = (feriado && feriado.name) || (scale && scale.scaleTypeId === 'feriado' ? scale.name : null);
      const newHolidayType = (feriado && feriado.type) || null;
      const newScaleType = scale ? scale.scaleTypeId : (feriado ? 'feriado' : null);
      const newScaleId = scale ? scale.id : null;

      // Só atualiza se mudou algo
      if (c.isHoliday !== newHoliday ||
          c.holidayName !== newHolidayName ||
          c.holidayType !== newHolidayType ||
          c.specialScaleType !== newScaleType ||
          c.specialScaleId !== newScaleId) {

        batch.update(firestore.collection('classes').doc(c.id), {
          isHoliday: newHoliday,
          holidayName: newHolidayName,
          holidayType: newHolidayType,
          specialScaleType: newScaleType,
          specialScaleId: newScaleId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        inBatch++;
        updatedCount++;

        if (inBatch >= BATCH_LIMIT) {
          commits.push(batch.commit());
          batch = firestore.batch();
          inBatch = 0;
        }
      }
    }
    if (inBatch > 0) commits.push(batch.commit());
    await Promise.all(commits);

    // 5) Audit log
    await firestore.collection('audit_log').add({
      type: 'classes_holidays_regenerated',
      details: `${updatedCount} classes atualizadas com feriados/escalas`,
      module: 'escalas',
      entityType: 'classes',
      entityId: null,
      before: null,
      after: { updatedCount, unitId, year, month },
      userId: request.auth.uid,
      userName: userData.name || userData.email || request.auth.uid,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info(`[regenerateClassesWithHolidays] ${updatedCount} classes atualizadas`);

    return {
      success: true,
      updatedCount,
      scope: { unitId: unitId || 'todas', year, month },
    };
  } catch (err) {
    logger.error('[regenerateClassesWithHolidays] FALHA', err);
    throw new HttpsError('internal', err.message || 'Falha ao regenerar');
  }
});

// ═══════════════════════════════════════════════════════════════════════
// DESLIGAR / RELIGAR PESSOA
// Faz num único passo o que o app não consegue fazer sozinho: além de
// inativar o professor e marcar users.status, DESABILITA a conta no
// Firebase Auth — que é o que de fato bloqueia o login (só o Admin SDK faz
// isso). Fecha a última ponta do hotfix de segurança de 15/06: um desligado
// deixa de conseguir autenticar. Reversível (religar reativa tudo).
// Chamável só por admin/gestão. O histórico do professor é preservado.
// ═══════════════════════════════════════════════════════════════════════

const OWNER_EMAIL = 'abluir@gmail.com'; // dono do sistema — nunca desligável

exports.setPersonAccess = onCall({
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'É preciso estar autenticado.');
  }
  const callerUid = request.auth.uid;

  // Autorização: só admin/gestão
  const callerDoc = await db().collection('users').doc(callerUid).get();
  if (!callerDoc.exists) {
    throw new HttpsError('permission-denied', 'Usuário sem perfil cadastrado.');
  }
  const callerData = callerDoc.data();
  const callerProfiles = callerData.profiles || (callerData.role ? [callerData.role] : []);
  const isAdmin = callerProfiles.includes('admin') || callerProfiles.includes('admin_gestao');
  if (!isAdmin) {
    throw new HttpsError('permission-denied', 'Apenas admin/gestão pode desligar ou religar pessoas.');
  }

  // Params: teacherId e/ou uid; active=false desliga, true religa
  const data = request.data || {};
  const teacherId = typeof data.teacherId === 'string' && data.teacherId ? data.teacherId : null;
  const uid = typeof data.uid === 'string' && data.uid ? data.uid : null;
  const active = data.active === true;
  if (!teacherId && !uid) {
    throw new HttpsError('invalid-argument', 'Informe teacherId e/ou uid.');
  }

  // Guardas: ninguém desliga a própria conta nem o dono do sistema
  let targetName = null;
  if (uid) {
    if (uid === callerUid) {
      throw new HttpsError('failed-precondition', 'Você não pode desligar a própria conta.');
    }
    const targetDoc = await db().collection('users').doc(uid).get();
    if (targetDoc.exists) {
      const td = targetDoc.data();
      targetName = td.name || td.email || null;
      if ((td.email || '').toLowerCase() === OWNER_EMAIL.toLowerCase()) {
        throw new HttpsError('failed-precondition', 'O dono do sistema não pode ser desligado.');
      }
    }
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const results = { teacher: false, userDoc: false, auth: false };

  try {
    // 1) Professor → isActive (some da agenda/escalas/listas; histórico intacto)
    if (teacherId) {
      const tRef = db().collection('teachers').doc(teacherId);
      const tDoc = await tRef.get();
      if (tDoc.exists) {
        if (!targetName) targetName = tDoc.data().name || null;
        await tRef.update({ isActive: active, updatedAt: now, updatedBy: callerUid });
        results.teacher = true;
      }
    }

    // 2) Perfil de acesso → users.status + Firebase Auth
    if (uid) {
      // 2a) users.status (se o doc existir)
      try {
        await db().collection('users').doc(uid).update({
          status: active ? 'ativo' : 'inativo',
          updatedAt: now,
        });
        results.userDoc = true;
      } catch (e) {
        logger.warn('[setPersonAccess] users.update falhou', uid, e.message);
      }
      // 2b) Auth disable/enable — é o que realmente bloqueia/libera o login
      try {
        await admin.auth().updateUser(uid, { disabled: !active });
        results.auth = true;
      } catch (e) {
        // Professor sem login não tem conta no Auth — não é erro fatal
        if (e.code === 'auth/user-not-found') {
          logger.info('[setPersonAccess] uid sem conta no Auth, nada a bloquear', uid);
        } else {
          throw e;
        }
      }
    }

    // 3) Audit log
    await db().collection('audit_log').add({
      type: active ? 'person_reactivated' : 'person_deactivated',
      details: `Pessoa "${targetName || teacherId || uid}" ${active ? 'religada' : 'desligada'} (prof:${results.teacher} login:${results.auth})`,
      module: 'pessoas',
      entityType: 'person',
      entityId: teacherId || uid,
      before: null,
      after: { teacherId, uid, active, results },
      userId: callerUid,
      userName: callerData.name || callerData.email || callerUid,
      role: callerProfiles.join(','),
      unitId: null,
      timestamp: now,
    });

    logger.info('[setPersonAccess] OK', { teacherId, uid, active, results });
    return { success: true, active, results };
  } catch (err) {
    logger.error('[setPersonAccess] FALHA', err);
    if (err instanceof HttpsError) throw err;
    throw new HttpsError('internal', err.message || 'Falha ao atualizar acesso da pessoa.');
  }
});

// ─── Helpers de cálculo (server-side, replicam professores-shared.js) ──

/**
 * Calcula horas de um array de classes. Feriado conta em dobro (P02).
 */
/**
 * A aula entra na conta de horas do fechamento?
 * Gêmeo de classCountsForPay em professores-shared.js — manter os dois iguais.
 *
 * Escola Interna fica de fora: a academia NÃO paga essas aulas (confirmado pelo
 * Rafael em 04/08/2026). Como ela é publicada em `classes` como aula normal, sem
 * esse corte entraria na folha — 1h por dia, por professor.
 *
 * Checa a marca `remunerada` (gravada na publicação a partir de 07/08/2026) E o
 * tipo da escala, pra pegar também o que foi publicado antes da marca existir.
 */
function classCountsForPayCF(c) {
  if (!c) return false;
  if (c.remunerada === false) return false;
  if (c.specialScaleType === 'escola_interna') return false;
  return true;
}

/**
 * Minutos que a aula realmente vale, depois das ocorrências.
 * Gêmeo de classEffectiveMinutes em professores-shared.js — manter iguais.
 *
 *   duração − atraso − saída antecipada + hora extra
 *
 * Falta zera: se não deu a aula, não recebe por ela (decisão do Rodrigo, 07/08).
 * Nunca devolve negativo.
 */
function classEffectiveMinutesCF(c) {
  if (!c) return 0;
  if (c.faltaTipo) return 0;
  const base = (typeof c.durationMinutes === 'number' && c.durationMinutes > 0) ? c.durationMinutes : 0;
  const n = v => (typeof v === 'number' && v > 0) ? v : 0;
  return Math.max(0, base - n(c.atrasoMinutos) - n(c.saidaAntecipadaMinutos) + n(c.horaExtraMinutos));
}

function calculateTeacherHoursCF(classes, scaleTypesMap = null) {
  if (!Array.isArray(classes) || classes.length === 0) return 0;
  let totalMinutes = 0;
  for (const c of classes) {
    if (!classCountsForPayCF(c)) continue;
    const mins = classEffectiveMinutesCF(c);
    let weight = 1;
    // Peso variável por tipo de escala (Sprint 5a)
    if (c.specialScaleType && scaleTypesMap && scaleTypesMap.has(c.specialScaleType)) {
      weight = scaleTypesMap.get(c.specialScaleType).weight || 1;
    } else if (c.isHoliday === true) {
      weight = 2;  // fallback retrocompat (P02)
    }
    totalMinutes += mins * weight;
  }
  return totalMinutes / 60;
}

/**
 * Encontra snapshot salarial efetivo no último dia do mês.
 * Mesma lógica do client-side getEffectiveSalaryAt.
 */
function getEffectiveSalaryAtCF(salary, date) {
  if (!salary) return {};
  const result = { ...salary };
  const targetMs = date.getTime();

  if (!Array.isArray(salary.salaryHistory) || salary.salaryHistory.length === 0) {
    return result;
  }

  const sorted = [...salary.salaryHistory].sort((a, b) => {
    const ta = (a.effectiveDate && a.effectiveDate.toMillis) ? a.effectiveDate.toMillis() : 0;
    const tb = (b.effectiveDate && b.effectiveDate.toMillis) ? b.effectiveDate.toMillis() : 0;
    return tb - ta;
  });

  for (const entry of sorted) {
    const entryMs = (entry.effectiveDate && entry.effectiveDate.toMillis) ? entry.effectiveDate.toMillis() : 0;
    if (entryMs > targetMs) {
      result[entry.field] = entry.previousValue;
    }
  }

  return result;
}

/**
 * Calcula valor a pagar para um professor (server-side).
 * Replica calculateTeacherValue do client.
 */
function calculateTeacherValueCF(teacher, salary, hours, lastDayOfMonth) {
  if (!salary) {
    return {
      total: 0, valorHoras: 0, mealAllowance: 0, transportAllowance: 0,
      otherBenefits: [], totalOutros: 0, hourlyRate: 0,
      isInternProportional: false, internStipendUsed: null,
      internExcessHours: null, internExcessValue: null,
      // null e não undefined: o Firestore recusa undefined
      isIntern: false, internLimitHours: null, internPropRate: null,
    };
  }

  const effective = getEffectiveSalaryAtCF(salary, lastDayOfMonth);

  const hourlyRate = (typeof effective.hourlyRate === 'number' && effective.hourlyRate > 0)
    ? effective.hourlyRate : 0;
  const meal = (typeof effective.mealAllowance === 'number') ? effective.mealAllowance : 0;
  const transport = (typeof effective.transportAllowance === 'number') ? effective.transportAllowance : 0;
  const otherBenefits = Array.isArray(effective.otherBenefits) ? effective.otherBenefits : [];
  const totalOutros = otherBenefits.reduce((sum, b) => sum + ((typeof b.valor === 'number') ? b.valor : 0), 0);

  let valorHoras = 0;
  let isInternProportional = false;
  let internStipendUsed = null;
  let internExcessHours = null;
  let internExcessValue = null;
  // Dados que o banco de horas precisa pra refazer a conta do mês (bloco 2, 07/08)
  let internLimitHours = null;
  let internPropRate = null;

  const isIntern = teacher.type === 'estagiario' && salary.remunerationType !== 'hora_aula';

  if (isIntern) {
    const limitMinutes = (typeof effective.internMonthlyLimitMinutes === 'number' && effective.internMonthlyLimitMinutes > 0)
      ? effective.internMonthlyLimitMinutes
      : ((typeof effective.internMonthlyLimitHours === 'number') ? effective.internMonthlyLimitHours * 60 : 0);
    const limitHours = limitMinutes / 60;
    const stipend = (typeof effective.internMonthlyStipend === 'number') ? effective.internMonthlyStipend : 0;
    const propRate = (typeof effective.internProportionalHourlyRate === 'number') ? effective.internProportionalHourlyRate : 0;
    internLimitHours = limitHours;
    internPropRate = propRate;

    if (hours <= limitHours) {
      valorHoras = stipend;
      internStipendUsed = stipend;
    } else {
      const excessHours = hours - limitHours;
      const excessValue = excessHours * propRate;
      valorHoras = stipend + excessValue;
      isInternProportional = true;
      internStipendUsed = stipend;
      internExcessHours = excessHours;
      internExcessValue = excessValue;
    }
  } else {
    valorHoras = hours * hourlyRate;
  }

  const total = valorHoras + meal + transport + totalOutros;

  return {
    total, valorHoras, mealAllowance: meal, transportAllowance: transport,
    otherBenefits, totalOutros, hourlyRate,
    isInternProportional, internStipendUsed, internExcessHours, internExcessValue,
    isIntern, internLimitHours, internPropRate,
  };
}

/** Formata valor monetário pra log (server-side). */
function fmtCF(val) {
  if (typeof val !== 'number' || isNaN(val)) return '—';
  return 'R$ ' + val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
