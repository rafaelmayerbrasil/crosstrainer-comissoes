'use strict';
// Roda: node scripts/smoke-horas-do-mes.js
process.env.TZ = 'America/Sao_Paulo';
//
// "Minhas horas do mês" — a parte PURA (hour-declaration.js).
//
// Professor, no grupo (30/09/2026): "Poderia ter um fechamento do mês, total,
// tipo fecha tal dia, aí a galera coloca lá as horas que fez, sem ter que ir de
// hora em hora". E o Rafael (01/10): "eu acho que o professor poderia corrigir
// e colocar pra gestão validar".
//
// O caso que motivou tudo é o do Theo Rosa em setembro/2026, e é ele a fixture
// daqui: a lista que ele mandou pelo WhatsApp dá 167h15; a agenda tinha 139h30.
// A diferença nunca coube na tela antiga, porque a maior parte era turno que
// não existia na grade (noite de segunda e quarta) ou entrada antes do horário.
//
// A ideia central: a correção validada vira ajuste nas PRÓPRIAS AULAS (atraso,
// saída, tempo além, aula não realizada, turno novo). A folha, o banco de horas
// e os relatórios continuam lendo as aulas — não nasce um segundo cálculo. O
// teste final prova isso contra o closing-payroll.js de verdade.
const assert = require('assert');
const H = require('../hour-declaration.js');
const Payroll = require('../closing-payroll.js');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };
const ts = (dia, hhmm) => { const [y, m, d] = dia.split('-').map(Number); const [h, mi] = (hhmm || '00:00').split(':').map(Number); return { toDate: () => new Date(y, m - 1, d, h, mi) }; };

/* ── A agenda REAL do Theo em setembro/2026 (como estava em produção) ── */
let seq = 0;
const aula = (dia, inicio, fim, extra) => {
  const dur = H.paraMin(fim) - H.paraMin(inicio);
  return Object.assign({ id: 'c' + (++seq), teacherId: 'theo', originalTeacherId: 'theo', unitId: 'cp', modalityId: 'hiit',
    scheduledDate: ts(dia), startTime: inicio, endTime: fim, durationMinutes: dur, status: 'realizada',
    atrasoMinutos: 0, saidaAntecipadaMinutos: 0, horaExtraMinutos: 0, faltaTipo: null, monthClosingId: null }, extra || {});
};
const bloco = (dia, inicio, fim) => {   // aulas de 1h (a última pode ser de 30 min), como a grade gera
  const out = []; let a = H.paraMin(inicio); const f = H.paraMin(fim);
  while (a < f) { const b = Math.min(a + 60, f); out.push(aula(dia, H.paraHHMM(a), H.paraHHMM(b))); a = b; }
  return out;
};
const manhaCurta = (d) => bloco(d, '09:30', '12:30');
const tercaQuinta = (d) => bloco(d, '09:30', '13:30').concat(bloco(d, '18:00', '21:30'));
const sexta = (d) => bloco(d, '06:00', '12:30').concat(bloco(d, '18:00', '21:30'));
const sabado = (d) => [aula(d, '08:00', '12:00', { specialScaleType: 'sabado', generatedBy: 'escala-smart' })];
const D = (n) => `2026-09-${String(n).padStart(2, '0')}`;
const AGENDA_BRUTA = [].concat(
  [1, 3, 8, 10, 15, 17, 22, 24, 29].flatMap(n => tercaQuinta(D(n))),
  [2, 9, 14, 16, 21, 23, 28, 30].flatMap(n => manhaCurta(D(n))),
  [4, 11, 18, 25].flatMap(n => sexta(D(n))),
  [5, 26].flatMap(n => sabado(D(n))),
  // ruído que NÃO pode entrar: Escola Interna (não paga), aula de outro professor, cancelada, outro mês
  [aula(D(2), '14:30', '15:30', { specialScaleType: 'escola_interna', remunerada: false }),
    aula(D(8), '06:00', '07:00', { teacherId: 'outra' }),
    aula(D(9), '18:00', '19:00', { status: 'cancelada' }),
    aula('2026-10-01', '09:30', '10:30')]);

