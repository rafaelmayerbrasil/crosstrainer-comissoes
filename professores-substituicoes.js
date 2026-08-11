// ═══════════════════════════════════════════════════════════════════════
// professores-substituicoes.js — Substituições (bloco 3, 11/08/2026)
//
// Uma tela só, dois públicos:
//   • Professor  → "Pedi" e "Cobri", com HISTÓRICO (não só o que está pendente)
//   • Gestão     → todas as substituições da academia, com filtro por professor
//                  e período
//
// Por que existe: a caixa de entrada só mostrava pedido PENDENTE direcionado a
// você. Depois de aceito, sumia — e a aula também sumia da agenda do titular
// (a CF troca o teacherId). Ninguém conseguia responder "o que aconteceu com
// aquela aula que eu passei?".
// ═══════════════════════════════════════════════════════════════════════

const SubsState = {
  aba: 'pedi',            // professor: 'pedi' | 'cobri'
  filtroTeacherId: '',    // gestão
  filtroDe: '', filtroAte: '',
  pedi: [], cobri: [], todas: [],
  loading: false,
};

function subsEhGestao() {
  return (typeof isAdminGestao === 'function' && isAdminGestao())
      || (typeof isSupervisao === 'function' && isSupervisao());
}

function subsEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function subsNomeProf(teacherId) {
  const t = AgendaState.teachersMap.get(teacherId);
  return t ? (t.name || '—') : '—';
}

function subsDataAula(sub) {
  const d = sub.classDate && sub.classDate.toDate ? sub.classDate.toDate() : null;
  if (!d) return '—';
  const dia = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const hora = sub.classStartTime ? ` · ${sub.classStartTime}` : '';
  return dia + hora;
}

function subsModalidade(sub) {
  const m = AgendaState.modalitiesMap.get(sub.classModalityId);
  return m ? m.name : '—';
}

const SUBS_STATUS_STYLE = {
  pending:   { label: 'Aguardando resposta', cor: 'var(--orange)' },
  accepted:  { label: 'Aceita',              cor: 'var(--green)' },
  rejected:  { label: 'Recusada',            cor: 'var(--red)' },
  cancelled: { label: 'Cancelada',           cor: 'var(--text3)' },
};

// ────────────────────────────────────────────────────────────────────────
// Entry point — professores.js → navigateTo('substituicoes')
// ────────────────────────────────────────────────────────────────────────
async function renderSubstituicoesPage() {
  const page = document.getElementById('page-substituicoes');
  if (!page) return;

  page.innerHTML = `
    <div class="page-toolbar"><div class="lhs"><h2>SUBSTITUIÇÕES</h2></div></div>
    <div class="loading"><div class="spinner"></div> Carregando…</div>
  `;

  // Nomes de professor e modalidade vêm daqui — sem isso a tela mostra ID cru,
  // que foi exatamente a reclamação do Rodrigo na caixa de entrada.
  if (AgendaState.modalitiesMap.size === 0 || AgendaState.teachersMap.size === 0) {
    const [modsRes, teachersRes] = await Promise.all([ModalityService.list(), TeacherService.list()]);
    AgendaState.modalitiesMap = new Map((modsRes.data || []).map(m => [m.id, m]));
    AgendaState.teachersMap = new Map((teachersRes.data || []).map(t => [t.id, t]));
  }

  if (subsEhGestao()) {
    const res = await SubstitutionService.listAll();
    SubsState.todas = res.success ? res.data : [];
    renderSubsGestao(page, res);
    return;
  }

  const pid = getCurrentProfessorId();
  if (!pid) {
    page.innerHTML = `
      <div class="page-toolbar"><div class="lhs"><h2>SUBSTITUIÇÕES</h2></div></div>
      <div class="empty-state">
        <div class="icon">🔗</div>
        <h3>Sua conta ainda não está vinculada a um cadastro de professor</h3>
        <p>Peça ao admin pra fazer o vínculo — sem ele não dá pra saber quais substituições são suas.</p>
      </div>`;
    return;
  }

  const res = await SubstitutionService.listHistoryForTeacher(pid);
  if (!res.success) {
    page.innerHTML = `
      <div class="page-toolbar"><div class="lhs"><h2>SUBSTITUIÇÕES</h2></div></div>
      <div class="empty-state"><div class="icon">⚠️</div><h3>Erro ao carregar</h3>
        <p>${subsEsc(res.error)}</p>
        <button class="btn btn-outline" onclick="renderSubstituicoesPage()">Tentar novamente</button></div>`;
    return;
  }
  SubsState.pedi = res.data.pedi;
  SubsState.cobri = res.data.cobri;
  renderSubsProfessor(page);
}

