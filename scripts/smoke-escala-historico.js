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

  console.log(`\n${ok}/5 blocos OK`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
