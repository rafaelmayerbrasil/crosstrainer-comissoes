// ═══════════════════════════════════════════════════════════════════════
// professores-plr.js — UI do PLR (Config · Avaliação · Resultado). Spec §6.
// Consome PlrService (+ PlrEngine), EngagementService (placar) e ClosingService
// (horas do semestre). Dado sensível: telas de gestão.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const PlrState = { config: null, teachers: [], units: [], cycles: [], selCycleId: null, lastResult: null };

function plrToast(msg, kind) { if (typeof toast === 'function') toast(msg, kind || 'info'); }
function plrHireISO(t) {
  const d = t.hireDate || t.internshipStartDate;
  if (!d) return null;
  if (d.toDate) return d.toDate().toISOString().slice(0, 10);
  if (typeof d === 'string') return d.slice(0, 10);
  return null;
}
function plrTodayISO() { return new Date().toISOString().slice(0, 10); }
function plrMoney(v) { return 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function plrLoadBase() {
  const [cfg, tRes, uRes, cRes] = await Promise.all([
    PlrService.ConfigService.get(),
    TeacherService.list(),
    (typeof UnitService === 'object' ? UnitService.list() : Promise.resolve({ success: true, data: [] })),
    PlrService.listCycles(),
  ]);
  PlrState.config = cfg.success ? cfg.data : null;
  PlrState.teachers = (tRes.success ? tRes.data : []).filter(t => t.isActive !== false);
  PlrState.units = uRes.success ? uRes.data : [];
  PlrState.cycles = cRes.success ? cRes.data : [];
}

/* ═══════════════ 1) CONFIG ═══════════════ */
async function renderPlrConfigPage() {
  const c = document.getElementById('page-plr-config');
  if (!c) return;
  c.innerHTML = `<div class="page-hdr"><h1>⚙️ PLR — Configuração</h1><p>Pesos da nota, avaliadores e elegibilidade. Tudo configurável.</p></div>
    <div class="loading"><div class="spinner"></div> Carregando…</div>`;
  await plrLoadBase();
  const cfg = PlrState.config || {};
  const blocos = cfg.blocos || [];
  const aval = cfg.avaliadores || [];
  const el = cfg.elegibilidade || {};

  const blocoRows = blocos.map((b, i) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
    <span style="flex:1;font-size:14px;">${b.label || b.id}${b.auto ? ' <span style="font-size:11px;color:#5EA8FF;">(automático — placar)</span>' : ''}</span>
    <input type="number" min="0" max="100" class="input plrBlocoPeso" data-id="${b.id}" value="${b.peso || 0}" style="width:90px;"> <span style="font-size:12px;color:var(--text2);">%</span>
  </div>`).join('');

  const avalRows = aval.map((a, i) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;" data-row="${i}">
    <input type="text" class="input plrAvalNome" value="${a.nome || ''}" placeholder="Nome do avaliador" style="flex:1;">
    <input type="number" min="1" class="input plrAvalPeso" value="${a.peso || 1}" style="width:80px;" title="Peso">
    <button class="btn-secondary" onclick="plrRemoveAvaliador(${i})" style="padding:6px 10px;">✕</button>
  </div>`).join('');

  c.innerHTML = `<div class="page-hdr"><h1>⚙️ PLR — Configuração</h1><p>Pesos da nota, avaliadores e elegibilidade. Tudo configurável.</p></div>
    <div style="max-width:640px;">
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px;">
        <h3 style="margin:0 0 10px;font-size:15px;">Pesos dos blocos da nota <span id="plrPesoSoma" style="font-size:12px;color:var(--text2);"></span></h3>
        ${blocoRows}
        <p style="font-size:12px;color:var(--text2);margin-top:6px;">Devem somar 100. A nota dos alunos entra quando ligarmos a Pacto; por ora o peso se redistribui nos blocos acima.</p>
      </div>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px;">
        <h3 style="margin:0 0 10px;font-size:15px;">Avaliadores (peso na média)</h3>
        <div id="plrAvalList">${avalRows}</div>
        <button class="btn-secondary" onclick="plrAddAvaliador()" style="margin-top:6px;">+ Avaliador</button>
        <p style="font-size:12px;color:var(--text2);margin-top:6px;">Coordenador Técnico e Head Coach com peso 2; demais peso 1.</p>
      </div>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px;">
        <h3 style="margin:0 0 10px;font-size:15px;">Elegibilidade</h3>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="flex:1;font-size:14px;">Mínimo de meses de casa</span><input type="number" min="0" id="plrMinMeses" class="input" value="${el.minMesesCasa != null ? el.minMesesCasa : 3}" style="width:90px;"></div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="flex:1;font-size:14px;">Saldo de pontos mínimo (vazio = desligado)</span><input type="number" min="0" id="plrMinSaldo" class="input" value="${el.minSaldoPontos != null ? el.minSaldoPontos : ''}" style="width:90px;"></div>
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:14px;"><input type="checkbox" id="plrEstagiario" ${el.estagiarioEntra !== false ? 'checked' : ''}> Estagiário entra no rateio</label>
      </div>
      <div style="display:flex;justify-content:flex-end;"><button class="btn-primary" onclick="salvarPlrConfig()">💾 Salvar configuração</button></div>
    </div>`;
  plrAtualizaSoma();
  document.querySelectorAll('.plrBlocoPeso').forEach(inp => inp.addEventListener('input', plrAtualizaSoma));
}

function plrAtualizaSoma() {
  let soma = 0; document.querySelectorAll('.plrBlocoPeso').forEach(i => soma += Number(i.value) || 0);
  const el = document.getElementById('plrPesoSoma');
  if (el) { el.textContent = `(soma: ${soma})`; el.style.color = soma === 100 ? 'var(--green)' : 'var(--red)'; }
}

function plrReadAvaliadoresFromDom() {
  const out = [];
  document.querySelectorAll('#plrAvalList [data-row]').forEach(row => {
    const nome = row.querySelector('.plrAvalNome').value.trim();
    const peso = Number(row.querySelector('.plrAvalPeso').value) || 1;
    if (nome) out.push({ id: nome.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), nome, peso });
  });
  return out;
}
function plrAddAvaliador() {
  PlrState.config = PlrState.config || {};
  PlrState.config.avaliadores = plrReadAvaliadoresFromDom();
  PlrState.config.avaliadores.push({ id: '', nome: '', peso: 1 });
  // re-render só a lista
  renderPlrConfigPage();
}
function plrRemoveAvaliador(i) {
  PlrState.config.avaliadores = plrReadAvaliadoresFromDom();
  PlrState.config.avaliadores.splice(i, 1);
  renderPlrConfigPage();
}

