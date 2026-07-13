// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Módulo Professores · Tela de Agenda Semanal (Sprint 2)
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

function colorForModality(modalityId) {
  if (!modalityId) return { bg: 'var(--surface3)', border: 'var(--border)', text: 'var(--text2)' };
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
        <h2>AGENDA SEMANAL</h2>
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
        <div class="lhs"><h2>AGENDA SEMANAL</h2></div>
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

  const visibleSlots = AgendaState.showInactive
    ? AgendaState.slots
    : AgendaState.slots.filter(s => s.isActive !== false);

  page.innerHTML = `
    ${renderAgendaToolbar(visibleSlots.length)}
    ${renderWeeklyGrid(visibleSlots)}
  `;
}

function renderAgendaToolbar(visibleCount) {
  const opts = AgendaState.units.map(u => `
    <option value="${escapeHtml(u.id)}" ${u.id === AgendaState.unitId ? 'selected' : ''}>
      ${escapeHtml(u.name || u.id)}
    </option>
  `).join('');

  const totalInactive = AgendaState.slots.filter(s => s.isActive === false).length;

  return `
    <div class="page-toolbar">
      <div class="lhs">
        <h2>AGENDA SEMANAL</h2>
        <div class="count">${visibleCount} slot${visibleCount === 1 ? '' : 's'} ativo${visibleCount === 1 ? '' : 's'}</div>
      </div>
      <div class="rhs agenda-toolbar-rhs">
        <label class="agenda-unit-select">
          <span>Unidade:</span>
          <select onchange="onUnitChange(this.value)">${opts}</select>
        </label>
        <label class="agenda-toggle" title="${totalInactive} slot${totalInactive === 1 ? '' : 's'} inativo${totalInactive === 1 ? '' : 's'}">
          <input type="checkbox" ${AgendaState.showInactive ? 'checked' : ''} onchange="toggleShowInactive(this.checked)">
          Mostrar inativos${totalInactive > 0 ? ` (${totalInactive})` : ''}
        </label>
        <button class="btn btn-primary btn-sm" onclick="openSlotModal(null)">+ Novo slot</button>
      </div>
    </div>
  `;
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

function shortenName(fullName) {
  if (!fullName) return '—';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return parts[0][0] + '. ' + parts[parts.length - 1];
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
                   // EDIÇÃO mantém só [slot.weekday] e não permite alterar.
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
  SlotFormState.weekdays = editing ? [editing.weekday] : [1];

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
    // Em edição: só o weekday original é interativo; os outros ficam disabled
    const isDisabled = isEditing && !isSelected;
    const cls = ['chip-toggle'];
    if (isSelected) cls.push('selected');
    if (isDisabled) cls.push('chip-disabled');
    const onClick = isDisabled ? '' : `onclick="setSlotWeekday(${w})"`;
    const title = isDisabled
      ? 'Edição não permite alterar o dia. Crie um novo slot para outro dia.'
      : (isSelected ? 'Clique para remover' : 'Clique para adicionar');
    return `<span class="${cls.join(' ')}" data-weekday="${w}" ${onClick} title="${title}">${ProfHelpers.WEEKDAY_LABEL_SHORT[w]}</span>`;
  }).join('');

  // Hint dinâmico abaixo dos chips
  const hint = document.getElementById('slotWeekdayHint');
  if (hint) {
    if (isEditing) {
      hint.textContent = 'Edição: dia da semana fixo. Para criar em outro dia, feche e clique em "+ Novo slot".';
    } else {
      const n = SlotFormState.weekdays.length;
      hint.textContent = n === 0
        ? '⚠ Selecione ao menos um dia.'
        : n === 1
          ? '1 dia selecionado · clique em outros para criar em lote.'
          : `${n} dias selecionados · serão criados ${n} slots iguais.`;
    }
  }
}

