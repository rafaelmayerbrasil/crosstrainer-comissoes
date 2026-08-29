// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Módulo Professores · Escala Inteligente (sábados/feriados)
// UI que consome ScaleService (CRUD + consolidação) + ScaleEngine.
// Plano: docs/superpowers/plans/2026-06-24-escala-ui.md (5b).
// Adapta por perfil: gestão = visão de gestão; professor = marcar preferências.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const EscalaSmartState = { scales: [], units: [], modToi: null, modHiit: null, selectedId: null, teacherMap: new Map(), janelaPorTipo: {}, pessoaSel: null, remontando: null, tab: 'sabado', year: new Date().getFullYear(), feriadosByYear: {}, config: null, timeframe: 'futuros', selected: new Set(), _janelaTarget: null, pessoaJanela: 'todas' };

const ESCALA_TIPOS = [
  { id: 'sabado',           label: 'Sábado' },
  { id: 'feriado',          label: 'Feriado' },
  { id: 'domingo_especial', label: 'Domingo especial' },
  { id: 'evento',           label: 'Evento' },
  { id: 'fim_de_ano',       label: 'Fim de ano' },
  { id: 'escola_interna',   label: 'Escola Interna' },
];
const ESCALA_STATUS_LABEL = { rascunho: 'Rascunho', janela_aberta: 'Janela aberta', consolidada: 'Consolidada' };
const ESCALA_TABS = [
  { id: 'sabado',         label: 'Sábados' },
  { id: 'feriado',        label: 'Feriados' },
  { id: 'evento',         label: 'Eventos' },
  { id: 'fim_de_ano',     label: 'Fim de ano' },
  { id: 'escola_interna', label: 'Escola Interna' },
  { id: 'pessoa',         label: 'Por pessoa' },
];

function escalaIsManagement() {
  return (typeof isAdminGestao === 'function' && isAdminGestao()) ||
         (typeof isSupervisao === 'function' && isSupervisao());
}
function escalaProfId() {
  return (typeof AppState === 'object' && AppState.userProfile) ? AppState.userProfile.professorId : null;
}
function escalaTodayISO() { return new Date().toISOString().slice(0, 10); }
function escalaFmtBR(iso) { return iso.split('-').reverse().join('/'); }

// Slots-padrão (1 TOI + 1 Hiit por unidade) COM os horários da config por tipo.
// Sem horário o publishToAgenda pula o slot — por isso a config é obrigatória aqui.
function escalaSlotsPadrao(tipo) {
  const toi = EscalaSmartState.modToi, hiit = EscalaSmartState.modHiit;
  const hor = ((EscalaSmartState.config || {}).horarios || {})[tipo] || {};
  const slots = [];
  EscalaSmartState.units.forEach(u => {
    slots.push({ id: `${u.id}_TOI`,  unitId: u.id, requiredModalityId: toi.id,  requiredModalityName: 'TOI',  assignedPersonId: null, startTime: hor.startTime || '08:00', endTime: hor.endTime || '12:00' });
    slots.push({ id: `${u.id}_HIIT`, unitId: u.id, requiredModalityId: hiit.id, requiredModalityName: 'Hiit', assignedPersonId: null, startTime: hor.startTime || '08:00', endTime: hor.endTime || '12:00' });
  });
  return slots;
}

