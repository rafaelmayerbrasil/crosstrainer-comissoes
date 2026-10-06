// ═══════════════════════════════════════════════════════════════════════
// professores-horas.js — Minhas horas do mês (professor) · Horas do mês (gestão)
//
// O professor confere o mês de uma vez: a tela traz o que a AGENDA diz, dia por
// dia, em turnos (entrada e saída). Ele corrige só os dias que foram diferentes
// e envia. A gestão vê a diferença, valida — e é aí que passa a valer.
//
// Rafael, 01/10/2026: "eu acho que o professor poderia corrigir e colocar pra
// gestão validar". O caso que motivou: o Theo Rosa mandou as horas de setembro
// numa lista pelo WhatsApp (167h15 contra 139h30 da agenda), porque a maior
// parte da diferença não tinha onde ser informada.
//
// VALIDAR MEXE NAS AULAS, não cria uma conta paralela: a aula que ele não deu
// vira "não realizada", a entrada depois vira atraso, o turno que não existia
// vira aula avulsa. A folha, o banco de horas e os relatórios continuam lendo
// as aulas como sempre. As contas moram em hour-declaration.js (puro, testado
// contra o closing-payroll.js de verdade).
// ═══════════════════════════════════════════════════════════════════════

const HORAS_COL = 'hour_declarations';
const HORAS_MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const HorasState = {
  // edição — o professor na própria tela, ou a gestão lançando por alguém (`alvo`)
  ano: null, mes: null, teacherId: null, alvo: null,
  classes: [], agenda: [], decl: null, dias: {}, editor: null, fechado: false, erro: null,
  tipos: new Map(),     // tipos de escala (peso na folha)
  feriados: {},         // feriados em dias que NÃO estão na agenda da pessoa: { dia: { peso, nome } }
  // lista da gestão
  g: { ano: null, mes: null, classes: [], decls: [], vendo: null, erro: null, tipos: new Map(), feriados: {} },
};

/* ─── utilidades ─────────────────────────────────────────────────── */
function horasTs() { return firebase.firestore.FieldValue.serverTimestamp(); }
function horasHojeISO() {
  const d = new Date(), z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function horasMesStr(ano, mes) { return `${ano}-${String(mes).padStart(2, '0')}`; }
function horasMesNome(ano, mes) { return `${HORAS_MESES[mes - 1]}/${ano}`; }
function horasMesAnterior(ano, mes) { return mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 }; }
/**
 * O mês em que a tela abre. Até o dia 10 é o mês que ACABOU — é ele que falta
 * conferir, e é quando a gestão fecha a folha. Depois disso, o mês corrente.
 */
function horasMesPadrao() {
  const [a, m, d] = horasHojeISO().split('-').map(Number);
  return d > 10 ? { ano: a, mes: m } : horasMesAnterior(a, m);
}
function horasMesesDoSeletor() {
  const [a, m] = horasHojeISO().split('-').map(Number);
  const out = []; let p = { ano: a, mes: m };
  for (let i = 0; i < 3; i++) { out.push(p); p = horasMesAnterior(p.ano, p.mes); }
  return out;
}
function horasSeletorHtml(ano, mes, fn) {
  const atual = horasMesStr(ano, mes);
  const lista = horasMesesDoSeletor();
  if (!lista.some(p => horasMesStr(p.ano, p.mes) === atual)) lista.push({ ano, mes });
  return `<select class="input" style="width:auto;" onchange="${fn}(this.value)">${lista.map(p => {
    const v = horasMesStr(p.ano, p.mes);
    return `<option value="${v}"${v === atual ? ' selected' : ''}>${horasMesNome(p.ano, p.mes)}</option>`;
  }).join('')}</select>`;
}
/** "qua., 09/09" */
function horasDiaTexto(iso) {
  const d = new Date(iso + 'T12:00:00');
  return isNaN(d) ? iso : d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}
