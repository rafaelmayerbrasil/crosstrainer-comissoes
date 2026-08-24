// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Módulo Professores · Tela de Grade de Horários (Sprint 2)
//
// Etapas implementadas:
//   ✅ Etapa 1 — Sidebar + roteamento (registrado em professores.js)
//   ✅ Etapa 2 — Services (em professores-shared.js)
//   ✅ Etapa 3 — Shell + toolbar (combo unidade + toggle inativos + botão + bootstrap template)
//   ✅ Etapa 4 — Grid semanal (7 colunas × slots ordenados por horário, cor por modalidade)
//   ✅ Etapa 5 — Modal de criação/edição de slot + detecção de conflito
//   ✅ Etapa 6 — Inativar/reativar slot
//   ✅ Bônus — Multi-select de dias da semana em criação (lança N slots em lote
//                quando mesma modalidade/horário/professor vale pra vários dias)
//
// Etapa pendente:
//   • Etapa 7 — Smoke test em staging (10 critérios)
//
// Decisões fixadas (sprint-2-agenda.md § 9):
//   • Slot livre (qualquer hora:minuto)
//   • 1 template padrão por unidade, auto-criado ao primeiro acesso
//   • Visão semanal abstrata (Seg/Ter/...) — sem datas reais (Sprint 3)
//   • Conflito do mesmo professor: BLOQUEIA. Mesma faixa com outro professor: OK
// ═══════════════════════════════════════════════════════════════════════

'use strict';

// ────────────────────────────────────────────────────────────────────────
// State local da tela de Agenda
// ────────────────────────────────────────────────────────────────────────
const AgendaState = {
  units: [],
  unitId: null,
  template: null,
  slots: [],                   // todos os slots (ativos + inativos)
  modalitiesMap: new Map(),    // id → modality (pra mostrar nome em vez de id)
  teachersMap: new Map(),      // id → teacher
  showInactive: false,
  // Filtros da grade ('' = todos). 181 slots numa tela só: sem isso, achar os
  // horários de uma pessoa é varrer sete colunas no olho (Rafael, 12/08/2026).
  filterTeacherId: '',
  filterModalityId: '',
  loading: false,
};

// Ordem das colunas do grid: começa em Segunda (pra alinhar com cultura BR)
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Seg, Ter, Qua, Qui, Sex, Sáb, Dom

// Paleta de cores para modalidades (8 cores). Hash do id pra consistência.
const MODALITY_COLORS = [
  { bg: 'rgba(255,138,0,0.18)',  border: 'rgba(255,138,0,0.55)',  text: '#FF8A00' },  // laranja
  { bg: 'rgba(94,168,255,0.18)', border: 'rgba(94,168,255,0.55)', text: '#5EA8FF' },  // azul
  { bg: 'rgba(140,200,90,0.18)', border: 'rgba(140,200,90,0.55)', text: '#8CC85A' },  // verde
  { bg: 'rgba(220,120,200,0.18)',border: 'rgba(220,120,200,0.55)',text: '#DC78C8' },  // rosa
  { bg: 'rgba(255,210,80,0.18)', border: 'rgba(255,210,80,0.55)', text: '#FFD250' },  // amarelo
  { bg: 'rgba(180,120,255,0.18)',border: 'rgba(180,120,255,0.55)',text: '#B478FF' },  // roxo
  { bg: 'rgba(90,210,200,0.18)', border: 'rgba(90,210,200,0.55)', text: '#5AD2C8' },  // turquesa
  { bg: 'rgba(255,140,140,0.18)',border: 'rgba(255,140,140,0.55)',text: '#FF8C8C' },  // coral
];

/** #RRGGBB → rgba(r,g,b,alpha) — pra derivar fundo/borda da cor escolhida. */
function hexToRgba(hex, alpha) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function colorForModality(modalityId) {
  if (!modalityId) return { bg: 'var(--surface3)', border: 'var(--border)', text: 'var(--text2)' };

  // Cor definida no cadastro da modalidade tem prioridade sobre o sorteio por hash
  const mod = AgendaState.modalitiesMap.get(modalityId);
  if (mod && mod.color) {
    return { bg: hexToRgba(mod.color, 0.18), border: hexToRgba(mod.color, 0.55), text: mod.color };
  }

  // Fallback: modalidade antiga, sem cor escolhida — mantém o tom estável por hash
  let hash = 0;
  for (let i = 0; i < modalityId.length; i++) {
    hash = ((hash << 5) - hash) + modalityId.charCodeAt(i);
    hash |= 0;
  }
  return MODALITY_COLORS[Math.abs(hash) % MODALITY_COLORS.length];
}

