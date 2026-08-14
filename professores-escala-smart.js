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

// Deep-link vindo da tela "Confirmar Presença": abre a aba certa e já sobe o modal
// de criação com a data preenchida. Consumido uma única vez em renderEscalaGestao.
let escalaSmartPendingNew = null;
function abrirEscalaSmartNovo(tipo, dateISO) {
  const tab = tipo === 'escola_interna' ? 'escola_interna' : 'evento';
  escalaSmartPendingNew = { tipo, date: dateISO || escalaTodayISO() };
  EscalaSmartState.tab = tab;
  EscalaSmartState.selectedId = null;
  if (dateISO && /^\d{4}/.test(dateISO)) EscalaSmartState.year = parseInt(dateISO.slice(0, 4), 10);
  EscalaSmartState.timeframe = 'todos'; // a data pode ser passada (chamada retroativa)
  if (typeof navigateTo === 'function') navigateTo('escala-smart');
  else renderEscalaSmartPage();
}

// Abre o modal pendente depois que a tela terminou de montar.
function escalaConsumirPendingNew() {
  const pend = escalaSmartPendingNew;
  if (!pend) return;
  escalaSmartPendingNew = null;
  if (pend.tipo === 'escola_interna') openNovaEscolaInterna(pend.date);
  else openNovoEvento(pend.date);
}
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

/**
 * Horário da escala, tirado das vagas. "Também não fala o horário" (Rafael,
 * 12/08/2026): a lista dizia só a data, e quem olhava não sabia se o sábado era
 * de manhã ou à tarde. Quando as vagas têm horários diferentes, mostra do
 * primeiro começo ao último fim em vez de esconder a diferença.
 */
function escalaHorario(scale) {
  const slots = (scale && scale.slots) || [];
  const inicios = slots.map(s => s.startTime).filter(Boolean).sort();
  const fins    = slots.map(s => s.endTime).filter(Boolean).sort();
  if (!inicios.length || !fins.length) return '';
  return `${inicios[0]}–${fins[fins.length - 1]}`;
}

/* ─── GESTÃO ───────────────────────────────────────────────────────── */
function escalaCardDoc(s) {
  const sel = s.id === EscalaSmartState.selectedId;
  // "Rascunho · ✓ publicada" lia como contradição. Publicada na agenda é o que
  // importa pra quem olha, então ela manda sozinha; o status do fluxo (rascunho/
  // janela aberta/consolidada) só aparece enquanto NÃO está publicada.
  const publicada = !!s.published;
  const statusColor = publicada ? 'var(--green)'
    : (s.status === 'consolidada' ? 'var(--green)' : (s.status === 'janela_aberta' ? 'var(--blue)' : 'var(--text2)'));
  // Evento não passa por janela/consolidação/publicação — ele funciona por lista de
  // staff + convite + RSVP. Mostrar "Rascunho" aqui é herança do fluxo de sábado/
  // feriado e só assusta (Rodrigo, 12/08: "ficou como rascunho, o que tem que fazer?").
  const statusTxt = s.tipo === 'evento' ? ''
    : (publicada ? '✓ Publicada' : (ESCALA_STATUS_LABEL[s.status] || s.status));
  const kindBadge = (s.tipo === 'evento' && s.eventKind)
    ? `<span style="font-size:11px;padding:2px 8px;border-radius:6px;background:${s.eventKind === 'externo' ? '#2a1a2e' : 'var(--surface3)'};color:${s.eventKind === 'externo' ? '#c77dff' : 'var(--text2)'};margin-left:6px;">${s.eventKind === 'externo' ? 'Externo' : 'Interno'}</span>` : '';
  return `<div onclick="selectEscala('${s.id}')" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;background:${sel ? 'var(--surface2)' : 'var(--surface)'};border:1px solid ${sel ? 'var(--blue)' : 'var(--border)'};border-radius:10px;padding:10px 12px;margin-bottom:6px;">
    <div><div style="font-weight:600;font-size:14px;">${s.name || s.date}${kindBadge}</div><div style="font-size:12px;color:var(--text2);">${s.date}${escalaHorario(s) ? ` · 🕗 ${escalaHorario(s)}` : ''}</div></div>
    <span style="font-size:12px;font-weight:600;color:${statusColor};">${statusTxt}</span>
  </div>`;
}

