// plr-service.js — persistência + orquestração do PLR (spec §5). Injetável (deps).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlrService = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function rdb(deps)  { if (deps && deps.db) return deps.db; return (typeof db !== 'undefined') ? db : null; }
  function rts(deps)  { if (deps && deps.ts) return deps.ts(); return (typeof serverTs === 'function') ? serverTs() : new Date().toISOString(); }
  function ruid(deps) { if (deps && deps.uid) return deps.uid(); return (typeof currentUserId === 'function') ? currentUserId() : null; }
  function rPE(deps)  { if (deps && deps.PE) return deps.PE; return (typeof PlrEngine !== 'undefined') ? PlrEngine : (typeof require !== 'undefined' ? require('./plr-engine.js') : null); }

  const DEFAULT_CONFIG = {
    blocos: [
      { id: 'profissional',   label: 'Profissional',   peso: 30 },
      { id: 'comportamental', label: 'Comportamental', peso: 30 },
      { id: 'tecnica',        label: 'Técnica',        peso: 20 },
      { id: 'engajamento',    label: 'Engajamento',    peso: 20, auto: true },
    ],
    avaliadoresPeso: {},
    elegibilidade: { minMesesCasa: 3, minSaldoPontos: null, estagiarioEntra: true },
    engajamentoNorm: 'proporcional_max',
  };

  // ── Config ──────────────────────────────────────────────────────
  const ConfigService = {
    async get(deps) {
      try {
        const doc = await rdb(deps).collection('plr_config').doc('default').get();
        const base = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        return { success: true, data: doc.exists ? Object.assign(base, doc.data()) : base };
      } catch (err) { console.error('[PlrService.ConfigService.get]', err); return { success: false, error: err.message }; }
    },
    async save(patch, deps) {
      try {
        await rdb(deps).collection('plr_config').doc('default')
          .set(Object.assign({ updatedAt: rts(deps), updatedBy: ruid(deps) }, patch), { merge: true });
        return { success: true };
      } catch (err) { console.error('[PlrService.ConfigService.save]', err); return { success: false, error: err.message }; }
    },
  };

  // ── Ciclos ──────────────────────────────────────────────────────
  async function listCycles(deps) {
    try {
      const snap = await rdb(deps).collection('plr_cycles').orderBy('inicio').get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) { console.error('[PlrService.listCycles]', err); return { success: false, error: err.message }; }
  }
  async function getCycle(id, deps) {
    try {
      const doc = await rdb(deps).collection('plr_cycles').doc(id).get();
      if (!doc.exists) return { success: false, error: 'Ciclo não encontrado' };
      return { success: true, data: { id: doc.id, ...doc.data() } };
    } catch (err) { console.error('[PlrService.getCycle]', err); return { success: false, error: err.message }; }
  }
  async function saveCycle(cycle, deps) {
    try {
      const id = cycle.id || rdb(deps).collection('plr_cycles').doc().id;
      const doc = {
        label: cycle.label || '', inicio: cycle.inicio, fim: cycle.fim,
        pool: Number(cycle.pool) || 0, status: cycle.status || 'aberto',
        externalId: cycle.externalId || '', updatedAt: rts(deps), updatedBy: ruid(deps),
      };
      await rdb(deps).collection('plr_cycles').doc(id).set(doc, { merge: true });
      return { success: true, data: { id, ...doc } };
    } catch (err) { console.error('[PlrService.saveCycle]', err); return { success: false, error: err.message }; }
  }

  // ── Avaliações ──────────────────────────────────────────────────
  function evalId(cycleId, evaluateeId, evaluatorId) { return `${cycleId}__${evaluateeId}__${evaluatorId}`; }

  async function upsertEvaluation(ev, deps) {
    try {
      const id = evalId(ev.cycleId, ev.evaluateeId, ev.evaluatorId);
      const doc = {
        cycleId: ev.cycleId, evaluateeId: ev.evaluateeId, evaluatorId: ev.evaluatorId,
        notas: ev.notas || {}, parecer: ev.parecer || '', updatedAt: rts(deps),
      };
      await rdb(deps).collection('plr_evaluations').doc(id).set(doc, { merge: true });
      return { success: true, data: { id, ...doc } };
    } catch (err) { console.error('[PlrService.upsertEvaluation]', err); return { success: false, error: err.message }; }
  }
  async function listEvaluationsByCycle(cycleId, deps) {
    try {
      const snap = await rdb(deps).collection('plr_evaluations').where('cycleId', '==', cycleId).get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) { console.error('[PlrService.listEvaluationsByCycle]', err); return { success: false, error: err.message }; }
  }

  // ── Cálculo de resultados ───────────────────────────────────────
  // ctx: { pessoas:[{id,name,type,hireDate,saldoPontos}], horasById:{}, engajById:{} }
  async function computeResults(cycleId, ctx, deps) {
    try {
      ctx = ctx || {};
      const PE = rPE(deps);
      const cfgRes = await ConfigService.get(deps);
      if (!cfgRes.success) return cfgRes;
      const config = cfgRes.data;
      const cycRes = await getCycle(cycleId, deps);
      if (!cycRes.success) return cycRes;
      const cycle = cycRes.data;
      const evRes = await listEvaluationsByCycle(cycleId, deps);
      const evalsByEvaluatee = {};
      (evRes.data || []).forEach(e => { (evalsByEvaluatee[e.evaluateeId] = evalsByEvaluatee[e.evaluateeId] || []).push(e); });

      const pessoas = ctx.pessoas || [];
      const engajById = ctx.engajById || {};
      const engajMax = pessoas.reduce((m, p) => Math.max(m, engajById[p.id] || 0), 0);
      const horasById = ctx.horasById || {};

      const linhas = pessoas.map(p => {
        const elig = PE.elegivel({ type: p.type, hireDate: p.hireDate, saldoPontos: p.saldoPontos }, config, cycle.fim);
        const nota = PE.notaFinal(evalsByEvaluatee[p.id] || [], engajById[p.id] || 0, engajMax, config);
        return { pessoaId: p.id, nome: p.name || p.id, horas: horasById[p.id] || 0, nota, elegivel: elig.ok, motivoInelegivel: elig.motivo };
      });
      const elegiveis = linhas.filter(l => l.elegivel);
      const fatias = PE.distribuir(cycle.pool, elegiveis.map(l => ({ id: l.pessoaId, horas: l.horas, nota: l.nota })));
      const fatiaById = {};
      fatias.forEach(f => { fatiaById[f.id] = f.fatia; });
      linhas.forEach(l => { l.fatia = l.elegivel ? (fatiaById[l.pessoaId] || 0) : 0; });
      const total = Math.round(linhas.reduce((s, l) => s + l.fatia, 0) * 100) / 100;
      return { success: true, data: { cycleId, pool: cycle.pool, linhas, total } };
    } catch (err) { console.error('[PlrService.computeResults]', err); return { success: false, error: err.message }; }
  }

  async function closeCycle(cycleId, ctx, deps) {
    try {
      const res = await computeResults(cycleId, ctx, deps);
      if (!res.success) return res;
      await rdb(deps).collection('plr_results').doc(cycleId).set({
        geradoEm: rts(deps), geradoPor: ruid(deps), pool: res.data.pool, linhas: res.data.linhas, total: res.data.total,
      });
      await rdb(deps).collection('plr_cycles').doc(cycleId).set({ status: 'fechado', updatedAt: rts(deps) }, { merge: true });
      return { success: true, data: res.data };
    } catch (err) { console.error('[PlrService.closeCycle]', err); return { success: false, error: err.message }; }
  }

  return { ConfigService, listCycles, getCycle, saveCycle, evalId, upsertEvaluation, listEvaluationsByCycle, computeResults, closeCycle };
});
