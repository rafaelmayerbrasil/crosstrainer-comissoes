// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Módulo Professores · Engajamento/Pontos (Config · Chamada · Placar)
// T1 — Scaffold (nav + roteamento + render skeleton). Conteúdo real vem nas
// tarefas T2/T3/T4 do plano docs/superpowers/plans/2026-06-24-engajamento-ui.md
// ═══════════════════════════════════════════════════════════════════════

'use strict';

/* ─── Config. Pontos (admin) ───────────────────────────────────────── */
const EngajConfigState = { cfg: null, cycles: [] };

// helper: input numérico rotulado no estilo do sistema
function ecfgNum(id, label, value, hint) {
  const v = (value === null || value === undefined) ? '' : value;
  return `<div class="form-group">
    <label>${label}</label>
    <input type="number" step="any" id="${id}" class="input" value="${v}">
    ${hint ? `<div style="font-size:11px;color:var(--text3);margin-top:2px;">${hint}</div>` : ''}
  </div>`;
}

async function renderEngajConfigPage() {
  const container = document.getElementById('page-engaj-config');
  if (!container) return;

  container.innerHTML = `
    <div class="page-hdr">
      <h1>⚙️ Config. Pontos</h1>
      <p>Defina os valores de pontuação, penalidades e os ciclos do motor de Engajamento.</p>
    </div>
    <div class="loading"><div class="spinner"></div> Carregando configuração…</div>`;

  const [cfgRes, cyclesRes] = await Promise.all([
    EngagementService.getConfig(),
    EngagementService.listCycles(),
  ]);

  if (!cfgRes.success) {
    container.innerHTML = `<div class="page-hdr"><h1>⚙️ Config. Pontos</h1></div>
      <p style="padding:24px;color:var(--red);">Erro ao carregar: ${cfgRes.error || 'falha'}</p>
      <button class="btn-secondary" onclick="renderEngajConfigPage()">Tentar novamente</button>`;
    return;
  }

  const cfg = cfgRes.data;
  const cycles = cyclesRes.success ? cyclesRes.data : [];
  EngajConfigState.cfg = cfg;
  EngajConfigState.cycles = cycles;
  const p = cfg.pts;

  let cyclesRows = '';
  if (cycles.length === 0) {
    cyclesRows = `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text2);">Nenhum ciclo cadastrado ainda.</td></tr>`;
  } else {
    cycles.forEach(c => {
      cyclesRows += `<tr><td>${c.label || '—'}</td><td>${c.inicio || '—'}</td><td>${c.fim || '—'}</td>
        <td><button class="btn-sm btn-danger" onclick="removeEngajCycle('${c.id}')">🗑️</button></td></tr>`;
    });
  }

  container.innerHTML = `
    <div class="page-hdr">
      <h1>⚙️ Config. Pontos</h1>
      <p>Tudo aqui é calibrável pela gestão. Os valores valem para o placar e, depois, para o PLR.</p>
    </div>

    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px;">
      <h2 style="margin-top:0;">Pontos por atividade</h2>
      <div class="form-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
        ${ecfgNum('ecfg_eiPart', 'Escola interna · participar', p.escolaInternaParticipar, 'por dia')}
        ${ecfgNum('ecfg_eiLider', 'Escola interna · liderar', p.escolaInternaLiderar, 'por dia (o 2× que o Rodrigo pediu)')}
        ${ecfgNum('ecfg_treinaOutra', 'Treinar como aluno em outra aula', p.treinarComoAlunoEmOutro, 'por dia, quando não dá pra ir ao treino')}
        ${ecfgNum('ecfg_toi', 'TOI como aluno', p.toiComoAluno, 'mesmo peso da escola interna')}
        ${ecfgNum('ecfg_reuniao', 'Reunião do staff', p.reuniaoStaff, 'mensal')}
        ${ecfgNum('ecfg_proativ', 'Proatividade (substituição)', p.proatividadeSubstituicao, 'por substituição assumida')}
        ${ecfgNum('ecfg_evento', 'Evento interno', p.eventoInterno, 'por evento')}
        ${ecfgNum('ecfg_treinoPres', 'Treinamento obrigatório · presença', p.treinamentoObrigatorioPresenca, 'por presença')}
      </div>
    </div>

    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px;">
      <h2 style="margin-top:0;">Tempo de casa &amp; teto</h2>
      <div class="form-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
        ${ecfgNum('ecfg_casaFaixa', 'Tempo de casa · pontos por faixa', p.tempoCasaPorFaixa, 'fixo, sempre conta (fora do reset)')}
        ${ecfgNum('ecfg_faixaAnos', 'Anos por faixa', cfg.faixaAnos, 'ex.: 2 → 0–2a, 2–4a, 4–6a…')}
        ${ecfgNum('ecfg_teto', 'Teto mensal de itens diários', cfg.tetoMensalItensDiarios, 'vazio = sem teto')}
      </div>
    </div>

    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px;">
      <h2 style="margin-top:0;">Penalidades (treinamento)</h2>
      <div class="form-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
        ${ecfgNum('ecfg_penJust', 'Falta justificada', cfg.penalidade.treinoFaltaJustificada, 'avisou antes (use 0 ou negativo)')}
        ${ecfgNum('ecfg_penSem', 'Falta sem aviso', cfg.penalidade.treinoFaltaSemAviso, 'penalidade máxima (negativo)')}
      </div>
      <div style="margin-top:16px;display:flex;justify-content:flex-end;">
        <button class="btn-primary" onclick="saveEngajConfig()">💾 Salvar configuração</button>
      </div>
    </div>

    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;">
      <h2 style="margin-top:0;">Ciclos de pontuação</h2>
      <p style="color:var(--text2);font-size:13px;margin-top:0;">Os pontos acumulam dentro do ciclo e zeram na virada. Comece alinhado ao PLR.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Nome</th><th>Início</th><th>Fim</th><th style="width:60px;">Ações</th></tr></thead>
          <tbody>${cyclesRows}</tbody>
        </table>
      </div>
      <div class="form-grid" style="display:grid;grid-template-columns:1.5fr 1fr 1fr auto;gap:10px;align-items:end;margin-top:14px;">
        <div class="form-group"><label>Nome do ciclo</label><input type="text" id="ecyc_label" class="input" placeholder="Ex: 2º semestre 2026"></div>
        <div class="form-group"><label>Início</label><input type="date" id="ecyc_inicio" class="input"></div>
        <div class="form-group"><label>Fim</label><input type="date" id="ecyc_fim" class="input"></div>
        <button class="btn-primary" onclick="addEngajCycle()">+ Adicionar</button>
      </div>
    </div>
  `;
}

