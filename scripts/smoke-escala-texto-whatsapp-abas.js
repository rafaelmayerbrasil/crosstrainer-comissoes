'use strict';
// Roda: node scripts/smoke-escala-texto-whatsapp-abas.js
process.env.TZ = 'America/Sao_Paulo';
//
// Rafael Rojais, grupo da gestão, 06/10/2026: "Como faz para copiar a escala
// para WhatsApp?" — o botão existia desde 01/10, só em Sábados e Feriados, e
// ele não achou. Junto com o destaque, o texto passou a existir também para o
// Fim de ano, a Escola Interna e os Eventos, que têm outra forma:
//   · fim de ano: UM documento com vários dias, por unidade e turno;
//   · Escola Interna: uma sessão por data, com quem lidera;
//   · evento: lista de quem deve / poderia ir e as respostas.
//
// Os três textos são funções PURAS — a tela só escolhe o que mostrar e copia.
const assert = require('assert');
const SS = require('../scale-service.js');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

const nomePorId = {
  bc: 'BRUNO CLAUDINO', bo: 'BRUNO OTHERO', he: 'HELOÍSA MAYUMI', va: 'VAGNER TEIXEIRA DE LIMA',
  th: 'THAYNARA SILVA', al: 'ALAN BRITO',
};
const unidadePorId = { cp: 'CrossTainer Campeche', pp: 'CrossTainer Príncipe' };
const RODAPE = 'Algo errado? Avise a gestão e registre a troca no sistema.';

/* ══ FIM DE ANO ═══════════════════════════════════════════════════════ */
const HORA = { manha: ['06:00', '12:00'], tarde_noite: ['15:00', '21:00'] };
const fa = (day, unitId, shift, pid, n, extra) => Object.assign({
  id: `${day}_${unitId}_${shift}_${n || 1}`, day, unitId, shift,
  startTime: HORA[shift][0], endTime: HORA[shift][1], requiredModalityId: null, assignedPersonId: pid,
}, extra || {});
const fimDeAno = {
  id: 'fda', tipo: 'fim_de_ano', date: '2026-12-23', name: 'Fim de ano 2026', published: true,
  slots: [   // fora de ordem de propósito
    fa('2026-12-26', 'pp', 'tarde_noite', 'th'), fa('2026-12-26', 'pp', 'manha', null),
    fa('2026-12-26', 'cp', 'manha', 'he'), fa('2026-12-26', 'cp', 'tarde_noite', 'bc'),
    fa('2026-12-23', 'cp', 'manha', 'bc'), fa('2026-12-23', 'cp', 'manha', 'he', 2),
    fa('2026-12-23', 'cp', 'tarde_noite', 'al'),
    fa('2026-12-23', 'pp', 'manha', 'va'), fa('2026-12-23', 'pp', 'tarde_noite', 'bo'),
  ],
};
const optsFa = (formato) => ({ formato, titulo: 'FIM DE ANO', nomePorId, unidadePorId });

assert.strictEqual(SS.textoFimDeAnoWhatsApp(fimDeAno, optsFa('dia')), [
  '*FIM DE ANO · CrossTainer*',
  '',
  '*Qua 23/12*',
  'Campeche: manhã — Bruno Claudino e Heloísa Mayumi · tarde/noite — Alan Brito',
  'Príncipe: manhã — Vagner Teixeira · tarde/noite — Bruno Othero',
  '',
  '*Sáb 26/12*',
  'Campeche: manhã — Heloísa Mayumi · tarde/noite — Bruno Claudino',
  'Príncipe: manhã — vaga aberta · tarde/noite — Thaynara Silva',
  '',
  'Manhã 06:00–12:00 · Tarde/noite 15:00–21:00.',
  RODAPE,
].join('\n'));
passou('fim de ano por dia: dias em ordem, unidade → turno → quem, vaga aberta à vista, horários no rodapé');

