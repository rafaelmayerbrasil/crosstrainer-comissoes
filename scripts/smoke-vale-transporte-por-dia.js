'use strict';
// Roda: node scripts/smoke-vale-transporte-por-dia.js
process.env.TZ = 'America/Sao_Paulo';
//
// Vale-transporte por DIA TRABALHADO — a conta (closing-payroll.js).
//
// Benny, no grupo (06/10/2026): "A gente paga após. O valor é 6,20 por
// passagem. Então por exemplo: 24 dias x 2 passagens = 48 passagens x 6,20 =
// 297,60. Dias úteis do mês + sábado/feriados que trabalharem."
//
// Até aqui o VT era um valor fixo no cadastro (R$ 250 para os bolsistas) e a
// conta de verdade era feita por fora. Decisões do Rafael: conta só o dia em
// que a pessoa deu aula · quem entra é quem tem a marca no cadastro · passagens
// por dia ajustáveis por pessoa (padrão 2) · valor da passagem configurável ·
// o VT do mês pode ser corrigido no fechamento.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const P = require('../closing-payroll.js');

let n = 0;
const ok = (m) => console.log('✓ ' + (++n) + '. ' + m);
const ts = (dia) => { const [y, m, d] = dia.split('-').map(Number); return { toDate: () => new Date(y, m - 1, d) }; };
let seq = 0;
const aula = (dia, extra) => Object.assign({ id: 'c' + (++seq), teacherId: 'edu', unitId: 'cp', status: 'realizada',
  scheduledDate: ts(dia), startTime: '07:00', endTime: '08:00', durationMinutes: 60 }, extra || {});
const D = (d) => `2026-09-${String(d).padStart(2, '0')}`;
const TARIFA = { tarifas: [{ desde: '2026-09', valor: 6.2 }] };
const uteisDeSetembro = []; for (let d = 1; d <= 30; d++) { const w = new Date(2026, 8, d).getDay(); if (w >= 1 && w <= 5 && d !== 7) uteisDeSetembro.push(d); }

/* ── 1. O exemplo da Benny, ao pé da letra ──────────────────────────── */
{
  const dias = []; for (let d = 1; d <= 24; d++) dias.push(aula(`2026-06-${String(d).padStart(2, '0')}`));
  const vt = P.valeTransporte({ salary: { vtPorDia: true }, aulas: dias, vtConfig: { tarifas: [{ desde: '2026-01', valor: 6.2 }] }, mes: '2026-06' });
  assert.strictEqual(vt.dias, 24); assert.strictEqual(vt.passagensPorDia, 2);
  assert.strictEqual(vt.valor, 297.6, '24 dias × 2 passagens × R$ 6,20 = R$ 297,60');
  ok('o exemplo da Benny: 24 dias × 2 × 6,20 = 297,60');
}

/* ── 2. Setembro real: úteis + sábado + feriado trabalhados ─────────── */
{
  assert.strictEqual(uteisDeSetembro.length, 21, 'setembro/2026 tem 21 dias úteis (o 07/09 é feriado)');
  const aulas = uteisDeSetembro.flatMap(d => [aula(D(d)), aula(D(d), { startTime: '08:00', endTime: '09:00' })])   // duas aulas por dia: UM dia
    .concat([aula(D(5), { specialScaleType: 'sabado' }), aula(D(7), { specialScaleType: 'feriado', isHoliday: true })]);
  const d = P.diasTrabalhados(aulas);
  assert.deepStrictEqual({ dias: d.dias, uteis: d.uteis, fds: d.fimDeSemana, fer: d.feriados }, { dias: 23, uteis: 21, fds: 1, fer: 1 });
  const vt = P.valeTransporte({ salary: { vtPorDia: true, transportAllowance: 250 }, aulas, vtConfig: TARIFA, mes: '2026-09' });
  assert.strictEqual(vt.valor, 285.2, '23 dias × 2 × 6,20 = 285,20 (a Eduarda e a Thaynara em setembro)');
  assert.strictEqual(vt.modo, 'por_dia');
  ok('várias aulas no dia contam um dia; sábado e feriado trabalhados entram');
}

/* ── 3. Só conta o dia em que DEU aula ──────────────────────────────── */
{
  const aulas = [aula(D(1)), aula(D(2), { faltaTipo: 'sem_aviso' }), aula(D(3), { status: 'nao_realizada' }), aula(D(4), { status: 'cancelada' }),
    aula(D(8), { specialScaleType: 'escola_interna', remunerada: false }), aula(D(9), { status: 'prevista' }),
    aula(D(10), { status: 'substituida', originalTeacherId: 'outro' }), aula(D(11), { atrasoMinutos: 60 })];
  const d = P.diasTrabalhados(aulas);
  assert.deepStrictEqual(d.lista, [D(1), D(10)], 'falta, aula não realizada, cancelada, prevista, Escola Interna e atraso da aula inteira não são dia trabalhado; aula assumida por troca é');
  ok('dia de falta, de aula cancelada ou só de Escola Interna não gera passagem');
}

