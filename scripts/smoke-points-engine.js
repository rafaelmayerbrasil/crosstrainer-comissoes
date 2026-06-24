'use strict';
// Roda: node scripts/smoke-points-engine.js
const assert = require('assert');
const PE = require('../points-engine.js');
const EC = require('../engagement-config.js');
const cfg = EC.DEFAULT_CONFIG;

// tempoDeCasaPontos(admissao, ref, cfg)
assert.strictEqual(PE.tempoDeCasaPontos('2026-01-01', '2026-06-01', cfg), 10, '<1 ano = faixa 0 = 10');
assert.strictEqual(PE.tempoDeCasaPontos('2024-06-01', '2026-06-01', cfg), 20, '2 anos = faixa 1 = 20');
assert.strictEqual(PE.tempoDeCasaPontos('2023-06-01', '2026-06-01', cfg), 20, '3 anos = faixa 1 = 20');
assert.strictEqual(PE.tempoDeCasaPontos('2022-06-01', '2026-06-01', cfg), 30, '4 anos = faixa 2 = 30');
assert.strictEqual(PE.tempoDeCasaPontos(null, '2026-06-01', cfg), 0, 'sem admissão = 0');

console.log('✓ smoke-points-engine: tempo de casa OK');

// ── Ciclos ──
const cycles = [
  { id: 'c1', inicio: '2026-01-01', fim: '2026-06-30' },
  { id: 'c2', inicio: '2026-07-01', fim: '2026-12-31' },
];
assert.strictEqual(PE.cycleIdFor('2026-03-15', cycles), 'c1', 'data no 1º ciclo');
assert.strictEqual(PE.cycleIdFor('2026-07-01', cycles), 'c2', 'borda inicial inclusiva');
assert.strictEqual(PE.cycleIdFor('2026-12-31', cycles), 'c2', 'borda final inclusiva');
assert.strictEqual(PE.cycleIdFor('2025-12-31', cycles), null, 'fora de qualquer ciclo');

const entries = [
  { personId: 'p1', tipo: 'reuniao', refDate: '2026-03-01', pontos: 8 },
  { personId: 'p1', tipo: 'evento',  refDate: '2026-08-01', pontos: 8 },
];
assert.strictEqual(PE.entriesForCycle(entries, cycles[0]).length, 1, 'só 1 entry no c1');
assert.strictEqual(PE.entriesForCycle(entries, cycles[0])[0].refDate, '2026-03-01');

console.log('✓ smoke-points-engine: ciclos OK');

// ── Placar ──
const sbEntries = [
  { personId: 'p1', tipo: 'escola_interna', refDate: '2026-03-01', pontos: 1 },
  { personId: 'p1', tipo: 'escola_interna', refDate: '2026-03-02', pontos: 1 },
  { personId: 'p1', tipo: 'reuniao',        refDate: '2026-03-10', pontos: 8 },
  { personId: 'p1', tipo: 'penalidade_treino', refDate: '2026-03-20', pontos: -15 },
  { personId: 'p1', tipo: 'evento',         refDate: '2026-09-01', pontos: 8 }, // fora do ciclo
];
const sb = PE.scoreboard(sbEntries, cycles[0], 20); // 20 = tempo de casa
assert.strictEqual(sb.tempoCasa, 20);
assert.strictEqual(sb.porTipo.escola_interna, 2, 'soma 2 dias de escola interna');
assert.strictEqual(sb.porTipo.reuniao, 8);
assert.strictEqual(sb.porTipo.penalidade_treino, -15);
assert.strictEqual(sb.porTipo.evento, undefined, 'evento fora do ciclo não entra');
// total = entries do ciclo (2+8-15 = -5) + tempo de casa (20) = 15
assert.strictEqual(sb.total, 15, 'total = entries do ciclo + tempo de casa');

console.log('✓ smoke-points-engine: placar OK');

