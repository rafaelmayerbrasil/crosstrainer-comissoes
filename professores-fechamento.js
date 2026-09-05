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
//   - D2: fecha o mês inteiro de uma vez (sem parcial) — e, desde 05/09/2026,
//         TODAS as unidades juntas: o fechamento é por PESSOA/mês. Era por
//         unidade, e quem dava aula na CP e na PP levava bolsa, VR e VT em
//         dobro (R$ 7.580,84 a mais só em agosto, medido antes de fechar).
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
  // Unidade não é mais ESCOPO do fechamento — vira só lente de leitura da
  // tabela ('' = todas). O que se fecha é o mês inteiro da academia.
  filtroUnitId: '',
  selectedYear: null,
  selectedMonth: null,
  previewData: null,    // resultado de ClosingService.preview()
  trocasAbertas: null,  // null = ainda não checado · [] = nenhuma · [..] = travam
  trocasErro: null,     // mensagem, quando não deu pra checar
  closingDoc: null,     // doc de monthly_closings (se já fechado)
  mode: 'select',       // 'select' | 'preview' | 'closed' | 'history'
  history: [],
};

// ─── Entry point ───────────────────────────────────────────────────────
async function renderFechamentoPage() {
  const page = document.getElementById('page-fechamento');
  if (!page) return;

  // ⛔ Só Admin. A tela mostra bolsa, VR, VT e o total de cada colega — é dado
  // salarial (regra inviolável nº 6). O menu já não oferece a tela pra
  // supervisão, mas deep-link existe, e as rules do Firestore recusariam a
  // leitura: sem esta trava, quem entrasse por link veria "erro ao carregar" em
  // vez de saber que a tela não é dele.
  if (typeof canSeeSalary === 'function' && !canSeeSalary()) {
    page.innerHTML = `
      <div class="page-hdr"><h1>💰 Fechamento Mensal</h1></div>
      <div class="empty-state">
        <div class="icon">🔒</div>
        <h3>Esta tela é só do Administrador</h3>
        <p>O fechamento mostra o quanto cada pessoa recebe — bolsa, benefícios e total.
           Por isso fica restrito ao Administrador, mesmo para a supervisão.</p>
      </div>`;
    return;
  }

  // Carrega unidades (fresco)
  const unitRes = await UnitService.list();
  if (unitRes.success) {
    FechamentoState.units = unitRes.data.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
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
      <h1>💰 Fechamento Mensal${ajudaBtn("fechamento")}</h1>
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
        <h3>Selecione o mês</h3>
        <p>Escolha o período acima e clique em "Carregar preview". O fechamento é sempre do mês inteiro, com as duas unidades juntas.</p>
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

  // Unidade é filtro de leitura, não escopo: o fechamento é sempre do mês todo.
  const unitOptions = `<option value="">Todas as unidades</option>` + FechamentoState.units.map(u =>
    `<option value="${u.id}" ${u.id === FechamentoState.filtroUnitId ? 'selected' : ''}>${escapeHtml(u.name || u.id)}</option>`
  ).join('');

  toolbar.innerHTML = `
    <div class="lhs">
      <h2>Fechamento</h2>
      <div class="count" id="fechamentoSubtitle"></div>
    </div>
    <div class="rhs" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <div class="agenda-unit-select">
        <span class="filter-label">Ver aulas de</span>
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
  // Só muda a lente: a folha continua a mesma, o filtro é de leitura.
  FechamentoState.filtroUnitId = val;
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

  const { selectedYear, selectedMonth } = FechamentoState;

  // Mostra loading
  document.getElementById('fechamentoContent').innerHTML = `
    <div class="loading"><div class="spinner"></div> Consolidando aulas das duas unidades...</div>
  `;

  // 1) Verifica se já existe fechamento
  const closingId = ClosingService.getClosingId(selectedYear, selectedMonth);
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
  const res = await ClosingService.preview(selectedYear, selectedMonth);

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

  // As trocas em aberto entram na conferência, não só no modal de confirmação:
  // eram 20 aulas em agosto/2026 e a gestão só descobria ao clicar em fechar.
  await carregarTrocasAbertas();
  renderFechamentoUI();
}

/** Trocas de professor ainda abertas no mês que está sendo conferido. */
async function carregarTrocasAbertas() {
  const y = FechamentoState.selectedYear;
  const m = FechamentoState.selectedMonth;
  const de = new Date(Date.UTC(y, m - 1, 1, 3, 0, 0));
  const ate = new Date(Date.UTC(y, m, 0, 26, 59, 59));
  try {
    const r = await SubstitutionService.listAbertasNoPeriodo(de, ate);
    if (!r.success) throw new Error(r.error || 'erro desconhecido');
    FechamentoState.trocasAbertas = r.data || [];
    FechamentoState.trocasErro = null;
  } catch (err) {
    // Falha FECHADA: sem saber das trocas, não se fecha o mês.
    FechamentoState.trocasAbertas = null;
    FechamentoState.trocasErro = (err && err.message) || 'erro desconhecido';
  }
}

/// ─── Preview content — a conferência do fechamento ─────────────────────
//
// Seis blocos, todos tabela. Nasceu do relatório que a gestão pediu em
// 05/09/2026 ("queria que o sistema fizesse tipo esse relatório"): a Benny
// tinha que juntar à mão o que estava espalhado em quatro telas, e nenhuma
// delas somava as unidades. Aqui tudo sai do MESMO cálculo que o fechamento
// vai gravar — se divergisse, o número da conferência não valeria nada.
function renderPreviewContent() {
  const container = document.getElementById('fechamentoContent');
  const data = FechamentoState.previewData;
  if (!data) return;

  const { teachers, totals, isEmpty } = data;
  const monthName = MONTH_NAMES[FechamentoState.selectedMonth - 1];

  if (isEmpty || teachers.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📭</div>
        <h3>Nenhuma aula encontrada</h3>
        <p>Não há aulas realizadas ou substituídas em ${monthName}/${FechamentoState.selectedYear}.</p>
        <p style="font-size:12px;color:var(--text3);margin-top:8px;">
          Apenas aulas com status "Realizada" ou "Substituída" entram no fechamento.
        </p>
      </div>
    `;
    updateFechamentoSubtitle(0, 0);
    return;
  }

  const checklist = montarChecklist(data);
  const bloqueios = checklist.filter(i => i.nivel === 'bloqueia');
  const canClose = typeof isStrictAdmin === 'function' && isStrictAdmin();

  const botao = !canClose
    ? `<div class="info-callout" style="max-width:420px;">
         ℹ️ Apenas <strong>Administrador</strong> pode executar o fechamento.
       </div>`
    : `<button class="btn" onclick="showCloseConfirmModal()" style="width:auto;"
         ${bloqueios.length ? 'disabled title="Resolva as pendências do bloco 1 primeiro"' : ''}>
         ${bloqueios.length ? '🔒 Resolva as pendências primeiro' : '🔒 Fechar mês'}
       </button>`;

  container.innerHTML = `
    ${renderKpis(data, bloqueios.length)}
    ${renderBlocoChecklist(checklist)}
    ${renderBlocoFolha(teachers, totals)}
    ${renderBlocoEstagiarios(teachers)}
    ${renderBlocoTrocas()}
    ${renderBlocoCadastro(teachers)}
    ${renderBlocoUnidades(data)}
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px;">${botao}</div>
  `;

  updateFechamentoSubtitle(totals.classesRealizadas, totals.totalValor);
}

