// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Módulo Professores · Pagamentos (Sprint 4b)
// ═══════════════════════════════════════════════════════════════════════

'use strict';

// ─── Estado local ────────────────────────────────────────────────────────
const PagState = {
  filterUnitIds: [],
  filterYear: new Date().getFullYear(),
  filterMonth: new Date().getMonth() + 1,
  filterStatus: null,
  expandedClosingId: null,
  closings: [],
  units: [],
  filteredClosings: [],
};

// ─── Constantes ──────────────────────────────────────────────────────────
const PAGAMENTO_STATUS_LABEL = {
  aguardando_pagamento: 'Aguard. pgto',
  pago: 'Pago',
  cancelado: 'Cancelado',
};

const STATUS_CHIP_COLORS = {
  aguardando_pagamento: 'var(--yellow-bg)',
  pago: 'var(--green-bg)',
  cancelado: 'var(--red-bg)',
};
const STATUS_CHIP_TEXT = {
  aguardando_pagamento: 'var(--yellow)',
  pago: 'var(--green)',
  cancelado: 'var(--red)',
};

// ═══════════════════════════════════════════════════════════════════════════
// TELA ADMIN — PAGAMENTOS
// ═══════════════════════════════════════════════════════════════════════════

async function renderPagamentosPage() {
  const page = document.getElementById('page-pagamentos');
  if (!page) return;

  if (!isStrictAdmin()) {
    page.innerHTML = '<div class="empty-state"><p class="subtitle">Acesso restrito ao administrador.</p></div>';
    return;
  }

  page.innerHTML = '<div class="loading">Carregando…</div>';

  const [unitRes, closingRes] = await Promise.all([
    UnitService.list(),
    ClosingService.list(),
  ]);

  if (!unitRes.success || !closingRes.success) {
    page.innerHTML = `<div class="empty-state"><p class="subtitle">Erro ao carregar: ${unitRes.error || closingRes.error}</p></div>`;
    return;
  }

  PagState.closings = closingRes.data || [];
  PagState.units = unitRes.data || [];
  applyPagFilters();
  renderPagamentosHTML(page);
}

function applyPagFilters() {
  let filtered = [...PagState.closings];
  if (PagState.filterUnitIds.length > 0) {
    filtered = filtered.filter(c => PagState.filterUnitIds.includes(c.unitId));
  }
  if (PagState.filterYear) {
    filtered = filtered.filter(c => c.year === PagState.filterYear);
  }
  if (PagState.filterMonth) {
    filtered = filtered.filter(c => c.month === PagState.filterMonth);
  }
  if (PagState.filterStatus) {
    // Filtro de status é aplicado client-side após carregar recibos
  }
  PagState.filteredClosings = filtered;
}

function renderPagamentosHTML(page) {
  const { filteredClosings, units, filterUnitIds, filterYear, filterMonth, filterStatus } = PagState;

  let html = '';

  // Toolbar
  html += '<div class="pag-toolbar">';
  html += '<div class="chip-row"><span class="chip-label">Unidade:</span>';
  for (const u of (units || [])) {
    const active = filterUnitIds.length === 0 || filterUnitIds.includes(u.id);
    html += `<span class="chip ${active ? 'chip-active' : ''}" onclick="pagToggleUnit('${u.id}')">${u.name || u.id}</span>`;
  }
  html += '</div>';
  html += '<div class="pag-period">';
  html += `<select onchange="pagSetYear(this.value)">${pagYearOptions(filterYear)}</select>`;
  html += `<select onchange="pagSetMonth(this.value)">${pagMonthOptions(filterMonth)}</select>`;
  html += '</div>';
  html += '<div class="chip-row">';
  html += `<span class="chip ${!filterStatus ? 'chip-active' : ''}" onclick="pagSetStatus(null)">Todos</span>`;
  html += `<span class="chip ${filterStatus === 'pendente' ? 'chip-active' : ''}" onclick="pagSetStatus('pendente')">Pendentes</span>`;
  html += `<span class="chip ${filterStatus === 'pago' ? 'chip-active' : ''}" onclick="pagSetStatus('pago')">Pagos</span>`;
  html += '</div></div>';

  // Lista
  if (filteredClosings.length === 0) {
    html += '<div class="empty-state"><p class="subtitle">Nenhum fechamento encontrado.</p></div>';
  } else {
    html += '<div class="pag-closing-list">';
    for (const closing of filteredClosings) {
      html += renderClosingCard(closing);
    }
    html += '</div>';
  }

  page.innerHTML = html;
}

function pagYearOptions(sel) {
  const y = new Date().getFullYear();
  let o = '';
  for (let i = y; i >= y - 2; i--) o += `<option value="${i}" ${i === sel ? 'selected' : ''}>${i}</option>`;
  return o;
}