/* ── A lista que o Theo mandou pelo WhatsApp, dia por dia ─────────── */
const t = (...pares) => ({ turnos: pares.map(p => ({ inicio: p[0], fim: p[1] })) });
const LISTA_DO_THEO = {
  [D(3)]: t(['09:30', '13:30'], ['19:30', '21:30']),
  [D(4)]: t(['06:30', '12:30'], ['16:30', '21:30']),
  [D(5)]: { naoTrabalhei: true },
  [D(7)]: Object.assign(t(['08:00', '12:00']), { foraDaAgenda: 'no_lugar_de', noLugarDe: 'vagner' }),
  [D(8)]: t(['09:30', '13:30'], ['16:30', '21:30']),
  [D(9)]: t(['09:30', '12:30'], ['16:30', '21:30']),
  [D(10)]: t(['09:30', '13:30'], ['16:30', '21:30']),
  [D(11)]: t(['08:00', '13:00'], ['16:30', '21:30']),
  [D(14)]: t(['09:30', '12:30'], ['16:30', '21:30']),
  [D(15)]: t(['09:30', '13:30'], ['16:30', '21:44']),
  [D(16)]: t(['09:30', '12:30'], ['16:30', '21:30']),
  [D(17)]: t(['09:30', '13:30'], ['16:30', '21:30']),
  [D(18)]: t(['07:30', '12:30'], ['16:30', '21:30']),
  [D(19)]: Object.assign(t(['08:00', '12:50']), { foraDaAgenda: 'no_lugar_de', noLugarDe: null }),
  [D(21)]: t(['09:30', '12:36'], ['16:30', '21:30']),
  [D(22)]: t(['09:30', '13:35'], ['16:30', '21:30']),
  [D(23)]: t(['09:30', '12:30'], ['16:30', '21:30']),
  [D(25)]: t(['06:30', '12:30']),
  [D(26)]: { naoTrabalhei: true },
  [D(29)]: t(['09:30', '13:30'], ['17:00', '19:00']),
};
const declTheo = { teacherId: 'theo', mes: '2026-09', status: 'enviada', dias: LISTA_DO_THEO };

/* ── 1. Conversões ─────────────────────────────────────────────────── */
assert.strictEqual(H.paraMin('09:30'), 570); assert.strictEqual(H.paraMin('9:30'), 570);
assert.strictEqual(H.paraMin('24:00'), null); assert.strictEqual(H.paraMin('14h05'), null); assert.strictEqual(H.paraMin(''), null);
assert.strictEqual(H.paraHHMM(570), '09:30');
assert.strictEqual(H.fmtHoras(8370), '139h30'); assert.strictEqual(H.fmtHoras(25), '0h25'); assert.strictEqual(H.fmtHoras(0), '0h00');
assert.strictEqual(H.fmtHoras(1665, { sinal: true }), '+27h45'); assert.strictEqual(H.fmtHoras(-90, { sinal: true }), '−1h30');
assert.strictEqual(H.fmtHoras(0, { sinal: true }), '0h00');
passou('horas e minutos convertem nos dois sentidos, e horário torto vira null (não zero)');

/* ── 2. A agenda do mês, por dia, em turnos ───────────────────────── */
const agenda = H.agendaDoMes(AGENDA_BRUTA, 'theo', 2026, 9);
{
  assert.strictEqual(agenda.length, 23, 'os 23 dias em que ele tem aula que paga');
  const dia = (n) => agenda.find(x => x.dia === D(n));
  assert.deepStrictEqual(dia(1).turnos, [{ inicio: '09:30', fim: '13:30' }, { inicio: '18:00', fim: '21:30' }], 'aulas seguidas viram UM turno — é o que tira o "de hora em hora"');
  assert.strictEqual(dia(1).minutos, 450);
  assert.deepStrictEqual(dia(2).turnos, [{ inicio: '09:30', fim: '12:30' }], 'Escola Interna (não paga) não aparece');
  assert.strictEqual(dia(9).minutos, 180, 'aula cancelada não entra');
  assert.strictEqual(dia(8).aulas.length, 8, 'aula de outro professor não entra');
  assert.strictEqual(agenda.reduce((s, x) => s + x.minutos, 0), 8370, 'total da agenda: 139h30 — o número de produção');
  assert.ok(!agenda.some(x => x.dia.startsWith('2026-10')), 'outubro fica de fora');

  // Ajuste oficial já lançado numa aula entra na conta do dia.
  const comExtra = AGENDA_BRUTA.map(c => (c.id === dia(1).aulas[0].id ? Object.assign({}, c, { horaExtraMinutos: 20, atrasoMinutos: 5 }) : c));
  assert.strictEqual(H.agendaDoMes(comExtra, 'theo', 2026, 9).find(x => x.dia === D(1)).minutos, 465, '450 − 5 de atraso + 20 além');
  passou('agendaDoMes agrupa as aulas do dia em turnos e soma só o que paga (139h30 no setembro do Theo)');
}