async function renderEscalaGestao() {
  const container = document.getElementById('page-escala-smart');
  if (!container) return;
  container.innerHTML = `
    <div class="page-hdr"><h1>🗓️ Escala Inteligente${ajudaBtn("escala-smart")}</h1><p>Sábados/feriados: o sistema sugere por justiça + mérito; você ajusta e publica.</p></div>
    <div class="loading"><div class="spinner"></div> Carregando escalas…</div>`;

  await escalaLoadBase();
  if (EscalaSmartState.tab === 'feriado') await escalaLoadFeriados(EscalaSmartState.year);

  // Se o evento selecionado está aberto, carrega os RSVP dele p/ o painel de staff/consolidado.
  EscalaSmartState.eventoRsvp = null;
  if (EscalaSmartState.selectedId) {
    const sel = EscalaSmartState.scales.find(s => s.id === EscalaSmartState.selectedId);
    if (sel && sel.tipo === 'evento') {
      const rr = await ScaleService.listEventRsvp(sel.id);
      EscalaSmartState.eventoRsvp = new Map((rr.success ? rr.data : []).map(r => [r.personId, r]));
    }
  }

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
    <div class="page-hdr"><h1>🗓️ Escala Inteligente${ajudaBtn("escala-smart")}</h1><p>Sábados/feriados: o sistema sugere por justiça + mérito; você ajusta e publica.</p></div>
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

  escalaConsumirPendingNew(); // atalho vindo da Confirmar Presença
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

function openNovaEscolaInterna(dateISO) {
  const overlay = document.getElementById('escalaModalOverlay'), modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex'; modal.style.display = 'block';
  // Padrão PP: é onde a Escola Interna acontece na prática (Rafael, 04/08).
  // A CP fica disponível porque "vez ou outra pode acontecer lá".
  const pp = EscalaSmartState.units.find(u => /pp$/i.test(u.id)) || EscalaSmartState.units[0];
  modal.innerHTML = `
    <h2>Nova sessão de Escola Interna</h2>
    <div class="form-group"><label>Unidade <span style="color:var(--red);">*</span></label>
      <select id="eiUnidade" class="input">
        ${EscalaSmartState.units.map(u => `<option value="${u.id}" ${pp && u.id === pp.id ? 'selected' : ''}>${u.name || u.id}</option>`).join('')}
      </select>
      <div style="font-size:11px;color:var(--text3);margin-top:4px;">A sessão acontece em uma unidade por dia.</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div class="form-group"><label>Início</label><input type="time" id="eiIni" class="input" value="14:30"></div>
      <div class="form-group"><label>Fim</label><input type="time" id="eiFim" class="input" value="15:30"></div>
    </div>
    <div class="form-group"><label>Criar</label>
      <div style="padding:4px 0;">
        <label style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;font-size:13px;cursor:pointer;">
          <input type="radio" name="eiModo" value="dia" checked onchange="toggleEscolaInternaModo()"> Um dia só
        </label>
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">
          <input type="radio" name="eiModo" value="semana" onchange="toggleEscolaInternaModo()"> A semana inteira (seg a sex)
        </label>
      </div>
    </div>
    <div class="form-group" id="eiBoxDia"><label>Data <span style="color:var(--red);">*</span></label>
      <input type="date" id="eiData" class="input" value="${dateISO || escalaTodayISO()}"></div>
    <div class="form-group" id="eiBoxSemana" style="display:none;"><label>Segunda-feira da semana <span style="color:var(--red);">*</span></label>
      <input type="date" id="eiSemana" class="input" value="${proximaSegundaISO()}">
      <div style="font-size:11px;color:var(--text3);margin-top:4px;">Cria as 5 sessões de uma vez. Os líderes você escolhe depois, em cada dia.</div></div>
    <div class="error-msg" id="eiErro" style="margin-top:8px;"></div>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      <button class="btn-primary" id="eiCriarBtn" onclick="criarEscolaInterna()">Criar</button>
    </div>`;
}

/** Segunda-feira da próxima semana — a escala é montada na semana anterior. */
function proximaSegundaISO() {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function toggleEscolaInternaModo() {
  const semana = document.querySelector('input[name="eiModo"]:checked').value === 'semana';
  document.getElementById('eiBoxDia').style.display = semana ? 'none' : '';
  document.getElementById('eiBoxSemana').style.display = semana ? '' : 'none';
}

async function criarEscolaInterna() {
  const errEl = document.getElementById('eiErro');
  errEl.textContent = '';
  const unitId = document.getElementById('eiUnidade').value;
  const startTime = document.getElementById('eiIni').value;
  const endTime = document.getElementById('eiFim').value;
  const semana = document.querySelector('input[name="eiModo"]:checked').value === 'semana';

  if (!unitId) { errEl.textContent = 'Escolha a unidade.'; return; }
  if (!startTime || !endTime) { errEl.textContent = 'Informe início e fim.'; return; }
  if (endTime <= startTime) { errEl.textContent = 'O fim tem que ser depois do início.'; return; }

  // Datas a criar: um dia, ou a semana seg–sex a partir da segunda informada
  let datas = [];
  if (semana) {
    const base = document.getElementById('eiSemana').value;
    if (!base) { errEl.textContent = 'Informe a segunda-feira da semana.'; return; }
    const d0 = new Date(base + 'T12:00:00');
    for (let i = 0; i < 5; i++) {
      const d = new Date(d0); d.setDate(d0.getDate() + i);
      const p = n => String(n).padStart(2, '0');
      datas.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    }
  } else {
    const d = document.getElementById('eiData').value;
    if (!d) { errEl.textContent = 'Informe a data.'; return; }
    datas = [d];
  }

  const unit = EscalaSmartState.units.find(u => u.id === unitId);
  const btn = document.getElementById('eiCriarBtn');
  btn.disabled = true; btn.textContent = 'Criando…';

  const criadas = [];
  for (const date of datas) {
    const slots = ScaleService.escolaInternaSlots([unit], { startTime, endTime });
    const res = await ScaleService.createScale({
      date, tipo: 'escola_interna', name: `Escola Interna ${escalaFmtBR(date)}`, slots });
    if (!res.success) {
      btn.disabled = false; btn.textContent = 'Criar';
      errEl.textContent = `Criei ${criadas.length} e falhei em ${escalaFmtBR(date)}: ${res.error || 'erro'}`;
      renderEscalaGestao();
      return;
    }
    criadas.push(res.data.id);
  }

  toast(criadas.length === 1 ? 'Sessão criada!' : `${criadas.length} sessões criadas (semana inteira).`, 'success');
  closeEscalaModal();
  EscalaSmartState.tab = 'escola_interna';
  EscalaSmartState.selectedId = criadas[0];
  renderEscalaGestao();
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
  // Sessão que já aconteceu não se edita nem se apaga (decisão do usuário 04/08),
  // pelo mesmo motivo do mês fechado: não mexer em histórico.
  const passada = escalaEhPassada(scale.date);
  const actions = `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;align-items:center;">
    ${scale.published ? `<span style="font-size:12px;color:var(--green);margin-right:auto;">✓ publicada na agenda</span>` : ''}
    ${passada
      ? `<span style="font-size:12px;color:var(--text2);margin-right:auto;">Sessão já realizada — não pode ser editada.</span>`
      : `<button class="btn-secondary" onclick="abrirEdicaoEscolaInterna('${scale.id}')">✏️ Editar data/horário</button>
         <button class="btn-secondary" style="color:var(--red);" onclick="excluirEscolaInterna('${scale.id}')">🗑️ Excluir</button>`}
    ${!scale.published
      ? `<button class="btn-primary" onclick="publicarEscala('${scale.id}')">📅 Publicar na agenda</button>`
      : `<button class="btn-secondary" onclick="despublicarEscala('${scale.id}')">↩️ Despublicar</button>`}
  </div>`;
  return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;">
    <div style="margin-bottom:12px;"><div style="font-weight:600;">${scale.name || scale.date}</div>
      <div style="font-size:12px;color:var(--text2);">${scale.date} · atribuição manual do líder</div></div>
    ${cards || '<p style="color:var(--text2);">Sem sessões.</p>'}
    ${actions}
  </div>`;
}

/** Data da sessão já passou? Compara ISO local com hoje (hoje ainda é editável). */
function escalaEhPassada(dateISO) {
  return String(dateISO || '') < escalaTodayISO();
}

// ─── Editar data/horário de uma Escola Interna ──────────────────────────
function abrirEdicaoEscolaInterna(id) {
  const scale = EscalaSmartState.scales.find(s => s.id === id);
  if (!scale) { toast('Sessão não encontrada.', 'error'); return; }
  if (escalaEhPassada(scale.date)) { toast('Sessão já realizada não pode ser editada.', 'error'); return; }

  const slot0 = (scale.slots || [])[0] || {};
  const overlay = document.getElementById('escalaModalOverlay'), modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex'; modal.style.display = 'block';
  modal.innerHTML = `
    <h2>Editar sessão de Escola Interna</h2>
    <div class="form-group"><label>Data <span style="color:var(--red);">*</span></label>
      <input type="date" id="eiEditData" class="input" value="${scale.date}" min="${escalaTodayISO()}"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div class="form-group"><label>Início</label><input type="time" id="eiEditIni" class="input" value="${slot0.startTime || '14:30'}"></div>
      <div class="form-group"><label>Fim</label><input type="time" id="eiEditFim" class="input" value="${slot0.endTime || '15:30'}"></div>
    </div>
    <div style="font-size:12px;color:var(--text2);margin-top:4px;">
      O horário vale para todas as unidades desta sessão. Quem já foi escalado para liderar continua escalado.
      ${scale.published ? '<br><strong>Esta sessão está publicada</strong> — as aulas na agenda são atualizadas para o novo horário.' : ''}
    </div>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      <button class="btn-primary" id="eiEditSalvar" onclick="salvarEdicaoEscolaInterna('${scale.id}')">Salvar</button>
    </div>`;
}

async function salvarEdicaoEscolaInterna(id) {
  const scale = EscalaSmartState.scales.find(s => s.id === id);
  if (!scale) return;
  const date = document.getElementById('eiEditData').value;
  const startTime = document.getElementById('eiEditIni').value;
  const endTime = document.getElementById('eiEditFim').value;

  if (!date || !startTime || !endTime) { toast('Preencha data, início e fim.', 'error'); return; }
  if (escalaEhPassada(date)) { toast('Não dá para mover a sessão para uma data que já passou.', 'error'); return; }
  if (endTime <= startTime) { toast('O fim tem que ser depois do início.', 'error'); return; }

  const btn = document.getElementById('eiEditSalvar');
  btn.disabled = true; btn.textContent = 'Salvando…';

  // Publicada: tira as aulas antigas ANTES de gravar, senão o unpublish procura
  // pelo horário novo e deixa as antigas órfãs na agenda.
  if (scale.published) {
    const un = await ScaleService.unpublishFromAgenda(id);
    if (!un.success) { btn.disabled = false; btn.textContent = 'Salvar'; toast('Erro ao atualizar a agenda: ' + (un.error || 'falha'), 'error'); return; }
  }

  const res = await ScaleService.updateScale(id, { date, startTime, endTime });
  if (!res.success) { btn.disabled = false; btn.textContent = 'Salvar'; toast('Erro: ' + (res.error || 'falha'), 'error'); return; }

  if (scale.published) {
    const pub = await ScaleService.publishToAgenda(id);
    if (!pub.success) {
      toast('Sessão salva, mas falhou ao republicar na agenda — publique de novo.', 'error', 7000);
      closeEscalaModal(); renderEscalaGestao(); return;
    }
  }

  toast(scale.published ? 'Sessão atualizada e agenda republicada.' : 'Sessão atualizada.', 'success');
  closeEscalaModal();
  renderEscalaGestao();
}

async function excluirEscolaInterna(id) {
  const scale = EscalaSmartState.scales.find(s => s.id === id);
  if (!scale) return;
  if (escalaEhPassada(scale.date)) { toast('Sessão já realizada não pode ser excluída.', 'error'); return; }

  const aviso = scale.published
    ? `Excluir "${scale.name || scale.date}"?\n\nEla está PUBLICADA — as aulas dela também saem da agenda dos professores.`
    : `Excluir "${scale.name || scale.date}"?`;
  if (!confirm(aviso)) return;

  if (scale.published) {
    const un = await ScaleService.unpublishFromAgenda(id);
    if (!un.success) { toast('Erro ao tirar as aulas da agenda: ' + (un.error || 'falha'), 'error'); return; }
  }
  const res = await ScaleService.deleteScale(id);
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); return; }

  toast('Sessão excluída.', 'success');
  EscalaSmartState.selectedId = null;
  renderEscalaGestao();
}

// Evento na gestão: painel de staff (quem Deve/Poderia) + convite in-app aos novos + consolidado dos RSVP.
function renderEventoDetail(scale) {
  const rsvp = EscalaSmartState.eventoRsvp || new Map();
  const ativos = Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false);
  const tierDe = (pid) => { const r = rsvp.get(pid); return r ? r.tier : ''; };
  const linhas = ativos.map(t => {
    const tier = tierDe(t.id);
    const opt = (val, label) => `<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;margin-right:10px;"><input type="radio" name="staff_${t.id}" value="${val}" ${tier === val || (val === '' && !tier) ? 'checked' : ''}> ${label}</label>`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:13px;">${t.name}</span>
      <div>${opt('obrigatorio', 'Deve')}${opt('opcional', 'Poderia')}${opt('', 'Fora')}</div>
    </div>`;
  }).join('');

  const sum = ScaleService.summarizeRsvp(Array.from(rsvp.values()));
  const nome = (pid) => { const t = EscalaSmartState.teacherMap.get(pid); return t ? t.name : pid; };
  const bloco = (titulo, ids, cor) => ids.length
    ? `<div style="font-size:12px;margin-top:6px;"><span style="color:${cor};font-weight:600;">${titulo} (${ids.length}):</span> ${ids.map(nome).join(', ')}</div>` : '';
  const consolidado = rsvp.size
    ? `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-top:12px;">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em;">Confirmações</div>
        ${bloco('Vão', sum.vao, 'var(--green)')}${bloco('Não vão', sum.naoVao, 'var(--red)')}${bloco('Sem resposta', sum.semResposta, '#caa23a')}
      </div>` : '';

  // Sem etapa de "publicar": convidou, está valendo. A faixa abaixo diz isso em
  // voz alta pra ninguém ficar procurando um botão de confirmação que não existe.
  const prontoBar = rsvp.size
    ? `<div style="display:flex;align-items:flex-start;gap:8px;background:var(--green-bg,rgba(92,184,92,0.08));border:1px solid var(--green);border-radius:10px;padding:10px 12px;margin-bottom:12px;">
        <span style="color:var(--green);">✓</span>
        <span style="font-size:12px;color:var(--text2);"><b style="color:var(--green);">Evento no ar.</b> ${rsvp.size} pessoa(s) convidada(s) — elas já veem o evento no app e recebem lembrete 7, 4 e 1 dia antes. Não há nada mais pra confirmar aqui. Depois do evento, registre quem veio em <b style="color:var(--text);">Engajamento → Confirmar Presença</b>: é o que gera os pontos.</span>
      </div>`
    : `<div style="font-size:12px;color:var(--text2);background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:12px;">
        Marque abaixo quem <b>deve</b> e quem <b>poderia</b> participar e clique em <b>Salvar staff e convidar</b>. É só isso — evento não precisa ser publicado.
      </div>`;

  const kindBadge = scale.eventKind === 'externo' ? 'Externo' : 'Interno';
  return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;">
    <div style="margin-bottom:12px;"><div style="font-weight:600;">${scale.name || scale.date}</div>
      <div style="font-size:12px;color:var(--text2);">${scale.date} · ${kindBadge}</div></div>
    ${prontoBar}
    <div style="font-size:13px;font-weight:500;margin-bottom:6px;">Staff — quem deve / poderia participar</div>
    <div style="max-height:40vh;overflow:auto;">${linhas || '<p style="color:var(--text2);">Nenhum colaborador ativo.</p>'}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:10px;">
      <button class="btn-secondary" style="color:var(--red);border-color:var(--red);" onclick="excluirEvento('${scale.id}')">🗑️ Excluir evento</button>
      <button class="btn-primary" onclick="salvarStaffEvento('${scale.id}')">Salvar staff e convidar</button>
    </div>
    ${consolidado}
  </div>`;
}

/**
 * Exclui um evento. Só evento — a regra do Firestore recusa o resto.
 * O aviso diz quantas pessoas perdem o convite: apagar o evento errado depois de
 * 16 confirmações seria bem pior do que conviver com o duplicado.
 */
async function excluirEvento(scaleId) {
  const scale = EscalaSmartState.scales.find(s => s.id === scaleId);
  if (!scale) { toast('Evento não encontrado.', 'error'); return; }
  const rsvp = EscalaSmartState.eventoRsvp || new Map();
  const convidados = rsvp.size;
  const confirmados = Array.from(rsvp.values()).filter(r => r.going === true).length;

  let aviso = `Excluir "${scale.name || scale.date}"?\n\nEssa ação não tem volta.`;
  if (convidados) {
    aviso += `\n\n⚠️ ${convidados} pessoa(s) foram convidadas` +
             (confirmados ? ` e ${confirmados} já confirmaram presença` : '') +
             `. Elas perdem o convite e param de receber os lembretes.`;
  } else {
    aviso += `\n\nNinguém foi convidado ainda.`;
  }
  if (!confirm(aviso)) return;

  toast('Excluindo…', 'info');
  const res = await ScaleService.deleteEvent(scaleId);
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); return; }
  toast('Evento excluído.', 'success');
  EscalaSmartState.selectedId = null;
  EscalaSmartState.eventoRsvp = new Map();
  await escalaLoadBase();
  renderEscalaGestao();
}

