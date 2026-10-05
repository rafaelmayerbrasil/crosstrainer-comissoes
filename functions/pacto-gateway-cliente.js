'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Cliente do GATEWAY da Pacto com a credencial POR UNIDADE — só LEITURA
// ═══════════════════════════════════════════════════════════════════════
//
// Desenho: docs/superpowers/specs/2026-09-30-api-pacto-oficial-design.md §1–2
//
// Duas rotas:
//  • GET /contratos/{n}: consultora do contrato, quem lançou, plano e valor.
//    É o que dá a vendedora do Campeche (o núcleo nunca deu) e acha a
//    degustação grátis pela numeração dos contratos.
//  • GET /importacao/psec/relFaturamentoRecebido/vendas: as vendas recebidas por
//    produto, que trazem o balcão (água, Monster, camiseta) ausente do núcleo.
// A credencial da unidade pode gravar e apagar na Pacto: nenhuma rota que grava
// entra aqui.
//
// ⚠️ A resposta do contrato traz CPF (da consultora e do aluno): só a lista
//    branca de `lerContrato` sai daqui. A credencial nunca vai para o motivo.

const { classificar } = require('./pacto-api-cliente.js');

const GW = 'https://apigw.pactosolucoes.com.br';

/** ms da Pacto → 'DD/MM/AAAA' em São Paulo (UTC−3 o ano todo desde 2019) */
function diaSP(ms) {
  if (typeof ms !== 'number' || !isFinite(ms)) return '';
  const [a, m, d] = new Date(ms - 3 * 3600e3).toISOString().slice(0, 10).split('-');
  return d + '/' + m + '/' + a;
}

/**
 * O plano de ANTES da migração do TecnoFit mora na observação do contrato
 * (01/10/2026, achado do Rodrigo: 50 de 50 importações conferidas). A observação
 * é texto livre — só sai daqui quando o plano é IMPORTAÇÃO, curta e sem nada que
 * pareça documento.
 */
function planoOriginalDaObservacao(plano, observacao) {
  if (!/IMPORTA[CÇ][AÃ]O/i.test(String(plano || ''))) return '';
  const t = String(observacao || '').replace(/\s+/g, ' ').trim();
  if (!t || /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/.test(t)) return '';
  return t.slice(0, 120);
}

/** Contrato do gateway → só os campos que o sistema usa. `null` se o número não existe. */
function lerContrato(c) {
  if (!c || c.codigo == null) return null;
  const p = c.pessoaDTO || {};
  const novo = c.contratoResponsavelRenovacaoMatricula;
  return {
    codigo: String(c.codigo),
    consultor: c.nomeConsultorReponsavel || null,
    lancou: c.responsavelLancamento || null,
    plano: c.descricaoPlano || '',
    valor: Number(c.valor) || 0,
    tipo: c.tipo || '',
    situacao: c.situacao || '',
    lancamento: diaSP(c.dataLancamento),
    vigenciaDe: diaSP(c.vigenciaDe),
    vigenciaAte: diaSP(c.vigenciaAteAjustada || c.vigenciaAte),
    cliente: { codigo: p.codigo == null ? '' : String(p.codigo), nome: p.nome || '' },
    // Para a lista de renovações (01/10/2026)
    planoOriginal: planoOriginalDaObservacao(c.descricaoPlano, c.observacao),
    recorrencia: !!c.regimeRecorrencia,
    renovadoEm: diaSP(c.dataRenovarRealizada),          // dia em que o contrato NOVO foi lançado
    contratoNovo: novo ? String(novo) : null,
    // De que contrato este veio (05/10/2026): a renovação de plano recorrente que continua
    // o MESMO plano não é venda, seja quem for que lançou — ver PactoAdapter.ehContinuacaoDe
    anterior: c.contratoBaseadoRenovacao ? String(c.contratoBaseadoRenovacao) : null,
  };
}

