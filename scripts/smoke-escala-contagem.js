'use strict';
// Roda: node scripts/smoke-escala-contagem.js
//
// O contador de justiça deixou de ser um número guardado e passou a ser CONTADO
// das escalas. Motivo (25/08/2026): em produção 9 das 16 pessoas estavam com o
// contador errado — a Karin marcava 1 e tinha 3 sábados — porque o número só se
// mexia na primeira montagem de cada data, e remontar a prévia troca as pessoas
// sem refazer a conta. Pior: esse número é o insumo do motor, então o contador
// travado da Karin foi o que a fez pegar 3 sábados.

const assert = require('assert');
const SS = require('../scale-service.js');

let ok = 0;
const passou = (msg) => { console.log('✓ ' + msg); ok++; };

const vaga = (id, pid) => ({ id, unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: pid || null });
const escala = (date, tipo, pessoas, batchId) => ({
  id: `sc_${date}_${tipo}`, date, tipo, windowBatchId: batchId || null,
  slots: pessoas.map((p, i) => vaga(`v${i}`, p)),
});

const ESCALAS = [
  escala('2026-09-05', 'sabado',  ['karin', 'bruno'], 'b1'),
  escala('2026-09-07', 'feriado', ['bruno', 'thay'],  'b2'),
  escala('2026-09-19', 'sabado',  ['karin', null],    'b1'),
  escala('2026-10-17', 'sabado',  ['karin'],          'b1'),
  escala('2026-11-14', 'evento',  ['karin']),
  escala('2025-09-06', 'sabado',  ['karin']),
];

// ── por tipo ──
{
  const sab = SS.contarPorPessoa(ESCALAS, { tipos: ['sabado'] });
  assert.strictEqual(sab.karin, 4, 'karin tem 3 sábados em 2026 + 1 em 2025');
  assert.strictEqual(sab.bruno, 1, 'bruno tem 1 sábado');
  assert.strictEqual(sab.thay, undefined, 'thay não tem sábado nenhum');
  assert.strictEqual(sab.evento, undefined, 'evento não é sábado');
  passou('conta por tipo e ignora os outros tipos');
}

// ── feriado NÃO soma sábado (pedido 4 do Rodrigo) ──
{
  const fer = SS.contarPorPessoa(ESCALAS, { tipos: ['feriado', 'domingo_especial'] });
  assert.strictEqual(fer.bruno, 1, 'bruno tem 1 feriado');
  assert.strictEqual(fer.karin, undefined, 'os 3 sábados da karin não entram em feriados');
  passou('feriado conta só feriado');
}

// ── por ano ──
{
  const ano = SS.contarPorPessoa(ESCALAS, { tipos: ['sabado'], de: '2026-01-01', ate: '2026-12-31' });
  assert.strictEqual(ano.karin, 3, 'o sábado de 2025 fica fora do ano de 2026');
  passou('recorta por período');
}

// ── por janela ──
{
  const j = SS.contarPorPessoa(ESCALAS, { tipos: ['sabado'], batchId: 'b1' });
  assert.strictEqual(j.karin, 3, 'karin tem 3 datas no lote b1');
  assert.strictEqual(j.bruno, 1, 'bruno tem 1');
  const j2 = SS.contarPorPessoa(ESCALAS, { tipos: ['feriado'], batchId: 'b1' });
  assert.deepStrictEqual(j2, {}, 'o lote b1 não tem feriado');
  passou('recorta por janela (lote)');
}

// ── excluirDatas: o coração do "refazer a janela" ──
// Ao remontar, as datas que ainda carregam a escala ANTIGA não podem entrar na
// conta — senão a escala velha empurra as pessoas erradas na escala nova.
{
  const c = SS.contarPorPessoa(ESCALAS, { tipos: ['sabado'], excluirDatas: ['2026-09-19', '2026-10-17'] });
  assert.strictEqual(c.karin, 2, 'sobram 05/09 e o de 2025');
  const cSet = SS.contarPorPessoa(ESCALAS, { tipos: ['sabado'], excluirDatas: new Set(['2026-09-19']) });
  assert.strictEqual(cSet.karin, 3, 'aceita Set do mesmo jeito que array');
  passou('excluirDatas tira as datas que estão sendo remontadas');
}

// ── vaga aberta não conta ──
{
  const c = SS.contarPorPessoa([escala('2026-09-26', 'sabado', [null, null])], { tipos: ['sabado'] });
  assert.deepStrictEqual(c, {}, 'vaga sem ninguém não conta pra ninguém');
  passou('vaga aberta não conta');
}

