// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Meta do mês sugerida pelo sistema: a conta
// ═══════════════════════════════════════════════════════════════════════
//
// Desenho: docs/superpowers/specs/2026-09-29-renovacoes-metas-bonus-design.md §4
// (e o de 10/09: 2026-09-10-meta-sugerida-pelo-sistema-design.md, no que não mudou).
//
// Puro: sem Firebase, sem tela. Recebe a série dos meses FECHADOS da unidade e
// as metas definidas antes, e devolve os campos de `metasMensais` com o porquê
// de cada um. A tela só grava e mostra — a gestão sempre revisa.
//
// Respostas do Rodrigo (29/09): um conjunto só de mínimos para Meta, Super e
// Gold; renovação = 65% das que vencem no mês (Bloco 1 da lista de
// renovações); novos = 35% da meta; voucher segue a prática recente até ele
// dizer o que é a "base de vouchers". Fórmula da meta: a dele (50/25/15) e a
// média de 6 meses EMPATARAM no backtest de 29/09 (CP 12,8 × 12,9; PP 8,6 × 8,1).

const MetasSugeridas = {

  FORMULA_PADRAO: 'rodrigo',
  PCT_SUPER: 1.15,
  PCT_GOLD: 1.30,
  PCT_NOVOS: 0.35,
  PCT_RENOV: 0.65,
  MIN_MESES: 3,

  /** Maior dia ('AAAA-MM-DD') de uma lista de datas 'dd/mm/aaaa'. */
  maiorData(datas) {
    let max = null;
    (datas || []).forEach(s => {
      const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (!m) return;
      const iso = `${m[3]}-${m[2]}-${m[1]}`;
      if (!max || iso > max) max = iso;
    });
    return max;
  },

  /**
   * O mês entra na conta só se o dado chega ao fim dele (desenho de 10/09: setembro
   * subido até o dia 8 derrubava a meta de outubro de 58 para 49, em silêncio).
   * Tolerância de 2 dias: sábado e domingo no fim do mês podem não ter venda.
   */
  mesCompleto(mes, maiorDia) {
    if (!maiorDia) return false;
    const [a, m] = mes.split('-').map(Number);
    const ultimo = new Date(Date.UTC(a, m, 0));
    ultimo.setUTCDate(ultimo.getUTCDate() - 2);
    return maiorDia >= ultimo.toISOString().slice(0, 10);
  },

  _mesMenos(mes, n) {
    const [a, m] = mes.split('-').map(Number);
    return new Date(Date.UTC(a, m - 1 - n, 1)).toISOString().slice(0, 7);
  },
  _media(xs) { return xs.reduce((s, x) => s + x, 0) / xs.length; },
  _r1(x) { return String(Math.round(x * 10) / 10).replace('.', ','); },

  /** Meses fechados (completos) anteriores a `mes`, em ordem. */
  _completosAntes(serie, mes) {
    return Object.keys(serie || {}).filter(m => m < mes && serie[m] && serie[m].completo !== false).sort();
  },

  /** Média de `campo` nos até 6 meses completos anteriores a `mes`. */
  _media6(serie, mes, campo) {
    const ms = this._completosAntes(serie, mes).slice(-6);
    return ms.length ? this._media(ms.map(m => Number(serie[m][campo]) || 0)) : null;
  },

  /**
   * Fator da prática recente: média de (valor definido ÷ média dos 6 anteriores)
   * nos últimos 3 meses com meta definida. Impede a conta de endurecer sozinha.
   */
  _fator(serie, metas, mes, campoMeta, campoSerie) {
    const comMeta = Object.keys(metas || {}).filter(m => m < mes && metas[m] && typeof metas[m][campoMeta] === 'number').sort().slice(-3);
    const fatores = comMeta.map(m => {
      const med = this._media6(serie, m, campoSerie);
      return med ? metas[m][campoMeta] / med : null;
    }).filter(f => f != null && isFinite(f));
    return fatores.length ? { fator: this._media(fatores), meses: comMeta } : { fator: 1, meses: [] };
  },

  _meta(serie, mes, formula, janela) {
    const med6 = this._media(janela.map(m => Number(serie[m].ativacoes) || 0));
    const porqueMedia = `média dos ${janela.length} meses fechados: ${janela.map(m => this._r1(serie[m].ativacoes)).join(' · ')}`;
    if (formula !== 'rodrigo') return { valor: med6, porque: porqueMedia };
    const doMes = n => { const m = this._mesMenos(mes, n); return serie[m] && serie[m].completo !== false ? Number(serie[m].ativacoes) || 0 : null; };
    const m1 = doMes(1), m2 = doMes(2), m3 = doMes(3), a1 = doMes(12);
    if ([m1, m2, m3].some(x => x == null)) {
      return { valor: med6, porque: `faltam os 3 meses anteriores fechados para a fórmula do Rodrigo — ${porqueMedia}` };
    }
    const med3 = this._media([m1, m2, m3]);
    if (a1 == null) {
      return {
        valor: (0.5 * m1 + 0.25 * med3) / 0.75,
        porque: `50% do mês anterior (${this._r1(m1)}) + 25% da média dos 3 anteriores (${this._r1(med3)}), reescalado — sem o mesmo mês do ano anterior, que não está no sistema`,
      };
    }
    return {
      valor: (0.5 * m1 + 0.25 * med3 + 0.15 * a1) / 0.9,
      porque: `50% do mês anterior (${this._r1(m1)}) + 25% da média dos 3 anteriores (${this._r1(med3)}) + 15% do mesmo mês do ano anterior (${this._r1(a1)}); os 10% de ajuste são a revisão da gestão`,
    };
  },

  /**
   * @param {object} a
   * @param {string} a.mes               'AAAA-MM' a propor
   * @param {object} a.serie             'AAAA-MM' → {ativacoes, novosRetorno, renovacoes, vouchers, completo}
   * @param {object} a.metasAnteriores   'AAAA-MM' → metasMensais já definidas
   * @param {number|null} a.renovacaoBase renovações que vencem no mês (Bloco 1 da lista); null = sem lista
   * @param {string} [a.formula]         'rodrigo' | 'media6'
   */
  sugerir({ mes, serie, metasAnteriores, renovacaoBase, formula }) {
    const f = formula || this.FORMULA_PADRAO;
    const completos = this._completosAntes(serie, mes);
    const janela = completos.slice(-6);
    const inicioJanela = janela[0] || mes;
    const parciaisIgnorados = Object.keys(serie || {})
      .filter(m => m < mes && m >= inicioJanela && serie[m] && serie[m].completo === false).sort();
    const base = { meses: janela, parciaisIgnorados, formula: f, renovacaoBase: renovacaoBase == null ? null : renovacaoBase };

    if (completos.length < this.MIN_MESES) {
      return { campos: null, confiavel: false, base,
        porque: { geral: `só ${completos.length} mês(es) fechado(s) no sistema — defina a meta à mão` } };
    }

    const m = this._meta(serie, mes, f, janela);
    const meta = Math.round(m.valor);
    const porque = { meta: m.porque + (parciaisIgnorados.length ? ` (fora por estarem incompletos: ${parciaisIgnorados.join(', ')})` : '') };

    const campos = {
      meta,
      superMeta: Math.round(meta * this.PCT_SUPER),
      metaGold: Math.round(meta * this.PCT_GOLD),
      minNovos: Math.ceil(meta * this.PCT_NOVOS),
    };
    porque.superMeta = `meta × ${String(this.PCT_SUPER).replace('.', ',')}`;
    porque.metaGold = `meta × ${String(this.PCT_GOLD).replace('.', ',')}`;
    porque.minNovos = `35% da meta (${meta}), arredondado para cima — o Rodrigo usa de 35% a 40%`;

    if (renovacaoBase != null) {
      campos.minRenov = Math.min(Math.ceil(renovacaoBase * this.PCT_RENOV), renovacaoBase);
      porque.minRenov = `65% das ${renovacaoBase} renovações que vencem no mês (lista de renovações)`;
    } else {
      const med = this._media6(serie, mes, 'renovacoes');
      const fr = this._fator(serie, metasAnteriores, mes, 'minRenov', 'renovacoes');
      campos.minRenov = Math.round(med * fr.fator);
      porque.minRenov = `sem a lista de renovações do mês: média de renovações (${this._r1(med)}) × fator da prática recente (${this._r1(fr.fator)})`;
    }

    const medV = this._media6(serie, mes, 'vouchers');
    const fv = this._fator(serie, metasAnteriores, mes, 'minVoucher', 'vouchers');
    campos.minVoucher = Math.round(medV * fv.fator);
    porque.minVoucher = `média de vouchers dos meses fechados (${this._r1(medV)}) × fator da prática recente da gestão (${this._r1(fv.fator)}${fv.meses.length ? ', de ' + fv.meses.join(', ') : ', sem meta anterior'})`;

    const ultimos = Object.keys(metasAnteriores || {}).filter(x => x < mes && metasAnteriores[x]
      && typeof metasAnteriores[x].minAtivacoesIndivP3 === 'number').sort();
    if (ultimos.length) {
      const u = ultimos[ultimos.length - 1];
      campos.minAtivacoesIndivP3 = metasAnteriores[u].minAtivacoesIndivP3;
      porque.minAtivacoesIndivP3 = `o mesmo de ${u}`;
    }

    return { campos, porque, base, confiavel: true };
  },

  // ─── O que a tela (index.html) pergunta ───

  // A proposta automática vale de outubro/2026 em diante — meses anteriores
  // nunca são tocados (setembro/PP fica sem meta por decisão da gestão).
  INICIO: '2026-10',

  /**
   * `periodos`: [{ mes, data (doc do período), maiorDia ('AAAA-MM-DD' dos itens) }].
   * Devolve a série dos meses ANTERIORES a `mes` que têm conta, e as metas definidas.
   */
  serieDosPeriodos(periodos, mes) {
    const serie = {}, metas = {};
    (periodos || []).forEach(p => {
      if (!p || !p.mes || p.mes >= mes || !p.data) return;
      const mm = p.data.metasMensais;
      if (mm && Object.keys(mm).length) metas[p.mes] = mm;
      const t = p.data.totals;
      if (!t || typeof t.unitAtivacoes !== 'number') return;
      serie[p.mes] = {
        ativacoes: t.unitAtivacoes, novosRetorno: t.unitNovosRetorno || 0, renovacoes: t.unitRenovacoes || 0,
        vouchers: t.unitVouchers || 0, completo: this.mesCompleto(p.mes, p.maiorDia), ate: p.maiorDia || null,
      };
    });
    return { serie, metas };
  },

  /** Admin abrindo um mês de outubro em diante, com conta e sem meta nenhuma. */
  precisaPropor({ mes, periodo, ehAdmin }) {
    if (!ehAdmin || !mes || mes < this.INICIO || !periodo || !periodo.totals) return false;
    const mm = periodo.metasMensais;
    if (mm && Object.keys(mm).length) return false;
    return !periodo.metaSugerida;
  },

  /** A meta foi posta pelo sistema e ninguém revisou: o recibo do mês não sai. */
  aguardandoRevisao(periodo) {
    return !!(periodo && periodo.metaSugerida && periodo.metaSugerida.origem === 'sistema' && !periodo.metaSugerida.revisadaPor);
  },

  /** Aviso do painel do admin; '' quando não há o que revisar. */
  avisoHtml(periodo) {
    if (!this.aguardandoRevisao(periodo)) return '';
    const m = periodo.metasMensais || {};
    const MESES = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const rot = (MESES[periodo.month] || '') + '/' + (periodo.year || '');
    const num = v => (typeof v === 'number' ? v : '—');
    return `
      <div style="background:var(--yellow-bg, rgba(253,216,53,0.08));border:1px solid var(--yellow, #FDD835);border-radius:10px;padding:16px 20px;margin-bottom:18px">
        <div style="font-size:11px;font-weight:800;color:var(--yellow, #FDD835);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">⚠️ A meta de ${rot} foi calculada pelo sistema e ninguém revisou</div>
        <div style="font-size:13px;color:var(--text2);line-height:1.6">
          Meta <strong>${num(m.meta)}</strong> · Super <strong>${num(m.superMeta)}</strong> · Gold <strong>${num(m.metaGold)}</strong> —
          mínimos: novos + retorno ${num(m.minNovos)}, renovações ${num(m.minRenov)}, vouchers ${num(m.minVoucher)}.
          <br>O erro típico da conta é de ~10 ativações. <strong>O recibo deste mês não sai até alguém confirmar.</strong>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn btn-sm" onclick="revisarMetaSugerida()">Revisar</button>
          <button class="btn btn-sm btn-outline" onclick="confirmarMetaSugerida()">Está bom</button>
        </div>
      </div>`;
  },
};

if (typeof module !== 'undefined') module.exports = MetasSugeridas;
if (typeof window !== 'undefined') window.MetasSugeridas = MetasSugeridas;