async function salvarStaffEvento(scaleId) {
  const obrigatorios = [], opcionais = [];
  Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false).forEach(t => {
    const sel = document.querySelector(`input[name="staff_${t.id}"]:checked`);
    const v = sel ? sel.value : '';
    if (v === 'obrigatorio') obrigatorios.push(t.id);
    else if (v === 'opcional') opcionais.push(t.id);
  });
  const res = await ScaleService.setEventStaff(scaleId, obrigatorios, opcionais);
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); return; }
  const novos = res.data.added || [];
  if (novos.length) {
    const scale = EscalaSmartState.scales.find(s => s.id === scaleId) || {};
    const recipientIds = [];
    for (const pid of novos) {
      const t = EscalaSmartState.teacherMap.get(pid);
      let uid = t && t.userId ? t.userId : null;
      if (!uid) { try { const us = await db.collection('users').where('professorId', '==', pid).limit(1).get(); if (!us.empty) uid = us.docs[0].id; } catch (e) {} }
      if (uid) recipientIds.push(uid);
    }
    if (recipientIds.length) {
      await NotifyService.send({ recipients: recipientIds, type: 'event_invite', title: 'Convite de evento',
        body: `Você está no staff de ${scale.name || 'um evento'} (${escalaFmtBR(scale.date)}). Confirme presença.`,
        link: { type: 'escala-smart', id: scaleId }, channels: ['inapp'] });
    }
  }
  toast('Staff salvo. Convite enviado aos novos.', 'success');
  renderEscalaGestao();
}

