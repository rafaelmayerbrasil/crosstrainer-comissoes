'use strict';
// Roda: node scripts/smoke-escala-historico.js
//
// Pedido 6 do Rodrigo (28/08/2026): "log de alteração por usuário". Hoje só a
// troca de vaga grava algo; consolidar, refazer, publicar, despublicar, inverter
// e tirar do lote não deixam rastro nenhum. E o pouco que é gravado não aparece:
// `audit_log` é read-only-Admin e a tela de Auditoria filtra por unidade.
// Por isso o histórico mora DENTRO do documento da escala.
const assert = require('assert');
// Banco fake p/ o bloco assíncrono de integração (registrarHistorico
// pendurado nas ações do serviço, contra um Firestore de mentira).
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

// ── appendHistorico (puro) ──
{
  const e = (n) => ({ ts: `2026-08-28T00:00:0${n}.000Z`, uid: 'u', nome: 'Rodrigo', acao: 'publicada', detalhe: `#${n}` });
  let l = SS.appendHistorico(null, e(1), 3);
  assert.strictEqual(l.length, 1, 'lista vazia aceita a primeira entrada');
  l = SS.appendHistorico(l, e(2), 3);
  l = SS.appendHistorico(l, e(3), 3);
  l = SS.appendHistorico(l, e(4), 3);
  assert.strictEqual(l.length, 3, 'o cap corta a lista');
  assert.deepStrictEqual(l.map(x => x.detalhe), ['#2', '#3', '#4'], 'a mais VELHA é a que sai');
  // Sem `max`: usa o default HISTORICO_MAX=50 — trava pra não regredir em
  // silêncio se alguém tirar o `|| HISTORICO_MAX` do meio do caminho.
  let semMax = null;
  for (let i = 1; i <= 55; i++) semMax = SS.appendHistorico(semMax, e(i));
  assert.strictEqual(semMax.length, 50, 'sem max explícito, o default é 50');
  passou('appendHistorico acumula e corta pelas mais velhas');
}

// ── diffEscalados (puro) ──
{
  const nomes = { hel: 'Heloísa', car: 'Carla', bru: 'Bruno' };
  const antes = [
    { id: 'cp_TOI', unitId: 'cp', requiredModalityName: 'TOI', assignedPersonId: 'hel' },
    { id: 'cp_HIIT', unitId: 'cp', requiredModalityName: 'Hiit', assignedPersonId: 'bru' },
  ];
  const depois = [
    { id: 'cp_TOI', unitId: 'cp', requiredModalityName: 'TOI', assignedPersonId: 'car' },
    { id: 'cp_HIIT', unitId: 'cp', requiredModalityName: 'Hiit', assignedPersonId: 'bru' },
  ];
  assert.strictEqual(SS.diffEscalados(antes, depois, nomes),
    'saiu Heloísa, entrou Carla (TOI)', 'diz quem saiu e quem entrou, por nome');
  assert.strictEqual(SS.diffEscalados(antes, antes, nomes), 'nada mudou',
    'sem mudança, diz que nada mudou');
  const vazia = [{ id: 'cp_TOI', unitId: 'cp', requiredModalityName: 'TOI', assignedPersonId: null }];
  assert.strictEqual(SS.diffEscalados(vazia, antes.slice(0, 1), nomes),
    'entrou Heloísa (TOI)', 'vaga que estava aberta só registra quem entrou');

  // Vaga sem requiredModalityName: frase sai sem o "(MOD)" no fim.
  const semModalidade = [
    { id: 'cp_X', unitId: 'cp', assignedPersonId: 'hel' },
  ];
  const semModalidadeDepois = [
    { id: 'cp_X', unitId: 'cp', assignedPersonId: 'car' },
  ];
  assert.strictEqual(SS.diffEscalados(semModalidade, semModalidadeDepois, nomes),
    'saiu Heloísa, entrou Carla', 'sem requiredModalityName, a frase não ganha "(MOD)"');

  // nomePorId vazio/ausente: cai no id cru em vez de quebrar.
  assert.strictEqual(SS.diffEscalados(antes, depois, {}),
    'saiu hel, entrou car (TOI)', 'nomePorId vazio cai no id cru');
  assert.strictEqual(SS.diffEscalados(antes, depois),
    'saiu hel, entrou car (TOI)', 'nomePorId ausente também cai no id cru');

  passou('diffEscalados descreve a mudança por nome');
}

