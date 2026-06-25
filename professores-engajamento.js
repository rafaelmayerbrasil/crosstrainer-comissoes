// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Módulo Professores · Engajamento/Pontos (Config · Chamada · Placar)
// T1 — Scaffold (nav + roteamento + render skeleton). Conteúdo real vem nas
// tarefas T2/T3/T4 do plano docs/superpowers/plans/2026-06-24-engajamento-ui.md
// ═══════════════════════════════════════════════════════════════════════

'use strict';

/* ─── Config. Pontos (admin) ───────────────────────────────────────── */
function renderEngajConfigPage() {
  const container = document.getElementById('page-engaj-config');
  if (!container) return;

  container.innerHTML = `
    <div class="page-hdr">
      <h1>⚙️ Config. Pontos</h1>
      <p>Defina os valores de pontuação, penalidades e os ciclos do motor de Engajamento.</p>
    </div>

    <div class="page-toolbar">
      <div class="lhs">
        <h2>Em construção</h2>
      </div>
    </div>

    <p style="padding:24px;color:var(--text2);">
      🚧 Em construção (T1 scaffold). Esta tela vai reunir os valores de pontos (via
      <code>EngagementService.getConfig</code>), as penalidades e o CRUD de ciclos.
    </p>
  `;
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
