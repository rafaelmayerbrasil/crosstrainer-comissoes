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

console.log(`\n${ok}/1 blocos OK`);
