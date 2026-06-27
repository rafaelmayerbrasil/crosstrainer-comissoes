// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Módulo Professores · Escala Inteligente (sábados/feriados)
// UI que consome ScaleService (CRUD + consolidação) + ScaleEngine.
// Plano: docs/superpowers/plans/2026-06-24-escala-ui.md (5b).
// Adapta por perfil: gestão = visão de gestão; professor = marcar preferências.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const EscalaSmartState = { scales: [], units: [], modToi: null, modHiit: null, selectedId: null, teacherMap: new Map(), fairnessMap: new Map() };

const ESCALA_TIPOS = [
  { id: 'sabado',           label: 'Sábado' },
  { id: 'feriado',          label: 'Feriado' },
  { id: 'domingo_especial', label: 'Domingo especial' },
  { id: 'evento',           label: 'Evento' },
  { id: 'fim_de_ano',       label: 'Fim de ano' },
];
const ESCALA_STATUS_LABEL = { rascunho: 'Rascunho', janela_aberta: 'Janela aberta', consolidada: 'Consolidada' };

function escalaIsManagement() {
  return (typeof isAdminGestao === 'function' && isAdminGestao()) ||
         (typeof isSupervisao === 'function' && isSupervisao());
}
function escalaProfId() {
  return (typeof AppState === 'object' && AppState.userProfile) ? AppState.userProfile.professorId : null;
}
function escalaTodayISO() { return new Date().toISOString().slice(0, 10); }

function renderEscalaSmartPage() {
  if (escalaIsManagement()) renderEscalaGestao();
  else renderEscalaPrefs();
}

/* ─── Carga comum ──────────────────────────────────────────────────── */
async function escalaLoadBase() {
  const [scalesRes, unitsRes, modsRes, teachersRes] = await Promise.all([
    ScaleService.listScales(),
    (typeof UnitService === 'object' ? UnitService.list() : Promise.resolve({ success: true, data: [] })),
    ModalityService.list(),
    TeacherService.list(),
  ]);
  EscalaSmartState.scales = scalesRes.success ? scalesRes.data : [];
  EscalaSmartState.units = unitsRes.success ? unitsRes.data : [];
  const mods = modsRes.success ? modsRes.data : [];
  EscalaSmartState.modToi = mods.find(m => /toi/i.test(m.name)) || null;
  EscalaSmartState.modHiit = mods.find(m => /hi+t|maromb/i.test(m.name)) || null;
  EscalaSmartState.teacherMap = new Map((teachersRes.success ? teachersRes.data : []).map(t => [t.id, t]));
  // carrega o contador de justiça/compensação de cada colaborador ativo (p/ painel de equilíbrio)
  const fmap = new Map();
  for (const t of EscalaSmartState.teacherMap.values()) {
    if (t.isActive === false) continue;
    const fr = await ScaleService.getFairness(t.id);
    fmap.set(t.id, fr.success ? fr.data : { diasTrabalhados: 0, divida: 0 });
  }
  EscalaSmartState.fairnessMap = fmap;
}

function renderEquilibrioPainel() {
  const fm = EscalaSmartState.fairnessMap || new Map();
  if (fm.size === 0) return '';
  const dias = Array.from(fm.values()).map(f => f.diasTrabalhados || 0);
  const avg = dias.reduce((a, b) => a + b, 0) / dias.length;
  let abaixo = 0, media = 0, acima = 0;
  fm.forEach(f => {
    const d = f.diasTrabalhados || 0;
    if (d < 1 || (f.divida || 0) > 0) abaixo++;
    else if (d > Math.ceil(avg)) acima++;
    else media++;
  });
  const chip = (bg, color, icon, txt) => `<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:6px 12px;border-radius:8px;background:${bg};color:${color};">${icon} ${txt}</span>`;
  return `<div style="margin-bottom:14px;">
    <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">Equilíbrio do ciclo</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${chip('#2a1414', 'var(--red)', '↓', `${abaixo} abaixo do mínimo`)}
      ${chip('#10241a', 'var(--green)', '=', `${media} na média`)}
      ${chip('#2a2410', '#caa23a', '↑', `${acima} acima`)}
    </div>
  </div>`;
}