// Feriados nacionais do ano: BrasilAPI → fallback cache da CF → vazio (com aviso na aba)
async function escalaLoadFeriados(year) {
  if (EscalaSmartState.feriadosByYear[year]) return EscalaSmartState.feriadosByYear[year];
  let list = [];
  try {
    const resp = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`);
    if (resp.ok) list = ScaleService.parseFeriados(await resp.json());
  } catch (e) { /* offline: cai pro cache */ }
  if (!list.length) {
    try {
      const doc = await db.collection('meta').doc(`holidays_cache_${year}`).get();
      if (doc.exists) list = ScaleService.parseFeriados((doc.data() || {}).feriados);
    } catch (e) { /* sem cache: fica vazio */ }
  }
  EscalaSmartState.feriadosByYear[year] = list;
  return list;
}

function escalaSetTab(t) { EscalaSmartState.tab = t; EscalaSmartState.selectedId = null; renderEscalaSmartPage(); }

// Deep-link vindo da tela "Confirmar Presença": abre a aba certa e já sobe o modal
// de criação com a data preenchida. Consumido uma única vez em renderEscalaGestao.
let escalaSmartPendingNew = null;
function abrirEscalaSmartNovo(tipo, dateISO) {
  const tab = tipo === 'escola_interna' ? 'escola_interna' : 'evento';
  escalaSmartPendingNew = { tipo, date: dateISO || escalaTodayISO() };
  EscalaSmartState.tab = tab;
  EscalaSmartState.selectedId = null;
  if (dateISO && /^\d{4}/.test(dateISO)) EscalaSmartState.year = parseInt(dateISO.slice(0, 4), 10);
  EscalaSmartState.timeframe = 'todos'; // a data pode ser passada (chamada retroativa)
  if (typeof navigateTo === 'function') navigateTo('escala-smart');
  else renderEscalaSmartPage();
}

// Abre o modal pendente depois que a tela terminou de montar.
function escalaConsumirPendingNew() {
  const pend = escalaSmartPendingNew;
  if (!pend) return;
  escalaSmartPendingNew = null;
  if (pend.tipo === 'escola_interna') openNovaEscolaInterna(pend.date);
  else openNovoEvento(pend.date);
}
function escalaSetYear(y) { EscalaSmartState.year = parseInt(y, 10); renderEscalaSmartPage(); }
function escalaSetTimeframe(tf) { EscalaSmartState.timeframe = tf; renderEscalaSmartPage(); }

function renderEscalaSmartPage() {
  if (escalaIsManagement()) renderEscalaGestao();
  else renderEscalaPrefs();
}

/* ─── Carga comum ──────────────────────────────────────────────────── */
async function escalaLoadBase() {
  const [scalesRes, unitsRes, modsRes, teachersRes, cfgRes] = await Promise.all([
    ScaleService.listScales(),
    (typeof UnitService === 'object' ? UnitService.list() : Promise.resolve({ success: true, data: [] })),
    ModalityService.list(),
    TeacherService.list(),
    ScaleService.ScaleConfigService.get(),
  ]);
  EscalaSmartState.config = cfgRes.success ? cfgRes.data : { horarios: {} };
  EscalaSmartState.scales = scalesRes.success ? scalesRes.data : [];
  EscalaSmartState.units = unitsRes.success ? unitsRes.data : [];
  const mods = modsRes.success ? modsRes.data : [];
  EscalaSmartState.modToi = mods.find(m => /toi/i.test(m.name)) || null;
  EscalaSmartState.modHiit = mods.find(m => /hi+t|maromb/i.test(m.name)) || null;
  EscalaSmartState.teacherMap = new Map((teachersRes.success ? teachersRes.data : []).map(t => [t.id, t]));

  // Qual é "a janela" de cada tipo (sábados e feriados correm em lotes
  // separados, e os dois podem estar abertos ao mesmo tempo).
  EscalaSmartState.janelaPorTipo = escalaJanelasPorTipo(EscalaSmartState.scales);
}

/**
 * PURA: qual é "a janela" de cada grupo de tipos.
 *
 * Uma janela só, global, era mentira. Em produção (26/08/2026) rodam DUAS ao
 * mesmo tempo — sábados (9 datas) e feriados (07/09 e 12/10) — e a própria tela
 * já avisa "Há N janela(s) em andamento". Com um lote global, a aba que
 * perdesse a disputa mostraria ZERO pra todo mundo sob o título "Equilíbrio da
 * janela aberta": um número que não existe, afirmado com confiança.
 *
 * Agrupa por `tiposIrmaos`, então feriado e domingo especial caem no mesmo
 * balde — é assim que a aba Feriados sempre mostrou os dois. Dentro do grupo, a
 * regra é a de sempre: a janela aberta ganha; não havendo aberta, a mais
 * recente por data, que é a que a gestão acabou de fechar.
 *
 * @param {Array} scales lista de special_scales
 * @returns {Object<string, {id: string|null, aberta: boolean}>} grupo → lote
 */
function escalaJanelasPorTipo(scales) {
  const porGrupo = {};
  (scales || []).forEach(s => {
    if (!s || !s.windowBatchId || !s.tipo) return;
    const chave = ScaleService.tiposIrmaos(s.tipo)[0];
    const lotes = porGrupo[chave] || (porGrupo[chave] = {});
    const l = lotes[s.windowBatchId]
      || (lotes[s.windowBatchId] = { id: s.windowBatchId, aberta: false, ultima: '' });
    if (s.status === 'janela_aberta') l.aberta = true;
    if ((s.date || '') > l.ultima) l.ultima = s.date || '';
  });
  const out = {};
  Object.keys(porGrupo).forEach(chave => {
    const lista = Object.keys(porGrupo[chave]).map(k => porGrupo[chave][k]);
    const aberta = lista.find(l => l.aberta);
    const escolhido = aberta || lista.slice().sort((a, b) => (a.ultima > b.ultima ? -1 : 1))[0];
    out[chave] = { id: escolhido ? escolhido.id : null, aberta: !!aberta };
  });
  return out;
}

/**
 * O lote da janela daquele tipo. Nunca devolve indefinido: grupo sem lote
 * nenhum vale como "nenhuma janela ainda", e é isso que o título precisa dizer
 * em vez de anunciar uma janela aberta que não existe.
 */
function escalaJanelaDoTipo(tipo) {
  const chave = ScaleService.tiposIrmaos(tipo || 'sabado')[0];
  return (EscalaSmartState.janelaPorTipo || {})[chave] || { id: null, aberta: false };
}

/** Rótulo do lote: o período que ele cobre. `null` = data fora de qualquer janela. */
function escalaRotuloJanela(batchId) {
  if (!batchId) return null;
  const datas = (EscalaSmartState.scales || [])
    .filter(s => s.windowBatchId === batchId).map(s => s.date).sort();
  if (!datas.length) return batchId;
  return datas.length === 1 ? escalaFmtBR(datas[0])
    : `${escalaFmtBR(datas[0])} a ${escalaFmtBR(datas[datas.length - 1])}`;
}

function escalaSetPessoaJanela(v) { EscalaSmartState.pessoaJanela = v || 'todas'; renderEscalaGestao(); }

function escalaEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Mapa data → nome do feriado, do ano carregado. Vazio se a API não respondeu. */
function escalaFeriadoPorData(year) {
  const y = year || EscalaSmartState.year;
  const lista = EscalaSmartState.feriadosByYear[y] || [];
  return new Map(lista.map(f => [f.date, f.name]));
}

/**
 * Quem disputa vaga de sábado: precisa dar TOI ou Hiit.
 *
 * Sem esse filtro o painel acusava 3 pessoas "abaixo do mínimo" que nunca
 * seriam escaladas — Yasmin (TOI Mobility), Patrícia (Yoga) e Louiz Lume (TOI
 * Combate). Alerta que não tem como resolver vira ruído e some da vista.
 * (Rodrigo, 25/08/2026, ao pedir os nomes: foram os nomes que revelaram isso.)
 */
function participaDoRodizio(t) {
  const mods = t.modalityIds || [];
  const toi  = (EscalaSmartState.modToi  || {}).id;
  const hiit = (EscalaSmartState.modHiit || {}).id;
  if (!toi && !hiit) return true;   // sem modalidade mapeada, não filtra ninguém
  return mods.indexOf(toi) !== -1 || mods.indexOf(hiit) !== -1;
}

/**
 * Os dois números de cada pessoa: o da janela e o do ano.
 *
 * Rodrigo, 25/08/2026: "O contador deve considerar somente a janela aberta...
 * e em outro, um relatório separado, trazer quantas vezes quem foi escalado em
 * sábados e feriados". O painel mostra a janela; o motor decide pelo histórico —
 * se zerasse nos dois, na 1ª data de cada janela todo mundo empataria em zero e o
 * desempate voltaria a ser o mérito, que é fixo. Foi o defeito que quebrou
 * agosto (Bruno e Karin nos 11 sábados).
 */
function escalaContagens(tipo) {
  const scales = EscalaSmartState.scales || [];
  const tipos = ScaleService.tiposIrmaos(tipo || 'sabado');
  const ano = String(EscalaSmartState.year);
  const lote = escalaJanelaDoTipo(tipo);
  // O marco zero é um PISO comum ao motor e à tela, mas a BASE de cada um é
  // diferente: o motor corta a partir de 12 meses móveis antes da data da
  // escala (`dataDeCorte`, scale-service.js); a tela corta a partir de 1º de
  // janeiro do ano civil selecionado — de propósito, como `whyTableHtml` já
  // observa ("o painel do topo mostra o ano civil, então os dois não
  // precisam bater"). O marco entra por cima de QUALQUER uma das duas bases,
  // mas não faz elas coincidirem.
  let marco = (EscalaSmartState.config || {}).marcoZero || null;
  // Mesma blindagem do serviço (scale-service.js, dentro de `consolidate`):
  // um `scale_config.marcoZero` corrompido (Timestamp virado string, edição
  // manual fora do formato) não pode virar corte sem sentido em silêncio —
  // aqui o fallback é não cortar nada, mas nunca estourando o render.
  if (marco && !/^\d{4}-\d{2}-\d{2}$/.test(String(marco))) {
    console.warn(`[escalaContagens] marco zero configurado ("${marco}") não é uma data YYYY-MM-DD válida — ignorando na tela.`);
    marco = null;
  }
  const deAno = (marco && marco > `${ano}-01-01`) ? marco : `${ano}-01-01`;
  return {
    lote, marco, deAno,
    janela: lote.id
      ? ScaleService.contarPorPessoa(scales, { tipos, batchId: lote.id })
      : {},
    ano: ScaleService.contarPorPessoa(scales, { tipos, de: deAno, ate: `${ano}-12-31` }),
  };
}

/**
 * Nota "contando a partir de" pro número do ano — comum aos três lugares que
 * mostram esse corte (painel de Equilíbrio, histórico do ano, cartões da aba
 * Por pessoa). Usa `deAno` (o corte que REALMENTE valeu), não `marco` cru:
 * num ano posterior ao do marco, 1º de janeiro já é mais recente que ele e o
 * marco para de cortar qualquer coisa — nesse caso não há nota nenhuma, pra
 * não afirmar um corte que não está mais em vigor.
 */
function escalaNotaMarcoHtml(c) {
  const ano = String(EscalaSmartState.year);
  if (!c || !c.deAno || c.deAno === `${ano}-01-01`) return '';
  return `<div style="font-size:11px;color:var(--text3);margin-bottom:6px;">Contando a partir de ${ScaleService.fmtDataLonga(c.deAno)}.</div>`;
}

function renderEquilibrioPainel() {
  const ativos = Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false);
  const dentro = ativos.filter(participaDoRodizio);
  const fora   = ativos.filter(t => !participaDoRodizio(t));
  if (!dentro.length) return '';

  // A aba manda no que se conta: na aba Feriados, feriado; nas outras, sábado.
  // (Rodrigo, 25/08: "Nessa seção de feriados deveria contar somente os feriados".)
  const tipo = EscalaSmartState.tab === 'feriado' ? 'feriado' : 'sabado';
  const rotuloTipo = tipo === 'feriado' ? 'feriados' : 'sábados';
  const c = escalaContagens(tipo);

  const dias = dentro.map(t => c.janela[t.id] || 0);
  const avg = dias.reduce((a, b) => a + b, 0) / dias.length;

  const grupos = { abaixo: [], media: [], acima: [] };
  dentro.forEach(t => {
    const n = c.janela[t.id] || 0;
    const g = (n < 1) ? 'abaixo' : (n > Math.ceil(avg) ? 'acima' : 'media');
    grupos[g].push({ t, n, ano: (c.ano[t.id] || 0) });
  });
  Object.keys(grupos).forEach(k => grupos[k].sort((a, b) => a.n - b.n));

  const linha = (x) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:3px 0;font-size:12px;">
      <span>${escalaEsc(x.t.name)}</span>
      <span style="display:flex;align-items:center;gap:6px;color:var(--text2);white-space:nowrap;">
        ${x.n} nesta janela · ${x.ano} no ano
        <button class="btn-secondary" style="font-size:11px;padding:2px 8px;white-space:nowrap;"
                onclick="abrirAjusteFrequencia('${x.t.id}')"
                title="Mudar quantos dias esta pessoa tem nesta janela. O sistema rebalanceia os outros e mostra a prévia antes.">Ajustar</button>
      </span>
    </div>`;

  const bloco = (chave, bg, color, icon, rotulo) => {
    const itens = grupos[chave];
    return `<details style="flex:1;min-width:190px;">
      <summary style="list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:6px 12px;border-radius:8px;background:${bg};color:${color};">
        ${icon} ${itens.length} ${rotulo}
      </summary>
      <div style="padding:6px 4px 0;">${itens.length ? itens.map(linha).join('') : '<span style="font-size:12px;color:var(--text3);">ninguém</span>'}</div>
    </details>`;
  };

  const foraHtml = fora.length
    ? `<div style="font-size:11px;color:var(--text3);margin-top:8px;">
         ${fora.length} pessoa${fora.length === 1 ? '' : 's'} fora do rodízio de sábado (não dá TOI nem Hiit):
         ${fora.map(t => escalaEsc(t.name)).join(' · ')}
       </div>`
    : '';

  const titulo = !c.lote.id
    ? `Equilíbrio — nenhuma janela ainda (${rotuloTipo})`
    : c.lote.aberta
      ? `Equilíbrio da janela aberta (${rotuloTipo})`
      : `Equilíbrio da última janela (${rotuloTipo})`;

  return `<div style="margin-bottom:14px;">
    <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">${titulo}</div>
    ${escalaNotaMarcoHtml(c)}
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;">
      ${bloco('abaixo', '#2a1414', 'var(--red)',   '↓', 'ainda não pegou nenhum')}
      ${bloco('media',  '#10241a', 'var(--green)', '=', 'na média')}
      ${bloco('acima',  '#2a2410', '#caa23a',      '↑', 'acima')}
    </div>
    ${foraHtml}
  </div>`;
}

function whyTableHtml(slot, tipo) {
  const ex = slot.explain || [];
  if (!ex.length) return '';
  const prefLabel = (p) => (p === 'prefiro' || p === 'quer') ? 'prefiro' : (p === 'pode_ser' ? 'pode ser' : (p === 'nao_posso' ? 'não posso' : (p === 'nao_quer' ? '—' : '—')));
  const rows = ex.map(c => {
    const win = c.personId === slot.assignedPersonId;
    return `<tr style="${win ? 'background:var(--surface3);' : ''}">
      <td style="padding:3px 6px;${win ? 'font-weight:600;' : 'color:var(--text2);'}">${escalaPersonName(c.personId)}</td>
      <td style="padding:3px 6px;text-align:center;">${c.merito}</td>
      <td style="padding:3px 6px;text-align:center;">${c.diasTrabalhados}</td>
      <td style="padding:3px 6px;text-align:center;">${prefLabel(c.pref)}</td>
    </tr>`;
  }).join('');
  return `<details style="margin-top:8px;">
    <summary style="cursor:pointer;font-size:12px;color:var(--blue);">por quê?</summary>
    <table style="width:100%;font-size:11px;margin-top:6px;border-collapse:collapse;">
      <thead><tr style="color:var(--text2);text-align:left;"><th style="padding:3px 6px;font-weight:400;">Candidato</th><th style="padding:3px 6px;font-weight:400;text-align:center;">Pontos</th><th style="padding:3px 6px;font-weight:400;text-align:center;">${(tipo === 'feriado' || tipo === 'domingo_especial') ? 'Feriados' : 'Sábados'} (12 meses)</th><th style="padding:3px 6px;font-weight:400;text-align:center;">Pref.</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="font-size:10px;color:var(--text3);margin-top:4px;">
      Contagem dos 12 meses anteriores a esta data, sem contar o próprio dia — é o número que o rodízio usou na hora de escolher. O painel do topo mostra o ano civil, então os dois não precisam bater.
    </div>
  </details>`;
}

function escalaPersonName(id) {
  if (!id) return null;
  const t = EscalaSmartState.teacherMap.get(id);
  return t ? t.name : id;
}

/** { personId: nome } — o histórico precisa de nome, não de id. */
function escalaNomePorId() {
  const out = {};
  EscalaSmartState.teacherMap.forEach((t, id) => { out[id] = t.name || id; });
  return out;
}

/**
 * Ajustar quantos dias uma pessoa tem na janela. Ocupa o lugar do antigo
 * botão de lançar dias fora do sistema na mão — que o Rodrigo leu como
 * "editar este número". Este aqui faz o que ele queria: muda a escala de
 * verdade e rebalanceia os outros (Rodrigo, 28/08/2026).
 *
 * A prévia e o "Aplicar" usam o MESMO objeto `plano` — não há segunda
 * montagem que possa divergir da que a gestão viu (é a garantia que o motor
 * `ScaleRebalance` promete: "devolve PLANO, não efeito").
 */
async function abrirAjusteFrequencia(personId, tipoExplicito) {
  // `tipoExplicito` vem dos cartões da aba Por pessoa, onde `tab` não é
  // 'sabado' nem 'feriado' e o default silencioso ajustaria a fila errada.
  const tipo = tipoExplicito === 'feriado' || tipoExplicito === 'sabado'
    ? tipoExplicito
    : (EscalaSmartState.tab === 'feriado' ? 'feriado' : 'sabado');
  const c = escalaContagens(tipo);
  if (!c.lote.id) { toast('Não há janela para ajustar. Abra uma janela primeiro.', 'error'); return; }
  const atual = c.janela[personId] || 0;
  const nome = escalaPersonName(personId);

  const resp = prompt(
    `AJUSTAR ${tipo === 'feriado' ? 'FERIADOS' : 'SÁBADOS'} NESTA JANELA — ${nome}\n\n`
    + `Hoje: ${atual} nesta janela.\n\n`
    + `Digite quantos ela deve ter. O sistema rebalanceia os outros: se você baixar, `
    + `chama quem tem MENOS dias; se subir, tira de quem tem MAIS.\n\n`
    + `Você vê o que vai acontecer antes de qualquer mudança.`,
    String(atual));
  if (resp === null) return;
  // Campo em branco (só espaços incluído) NÃO pode virar alvo 0 por
  // `Number('') === 0` — 0 é um alvo de verdade ("tira ela de tudo"), e
  // campo vazio não é a mesma coisa que digitar zero. Mesma armadilha que
  // `ScaleRebalance.planejar` documenta e blinda para quem chama direto —
  // aqui a blindagem tem que vir ANTES do `Number(...)`, porque depois dele
  // a distinção já se perdeu.
  if (!String(resp).trim()) { toast('Informe um número igual ou maior que zero.', 'error'); return; }
  const alvo = Number(String(resp).trim().replace(',', '.'));
  if (!Number.isFinite(alvo) || alvo < 0) { toast('Informe um número igual ou maior que zero.', 'error'); return; }

  const datas = (EscalaSmartState.scales || [])
    .filter(s => s.windowBatchId === c.lote.id)
    .map(s => ({ scaleId: s.id, date: s.date, published: !!s.published, slots: (s.slots || []).map(x => Object.assign({}, x)) }));

  const ctx = await escalaMontarCtx();
  const indisponivelPorPessoa = {};
  const bloquear = (pid, date) => {
    if (!pid) return;
    (indisponivelPorPessoa[pid] = indisponivelPorPessoa[pid] || []).push(date);
  };
  (ctx.vacations || []).forEach(v => {
    if (!v || v.status !== 'aprovada' || !v.teacherId) return;
    datas.forEach(dt => {
      if (ScaleService.personsOnVacation([v], dt.date).has(v.teacherId)) bloquear(v.teacherId, dt.date);
    });
  });
  // "Não posso" da própria pessoa entra aqui, junto com férias: no sistema
  // inteiro é restrição DURA, nunca contornável. Vai como indisponibilidade POR
  // DATA (e não um `pref` único por pessoa) porque a resposta é por data — dizer
  // "não posso no dia 12" não pode barrar alguém do dia 26.
  for (const dt of datas) {
    const pr = await ScaleService.listPreferences(dt.scaleId);
    if (!pr.success) {
      // Falhar aqui em silêncio escalaria gente que disse que não podia.
      toast('Não consegui ler as respostas de ' + ScaleService.fmtDataLonga(dt.date) + '. Ajuste cancelado.', 'error');
      return;
    }
    (pr.data || []).forEach(p => { if (p && p.pref === 'nao_posso') bloquear(p.personId, dt.date); });
  }

  const cotas = await ScaleService.listWindowQuotas(c.lote.id);
  const cotaById = cotas.success ? cotas.data : {};

  const candidatos = Array.from(EscalaSmartState.teacherMap.values())
    .filter(t => t.isActive !== false)
    .map(t => ({
      id: t.id, modalityIds: t.modalityIds || [],
      merito: ctx.meritoById[t.id] || 0,
      dias: c.janela[t.id] || 0,
      cota: (cotaById[t.id] === 0 || cotaById[t.id] > 0) ? cotaById[t.id] : null,
      indisponivel: indisponivelPorPessoa[t.id] || [],
    }));

  const plano = ScaleRebalance.planejar({ pessoaId: personId, alvo: Math.round(alvo), datas, candidatos });
  EscalaSmartState._planoAjuste = { plano, personId, de: atual, para: Math.round(alvo) };
  renderPreviaAjuste();
}

// `mv.motivo` vem de `ScaleRebalance.melhor()` — é o critério que decidiu QUEM
// entra/sai. A prévia existe pra responder "por que essa pessoa?" (Rafael,
// 28/08); sem este rótulo o motivo fica só no objeto, nunca chega à gestão.
const ESCALA_MOTIVO_REBALANCEIO_LABEL = Object.assign(Object.create(null), {
  unico: 'único possível', rodizio: 'rodízio (dias)', merito: 'mérito',
  data: 'data mais conveniente', sorteio: 'sorteio',
});
function escalaMotivoRebalanceioLabel(motivo) {
  return escalaEsc(ESCALA_MOTIVO_REBALANCEIO_LABEL[motivo] || motivo || '—');
}

/** Desenha a prévia do plano montado por `abrirAjusteFrequencia` — não grava nada. */
function renderPreviaAjuste() {
  const st = EscalaSmartState._planoAjuste;
  if (!st) return;
  const { plano, personId, de, para } = st;
  const nome = escalaPersonName(personId);
  const nomeUnidade = (uid) => {
    const u = EscalaSmartState.units.find(x => x.id === uid) || {};
    return (u.name || uid || '').replace(/CrossTainer\s*/i, '') || uid;
  };
  const linhas = plano.movimentos.map(mv => `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
      <b>${ScaleService.fmtDataLonga(mv.date)}</b> · ${escalaEsc(nomeUnidade(mv.unitId))}${mv.modalidade ? ` (${escalaEsc(mv.modalidade)})` : ''}
      ${mv.published ? ' <span style="color:#caa23a;">· já publicada</span>' : ''}
      <div style="color:var(--text2);">sai ${escalaEsc(escalaPersonName(mv.saiId))} · entra <b>${escalaEsc(escalaPersonName(mv.entraId))}</b>
        <span style="color:var(--text3);">— por quê: ${escalaMotivoRebalanceioLabel(mv.motivo)}</span></div>
    </div>`).join('');
  const publicadas = plano.movimentos.filter(m => m.published).length;

  const modal = document.getElementById('escalaModal');
  const overlay = document.getElementById('escalaModalOverlay');
  modal.innerHTML = `
    <h2>${escalaEsc(nome)}: ${de} → ${para}</h2>
    <p style="font-size:12px;color:var(--text2);">Nada foi alterado ainda. Confira e confirme.</p>
    ${plano.movimentos.length ? `<div style="max-height:40vh;overflow:auto;margin:10px 0;">${linhas}</div>`
      : `<p style="color:var(--text2);">Nenhuma mudança possível.</p>`}
    ${plano.avisos.length ? `<div style="background:#3a2f1a;border:1px solid #caa23a;border-radius:8px;padding:10px;font-size:12px;margin:10px 0;">
      ${plano.avisos.map(a => escalaEsc(a)).join('<br>')}
    </div>` : ''}
    ${!plano.atingiu ? `<div style="font-size:12px;color:#caa23a;margin-bottom:8px;">Não deu para chegar em ${para}. As mudanças acima continuam valendo se você confirmar.</div>` : ''}
    ${publicadas ? `<div style="background:#3a1a1a;border:1px solid var(--red);border-radius:8px;padding:10px;font-size:12px;margin-bottom:8px;">
      ⚠️ ${publicadas} data(s) já publicada(s) serão mexidas. A agenda é refeita e <b>quem sai, quem entra e a gestão são avisados</b>.
    </div>` : ''}
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      ${plano.movimentos.length ? `<button class="btn-primary" onclick="aplicarAjusteFrequencia()">Aplicar estas mudanças</button>` : ''}
    </div>`;
  modal.style.display = 'block';
  if (overlay) overlay.style.display = 'flex';
}

/**
 * Aplica o MESMO `plano` que `renderPreviaAjuste` desenhou (lido de
 * `EscalaSmartState._planoAjuste`, montado uma única vez em
 * `abrirAjusteFrequencia`) — nunca remonta. Avisa quem saiu, quem entrou e,
 * sempre que algo foi de fato aplicado, a gestão.
 */
async function aplicarAjusteFrequencia() {
  const st = EscalaSmartState._planoAjuste;
  if (!st) return;
  const { plano, personId, de, para } = st;
  toast('Aplicando…', 'info');
  const nomePorId = escalaNomePorId();
  const res = await ScaleService.aplicarRebalanceamento(
    { pessoaId: personId, movimentos: plano.movimentos, nomePorId, de, para },
    { nomePorId });

  const avisar = (res.data && res.data.avisar) || [];
  const uid = (pid) => (EscalaSmartState.teacherMap.get(pid) || {}).userId || null;
  const nomeUnidade = (u) => { const x = EscalaSmartState.units.find(y => y.id === u) || {}; return (x.name || u || '').replace(/CrossTainer\s*/i, '') || u; };
  let avisados = 0;
  for (const mv of avisar) {
    const onde = `${ScaleService.fmtDataLonga(mv.date)} · ${nomeUnidade(mv.unitId)}${mv.modalidade ? ` (${mv.modalidade})` : ''}`;
    if (uid(mv.saiId)) {
      await NotifyService.send({ recipients: [uid(mv.saiId)], type: 'scale_confirmed',
        title: 'Você saiu de um dia da escala',
        body: `A gestão ajustou a distribuição: você não trabalha mais em ${onde}. Sua agenda já está atualizada.`,
        link: { type: 'escala-smart', id: mv.scaleId }, channels: ['inapp'] });
      avisados++;
    }
    if (uid(mv.entraId)) {
      await NotifyService.send({ recipients: [uid(mv.entraId)], type: 'scale_confirmed',
        title: 'Você entrou em um dia da escala',
        body: `A gestão ajustou a distribuição: você trabalha em ${onde}. Já está na sua agenda.`,
        link: { type: 'escala-smart', id: mv.scaleId }, channels: ['inapp'] });
      avisados++;
    }
  }
  // A gestão é avisada sempre que houve mudança — publicada ou não. Se o
  // resolvedor falhar (`success:false`), NÃO é silêncio: a falha aparece no
  // toast, porque `resolveManagementUserIds` devolve `data:[]` tanto quando
  // não há gestão cadastrada quanto quando a consulta explodiu — só o
  // `success` diferencia os dois casos.
  const ges = await NotifyService.resolveManagementUserIds();
  let gestaoAvisoFalhou = false;
  if (!ges.success) {
    gestaoAvisoFalhou = true;
    console.error('[aplicarAjusteFrequencia] não deu para descobrir quem é a gestão — ninguém foi avisado', ges.error);
  } else if (ges.data.length && (res.data && res.data.aplicados)) {
    await NotifyService.send({ recipients: ges.data, type: 'scale_confirmed',
      title: 'Escala ajustada',
      body: `${escalaPersonName(personId)}: ${de} → ${para}. ${res.data.aplicados} troca(s)`
          + (avisar.length ? `, ${avisar.length} em data já publicada.` : '.'),
      link: { type: 'escala-smart', id: null }, channels: ['inapp'] });
  }

  if (!res.success) toast(`Aplicado em parte — falhou: ${res.error}`, 'error', 12000);
  else if (gestaoAvisoFalhou) toast(`${res.data.aplicados} troca(s) aplicada(s), mas não deu para avisar a gestão — confira na tela.`, 'error', 12000);
  else toast(`${res.data.aplicados} troca(s) aplicada(s)${avisados ? `, ${avisados} aviso(s) enviado(s)` : ''}.`, 'success', 7000);

  EscalaSmartState._planoAjuste = null;
  closeEscalaModal();
  await escalaLoadBase();
  renderEscalaGestao();
}

// `Object.create(null)` de propósito: `h.acao` vem do banco, e uma ação chamada
// `constructor` ou `toString` acharia a função herdada de `Object.prototype` e
// despejaria "function () { [native code] }" na tela da gestão.
const ESCALA_ACAO_LABEL = Object.assign(Object.create(null), {
  janela_aberta: '📨 Janela aberta', consolidada: '🧮 Montada', refeita: '🔄 Refeita',
  publicada: '📅 Publicada', despublicada: '↩️ Despublicada', invertida: '⇄ Invertida',
  vaga_trocada: '✋ Vaga trocada', rebalanceada: '⚖ Rebalanceada', tirada_do_lote: '🚫 Tirada do lote',
});

/**
 * Rótulo da ação, sempre seguro pra HTML. O fallback `|| acao` NÃO é hipótese
 * remota: `rebalanceada` e `tirada_do_lote` só passam a ser gravadas nas Tasks
 * 14 e 19, e qualquer ação nova cai aqui. Sem o escape, o valor do banco entra
 * cru dentro do `<b>`.
 */
function escalaHistoricoAcaoLabel(acao) {
  return escalaEsc(ESCALA_ACAO_LABEL[acao] || acao);
}

/**
 * ISO em UTC → data e hora de quem está lendo. O `ts` do histórico é
 * `new Date().toISOString()`, sempre UTC: mostrar cru deixaria a hora 3h
 * adiantada aqui, e o histórico existe justamente pra dizer QUANDO.
 */
function escalaHistoricoQuando(ts) {
  const d = new Date(ts);
  if (!ts || isNaN(d.getTime())) return String(ts || '—');
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function escalaHistoricoLinha(h) {
  const quando = escalaHistoricoQuando(h.ts);
  return `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);">
    <span style="color:var(--text3);">${escalaEsc(quando)}</span>
    · <b>${escalaHistoricoAcaoLabel(h.acao)}</b>
    · ${escalaEsc(h.nome || h.uid || '—')}
    ${h.detalhe ? `<div style="color:var(--text2);margin-left:2px;">${escalaEsc(h.detalhe)}</div>` : ''}
  </div>`;
}

/** 🕐 Histórico desta escala — responde "alguém mexeu?" em 5 segundos. */
function escalaHistoricoDaEscalaHtml(scale) {
  const h = ((scale && scale.historico) || []).slice().reverse();
  if (!h.length) return '';
  return `<details style="margin-top:12px;">
    <summary style="cursor:pointer;font-size:12px;color:var(--blue);">🕐 Histórico desta escala (${h.length})</summary>
    <div style="margin-top:6px;">${h.map(escalaHistoricoLinha).join('')}</div>
  </details>`;
}

/**
 * 📜 Últimas alterações carregadas nesta tela — junta o histórico de tudo que
 * está em memória (aba/ano corrente). NÃO é "do módulo inteiro": uma
 * alteração de outra aba ou ano não aparece aqui.
 */
function escalaHistoricoGeralHtml() {
  const todas = [];
  (EscalaSmartState.scales || []).forEach(s => {
    (s.historico || []).forEach(h => todas.push(Object.assign({}, h, { data: s.date, nomeEscala: s.name || s.date })));
  });
  if (!todas.length) return '';
  todas.sort((a, b) => (a.ts > b.ts ? -1 : 1));
  const linhas = todas.slice(0, 50).map(h => `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);">
      <span style="color:var(--text3);">${escalaEsc(escalaHistoricoQuando(h.ts))}</span>
      · <b>${escalaHistoricoAcaoLabel(h.acao)}</b>
      · ${escalaEsc(h.nome || h.uid || '—')}
      · <span style="color:var(--text2);">${escalaEsc(h.nomeEscala)}</span>
      ${h.detalhe ? `<div style="color:var(--text2);">${escalaEsc(h.detalhe)}</div>` : ''}
    </div>`).join('');
  // "do módulo" prometia mais do que entrega: só o que está carregado na tela
  // agora (aba/ano corrente) — uma alteração de outra aba ou ano não aparece
  // aqui, mesmo sendo "do módulo". Rótulo honesto ao escopo real.
  return `<details style="margin-top:20px;">
    <summary style="cursor:pointer;font-size:13px;color:var(--blue);">📜 Últimas alterações carregadas nesta tela (${Math.min(todas.length, 50)})</summary>
    <div style="margin-top:6px;">${linhas}</div>
  </details>`;
}

/**
 * Horário da escala, tirado das vagas. "Também não fala o horário" (Rafael,
 * 12/08/2026): a lista dizia só a data, e quem olhava não sabia se o sábado era
 * de manhã ou à tarde. Quando as vagas têm horários diferentes, mostra do
 * primeiro começo ao último fim em vez de esconder a diferença.
 */
function escalaHorario(scale) {
  const slots = (scale && scale.slots) || [];
  const inicios = slots.map(s => s.startTime).filter(Boolean).sort();
  const fins    = slots.map(s => s.endTime).filter(Boolean).sort();
  if (!inicios.length || !fins.length) return '';
  return `${inicios[0]}–${fins[fins.length - 1]}`;
}

/**
 * "✅ Publicar as 8 datas de sábado na agenda e avisar".
 *
 * O botão dizia só "Publicar na agenda e avisar" e o Rodrigo não achou
 * (28/08/2026). Dizer o número e o tipo é o que faz ele ser reconhecido como
 * "o botão que falta apertar".
 */
function escalaRotuloPublicar(scales) {
  const n = (scales || []).length;
  const tipo = (scales && scales[0] && scales[0].tipo) || 'sabado';
  const rot = { sabado: 'sábado', feriado: 'feriado', domingo_especial: 'domingo especial', fim_de_ano: 'fim de ano' }[tipo] || 'escala';
  return n === 1
    ? `✅ Publicar 1 data de ${rot} na agenda e avisar`
    : `✅ Publicar as ${n} datas de ${rot} na agenda e avisar`;
}

/* ─── GESTÃO ───────────────────────────────────────────────────────── */
function escalaCardDoc(s) {
  const sel = s.id === EscalaSmartState.selectedId;
  // "Rascunho · ✓ publicada" lia como contradição. Publicada na agenda é o que
  // importa pra quem olha, então ela manda sozinha; o status do fluxo (rascunho/
  // janela aberta/consolidada) só aparece enquanto NÃO está publicada.
  const publicada = !!s.published;
  const statusColor = publicada ? 'var(--green)'
    : (s.status === 'consolidada' ? 'var(--green)' : (s.status === 'janela_aberta' ? 'var(--blue)' : 'var(--text2)'));
  // Evento não passa por janela/consolidação/publicação — ele funciona por lista de
  // staff + convite + RSVP. Mostrar "Rascunho" aqui é herança do fluxo de sábado/
  // feriado e só assusta (Rodrigo, 12/08: "ficou como rascunho, o que tem que fazer?").
  const statusTxt = s.tipo === 'evento' ? ''
    : (publicada ? '✓ Publicada' : (ESCALA_STATUS_LABEL[s.status] || s.status));
  const kindBadge = (s.tipo === 'evento' && s.eventKind)
    ? `<span style="font-size:11px;padding:2px 8px;border-radius:6px;background:${s.eventKind === 'externo' ? '#2a1a2e' : 'var(--surface3)'};color:${s.eventKind === 'externo' ? '#c77dff' : 'var(--text2)'};margin-left:6px;">${s.eventKind === 'externo' ? 'Externo' : 'Interno'}</span>` : '';
  return `<div onclick="selectEscala('${s.id}')" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;background:${sel ? 'var(--surface2)' : 'var(--surface)'};border:1px solid ${sel ? 'var(--blue)' : 'var(--border)'};border-radius:10px;padding:10px 12px;margin-bottom:6px;">
    <div><div style="font-weight:600;font-size:14px;">${s.name || ScaleService.fmtDataLonga(s.date)}${kindBadge}</div><div style="font-size:12px;color:var(--text2);">${ScaleService.fmtDataLonga(s.date)}${escalaHorario(s) ? ` · 🕗 ${escalaHorario(s)}` : ''}</div></div>
    <span style="font-size:12px;font-weight:600;color:${statusColor};">${statusTxt}</span>
  </div>`;
}

/**
 * ⚙️ Configurações da escala — hoje só o marco zero.
 *
 * `scale_config` é `write: isAdmin()` nas Security Rules, então o bloco só
 * aparece pra Admin: mostrar um campo que a Supervisão não consegue gravar
 * seria prometer o que a regra nega.
 */
function renderConfigEscalaHtml() {
  if (!(typeof isAdminGestao === 'function' && isAdminGestao())) return '';
  const marco = (EscalaSmartState.config || {}).marcoZero || '';
  return `<details style="margin-bottom:12px;">
    <summary style="cursor:pointer;font-size:13px;color:var(--blue);">⚙️ Configurações da escala</summary>
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px;margin-top:8px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px;">A contagem de justiça começa em</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:8px;">
        Tudo antes desta data não conta — nem na tela, nem na hora de montar a escala.
        Use na virada do ano para zerar o rodízio (ex.: 01/01/2027).
        Sem data, vale só o padrão: os últimos 12 meses.
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="date" class="input" id="escalaMarcoZero" style="max-width:190px;" value="${marco}">
        <button class="btn-primary" onclick="salvarMarcoZero()">Salvar</button>
        ${marco ? `<button class="btn-secondary" onclick="salvarMarcoZero(true)">Voltar aos 12 meses</button>` : ''}
      </div>
    </div>
  </details>`;
}

async function salvarMarcoZero(limpar) {
  const el = document.getElementById('escalaMarcoZero');
  const antes = (EscalaSmartState.config || {}).marcoZero || null;
  const novo = limpar ? null : ((el && el.value) || null);
  if (novo && !/^\d{4}-\d{2}-\d{2}$/.test(novo)) { toast('Data inválida.', 'error'); return; }
  if (novo === antes) { toast('Nada mudou.', 'info'); return; }
  if (!confirm(`${novo ? `A contagem passa a começar em ${escalaFmtBR(novo)}.` : 'Sem data, a contagem volta a valer só os últimos 12 meses (o padrão).'}\n\n`
             + `Isso muda o número que o rodízio usa para decidir quem trabalha. `
             + `Nenhuma escala já montada é alterada agora.\n\nContinuar?`)) return;
  const res = await ScaleService.ScaleConfigService.save({ marcoZero: novo });
  if (!res || res.success === false) { toast('Erro ao salvar: ' + ((res && res.error) || 'falha'), 'error'); return; }
  if (typeof AuditService === 'object') {
    await AuditService.log({
      type: 'scale_marco_zero', module: 'agenda',
      details: `Marco zero da contagem: ${antes || '—'} → ${novo || '—'}`,
      entityType: 'scale_config', entityId: 'default',
      before: { marcoZero: antes }, after: { marcoZero: novo },
    });
  }
  toast('Marco zero salvo.', 'success');
  await escalaLoadBase();
  renderEscalaGestao();
}

async function renderEscalaGestao() {
  const container = document.getElementById('page-escala-smart');
  if (!container) return;
  container.innerHTML = `
    <div class="page-hdr"><h1>🗓️ Escala Inteligente${ajudaBtn("escala-smart")}</h1><p>Sábados/feriados: o sistema sugere por justiça + mérito; você ajusta e publica.</p></div>
    <div class="loading"><div class="spinner"></div> Carregando escalas…</div>`;

  await escalaLoadBase();
  // A aba Sábados também precisa dos feriados: sábado que é feriado paga em
  // dobro, e a gestão tem que ver isso ANTES de montar a escala.
  if (EscalaSmartState.tab === 'feriado' || EscalaSmartState.tab === 'sabado') {
    await escalaLoadFeriados(EscalaSmartState.year);
  }

  // Se o evento selecionado está aberto, carrega os RSVP dele p/ o painel de staff/consolidado.
  EscalaSmartState.eventoRsvp = null;
  if (EscalaSmartState.selectedId) {
    const sel = EscalaSmartState.scales.find(s => s.id === EscalaSmartState.selectedId);
    if (sel && sel.tipo === 'evento') {
      const rr = await ScaleService.listEventRsvp(sel.id);
      EscalaSmartState.eventoRsvp = new Map((rr.success ? rr.data : []).map(r => [r.personId, r]));
    }
  }

  const scales = EscalaSmartState.scales;
  const tab = EscalaSmartState.tab;
  const tabsHtml = `<div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:12px;">` +
    ESCALA_TABS.map(t => {
      const on = t.id === tab;
      return `<button onclick="escalaSetTab('${t.id}')" style="background:none;border:none;border-bottom:2px solid ${on ? 'var(--blue)' : 'transparent'};color:${on ? 'var(--text)' : 'var(--text2)'};font-weight:${on ? '600' : '400'};font-size:14px;padding:8px 14px;cursor:pointer;">${t.label}</button>`;
    }).join('') + `</div>`;

  const y = EscalaSmartState.year;
  const yearSel = tab === 'fim_de_ano' ? '' :
    `<select class="input" style="width:auto;" onchange="escalaSetYear(this.value)">${[y - 1, y, y + 1].map(v => `<option value="${v}" ${v === y ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  const tfSel = tab === 'fim_de_ano' ? '' :
    `<div style="display:inline-flex;gap:4px;margin-right:8px;">
      ${['futuros', 'todos', 'passados'].map(v => `<button onclick="escalaSetTimeframe('${v}')" style="font-size:12px;padding:6px 10px;border-radius:8px;cursor:pointer;border:1px solid ${EscalaSmartState.timeframe === v ? 'var(--blue)' : 'var(--border)'};background:${EscalaSmartState.timeframe === v ? 'rgba(94,168,255,0.15)' : 'transparent'};color:${EscalaSmartState.timeframe === v ? '#5EA8FF' : 'var(--text2)'};">${v === 'futuros' ? 'Próximos' : v === 'passados' ? 'Passados' : 'Todos'}</button>`).join('')}
    </div>`;

  let listHtml;
  if (tab === 'sabado')                listHtml = renderTabSabados(scales);
  else if (tab === 'feriado')          listHtml = renderTabFeriados(scales);
  else if (tab === 'evento')           listHtml = renderTabEventos(scales);
  else if (tab === 'escola_interna')   listHtml = renderTabEscolaInterna(scales);
  else if (tab === 'pessoa')           listHtml = renderTabPorPessoa();
  else                                 listHtml = renderTabFimDeAno(scales);

  const detail = EscalaSmartState.selectedId ? renderEscalaDetail(scales.find(s => s.id === EscalaSmartState.selectedId)) : '';

  const batchesAbertos = [...new Set(scales.filter(s => s.status === 'janela_aberta' && s.windowBatchId).map(s => s.windowBatchId))];
  const revisaoBar = batchesAbertos.length
    ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:#1a2a3a;border:1px solid var(--blue);border-radius:10px;padding:10px 12px;margin-bottom:10px;">
        <span style="font-size:13px;color:var(--blue);">Há ${batchesAbertos.length} janela(s) em andamento. Feche e revise antes de confirmar.</span>
        <button class="btn-primary" onclick="abrirRevisaoLote('${batchesAbertos[0]}')">🧮 Revisar fechamento</button>
      </div>` : '';

  // Lotes já montados (nenhuma data em janela aberta) podem ser refeitos.
  // Lotes já montados (nenhuma data em janela aberta) que ainda podem ser
  // refeitos. UM POR LINHA, e só os da aba atual: com um botão só, apontando
  // pro primeiro da lista, o lote de feriados nunca seria alcançável — e
  // refazer os feriados de 07/09 e 12/10 está no escopo desta frente.
  const tiposDaAba = (tab === 'sabado' || tab === 'feriado') ? ScaleService.tiposIrmaos(tab) : null;
  const lotesMontados = tiposDaAba
    ? [...new Set(scales
        .filter(s => s.windowBatchId && s.status === 'consolidada'
          && s.date > escalaTodayISO() && tiposDaAba.indexOf(s.tipo) !== -1)
        .map(s => s.windowBatchId))]
        .filter(b => !scales.some(s => s.windowBatchId === b && s.status === 'janela_aberta'))
    : [];
  const refazerBar = lotesMontados.map(b => {
    const doLote = scales.filter(s => s.windowBatchId === b);
    const datas = doLote.map(s => s.date).sort();
    const periodo = datas.length === 1 ? ScaleService.fmtDataLonga(datas[0])
      : `${escalaFmtBR(datas[0])} a ${escalaFmtBR(datas[datas.length - 1])}`;
    const pub = doLote.filter(s => s.published).length;
    const faltaPublicar = doLote.length - pub;
    // O botão de publicar mora AQUI e não só no rodapé da prévia: com a prévia
    // fechada, o lote montado ficava sem nenhuma pista de que faltava publicar.
    const btnPublicar = faltaPublicar
      ? `<button class="btn-primary" onclick="confirmarEAvisar('${b}')">${escalaRotuloPublicar(doLote)}</button>`
      : '';
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:${faltaPublicar ? '#3a2f1a' : 'var(--surface2)'};border:1px solid ${faltaPublicar ? '#caa23a' : 'var(--border)'};border-radius:10px;padding:10px 12px;margin-bottom:10px;">
        <span style="font-size:13px;color:var(--text2);">Escala montada para ${doLote.length} data(s): <b>${periodo}</b>${pub ? ` · ${pub} já publicada(s)` : ''}${faltaPublicar ? ` · <b style="color:#caa23a;">ainda não publicada</b>` : ''}</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">${btnPublicar}
          <button class="btn-secondary" onclick="refazerJanela('${b}')">🔄 Refazer</button></div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="page-hdr"><h1>🗓️ Escala Inteligente${ajudaBtn("escala-smart")}</h1><p>Sábados/feriados: o sistema sugere por justiça + mérito; você ajusta e publica.</p></div>
    ${renderConfigEscalaHtml()}
    ${tab === 'pessoa' ? '' : renderEquilibrioPainel()}
    ${tabsHtml}
    ${revisaoBar}${refazerBar}
    <div style="display:flex;align-items:center;justify-content:flex-end;margin-bottom:10px;">${tfSel}${yearSel}</div>
    ${EscalaSmartState.selected.size ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface2);border:1px solid var(--blue);border-radius:10px;padding:10px 12px;margin-bottom:10px;">
      <span style="font-size:13px;">${EscalaSmartState.selected.size} data(s) selecionada(s)</span>
      <div style="display:flex;gap:8px;"><button class="btn-secondary" onclick="escalaLimparSel()">Limpar</button><button class="btn-primary" onclick="openAbrirLote()">📨 Abrir janela nas selecionadas</button></div>
    </div>` : ''}
    <div style="display:grid;grid-template-columns:${tab === 'pessoa' ? '1fr' : 'minmax(220px,1fr) 2fr'};gap:16px;align-items:start;">
      <div>${listHtml}</div>
      ${tab === 'pessoa' ? '' : `<div>${detail || '<p style="padding:20px;color:var(--text2);">Selecione uma escala à esquerda.</p>'}</div>`}
    </div>
    ${escalaHistoricoGeralHtml()}
    <div id="escalaModalOverlay" class="modal-overlay" style="display:none;"></div>
    <div id="escalaModal" class="modal" style="display:none;"></div>`;

  escalaConsumirPendingNew(); // atalho vindo da Confirmar Presença
}

/* ─── Abas (listas por tipo) ───────────────────────────────────────── */
// Trocar de pessoa ZERA o filtro de janela: o lote é de quem estava selecionado
// antes. Mantido, ele faria a tela dizer "Nenhuma escala em 2026 para esta
// pessoa" pra quem TEM escala — e o select cairia sozinho pra "Todas as
// janelas", então a tela mentiria duas vezes de uma vez.
function escalaSetPessoa(pid) { EscalaSmartState.pessoaSel = pid || null; EscalaSmartState.pessoaJanela = 'todas'; renderEscalaGestao(); }

/**
 * "Onde e quando fulano está escalado" — pedido 1 do Rodrigo (25/08/2026):
 * "Deveria existir um filtro escolhendo qual professor / estagiário e mostrando
 * aonde e qdo ele(a) está escalado".
 *
 * Junta as três perguntas numa tela só: as datas da pessoa, quanto ela pegou
 * nesta janela e quanto pegou no ano (pedido 8: "quando for aberta a próxima
 * janela, trazer o histórico da quantidade das últimas escalas no ano").
 */
function renderTabPorPessoa() {
  const ativos = Array.from(EscalaSmartState.teacherMap.values())
    .filter(t => t.isActive !== false)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const sel = EscalaSmartState.pessoaSel;
  const seletor = `<select class="input" style="max-width:320px;" onchange="escalaSetPessoa(this.value)">
      <option value="">— escolha a pessoa —</option>
      ${ativos.map(t => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${escalaEsc(t.name)}</option>`).join('')}
    </select>`;

  if (!sel) {
    return `<div style="margin-bottom:12px;">${seletor}</div>
      ${escalaHistoricoAnoHtml()}`;
  }

  const ano = String(EscalaSmartState.year);
  const nomeUnidade = (uid) => {
    const u = EscalaSmartState.units.find(x => x.id === uid) || {};
    return (u.name || uid || '').replace(/CrossTainer\s*/i, '') || uid;
  };
  const nomeMod = (mid) => mid === (EscalaSmartState.modToi || {}).id ? 'TOI'
    : mid === (EscalaSmartState.modHiit || {}).id ? 'Hiit' : '—';
  const rotuloTipo = { sabado: 'Sábado', feriado: 'Feriado', domingo_especial: 'Domingo especial', evento: 'Evento', fim_de_ano: 'Fim de ano', escola_interna: 'Escola Interna' };

  const linhas = [];
  // Pedido 7a do Rodrigo: dizer de qual janela é cada data. 02/11 e 20/11
  // (Task 14) foram consolidadas fora de qualquer janela — daí o "⚠️ fora de
  // janela" e o filtro pra achar essas datas de novo.
  const filtro = EscalaSmartState.pessoaJanela || 'todas';
  const lotesDaPessoa = new Set();

  const brutas = [];
  (EscalaSmartState.scales || [])
    .filter(s => String(s.date || '').slice(0, 4) === ano)
    .sort((a, b) => (a.date > b.date ? 1 : -1))
    .forEach(s => {
      (s.slots || []).forEach(sl => {
        if (sl.assignedPersonId !== sel) return;
        if (s.windowBatchId) lotesDaPessoa.add(s.windowBatchId);
        brutas.push({ s, sl });
      });
    });

  brutas
    .filter(({ s }) => filtro === 'todas'
      || (filtro === 'fora' && !s.windowBatchId)
      || filtro === s.windowBatchId)
    .forEach(({ s, sl }) => {
      // Data consolidada fora de qualquer janela é o defeito que gerou o pedido:
      // 02/11 e 20/11 tinham gente escalada num lote que ninguém abriu.
      const janela = s.windowBatchId
        ? escalaEsc(escalaRotuloJanela(s.windowBatchId))
        : `<span style="color:#caa23a;">⚠️ fora de janela</span>`;
      linhas.push(`<tr>
        <td style="padding:4px 8px;">${escalaFmtBR(s.date)}</td>
        <td style="padding:4px 8px;">${rotuloTipo[s.tipo] || s.tipo}</td>
        <td style="padding:4px 8px;">${janela}</td>
        <td style="padding:4px 8px;">${escalaEsc(nomeUnidade(sl.unitId))}</td>
        <td style="padding:4px 8px;">${nomeMod(sl.requiredModalityId)}</td>
        <td style="padding:4px 8px;">${sl.startTime ? `${sl.startTime}–${sl.endTime || ''}` : '—'}</td>
        <td style="padding:4px 8px;color:${s.published ? 'var(--green)' : 'var(--text3)'};">${s.published ? '✓ publicada' : 'não publicada'}</td>
      </tr>`);
    });

  const filtroHtml = `<select class="input" style="max-width:260px;margin-left:8px;" onchange="escalaSetPessoaJanela(this.value)">
      <option value="todas" ${filtro === 'todas' ? 'selected' : ''}>Todas as janelas</option>
      ${[...lotesDaPessoa].map(b => `<option value="${b}" ${filtro === b ? 'selected' : ''}>${escalaEsc(escalaRotuloJanela(b))}</option>`).join('')}
      <option value="fora" ${filtro === 'fora' ? 'selected' : ''}>⚠️ Fora de janela</option>
    </select>`;

  const cSab = escalaContagens('sabado');
  const cFer = escalaContagens('feriado');
  // Um botão POR cartão, com o tipo explícito. Um botão só entre os dois
  // cartões era ambíguo — e pior: nesta aba `EscalaSmartState.tab` não vale
  // 'sabado' nem 'feriado', então ele caía sempre no default e ajustava
  // sábados mesmo quando a gestão estava olhando o cartão de feriados.
  const cartao = (rot, jan, an, tipo) => `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;flex:1;min-width:150px;">
      <div style="font-size:11px;color:var(--text3);text-transform:uppercase;">${rot}</div>
      <div style="font-size:20px;font-weight:600;">${jan}</div>
      <div style="font-size:12px;color:var(--text2);">${an} no ano de ${ano}</div>
      <button class="btn-secondary" style="margin-top:8px;font-size:12px;" onclick="abrirAjusteFrequencia('${sel}', '${tipo}')">Ajustar</button>
    </div>`;

  return `<div style="margin-bottom:12px;">${seletor}${filtroHtml}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
      ${cartao('Sábados nesta janela', cSab.janela[sel] || 0, cSab.ano[sel] || 0, 'sabado')}
      ${cartao('Feriados nesta janela', cFer.janela[sel] || 0, cFer.ano[sel] || 0, 'feriado')}
    </div>
    ${escalaNotaMarcoHtml(cSab)}
    ${linhas.length
      ? `<table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="color:var(--text2);text-align:left;">
            <th style="padding:4px 8px;font-weight:400;">Data</th>
            <th style="padding:4px 8px;font-weight:400;">Tipo</th>
            <th style="padding:4px 8px;font-weight:400;">Janela</th>
            <th style="padding:4px 8px;font-weight:400;">Unidade</th>
            <th style="padding:4px 8px;font-weight:400;">Modalidade</th>
            <th style="padding:4px 8px;font-weight:400;">Horário</th>
            <th style="padding:4px 8px;font-weight:400;">Situação</th>
          </tr></thead><tbody>${linhas.join('')}</tbody></table>`
      : `<p style="padding:20px;color:var(--text2);">Nenhuma escala em ${ano} para esta pessoa.</p>`}
    ${escalaHistoricoAnoHtml()}`;
}

/**
 * Histórico do ano por pessoa — sábados e feriados separados.
 * Pedido 8 do Rodrigo: aparece aqui e também no modal de abrir janela, que é
 * quando a gestão precisa dele pra decidir.
 */
function escalaHistoricoAnoHtml() {
  const ano = String(EscalaSmartState.year);
  const cSab = escalaContagens('sabado');
  const cFer = escalaContagens('feriado');
  const ativos = Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false);
  const linhas = ativos
    .map(t => ({ t, sab: cSab.ano[t.id] || 0, fer: cFer.ano[t.id] || 0 }))
    .filter(x => x.sab || x.fer)
    .sort((a, b) => (b.sab + b.fer) - (a.sab + a.fer))
    .map(x => `<tr>
      <td style="padding:3px 8px;">${escalaEsc(x.t.name)}</td>
      <td style="padding:3px 8px;text-align:center;">${x.sab}</td>
      <td style="padding:3px 8px;text-align:center;">${x.fer}</td>
    </tr>`).join('');
  if (!linhas) return '';
  return `<details style="margin-top:16px;">
    <summary style="cursor:pointer;font-size:13px;color:var(--blue);">📊 Histórico de ${ano} — quantas vezes cada um</summary>
    ${escalaNotaMarcoHtml(cSab)}
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;">
      <thead><tr style="color:var(--text2);text-align:left;">
        <th style="padding:3px 8px;font-weight:400;">Pessoa</th>
        <th style="padding:3px 8px;font-weight:400;text-align:center;">Sábados</th>
        <th style="padding:3px 8px;font-weight:400;text-align:center;">Feriados</th>
      </tr></thead><tbody>${linhas}</tbody></table>
  </details>`;
}

function renderTabFimDeAno(scales) {
  const docs = scales.filter(s => s.tipo === 'fim_de_ano');
  const topo = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
    <span style="font-size:12px;color:var(--text2);">Período de horário reduzido, por turnos — a gestão define as datas.</span>
    <button class="btn-primary" onclick="openNovaEscalaFimDeAno()">+ Configurar período</button></div>`;
  const body = docs.length ? docs.map(escalaCardDoc).join('')
    : `<p style="padding:20px;color:var(--text2);">Nenhum período de fim de ano configurado.</p>`;
  return topo + body;
}

function renderTabEventos(scales) {
  let docs = scales.filter(s => s.tipo === 'evento' && s.date.startsWith(String(EscalaSmartState.year)));
  docs = ScaleService.filterByTimeframe(docs, escalaTodayISO(), EscalaSmartState.timeframe);
  const topo = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
    <span style="font-size:12px;color:var(--text2);">Quem trabalha/representa no evento. Presença/ponto continua na Chamada do Engajamento.</span>
    <button class="btn-primary" onclick="openNovoEvento()">+ Novo evento</button></div>`;
  const body = docs.length ? docs.map(escalaCardDoc).join('')
    : `<p style="padding:20px;color:var(--text2);">Nenhum evento em ${EscalaSmartState.year}. Crie o primeiro.</p>`;
  return topo + body;
}

function renderTabEscolaInterna(scales) {
  const docs = scales.filter(s => s.tipo === 'escola_interna' && s.date.startsWith(String(EscalaSmartState.year)));
  const docsF = ScaleService.filterByTimeframe(docs, escalaTodayISO(), EscalaSmartState.timeframe);
  const topo = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
    <span style="font-size:12px;color:var(--text2);">A gestão escolhe quem lidera cada dia (por necessidade técnica). Quem lidera ganha os pontos de liderança.</span>
    <button class="btn-primary" onclick="openNovaEscolaInterna()">+ Nova sessão</button></div>`;
  const body = docsF.length ? docsF.map(escalaCardDoc).join('')
    : `<p style="padding:20px;color:var(--text2);">Nenhuma sessão de Escola Interna em ${EscalaSmartState.year}.</p>`;
  return topo + body;
}

function openNovaEscolaInterna(dateISO) {
  const overlay = document.getElementById('escalaModalOverlay'), modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex'; modal.style.display = 'block';
  // Padrão PP: é onde a Escola Interna acontece na prática (Rafael, 04/08).
  // A CP fica disponível porque "vez ou outra pode acontecer lá".
  const pp = EscalaSmartState.units.find(u => /pp$/i.test(u.id)) || EscalaSmartState.units[0];
  modal.innerHTML = `
    <h2>Nova sessão de Escola Interna</h2>
    <div class="form-group"><label>Unidade <span style="color:var(--red);">*</span></label>
      <select id="eiUnidade" class="input">
        ${EscalaSmartState.units.map(u => `<option value="${u.id}" ${pp && u.id === pp.id ? 'selected' : ''}>${u.name || u.id}</option>`).join('')}
      </select>
      <div style="font-size:11px;color:var(--text3);margin-top:4px;">A sessão acontece em uma unidade por dia.</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div class="form-group"><label>Início</label><input type="time" id="eiIni" class="input" value="14:30"></div>
      <div class="form-group"><label>Fim</label><input type="time" id="eiFim" class="input" value="15:30"></div>
    </div>
    <div class="form-group"><label>Criar</label>
      <div style="padding:4px 0;">
        <label style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;font-size:13px;cursor:pointer;">
          <input type="radio" name="eiModo" value="dia" checked onchange="toggleEscolaInternaModo()"> Um dia só
        </label>
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">
          <input type="radio" name="eiModo" value="semana" onchange="toggleEscolaInternaModo()"> A semana inteira (seg a sex)
        </label>
      </div>
    </div>
    <div class="form-group" id="eiBoxDia"><label>Data <span style="color:var(--red);">*</span></label>
      <input type="date" id="eiData" class="input" value="${dateISO || escalaTodayISO()}"></div>
    <div class="form-group" id="eiBoxSemana" style="display:none;"><label>Segunda-feira da semana <span style="color:var(--red);">*</span></label>
      <input type="date" id="eiSemana" class="input" value="${proximaSegundaISO()}">
      <div style="font-size:11px;color:var(--text3);margin-top:4px;">Cria as 5 sessões de uma vez. Os líderes você escolhe depois, em cada dia.</div></div>
    <div class="error-msg" id="eiErro" style="margin-top:8px;"></div>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      <button class="btn-primary" id="eiCriarBtn" onclick="criarEscolaInterna()">Criar</button>
    </div>`;
}

/** Segunda-feira da próxima semana — a escala é montada na semana anterior. */
function proximaSegundaISO() {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function toggleEscolaInternaModo() {
  const semana = document.querySelector('input[name="eiModo"]:checked').value === 'semana';
  document.getElementById('eiBoxDia').style.display = semana ? 'none' : '';
  document.getElementById('eiBoxSemana').style.display = semana ? '' : 'none';
}

async function criarEscolaInterna() {
  const errEl = document.getElementById('eiErro');
  errEl.textContent = '';
  const unitId = document.getElementById('eiUnidade').value;
  const startTime = document.getElementById('eiIni').value;
  const endTime = document.getElementById('eiFim').value;
  const semana = document.querySelector('input[name="eiModo"]:checked').value === 'semana';

  if (!unitId) { errEl.textContent = 'Escolha a unidade.'; return; }
  if (!startTime || !endTime) { errEl.textContent = 'Informe início e fim.'; return; }
  if (endTime <= startTime) { errEl.textContent = 'O fim tem que ser depois do início.'; return; }

  // Datas a criar: um dia, ou a semana seg–sex a partir da segunda informada
  let datas = [];
  if (semana) {
    const base = document.getElementById('eiSemana').value;
    if (!base) { errEl.textContent = 'Informe a segunda-feira da semana.'; return; }
    const d0 = new Date(base + 'T12:00:00');
    for (let i = 0; i < 5; i++) {
      const d = new Date(d0); d.setDate(d0.getDate() + i);
      const p = n => String(n).padStart(2, '0');
      datas.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    }
  } else {
    const d = document.getElementById('eiData').value;
    if (!d) { errEl.textContent = 'Informe a data.'; return; }
    datas = [d];
  }

  const unit = EscalaSmartState.units.find(u => u.id === unitId);
  const btn = document.getElementById('eiCriarBtn');
  btn.disabled = true; btn.textContent = 'Criando…';

  const criadas = [];
  for (const date of datas) {
    const slots = ScaleService.escolaInternaSlots([unit], { startTime, endTime });
    const res = await ScaleService.createScale({
      date, tipo: 'escola_interna', name: `Escola Interna ${escalaFmtBR(date)}`, slots });
    if (!res.success) {
      btn.disabled = false; btn.textContent = 'Criar';
      errEl.textContent = `Criei ${criadas.length} e falhei em ${escalaFmtBR(date)}: ${res.error || 'erro'}`;
      renderEscalaGestao();
      return;
    }
    criadas.push(res.data.id);
  }

  toast(criadas.length === 1 ? 'Sessão criada!' : `${criadas.length} sessões criadas (semana inteira).`, 'success');
  closeEscalaModal();
  EscalaSmartState.tab = 'escola_interna';
  EscalaSmartState.selectedId = criadas[0];
  renderEscalaGestao();
}

function renderTabFeriados(scales) {
  const y = EscalaSmartState.year;
  const feriados = EscalaSmartState.feriadosByYear[y] || [];
  const docs = scales.filter(s => (s.tipo === 'feriado' || s.tipo === 'domingo_especial') && s.date.startsWith(String(y)));
  const datasComDoc = new Set(docs.map(dd => dd.date));
  const sugestoes = feriados.filter(f => !datasComDoc.has(f.date));

  const tf = EscalaSmartState.timeframe, today = escalaTodayISO();
  const docsF = ScaleService.filterByTimeframe(docs, today, tf);
  const sugF = ScaleService.filterByTimeframe(sugestoes, today, tf);

  const topo = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
    <span style="font-size:12px;color:var(--text2);">A gestão aponta quais feriados terão escala.</span>
    <button class="btn-secondary" onclick="openDataEspecial()">+ Data especial</button></div>`;
  const aviso = feriados.length ? '' :
    `<p style="font-size:12px;color:#caa23a;margin:0 0 8px;">Não consegui carregar os feriados nacionais (API/cache indisponível) — adicione pelo "+ Data especial".</p>`;
  const docsHtml = docsF.map(dd => `<div style="display:flex;align-items:center;gap:0;margin-bottom:6px;">${escalaSelCb(dd.date)}<div style="flex:1;">${escalaCardDoc(dd)}</div></div>`).join('');
  const sugHtml = sugF.map(f => `<div style="display:flex;align-items:center;gap:0;margin-bottom:6px;">${escalaSelCb(f.date)}<div style="flex:1;display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px dashed var(--border);border-radius:10px;padding:10px 12px;">
      <div><div style="font-size:14px;color:var(--text2);">${f.name}</div><div style="font-size:12px;color:var(--text3);">${escalaFmtBR(f.date)} · nacional</div></div>
      <button class="btn-secondary" style="font-size:12px;" onclick="criarEscalaData('feriado','${f.date}','${(f.name || '').replace(/'/g, '')}')">Criar escala</button>
    </div></div>`).join('');
  return topo + aviso + docsHtml + sugHtml;
}

function renderTabSabados(scales) {
  let rows = ScaleService.mergeVirtualWithDocs(
    ScaleService.saturdaysOfYear(EscalaSmartState.year),
    scales.filter(s => s.tipo === 'sabado')
  );
  rows = ScaleService.filterByTimeframe(rows, escalaTodayISO(), EscalaSmartState.timeframe);
  const com = rows.filter(r => r.docs.length).length;
  const header = `<div style="font-size:12px;color:var(--text2);margin-bottom:8px;">${rows.length} sábados · ${com} com escala</div>`;

  // Sábado que também é feriado paga em dobro — a gestão precisa saber disso
  // olhando a lista, não descobrindo no fechamento (Rafael, 25/08).
  const feriadoPorData = escalaFeriadoPorData();
  const seloFeriado = (date) => {
    const nome = feriadoPorData.get(date);
    return nome
      ? `<span style="font-size:11px;padding:2px 8px;border-radius:6px;background:#2a2410;color:#caa23a;margin-left:6px;"
               title="Feriado — as aulas deste dia pagam em dobro">🎌 ${escalaEsc(nome)} · paga em dobro</span>`
      : '';
  };

  const body = rows.map(r => {
    const inner = r.docs.length
      ? r.docs.map(escalaCardDoc).join('')
      : `<div onclick="criarEscalaData('sabado','${r.date}')" style="cursor:pointer;flex:1;display:flex;align-items:center;justify-content:space-between;gap:10px;background:transparent;border:1px dashed var(--border);border-radius:10px;padding:10px 12px;">
          <div style="font-size:14px;color:var(--text2);">Sábado ${escalaFmtBR(r.date)}${seloFeriado(r.date)}</div>
          <span style="font-size:12px;color:var(--text3);">Sem escala · clique pra criar</span>
        </div>`;
    const selo = r.docs.length ? seloFeriado(r.date) : '';
    return `<div style="display:flex;align-items:center;gap:0;margin-bottom:6px;">${escalaSelCb(r.date)}<div style="flex:1;">${inner}${selo ? `<div style="margin:-2px 0 0 12px;">${selo}</div>` : ''}</div></div>`;
  }).join('');
  return header + body;
}

function renderFimDeAnoDetail(scale) {
  const slots = scale.slots || [];
  const unitName = (uid) => { const u = EscalaSmartState.units.find(x => x.id === uid); return u ? u.name : uid; };
  // Dia abreviado + data completa, cabendo nos 52px da coluna. `\w{3}` não
  // pega "sábado" (o "á" não é \w) — `[^\s,]{3}` é seguro pra acento.
  const fmtDay = (iso) => ScaleService.fmtDataLonga(iso).replace(/^([^\s,]{3})[^,]*,/, '$1,');
  const consolidated = scale.status === 'consolidada';
  const days = [...new Set(slots.map(s => s.day))].sort();

  let daysHtml = '';
  days.forEach(day => {
    const daySlots = slots.filter(s => s.day === day);
    const half = !!(daySlots[0] && daySlots[0].halfDay);
    const byUnit = {};
    daySlots.forEach(s => { (byUnit[s.unitId] = byUnit[s.unitId] || []).push(s); });
    const shiftLabel = (sid) => sid === 'manha' ? 'Manhã' : (sid === 'tarde_noite' ? 'Tarde/Noite' : (sid || ''));
    const unitsHtml = Object.keys(byUnit).map(uid => {
      const byShift = {};
      byUnit[uid].forEach(s => { (byShift[s.shift || '_'] = byShift[s.shift || '_'] || []).push(s); });
      const shiftsHtml = Object.keys(byShift).map(sid => {
        const people = byShift[sid].map(s => s.assignedPersonId
          ? `<span style="font-size:12px;">${escalaPersonName(s.assignedPersonId)}</span>`
          : `<span style="font-size:12px;color:var(--text3);">— vaga</span>`).join(' · ');
        return `<div style="font-size:12px;"><span style="color:#5EA8FF;">${shiftLabel(sid)}</span> — ${people}</div>`;
      }).join('');
      return `<div style="font-size:12px;margin-bottom:4px;"><span style="color:var(--text2);font-weight:500;">${unitName(uid)}</span>${shiftsHtml}</div>`;
    }).join('');
    daysHtml += `<div style="display:flex;gap:12px;align-items:flex-start;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px;">
      <div style="font-weight:600;font-size:13px;min-width:96px;">${fmtDay(day)}${half ? '<div style="font-size:10px;color:#caa23a;">½ período</div>' : ''}</div>
      <div style="flex:1;">${unitsHtml}</div>
    </div>`;
  });

  let sinalHtml = '';
  if (consolidated) {
    const escalados = new Set(slots.map(s => s.assignedPersonId).filter(Boolean));
    const fora = Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false && !escalados.has(t.id));
    sinalHtml = fora.length
      ? `<div style="background:#1a2a3a;border:1px solid var(--blue);border-radius:8px;padding:10px 12px;margin-top:12px;">
          <div style="font-size:12px;font-weight:600;color:var(--blue);margin-bottom:4px;">Não escalados no período — lançar folga na mão (${fora.length})</div>
          <div style="font-size:12px;color:var(--text2);">${fora.map(t => t.name).join(' · ')}</div></div>`
      : `<div style="font-size:12px;color:var(--text2);margin-top:12px;">Todos os colaboradores foram escalados em algum dia.</div>`;
  }

  const actions = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:flex-end;margin-top:12px;">
    ${scale.published ? `<span style="font-size:12px;color:var(--green);margin-right:auto;">✓ publicada na agenda</span>` : ''}
    ${scale.status === 'rascunho' ? `<button class="btn-secondary" onclick="abrirJanelaEscala('${scale.id}')">📨 Abrir janela de preferências</button>` : ''}
    <button class="btn-primary" onclick="consolidarEscala('${scale.id}')">🧮 ${consolidated ? 'Reconsolidar' : 'Consolidar'}</button>
    ${consolidated && !scale.published ? `<button class="btn-primary" onclick="publicarEscala('${scale.id}')">📅 Publicar na agenda</button>` : ''}
    ${scale.published ? `<button class="btn-secondary" onclick="despublicarEscala('${scale.id}')">↩️ Despublicar</button>` : ''}
  </div>`;

  return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;">
    <div style="margin-bottom:12px;"><div style="font-weight:600;">${scale.name || 'Fim de ano'}</div>
      <div style="font-size:12px;color:var(--text2);">${days.length} dias · turnos manhã/tarde-noite · ${ESCALA_STATUS_LABEL[scale.status] || scale.status}</div></div>
    ${daysHtml || '<p style="color:var(--text2);">Sem dias nesta escala.</p>'}
    ${sinalHtml}
    ${actions}
    ${escalaHistoricoDaEscalaHtml(scale)}
  </div>`;
}

function renderEscolaInternaDetail(scale) {
  const unitName = (uid) => { const u = EscalaSmartState.units.find(x => x.id === uid); return u ? u.name : uid; };
  const opts = (sel) => `<option value="">— escolher líder —</option>` +
    Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false)
      .map(t => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${t.name}</option>`).join('');
  const cards = (scale.slots || []).map(slot => `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:6px;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <div><div style="font-size:13px;font-weight:500;">${unitName(slot.unitId)}</div><div style="font-size:12px;color:var(--text2);">${slot.startTime}–${slot.endTime} · líder</div></div>
      <select class="input" style="width:auto;" onchange="atribuirLider('${scale.id}','${slot.id}',this.value)">${opts(slot.assignedPersonId)}</select>
    </div></div>`).join('');
  // Sessão que já aconteceu não se edita nem se apaga (decisão do usuário 04/08),
  // pelo mesmo motivo do mês fechado: não mexer em histórico.
  const passada = escalaEhPassada(scale.date);
  const actions = `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;align-items:center;">
    ${scale.published ? `<span style="font-size:12px;color:var(--green);margin-right:auto;">✓ publicada na agenda</span>` : ''}
    ${passada
      ? `<span style="font-size:12px;color:var(--text2);margin-right:auto;">Sessão já realizada — não pode ser editada.</span>`
      : `<button class="btn-secondary" onclick="abrirEdicaoEscolaInterna('${scale.id}')">✏️ Editar data/horário</button>
         <button class="btn-secondary" style="color:var(--red);" onclick="excluirEscolaInterna('${scale.id}')">🗑️ Excluir</button>`}
    ${!scale.published
      ? `<button class="btn-primary" onclick="publicarEscala('${scale.id}')">📅 Publicar na agenda</button>`
      : `<button class="btn-secondary" onclick="despublicarEscala('${scale.id}')">↩️ Despublicar</button>`}
  </div>`;
  return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;">
    <div style="margin-bottom:12px;"><div style="font-weight:600;">${scale.name || ScaleService.fmtDataLonga(scale.date)}</div>
      <div style="font-size:12px;color:var(--text2);">${ScaleService.fmtDataLonga(scale.date)} · atribuição manual do líder</div></div>
    ${cards || '<p style="color:var(--text2);">Sem sessões.</p>'}
    ${actions}
    ${escalaHistoricoDaEscalaHtml(scale)}
  </div>`;
}

/** Data da sessão já passou? Compara ISO local com hoje (hoje ainda é editável). */
function escalaEhPassada(dateISO) {
  return String(dateISO || '') < escalaTodayISO();
}

// ─── Editar data/horário de uma Escola Interna ──────────────────────────
function abrirEdicaoEscolaInterna(id) {
  const scale = EscalaSmartState.scales.find(s => s.id === id);
  if (!scale) { toast('Sessão não encontrada.', 'error'); return; }
  if (escalaEhPassada(scale.date)) { toast('Sessão já realizada não pode ser editada.', 'error'); return; }

  const slot0 = (scale.slots || [])[0] || {};
  const overlay = document.getElementById('escalaModalOverlay'), modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex'; modal.style.display = 'block';
  modal.innerHTML = `
    <h2>Editar sessão de Escola Interna</h2>
    <div class="form-group"><label>Data <span style="color:var(--red);">*</span></label>
      <input type="date" id="eiEditData" class="input" value="${scale.date}" min="${escalaTodayISO()}"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div class="form-group"><label>Início</label><input type="time" id="eiEditIni" class="input" value="${slot0.startTime || '14:30'}"></div>
      <div class="form-group"><label>Fim</label><input type="time" id="eiEditFim" class="input" value="${slot0.endTime || '15:30'}"></div>
    </div>
    <div style="font-size:12px;color:var(--text2);margin-top:4px;">
      O horário vale para todas as unidades desta sessão. Quem já foi escalado para liderar continua escalado.
      ${scale.published ? '<br><strong>Esta sessão está publicada</strong> — as aulas na agenda são atualizadas para o novo horário.' : ''}
    </div>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      <button class="btn-primary" id="eiEditSalvar" onclick="salvarEdicaoEscolaInterna('${scale.id}')">Salvar</button>
    </div>`;
}

async function salvarEdicaoEscolaInterna(id) {
  const scale = EscalaSmartState.scales.find(s => s.id === id);
  if (!scale) return;
  const date = document.getElementById('eiEditData').value;
  const startTime = document.getElementById('eiEditIni').value;
  const endTime = document.getElementById('eiEditFim').value;

  if (!date || !startTime || !endTime) { toast('Preencha data, início e fim.', 'error'); return; }
  if (escalaEhPassada(date)) { toast('Não dá para mover a sessão para uma data que já passou.', 'error'); return; }
  if (endTime <= startTime) { toast('O fim tem que ser depois do início.', 'error'); return; }

  const btn = document.getElementById('eiEditSalvar');
  btn.disabled = true; btn.textContent = 'Salvando…';

  // Publicada: tira as aulas antigas ANTES de gravar, senão o unpublish procura
  // pelo horário novo e deixa as antigas órfãs na agenda.
  if (scale.published) {
    const un = await ScaleService.unpublishFromAgenda(id);
    if (!un.success) { btn.disabled = false; btn.textContent = 'Salvar'; toast('Erro ao atualizar a agenda: ' + (un.error || 'falha'), 'error'); return; }
  }

  const res = await ScaleService.updateScale(id, { date, startTime, endTime });
  if (!res.success) { btn.disabled = false; btn.textContent = 'Salvar'; toast('Erro: ' + (res.error || 'falha'), 'error'); return; }

  if (scale.published) {
    const pub = await ScaleService.publishToAgenda(id);
    if (!pub.success) {
      toast('Sessão salva, mas falhou ao republicar na agenda — publique de novo.', 'error', 7000);
      closeEscalaModal(); renderEscalaGestao(); return;
    }
  }

  toast(scale.published ? 'Sessão atualizada e agenda republicada.' : 'Sessão atualizada.', 'success');
  closeEscalaModal();
  renderEscalaGestao();
}

async function excluirEscolaInterna(id) {
  const scale = EscalaSmartState.scales.find(s => s.id === id);
  if (!scale) return;
  if (escalaEhPassada(scale.date)) { toast('Sessão já realizada não pode ser excluída.', 'error'); return; }

  const aviso = scale.published
    ? `Excluir "${scale.name || scale.date}"?\n\nEla está PUBLICADA — as aulas dela também saem da agenda dos professores.`
    : `Excluir "${scale.name || scale.date}"?`;
  if (!confirm(aviso)) return;

  if (scale.published) {
    const un = await ScaleService.unpublishFromAgenda(id);
    if (!un.success) { toast('Erro ao tirar as aulas da agenda: ' + (un.error || 'falha'), 'error'); return; }
  }
  const res = await ScaleService.deleteScale(id);
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); return; }

  toast('Sessão excluída.', 'success');
  EscalaSmartState.selectedId = null;
  renderEscalaGestao();
}