// ── sem filtro: conta tudo; entrada vazia não estoura ──
{
  assert.deepStrictEqual(SS.contarPorPessoa([], {}), {}, 'lista vazia devolve objeto vazio');
  assert.deepStrictEqual(SS.contarPorPessoa(null, null), {}, 'null não estoura');
  passou('entrada vazia é segura');
}

// ── tiposIrmaos ──
{
  assert.deepStrictEqual(SS.tiposIrmaos('sabado'), ['sabado']);
  assert.deepStrictEqual(SS.tiposIrmaos('feriado'), ['feriado', 'domingo_especial']);
  assert.deepStrictEqual(SS.tiposIrmaos('domingo_especial'), ['feriado', 'domingo_especial']);
  passou('feriado e domingo especial contam juntos');
}

// ── contarPorPessoa expande tipos por dentro, sozinha ──
// Quem escreve o pedido natural `{ tipos: ['feriado'] }` — sem lembrar de passar
// por tiposIrmaos — não pode ficar contando errado. Isso seria a mesma
// divergência silenciosa que esta função inteira existe pra matar. A expansão
// tem que ser idempotente: pedir já-expandido dá o mesmo resultado.
{
  const comDomingoEspecial = ESCALAS.concat([
    escala('2026-12-25', 'domingo_especial', ['bruno']),
  ]);
  const pedidoCurto = SS.contarPorPessoa(comDomingoEspecial, { tipos: ['feriado'] });
  const pedidoExpandido = SS.contarPorPessoa(comDomingoEspecial, { tipos: ['feriado', 'domingo_especial'] });
  assert.deepStrictEqual(pedidoCurto, pedidoExpandido, '["feriado"] sozinho já dá o mesmo resultado que ["feriado","domingo_especial"]');
  assert.strictEqual(pedidoCurto.bruno, 2, 'bruno soma o feriado de 07/09 com o domingo especial de 25/12');
  passou('contarPorPessoa expande tipos internamente e é idempotente');
}

// ── sem filtro de tipos: tudo soma junto ──
// O ramal `tipos = null` até agora só era testado com entrada vazia. Com dados
// de verdade e sem filtro, sábado e evento da mesma pessoa têm que somar.
{
  const tudo = SS.contarPorPessoa(ESCALAS, {});
  assert.strictEqual(tudo.karin, 5, 'karin: 4 sábados (05/09, 19/09, 17/10, 06/09/2025) + 1 evento (14/11)');
  passou('sem filtro de tipos, todos os tipos contam juntos');
}

// ── descanso: quem trabalhou perto não pega a próxima ────────────────
// Rodrigo, 25/08/2026: "se o colaborador foi escalado sábado passado ou seguinte
// ao feriado em questão, preferencialmente não deverá escalado em sábados
// próximos imediatamente anterior ou posterior ao feriado".
const VIZINHAS = [
  escala('2026-09-05', 'sabado',  ['ana']),
  escala('2026-09-07', 'feriado', ['bia']),
  escala('2026-09-12', 'sabado',  ['ceu']),
  escala('2026-09-26', 'sabado',  ['dri']),
  escala('2026-09-19', 'evento',  ['edu']),
  escala('2026-09-13', 'domingo_especial', ['fef']),
];
{
  // feriado de SEGUNDA enxerga os dois sábados ao lado — o pedido do Rodrigo
  const v = SS.personsOnNearbyScale(VIZINHAS, '2026-09-07');
  assert.ok(v.has('ana'), 'quem pegou o sábado 2 dias antes conta');
  assert.ok(v.has('ceu'), 'quem pegou o sábado 5 dias depois conta');
  assert.ok(!v.has('bia'), 'a própria data não conta contra si mesma');
  assert.ok(!v.has('dri'), 'sábado a 19 dias não conta');
  passou('feriado de meio de semana enxerga os sábados vizinhos');
}
{
  // e o caminho inverso: montando o sábado, quem pegou o feriado ao lado cede
  const v = SS.personsOnNearbyScale(VIZINHAS, '2026-09-05');
  assert.ok(v.has('bia'), 'quem pegou o feriado 2 dias depois cede a vez no sábado');
  passou('sábado enxerga o feriado vizinho');
}
{
  // o comportamento antigo (sábado com sábado a ±7) segue igual
  const v = SS.personsOnNearbyScale(VIZINHAS, '2026-09-12');
  assert.ok(v.has('ana'), 'sábado anterior (7 dias) conta — comportamento de sempre');
  assert.ok(!v.has('dri'), 'sábado a 14 dias não conta');
  passou('sábado com sábado a ±7 preservado');
}
{
  // domingo especial entra igual feriado (tiposIrmaos, Task 1) — sem esta
  // asserção, apagar 'domingo_especial' do filtro de tipos em
  // personsOnNearbyScale passaria a suíte inteira em silêncio.
  const v = SS.personsOnNearbyScale(VIZINHAS, '2026-09-12');
  assert.ok(v.has('fef'), 'domingo especial vizinho (13/09, 1 dia depois) conta igual feriado');
  passou('domingo especial entra na regra do descanso');
}
{
  // evento e escola interna ficam de fora ("só pra sábado mesmo", Rafael 25/08)
  const v = SS.personsOnNearbyScale(VIZINHAS, '2026-09-26');
  assert.ok(!v.has('edu'), 'evento não entra na regra do descanso');
  passou('evento fica de fora');
}
{
  assert.strictEqual(SS.personsOnNearbyScale(VIZINHAS, null).size, 0, 'sem data devolve vazio');
  assert.strictEqual(SS.personsOnNearbyScale(null, '2026-09-05').size, 0, 'sem escalas devolve vazio');
  passou('entrada vazia é segura no descanso');
}

