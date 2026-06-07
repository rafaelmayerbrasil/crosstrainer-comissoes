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

/* ─── Helpers ──────────────────────────────────────────────────────────── */

/** Fecha modal por ID (display:none). */
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

// ─── Sprint 6b — Renderização da coluna Pagamento ──────────────────────

function renderPaymentCell(req) {
  // Não aprovada → mostra "—"
  if (req.status !== 'aprovada') {
    return '<td class="mono" style="color:#94a3b8;">—</td>';
  }

  const payment = req.payment;
  const paidIds = req.paidInClosingIds || [];

  // Estado 1: deferred ou ausente (pendente)
  if (!payment || payment.mode === 'deferred') {
    return `<td>
      <span class="payment-badge pending">⏳ Pendente</span>
      <br><span class="payment-action" onclick="openEditPaymentModal('${req.id}')">💰 Definir</span>
    </td>`;
  }

  // Estado 2: sem pagamento
  if (payment.mode === 'none') {
    const editLink = paidIds.length === 0
      ? `<br><span class="payment-action" onclick="openEditPaymentModal('${req.id}')">✏️ Editar</span>`
      : '';
    return `<td>
      <span class="payment-badge none">🚫 Sem pagamento</span>
      ${editLink}
    </td>`;
  }

  // Estado 3: auto/manual definido, ainda não pago
  if (paidIds.length === 0) {
    const label = payment.mode === 'auto' ? 'Auto' : 'Manual';
    return `<td>
      <span class="payment-badge defined">${label} · ${fmt(payment.value)}</span>
      <br><span class="payment-action" onclick="openEditPaymentModal('${req.id}')">✏️ Editar</span>
    </td>`;
  }

  // Estado 4/5: pago total ou parcial
  const lastPeriodEnd = req.lastPeriodEnd ? req.lastPeriodEnd.toDate() : null;
  const paidMonths = paidIds.map(id => {
    const parts = id.split('_');
    const ym = parts[1] || '';
    const [y, m] = ym.split('-');
    return { year: parseInt(y), month: parseInt(m) };
  }).filter(p => !isNaN(p.month));

  const lastPaid = paidMonths.reduce((max, p) => {
    const val = p.year * 12 + p.month;
    return val > max.val ? { val, month: p.month, year: p.year } : max;
  }, { val: 0, month: 0, year: 0 });

  const mesNome = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  if (lastPeriodEnd && lastPaid.year) {
    const endMonth = lastPeriodEnd.getUTCMonth() + 1;
    const endYear = lastPeriodEnd.getUTCFullYear();
    const endVal = endYear * 12 + endMonth;
    const paidVal = lastPaid.year * 12 + lastPaid.month;

    if (paidVal < endVal) {
      return `<td><span class="payment-badge partial">✓ Parcial · ${mesNome[lastPaid.month]}/${String(lastPaid.year).slice(2)} · resta ${mesNome[endMonth]}/${String(endYear).slice(2)}</span></td>`;
    }
  }

  return `<td><span class="payment-badge paid">✓ Pago em ${mesNome[lastPaid.month]}/${String(lastPaid.year).slice(2)}</span></td>`;
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
    rowsHtml = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text2);">
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
        ${renderPaymentCell(r)}
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
          <th>Professor</th><th>Tipo</th><th>Período(s)</th><th>Dias</th><th>Solicitado</th><th>Status</th><th style="width:160px;">Ações</th><th>Pagamento</th>
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
    ? `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text2);">Nenhum pedido encontrado.</td></tr>`
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
          ${renderPaymentCell(r)}
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
    <div id="feriasBalanceWarning" class="balance-info-box" style="margin-bottom:16px;">
      <div class="preview-loader">Carregando saldo...</div>
    </div>
    <div class="form-group">
      <label>Tipo</label>
      <input type="text" value="${typeLabel} (${teacher.type})" readonly class="input" style="background:var(--surface3);">
    </div>
    <div id="feriasPeriodsContainer">
      <div class="ferias-period" data-idx="0" style="border:1px solid var(--border);padding:12px;border-radius:8px;margin-bottom:8px;">
        <label>1º Período <span style="color:var(--red);">*</span></label>
        <div style="display:flex;gap:8px;">
          <input type="date" class="ferias-period-start input" style="flex:1;" required onchange="updateFeriasBalanceWarning()">
          <span style="align-self:center;">a</span>
          <input type="date" class="ferias-period-end input" style="flex:1;" required onchange="updateFeriasBalanceWarning()">
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
  window._feriasTeacherId = teacherId;

  // Carrega saldo assíncrono
  updateFeriasBalanceWarning();
}

