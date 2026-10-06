'use strict';
// Roda: node scripts/smoke-horas-dois-lugares-feriado.js
process.env.TZ = 'America/Sao_Paulo';
//
// Horas do mês — a pessoa em DOIS LUGARES ao mesmo tempo, o FERIADO em dobro e
// o dia "no lugar de um colega". A parte PURA (hour-declaration.js).
//
// O que motivou (grupo, 06/10/2026). O Theo Rosa corrigiu a sexta 04/09 — "to
// arrumando aqui, entrei às 6:30 neste dia, aí quando confirmo fica assim" — e
// a tela respondeu "−3h45". Em produção: a troca Bruno → Theo daquela noite
// (CP, 16:30–21:15) estava confirmada, e as aulas dele mesmo na PP (18:00–21:30)
// continuavam na agenda. O sistema somava 14h45 num dia de 11h. Pior do que a
// tela: ao validar, só os 30 min de atraso sairiam, e a folha pagaria 3h15 a
// mais. A Karin tinha o mesmo defeito em 01/09 e 28/09.
//
// "O feriado é o dobro né?" — é, a folha sempre pagou; a tela não dizia. E a
// Benny: "como eu confiro se ela fez de fato as 29h?" — a Carla tinha 25h
// trabalhadas e 4h de feriado contando em dobro.
const assert = require('assert');
const H = require('../hour-declaration.js');
const Payroll = require('../closing-payroll.js');
const fs = require('fs');
const path = require('path');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };
const ts = (dia) => { const [y, m, d] = dia.split('-').map(Number); return { toDate: () => new Date(y, m - 1, d) }; };
let seq = 0;
const aula = (dia, inicio, fim, extra) => Object.assign({
  id: 'c' + (++seq), teacherId: 'theo', originalTeacherId: 'theo', unitId: 'cp', modalityId: 'hiit',
  scheduledDate: ts(dia), startTime: inicio, endTime: fim, durationMinutes: H.paraMin(fim) - H.paraMin(inicio), status: 'realizada',
  atrasoMinutos: 0, saidaAntecipadaMinutos: 0, horaExtraMinutos: 0, faltaTipo: null, monthClosingId: null }, extra || {});
const bloco = (dia, inicio, fim, extra) => {
  const out = []; let a = H.paraMin(inicio); const f = H.paraMin(fim);
  while (a < f) { const b = Math.min(a + 60, f); out.push(aula(dia, H.paraHHMM(a), H.paraHHMM(b), extra)); a = b; }
  return out;
};
const turnos = (...pares) => ({ turnos: pares.map(p => ({ inicio: p[0], fim: p[1] })) });
const SEXTA = '2026-09-04';

/* A sexta 04/09 do Theo, como estava em produção */
const doBruno = { status: 'substituida', originalTeacherId: 'bruno', unitId: 'cp' };
const SEXTA_DO_THEO = [].concat(
  bloco(SEXTA, '06:00', '12:30'),
  [aula(SEXTA, '16:30', '17:30', doBruno), aula(SEXTA, '17:30', '18:30', doBruno), aula(SEXTA, '18:30', '19:30', doBruno),
    aula(SEXTA, '19:30', '20:30', doBruno), aula(SEXTA, '20:30', '21:15', doBruno)],
  bloco(SEXTA, '18:00', '21:30', { unitId: 'pp' }));

/* ── 1. A agenda diz quando a pessoa está em dois lugares ───────────── */
{
  const [dia] = H.agendaDoMes(SEXTA_DO_THEO, 'theo', 2026, 9);
  assert.strictEqual(dia.minutos, 885, 'a agenda soma 14h45 — é o que a folha pagaria hoje');
  assert.deepStrictEqual(dia.turnos, [{ inicio: '06:00', fim: '12:30' }, { inicio: '16:30', fim: '21:30' }], 'os turnos somam 11h30');
  assert.strictEqual(dia.minutosEmDobro, 195, '3h15 contadas duas vezes');
  assert.deepStrictEqual(dia.emDobro, [{ inicio: '18:00', fim: '21:15' }], 'e diz QUANDO: das 18:00 às 21:15');
  assert.deepStrictEqual(dia.unidades.sort(), ['cp', 'pp']);
  const normal = H.agendaDoMes(bloco('2026-09-08', '09:30', '13:30'), 'theo', 2026, 9)[0];
  assert.strictEqual(normal.minutosEmDobro, 0, 'aulas seguidas (uma acaba, a outra começa) não são dois lugares');
  assert.deepStrictEqual(normal.emDobro, []);
  passou('a agenda aponta o tempo contado em dobro: quanto e em que horário');
}

