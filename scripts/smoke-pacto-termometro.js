'use strict';
// Roda: node scripts/smoke-pacto-termometro.js
//
// Termômetro do mês (desenho: docs/superpowers/specs/2026-09-22-termometro-do-mes-design.md).
// A conta é a do upload oficial — adapter + motor REAIS, com o regime de caixa —
// e o documento gravado só tem totais da unidade. Dados INVENTADOS.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const T = require(path.join(raiz, 'pacto-termometro.js'));
const PA = require(path.join(raiz, 'pacto-adapter.js'));
const CE = require(path.join(raiz, 'commission.js'));
const L = require(path.join(raiz, 'pacto-api-linhas.js'));
const S = require(path.join(raiz, 'functions', 'pacto-sombra.js'));
const makeFakeDb = require('./_fake-firestore.js');

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

const ANUAL = 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO.';
const RECORRENTE = 'HIIT/MAROMBINHA | RECORRENTE | 3X | PADRÃO.';
function linha(o) {
  const r = new Array(L.TAMANHO_LINHA).fill('');
  const d = { matricula: '1', nome: 'CLIENTE FICTICIO', produto: '', contrato: '0', lancamento: '05/09/2026',
    valor: '10,00', forma: 'PIX', empresa: L.EMPRESA.PP, consultor: 'CONSULTORA TESTE UM',
    resp1: 'CONSULTORA TESTE UM', resp2: 'CONSULTORA TESTE UM', ...o };
  Object.keys(PA.COL).forEach(k => { if (d[k] !== undefined) r[PA.COL[k]] = d[k]; });
  return r;
}
const contrato = (nome, num, dia, valor, plano, situacao, extra) => linha({ nome, contrato: String(num), produto: plano, plano,
  situacao, inicio: dia, termino: '31/08/2027', duracao: plano === ANUAL ? '12' : '1', lancamento: dia, valor, ...(extra || {}) });
const doc = (dia, linhas, situacao) => ({ unidade: 'PP', dia, situacao: situacao || 'buscado', linhas: JSON.stringify(linhas) });

const base = { mes: '2026-09', unidade: 'PP', hoje: '2026-09-22', Adapter: PA, Engine: CE, ApiLinhas: L };

/* 1. dias esperados: do dia 1º até ontem, nunca hoje */
{
  const d = T.diasEsperados('2026-09', '2026-09-22');
  assert.strictEqual(d[0], '2026-09-01'); assert.strictEqual(d[d.length - 1], '2026-09-21'); assert.strictEqual(d.length, 21);
  assert.strictEqual(T.diasEsperados('2026-08', '2026-09-22').length, 31, 'mês passado inteiro');
  assert.deepStrictEqual(T.diasEsperados('2026-09', '2026-09-01'), [], 'no dia 1º ainda não há dia do mês');
  assert.deepStrictEqual(T.diasEsperados('2026-10', '2026-09-22'), [], 'mês futuro');
  ok('dias esperados: do dia 1º até ontem; mês passado inteiro; nada no dia 1º nem no futuro');
}

