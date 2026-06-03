// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Módulo Professores · Tela de Escalas Especiais
// Sprint 5a
// ═══════════════════════════════════════════════════════════════════════

'use strict';

/* ─── State local ──────────────────────────────────────────────────── */
const EscalasState = {
  scaleTypes: [],       // cache dos 4 tipos
  scales: [],           // lista de escalas
  units: [],            // cache de unidades
  editingId: null,      // null = criando nova
};

/* ── Constante de label dos tipos ───────────────────────────────────── */
const SCALE_TYPE_LABELS = {
  sabado: 'Sábado',
  feriado: 'Feriado',
  domingo_especial: 'Domingo Especial',
  evento_especial: 'Evento Especial',
};

const SCALE_TYPE_COLORS = {
  sabado:            { bg: 'var(--blue-bg)',    border: 'var(--blue)',    text: 'var(--blue)' },
  feriado:           { bg: 'var(--red-bg)',     border: 'var(--red)',     text: 'var(--red)' },
  domingo_especial:  { bg: 'var(--purple-bg)',  border: 'var(--purple)',  text: 'var(--purple)' },
  evento_especial:   { bg: 'var(--orange-bg)',  border: 'var(--orange)',  text: 'var(--orange)' },
};

/* ─── Render principal ──────────────────────────────────────────────── */
async function renderEscalasPage() {
  const container = document.getElementById('page-escalas');
  if (!container) return;

  // Carrega dados
  const [typesRes, scalesRes, unitsSnap] = await Promise.all([
    db.collection('special_scale_types').get(),
    SpecialScaleService.list(),
    db.collection('units').get(),
  ]);

  EscalasState.scaleTypes = typesRes.docs.map(d => ({ id: d.id, ...d.data() }));
  EscalasState.scales = scalesRes.success ? scalesRes.data : [];
  EscalasState.units = unitsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const typeMap = new Map(EscalasState.scaleTypes.map(t => [t.id, t]));

  let rowsHtml = '';
  if (EscalasState.scales.length === 0) {
    rowsHtml = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text2);">
      Nenhuma escala especial cadastrada ainda.
    </td></tr>`;
  } else {
    EscalasState.scales.forEach(s => {
      const t = typeMap.get(s.scaleTypeId) || {};
      const dateStr = s.date && s.date.toDate
        ? s.date.toDate().toLocaleDateString('pt-BR')
        : '—';
      const unitsStr = (s.unitIds || []).map(uid => {
        const u = EscalasState.units.find(x => x.id === uid);
        return u ? u.name : uid;
      }).join(', ') || '—';
      const color = SCALE_TYPE_COLORS[s.scaleTypeId] || { bg: 'var(--surface3)', border: 'var(--border)', text: 'var(--text2)' };
      const badge = `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:12px;font-weight:600;
        background:${color.bg};color:${color.text};border:1px solid ${color.border};">${t.name || s.scaleTypeId} (${t.weight || '?'}×)</span>`;
      const activeBadge = s.isActive !== false
        ? '<span style="color:var(--green);font-weight:600;">Ativa</span>'
        : '<span style="color:var(--red);font-weight:600;">Inativa</span>';

      rowsHtml += `<tr>
        <td>${dateStr}</td>
        <td>${s.name || '—'}</td>
        <td>${badge}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;" title="${unitsStr}">${unitsStr}</td>
        <td>${activeBadge}</td>
        <td style="white-space:nowrap;">
          <button class="btn-sm" onclick="editEscala('${s.id}')" ${s.isActive === false ? 'disabled' : ''}>✏️</button>
          ${s.isActive !== false ? `<button class="btn-sm btn-danger" onclick="deactivateEscala('${s.id}')">🗑️</button>` : ''}
          <button class="btn-sm" onclick="applyEscalaToClasses('${s.id}')" title="Aplicar a classes">📌</button>
        </td>
      </tr>`;
    });
  }

  container.innerHTML = `
    <div class="page-hdr">
      <h1>🎯 Escalas Especiais</h1>
      <p>Gerencie sábados, feriados, domingos especiais e eventos com pesos diferenciados no cálculo de horas.</p>
    </div>

    <div class="page-toolbar">
      <div class="lhs">
        <h2>Escalas cadastradas <span class="count">${EscalasState.scales.length}</span></h2>
      </div>
      <div class="rhs">
        <button class="btn-primary" onclick="openEscalaModal()">+ Nova Escala</button>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Data</th><th>Nome</th><th>Tipo</th><th>Unidades</th><th>Status</th><th style="width:120px;">Ações</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>

    <div id="escalaModalOverlay" class="modal-overlay" style="display:none;"></div>
    <div id="escalaModal" class="modal" style="display:none;"></div>
  `;
}

