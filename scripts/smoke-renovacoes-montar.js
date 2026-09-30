'use strict';
// Roda: node scripts/smoke-renovacoes-montar.js
// A montagem da lista com banco FALSO e Pacto FALSA. Dados INVENTADOS.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = require(path.join(__dirname, '..', 'functions', 'renovacoes-montar.js'));
const makeFakeDb = require('./_fake-firestore.js');

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

const K = (codigoContrato, codigoCliente, nomeCliente) => ({ codigoContrato, codigoCliente, matriculaCliente: '50' + codigoCliente, nomeCliente });
function gwFalso(porInicio) {
  const g = { chamadas: 0, async previsao(de) { g.chamadas++; const r = porInicio[de]; return typeof r === 'function' ? r() : r; } };
  return g;
}
const OK = (contratos, renovados) => ({ situacao: 'ok', dados: { contratos, renovados: renovados || [] } });
function nucleoFalso(porCliente) {
  const nf = { consultas: 0, async contratosDoCliente(chave, cliente) { nf.consultas++; return porCliente[cliente] || { situacao: 'ok', dados: [] }; } };
  return nf;
}
const BRUTO = (codigo, nomePlano, vigenciaDe, vigenciaAteAjustada) => ({ codigo, nomePlano, vigenciaDe, vigenciaAteAjustada, situacaoContrato: 'Renovação' });

async function bancoComHistorico() {
  const db = makeFakeDb();
  await db.collection('units').doc('unit-cp').set({ config: {} });
  await db.collection('periodos').doc('unit-cp_2025-04').set({ unitId: 'unit-cp' });
  await db.collection('periodos').doc('unit-cp_2025-04').collection('itens').doc('i1').set({ type: 'processed',
    cliente: 'EDU IMPORTADO', item: 'SEMESTRAL, TREINO LIVRE (01/04/2025 - 30/09/2025)', data: '10/04/2025', vendedor: 'BARBARA', codigo: 'C500', isContract: true });
  await db.collection('periodos').doc('unit-cp_2026-10').set({ unitId: 'unit-cp', metasMensais: { meta: 55, superMeta: 63, metaGold: 72, minNovos: 19, minRenov: 16, minVoucher: 5 } });
  await db.collection('renovacoes_acompanhamento').doc('CP_106').set({ unidade: 'CP', codigoContrato: '106', consultoraAtribuida: 'FRANCINI', renovou: 'negociacao', dataContato: '2026-10-02' });
  return db;
}

const PACTO_OUT = {
  '2026-10-01': OK([K('101', '11', 'ANA ANUAL'), K('102', '12', 'BETO RECORRENTE'), K('105', '15', 'EDU IMPORTADO'), K('106', '16', 'FABI SEMDADOS')], ['101']),
  '2026-11-01': OK([K('201', '21', 'IVO ANTECIPA')]),
};
const NUCLEO = {
  11: { situacao: 'ok', dados: [BRUTO(101, 'ANUAL, ACESSO ILIMITADO', '01/10/2025', '20/10/2026')] },
  12: { situacao: 'ok', dados: [BRUTO(102, 'ACESSO LIVRE | RECORRENTE | FLEX', '15/09/2026', '15/10/2026')] },
  15: { situacao: 'ok', dados: [BRUTO(105, 'IMPORTAÇÃO', '01/10/2025', '05/10/2026')] },
  21: { situacao: 'ok', dados: [BRUTO(201, 'SEMESTRAL, TREINO LIVRE', '10/05/2026', '10/11/2026')] },
};

