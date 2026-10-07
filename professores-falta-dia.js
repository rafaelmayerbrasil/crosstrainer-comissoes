// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Falta do dia (a janela da gestão)
//
// A gestão escolhe a pessoa e o dia, vê todas as aulas dela (nas duas
// unidades) já marcadas como falta, desmarca as que a pessoa deu, diz qual um
// colega deu no lugar, e lança tudo de uma vez. As regras estão em
// falta-do-dia.js; aqui é só a tela e a gravação.
//
// Nada novo no banco: a falta usa ClassService.updateStatus (o mesmo da janela
// da aula) e a aula dada por um colega usa a troca de professor de sempre
// (SubstitutionService.create + homologar).
// ═══════════════════════════════════════════════════════════════════════

const FaltaDiaState = {
  dia: null,            // 'AAAA-MM-DD'
  teacherId: '',
  classes: [],          // todas as aulas do dia, de todo mundo (para o choque de horário do colega)
  subsAbertas: [],
  itens: [],
  escolhas: {},         // { classId: { tipo, colegaId } }
  faltaTipo: '',
  nota: '',
  carregando: false,
  salvando: false,
  erro: '',
};

function faltaDiaEhGestao() {
  return (typeof isAdminGestao === 'function' && isAdminGestao())
      || (typeof isSupervisao === 'function' && isSupervisao());
}

/** O relógio da tela — separado para o teste poder fixar a hora. */
let faltaDiaAgora = () => new Date();
/** A pausa entre as conferências de "a Function já moveu a aula?". */
let faltaDiaEsperar = (ms) => new Promise(r => setTimeout(r, ms));

function faltaDiaISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function faltaDiaNome(id) {
  const t = AgendaState.teachersMap.get(id);
  return (t && t.name) || '—';
}

function faltaDiaUnidade(id) {
  const u = (AgendaState.units || []).find(x => x.id === id);
  return String((u && u.name) || id || '').replace(/^CrossTainer\s*/i, '');
}

function faltaDiaModalidade(c) {
  if (typeof classDisplayName === 'function') return classDisplayName(c) || '';
  const m = AgendaState.modalitiesMap.get(c.modalityId);
  return (m && m.name) || '';
}

/**
 * Abre a janela. Sem argumentos, parte do que a Agenda Geral está mostrando
 * (o dia do modo "Dia" e o professor do filtro); a janela da aula passa a
 * pessoa e o dia daquela aula.
 * @param {{teacherId?: string, dia?: string}} [opts]
 */
async function abrirFaltaDoDia(opts) {
  if (!faltaDiaEhGestao()) return;
  const o = opts || {};
  const S = FaltaDiaState;
  const ag = (typeof AgendaGeralState === 'object' && AgendaGeralState) || {};

  S.dia = o.dia || (ag.viewMode === 'day' && ag.selectedDate ? faltaDiaISO(ag.selectedDate) : faltaDiaISO(faltaDiaAgora()));
  S.teacherId = o.teacherId || ag.teacherId || '';
  S.faltaTipo = '';
  S.nota = '';
  S.erro = '';
  S.salvando = false;

  if (typeof closeClassModal === 'function') closeClassModal();
  const modal = document.getElementById('faltaDiaModal');
  if (modal) modal.classList.add('open');
  await faltaDiaCarregar();
}

function fecharFaltaDoDia() {
  const modal = document.getElementById('faltaDiaModal');
  if (modal) modal.classList.remove('open');
}

/** Atalho da janela da aula: abre com a pessoa e o dia daquela aula. */
function abrirFaltaDoDiaDaAula() {
  const cls = typeof aulaAbertaNoModal === 'function' ? aulaAbertaNoModal() : null;
  if (!cls) return;
  abrirFaltaDoDia({ teacherId: cls.teacherId, dia: FaltaDoDia.diaISO(cls.scheduledDate) });
}

