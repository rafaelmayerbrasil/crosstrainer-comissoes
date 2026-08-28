'use strict';
// Roda: node scripts/smoke-escala-marco-zero.js
//
// O marco zero é a resposta do Rafael (28/08/2026) ao pedido 3 do Rodrigo:
// "ignorar o histórico de papel, contar a partir de agora". Ele é um PISO da
// janela de 12 meses móveis, não um substituto: quando 01/09/2027 chegar, os
// 12 meses já são mais restritivos e o marco para de importar sozinho.
const assert = require('assert');
const SS = require('../scale-service.js');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

// ── dataDeCorte (puro) ──
{
  assert.strictEqual(SS.dataDeCorte('2026-10-17', null), '2025-10-17',
    'sem marco zero, vale a janela de 12 meses');
  assert.strictEqual(SS.dataDeCorte('2026-10-17', '2026-09-01'), '2026-09-01',
    'marco zero mais recente que os 12 meses manda');
  assert.strictEqual(SS.dataDeCorte('2027-10-17', '2026-09-01'), '2026-10-17',
    'quando os 12 meses passam do marco, o marco para de importar sozinho');
  assert.strictEqual(SS.dataDeCorte('2026-10-17', ''), '2025-10-17',
    'marco vazio é o mesmo que não ter marco');
  passou('dataDeCorte escolhe sempre o corte mais recente dos dois');
}

const makeFakeDb = require('./_fake-firestore.js');
const SE = require('../scale-engine.js');

// ── o motor respeita o marco zero ──
(async () => {
  const db = makeFakeDb();
  const d = { db, ts: () => 'TS', uid: () => 'tester', SE };

  const vaga = (id) => ({ id, unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: null, startTime: '08:00', endTime: '12:00' });
  const nova = async (date) => (await SS.createScale({ date, tipo: 'sabado', slots: [vaga('v1')] }, d)).data.id;

  // Histórico ANTES do marco: a ana pegou 3 sábados de agosto.
  const antigas = ['2026-08-01', '2026-08-08', '2026-08-15'].map(date => ({
    id: `old_${date}`, date, tipo: 'sabado',
    slots: [{ id: 'v1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: 'ana' }],
  }));

  const teachers = [
    { id: 'ana', modalityIds: ['TOI'] },
    { id: 'bru', modalityIds: ['TOI'] },
  ];
  const ctxBase = { teachers, meritoById: { ana: 100, bru: 0 }, scalesDoAno: antigas, opts: { minMes: 1 } };

  // SEM marco zero: os 3 sábados de agosto contam, a ana está atrás no rodízio.
  const semMarco = await nova('2026-09-05');
  await SS.consolidate(semMarco, Object.assign({}, ctxBase, { marcoZero: null }), d);
  const r1 = await SS.getScale(semMarco, d);
  assert.strictEqual(r1.data.slots[0].assignedPersonId, 'bru',
    'sem marco zero, agosto conta e a ana cede a vez');
  passou('sem marco zero, o histórico anterior pesa no rodízio');

  // COM marco zero em 01/09: agosto some da conta, empatam em 0, decide o mérito.
  const comMarco = await nova('2026-09-12');
  await SS.consolidate(comMarco, Object.assign({}, ctxBase, { marcoZero: '2026-09-01' }), d);
  const r2 = await SS.getScale(comMarco, d);
  assert.strictEqual(r2.data.slots[0].assignedPersonId, 'ana',
    'com marco zero, agosto não conta: empatam em 0 e o mérito desempata');
  passou('marco zero apaga o histórico anterior para o motor');

  // Sem ctx.marcoZero, lê da config — e a config manda.
  await SS.ScaleConfigService.save({ marcoZero: '2026-09-01' }, d);
  const daConfig = await nova('2026-09-19');
  await SS.consolidate(daConfig, ctxBase, d);
  const r3 = await SS.getScale(daConfig, d);
  assert.strictEqual(r3.data.slots[0].assignedPersonId, 'ana',
    'quem não passa ctx.marcoZero recebe o valor da config, não zero');
  passou('consolidate lê o marco zero da config quando o ctx não manda');

  // Marco zero corrompido na config (ex.: um Timestamp virado string, ou
  // qualquer coisa fora de YYYY-MM-DD): cai pra null, com aviso — nunca em
  // silêncio, mas também nunca derrubando a consolidação.
  await SS.ScaleConfigService.save({ marcoZero: 'nao-e-uma-data' }, d);
  const avisos = [];
  const warnOriginal = console.warn;
  console.warn = (...args) => avisos.push(args.join(' '));
  const configInvalida = await nova('2026-09-26');
  await SS.consolidate(configInvalida, ctxBase, d);
  console.warn = warnOriginal;
  const r4 = await SS.getScale(configInvalida, d);
  assert.strictEqual(r4.data.slots[0].assignedPersonId, 'bru',
    'marco zero inválido na config é ignorado — agosto volta a contar e a ana cede a vez');
  assert.ok(avisos.some(a => /marco zero/i.test(a)),
    'e um aviso avisa que o valor configurado foi ignorado');
  passou('marco zero inválido na config cai pra null, com aviso, sem derrubar a consolidação');

  console.log(`\n${ok}/5 blocos OK`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