/** Atualiza o bloco de saldo no modal de solicitação conforme períodos preenchidos */
async function updateFeriasBalanceWarning() {
  const warnDiv = document.getElementById('feriasBalanceWarning');
  if (!warnDiv) return;

  const teacherId = window._feriasTeacherId;
  if (!teacherId) return;

  // Calcula total de dias preenchidos
  const periods = collectPeriods();
  let totalDays = 0;
  for (const p of periods) {
    const start = p.startDate instanceof Date ? p.startDate : new Date(p.startDate);
    const end = p.endDate instanceof Date ? p.endDate : new Date(p.endDate);
    if (!isNaN(start) && !isNaN(end)) {
      totalDays += Math.round((end - start) / 86400000) + 1;
    }
  }

  const html = await renderBalanceWarning(teacherId, totalDays);
  warnDiv.innerHTML = html || '<div style="font-size:13px;color:var(--text2);">Saldo não disponível.</div>';
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
      <select id="feriasTeacherSelect" class="input" onchange="onAdminFeriasTeacherChange(this.value)">${opts}</select>
    </div>
    <div id="feriasBalanceWarning" style="margin:8px 0;"></div>
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="feriasForceOverride"> Forçar override de antecedência (admin)
      </label>
    </div>
    <div id="feriasPeriodsContainer">
      <div class="ferias-period" data-idx="0" style="border:1px solid var(--border);padding:12px;border-radius:8px;margin-bottom:8px;">
        <label>1º Período <span style="color:var(--red);">*</span></label>
        <div style="display:flex;gap:8px;">
          <input type="date" class="ferias-period-start input" style="flex:1;" required onchange="updateFeriasBalanceWarning()">
          <span style="align-self:center;">a</span>
          <input type="date" class="ferias-period-end input" style="flex:1;" required onchange="updateFeriasBalanceWarning()">
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
  // Sprint 6c — setar teacher inicial + disparar render do balance warning
  window._feriasTeacherId = document.getElementById('feriasTeacherSelect')?.value || null;
  updateFeriasBalanceWarning();
}