/**
 * Troca quem trabalha numa vaga de sábado/feriado, sem refazer a escala inteira.
 * Se a escala já está publicada, republica: senão a agenda (e o pagamento que sai
 * dela) continuaria com a pessoa antiga. Publicar é idempotente e respeita aula
 * de mês já pago, então republicar aqui é seguro.
 */
async function trocarPessoaEscala(scaleId, slotId, personId) {
  const res = await ScaleService.reassignSlot(scaleId, slotId, personId || null);
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); renderEscalaGestao(); return; }
  if (!res.data.changed) return;

  let msg = 'Vaga atualizada.';
  if (res.data.fairnessAjustada) msg += ' Contador de justiça acertado.';
  if (res.data.published) {
    const pub = await ScaleService.publishToAgenda(scaleId);
    msg += pub.success ? ' Agenda republicada.' : ' ⚠️ Falhou republicar na agenda — republique na mão.';
  }
  toast(msg, res.data.published ? 'success' : 'success');
  await escalaLoadBase();
  renderEscalaGestao();
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
  if (scale.tipo === 'evento') return renderEventoDetail(scale);
  const byUnit = {};
  (scale.slots || []).forEach(s => { (byUnit[s.unitId] = byUnit[s.unitId] || []).push(s); });
  const unitName = (uid) => { const u = EscalaSmartState.units.find(x => x.id === uid); return u ? u.name : uid; };
  const reasonChip = (r) => {
    if (r === 'justica') return `<span style="font-size:11px;padding:2px 8px;border-radius:6px;background:var(--blue-bg,#1a2a3a);color:var(--blue);">⚖ Justiça</span>`;
    if (r === 'merito') return `<span style="font-size:11px;padding:2px 8px;border-radius:6px;background:#2a2410;color:#caa23a;">★ Mérito</span>`;
    if (r === 'manual') return `<span style="font-size:11px;padding:2px 8px;border-radius:6px;background:#2a1a2e;color:#c77dff;">✋ Escolha da gestão</span>`;
    return '';
  };

  // Troca manual da pessoa na vaga. Quem tem a modalidade vem primeiro; os demais
  // ficam num grupo à parte — a gestão pode escalar assim mesmo, mas vendo que
  // aquela pessoa não é habilitada.
  const pessoaOpts = (slot) => {
    const req = slot.requiredModalityId;
    const ativos = Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false);
    const temMod = (t) => !req || (t.modalityIds || []).includes(req);
    const opt = (t) => `<option value="${t.id}" ${t.id === slot.assignedPersonId ? 'selected' : ''}>${t.name}</option>`;
    const aptos = ativos.filter(temMod).map(opt).join('');
    const outros = ativos.filter(t => !temMod(t)).map(opt).join('');
    return `<option value="">— vaga aberta —</option>${aptos}` +
           (outros ? `<optgroup label="Não habilitados nesta modalidade">${outros}</optgroup>` : '');
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
        ${slot.startTime ? `<div style="font-size:11px;color:var(--text2);margin-bottom:4px;">🕗 ${slot.startTime}–${slot.endTime || ''}</div>` : ''}
        <div style="font-size:14px;font-weight:${filled ? '600' : '400'};color:${filled ? 'var(--text)' : 'var(--text3)'};">${filled ? person : 'ninguém habilitado disponível'}</div>
        <select class="input" style="width:100%;margin-top:6px;font-size:12px;"
                onchange="trocarPessoaEscala('${scale.id}','${slot.id}',this.value)"
                title="Trocar quem trabalha nesta vaga">${pessoaOpts(slot)}</select>
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