(async () => {
  /* 1. monta e grava a lista do mês */
  const db = await bancoComHistorico();
  const nucleo = nucleoFalso(NUCLEO);
  const r = await M.montarUnidadeMes({ db, clienteGw: gwFalso(PACTO_OUT), clienteNucleo: nucleo, unidade: 'CP', mes: '2026-10', hoje: '2026-10-05', agora: () => 'AGORA' });
  const doc = (await db.collection('renovacoes_lista').doc('CP_2026-10').get()).data();
  {
    assert.strictEqual(r.situacao, 'ok');
    assert.strictEqual(doc.situacao, 'ok'); assert.strictEqual(doc.unidade, 'CP'); assert.strictEqual(doc.mes, '2026-10');
    assert.deepStrictEqual(doc.blocos.renovacoes.map(l => l.codigoContrato), ['105', '101']);
    assert.deepStrictEqual(doc.blocos.antecipacao.map(l => l.codigoContrato), ['201']);
    assert.deepStrictEqual(doc.blocos.verificar.map(l => l.codigoContrato), ['106'], 'o núcleo não devolveu o 106');
    assert.deepStrictEqual(doc.excluidos, { recorrente: 1 });
    assert.strictEqual(doc.conferencia.bate, true);
    assert.strictEqual(doc.blocos.renovacoes[0].planoOriginal, 'SEMESTRAL, TREINO LIVRE', 'plano original pelo histórico do período');
    assert.strictEqual(doc.blocos.verificar[0].consultora, 'FRANCINI', 'consultora atribuída pela gestão');
    assert.deepStrictEqual(doc.metas, { meta: 55, superMeta: 63, metaGold: 72, minNovos: 19, minRenov: 16, minVoucher: 5 });
    assert.strictEqual(doc.atualizadoEm, 'AGORA');
    assert.strictEqual(nucleo.consultas, 5, 'uma consulta por cliente sem contrato no caderninho');
    ok('busca os dois períodos, completa pelo núcleo, lê histórico, gestão e metas, e grava a lista');
  }

  /* 2. o caderninho evita perguntar de novo, e a lista não mexe no acompanhamento */
  {
    const nucleo2 = nucleoFalso(NUCLEO);
    await M.montarUnidadeMes({ db, clienteGw: gwFalso(PACTO_OUT), clienteNucleo: nucleo2, unidade: 'CP', mes: '2026-10', hoje: '2026-10-06', agora: () => 'DEPOIS' });
    assert.strictEqual(nucleo2.consultas, 1, 'só o 106, que o núcleo nunca devolveu');
    assert.ok((await db.collection('pacto_contratos').doc('CP_101').get()).exists, 'grava no caderninho');
    const acomp = (await db.collection('renovacoes_acompanhamento').doc('CP_106').get()).data();
    assert.deepStrictEqual(acomp, { unidade: 'CP', codigoContrato: '106', consultoraAtribuida: 'FRANCINI', renovou: 'negociacao', dataContato: '2026-10-02' });
    const d2 = (await db.collection('renovacoes_lista').doc('CP_2026-10').get()).data();
    assert.strictEqual(d2.blocos.verificar[0].desde, '2026-10-05', 'o "desde" vem da lista anterior');
    ok('caderninho reaproveitado; o acompanhamento da consultora não é tocado; o "desde" atravessa os dias');
  }

  /* 3. falha não apaga a lista boa; vazio com sucesso também não */
  {
    await M.montarUnidadeMes({ db, clienteGw: gwFalso({ '2026-10-01': { situacao: 'falhou', motivo: 'HTTP 500' } }), clienteNucleo: nucleoFalso({}), unidade: 'CP', mes: '2026-10', hoje: '2026-10-07', agora: () => 'FALHA' });
    let d = (await db.collection('renovacoes_lista').doc('CP_2026-10').get()).data();
    assert.strictEqual(d.situacao, 'ok'); assert.strictEqual(d.blocos.renovacoes.length, 2);
    assert.deepStrictEqual(d.ultimaFalha, { situacao: 'falhou', motivo: 'HTTP 500', em: 'FALHA' });

    const r4 = await M.montarUnidadeMes({ db, clienteGw: gwFalso({ '2026-10-01': OK([]), '2026-11-01': OK([]) }), clienteNucleo: nucleoFalso({}), unidade: 'CP', mes: '2026-10', hoje: '2026-10-08', agora: () => 'VAZIO' });
    assert.strictEqual(r4.situacao, 'vazio_suspeito');
    d = (await db.collection('renovacoes_lista').doc('CP_2026-10').get()).data();
    assert.strictEqual(d.blocos.renovacoes.length, 2, 'a lista de ontem continua');
    assert.strictEqual(d.ultimaFalha.situacao, 'vazio_suspeito');

    const db2 = makeFakeDb();
    await M.montarUnidadeMes({ db: db2, clienteGw: gwFalso({ '2026-10-01': { situacao: 'credencial_recusada', motivo: 'HTTP 401' } }), clienteNucleo: nucleoFalso({}), unidade: 'PP', mes: '2026-10', hoje: '2026-10-05', agora: () => 'X' });
    const d3 = (await db2.collection('renovacoes_lista').doc('PP_2026-10').get()).data();
    assert.deepStrictEqual(d3, { unidade: 'PP', mes: '2026-10', situacao: 'credencial_recusada', motivo: 'HTTP 401', atualizadoEm: 'X' });
    ok('falha guarda ultimaFalha e mantém a lista; resposta vazia quando ontem havia é suspeita; sem lista anterior, grava a falha');
  }

  /* 4. montarTudo: meses mantidos por unidade; credencial recusada para só aquela unidade */
  {
    const db3 = await bancoComHistorico();
    const gwCP = gwFalso({ '2026-10-01': OK([]), '2026-11-01': OK([]), '2026-12-01': OK([]) });
    const gwPP = gwFalso({ '2026-10-01': { situacao: 'credencial_recusada', motivo: 'HTTP 401' } });
    const res = await M.montarTudo({ db: db3, clientesGw: { CP: gwCP, PP: gwPP }, clienteNucleo: nucleoFalso({}), hoje: '2026-10-26', agora: () => 'T' });
    assert.deepStrictEqual(res.map(x => x.id + ' ' + x.situacao), ['CP_2026-10 ok', 'CP_2026-11 ok', 'PP_2026-10 credencial_recusada']);
    assert.strictEqual(gwPP.chamadas, 1, 'não insiste com credencial recusada');
    ok('do dia 25 em diante mantém o mês seguinte; credencial recusada para só a unidade dela');
  }

  console.log('\n✅ smoke-renovacoes-montar: ' + n);
})().catch(e => { console.error(e); process.exit(1); });
