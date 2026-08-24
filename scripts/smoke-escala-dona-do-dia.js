'use strict';
// Roda: node scripts/smoke-escala-dona-do-dia.js
//
// "Acho que vamos ter que refazer a escala dos sábados. Pq ficou tudo errado"
// (Rodrigo, 22/08/2026). A escala estava certa. O que estava errado é que a
// GRADE normal continuava valendo no mesmo dia, e as duas apareciam juntas:
// 2 professores por modalidade no sábado, a mesma pessoa em duas modalidades,
// e a mesma pessoa em duas unidades no mesmo horário.
//
// Duas causas, as duas neste módulo:
//
//  1. O gerador procurava escala com `.where('isActive','==',true)` + `unitIds`
//     — o formato das Escalas Especiais da Sprint 5a. A Escala Inteligente,
//     feita depois, grava `status:'consolidada'` e a unidade dentro de cada
//     vaga. Em produção: 24 escalas, ZERO com isActive, ZERO com unitIds. A
//     consulta voltava vazia — pro gerador, escala nenhuma jamais existiu.
//
//  2. Mesmo enxergando, ele só usava a escala como ETIQUETA. Nunca deixou de
//     gerar a grade. Resultado: 78 aulas de segunda-feira comum agendadas em
//     cada feriado nacional (07/09 e 12/10), mais 4 por sábado. 184 aulas,
//     259 horas que entrariam no fechamento.
//
// A armadilha que este teste protege: Escola Interna e evento NÃO são donas do
// dia — acontecem além do expediente. Tratá-las como donas apagaria dias úteis
// inteiros (agosto/2026 tem 12 escolas internas em dias de semana comuns).

const assert = require('assert');
const E = require('../functions/escala-dia.js');

/* ── 1. Quem manda no dia ──────────────────────────────────────────── */
assert.strictEqual(E.ehDonaDoDia({ tipo: 'sabado' }), true, 'sábado é da escala');
assert.strictEqual(E.ehDonaDoDia({ tipo: 'feriado' }), true, 'feriado é da escala');
assert.strictEqual(E.ehDonaDoDia({ tipo: 'domingo_especial' }), true, 'domingo especial é da escala');

assert.strictEqual(E.ehDonaDoDia({ tipo: 'escola_interna' }), false,
  'escola interna acontece ALÉM do expediente — se virasse dona do dia, apagaria a grade de um dia útil');
assert.strictEqual(E.ehDonaDoDia({ tipo: 'evento' }), false, 'evento também é adicional');
assert.strictEqual(E.ehDonaDoDia({ tipo: 'fim_de_ano' }), false, 'fim de ano não foi decidido — fica de fora até alguém decidir');
assert.strictEqual(E.ehDonaDoDia(null), false, 'dia sem escala nenhuma');
assert.strictEqual(E.ehDonaDoDia({}), false, 'escala sem tipo não manda em nada');
console.log('✓ quem é dona do dia');

/* ── 2. Formato NOVO (Escala Inteligente) ──────────────────────────── */
// Cópia fiel de um documento real de produção (05/09/2026).
const nova = E.normalizarEscala('VMCsjzU3DsBJbBRk4LNQ', {
  date: '2026-09-05', tipo: 'sabado', name: 'Sábado 05/09/2026', status: 'consolidada',
  slots: [
    { unitId: 'cp', requiredModalityId: 'TOI',  assignedPersonId: 'p1' },
    { unitId: 'cp', requiredModalityId: 'HIIT', assignedPersonId: 'p2' },
    { unitId: 'pp', requiredModalityId: 'TOI',  assignedPersonId: 'p3' },
    { unitId: 'pp', requiredModalityId: 'HIIT', assignedPersonId: 'p4' },
  ],
});
assert.ok(nova, 'escala consolidada vale');
assert.strictEqual(nova.tipo, 'sabado');
assert.deepStrictEqual(nova.unidades.slice().sort(), ['cp', 'pp'],
  'as unidades saem das vagas — o formato novo não tem unitIds');
