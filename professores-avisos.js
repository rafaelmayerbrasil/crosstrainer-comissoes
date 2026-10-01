// ═══════════════════════════════════════════════════════════════════════
// professores-avisos.js — Avisos dos professores (tela da gestão)
//
// O professor avisa pela janela da aula: "a aula não aconteceu" ou "cheguei
// atrasado / saí antes / fiquei além". O botão diz "Enviar para a gestão" —
// mas até 01/10/2026 a gestão não era avisada e não tinha onde ver: o aviso só
// aparecia abrindo aula por aula. Em produção, 21 ficaram parados de 26/08 a
// 01/10, nenhum atendido. É o mesmo defeito da caixa de substituições e das
// trocas paradas: a pessoa faz a parte dela e a informação morre.
//
// Aqui a gestão vê todos de uma vez e responde num clique. As regras (quais
// respostas cabem, o que cada uma grava) moram em class-avisos.js.
// ═══════════════════════════════════════════════════════════════════════

const AvisosState = { lista: [], erro: null };

function avisosEhGestao() {
  return (typeof isAdminGestao === 'function' && isAdminGestao())
      || (typeof isSupervisao === 'function' && isSupervisao());
}

function avisosNomeProf(id) {
  const t = AgendaState.teachersMap.get(id);
  return t ? (t.name || '—') : '—';
}

/** "qua, 09/09 · 07:00–08:00" */
function avisosQuando(cls) {
  const d = cls.scheduledDate && cls.scheduledDate.toDate ? cls.scheduledDate.toDate() : null;
  const dia = d ? d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }) : '—';
  return `${dia}${cls.startTime ? ` · ${cls.startTime}${cls.endTime ? '–' + cls.endTime : ''}` : ''}`;
}

function avisosOnde(cls) {
  const m = AgendaState.modalitiesMap.get(cls.modalityId);
  const u = (AgendaState.units || []).find(x => x.id === cls.unitId);
  return [m ? m.name : null, u ? (u.name || '').replace(/CrossTainer\s*/i, '') : null].filter(Boolean).join(' · ');
}

// ────────────────────────────────────────────────────────────────────────
// Entry point — professores.js → navigateTo('avisos-professores')
// ────────────────────────────────────────────────────────────────────────
async function renderAvisosProfessoresPage() {
  const page = document.getElementById('page-avisos-professores');
  if (!page) return;
  const topo = `<div class="page-toolbar"><div class="lhs"><h2>AVISOS DOS PROFESSORES</h2></div></div>`;

  if (!avisosEhGestao()) {
    page.innerHTML = topo + `<div class="empty-state"><div class="icon">🔒</div><h3>Tela da gestão</h3>
      <p>Aqui a gestão responde ao que os professores avisam sobre as aulas.</p></div>`;
    return;
  }
  page.innerHTML = topo + `<div class="loading"><div class="spinner"></div> Carregando…</div>`;

  // Nomes de professor, modalidade e unidade — sem isso a lista mostra ID cru.
  if (AgendaState.modalitiesMap.size === 0 || AgendaState.teachersMap.size === 0 || !(AgendaState.units || []).length) {
    const [mods, profs, unis] = await Promise.all([ModalityService.list(), TeacherService.list(),
      (typeof UnitService === 'object' && UnitService.list) ? UnitService.list() : Promise.resolve({ data: [] })]);
    if (AgendaState.modalitiesMap.size === 0) AgendaState.modalitiesMap = new Map((mods.data || []).map(m => [m.id, m]));
    if (AgendaState.teachersMap.size === 0) AgendaState.teachersMap = new Map((profs.data || []).map(t => [t.id, t]));
    if (!(AgendaState.units || []).length) AgendaState.units = unis.data || [];
  }

  const res = await ClassService.listAvisosPendentes();
  if (!res.success) {
    AvisosState.lista = []; AvisosState.erro = res.error || 'erro desconhecido';
    page.innerHTML = topo + `<div class="empty-state"><div class="icon">⚠️</div><h3>Erro ao carregar</h3>
      <p>${escapeHtml(AvisosState.erro)}</p>
      <button class="btn btn-outline" onclick="renderAvisosProfessoresPage()">Tentar novamente</button></div>`;
    return;
  }
  // Reordena aqui também: o mais antigo em cima é o que mais segura o fechamento,
  // e a tela não deve depender de quem entregou a lista já ter ordenado.
  AvisosState.lista = ClassAvisos.pendentes(res.data || []); AvisosState.erro = null;
  const n = AvisosState.lista.length;

  if (!n) {
    page.innerHTML = topo + `<div class="empty-state"><div class="icon">✅</div><h3>Nenhum aviso esperando resposta</h3>
      <p>Quando um professor avisar que a aula não aconteceu, ou que chegou atrasado, saiu antes ou ficou além do horário, aparece aqui.</p></div>`;
    return;
  }

  page.innerHTML = topo + `
    <div class="info-callout" style="margin-bottom:12px;">
      <strong>${n} ${n === 1 ? 'aviso esperando' : 'avisos esperando'} a sua resposta.</strong>
      O que o professor avisa <strong>não entra na folha sozinho</strong>: só vale depois que você responde aqui.
      Aviso sem resposta trava o fechamento do mês da aula.
    </div>
    <div class="minha-agenda-list">${AvisosState.lista.map(renderAvisoCard).join('')}</div>`;
}