// ─── Visão do professor ──────────────────────────────────────────────────

function renderSubsProfessor(page) {
  const lista = SubsState.aba === 'pedi' ? SubsState.pedi : SubsState.cobri;
  const pendentesCobri = SubsState.cobri.filter(s => s.status === 'pending').length;

  page.innerHTML = `
    <div class="page-toolbar">
      <div class="lhs">
        <h2>SUBSTITUIÇÕES</h2>
        <div class="count">${lista.length} registro${lista.length === 1 ? '' : 's'}</div>
      </div>
      <div class="rhs minha-agenda-filters">
        <span class="chip ${SubsState.aba === 'pedi' ? 'chip-active' : ''}"
              onclick="setSubsAba('pedi')">Pedi (${SubsState.pedi.length})</span>
        <span class="chip ${SubsState.aba === 'cobri' ? 'chip-active' : ''}"
              onclick="setSubsAba('cobri')">Cobri (${SubsState.cobri.length})${pendentesCobri ? ' 🔴' : ''}</span>
      </div>
    </div>
    ${lista.length === 0
      ? `<div class="empty-state-small" style="padding:48px 24px;">
           ${SubsState.aba === 'pedi'
             ? 'Você ainda não pediu nenhuma substituição.'
             : 'Você ainda não cobriu nenhuma aula.'}
         </div>`
      : `<div class="minha-agenda-list">${lista.map(s => renderSubCard(s, SubsState.aba)).join('')}</div>`}
  `;
}

function setSubsAba(aba) {
  if (SubsState.aba === aba) return;
  SubsState.aba = aba;
  renderSubsProfessor(document.getElementById('page-substituicoes'));
}

/**
 * Cartão de uma substituição.
 * @param lado 'pedi' (eu passei a aula) · 'cobri' (eu peguei) · 'gestao'
 */
function renderSubCard(sub, lado) {
  const st = SUBS_STATUS_STYLE[sub.status] || { label: sub.status, cor: 'var(--text3)' };

  const quem = lado === 'pedi'
    ? `para <b>${subsEsc(subsNomeProf(sub.substituteTeacherId))}</b>`
    : lado === 'cobri'
      ? `de <b>${subsEsc(subsNomeProf(sub.requestingTeacherId))}</b>`
      : `${subsEsc(subsNomeProf(sub.requestingTeacherId))} → <b>${subsEsc(subsNomeProf(sub.substituteTeacherId))}</b>`;

  return `
    <div class="class-card" style="border-left:3px solid ${st.cor};cursor:default;">
      <div class="class-card-time" style="min-width:110px;">${subsEsc(subsDataAula(sub))}</div>
      <div class="class-card-info">
        <div class="class-card-modality">${subsEsc(subsModalidade(sub))} · ${quem}</div>
        <div class="class-card-unit">
          ${sub.reason ? `"${subsEsc(sub.reason)}"` : 'sem motivo informado'}
          ${sub.wasRetroactive ? ' · <span title="pedida depois da aula ter acontecido">⏱ retroativa</span>' : ''}
        </div>
        ${sub.responseNote ? `<div class="class-card-unit">resposta: "${subsEsc(sub.responseNote)}"</div>` : ''}
      </div>
      <div class="class-card-status">
        <span class="class-status-badge" style="color:${st.cor};border:1px solid ${st.cor};">${st.label}</span>
      </div>
    </div>
  `;
}

// ─── Visão de gestão ─────────────────────────────────────────────────────

