'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Cliente da Previsão de Renovação da Pacto (gateway, credencial POR UNIDADE)
// ═══════════════════════════════════════════════════════════════════════
//
// Desenho: docs/superpowers/specs/2026-09-29-renovacoes-metas-bonus-design.md §2
//
// Só LEITURA: a única rota deste arquivo é `v2-indice-renovacao`. A credencial
// da unidade pode gravar e apagar na Pacto — nenhuma rota que grava entra aqui.
// É a mesma tela "Previsão de Renovação" que o Rodrigo usa, ANTES das exclusões
// dele (recorrente, crédito…): quem exclui é o renovacoes-lista.js.
//
// ⚠️ A credencial nunca vai para log nem para `motivo`.

const { classificar } = require('./pacto-api-cliente.js');

const GW = 'https://apigw.pactosolucoes.com.br';
// Nomes conferidos contra a Pacto em 29/09/2026 (spec §2.4)
const LISTA_PREVISAO = 'contratosPrevisaoMes';
const LISTAS_RENOVADOS = ['contratosRenovadosPrevisaoMes'];

/** Dias 'AAAA-MM-DD' → milissegundos do dia inteiro em São Paulo (UTC−3 o ano todo desde 2019). */
function intervaloMs(de, ate) {
  const [a1, m1, d1] = de.split('-').map(Number);
  const [a2, m2, d2] = ate.split('-').map(Number);
  return { dataInicial: Date.UTC(a1, m1 - 1, d1, 3, 0, 0), dataFinal: Date.UTC(a2, m2 - 1, d2 + 1, 2, 59, 59) };
}

/** Resposta da Pacto → {contratos, renovados} | null. Do contrato, só os campos que a lista usa. */
function lerListas(dados) {
  const c = (dados && dados.content) || dados || {};
  let j = c.jsonDados;
  if (typeof j === 'string') {
    try { j = JSON.parse(j); } catch (e) { return null; }
  }
  if (!j || typeof j !== 'object' || !Array.isArray(j[LISTA_PREVISAO])) return null;
  const renovados = [];
  LISTAS_RENOVADOS.forEach(k => (Array.isArray(j[k]) ? j[k] : []).forEach(x => {
    if (x && x.codigoContrato != null) renovados.push(String(x.codigoContrato));
  }));
  const contratos = j[LISTA_PREVISAO].filter(x => x && x.codigoContrato != null).map(x => ({
    codigoContrato: String(x.codigoContrato),
    codigoCliente: x.codigoCliente == null ? null : String(x.codigoCliente),
    matriculaCliente: x.matriculaCliente == null ? null : String(x.matriculaCliente),
    nomeCliente: String(x.nomeCliente || ''),
  }));
  return { contratos, renovados };
}

function criarClienteRenovacao({ fetch, credencial, base = GW }) {
  if (typeof fetch !== 'function') throw new Error('criarClienteRenovacao: fetch é obrigatório');
  if (!credencial) throw new Error('criarClienteRenovacao: credencial é obrigatória');
  let chamadas = 0;

  async function uma(corpo) {
    chamadas++;
    let res, texto;
    try {
      res = await fetch(base + '/v2-indice-renovacao', {
        method: 'POST',
        headers: { Authorization: credencial, empresaId: '1', 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(corpo),
      });
      texto = await res.text();
    } catch (e) {
      return { situacao: 'falhou', motivo: 'rede: ' + String(e && e.message || e).split(credencial).join('<credencial>') };
    }
    return classificar(res.status, texto, credencial);
  }

  return {
    get chamadas() { return chamadas; },

    /** Contratos que vencem entre `de` e `ate` ('AAAA-MM-DD'), e os já renovados. */
    async previsao(de, ate) {
      const corpo = { empresa: 1, ...intervaloMs(de, ate), retornarContratos: true,
        desconsiderarContratosRenovaveis: false, considerarMudancaDePlano: false };
      let r = await uma(corpo);
      if (r.situacao === 'falhou') r = await uma(corpo);       // falha passageira: uma vez só
      if (r.situacao !== 'ok') return r;
      const l = lerListas(r.dados);
      if (!l) return { situacao: 'falhou', motivo: 'resposta sem a lista de contratos da previsão' };
      return { situacao: 'ok', dados: l };
    },
  };
}

module.exports = { criarClienteRenovacao, intervaloMs, lerListas, GW, LISTA_PREVISAO, LISTAS_RENOVADOS };
