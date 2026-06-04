// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Módulo Professores · Fechamento Mensal
// Sprint 4a
//
// Responsabilidades:
//   1. Tela de preview — consolida classes do mês por professor
//   2. Tela de fechamento fechado — read-only com snapshot
//   3. Modal de confirmação antes de fechar
//   4. Tela de Histórico de fechamentos
//   5. Chamada à Cloud Function closeMonth
//
// Regras de negócio aplicadas:
//   - D1: apenas admin (não admin_gestao) pode fechar
//   - D2: fecha o mês inteiro de uma vez (sem parcial)
//   - D9: status que contam = realizada + substituida
//   - P02: feriado conta em dobro (calculateTeacherHours)
//   - D6: estagiário com limite via internMonthlyLimitMinutes
// ═══════════════════════════════════════════════════════════════════════

'use strict';

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

// ─── Estado local ──────────────────────────────────────────────────────
const FechamentoState = {
  units: [],
  selectedUnitId: null,
  selectedYear: null,
  selectedMonth: null,
  previewData: null,    // resultado de ClosingService.preview()
  closingDoc: null,     // doc de monthly_closings (se já fechado)
  mode: 'select',       // 'select' | 'preview' | 'closed' | 'history'
  history: [],
};

// ─── Entry point ───────────────────────────────────────────────────────
async function renderFechamentoPage() {
  const page = document.getElementById('page-fechamento');
  if (!page) return;

  // Carrega unidades (fresco)
  const unitRes = await UnitService.list();
  if (unitRes.success) {
    FechamentoState.units = unitRes.data.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  // Default: mantém seleção anterior ou primeiro da lista
  if (!FechamentoState.selectedUnitId && FechamentoState.units.length > 0) {
    FechamentoState.selectedUnitId = FechamentoState.units[0].id;
  }

  // Default ano/mês: mês corrente
  const now = new Date();
  if (!FechamentoState.selectedYear)  FechamentoState.selectedYear = now.getFullYear();
  if (!FechamentoState.selectedMonth) FechamentoState.selectedMonth = now.getMonth() + 1;

  // Se modo é 'select', limpa dados anteriores
  if (FechamentoState.mode === 'select') {
    FechamentoState.previewData = null;
    FechamentoState.closingDoc = null;
  }

  renderFechamentoUI();
}

// ─── Render principal ──────────────────────────────────────────────────
function renderFechamentoUI() {
  const page = document.getElementById('page-fechamento');

  page.innerHTML = `
    <div class="page-hdr">
      <h1>💰 Fechamento Mensal</h1>
      <p>Consolidar aulas do mês, calcular valores e congelar período.</p>
    </div>

    <!-- Toolbar -->
    <div class="page-toolbar" id="fechamentoToolbar"></div>

    <!-- Conteúdo (preview / closed / history) -->
    <div id="fechamentoContent"></div>

    <!-- Modal de confirmação (oculto por padrão) -->
    <div class="modal" id="closeMonthConfirmModal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>Confirmar fechamento</h3>
          <button class="close-btn" onclick="closeConfirmModal()">✕</button>
        </div>
        <div id="closeMonthConfirmBody"></div>
        <div class="error-msg" id="closeMonthConfirmError"></div>
        <div class="form-actions">
          <button class="btn btn-ghost" onclick="closeConfirmModal()">Cancelar</button>
          <button class="btn" id="closeMonthConfirmBtn" onclick="executeCloseMonth()">
            Confirmar fechamento
          </button>
        </div>
      </div>
    </div>
  `;

  renderFechamentoToolbar();

  // Renderiza conteúdo conforme modo
  if (FechamentoState.mode === 'history') {
    renderHistoryContent();
  } else if (FechamentoState.mode === 'closed' && FechamentoState.closingDoc) {
    renderClosedContent();
  } else if (FechamentoState.mode === 'preview' && FechamentoState.previewData) {
    renderPreviewContent();
  } else {
    // Empty state inicial
    document.getElementById('fechamentoContent').innerHTML = `
      <div class="empty-state">
        <div class="icon">💰</div>
        <h3>Selecione unidade e mês</h3>
        <p>Escolha a unidade e o período acima e clique em "Carregar preview".</p>
      </div>
    `;
  }
}

// ─── Toolbar ───────────────────────────────────────────────────────────
function renderFechamentoToolbar() {
  const toolbar = document.getElementById('fechamentoToolbar');
  if (!toolbar) return;

  const months = MONTH_NAMES.map((name, i) =>
    `<option value="${i + 1}" ${(i + 1) === FechamentoState.selectedMonth ? 'selected' : ''}>${name}</option>`
  ).join('');

  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear - 1; y <= currentYear + 1; y++) {
    years.push(`<option value="${y}" ${y === FechamentoState.selectedYear ? 'selected' : ''}>${y}</option>`);
  }

  // Unidades carregadas
  const unitOptions = FechamentoState.units.map(u =>
    `<option value="${u.id}" ${u.id === FechamentoState.selectedUnitId ? 'selected' : ''}>${escapeHtml(u.name || u.id)}</option>`
  ).join('');

  toolbar.innerHTML = `
    <div class="lhs">
      <h2>Fechamento</h2>
      <div class="count" id="fechamentoSubtitle"></div>
    </div>
    <div class="rhs" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <div class="agenda-unit-select">
        <span class="filter-label">Unidade</span>
        <select id="fechamentoUnitSelect" onchange="onFechamentoUnitChange(this.value)">
          ${unitOptions}
        </select>
      </div>
      <div class="agenda-unit-select">
        <span class="filter-label">Mês</span>
        <select id="fechamentoMonthSelect" onchange="onFechamentoPeriodChange()">
          ${months}
        </select>
      </div>
      <div class="agenda-unit-select">
        <span class="filter-label">Ano</span>
        <select id="fechamentoYearSelect" onchange="onFechamentoPeriodChange()">
          ${years.join('')}
        </select>
      </div>
      <button class="btn btn-sm" onclick="loadFechamentoPreview()" style="width:auto;">
        Carregar preview
      </button>
      <button class="btn btn-sm btn-ghost" onclick="showFechamentoHistory()" style="width:auto;">
        📜 Histórico
      </button>
    </div>
  `;
}