/* ─── Modal Criar/Editar ────────────────────────────────────────────── */
async function openEscalaModal(editId) {
  EscalasState.editingId = editId || null;

  const overlay = document.getElementById('escalaModalOverlay');
  const modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;

  let existing = null;
  if (editId) {
    const res = await SpecialScaleService.getById(editId);
    if (res.success) existing = res.data;
  }

  const typeOptions = EscalasState.scaleTypes.map(t =>
    `<option value="${t.id}" ${existing && existing.scaleTypeId === t.id ? 'selected' : ''}>${t.name} (peso ${t.weight}×)</option>`
  ).join('');

  const unitChipsHtml = EscalasState.units.map(u => {
    const checked = existing && (existing.unitIds || []).includes(u.id);
    return `<label class="chip-label" style="display:inline-block;margin:2px 4px;">
      <input type="checkbox" class="escala-unit-cb" value="${u.id}" ${checked ? 'checked' : ''}> ${u.name || u.id}
    </label>`;
  }).join('');

  const dateVal = existing && existing.date && existing.date.toDate
    ? existing.date.toDate().toISOString().slice(0, 10) : '';

  overlay.style.display = 'flex';
  modal.style.display = 'block';
  modal.innerHTML = `
    <h2>${editId ? 'Editar' : 'Nova'} Escala Especial</h2>
    <div class="form-group">
      <label>Data <span style="color:var(--red);">*</span></label>
      <input type="date" id="escalaDate" value="${dateVal}" class="input">
    </div>
    <div class="form-group">
      <label>Nome <span style="color:var(--red);">*</span></label>
      <input type="text" id="escalaName" value="${existing ? (existing.name || '') : ''}" placeholder="Ex: Natal 2026" class="input">
    </div>
    <div class="form-group">
      <label>Tipo <span style="color:var(--red);">*</span></label>
      <select id="escalaType" class="input">${typeOptions}</select>
    </div>
    <div class="form-group">
      <label>Unidades <span style="color:var(--red);">*</span> (ao menos 1)</label>
      <div id="escalaUnitsChips" style="margin-top:4px;">${unitChipsHtml}</div>
    </div>
    <div class="form-group">
      <label>Descrição</label>
      <input type="text" id="escalaDesc" value="${existing ? (existing.description || '') : ''}" placeholder="Opcional" class="input">
    </div>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      ${editId ? `<button class="btn-primary" onclick="applyEscalaToClasses('${editId}')">📌 Aplicar a classes</button>` : ''}
      <button class="btn-primary" onclick="saveEscala()">${editId ? 'Salvar' : 'Criar'}</button>
    </div>
  `;
}

function closeEscalaModal() {
  const overlay = document.getElementById('escalaModalOverlay');
  const modal = document.getElementById('escalaModal');
  if (overlay) overlay.style.display = 'none';
  if (modal) modal.style.display = 'none';
  EscalasState.editingId = null;
}

async function saveEscala() {
  const dateEl = document.getElementById('escalaDate');
  const nameEl = document.getElementById('escalaName');
  const typeEl = document.getElementById('escalaType');
  const descEl = document.getElementById('escalaDesc');
  const cbs = document.querySelectorAll('.escala-unit-cb:checked');

  const date = dateEl?.value?.trim();
  const name = nameEl?.value?.trim();
  const scaleTypeId = typeEl?.value;
  const description = descEl?.value?.trim() || '';
  const unitIds = Array.from(cbs).map(cb => cb.value);

  // Validações
  if (!date) { toast('Informe a data.', 'error'); return; }
  if (!name) { toast('Informe o nome.', 'error'); return; }
  if (!scaleTypeId) { toast('Selecione o tipo.', 'error'); return; }
  if (unitIds.length === 0) { toast('Selecione ao menos 1 unidade.', 'error'); return; }

  let res;
  if (EscalasState.editingId) {
    res = await SpecialScaleService.update(EscalasState.editingId, { name, date, scaleTypeId, unitIds, description });
  } else {
    res = await SpecialScaleService.create({ scaleTypeId, date, name, unitIds, description });
  }

  if (res.success) {
    toast(`Escala ${EscalasState.editingId ? 'atualizada' : 'criada'} com sucesso!`, 'success');
    closeEscalaModal();
    await renderEscalasPage();
  } else {
    toast('Erro: ' + (res.error || 'Falha ao salvar'), 'error');
  }
}

/* ─── Ações inline ──────────────────────────────────────────────────── */
async function editEscala(id) {
  await openEscalaModal(id);
}

async function deactivateEscala(id) {
  if (!confirm('Inativar esta escala?')) return;
  const res = await SpecialScaleService.deactivate(id);
  if (res.success) {
    toast('Escala inativada.', 'success');
    await renderEscalasPage();
  } else {
    toast('Erro: ' + (res.error || 'Falha ao inativar'), 'error');
  }
}

async function applyEscalaToClasses(id) {
  if (!confirm('Aplicar esta escala a todas as classes existentes na data e unidades correspondentes?')) return;
  toast('Aplicando escala às classes...', 'info');
  const res = await SpecialScaleService.applyToClasses(id);
  if (res.success) {
    toast(`${res.data.appliedCount} classes atualizadas!`, 'success');
    await renderEscalasPage();
  } else {
    toast('Erro: ' + (res.error || 'Falha ao aplicar'), 'error');
  }
}

// Expor funções globalmente (chamadas via onclick inline)
window.renderEscalasPage = renderEscalasPage;
window.openEscalaModal = openEscalaModal;
window.closeEscalaModal = closeEscalaModal;
window.saveEscala = saveEscala;
window.editEscala = editEscala;
window.deactivateEscala = deactivateEscala;
window.applyEscalaToClasses = applyEscalaToClasses;

console.log('[CrossTainer Professores] professores-escalas.js carregado · Sprint 5a');
