// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Lista de renovações: a conta
// ═══════════════════════════════════════════════════════════════════════
//
// Desenho: docs/superpowers/specs/2026-09-29-renovacoes-metas-bonus-design.md (parte A)
//
// Puro: sem Firebase, sem tela. Recebe a Previsão de Renovação da Pacto, os
// contratos do caderninho e o histórico de vendas, e devolve os blocos da
// lista, as exclusões por motivo e a conferência com o total da Pacto. As
// partes B (meta) e C (bônus) leem "renovação base" e "base antecipável" DAQUI.
//
// ⚠️ Gêmeo em functions/renovacoes-lista.js — o deploy de Functions só leva
// functions/. O smoke falha se as duas cópias divergirem.

const RenovacoesLista = {

  // Ordem importa: o primeiro que casar dá o motivo (personal externo antes de recorrente).
  EXCLUSOES: [
    { motivo: 'personal_externo', rotulo: 'Personal externo', termos: ['PERSONAL EXTERNO'] },
    { motivo: 'recorrente', rotulo: 'Recorrente (renova sozinho)', termos: ['RECORRENTE'] },
    { motivo: 'credito', rotulo: 'Crédito de aulas', termos: ['CREDITO'] },
    { motivo: 'avulso', rotulo: 'Avulso, pacote ou diária', termos: ['AVULSO', 'AVULSA', 'PACOTE', 'DIARIA'] },
    { motivo: 'permuta', rotulo: 'Permuta, cortesia ou colaborador', termos: ['PERMUTA', 'CORTESIA', 'COLABORADOR', 'FUNCIONARIO'] },
    { motivo: 'teste', rotulo: 'Plano de teste', termos: ['TESTE'] },
    { motivo: 'agregador', rotulo: 'Agregador (Wellhub, Gympass, TotalPass)', termos: ['WELLHUB', 'GYMPASS', 'TOTALPASS'] },
  ],

  // Rótulos das exclusões que não vêm do nome do plano
  ROTULOS_EXTRAS: { duplicado: 'Aluno repetido na Previsão', gestao: 'Excluído pela gestão' },

  MOTIVOS_NAO_RENOVOU: [
    'Preço / questão financeira',
    'Mudou de cidade ou país',
    'Fim da estadia (morador temporário / turista)',
    'Lesão ou saúde',
    'Horário ou rotina incompatível',
    'Foi para outra academia / concorrente',
    'Insatisfação com o serviço',
    'Pausa – pretende voltar',
    'Sem resposta após 3 tentativas de contato',
    'Outro',
  ],

  STATUS: { pendente: 'Pendente', negociacao: 'Em negociação', sim: 'Sim', nao: 'Não' },

  // Mesma lista do `naoComissionaveis` do motor: não são consultoras da lista
  NAO_CONSULTORAS: ['RODRIGO', 'RAFAEL ROJAIS', 'BENNY ELAND', 'SISTEMA'],

  /** Maiúsculas, sem acento, espaços simples. */
  norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/\s+/g, ' ').trim();
  },

  /**
   * Termo como PALAVRA inteira (aceita plural com S). `TESTE` não casa com
   * `TESTEMUNHA` — foi o que quase apagou uma ESTEFANE de verdade em set/2026.
   */
  temTermo(nomeNorm, termo) {
    const t = termo.split(' ').join('\\s+');
    return new RegExp('(^|[^A-Z0-9])' + t + 'S?([^A-Z0-9]|$)').test(nomeNorm);
  },

  rotuloExclusao(motivo) {
    const e = this.EXCLUSOES.find(x => x.motivo === motivo);
    return e ? e.rotulo : (this.ROTULOS_EXTRAS[motivo] || motivo);
  },

  /**
   * Nome do plano → { tipo: 'excluir', motivo } | { tipo: 'degustacao' } |
   * { tipo: 'importacao' } | { tipo: 'renovacao', economico } | { tipo: 'verificar', motivo }
   */
  classificarPlano(nome) {
    const n = this.norm(nome);
    if (!n) return { tipo: 'verificar', motivo: 'Contrato sem nome de plano na Pacto' };
    if (this.temTermo(n, 'IMPORTACAO')) return { tipo: 'importacao' };
    for (const e of this.EXCLUSOES) {
      if (e.termos.some(t => this.temTermo(n, t))) return { tipo: 'excluir', motivo: e.motivo };
    }
    if (this.temTermo(n, 'DEGUSTACAO')) return { tipo: 'degustacao' };
    return { tipo: 'renovacao', economico: this.temTermo(n, 'ECONOMICO') };
  },
};

if (typeof module !== 'undefined') module.exports = RenovacoesLista;
if (typeof window !== 'undefined') window.RenovacoesLista = RenovacoesLista;
