// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Módulo Professores · Tela de Férias e Recesso
// Sprint 6a
// ═══════════════════════════════════════════════════════════════════════

'use strict';

/* ─── Constants ─────────────────────────────────────────────────────── */
const VACATION_STATUS_LABEL = {
  pendente:  'Pendente',
  aprovada:  'Aprovada',
  recusada:  'Recusada',
  cancelada: 'Cancelada',
};

const VACATION_STATUS_COLOR = {
  pendente:  { bg: 'var(--yellow-bg)', border: 'var(--yellow)', text: 'var(--yellow)' },
  aprovada:  { bg: 'var(--green-bg)',  border: 'var(--green)',  text: 'var(--green)' },
  recusada:  { bg: 'var(--red-bg)',    border: 'var(--red)',    text: 'var(--red)' },
  cancelada: { bg: 'var(--surface3)',  border: 'var(--border)', text: 'var(--text2)' },
};

function statusBadge(s) {
  const c = VACATION_STATUS_COLOR[s] || VACATION_STATUS_COLOR.pendente;
  const label = VACATION_STATUS_LABEL[s] || s;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:12px;font-weight:600;
    background:${c.bg};color:${c.text};border:1px solid ${c.border};">${label}</span>`;
}

function formatPeriods(periods) {
  if (!Array.isArray(periods)) return '—';
  return periods.map(p => {
    const sd = p.startDate && p.startDate.toDate ? p.startDate.toDate() : new Date(p.startDate);
    const ed = p.endDate && p.endDate.toDate ? p.endDate.toDate() : new Date(p.endDate);
    return `${sd.toLocaleDateString('pt-BR')} a ${ed.toLocaleDateString('pt-BR')} (${p.days}d)`;
  }).join('<br>');
}

/* ─── View: Professor "Minhas Férias" ───────────────────────────────── */

async function renderMinhasFeriasPage() {
  const container = document.getElementById('page-ferias');
  if (!container) return;

  const teacherId = getCurrentProfessorId();
  if (!teacherId) {
    container.innerHTML = `<div class="page-hdr"><h1>🏖️ Minhas Férias</h1>
      <p style="color:var(--text2);">Nenhum professor vinculado ao seu usuário. Fale com o admin.</p></div>`;
    return;
  }

  // Busca teacher
  const tDoc = await db.collection('teachers').doc(teacherId).get();
  if (!tDoc.exists) {
    container.innerHTML = `<div class="page-hdr"><h1>🏖️ Minhas Férias</h1>
      <p style="color:var(--red);">Professor não encontrado.</p></div>`;
    return;
  }
  const teacher = tDoc.data();

  // Se eventual, mostra empty state
  if (teacher.type === 'eventual') {
    container.innerHTML = `
      <div class="page-hdr"><h1>🏖️ Minhas Férias</h1>
        <p>Professores eventuais não têm direito formal a férias/recesso. Fale com a gestão se precisar se ausentar.</p>
      </div>
      <div style="text-align:center;padding:60px 20px;color:var(--text2);">
        <div style="font-size:48px;margin-bottom:16px;">🏖️</div>
        <p>Sem direito formal a férias — fale com a gestão.</p>
      </div>`;
    return;
  }

  const res = await VacationService.listByTeacher(teacherId);
  const requests = res.success ? res.data : [];

  let rowsHtml = '';
  if (requests.length === 0) {
    rowsHtml = `<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--text2);">
      Nenhuma solicitação de férias ainda.
    </td></tr>`;
  } else {
    requests.forEach(r => {
      const reqDate = r.requestedAt && r.requestedAt.toDate
        ? r.requestedAt.toDate().toLocaleDateString('pt-BR') : '—';
      rowsHtml += `<tr>
        <td>${reqDate}</td>
        <td>${r.type === 'recesso' ? 'Recesso' : 'Férias'}</td>
        <td>${formatPeriods(r.periods)}</td>
        <td>${r.totalDays || 0} dias</td>
        <td>${statusBadge(r.status)}</td>
        <td style="white-space:nowrap;">
          ${r.status === 'pendente' ? `<button class="btn-sm btn-danger" onclick="cancelarVacation('${r.id}')">Cancelar</button>` : ''}
        </td>
      </tr>`;
    });
  }

  container.innerHTML = `
    <div class="page-hdr">
      <h1>🏖️ Minhas Férias</h1>
      <p>Solicite férias ou recesso e acompanhe o status dos seus pedidos.</p>
    </div>

    <div class="page-toolbar">
      <div class="lhs"><h2>Histórico <span class="count">${requests.length}</span></h2></div>
      <div class="rhs">
        <button class="btn-primary" onclick="openFeriasRequestModal()">+ Nova solicitação</button>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Solicitado em</th><th>Tipo</th><th>Período(s)</th><th>Total</th><th>Status</th><th style="width:80px;"></th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>

    <div id="feriasModal" class="modal"><div class="modal-content" id="feriasModalContent"></div></div>
  `;
}