// Evento na gestão: painel de staff (quem Deve/Poderia) + convite in-app aos novos + consolidado dos RSVP.
function renderEventoDetail(scale) {
  const rsvp = EscalaSmartState.eventoRsvp || new Map();
  const ativos = Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false);
  const tierDe = (pid) => { const r = rsvp.get(pid); return r ? r.tier : ''; };
  const linhas = ativos.map(t => {
    const tier = tierDe(t.id);
    const opt = (val, label) => `<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;margin-right:10px;"><input type="radio" name="staff_${t.id}" value="${val}" ${tier === val || (val === '' && !tier) ? 'checked' : ''}> ${label}</label>`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:13px;">${t.name}</span>
      <div>${opt('obrigatorio', 'Deve')}${opt('opcional', 'Poderia')}${opt('', 'Fora')}</div>
    </div>`;
  }).join('');

  const sum = ScaleService.summarizeRsvp(Array.from(rsvp.values()));
  const nome = (pid) => { const t = EscalaSmartState.teacherMap.get(pid); return t ? t.name : pid; };
  const bloco = (titulo, ids, cor) => ids.length
    ? `<div style="font-size:12px;margin-top:6px;"><span style="color:${cor};font-weight:600;">${titulo} (${ids.length}):</span> ${ids.map(nome).join(', ')}</div>` : '';
  const consolidado = rsvp.size
    ? `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-top:12px;">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em;">Confirmações</div>
        ${bloco('Vão', sum.vao, 'var(--green)')}${bloco('Não vão', sum.naoVao, 'var(--red)')}${bloco('Sem resposta', sum.semResposta, '#caa23a')}
      </div>` : '';

  // Sem etapa de "publicar": convidou, está valendo. A faixa abaixo diz isso em
  // voz alta pra ninguém ficar procurando um botão de confirmação que não existe.
  const prontoBar = rsvp.size
    ? `<div style="display:flex;align-items:flex-start;gap:8px;background:var(--green-bg,rgba(92,184,92,0.08));border:1px solid var(--green);border-radius:10px;padding:10px 12px;margin-bottom:12px;">
        <span style="color:var(--green);">✓</span>
        <span style="font-size:12px;color:var(--text2);"><b style="color:var(--green);">Evento no ar.</b> ${rsvp.size} pessoa(s) convidada(s) — elas já veem o evento no app e recebem lembrete 7, 4 e 1 dia antes. Não há nada mais pra confirmar aqui. Depois do evento, registre quem veio em <b style="color:var(--text);">Engajamento → Confirmar Presença</b>: é o que gera os pontos.</span>
      </div>`
    : `<div style="font-size:12px;color:var(--text2);background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:12px;">
        Marque abaixo quem <b>deve</b> e quem <b>poderia</b> participar e clique em <b>Salvar staff e convidar</b>. É só isso — evento não precisa ser publicado.
      </div>`;

  const kindBadge = scale.eventKind === 'externo' ? 'Externo' : 'Interno';
  return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;">
    <div style="margin-bottom:12px;"><div style="font-weight:600;">${scale.name || ScaleService.fmtDataLonga(scale.date)}</div>
      <div style="font-size:12px;color:var(--text2);">${ScaleService.fmtDataLonga(scale.date)} · ${kindBadge}</div></div>
    ${prontoBar}
    <div style="font-size:13px;font-weight:500;margin-bottom:6px;">Staff — quem deve / poderia participar</div>
    <div style="max-height:40vh;overflow:auto;">${linhas || '<p style="color:var(--text2);">Nenhum colaborador ativo.</p>'}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:10px;">
      <button class="btn-secondary" style="color:var(--red);border-color:var(--red);" onclick="excluirEvento('${scale.id}')">🗑️ Excluir evento</button>
      <button class="btn-primary" onclick="salvarStaffEvento('${scale.id}')">Salvar staff e convidar</button>
    </div>
    ${consolidado}
    ${escalaHistoricoDaEscalaHtml(scale)}
  </div>`;
}

/**
 * Exclui um evento. Só evento — a regra do Firestore recusa o resto.
 * O aviso diz quantas pessoas perdem o convite: apagar o evento errado depois de
 * 16 confirmações seria bem pior do que conviver com o duplicado.
 */
async function excluirEvento(scaleId) {
  const scale = EscalaSmartState.scales.find(s => s.id === scaleId);
  if (!scale) { toast('Evento não encontrado.', 'error'); return; }
  const rsvp = EscalaSmartState.eventoRsvp || new Map();
  const convidados = rsvp.size;
  const confirmados = Array.from(rsvp.values()).filter(r => r.going === true).length;

  let aviso = `Excluir "${scale.name || scale.date}"?\n\nEssa ação não tem volta.`;
  if (convidados) {
    aviso += `\n\n⚠️ ${convidados} pessoa(s) foram convidadas` +
             (confirmados ? ` e ${confirmados} já confirmaram presença` : '') +
             `. Elas perdem o convite e param de receber os lembretes.`;
  } else {
    aviso += `\n\nNinguém foi convidado ainda.`;
  }
  if (!confirm(aviso)) return;

  toast('Excluindo…', 'info');
  const res = await ScaleService.deleteEvent(scaleId);
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); return; }
  toast('Evento excluído.', 'success');
  EscalaSmartState.selectedId = null;
  EscalaSmartState.eventoRsvp = new Map();
  await escalaLoadBase();
  renderEscalaGestao();
}

