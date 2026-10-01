'use strict';
// Roda: node scripts/smoke-escala-texto-whatsapp.js
//
// Rafael Rojais, áudio no grupo da gestão, 01/10/2026: "Talvez ajudaria se ele
// emitisse uma mensagem, um relatório, dos dias de cada um na escala dos finais
// de semana. Uma coisa mais fácil de ver, como se fosse uma mensagem do
// WhatsApp. Daí a gente mandava no grupo e, se tivesse alguma coisa errada,
// eles já iam falar."
//
// O texto é montado por função PURA — a tela só escolhe o mês e copia.
const assert = require('assert');
const SS = require('../scale-service.js');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

const nomePorId = {
  bc: 'BRUNO CLAUDINO', bo: 'BRUNO OTHERO', he: 'HELOÍSA MAYUMI', va: 'VAGNER TEIXEIRA DE LIMA',
  th: 'THAYNARA SILVA', jv: 'JOAO VITOR PEREIRA DE SOUZA', al: 'ALAN BRITO', le: 'LEONARDO SILVEIRA',
  ka: 'KARIN KOVALSKI DE SOUZA', lo: 'LOUISE GABRIELLE ALFEU DOS ANJOS',
};
const unidadePorId = { cp: 'CrossTainer Campeche', pp: 'CrossTainer Príncipe' };
const v = (unitId, mod, pid, extra) => Object.assign(
  { id: `${unitId}_${mod}`, unitId, requiredModalityName: mod, assignedPersonId: pid, startTime: '08:00', endTime: '12:00' }, extra || {});
const escala = (date, tipo, pessoas, extra) => Object.assign({
  id: 'e' + date, date, tipo, published: true,
  slots: [v('cp', 'TOI', pessoas[0]), v('cp', 'Hiit', pessoas[1]), v('pp', 'TOI', pessoas[2]), v('pp', 'Hiit', pessoas[3])],
}, extra || {});

const outubro = [
  escala('2026-10-12', 'feriado', ['le', 'bo', 'al', 'ka']),   // fora de ordem de propósito
  escala('2026-10-03', 'sabado', ['bc', 'he', 'va', 'th']),
];
const opts = (formato) => ({ formato, titulo: 'ESCALA DE OUTUBRO', nomePorId, unidadePorId });

/* ── 1. Por dia ─────────────────────────────────────────────────────── */
assert.strictEqual(SS.textoParaWhatsApp(outubro, opts('dia')), [
  '*ESCALA DE OUTUBRO · CrossTainer*',
  '',
  '*Sáb 03/10* · 08:00–12:00',
  'Campeche: Bruno Claudino (TOI) e Heloísa Mayumi (Hiit)',
  'Príncipe: Vagner Teixeira (TOI) e Thaynara Silva (Hiit)',
  '',
  '*Seg 12/10* · feriado · 08:00–12:00',
  'Campeche: Leonardo Silveira (TOI) e Bruno Othero (Hiit)',
  'Príncipe: Alan Brito (TOI) e Karin Kovalski (Hiit)',
  '',
  'Algo errado? Avise a gestão e registre a troca no sistema.',
].join('\n'));
passou('por dia: datas em ordem, unidade sem "CrossTainer", nome curto, modalidade e horário');

/* ── 2. Por pessoa ──────────────────────────────────────────────────── */
const comRepeticao = outubro.concat([escala('2026-10-17', 'sabado', ['al', 'bo', 'va', 'th'])]);
assert.strictEqual(SS.textoParaWhatsApp(comRepeticao, opts('pessoa')), [
  '*ESCALA DE OUTUBRO · CrossTainer*',
  '_Quem trabalha em quais dias_',
  '',
  '*Alan Brito*: seg 12/10 (feriado) Príncipe · sáb 17/10 Campeche',
  '*Bruno Claudino*: sáb 03/10 Campeche',
  '*Bruno Othero*: seg 12/10 (feriado) Campeche · sáb 17/10 Campeche',
  '*Heloísa Mayumi*: sáb 03/10 Campeche',
  '*Karin Kovalski*: seg 12/10 (feriado) Príncipe',
  '*Leonardo Silveira*: seg 12/10 (feriado) Campeche',
  '*Thaynara Silva*: sáb 03/10 Príncipe · sáb 17/10 Príncipe',
  '*Vagner Teixeira*: sáb 03/10 Príncipe · sáb 17/10 Príncipe',
  '',
  'Todos os dias das 08:00 às 12:00.',
  'Algo errado? Avise a gestão e registre a troca no sistema.',
].join('\n'));
passou('por pessoa: ordem alfabética, os dias de cada um em ordem, horário único vai pro rodapé');