/* 2. a conta: ativações do motor, dinheiro de todas as linhas */
const docs = [
  doc('2026-09-02', [
    contrato('CLIENTE NOVO', 7001, '02/09/2026', '239,00', ANUAL, 'Matrícula'),
    linha({ nome: 'CLIENTE AGUA', produto: 'ÁGUA SEM GÁS', valor: '5,00', lancamento: '02/09/2026' }),
  ]),
  doc('2026-09-03', [
    contrato('CLIENTE RENOVA', 7002, '03/09/2026', '199,00', RECORRENTE, 'Renovação'),
    // parcela seguinte de contrato que já pagou comissão em agosto: dinheiro sim, ativação não
    contrato('CLIENTE ANTIGO', 6500, '03/09/2026', '199,00', RECORRENTE, 'Renovação'),
  ]),
  // a API tem uma linha por PARCELA: duas do mesmo contrato no mês = uma ativação
  doc('2026-09-04', [contrato('CLIENTE NOVO', 7001, '04/09/2026', '239,00', ANUAL, 'Matrícula')]),
  doc('2026-09-05', [], 'falhou'),
  doc('2026-09-06', [], 'vazio_conferir'),
  // dia de outro mês não entra
  { unidade: 'PP', dia: '2026-08-31', situacao: 'buscado', linhas: JSON.stringify([contrato('CLIENTE AGOSTO', 6999, '31/08/2026', '100,00', ANUAL, 'Matrícula')]) },
];
const r = T.calcularMes({ ...base, hoje: '2026-09-08', docs, codigosPagos: ['C6500'], config: { meta: 2, superMeta: 3, metaGold: 4, minNovos: 1, minRenov: 1, minVoucher: 1 }, metaDoMes: true });
{
  assert.strictEqual(r.recebido, 881, 'dinheiro = todas as linhas do mês, parcela seguinte incluída: ' + r.recebido);
  assert.strictEqual(r.ativacoes.total, 2, JSON.stringify(r.ativacoes));
  assert.strictEqual(r.ativacoes.novo, 1);
  assert.strictEqual(r.ativacoes.renovacao, 1);
  assert.strictEqual(r.ativacoes.novosRetorno, 1);
  assert.strictEqual(r.jaPagos, 1, 'o contrato que já pagou comissão fica de fora da contagem');
  ok('ativações pelo adapter e motor reais: parcela dupla conta uma, contrato já comissionado não conta, água não é ativação');
}

/* 3. faixas e travas vêm da configuração e do calcP3 do motor */
{
  assert.deepStrictEqual(r.faixas, { meta: 2, superMeta: 3, metaGold: 4, minNovos: 1, minRenov: 1, minVoucher: 1,
    multFalhaRenov: CE.defaultConfig.multFalhaRenov, multFalhaVoucher: CE.defaultConfig.multFalhaVoucher });
  assert.strictEqual(r.faixaAtual, 'meta');
  assert.deepStrictEqual(r.faltaPara, { meta: 0, superMeta: 1, metaGold: 2 });
  assert.strictEqual(r.metaDoMes, true);
  const semMeta = T.calcularMes({ ...base, docs, codigosPagos: ['C6500'], config: {}, metaDoMes: false });
  assert.strictEqual(semMeta.faixas.meta, CE.defaultConfig.meta, 'sem config, o padrão do motor');
  assert.strictEqual(semMeta.faixaAtual, null);
  assert.strictEqual(semMeta.faltaPara.meta, CE.defaultConfig.meta - 2);
  assert.strictEqual(semMeta.metaDoMes, false);
  ok('faixas e travas pela configuração; faixa atual pelo calcP3; sem meta do mês, o padrão');
}

/* 4. os dias: até onde há dado e o que faltou */
{
  assert.strictEqual(r.dias.esperados, 7);
  assert.strictEqual(r.dias.ateDia, '2026-09-06', 'último dia com resposta da Pacto');
  const prob = Object.fromEntries(r.dias.problemas.map(p => [p.dia, p.situacao]));
  assert.strictEqual(prob['2026-09-05'], 'falhou');
  assert.strictEqual(prob['2026-09-06'], 'vazio_conferir');
  assert.strictEqual(prob['2026-09-01'], 'nao_buscado', 'dia sem documento aparece, nunca vira zero calado');
  assert.strictEqual(prob['2026-09-07'], 'nao_buscado');
  assert.ok(!prob['2026-09-02'], 'dia bom não é problema');
  ok('dias: último com dado, falha, vazio e não buscado listados');
}

/* 5. nenhum nome no resultado — ele vai para quem não é admin */
{
  const txt = JSON.stringify(r);
  ['CLIENTE', 'CONSULTORA', 'FICTICIO'].forEach(p => assert.ok(!txt.includes(p), 'vazou "' + p + '": ' + txt));
  ok('o resultado só tem totais: nenhum nome de cliente ou de vendedora');
}