// ─── Handlers dos selects ──────────────────────────────────────────────
function onFechamentoUnitChange(val) {
  FechamentoState.selectedUnitId = val;
  FechamentoState.mode = 'select';
  FechamentoState.previewData = null;
  FechamentoState.closingDoc = null;
  // Atualiza toolbar sem perder seleção
  renderFechamentoUI();
}

function onFechamentoPeriodChange() {
  const mSel = document.getElementById('fechamentoMonthSelect');
  const ySel = document.getElementById('fechamentoYearSelect');
  if (mSel) FechamentoState.selectedMonth = parseInt(mSel.value);
  if (ySel) FechamentoState.selectedYear = parseInt(ySel.value);
}

// ─── Load preview ──────────────────────────────────────────────────────
async function loadFechamentoPreview() {
  // Atualiza seleções
  onFechamentoPeriodChange();

  const { selectedUnitId, selectedYear, selectedMonth } = FechamentoState;
  if (!selectedUnitId) {
    toast('Selecione uma unidade.', 'error');
    return;
  }

  // Mostra loading
  document.getElementById('fechamentoContent').innerHTML = `
    <div class="loading"><div class="spinner"></div> Consolidando aulas...</div>
  `;

  // 1) Verifica se já existe fechamento
  const closingId = ClosingService.getClosingId(selectedUnitId, selectedYear, selectedMonth);
  const closingRes = await ClosingService.getById(closingId);

  if (closingRes.success) {
    // Já fechado — vai pro modo closed
    FechamentoState.closingDoc = closingRes.data;
    FechamentoState.mode = 'closed';
    FechamentoState.previewData = null;
    renderFechamentoUI();
    return;
  }

  // 2) Não fechado — faz preview
  const res = await ClosingService.preview(selectedUnitId, selectedYear, selectedMonth);

  if (!res.success) {
    document.getElementById('fechamentoContent').innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <h3>Erro ao carregar</h3>
        <p>${escapeHtml(res.error || 'Erro desconhecido')}</p>
      </div>
    `;
    toast(res.error || 'Erro ao carregar preview', 'error');
    return;
  }

  FechamentoState.previewData = res.data;
  FechamentoState.mode = 'preview';
  FechamentoState.closingDoc = null;
  renderFechamentoUI();
}

// ─── Preview content ───────────────────────────────────────────────────
function renderPreviewContent() {
  const container = document.getElementById('fechamentoContent');
  const data = FechamentoState.previewData;
  if (!data) return;

  const { teachers, totals, isEmpty } = data;

  if (isEmpty || teachers.length === 0) {
    const monthName = MONTH_NAMES[FechamentoState.selectedMonth - 1];
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📭</div>
        <h3>Nenhuma aula encontrada</h3>
        <p>Não há aulas realizadas ou substituídas em ${monthName}/${FechamentoState.selectedYear} nesta unidade.</p>
        <p style="font-size:12px;color:var(--text3);margin-top:8px;">
          Apenas aulas com status "Realizada" ou "Substituída" entram no fechamento.
        </p>
      </div>
    `;
    updateFechamentoSubtitle(0, 0);
    return;
  }

  const canClose = typeof isStrictAdmin === 'function' && isStrictAdmin();

  container.innerHTML = `
    <div style="margin-bottom:16px;">
      ${renderTeacherTable(teachers, totals, false)}
    </div>
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px;">
      ${canClose ? `
        <button class="btn" onclick="showCloseConfirmModal()" style="width:auto;">
          🔒 Fechar mês
        </button>
      ` : `
        <div class="info-callout" style="max-width:400px;">
          ℹ️ Apenas <strong>Administrador</strong> pode executar o fechamento.
        </div>
      `}
    </div>
  `;

  updateFechamentoSubtitle(totals.classesRealizadas, totals.totalValor);
}

