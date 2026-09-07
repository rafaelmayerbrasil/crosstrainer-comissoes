'use strict';
// Roda: node scripts/smoke-folha-por-pessoa.js
//
// ══════════════════════════════════════════════════════════════════════
// A folha do mês tem UMA linha por pessoa — e o valor mensal entra UMA vez
// ══════════════════════════════════════════════════════════════════════
//
// Medido na produção em 05/09/2026, antes de qualquer mês ter sido fechado:
// o fechamento era por unidade, e quem dava aula na CP e na PP entrava nos
// dois. Bolsa de estágio, VR, VT e Outros saíam INTEIROS em cada fechamento —
// R$ 7.580,84 a mais só em agosto. O banco de horas protegia o excedente e
// mais nada.
//
// Casos reais que viraram teste: a Eduarda apareceria na PP com 0h (uma aula de
// Escola Interna, que não paga hora) e ainda levaria bolsa cheia + VT; o
// excedente do João Vitor e da Camila só existe SOMANDO as duas unidades.

const assert = require('assert');
const P = require('../closing-payroll.js');

let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);
const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, msg + ' (esperado ' + b + ', veio ' + a + ')');

const ANO = 2026, MES = 8;
const ultimoDia = new Date(ANO, MES, 0, 23, 59, 59);
const aula = (o) => Object.assign({
  id: 'c' + Math.random(), status: 'realizada', durationMinutes: 60,
  unitId: 'unit-cp', teacherId: 't1',
}, o);

const cenario = ({ classes, teachers, salaries, bancos }) => P.montarFolha({
  classes,
  teachers: new Map(teachers.map(t => [t.id, t])),
  salaries: new Map((salaries || []).map(s => [s.id, s])),
  scaleTypes: new Map(),
  ano: ANO, mes: MES, ultimoDiaDoMes: ultimoDia,
  bancos: bancos || {},
});

/* ── 1. efetivo nas duas unidades: uma linha, benefício uma vez ──── */
{
  const r = cenario({
    classes: [
      aula({ unitId: 'unit-cp', durationMinutes: 120 }),
      aula({ unitId: 'unit-pp', durationMinutes: 60 }),
    ],
    teachers: [{ id: 't1', name: 'BRUNO', type: 'efetivo' }],
    salaries: [{ id: 't1', remunerationType: 'hora_aula', hourlyRate: 25,
                 mealAllowance: 100, transportAllowance: 150 }],
  });
  assert.strictEqual(r.pessoas.length, 1, 'quem dá aula nas duas unidades é UMA pessoa na folha');
  const p = r.pessoas[0];
  perto(p.totalHoras, 3, 'as horas das duas unidades somam');
  perto(p.valorHoras, 75, '3h x R$ 25');
  perto(p.mealAllowance + p.transportAllowance, 250, 'VR e VT entram UMA vez — era o buraco de R$ 7.580,84');
  perto(p.valorTotal, 325, 'total = horas + benefício, uma vez só');
  ok('efetivo nas duas unidades: uma linha, benefício uma vez');
}

/* ── 2. e a divisão por unidade continua visível ──────────────────── */
{
  const r = cenario({
    classes: [
      aula({ unitId: 'unit-cp', durationMinutes: 120 }),
      aula({ unitId: 'unit-pp', durationMinutes: 60 }),
      aula({ unitId: 'unit-pp', durationMinutes: 60 }),
    ],
    teachers: [{ id: 't1', name: 'BRUNO', type: 'efetivo' }],
    salaries: [{ id: 't1', remunerationType: 'hora_aula', hourlyRate: 10 }],
  });
  const p = r.pessoas[0];
  assert.strictEqual(p.porUnidade.length, 2, 'a folha diz em quantas unidades a pessoa deu aula');
  const cp = p.porUnidade.find(u => u.unitId === 'unit-cp');
  const pp = p.porUnidade.find(u => u.unitId === 'unit-pp');
  perto(cp.horas, 2, 'CP com 2h'); perto(pp.horas, 2, 'PP com 2h');
  assert.strictEqual(cp.classesCount, 1); assert.strictEqual(pp.classesCount, 2);
  perto(cp.horas + pp.horas, p.totalHoras, 'a soma das unidades tem que fechar com o total');
  ok('a divisão por unidade continua visível (o custo por unidade não se perde)');
}

