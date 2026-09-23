'use strict';
// Roda: node scripts/smoke-pacto-sombra-busca.js
//
// O cliente HTTP da Pacto e a busca diária do modo sombra, contra uma Pacto
// FALSA e um Firestore falso. Dados inventados — o repositório é público.

const assert = require('assert');
const path = require('path');

const fn = p => path.join(__dirname, '..', 'functions', p);
const { criarCliente, classificar, paraBR } = require(fn('pacto-api-cliente.js'));
const S = require(fn('pacto-sombra.js'));
const makeFakeDb = require('./_fake-firestore.js');

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);
const CRED = 'credencial-falsa-de-teste-123';

/** Pacto falsa: responde por padrão de URL; registra as chamadas */
function pactoFalsa(rotas) {
  const chamadas = [];
  const fetch = async (url, opts) => {
    chamadas.push({ url, opts });
    for (const [re, resp] of rotas) {
      if (re.test(url)) {
        const r = typeof resp === 'function' ? resp(url, chamadas.length) : resp;
        if (r instanceof Error) throw r;
        return { status: r.status || 200, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
      }
    }
    return { status: 404, text: async () => 'rota não prevista: ' + url };
  };
  return { fetch, chamadas };
}
const semPausa = { pausaMs: 0 };

const aluno = (codigo, nome) => ({ codigo, nome, cpf: '999.888.777-66', dataNascimento: '01/01/1990' });
function resumoCom(pagamentos, extra) {
  return { contratosLancados: [], pagamentos, vendaAvulsa: [], estornos: [], estornosContrato: [], ...(extra || {}) };
}
const pagamento = (codigo, alunoCod, contrato, valor) => ({
  codigo, data: '10/09/2026 08:00:00', responsavelLancamento: 'CONSULTORA TESTE UM',
  aluno: aluno(alunoCod, 'CLIENTE FICTICIO ' + alunoCod),
  formas: [{ formaPagamento: 'PIX', valor }],
  parcelasPagas: [{ codigo: codigo * 10, codigoContrato: contrato, descricao: 'PARCELA 1', valor }],
});
const contratoBruto = (codigo) => ({ codigo, situacaoContrato: 'Matrícula', nomePlano: 'HIIT/MAROMBINHA | ANUAL | LOCAL',
  codigoPlano: 1, vigenciaDe: '10/09/2026', vigenciaAteAjustada: '09/09/2027', numeroMeses: 12, cpf: '999.888.777-66' });

(async () => {
  /* ─── cliente ─── */
  {
    const p = pactoFalsa([[/resumoPeriodo/, { body: { pagamentos: [] } }]]);
    const c = criarCliente({ fetch: p.fetch, credencial: CRED, ...semPausa });
    const r = await c.resumoDoDia(S.PACTO_UNIDADES.PP, '2026-09-10');
    assert.strictEqual(r.situacao, 'ok');
    const { url, opts } = p.chamadas[0];
    assert.ok(url.startsWith('https://app.pactosolucoes.com.br/api/prest/importacao/' + S.PACTO_UNIDADES.PP + '/resumoPeriodo'), url);
    assert.ok(url.includes('inicio=10/09/2026&fim=10/09/2026'), url);
    assert.strictEqual(opts.method, 'POST');
    assert.strictEqual(opts.headers.Authorization, CRED);
    assert.strictEqual(opts.body, '{}');
    assert.strictEqual(paraBR('2026-01-02'), '02/01/2026');
    ok('resumo do dia: rota do núcleo com a chave da unidade, POST, credencial no header');
  }
  {
    assert.strictEqual(classificar(401, '').situacao, 'credencial_recusada');
    assert.strictEqual(classificar(403, '').situacao, 'credencial_recusada');
    assert.strictEqual(classificar(429, '').situacao, 'limite');
    assert.strictEqual(classificar(200, '<html>erro</html>').situacao, 'falhou');
    assert.strictEqual(classificar(500, 'boom').situacao, 'falhou');
    assert.strictEqual(classificar(404, 'x').situacao, 'falhou');
    assert.strictEqual(classificar(200, '{"a":1}').dados.a, 1);
    const eco = classificar(500, 'token ' + CRED + ' inválido', CRED);
    assert.ok(!eco.motivo.includes(CRED), 'credencial vazou no motivo');
    ok('classificação: 401/403 credencial, 429 limite, HTML/5xx/404 falhou, credencial nunca no motivo');
  }
  {
    const p = pactoFalsa([[/resumoPeriodo/, new Error('ECONNRESET ' + CRED)]]);
    const c = criarCliente({ fetch: p.fetch, credencial: CRED, ...semPausa });
    const r = await c.resumoDoDia(S.PACTO_UNIDADES.CP, '2026-09-10');
    assert.strictEqual(r.situacao, 'falhou');
    assert.ok(!r.motivo.includes(CRED));
    const pausas = [];
    const p2 = pactoFalsa([[/./, { body: {} }]]);
    const c2 = criarCliente({ fetch: p2.fetch, credencial: CRED, pausaMs: 2000, dormir: async ms => pausas.push(ms) });
    await c2.resumoDoDia('x', '2026-09-10'); await c2.resumoDoDia('x', '2026-09-11'); await c2.contratosDoCliente('x', 1);
    assert.deepStrictEqual(pausas, [2000, 2000], 'pausa antes de toda chamada, menos a primeira');
    assert.strictEqual(c2.chamadas, 3);
    ok('erro de rede vira falhou; pausa de 2 s entre chamadas, nunca em rajada');
  }

  /* ─── busca ─── */
  {
    const db = makeFakeDb();
    const p = pactoFalsa([
      [/resumoPeriodo/, { body: resumoCom([pagamento(1, 501, 7001, 239), pagamento(2, 501, 7002, 100), pagamento(3, 502, 7003, 50)],
        { contratosLancados: [{ codigo: 7001, consultor: 'CONSULTORA TESTE UM' }] }) }],
      [/consultarContratos\?cliente=501/, { body: { return: [contratoBruto(7001), contratoBruto(7002)] } }],
      [/consultarContratos\?cliente=502/, { body: { return: [contratoBruto(7003)] } }],
    ]);
    const c = criarCliente({ fetch: p.fetch, credencial: CRED, ...semPausa });
    const r = await S.buscarDia({ db, cliente: c, unidade: 'PP', dia: '2026-09-10', agora: () => 'AGORA' });
    assert.strictEqual(r.situacao, 'buscado');
    const doc = (await db.collection('pacto_sombra_dias').doc('PP_2026-09-10').get()).data();
    assert.strictEqual(doc.situacao, 'buscado');
    assert.strictEqual(doc.unidade, 'PP');
    assert.strictEqual(JSON.parse(doc.linhas).length, 3);
    assert.strictEqual(doc.totais.recebido, 389);
    const chamadasContrato = p.chamadas.filter(x => /consultarContratos/.test(x.url)).length;
    assert.strictEqual(chamadasContrato, 2, 'dois contratos do mesmo cliente = uma consulta');
    const c7001 = (await db.collection('pacto_contratos').doc('PP_7001').get()).data();
    assert.strictEqual(c7001.consultor, 'CONSULTORA TESTE UM');
    assert.strictEqual(c7001.nomePlano, 'HIIT/MAROMBINHA | ANUAL | LOCAL');
    ok('dia com pagamentos: grava "buscado", linhas, totais e o caderninho; uma consulta por cliente');

    // segundo dia com o mesmo contrato: caderninho, sem nova consulta
    const antes = p.chamadas.filter(x => /consultarContratos/.test(x.url)).length;
    await S.buscarDia({ db, cliente: c, unidade: 'PP', dia: '2026-09-11', agora: () => 'AGORA' });
    const depois = p.chamadas.filter(x => /consultarContratos/.test(x.url)).length;
    assert.strictEqual(depois, antes, 'o caderninho evitou consultar de novo');
    ok('contrato já no caderninho não é consultado de novo');

    // nenhum CPF gravado
    const tudo = JSON.stringify((await db.collection('pacto_sombra_dias').get()).docs.map(d => d.data())) +
                 JSON.stringify((await db.collection('pacto_contratos').get()).docs.map(d => d.data()));
    assert.ok(!tudo.includes('999.888.777-66'), 'CPF gravado');
    assert.ok(!tudo.includes('01/01/1990'), 'nascimento gravado');
    ok('nenhum CPF ou nascimento chega ao banco');
  }
  {
    const db = makeFakeDb();
    let fase = 1;
    const p = pactoFalsa([
      [/resumoPeriodo/, () => ({ body: fase === 1
        ? resumoCom([pagamento(1, 501, 0, 10), pagamento(2, 502, 0, 20)])
        : resumoCom([pagamento(3, 503, 0, 30)]) })],
    ]);
    const c = criarCliente({ fetch: p.fetch, credencial: CRED, ...semPausa });
    await S.buscarDia({ db, cliente: c, unidade: 'CP', dia: '2026-09-10' });
    fase = 2;
    await S.buscarDia({ db, cliente: c, unidade: 'CP', dia: '2026-09-10' });
    const doc = (await db.collection('pacto_sombra_dias').doc('CP_2026-09-10').get()).data();
    assert.strictEqual(JSON.parse(doc.linhas).length, 1, 'rebusca substitui, não soma');
    assert.strictEqual(doc.totais.recebido, 30);
    ok('rebuscar o mesmo dia substitui o documento inteiro');

    // rebusca que FALHA não pode deixar as linhas do sucesso anterior no documento
    const pFalha = pactoFalsa([[/resumoPeriodo/, { status: 500, body: 'fora do ar' }]]);
    const cFalha = criarCliente({ fetch: pFalha.fetch, credencial: CRED, ...semPausa });
    await S.buscarDia({ db, cliente: cFalha, unidade: 'CP', dia: '2026-09-10' });
    const falhou = (await db.collection('pacto_sombra_dias').doc('CP_2026-09-10').get()).data();
    assert.strictEqual(falhou.situacao, 'falhou');
    assert.strictEqual(falhou.linhas, undefined, 'dia que falhou ficou com linhas velhas');
    assert.strictEqual(falhou.totais, undefined, 'dia que falhou ficou com totais velhos');
    ok('rebusca que falha apaga as linhas e os totais do sucesso anterior');
  }
  {
    const db = makeFakeDb();
    const p = pactoFalsa([[/resumoPeriodo/, { body: resumoCom([]) }]]);
    const c = criarCliente({ fetch: p.fetch, credencial: CRED, ...semPausa });
    const r = await S.buscarDia({ db, cliente: c, unidade: 'CP', dia: '2026-09-10' });
    assert.strictEqual(r.situacao, 'vazio_conferir');
    assert.strictEqual((await db.collection('pacto_sombra_dias').doc('CP_2026-09-10').get()).data().situacao, 'vazio_conferir');
    ok('Pacto respondendo sem nenhum pagamento grava "vazio, conferir"');
  }
  for (const [status, situacao] of [[401, 'credencial_recusada'], [429, 'limite']]) {
    const db = makeFakeDb();
    const p = pactoFalsa([[/resumoPeriodo/, { status, body: 'x' }]]);
    const c = criarCliente({ fetch: p.fetch, credencial: CRED, ...semPausa });
    const r = await S.buscar({ db, cliente: c, dias: ['2026-09-09', '2026-09-10'] });
    assert.strictEqual(r.parouPor, situacao);
    assert.strictEqual(p.chamadas.length, 1, situacao + ' tem que parar na primeira chamada');
    assert.strictEqual(r.resultados.length, 1);
    assert.strictEqual((await db.collection('pacto_sombra_dias').doc('CP_2026-09-09').get()).data().situacao, situacao);
    ok(situacao + ' para a busca inteira na primeira chamada');
  }
  {
    const db = makeFakeDb();
    const p = pactoFalsa([[/resumoPeriodo/, (url, i) => (i === 1 ? { status: 500, body: 'fora do ar' } : { body: resumoCom([pagamento(1, 501, 0, 10)]) })]]);
    const c = criarCliente({ fetch: p.fetch, credencial: CRED, ...semPausa });
    const r = await S.buscar({ db, cliente: c, dias: ['2026-09-10'], unidades: ['CP', 'PP'] });
    assert.deepStrictEqual(r.resultados.map(x => x.situacao), ['falhou', 'buscado'], 'uma unidade falhar não derruba a outra');
    const falhou = (await db.collection('pacto_sombra_dias').doc('CP_2026-09-10').get()).data();
    assert.ok(/500/.test(falhou.motivo), 'o motivo fica gravado');
    ok('falha comum grava o motivo e segue para a próxima unidade');
  }
  {
    const db = makeFakeDb();
    const p = pactoFalsa([
      [/resumoPeriodo/, { body: resumoCom([pagamento(1, 501, 7001, 10)]) }],
      [/consultarContratos/, { status: 429, body: '' }],
    ]);
    const c = criarCliente({ fetch: p.fetch, credencial: CRED, ...semPausa });
    const r = await S.buscar({ db, cliente: c, dias: ['2026-09-10'], unidades: ['PP', 'CP'] });
    assert.strictEqual(r.parouPor, 'limite');
    assert.strictEqual(r.resultados.length, 1, 'limite na consulta de contrato também para tudo');
    ok('limite na consulta de contrato também para a busca');
  }
  {
    assert.deepStrictEqual(S.diasParaBuscar({ hoje: '2026-09-13', ultimos: 3 }), ['2026-09-10', '2026-09-11', '2026-09-12']);
    const intervalo = S.diasParaBuscar({ hoje: '2026-09-13', de: '2026-09-01', ate: '2026-09-20' });
    assert.strictEqual(intervalo[0], '2026-09-01');
    assert.strictEqual(intervalo[intervalo.length - 1], '2026-09-12', 'nunca hoje nem futuro');
    assert.deepStrictEqual(S.diasParaBuscar({ hoje: '2026-03-01', de: '2026-02-27' }), ['2026-02-27', '2026-02-28']);
    assert.throws(() => S.diasParaBuscar({ hoje: '2026-09-13', de: '2026-06-01' }), /no máximo/);
    assert.throws(() => S.diasParaBuscar({ hoje: '13/09/2026', ultimos: 3 }), /inválido/);
    ok('dias a buscar: os últimos 3, intervalo cortado em ontem, máximo de 62');
  }
  {
    // A Pacto lança a cobrança recorrente DIAS depois, com a data antiga: em set/2026
    // o CP perdeu 17 pagamentos (R$ 4.284,00) relendo só os 3 dias anteriores.
    // A rotina relê o mês inteiro; até o dia 10, o mês anterior junto (a virada).
    const r22 = S.diasDaRotina('2026-09-22');
    assert.strictEqual(r22[0], '2026-09-01');
    assert.strictEqual(r22[r22.length - 1], '2026-09-21', 'nunca hoje');
    assert.strictEqual(r22.length, 21);
    const r10 = S.diasDaRotina('2026-09-10');
    assert.strictEqual(r10[0], '2026-08-01', 'até o dia 10 relê o mês anterior');
    assert.strictEqual(r10[r10.length - 1], '2026-09-09');
    assert.strictEqual(S.diasDaRotina('2026-09-11')[0], '2026-09-01', 'do dia 11 em diante, só o mês');
    const r1 = S.diasDaRotina('2026-10-01');
    assert.strictEqual(r1[0], '2026-09-01'); assert.strictEqual(r1[r1.length - 1], '2026-09-30');
    const jan = S.diasDaRotina('2027-01-05');
    assert.strictEqual(jan[0], '2026-12-01', 'vira o ano');
    // o pior caso cabe no limite de dias por vez
    assert.strictEqual(S.diasDaRotina('2026-08-10').length, 31 + 9);
    assert.throws(() => S.diasDaRotina('22/09/2026'), /inválido/);
    ok('rotina diária: relê o mês inteiro, e o anterior até o dia 10');

    // e é ela que a função agendada usa
    const idx = require('fs').readFileSync(fn('index.js'), 'utf8');
    const agendada = idx.slice(idx.indexOf('exports.buscarPactoSombra ='), idx.indexOf('exports.buscarPactoSombraManual'));
    assert.ok(/diasDaRotina\(hojeSaoPaulo\(\)\)/.test(agendada), 'a agendada chama diasDaRotina');
    assert.ok(!/ultimos:/.test(agendada), 'a agendada não usa mais a janela de N dias');
    ok('a busca das 4h usa a rotina do mês');
  }

  console.log('\n✅ smoke-pacto-sombra-busca: ' + n + '/16');
})().catch(e => { console.error(e); process.exit(1); });