// ─── Closed content ────────────────────────────────────────────────────
function renderClosedContent() {
  const container = document.getElementById('fechamentoContent');
  const doc = FechamentoState.closingDoc;
  if (!doc) return;

  const monthName = MONTH_NAMES[(doc.month || FechamentoState.selectedMonth) - 1];
  const closedDate = doc.closedAt && doc.closedAt.toDate ? doc.closedAt.toDate() : new Date();
  const dateStr = closedDate.toLocaleDateString('pt-BR');

  const unit = FechamentoState.units.find(u => u.id === doc.unitId);
  const unitName = unit ? unit.name : doc.unitId;

  const teachers = Array.isArray(doc.teachers) ? doc.teachers : [];
  const totals = doc.totals || { classesRealizadas: 0, totalHoras: 0, totalValor: 0 };

  container.innerHTML = `
    <div class="info-callout" style="margin-bottom:16px;border-left:3px solid var(--green);">
      <p><strong>🔒 Mês fechado</strong> — ${monthName}/${doc.year} — ${unitName}</p>
      <p>Fechado em ${dateStr} por ${escapeHtml(doc.closedByName || '—')}.</p>
      <p style="font-size:11px;color:var(--text3);margin-top:4px;">
        Aulas deste período estão congeladas e não podem ser alteradas.
      </p>
    </div>
    ${renderTeacherTable(teachers, totals, true)}
  `;

  updateFechamentoSubtitle(totals.classesRealizadas, totals.totalValor);
}

