// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Módulo Professores · Telas de Cadastro
//
// Etapas implementadas:
//   ✅ Etapa 3 — Tela de Modalidades (CRUD)
//   ✅ Etapa 4 — Tela de Professores: lista lateral + filtros
//   ✅ Etapa 5 — Ficha do professor (tabs)
//   ✅ Etapa 6 — Modal de criação/edição de professor
//   ✅ Etapa 7 — Aba Salarial (RF26 + RN19) — restrita ao Admin, com histórico
//   ✅ Etapa 8 — Smoke test validado em staging (15/05/2026)
//   ✅ Mini-sprint 1.5 — B-01 (effectiveDate no histórico) + B-02 (VR/VT/Outros + sem select para profissional)
// ═══════════════════════════════════════════════════════════════════════

'use strict';

// ────────────────────────────────────────────────────────────────────────
// State local da tela de Modalidades
// ────────────────────────────────────────────────────────────────────────
const ModalitiesState = {
  list: [],
  editingId: null,   // null = criando, string = editando
  loading: false,
};

// ────────────────────────────────────────────────────────────────────────
// MODALIDADES — entry point chamado por professores.js → navigateTo()
// ────────────────────────────────────────────────────────────────────────
async function renderModalidadesPage() {
  const page = document.getElementById('page-modalidades');
  if (!page) return;

  // Loading state
  page.innerHTML = `
    <div class="page-toolbar">
      <div class="lhs">
        <h2>MODALIDADES</h2>
        <div class="count">Carregando…</div>
      </div>
      <div class="rhs">
        <button class="btn btn-ghost" disabled>+ Nova modalidade</button>
      </div>
    </div>
    <div class="loading"><div class="spinner"></div> Carregando modalidades…</div>
  `;

  // Carrega dados
  const res = await ModalityService.list();
  if (!res.success) {
    page.innerHTML = `
      <div class="page-toolbar">
        <div class="lhs"><h2>MODALIDADES</h2></div>
      </div>
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <h3>Erro ao carregar</h3>
        <p>${res.error || 'Erro desconhecido'}</p>
        <button class="btn btn-outline" onclick="renderModalidadesPage()">Tentar novamente</button>
      </div>
    `;
    return;
  }

  ModalitiesState.list = res.data;
  renderModalitiesContent();
}