assert.strictEqual(SS.textoFimDeAnoWhatsApp(fimDeAno, optsFa('pessoa')), [
  '*FIM DE ANO · CrossTainer*',
  '_Quem trabalha em quais dias_',
  '',
  '*Alan Brito*: qua 23/12 Campeche tarde/noite',
  '*Bruno Claudino*: qua 23/12 Campeche manhã · sáb 26/12 Campeche tarde/noite',
  '*Bruno Othero*: qua 23/12 Príncipe tarde/noite',
  '*Heloísa Mayumi*: qua 23/12 Campeche manhã · sáb 26/12 Campeche manhã',
  '*Thaynara Silva*: sáb 26/12 Príncipe tarde/noite',
  '*Vagner Teixeira*: qua 23/12 Príncipe manhã',
  '',
  'Vagas abertas: sáb 26/12 Príncipe manhã',
  '',
  'Manhã 06:00–12:00 · Tarde/noite 15:00–21:00.',
  RODAPE,
].join('\n'));
passou('fim de ano por pessoa: ordem alfabética, os dias de cada um com unidade e turno, vagas abertas listadas');

// Turno com horário diferente num dos dias: o rodapé não pode afirmar um horário só.
const comDiaCurto = Object.assign({}, fimDeAno, { slots: fimDeAno.slots.concat([
  fa('2026-12-24', 'cp', 'manha', 'al', 1, { startTime: '07:00', endTime: '11:00', halfDay: true }),
]) });
const tCurto = SS.textoFimDeAnoWhatsApp(comDiaCurto, optsFa('dia'));
assert.ok(tCurto.includes('*Qui 24/12* · meio período\nCampeche: manhã 07:00–11:00 — Alan Brito'), 'dia de meio período marcado e com o horário dele:\n' + tCurto);
assert.ok(tCurto.includes('manhã 06:00–12:00 — Bruno Claudino e Heloísa Mayumi'), 'os outros dias passam a trazer o horário junto:\n' + tCurto);
assert.ok(!tCurto.includes('Manhã 06:00–12:00 ·'), 'sem horário único da manhã, o rodapé não inventa um:\n' + tCurto);
assert.ok(tCurto.includes('Tarde/noite 15:00–21:00.'), 'o turno que não varia continua no rodapé:\n' + tCurto);
assert.ok(SS.textoFimDeAnoWhatsApp(comDiaCurto, optsFa('pessoa')).includes('*Alan Brito*: qua 23/12 Campeche tarde/noite · qui 24/12 Campeche manhã 07:00–11:00'),
  'por pessoa também leva o horário quando o turno varia');
passou('fim de ano: turno com horário que varia vai junto de cada dia, não no rodapé');

assert.strictEqual(SS.textoFimDeAnoWhatsApp(null, optsFa('dia')), '', 'null não estoura');
assert.strictEqual(SS.textoFimDeAnoWhatsApp({ tipo: 'fim_de_ano', slots: [] }, optsFa('dia')), '', 'sem dias não há texto');
assert.strictEqual(SS.textoFimDeAnoWhatsApp({ tipo: 'sabado', date: '2026-10-03', slots: fimDeAno.slots }, optsFa('dia')), '', 'só vale para fim de ano');
passou('fim de ano: texto vazio quando não há o que mostrar');

/* ══ ESCOLA INTERNA ═══════════════════════════════════════════════════ */
const ei = (date, unitId, pid, ini, fim) => ({
  id: 'ei' + date + unitId, tipo: 'escola_interna', date, published: true,
  slots: [{ id: `${unitId}_lider`, unitId, assignedPersonId: pid, startTime: ini || '14:30', endTime: fim || '15:30' }],
});
const sessoes = [ei('2026-10-15', 'pp', 'bc'), ei('2026-10-08', 'pp', 'he'), ei('2026-10-22', 'cp', null, '10:00', '11:00')];
const optsEi = { titulo: 'ESCOLA INTERNA DE OUTUBRO', nomePorId, unidadePorId };

assert.strictEqual(SS.textoEscolaInternaWhatsApp(sessoes, optsEi), [
  '*ESCOLA INTERNA DE OUTUBRO · CrossTainer*',
  '',
  '*Qui 08/10* · 14:30–15:30',
  'Príncipe: líder Heloísa Mayumi',
  '',
  '*Qui 15/10* · 14:30–15:30',
  'Príncipe: líder Bruno Claudino',
  '',
  '*Qui 22/10* · 10:00–11:00',
  'Campeche: líder a definir',
  '',
  RODAPE,
].join('\n'));
passou('Escola Interna: sessões em ordem, horário, unidade e quem lidera; sem líder aparece "a definir"');

