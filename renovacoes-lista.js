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

  // ─── Datas ('AAAA-MM-DD' em todo o módulo) ───

  /** 'dd/MM/yyyy' · 'AAAA-MM-DD…' · milissegundos → 'AAAA-MM-DD' (dia em São Paulo) */
  iso(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') return new Date(v - 3 * 3600 * 1000).toISOString().slice(0, 10);
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return '';
  },

  somarDias(dia, n) {
    const d = new Date(dia + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  },

  /** b − a, em dias */
  diasEntre(a, b) {
    return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
  },

  proximoMes(mes) {
    const [a, m] = mes.split('-').map(Number);
    return new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 7);
  },

  /** O mês inteiro e a antecipação (1 a 15 do mês seguinte). */
  periodos(mes) {
    const prox = this.proximoMes(mes);
    return {
      mes: { de: mes + '-01', ate: this.somarDias(prox + '-01', -1) },
      antecipacao: { de: prox + '-01', ate: prox + '-15' },
    };
  },

  /** O mês corrente; do dia 25 em diante, também o seguinte ("gerada no fim do mês M"). */
  mesesParaManter(hoje) {
    const mes = hoje.slice(0, 7);
    return Number(hoje.slice(8, 10)) >= 25 ? [mes, this.proximoMes(mes)] : [mes];
  },

  /** 11 dígitos com dígitos verificadores de CPF. CPF nunca é gravado nem mostrado. */
  pareceCpf(v) {
    const d = String(v == null ? '' : v).replace(/\D/g, '');
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    const dv = n => {
      let s = 0;
      for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
  },

  // ─── Histórico (itens processados de `periodos`, TecnoFit e Pacto) ───

  _semPlanoReal(item) {
    const n = this.norm(item);
    return this.temTermo(n, 'IMPORTACAO') || n.includes('[PLANO PRESUMIDO]');
  },

  /** Tira o "(01/04/2025 - 30/09/2025)" que o motor põe no nome do item. */
  limparNomePlano(item) {
    return String(item || '').replace(/\s*\(\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  },

  /** Itens do mesmo cliente (por nome), do mais recente para o mais antigo. */
  _doCliente(nome, historico) {
    const alvo = this.norm(nome);
    return (historico || []).filter(h => this.norm(h.cliente) === alvo)
      .sort((a, b) => (this.iso(b.data) > this.iso(a.data) ? 1 : this.iso(b.data) < this.iso(a.data) ? -1 : 0));
  },

  ehNaoConsultora(nome, lista) {
    const n = this.norm(nome);
    if (!n || n === 'SEM VENDEDOR') return true;
    return (lista || this.NAO_CONSULTORAS).some(x => n.includes(this.norm(x)));
  },

  /** Plano do TecnoFit de um contrato que veio da migração como "IMPORTAÇÃO". */
  planoOriginal(nome, historico) {
    const h = this._doCliente(nome, historico).find(x => x.isContract && !x.isDegustacao && !this._semPlanoReal(x.item));
    return h ? this.limparNomePlano(h.item) : null;
  },

  consultoraDoHistorico(nome, historico, naoConsultoras) {
    const h = this._doCliente(nome, historico).find(x => x.isContract && !this.ehNaoConsultora(x.vendedor, naoConsultoras));
    return h ? String(h.vendedor).trim() : null;
  },

  /** Opções de "plano alvo" / "plano fechado": planos vendidos na unidade nos últimos N dias. */
  planosRecentes(historico, hoje, dias = 90) {
    const desde = this.somarDias(hoje, -dias);
    const set = new Set();
    (historico || []).forEach(h => {
      if (!h.isContract || h.isDegustacao || this._semPlanoReal(h.item)) return;
      if (this.iso(h.data) < desde) return;
      set.add(this.limparNomePlano(h.item));
    });
    return [...set].sort();
  },

  /**
   * Degustações vendidas cujo fim cai no mês ou em 1–15 do seguinte, no mesmo
   * formato dos contratos da Previsão (+ plano, datas e consultora). Servem para
   * completar o Bloco 3 quando a Previsão da Pacto não traz a degustação.
   */
  degustacoesDoHistorico(historico, periodos) {
    const out = [];
    (historico || []).forEach(h => {
      if (!h.isDegustacao) return;
      const fim = this.iso(h.planEndDate);
      if (!fim || fim < periodos.mes.de || fim > periodos.antecipacao.ate) return;
      const m = String(h.codigo || '').match(/^C(\d+)/);
      if (!m) return;
      out.push({
        codigoContrato: m[1], codigoCliente: null, matriculaCliente: null, nomeCliente: String(h.cliente || '').trim(),
        plano: this.limparNomePlano(h.item), inicio: this.iso(h.planStartDate), vencimento: fim,
        consultora: this.ehNaoConsultora(h.vendedor) ? null : String(h.vendedor).trim(),
      });
    });
    return out;
  },
};

if (typeof module !== 'undefined') module.exports = RenovacoesLista;
if (typeof window !== 'undefined') window.RenovacoesLista = RenovacoesLista;
