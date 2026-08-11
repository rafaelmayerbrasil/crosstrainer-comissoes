'use strict';
// Smoke do banco de horas do estagiário (bloco 2c, 07/08/2026).
// Regra: trabalhou mais → paga no mês · trabalhou menos → bolsa cheia e vira
// saldo negativo · extras futuras quitam o saldo antes de virar pagamento.
//
// Roda: node scripts/smoke-banco-horas-estagiario.js

const assert = require('assert');
const B = require('../intern-hour-bank.js');

const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.001, `${msg} — esperado ${b}, veio ${a}`);

// ════════════ trabalhou a mais, sem dívida ════════════
{
  const r = B.fecharMes(120, 105, 0);
  perto(r.horasPagas, 15, 'paga as 15 horas a mais');
  perto(r.horasQuitadas, 0, 'não havia dívida');
  perto(r.saldoFinal, 0, 'saldo segue zerado');
  console.log('✓ trabalhou a mais sem dívida: paga tudo, saldo zero');

  // sobra NUNCA vira crédito
  assert.ok(r.saldoFinal <= 0, 'saldo não pode ficar positivo');
  console.log('✓ sobra não vira crédito — é paga na hora');
}

// ════════════ trabalhou a menos ════════════
{
  const r = B.fecharMes(90, 105, 0);
  perto(r.horasPagas, 0, 'nada de adicional');
  perto(r.saldoFinal, -15, 'as 15 que faltaram viram dívida');
  console.log('✓ trabalhou a menos: bolsa cheia e −15h no saldo');
}

// ════════════ o exemplo que combinamos: deve 6, faz 10 a mais ════════════
{
  const r = B.fecharMes(115, 105, -6);
  perto(r.horasQuitadas, 6, '6h quitam a dívida');
  perto(r.horasPagas, 4, 'sobram 4h pagas');
  perto(r.saldoFinal, 0, 'saldo zera');
  console.log('✓ devia 6h, fez 10 a mais: 6 quitam, 4 são pagas, saldo zera');
}

// ════════════ extras não cobrem a dívida inteira ════════════
{
  const r = B.fecharMes(110, 105, -20);
  perto(r.horasQuitadas, 5, 'as 5 extras abatem');
  perto(r.horasPagas, 0, 'não sobra nada pra pagar');
  perto(r.saldoFinal, -15, 'ainda deve 15h');
  console.log('✓ extras insuficientes: abatem tudo, nada é pago, dívida diminui');
}

// ════════════ dívida acumula mês a mês ════════════
{
  let saldo = 0;
  for (let i = 0; i < 3; i++) saldo = B.fecharMes(90, 105, saldo).saldoFinal;
  perto(saldo, -45, '3 meses de −15h');
  console.log('✓ a dívida acumula ao longo dos meses (−45h em 3 meses)');

  // sem teto — foi decisão explícita do cliente
  let grande = 0;
  for (let i = 0; i < 12; i++) grande = B.fecharMes(80, 105, grande).saldoFinal;
  perto(grande, -300, 'sem teto, como decidido');
  console.log('✓ sem teto para o saldo negativo');
}

// ════════════ férias não podem gerar dívida ════════════
{
  // mês de 30 dias, 30 de férias → contrato zero
  perto(B.contratoDoMes(105, 30, 30), 0, 'mês inteiro de férias');
  const r = B.fecharMes(0, B.contratoDoMes(105, 30, 30), 0);
  perto(r.saldoFinal, 0, 'férias não podem gerar dívida');
  console.log('✓ mês inteiro de férias não gera dívida nenhuma');

  // metade do mês de férias → metade do contrato
  perto(B.contratoDoMes(105, 30, 15), 52.5, 'metade do mês');
  const r2 = B.fecharMes(52.5, B.contratoDoMes(105, 30, 15), 0);
  perto(r2.saldoFinal, 0, 'quem cumpriu a parte dele não fica devendo');
  console.log('✓ férias parciais reduzem o contrato proporcionalmente');

  perto(B.contratoDoMes(105, 30, 0), 105, 'sem afastamento, contrato cheio');
  console.log('✓ sem afastamento o contrato é o cheio');
}

// ════════════ bateu exato ════════════
{
  const r = B.fecharMes(105, 105, -10);
  perto(r.horasPagas, 0);
  perto(r.saldoFinal, -10, 'saldo não se mexe se bateu exato');
  console.log('✓ bateu o contrato exato: saldo intacto');
}

// ════════════ entradas tortas ════════════
{
  perto(B.fecharMes(null, 105, 0).saldoFinal, -105, 'sem horas = trabalhou zero');
  perto(B.fecharMes(-50, 105, 0).saldoFinal, -105, 'horas negativas viram zero');
  perto(B.fecharMes(120, 105, 30).horasPagas, 15, 'saldo positivo vindo de fora é tratado como zero');
  console.log('✓ nulo, negativo e saldo positivo indevido não quebram');
}