function pagMonthOptions(sel) {
  const names = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return names.map((n, i) => `<option value="${i + 1}" ${(i + 1) === sel ? 'selected' : ''}>${n}</option>`).join('');
}

// ─── Handlers de filtro ──────────────────────────────────────────────────

function pagToggleUnit(unitId) {
  const idx = PagState.filterUnitIds.indexOf(unitId);
  if (idx >= 0) PagState.filterUnitIds.splice(idx, 1);
  else PagState.filterUnitIds.push(unitId);
  applyPagFilters();
  renderPagamentosHTML(document.getElementById('page-pagamentos'));
}
function pagSetYear(y) { PagState.filterYear = parseInt(y); applyPagFilters(); renderPagamentosHTML(document.getElementById('page-pagamentos')); }
function pagSetMonth(m) { PagState.filterMonth = parseInt(m); applyPagFilters(); renderPagamentosHTML(document.getElementById('page-pagamentos')); }
function pagSetStatus(s) { PagState.filterStatus = s; applyPagFilters(); renderPagamentosHTML(document.getElementById('page-pagamentos')); }

// ─── Render card de fechamento ───────────────────────────────────────────

function renderClosingCard(closing) {
  const isExpanded = PagState.expandedClosingId === closing.id;
  const teachers = closing.teachers || [];
  const totalValor = teachers.reduce((s, t) => s + (t.valorTotal || 0), 0);
  const statusBg = closing.status === 'fechado' ? 'var(--green-bg)' : 'var(--yellow-bg)';
  const statusColor = closing.status === 'fechado' ? 'var(--green)' : 'var(--yellow)';

  let card = `<div class="pag-closing-card ${isExpanded ? 'expanded' : ''}">`;
  card += `<div class="pag-closing-header" onclick="pagToggleCard('${closing.id}')" style="cursor:pointer;">`;
  card += `<div><strong>${closing.unitName || closing.unitId} · ${closing.year}-${String(closing.month).padStart(2,'0')}</strong>`;
  card += `<span class="badge" style="margin-left:8px;background:${statusBg};color:${statusColor};padding:2px 8px;border-radius:4px;font-size:11px;">${closing.status || ''}</span></div>`;
  card += `<div style="display:flex;align-items:center;gap:12px;">`;
  card += `<span style="font-size:12px;color:var(--text2);">${teachers.length} prof. · ${fmt(totalValor)}</span>`;
  card += `<span style="font-size:14px;">${isExpanded ? '▼' : '▶'}</span>`;
  card += `</div></div>`;

  if (isExpanded) {
    const semRecibo = teachers.filter(t => !t._receipt);
    card += `<div class="pag-card-toolbar">`;
    if (semRecibo.length > 0) {
      card += `<button class="btn btn-sm btn-primary" onclick="pagEmitirTodos('${closing.id}')">📄 Emitir TODOS (${semRecibo.length})</button>`;
    }
    card += `</div>`;
    card += `<table class="pag-teacher-table"><thead><tr>
      <th>Professor</th><th>Tipo</th><th class="text-right">Horas</th><th class="text-right">Valor</th>
      <th>Recibo</th><th>Status</th><th class="text-right">Ações</th>
    </tr></thead><tbody>`;
    for (const t of teachers) {
      card += renderTeacherRow(closing, t);
    }
    card += `</tbody></table>`;
  }

  card += `</div>`;
  return card;
}

function renderTeacherRow(closing, t) {
  const receipt = t._receipt || null;
  const typeLabel = { efetivo: 'Efetivo', estagiario: 'Estagiário', eventual: 'Eventual' }[t.teacherType] || t.teacherType;
  const typeClass = t.teacherType === 'efetivo' ? 'chip-orange' : t.teacherType === 'estagiario' ? 'chip-green' : 'chip-yellow';

  let reciboCell = '<span style="color:var(--text2);">—</span>';
  let statusCell = `<span style="background:var(--yellow-bg);color:var(--yellow);padding:2px 8px;border-radius:4px;font-size:11px;">pendente</span>`;
  let actions = `<button class="btn btn-sm" onclick="pagEmitir('${closing.id}', '${t.teacherId}')">📄 Emitir</button>`;

  if (receipt) {
    reciboCell = `<a href="receipt.html?id=${receipt.id}" target="_blank" style="color:var(--accent);font-weight:600;">#${receipt.numberFormatted}</a>`;
    const st = receipt.status;
    const bg = STATUS_CHIP_COLORS[st] || 'var(--surface2)';
    const txt = STATUS_CHIP_TEXT[st] || 'var(--text2)';
    statusCell = `<span style="background:${bg};color:${txt};padding:2px 8px;border-radius:4px;font-size:11px;">${PAGAMENTO_STATUS_LABEL[st] || st}</span>`;
    actions = `<button class="btn btn-sm" onclick="window.open('receipt.html?id=${receipt.id}','_blank')">🖨️</button>`;
    if (receipt.status === 'aguardando_pagamento') {
      actions += ` <button class="btn btn-sm btn-success" onclick="pagConfirmarPgto('${receipt.id}')">💰 Pagar</button>`;
    }
    if (receipt.status === 'pago') {
      actions += ` <button class="btn btn-sm" onclick="pagRegistrarCredito('${receipt.id}')">🔁 Crédito</button>`;
    }
  }

  return `<tr>
    <td><strong>${t.teacherName || ''}</strong></td>
    <td><span class="chip-mini ${typeClass}">${typeLabel}</span></td>
    <td class="text-right">${(t.totalHoras || 0).toFixed(1)}h</td>
    <td class="text-right">${fmt(t.valorTotal || 0)}</td>
    <td>${reciboCell}</td>
    <td>${statusCell}</td>
    <td class="text-right" style="white-space:nowrap;">${actions}</td>
  </tr>`;
}

