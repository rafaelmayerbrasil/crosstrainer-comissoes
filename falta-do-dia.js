// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Falta do dia (puro, sem DOM e sem Firestore)
//
// A gestão lançava a falta abrindo aula por aula: quem faltou um dia inteiro
// com 6 aulas exigia 6 aberturas (pedido da gestão, 07/10/2026). Aqui moram as
// regras da tela que resolve o dia de uma vez: quais aulas da pessoa entram,
// quais não podem ser marcadas (e por quê), o que cada escolha vira e os
// textos de confirmação.
//
// Cada aula do dia tem uma de três escolhas:
//   falta  — ninguém deu: a aula sai das horas pagas (o mesmo lançamento da
//            janela da aula, ClassService.updateStatus)
//   colega — um colega deu no lugar: é a troca de professor de sempre
//            (SubstitutionService.create + homologar); não fica falta
//   nada   — a pessoa deu a aula: fica como está
// ═══════════════════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FaltaDoDia = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const TIPOS = { justificada: 'falta avisada', sem_aviso: 'falta sem aviso' };
  const TIPOS_PLURAL = { justificada: 'faltas avisadas', sem_aviso: 'faltas sem aviso' };
  const STATUS_ABERTO = ['pending', 'aguardando_gestao'];

  const _data = (c) => {
    const v = c && c.scheduledDate;
    const d = v && v.toDate ? v.toDate() : (v ? new Date(v) : null);
    return d && !isNaN(d) ? d : null;
  };
  const _doisDig = (n) => String(n).padStart(2, '0');

  /** "AAAA-MM-DD" no horário local — o dia em que a aula acontece. */
  function diaISO(scheduledDate) {
    const d = _data({ scheduledDate });
    return d ? `${d.getFullYear()}-${_doisDig(d.getMonth() + 1)}-${_doisDig(d.getDate())}` : null;
  }
  const _diaBR = (dia) => `${String(dia).slice(8, 10)}/${String(dia).slice(5, 7)}`;

  /** Quando a aula começa: o dia dela + o horário de início. */
  function inicioDaAula(c) {
    const d = _data(c);
    if (!d) return null;
    const m = /^(\d{1,2}):(\d{2})/.exec(String(c.startTime || ''));
    return m ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(m[1]), Number(m[2])) : d;
  }

  /** Aula que não paga hora: marcada como não remunerada, ou Escola Interna (mesma regra do fechamento). */
  function _naoContaHoras(c) {
    return c.remunerada === false || c.specialScaleType === 'escola_interna';
  }

  /** Quem tem aula no dia — é entre essas pessoas que a gestão escolhe quem faltou. */
  function pessoasComAula(classes, dia) {
    const ids = new Set();
    (classes || []).forEach(c => { if (c && c.teacherId && diaISO(c.scheduledDate) === dia) ids.add(c.teacherId); });
    return Array.from(ids).sort();
  }

  /**
   * As aulas da pessoa no dia, em ordem de horário, cada uma com o que a tela
   * precisa saber:
   *   pode        — dá para lançar algo nela
   *   motivo      — por que não dá (quando pode === false)
   *   podeColega  — dá para dizer "um colega deu"
   *   padrao      — a escolha com que a linha nasce ('falta' ou 'nada')
   *   nota        — o que já está lançado nela, quando houver
   *   noLugarDe   — teacherId do titular, quando ela está cobrindo alguém
   *
   * @param {object} [opts] - { subsAbertas: [{classId, status}] }
   */
  function aulasDoDia(classes, teacherId, dia, opts) {
    const abertas = new Set(((opts && opts.subsAbertas) || [])
      .filter(s => s && STATUS_ABERTO.indexOf(s.status) !== -1).map(s => s.classId));

    return (classes || [])
      .filter(c => c && c.teacherId === teacherId && diaISO(c.scheduledDate) === dia)
      .slice()
      .sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')))
      .map(c => {
        const item = {
          id: c.id, cls: c, pode: true, motivo: '', podeColega: true, padrao: 'falta', nota: '',
          noLugarDe: c.originalTeacherId && c.originalTeacherId !== c.teacherId ? c.originalTeacherId : null,
        };
        const bloqueia = (motivo) => Object.assign(item, { pode: false, podeColega: false, padrao: 'nada', motivo });

        if (c.monthClosingId) return bloqueia('O mês desta aula já foi fechado.');
        if (c.status === 'cancelada') return bloqueia('Aula cancelada — não há falta a lançar.');
        if (abertas.has(c.id)) return bloqueia('Tem uma troca de professor esperando confirmação. Resolva em Substituições primeiro.');
        if (_naoContaHoras(c)) {
          return bloqueia(c.specialScaleType === 'escola_interna'
            ? 'Escola Interna não conta horas — a presença é lançada em Engajamento.'
            : 'Aula não remunerada — não entra na conta de horas.');
        }

        // O que já está lançado não é remarcado sozinho: a linha nasce em "nada"
        // e a gestão decide se troca o tipo da falta.
        if (c.faltaTipo) {
          Object.assign(item, { padrao: 'nada', podeColega: false, nota: `Já lançada como ${TIPOS[c.faltaTipo] || 'falta'}.` });
        } else if (c.status === 'nao_realizada') {
          Object.assign(item, { padrao: 'nada', podeColega: false, nota: 'Já está como não realizada.' });
        }
        return item;
      });
  }

  /** As escolhas com que a tela abre: `{ classId: { tipo } }`. */
  function escolhasPadrao(itens) {
    const out = {};
    (itens || []).forEach(i => { if (i.pode) out[i.id] = { tipo: i.padrao }; });
    return out;
  }

  /** Alguma aula marcável do dia ainda não começou? (Decide se "sem aviso" é oferecido.) */
  function temAulaFutura(itens, agora) {
    const ref = agora || new Date();
    return (itens || []).some(i => i.pode && inicioDaAula(i.cls) > ref);
  }

  /**
   * Confere as escolhas e separa o que vai ser feito.
   * @param {object} escolhas - { classId: { tipo: 'falta'|'colega'|'nada', colegaId } }
   * @param {object} opts - { teacherId, faltaTipo: 'justificada'|'sem_aviso'|'', agora: Date }
   * @returns {{ok:boolean, erro:string, faltas:object[], trocas:{cls:object, colegaId:string}[], faltaTipo:string|null}}
   */
  function plano(itens, escolhas, opts) {
    const o = opts || {};
    const agora = o.agora || new Date();
    const vazio = { ok: false, erro: '', faltas: [], trocas: [], faltaTipo: null };
    const falha = (erro) => Object.assign({}, vazio, { erro });
    const porId = new Map((itens || []).map(i => [i.id, i]));
    const faltas = [], trocas = [];

    for (const id of Object.keys(escolhas || {})) {
      const e = escolhas[id] || {};
      if (!e.tipo || e.tipo === 'nada') continue;
      const item = porId.get(id);
      if (!item || !item.pode) return falha('Uma das aulas marcadas não pode ser alterada. Atualize a tela.');
      const hora = item.cls.startTime || '';
      if (e.tipo === 'falta') { faltas.push(item.cls); continue; }
      if (e.tipo === 'colega') {
        if (!item.podeColega) return falha(`A aula das ${hora} não aconteceu — não há como passar para um colega.`);
        if (!e.colegaId) return falha(`Escolha quem deu a aula das ${hora}.`);
        if (e.colegaId === o.teacherId) return falha(`A aula das ${hora} não pode passar para a própria pessoa.`);
        trocas.push({ cls: item.cls, colegaId: e.colegaId });
        continue;
      }
      return falha('Escolha desconhecida — atualize a tela.');
    }

    const ordena = (a, b) => String(a.startTime || '').localeCompare(String(b.startTime || ''));
    faltas.sort(ordena);
    trocas.sort((a, b) => ordena(a.cls, b.cls));

    if (!faltas.length && !trocas.length) return falha('Nada marcado: escolha ao menos uma aula como falta ou como dada por um colega.');
    if (faltas.length) {
      if (!TIPOS[o.faltaTipo]) return falha('Diga se a falta foi avisada ou sem aviso.');
      if (o.faltaTipo === 'sem_aviso') {
        const futuras = faltas.filter(c => inicioDaAula(c) > agora);
        if (futuras.length) {
          return falha(`Aula que ainda não começou só aceita "falta avisada" (${futuras.map(c => c.startTime).join(', ')}).`);
        }
      }
    }
    return { ok: true, erro: '', faltas, trocas, faltaTipo: faltas.length ? o.faltaTipo : null };
  }

  const _horas = (lista) => lista.map(c => c.startTime).join(', ');

  /**
   * A pergunta de confirmação: o que vai ser lançado e o efeito.
   * @param {object} ctx - { nome, nomeDe(teacherId), dia }
   */
  function resumo(p, ctx) {
    const c = ctx || {};
    const linhas = [`Lançar para ${c.nome || 'a pessoa'} em ${_diaBR(c.dia)}:`, ''];
    if (p.faltas.length) {
      const n = p.faltas.length;
      linhas.push(`• ${n} ${n === 1 ? TIPOS[p.faltaTipo] : TIPOS_PLURAL[p.faltaTipo]} (${_horas(p.faltas)})`);
    }
    const porColega = new Map();
    p.trocas.forEach(t => { if (!porColega.has(t.colegaId)) porColega.set(t.colegaId, []); porColega.get(t.colegaId).push(t.cls); });
    porColega.forEach((aulas, id) => {
      const quem = (c.nomeDe && c.nomeDe(id)) || 'colega';
      linhas.push(`• ${aulas.length === 1 ? 'a aula das' : 'as aulas das'} ${_horas(aulas)} ${aulas.length === 1 ? 'passa' : 'passam'} para ${quem}`);
    });
    linhas.push('');
    if (p.faltas.length) linhas.push(`${p.faltas.length === 1 ? 'A falta sai' : 'As faltas saem'} das horas pagas. ${c.nome || 'A pessoa'} recebe um aviso no sino.`);
    if (p.trocas.length) linhas.push('Aula dada por um colega troca de nome e o pagamento acompanha; não fica falta registrada nela.');
    return linhas.join('\n');
  }

  /** O que dizer ao professor sobre as faltas lançadas ('' quando não houve falta). */
  function mensagemParaOProfessor(p, dia) {
    if (!p || !p.faltas || !p.faltas.length) return '';
    const n = p.faltas.length;
    const onde = n === 1 ? `na sua aula de ${_diaBR(dia)} (${_horas(p.faltas)})` : `em ${n} aulas suas de ${_diaBR(dia)} (${_horas(p.faltas)})`;
    return `A gestão registrou ${TIPOS[p.faltaTipo]} ${onde}. ${n === 1 ? 'Ela não entra' : 'Elas não entram'} na conta de horas. Se discordar, fale com a gestão.`;
  }

  return { TIPOS, diaISO, inicioDaAula, pessoasComAula, aulasDoDia, escolhasPadrao, temAulaFutura, plano, resumo, mensagemParaOProfessor };
});
