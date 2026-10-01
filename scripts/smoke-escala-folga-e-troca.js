'use strict';
// Roda: node scripts/smoke-escala-folga-e-troca.js
//
// Grupo da gestão, 01/10/2026. Três reclamações com a mesma raiz — a regra
// existia só na hora de MONTAR a escala, e tudo o que vinha depois passava
// calado:
//   · "Quando preenchi, coloquei lá que não podia dia 12" (Alan Brito, 12/09):
//     o motor não escala quem marcou "Não posso", mas a troca na mão põe.
//   · Vagner com 26/09 e 03/10 seguidos, e de novo em 17/10.
//   · Rafael Rojais: "uma regra de ter pelo menos duas ou três semanas de
//     distância de uma escala entre a outra".
//
// Aqui fica a parte PURA e o serviço. A tela está em
// scripts/smoke-escala-troca-avisa-tela.js.
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const SE = require('../scale-engine.js');
const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'tester', SE });

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

const vaga = (id, pid) => ({ id, unitId: 'u1', requiredModalityId: 'TOI', assignedPersonId: pid || null });
const sab = (date, pid, extra) => Object.assign({ id: 's' + date, date, tipo: 'sabado', slots: [vaga('v1', pid)] }, extra || {});

(async () => {
  /* ── 1. Folga mínima: de "sábados de folga" para dias de vizinhança ── */
  assert.strictEqual(SS.vizinhancaDias({}), 7, 'sem configuração vale o de sempre: 1 sábado de folga');
  assert.strictEqual(SS.vizinhancaDias(null), 7, 'config ausente não estoura');
  assert.strictEqual(SS.vizinhancaDias({ folgaMinimaSabados: 1 }), 7);
  assert.strictEqual(SS.vizinhancaDias({ folgaMinimaSabados: 2 }), 14);
  assert.strictEqual(SS.vizinhancaDias({ folgaMinimaSabados: 3 }), 21);
  assert.strictEqual(SS.vizinhancaDias({ folgaMinimaSabados: '2' }), 14, 'valor vindo de <select> é texto');
  [0, -1, 4, 9, 'x', 1.5].forEach(v =>
    assert.strictEqual(SS.vizinhancaDias({ folgaMinimaSabados: v }), 7, `valor fora de 1–3 (${v}) cai no padrão, não vira regra maluca`));
  passou('folga mínima vira dias de vizinhança (1→7, 2→14, 3→21), e lixo cai no padrão');

  /* ── 2. Em quais datas perto desta a pessoa já está ───────────────── */
  const historico = [
    sab('2026-09-07', 'vagner', { tipo: 'feriado' }),
    sab('2026-09-26', 'vagner'),
    sab('2026-10-03', 'vagner'),
    sab('2026-10-10', 'outro'),
    sab('2026-10-17', 'vagner'),
    { id: 'ei', date: '2026-10-01', tipo: 'escola_interna', slots: [vaga('v1', 'vagner')] },
    { id: 'ev', date: '2026-10-04', tipo: 'evento', slots: [vaga('v1', 'vagner')] },
  ];
  assert.deepStrictEqual(SS.datasVizinhasDaPessoa(historico, 'vagner', '2026-10-03', 7), ['2026-09-26'],
    '7 dias: só o sábado anterior — a própria data, Escola Interna e evento ficam de fora');
  assert.deepStrictEqual(SS.datasVizinhasDaPessoa(historico, 'vagner', '2026-10-03', 14), ['2026-09-26', '2026-10-17'],
    '14 dias: pega também o sábado dali a duas semanas');
  assert.deepStrictEqual(SS.datasVizinhasDaPessoa(historico, 'vagner', '2026-09-26', 21), ['2026-09-07', '2026-10-03', '2026-10-17'],
    '21 dias: o feriado de 07/09 (19 dias antes) entra');
  assert.deepStrictEqual(SS.datasVizinhasDaPessoa(historico, 'outro', '2026-10-03', 7), ['2026-10-10'], 'cada pessoa com as suas');
  assert.deepStrictEqual(SS.datasVizinhasDaPessoa(historico, 'ninguem', '2026-10-03', 21), []);
  assert.deepStrictEqual(SS.datasVizinhasDaPessoa(null, 'vagner', '2026-10-03', 7), [], 'sem escalas não estoura');
  assert.deepStrictEqual(SS.datasVizinhasDaPessoa(historico, 'vagner', '2026-10-03'), ['2026-09-26'], 'sem dias vale 7');
  passou('datasVizinhasDaPessoa acha as datas de escala perto, por pessoa');

  /* ── 3. O que a gestão precisa ver antes de pôr alguém numa vaga ──── */
  const dia12 = {
    id: 'd12', date: '2026-09-12', tipo: 'sabado',
    slots: [
      { id: 'pp_TOI', unitId: 'pp', requiredModalityId: 'TOI', assignedPersonId: 'joao' },
      { id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: 'carla' },
    ],
  };
  const todas = [dia12, sab('2026-09-05', 'theo'), sab('2026-09-19', 'bruno'), sab('2026-09-26', 'alan')];
  const prefById = { alan: 'nao_posso', leo: 'nao_posso', bruno: 'prefiro' };
  const sit = (pid, dias) => SS.situacaoParaTroca({ scale: dia12, slotId: 'pp_TOI', personId: pid, prefById, scales: todas, dias });

  assert.deepStrictEqual(sit('alan'), { naoPosso: true, noMesmoDia: false, vizinhas: [] },
    'Alan marcou "Não posso" — é o caso do dia 12; o 26/09 dele está a 14 dias, fora da regra de 7');
  assert.deepStrictEqual(sit('alan', 14), { naoPosso: true, noMesmoDia: false, vizinhas: ['2026-09-26'] },
    'com folga de 2 sábados o 26/09 do Alan passa a contar');
  assert.deepStrictEqual(sit('theo'), { naoPosso: false, noMesmoDia: false, vizinhas: ['2026-09-05'] }, 'trabalhou o sábado anterior');
  assert.deepStrictEqual(sit('bruno'), { naoPosso: false, noMesmoDia: false, vizinhas: ['2026-09-19'] }, 'trabalha o sábado seguinte');
  assert.deepStrictEqual(sit('carla'), { naoPosso: false, noMesmoDia: true, vizinhas: [] }, 'já está em outra vaga do dia');
  assert.deepStrictEqual(sit('joao'), { naoPosso: false, noMesmoDia: false, vizinhas: [] }, 'quem já está NESTA vaga não é conflito');
  assert.deepStrictEqual(sit('livre'), { naoPosso: false, noMesmoDia: false, vizinhas: [] });
  assert.deepStrictEqual(SS.situacaoParaTroca({ scale: dia12, slotId: 'pp_TOI', personId: null, prefById, scales: todas }),
    { naoPosso: false, noMesmoDia: false, vizinhas: [] }, 'esvaziar a vaga não tem o que avisar');
  passou('situacaoParaTroca diz quem marcou "Não posso", quem já está no dia e quem trabalha perto');

  /* ── 4. A montagem obedece a folga configurada ─────────────────────── */
  // p1 trabalhou 03/10; p2 trabalhou dois sábados antigos. Pelo rodízio p1
  // (1 dia) vem antes de p2 (2 dias) para o 17/10. Com folga de 1 sábado, o
  // 03/10 está a 14 dias e não pesa: entra p1. Com folga de 2, p1 descansa.
  const teachers = [
    { id: 'p1', name: 'Um',   modalityIds: ['TOI'], primaryUnitId: 'u1' },
    { id: 'p2', name: 'Dois', modalityIds: ['TOI'], primaryUnitId: 'u1' },
  ];
  async function montar17(folga) {
    const d = deps(makeFakeDb());
    if (folga != null) await SS.ScaleConfigService.save({ folgaMinimaSabados: folga }, d);
    const mk = async (date, pid) => (await SS.createScale({ date, tipo: 'sabado', name: date, slots: [vaga('v1', pid)] }, d)).data;
    await mk('2026-08-01', 'p2');
    await mk('2026-08-15', 'p2');
    await mk('2026-10-03', 'p1');
    const alvo = await mk('2026-10-17', null);
    const todasAsEscalas = (await SS.listScales(d)).data;
    const r = await SS.consolidate(alvo.id, { teachers, meritoById: {}, opts: { minMes: 1 }, scalesDoAno: todasAsEscalas }, d);
    assert.ok(r.success, 'consolidou: ' + r.error);
    return (await SS.getScale(alvo.id, d)).data.slots[0].assignedPersonId;
  }
  assert.strictEqual(await montar17(null), 'p1', 'sem configuração: 14 dias de distância não pesam, o rodízio manda');
  assert.strictEqual(await montar17(1), 'p1', 'folga de 1 sábado = comportamento de sempre');
  assert.strictEqual(await montar17(2), 'p2', 'folga de 2 sábados: quem trabalhou 14 dias antes cede a vez');
  passou('a montagem lê a folga de scale_config sozinha (ninguém precisa lembrar de passar)');

  /* ── 5. …mas continua preferência: nunca deixa vaga aberta ─────────── */
  {
    const d = deps(makeFakeDb());
    await SS.ScaleConfigService.save({ folgaMinimaSabados: 3 }, d);
    await SS.createScale({ date: '2026-10-03', tipo: 'sabado', name: 'a', slots: [vaga('v1', 'p1')] }, d);
    const alvo = (await SS.createScale({ date: '2026-10-10', tipo: 'sabado', name: 'b', slots: [vaga('v1', null)] }, d)).data;
    const r = await SS.consolidate(alvo.id, { teachers: [teachers[0]], meritoById: {}, opts: { minMes: 1 }, scalesDoAno: (await SS.listScales(d)).data }, d);
    assert.ok(r.success);
    assert.strictEqual((await SS.getScale(alvo.id, d)).data.slots[0].assignedPersonId, 'p1',
      'só existe p1 habilitado: entra mesmo tendo trabalhado no sábado anterior');
    passou('folga é preferência: com uma pessoa só, a vaga é preenchida assim mesmo');
  }

  /* ── 6. Troca de AULA entre professores: deixa alguém com escala colada? ── */
  // O caso do Vagner (set/out de 2026): a escala o punha em 19/09, 03/10 e
  // 17/10. O Thiago registrou "Troquei com o Vaguinho, irei trabalhar no dia
  // 19" — o Vagner assumiu o 26/09 e ficou com 26/09 e 03/10 seguidos. Nem
  // quem registrou nem a gestão que confirmou viram isso em lugar nenhum.
  {
    const escalas = [
      sab('2026-09-19', 'vagner'), sab('2026-09-26', 'thiago'),
      sab('2026-10-03', 'vagner'), sab('2026-10-17', 'vagner'),
    ];
    const troca = (extra) => SS.vizinhasDaTrocaDeAula(Object.assign(
      { scales: escalas, dateISO: '2026-09-26', titularId: 'thiago', substitutoId: 'vagner', dias: 7 }, extra || {}));
    assert.deepStrictEqual(troca(), ['2026-09-19', '2026-10-03'], 'assumindo o 26/09, o Vagner encosta no 19/09 e no 03/10');
    assert.deepStrictEqual(troca({ ignorarDatas: ['2026-09-19'] }), ['2026-10-03'],
      'se ele está SAINDO do 19/09 por outra troca, esse dia não conta — sobra o 03/10');
    assert.deepStrictEqual(troca({ dias: 21 }), ['2026-09-19', '2026-10-03', '2026-10-17'], 'folga de 3 sábados alcança o 17/10');
    assert.deepStrictEqual(troca({ dias: undefined }), ['2026-09-19', '2026-10-03'], 'sem dias vale 7');
    assert.deepStrictEqual(troca({ dateISO: '2026-09-23' }), [], 'aula de quarta-feira comum não é escala: sem aviso');
    assert.deepStrictEqual(troca({ titularId: 'outro' }), [], 'titular que não está na escala do dia: a aula não é a da escala');
    assert.deepStrictEqual(troca({ substitutoId: 'livre' }), [], 'substituto sem escala por perto: sem aviso');
    assert.deepStrictEqual(SS.vizinhasDaTrocaDeAula(null), [], 'entrada vazia não estoura');
    passou('vizinhasDaTrocaDeAula avisa quando a troca de aula cola duas escalas de quem assume');
  }

  console.log(`\n${ok} verificações ✓`);
})().catch(e => { console.error('✗', e.message); process.exit(1); });
