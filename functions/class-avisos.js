// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Avisos do professor sobre a aula (puro, sem Firestore)
//
// O professor avisa duas coisas pela janela da aula: "a aula não aconteceu" e
// "cheguei atrasado / saí antes / fiquei além". O aviso NÃO entra na folha: a
// gestão decide. Até 01/10/2026 essa decisão não tinha onde acontecer — o
// botão dizia "Enviar para a gestão", mas a gestão não era avisada e não havia
// lista. Em produção, 21 avisos ficaram parados de 26/08 a 01/10, nenhum
// atendido; e como a aula vira `realizada` sozinha de madrugada, um "não
// aconteceu" sem resposta seria pago no fechamento.
//
// Aqui moram as regras: o que o aviso diz, quais decisões cabem a cada tipo e
// o que cada decisão grava na aula. Tem gêmeo em `functions/` (o gatilho que
// avisa a gestão usa a mesma frase) — o smoke falha se divergirem.
// ═══════════════════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ClassAvisos = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const TIPOS = ['ocorrencia', 'nao_aconteceu'];
  const TETO_MIN = 600;   // 10h: erro de digitação não vira folha (mesmo teto do serviço)

  // As respostas que a gestão pode dar, por tipo de aviso, na ordem dos botões.
  const DECISOES = {
    ocorrencia: ['aceitar', 'dispensar'],
    nao_aconteceu: ['cancelar', 'falta_justificada', 'falta_sem_aviso', 'dispensar'],
  };
  const ROTULOS = {
    aceitar: 'Aceitar',
    cancelar: 'Aula cancelada',
    falta_justificada: 'Falta avisada',
    falta_sem_aviso: 'Falta sem aviso',
    dispensar: 'Dispensar',
  };

  const min = (v) => {
    const n = Math.round(Number(v) || 0);
    return n > 0 ? Math.min(n, TETO_MIN) : 0;
  };

  /** O que o professor informou, em uma linha. */
  function resumo(aviso) {
    if (!aviso) return '';
    if (aviso.tipo === 'nao_aconteceu') return 'avisou que a aula não aconteceu';
    const partes = [];
    if (min(aviso.atrasoMinutos)) partes.push(`chegou ${min(aviso.atrasoMinutos)} min atrasado`);
    if (min(aviso.saidaAntecipadaMinutos)) partes.push(`saiu ${min(aviso.saidaAntecipadaMinutos)} min antes`);
    if (min(aviso.horaExtraMinutos)) partes.push(`ficou ${min(aviso.horaExtraMinutos)} min além do horário`);
    return partes.join(' · ');
  }

  function decisoesDe(aviso) {
    return (aviso && DECISOES[aviso.tipo]) ? DECISOES[aviso.tipo].slice() : [];
  }

  /**
   * O que a decisão da gestão grava na aula. Só os campos de conteúdo — carimbo
   * de data, autor e o rastro do aviso ficam por conta de quem grava.
   *
   *   aceitar            → os minutos informados passam a valer; o status não muda
   *   cancelar           → a aula não aconteceu e ninguém faltou: sai da folha
   *   falta_justificada  → falta avisada
   *   falta_sem_aviso    → falta sem aviso
   *   dispensar          → a aula fica exatamente como estava
   *
   * @returns {{ok:boolean, erro:string, campos:Object}}
   */
  function camposDaDecisao(cls, decisao) {
    const falha = (erro) => ({ ok: false, erro, campos: {} });
    if (!cls) return falha('Aula não encontrada.');
    if (cls.monthClosingId) return falha('O mês desta aula já foi fechado — nada mais pode ser alterado.');
    const aviso = cls.avisoProfessor;
    if (!aviso) return falha('Esta aula não tem aviso esperando resposta.');
    if (decisoesDe(aviso).indexOf(decisao) === -1) return falha('Essa resposta não se aplica a este tipo de aviso.');

    const zerados = { atrasoMinutos: 0, saidaAntecipadaMinutos: 0, horaExtraMinutos: 0 };
    if (decisao === 'dispensar') return { ok: true, erro: '', campos: {} };
    if (decisao === 'aceitar') {
      return { ok: true, erro: '', campos: {
        atrasoMinutos: min(aviso.atrasoMinutos),
        saidaAntecipadaMinutos: min(aviso.saidaAntecipadaMinutos),
        horaExtraMinutos: min(aviso.horaExtraMinutos),
        faltaTipo: null,
      } };
    }
    if (decisao === 'cancelar') return { ok: true, erro: '', campos: Object.assign({ status: 'cancelada', faltaTipo: null }, zerados) };
    const falta = decisao === 'falta_justificada' ? 'justificada' : 'sem_aviso';
    return { ok: true, erro: '', campos: Object.assign({ status: 'nao_realizada', faltaTipo: falta }, zerados) };
  }

  const _quando = (c) => {
    const d = c && c.scheduledDate && c.scheduledDate.toDate ? c.scheduledDate.toDate() : null;
    return d && !isNaN(d) ? d : null;
  };

  /** Aulas com aviso esperando a gestão (mês aberto), da mais antiga pra mais nova. */
  function pendentes(classes) {
    return (classes || [])
      .filter(c => c && c.avisoProfessor && TIPOS.indexOf(c.avisoProfessor.tipo) !== -1 && !c.monthClosingId)
      .slice()
      .sort((a, b) => {
        const da = _quando(a), dbb = _quando(b);
        const ta = da ? da.getTime() : 0, tb = dbb ? dbb.getTime() : 0;
        return ta !== tb ? ta - tb : String(a.startTime || '').localeCompare(String(b.startTime || ''));
      });
  }

  /** As pendentes cuja aula caiu no mês (ano, mês 1–12) — é o que trava o fechamento dele. */
  function doMes(classes, ano, mes) {
    return pendentes(classes).filter(c => {
      const d = _quando(c);
      return d && d.getFullYear() === ano && d.getMonth() + 1 === mes;
    });
  }

  /** O que dizer ao professor quando a gestão responde. */
  function respostaParaOProfessor(aviso, decisao, quandoTxt) {
    const dia = quandoTxt ? ` de ${quandoTxt}` : '';
    if (decisao === 'aceitar') return `A gestão aceitou o que você informou na aula${dia} (${resumo(aviso)}). Já vale para o fechamento.`;
    if (decisao === 'cancelar') return `A gestão confirmou: a aula${dia} não aconteceu e foi cancelada. Ela não entra na conta de horas.`;
    if (decisao === 'falta_justificada') return `A gestão registrou a aula${dia} como falta avisada. Ela não entra na conta de horas.`;
    if (decisao === 'falta_sem_aviso') return `A gestão registrou a aula${dia} como falta sem aviso. Ela não entra na conta de horas.`;
    return `A gestão conferiu o seu aviso da aula${dia} e manteve a aula como estava. Se discordar, fale com a gestão.`;
  }

  /**
   * O aviso NASCEU nesta alteração da aula? É a pergunta do gatilho que avisa a
   * gestão: a aula é alterada o tempo todo (75 confirmações automáticas por
   * madrugada), e só interessa o momento em que o professor avisa.
   */
  function avisoNovo(antes, depois) {
    return !(antes && antes.avisoProfessor) && !!(depois && depois.avisoProfessor);
  }

  return { TIPOS, DECISOES, ROTULOS, TETO_MIN, resumo, decisoesDe, camposDaDecisao, pendentes, doMes, respostaParaOProfessor, avisoNovo };
});