function renderModalitiesContent() {
  const page = document.getElementById('page-modalidades');
  const list = ModalitiesState.list;
  const ativos = list.filter(m => m.isActive).length;
  const inativos = list.length - ativos;

  // Toolbar
  const toolbar = `
    <div class="page-toolbar">
      <div class="lhs">
        <h2>MODALIDADES</h2>
        <div class="count">${list.length} cadastrada${list.length !== 1 ? 's' : ''} · ${ativos} ativa${ativos !== 1 ? 's' : ''}${inativos ? ` · ${inativos} inativa${inativos !== 1 ? 's' : ''}` : ''}</div>
      </div>
      <div class="rhs">
        <button class="btn" onclick="openModalityModal()">+ Nova modalidade</button>
      </div>
    </div>
  `;

  // Empty state
  if (list.length === 0) {
    page.innerHTML = toolbar + `
      <div class="empty-state">
        <div class="icon">🏷️</div>
        <h3>Nenhuma modalidade cadastrada ainda</h3>
        <p>Comece cadastrando as modalidades oferecidas pela academia.<br>
        Exemplos: CrossFit, Yoga, Pilates, Funcional, Natação.</p>
        <button class="btn btn-outline" onclick="openModalityModal()">+ Cadastrar primeira modalidade</button>
      </div>
    `;
    return;
  }

  // Tabela
  const rows = list.map(m => `
    <tr data-id="${m.id}" style="${m.isActive ? '' : 'opacity:.55;'}">
      <td style="font-weight:600;">${escapeHtml(m.name)}</td>
      <td style="color:var(--text2);">${escapeHtml(m.description || '—')}</td>
      <td>
        <span class="pill ${m.isActive ? 'pill-active' : 'pill-inactive'}">
          ${m.isActive ? 'Ativa' : 'Inativa'}
        </span>
      </td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" title="Editar" onclick="openModalityModal('${m.id}')">✏️</button>
          ${m.isActive
            ? `<button class="icon-btn danger" title="Inativar" onclick="toggleModality('${m.id}', false)">🚫</button>`
            : `<button class="icon-btn success" title="Reativar" onclick="toggleModality('${m.id}', true)">↺</button>`}
        </div>
      </td>
    </tr>
  `).join('');

  page.innerHTML = toolbar + `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:25%;">Nome</th>
            <th>Descrição</th>
            <th style="width:90px;">Status</th>
            <th style="width:100px; text-align:right;">Ações</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ────────────────────────────────────────────────────────────────────────
// MODAL — criar e editar modalidade
// ────────────────────────────────────────────────────────────────────────
function openModalityModal(id = null) {
  if (!isAdminGestao()) {
    toast('Você não tem permissão para gerenciar modalidades.', 'error');
    return;
  }

  ModalitiesState.editingId = id;
  const modal = document.getElementById('modalityModal');
  const titleEl = document.getElementById('modalityModalTitle');
  const nameEl = document.getElementById('modalityName');
  const descEl = document.getElementById('modalityDescription');
  const errEl = document.getElementById('modalityError');
  const saveBtn = document.getElementById('modalitySaveBtn');

  errEl.textContent = '';
  saveBtn.disabled = false;
  saveBtn.textContent = 'Salvar';

  if (id) {
    const m = ModalitiesState.list.find(x => x.id === id);
    if (!m) {
      toast('Modalidade não encontrada.', 'error');
      return;
    }
    titleEl.textContent = 'Editar modalidade';
    nameEl.value = m.name || '';
    descEl.value = m.description || '';
  } else {
    titleEl.textContent = 'Nova modalidade';
    nameEl.value = '';
    descEl.value = '';
  }

  modal.classList.add('open');
  setTimeout(() => nameEl.focus(), 50);
}

function closeModalityModal() {
  document.getElementById('modalityModal').classList.remove('open');
  ModalitiesState.editingId = null;
}

async function saveModality() {
  const nameEl = document.getElementById('modalityName');
  const descEl = document.getElementById('modalityDescription');
  const errEl = document.getElementById('modalityError');
  const saveBtn = document.getElementById('modalitySaveBtn');

  const name = nameEl.value.trim();
  const description = descEl.value.trim();
  errEl.textContent = '';

  if (!name) {
    errEl.textContent = 'Informe o nome da modalidade.';
    nameEl.focus();
    return;
  }
  if (name.length < 2) {
    errEl.textContent = 'Nome muito curto (mínimo 2 caracteres).';
    nameEl.focus();
    return;
  }

  // Checa duplicidade (case-insensitive) — apenas no client (não em validação atômica)
  const duplicate = ModalitiesState.list.find(m =>
    m.name.toLowerCase() === name.toLowerCase() &&
    m.id !== ModalitiesState.editingId
  );
  if (duplicate) {
    errEl.textContent = `Já existe modalidade "${duplicate.name}".`;
    return;
  }

  saveBtn.disabled = true;
  saveBtn.innerHTML = '<div class="spinner"></div> Salvando...';

  const result = ModalitiesState.editingId
    ? await ModalityService.update(ModalitiesState.editingId, { name, description })
    : await ModalityService.create({ name, description });

  if (!result.success) {
    errEl.textContent = result.error || 'Erro ao salvar.';
    saveBtn.disabled = false;
    saveBtn.textContent = 'Salvar';
    return;
  }

  toast(
    ModalitiesState.editingId
      ? `Modalidade "${name}" atualizada.`
      : `Modalidade "${name}" criada.`,
    'success'
  );
  closeModalityModal();
  await renderModalidadesPage();
}

async function toggleModality(id, activate) {
  if (!isAdminGestao()) {
    toast('Você não tem permissão para essa ação.', 'error');
    return;
  }
  const m = ModalitiesState.list.find(x => x.id === id);
  if (!m) return;

  const action = activate ? 'reativar' : 'inativar';
  if (!confirm(`Deseja ${action} a modalidade "${m.name}"?`)) return;

  const result = activate
    ? await ModalityService.activate(id)
    : await ModalityService.deactivate(id);

  if (!result.success) {
    toast('Erro: ' + (result.error || 'desconhecido'), 'error');
    return;
  }

  toast(`Modalidade "${m.name}" ${activate ? 'reativada' : 'inativada'}.`, 'success');
  await renderModalidadesPage();
}

// ═══════════════════════════════════════════════════════════════════════
// ETAPA 4 — Tela de Professores: lista lateral
// ═══════════════════════════════════════════════════════════════════════

const ProfessoresState = {
  list: [],
  modalitiesMap: new Map(),    // id → modality (para mostrar nome em vez de id)
  unitsMap: new Map(),         // id → unit (idem para unidades)
  filters: {
    type: null,        // null | 'efetivo' | 'estagiario' | 'eventual'
    isActive: null,    // null = todos, true = só ativos, false = só inativos
    search: '',
  },
  selectedId: null,
  activeTab: 'dados',          // 'dados' | 'modalidades' | 'unidades' | 'salarial' | 'historico'
  historyCache: new Map(),     // teacherId → array de audit_log entries
  salaryCache: new Map(),      // teacherId → { data | error | notFound } (só Admin)
  loading: false,
};

const TYPE_LABEL = {
  efetivo:    'Efetivo',
  estagiario: 'Estagiário',
  eventual:   'Eventual',
};

const FILTER_PRESETS = {
  all:        { type: null,        isActive: null  },
  efetivo:    { type: 'efetivo',   isActive: null  },
  estagiario: { type: 'estagiario',isActive: null  },
  eventual:   { type: 'eventual',  isActive: null  },
  inactive:   { type: null,        isActive: false },
};

// ────────────────────────────────────────────────────────────────────────
// Entry point — chamado por professores.js → navigateTo('professores')
// ────────────────────────────────────────────────────────────────────────
async function renderProfessoresPage() {
  const page = document.getElementById('page-professores');
  if (!page) return;

  page.innerHTML = `<div class="loading"><div class="spinner"></div> Carregando professores…</div>`;

  // Carrega professores, modalidades e unidades em paralelo
  const [tRes, mRes, uRes] = await Promise.all([
    TeacherService.list(),
    ModalityService.list(),
    UnitService.list(),
  ]);

  if (!tRes.success) {
    page.innerHTML = `
      <div class="page-toolbar"><div class="lhs"><h2>PROFESSORES</h2></div></div>
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <h3>Erro ao carregar</h3>
        <p>${escapeHtml(tRes.error || 'Erro desconhecido')}</p>
        <button class="btn btn-outline" onclick="renderProfessoresPage()">Tentar novamente</button>
      </div>
    `;
    return;
  }

  ProfessoresState.list = tRes.data;
  ProfessoresState.modalitiesMap = mRes.success
    ? new Map(mRes.data.map(m => [m.id, m]))
    : new Map();
  ProfessoresState.unitsMap = uRes.success
    ? new Map(uRes.data.map(u => [u.id, u]))
    : new Map();

  // Se o professor selecionado não existe mais (foi inativado/deletado em outra sessão), limpa
  if (ProfessoresState.selectedId && !ProfessoresState.list.find(t => t.id === ProfessoresState.selectedId)) {
    ProfessoresState.selectedId = null;
  }

  renderProfessoresContent();
}

function renderProfessoresContent() {
  const page = document.getElementById('page-professores');
  if (!page) return;

  const all = ProfessoresState.list;

  // Empty state global — sem professores cadastrados
  if (all.length === 0) {
    page.innerHTML = `
      <div class="page-toolbar">
        <div class="lhs">
          <h2>PROFESSORES</h2>
          <div class="count">Nenhum cadastrado ainda</div>
        </div>
        <div class="rhs">
          <button class="btn" onclick="openTeacherModal()">+ Novo professor</button>
        </div>
      </div>
      <div class="empty-state">
        <div class="icon">👥</div>
        <h3>Nenhum professor cadastrado ainda</h3>
        <p>Comece cadastrando os professores que ministram aulas na academia.<br>
        Dica: certifique-se de ter pelo menos uma modalidade cadastrada antes (aba ao lado).</p>
        <button class="btn btn-outline" onclick="openTeacherModal()">+ Cadastrar primeiro professor</button>
      </div>
    `;
    return;
  }

  // Contadores
  const ativos       = all.filter(t => t.isActive).length;
  const estagiarios  = all.filter(t => t.type === 'estagiario' && t.isActive).length;
  const eventuais    = all.filter(t => t.type === 'eventual' && t.isActive).length;
  const inativos     = all.length - ativos;

  const filtered = applyTeacherFilters(all);

  page.innerHTML = `
    <div class="page-toolbar">
      <div class="lhs">
        <h2>PROFESSORES</h2>
        <div class="count">
          ${ativos} ativo${ativos !== 1 ? 's' : ''}
          ${estagiarios ? ` · ${estagiarios} estagiário${estagiarios !== 1 ? 's' : ''}` : ''}
          ${eventuais ? ` · ${eventuais} eventua${eventuais !== 1 ? 'is' : 'l'}` : ''}
          ${inativos ? ` · ${inativos} inativo${inativos !== 1 ? 's' : ''}` : ''}
        </div>
      </div>
      <div class="rhs">
        <input type="search" class="search-input" placeholder="🔍 Buscar por nome ou email…"
               value="${escapeHtml(ProfessoresState.filters.search)}"
               oninput="setTeacherSearch(this.value)">
        <button class="btn" onclick="openTeacherModal()">+ Novo professor</button>
      </div>
    </div>

    <div class="teachers-grid">
      <!-- ─── LISTA ESQUERDA ─── -->
      <div class="teachers-list-container">
        <div class="chip-filter-row">
          ${renderTypeChips()}
        </div>
        <div class="teachers-list" id="teachersList">
          ${filtered.length === 0
            ? `<div class="empty-state-small">
                 Nenhum professor encontrado com esses filtros.
                 <br><br>
                 <span style="cursor:pointer; color:var(--orange); font-weight:600;" onclick="setTeacherFilter('all')">Limpar filtros</span>
               </div>`
            : filtered.map(t => renderTeacherListItem(t)).join('')}
        </div>
      </div>

      <!-- ─── FICHA À DIREITA ─── -->
      <div class="teachers-ficha" id="teacherFicha">
        ${renderTeacherFicha()}
      </div>
    </div>
  `;
}

// ────────────────────────────────────────────────────────────────────────
// Filtros
// ────────────────────────────────────────────────────────────────────────
function applyTeacherFilters(list) {
  return list.filter(t => {
    const f = ProfessoresState.filters;
    if (f.type && t.type !== f.type) return false;
    if (f.isActive !== null && t.isActive !== f.isActive) return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      const inName = (t.name || '').toLowerCase().includes(q);
      const inEmail = (t.email || '').toLowerCase().includes(q);
      if (!inName && !inEmail) return false;
    }
    return true;
  });
}

function renderTypeChips() {
  const f = ProfessoresState.filters;
  const isActive = (preset) => preset.type === f.type && preset.isActive === f.isActive;
  const chips = [
    { key: 'all',        label: '● Todos' },
    { key: 'efetivo',    label: 'Efetivo' },
    { key: 'estagiario', label: 'Estagiário' },
    { key: 'eventual',   label: 'Eventual' },
    { key: 'inactive',   label: 'Inativos' },
  ];
  return chips.map(c => {
    const active = isActive(FILTER_PRESETS[c.key]) ? 'chip-active' : '';
    return `<span class="chip ${active}" onclick="setTeacherFilter('${c.key}')">${c.label}</span>`;
  }).join('');
}

function setTeacherFilter(key) {
  const preset = FILTER_PRESETS[key];
  if (!preset) return;
  ProfessoresState.filters.type = preset.type;
  ProfessoresState.filters.isActive = preset.isActive;
  renderProfessoresContent();
}

let _searchDebounceTimer = null;
function setTeacherSearch(value) {
  // Debounce leve pra não re-renderizar a cada tecla
  clearTimeout(_searchDebounceTimer);
  _searchDebounceTimer = setTimeout(() => {
    ProfessoresState.filters.search = value;
    renderProfessoresContent();
    // Restaura foco no input após re-render
    const inp = document.querySelector('.search-input');
    if (inp) {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }
  }, 200);
}

// ────────────────────────────────────────────────────────────────────────
// Item da lista
// ────────────────────────────────────────────────────────────────────────
function renderTeacherListItem(t) {
  const isSelected = ProfessoresState.selectedId === t.id;
  const typeLabel = TYPE_LABEL[t.type] || t.type;

  // Nomes das modalidades (limita a 2 visíveis na lista, indica resto)
  const modNames = (t.modalityIds || [])
    .map(id => ProfessoresState.modalitiesMap.get(id))
    .filter(Boolean)
    .map(m => m.name);
  const modPreview = modNames.slice(0, 2).join(', ') +
    (modNames.length > 2 ? ` +${modNames.length - 2}` : '');

  const internBadge = internAlertHtml(t);
  const inactiveBadge = !t.isActive
    ? `<span class="pill pill-inactive" style="font-size:9px; padding:2px 6px;">INATIVO</span>`
    : '';

  return `
    <div class="teacher-list-item ${isSelected ? 'selected' : ''} ${t.isActive ? '' : 'inactive'}"
         onclick="selectTeacher('${t.id}')">
      ${avatarHtml(t.name, t.type, 36)}
      <div class="teacher-info">
        <div class="teacher-name">${escapeHtml(t.name)}</div>
        <div class="teacher-meta">
          ${typeLabel}${modPreview ? ' · ' + escapeHtml(modPreview) : ''}
        </div>
        ${(internBadge || inactiveBadge)
          ? `<div class="teacher-badges">${internBadge}${inactiveBadge}</div>`
          : ''}
      </div>
    </div>
  `;
}

function selectTeacher(id) {
  // Se trocou de professor, volta para a primeira tab
  if (ProfessoresState.selectedId !== id) {
    ProfessoresState.activeTab = 'dados';
  }
  ProfessoresState.selectedId = id;
  // Re-render só a lista (para mostrar o destaque) e a ficha
  const listEl = document.getElementById('teachersList');
  const fichaEl = document.getElementById('teacherFicha');
  if (listEl) {
    const filtered = applyTeacherFilters(ProfessoresState.list);
    listEl.innerHTML = filtered.map(t => renderTeacherListItem(t)).join('');
  }
  if (fichaEl) fichaEl.innerHTML = renderTeacherFicha();
  // Se a tab ativa for Histórico, dispara o fetch async
  if (ProfessoresState.activeTab === 'historico') loadHistoryIfNeeded();
}

// ────────────────────────────────────────────────────────────────────────
// FICHA — header + tabs (Etapa 5)
// Tabs implementadas: Dados gerais · Modalidades · Unidades · Histórico
// Tab pendente:       🔒 Salarial (vem na Etapa 7)
// ────────────────────────────────────────────────────────────────────────

function renderTeacherFicha() {
  if (!ProfessoresState.selectedId) {
    return `
      <div class="teacher-ficha-empty">
        <div class="icon">👈</div>
        <h3>Selecione um professor</h3>
        <p>Escolha um professor na lista à esquerda<br>para ver os detalhes completos.</p>
      </div>
    `;
  }

  const t = ProfessoresState.list.find(x => x.id === ProfessoresState.selectedId);
  if (!t) {
    return `
      <div class="teacher-ficha-empty">
        <div class="icon">❓</div>
        <h3>Professor não encontrado</h3>
        <p>O professor selecionado não está mais disponível.</p>
      </div>
    `;
  }

  return `
    ${renderFichaHeader(t)}
    ${renderFichaTabs()}
    <div class="ficha-tab-content" id="fichaTabContent">
      ${renderFichaTabContent(t)}
    </div>
  `;
}

function renderFichaHeader(t) {
  const typeLabel = TYPE_LABEL[t.type] || t.type;
  const isAdmin = isAdminGestao();

  return `
    <div class="ficha-header">
      ${avatarHtml(t.name, t.type, 56)}
      <div class="ficha-header-info">
        <div class="ficha-header-title">${escapeHtml(t.name)}</div>
        <div class="ficha-header-sub">
          ${typeLabel}${t.hireDate ? ' · ativo desde ' + formatDate(t.hireDate) : ''}
          ${t.isActive ? '' : ' · INATIVO'}
        </div>
      </div>
      <span class="pill ${t.isActive ? 'pill-active' : 'pill-inactive'}">
        ${t.isActive ? '● Ativo' : 'Inativo'}
      </span>
      ${isAdmin ? `
        <div class="ficha-header-actions">
          <button class="btn btn-ghost btn-sm" onclick="openTeacherModal('${t.id}')">Editar</button>
          ${t.isActive
            ? `<button class="btn btn-ghost btn-sm" style="border-color:var(--red);color:var(--red);" onclick="handleTeacherToggle('${t.id}', false)">Inativar</button>`
            : `<button class="btn btn-ghost btn-sm" style="border-color:var(--green);color:var(--green);" onclick="handleTeacherToggle('${t.id}', true)">Reativar</button>`
          }
        </div>
      ` : ''}
    </div>
  `;
}

function renderFichaTabs() {
  // RN19 + RF26 — Aba "🔒 Salarial" só é injetada no DOM se canSeeSalary().
  // Segunda camada (Security Rule) já bloqueia a coleção teacher_salaries no Firestore.
  const tabs = [
    { id: 'dados',       label: 'Dados gerais' },
    { id: 'modalidades', label: 'Modalidades' },
    { id: 'unidades',    label: 'Unidades' },
  ];
  if (canSeeSalary()) {
    tabs.push({ id: 'salarial', label: '🔒 Salarial' });
  }
  tabs.push({ id: 'historico', label: 'Histórico' });
  return `
    <div class="ficha-tabs">
      ${tabs.map(tab => `
        <button class="ficha-tab ${ProfessoresState.activeTab === tab.id ? 'active' : ''}"
                onclick="switchFichaTab('${tab.id}')">${tab.label}</button>
      `).join('')}
    </div>
  `;
}

function renderFichaTabContent(t) {
  switch (ProfessoresState.activeTab) {
    case 'dados':       return renderTabDadosGerais(t);
    case 'modalidades': return renderTabModalidades(t);
    case 'unidades':    return renderTabUnidades(t);
    case 'salarial':
      // Defesa em profundidade — não deveria chegar aqui sem canSeeSalary,
      // já que renderFichaTabs não injeta a tab. Mas se vier, redireciona.
      if (!canSeeSalary()) { ProfessoresState.activeTab = 'dados'; return renderTabDadosGerais(t); }
      return renderTabSalarial(t);
    case 'historico':   return renderTabHistorico(t);
    default:            return renderTabDadosGerais(t);
  }
}

function switchFichaTab(tabId) {
  ProfessoresState.activeTab = tabId;
  const tabsEl = document.querySelector('.ficha-tabs');
  const contentEl = document.getElementById('fichaTabContent');
  if (tabsEl) {
    tabsEl.querySelectorAll('.ficha-tab').forEach(b => b.classList.remove('active'));
    const active = tabsEl.querySelector(`[onclick*="${tabId}"]`);
    if (active) active.classList.add('active');
  }
  if (contentEl) {
    const t = ProfessoresState.list.find(x => x.id === ProfessoresState.selectedId);
    if (t) contentEl.innerHTML = renderFichaTabContent(t);
  }
  if (tabId === 'historico') loadHistoryIfNeeded();
  if (tabId === 'salarial')  loadSalaryIfNeeded();
}

// ────────────────────────────────────────────────────────────────────────
// Conteúdo de cada tab
// ────────────────────────────────────────────────────────────────────────
function renderTabDadosGerais(t) {
  const typeLabel = TYPE_LABEL[t.type] || t.type;

  return `
    <div class="info-grid">
      <div>
        <div class="info-field-label">Nome completo</div>
        <div class="info-field-value">${escapeHtml(t.name)}</div>
      </div>
      <div>
        <div class="info-field-label">CPF</div>
        <div class="info-field-value mono">${escapeHtml(t.cpf || '—')}</div>
        ${t.cpf && t.cpf.includes('*') ? '<div class="info-field-hint">mascarado · LGPD (P05)</div>' : ''}
      </div>
      <div>
        <div class="info-field-label">E-mail</div>
        <div class="info-field-value">${escapeHtml(t.email || '—')}</div>
      </div>
      <div>
        <div class="info-field-label">Telefone</div>
        <div class="info-field-value">${escapeHtml(t.phone || '—')}</div>
      </div>
      <div>
        <div class="info-field-label">Tipo</div>
        <div class="info-field-value">
          <span class="pill" style="background:${typePillBg(t.type)}; color:${typePillColor(t.type)};">
            ${typeLabel}
          </span>
        </div>
      </div>
      <div>
        <div class="info-field-label">Data de admissão</div>
        <div class="info-field-value">${formatDate(t.hireDate)}</div>
      </div>
      ${t.type === 'estagiario' ? `
        <div>
          <div class="info-field-label">Início do estágio</div>
          <div class="info-field-value">${formatDate(t.internshipStartDate)}</div>
        </div>
        <div>
          <div class="info-field-label">Fim do contrato</div>
          <div class="info-field-value">${formatDate(t.contractEndDate)}</div>
          ${internAlertHtml(t) ? '<div style="margin-top:4px;">' + internAlertHtml(t) + '</div>' : ''}
        </div>
      ` : ''}
    </div>

    ${t.notes ? `
      <div class="section-label">Observações</div>
      <div style="background:var(--surface2); padding:12px; border-radius:6px; font-size:13px; color:var(--text2); white-space:pre-wrap;">${escapeHtml(t.notes)}</div>
    ` : ''}
  `;
}

function renderTabModalidades(t) {
  const ids = t.modalityIds || [];
  if (ids.length === 0) {
    return `
      <div class="empty-state-small">
        Este professor não tem modalidades vinculadas.
        <br><br>
        ${isAdminGestao() ? '<span style="color:var(--text3);">Edite o cadastro pra vincular modalidades.</span>' : ''}
      </div>
    `;
  }
  const items = ids.map(id => {
    const m = ProfessoresState.modalitiesMap.get(id);
    return m
      ? { name: m.name, isActive: m.isActive, id }
      : { name: id, isActive: false, id, missing: true };
  });

  return `
    <div class="section-label">Modalidades habilitadas (${items.length})</div>
    <div class="chip-list">
      ${items.map(m => `
        <span class="chip ${m.isActive ? 'chip-primary' : 'chip-secondary'}" title="${m.missing ? 'Modalidade não encontrada no banco' : ''}">
          ${m.missing ? '⚠ ' : ''}${escapeHtml(m.name)}
          ${m.isActive ? '' : (m.missing ? '' : ' (inativa)')}
        </span>
      `).join('')}
    </div>
    ${items.some(m => m.missing) ? '<div class="info-field-hint" style="margin-top:8px;">⚠ Modalidades marcadas não foram encontradas no cadastro — talvez tenham sido excluídas.</div>' : ''}
  `;
}

function renderTabUnidades(t) {
  const ids = t.unitIds || [];
  if (ids.length === 0) {
    return `
      <div class="empty-state-small">
        Este professor não tem unidades vinculadas.
      </div>
    `;
  }
  const primaryId = t.primaryUnitId || ids[0];
  const items = ids.map(id => {
    const u = ProfessoresState.unitsMap.get(id);
    return {
      id,
      name: u && u.name ? u.name : id,
      isPrimary: id === primaryId,
      missing: !u,
    };
  });
  // Ordena: principal primeiro
  items.sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));

  return `
    <div class="section-label">Unidades vinculadas (${items.length})</div>
    <div class="chip-list">
      ${items.map(u => `
        <span class="chip ${u.isPrimary ? 'chip-unit-main' : 'chip-secondary'}" title="${u.missing ? 'Unidade não encontrada no banco' : ''}">
          ${u.missing ? '⚠ ' : ''}${escapeHtml(u.name)}${u.isPrimary ? ' (principal)' : ''}
        </span>
      `).join('')}
    </div>
    ${items.some(u => u.missing) ? '<div class="info-field-hint" style="margin-top:8px;">⚠ Algumas unidades não foram encontradas — IDs aparecem direto.</div>' : ''}
  `;
}

function renderTabHistorico(t) {
  // Não-admin não consegue ler audit_log (Security Rule)
  if (!isAdminGestao()) {
    return `
      <div class="empty-state-small">
        🔒 O histórico de auditoria é visível apenas para Admin/Gestão.
      </div>
    `;
  }

  const cached = ProfessoresState.historyCache.get(t.id);
  if (!cached) {
    return `<div class="loading"><div class="spinner"></div> Carregando histórico…</div>`;
  }
  if (cached.error) {
    return `
      <div class="empty-state-small">
        ⚠ Erro ao carregar histórico: ${escapeHtml(cached.error)}
        <br><br>
        <button class="btn btn-outline btn-sm" onclick="reloadTeacherHistory('${t.id}')">Tentar novamente</button>
      </div>
    `;
  }
  if (!cached.entries.length) {
    return `<div class="empty-state-small">Nenhuma alteração registrada ainda para este professor.</div>`;
  }

  return `
    <div class="section-label">Histórico de alterações (${cached.entries.length})</div>
    <div class="history-list">
      ${cached.entries.map(renderHistoryItem).join('')}
    </div>
  `;
}

function renderHistoryItem(e) {
  const typeLabels = {
    teacher_created:     '✚ Cadastrado',
    teacher_updated:     '✎ Atualizado',
    teacher_activated:   '↺ Reativado',
    teacher_deactivated: '✖ Inativado',
    salary_created:      '$ Dados salariais criados',
    salary_updated:      '$ Dados salariais alterados',
  };
  const label = typeLabels[e.type] || e.type;
  const ts = e.timestamp && e.timestamp.toDate ? e.timestamp.toDate() : null;
  const dateStr = ts
    ? ts.toLocaleDateString('pt-BR') + ' às ' + ts.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '—';
  const isRemoved = e.type === 'teacher_deactivated';
  return `
    <div class="history-item ${isRemoved ? 'removed' : ''}">
      <div class="history-item-header">
        <span class="history-item-type">${label}</span>
        <span class="history-item-date">${dateStr}</span>
      </div>
      <div class="history-item-details">${escapeHtml(e.details || '—')}</div>
      <div class="history-item-user">por ${escapeHtml(e.userName || e.userId || '—')}</div>
    </div>
  `;
}

async function loadHistoryIfNeeded() {
  const teacherId = ProfessoresState.selectedId;
  if (!teacherId) return;
  if (ProfessoresState.historyCache.has(teacherId)) return; // já cacheado
  if (!isAdminGestao()) return;                              // sem permissão

  const res = await AuditService.list({ entityType: 'teacher', entityId: teacherId, limit: 50 });
  if (res.success) {
    ProfessoresState.historyCache.set(teacherId, { entries: res.data });
  } else {
    ProfessoresState.historyCache.set(teacherId, { error: res.error || 'desconhecido', entries: [] });
  }

  // Se a tab Histórico ainda está visível, atualiza
  if (ProfessoresState.activeTab === 'historico' && ProfessoresState.selectedId === teacherId) {
    const contentEl = document.getElementById('fichaTabContent');
    const t = ProfessoresState.list.find(x => x.id === teacherId);
    if (contentEl && t) contentEl.innerHTML = renderTabHistorico(t);
  }
}

async function reloadTeacherHistory(teacherId) {
  ProfessoresState.historyCache.delete(teacherId);
  // Re-render mostra spinner
  const contentEl = document.getElementById('fichaTabContent');
  const t = ProfessoresState.list.find(x => x.id === teacherId);
  if (contentEl && t) contentEl.innerHTML = renderTabHistorico(t);
  await loadHistoryIfNeeded();
}

// ────────────────────────────────────────────────────────────────────────
// Ação: inativar / reativar a partir do header da ficha
// ────────────────────────────────────────────────────────────────────────
async function handleTeacherToggle(teacherId, activate) {
  if (!isAdminGestao()) {
    toast('Você não tem permissão para essa ação.', 'error');
    return;
  }
  const t = ProfessoresState.list.find(x => x.id === teacherId);
  if (!t) return;

  const action = activate ? 'reativar' : 'inativar';
  if (!confirm(`Deseja ${action} o professor "${t.name}"?`)) return;

  const res = activate
    ? await TeacherService.activate(teacherId)
    : await TeacherService.deactivate(teacherId);

  if (!res.success) {
    toast('Erro: ' + (res.error || 'desconhecido'), 'error');
    return;
  }

  toast(`Professor "${t.name}" ${activate ? 'reativado' : 'inativado'}.`, 'success');
  // Invalida cache de histórico desse professor (pra refletir nova entrada)
  ProfessoresState.historyCache.delete(teacherId);
  await renderProfessoresPage();
}

// Helpers de cor por tipo (para a pill da aba Dados Gerais)
function typePillBg(type) {
  return type === 'efetivo'    ? 'var(--orange-glow)'
       : type === 'estagiario' ? 'var(--green-bg)'
       : type === 'eventual'   ? 'var(--yellow-bg)'
       : 'var(--surface3)';
}
function typePillColor(type) {
  return type === 'efetivo'    ? 'var(--orange)'
       : type === 'estagiario' ? 'var(--green)'
       : type === 'eventual'   ? 'var(--yellow)'
       : 'var(--text2)';
}

// ═══════════════════════════════════════════════════════════════════════
// ETAPA 6 — Modal de criação/edição de professor
// ═══════════════════════════════════════════════════════════════════════

const TeacherFormState = {
  editingId: null,
  selectedUnitIds: new Set(),
  selectedModalityIds: new Set(),
  primaryUnitId: null,
  onSaved: null,   // hook do wizard Pessoas (D13): cb(teacherData) no lugar do refresh padrão
};

function $f(id) { return document.getElementById(id); }

function openTeacherModal(id = null) {
  // D5/D9 (hub Pessoas): admin cria e edita; supervisão SÓ edita existente
  const canManage = isAdminGestao() || (id && isSupervisao());
  if (!canManage) {
    toast('Você não tem permissão para gerenciar professores.', 'error');
    return;
  }

  // Pré-condições: precisa ter modalidades ativas e unidades cadastradas
  const hasActiveMods = Array.from(ProfessoresState.modalitiesMap.values()).some(m => m.isActive);
  const hasUnits = ProfessoresState.unitsMap.size > 0;

  if (!hasActiveMods) {
    toast('Cadastre ao menos uma modalidade ativa antes (aba Modalidades).', 'error', 6000);
    return;
  }
  if (!hasUnits) {
    toast(
      'Não há unidades cadastradas. Crie unidades de teste no console: ' +
      'await db.collection("units").doc("unit-cp").set({name:"CrossTainer CP"})',
      'error', 8000
    );
    return;
  }

  // Reset state
  TeacherFormState.editingId = id;
  TeacherFormState.selectedUnitIds = new Set();
  TeacherFormState.selectedModalityIds = new Set();
  TeacherFormState.primaryUnitId = null;

  // Reset form
  $f('teacherName').value = '';
  $f('teacherCpf').value = '';
  $f('teacherEmail').value = '';
  $f('teacherPhone').value = '';
  $f('teacherHireDate').value = '';
  $f('teacherInternshipStart').value = '';
  $f('teacherContractEnd').value = '';
  $f('teacherNotes').value = '';
  $f('teacherError').textContent = '';
  $f('teacherSaveBtn').disabled = false;
  $f('teacherSaveBtn').textContent = 'Salvar';

  // Tipo padrão: efetivo
  setTeacherType('efetivo');

  // Pré-preenche se for edição
  if (id) {
    const t = ProfessoresState.list.find(x => x.id === id);
    if (!t) {
      toast('Professor não encontrado.', 'error');
      return;
    }
    $f('teacherModalTitle').textContent = 'Editar professor';

    $f('teacherName').value = t.name || '';
    $f('teacherCpf').value = t.cpf || '';
    $f('teacherEmail').value = t.email || '';
    $f('teacherPhone').value = t.phone || '';
    setTeacherType(t.type || 'efetivo');
    $f('teacherHireDate').value = dateToInputValue(t.hireDate);
    $f('teacherInternshipStart').value = dateToInputValue(t.internshipStartDate);
    $f('teacherContractEnd').value = dateToInputValue(t.contractEndDate);
    $f('teacherNotes').value = t.notes || '';

    TeacherFormState.selectedUnitIds = new Set(t.unitIds || []);
    TeacherFormState.selectedModalityIds = new Set(t.modalityIds || []);
    TeacherFormState.primaryUnitId = t.primaryUnitId || (t.unitIds && t.unitIds[0]) || null;
  } else {
    $f('teacherModalTitle').textContent = 'Novo professor';
  }

  // Renderiza chips
  renderUnitChipsInForm();
  renderModalityChipsInForm();
  renderPrimaryUnitSelect();

  // Abre modal
  $f('teacherModal').classList.add('open');
  setTimeout(() => $f('teacherName').focus(), 50);
}

function closeTeacherModal() {
  $f('teacherModal').classList.remove('open');
  TeacherFormState.editingId = null;
  TeacherFormState.onSaved = null;  // cancelar = abortar o wizard sem criar nada (D8)
}

function setTeacherType(type) {
  document.querySelectorAll('#teacherTypeChips .chip-toggle').forEach(c => {
    c.classList.toggle('selected', c.dataset.type === type);
  });
  const isIntern = type === 'estagiario';
  $f('internshipStartFieldWrap').style.display = isIntern ? '' : 'none';
  $f('contractEndFieldWrap').style.display = isIntern ? '' : 'none';
}

function getSelectedType() {
  const sel = document.querySelector('#teacherTypeChips .chip-toggle.selected');
  return sel ? sel.dataset.type : 'efetivo';
}

function renderUnitChipsInForm() {
  const container = $f('unitChips');
  const units = Array.from(ProfessoresState.unitsMap.values())
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

  if (units.length === 0) {
    container.innerHTML = '<span style="font-size:12px;color:var(--text3);">Nenhuma unidade cadastrada.</span>';
    return;
  }
  container.innerHTML = units.map(u => {
    const isSelected = TeacherFormState.selectedUnitIds.has(u.id);
    return `<span class="chip-toggle ${isSelected ? 'selected' : ''}" onclick="toggleUnitChipForm('${u.id}')">${escapeHtml(u.name || u.id)}</span>`;
  }).join('');
}

function toggleUnitChipForm(unitId) {
  if (TeacherFormState.selectedUnitIds.has(unitId)) {
    TeacherFormState.selectedUnitIds.delete(unitId);
    if (TeacherFormState.primaryUnitId === unitId) {
      TeacherFormState.primaryUnitId = null;
    }
  } else {
    TeacherFormState.selectedUnitIds.add(unitId);
    if (!TeacherFormState.primaryUnitId) {
      TeacherFormState.primaryUnitId = unitId;
    }
  }
  renderUnitChipsInForm();
  renderPrimaryUnitSelect();
}

function renderPrimaryUnitSelect() {
  const select = $f('teacherPrimaryUnit');
  const selectedIds = Array.from(TeacherFormState.selectedUnitIds);

  if (selectedIds.length === 0) {
    select.innerHTML = '<option value="">— escolha pelo menos uma unidade acima —</option>';
    select.disabled = true;
    TeacherFormState.primaryUnitId = null;
    return;
  }
  select.disabled = false;
  // Se primaryUnitId não está mais nas selecionadas, escolhe a primeira
  if (!TeacherFormState.primaryUnitId || !TeacherFormState.selectedUnitIds.has(TeacherFormState.primaryUnitId)) {
    TeacherFormState.primaryUnitId = selectedIds[0];
  }
  select.innerHTML = selectedIds.map(id => {
    const u = ProfessoresState.unitsMap.get(id);
    const name = u && u.name ? u.name : id;
    const isPrimary = TeacherFormState.primaryUnitId === id;
    return `<option value="${id}" ${isPrimary ? 'selected' : ''}>${escapeHtml(name)}</option>`;
  }).join('');
}

function onPrimaryUnitChange(value) {
  TeacherFormState.primaryUnitId = value || null;
}

function renderModalityChipsInForm() {
  const container = $f('teacherModalityChips');
  const mods = Array.from(ProfessoresState.modalitiesMap.values())
    .filter(m => m.isActive || TeacherFormState.selectedModalityIds.has(m.id))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (mods.length === 0) {
    container.innerHTML = '<span style="font-size:12px;color:var(--text3);">Nenhuma modalidade ativa cadastrada.</span>';
    return;
  }
  container.innerHTML = mods.map(m => {
    const isSelected = TeacherFormState.selectedModalityIds.has(m.id);
    const label = m.name + (m.isActive ? '' : ' (inativa)');
    return `<span class="chip-toggle ${isSelected ? 'selected' : ''}" onclick="toggleModalityChipForm('${m.id}')">${escapeHtml(label)}</span>`;
  }).join('');
}

function toggleModalityChipForm(modId) {
  if (TeacherFormState.selectedModalityIds.has(modId)) {
    TeacherFormState.selectedModalityIds.delete(modId);
  } else {
    TeacherFormState.selectedModalityIds.add(modId);
  }
  renderModalityChipsInForm();
}

// ────────────────────────────────────────────────────────────────────────
// Máscaras de input (CPF / Telefone)
// ────────────────────────────────────────────────────────────────────────
function maskCpfInput(input) {
  // Se o valor atual contém asterisco (CPF mascarado vindo do banco),
  // só aplica máscara se o usuário começou a apagar/substituir
  if (input.value.includes('*')) {
    // Permite limpar — se o usuário apagou tudo, libera novo CPF
    if (!/[*]/.test(input.value.replace(/\*/g, '').trim()) && input.value.length < 14) {
      // ainda contém asteriscos, deixa quieto
      return;
    }
  }
  let v = input.value.replace(/\D/g, '').slice(0, 11);
  let formatted = v;
  if (v.length > 9)      formatted = v.replace(/^(\d{3})(\d{3})(\d{3})(\d{1,2})$/, '$1.$2.$3-$4');
  else if (v.length > 6) formatted = v.replace(/^(\d{3})(\d{3})(\d{1,3})$/, '$1.$2.$3');
  else if (v.length > 3) formatted = v.replace(/^(\d{3})(\d{1,3})$/, '$1.$2');
  input.value = formatted;
}

function maskPhoneInput(input) {
  let v = input.value.replace(/\D/g, '').slice(0, 11);
  let formatted = v;
  if (v.length > 10)     formatted = v.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  else if (v.length > 6) formatted = v.replace(/^(\d{2})(\d{4})(\d{0,4})$/, '($1) $2-$3');
  else if (v.length > 2) formatted = v.replace(/^(\d{2})(\d{0,5})$/, '($1) $2');
  input.value = formatted;
}

// ────────────────────────────────────────────────────────────────────────
// Helpers de data
// ────────────────────────────────────────────────────────────────────────
function dateToInputValue(ts) {
  if (!ts) return '';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  } catch { return ''; }
}

// ────────────────────────────────────────────────────────────────────────
// SAVE
// ────────────────────────────────────────────────────────────────────────
async function saveTeacher() {
  const errEl = $f('teacherError');
  const btn   = $f('teacherSaveBtn');
  errEl.textContent = '';

  const data = {
    name:  $f('teacherName').value.trim(),
    cpf:   $f('teacherCpf').value.trim(),
    email: $f('teacherEmail').value.trim(),
    phone: $f('teacherPhone').value.trim(),
    type:  getSelectedType(),
    unitIds: Array.from(TeacherFormState.selectedUnitIds),
    primaryUnitId: TeacherFormState.primaryUnitId,
    modalityIds: Array.from(TeacherFormState.selectedModalityIds),
    hireDate: $f('teacherHireDate').value || null,
    notes: $f('teacherNotes').value.trim(),
  };

  if (data.type === 'estagiario') {
    data.internshipStartDate = $f('teacherInternshipStart').value || null;
    data.contractEndDate     = $f('teacherContractEnd').value || null;
  }

  const err = validateTeacherForm(data);
  if (err) {
    errEl.textContent = err;
    return;
  }

  // Duplicidade de email (client-side)
  const dupe = ProfessoresState.list.find(t =>
    (t.email || '').toLowerCase() === data.email.toLowerCase() &&
    t.id !== TeacherFormState.editingId
  );
  if (dupe) {
    errEl.textContent = `Já existe professor com este email: "${dupe.name}".`;
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Salvando…';

  const result = TeacherFormState.editingId
    ? await TeacherService.update(TeacherFormState.editingId, data)
    : await TeacherService.create(data);

  if (!result.success) {
    errEl.textContent = result.error || 'Erro ao salvar.';
    btn.disabled = false;
    btn.textContent = 'Salvar';
    return;
  }

  toast(
    TeacherFormState.editingId
      ? `Professor "${data.name}" atualizado.`
      : `Professor "${data.name}" criado.`,
    'success'
  );

  // Invalida cache de histórico do professor editado
  if (TeacherFormState.editingId) {
    ProfessoresState.historyCache.delete(TeacherFormState.editingId);
  }

  const onSaved = TeacherFormState.onSaved;   // ler ANTES do close (que zera o hook)
  TeacherFormState.onSaved = null;
  closeTeacherModal();
  if (onSaved) await onSaved(result.data);    // wizard Pessoas segue o fluxo (D13)
  else await renderProfessoresPage();
}

function validateTeacherForm(d) {
  if (!d.name || d.name.length < 3) return 'Nome inválido (mínimo 3 caracteres)';
  if (!d.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return 'Email inválido';
  if (!d.cpf) return 'CPF obrigatório';
  // Aceita CPF mascarado em edição (preservação)
  if (!d.cpf.includes('*')) {
    const digits = d.cpf.replace(/\D/g, '');
    if (digits.length !== 11) return 'CPF deve ter 11 dígitos';
  }
  if (!['efetivo','estagiario','eventual'].includes(d.type)) return 'Tipo inválido';
  if (!d.unitIds || !d.unitIds.length) return 'Selecione ao menos uma unidade';
  if (!d.primaryUnitId || !d.unitIds.includes(d.primaryUnitId)) return 'Selecione a unidade principal';
  if (!d.modalityIds || !d.modalityIds.length) return 'Selecione ao menos uma modalidade';
  if (d.type === 'estagiario') {
    if (!d.internshipStartDate) return 'Data de início do estágio é obrigatória';
    if (!d.contractEndDate)     return 'Data de fim do contrato é obrigatória';
    // Coerência básica: fim deve ser depois do início
    if (new Date(d.contractEndDate) <= new Date(d.internshipStartDate)) {
      return 'Fim do contrato deve ser posterior ao início do estágio';
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// ETAPA 7 — Aba Salarial (RF26 + RN19) — RESTRITA AO ADMIN
// ═══════════════════════════════════════════════════════════════════════
// Dupla camada de segurança:
//   1) DOM — tab "🔒 Salarial" só renderiza se canSeeSalary()
//   2) Firestore — coleção `teacher_salaries` bloqueada por Security Rule
//      (validado no Sprint 0-B via test-auth.html)
// O modal de edição também é separado do modal de cadastro de professor.

const SalaryFormState = {
  teacherId: null,
  teacherType: null,
  isNew: false,
  otherBenefits: [],   // 🆕 B-02 — array de {nome, valor} editável no modal
  onClosed: null,      // hook do wizard Pessoas (D13): dispara ao fechar (salvo OU pulado), 1x
};

const REMUN_TYPE_LABEL = {
  hora_aula: 'Hora-aula',
  bolsa:     'Bolsa fixa',
  misto:     'Misto (bolsa + extras)',
};

const SALARY_FIELD_LABEL = {
  hourlyRate:                   'R$/hora-aula',
  internMonthlyStipend:         'Bolsa mensal',
  internMonthlyLimitHours:      'Limite mensal (horas)',
  internProportionalHourlyRate: 'R$/hora proporcional',
  mealAllowance:                'Vale Refeição',          // 🆕 B-02
  transportAllowance:           'Vale Transporte',        // 🆕 B-02
  otherBenefits:                'Outros benefícios',      // 🆕 B-02
};

function formatBRL(v) {
  if (v === null || v === undefined || isNaN(Number(v))) return '—';
  return 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// ────────────────────────────────────────────────────────────────────────
// Render da aba Salarial
// ────────────────────────────────────────────────────────────────────────
function renderTabSalarial(t) {
  // Guard defensivo redundante
  if (!canSeeSalary()) {
    return `<div class="empty-state-small">🔒 Acesso restrito.</div>`;
  }

  const cached = ProfessoresState.salaryCache.get(t.id);
  if (!cached) {
    return `<div class="loading"><div class="spinner"></div> Carregando dados salariais…</div>`;
  }
  if (cached.error) {
    return `
      <div class="empty-state-small">
        ⚠ Não foi possível carregar os dados salariais: ${escapeHtml(cached.error)}
        <br><br>
        <button class="btn btn-outline btn-sm" onclick="reloadSalary('${t.id}')">Tentar novamente</button>
      </div>
    `;
  }

  const s = cached.data;
  if (!s) {
    // Empty state: ainda não cadastrado
    return `
      <div class="empty-state-small">
        💰 Dados salariais ainda não cadastrados para este professor.
        <br><br>
        <button class="btn btn-primary btn-sm" onclick="openSalaryModal('${t.id}')">
          Cadastrar dados salariais
        </button>
      </div>
    `;
  }

  return `
    <div class="section-toolbar">
      <div class="section-label" style="margin:0;">💰 Remuneração</div>
      <button class="btn btn-ghost btn-sm" onclick="openSalaryModal('${t.id}')">Editar</button>
    </div>
    ${renderSalaryFields(t, s)}
    ${renderSalaryBenefits(s)}
    <div class="info-callout" style="margin-top:16px;">
      ℹ️ <strong>Feriados:</strong> aulas em feriado são pagas em <strong>dobro</strong>
      (regra contratual fixa — confirmação P02).
    </div>
    ${renderSalaryHistory(s)}
  `;
}

function renderSalaryFields(t, s) {
  if (t.type === 'estagiario') {
    const typeLabel = REMUN_TYPE_LABEL[s.remunerationType] || s.remunerationType;
    const limitH = s.internMonthlyLimitHours || 0;
    const totalMin = s.internMonthlyLimitMinutes || 0;
    const remMin = totalMin - limitH * 60;
    const limitFmt = remMin > 0 ? `${limitH}h${String(remMin).padStart(2,'0')}min` : `${limitH}h`;
    return `
      <div class="info-grid">
        <div>
          <div class="info-field-label">Tipo de remuneração</div>
          <div class="info-field-value">${typeLabel}</div>
        </div>
        <div>
          <div class="info-field-label">Bolsa mensal</div>
          <div class="info-field-value mono">${formatBRL(s.internMonthlyStipend)}</div>
        </div>
        <div>
          <div class="info-field-label">Limite mensal de horas</div>
          <div class="info-field-value mono">${limitFmt}</div>
        </div>
        <div>
          <div class="info-field-label">R$/hora proporcional</div>
          <div class="info-field-value mono">${formatBRL(s.internProportionalHourlyRate)}</div>
          <div class="info-field-hint">calculado: bolsa ÷ horas-equivalentes</div>
        </div>
      </div>
    `;
  }
  // B-02 — para profissional (efetivo/eventual): só mostra R$/hora. Tipo é sempre hora-aula.
  return `
    <div class="info-grid">
      <div>
        <div class="info-field-label">R$ / hora-aula</div>
        <div class="info-field-value mono">${formatBRL(s.hourlyRate)}</div>
      </div>
    </div>
  `;
}

// B-02 — Card de benefícios (universal: todos os tipos de professor)
function renderSalaryBenefits(s) {
  const hasMeal = s.mealAllowance != null;
  const hasTransport = s.transportAllowance != null;
  const others = Array.isArray(s.otherBenefits) ? s.otherBenefits : [];
  const hasAny = hasMeal || hasTransport || others.length > 0;

  if (!hasAny) {
    return `
      <div class="section-label" style="margin-top:20px;">Benefícios mensais</div>
      <div class="empty-state-small">Nenhum benefício cadastrado.</div>
    `;
  }

  return `
    <div class="section-label" style="margin-top:20px;">Benefícios mensais (defaults)</div>
    <div class="hint" style="margin-bottom:10px;">
      Valores padrão. Podem ser sobrescritos pelo admin no fechamento mensal.
    </div>
    <div class="info-grid">
      <div>
        <div class="info-field-label">Vale Refeição (VR)</div>
        <div class="info-field-value mono">${formatBRL(s.mealAllowance)}</div>
      </div>
      <div>
        <div class="info-field-label">Vale Transporte (VT)</div>
        <div class="info-field-value mono">${formatBRL(s.transportAllowance)}</div>
      </div>
    </div>
    ${others.length > 0 ? `
      <div class="info-field-label" style="margin-top:14px;margin-bottom:4px;">Outros benefícios (${others.length})</div>
      <div class="other-benefits-readonly">
        ${others.map(b => `
          <div class="other-benefit-readonly-row">
            <span>${escapeHtml(b.nome)}</span>
            <span class="mono">${formatBRL(b.valor)}</span>
          </div>
        `).join('')}
        <div class="other-benefit-readonly-total">
          <span><strong>Total Outros</strong></span>
          <span class="mono"><strong>${formatBRL(others.reduce((s, b) => s + (Number(b.valor) || 0), 0))}</strong></span>
        </div>
      </div>
    ` : ''}
  `;
}

function renderSalaryHistory(s) {
  const h = Array.isArray(s.salaryHistory) ? [...s.salaryHistory] : [];
  if (h.length === 0) {
    return `
      <div class="section-label" style="margin-top:20px;">Histórico de alterações</div>
      <div class="empty-state-small">Nenhuma alteração de valor registrada ainda.</div>
    `;
  }
  h.sort((a, b) => {
    const ta = a.changedAt && a.changedAt.toDate ? a.changedAt.toDate().getTime() : 0;
    const tb = b.changedAt && b.changedAt.toDate ? b.changedAt.toDate().getTime() : 0;
    return tb - ta;
  });
  return `
    <div class="section-label" style="margin-top:20px;">Histórico de alterações (${h.length})</div>
    <div class="history-list">
      ${h.map(renderSalaryHistoryItem).join('')}
    </div>
  `;
}

function renderSalaryHistoryItem(e) {
  const label = SALARY_FIELD_LABEL[e.field] || e.field;
  const ts = e.changedAt && e.changedAt.toDate ? e.changedAt.toDate() : null;
  const dateStr = ts
    ? ts.toLocaleDateString('pt-BR') + ' às ' + ts.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '—';

  // B-01 — effectiveDate (quando o novo valor passa a valer) + nota opcional
  const effTs = e.effectiveDate && e.effectiveDate.toDate ? e.effectiveDate.toDate() : null;
  const effStr = effTs ? effTs.toLocaleDateString('pt-BR') : null;
  const effHtml = effStr ? `<span class="history-item-effective">vale a partir de <strong>${effStr}</strong></span>` : '';
  const noteHtml = e.effectiveNote ? `<div class="history-item-note">"${escapeHtml(e.effectiveNote)}"</div>` : '';

  // B-02 — otherBenefits é array, formatação especial
  if (e.field === 'otherBenefits') {
    const prevArr = Array.isArray(e.previousValue) ? e.previousValue : [];
    const nextArr = Array.isArray(e.newValue) ? e.newValue : [];
    const fmtArr = arr => arr.length
      ? arr.map(x => `${escapeHtml(x.nome)}: ${formatBRL(x.valor)}`).join(' · ')
      : '(vazio)';
    return `
      <div class="history-item">
        <div class="history-item-header">
          <span class="history-item-type">$ ${label}</span>
          <span class="history-item-date">${dateStr}</span>
        </div>
        <div class="history-item-details">
          <div style="font-size:11px;color:var(--text3);">antes:</div>
          <div>${fmtArr(prevArr)}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px;">depois:</div>
          <div><strong>${fmtArr(nextArr)}</strong></div>
        </div>
        ${effHtml ? `<div class="history-item-meta">${effHtml}</div>` : ''}
        ${noteHtml}
        <div class="history-item-user">por ${escapeHtml(e.changedByName || e.changedBy || '—')}</div>
      </div>
    `;
  }

  const isMoney = ['hourlyRate', 'internMonthlyStipend', 'internProportionalHourlyRate', 'mealAllowance', 'transportAllowance'].includes(e.field);
  const fmt = v => (v === null || v === undefined) ? '—' : (isMoney ? formatBRL(v) : String(v));
  return `
    <div class="history-item">
      <div class="history-item-header">
        <span class="history-item-type">$ ${label}</span>
        <span class="history-item-date">${dateStr}</span>
      </div>
      <div class="history-item-details">${fmt(e.previousValue)} → <strong>${fmt(e.newValue)}</strong></div>
      ${effHtml ? `<div class="history-item-meta">${effHtml}</div>` : ''}
      ${noteHtml}
      <div class="history-item-user">por ${escapeHtml(e.changedByName || e.changedBy || '—')}</div>
    </div>
  `;
}

// ────────────────────────────────────────────────────────────────────────
// Loader assíncrono
// ────────────────────────────────────────────────────────────────────────
async function loadSalaryIfNeeded() {
  const teacherId = ProfessoresState.selectedId;
  if (!teacherId) return;
  if (!canSeeSalary()) return;
  if (ProfessoresState.salaryCache.has(teacherId)) return;

  const res = await SalaryService.get(teacherId);
  if (res.success) {
    ProfessoresState.salaryCache.set(teacherId, { data: res.data });
  } else {
    ProfessoresState.salaryCache.set(teacherId, { error: res.error || 'desconhecido', data: null });
  }

  if (ProfessoresState.activeTab === 'salarial' && ProfessoresState.selectedId === teacherId) {
    const contentEl = document.getElementById('fichaTabContent');
    const t = ProfessoresState.list.find(x => x.id === teacherId);
    if (contentEl && t) contentEl.innerHTML = renderTabSalarial(t);
  }
}

async function reloadSalary(teacherId) {
  ProfessoresState.salaryCache.delete(teacherId);
  const contentEl = document.getElementById('fichaTabContent');
  const t = ProfessoresState.list.find(x => x.id === teacherId);
  if (contentEl && t) contentEl.innerHTML = renderTabSalarial(t);
  await loadSalaryIfNeeded();
}

// ────────────────────────────────────────────────────────────────────────
// Modal de edição salarial — separado do modal de cadastro de professor
// ────────────────────────────────────────────────────────────────────────
function openSalaryModal(teacherId) {
  if (!canSeeSalary()) {
    toast('Você não tem permissão para gerenciar dados salariais.', 'error');
    return;
  }
  const t = ProfessoresState.list.find(x => x.id === teacherId);
  if (!t) return;

  const cached = ProfessoresState.salaryCache.get(teacherId) || { data: null };
  const s = cached.data;

  SalaryFormState.teacherId = teacherId;
  SalaryFormState.teacherType = t.type;
  SalaryFormState.isNew = !s;

  const modal = document.getElementById('salaryModal');
  if (!modal) return;
  document.getElementById('salaryModalTitle').textContent =
    s ? `Editar remuneração — ${t.name}` : `Cadastrar remuneração — ${t.name}`;
  document.getElementById('salaryModalError').textContent = '';

  // Default do tipo de remuneração conforme tipo do professor
  const defaultRemunType = s && s.remunerationType
    ? s.remunerationType
    : (t.type === 'estagiario' ? 'bolsa' : 'hora_aula');

  document.getElementById('salaryRemunType').value = defaultRemunType;
  document.getElementById('salaryHourlyRate').value = (s && s.hourlyRate != null) ? s.hourlyRate : '';
  document.getElementById('salaryStipend').value = (s && s.internMonthlyStipend != null) ? s.internMonthlyStipend : '';
  document.getElementById('salaryLimitHours').value = (s && s.internMonthlyLimitHours != null) ? s.internMonthlyLimitHours : '';
  const remMin = s && s.internMonthlyLimitMinutes != null
    ? (s.internMonthlyLimitMinutes - (s.internMonthlyLimitHours || 0) * 60)
    : 0;
  document.getElementById('salaryLimitMinutes').value = remMin > 0 ? remMin : '';

  // B-01 — effectiveDate:
  //   - Se editando: default = hoje (admin tipicamente confirma)
  //   - Se criando pela 1a vez: default = data de admissão do professor (fallback hoje)
  const defaultEffective = (!s && t.hireDate) ? t.hireDate : new Date();
  document.getElementById('salaryEffectiveDate').value = dateToInputValue(defaultEffective);
  document.getElementById('salaryEffectiveNote').value = '';

  // B-02 — benefícios
  document.getElementById('salaryMealAllowance').value = (s && s.mealAllowance != null) ? s.mealAllowance : '';
  document.getElementById('salaryTransportAllowance').value = (s && s.transportAllowance != null) ? s.transportAllowance : '';
  // otherBenefits: copia pra state local (pra evitar mutação do cache)
  SalaryFormState.otherBenefits = Array.isArray(s && s.otherBenefits)
    ? s.otherBenefits.map(b => ({ nome: b.nome || '', valor: Number(b.valor) || 0 }))
    : [];
  renderOtherBenefitsList();

  applySalaryFieldsByType(t.type);
  updateProportionalRate();

  modal.classList.add('open');
  setTimeout(() => {
    const focusEl = t.type === 'estagiario' ? 'salaryStipend' : 'salaryHourlyRate';
    document.getElementById(focusEl)?.focus();
  }, 50);
}

function closeSalaryModal() {
  const modal = document.getElementById('salaryModal');
  if (modal) modal.classList.remove('open');
  SalaryFormState.teacherId = null;
  const onClosed = SalaryFormState.onClosed;
  SalaryFormState.onClosed = null;
  if (onClosed) onClosed();   // wizard Pessoas: salvar OU fechar sem salvar = avança pro Acesso (D8/D13)
}

function applySalaryFieldsByType(type) {
  const isIntern = type === 'estagiario';
  const hourBlock = document.getElementById('salaryHourlyBlock');
  const internBlock = document.getElementById('salaryInternBlock');
  if (hourBlock) hourBlock.style.display = isIntern ? 'none' : '';
  if (internBlock) internBlock.style.display = isIntern ? '' : 'none';

  // B-02 — profissional (efetivo/eventual) é SEMPRE hora-aula. Esconder select de tipo.
  const typeWrap = document.getElementById('salaryRemunTypeWrap');
  const typeDivider = document.getElementById('salaryRemunTypeDivider');
  if (typeWrap) typeWrap.style.display = isIntern ? '' : 'none';
  if (typeDivider) typeDivider.style.display = isIntern ? '' : 'none';
  // Força valor correto mesmo se select escondido
  const typeSel = document.getElementById('salaryRemunType');
  if (typeSel && !isIntern) typeSel.value = 'hora_aula';
}

function updateProportionalRate() {
  const stipend = parseFloat(document.getElementById('salaryStipend').value) || 0;
  const h = parseInt(document.getElementById('salaryLimitHours').value, 10) || 0;
  const m = parseInt(document.getElementById('salaryLimitMinutes').value, 10) || 0;
  const totalHours = h + m / 60;
  const out = document.getElementById('salaryProportionalRate');
  if (!out) return;
  out.value = (stipend > 0 && totalHours > 0) ? (stipend / totalHours).toFixed(2) : '';
}

// ────────────────────────────────────────────────────────────────────────
// B-02 — Gestão do array Outros Benefícios (UI dinâmica de linhas)
// ────────────────────────────────────────────────────────────────────────
function renderOtherBenefitsList() {
  const wrap = document.getElementById('salaryOtherBenefitsList');
  if (!wrap) return;
  const items = SalaryFormState.otherBenefits;

  if (items.length === 0) {
    wrap.innerHTML = '<div class="other-benefits-empty">Nenhum benefício adicional. Clique abaixo pra adicionar.</div>';
    return;
  }

  wrap.innerHTML = items.map((b, i) => `
    <div class="other-benefit-row">
      <input type="text" class="ob-nome" placeholder="Nome (ex: Plano de Saúde)"
             value="${escapeHtml(b.nome)}" maxlength="60"
             oninput="updateOtherBenefit(${i}, 'nome', this.value)">
      <input type="number" class="ob-valor" placeholder="R$ 0,00" step="0.01" min="0"
             value="${b.valor || ''}"
             oninput="updateOtherBenefit(${i}, 'valor', this.value)">
      <button type="button" class="ob-remove" title="Remover" onclick="removeOtherBenefit(${i})">✕</button>
    </div>
  `).join('');
}

function addOtherBenefitRow() {
  SalaryFormState.otherBenefits.push({ nome: '', valor: 0 });
  renderOtherBenefitsList();
  // Foca no campo nome da nova linha
  setTimeout(() => {
    const rows = document.querySelectorAll('#salaryOtherBenefitsList .ob-nome');
    const last = rows[rows.length - 1];
    if (last) last.focus();
  }, 30);
}

function removeOtherBenefit(idx) {
  SalaryFormState.otherBenefits.splice(idx, 1);
  renderOtherBenefitsList();
}

function updateOtherBenefit(idx, field, value) {
  const item = SalaryFormState.otherBenefits[idx];
  if (!item) return;
  if (field === 'valor') {
    item.valor = parseFloat(value) || 0;
  } else {
    item[field] = value;
  }
  // NÃO re-renderiza (perderia foco) — só atualiza o state
}

async function saveSalary() {
  const errEl = document.getElementById('salaryModalError');
  errEl.textContent = '';

  const teacherId = SalaryFormState.teacherId;
  if (!teacherId) { errEl.textContent = 'Estado inválido — feche e reabra o modal.'; return; }

  const type = SalaryFormState.teacherType;
  const remunerationType = document.getElementById('salaryRemunType').value;

  // B-01 — data de início de validade da alteração (obrigatório)
  const effectiveDateStr = document.getElementById('salaryEffectiveDate').value;
  if (!effectiveDateStr) {
    errEl.textContent = 'Defina a data de início de validade.'; return;
  }
  const effectiveNote = document.getElementById('salaryEffectiveNote').value.trim();

  const data = { remunerationType, effectiveDate: effectiveDateStr, effectiveNote };

  if (type === 'estagiario') {
    const stipend = parseFloat(document.getElementById('salaryStipend').value);
    const hours = parseInt(document.getElementById('salaryLimitHours').value, 10);
    const minutes = parseInt(document.getElementById('salaryLimitMinutes').value, 10) || 0;
    if (!Number.isFinite(stipend) || stipend <= 0) {
      errEl.textContent = 'Bolsa mensal precisa ser maior que zero.'; return;
    }
    if ((!Number.isFinite(hours) || hours <= 0) && minutes <= 0) {
      errEl.textContent = 'Defina o limite mensal de horas (horas ou minutos > 0).'; return;
    }
    if (minutes < 0 || minutes >= 60) {
      errEl.textContent = 'Minutos devem estar entre 0 e 59.'; return;
    }
    const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 0;
    const totalMinutes = safeHours * 60 + minutes;
    const totalHours = totalMinutes / 60;
    data.internMonthlyStipend = stipend;
    data.internMonthlyLimitHours = safeHours;
    data.internMonthlyLimitMinutes = totalMinutes;
    data.internProportionalHourlyRate = Number((stipend / totalHours).toFixed(2));
    data.hourlyRate = null;
  } else {
    const rate = parseFloat(document.getElementById('salaryHourlyRate').value);
    if (!Number.isFinite(rate) || rate <= 0) {
      errEl.textContent = 'R$/hora precisa ser maior que zero.'; return;
    }
    data.hourlyRate = rate;
    data.internMonthlyStipend = null;
    data.internMonthlyLimitHours = null;
    data.internProportionalHourlyRate = null;
  }

  // B-02 — Benefícios mensais (todos os tipos)
  const mealRaw = document.getElementById('salaryMealAllowance').value;
  const transportRaw = document.getElementById('salaryTransportAllowance').value;
  const meal = mealRaw === '' ? null : parseFloat(mealRaw);
  const transport = transportRaw === '' ? null : parseFloat(transportRaw);
  if (meal !== null && (!Number.isFinite(meal) || meal < 0)) {
    errEl.textContent = 'Vale Refeição deve ser número ≥ 0.'; return;
  }
  if (transport !== null && (!Number.isFinite(transport) || transport < 0)) {
    errEl.textContent = 'Vale Transporte deve ser número ≥ 0.'; return;
  }
  data.mealAllowance = meal;
  data.transportAllowance = transport;

  // Outros benefícios — validar que cada item tem nome (se valor > 0) ou pular itens em branco
  const cleanOthers = [];
  for (const ob of SalaryFormState.otherBenefits) {
    const nome = (ob.nome || '').trim();
    const valor = Number(ob.valor) || 0;
    if (!nome && valor === 0) continue; // linha em branco — ignora silenciosamente
    if (!nome) {
      errEl.textContent = 'Há benefício com valor mas sem nome. Preencha ou remova.'; return;
    }
    if (valor < 0) {
      errEl.textContent = `Benefício "${nome}" tem valor negativo.`; return;
    }
    cleanOthers.push({ nome, valor });
  }
  data.otherBenefits = cleanOthers.length > 0 ? cleanOthers : null;

  const btn = document.getElementById('salarySaveBtn');
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  const res = await SalaryService.upsert(teacherId, data);

  btn.disabled = false;
  btn.textContent = 'Salvar';

  if (!res.success) {
    errEl.textContent = res.error || 'Erro ao salvar.';
    return;
  }

  toast('Dados salariais salvos com sucesso.', 'success');
  // Invalida caches (salary + history porque audit_log entry nova)
  ProfessoresState.salaryCache.delete(teacherId);
  ProfessoresState.historyCache.delete(teacherId);
  closeSalaryModal();
  await loadSalaryIfNeeded();
}

// ────────────────────────────────────────────────────────────────────────
// Helpers locais
// ────────────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Fechar modais com ESC (ordem de prioridade: Salarial → Professor → Modalidade)
// Salarial vem primeiro porque pode ser aberto de cima do modal de professor
// caso futuramente seja embutido — defesa contra empilhamento.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const salaryModal = document.getElementById('salaryModal');
  if (salaryModal && salaryModal.classList.contains('open')) {
    closeSalaryModal();
    return;
  }
  const teacherModal = document.getElementById('teacherModal');
  if (teacherModal && teacherModal.classList.contains('open')) {
    closeTeacherModal();
    return;
  }
  const modalityModal = document.getElementById('modalityModal');
  if (modalityModal && modalityModal.classList.contains('open')) {
    closeModalityModal();
  }
});

console.log('[CrossTainer Professores] professores-cadastro.js carregado · Sprint 1 ✅ + mini-sprint 1.5 (B-01 effectiveDate + B-02 VR/VT/Outros)');