/** Sprint 6c — Handler quando admin troca o professor no select */
async function onAdminFeriasTeacherChange(teacherId) {
  window._feriasTeacherId = teacherId || null;
  await updateFeriasBalanceWarning();
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
      <button class="btn-sm" onclick="this.closest('.ferias-period').remove();window._feriasPeriodCount--;updateFeriasBalanceWarning();" style="float:right;font-size:11px;">✕ Remover</button>
    </label>
    <div style="display:flex;gap:8px;">
      <input type="date" class="ferias-period-start input" style="flex:1;" required onchange="updateFeriasBalanceWarning()">
      <span style="align-self:center;">a</span>
      <input type="date" class="ferias-period-end input" style="flex:1;" required onchange="updateFeriasBalanceWarning()">
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
  let reason = document.getElementById('feriasReason')?.value?.trim() || '';
  const errEl = document.getElementById('feriasValidationError');

  if (!teacherId) { toast('Selecione o professor.', 'error'); return; }
  if (periods.length === 0) { if (errEl) errEl.textContent = 'Informe ao menos 1 período.'; return; }

  // Sprint 6c — mesma validação de soft warning do fluxo do professor
  const totalDays = periods.reduce((s, p) => {
    const start = p.startDate instanceof Date ? p.startDate : new Date(p.startDate);
    const end = p.endDate instanceof Date ? p.endDate : new Date(p.endDate);
    return s + Math.round((end - start) / 86400000) + 1;
  }, 0);
  const balanceRes = await VacationBalanceService.getBalance(teacherId);
  if (balanceRes.success && balanceRes.data.currentPeriod
      && totalDays > balanceRes.data.currentPeriod.daysRemaining) {
    const justification = document.getElementById('excessJustification')?.value?.trim();
    if (!justification) {
      if (errEl) errEl.textContent = 'Justificativa obrigatória para excesso de saldo.';
      toast('Justificativa obrigatória para exceder saldo.', 'error');
      return;
    }
    reason = (reason ? reason + '\n\n' : '') + '⚠️ EXCESSO DE SALDO: ' + justification;
  }

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
  await openApproveWithPaymentModal(reqId);
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 6b — Modal de aprovação com bloco Pagamento
// ═══════════════════════════════════════════════════════════════════════════

async function openApproveWithPaymentModal(reqId) {
  const { VacationPaymentService } = window.ProfHelpers;
  const db = firebase.firestore();
  const doc = await db.collection('vacation_requests').doc(reqId).get();
  if (!doc.exists) { toast('Pedido não encontrado', 'error'); return; }
  const req = { id: doc.id, ...doc.data() };

  const modal = document.getElementById('feriasModal');
  const content = document.getElementById('feriasModalContent');
  if (!modal || !content) return;

  // Pré-carrega dados necessários pro preview
  let salaryData = null;
  try {
    const sDoc = await db.collection('teacher_salaries').doc(req.teacherId).get();
    if (sDoc.exists) salaryData = sDoc.data();
  } catch (_) {}

  // Calcula estimativa auto pra referência (alerta de manual exorbitante)
  let autoEstimate = null;
  if (req.teacherType === 'efetivo') {
    const calc = await VacationPaymentService._calculateEfetivoAuto(req, '');
    if (calc.success) autoEstimate = calc.data.value;
  }

  const isEstagiario = req.teacherType === 'estagiario';
  const defaultPayIntern = VacationPaymentService.getInternPayDefault(
    { type: req.teacherType }, salaryData
  );

  content.innerHTML = `
    <h3>Aprovar Férias — ${escapeHtml(req.teacherName)}</h3>
    <div class="ferias-approve-info">
      <span>📅 ${formatPeriodosFerias(req.periods)}</span>
      <span>📐 ${req.totalDays} dias</span>
      <span>🏖️ ${escapeHtml(req.type)}</span>
    </div>

    <div class="form-group">
      <label>Nota de aprovação (opcional)</label>
      <textarea id="approveNote" rows="2" placeholder="Ex: Aprovado conforme planejamento."></textarea>
    </div>

    <hr>

    <div class="payment-block">
      <h4>💰 Pagamento durante o período</h4>

      <div class="payment-mode-selector">
        <label class="payment-radio active">
          <input type="radio" name="paymentMode" value="auto" checked
            onchange="window._switchPaymentMode('auto')"> Automático
        </label>
        <label class="payment-radio">
          <input type="radio" name="paymentMode" value="manual"
            onchange="window._switchPaymentMode('manual')"> Manual
        </label>
        <label class="payment-radio">
          <input type="radio" name="paymentMode" value="none"
            onchange="window._switchPaymentMode('none')"> Sem pagamento
        </label>
      </div>

      <div id="paymentInternCheck" style="display:${isEstagiario ? 'block' : 'none'};margin:12px 0;">
        <label class="checkbox-label">
          <input type="checkbox" id="payIntern" ${defaultPayIntern ? 'checked' : ''}
            onchange="window._recalcPaymentPreview()">
          Pagar bolsa proporcional ao recesso?
        </label>
        <small class="helper-text">ℹ️ Lei do Estágio (11.788/2008) exige pagamento de recesso quando há bolsa.</small>
      </div>

      <div id="paymentPreview" class="payment-preview" style="display:block;">
        <div class="preview-loader">Calculando...</div>
      </div>

      <div id="paymentManualFields" style="display:none;">
        <div class="form-group">
          <label>Valor (R$)</label>
          <input type="number" id="manualValue" min="0" step="0.01" placeholder="0,00"
            oninput="window._recalcPaymentPreview()">
        </div>
        <div id="manualAlert" class="alert-warning" style="display:none;"></div>
      </div>

      <div id="paymentNoneFields" style="display:none;">
        <p style="font-size:13px;color:#64748b;">Registrar como licença não remunerada.</p>
      </div>

      <div class="form-group" id="paymentNotesGroup">
        <label>Observação</label>
        <textarea id="paymentNotes" rows="2" placeholder="(opcional)"></textarea>
      </div>
    </div>

    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="window._deferPayment('${reqId}')">Adiar pagamento</button>
      <button class="btn btn-secondary" onclick="closeModal('feriasModal')">Cancelar</button>
      <button class="btn btn-primary" id="btnApprovePayment" onclick="window._submitApproveWithPayment('${reqId}')">
        Aprovar e definir pagamento
      </button>
    </div>
  `;

  // Expõe estado no window pra callbacks
  window._paymentReq = req;
  window._paymentAutoEstimate = autoEstimate;
  window._paymentSalaryData = salaryData;

  modal.style.display = 'flex';

  // Dispara preview inicial
  _recalcPaymentPreview();
}

// ─── Helpers expostos ao window ──────────────────────────────────────────

window._switchPaymentMode = function(mode) {
  const previewDiv = document.getElementById('paymentPreview');
  const manualDiv = document.getElementById('paymentManualFields');
  const noneDiv = document.getElementById('paymentNoneFields');
  const internDiv = document.getElementById('paymentInternCheck');

  if (previewDiv) previewDiv.style.display = (mode === 'auto') ? 'block' : 'none';
  if (manualDiv) manualDiv.style.display = (mode === 'manual') ? 'block' : 'none';
  if (noneDiv) noneDiv.style.display = (mode === 'none') ? 'block' : 'none';
  if (internDiv) {
    internDiv.style.display = (mode === 'auto' && window._paymentReq && window._paymentReq.teacherType === 'estagiario') ? 'block' : 'none';
  }

  // Atualiza classes dos radio pills
  document.querySelectorAll('.payment-radio').forEach(el => el.classList.remove('active'));
  const selectedRadio = document.querySelector(`.payment-radio input[value="${mode}"]`);
  if (selectedRadio) selectedRadio.closest('.payment-radio').classList.add('active');

  // Atualiza label de observação
  const notesLabel = document.querySelector('#paymentNotesGroup label');
  if (notesLabel) {
    notesLabel.textContent = (mode === 'none') ? 'Justificativa *' : 'Observação';
  }

  window._recalcPaymentPreview();
};

window._recalcPaymentPreview = async function() {
  const { VacationPaymentService } = window.ProfHelpers;
  const req = window._paymentReq;
  if (!req) return;

  const modeEl = document.querySelector('input[name="paymentMode"]:checked');
  const mode = modeEl ? modeEl.value : 'auto';
  const previewDiv = document.getElementById('paymentPreview');
  if (!previewDiv) return;

  if (mode !== 'auto') {
    // Modo manual: verifica alerta
    if (mode === 'manual') {
      const val = parseFloat(document.getElementById('manualValue')?.value || '0');
      const alertEl = document.getElementById('manualAlert');
      if (alertEl && window._paymentAutoEstimate && val > window._paymentAutoEstimate * 1.5) {
        alertEl.style.display = 'block';
        alertEl.innerHTML = `⚠️ Valor ${Math.round(val/window._paymentAutoEstimate*100)}% acima do automático (R$ ${window._paymentAutoEstimate.toFixed(2)}). Confirme.`;
      } else if (alertEl) {
        alertEl.style.display = 'none';
      }
    }
    previewDiv.style.display = 'none';
    return;
  }

  previewDiv.style.display = 'block';
  previewDiv.innerHTML = '<div class="preview-loader">Calculando...</div>';

  const payIntern = document.getElementById('payIntern')?.checked;
  const notes = document.getElementById('paymentNotes')?.value || '';

  const result = await VacationPaymentService.calculateForRequest(req, {
    mode: 'auto',
    payIntern: req.teacherType === 'estagiario' ? payIntern : undefined,
    notes,
  });

  if (!result.success) {
    previewDiv.innerHTML = `<div class="preview-error">${escapeHtml(result.error)}</div>`;
    return;
  }

  const d = result.data;
  const calc = d.calculation || {};
  let html = '';

  if (calc.formula === 'efetivo-clt-max') {
    html += `
      <div class="preview-line"><span>Base mensal</span><span class="mono">${window.fmt ? window.fmt(calc.baseMonthly) : 'R$ ' + calc.baseMonthly.toFixed(2)}</span></div>
      <div class="preview-sub">↳ média 12m: ${window.fmt ? window.fmt(calc.base12mAvg) : 'R$ ' + calc.base12mAvg.toFixed(2)} | último mês: ${window.fmt ? window.fmt(calc.baseLastMonth) : 'R$ ' + calc.baseLastMonth.toFixed(2)}</div>
      <div class="preview-sub">↳ usado: MAX = ${window.fmt ? window.fmt(calc.baseMonthly) : 'R$ ' + calc.baseMonthly.toFixed(2)}</div>
      <div class="preview-line"><span>Proporcional ${calc.daysCount} dias</span><span class="mono">${window.fmt ? window.fmt(calc.proportionalBase) : 'R$ ' + calc.proportionalBase.toFixed(2)}</span></div>
      <div class="preview-line"><span>⅓ constitucional</span><span class="mono">${window.fmt ? window.fmt(calc.oneThirdValue) : 'R$ ' + calc.oneThirdValue.toFixed(2)}</span></div>
    `;
  } else if (calc.formula === 'estagiario-bolsa-proporcional') {
    html += `
      <div class="preview-line"><span>Bolsa mensal</span><span class="mono">${window.fmt ? window.fmt(calc.baseMonthly) : 'R$ ' + calc.baseMonthly.toFixed(2)}</span></div>
      <div class="preview-line"><span>Proporcional ${calc.daysCount} dias</span><span class="mono">${window.fmt ? window.fmt(calc.proportionalBase) : 'R$ ' + calc.proportionalBase.toFixed(2)}</span></div>
    `;
  }

  html += `<div class="preview-total"><span>💵 Total</span><span class="mono">${window.fmt ? window.fmt(d.value) : 'R$ ' + d.value.toFixed(2)}</span></div>`;
  html += `<div class="preview-info">${calc.monthsConsidered} meses considerados</div>`;
  previewDiv.innerHTML = html;
};

window._submitApproveWithPayment = async function(reqId) {
  const { VacationService, VacationPaymentService } = window.ProfHelpers;

  const modeEl = document.querySelector('input[name="paymentMode"]:checked');
  const mode = modeEl ? modeEl.value : 'auto';
  const note = document.getElementById('approveNote')?.value?.trim() || '';
  const notes = document.getElementById('paymentNotes')?.value?.trim() || '';

  // Validações
  if (mode === 'none' && !notes) {
    toast('Justificativa obrigatória para "Sem pagamento".', 'error'); return;
  }

  let paymentData;
  if (mode === 'auto') {
    const payIntern = document.getElementById('payIntern')?.checked;
    const result = await VacationPaymentService.calculateForRequest(window._paymentReq, {
      mode: 'auto',
      payIntern: window._paymentReq.teacherType === 'estagiario' ? payIntern : undefined,
      notes,
    });
    if (!result.success) { toast(result.error, 'error'); return; }
    paymentData = result.data;
  } else if (mode === 'manual') {
    const val = parseFloat(document.getElementById('manualValue')?.value || '0');
    if (isNaN(val) || val < 0) { toast('Valor manual inválido.', 'error'); return; }
    if (val === 0 && !notes) { toast('Observação obrigatória se valor é zero.', 'error'); return; }
    paymentData = { mode: 'manual', value: val, calculation: null, notes: notes || null };
  } else {
    paymentData = { mode: 'none', value: 0, calculation: null, notes };
  }

  const approveRes = await VacationService.approve(reqId, note, paymentData);
  if (approveRes.success) {
    toast('Férias aprovadas com pagamento definido!', 'success');
    closeModal('feriasModal');
    await renderFeriasGestaoPage();
  } else {
    toast('Erro: ' + (approveRes.error || 'Falha'), 'error');
  }
};

window._deferPayment = async function(reqId) {
  const { VacationService } = window.ProfHelpers;
  if (!confirm('Adiar definição de pagamento? As férias serão aprovadas, mas o pagamento ficará pendente.')) return;

  const note = document.getElementById('approveNote')?.value?.trim() || '';
  const paymentData = { mode: 'deferred', value: 0, calculation: null, notes: 'Pagamento adiado pelo admin' };

  const res = await VacationService.approve(reqId, note, paymentData);
  if (res.success) {
    toast('Férias aprovadas (pagamento pendente).', 'success');
    closeModal('feriasModal');
    await renderFeriasGestaoPage();
  } else {
    toast('Erro: ' + (res.error || 'Falha'), 'error');
  }
};

// Helper pra formatar períodos no modal
function formatPeriodosFerias(periods) {
  if (!Array.isArray(periods)) return '';
  return periods.map(p => {
    const start = p.startDate.toDate ? p.startDate.toDate() : new Date(p.startDate);
    const end = p.endDate.toDate ? p.endDate.toDate() : new Date(p.endDate);
    return start.toLocaleDateString('pt-BR') + ' – ' + end.toLocaleDateString('pt-BR');
  }).join(' · ');
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 6b — Modal de edição de pagamento
// ═══════════════════════════════════════════════════════════════════════════

async function openEditPaymentModal(reqId) {
  const { VacationPaymentService } = window.ProfHelpers;
  const db = firebase.firestore();
  const doc = await db.collection('vacation_requests').doc(reqId).get();
  if (!doc.exists) { toast('Pedido não encontrado', 'error'); return; }
  const req = { id: doc.id, ...doc.data() };

  if ((req.paidInClosingIds || []).length > 0) {
    toast('Pagamento já processado em fechamento — não pode ser editado.', 'error');
    return;
  }

  const modal = document.getElementById('feriasModal');
  const content = document.getElementById('feriasModalContent');
  if (!modal || !content) return;

  const existingPayment = req.payment || {};
  const currentMode = existingPayment.mode === 'deferred' ? 'auto' : (existingPayment.mode || 'auto');

  // Pré-carrega estimativa auto
  let autoEstimate = null;
  if (req.teacherType === 'efetivo') {
    const calc = await VacationPaymentService._calculateEfetivoAuto(req, '');
    if (calc.success) autoEstimate = calc.data.value;
  }

  window._paymentReq = req;
  window._paymentAutoEstimate = autoEstimate;

  content.innerHTML = `
    <h3>✏️ Editar Pagamento</h3>
    <div class="ferias-approve-info">
      <span><strong>${escapeHtml(req.teacherName)}</strong></span>
      <span>📅 ${formatPeriodosFerias(req.periods)}</span>
      <span>📐 ${req.totalDays} dias</span>
    </div>

    <div class="payment-block">
      <div class="payment-mode-selector">
        <label class="payment-radio ${currentMode === 'auto' ? 'active' : ''}">
          <input type="radio" name="paymentMode" value="auto" ${currentMode === 'auto' ? 'checked' : ''}
            onchange="window._switchPaymentMode('auto')"> Automático
        </label>
        <label class="payment-radio ${currentMode === 'manual' ? 'active' : ''}">
          <input type="radio" name="paymentMode" value="manual" ${currentMode === 'manual' ? 'checked' : ''}
            onchange="window._switchPaymentMode('manual')"> Manual
        </label>
        <label class="payment-radio ${currentMode === 'none' ? 'active' : ''}">
          <input type="radio" name="paymentMode" value="none" ${currentMode === 'none' ? 'checked' : ''}
            onchange="window._switchPaymentMode('none')"> Sem pagamento
        </label>
      </div>

      <div id="paymentPreview" class="payment-preview" style="display:${currentMode === 'auto' ? 'block' : 'none'};"></div>

      <div id="paymentManualFields" style="display:${currentMode === 'manual' ? 'block' : 'none'};">
        <div class="form-group">
          <label>Valor (R$)</label>
          <input type="number" id="manualValue" min="0" step="0.01" value="${existingPayment.value || ''}"
            oninput="window._recalcPaymentPreview()">
        </div>
        <div id="manualAlert" class="alert-warning" style="display:none;"></div>
      </div>

      <div id="paymentNoneFields" style="display:${currentMode === 'none' ? 'block' : 'none'};">
        <p style="font-size:13px;color:#64748b;">Registrar como licença não remunerada.</p>
      </div>

      <div class="form-group" id="paymentNotesGroup">
        <label>${currentMode === 'none' ? 'Justificativa *' : 'Observação'}</label>
        <textarea id="paymentNotes" rows="2" placeholder="(opcional)">${escapeHtml(existingPayment.notes || '')}</textarea>
      </div>
    </div>

    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal('feriasModal')">Cancelar</button>
      <button class="btn btn-primary" onclick="window._submitEditPayment('${reqId}')">💾 Salvar pagamento</button>
    </div>
  `;

  if (currentMode === 'auto') _recalcPaymentPreview();
  modal.style.display = 'flex';
}

window._submitEditPayment = async function(reqId) {
  const { VacationPaymentService } = window.ProfHelpers;

  const modeEl = document.querySelector('input[name="paymentMode"]:checked');
  const mode = modeEl ? modeEl.value : 'auto';
  const notes = document.getElementById('paymentNotes')?.value?.trim() || '';

  let paymentData;
  if (mode === 'auto') {
    const result = await VacationPaymentService.calculateForRequest(window._paymentReq, { mode: 'auto', notes });
    if (!result.success) { toast(result.error, 'error'); return; }
    paymentData = result.data;
  } else if (mode === 'manual') {
    const val = parseFloat(document.getElementById('manualValue')?.value || '0');
    if (isNaN(val) || val < 0) { toast('Valor inválido.', 'error'); return; }
    if (val === 0 && !notes) { toast('Observação obrigatória se valor é zero.', 'error'); return; }
    paymentData = { mode: 'manual', value: val, calculation: null, notes: notes || null };
  } else {
    if (!notes) { toast('Justificativa obrigatória.', 'error'); return; }
    paymentData = { mode: 'none', value: 0, calculation: null, notes };
  }

  const res = await VacationPaymentService.updatePayment(reqId, paymentData);
  if (res.success) {
    toast('Pagamento atualizado!', 'success');
    closeModal('feriasModal');
    await renderFeriasGestaoPage();
  } else {
    toast('Erro: ' + (res.error || 'Falha'), 'error');
  }
};

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

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 6c — Painel Admin "📊 Saldos de Férias"
// ═══════════════════════════════════════════════════════════════════════════

function statusLabel(s) {
  return s === 'ok' ? '🟢 OK' : s === 'warning' ? '🟡 Vencendo' : '🔴 VENCIDA';
}

async function renderSaldosGestaoPage() {
  const container = document.getElementById('page-saldos-gestao');
  if (!container) return;

  container.innerHTML = '<div class="loader">Calculando saldos...</div>';

  const all = await VacationBalanceService.getAllBalances();
  if (!all.success) {
    container.innerHTML = '<div class="error">' + escapeHtml(all.error || 'Erro') + '</div>';
    return;
  }

  const balances = all.data;
  const overdueCount = balances.filter(b => b.status === 'overdue').length;
  const warningCount = balances.filter(b => b.status === 'warning').length;

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';

  container.innerHTML = `
    <div class="page-hdr">
      <h1>📊 Saldos de Férias</h1>
      <p>Controle de saldo por período aquisitivo CLT. Dados computados em tempo real.</p>
    </div>

    ${overdueCount > 0 ? `
      <div class="alert-overdue-card">
        <div class="alert-overdue-title">🚨 ATENÇÃO: ${overdueCount} professor(es) com férias vencidas</div>
        <div class="alert-overdue-list">${balances.filter(b => b.status === 'overdue')
          .map(b => `${escapeHtml(b.teacherName)} (${b.grantPeriod.daysOverdue}d vencidos)`).join(' · ')}</div>
        <div class="alert-overdue-note">CLT exige pagamento dobrado após período concessivo. Agendar urgente.</div>
      </div>
    ` : ''}

    ${warningCount > 0 ? `
      <div class="alert-warning-card">
        ⚠️ ${warningCount} professor(es) com período aquisitivo expirado (concessivo ativo)
      </div>
    ` : ''}

    <div class="page-toolbar">
      <div class="lhs"><h2>Todos os professores <span class="count">${balances.length}</span></h2></div>
    </div>

    <div class="table-wrap">
      <table class="balances-table">
        <thead>
          <tr>
            <th>Professor</th><th>Tipo</th><th>Período Atual</th>
            <th>Tirados</th><th>Restantes</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${balances.map(b => `
            <tr class="balance-row status-${b.status}" onclick="openBalanceDetailModal('${b.teacherId}')" style="cursor:pointer;">
              <td>${escapeHtml(b.teacherName)}${b.estimatedStartDate ? ' <span class="badge-est">~est</span>' : ''}</td>
              <td>${escapeHtml(b.teacherType)}</td>
              <td>${b.currentPeriod ? b.currentPeriod.index + 'º · ' + fmtDate(b.currentPeriod.startDate) + ' - ' + fmtDate(b.currentPeriod.endDate) : '—'}</td>
              <td>${b.currentPeriod ? b.currentPeriod.daysTaken : 0}</td>
              <td><strong>${b.currentPeriod ? b.currentPeriod.daysRemaining : 30}</strong></td>
              <td><span class="status-badge ${b.status}">${statusLabel(b.status)}</span></td>
              <td><span class="detail-link">Detalhes →</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div id="balanceDetailModal" class="modal"><div class="modal-content modal-content-wide" id="balanceDetailModalContent"></div></div>
  `;

  // Dispara checkAndLogOverdue em background (idempotente)
  VacationBalanceService.checkAndLogOverdue().catch(console.warn);
}

async function openBalanceDetailModal(teacherId) {
  const modal = document.getElementById('balanceDetailModal');
  const content = document.getElementById('balanceDetailModalContent');
  if (!modal || !content) return;

  content.innerHTML = '<div class="loader">Carregando...</div>';
  modal.style.display = 'flex';

  const res = await VacationBalanceService.getBalance(teacherId);
  if (!res.success) {
    content.innerHTML = '<div class="error">' + escapeHtml(res.error || 'Erro') + '</div>';
    return;
  }

  const b = res.data;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';

  const historyRows = b.history.length === 0
    ? '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text2);">Nenhum período aquisitivo anterior.</td></tr>'
    : b.history.map(h => {
        const statusLabels = { closed: '✅ Completas', expired: '⏰ Expiradas', pending: '🟡 Pendentes' };
        return `
          <tr>
            <td>${h.index}º</td>
            <td>${fmtDate(h.startDate)} - ${fmtDate(h.endDate)}</td>
            <td>${h.entitledDays}</td>
            <td>${h.daysTaken}</td>
            <td>${h.daysRemaining}</td>
            <td>${statusLabels[h.status] || h.status}</td>
          </tr>
        `;
      }).join('');

  content.innerHTML = `
    <div class="modal-header">
      <h3>📊 Histórico de Férias</h3>
      <button class="close-btn" onclick="document.getElementById('balanceDetailModal').style.display='none'">✕</button>
    </div>

    <div class="detail-header">
      <div class="detail-teacher-name">${escapeHtml(b.teacherName)}</div>
      <div class="detail-teacher-type">${escapeHtml(b.teacherType)}${b.estimatedStartDate ? ' · <span class="badge-est">data estimada — confirme com admin</span>' : ''}</div>
    </div>

    ${b.currentPeriod ? `
      <div class="detail-current-card status-${b.status}">
        <h4>Período Atual (${b.currentPeriod.index}º)</h4>
        <div class="detail-current-dates">${fmtDate(b.currentPeriod.startDate)} - ${fmtDate(b.currentPeriod.endDate)}</div>
        <div class="detail-current-stats">
          <div class="stat"><span class="stat-label">Direito</span><span class="stat-value">${b.currentPeriod.entitledDays} dias</span></div>
          <div class="stat"><span class="stat-label">Tirados</span><span class="stat-value">${b.currentPeriod.daysTaken} dias</span></div>
          <div class="stat"><span class="stat-label">Restantes</span><span class="stat-value highlight">${b.currentPeriod.daysRemaining} dias</span></div>
        </div>
        <div class="detail-status">Status: <span class="status-badge ${b.status}">${statusLabel(b.status)}</span></div>
        ${b.grantPeriod && b.grantPeriod.deadlineDate ? `
          <div style="font-size:13px;color:var(--text2);margin-top:4px;">Prazo concessivo: ${fmtDate(b.grantPeriod.deadlineDate)}${b.grantPeriod.daysOverdue > 0 ? ' (' + b.grantPeriod.daysOverdue + ' dias vencidos)' : ''}</div>
        ` : ''}
      </div>
    ` : ''}

    <h4 style="margin-top:24px;">Histórico de Períodos</h4>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Período</th><th>Vigência</th><th>Direito</th><th>Tirados</th><th>Restantes</th><th>Status</th>
        </tr></thead>
        <tbody>${historyRows}</tbody>
      </table>
    </div>
  `;

  // Click fora fecha
  modal.onclick = function(e) {
    if (e.target === modal) modal.style.display = 'none';
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 6c — Painel Professor "📊 Meu Saldo"
// ═══════════════════════════════════════════════════════════════════════════

async function renderMeuSaldoPage() {
  const container = document.getElementById('page-meu-saldo');
  if (!container) return;

  const teacherId = getCurrentProfessorId();
  if (!teacherId) {
    container.innerHTML = `<div class="page-hdr"><h1>📊 Meu Saldo</h1>
      <p style="color:var(--text2);">Nenhum professor vinculado ao seu usuário.</p></div>`;
    return;
  }

  const res = await VacationBalanceService.getBalance(teacherId);

  if (!res.success) {
    // Eventual ou sem dados
    const isEventual = res.error && res.error.includes('Eventuais');
    container.innerHTML = `
      <div class="page-hdr"><h1>📊 Meu Saldo de Férias</h1></div>
      <div style="text-align:center;padding:60px 20px;color:var(--text2);">
        <div style="font-size:48px;margin-bottom:16px;">${isEventual ? '🏖️' : '📊'}</div>
        <p>${isEventual ? 'Professores eventuais não têm direito formal a férias. Fale com a gestão se precisar se ausentar.' : escapeHtml(res.error || 'Sem dados disponíveis.')}</p>
      </div>`;
    return;
  }

  const b = res.data;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';

  const historyRows = b.history.length === 0
    ? '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text2);">Nenhum período aquisitivo anterior.</td></tr>'
    : b.history.map(h => {
        const statusLabels = { closed: '✅ Completo', expired: '⏰ Expirado', pending: '🟡 Pendente' };
        return `
          <tr>
            <td>${h.index}º</td>
            <td>${fmtDate(h.startDate)} - ${fmtDate(h.endDate)}</td>
            <td>${h.entitledDays}</td>
            <td>${h.daysTaken} / ${h.entitledDays}</td>
            <td>${statusLabels[h.status] || h.status}</td>
          </tr>
        `;
      }).join('');

  container.innerHTML = `
    <div class="page-hdr">
      <h1>📊 Meu Saldo de Férias</h1>
    </div>

    ${b.estimatedStartDate ? `
      <div class="alert-warning-card">
        ⚠️ Data de admissão estimada (não cadastrada no sistema). Confirme com o admin para cálculo preciso.
      </div>
    ` : ''}

    ${b.currentPeriod ? `
      <div class="meu-saldo-card status-${b.status}">
        <div class="meu-saldo-big-number">${b.currentPeriod.daysRemaining}</div>
        <div class="meu-saldo-big-label">dias disponíveis até ${fmtDate(b.currentPeriod.endDate)}</div>
        <div class="meu-saldo-sub">
          Período aquisitivo ${b.currentPeriod.index}º: ${fmtDate(b.currentPeriod.startDate)} - ${fmtDate(b.currentPeriod.endDate)}
          &nbsp;·&nbsp; Já tirou <strong>${b.currentPeriod.daysTaken}</strong> de <strong>${b.currentPeriod.entitledDays}</strong> dias
        </div>
        ${b.grantPeriod && b.grantPeriod.deadlineDate ? `
          <div style="font-size:13px;color:var(--text2);margin-top:8px;">
            Prazo para tirar: ${fmtDate(b.grantPeriod.deadlineDate)}
            <span class="status-badge ${b.status}" style="margin-left:8px;">${statusLabel(b.status)}</span>
          </div>
        ` : ''}
        <button class="btn-primary" onclick="openFeriasRequestModal()" style="margin-top:16px;">+ Solicitar férias</button>
      </div>
    ` : ''}

    <div class="page-toolbar" style="margin-top:24px;">
      <div class="lhs"><h2>Histórico <span class="count">${b.history.length}</span></h2></div>
    </div>

    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Período</th><th>Vigência</th><th>Direito (dias)</th><th>Tirado</th><th>Status</th>
        </tr></thead>
        <tbody>${historyRows}</tbody>
      </table>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 6c — Aviso inline + soft warning no modal de solicitação
// ═══════════════════════════════════════════════════════════════════════════

async function renderBalanceWarning(teacherId, requestedDays) {
  const balanceRes = await VacationBalanceService.getBalance(teacherId);
  if (!balanceRes.success) return ''; // eventual ou sem dados
  const b = balanceRes.data;
  if (!b.currentPeriod) return '';

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '';
  let html = `
    <div class="balance-info-box">
      <strong>📊 Seu saldo atual</strong>
      <div>Período aquisitivo ${b.currentPeriod.index}º: ${fmtDate(b.currentPeriod.startDate)} - ${fmtDate(b.currentPeriod.endDate)}</div>
      <div>Já tirou: <strong>${b.currentPeriod.daysTaken}</strong> dias · Restam: <strong>${b.currentPeriod.daysRemaining}</strong> dias</div>
    </div>
  `;

  if (requestedDays > b.currentPeriod.daysRemaining) {
    const excess = requestedDays - b.currentPeriod.daysRemaining;
    html += `
      <div class="balance-warning-box">
        ⚠️ Este pedido excede o saldo do período em <strong>${excess} dias</strong>.
        Você está pedindo ${requestedDays} dias, mas só restam ${b.currentPeriod.daysRemaining}.
      </div>
      <div class="form-group">
        <label>Justificativa (obrigatória)*</label>
        <textarea id="excessJustification" rows="2" class="input" placeholder="Explique o motivo do excesso de saldo"></textarea>
      </div>
    `;
  }

  return html;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 6c — Submit com validação de saldo (soft warning)
// ═══════════════════════════════════════════════════════════════════════════

async function submitFeriasRequestComSaldo() {
  const teacherId = getCurrentProfessorId();
  const periods = collectPeriods();
  const reason = document.getElementById('feriasReason')?.value?.trim() || '';
  const errEl = document.getElementById('feriasValidationError');

  if (periods.length === 0) {
    if (errEl) errEl.textContent = 'Informe ao menos 1 período.';
    return;
  }

  // Calcula total de dias do pedido
  const totalDays = periods.reduce((s, p) => {
    const start = p.startDate instanceof Date ? p.startDate : new Date(p.startDate);
    const end = p.endDate instanceof Date ? p.endDate : new Date(p.endDate);
    return s + Math.round((end - start) / 86400000) + 1;
  }, 0);

  // Verifica saldo
  const balanceRes = await VacationBalanceService.getBalance(teacherId);
  if (balanceRes.success && balanceRes.data.currentPeriod) {
    const daysRemaining = balanceRes.data.currentPeriod.daysRemaining;
    if (totalDays > daysRemaining) {
      const justification = document.getElementById('excessJustification')?.value?.trim();
      if (!justification) {
        if (errEl) errEl.textContent = 'Justificativa obrigatória para excesso de saldo.';
        toast('Justificativa obrigatória para exceder saldo.', 'error');
        return;
      }
      // Combina reason com justificativa de excesso
      const finalReason = (reason ? reason + '\n\n' : '') + '⚠️ EXCESSO DE SALDO: ' + justification;
      const res = await VacationService.request({ teacherId, periods, reason: finalReason.trim() });
      if (res.success) {
        toast('Solicitação enviada com justificativa de excesso!', 'success');
        closeFeriasModal();
        await renderMinhasFeriasPage();
      } else {
        if (errEl) errEl.textContent = res.error || 'Erro ao solicitar.';
        toast(res.error || 'Erro', 'error');
      }
      return;
    }
  }

  // Fluxo normal (sem excesso)
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

// Expor globalmente
window.renderMinhasFeriasPage = renderMinhasFeriasPage;
window.renderFeriasGestaoPage = renderFeriasGestaoPage;
window.renderSaldosGestaoPage = renderSaldosGestaoPage;
window.renderMeuSaldoPage = renderMeuSaldoPage;
window.openBalanceDetailModal = openBalanceDetailModal;
window.openFeriasRequestModal = openFeriasRequestModal;
window.openFeriasRequestModalAdmin = openFeriasRequestModalAdmin;
window.onAdminFeriasTeacherChange = onAdminFeriasTeacherChange;
window.closeFeriasModal = closeFeriasModal;
window.addFeriasPeriod = addFeriasPeriod;
window.submitFeriasRequest = submitFeriasRequestComSaldo;
window.submitFeriasRequestAdmin = submitFeriasRequestAdmin;
window.aprovarVacation = aprovarVacation;
window.recusarVacation = recusarVacation;
window.cancelarVacation = cancelarVacation;
window.cancelarVacationAdmin = cancelarVacationAdmin;
window.filtrarFeriasPorStatus = filtrarFeriasPorStatus;
window.closeModal = closeModal;
window.openEditPaymentModal = openEditPaymentModal;
window.renderBalanceWarning = renderBalanceWarning;
window.updateFeriasBalanceWarning = updateFeriasBalanceWarning;

console.log('[CrossTainer Professores] professores-ferias.js carregado · Sprint 6a + 6c');