/* ── 2. Validar credita cada minuto UMA vez; a troca confirmada vence ─ */
{
  const [dia] = H.agendaDoMes(SEXTA_DO_THEO, 'theo', 2026, 9);
  const dec = turnos(['06:30', '12:30'], ['16:30', '21:30']);          // o que o Theo informou: 11h
  const p = H.planoDoDia(dia, dec, SEXTA);
  assert.strictEqual(p.deltaMinutos, -225, 'saem 3h45: 30 min de atraso + 3h15 que estavam em dobro');
  assert.strictEqual(dia.minutos + p.deltaMinutos, 660, 'o dia fica com as 11h que ele trabalhou');
  const r = H.resumo([dia], { dias: { [SEXTA]: dec } });
  assert.strictEqual(r.delta, p.deltaMinutos, 'o que a tela mostra ao professor é o que a validação faz — antes divergiam em 3h15');

  const porHora = new Map(p.ops.map(o => [o.unitId + ' ' + o.inicio, o]));
  assert.ok(!p.ops.some(o => o.unitId === 'cp' && o.inicio >= '16:30'), 'as aulas da troca confirmada (CP, do Bruno) ficam inteiras');
  ['18:00', '19:00', '20:00'].forEach(h => {
    const o = porHora.get('pp ' + h);
    assert.ok(o && o.campos.status === 'nao_realizada' && o.motivo === 'dois_lugares', `a aula da grade na PP às ${h} sai, dizendo o porquê`);
  });
  const ultima = porHora.get('pp 21:00');
  assert.ok(ultima && ultima.campos.atrasoMinutos === 15 && ultima.motivo === 'dois_lugares', 'a das 21:00 fica só com os 15 min depois que a aula da CP acabou');
  assert.strictEqual(porHora.get('cp 06:00').campos.atrasoMinutos, 30, 'e o atraso da manhã continua sendo atraso');
  assert.strictEqual(porHora.get('cp 06:00').motivo, null);

  // a folha de verdade, depois de aplicar
  const depois = SEXTA_DO_THEO.map(c => { const o = p.ops.find(x => x.classId === c.id); return o ? Object.assign({}, c, o.campos) : c; });
  const pagas = depois.filter(c => Payroll.STATUS_QUE_PAGAM.indexOf(c.status) !== -1);
  assert.strictEqual(Math.round(Payroll.horasDasAulas(pagas, new Map()) * 60), 660, 'closing-payroll paga 11h00 nesse dia');
  assert.strictEqual(H.agendaDoMes(depois, 'theo', 2026, 9)[0].minutosEmDobro, 0, 'e o dia deixa de ter tempo em dobro');
  // validar de novo não muda mais nada
  assert.strictEqual(H.planoDoDia(H.agendaDoMes(depois, 'theo', 2026, 9)[0], dec, SEXTA).deltaMinutos, 0, 'validar duas vezes não tira duas vezes');
  passou('04/09 do Theo: 14h45 → 11h00, a troca do Bruno fica e a aula própria no mesmo horário sai');
}

/* ── 3. Confirmar os MESMOS horários também resolve ─────────────────── */
{
  const [dia] = H.agendaDoMes(SEXTA_DO_THEO, 'theo', 2026, 9);
  const dec = turnos(['06:00', '12:30'], ['16:30', '21:30']);
  const r = H.resumo([dia], { dias: { [SEXTA]: dec } });
  assert.strictEqual(r.dias[0].mudou, true, 'num dia em dois lugares, confirmar os horários da agenda JÁ é correção');
  assert.strictEqual(r.delta, -195);
  assert.strictEqual(H.planoDoDia(dia, dec, SEXTA).deltaMinutos, -195, 'saem só as 3h15 em dobro');
  const semDec = H.resumo([dia], { dias: {} });
  assert.strictEqual(semDec.minutosEmDobro, 195, 'sem correção, o resumo avisa que há 3h15 em dobro no mês');
  passou('confirmar o dia com os horários da agenda tira o que estava em dobro');
}