// ─── Ações do card ───────────────────────────────────────────────────────

async function pagToggleCard(closingId) {
  PagState.expandedClosingId = PagState.expandedClosingId === closingId ? null : closingId;
  if (PagState.expandedClosingId) {
    const [recRes, payRes] = await Promise.all([
      ReceiptService.listByClosing(closingId),
      PaymentService.listByClosing(closingId),
    ]);
    const receipts = recRes.success ? recRes.data : [];
    const payments = payRes.success ? payRes.data : [];
    const closing = PagState.filteredClosings.find(c => c.id === closingId);
    if (closing && closing.teachers) {
      for (const t of closing.teachers) {
        t._receipt = receipts.find(r => r.teacherId === t.teacherId) || null;
        t._payment = payments.find(p => p.teacherId === t.teacherId) || null;
      }
    }
  }
  renderPagamentosHTML(document.getElementById('page-pagamentos'));
}

async function pagEmitir(closingId, teacherId) {
  if (!confirm('Confirma a emissão do recibo?')) return;
  toast('Emitindo recibo…', 'info');
  const res = await ReceiptService.emit({ closingId, teacherId });
  if (res.success) {
    toast(`Recibo #${res.data.numberFormatted} emitido!`, 'success');
    PagState.expandedClosingId = null;
    await pagToggleCard(closingId);
  } else {
    toast('Erro: ' + (res.error || 'desconhecido'), 'error');
  }
}

async function pagEmitirTodos(closingId) {
  const closing = PagState.filteredClosings.find(c => c.id === closingId);
  if (!closing) return;
  const semRecibo = (closing.teachers || []).filter(t => !t._receipt);
  if (semRecibo.length === 0) { toast('Todos já têm recibo.', 'info'); return; }
  if (!confirm(`Emitir ${semRecibo.length} recibos?`)) return;
  toast(`Emitindo ${semRecibo.length} recibos…`, 'info', 5000);
  const res = await ReceiptService.emitBatch({ closingId, teacherIds: semRecibo.map(t => t.teacherId) });
  if (res.success) {
    toast(`${res.data.results.length} recibos emitidos!`, 'success');
  } else {
    toast(`${res.data.results.length} OK, ${res.data.errors.length} erros. Veja console.`, 'error');
  }
  PagState.expandedClosingId = null;
  await pagToggleCard(closingId);
}

async function pagConfirmarPgto(receiptId) {
  const res = await ReceiptService.getById(receiptId);
  if (!res.success) { toast('Recibo não encontrado.', 'error'); return; }
  const rec = res.data;
  const valor = prompt(`Valor a pagar (R$):`, rec.valorLiquido.toFixed(2));
  if (!valor || isNaN(parseFloat(valor)) || parseFloat(valor) <= 0) return;
  const metodo = prompt('Método (transferencia, pix, dinheiro, outros):', 'transferencia');
  toast('Confirmando pagamento…', 'info');
  const payRes = await PaymentService.confirm(receiptId, { valor: parseFloat(valor), metodo: metodo || 'outros', obs: '' });
  if (payRes.success) {
    toast('Pagamento confirmado!', 'success');
    if (PagState.expandedClosingId) {
      const cid = PagState.expandedClosingId;
      PagState.expandedClosingId = null;
      await pagToggleCard(cid);
    }
  } else {
    toast('Erro: ' + (payRes.error || 'desconhecido'), 'error');
  }
}