/* ─── View: Admin/Gestão "Gerenciar Férias" ─────────────────────────── */

async function renderFeriasGestaoPage() {
  const container = document.getElementById('page-ferias');
  if (!container) return;

  // Carrega dados iniciais
  const [vacRes, unitsSnap, teachersSnap] = await Promise.all([
    VacationService.listAll(),
    db.collection('units').get(),
    db.collection('teachers').get(),
  ]);

  const requests = vacRes.success ? vacRes.data : [];
  const units = unitsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const teachers = teachersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const byStatus = {};
  requests.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });

  let rowsHtml = '';
  if (requests.length === 0) {
    rowsHtml = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text2);">
      Nenhum pedido de férias encontrado.
    </td></tr>`;
  } else {
    requests.forEach(r => {
      const reqDate = r.requestedAt && r.requestedAt.toDate
        ? r.requestedAt.toDate().toLocaleDateString('pt-BR') : '—';
      rowsHtml += `<tr>
        <td>${r.teacherName || '—'}</td>
        <td>${r.type === 'recesso' ? 'Recesso' : 'Férias'}</td>
        <td>${formatPeriods(r.periods)}</td>
        <td>${r.totalDays || 0}d</td>
        <td>${reqDate}</td>
        <td>${statusBadge(r.status)}</td>
        <td style="white-space:nowrap;">
          ${r.status === 'pendente'
            ? `<button class="btn-sm" style="background:var(--green-bg);color:var(--green);" onclick="aprovarVacation('${r.id}')">✓ Aprovar</button>
               <button class="btn-sm btn-danger" onclick="recusarVacation('${r.id}')">✗ Recusar</button>`
            : (r.status === 'aprovada'
              ? `<button class="btn-sm btn-danger" onclick="cancelarVacationAdmin('${r.id}')">Cancelar</button>`
              : '')}
        </td>
      </tr>`;
    });
  }

  // Filtro de status chips
  const statusChips = ['todas', 'pendente', 'aprovada', 'recusada', 'cancelada'].map(s => {
    const count = s === 'todas' ? requests.length : (byStatus[s] || 0);
    return `<span class="chip ${s === 'todas' ? 'active' : ''}" onclick="filtrarFeriasPorStatus('${s}')" data-status="${s}">${s === 'todas' ? 'Todas' : VACATION_STATUS_LABEL[s]} (${count})</span>`;
  }).join('');

  container.innerHTML = `
    <div class="page-hdr">
      <h1>🏖️ Gerenciar Férias e Recesso</h1>
      <p>Aprove, recuse ou cancele pedidos de férias dos professores.</p>
    </div>

    <div class="page-toolbar">
      <div class="lhs"><h2>Pedidos <span class="count">${requests.length}</span></h2></div>
      <div class="rhs">
        <button class="btn-primary" onclick="openFeriasRequestModalAdmin()">+ Nova solicitação (admin)</button>
      </div>
    </div>

    <div style="margin-bottom:16px;display:flex;gap:6px;flex-wrap:wrap;">${statusChips}</div>

    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Professor</th><th>Tipo</th><th>Período(s)</th><th>Dias</th><th>Solicitado</th><th>Status</th><th style="width:160px;">Ações</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>

    <div id="feriasModal" class="modal"><div class="modal-content" id="feriasModalContent"></div></div>
  `;

  window._feriasState = { requests, statusFilter: 'todas' };
}

/* ─── Filtro ────────────────────────────────────────────────────────── */

async function filtrarFeriasPorStatus(status) {
  const container = document.getElementById('page-ferias');
  const chips = container.querySelectorAll('.chip');
  chips.forEach(c => c.classList.remove('active'));
  container.querySelector(`.chip[data-status="${status}"]`)?.classList.add('active');

  const res = status === 'todas'
    ? await VacationService.listAll()
    : await VacationService.listAll({ status });
  const requests = res.success ? res.data : [];

  let rowsHtml = requests.length === 0
    ? `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text2);">Nenhum pedido encontrado.</td></tr>`
    : requests.map(r => {
        const reqDate = r.requestedAt && r.requestedAt.toDate
          ? r.requestedAt.toDate().toLocaleDateString('pt-BR') : '—';
        return `<tr>
          <td>${r.teacherName || '—'}</td>
          <td>${r.type === 'recesso' ? 'Recesso' : 'Férias'}</td>
          <td>${formatPeriods(r.periods)}</td>
          <td>${r.totalDays || 0}d</td>
          <td>${reqDate}</td>
          <td>${statusBadge(r.status)}</td>
          <td style="white-space:nowrap;">
            ${r.status === 'pendente'
              ? `<button class="btn-sm" style="background:var(--green-bg);color:var(--green);" onclick="aprovarVacation('${r.id}')">✓ Aprovar</button>
                 <button class="btn-sm btn-danger" onclick="recusarVacation('${r.id}')">✗ Recusar</button>`
              : (r.status === 'aprovada'
                ? `<button class="btn-sm btn-danger" onclick="cancelarVacationAdmin('${r.id}')">Cancelar</button>`
                : '')}
          </td>
        </tr>`;
      }).join('');

  // Replace only tbody
  const tbody = container.querySelector('tbody');
  if (tbody) tbody.innerHTML = rowsHtml;
  // Update count
  const countEl = container.querySelector('.count');
  if (countEl) countEl.textContent = requests.length;
}