function whyTableHtml(slot) {
  const ex = slot.explain || [];
  if (!ex.length) return '';
  const prefLabel = (p) => p === 'quer' ? 'quer' : (p === 'nao_quer' ? 'não quer' : (p === 'nao_posso' ? 'não posso' : '—'));
  const rows = ex.map(c => {
    const win = c.personId === slot.assignedPersonId;
    return `<tr style="${win ? 'background:var(--surface3);' : ''}">
      <td style="padding:3px 6px;${win ? 'font-weight:600;' : 'color:var(--text2);'}">${escalaPersonName(c.personId)}</td>
      <td style="padding:3px 6px;text-align:center;">${c.merito}</td>
      <td style="padding:3px 6px;text-align:center;">${c.diasTrabalhados}</td>
      <td style="padding:3px 6px;text-align:center;">${c.divida || 0}</td>
      <td style="padding:3px 6px;text-align:center;">${prefLabel(c.pref)}</td>
    </tr>`;
  }).join('');
  return `<details style="margin-top:8px;">
    <summary style="cursor:pointer;font-size:12px;color:var(--blue);">por quê?</summary>
    <table style="width:100%;font-size:11px;margin-top:6px;border-collapse:collapse;">
      <thead><tr style="color:var(--text2);text-align:left;"><th style="padding:3px 6px;font-weight:400;">Candidato</th><th style="padding:3px 6px;font-weight:400;text-align:center;">Pontos</th><th style="padding:3px 6px;font-weight:400;text-align:center;">Sábados</th><th style="padding:3px 6px;font-weight:400;text-align:center;">Dívida</th><th style="padding:3px 6px;font-weight:400;text-align:center;">Pref.</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </details>`;
}

function escalaPersonName(id) {
  if (!id) return null;
  const t = EscalaSmartState.teacherMap.get(id);
  return t ? t.name : id;
}

/* ─── GESTÃO ───────────────────────────────────────────────────────── */
async function renderEscalaGestao() {
  const container = document.getElementById('page-escala-smart');
  if (!container) return;
  container.innerHTML = `
    <div class="page-hdr"><h1>🗓️ Escala Inteligente</h1><p>Sábados/feriados: o sistema sugere por justiça + mérito; você ajusta e publica.</p></div>
    <div class="loading"><div class="spinner"></div> Carregando escalas…</div>`;

  await escalaLoadBase();

  const scales = EscalaSmartState.scales;
  let listHtml;
  if (scales.length === 0) {
    listHtml = `<p style="padding:20px;color:var(--text2);">Nenhuma escala criada ainda. Crie a primeira.</p>`;
  } else {
    listHtml = scales.map(s => {
      const sel = s.id === EscalaSmartState.selectedId;
      const statusColor = s.status === 'consolidada' ? 'var(--green)' : (s.status === 'janela_aberta' ? 'var(--blue)' : 'var(--text2)');
      return `<div onclick="selectEscala('${s.id}')" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;background:${sel ? 'var(--surface2)' : 'var(--surface)'};border:1px solid ${sel ? 'var(--blue)' : 'var(--border)'};border-radius:10px;padding:10px 12px;margin-bottom:6px;">
        <div><div style="font-weight:600;font-size:14px;">${s.name || s.date}</div><div style="font-size:12px;color:var(--text2);">${s.date} · ${(ESCALA_TIPOS.find(t => t.id === s.tipo) || {}).label || s.tipo}</div></div>
        <span style="font-size:12px;font-weight:600;color:${statusColor};">${ESCALA_STATUS_LABEL[s.status] || s.status}</span>
      </div>`;
    }).join('');
  }

  const detail = EscalaSmartState.selectedId ? renderEscalaDetail(scales.find(s => s.id === EscalaSmartState.selectedId)) : '';

  container.innerHTML = `
    <div class="page-hdr"><h1>🗓️ Escala Inteligente</h1><p>Sábados/feriados: o sistema sugere por justiça + mérito; você ajusta e publica.</p></div>
    <div class="page-toolbar"><div class="lhs"><h2>Escalas <span class="count">${scales.length}</span></h2></div>
      <div class="rhs"><button class="btn-primary" onclick="openNovaEscala()">+ Nova escala</button></div></div>
    ${renderEquilibrioPainel()}
    <div style="display:grid;grid-template-columns:minmax(220px,1fr) 2fr;gap:16px;align-items:start;">
      <div>${listHtml}</div>
      <div>${detail || '<p style="padding:20px;color:var(--text2);">Selecione uma escala à esquerda.</p>'}</div>
    </div>
    <div id="escalaModalOverlay" class="modal-overlay" style="display:none;"></div>
    <div id="escalaModal" class="modal" style="display:none;"></div>`;
}