/* ── 3. estagiário: bolsa uma vez, excedente sobre o TOTAL ────────── */
{
  // O caso do João Vitor: 86h na CP + 10,5h na PP. Olhando uma unidade por vez
  // ele está dentro do contrato nas duas; o excedente só existe somando.
  const r = cenario({
    classes: [
      ...Array.from({ length: 86 }, () => aula({ unitId: 'unit-cp' })),
      ...Array.from({ length: 10 }, () => aula({ unitId: 'unit-pp', durationMinutes: 63 })),
    ],
    teachers: [{ id: 't1', name: 'JOAO VITOR', type: 'estagiario' }],
    salaries: [{ id: 't1', remunerationType: 'bolsa', internMonthlyStipend: 876.67,
                 internMonthlyLimitMinutes: 5160, internProportionalHourlyRate: 10.19,
                 transportAllowance: 250 }],
  });
  assert.strictEqual(r.pessoas.length, 1, 'uma linha só');
  const p = r.pessoas[0];
  perto(p.totalHoras, 96.5, '86h + 10,5h');
  perto(p.internExcessHours, 10.5, 'o excedente só aparece somando as unidades');
  perto(p.valorHoras, 876.67 + 106.99, 'bolsa UMA vez + o excedente');
  perto(p.transportAllowance, 250, 'VT uma vez');
  ok('estagiário: bolsa uma vez e excedente calculado sobre o mês inteiro');
}

/* ── 4. o caso da Eduarda: aula que não paga hora na outra unidade ─ */
{
  const r = cenario({
    classes: [
      ...Array.from({ length: 100 }, () => aula({ unitId: 'unit-cp' })),
      aula({ unitId: 'unit-pp', specialScaleType: 'escola_interna' }),
    ],
    teachers: [{ id: 't1', name: 'EDUARDA', type: 'estagiario' }],
    salaries: [{ id: 't1', remunerationType: 'bolsa', internMonthlyStipend: 939.17,
                 internMonthlyLimitMinutes: 6321, internProportionalHourlyRate: 8.91,
                 transportAllowance: 250 }],
  });
  assert.strictEqual(r.pessoas.length, 1,
    'uma aula de Escola Interna na outra unidade não pode virar uma segunda bolsa');
  const p = r.pessoas[0];
  perto(p.totalHoras, 100, 'Escola Interna não paga hora');
  perto(p.valorHoras, 939.17, 'bolsa cheia, uma vez');
  perto(p.valorTotal, 939.17 + 250, 'e VT uma vez');
  ok('aula que não paga hora na outra unidade não duplica bolsa nem VT');
}

/* ── 5. quem não recebe por aula fica fora ────────────────────────── */
{
  const r = cenario({
    classes: [aula({ teacherId: 'socio' }), aula({ teacherId: 't1' })],
    teachers: [{ id: 't1', name: 'BRUNO', type: 'efetivo' },
               { id: 'socio', name: 'RAFAEL ROJAIS', type: 'efetivo', naoRemunerado: true }],
    salaries: [{ id: 't1', remunerationType: 'hora_aula', hourlyRate: 10 }],
  });
  assert.strictEqual(r.pessoas.length, 1, 'quem dá aula sem receber não entra na folha');
  ok('quem não recebe por aula fica fora');
}

