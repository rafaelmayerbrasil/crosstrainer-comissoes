// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Módulo Professores · Escala Inteligente (sábados/feriados)
// UI que consome ScaleService (CRUD + consolidação) + ScaleEngine.
// Plano: docs/superpowers/plans/2026-06-24-escala-ui.md (5b).
// Adapta por perfil: gestão = visão de gestão; professor = marcar preferências.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const EscalaSmartState = { scales: [], units: [], modToi: null, modHiit: null, selectedId: null, teacherMap: new Map(), fairnessMap: new Map(), tab: 'sabado', year: new Date().getFullYear(), feriadosByYear: {}, config: null, timeframe: 'futuros', selected: new Set(), _janelaTarget: null };

const ESCALA_TIPOS = [
  { id: 'sabado',           label: 'Sábado' },
  { id: 'feriado',          label: 'Feriado' },
  { id: 'domingo_especial', label: 'Domingo especial' },
  { id: 'evento',           label: 'Evento' },
  { id: 'fim_de_ano',       label: 'Fim de ano' },
  { id: 'escola_interna',   label: 'Escola Interna' },
];
const ESCALA_STATUS_LABEL = { rascunho: 'Rascunho', janela_aberta: 'Janela aberta', consolidada: 'Consolidada' };
const ESCALA_TABS = [
  { id: 'sabado',         label: 'Sábados' },
  { id: 'feriado',        label: 'Feriados' },
  { id: 'evento',         label: 'Eventos' },
  { id: 'fim_de_ano',     label: 'Fim de ano' },
  { id: 'escola_interna', label: 'Escola Interna' },
];

function escalaIsManagement() {
  return (typeof isAdminGestao === 'function' && isAdminGestao()) ||
         (typeof isSupervisao === 'function' && isSupervisao());
}
function escalaProfId() {
  return (typeof AppState === 'object' && AppState.userProfile) ? AppState.userProfile.professorId : null;
}
function escalaTodayISO() { return new Date().toISOString().slice(0, 10); }
function escalaFmtBR(iso) { return iso.split('-').reverse().join('/'); }

// Slots-padrão (1 TOI + 1 Hiit por unidade) COM os horários da config por tipo.
// Sem horário o publishToAgenda pula o slot — por isso a config é obrigatória aqui.
function escalaSlotsPadrao(tipo) {
  const toi = EscalaSmartState.modToi, hiit = EscalaSmartState.modHiit;
  const hor = ((EscalaSmartState.config || {}).horarios || {})[tipo] || {};
  const slots = [];
  EscalaSmartState.units.forEach(u => {
    slots.push({ id: `${u.id}_TOI`,  unitId: u.id, requiredModalityId: toi.id,  requiredModalityName: 'TOI',  assignedPersonId: null, startTime: hor.startTime || '08:00', endTime: hor.endTime || '12:00' });
    slots.push({ id: `${u.id}_HIIT`, unitId: u.id, requiredModalityId: hiit.id, requiredModalityName: 'Hiit', assignedPersonId: null, startTime: hor.startTime || '08:00', endTime: hor.endTime || '12:00' });
  });
  return slots;
}

