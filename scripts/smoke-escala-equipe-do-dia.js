'use strict';
// Roda: node scripts/smoke-escala-equipe-do-dia.js
//
// "Como faz pra saber a unidade e quem tá escalado junto com você?" — Rodrigo,
// 31/08/2026, no grupo. A tela do professor dizia só "✓ Você está escalado":
// nem unidade, nem modalidade, nem com quem. A informação sempre existiu nos
// slots da escala; era a visão do professor que não mostrava.
//
// `equipeDoDia` é a parte pura disso: dada a escala e a pessoa, devolve onde ela
// está e quem mais trabalha no mesmo dia.

const assert = require('assert');
const SS = require('../scale-service.js');

let ok = 0;
const passou = (msg) => { console.log('✓ ' + msg); ok++; };

const vaga = (id, unitId, mod, pid, extra) => Object.assign({
  id, unitId, requiredModalityId: mod, assignedPersonId: pid || null,
  startTime: '08:00', endTime: '09:00',
}, extra || {});

const ESCALA = {
  id: 'sc1', date: '2026-09-05', tipo: 'sabado', published: true,
  slots: [
    vaga('cp_TOI',  'cp', 'TOI',  'karin'),
    vaga('cp_HIIT', 'cp', 'HIIT', 'bruno'),
    vaga('pp_TOI',  'pp', 'TOI',  'heloisa'),
    vaga('pp_HIIT', 'pp', 'HIIT', null),   // vaga aberta
  ],
};

// ── o escalado vê onde está e com quem ──
{
  const r = SS.equipeDoDia(ESCALA, 'karin');
  assert.strictEqual(r.escalado, true, 'karin está escalada');
  assert.strictEqual(r.meus.length, 1, 'karin ocupa uma vaga');
  assert.strictEqual(r.meus[0].unitId, 'cp', 'a vaga da karin é na CP');
  assert.strictEqual(r.meus[0].requiredModalityId, 'TOI', 'e é o TOI');
  assert.deepStrictEqual(r.colegas.map(s => s.assignedPersonId).sort(), ['bruno', 'heloisa'],
    'colegas são os outros escalados do dia, das duas unidades');
  assert.ok(!r.colegas.some(s => !s.assignedPersonId), 'vaga aberta não vira colega');
  passou('quem está escalado vê a própria vaga e os colegas do dia');
}

// ── quem não foi escalado ainda pode ver o time ──
{
  const r = SS.equipeDoDia(ESCALA, 'thaynara');
  assert.strictEqual(r.escalado, false, 'thaynara não está escalada');
  assert.strictEqual(r.meus.length, 0, 'sem vaga própria');
  assert.strictEqual(r.colegas.length, 3, 'mas enxerga os 3 escalados do dia');
  passou('quem não foi escalado enxerga o time do dia, sem vaga própria');
}

// ── mesma pessoa em duas vagas (acontece em fim de ano) ──
{
  const dobrada = { ...ESCALA, slots: ESCALA.slots.map(s => s.id === 'pp_TOI' ? { ...s, assignedPersonId: 'karin' } : s) };
  const r = SS.equipeDoDia(dobrada, 'karin');
  assert.strictEqual(r.meus.length, 2, 'as duas vagas dela aparecem');
  assert.strictEqual(r.colegas.length, 1, 'e ela não aparece como colega de si mesma');
  passou('pessoa em duas vagas não vira colega dela mesma');
}

// ── fim de ano: filtra pelo dia, senão mistura o período inteiro ──
{
  const fda = {
    id: 'sc2', tipo: 'fim_de_ano', published: true,
    slots: [
      vaga('d1_cp_m', 'cp', null, 'karin',   { day: '2026-12-24', shift: 'manha' }),
      vaga('d1_pp_m', 'pp', null, 'bruno',   { day: '2026-12-24', shift: 'manha' }),
      vaga('d2_cp_m', 'cp', null, 'heloisa', { day: '2026-12-26', shift: 'manha' }),
    ],
  };
  const r = SS.equipeDoDia(fda, 'karin', { day: '2026-12-24' });
  assert.strictEqual(r.escalado, true, 'karin trabalha no dia 24');
  assert.deepStrictEqual(r.colegas.map(s => s.assignedPersonId), ['bruno'], 'só o colega do MESMO dia');
  const r26 = SS.equipeDoDia(fda, 'karin', { day: '2026-12-26' });
  assert.strictEqual(r26.escalado, false, 'ela não trabalha no 26');
  assert.deepStrictEqual(r26.colegas.map(s => s.assignedPersonId), ['heloisa'], 'e o time do 26 é outro');
  passou('fim de ano: a equipe é a do dia, não a do período inteiro');
}

// ── entradas degeneradas não podem quebrar a tela do professor ──
{
  assert.deepStrictEqual(SS.equipeDoDia(null, 'karin'), { escalado: false, meus: [], colegas: [] }, 'escala nula');
  assert.deepStrictEqual(SS.equipeDoDia({ slots: null }, 'karin'), { escalado: false, meus: [], colegas: [] }, 'sem slots');
  const semPid = SS.equipeDoDia(ESCALA, null);
  assert.strictEqual(semPid.escalado, false, 'sem pessoa não há vaga própria');
  assert.strictEqual(semPid.colegas.length, 3, 'mas o time continua visível');
  passou('escala nula, sem slots ou sem pessoa não quebram');
}

console.log(`\n${ok}/${ok} verificações passaram.`);
