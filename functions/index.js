// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Cloud Functions Entry Point
// Módulo de Professores
//
// Funções implementadas:
//   ✅ healthCheck ............................. Sprint 0-B
//   ✅ generateClassesForUpcomingWeeks (cron) .. Sprint 3a
//   ✅ generateClassesManual (callable) ........ Sprint 3a
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
// Performance: cresce com (slots × semanas). Pra 100 slots × 4 semanas:
//   - ~400 classes potenciais por execução
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

/**
 * Núcleo da geração — reutilizado pela scheduled e pela callable.
 * Toda a iteração de datas e cálculo de weekday é feita em horário BR.
 * @param {object} opts
 * @param {number} opts.weeksAhead — quantas semanas à frente gerar (default 4)
 * @param {boolean} opts.dryRun — se true, não escreve nada e retorna preview
 * @param {string} opts.source — 'cf-scheduled' | 'cf-manual'
 * @returns {{created, skipped, dryRun, sample, slotsScanned, durationMs}}
 */
async function generateClassesCore({ weeksAhead = 4, dryRun = false, source = 'cf-manual' } = {}) {
  const t0 = Date.now();
  const firestore = db();

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

  // 1c) Busca special_scales ativas da janela
  const scalesSnap = await firestore.collection('special_scales')
    .where('isActive', '==', true).get();
  const scalesByDate = new Map();  // 'YYYY-MM-DD_unitId' → escala
  scalesSnap.docs.forEach(d => {
    const s = d.data();
    if (!s.date || !s.unitIds || !Array.isArray(s.unitIds)) return;
    const dObj = s.date.toDate ? s.date.toDate() : new Date(s.date);
    const ymd = ymdISOFromDateBR(dObj);
    s.unitIds.forEach(uid => {
      scalesByDate.set(`${ymd}_${uid}`, { id: d.id, ...s });
    });
  });

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

  // 2) Compõe todos os pares (slot, data) candidatos — iterando em dias BR
  const candidates = [];   // [{ slotId, slot, date, classId, extras }]
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
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

        const classId = `${slot.id}_${ymdFromDateBR(cursor)}`;
        const feriado = feriadosByDate.get(ymdStr);
        const scale = scalesByDate.get(`${ymdStr}_${slot.unitId}`);

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
    dryRun: false,
    sample,
    slotsScanned: slots.length,
    durationMs: Date.now() - t0,
  };
}

/**
 * Scheduled — roda toda segunda às 02:00 BRT e gera as próximas 4 semanas.
 * Schedule cron: minuto 0, hora 2, dia qualquer, mês qualquer, dia-semana 1 (segunda).
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
      weeksAhead: 4,
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
 *   const res = await fn({ weeksAhead: 4, dryRun: true });
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
    : 4;
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
// SPRINT 3b — SUBSTITUIÇÕES + COBERTURA + NOTIFICAÇÕES
// ═══════════════════════════════════════════════════════════════════════

const NOTIF_TYPE_TITLES = {
  substitution_requested: 'Pedido de substituição',
  substitution_accepted:  'Substituição aceita',
  substitution_rejected:  'Substituição recusada',
  substitution_cancelled: 'Substituição cancelada',
  coverage_available:     'Cobertura disponível',
  coverage_taken:         'Cobertura aceita',
  coverage_cancelled:     'Cobertura cancelada',
};

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
  if (after.status !== 'accepted') return;

  const subId = event.params.subId;
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
        adjustmentNote: `Substituição aceita (sub:${subId})`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    // Notifica titular
    if (after.requestingUserId) {
      await createNotification({
        recipientUserId: after.requestingUserId,
        type: 'substitution_accepted',
        body: 'Seu pedido de substituição foi aceito.',
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
    let totalHoras = 0, totalValor = 0, totalClassesCount = 0;
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
      });

      totalHoras += hours;
      totalValor += value.total;
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

    const totals = {
      classesRealizadas: totalClassesCount,
      classesSubstituidas: validClasses.filter(c => c.status === 'substituida').length,
      classesCanceladas: totalCanceladas,
      classesNaoRealizadas: totalNaoRealizadas,
      totalHoras: Math.round(totalHoras * 100) / 100,
      totalValor: Math.round(totalValor * 100) / 100,
      // Sprint 6b — férias
      totalVacationDays: teacherResults.reduce((s, t) => s + (t.vacationDaysInMonth || 0), 0),
      totalVacationValue: Math.round(teacherResults.reduce((s, t) => s + (t.vacationValue || 0), 0) * 100) / 100,
      totalGeral: Math.round((Math.round(totalValor * 100) / 100 + Math.round(teacherResults.reduce((s, t) => s + (t.vacationValue || 0), 0) * 100) / 100) * 100) / 100,
    };

    // ── 9) Cria monthly_closings (com transação anti-race) ────────
    const now = admin.firestore.FieldValue.serverTimestamp();
    const closingData = {
      unitId,
      year,
      month,
      status: 'fechado',
      closedAt: now,
      closedBy: request.auth.uid,
      closedByName: userData.name || userData.email || request.auth.uid,
      totals,
      teachers: teacherResults,
      createdAt: now,
      updatedAt: now,
    };

    await firestore.runTransaction(async (txn) => {
      const existing = await txn.get(closingRef);
      if (existing.exists) {
        throw new Error('Já existe um fechamento para este período.');
      }
      txn.set(closingRef, closingData);
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

    // 2) Busca special_scales ativas
    const scalesSnap = await firestore.collection('special_scales')
      .where('isActive', '==', true).get();
    const scalesByDate = new Map();
    scalesSnap.docs.forEach(d => {
      const s = d.data();
      if (!s.date || !s.unitIds || !Array.isArray(s.unitIds)) return;
      const dObj = s.date.toDate ? s.date.toDate() : new Date(s.date);
      const ymd = ymdISOFromDateBR(dObj);
      s.unitIds.forEach(uid => {
        scalesByDate.set(`${ymd}_${uid}`, { id: d.id, ...s });
      });
    });

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

// ─── Helpers de cálculo (server-side, replicam professores-shared.js) ──

/**
 * Calcula horas de um array de classes. Feriado conta em dobro (P02).
 */
function calculateTeacherHoursCF(classes, scaleTypesMap = null) {
  if (!Array.isArray(classes) || classes.length === 0) return 0;
  let totalMinutes = 0;
  for (const c of classes) {
    const mins = (typeof c.durationMinutes === 'number' && c.durationMinutes > 0) ? c.durationMinutes : 0;
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

  const isIntern = teacher.type === 'estagiario' && salary.remunerationType !== 'hora_aula';

  if (isIntern) {
    const limitMinutes = (typeof effective.internMonthlyLimitMinutes === 'number' && effective.internMonthlyLimitMinutes > 0)
      ? effective.internMonthlyLimitMinutes
      : ((typeof effective.internMonthlyLimitHours === 'number') ? effective.internMonthlyLimitHours * 60 : 0);
    const limitHours = limitMinutes / 60;
    const stipend = (typeof effective.internMonthlyStipend === 'number') ? effective.internMonthlyStipend : 0;
    const propRate = (typeof effective.internProportionalHourlyRate === 'number') ? effective.internProportionalHourlyRate : 0;

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
  };
}

/** Formata valor monetário pra log (server-side). */
function fmtCF(val) {
  if (typeof val !== 'number' || isNaN(val)) return '—';
  return 'R$ ' + val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
