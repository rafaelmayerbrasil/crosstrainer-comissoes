// scale-service.js — persistência + orquestração da escala especial (spec §4.5-4.7, §6)
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScaleService = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function rdb(deps)  { if (deps && deps.db) return deps.db; return (typeof db !== 'undefined') ? db : null; }
  function rts(deps)  { if (deps && deps.ts) return deps.ts(); return (typeof serverTs === 'function') ? serverTs() : new Date().toISOString(); }
  function ruid(deps) { if (deps && deps.uid) return deps.uid(); return (typeof currentUserId === 'function') ? currentUserId() : null; }
  function rSE(deps)  { if (deps && deps.SE) return deps.SE; return ScaleEngine; }

  function templateSlots(tipo, units, times) {
    if (tipo === 'sabado' || tipo === 'feriado' || tipo === 'domingo_especial') {
      const t = times || {};
      const out = [];
      (units || []).forEach(u => {
        ['TOI', 'HIIT'].forEach(mod => out.push({
          id: `${u.id}_${mod}`, unitId: u.id, requiredModalityId: mod, assignedPersonId: null,
          startTime: t.startTime || null, endTime: t.endTime || null,
        }));
      });
      return out;
    }
    return [];
  }

  // ── Helpers puros das abas (sábados virtuais / feriados / legado) ──
  function pad2(n) { return String(n).padStart(2, '0'); }

  // Todos os sábados de um ano, em ISO local (sem UTC pra não escorregar de dia)
  function saturdaysOfYear(year) {
    const out = [];
    const d = new Date(year, 0, 1);
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7)); // pula pro primeiro sábado
    while (d.getFullYear() === year) {
      out.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
      d.setDate(d.getDate() + 7);
    }
    return out;
  }

  // [{ date, docs: [escalas naquela data] }] preservando a ordem das datas
  function mergeVirtualWithDocs(dates, docs) {
    const byDate = {};
    (docs || []).forEach(doc => { (byDate[doc.date] = byDate[doc.date] || []).push(doc); });
    return (dates || []).map(date => ({ date, docs: byDate[date] || [] }));
  }

  // Shape da BrasilAPI: [{ date:'2026-09-07', name:'…', type:'national' }] → [{date,name}]
  function parseFeriados(json) {
    if (!Array.isArray(json)) return [];
    return json
      .filter(f => f && typeof f.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.date) && typeof f.name === 'string')
      .map(f => ({ date: f.date, name: f.name }));
  }

  // Docs pré-Escala Inteligente (tela legada): date Timestamp e/ou sem tipo
  function isLegacyScaleDoc(doc) {
    if (!doc) return true;
    if (typeof doc.tipo !== 'string' || !doc.tipo) return true;
    if (typeof doc.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.date)) return true;
    return false;
  }

  // Janela aberta? status precisa ser 'janela_aberta' E (sem prazo OU nowISO <= windowClosesAt).
  // Comparação lexicográfica de ISO funciona porque o formato é ordenável.
  function isWindowOpen(scale, nowISO) {
    if (!scale || scale.status !== 'janela_aberta') return false;
    if (!scale.windowClosesAt) return true;
    return String(nowISO) <= String(scale.windowClosesAt);
  }

  // "Agora" em hora LOCAL no formato YYYY-MM-DDTHH:MM (mesmo do <input datetime-local>),
  // pra comparar lexicograficamente com windowClosesAt sem descasar UTC×local.
  function nowLocalMinute(d) {
    d = d || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // Filtra linhas com {date:'YYYY-MM-DD'} por período relativo a todayISO.
  function filterByTimeframe(rows, todayISO, tf) {
    if (tf === 'todos') return (rows || []).slice();
    if (tf === 'passados') return (rows || []).filter(r => r.date < todayISO);
    return (rows || []).filter(r => r.date >= todayISO); // 'futuros' (default), inclui hoje
  }

  // Matriz da prévia de fechamento: pessoas × escalas.
  // prefsByScale: { scaleId: [{personId, pref}] }. people: [{id, name}].
  function buildConsolidationMatrix(scales, prefsByScale, people) {
    const prefLookup = {}; // prefLookup[scaleId][personId] = pref
    (scales || []).forEach(s => {
      prefLookup[s.id] = {};
      ((prefsByScale || {})[s.id] || []).forEach(p => { prefLookup[s.id][p.personId] = p.pref; });
    });
    const assignedByScale = {};
    (scales || []).forEach(s => {
      assignedByScale[s.id] = new Set((s.slots || []).map(sl => sl.assignedPersonId).filter(Boolean));
    });
    const grid = (people || []).map(person => {
      const cells = {};
      (scales || []).forEach(s => {
        cells[s.id] = {
          pref: (prefLookup[s.id] || {})[person.id] || null,
          assigned: assignedByScale[s.id].has(person.id),
        };
      });
      return { person, cells };
    });
    const semCandidatura = (people || []).filter(person =>
      (scales || []).every(s => !(prefLookup[s.id] || {})[person.id])
    );
    let vagasAbertas = 0;
    (scales || []).forEach(s => { (s.slots || []).forEach(sl => { if (!sl.assignedPersonId) vagasAbertas++; }); });
    return { grid, semCandidatura, vagasAbertas };
  }

  // Vagas da Escola Interna: 1 líder por unidade (sessão diária Seg–Sex, hora configurável).
  function escolaInternaSlots(units, times) {
    const t = times || {};
    return (units || []).map(u => ({
      id: `${u.id}_LIDER`, unitId: u.id, role: 'lider',
      requiredModalityId: null, assignedPersonId: null,
      startTime: t.startTime || '14:30', endTime: t.endTime || '15:30',
    }));
  }

  // Atribuição manual de pessoa a um slot (líder da Escola Interna, ou override).
  async function assignSlot(scaleId, slotId, personId, deps) {
    try {
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      const slots = (scaleRes.data.slots || []).map(s =>
        s.id === slotId ? Object.assign({}, s, { assignedPersonId: personId || null }) : s);
      await rdb(deps).collection('special_scales').doc(scaleId)
        .set({ slots, updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      return { success: true };
    } catch (err) { console.error('[ScaleService.assignSlot]', err); return { success: false, error: err.message }; }
  }

  // ── Config da escala (horários-padrão das vagas, configurável pela gestão) ──
  const DEFAULT_HORARIOS = {
    sabado:           { startTime: '08:00', endTime: '12:00' },
    feriado:          { startTime: '08:00', endTime: '12:00' },
    domingo_especial: { startTime: '08:00', endTime: '12:00' },
    evento:           { startTime: '08:00', endTime: '12:00' },
  };
  const ScaleConfigService = {
    async get(deps) {
      try {
        const doc = await rdb(deps).collection('scale_config').doc('default').get();
        const base = {
          horarios: JSON.parse(JSON.stringify(DEFAULT_HORARIOS)),
          fimDeAnoShifts: JSON.parse(JSON.stringify(DEFAULT_FE_SHIFTS)),
          fimDeAnoPeoplePerShift: 1,
        };
        return { success: true, data: doc.exists ? Object.assign(base, doc.data()) : base };
      } catch (err) { console.error('[ScaleConfigService.get]', err); return { success: false, error: err.message }; }
    },
    async save(patch, deps) {
      try {
        await rdb(deps).collection('scale_config').doc('default')
          .set(Object.assign({ updatedAt: rts(deps) }, patch), { merge: true });
        return { success: true };
      } catch (err) { console.error('[ScaleConfigService.save]', err); return { success: false, error: err.message }; }
    },
  };

  async function createScale(scale, deps) {
    try {
      const database = rdb(deps);
      const ref = database.collection('special_scales').doc();
      const doc = {
        date: scale.date, name: scale.name || '', tipo: scale.tipo,
        eventKind: scale.eventKind || null,
        status: 'rascunho', slots: scale.slots || [], externalId: '',
        createdAt: rts(deps), createdBy: ruid(deps),
      };
      await ref.set(doc);
      return { success: true, data: { id: ref.id, ...doc } };
    } catch (err) { console.error('[ScaleService.createScale]', err); return { success: false, error: err.message }; }
  }

  async function getScale(id, deps) {
    try {
      const doc = await rdb(deps).collection('special_scales').doc(id).get();
      if (!doc.exists) return { success: false, error: 'Escala não encontrada' };
      return { success: true, data: { id: doc.id, ...doc.data() } };
    } catch (err) { console.error('[ScaleService.getScale]', err); return { success: false, error: err.message }; }
  }

  async function listScales(deps) {
    try {
      const snap = await rdb(deps).collection('special_scales').orderBy('date').get();
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => !isLegacyScaleDoc(s));
      return { success: true, data };
    } catch (err) { console.error('[ScaleService.listScales]', err); return { success: false, error: err.message }; }
  }

  async function setStatus(id, status, deps) {
    try {
      await rdb(deps).collection('special_scales').doc(id).set({ status, updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      return { success: true };
    } catch (err) { console.error('[ScaleService.setStatus]', err); return { success: false, error: err.message }; }
  }
  async function openElection(id, opts, deps) {
    try {
      const patch = { status: 'janela_aberta', windowOpenedAt: rts(deps), windowClosedAt: null,
        updatedAt: rts(deps), updatedBy: ruid(deps) };
      if (opts && opts.closesAt) patch.windowClosesAt = opts.closesAt;
      if (opts && opts.batchId) patch.windowBatchId = opts.batchId;
      await rdb(deps).collection('special_scales').doc(id).set(patch, { merge: true });
      return { success: true };
    } catch (err) { console.error('[ScaleService.openElection]', err); return { success: false, error: err.message }; }
  }
  async function closeElection(id, deps) {
    try {
      await rdb(deps).collection('special_scales').doc(id)
        .set({ status: 'rascunho', windowClosedAt: rts(deps), updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      return { success: true };
    } catch (err) { console.error('[ScaleService.closeElection]', err); return { success: false, error: err.message }; }
  }

  async function listScalesByBatch(batchId, deps) {
    try {
      const snap = await rdb(deps).collection('special_scales').where('windowBatchId', '==', batchId).get();
      const data = snap.docs.map(dd => ({ id: dd.id, ...dd.data() })).filter(s => !isLegacyScaleDoc(s));
      return { success: true, data };
    } catch (err) { console.error('[ScaleService.listScalesByBatch]', err); return { success: false, error: err.message }; }
  }

  async function setPreference(scaleId, personId, pref, deps) {
    try {
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      const nowISO = (deps && deps.now) ? deps.now() : nowLocalMinute();
      if (!isWindowOpen(scaleRes.data, nowISO)) {
        return { success: false, error: 'Janela de preferências encerrada.' };
      }
      await rdb(deps).collection('scale_preferences').doc(`${scaleId}__${personId}`)
        .set({ scaleId, personId, pref, updatedAt: rts(deps) });
      return { success: true };
    } catch (err) { console.error('[ScaleService.setPreference]', err); return { success: false, error: err.message }; }
  }

  async function listPreferences(scaleId, deps) {
    try {
      const snap = await rdb(deps).collection('scale_preferences').where('scaleId', '==', scaleId).get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) { console.error('[ScaleService.listPreferences]', err); return { success: false, error: err.message }; }
  }

  async function setDayPreference(scaleId, personId, date, pref, excludedShifts, deps) {
    try {
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      const nowISO = (deps && deps.now) ? deps.now() : nowLocalMinute();
      if (!isWindowOpen(scaleRes.data, nowISO)) return { success: false, error: 'Janela de preferências encerrada.' };
      await rdb(deps).collection('scale_day_preferences').doc(`${scaleId}__${personId}__${date}`)
        .set({ scaleId, personId, date, pref, excludedShifts: excludedShifts || [], updatedAt: rts(deps) });
      return { success: true };
    } catch (err) { console.error('[ScaleService.setDayPreference]', err); return { success: false, error: err.message }; }
  }

  async function listDayPreferences(scaleId, deps) {
    try {
      const snap = await rdb(deps).collection('scale_day_preferences').where('scaleId', '==', scaleId).get();
      return { success: true, data: snap.docs.map(dd => ({ id: dd.id, ...dd.data() })) };
    } catch (err) { console.error('[ScaleService.listDayPreferences]', err); return { success: false, error: err.message }; }
  }

  // ── Staff + RSVP de eventos (§4.5) ───────────────────────────────
  async function listEventRsvp(scaleId, deps) {
    try {
      const snap = await rdb(deps).collection('event_rsvp').where('scaleId', '==', scaleId).get();
      return { success: true, data: snap.docs.map(dd => ({ id: dd.id, ...dd.data() })) };
    } catch (err) { console.error('[ScaleService.listEventRsvp]', err); return { success: false, error: err.message }; }
  }

  // Reconcilia o staff do evento. obrigatorios/opcionais = arrays de personId.
  // Novo obrigatório nasce going:true; novo opcional nasce going:null; preserva going de quem já existia.
  // Remove do staff quem saiu das listas. Retorna { added:[personId dos novos] }.
  async function setEventStaff(scaleId, obrigatorios, opcionais, deps) {
    try {
      const database = rdb(deps);
      const existing = {};
      const cur = await listEventRsvp(scaleId, deps);
      if (!cur.success) return cur;
      cur.data.forEach(r => { existing[r.personId] = r; });
      const desired = []
        .concat((obrigatorios || []).map(pid => ({ pid, tier: 'obrigatorio' })))
        .concat((opcionais || []).map(pid => ({ pid, tier: 'opcional' })));
      const desiredIds = new Set(desired.map(x => x.pid));
      const added = [];
      for (const { pid, tier } of desired) {
        const prev = existing[pid];
        const doc = {
          scaleId, personId: pid, tier,
          going: prev ? prev.going : (tier === 'obrigatorio' ? true : null),
          invitedAt: prev ? (prev.invitedAt || rts(deps)) : rts(deps),
          respondedAt: prev ? (prev.respondedAt || null) : null,
        };
        await database.collection('event_rsvp').doc(`${scaleId}__${pid}`).set(doc);
        if (!prev) added.push(pid);
      }
      for (const pid of Object.keys(existing)) {
        if (!desiredIds.has(pid)) await database.collection('event_rsvp').doc(`${scaleId}__${pid}`).delete();
      }
      return { success: true, data: { added } };
    } catch (err) { console.error('[ScaleService.setEventStaff]', err); return { success: false, error: err.message }; }
  }

  async function setRsvp(scaleId, personId, going, deps) {
    try {
      if (typeof going !== 'boolean') return { success: false, error: 'Resposta inválida.' };
      const ref = rdb(deps).collection('event_rsvp').doc(`${scaleId}__${personId}`);
      const cur = await ref.get();
      if (!cur.exists) return { success: false, error: 'Você não está no staff deste evento.' };
      await ref.set({ going, respondedAt: rts(deps) }, { merge: true });
      return { success: true };
    } catch (err) { console.error('[ScaleService.setRsvp]', err); return { success: false, error: err.message }; }
  }

  async function getFairness(personId, deps) {
    try {
      const doc = await rdb(deps).collection('fairness_counter').doc(personId).get();
      const base = { personId, diasTrabalhados: 0, divida: 0 };
      return { success: true, data: doc.exists ? Object.assign(base, doc.data()) : base };
    } catch (err) { console.error('[ScaleService.getFairness]', err); return { success: false, error: err.message }; }
  }

  async function saveFairness(personId, vals, deps) {
    try {
      await rdb(deps).collection('fairness_counter').doc(personId)
        .set({ personId, diasTrabalhados: vals.diasTrabalhados || 0, divida: vals.divida || 0, updatedAt: rts(deps) });
      return { success: true };
    } catch (err) { console.error('[ScaleService.saveFairness]', err); return { success: false, error: err.message }; }
  }

  async function applyFairnessDelta(delta, deps) {
    try {
      for (const personId of Object.keys(delta || {})) {
        const cur = (await getFairness(personId, deps)).data;
        const dd = delta[personId];
        await saveFairness(personId, {
          diasTrabalhados: cur.diasTrabalhados + (dd.dias || 0),
          divida: Math.max(0, cur.divida - (dd.dividaResolvida || 0)),
        }, deps);
      }
      return { success: true };
    } catch (err) { console.error('[ScaleService.applyFairnessDelta]', err); return { success: false, error: err.message }; }
  }

  // PURO: [{personId,date,pref,excludedShifts}] → map[personId][date] = {pref, excludedShifts}
  function dayPrefsToAvailability(dayPrefs) {
    const out = {};
    (dayPrefs || []).forEach(p => {
      if (!p || !p.personId || !p.date) return;
      (out[p.personId] = out[p.personId] || {})[p.date] = {
        pref: p.pref || null,
        excludedShifts: p.excludedShifts || [],
      };
    });
    return out;
  }

  // PURO: separa os RSVP por resposta. going: true=vai, false=não vai, null/undefined=sem resposta.
  function summarizeRsvp(rsvpDocs) {
    const out = { vao: [], naoVao: [], semResposta: [] };
    (rsvpDocs || []).forEach(r => {
      if (r.going === true) out.vao.push(r.personId);
      else if (r.going === false) out.naoVao.push(r.personId);
      else out.semResposta.push(r.personId);
    });
    return out;
  }

  // PURO: a pessoa está em algum slot atribuído desta escala?
  function isPersonAssigned(scale, personId) {
    if (!scale || !personId) return false;
    return (scale.slots || []).some(s => s.assignedPersonId === personId);
  }

  function buildCandidates(ctx) {
    const merito = ctx.meritoById || {};
    const fair = ctx.fairnessById || {};
    const pref = ctx.prefById || {};
    return (ctx.teachers || []).map(t => ({
      id: t.id, modalityIds: t.modalityIds || [], primaryUnitId: t.primaryUnitId || null,
      merito: merito[t.id] || 0,
      diasTrabalhados: (fair[t.id] && fair[t.id].diasTrabalhados) || 0,
      divida: (fair[t.id] && fair[t.id].divida) || 0,
      pref: pref[t.id] || null,
    }));
  }

  async function consolidate(scaleId, ctx, deps) {
    try {
      ctx = ctx || {};
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      const scale = scaleRes.data;
      // A1: só a 1ª consolidação move o contador de justiça. Reconsolidar (o botão
      // existe) reaplicava o delta a cada clique e inflava o fairness — insumo central
      // do motor. Reconsolidação reajusta as atribuições, mas não recontabiliza justiça.
      const jaConsolidada = scale.status === 'consolidada' || scale.fairnessApplied === true;
      const prefsRes = await listPreferences(scaleId, deps);
      const prefById = {};
      (prefsRes.data || []).forEach(p => { prefById[p.personId] = p.pref; });
      const teachers = ctx.teachers || [];
      const fairnessById = {};
      for (const t of teachers) { fairnessById[t.id] = (await getFairness(t.id, deps)).data; }
      const candidates = buildCandidates({ teachers, meritoById: ctx.meritoById || {}, fairnessById, prefById });
      const result = rSE(deps).consolidate(scale.slots || [], candidates, ctx.opts || {});
      const bySlot = {}, byReason = {}, byExplain = {};
      result.assignments.forEach(a => { bySlot[a.slotId] = a.personId; byReason[a.slotId] = a.reason; byExplain[a.slotId] = a.explain || []; });
      const newSlots = (scale.slots || []).map(s => Object.assign({}, s, {
        assignedPersonId: bySlot[s.id] !== undefined ? bySlot[s.id] : s.assignedPersonId,
        reason: byReason[s.id] !== undefined ? byReason[s.id] : (s.reason || null),
        explain: byExplain[s.id] !== undefined ? byExplain[s.id] : (s.explain || []),
      }));
      await rdb(deps).collection('special_scales').doc(scaleId)
        .set({ slots: newSlots, status: 'consolidada', fairnessApplied: true, updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      if (!jaConsolidada) await applyFairnessDelta(result.fairnessDelta, deps);
      return { success: true, data: { assignments: result.assignments, fairnessAplicado: !jaConsolidada } };
    } catch (err) { console.error('[ScaleService.consolidate]', err); return { success: false, error: err.message }; }
  }

  // ── Fim de ano (§7) ──────────────────────────────────────────────
  function datesInRange(startISO, endISO) {
    const out = [];
    let d = new Date(startISO + 'T00:00:00');
    const end = new Date(endISO + 'T00:00:00');
    while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
    return out;
  }

  // Turnos-padrão do fim de ano (configuráveis via scale_config).
  const DEFAULT_FE_SHIFTS = [
    { id: 'manha',       label: 'Manhã',       startTime: '08:00', endTime: '12:00' },
    { id: 'tarde_noite', label: 'Tarde/Noite', startTime: '16:00', endTime: '21:00' },
  ];

  // Gera as vagas do fim de ano: por DIA (exceto fechados) × unidade × TURNO ×
  // pessoas/turno. SEM modalidade exigida. Cada vaga carrega o horário do turno
  // (pra publicar na agenda direto).
  function templateSlotsFimDeAno(period, units, shifts, peoplePerShift) {
    period = period || {};
    const sh = (shifts && shifts.length) ? shifts : DEFAULT_FE_SHIFTS;
    const ppl = peoplePerShift || 1;
    const closed = new Set(period.closedDays || []);
    const days = datesInRange(period.start, period.end).filter(d => !closed.has(d));
    const out = [];
    days.forEach(day => {
      (units || []).forEach(u => {
        sh.forEach(s => {
          for (let i = 1; i <= ppl; i++) {
            out.push({
              id: `${day}_${u.id}_${s.id}_${i}`, day, unitId: u.id, shift: s.id,
              startTime: s.startTime, endTime: s.endTime,
              requiredModalityId: null, assignedPersonId: null,
            });
          }
        });
      });
    });
    return out;
  }

  // Consolida o fim de ano DIA A DIA (permite repetição entre dias). A carga se
  // espalha sozinha: minMes alto deixa todo mundo "no piso", então o motor sempre
  // pega quem trabalhou MENOS dias no período (mérito/preferência desempatam).
  // Fairness é interno ao período (começa zero; não mistura com a rotação de sábados).
  async function consolidateByDay(scaleId, ctx, deps) {
    try {
      ctx = ctx || {};
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      const scale = scaleRes.data;
      const dpRes = await listDayPreferences(scaleId, deps);
      const avail = dayPrefsToAvailability(dpRes.data || []);
      const teachers = ctx.teachers || [];
      const SE = rSE(deps);
      const opts = { minMes: (ctx.opts && ctx.opts.minMes) || 999 };
      const slots = scale.slots || [];
      const days = [...new Set(slots.map(s => s.day))].sort();
      const working = {};
      const bySlot = {}, byReason = {}, byExplain = {};
      days.forEach(day => {
        const daySlots = slots.filter(s => s.day === day);
        const shifts = [...new Set(daySlots.map(s => s.shift || '_'))];
        shifts.forEach(shift => {
          const shiftSlots = daySlots.filter(s => (s.shift || '_') === shift);
          const prefById = {};
          const eligible = teachers.filter(t => {
            const a = (avail[t.id] || {})[day];
            if (!a) { return true; }                       // sem pref = disponível (retrocompat)
            if (a.pref === 'nao_posso') return false;       // dia bloqueado
            if ((a.excludedShifts || []).includes(shift)) return false; // turno bloqueado
            prefById[t.id] = a.pref || null;                // 'prefiro'/'pode_ser' como peso
            return true;
          });
          const candidates = buildCandidates({ teachers: eligible, meritoById: ctx.meritoById || {}, fairnessById: working, prefById });
          const result = SE.consolidate(shiftSlots, candidates, opts);
          result.assignments.forEach(a => { bySlot[a.slotId] = a.personId; byReason[a.slotId] = a.reason; byExplain[a.slotId] = a.explain || []; });
          Object.keys(result.fairnessDelta).forEach(pid => {
            working[pid] = working[pid] || { diasTrabalhados: 0, divida: 0 };
            working[pid].diasTrabalhados += (result.fairnessDelta[pid].dias || 0);
          });
        });
      });
      const newSlots = slots.map(s => Object.assign({}, s, {
        assignedPersonId: bySlot[s.id] !== undefined ? bySlot[s.id] : s.assignedPersonId,
        reason: byReason[s.id] !== undefined ? byReason[s.id] : (s.reason || null),
        explain: byExplain[s.id] !== undefined ? byExplain[s.id] : (s.explain || []),
      }));
      await rdb(deps).collection('special_scales').doc(scaleId)
        .set({ slots: newSlots, status: 'consolidada', updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      const escalados = new Set(Object.values(bySlot).filter(Boolean));
      const naoEscalados = teachers.filter(t => !escalados.has(t.id)).map(t => t.id);
      return { success: true, data: { naoEscalados, totalSlots: slots.length, diasTrabalhadosPorPessoa: working } };
    } catch (err) { console.error('[ScaleService.consolidateByDay]', err); return { success: false, error: err.message }; }
  }

  // ── Publicar na agenda (§5) ──────────────────────────────────────
  // Escalas especiais são off-grid: publicar = CRIAR aulas taggeadas com
  // specialScaleId/specialScaleSlotId. Idempotente: republicar apaga e recria.
  function _slotMinutes(s) {
    const a = parseInt(s.startTime.slice(0, 2), 10) * 60 + parseInt(s.startTime.slice(3), 10);
    const b = parseInt(s.endTime.slice(0, 2), 10) * 60 + parseInt(s.endTime.slice(3), 10);
    return b - a;
  }

  async function _deleteScaleClasses(scaleId, deps) {
    const snap = await rdb(deps).collection('classes').where('specialScaleId', '==', scaleId).get();
    let blocked = false, removed = 0;
    const blockedSlotIds = [];   // slots com aula já congelada (mês fechado) — não recriar
    for (const doc of snap.docs) {
      if (doc.data().monthClosingId) { blocked = true; if (doc.data().specialScaleSlotId) blockedSlotIds.push(doc.data().specialScaleSlotId); continue; }
      await rdb(deps).collection('classes').doc(doc.id).delete();
      removed++;
    }
    return { removed, blocked, blockedSlotIds };
  }

  async function publishToAgenda(scaleId, deps) {
    try {
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      const scale = scaleRes.data;
      const del = await _deleteScaleClasses(scaleId, deps); // idempotência
      const congelados = new Set(del.blockedSlotIds || []);  // M1: slot já pago não recria (evita aula duplicada)
      const slots = scale.slots || [];
      const vagasAbertas = [];
      let created = 0, jaCongelados = 0;
      for (const s of slots) {
        if (congelados.has(s.id)) { jaCongelados++; continue; }
        if (!s.assignedPersonId) { vagasAbertas.push(s.id); continue; }
        if (!s.startTime || !s.endTime) { vagasAbertas.push(s.id); continue; }
        // fim de ano: cada slot tem seu próprio dia; sábado/feriado usa a data da escala.
        const slotDay = s.day || scale.date;
        const dateVal = (typeof firebase !== 'undefined' && firebase.firestore)
          ? firebase.firestore.Timestamp.fromDate(new Date(slotDay + 'T00:00:00'))
          : slotDay;
        await rdb(deps).collection('classes').doc().set({
          unitId: s.unitId, teacherId: s.assignedPersonId, originalTeacherId: s.assignedPersonId,
          modalityId: s.requiredModalityId || null, startTime: s.startTime, endTime: s.endTime,
          durationMinutes: _slotMinutes(s), status: 'prevista',
          isHoliday: scale.tipo === 'feriado', holidayName: null, holidayType: null,
          cancellationReason: null, cancellationNote: null,
          adjustedBy: null, adjustedAt: null, adjustmentNote: null,
          scheduledDate: dateVal, generatedBy: 'escala-smart',
          specialScaleId: scaleId, specialScaleSlotId: s.id, specialScaleType: null,
          monthClosingId: null, createdAt: rts(deps), updatedAt: rts(deps),
        });
        created++;
      }
      await rdb(deps).collection('special_scales').doc(scaleId)
        .set({ published: true, updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      return { success: true, data: { created, vagasAbertas, jaCongelados } };
    } catch (err) { console.error('[ScaleService.publishToAgenda]', err); return { success: false, error: err.message }; }
  }

  async function unpublishFromAgenda(scaleId, deps) {
    try {
      const res = await _deleteScaleClasses(scaleId, deps);
      if (res.blocked) return { success: false, error: 'Há aulas em mês fechado; não é possível despublicar.' };
      await rdb(deps).collection('special_scales').doc(scaleId)
        .set({ published: false, updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      return { success: true, data: { removed: res.removed } };
    } catch (err) { console.error('[ScaleService.unpublishFromAgenda]', err); return { success: false, error: err.message }; }
  }

  return { templateSlots, templateSlotsFimDeAno, datesInRange, saturdaysOfYear, mergeVirtualWithDocs, parseFeriados, isLegacyScaleDoc, isWindowOpen, nowLocalMinute, filterByTimeframe, buildConsolidationMatrix, escolaInternaSlots, assignSlot, ScaleConfigService, createScale, getScale, listScales, listScalesByBatch, openElection, closeElection, setStatus, setPreference, listPreferences, setDayPreference, listDayPreferences, setEventStaff, listEventRsvp, setRsvp, getFairness, saveFairness, applyFairnessDelta, buildCandidates, dayPrefsToAvailability, summarizeRsvp, isPersonAssigned, consolidate, consolidateByDay, publishToAgenda, unpublishFromAgenda };
});