// Feriados nacionais do ano: BrasilAPI → fallback cache da CF → vazio (com aviso na aba)
async function escalaLoadFeriados(year) {
  if (EscalaSmartState.feriadosByYear[year]) return EscalaSmartState.feriadosByYear[year];
  let list = [];
  try {
    const resp = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`);
    if (resp.ok) list = ScaleService.parseFeriados(await resp.json());
  } catch (e) { /* offline: cai pro cache */ }
  if (!list.length) {
    try {
      const doc = await db.collection('meta').doc(`holidays_cache_${year}`).get();
      if (doc.exists) list = ScaleService.parseFeriados((doc.data() || {}).feriados);
    } catch (e) { /* sem cache: fica vazio */ }
  }
  EscalaSmartState.feriadosByYear[year] = list;
  return list;
}

function escalaSetTab(t) { EscalaSmartState.tab = t; EscalaSmartState.selectedId = null; renderEscalaSmartPage(); }
function escalaSetYear(y) { EscalaSmartState.year = parseInt(y, 10); renderEscalaSmartPage(); }
function escalaSetTimeframe(tf) { EscalaSmartState.timeframe = tf; renderEscalaSmartPage(); }

function renderEscalaSmartPage() {
  if (escalaIsManagement()) renderEscalaGestao();
  else renderEscalaPrefs();
}

/* ─── Carga comum ──────────────────────────────────────────────────── */
async function escalaLoadBase() {
  const [scalesRes, unitsRes, modsRes, teachersRes, cfgRes] = await Promise.all([
    ScaleService.listScales(),
    (typeof UnitService === 'object' ? UnitService.list() : Promise.resolve({ success: true, data: [] })),
    ModalityService.list(),
    TeacherService.list(),
    ScaleService.ScaleConfigService.get(),
  ]);
  EscalaSmartState.config = cfgRes.success ? cfgRes.data : { horarios: {} };
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
  const prefLabel = (p) => (p === 'prefiro' || p === 'quer') ? 'prefiro' : (p === 'pode_ser' ? 'pode ser' : (p === 'nao_posso' ? 'não posso' : (p === 'nao_quer' ? '—' : '—')));
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
function escalaCardDoc(s) {
  const sel = s.id === EscalaSmartState.selectedId;
  const statusColor = s.status === 'consolidada' ? 'var(--green)' : (s.status === 'janela_aberta' ? 'var(--blue)' : 'var(--text2)');
  const statusTxt = (ESCALA_STATUS_LABEL[s.status] || s.status) + (s.published ? ' · ✓ publicada' : '');
  const kindBadge = (s.tipo === 'evento' && s.eventKind)
    ? `<span style="font-size:11px;padding:2px 8px;border-radius:6px;background:${s.eventKind === 'externo' ? '#2a1a2e' : 'var(--surface3)'};color:${s.eventKind === 'externo' ? '#c77dff' : 'var(--text2)'};margin-left:6px;">${s.eventKind === 'externo' ? 'Externo' : 'Interno'}</span>` : '';
  return `<div onclick="selectEscala('${s.id}')" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;background:${sel ? 'var(--surface2)' : 'var(--surface)'};border:1px solid ${sel ? 'var(--blue)' : 'var(--border)'};border-radius:10px;padding:10px 12px;margin-bottom:6px;">
    <div><div style="font-weight:600;font-size:14px;">${s.name || s.date}${kindBadge}</div><div style="font-size:12px;color:var(--text2);">${s.date}</div></div>
    <span style="font-size:12px;font-weight:600;color:${statusColor};">${statusTxt}</span>
  </div>`;
}

async function renderEscalaGestao() {
  const container = document.getElementById('page-escala-smart');
  if (!container) return;
  container.innerHTML = `
    <div class="page-hdr"><h1>🗓️ Escala Inteligente</h1><p>Sábados/feriados: o sistema sugere por justiça + mérito; você ajusta e publica.</p></div>
    <div class="loading"><div class="spinner"></div> Carregando escalas…</div>`;

  await escalaLoadBase();
  if (EscalaSmartState.tab === 'feriado') await escalaLoadFeriados(EscalaSmartState.year);

  const scales = EscalaSmartState.scales;
  const tab = EscalaSmartState.tab;
  const tabsHtml = `<div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:12px;">` +
    ESCALA_TABS.map(t => {
      const on = t.id === tab;
      return `<button onclick="escalaSetTab('${t.id}')" style="background:none;border:none;border-bottom:2px solid ${on ? 'var(--blue)' : 'transparent'};color:${on ? 'var(--text)' : 'var(--text2)'};font-weight:${on ? '600' : '400'};font-size:14px;padding:8px 14px;cursor:pointer;">${t.label}</button>`;
    }).join('') + `</div>`;

  const y = EscalaSmartState.year;
  const yearSel = tab === 'fim_de_ano' ? '' :
    `<select class="input" style="width:auto;" onchange="escalaSetYear(this.value)">${[y - 1, y, y + 1].map(v => `<option value="${v}" ${v === y ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  const tfSel = tab === 'fim_de_ano' ? '' :
    `<div style="display:inline-flex;gap:4px;margin-right:8px;">
      ${['futuros', 'todos', 'passados'].map(v => `<button onclick="escalaSetTimeframe('${v}')" style="font-size:12px;padding:6px 10px;border-radius:8px;cursor:pointer;border:1px solid ${EscalaSmartState.timeframe === v ? 'var(--blue)' : 'var(--border)'};background:${EscalaSmartState.timeframe === v ? 'rgba(94,168,255,0.15)' : 'transparent'};color:${EscalaSmartState.timeframe === v ? '#5EA8FF' : 'var(--text2)'};">${v === 'futuros' ? 'Próximos' : v === 'passados' ? 'Passados' : 'Todos'}</button>`).join('')}
    </div>`;

  let listHtml;
  if (tab === 'sabado')                listHtml = renderTabSabados(scales);
  else if (tab === 'feriado')          listHtml = renderTabFeriados(scales);
  else if (tab === 'evento')           listHtml = renderTabEventos(scales);
  else if (tab === 'escola_interna')   listHtml = renderTabEscolaInterna(scales);
  else                                 listHtml = renderTabFimDeAno(scales);

  const detail = EscalaSmartState.selectedId ? renderEscalaDetail(scales.find(s => s.id === EscalaSmartState.selectedId)) : '';

  const batchesAbertos = [...new Set(scales.filter(s => s.status === 'janela_aberta' && s.windowBatchId).map(s => s.windowBatchId))];
  const revisaoBar = batchesAbertos.length
    ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:#1a2a3a;border:1px solid var(--blue);border-radius:10px;padding:10px 12px;margin-bottom:10px;">
        <span style="font-size:13px;color:var(--blue);">Há ${batchesAbertos.length} janela(s) em andamento. Feche e revise antes de confirmar.</span>
        <button class="btn-primary" onclick="abrirRevisaoLote('${batchesAbertos[0]}')">🧮 Revisar fechamento</button>
      </div>` : '';

  container.innerHTML = `
    <div class="page-hdr"><h1>🗓️ Escala Inteligente</h1><p>Sábados/feriados: o sistema sugere por justiça + mérito; você ajusta e publica.</p></div>
    ${renderEquilibrioPainel()}
    ${tabsHtml}
    ${revisaoBar}
    <div style="display:flex;align-items:center;justify-content:flex-end;margin-bottom:10px;">${tfSel}${yearSel}</div>
    ${EscalaSmartState.selected.size ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface2);border:1px solid var(--blue);border-radius:10px;padding:10px 12px;margin-bottom:10px;">
      <span style="font-size:13px;">${EscalaSmartState.selected.size} data(s) selecionada(s)</span>
      <div style="display:flex;gap:8px;"><button class="btn-secondary" onclick="escalaLimparSel()">Limpar</button><button class="btn-primary" onclick="openAbrirLote()">📨 Abrir janela nas selecionadas</button></div>
    </div>` : ''}
    <div style="display:grid;grid-template-columns:minmax(220px,1fr) 2fr;gap:16px;align-items:start;">
      <div>${listHtml}</div>
      <div>${detail || '<p style="padding:20px;color:var(--text2);">Selecione uma escala à esquerda.</p>'}</div>
    </div>
    <div id="escalaModalOverlay" class="modal-overlay" style="display:none;"></div>
    <div id="escalaModal" class="modal" style="display:none;"></div>`;
}

/* ─── Abas (listas por tipo) ───────────────────────────────────────── */
function renderTabFimDeAno(scales) {
  const docs = scales.filter(s => s.tipo === 'fim_de_ano');
  const topo = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
    <span style="font-size:12px;color:var(--text2);">Período de horário reduzido, por turnos — a gestão define as datas.</span>
    <button class="btn-primary" onclick="openNovaEscalaFimDeAno()">+ Configurar período</button></div>`;
  const body = docs.length ? docs.map(escalaCardDoc).join('')
    : `<p style="padding:20px;color:var(--text2);">Nenhum período de fim de ano configurado.</p>`;
  return topo + body;
}

function renderTabEventos(scales) {
  let docs = scales.filter(s => s.tipo === 'evento' && s.date.startsWith(String(EscalaSmartState.year)));
  docs = ScaleService.filterByTimeframe(docs, escalaTodayISO(), EscalaSmartState.timeframe);
  const topo = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
    <span style="font-size:12px;color:var(--text2);">Quem trabalha/representa no evento. Presença/ponto continua na Chamada do Engajamento.</span>
    <button class="btn-primary" onclick="openNovoEvento()">+ Novo evento</button></div>`;
  const body = docs.length ? docs.map(escalaCardDoc).join('')
    : `<p style="padding:20px;color:var(--text2);">Nenhum evento em ${EscalaSmartState.year}. Crie o primeiro.</p>`;
  return topo + body;
}

function renderTabEscolaInterna(scales) {
  const docs = scales.filter(s => s.tipo === 'escola_interna' && s.date.startsWith(String(EscalaSmartState.year)));
  const docsF = ScaleService.filterByTimeframe(docs, escalaTodayISO(), EscalaSmartState.timeframe);
  const topo = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
    <span style="font-size:12px;color:var(--text2);">A gestão escolhe quem lidera cada dia (por necessidade técnica). Quem lidera ganha os pontos de liderança.</span>
    <button class="btn-primary" onclick="openNovaEscolaInterna()">+ Nova sessão</button></div>`;
  const body = docsF.length ? docsF.map(escalaCardDoc).join('')
    : `<p style="padding:20px;color:var(--text2);">Nenhuma sessão de Escola Interna em ${EscalaSmartState.year}.</p>`;
  return topo + body;
}

function openNovaEscolaInterna() {
  const overlay = document.getElementById('escalaModalOverlay'), modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex'; modal.style.display = 'block';
  modal.innerHTML = `
    <h2>Nova sessão de Escola Interna</h2>
    <div class="form-group"><label>Data <span style="color:var(--red);">*</span></label><input type="date" id="eiData" class="input" value="${escalaTodayISO()}"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div class="form-group"><label>Início</label><input type="time" id="eiIni" class="input" value="14:30"></div>
      <div class="form-group"><label>Fim</label><input type="time" id="eiFim" class="input" value="15:30"></div>
    </div>
    <div class="form-group"><label>Unidades</label><div style="padding:4px 0;">${EscalaSmartState.units.map(u => `<label style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-size:13px;"><input type="checkbox" class="eiUnit" value="${u.id}" checked> ${u.name || u.id}</label>`).join('')}</div></div>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      <button class="btn-primary" onclick="criarEscolaInterna()">Criar</button>
    </div>`;
}

async function criarEscolaInterna() {
  const date = document.getElementById('eiData').value;
  const startTime = document.getElementById('eiIni').value, endTime = document.getElementById('eiFim').value;
  const selUnits = Array.from(document.querySelectorAll('.eiUnit:checked')).map(c => c.value);
  if (!date || !selUnits.length) { toast('Informe data e ao menos uma unidade.', 'error'); return; }
  const units = EscalaSmartState.units.filter(u => selUnits.includes(u.id));
  const slots = ScaleService.escolaInternaSlots(units, { startTime, endTime });
  const res = await ScaleService.createScale({ date, tipo: 'escola_interna', name: `Escola Interna ${escalaFmtBR(date)}`, slots });
  if (res.success) { toast('Sessão criada!', 'success'); closeEscalaModal(); EscalaSmartState.tab = 'escola_interna'; EscalaSmartState.selectedId = res.data.id; renderEscalaGestao(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}

function renderTabFeriados(scales) {
  const y = EscalaSmartState.year;
  const feriados = EscalaSmartState.feriadosByYear[y] || [];
  const docs = scales.filter(s => (s.tipo === 'feriado' || s.tipo === 'domingo_especial') && s.date.startsWith(String(y)));
  const datasComDoc = new Set(docs.map(dd => dd.date));
  const sugestoes = feriados.filter(f => !datasComDoc.has(f.date));

  const tf = EscalaSmartState.timeframe, today = escalaTodayISO();
  const docsF = ScaleService.filterByTimeframe(docs, today, tf);
  const sugF = ScaleService.filterByTimeframe(sugestoes, today, tf);

  const topo = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
    <span style="font-size:12px;color:var(--text2);">A gestão aponta quais feriados terão escala.</span>
    <button class="btn-secondary" onclick="openDataEspecial()">+ Data especial</button></div>`;
  const aviso = feriados.length ? '' :
    `<p style="font-size:12px;color:#caa23a;margin:0 0 8px;">Não consegui carregar os feriados nacionais (API/cache indisponível) — adicione pelo "+ Data especial".</p>`;
  const docsHtml = docsF.map(dd => `<div style="display:flex;align-items:center;gap:0;margin-bottom:6px;">${escalaSelCb(dd.date)}<div style="flex:1;">${escalaCardDoc(dd)}</div></div>`).join('');
  const sugHtml = sugF.map(f => `<div style="display:flex;align-items:center;gap:0;margin-bottom:6px;">${escalaSelCb(f.date)}<div style="flex:1;display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px dashed var(--border);border-radius:10px;padding:10px 12px;">
      <div><div style="font-size:14px;color:var(--text2);">${f.name}</div><div style="font-size:12px;color:var(--text3);">${escalaFmtBR(f.date)} · nacional</div></div>
      <button class="btn-secondary" style="font-size:12px;" onclick="criarEscalaData('feriado','${f.date}','${(f.name || '').replace(/'/g, '')}')">Criar escala</button>
    </div></div>`).join('');
  return topo + aviso + docsHtml + sugHtml;
}

function renderTabSabados(scales) {
  let rows = ScaleService.mergeVirtualWithDocs(
    ScaleService.saturdaysOfYear(EscalaSmartState.year),
    scales.filter(s => s.tipo === 'sabado')
  );
  rows = ScaleService.filterByTimeframe(rows, escalaTodayISO(), EscalaSmartState.timeframe);
  const com = rows.filter(r => r.docs.length).length;
  const header = `<div style="font-size:12px;color:var(--text2);margin-bottom:8px;">${rows.length} sábados · ${com} com escala</div>`;
  const body = rows.map(r => {
    const inner = r.docs.length
      ? r.docs.map(escalaCardDoc).join('')
      : `<div onclick="criarEscalaData('sabado','${r.date}')" style="cursor:pointer;flex:1;display:flex;align-items:center;justify-content:space-between;gap:10px;background:transparent;border:1px dashed var(--border);border-radius:10px;padding:10px 12px;">
          <div style="font-size:14px;color:var(--text2);">Sábado ${escalaFmtBR(r.date)}</div>
          <span style="font-size:12px;color:var(--text3);">Sem escala · clique pra criar</span>
        </div>`;
    return `<div style="display:flex;align-items:center;gap:0;margin-bottom:6px;">${escalaSelCb(r.date)}<div style="flex:1;">${inner}</div></div>`;
  }).join('');
  return header + body;
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
    const shiftLabel = (sid) => sid === 'manha' ? 'Manhã' : (sid === 'tarde_noite' ? 'Tarde/Noite' : (sid || ''));
    const unitsHtml = Object.keys(byUnit).map(uid => {
      const byShift = {};
      byUnit[uid].forEach(s => { (byShift[s.shift || '_'] = byShift[s.shift || '_'] || []).push(s); });
      const shiftsHtml = Object.keys(byShift).map(sid => {
        const people = byShift[sid].map(s => s.assignedPersonId
          ? `<span style="font-size:12px;">${escalaPersonName(s.assignedPersonId)}</span>`
          : `<span style="font-size:12px;color:var(--text3);">— vaga</span>`).join(' · ');
        return `<div style="font-size:12px;"><span style="color:#5EA8FF;">${shiftLabel(sid)}</span> — ${people}</div>`;
      }).join('');
      return `<div style="font-size:12px;margin-bottom:4px;"><span style="color:var(--text2);font-weight:500;">${unitName(uid)}</span>${shiftsHtml}</div>`;
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

  const actions = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:flex-end;margin-top:12px;">
    ${scale.published ? `<span style="font-size:12px;color:var(--green);margin-right:auto;">✓ publicada na agenda</span>` : ''}
    ${scale.status === 'rascunho' ? `<button class="btn-secondary" onclick="abrirJanelaEscala('${scale.id}')">📨 Abrir janela de preferências</button>` : ''}
    <button class="btn-primary" onclick="consolidarEscala('${scale.id}')">🧮 ${consolidated ? 'Reconsolidar' : 'Consolidar'}</button>
    ${consolidated && !scale.published ? `<button class="btn-primary" onclick="publicarEscala('${scale.id}')">📅 Publicar na agenda</button>` : ''}
    ${scale.published ? `<button class="btn-secondary" onclick="despublicarEscala('${scale.id}')">↩️ Despublicar</button>` : ''}
  </div>`;

  return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;">
    <div style="margin-bottom:12px;"><div style="font-weight:600;">${scale.name || 'Fim de ano'}</div>
      <div style="font-size:12px;color:var(--text2);">${days.length} dias · turnos manhã/tarde-noite · ${ESCALA_STATUS_LABEL[scale.status] || scale.status}</div></div>
    ${daysHtml || '<p style="color:var(--text2);">Sem dias nesta escala.</p>'}
    ${sinalHtml}
    ${actions}
  </div>`;
}

function renderEscolaInternaDetail(scale) {
  const unitName = (uid) => { const u = EscalaSmartState.units.find(x => x.id === uid); return u ? u.name : uid; };
  const opts = (sel) => `<option value="">— escolher líder —</option>` +
    Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false)
      .map(t => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${t.name}</option>`).join('');
  const cards = (scale.slots || []).map(slot => `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:6px;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <div><div style="font-size:13px;font-weight:500;">${unitName(slot.unitId)}</div><div style="font-size:12px;color:var(--text2);">${slot.startTime}–${slot.endTime} · líder</div></div>
      <select class="input" style="width:auto;" onchange="atribuirLider('${scale.id}','${slot.id}',this.value)">${opts(slot.assignedPersonId)}</select>
    </div></div>`).join('');
  const actions = `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
    ${scale.published ? `<span style="font-size:12px;color:var(--green);margin-right:auto;">✓ publicada na agenda</span>` : ''}
    ${!scale.published ? `<button class="btn-primary" onclick="publicarEscala('${scale.id}')">📅 Publicar na agenda</button>` : `<button class="btn-secondary" onclick="despublicarEscala('${scale.id}')">↩️ Despublicar</button>`}
  </div>`;
  return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;">
    <div style="margin-bottom:12px;"><div style="font-weight:600;">${scale.name || scale.date}</div>
      <div style="font-size:12px;color:var(--text2);">${scale.date} · atribuição manual do líder</div></div>
    ${cards || '<p style="color:var(--text2);">Sem sessões.</p>'}
    ${actions}
  </div>`;
}

async function atribuirLider(scaleId, slotId, personId) {
  const res = await ScaleService.assignSlot(scaleId, slotId, personId || null);
  if (res.success) { toast('Líder atualizado.', 'success'); await escalaLoadBase(); renderEscalaGestao(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}

function renderEscalaDetail(scale) {
  if (!scale) return '';
  if (scale.tipo === 'fim_de_ano') return renderFimDeAnoDetail(scale);
  if (scale.tipo === 'escola_interna') return renderEscolaInternaDetail(scale);
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
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:flex-end;margin-top:12px;">
      ${scale.published ? `<span style="font-size:12px;color:var(--green);margin-right:auto;">✓ publicada na agenda</span>` : ''}
      ${scale.status === 'rascunho' ? `<button class="btn-secondary" onclick="abrirJanelaEscala('${scale.id}')">📨 Abrir janela de preferências</button>` : ''}
      <button class="btn-primary" onclick="consolidarEscala('${scale.id}')">🧮 ${scale.status === 'consolidada' ? 'Reconsolidar' : 'Consolidar'}</button>
      ${scale.status === 'consolidada' && !scale.published ? `<button class="btn-primary" onclick="publicarEscala('${scale.id}')">📅 Publicar na agenda</button>` : ''}
      ${scale.published ? `<button class="btn-secondary" onclick="despublicarEscala('${scale.id}')">↩️ Despublicar</button>` : ''}
    </div>`;

  return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;">
      <div><div style="font-weight:600;">${scale.name || scale.date}</div><div style="font-size:12px;color:var(--text2);">${scale.date} · ${ESCALA_STATUS_LABEL[scale.status] || scale.status}</div></div>
    </div>
    ${unitsHtml || '<p style="color:var(--text2);">Sem vagas nesta escala.</p>'}
    ${actions}
  </div>`;
}

/* ─── Nova escala (fim de ano) ─────────────────────────────────────── */
function openNovaEscalaFimDeAno() {
  const overlay = document.getElementById('escalaModalOverlay');
  const modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex';
  modal.style.display = 'block';
  const y = new Date().getFullYear();
  const unitChecks = EscalaSmartState.units.map(u =>
    `<label style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-size:13px;"><input type="checkbox" class="feUnit" value="${u.id}" checked> ${u.name || u.id}</label>`
  ).join('') || '<span style="font-size:12px;color:var(--text3);">Nenhuma unidade cadastrada.</span>';
  modal.innerHTML = `
    <h2>Fim de ano — horário reduzido</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div class="form-group"><label>Início</label><input type="date" id="feInicio" class="input" value="${y}-12-21"></div>
      <div class="form-group"><label>Fim</label><input type="date" id="feFim" class="input" value="${y + 1}-01-02"></div>
    </div>
    <div class="form-group"><label>Unidades abertas</label><div style="padding:4px 0;">${unitChecks}</div></div>
    <div class="form-group"><label>Turnos (horário reduzido)</label>
      <div style="display:grid;grid-template-columns:auto 1fr 1fr;gap:8px;align-items:center;">
        <span style="font-size:13px;">Manhã</span>
        <input type="time" id="feManhaIni" class="input" value="08:00">
        <input type="time" id="feManhaFim" class="input" value="12:00">
        <span style="font-size:13px;">Tarde/Noite</span>
        <input type="time" id="feTardeIni" class="input" value="16:00">
        <input type="time" id="feTardeFim" class="input" value="21:00">
      </div>
    </div>
    <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;margin-bottom:6px;"><input type="checkbox" id="feAbrir24"> Abrir 24/12 (por padrão fechado)</label>
    <p style="font-size:12px;color:var(--text2);">Vagas por dia × unidade × turno (1 pessoa/turno). Fechado 25/12, 31/12 e 01/01. Ajuste as datas a cada ano.</p>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      <button class="btn-primary" onclick="criarEscalaFimDeAno()">Criar</button>
    </div>`;
}

function closeEscalaModal() {
  const o = document.getElementById('escalaModalOverlay'), m = document.getElementById('escalaModal');
  if (o) o.style.display = 'none'; if (m) m.style.display = 'none';
}

function openDataEspecial() {
  const overlay = document.getElementById('escalaModalOverlay');
  const modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex';
  modal.style.display = 'block';
  modal.innerHTML = `
    <h2>Data especial</h2>
    <div class="form-group"><label>Nome <span style="color:var(--red);">*</span></label><input type="text" id="deNome" class="input" placeholder="Ex.: Aniversário da cidade"></div>
    <div class="form-group"><label>Data <span style="color:var(--red);">*</span></label><input type="date" id="deData" class="input" value="${escalaTodayISO()}"></div>
    <div class="form-group"><label>Tipo</label><select id="deTipo" class="input">
      <option value="feriado">Feriado (municipal/estadual)</option>
      <option value="domingo_especial">Domingo especial</option>
    </select></div>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      <button class="btn-primary" onclick="criarDataEspecial()">Criar</button>
    </div>`;
}

async function criarDataEspecial() {
  const nome = (document.getElementById('deNome').value || '').trim();
  const date = document.getElementById('deData').value;
  const tipo = document.getElementById('deTipo').value;
  if (!nome || !date) { toast('Informe nome e data.', 'error'); return; }
  await criarEscalaData(tipo, date, `${nome} ${escalaFmtBR(date)}`);
}

function openNovoEvento() {
  const overlay = document.getElementById('escalaModalOverlay');
  const modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex';
  modal.style.display = 'block';
  modal.innerHTML = `
    <h2>Novo evento</h2>
    <div class="form-group"><label>Nome <span style="color:var(--red);">*</span></label><input type="text" id="evNome" class="input" placeholder="Ex.: Campeonato interbox"></div>
    <div class="form-group"><label>Data <span style="color:var(--red);">*</span></label><input type="date" id="evData" class="input" value="${escalaTodayISO()}"></div>
    <div class="form-group"><label>Classificação</label><div style="display:flex;gap:14px;padding:4px 0;">
      <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;"><input type="radio" name="evKind" value="interno" checked> Interno (reunião, treinamento)</label>
      <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;"><input type="radio" name="evKind" value="externo"> Externo (campeonato, evento fora)</label>
    </div></div>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      <button class="btn-primary" onclick="criarNovoEvento()">Criar</button>
    </div>`;
}

async function criarNovoEvento() {
  const nome = (document.getElementById('evNome').value || '').trim();
  const date = document.getElementById('evData').value;
  const kind = (document.querySelector('input[name="evKind"]:checked') || {}).value || 'interno';
  if (!nome || !date) { toast('Informe nome e data.', 'error'); return; }
  await criarEscalaData('evento', date, `${nome} ${escalaFmtBR(date)}`, kind);
}

// Criação contextual usada pelas abas Sábados/Feriados/Eventos
async function criarEscalaData(tipo, date, name, eventKind) {
  if (!date) { toast('Informe a data.', 'error'); return; }
  const toi = EscalaSmartState.modToi, hiit = EscalaSmartState.modHiit;
  if (!toi || !hiit) { toast('Cadastre as modalidades TOI e Hiit antes.', 'error'); return; }
  const tipoLabel = (ESCALA_TIPOS.find(t => t.id === tipo) || {}).label || tipo;
  const payload = { date, tipo, name: name || `${tipoLabel} ${escalaFmtBR(date)}`, slots: escalaSlotsPadrao(tipo) };
  if (eventKind) payload.eventKind = eventKind;
  const res = await ScaleService.createScale(payload);
  if (res.success) { toast('Escala criada!', 'success'); closeEscalaModal(); EscalaSmartState.selectedId = res.data.id; renderEscalaGestao(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}

async function criarEscalaFimDeAno() {
  const start = document.getElementById('feInicio').value;
  const end = document.getElementById('feFim').value;
  if (!start || !end || start > end) { toast('Informe um período válido.', 'error'); return; }
  const selUnits = Array.from(document.querySelectorAll('.feUnit:checked')).map(c => c.value);
  if (!selUnits.length) { toast('Selecione ao menos uma unidade.', 'error'); return; }
  const units = EscalaSmartState.units.filter(u => selUnits.includes(u.id));
  const shifts = [
    { id: 'manha', label: 'Manhã', startTime: document.getElementById('feManhaIni').value, endTime: document.getElementById('feManhaFim').value },
    { id: 'tarde_noite', label: 'Tarde/Noite', startTime: document.getElementById('feTardeIni').value, endTime: document.getElementById('feTardeFim').value },
  ];
  const abrir24 = document.getElementById('feAbrir24').checked;
  const all = ScaleService.datesInRange(start, end);
  const closedMMDD = new Set(['12-25', '12-31', '01-01']);
  if (!abrir24) closedMMDD.add('12-24');
  const period = { start, end, closedDays: all.filter(d => closedMMDD.has(d.slice(5))) };
  const slots = ScaleService.templateSlotsFimDeAno(period, units, shifts, 1);
  const res = await ScaleService.createScale({ date: start, tipo: 'fim_de_ano', name: `Fim de ano ${start.slice(0, 4)}`, slots });
  if (res.success) { toast('Escala de fim de ano criada!', 'success'); closeEscalaModal(); EscalaSmartState.tab = 'fim_de_ano'; EscalaSmartState.selectedId = res.data.id; renderEscalaGestao(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}

function selectEscala(id) { EscalaSmartState.selectedId = id; renderEscalaGestao(); }

// Seleção múltipla de datas (sábados/feriados) p/ abrir janela em lote.
function escalaToggleSel(date) {
  if (EscalaSmartState.selected.has(date)) EscalaSmartState.selected.delete(date);
  else EscalaSmartState.selected.add(date);
  renderEscalaGestao();
}
function escalaLimparSel() { EscalaSmartState.selected.clear(); renderEscalaGestao(); }
function escalaSelCb(date) {
  return `<input type="checkbox" onclick="event.stopPropagation();escalaToggleSel('${date}')" ${EscalaSmartState.selected.has(date) ? 'checked' : ''} style="margin-right:8px;flex:none;">`;
}

// Modal de prazo compartilhado. target = { dates:[...] } (lote) OU { scaleId, date } (individual).
function openAbrirJanelaModal(target) {
  const overlay = document.getElementById('escalaModalOverlay'), modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  EscalaSmartState._janelaTarget = target;
  const dias = target.dates ? target.dates.slice().sort() : [target.date];
  overlay.style.display = 'flex'; modal.style.display = 'block';
  modal.innerHTML = `
    <h2>Abrir janela de preferências</h2>
    <p style="font-size:13px;color:var(--text2);">${dias.length} data(s): ${dias.map(escalaFmtBR).join(', ')}</p>
    <div class="form-group"><label>Fecha em <span style="color:var(--red);">*</span></label>
      <input type="datetime-local" id="janelaClosesAt" class="input"></div>
    <p style="font-size:12px;color:var(--text2);">Todos os professores ativos serão avisados no sistema para se candidatarem até essa data.</p>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      <button class="btn-primary" onclick="confirmarAbrirJanela()">Abrir e avisar</button>
    </div>`;
}

async function confirmarAbrirJanela() {
  const closesAt = document.getElementById('janelaClosesAt').value;
  if (!closesAt) { toast('Informe a data-limite.', 'error'); return; }
  const target = EscalaSmartState._janelaTarget || {};
  const batchId = 'batch_' + Date.now();
  toast('Abrindo janela…', 'info');
  let datasAviso = [];
  if (target.scaleId) {
    const scale = EscalaSmartState.scales.find(s => s.id === target.scaleId);
    await ScaleService.openElection(target.scaleId, { closesAt, batchId });
    datasAviso = [scale ? scale.date : target.date];
  } else {
    const datas = (target.dates || []).slice().sort();
    const tipo = EscalaSmartState.tab === 'feriado' ? 'feriado' : 'sabado';
    for (const date of datas) {
      let doc = EscalaSmartState.scales.find(s => s.date === date && s.tipo === tipo);
      if (!doc) {
        const res = await ScaleService.createScale({ date, tipo, name: `${tipo === 'feriado' ? 'Feriado' : 'Sábado'} ${escalaFmtBR(date)}`, slots: escalaSlotsPadrao(tipo) });
        if (!res.success) { toast('Erro ao criar ' + date, 'error'); continue; }
        doc = res.data;
      }
      await ScaleService.openElection(doc.id, { closesAt, batchId });
    }
    datasAviso = datas;
  }
  const rec = await NotifyService.resolveActiveTeacherUserIds();
  if (rec.success && rec.data.length) {
    await NotifyService.send({
      recipients: rec.data, type: 'scale_window_open',
      title: 'Janela de escala aberta',
      body: `Candidate-se aos dias ${datasAviso.map(escalaFmtBR).join(', ')} até ${escalaFmtBR(closesAt.slice(0, 10))}.`,
      link: { type: 'escala-smart', id: batchId }, channels: ['inapp'],
    });
  }
  toast('Janela aberta. Time avisado.', 'success');
  EscalaSmartState.selected.clear();
  EscalaSmartState._janelaTarget = null;
  closeEscalaModal();
  renderEscalaGestao();
}

// gatilho do lote (barra de ação)
function openAbrirLote() {
  if (!EscalaSmartState.selected.size) { toast('Selecione ao menos uma data.', 'error'); return; }
  openAbrirJanelaModal({ dates: Array.from(EscalaSmartState.selected) });
}

function abrirJanelaEscala(id) {
  const scale = EscalaSmartState.scales.find(s => s.id === id);
  if (!scale) { toast('Escala não encontrada.', 'error'); return; }
  openAbrirJanelaModal({ scaleId: id, date: scale.date });
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

// ─── Revisão de fechamento (lote) ──────────────────────────────────
async function abrirRevisaoLote(batchId) {
  toast('Carregando revisão…', 'info');
  const byBatch = await ScaleService.listScalesByBatch(batchId);
  if (!byBatch.success || !byBatch.data.length) { toast('Lote não encontrado.', 'error'); return; }
  const scales = byBatch.data.slice().sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0)); // ordena por data (serviço não ordena)
  const prefsByScale = {};
  for (const s of scales) {
    const pr = await ScaleService.listPreferences(s.id);
    prefsByScale[s.id] = pr.success ? pr.data : [];
  }
  const people = Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false).map(t => ({ id: t.id, name: t.name }));
  const matrix = ScaleService.buildConsolidationMatrix(scales, prefsByScale, people);
  renderRevisaoFechamento(batchId, scales, matrix);
}

function renderRevisaoFechamento(batchId, scales, matrix) {
  const overlay = document.getElementById('escalaModalOverlay'), modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex'; modal.style.display = 'block';
  const prefTxt = (p) => p === 'prefiro' ? '★' : p === 'pode_ser' ? '✓' : p === 'nao_posso' ? '✕' : '·';
  const head = `<tr><th style="text-align:left;padding:4px 8px;">Pessoa</th>${scales.map(s => `<th style="padding:4px 8px;font-weight:400;font-size:11px;">${escalaFmtBR(s.date)}</th>`).join('')}</tr>`;
  const body = matrix.grid.map(g => `<tr>
    <td style="padding:4px 8px;${matrix.semCandidatura.some(p => p.id === g.person.id) ? 'color:var(--text3);' : ''}">${g.person.name}</td>
    ${scales.map(s => { const c = g.cells[s.id]; return `<td style="text-align:center;padding:4px 8px;${c.assigned ? 'background:var(--surface3);font-weight:600;' : ''}">${prefTxt(c.pref)}</td>`; }).join('')}
  </tr>`).join('');
  const semCand = matrix.semCandidatura.length
    ? `<p style="font-size:12px;color:#caa23a;margin:8px 0;">Não se candidataram a nada: ${matrix.semCandidatura.map(p => p.name).join(', ')}</p>` : '';
  modal.innerHTML = `
    <h2>Revisão de fechamento</h2>
    <p style="font-size:12px;color:var(--text2);">★ prefiro · ✓ pode ser · ✕ não posso · célula destacada = escalado. Vagas abertas: ${matrix.vagasAbertas}.</p>
    <div style="overflow:auto;max-height:50vh;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    ${semCand}
    <p style="font-size:12px;color:var(--text2);">Ao confirmar, o sistema consolida as vagas abertas por justiça+mérito e avisa todos no sistema.</p>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Fechar</button>
      <button class="btn-primary" onclick="confirmarEAvisar('${batchId}')">✅ Confirmar escala e avisar todos</button>
    </div>`;
}

async function confirmarEAvisar(batchId) {
  const byBatch = await ScaleService.listScalesByBatch(batchId);
  if (!byBatch.success) { toast('Erro ao carregar lote.', 'error'); return; }
  toast('Consolidando…', 'info');
  // monta ctx: professores ativos + mérito (placar do ciclo atual) + opts — mesmo padrão de consolidarEscala()
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
  for (const s of byBatch.data) {
    await ScaleService.closeElection(s.id);
    await ScaleService.consolidate(s.id, ctx);
  }
  const rec = await NotifyService.resolveActiveTeacherUserIds();
  if (rec.success && rec.data.length) {
    const datas = byBatch.data.slice().sort((a, b) => (a.date > b.date ? 1 : -1)).map(s => escalaFmtBR(s.date)).join(', ');
    await NotifyService.send({
      recipients: rec.data, type: 'scale_confirmed',
      title: 'Escala confirmada',
      body: `A escala dos dias ${datas} foi definida. Confira sua agenda.`,
      link: { type: 'escala-smart', id: batchId }, channels: ['inapp'],
    });
  }
  toast('Escala confirmada e time avisado.', 'success');
  closeEscalaModal();
  renderEscalaGestao();
}

async function publicarEscala(id) {
  if (!confirm('Publicar a escala como aulas na agenda?')) return;
  toast('Publicando…', 'info');
  const res = await ScaleService.publishToAgenda(id);
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); return; }
  let msg = `${res.data.created} aula(s) publicada(s).`;
  if (res.data.vagasAbertas && res.data.vagasAbertas.length) msg += ` ${res.data.vagasAbertas.length} vaga(s) aberta(s) sem aula.`;
  toast(msg, 'success');
  renderEscalaGestao();
}

async function despublicarEscala(id) {
  if (!confirm('Remover as aulas publicadas desta escala da agenda?')) return;
  const res = await ScaleService.unpublishFromAgenda(id);
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); return; }
  toast('Escala despublicada.', 'success');
  renderEscalaGestao();
}

/* ─── COLABORADOR (preferências) ───────────────────────────────────── */
async function renderEscalaPrefs() {
  const container = document.getElementById('page-escala-smart');
  if (!container) return;
  container.innerHTML = `<div class="page-hdr"><h1>🗓️ Escala — minhas datas</h1><p>Candidate-se onde a janela estiver aberta; consulte onde você está escalado.</p></div>
    <div class="loading"><div class="spinner"></div> Carregando…</div>`;

  const pid = escalaProfId();
  const [scalesRes, teachersRes] = await Promise.all([ScaleService.listScales(), TeacherService.list()]);
  EscalaSmartState.scales = scalesRes.success ? scalesRes.data : [];
  EscalaSmartState.teacherMap = new Map((teachersRes.success ? teachersRes.data : []).map(t => [t.id, t]));
  if (EscalaSmartState.tab === 'feriado') await escalaLoadFeriados(EscalaSmartState.year);

  const tab = EscalaSmartState.tab;
  const tabsHtml = `<div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:12px;flex-wrap:wrap;">` +
    ESCALA_TABS.map(t => {
      const on = t.id === tab;
      return `<button onclick="escalaSetTab('${t.id}')" style="background:none;border:none;border-bottom:2px solid ${on ? 'var(--blue)' : 'transparent'};color:${on ? 'var(--text)' : 'var(--text2)'};font-weight:${on ? '600' : '400'};font-size:14px;padding:8px 14px;cursor:pointer;">${t.label}</button>`;
    }).join('') + `</div>`;

  let body;
  if (tab === 'sabado' || tab === 'feriado') body = await renderProfSabadosFeriados(pid, tab);
  else if (tab === 'fim_de_ano')                body = await renderProfFimDeAno(pid);
  else if (tab === 'evento')                    body = renderProfEventos();
  else                                          body = renderProfEscolaInterna(pid);

  container.innerHTML = `<div class="page-hdr"><h1>🗓️ Escala — minhas datas</h1><p>Candidate-se onde a janela estiver aberta; consulte onde você está escalado.</p></div>
    ${tabsHtml}
    ${body}`;
}

async function renderProfSabadosFeriados(pid, tab) {
  const tipos = tab === 'sabado' ? ['sabado'] : ['feriado', 'domingo_especial'];
  let escalas = EscalaSmartState.scales.filter(s => tipos.includes(s.tipo));
  escalas = ScaleService.filterByTimeframe(escalas, escalaTodayISO(), EscalaSmartState.timeframe);
  if (!escalas.length) return `<p style="padding:20px;color:var(--text2);">Nenhuma data ${tab === 'sabado' ? 'de sábado' : 'de feriado'} ${EscalaSmartState.timeframe === 'futuros' ? 'próxima' : ''}.</p>`;

  // atalho "Pode ser em todas" quando há janela aberta na aba (reusa marcarPodeSerTodas, que já existe/exportado)
  const temAberta = escalas.some(s => s.status === 'janela_aberta');
  const atalho = temAberta
    ? `<div style="padding:0 0 12px;"><button onclick="marcarPodeSerTodas()" style="font-size:13px;padding:8px 14px;border-radius:8px;cursor:pointer;background:rgba(94,168,255,0.15);color:#5EA8FF;border:1px solid #5EA8FF;">✓ Marcar "Pode ser" em todas as janelas abertas</button></div>`
    : '';

  // preferências atuais do professor nas janelas abertas
  const nowISO = ScaleService.nowLocalMinute();
  const prefByScale = {};
  for (const s of escalas) {
    if (s.status === 'janela_aberta') {
      const pr = await ScaleService.listPreferences(s.id);
      const mine = (pr.success ? pr.data : []).find(p => p.personId === pid);
      prefByScale[s.id] = mine ? mine.pref : null;
    }
  }
  const pbtn = (sid, pref, label, color) => {
    const active = prefByScale[sid] === pref;
    const style = active ? `background:${color};color:#0a0a0a;border:1px solid ${color};font-weight:600;` : `background:transparent;color:var(--text2);border:1px solid var(--border);`;
    return `<button onclick="marcarPref('${sid}','${pref}')" style="font-size:13px;padding:7px 12px;border-radius:8px;cursor:pointer;${style}">${label}</button>`;
  };
  return atalho + escalas.map(s => {
    const open = ScaleService.isWindowOpen(s, nowISO);
    let right;
    if (s.status === 'janela_aberta') {
      const prazo = s.windowClosesAt ? `Fecha em ${escalaFmtBR(s.windowClosesAt.slice(0, 10))}` : 'Sem prazo';
      right = open
        ? `<div style="display:flex;gap:6px;">${pbtn(s.id, 'prefiro', 'Prefiro', 'var(--green)')}${pbtn(s.id, 'pode_ser', 'Pode ser', '#5EA8FF')}${pbtn(s.id, 'nao_posso', 'Não posso', 'var(--red)')}</div>`
        : `<span style="font-size:12px;color:var(--red);">Janela encerrada</span>`;
      return profDateRow(s, `${s.date} · ${prazo}`, right);
    }
    const escalado = ScaleService.isPersonAssigned(s, pid);
    right = escalado
      ? `<span style="font-size:12px;color:var(--green);font-weight:600;">✓ Você está escalado</span>`
      : `<span style="font-size:12px;color:var(--text3);">Não escalado</span>`;
    return profDateRow(s, `${s.date} · ${ESCALA_STATUS_LABEL[s.status] || s.status}`, right);
  }).join('');
}

function profDateRow(s, sub, right) {
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;flex-wrap:wrap;">
    <div><div style="font-weight:600;font-size:14px;">${s.name || s.date}</div><div style="font-size:12px;color:var(--text2);">${sub}</div></div>
    ${right}
  </div>`;
}

async function renderProfFimDeAno(pid) { return `<p style="padding:20px;color:var(--text2);">(fim de ano — em breve)</p>`; }
function renderProfEventos() { return `<p style="padding:20px;color:var(--text2);">(eventos — em breve)</p>`; }
function renderProfEscolaInterna(pid) { return `<p style="padding:20px;color:var(--text2);">(escola interna — em breve)</p>`; }

async function marcarPodeSerTodas() {
  const pid = escalaProfId();
  if (!pid) { toast('Seu perfil não está vinculado a um professor.', 'error'); return; }
  const scalesRes = await ScaleService.listScales();
  const abertas = (scalesRes.success ? scalesRes.data : []).filter(s => s.status === 'janela_aberta');
  if (!abertas.length) { toast('Nenhuma janela aberta.', 'info'); return; }
  for (const s of abertas) { await ScaleService.setPreference(s.id, pid, 'pode_ser'); }
  toast(`"Pode ser" marcado em ${abertas.length} escala(s).`, 'success');
  renderEscalaPrefs();
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
window.openNovaEscalaFimDeAno = openNovaEscalaFimDeAno;
window.criarEscalaFimDeAno = criarEscalaFimDeAno;
window.closeEscalaModal = closeEscalaModal;
window.criarEscalaData = criarEscalaData;
window.openDataEspecial = openDataEspecial;
window.criarDataEspecial = criarDataEspecial;
window.openNovoEvento = openNovoEvento;
window.criarNovoEvento = criarNovoEvento;
window.escalaSetTab = escalaSetTab;
window.escalaSetYear = escalaSetYear;
window.escalaSetTimeframe = escalaSetTimeframe;
window.selectEscala = selectEscala;
window.abrirJanelaEscala = abrirJanelaEscala;
window.escalaToggleSel = escalaToggleSel;
window.escalaLimparSel = escalaLimparSel;
window.openAbrirLote = openAbrirLote;
window.confirmarAbrirJanela = confirmarAbrirJanela;
window.consolidarEscala = consolidarEscala;
window.abrirRevisaoLote = abrirRevisaoLote;
window.confirmarEAvisar = confirmarEAvisar;
window.publicarEscala = publicarEscala;
window.despublicarEscala = despublicarEscala;
window.marcarPref = marcarPref;
window.marcarPodeSerTodas = marcarPodeSerTodas;
window.renderTabEscolaInterna = renderTabEscolaInterna;
window.openNovaEscolaInterna = openNovaEscolaInterna;
window.criarEscolaInterna = criarEscolaInterna;
window.atribuirLider = atribuirLider;

console.log('[CrossTainer Professores] professores-escala-smart.js carregado · Escala Inteligente (5b)');
