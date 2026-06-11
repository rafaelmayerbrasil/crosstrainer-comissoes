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

// ── Ficha — 4 abas gated (D4/D5): Identidade · Professor · 🔒 Salário · 🔑 Acesso
function pessoaTabsFor(p) {
  const tabs = [{ id: 'identidade', label: 'Identidade' }];
  if (p.teacher) tabs.push({ id: 'professor', label: 'Professor' });
  if (p.teacher && canSeeSalary()) tabs.push({ id: 'salarial', label: '🔒 Salário' });
  if (isStrictAdmin()) tabs.push({ id: 'acesso', label: '🔑 Acesso' });
  return tabs;
}

function renderPessoaFicha(p) {
  const tabs = pessoaTabsFor(p);
  if (!tabs.find(t => t.id === PessoasState.activeTab)) PessoasState.activeTab = 'identidade';
  const avatarType = p.teacher ? p.teacher.type : 'efetivo';

  const noAccessBanner = (isStrictAdmin() && !p.hasAccess) ? `
    <div style="border:1px solid var(--yellow);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:13px;">
      ⚠️ Esta pessoa não tem acesso ao sistema.
      <a href="#" onclick="pessoaCriarAcesso('${p.key}');return false;" style="color:var(--orange);font-weight:600;">Criar acesso</a>
    </div>` : '';

  return `
    <div class="ficha-header">
      ${avatarHtml(p.name, avatarType, 56)}
      <div class="ficha-header-info">
        <div class="ficha-header-title">${escapeHtml(p.name)}</div>
        <div class="ficha-header-sub">${pessoaBadgesHtml(p.profiles)}</div>
      </div>
      ${isStrictAdmin() ? `
        <span class="pill ${p.hasAccess ? 'pill-active' : 'pill-inactive'}">
          ${p.hasAccess ? '● Com acesso' : 'Sem acesso'}
        </span>` : ''}
    </div>
    ${noAccessBanner}
    <div class="ficha-tabs">
      ${tabs.map(tab => `
        <button class="ficha-tab ${PessoasState.activeTab === tab.id ? 'active' : ''}"
                onclick="switchPessoaTab('${tab.id}')">${tab.label}</button>`).join('')}
    </div>
    <div class="ficha-tab-content" id="pessoaTabContent">
      ${renderPessoaTabContent(p)}
    </div>`;
}

function switchPessoaTab(tabId) {
  PessoasState.activeTab = tabId;
  const p = PessoasState.people.find(x => x.key === PessoasState.selectedKey);
  if (!p) return;
  const fichaEl = document.getElementById('pessoaFicha');
  if (fichaEl) fichaEl.innerHTML = renderPessoaFicha(p);
  afterPessoaFichaRender(p);
}

function afterPessoaFichaRender(p) {
  if (PessoasState.activeTab === 'salarial' && p.teacher) loadPessoaSalary(p);
}

function renderPessoaTabContent(p) {
  switch (PessoasState.activeTab) {
    case 'professor':  return renderPessoaTabProfessor(p);
    case 'salarial':
      if (!canSeeSalary()) { PessoasState.activeTab = 'identidade'; return renderPessoaTabIdentidade(p); }
      return '<div class="loading"><div class="spinner"></div> Carregando dados salariais…</div>';
    case 'acesso':
      if (!isStrictAdmin()) { PessoasState.activeTab = 'identidade'; return renderPessoaTabIdentidade(p); }
      return renderPessoaTabAcesso(p);
    default: return renderPessoaTabIdentidade(p);
  }
}