function renderAvisoCard(cls) {
  const av = cls.avisoProfessor;
  const naoAconteceu = av.tipo === 'nao_aconteceu';
  const quandoAvisou = av.em && av.em.toDate ? av.em.toDate().toLocaleDateString('pt-BR') : '';
  // A resposta que só confirma o que o professor disse é o botão principal;
  // as que contrariam ou tiram dinheiro ficam em contorno.
  const principal = { aceitar: true, cancelar: true };
  const botoes = ClassAvisos.decisoesDe(av).map(d => {
    const rotulo = (d === 'dispensar' && naoAconteceu) ? 'A aula aconteceu' : ClassAvisos.ROTULOS[d];
    return `<button class="btn ${principal[d] ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="avisoDecidir('${cls.id}','${d}')">${escapeHtml(rotulo)}</button>`;
  }).join('');
  return `
    <div class="class-card" style="border-left:3px solid var(--orange);cursor:default;">
      <div class="class-card-time" style="min-width:140px;">${escapeHtml(avisosQuando(cls))}</div>
      <div class="class-card-info">
        <div class="class-card-modality"><b>${escapeHtml(avisosNomeProf(cls.teacherId))}</b> ${escapeHtml(ClassAvisos.resumo(av))}</div>
        <div class="class-card-unit">
          ${escapeHtml(avisosOnde(cls))}${av.nota ? ` · "${escapeHtml(av.nota)}"` : ''}${quandoAvisou ? ` · avisou em ${quandoAvisou}` : ''}
        </div>
      </div>
      <div class="class-card-status">
        <div class="inbox-item-actions" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">${botoes}</div>
      </div>
    </div>`;
}

/**
 * A gestão responde a um aviso. Resposta que tira a aula da folha pede
 * confirmação; dispensar pede o motivo, porque contraria o que o professor
 * disse e ele vai ser avisado disso.
 */
async function avisoDecidir(classId, decisao) {
  const cls = (AvisosState.lista || []).find(c => c.id === classId);
  if (!cls) { toast('Aviso não encontrado — atualize a tela.', 'error'); return; }
  const nome = avisosNomeProf(cls.teacherId);
  const onde = avisosQuando(cls);
  let nota = '';

  if (decisao === 'dispensar') {
    const motivo = prompt(`Dispensar o aviso de ${nome} (${onde})?\n\nA aula fica como está e o professor é avisado. Motivo (opcional):`);
    if (motivo === null) return;
    nota = motivo.trim();
  } else if (decisao !== 'aceitar') {
    const oQue = decisao === 'cancelar' ? 'cancelada (não aconteceu, sem falta)'
      : decisao === 'falta_justificada' ? 'falta avisada' : 'falta sem aviso';
    if (!confirm(`Registrar a aula de ${nome} (${onde}) como ${oQue}?\n\nEla sai da conta de horas do professor.`)) return;
  }

  const res = await ClassService.atenderAviso(classId, decisao, nota);
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); return; }

  // O professor fica sabendo da resposta — senão ele só descobriria no recibo.
  const t = AgendaState.teachersMap.get(cls.teacherId);
  let avisado = false;
  if (t && t.userId && typeof NotifyService === 'object') {
    const r = await NotifyService.send({
      recipients: [t.userId], type: 'class_aviso_respondido', title: 'A gestão respondeu ao seu aviso',
      body: ClassAvisos.respostaParaOProfessor(cls.avisoProfessor, decisao, onde),
      link: { type: 'class', id: classId }, channels: ['inapp'],
    });
    avisado = !!(r && r.success);
  }
  toast(`Resposta gravada${avisado ? ' e o professor foi avisado' : ''}.`, 'success');
  await renderAvisosProfessoresPage();
}

window.renderAvisosProfessoresPage = renderAvisosProfessoresPage;
window.avisoDecidir = avisoDecidir;

console.log('[CrossTainer Professores] professores-avisos.js carregado · avisos dos professores');