/** Cartões de número grande — o que a gestão olha primeiro. */
function renderKpis(data, qtdBloqueios) {
  const t = data.totals || {};
  const c = data.conferencia || {};
  const card = (valor, rotulo, alerta) => `
    <div class="report-card" style="padding:12px 14px;${alerta ? 'border-color:var(--orange);' : ''}">
      <div style="font-size:22px;font-weight:700;${alerta ? 'color:var(--orange);' : ''}">${valor}</div>
      <div style="font-size:11px;color:var(--text2);margin-top:2px;">${rotulo}</div>
    </div>`;
  return `
    <div class="report-grid" style="margin-bottom:16px;">
      ${card(fmt(t.totalValor || 0), 'Total da folha')}
      ${card((data.teachers || []).length, 'Pessoas')}
      ${card((c.aulasQuePagam || 0).toLocaleString('pt-BR'), 'Aulas · ' + (t.totalHoras || 0).toFixed(2).replace('.', ',') + 'h')}
      ${card(qtdBloqueios || '0', 'Pendências antes de fechar', qtdBloqueios > 0)}
    </div>`;
}

/**
 * O checklist do bloco 1 — separado do HTML porque é ele quem decide se o botão
 * de fechar libera. Só entra aqui pergunta que se responde com o dado da prévia.
 */
