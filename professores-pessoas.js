// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Hub Pessoas (lista + wizard "Nova pessoa" + ficha 4 abas)
// Spec: docs/superpowers/specs/2026-06-11-hub-pessoas-design.md (D1–D14)
// Reusa: TeacherService/SalaryService/UnitService/ModalityService,
//        teacherModal + salaryModal (hooks onSaved/onClosed), PessoasModel, UserModel.
// Carrega teachers/modalidades/units nos containers do ProfessoresState
// de propósito: é o que os modais reusados leem.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

// Dono do sistema (D3) — perfil travado na UI; espelha OWNER_EMAIL do index.html
const PESSOAS_OWNER_EMAIL = 'abluir@gmail.com';

const PessoasState = {
  users: [],
  people: [],
  filters: { search: '', profile: 'all' },
  selectedKey: null,
  activeTab: 'identidade',
};

let PessoasAccessCtx = null; // { profiles: [], teacherId: string|null } durante o modal de Acesso

// ── Entry point — professores.js → navigateTo('pessoas') ────────────────
async function renderPessoasPage() {
  const page = document.getElementById('page-pessoas');
  if (!page) return;
  page.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando pessoas…</div>';

  const [tRes, mRes, uRes] = await Promise.all([
    TeacherService.list(),
    ModalityService.list(),
    UnitService.list(),
  ]);
  if (!tRes.success) {
    page.innerHTML = `
      <div class="page-toolbar"><div class="lhs"><h2>PESSOAS</h2></div></div>
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <h3>Erro ao carregar</h3>
        <p>${escapeHtml(tRes.error || 'Erro desconhecido')}</p>
        <button class="btn btn-outline" onclick="renderPessoasPage()">Tentar novamente</button>
      </div>`;
    return;
  }
  ProfessoresState.list = tRes.data;
  ProfessoresState.modalitiesMap = mRes.success ? new Map(mRes.data.map(m => [m.id, m])) : new Map();
  ProfessoresState.unitsMap = uRes.success ? new Map(uRes.data.map(u => [u.id, u])) : new Map();

  // users SÓ pra admin — supervisão não lê a coleção (D5, §7 do spec)
  PessoasState.users = [];
  if (isStrictAdmin()) {
    try {
      const snap = await db.collection('users').get();
      PessoasState.users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.warn('[pessoas] coleção users indisponível:', err);
    }
  }

  PessoasState.people = PessoasModel.buildPeople(PessoasState.users, tRes.data);
  if (PessoasState.selectedKey && !PessoasState.people.find(p => p.key === PessoasState.selectedKey)) {
    PessoasState.selectedKey = null;
  }
  renderPessoasContent();
}

// ── Render da lista (reusa o CSS do grid de professores) ────────────────
function renderPessoasContent() {
  const page = document.getElementById('page-pessoas');
  if (!page) return;
  const isAdm = isStrictAdmin();
  const filtered = PessoasModel.filterPeople(PessoasState.people, PessoasState.filters);
  const selected = PessoasState.people.find(p => p.key === PessoasState.selectedKey) || null;

  const total = PessoasState.people.length;
  const semAcesso = isAdm ? PessoasState.people.filter(p => !p.hasAccess).length : 0;

  const profileOptions = [
    { v: 'all', label: 'Todos os perfis' },
    ...UserModel.PROFILE_ORDER.map(pr => ({ v: pr, label: UserModel.PROFILE_LABELS[pr] })),
    ...(isAdm ? [{ v: 'sem-acesso', label: '— Sem acesso' }] : []),
  ];

  page.innerHTML = `
    <div class="page-toolbar">
      <div class="lhs">
        <h2>PESSOAS</h2>
        <div class="count">${total} pessoa${total !== 1 ? 's' : ''}${semAcesso ? ` · ${semAcesso} sem acesso` : ''}</div>
      </div>
      <div class="rhs">
        <input type="search" class="search-input" placeholder="🔍 Buscar por nome ou email…"
               value="${escapeHtml(PessoasState.filters.search)}"
               oninput="setPessoasSearch(this.value)">
        <select class="search-input" style="max-width:180px;" onchange="setPessoasProfileFilter(this.value)">
          ${profileOptions.map(o => `<option value="${o.v}" ${PessoasState.filters.profile === o.v ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
        ${isAdm ? '<button class="btn" onclick="openPessoaWizard()">+ Nova pessoa</button>' : ''}
      </div>
    </div>
    <div class="teachers-grid">
      <div class="teachers-list-container">
        <div class="teachers-list" id="pessoasList">
          ${filtered.length === 0
            ? '<div class="empty-state-small">Nenhuma pessoa encontrada com esses filtros.</div>'
            : filtered.map(p => renderPessoaListItem(p)).join('')}
        </div>
      </div>
      <div class="teachers-ficha" id="pessoaFicha">
        ${selected ? renderPessoaFicha(selected) : `
          <div class="empty-state">
            <div class="icon">👥</div>
            <h3>Selecione uma pessoa</h3>
            <p>Clique em alguém na lista pra ver a ficha completa.</p>
          </div>`}
      </div>
    </div>`;

  if (selected) afterPessoaFichaRender(selected);
}

function pessoaBadgesHtml(profiles) {
  return (profiles || []).map(pr =>
    `<span class="pill" style="font-size:9px;padding:2px 6px;margin-right:4px;">${UserModel.PROFILE_LABELS[pr] || pr}</span>`
  ).join('');
}

function renderPessoaListItem(p) {
  const isSelected = PessoasState.selectedKey === p.key;
  const avatarType = p.teacher ? p.teacher.type : 'efetivo';
  const accessBadge = isStrictAdmin()
    ? (p.hasAccess
        ? ''
        : '<span class="pill pill-inactive" style="font-size:9px;padding:2px 6px;">SEM ACESSO</span>')
    : '';
  return `
    <div class="teacher-list-item ${isSelected ? 'selected' : ''}" onclick="selectPessoa('${p.key}')">
      ${avatarHtml(p.name, avatarType, 36)}
      <div class="teacher-info">
        <div class="teacher-name">${escapeHtml(p.name)}</div>
        <div class="teacher-meta">${escapeHtml(p.email || '—')}</div>
        <div class="teacher-badges">${pessoaBadgesHtml(p.profiles)}${accessBadge}</div>
      </div>
    </div>`;
}

function selectPessoa(key) {
  if (PessoasState.selectedKey !== key) PessoasState.activeTab = 'identidade';
  PessoasState.selectedKey = key;
  renderPessoasContent();
}

let _pessoasSearchTimer = null;
function setPessoasSearch(value) {
  clearTimeout(_pessoasSearchTimer);
  _pessoasSearchTimer = setTimeout(() => {
    PessoasState.filters.search = value;
    renderPessoasContent();
    const inp = document.querySelector('#page-pessoas .search-input');
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }, 200);
}

function setPessoasProfileFilter(value) {
  PessoasState.filters.profile = value;
  renderPessoasContent();
}

// stubs — substituídos nas Tasks 6 e 7
function renderPessoaFicha() { return ''; }
function afterPessoaFichaRender() {}
function openPessoaWizard() { toast('Wizard em construção.', 'info'); }