// ── Geração a partir de chamada ──
const attEscola = {
  id: 'att1', kind: 'escola_interna', date: '2026-03-05', unitId: 'unit-cp',
  records: [
    { personId: 'p1', status: 'presente', role: 'lider' },
    { personId: 'p2', status: 'presente' },
    { personId: 'p3', status: 'aluno_outro' },
  ],
};
const e1 = PE.entriesFromAttendance(attEscola, cfg);
assert.strictEqual(e1.length, 3);
assert.deepStrictEqual(e1.find(x => x.personId === 'p1'), {
  id: 'att1:p1', personId: 'p1', tipo: 'escola_interna_lider', refDate: '2026-03-05', pontos: 2, origem: 'att1',
});
assert.strictEqual(e1.find(x => x.personId === 'p2').pontos, 1);
assert.strictEqual(e1.find(x => x.personId === 'p3').tipo, 'treinar_como_aluno');

// Reunião sem confirmação da gestão → nada
const attReuSemConf = { id: 'r1', kind: 'reuniao', date: '2026-03-10', records: [{ personId: 'p1', status: 'presente' }] };
assert.strictEqual(PE.entriesFromAttendance(attReuSemConf, cfg).length, 0, 'reunião sem confirmedBy não pontua');
const attReu = { ...attReuSemConf, confirmedBy: 'admin1' };
assert.strictEqual(PE.entriesFromAttendance(attReu, cfg)[0].pontos, 8, 'reunião confirmada = 8');

// Treinamento obrigatório: presença + faltas
const attTrein = {
  id: 'tr1', kind: 'treinamento_obrigatorio', date: '2026-06-27',
  records: [
    { personId: 'p1', status: 'presente' },
    { personId: 'p2', status: 'falta_justificada' },
    { personId: 'p3', status: 'falta_sem_aviso' },
  ],
};
const e3 = PE.entriesFromAttendance(attTrein, cfg);
assert.strictEqual(e3.find(x => x.personId === 'p1').pontos, 8);
assert.strictEqual(e3.find(x => x.personId === 'p2').pontos, 0);
assert.strictEqual(e3.find(x => x.personId === 'p3').pontos, -15);
assert.strictEqual(e3.find(x => x.personId === 'p3').tipo, 'penalidade_treino');

// Idempotência: reprocessar a mesma chamada dá os mesmos ids
const again = PE.entriesFromAttendance(attEscola, cfg);
assert.deepStrictEqual(again.map(x => x.id), ['att1:p1', 'att1:p2', 'att1:p3'], 'ids estáveis');

console.log('✓ smoke-points-engine: geração por chamada OK');

// ── Proatividade (substituição) ──
const sub = PE.entryForSubstitution('sub42', 'p1', '2026-03-12', cfg);
assert.deepStrictEqual(sub, {
  id: 'sub:sub42:p1', personId: 'p1', tipo: 'proatividade_substituicao',
  refDate: '2026-03-12', pontos: 3, origem: 'sub42',
});

console.log('✓ smoke-points-engine: proatividade OK');

// ── Robustez (datas inválidas / futuras / pontos ausentes) ──
assert.strictEqual(PE.completedYears('data-invalida', '2026-06-01'), 0, 'data inválida em completedYears = 0, não NaN');
assert.strictEqual(PE.tempoDeCasaPontos('data-invalida', '2026-06-01', cfg), 0, 'admissão inválida = 0, não NaN');
assert.strictEqual(PE.tempoDeCasaPontos('2030-01-01', '2026-06-01', cfg), 0, 'admissão futura = 0');
assert.strictEqual(PE.tempoDeCasaPontos('2026-06-01', '2026-06-01', cfg), 10, 'admissão = referência ainda ganha faixa 0 = 10');

const sbSemPontos = PE.scoreboard(
  [{ personId: 'p', tipo: 'evento', refDate: '2026-03-01' }],
  { id: 'c1', inicio: '2026-01-01', fim: '2026-06-30' },
  0
);
assert.strictEqual(sbSemPontos.total, 0, 'entry sem pontos não gera NaN no total');

console.log('✓ smoke-points-engine: robustez OK');
