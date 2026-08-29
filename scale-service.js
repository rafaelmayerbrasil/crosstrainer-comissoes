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
  // Mesma fonte que o `AuditService.log` usa. Sem isto o histórico mostra o uid
  // cru do Firebase como autor — e "log de alteração por usuário" com um
  // `AbCdEf123456` no lugar do nome não responde a pergunta de ninguém.
  function rnome(deps) { if (deps && deps.nome) return deps.nome(); return (typeof currentUserName === 'function') ? currentUserName() : null; }
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

  // Vaga da Escola Interna: 1 líder, numa unidade só.
  //
  // A sessão acontece em UMA unidade por dia, nunca nas duas ao mesmo tempo
  // (Rafael, 04/08/2026). Antes criava vaga em toda unidade marcada, e como a
  // sessão real só rodava na PP, a vaga da CP ficava eternamente sem líder.
  // Recebe uma lista por retrocompatibilidade, mas só a primeira unidade vale.
  function escolaInternaSlots(units, times) {
    const t = times || {};
    const u = Array.isArray(units) ? units[0] : units;
    if (!u || !u.id) return [];
    return [{
      id: `${u.id}_LIDER`, unitId: u.id, role: 'lider',
      requiredModalityId: null, assignedPersonId: null,
      startTime: t.startTime || '14:30', endTime: t.endTime || '15:30',
    }];
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

  /**
   * Troca manualmente quem ocupa uma vaga de sábado/feriado já consolidada.
   *
   * Antes só existia "Reconsolidar", que refaz a escala inteira pelo algoritmo:
   * discordar de UMA pessoa custava perder todo o resto (Rafael, 12/08/2026 —
   * "podemos apontar algum erro/mudança na criação dela?"). Na Escola Interna a
   * troca já existia; aqui não.
   *
   * O pulo do gato é o contador de JUSTIÇA. Ele já foi creditado na consolidação
   * pra quem o algoritmo escolheu; se a gestão troca e ninguém mexe no contador,
   * quem saiu fica com um dia de crédito que não trabalhou e quem entrou trabalha
   * de graça no rodízio — o insumo central do motor se corrompe em silêncio.
   * Por isso a troca move o crédito junto, e só quando a escala já foi contabilizada.
   */
  async function reassignSlot(scaleId, slotId, newPersonId, deps) {
    try {
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      const scale = scaleRes.data;
      const slot = (scale.slots || []).find(s => s.id === slotId);
      if (!slot) return { success: false, error: 'Vaga não encontrada.' };

      const antes = slot.assignedPersonId || null;
      const depois = newPersonId || null;
      if (antes === depois) return { success: true, data: { changed: false } };

      // A colisão é por DIA: no fim de ano uma escala é o PERÍODO inteiro
      // (vários dias no mesmo documento), e comparar contra a escala inteira
      // proibia a mesma pessoa em dias DIFERENTES do mesmo período — nunca
      // era possível pôr quem trabalhou 20/12 também em 27/12 pela troca
      // manual. Achado em 28/08/2026, estava em produção. Em sábado/feriado
      // `day` é undefined dos dois lados (uma escala = um dia só), então o
      // comportamento pra quem já usa é idêntico.
      // Se UM dos lados não tiver `day` (documento legado, ou editado na mão),
      // o certo é presumir MESMO dia e recusar: errar recusando pede um clique
      // a mais; errar permitindo põe a pessoa em dois lugares ao mesmo tempo.
      const mesmoDia = (s) => !s.day || !slot.day || s.day === slot.day;
      if (depois && (scale.slots || []).some(s => s.id !== slotId && mesmoDia(s) && s.assignedPersonId === depois)) {
        return { success: false, error: 'Essa pessoa já está em outra vaga deste dia.' };
      }

      const slots = (scale.slots || []).map(s => s.id === slotId
        // reason:'manual' pra tabela do "porquê" não seguir alegando justiça/mérito
        // numa escolha que foi da gestão.
        ? Object.assign({}, s, { assignedPersonId: depois, reason: depois ? 'manual' : null, explain: [] })
        : s);
      await rdb(deps).collection('special_scales').doc(scaleId)
        .set({ slots, updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      // `deps.nomePorId` (não `ctx` — esta função não recebe um) é quem a tela
      // manda pra virar id em nome no `detalhe`. Faltando, cai no id cru sem
      // erro nenhum — pegadinha silenciosa pra quem for ligar a tela.
      // O rebalanceio passa `semHistoricoDeVaga`: ele grava a própria linha
      // ('rebalanceada'), que já diz "saiu X, entrou Y". Duas linhas seriam a
      // mesma informação duas vezes, e o histórico tem teto de 50 entradas.
      if (deps && deps.semHistoricoDeVaga) return { success: true, data: { changed: true, from: antes, to: depois, published: !!scale.published } };
      await registrarHistorico(scaleId, {
        acao: 'vaga_trocada',
        detalhe: diffEscalados([slot], slots.filter(s => s.id === slotId), (deps && deps.nomePorId) || {}),
      }, deps);

      // Não há contador pra acertar: quem conta é `contarPorPessoa`, e ela lê
      // esta escala que acabou de ser gravada. A troca manual entra na conta
      // sozinha, na próxima vez que alguém contar.
      return { success: true, data: { changed: true, from: antes, to: depois, published: !!scale.published } };
    } catch (err) { console.error('[ScaleService.reassignSlot]', err); return { success: false, error: err.message }; }
  }

  /**
   * Inverte as pessoas de duas vagas da MESMA escala, numa gravação só.
   *
   * Pelos dois selects não dá: `reassignSlot` recusa pôr alguém que já está em
   * outra vaga do dia — regra certa, que impede a mesma pessoa em duas aulas ao
   * mesmo tempo, mas que torna a troca A↔B impossível passo a passo.
   * (Rafael, 25/08/2026: "Podemos trocar quem da TOI e quem da Hiit"; Rodrigo:
   * "dar a possibilidade de inverter com um click os profs do TOI e Hiit".)
   *
   * Não mexe no contador de justiça: as duas pessoas continuam trabalhando o
   * mesmo dia, só que na outra modalidade.
   */
  async function swapSlots(scaleId, slotAId, slotBId, deps) {
    try {
      if (!slotAId || !slotBId || slotAId === slotBId) {
        return { success: false, error: 'Escolha duas vagas diferentes.' };
      }
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      const scale = scaleRes.data;
      const slots = scale.slots || [];
      const a = slots.find(s => s.id === slotAId);
      const b = slots.find(s => s.id === slotBId);
      if (!a || !b) return { success: false, error: 'Vaga não encontrada.' };
      if (!a.assignedPersonId && !b.assignedPersonId) {
        return { success: false, error: 'As duas vagas estão abertas — não há o que inverter.' };
      }

      const novos = slots.map(s => {
        if (s.id === slotAId) return Object.assign({}, s, { assignedPersonId: b.assignedPersonId || null, reason: b.assignedPersonId ? 'manual' : null, explain: [] });
        if (s.id === slotBId) return Object.assign({}, s, { assignedPersonId: a.assignedPersonId || null, reason: a.assignedPersonId ? 'manual' : null, explain: [] });
        return s;
      });

      await rdb(deps).collection('special_scales').doc(scaleId)
        .set({ slots: novos, updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      // Reaproveita `diffEscalados` em vez de montar "A ⇄ B" na mão: a versão
      // manual perdia a modalidade de cada vaga e, quando só UMA das duas
      // vagas tinha gente (o guard-clause acima só barra as DUAS vazias),
      // produzia um "— ⇄ Nome" sem explicação nenhuma.
      // `deps.nomePorId` (mesma regra de `reassignSlot`: sem `ctx` aqui) —
      // faltando, o histórico cai no id cru, sem quebrar nada.
      await registrarHistorico(scaleId, {
        acao: 'invertida',
        detalhe: diffEscalados([a, b], novos.filter(s => s.id === slotAId || s.id === slotBId), (deps && deps.nomePorId) || {}),
      }, deps);

      return { success: true, data: { published: !!scale.published, from: a.assignedPersonId || null, to: b.assignedPersonId || null } };
    } catch (err) { console.error('[ScaleService.swapSlots]', err); return { success: false, error: err.message }; }
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
        // Nome do feriado quando a data é feriado E a escala foi montada pela
        // aba Sábados. É o que faz a aula nascer em dobro nesse caso.
        feriadoNaData: scale.feriadoNaData || null,
        status: 'rascunho', slots: scale.slots || [], externalId: '',
        createdAt: rts(deps), createdBy: ruid(deps),
      };
      await ref.set(doc);
      return { success: true, data: { id: ref.id, ...doc } };
    } catch (err) { console.error('[ScaleService.createScale]', err); return { success: false, error: err.message }; }
  }

  /**
   * Edita data e/ou horários de uma escala.
   *
   * Só data/horário — quem lidera continua em assignSlot. Preserva o
   * assignedPersonId de cada slot: mudar o horário não pode desescalar ninguém.
   *
   * NÃO republica sozinho: se a escala estiver publicada, quem chama precisa
   * refazer unpublish→publish, senão as aulas já geradas ficam no horário velho.
   */
  async function updateScale(scaleId, { date, startTime, endTime, feriadoNaData }, deps) {
    try {
      const database = rdb(deps);
      const ref = database.collection('special_scales').doc(scaleId);
      const doc = await ref.get();
      if (!doc.exists) return { success: false, error: 'Escala não encontrada' };
      const before = doc.data();

      const patch = { updatedAt: rts(deps), updatedBy: ruid(deps) };
      if (date) {
        patch.date = date;
        if (before.name && /\d{2}\/\d{2}\/\d{4}/.test(before.name)) {
          const [y, m, d] = date.split('-');
          patch.name = before.name.replace(/\d{2}\/\d{2}\/\d{4}/, `${d}/${m}/${y}`);
        }
      }
      // Etiqueta de feriado numa escala de sábado antiga, que nasceu antes da
      // correção de 25/08 e por isso publicaria a aula com peso de sábado.
      if (feriadoNaData !== undefined) patch.feriadoNaData = feriadoNaData || null;
      if (startTime || endTime) {
        patch.slots = (before.slots || []).map(s => Object.assign({}, s, {
          startTime: startTime || s.startTime,
          endTime: endTime || s.endTime,
        }));
      }
      await ref.update(patch);
      return { success: true, data: Object.assign({ id: scaleId }, before, patch) };
    } catch (err) {
      console.error('[ScaleService.updateScale]', err);
      return { success: false, error: err.message };
    }
  }

  /** Apaga a escala. Quem chama tira as aulas da agenda antes (unpublishFromAgenda). */
  async function deleteScale(scaleId, deps) {
    try {
      await rdb(deps).collection('special_scales').doc(scaleId).delete();
      return { success: true };
    } catch (err) {
      console.error('[ScaleService.deleteScale]', err);
      return { success: false, error: err.message };
    }
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
      await registrarHistorico(id, {
        acao: 'janela_aberta',
        detalhe: (opts && opts.closesAt) ? `janela até ${opts.closesAt}` : 'sem prazo definido',
      }, deps);
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

  /**
   * Apaga um EVENTO e os RSVPs dele. Só evento — a regra do Firestore recusa
   * qualquer outro tipo, porque sábado/feriado já mexeram no contador de justiça.
   * Apaga os RSVPs primeiro: se o evento sumisse antes, sobrariam linhas órfãs
   * que ninguém mais consegue achar pra limpar.
   */
  async function deleteEvent(scaleId, deps) {
    try {
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      if (scaleRes.data.tipo !== 'evento') {
        return { success: false, error: 'Só evento pode ser excluído. Para sábado/feriado, edite a escala.' };
      }
      const database = rdb(deps);
      const rsvps = await listEventRsvp(scaleId, deps);
      if (rsvps.success) {
        for (const r of rsvps.data) await database.collection('event_rsvp').doc(r.id).delete();
      }
      await database.collection('special_scales').doc(scaleId).delete();
      return { success: true, data: { rsvpsRemovidos: rsvps.success ? rsvps.data.length : 0 } };
    } catch (err) { console.error('[ScaleService.deleteEvent]', err); return { success: false, error: err.message }; }
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

  /**
   * PURO: quem está de férias/recesso APROVADO na data.
   *
   * O motor só excluía quem marcasse "Não posso" — quem estava de férias e não
   * respondia continuava elegível e podia ser escalado. Passa despercebido numa
   * janela de 15 dias; com 2 meses abertos de uma vez (pedido do Rodrigo em
   * 12/08) vira certeza. Decisão do Rafael: não escalar, sem perguntar.
   *
   * Aceita Timestamp do Firestore, Date ou string — compara como 'YYYY-MM-DD'
   * pra não escorregar em fuso (mesma semântica da CF que pula aula em férias).
   * @returns {Set<string>} teacherIds
   */
  function personsOnVacation(vacationDocs, dateISO) {
    const out = new Set();
    if (!dateISO) return out;
    const ymd = (v) => {
      if (!v) return null;
      if (typeof v === 'string') return v.slice(0, 10);
      const d = (typeof v.toDate === 'function') ? v.toDate() : v;
      if (!(d instanceof Date) || isNaN(d)) return null;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    (vacationDocs || []).forEach(v => {
      if (!v || v.status !== 'aprovada' || !v.teacherId || !Array.isArray(v.periods)) return;
      const cobre = v.periods.some(p => {
        const ini = ymd(p && p.startDate), fim = ymd(p && p.endDate);
        return ini && fim && ini <= dateISO && dateISO <= fim;
      });
      if (cobre) out.add(v.teacherId);
    });
    return out;
  }

  /**
   * PURO: os tipos de escala que contam juntos. Feriado e domingo especial são
   * a mesma coisa pra quem olha ("dia especial que não é sábado") e a aba
   * Feriados sempre mostrou os dois.
   */
  function tiposIrmaos(tipo) {
    return (tipo === 'feriado' || tipo === 'domingo_especial')
      ? ['feriado', 'domingo_especial']
      : [tipo];
  }

  // Dia da semana em array fixo: `Intl`/`toLocaleDateString` dependem do locale
  // do navegador, e a mesma tela mostraria "Friday" em quem estiver com o
  // sistema em inglês. Isto é texto de produto, não de sistema.
  const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

  /**
   * PURO: '2026-11-20' → 'sexta-feira, 20/11/2026'.
   *
   * O cartão da escala imprimia a data crua (Rodrigo, 28/08/2026). Mora no
   * serviço, e não na tela, pra que o teste CHAME a função em vez de ler o texto
   * do arquivo — a lição de 26/08. `T12:00:00` pelo mesmo motivo de
   * `dozeMesesAntes`: não escorregar de dia por fuso.
   */
  function fmtDataLonga(iso) {
    const s = String(iso == null ? '' : iso);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s + 'T12:00:00');
    if (isNaN(d)) return s;
    const [y, m, dd] = s.split('-');
    return `${DIAS_SEMANA[d.getDay()]}, ${dd}/${m}/${y}`;
  }

  /**
   * PURO: mesma data, 12 meses (1 ano) antes — a janela móvel do rodízio.
   * `T12:00:00` local pra não escorregar de dia em fuso horário (mesma
   * convenção de `personsOnNearbyScale`, abaixo). 29/02 que não existe no ano
   * de destino cai no 01/03 por conta do próprio `Date` — canto raro, sem
   * tratamento especial.
   */
  function dozeMesesAntes(dataISO) {
    const d = new Date(dataISO + 'T12:00:00');
    if (isNaN(d)) return null;
    d.setFullYear(d.getFullYear() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * PURO: de que data a contagem do rodízio começa a valer.
   *
   * Dois cortes, vence o mais recente: a janela de 12 meses móveis (que já
   * existia) e o MARCO ZERO configurável (Rafael, 28/08/2026 — "a contagem
   * começa em 01/09, e dá pra zerar na virada do ano"). O marco é um PISO, não
   * um substituto: passado um ano dele, os 12 meses voltam a mandar sozinhos e
   * ninguém precisa lembrar de mexer em nada.
   */
  function dataDeCorte(dataISO, marcoZero) {
    const doze = dozeMesesAntes(dataISO);
    if (!marcoZero) return doze;
    if (!doze) return marcoZero;
    return doze > marcoZero ? doze : marcoZero;
  }

  /**
   * PURO: quantas vagas cada pessoa tem nas escalas que casam com o filtro.
   *
   * Esta função É o contador de justiça. Até 25/08/2026 o número ficava guardado
   * em `fairness_counter` e só se mexia na PRIMEIRA montagem de cada data — então
   * remontar a prévia trocava as pessoas sem refazer a conta, e em produção 9 das
   * 16 pessoas estavam erradas (Karin marcava 1 e tinha 3 sábados). Contar na hora
   * não tem como divergir.
   *
   * @param {Array} scales lista de special_scales (a tela já carrega todas)
   * @param {{tipos?:string[], batchId?:string, de?:string, ate?:string,
   *          excluirDatas?:string[]|Set<string>}} filtro
   * @returns {Object<string, number>} personId → quantas vagas
   */
  function contarPorPessoa(scales, filtro) {
    const f = filtro || {};
    const tipos = (f.tipos && f.tipos.length)
      // Expande aqui, e não no chamador: pedir `tipos: ['feriado']` e receber só
      // feriado, sem os domingos especiais, seria a mesma divergência silenciosa
      // que esta função existe pra matar. Expandir é idempotente — passar a lista
      // já expandida dá o mesmo resultado.
      ? f.tipos.reduce((acc, t) => acc.concat(tiposIrmaos(t)), [])
      : null;
    const excluir = (f.excluirDatas instanceof Set)
      ? f.excluirDatas : new Set(f.excluirDatas || []);
    const out = {};
    (scales || []).forEach(s => {
      if (!s || !s.date) return;
      if (tipos && tipos.indexOf(s.tipo) === -1) return;
      if (f.batchId && s.windowBatchId !== f.batchId) return;
      if (f.de && s.date < f.de) return;
      if (f.ate && s.date > f.ate) return;
      if (excluir.has(s.date)) return;
      (s.slots || []).forEach(sl => {
        const pid = sl && sl.assignedPersonId;
        if (!pid) return;
        out[pid] = (out[pid] || 0) + 1;
      });
    });
    return out;
  }

  /**
   * PURO: quem já está escalado numa data de escala PERTO desta.
   *
   * Nasceu como "sábado imediatamente anterior ou seguinte" (Rafael, 25/08/2026:
   * "Para o professor não trabalhar em um sábado de feriado na sequência de um
   * sábado normal") e a função saía fora se a data não fosse sábado. Rodrigo,
   * 25/08, pediu o outro lado: quem pegou o sábado vizinho ao feriado também não
   * deve pegar o feriado. Uma distância só resolve os dois — 07/09 é segunda, e
   * os sábados 05/09 e 12/09 estão a 2 e 5 dias; entre sábados, ±7 dá exatamente
   * o anterior e o seguinte, que é o comportamento de sempre.
   *
   * A PRÓPRIA data fica de fora: uma escala não pode barrar os próprios
   * candidatos (quem já está numa vaga do dia já é barrado pelo motor).
   * Escola Interna, evento e fim de ano ficam de fora — "só pra sábado mesmo".
   *
   * @returns {Set<string>} teacherIds
   */
  function personsOnNearbyScale(scales, dateISO, dias) {
    const out = new Set();
    if (!dateISO) return out;
    const janela = (dias == null) ? 7 : dias;
    const base = new Date(dateISO + 'T12:00:00');
    if (isNaN(base)) return out;
    (scales || []).forEach(s => {
      if (!s || !s.date || s.date === dateISO) return;
      if (s.tipo !== 'sabado' && s.tipo !== 'feriado' && s.tipo !== 'domingo_especial') return;
      const d = new Date(s.date + 'T12:00:00');
      if (isNaN(d)) return;
      const dist = Math.abs(Math.round((d - base) / 86400000));
      if (dist > janela) return;
      (s.slots || []).forEach(sl => { if (sl.assignedPersonId) out.add(sl.assignedPersonId); });
    });
    return out;
  }

  function buildCandidates(ctx) {
    const merito = ctx.meritoById || {};
    const fair = ctx.fairnessById || {};
    const pref = ctx.prefById || {};
    const cota = ctx.cotaById || {};        // quantos dias a pessoa quer NESTA janela
    const jaNoLote = ctx.jaNoLoteById || {};  // quantos já pegou nela
    const vizinho = ctx.vizinhoById;        // Set de quem pegou o sábado ao lado
    const ehVizinho = (id) => !!(vizinho && typeof vizinho.has === 'function' && vizinho.has(id));
    return (ctx.teachers || []).map(t => ({
      id: t.id, modalityIds: t.modalityIds || [], primaryUnitId: t.primaryUnitId || null,
      merito: merito[t.id] || 0,
      diasTrabalhados: (fair[t.id] && fair[t.id].diasTrabalhados) || 0,
      divida: (fair[t.id] && fair[t.id].divida) || 0,
      pref: pref[t.id] || null,
      cotaDesejada: (cota[t.id] === 0 || cota[t.id] > 0) ? cota[t.id] : null,
      jaNoLote: jaNoLote[t.id] || 0,
      trabalhouSabadoVizinho: ehVizinho(t.id),
    }));
  }

  // ── Cota da janela: quantos dias a pessoa QUER trabalhar no lote ──────
  // Pedido do Rodrigo em 24/08/2026: "tem gente que precisa de mais, e tem
  // gente que de menos". Guardada por LOTE (janela), não por data — a pergunta
  // é "quantos desses dias você quer", e não "você pode neste dia".

  async function setWindowQuota(batchId, personId, desejado, deps) {
    if (!batchId || !personId) return { success: false, error: 'batchId e personId obrigatórios' };
    try {
      const n = (desejado === null || desejado === undefined || desejado === '') ? null : Math.max(0, Number(desejado) || 0);
      await rdb(deps).collection('scale_window_quotas').doc(`${batchId}_${personId}`)
        .set({ batchId, personId, desejado: n, updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      return { success: true };
    } catch (err) { console.error('[ScaleService.setWindowQuota]', err); return { success: false, error: err.message }; }
  }

  /** @returns {{success:boolean, data:Object<string,number|null>}} personId → desejado */
  async function listWindowQuotas(batchId, deps) {
    if (!batchId) return { success: true, data: {} };
    try {
      const snap = await rdb(deps).collection('scale_window_quotas').where('batchId', '==', batchId).get();
      const out = {};
      snap.docs.forEach(d => { const q = d.data(); if (q.personId) out[q.personId] = q.desejado; });
      return { success: true, data: out };
    } catch (err) { console.error('[ScaleService.listWindowQuotas]', err); return { success: false, error: err.message, data: {} }; }
  }

  // ── Histórico da escala (pedido 6, 28/08/2026) ──────────────────────
  // Mora DENTRO do documento da escala, e não em `audit_log`, por um motivo
  // duro: `audit_log` é `allow read: if isAdmin()`. A Supervisão, que é gestão
  // para todo o resto da escala, não conseguiria ler — a tela nasceria invisível
  // para metade de quem precisa dela. `special_scales` já é legível pelo módulo.
  // 50 é teto de TAMANHO DE DOCUMENTO (Firestore, 1 MiB por doc), não política
  // de retenção — não é "guardamos 50 dias" nem "50 ações", é só o que cabe
  // folgado sem disputar espaço com `slots`.
  const HISTORICO_MAX = 50;

  /** PURO: acrescenta uma entrada e corta as mais velhas. */
  function appendHistorico(lista, entrada, max) {
    const cap = max || HISTORICO_MAX;
    const out = (Array.isArray(lista) ? lista.slice() : []).concat([entrada]);
    return out.length > cap ? out.slice(out.length - cap) : out;
  }

  /** PURO: o que mudou entre dois conjuntos de vagas, por NOME. */
  function diffEscalados(antes, depois, nomePorId) {
    const nome = (id) => (nomePorId && nomePorId[id]) || id;
    const mapa = {};
    (antes || []).forEach(s => { mapa[s.id] = s.assignedPersonId || null; });
    const partes = [];
    (depois || []).forEach(s => {
      const a = mapa[s.id] || null;
      const b = s.assignedPersonId || null;
      if (a === b) return;
      const rot = s.requiredModalityName ? ` (${s.requiredModalityName})` : '';
      if (a && b) partes.push(`saiu ${nome(a)}, entrou ${nome(b)}${rot}`);
      else if (b) partes.push(`entrou ${nome(b)}${rot}`);
      else partes.push(`saiu ${nome(a)}${rot}`);
    });
    return partes.length ? partes.join(' · ') : 'nada mudou';
  }

  /**
   * Grava uma linha no histórico da escala. Efeito colateral: se falhar, NÃO
   * derruba a ação que estava sendo registrada — log perdido é ruim, ação
   * perdida pela metade é pior.
   *
   * `ts` é string ISO do cliente de propósito: o Firestore recusa
   * `serverTimestamp()` dentro de array.
   *
   * Isto é read-modify-write sem transação: duas ações simultâneas na MESMA
   * escala podem perder uma linha. Aceito de propósito — é log de auditoria,
   * não insumo do motor (diferente do contador de justiça, que era, e por isso
   * torceu escala real). `arrayUnion` não resolveria: ele soma, não corta, e o
   * cap de 50 deixaria de valer.
   */
  async function registrarHistorico(scaleId, { acao, detalhe, nome }, deps) {
    try {
      const ref = rdb(deps).collection('special_scales').doc(scaleId);
      const doc = await ref.get();
      if (!doc.exists) {
        console.error('[ScaleService.registrarHistorico] escala não encontrada', scaleId);
        return { success: false, error: 'Escala não encontrada' };
      }
      const entrada = {
        ts: new Date().toISOString(), uid: ruid(deps) || null,
        nome: nome || rnome(deps) || null, acao: acao || 'alterada', detalhe: detalhe || '',
      };
      await ref.set({ historico: appendHistorico((doc.data() || {}).historico, entrada) }, { merge: true });
      return { success: true, data: entrada };
    } catch (err) {
      console.error('[ScaleService.registrarHistorico] log perdido, ação mantida', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Monta uma escala especial: pega os candidatos elegíveis, chama o motor
   * puro (`scale-engine.js`) e grava as vagas escolhidas.
   *
   * @param {string} scaleId id do documento em `special_scales`
   * @param {Object} ctx contrato de entrada. Onze chaves — duas delas, se
   *   faltarem, DEGRADAM o rodízio pra "decide só por mérito" SEM ERRO
   *   NENHUM (`teachers`, `scalesDoAno`):
   *   - {Array} teachers — candidatos (elegibilidade por modalidade é feita
   *     pelo motor, a partir de `requiredModalityId` de cada slot).
   *   - {Object<string,number>} meritoById — desempate do rodízio (fixo,
   *     não muda entre consolidações; é o motivo de nunca poder ser o
   *     critério principal).
   *   - {Array} vacations — pedidos de férias; quem tem período aprovado
   *     cobrindo a data da escala sai do páreo antes de qualquer cálculo.
   *   - {Object} opts — repassado cru pro motor (`minMes`, etc.).
   *   - {Object<string,number>} cotaById — quanto cada um quer trabalhar
   *     nesta janela (teto macio).
   *   - {Object<string,number>} jaNoLoteById — quanto cada um já pegou
   *     nesta janela, pra comparar com a cota.
   *   - {Array} scalesDoAno — ⚠️ PRATICAMENTE OBRIGATÓRIA pra `sabado`,
   *     `feriado` e `domingo_especial`: é dela que sai a contagem do
   *     rodízio (via `contarPorPessoa`) E quem trabalhou numa data vizinha
   *     (via `personsOnNearbyScale`). Faltando ou vazia, `contarPorPessoa`
   *     conta 0 pra todo mundo — todo mundo empata no rodízio e quem decide
   *     é só o mérito, sem erro, sem log (por isso o `console.warn` abaixo).
   *     Duas pegadinhas que só se descobrem lendo o código:
   *       1. quem consolida em LOTE (várias datas seguidas na mesma rodada)
   *          tem que REALIMENTAR `scalesDoAno` com as escalas já montadas
   *          nesta mesma rodada antes de consolidar a próxima data — senão
   *          todas as datas do lote decidem com o histórico de ANTES do
   *          lote, como se as anteriores não tivessem acontecido, e voltam
   *          a empatar entre si.
   *       2. apesar do nome, `scalesDoAno` carrega escalas de TODOS os anos,
   *          não só do ano corrente — o recorte pela janela de 12 meses é
   *          feito AQUI DENTRO (`dozeMesesAntes`). Quem pré-filtrar por ano
   *          antes de montar `ctx` quebra a consolidação de qualquer escala
   *          cuja janela cruze a virada do ano.
   *   - {Set<string>|Array<string>} excluirDatas — datas extras a tirar da
   *     contagem, além da própria data da escala (que sai sempre).
   *   - {string|null} marcoZero — data a partir da qual a contagem vale
   *     (`YYYY-MM-DD`). Se a chave NÃO vier, a função lê de `scale_config`;
   *     passar `null` explicitamente desliga o marco.
   *   - {string} [acaoHistorico] — rótulo da ação gravada no histórico da
   *     escala (Task 9). Sem ela, vale 'consolidada'; a tela manda 'refeita'
   *     quando o chamador é o botão 🔄 Refazer, pra não se confundir com uma
   *     montagem qualquer no histórico.
   *   - {Object<string,string>} [nomePorId] — nome de exibição por id, usado
   *     só para compor o `detalhe` do histórico (quem entrou/saiu). Sem ela,
   *     o histórico mostra o id cru — feio, mas nunca quebra.
   * @param {Object} deps
   * @returns {Promise<{success:boolean, data?:{assignments:Array}, error?:string}>}
   */
  async function consolidate(scaleId, ctx, deps) {
    try {
      ctx = ctx || {};
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      const scale = scaleRes.data;
      // Sem data válida não tem como contar o rodízio: `slice(0,4)` numa data
      // ausente/malformada dava `de: '-01-01'`, que filtra TODAS as escalas
      // do histórico e zera a contagem de todo mundo em silêncio (achado na
      // revisão de 26/08/2026). Recusa aqui é melhor que montar a escala com
      // o rodízio cego.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(scale.date || ''))) {
        return { success: false, error: `Data da escala inválida ("${scale.date}") — não dá pra contar o rodízio sem uma data no formato YYYY-MM-DD.` };
      }
      // Nada de "só a 1ª consolidação conta": o número é CONTADO na hora, então
      // remontar quantas vezes quiser dá sempre a mesma resposta.
      const prefsRes = await listPreferences(scaleId, deps);
      const prefById = {};
      (prefsRes.data || []).forEach(p => { prefById[p.personId] = p.pref; });
      // Quem está de férias aprovadas nesta data sai do páreo antes de qualquer
      // cálculo — não é candidato preterido, é candidato inexistente.
      const deFerias = personsOnVacation(ctx.vacations, scale.date);
      const teachers = (ctx.teachers || []).filter(t => !deFerias.has(t.id));
      // O contador é contado das escalas, numa janela de 12 MESES MÓVEIS pra
      // trás a partir da data desta escala — não o ano civil. Motivo
      // (26/08/2026): com ano civil, 1º de janeiro zerava o rodízio de todo
      // mundo — e como `divida` também é sempre 0 agora (não sobrou nada que
      // a incremente), o comparador caía direto no mérito fixo: o mesmo
      // defeito que este branch existe pra matar, voltando a cada virada de
      // ano. Também resolve o lote que atravessa o ano: com ano civil, cada
      // data do lote contava num universo diferente.
      const ate = scale.date;
      // Marco zero: o ctx manda (é como os testes injetam), senão vale a config.
      // Ler AQUI DENTRO e não confiar no chamador é de propósito: chamador que
      // esquecesse de passar faria o rodízio decidir num universo diferente sem
      // erro nenhum — a falha silenciosa clássica desta base.
      let marcoZero = ctx.marcoZero;
      if (marcoZero === undefined) {
        const cfg = await ScaleConfigService.get(deps);
        if (!cfg.success) {
          // Mesma lógica do warn de `scalesDoAno` vazio, logo abaixo: a
          // consolidação segue (12 meses móveis é comportamento válido), mas
          // ninguém pode achar que o marco foi aplicado sem checar o console.
          console.warn(`[ScaleService.consolidate] não deu pra ler scale_config para aplicar o marco zero de ${scale.date} — consolidando sem marco.`);
          marcoZero = null;
        } else {
          const bruto = cfg.data && cfg.data.marcoZero;
          // Blindado: um doc corrompido em `scale_config` (Timestamp do
          // Firestore, string fora do formato) não pode virar corte de
          // janela sem sentido em silêncio — mesma classe de bug que a
          // checagem de `scale.date`, duas linhas acima, existe pra matar.
          // Aqui o fallback (12 meses) é válido; só não pode ser mudo.
          if (bruto && !/^\d{4}-\d{2}-\d{2}$/.test(String(bruto))) {
            console.warn(`[ScaleService.consolidate] marco zero configurado ("${bruto}") não é uma data YYYY-MM-DD válida — ignorando e consolidando sem marco.`);
            marcoZero = null;
          } else {
            marcoZero = bruto || null;
          }
        }
      }
      const de = dataDeCorte(scale.date, marcoZero);
      // `excluirDatas` tira do bolo as datas que estão sendo remontadas nesta
      // rodada e ainda carregam a escala ANTIGA — contá-las empurraria as
      // pessoas erradas. A própria data sempre sai, pelo mesmo motivo. (A
      // exclusão é por DATA, não por id do documento: se dois documentos do
      // mesmo grupo de tipos dividirem a mesma data — feriado + domingo
      // especial criados à mão no mesmo dia, por exemplo —, consolidar um
      // tira o outro da conta. Raro, e `personsOnNearbyScale` tem a mesma
      // característica; decisão foi não tratar, 26/08/2026.)
      const excluir = new Set(Array.from(ctx.excluirDatas || []));
      excluir.add(scale.date);
      const scalesDoAno = ctx.scalesDoAno || [];
      // Falha silenciosa vira falha visível: sem histórico, `contarPorPessoa`
      // conta 0 pra todo mundo, todo mundo empata no rodízio e quem decide é
      // só o mérito — sem erro nenhum. Só nos tipos em que isso importa.
      if (!scalesDoAno.length && ['sabado', 'feriado', 'domingo_especial'].indexOf(scale.tipo) !== -1) {
        console.warn(`[ScaleService.consolidate] ctx.scalesDoAno vazio para escala "${scale.tipo}" de ${scale.date} — rodízio vai empatar todo mundo e decidir só por mérito.`);
      }
      const contagem = contarPorPessoa(scalesDoAno, {
        tipos: tiposIrmaos(scale.tipo),
        de, ate,
        excluirDatas: excluir,
      });
      // A contagem vem SÓ das escalas. O "ajuste de partida" lançado na mão foi
      // aposentado em 28/08/2026 (pedido 1 do Rodrigo, aprovado pelo Rafael):
      // era um segundo caminho para o mesmo número, e foi por ele que a Heloísa
      // saiu de 4 para 7. Um caminho só não tem como divergir.
      const fairnessById = {};
      teachers.forEach(t => {
        fairnessById[t.id] = { diasTrabalhados: contagem[t.id] || 0, divida: 0 };
      });
      // Quem pegou uma data vizinha (sábado ou feriado, ±7 dias) vai pro fim da
      // fila. Escola Interna e evento ficam de fora ("só pra sábado mesmo",
      // Rafael 25/08). A tela manda as escalas do ano em ctx.scalesDoAno.
      //
      // As datas excluídas saem daqui também: numa remontagem elas ainda
      // carregam a escala ANTIGA, e deixá-las falar aqui empurraria as pessoas
      // pro fim da fila por causa de um dia que está prestes a deixar de
      // existir — enviesando justamente a remontagem que existe pra corrigir o
      // viés. (26/08/2026)
      const vizinhoById = personsOnNearbyScale(
        scalesDoAno.filter(s => s && !excluir.has(s.date)), scale.date);
      const candidates = buildCandidates({
        teachers, meritoById: ctx.meritoById || {}, fairnessById, prefById,
        cotaById: ctx.cotaById || {}, jaNoLoteById: ctx.jaNoLoteById || {},
        vizinhoById,
      });
      const result = rSE(deps).consolidate(scale.slots || [], candidates, ctx.opts || {});
      const bySlot = {}, byReason = {}, byExplain = {};
      result.assignments.forEach(a => { bySlot[a.slotId] = a.personId; byReason[a.slotId] = a.reason; byExplain[a.slotId] = a.explain || []; });
      const newSlots = (scale.slots || []).map(s => Object.assign({}, s, {
        assignedPersonId: bySlot[s.id] !== undefined ? bySlot[s.id] : s.assignedPersonId,
        reason: byReason[s.id] !== undefined ? byReason[s.id] : (s.reason || null),
        explain: byExplain[s.id] !== undefined ? byExplain[s.id] : (s.explain || []),
      }));
      await rdb(deps).collection('special_scales').doc(scaleId)
        .set({ slots: newSlots, status: 'consolidada', updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      // `ctx.acaoHistorico` deixa o REFAZER se identificar como tal. Sem isso,
      // refazer a janela gravaria "consolidada" de novo e a pergunta do Rodrigo
      // — "alguém mexeu?" — continuaria sem resposta, porque montar e REMONTAR
      // ficariam indistinguíveis no histórico.
      await registrarHistorico(scaleId, {
        acao: ctx.acaoHistorico || 'consolidada',
        detalhe: diffEscalados(scale.slots || [], newSlots, ctx.nomePorId || {}),
      }, deps);
      return { success: true, data: { assignments: result.assignments } };
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
        // Férias valem por DIA aqui: o período de fim de ano cruza recesso de gente.
        const deFeriasNoDia = personsOnVacation(ctx.vacations, day);
        shifts.forEach(shift => {
          const shiftSlots = daySlots.filter(s => (s.shift || '_') === shift);
          const prefById = {};
          const eligible = teachers.filter(t => {
            if (deFeriasNoDia.has(t.id)) return false;      // de férias aprovadas nesse dia
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
      // `diffEscalados` (mesma usada em `consolidate`) responde "quem mexeu, e
      // o quê" — a pergunta que a Task 9 existe pra responder — em vez de só
      // "quantas vagas mexeram". Sem isso a mesma ação 'consolidada' falava
      // duas línguas dependendo de qual das duas funções gravou.
      // `ctx.nomePorId` (esta função recebe `ctx`, diferente de reassignSlot/
      // swapSlots) — sem ela, o histórico cai no id cru, sem quebrar nada.
      await registrarHistorico(scaleId, {
        acao: 'consolidada',
        detalhe: diffEscalados(slots, newSlots, ctx.nomePorId || {}),
      }, deps);
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
        // SEMPRE Date. Antes era Timestamp no navegador e a STRING crua em
        // qualquer outro lugar — e string não entra em busca por intervalo de
        // data, que é como a Agenda e o fechamento acham aula. Rodando este
        // mesmo serviço fora do navegador (24/08/2026), as 44 aulas de escala
        // nasceram invisíveis: `where scheduledDate >= X <= Y` devolvia zero.
        // Os dois SDKs convertem Date em Timestamp sozinhos.
        const dateVal = new Date(slotDay + 'T00:00:00');
        await rdb(deps).collection('classes').doc().set({
          unitId: s.unitId, teacherId: s.assignedPersonId, originalTeacherId: s.assignedPersonId,
          modalityId: s.requiredModalityId || null, startTime: s.startTime, endTime: s.endTime,
          durationMinutes: _slotMinutes(s), status: 'prevista',
          // Feriado manda, venha a escala pela aba Sábados ou pela aba Feriados.
          // Antes só `tipo === 'feriado'` pagava em dobro — sábado que também
          // era feriado nascia com peso 1 (Rafael, 25/08/2026: "quando um
          // feriado cai em um sabado ele nao entra como feriado"; Rodrigo
          // confirmou: "é pago em dobro como feriado normal").
          isHoliday: scale.tipo === 'feriado' || !!scale.feriadoNaData,
          holidayName: scale.tipo === 'feriado' ? (scale.name || null) : (scale.feriadoNaData || null),
          holidayType: null,
          cancellationReason: null, cancellationNote: null,
          adjustedBy: null, adjustedAt: null, adjustmentNote: null,
          scheduledDate: dateVal, generatedBy: 'escala-smart',
          specialScaleId: scaleId, specialScaleSlotId: s.id,
          // Vinha null: a agenda não sabia dizer o que era a aula (mostrava "—") e
          // o peso da escala nunca era aplicado. Os tipos que casam com scale_types
          // dão o mesmo peso de hoje (sabado=1; feriado=2 já vinha por isHoliday),
          // então preencher NÃO muda pagamento de escala nenhuma.
          specialScaleType: scale.tipo || null,
          // Escola Interna não é paga (confirmado pelo Rafael em 04/08/2026). Sem
          // isso ela entraria na folha como aula normal — 1h/dia por professor.
          remunerada: scale.tipo !== 'escola_interna',
          monthClosingId: null, createdAt: rts(deps), updatedAt: rts(deps),
        });
        created++;
      }
      await rdb(deps).collection('special_scales').doc(scaleId)
        .set({ published: true, updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      await registrarHistorico(scaleId, {
        acao: 'publicada',
        detalhe: `${created} aula(s) na agenda${vagasAbertas.length ? ` · ${vagasAbertas.length} vaga(s) aberta(s)` : ''}`,
      }, deps);
      return { success: true, data: { created, vagasAbertas, jaCongelados } };
    } catch (err) { console.error('[ScaleService.publishToAgenda]', err); return { success: false, error: err.message }; }
  }

  async function unpublishFromAgenda(scaleId, deps) {
    try {
      const res = await _deleteScaleClasses(scaleId, deps);
      if (res.blocked) return { success: false, error: 'Há aulas em mês fechado; não é possível despublicar.' };
      await rdb(deps).collection('special_scales').doc(scaleId)
        .set({ published: false, updatedAt: rts(deps), updatedBy: ruid(deps) }, { merge: true });
      await registrarHistorico(scaleId, { acao: 'despublicada', detalhe: `${res.removed} aula(s) removida(s) da agenda` }, deps);
      return { success: true, data: { removed: res.removed } };
    } catch (err) { console.error('[ScaleService.unpublishFromAgenda]', err); return { success: false, error: err.message }; }
  }

  /**
   * Tira uma data do lote: sai da janela, as vagas são limpas e ela volta pro
   * rascunho. Pedido 7 do Rodrigo (28/08/2026) — nasceu de 02/11 e 20/11, que
   * foram consolidados fora de qualquer janela e ficaram com gente escalada numa
   * escala que ninguém abriu.
   *
   * Se estiver publicada, despublica ANTES: deixar aula na agenda de uma escala
   * que voltou pro rascunho é o pior dos dois mundos.
   */
  async function removeFromBatch(scaleId, deps) {
    try {
      const scaleRes = await getScale(scaleId, deps);
      if (!scaleRes.success) return scaleRes;
      const scale = scaleRes.data;
      if (scale.published) {
        const un = await unpublishFromAgenda(scaleId, deps);
        if (!un.success) return un;   // mês fechado: erro claro, não silêncio
      }
      const slots = (scale.slots || []).map(s => Object.assign({}, s, {
        assignedPersonId: null, reason: null, explain: [],
      }));
      await rdb(deps).collection('special_scales').doc(scaleId).set({
        slots, status: 'rascunho', windowBatchId: null, windowClosesAt: null,
        updatedAt: rts(deps), updatedBy: ruid(deps),
      }, { merge: true });
      await registrarHistorico(scaleId, {
        acao: 'tirada_do_lote',
        detalhe: `saiu do lote ${scale.windowBatchId || '—'}; ${(scale.slots || []).filter(s => s.assignedPersonId).length} vaga(s) limpa(s)`,
      }, deps);
      return { success: true, data: { erasBatchId: scale.windowBatchId || null } };
    } catch (err) { console.error('[ScaleService.removeFromBatch]', err); return { success: false, error: err.message }; }
  }

  /**
   * Aplica um plano vindo de `ScaleRebalance.planejar`.
   *
   * Data publicada É mexida (Rafael, 28/08/2026: "por erros que podem acontecer
   * no futuro pelos gestores, deve ser possível alterar a data já publicada") —
   * mas nunca em silêncio: republica a agenda e devolve a lista de quem precisa
   * ser avisado. Quem avisa é a tela, que é quem tem NotifyService.
   *
   * Data NÃO publicada não gera aviso nenhum: o professor não enxerga escala não
   * publicada desde 26/08, e avisar seria contar o que ele não pode ver.
   */
  async function aplicarRebalanceamento({ pessoaId, movimentos, nomePorId, de, para }, deps) {
    try {
      const nome = (id) => (nomePorId && nomePorId[id]) || id;
      const aplicados = [], falhas = [], aRepublicar = new Set(), avisar = [];
      for (const mv of (movimentos || [])) {
        // `semHistoricoDeVaga`: `reassignSlot` grava 'vaga_trocada' sozinho. Aqui
        // isso seria a MESMA informação duas vezes — 'rebalanceada' já diz
        // "saiu X, entrou Y". E o histórico tem teto de 50: duplicar gastaria
        // metade da janela por evento.
        const res = await reassignSlot(mv.scaleId, mv.slotId, mv.entraId,
          Object.assign({}, deps, { semHistoricoDeVaga: true }));
        if (!res.success) { falhas.push(`${mv.date}: ${res.error}`); continue; }
        // Replay do mesmo plano não é evento: sem isto, reaplicar gravaria
        // histórico e avisaria as pessoas de uma troca que não aconteceu.
        if (res.data && res.data.changed === false) continue;
        aplicados.push(mv);
        await registrarHistorico(mv.scaleId, {
          acao: 'rebalanceada',
          detalhe: `${nome(pessoaId)} ${de} → ${para}: saiu ${nome(mv.saiId)}, entrou ${nome(mv.entraId)}`
                 + (mv.modalidade ? ` (${mv.modalidade})` : ''),
        }, deps);
        if (mv.published) aRepublicar.add(mv.scaleId);
      }
      for (const scaleId of aRepublicar) {
        // 🚨 `publishToAgenda` APAGA e recria TODAS as aulas do documento, não
        // só as do dia mexido. No fim de ano o período inteiro divide um único
        // `scaleId`: ajustar uma pessoa num dia jogaria fora a aula já dada de
        // outro dia — `realizada` voltaria a `prevista`, e presença/ocorrência
        // iriam junto, porque a recriação é `.set()` em documento novo.
        // A regra de operação de 25/08 ("só reconsolidar o que ainda não
        // aconteceu") existia no papel; aqui ela vira trava.
        const cls = await rdb(deps).collection('classes').where('specialScaleId', '==', scaleId).get();
        const realizadas = cls.docs.filter(d => {
          const c = d.data() || {};
          return c.status === 'realizada' && !c.monthClosingId;
        }).length;
        if (realizadas > 0) {
          falhas.push(`${scaleId}: ${realizadas} aula(s) já realizada(s) — republicar apagaria o registro delas. Ajuste apenas datas que ainda não aconteceram.`);
          continue;
        }
        const pub = await publishToAgenda(scaleId, deps);
        if (!pub.success) { falhas.push(`republicar ${scaleId}: ${pub.error}`); continue; }
        // 🚨 Aula em mês fechado NÃO é recriada — `publishToAgenda` a conta em
        // `jaCongelados` e segue como sucesso. Sem esta checagem a escala mudava,
        // a agenda ficava com o professor ANTIGO, e ainda avisávamos as duas
        // pessoas de uma troca que não existe na prática. É o mesmo defeito do
        // Reconsolidar (25/08): divergência silenciosa entre escala e agenda.
        if (pub.data && pub.data.jaCongelados > 0) {
          falhas.push(`${scaleId}: ${pub.data.jaCongelados} aula(s) em mês fechado — a agenda NÃO foi atualizada`);
          continue;
        }
        aplicados.filter(mv => mv.scaleId === scaleId && mv.published).forEach(mv => avisar.push(mv));
      }
      return {
        success: falhas.length === 0,
        data: { aplicados: aplicados.length, movimentos: aplicados, avisar, republicadas: aRepublicar.size },
        error: falhas.length ? falhas.join(' · ') : undefined,
      };
    } catch (err) {
      console.error('[ScaleService.aplicarRebalanceamento]', err);
      return { success: false, error: err.message };
    }
  }

  return { templateSlots, templateSlotsFimDeAno, datesInRange, saturdaysOfYear, mergeVirtualWithDocs, parseFeriados, isLegacyScaleDoc, isWindowOpen, nowLocalMinute, filterByTimeframe, buildConsolidationMatrix, contarPorPessoa, tiposIrmaos, dataDeCorte, fmtDataLonga, escolaInternaSlots, assignSlot, reassignSlot, swapSlots, ScaleConfigService, createScale, updateScale, deleteScale, getScale, listScales, listScalesByBatch, openElection, closeElection, setStatus, setPreference, listPreferences, setDayPreference, listDayPreferences, setEventStaff, listEventRsvp, setRsvp, buildCandidates, setWindowQuota, listWindowQuotas, dayPrefsToAvailability, personsOnVacation, personsOnNearbyScale, deleteEvent, summarizeRsvp, isPersonAssigned, consolidate, consolidateByDay, publishToAgenda, unpublishFromAgenda, removeFromBatch, appendHistorico, diffEscalados, registrarHistorico, aplicarRebalanceamento };
});