async function salvarStaffEvento(scaleId) {
  const obrigatorios = [], opcionais = [];
  Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false).forEach(t => {
    const sel = document.querySelector(`input[name="staff_${t.id}"]:checked`);
    const v = sel ? sel.value : '';
    if (v === 'obrigatorio') obrigatorios.push(t.id);
    else if (v === 'opcional') opcionais.push(t.id);
  });
  const res = await ScaleService.setEventStaff(scaleId, obrigatorios, opcionais);
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); return; }
  const novos = res.data.added || [];
  if (novos.length) {
    const scale = EscalaSmartState.scales.find(s => s.id === scaleId) || {};
    const recipientIds = [];
    for (const pid of novos) {
      const t = EscalaSmartState.teacherMap.get(pid);
      let uid = t && t.userId ? t.userId : null;
      if (!uid) { try { const us = await db.collection('users').where('professorId', '==', pid).limit(1).get(); if (!us.empty) uid = us.docs[0].id; } catch (e) {} }
      if (uid) recipientIds.push(uid);
    }
    if (recipientIds.length) {
      await NotifyService.send({ recipients: recipientIds, type: 'event_invite', title: 'Convite de evento',
        body: `Você está no staff de ${scale.name || 'um evento'} (${escalaFmtBR(scale.date)}). Confirme presença.`,
        link: { type: 'escala-smart', id: scaleId }, channels: ['inapp'] });
    }
  }
  toast('Staff salvo. Convite enviado aos novos.', 'success');
  renderEscalaGestao();
}