// ── as ações do serviço deixam rastro (integração, banco fake) ──
const SE = require('../scale-engine.js');

(async () => {
  const db = makeFakeDb();
  const d = { db, ts: () => 'TS', uid: () => 'tester', nome: () => 'Rodrigo Gestor', SE };
  const slots = [{ id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'TOI', requiredModalityName: 'TOI', assignedPersonId: null, startTime: '08:00', endTime: '12:00' }];
  const id = (await SS.createScale({ date: '2026-09-05', tipo: 'sabado', slots }, d)).data.id;

  await SS.openElection(id, null, d);
  await SS.consolidate(id, { teachers: [{ id: 'ana', modalityIds: ['TOI'] }], meritoById: { ana: 1 }, scalesDoAno: [], marcoZero: null, opts: { minMes: 1 } }, d);
  await SS.publishToAgenda(id, d);
  await SS.reassignSlot(id, 'cp_TOI', 'bru', d);
  await SS.unpublishFromAgenda(id, d);

  // E o refazer se identifica como refazer, não como uma montagem qualquer.
  await SS.consolidate(id, { teachers: [{ id: 'ana', modalityIds: ['TOI'] }], meritoById: { ana: 1 }, scalesDoAno: [], marcoZero: null, opts: { minMes: 1 }, acaoHistorico: 'refeita' }, d);

  const h = (await SS.getScale(id, d)).data.historico || [];
  const acoes = h.map(x => x.acao);
  assert.deepStrictEqual(acoes, ['janela_aberta', 'consolidada', 'publicada', 'vaga_trocada', 'despublicada', 'refeita'],
    'as seis ações gravam, na ordem em que aconteceram, e refazer não se confunde com montar');
  assert.ok(h.every(x => typeof x.ts === 'string' && x.ts.length >= 20), 'toda entrada tem carimbo ISO');
  assert.ok(h.every(x => x.uid === 'tester'), 'toda entrada diz quem fez');
  // Sem isto a tela mostra o uid cru do Firebase como autor — e um
  // `AbCdEf123456` no lugar do nome não responde "quem mexeu?" pra ninguém.
  assert.ok(h.every(x => x.nome === 'Rodrigo Gestor'), 'toda entrada diz o NOME de quem fez, não só o uid');
  assert.ok(/bru|entrou/.test(h[3].detalhe), 'a troca de vaga diz o que mudou');
  // A frase mais informativa das sete (quem ENTROU, não só quantas vagas
  // mexeram) tem que aparecer na consolidação normal, não só na troca manual.
  assert.ok(/entrou/.test(h[1].detalhe), 'a consolidação diz quem entrou, via diffEscalados');
  passou('as ações do serviço deixam rastro no documento da escala');

  // ── swapSlots deixa rastro real (execução, não só leitura do texto) ──
  // Precisa de DUAS vagas já preenchidas na MESMA escala — a escala principal
  // acima só tem uma. Escala à parte, com as duas vagas já atribuídas na
  // criação (não depende de consolidate pra isso).
  const slots2 = [
    { id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'TOI', requiredModalityName: 'TOI', assignedPersonId: 'ana', startTime: '08:00', endTime: '12:00' },
    { id: 'cp_HIIT', unitId: 'cp', requiredModalityId: 'HIIT', requiredModalityName: 'Hiit', assignedPersonId: 'bru', startTime: '08:00', endTime: '12:00' },
  ];
  const id2 = (await SS.createScale({ date: '2026-09-12', tipo: 'sabado', slots: slots2 }, d)).data.id;
  await SS.swapSlots(id2, 'cp_TOI', 'cp_HIIT', d);
  const h2 = (await SS.getScale(id2, d)).data.historico || [];
  assert.strictEqual(h2.length, 1, 'swapSlots grava a entrada dele');
  assert.strictEqual(h2[0].acao, 'invertida', 'swapSlots grava "invertida"');
  assert.ok(/entrou|saiu/.test(h2[0].detalhe), 'swapSlots diz quem trocou, via diffEscalados (não "A ⇄ B" na mão)');
  passou('swapSlots deixa rastro real no histórico');

  // ── consolidateByDay deixa rastro real (execução, não só leitura do texto) ──
  // Mesmo formato de fixture que smoke-scale-service.js usa pro fim de ano:
  // templateSlotsFimDeAno + tipo 'fim_de_ano'.
  const feSlots = SS.templateSlotsFimDeAno({ start: '2026-12-24', end: '2026-12-24', closedDays: [] }, [{ id: 'cp' }]);
  const id3 = (await SS.createScale({ date: '2026-12-24', tipo: 'fim_de_ano', name: 'Fim de ano teste', slots: feSlots }, d)).data.id;
  const feCtx = { teachers: [{ id: 'p1', modalityIds: [] }, { id: 'p2', modalityIds: [] }] };
  await SS.consolidateByDay(id3, feCtx, d);
  const h3 = (await SS.getScale(id3, d)).data.historico || [];
  assert.strictEqual(h3.length, 1, 'consolidateByDay grava a entrada dele');
  assert.strictEqual(h3[0].acao, 'consolidada', 'consolidateByDay grava "consolidada"');
  assert.ok(/entrou/.test(h3[0].detalhe), 'consolidateByDay diz quem entrou, não só quantos');
  passou('consolidateByDay deixa rastro real no histórico, com quem entrou');

  // ── tirar do lote (pedido 7b) ──
  const id4 = (await SS.createScale({ date: '2026-11-20', tipo: 'feriado', slots }, d)).data.id;
  await SS.openElection(id4, { batchId: 'b_nov' }, d);
  await SS.reassignSlot(id4, 'cp_TOI', 'ana', d);
  const outRes = await SS.removeFromBatch(id4, d);
  assert.ok(outRes.success, 'tirou do lote');
  const s4 = (await SS.getScale(id4, d)).data;
  assert.strictEqual(s4.windowBatchId, null, 'saiu do lote');
  assert.strictEqual(s4.status, 'rascunho', 'voltou pra rascunho');
  assert.strictEqual(s4.slots[0].assignedPersonId, null, 'as vagas foram limpas');
  assert.ok((s4.historico || []).some(h => h.acao === 'tirada_do_lote'), 'ficou registrado');
  passou('removeFromBatch limpa a data e deixa rastro');

  // ── aplicar rebalanceio ──
  const slots2b = [
    { id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'TOI', requiredModalityName: 'TOI', assignedPersonId: null, startTime: '08:00', endTime: '12:00' },
  ];
  const idR = (await SS.createScale({ date: '2026-12-05', tipo: 'sabado', slots: slots2b }, d)).data.id;
  await SS.reassignSlot(idR, 'cp_TOI', 'hel', d);
  const aplRes = await SS.aplicarRebalanceamento({
    pessoaId: 'hel',
    movimentos: [{ scaleId: idR, date: '2026-12-05', published: false, slotId: 'cp_TOI', unitId: 'cp', saiId: 'hel', entraId: 'car' }],
    nomePorId: { hel: 'Heloísa', car: 'Carla' },
    de: 1, para: 0,
  }, d);
  assert.ok(aplRes.success, 'aplicou');
  assert.strictEqual(aplRes.data.aplicados, 1, 'um movimento aplicado');
  const sR = (await SS.getScale(idR, d)).data;
  assert.strictEqual(sR.slots[0].assignedPersonId, 'car', 'a vaga mudou de dono');
  const hr = (sR.historico || []).filter(h => h.acao === 'rebalanceada');
  assert.strictEqual(hr.length, 1, 'gravou uma linha de rebalanceio');
  assert.ok(/Heloísa/.test(hr[0].detalhe) && /Carla/.test(hr[0].detalhe), 'com os dois nomes');
  passou('aplicarRebalanceamento move a vaga e registra por nome');

  // ── aplicarRebalanceamento: data PUBLICADA é republicada e entra no aviso ──
  // Decisão do Rafael (28/08): mexer em data publicada é permitido, mas nunca
  // em silêncio. Sem republicar, a agenda ficaria com a AULA do professor
  // antigo enquanto a escala já mostra o novo dono — a mesma divergência
  // silenciosa que o Reconsolidar tinha antes de 25/08.
  const slotsPub = [
    { id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'TOI', requiredModalityName: 'TOI', assignedPersonId: 'ana', startTime: '08:00', endTime: '12:00' },
  ];
  const classesDoScale = async (scaleId) =>
    (await db.collection('classes').where('specialScaleId', '==', scaleId).get()).docs.map(dd => dd.data());
  const idPub = (await SS.createScale({ date: '2026-12-12', tipo: 'sabado', slots: slotsPub }, d)).data.id;
  await SS.publishToAgenda(idPub, d);
  const antesPub = await classesDoScale(idPub);
  assert.strictEqual(antesPub.length, 1, 'publicou 1 aula');
  assert.strictEqual(antesPub[0].teacherId, 'ana', 'a aula nasceu com a Ana');

  const aplPub = await SS.aplicarRebalanceamento({
    pessoaId: 'ana',
    movimentos: [{ scaleId: idPub, date: '2026-12-12', published: true, slotId: 'cp_TOI', unitId: 'cp', saiId: 'ana', entraId: 'bru' }],
    nomePorId: { ana: 'Ana', bru: 'Bruno' },
    de: 1, para: 0,
  }, d);
  assert.ok(aplPub.success, 'aplicou em data publicada');
  assert.strictEqual(aplPub.data.republicadas, 1, 'republicou a escala publicada');
  assert.strictEqual(aplPub.data.avisar.length, 1, 'devolveu quem precisa ser avisado');
  const depoisPub = await classesDoScale(idPub);
  assert.strictEqual(depoisPub.length, 1, 'ainda 1 aula (republicar não duplica)');
  assert.strictEqual(depoisPub[0].teacherId, 'bru', 'a agenda foi republicada com o novo dono — não fica divergente');
  passou('data publicada é republicada na agenda e volta na lista de avisar');

  // ── aplicarRebalanceamento: plano vazio não faz nada ──
  const idVazio = (await SS.createScale({ date: '2026-12-19', tipo: 'sabado', slots: slots2b }, d)).data.id;
  const aplVazio = await SS.aplicarRebalanceamento({ pessoaId: 'hel', movimentos: [], nomePorId: {}, de: 0, para: 0 }, d);
  assert.ok(aplVazio.success && aplVazio.data.aplicados === 0, 'plano vazio não erra e não aplica nada');
  const sVazio = (await SS.getScale(idVazio, d)).data;
  assert.strictEqual((sVazio.historico || []).length, 0, 'nenhuma linha de histórico nasceu do nada');
  passou('plano vazio não faz nada');

  // ── aplicarRebalanceamento: erro no meio não deixa estado pela metade ──
  // Duas escalas no mesmo lote: a 2ª tem um movimento IMPOSSÍVEL (entraId já
  // ocupa outra vaga da mesma escala — a mesma trava que reassignSlot já
  // aplica sozinho). A 1ª tem que aplicar normalmente; a 2ª tem que falhar
  // SEM mudar a vaga dela, e a resposta tem que dizer que algo falhou.
  const idOk = (await SS.createScale({ date: '2026-12-26', tipo: 'sabado', slots: slots2b }, d)).data.id;
  await SS.reassignSlot(idOk, 'cp_TOI', 'hel', d);
  const slotsConflito = [
    { id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'TOI', requiredModalityName: 'TOI', assignedPersonId: 'hel', startTime: '08:00', endTime: '12:00' },
    { id: 'cp_HIIT', unitId: 'cp', requiredModalityId: 'HIIT', requiredModalityName: 'Hiit', assignedPersonId: 'car', startTime: '08:00', endTime: '12:00' },
  ];
  const idConflito = (await SS.createScale({ date: '2027-01-02', tipo: 'sabado', slots: slotsConflito }, d)).data.id;
  const aplMisto = await SS.aplicarRebalanceamento({
    pessoaId: 'hel',
    movimentos: [
      { scaleId: idOk, date: '2026-12-26', published: false, slotId: 'cp_TOI', unitId: 'cp', saiId: 'hel', entraId: 'ana' },
      // 'car' já está em cp_HIIT desta MESMA escala — reassignSlot recusa.
      { scaleId: idConflito, date: '2027-01-02', published: false, slotId: 'cp_TOI', unitId: 'cp', saiId: 'hel', entraId: 'car' },
    ],
    nomePorId: { hel: 'Heloísa', ana: 'Ana', car: 'Carla' },
    de: 2, para: 0,
  }, d);
  assert.strictEqual(aplMisto.success, false, 'o lote com uma falha reporta falha, não sucesso silencioso');
  assert.strictEqual(aplMisto.data.aplicados, 1, 'só o movimento válido foi aplicado');
  assert.ok(/2027-01-02/.test(aplMisto.error || ''), 'o erro identifica a data que falhou');
  const sOk = (await SS.getScale(idOk, d)).data;
  assert.strictEqual(sOk.slots[0].assignedPersonId, 'ana', 'a escala válida foi mesmo alterada');
  const sConflito = (await SS.getScale(idConflito, d)).data;
  assert.strictEqual(sConflito.slots[0].assignedPersonId, 'hel', 'a escala que falhou NÃO mudou — sem estado pela metade');
  assert.strictEqual((sConflito.historico || []).filter(h => h.acao === 'rebalanceada').length, 0,
    'e não gravou histórico de uma troca que não aconteceu');
  passou('erro no meio de um lote não deixa estado pela metade');

  // ── mês fechado: a agenda NÃO muda, então não pode dizer que mudou ────────
  // `publishToAgenda` conta aula congelada em `jaCongelados` e devolve sucesso.
  // Sem checar isso, a escala mudava, a agenda ficava com o professor ANTIGO e
  // ainda avisávamos as duas pessoas de uma troca inexistente — o mesmo defeito
  // do Reconsolidar (25/08), que deixou escala e agenda divergentes em silêncio.
  {
    const idFec = (await SS.createScale({ date: '2027-02-06', tipo: 'sabado', slots: [
      { id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'TOI', requiredModalityName: 'TOI', assignedPersonId: 'hel', startTime: '08:00', endTime: '12:00' },
    ] }, d)).data.id;
    await SS.publishToAgenda(idFec, d);
    // congela a aula, como um fechamento mensal faria
    const cls = await db.collection('classes').where('specialScaleId', '==', idFec).get();
    for (const c of cls.docs) await db.collection('classes').doc(c.id).set({ monthClosingId: 'fech_2027_02' }, { merge: true });

    const r = await SS.aplicarRebalanceamento({
      pessoaId: 'hel', de: 2, para: 1, nomePorId: { hel: 'Heloísa', car: 'Carla' },
      movimentos: [{ scaleId: idFec, date: '2027-02-06', published: true, slotId: 'cp_TOI', saiId: 'hel', entraId: 'car', modalidade: 'TOI' }],
    }, d);
    assert.strictEqual(r.success, false, 'mês fechado não pode voltar sucesso');
    assert.ok(/mês fechado/.test(r.error || ''), 'e o erro diz o motivo, em português');
    assert.deepStrictEqual(r.data.avisar, [], 'ninguém é avisado de uma troca que a agenda não recebeu');
    passou('mês fechado não vira sucesso silencioso nem aviso falso');
  }

  // ── replay do mesmo plano não é evento novo ──────────────────────────────
  {
    const idRep = (await SS.createScale({ date: '2027-03-06', tipo: 'sabado', slots: [
      { id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'TOI', requiredModalityName: 'TOI', assignedPersonId: 'hel', startTime: '08:00', endTime: '12:00' },
    ] }, d)).data.id;
    const plano = { pessoaId: 'hel', de: 2, para: 1, nomePorId: { hel: 'Heloísa', car: 'Carla' },
      movimentos: [{ scaleId: idRep, date: '2027-03-06', published: false, slotId: 'cp_TOI', saiId: 'hel', entraId: 'car', modalidade: 'TOI' }] };
    await SS.aplicarRebalanceamento(plano, d);
    const r2 = await SS.aplicarRebalanceamento(plano, d);
    const hRep = (await SS.getScale(idRep, d)).data.historico || [];
    assert.strictEqual(hRep.filter(x => x.acao === 'rebalanceada').length, 1, 'reaplicar o mesmo plano não grava histórico de novo');
    assert.strictEqual(r2.data.aplicados, 0, 'e não conta como movimento aplicado');
    // Uma linha por vaga movida, não duas: 'rebalanceada' já diz "saiu X, entrou Y".
    assert.strictEqual(hRep.filter(x => x.acao === 'vaga_trocada').length, 0,
      'o rebalanceio não duplica a linha do histórico com vaga_trocada');
    passou('replay do mesmo plano é no-op, e o histórico não vem duplicado');
  }

  // ── aula já realizada trava a republicação ───────────────────────────────
  // `publishToAgenda` apaga e recria TODAS as aulas do documento. No fim de ano
  // o período inteiro divide um `scaleId`: ajustar uma pessoa num dia jogaria
  // fora a aula já dada de OUTRO dia — 'realizada' voltaria a 'prevista', e a
  // presença iria junto. A regra de operação de 25/08 virou trava aqui.
  {
    const idReal = (await SS.createScale({ date: '2027-04-03', tipo: 'sabado', slots: [
      { id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'TOI', requiredModalityName: 'TOI', assignedPersonId: 'hel', startTime: '08:00', endTime: '12:00' },
    ] }, d)).data.id;
    await SS.publishToAgenda(idReal, d);
    const cls = await db.collection('classes').where('specialScaleId', '==', idReal).get();
    for (const c of cls.docs) await db.collection('classes').doc(c.id).set({ status: 'realizada' }, { merge: true });

    const r = await SS.aplicarRebalanceamento({
      pessoaId: 'hel', de: 2, para: 1, nomePorId: { hel: 'Heloísa', car: 'Carla' },
      movimentos: [{ scaleId: idReal, date: '2027-04-03', published: true, slotId: 'cp_TOI', saiId: 'hel', entraId: 'car', modalidade: 'TOI' }],
    }, d);
    assert.strictEqual(r.success, false, 'aula já dada não pode ser apagada por um rebalanceio');
    assert.ok(/já realizada/.test(r.error || ''), 'e o erro diz o motivo em português');
    const depois = await db.collection('classes').where('specialScaleId', '==', idReal).get();
    assert.strictEqual(depois.docs[0].data().status, 'realizada', 'a aula continua realizada — não voltou pra prevista');
    assert.deepStrictEqual(r.data.avisar, [], 'e ninguém é avisado de uma troca que não valeu');
    passou('aula já realizada trava a republicação em vez de ser apagada em silêncio');
  }

  console.log(`\n${ok}/13 blocos OK`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