/* ── 4. Duas aulas na MESMA unidade e horário (a Karin, 01/09) ──────── */
{
  const d = '2026-09-01';
  const cls = [aula(d, '06:00', '07:00', { teacherId: 'karin', originalTeacherId: 'karin' }),
    aula(d, '07:00', '08:00', { teacherId: 'karin', originalTeacherId: 'eduarda', status: 'substituida' }),
    aula(d, '07:00', '08:00', { teacherId: 'karin', originalTeacherId: 'karin' })];
  const [dia] = H.agendaDoMes(cls, 'karin', 2026, 9);
  assert.strictEqual(dia.minutos, 180); assert.strictEqual(dia.minutosEmDobro, 60);
  const p = H.planoDoDia(dia, turnos(['06:00', '08:00']), d);
  assert.strictEqual(p.deltaMinutos, -60);
  assert.strictEqual(p.ops.length, 1);
  assert.strictEqual(p.ops[0].classId, cls[2].id, 'sai a aula da grade, fica a da troca');
  passou('duas aulas no mesmo horário na mesma unidade: conta uma hora, não duas');
}

/* ── 5. Dia sem choque continua exatamente como era ─────────────────── */
{
  const d = '2026-09-08';
  const [dia] = H.agendaDoMes(bloco(d, '09:30', '13:30').concat(bloco(d, '18:00', '21:30')), 'theo', 2026, 9);
  const p = H.planoDoDia(dia, turnos(['09:30', '13:30'], ['16:30', '21:30']), d);
  assert.strictEqual(p.deltaMinutos, 90);
  assert.ok(p.ops.length === 1 && p.ops[0].campos.horaExtraMinutos === 90 && p.ops[0].motivo === null, 'entrou 1h30 antes: tempo além na aula vizinha, como sempre');
  passou('sem aulas no mesmo horário, o plano é o mesmo de antes');
}

/* ── 6. Feriado: horas trabalhadas × horas para pagamento ───────────── */
{
  const fer = { teacherId: 'carla', originalTeacherId: 'carla', specialScaleType: 'feriado', isHoliday: true, holidayName: 'Independência' };
  const cls = [aula('2026-09-07', '08:00', '12:00', fer)]
    .concat([1, 2, 3].map(n => aula(`2026-09-0${n}`, '12:30', '13:30', { teacherId: 'carla', originalTeacherId: 'carla' })))
    .concat([aula('2026-09-12', '08:00', '12:00', { teacherId: 'carla', originalTeacherId: 'carla', specialScaleType: 'sabado' })]);
  const ag = H.agendaDoMes(cls, 'carla', 2026, 9);
  const dia7 = ag.find(a => a.dia === '2026-09-07');
  assert.ok(dia7.feriado && dia7.peso === 2 && dia7.holidayName === 'Independência');
  assert.strictEqual(dia7.minutos, 240, '4h trabalhadas');
  assert.strictEqual(dia7.minutosPagos, 480, '8h para pagamento');
  const r = H.resumo(ag, { dias: {} });
  assert.strictEqual(r.minutosAgenda, 660, '11h trabalhadas');
  assert.strictEqual(r.minutosPagosAgenda, 900, '15h para pagamento');
  assert.strictEqual(Math.round(Payroll.horasDasAulas(cls, new Map()) * 60), r.minutosPagosAgenda, 'e é exatamente o que o closing-payroll paga');

  // com os tipos de escala cadastrados, quem manda é o peso do tipo — nas DUAS contas
  const tipos = new Map([['feriado', { weight: 1.5 }], ['sabado', { weight: 1 }]]);
  const r2 = H.resumo(H.agendaDoMes(cls, 'carla', 2026, 9, tipos), { dias: {} });
  assert.strictEqual(r2.minutosPagosAgenda, Math.round(Payroll.horasDasAulas(cls, tipos) * 60), 'peso do tipo de escala: mesma conta da folha');
  assert.strictEqual(H.pesoDaAula({ specialScaleType: 'feriado', isHoliday: true }, { feriado: { weight: 3 } }), 3, 'aceita objeto simples além de Map');

  // o professor corrige o feriado: o que ele informou também conta em dobro
  const r3 = H.resumo(ag, { dias: { '2026-09-07': turnos(['08:00', '12:50']) } });
  const l = r3.dias.find(x => x.dia === '2026-09-07');
  assert.strictEqual(l.minutosInformados, 290); assert.strictEqual(l.minutosPagosInformados, 580);
  passou('feriado: a tela passa a saber as horas para pagamento, pela mesma conta da folha');
}