function renderSubsGestao(page, res) {
  if (!res.success) {
    page.innerHTML = `
      <div class="page-toolbar"><div class="lhs"><h2>SUBSTITUIÇÕES</h2></div></div>
      <div class="empty-state"><div class="icon">⚠️</div><h3>Erro ao carregar</h3><p>${subsEsc(res.error)}</p></div>`;
    return;
  }

  const filtradas = filtrarSubsGestao(SubsState.todas);
  const professores = Array.from(AgendaState.teachersMap.values())
    .filter(t => t.isActive !== false)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));

  page.innerHTML = `
    <div class="page-toolbar">
      <div class="lhs">
        <h2>SUBSTITUIÇÕES</h2>
        <div class="count">${filtradas.length} de ${SubsState.todas.length}</div>
      </div>
    </div>
    <div class="filter-row" style="margin-bottom:12px;">
      <div class="filter-group">
        <label>Professor (pediu ou cobriu)</label>
        <select id="subs-teacher" class="input" onchange="aplicarFiltroSubs()">
          <option value="">Todos</option>
          ${professores.map(t => `<option value="${subsEsc(t.id)}" ${SubsState.filtroTeacherId === t.id ? 'selected' : ''}>${subsEsc(t.name)}</option>`).join('')}
        </select>
      </div>
      <div class="filter-group">
        <label>De</label>
        <input type="date" id="subs-de" class="input" style="width:150px;" value="${SubsState.filtroDe}" onchange="aplicarFiltroSubs()">
      </div>
      <div class="filter-group">
        <label>Até</label>
        <input type="date" id="subs-ate" class="input" style="width:150px;" value="${SubsState.filtroAte}" onchange="aplicarFiltroSubs()">
      </div>
      ${(SubsState.filtroTeacherId || SubsState.filtroDe || SubsState.filtroAte)
        ? `<button class="btn btn-outline" style="align-self:flex-end;" onclick="limparFiltroSubs()">Limpar</button>` : ''}
    </div>
    ${filtradas.length === 0
      ? `<div class="empty-state-small" style="padding:48px 24px;">Nenhuma substituição nesses filtros.</div>`
      : `<div class="minha-agenda-list">${filtradas.map(s => renderSubCard(s, 'gestao')).join('')}</div>`}
  `;
}

/**
 * Filtro da gestão: por professor (dos dois lados) e por período da AULA — que
 * é o que a gestão pergunta ("o que aconteceu na semana passada?"), não a data
 * em que o pedido foi feito.
 */
function filtrarSubsGestao(subs) {
  const tid = SubsState.filtroTeacherId;
  const de = SubsState.filtroDe ? new Date(SubsState.filtroDe + 'T00:00:00') : null;
  const ate = SubsState.filtroAte ? new Date(SubsState.filtroAte + 'T23:59:59') : null;

  return (subs || []).filter(s => {
    if (tid && s.requestingTeacherId !== tid && s.substituteTeacherId !== tid) return false;
    if (de || ate) {
      const d = s.classDate && s.classDate.toDate ? s.classDate.toDate() : null;
      if (!d) return false;
      if (de && d < de) return false;
      if (ate && d > ate) return false;
    }
    return true;
  });
}

function aplicarFiltroSubs() {
  SubsState.filtroTeacherId = (document.getElementById('subs-teacher') || {}).value || '';
  SubsState.filtroDe = (document.getElementById('subs-de') || {}).value || '';
  SubsState.filtroAte = (document.getElementById('subs-ate') || {}).value || '';
  renderSubsGestao(document.getElementById('page-substituicoes'), { success: true });
}

function limparFiltroSubs() {
  SubsState.filtroTeacherId = ''; SubsState.filtroDe = ''; SubsState.filtroAte = '';
  renderSubsGestao(document.getElementById('page-substituicoes'), { success: true });
}

window.renderSubstituicoesPage = renderSubstituicoesPage;
window.setSubsAba = setSubsAba;
window.aplicarFiltroSubs = aplicarFiltroSubs;
window.limparFiltroSubs = limparFiltroSubs;

console.log('[CrossTainer Professores] professores-substituicoes.js carregado · bloco 3');