/* ── 3. Validar o que a pessoa digitou ─────────────────────────────── */
{
  assert.strictEqual(H.minutosDoDia(t(['09:30', '13:30'], ['16:30', '21:44'])), 554);
  assert.strictEqual(H.minutosDoDia({ naoTrabalhei: true }), 0);
  assert.ok(H.validarDia(t(['09:30', '13:30'])).ok);
  assert.ok(/saída.*entrada|entrada.*saída/i.test(H.validarDia(t(['13:30', '09:30'])).erro), 'saída antes da entrada');
  assert.ok(/sobrep|ao mesmo tempo|se cruzam/i.test(H.validarDia(t(['09:00', '12:00'], ['11:00', '13:00'])).erro), 'dois turnos que se cruzam');
  assert.ok(H.validarDia(t(['09:00', '25:00'])).erro, 'hora que não existe');
  assert.ok(H.validarDia({ turnos: [] }).erro, 'dia editado sem turno nenhum tem que dizer "não trabalhei"');
  assert.ok(H.validarDia({ naoTrabalhei: true }).ok);
  assert.ok(/16 horas|demais/i.test(H.validarDia(t(['00:00', '23:59'])).erro), 'dia de 24h é erro de digitação, não hora extra');
  assert.deepStrictEqual(H.validarDia(t(['16:30', '21:30'], ['09:30', '12:30'])).turnos.map(x => x.ini), [570, 990], 'devolve os turnos em ordem');
  passou('validarDia recusa turno invertido, sobreposto, inexistente e dia absurdo');
}

/* ── 4. O resumo que o professor e a gestão veem ───────────────────── */
{
  const r = H.resumo(agenda, declTheo);
  assert.strictEqual(r.minutosAgenda, 8370);
  assert.strictEqual(r.minutosInformados, 10035, '167h15 — a soma da lista dele');
  assert.strictEqual(r.delta, 1665, '+27h45');
  assert.strictEqual(r.diasDiferentes, 18, '18 dias com horas diferentes da agenda (11/09 e 18/09 mudam de horário mas dão o mesmo total)');
  assert.strictEqual(r.diasComMudanca, 20, 'e 20 dias em que algo mudou');
  const d7 = r.dias.find(x => x.dia === D(7));
  assert.deepStrictEqual({ fora: d7.foraDaAgenda, agenda: d7.minutosAgenda, inf: d7.minutosInformados }, { fora: 'no_lugar_de', agenda: 0, inf: 240 }, 'dia que não está na agenda entra na lista');
  assert.strictEqual(r.dias.length, 25, '23 dias da agenda + os 2 que só existem na lista dele');
  assert.strictEqual(r.dias.find(x => x.dia === D(1)).delta, 0, 'dia que ele não mexeu vale a agenda');

  const vazio = H.resumo(agenda, null);
  assert.deepStrictEqual({ a: vazio.minutosAgenda, i: vazio.minutosInformados, d: vazio.diasDiferentes }, { a: 8370, i: 8370, d: 0 }, 'sem declaração, informado = agenda');
  passou('resumo: 139h30 na agenda, 167h15 informado, +27h45 em 18 dias — os números do caso real');
}