/**
 * Troca quem trabalha numa vaga de sábado/feriado, sem refazer a escala inteira.
 * Se a escala já está publicada, republica: senão a agenda (e o pagamento que sai
 * dela) continuaria com a pessoa antiga. Publicar é idempotente e respeita aula
 * de mês já pago, então republicar aqui é seguro.
 */
async function trocarPessoaEscala(scaleId, slotId, personId) {
  const res = await ScaleService.reassignSlot(scaleId, slotId, personId || null, { nomePorId: escalaNomePorId() });
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); renderEscalaGestao(); return; }
  if (!res.data.changed) return;

  let msg = 'Vaga atualizada.';
  if (res.data.published) {
    const pub = await ScaleService.publishToAgenda(scaleId);
    msg += pub.success ? ' Agenda republicada.' : ' ⚠️ Falhou republicar na agenda — republique na mão.';
  }
  toast(msg, res.data.published ? 'success' : 'success');
  await escalaLoadBase();
  renderEscalaGestao();
}

/**
 * Inverte as duas vagas de uma unidade (TOI <-> Hiit) num clique só.
 *
 * Pelos dois selects é impossível: o serviço recusa pôr alguém que já está em
 * outra vaga do mesmo dia, então o primeiro passo da troca já morre.
 * (Rodrigo, 25/08/2026: "dar a possibilidade de inverter com um click os profs
 * do TOI e Hiit".)
 */
async function inverterVagasEscala(scaleId, slotAId, slotBId) {
  if (!slotBId) return;                       // voltou pro rótulo "⇄ Inverter com…"
  const scale = EscalaSmartState.scales.find(s => s.id === scaleId) || {};
  const slots = scale.slots || [];
  const a = slots.find(s => s.id === slotAId) || {};
  const b = slots.find(s => s.id === slotBId) || {};
  // Inverter entre unidades pode pôr alguém numa modalidade que não é dele. A
  // gestão pode querer mesmo assim — mas vendo o que está fazendo.
  const habilitado = (pid, modId) => {
    if (!pid || !modId) return true;
    const t = EscalaSmartState.teacherMap.get(pid);
    return !t || (t.modalityIds || []).indexOf(modId) !== -1;
  };
  const avisos = [];
  if (!habilitado(b.assignedPersonId, a.requiredModalityId)) avisos.push(`${escalaPersonName(b.assignedPersonId)} não é habilitado(a) na modalidade da outra vaga`);
  if (!habilitado(a.assignedPersonId, b.requiredModalityId)) avisos.push(`${escalaPersonName(a.assignedPersonId)} não é habilitado(a) na modalidade da outra vaga`);
  if (avisos.length && !confirm(`⚠️ ${avisos.join('.\n')}.\n\nInverter mesmo assim?`)) { renderEscalaGestao(); return; }

  const res = await ScaleService.swapSlots(scaleId, slotAId, slotBId, { nomePorId: escalaNomePorId() });
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); return; }

  let msg = 'Vagas invertidas.';
  // Escala publicada tem aula na agenda: sem republicar, a aula continuaria
  // no nome antigo e só a tela da escala saberia da troca.
  if (res.data.published) {
    const pub = await ScaleService.publishToAgenda(scaleId);
    msg += pub.success ? ' Agenda republicada.' : ' ⚠️ Falhou republicar na agenda — republique na mão.';
  }
  toast(msg, 'success');
  await escalaLoadBase();
  renderEscalaGestao();
}

