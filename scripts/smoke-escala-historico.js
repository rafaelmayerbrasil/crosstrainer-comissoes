'use strict';
// Roda: node scripts/smoke-escala-historico.js
//
// Pedido 6 do Rodrigo (28/08/2026): "log de alteração por usuário". Hoje só a
// troca de vaga grava algo; consolidar, refazer, publicar, despublicar, inverter
// e tirar do lote não deixam rastro nenhum. E o pouco que é gravado não aparece:
// `audit_log` é read-only-Admin e a tela de Auditoria filtra por unidade.
// Por isso o histórico mora DENTRO do documento da escala.
const assert = require('assert');
// Usado pelo bloco assíncrono de integração da Task 9 (registrarHistorico
// contra um banco de verdade) — nesta tarefa só os helpers puros são
// testados, então o require fica sem uso local por enquanto.
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

console.log(`\n${ok}/2 blocos OK`);
