'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Cliente HTTP da API da Pacto — modo sombra
// ═══════════════════════════════════════════════════════════════════════
//
// Desenho: docs/superpowers/specs/2026-09-13-pacto-api-modo-sombra-design.md
//
// Só LEITURA. As únicas rotas que este arquivo conhece são `resumoPeriodo` e
// `consultarContratos`. A mesma família de endpoints da Pacto tem operações
// que gravam (cadastrar, estornar, trancar contrato) — nenhuma aparece aqui.
//
// Por que o núcleo direto e não o gateway (`apigw`): o gateway preenche a
// chave da academia a partir da credencial, e a credencial nasce na
// Administração — que não tem venda. O núcleo aceita a chave no caminho e,
// com a MESMA credencial, lê cada unidade (verificado em 13/09/2026).
//
// ⚠️ A credencial nunca vai para log nem para `motivo`.

const BASE = 'https://app.pactosolucoes.com.br/api/prest';

/** 'AAAA-MM-DD' → 'dd/MM/yyyy' */
function paraBR(dia) {
  const [a, m, d] = String(dia).split('-');
  return `${d}/${m}/${a}`;
}

/**
 * Traduz uma resposta HTTP em situação. A Pacto responde `200` com erro no corpo
 * e já respondeu "sucesso" com tudo zerado — por isso o corpo é lido sempre.
 */
function classificar(status, texto, credencial) {
  const limpo = s => {
    let t = String(s || '').slice(0, 300);
    if (credencial) t = t.split(credencial).join('<credencial>');
    return t;
  };
  if (status === 401 || status === 403) return { situacao: 'credencial_recusada', motivo: 'HTTP ' + status };
  if (status === 429 || /limite de requisi|too many requests|rate limit/i.test(String(texto || ''))) {
    return { situacao: 'limite', motivo: 'HTTP ' + status + ' ' + limpo(texto) };
  }
  if (status >= 500) return { situacao: 'falhou', motivo: 'HTTP ' + status + ' ' + limpo(texto) };
  if (status !== 200) return { situacao: 'falhou', motivo: 'HTTP ' + status + ' ' + limpo(texto) };
  let dados;
  try {
    dados = JSON.parse(texto);
  } catch (e) {
    return { situacao: 'falhou', motivo: 'resposta não é JSON: ' + limpo(texto).slice(0, 80) };
  }
  // `{"erro": "..."}` com HTTP 200 (visto em 22/09/2026, intermitente). Lido como
  // resposta boa, virava "dia sem nenhum pagamento" e era gravado por cima.
  if (dados && typeof dados === 'object' && !Array.isArray(dados) && typeof dados.erro === 'string') {
    return { situacao: 'falhou', motivo: 'a Pacto respondeu erro: ' + limpo(dados.erro).slice(0, 120) };
  }
  return { situacao: 'ok', dados };
}

function criarCliente({ fetch, credencial, pausaMs = 2000, dormir, base = BASE }) {
  if (typeof fetch !== 'function') throw new Error('criarCliente: fetch é obrigatório');
  if (!credencial) throw new Error('criarCliente: credencial é obrigatória');
  const esperar = dormir || (ms => new Promise(r => setTimeout(r, ms)));
  let chamadas = 0;

  // A falha da Pacto costuma ser passageira: tenta de novo UMA vez (com a mesma
  // pausa). Credencial recusada e limite de uso não se repetem — insistir piora.
  async function chamar(url) {
    const r = await chamarUmaVez(url);
    return r.situacao === 'falhou' ? chamarUmaVez(url) : r;
  }

  async function chamarUmaVez(url) {
    if (chamadas > 0 && pausaMs > 0) await esperar(pausaMs);   // nunca em rajada
    chamadas++;
    let res, texto;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: credencial, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}',
      });
      texto = await res.text();
    } catch (e) {
      return { situacao: 'falhou', motivo: 'rede: ' + String(e && e.message || e).split(credencial).join('<credencial>') };
    }
    return classificar(res.status, texto, credencial);
  }

  return {
    get chamadas() { return chamadas; },

    /** Resumo de UM dia de uma unidade. */
    async resumoDoDia(chave, dia) {
      const d = paraBR(dia);
      return chamar(`${base}/importacao/${encodeURIComponent(chave)}/resumoPeriodo?inicio=${d}&fim=${d}`);
    },

    /** Todos os contratos de um cliente (plano, situação, vigência). */
    async contratosDoCliente(chave, cliente) {
      const r = await chamar(`${base}/cliente/${encodeURIComponent(chave)}/consultarContratos?cliente=${encodeURIComponent(cliente)}&registros=50`);
      if (r.situacao !== 'ok') return r;
      const lista = r.dados && Array.isArray(r.dados.return) ? r.dados.return : [];
      return { situacao: 'ok', dados: lista };
    },
  };
}

module.exports = { criarCliente, classificar, paraBR, BASE };