/* ── 6. só realizada e substituída entram ─────────────────────────── */
{
  const r = cenario({
    classes: [aula({ status: 'prevista' }), aula({ status: 'cancelada' }),
              aula({ status: 'substituida' })],
    teachers: [{ id: 't1', name: 'BRUNO', type: 'efetivo' }],
    salaries: [{ id: 't1', remunerationType: 'hora_aula', hourlyRate: 10 }],
  });
  perto(r.pessoas[0].totalHoras, 1, 'aula prevista e cancelada não pagam');
  ok('só realizada e substituída entram');
}

/* ── 7. o total do mês é a soma das linhas ────────────────────────── */
{
  const r = cenario({
    classes: [aula({ teacherId: 't1' }), aula({ teacherId: 't2', unitId: 'unit-pp' })],
    teachers: [{ id: 't1', name: 'A', type: 'efetivo' }, { id: 't2', name: 'B', type: 'efetivo' }],
    salaries: [{ id: 't1', remunerationType: 'hora_aula', hourlyRate: 10, mealAllowance: 5 },
               { id: 't2', remunerationType: 'hora_aula', hourlyRate: 20 }],
  });
  perto(r.totais.totalValor, 35, 'o total do mês é a soma das pessoas');
  perto(r.totais.totalHoras, 2, 'e das horas');
  assert.strictEqual(r.totais.classesRealizadas, 2);
  assert.deepStrictEqual(r.totais.unitIds.slice().sort(), ['unit-cp', 'unit-pp'],
    'o fechamento registra quais unidades ele cobriu');
  ok('os totais fecham com as linhas');
}

/* ── 8. eventual com bolsa segue a regra do estagiário ───────────── */
{
  // O caso do Thiago Valentim (agosto/2026): ficha 'eventual', cadastro salarial
  // de bolsa. Caía na conta por hora, não tinha valor/hora, e o fechamento
  // pagaria R$ 0,00 por 76,25h — calado. Decisão do Rafael em 05/09/2026: quem
  // tem BOLSA cadastrada recebe pela regra da bolsa, seja estagiário ou eventual.
  const r = cenario({
    classes: Array.from({ length: 10 }, () => aula({})),
    teachers: [{ id: 't1', name: 'THIAGO', type: 'eventual' }],
    salaries: [{ id: 't1', remunerationType: 'bolsa', internMonthlyStipend: 668.46,
                 internMonthlyLimitMinutes: 480, internProportionalHourlyRate: 10.19,
                 transportAllowance: 250 }],
  });
  const p = r.pessoas[0];
  assert.strictEqual(p.isIntern, true, 'eventual com bolsa entra na regra da bolsa');
  perto(p.valorHoras, 668.46 + 2 * 10.19, 'bolsa cheia + as 2h que passaram do contrato');
  assert.ok(!p.avisos.includes('sem_valor_hora'),
    'com a bolsa reconhecida, não há mais nada de errado pra avisar');
  perto(p.valorTotal, 668.46 + 20.38 + 250, 'e o VT entra por cima');
  ok('eventual com bolsa recebe pela regra da bolsa (o caso do Thiago)');
}

/* ── 8b. eventual por hora-aula continua por hora ─────────────────── */
{
  const r = cenario({
    classes: Array.from({ length: 4 }, () => aula({})),
    teachers: [{ id: 't1', name: 'EVENTUAL POR HORA', type: 'eventual' }],
    salaries: [{ id: 't1', remunerationType: 'hora_aula', hourlyRate: 40 }],
  });
  assert.strictEqual(r.pessoas[0].isIntern, false, 'quem é hora-aula continua hora-aula');
  perto(r.pessoas[0].valorHoras, 160, '4h x R$ 40');
  ok('eventual por hora-aula não é afetado');
}