async function salvarPlrConfig() {
  const blocos = (PlrState.config.blocos || []).map(b => Object.assign({}, b, {
    peso: Number((document.querySelector(`.plrBlocoPeso[data-id="${b.id}"]`) || {}).value) || 0,
  }));
  const soma = blocos.reduce((s, b) => s + b.peso, 0);
  if (soma !== 100) { plrToast('Os pesos dos blocos devem somar 100.', 'error'); return; }
  const avaliadores = plrReadAvaliadoresFromDom();
  const avaliadoresPeso = {}; avaliadores.forEach(a => { avaliadoresPeso[a.id] = a.peso; });
  const minSaldoRaw = document.getElementById('plrMinSaldo').value;
  const elegibilidade = {
    minMesesCasa: Number(document.getElementById('plrMinMeses').value) || 0,
    minSaldoPontos: minSaldoRaw === '' ? null : Number(minSaldoRaw),
    estagiarioEntra: document.getElementById('plrEstagiario').checked,
  };
  const res = await PlrService.ConfigService.save({ blocos, avaliadores, avaliadoresPeso, elegibilidade });
  if (res.success) { plrToast('Configuração salva!', 'success'); renderPlrConfigPage(); }
  else plrToast('Erro: ' + (res.error || 'falha'), 'error');
}