function renderFimDeAnoDetail(scale) {
  const slots = scale.slots || [];
  const unitName = (uid) => { const u = EscalaSmartState.units.find(x => x.id === uid); return u ? u.name : uid; };
  const fmtDay = (iso) => { const p = iso.split('-'); return `${p[2]}/${p[1]}`; };
  const consolidated = scale.status === 'consolidada';
  const days = [...new Set(slots.map(s => s.day))].sort();

  let daysHtml = '';
  days.forEach(day => {
    const daySlots = slots.filter(s => s.day === day);
    const half = !!(daySlots[0] && daySlots[0].halfDay);
    const byUnit = {};
    daySlots.forEach(s => { (byUnit[s.unitId] = byUnit[s.unitId] || []).push(s); });
    const unitsHtml = Object.keys(byUnit).map(uid => {
      const people = byUnit[uid].map(s => s.assignedPersonId
        ? `<span style="font-size:12px;">${escalaPersonName(s.assignedPersonId)}</span>`
        : `<span style="font-size:12px;color:var(--text3);">— vaga</span>`).join(' · ');
      return `<div style="font-size:12px;"><span style="color:var(--text2);">${unitName(uid)}:</span> ${people}</div>`;
    }).join('');
    daysHtml += `<div style="display:flex;gap:12px;align-items:flex-start;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px;">
      <div style="font-weight:600;font-size:13px;min-width:52px;">${fmtDay(day)}${half ? '<div style="font-size:10px;color:#caa23a;">½ período</div>' : ''}</div>
      <div style="flex:1;">${unitsHtml}</div>
    </div>`;
  });

  let sinalHtml = '';
  if (consolidated) {
    const escalados = new Set(slots.map(s => s.assignedPersonId).filter(Boolean));
    const fora = Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false && !escalados.has(t.id));
    sinalHtml = fora.length
      ? `<div style="background:#1a2a3a;border:1px solid var(--blue);border-radius:8px;padding:10px 12px;margin-top:12px;">
          <div style="font-size:12px;font-weight:600;color:var(--blue);margin-bottom:4px;">Não escalados no período — lançar folga na mão (${fora.length})</div>
          <div style="font-size:12px;color:var(--text2);">${fora.map(t => t.name).join(' · ')}</div></div>`
      : `<div style="font-size:12px;color:var(--text2);margin-top:12px;">Todos os colaboradores foram escalados em algum dia.</div>`;
  }

  const actions = `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:12px;">
    ${scale.status === 'rascunho' ? `<button class="btn-secondary" onclick="abrirJanelaEscala('${scale.id}')">📨 Abrir janela de preferências</button>` : ''}
    <button class="btn-primary" onclick="consolidarEscala('${scale.id}')">🧮 ${consolidated ? 'Reconsolidar' : 'Consolidar'}</button>
  </div>`;

  return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;">
    <div style="margin-bottom:12px;"><div style="font-weight:600;">${scale.name || 'Fim de ano'}</div>
      <div style="font-size:12px;color:var(--text2);">${days.length} dias · 2 por unidade/dia · ${ESCALA_STATUS_LABEL[scale.status] || scale.status}</div></div>
    ${daysHtml || '<p style="color:var(--text2);">Sem dias nesta escala.</p>'}
    ${sinalHtml}
    ${actions}
  </div>`;
}

function renderEscalaDetail(scale) {
  if (!scale) return '';
  if (scale.tipo === 'fim_de_ano') return renderFimDeAnoDetail(scale);
  const byUnit = {};
  (scale.slots || []).forEach(s => { (byUnit[s.unitId] = byUnit[s.unitId] || []).push(s); });
  const unitName = (uid) => { const u = EscalaSmartState.units.find(x => x.id === uid); return u ? u.name : uid; };
  const reasonChip = (r) => {
    if (r === 'justica') return `<span style="font-size:11px;padding:2px 8px;border-radius:6px;background:var(--blue-bg,#1a2a3a);color:var(--blue);">⚖ Justiça</span>`;
    if (r === 'merito') return `<span style="font-size:11px;padding:2px 8px;border-radius:6px;background:#2a2410;color:#caa23a;">★ Mérito</span>`;
    return '';
  };

  let unitsHtml = '';
  Object.keys(byUnit).forEach(uid => {
    const cards = byUnit[uid].map(slot => {
      const person = escalaPersonName(slot.assignedPersonId);
      const filled = !!slot.assignedPersonId;
      const modLabel = slot.requiredModalityName || (slot.requiredModalityId === (EscalaSmartState.modToi || {}).id ? 'TOI' : 'Hiit');
      return `<div style="background:var(--surface);border:1px ${filled ? 'solid' : 'dashed'} var(--border);border-radius:10px;padding:10px 12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;background:var(--surface3);color:var(--text);">${modLabel}</span>
          ${filled ? reasonChip(slot.reason) : '<span style="font-size:11px;color:var(--text3);">vaga aberta</span>'}
        </div>
        <div style="font-size:14px;font-weight:${filled ? '600' : '400'};color:${filled ? 'var(--text)' : 'var(--text3)'};">${filled ? person : 'ninguém habilitado disponível'}</div>
        ${filled ? whyTableHtml(slot) : ''}
      </div>`;
    }).join('');
    unitsHtml += `<div style="margin-bottom:12px;"><div style="font-size:13px;font-weight:500;margin-bottom:6px;">${unitName(uid)}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;">${cards}</div></div>`;
  });

  const actions = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:12px;">
      ${scale.status === 'rascunho' ? `<button class="btn-secondary" onclick="abrirJanelaEscala('${scale.id}')">📨 Abrir janela de preferências</button>` : ''}
      <button class="btn-primary" onclick="consolidarEscala('${scale.id}')">🧮 ${scale.status === 'consolidada' ? 'Reconsolidar' : 'Consolidar'}</button>
    </div>`;

  return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;">
      <div><div style="font-weight:600;">${scale.name || scale.date}</div><div style="font-size:12px;color:var(--text2);">${scale.date} · ${ESCALA_STATUS_LABEL[scale.status] || scale.status}</div></div>
    </div>
    ${unitsHtml || '<p style="color:var(--text2);">Sem vagas nesta escala.</p>'}
    ${actions}
  </div>`;
}