/* ─── Modal de solicitação (Professor) ──────────────────────────────── */

async function openFeriasRequestModal() {
  const teacherId = getCurrentProfessorId();
  if (!teacherId) { toast('Professor não vinculado.', 'error'); return; }
  const tDoc = await db.collection('teachers').doc(teacherId).get();
  if (!tDoc.exists) { toast('Professor não encontrado.', 'error'); return; }
  const teacher = tDoc.data();

  if (teacher.type === 'eventual') { toast('Eventuais não têm direito formal.', 'error'); return; }

  const modal = document.getElementById('feriasModal');
  const content = document.getElementById('feriasModalContent');
  if (!modal || !content) return;

  const typeLabel = teacher.type === 'estagiario' ? 'Recesso' : 'Férias';

  modal.classList.add('open');
  content.innerHTML = `
    <h2>Nova solicitação de ${typeLabel}</h2>
    <div class="form-group">
      <label>Tipo</label>
      <input type="text" value="${typeLabel} (${teacher.type})" readonly class="input" style="background:var(--surface3);">
    </div>
    <div id="feriasPeriodsContainer">
      <div class="ferias-period" data-idx="0" style="border:1px solid var(--border);padding:12px;border-radius:8px;margin-bottom:8px;">
        <label>1º Período <span style="color:var(--red);">*</span></label>
        <div style="display:flex;gap:8px;">
          <input type="date" class="ferias-period-start input" style="flex:1;" required>
          <span style="align-self:center;">a</span>
          <input type="date" class="ferias-period-end input" style="flex:1;" required>
        </div>
        <div class="ferias-period-days" style="font-size:12px;color:var(--text2);margin-top:4px;"></div>
      </div>
    </div>
    <button class="btn-sm" onclick="addFeriasPeriod()" id="addPeriodBtn" style="margin:8px 0;">+ Adicionar período (máx 3)</button>
    <div class="form-group">
      <label>Motivo (opcional)</label>
      <textarea id="feriasReason" rows="2" class="input" placeholder="Ex: férias programadas"></textarea>
    </div>
    <div id="feriasValidationError" style="color:var(--red);font-size:13px;margin:8px 0;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="btn-secondary" onclick="closeFeriasModal()">Cancelar</button>
      <button class="btn-primary" onclick="submitFeriasRequest()">Enviar solicitação</button>
    </div>
  `;

  window._feriasPeriodCount = 1;
}

/* ─── Modal de solicitação (Admin em nome de professor) ─────────────── */