async function atribuirLider(scaleId, slotId, personId) {
  const res = await ScaleService.assignSlot(scaleId, slotId, personId || null);
  if (res.success) { toast('Líder atualizado.', 'success'); await escalaLoadBase(); renderEscalaGestao(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}

function renderEscalaDetail(scale) {
  if (!scale) return '';
  if (scale.tipo === 'fim_de_ano') return renderFimDeAnoDetail(scale);
  if (scale.tipo === 'escola_interna') return renderEscolaInternaDetail(scale);
  if (scale.tipo === 'evento') return renderEventoDetail(scale);
  const byUnit = {};
  (scale.slots || []).forEach(s => { (byUnit[s.unitId] = byUnit[s.unitId] || []).push(s); });
  const unitName = (uid) => { const u = EscalaSmartState.units.find(x => x.id === uid); return u ? u.name : uid; };
  const reasonChip = (r) => {
    if (r === 'justica') return `<span style="font-size:11px;padding:2px 8px;border-radius:6px;background:var(--blue-bg,#1a2a3a);color:var(--blue);">⚖ Justiça</span>`;
    if (r === 'merito') return `<span style="font-size:11px;padding:2px 8px;border-radius:6px;background:#2a2410;color:#caa23a;">★ Mérito</span>`;
    if (r === 'manual') return `<span style="font-size:11px;padding:2px 8px;border-radius:6px;background:#2a1a2e;color:#c77dff;">✋ Escolha da gestão</span>`;
    return '';
  };

  // Troca manual da pessoa na vaga. Quem tem a modalidade vem primeiro; os demais
  // ficam num grupo à parte — a gestão pode escalar assim mesmo, mas vendo que
  // aquela pessoa não é habilitada.
  const pessoaOpts = (slot) => {
    const req = slot.requiredModalityId;
    const ativos = Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false);
    const temMod = (t) => !req || (t.modalityIds || []).includes(req);
    const opt = (t) => `<option value="${t.id}" ${t.id === slot.assignedPersonId ? 'selected' : ''}>${t.name}</option>`;
    const aptos = ativos.filter(temMod).map(opt).join('');
    const outros = ativos.filter(t => !temMod(t)).map(opt).join('');
    return `<option value="">— vaga aberta —</option>${aptos}` +
           (outros ? `<optgroup label="Não habilitados nesta modalidade">${outros}</optgroup>` : '');
  };

  // Inverter com QUALQUER vaga do dia — inclusive de outra unidade (Rodrigo,
  // 25/08/2026: "um prof do TOI da PP ser invertido para o Hiit da CP, e
  // vice-versa"). O serviço já fazia: `swapSlots` aceita qualquer par de vagas
  // do mesmo dia. Era a tela que só oferecia o par da mesma unidade.
  //
  // Vale um seletor por vaga, e não o botão de um clique que existia antes: com
  // dois mecanismos pra mesma coisa, a gestão teria que descobrir qual serve
  // pra qual caso.
  const inverterSelect = (slot) => {
    const outras = (scale.slots || []).filter(s => s.id !== slot.id);
    if (!outras.length) return '';
    const rotulo = (s) => {
      const u = EscalaSmartState.units.find(x => x.id === s.unitId) || {};
      const uNome = (u.name || s.unitId || '').replace(/CrossTainer\s*/i, '') || s.unitId;
      const mod = s.requiredModalityName
        || (s.requiredModalityId === (EscalaSmartState.modToi || {}).id ? 'TOI' : 'Hiit');
      return `${uNome} · ${mod} · ${escalaPersonName(s.assignedPersonId) || 'vaga aberta'}`;
    };
    const opt = (s) => `<option value="${s.id}">${escalaEsc(rotulo(s))}</option>`;
    const mesma = outras.filter(s => s.unitId === slot.unitId);
    const fora  = outras.filter(s => s.unitId !== slot.unitId);
    return `<select class="input" style="width:100%;margin-top:6px;font-size:12px;"
            onchange="inverterVagasEscala('${scale.id}','${slot.id}',this.value)"
            title="Troca as duas pessoas de vaga">
      <option value="">⇄ Inverter com…</option>
      ${mesma.map(opt).join('')}
      ${fora.length ? `<optgroup label="Outra unidade">${fora.map(opt).join('')}</optgroup>` : ''}
    </select>`;
  };

  let unitsHtml = '';
  Object.keys(byUnit).forEach(uid => {
    const cards = byUnit[uid].map(slot => {
      const person = escalaPersonName(slot.assignedPersonId);
      const filled = !!slot.assignedPersonId;
      const modLabel = slot.requiredModalityName || (slot.requiredModalityId === (EscalaSmartState.modToi || {}).id ? 'TOI' : 'Hiit');
      return `<div style="background:var(--surface);border:1px ${filled ? 'solid' : 'dashed'} var(--border);border-radius:10px;padding:10px 12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;background:var(--surface3);color:var(--text);">${modLabel}</span>
          ${filled ? reasonChip(slot.reason) : '<span style="font-size:11px;color:var(--text3);">vaga aberta</span>'}
        </div>
        ${slot.startTime ? `<div style="font-size:11px;color:var(--text2);margin-bottom:4px;">🕗 ${slot.startTime}–${slot.endTime || ''}</div>` : ''}
        <div style="font-size:14px;font-weight:${filled ? '600' : '400'};color:${filled ? 'var(--text)' : 'var(--text3)'};">${filled ? person : 'ninguém habilitado disponível'}</div>
        <select class="input" style="width:100%;margin-top:6px;font-size:12px;"
                onchange="trocarPessoaEscala('${scale.id}','${slot.id}',this.value)"
                title="Trocar quem trabalha nesta vaga">${pessoaOpts(slot)}</select>
        ${inverterSelect(slot)}
        ${filled ? whyTableHtml(slot, scale.tipo) : ''}
      </div>`;
    }).join('');
    unitsHtml += `<div style="margin-bottom:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
        <span style="font-size:13px;font-weight:500;">${unitName(uid)}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;">${cards}</div></div>`;
  });

  const actions = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:flex-end;margin-top:12px;">
      ${scale.published ? `<span style="font-size:12px;color:var(--green);margin-right:auto;">✓ publicada na agenda</span>` : ''}
      ${scale.status === 'rascunho' ? `<button class="btn-secondary" onclick="abrirJanelaEscala('${scale.id}')">📨 Abrir janela de preferências</button>` : ''}
      <button class="btn-primary" onclick="consolidarEscala('${scale.id}')">🧮 ${scale.status === 'consolidada' ? 'Reconsolidar' : 'Consolidar'}</button>
      ${scale.status === 'consolidada' && !scale.published ? `<button class="btn-primary" onclick="publicarEscala('${scale.id}')">📅 Publicar na agenda</button>` : ''}
      ${scale.published ? `<button class="btn-secondary" onclick="despublicarEscala('${scale.id}')">↩️ Despublicar</button>` : ''}
      ${(!escalaEhPassada(scale.date) && (scale.windowBatchId || (scale.slots || []).some(s => s.assignedPersonId)))
        ? `<button class="btn-secondary" onclick="tirarDoLote('${scale.id}')">🚫 Tirar do lote</button>` : ''}
    </div>`;

  return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;">
      <div><div style="font-weight:600;">${scale.name || ScaleService.fmtDataLonga(scale.date)}</div><div style="font-size:12px;color:var(--text2);">${ScaleService.fmtDataLonga(scale.date)} · ${ESCALA_STATUS_LABEL[scale.status] || scale.status}</div></div>
    </div>
    ${unitsHtml || '<p style="color:var(--text2);">Sem vagas nesta escala.</p>'}
    ${actions}
    ${escalaHistoricoDaEscalaHtml(scale)}
  </div>`;
}

/* ─── Nova escala (fim de ano) ─────────────────────────────────────── */
function openNovaEscalaFimDeAno() {
  const overlay = document.getElementById('escalaModalOverlay');
  const modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex';
  modal.style.display = 'block';
  const y = new Date().getFullYear();
  const unitChecks = EscalaSmartState.units.map(u =>
    `<label style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-size:13px;"><input type="checkbox" class="feUnit" value="${u.id}" checked> ${u.name || u.id}</label>`
  ).join('') || '<span style="font-size:12px;color:var(--text3);">Nenhuma unidade cadastrada.</span>';
  modal.innerHTML = `
    <h2>Fim de ano — horário reduzido</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div class="form-group"><label>Início</label><input type="date" id="feInicio" class="input" value="${y}-12-21"></div>
      <div class="form-group"><label>Fim</label><input type="date" id="feFim" class="input" value="${y + 1}-01-02"></div>
    </div>
    <div class="form-group"><label>Unidades abertas</label><div style="padding:4px 0;">${unitChecks}</div></div>
    <div class="form-group"><label>Turnos (horário reduzido)</label>
      <div style="display:grid;grid-template-columns:auto 1fr 1fr;gap:8px;align-items:center;">
        <span style="font-size:13px;">Manhã</span>
        <input type="time" id="feManhaIni" class="input" value="08:00">
        <input type="time" id="feManhaFim" class="input" value="12:00">
        <span style="font-size:13px;">Tarde/Noite</span>
        <input type="time" id="feTardeIni" class="input" value="16:00">
        <input type="time" id="feTardeFim" class="input" value="21:00">
      </div>
    </div>
    <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;margin-bottom:6px;"><input type="checkbox" id="feAbrir24"> Abrir 24/12 (por padrão fechado)</label>
    <p style="font-size:12px;color:var(--text2);">Vagas por dia × unidade × turno (1 pessoa/turno). Fechado 25/12, 31/12 e 01/01. Ajuste as datas a cada ano.</p>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      <button class="btn-primary" onclick="criarEscalaFimDeAno()">Criar</button>
    </div>`;
}

function closeEscalaModal() {
  const o = document.getElementById('escalaModalOverlay'), m = document.getElementById('escalaModal');
  if (o) o.style.display = 'none'; if (m) m.style.display = 'none';
}

function openDataEspecial() {
  const overlay = document.getElementById('escalaModalOverlay');
  const modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex';
  modal.style.display = 'block';
  modal.innerHTML = `
    <h2>Data especial</h2>
    <div class="form-group"><label>Nome <span style="color:var(--red);">*</span></label><input type="text" id="deNome" class="input" placeholder="Ex.: Aniversário da cidade"></div>
    <div class="form-group"><label>Data <span style="color:var(--red);">*</span></label><input type="date" id="deData" class="input" value="${escalaTodayISO()}"></div>
    <div class="form-group"><label>Tipo</label><select id="deTipo" class="input">
      <option value="feriado">Feriado (municipal/estadual)</option>
      <option value="domingo_especial">Domingo especial</option>
    </select></div>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      <button class="btn-primary" onclick="criarDataEspecial()">Criar</button>
    </div>`;
}

async function criarDataEspecial() {
  const nome = (document.getElementById('deNome').value || '').trim();
  const date = document.getElementById('deData').value;
  const tipo = document.getElementById('deTipo').value;
  if (!nome || !date) { toast('Informe nome e data.', 'error'); return; }
  await criarEscalaData(tipo, date, `${nome} ${escalaFmtBR(date)}`);
}

function openNovoEvento(dateISO) {
  const overlay = document.getElementById('escalaModalOverlay');
  const modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex';
  modal.style.display = 'block';
  modal.innerHTML = `
    <h2>Novo evento</h2>
    <div class="form-group"><label>Nome <span style="color:var(--red);">*</span></label><input type="text" id="evNome" class="input" placeholder="Ex.: Reunião do staff, treinamento interno, trilha, beach games"></div>
    <div class="form-group"><label>Data <span style="color:var(--red);">*</span></label><input type="date" id="evData" class="input" value="${dateISO || escalaTodayISO()}"></div>
    <div class="form-group"><label>Classificação</label><div style="display:flex;gap:14px;padding:4px 0;">
      <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;"><input type="radio" name="evKind" value="interno" checked> Interno (reunião, treinamento)</label>
      <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;"><input type="radio" name="evKind" value="externo"> Externo (campeonato, evento fora)</label>
    </div></div>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      <button class="btn-primary" onclick="criarNovoEvento()">Criar</button>
    </div>`;
}

async function criarNovoEvento() {
  const nome = (document.getElementById('evNome').value || '').trim();
  const date = document.getElementById('evData').value;
  const kind = (document.querySelector('input[name="evKind"]:checked') || {}).value || 'interno';
  if (!nome || !date) { toast('Informe nome e data.', 'error'); return; }
  await criarEscalaData('evento', date, `${nome} ${escalaFmtBR(date)}`, kind);
}

// Criação contextual usada pelas abas Sábados/Feriados/Eventos
async function criarEscalaData(tipo, date, name, eventKind) {
  if (!date) { toast('Informe a data.', 'error'); return; }
  const toi = EscalaSmartState.modToi, hiit = EscalaSmartState.modHiit;
  // Evento não tem vagas de TOI/Hiit — é painel de staff (quem trabalha/representa). Sem modalidades exigidas.
  if (tipo !== 'evento' && (!toi || !hiit)) { toast('Cadastre as modalidades TOI e Hiit antes.', 'error'); return; }
  const tipoLabel = (ESCALA_TIPOS.find(t => t.id === tipo) || {}).label || tipo;
  const payload = { date, tipo, name: name || `${tipoLabel} ${escalaFmtBR(date)}`, slots: tipo === 'evento' ? [] : escalaSlotsPadrao(tipo) };
  if (eventKind) payload.eventKind = eventKind;
  // Sábado que também é feriado guarda o nome do feriado — é o que faz a aula
  // nascer em dobro depois (Rafael, 25/08).
  if (tipo === 'sabado') {
    const nomeFeriado = escalaFeriadoPorData(Number(String(date).slice(0, 4))).get(date);
    if (nomeFeriado) payload.feriadoNaData = nomeFeriado;
  }
  const res = await ScaleService.createScale(payload);
  if (res.success) { toast('Escala criada!', 'success'); closeEscalaModal(); EscalaSmartState.selectedId = res.data.id; renderEscalaGestao(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}

async function criarEscalaFimDeAno() {
  const start = document.getElementById('feInicio').value;
  const end = document.getElementById('feFim').value;
  if (!start || !end || start > end) { toast('Informe um período válido.', 'error'); return; }
  const selUnits = Array.from(document.querySelectorAll('.feUnit:checked')).map(c => c.value);
  if (!selUnits.length) { toast('Selecione ao menos uma unidade.', 'error'); return; }
  const units = EscalaSmartState.units.filter(u => selUnits.includes(u.id));
  const shifts = [
    { id: 'manha', label: 'Manhã', startTime: document.getElementById('feManhaIni').value, endTime: document.getElementById('feManhaFim').value },
    { id: 'tarde_noite', label: 'Tarde/Noite', startTime: document.getElementById('feTardeIni').value, endTime: document.getElementById('feTardeFim').value },
  ];
  const abrir24 = document.getElementById('feAbrir24').checked;
  const all = ScaleService.datesInRange(start, end);
  const closedMMDD = new Set(['12-25', '12-31', '01-01']);
  if (!abrir24) closedMMDD.add('12-24');
  const period = { start, end, closedDays: all.filter(d => closedMMDD.has(d.slice(5))) };
  const slots = ScaleService.templateSlotsFimDeAno(period, units, shifts, 1);
  const res = await ScaleService.createScale({ date: start, tipo: 'fim_de_ano', name: `Fim de ano ${start.slice(0, 4)}`, slots });
  if (res.success) { toast('Escala de fim de ano criada!', 'success'); closeEscalaModal(); EscalaSmartState.tab = 'fim_de_ano'; EscalaSmartState.selectedId = res.data.id; renderEscalaGestao(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}

function selectEscala(id) { EscalaSmartState.selectedId = id; renderEscalaGestao(); }

// Seleção múltipla de datas (sábados/feriados) p/ abrir janela em lote.
function escalaToggleSel(date) {
  if (EscalaSmartState.selected.has(date)) EscalaSmartState.selected.delete(date);
  else EscalaSmartState.selected.add(date);
  renderEscalaGestao();
}
function escalaLimparSel() { EscalaSmartState.selected.clear(); renderEscalaGestao(); }
function escalaSelCb(date) {
  return `<input type="checkbox" onclick="event.stopPropagation();escalaToggleSel('${date}')" ${EscalaSmartState.selected.has(date) ? 'checked' : ''} style="margin-right:8px;flex:none;">`;
}

// Modal de prazo compartilhado. target = { dates:[...] } (lote) OU { scaleId, date } (individual).
function openAbrirJanelaModal(target) {
  const overlay = document.getElementById('escalaModalOverlay'), modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  EscalaSmartState._janelaTarget = target;
  const dias = target.dates ? target.dates.slice().sort() : [target.date];
  overlay.style.display = 'flex'; modal.style.display = 'block';
  modal.innerHTML = `
    <h2>Abrir janela de preferências</h2>
    <p style="font-size:13px;color:var(--text2);">${dias.length} data(s): ${dias.map(escalaFmtBR).join(', ')}</p>
    <div class="form-group"><label>Fecha em <span style="color:var(--red);">*</span></label>
      <input type="datetime-local" id="janelaClosesAt" class="input"></div>
    <p style="font-size:12px;color:var(--text2);">Todos os professores ativos serão avisados no sistema para se candidatarem até essa data.</p>
    ${escalaHistoricoAnoHtml()}
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Cancelar</button>
      <button class="btn-primary" onclick="confirmarAbrirJanela()">Abrir e avisar</button>
    </div>`;
}

async function confirmarAbrirJanela() {
  const closesAt = document.getElementById('janelaClosesAt').value;
  if (!closesAt) { toast('Informe a data-limite.', 'error'); return; }
  const target = EscalaSmartState._janelaTarget || {};
  const batchId = 'batch_' + Date.now();
  toast('Abrindo janela…', 'info');
  let datasAviso = [];
  if (target.scaleId) {
    const scale = EscalaSmartState.scales.find(s => s.id === target.scaleId);
    await ScaleService.openElection(target.scaleId, { closesAt, batchId });
    datasAviso = [scale ? scale.date : target.date];
  } else {
    const datas = (target.dates || []).slice().sort();
    const tipo = EscalaSmartState.tab === 'feriado' ? 'feriado' : 'sabado';
    for (const date of datas) {
      let doc = EscalaSmartState.scales.find(s => s.date === date && s.tipo === tipo);
      if (!doc) {
        const nomeFeriado = tipo === 'sabado'
          ? escalaFeriadoPorData(Number(String(date).slice(0, 4))).get(date)
          : null;
        const res = await ScaleService.createScale({
          date, tipo,
          name: `${tipo === 'feriado' ? 'Feriado' : 'Sábado'} ${escalaFmtBR(date)}`,
          feriadoNaData: nomeFeriado || null,
          slots: escalaSlotsPadrao(tipo),
        });
        if (!res.success) { toast('Erro ao criar ' + date, 'error'); continue; }
        doc = res.data;
      }
      await ScaleService.openElection(doc.id, { closesAt, batchId });
    }
    datasAviso = datas;
  }
  const rec = await NotifyService.resolveActiveTeacherUserIds();
  if (rec.success && rec.data.length) {
    await NotifyService.send({
      recipients: rec.data, type: 'scale_window_open',
      title: 'Janela de escala aberta',
      body: `Candidate-se aos dias ${datasAviso.map(escalaFmtBR).join(', ')} até ${escalaFmtBR(closesAt.slice(0, 10))}.`,
      link: { type: 'escala-smart', id: batchId }, channels: ['inapp'],
    });
  }
  toast('Janela aberta. Time avisado.', 'success');
  EscalaSmartState.selected.clear();
  EscalaSmartState._janelaTarget = null;
  closeEscalaModal();
  renderEscalaGestao();
}

// gatilho do lote (barra de ação)
function openAbrirLote() {
  if (!EscalaSmartState.selected.size) { toast('Selecione ao menos uma data.', 'error'); return; }
  openAbrirJanelaModal({ dates: Array.from(EscalaSmartState.selected) });
}

function abrirJanelaEscala(id) {
  const scale = EscalaSmartState.scales.find(s => s.id === id);
  if (!scale) { toast('Escala não encontrada.', 'error'); return; }
  openAbrirJanelaModal({ scaleId: id, date: scale.date });
}

/**
 * Férias/recessos APROVADOS — alimentam a exclusão de candidatos na consolidação.
 * Falha silenciosa devolve [] de propósito: sem a lista, o motor volta a se comportar
 * como antes (escala mesmo quem está de férias) em vez de travar a consolidação.
 * A gestão ainda vê o resultado na Revisão antes de confirmar.
 */
async function escalaCarregarFerias() {
  if (typeof VacationService !== 'object' || typeof VacationService.listAll !== 'function') return [];
  try {
    const res = await VacationService.listAll({ status: 'aprovada' });
    return (res && res.success) ? res.data : [];
  } catch (e) { console.warn('[escalaCarregarFerias]', e); return []; }
}

async function consolidarEscala(id) {
  // Reconsolidar refaz a escala do zero — e apaga escolha manual que a gestão
  // tenha feito. O botão não contava nada disso (Rodrigo, 25/08: "explicar
  // melhor o comportamento qdo clicar em Reconsolidar e Despublicar").
  //
  // Lê do BANCO, não de EscalaSmartState: `status` e `published` mudam a cada
  // consolidação/publicação, e o estado em memória envelhece. Com ele velho o
  // aviso não aparecia e — pior — a agenda não era republicada, deixando
  // escala e agenda divergentes: exatamente o defeito que este trecho conserta.
  const frescoRes = await ScaleService.getScale(id);
  const jaFeita = (frescoRes && frescoRes.success) ? frescoRes.data
                : (EscalaSmartState.scales.find(s => s.id === id) || {});
  if (jaFeita.status === 'consolidada') {
    const temManual = (jaFeita.slots || []).some(s => s.reason === 'manual');
    const aviso = 'Reconsolidar refaz a escolha do zero, pelo rodízio e pelo mérito de hoje.\n\n'
      + (temManual ? '⚠️ Os ajustes feitos na mão nesta data serão APAGADOS.\n\n' : '')
      + (jaFeita.published ? 'A agenda será republicada com os nomes novos.\n\n' : '')
      + 'A conta de quantos dias cada um já pegou é refeita agora, com o que está nas escalas hoje '
      + '— e esta data fica de fora da conta, para não penalizar quem pode ser escolhido de novo.\n\nContinuar?';
    if (!confirm(aviso)) return;
  }

  toast('Consolidando…', 'info');
  // monta ctx: professores ativos + mérito (placar do ciclo atual) + opts
  const teachers = Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false);
  const cyclesRes = await EngagementService.listCycles();
  const cycles = (cyclesRes.success && cyclesRes.data.length) ? cyclesRes.data
    : [{ id: '_all', inicio: '1900-01-01', fim: escalaTodayISO() }];
  const cycle = (typeof EngagementService.currentCycle === 'function' ? EngagementService.currentCycle(cycles, escalaTodayISO()) : null) || cycles[0];
  const meritoById = {};
  for (const t of teachers) {
    const hire = (t.hireDate && t.hireDate.toDate) ? t.hireDate.toDate().toISOString().slice(0, 10) : null;
    const sb = await EngagementService.scoreboard(t.id, hire, cycle);
    meritoById[t.id] = sb.success ? sb.data.total : 0;
  }
  const ctx = {
    teachers: teachers.map(t => ({ id: t.id, name: t.name, modalityIds: t.modalityIds || [], primaryUnitId: t.primaryUnitId })),
    meritoById, opts: { minMes: 1 },
    vacations: await escalaCarregarFerias(),
    // O motor precisa enxergar os sábados vizinhos pra não repetir a pessoa
    // em dois sábados seguidos (Rafael, 25/08).
    scalesDoAno: EscalaSmartState.scales || [],
    nomePorId: escalaNomePorId(),
    // Sem `acaoHistorico`: este fluxo é de UMA escala (id de escala, não de
    // lote) — não existe "refazer" aqui, é sempre "Reconsolidar"/"Consolidar"
    // pelo botão. Cai no default do serviço ('consolidada'). Comparar
    // `EscalaSmartState.remontando` (que guarda um batchId) contra `id` (id de
    // escala) nunca bateria — seria uma condição morta.
  };
  const res = jaFeita.tipo === 'fim_de_ano'
    ? await ScaleService.consolidateByDay(id, ctx)
    : await ScaleService.consolidate(id, ctx);
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); return; }

  let msg = 'Escala consolidada!';
  // Trocar alguém pelo select já republicava; reconsolidar não. A tela ficaria
  // com o nome novo e a agenda com o antigo, sem ninguém saber.
  if (jaFeita.published) {
    const pub = await ScaleService.publishToAgenda(id);
    msg += pub.success ? ' Agenda republicada.' : ' ⚠️ Falhou republicar na agenda — republique na mão.';
  }
  toast(msg, 'success');
  await escalaLoadBase();
  renderEscalaGestao();
}

// ─── Revisão de fechamento (lote) ──────────────────────────────────
async function abrirRevisaoLote(batchId) {
  toast('Carregando revisão…', 'info');
  const byBatch = await ScaleService.listScalesByBatch(batchId);
  if (!byBatch.success || !byBatch.data.length) { toast('Lote não encontrado.', 'error'); return; }
  const scales = byBatch.data.slice().sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0)); // ordena por data (serviço não ordena)
  const prefsByScale = {};
  for (const s of scales) {
    const pr = await ScaleService.listPreferences(s.id);
    prefsByScale[s.id] = pr.success ? pr.data : [];
  }
  const people = Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false).map(t => ({ id: t.id, name: t.name }));
  const matrix = ScaleService.buildConsolidationMatrix(scales, prefsByScale, people);
  // Quem está de férias em alguma data do lote — a gestão precisa ver ANTES de
  // confirmar por que aquela pessoa não vai aparecer em nenhuma vaga.
  const vacs = await escalaCarregarFerias();
  const feriasPorPessoa = new Map();
  scales.forEach(s => {
    ScaleService.personsOnVacation(vacs, s.date).forEach(pid => {
      if (!feriasPorPessoa.has(pid)) feriasPorPessoa.set(pid, []);
      feriasPorPessoa.get(pid).push(escalaFmtBR(s.date));
    });
  });
  renderRevisaoFechamento(batchId, scales, matrix, feriasPorPessoa);
}

function renderRevisaoFechamento(batchId, scales, matrix, feriasPorPessoa) {
  const overlay = document.getElementById('escalaModalOverlay'), modal = document.getElementById('escalaModal');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex'; modal.style.display = 'block';
  const prefTxt = (p) => p === 'prefiro' ? '★' : p === 'pode_ser' ? '✓' : p === 'nao_posso' ? '✕' : '·';
  const head = `<tr><th style="text-align:left;padding:4px 8px;">Pessoa</th>${scales.map(s => `<th style="padding:4px 8px;font-weight:400;font-size:11px;">${escalaFmtBR(s.date)}</th>`).join('')}</tr>`;
  const body = matrix.grid.map(g => `<tr>
    <td style="padding:4px 8px;${matrix.semCandidatura.some(p => p.id === g.person.id) ? 'color:var(--text3);' : ''}">${g.person.name}</td>
    ${scales.map(s => { const c = g.cells[s.id]; return `<td style="text-align:center;padding:4px 8px;${c.assigned ? 'background:var(--surface3);font-weight:600;' : ''}">${prefTxt(c.pref)}</td>`; }).join('')}
  </tr>`).join('');
  const semCand = matrix.semCandidatura.length
    ? `<p style="font-size:12px;color:#caa23a;margin:8px 0;">Não se candidataram a nada: ${matrix.semCandidatura.map(p => p.name).join(', ')}</p>` : '';
  const ferias = (feriasPorPessoa && feriasPorPessoa.size)
    ? `<p style="font-size:12px;color:var(--blue);margin:8px 0;">🏖️ De férias e por isso fora da escala: ${
        Array.from(feriasPorPessoa.entries()).map(([pid, datas]) => `${escalaPersonName(pid)} (${datas.join(', ')})`).join(' · ')
      }</p>` : '';
  modal.innerHTML = `
    <h2>Revisão de fechamento</h2>
    <p style="font-size:12px;color:var(--text2);">★ prefiro · ✓ pode ser · ✕ não posso · célula destacada = escalado. Vagas abertas: ${matrix.vagasAbertas}.</p>
    <div style="overflow:auto;max-height:50vh;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    ${semCand}
    ${ferias}
    <p style="font-size:12px;color:var(--text2);">O próximo passo <b>monta a escala e mostra pra você conferir</b> — ninguém é avisado e nada vai pra agenda ainda. Quem está de férias aprovadas na data <b>não é escalado</b>.</p>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Fechar</button>
      <button class="btn-primary" onclick="gerarPreviaLote('${batchId}')">🧮 Montar escala e ver prévia</button>
    </div>`;
}

/**
 * PRÉVIA (Rodrigo, 24/08/2026): "antes de consolidar e publicar, o sistema deve
 * mostrar um resumo antes... e habilitar a possibilidade de fazer ajustes".
 *
 * Antes o botão fechava a janela, consolidava, publicava na agenda e avisava o
 * time — tudo num clique. A gestão só descobria quem tinha sido escalado depois
 * de o time já ter sido avisado. Agora monta e mostra; publicar é o passo
 * seguinte, e no meio dá pra trocar quem quiser.
 */
/**
 * Refaz uma janela inteira que já foi montada (e possivelmente publicada).
 *
 * Existe por causa de setembro/outubro de 2026: a escala saiu de um contador
 * travado (a Karin marcava 1 e tinha 3 sábados), então as datas foram montadas
 * com a informação errada. Refazer é decisão da gestão — o time já foi avisado
 * das datas antigas e vai precisar ser avisado de novo.
 */
async function refazerJanela(batchId) {
  const doLote = (EscalaSmartState.scales || []).filter(s => s.windowBatchId === batchId);
  const publicadas = doLote.filter(s => s.published).length;
  // HOJE também está fora: a aula de hoje pode já ter sido dada e marcada como
  // realizada, e republicar a devolveria pra "prevista".
  const passadas = doLote.filter(s => s.date <= escalaTodayISO()).length;
  // Republicar apaga e recria as aulas: aula já marcada como realizada voltaria
  // pra prevista. Regra de operação firmada em 25/08/2026.
  if (passadas) {
    toast(`Esta janela tem ${passadas} data(s) que já aconteceram (ou são hoje). Refazer republicaria aulas do passado — não dá.`, 'error', 9000);
    return;
  }
  const aviso = `Refazer a escala de ${doLote.length} data(s)?

`
    + `O sistema monta tudo de novo, do zero, com a contagem correta. Você vê a prévia antes de publicar.

`
    + (publicadas ? `⚠️ ${publicadas} data(s) já estão publicadas. As aulas saem da agenda AGORA e só voltam quando você publicar de novo — e aí todos serão avisados de que a escala MUDOU.` : '');
  if (!confirm(aviso)) return;
  EscalaSmartState.remontando = batchId;

  // Despublica ANTES de montar. Sem isso, a prévia reescreve quem trabalha em
  // cada dia enquanto a agenda continua com os nomes antigos e o professor —
  // que desde 26/08 só enxerga escala publicada — vê a lista nova como se já
  // valesse. Fechar a prévia sem publicar deixaria os três discordando em
  // silêncio, que é o defeito que esta frente inteira existe pra matar.
  //
  // Preferimos o estado VISIVELMENTE incompleto (agenda vazia, professor lendo
  // "a gestão está montando") ao estado silenciosamente errado. E a trava de
  // data acima garante que só mexemos em dia que ainda não chegou.
  let despublicadas = 0;
  for (const s of doLote.filter(x => x.published)) {
    const r = await ScaleService.unpublishFromAgenda(s.id);
    if (r && r.success) despublicadas++;
    else toast(`⚠️ Não consegui tirar ${escalaFmtBR(s.date)} da agenda. Confira essa data antes de publicar.`, 'error', 9000);
  }
  if (despublicadas) toast(`${despublicadas} data(s) saíram da agenda até você publicar a escala nova.`, 'info', 7000);

  await gerarPreviaLote(batchId);
}

async function gerarPreviaLote(batchId) {
  toast('Montando a escala…', 'info');
  const byBatch = await ScaleService.listScalesByBatch(batchId);
  if (!byBatch.success || !byBatch.data.length) { toast('Lote não encontrado.', 'error'); return; }
  const scales = byBatch.data.slice().sort((a, b) => (a.date > b.date ? 1 : -1));

  const ctx = await escalaMontarCtx();
  // Veio do 🔄 Refazer? Então o histórico diz "refeita", não "montada".
  ctx.acaoHistorico = (EscalaSmartState.remontando === batchId) ? 'refeita' : 'consolidada';
  // Cota da janela: quantos dias cada um disse que quer. O motor precisa saber
  // também quantos a pessoa JÁ pegou neste lote — por isso o contador vai sendo
  // atualizado a cada data, na ordem.
  const cotas = await ScaleService.listWindowQuotas(batchId);
  ctx.cotaById = cotas.success ? cotas.data : {};
  ctx.jaNoLoteById = {};

  // As datas deste lote ficam FORA da conta até serem remontadas nesta rodada.
  // Enquanto carregam a escala antiga, contá-las empurraria as pessoas erradas
  // — é o que fazia remontar a prévia PIORAR a escala em vez de melhorar.
  const aRemontar = new Set(scales.map(s => s.date));

  // A regra dos sábados seguidos precisa enxergar o que ACABOU de ser montado
  // neste mesmo lote: numa janela de 2 meses os sábados vizinhos são
  // consolidados nesta mesma volta, e o estado em memória ainda não os conhece.
  // Sem isto a regra só pegaria sábado montado numa rodada anterior — que é
  // justamente o caso mais raro.
  const montadas = (EscalaSmartState.scales || []).slice();
  const registrar = (scale, assignments) => {
    const slots = (scale.slots || []).map(sl => {
      const at = (assignments || []).find(x => x.slotId === sl.id);
      return at ? Object.assign({}, sl, { assignedPersonId: at.personId || null }) : sl;
    });
    const i = montadas.findIndex(x => x.id === scale.id);
    const novo = Object.assign({}, scale, { slots });
    if (i >= 0) montadas[i] = novo; else montadas.push(novo);
  };

  const falhas = [];
  for (const s of scales) {
    await ScaleService.closeElection(s.id);
    ctx.scalesDoAno = montadas;
    ctx.excluirDatas = Array.from(aRemontar);
    const cons = await ScaleService.consolidate(s.id, ctx);
    if (!cons.success) { falhas.push(`${escalaFmtBR(s.date)}: ${cons.error}`); continue; }
    registrar(s, cons.data.assignments);
    aRemontar.delete(s.date);   // agora ela conta — já com a escala nova
    (cons.data.assignments || []).forEach(a => {
      if (a.personId) ctx.jaNoLoteById[a.personId] = (ctx.jaNoLoteById[a.personId] || 0) + 1;
    });
  }
  // Era `carregarEscalas()` — uma função que NUNCA existiu no frontend. Entrou
  // com a prévia em 24/08/2026 (88a307e) e foi pra produção assim: clicar em
  // "Montar escala e ver prévia" consolidava o lote inteiro no banco e estourava
  // ReferenceError antes de desenhar a prévia. O botão anunciado pro Rodrigo
  // como "monta e PARA pra você conferir" montava e sumia. Passou por 12
  // verificações automatizadas porque todas olhavam o texto do arquivo, não o
  // comportamento. (26/08/2026)
  await escalaLoadBase();
  renderPreviaLote(batchId, falhas);
}

