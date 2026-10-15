// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — O login da vendedora × o nome dela nas comissões
// ═══════════════════════════════════════════════════════════════════════
//
// As comissões, a lista de renovações e o mínimo do bônus são guardados pelo
// NOME da vendedora como vem da Pacto ("FRANCINI DAS CHAGAS"). O login é outra
// coisa: o nome de exibição do cadastro, que a gestão muda na tela Pessoas.
// Em 14/10/2026 o cadastro virou "FRANCINI CHAGAS" e o painel dela ficou preto.
//
// Por isso o cadastro guarda `nomeNasComissoes` — o nome exato das comissões —
// e é ele que liga a pessoa ao que é dela. Sem o campo (vendedora nova, antes
// de a gestão ligar), vale a busca pelas palavras inteiras do nome, na ordem; e
// se mais de um nome casar, NENHUM: nunca mostrar a comissão de uma colega.
//
// Puro: sem Firebase, sem tela. Teste: scripts/smoke-vendedora-nome.js

const VendedoraNome = {

  // Não contam como palavra do nome ("FRANCINI CHAGAS" ⊂ "FRANCINI DAS CHAGAS")
  CONECTIVOS: ['DA', 'DAS', 'DE', 'DO', 'DOS', 'E'],

  norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/\s+/g, ' ').trim();
  },

  palavras(s) {
    const c = this.CONECTIVOS;
    return this.norm(s).split(' ').filter(p => p && c.indexOf(p) < 0);
  },

  /** Todas as palavras do nome curto aparecem no longo, na mesma ordem? */
  _contido(curto, longo) {
    const a = this.palavras(curto), b = this.palavras(longo);
    if (!a.length) return false;
    let i = 0;
    for (const p of b) if (p === a[i]) i++;
    return i === a.length;
  },

  /** Uma linha (venda, contrato da lista) é desta pessoa? */
  ehDela(nomeNaLinha, u) {
    if (!u) return false;
    const fixo = this.norm(u.nomeNasComissoes);
    if (fixo) return this.norm(nomeNaLinha) === fixo;
    return this._casaPeloNome(nomeNaLinha, u.name);
  },

  _casaPeloNome(nomeNaLinha, nome) {
    const a = this.norm(nomeNaLinha), b = this.norm(nome);
    if (!a || !b) return false;
    return a === b || this._contido(b, a);
  },

  /** Entre os nomes que aparecem no mês, o desta pessoa (ou null). */
  achar(u, nomes) {
    if (!u) return null;
    const fixo = this.norm(u.nomeNasComissoes);
    if (fixo) return (nomes || []).find(n => this.norm(n) === fixo) || null;
    return this.sugerir(u, nomes);
  },

  /** Pelo nome de exibição, ignorando a ligação: o igual; senão o único que casa. */
  sugerir(u, nomes) {
    const nome = this.norm(u && u.name);
    if (!nome) return null;
    const lista = nomes || [];
    const igual = lista.find(n => this.norm(n) === nome);
    if (igual) return igual;
    const casam = lista.filter(n => this._casaPeloNome(n, nome));
    return casam.length === 1 ? casam[0] : null;
  },
};

if (typeof module !== 'undefined') module.exports = VendedoraNome;
if (typeof window !== 'undefined') window.VendedoraNome = VendedoraNome;