// ─── Tabela de professores (compartilhada preview e closed) ────────────
function renderTeacherTable(teachers, totals, readOnly) {
  if (!teachers.length) {
    return `<div class="empty-state-small">Nenhum professor com aulas no período.</div>`;
  }

  const rows = teachers.map(t => {
    const typeLabel = { efetivo: 'Efetivo', estagiario: 'Estagiário', eventual: 'Eventual' }[t.teacherType] || t.teacherType;
    const outrosList = Array.isArray(t.otherBenefits) && t.otherBenefits.length > 0
      ? t.otherBenefits.map(b => `${escapeHtml(b.nome || '?')}: ${fmt(b.valor || 0)}`).join('<br>')
      : '—';

    const hasVacation = t.vacationValue > 0;
    const vacRow = hasVacation ? `
      <tr class="${t.isVacationOnly ? 'row-vacation-only' : 'row-vacation'}">
        <td colspan="8" style="text-align:right;font-size:12px;padding:6px 12px;">
          🏖️ Férias: ${(t.vacationDetails || []).map(vd =>
            `${vd.daysInMonth} dia(s) · ${vd.paymentMode === 'auto' ? 'Automático' : vd.paymentMode === 'manual' ? 'Manual' : vd.paymentMode} · ${fmt(vd.proportionalValue)}`
          ).join(' | ')}
          ${t.isVacationOnly ? '<br><em>Período sem aulas — pagamento exclusivo de férias</em>' : ''}
        </td>
      </tr>
    ` : '';

    return `
      <tr>
        <td>
          <div style="font-weight:600;">${escapeHtml(t.teacherName)}</div>
          <div style="font-size:10px;color:var(--text3);">${typeLabel}${t.isInternProportional ? ' · Excedente' : ''}</div>
        </td>
        <td class="mono" style="text-align:center;">${t.classesCount}</td>
        <td class="mono" style="text-align:right;">${t.totalHoras.toFixed(1)}h</td>
        <td class="mono" style="text-align:right;">${fmt(t.valorHoras)}</td>
        <td class="mono" style="text-align:right;">${fmt(t.mealAllowance)}</td>
        <td class="mono" style="text-align:right;">${fmt(t.transportAllowance)}</td>
        <td style="text-align:right;font-size:12px;">${outrosList}</td>
        <td class="mono" style="text-align:right;font-weight:700;">${fmt(t.valorTotal)}</td>
      </tr>
      ${vacRow}
    `;
  }).join('');

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Professor</th>
            <th style="text-align:center;width:60px;">Aulas</th>
            <th style="text-align:right;width:70px;">Horas</th>
            <th style="text-align:right;width:110px;">R$ Horas</th>
            <th style="text-align:right;width:80px;">VR</th>
            <th style="text-align:right;width:80px;">VT</th>
            <th style="text-align:right;width:120px;">Outros</th>
            <th style="text-align:right;width:120px;">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
        <tfoot>
          <tr style="background:var(--surface2);font-weight:700;">
            <td>TOTAL</td>
            <td class="mono" style="text-align:center;">${totals.classesRealizadas}</td>
            <td class="mono" style="text-align:right;">${(totals.totalHoras || 0).toFixed(1)}h</td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td class="mono" style="text-align:right;">${fmt(totals.totalValor)}</td>
          </tr>
          ${(totals.totalVacationValue || 0) > 0 ? `
          <tr>
            <td colspan="7" style="text-align:right;font-weight:600;">🏖️ Total Férias</td>
            <td class="mono" style="text-align:right;font-weight:700;">${fmt(totals.totalVacationValue)}</td>
          </tr>
          <tr>
            <td colspan="7" style="text-align:right;font-weight:700;font-size:14px;">💵 TOTAL GERAL</td>
            <td class="mono" style="text-align:right;font-weight:700;font-size:14px;">${fmt(totals.totalGeral)}</td>
          </tr>
          ` : ''}
        </tfoot>
      </table>
    </div>
  `;
}

function updateFechamentoSubtitle(classCount, totalValue) {
  const el = document.getElementById('fechamentoSubtitle');
  if (!el) return;
  const monthName = MONTH_NAMES[FechamentoState.selectedMonth - 1];
  const unit = FechamentoState.units.find(u => u.id === FechamentoState.selectedUnitId);
  const unitName = unit ? unit.name : FechamentoState.selectedUnitId;

  if (FechamentoState.mode === 'closed') {
    el.textContent = `${monthName}/${FechamentoState.selectedYear} · ${unitName} · FECHADO`;
  } else if (classCount > 0) {
    el.textContent = `${monthName}/${FechamentoState.selectedYear} · ${unitName} · ${classCount} aulas · ${fmt(totalValue)}`;
  } else {
    el.textContent = `${monthName}/${FechamentoState.selectedYear} · ${unitName}`;
  }
}

// ─── Modal de confirmação ──────────────────────────────────────────────
function showCloseConfirmModal() {
  const modal = document.getElementById('closeMonthConfirmModal');
  if (!modal) return;

  const monthName = MONTH_NAMES[FechamentoState.selectedMonth - 1];
  const data = FechamentoState.previewData;
  const classCount = data ? data.totals.classesRealizadas : 0;

  document.getElementById('closeMonthConfirmBody').innerHTML = `
    <div class="info-callout" style="margin-bottom:12px;">
      <p><strong>⚠️ Atenção</strong></p>
      <p>Você está prestes a <strong>fechar ${monthName}/${FechamentoState.selectedYear}</strong>.</p>
      <p style="margin-top:8px;">
        <strong>${classCount} aulas</strong> serão congeladas e não poderão mais ser alteradas.
        Esta operação é <strong>irreversível</strong> nesta versão.
      </p>
    </div>
    <p style="font-size:13px;color:var(--text2);">Confirma o fechamento deste período?</p>
  `;

  document.getElementById('closeMonthConfirmError').textContent = '';
  const btn = document.getElementById('closeMonthConfirmBtn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Confirmar fechamento';
  }

  modal.classList.add('open');
}

function closeConfirmModal() {
  const modal = document.getElementById('closeMonthConfirmModal');
  if (modal) modal.classList.remove('open');
}

async function executeCloseMonth() {
  const btn = document.getElementById('closeMonthConfirmBtn');
  const errEl = document.getElementById('closeMonthConfirmError');

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Fechando...';
  errEl.textContent = '';

  const { selectedUnitId, selectedYear, selectedMonth } = FechamentoState;

  try {
    const callable = firebase.functions().httpsCallable('closeMonth');
    const result = await callable({ unitId: selectedUnitId, year: selectedYear, month: selectedMonth });

    const data = result.data;
    if (data && data.success) {
      closeConfirmModal();
      toast(`✅ Mês fechado com sucesso! ${data.totals ? data.totals.classesRealizadas + ' aulas' : ''}`, 'success');
      // Recarrega no modo closed
      FechamentoState.mode = 'closed';
      FechamentoState.closingDoc = { id: data.closingId, ...data };
      renderFechamentoUI();
    } else {
      throw new Error((data && data.error) || 'Falha ao fechar mês');
    }
  } catch (err) {
    console.error('[executeCloseMonth]', err);
    errEl.textContent = err.message || 'Erro ao fechar mês';
    btn.disabled = false;
    btn.textContent = 'Confirmar fechamento';
  }
}

// ─── Histórico ─────────────────────────────────────────────────────────
async function showFechamentoHistory() {
  const { selectedUnitId } = FechamentoState;
  if (!selectedUnitId) {
    toast('Selecione uma unidade primeiro.', 'error');
    return;
  }

  FechamentoState.mode = 'history';
  renderFechamentoUI();

  // Carrega histórico
  const container = document.getElementById('fechamentoContent');
  container.innerHTML = `
    <div class="loading"><div class="spinner"></div> Carregando histórico...</div>
  `;

  const res = await ClosingService.list(selectedUnitId);

  if (!res.success) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <h3>Erro ao carregar histórico</h3>
        <p>${escapeHtml(res.error || 'Erro desconhecido')}</p>
      </div>
    `;
    return;
  }

  FechamentoState.history = res.data;
  renderHistoryContent();
}