// ────────────────────────────────────────────────────────────────────────
// Entry point — chamado por professores.js → navigateTo('agenda')
// ────────────────────────────────────────────────────────────────────────
async function renderAgendaPage() {
  const page = document.getElementById('page-agenda');
  if (!page) return;

  // Loading inicial
  page.innerHTML = `
    <div class="page-toolbar">
      <div class="lhs">
        <h2>GRADE DE HORÁRIOS</h2>
        <div class="count">Carregando…</div>
      </div>
    </div>
    <div class="loading"><div class="spinner"></div> Carregando dados…</div>
  `;

  // Carrega dependências em paralelo
  const [unitsRes, modsRes, teachersRes] = await Promise.all([
    UnitService.list(),
    ModalityService.list(),
    TeacherService.list(),
  ]);

  if (!unitsRes.success) {
    page.innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <h3>Erro ao carregar unidades</h3>
        <p>${escapeHtml(unitsRes.error || 'desconhecido')}</p>
        <button class="btn btn-outline" onclick="renderAgendaPage()">Tentar novamente</button>
      </div>
    `;
    return;
  }

  AgendaState.units = unitsRes.data || [];
  AgendaState.modalitiesMap = new Map((modsRes.data || []).map(m => [m.id, m]));
  AgendaState.teachersMap   = new Map((teachersRes.data || []).map(t => [t.id, t]));

  // Empty state: sem unidades cadastradas
  if (AgendaState.units.length === 0) {
    page.innerHTML = `
      <div class="page-toolbar">
        <div class="lhs"><h2>GRADE DE HORÁRIOS</h2></div>
      </div>
      <div class="empty-state">
        <div class="icon">🏢</div>
        <h3>Nenhuma unidade cadastrada</h3>
        <p>Cadastre pelo menos uma unidade antes de montar a agenda.</p>
        <p style="font-size:12px;color:var(--text3);margin-top:8px;">
          Tela de unidades virá em sprint futura. Por enquanto, crie via console:<br>
          <code style="font-size:11px;">await db.collection("units").doc("unit-cp").set({name:"CrossTainer CP"})</code>
        </p>
      </div>
    `;
    return;
  }

  // Seleciona primeira unidade por padrão (ou mantém última seleção)
  if (!AgendaState.unitId || !AgendaState.units.find(u => u.id === AgendaState.unitId)) {
    AgendaState.unitId = AgendaState.units[0].id;
  }
  await loadAgendaForUnit(AgendaState.unitId);
}

// ────────────────────────────────────────────────────────────────────────
// Bootstrap + load — garante template padrão + carrega slots
// ────────────────────────────────────────────────────────────────────────
async function loadAgendaForUnit(unitId) {
  AgendaState.unitId = unitId;
  AgendaState.loading = true;

  const unit = AgendaState.units.find(u => u.id === unitId);
  if (!unit) return;

  // 1) Garante template padrão
  const tplRes = await ScheduleTemplateService.getOrCreateDefault(unit);
  if (!tplRes.success) {
    renderAgendaError(tplRes.error || 'Falha ao garantir template padrão');
    return;
  }
  AgendaState.template = tplRes.data;
  if (tplRes.created) {
    toast(`Template padrão criado para "${unit.name || unit.id}".`, 'success', 3000);
  }

  // 2) Carrega slots da unidade (todos — ativos + inativos)
  const slotsRes = await ScheduleSlotService.listByUnit(unitId, { includeInactive: true });
  if (!slotsRes.success) {
    renderAgendaError(slotsRes.error || 'Falha ao carregar slots');
    return;
  }
  AgendaState.slots = slotsRes.data;
  AgendaState.loading = false;

  renderAgendaContent();
}

function renderAgendaError(msg) {
  const page = document.getElementById('page-agenda');
  if (!page) return;
  page.innerHTML = `
    <div class="empty-state">
      <div class="icon">⚠️</div>
      <h3>Erro</h3>
      <p>${escapeHtml(msg)}</p>
      <button class="btn btn-outline" onclick="renderAgendaPage()">Recarregar</button>
    </div>
  `;
}

// ────────────────────────────────────────────────────────────────────────
// Render principal (toolbar + grid)
// ────────────────────────────────────────────────────────────────────────
function renderAgendaContent() {
  const page = document.getElementById('page-agenda');
  if (!page) return;

  // Marcado = mostra SÓ os inativos (é assim que se procura o que foi desativado).
  // Antes misturava ativos + inativos e não dava pra achar os poucos inativos no meio.
  const porStatus = AgendaState.showInactive
    ? AgendaState.slots.filter(s => s.isActive === false)
    : AgendaState.slots.filter(s => s.isActive !== false);

  const visibleSlots = porStatus.filter(s =>
    (!AgendaState.filterTeacherId  || s.teacherId  === AgendaState.filterTeacherId) &&
    (!AgendaState.filterModalityId || s.modalityId === AgendaState.filterModalityId)
  );

  const filtrando = !!(AgendaState.filterTeacherId || AgendaState.filterModalityId);
  // Grade vazia POR CAUSA do filtro parece tela quebrada — diz o que houve e
  // oferece a saída, em vez de sete colunas de "Sem aulas".
  const corpo = (filtrando && visibleSlots.length === 0)
    ? `<div class="empty-state">
         <div class="icon">🔍</div>
         <h3>Nenhum slot com esses filtros</h3>
         <p>Nesta unidade não há horário que combine com o que você filtrou.</p>
         <button class="btn btn-outline" onclick="limparFiltrosAgenda()">Limpar filtros</button>
       </div>`
    : renderWeeklyGrid(visibleSlots);

  page.innerHTML = `
    ${renderAgendaToolbar(visibleSlots.length, porStatus.length, filtrando)}
    ${corpo}
  `;
}

/** Quem/o quê aparece na grade desta unidade — só o que tem slot, não o cadastro inteiro. */
function opcoesDaGrade() {
  const profs = new Map(), mods = new Map();
  AgendaState.slots.forEach(s => {
    if (s.teacherId && !profs.has(s.teacherId)) {
      const t = AgendaState.teachersMap.get(s.teacherId);
      profs.set(s.teacherId, (t && t.name) || s.teacherId);
    }
    if (s.modalityId && !mods.has(s.modalityId)) {
      const m = AgendaState.modalitiesMap.get(s.modalityId);
      mods.set(s.modalityId, (m && m.name) || s.modalityId);
    }
  });
  const ordenar = (map) => [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  return { professores: ordenar(profs), modalidades: ordenar(mods) };
}

function onAgendaFiltroProfessor(v) { AgendaState.filterTeacherId = v || ''; renderAgendaContent(); }
function onAgendaFiltroModalidade(v) { AgendaState.filterModalityId = v || ''; renderAgendaContent(); }
function limparFiltrosAgenda() {
  AgendaState.filterTeacherId = '';
  AgendaState.filterModalityId = '';
  renderAgendaContent();
}

function renderAgendaToolbar(visibleCount, totalNoStatus, filtrando) {
  const opts = AgendaState.units.map(u => `
    <option value="${escapeHtml(u.id)}" ${u.id === AgendaState.unitId ? 'selected' : ''}>
      ${escapeHtml(u.name || u.id)}
    </option>
  `).join('');

  const totalInactive = AgendaState.slots.filter(s => s.isActive === false).length;
  const { professores, modalidades } = opcoesDaGrade();
  // Se o filtro aponta pra alguém que não tem slot NESTA unidade (trocou de
  // unidade com o filtro ligado), a opção entra assim mesmo — senão o select
  // mostraria "Todos" com o filtro ligado, e a grade vazia viraria mistério.
  const optsDe = (lista, sel, mapa) => {
    const itens = lista.slice();
    if (sel && !itens.some(([id]) => id === sel)) {
      const nome = (mapa.get(sel) || {}).name || sel;
      itens.unshift([sel, `${nome} (sem horário aqui)`]);
    }
    return `<option value="">Todos</option>` + itens.map(([id, nome]) =>
      `<option value="${escapeHtml(id)}" ${id === sel ? 'selected' : ''}>${escapeHtml(nome)}</option>`).join('');
  };

  const rotulo = AgendaState.showInactive ? 'inativo' : 'ativo';
  const contagem = filtrando
    ? `${visibleCount} de ${totalNoStatus} slot${totalNoStatus === 1 ? '' : 's'} ${rotulo}${totalNoStatus === 1 ? '' : 's'}`
    : `${visibleCount} slot${visibleCount === 1 ? '' : 's'} ${rotulo}${visibleCount === 1 ? '' : 's'}`;

  return `
    <div class="page-toolbar">
      <div class="lhs">
        <h2>GRADE DE HORÁRIOS</h2>
        <div class="count">${contagem}${filtrando ? ` · <a href="#" onclick="limparFiltrosAgenda();return false;" style="color:var(--orange);">limpar filtros</a>` : ''}</div>
      </div>
      <div class="rhs agenda-toolbar-rhs">
        <label class="agenda-unit-select">
          <span>Unidade:</span>
          <select onchange="onUnitChange(this.value)">${opts}</select>
        </label>
        <label class="agenda-unit-select">
          <span>Professor:</span>
          <select onchange="onAgendaFiltroProfessor(this.value)">${optsDe(professores, AgendaState.filterTeacherId, AgendaState.teachersMap)}</select>
        </label>
        <label class="agenda-unit-select">
          <span>Modalidade:</span>
          <select onchange="onAgendaFiltroModalidade(this.value)">${optsDe(modalidades, AgendaState.filterModalityId, AgendaState.modalitiesMap)}</select>
        </label>
        <label class="agenda-toggle" title="Mostra apenas os slots desativados">
          <input type="checkbox" ${AgendaState.showInactive ? 'checked' : ''} onchange="toggleShowInactive(this.checked)">
          Ver só inativos${totalInactive > 0 ? ` (${totalInactive})` : ''}
        </label>
        <button class="btn btn-outline btn-sm" id="btnGerarAgenda" onclick="gerarAgendaAgora()"
          title="Cria as aulas das próximas 8 semanas sem esperar a geração automática de segunda-feira">⚡ Gerar agenda agora</button>
        <button class="btn btn-primary btn-sm" onclick="openSlotModal(null)">+ Novo slot</button>
      </div>
    </div>
  `;
}

// Geração sob demanda. A automática roda toda segunda às 02:00; este botão existe
// pra quem acabou de cadastrar horário novo e não quer esperar até segunda.
async function gerarAgendaAgora() {
  if (!isAdminGestao()) {
    toast('Apenas a administração pode gerar a agenda.', 'error');
    return;
  }
  if (!confirm('Gerar as aulas das próximas 8 semanas agora?\n\nAulas que já existem não são duplicadas.')) return;

  const btn = document.getElementById('btnGerarAgenda');
  const textoOriginal = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Gerando…'; }

  const res = await ClassService.generateNow(8);

  if (btn) { btn.disabled = false; btn.innerHTML = textoOriginal; }

  if (!res.success) {
    toast('Não consegui gerar: ' + (res.error || 'erro desconhecido'), 'error', 7000);
    return;
  }
  toast(res.created > 0
    ? `${res.created} aula(s) criada(s) nas próximas 8 semanas.`
    : 'Nenhuma aula nova — a agenda das próximas 8 semanas já estava completa.', 'success', 6000);
}

function renderWeeklyGrid(slots) {
  // Agrupa slots por weekday
  const byWeekday = new Map();
  WEEKDAY_ORDER.forEach(w => byWeekday.set(w, []));
  slots.forEach(s => {
    if (byWeekday.has(s.weekday)) byWeekday.get(s.weekday).push(s);
  });
  // Ordena cada coluna por startTime
  byWeekday.forEach(list => list.sort((a, b) => {
    const aMin = ProfHelpers.timeToMinutes(a.startTime) || 0;
    const bMin = ProfHelpers.timeToMinutes(b.startTime) || 0;
    return aMin - bMin;
  }));

  return `
    <div class="agenda-grid">
      ${WEEKDAY_ORDER.map(w => `
        <div class="agenda-col">
          <div class="agenda-col-header">${ProfHelpers.WEEKDAY_LABEL_SHORT[w]}</div>
          <div class="agenda-col-body">
            ${byWeekday.get(w).length === 0
              ? '<div class="agenda-col-empty">Sem aulas</div>'
              : byWeekday.get(w).map(renderSlotCard).join('')
            }
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderSlotCard(slot) {
  const mod = AgendaState.modalitiesMap.get(slot.modalityId);
  const teacher = AgendaState.teachersMap.get(slot.teacherId);
  const modName = mod ? mod.name : '⚠ modalidade não encontrada';
  const teacherName = teacher ? shortenName(teacher.name) : '⚠ professor não encontrado';
  const isInactive = slot.isActive === false;
  const color = colorForModality(slot.modalityId);
  const style = `background:${color.bg}; border-left:3px solid ${color.border};`;

  return `
    <div class="slot-card ${isInactive ? 'slot-inactive' : ''}"
         style="${style}"
         onclick="openSlotModal('${slot.id}')"
         title="${escapeHtml(modName)} · ${escapeHtml(teacherName)}">
      <div class="slot-time">${slot.startTime}<span class="slot-time-sep">–</span>${slot.endTime}</div>
      <div class="slot-modality" style="color:${color.text};">${escapeHtml(modName)}</div>
      <div class="slot-teacher">${escapeHtml(teacherName)}</div>
      ${isInactive ? '<div class="slot-inactive-badge">inativo</div>' : ''}
    </div>
  `;
}

// Primeiro nome + inicial do último sobrenome (Rafael, 12/08: inverter de
// "R. Brasil" pra "Rafael B." — o primeiro nome é o que identifica a pessoa
// no time, a inicial do sobrenome só desempata).
function shortenName(fullName) {
  if (!fullName) return '—';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return parts[0] + ' ' + parts[parts.length - 1][0] + '.';
}

// ────────────────────────────────────────────────────────────────────────
// Handlers de toolbar
// ────────────────────────────────────────────────────────────────────────
async function onUnitChange(unitId) {
  await loadAgendaForUnit(unitId);
}

function toggleShowInactive(checked) {
  AgendaState.showInactive = !!checked;
  renderAgendaContent();
}

// ────────────────────────────────────────────────────────────────────────
// Modal de criação/edição de slot
// ────────────────────────────────────────────────────────────────────────
const SlotFormState = {
  editingId: null,
  weekdays: [1],   // CRIAÇÃO aceita múltiplos dias (lança N slots em lote).
                   // EDIÇÃO usa seleção única: trocar o dia MOVE o horário.
  originalWeekday: null,  // dia com que o modal abriu — é o que detecta a troca no save
  lastWeekday: 1,  // último dia usado na sessão — vira o padrão do próximo slot
};

function openSlotModal(slotId = null) {
  if (!isAdminGestao() && !isSupervisao()) {
    toast('Você não tem permissão para gerenciar a agenda.', 'error');
    return;
  }
  if (!AgendaState.template) {
    toast('Template padrão não carregado. Recarregue a página.', 'error');
    return;
  }

  // Pré-condição: precisa ter modalidades ativas e professores ativos
  const activeMods = Array.from(AgendaState.modalitiesMap.values()).filter(m => m.isActive !== false);
  const activeTeachers = Array.from(AgendaState.teachersMap.values()).filter(t => t.isActive !== false);
  if (activeMods.length === 0) {
    toast('Cadastre ao menos uma modalidade ativa antes (menu Modalidades).', 'error', 6000);
    return;
  }
  if (activeTeachers.length === 0) {
    toast('Cadastre ao menos um professor ativo antes (menu Professores).', 'error', 6000);
    return;
  }

  const modal = document.getElementById('slotModal');
  if (!modal) return;

  const editing = slotId ? AgendaState.slots.find(s => s.id === slotId) : null;
  SlotFormState.editingId = slotId;
  // Novo slot herda o dia do último criado nesta sessão, não Segunda fixo.
  // Antes voltava sempre pra Segunda: quem montava vários slots do mesmo dia
  // (a manhã de sábado, por exemplo) preenchia tudo de novo, não reparava que o
  // dia tinha voltado sozinho, e o slot nascia na Segunda. Aconteceu em produção.
  SlotFormState.weekdays = editing ? [editing.weekday] : [SlotFormState.lastWeekday || 1];
  SlotFormState.originalWeekday = editing ? editing.weekday : null;

  document.getElementById('slotModalTitle').textContent = editing ? 'Editar slot' : 'Novo slot';
  document.getElementById('slotModalError').textContent = '';

  // Render chips de dia da semana
  renderSlotWeekdayChips();

  // Horários
  document.getElementById('slotStartTime').value = editing ? editing.startTime : '07:00';
  document.getElementById('slotEndTime').value   = editing ? editing.endTime   : '08:00';
  updateSlotDuration();

  // Modalidade
  renderSlotModalitySelect(editing ? editing.modalityId : '');

  // Professor (filtrado pela modalidade)
  renderSlotTeacherSelect(editing ? editing.modalityId : '', editing ? editing.teacherId : '');

  // Observações
  document.getElementById('slotNotes').value = editing ? (editing.notes || '') : '';

  // Botões inativar/reativar (só na edição)
  const toggleBtn = document.getElementById('slotToggleActiveBtn');
  if (editing) {
    toggleBtn.style.display = '';
    if (editing.isActive === false) {
      toggleBtn.textContent = 'Reativar';
      toggleBtn.dataset.action = 'activate';
      toggleBtn.style.borderColor = 'var(--green)';
      toggleBtn.style.color = 'var(--green)';
    } else {
      toggleBtn.textContent = 'Inativar';
      toggleBtn.dataset.action = 'deactivate';
      toggleBtn.style.borderColor = 'var(--red)';
      toggleBtn.style.color = 'var(--red)';
    }
  } else {
    toggleBtn.style.display = 'none';
  }

  modal.classList.add('open');
  setTimeout(() => document.getElementById('slotStartTime')?.focus(), 50);
}

function closeSlotModal() {
  const modal = document.getElementById('slotModal');
  if (modal) modal.classList.remove('open');
  SlotFormState.editingId = null;
}

function renderSlotWeekdayChips() {
  const wrap = document.getElementById('slotWeekdayChips');
  if (!wrap) return;
  const isEditing = !!SlotFormState.editingId;

  wrap.innerHTML = WEEKDAY_ORDER.map(w => {
    const isSelected = SlotFormState.weekdays.includes(w);
    const cls = ['chip-toggle'];
    if (isSelected) cls.push('selected');
    // Em edição todos os dias são clicáveis: clicar em outro MOVE o horário
    // (com confirmação no save). Antes ficavam travados e não havia como mudar.
    const title = isEditing
      ? (isSelected ? 'Dia atual deste horário' : 'Clique para mover este horário para cá')
      : (isSelected ? 'Clique para remover' : 'Clique para adicionar');
    return `<span class="${cls.join(' ')}" data-weekday="${w}" onclick="setSlotWeekday(${w})" title="${title}">${ProfHelpers.WEEKDAY_LABEL_SHORT[w]}</span>`;
  }).join('');

  // Hint dinâmico abaixo dos chips
  const hint = document.getElementById('slotWeekdayHint');
  if (hint) {
    if (isEditing) {
      const original = SlotFormState.originalWeekday;
      const atual = SlotFormState.weekdays[0];
      hint.textContent = atual === original
        ? `Dia atual: ${ProfHelpers.WEEKDAY_LABEL[atual].toUpperCase()}. Clique em outro dia para mover este horário.`
        : `Vai mudar de ${ProfHelpers.WEEKDAY_LABEL[original].toUpperCase()} para ${ProfHelpers.WEEKDAY_LABEL[atual].toUpperCase()} — as aulas futuras acompanham (o sistema confirma antes de salvar).`;
    } else {
      // Diz o NOME do dia, não só a quantidade: "1 dia selecionado" não avisava
      // que o dia era Segunda quando a pessoa achava que estava criando no sábado.
      const dias = SlotFormState.weekdays.slice().sort((a, b) => a - b)
        .map(w => ProfHelpers.WEEKDAY_LABEL[w]);
      const n = dias.length;
      hint.textContent = n === 0
        ? '⚠ Selecione ao menos um dia.'
        : n === 1
          ? `Será criado em: ${dias[0].toUpperCase()} · clique em outros dias para criar em lote.`
          : `Serão criados ${n} slots: ${dias.join(', ').toUpperCase()}.`;
    }
  }
}

function setSlotWeekday(w) {
  if (SlotFormState.editingId) {
    // Edição mexe em UM slot: seleção única. Clicar em outro dia move o horário.
    SlotFormState.weekdays = [w];
    renderSlotWeekdayChips();
    return;
  }
  const idx = SlotFormState.weekdays.indexOf(w);
  if (idx >= 0) {
    SlotFormState.weekdays.splice(idx, 1);  // toggle off
  } else {
    SlotFormState.weekdays.push(w);          // toggle on
  }
  renderSlotWeekdayChips();
}

function renderSlotModalitySelect(currentId) {
  const sel = document.getElementById('slotModality');
  if (!sel) return;
  const active = Array.from(AgendaState.modalitiesMap.values()).filter(m => m.isActive !== false);
  const opts = ['<option value="">— escolha —</option>'].concat(
    active.map(m => `
      <option value="${escapeHtml(m.id)}" ${m.id === currentId ? 'selected' : ''}>
        ${escapeHtml(m.name)}
      </option>
    `)
  );
  sel.innerHTML = opts.join('');
}

function renderSlotTeacherSelect(modalityId, currentTeacherId) {
  const sel = document.getElementById('slotTeacher');
  if (!sel) return;
  let teachers = Array.from(AgendaState.teachersMap.values()).filter(t => t.isActive !== false);
  if (modalityId) {
    teachers = teachers.filter(t => Array.isArray(t.modalityIds) && t.modalityIds.includes(modalityId));
  }
  const opts = ['<option value="">— escolha a modalidade primeiro —</option>'];
  if (modalityId && teachers.length === 0) {
    opts.push('<option value="" disabled>Nenhum professor habilitado nesta modalidade</option>');
  } else {
    teachers.forEach(t => {
      opts.push(`
        <option value="${escapeHtml(t.id)}" ${t.id === currentTeacherId ? 'selected' : ''}>
          ${escapeHtml(t.name)} · ${escapeHtml(t.type || '')}
        </option>
      `);
    });
  }
  sel.innerHTML = opts.join('');
}

function onSlotModalityChange(modalityId) {
  // Ao trocar de modalidade, re-popula professores filtrados
  renderSlotTeacherSelect(modalityId, '');
}

function updateSlotDuration() {
  const start = document.getElementById('slotStartTime').value;
  const end = document.getElementById('slotEndTime').value;
  const out = document.getElementById('slotDuration');
  if (!out) return;
  const min = ProfHelpers.minutesBetween(start, end);
  if (min === null) { out.textContent = '—'; return; }
  if (min <= 0) { out.textContent = 'horário inválido'; return; }
  if (min < 60) { out.textContent = `${min} min`; return; }
  const h = Math.floor(min / 60);
  const m = min % 60;
  out.textContent = m ? `${h}h${String(m).padStart(2,'0')}min` : `${h}h`;
}

async function saveSlot() {
  const errEl = document.getElementById('slotModalError');
  errEl.textContent = '';

  const startTime = document.getElementById('slotStartTime').value;
  const endTime = document.getElementById('slotEndTime').value;
  const modalityId = document.getElementById('slotModality').value;
  const teacherId = document.getElementById('slotTeacher').value;
  const notes = document.getElementById('slotNotes').value.trim();

  // Validações client-side
  if (!startTime) { errEl.textContent = 'Defina o horário de início.'; return; }
  if (!endTime)   { errEl.textContent = 'Defina o horário de fim.'; return; }
  const startMin = ProfHelpers.timeToMinutes(startTime);
  const endMin = ProfHelpers.timeToMinutes(endTime);
  if (startMin === null || endMin === null) {
    errEl.textContent = 'Horário inválido (use formato HH:MM).'; return;
  }
  if (endMin <= startMin) {
    errEl.textContent = 'O horário de fim precisa ser maior que o de início.'; return;
  }
  if (endMin - startMin < 15) {
    errEl.textContent = 'A duração mínima do slot é 15 minutos.'; return;
  }
  if (!modalityId) { errEl.textContent = 'Escolha a modalidade.'; return; }
  if (!teacherId)  { errEl.textContent = 'Escolha o professor.'; return; }
  if (SlotFormState.weekdays.length === 0) {
    errEl.textContent = 'Selecione ao menos um dia da semana.'; return;
  }

  const baseSlotData = {
    templateId: AgendaState.template.id,
    unitId: AgendaState.unitId,
    startTime,
    endTime,
    modalityId,
    teacherId,
    notes,
  };

  // D6 — Detecção de conflito por dia (mesmo professor + weekday + horário sobreposto)
  // Em criação multi-dia, checa TODOS os dias e mostra todos os conflitos juntos.
  //
  // Compara contra os slots do professor em TODAS as unidades, não só na que está
  // aberta na tela: ele não se divide entre CP e PP no mesmo horário. Se a busca
  // falhar, cai pros slots já carregados — melhor validar de menos que travar o save.
  const porTeacher = await ScheduleSlotService.listByTeacher(teacherId);
  const universoSlots = porTeacher.success ? porTeacher.data : AgendaState.slots;

  const conflictsByDay = [];
  for (const w of SlotFormState.weekdays) {
    const trial = { ...baseSlotData, weekday: w };
    const conflicts = ProfHelpers.detectSlotConflict(
      trial,
      universoSlots,
      SlotFormState.editingId   // ignora o próprio slot em caso de edição
    );
    if (conflicts.length > 0) {
      const c = conflicts[0];
      const tName = (() => {
        const t = AgendaState.teachersMap.get(c.teacherId);
        return t ? shortenName(t.name) : c.teacherId;
      })();
      const cMod = AgendaState.modalitiesMap.get(c.modalityId);
      // Se o choque é na OUTRA unidade, dizer qual — senão o admin olha a tela,
      // não vê nada no horário e acha que o sistema travou sem motivo.
      const outraUnidade = c.unitId && c.unitId !== AgendaState.unitId;
      const uName = outraUnidade
        ? (() => { const u = AgendaState.units.find(x => x.id === c.unitId); return u ? (u.name || u.id) : c.unitId; })()
        : null;
      conflictsByDay.push({
        dia: ProfHelpers.WEEKDAY_LABEL[w],
        texto: `${ProfHelpers.WEEKDAY_LABEL[w]}: ${tName} já tem ${cMod ? cMod.name : 'aula'} das ${c.startTime} às ${c.endTime}`
             + (outraUnidade ? ` na unidade ${uName}` : ''),
      });
    }
  }
  if (conflictsByDay.length > 0) {
    // O texto de erro fica no PÉ do formulário e passava despercebido — o usuário
    // achava que "não salvou e não avisou nada". Agora vai também num toast.
    const detalhe = conflictsByDay.map(c => c.texto).join(' · ');
    errEl.textContent = `${detalhe}. O mesmo professor não pode ter duas aulas no mesmo horário — troque o professor ou o horário.`;
    toast(conflictsByDay.length === 1
      ? `Não salvei: ${conflictsByDay[0].texto}.`
      : `Não salvei: conflito de professor em ${conflictsByDay.length} dias.`, 'error', 7000);
    return;
  }

  // Salva
  const btn = document.getElementById('slotSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  let toastMsg;
  if (SlotFormState.editingId) {
    // EDIÇÃO: só 1 slot.
    const oldSlot = AgendaState.slots.find(s => s.id === SlotFormState.editingId) || {};
    const novoWeekday = SlotFormState.weekdays[0];
    const mudouDia = oldSlot.weekday !== undefined && oldSlot.weekday !== novoWeekday;

    // TROCA DE DIA: perguntar ANTES de gravar qualquer coisa. Se cancelar, nada
    // é salvo — salvar a grade e deixar as aulas no dia velho é exatamente a
    // inconsistência que motivou esta mudança (decisão do Rodrigo, 13/08/2026).
    let moverAulas = false;
    if (mudouDia) {
      const previa = await ClassService.moveSlotClasses(SlotFormState.editingId, { dryRun: true });
      if (!previa.success) {
        btn.disabled = false; btn.textContent = 'Salvar';
        errEl.textContent = 'Não consegui verificar as aulas deste horário: ' + (previa.error || '');
        return;
      }
      const de = ProfHelpers.WEEKDAY_LABEL[oldSlot.weekday];
      const para = ProfHelpers.WEEKDAY_LABEL[novoWeekday];
      if (previa.deleted > 0) {
        const ok = confirm(
          `Você está mudando de ${de} para ${para}.\n\n` +
          `Existem ${previa.deleted} aula(s) futura(s) na ${de}. Elas serão movidas para a ${para}.\n` +
          `Aulas já substituídas, canceladas ou de mês fechado ficam onde estão.\n\n` +
          `Confirma?`
        );
        if (!ok) { btn.disabled = false; btn.textContent = 'Salvar'; return; }
      }
      // Mesmo com ZERO aula a mover, chama o move depois de salvar: é ele que
      // regera as aulas no dia novo. Sem isso o dia novo ficaria vazio até a
      // geração automática de segunda-feira.
      moverAulas = true;
    }

    const slotData = { ...baseSlotData, weekday: novoWeekday };
    const res = await ScheduleSlotService.update(SlotFormState.editingId, slotData);
    if (!res.success) {
      btn.disabled = false; btn.textContent = 'Salvar';
      errEl.textContent = res.error || 'Erro ao salvar.'; return;
    }
    toastMsg = 'Slot atualizado.';

    if (moverAulas) {
      btn.textContent = 'Movendo aulas…';
      const mv = await ClassService.moveSlotClasses(SlotFormState.editingId, { dryRun: false });
      if (mv.success) {
        toastMsg = mv.deleted > 0
          ? `Horário movido para ${ProfHelpers.WEEKDAY_LABEL[novoWeekday]}. ${mv.deleted} aula(s) movida(s).`
          : `Horário movido para ${ProfHelpers.WEEKDAY_LABEL[novoWeekday]}.`;
      } else {
        toast('Horário salvo, mas falhou ao mover as aulas: ' + (mv.error || ''), 'error', 7000);
      }
    } else {
      // Mesmo dia: propagação in-place dos outros campos (comportamento de 12/07).
      const mudouCampo = oldSlot.teacherId !== teacherId || oldSlot.modalityId !== modalityId
                      || oldSlot.startTime !== startTime || oldSlot.endTime !== endTime;
      if (mudouCampo) {
        const novoSlot = { teacherId, modalityId, startTime, endTime, durationMinutes: endMin - startMin };
        const plan = await ClassService.propagateSlotEditPlan(SlotFormState.editingId, novoSlot);
        if (plan.success && plan.eligibleCount > 0
            && confirm(`Aplicar também às ${plan.eligibleCount} próximas aulas já criadas?`)) {
          const ap = await ClassService.propagateSlotEditApply(plan.updates);
          if (ap.success) toastMsg = `Slot atualizado. ${ap.updated} aula(s) futura(s) atualizada(s).`;
          else toast('Slot salvo, mas falhou ao propagar: ' + (ap.error || ''), 'error');
        }
      }
    }
  } else {
    // CRIAÇÃO: itera weekdays. Se algum falhar no meio, para e reporta.
    const created = [];
    const errors = [];
    for (const w of SlotFormState.weekdays) {
      const slotData = { ...baseSlotData, weekday: w };
      const res = await ScheduleSlotService.create(slotData);
      if (res.success) {
        created.push(ProfHelpers.WEEKDAY_LABEL_SHORT[w]);
      } else {
        errors.push(`${ProfHelpers.WEEKDAY_LABEL_SHORT[w]}: ${res.error || 'erro'}`);
        break;  // para no primeiro erro pra não deixar estado parcial pior
      }
    }
    btn.disabled = false; btn.textContent = 'Salvar';
    if (errors.length > 0) {
      const ok = created.length
        ? `${created.length} slot${created.length > 1 ? 's' : ''} criado${created.length > 1 ? 's' : ''} (${created.join(', ')}). `
        : '';
      errEl.textContent = `${ok}Falha em ${errors.join(' · ')}.`;
      toast(`${ok}Não consegui salvar: ${errors.join(' · ')}.`, 'error', 7000);
      // Mesmo com erro parcial, recarrega para refletir os criados
      await loadAgendaForUnit(AgendaState.unitId);
      return;
    }
    // Confirma o DIA no toast — fecha o ciclo pra quem cria vários seguidos.
    toastMsg = created.length === 1
      ? `Slot criado em ${created[0]}.`
      : `${created.length} slots criados (${created.join(', ')}).`;
    // Lembra o dia pro próximo "+ Novo slot" desta sessão
    SlotFormState.lastWeekday = SlotFormState.weekdays.slice().sort((a, b) => a - b)[0];
  }

  // Captura ANTES de fechar o modal — closeSlotModal() zera o editingId.
  const ehNovo = !SlotFormState.editingId;

  toast(toastMsg, 'success');
  closeSlotModal();
  await loadAgendaForUnit(AgendaState.unitId);

  // Grade não é agenda: a vaga entra na grade na hora, mas as AULAS dela só
  // nascem quando o gerador roda (segunda de madrugada, ou no botão "Gerar
  // agenda agora"). Quem acabou de cadastrar vai olhar a Agenda Geral, não ver
  // nada e concluir que não salvou — foi o que aconteceu com o Rodrigo em
  // 24/08/2026: ele criou as terças e quintas da Thaynara às 17:52 e a última
  // geração tinha sido às 11:46. O botão estava ao lado, e ele não sabia.
  if (ehNovo && typeof gerarAgendaAgora === 'function') {
    const querAgora = confirm(
      'Vaga criada na grade.\n\n' +
      'As aulas dela ainda NÃO existem na Agenda — elas são criadas pelo gerador, ' +
      'que roda sozinho nas segundas de madrugada.\n\n' +
      'Quer gerar agora, pra já aparecer na Agenda Geral?'
    );
    if (querAgora) await gerarAgendaAgora();
  }
}

// ────────────────────────────────────────────────────────────────────────
// Inativar / Reativar slot (botão dentro do modal de edição)
// ────────────────────────────────────────────────────────────────────────
async function handleSlotToggleActive() {
  if (!SlotFormState.editingId) return;
  const slot = AgendaState.slots.find(s => s.id === SlotFormState.editingId);
  if (!slot) return;
  const action = slot.isActive === false ? 'reativar' : 'inativar';
  if (!confirm(`Deseja ${action} este slot?`)) return;

  const res = slot.isActive === false
    ? await ScheduleSlotService.activate(slot.id)
    : await ScheduleSlotService.deactivate(slot.id);

  if (!res.success) {
    toast('Erro: ' + (res.error || 'desconhecido'), 'error');
    return;
  }

  toast(`Slot ${action === 'inativar' ? 'inativado' : 'reativado'}.`, 'success');
  closeSlotModal();
  await loadAgendaForUnit(AgendaState.unitId);
}

// ════════════════════════════════════════════════════════════════════════
// SPRINT 3a — TELA "MINHA AGENDA" (professor)
// ════════════════════════════════════════════════════════════════════════
// Visualização de aulas reais (`classes`) do professor logado.
// Filtros temporais: semana atual / próxima / anterior / mês inteiro.
// Modal de aula: professor lê; admin/gestao/supervisao muda status.
// ────────────────────────────────────────────────────────────────────────

const MinhaAgendaState = {
  professorId: null,
  classes: [],
  filter: 'current_week',   // 'current_week' | 'next_week' | 'previous_week' | 'month'
  loading: false,
  selectedClassId: null,
};

const MINHA_AGENDA_FILTERS = [
  { id: 'previous_week', label: 'Semana anterior' },
  { id: 'current_week',  label: 'Semana atual' },
  { id: 'next_week',     label: 'Próxima semana' },
  { id: 'month',         label: 'Mês inteiro' },
];

// Calcula intervalo de datas conforme filtro selecionado
function getDateRangeForFilter(filter) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  switch (filter) {
    case 'previous_week': {
      // segunda desta semana − 7 dias (o "today−1" antigo só era domingo às segundas)
      const prevMonday = ProfHelpers.getStartOfWeek(today);
      prevMonday.setDate(prevMonday.getDate() - 7);
      return { from: prevMonday, to: ProfHelpers.getEndOfWeek(prevMonday) };
    }
    case 'current_week':
      return { from: ProfHelpers.getStartOfWeek(today), to: ProfHelpers.getEndOfWeek(today) };
    case 'next_week': {
      const nextMonday = new Date(today);
      nextMonday.setDate(nextMonday.getDate() + 7);
      return { from: ProfHelpers.getStartOfWeek(nextMonday), to: ProfHelpers.getEndOfWeek(nextMonday) };
    }
    case 'month': {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);
      const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
      return { from: monthStart, to: monthEnd };
    }
    default:
      return { from: ProfHelpers.getStartOfWeek(today), to: ProfHelpers.getEndOfWeek(today) };
  }
}

/** Intervalo de um dia específico: 00:00:00 a 23:59:59 local. */
function getDayRange(date) {
  const from = new Date(date);
  from.setHours(0, 0, 0, 0);
  const to = new Date(date);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

// Estados que fogem do previsto — só esses ganham selo na lista organizada
// (Opção A da proposta 12/08: "prevista" é o normal, não precisa se anunciar).
const AGENDA_GERAL_ABNORMAL_STATUSES = new Set(['cancelada', 'substituida', 'nao_realizada']);
function isAbnormalStatus(status) {
  return AGENDA_GERAL_ABNORMAL_STATUSES.has(status);
}

// ────────────────────────────────────────────────────────────────────────
// Entry point — chamado por professores.js → navigateTo('minha-agenda')
// ────────────────────────────────────────────────────────────────────────
async function renderMinhaAgendaPage() {
  const page = document.getElementById('page-minha-agenda');
  if (!page) return;

  MinhaAgendaState.professorId = getCurrentProfessorId();

  // Empty state — sem vínculo user↔teacher
  if (!MinhaAgendaState.professorId) {
    page.innerHTML = `
      <div class="page-toolbar">
        <div class="lhs"><h2>MINHA AGENDA</h2></div>
      </div>
      <div class="empty-state">
        <div class="icon">🔗</div>
        <h3>Sua conta ainda não está vinculada a um cadastro de professor</h3>
        <p>Para ver suas aulas, peça ao admin para vincular seu usuário<br>
           a um registro de professor (campo <code>professorId</code> em <code>users/{seu-uid}</code>).</p>
        <p style="margin-top:12px; font-size:12px; color:var(--text3);">
          Seu UID: <code>${escapeHtml(AppState.currentUser?.uid || '—')}</code>
        </p>
      </div>
    `;
    return;
  }

  // Loading inicial
  page.innerHTML = `
    <div class="page-toolbar">
      <div class="lhs"><h2>MINHA AGENDA</h2><div class="count">Carregando…</div></div>
    </div>
    <div class="loading"><div class="spinner"></div> Carregando suas aulas…</div>
  `;

  // Carrega modalities e units se ainda não carregados (cache cross-tela)
  if (AgendaState.modalitiesMap.size === 0 || AgendaState.units.length === 0) {
    const [modsRes, unitsRes, teachersRes] = await Promise.all([
      ModalityService.list(), UnitService.list(), TeacherService.list(),
    ]);
    AgendaState.modalitiesMap = new Map((modsRes.data || []).map(m => [m.id, m]));
    AgendaState.units = unitsRes.data || [];
    AgendaState.teachersMap = new Map((teachersRes.data || []).map(t => [t.id, t]));
  }

  await loadMinhaAgenda();
}

async function loadMinhaAgenda() {
  MinhaAgendaState.loading = true;
  const { from, to } = getDateRangeForFilter(MinhaAgendaState.filter);
  const res = await ClassService.listByTeacher(MinhaAgendaState.professorId, { from, to });

  if (!res.success) {
    document.getElementById('page-minha-agenda').innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <h3>Erro ao carregar aulas</h3>
        <p>${escapeHtml(res.error || 'desconhecido')}</p>
        <button class="btn btn-outline" onclick="renderMinhaAgendaPage()">Tentar novamente</button>
      </div>
    `;
    return;
  }

  MinhaAgendaState.classes = res.data;
  MinhaAgendaState.loading = false;
  renderMinhaAgendaContent();
}

function renderMinhaAgendaContent() {
  const page = document.getElementById('page-minha-agenda');
  if (!page) return;

  const total = MinhaAgendaState.classes.length;
  const filterLabel = MINHA_AGENDA_FILTERS.find(f => f.id === MinhaAgendaState.filter)?.label || '';
  const teacher = AgendaState.teachersMap.get(MinhaAgendaState.professorId);

  page.innerHTML = `
    <div class="page-toolbar">
      <div class="lhs">
        <h2>MINHA AGENDA</h2>
        <div class="count">
          ${teacher ? escapeHtml(teacher.name) + ' · ' : ''}${total} aula${total === 1 ? '' : 's'} · ${filterLabel}
        </div>
      </div>
      <div class="rhs minha-agenda-filters">
        ${MINHA_AGENDA_FILTERS.map(f => `
          <span class="chip ${f.id === MinhaAgendaState.filter ? 'chip-active' : ''}"
                onclick="setMinhaAgendaFilter('${f.id}')">${f.label}</span>
        `).join('')}
      </div>
    </div>
    ${total === 0
      ? `<div class="empty-state-small" style="padding:48px 24px;">Nenhuma aula no período selecionado.</div>`
      : renderClassesGroupedByDate(MinhaAgendaState.classes)
    }
  `;
}

function setMinhaAgendaFilter(filter) {
  if (MinhaAgendaState.filter === filter) return;
  MinhaAgendaState.filter = filter;
  loadMinhaAgenda();
}

/**
 * Ordena as aulas de um dia por horário de início.
 * A consulta ordena só por scheduledDate, e todas as aulas do mesmo dia têm a
 * MESMA data (meia-noite) — então dentro do dia a ordem vinha aleatória.
 */
function sortByStartTime(items) {
  return items.sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')));
}

/**
 * Agrupa aulas por unidade, na ORDEM do cadastro de unidades (não na ordem
 * de chegada do Firestore) — pra lista sempre mostrar CP antes de PP, por
 * exemplo, do jeito que o time já espera ver. Só entram unidades com aula.
 */
function groupClassesByUnit(classes, units) {
  const byUnitId = new Map();
  classes.forEach(c => {
    if (!byUnitId.has(c.unitId)) byUnitId.set(c.unitId, []);
    byUnitId.get(c.unitId).push(c);
  });
  const groups = [];
  units.forEach(unit => {
    const items = byUnitId.get(unit.id);
    if (items && items.length > 0) {
      groups.push({ unit, items: sortByStartTime(items.slice()) });
    }
  });
  return groups;
}

/**
 * Monta a grade da Opção B: linhas = horários distintos que têm pelo menos
 * uma aula no dia (não a grade cheia 00:00-23:00 — ninguém quer rolar past
 * 40 linhas vazias), colunas = unidades selecionadas, na ordem do cadastro.
 * Célula pode ter mais de uma aula (duas turmas no mesmo horário/unidade).
 */
function buildDayGrid(classes, unitIds, allUnits) {
  const units = allUnits.filter(u => unitIds.includes(u.id));
  const timesSet = new Set(classes.map(c => c.startTime).filter(Boolean));
  const times = Array.from(timesSet).sort((a, b) => a.localeCompare(b));

  const rows = times.map(time => {
    const cellsByUnit = {};
    units.forEach(u => { cellsByUnit[u.id] = []; });
    classes
      .filter(c => c.startTime === time)
      .forEach(c => { if (cellsByUnit[c.unitId]) cellsByUnit[c.unitId].push(c); });
    return { time, cellsByUnit };
  });

  return { units, times, rows };
}

function renderClassesGroupedByDate(classes) {
  // Agrupa por YYYY-MM-DD
  const groups = new Map();
  classes.forEach(c => {
    if (!c.scheduledDate) return;
    const d = c.scheduledDate.toDate ? c.scheduledDate.toDate() : new Date(c.scheduledDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (!groups.has(key)) groups.set(key, { date: d, items: [] });
    groups.get(key).items.push(c);
  });
  groups.forEach(g => sortByStartTime(g.items));

  return `
    <div class="minha-agenda-list">
      ${Array.from(groups.values()).map(g => `
        <div class="minha-agenda-day">
          <div class="minha-agenda-day-header">${ProfHelpers.formatDateBR(g.date)}</div>
          <div class="minha-agenda-day-items">
            ${g.items.map(renderClassCard).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * Nome a exibir para a aula.
 * Escala especial (Escola Interna, evento…) não tem modalidade — antes caía no
 * fallback e aparecia "—" na agenda, sem dizer o que era.
 */
function classDisplayName(cls) {
  const mod = AgendaState.modalitiesMap.get(cls.modalityId);
  if (mod) return mod.name;
  if (cls.specialScaleId || cls.specialScaleType) {
    return ProfHelpers.SPECIAL_SCALE_LABEL?.[cls.specialScaleType] || 'Escola Interna';
  }
  return null;
}

/** Cor da faixa lateral: a da modalidade (definida no cadastro) ou, na falta, a do status. */
function classAccentColor(cls) {
  const mod = AgendaState.modalitiesMap.get(cls.modalityId);
  if (mod && mod.color) return mod.color;
  if (!mod && (cls.specialScaleId || cls.specialScaleType)) return ProfHelpers.SPECIAL_SCALE_COLOR;
  return (ProfHelpers.CLASS_STATUS_COLOR[cls.status] || ProfHelpers.CLASS_STATUS_COLOR.prevista).border;
}

/**
 * Etiqueta de substituição no cartão (bloco 3).
 *
 * A aula substituída continua na agenda dos DOIS: quem passou precisa saber que
 * deu certo e pra quem; quem pegou precisa saber de quem está cobrindo. Antes a
 * aula simplesmente sumia da lista do titular.
 */
function renderSubstitutionTag(cls) {
  const papel = ProfHelpers.classSubstitutionRole(cls, getCurrentProfessorId());
  if (!papel) return '';

  const outro = AgendaState.teachersMap.get(papel.outroId);
  const nome = outro ? (outro.name || 'outro professor') : 'outro professor';
  const quando = cls.adjustedAt && cls.adjustedAt.toDate
    ? ' · aceito em ' + cls.adjustedAt.toDate().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    : '';

  const texto = papel.role === 'cobrindo'
    ? `⇄ Cobrindo ${nome}`
    : `⇄ Substituída por ${nome}${quando}`;

  return `<div class="class-card-sub-tag">${escapeHtml(texto)}</div>`;
}

function renderClassCard(cls) {
  const unit = AgendaState.units.find(u => u.id === cls.unitId);
  const modName = classDisplayName(cls) || '⚠ modalidade não encontrada';
  const unitName = unit ? (unit.name || unit.id) : '⚠ unidade';
  const sColor = ProfHelpers.CLASS_STATUS_COLOR[cls.status] || ProfHelpers.CLASS_STATUS_COLOR.prevista;
  const sLabel = ProfHelpers.CLASS_STATUS_LABEL[cls.status] || cls.status;

  return `
    <div class="class-card" onclick="openClassModal('${cls.id}')"
         style="border-left:3px solid ${classAccentColor(cls)};">
      <div class="class-card-time">
        ${cls.startTime}<span class="slot-time-sep">–</span>${cls.endTime}
      </div>
      <div class="class-card-info">
        <div class="class-card-modality">${escapeHtml(modName)}</div>
        <div class="class-card-unit">${escapeHtml(unitName)}</div>
        ${renderSubstitutionTag(cls)}
      </div>
      <div class="class-card-status">
        <span class="class-status-badge" style="background:${sColor.bg};color:${sColor.text};border:1px solid ${sColor.border};">
          ${sLabel}
        </span>
      </div>
    </div>
  `;
}

// ────────────────────────────────────────────────────────────────────────
// Modal de aula — visualização + (admin) alteração de status
// ────────────────────────────────────────────────────────────────────────
/**
 * O que o professor avisou sobre a aula, pra gestão ver e confirmar.
 * O aviso NÃO entra no fechamento sozinho: o botão só preenche o formulário,
 * e quem grava continua sendo a gestão clicando em Salvar.
 */
function avisoProfessorHtml(cls, podeAplicar) {
  const av = cls.avisoProfessor;
  if (!av) return '';
  const quando = av.em && av.em.toDate ? av.em.toDate().toLocaleDateString('pt-BR') : '';
  if (av.tipo === 'nao_aconteceu') {
    return `<div class="info-callout" style="margin-top:14px;border-color:#caa23a;">
      ⚠️ <strong>O professor avisou que esta aula não aconteceu.</strong>${quando ? ` (${quando})` : ''}
      ${av.nota ? `<br>"${escapeHtml(av.nota)}"` : ''}
      ${podeAplicar ? `<br><span style="font-size:12px;color:var(--text2);">Ajuste o status abaixo e salve para confirmar.</span>` : ''}
    </div>`;
  }
  if (av.tipo === 'ocorrencia') {
    const partes = [];
    if (av.atrasoMinutos) partes.push(`chegou <b>${av.atrasoMinutos} min</b> atrasado`);
    if (av.saidaAntecipadaMinutos) partes.push(`saiu <b>${av.saidaAntecipadaMinutos} min</b> antes`);
    if (av.horaExtraMinutos) partes.push(`ficou <b>${av.horaExtraMinutos} min</b> além`);
    return `<div class="info-callout" style="margin-top:14px;border-color:#caa23a;">
      ⚠️ <strong>O professor informou:</strong> ${partes.join(' · ')}${quando ? ` (${quando})` : ''}
      ${av.nota ? `<br>"${escapeHtml(av.nota)}"` : ''}
      <br><span style="font-size:12px;color:var(--text2);">Ainda não entrou no fechamento.</span>
      ${podeAplicar ? `<br><button class="btn btn-outline btn-sm" style="margin-top:8px;" onclick="aplicarAvisoProfessor()">Usar esses valores</button>` : ''}
    </div>`;
  }
  return '';
}

/** Copia o que o professor informou pro formulário. Gravar mesmo, só no Salvar. */
function aplicarAvisoProfessor() {
  const cls = MinhaAgendaState.classes.find(c => c.id === MinhaAgendaState.selectedClassId)
           || AgendaGeralState.classes.find(c => c.id === MinhaAgendaState.selectedClassId);
  const av = cls && cls.avisoProfessor;
  if (!av || av.tipo !== 'ocorrencia') return;
  document.getElementById('classAtraso').value = av.atrasoMinutos || '';
  document.getElementById('classSaidaAntecipada').value = av.saidaAntecipadaMinutos || '';
  document.getElementById('classHoraExtra').value = av.horaExtraMinutos || '';
  if (av.nota) document.getElementById('classStatusNote').value = av.nota;
  if (typeof atualizarPreviewHoras === 'function') atualizarPreviewHoras();
  toast('Valores preenchidos. Confira e clique em Salvar.', 'info');
}

async function openClassModal(classId) {
  // A Agenda Geral guarda as aulas na PRÓPRIA lista. Procurar só em
  // MinhaAgendaState fazia TODA aula clicada na Agenda Geral cair em "Aula não
  // encontrada na lista atual" — e pra quem é gestão sem vínculo de professor
  // essa lista está sempre vazia, então a tela inteira ficava inclicável
  // (Rodrigo e Rafael, 12/08/2026).
  const cls = MinhaAgendaState.classes.find(c => c.id === classId)
           || AgendaGeralState.classes.find(c => c.id === classId);
  if (!cls) {
    toast('Aula não encontrada na lista atual.', 'error');
    return;
  }
  MinhaAgendaState.selectedClassId = classId;

  const mod = AgendaState.modalitiesMap.get(cls.modalityId);
  const unit = AgendaState.units.find(u => u.id === cls.unitId);
  const teacher = AgendaState.teachersMap.get(cls.teacherId);
  const canEdit = isAdminGestao() || isSupervisao();
  const sLabel = ProfHelpers.CLASS_STATUS_LABEL[cls.status] || cls.status;
  const sColor = ProfHelpers.CLASS_STATUS_COLOR[cls.status] || {};
  const isLocked = !!cls.monthClosingId;

  const modal = document.getElementById('classModal');
  if (!modal) return;
  document.getElementById('classModalTitle').textContent = `Aula — ${ProfHelpers.formatDateBR(cls.scheduledDate)}`;
  document.getElementById('classModalError').textContent = '';

  document.getElementById('classModalDetails').innerHTML = `
    <div class="info-grid">
      <div>
        <div class="info-field-label">Horário</div>
        <div class="info-field-value mono">${cls.startTime} – ${cls.endTime} (${cls.durationMinutes || 0} min)</div>
      </div>
      <div>
        <div class="info-field-label">Modalidade</div>
        <div class="info-field-value">${escapeHtml(mod ? mod.name : '—')}</div>
      </div>
      <div>
        <div class="info-field-label">Unidade</div>
        <div class="info-field-value">${escapeHtml(unit ? (unit.name || unit.id) : '—')}</div>
      </div>
      <div>
        <div class="info-field-label">Professor</div>
        <div class="info-field-value">${escapeHtml(teacher ? teacher.name : '—')}</div>
      </div>
      ${(() => {
        // Bloco 3: quem passou a aula precisa ver que deu certo, e pra quem.
        const orig = cls.originalTeacherId && cls.originalTeacherId !== cls.teacherId
          ? AgendaState.teachersMap.get(cls.originalTeacherId) : null;
        if (!orig) return '';
        const quando = cls.adjustedAt && cls.adjustedAt.toDate
          ? ' · aceito em ' + cls.adjustedAt.toDate().toLocaleDateString('pt-BR') : '';
        return `
      <div>
        <div class="info-field-label">Substituição</div>
        <div class="info-field-value">⇄ No lugar de ${escapeHtml(orig.name || '—')}${escapeHtml(quando)}</div>
      </div>`;
      })()}
      <div>
        <div class="info-field-label">Status atual</div>
        <div class="info-field-value">
          <span class="class-status-badge" style="background:${sColor.bg};color:${sColor.text};border:1px solid ${sColor.border};">
            ${sLabel}
          </span>
          ${isLocked ? '<span class="info-field-hint" style="margin-left:8px;">🔒 mês fechado</span>' : ''}
        </div>
      </div>
    </div>
    ${cls.adjustmentNote ? `
      <div class="info-callout" style="margin-top:14px;">
        ℹ️ <strong>Última observação:</strong> "${escapeHtml(cls.adjustmentNote)}"
      </div>
    ` : ''}
    ${avisoProfessorHtml(cls, canEdit && !isLocked)}
  `;

  // Form de edição (só admin/gestao/supervisao) + botão Salvar
  const editBlock = document.getElementById('classModalEditBlock');
  const saveBtn = document.getElementById('classSaveBtn');
  if (canEdit && !isLocked) {
    editBlock.style.display = '';
    if (saveBtn) saveBtn.style.display = '';
    document.getElementById('classNewStatus').value = cls.status;
    document.getElementById('classStatusNote').value = '';
    // Ocorrências já lançadas
    document.getElementById('classFaltaTipo').value = cls.faltaTipo || '';
    document.getElementById('classAtraso').value = cls.atrasoMinutos || '';
    document.getElementById('classSaidaAntecipada').value = cls.saidaAntecipadaMinutos || '';
    document.getElementById('classHoraExtra').value = cls.horaExtraMinutos || '';
    ['classAtraso', 'classSaidaAntecipada', 'classHoraExtra'].forEach(id => {
      document.getElementById(id).oninput = atualizarPreviewHoras;
    });
    onClassFaltaChange();
  } else {
    editBlock.style.display = 'none';
    if (saveBtn) saveBtn.style.display = 'none';
  }

  // Professor: só o aviso de "não aconteceu", na aula dele e fora de mês fechado.
  // "avisoJaEscrito" marca que o bloco abaixo (noteHint) já foi preenchido por
  // aqui — antes os dois blocos escreviam no MESMO elemento e o segundo sempre
  // apagava o aviso "você já avisou" com "fale com a gestão", mesmo quando o
  // professor tinha acabado de avisar (achado ao mexer nesta tela em 21/08/2026).
  const profBlock = document.getElementById('classProfBlock');
  let avisoJaEscrito = false;
  if (profBlock) {
    const minhaAula = !canEdit && getCurrentProfessorId()
      && (cls.originalTeacherId === getCurrentProfessorId() || cls.teacherId === getCurrentProfessorId());
    const jaAvisou = !!cls.avisoProfessor;
    profBlock.style.display = (minhaAula && !isLocked && !jaAvisou) ? '' : 'none';
    if (minhaAula && jaAvisou) {
      const hint = document.getElementById('classModalReadOnlyHint');
      if (hint) {
        hint.textContent = cls.avisoProfessor.tipo === 'ocorrencia'
          ? 'Você já informou o que aconteceu nesta aula. A gestão vai confirmar.'
          : 'Você já avisou que esta aula não aconteceu. A gestão vai confirmar.';
        hint.style.display = '';
        avisoJaEscrito = true;
      }
    }
    ['classProfNota', 'classProfAtraso', 'classProfSaida', 'classProfExtra'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
  }

  const noteHint = document.getElementById('classModalReadOnlyHint');
  if (noteHint && !avisoJaEscrito) {
    // "Para alterar o status, fale com a gestão" era tudo o que a Camila via numa
    // aula que ela própria tinha dado. Agora, quando não há botão, a tela diz o
    // motivo real; quando há, ela não diz nada e o botão fala por si.
    const motivo = SubstitutionFlow.motivoSemBotao(cls, {
      teacherId: getCurrentProfessorId(),
      isGestao: canEdit,
    });
    if (canEdit && isLocked) {
      noteHint.textContent = 'Esta aula está em mês fechado. Nada mais pode ser alterado.';
      noteHint.style.display = '';
    } else if (motivo) {
      noteHint.textContent = motivo;
      noteHint.style.display = '';
    } else if (!canEdit && !classModalSouTitular(cls)) {
      noteHint.textContent = 'Esta aula está no nome de outro professor. Se quem deu foi você, use o botão abaixo — o titular e a gestão confirmam depois.';
      noteHint.style.display = '';
    } else if (!canEdit) {
      noteHint.textContent = 'Para alterar o status, fale com a gestão.';
      noteHint.style.display = '';
    } else {
      noteHint.style.display = 'none';
    }
  }

  modal.classList.add('open');
}

function closeClassModal() {
  const modal = document.getElementById('classModal');
  if (modal) modal.classList.remove('open');
  MinhaAgendaState.selectedClassId = null;
}

/** Falta zera o resto — não existe "faltou e chegou 10 min atrasado". */
function onClassFaltaChange() {
  const falta = document.getElementById('classFaltaTipo').value;
  ['classAtraso', 'classSaidaAntecipada', 'classHoraExtra'].forEach(id => {
    const el = document.getElementById(id);
    el.disabled = !!falta;
    if (falta) el.value = '';
  });
  // Dizer POR QUE travou. Antes os três campos só ficavam mudos e parecia defeito.
  const hint = document.getElementById('classFaltaHint');
  if (hint) {
    hint.style.display = falta ? '' : 'none';
    hint.textContent = falta
      ? 'Aula com falta não tem atraso, saída antecipada nem hora extra — por isso os três campos abaixo ficam bloqueados. Para liberá-los, mude Falta para "Não faltou".'
      : '';
  }
  atualizarPreviewHoras();
}

/** Mostra na hora quanto a aula vai valer — o admin vê o efeito antes de salvar. */
function atualizarPreviewHoras() {
  const box = document.getElementById('classHorasPreview');
  if (!box) return;
  const esconde = () => { box.innerHTML = ''; box.style.display = 'none'; };
  const mostra = html => { box.innerHTML = html; box.style.display = ''; };

  // Procura nas DUAS listas: aberto pela Agenda Geral, a aula não está em
  // MinhaAgendaState e a prévia ficava muda — sobrava uma caixa cinza vazia que
  // parecia campo quebrado. As funções vizinhas (linhas ~1210 e ~1228) já faziam
  // esse fallback; só esta tinha ficado de fora.
  const cls = MinhaAgendaState.classes.find(c => c.id === MinhaAgendaState.selectedClassId)
           || AgendaGeralState.classes.find(c => c.id === MinhaAgendaState.selectedClassId);
  if (!cls) { esconde(); return; }

  const num = id => Number(document.getElementById(id).value) || 0;
  const simulada = {
    durationMinutes: cls.durationMinutes,
    faltaTipo: document.getElementById('classFaltaTipo').value || null,
    atrasoMinutos: num('classAtraso'),
    saidaAntecipadaMinutos: num('classSaidaAntecipada'),
    horaExtraMinutos: num('classHoraExtra'),
  };
  const efetivos = ProfHelpers.classEffectiveMinutes(simulada);
  const base = cls.durationMinutes || 0;
  const paga = ProfHelpers.classCountsForPay(cls);

  if (!paga) {
    mostra('ℹ️ Esta aula <strong>não entra na conta de horas</strong> (Escola Interna).');
    return;
  }
  const dif = efetivos - base;
  mostra(efetivos === base
    ? `Vale <strong>${base} min</strong> — a duração cheia.`
    : `Vale <strong>${efetivos} min</strong> em vez de ${base} `
      + `(<strong style="color:var(--${dif < 0 ? 'red' : 'green'})">${dif > 0 ? '+' : ''}${dif} min</strong>).`);
}

/** Professor avisa que a aula não aconteceu — a gestão confirma depois. */
async function professorAvisaAulaNaoAconteceu() {
  const classId = MinhaAgendaState.selectedClassId;
  if (!classId) return;
  const nota = (document.getElementById('classProfNota').value || '').trim();
  if (!confirm('Avisar a gestão de que esta aula não aconteceu?')) return;
  const res = await ClassService.avisarNaoAconteceu(classId, nota);
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); return; }
  toast('Aviso enviado. A gestão vai confirmar.', 'success');
  closeClassModal();
  await recarregarAgendaAtual();
}

// Professor informa atraso / saída antecipada / hora extra. Vira aviso, não
// lançamento: só entra no fechamento depois que a gestão confirmar.
async function professorAvisaOcorrencia() {
  const classId = MinhaAgendaState.selectedClassId;
  if (!classId) return;
  const num = (id) => Number(document.getElementById(id).value) || 0;
  const dados = {
    atrasoMinutos: num('classProfAtraso'),
    saidaAntecipadaMinutos: num('classProfSaida'),
    horaExtraMinutos: num('classProfExtra'),
    nota: (document.getElementById('classProfNota').value || '').trim(),
  };
  if (!dados.atrasoMinutos && !dados.saidaAntecipadaMinutos && !dados.horaExtraMinutos) {
    toast('Preencha ao menos um dos campos de minutos.', 'error'); return;
  }
  const partes = [];
  if (dados.atrasoMinutos) partes.push(`${dados.atrasoMinutos} min de atraso`);
  if (dados.saidaAntecipadaMinutos) partes.push(`saiu ${dados.saidaAntecipadaMinutos} min antes`);
  if (dados.horaExtraMinutos) partes.push(`${dados.horaExtraMinutos} min a mais`);
  if (!confirm(`Enviar para a gestão: ${partes.join(' · ')}?\n\nEla confirma antes de entrar no fechamento.`)) return;

  const res = await ClassService.avisarOcorrencia(classId, dados);
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); return; }
  toast('Enviado. A gestão vai confirmar.', 'success');
  closeClassModal();
  await recarregarAgendaAtual();
}

/** Recarrega a tela em que a pessoa está — Minha Agenda e Agenda Geral têm listas próprias. */
async function recarregarAgendaAtual() {
  const emAgendaGeral = typeof AppState === 'object' && AppState && AppState.currentPage === 'agenda-geral';
  if (emAgendaGeral) await loadAgendaGeral();
  else await loadMinhaAgenda();
}

async function saveClassStatus() {
  const classId = MinhaAgendaState.selectedClassId;
  const errEl = document.getElementById('classModalError');
  errEl.textContent = '';
  if (!classId) { errEl.textContent = 'Estado inválido — feche e reabra.'; return; }

  const newStatus = document.getElementById('classNewStatus').value;
  const note = document.getElementById('classStatusNote').value.trim();
  const num = id => Number(document.getElementById(id).value) || 0;
  const ocorrencias = {
    faltaTipo: document.getElementById('classFaltaTipo').value || null,
    atrasoMinutos: num('classAtraso'),
    saidaAntecipadaMinutos: num('classSaidaAntecipada'),
    horaExtraMinutos: num('classHoraExtra'),
  };

  const btn = document.getElementById('classSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  const res = await ClassService.updateStatus(classId, newStatus, note, ocorrencias);

  btn.disabled = false;
  btn.textContent = 'Salvar';

  if (!res.success) {
    errEl.textContent = res.error || 'Erro ao salvar.';
    return;
  }
  toast('Status atualizado.', 'success');
  closeClassModal();
  // Recarrega a tela de onde a aula foi aberta: a Agenda Geral tem lista própria
  // e ficaria mostrando o status velho até alguém trocar de página.
  const emAgendaGeral = typeof AppState === 'object' && AppState && AppState.currentPage === 'agenda-geral';
  if (emAgendaGeral) await loadAgendaGeral();
  else await loadMinhaAgenda();
}

// ────────────────────────────────────────────────────────────────────────
// ESC fecha modais da agenda (prioridade: aula > slot)
// ────────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const classModal = document.getElementById('classModal');
  if (classModal && classModal.classList.contains('open')) {
    closeClassModal();
    return;
  }
  const slotModal = document.getElementById('slotModal');
  if (slotModal && slotModal.classList.contains('open')) {
    closeSlotModal();
  }
});

// ════════════════════════════════════════════════════════════════════════
// SPRINT 3b — AGENDA GERAL (multi-unidade, read-only)
// ════════════════════════════════════════════════════════════════════════

const AgendaGeralState = {
  unitIds: [],          // multi-select
  modalityId: '',       // single ('' = todas)
  teacherId: '',        // single ('' = todos)
  viewMode: 'period',   // 'period' (semana/mês, lista) | 'day' (grade por horário)
  filter: 'current_week',
  selectedDate: null,   // Date (meia-noite local) — usado só quando viewMode==='day'
  classes: [],
  loading: false,
};

// Modos de visão da Agenda Geral (decisão do Rodrigo, 12/08: grade no dia, lista em semana/mês)
const AGENDA_GERAL_VIEW_MODES = [
  { id: 'period', label: 'Semana/Mês' },
  { id: 'day',    label: 'Dia' },
];

async function renderAgendaGeralPage() {
  const page = document.getElementById('page-agenda-geral');
  if (!page) return;

  page.innerHTML = `
    <div class="page-toolbar">
      <div class="lhs"><h2>AGENDA GERAL</h2><div class="count">Carregando…</div></div>
    </div>
    <div class="loading"><div class="spinner"></div> Carregando dados…</div>
  `;

  // Carrega caches se vazios
  if (AgendaState.units.length === 0 || AgendaState.modalitiesMap.size === 0) {
    const [u, m, t] = await Promise.all([
      UnitService.list(), ModalityService.list(), TeacherService.list(),
    ]);
    AgendaState.units = u.data || [];
    AgendaState.modalitiesMap = new Map((m.data || []).map(x => [x.id, x]));
    AgendaState.teachersMap = new Map((t.data || []).map(x => [x.id, x]));
  }

  // Default: todas as unidades selecionadas
  if (AgendaGeralState.unitIds.length === 0) {
    AgendaGeralState.unitIds = AgendaState.units.map(u => u.id);
  }

  if (AgendaState.units.length === 0) {
    page.innerHTML = `
      <div class="empty-state">
        <div class="icon">🏢</div>
        <h3>Nenhuma unidade cadastrada</h3>
        <p>Cadastre unidades antes de visualizar a agenda geral.</p>
      </div>
    `;
    return;
  }

  await loadAgendaGeral();
}

async function loadAgendaGeral() {
  AgendaGeralState.loading = true;
  if (AgendaGeralState.viewMode === 'day' && !AgendaGeralState.selectedDate) {
    AgendaGeralState.selectedDate = new Date();
    AgendaGeralState.selectedDate.setHours(0, 0, 0, 0);
  }
  const { from, to } = AgendaGeralState.viewMode === 'day'
    ? getDayRange(AgendaGeralState.selectedDate)
    : getDateRangeForFilter(AgendaGeralState.filter);
  const fromTs = firebase.firestore.Timestamp.fromDate(from);
  const toTs = firebase.firestore.Timestamp.fromDate(to);

  try {
    // Limite Firestore: `where('in', [...])` aceita até 30 itens
    const unitChunks = chunk(AgendaGeralState.unitIds, 30);
    const allClasses = [];
    for (const chunkIds of unitChunks) {
      const snap = await db.collection('classes')
        .where('unitId', 'in', chunkIds)
        .where('scheduledDate', '>=', fromTs)
        .where('scheduledDate', '<=', toTs)
        .orderBy('scheduledDate', 'asc')
        .get();
      snap.docs.forEach(d => allClasses.push({ id: d.id, ...d.data() }));
    }

    // Filtros adicionais client-side (modalityId, teacherId)
    let filtered = allClasses;
    if (AgendaGeralState.modalityId) filtered = filtered.filter(c => c.modalityId === AgendaGeralState.modalityId);
    if (AgendaGeralState.teacherId)  filtered = filtered.filter(c => c.teacherId === AgendaGeralState.teacherId);

    AgendaGeralState.classes = filtered;
    AgendaGeralState.loading = false;
    renderAgendaGeralContent();
  } catch (err) {
    document.getElementById('page-agenda-geral').innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <h3>Erro ao carregar</h3>
        <p>${escapeHtml(err.message)}</p>
        <button class="btn btn-outline" onclick="renderAgendaGeralPage()">Tentar novamente</button>
      </div>
    `;
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function renderAgendaGeralContent() {
  const page = document.getElementById('page-agenda-geral');
  const total = AgendaGeralState.classes.length;
  const mode = AgendaGeralState.viewMode;

  const countLabel = mode === 'day'
    ? ProfHelpers.formatDateBR(AgendaGeralState.selectedDate)
    : (MINHA_AGENDA_FILTERS.find(f => f.id === AgendaGeralState.filter)?.label || '');

  const modOpts = ['<option value="">Todas modalidades</option>'].concat(
    Array.from(AgendaState.modalitiesMap.values())
      .filter(m => m.isActive !== false)
      .map(m => `<option value="${escapeHtml(m.id)}" ${m.id === AgendaGeralState.modalityId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`)
  ).join('');

  const teacherOpts = ['<option value="">Todos professores</option>'].concat(
    Array.from(AgendaState.teachersMap.values())
      .filter(t => t.isActive !== false)
      .map(t => `<option value="${escapeHtml(t.id)}" ${t.id === AgendaGeralState.teacherId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`)
  ).join('');

  const modeToggleHtml = AGENDA_GERAL_VIEW_MODES.map(m => `
    <span class="chip ${m.id === mode ? 'chip-active' : ''}" onclick="setAgendaGeralViewMode('${m.id}')">${m.label}</span>
  `).join('');

  const periodChipsHtml = MINHA_AGENDA_FILTERS.map(f => `
    <span class="chip ${f.id === AgendaGeralState.filter ? 'chip-active' : ''}"
          onclick="setAgendaGeralFilter('${f.id}')">${f.label}</span>
  `).join('');

  // Só monta (e só chama isoDateInputValue) quando o modo é 'day' — em modo
  // 'period' selectedDate continua null, e isoDateInputValue(null) quebra
  // (achado ao testar em staging: template literal avalia sempre, mesmo
  // quando o ternário abaixo descarta o resultado).
  const dayNavHtml = mode !== 'day' ? '' : `
    <div class="agenda-geral-daynav">
      <button type="button" class="btn btn-outline btn-sm" onclick="shiftAgendaGeralDate(-1)" title="Dia anterior">◀</button>
      <input type="date" class="input" value="${isoDateInputValue(AgendaGeralState.selectedDate)}" onchange="setAgendaGeralDate(this.value)">
      <button type="button" class="btn btn-outline btn-sm" onclick="shiftAgendaGeralDate(1)" title="Dia seguinte">▶</button>
    </div>
  `;

  page.innerHTML = `
    <div class="page-toolbar">
      <div class="lhs">
        <h2>AGENDA GERAL</h2>
        <div class="count">${total} aula${total === 1 ? '' : 's'} · ${countLabel}</div>
      </div>
      <div class="rhs agenda-geral-toolbar-controls">
        <div class="minha-agenda-filters">${modeToggleHtml}</div>
        ${mode === 'day'
          ? dayNavHtml
          : `<div class="minha-agenda-filters">${periodChipsHtml}</div>`
        }
      </div>
    </div>

    <div class="agenda-geral-filters">
      <div class="agenda-geral-units">
        <span class="filter-label">Unidades:</span>
        ${AgendaState.units.map(u => `
          <span class="chip ${AgendaGeralState.unitIds.includes(u.id) ? 'chip-active' : ''}"
                onclick="toggleAgendaGeralUnit('${escapeHtml(u.id)}')">${escapeHtml(u.name || u.id)}</span>
        `).join('')}
      </div>
      <div class="agenda-geral-selects">
        <label class="agenda-unit-select"><span>Professor:</span>
          <select onchange="setAgendaGeralTeacher(this.value)">${teacherOpts}</select></label>
        <label class="agenda-unit-select"><span>Modalidade:</span>
          <select onchange="setAgendaGeralModality(this.value)">${modOpts}</select></label>
        ${(AgendaGeralState.teacherId || AgendaGeralState.modalityId)
          ? `<a href="#" onclick="limparFiltrosAgendaGeral();return false;" style="font-size:12px;color:var(--orange);">limpar filtros</a>` : ''}
      </div>
    </div>

    ${total === 0
      ? renderAgendaGeralVazio(mode)
      : (mode === 'day'
          ? renderAgendaGeralDayGrid(AgendaGeralState.classes)
          : renderAgendaGeralList(AgendaGeralState.classes))
    }
  `;
}

function limparFiltrosAgendaGeral() {
  AgendaGeralState.teacherId = '';
  AgendaGeralState.modalityId = '';
  loadAgendaGeral();
}

function setAgendaGeralViewMode(mode) {
  if (AgendaGeralState.viewMode === mode) return;
  AgendaGeralState.viewMode = mode;
  if (mode === 'day' && !AgendaGeralState.selectedDate) {
    AgendaGeralState.selectedDate = new Date();
    AgendaGeralState.selectedDate.setHours(0, 0, 0, 0);
  }
  loadAgendaGeral();
}

function setAgendaGeralDate(isoDate) {
  // new Date("YYYY-MM-DD") é interpretado como UTC meia-noite pelo motor JS,
  // que em fuso BR (UTC-3) vira o dia anterior às 21h — por isso monta com
  // partes soltas em vez de passar a string direto pro construtor.
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return;
  AgendaGeralState.selectedDate = new Date(y, m - 1, d);
  loadAgendaGeral();
}

function shiftAgendaGeralDate(deltaDays) {
  const d = new Date(AgendaGeralState.selectedDate);
  d.setDate(d.getDate() + deltaDays);
  AgendaGeralState.selectedDate = d;
  loadAgendaGeral();
}

/** "YYYY-MM-DD" em horário local, pro value do <input type="date">. */
function isoDateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function setAgendaGeralFilter(filter) {
  if (AgendaGeralState.filter === filter) return;
  AgendaGeralState.filter = filter;
  loadAgendaGeral();
}

function toggleAgendaGeralUnit(unitId) {
  const idx = AgendaGeralState.unitIds.indexOf(unitId);
  if (idx >= 0) AgendaGeralState.unitIds.splice(idx, 1);
  else AgendaGeralState.unitIds.push(unitId);
  if (AgendaGeralState.unitIds.length === 0) {
    toast('Selecione ao menos uma unidade.', 'error');
    AgendaGeralState.unitIds.push(unitId);
    return;
  }
  loadAgendaGeral();
}

function setAgendaGeralModality(modalityId) {
  AgendaGeralState.modalityId = modalityId;
  loadAgendaGeral();
}

function setAgendaGeralTeacher(teacherId) {
  AgendaGeralState.teacherId = teacherId;
  loadAgendaGeral();
}

// Tela vazia por causa do FILTRO não pode dizer "não tem aula" — quem filtrou
// por um professor que não dá aula naquele dia acha que o sistema perdeu a
// agenda dele. Mesmo padrão da Grade de Horários.
function renderAgendaGeralVazio(mode) {
  const filtrando = !!(AgendaGeralState.teacherId || AgendaGeralState.modalityId);
  const onde = mode === 'day' ? 'nesse dia' : 'no período selecionado';

  if (!filtrando) {
    return `<div class="empty-state-small" style="padding:48px 24px;">Nenhuma aula ${onde}.</div>`;
  }

  const teacher = AgendaGeralState.teacherId ? AgendaState.teachersMap.get(AgendaGeralState.teacherId) : null;
  const mod = AgendaGeralState.modalityId ? AgendaState.modalitiesMap.get(AgendaGeralState.modalityId) : null;
  const alvo = [teacher && teacher.name, mod && mod.name].filter(Boolean).join(' · ');

  return `
    <div class="empty-state-small" style="padding:48px 24px;">
      Nenhuma aula ${onde} para <strong>${escapeHtml(alvo)}</strong>.<br>
      <a href="#" onclick="limparFiltrosAgendaGeral();return false;" style="color:var(--orange);">limpar filtros</a>
      para ver todas as aulas.
    </div>
  `;
}

// ── Opção A — lista organizada (semana/mês) ─────────────────────────────
// Dia como marco grande, aulas agrupadas por unidade dentro do dia, selo de
// estado só quando foge do normal. Decisão do Rodrigo, 12/08/2026.
function renderAgendaGeralList(classes) {
  const groups = new Map();
  classes.forEach(c => {
    const d = c.scheduledDate.toDate ? c.scheduledDate.toDate() : new Date(c.scheduledDate);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (!groups.has(key)) groups.set(key, { date: d, items: [] });
    groups.get(key).items.push(c);
  });

  return `
    <div class="geral-list">
      ${Array.from(groups.values()).map(g => {
        const unitGroups = groupClassesByUnit(g.items, AgendaState.units);
        const numUnidades = unitGroups.length;
        return `
          <div class="geral-day-head">
            <span class="geral-day-num">${String(g.date.getDate()).padStart(2, '0')}</span>
            <span class="geral-day-wd">${ProfHelpers.WEEKDAY_LABEL[g.date.getDay()]}</span>
            <span class="geral-day-count">${g.items.length} aula${g.items.length === 1 ? '' : 's'} · ${numUnidades} unidade${numUnidades === 1 ? '' : 's'}</span>
          </div>
          ${unitGroups.map(ug => `
            <div class="geral-unit-head">${escapeHtml(ug.unit.name || ug.unit.id)}</div>
            ${ug.items.map(renderAgendaGeralListRow).join('')}
          `).join('')}
        `;
      }).join('')}
    </div>
  `;
}

function renderAgendaGeralListRow(cls) {
  const teacher = AgendaState.teachersMap.get(cls.teacherId);
  const modColor = colorForModality(cls.modalityId);
  const nome = classDisplayName(cls) || '—';
  const abnormal = isAbnormalStatus(cls.status);
  const sColor = ProfHelpers.CLASS_STATUS_COLOR[cls.status] || ProfHelpers.CLASS_STATUS_COLOR.prevista;
  const sLabel = ProfHelpers.CLASS_STATUS_LABEL[cls.status] || cls.status;

  return `
    <div class="geral-row" onclick="openClassModal('${cls.id}')">
      <span class="geral-row-time">${cls.startTime}<small>até ${cls.endTime}</small></span>
      <span class="geral-row-who">
        <span class="geral-row-teacher">${escapeHtml(teacher ? shortenName(teacher.name) : '—')}</span>
        <span class="geral-row-mod" style="background:${modColor.bg};color:${modColor.text};">${escapeHtml(nome)}</span>
      </span>
      <span class="geral-row-status">
        ${abnormal ? `<span class="class-status-badge" style="background:${sColor.bg};color:${sColor.text};border:1px solid ${sColor.border};">${sLabel}</span>` : ''}
      </span>
    </div>
  `;
}

// ── Opção B — grade por horário × unidade (dia específico) ──────────────
// Mesma linguagem visual da Grade de Horários, mas por data real em vez de
// semana-modelo. Decisão do Rodrigo, 12/08/2026.
function renderAgendaGeralDayGrid(classes) {
  const grid = buildDayGrid(classes, AgendaGeralState.unitIds, AgendaState.units);

  if (grid.times.length === 0) {
    return renderAgendaGeralVazio('day');
  }

  return `
    <div class="geral-daygrid-wrap">
      <div class="geral-daygrid" style="grid-template-columns:76px repeat(${grid.units.length}, minmax(160px,1fr));">
        <div class="geral-daygrid-head"></div>
        ${grid.units.map(u => `<div class="geral-daygrid-head">${escapeHtml(u.name || u.id)}</div>`).join('')}
        ${grid.rows.map(row => `
          <div class="geral-daygrid-time">${row.time}</div>
          ${grid.units.map(u => {
            const items = row.cellsByUnit[u.id] || [];
            if (items.length === 0) return `<div class="geral-daygrid-cell"><span class="geral-daygrid-empty">sem aula</span></div>`;
            return `<div class="geral-daygrid-cell">${items.map(renderAgendaGeralDayGridCard).join('')}</div>`;
          }).join('')}
        `).join('')}
      </div>
    </div>
  `;
}

function renderAgendaGeralDayGridCard(cls) {
  const teacher = AgendaState.teachersMap.get(cls.teacherId);
  const modColor = colorForModality(cls.modalityId);
  const nome = classDisplayName(cls) || '—';
  return `
    <div class="geral-daygrid-card" style="background:${modColor.bg};border-left:3px solid ${modColor.border};" onclick="openClassModal('${cls.id}')">
      <div class="geral-daygrid-card-mod" style="color:${modColor.text};">${escapeHtml(nome)}</div>
      <div class="geral-daygrid-card-who">${escapeHtml(teacher ? shortenName(teacher.name) : '—')}</div>
    </div>
  `;
}

// ════════════════════════════════════════════════════════════════════════
// SPRINT 3b — SUBSTITUIÇÕES + COBERTURA (modais + handlers)
// ════════════════════════════════════════════════════════════════════════

// Quem pode registrar troca nesta aula. A regra mora no módulo puro — a tela só
// pergunta. Antes exigia ser o titular, e por isso a Camila, que deu a aula do
// Theo, não tinha botão nenhum (21/08/2026).
function classModalCanRequestSub(cls) {
  return SubstitutionFlow.podeRegistrar(cls, {
    teacherId: getCurrentProfessorId(),
    isGestao: isAdminGestao() || isSupervisao(),
  }).ok;
}

/** É a aula do próprio professor logado? Decide qual botão mostrar. */
function classModalSouTitular(cls) {
  const myProfId = getCurrentProfessorId();
  return !!myProfId && cls.teacherId === myProfId;
}

// Wraper pra estender o footer do classModal com botões da Sprint 3b
// (chamado dentro de openClassModal de Sprint 3a)
function injectClassModalActions(cls) {
  const footer = document.querySelector('#classModal .form-actions');
  if (!footer) return;
  // Remove botões antigos da Sprint 3b se já presentes
  footer.querySelectorAll('[data-sprint-3b]').forEach(el => el.remove());

  if (classModalCanRequestSub(cls)) {
    const ehGestao = isAdminGestao() || isSupervisao();
    const souTitular = classModalSouTitular(cls);
    const botoes = [];

    if (ehGestao) {
      botoes.push(['⇄ Trocar professor', () => openSubstitutionModal(cls.id, 'gestao')]);
      // Supervisor que também dá aula continua precisando pedir cobertura pra
      // aula PRÓPRIA — "Trocar professor" é a ferramenta de gestão, não serve
      // pra ele avisar que vai faltar (achado em revisão, 22/08/2026).
      if (souTitular) {
        botoes.push(['🆘 Pedir cobertura aberta', () => openCoverageModal(cls.id)]);
      }
    } else if (souTitular) {
      botoes.push(['🔄 Pedir substituição', () => openSubstitutionModal(cls.id, 'titular')]);
      botoes.push(['🆘 Pedir cobertura aberta', () => openCoverageModal(cls.id)]);
    } else {
      botoes.push(['✋ Fui eu que dei essa aula', () => openSubstitutionModal(cls.id, 'substituto')]);
    }

    // Insere antes do botão Salvar (ou Fechar se não tem Salvar)
    const saveBtn = document.getElementById('classSaveBtn');
    botoes.forEach(([texto, acao]) => {
      const b = document.createElement('button');
      b.className = 'btn btn-outline';
      b.setAttribute('data-sprint-3b', 'true');
      b.textContent = texto;
      b.onclick = acao;
      if (saveBtn) footer.insertBefore(b, saveBtn); else footer.appendChild(b);
    });
  }
}

// ─── Modal de Substituição Direta ────────────────────────────────────────
const SubstitutionFormState = { classId: null, lado: 'titular' };

// Troca só o texto do rótulo, preservando o marcador de obrigatório que vive
// num <span class="req"> dentro do <label> (professores.html:2863) — trocar o
// textContent inteiro apagava o "*" depois da primeira abertura do modal.
function setLabelTexto(el, texto) {
  if (!el) return;
  const marcador = el.querySelector('.req');
  el.textContent = texto + ' ';
  if (marcador) el.appendChild(marcador);
}

/**
 * @param {string} classId
 * @param {'titular'|'substituto'|'gestao'} lado - quem está registrando
 */
function openSubstitutionModal(classId, lado = 'titular') {
  // Fecha class modal pra evitar empilhamento confuso
  closeClassModal();

  const cls = findClassAnywhere(classId);
  if (!cls) { toast('Aula não encontrada.', 'error'); return; }
  SubstitutionFormState.classId = classId;
  SubstitutionFormState.lado = lado;

  const aulaDate = cls.scheduledDate.toDate ? cls.scheduledDate.toDate() : new Date(cls.scheduledDate);
  const isPast = aulaDate < new Date();
  const titular = AgendaState.teachersMap.get(cls.teacherId);
  const meuProfId = getCurrentProfessorId();

  const modal = document.getElementById('substitutionModal');
  if (!modal) return;
  const titulo = lado === 'substituto'
    ? `Fui eu que dei esta aula — ${ProfHelpers.formatDateBR(cls.scheduledDate)}`
    : lado === 'gestao'
      ? `Trocar professor — ${ProfHelpers.formatDateBR(cls.scheduledDate)}`
      : `Pedir substituição — ${ProfHelpers.formatDateBR(cls.scheduledDate)}`;
  document.getElementById('substitutionModalTitle').textContent = titulo;
  document.getElementById('substitutionModalError').textContent = '';
  document.getElementById('substitutionRetroactiveBox').style.display = isPast ? '' : 'none';

  const sel = document.getElementById('substituteSelect');
  const label = document.getElementById('substituteSelectLabel');

  if (lado === 'substituto') {
    // Quem registra JÁ é o professor da aula — não há o que escolher.
    if (label) setLabelTexto(label, 'Quem deu a aula');
    sel.innerHTML = `<option value="${escapeHtml(meuProfId)}" selected>Você (no lugar de ${escapeHtml(titular ? titular.name : '—')})</option>`;
    sel.disabled = true;
  } else {
    if (label) setLabelTexto(label, lado === 'gestao' ? 'Quem deu a aula de verdade' : 'Quem vai cobrir');
    sel.disabled = false;
    // Modalidade filtra quem PODE assumir uma aula futura. Para registrar um fato
    // já acontecido, a gestão vê todo mundo — senão a correção fica impossível
    // quando quem cobriu não tinha a modalidade no cadastro.
    const todos = Array.from(AgendaState.teachersMap.values())
      .filter(t => t.isActive !== false)
      .filter(t => t.id !== cls.teacherId);
    const eligible = lado === 'gestao'
      ? todos
      : todos.filter(t => Array.isArray(t.modalityIds) && t.modalityIds.includes(cls.modalityId));
    sel.innerHTML = eligible.length === 0
      ? '<option value="" disabled selected>Nenhum professor habilitado nesta modalidade</option>'
      : ['<option value="">— escolha —</option>'].concat(
          eligible.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)} · ${escapeHtml(t.type || '')}</option>`)
        ).join('');
  }

  document.getElementById('substitutionReason').value = '';
  const btn = document.getElementById('substitutionSaveBtn');
  if (btn) btn.textContent = lado === 'gestao' ? 'Trocar e confirmar' : 'Enviar para confirmação';
  modal.classList.add('open');
}

function closeSubstitutionModal() {
  const modal = document.getElementById('substitutionModal');
  if (modal) modal.classList.remove('open');
  SubstitutionFormState.classId = null;
}

async function saveSubstitution() {
  const errEl = document.getElementById('substitutionModalError');
  errEl.textContent = '';

  const classId = SubstitutionFormState.classId;
  if (!classId) { errEl.textContent = 'Estado inválido — feche e reabra.'; return; }

  const substituteTeacherId = document.getElementById('substituteSelect').value;
  const reason = document.getElementById('substitutionReason').value.trim();

  if (!substituteTeacherId) { errEl.textContent = 'Escolha um substituto.'; return; }

  // Dica barata a partir do que já está em memória — o serviço trata como sugestão
  // e resolve sozinho via /teachers quando ausente ou desatualizada.
  const substTeacher = AgendaState.teachersMap.get(substituteTeacherId);
  const substituteUserId = substTeacher && substTeacher.userId ? substTeacher.userId : null;

  const btn = document.getElementById('substitutionSaveBtn');
  btn.disabled = true; btn.textContent = 'Enviando…';

  const res = await SubstitutionService.create({
    classId, substituteTeacherId, substituteUserId, reason,
    registradoPor: SubstitutionFormState.lado,
  });

  if (!res.success) {
    btn.disabled = false;
    btn.textContent = SubstitutionFormState.lado === 'gestao' ? 'Trocar e confirmar' : 'Enviar para confirmação';
    errEl.textContent = res.error;
    return;
  }

  // A gestão registrando já cumpriu o degrau dela: homologa na sequência. O
  // botão continua desabilitado até esse segundo passo terminar — reabilitar
  // antes deixava um segundo clique disparar outro `create` e esbarrar na
  // trava de pedido duplicado.
  if (SubstitutionFormState.lado === 'gestao' && res.data && res.data.id) {
    const hom = await SubstitutionService.homologar(res.data.id, reason);
    btn.disabled = false;
    btn.textContent = 'Trocar e confirmar';
    if (!hom.success) {
      // O registro (create) já foi salvo — só a homologação falhou. Dizer
      // apenas o erro da homologação faz o usuário achar que nada foi salvo,
      // e tentar de novo esbarra em "já existe um pedido em aberto", que
      // parece um bug diferente.
      errEl.textContent = 'A troca foi registrada, mas a confirmação automática falhou ('
        + hom.error + '). Confirme pela Caixa de entrada.';
      return;
    }
    toast('Professor trocado. Os dois foram avisados.', 'success');
  } else {
    btn.disabled = false;
    btn.textContent = 'Enviar para confirmação';
    if (!res.data || !res.data.substituteUserId) {
      toast('Registrado. O outro professor ainda não tem login vinculado — a gestão confirma pela tela.', 'info', 6000);
    } else {
      toast('Registrado. Agora o outro professor confirma, e depois a gestão.', 'success', 5000);
    }
  }
  closeSubstitutionModal();
}

// ─── Modal de Cobertura Aberta ──────────────────────────────────────────
const CoverageFormState = { classId: null };

function openCoverageModal(classId) {
  closeClassModal();
  const cls = findClassAnywhere(classId);
  if (!cls) { toast('Aula não encontrada.', 'error'); return; }
  CoverageFormState.classId = classId;

  const aulaDate = cls.scheduledDate.toDate ? cls.scheduledDate.toDate() : new Date(cls.scheduledDate);
  const isPast = aulaDate < new Date();
  const mod = AgendaState.modalitiesMap.get(cls.modalityId);

  const modal = document.getElementById('coverageModal');
  document.getElementById('coverageModalTitle').textContent =
    `Pedir cobertura aberta — ${ProfHelpers.formatDateBR(cls.scheduledDate)}`;
  document.getElementById('coverageModalError').textContent = '';
  document.getElementById('coverageRetroactiveBox').style.display = isPast ? '' : 'none';
  document.getElementById('coverageInfo').textContent =
    `Aula: ${mod ? mod.name : 'modalidade'} · ${cls.startTime}–${cls.endTime}. Será notificado a todos os professores habilitados em ${mod ? mod.name : 'na modalidade'}.`;
  document.getElementById('coverageReason').value = '';
  modal.classList.add('open');
}

function closeCoverageModal() {
  const modal = document.getElementById('coverageModal');
  if (modal) modal.classList.remove('open');
  CoverageFormState.classId = null;
}

async function saveCoverage() {
  const errEl = document.getElementById('coverageModalError');
  errEl.textContent = '';
  const classId = CoverageFormState.classId;
  if (!classId) { errEl.textContent = 'Estado inválido.'; return; }
  const reason = document.getElementById('coverageReason').value.trim();

  const btn = document.getElementById('coverageSaveBtn');
  btn.disabled = true; btn.textContent = 'Enviando…';

  const res = await CoverageService.request({ classId, reason });

  btn.disabled = false; btn.textContent = 'Pedir cobertura';

  if (!res.success) { errEl.textContent = res.error; return; }
  toast('Cobertura aberta criada. Os professores aptos foram notificados.', 'success', 4500);
  closeCoverageModal();
}

// Procura uma aula em qualquer state local (Minha Agenda / Agenda Geral)
function findClassAnywhere(classId) {
  return (MinhaAgendaState.classes.find(c => c.id === classId)
      || AgendaGeralState.classes.find(c => c.id === classId)
      || null);
}

// ─── Modal de Inbox de Pedidos ──────────────────────────────────────────
const InboxState = { subs: [], covs: [], activeTab: 'subs', isMgmtView: false };

async function openInboxModal() {
  const modal = document.getElementById('inboxModal');
  if (!modal) return;
  modal.classList.add('open');
  document.getElementById('inboxTabSubs').onclick = () => switchInboxTab('subs');
  document.getElementById('inboxTabCovs').onclick = () => switchInboxTab('covs');
  await loadInboxData();
}

function closeInboxModal() {
  const modal = document.getElementById('inboxModal');
  if (modal) modal.classList.remove('open');
}

async function loadInboxData() {
  document.getElementById('inboxList').innerHTML = '<div class="loading"><div class="spinner"></div> Carregando…</div>';
  // Dados de referência p/ os cards (nome do solicitante, modalidade). O professor
  // pode abrir o inbox sem ter passado pela grade, então o AgendaState pode estar vazio.
  if (!AgendaState.teachersMap.size) {
    const tr = await TeacherService.list();
    if (tr.success) AgendaState.teachersMap = new Map(tr.data.map(t => [t.id, t]));
  }
  if (!AgendaState.modalitiesMap.size) {
    const mr = await ModalityService.list();
    if (mr.success) AgendaState.modalitiesMap = new Map(mr.data.map(m => [m.id, m]));
  }
  const uid = AppState.currentUser.uid;
  const myProfId = getCurrentProfessorId();

  // Pedidos direcionados a mim. Gestão vê a fila de homologação — quem já
  // está confirmado pelo outro professor e só falta o OK dela. Pedido ainda
  // esperando resposta de um professor não trava nada aqui; quem avisa disso
  // é a lista de pendências do fechamento (SubstitutionFlow.pendenciasDoFechamento).
  InboxState.isMgmtView = isAdminGestao() || isSupervisao();
  const subsRes = InboxState.isMgmtView
    ? await SubstitutionService.listAguardandoGestao()
    : await SubstitutionService.listPendingForTeacher(myProfId);
  InboxState.subs = subsRes.success ? subsRes.data : [];

  // Coberturas abertas aptas à minha modalidade
  let myModalityIds = [];
  if (myProfId) {
    const me = AgendaState.teachersMap.get(myProfId);
    if (me && Array.isArray(me.modalityIds)) myModalityIds = me.modalityIds;
  }
  const covsRes = await CoverageService.listOpenForTeacher(myModalityIds);
  // Filtra coberturas que EU criei (não faria sentido pegar minha própria)
  InboxState.covs = covsRes.success
    ? covsRes.data.filter(c => c.requestingUserId !== uid)
    : [];

  // Atualiza contadores das tabs
  document.getElementById('inboxTabSubsCount').textContent = InboxState.subs.length;
  document.getElementById('inboxTabCovsCount').textContent = InboxState.covs.length;
  renderInboxList();
}

function switchInboxTab(tab) {
  InboxState.activeTab = tab;
  document.getElementById('inboxTabSubs').classList.toggle('active', tab === 'subs');
  document.getElementById('inboxTabCovs').classList.toggle('active', tab === 'covs');
  renderInboxList();
}

function renderInboxList() {
  const list = document.getElementById('inboxList');
  if (!list) return;
  if (InboxState.activeTab === 'subs') {
    if (InboxState.subs.length === 0) {
      list.innerHTML = `<div class="empty-state-small" style="padding:24px;">${
        InboxState.isMgmtView
          ? 'Nenhuma troca esperando homologação da gestão.'
          : 'Nenhum pedido pendente para você.'
      }</div>`;
      return;
    }
    list.innerHTML = InboxState.subs.map(renderInboxSubItem).join('');
  } else {
    if (InboxState.covs.length === 0) {
      list.innerHTML = '<div class="empty-state-small" style="padding:24px;">Nenhuma oportunidade de cobertura no momento.</div>';
      return;
    }
    list.innerHTML = InboxState.covs.map(renderInboxCovItem).join('');
  }
}

// Formata "quando" de um pedido (sub/cobertura) a partir do snapshot da aula,
// reusando o mesmo formato da notificação. Fallback: classId (pedidos antigos sem snapshot).
function formatReqWhen(item) {
  if (item.classDate && item.classDate.toDate) {
    const base = buildSubstitutionNotifBody({ scheduledDate: item.classDate, startTime: item.classStartTime, endTime: item.classEndTime });
    const mod = AgendaState.modalitiesMap.get(item.classModalityId || item.modalityId);
    return '📅 ' + escapeHtml(base) + (mod ? ' · ' + escapeHtml(mod.name) : '');
  }
  return 'Aula: <code>' + escapeHtml(item.classId) + '</code>';
}

function renderInboxSubItem(s) {
  const dono = AgendaState.teachersMap.get(s.requestingTeacherId);
  const cobriu = AgendaState.teachersMap.get(s.substituteTeacherId);
  const retro = s.wasRetroactive ? '<span class="badge-retro">retroativo</span>' : '';
  // Quem está vendo o card pode ser qualquer um dos dois lados — o titular que
  // vai perder a aula, ou quem está sendo apontado como tendo coberto. Contar
  // a história a partir de "dono" sempre deixava o titular lendo "aula de
  // [ele mesmo]" quando era o OUTRO lado que tinha registrado o pedido.
  const souOSubstituto = s.substituteTeacherId === getCurrentProfessorId();
  const titulo = InboxState.isMgmtView
    ? `⏳ ${escapeHtml(cobriu ? cobriu.name : '—')} deu a aula de ${escapeHtml(dono ? dono.name : '—')}`
    : souOSubstituto
      ? `🔄 Troca de professor · aula de ${escapeHtml(dono ? dono.name : '—')}`
      : `✋ ${escapeHtml(cobriu ? cobriu.name : '—')} diz que deu esta sua aula`;
  const acoes = InboxState.isMgmtView
    ? `<button class="btn btn-outline btn-sm" onclick="handleSubReject('${s.id}')">Recusar</button>
       <button class="btn btn-primary btn-sm" onclick="handleSubHomologar('${s.id}')">Confirmar troca</button>`
    : souOSubstituto
      ? `<button class="btn btn-outline btn-sm" onclick="handleSubReject('${s.id}')">Não fui eu</button>
         <button class="btn btn-primary btn-sm" onclick="handleSubAccept('${s.id}')">Confirmar</button>`
      : `<button class="btn btn-outline btn-sm" onclick="handleSubReject('${s.id}')">Não foi ele(a)</button>
         <button class="btn btn-primary btn-sm" onclick="handleSubAccept('${s.id}')">Confirmar</button>`;
  return `
    <div class="inbox-item">
      <div class="inbox-item-header">
        <span class="inbox-item-title">${titulo}</span>
        ${retro}
      </div>
      <div class="inbox-item-body">${escapeHtml(s.reason || '(sem motivo informado)')}</div>
      <div class="inbox-item-meta">${formatReqWhen(s)}</div>
      <div class="inbox-item-actions">${acoes}</div>
    </div>
  `;
}

function renderInboxCovItem(c) {
  const requester = AgendaState.teachersMap.get(c.requestingTeacherId);
  const requesterName = requester ? requester.name : c.requestingTeacherId;
  const mod = AgendaState.modalitiesMap.get(c.modalityId);
  const retro = c.wasRetroactive ? '<span class="badge-retro">retroativo</span>' : '';
  return `
    <div class="inbox-item">
      <div class="inbox-item-header">
        <span class="inbox-item-title">🆘 Cobertura — ${escapeHtml(mod ? mod.name : '—')}</span>
        ${retro}
      </div>
      <div class="inbox-item-body">
        Aberta por: <strong>${escapeHtml(requesterName)}</strong><br>
        ${escapeHtml(c.reason || '(sem motivo)')}
      </div>
      <div class="inbox-item-meta">${formatReqWhen(c)}</div>
      <div class="inbox-item-actions">
        <button class="btn btn-primary btn-sm" onclick="handleCovPick('${c.id}')">Quero cobrir</button>
      </div>
    </div>
  `;
}

async function handleSubAccept(subId) {
  const note = prompt('Quer deixar alguma observação? (opcional)') || '';
  const res = await SubstitutionService.confirmar(subId, note);
  if (!res.success) { toast('Erro: ' + res.error, 'error'); return; }
  toast('Confirmado. Agora falta a gestão dar o OK.', 'success', 5000);
  await loadInboxData();
  await refreshNotifBell();
}

async function handleSubHomologar(subId) {
  if (!confirm('Confirmar a troca? A aula passa para o outro professor e o pagamento acompanha.')) return;
  const res = await SubstitutionService.homologar(subId, '');
  if (!res.success) { toast('Erro: ' + res.error, 'error'); return; }
  toast('Troca confirmada. A aula já está no nome certo.', 'success');
  await loadInboxData();
  await refreshNotifBell();
}

async function handleSubReject(subId) {
  const note = prompt('Motivo da recusa (opcional):') || '';
  const res = await SubstitutionService.reject(subId, note);
  if (!res.success) { toast('Erro: ' + res.error, 'error'); return; }
  toast('Recusado.', 'info');
  await loadInboxData();
  await refreshNotifBell();
}

async function handleCovPick(covId) {
  const myProfId = getCurrentProfessorId();
  if (!myProfId) { toast('Você precisa estar vinculado a um cadastro de professor.', 'error'); return; }
  if (!confirm('Confirma que quer cobrir esta aula?')) return;
  const res = await CoverageService.pick({
    coverageId: covId,
    pickerTeacherId: myProfId,
    pickerUserId: AppState.currentUser.uid,
  });
  if (!res.success) { toast('Erro: ' + res.error, 'error', 5000); return; }
  toast('Cobertura aceita. A aula agora é sua.', 'success');
  await loadInboxData();
  await refreshNotifBell();
}

// ─── Modal de Histórico de Notificações (aba "Lidas") ───────────────────
async function openNotifHistoryModal() {
  const modal = document.getElementById('notifHistoryModal');
  if (!modal) return;
  modal.classList.add('open');
  const list = document.getElementById('notifHistoryList');
  list.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando…</div>';
  const res = await NotificationService.listRead(AppState.currentUser.uid, 50);
  if (!res.success) {
    list.innerHTML = `<div class="empty-state-small">${escapeHtml(res.error)}</div>`;
    return;
  }
  if (res.data.length === 0) {
    list.innerHTML = '<div class="empty-state-small" style="padding:24px;">Nenhuma notificação lida ainda.</div>';
    return;
  }
  list.innerHTML = res.data.map(n => {
    const meta = (ProfHelpers.NOTIF_TYPE_META && ProfHelpers.NOTIF_TYPE_META[n.type]) || { icon: '🔔' };
    const ts = n.readAt && n.readAt.toDate ? n.readAt.toDate() : null;
    const ago = ts ? formatRelativeTime(ts) : '';
    return `
      <div class="notif-item is-read">
        <div class="notif-icon">${meta.icon}</div>
        <div class="notif-text">
          <div class="notif-title">${escapeHtml(n.title || '')}</div>
          <div class="notif-body">${escapeHtml(n.body || '')}</div>
          <div class="notif-time">lida ${ago}</div>
        </div>
      </div>
    `;
  }).join('');
}

function closeNotifHistoryModal() {
  const modal = document.getElementById('notifHistoryModal');
  if (modal) modal.classList.remove('open');
}

// ─── Hook: estende openClassModal pra injetar botões de substituição ───
// Sobrescreve openClassModal preservando lógica original via patching
(function patchOpenClassModal() {
  const original = window.openClassModal;
  if (typeof original !== 'function') return;
  window.openClassModal = async function patched(classId) {
    await original(classId);
    const cls = findClassAnywhere(classId);
    if (cls) injectClassModalActions(cls);
  };
})();

console.log('[CrossTainer Professores] professores-agenda.js carregado · Sprint 2 + Sprint 3a + Sprint 3b (agenda-geral + substituições + cobertura + inbox)');
