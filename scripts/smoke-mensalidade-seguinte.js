'use strict';
// Roda: node scripts/smoke-mensalidade-seguinte.js
//
// "A mensalidade seguinte do mesmo plano recorrente não é venda, seja quem for que
// lançou" (decisão do Rafael, 05/10/2026, a partir da conferência do Rodrigo em
// setembro). Antes só saía a renovação lançada pelo ROBÔ da Pacto; a consultora
// lançando à mão um dia antes do robô contava como venda dela.
//
// Cobre a regra pura (pacto-adapter.js), a leitura do caderninho (comissoes-mes.js),
// o cálculo automático de ponta a ponta e a busca da Pacto guardando de que contrato
// cada renovação veio. Dados INVENTADOS — o repositório é público.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const fn = p => path.join(raiz, 'functions', p);
const makeFakeDb = require('./_fake-firestore.js');
const C = require('./_comissoes-mes-cenario.js');
const PA = require(path.join(raiz, 'pacto-adapter.js'));
const CM = require(path.join(raiz, 'comissoes-mes.js'));
const L = require(path.join(raiz, 'pacto-api-linhas.js'));
const T = require(path.join(raiz, 'pacto-termometro.js'));
const CE = require(path.join(raiz, 'commission.js'));
const A = require(fn('comissoes-automatico.js'));
const S = require(fn('pacto-sombra.js'));
const { criarCliente } = require(fn('pacto-api-cliente.js'));
const { criarClienteGateway, lerContrato } = require(fn('pacto-gateway-cliente.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);
const REC = 'HIIT/MAROMBINHA | RECORRENTE | PP | 3X | PADRÃO.';
const ANUAL = 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO.';
const cad = (codigo, nomePlano, vigenciaDe, vigenciaAte, extra) => Object.assign({ codigo: String(codigo), unidade: 'PP', nomePlano, vigenciaDe, vigenciaAte }, extra || {});

(async () => {
  {
    // 1. o que é "o mesmo plano recorrente"
    assert.strictEqual(PA.chavePlanoRecorrente('ACESSO LIVRE | MENSAL | FLEX'), '', 'mensal não é recorrente');
    assert.strictEqual(PA.chavePlanoRecorrente(ANUAL), '');
    assert.strictEqual(PA.chavePlanoRecorrente('PLANO VOUCHER DEGUSTAÇÃO'), '');
    assert.strictEqual(PA.chavePlanoRecorrente('IMPORTAÇÃO'), '', 'da importação não se sabe o plano: nada se afirma');
    assert.strictEqual(PA.chavePlanoRecorrente(''), '');
    assert.ok(PA.chavePlanoRecorrente(REC));
    assert.strictEqual(PA.chavePlanoRecorrente('ECONÔMICO | RECORRENTE | (FLEX) | ILIMITADO | PADRÃO.'), PA.chavePlanoRecorrente('Econômico | Recorrente | Flex | Ilimitado | Padrão'),
      'pontuação, acento e maiúsculas não fazem outro plano');
    assert.notStrictEqual(PA.chavePlanoRecorrente(REC), PA.chavePlanoRecorrente('HIIT/MAROMBINHA | RECORRENTE | PP | ILIMITADO | PADRÃO.'), '3x e ilimitado são planos diferentes');
    assert.strictEqual(PA.chavePlanoRecorrente('PLANO RECORRENTEMENTE BOM'), '', 'RECORRENTE como palavra inteira');
    ok('plano recorrente: chave sem pontuação nem acento; mensal, anual, voucher e importação não têm chave');
  }
  {
    // 2. continuação: mesmo plano, o anterior começou antes e não há intervalo
    const ant = cad(4607, REC, '22/08/2026', '25/09/2026');
    const e = (novo, anterior) => PA.ehContinuacaoDe(novo, anterior);
    assert.strictEqual(e(cad(4734, REC, '26/09/2026', '25/10/2026'), ant), true, 'começa no dia seguinte ao fim do anterior');
    assert.strictEqual(e(cad(4734, REC, '25/09/2026', '24/10/2026'), ant), true, 'começa no último dia do anterior');
    assert.strictEqual(e(cad(4734, REC, '20/09/2026', '19/10/2026'), ant), true, 'começa antes de o anterior acabar');
    assert.strictEqual(e(cad(4734, REC, '27/09/2026', '26/10/2026'), ant), false, 'um dia de intervalo: o recorrente não renovou sozinho e alguém foi atrás — é venda');
    assert.strictEqual(e(cad(4734, REC, '10/12/2026', '09/01/2027'), ant), false, 'voltou meses depois: é venda');
    assert.strictEqual(e(cad(4734, 'HIIT/MAROMBINHA | RECORRENTE | PP | ILIMITADO | PADRÃO.', '26/09/2026', '25/10/2026'), ant), false, 'mudou de plano recorrente: houve negociação');
    assert.strictEqual(e(cad(4734, REC, '26/09/2026', '25/10/2026'), cad(4630, 'MÊS DEGUSTAÇÃO LIVRE.', '26/08/2026', '25/09/2026')), false, 'veio da degustação: é conversão');
    assert.strictEqual(e(cad(4734, REC, '26/09/2026', '25/10/2026'), cad(4500, ANUAL, '26/09/2025', '25/09/2026')), false, 'veio do anual');
    assert.strictEqual(e(cad(4734, ANUAL, '26/09/2026', '25/09/2027'), cad(4500, ANUAL, '26/09/2025', '25/09/2026')), false, 'renovação de anual é venda');
    assert.strictEqual(e(ant, cad(4734, REC, '26/09/2026', '25/10/2026')), false, 'o PRIMEIRO contrato não é continuação do segundo');
    assert.strictEqual(e(ant, ant), false, 'o próprio contrato não é o anterior dele');
    assert.strictEqual(e(cad(4734, REC, '', ''), ant), false, 'sem data não se afirma nada');
    assert.strictEqual(e(cad(4734, REC, '26/09/2026', ''), cad(4607, REC, '22/08/2026', '')), false);
    assert.strictEqual(e(null, ant), false); assert.strictEqual(e(ant, null), false);
    // duas matrículas do mesmo plano encostadas (meses retroativos lançados no mesmo dia)
    const m1 = cad(4669, REC, '24/07/2026', '23/08/2026'), m2 = cad(4671, REC, '23/08/2026', '22/09/2026');
    assert.deepStrictEqual([e(m2, m1), e(m1, m2)], [true, false], 'a segunda é continuação; a primeira é a venda');
    ok('continuação: mesmo plano recorrente sem intervalo; outro plano, intervalo ou volta depois continuam sendo venda');
  }

  // linha do arquivo/API (formato do export), unidade PP
  const linha = o => C.comCabecalho([]).length && (() => {
    const l = new Array(L.TAMANHO_LINHA).fill('');
    const put = (k, v) => { l[L.COL[k]] = v == null ? '' : v; };
    put('matricula', o.mat || '1'); put('nome', o.nome); put('resp1', o.resp1 || o.consultor || ''); put('resp2', 'RECORRENCIA');
    put('produto', o.produto || o.plano || ''); put('contrato', o.contrato || '0'); put('inicio', o.inicio || ''); put('termino', o.termino || '');
    put('duracao', '1'); put('plano', o.plano || ''); put('situacao', o.situacao || ''); put('lancamento', o.dia); put('valor', o.valor || '309,00');
    put('forma', 'CARTAO'); put('empresa', L.EMPRESA[o.unidade || 'PP']); put('consultor', o.consultor || '');
    return l;
  })();

  {
    // 3. o tradutor tira o contrato INTEIRO que quem chama apontou, e só ele
    const linhas = L.comCabecalho([
      linha({ nome: 'ALUNA CONTINUA', contrato: '4734', plano: REC, situacao: 'Renovação', inicio: '26/09/2026', termino: '25/10/2026', dia: '25/09/2026', consultor: C.V1 }),
      linha({ nome: 'ALUNA CONTINUA', contrato: '4734', produto: 'TAXA DE RENEGOCIAÇÃO', plano: REC, situacao: 'Renovação', inicio: '26/09/2026', termino: '25/10/2026', dia: '25/09/2026', valor: '10,00', consultor: C.V1 }),
      linha({ nome: 'ALUNA NOVA', contrato: '4735', plano: REC, situacao: 'Matrícula', inicio: '26/09/2026', termino: '25/10/2026', dia: '26/09/2026', consultor: C.V1 }),
      linha({ nome: 'ALUNO CP', contrato: '7734', plano: REC, situacao: 'Renovação', inicio: '26/09/2026', termino: '25/10/2026', dia: '26/09/2026', consultor: C.V2, unidade: 'CP' }),
      linha({ nome: 'ALUNA CONTINUA', contrato: '0', produto: 'ÁGUA', dia: '26/09/2026', valor: '5,00', consultor: C.V1 }),
    ]);
    const sem = PA.traduzir(linhas, { mes: '2026-09' });
    assert.strictEqual(sem.descartadas.length, 0);
    assert.strictEqual(sem.vendas.length, 5, 'sem a lista, tudo é venda (renovação fechada por gente)');
    const t = PA.traduzir(linhas, { mes: '2026-09', mensalidadesSeguintes: ['PP_4734'] });
    assert.deepStrictEqual(t.descartadas.map(d => [d.contrato, d.unidade, d.seguinte]), [['4734', 'PP', true], ['4734', 'PP', true]], 'o plano e a taxa do mesmo contrato');
    assert.ok(/mensalidade seguinte do mesmo plano recorrente/.test(t.descartadas[0].motivo));
    assert.ok(!t.descartadas[0].automatica, 'não se confunde com a renovação do robô');
    assert.deepStrictEqual(t.vendas.map(v => v['Código']).sort(), ['A1', 'C4735', 'C7734'], 'ficam a matrícula nova, o contrato da outra unidade e a água');
    assert.strictEqual(PA.traduzir(linhas, { mes: '2026-09', mensalidadesSeguintes: ['CP_4734'] }).vendas.length, 5, 'o mesmo número em OUTRA unidade não tira nada');
    assert.strictEqual(t.porUnidade.CP.length, 1);
    assert.strictEqual(PA.traduzir(linhas, { mes: '2026-09', mensalidadesSeguintes: new Set(['PP_4734']) }).vendas.length, 3, 'aceita Set');
    // agosto foi pago por fora, pelas regras antigas: a lista não tira nada
    const ago = L.comCabecalho([linha({ nome: 'ALUNA CONTINUA', contrato: '4600', plano: REC, situacao: 'Renovação', inicio: '26/08/2026', termino: '25/09/2026', dia: '25/08/2026', consultor: C.V1 })]);
    assert.strictEqual(PA.traduzir(ago, { mes: '2026-08', mensalidadesSeguintes: ['PP_4600'] }).vendas.length, 1, 'a regra vale de setembro/2026 em diante');
    ok('tradutor: tira o contrato inteiro (plano e taxa) da unidade apontada, com motivo; outra unidade, balcão e agosto não mudam');
  }
  {
    // 4. quais contratos perguntar ao caderninho
    const linhas = L.comCabecalho([
      linha({ nome: 'A', contrato: '4734', plano: REC, situacao: 'Renovação', inicio: '26/09/2026', termino: '25/10/2026', dia: '25/09/2026' }),
      linha({ nome: 'A', contrato: '4734', plano: REC, situacao: 'Renovação', inicio: '26/09/2026', termino: '25/10/2026', dia: '25/09/2026', valor: '10,00' }),
      linha({ nome: 'B', contrato: '4740', plano: ANUAL, situacao: 'Renovação', inicio: '26/09/2026', termino: '25/09/2027', dia: '25/09/2026' }),
      linha({ nome: 'C', contrato: '4750', plano: REC, situacao: 'Matrícula', inicio: '26/10/2026', termino: '25/11/2026', dia: '02/10/2026' }),
      linha({ nome: 'D', contrato: '0', produto: 'ÁGUA', dia: '26/09/2026', valor: '5,00' }),
    ]);
    assert.deepStrictEqual(PA.contratosRecorrentesDoMes(linhas, '2026-09'),
      [{ unidade: 'PP', codigo: '4734', nomePlano: REC, vigenciaDe: '26/09/2026', vigenciaAte: '25/10/2026' }], 'um por contrato; anual, outro mês e balcão ficam de fora');
    ok('contratos recorrentes do mês: um por contrato, só plano recorrente e só o mês');
  }

  /** caderninho de teste */
  async function caderninho(db, docs) {
    for (const d of docs) await db.collection('pacto_contratos').doc(d.unidade + '_' + d.codigo).set(d);
  }
  const CENARIO = [
    // A. renovação lançada à mão: a Pacto diz de que contrato veio (o anterior foi lido antes de haver `pessoa`)
    cad(4607, REC, '22/08/2026', '25/09/2026'),
    cad(4734, REC, '26/09/2026', '25/10/2026', { pessoa: '501', gw: true, anterior: '4607', lancou: C.V1 }),
    // B. duas matrículas do mesmo plano (a Pacto não liga uma à outra): o mesmo aluno
    cad(4669, REC, '24/07/2026', '23/08/2026', { pessoa: '502', gw: true, anterior: null }),
    cad(4671, REC, '23/08/2026', '22/09/2026', { pessoa: '502', gw: true, anterior: null }),
    // C. conversão de degustação: o anterior é outro plano
    cad(4630, 'MÊS DEGUSTAÇÃO LIVRE.', '24/08/2026', '23/09/2026', { pessoa: '503', gw: true }),
    cad(4726, REC, '24/09/2026', '23/10/2026', { pessoa: '503', gw: true, anterior: '4630' }),
    // D. o recorrente não renovou sozinho e a consultora recuperou o aluno dias depois
    cad(4500, REC, '01/08/2026', '31/08/2026', { pessoa: '504', gw: true }),
    cad(4760, REC, '10/09/2026', '09/10/2026', { pessoa: '504', gw: true, anterior: null }),
    // E. mesmo código de pessoa na OUTRA unidade (cada unidade tem a sua numeração)
    Object.assign(cad(7001, REC, '01/08/2026', '02/09/2026', { pessoa: '505', gw: true }), { unidade: 'CP' }),
    cad(4770, REC, '03/09/2026', '02/10/2026', { pessoa: '505', gw: true, anterior: null }),
  ];
  const LINHAS_SET = L.comCabecalho([
    linha({ nome: 'ALUNA A', contrato: '4734', plano: REC, situacao: 'Renovação', inicio: '26/09/2026', termino: '25/10/2026', dia: '25/09/2026', consultor: C.V1 }),
    linha({ nome: 'ALUNO B', contrato: '4669', plano: REC, situacao: 'Matrícula', inicio: '24/07/2026', termino: '23/08/2026', dia: '02/09/2026', consultor: C.V1 }),
    linha({ nome: 'ALUNO B', contrato: '4671', plano: REC, situacao: 'Matrícula', inicio: '23/08/2026', termino: '22/09/2026', dia: '02/09/2026', consultor: C.V1 }),
    linha({ nome: 'ALUNA C', contrato: '4726', plano: REC, situacao: 'Renovação', inicio: '24/09/2026', termino: '23/10/2026', dia: '23/09/2026', consultor: C.V1 }),
    linha({ nome: 'ALUNO D', contrato: '4760', plano: REC, situacao: 'Rematrícula', inicio: '10/09/2026', termino: '09/10/2026', dia: '10/09/2026', consultor: C.V1 }),
    linha({ nome: 'ALUNO E', contrato: '4770', plano: REC, situacao: 'Matrícula', inicio: '03/09/2026', termino: '02/10/2026', dia: '03/09/2026', consultor: C.V1 }),
    linha({ nome: 'ALUNA F', contrato: '4780', plano: REC, situacao: 'Renovação', inicio: '05/09/2026', termino: '04/10/2026', dia: '05/09/2026', consultor: C.V1 }),   // fora do caderninho
  ]);
  {
    // 5. a leitura do caderninho
    const db = makeFakeDb();
    await caderninho(db, CENARIO);
    const r = await CM.mensalidadesSeguintes({ db, Adapter: PA, linhas: LINHAS_SET, mes: '2026-09' });
    assert.deepStrictEqual(r.sort(), ['PP_4671', 'PP_4734'],
      'saem a renovação que continua o contrato apontado pela Pacto e a segunda matrícula do mesmo aluno; conversão, recuperado, outra unidade e contrato fora do caderninho ficam');
    assert.deepStrictEqual(await CM.mensalidadesSeguintes({ db, Adapter: PA, linhas: LINHAS_SET, mes: '2026-08' }), [], 'antes de setembro/2026 nada');
    assert.deepStrictEqual(await CM.mensalidadesSeguintes({ db: makeFakeDb(), Adapter: PA, linhas: LINHAS_SET, mes: '2026-09' }), [], 'sem caderninho não se afirma nada');
    // o anterior apontado pela Pacto que não está no caderninho: sem prova, a venda segue
    const db2 = makeFakeDb();
    await caderninho(db2, [cad(4734, REC, '26/09/2026', '25/10/2026', { pessoa: '501', gw: true, anterior: '4607' })]);
    assert.deepStrictEqual(await CM.mensalidadesSeguintes({ db: db2, Adapter: PA, linhas: LINHAS_SET, mes: '2026-09' }), []);
    ok('caderninho: acha a continuação pelo contrato anterior (Pacto) e pelo mesmo aluno; sem prova, a venda segue');
  }
  {
    // 6. o cálculo do mês (tela e servidor passam por `preparar`) usa a lista
    const db = makeFakeDb(); await C.semear(db);
    await caderninho(db, CENARIO);
    const FieldValue = { serverTimestamp: () => 'SERVER_TIMESTAMP' }, Timestamp = { fromDate: d => ({ ts: d.toISOString() }) };
    const Jornada = require(path.join(raiz, 'jornada-comercial.js')), Metas = require(path.join(raiz, 'metas-sugeridas.js'));
    const ops = CM.criar({ db, FieldValue, Timestamp, Engine: CE, Adapter: PA, Jornada, Metas, autor: { uid: 't', name: 'Teste' } });
    const prep = await ops.preparar(LINHAS_SET, { unitId: C.UNIT });
    assert.strictEqual(prep.tipo, 'ok');
    const codigos = prep.result.processed.map(p => p.codigo).sort();
    assert.deepStrictEqual(codigos, ['C4669', 'C4726', 'C4760', 'C4770', 'C4780'], 'o 4734 e o 4671 não viram lançamento');
    assert.deepStrictEqual(prep.pacto.descartadas.filter(d => d.seguinte).map(d => d.contrato).sort(), ['4671', '4734'], 'e aparecem no que ficou de fora, com o motivo');
    assert.strictEqual(prep.result.unitTotals.unitAtivacoes, 5);
    // caderninho que não pode ser lido (quem sobe não é admin): o mês sai, com aviso — nunca calado
    const dbRuim = makeFakeDb(); await C.semear(dbRuim);
    const col = dbRuim.collection.bind(dbRuim);
    dbRuim.collection = nome => { if (nome === 'pacto_contratos') throw new Error('Missing or insufficient permissions.'); return col(nome); };
    const ops2 = CM.criar({ db: dbRuim, FieldValue, Timestamp, Engine: CE, Adapter: PA, Jornada, Metas, autor: { uid: 't', name: 'Teste' } });
    const prep2 = await ops2.preparar(LINHAS_SET, { unitId: C.UNIT });
    assert.strictEqual(prep2.tipo, 'ok');
    assert.strictEqual(prep2.result.processed.length, 7);
    assert.ok(prep2.pacto.avisos.some(a => /não consegui conferir as mensalidades seguintes/.test(a.motivo)), JSON.stringify(prep2.pacto.avisos));
    ok('cálculo do mês: a continuação não vira lançamento e aparece no que ficou de fora; sem acesso ao caderninho, avisa');
  }
  {
    // 7. o automático da madrugada, de ponta a ponta (outubro): o banco sai sem a continuação
    const db = makeFakeDb(); await C.semear(db);
    await caderninho(db, [
      cad(9050, REC, '03/09/2026', '02/10/2026', { pessoa: '601', gw: true, anterior: null }),
      cad(9102, REC, '03/10/2026', '02/11/2026', { pessoa: '601', gw: true, anterior: '9050', lancou: C.V1 }),
    ]);
    const linhasOut = [
      linha({ nome: 'CLIENTE A', contrato: '9101', plano: ANUAL, situacao: 'Matrícula', inicio: '02/10/2026', termino: '01/10/2027', dia: '02/10/2026', valor: '329,00', consultor: C.V1 }),
      linha({ nome: 'CLIENTE B', contrato: '9102', plano: REC, situacao: 'Renovação', inicio: '03/10/2026', termino: '02/11/2026', dia: '03/10/2026', consultor: C.V1 }),
    ];
    for (let d = 1; d <= 11; d++) {
      const dia = '2026-10-' + String(d).padStart(2, '0');
      const doDia = linhasOut.filter(l => { const [dd, mm, aa] = l[L.COL.lancamento].split('/'); return `${aa}-${mm}-${dd}` === dia; });
      await db.collection('pacto_sombra_dias').doc('PP_' + dia).set({ unidade: 'PP', dia, situacao: 'buscado', comGateway: true, linhas: JSON.stringify(doDia), buscadoEm: 'T' });
    }
    const FieldValue = { serverTimestamp: () => 'SERVER_TIMESTAMP' }, Timestamp = { fromDate: d => ({ ts: d.toISOString() }) };
    const r = await A.atualizarMesAutomatico({ db, FieldValue, Timestamp, sigla: 'PP', mes: '2026-10', hoje: '2026-10-12' });
    assert.strictEqual(r.situacao, 'atualizado', JSON.stringify(r));
    const itens = Object.values(db._dump()['periodos/' + C.UNIT + '_2026-10/itens'] || {}).filter(x => x.type === 'processed');
    assert.deepStrictEqual(itens.map(x => x.codigo), ['C9101'], 'a renovação do recorrente lançada à mão não é gravada');
    assert.strictEqual(db._dump().periodos[C.UNIT + '_2026-10'].totals.unitAtivacoes, 1);
    // o termômetro conta igual
    const docs = (await db.collection('pacto_sombra_dias').where('unidade', '==', 'PP').get()).docs.map(d => d.data());
    const seg = await CM.mensalidadesSeguintes({ db, Adapter: PA, linhas: docs.flatMap(d => JSON.parse(d.linhas)), mes: '2026-10' });
    const base = { docs, mes: '2026-10', unidade: 'PP', hoje: '2026-10-12', Adapter: PA, Engine: CE, ApiLinhas: L };
    assert.strictEqual(T.calcularMes(base).ativacoes.total, 2, 'sem a lista o termômetro contaria as duas');
    assert.strictEqual(T.calcularMes(Object.assign({ mensalidadesSeguintes: seg }, base)).ativacoes.total, 1);
    const feitos = await S.atualizarTermometro({ db, unidades: ['PP'], meses: ['2026-10'], hoje: '2026-10-12', agora: () => 'T' });
    assert.deepStrictEqual(feitos, [{ id: 'PP_2026-10' }]);
    assert.strictEqual((await db.collection('pacto_termometro').doc('PP_2026-10').get()).data().ativacoes.total, 1, 'o termômetro gravado pela busca usa a mesma leitura');
    ok('automático de outubro: a mensalidade seguinte lançada à mão não é gravada, e o termômetro conta igual');
  }
  {
    // 8. a busca da Pacto guarda de que contrato a renovação veio — e pergunta UMA vez por quem foi lido antes
    assert.strictEqual(lerContrato({ codigo: 1, contratoBaseadoRenovacao: 4607 }).anterior, '4607');
    assert.strictEqual(lerContrato({ codigo: 1, contratoBaseadoRenovacao: 0 }).anterior, null, 'zero é "não veio de renovação"');
    assert.strictEqual(lerContrato({ codigo: 1 }).anterior, null);
    assert.strictEqual(L.contratoDoGateway({ codigo: 1, anterior: '4607' }, 'PP').anterior, '4607');
    assert.strictEqual(L.contratoDoGateway({ codigo: 1 }, 'PP').anterior, null);

    const P = S.precisaDoAnterior;
    const lido = { gw: true, alunoConsultado: true, pessoa: '501', nomePlano: REC, situacaoContrato: 'Renovação' };
    assert.strictEqual(P(lido, '2026-09-25'), true, 'renovação de recorrente lida antes de haver a resposta');
    assert.strictEqual(P(Object.assign({}, lido, { anterior: null }), '2026-09-25'), false, 'null já é resposta');
    assert.strictEqual(P(Object.assign({}, lido, { anterior: '4607' }), '2026-09-25'), false);
    assert.strictEqual(P(Object.assign({}, lido, { situacaoContrato: 'Matrícula' }), '2026-09-25'), false, 'matrícula não vem de renovação');
    assert.strictEqual(P(Object.assign({}, lido, { nomePlano: ANUAL }), '2026-09-25'), false, 'só o recorrente interessa');
    assert.strictEqual(P(Object.assign({}, lido, { gw: false }), '2026-09-25'), false, 'ainda não lido: a leitura normal já traz');
    assert.strictEqual(P(lido, '2026-08-25'), false, 'agosto fica como está');

    const pactoFalsa = rotas => {
      const chamadas = [];
      return { chamadas, fetch: async url => {
        chamadas.push(url);
        for (const [re, resp] of rotas) if (re.test(url)) return { status: 200, text: async () => JSON.stringify(resp.body) };
        return { status: 404, text: async () => 'rota não prevista: ' + url };
      } };
    };
    const pagamento = (codigo, alunoCod, contrato) => ({ codigo, data: '25/09/2026 08:00:00', responsavelLancamento: 'RECORRENCIA',
      aluno: { codigo: alunoCod, nome: 'CLIENTE FICTICIO ' + alunoCod }, formas: [{ formaPagamento: 'CARTAO', valor: 309 }],
      parcelasPagas: [{ codigo: codigo * 10, codigoContrato: contrato, descricao: 'PARCELA 1', valor: 309 }] });
    const gwContrato = (codigo, extra) => ({ body: { content: Object.assign({ codigo, tipo: 'RN', situacao: 'AT', descricaoPlano: REC, valor: 309,
      dataLancamento: Date.UTC(2026, 8, 25, 12), vigenciaDe: Date.UTC(2026, 8, 26, 3), vigenciaAte: Date.UTC(2026, 9, 25, 3),
      nomeConsultorReponsavel: 'CONSULTORA TESTE', responsavelLancamento: 'CONSULTORA TESTE', pessoaDTO: { codigo: 501, nome: 'CLIENTE FICTICIO 501' } }, extra || {}) } });
    const db = makeFakeDb();
    // 4734: já lido antes (gw e aluno), sem a resposta · 4790: nunca lido
    await caderninho(db, [cad(4734, REC, '26/09/2026', '25/10/2026', { situacaoContrato: 'Renovação', pessoa: '501', gw: true, alunoConsultado: true, consultorAluno: 'CONSULTORA TESTE', vinculoDia: '2026-10-05', consultor: 'CONSULTORA TESTE', lancou: 'CONSULTORA TESTE' }),
      cad(4790, REC, '26/09/2026', '25/10/2026', { situacaoContrato: 'Renovação', consultor: 'CONSULTORA TESTE', lancou: 'CONSULTORA TESTE' })]);
    const p = pactoFalsa([
      [/resumoPeriodo/, { body: { contratosLancados: [], pagamentos: [pagamento(1, 501, 4734), pagamento(2, 502, 4790)], vendaAvulsa: [], estornos: [], estornosContrato: [] } }],
      [/apigw\.pactosolucoes\.com\.br\/contratos\/4734$/, gwContrato(4734, { contratoBaseadoRenovacao: 4607 })],
      [/apigw\.pactosolucoes\.com\.br\/contratos\/4790$/, gwContrato(4790, { contratoBaseadoRenovacao: 0, pessoaDTO: { codigo: 502, nome: 'CLIENTE FICTICIO 502' } })],
      [/dados-clientes\/502$/, { body: { content: { matricula: '902' } } }],
      [/clientes\/902\/dados-plano$/, { body: { content: { vinculos: [{ tipoVinculo: 'CO', colaborador: 'CONSULTORA TESTE' }] } } }],
      [/vendas\?inicio=/, { body: { status: 'sucesso', produtos: [] } }],
    ]);
    const cliente = criarCliente({ fetch: p.fetch, credencial: 'cred-falsa', pausaMs: 0 });
    const gw = criarClienteGateway({ fetch: p.fetch, credencial: 'cred-gw-falsa', pausaMs: 0 });
    const args = { db, cliente, gw, unidade: 'PP', dia: '2026-09-25', agora: () => 'AGORA', anoCorrente: '2026', hoje: '2026-10-05' };
    assert.strictEqual((await S.buscarDia(args)).situacao, 'buscado');
    const c4734 = (await db.collection('pacto_contratos').doc('PP_4734').get()).data();
    const c4790 = (await db.collection('pacto_contratos').doc('PP_4790').get()).data();
    assert.strictEqual(c4734.anterior, '4607', 'o contrato já lido ganha a resposta');
    assert.strictEqual(c4734.consultorAluno, 'CONSULTORA TESTE', 'sem perder o que já tinha');
    assert.deepStrictEqual([c4790.anterior, c4790.gw, c4790.pessoa], [null, true, '502'], 'o nunca lido já nasce com a resposta (null = não veio de renovação)');
    const antes = p.chamadas.filter(u => /apigw.*\/contratos\//.test(u)).length;
    assert.strictEqual(antes, 2, 'uma pergunta por contrato');
    await S.buscarDia(args);
    assert.strictEqual(p.chamadas.filter(u => /apigw.*\/contratos\//.test(u)).length, antes, 'na busca seguinte ninguém é perguntado de novo');
    ok('busca da Pacto: guarda o contrato anterior; quem foi lido antes é perguntado uma vez só');
  }
  {
    // 9. as cópias da tela e do servidor são as mesmas
    ['pacto-adapter.js', 'comissoes-mes.js', 'pacto-termometro.js', 'pacto-api-linhas.js'].forEach(f =>
      assert.strictEqual(fs.readFileSync(fn(f), 'utf8'), fs.readFileSync(path.join(raiz, f), 'utf8'), f + ': as duas cópias divergiram'));
    const sombra = fs.readFileSync(fn('pacto-sombra.js'), 'utf8');
    assert.ok(/CM\.mensalidadesSeguintes\(/.test(sombra), 'o termômetro da busca usa a leitura do caderninho');
    ok('tela e servidor usam os mesmos módulos; o termômetro da busca lê o caderninho');
  }
  console.log('\n✅ smoke-mensalidade-seguinte: ' + n);
})().catch(e => { console.error(e); process.exit(1); });