function setSlotWeekday(w) {
  // Em edição, não permite alterar
  if (SlotFormState.editingId) return;
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
  const conflictsByDay = [];
  for (const w of SlotFormState.weekdays) {
    const trial = { ...baseSlotData, weekday: w };
    const conflicts = ProfHelpers.detectSlotConflict(
      trial,
      AgendaState.slots,
      SlotFormState.editingId   // ignora o próprio slot em caso de edição
    );
    if (conflicts.length > 0) {
      const c = conflicts[0];
      const tName = (() => {
        const t = AgendaState.teachersMap.get(c.teacherId);
        return t ? shortenName(t.name) : c.teacherId;
      })();
      conflictsByDay.push(
        `${ProfHelpers.WEEKDAY_LABEL_SHORT[w]} (${tName} ${c.startTime}–${c.endTime})`
      );
    }
  }
  if (conflictsByDay.length > 0) {
    errEl.textContent = conflictsByDay.length === 1
      ? `Conflito em ${conflictsByDay[0]}. Cancele ou ajuste horário.`
      : `Conflitos em ${conflictsByDay.length} dias: ${conflictsByDay.join(' · ')}.`;
    return;
  }

  // Salva
  const btn = document.getElementById('slotSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  let toastMsg;
  if (SlotFormState.editingId) {
    // EDIÇÃO: só 1 slot, weekday é o original
    const slotData = { ...baseSlotData, weekday: SlotFormState.weekdays[0] };
    const res = await ScheduleSlotService.update(SlotFormState.editingId, slotData);
    if (!res.success) {
      btn.disabled = false; btn.textContent = 'Salvar';
      errEl.textContent = res.error || 'Erro ao salvar.'; return;
    }
    toastMsg = 'Slot atualizado.';
    // Propagação opt-in: se o dia da semana ficou igual e algum campo propagável
    // mudou, oferece atualizar as aulas futuras "intocadas" desse slot.
    const oldSlot = AgendaState.slots.find(s => s.id === SlotFormState.editingId) || {};
    const novoWeekday = SlotFormState.weekdays[0];
    const mudouCampo = oldSlot.teacherId !== teacherId || oldSlot.modalityId !== modalityId
                    || oldSlot.startTime !== startTime || oldSlot.endTime !== endTime;
    if (oldSlot.weekday === novoWeekday && mudouCampo) {
      const novoSlot = { teacherId, modalityId, startTime, endTime, durationMinutes: endMin - startMin };
      const plan = await ClassService.propagateSlotEditPlan(SlotFormState.editingId, novoSlot);
      if (plan.success && plan.eligibleCount > 0
          && confirm(`Aplicar também às ${plan.eligibleCount} próximas aulas já criadas?`)) {
        const ap = await ClassService.propagateSlotEditApply(plan.updates);
        if (ap.success) toastMsg = `Slot atualizado. ${ap.updated} aula(s) futura(s) atualizada(s).`;
        else toast('Slot salvo, mas falhou ao propagar: ' + (ap.error || ''), 'error');
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
      // Mesmo com erro parcial, recarrega para refletir os criados
      await loadAgendaForUnit(AgendaState.unitId);
      return;
    }
    toastMsg = created.length === 1
      ? '1 slot criado.'
      : `${created.length} slots criados (${created.join(', ')}).`;
  }

  toast(toastMsg, 'success');
  closeSlotModal();
  await loadAgendaForUnit(AgendaState.unitId);
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

function renderClassCard(cls) {
  const mod = AgendaState.modalitiesMap.get(cls.modalityId);
  const unit = AgendaState.units.find(u => u.id === cls.unitId);
  const modName = mod ? mod.name : '⚠ modalidade não encontrada';
  const unitName = unit ? (unit.name || unit.id) : '⚠ unidade';
  const sColor = ProfHelpers.CLASS_STATUS_COLOR[cls.status] || ProfHelpers.CLASS_STATUS_COLOR.prevista;
  const sLabel = ProfHelpers.CLASS_STATUS_LABEL[cls.status] || cls.status;

  return `
    <div class="class-card" onclick="openClassModal('${cls.id}')"
         style="border-left:3px solid ${sColor.border};">
      <div class="class-card-time">
        ${cls.startTime}<span class="slot-time-sep">–</span>${cls.endTime}
      </div>
      <div class="class-card-info">
        <div class="class-card-modality">${escapeHtml(modName)}</div>
        <div class="class-card-unit">${escapeHtml(unitName)}</div>
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
async function openClassModal(classId) {
  const cls = MinhaAgendaState.classes.find(c => c.id === classId);
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
  `;

  // Form de edição (só admin/gestao/supervisao) + botão Salvar
  const editBlock = document.getElementById('classModalEditBlock');
  const saveBtn = document.getElementById('classSaveBtn');
  if (canEdit && !isLocked) {
    editBlock.style.display = '';
    if (saveBtn) saveBtn.style.display = '';
    document.getElementById('classNewStatus').value = cls.status;
    document.getElementById('classStatusNote').value = '';
  } else {
    editBlock.style.display = 'none';
    if (saveBtn) saveBtn.style.display = 'none';
  }

  const noteHint = document.getElementById('classModalReadOnlyHint');
  if (noteHint) {
    if (canEdit && isLocked) {
      noteHint.textContent = 'Esta aula está em mês fechado. Status não pode ser alterado.';
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

async function saveClassStatus() {
  const classId = MinhaAgendaState.selectedClassId;
  const errEl = document.getElementById('classModalError');
  errEl.textContent = '';
  if (!classId) { errEl.textContent = 'Estado inválido — feche e reabra.'; return; }

  const newStatus = document.getElementById('classNewStatus').value;
  const note = document.getElementById('classStatusNote').value.trim();

  const btn = document.getElementById('classSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  const res = await ClassService.updateStatus(classId, newStatus, note);

  btn.disabled = false;
  btn.textContent = 'Salvar';

  if (!res.success) {
    errEl.textContent = res.error || 'Erro ao salvar.';
    return;
  }
  toast('Status atualizado.', 'success');
  closeClassModal();
  await loadMinhaAgenda();
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
  filter: 'current_week',
  classes: [],
  loading: false,
};

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
  const { from, to } = getDateRangeForFilter(AgendaGeralState.filter);
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
  const filterLabel = MINHA_AGENDA_FILTERS.find(f => f.id === AgendaGeralState.filter)?.label || '';

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

  page.innerHTML = `
    <div class="page-toolbar">
      <div class="lhs">
        <h2>AGENDA GERAL</h2>
        <div class="count">${total} aula${total === 1 ? '' : 's'} · ${filterLabel}</div>
      </div>
      <div class="rhs minha-agenda-filters">
        ${MINHA_AGENDA_FILTERS.map(f => `
          <span class="chip ${f.id === AgendaGeralState.filter ? 'chip-active' : ''}"
                onclick="setAgendaGeralFilter('${f.id}')">${f.label}</span>
        `).join('')}
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
        <select onchange="setAgendaGeralModality(this.value)">${modOpts}</select>
        <select onchange="setAgendaGeralTeacher(this.value)">${teacherOpts}</select>
      </div>
    </div>

    ${total === 0
      ? `<div class="empty-state-small" style="padding:48px 24px;">Nenhuma aula nos filtros selecionados.</div>`
      : renderAgendaGeralGrouped(AgendaGeralState.classes)
    }
  `;
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

function renderAgendaGeralGrouped(classes) {
  const groups = new Map();
  classes.forEach(c => {
    const d = c.scheduledDate.toDate ? c.scheduledDate.toDate() : new Date(c.scheduledDate);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (!groups.has(key)) groups.set(key, { date: d, items: [] });
    groups.get(key).items.push(c);
  });
  return `
    <div class="minha-agenda-list">
      ${Array.from(groups.values()).map(g => `
        <div class="minha-agenda-day">
          <div class="minha-agenda-day-header">${ProfHelpers.formatDateBR(g.date)}</div>
          <div class="minha-agenda-day-items">
            ${g.items.map(renderAgendaGeralCard).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderAgendaGeralCard(cls) {
  const mod = AgendaState.modalitiesMap.get(cls.modalityId);
  const unit = AgendaState.units.find(u => u.id === cls.unitId);
  const teacher = AgendaState.teachersMap.get(cls.teacherId);
  const sColor = ProfHelpers.CLASS_STATUS_COLOR[cls.status] || ProfHelpers.CLASS_STATUS_COLOR.prevista;
  const sLabel = ProfHelpers.CLASS_STATUS_LABEL[cls.status] || cls.status;
  return `
    <div class="class-card geral-card" onclick="openClassModal('${cls.id}')"
         style="border-left:3px solid ${sColor.border};">
      <div class="class-card-time">${cls.startTime}<span class="slot-time-sep">–</span>${cls.endTime}</div>
      <div class="class-card-info">
        <div class="class-card-modality">${escapeHtml(mod ? mod.name : '—')}</div>
        <div class="class-card-unit">👤 ${escapeHtml(teacher ? teacher.name : '—')} · 🏢 ${escapeHtml(unit ? (unit.name || unit.id) : '—')}</div>
      </div>
      <div class="class-card-status">
        <span class="class-status-badge" style="background:${sColor.bg};color:${sColor.text};border:1px solid ${sColor.border};">${sLabel}</span>
      </div>
    </div>
  `;
}

// ════════════════════════════════════════════════════════════════════════
// SPRINT 3b — SUBSTITUIÇÕES + COBERTURA (modais + handlers)
// ════════════════════════════════════════════════════════════════════════

// Estende openClassModal pra adicionar botões de substituição/cobertura
// quando o user logado é o teacher titular da aula e o status permite
function classModalCanRequestSub(cls) {
  if (!cls || cls.monthClosingId) return false;
  if (cls.status === 'cancelada' || cls.status === 'substituida') return false;
  const myProfId = getCurrentProfessorId();
  if (!myProfId) return false;
  return cls.teacherId === myProfId;
}

// Wraper pra estender o footer do classModal com botões da Sprint 3b
// (chamado dentro de openClassModal de Sprint 3a)
function injectClassModalActions(cls) {
  const footer = document.querySelector('#classModal .form-actions');
  if (!footer) return;
  // Remove botões antigos da Sprint 3b se já presentes
  footer.querySelectorAll('[data-sprint-3b]').forEach(el => el.remove());

  if (classModalCanRequestSub(cls)) {
    const btnSub = document.createElement('button');
    btnSub.className = 'btn btn-outline';
    btnSub.setAttribute('data-sprint-3b', 'true');
    btnSub.textContent = '🔄 Pedir substituição';
    btnSub.onclick = () => openSubstitutionModal(cls.id);
    const btnCov = document.createElement('button');
    btnCov.className = 'btn btn-outline';
    btnCov.setAttribute('data-sprint-3b', 'true');
    btnCov.textContent = '🆘 Pedir cobertura aberta';
    btnCov.onclick = () => openCoverageModal(cls.id);

    // Insere antes do botão Salvar (ou Fechar se não tem Salvar)
    const saveBtn = document.getElementById('classSaveBtn');
    if (saveBtn) {
      footer.insertBefore(btnSub, saveBtn);
      footer.insertBefore(btnCov, saveBtn);
    } else {
      footer.appendChild(btnSub);
      footer.appendChild(btnCov);
    }
  }
}

// ─── Modal de Substituição Direta ────────────────────────────────────────
const SubstitutionFormState = { classId: null };

function openSubstitutionModal(classId) {
  // Fecha class modal pra evitar empilhamento confuso
  closeClassModal();

  const cls = findClassAnywhere(classId);
  if (!cls) { toast('Aula não encontrada.', 'error'); return; }
  SubstitutionFormState.classId = classId;

  const aulaDate = cls.scheduledDate.toDate ? cls.scheduledDate.toDate() : new Date(cls.scheduledDate);
  const isPast = aulaDate < new Date();

  // Filtra professores aptos à modalidade, excluindo o próprio titular
  const eligible = Array.from(AgendaState.teachersMap.values())
    .filter(t => t.isActive !== false)
    .filter(t => t.id !== cls.teacherId)
    .filter(t => Array.isArray(t.modalityIds) && t.modalityIds.includes(cls.modalityId));

  const modal = document.getElementById('substitutionModal');
  if (!modal) return;
  document.getElementById('substitutionModalTitle').textContent =
    `Pedir substituição — ${ProfHelpers.formatDateBR(cls.scheduledDate)}`;
  document.getElementById('substitutionModalError').textContent = '';

  document.getElementById('substitutionRetroactiveBox').style.display = isPast ? '' : 'none';

  // Popula select de substituto
  const sel = document.getElementById('substituteSelect');
  if (eligible.length === 0) {
    sel.innerHTML = '<option value="" disabled selected>Nenhum professor habilitado nesta modalidade</option>';
  } else {
    sel.innerHTML = ['<option value="">— escolha —</option>'].concat(
      eligible.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)} · ${escapeHtml(t.type || '')}</option>`)
    ).join('');
  }
  document.getElementById('substitutionReason').value = '';

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

  // Tentar descobrir o userId do substituto via teacher.userId (se vinculado)
  // Caso não tenha, salva null — notif não chega mas substituição funciona com aceite admin
  const substTeacher = AgendaState.teachersMap.get(substituteTeacherId);
  let substituteUserId = substTeacher && substTeacher.userId ? substTeacher.userId : null;

  // Fallback: tenta achar user com professorId == substituteTeacherId
  if (!substituteUserId) {
    try {
      const us = await db.collection('users').where('professorId', '==', substituteTeacherId).limit(1).get();
      if (!us.empty) substituteUserId = us.docs[0].id;
    } catch (e) { /* ignore */ }
  }

  const btn = document.getElementById('substitutionSaveBtn');
  btn.disabled = true; btn.textContent = 'Enviando…';

  const res = await SubstitutionService.create({ classId, substituteTeacherId, substituteUserId, reason });

  btn.disabled = false; btn.textContent = 'Enviar pedido';

  if (!res.success) { errEl.textContent = res.error; return; }

  if (!substituteUserId) {
    toast('Pedido criado, mas o substituto ainda não tem usuário vinculado — admin precisa avisar.', 'info', 6000);
  } else {
    toast('Pedido de substituição enviado.', 'success');
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
const InboxState = { subs: [], covs: [], activeTab: 'subs' };

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

  // Pedidos direcionados a mim
  const subsRes = await SubstitutionService.listPendingForSubstitute(uid);
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
      list.innerHTML = '<div class="empty-state-small" style="padding:24px;">Nenhum pedido pendente para você.</div>';
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
  const requester = AgendaState.teachersMap.get(s.requestingTeacherId);
  const requesterName = requester ? requester.name : s.requestingTeacherId;
  const retro = s.wasRetroactive ? '<span class="badge-retro">retroativo</span>' : '';
  return `
    <div class="inbox-item">
      <div class="inbox-item-header">
        <span class="inbox-item-title">🔄 ${escapeHtml(requesterName)} pediu substituição</span>
        ${retro}
      </div>
      <div class="inbox-item-body">${escapeHtml(s.reason || '(sem motivo informado)')}</div>
      <div class="inbox-item-meta">${formatReqWhen(s)}</div>
      <div class="inbox-item-actions">
        <button class="btn btn-outline btn-sm" onclick="handleSubReject('${s.id}')">Recusar</button>
        <button class="btn btn-primary btn-sm" onclick="handleSubAccept('${s.id}')">Aceitar</button>
      </div>
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
  const note = prompt('Observação opcional para o titular (deixe vazio se nenhuma):') || '';
  const res = await SubstitutionService.accept(subId, note);
  if (!res.success) { toast('Erro: ' + res.error, 'error'); return; }
  toast('Substituição aceita.', 'success');
  await loadInboxData();
  await refreshNotifBell();
}

async function handleSubReject(subId) {
  const note = prompt('Motivo da recusa (opcional):') || '';
  const res = await SubstitutionService.reject(subId, note);
  if (!res.success) { toast('Erro: ' + res.error, 'error'); return; }
  toast('Substituição recusada.', 'info');
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
