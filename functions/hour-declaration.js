// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Minhas horas do mês (puro, sem Firestore)
//
// O professor confere o mês de uma vez: a tela mostra o que a AGENDA diz, dia
// por dia, em turnos (entrada e saída), e ele corrige só os dias que foram
// diferentes. A gestão valida — e é aí que a correção passa a valer.
//
// Pedido do grupo (30/09/2026): "a galera coloca lá as horas que fez, sem ter
// que ir de hora em hora". O caso que motivou: o Theo Rosa mandou as horas de
// setembro pelo WhatsApp — 167h15 contra 139h30 da agenda — e a maior parte da
// diferença não tinha onde ser informada (turno que não existia na grade,
// entrada antes do horário).
//
// A DECISÃO DE PROJETO: a correção validada vira ajuste nas PRÓPRIAS AULAS —
// atraso, saída antecipada, tempo além, aula não realizada, turno novo. Não
// existe "ajuste de horas" paralelo. A folha (closing-payroll.js), o banco de
// horas, os relatórios e o PLR continuam lendo as aulas, do mesmo jeito de
// sempre. Um segundo cálculo foi exatamente o que duplicou a bolsa em agosto.
//
// Aqui moram as contas: a agenda em turnos, a validação do que foi digitado,
// o resumo e o PLANO (o que muda em cada aula). Quem grava é a tela da gestão.
// ═══════════════════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HourDeclaration = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // A cobrança de "quem não conferiu" começa neste mês. Antes dele o
  // fechamento segue como sempre foi (agosto e setembro de 2026 não podem
  // travar porque ninguém conferiu uma tela que não existia).
  const INICIO_CONFERENCIA = '2026-10';
  const STATUS_ATIVOS = ['prevista', 'realizada', 'substituida'];   // aula que está de pé
  const MAX_MINUTOS_DIA = 16 * 60;      // acima disso é erro de digitação
  const TETO_EXTRA_AULA = 600;          // mesmo teto das ocorrências (10h)

  const ROTULOS = {
    nao_conferiu: 'Ainda não conferiu',
    rascunho: 'Começou e não enviou',
    enviada: 'Esperando a gestão',
    validada: 'Validada',
    devolvida: 'Devolvida para corrigir',
    dispensada: 'Fechada valendo a agenda',
  };

  /* ── horas e minutos ─────────────────────────────────────────────── */
  function paraMin(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm == null ? '' : hhmm).trim());
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    return (h > 23 || mi > 59) ? null : h * 60 + mi;
  }
  function paraHHMM(min) {
    const z = (n) => String(n).padStart(2, '0');
    return `${z(Math.floor(min / 60))}:${z(min % 60)}`;
  }
  /** 8370 → "139h30"; com `sinal`, 1665 → "+27h45" e -90 → "−1h30". */
  function fmtHoras(min, opts) {
    const n = Math.round(Number(min) || 0);
    const a = Math.abs(n);
    const corpo = `${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`;
    if (n < 0) return '−' + corpo;
    return (opts && opts.sinal && n > 0) ? '+' + corpo : corpo;
  }
  /** 'YYYY-MM-DD' local de um scheduledDate (Timestamp, Date ou texto). */
  function diaISO(v) {
    const d = v && v.toDate ? v.toDate() : (v ? new Date(v) : null);
    if (!d || isNaN(d)) return null;
    const z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }
  const num = (v) => (typeof v === 'number' && v > 0 ? v : 0);

  /** Aula que entra na conta de horas: de pé e remunerada (Escola Interna não paga). */
  function aulaConta(c) {
    return !!c && STATUS_ATIVOS.indexOf(c.status) !== -1
      && c.remunerada !== false && c.specialScaleType !== 'escola_interna';
  }
  /** Mesma conta do closing-payroll: duração − atraso − saída + tempo além. */
  function minutosDaAula(c) {
    if (c.faltaTipo) return 0;
    const base = (typeof c.durationMinutes === 'number' && c.durationMinutes > 0) ? c.durationMinutes : 0;
    return Math.max(0, base - num(c.atrasoMinutos) - num(c.saidaAntecipadaMinutos) + num(c.horaExtraMinutos));
  }

  /* ── a agenda do mês, por dia ────────────────────────────────────── */
  /**
   * O mês de uma pessoa como a agenda registra, um item por dia. As aulas
   * seguidas viram um TURNO só (entrada e saída) — é o que tira o "de hora em
   * hora" da tela.
   * @returns {Array<{dia, aulas:Array, turnos:Array<{inicio,fim}>, minutos:number}>}
   */
  function agendaDoMes(classes, teacherId, ano, mes) {
    const prefixo = `${ano}-${String(mes).padStart(2, '0')}`;
    const porDia = new Map();
    (classes || []).forEach(c => {
      if (!c || c.teacherId !== teacherId || !aulaConta(c)) return;
      const dia = diaISO(c.scheduledDate);
      const ini = paraMin(c.startTime), fim = paraMin(c.endTime);
      if (!dia || dia.slice(0, 7) !== prefixo || ini == null || fim == null || fim <= ini) return;
      if (!porDia.has(dia)) porDia.set(dia, []);
      porDia.get(dia).push({
        id: c.id, inicio: paraHHMM(ini), fim: paraHHMM(fim), ini, fimMin: fim, duracao: fim - ini,
        minutos: minutosDaAula(c), status: c.status,
        atraso: num(c.atrasoMinutos), saida: num(c.saidaAntecipadaMinutos), extra: num(c.horaExtraMinutos),
        unitId: c.unitId || null, modalityId: c.modalityId || null,
        isHoliday: c.isHoliday === true, holidayName: c.holidayName || null, monthClosingId: c.monthClosingId || null,
      });
    });
    return Array.from(porDia.keys()).sort().map(dia => {
      const aulas = porDia.get(dia).sort((a, b) => a.ini - b.ini);
      const turnos = [];
      aulas.forEach(a => {
        const ult = turnos[turnos.length - 1];
        if (ult && a.ini <= ult.fimMin) ult.fimMin = Math.max(ult.fimMin, a.fimMin);
        else turnos.push({ ini: a.ini, fimMin: a.fimMin });
      });
      return {
        dia, aulas,
        turnos: turnos.map(x => ({ inicio: paraHHMM(x.ini), fim: paraHHMM(x.fimMin) })),
        minutos: aulas.reduce((s, a) => s + a.minutos, 0),
      };
    });
  }

  /* ── o que a pessoa digitou ──────────────────────────────────────── */
  /**
   * Confere um dia da declaração. Horário impossível vira `erro`, nunca zero.
   * @returns {{ok:boolean, erro:string, turnos:Array<{ini:number, fim:number}>}}
   */
  function validarDia(d) {
    const falha = (erro) => ({ ok: false, erro, turnos: [] });
    if (!d) return falha('Dia sem informação.');
    if (d.naoTrabalhei === true) return { ok: true, erro: '', turnos: [] };
    const brutos = Array.isArray(d.turnos) ? d.turnos : [];
    if (!brutos.length) return falha('Informe ao menos um turno, ou marque "Não trabalhei".');
    const turnos = [];
    for (const t of brutos) {
      const ini = paraMin(t && t.inicio), fim = paraMin(t && t.fim);
      if (ini == null || fim == null) return falha('Horário inválido. Use hora e minuto, como 14:05.');
      if (fim <= ini) return falha('A saída tem que ser depois da entrada.');
      turnos.push({ ini, fim });
    }
    turnos.sort((a, b) => a.ini - b.ini);
    for (let i = 1; i < turnos.length; i++) {
      if (turnos[i].ini < turnos[i - 1].fim) return falha('Dois turnos se cruzam. Confira os horários.');
    }
    if (turnos.reduce((s, t) => s + (t.fim - t.ini), 0) > MAX_MINUTOS_DIA) {
      return falha('Mais de 16 horas num dia só — confira os horários.');
    }
    return { ok: true, erro: '', turnos };
  }
  function minutosDoDia(d) {
    const v = validarDia(d);
    return v.ok ? v.turnos.reduce((s, t) => s + (t.fim - t.ini), 0) : 0;
  }
  const mesmosTurnos = (agendaTurnos, turnos) =>
    agendaTurnos.length === turnos.length
    && agendaTurnos.every((t, i) => paraMin(t.inicio) === turnos[i].ini && paraMin(t.fim) === turnos[i].fim);

  /* ── o resumo do mês ─────────────────────────────────────────────── */
  /**
   * Agenda × informado, dia por dia. Dia que a pessoa não mexeu vale a agenda.
   * Dia que só existe na declaração (trabalhou fora da agenda) entra na lista.
   */
  function resumo(agenda, declaracao) {
    const dias = (declaracao && declaracao.dias) || {};
    const porDia = new Map((agenda || []).map(a => [a.dia, a]));
    const todos = Array.from(new Set(Array.from(porDia.keys()).concat(Object.keys(dias)))).sort();
    const out = { minutosAgenda: 0, minutosInformados: 0, delta: 0, diasDiferentes: 0, diasComMudanca: 0, dias: [] };
    todos.forEach(dia => {
      const ag = porDia.get(dia) || null;
      const dec = dias[dia] || null;
      const minutosAgenda = ag ? ag.minutos : 0;
      const v = dec ? validarDia(dec) : null;
      const minutosInformados = dec ? (v.ok ? v.turnos.reduce((s, t) => s + (t.fim - t.ini), 0) : 0) : minutosAgenda;
      const mudou = !!dec && (dec.naoTrabalhei === true || !ag || !v.ok || !mesmosTurnos(ag.turnos, v.turnos));
      const linha = {
        dia, declarado: !!dec, mudou,
        minutosAgenda, minutosInformados, delta: minutosInformados - minutosAgenda,
        turnosAgenda: ag ? ag.turnos : [],
        turnosInformados: dec && v.ok ? v.turnos.map(t => ({ inicio: paraHHMM(t.ini), fim: paraHHMM(t.fim) })) : [],
        naoTrabalhei: !!(dec && dec.naoTrabalhei === true),
        foraDaAgenda: !ag && dec ? (dec.foraDaAgenda || 'turno_extra') : null,
        noLugarDe: dec ? (dec.noLugarDe || null) : null,
        obs: dec ? (dec.obs || '') : '',
        erro: dec && !v.ok ? v.erro : '',
      };
      out.dias.push(linha);
      out.minutosAgenda += minutosAgenda;
      out.minutosInformados += minutosInformados;
      if (linha.delta !== 0) out.diasDiferentes++;
      if (mudou) out.diasComMudanca++;
    });
    out.delta = out.minutosInformados - out.minutosAgenda;
    return out;
  }

  /* ── o plano: o que muda em cada aula ────────────────────────────── */
  /**
   * O que a declaração de UM dia provoca nas aulas dele. Devolve valores
   * ABSOLUTOS (não incrementos): validar a mesma declaração duas vezes não
   * soma duas vezes.
   *
   *   aula que a pessoa não deu          → `nao_realizada` (sem FALTA: falta tira ponto)
   *   começou depois / saiu antes        → atraso / saída antecipada
   *   tempo colado antes ou depois       → tempo além, na aula vizinha
   *   turno sem aula nenhuma por perto   → `novas` (vira aula avulsa)
   *   dia fora da agenda "no lugar de X" → `pendencias`: é TROCA de professor,
   *                                        não hora a mais (os dois receberiam)
   *
   * @returns {{ops:Array, novas:Array, pendencias:Array, deltaMinutos:number, erro:string}}
   */
  function planoDoDia(agendaDia, dec, dia) {
    const out = { ops: [], novas: [], pendencias: [], deltaMinutos: 0, erro: '' };
    if (!dec) return out;
    const v = validarDia(dec);
    if (!v.ok) { out.erro = v.erro; return out; }
    const informado = v.turnos;
    const aulas = (agendaDia && agendaDia.aulas) || [];

    if (!aulas.length && dec.foraDaAgenda === 'no_lugar_de') {
      out.pendencias = informado.map(t => ({
        tipo: 'no_lugar_de', noLugarDe: dec.noLugarDe || null,
        inicio: paraHHMM(t.ini), fim: paraHHMM(t.fim), minutos: t.fim - t.ini,
      }));
      return out;
    }

    // 1) quanto de cada aula foi trabalhado
    const alvos = aulas.map(a => {
      const cortes = informado
        .map(t => ({ ini: Math.max(t.ini, a.ini), fim: Math.min(t.fim, a.fimMin) }))
        .filter(s => s.fim > s.ini);
      const trabalhado = cortes.reduce((s, x) => s + (x.fim - x.ini), 0);
      if (!trabalhado) return { a, trabalhou: false, atraso: 0, saida: 0, extra: 0 };
      const atraso = cortes[0].ini - a.ini;
      return { a, trabalhou: true, atraso, saida: a.duracao - trabalhado - atraso, extra: 0 };
    });

    // 2) o que foi trabalhado FORA da janela de qualquer aula
    let sobras = informado.map(t => ({ ini: t.ini, fim: t.fim }));
    aulas.forEach(a => {
      sobras = sobras.flatMap(s => {
        if (a.fimMin <= s.ini || a.ini >= s.fim) return [s];
        const partes = [];
        if (a.ini > s.ini) partes.push({ ini: s.ini, fim: a.ini });
        if (a.fimMin < s.fim) partes.push({ ini: a.fimMin, fim: s.fim });
        return partes;
      });
    });
    sobras.forEach(s => {
      const min = s.fim - s.ini;
      // colado DEPOIS de uma aula dada (ficou além) ou ANTES de uma (chegou antes)
      const vizinha = alvos.find(x => x.trabalhou && x.a.fimMin === s.ini)
        || alvos.find(x => x.trabalhou && x.a.ini === s.fim);
      if (vizinha && vizinha.extra + min <= TETO_EXTRA_AULA) vizinha.extra += min;
      else out.novas.push({ inicio: paraHHMM(s.ini), fim: paraHHMM(s.fim), minutos: min });
    });

    // 3) só vira operação o que MUDA em relação ao que a aula já tem
    alvos.forEach(x => {
      const a = x.a;
      if (!x.trabalhou) {
        out.ops.push({
          classId: a.id, inicio: a.inicio, fim: a.fim, antes: a.minutos, depois: 0,
          campos: { status: 'nao_realizada', atrasoMinutos: 0, saidaAntecipadaMinutos: 0, horaExtraMinutos: 0, faltaTipo: null },
        });
        out.deltaMinutos -= a.minutos;
        return;
      }
      const depois = Math.max(0, a.duracao - x.atraso - x.saida + x.extra);
      if (x.atraso !== a.atraso || x.saida !== a.saida || x.extra !== a.extra) {
        out.ops.push({
          classId: a.id, inicio: a.inicio, fim: a.fim, antes: a.minutos, depois,
          campos: { atrasoMinutos: x.atraso, saidaAntecipadaMinutos: x.saida, horaExtraMinutos: x.extra },
        });
      }
      out.deltaMinutos += depois - a.minutos;
    });
    out.deltaMinutos += out.novas.reduce((s, n) => s + n.minutos, 0);
    return out;
  }

  /** O plano do mês inteiro: um item por dia DECLARADO. */
  function plano(agenda, declaracao) {
    const dias = (declaracao && declaracao.dias) || {};
    const porDia = new Map((agenda || []).map(a => [a.dia, a]));
    const out = { porDia: [], deltaMinutos: 0, minutosPendentes: 0, erros: [] };
    Object.keys(dias).sort().forEach(dia => {
      const p = planoDoDia(porDia.get(dia) || null, dias[dia], dia);
      if (p.erro) { out.erros.push(`${dia.slice(8, 10)}/${dia.slice(5, 7)}: ${p.erro}`); return; }
      out.porDia.push(Object.assign({ dia }, p));
      out.deltaMinutos += p.deltaMinutos;
      out.minutosPendentes += p.pendencias.reduce((s, x) => s + x.minutos, 0);
    });
    return out;
  }

  /**
   * PURO: a aula avulsa de um turno que não existia na agenda. Só os campos de
   * conteúdo — carimbo de data e autor ficam com quem grava.
   *
   * Unidade e modalidade vêm das aulas do próprio dia; sem aula no dia, do
   * `padrao` da pessoa. `scheduledDate` é sempre Date: texto não entra em busca
   * por período, que é como a agenda e o fechamento acham a aula.
   */
  function aulaAvulsa(p) {
    const ref = (p.agendaDia && p.agendaDia.aulas && p.agendaDia.aulas[0]) || null;
    const padrao = p.padrao || {};
    return {
      unitId: (ref && ref.unitId) || padrao.unitId || null,
      modalityId: (ref && ref.modalityId) || padrao.modalityId || null,
      teacherId: p.teacherId, originalTeacherId: p.teacherId,
      startTime: p.nova.inicio, endTime: p.nova.fim, durationMinutes: p.nova.minutos,
      status: 'realizada', registroAutomatico: false,
      scheduledDate: new Date(p.dia + 'T00:00:00'),
      generatedBy: 'horas-do-mes', horasDeclaracaoId: p.declaracaoId || null,
      isHoliday: !!(ref && ref.isHoliday), holidayName: (ref && ref.holidayName) || null, holidayType: null,
      remunerada: true, monthClosingId: null,
      atrasoMinutos: 0, saidaAntecipadaMinutos: 0, horaExtraMinutos: 0, faltaTipo: null,
      cancellationReason: null, cancellationNote: null,
      adjustmentNote: 'Turno informado em Minhas horas e validado pela gestão',
    };
  }

  /* ── situação e fechamento ───────────────────────────────────────── */
  function situacao(decl) {
    return decl && ROTULOS[decl.status] ? decl.status : 'nao_conferiu';
  }

  /**
   * O que segura o fechamento do mês.
   *   · declaração ENVIADA e não validada: sempre trava — a pessoa informou
   *     horas e a folha fecharia sem elas;
   *   · quem NÃO CONFERIU: trava só de INICIO_CONFERENCIA em diante, e a gestão
   *     destrava pessoa a pessoa ("fechar valendo a agenda" → `dispensada`).
   * @param {{pessoas:string[], declaracoes:Array, mes:string}} p  `pessoas` = quem tem aula que paga no mês
   */
  function pendenciasDoFechamento(p) {
    const mes = (p && p.mes) || '';
    const porPessoa = new Map(((p && p.declaracoes) || []).filter(d => d && d.mes === mes).map(d => [d.teacherId, d]));
    const aValidar = [], naoConferiram = [];
    ((p && p.pessoas) || []).forEach(id => {
      const d = porPessoa.get(id) || null;
      const s = situacao(d);
      // "Está tudo igual à agenda" já é conferência completa: não há o que a
      // gestão validar, e pedir OK pra isso só criaria fila.
      if (s === 'enviada' && d.semDiferenca === true) return;
      if (s === 'enviada') aValidar.push(id);
      else if (s !== 'validada' && s !== 'dispensada' && mes >= INICIO_CONFERENCIA) naoConferiram.push(id);
    });
    return { aValidar, naoConferiram, trava: aValidar.length > 0 || naoConferiram.length > 0 };
  }

  /* ── avisos ──────────────────────────────────────────────────────── */
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  /** '2026-09' → 'setembro/2026' */
  function nomeDoMes(mes) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(mes || ''));
    return m && MESES[Number(m[2]) - 1] ? `${MESES[Number(m[2]) - 1]}/${m[1]}` : String(mes || '');
  }

  /**
   * A declaração ACABOU de ser enviada pelo professor e tem o que validar?
   * É o momento de avisar a gestão. "Tudo igual à agenda" não pede OK, e o que
   * a própria gestão lançou não precisa avisar a gestão.
   */
  function enviouAgora(antes, depois) {
    if (!depois || depois.status !== 'enviada') return false;
    if (depois.semDiferenca === true || depois.lancadaPelaGestao === true) return false;
    return !antes || antes.status !== 'enviada';
  }

  /** O texto do aviso que a gestão recebe. */
  function avisoParaGestao(nome, decl) {
    const r = (decl && decl.resumo) || {};
    const temConta = typeof r.minutosAgenda === 'number' && typeof r.minutosInformados === 'number';
    const delta = temConta ? r.minutosInformados - r.minutosAgenda : 0;
    const conta = temConta
      ? `: informou ${fmtHoras(r.minutosInformados)}, a agenda tem ${fmtHoras(r.minutosAgenda)}`
        + (delta ? ` (${fmtHoras(delta, { sinal: true })})` : ' (mesmo total, dias diferentes)')
      : '';
    return `${nome || 'Um professor'} enviou as horas de ${nomeDoMes(decl && decl.mes)}${conta}. Só entram na folha depois de validadas — veja em Horas do mês.`;
  }

  /**
   * O que lembrar ao professor na tela inicial, sobre o mês `mes`:
   *   'devolvida' — a gestão devolveu para corrigir;
   *   'conferir'  — o mês já acabou e ele ainda não enviou;
   *   null        — nada a lembrar.
   */
  function lembrete(decl, mes, hojeISO) {
    const s = situacao(decl);
    if (s === 'devolvida') return 'devolvida';
    if ((s === 'nao_conferiu' || s === 'rascunho') && String(mes) < String(hojeISO || '').slice(0, 7)) return 'conferir';
    return null;
  }

  return {
    nomeDoMes, enviouAgora, avisoParaGestao, lembrete,
    INICIO_CONFERENCIA, STATUS_ATIVOS, ROTULOS, MAX_MINUTOS_DIA,
    paraMin, paraHHMM, fmtHoras, diaISO, aulaConta, minutosDaAula,
    agendaDoMes, validarDia, minutosDoDia, resumo, planoDoDia, plano, aulaAvulsa,
    situacao, pendenciasDoFechamento,
  };
});