/* ── 7. Feriado num dia que NÃO estava na agenda da pessoa ──────────── */
{
  const todos = [aula('2026-09-07', '08:00', '12:00', { teacherId: 'carla', originalTeacherId: 'carla', specialScaleType: 'feriado', isHoliday: true, holidayName: 'Independência' }),
    aula('2026-09-08', '09:30', '10:30')];
  const feriados = H.feriadosDasAulas(todos, new Map());
  assert.deepStrictEqual(feriados, { '2026-09-07': { peso: 2, nome: 'Independência' } }, 'o feriado é reconhecido pelas aulas de qualquer pessoa — ninguém precisa marcar');
  const dec = { dias: { '2026-09-07': Object.assign(turnos(['08:00', '12:00']), { foraDaAgenda: 'no_lugar_de', noLugarDe: 'carla' }) } };
  const ag = H.agendaDoMes(todos, 'theo', 2026, 9);
  const l = H.resumo(ag, dec, { feriados }).dias.find(x => x.dia === '2026-09-07');
  assert.ok(l.feriado && l.peso === 2 && l.minutosPagosInformados === 480, 'o dia incluído pelo Theo aparece como feriado, valendo 8h');
  assert.strictEqual(H.resumo(ag, dec).dias.find(x => x.dia === '2026-09-07').feriado, false, 'sem a informação do dia, não inventa feriado');

  const nova = H.aulaAvulsa({ dia: '2026-09-07', nova: { inicio: '08:00', fim: '12:00', minutos: 240 }, teacherId: 'theo', agendaDia: null,
    padrao: { unitId: 'cp', modalityId: 'hiit' }, feriado: feriados['2026-09-07'] });
  assert.ok(nova.isHoliday === true && nova.holidayName === 'Independência', 'turno a mais em feriado nasce marcado como feriado');
  assert.strictEqual(Payroll.horasDasAulas([nova], new Map()), 8, 'e a folha paga em dobro');
  assert.strictEqual(H.aulaAvulsa({ dia: '2026-09-09', nova: { inicio: '08:00', fim: '12:00', minutos: 240 }, teacherId: 'theo', agendaDia: null, padrao: { unitId: 'cp' } }).isHoliday, false);
  passou('dia incluído fora da agenda em data de feriado: reconhecido sozinho, sem botão');
}

