// scale-rebalance.js — motor PURO do rebalanceio por pessoa.
//
// A gestão põe 3 onde está 4 e o sistema tira a pessoa de um sábado chamando
// quem tem MENOS dias; põe 5 e tira de quem tem MAIS (Rodrigo, 28/08/2026).
// Regra de desempate confirmada pelo Rafael no mesmo dia: dias → pontuação →
// sorteio.
//
// Devolve PLANO, não efeito: não lê nem grava nada, não olha o relógio. Quem
// aplica é a camada de serviço, que também republica a agenda e avisa as
// pessoas. Consequência prática: a prévia que a gestão vê e o que o "Aplicar"
// faz são o MESMO objeto — não há segunda montagem que possa divergir.
//
// ⚠️ SORTEIO SEM `Math.random()`: ver `sementeDoPlano` lá embaixo. Sem isso a
// prévia e o teste virariam loteria, e este projeto já perdeu escala real por
// motor que decidia diferente a cada rodada ([[escala-contador-derivado]]).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScaleRebalance = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DIA_MS = 86400000;
  const VIZINHANCA_PADRAO = 7;   // ±7 dias = o sábado anterior e o seguinte
  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

  function diasEntre(a, b) {
    const da = new Date(a + 'T12:00:00'), db = new Date(b + 'T12:00:00');
    if (isNaN(da) || isNaN(db)) return Infinity;
    return Math.abs(Math.round((db - da) / DIA_MS));
  }

  function fmtBR(iso) { return String(iso || '').split('-').reverse().join('/'); }

  // Ordem de texto por código de caractere, NÃO `localeCompare`: o resultado
  // não pode depender do locale do navegador de quem clicou. Aqui isso decide
  // sorteio — em máquina diferente, escala diferente.
  function cmpTexto(a, b) {
    const x = String(a), y = String(b);
    return x < y ? -1 : (x > y ? 1 : 0);
  }

  // ── Sorteio determinístico ────────────────────────────────────────────────
  //
  // O desempate final é "sorteia" (Rafael, 28/08). Um motor puro não pode usar
  // `Math.random()`: o plano tem que ser função só das entradas — mesma janela,
  // mesmas pessoas, mesmo plano, em qualquer máquina e quantas vezes rodar.
  //
  // A saída: a semente sai de uma IMPRESSÃO DIGITAL das entradas. Continua um
  // sorteio de verdade no que importa (não favorece quem tem nome no começo do
  // alfabeto — mudou a data, mudou o resultado), mas é reproduzível: a prévia
  // que a gestão viu é exatamente o que o "Aplicar" grava.
  //
  // `rng` injetado tem precedência (é como os testes fixam o resultado), e
  // `semente` permite ao chamador pedir OUTRO sorteio de propósito ("sortear de
  // novo") sem que nada mais mude.
  function hashFNV(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Impressão digital das entradas. Ordenada por id/data de propósito: trocar a
   * ORDEM da lista de candidatos não pode mudar o plano — só trocar o conteúdo.
   */
  function sementeDoPlano(pessoaId, alvo, viz, estado, candidatos, semente) {
    if (semente != null) return hashFNV(String(semente));
    const d = estado.map(dt =>
      dt.scaleId + '|' + dt.date + '|' + (dt.published ? 1 : 0) + '|' +
      dt.slots.map(s => [s.id, s.unitId || '', s.requiredModalityId || '', s.assignedPersonId || ''].join(':'))
        .slice().sort(cmpTexto).join(',')
    ).slice().sort(cmpTexto).join(';');
    const c = (candidatos || []).map(x => [
      x.id, Number(x.merito) || 0, Number(x.dias) || 0,
      (x.cota == null ? '' : x.cota), (x.modalityIds || []).slice().sort(cmpTexto).join('+'),
      (x.indisponivel || []).slice().sort(cmpTexto).join('+'), x.pref || '',
    ].join(':')).slice().sort(cmpTexto).join(';');
    return hashFNV(pessoaId + '|' + alvo + '|' + viz + '|' + d + '|' + c);
  }

  function sortear(lista, rng) {
    if (lista.length <= 1) return lista[0];
    let r = typeof rng === 'function' ? rng() : 0;
    if (!(r >= 0 && r < 1)) r = 0;                       // rng malcomportado não sorteia fora da lista
    return lista[Math.min(lista.length - 1, Math.floor(r * lista.length))];
  }

  /**
   * Escolhe entre concorrentes: menor `chave` primeiro; empate → `desempate`
   * (maior primeiro); empate → `preferencia` (menor primeiro, critério de tela:
   * data não publicada e mais conveniente); empate de novo → sorteio.
   *
   * Devolve também QUAL critério decidiu, que é o que a prévia mostra pra
   * gestão — a pergunta que ela faz é "por que essa pessoa?".
   */
  function melhor(lista, chave, desempate, preferencia, rng) {
    if (!lista.length) return null;
    if (lista.length === 1) return { item: lista[0], criterio: 'unico' };
    const minC = Math.min.apply(null, lista.map(chave));
    const a = lista.filter(x => chave(x) === minC);
    if (a.length === 1) return { item: a[0], criterio: 'rodizio' };
    const maxD = Math.max.apply(null, a.map(desempate));
    const b = a.filter(x => desempate(x) === maxD);
    if (b.length === 1) return { item: b[0], criterio: 'merito' };
    const minP = Math.min.apply(null, b.map(preferencia));
    const c = b.filter(x => preferencia(x) === minP);
    if (c.length === 1) return { item: c[0], criterio: 'data' };
    const ordenados = c.slice().sort((x, y) => cmpTexto(x.ordem, y.ordem));
    return { item: sortear(ordenados, rng), criterio: 'sorteio' };
  }

  /** Quem está em alguma vaga DESTA DATA — em qualquer escala dela. */
  function ocupantesDaData(estado, dateISO) {
    const out = new Set();
    estado.forEach(dt => {
      if (dt.date !== dateISO) return;
      (dt.slots || []).forEach(s => { if (s.assignedPersonId) out.add(s.assignedPersonId); });
    });
    return out;
  }

  /**
   * Está escalado numa data a até `vizinhanca` dias desta (fora ela própria)?
   * Mesma convenção de `personsOnNearbyScale` em scale-service.js: a própria
   * data fica de fora porque quem já está nela é barrado por `ocupantesDaData`.
   */
  function temVizinha(estado, personId, dateISO, vizinhanca) {
    return estado.some(dt => dt.date !== dateISO
      && diasEntre(dt.date, dateISO) <= vizinhanca
      && (dt.slots || []).some(s => s.assignedPersonId === personId));
  }

  function planejar(args) {
    const opts = args || {};
    const pessoaId = opts.pessoaId;
    const viz = (opts.vizinhanca == null) ? VIZINHANCA_PADRAO : opts.vizinhanca;
    const movimentos = [], avisos = [];

    // Cópia profunda: o plano SIMULA os movimentos sem tocar na entrada. A tela
    // segue mostrando a escala de verdade enquanto a prévia está aberta.
    const estado = [];
    (opts.datas || []).forEach(dt => {
      if (!dt || !ISO_RE.test(String(dt.date || ''))) {
        // Data podre não vira Infinity silencioso em `diasEntre` — ela sai do
        // plano E a gestão fica sabendo.
        avisos.push('Ignorei uma data com formato inválido (' + String((dt && dt.date) || '?') + ').');
        return;
      }
      estado.push({
        scaleId: dt.scaleId, date: dt.date, published: !!dt.published,
        slots: (dt.slots || []).map(s => Object.assign({}, s)),
      });
    });
    estado.sort((a, b) => cmpTexto(a.date, b.date) || cmpTexto(a.scaleId, b.scaleId));

    const dias = Object.create(null);      // `create(null)`: id de pessoa não colide com `constructor`/`__proto__`
    const porId = Object.create(null);
    (opts.candidatos || []).forEach(c => {
      if (!c || !c.id) return;
      porId[c.id] = c;
      dias[c.id] = Number(c.dias) || 0;
    });

    const indisponivel = (id, date) =>
      ((porId[id] || {}).indisponivel || []).indexOf(date) !== -1;
    const habilitado = (id, modId) =>
      !modId || (((porId[id] || {}).modalityIds) || []).indexOf(modId) !== -1;
    const acimaDaCota = (id) => {
      const c = porId[id] || {};
      return (c.cota === 0 || c.cota > 0) && (dias[id] || 0) >= c.cota;
    };

    const atual = estado.reduce((n, dt) =>
      n + (dt.slots || []).filter(s => s.assignedPersonId === pessoaId).length, 0);
    // Se a pessoa ajustada não veio na lista de candidatos, a conta dela sai do
    // que está na tela — senão ela "teria 0 dias" e o ramo de aumentar tiraria
    // de quem tem menos que ela achando que tem mais.
    if (dias[pessoaId] == null) dias[pessoaId] = atual;

    // `alvo` inválido NÃO pode virar 0 por `Number('x') || 0` — 0 quer dizer
    // "tira ela de todos os sábados". Erro de digitação não esvazia escala.
    //
    // ⚠️ `Number('')` e `Number(null)` dão 0, não NaN. Sem esta primeira linha,
    // campo VAZIO viraria o alvo 0 e o motor tiraria a pessoa de tudo — o pior
    // resultado possível vindo do input mais provável.
    const alvoVazio = (opts.alvo == null || opts.alvo === '' || (typeof opts.alvo === 'string' && !opts.alvo.trim()));
    const alvoN = alvoVazio ? NaN : Number(opts.alvo);
    if (!Number.isInteger(alvoN) || alvoN < 0) {
      avisos.push('Alvo inválido (' + String(opts.alvo) + '). Não planejei nada.');
      return { atual, alvo: null, atingiu: false, movimentos, avisos };
    }

    const rng = (typeof opts.rng === 'function')
      ? opts.rng
      : mulberry32(sementeDoPlano(pessoaId, alvoN, viz, estado, opts.candidatos, opts.semente));

    if (alvoN === atual) return { atual, alvo: alvoN, atingiu: true, movimentos, avisos };

    if (alvoN < atual) {
      // ── REDUZIR ────────────────────────────────────────────────────────────
      // Sai da data NÃO publicada primeiro; entre iguais, da mais DISTANTE —
      // mexer no que está mais longe incomoda menos gente. Publicada PODE ser
      // mexida (Rafael, 28/08), só entra por último e o serviço avisa.
      const ordem = estado
        .filter(dt => (dt.slots || []).some(s => s.assignedPersonId === pessoaId))
        .sort((a, b) => (a.published === b.published)
          ? (cmpTexto(b.date, a.date) || cmpTexto(a.scaleId, b.scaleId))   // mais distante primeiro
          : (a.published ? 1 : -1));

      let faltam = atual - alvoN;
      for (let i = 0; i < ordem.length && faltam; i++) {
        const dt = ordem[i];
        const slot = (dt.slots || []).find(s => s.assignedPersonId === pessoaId);
        if (!slot) continue;
        const noDia = ocupantesDaData(estado, dt.date);
        const elegiveis = (opts.candidatos || []).filter(c =>
          c && c.id &&
          c.id !== pessoaId &&
          c.pref !== 'nao_posso' &&                                  // dia que a pessoa bloqueou
          habilitado(c.id, slot.requiredModalityId) &&
          !noDia.has(c.id) &&                                        // ninguém em duas vagas do mesmo dia
          !indisponivel(c.id, dt.date) &&                            // férias aprovadas
          !temVizinha(estado, c.id, dt.date, viz));                  // dois sábados seguidos, não
        // Quem bateu a cota vai pro fim da fila (teto MACIO, igual ao motor):
        // melhor escalar acima da cota do que deixar sábado sem professor.
        const preferidos = elegiveis.filter(c => !acimaDaCota(c.id));
        const pool = (preferidos.length ? preferidos : elegiveis).map(c => ({
          id: c.id, merito: Number(c.merito) || 0, ordem: c.id,
        }));
        const r = melhor(pool, (c) => dias[c.id] || 0, (c) => c.merito, () => 0, rng);
        if (!r) {
          avisos.push('Não achei quem entrasse em ' + fmtBR(dt.date) +
            ' — a vaga ficaria aberta. Não mexi nesse dia.');
          continue;
        }
        const entraId = r.item.id;
        const diasSai = dias[pessoaId] || 0, diasEntra = dias[entraId] || 0;
        slot.assignedPersonId = entraId;
        // O contador anda A CADA movimento: sem isso, pedir 3 movimentos
        // escolheria a mesma vítima três vezes.
        dias[pessoaId] = Math.max(0, diasSai - 1);
        dias[entraId] = diasEntra + 1;
        movimentos.push({
          scaleId: dt.scaleId, date: dt.date, published: dt.published,
          slotId: slot.id, unitId: slot.unitId,
          modalidade: slot.requiredModalityName || null,
          saiId: pessoaId, entraId: entraId,
          motivo: r.criterio, diasSai: diasSai, diasEntra: diasEntra,
        });
        faltam--;
      }
      if (faltam > 0) {
        avisos.push('Não deu para tirar ' + faltam + ' dia(s): sem substituto para as datas que sobraram.');
      }
      return { atual, alvo: alvoN, atingiu: faltam === 0, movimentos, avisos };
    }

    // ── AUMENTAR ─────────────────────────────────────────────────────────────
    // NÃO dá pra decidir data por data como no reduzir: lá a vaga já está
    // fixada (é a que a pessoa está saindo) e só se escolhe QUEM entra nela.
    // Aqui a vaga não está fixada — a pessoa pode entrar em qualquer dia
    // livre —, então cada movimento olha TODAS as datas elegíveis JUNTAS e
    // escolhe o melhor par (dia, vítima): mais dias na vítima → menor mérito
    // → data (não publicada, mais próxima) → sorteio. Escolher por data
    // primeiro faria o primeiro dia da fila ganhar sozinho mesmo com uma
    // vítima de mérito pior do que um candidato num dia seguinte.
    const dataOrdinal = (iso) => Math.round(new Date(iso + 'T12:00:00').getTime() / DIA_MS);
    // Não publicada (0) sempre antes de publicada (1); dentro do mesmo grupo,
    // a data mais próxima (menor ordinal) vence — por isso o fator grande.
    const prefEntrada = (dt) => (dt.published ? 1 : 0) * 1e7 + dataOrdinal(dt.date);

    const datasElegiveis = () => estado
      .filter(dt => !ocupantesDaData(estado, dt.date).has(pessoaId))   // ninguém em duas vagas do mesmo dia
      .filter(dt => !indisponivel(pessoaId, dt.date))                 // férias aprovadas
      .filter(dt => !temVizinha(estado, pessoaId, dt.date, viz));     // dois sábados seguidos, não

    const jaAvisado = new Set();   // scaleId — não repete o mesmo aviso a cada volta do laço
    let faltamMais = alvoN - atual;
    while (faltamMais > 0) {
      const pool = [];
      datasElegiveis().forEach(dt => {
        // Só vale tirar de quem tem MAIS dias que ela — senão o rebalanceio
        // desequilibraria a fila em vez de equilibrá-la.
        const vitimas = (dt.slots || [])
          .filter(s => s.assignedPersonId && s.assignedPersonId !== pessoaId)
          .filter(s => habilitado(pessoaId, s.requiredModalityId))
          .filter(s => (dias[s.assignedPersonId] || 0) > (dias[pessoaId] || 0));
        if (!vitimas.length) {
          if (!jaAvisado.has(dt.scaleId)) {
            jaAvisado.add(dt.scaleId);
            avisos.push('Em ' + fmtBR(dt.date) +
              ' ninguém tem mais dias do que ela (ou a modalidade não bate). Não mexi nesse dia.');
          }
          return;
        }
        vitimas.forEach(s => pool.push({
          dt, slot: s, id: s.assignedPersonId,
          merito: Number((porId[s.assignedPersonId] || {}).merito) || 0,
          pref: prefEntrada(dt), ordem: s.assignedPersonId,
        }));
      });
      if (!pool.length) break;   // nada mais a fazer — sobra faltamMais > 0, vira aviso final

      // Sai quem tem MAIS dias → empate: MENOR mérito → empate: data (não
      // publicada, mais próxima) → empate: sorteio. `melhor` sempre MINIMIZA a
      // chave e MAXIMIZA o desempate — por isso os sinais invertidos (mais
      // dias = -dias mínimo; menor mérito = -mérito máximo).
      const r = melhor(pool, (x) => -(dias[x.id] || 0), (x) => -x.merito, (x) => x.pref, rng);
      const saiId = r.item.id;
      const diasSai = dias[saiId] || 0, diasEntra = dias[pessoaId] || 0;
      r.item.slot.assignedPersonId = pessoaId;
      // O contador anda A CADA movimento: sem isso, pedir 3 movimentos
      // escolheria a mesma vítima três vezes.
      dias[saiId] = Math.max(0, diasSai - 1);
      dias[pessoaId] = diasEntra + 1;
      movimentos.push({
        scaleId: r.item.dt.scaleId, date: r.item.dt.date, published: r.item.dt.published,
        slotId: r.item.slot.id, unitId: r.item.slot.unitId,
        modalidade: r.item.slot.requiredModalityName || null,
        saiId: saiId, entraId: pessoaId,
        motivo: r.criterio, diasSai: diasSai, diasEntra: diasEntra,
      });
      faltamMais--;
    }
    if (faltamMais > 0) {
      avisos.push('Não deu para dar ' + faltamMais + ' dia(s) a mais: sem vaga com mais dias para tirar.');
    }
    return { atual, alvo: alvoN, atingiu: faltamMais === 0, movimentos, avisos };
  }

  return { planejar, VIZINHANCA_PADRAO };
});