/* ── 5. O plano de um dia: o que muda em cada aula ─────────────────── */
const dia = (n) => agenda.find(x => x.dia === D(n));
const plano = (n) => H.planoDoDia(dia(n) || null, LISTA_DO_THEO[D(n)], D(n));
const op = (p, inicio) => p.ops.find(o => o.inicio === inicio);
{
  // 03/09: à noite chegou 19:30 em vez de 18:00
  let p = plano(3);
  assert.deepStrictEqual(op(p, '18:00').campos, { status: 'nao_realizada', atrasoMinutos: 0, saidaAntecipadaMinutos: 0, horaExtraMinutos: 0, faltaTipo: null }, 'a aula das 18h não foi dada — sem virar FALTA, que tira pontos');
  assert.deepStrictEqual(op(p, '19:00').campos, { atrasoMinutos: 30, saidaAntecipadaMinutos: 0, horaExtraMinutos: 0 }, 'a das 19h começou 30 min depois');
  assert.strictEqual(p.ops.length, 2, 'as outras 6 aulas do dia não são tocadas');
  assert.strictEqual(p.deltaMinutos, -90);

  // 04/09: entrou 06:30 (não 06:00) e à noite 16:30 (não 18:00)
  p = plano(4);
  assert.strictEqual(op(p, '06:00').campos.atrasoMinutos, 30);
  assert.strictEqual(op(p, '18:00').campos.horaExtraMinutos, 90, 'o tempo ANTES do turno entra como tempo além na primeira aula dele');
  assert.strictEqual(p.novas.length, 0);
  assert.strictEqual(p.deltaMinutos, 60);

  // 09/09: noite inteira que não existe na grade
  p = plano(9);
  assert.strictEqual(p.ops.length, 0, 'a manhã está igual');
  assert.deepStrictEqual(p.novas, [{ inicio: '16:30', fim: '21:30', minutos: 300 }], 'turno que não tem aula vira um turno novo');
  assert.strictEqual(p.deltaMinutos, 300);

  // 15/09: 16:30–21:44
  p = plano(15);
  assert.strictEqual(op(p, '18:00').campos.horaExtraMinutos, 90);
  assert.strictEqual(op(p, '21:00').campos.horaExtraMinutos, 14, 'os 14 min depois do fim vão pra última aula');
  assert.strictEqual(p.deltaMinutos, 104);

  // 11/09: mesmas 10h, em outros horários
  p = plano(11);
  assert.strictEqual(op(p, '06:00').campos.status, 'nao_realizada');
  assert.strictEqual(op(p, '07:00').campos.status, 'nao_realizada');
  assert.strictEqual(op(p, '12:00').campos.horaExtraMinutos, 30);
  assert.strictEqual(op(p, '18:00').campos.horaExtraMinutos, 90);
  assert.strictEqual(p.deltaMinutos, 0, 'o total não muda, mas a aula das 6h não pode ficar como dada');

  // 25/09: só a manhã, entrando 06:30
  p = plano(25);
  assert.strictEqual(p.ops.filter(o => o.campos.status === 'nao_realizada').length, 4, 'as 4 aulas da noite não foram dadas');
  assert.strictEqual(p.deltaMinutos, -240);

  // 29/09: 17h às 19h
  p = plano(29);
  assert.strictEqual(op(p, '18:00').campos.horaExtraMinutos, 60, '17h–18h entra na aula das 18h');
  assert.strictEqual(p.ops.filter(o => o.campos.status === 'nao_realizada').length, 3);
  assert.strictEqual(p.deltaMinutos, -90);

  // sábado que ele não trabalhou
  p = plano(5);
  assert.strictEqual(p.ops.length, 1); assert.strictEqual(p.ops[0].campos.status, 'nao_realizada');

  // dia fora da agenda, no lugar de alguém: NÃO vira hora — vira troca
  p = plano(7);
  assert.strictEqual(p.ops.length + p.novas.length, 0, 'nada entra na folha por aqui: os dois receberiam pela mesma aula');
  assert.deepStrictEqual(p.pendencias, [{ tipo: 'no_lugar_de', noLugarDe: 'vagner', inicio: '08:00', fim: '12:00', minutos: 240 }]);
  assert.strictEqual(p.deltaMinutos, 0);

  // dia fora da agenda como turno extra (ninguém estava escalado): vira turno novo
  p = H.planoDoDia(null, Object.assign(t(['08:00', '12:00']), { foraDaAgenda: 'turno_extra' }), D(13));
  assert.deepStrictEqual(p.novas, [{ inicio: '08:00', fim: '12:00', minutos: 240 }]);

  // dia sem declaração: nada a fazer
  assert.deepStrictEqual(H.planoDoDia(dia(1), undefined, D(1)), { ops: [], novas: [], pendencias: [], deltaMinutos: 0, erro: '' });
  // declaração inválida não vira plano
  assert.ok(H.planoDoDia(dia(1), t(['13:00', '09:00']), D(1)).erro);
  passou('planoDoDia: atraso, aula não dada, tempo antes e depois do turno, turno novo, e "no lugar de alguém" fica de fora');
}