async function openFeriasRequestModalAdmin() {
  const modal = document.getElementById('feriasModal');
  const content = document.getElementById('feriasModalContent');
  if (!modal || !content) return;

  const tSnap = await db.collection('teachers').get();
  const teachers = tSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const opts = teachers.map(t =>
    `<option value="${t.id}">${t.name || t.id} (${t.type})</option>`
  ).join('');

  modal.classList.add('open');
  content.innerHTML = `
    <h2>Nova solicitação (admin)</h2>
    <div class="form-group">
      <label>Professor <span style="color:var(--red);">*</span></label>
      <select id="feriasTeacherSelect" class="input">${opts}</select>
    </div>
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="feriasForceOverride"> Forçar override de antecedência (admin)
      </label>
    </div>
    <div id="feriasPeriodsContainer">
      <div class="ferias-period" data-idx="0" style="border:1px solid var(--border);padding:12px;border-radius:8px;margin-bottom:8px;">
        <label>1º Período <span style="color:var(--red);">*</span></label>
        <div style="display:flex;gap:8px;">
          <input type="date" class="ferias-period-start input" style="flex:1;" required>
          <span style="align-self:center;">a</span>
          <input type="date" class="ferias-period-end input" style="flex:1;" required>
        </div>
        <div class="ferias-period-days" style="font-size:12px;color:var(--text2);margin-top:4px;"></div>
      </div>
    </div>
    <button class="btn-sm" onclick="addFeriasPeriod()" id="addPeriodBtn" style="margin:8px 0;">+ Adicionar período (máx 3)</button>
    <div class="form-group">
      <label>Motivo (opcional)</label>
      <textarea id="feriasReason" rows="2" class="input"></textarea>
    </div>
    <div id="feriasValidationError" style="color:var(--red);font-size:13px;margin:8px 0;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="btn-secondary" onclick="closeFeriasModal()">Cancelar</button>
      <button class="btn-primary" onclick="submitFeriasRequestAdmin()">Enviar solicitação</button>
    </div>
  `;

  window._feriasPeriodCount = 1;
}

/* ─── Helpers do modal ───────────────────────────────────────────────── */

function addFeriasPeriod() {
  if (window._feriasPeriodCount >= 3) { toast('Máximo 3 períodos.', 'error'); return; }
  const container = document.getElementById('feriasPeriodsContainer');
  if (!container) return;
  const idx = window._feriasPeriodCount++;
  const div = document.createElement('div');
  div.className = 'ferias-period';
  div.dataset.idx = idx;
  div.style.cssText = 'border:1px solid var(--border);padding:12px;border-radius:8px;margin-bottom:8px;';
  div.innerHTML = `
    <label>${idx + 1}º Período <span style="color:var(--red);">*</span>
      <button class="btn-sm" onclick="this.closest('.ferias-period').remove();window._feriasPeriodCount--;" style="float:right;font-size:11px;">✕ Remover</button>
    </label>
    <div style="display:flex;gap:8px;">
      <input type="date" class="ferias-period-start input" style="flex:1;" required>
      <span style="align-self:center;">a</span>
      <input type="date" class="ferias-period-end input" style="flex:1;" required>
    </div>
    <div class="ferias-period-days" style="font-size:12px;color:var(--text2);margin-top:4px;"></div>
  `;
  container.appendChild(div);

  if (window._feriasPeriodCount >= 3) {
    const btn = document.getElementById('addPeriodBtn');
    if (btn) btn.style.display = 'none';
  }
}

function collectPeriods() {
  const periods = [];
  document.querySelectorAll('.ferias-period').forEach(el => {
    const s = el.querySelector('.ferias-period-start')?.value;
    const e = el.querySelector('.ferias-period-end')?.value;
    if (s && e) periods.push({ startDate: new Date(s + 'T03:00:00Z'), endDate: new Date(e + 'T03:00:00Z') });
  });
  return periods;
}

function closeFeriasModal() {
  const modal = document.getElementById('feriasModal');
  if (modal) modal.classList.remove('open');
  const content = document.getElementById('feriasModalContent');
  if (content) content.innerHTML = '';
  window._feriasPeriodCount = 1;
}

/* ─── Submit ─────────────────────────────────────────────────────────── */