async function saveEngajConfig() {
  const num = (id) => { const el = document.getElementById(id); const v = (el && el.value.trim()) || ''; return v === '' ? null : Number(v); };
  const overrides = {
    faixaAnos: num('ecfg_faixaAnos'),
    pts: {
      escolaInternaParticipar: num('ecfg_eiPart'),
      escolaInternaLiderar: num('ecfg_eiLider'),
      treinarComoAlunoEmOutro: num('ecfg_treinaOutra'),
      toiComoAluno: num('ecfg_toi'),
      reuniaoStaff: num('ecfg_reuniao'),
      proatividadeSubstituicao: num('ecfg_proativ'),
      eventoInterno: num('ecfg_evento'),
      treinamentoObrigatorioPresenca: num('ecfg_treinoPres'),
      tempoCasaPorFaixa: num('ecfg_casaFaixa'),
    },
    tetoMensalItensDiarios: num('ecfg_teto'),
    penalidade: {
      treinoFaltaJustificada: num('ecfg_penJust'),
      treinoFaltaSemAviso: num('ecfg_penSem'),
    },
  };
  const res = await EngagementService.saveConfig(overrides);
  if (res.success) toast('Configuração salva!', 'success');
  else toast('Erro: ' + (res.error || 'falha ao salvar'), 'error');
}

async function addEngajCycle() {
  const label = (document.getElementById('ecyc_label').value || '').trim();
  const inicio = document.getElementById('ecyc_inicio').value;
  const fim = document.getElementById('ecyc_fim').value;
  if (!inicio || !fim) { toast('Informe início e fim do ciclo.', 'error'); return; }
  if (inicio > fim) { toast('O início deve ser antes do fim.', 'error'); return; }
  const res = await EngagementService.saveCycle({ inicio, fim, label });
  if (res.success) { toast('Ciclo salvo!', 'success'); renderEngajConfigPage(); }
  else toast('Erro: ' + (res.error || 'falha ao salvar ciclo'), 'error');
}

async function removeEngajCycle(id) {
  if (!confirm('Remover este ciclo?')) return;
  const res = await EngagementService.deleteCycle(id);
  if (res.success) { toast('Ciclo removido.', 'success'); renderEngajConfigPage(); }
  else toast('Erro: ' + (res.error || 'falha ao remover'), 'error');
}

/* ─── Chamada (admin/supervisão) ───────────────────────────────────── */
function renderEngajChamadaPage() {
  const container = document.getElementById('page-engaj-chamada');
  if (!container) return;

  container.innerHTML = `
    <div class="page-hdr">
      <h1>✅ Chamada</h1>
      <p>Lance presença/falta para escola interna, reunião, treinamento ou evento.</p>
    </div>

    <div class="page-toolbar">
      <div class="lhs">
        <h2>Em construção</h2>
      </div>
    </div>

    <p style="padding:24px;color:var(--text2);">
      🚧 Em construção (T1 scaffold). Esta tela vai permitir marcar presença/falta por tipo
      de atividade e gravar via <code>EngagementService.recordAttendance</code>.
    </p>
  `;
}

/* ─── Placar (todos) ───────────────────────────────────────────────── */
function renderEngajPlacarPage() {
  const container = document.getElementById('page-engaj-placar');
  if (!container) return;

  container.innerHTML = `
    <div class="page-hdr">
      <h1>🏆 Placar</h1>
      <p>Acompanhe a pontuação do ciclo atual por pessoa.</p>
    </div>

    <div class="page-toolbar">
      <div class="lhs">
        <h2>Em construção</h2>
      </div>
    </div>

    <p style="padding:24px;color:var(--text2);">
      🚧 Em construção (T1 scaffold). Esta tela vai listar o placar por ciclo
      (<code>EngagementService.scoreboard</code>), com o professor vendo só o próprio total.
    </p>
  `;
}

// Expor funções globalmente (chamadas via navigateTo)
window.renderEngajConfigPage = renderEngajConfigPage;
window.renderEngajChamadaPage = renderEngajChamadaPage;
window.renderEngajPlacarPage = renderEngajPlacarPage;

console.log('[CrossTainer Professores] professores-engajamento.js carregado · T1 scaffold');