function montarChecklist(data) {
  const c = data.conferencia || {};
  const itens = [];

  // 1. Trocas de professor — desde 05/09/2026 TODA troca aberta trava.
  if (FechamentoState.trocasErro) {
    itens.push({ nivel: 'bloqueia', titulo: 'Trocas de professor',
      situacao: 'Não consegui verificar (' + escapeHtml(FechamentoState.trocasErro)
        + '). Fechar é irreversível — sem essa checagem, não dá.',
      acao: null });
  } else {
    const abertas = FechamentoState.trocasAbertas || [];
    itens.push(abertas.length
      ? { nivel: 'bloqueia', titulo: 'Trocas de professor em aberto',
          situacao: '<b>' + abertas.length + '</b> aula(s) ainda no nome de quem não deu',
          acao: { rotulo: 'Resolver', pagina: 'substituicoes' } }
      : { nivel: 'ok', titulo: 'Trocas de professor', situacao: 'nenhuma em aberto', acao: null });
  }

  // 2. Cadastro que faz a pessoa receber errado.
  const semValor = (data.teachers || []).filter(t =>
    (t.avisos || []).some(a => a === 'sem_salario' || a === 'sem_valor_hora'));
  itens.push(semValor.length
    ? { nivel: 'bloqueia', titulo: 'Cadastro com problema',
        situacao: '<b>' + semValor.length + '</b> pessoa(s) com aula valendo R$ 0,00',
        acao: { rotulo: 'Ver', pagina: 'pessoas' } }
    : { nivel: 'ok', titulo: 'Cadastro salarial', situacao: 'todo mundo com valor cadastrado', acao: null });

  // 3. Aulas que não entram na folha — ninguém recebe por elas.
  const naoContam = (c.aulasNoMes || 0) - (c.aulasQuePagam || 0);
  itens.push(naoContam > 0
    ? { nivel: 'avisa', titulo: 'Aulas fora da folha',
        situacao: naoContam + ' de ' + c.aulasNoMes + ' não entram — ' + resumoStatus(c.statusAulas),
        acao: { rotulo: 'Ver', pagina: 'agenda-geral' } }
    : { nivel: 'ok', titulo: 'Aulas marcadas',
        situacao: c.aulasQuePagam + ' de ' + c.aulasNoMes + ' · nenhuma pendente', acao: null });

  // 4. Ocorrências: nenhuma no mês inteiro costuma ser "ninguém lançou", não
  //    "não houve" — a aula vira 'realizada' sozinha às 3h da manhã.
  itens.push({ nivel: 'ok', titulo: 'Ocorrências lançadas',
    situacao: c.ocorrencias
      ? c.ocorrencias + ' aula(s) com falta, atraso, saída antecipada ou hora extra'
      : 'nenhuma no mês — confira se é isso mesmo, a aula é confirmada automaticamente',
    acao: { rotulo: 'Ver', pagina: 'relatorios' } });

  // 5. Férias — o fechamento paga por elas.
  itens.push(c.ferias === null
    ? { nivel: 'avisa', titulo: 'Férias no mês', situacao: 'não consegui conferir', acao: null }
    : { nivel: 'ok', titulo: 'Férias no mês',
        situacao: (c.ferias || []).length
          ? (c.ferias || []).length + ' aprovada(s) tocam este mês' : 'nenhuma aprovada',
        acao: (c.ferias || []).length ? { rotulo: 'Ver', pagina: 'ferias' } : null });

  // 6. As duas unidades — o motivo de o fechamento ter deixado de ser por unidade.
  const duas = (data.teachers || []).filter(t => (t.porUnidade || []).length > 1);
  itens.push({ nivel: 'ok', titulo: 'Quem dá aula nas duas unidades',
    situacao: duas.length
      ? duas.length + ' pessoa(s) · bolsa e VR/VT contados uma vez só'
      : 'ninguém neste mês', acao: null });

  return itens;
}

function resumoStatus(statusAulas) {
  const rotulo = { prevista: 'ainda previstas', cancelada: 'canceladas', nao_realizada: 'não realizadas' };
  return Object.keys(statusAulas || {})
    .filter(k => k !== 'realizada' && k !== 'substituida')
    .map(k => statusAulas[k] + ' ' + (rotulo[k] || k))
    .join(' · ') || '—';
}

function renderBlocoChecklist(itens) {
  const icone = { bloqueia: '<span style="color:var(--red)">⛔</span>',
                  avisa: '<span style="color:var(--orange)">⚠️</span>',
                  ok: '<span style="color:var(--green)">✅</span>' };
  const pedem = itens.filter(i => i.nivel !== 'ok').length;
  const linhas = itens.map(i => `
    <tr>
      <td style="width:30px;text-align:center;">${icone[i.nivel]}</td>
      <td>${escapeHtml(i.titulo)}</td>
      <td style="color:var(--text2);">${i.situacao}</td>
      <td style="text-align:right;">${i.acao
        ? '<button class="btn btn-sm ' + (i.nivel === 'bloqueia' ? '' : 'btn-ghost')
          + '" style="width:auto;" onclick="navigateTo(\'' + i.acao.pagina + '\')">'
          + escapeHtml(i.acao.rotulo) + '</button>'
        : ''}</td>
    </tr>`).join('');
  return blocoTabela('1 · Antes de fechar',
    pedem ? pedem + ' de ' + itens.length + ' itens pedem ação' : 'tudo conferido',
    '<thead><tr><th></th><th>Item</th><th>Situação</th><th></th></tr></thead><tbody>' + linhas + '</tbody>',
    'O botão “Fechar mês” só libera quando não houver item em ⛔.');
}

function renderBlocoFolha(teachers, totals) {
  return blocoTabela('2 · A folha do mês', teachers.length + ' pessoas · uma linha cada',
    null, null, renderTeacherTable(teachers, totals, false));
}

