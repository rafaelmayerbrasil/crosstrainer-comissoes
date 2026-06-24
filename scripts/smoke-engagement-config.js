'use strict';
// Roda: node scripts/smoke-engagement-config.js
const assert = require('assert');
const EC = require('../engagement-config.js');

// 1) Defaults presentes (§4.1 do spec)
const d = EC.DEFAULT_CONFIG;
assert.strictEqual(d.pts.tempoCasaPorFaixa, 10, 'tempo de casa por faixa = 10');
assert.strictEqual(d.faixaAnos, 2, 'faixa de 2 anos');
assert.strictEqual(d.pts.escolaInternaParticipar, 1);
assert.strictEqual(d.pts.escolaInternaLiderar, 2);
assert.strictEqual(d.pts.treinarComoAlunoEmOutro, 1);
assert.strictEqual(d.pts.toiComoAluno, 1);
assert.strictEqual(d.pts.reuniaoStaff, 8);
assert.strictEqual(d.pts.proatividadeSubstituicao, 3);
assert.strictEqual(d.pts.eventoInterno, 8);
assert.strictEqual(d.pts.treinamentoObrigatorioPresenca, 8);
assert.strictEqual(d.tetoMensalItensDiarios, null, 'teto desligado por padrão');
assert.strictEqual(d.penalidade.treinoFaltaJustificada, 0);
assert.strictEqual(d.penalidade.treinoFaltaSemAviso, -15);

// 2) mergeConfig sobrepõe só o que veio, mantém o resto (deep nos blocos pts/penalidade)
const m = EC.mergeConfig({ pts: { reuniaoStaff: 12 }, penalidade: { treinoFaltaSemAviso: -30 } });
assert.strictEqual(m.pts.reuniaoStaff, 12, 'override aplicado');
assert.strictEqual(m.pts.escolaInternaParticipar, 1, 'demais pts preservados');
assert.strictEqual(m.penalidade.treinoFaltaSemAviso, -30, 'override penalidade');
assert.strictEqual(m.penalidade.treinoFaltaJustificada, 0, 'demais penalidades preservadas');

// 3) mergeConfig() sem args = defaults; não muta DEFAULT_CONFIG
const base = EC.mergeConfig();
assert.strictEqual(base.pts.reuniaoStaff, 8);
EC.mergeConfig({ pts: { reuniaoStaff: 99 } });
assert.strictEqual(EC.DEFAULT_CONFIG.pts.reuniaoStaff, 8, 'DEFAULT_CONFIG imutável');

console.log('✓ smoke-engagement-config: todos os casos passaram');
