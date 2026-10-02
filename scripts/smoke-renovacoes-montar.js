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

  /* 5. as Functions: 5h e botão só do admin, com as credenciais das unidades */
  {
    const idx = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
    const ini = idx.indexOf('// LISTA DE RENOVAÇÕES');
    assert.ok(ini > 0, 'bloco da lista de renovações no index.js');
    const bloco = idx.slice(ini);
    // declaradas uma vez só, no bloco do modo sombra (30/09/2026: a busca das 4h também usa)
    assert.strictEqual((idx.match(/defineSecret\('PACTO_API_KEY_CP'\)/g) || []).length, 1);
    assert.strictEqual((idx.match(/defineSecret\('PACTO_API_KEY_PP'\)/g) || []).length, 1);
    assert.ok(idx.indexOf("defineSecret('PACTO_API_KEY_CP')") < idx.indexOf('exports.buscarPactoSombra ='), 'antes das opções que as leem');
    ['exports.buscarPactoSombra =', 'exports.buscarPactoSombraManual =', 'exports.montarListaRenovacoes =', 'exports.montarListaRenovacoesManual ='].forEach(f => {
      const trecho = idx.slice(idx.indexOf(f), idx.indexOf(f) + 400);
      assert.ok(/secrets: \[PACTO_API_KEY, PACTO_API_KEY_CP, PACTO_API_KEY_PP\]/.test(trecho), f + ' sem as credenciais das unidades');
    });
    assert.ok(/criarClienteGateway\(\{ fetch, credencial: PACTO_API_KEY_CP\.value\(\) \}\)/.test(idx), 'a busca usa o gateway do CP');
    assert.ok(/exports\.montarListaRenovacoes\s*=\s*onSchedule\(\{[\s\S]*?schedule:\s*'0 5 \* \* \*'[\s\S]*?timeZone:\s*'America\/Sao_Paulo'/.test(bloco));
    assert.ok(/exports\.montarListaRenovacoesManual\s*=\s*onCall\(/.test(bloco));
    assert.ok(/callerProfiles\.includes\('admin'\)/.test(bloco.slice(bloco.indexOf('exports.montarListaRenovacoesManual'))), 'botão só do admin');
    assert.ok(/renovacoesMontar\.montarTudo\(/.test(bloco));
    ok('Functions: todo dia às 5h (São Paulo) e botão só do admin, com as credenciais das unidades no cofre');
  }

  /* 6. completar pelo núcleo NÃO apaga a consultora que o gateway trouxe (30/09/2026) */
  {
    const db = makeFakeDb();
    await db.collection('pacto_contratos').doc('CP_100').set({ codigo: '100', unidade: 'CP', nomePlano: 'ANUAL ANTIGO',
      consultor: 'CONSULTORA CP', lancou: 'CONSULTORA CP', gw: true });
    const nucleo6 = nucleoFalso({ 11: { situacao: 'ok', dados: [BRUTO(100, 'ANUAL ANTIGO', '01/10/2024', '30/09/2025'), BRUTO(101, 'ANUAL, ACESSO ILIMITADO', '01/10/2025', '20/10/2026')] } });
    const r6 = await M.completarContratos({ db, clienteNucleo: nucleo6, unidade: 'CP', brutos: [K('101', '11', 'ANA ANUAL')] });
    const c100 = (await db.collection('pacto_contratos').doc('CP_100').get()).data();
    assert.strictEqual(c100.consultor, 'CONSULTORA CP', 'o núcleo regravou o contrato e apagou a consultora');
    assert.strictEqual(c100.gw, true);
    assert.ok(r6.mapa['101'], 'o contrato que faltava entrou');
    ok('completar pelo núcleo não apaga a consultora do gateway no caderninho');
  }

  /* 7–10. 01/10/2026: contrato e vínculo relidos na Pacto a cada montagem (os 4 pontos do Rodrigo) */
  // Gateway FALSO da unidade: contrato(n) e consultorDoAluno(pessoa), como o pacto-gateway-cliente.js devolve
  const G = (plano, vigenciaDe, vigenciaAte, pessoa, extra) => ({ situacao: 'ok', dados: Object.assign({
    codigo: '', consultor: null, lancou: null, plano, valor: 100, tipo: 'RE', situacao: 'AT', lancamento: vigenciaDe, vigenciaDe, vigenciaAte,
    cliente: { codigo: pessoa, nome: 'X' }, planoOriginal: '', recorrencia: false, renovadoEm: '', contratoNovo: null }, extra || {}) });
  const V = (...cos) => ({ situacao: 'ok', dados: { matricula: '1', consultor: cos[0] || null, consultores: cos } });
  const SEM_ESPERA = async () => {};
  function gwContratos(contratos, alunos) {
    const g = { pedidos: [], alunos: [],
      async contrato(nm) { g.pedidos.push(String(nm)); const r = contratos[nm]; return typeof r === 'function' ? r() : (r || { situacao: 'ok', dados: null }); },
      async consultorDoAluno(p) { g.alunos.push(String(p)); const r = alunos[p]; return typeof r === 'function' ? r() : (r || V()); } };
    return g;
  }
  const PREV = {
    '2026-10-01': OK([K('301', '31', 'PEDRO ATESTADO'), K('302', '32', 'CYNTIA IMPORTADA'), K('303', '33', 'RITA RECORRENTE'), K('304', '34', 'PAULA PERMUTA')]),
    '2026-11-01': OK([K('305', '35', 'NUNO NOVEMBRO')]),
  };
  const GW_HOJE = {
    301: G('ANUAL, ACESSO ILIMITADO', '15/10/2025', '13/11/2026', 'p31'),                                  // atestado: a Pacto já diz 13/11
    302: G('IMPORTAÇÃO', '05/09/2025', '05/10/2026', 'p32', { planoOriginal: 'ANUAL, ACESSO ILIMITADO', renovadoEm: '28/08/2026', contratoNovo: '999' }),
    303: G('ACESSO LIVRE | RECORRENTE | FLEX', '15/09/2026', '15/10/2026', 'p33'),
    304: G('IMPORTAÇÃO', '13/07/2026', '13/10/2026', 'p34', { planoOriginal: 'PERMUTA DIVULGAÇÃO' }),
    305: G('SEMESTRAL, TREINO LIVRE', '10/05/2026', '10/11/2026', 'p35'),
  };
  const ALUNOS = { p31: V('KALI LÓPEZ'), p32: V('RODRIGO ROJAIS'), p35: V('ERICA', 'FRANCINI') };
  async function bancoDesatualizado() {
    const db = makeFakeDb();
    await db.collection('units').doc('unit-cp').set({ config: {} });
    // o caderninho como estava em produção: vencimento velho e vínculo lido uma vez (Rodrigo)
    await db.collection('pacto_contratos').doc('CP_301').set({ codigo: '301', unidade: 'CP', nomePlano: 'ANUAL, ACESSO ILIMITADO',
      vigenciaDe: '15/10/2025', vigenciaAte: '14/10/2026', gw: true, alunoConsultado: true, consultorAluno: 'RODRIGO ROJAIS' });
    await db.collection('pacto_contratos').doc('CP_302').set({ codigo: '302', unidade: 'CP', nomePlano: 'IMPORTAÇÃO', vigenciaDe: '05/09/2025', vigenciaAte: '05/10/2026' });
    return db;
  }
  {
    const db = await bancoDesatualizado();
    const caderninhoAntes = JSON.stringify((await db.collection('pacto_contratos').doc('CP_301').get()).data());
    const gw = gwContratos(GW_HOJE, ALUNOS);
    const nucleo7 = nucleoFalso({});
    const r = await M.montarUnidadeMes({ db, clienteGw: gwFalso(PREV), clienteNucleo: nucleo7, clienteContratos: gw, unidade: 'CP', mes: '2026-10', hoje: '2026-10-01', agora: () => 'T1', dormir: SEM_ESPERA });
    const d = (await db.collection('renovacoes_lista').doc('CP_2026-10').get()).data();
    const de = c => Object.values(d.blocos).flat().find(l => l.codigoContrato === c);
    assert.strictEqual(r.situacao, 'ok');
    assert.deepStrictEqual(d.blocos.renovacoes.map(l => l.codigoContrato), ['302'], 'a importação saiu do Verificar pelo plano da observação');
    assert.strictEqual(de('302').planoOriginal, 'ANUAL, ACESSO ILIMITADO');
    assert.deepStrictEqual(d.blocos.antecipacao.map(l => l.codigoContrato), ['305', '301'], 'o vencimento relido (13/11) leva o Pedro para a antecipação');
    assert.strictEqual(de('301').vencimento, '2026-11-13');
    assert.strictEqual(de('301').consultora, 'KALI DUTRA', 'vínculo de hoje, não o "Rodrigo" guardado');
    assert.strictEqual(de('302').consultora, null, 'vínculo do sócio: Sem consultora');
    assert.strictEqual(de('302').renovadoEm, '2026-08-28'); assert.strictEqual(de('302').renovouAntesDoMes, true);
    assert.ok(de('305').notas.some(t => /Dois vínculos/.test(t)));
    assert.deepStrictEqual(d.blocos.verificar, []);
    assert.deepStrictEqual(d.excluidos, { recorrente: 1, permuta: 1 });
    assert.strictEqual(d.conferencia.bate, true);
    assert.deepStrictEqual(gw.pedidos.sort(), ['301', '302', '303', '304', '305'], 'cada contrato perguntado uma vez');
    assert.deepStrictEqual(gw.alunos.sort(), ['p31', 'p32', 'p35'], 'recorrente e permuta saem da lista: não se pergunta pelo aluno');
    assert.deepStrictEqual(d.leitura, { total: 5, relidos: 5, daReserva: 0, semLeitura: 0, motivo: '', consultasGateway: 11, segundaTentativa: { tentados: 0, vieram: 0 } });
    assert.strictEqual(nucleo7.consultas, 0, 'com o gateway respondendo, o núcleo não é consultado');
    assert.strictEqual(JSON.stringify((await db.collection('pacto_contratos').doc('CP_301').get()).data()), caderninhoAntes,
      'a releitura da lista NÃO mexe no caderninho das comissões');
    const lt = (await db.collection('renovacoes_leituras').doc('CP_301').get()).data();
    assert.strictEqual(lt.vigenciaAte, '13/11/2026'); assert.strictEqual(lt.consultorAluno, 'KALI LÓPEZ'); assert.strictEqual(lt.lidoEm, '2026-10-01');
    assert.ok(!/cpf|cliente/i.test(Object.keys(lt).join(' ')), 'a leitura guardada não leva nada do aluno');
    ok('gateway: vencimento, plano original e vínculo de HOJE; recorrente/permuta sem consulta ao aluno; caderninho das comissões intocado');

    /* 8. a Pacto fora do ar no dia seguinte: vale a última leitura boa, e a lista diz */
    const fora = gwContratos({ 301: { situacao: 'falhou', motivo: 'HTTP 503' }, 302: { situacao: 'falhou', motivo: 'HTTP 503' }, 303: { situacao: 'falhou', motivo: 'HTTP 503' },
      304: { situacao: 'falhou', motivo: 'HTTP 503' }, 305: { situacao: 'falhou', motivo: 'HTTP 503' } }, {});
    await M.montarUnidadeMes({ db, clienteGw: gwFalso(PREV), clienteNucleo: nucleoFalso({}), clienteContratos: fora, unidade: 'CP', mes: '2026-10', hoje: '2026-10-02', agora: () => 'T2', dormir: SEM_ESPERA });
    const d2 = (await db.collection('renovacoes_lista').doc('CP_2026-10').get()).data();
    assert.strictEqual(d2.situacao, 'ok');
    assert.deepStrictEqual(d2.blocos.renovacoes.map(l => l.codigoContrato), ['302'], 'não volta para o Verificar');
    assert.deepStrictEqual(d2.blocos.antecipacao.map(l => l.codigoContrato), ['305', '301']);
    assert.strictEqual(Object.values(d2.blocos).flat().find(l => l.codigoContrato === '301').consultora, 'KALI DUTRA');
    assert.deepStrictEqual(d2.leitura, { total: 5, relidos: 0, daReserva: 5, semLeitura: 0, motivo: 'a Pacto não devolveu parte dos contratos', consultasGateway: 10,
      segundaTentativa: { tentados: 5, vieram: 0 } }, 'cada contrato foi perguntado duas vezes');
    ok('gateway fora do ar: a lista sai igual à de ontem pela última leitura boa e registra que nada foi relido');

    /* 9. o contrato veio, o vínculo não: fica o vínculo da última leitura */
    const meio = gwContratos(GW_HOJE, { p31: { situacao: 'falhou', motivo: 'HTTP 504' }, p32: V('ISABELA'), p35: V('ERICA') });
    await M.montarUnidadeMes({ db, clienteGw: gwFalso(PREV), clienteNucleo: nucleoFalso({}), clienteContratos: meio, unidade: 'CP', mes: '2026-10', hoje: '2026-10-03', agora: () => 'T3', dormir: SEM_ESPERA });
    const d3 = (await db.collection('renovacoes_lista').doc('CP_2026-10').get()).data();
    const de3 = c => Object.values(d3.blocos).flat().find(l => l.codigoContrato === c);
    assert.strictEqual(de3('301').consultora, 'KALI DUTRA', 'vínculo de 01/10, que foi a última vez que veio');
    assert.strictEqual(de3('302').consultora, 'ISABELA', 'o Rodrigo passou o aluno para a Isabela: aparece na montagem seguinte');
    assert.strictEqual((await db.collection('renovacoes_leituras').doc('CP_301').get()).data().vinculoLidoEm, '2026-10-01');
    ok('vínculo que não veio hoje fica com o da última leitura; vínculo que mudou na Pacto aparece na montagem seguinte');
  }
  {
    /* 10. limite no meio: para de perguntar ao gateway, mas a lista sai (reserva → caderninho → núcleo) */
    const db = await bancoDesatualizado();
    let k = 0;
    const comLimite = gwContratos({
      301: () => (++k, GW_HOJE[301]), 302: () => ({ situacao: 'limite', motivo: 'HTTP 429' }),
      303: () => { throw new Error('não era para perguntar depois do limite'); }, 304: () => { throw new Error('idem'); }, 305: () => { throw new Error('idem'); },
    }, ALUNOS);
    const nucleo10 = nucleoFalso({
      33: { situacao: 'ok', dados: [BRUTO(303, 'ACESSO LIVRE | RECORRENTE | FLEX', '15/09/2026', '15/10/2026')] },
      34: { situacao: 'ok', dados: [BRUTO(304, 'IMPORTAÇÃO', '13/07/2026', '13/10/2026')] },
      35: { situacao: 'ok', dados: [BRUTO(305, 'SEMESTRAL, TREINO LIVRE', '10/05/2026', '10/11/2026')] },
    });
    const r = await M.montarUnidadeMes({ db, clienteGw: gwFalso(PREV), clienteNucleo: nucleo10, clienteContratos: comLimite, unidade: 'CP', mes: '2026-10', hoje: '2026-10-01', agora: () => 'T', dormir: SEM_ESPERA });
    const d = (await db.collection('renovacoes_lista').doc('CP_2026-10').get()).data();
    assert.strictEqual(r.situacao, 'ok', 'limite no gateway não derruba a lista');
    assert.deepStrictEqual(d.leitura, { total: 5, relidos: 1, daReserva: 0, semLeitura: 4, motivo: 'limite', consultasGateway: 4, segundaTentativa: { tentados: 0, vieram: 0 } },
      'depois do limite não há segunda tentativa');
    assert.deepStrictEqual(d.blocos.verificar.map(l => l.codigoContrato).sort(), ['302', '304'], 'sem a observação, as importações voltam a pedir conferência');
    assert.strictEqual(d.conferencia.bate, true);
    assert.strictEqual(nucleo10.consultas, 3, '302 estava no caderninho; 303, 304 e 305 foram ao núcleo');
    ok('limite da Pacto no meio da releitura: para de perguntar, a lista sai pelo caminho antigo e registra o motivo');

    /* 11. do dia 25 em diante são duas listas: o contrato que aparece nas duas é perguntado uma vez */
    const db2 = await bancoDesatualizado();
    const gw = gwContratos(GW_HOJE, ALUNOS);
    // como a Pacto devolve de verdade: o Pedro (13/11) vem na consulta de novembro, não na de outubro
    const prev2 = { '2026-10-01': OK(PREV['2026-10-01'].dados.contratos.filter(x => x.codigoContrato !== '301')),
      '2026-11-01': OK([K('305', '35', 'NUNO NOVEMBRO'), K('301', '31', 'PEDRO ATESTADO')]), '2026-12-01': OK([]) };
    const res = await M.montarTudo({ db: db2, clientesGw: { CP: gwFalso(prev2) }, clienteNucleo: nucleoFalso({}), clientesContratos: { CP: gw }, unidades: ['CP'], hoje: '2026-10-26', agora: () => 'T', dormir: SEM_ESPERA });
    assert.deepStrictEqual(res.map(x => x.id + ' ' + x.situacao), ['CP_2026-10 ok', 'CP_2026-11 ok']);
    assert.strictEqual(gw.pedidos.filter(x => x === '305').length, 1, 'o 305 está na antecipação de outubro e no mês de novembro');
    assert.strictEqual(gw.pedidos.filter(x => x === '301').length, 1);
    assert.strictEqual(gw.alunos.filter(x => x === 'p35').length, 1, 'o aluno também');
    const nov = (await db2.collection('renovacoes_lista').doc('CP_2026-11').get()).data();
    assert.deepStrictEqual(nov.blocos.renovacoes.map(l => l.codigoContrato), ['305', '301'], 'em novembro o Pedro (13/11) é renovação do mês');
    ok('montarTudo: uma pergunta por contrato na rodada, mesmo com as duas listas do fim do mês');
  }
  {
    /* 12. as Functions passam o gateway de contratos de cada unidade */
    const idx = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
    const bloco = idx.slice(idx.indexOf('async function rodarRenovacoes'), idx.indexOf('exports.montarListaRenovacoes ='));
    assert.ok(/clientesContratos\s*=\s*\{\s*CP: pactoGateway\.criarClienteGateway\(\{ fetch, credencial: PACTO_API_KEY_CP\.value\(\) \}\),\s*PP: pactoGateway\.criarClienteGateway\(\{ fetch, credencial: PACTO_API_KEY_PP\.value\(\) \}\)/.test(bloco));
    assert.ok(/montarTudo\(\{[^}]*clientesContratos/.test(bloco), 'montarTudo recebe os clientes de contrato');
    ok('Functions: a montagem recebe o gateway de contratos das duas unidades');
  }

  {
    /* 13. a Pacto devolve o contrato VAZIO na primeira passada (ensaio de 01/10: 35 de 91 no Campeche) e responde na segunda */
    const db = await bancoDesatualizado();
    const vezes = {};
    const instavel = cod => () => { vezes[cod] = (vezes[cod] || 0) + 1; return vezes[cod] === 1 ? { situacao: 'ok', dados: null } : GW_HOJE[cod]; };
    const gw = gwContratos({ 301: instavel(301), 302: instavel(302), 303: GW_HOJE[303], 304: GW_HOJE[304], 305: () => ({ situacao: 'falhou', motivo: 'HTTP 502' }) }, ALUNOS);
    const pausas = [];
    const nucleo13 = nucleoFalso({ 35: { situacao: 'ok', dados: [BRUTO(305, 'SEMESTRAL, TREINO LIVRE', '10/05/2026', '10/11/2026')] } });
    await M.montarUnidadeMes({ db, clienteGw: gwFalso(PREV), clienteNucleo: nucleo13, clienteContratos: gw, unidade: 'CP', mes: '2026-10', hoje: '2026-10-01',
      agora: () => 'T', dormir: async ms => { pausas.push(ms); } });
    const d = (await db.collection('renovacoes_lista').doc('CP_2026-10').get()).data();
    const de = c => Object.values(d.blocos).flat().find(l => l.codigoContrato === c);
    assert.deepStrictEqual(pausas, [5000], 'uma pausa antes da segunda passada');
    assert.strictEqual(de('302').planoOriginal, 'ANUAL, ACESSO ILIMITADO', 'veio na segunda tentativa: não cai no Verificar');
    assert.strictEqual(de('301').vencimento, '2026-11-13');
    assert.deepStrictEqual(d.blocos.verificar, []);
    assert.deepStrictEqual(d.leitura.segundaTentativa, { tentados: 3, vieram: 2 });
    assert.deepStrictEqual([d.leitura.relidos, d.leitura.daReserva, d.leitura.semLeitura], [4, 0, 1], 'o 305 não veio nas duas: caminho antigo');
    assert.strictEqual(de('305').plano, 'SEMESTRAL, TREINO LIVRE', 'e mesmo assim está na lista, pelo núcleo');
    assert.deepStrictEqual(gw.pedidos.filter(x => x === '301' || x === '302').length, 4);
    ok('contrato que volta vazio é perguntado de novo no fim, depois de uma pausa; só quem falha duas vezes vai para a reserva');
  }

  console.log('\n✅ smoke-renovacoes-montar: ' + n);
})().catch(e => { console.error(e); process.exit(1); });
