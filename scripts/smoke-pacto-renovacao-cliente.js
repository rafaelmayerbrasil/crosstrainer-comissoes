'use strict';
// Roda: node scripts/smoke-pacto-renovacao-cliente.js
// Cliente da Previsão de Renovação (gateway da Pacto, credencial por unidade) com fetch FALSO.

const assert = require('assert');
const path = require('path');
const R = require(path.join(__dirname, '..', 'functions', 'pacto-renovacao-cliente.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);
const CRED = 'CREDENCIAL-FALSA-123';

function fetchFalso(respostas) {
  const chamadas = [];
  const f = async (url, opt) => {
    chamadas.push({ url, opt });
    const r = respostas.shift();
    return { status: r.status, text: async () => r.texto };
  };
  f.chamadas = chamadas;
  return f;
}
const resposta = obj => ({ status: 200, texto: JSON.stringify({ content: { jsonDados: JSON.stringify(obj) } }) });

(async () => {
  /* 1. o intervalo em milissegundos é o dia inteiro em São Paulo */
  {
    assert.deepStrictEqual(R.intervaloMs('2026-10-01', '2026-10-31'),
      { dataInicial: Date.UTC(2026, 9, 1, 3, 0, 0), dataFinal: Date.UTC(2026, 10, 1, 2, 59, 59) });
    ok('intervalo: 00:00 do primeiro dia a 23:59:59 do último, em São Paulo');
  }

  /* 2. a chamada: rota, cabeçalhos e corpo */
  {
    const f = fetchFalso([resposta({ contratosPrevisaoMes: [
      { codigoContrato: 101, codigoCliente: 11, matriculaCliente: '5011', nomeCliente: 'ANA', situacaoCliente: 'AT' },
      { codigoContrato: null, nomeCliente: 'SEM CONTRATO' },
    ], contratosRenovadosPrevisaoMes: [{ codigoContrato: 101 }] })]);
    const c = R.criarClienteRenovacao({ fetch: f, credencial: CRED });
    const r = await c.previsao('2026-10-01', '2026-10-31');
    assert.strictEqual(r.situacao, 'ok');
    assert.deepStrictEqual(r.dados, { contratos: [{ codigoContrato: '101', codigoCliente: '11', matriculaCliente: '5011', nomeCliente: 'ANA' }], renovados: ['101'] });
    const { url, opt } = f.chamadas[0];
    assert.strictEqual(url, 'https://apigw.pactosolucoes.com.br/v2-indice-renovacao');
    assert.strictEqual(opt.method, 'POST');
    assert.strictEqual(opt.headers.Authorization, CRED);
    assert.strictEqual(opt.headers.empresaId, '1');
    assert.deepStrictEqual(JSON.parse(opt.body), { empresa: 1, dataInicial: Date.UTC(2026, 9, 1, 3), dataFinal: Date.UTC(2026, 10, 1, 2, 59, 59),
      retornarContratos: true, desconsiderarContratosRenovaveis: false, considerarMudancaDePlano: false });
    assert.strictEqual(c.chamadas, 1);
    ok('rota v2-indice-renovacao, credencial crua + empresaId 1, corpo com o período; só os 4 campos do contrato');
  }

  /* 3. falhas */
  {
    let c = R.criarClienteRenovacao({ fetch: fetchFalso([{ status: 401, texto: 'nao' }]), credencial: CRED });
    assert.strictEqual((await c.previsao('2026-10-01', '2026-10-31')).situacao, 'credencial_recusada');

    const f = fetchFalso([{ status: 500, texto: 'erro ' + CRED }, resposta({ contratosPrevisaoMes: [] })]);
    c = R.criarClienteRenovacao({ fetch: f, credencial: CRED });
    const r = await c.previsao('2026-10-01', '2026-10-31');
    assert.strictEqual(r.situacao, 'ok', 'falha passageira: tenta de novo uma vez');
    assert.strictEqual(c.chamadas, 2);

    c = R.criarClienteRenovacao({ fetch: fetchFalso([{ status: 500, texto: 'erro ' + CRED }, { status: 500, texto: 'erro ' + CRED }]), credencial: CRED });
    const r2 = await c.previsao('2026-10-01', '2026-10-31');
    assert.strictEqual(r2.situacao, 'falhou');
    assert.ok(!r2.motivo.includes(CRED), 'a credencial nunca vai para o motivo');

    c = R.criarClienteRenovacao({ fetch: fetchFalso([{ status: 200, texto: JSON.stringify({ erro: 'x' }) }, { status: 200, texto: JSON.stringify({ erro: 'x' }) }]), credencial: CRED });
    assert.strictEqual((await c.previsao('2026-10-01', '2026-10-31')).situacao, 'falhou', '{erro} com HTTP 200 é falha');

    c = R.criarClienteRenovacao({ fetch: fetchFalso([resposta({ outraCoisa: 1 })]), credencial: CRED });
    const r3 = await c.previsao('2026-10-01', '2026-10-31');
    assert.strictEqual(r3.situacao, 'falhou');
    assert.strictEqual(r3.motivo, 'resposta sem a lista de contratos da previsão');
    ok('401 recusa, falha passageira tenta de novo, erro no corpo e resposta sem a lista viram falha, credencial fora do motivo');
  }

  /* 4. a Pacto aceita 1 consulta por segundo nesta rota (HTTP 429 em 29/09/2026):
        espera entre as chamadas e, se mesmo assim recusar por limite, tenta de novo UMA vez */
  {
    const esperas = [];
    const dormir = async ms => { esperas.push(ms); };
    let f = fetchFalso([resposta({ contratosPrevisaoMes: [] }), resposta({ contratosPrevisaoMes: [] })]);
    let c = R.criarClienteRenovacao({ fetch: f, credencial: CRED, dormir });
    await c.previsao('2026-10-01', '2026-10-31');
    assert.deepStrictEqual(esperas, [], 'a primeira chamada não espera');
    await c.previsao('2026-11-01', '2026-11-15');
    assert.ok(esperas.length === 1 && esperas[0] >= 1100, 'a segunda espera mais de 1 segundo: ' + esperas);

    esperas.length = 0;
    const limite = { status: 429, texto: 'Rate limit excedido. Maximo 1 requisicao(oes) por 1 segundo(s)' };
    f = fetchFalso([limite, resposta({ contratosPrevisaoMes: [] })]);
    c = R.criarClienteRenovacao({ fetch: f, credencial: CRED, dormir });
    assert.strictEqual((await c.previsao('2026-10-01', '2026-10-31')).situacao, 'ok', 'limite passageiro: tenta de novo');
    assert.strictEqual(c.chamadas, 2);
    assert.ok(esperas.length === 1 && esperas[0] >= 2000, 'espera antes de tentar de novo: ' + esperas);

    f = fetchFalso([limite, limite]);
    c = R.criarClienteRenovacao({ fetch: f, credencial: CRED, dormir });
    assert.strictEqual((await c.previsao('2026-10-01', '2026-10-31')).situacao, 'limite', 'duas recusas: para');
    assert.strictEqual(c.chamadas, 2, 'não insiste mais de uma vez');
    ok('1 consulta por segundo: espera entre as chamadas; limite tenta de novo uma vez e depois para');
  }

  console.log('\n✅ smoke-pacto-renovacao-cliente: ' + n);
})().catch(e => { console.error(e); process.exit(1); });