function renderBlocoEstagiarios(teachers) {
  const est = teachers.filter(t => t.isIntern && !t.internSemContrato);
  if (!est.length) return '';
  const h2 = n => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',') + 'h';
  const ordenado = est.slice().sort((a, b) =>
    (b.totalHoras - (b.internLimitHours || 0)) - (a.totalHoras - (a.internLimitHours || 0)));

  let somaContrato = 0, somaHoras = 0, somaExtra = 0, somaExc = 0, somaDev = 0;
  const linhas = ordenado.map(t => {
    const contrato = t.internContratoMes != null ? t.internContratoMes : (t.internLimitHours || 0);
    const diff = t.totalHoras - contrato;
    const pct = contrato > 0 ? Math.round((t.totalHoras / contrato) * 100) : 0;
    somaContrato += contrato; somaHoras += t.totalHoras;
    somaExtra += (t.internExcessValue || 0);
    if (diff > 0) somaExc += diff; else somaDev += -diff;
    return `
      <tr>
        <td style="font-weight:600;">${escapeHtml(t.teacherName)}</td>
        <td class="mono" style="text-align:right;">${h2(contrato)}</td>
        <td class="mono" style="text-align:right;">${h2(t.totalHoras)}</td>
        <td style="width:130px;">
          <div style="height:5px;border-radius:3px;background:var(--surface2);overflow:hidden;">
            <div style="height:100%;width:${Math.min(100, pct)}%;background:${diff > 0 ? 'var(--orange)' : 'var(--green)'};"></div>
          </div>
          <span style="font-size:11px;color:var(--text2);">${pct}%</span>
        </td>
        <td class="mono" style="text-align:right;${diff > 0 ? 'color:var(--orange);font-weight:600;' : ''}">
          ${diff > 0 ? '+' : ''}${h2(diff)}</td>
        <td class="mono" style="text-align:right;${(t.internExcessValue || 0) > 0 ? 'color:var(--orange);font-weight:700;' : ''}">
          ${(t.internExcessValue || 0) > 0 ? fmt(t.internExcessValue) : '—'}</td>
        <td class="mono" style="text-align:right;">${(t.internSaldoFinal || 0) < 0 ? h2(-t.internSaldoFinal) : '—'}</td>
      </tr>`;
  }).join('');

  const acima = ordenado.filter(t => (t.internExcessValue || 0) > 0).length;
  return blocoTabela('3 · Bolsistas — contrato × horas',
    somaExtra > 0 ? acima + ' acima do contrato · ' + fmt(somaExtra) + ' de hora extra'
                  : 'ninguém passou do contrato',
    '<thead><tr>'
    + '<th>Bolsista</th><th style="text-align:right;">Contrato</th><th style="text-align:right;">Horas</th>'
    + '<th>Uso do contrato</th><th style="text-align:right;">Excedente</th>'
    + '<th style="text-align:right;">R$ extra</th><th style="text-align:right;">Saldo a compensar</th>'
    + '</tr></thead><tbody>' + linhas + '</tbody>'
    + '<tfoot><tr style="background:var(--surface2);font-weight:700;">'
    + '<td>TOTAL</td>'
    + '<td class="mono" style="text-align:right;">' + h2(somaContrato) + '</td>'
    + '<td class="mono" style="text-align:right;">' + h2(somaHoras) + '</td>'
    + '<td></td>'
    + '<td class="mono" style="text-align:right;">+' + h2(somaExc) + '</td>'
    + '<td class="mono" style="text-align:right;">' + fmt(somaExtra) + '</td>'
    + '<td class="mono" style="text-align:right;">' + h2(somaDev) + '</td>'
    + '</tr></tfoot>',
    'Bolsa é sempre cheia. Quem ficou abaixo do contrato não perde nada — as horas viram saldo a compensar, e o saldo só se mexe quando o mês fecha.');
}

