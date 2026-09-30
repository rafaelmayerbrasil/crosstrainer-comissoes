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

  /** Início e fim do plano de um item: dos campos do motor ou do "(dd/mm/aaaa - dd/mm/aaaa)" do nome. */
  _vigenciaDoItem(h) {
    let inicio = this.iso(h.planStartDate), fim = this.iso(h.planEndDate);
    if (!inicio || !fim) {
      const m = String(h.item || '').match(/\((\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})\)/);
      if (m) { inicio = inicio || this.iso(m[1]); fim = fim || this.iso(m[2]); }
    }
    return { inicio, fim };
  },

  /**
   * Plano do TecnoFit de um contrato que veio da migração como "IMPORTAÇÃO".
   * Primeiro o contrato do aluno com a MESMA vigência (fim, depois início) —
   * pegar só o último contrato transformava a degustação importada em
   * "renovação" (maio/2026: 0 degustações contra 8 do PDF do Rodrigo). Sem data
   * igual, o último que não é degustação.
   */
  planoOriginal(nome, historico, vigencia) {
    const v = vigencia || {};
    const doCliente = this._doCliente(nome, historico).filter(x => x.isContract && !this._semPlanoReal(x.item));
    const porData = (v.vencimento && doCliente.find(x => this._vigenciaDoItem(x).fim === v.vencimento))
      || (v.inicio && doCliente.find(x => this._vigenciaDoItem(x).inicio === v.inicio));
    const h = porData || doCliente.find(x => !x.isDegustacao);
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

  // ─── A lista ───

  /**
   * @param {object} a
   * @param {string} a.mes          'AAAA-MM'
   * @param {string} a.hoje         'AAAA-MM-DD' em São Paulo
   * @param {object} a.previsao     { mes: {contratos, renovados}, antecipacao: {contratos, renovados} }
   *                                contratos: [{codigoContrato, codigoCliente, matriculaCliente, nomeCliente}]
   * @param {object} a.contratos    número do contrato → {nomePlano, vigenciaDe, vigenciaAte, consultor}
   * @param {Array}  a.historico    itens processados de `periodos`
   * @param {object} [a.gestao]     número do contrato → {blocoGestao, consultoraAtribuida}
   * @param {object} [a.desdeAnterior] número do contrato → dia em que entrou na lista
   * @param {Array}  [a.naoConsultoras]
   */
  montar({ mes, hoje, previsao, contratos, historico, gestao, desdeAnterior, naoConsultoras }) {
    const per = this.periodos(mes);
    const cad = contratos || {};
    const ges = gestao || {};
    const desde = desdeAnterior || {};
    const excluidos = {};
    const conta = m => { excluidos[m] = (excluidos[m] || 0) + 1; };
    const pm = (previsao && previsao.mes) || {};
    const pa = (previsao && previsao.antecipacao) || {};
    const renovados = new Set([...(pm.renovados || []), ...(pa.renovados || [])].map(String));
    const brutos = [...(pm.contratos || []), ...(pa.contratos || [])];
    const totalPacto = brutos.length;
    const dataBR = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);

    // 1. mesmo contrato duas vezes (as duas consultas se sobrepõem) = uma linha
    const vistos = new Set();
    const unicos = [];
    brutos.forEach(b => {
      const k = String(b.codigoContrato);
      if (vistos.has(k)) { conta('duplicado'); return; }
      vistos.add(k);
      unicos.push(b);
    });

    // 2. a linha e a classificação
    const linhas = [];
    unicos.forEach(b => {
      const codigoContrato = String(b.codigoContrato);
      const c = cad[codigoContrato] || null;
      const g = ges[codigoContrato] || {};
      const linha = {
        codigoContrato,
        codigoCliente: b.codigoCliente == null ? null : String(b.codigoCliente),
        matricula: b.matriculaCliente == null || this.pareceCpf(b.matriculaCliente) ? null : String(b.matriculaCliente),
        nome: String(b.nomeCliente || '').trim(),
        plano: c ? String(c.nomePlano || '') : '',
        planoOriginal: null,
        economico: false,
        inicio: c ? this.iso(c.vigenciaDe) : '',
        vencimento: c ? this.iso(c.vigenciaAte) : '',
        consultora: null,
        consultoraOrigem: null,
        renovouSistema: renovados.has(codigoContrato),
        notas: [],
        desde: desde[codigoContrato] || hoje,
        origem: 'pacto',
        n: null,
      };
      let cls = c ? this.classificarPlano(linha.plano) : { tipo: 'verificar', motivo: 'A Pacto não devolveu os dados deste contrato' };
      if (cls.tipo === 'importacao') {
        const orig = this.planoOriginal(linha.nome, historico, { vencimento: linha.vencimento, inicio: linha.inicio });
        if (orig) {
          linha.planoOriginal = orig;
          cls = this.classificarPlano(orig);
        }
        if (!orig || cls.tipo === 'importacao') cls = { tipo: 'verificar', motivo: 'Importação sem plano original identificado' };
      }
      if (cls.tipo === 'verificar' && g.blocoGestao) {
        cls = g.blocoGestao === 'excluir' ? { tipo: 'excluir', motivo: 'gestao' } : { tipo: g.blocoGestao };
      }
      if ((cls.tipo === 'renovacao' || cls.tipo === 'degustacao') && !linha.vencimento) {
        cls = { tipo: 'verificar', motivo: 'Contrato sem data de vencimento na Pacto' };
      }
      if (cls.tipo === 'excluir') { conta(cls.motivo); return; }
      linha.economico = !!cls.economico;
      linha._cls = cls;
      linha._consultorPacto = c ? c.consultor : null;
      linhas.push(linha);
    });

    // 3. mesmo aluno mais de uma vez: fica o vencimento mais próximo
    const porAluno = new Map();
    linhas.forEach(l => {
      const k = l.codigoCliente || this.norm(l.nome);
      if (!porAluno.has(k)) porAluno.set(k, []);
      porAluno.get(k).push(l);
    });
    const ficam = [];
    porAluno.forEach(grupo => {
      const v = l => l.vencimento || '9999';
      grupo.sort((a, b) => (v(a) < v(b) ? -1 : v(a) > v(b) ? 1 : 0));
      if (grupo.length > 1) grupo[0].notas.push(`Aluno repetido na Previsão (${grupo.length}×): ficou o vencimento mais próximo`);
      grupo.slice(1).forEach(() => conta('duplicado'));
      ficam.push(grupo[0]);
    });

    // 4. consultora, notas e bloco
    const blocos = { renovacoes: [], antecipacao: [], degustacoes: [], verificar: [] };
    const noPeriodo = (v, de, ate) => v && v >= de && v <= ate;
    ficam.forEach(l => {
      const g = ges[l.codigoContrato] || {};
      if (g.consultoraAtribuida) { l.consultora = g.consultoraAtribuida; l.consultoraOrigem = 'gestao'; }
      else if (l._consultorPacto && !this.ehNaoConsultora(l._consultorPacto, naoConsultoras)) { l.consultora = l._consultorPacto; l.consultoraOrigem = 'pacto'; }
      else {
        const h = this.consultoraDoHistorico(l.nome, historico, naoConsultoras);
        if (h) { l.consultora = h; l.consultoraOrigem = 'historico'; }
      }
      if (l.renovouSistema) l.notas.push('A Pacto já registra a renovação');

      const cls = l._cls;
      delete l._cls; delete l._consultorPacto;
      if (cls.tipo === 'verificar') { l.motivoVerificar = cls.motivo; blocos.verificar.push(l); return; }
      if (cls.tipo === 'degustacao') {
        if (noPeriodo(l.vencimento, per.mes.de, per.antecipacao.ate)) { blocos.degustacoes.push(l); return; }
      } else if (noPeriodo(l.vencimento, per.mes.de, per.mes.ate)) { blocos.renovacoes.push(l); return; }
      else if (noPeriodo(l.vencimento, per.antecipacao.de, per.antecipacao.ate)) { blocos.antecipacao.push(l); return; }
      l.motivoVerificar = `Vencimento fora do período (${dataBR(l.vencimento)})`;
      blocos.verificar.push(l);
    });
    const naLista = ficam.length;

    // 5. degustações do histórico que a Previsão não trouxe (fora da conferência)
    const jaTem = new Set(ficam.map(l => l.codigoContrato));
    const nomes = new Set(ficam.map(l => this.norm(l.nome)));
    this.degustacoesDoHistorico(historico, per).forEach(d => {
      if (jaTem.has(d.codigoContrato) || nomes.has(this.norm(d.nomeCliente))) return;
      const g = ges[d.codigoContrato] || {};
      blocos.degustacoes.push({
        codigoContrato: d.codigoContrato, codigoCliente: null, matricula: null, nome: d.nomeCliente,
        plano: d.plano, planoOriginal: null, economico: false, inicio: d.inicio, vencimento: d.vencimento,
        consultora: g.consultoraAtribuida || d.consultora,
        consultoraOrigem: g.consultoraAtribuida ? 'gestao' : (d.consultora ? 'historico' : null),
        renovouSistema: false, notas: ['Degustação vendida que não veio na Previsão da Pacto'],
        desde: desde[d.codigoContrato] || hoje, origem: 'historico', n: null,
      });
    });

    // 6. ordem e numeração
    const ordem = (a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0);
    Object.values(blocos).forEach(ls => ls.sort(ordem));
    let k = 0;
    blocos.renovacoes.forEach(l => { l.n = ++k; });
    blocos.antecipacao.forEach(l => { l.n = ++k; });
    blocos.degustacoes.forEach((l, i) => { l.n = i + 1; });

    const totalExcluidos = Object.values(excluidos).reduce((s, v) => s + v, 0);
    const consultoras = [...new Set(Object.values(blocos).flat().map(l => l.consultora).filter(Boolean))].sort();
    return {
      mes,
      periodos: per,
      blocos,
      excluidos,
      conferencia: {
        totalPacto, naLista, excluidos: totalExcluidos,
        bate: naLista + totalExcluidos === totalPacto, diferenca: totalPacto - naLista - totalExcluidos,
      },
      planosRecentes: this.planosRecentes(historico, hoje),
      consultoras,
    };
  },

  // ─── O que a consultora preenche ───

  /** Sim se ela disse Sim ou se a Pacto já registra; senão, o que ela marcou. */
  statusEfetivo(linha, acomp) {
    const s = acomp && acomp.renovou;
    if (s === 'sim' || (linha && linha.renovouSistema)) return 'sim';
    return this.STATUS[s] ? s : 'pendente';
  },

  consultoraDaLinha(linha, acomp) {
    return (acomp && acomp.consultoraAtribuida) || (linha && linha.consultora) || null;
  },

  /** Lista de erros (vazia = pode gravar). Mesmas regras do documento, seção 5. */
  validar(acomp, hoje) {
    const a = acomp || {};
    const erros = [];
    const s = a.renovou || 'pendente';
    if (!this.STATUS[s]) erros.push('Situação inválida.');
    if (a.dataContato && this.iso(a.dataContato) > hoje) erros.push('A data do 1º contato não pode ser no futuro.');
    if (s !== 'pendente' && !a.dataContato) erros.push('Informe a data do 1º contato.');
    if (s === 'sim' && !String(a.planoFechado || '').trim()) erros.push('Informe o plano fechado.');
    if (s === 'nao' && !a.motivo) erros.push('Informe o motivo.');
    if (s === 'nao' && a.motivo && this.MOTIVOS_NAO_RENOVOU.indexOf(a.motivo) < 0) erros.push('Motivo fora da lista.');
    if (s === 'nao' && a.motivo === 'Outro' && !String(a.observacoes || '').trim()) erros.push('Motivo "Outro" exige observação.');
    (a.semanas || []).forEach((d, i) => {
      if (d && this.iso(d) > hoje) erros.push(`A data da semana ${i + 1} não pode ser no futuro.`);
    });
    return erros;
  },

  /** [{nivel: 'vermelho'|'laranja', codigo, texto}] */
  alertas(linha, acomp, bloco, hoje) {
    const out = [];
    const a = acomp || {};
    if (bloco === 'verificar') {
      if (this.diasEntre(linha.desde || hoje, hoje) > 3) {
        out.push({ nivel: 'laranja', codigo: 'verificar_parado', texto: 'No "Verificar manualmente" há mais de 3 dias' });
      }
      return out;
    }
    const s = this.statusEfetivo(linha, a);
    const aberto = s === 'pendente' || s === 'negociacao';
    if (aberto && linha.vencimento) {
      const faltam = this.diasEntre(hoje, linha.vencimento);
      if (faltam >= 0 && faltam <= 7 && !a.dataContato) {
        out.push({ nivel: 'vermelho', codigo: 'vence_sem_contato', texto: `Vence em ${faltam} dia(s) e ainda não houve contato` });
      }
      if (faltam < -7) {
        out.push({ nivel: 'vermelho', codigo: 'vencido', texto: `Venceu há ${-faltam} dias e segue ${this.STATUS[s].toLowerCase()}` });
      }
    }
    if (bloco === 'degustacoes' && aberto && linha.inicio && linha.inicio <= hoje) {
      const nestaSemana = (a.semanas || []).some(d => {
        const x = this.iso(d);
        return x && this.diasEntre(x, hoje) >= 0 && this.diasEntre(x, hoje) <= 6;
      });
      if (!nestaSemana) out.push({ nivel: 'laranja', codigo: 'degustacao_sem_acompanhamento', texto: 'Sem acompanhamento registrado nesta semana' });
    }
    if (a.renovou === 'nao' && linha.renovouSistema) {
      out.push({ nivel: 'laranja', codigo: 'divergencia', texto: 'Marcado como "Não", mas a Pacto registra a renovação — conferir' });
    }
    return out;
  },

  /** Números do topo da lista. `acomps`: número do contrato → acompanhamento. */
  painel(lista, acomps, hoje) {
    const ac = acomps || {};
    const blocos = (lista && lista.blocos) || {};
    const DA_EQUIPE = ['renovacoes', 'antecipacao', 'degustacoes'];
    const porBloco = {};
    DA_EQUIPE.forEach(b => {
      const c = { total: 0, sim: 0, nao: 0, negociacao: 0, pendente: 0 };
      (blocos[b] || []).forEach(l => { c.total++; c[this.statusEfetivo(l, ac[l.codigoContrato])]++; });
      porBloco[b] = c;
    });
    const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
    const porConsultora = {};
    DA_EQUIPE.forEach(b => (blocos[b] || []).forEach(l => {
      const a = ac[l.codigoContrato];
      const nome = this.consultoraDaLinha(l, a) || 'Sem consultora';
      const x = porConsultora[nome] = porConsultora[nome] || { total: 0, renovados: 0 };
      x.total++;
      if (this.statusEfetivo(l, a) === 'sim') x.renovados++;
    }));
    const alertas = { vermelho: 0, laranja: 0 };
    Object.keys(blocos).forEach(b => (blocos[b] || []).forEach(l => {
      this.alertas(l, ac[l.codigoContrato], b, hoje).forEach(x => { alertas[x.nivel]++; });
    }));
    return {
      porBloco,
      totalARenovar: porBloco.renovacoes.total,
      taxaRenovacao: pct(porBloco.renovacoes.sim, porBloco.renovacoes.total),
      conversaoDegustacao: pct(porBloco.degustacoes.sim, porBloco.degustacoes.total),
      porConsultora,
      alertas,
    };
  },
};

if (typeof module !== 'undefined') module.exports = RenovacoesLista;
if (typeof window !== 'undefined') window.RenovacoesLista = RenovacoesLista;