/** Lê o dia inteiro da academia: as aulas de todas as unidades e as trocas em aberto. */
async function faltaDiaCarregar() {
  const S = FaltaDiaState;
  S.carregando = true;
  S.erro = '';
  faltaDiaDesenhar();

  try {
    // Aberta de fora da Agenda Geral, a lista de pessoas pode não estar em memória.
    if (!AgendaState.units.length || !AgendaState.teachersMap.size) {
      const [u, m, t] = await Promise.all([UnitService.list(), ModalityService.list(), TeacherService.list()]);
      AgendaState.units = u.data || [];
      AgendaState.modalitiesMap = new Map((m.data || []).map(x => [x.id, x]));
      AgendaState.teachersMap = new Map((t.data || []).map(x => [x.id, x]));
    }

    const [y, mes, d] = S.dia.split('-').map(Number);
    const from = new Date(y, mes - 1, d, 0, 0, 0, 0);
    const to = new Date(y, mes - 1, d, 23, 59, 59, 999);
    const unitIds = AgendaState.units.map(u => u.id);
    const classes = [];
    for (let i = 0; i < unitIds.length; i += 30) {
      const snap = await db.collection('classes')
        .where('unitId', 'in', unitIds.slice(i, i + 30))
        .where('scheduledDate', '>=', from)
        .where('scheduledDate', '<=', to)
        .orderBy('scheduledDate', 'asc')
        .get();
      snap.docs.forEach(doc => classes.push(Object.assign({ id: doc.id }, doc.data())));
    }
    S.classes = classes;

    // Troca esperando confirmação bloqueia a aula. Se a consulta falhar, a
    // janela segue: o serviço de troca ainda barra o pedido duplicado.
    S.subsAbertas = [];
    try {
      const r = await SubstitutionService.listAbertasNoPeriodo(from, to);
      if (r && r.success) S.subsAbertas = r.data || [];
    } catch (e) { console.warn('[falta do dia] trocas em aberto', e && e.message); }
  } catch (err) {
    console.error('[falta do dia] carregar', err);
    S.classes = [];
    S.erro = 'Não consegui carregar as aulas desse dia (' + ((err && err.message) || 'erro') + ').';
  }

  S.carregando = false;
  faltaDiaMontar();
  faltaDiaDesenhar();
}

/** Refaz a lista da pessoa escolhida e volta as escolhas para o padrão. */
function faltaDiaMontar() {
  const S = FaltaDiaState;
  S.itens = S.teacherId ? FaltaDoDia.aulasDoDia(S.classes, S.teacherId, S.dia, { subsAbertas: S.subsAbertas }) : [];
  S.escolhas = FaltaDoDia.escolhasPadrao(S.itens);
}

function faltaDiaSetDia(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return;
  FaltaDiaState.dia = iso;
  faltaDiaCarregar();
}

function faltaDiaSetPessoa(id) {
  FaltaDiaState.teacherId = id || '';
  FaltaDiaState.erro = '';
  faltaDiaMontar();
  faltaDiaDesenhar();
}

function faltaDiaEscolher(classId, tipo) {
  const S = FaltaDiaState;
  const atual = S.escolhas[classId] || {};
  S.escolhas[classId] = { tipo, colegaId: tipo === 'colega' ? (atual.colegaId || '') : '' };
  S.erro = '';
  faltaDiaDesenhar();
}

function faltaDiaSetColega(classId, colegaId) {
  FaltaDiaState.escolhas[classId] = { tipo: 'colega', colegaId: colegaId || '' };
  FaltaDiaState.erro = '';
  faltaDiaDesenhar();
}

/** "Todas: faltou" / "Todas: deu a aula" — só nas linhas que aceitam a escolha. */
function faltaDiaTodas(tipo) {
  const S = FaltaDiaState;
  S.itens.forEach(i => { if (i.pode) S.escolhas[i.id] = { tipo, colegaId: '' }; });
  S.erro = '';
  faltaDiaDesenhar();
}

/** Um colega cobriu o dia inteiro: preenche todas as linhas que aceitam troca. */
function faltaDiaColegaTodas(colegaId) {
  if (!colegaId) return;
  const S = FaltaDiaState;
  S.itens.forEach(i => { if (i.pode && i.podeColega) S.escolhas[i.id] = { tipo: 'colega', colegaId }; });
  S.erro = '';
  faltaDiaDesenhar();
}