// ════════════ o caso real da Thaynara ════════════
{
  // contrato 129h, grade entrega ~110h → dívida que nunca quita
  let saldo = 0;
  for (let i = 0; i < 6; i++) saldo = B.fecharMes(110, 129, saldo).saldoFinal;
  assert.ok(saldo < -100, 'a dívida cresce sem parar quando a grade não alcança o contrato');
  console.log(`✓ caso Thaynara: 6 meses → ${saldo.toFixed(0)}h de dívida impagável (o alerta ao cliente procede)`);
}

// ════════════ o texto explica a conta ════════════
{
  const r = B.fecharMes(115, 105, -6);
  const t = B.explicar(r, 105, 115);
  assert.ok(t.includes('115') && t.includes('105'), 'mostra horas e contrato');
  assert.ok(/abateram/.test(t), 'diz quanto abateu');
  assert.ok(/Saldo zerado/.test(t), 'diz como ficou o saldo');
  console.log('✓ o texto do recibo abre a conta:');
  console.log('    "' + t + '"');
}

// ════════════ o mesmo mês fechado duas vezes (professor em 2 unidades) ════════════
// O fechamento é POR UNIDADE. Quem dá aula na CP e na PP tem o mês fechado duas
// vezes — e cada fechamento sozinho enxergaria só metade das horas, comparando
// meia grade com o contrato inteiro. Sem isso, quem trabalha nas duas unidades
// acumularia dívida por um mês em que cumpriu o contrato.
{
  const contrato = 105;

  // 1º fechamento (CP): 60h das 120 do mês
  const a = B.revisarMes(60, contrato, null, 0);
  perto(a.horasTrabalhadas, 60, 'só o que essa unidade viu');
  perto(a.horasPagasAgora, 0, 'nada de extra ainda');
  perto(a.saldoFinal, -45, 'sozinho, o 1º fechamento registra dívida');

  // 2º fechamento (PP): mais 60h — o mês inteiro passa a ser 120h
  const mov = { horasTrabalhadas: a.horasTrabalhadas, horasPagas: a.horasPagas, saldoAnterior: a.saldoAnterior };
  const b = B.revisarMes(60, contrato, mov, a.saldoFinal);
  perto(b.horasTrabalhadas, 120, 'o mês soma as duas unidades');
  perto(b.horasPagasAgora, 15, 'as 15h a mais são pagas neste fechamento');
  perto(b.saldoFinal, 0, 'a dívida do 1º fechamento é desfeita, não somada');
  console.log('✓ mês fechado nas 2 unidades: o 2º revisa o mês inteiro, não empilha dívida');
}

// ════════════ revisão não paga a mesma hora duas vezes ════════════
{
  const primeiro = B.revisarMes(120, 105, null, 0);
  perto(primeiro.horasPagasAgora, 15, 'pagou as 15h extras');

  const mov = { horasTrabalhadas: 120, horasPagas: primeiro.horasPagas, saldoAnterior: 0 };
  const denovo = B.revisarMes(0, 105, mov, primeiro.saldoFinal);
  perto(denovo.horasPagasAgora, 0, 'a 2ª passada não paga de novo');
  perto(denovo.saldoFinal, 0, 'e não mexe no saldo');
  console.log('✓ revisar o mesmo mês não paga a mesma hora duas vezes');
}

// ════════════ revisão parte do saldo de ANTES do mês ════════════
{
  // devia 20h antes do mês. 1º fechamento vê 100h (contrato 105) → parece −5
  const a = B.revisarMes(100, 105, null, -20);
  perto(a.saldoAnterior, -20, 'guarda de onde partiu');
  perto(a.saldoFinal, -25, 'sozinho pioraria pra −25');

  // 2ª unidade traz mais 30h → mês tem 130h, 25 a mais que o contrato
  const mov = { horasTrabalhadas: a.horasTrabalhadas, horasPagas: a.horasPagas, saldoAnterior: a.saldoAnterior };
  const b = B.revisarMes(30, 105, mov, a.saldoFinal);
  perto(b.horasQuitadas, 20, 'as extras quitam a dívida ANTIGA, não a fantasma do 1º fechamento');
  perto(b.horasPagasAgora, 5, 'sobram 5h pagas');
  perto(b.saldoFinal, 0, 'saldo zera');
  console.log('✓ a revisão recomeça do saldo anterior ao mês — a dívida-fantasma some');
}

