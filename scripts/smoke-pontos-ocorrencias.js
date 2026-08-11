'use strict';
// Smoke da penalidade em pontos por ocorrência de aula (bloco 2, 07/08).
// Usa o points-engine e a config REAIS.
//
// Roda: node scripts/smoke-pontos-ocorrencias.js

const assert = require('assert');
const PE = require('../points-engine.js');
const EC = require('../engagement-config.js');

const cfg = EC.mergeConfig ? EC.mergeConfig({}) : EC.DEFAULT_CONFIG;
const aula = o => Object.assign({ id: 'c1', teacherId: 'prof1', dateISO: '2026-08-10' }, o);

// ════════════ falta ════════════
{
  const e = PE.entriesFromClassOccurrences([aula({ faltaTipo: 'sem_aviso' })], cfg);
  assert.strictEqual(e.length, 1);
  assert.strictEqual(e[0].tipo, 'aula_falta_sem_aviso');
  assert.ok(e[0].pontos < 0, 'falta sem aviso tem que descontar');
  console.log(`✓ falta sem aviso: ${e[0].pontos} pontos`);

  const j = PE.entriesFromClassOccurrences([aula({ faltaTipo: 'justificada' })], cfg);
  assert.strictEqual(j[0].tipo, 'aula_falta_justificada');
  assert.ok(j[0].pontos < 0);
  console.log(`✓ falta avisada: ${j[0].pontos} pontos`);

  assert.ok(e[0].pontos < j[0].pontos,
    'sem aviso tem que doer MAIS que avisada — foi o pedido do Rodrigo');
  console.log('✓ sem aviso pesa mais que avisada');
}

// ════════════ atraso ════════════
{
  const e = PE.entriesFromClassOccurrences([aula({ atrasoMinutos: 20 })], cfg);
  assert.strictEqual(e.length, 1);
  assert.strictEqual(e[0].tipo, 'aula_atraso');
  assert.ok(e[0].pontos < 0);
  console.log(`✓ atraso: ${e[0].pontos} pontos (por ocorrência, não por minuto)`);

  // por ocorrência: 5 min e 90 min descontam igual nos pontos
  const curto = PE.entriesFromClassOccurrences([aula({ atrasoMinutos: 5 })], cfg);
  const longo = PE.entriesFromClassOccurrences([aula({ atrasoMinutos: 90 })], cfg);
  assert.strictEqual(curto[0].pontos, longo[0].pontos);
  console.log('✓ o tamanho do atraso não muda os pontos (isso é no pagamento)');
}

// ════════════ falta e atraso não se acumulam ════════════
{
  const e = PE.entriesFromClassOccurrences([aula({ faltaTipo: 'sem_aviso', atrasoMinutos: 30 })], cfg);
  assert.strictEqual(e.length, 1, 'quem faltou não leva também a de atraso');
  assert.strictEqual(e[0].tipo, 'aula_falta_sem_aviso');
  console.log('✓ quem faltou não leva punição de atraso junto');
}

// ════════════ aula normal não gera nada ════════════
{
  assert.deepStrictEqual(PE.entriesFromClassOccurrences([aula({})], cfg), []);
  assert.deepStrictEqual(PE.entriesFromClassOccurrences([aula({ horaExtraMinutos: 60 })], cfg), [],
    'hora extra não é penalidade nem bônus de ponto');
  console.log('✓ aula normal e hora extra não geram lançamento');
}

// ════════════ entrada torta não quebra ════════════
{
  assert.deepStrictEqual(PE.entriesFromClassOccurrences(null, cfg), []);
  assert.deepStrictEqual(PE.entriesFromClassOccurrences([null], cfg), []);
  assert.deepStrictEqual(PE.entriesFromClassOccurrences([{ faltaTipo: 'sem_aviso' }], cfg), [],
    'sem professor não dá pra lançar');
  assert.deepStrictEqual(PE.entriesFromClassOccurrences([aula({ dateISO: null, faltaTipo: 'sem_aviso' })], cfg), [],
    'sem data não dá pra saber o ciclo');
  console.log('✓ nulo, sem professor e sem data são ignorados');
}

// ════════════ chega no placar ════════════
{
  const ciclo = { id: '2026', inicio: '2026-01-01', fim: '2026-12-31' };
  const lanc = PE.entriesFromClassOccurrences([
    aula({ id: 'a', faltaTipo: 'sem_aviso' }),
    aula({ id: 'b', atrasoMinutos: 10 }),
  ], cfg);
  const placar = PE.scoreboard(lanc, ciclo, 0);
  assert.ok(placar.total < 0, 'as penalidades têm que baixar o total');
  assert.strictEqual(placar.total, cfg.penalidade.aulaFaltaSemAviso + cfg.penalidade.aulaAtraso);
  console.log(`✓ o placar reflete as penalidades (total ${placar.total})`);
}

console.log('\n✅ smoke-pontos-ocorrencias OK');
