// ═══════════════════════════════════════════════════════════════════════
// Fixture Sprint 6a — cria pedido de férias APROVADO, valida o algoritmo
// que o generateClassesCore usa pra pular datas, e limpa tudo no fim.
//
// Uso:  node scripts/fixture-6a.js --project staging
// ═══════════════════════════════════════════════════════════════════════

'use strict';

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

const args = process.argv.slice(2);
const projectArg = args.find(a => a.startsWith('--project='))?.split('=')[1]
  || (args.includes('--project') ? args[args.indexOf('--project') + 1] : null);

if (!projectArg) {
  console.error('Uso: node fixture-6a.js --project <staging|production>');
  process.exit(1);
}

const projectId = projectArg === 'production'
  ? 'crosstrainer-comissoes'
  : 'crosstrainer-comissoes-staging';

const credPath = path.join(__dirname, `serviceAccount-${projectArg}.json`);
if (!fs.existsSync(credPath)) {
  console.error(`Service account nao encontrado: ${credPath}`);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(credPath)),
  projectId,
});

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const FieldValue = admin.firestore.FieldValue;

// ─── Helpers de timezone BR (espelham os do functions/index.js) ─────────
function brComponents(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10) - 1,
    day: parseInt(parts.day, 10),
    weekday: weekdayMap[parts.weekday],
  };
}
function brMidnightUTC(year, month0, day) {
  return new Date(Date.UTC(year, month0, day, 3, 0, 0, 0));  // BR midnight = 03:00 UTC (Brasil sem DST desde 2019)
}
function ymdBR(date) {
  const c = brComponents(date);
  return `${c.year}-${String(c.month + 1).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
}

(async () => {
  console.log('\n══════ FIXTURE Sprint 6a — Ferias e Recesso ══════');
  console.log(`Projeto: ${projectId}\n`);

  const created = { vacationReqId: null, notifIds: [], auditIds: [] };
  let failed = false;

  try {
    // ─── 1) Acha professor ativo com slot ativo ────────────────────────
    console.log('1) Procurando professor ativo com slot ativo...');
    const [teachersSnap, slotsSnap] = await Promise.all([
      db.collection('teachers').where('isActive', '==', true).get(),
      db.collection('schedule_slots').where('isActive', '==', true).get(),
    ]);

    const teacherIdsWithSlots = new Set();
    slotsSnap.docs.forEach(s => teacherIdsWithSlots.add(s.data().teacherId));

    const candidates = teachersSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => teacherIdsWithSlots.has(t.id) && (t.type === 'efetivo' || t.type === 'estagiario'));

    if (candidates.length === 0) {
      throw new Error('Nenhum professor efetivo/estagiario ativo com slot ativo');
    }

    // Prefere estagiario (5 dias suficientes); senao efetivo (precisa 30 dias)
    const teacher = candidates.find(t => t.type === 'estagiario') || candidates[0];
    console.log(`   -> ${teacher.name} (${teacher.type}) | id=${teacher.id}`);

    const slot = slotsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .find(s => s.teacherId === teacher.id);
    console.log(`   -> slot ${slot.id} | weekday=${slot.weekday} | ${slot.startTime}-${slot.endTime} | unit=${slot.unitId}`);

    // ─── 2) Calcula periodo de ferias futuro ───────────────────────────
    const startOffsetDays = 10;  // 10 dias frente, > antecedencia minima
    const periodDays = teacher.type === 'efetivo' ? 30 : 5;

    const today = brComponents(new Date());
    const startBR = brMidnightUTC(today.year, today.month, today.day + startOffsetDays);
    const endBR   = brMidnightUTC(today.year, today.month, today.day + startOffsetDays + periodDays - 1);

    console.log(`\n2) Periodo: ${ymdBR(startBR)} -> ${ymdBR(endBR)} (${periodDays} dias)`);

    // ─── 3) Cria vacation_request APROVADA ─────────────────────────────
    const type = teacher.type === 'estagiario' ? 'recesso' : 'ferias';
    const vacRef = db.collection('vacation_requests').doc();
    created.vacationReqId = vacRef.id;

    await vacRef.set({
      teacherId: teacher.id,
      teacherName: teacher.name,
      teacherType: teacher.type,
      unitId: teacher.primaryUnitId || (Array.isArray(teacher.unitIds) ? teacher.unitIds[0] : null),
      type,
      periods: [{
        startDate: Timestamp.fromDate(startBR),
        endDate:   Timestamp.fromDate(endBR),
        days: periodDays,
      }],
      totalDays: periodDays,
      reason: 'FIXTURE-6A (auto)',
      status: 'aprovada',
      requestedAt:  FieldValue.serverTimestamp(),
      requestedBy: 'fixture-script',
      requestedByName: 'Fixture Script',
      respondedAt: FieldValue.serverTimestamp(),
      respondedBy: 'fixture-script',
      respondedByName: 'Fixture Script (admin)',
      responseNote: 'Aprovado pela fixture',
      cancelledAt: null, cancelledBy: null, cancelReason: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`   OK vacation_request criado: ${vacRef.id} (status=aprovada)`);

    // ─── 4) Notif + Audit ──────────────────────────────────────────────
    const notifRef = db.collection('notifications').doc();
    created.notifIds.push(notifRef.id);
    await notifRef.set({
      recipientUserId: 'fixture-admin',
      type: 'vacation_approved',
      title: 'Ferias aprovadas (FIXTURE)',
      body: `${teacher.name} - ${periodDays} dias de ${type}`,
      link: { type: 'vacation', id: vacRef.id },
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    console.log(`   OK notification criada: ${notifRef.id}`);

    const auditRef = db.collection('audit_log').doc();
    created.auditIds.push(auditRef.id);
    await auditRef.set({
      type: 'vacation_aprovada',
      details: `FIXTURE Aprovada ${type} de ${teacher.name} (${periodDays} dias)`,
      entityType: 'vacation_request',
      entityId: vacRef.id,
      module: 'ferias',
      timestamp: FieldValue.serverTimestamp(),
      actorUserId: 'fixture-script',
      actorName: 'Fixture Script',
    });
    console.log(`   OK audit_log criado: ${auditRef.id}`);

    // ─── 5) Replica logica de generateClassesCore localmente ───────────
    console.log('\n3) Replicando algoritmo de vacationDatesByTeacher...');
    const vacSnap = await db.collection('vacation_requests')
      .where('status', '==', 'aprovada').get();

    const vacationDatesByTeacher = new Map();
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
          set.add(ymdBR(cur));
          cur = new Date(cur.getTime() + 86400000);
        }
      });
    });

    const teacherVacations = vacationDatesByTeacher.get(teacher.id);
    if (!teacherVacations) {
      throw new Error('C4 FALHOU: vacation_request nao apareceu no Map');
    }
    console.log(`   OK Map.get(${teacher.id}) -> Set(${teacherVacations.size}) datas`);
    console.log(`   Datas bloqueadas: [${Array.from(teacherVacations).sort().join(', ')}]`);

    // ─── 6) Confere que cada data esperada esta no set ─────────────────
    let allMatch = true;
    let cur = new Date(startBR);
    const expected = [];
    while (cur <= endBR) {
      const ymd = ymdBR(cur);
      expected.push(ymd);
      if (!teacherVacations.has(ymd)) {
        console.log(`   FAIL Data ${ymd} esperada mas NAO esta no set`);
        allMatch = false;
      }
      cur = new Date(cur.getTime() + 86400000);
    }
    if (allMatch) {
      console.log(`   OK Todas as ${expected.length} datas estao bloqueadas`);
    } else {
      failed = true;
    }

    // ─── 7) Confere que ha um match com weekday do slot ─────────────────
    let weekdayHit = null;
    cur = new Date(startBR);
    while (cur <= endBR) {
      const c = brComponents(cur);
      if (c.weekday === slot.weekday) {
        weekdayHit = ymdBR(cur);
        break;
      }
      cur = new Date(cur.getTime() + 86400000);
    }
    if (weekdayHit) {
      console.log(`   OK Data ${weekdayHit} bate com weekday=${slot.weekday} do slot ${slot.id}`);
      console.log(`      -> generateClassesCore pularia esta classe (vacationSkippedCount++)`);
    } else {
      console.log(`   AVISO Nenhuma data do periodo bate com weekday=${slot.weekday} do slot escolhido`);
      console.log(`         (bloqueio ainda funciona para outros slots em outros weekdays)`);
    }

    // ─── 8) smoke-6a deveria ver a fixture ─────────────────────────────
    console.log('\n4) Conferindo que smoke-6a ve a fixture...');
    const total = (await db.collection('vacation_requests').get()).size;
    const auditCount = (await db.collection('audit_log')
      .where('module', '==', 'ferias').get()).size;
    const notifsSnap = await db.collection('notifications')
      .orderBy('createdAt', 'desc').limit(50).get();
    const vacationNotifs = notifsSnap.docs.filter(d => (d.data().type || '').startsWith('vacation_')).length;

    console.log(`   vacation_requests total: ${total} (esperado >= 1)`);
    console.log(`   audit_log module=ferias: ${auditCount} (esperado >= 1)`);
    console.log(`   notifications vacation_*: ${vacationNotifs} (esperado >= 1)`);

    if (total >= 1 && auditCount >= 1 && vacationNotifs >= 1) {
      console.log(`   OK smoke-6a agora tem dados para inspecionar`);
    } else {
      console.log(`   FAIL alguma colecao nao recebeu o dado esperado`);
      failed = true;
    }

    console.log(`\n${failed ? 'X FIXTURE 6a COM FALHAS' : 'V FIXTURE 6a VALIDADA'} - limpando dados\n`);
  } catch (err) {
    console.error('\nERRO durante fixture:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    failed = true;
  } finally {
    // ─── 9) Cleanup ─────────────────────────────────────────────────────
    console.log('Limpeza:');
    try {
      if (created.vacationReqId) {
        await db.collection('vacation_requests').doc(created.vacationReqId).delete();
        console.log(`   OK vacation_request ${created.vacationReqId} removido`);
      }
      for (const nid of created.notifIds) {
        await db.collection('notifications').doc(nid).delete();
        console.log(`   OK notification ${nid} removida`);
      }
      for (const aid of created.auditIds) {
        await db.collection('audit_log').doc(aid).delete();
        console.log(`   OK audit_log ${aid} removido`);
      }
    } catch (cleanupErr) {
      console.error('   Erro no cleanup:', cleanupErr.message);
    }
    await admin.app().delete();
    process.exit(failed ? 1 : 0);
  }
})();