/* ── 3. Vaga aberta aparece — sumir com ela esconderia o buraco ────── */
const comBuraco = [escala('2026-10-24', 'sabado', ['jv', null, 'bc', 'bo'])];
const dia = SS.textoParaWhatsApp(comBuraco, opts('dia'));
assert.ok(dia.includes('Campeche: Joao Vitor (TOI) e vaga aberta (Hiit)'), 'por dia mostra a vaga aberta:\n' + dia);
const pes = SS.textoParaWhatsApp(comBuraco, opts('pessoa'));
assert.ok(pes.includes('Vagas abertas: sáb 24/10 Campeche (Hiit)'), 'por pessoa lista as vagas abertas:\n' + pes);
passou('vaga aberta entra no texto nos dois formatos');

/* ── 4. Só sábado, feriado e domingo especial ───────────────────────── */
const misturado = outubro.concat([
  { id: 'ei', date: '2026-10-05', tipo: 'escola_interna', slots: [v('pp', 'TOI', 'bc')] },
  { id: 'ev', date: '2026-10-06', tipo: 'evento', slots: [v('pp', 'TOI', 'bc')] },
  { id: 'fa', date: '2026-10-07', tipo: 'fim_de_ano', slots: [v('pp', 'TOI', 'bc', { day: '2026-12-24' })] },
]);
assert.strictEqual(SS.textoParaWhatsApp(misturado, opts('dia')), SS.textoParaWhatsApp(outubro, opts('dia')),
  'Escola Interna, evento e fim de ano não entram neste texto');
passou('Escola Interna, evento e fim de ano ficam de fora');

/* ── 5. Dois nomes curtos iguais → os dois saem com o nome inteiro ─── */
const gemeos = [escala('2026-10-31', 'sabado', ['a1', 'a2', 'bc', 'bo'])];
const txt = SS.textoParaWhatsApp(gemeos, { formato: 'dia', titulo: 'T',
  nomePorId: Object.assign({}, nomePorId, { a1: 'ANA SILVA COSTA', a2: 'ANA SILVA PRADO' }), unidadePorId });
assert.ok(txt.includes('Ana Silva Costa (TOI) e Ana Silva Prado (Hiit)'), 'nome curto repetido não pode esconder quem é quem:\n' + txt);
passou('nomes curtos que colidem saem por extenso');

/* ── 6. Horários diferentes no mesmo dia aparecem por pessoa ───────── */
const quebrado = [{ id: 'q', date: '2026-10-10', tipo: 'sabado', slots: [
  v('cp', 'TOI', 'bc'), v('cp', 'Hiit', 'he', { startTime: '09:00', endTime: '11:00' }),
] }];
const tq = SS.textoParaWhatsApp(quebrado, opts('dia'));
assert.ok(tq.includes('*Sáb 10/10*\n'), 'sem horário único, a linha da data não inventa um:\n' + tq);
assert.ok(tq.includes('Bruno Claudino (TOI, 08:00–12:00) e Heloísa Mayumi (Hiit, 09:00–11:00)'), tq);
const tp = SS.textoParaWhatsApp(quebrado, opts('pessoa'));
assert.ok(tp.includes('*Heloísa Mayumi*: sáb 10/10 Campeche 09:00–11:00'), tp);
assert.ok(!tp.includes('Todos os dias das'), 'sem horário único não há rodapé de horário');
passou('horários diferentes no mesmo dia vão junto de cada pessoa');

/* ── 7. Nada pra mostrar, modalidade pelo id, entrada torta ────────── */
assert.strictEqual(SS.textoParaWhatsApp([], opts('dia')), '', 'sem escala não há texto');
assert.strictEqual(SS.textoParaWhatsApp(null, opts('pessoa')), '', 'null não estoura');
const semNomeDeModalidade = [{ id: 'm', date: '2026-10-03', tipo: 'sabado', slots: [
  { id: 'x', unitId: 'cp', requiredModalityId: 'MOD1', assignedPersonId: 'bc', startTime: '08:00', endTime: '12:00' }] }];
assert.ok(SS.textoParaWhatsApp(semNomeDeModalidade, Object.assign(opts('dia'), { modalidadePorId: { MOD1: 'TOI' } }))
  .includes('Campeche: Bruno Claudino (TOI)'), 'vaga antiga sem o nome da modalidade usa o cadastro');
assert.ok(SS.textoParaWhatsApp(semNomeDeModalidade, { formato: 'dia', titulo: 'T' }).includes('cp: bc'),
  'sem nomes, cai no id cru em vez de estourar');
passou('texto vazio quando não há escala; modalidade e nomes têm plano B');

console.log(`\n${ok} verificações ✓`);