// ════════════ o mês inteiro do estagiário, em uma conta só ════════════
// É esta função que o fechamento (Cloud Function) e a prévia da tela chamam —
// as duas TÊM que dar o mesmo número, senão o admin vê um valor e recebe outro.
{
  const base = {
    limiteHoras: 105, stipend: 1200, propRate: 12,
    diasNoMes: 31, diasAfastado: 0, movimento: null, saldoAtual: 0,
  };

  // trabalhou a mais, sem dívida: bolsa + as extras
  const r = B.calcularMesEstagiario({ ...base, horas: 120 });
  perto(r.contratoMes, 105, 'contrato cheio');
  perto(r.horasPagasAgora, 15, '15h extras');
  perto(r.valorExtra, 180, '15h × R$ 12');
  perto(r.valorHoras, 1380, 'bolsa + extras');
  perto(r.saldoFinal, 0, 'saldo zerado');
  assert.ok(typeof r.explicacao === 'string' && r.explicacao.length > 0, 'traz a conta aberta');

  // trabalhou a menos: BOLSA CHEIA (nunca reduzir a bolsa) e dívida em horas
  const menos = B.calcularMesEstagiario({ ...base, horas: 90 });
  perto(menos.valorHoras, 1200, 'a bolsa não encolhe — é vinculada ao termo de estágio');
  perto(menos.valorExtra, 0, 'nada de extra');
  perto(menos.saldoFinal, -15, 'a diferença vira saldo de horas');

  // com dívida antiga: as extras quitam antes de virar dinheiro
  const comDivida = B.calcularMesEstagiario({ ...base, horas: 120, saldoAtual: -10 });
  perto(comDivida.horasQuitadas, 10, '10h quitam');
  perto(comDivida.valorExtra, 60, 'só as 5h que sobraram são pagas');
  perto(comDivida.saldoFinal, 0, 'saldo zera');

  // férias reduzem o contrato do mês
  const ferias = B.calcularMesEstagiario({ ...base, horas: 60, diasNoMes: 30, diasAfastado: 15 });
  perto(ferias.contratoMes, 52.5, 'metade do mês de férias, metade do contrato');
  perto(ferias.saldoFinal, 0, 'férias não geram dívida');
  perto(ferias.valorHoras, 1290, 'bolsa cheia + as 7,5h acima do contrato reduzido');

  // sem contrato cadastrado não inventa dívida
  const semLimite = B.calcularMesEstagiario({ ...base, horas: 100, limiteHoras: 0 });
  perto(semLimite.saldoFinal, 0, 'sem contrato, sem saldo');
  perto(semLimite.valorHoras, 1200, 'paga a bolsa e para por aí');
  assert.strictEqual(semLimite.semContrato, true, 'avisa que falta o contrato em vez de chutar');

  console.log('✓ calcularMesEstagiario fecha o mês inteiro (contrato, saldo, extras e valor)');
}

// ════════════ as duas cópias não podem divergir ════════════
// O deploy das Functions só leva a pasta functions/, então o módulo existe em
// dois lugares. Se alguém corrigir um e esquecer o outro, o valor pago pela tela
// e o calculado no fechamento passam a discordar — e ninguém percebe.
{
  const BCF = require('../functions/intern-hour-bank.js');

  const casos = [
    [120, 105, 0], [90, 105, 0], [115, 105, -6], [110, 105, -20],
    [105, 105, -10], [0, 105, -30], [200, 86, -50], [null, 105, 0], [-50, 105, -5],
  ];
  casos.forEach(([h, c, s]) => {
    assert.deepStrictEqual(BCF.fecharMes(h, c, s), B.fecharMes(h, c, s),
      `as duas cópias divergiram em fecharMes(${h}, ${c}, ${s})`);
  });

  [[105, 30, 0], [105, 30, 15], [105, 30, 30], [105, 31, 10], [0, 30, 5]].forEach(([l, d, a]) => {
    assert.strictEqual(BCF.contratoDoMes(l, d, a), B.contratoDoMes(l, d, a),
      `as duas cópias divergiram em contratoDoMes(${l}, ${d}, ${a})`);
  });

  // a conta que vira dinheiro é a que mais importa comparar
  const meses = [
    { horas: 120, limiteHoras: 105, stipend: 1200, propRate: 12, diasNoMes: 31, diasAfastado: 0, movimento: null, saldoAtual: 0 },
    { horas: 90, limiteHoras: 105, stipend: 1200, propRate: 12, diasNoMes: 31, diasAfastado: 0, movimento: null, saldoAtual: -30 },
    { horas: 60, limiteHoras: 105, stipend: 1200, propRate: 12, diasNoMes: 30, diasAfastado: 15, movimento: null, saldoAtual: 0 },
    { horas: 40, limiteHoras: 105, stipend: 1200, propRate: 12, diasNoMes: 31, diasAfastado: 0, saldoAtual: -5,
      movimento: { horasTrabalhadas: 80, horasPagas: 0, saldoAnterior: 0 } },
    { horas: 100, limiteHoras: 0, stipend: 1200, propRate: 12, diasNoMes: 31, diasAfastado: 0, movimento: null, saldoAtual: 0 },
  ];
  meses.forEach((m, i) => {
    assert.deepStrictEqual(BCF.calcularMesEstagiario(m), B.calcularMesEstagiario(m),
      `as duas cópias divergiram em calcularMesEstagiario, caso ${i + 1}`);
  });
  console.log(`✓ a cópia das Functions bate com a da raiz em ${casos.length + 5 + meses.length} casos`);
}

console.log('\n✅ smoke-banco-horas-estagiario OK');