/** Desenha o resumo do que foi montado, no formato que o Rodrigo pediu. */
function renderPreviaLote(batchId, falhas) {
  const modal = document.getElementById('escalaModal');
  const scales = EscalaSmartState.scales
    .filter(s => s.windowBatchId === batchId)
    .sort((a, b) => (a.date > b.date ? 1 : -1));

  const nomeUnidade = (uid) => {
    const u = EscalaSmartState.units.find(x => x.id === uid) || {};
    return (u.name || uid || '').replace(/CrossTainer\s*/i, '') || uid;
  };
  const nomeMod = (mid) => mid === (EscalaSmartState.modToi || {}).id ? 'TOI'
    : mid === (EscalaSmartState.modHiit || {}).id ? 'Hiit' : '';
  const motivo = (r) => r === 'justica' ? 'rodízio' : r === 'manual' ? 'ajuste da gestão' : r === 'merito' ? 'mérito' : '—';

  const linhas = scales.map(s => {
    const porUnidade = {};
    (s.slots || []).forEach(sl => {
      const u = nomeUnidade(sl.unitId);
      const quem = sl.assignedPersonId
        ? `${escalaPersonName(sl.assignedPersonId)} <span style="color:var(--text3);">(${nomeMod(sl.requiredModalityId)} · ${motivo(sl.reason)})</span>`
        : '<span style="color:#caa23a;">vaga aberta</span>';
      (porUnidade[u] = porUnidade[u] || []).push(quem);
    });
    const corpo = Object.entries(porUnidade)
      .map(([u, p]) => `<div style="margin-left:12px;"><b>${u}:</b> ${p.join(' · ')}</div>`).join('');
    return `<div style="padding:6px 0;border-bottom:1px solid var(--border);">
      <div style="font-weight:600;font-size:13px;">${escalaFmtBR(s.date)}</div>${corpo}</div>`;
  }).join('');

  // Quantas vezes cada um ficou, e quem não entrou — as duas perguntas do Rodrigo
  const cont = {};
  scales.forEach(s => (s.slots || []).forEach(sl => {
    if (sl.assignedPersonId) cont[sl.assignedPersonId] = (cont[sl.assignedPersonId] || 0) + 1;
  }));
  const distrib = Object.entries(cont).sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${escalaPersonName(id)}: ${n}`).join(' · ');
  const fora = Array.from(EscalaSmartState.teacherMap.values())
    .filter(t => t.isActive !== false && !cont[t.id]);

  const vagasAbertas = scales.reduce((n, s) => n + (s.slots || []).filter(x => !x.assignedPersonId).length, 0);

  const btnPublicar = `<button class="btn-primary" onclick="confirmarEAvisar('${batchId}')">${escalaRotuloPublicar(scales)}</button>`;

  modal.innerHTML = `
    <h2>Prévia da escala</h2>
    <p style="font-size:12px;color:var(--text2);">Nada foi publicado e ninguém foi avisado ainda. Confira, ajuste se precisar, e só então publique.</p>
    <div style="display:flex;justify-content:flex-end;margin:8px 0;">${btnPublicar}</div>
    ${EscalaSmartState.remontando === batchId ? `<div style="background:#3a2f1a;border:1px solid #caa23a;border-radius:8px;padding:10px;margin:10px 0;font-size:12px;">
      ⚠️ Estas datas <b>saíram da agenda</b> para serem refeitas. Enquanto você não publicar, elas não existem para os professores. Se fechar agora, volte e publique.
    </div>` : ''}
    ${falhas && falhas.length ? `<div style="background:#3a1a1a;border:1px solid var(--red);border-radius:8px;padding:10px;margin:10px 0;font-size:12px;">Falhou em: ${falhas.join(' · ')}</div>` : ''}
    ${vagasAbertas ? `<div style="background:#3a2f1a;border:1px solid #caa23a;border-radius:8px;padding:10px;margin:10px 0;font-size:12px;">⚠️ ${vagasAbertas} vaga(s) sem ninguém — ninguém habilitado estava disponível. Preencha na mão antes de publicar, senão o dia fica sem professor.</div>` : ''}
    <div style="overflow:auto;max-height:42vh;font-size:13px;margin:10px 0;">${linhas}</div>
    <div style="background:var(--surface2);border-radius:8px;padding:10px;font-size:12px;margin-bottom:8px;">
      <div style="font-weight:600;margin-bottom:4px;">Quantas vezes cada um</div>${distrib || '—'}
    </div>
    ${fora.length ? `<div style="background:#1a2a3a;border:1px solid var(--blue);border-radius:8px;padding:10px;font-size:12px;">
      <div style="font-weight:600;color:var(--blue);margin-bottom:4px;">Fica para a próxima escala (${fora.length})</div>
      ${fora.map(t => t.name).join(' · ')}
      <div style="color:var(--text2);margin-top:4px;">Na próxima janela essas pessoas vêm na frente — o rodízio conta quem trabalhou menos.</div>
    </div>` : ''}
    <p style="font-size:12px;color:var(--text2);margin-top:10px;">Para trocar alguém: feche esta janela, abra a data na lista e use o seletor da vaga. A troca conta no rodízio das próximas.</p>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn-secondary" onclick="closeEscalaModal()">Fechar sem publicar</button>
      ${btnPublicar}
    </div>`;
}

/** ctx do motor: professores ativos + mérito do ciclo + férias. */
async function escalaMontarCtx() {
  const teachers = Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false);
  const cyclesRes = await EngagementService.listCycles();
  const cycles = (cyclesRes.success && cyclesRes.data.length) ? cyclesRes.data
    : [{ id: '_all', inicio: '1900-01-01', fim: escalaTodayISO() }];
  const cycle = (typeof EngagementService.currentCycle === 'function'
    ? EngagementService.currentCycle(cycles, escalaTodayISO()) : null) || cycles[0];
  const meritoById = {};
  for (const t of teachers) {
    const hire = (t.hireDate && t.hireDate.toDate) ? t.hireDate.toDate().toISOString().slice(0, 10) : null;
    const sb = await EngagementService.scoreboard(t.id, hire, cycle);
    meritoById[t.id] = sb.success ? sb.data.total : 0;
  }
  return {
    teachers: teachers.map(t => ({ id: t.id, name: t.name, modalityIds: t.modalityIds || [], primaryUnitId: t.primaryUnitId })),
    meritoById, opts: { minMes: 1 }, vacations: await escalaCarregarFerias(),
    // O motor precisa enxergar os sábados vizinhos pra não repetir a pessoa
    // em dois sábados seguidos (Rafael, 25/08).
    scalesDoAno: EscalaSmartState.scales || [],
    nomePorId: escalaNomePorId(),
  };
}

async function confirmarEAvisar(batchId) {
  const byBatch = await ScaleService.listScalesByBatch(batchId);
  if (!byBatch.success) { toast('Erro ao carregar lote.', 'error'); return; }
  toast('Consolidando…', 'info');
  // monta ctx: professores ativos + mérito (placar do ciclo atual) + opts — mesmo padrão de consolidarEscala()
  const teachers = Array.from(EscalaSmartState.teacherMap.values()).filter(t => t.isActive !== false);
  const cyclesRes = await EngagementService.listCycles();
  const cycles = (cyclesRes.success && cyclesRes.data.length) ? cyclesRes.data
    : [{ id: '_all', inicio: '1900-01-01', fim: escalaTodayISO() }];
  const cycle = (typeof EngagementService.currentCycle === 'function' ? EngagementService.currentCycle(cycles, escalaTodayISO()) : null) || cycles[0];
  const meritoById = {};
  for (const t of teachers) {
    const hire = (t.hireDate && t.hireDate.toDate) ? t.hireDate.toDate().toISOString().slice(0, 10) : null;
    const sb = await EngagementService.scoreboard(t.id, hire, cycle);
    meritoById[t.id] = sb.success ? sb.data.total : 0;
  }
  const ctx = {
    teachers: teachers.map(t => ({ id: t.id, name: t.name, modalityIds: t.modalityIds || [], primaryUnitId: t.primaryUnitId })),
    meritoById, opts: { minMes: 1 },
    vacations: await escalaCarregarFerias(),
    // O motor precisa enxergar os sábados vizinhos pra não repetir a pessoa
    // em dois sábados seguidos (Rafael, 25/08).
    scalesDoAno: EscalaSmartState.scales || [],
    nomePorId: escalaNomePorId(),
  };
  // Veio do 🔄 Refazer? Então o histórico diz "refeita", não "montada" — mesmo
  // critério de gerarPreviaLote, comparando contra o MESMO batchId.
  ctx.acaoHistorico = (EscalaSmartState.remontando === batchId) ? 'refeita' : 'consolidada';
  // Consolidar + PUBLICAR na mesma passada. Antes o lote só consolidava, e o
  // aviso mandava "Confira sua agenda" apontando pra uma tela vazia: as aulas só
  // nasciam se alguém abrisse cada sábado e clicasse "📅 Publicar na agenda", um
  // por um. Com 2 meses de sábados isso é garantia de esquecer. (Rafael, 14/08.)
  // publishToAgenda é idempotente e não recria slot de mês já fechado.
  let aulasCriadas = 0, vagasSemAula = 0;
  const falhas = [];
  for (const s of byBatch.data) {
    // Já veio montada da prévia? Então NÃO consolida de novo: reconsolidar
    // recalcularia tudo e apagaria as trocas que a gestão fez ao revisar —
    // justamente o que a prévia existe pra permitir.
    if (s.status !== 'consolidada') {
      await ScaleService.closeElection(s.id);
      const cons = await ScaleService.consolidate(s.id, ctx);
      if (!cons.success) { falhas.push(`${escalaFmtBR(s.date)} (consolidar)`); continue; }
    }
    const pub = await ScaleService.publishToAgenda(s.id);
    if (pub.success) {
      aulasCriadas += (pub.data && pub.data.created) || 0;
      // Vaga sem ninguém OU sem horário é PULADA em silêncio pelo publish. Numa
      // escala antiga (rascunho criado antes de configurar os horários do tipo)
      // isso reproduz de novo o "sábado não aparece na agenda", por outro motivo.
      vagasSemAula += ((pub.data && pub.data.vagasAbertas) || []).length;
    } else falhas.push(`${escalaFmtBR(s.date)} (publicar)`);
  }

  // Só avisa o time do que REALMENTE está na agenda. Avisar sobre data que
  // falhou é repetir o problema que este bloco corrige.
  const ok = byBatch.data.filter(s => !falhas.some(f => f.startsWith(escalaFmtBR(s.date))));
  const rec = await NotifyService.resolveActiveTeacherUserIds();

  // Aviso PERSONALIZADO pra quem foi escalado (Rodrigo, 24/08/2026: "eles devem
  // ser notificados"). Antes ia um recado igual pra academia inteira — "a escala
  // foi definida, confira sua agenda" — e quem foi escalado não era avisado
  // disso: tinha que abrir a agenda e procurar. Quem NÃO foi escalado recebia o
  // mesmo texto e ia procurar à toa.
  const meusDias = new Map();   // teacherId → ['sáb 05/09 · CP 08:00–12:00 (TOI)', ...]
  ok.forEach(s => {
    (s.slots || []).forEach(sl => {
      if (!sl.assignedPersonId) return;
      const uni = (EscalaSmartState.units.find(u => u.id === sl.unitId) || {});
      const uNome = (uni.name || sl.unitId || '').replace(/CrossTainer\s*/i, '') || sl.unitId;
      const mod = sl.requiredModalityName
        || (sl.requiredModalityId === (EscalaSmartState.modToi || {}).id ? 'TOI'
          : sl.requiredModalityId === (EscalaSmartState.modHiit || {}).id ? 'Hiit/Marombinha' : '');
      const hora = sl.startTime ? ` ${sl.startTime}–${sl.endTime || ''}` : '';
      const linha = `${escalaFmtBR(s.date)} · ${uNome}${hora}${mod ? ` (${mod})` : ''}`;
      if (!meusDias.has(sl.assignedPersonId)) meusDias.set(sl.assignedPersonId, []);
      meusDias.get(sl.assignedPersonId).push(linha);
    });
  });

  let avisados = 0;
  for (const [teacherId, linhas] of meusDias) {
    const t = EscalaSmartState.teacherMap.get(teacherId);
    if (!t || !t.userId) continue;   // sem login vinculado: a gestão avisa por fora
    // Remontagem não é escala nova: quem já foi avisado precisa saber que o
    // recado anterior caducou, senão aparece no sábado errado.
    const remontou = EscalaSmartState.remontando === batchId;
    await NotifyService.send({
      recipients: [t.userId], type: 'scale_confirmed',
      title: remontou
        ? 'A escala mudou — confira seus dias'
        : (linhas.length === 1 ? 'Você está escalado' : `Você está escalado em ${linhas.length} dias`),
      body: (remontou ? 'A escala foi refeita e o aviso anterior não vale mais. Seus dias agora são: ' : '')
        + linhas.join(' · ') + '. Já está na sua agenda.',
      link: { type: 'escala-smart', id: batchId }, channels: ['inapp'],
    });
    avisados++;
  }

  // Quem não entrou nesta janela também precisa saber — é o que evita a pergunta
  // "fui escalado?" e prepara o terreno pra próxima, onde eles vêm na frente.
  if (ok.length && rec.success && rec.data.length) {
    const escaladosUids = new Set(Array.from(meusDias.keys())
      .map(id => (EscalaSmartState.teacherMap.get(id) || {}).userId).filter(Boolean));
    const foraUids = rec.data.filter(uid => !escaladosUids.has(uid));
    const datas = ok.slice().sort((a, b) => (a.date > b.date ? 1 : -1)).map(s => escalaFmtBR(s.date)).join(', ');
    if (foraUids.length) {
      await NotifyService.send({
        recipients: foraUids, type: 'scale_confirmed',
        title: EscalaSmartState.remontando === batchId ? 'A escala mudou' : 'Escala definida',
        body: (EscalaSmartState.remontando === batchId
          ? `A escala de ${datas} foi refeita e você não entrou nesta janela — o aviso anterior não vale mais.`
          : `A escala de ${datas} foi definida e você não entrou nesta janela.`)
          + ' Na próxima você vem na frente.',
        link: { type: 'escala-smart', id: batchId }, channels: ['inapp'],
      });
    }
  }

  const sobra = vagasSemAula
    ? ` ⚠️ ${vagasSemAula} vaga(s) ficaram SEM aula (sem ninguém escalado ou sem horário configurado) — confira essas datas.`
    : '';
  if (falhas.length) {
    toast(`Confirmado com ${aulasCriadas} aula(s) na agenda, mas FALHOU em: ${falhas.join(', ')}. `
        + `Abra essas datas e publique na mão — quem depende delas não foi avisado.${sobra}`, 'error', 12000);
  } else if (vagasSemAula) {
    toast(`Escala confirmada, ${aulasCriadas} aula(s) na agenda e ${avisados} escalado(s) avisado(s).${sobra}`, 'error', 10000);
  } else {
    toast(`Escala confirmada, ${aulasCriadas} aula(s) na agenda e ${avisados} escalado(s) avisado(s) com o dia e a unidade.`, 'success', 6000);
  }
  EscalaSmartState.remontando = null;
  closeEscalaModal();
  renderEscalaGestao();
}

/**
 * Garante que a escala de sábado saiba se a data é feriado, antes de publicar.
 *
 * Escalas criadas antes de 25/08/2026 não têm o campo; publicar sem ele faria
 * a aula nascer com peso de sábado num dia que paga em dobro. Só grava quando
 * a data realmente é feriado e o campo ainda não existe — não desfaz escolha
 * de ninguém.
 */
async function escalaGarantirFeriadoNaData(scaleId) {
  // Do banco, não da memória: se o estado estiver velho a escala pode nem ser
  // encontrada, e aí a etiqueta não seria gravada — pagando errado em silêncio.
  const atual = await ScaleService.getScale(scaleId);
  const scale = (atual && atual.success) ? atual.data : EscalaSmartState.scales.find(s => s.id === scaleId);
  if (!scale || scale.tipo !== 'sabado' || scale.feriadoNaData) return;
  const ano = Number(String(scale.date).slice(0, 4));
  if (!EscalaSmartState.feriadosByYear[ano]) await escalaLoadFeriados(ano);
  const nome = escalaFeriadoPorData(ano).get(scale.date);
  if (!nome) return;
  const res = await ScaleService.updateScale(scaleId, { feriadoNaData: nome });
  if (res && res.success !== false) scale.feriadoNaData = nome;
}

async function publicarEscala(id) {
  if (!confirm('Publicar a escala como aulas na agenda?')) return;
  toast('Publicando…', 'info');
  // Escala de sábado criada ANTES da correção de 25/08 não guarda o feriado da
  // data. Sem isto ela seguiria publicando aula com peso de sábado num dia que
  // paga em dobro — e o erro só apareceria no fechamento.
  await escalaGarantirFeriadoNaData(id);
  const res = await ScaleService.publishToAgenda(id);
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); return; }
  let msg = `${res.data.created} aula(s) publicada(s).`;
  if (res.data.vagasAbertas && res.data.vagasAbertas.length) msg += ` ${res.data.vagasAbertas.length} vaga(s) aberta(s) sem aula.`;
  toast(msg, 'success');
  renderEscalaGestao();
}

async function despublicarEscala(id) {
  // O botão só perguntava "remover as aulas?" — não dizia que quem já recebeu
  // o aviso continua achando que trabalha (Rodrigo, 25/08).
  if (!confirm('Despublicar remove da agenda as aulas desta escala.\n\n'
             + '⚠️ Quem já recebeu o aviso NÃO é desavisado — continua achando que trabalha. '
             + 'Se for o caso, fale com as pessoas.\n\n'
             + 'A escala em si continua montada; dá pra publicar de novo depois. '
             + 'Aula de mês já fechado não é removida.\n\nContinuar?')) return;
  const res = await ScaleService.unpublishFromAgenda(id);
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); return; }
  toast('Escala despublicada.', 'success');
  renderEscalaGestao();
}

// Pedido 7 do Rodrigo (28/08/2026): tirar uma data do lote — nasceu de 02/11
// e 20/11, consolidadas fora de qualquer janela, com gente escalada numa
// escala que ninguém abriu. `removeFromBatch` é destrutivo (limpa as vagas e,
// se publicada, tira as aulas da agenda antes) — por isso só aparece pra data
// que ainda não aconteceu (guard em `renderEscalaDetail`) e o `confirm()`
// avisa sobre quem já foi notificado.
async function tirarDoLote(scaleId) {
  const scale = EscalaSmartState.scales.find(s => s.id === scaleId) || {};
  const escalados = (scale.slots || []).filter(s => s.assignedPersonId).length;
  if (!confirm(`Tirar ${ScaleService.fmtDataLonga(scale.date)} do lote?\n\n`
    + `As ${escalados} vaga(s) são limpas, a data volta para rascunho e sai da janela.\n`
    + (scale.published ? `\n⚠️ Ela está PUBLICADA: as aulas saem da agenda agora. Quem já foi avisado NÃO é desavisado — fale com as pessoas.\n` : '')
    + `\nEla volta a existir quando você abrir uma janela nova que a inclua.\n\nContinuar?`)) return;
  const res = await ScaleService.removeFromBatch(scaleId);
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error', 9000); return; }
  toast('Data tirada do lote e zerada.', 'success');
  await escalaLoadBase();
  renderEscalaGestao();
}

/* ─── COLABORADOR (preferências) ───────────────────────────────────── */
async function renderEscalaPrefs() {
  const container = document.getElementById('page-escala-smart');
  if (!container) return;
  container.innerHTML = `<div class="page-hdr"><h1>🗓️ Escala — minhas datas${ajudaBtn("escala-smart")}</h1><p>Candidate-se onde a janela estiver aberta; consulte onde você está escalado.</p></div>
    <div class="loading"><div class="spinner"></div> Carregando…</div>`;

  const pid = escalaProfId();
  const [scalesRes, teachersRes] = await Promise.all([ScaleService.listScales(), TeacherService.list()]);
  EscalaSmartState.scales = scalesRes.success ? scalesRes.data : [];
  EscalaSmartState.teacherMap = new Map((teachersRes.success ? teachersRes.data : []).map(t => [t.id, t]));
  // A aba Sábados também precisa dos feriados: sábado que é feriado paga em
  // dobro, e a gestão tem que ver isso ANTES de montar a escala.
  if (EscalaSmartState.tab === 'feriado' || EscalaSmartState.tab === 'sabado') {
    await escalaLoadFeriados(EscalaSmartState.year);
  }

  // Quantos dias ele já disse que quer nesta janela (pra o select vir marcado).
  EscalaSmartState._minhaCota = undefined;
  const batchAberto = (EscalaSmartState.scales.find(s => s.status === 'janela_aberta' && s.windowBatchId) || {}).windowBatchId;
  if (batchAberto && pid) {
    const q = await ScaleService.listWindowQuotas(batchAberto);
    if (q.success && Object.prototype.hasOwnProperty.call(q.data, pid)) EscalaSmartState._minhaCota = q.data[pid];
  }

  const tab = EscalaSmartState.tab;
  const tabsHtml = `<div class="escala-tabs">` +
    ESCALA_TABS.map(t =>
      `<button class="escala-tab${t.id === tab ? ' active' : ''}" onclick="escalaSetTab('${t.id}')">${t.label}</button>`
    ).join('') + `</div>`;

  let body;
  if (tab === 'sabado' || tab === 'feriado') body = await renderProfSabadosFeriados(pid, tab);
  else if (tab === 'fim_de_ano')                body = await renderProfFimDeAno(pid);
  else if (tab === 'evento')                    body = await renderProfEventos();
  else                                          body = renderProfEscolaInterna(pid);

  container.innerHTML = `<div class="page-hdr"><h1>🗓️ Escala — minhas datas${ajudaBtn("escala-smart")}</h1><p>Candidate-se onde a janela estiver aberta; consulte onde você está escalado.</p></div>
    ${tabsHtml}
    ${body}`;
}

async function renderProfSabadosFeriados(pid, tab) {
  const tipos = tab === 'sabado' ? ['sabado'] : ['feriado', 'domingo_especial'];
  let escalas = EscalaSmartState.scales.filter(s => tipos.includes(s.tipo));
  escalas = ScaleService.filterByTimeframe(escalas, escalaTodayISO(), EscalaSmartState.timeframe);
  if (!escalas.length) return `<p style="padding:20px;color:var(--text2);">Nenhuma data ${tab === 'sabado' ? 'de sábado' : 'de feriado'} ${EscalaSmartState.timeframe === 'futuros' ? 'próxima' : ''}.</p>`;

  // atalho "Pode ser em todas" quando há janela aberta na aba (reusa marcarPodeSerTodas, que já existe/exportado)
  const temAberta = escalas.some(s => s.status === 'janela_aberta');
  // "Quantos desses dias você quer trabalhar?" — pedido do Rodrigo em
  // 24/08/2026: "tem gente que precisa de mais, e tem gente que de menos".
  // Fica junto do atalho porque é a mesma pergunta, no mesmo momento: a pessoa
  // diz em quais dias pode E quantos deles quer.
  const abertasAqui = escalas.filter(s => s.status === 'janela_aberta');
  const batchAqui = (abertasAqui.find(s => s.windowBatchId) || {}).windowBatchId || null;
  const cotaAtual = EscalaSmartState._minhaCota;
  const opcoesCota = ['<option value="">Sem preferência</option>']
    .concat(Array.from({ length: abertasAqui.length + 1 }, (_, n) =>
      `<option value="${n}" ${String(cotaAtual) === String(n) ? 'selected' : ''}>${n === 0 ? 'Nenhum' : n === 1 ? '1 dia' : `${n} dias`}</option>`))
    .join('');
  const cotaHtml = (temAberta && batchAqui)
    ? `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:12px;">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px;">Quantos desses ${abertasAqui.length} dias você quer trabalhar?</div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:8px;">Serve pra dividir melhor: quem quer mais pega mais, quem quer menos não fica sobrecarregado. Não é promessa — se faltar gente, você ainda pode ser escalado.</div>
        <select class="input" style="max-width:220px;" onchange="salvarMinhaCota('${batchAqui}', this.value)">${opcoesCota}</select>
      </div>` : '';

  const atalho = temAberta
    ? `${cotaHtml}<div style="padding:0 0 12px;"><button onclick="marcarPodeSerTodas()" style="font-size:13px;padding:8px 14px;border-radius:8px;cursor:pointer;background:rgba(94,168,255,0.15);color:#5EA8FF;border:1px solid #5EA8FF;">✓ Marcar "Pode ser" em todas as janelas abertas</button></div>`
    : '';

  // preferências atuais do professor nas janelas abertas
  const nowISO = ScaleService.nowLocalMinute();
  const prefByScale = {};
  for (const s of escalas) {
    if (s.status === 'janela_aberta') {
      const pr = await ScaleService.listPreferences(s.id);
      const mine = (pr.success ? pr.data : []).find(p => p.personId === pid);
      prefByScale[s.id] = mine ? mine.pref : null;
    }
  }
  const pbtn = (sid, pref, label, color) => {
    const active = prefByScale[sid] === pref;
    const style = active ? `background:${color};color:#0a0a0a;border:1px solid ${color};font-weight:600;` : `background:transparent;color:var(--text2);border:1px solid var(--border);`;
    return `<button onclick="marcarPref('${sid}','${pref}')" style="font-size:13px;padding:7px 12px;border-radius:8px;cursor:pointer;${style}">${label}</button>`;
  };
  return atalho + escalas.map(s => {
    const open = ScaleService.isWindowOpen(s, nowISO);
    let right;
    if (s.status === 'janela_aberta') {
      const prazo = s.windowClosesAt ? `Fecha em ${escalaFmtBR(s.windowClosesAt.slice(0, 10))}` : 'Sem prazo';
      right = open
        ? `<div style="display:flex;gap:6px;">${pbtn(s.id, 'prefiro', 'Prefiro', 'var(--green)')}${pbtn(s.id, 'pode_ser', 'Pode ser', '#5EA8FF')}${pbtn(s.id, 'nao_posso', 'Não posso', 'var(--red)')}</div>`
        : `<span style="font-size:12px;color:var(--red);">Janela encerrada</span>`;
      return profDateRow(s, `${ScaleService.fmtDataLonga(s.date)}${escalaHorario(s) ? ` · 🕗 ${escalaHorario(s)}` : ''} · ${prazo}`, right);
    }
    // ANTES da eleição acontecer, "Não escalado" MENTE: o professor lê como "não
    // fui escolhido" quando a verdade é "ainda nem começou". Pior, ao lado vinha
    // a palavra "Rascunho", que é vocabulário nosso e não diz nada pra ele.
    // Relato real no grupo (14/08/2026): "qnd vou em minha agenda não tem sábado,
    // qnd vou em escala aparece sábado (15/08) - não escalado".
    //
    // E consolidada NÃO é o mesmo que valendo: a prévia (24/08) grava
    // 'consolidada' e PARA, de propósito, pra gestão conferir e ajustar antes de
    // publicar. Liberar a vista aí é contar pro time uma escala que ainda vai
    // mudar — foi o que o Rodrigo pediu pra fechar em 25/08. Quem manda é a
    // publicação. O e-mail já obedecia isso; só a tela é que vazava.
    if (!s.published) {
      const texto = s.status === 'consolidada'
        ? 'A gestão está montando a escala'
        : 'A gestão ainda não abriu as candidaturas';
      return profDateRow(
        s,
        `${ScaleService.fmtDataLonga(s.date)}${escalaHorario(s) ? ` · 🕗 ${escalaHorario(s)}` : ''} · Ainda não liberado`,
        `<span style="font-size:12px;color:var(--text3);">${texto}</span>`
      );
    }
    const escalado = ScaleService.isPersonAssigned(s, pid);
    right = escalado
      ? `<span style="font-size:12px;color:var(--green);font-weight:600;">✓ Você está escalado</span>`
      : `<span style="font-size:12px;color:var(--text3);">Não escalado desta vez</span>`;
    return profDateRow(s, `${ScaleService.fmtDataLonga(s.date)}${escalaHorario(s) ? ` · 🕗 ${escalaHorario(s)}` : ''} · Escala definida`, right);
  }).join('');
}