// A Pacto aceita 1 consulta por segundo por rota. Sem pausa, parte das respostas
// do /contratos voltou VAZIA e sem erro (amostra de 30/09/2026) — 1,25 s de folga.
// `tempoLimiteMs`: a Pacto às vezes segura a conexão e devolve 504 depois de muito
// tempo (tarde de 30/09/2026) — uma consulta presa não pode comer a madrugada.
function criarClienteGateway({ fetch, credencial, base = GW, pausaMs = 1250, dormir, tempoLimiteMs = 20000 }) {
  if (typeof fetch !== 'function') throw new Error('criarClienteGateway: fetch é obrigatório');
  if (!credencial) throw new Error('criarClienteGateway: credencial é obrigatória');
  const esperar = dormir || (ms => new Promise(r => setTimeout(r, ms)));
  let chamadas = 0;

  async function get(caminho, esperaMinima) {
    const espera = Math.max(chamadas > 0 ? pausaMs : 0, esperaMinima || 0);
    if (espera > 0) await esperar(espera);                     // nunca em rajada
    chamadas++;
    let res, texto;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const relogio = ctl ? setTimeout(() => ctl.abort(), tempoLimiteMs) : null;
    try {
      res = await fetch(base + caminho, {
        method: 'GET',
        headers: { Authorization: credencial, empresaId: '1', Accept: 'application/json' },
        signal: ctl ? ctl.signal : undefined,
      });
      texto = await res.text();
    } catch (e) {
      if (e && e.name === 'AbortError') return { situacao: 'falhou', motivo: 'tempo esgotado (' + Math.round(tempoLimiteMs / 1000) + ' s) sem resposta da Pacto' };
      return { situacao: 'falhou', motivo: 'rede: ' + String(e && e.message || e).split(credencial).join('<credencial>') };
    } finally {
      if (relogio) clearTimeout(relogio);
    }
    return classificar(res.status, texto, credencial);
  }

  async function comRepeticao(caminho) {
    let r = await get(caminho);
    if (r.situacao === 'falhou') r = await get(caminho);             // falha passageira: uma vez só
    else if (r.situacao === 'limite') r = await get(caminho, 2500);  // limite por segundo: espera e tenta uma vez
    return r;
  }

  return {
    get chamadas() { return chamadas; },

    /** `{situacao:'ok', dados}` — `dados` null quando o número não existe na unidade */
    async contrato(codigo) {
      const r = await comRepeticao('/contratos/' + encodeURIComponent(String(codigo)));
      if (r.situacao !== 'ok') return r;
      return { situacao: 'ok', dados: lerContrato(r.dados && r.dados.content) };
    },

    /**
     * A consultora VINCULADA AO ALUNO — é ela que a coluna "Consultor" do export
     * mostra e que decide a comissão, não a do contrato (4739, PP, set/2026:
     * contrato Bárbara, arquivo e vínculo Kali). Duas consultas: o código da
     * pessoa dá a matrícula, e a matrícula dá os vínculos ('CO' = consultor).
     * Da primeira resposta sai só a matrícula (ela traz CPF).
     */
    async consultorDoAluno(codPessoa) {
      const a = await comRepeticao('/clientes/dados-clientes/' + encodeURIComponent(String(codPessoa)));
      if (a.situacao !== 'ok') return a;
      const mat = a.dados && a.dados.content && a.dados.content.matricula;
      if (!mat) return { situacao: 'ok', dados: { matricula: null, consultor: null, consultores: [] } };
      const b = await comRepeticao('/clientes/' + encodeURIComponent(String(mat)) + '/dados-plano');
      if (b.situacao !== 'ok') return b;
      const vinculos = (b.dados && b.dados.content && b.dados.content.vinculos) || [];
      // `consultores`: há aluno com DOIS vínculos de consultor (CP 7269, 01/10/2026).
      // `consultor` segue sendo o primeiro — é ele que as comissões usam.
      const cos = vinculos.filter(v => v && v.tipoVinculo === 'CO' && v.colaborador).map(v => String(v.colaborador));
      return { situacao: 'ok', dados: { matricula: String(mat), consultor: cos[0] || null, consultores: cos } };
    },

    /** Vendas recebidas num dia ('AAAA-MM-DD'). A rota não aceita ano: vale o ano corrente. */
    async vendasDoDia(dia) {
      const dm = dia.slice(8, 10) + '/' + dia.slice(5, 7);
      const r = await comRepeticao('/importacao/psec/relFaturamentoRecebido/vendas?inicio=' + dm + '&fim=' + dm);
      if (r.situacao !== 'ok') return r;
      const d = r.dados || {};
      if (!Array.isArray(d.produtos)) {
        return { situacao: 'falhou', motivo: 'vendas: ' + String(d.message || d.status || 'sem lista de produtos').slice(0, 120) };
      }
      const out = [];
      d.produtos.forEach(p => (p.listaVendas || []).forEach(v => out.push({
        produto: p.produto || '',
        valor: Number(v.valor) || 0,
        cliente: v.nome || '',
        contrato: v.codigoContrato ? String(v.codigoContrato) : '0',
        dia: String(v.dataHoraVenda || '').slice(0, 10),
      })));
      return { situacao: 'ok', dados: out };
    },
  };
}

module.exports = { criarClienteGateway, lerContrato, planoOriginalDaObservacao, diaSP, GW };