/* ── 6. A PROVA: aplicar o plano faz a folha dar o que ele informou ── */
{
  const p = H.plano(agenda, declTheo);
  assert.strictEqual(p.erros.length, 0, p.erros.join(' · '));
  assert.strictEqual(p.minutosPendentes, 530, 'os dois dias "no lugar de alguém" (4h + 4h50) esperam virar troca');
  assert.strictEqual(p.deltaMinutos, 1665 - 530, 'o resto entra: +18h55');

  // Aplica como a tela da gestão aplica: campo a campo nas aulas, e cria as novas.
  const aplicar = (classes, pl) => {
    const out = classes.map(c => Object.assign({}, c));
    pl.porDia.forEach(d => {
      d.ops.forEach(o => Object.assign(out.find(c => c.id === o.classId), o.campos));
      d.novas.forEach((n, i) => out.push(aula(d.dia, n.inicio, n.fim, { id: `nova_${d.dia}_${i}`, generatedBy: 'horas-do-mes' })));
    });
    return out;
  };
  const depois = aplicar(AGENDA_BRUTA, p);
  const pagam = (cs) => cs.filter(c => c.teacherId === 'theo' && Payroll.STATUS_QUE_PAGAM.indexOf(c.status) !== -1
    && c.scheduledDate.toDate().getMonth() === 8);
  const horasAntes = Payroll.horasDasAulas(pagam(AGENDA_BRUTA), new Map());
  const horasDepois = Payroll.horasDasAulas(pagam(depois), new Map());
  assert.strictEqual(Math.round(horasAntes * 60), 8370, 'antes: 139h30 pela conta da FOLHA (closing-payroll.js)');
  assert.strictEqual(Math.round(horasDepois * 60), 8370 + 1135, 'depois: a folha dá exatamente a agenda + o que foi validado (158h25)');
  passou('aplicado o plano, o closing-payroll.js de verdade paga exatamente as horas validadas');

  // Idempotente: validar de novo a mesma declaração não muda mais nada.
  const agenda2 = H.agendaDoMes(depois, 'theo', 2026, 9);
  const p2 = H.plano(agenda2, declTheo);
  assert.strictEqual(p2.porDia.reduce((s, d) => s + d.ops.length + d.novas.length, 0), 0, 'segunda validação: zero mudanças (não soma duas vezes)');
  assert.strictEqual(H.resumo(agenda2, declTheo).delta, 530, 'e o que sobra de diferença são só os dois dias que viram troca');
  passou('validar duas vezes não aplica duas vezes');
}

/* ── 7. Quem trava o fechamento ────────────────────────────────────── */
{
  const pessoas = ['theo', 'bia', 'caio', 'duda', 'eva'];
  const decls = [
    { teacherId: 'theo', mes: '2026-10', status: 'enviada' },
    { teacherId: 'bia', mes: '2026-10', status: 'validada' },
    { teacherId: 'caio', mes: '2026-10', status: 'rascunho' },
    { teacherId: 'duda', mes: '2026-10', status: 'dispensada' },
  ];
  const r = H.pendenciasDoFechamento({ pessoas, declaracoes: decls, mes: '2026-10' });
  assert.deepStrictEqual(r.aValidar, ['theo'], 'enviada e não validada: espera a gestão');
  assert.deepStrictEqual(r.naoConferiram, ['caio', 'eva'], 'rascunho e quem nem abriu: não conferiram');
  assert.strictEqual(r.trava, true);
  assert.deepStrictEqual(H.pendenciasDoFechamento({ pessoas: ['bia', 'duda'], declaracoes: decls, mes: '2026-10' }),
    { aValidar: [], naoConferiram: [], trava: false }, 'validada e "fechar valendo a agenda" liberam');

  // Antes do início da regra, ninguém é cobrado por não ter conferido — mas o que foi enviado ainda espera o OK.
  const set = H.pendenciasDoFechamento({ pessoas, declaracoes: [{ teacherId: 'theo', mes: '2026-09', status: 'enviada' }], mes: '2026-09' });
  assert.deepStrictEqual(set, { aValidar: ['theo'], naoConferiram: [], trava: true },
    'setembro: quem não conferiu não trava (a regra começa em outubro), mas a lista do Theo trava até a gestão validar');
  assert.strictEqual(H.pendenciasDoFechamento({ pessoas, declaracoes: [], mes: '2026-08' }).trava, false, 'agosto fecha como sempre fechou');
  assert.strictEqual(H.INICIO_CONFERENCIA, '2026-10');
  // "Está tudo igual à agenda": não há o que a gestão validar — não pode virar fila de OK.
  assert.deepStrictEqual(H.pendenciasDoFechamento({ pessoas: ['eva'], mes: '2026-10',
    declaracoes: [{ teacherId: 'eva', mes: '2026-10', status: 'enviada', semDiferenca: true }] }),
    { aValidar: [], naoConferiram: [], trava: false }, 'quem confirmou "tudo igual" está conferido, sem esperar OK');
  passou('fechamento: declaração enviada sempre espera o OK; "não conferiu" só cobra a partir de outubro/2026');
}

