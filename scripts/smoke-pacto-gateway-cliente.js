'use strict';
// Roda: node scripts/smoke-pacto-gateway-cliente.js
//
// O cliente do GATEWAY da Pacto com a credencial por unidade (30/09/2026):
// consultora do contrato, degustação pela numeração e vendas de balcão.
// Pacto FALSA, dados inventados — o repositório é público.

const assert = require('assert');
const path = require('path');
const { criarClienteGateway } = require(path.join(__dirname, '..', 'functions', 'pacto-gateway-cliente.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);
const CRED = 'cred-falsa-123';

function pacto(rotas) {
  const chamadas = [];
  const fetch = async (url, opts) => {
    chamadas.push({ url, opts });
    for (const [re, r] of rotas) {
      if (re.test(url)) {
        const x = typeof r === 'function' ? r(chamadas.length) : r;
        return { status: x.status || 200, text: async () => JSON.stringify(x.body) };
      }
    }
    return { status: 404, text: async () => 'nao previsto' };
  };
  return { fetch, chamadas };
}

const MS_25_08 = Date.UTC(2026, 7, 25, 20, 59, 20); // 17:59 em São Paulo
const bruto = {
  codigo: 4638, tipo: 'MA', situacao: 'IN', descricaoPlano: 'MÊS DEGUSTAÇÃO LIVRE.', valor: 0,
  dataLancamento: MS_25_08, vigenciaDe: Date.UTC(2026, 7, 25, 3), vigenciaAte: Date.UTC(2026, 8, 24, 3),
  nomeConsultorReponsavel: 'CONSULTORA UM', responsavelLancamento: 'CONSULTORA UM',
  pessoaDTO: { codigo: 77, nome: 'CLIENTE FICTICIO', cpf: '111.222.333-44' },
  consultorResponsavel: { pessoa: { cpf: '999.888.777-66' } },
};

(async () => {
  {
    const p = pacto([[/\/contratos\/4638$/, { body: { content: bruto } }], [/\/contratos\/4639$/, { body: { content: {} } }]]);
    const c = criarClienteGateway({ fetch: p.fetch, credencial: CRED, pausaMs: 0 });
    const r = await c.contrato(4638);
    assert.strictEqual(r.situacao, 'ok');
    assert.deepStrictEqual(r.dados, {
      codigo: '4638', consultor: 'CONSULTORA UM', lancou: 'CONSULTORA UM',
      plano: 'MÊS DEGUSTAÇÃO LIVRE.', valor: 0, tipo: 'MA', situacao: 'IN', lancamento: '25/08/2026',
      vigenciaDe: '25/08/2026', vigenciaAte: '24/09/2026', cliente: { codigo: '77', nome: 'CLIENTE FICTICIO' },
    });
    assert.ok(!/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(JSON.stringify(r)), 'CPF vazou');
    assert.ok(p.chamadas[0].url.startsWith('https://apigw.pactosolucoes.com.br/contratos/4638'));
    assert.strictEqual(p.chamadas[0].opts.method, 'GET');
    assert.strictEqual(p.chamadas[0].opts.headers.Authorization, CRED);
    assert.strictEqual(p.chamadas[0].opts.headers.empresaId, '1');
    const vazio = await c.contrato(4639);
    assert.deepStrictEqual(vazio, { situacao: 'ok', dados: null });
    ok('contrato: lista branca (sem CPF), datas em São Paulo, número inexistente = dados null');
  }
  {
    const p = pacto([[/vendas\?inicio=25\/08&fim=25\/08$/, { body: { status: 'sucesso', produtos: [
      { produto: 'ÁGUA SEM GÁS', listaVendas: [{ dataHoraVenda: '25/08/2026 10:00', valor: 5, nome: 'CLIENTE A', codigoContrato: 0 }] },
      { produto: 'PLANO', listaVendas: [{ dataHoraVenda: '25/08/2026 11:00', valor: 199, nome: 'CLIENTE B', codigoContrato: 4636 }] }] } } ]]);
    const c = criarClienteGateway({ fetch: p.fetch, credencial: CRED, pausaMs: 0 });
    const r = await c.vendasDoDia('2026-08-25');
    assert.strictEqual(r.situacao, 'ok');
    assert.deepStrictEqual(r.dados, [
      { produto: 'ÁGUA SEM GÁS', valor: 5, cliente: 'CLIENTE A', contrato: '0', dia: '25/08/2026' },
      { produto: 'PLANO', valor: 199, cliente: 'CLIENTE B', contrato: '4636', dia: '25/08/2026' }]);
    const erro = pacto([[/vendas/, { status: 400, body: { status: 'erro', message: 'Não é possível consultar um intervalo maior que 7 dias.' } }]]);
    const c2 = criarClienteGateway({ fetch: erro.fetch, credencial: CRED, pausaMs: 0 });
    assert.strictEqual((await c2.vendasDoDia('2026-08-25')).situacao, 'falhou');
    ok('vendas do dia: janela de um dia em DD/MM, lista achatada por produto; erro da Pacto vira falhou');
  }
  {
    const pausas = [];
    const p = pacto([[/contratos/, k => (k === 1 ? { status: 429, body: {} } : { body: { content: {} } })]]);
    const c = criarClienteGateway({ fetch: p.fetch, credencial: CRED, pausaMs: 1250, dormir: async ms => pausas.push(ms) });
    const r = await c.contrato(1);
    assert.strictEqual(r.situacao, 'ok');
    assert.deepStrictEqual(pausas, [2500], 'limite: espera 2,5 s e tenta uma vez');
    await c.contrato(2);
    assert.deepStrictEqual(pausas, [2500, 1250], 'pausa entre chamadas');
    const sempre = pacto([[/contratos/, { status: 429, body: {} }]]);
    const c3 = criarClienteGateway({ fetch: sempre.fetch, credencial: CRED, pausaMs: 0 });
    assert.strictEqual((await c3.contrato(3)).situacao, 'limite');
    assert.strictEqual(sempre.chamadas.length, 2, 'tenta uma vez só');
    ok('limite por segundo: espera e tenta uma vez; pausa de 1,25 s entre chamadas');
  }
  {
    const p = pacto([[/contratos/, () => { throw new Error('ECONNRESET ' + CRED); }]]);
    const f = async (url, opts) => { p.chamadas.push(url); throw new Error('ECONNRESET ' + CRED); };
    const c = criarClienteGateway({ fetch: f, credencial: CRED, pausaMs: 0 });
    const r = await c.contrato(5);
    assert.strictEqual(r.situacao, 'falhou');
    assert.ok(!r.motivo.includes(CRED), 'credencial vazou no motivo');
    ok('erro de rede vira falhou, tenta uma vez de novo, credencial nunca no motivo');
  }
  console.log('\n✅ smoke-pacto-gateway-cliente: ' + n);
})().catch(e => { console.error(e); process.exit(1); });