function openNovoEvento(dateISO) {
  const overlay = document.getElementById('escalaModalOverlay');
  const modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex';
  modal.style.display = 'block';
  modal.innerHTML = `
    <h2>Novo evento</h2>
    <div class="form-group"><label>Nome <span style="color:var(--red);">*</span></label><input type="text" id="evNome" class="input" placeholder="Ex.: Reunião do staff, treinamento interno, trilha, beach games"></div>
    <div class="form-group"><label>Data <span style="color:var(--red);">*</span></label><input type="date" id="evData" class="input" value="${dateISO || escalaTodayISO()}"></div>
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
  // Evento não tem vagas de TOI/Hiit — é painel de staff (quem trabalha/representa). Sem modalidades exigidas.
  if (tipo !== 'evento' && (!toi || !hiit)) { toast('Cadastre as modalidades TOI e Hiit antes.', 'error'); return; }
  const tipoLabel = (ESCALA_TIPOS.find(t => t.id === tipo) || {}).label || tipo;
  const payload = { date, tipo, name: name || `${tipoLabel} ${escalaFmtBR(date)}`, slots: tipo === 'evento' ? [] : escalaSlotsPadrao(tipo) };
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

/**
 * Férias/recessos APROVADOS — alimentam a exclusão de candidatos na consolidação.
 * Falha silenciosa devolve [] de propósito: sem a lista, o motor volta a se comportar
 * como antes (escala mesmo quem está de férias) em vez de travar a consolidação.
 * A gestão ainda vê o resultado na Revisão antes de confirmar.
 */
async function escalaCarregarFerias() {
  if (typeof VacationService !== 'object' || typeof VacationService.listAll !== 'function') return [];
  try {
    const res = await VacationService.listAll({ status: 'aprovada' });
    return (res && res.success) ? res.data : [];
  } catch (e) { console.warn('[escalaCarregarFerias]', e); return []; }
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
    vacations: await escalaCarregarFerias(),
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
  // Quem está de férias em alguma data do lote — a gestão precisa ver ANTES de
  // confirmar por que aquela pessoa não vai aparecer em nenhuma vaga.
  const vacs = await escalaCarregarFerias();
  const feriasPorPessoa = new Map();
  scales.forEach(s => {
    ScaleService.personsOnVacation(vacs, s.date).forEach(pid => {
      if (!feriasPorPessoa.has(pid)) feriasPorPessoa.set(pid, []);
      feriasPorPessoa.get(pid).push(escalaFmtBR(s.date));
    });
  });
  renderRevisaoFechamento(batchId, scales, matrix, feriasPorPessoa);
}

function renderRevisaoFechamento(batchId, scales, matrix, feriasPorPessoa) {
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
  const ferias = (feriasPorPessoa && feriasPorPessoa.size)
    ? `<p style="font-size:12px;color:var(--blue);margin:8px 0;">🏖️ De férias e por isso fora da escala: ${
        Array.from(feriasPorPessoa.entries()).map(([pid, datas]) => `${escalaPersonName(pid)} (${datas.join(', ')})`).join(' · ')
      }</p>` : '';
  modal.innerHTML = `
    <h2>Revisão de fechamento</h2>
    <p style="font-size:12px;color:var(--text2);">★ prefiro · ✓ pode ser · ✕ não posso · célula destacada = escalado. Vagas abertas: ${matrix.vagasAbertas}.</p>
    <div style="overflow:auto;max-height:50vh;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    ${semCand}
    ${ferias}
    <p style="font-size:12px;color:var(--text2);">Ao confirmar, o sistema consolida as vagas abertas por justiça+mérito, <b>publica as aulas na agenda</b> e avisa todos no sistema. Quem está de férias aprovadas na data <b>não é escalado</b>.</p>
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
    vacations: await escalaCarregarFerias(),
  };
  // Consolidar + PUBLICAR na mesma passada. Antes o lote só consolidava, e o
  // aviso mandava "Confira sua agenda" apontando pra uma tela vazia: as aulas só
  // nasciam se alguém abrisse cada sábado e clicasse "📅 Publicar na agenda", um
  // por um. Com 2 meses de sábados isso é garantia de esquecer. (Rafael, 14/08.)
  // publishToAgenda é idempotente e não recria slot de mês já fechado.
  let aulasCriadas = 0, vagasSemAula = 0;
  const falhas = [];
  for (const s of byBatch.data) {
    await ScaleService.closeElection(s.id);
    const cons = await ScaleService.consolidate(s.id, ctx);
    if (!cons.success) { falhas.push(`${escalaFmtBR(s.date)} (consolidar)`); continue; }
    const pub = await ScaleService.publishToAgenda(s.id);
    if (pub.success) {
      aulasCriadas += (pub.data && pub.data.created) || 0;
      // Vaga sem ninguém OU sem horário é PULADA em silêncio pelo publish. Numa
      // escala antiga (rascunho criado antes de configurar os horários do tipo)
      // isso reproduz de novo o "sábado não aparece na agenda", por outro motivo.
      vagasSemAula += ((pub.data && pub.data.vagasAbertas) || []).length;
    } else falhas.push(`${escalaFmtBR(s.date)} (publicar)`);
  }

  // Só avisa o time do que REALMENTE está na agenda. Avisar sobre data que
  // falhou é repetir o problema que este bloco corrige.
  const ok = byBatch.data.filter(s => !falhas.some(f => f.startsWith(escalaFmtBR(s.date))));
  const rec = await NotifyService.resolveActiveTeacherUserIds();
  if (ok.length && rec.success && rec.data.length) {
    const datas = ok.slice().sort((a, b) => (a.date > b.date ? 1 : -1)).map(s => escalaFmtBR(s.date)).join(', ');
    await NotifyService.send({
      recipients: rec.data, type: 'scale_confirmed',
      title: 'Escala confirmada',
      body: `A escala dos dias ${datas} foi definida. Confira sua agenda.`,
      link: { type: 'escala-smart', id: batchId }, channels: ['inapp'],
    });
  }

  const sobra = vagasSemAula
    ? ` ⚠️ ${vagasSemAula} vaga(s) ficaram SEM aula (sem ninguém escalado ou sem horário configurado) — confira essas datas.`
    : '';
  if (falhas.length) {
    toast(`Confirmado com ${aulasCriadas} aula(s) na agenda, mas FALHOU em: ${falhas.join(', ')}. `
        + `Abra essas datas e publique na mão — quem depende delas não foi avisado.${sobra}`, 'error', 12000);
  } else if (vagasSemAula) {
    toast(`Escala confirmada, ${aulasCriadas} aula(s) na agenda e time avisado.${sobra}`, 'error', 10000);
  } else {
    toast(`Escala confirmada, ${aulasCriadas} aula(s) na agenda e time avisado.`, 'success');
  }
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
  container.innerHTML = `<div class="page-hdr"><h1>🗓️ Escala — minhas datas${ajudaBtn("escala-smart")}</h1><p>Candidate-se onde a janela estiver aberta; consulte onde você está escalado.</p></div>
    <div class="loading"><div class="spinner"></div> Carregando…</div>`;

  const pid = escalaProfId();
  const [scalesRes, teachersRes] = await Promise.all([ScaleService.listScales(), TeacherService.list()]);
  EscalaSmartState.scales = scalesRes.success ? scalesRes.data : [];
  EscalaSmartState.teacherMap = new Map((teachersRes.success ? teachersRes.data : []).map(t => [t.id, t]));
  if (EscalaSmartState.tab === 'feriado') await escalaLoadFeriados(EscalaSmartState.year);

  const tab = EscalaSmartState.tab;
  const tabsHtml = `<div class="escala-tabs">` +
    ESCALA_TABS.map(t =>
      `<button class="escala-tab${t.id === tab ? ' active' : ''}" onclick="escalaSetTab('${t.id}')">${t.label}</button>`
    ).join('') + `</div>`;

  let body;
  if (tab === 'sabado' || tab === 'feriado') body = await renderProfSabadosFeriados(pid, tab);
  else if (tab === 'fim_de_ano')                body = await renderProfFimDeAno(pid);
  else if (tab === 'evento')                    body = await renderProfEventos();
  else                                          body = renderProfEscolaInterna(pid);

  container.innerHTML = `<div class="page-hdr"><h1>🗓️ Escala — minhas datas${ajudaBtn("escala-smart")}</h1><p>Candidate-se onde a janela estiver aberta; consulte onde você está escalado.</p></div>
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
      return profDateRow(s, `${s.date}${escalaHorario(s) ? ` · 🕗 ${escalaHorario(s)}` : ''} · ${prazo}`, right);
    }
    // ANTES da eleição acontecer, "Não escalado" MENTE: o professor lê como "não
    // fui escolhido" quando a verdade é "ainda nem começou". Pior, ao lado vinha
    // a palavra "Rascunho", que é vocabulário nosso e não diz nada pra ele.
    // Relato real no grupo (14/08/2026): "qnd vou em minha agenda não tem sábado,
    // qnd vou em escala aparece sábado (15/08) - não escalado".
    if (s.status !== 'consolidada') {
      return profDateRow(
        s,
        `${s.date}${escalaHorario(s) ? ` · 🕗 ${escalaHorario(s)}` : ''} · Ainda não liberado`,
        `<span style="font-size:12px;color:var(--text3);">A gestão ainda não abriu as candidaturas</span>`
      );
    }
    const escalado = ScaleService.isPersonAssigned(s, pid);
    right = escalado
      ? `<span style="font-size:12px;color:var(--green);font-weight:600;">✓ Você está escalado</span>`
      : `<span style="font-size:12px;color:var(--text3);">Não escalado desta vez</span>`;
    return profDateRow(s, `${s.date}${escalaHorario(s) ? ` · 🕗 ${escalaHorario(s)}` : ''} · Escala definida`, right);
  }).join('');
}

function profDateRow(s, sub, right) {
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;flex-wrap:wrap;">
    <div><div style="font-weight:600;font-size:14px;">${s.name || s.date}</div><div style="font-size:12px;color:var(--text2);">${sub}</div></div>
    ${right}
  </div>`;
}