/* ─── Nova escala ──────────────────────────────────────────────────── */
function openNovaEscala() {
  const overlay = document.getElementById('escalaModalOverlay');
  const modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  const tipoOpts = ESCALA_TIPOS.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
  overlay.style.display = 'flex';
  modal.style.display = 'block';
  const y = new Date().getFullYear();
  modal.innerHTML = `
    <h2>Nova escala</h2>
    <div class="form-group"><label>Tipo</label><select id="novaEscalaTipo" class="input" onchange="onNovaEscalaTipo()">${tipoOpts}</select></div>
    <div id="novaEscalaDataWrap" class="form-group"><label>Data <span style="color:var(--red);">*</span></label><input type="date" id="novaEscalaData" class="input" value="${escalaTodayISO()}"></div>
    <div id="novaEscalaPeriodo" style="display:none;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="form-group"><label>Início</label><input type="date" id="feInicio" class="input" value="${y}-12-21"></div>
        <div class="form-group"><label>Fim</label><input type="date" id="feFim" class="input" value="${y + 1}-01-02"></div>
      </div>
      <p style="font-size:12px;color:var(--text2);">Uma dupla por dia em cada unidade. Fechado 25/12, 31/12 e 01/01; 24/12 meio período. Ajuste as datas a cada ano.</p>
    </div>
    <p id="novaEscalaHint" style="font-size:12px;color:var(--text2);">As vagas são geradas por unidade: 1 TOI + 1 Hiit. Você pode ajustar depois.</p>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      <button class="btn-primary" onclick="criarEscala()">Criar</button>
    </div>`;
}