function faltaDiaSetTipo(v) {
  FaltaDiaState.faltaTipo = v || '';
  FaltaDiaState.erro = '';
  faltaDiaDesenhar();
}

/** A observação não redesenha a tela: redesenhar a cada tecla tiraria o cursor do campo. */
function faltaDiaSetNota(v) {
  FaltaDiaState.nota = String(v || '').slice(0, 500);
}

/** Quem pode ter dado a aula: todo mundo ativo, menos a própria pessoa. */
function faltaDiaColegas() {
  const S = FaltaDiaState;
  return Array.from(AgendaState.teachersMap.values())
    .filter(t => t.isActive !== false && t.id !== S.teacherId)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

/**
 * O colega já tem aula no horário desta? Conta o que ele tem na agenda do dia
 * e as outras aulas que esta mesma tela está passando para ele.
 */
function faltaDiaChoques(cls, colegaId) {
  const S = FaltaDiaState;
  if (!colegaId || typeof HourDeclaration !== 'object') return [];
  const doColega = S.classes.filter(c => c.teacherId === colegaId);
  const planejadas = S.itens
    .filter(i => i.id !== cls.id && (S.escolhas[i.id] || {}).tipo === 'colega' && S.escolhas[i.id].colegaId === colegaId)
    .map(i => i.cls);
  return HourDeclaration.choquesDeHorario(doColega.concat(planejadas), cls);
}

function faltaDiaChoqueTexto(cls, colegaId) {
  const choques = faltaDiaChoques(cls, colegaId);
  if (!choques.length) return '';
  return `${faltaDiaNome(colegaId)} já tem aula nesse horário: `
    + choques.map(c => `${c.startTime}–${c.endTime} (${faltaDiaUnidade(c.unitId)})`).join(', ');
}

function faltaDiaLinhaHtml(item) {
  const S = FaltaDiaState;
  const c = item.cls;
  const e = S.escolhas[item.id] || { tipo: 'nada' };
  const titulo = `<span class="falta-dia-hora">${escapeHtml(c.startTime || '')}–${escapeHtml(c.endTime || '')}</span>
      <span class="falta-dia-onde">${escapeHtml(faltaDiaUnidade(c.unitId))}${faltaDiaModalidade(c) ? ' · ' + escapeHtml(faltaDiaModalidade(c)) : ''}</span>
      ${item.noLugarDe ? `<span class="chip-mini chip-orange">no lugar de ${escapeHtml(faltaDiaNome(item.noLugarDe))}</span>` : ''}`;

  if (!item.pode) {
    return `<div class="falta-dia-linha falta-dia-bloqueada">
        <div class="falta-dia-titulo">${titulo}</div>
        <div class="falta-dia-motivo">🔒 ${escapeHtml(item.motivo)}</div>
      </div>`;
  }

  const botao = (tipo, texto) => `<button type="button" class="falta-dia-op ${e.tipo === tipo ? 'falta-dia-op-' + tipo : ''}"
      onclick="faltaDiaEscolher('${item.id}','${tipo}')">${texto}</button>`;
  const colegas = e.tipo !== 'colega' ? '' : `
      <div class="falta-dia-colega">
        <select onchange="faltaDiaSetColega('${item.id}', this.value)">
          <option value="">— quem deu a aula? —</option>
          ${faltaDiaColegas().map(t => `<option value="${escapeHtml(t.id)}" ${t.id === e.colegaId ? 'selected' : ''}>${escapeHtml(t.name || '')}${faltaDiaChoques(c, t.id).length ? ' — já tem aula nesse horário' : ''}</option>`).join('')}
        </select>
        ${e.colegaId && faltaDiaChoqueTexto(c, e.colegaId)
          ? `<div class="falta-dia-alerta">⚠️ ${escapeHtml(faltaDiaChoqueTexto(c, e.colegaId))}. Ninguém dá duas aulas ao mesmo tempo: a outra precisa passar para quem deu, senão a hora conta em dobro e o fechamento trava.</div>` : ''}
      </div>`;

  return `<div class="falta-dia-linha">
      <div class="falta-dia-titulo">${titulo}</div>
      ${item.nota ? `<div class="falta-dia-nota">${escapeHtml(item.nota)}</div>` : ''}
      <div class="falta-dia-ops">
        ${botao('falta', 'Faltou')}
        ${item.podeColega ? botao('colega', 'Um colega deu') : ''}
        ${botao('nada', item.nota ? 'Não mexer' : 'Deu a aula')}
      </div>
      ${colegas}
    </div>`;
}

function faltaDiaDesenhar() {
  const body = document.getElementById('faltaDiaBody');
  if (!body) return;
  const S = FaltaDiaState;

  const comAula = new Set(FaltaDoDia.pessoasComAula(S.classes, S.dia));
  const pessoas = Array.from(AgendaState.teachersMap.values())
    .filter(t => comAula.has(t.id))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  // A pessoa escolhida continua na lista mesmo sem aula no dia — senão o campo
  // voltaria calado para "escolha" e a gestão não entenderia o que houve.
  const fora = S.teacherId && !comAula.has(S.teacherId) ? AgendaState.teachersMap.get(S.teacherId) : null;

  const topo = `
    <div class="falta-dia-topo">
      <label class="falta-dia-campo"><span>Dia</span>
        <input type="date" value="${escapeHtml(S.dia || '')}" onchange="faltaDiaSetDia(this.value)" ${S.salvando ? 'disabled' : ''}></label>
      <label class="falta-dia-campo falta-dia-campo-largo"><span>Quem faltou</span>
        <select onchange="faltaDiaSetPessoa(this.value)" ${S.carregando || S.salvando ? 'disabled' : ''}>
          <option value="">— escolha a pessoa —</option>
          ${fora ? `<option value="${escapeHtml(fora.id)}" selected>${escapeHtml(fora.name || '')} (sem aula neste dia)</option>` : ''}
          ${pessoas.map(t => `<option value="${escapeHtml(t.id)}" ${t.id === S.teacherId ? 'selected' : ''}>${escapeHtml(t.name || '')}</option>`).join('')}
        </select></label>
    </div>`;

  let meio;
  if (S.carregando) {
    meio = '<div class="loading"><div class="spinner"></div> Carregando as aulas do dia…</div>';
  } else if (!S.teacherId) {
    meio = `<div class="empty-state-small" style="padding:28px 12px;">${pessoas.length
      ? 'Escolha a pessoa. A lista traz só quem tem aula nesse dia.'
      : 'Nenhuma aula nesse dia.'}</div>`;
  } else if (!S.itens.length) {
    meio = `<div class="empty-state-small" style="padding:28px 12px;"><strong>${escapeHtml(faltaDiaNome(S.teacherId))}</strong> não tem aula nesse dia.</div>`;
  } else {
    const marcaveis = S.itens.filter(i => i.pode);
    const nFalta = marcaveis.filter(i => (S.escolhas[i.id] || {}).tipo === 'falta').length;
    const nColega = marcaveis.filter(i => (S.escolhas[i.id] || {}).tipo === 'colega').length;
    const futura = FaltaDoDia.temAulaFutura(S.itens, faltaDiaAgora());
    const tipoBotao = (v, texto) => `<button type="button" class="falta-dia-op ${S.faltaTipo === v ? 'falta-dia-op-falta' : ''}" onclick="faltaDiaSetTipo('${v}')">${texto}</button>`;

    meio = `
      ${marcaveis.length > 1 ? `
      <div class="falta-dia-atalhos">
        <span>Todas as aulas:</span>
        <button type="button" class="btn btn-outline btn-sm" onclick="faltaDiaTodas('falta')">Faltou em todas</button>
        <button type="button" class="btn btn-outline btn-sm" onclick="faltaDiaTodas('nada')">Deu todas</button>
        <select onchange="faltaDiaColegaTodas(this.value); this.value='';">
          <option value="">Um colega deu todas…</option>
          ${faltaDiaColegas().map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name || '')}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="falta-dia-lista">${S.itens.map(faltaDiaLinhaHtml).join('')}</div>

      ${nFalta ? `
      <div class="falta-dia-bloco">
        <div class="falta-dia-rotulo">A falta foi <span class="req">*</span></div>
        <div class="falta-dia-ops">
          ${tipoBotao('justificada', 'Avisada antes')}
          ${tipoBotao('sem_aviso', 'Sem aviso')}
        </div>
        ${futura ? '<div class="hint" style="margin-top:6px;">Aula que ainda não começou só aceita "avisada antes".</div>' : ''}
      </div>` : ''}

      <div class="falta-dia-bloco">
        <div class="falta-dia-rotulo">Observação</div>
        <input type="text" maxlength="500" placeholder="Ex.: atestado médico, avisou no grupo às 6h…"
               value="${escapeHtml(S.nota)}" oninput="faltaDiaSetNota(this.value)">
      </div>

      <div class="info-callout falta-dia-resumo">
        ${nFalta || nColega ? `<strong>${[
          nFalta ? `${nFalta} ${nFalta === 1 ? 'aula como falta' : 'aulas como falta'}` : '',
          nColega ? `${nColega} ${nColega === 1 ? 'aula passa' : 'aulas passam'} para um colega` : '',
        ].filter(Boolean).join(' · ')}</strong><br>` : '<strong>Nada marcado ainda.</strong><br>'}
        Aula com <strong>falta</strong> sai das horas pagas (e do dia de vale-transporte, se não sobrar aula dada no dia) e desconta pontos no Placar, por aula.
        Aula que <strong>um colega deu</strong> troca de nome, o colega recebe por ela e não fica falta registrada.
      </div>`;
  }

  body.innerHTML = `
    ${topo}
    ${meio}
    <div class="error-msg" id="faltaDiaErro">${escapeHtml(S.erro)}</div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="fecharFaltaDoDia()" ${S.salvando ? 'disabled' : ''}>Fechar</button>
      <button class="btn" id="faltaDiaLancarBtn" onclick="faltaDiaLancar()"
              ${S.carregando || S.salvando || !S.itens.some(i => i.pode) ? 'disabled' : ''}>${S.salvando ? 'Lançando…' : 'Lançar'}</button>
    </div>`;
}

/** Avisos das trocas que a gestão precisa ler antes de confirmar. */
async function faltaDiaAvisosDasTrocas(p) {
  const avisos = [];
  for (const t of p.trocas) {
    const choque = faltaDiaChoqueTexto(t.cls, t.colegaId);
    if (choque) avisos.push(`${t.cls.startTime}: ${choque}`);
    if (typeof subsAvisoAntesDeRegistrar === 'function') {
      try {
        const folga = await subsAvisoAntesDeRegistrar({ cls: t.cls, substitutoId: t.colegaId });
        if (folga) avisos.push(`${t.cls.startTime}: ${folga}`);
      } catch (e) { /* aviso é cortesia: sem ele, a troca segue */ }
    }
  }
  return avisos;
}

async function faltaDiaLancar() {
  const S = FaltaDiaState;
  if (S.salvando || !faltaDiaEhGestao()) return;

  const p = FaltaDoDia.plano(S.itens, S.escolhas, { teacherId: S.teacherId, faltaTipo: S.faltaTipo, agora: faltaDiaAgora() });
  if (!p.ok) { S.erro = p.erro; faltaDiaDesenhar(); return; }

  const nome = faltaDiaNome(S.teacherId);
  const avisos = await faltaDiaAvisosDasTrocas(p);
  const pergunta = FaltaDoDia.resumo(p, { nome, nomeDe: faltaDiaNome, dia: S.dia })
    + (avisos.length ? `\n\nAtenção:\n${avisos.map(a => '• ' + a).join('\n')}` : '')
    + '\n\nConfirmar?';
  if (!confirm(pergunta)) return;

  S.salvando = true;
  S.erro = '';
  faltaDiaDesenhar();

  const nota = (S.nota || '').trim();
  const falhas = [];
  const faltasFeitas = [];
  const trocasFeitas = [];

  for (const c of p.faltas) {
    const res = await ClassService.updateStatus(c.id, 'nao_realizada', nota || 'Falta lançada pela gestão em "Falta do dia"',
      { faltaTipo: p.faltaTipo, atrasoMinutos: 0, saidaAntecipadaMinutos: 0, horaExtraMinutos: 0 });
    if (res && res.success) faltasFeitas.push(c);
    else falhas.push(`${c.startTime}: ${(res && res.error) || 'não consegui lançar a falta'}`);
  }

  const motivoTroca = nota || 'Lançado pela gestão em "Falta do dia"';
  for (const t of p.trocas) {
    const res = await SubstitutionService.create({
      classId: t.cls.id, substituteTeacherId: t.colegaId, reason: motivoTroca,
      registradoPor: 'gestao', avisarQuemConfirma: false,
    });
    if (!res.success) { falhas.push(`${t.cls.startTime}: ${res.error || 'não consegui registrar a troca'}`); continue; }
    const hom = await SubstitutionService.homologar(res.data.id, motivoTroca);
    if (!hom.success) { falhas.push(`${t.cls.startTime}: troca registrada, mas não confirmada (${hom.error || 'falha'}) — confirme em Substituições`); continue; }
    trocasFeitas.push(t);
  }

  // O professor fica sabendo da falta: é o pagamento dele. Só no sino — este
  // tipo não vira e-mail.
  if (faltasFeitas.length) {
    const t = AgendaState.teachersMap.get(S.teacherId);
    if (t && t.userId && typeof NotifyService === 'object') {
      try {
        await NotifyService.send({
          recipients: [t.userId], type: 'falta_lancada', title: 'Falta registrada pela gestão',
          body: FaltaDoDia.mensagemParaOProfessor({ faltas: faltasFeitas, faltaTipo: p.faltaTipo }, S.dia),
          link: { type: 'minhas-horas' }, channels: ['inapp'],
        });
      } catch (e) { console.warn('[falta do dia] aviso ao professor', e && e.message); }
    }
  }

  // Quem move a aula da troca é a Function, alguns segundos depois da confirmação.
  if (trocasFeitas.length) {
    let moveu = false;
    for (let i = 0; i < 8 && !moveu; i++) {
      await faltaDiaEsperar(1500);
      try {
        const docs = await Promise.all(trocasFeitas.map(t => db.collection('classes').doc(t.cls.id).get()));
        moveu = docs.every((d, k) => d.exists && d.data().teacherId === trocasFeitas[k].colegaId);
      } catch (e) { /* tenta de novo */ }
    }
  }

  S.salvando = false;
  const feito = [
    faltasFeitas.length ? `${faltasFeitas.length} ${faltasFeitas.length === 1 ? 'falta lançada' : 'faltas lançadas'}` : '',
    trocasFeitas.length ? `${trocasFeitas.length} ${trocasFeitas.length === 1 ? 'aula passada' : 'aulas passadas'} para colega` : '',
  ].filter(Boolean).join(' · ');

  if (falhas.length) {
    // Fica aberta, relida do banco: o que deu certo já aparece como lançado e
    // o que falhou continua na lista para tentar de novo.
    toast(`${feito || 'Nada foi lançado'}. Não consegui — ${falhas.join(' · ')}`, 'error', 12000);
    await faltaDiaCarregar();
  } else {
    toast(`${nome}: ${feito}.`, 'success', 6000);
    fecharFaltaDoDia();
  }
  if (typeof recarregarAgendaAtual === 'function') await recarregarAgendaAtual();
}

// ESC fecha a janela (a da aula e a da grade têm o próprio atalho na agenda).
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('faltaDiaModal');
    if (modal && modal.classList && modal.classList.contains('open') && !FaltaDiaState.salvando) fecharFaltaDoDia();
  });
}