function renderHistoryContent() {
  const container = document.getElementById('fechamentoContent');
  const items = FechamentoState.history;

  if (!items || items.length === 0) {
    const unit = FechamentoState.units.find(u => u.id === FechamentoState.selectedUnitId);
    const unitName = unit ? unit.name : FechamentoState.selectedUnitId;
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📜</div>
        <h3>Nenhum fechamento encontrado</h3>
        <p>${unitName} ainda não tem nenhum mês fechado.</p>
        <button class="btn btn-sm btn-ghost" onclick="backToFechamento()" style="width:auto;margin-top:16px;">← Voltar</button>
      </div>
    `;
    return;
  }

  const rows = items.map(item => {
    const monthName = MONTH_NAMES[(item.month || 1) - 1];
    const closedDate = item.closedAt && item.closedAt.toDate ? item.closedAt.toDate() : null;
    const dateStr = closedDate ? closedDate.toLocaleDateString('pt-BR') : '—';
    const totals = item.totals || {};

    return `
      <tr style="cursor:pointer;" onclick="viewClosingDetail('${item.id}')">
        <td>
          <div style="font-weight:600;">${monthName}/${item.year}</div>
        </td>
        <td style="text-align:center;" class="mono">${totals.classesRealizadas || 0}</td>
        <td style="text-align:right;" class="mono">${(totals.totalHoras || 0).toFixed(1)}h</td>
        <td style="text-align:right;" class="mono">${fmt(totals.totalValor || 0)}</td>
        <td style="text-align:right;font-size:11px;">${dateStr}</td>
        <td style="text-align:right;font-size:11px;">${escapeHtml(item.closedByName || '—')}</td>
        <td style="text-align:center;">
          <span class="pill pill-active">Fechado</span>
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
      <button class="btn btn-sm btn-ghost" onclick="backToFechamento()" style="width:auto;">← Voltar ao fechamento</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Mês</th>
            <th style="text-align:center;width:60px;">Aulas</th>
            <th style="text-align:right;width:80px;">Horas</th>
            <th style="text-align:right;width:120px;">Total</th>
            <th style="text-align:right;width:100px;">Fechado em</th>
            <th style="text-align:right;width:120px;">Por</th>
            <th style="text-align:center;width:80px;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function backToFechamento() {
  FechamentoState.mode = 'select';
  FechamentoState.previewData = null;
  FechamentoState.closingDoc = null;
  renderFechamentoUI();
}

async function viewClosingDetail(closingId) {
  const res = await ClosingService.getById(closingId);
  if (!res.success) {
    toast(res.error || 'Fechamento não encontrado', 'error');
    return;
  }

  FechamentoState.closingDoc = res.data;
  FechamentoState.selectedMonth = res.data.month || FechamentoState.selectedMonth;
  FechamentoState.selectedYear = res.data.year || FechamentoState.selectedYear;
  FechamentoState.selectedUnitId = res.data.unitId || FechamentoState.selectedUnitId;
  FechamentoState.mode = 'closed';
  renderFechamentoUI();
}

// ─── Helper ────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

console.log('[CrossTainer Professores] professores-fechamento.js carregado · Sprint 4a');