/* ── 4. Passagens por pessoa e valor da passagem com data de início ─── */
{
  const aulas = [aula(D(1)), aula(D(2))];
  assert.strictEqual(P.valeTransporte({ salary: { vtPorDia: true, vtPassagensPorDia: 4 }, aulas, vtConfig: TARIFA, mes: '2026-09' }).valor, 49.6, '2 dias × 4 passagens × 6,20');
  const cfg = { tarifas: [{ desde: '2026-11', valor: 7 }, { desde: '2026-09', valor: 6.2 }, { desde: '2026-13', valor: 99 }, { desde: '2026-10', valor: 0 }] };
  assert.strictEqual(P.tarifaVigente(cfg, '2026-09'), 6.2);
  assert.strictEqual(P.tarifaVigente(cfg, '2026-10'), 6.2, 'tarifa inválida (zero) é ignorada');
  assert.strictEqual(P.tarifaVigente(cfg, '2026-11'), 7, 'a mudança de tarifa vale do mês marcado em diante');
  assert.strictEqual(P.tarifaVigente(cfg, '2026-08'), null, 'e não mexe no mês anterior');
  assert.strictEqual(P.tarifaVigente(null, '2026-09'), null);
  ok('passagens por dia ajustáveis por pessoa; a tarifa nova não altera mês anterior');
}

/* ── 5. Sem tarifa: zero, mas AVISANDO (a tela trava) ───────────────── */
{
  const vt = P.valeTransporte({ salary: { vtPorDia: true, transportAllowance: 250 }, aulas: [aula(D(1))], vtConfig: null, mes: '2026-09' });
  assert.ok(vt.semTarifa === true && vt.valor === 0, 'sem valor da passagem não paga o fixo antigo nem zero calado: marca semTarifa');
  const semDias = P.valeTransporte({ salary: { vtPorDia: true }, aulas: [], vtConfig: null, mes: '2026-09' });
  assert.strictEqual(semDias.semTarifa, false, 'sem nenhum dia trabalhado não há o que travar');
  ok('sem valor da passagem cadastrado, a conta acusa em vez de pagar zero calado');
}

/* ── 6. Quem não tem a marca continua no valor fixo ─────────────────── */
{
  const vt = P.valeTransporte({ salary: { transportAllowance: 150 }, aulas: [aula(D(1))], vtConfig: TARIFA, mes: '2026-09' });
  assert.deepStrictEqual({ m: vt.modo, v: vt.valor, d: vt.dias }, { m: 'fixo', v: 150, d: null }, 'a Carla (efetiva, R$ 150 fixos) não muda');
  assert.strictEqual(P.valeTransporte({ salary: {}, aulas: [], vtConfig: TARIFA, mes: '2026-09' }).valor, 0);
  ok('sem a marca no cadastro, vale o valor fixo de sempre');
}

/* ── 7. Corrigido no fechamento ─────────────────────────────────────── */
{
  const base = { salary: { vtPorDia: true }, aulas: [aula(D(1)), aula(D(2))], vtConfig: TARIFA, mes: '2026-09' };
  const vt = P.valeTransporte(Object.assign({}, base, { ajuste: { valor: 40, motivo: 'veio de carona 1 dia' } }));
  assert.deepStrictEqual({ v: vt.valor, c: vt.calculado, a: vt.ajustado, m: vt.motivo }, { v: 40, c: 24.8, a: true, m: 'veio de carona 1 dia' }, 'vale o valor da gestão; o calculado fica guardado ao lado');
  assert.strictEqual(P.valeTransporte(Object.assign({}, base, { ajuste: { valor: 0 } })).valor, 0, 'zerar é um ajuste válido');
  assert.strictEqual(P.valeTransporte(Object.assign({}, base, { ajuste: { valor: -5 } })).ajustado, false, 'valor negativo é ignorado');
  const fixo = P.valeTransporte({ salary: { transportAllowance: 150 }, aulas: [], ajuste: { valor: 120 }, mes: '2026-09' });
  assert.deepStrictEqual({ v: fixo.valor, c: fixo.calculado, a: fixo.ajustado }, { v: 120, c: 150, a: true }, 'o VT fixo também pode ser corrigido no mês');
  const semTarifa = P.valeTransporte({ salary: { vtPorDia: true }, aulas: [aula(D(1))], vtConfig: null, mes: '2026-09', ajuste: { valor: 12.4 } });
  assert.strictEqual(semTarifa.semTarifa, false, 'com o valor informado pela gestão, a falta de tarifa não trava');
  ok('o VT do mês pode ser corrigido no fechamento, com motivo, sem perder o calculado');
}

