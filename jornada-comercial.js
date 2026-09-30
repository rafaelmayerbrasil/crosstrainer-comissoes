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

  /** { nome do cadastro: mínimo } das vendedoras com jornada valendo no mês. */
  minimosDoMes(users, mes, cfg) {
    const out = {};
    (users || []).forEach(u => {
      if (!this._ehVendedora(u) || !u.name) return;
      const m = this.minimoDoMes(u.jornadasComerciais, mes, cfg);
      if (typeof m === 'number') out[u.name] = m;
    });
    return out;
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