/* ═══════════════ 2) AVALIAÇÃO ═══════════════ */
async function renderPlrAvaliacaoPage() {
  const c = document.getElementById('page-plr-avaliacao');
  if (!c) return;
  c.innerHTML = `<div class="page-hdr"><h1>📝 PLR — Avaliação</h1><p>Lance as notas por bloco. Substitui a planilha.</p></div>
    <div class="loading"><div class="spinner"></div> Carregando…</div>`;
  await plrLoadBase();
  const cfg = PlrState.config || {};
  const abertos = PlrState.cycles.filter(c2 => c2.status !== 'fechado');
  const aval = cfg.avaliadores || [];
  const blocosManuais = (cfg.blocos || []).filter(b => !b.auto);

  if (!abertos.length) {
    c.innerHTML = `<div class="page-hdr"><h1>📝 PLR — Avaliação</h1></div><p style="padding:20px;color:var(--text2);">Nenhum ciclo de PLR aberto. Crie um na aba <b>Resultado</b>.</p>`;
    return;
  }

  const cycleOpts = abertos.map(c2 => `<option value="${c2.id}">${c2.label || c2.id}</option>`).join('');
  const avalOpts = aval.map(a => `<option value="${a.id}">${a.nome} (peso ${a.peso})</option>`).join('');
  const teacherOpts = PlrState.teachers.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  const notaInputs = blocosManuais.map(b => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
    <span style="flex:1;font-size:14px;">${b.label || b.id}</span>
    <input type="number" min="0" max="10" step="0.5" class="input plrNota" data-id="${b.id}" style="width:90px;"> <span style="font-size:12px;color:var(--text2);">0–10</span>
  </div>`).join('');

  c.innerHTML = `<div class="page-hdr"><h1>📝 PLR — Avaliação</h1><p>Lance as notas por bloco (0–10). O engajamento entra automático do placar.</p></div>
    <div style="max-width:560px;background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;">
      <div class="form-group"><label>Ciclo</label><select id="plrAvCiclo" class="input">${cycleOpts}</select></div>
      <div class="form-group"><label>Avaliador</label><select id="plrAvAvaliador" class="input">${avalOpts}</select></div>
      <div class="form-group"><label>Colaborador avaliado</label><select id="plrAvColab" class="input">${teacherOpts}</select></div>
      <hr style="border-color:var(--border);margin:12px 0;">
      ${notaInputs}
      <div class="form-group"><label>Parecer</label><textarea id="plrAvParecer" class="input" placeholder="Comentário (opcional)"></textarea></div>
      <div style="display:flex;justify-content:flex-end;"><button class="btn-primary" onclick="salvarAvaliacaoPlr()">💾 Salvar avaliação</button></div>
    </div>`;
}

async function salvarAvaliacaoPlr() {
  const cycleId = document.getElementById('plrAvCiclo').value;
  const evaluatorId = document.getElementById('plrAvAvaliador').value;
  const evaluateeId = document.getElementById('plrAvColab').value;
  if (!cycleId || !evaluatorId || !evaluateeId) { plrToast('Preencha ciclo, avaliador e colaborador.', 'error'); return; }
  const notas = {};
  document.querySelectorAll('.plrNota').forEach(i => { if (i.value !== '') notas[i.dataset.id] = Number(i.value); });
  const parecer = document.getElementById('plrAvParecer').value;
  const res = await PlrService.upsertEvaluation({ cycleId, evaluatorId, evaluateeId, notas, parecer });
  if (res.success) { plrToast('Avaliação salva!', 'success'); document.getElementById('plrAvParecer').value = ''; document.querySelectorAll('.plrNota').forEach(i => i.value = ''); }
  else plrToast('Erro: ' + (res.error || 'falha'), 'error');
}

/* ═══════════════ 3) RESULTADO ═══════════════ */
async function renderPlrResultadoPage() {
  const c = document.getElementById('page-plr-resultado');
  if (!c) return;
  c.innerHTML = `<div class="page-hdr"><h1>🏅 PLR — Resultado</h1><p>Pool, nota e rateio por colaborador.</p></div>
    <div class="loading"><div class="spinner"></div> Carregando…</div>`;
  await plrLoadBase();
  const cycles = PlrState.cycles;
  if (!PlrState.selCycleId || !cycles.find(c2 => c2.id === PlrState.selCycleId)) PlrState.selCycleId = cycles.length ? cycles[cycles.length - 1].id : null;
  const cycle = cycles.find(c2 => c2.id === PlrState.selCycleId) || null;
  const cycleOpts = cycles.map(c2 => `<option value="${c2.id}" ${c2.id === PlrState.selCycleId ? 'selected' : ''}>${c2.label || c2.id}${c2.status === 'fechado' ? ' (fechado)' : ''}</option>`).join('');

  const y = new Date().getFullYear();
  c.innerHTML = `<div class="page-hdr"><h1>🏅 PLR — Resultado</h1><p>Pool, nota e rateio por colaborador.</p></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px;">
      <div class="form-group" style="margin:0;"><label>Ciclo</label><select id="plrResCiclo" class="input" onchange="plrSelCiclo(this.value)">${cycleOpts || '<option>—</option>'}</select></div>
      <button class="btn-secondary" onclick="plrNovoCiclo()">+ Novo ciclo</button>
      ${cycle ? `<button class="btn-primary" onclick="calcularPlr()">🧮 Calcular rateio</button>` : ''}
      ${cycle && cycle.status !== 'fechado' ? `<button class="btn-secondary" onclick="fecharCicloPlr()">🔒 Fechar ciclo</button>` : ''}
    </div>
    <div id="plrNovoCicloBox" style="display:none;background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px;max-width:560px;">
      <h3 style="margin:0 0 10px;font-size:15px;">Novo ciclo</h3>
      <div class="form-group"><label>Rótulo</label><input type="text" id="plrNcLabel" class="input" value="${y}/2"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="form-group"><label>Início</label><input type="date" id="plrNcIni" class="input" value="${y}-06-01"></div>
        <div class="form-group"><label>Fim</label><input type="date" id="plrNcFim" class="input" value="${y}-11-30"></div>
      </div>
      <div class="form-group"><label>Pool (R$)</label><input type="number" min="0" step="0.01" id="plrNcPool" class="input" value="0"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;"><button class="btn-secondary" onclick="plrToggleNovoCiclo(false)">Cancelar</button><button class="btn-primary" onclick="salvarNovoCiclo()">Criar</button></div>
    </div>
    ${cycle ? `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;max-width:560px;">
      <span style="font-size:14px;">Pool do ciclo:</span>
      <input type="number" min="0" step="0.01" id="plrPool" class="input" value="${cycle.pool || 0}" style="width:160px;" ${cycle.status === 'fechado' ? 'disabled' : ''}>
      ${cycle.status !== 'fechado' ? `<button class="btn-secondary" onclick="salvarPoolPlr()">Salvar pool</button>` : '<span style="font-size:12px;color:var(--text2);">ciclo fechado</span>'}
    </div>
    <div id="plrResultTable"></div>` : '<p style="color:var(--text2);">Crie um ciclo pra começar.</p>'}`;
}

function plrSelCiclo(id) { PlrState.selCycleId = id; renderPlrResultadoPage(); }
function plrToggleNovoCiclo(show) { const b = document.getElementById('plrNovoCicloBox'); if (b) b.style.display = show ? 'block' : 'none'; }
function plrNovoCiclo() { plrToggleNovoCiclo(true); }

async function salvarNovoCiclo() {
  const label = document.getElementById('plrNcLabel').value.trim();
  const inicio = document.getElementById('plrNcIni').value;
  const fim = document.getElementById('plrNcFim').value;
  const pool = Number(document.getElementById('plrNcPool').value) || 0;
  if (!inicio || !fim || inicio > fim) { plrToast('Período inválido.', 'error'); return; }
  const res = await PlrService.saveCycle({ label, inicio, fim, pool });
  if (res.success) { plrToast('Ciclo criado!', 'success'); PlrState.selCycleId = res.data.id; renderPlrResultadoPage(); }
  else plrToast('Erro: ' + (res.error || 'falha'), 'error');
}

async function salvarPoolPlr() {
  const cycle = PlrState.cycles.find(c2 => c2.id === PlrState.selCycleId);
  if (!cycle) return;
  const pool = Number(document.getElementById('plrPool').value) || 0;
  const res = await PlrService.saveCycle({ id: cycle.id, label: cycle.label, inicio: cycle.inicio, fim: cycle.fim, pool, status: cycle.status });
  if (res.success) { plrToast('Pool salvo.', 'success'); renderPlrResultadoPage(); }
  else plrToast('Erro: ' + (res.error || 'falha'), 'error');
}

// Soma das horas pagas (monthly_closings.teachers[].totalHoras) nos meses do ciclo.
async function plrHorasNoCiclo(cycle) {
  const horasById = {};
  const startYM = (cycle.inicio || '').slice(0, 7);
  const endYM = (cycle.fim || '').slice(0, 7);
  for (const u of PlrState.units) {
    const res = await ClosingService.list(u.id);
    (res.success ? res.data : []).forEach(cl => {
      const ym = `${cl.year}-${String(cl.month).padStart(2, '0')}`;
      if (ym >= startYM && ym <= endYM) {
        (cl.teachers || []).forEach(tr => { horasById[tr.teacherId] = (horasById[tr.teacherId] || 0) + (tr.totalHoras || 0); });
      }
    });
  }
  return horasById;
}

async function calcularPlr() {
  const cycle = PlrState.cycles.find(c2 => c2.id === PlrState.selCycleId);
  if (!cycle) return;
  const tableEl = document.getElementById('plrResultTable');
  if (tableEl) tableEl.innerHTML = '<div class="loading"><div class="spinner"></div> Calculando…</div>';
  // engajamento por pessoa (placar do período do ciclo)
  const engCycle = { id: cycle.id, inicio: cycle.inicio, fim: cycle.fim };
  const engajById = {};
  for (const t of PlrState.teachers) {
    const r = await EngagementService.scoreboard(t.id, plrHireISO(t), engCycle);
    engajById[t.id] = r.success ? r.data.total : 0;
  }
  const horasById = await plrHorasNoCiclo(cycle);
  const pessoas = PlrState.teachers.map(t => ({ id: t.id, name: t.name, type: t.type, hireDate: plrHireISO(t), saldoPontos: engajById[t.id] || 0 }));
  const res = await PlrService.computeResults(cycle.id, { pessoas, horasById, engajById });
  if (!res.success) { plrToast('Erro: ' + res.error, 'error'); return; }
  PlrState.lastResult = res.data;
  renderPlrTable(res.data, cycle);
}

function renderPlrTable(data, cycle) {
  const tableEl = document.getElementById('plrResultTable');
  if (!tableEl) return;
  const linhas = data.linhas.slice().sort((a, b) => b.fatia - a.fatia);
  const rows = linhas.map(l => `<tr style="${l.elegivel ? '' : 'opacity:.55;'}">
    <td style="padding:6px 8px;">${l.nome}</td>
    <td style="padding:6px 8px;text-align:center;">${(l.horas || 0).toFixed(1)}h</td>
    <td style="padding:6px 8px;text-align:center;">${(l.nota || 0).toFixed(2)}</td>
    <td style="padding:6px 8px;text-align:right;font-weight:600;">${l.elegivel ? plrMoney(l.fatia) : '—'}</td>
    <td style="padding:6px 8px;font-size:12px;color:var(--text2);">${l.elegivel ? '' : (l.motivoInelegivel || 'inelegível')}</td>
  </tr>`).join('');
  tableEl.innerHTML = `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:8px;overflow:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead><tr style="color:var(--text2);text-align:left;border-bottom:1px solid var(--border);">
        <th style="padding:6px 8px;">Colaborador</th><th style="padding:6px 8px;text-align:center;">Horas</th><th style="padding:6px 8px;text-align:center;">Nota</th><th style="padding:6px 8px;text-align:right;">Fatia</th><th style="padding:6px 8px;">Obs.</th>
      </tr></thead><tbody>${rows}</tbody>
      <tfoot><tr style="border-top:1px solid var(--border);font-weight:700;"><td colspan="3" style="padding:8px;">Total</td><td style="padding:8px;text-align:right;">${plrMoney(data.total)}</td><td style="padding:8px;font-size:12px;color:var(--text2);">pool ${plrMoney(cycle.pool)}</td></tr></tfoot>
    </table></div>`;
}

async function fecharCicloPlr() {
  const cycle = PlrState.cycles.find(c2 => c2.id === PlrState.selCycleId);
  if (!cycle) return;
  if (!confirm('Fechar o ciclo? O resultado vira um registro fixo.')) return;
  // recalcula com os dados atuais e grava snapshot
  const engCycle = { id: cycle.id, inicio: cycle.inicio, fim: cycle.fim };
  const engajById = {}; for (const t of PlrState.teachers) { const r = await EngagementService.scoreboard(t.id, plrHireISO(t), engCycle); engajById[t.id] = r.success ? r.data.total : 0; }
  const horasById = await plrHorasNoCiclo(cycle);
  const pessoas = PlrState.teachers.map(t => ({ id: t.id, name: t.name, type: t.type, hireDate: plrHireISO(t), saldoPontos: engajById[t.id] || 0 }));
  const res = await PlrService.closeCycle(cycle.id, { pessoas, horasById, engajById });
  if (res.success) { plrToast('Ciclo fechado.', 'success'); renderPlrResultadoPage(); }
  else plrToast('Erro: ' + (res.error || 'falha'), 'error');
}

// Expor (chamadas via navigateTo / onclick)
window.renderPlrConfigPage = renderPlrConfigPage;
window.renderPlrAvaliacaoPage = renderPlrAvaliacaoPage;
window.renderPlrResultadoPage = renderPlrResultadoPage;
window.plrAddAvaliador = plrAddAvaliador;
window.plrRemoveAvaliador = plrRemoveAvaliador;
window.salvarPlrConfig = salvarPlrConfig;
window.salvarAvaliacaoPlr = salvarAvaliacaoPlr;
window.plrSelCiclo = plrSelCiclo;
window.plrNovoCiclo = plrNovoCiclo;
window.plrToggleNovoCiclo = plrToggleNovoCiclo;
window.salvarNovoCiclo = salvarNovoCiclo;
window.salvarPoolPlr = salvarPoolPlr;
window.calcularPlr = calcularPlr;
window.fecharCicloPlr = fecharCicloPlr;

console.log('[CrossTainer Professores] professores-plr.js carregado · PLR');
