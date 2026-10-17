// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Jornada da vendedora → mínimo individual do bônus
// ═══════════════════════════════════════════════════════════════════════
//
// Desenho: docs/superpowers/specs/2026-09-29-renovacoes-metas-bonus-design.md §5.2
//
// A jornada mora no cadastro da vendedora (`users/{uid}.jornadasComerciais`),
// com "a partir de (mês)", igual ao histórico de salário dos professores. Mudar
// a jornada é acrescentar uma entrada nova — os meses passados continuam com o
// mínimo que valeu neles. Puro: sem Firebase, sem tela.

const JornadaComercial = {

  TIPOS: { integral: 'Integral', '30h': '30 horas', adaptacao: 'Em adaptação (começando)' },
  // Números do documento do Rodrigo (29/09/2026); a unidade pode mudar na tela Regras
  PADRAO: { minIndivIntegral: 18, minIndiv30h: 12, pctAdaptacao: 50 },

  /** A entrada que vale no mês: a mais recente com `desde` ≤ mês. */
  entradaDoMes(jornadas, mes) {
    const validas = (jornadas || []).filter(j => j && typeof j.desde === 'string' && j.desde <= mes)
      .sort((a, b) => (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : 0));
    return validas.length ? validas[validas.length - 1] : null;
  },

  /** Mínimo de ativações do mês para esta jornada; null se não há jornada valendo. */
  minimoDoMes(jornadas, mes, cfg) {
    const e = this.entradaDoMes(jornadas, mes);
    if (!e) return null;
    const c = { ...this.PADRAO, ...(cfg || {}) };
    if (e.tipo === 'integral') return c.minIndivIntegral;
    if (e.tipo === '30h') return c.minIndiv30h;
    if (e.tipo === 'adaptacao') return Math.ceil(c.minIndivIntegral * (c.pctAdaptacao / 100));
    return null;
  },

  _ehVendedora(u) {
    const perfis = [].concat((u && u.profiles) || [], u && u.role ? [u.role] : []);
    return perfis.indexOf('vendedor') >= 0;
  },

  /**
   * { nome nas comissões: mínimo } das vendedoras com jornada valendo no mês.
   * A chave é `nomeNasComissoes` (o nome da venda) e, sem ele, o nome do cadastro:
   * em 14/10/2026 o cadastro da Francini foi encurtado e o mínimo dela ia sumir.
   */
  minimosDoMes(users, mes, cfg) {
    const out = {};
    (users || []).forEach(u => {
      const chave = (u && (u.nomeNasComissoes || u.name)) || '';
      if (!this._ehVendedora(u) || !chave) return;
      const m = this.minimoDoMes(u.jornadasComerciais, mes, cfg);
      if (typeof m === 'number') out[chave] = m;
    });
    return out;
  },

  // ── Quando ela trabalhou (16/10/2026) ──────────────────────────────────
  // A Pacto mostra em cada venda a consultora de HOJE do aluno: quando a carteira
  // muda de dona, as vendas antigas mudam junto. Em set/2026 vendas de 01–13/09
  // foram para a Isabela, que começou em 14/09. Regra pedida pelo Rodrigo e
  // escolhida pelo Rafael: a venda só fica com quem já trabalhava na data dela.
  // Datas no cadastro: `comercialInicio` / `comercialFim` ('AAAA-MM-DD'); sem data,
  // não há restrição.

  /** 'DD/MM/AAAA' ou 'AAAA-MM-DD' → 'AAAA-MM-DD' ('' se não for data) */
  _iso(data) {
    const s = String(data || '').trim();
    let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return m[3] + '-' + m[2] + '-' + m[1];
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[0] : '';
  },

  /** Ela já tinha começado e ainda não tinha saído nesta data? Sem data no cadastro = sim. */
  trabalhavaEm(u, data) {
    const d = this._iso(data);
    if (!u || !d) return true;
    const ini = this._iso(u.comercialInicio), fim = this._iso(u.comercialFim);
    if (ini && d < ini) return false;
    if (fim && d > fim) return false;
    return true;
  },

  /** Erros de "começou em / saiu em" (vazio = pode gravar). Datas 'AAAA-MM-DD' ou vazias. */
  validarPeriodo(inicio, fim) {
    const erros = [];
    const ok = v => !v || /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!ok(inicio) || !ok(fim)) erros.push('Data inválida.');
    else if (inicio && fim && fim < inicio) erros.push('A saída não pode ser antes do começo.');
    return erros;
  },

  /** Erros da entrada nova (vazio = pode gravar). */
  validarEntrada(entrada, existentes) {
    const e = entrada || {};
    const erros = [];
    if (!/^\d{4}-\d{2}$/.test(String(e.desde || ''))) erros.push('Informe o mês no formato AAAA-MM.');
    if (!this.TIPOS[e.tipo]) erros.push('Jornada inválida.');
    if (!erros.length && (existentes || []).some(x => x && x.desde === e.desde)) erros.push('Já existe uma jornada a partir deste mês — remova a outra antes.');
    return erros;
  },
};

if (typeof module !== 'undefined') module.exports = JornadaComercial;
if (typeof window !== 'undefined') window.JornadaComercial = JornadaComercial;