/** Bloco 4 — as trocas que travam, agrupadas por quem precisa confirmar. */
function renderBlocoTrocas() {
  if (FechamentoState.trocasErro) {
    return blocoTabela('4 · Trocas em aberto', 'não consegui verificar', null, null,
      '<div class="alert-overdue-card" style="margin:12px;">'
      + '<div class="alert-overdue-title">⛔ Não consegui verificar as trocas de professor</div>'
      + '<div class="alert-overdue-note">Detalhe: ' + escapeHtml(FechamentoState.trocasErro)
      + '. Tente carregar a prévia de novo.</div></div>');
  }
  const abertas = FechamentoState.trocasAbertas || [];
  if (!abertas.length) return '';

  const nome = (id) => {
    const t = (FechamentoState.previewData.teachers || []).find(x => x.teacherId === id);
    if (t) return t.teacherName;
    if (typeof AgendaState === 'object' && AgendaState.teachersMap && AgendaState.teachersMap.get(id)) {
      return AgendaState.teachersMap.get(id).name;
    }
    return '—';
  };

  // Uma linha por pessoa que precisa confirmar — é assim que a gestão cobra.
  const porAlvo = new Map();
  for (const s of abertas) {
    const alvo = SubstitutionFlow.quemConfirma(s) || '(gestão)';
    if (!porAlvo.has(alvo)) porAlvo.set(alvo, []);
    porAlvo.get(alvo).push(s);
  }
  const linhas = [...porAlvo.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(function (par) {
      const alvo = par[0], lista = par[1];
      const cobriram = new Map();
      lista.forEach(s => cobriram.set(s.substituteTeacherId, (cobriram.get(s.substituteTeacherId) || 0) + 1));
      const naGestao = lista.filter(s => s.status === 'aguardando_gestao').length;
      return `
        <tr>
          <td style="font-weight:600;">${escapeHtml(nome(alvo))}</td>
          <td class="mono" style="text-align:center;">${lista.length}</td>
          <td style="font-size:12px;">${[...cobriram.entries()]
            .map(e => escapeHtml(nome(e[0])) + ' (' + e[1] + ')').join(' · ')}</td>
          <td style="font-size:12px;color:var(--text2);">${naGestao
            ? naGestao + ' já confirmada(s) pelo colega, esperando você'
            : 'ainda sem resposta do professor'}</td>
        </tr>`;
    }).join('');

  return blocoTabela('4 · Trocas em aberto',
    abertas.length + ' aula(s) travando o fechamento',
    '<thead><tr><th>Esperando confirmar</th><th style="text-align:center;">Aulas</th>'
    + '<th>Quem cobriu</th><th>Situação</th></tr></thead><tbody>' + linhas + '</tbody>',
    'Enquanto não confirmadas, as aulas ficam no nome de quem estava antes e a folha paga essa pessoa. '
    + 'Você pode confirmar sem esperar o professor — em <strong>Substituições</strong>, botão “Confirmar mesmo assim”.',
    null,
    '<button class="btn btn-sm" style="width:auto;" onclick="navigateTo(\'substituicoes\')">Ir para Substituições</button>');
}

function renderBlocoCadastro(teachers) {
  const ROTULO = {
    sem_salario: 'Sem cadastro salarial',
    sem_valor_hora: 'Cadastro salarial sem valor por hora — e a ficha não é de bolsista',
    sem_contrato_horas: 'Bolsa sem contrato de horas cadastrado — fica sem banco de horas',
  };
  const alvo = teachers.filter(t => (t.avisos || []).some(a => ROTULO[a]));
  if (!alvo.length) return '';
  const linhas = alvo.map(t => `
    <tr>
      <td style="font-weight:600;">${escapeHtml(t.teacherName)}</td>
      <td style="font-size:12px;">${(t.avisos || []).filter(a => ROTULO[a]).map(a => ROTULO[a]).join('<br>')}</td>
      <td class="mono" style="text-align:right;">${t.classesCount} · ${t.totalHoras.toFixed(2).replace('.', ',')}h</td>
      <td class="mono" style="text-align:right;${t.valorHoras <= 0 ? 'color:var(--red);font-weight:700;' : ''}">${fmt(t.valorHoras)}</td>
    </tr>`).join('');
  return blocoTabela('5 · Cadastro com problema', alvo.length + ' pessoa(s)',
    '<thead><tr><th>Pessoa</th><th>O que está errado</th><th style="text-align:right;">Aulas</th>'
    + '<th style="text-align:right;">Pagaria de horas</th></tr></thead><tbody>' + linhas + '</tbody>',
    'Corrigir é na ficha da pessoa, aba Salarial. Depois recarregue a prévia.',
    null,
    '<button class="btn btn-sm" style="width:auto;" onclick="navigateTo(\'pessoas\')">Ir para Pessoas</button>');
}

function renderBlocoUnidades(data) {
  const un = ((data.conferencia || {}).unidades) || [];
  if (un.length < 2) return '';
  const h2 = n => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',') + 'h';
  const totalHoras = un.reduce((s, u) => s + u.horas, 0);
  const linhas = un.map(u => `
    <tr>
      <td style="font-weight:600;">${escapeHtml(u.unitName)}</td>
      <td class="mono" style="text-align:right;">${u.classesCount}</td>
      <td class="mono" style="text-align:right;">${h2(u.horas)}</td>
      <td class="mono" style="text-align:right;">${totalHoras > 0 ? ((u.horas / totalHoras) * 100).toFixed(1).replace('.', ',') : '0'}%</td>
      <td class="mono" style="text-align:right;">${u.pessoas}</td>
    </tr>`).join('');
  const somaPessoas = un.reduce((s, u) => s + u.pessoas, 0);
  const reais = (data.teachers || []).length;
  return blocoTabela('6 · Custo por unidade', 'só leitura — o pagamento é por pessoa',
    '<thead><tr><th>Unidade</th><th style="text-align:right;">Aulas</th><th style="text-align:right;">Horas</th>'
    + '<th style="text-align:right;">% das horas</th><th style="text-align:right;">Pessoas</th></tr></thead>'
    + '<tbody>' + linhas + '</tbody>'
    + '<tfoot><tr style="background:var(--surface2);font-weight:700;">'
    + '<td>TOTAL</td>'
    + '<td class="mono" style="text-align:right;">' + un.reduce((s, u) => s + u.classesCount, 0) + '</td>'
    + '<td class="mono" style="text-align:right;">' + h2(totalHoras) + '</td>'
    + '<td class="mono" style="text-align:right;">100%</td>'
    + '<td class="mono" style="text-align:right;">' + reais + ' pessoas</td>'
    + '</tr></tfoot>',
    somaPessoas > reais
      ? (somaPessoas - reais) + ' pessoa(s) dão aula nas duas unidades — por isso a soma da coluna “Pessoas” passa de ' + reais + '.'
      : null);
}

/** Casca comum dos blocos: título, contagem, tabela e a nota de rodapé. */
function blocoTabela(titulo, contagem, tabelaInterna, nota, htmlPronto, acaoTopo) {
  const corpo = htmlPronto || ('<div class="table-wrap"><table>' + tabelaInterna + '</table></div>');
  return `
    <section class="report-card" style="padding:0;margin-bottom:16px;">
      <div style="padding:11px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <h3 style="font-size:13px;margin:0;text-transform:uppercase;letter-spacing:.06em;">${escapeHtml(titulo)}</h3>
        <span style="font-size:11px;color:var(--text2);">${contagem || ''}</span>
        <span style="flex:1;"></span>
        ${acaoTopo || ''}
      </div>
      ${corpo}
      ${nota ? '<div style="color:var(--text3);font-size:11px;padding:10px 14px;">' + nota + '</div>' : ''}
    </section>`;
}