// ── ajuste de partida ────────────────────────────────────────────────
// Rafael, 25/08: "o que passou eles têm como ajustar manualmente?". Agosto
// aconteceu pela grade antiga e não existe em special_scales, então não há o
// que contar — só o que lançar.
(async () => {
  const makeFakeDb = require('./_fake-firestore.js');
  const SE = require('../scale-engine.js');
  const db = makeFakeDb();
  const d = { db, ts: () => 'TS', uid: () => 'tester', SE };

  const zero = await SS.getFairness('ana', d);
  assert.strictEqual(zero.data.ajuste, 0, 'sem documento, ajuste é zero');

  await SS.saveAjustePartida('ana', 3, d);
  const dep = await SS.getFairness('ana', d);
  assert.strictEqual(dep.data.ajuste, 3, 'ajuste gravado');

  await SS.saveAjustePartida('ana', -5, d);
  assert.strictEqual((await SS.getFairness('ana', d)).data.ajuste, 0, 'ajuste nunca fica negativo');

  await SS.saveAjustePartida('bru', 1, d);
  const todos = await SS.listAjustes(d);
  assert.deepStrictEqual(todos.data, { ana: 0, bru: 1 }, 'listAjustes traz todo mundo de uma vez');

  // ── o motor decide pela CONTAGEM, não pelo número guardado ──────────
  // É o cerne do conserto: remontar duas vezes tem que dar o mesmo resultado.
  {
    const slots = [
      { id: 'v1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: null },
    ];
    await SS.createScale({ date: '2026-12-05', tipo: 'sabado', name: 'Sáb 05/12', slots }, d);
    const idNovo = (await SS.listScales(d)).data.find(s => s.date === '2026-12-05').id;

    // Cida já pegou 2 sábados do ano; Duda nenhum. O rodízio tem que dar pra Duda,
    // mesmo com a Cida tendo mais mérito.
    const historico = [
      { id: 'h1', date: '2026-11-07', tipo: 'sabado', slots: [{ id: 'a', assignedPersonId: 'cida' }] },
      { id: 'h2', date: '2026-11-21', tipo: 'sabado', slots: [{ id: 'a', assignedPersonId: 'cida' }] },
    ];
    const ctx = {
      teachers: [
        { id: 'cida', modalityIds: ['TOI'], primaryUnitId: 'cp' },
        { id: 'duda', modalityIds: ['TOI'], primaryUnitId: 'cp' },
      ],
      meritoById: { cida: 99, duda: 1 },
      opts: { minMes: 1 },
      scalesDoAno: historico,
    };
    const r1 = await SS.consolidate(idNovo, ctx, d);
    assert.strictEqual(r1.success, true, 'consolidou');
    assert.strictEqual(r1.data.assignments[0].personId, 'duda', 'quem trabalhou menos no ano vem antes do mérito');

    // Reconsolidar não pode mudar a resposta — era exatamente aqui que o contador
    // antigo travava e a escala saía torta.
    ctx.scalesDoAno = historico.concat((await SS.listScales(d)).data.filter(s => s.date === '2026-12-05'));
    const r2 = await SS.consolidate(idNovo, ctx, d);
    assert.strictEqual(r2.data.assignments[0].personId, 'duda', 'remontar dá o mesmo resultado');

    // Com o ajuste de partida, a Duda passa a estar na frente na conta e cede a vez.
    ctx.ajusteById = { duda: 5 };
    ctx.scalesDoAno = historico;
    const r3 = await SS.consolidate(idNovo, ctx, d);
    assert.strictEqual(r3.data.assignments[0].personId, 'cida', 'o ajuste de partida entra na conta do motor');
    console.log('✓ o motor decide pela contagem e remontar não muda a resposta');
  }

  console.log('✓ ajuste de partida grava, lista e não fica negativo');
  console.log('\n✓ smoke-escala-contagem: todas as seções OK');
})();