// ── Aba Identidade ──────────────────────────────────────────────────────
// Pessoa com entidade: leitura do teacher doc (fonte da verdade, §3) + Editar via teacherModal.
// Pessoa só de login: form inline (admin) gravando no users doc.
function renderPessoaTabIdentidade(p) {
  if (p.teacher) {
    const t = p.teacher;
    const canEdit = isStrictAdmin() || isSupervisao();
    return `
      <div class="info-grid">
        <div><div class="info-field-label">Nome completo</div><div class="info-field-value">${escapeHtml(t.name)}</div></div>
        <div><div class="info-field-label">CPF</div><div class="info-field-value mono">${escapeHtml(t.cpf || '—')}</div></div>
        <div><div class="info-field-label">E-mail</div><div class="info-field-value">${escapeHtml(t.email || '—')}</div></div>
        <div><div class="info-field-label">Telefone</div><div class="info-field-value">${escapeHtml(t.phone || '—')}</div></div>
      </div>
      ${canEdit ? `<div style="margin-top:12px;"><button class="btn btn-ghost btn-sm" onclick="pessoasEditTeacher('${t.id}')">Editar dados</button></div>` : ''}`;
  }
  const u = p.user || {};
  if (!isStrictAdmin()) {
    return `<div class="info-grid">
      <div><div class="info-field-label">Nome</div><div class="info-field-value">${escapeHtml(u.name || '—')}</div></div>
      <div><div class="info-field-label">E-mail</div><div class="info-field-value">${escapeHtml(u.email || '—')}</div></div>
    </div>`;
  }
  return `
    <div class="form-group"><label>Nome completo</label>
      <input type="text" id="pessoaIdName" value="${escapeHtml(u.name || '')}"></div>
    <div class="form-group"><label>CPF</label>
      <input type="text" id="pessoaIdCpf" value="${escapeHtml(u.cpf || '')}"></div>
    <div class="form-group"><label>Chave PIX</label>
      <input type="text" id="pessoaIdPix" value="${escapeHtml(u.pix || '')}"></div>
    <div class="form-group"><label>E-mail (login — não editável aqui)</label>
      <input type="text" value="${escapeHtml(u.email || '')}" disabled></div>
    <button class="btn" onclick="savePessoaIdentity('${p.key}')">Salvar identidade</button>`;
}