function onNovaEscalaTipo() {
  const isFe = document.getElementById('novaEscalaTipo').value === 'fim_de_ano';
  document.getElementById('novaEscalaDataWrap').style.display = isFe ? 'none' : 'block';
  document.getElementById('novaEscalaPeriodo').style.display = isFe ? 'block' : 'none';
  document.getElementById('novaEscalaHint').style.display = isFe ? 'none' : 'block';
}
function closeEscalaModal() {
  const o = document.getElementById('escalaModalOverlay'), m = document.getElementById('escalaModal');
  if (o) o.style.display = 'none'; if (m) m.style.display = 'none';
}

async function criarEscala() {
  const tipo = document.getElementById('novaEscalaTipo').value;
  if (tipo === 'fim_de_ano') return criarEscalaFimDeAno();
  const date = document.getElementById('novaEscalaData').value;
  if (!date) { toast('Informe a data.', 'error'); return; }
  const toi = EscalaSmartState.modToi, hiit = EscalaSmartState.modHiit;
  if (!toi || !hiit) { toast('Cadastre as modalidades TOI e Hiit antes.', 'error'); return; }
  const slots = [];
  EscalaSmartState.units.forEach(u => {
    slots.push({ id: `${u.id}_TOI`, unitId: u.id, requiredModalityId: toi.id, requiredModalityName: 'TOI', assignedPersonId: null });
    slots.push({ id: `${u.id}_HIIT`, unitId: u.id, requiredModalityId: hiit.id, requiredModalityName: 'Hiit', assignedPersonId: null });
  });
  const tipoLabel = (ESCALA_TIPOS.find(t => t.id === tipo) || {}).label || tipo;
  const res = await ScaleService.createScale({ date, tipo, name: `${tipoLabel} ${date.split('-').reverse().join('/')}`, slots });
  if (res.success) { toast('Escala criada!', 'success'); closeEscalaModal(); EscalaSmartState.selectedId = res.data.id; renderEscalaGestao(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}

async function criarEscalaFimDeAno() {
  const start = document.getElementById('feInicio').value;
  const end = document.getElementById('feFim').value;
  if (!start || !end || start > end) { toast('Informe um período válido.', 'error'); return; }
  if (!EscalaSmartState.units.length) { toast('Cadastre as unidades antes.', 'error'); return; }
  const all = ScaleService.datesInRange(start, end);
  const closedMMDD = new Set(['12-25', '12-31', '01-01']);
  const period = {
    start, end,
    closedDays: all.filter(d => closedMMDD.has(d.slice(5))),
    halfDays: all.filter(d => d.slice(5) === '12-24'),
  };
  const slots = ScaleService.templateSlotsFimDeAno(period, EscalaSmartState.units);
  const res = await ScaleService.createScale({ date: start, tipo: 'fim_de_ano', name: `Fim de ano ${start.slice(0, 4)}`, slots });
  if (res.success) { toast('Escala de fim de ano criada!', 'success'); closeEscalaModal(); EscalaSmartState.selectedId = res.data.id; renderEscalaGestao(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}

function selectEscala(id) { EscalaSmartState.selectedId = id; renderEscalaGestao(); }

async function abrirJanelaEscala(id) {
  const res = await ScaleService.openElection(id);
  if (res.success) { toast('Janela de preferências aberta.', 'success'); renderEscalaGestao(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}

async function consolidarEscala(id) {
  toast('Consolidando…', 'info');
  // monta ctx: professores ativos + mérito (placar do ciclo atual) + opts
  const teachers = Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false);
  const cyclesRes = await EngagementService.listCycles();
  const cycles = (cyclesRes.success && cyclesRes.data.length) ? cyclesRes.data
    : [{ id: '_all', inicio: '1900-01-01', fim: escalaTodayISO() }];
  const cycle = (typeof EngagementService.currentCycle === 'function' ? EngagementService.currentCycle(cycles, escalaTodayISO()) : null) || cycles[0];
  const meritoById = {};
  for (const t of teachers) {
    const hire = (t.hireDate && t.hireDate.toDate) ? t.hireDate.toDate().toISOString().slice(0, 10) : null;
    const sb = await EngagementService.scoreboard(t.id, hire, cycle);
    meritoById[t.id] = sb.success ? sb.data.total : 0;
  }
  const ctx = {
    teachers: teachers.map(t => ({ id: t.id, name: t.name, modalityIds: t.modalityIds || [], primaryUnitId: t.primaryUnitId })),
    meritoById, opts: { minMes: 1 },
  };
  const scale = EscalaSmartState.scales.find(s => s.id === id) || {};
  const res = scale.tipo === 'fim_de_ano'
    ? await ScaleService.consolidateByDay(id, ctx)
    : await ScaleService.consolidate(id, ctx);
  if (res.success) { toast('Escala consolidada!', 'success'); renderEscalaGestao(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}

/* ─── COLABORADOR (preferências) ───────────────────────────────────── */
async function renderEscalaPrefs() {
  const container = document.getElementById('page-escala-smart');
  if (!container) return;
  container.innerHTML = `
    <div class="page-hdr"><h1>🗓️ Escala — minhas preferências</h1><p>Marque os sábados/feriados que você quer (ou não pode) trabalhar.</p></div>
    <div class="loading"><div class="spinner"></div> Carregando…</div>`;

  const pid = escalaProfId();
  const scalesRes = await ScaleService.listScales();
  const abertas = (scalesRes.success ? scalesRes.data : []).filter(s => s.status === 'janela_aberta');

  if (abertas.length === 0) {
    container.innerHTML = `<div class="page-hdr"><h1>🗓️ Escala — minhas preferências</h1></div>
      <p style="padding:24px;color:var(--text2);">Nenhuma janela de preferências aberta no momento.</p>`;
    return;
  }

  // carrega preferências atuais do professor
  const prefByScale = {};
  for (const s of abertas) {
    const pr = await ScaleService.listPreferences(s.id);
    const mine = (pr.success ? pr.data : []).find(p => p.personId === pid);
    prefByScale[s.id] = mine ? mine.pref : null;
  }

  const pbtn = (sid, pref, label, color) => {
    const active = prefByScale[sid] === pref;
    const style = active ? `background:${color};color:#0a0a0a;border:1px solid ${color};font-weight:600;` : `background:transparent;color:var(--text2);border:1px solid var(--border);`;
    return `<button onclick="marcarPref('${sid}','${pref}')" style="font-size:13px;padding:7px 12px;border-radius:8px;cursor:pointer;${style}">${label}</button>`;
  };

  const rows = abertas.map(s => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;flex-wrap:wrap;">
    <div><div style="font-weight:600;font-size:14px;">${s.name || s.date}</div><div style="font-size:12px;color:var(--text2);">${s.date}</div></div>
    <div style="display:flex;gap:6px;">${pbtn(s.id, 'quer', 'Quero', 'var(--green)')}${pbtn(s.id, 'nao_quer', 'Não quero', '#caa23a')}${pbtn(s.id, 'nao_posso', 'Não posso', 'var(--red)')}</div>
  </div>`).join('');

  container.innerHTML = `
    <div class="page-hdr"><h1>🗓️ Escala — minhas preferências</h1><p>Marque os sábados/feriados que você quer (ou não pode) trabalhar. Marcar preferência não garante a vaga.</p></div>
    ${rows}`;
}

async function marcarPref(scaleId, pref) {
  const pid = escalaProfId();
  if (!pid) { toast('Seu perfil não está vinculado a um professor.', 'error'); return; }
  const res = await ScaleService.setPreference(scaleId, pid, pref);
  if (res.success) { toast('Preferência registrada!', 'success'); renderEscalaPrefs(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}

// Expor globalmente (chamadas via navigateTo / onclick)
window.renderEscalaSmartPage = renderEscalaSmartPage;
window.openNovaEscala = openNovaEscala;
window.onNovaEscalaTipo = onNovaEscalaTipo;
window.closeEscalaModal = closeEscalaModal;
window.criarEscala = criarEscala;
window.selectEscala = selectEscala;
window.abrirJanelaEscala = abrirJanelaEscala;
window.consolidarEscala = consolidarEscala;
window.marcarPref = marcarPref;

console.log('[CrossTainer Professores] professores-escala-smart.js carregado · Escala Inteligente (5b)');