async function renderProfFimDeAno(pid) {
  const escalas = EscalaSmartState.scales.filter(s => s.tipo === 'fim_de_ano');
  if (!escalas.length) return `<p style="padding:20px;color:var(--text2);">Nenhum período de fim de ano.</p>`;
  const nowISO = ScaleService.nowLocalMinute();
  let html = '';
  for (const s of escalas) {
    const open = ScaleService.isWindowOpen(s, nowISO);
    const dias = [...new Set((s.slots || []).map(sl => sl.day))].sort();
    const shiftsByDay = {};
    dias.forEach(day => { shiftsByDay[day] = [...new Set((s.slots || []).filter(sl => sl.day === day).map(sl => sl.shift))]; });
    const dpRes = await ScaleService.listDayPreferences(s.id);
    const mine = {};
    (dpRes.success ? dpRes.data : []).filter(p => p.personId === pid).forEach(p => { mine[p.date] = p; });

    const cabecalho = `<div style="font-weight:600;margin:4px 0 8px;">${s.name || s.date}${open ? '' : ` · <span style="color:var(--red);font-size:12px;">janela encerrada</span>`}</div>`;
    const diasHtml = dias.map(day => {
      const cur = mine[day] || { pref: null, excludedShifts: [] };
      const shifts = shiftsByDay[day];
      const shiftLabel = (sid) => sid === 'manha' ? 'Manhã' : (sid === 'tarde_noite' ? 'Tarde/Noite' : sid);
      const pbtn = (pref, label, color) => {
        const active = cur.pref === pref;
        const style = active ? `background:${color};color:#0a0a0a;border:1px solid ${color};font-weight:600;` : `background:transparent;color:var(--text2);border:1px solid var(--border);`;
        return `<button ${open ? '' : 'disabled'} onclick="marcarDiaFdA('${s.id}','${day}','${pref}')" style="font-size:12px;padding:6px 10px;border-radius:8px;cursor:${open ? 'pointer' : 'not-allowed'};opacity:${open ? 1 : 0.5};${style}">${label}</button>`;
      };
      const turnos = (cur.pref && cur.pref !== 'nao_posso')
        ? shifts.map(sh => {
            const excl = (cur.excludedShifts || []).includes(sh);
            return `<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;margin-right:10px;color:${excl ? 'var(--text3)' : 'var(--text2)'};"><input type="checkbox" ${excl ? '' : 'checked'} ${open ? '' : 'disabled'} onchange="toggleTurnoFdA('${s.id}','${day}','${sh}')"> ${shiftLabel(sh)}</label>`;
          }).join('')
        : '';
      return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:6px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <span style="font-weight:600;font-size:13px;">${escalaFmtBR(day)}</span>
          <div style="display:flex;gap:6px;">${pbtn('prefiro', 'Prefiro', 'var(--green)')}${pbtn('pode_ser', 'Pode ser', '#5EA8FF')}${pbtn('nao_posso', 'Não posso', 'var(--red)')}</div>
        </div>
        ${turnos ? `<div style="margin-top:8px;">${turnos}</div>` : ''}
      </div>`;
    }).join('');
    html += cabecalho + diasHtml;
  }
  return html;
}

// Marca a preferência do DIA no fim de ano (preserva os turnos excluídos já marcados).
async function marcarDiaFdA(scaleId, date, pref) {
  const pid = escalaProfId();
  if (!pid) { toast('Seu perfil não está vinculado a um professor.', 'error'); return; }
  const dpRes = await ScaleService.listDayPreferences(scaleId);
  const cur = (dpRes.success ? dpRes.data : []).find(p => p.personId === pid && p.date === date);
  const excluded = pref === 'nao_posso' ? [] : (cur ? cur.excludedShifts || [] : []);
  const res = await ScaleService.setDayPreference(scaleId, pid, date, pref, excluded);
  if (res.success) { toast('Preferência registrada!', 'success'); renderEscalaPrefs(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}

// Liga/desliga um turno do dia (só quando já há Prefiro/Pode ser marcado).
async function toggleTurnoFdA(scaleId, date, shift) {
  const pid = escalaProfId();
  if (!pid) return;
  const dpRes = await ScaleService.listDayPreferences(scaleId);
  const cur = (dpRes.success ? dpRes.data : []).find(p => p.personId === pid && p.date === date);
  if (!cur || !cur.pref) { toast('Marque Prefiro/Pode ser antes de ajustar o turno.', 'info'); return; }
  const set = new Set(cur.excludedShifts || []);
  if (set.has(shift)) set.delete(shift); else set.add(shift);
  const res = await ScaleService.setDayPreference(scaleId, pid, date, cur.pref, Array.from(set));
  if (res.success) renderEscalaPrefs();
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}

// Eventos na visão do professor: acionável (RSVP Vou/Não vou para quem foi convidado/staff).
async function renderProfEventos() {
  const pid = escalaProfId();
  let docs = EscalaSmartState.scales.filter(s => s.tipo === 'evento');
  docs = ScaleService.filterByTimeframe(docs, escalaTodayISO(), EscalaSmartState.timeframe);
  if (!docs.length) return `<p style="padding:20px;color:var(--text2);">Nenhum evento ${EscalaSmartState.timeframe === 'futuros' ? 'próximo' : ''}.</p>`;
  const parts = [];
  for (const s of docs) {
    const rr = await ScaleService.listEventRsvp(s.id);
    const mine = (rr.success ? rr.data : []).find(r => r.personId === pid);
    const kind = s.eventKind === 'externo' ? 'Externo' : 'Interno';
    let right;
    if (mine) {
      const rbtn = (val, label, color) => {
        const active = mine.going === val;
        const style = active ? `background:${color};color:#0a0a0a;border:1px solid ${color};font-weight:600;` : `background:transparent;color:var(--text2);border:1px solid var(--border);`;
        return `<button onclick="responderEvento('${s.id}',${val})" style="font-size:13px;padding:7px 12px;border-radius:8px;cursor:pointer;${style}">${label}</button>`;
      };
      right = `<div style="display:flex;gap:6px;">${rbtn(true, 'Vou', 'var(--green)')}${rbtn(false, 'Não vou', 'var(--red)')}</div>`;
    } else {
      right = `<span style="font-size:12px;color:var(--text3);">informativo</span>`;
    }
    parts.push(`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;flex-wrap:wrap;">
      <div><div style="font-weight:600;font-size:14px;">${s.name || s.date}</div><div style="font-size:12px;color:var(--text2);">${escalaFmtBR(s.date)} · ${kind}${mine && mine.tier === 'obrigatorio' ? ' · você deve participar' : (mine ? ' · você poderia participar' : '')}</div></div>
      ${right}
    </div>`);
  }
  return parts.join('');
}