// ─── Closed content ────────────────────────────────────────────────────
function renderClosedContent() {
  const container = document.getElementById('fechamentoContent');
  const doc = FechamentoState.closingDoc;
  if (!doc) return;

  const monthName = MONTH_NAMES[(doc.month || FechamentoState.selectedMonth) - 1];
  const closedDate = doc.closedAt && doc.closedAt.toDate ? doc.closedAt.toDate() : new Date();
  const dateStr = closedDate.toLocaleDateString('pt-BR');

  const nomeUn = id => {
    const u = FechamentoState.units.find(x => x.id === id);
    return u ? (u.name || id) : id;
  };
  const unitName = Array.isArray(doc.unitIds) && doc.unitIds.length
    ? doc.unitIds.map(nomeUn).join(' + ')
    : nomeUn(doc.unitId);

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

  const nomeUn = id => {
    const u = FechamentoState.units.find(x => x.id === id);
    return u ? (u.name || id) : id;
  };
  // Sem unidade no nome, "CP 12h" não diz nada pra quem lê. Encurta pro que a
  // academia fala: "CP", "PP". O nome vem da própria linha da folha quando ela
  // traz (é a mesma fonte do cálculo); a lista da tela é só o reforço.
  const curto = (u) => {
    const nome = (u && u.unitName) || nomeUn(u && u.unitId);
    return String(nome).replace(/^CrossTainer\s*/i, '') || (u && u.unitId) || '—';
  };

  // O filtro é lente de leitura: some com quem não deu aula na unidade, mas os
  // VALORES continuam sendo os do MÊS INTEIRO — é assim que o dinheiro sai.
  const filtro = FechamentoState.filtroUnitId;
  const visiveis = filtro
    ? teachers.filter(t => (t.porUnidade || []).some(u => u.unitId === filtro))
    : teachers;

  if (!visiveis.length) {
    return `<div class="empty-state-small">Ninguém deu aula em ${escapeHtml(nomeUn(filtro))} neste mês.</div>`;
  }

  const AVISO_TEXTO = {
    sem_salario: '⚠️ <b>Sem cadastro salarial</b> — vai receber R$ 0,00 pelas horas.',
    sem_valor_hora: '⚠️ <b>Sem valor por hora cadastrado</b> — as aulas do mês estão valendo R$ 0,00. Confira o tipo da ficha e o cadastro salarial.',
    sem_contrato_horas: '⚠️ <b>Contrato de horas não cadastrado</b> — pago só a bolsa, sem banco de horas.',
  };

  const rows = visiveis.map(t => {
    const typeLabel = { efetivo: 'Efetivo', estagiario: 'Estagiário', eventual: 'Eventual' }[t.teacherType] || t.teacherType;
    const outrosList = Array.isArray(t.otherBenefits) && t.otherBenefits.length > 0
      ? t.otherBenefits.map(b => `${escapeHtml(b.nome || '?')}: ${fmt(b.valor || 0)}`).join('<br>')
      : '—';

    // Onde a pessoa deu aula. Quem dá aula nas duas unidades era exatamente
    // quem levava bolsa e VT em dobro — agora aparece de cara, numa linha só.
    const unidades = (t.porUnidade || []).length
      ? (t.porUnidade || []).map(u =>
          `<span ${u.unitId === filtro ? 'style="font-weight:700;"' : ''}>${escapeHtml(curto(u))} ${u.horas.toFixed(1).replace('.', ',')}h</span>`
        ).join(' · ')
      : '—';

    const hasVacation = t.vacationValue > 0;
    const vacRow = hasVacation ? `
      <tr class="${t.isVacationOnly ? 'row-vacation-only' : 'row-vacation'}">
        <td colspan="9" style="text-align:right;font-size:12px;padding:6px 12px;">
          🏖️ Férias: ${(t.vacationDetails || []).map(vd =>
            `${vd.daysInMonth} dia(s) · ${vd.paymentMode === 'auto' ? 'Automático' : vd.paymentMode === 'manual' ? 'Manual' : vd.paymentMode} · ${fmt(vd.proportionalValue)}`
          ).join(' | ')}
          ${t.isVacationOnly ? '<br><em>Período sem aulas — pagamento exclusivo de férias</em>' : ''}
        </td>
      </tr>
    ` : '';

    // Erro de cadastro que hoje passava calado: 88 aulas valendo R$ 0,00 sem
    // uma palavra na tela (o caso do Thiago Valentim, agosto/2026).
    const avisoRow = (t.avisos || []).filter(a => AVISO_TEXTO[a]).map(a => `
      <tr class="row-banco-horas">
        <td colspan="9" style="text-align:right;font-size:12px;padding:6px 12px;color:var(--orange);">
          ${AVISO_TEXTO[a]}
        </td>
      </tr>`).join('');

    // Banco de horas do estagiário (bloco 2) — a conta aberta. Sem ver de onde
    // saiu o número, ninguém confia nele: a bolsa é cheia mesmo trabalhando a
    // menos, e o que "faltou" vira saldo de horas, não desconto.
    const bancoRow = (t.isIntern && t.internExplicacao && !t.internSemContrato) ? `
      <tr class="row-banco-horas">
        <td colspan="9" style="text-align:right;font-size:12px;padding:6px 12px;color:var(--text2);">
          🕒 Banco de horas de ${escapeHtml(t.teacherName)}: ${escapeHtml(t.internExplicacao)}
        </td>
      </tr>
    ` : '';

    return `
      <tr>
        <td>
          <div style="font-weight:600;">${escapeHtml(t.teacherName)}</div>
          <div style="font-size:10px;color:var(--text3);">${typeLabel}${t.isInternProportional ? ' · Excedente' : ''}</div>
        </td>
        <td style="font-size:11px;">${unidades}</td>
        <td class="mono" style="text-align:center;">${t.classesCount}</td>
        <td class="mono" style="text-align:right;">${t.totalHoras.toFixed(1)}h</td>
        <td class="mono" style="text-align:right;">${fmt(t.valorHoras)}</td>
        <td class="mono" style="text-align:right;">${t.mealAllowance ? fmt(t.mealAllowance) : '—'}</td>
        <td class="mono" style="text-align:right;">${t.transportAllowance ? fmt(t.transportAllowance) : '—'}</td>
        <td style="text-align:right;font-size:12px;">${outrosList}</td>
        <td class="mono" style="text-align:right;font-weight:700;">${fmt(t.valorTotal)}</td>
      </tr>
      ${avisoRow}
      ${bancoRow}
      ${vacRow}
    `;
  }).join('');

  const notaFiltro = filtro ? `
    <div class="info-callout" style="margin-bottom:8px;">
      Mostrando quem deu aula em <strong>${escapeHtml(nomeUn(filtro))}</strong>.
      Os valores são do <strong>mês inteiro</strong>, das duas unidades — é uma pessoa,
      um pagamento.
    </div>` : '';

  return `
    ${notaFiltro}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Professor</th>
            <th style="width:150px;">Unidades</th>
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
            <td>TOTAL${filtro ? ' (mês inteiro)' : ''}</td>
            <td></td>
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
            <td colspan="8" style="text-align:right;font-weight:600;">🏖️ Total Férias</td>
            <td class="mono" style="text-align:right;font-weight:700;">${fmt(totals.totalVacationValue)}</td>
          </tr>
          <tr>
            <td colspan="8" style="text-align:right;font-weight:700;font-size:14px;">💵 TOTAL GERAL</td>
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

  if (FechamentoState.mode === 'closed') {
    el.textContent = `${monthName}/${FechamentoState.selectedYear} · academia inteira · FECHADO`;
  } else if (classCount > 0) {
    el.textContent = `${monthName}/${FechamentoState.selectedYear} · academia inteira · ${classCount} aulas · ${fmt(totalValue)}`;
  } else {
    el.textContent = `${monthName}/${FechamentoState.selectedYear}`;
  }
}

// ─── Modal de confirmação ──────────────────────────────────────────────
async function showCloseConfirmModal() {
  const modal = document.getElementById('closeMonthConfirmModal');
  if (!modal) return;

  const monthName = MONTH_NAMES[FechamentoState.selectedMonth - 1];
  const data = FechamentoState.previewData;
  const classCount = data ? data.totals.classesRealizadas : 0;

  // Abre o modal já em modo de carregamento — as duas buscas abaixo (trocas
  // abertas + nomes dos professores) levam um instante, e clicar e não ver
  // nada acontecer parece bug.
  document.getElementById('closeMonthConfirmBody').innerHTML = `
    <div class="loading"><div class="spinner"></div> Verificando trocas de professor pendentes...</div>
  `;
  document.getElementById('closeMonthConfirmError').textContent = '';
  const btnLoading = document.getElementById('closeMonthConfirmBtn');
  if (btnLoading) {
    btnLoading.disabled = true;
    btnLoading.textContent = 'Confirmar fechamento';
  }
  modal.classList.add('open');

  // Troca pendente vira pagamento errado que ninguém desfaz: fechar é
  // irreversível. O que espera a GESTÃO trava — é ação dela. O que espera um
  // professor responder só avisa, senão a folha fica refém de quem não abre o app.
  const y = FechamentoState.selectedYear;
  const m = FechamentoState.selectedMonth;
  const de = new Date(Date.UTC(y, m - 1, 1, 3, 0, 0));
  const ate = new Date(Date.UTC(y, m, 0, 26, 59, 59));

  let abertasRes, profsRes;
  try {
    abertasRes = await SubstitutionService.listAbertasNoPeriodo(de, ate);
  } catch (err) {
    abertasRes = { success: false, error: (err && err.message) || 'erro desconhecido' };
  }

  // A checagem de trocas é a única coisa que pode travar o fechamento — se ela
  // não rodou, não há como saber se está tudo limpo. Falhar aberto aqui
  // (deixar fechar) já escondeu um pedido de substituição em produção antes;
  // fechar mês é irreversível e mexe em dinheiro, então falha fechado.
  if (!abertasRes.success) {
    document.getElementById('closeMonthConfirmBody').innerHTML = `
      <div class="alert-overdue-card">
        <div class="alert-overdue-title">⛔ Não consegui verificar as trocas de professor</div>
        <div class="alert-overdue-note">
          O fechamento é irreversível, então não vou deixar fechar sem essa checagem.
          Tente de novo em instantes. Se persistir, avise o suporte.
        </div>
        <div class="alert-overdue-note" style="margin-top:6px;">Detalhe: ${escapeHtml(abertasRes.error || 'erro desconhecido')}</div>
      </div>
    `;
    const b = document.getElementById('closeMonthConfirmBtn');
    if (b) { b.disabled = true; b.textContent = 'Não foi possível verificar'; }
    return;
  }

  const p = SubstitutionFlow.pendenciasDoFechamento(abertasRes.data);

  // A tela de fechamento nunca carregou AgendaState — busca os nomes aqui.
  // Isto não trava o fechamento: a lista de trocas já é o que importa, os
  // nomes são só para ler a lista. Se falhar, avisa em vez de mostrar
  // travessões sem explicação.
  try {
    profsRes = await TeacherService.list();
  } catch (err) {
    profsRes = { success: false, error: (err && err.message) || 'erro desconhecido' };
  }
  const nomes = new Map((profsRes.success ? profsRes.data : []).map(t => [t.id, t.name]));
  const nomeProf = id => nomes.get(id) || '—';

  const linhaTroca = s => `<li>${escapeHtml(nomeProf(s.substituteTeacherId))} deu a aula de ${
    escapeHtml(nomeProf(s.requestingTeacherId))}${s.classDate && s.classDate.toDate
      ? ' em ' + s.classDate.toDate().toLocaleDateString('pt-BR') : ''}</li>`;

  const nomesIndisponiveis = !profsRes.success ? `
    <p style="font-size:12px;color:var(--text3);margin-bottom:8px;">
      ⚠️ Não consegui carregar os nomes dos professores — os travessões abaixo são por isso, não porque falta informação.
    </p>` : '';

  // Toda troca aberta trava (05/09/2026). Os dois grupos continuam separados
  // porque a saída é diferente: uma espera um clique da gestão, a outra espera
  // alguém que talvez nunca responda — e é aí que entra "Confirmar mesmo assim".
  const bloqueio = p.travam.length > 0 ? `
    <div class="alert-overdue-card">
      <div class="alert-overdue-title">⛔ ${p.travam.length} troca(s) de professor em aberto</div>
      <div class="alert-overdue-note">Resolva em <strong>Substituições</strong> antes de fechar — depois de fechado o mês, a aula não muda mais de nome e a folha paga quem está no nome dela hoje.</div>
      ${p.esperandoGestao.length > 0 ? `
        <div class="alert-overdue-note" style="margin-top:8px;"><strong>${p.esperandoGestao.length} esperando você confirmar</strong> (o colega já respondeu):</div>
        <ul class="alert-overdue-list" style="margin-top:4px;">${p.esperandoGestao.map(linhaTroca).join('')}</ul>` : ''}
      ${p.semRespostaDoProfessor.length > 0 ? `
        <div class="alert-overdue-note" style="margin-top:8px;"><strong>${p.semRespostaDoProfessor.length} sem resposta do professor</strong> — use o botão <strong>"Confirmar mesmo assim"</strong>, fica registrado que foi sem a resposta dele:</div>
        <ul class="alert-overdue-list" style="margin-top:4px;">${p.semRespostaDoProfessor.map(linhaTroca).join('')}</ul>` : ''}
    </div>` : '';

  const alerta = '';

  document.getElementById('closeMonthConfirmBody').innerHTML = `
    ${nomesIndisponiveis}
    ${bloqueio}
    ${alerta}
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

  const btn = document.getElementById('closeMonthConfirmBtn');
  if (btn) {
    btn.disabled = p.travam.length > 0;
    btn.textContent = p.travam.length > 0 ? 'Resolva as trocas primeiro' : 'Confirmar fechamento';
  }
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

  const { selectedYear, selectedMonth } = FechamentoState;

  try {
    const callable = firebase.functions().httpsCallable('closeMonth');
    // sem unitId: fecha o mês da academia inteira, uma linha por pessoa
    const result = await callable({ year: selectedYear, month: selectedMonth });

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
  FechamentoState.mode = 'history';
  renderFechamentoUI();

  // Carrega histórico
  const container = document.getElementById('fechamentoContent');
  container.innerHTML = `
    <div class="loading"><div class="spinner"></div> Carregando histórico...</div>
  `;

  const res = await ClosingService.list();

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
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📜</div>
        <h3>Nenhum fechamento encontrado</h3>
        <p>Nenhum mês foi fechado ainda.</p>
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
  FechamentoState.mode = 'closed';
  renderFechamentoUI();
}

// ─── Helper ────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

console.log('[CrossTainer Professores] professores-fechamento.js carregado · Sprint 4a');