/* ── 8c. horas valendo R$ 0,00 continuam virando aviso ───────────── */
{
  // Sem bolsa e sem valor/hora não há regra nenhuma pra aplicar: isso é erro de
  // cadastro, e tem que aparecer em vez de pagar zero calado.
  const r = cenario({
    classes: Array.from({ length: 5 }, () => aula({})),
    teachers: [{ id: 't1', name: 'SEM NADA', type: 'efetivo' }],
    salaries: [{ id: 't1', remunerationType: 'hora_aula' }],
  });
  const p = r.pessoas[0];
  perto(p.valorHoras, 0, 'sem valor/hora as horas valem zero');
  assert.ok(p.avisos.includes('sem_valor_hora'), 'e isso não pode passar calado');
  ok('horas valendo R$ 0,00 viram aviso, não silêncio');
}

/* ── 9. sem cadastro salarial nenhum também avisa ─────────────────── */
{
  const r = cenario({
    classes: [aula({})],
    teachers: [{ id: 't1', name: 'NOVATO', type: 'efetivo' }],
    salaries: [],
  });
  assert.ok(r.pessoas[0].avisos.includes('sem_salario'), 'quem não tem salário cadastrado tem que aparecer');
  ok('sem cadastro salarial vira aviso');
}

/* ── 10. rodar duas vezes dá o mesmo resultado ────────────────────── */
{
  const args = {
    classes: [aula({ unitId: 'unit-cp' }), aula({ unitId: 'unit-pp' })],
    teachers: [{ id: 't1', name: 'BRUNO', type: 'efetivo' }],
    salaries: [{ id: 't1', remunerationType: 'hora_aula', hourlyRate: 25, mealAllowance: 100 }],
  };
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(cenario(args))),
    JSON.parse(JSON.stringify(cenario(args))),
    'a folha é uma função dos dados: mesma entrada, mesma saída');
  ok('a mesma entrada dá sempre a mesma folha');
}

console.log('\n✅ smoke-folha-por-pessoa: ' + n + '/10');

/* ── 11. a cópia das Functions não pode divergir da raiz ──────────── */
{
  const PCF = require('../functions/closing-payroll.js');
  const args = {
    classes: [
      aula({ unitId: 'unit-cp', durationMinutes: 90 }),
      aula({ unitId: 'unit-pp', durationMinutes: 60, isHoliday: true }),
      aula({ unitId: 'unit-pp', specialScaleType: 'escola_interna' }),
      aula({ teacherId: 't2', unitId: 'unit-cp', atrasoMinutos: 10 }),
    ],
    teachers: new Map([
      ['t1', { id: 't1', name: 'EDUARDA', type: 'estagiario' }],
      ['t2', { id: 't2', name: 'THEO', type: 'efetivo' }],
    ]),
    salaries: new Map([
      ['t1', { id: 't1', remunerationType: 'bolsa', internMonthlyStipend: 939.17,
               internMonthlyLimitMinutes: 120, internProportionalHourlyRate: 8.91,
               transportAllowance: 250 }],
      ['t2', { id: 't2', remunerationType: 'hora_aula', hourlyRate: 16, mealAllowance: 150 }],
    ]),
    scaleTypes: new Map(), ano: ANO, mes: MES, ultimoDiaDoMes: ultimoDia, bancos: {},
  };
  assert.deepStrictEqual(PCF.montarFolha(args), P.montarFolha(args),
    'as duas cópias de closing-payroll divergiram — o deploy só leva functions/');
  ok('a cópia das Functions bate com a da raiz');
}

/* ── 12. a página carrega o módulo, e na ordem certa ─────────────── */
{
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'professores.html'), 'utf8');
  const ordem = [...html.matchAll(/<script src="([a-z0-9-]+\.js)\?v=([^"]+)"><\/script>/g)]
    .map(m => ({ arquivo: m[1], versao: m[2] }));
  const idx = a => ordem.findIndex(x => x.arquivo === a);

  assert.ok(idx('closing-payroll.js') !== -1, 'a conta da folha precisa estar no professores.html');
  assert.ok(idx('intern-hour-bank.js') < idx('closing-payroll.js'),
    'closing-payroll usa o banco de horas — tem que vir depois dele');
  assert.ok(idx('closing-payroll.js') < idx('professores-shared.js'),
    'professores-shared delega a conta — tem que vir depois de closing-payroll');
  ok('professores.html carrega closing-payroll.js na ordem em que ele é usado');
}