function horasDataBR(v) {
  const d = v && v.toDate ? v.toDate() : null;
  return d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
}
function horasNome(id) {
  const t = AgendaState.teachersMap.get(id);
  return t ? (t.name || '—') : '—';
}
function horasEhGestao() {
  return (typeof isAdminGestao === 'function' && isAdminGestao())
      || (typeof isSupervisao === 'function' && isSupervisao());
}
function horasTurnosTxt(turnos) {
  return (turnos || []).map(t => `${t.inicio}–${t.fim}`).join(' · ');
}
function horasPagina() {
  return document.getElementById(HorasState.alvo ? 'page-horas-do-mes' : 'page-minhas-horas');
}
function horasMinTxt(min) { return min >= 60 ? HourDeclaration.fmtHoras(min) : `${min} min`; }
/** "CP", "PP" — como a academia fala. */
function horasUnidade(id) {
  const u = (AgendaState.units || []).find(x => x.id === id);
  return String((u && u.name) || id || '').replace(/^CrossTainer\s*/i, '') || String(id || '');
}
function horasUnidadesTxt(ids) { return (ids || []).map(horasUnidade).filter(Boolean).join(' e '); }
/** Feriado conta em dobro na folha — a tela fala em horas trabalhadas, então precisa dizer. */
function horasChipPeso(l) {
  if (!l || (!l.feriado && l.peso === 1)) return '';
  const vezes = l.peso === 2 ? 'conta em dobro' : (l.peso !== 1 ? `conta ×${String(l.peso).replace('.', ',')}` : '');
  const txt = [l.feriado ? 'feriado' : '', vezes].filter(Boolean).join(' · ');
  return `<span class="chip-mini chip-orange" title="${escapeHtml(l.holidayName || '')}">${txt}</span>`;
}
/** "das 18:00 às 21:15" */
function horasIntervalosTxt(lista) {
  return (lista || []).map(x => `das ${x.inicio} às ${x.fim}`).join(' e ');
}
/** O aviso de quem aparece em duas aulas no mesmo horário. `quem`: 'você' ou o nome. */
function horasDoisLugaresHtml(l, quem, comoResolver) {
  if (!l || !(l.minutosEmDobro > 0)) return '';
  const onde = (l.unidades || []).length > 1 ? ` (${horasUnidadesTxt(l.unidades)})` : '';
  return `<div class="horas-alerta">⚠️ A agenda tem ${quem} em <b>dois lugares ao mesmo tempo</b> ${horasIntervalosTxt(l.emDobro)}${onde}
    e soma <b>${HourDeclaration.fmtHoras(l.minutosEmDobro)} em dobro</b>. Vale uma vez só.${comoResolver ? ' ' + comoResolver : ''}</div>`;
}
/** Espera — separado para o teste não ter que esperar de verdade. */
function horasEsperar(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Nomes de professor, modalidade e unidade — sem isso a tela mostra ID cru. */
async function horasCarregarNomes() {
  try {
    if (AgendaState.teachersMap.size === 0) {
      const r = await TeacherService.list();
      AgendaState.teachersMap = new Map((r.data || []).map(t => [t.id, t]));
    }
    if (AgendaState.modalitiesMap.size === 0) {
      const r = await ModalityService.list();
      AgendaState.modalitiesMap = new Map((r.data || []).map(m => [m.id, m]));
    }
    if (!(AgendaState.units || []).length && typeof UnitService === 'object' && UnitService.list) {
      const r = await UnitService.list();
      AgendaState.units = r.data || [];
    }
  } catch (e) { console.warn('[horas] nomes', e && e.message); }
}

/* ═══ SERVIÇO ═════════════════════════════════════════════════════ */
const HourDeclarationService = {
  id(teacherId, mes) { return `${teacherId}_${mes}`; },
  periodo(ano, mes) { return { ini: new Date(ano, mes - 1, 1), fim: new Date(ano, mes, 1) }; },

  async aulasDaPessoa(teacherId, ano, mes) {
    const { ini, fim } = this.periodo(ano, mes);
    const snap = await db.collection('classes').where('teacherId', '==', teacherId)
      .where('scheduledDate', '>=', ini).where('scheduledDate', '<', fim).get();
    return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
  },
  async aulasDoMes(ano, mes) {
    const { ini, fim } = this.periodo(ano, mes);
    const snap = await db.collection('classes')
      .where('scheduledDate', '>=', ini).where('scheduledDate', '<', fim).get();
    return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
  },
  /** Tipos de escala (peso na folha). Sem acesso ou sem cadastro, vale a regra padrão: feriado em dobro. */
  async tiposDeEscala() {
    try {
      const snap = await db.collection('special_scale_types').get();
      return new Map(snap.docs.map(d => [d.id, d.data()]));
    } catch (e) { console.warn('[horas] tipos de escala', e && e.message); return new Map(); }
  },
  /** Todas as aulas de UM dia (de qualquer pessoa) — é como se sabe que o dia é feriado. */
  async aulasDoDia(dia) {
    const [a, m, d] = String(dia).split('-').map(Number);
    const snap = await db.collection('classes')
      .where('scheduledDate', '>=', new Date(a, m - 1, d)).where('scheduledDate', '<', new Date(a, m - 1, d + 1)).get();
    return snap.docs.map(x => Object.assign({ id: x.id }, x.data()));
  },
  /** Feriados entre os dias pedidos: `{ dia: { peso, nome } }`. Falha vira "não sei" — nunca inventa feriado. */
  async feriadosDosDias(dias, tipos) {
    const out = {};
    for (const dia of dias || []) {
      try { Object.assign(out, HourDeclaration.feriadosDasAulas(await this.aulasDoDia(dia), tipos)); }
      catch (e) { console.warn('[horas] feriado do dia', dia, e && e.message); }
    }
    return out;
  },
  // Por CONSULTA, não por leitura direta do documento: quando a declaração ainda
  // não existe, a regra do professor não tem o que comparar e a leitura direta
  // seria recusada.
  async daPessoa(teacherId, mes) {
    const snap = await db.collection(HORAS_COL).where('teacherId', '==', teacherId).where('mes', '==', mes).get();
    return snap.docs.length ? Object.assign({ id: snap.docs[0].id }, snap.docs[0].data()) : null;
  },
  async doMes(mes) {
    const snap = await db.collection(HORAS_COL).where('mes', '==', mes).get();
    return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
  },
  /** O que espera o OK da gestão, de qualquer mês (chip da home). */
  async aValidar() {
    const snap = await db.collection(HORAS_COL).where('status', '==', 'enviada').get();
    return snap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(d => d.semDiferenca !== true);
  },

  async gravar(teacherId, mes, campos, existe) {
    const ref = db.collection(HORAS_COL).doc(this.id(teacherId, mes));
    const uid = currentUserId();
    const base = Object.assign({}, campos, { updatedAt: horasTs(), updatedBy: uid });
    if (existe) await ref.update(base);
    else await ref.set(Object.assign({
      teacherId, mes, status: 'rascunho', semDiferenca: false, dias: {}, lancadaPelaGestao: false,
      createdAt: horasTs(), createdBy: uid,
    }, base));
  },

  /**
   * A gestão valida: o plano vira ajuste nas aulas. Lê as aulas DE NOVO na
   * hora — a tela pode estar aberta há tempo — e grava a declaração por último,
   * para que uma falha no meio deixe tudo como "enviada". Como o plano traz
   * valores absolutos e a aula avulsa tem identificador fixo, validar de novo
   * depois de uma falha não soma em dobro.
   */
  async validar(teacherId, mes) {
    const H = HourDeclaration;
    try {
      const [ano, m] = String(mes).split('-').map(Number);
      const id = this.id(teacherId, mes);
      const ref = db.collection(HORAS_COL).doc(id);
      const doc = await ref.get();
      if (!doc.exists) return { success: false, error: 'Essa pessoa ainda não enviou as horas deste mês.' };
      const decl = doc.data();
      if (decl.status === 'validada') return { success: false, error: 'Essas horas já foram validadas.' };
      if (decl.status !== 'enviada') return { success: false, error: 'Só dá para validar o que foi enviado.' };

      const classes = await this.aulasDaPessoa(teacherId, ano, m);
      if (classes.some(c => !!c.monthClosingId)) {
        return { success: false, error: 'Mês já fechado — as horas não podem mais ser ajustadas.' };
      }
      const tipos = await this.tiposDeEscala();
      const agenda = H.agendaDoMes(classes, teacherId, ano, m, tipos);
      const pl = H.plano(agenda, decl);
      if (pl.erros.length) return { success: false, error: 'Há dia com horário inválido: ' + pl.erros.join(' · ') };
      // Turno novo num dia em que a pessoa não tinha aula: se o dia é feriado,
      // a aula nasce marcada — senão a folha pagaria hora simples.
      const comAula = new Set(agenda.map(a => a.dia));
      const feriados = await this.feriadosDosDias(
        pl.porDia.filter(d => d.novas.length && !comAula.has(d.dia)).map(d => d.dia), tipos);

      const uid = currentUserId();
      const t = AgendaState.teachersMap.get(teacherId) || {};
      const padrao = {
        unitId: t.primaryUnitId || (t.unitIds && t.unitIds[0]) || null,
        modalityId: (t.modalityIds && t.modalityIds[0]) || null,
      };
      const porDia = new Map(agenda.map(a => [a.dia, a]));
      const carimbo = {
        adjustedBy: uid, adjustedAt: horasTs(), registroAutomatico: false, horasDeclaracaoId: id, updatedAt: horasTs(),
        adjustmentNote: 'Horas do mês informadas pelo professor e validadas pela gestão',
      };
      const escritas = [];              // { ref, modo:'update'|'set', dados }
      const tocadas = new Map();        // classId → dados (para juntar o aviso absorvido na mesma escrita)
      let turnosNovos = 0;
      const pendencias = [];

      for (const d of pl.porDia) {
        d.ops.forEach(op => tocadas.set(op.classId, Object.assign({}, op.campos, carimbo)));
        for (const nova of d.novas) {
          const aula = H.aulaAvulsa({ dia: d.dia, nova, teacherId, agendaDia: porDia.get(d.dia) || null, padrao, declaracaoId: id,
            feriado: feriados[d.dia] || null });
          if (!aula.unitId) {
            return { success: false, error: 'Falta a unidade principal na ficha dessa pessoa — sem ela não dá para criar o turno de '
              + d.dia.slice(8, 10) + '/' + d.dia.slice(5, 7) + '.' };
          }
          escritas.push({
            ref: db.collection('classes').doc(`hm_${teacherId}_${d.dia}_${nova.inicio.replace(':', '')}`), modo: 'set',
            dados: Object.assign(aula, { adjustedBy: uid, adjustedAt: horasTs(), createdAt: horasTs(), updatedAt: horasTs() }),
          });
          turnosNovos++;
        }
        d.pendencias.forEach(p => pendencias.push({ dia: d.dia, inicio: p.inicio, fim: p.fim, minutos: p.minutos, noLugarDe: p.noLugarDe || null }));
      }

      // O que o professor já tinha AVISADO nas aulas desses dias fica respondido
      // aqui: no dia declarado, vale o horário que ele informou. Sem isso o
      // mesmo atraso seria decidido duas vezes, e o resultado dependeria da ordem.
      const diasDeclarados = new Set(Object.keys(decl.dias || {}));
      let avisosAbsorvidos = 0;
      classes.forEach(c => {
        if (!c.avisoProfessor || !diasDeclarados.has(H.diaISO(c.scheduledDate))) return;
        const dados = tocadas.get(c.id) || { updatedAt: horasTs() };
        dados.avisoProfessor = null;
        dados.avisoProfessorAtendido = Object.assign({}, c.avisoProfessor, {
          decisao: 'horas_do_mes', motivo: 'Respondido pelas horas do mês validadas', atendidoPor: uid, atendidoEm: horasTs(),
        });
        tocadas.set(c.id, dados);
        avisosAbsorvidos++;
      });
      tocadas.forEach((dados, classId) => escritas.push({ ref: db.collection('classes').doc(classId), modo: 'update', dados }));

      const aplicado = {
        deltaMinutos: pl.deltaMinutos, minutosPendentes: pl.minutosPendentes,
        aulasAjustadas: tocadas.size, turnosNovos, avisosAbsorvidos, pendencias,
      };
      escritas.push({ ref, modo: 'update', dados: {
        status: 'validada', validadaPor: uid, validadaEm: horasTs(), aplicado, updatedAt: horasTs(), updatedBy: uid,
      } });

      for (let i = 0; i < escritas.length; i += 400) {
        const lote = db.batch();
        escritas.slice(i, i + 400).forEach(w => (w.modo === 'set' ? lote.set(w.ref, w.dados) : lote.update(w.ref, w.dados)));
        await lote.commit();
      }
      await AuditService.log({
        type: 'horas_validadas', module: 'agenda', entityType: 'hour_declaration', entityId: id,
        details: `Horas de ${mes} validadas: ${H.fmtHoras(pl.deltaMinutos, { sinal: true })} · ${tocadas.size} aula(s) ajustada(s), ${turnosNovos} turno(s) novo(s)`,
      });
      return { success: true, data: aplicado };
    } catch (err) {
      console.error('[HourDeclarationService.validar]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async devolver(teacherId, mes, motivo) {
    try {
      const id = this.id(teacherId, mes);
      const uid = currentUserId();
      await db.collection(HORAS_COL).doc(id).update({
        status: 'devolvida', devolvidaMotivo: String(motivo || '').slice(0, 500), devolvidaPor: uid, devolvidaEm: horasTs(),
        updatedAt: horasTs(), updatedBy: uid,
      });
      await AuditService.log({ type: 'horas_devolvidas', module: 'agenda', entityType: 'hour_declaration', entityId: id,
        details: `Horas de ${mes} devolvidas para corrigir: ${String(motivo || '').slice(0, 200)}` });
      return { success: true };
    } catch (err) {
      console.error('[HourDeclarationService.devolver]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  /** "Fechar valendo a agenda": a gestão assume que a pessoa não vai conferir. */
  async dispensar(teacherId, mes) {
    try {
      const id = this.id(teacherId, mes);
      const uid = currentUserId();
      await db.collection(HORAS_COL).doc(id).set({
        teacherId, mes, status: 'dispensada', dispensadaPor: uid, dispensadaEm: horasTs(),
        updatedAt: horasTs(), updatedBy: uid,
      }, { merge: true });
      await AuditService.log({ type: 'horas_dispensadas', module: 'agenda', entityType: 'hour_declaration', entityId: id,
        details: `Horas de ${mes} fechadas valendo a agenda, sem conferência da pessoa` });
      return { success: true };
    } catch (err) {
      console.error('[HourDeclarationService.dispensar]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
};

/* ═══ TELA DE EDIÇÃO (professor, ou gestão lançando por alguém) ═════ */
async function renderMinhasHorasPage() {
  const page = document.getElementById('page-minhas-horas');
  if (!page) return;
  HorasState.alvo = null;
  const tid = (typeof getCurrentProfessorId === 'function') ? getCurrentProfessorId() : null;
  if (!tid) {
    page.innerHTML = `<div class="page-toolbar"><div class="lhs"><h2>MINHAS HORAS DO MÊS</h2></div></div>
      <div class="empty-state"><div class="icon">🕒</div><h3>Seu usuário não tem ficha de professor</h3>
      <p>Esta tela é de quem dá aula. Se você dá aula, peça à gestão para criar a sua ficha em Pessoas.</p></div>`;
    return;
  }
  if (!HorasState.ano || HorasState.teacherId !== tid) {
    const p = horasMesPadrao(); HorasState.ano = p.ano; HorasState.mes = p.mes;
  }
  HorasState.teacherId = tid;
  page.innerHTML = `<div class="loading"><div class="spinner"></div> Carregando…</div>`;
  await horasCarregar();
  horasDesenhar();
}

async function horasCarregar() {
  const H = HourDeclaration;
  const { ano, mes, teacherId } = HorasState;
  HorasState.editor = null; HorasState.erro = null;
  try {
    await horasCarregarNomes();
    const [classes, decl, tipos] = await Promise.all([
      HourDeclarationService.aulasDaPessoa(teacherId, ano, mes),
      HourDeclarationService.daPessoa(teacherId, horasMesStr(ano, mes)),
      HourDeclarationService.tiposDeEscala(),
    ]);
    HorasState.classes = classes;
    HorasState.tipos = tipos;
    HorasState.agenda = H.agendaDoMes(classes, teacherId, ano, mes, tipos);
    HorasState.decl = decl;
    HorasState.dias = Object.assign({}, (decl && decl.dias) || {});
    HorasState.fechado = classes.some(c => !!c.monthClosingId);
    // Dia que a pessoa incluiu e não está na agenda dela: é feriado? Quem sabe
    // é a agenda do dia inteiro ("o feriado é o dobro né?" — Theo, 06/10/2026).
    const comAula = new Set(HorasState.agenda.map(a => a.dia));
    HorasState.feriados = await HourDeclarationService.feriadosDosDias(
      Object.keys(HorasState.dias).filter(d => !comAula.has(d)), tipos);
  } catch (err) {
    console.error('[horas] carregar', err);
    HorasState.classes = []; HorasState.agenda = []; HorasState.decl = null; HorasState.dias = {}; HorasState.feriados = {};
    HorasState.erro = (err && err.message) || 'erro desconhecido';
  }
}

async function horasMudarMes(valor) {
  const [a, m] = String(valor).split('-').map(Number);
  if (!a || !m) return;
  HorasState.ano = a; HorasState.mes = m;
  await horasCarregar();
  horasDesenhar();
}

/** Mês fechado não se mexe. Enviado/validado só a gestão reabre. */
function horasSomenteLeitura() {
  if (HorasState.fechado) return true;
  if (HorasState.alvo) return false;
  const s = HourDeclaration.situacao(HorasState.decl);
  return s === 'enviada' || s === 'validada' || s === 'dispensada';
}

/** O envio abre quando a última aula do mês já passou. */
function horasPodeEnviar() {
  const hoje = horasHojeISO();
  if (horasMesStr(HorasState.ano, HorasState.mes) < hoje.slice(0, 7)) return true;
  const ag = HorasState.agenda;
  return !!ag.length && ag[ag.length - 1].dia <= hoje;
}

function horasAgendaDoDia(dia) { return HorasState.agenda.find(a => a.dia === dia) || null; }

function horasDesenhar() {
  const page = horasPagina();
  if (!page) return;
  const H = HourDeclaration;
  const { ano, mes } = HorasState;
  const gestao = !!HorasState.alvo;
  const mesNome = horasMesNome(ano, mes);
  const topo = gestao
    ? `<div class="page-toolbar"><div class="lhs"><h2>HORAS DO MÊS</h2>
         <div class="count">Lançando as horas de <b>${escapeHtml(horasNome(HorasState.alvo))}</b> · ${mesNome}</div></div>
         <div class="rhs"><button class="btn btn-outline btn-sm" onclick="horasGestaoVoltar()">← Voltar à lista</button></div></div>`
    : `<div class="page-toolbar"><div class="lhs"><h2>MINHAS HORAS DO MÊS</h2></div>
         <div class="rhs">${horasSeletorHtml(ano, mes, 'horasMudarMes')}</div></div>`;

  if (HorasState.erro) {
    page.innerHTML = topo + `<div class="empty-state"><div class="icon">⚠️</div><h3>Erro ao carregar</h3>
      <p>${escapeHtml(HorasState.erro)}</p></div>`;
    return;
  }

  const decl = HorasState.decl;
  const sit = H.situacao(decl);
  const leitura = horasSomenteLeitura();
  const hoje = horasHojeISO();
  // Depois de validada, a agenda JÁ É o que foi validado: pôr a declaração por
  // cima mostraria a mesma diferença duas vezes.
  const sobrepor = gestao || !(sit === 'validada' || sit === 'dispensada');
  const r = H.resumo(HorasState.agenda, { dias: sobrepor ? HorasState.dias : {} }, { feriados: HorasState.feriados });
  const linhas = r.dias.filter(l => l.dia <= hoje || l.declarado);
  const minAgenda = linhas.reduce((s, l) => s + l.minutosAgenda, 0);
  const minInf = linhas.reduce((s, l) => s + l.minutosInformados, 0);
  const pagAgenda = linhas.reduce((s, l) => s + l.minutosPagosAgenda, 0);
  const pagInf = linhas.reduce((s, l) => s + l.minutosPagosInformados, 0);
  const nMudou = linhas.filter(l => l.mudou).length;
  const mesEmAndamento = r.dias.length > linhas.length;

  /* — situação — */
  let faixa = '';
  if (HorasState.fechado) {
    faixa = `<div class="info-callout">🔒 <strong>Mês fechado.</strong> A folha de ${mesNome} já foi fechada; as horas não mudam mais.</div>`;
  } else if (sit === 'validada' && !gestao) {
    const ap = decl.aplicado || {};
    const pend = (ap.pendencias || []).map(p =>
      `${p.dia.slice(8, 10)}/${p.dia.slice(5, 7)} ${p.inicio}–${p.fim}${p.noLugarDe ? ' (no lugar de ' + escapeHtml(horasNome(p.noLugarDe)) + ')' : ''}`).join(' · ');
    faixa = `<div class="info-callout">✅ <strong>Validada pela gestão${horasDataBR(decl.validadaEm) ? ' em ' + horasDataBR(decl.validadaEm) : ''}.</strong>
      ${ap.deltaMinutos ? `${ap.deltaMinutos > 0 ? 'Entraram' : 'Saíram'} <strong>${H.fmtHoras(Math.abs(ap.deltaMinutos))}</strong> ${ap.deltaMinutos > 0 ? 'na' : 'da'} sua conta de horas — a lista abaixo já mostra o mês como ficou.` : 'O mês ficou como a lista abaixo.'}
      ${pend ? `<p style="margin-top:6px;">Não entraram por aqui, porque foram no lugar de um colega e dependem de a troca ser registrada em Substituições: ${pend}.</p>` : ''}</div>`;
  } else if (sit === 'dispensada' && !gestao) {
    faixa = `<div class="info-callout">A gestão fechou as suas horas de ${mesNome} <strong>valendo a agenda</strong>. Se algo está errado, fale com a gestão.</div>`;
  } else if (sit === 'enviada' && !gestao) {
    faixa = decl.semDiferenca === true
      ? `<div class="info-callout">✅ <strong>Mês conferido.</strong> Você confirmou que ${mesNome} foi igual à agenda.
           <div style="margin-top:8px;"><button class="btn btn-outline btn-sm" onclick="horasReabrir()">Preciso corrigir um dia</button></div></div>`
      : `<div class="info-callout">⏳ <strong>${H.ROTULOS.enviada}.</strong> Você enviou as horas de ${mesNome}${horasDataBR(decl.enviadaEm) ? ' em ' + horasDataBR(decl.enviadaEm) : ''}. Só passam a valer quando a gestão validar.
           <div style="margin-top:8px;"><button class="btn btn-outline btn-sm" onclick="horasReabrir()">Preciso corrigir mais</button></div></div>`;
  } else if (sit === 'devolvida') {
    faixa = `<div class="info-callout" style="border-left:3px solid var(--red);">↩️ <strong>A gestão devolveu para corrigir:</strong> "${escapeHtml(decl.devolvidaMotivo || 'sem motivo informado')}"
      <p style="margin-top:6px;">Corrija o que falta e envie de novo.</p></div>`;
  } else if (gestao) {
    faixa = `<div class="info-callout">Mexa só nos dias que foram diferentes da agenda. Ao salvar, as horas voltam para a lista esperando o seu OK${sit === 'validada' ? ' — este mês <strong>já tinha sido validado</strong>; o que você mudar aqui precisa ser validado de novo' : ''}.</div>`;
  } else {
    faixa = `<div class="info-callout">Confira o mês: a lista abaixo é o que <strong>a agenda registrou</strong>. Mexa só nos dias que foram diferentes
      — o que você corrigir fica guardado na hora. No fim, envie para a gestão validar.</div>`;
  }

  /* — totais — */
  const delta = minInf - minAgenda;
  const totais = `<div class="horas-totais">
      <div><span>Pela agenda${mesEmAndamento ? ' até hoje' : ''}</span><b>${H.fmtHoras(minAgenda)}</b></div>
      ${nMudou ? `<div><span>${gestao ? 'Informado' : 'Você informou'}</span><b>${H.fmtHoras(minInf)}</b></div>
      <div><span>Diferença</span><b class="${delta < 0 ? 'horas-menos' : 'horas-mais'}">${delta ? H.fmtHoras(delta, { sinal: true }) : 'nenhuma'}</b></div>` : ''}
      ${(pagAgenda !== minAgenda || pagInf !== minInf) ? `<div><span>Para pagamento</span><b>${H.fmtHoras(nMudou ? pagInf : pagAgenda)}</b>
        <small class="horas-sub">as horas ${nMudou ? (gestao ? 'informadas' : 'que você informou') : 'da agenda'}, com o feriado contando em dobro</small></div>` : ''}
    </div>`;

  /* — dias — */
  const lista = linhas.length
    ? linhas.map(l => horasLinhaHtml(l, leitura)).join('')
    : `<div class="empty-state-small">Nenhuma aula na agenda em ${mesNome}.</div>`;

  /* — dia fora da agenda — */
  const ultimo = `${horasMesStr(ano, mes)}-${String(new Date(ano, mes, 0).getDate()).padStart(2, '0')}`;
  const novoDia = leitura ? '' : `
    <div class="horas-novo-dia">
      <div><strong>${gestao ? 'Trabalhou' : 'Trabalhou'} num dia que não está na lista?</strong></div>
      <div class="horas-novo-dia-campos">
        <input type="date" class="input" id="horasNovoDiaData" min="${horasMesStr(ano, mes)}-01" max="${ultimo < hoje ? ultimo : hoje}">
        <button class="btn btn-outline btn-sm" onclick="horasNovoDia(document.getElementById('horasNovoDiaData').value)">+ Incluir este dia</button>
      </div>
      ${HorasState.editor && HorasState.editor.novo && !r.dias.some(l => l.dia === HorasState.editor.dia) ? `
        <div class="horas-dia horas-dia-mudou"><div class="horas-dia-cab"><div class="horas-dia-data">${horasDiaTexto(HorasState.editor.dia)}</div>
          <div class="horas-dia-info"><div class="horas-dia-turnos">não estava na agenda</div></div></div>${horasEditorHtml()}</div>` : ''}
    </div>`;

  /* — enviar — */
  let rodape = '';
  if (!leitura) {
    if (!horasPodeEnviar()) {
      rodape = `<div class="horas-rodape"><div class="horas-sub">Você pode ir corrigindo ao longo do mês. O envio abre depois da última aula de ${mesNome}.</div></div>`;
    } else if (gestao) {
      rodape = `<div class="horas-rodape"><button class="btn btn-primary" onclick="horasEnviar()">Salvar e voltar à lista</button></div>`;
    } else {
      rodape = `<div class="horas-rodape">
        ${nMudou ? `<button class="btn btn-primary" onclick="horasEnviar()">Enviar para a gestão (${nMudou} ${nMudou === 1 ? 'dia corrigido' : 'dias corrigidos'})</button>`
                 : `<button class="btn btn-primary" onclick="horasConfirmarIgual()">Está tudo igual à agenda</button>`}
        <div class="horas-sub">${nMudou ? 'A gestão vê só o que você mudou e valida.' : 'Se algum dia foi diferente, toque em "Corrigir" na linha dele antes.'}</div>
      </div>`;
    }
  }

  page.innerHTML = topo + faixa + totais + `<div class="horas-lista">${lista}</div>` + novoDia + rodape;
}

function horasLinhaHtml(l, leitura) {
  const H = HourDeclaration;
  const editando = HorasState.editor && HorasState.editor.dia === l.dia;
  const fora = l.foraDaAgenda;
  const gestao = !!HorasState.alvo;
  const chipPeso = horasChipPeso(l);
  const daAgenda = fora
    ? `não estava na agenda · ${fora === 'no_lugar_de' ? 'no lugar de ' + escapeHtml(horasNome(l.noLugarDe)) : 'turno a mais'} ${chipPeso}`
      + (fora === 'no_lugar_de' ? `<div class="horas-sub">Estas horas entram na ${gestao ? 'conta da pessoa' : 'sua conta'} quando a gestão registrar a troca com ${escapeHtml(horasNome(l.noLugarDe))}${gestao ? ' — na lista, em "Ver o que muda"' : ' — você não precisa fazer mais nada'}.</div>` : '')
    : `${horasTurnosTxt(l.turnosAgenda)} <span class="horas-min">${H.fmtHoras(l.minutosAgenda)}</span> ${chipPeso}`;
  const doisLugares = horasDoisLugaresHtml(l, gestao ? 'essa pessoa' : 'você',
    l.declarado ? 'O que foi informado neste dia já conta uma vez só.'
      : (leitura ? '' : 'Toque em <b>Corrigir</b> e confirme os horários deste dia.'));
  let informado = '';
  if (l.mudou) {
    const oQue = l.erro ? `<span class="horas-menos">${escapeHtml(l.erro)}</span>`
      : l.naoTrabalhei ? 'não trabalhei'
      : `${horasTurnosTxt(l.turnosInformados)} <span class="horas-min">${H.fmtHoras(l.minutosInformados)}</span>`;
    informado = `<div class="horas-dia-inf">${HorasState.alvo ? 'Informado' : 'Você informou'}: ${oQue}
      ${l.delta ? `<span class="chip-mini ${l.delta < 0 ? 'chip-yellow' : 'chip-green'}">${H.fmtHoras(l.delta, { sinal: true })}</span>` : ''}
      ${l.obs ? `<div class="horas-sub">"${escapeHtml(l.obs)}"</div>` : ''}</div>`;
  }
  const acoes = leitura ? '' : `
      <button class="btn ${l.mudou ? 'btn-ghost' : 'btn-outline'} btn-sm" onclick="horasAbrirDia('${l.dia}')">Corrigir</button>
      ${l.declarado ? `<button class="btn btn-ghost btn-sm" onclick="horasVoltarAgenda('${l.dia}')">${fora ? 'Tirar este dia' : 'Voltar ao da agenda'}</button>` : ''}`;
  return `<div class="horas-dia${l.mudou ? ' horas-dia-mudou' : ''}">
      <div class="horas-dia-cab">
        <div class="horas-dia-data">${horasDiaTexto(l.dia)}</div>
        <div class="horas-dia-info"><div class="horas-dia-turnos">${daAgenda}</div>${informado}</div>
        <div class="horas-dia-acoes">${acoes}</div>
      </div>
      ${doisLugares}
      ${editando ? horasEditorHtml() : ''}
    </div>`;
}

/* ─── o editor de um dia ──────────────────────────────────────────── */
function horasEditorHtml() {
  const e = HorasState.editor;
  const turnos = e.naoTrabalhei ? '' : e.turnos.map((t, i) => `
      <div class="horas-turno">
        <label>Entrei às <input type="time" class="input" data-turno="${i}" data-campo="inicio" value="${escapeHtml(t.inicio || '')}" oninput="horasSetTurno(${i},'inicio',this.value)" onchange="horasSetTurno(${i},'inicio',this.value)"></label>
        <label>Saí às <input type="time" class="input" data-turno="${i}" data-campo="fim" value="${escapeHtml(t.fim || '')}" oninput="horasSetTurno(${i},'fim',this.value)" onchange="horasSetTurno(${i},'fim',this.value)"></label>
        ${e.turnos.length > 1 ? `<button class="btn btn-ghost btn-sm" title="Tirar este turno" onclick="horasRemTurno(${i})">✕</button>` : ''}
      </div>`).join('') + `<button class="btn btn-ghost btn-sm" onclick="horasAddTurno()">+ Outro turno neste dia</button>`;
  const colegas = Array.from(AgendaState.teachersMap.values())
    .filter(t => t.id !== HorasState.teacherId && t.isActive !== false)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const fora = !e.novo ? '' : `
      <div class="horas-fora">
        <div><strong>Este dia não estava na sua agenda. Foi:</strong></div>
        <label><input type="radio" name="horasFora" ${e.fora === 'no_lugar_de' ? 'checked' : ''} onchange="horasSetFora('no_lugar_de')"> No lugar de um colega</label>
        ${e.fora === 'no_lugar_de' ? `<select class="input" data-campo="noLugarDe" onchange="horasSetNoLugarDe(this.value)">
            <option value="">Quem?</option>
            ${colegas.map(t => `<option value="${t.id}"${e.noLugarDe === t.id ? ' selected' : ''}>${escapeHtml(t.name || '—')}</option>`).join('')}
          </select>
          <div class="horas-sub">Quando é no lugar de um colega, as horas entram pela <b>troca</b> — a gestão registra em Substituições. Aqui fica o aviso.</div>` : ''}
        <label><input type="radio" name="horasFora" ${e.fora === 'turno_extra' ? 'checked' : ''} onchange="horasSetFora('turno_extra')"> Um turno a mais, combinado com a gestão</label>
      </div>`;
  return `<div class="horas-editor">
      ${turnos}
      ${e.novo ? '' : `<label class="horas-check"><input type="checkbox" ${e.naoTrabalhei ? 'checked' : ''} onchange="horasNaoTrabalhei()"> Não trabalhei neste dia</label>`}
      ${fora}
      <input type="text" class="input" maxlength="300" placeholder="Observação para a gestão (opcional)" data-campo="obs" value="${escapeHtml(e.obs || '')}" onchange="horasSetObs(this.value)">
      <div class="horas-previa" id="horasPrevia">${escapeHtml(horasPreviaTexto())}</div>
      ${e.erro ? `<div class="horas-erro">${escapeHtml(e.erro)}</div>` : ''}
      <div class="horas-editor-acoes">
        <button class="btn btn-primary btn-sm" onclick="horasConfirmarDia()">Confirmar este dia</button>
        <button class="btn btn-ghost btn-sm" onclick="horasFecharEditor()">Cancelar</button>
      </div>
    </div>`;
}

/** O dia como está sendo digitado, no formato da declaração. */
function horasDiaDoEditor() {
  const e = HorasState.editor;
  return {
    turnos: e.naoTrabalhei ? [] : e.turnos.filter(t => t.inicio || t.fim).map(t => ({ inicio: t.inicio, fim: t.fim })),
    naoTrabalhei: !!e.naoTrabalhei,
    foraDaAgenda: e.novo ? (e.fora || null) : null,
    noLugarDe: e.novo && e.fora === 'no_lugar_de' ? (e.noLugarDe || null) : null,
    obs: String(e.obs || '').trim().slice(0, 300),
  };
}

function horasPreviaTexto() {
  const H = HourDeclaration;
  const e = HorasState.editor;
  if (!e) return '';
  const dec = horasDiaDoEditor();
  const v = H.validarDia(dec);
  if (!v.ok) return '';
  const min = v.turnos.reduce((s, t) => s + (t.fim - t.ini), 0);
  const ag = horasAgendaDoDia(e.dia);
  if (!ag) {
    const f = HorasState.feriados[e.dia];
    return `Neste dia: ${H.fmtHoras(min)}` + (f && f.peso !== 1 ? ` · feriado: na folha conta ${H.fmtHoras(min * f.peso)}` : '');
  }
  const d = min - ag.minutos;
  // Sem isto a conta parece punição: "11h30 · pela agenda 14h45 · −3h15" num dia
  // em que a pessoa só confirmou os horários (Theo, 04/09/2026).
  const dobro = ag.minutosEmDobro > 0
    ? ` — a agenda soma ${H.fmtHoras(ag.minutosEmDobro)} em dobro (dois lugares ao mesmo tempo, ${horasIntervalosTxt(ag.emDobro)}); vale uma vez só`
    : '';
  const fer = ag.feriado && ag.peso !== 1 ? ` · feriado: na folha conta ${H.fmtHoras(min * ag.peso)}` : '';
  return `Neste dia: ${H.fmtHoras(min)} · pela agenda: ${H.fmtHoras(ag.minutos)}${d ? ' · ' + H.fmtHoras(d, { sinal: true }) : ' · igual'}${dobro}${fer}`;
}
function horasAtualizarPrevia() {
  const el = document.getElementById('horasPrevia');
  if (el) el.textContent = horasPreviaTexto();
}

function horasAbrirDia(dia) {
  if (horasSomenteLeitura()) return;
  const ag = horasAgendaDoDia(dia);
  const d = HorasState.dias[dia] || null;
  const copia = (ts) => (ts || []).map(t => ({ inicio: t.inicio, fim: t.fim }));
  HorasState.editor = {
    dia, novo: !ag, erro: '',
    turnos: d ? (copia(d.turnos).length ? copia(d.turnos) : (ag ? copia(ag.turnos) : [{ inicio: '', fim: '' }])) : copia(ag ? ag.turnos : [{ inicio: '', fim: '' }]),
    naoTrabalhei: !!(d && d.naoTrabalhei),
    fora: d ? (d.foraDaAgenda || null) : null,
    noLugarDe: d ? (d.noLugarDe || null) : null,
    obs: d ? (d.obs || '') : '',
  };
  horasDesenhar();
}
function horasFecharEditor() { HorasState.editor = null; horasDesenhar(); }

// Mudar um horário NÃO redesenha a tela: redesenhar tira o foco do campo no
// meio da digitação. Só a linha de prévia muda.
function horasSetTurno(i, campo, valor) {
  const e = HorasState.editor;
  if (!e || !e.turnos[i] || (campo !== 'inicio' && campo !== 'fim')) return;
  e.turnos[i][campo] = String(valor || '').trim();
  e.erro = '';
  horasAtualizarPrevia();
}
/**
 * Traz para o estado o que está ESCRITO nos campos. O evento de mudança nem
 * sempre chega (seletor de hora do celular, preenchimento automático): sem
 * isto a tela confirmaria o dia com o horário antigo — achado clicando no
 * staging em 01/10/2026, e é o mesmo defeito do "Enviar para a gestão" do
 * iPhone. Vale o que a pessoa está vendo.
 */
function horasLerCampos() {
  const e = HorasState.editor;
  if (!e || typeof document.querySelectorAll !== 'function') return;
  document.querySelectorAll('.horas-editor [data-campo]').forEach(el => {
    const campo = el.getAttribute('data-campo');
    const valor = String(el.value == null ? '' : el.value);
    if (campo === 'inicio' || campo === 'fim') {
      const i = Number(el.getAttribute('data-turno'));
      if (e.turnos[i]) e.turnos[i][campo] = valor.trim();
    } else if (campo === 'obs') e.obs = valor;
    else if (campo === 'noLugarDe') e.noLugarDe = valor || null;
  });
}

function horasAddTurno() {
  const e = HorasState.editor; if (!e) return;
  horasLerCampos();
  e.naoTrabalhei = false; e.turnos.push({ inicio: '', fim: '' }); e.erro = '';
  horasDesenhar();
}
function horasRemTurno(i) {
  const e = HorasState.editor; if (!e || e.turnos.length < 2) return;
  horasLerCampos();
  e.turnos.splice(i, 1); e.erro = '';
  horasDesenhar();
}
function horasNaoTrabalhei() {
  const e = HorasState.editor; if (!e || e.novo) return;
  horasLerCampos();
  e.naoTrabalhei = !e.naoTrabalhei; e.erro = '';
  horasDesenhar();
}
function horasSetFora(tipo) {
  const e = HorasState.editor; if (!e) return;
  horasLerCampos();
  e.fora = (tipo === 'no_lugar_de' || tipo === 'turno_extra') ? tipo : null; e.erro = '';
  horasDesenhar();
}
function horasSetNoLugarDe(id) { const e = HorasState.editor; if (e) { e.noLugarDe = id || null; e.erro = ''; } }
function horasSetObs(v) { const e = HorasState.editor; if (e) e.obs = String(v || ''); }

function horasNovoDia(iso) {
  if (horasSomenteLeitura()) return;
  const { ano, mes } = HorasState;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) { toast('Escolha o dia.', 'error'); return; }
  if (iso.slice(0, 7) !== horasMesStr(ano, mes)) {
    toast(`Esse dia não é deste mês (${horasMesNome(ano, mes)}). Para outro mês, troque lá em cima.`, 'error'); return;
  }
  if (iso > horasHojeISO()) { toast('Esse dia ainda não chegou.', 'error'); return; }
  if (horasAgendaDoDia(iso) || HorasState.dias[iso]) {
    toast('Esse dia já está na lista — corrija na própria linha dele.', 'error'); return;
  }
  HorasState.editor = { dia: iso, novo: true, erro: '', turnos: [{ inicio: '', fim: '' }], naoTrabalhei: false, fora: null, noLugarDe: null, obs: '' };
  horasDesenhar();
  // É feriado? A pessoa não tem aula nesse dia, então quem diz é a agenda do dia.
  if (!HorasState.feriados[iso]) {
    HourDeclarationService.feriadosDosDias([iso], HorasState.tipos).then(f => {
      if (!f[iso]) return;
      Object.assign(HorasState.feriados, f);
      horasAtualizarPrevia();
    }).catch(() => {});
  }
}

async function horasGravar(campos) {
  const mes = horasMesStr(HorasState.ano, HorasState.mes);
  try {
    await HourDeclarationService.gravar(HorasState.teacherId, mes, campos, !!HorasState.decl);
    HorasState.decl = Object.assign({ teacherId: HorasState.teacherId, mes, status: 'rascunho', semDiferenca: false },
      HorasState.decl || {}, campos);
    return true;
  } catch (err) {
    console.error('[horas] gravar', err);
    toast('Não consegui gravar: ' + ((err && err.message) || 'erro'), 'error');
    return false;
  }
}
/** Devolvida continua devolvida (o motivo segue à vista) até ser enviada de novo. */
function horasStatusDoRascunho() {
  return HourDeclaration.situacao(HorasState.decl) === 'devolvida' ? 'devolvida' : 'rascunho';
}

async function horasConfirmarDia() {
  const H = HourDeclaration;
  const e = HorasState.editor;
  if (!e || horasSomenteLeitura()) return;
  horasLerCampos();
  const falha = (msg) => { e.erro = msg; horasDesenhar(); };
  const dec = horasDiaDoEditor();
  const v = H.validarDia(dec);
  if (!v.ok) return falha(v.erro);
  if (e.novo) {
    if (!dec.foraDaAgenda) return falha('Diga se foi no lugar de um colega ou um turno a mais.');
    if (dec.foraDaAgenda === 'no_lugar_de' && !dec.noLugarDe) return falha('Escolha no lugar de quem você trabalhou.');
  }
  dec.turnos = v.turnos.map(t => ({ inicio: H.paraHHMM(t.ini), fim: H.paraHHMM(t.fim) }));

  const ag = horasAgendaDoDia(e.dia);
  // Num dia em dois lugares ao mesmo tempo, confirmar os MESMOS horários já é
  // correção: é o que faz o tempo contar uma vez só.
  const igual = !!ag && !dec.naoTrabalhei && !(ag.minutosEmDobro > 0) && ag.turnos.length === dec.turnos.length
    && ag.turnos.every((t, i) => t.inicio === dec.turnos[i].inicio && t.fim === dec.turnos[i].fim);
  const tinha = !!HorasState.dias[e.dia];
  const antes = tinha ? HorasState.dias[e.dia] : undefined;
  // Dia igual à agenda não é diferença: não entra na declaração.
  if (igual) delete HorasState.dias[e.dia]; else HorasState.dias[e.dia] = dec;

  if (!igual || tinha) {
    const ok = await horasGravar({ dias: HorasState.dias, status: horasStatusDoRascunho(), semDiferenca: false });
    if (!ok) {   // desfaz na tela o que não foi gravado
      if (antes === undefined) delete HorasState.dias[e.dia]; else HorasState.dias[e.dia] = antes;
      return falha('Não consegui gravar. Confira a conexão e tente de novo.');
    }
  }
  HorasState.editor = null;
  horasDesenhar();
}

async function horasVoltarAgenda(dia) {
  if (horasSomenteLeitura() || !HorasState.dias[dia]) return;
  const antes = HorasState.dias[dia];
  delete HorasState.dias[dia];
  const ok = await horasGravar({ dias: HorasState.dias, status: horasStatusDoRascunho(), semDiferenca: false });
  if (!ok) HorasState.dias[dia] = antes;
  if (HorasState.editor && HorasState.editor.dia === dia) HorasState.editor = null;
  horasDesenhar();
}

async function horasEnviar() {
  const H = HourDeclaration;
  if (horasSomenteLeitura()) return;
  const gestao = !!HorasState.alvo;
  const mesNome = horasMesNome(HorasState.ano, HorasState.mes);
  if (!horasPodeEnviar()) { toast(`O envio abre depois da última aula de ${mesNome}.`, 'error'); return; }
  if (!Object.keys(HorasState.dias).length) {
    if (gestao) { toast('Nenhum dia foi corrigido. Para fechar sem mudança, use "Fechar valendo a agenda" na lista.', 'error'); return; }
    return horasConfirmarIgual();
  }
  const r = H.resumo(HorasState.agenda, { dias: HorasState.dias }, { feriados: HorasState.feriados });
  const comErro = r.dias.filter(l => l.erro);
  if (comErro.length) { toast(`Corrija o dia ${comErro[0].dia.slice(8, 10)}/${comErro[0].dia.slice(5, 7)}: ${comErro[0].erro}`, 'error'); return; }

  const contas = `Pela agenda: ${H.fmtHoras(r.minutosAgenda)}\n${gestao ? 'Informado' : 'Você informou'}: ${H.fmtHoras(r.minutosInformados)}\n`
    + `Diferença: ${r.delta ? H.fmtHoras(r.delta, { sinal: true }) : 'nenhuma'} (${r.diasComMudanca} ${r.diasComMudanca === 1 ? 'dia corrigido' : 'dias corrigidos'})`;
  const pergunta = gestao
    ? `Salvar as horas de ${horasNome(HorasState.alvo)} em ${mesNome}?\n\n${contas}\n\nElas voltam para a lista esperando o seu OK.`
    : `Enviar as horas de ${mesNome} para a gestão?\n\n${contas}\n\nSó passam a valer depois que a gestão validar.`;
  if (!confirm(pergunta)) return;

  const ok = await horasGravar({
    dias: HorasState.dias, status: 'enviada', semDiferenca: false,
    resumo: { minutosAgenda: r.minutosAgenda, minutosInformados: r.minutosInformados, diasDiferentes: r.diasDiferentes },
    enviadaEm: horasTs(), enviadaPor: currentUserId(), lancadaPelaGestao: gestao, devolvidaMotivo: null,
  });
  if (!ok) return;
  HorasState.editor = null;
  if (gestao) { toast('Horas salvas. Agora é só validar na lista.', 'success'); return horasGestaoVoltar(); }
  toast('Horas enviadas para a gestão.', 'success');
  horasDesenhar();
}

async function horasConfirmarIgual() {
  const H = HourDeclaration;
  if (HorasState.alvo) return;
  if (horasSomenteLeitura()) { toast('Este mês já foi enviado.', 'error'); return; }
  const n = Object.keys(HorasState.dias).length;
  if (n) { toast(`Você corrigiu ${n} ${n === 1 ? 'dia' : 'dias'}. Envie para a gestão, ou volte esses dias ao da agenda.`, 'error'); return; }
  const mesNome = horasMesNome(HorasState.ano, HorasState.mes);
  if (!horasPodeEnviar()) { toast(`O envio abre depois da última aula de ${mesNome}.`, 'error'); return; }
  const emDobro = HorasState.agenda.filter(a => a.minutosEmDobro > 0);
  if (emDobro.length) {
    toast(`No dia ${emDobro[0].dia.slice(8, 10)}/${emDobro[0].dia.slice(5, 7)} a agenda tem você em dois lugares ao mesmo tempo. Toque em "Corrigir" nesse dia e confirme os seus horários antes de enviar.`, 'error', 9000);
    return;
  }
  const min = HorasState.agenda.reduce((s, a) => s + a.minutos, 0);
  if (!confirm(`Confirmar que ${mesNome} foi igual à agenda?\n\nTotal: ${H.fmtHoras(min)}\n\nSe algum dia foi diferente, cancele e corrija o dia antes.`)) return;
  const ok = await horasGravar({
    dias: {}, status: 'enviada', semDiferenca: true,
    resumo: { minutosAgenda: min, minutosInformados: min, diasDiferentes: 0 },
    enviadaEm: horasTs(), enviadaPor: currentUserId(), lancadaPelaGestao: false, devolvidaMotivo: null,
  });
  if (!ok) return;
  toast('Mês conferido.', 'success');
  horasDesenhar();
}

/** O professor volta atrás depois de enviar (enquanto a gestão não validou). */
async function horasReabrir() {
  if (HorasState.alvo || HorasState.fechado) return;
  if (HourDeclaration.situacao(HorasState.decl) !== 'enviada') return;
  if (!confirm('Voltar a corrigir este mês?\n\nAs suas horas saem da fila da gestão até você enviar de novo.')) return;
  const ok = await horasGravar({ status: 'rascunho', semDiferenca: false });
  if (ok) horasDesenhar();
}

/* ═══ TELA DA GESTÃO ══════════════════════════════════════════════ */
async function renderHorasGestaoPage() {
  const page = document.getElementById('page-horas-do-mes');
  if (!page) return;
  HorasState.alvo = null;
  const g = HorasState.g;
  if (!horasEhGestao()) {
    page.innerHTML = `<div class="page-toolbar"><div class="lhs"><h2>HORAS DO MÊS</h2></div></div>
      <div class="empty-state"><div class="icon">🔒</div><h3>Tela da gestão</h3>
      <p>Aqui a gestão valida as horas que os professores conferiram.</p></div>`;
    return;
  }
  if (!g.ano) { const p = horasMesPadrao(); g.ano = p.ano; g.mes = p.mes; }
  page.innerHTML = `<div class="loading"><div class="spinner"></div> Carregando…</div>`;
  try {
    await horasCarregarNomes();
    const [classes, decls, tipos] = await Promise.all([
      HourDeclarationService.aulasDoMes(g.ano, g.mes),
      HourDeclarationService.doMes(horasMesStr(g.ano, g.mes)),
      HourDeclarationService.tiposDeEscala(),
    ]);
    g.classes = classes; g.decls = decls; g.erro = null;
    g.tipos = tipos; g.feriados = HourDeclaration.feriadosDasAulas(classes, tipos);
  } catch (err) {
    console.error('[horas gestão] carregar', err);
    g.classes = []; g.decls = []; g.feriados = {}; g.erro = (err && err.message) || 'erro desconhecido';
  }
  horasGestaoDesenhar();
}

/** Atalho de outras telas (fechamento, home): abre a lista já no mês certo — e, com `id`, já nas horas da pessoa. */
function horasGestaoAbrirMes(ano, mes, id) {
  HorasState.g.ano = Number(ano); HorasState.g.mes = Number(mes); HorasState.g.vendo = id || null;
  if (typeof navigateTo === 'function') navigateTo('horas-do-mes');
}
async function horasGestaoMudarMes(valor) {
  const [a, m] = String(valor).split('-').map(Number);
  if (!a || !m) return;
  HorasState.g.ano = a; HorasState.g.mes = m; HorasState.g.vendo = null;
  await renderHorasGestaoPage();
}

/** Quem tem aula que conta no mês (ou já mexeu nas horas), com a situação de cada um. */
function horasGestaoPessoas() {
  const H = HourDeclaration;
  const g = HorasState.g;
  const porPessoa = new Map(g.decls.map(d => [d.teacherId, d]));
  const ids = new Set();
  g.classes.forEach(c => { if (c.teacherId && H.aulaConta(c)) ids.add(c.teacherId); });
  g.decls.forEach(d => { if (d.teacherId) ids.add(d.teacherId); });
  const ordem = { enviada: 0, devolvida: 1, rascunho: 1, nao_conferiu: 1, validada: 3, dispensada: 3 };
  return Array.from(ids).map(id => {
    const agenda = H.agendaDoMes(g.classes, id, g.ano, g.mes, g.tipos);
    const decl = porPessoa.get(id) || null;
    const sit = H.situacao(decl);
    const aValidar = sit === 'enviada' && decl.semDiferenca !== true;
    const temDias = !!decl && Object.keys(decl.dias || {}).length > 0;
    // Dias em dois lugares que NINGUÉM corrigiu ainda: a folha pagaria em dobro.
    const corrigidos = (aValidar || sit === 'rascunho' || sit === 'devolvida') ? ((decl && decl.dias) || {}) : {};
    const emDobro = agenda.filter(a => a.minutosEmDobro > 0 && !(aValidar && corrigidos[a.dia]));
    return {
      id, nome: horasNome(id), agenda, decl, sit, aValidar, temDias, emDobro,
      fechado: g.classes.some(c => c.teacherId === id && !!c.monthClosingId),
      minutosAgenda: agenda.reduce((s, a) => s + a.minutos, 0),
      minutosPagos: agenda.reduce((s, a) => s + a.minutosPagos, 0),
      r: temDias ? H.resumo(agenda, decl, { feriados: g.feriados }) : null,
      pl: aValidar ? H.plano(agenda, decl) : null,
      peso: aValidar ? 0 : (sit === 'enviada' ? 2 : ordem[sit]),
    };
  }).sort((a, b) => (a.peso - b.peso) || String(a.nome).localeCompare(String(b.nome)));
}

function horasGestaoDesenhar() {
  const page = document.getElementById('page-horas-do-mes');
  if (!page) return;
  const H = HourDeclaration;
  const g = HorasState.g;
  const mesNome = horasMesNome(g.ano, g.mes);
  const topo = `<div class="page-toolbar"><div class="lhs"><h2>HORAS DO MÊS</h2></div>
    <div class="rhs">${horasSeletorHtml(g.ano, g.mes, 'horasGestaoMudarMes')}</div></div>`;
  if (g.erro) {
    page.innerHTML = topo + `<div class="empty-state"><div class="icon">⚠️</div><h3>Erro ao carregar</h3><p>${escapeHtml(g.erro)}</p>
      <button class="btn btn-outline" onclick="renderHorasGestaoPage()">Tentar novamente</button></div>`;
    return;
  }
  const pessoas = horasGestaoPessoas();
  if (!pessoas.length) {
    page.innerHTML = topo + `<div class="empty-state"><div class="icon">🕒</div><h3>Nenhuma aula em ${mesNome}</h3>
      <p>Quando houver aula na agenda deste mês, as pessoas aparecem aqui para conferir as horas.</p></div>`;
    return;
  }
  const aValidar = pessoas.filter(p => p.aValidar && !p.fechado);
  const naoConf = pessoas.filter(p => !p.fechado && (p.sit === 'nao_conferiu' || p.sit === 'rascunho' || p.sit === 'devolvida'));
  const cobra = horasMesStr(g.ano, g.mes) >= H.INICIO_CONFERENCIA;
  const pessoasTxt = (n) => `${n} ${n === 1 ? 'pessoa' : 'pessoas'}`;
  const emDobro = pessoas.filter(p => !p.fechado && p.emDobro.length);

  const resumo = `<div class="info-callout" style="margin-bottom:12px;">
      ${aValidar.length
        ? `<p><strong>${pessoasTxt(aValidar.length)} esperando o seu OK.</strong> O que o professor informa <strong>só entra na folha depois de validado</strong> — e horas sem validar travam o fechamento.</p>
           <p><button class="btn btn-primary btn-sm" onclick="horasGestaoValidarTodas()">Validar todas (${pessoasTxt(aValidar.length)})</button></p>`
        : `<p><strong>Nada esperando o seu OK em ${mesNome}.</strong></p>`}
      ${naoConf.length
        ? `<p><strong>${pessoasTxt(naoConf.length)} ainda não ${naoConf.length === 1 ? 'conferiu' : 'conferiram'}.</strong> ${cobra
            ? `Isso trava o fechamento de ${mesNome}: ou a pessoa confere, ou você decide em "Fechar valendo a agenda" (use "Ver as horas" antes).`
            : `Em ${mesNome} isso não trava o fechamento — a conferência passa a ser cobrada a partir de ${horasMesNome(...H.INICIO_CONFERENCIA.split('-').map(Number))}.`}</p>`
        : ''}
      ${emDobro.length
        ? `<p>⚠️ <strong>${pessoasTxt(emDobro.length)} em dois lugares ao mesmo tempo:</strong> ${emDobro.map(p => escapeHtml(p.nome)).join(', ')}.
            A agenda conta o mesmo horário duas vezes (em geral, cobriu um colega e a aula própria continuou no nome dela) — <strong>isso trava o fechamento</strong>.
            Para acertar: "Lançar as horas" (ou "Corrigir") na linha da pessoa, "Corrigir" no dia marcado, confirmar os horários e validar. Se outra pessoa deu a aula que sobrou, registre a troca em Substituições.</p>`
        : ''}
    </div>`;

  page.innerHTML = topo + resumo + `<div class="horas-lista">${pessoas.map(horasGestaoLinhaHtml).join('')}</div>`;
}

function horasGestaoLinhaHtml(p) {
  const H = HourDeclaration;
  const aberto = HorasState.g.vendo === p.id;
  let chip, texto = '';
  if (p.fechado) { chip = `<span class="chip-mini chip-green">Mês fechado</span>`; }
  else if (p.aValidar) {
    chip = `<span class="chip-mini chip-orange">${H.ROTULOS.enviada}</span>`;
    texto = `informou ${H.fmtHoras(p.r ? p.r.minutosInformados : p.minutosAgenda)} · <b>${p.r && p.r.delta ? H.fmtHoras(p.r.delta, { sinal: true }) : 'sem diferença no total'}</b>`
      + ` em ${p.r ? p.r.diasComMudanca : 0} ${p.r && p.r.diasComMudanca === 1 ? 'dia' : 'dias'}${p.decl.lancadaPelaGestao ? ' · lançado pela gestão' : ''}`;
  } else if (p.sit === 'enviada') { chip = `<span class="chip-mini chip-green">Conferiu</span>`; texto = 'tudo igual à agenda'; }
  else if (p.sit === 'validada') {
    const ap = p.decl.aplicado || {};
    chip = `<span class="chip-mini chip-green">${H.ROTULOS.validada}</span>`;
    texto = `${ap.deltaMinutos ? (ap.deltaMinutos > 0 ? 'entraram' : 'saíram') + ' <b>' + H.fmtHoras(Math.abs(ap.deltaMinutos)) + '</b>' : 'sem mudança no total'}`
      + `${ap.minutosPendentes ? ' · ' + H.fmtHoras(ap.minutosPendentes) + ' dependem de troca' : ''}`;
  } else if (p.sit === 'dispensada') { chip = `<span class="chip-mini chip-green">${H.ROTULOS.dispensada}</span>`; }
  else if (p.sit === 'devolvida') { chip = `<span class="chip-mini chip-yellow">${H.ROTULOS.devolvida}</span>`; texto = `"${escapeHtml(p.decl.devolvidaMotivo || '')}"`; }
  else if (p.sit === 'rascunho') { chip = `<span class="chip-mini chip-yellow">${H.ROTULOS.rascunho}</span>`; texto = p.r ? `${p.r.diasComMudanca} dia(s) corrigido(s) até agora` : ''; }
  else { chip = `<span class="chip-mini chip-yellow">${H.ROTULOS.nao_conferiu}</span>`; }

  const b = (rotulo, fn, cls) => `<button class="btn ${cls || 'btn-ghost'} btn-sm" onclick="${fn}('${p.id}')">${rotulo}</button>`;
  if (!p.fechado && p.emDobro.length) {
    chip += ` <span class="chip-mini chip-orange">⚠️ em dois lugares: ${p.emDobro.map(a => a.dia.slice(8, 10) + '/' + a.dia.slice(5, 7)).join(', ')}</span>`;
  }
  const ver = b(aberto ? 'Fechar' : (p.aValidar ? 'Ver o que muda' : 'Ver as horas'), 'horasGestaoVer', 'btn-outline');
  let botoes = ver;
  if (!p.fechado) {
    if (p.aValidar) botoes += b('Validar', 'horasGestaoValidar', 'btn-primary') + b('Devolver', 'horasGestaoDevolver') + b('Corrigir', 'horasGestaoCorrigir');
    else if (p.sit === 'enviada') botoes += b('Devolver', 'horasGestaoDevolver');
    else if (p.sit === 'validada' || p.sit === 'dispensada') botoes += b('Corrigir', 'horasGestaoCorrigir');
    else botoes += b('Lançar as horas', 'horasGestaoCorrigir') + b('Fechar valendo a agenda', 'horasGestaoDispensar');
  }
  return `<div class="horas-dia horas-pessoa${p.aValidar ? ' horas-dia-mudou' : ''}">
      <div class="horas-dia-cab">
        <div class="horas-dia-data" style="min-width:150px;"><b>${escapeHtml(p.nome)}</b><div class="horas-sub">agenda: ${H.fmtHoras(p.minutosAgenda)}${p.minutosPagos !== p.minutosAgenda ? ` · para pagamento: ${H.fmtHoras(p.minutosPagos)}` : ''}</div></div>
        <div class="horas-dia-info">${chip}${texto ? `<div class="horas-sub" style="margin-top:4px;">${texto}</div>` : ''}</div>
        <div class="horas-dia-acoes">${botoes}</div>
      </div>
      ${aberto ? horasGestaoDetalheHtml(p) : ''}
    </div>`;
}

/** O que a pessoa informou, dia a dia, e o que isso muda nas aulas. Sem declaração, a agenda. */
/**
 * Um dia informado "no lugar de um colega": o que a agenda tem do colega e o
 * botão que passa as aulas para quem trabalhou. Até 06/10/2026 a tela só dizia
 * "registre a troca em Substituições" — e a gestão tinha que refazer à mão o
 * que o professor já tinha informado.
 */
function horasPendenciaHtml(p, dia, turnos, colegaId) {
  const H = HourDeclaration;
  const x = H.aulasDoColega(HorasState.g.classes, { dia, turnos, colegaId, pessoaId: p.id });
  const colega = escapeHtml(horasNome(colegaId));
  const lista = (l) => l.map(c => `${c.startTime}–${c.endTime} · ${escapeHtml(horasUnidade(c.unitId))}${c.isHoliday === true || c.specialScaleType === 'feriado' ? ' · feriado' : ''}`).join(', ');
  if (x.aTransferir.length) {
    return `Na agenda desse dia, ${colega} tem: <b>${lista(x.aTransferir)}</b>.
      ${p.fechado ? '' : `<button class="btn btn-primary btn-sm" style="width:auto;margin-left:6px;" onclick="horasGestaoPassarAulas('${p.id}','${dia}')">Passar para ${escapeHtml(p.nome)}</button>`}
      <div class="horas-sub">A aula sai do nome de ${colega} e entra no de ${escapeHtml(p.nome)}; o pagamento acompanha. É a troca de professor, já confirmada por você.</div>`;
  }
  if (x.jaComAPessoa.length) return `✅ Troca registrada: ${lista(x.jaComAPessoa)} já ${x.jaComAPessoa.length === 1 ? 'está' : 'estão'} no nome de ${escapeHtml(p.nome)}.`;
  return `Não achei aula de ${colega} nesse horário na agenda do dia. Confira com os dois e, se for o caso, registre a troca em Substituições.`;
}

function horasGestaoDetalheHtml(p) {
  const H = HourDeclaration;
  if (!p.temDias || p.sit === 'validada' || p.sit === 'dispensada') {
    const dias = p.agenda.map(a => {
      const colegas = Array.from(new Set(a.aulas.map(x => x.noLugarDe).filter(Boolean)));
      return `<div class="horas-det-dia"><b>${horasDiaTexto(a.dia)}</b> · ${horasTurnosTxt(a.turnos)}${a.unidades.length ? ' · ' + escapeHtml(horasUnidadesTxt(a.unidades)) : ''} · <b>${H.fmtHoras(a.minutos)}</b>
        ${horasChipPeso(a)}${a.peso !== 1 ? ` <span class="horas-sub">na folha: ${H.fmtHoras(a.minutosPagos)}</span>` : ''}
        ${colegas.length ? `<span class="chip-mini chip-green">troca · no lugar de ${colegas.map(c => escapeHtml(horasNome(c))).join(', ')}</span>` : ''}
        ${horasDoisLugaresHtml(a, escapeHtml(p.nome), '')}</div>`;
    }).join('');
    const pendencias = (p.sit === 'validada' && p.decl.aplicado && p.decl.aplicado.pendencias) || [];
    const porDiaPend = new Map();
    pendencias.forEach(x => { if (!porDiaPend.has(x.dia)) porDiaPend.set(x.dia, []); porDiaPend.get(x.dia).push(x); });
    const pend = pendencias.length
      ? `<div class="horas-det-rodape">Informado <b>no lugar de um colega</b> — só entra quando a aula passar para ${escapeHtml(p.nome)}:
          ${Array.from(porDiaPend.entries()).map(([dia, l]) => `<div class="horas-det-dia"><b>${horasDiaTexto(dia)}</b> · ${l.map(x => `${x.inicio}–${x.fim}`).join(' · ')} · no lugar de ${escapeHtml(horasNome(l[0].noLugarDe))}<br>
            ${horasPendenciaHtml(p, dia, l.map(x => ({ inicio: x.inicio, fim: x.fim })), l[0].noLugarDe)}</div>`).join('')}</div>` : '';
    const total = `<div class="horas-det-rodape">Trabalhadas: <b>${H.fmtHoras(p.minutosAgenda)}</b>${p.minutosPagos !== p.minutosAgenda
      ? ` · Para pagamento: <b>${H.fmtHoras(p.minutosPagos)}</b> <span class="horas-sub">(${p.agenda.filter(a => a.peso !== 1).map(a => `${a.dia.slice(8, 10)}/${a.dia.slice(5, 7)}${a.feriado ? ', feriado,' : ''} conta ${a.peso === 2 ? 'em dobro' : '×' + String(a.peso).replace('.', ',')}`).join('; ')})</span>` : ''}</div>`;
    return `<div class="horas-detalhe"><div class="horas-sub" style="margin-bottom:6px;">O que a agenda registra em ${horasMesNome(HorasState.g.ano, HorasState.g.mes)}:</div>
      ${dias ? dias + total : '<div class="horas-sub">Nenhuma aula que conta neste mês.</div>'}${pend}</div>`;
  }
  const pl = p.pl || H.plano(p.agenda, p.decl);
  const porDia = new Map(pl.porDia.map(x => [x.dia, x]));
  const blocos = p.r.dias.filter(l => l.declarado).map(l => {
    const pd = porDia.get(l.dia) || { ops: [], novas: [], pendencias: [] };
    const itens = [];
    pd.novas.forEach(n => itens.push(`${n.inicio}–${n.fim} — <b>turno novo</b> (${H.fmtHoras(n.minutos)}): vira aula na agenda da pessoa`));
    pd.ops.forEach(op => {
      const un = op.unitId && (l.unidades || []).length > 1 ? ` (${escapeHtml(horasUnidade(op.unitId))})` : '';
      if (op.campos.status === 'nao_realizada') {
        itens.push(op.motivo === 'dois_lugares'
          ? `${op.inicio}–${op.fim}${un} — <b>sai da conta</b>: no mesmo horário a pessoa estava em outra aula (a da troca confirmada). A hora conta uma vez só. Se outra pessoa deu esta aula, registre a troca em Substituições.`
          : `${op.inicio}–${op.fim}${un} — <b>não realizada</b>: sai da conta de horas`);
        return;
      }
      const c = op.campos, partes = [];
      if (op.motivo === 'dois_lugares') partes.push('parte do horário já conta em outra aula');
      if (c.atrasoMinutos) partes.push(`entrou ${horasMinTxt(c.atrasoMinutos)} depois`);
      if (c.saidaAntecipadaMinutos) partes.push(`saiu ${horasMinTxt(c.saidaAntecipadaMinutos)} antes`);
      if (c.horaExtraMinutos) partes.push(`+${horasMinTxt(c.horaExtraMinutos)} além do horário`);
      itens.push(`${op.inicio}–${op.fim}${un} — ${partes.length ? partes.join(', ') : 'volta ao horário cheio'}`);
    });
    if (pd.pendencias.length) {
      itens.push(`<b>no lugar de ${escapeHtml(horasNome(pd.pendencias[0].noLugarDe))}</b>: só entra quando a aula passar para ${escapeHtml(p.nome)} — senão os dois receberiam.<br>`
        + horasPendenciaHtml(p, l.dia, pd.pendencias.map(x => ({ inicio: x.inicio, fim: x.fim })), pd.pendencias[0].noLugarDe));
    }
    if (l.erro) itens.push(`<span class="horas-menos">${escapeHtml(l.erro)}</span>`);
    if (!itens.length) itens.push('sem mudança nas aulas');
    const de = l.turnosAgenda.length ? horasTurnosTxt(l.turnosAgenda) : 'fora da agenda';
    // A tela fala em horas TRABALHADAS. Em feriado a folha paga em dobro — dizer
    // aqui evita a gestão validar "+2h" e estranhar "+4h" no fechamento.
    const para = l.naoTrabalhei ? 'não trabalhou' : horasTurnosTxt(l.turnosInformados);
    return `<div class="horas-det-dia"><b>${horasDiaTexto(l.dia)}</b> · ${de} → <b>${para}</b>
        ${l.delta ? `<span class="chip-mini ${l.delta < 0 ? 'chip-yellow' : 'chip-green'}">${H.fmtHoras(l.delta, { sinal: true })}</span>` : ''}
        ${horasChipPeso(l)}
        ${horasDoisLugaresHtml(l, escapeHtml(p.nome), 'Ao validar, fica a aula da troca confirmada e a outra sai (veja abaixo).')}
        ${l.obs ? `<div class="horas-sub">"${escapeHtml(l.obs)}"</div>` : ''}
        <ul>${itens.map(i => `<li>${i}</li>`).join('')}</ul></div>`;
  }).join('');
  const dias = new Set(Object.keys(p.decl.dias || {}));
  const avisos = HorasState.g.classes.filter(c => c.teacherId === p.id && c.avisoProfessor && dias.has(H.diaISO(c.scheduledDate))).length;
  return `<div class="horas-detalhe">${blocos}
      <div class="horas-det-rodape">Se validar: <b>${pl.deltaMinutos ? H.fmtHoras(pl.deltaMinutos, { sinal: true }) : 'nenhuma mudança'}</b> na conta de horas.
        ${pl.minutosPendentes ? ` ${H.fmtHoras(pl.minutosPendentes)} informadas no lugar de um colega não entram por aqui.` : ''}
        ${avisos ? ` ${avisos} aviso(s) da pessoa nesses dias ${avisos === 1 ? 'fica respondido' : 'ficam respondidos'}: vale o horário informado aqui.` : ''}</div>
    </div>`;
}

/**
 * Passa para a pessoa as aulas do colega no dia que ela informou "no lugar de".
 * É a troca de professor de sempre (registro + confirmação da gestão): a
 * Function move a aula, a escala acompanha e os dois são avisados.
 */
async function horasGestaoPassarAulas(id, dia) {
  const H = HourDeclaration;
  if (!horasEhGestao()) return;
  const g = HorasState.g;
  const p = horasGestaoPessoas().find(x => x.id === id);
  const dec = p && p.decl && p.decl.dias ? p.decl.dias[dia] : null;
  if (!p || !dec || !dec.noLugarDe) { toast('Não achei esse dia nas horas informadas — atualize a tela.', 'error'); return; }
  if (typeof SubstitutionService !== 'object') { toast('Não consegui registrar a troca por aqui. Use Substituições.', 'error'); return; }
  const x = H.aulasDoColega(g.classes, { dia, turnos: dec.turnos || [], colegaId: dec.noLugarDe, pessoaId: id });
  if (!x.aTransferir.length) { toast('Nenhuma aula do colega para passar nesse horário.', 'info'); return; }
  if (x.aTransferir.some(c => !!c.monthClosingId)) { toast('O mês dessa aula já foi fechado.', 'error'); return; }
  const colega = horasNome(dec.noLugarDe);
  const quando = `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
  const lista = x.aTransferir.map(c => `• ${c.startTime}–${c.endTime} · ${horasUnidade(c.unitId)}${c.isHoliday === true || c.specialScaleType === 'feriado' ? ' · feriado (conta em dobro)' : ''}`).join('\n');
  if (!confirm(`Passar para ${p.nome} ${x.aTransferir.length === 1 ? 'a aula' : 'as aulas'} de ${colega} em ${quando}?\n\n${lista}\n\n`
    + `${x.aTransferir.length === 1 ? 'A aula sai' : 'As aulas saem'} do nome de ${colega} e ${x.aTransferir.length === 1 ? 'entra' : 'entram'} no de ${p.nome}; o pagamento acompanha. Os dois são avisados.`)) return;

  const motivo = `Informado por ${p.nome} em Minhas horas do mês${dec.obs ? ': ' + dec.obs : ''}`;
  let feitas = 0; const falhas = [];
  for (const c of x.aTransferir) {
    const res = await SubstitutionService.create({ classId: c.id, substituteTeacherId: id, reason: motivo, registradoPor: 'gestao' });
    if (!res.success) { falhas.push(`${c.startTime}: ${res.error || 'falha'}`); continue; }
    const hom = await SubstitutionService.homologar(res.data.id, motivo);
    if (!hom.success) { falhas.push(`${c.startTime}: registrada, mas não confirmada (${hom.error || 'falha'}) — confirme em Substituições`); continue; }
    feitas++;
  }
  if (falhas.length) toast(`${feitas} aula(s) passada(s). Não consegui — ${falhas.join(' · ')}`, 'error', 10000);
  if (!feitas) return;

  // Quem move a aula é a Function, alguns segundos depois da confirmação.
  const ids = x.aTransferir.map(c => c.id);
  let moveu = false;
  for (let i = 0; i < 12 && !moveu; i++) {
    await horasEsperar(1500);
    try {
      const docs = await Promise.all(ids.map(cid => db.collection('classes').doc(cid).get()));
      moveu = docs.some(d => d.exists && d.data().teacherId === id);
    } catch (e) { /* tenta de novo */ }
  }
  if (!falhas.length) {
    toast(moveu ? `Pronto: ${feitas === 1 ? 'a aula já está' : 'as aulas já estão'} no nome de ${p.nome}.`
      : 'Troca confirmada. A agenda leva alguns instantes para atualizar — abra a tela de novo daqui a pouco.', moveu ? 'success' : 'info', 7000);
  }
  await renderHorasGestaoPage();
  HorasState.g.vendo = id;
  horasGestaoDesenhar();
}

function horasGestaoVer(id) {
  HorasState.g.vendo = HorasState.g.vendo === id ? null : id;
  horasGestaoDesenhar();
}

async function horasAvisarProfessor(teacherId, type, title, body) {
  const t = AgendaState.teachersMap.get(teacherId);
  if (!t || !t.userId || typeof NotifyService !== 'object') return false;
  try {
    const r = await NotifyService.send({ recipients: [t.userId], type, title, body, link: { type: 'minhas-horas' }, channels: ['inapp'] });
    return !!(r && r.success);
  } catch (e) { console.warn('[horas] aviso', e && e.message); return false; }
}

/** Valida UMA pessoa e avisa. Devolve o resultado do serviço. */
async function horasGestaoAplicar(p) {
  const H = HourDeclaration;
  const g = HorasState.g;
  const res = await HourDeclarationService.validar(p.id, horasMesStr(g.ano, g.mes));
  if (!res.success) return res;
  const ap = res.data;
  const corpo = `A gestão validou as suas horas de ${horasMesNome(g.ano, g.mes)}: `
    + (ap.deltaMinutos ? `${ap.deltaMinutos > 0 ? 'entraram' : 'saíram'} ${H.fmtHoras(Math.abs(ap.deltaMinutos))} ${ap.deltaMinutos > 0 ? 'na' : 'da'} sua conta de horas.` : 'o total não mudou.')
    + (ap.minutosPendentes ? ` ${H.fmtHoras(ap.minutosPendentes)} que você informou no lugar de um colega não entram por aqui: dependem de a troca ser registrada em Substituições.` : '');
  await horasAvisarProfessor(p.id, 'horas_validadas', 'Suas horas do mês foram validadas', corpo);
  return res;
}

async function horasGestaoValidar(id) {
  const H = HourDeclaration;
  const p = horasGestaoPessoas().find(x => x.id === id);
  if (!p) { toast('Pessoa não encontrada — atualize a tela.', 'error'); return; }
  if (p.fechado) { toast(`Mês já fechado — as horas de ${p.nome} não podem mais ser ajustadas.`, 'error'); return; }
  if (!p.aValidar) {
    toast(p.sit === 'validada' ? `As horas de ${p.nome} já foram validadas.` : `${p.nome} não tem horas enviadas esperando validação.`, 'info');
    return;
  }
  if (p.pl.erros.length) { toast('Há dia com horário inválido: ' + p.pl.erros.join(' · ') + '. Devolva para corrigir.', 'error'); return; }
  const mesNome = horasMesNome(HorasState.g.ano, HorasState.g.mes);
  const msg = `Validar as horas de ${p.nome} em ${mesNome}?\n\n`
    + (p.pl.deltaMinutos ? `${p.pl.deltaMinutos > 0 ? 'Entram' : 'Saem'} ${H.fmtHoras(Math.abs(p.pl.deltaMinutos))} ${p.pl.deltaMinutos > 0 ? 'na' : 'da'} conta de horas.` : 'O total de horas não muda.')
    + (p.pl.minutosPendentes ? `\n${H.fmtHoras(p.pl.minutosPendentes)} informadas no lugar de um colega NÃO entram: dependem da troca.` : '')
    + `\n\nAs aulas são ajustadas agora e é isso que a folha vai pagar.`;
  if (!confirm(msg)) return;
  const res = await horasGestaoAplicar(p);
  if (!res.success) { toast('Não validei: ' + (res.error || 'falha'), 'error'); return; }
  toast(`Horas de ${p.nome} validadas.`, 'success');
  HorasState.g.vendo = null;
  await renderHorasGestaoPage();
}

/** O "OK geral": valida de uma vez todo mundo que está esperando. */
async function horasGestaoValidarTodas() {
  const H = HourDeclaration;
  const lista = horasGestaoPessoas().filter(p => p.aValidar && !p.fechado);
  if (!lista.length) { toast('Ninguém esperando validação neste mês.', 'info'); return; }
  const comErro = lista.filter(p => p.pl.erros.length);
  if (comErro.length) { toast(`${comErro[0].nome} tem dia com horário inválido. Devolva para corrigir antes do OK geral.`, 'error'); return; }
  const linhas = lista.map(p => `• ${p.nome}: ${p.pl.deltaMinutos ? H.fmtHoras(p.pl.deltaMinutos, { sinal: true }) : 'sem mudança no total'}`
    + (p.pl.minutosPendentes ? ` (${H.fmtHoras(p.pl.minutosPendentes)} dependem de troca)` : '')).join('\n');
  if (!confirm(`Validar as horas de ${lista.length} ${lista.length === 1 ? 'pessoa' : 'pessoas'} em ${horasMesNome(HorasState.g.ano, HorasState.g.mes)}?\n\n${linhas}\n\nAs aulas são ajustadas agora e é isso que a folha vai pagar.`)) return;
  let ok = 0; const falhas = [];
  for (const p of lista) {
    const res = await horasGestaoAplicar(p);
    if (res.success) ok++; else falhas.push(`${p.nome}: ${res.error || 'falha'}`);
  }
  if (falhas.length) toast(`${ok} validada(s). Não validei — ${falhas.join(' · ')}`, 'error', 9000);
  else toast(`${ok} ${ok === 1 ? 'pessoa validada' : 'pessoas validadas'}.`, 'success');
  HorasState.g.vendo = null;
  await renderHorasGestaoPage();
}

async function horasGestaoDevolver(id) {
  const p = horasGestaoPessoas().find(x => x.id === id);
  if (!p || p.fechado || p.sit !== 'enviada') { toast('Só dá para devolver o que foi enviado e ainda não foi validado.', 'error'); return; }
  const motivo = prompt(`Devolver as horas de ${p.nome} para corrigir?\n\nEscreva o que precisa ser corrigido — é o que a pessoa vai ler:`);
  if (motivo === null) return;
  if (!motivo.trim()) { toast('Escreva o que precisa ser corrigido.', 'error'); return; }
  const g = HorasState.g;
  const res = await HourDeclarationService.devolver(id, horasMesStr(g.ano, g.mes), motivo.trim());
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); return; }
  await horasAvisarProfessor(id, 'horas_devolvidas', 'A gestão devolveu as suas horas para corrigir',
    `Suas horas de ${horasMesNome(g.ano, g.mes)} voltaram para corrigir: "${motivo.trim()}". Abra Minhas horas, corrija e envie de novo.`);
  toast(`Devolvido para ${p.nome}.`, 'success');
  await renderHorasGestaoPage();
}

async function horasGestaoDispensar(id) {
  const H = HourDeclaration;
  const p = horasGestaoPessoas().find(x => x.id === id);
  if (!p || p.fechado) { toast('Mês já fechado.', 'error'); return; }
  if (p.sit === 'enviada' || p.sit === 'validada') { toast(`${p.nome} já conferiu este mês.`, 'error'); return; }
  const g = HorasState.g;
  const mesNome = horasMesNome(g.ano, g.mes);
  if (!confirm(`Fechar as horas de ${p.nome} em ${mesNome} valendo a agenda (${H.fmtHoras(p.minutosAgenda)})?\n\n`
    + `Essa pessoa não conferiu o mês: vai valer o que a agenda registrou${p.temDias ? ', e o que ela começou a corrigir e não enviou fica de fora' : ''}. `
    + `Fica gravado que a decisão foi sua.`)) return;
  const res = await HourDeclarationService.dispensar(id, horasMesStr(g.ano, g.mes));
  if (!res.success) { toast('Erro: ' + (res.error || 'falha'), 'error'); return; }
  await horasAvisarProfessor(id, 'horas_dispensadas', 'Suas horas do mês foram fechadas pela agenda',
    `Como as horas de ${mesNome} não foram conferidas, a gestão fechou valendo a agenda (${H.fmtHoras(p.minutosAgenda)}). Se algo está errado, fale com a gestão.`);
  toast(`${p.nome}: fechado valendo a agenda.`, 'success');
  await renderHorasGestaoPage();
}

/** A gestão lança as horas por alguém — a lista chegou por WhatsApp, ou a pessoa não usa o app. */
async function horasGestaoCorrigir(id) {
  if (!horasEhGestao()) return;
  const g = HorasState.g;
  if (g.classes.some(c => c.teacherId === id && !!c.monthClosingId)) { toast('Mês já fechado.', 'error'); return; }
  HorasState.alvo = id; HorasState.teacherId = id; HorasState.ano = g.ano; HorasState.mes = g.mes;
  await horasCarregar();
  horasDesenhar();
}
async function horasGestaoVoltar() {
  HorasState.alvo = null; HorasState.teacherId = null; HorasState.editor = null;
  await renderHorasGestaoPage();
}

Object.assign(window, {
  HourDeclarationService,
  renderMinhasHorasPage, horasMudarMes, horasAbrirDia, horasFecharEditor, horasSetTurno, horasAddTurno, horasRemTurno,
  horasNaoTrabalhei, horasSetFora, horasSetNoLugarDe, horasSetObs, horasNovoDia, horasConfirmarDia, horasVoltarAgenda,
  horasEnviar, horasConfirmarIgual, horasReabrir,
  renderHorasGestaoPage, horasGestaoAbrirMes, horasGestaoMudarMes, horasGestaoVer, horasGestaoValidar, horasGestaoValidarTodas,
  horasGestaoDevolver, horasGestaoDispensar, horasGestaoCorrigir, horasGestaoVoltar, horasGestaoPassarAulas,
});

console.log('[CrossTainer Professores] professores-horas.js carregado · horas do mês');