async function responderEvento(scaleId, going) {
  const pid = escalaProfId();
  if (!pid) { toast('Seu perfil não está vinculado a um professor.', 'error'); return; }
  const res = await ScaleService.setRsvp(scaleId, pid, going);
  if (res.success) { toast(going ? 'Presença confirmada!' : 'Ok, marcado como não vou.', 'success'); renderEscalaPrefs(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}

// Escola Interna na visão do professor: read-only, destaca onde ele é o líder escalado.
function renderProfEscolaInterna(pid) {
  let docs = EscalaSmartState.scales.filter(s => s.tipo === 'escola_interna');
  docs = ScaleService.filterByTimeframe(docs, escalaTodayISO(), EscalaSmartState.timeframe);
  if (!docs.length) return `<p style="padding:20px;color:var(--text2);">Nenhuma sessão de Escola Interna ${EscalaSmartState.timeframe === 'futuros' ? 'próxima' : ''}.</p>`;
  return docs.map(s => {
    const souLider = (s.slots || []).some(sl => sl.role === 'lider' && sl.assignedPersonId === pid);
    const right = souLider
      ? `<span style="font-size:12px;color:#caa23a;font-weight:600;">★ Você lidera</span>`
      : `<span style="font-size:12px;color:var(--text3);">—</span>`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;">
      <div><div style="font-weight:600;font-size:14px;">${s.name || s.date}</div><div style="font-size:12px;color:var(--text2);">${escalaFmtBR(s.date)}</div></div>
      ${right}
    </div>`;
  }).join('');
}

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
window.responderEvento = responderEvento;
window.marcarPodeSerTodas = marcarPodeSerTodas;
window.marcarDiaFdA = marcarDiaFdA;
window.toggleTurnoFdA = toggleTurnoFdA;
window.renderTabEscolaInterna = renderTabEscolaInterna;
window.openNovaEscolaInterna = openNovaEscolaInterna;
window.criarEscolaInterna = criarEscolaInterna;
window.atribuirLider = atribuirLider;
window.trocarPessoaEscala = trocarPessoaEscala;
window.salvarStaffEvento = salvarStaffEvento;

console.log('[CrossTainer Professores] professores-escala-smart.js carregado · Escala Inteligente (5b)');