async function savePessoaIdentity(key) {
  const p = PessoasState.people.find(x => x.key === key);
  if (!p || !p.uid) return;
  const name = document.getElementById('pessoaIdName').value.trim();
  const cpf = document.getElementById('pessoaIdCpf').value.trim();
  const pix = document.getElementById('pessoaIdPix').value.trim();
  if (!name) { toast('Nome é obrigatório.', 'error'); return; }
  try {
    await db.collection('users').doc(p.uid).update({
      name, cpf, pix,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast('Identidade atualizada.', 'success');
    await renderPessoasPage();
  } catch (e) { toast('Erro: ' + e.message, 'error'); }
}

// Abre o teacherModal a partir do hub, com refresh de volta pro hub (Task 4)
function pessoasEditTeacher(teacherId) {
  TeacherFormState.onSaved = async () => { await renderPessoasPage(); };
  openTeacherModal(teacherId);
}

// ── Aba Professor ───────────────────────────────────────────────────────
function renderPessoaTabProfessor(p) {
  const t = p.teacher;
  const modNames = (t.modalityIds || [])
    .map(id => ProfessoresState.modalitiesMap.get(id)).filter(Boolean).map(m => m.name);
  const unitNames = (t.unitIds || [])
    .map(id => ProfessoresState.unitsMap.get(id)).filter(Boolean).map(u => u.name || u.id);
  const canEdit = isStrictAdmin() || isSupervisao();
  return `
    <div class="info-grid">
      <div><div class="info-field-label">Tipo</div><div class="info-field-value">${escapeHtml(TYPE_LABEL[t.type] || t.type)}</div></div>
      <div><div class="info-field-label">Status</div><div class="info-field-value">${t.isActive ? '● Ativo' : 'Inativo'}</div></div>
      <div><div class="info-field-label">Modalidades</div><div class="info-field-value">${escapeHtml(modNames.join(', ') || '—')}</div></div>
      <div><div class="info-field-label">Unidades</div><div class="info-field-value">${escapeHtml(unitNames.join(', ') || '—')}</div></div>
    </div>
    ${canEdit ? `<div style="margin-top:12px;"><button class="btn btn-ghost btn-sm" onclick="pessoasEditTeacher('${t.id}')">Editar dados de professor</button></div>` : ''}`;
}

// ── Aba 🔒 Salário (render próprio — evita ficar stale após salvar) ──────
async function loadPessoaSalary(p) {
  const res = await SalaryService.get(p.teacherId);
  const el = document.getElementById('pessoaTabContent');
  if (!el || PessoasState.activeTab !== 'salarial') return;
  if (!res.success) {
    el.innerHTML = `<div class="empty-state-small">⚠️ Erro ao carregar salário: ${escapeHtml(res.error || '')}</div>`;
    return;
  }
  ProfessoresState.salaryCache.set(p.teacherId, { data: res.data });
  el.innerHTML = renderPessoaSalarialInfo(p, res.data);
}

function renderPessoaSalarialInfo(p, s) {
  const fmt = v => (v == null ? '—' : 'R$ ' + Number(v).toFixed(2));
  const editBtn = `<div style="margin-top:12px;"><button class="btn btn-ghost btn-sm" onclick="pessoasEditSalary('${p.teacherId}')">${s ? 'Editar remuneração' : 'Cadastrar remuneração'}</button></div>`;
  if (!s) return `<div class="empty-state-small">Sem cadastro salarial — relatórios mostram "Sem cadastro" até preencher.</div>${editBtn}`;
  const isIntern = p.teacher.type === 'estagiario';
  return `
    <div class="info-grid">
      ${isIntern ? `
        <div><div class="info-field-label">Bolsa mensal</div><div class="info-field-value">${fmt(s.internMonthlyStipend)}</div></div>
        <div><div class="info-field-label">Limite mensal</div><div class="info-field-value">${s.internMonthlyLimitHours != null ? s.internMonthlyLimitHours + 'h' : '—'}</div></div>
      ` : `
        <div><div class="info-field-label">R$/hora</div><div class="info-field-value">${fmt(s.hourlyRate)}</div></div>
      `}
      <div><div class="info-field-label">Vale Refeição</div><div class="info-field-value">${fmt(s.mealAllowance)}</div></div>
      <div><div class="info-field-label">Vale Transporte</div><div class="info-field-value">${fmt(s.transportAllowance)}</div></div>
      <div><div class="info-field-label">Outros benefícios</div><div class="info-field-value">${(s.otherBenefits || []).map(b => escapeHtml(b.nome) + ' ' + fmt(b.valor)).join(' · ') || '—'}</div></div>
    </div>${editBtn}`;
}

function pessoasEditSalary(teacherId) {
  SalaryFormState.onClosed = () => switchPessoaTab('salarial'); // re-render (cache invalidado pelo saveSalary)
  openSalaryModal(teacherId);
}

// ── Aba 🔑 Acesso ───────────────────────────────────────────────────────
function renderPessoaTabAcesso(p) {
  if (!p.hasAccess) {
    return `
      <div class="empty-state-small">
        Esta pessoa não tem login no sistema.
      </div>
      <div style="margin-top:12px;"><button class="btn" onclick="pessoaCriarAcesso('${p.key}')">Criar acesso</button></div>`;
  }
  const u = p.user;
  const isOwnerPerson = (u.email || '').toLowerCase() === PESSOAS_OWNER_EMAIL;
  const profiles = PessoasModel.profilesOf(u);
  const { moduleAccess } = UserModel.deriveUserModel(profiles);
  const ownerNote = isOwnerPerson
    ? '<div class="empty-state-small">🔒 Conta do desenvolvedor (D3) — perfis travados, não editáveis pela UI.</div>' : '';
  const dis = isOwnerPerson ? 'disabled' : '';
  return `
    <div class="info-grid">
      <div><div class="info-field-label">E-mail de login</div><div class="info-field-value">${escapeHtml(u.email || '—')}</div></div>
      <div><div class="info-field-label">Módulos</div><div class="info-field-value">${moduleAccess.comissoes ? 'Comissões ' : ''}${moduleAccess.professores ? 'Professores' : ''}</div></div>
    </div>
    ${ownerNote}
    <div class="form-group" style="margin-top:12px;"><label>Perfis</label>
      <div id="pessoaProfilesChecks">
        ${UserModel.PROFILE_ORDER.map(pr => `
          <label style="display:block;margin:4px 0;">
            <input type="checkbox" value="${pr}" ${profiles.includes(pr) ? 'checked' : ''} ${dis}
                   onchange="pessoaProfileToggle(this)"> ${UserModel.PROFILE_LABELS[pr]}
          </label>`).join('')}
      </div>
    </div>
    <div class="form-group" id="pessoaUnitsWrap" style="display:${moduleAccess.comissoes ? '' : 'none'};">
      <label>Unidades (Comissões)</label>
      <div id="pessoaUnitsChecks">
        ${Array.from(ProfessoresState.unitsMap.values()).map(un => `
          <label style="display:block;margin:4px 0;">
            <input type="checkbox" value="${un.id}" ${((u.allowedUnits || []).includes(un.id)) ? 'checked' : ''} ${dis}> ${escapeHtml(un.name || un.id)}
          </label>`).join('')}
      </div>
    </div>
    <div id="pessoaAcessoError" style="color:var(--red);font-size:12px;min-height:16px;"></div>
    ${isOwnerPerson ? '' : `<button class="btn" onclick="savePessoaAccessProfiles('${p.key}')">Salvar acesso</button>`}`;
}

// XOR professor/estagiário (D2 §3) + mostra/esconde unidades conforme derivação
function pessoaProfileToggle(cb) {
  if (cb.checked) {
    const other = cb.value === 'professor' ? 'professor_estagiario'
                : cb.value === 'professor_estagiario' ? 'professor' : null;
    if (other) {
      const o = document.querySelector(`#pessoaProfilesChecks input[value="${other}"]`);
      if (o) o.checked = false;
    }
  }
  const checked = Array.from(document.querySelectorAll('#pessoaProfilesChecks input:checked')).map(c => c.value);
  const { moduleAccess } = UserModel.deriveUserModel(checked);
  const wrap = document.getElementById('pessoaUnitsWrap');
  if (wrap) wrap.style.display = moduleAccess.comissoes ? '' : 'none';
}

async function savePessoaAccessProfiles(key) {
  const p = PessoasState.people.find(x => x.key === key);
  if (!p || !p.uid) return;
  const errEl = document.getElementById('pessoaAcessoError');
  errEl.textContent = '';
  const checked = Array.from(document.querySelectorAll('#pessoaProfilesChecks input:checked')).map(c => c.value);
  if (checked.length === 0) { errEl.textContent = 'Selecione ao menos um perfil.'; return; }
  const { moduleAccess, role } = UserModel.deriveUserModel(checked);
  let allowedUnits = (p.user && p.user.allowedUnits) || [];
  if (moduleAccess.comissoes) {
    allowedUnits = Array.from(document.querySelectorAll('#pessoaUnitsChecks input:checked')).map(c => c.value);
    if (allowedUnits.length === 0) { errEl.textContent = 'Selecione ao menos uma unidade (acesso ao Comissões).'; return; }
  }
  try {
    await db.collection('users').doc(p.uid).update({
      profiles: checked, role, moduleAccess, allowedUnits,
      unitId: allowedUnits[0] || null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast('Acesso atualizado.', 'success');
    await renderPessoasPage();
  } catch (e) { errEl.textContent = 'Erro: ' + e.message; }
}

// ── Wizard "Nova pessoa" (D7/D9/D13) — admin-only, escritas progressivas ─
function openPessoaWizard() {
  if (!isStrictAdmin()) { toast('Apenas administradores podem criar pessoas.', 'error'); return; }
  const cont = document.getElementById('wizardProfilesChecks');
  cont.innerHTML = UserModel.PROFILE_ORDER.map(pr => `
    <label style="display:block;margin:4px 0;">
      <input type="checkbox" value="${pr}" onchange="wizardProfileToggle(this)"> ${UserModel.PROFILE_LABELS[pr]}
    </label>`).join('');
  document.getElementById('wizardError').textContent = '';
  document.getElementById('pessoaWizardModal').classList.add('open');
}

function closePessoaWizard() {
  document.getElementById('pessoaWizardModal').classList.remove('open');
}

function wizardProfileToggle(cb) {
  if (!cb.checked) return;
  const other = cb.value === 'professor' ? 'professor_estagiario'
              : cb.value === 'professor_estagiario' ? 'professor' : null;
  if (other) {
    const o = document.querySelector(`#wizardProfilesChecks input[value="${other}"]`);
    if (o) o.checked = false;
  }
}

function wizardAdvance() {
  const profiles = Array.from(document.querySelectorAll('#wizardProfilesChecks input:checked')).map(c => c.value);
  const errEl = document.getElementById('wizardError');
  if (profiles.length === 0) { errEl.textContent = 'Selecione ao menos um perfil.'; return; }
  closePessoaWizard();
  if (UserModel.isTeacherProfile(profiles)) startWizardTeacherStep(profiles);
  else openAccessModal({ profiles, teacherId: null }); // caminho curto: Acesso obrigatório (D7)
}

// Caminho professor: teacherModal → salaryModal → Acesso, via hooks da Task 4
function startWizardTeacherStep(profiles) {
  TeacherFormState.onSaved = async (teacher) => {
    const tRes = await TeacherService.list();           // openSalaryModal procura na lista
    if (tRes.success) ProfessoresState.list = tRes.data;
    toast(`Professor "${teacher.name}" criado. Agora o salário (feche o modal pra pular).`, 'info', 5000);
    SalaryFormState.onClosed = () => openAccessModal({ profiles, teacherId: teacher.id });
    openSalaryModal(teacher.id);
  };
  openTeacherModal();
  if (profiles.includes('professor_estagiario')) setTeacherType('estagiario');
}

// ── Passo Acesso ────────────────────────────────────────────────────────
function openAccessModal(opts) {
  PessoasAccessCtx = opts;
  const t = opts.teacherId ? ProfessoresState.list.find(x => x.id === opts.teacherId) : null;
  const { moduleAccess } = UserModel.deriveUserModel(opts.profiles);

  document.getElementById('accessResumo').innerHTML =
    `${t ? `<strong>${escapeHtml(t.name)}</strong> · ` : ''}Perfis: ` +
    opts.profiles.map(pr => UserModel.PROFILE_LABELS[pr] || pr).join(', ');
  document.getElementById('accessNameWrap').style.display = t ? 'none' : '';
  document.getElementById('accessName').value = '';
  document.getElementById('accessEmail').value = t ? (t.email || '') : '';
  document.getElementById('accessPass').value = '';
  document.getElementById('accessError').textContent = '';

  const unitsWrap = document.getElementById('accessUnitsWrap');
  if (moduleAccess.comissoes) {
    unitsWrap.style.display = '';
    document.getElementById('accessUnitsChecks').innerHTML =
      Array.from(ProfessoresState.unitsMap.values()).map(un => `
        <label style="display:block;margin:4px 0;">
          <input type="checkbox" value="${un.id}"> ${escapeHtml(un.name || un.id)}
        </label>`).join('');
  } else {
    unitsWrap.style.display = 'none';
  }

  // "Pular" só existe no caminho professor (D7) — sem entidade, o login É o registro
  document.getElementById('accessSkipBtn').style.display = opts.teacherId ? '' : 'none';
  const btn = document.getElementById('accessSaveBtn');
  btn.disabled = false; btn.textContent = 'Criar pessoa + acesso';
  document.getElementById('pessoaAccessModal').classList.add('open');
}

function closeAccessModal() {
  document.getElementById('pessoaAccessModal').classList.remove('open');
}

function skipAccess() {
  const ctx = PessoasAccessCtx;
  closeAccessModal();
  toast('Pessoa criada sem acesso — o login pode ser criado depois pela ficha.', 'info', 5000);
  PessoasState.selectedKey = ctx && ctx.teacherId ? 'T:' + ctx.teacherId : null;
  renderPessoasPage();
}

// "Criar acesso" a partir da ficha (banner / aba Acesso) — D8: estado recuperável
function pessoaCriarAcesso(key) {
  const p = PessoasState.people.find(x => x.key === key);
  if (!p || !p.teacherId) return;
  openAccessModal({ profiles: p.profiles, teacherId: p.teacherId });
}

function mapAccessAuthError(e) {
  const map = {
    'auth/email-already-in-use': 'E-mail já existe no sistema de autenticação. Se um cadastro anterior falhou no meio, contate o desenvolvedor pra recuperar o login.',
    'auth/invalid-email': 'E-mail inválido.',
    'auth/weak-password': 'Senha muito fraca. Use ao menos 6 caracteres.',
  };
  return map[e.code] || ('Erro: ' + (e.code || e.message));
}

async function savePessoaAccess() {
  const ctx = PessoasAccessCtx;
  const errEl = document.getElementById('accessError');
  errEl.textContent = '';
  const t = ctx.teacherId ? ProfessoresState.list.find(x => x.id === ctx.teacherId) : null;
  const name = t ? t.name : document.getElementById('accessName').value.trim();
  const email = document.getElementById('accessEmail').value.trim();
  const pass = document.getElementById('accessPass').value;

  if (!name) { errEl.textContent = 'Informe o nome.'; return; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errEl.textContent = 'E-mail inválido.'; return; }
  if (!pass || pass.length < 6) { errEl.textContent = 'Senha mín. 6 caracteres.'; return; }

  const { moduleAccess, role } = UserModel.deriveUserModel(ctx.profiles);
  let allowedUnits = [];
  if (moduleAccess.comissoes) {
    allowedUnits = Array.from(document.querySelectorAll('#accessUnitsChecks input:checked')).map(c => c.value);
    if (allowedUnits.length === 0) { errEl.textContent = 'Selecione ao menos uma unidade (acesso ao Comissões).'; return; }
  }

  const btn = document.getElementById('accessSaveBtn');
  btn.disabled = true; btn.textContent = 'Criando…';

  // ③ Auth user via app secondary (não desloga o admin)
  let newUid = null;
  try {
    const secondaryApp = firebase.apps.find(a => a.name === 'secondary')
      || firebase.initializeApp(window.FIREBASE_CONFIG, 'secondary');
    const secondaryAuth = secondaryApp.auth();
    const cred = await secondaryAuth.createUserWithEmailAndPassword(email, pass);
    newUid = cred.user.uid;
    await secondaryAuth.signOut();
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Criar pessoa + acesso';
    errEl.textContent = mapAccessAuthError(e);
    return; // D8: se a entidade existe, segue "sem acesso" — nada a desfazer
  }

  // ④ users doc gravado COMO ADMIN pelo db principal (rules: create só admin — §5 do spec)
  try {
    await db.collection('users').doc(newUid).set({
      name, email, role,
      profiles: ctx.profiles,
      moduleAccess,
      professorId: ctx.teacherId || null,
      allowedUnits,
      unitId: allowedUnits[0] || null,
      status: 'ativo',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Criar pessoa + acesso';
    errEl.textContent = 'Login criado no Auth, mas o perfil falhou: ' + e.message;
    return;
  }

  closeAccessModal();
  toast(`Pessoa "${name}" criada com acesso.`, 'success');
  PessoasState.selectedKey = ctx.teacherId ? 'T:' + ctx.teacherId : 'U:' + newUid;
  PessoasState.activeTab = 'identidade';
  await renderPessoasPage();
}