/* ── 7b. O turno novo vira uma aula avulsa, com o que ela precisa ter ── */
{
  const diaAg = agenda.find(x => x.dia === D(9));   // quarta: só a manhã na grade, unidade cp
  const n = H.aulaAvulsa({ dia: D(9), nova: { inicio: '16:30', fim: '21:30', minutos: 300 }, teacherId: 'theo',
    agendaDia: diaAg, padrao: { unitId: 'pp', modalityId: 'outra' }, declaracaoId: 'theo_2026-09' });
  assert.deepStrictEqual({ u: n.unitId, m: n.modalityId, t: n.teacherId, o: n.originalTeacherId, i: n.startTime, f: n.endTime, d: n.durationMinutes },
    { u: 'cp', m: 'hiit', t: 'theo', o: 'theo', i: '16:30', f: '21:30', d: 300 }, 'unidade e modalidade vêm das aulas do próprio dia');
  assert.deepStrictEqual({ s: n.status, g: n.generatedBy, r: n.remunerada, a: n.registroAutomatico, c: n.monthClosingId, id: n.horasDeclaracaoId, h: n.isHoliday },
    { s: 'realizada', g: 'horas-do-mes', r: true, a: false, c: null, id: 'theo_2026-09', h: false }, 'nasce realizada, paga, e marcada de onde veio');
  assert.strictEqual(H.diaISO(n.scheduledDate), D(9), 'no dia certo');
  assert.ok(n.scheduledDate instanceof Date, 'a data é Date (texto não entra em busca por período — o defeito das 44 aulas invisíveis de 24/08)');
  const semDia = H.aulaAvulsa({ dia: D(13), nova: { inicio: '08:00', fim: '12:00', minutos: 240 }, teacherId: 'theo',
    agendaDia: null, padrao: { unitId: 'pp', modalityId: 'outra' }, declaracaoId: 'x' });
  assert.deepStrictEqual({ u: semDia.unitId, m: semDia.modalityId }, { u: 'pp', m: 'outra' }, 'dia sem aula nenhuma usa o padrão da pessoa');
  assert.ok(Payroll.contaParaPagamento(n) && Payroll.minutosEfetivos(n) === 300, 'e a folha conta os 300 minutos dela');
  passou('aulaAvulsa monta a aula do turno novo: unidade do dia, realizada, paga, com a origem marcada');
}

/* ── 8. A situação de cada pessoa, em palavras ─────────────────────── */
{
  assert.strictEqual(H.situacao(null), 'nao_conferiu');
  assert.strictEqual(H.situacao({ status: 'rascunho' }), 'rascunho');
  assert.strictEqual(H.situacao({ status: 'enviada', semDiferenca: true }), 'enviada');
  assert.strictEqual(H.situacao({ status: 'validada' }), 'validada');
  ['nao_conferiu', 'rascunho', 'enviada', 'validada', 'devolvida', 'dispensada'].forEach(s =>
    assert.ok(H.ROTULOS[s] && H.ROTULOS[s] !== s, 'rótulo legível para ' + s));
  passou('cada situação tem rótulo legível');
}

console.log(`\n${ok} verificações ✓`);
