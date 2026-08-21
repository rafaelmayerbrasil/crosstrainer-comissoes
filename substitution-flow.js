// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Máquina de estados da troca de professor da aula
// Puro (sem DOM, sem Firebase). Browser (window.SubstitutionFlow) e Node.
//
// Fluxo (grupo da gestão, 21/08/2026):
//   registro → confirmação do outro professor → homologação da gestão → aplica
//
// A aula só muda de dono no 'accepted'. É esse estado que a CF
// processSubstitutionAcceptance escuta — por isso ele continua se chamando
// assim, mesmo tendo virado o último degrau em vez do segundo.
// ═══════════════════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SubstitutionFlow = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const STATUS = {
    PENDING:           'pending',
    AGUARDANDO_GESTAO: 'aguardando_gestao',
    ACCEPTED:          'accepted',
    REJECTED:          'rejected',
    CANCELLED:         'cancelled',
  };

  // Quem clicou em registrar. Vocabulário fechado aqui pra tela e serviço não
  // inventarem valores diferentes.
  const REGISTRADO_POR = { TITULAR: 'titular', SUBSTITUTO: 'substituto', GESTAO: 'gestao' };

  // Rótulos escritos para quem lê, não para quem programou. "Aceita" dizia que
  // acabou quando ainda faltava a gestão.
  const STATUS_LABEL = {
    pending:           'Aguardando o colega confirmar',
    aguardando_gestao: 'Aguardando a gestão',
    accepted:          'Confirmada',
    rejected:          'Recusada',
    cancelled:         'Cancelada',
  };

  const STATUS_ABERTO = [STATUS.PENDING, STATUS.AGUARDANDO_GESTAO];

  /** Status de aula que não tem troca a registrar. */
  const STATUS_AULA_SEM_TROCA = ['cancelada', 'nao_realizada'];

  /**
   * Quem pode registrar uma troca nesta aula.
   * @param {object} cls - { teacherId, status, monthClosingId }
   * @param {object} ator - { teacherId, isGestao }
   * @param {object} [opcoes] - { subsDaAula, alvoTeacherId } — checagens extras, opcionais.
   * @returns {{ok: boolean, motivo: string}}
   */
  function podeRegistrar(cls, ator, opcoes) {
    ator = ator || {};
    if (!cls) return { ok: false, motivo: 'Aula não encontrada.' };
    if (cls.monthClosingId) {
      return { ok: false, motivo: 'O mês desta aula já foi fechado — nem a gestão altera depois disso.' };
    }
    if (STATUS_AULA_SEM_TROCA.indexOf(cls.status) !== -1) {
      return { ok: false, motivo: 'Esta aula não aconteceu, então não há troca de professor a registrar.' };
    }
    if (!ator.isGestao && !ator.teacherId) {
      return { ok: false, motivo: 'Sua conta não está ligada a um cadastro de professor — fale com a gestão.' };
    }

    const op = opcoes || {};
    // Quem já tem a lista de pedidos da aula evita oferecer um botão que o
    // serviço vai recusar. Quem não tem passa direto — o serviço ainda barra.
    if (op.subsDaAula && jaTemPedidoAberto(op.subsDaAula)) {
      return { ok: false, motivo: 'Já existe um pedido em aberto para esta aula. Veja em Substituições.' };
    }
    if (op.alvoTeacherId && op.alvoTeacherId === cls.teacherId) {
      return { ok: false, motivo: 'Esta aula já está no nome dessa pessoa.' };
    }

    return { ok: true, motivo: '' };
  }

  /** Quem registrou o pedido. Pedido antigo, sem o campo, veio do titular. */
  function registradoPor(sub) {
    return (sub && sub.registradoPor) || 'titular';
  }

  /**
   * teacherId de quem precisa confirmar — é sempre o lado que NÃO registrou.
   * Quando é a gestão que registra, quem confirma é sempre o titular: é ele
   * quem perde a aula (e as horas), então é ele quem verifica a afirmação.
   */
  function quemConfirma(sub) {
    if (!sub) return null;
    const por = registradoPor(sub);
    if (por === REGISTRADO_POR.SUBSTITUTO) return sub.requestingTeacherId;
    if (por === REGISTRADO_POR.GESTAO) return sub.requestingTeacherId;
    return sub.substituteTeacherId;
  }

  /**
   * teacherId de quem registrou (e portanto pode cancelar).
   * Quando é a gestão, não há professor a cancelar — só ela pode recusar.
   */
  function quemRegistrou(sub) {
    if (!sub) return null;
    const por = registradoPor(sub);
    if (por === REGISTRADO_POR.SUBSTITUTO) return sub.substituteTeacherId;
    if (por === REGISTRADO_POR.GESTAO) return null;
    return sub.requestingTeacherId;
  }

  /**
   * Calcula o próximo estado.
   * @param {object} sub - { status, requestingTeacherId, substituteTeacherId, registradoPor }
   *   `requestingTeacherId` é SEMPRE o titular da aula e `substituteTeacherId`
   *   SEMPRE quem realmente deu, independentemente de quem registrou — a CF e
   *   o `originalTeacherId` dependem disso. `registradoPor` é só quem clicou.
   * @param {'confirmar'|'homologar'|'recusar'|'cancelar'} acao
   * @param {object} ator - { teacherId, isGestao }
   *   `isGestao` é `ProfNav.isManagement(profiles)` (`professores-nav.js`,
   *   admin + supervisão). Quem chamar tem que usar essa mesma definição.
   * @returns {{ok: boolean, status?: string, semConfirmacaoDoProfessor?: boolean, atorEhParte?: boolean, erro?: string}}
   *   `semConfirmacaoDoProfessor` e `atorEhParte` são gravados com esses nomes
   *   no documento de `substitutions`.
   */
  function transicao(sub, acao, ator) {
    ator = ator || {};
    if (!sub) return { ok: false, erro: 'Pedido não encontrado.' };
    if (STATUS_ABERTO.indexOf(sub.status) === -1) {
      return { ok: false, erro: 'Este pedido já está como "' + (STATUS_LABEL[sub.status] || 'resolvido') + '".' };
    }

    if (acao === 'homologar') {
      if (!ator.isGestao) return { ok: false, erro: 'Só a gestão confirma a troca.' };
      return {
        ok: true,
        status: STATUS.ACCEPTED,
        // A gestão pode homologar antes do professor responder — é a saída para
        // férias, folga, desligamento e para quem simplesmente não abre o app.
        semConfirmacaoDoProfessor: sub.status === STATUS.PENDING,
        // Supervisor que também dá aula pode homologar troca da qual ele é parte.
        // Não bloqueia (a gestão é a palavra final), mas o registro tem que
        // distinguir isso de "o professor não respondeu".
        atorEhParte: !!ator.teacherId
          && (ator.teacherId === quemConfirma(sub) || ator.teacherId === quemRegistrou(sub)),
      };
    }

    if (acao === 'confirmar') {
      if (sub.status !== STATUS.PENDING) {
        return { ok: false, erro: 'Este pedido já foi confirmado e está com a gestão.' };
      }
      const alvo = quemConfirma(sub);
      if (!alvo || ator.teacherId !== alvo) {
        return { ok: false, erro: 'Quem tem que confirmar esta troca é o outro professor.' };
      }
      return { ok: true, status: STATUS.AGUARDANDO_GESTAO };
    }

    if (acao === 'recusar') {
      const podeRecusar = ator.isGestao || ator.teacherId === quemConfirma(sub);
      if (!podeRecusar) return { ok: false, erro: 'Só o outro professor ou a gestão pode recusar.' };
      return { ok: true, status: STATUS.REJECTED };
    }

    if (acao === 'cancelar') {
      const autor = quemRegistrou(sub);
      if (!autor || ator.teacherId !== autor) {
        return { ok: false, erro: 'Só quem registrou pode cancelar. Para discordar, recuse.' };
      }
      return { ok: true, status: STATUS.CANCELLED };
    }

    return { ok: false, erro: 'Ação desconhecida: ' + acao };
  }

  /**
   * Separa as trocas abertas de um mês para a tela de fechamento.
   * Trava o que depende da gestão (é ação dela, e passar reto paga o professor
   * errado). Só avisa o que depende de um professor responder — senão a folha
   * inteira fica refém de quem não abre o app.
   */
  function pendenciasDoFechamento(subs) {
    const lista = subs || [];
    return {
      travam: lista.filter(s => s && s.status === STATUS.AGUARDANDO_GESTAO),
      avisam: lista.filter(s => s && s.status === STATUS.PENDING),
    };
  }

  /** Já existe pedido em aberto para esta aula? Barra a duplicata. */
  function jaTemPedidoAberto(subsDaAula) {
    return (subsDaAula || []).some(s => s && STATUS_ABERTO.indexOf(s.status) !== -1);
  }

  /** Texto do porquê o botão de troca não aparece. */
  function motivoSemBotao(cls, ator, opcoes) {
    const r = podeRegistrar(cls, ator, opcoes);
    return r.ok ? '' : r.motivo;
  }

  return {
    STATUS, STATUS_LABEL, STATUS_ABERTO, REGISTRADO_POR,
    podeRegistrar, registradoPor, quemConfirma, quemRegistrou,
    transicao, pendenciasDoFechamento, motivoSemBotao, jaTemPedidoAberto,
  };
});
