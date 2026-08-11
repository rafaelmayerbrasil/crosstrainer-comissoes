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

console.log('\n✅ smoke-banco-horas-estagiario OK');