/* ── 15. o fechamento e a prévia respondem a MESMA coisa ─────────── */
{
  // O buraco desta sessão foi a conta existir em duas cópias. Estas duas
  // travas guardam as divergências que sobraram entre a Cloud Function e a
  // tela — as duas de dinheiro, as duas achadas revisando o diff.
  const fs = require('fs');
  const path = require('path');
  const cf = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');

  const agrupa = cf.slice(cf.indexOf('7) Agrupa classes por teacher'),
                          cf.indexOf('Sprint 6b — busca férias aprovadas'));
  assert.ok(/naoRemunerado/.test(agrupa),
    'o fechamento tem que pular quem não recebe por aula, igual à prévia');

  assert.ok(/payroll\.avisosDaLinha/.test(cf),
    'os avisos do mês fechado saem da mesma regra da prévia, não de uma cópia');

  // e a regra em si, exercitada:
  assert.deepStrictEqual(P.avisosDaLinha({ temSalario: false }), ['sem_salario']);
  assert.deepStrictEqual(P.avisosDaLinha({ temSalario: true, horas: 10, hourlyRate: 0 }), ['sem_valor_hora']);
  assert.deepStrictEqual(P.avisosDaLinha({ temSalario: true, horas: 0, hourlyRate: 0 }), [],
    'sem hora nenhuma não há o que avisar sobre valor/hora');
  assert.deepStrictEqual(P.avisosDaLinha({ temSalario: true, isIntern: true, semContrato: true }),
    ['sem_contrato_horas']);
  assert.deepStrictEqual(P.avisosDaLinha({ temSalario: true, isIntern: true, qtdUnidades: 2 }),
    ['duas_unidades']);
  ok('fechamento e prévia usam a mesma regra de "quem fica de fora" e de avisos');
}

/* ── 16. custo por unidade: a soma bate com a folha, no centavo ──── */
{
  // Pedido do Rafael em 07/09/2026: o bloco "custo por unidade" mostrava
  // aulas e horas, faltava o dinheiro. O valor MENSAL (bolsa, VR, VT) não é
  // de uma unidade — é da pessoa. Então é rateio, e rateio que não fecha com
  // a folha vira duas verdades na mesma tela.
  const r = cenario({
    classes: [
      aula({ unitId: 'unit-cp', durationMinutes: 120 }),
      aula({ unitId: 'unit-pp', durationMinutes: 60 }),
      aula({ teacherId: 't2', unitId: 'unit-pp', durationMinutes: 60 }),
    ],
    teachers: [{ id: 't1', name: 'BRUNO', type: 'efetivo' }, { id: 't2', name: 'ANA', type: 'efetivo' }],
    salaries: [
      { id: 't1', remunerationType: 'hora_aula', hourlyRate: 33.33, mealAllowance: 100.01 },
      { id: 't2', remunerationType: 'hora_aula', hourlyRate: 20 },
    ],
  });
  const un = P.resumoPorUnidade(r.pessoas);
  const soma = un.reduce((s, u) => s + u.custo, 0);
  perto(soma, r.totais.totalValor, 'a soma do custo por unidade tem que ser a folha inteira');
  assert.strictEqual(Math.round(soma * 100), Math.round(r.totais.totalValor * 100),
    'e no centavo: sobra de arredondamento vira duas verdades na mesma tela');
  ok('custo por unidade: a soma bate com a folha, no centavo');
}