/* ── 8. "No lugar de um colega": as aulas que a gestão passa num clique ─ */
{
  const d = '2026-09-19';
  const todos = [aula(d, '08:00', '12:00', { teacherId: 'bruno', originalTeacherId: 'bruno', specialScaleType: 'sabado' }),
    aula(d, '08:00', '12:00', { teacherId: 'thiago', originalTeacherId: 'thiago', unitId: 'pp', specialScaleType: 'sabado' }),
    aula(d, '14:00', '15:00', { teacherId: 'bruno', originalTeacherId: 'bruno' }),
    aula('2026-09-20', '08:00', '12:00', { teacherId: 'bruno', originalTeacherId: 'bruno' })];
  const p = { dia: d, turnos: [{ inicio: '08:00', fim: '12:50' }], colegaId: 'bruno', pessoaId: 'theo' };
  let x = H.aulasDoColega(todos, p);
  assert.deepStrictEqual(x.aTransferir.map(c => c.id), [todos[0].id], 'só a aula do colega, naquele dia e dentro do horário informado');
  assert.strictEqual(x.jaComAPessoa.length, 0);

  // depois da troca confirmada: a aula está com o Theo, e o dia entra normal no plano
  const depois = todos.map(c => c.id === todos[0].id ? Object.assign({}, c, { teacherId: 'theo', status: 'substituida' }) : c);
  x = H.aulasDoColega(depois, p);
  assert.ok(x.aTransferir.length === 0 && x.jaComAPessoa.length === 1, 'troca feita: nada mais a passar');
  const dec = Object.assign(turnos(['08:00', '12:50']), { foraDaAgenda: 'no_lugar_de', noLugarDe: 'bruno' });
  const [dia] = H.agendaDoMes(depois, 'theo', 2026, 9);
  const pl = H.planoDoDia(dia, dec, d);
  assert.strictEqual(pl.pendencias.length, 0, 'com a aula já no nome dele, não é mais pendência');
  assert.ok(pl.deltaMinutos === 50 && pl.ops[0].campos.horaExtraMinutos === 50, 'e os 50 min que passou do horário entram como tempo além');
  // antes da troca continua pendência, como sempre foi
  assert.strictEqual(H.planoDoDia(null, dec, d).pendencias[0].minutos, 290);
  passou('"no lugar de um colega": acha as aulas do colega; feita a troca, o dia vira hora normal');
}

/* ── 9. Aviso antes de confirmar uma troca que cria o choque ────────── */
{
  const doTheo = bloco(SEXTA, '18:00', '21:30', { unitId: 'pp' }).concat(bloco(SEXTA, '06:00', '12:30'));
  const aulaDoBruno = aula(SEXTA, '18:30', '19:30', { teacherId: 'bruno', originalTeacherId: 'bruno' });
  const ch = H.choquesDeHorario(doTheo, aulaDoBruno);
  assert.deepStrictEqual(ch.map(c => c.startTime), ['18:00', '19:00'], 'o Theo já tem aula às 18:00 e às 19:00 — as duas cruzam com a das 18:30');
  assert.strictEqual(H.choquesDeHorario(doTheo, aula(SEXTA, '16:30', '17:30', { teacherId: 'bruno' })).length, 0, 'horário livre: nada a avisar');
  assert.strictEqual(H.choquesDeHorario(doTheo.concat([aula(SEXTA, '18:30', '19:30', { status: 'cancelada' })]), aulaDoBruno).length, 2, 'aula cancelada não é choque');
  assert.strictEqual(H.choquesDeHorario([aulaDoBruno], aulaDoBruno).length, 0, 'a própria aula não choca com ela mesma');
  passou('choquesDeHorario: quem vai assumir a aula já tem outra no mesmo horário');
}

/* ── 10. Quem está em dois lugares no mês (trava do fechamento) ─────── */
{
  const cls = SEXTA_DO_THEO.concat(bloco('2026-09-08', '09:30', '12:30', { teacherId: 'bia', originalTeacherId: 'bia' }),
    [aula('2026-09-02', '14:30', '15:30', { specialScaleType: 'escola_interna', remunerada: false }), aula('2026-09-02', '14:30', '15:30')]);
  const x = H.emDoisLugares(cls, 2026, 9);
  assert.strictEqual(x.length, 1);
  assert.deepStrictEqual({ id: x[0].teacherId, min: x[0].minutos, dia: x[0].dias[0].dia }, { id: 'theo', min: 195, dia: SEXTA });
  passou('emDoisLugares: lista quem e quando; aula que não paga (Escola Interna) não conta como choque');
}

/* ── 11. O gêmeo das Functions é o mesmo arquivo ────────────────────── */
{
  const a = fs.readFileSync(path.join(__dirname, '..', 'hour-declaration.js'), 'utf8');
  const b = fs.readFileSync(path.join(__dirname, '..', 'functions', 'hour-declaration.js'), 'utf8');
  assert.strictEqual(a, b, 'hour-declaration.js e functions/hour-declaration.js têm que ser idênticos');
  passou('o gêmeo em functions/ está igual');
}

console.log(`\n${ok} verificações ✓`);