/* 6. as cópias de functions/ são idênticas às da raiz */
{
  ['pacto-termometro.js', 'pacto-adapter.js', 'commission.js', 'pacto-api-linhas.js'].forEach(f =>
    assert.strictEqual(fs.readFileSync(path.join(raiz, 'functions', f), 'utf8'), fs.readFileSync(path.join(raiz, f), 'utf8'),
      f + ': as duas cópias divergiram — o deploy de Functions só leva functions/'));
  ok('pacto-termometro, pacto-adapter, commission e pacto-api-linhas: cópia de functions/ idêntica à da raiz');
}

/* 7. o servidor monta o documento com a config e os contratos pagos do banco */
(async () => {
  const db = makeFakeDb();
  await db.collection('units').doc('unit-pp').set({ name: 'Pequeno Príncipe', config: { meta: 40, superMeta: 45, metaGold: 50 } });
  await db.collection('units').doc('unit-cp').set({ name: 'Campeche', config: {} });
  await db.collection('periodos').doc('unit-pp_2026-08').set({ unitId: 'unit-pp', codigosPagos: ['C6500'] });
  // período do PRÓPRIO mês: dá a meta do mês, mas seus códigos não barram as próprias linhas
  await db.collection('periodos').doc('unit-pp_2026-09').set({ unitId: 'unit-pp', codigosPagos: ['C7001'], metasMensais: { meta: 2 } });
  for (const d of docs) await db.collection('pacto_sombra_dias').doc('PP_' + d.dia).set(d);

  const feitos = await S.atualizarTermometro({ db, unidades: ['PP', 'CP'], meses: ['2026-09'], hoje: '2026-09-08', agora: () => 'AGORA' });
  assert.deepStrictEqual(feitos.map(f => f.id).sort(), ['CP_2026-09', 'PP_2026-09']);
  const t = (await db.collection('pacto_termometro').doc('PP_2026-09').get()).data();
  assert.strictEqual(t.ativacoes.total, 2, '7001 conta (é do mês), 6500 não (agosto): ' + JSON.stringify(t.ativacoes));
  assert.strictEqual(t.faixas.meta, 2, 'meta do mês por cima da unidade');
  assert.strictEqual(t.faixas.superMeta, 45, 'o resto vem da unidade');
  assert.strictEqual(t.metaDoMes, true);
  assert.strictEqual(t.unitId, 'unit-pp');
  assert.strictEqual(t.atualizadoEm, 'AGORA');
  const cp = (await db.collection('pacto_termometro').doc('CP_2026-09').get()).data();
  assert.strictEqual(cp.ativacoes.total, 0, 'unidade sem dia buscado: zero ativação, mas com os dias listados');
  assert.strictEqual(cp.dias.problemas.length, 7);
  assert.strictEqual(cp.metaDoMes, false);
  assert.ok(!JSON.stringify(t).includes('CLIENTE'), 'nome de cliente no documento');
  ok('o servidor lê a config da unidade, a meta do mês e os contratos pagos antes do mês, e grava só totais');

  // o id da unidade em produção é `cp`/`pp`, não `unit-cp`
  const db2 = makeFakeDb();
  await db2.collection('units').doc('pp').set({ config: { meta: 33 } });
  await S.atualizarTermometro({ db: db2, unidades: ['PP'], meses: ['2026-09'], hoje: '2026-09-08', agora: () => 'AGORA' });
  const t2 = (await db2.collection('pacto_termometro').doc('PP_2026-09').get()).data();
  assert.strictEqual(t2.unitId, 'pp'); assert.strictEqual(t2.faixas.meta, 33);
  ok('acha a unidade pelo id de produção (`pp`) e pelo de staging (`unit-pp`)');

  // e é chamado depois das duas buscas
  const idx = fs.readFileSync(path.join(raiz, 'functions', 'index.js'), 'utf8');
  const rodar = idx.slice(idx.indexOf('async function rodarSombra'), idx.indexOf('exports.buscarPactoSombra ='));
  assert.ok(/atualizarTermometro\(/.test(rodar), 'rodarSombra atualiza o termômetro');
  ok('as duas buscas (4h e botão) atualizam o termômetro');

  console.log('\n✅ smoke-pacto-termometro: ' + n + '/9');
})().catch(e => { console.error(e); process.exit(1); });