/* ── 17. quem está numa unidade só leva o custo inteiro nela ─────── */
{
  const r = cenario({
    classes: [aula({ unitId: 'unit-pp' })],
    teachers: [{ id: 't1', name: 'ANA', type: 'efetivo' }],
    salaries: [{ id: 't1', remunerationType: 'hora_aula', hourlyRate: 50, transportAllowance: 250 }],
  });
  const un = P.resumoPorUnidade(r.pessoas);
  assert.strictEqual(un.length, 1);
  perto(un[0].custo, 300, 'R$ 50 da hora + R$ 250 de VT, tudo na única unidade onde ela trabalhou');
  ok('quem está numa unidade só leva o custo inteiro nela');
}

/* ── 18. em duas unidades, o rateio segue as HORAS ───────────────── */
{
  const r = cenario({
    classes: [
      aula({ unitId: 'unit-cp', durationMinutes: 180 }),   // 3h
      aula({ unitId: 'unit-pp', durationMinutes: 60 }),    // 1h
    ],
    teachers: [{ id: 't1', name: 'BRUNO', type: 'efetivo' }],
    salaries: [{ id: 't1', remunerationType: 'hora_aula', hourlyRate: 10, mealAllowance: 40 }],
  });
  const un = P.resumoPorUnidade(r.pessoas);
  const cp = un.find(u => u.unitId === 'unit-cp');
  const pp = un.find(u => u.unitId === 'unit-pp');
  // total 80 = 4h × 10 + 40 de VR · 3/4 na CP, 1/4 na PP
  perto(cp.custo, 60, 'CP com 3 das 4 horas fica com 3/4 do custo');
  perto(pp.custo, 20, 'PP com 1 das 4 horas fica com 1/4');
  ok('em duas unidades, o rateio segue as horas');
}

/* ── 19. quem não teve hora nenhuma não quebra o rateio ──────────── */
{
  // Acontece de verdade: aula de Escola Interna não paga hora, e a pessoa
  // aparece na unidade com 0h. Dividir por zero devolveria NaN na tela.
  const r = cenario({
    classes: [
      aula({ unitId: 'unit-cp', specialScaleType: 'escola_interna' }),
      aula({ unitId: 'unit-pp', specialScaleType: 'escola_interna' }),
    ],
    teachers: [{ id: 't1', name: 'ANA', type: 'estagiario' }],
    salaries: [{ id: 't1', remunerationType: 'bolsa', internMonthlyStipend: 900,
                 internMonthlyLimitMinutes: 6000, transportAllowance: 100 }],
  });
  const un = P.resumoPorUnidade(r.pessoas);
  const soma = un.reduce((s, u) => s + u.custo, 0);
  assert.ok(un.every(u => isFinite(u.custo)), 'nenhum custo pode sair NaN');
  perto(soma, r.pessoas[0].valorTotal, 'e a bolsa + VT continuam inteiros na soma');
  ok('quem não teve hora nenhuma não quebra o rateio');
}

/* ── 20. o resumo traz o nome da unidade e quanta gente ──────────── */
{
  const r = cenario({
    classes: [aula({ unitId: 'unit-cp' }), aula({ teacherId: 't2', unitId: 'unit-cp' })],
    teachers: [{ id: 't1', name: 'A', type: 'efetivo' }, { id: 't2', name: 'B', type: 'efetivo' }],
    salaries: [{ id: 't1', remunerationType: 'hora_aula', hourlyRate: 10 },
               { id: 't2', remunerationType: 'hora_aula', hourlyRate: 10 }],
  });
  const un = P.resumoPorUnidade(r.pessoas, new Map([['unit-cp', { name: 'CrossTainer CP' }]]));
  assert.strictEqual(un[0].unitName, 'CrossTainer CP', 'o nome vem de units quando existe');
  assert.strictEqual(un[0].pessoas, 2);
  assert.strictEqual(un[0].classesCount, 2);
  ok('o resumo traz o nome da unidade e quanta gente');
}

console.log('');
console.log('OK smoke-folha-por-pessoa: ' + n + ' casos');