assert.strictEqual(nova.ymd, '2026-09-05', 'data em texto vira o dia certo');
console.log('✓ formato novo (status + slots[].unitId)');

/* ── 3. Formato ANTIGO (Escalas Especiais, Sprint 5a) ──────────────── */
const antiga = E.normalizarEscala('velha1', {
  date: { toDate: () => new Date(Date.UTC(2026, 8, 5, 3, 0, 0)) },  // Timestamp
  scaleTypeId: 'feriado', name: 'Sete de Setembro', isActive: true,
  unitIds: ['cp', 'pp'],
});
assert.ok(antiga, 'documento antigo continua valendo');
assert.strictEqual(antiga.tipo, 'feriado', 'scaleTypeId vira tipo');
assert.deepStrictEqual(antiga.unidades, ['cp', 'pp']);
console.log('✓ formato antigo (isActive + unitIds + Timestamp)');

/* ── 4. O que NÃO manda no dia ─────────────────────────────────────── */
assert.strictEqual(
  E.normalizarEscala('x', { date: '2026-08-08', tipo: 'sabado', status: 'rascunho', slots: [{ unitId: 'cp' }] }),
  null, 'rascunho não manda no dia — pode nem acontecer');
assert.strictEqual(
  E.normalizarEscala('x', { date: '2026-08-08', tipo: 'sabado', isActive: false, unitIds: ['cp'] }),
  null, 'escala antiga desativada não manda');
assert.strictEqual(E.normalizarEscala('x', { tipo: 'sabado', status: 'consolidada' }), null,
  'sem data não dá pra saber que dia é');
assert.strictEqual(
  E.normalizarEscala('x', { date: '2026-09-05', tipo: 'sabado', status: 'consolidada', slots: [] }),
  null, 'consolidada sem nenhuma unidade não suprime nada');
console.log('✓ rascunho, desativada e incompleta não mandam');

/* ── 5. O caso que causou o estrago ────────────────────────────────── */
// Escola interna num dia útil: existe, vale, mas NÃO pode apagar a grade.
const escolaInterna = E.normalizarEscala('ei1', {
  date: '2026-08-11', tipo: 'escola_interna', status: 'consolidada',
  slots: [{ unitId: 'cp', assignedPersonId: 'p9' }],
});
assert.ok(escolaInterna, 'a escola interna é uma escala válida');
assert.strictEqual(E.ehDonaDoDia(escolaInterna), false,
  '...mas não é dona do dia: a grade da segunda-feira continua valendo');
console.log('✓ escola interna vale sem apagar o dia útil');

/* ── 6. O mapa que o gerador consulta ──────────────────────────────── */
const mapa = E.montarMapa([
  { id: 'a', data: { date: '2026-09-05', tipo: 'sabado', status: 'consolidada', slots: [{ unitId: 'cp' }, { unitId: 'pp' }] } },
  { id: 'b', data: { date: '2026-08-11', tipo: 'escola_interna', status: 'consolidada', slots: [{ unitId: 'cp' }] } },
  { id: 'c', data: { date: '2026-08-08', tipo: 'sabado', status: 'rascunho', slots: [{ unitId: 'cp' }] } },
]);
assert.ok(mapa.get('2026-09-05_cp'), 'sábado consolidado entra no mapa');
assert.ok(mapa.get('2026-09-05_pp'), 'nas duas unidades');
assert.ok(mapa.get('2026-08-11_cp'), 'escola interna entra no mapa (pra etiquetar)');
assert.strictEqual(E.ehDonaDoDia(mapa.get('2026-08-11_cp')), false, '...mas não suprime');
assert.strictEqual(mapa.get('2026-08-08_cp'), undefined, 'rascunho não entra');
assert.strictEqual(mapa.get('2026-09-05_unidade_que_nao_existe'), undefined);
console.log('✓ mapa dia+unidade');

console.log('\n✅ smoke-escala-dona-do-dia: OK');