async function pagRegistrarCredito(receiptId) {
  const res = await ReceiptService.getById(receiptId);
  if (!res.success) { toast('Recibo não encontrado.', 'error'); return; }
  const rec = res.data;
  const valor = prompt('Valor do crédito (+ = pagou a mais, - = faltou):', '0');
  if (!valor || isNaN(parseFloat(valor)) || parseFloat(valor) === 0) return;
  const motivo = prompt('Motivo:', 'Divergência pós-pagamento');
  toast('Registrando crédito…', 'info');
  const credRes = await CreditService.register({
    teacherId: rec.teacherId, teacherName: rec.teacherName,
    valor: parseFloat(valor), motivo: motivo || '',
    reciboOrigemId: receiptId, reciboOrigemNum: rec.number,
    periodoOrigem: `${rec.year}-${String(rec.month).padStart(2, '0')}`,
  });
  if (credRes.success) { toast('Crédito registrado!', 'success'); }
  else { toast('Erro: ' + (credRes.error || 'desconhecido'), 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════════
// PAINEL DO PROFESSOR — MEUS PAGAMENTOS
// ═══════════════════════════════════════════════════════════════════════════

async function renderMeusPagamentosPage() {
  const page = document.getElementById('page-meus-pagamentos');
  if (!page) return;

  const professorId = getCurrentProfessorId();
  if (!professorId) {
    page.innerHTML = `<div class="empty-state">
      <p class="subtitle">Nenhum professor vinculado ao seu usuário.</p>
      <p style="color:var(--text2);margin-top:4px;">Solicite ao administrador que vincule seu cadastro.</p>
    </div>`;
    return;
  }

  page.innerHTML = '<div class="loading">Carregando…</div>';

  const [recRes, credRes] = await Promise.all([
    ReceiptService.listByTeacher(professorId),
    CreditService.listHistory(professorId),
  ]);

  if (!recRes.success) {
    page.innerHTML = `<div class="empty-state"><p class="subtitle">Erro ao carregar: ${recRes.error}</p></div>`;
    return;
  }

  const recibos = recRes.data || [];
  const creditos = credRes.success ? credRes.data : [];
  const pendentes = creditos.filter(c => c.status === 'pendente');
  const aplicados = creditos.filter(c => c.status === 'aplicado');

  let html = '';

  // Créditos pendentes
  if (pendentes.length > 0) {
    html += '<div class="creditos-alert"><h3>⚠ Créditos / Débitos pendentes</h3>';
    for (const c of pendentes) {
      const sinal = c.valor > 0 ? '+' : '';
      html += `<div class="credito-item">
        <span style="font-weight:600;">${sinal}R$ ${(c.valor || 0).toFixed(2)}</span>
        <span style="font-size:11px;color:var(--text2);">${c.motivo || ''} · ${c.periodoOrigem || ''}</span>
      </div>`;
    }
    html += '</div>';
  }

  // Recibos
  if (recibos.length === 0) {
    html += '<div class="empty-state"><p class="subtitle">Nenhum recibo encontrado.</p></div>';
  } else {
    const grupos = {};
    for (const r of recibos) {
      const key = `${r.unitId || '?'}_${r.year}-${String(r.month).padStart(2,'0')}`;
      if (!grupos[key]) grupos[key] = { unitName: r.unitName || r.unitId, year: r.year, month: r.month, recibos: [] };
      grupos[key].recibos.push(r);
    }
    html += '<div class="meus-recibos-list">';
    for (const [key, g] of Object.entries(grupos)) {
      html += `<div class="meus-recibos-card">
        <div class="meus-recibos-header"><strong>${g.unitName} · ${g.year}-${String(g.month).padStart(2,'0')}</strong><span style="color:var(--text2);">${g.recibos.length} recibo(s)</span></div>
        <table><tbody>`;
      for (const r of g.recibos) {
        const stLabel = PAGAMENTO_STATUS_LABEL[r.status] || r.status;
        html += `<tr>
          <td><a href="receipt.html?id=${r.id}" target="_blank" style="color:var(--accent);font-weight:600;">#${r.numberFormatted}</a></td>
          <td><span style="font-size:11px;">${stLabel}</span></td>
          <td class="text-right">${fmt(r.valorLiquido)}</td>
          <td><button class="btn btn-sm" onclick="window.open('receipt.html?id=${r.id}','_blank')">🖨️</button></td>
        </tr>`;
      }
      html += `</tbody></table></div>`;
    }
    html += '</div>';
  }

  // Histórico de créditos
  if (aplicados.length > 0) {
    html += '<details style="margin-top:20px;"><summary style="cursor:pointer;font-size:13px;color:var(--text2);">Histórico de créditos (' + aplicados.length + ')</summary>';
    html += '<div style="margin-top:8px;font-size:12px;">';
    for (const c of aplicados) {
      html += `<div style="padding:4px 0;border-bottom:1px solid var(--border);">
        R$ ${(c.valor || 0).toFixed(2)} · ${c.periodoOrigem || ''} · ${c.motivo || ''}
        <span style="color:var(--text2);">→ aplicado</span>
      </div>`;
    }
    html += '</div></details>';
  }

  page.innerHTML = html;
}