/* ── 8. A FOLHA usa essa conta — prévia e fechamento, a mesma ────────── */
{
  const edu = { id: 'edu', name: 'EDUARDA', type: 'estagiario' };
  const sal = { id: 'edu', remunerationType: 'bolsa', internMonthlyStipend: 800, internMonthlyLimitHours: 100, internProportionalHourlyRate: 10,
    transportAllowance: 250, vtPorDia: true };
  const aulas = uteisDeSetembro.map(d => aula(D(d))).concat([aula(D(5), { specialScaleType: 'sabado', unitId: 'pp' })]);
  const folha = (extra) => P.montarFolha(Object.assign({
    classes: aulas, teachers: new Map([['edu', edu]]), salaries: new Map([['edu', sal]]), scaleTypes: new Map(),
    ano: 2026, mes: 9, ultimoDiaDoMes: new Date(2026, 9, 0, 23, 59, 59), bancos: {}, vtConfig: TARIFA,
  }, extra || {})).pessoas[0];
  let l = folha();
  assert.strictEqual(l.transportAllowance, 272.8, '22 dias × 2 × 6,20 = 272,80 — e não mais os R$ 250 fixos');
  assert.deepStrictEqual({ d: l.vt.dias, u: l.vt.uteis, f: l.vt.fimDeSemana, p: l.vt.passagensPorDia, t: l.vt.valorPassagem }, { d: 22, u: 21, f: 1, p: 2, t: 6.2 }, 'a linha leva a conta aberta');
  assert.strictEqual(l.valorTotal, 800 + 272.8, 'e o total da pessoa acompanha (bolsa + VT)');
  l = folha({ ajustesVt: { edu: { valor: 260, motivo: 'combinado' } } });
  assert.ok(l.transportAllowance === 260 && l.vt.ajustado && l.vt.calculado === 272.8 && l.valorTotal === 1060, 'o ajuste do fechamento entra no total');
  l = folha({ vtConfig: null });
  assert.ok(l.vt.semTarifa === true && l.transportAllowance === 0);
  assert.ok(JSON.stringify(l.vt).indexOf('undefined') === -1 && Object.values(l.vt).every(v => v !== undefined), 'nada undefined: o Firestore recusaria');

  // a Function chama valorDoProfessor direto, com os mesmos extras
  const direto = P.valorDoProfessor(edu, sal, 22, new Date(Date.UTC(2026, 9, 0, 26, 59, 59, 999)), { aulas, vtConfig: TARIFA });
  assert.strictEqual(direto.transportAllowance, 272.8, 'valorDoProfessor (caminho da Function, data em UTC) dá o mesmo');
  // a marca vale pelo cadastro de hoje, mesmo que o histórico rebobine o valor fixo
  const comHistorico = Object.assign({}, sal, { salaryHistory: [{ field: 'transportAllowance', previousValue: 200, effectiveDate: { toMillis: () => new Date(2026, 9, 5).getTime() } }] });
  assert.strictEqual(P.valorDoProfessor(edu, comHistorico, 22, new Date(2026, 9, 0, 23, 59, 59), { aulas, vtConfig: TARIFA }).transportAllowance, 272.8);
  // sem extras (chamada antiga): não quebra
  assert.strictEqual(P.valorDoProfessor({ id: 'c', type: 'efetivo' }, { hourlyRate: 50, transportAllowance: 150 }, 10, new Date(2026, 9, 0)).transportAllowance, 150);
  ok('a folha paga o VT calculado, com a conta aberta na linha; tela e Function usam a mesma função');
}

/* ── 9. Meia-noite de Brasília não muda de dia na Function (UTC) ─────── */
{
  const meiaNoiteBR = { toDate: () => new Date(Date.UTC(2026, 8, 30, 3, 0, 0)) };       // 30/09 00:00 em Brasília
  const d = P.diasTrabalhados([aula(D(1), { scheduledDate: meiaNoiteBR })]);
  assert.deepStrictEqual(d.lista, ['2026-09-30'], 'a aula de 30/09 é contada em 30/09, rode onde rodar');
  ok('o dia é contado no fuso de Brasília, igual na tela e na Function');
}

/* ── 10. O gêmeo das Functions é o mesmo arquivo ────────────────────── */
{
  const a = fs.readFileSync(path.join(__dirname, '..', 'closing-payroll.js'), 'utf8');
  const b = fs.readFileSync(path.join(__dirname, '..', 'functions', 'closing-payroll.js'), 'utf8');
  assert.strictEqual(a, b, 'closing-payroll.js e functions/closing-payroll.js têm que ser idênticos');
  ok('o gêmeo em functions/ está igual');
}

console.log(`\n${n} verificações ✓`);