function profDateRow(s, sub, right) {
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;flex-wrap:wrap;">
    <div><div style="font-weight:600;font-size:14px;">${s.name || ScaleService.fmtDataLonga(s.date)}</div><div style="font-size:12px;color:var(--text2);">${sub}</div></div>
    ${right}
  </div>`;
}

async function renderProfFimDeAno(pid) {
  const escalas = EscalaSmartState.scales.filter(s => s.tipo === 'fim_de_ano');
  if (!escalas.length) return `<p style="padding:20px;color:var(--text2);">Nenhum período de fim de ano.</p>`;
  const nowISO = ScaleService.nowLocalMinute();
  let html = '';
  for (const s of escalas) {
    const open = ScaleService.isWindowOpen(s, nowISO);
    const dias = [...new Set((s.slots || []).map(sl => sl.day))].sort();
    const shiftsByDay = {};
    dias.forEach(day => { shiftsByDay[day] = [...new Set((s.slots || []).filter(sl => sl.day === day).map(sl => sl.shift))]; });
    const dpRes = await ScaleService.listDayPreferences(s.id);
    const mine = {};
    (dpRes.success ? dpRes.data : []).filter(p => p.personId === pid).forEach(p => { mine[p.date] = p; });

    const cabecalho = `<div style="font-weight:600;margin:4px 0 8px;">${s.name || ScaleService.fmtDataLonga(s.date)}${open ? '' : ` · <span style="color:var(--red);font-size:12px;">janela encerrada</span>`}</div>`;
    const diasHtml = dias.map(day => {
      const cur = mine[day] || { pref: null, excludedShifts: [] };
      const shifts = shiftsByDay[day];
      const shiftLabel = (sid) => sid === 'manha' ? 'Manhã' : (sid === 'tarde_noite' ? 'Tarde/Noite' : sid);
      const pbtn = (pref, label, color) => {
        const active = cur.pref === pref;
        const style = active ? `background:${color};color:#0a0a0a;border:1px solid ${color};font-weight:600;` : `background:transparent;color:var(--text2);border:1px solid var(--border);`;
        return `<button ${open ? '' : 'disabled'} onclick="marcarDiaFdA('${s.id}','${day}','${pref}')" style="font-size:12px;padding:6px 10px;border-radius:8px;cursor:${open ? 'pointer' : 'not-allowed'};opacity:${open ? 1 : 0.5};${style}">${label}</button>`;
      };
      const turnos = (cur.pref && cur.pref !== 'nao_posso')
        ? shifts.map(sh => {
            const excl = (cur.excludedShifts || []).includes(sh);
            return `<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;margin-right:10px;color:${excl ? 'var(--text3)' : 'var(--text2)'};"><input type="checkbox" ${excl ? '' : 'checked'} ${open ? '' : 'disabled'} onchange="toggleTurnoFdA('${s.id}','${day}','${sh}')"> ${shiftLabel(sh)}</label>`;
          }).join('')
        : '';
      return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:6px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <span style="font-weight:600;font-size:13px;">${escalaFmtBR(day)}</span>
          <div style="display:flex;gap:6px;">${pbtn('prefiro', 'Prefiro', 'var(--green)')}${pbtn('pode_ser', 'Pode ser', '#5EA8FF')}${pbtn('nao_posso', 'Não posso', 'var(--red)')}</div>
        </div>
        ${turnos ? `<div style="margin-top:8px;">${turnos}</div>` : ''}
      </div>`;
    }).join('');
    html += cabecalho + diasHtml;
  }
  return html;
}

// Marca a preferência do DIA no fim de ano (preserva os turnos excluídos já marcados).
async function marcarDiaFdA(scaleId, date, pref) {
  const pid = escalaProfId();
  if (!pid) { toast('Seu perfil não está vinculado a um professor.', 'error'); return; }
  const dpRes = await ScaleService.listDayPreferences(scaleId);
  const cur = (dpRes.success ? dpRes.data : []).find(p => p.personId === pid && p.date === date);
  const excluded = pref === 'nao_posso' ? [] : (cur ? cur.excludedShifts || [] : []);
  const res = await ScaleService.setDayPreference(scaleId, pid, date, pref, excluded);
  if (res.success) { toast('Preferência registrada!', 'success'); renderEscalaPrefs(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}

// Liga/desliga um turno do dia (só quando já há Prefiro/Pode ser marcado).
async function toggleTurnoFdA(scaleId, date, shift) {
  const pid = escalaProfId();
  if (!pid) return;
  const dpRes = await ScaleService.listDayPreferences(scaleId);
  const cur = (dpRes.success ? dpRes.data : []).find(p => p.personId === pid && p.date === date);
  if (!cur || !cur.pref) { toast('Marque Prefiro/Pode ser antes de ajustar o turno.', 'info'); return; }
  const set = new Set(cur.excludedShifts || []);
  if (set.has(shift)) set.delete(shift); else set.add(shift);
  const res = await ScaleService.setDayPreference(scaleId, pid, date, cur.pref, Array.from(set));
  if (res.success) renderEscalaPrefs();
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}

// Eventos na visão do professor: acionável (RSVP Vou/Não vou para quem foi convidado/staff).
async function renderProfEventos() {
  const pid = escalaProfId();
  let docs = EscalaSmartState.scales.filter(s => s.tipo === 'evento');
  docs = ScaleService.filterByTimeframe(docs, escalaTodayISO(), EscalaSmartState.timeframe);
  if (!docs.length) return `<p style="padding:20px;color:var(--text2);">Nenhum evento ${EscalaSmartState.timeframe === 'futuros' ? 'próximo' : ''}.</p>`;
  const parts = [];
  for (const s of docs) {
    const rr = await ScaleService.listEventRsvp(s.id);
    const mine = (rr.success ? rr.data : []).find(r => r.personId === pid);
    const kind = s.eventKind === 'externo' ? 'Externo' : 'Interno';
    let right;
    if (mine) {
      const rbtn = (val, label, color) => {
        const active = mine.going === val;
        const style = active ? `background:${color};color:#0a0a0a;border:1px solid ${color};font-weight:600;` : `background:transparent;color:var(--text2);border:1px solid var(--border);`;
        return `<button onclick="responderEvento('${s.id}',${val})" style="font-size:13px;padding:7px 12px;border-radius:8px;cursor:pointer;${style}">${label}</button>`;
      };
      right = `<div style="display:flex;gap:6px;">${rbtn(true, 'Vou', 'var(--green)')}${rbtn(false, 'Não vou', 'var(--red)')}</div>`;
    } else {
      right = `<span style="font-size:12px;color:var(--text3);">informativo</span>`;
    }
    parts.push(`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;flex-wrap:wrap;">
      <div><div style="font-weight:600;font-size:14px;">${s.name || ScaleService.fmtDataLonga(s.date)}</div><div style="font-size:12px;color:var(--text2);">${escalaFmtBR(s.date)} · ${kind}${mine && mine.tier === 'obrigatorio' ? ' · você deve participar' : (mine ? ' · você poderia participar' : '')}</div></div>
      ${right}
    </div>`);
  }
  return parts.join('');
}

async function responderEvento(scaleId, going) {
  const pid = escalaProfId();
  if (!pid) { toast('Seu perfil não está vinculado a um professor.', 'error'); return; }
  const res = await ScaleService.setRsvp(scaleId, pid, going);
  if (res.success) { toast(going ? 'Presença confirmada!' : 'Ok, marcado como não vou.', 'success'); renderEscalaPrefs(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}

// Escola Interna na visão do professor: read-only, destaca onde ele é o líder escalado.
function renderProfEscolaInterna(pid) {
  let docs = EscalaSmartState.scales.filter(s => s.tipo === 'escola_interna');
  docs = ScaleService.filterByTimeframe(docs, escalaTodayISO(), EscalaSmartState.timeframe);
  if (!docs.length) return `<p style="padding:20px;color:var(--text2);">Nenhuma sessão de Escola Interna ${EscalaSmartState.timeframe === 'futuros' ? 'próxima' : ''}.</p>`;
  return docs.map(s => {
    const souLider = (s.slots || []).some(sl => sl.role === 'lider' && sl.assignedPersonId === pid);
    const right = souLider
      ? `<span style="font-size:12px;color:#caa23a;font-weight:600;">★ Você lidera</span>`
      : `<span style="font-size:12px;color:var(--text3);">—</span>`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;">
      <div><div style="font-weight:600;font-size:14px;">${s.name || ScaleService.fmtDataLonga(s.date)}</div><div style="font-size:12px;color:var(--text2);">${escalaFmtBR(s.date)}</div></div>
      ${right}
    </div>`;
  }).join('');
}

async function marcarPodeSerTodas() {
  const pid = escalaProfId();
  if (!pid) { toast('Seu perfil não está vinculado a um professor.', 'error'); return; }
  const scalesRes = await ScaleService.listScales();
  const abertas = (scalesRes.success ? scalesRes.data : []).filter(s => s.status === 'janela_aberta');
  if (!abertas.length) { toast('Nenhuma janela aberta.', 'info'); return; }
  for (const s of abertas) { await ScaleService.setPreference(s.id, pid, 'pode_ser'); }
  toast(`"Pode ser" marcado em ${abertas.length} escala(s).`, 'success');
  renderEscalaPrefs();
}

/** Professor diz quantos dias da janela quer trabalhar. Vazio = sem preferência. */
async function salvarMinhaCota(batchId, valor) {
  const pid = escalaProfId();
  if (!pid) { toast('Seu perfil não está vinculado a um professor.', 'error'); return; }
  const n = valor === '' ? null : Number(valor);
  const res = await ScaleService.setWindowQuota(batchId, pid, n);
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); return; }
  EscalaSmartState._minhaCota = n;
  toast(n === null ? 'Sem preferência de quantidade.'
      : n === 0 ? 'Anotado: você prefere não pegar nenhum desses dias.'
      : `Anotado: você quer ${n} dia(s) nesta janela.`, 'success', 5000);
}

async function marcarPref(scaleId, pref) {
  const pid = escalaProfId();
  if (!pid) { toast('Seu perfil não está vinculado a um professor.', 'error'); return; }
  const res = await ScaleService.setPreference(scaleId, pid, pref);
  if (res.success) { toast('Preferência registrada!', 'success'); renderEscalaPrefs(); }
  else toast('Erro: ' + (res.error || 'falha'), 'error');
}

// Expor globalmente (chamadas via navigateTo / onclick)
window.renderEscalaSmartPage = renderEscalaSmartPage;
window.openNovaEscalaFimDeAno = openNovaEscalaFimDeAno;
window.criarEscalaFimDeAno = criarEscalaFimDeAno;
window.closeEscalaModal = closeEscalaModal;
window.criarEscalaData = criarEscalaData;
window.openDataEspecial = openDataEspecial;
window.criarDataEspecial = criarDataEspecial;
window.openNovoEvento = openNovoEvento;
window.criarNovoEvento = criarNovoEvento;
window.escalaSetTab = escalaSetTab;
window.escalaSetYear = escalaSetYear;
window.escalaSetTimeframe = escalaSetTimeframe;
window.selectEscala = selectEscala;
window.abrirJanelaEscala = abrirJanelaEscala;
window.escalaToggleSel = escalaToggleSel;
window.escalaLimparSel = escalaLimparSel;
window.openAbrirLote = openAbrirLote;
window.confirmarAbrirJanela = confirmarAbrirJanela;
window.consolidarEscala = consolidarEscala;
window.abrirRevisaoLote = abrirRevisaoLote;
window.confirmarEAvisar = confirmarEAvisar;
window.publicarEscala = publicarEscala;
window.despublicarEscala = despublicarEscala;
window.marcarPref = marcarPref;
window.responderEvento = responderEvento;
window.marcarPodeSerTodas = marcarPodeSerTodas;
window.salvarMinhaCota = salvarMinhaCota;
window.gerarPreviaLote = gerarPreviaLote;
window.marcarDiaFdA = marcarDiaFdA;
window.toggleTurnoFdA = toggleTurnoFdA;
window.renderTabEscolaInterna = renderTabEscolaInterna;
window.openNovaEscolaInterna = openNovaEscolaInterna;
window.criarEscolaInterna = criarEscolaInterna;
window.atribuirLider = atribuirLider;
window.trocarPessoaEscala = trocarPessoaEscala;
window.inverterVagasEscala = inverterVagasEscala;
window.refazerJanela = refazerJanela;
window.escalaSetPessoa = escalaSetPessoa;
window.renderTabPorPessoa = renderTabPorPessoa;
window.escalaJanelasPorTipo = escalaJanelasPorTipo;
window.salvarStaffEvento = salvarStaffEvento;
window.abrirAjusteFrequencia = abrirAjusteFrequencia;
window.aplicarAjusteFrequencia = aplicarAjusteFrequencia;

console.log('[CrossTainer Professores] professores-escala-smart.js carregado · Escala Inteligente (5b)');