assert.strictEqual(SS.textoEscolaInternaWhatsApp(sessoes.concat([
  { id: 's', tipo: 'sabado', date: '2026-10-03', slots: [{ unitId: 'cp', assignedPersonId: 'bc', startTime: '08:00', endTime: '12:00' }] },
]), optsEi), SS.textoEscolaInternaWhatsApp(sessoes, optsEi), 'sábado não entra no texto da Escola Interna');
assert.strictEqual(SS.textoEscolaInternaWhatsApp([], optsEi), '');
assert.strictEqual(SS.textoEscolaInternaWhatsApp(null, optsEi), '');
passou('Escola Interna: só sessões dela, e texto vazio sem sessão');

/* ══ EVENTO ═══════════════════════════════════════════════════════════ */
const evento = { id: 'ev', tipo: 'evento', date: '2026-10-17', name: 'Trilha da Lagoa 17/10/2026', eventKind: 'externo', slots: [] };
const rsvp = [
  { personId: 'va', tier: 'obrigatorio', going: true },
  { personId: 'bc', tier: 'obrigatorio', going: true },
  { personId: 'he', tier: 'obrigatorio', going: false },
  { personId: 'th', tier: 'opcional', going: true },
  { personId: 'al', tier: 'opcional', going: null },
];
const optsEv = { nomePorId };

assert.strictEqual(SS.textoEventoWhatsApp(evento, rsvp, optsEv), [
  '*TRILHA DA LAGOA · CrossTainer*',
  'Sáb 17/10',
  '',
  'Devem ir: Bruno Claudino, Heloísa Mayumi e Vagner Teixeira',
  'Podem ir: Alan Brito e Thaynara Silva',
  '',
  'Vão: Bruno Claudino, Thaynara Silva e Vagner Teixeira',
  'Não vão: Heloísa Mayumi',
  'Falta responder: Alan Brito',
  '',
  'Responda pelo app se você vai.',
].join('\n'));
passou('evento: nome sem a data repetida, quem deve e quem pode ir, e as respostas até agora');

const todosVao = SS.textoEventoWhatsApp(evento, [{ personId: 'bc', tier: 'obrigatorio', going: true }], optsEv);
assert.ok(!/Podem ir|Não vão|Falta responder/.test(todosVao), 'linha sem ninguém não aparece:\n' + todosVao);
assert.ok(todosVao.includes('Devem ir: Bruno Claudino') && todosVao.includes('Vão: Bruno Claudino'), todosVao);
assert.ok(!todosVao.includes('Responda pelo app'), 'sem ninguém para responder, não pede resposta:\n' + todosVao);
passou('evento: linhas vazias somem, e o pedido de resposta só aparece quando falta alguém');

assert.strictEqual(SS.textoEventoWhatsApp(evento, [], optsEv), '', 'sem convidado não há texto');
assert.strictEqual(SS.textoEventoWhatsApp(null, rsvp, optsEv), '', 'null não estoura');
assert.strictEqual(SS.textoEventoWhatsApp({ tipo: 'sabado', date: '2026-10-03' }, rsvp, optsEv), '', 'só vale para evento');
const semNome = SS.textoEventoWhatsApp({ tipo: 'evento', date: '2026-10-17' }, rsvp, optsEv);
assert.ok(semNome.startsWith('*EVENTO · CrossTainer*\nSáb 17/10'), 'evento sem nome ganha um título genérico:\n' + semNome);
passou('evento: texto vazio sem convidados, e título de reserva quando não há nome');

/* ══ Nomes curtos que colidem saem por extenso, nos três textos ═══════ */
const gemeos = Object.assign({}, nomePorId, { a1: 'ANA SILVA COSTA', a2: 'ANA SILVA PRADO' });
const tg = SS.textoEventoWhatsApp(evento, [
  { personId: 'a1', tier: 'obrigatorio', going: true }, { personId: 'a2', tier: 'obrigatorio', going: true },
], { nomePorId: gemeos });
assert.ok(tg.includes('Devem ir: Ana Silva Costa e Ana Silva Prado'), 'evento:\n' + tg);
const fg = SS.textoFimDeAnoWhatsApp({ tipo: 'fim_de_ano', date: '2026-12-23', slots: [
  fa('2026-12-23', 'cp', 'manha', 'a1'), fa('2026-12-23', 'cp', 'manha', 'a2', 2)] }, { formato: 'dia', nomePorId: gemeos, unidadePorId });
assert.ok(fg.includes('manhã — Ana Silva Costa e Ana Silva Prado'), 'fim de ano:\n' + fg);
passou('nomes curtos iguais saem por extenso também nos textos novos');

console.log(`\n${ok} verificações ✓`);