async function submitFeriasRequest() {
  const teacherId = getCurrentProfessorId();
  const periods = collectPeriods();
  const reason = document.getElementById('feriasReason')?.value?.trim() || '';
  const errEl = document.getElementById('feriasValidationError');

  if (periods.length === 0) {
    if (errEl) errEl.textContent = 'Informe ao menos 1 período.';
    return;
  }

  const res = await VacationService.request({ teacherId, periods, reason });
  if (res.success) {
    toast('Solicitação enviada com sucesso!', 'success');
    closeFeriasModal();
    await renderMinhasFeriasPage();
  } else {
    if (errEl) errEl.textContent = res.error || 'Erro ao solicitar.';
    toast(res.error || 'Erro', 'error');
  }
}

async function submitFeriasRequestAdmin() {
  const teacherId = document.getElementById('feriasTeacherSelect')?.value;
  const force = document.getElementById('feriasForceOverride')?.checked || false;
  const periods = collectPeriods();
  const reason = document.getElementById('feriasReason')?.value?.trim() || '';
  const errEl = document.getElementById('feriasValidationError');

  if (!teacherId) { toast('Selecione o professor.', 'error'); return; }
  if (periods.length === 0) { if (errEl) errEl.textContent = 'Informe ao menos 1 período.'; return; }

  const res = await VacationService.request({ teacherId, periods, reason, force });
  if (res.success) {
    toast('Solicitação criada com sucesso!', 'success');
    closeFeriasModal();
    await renderFeriasGestaoPage();
  } else {
    if (errEl) errEl.textContent = res.error || 'Erro ao solicitar.';
    toast(res.error || 'Erro', 'error');
  }
}

/* ─── Ações ──────────────────────────────────────────────────────────── */

async function aprovarVacation(reqId) {
  if (!confirm('Aprovar este pedido de férias?')) return;
  const res = await VacationService.approve(reqId);
  if (res.success) {
    toast('Férias aprovadas!', 'success');
    await renderFeriasGestaoPage();
  } else {
    toast('Erro: ' + (res.error || 'Falha'), 'error');
  }
}

async function recusarVacation(reqId) {
  const motivo = prompt('Motivo da recusa (obrigatório):');
  if (!motivo) return;
  const res = await VacationService.reject(reqId, motivo);
  if (res.success) {
    toast('Férias recusadas.', 'success');
    await renderFeriasGestaoPage();
  } else {
    toast('Erro: ' + (res.error || 'Falha'), 'error');
  }
}

async function cancelarVacation(reqId) {
  if (!confirm('Cancelar este pedido?')) return;
  const res = await VacationService.cancel(reqId);
  if (res.success) {
    toast('Pedido cancelado.', 'success');
    const teacherId = getCurrentProfessorId();
    if (teacherId && !isAdminGestao()) {
      await renderMinhasFeriasPage();
    } else {
      await renderFeriasGestaoPage();
    }
  } else {
    toast('Erro: ' + (res.error || 'Falha'), 'error');
  }
}

async function cancelarVacationAdmin(reqId) {
  if (!confirm('Cancelar este pedido aprovado?')) return;
  const res = await VacationService.cancel(reqId, 'Cancelado pela gestão');
  if (res.success) {
    toast('Pedido cancelado.', 'success');
    await renderFeriasGestaoPage();
  } else {
    toast('Erro: ' + (res.error || 'Falha'), 'error');
  }
}

// Expor globalmente
window.renderMinhasFeriasPage = renderMinhasFeriasPage;
window.renderFeriasGestaoPage = renderFeriasGestaoPage;
window.openFeriasRequestModal = openFeriasRequestModal;
window.openFeriasRequestModalAdmin = openFeriasRequestModalAdmin;
window.closeFeriasModal = closeFeriasModal;
window.addFeriasPeriod = addFeriasPeriod;
window.submitFeriasRequest = submitFeriasRequest;
window.submitFeriasRequestAdmin = submitFeriasRequestAdmin;
window.aprovarVacation = aprovarVacation;
window.recusarVacation = recusarVacation;
window.cancelarVacation = cancelarVacation;
window.cancelarVacationAdmin = cancelarVacationAdmin;
window.filtrarFeriasPorStatus = filtrarFeriasPorStatus;

console.log('[CrossTainer Professores] professores-ferias.js carregado · Sprint 6a');
