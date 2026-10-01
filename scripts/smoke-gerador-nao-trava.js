'use strict';
// Roda: node scripts/smoke-gerador-nao-trava.js
//
// O gerador semanal de aulas TRAVOU em produção de 31/08 a 01/10/2026 — cinco
// segundas-feiras seguidas sem gerar nada, e ninguém viu.
//
// A correção de 24/08 ("a grade não vale em dia de escala") pulava o dia com um
// `continue` dentro de um `while`, sem avançar o dia: a função ficava no mesmo
// sábado para sempre, até o tempo limite. Como a rodada das 2h de 24/08 já tinha
// enchido a agenda até 19/10, nada pareceu errado — até o Rafael Rojais mostrar
// (01/10) que a Thaynara não via o horário das 13:30 de terça, criado na grade
// às 17:52 daquele mesmo dia 24/08. Nenhuma aula dele jamais nasceu.
//
// O teste antigo (smoke-escala-dona-do-dia) testava a REGRA "de quem é o dia",
// nunca o LAÇO que a usa. Este roda o laço de verdade — num processo filho com
// tempo limite, para que uma trava derrube o teste em vez de pendurar a suíte.
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

/* ── filho: roda o laço e imprime o resultado ──────────────────────── */
if (process.argv[2] === '--filho') {
  const C = require('../functions/class-candidates.js');
  const escalaDia = require('../functions/escala-dia.js');
  const cenario = JSON.parse(process.argv[3]);
  const scalesByDate = escalaDia.montarMapa(cenario.escalas || []);
  const ferias = new Map(Object.entries(cenario.ferias || {}).map(([t, dias]) => [t, new Set(dias)]));
  const r = C.comporCandidatos({
    slots: cenario.slots,
    inicio: C.brMidnightUTC(cenario.de[0], cenario.de[1] - 1, cenario.de[2]),
    semanas: cenario.semanas,
    feriadosByDate: new Map(Object.entries(cenario.feriados || {})),
    scalesByDate, vacationDatesByTeacher: ferias,
    hojeISO: cenario.hojeISO, agoraHHMM: cenario.agoraHHMM,
  });
  process.stdout.write(JSON.stringify({
    ids: r.candidates.map(c => c.classId),
    extras: r.candidates.map(c => c.extras),
    feriasPuladas: r.vacationSkipped, hojePuladas: r.pastTodaySkipped, escalaPuladas: r.escalaSkipped,
  }));
  process.exit(0);
}

function rodar(cenario) {
  const r = spawnSync(process.execPath, [__filename, '--filho', JSON.stringify(cenario)], { timeout: 8000, encoding: 'utf8' });
  assert.ok(!(r.error && r.error.code === 'ETIMEDOUT') && r.signal !== 'SIGTERM',
    'O GERADOR TRAVOU: o laço não terminou em 8 segundos (em produção isso é a função estourando o tempo toda segunda-feira)');
  assert.strictEqual(r.status, 0, 'o gerador quebrou: ' + (r.stderr || '').slice(0, 400));
  return JSON.parse(r.stdout);
}

const SAB = { id: 'slotSab', weekday: 6, startTime: '08:00', endTime: '09:00', unitId: 'cp', teacherId: 'karin', modalityId: 'hiit' };
const TER = { id: 'dHGe', weekday: 2, startTime: '13:30', endTime: '14:30', unitId: 'cp', teacherId: 'thaynara', modalityId: 'hiit' };
const SEG = { id: 'slotSeg', weekday: 1, startTime: '07:00', endTime: '08:00', unitId: 'cp', teacherId: 'alan', modalityId: 'toi' };
const escalaSabado = (dia) => ({ id: 'esc_' + dia, data: { tipo: 'sabado', status: 'consolidada', date: dia, slots: [{ unitId: 'cp' }] } });
const base = { de: [2026, 10, 5], semanas: 8, hojeISO: '2026-10-05', agoraHHMM: '02:00' };   // segunda, 2h da manhã: como o cron

/* ── 1. O caso que travou: horário de sábado + sábado com escala ───── */
{
  const r = rodar(Object.assign({}, base, { slots: [SAB, TER], escalas: [escalaSabado('2026-10-10'), escalaSabado('2026-10-17')] }));
  assert.ok(!r.ids.includes('slotSab_20261010') && !r.ids.includes('slotSab_20261017'), 'sábado com escala: a grade não gera aula');
  assert.ok(r.ids.includes('slotSab_20261024'), 'sábado SEM escala: a grade gera normalmente');
  assert.strictEqual(r.escalaPuladas, 2, 'e conta os dois dias pulados');
  passou('horário da grade num dia que é da escala: pula o dia e SEGUE (era aqui que travava)');
}

/* ── 2. O horário da Thaynara: toda terça das 8 semanas vira aula ──── */
{
  const r = rodar(Object.assign({}, base, { slots: [SAB, TER], escalas: [escalaSabado('2026-10-10')] }));
  const tercas = r.ids.filter(i => i.startsWith('dHGe_'));
  assert.deepStrictEqual(tercas, ['dHGe_20261006', 'dHGe_20261013', 'dHGe_20261020', 'dHGe_20261027',
    'dHGe_20261103', 'dHGe_20261110', 'dHGe_20261117', 'dHGe_20261124'], 'uma aula por terça, 8 semanas à frente');
  passou('horário criado na grade vira aula em todas as semanas da janela');
}

/* ── 3. Feriado com escala numa segunda: pula só a unidade da escala ─ */
{
  const feriado = { id: 'esc_fer', data: { tipo: 'feriado', status: 'publicada', date: '2026-10-12', name: 'N. Sra. Aparecida', slots: [{ unitId: 'cp' }] } };
  const segPP = Object.assign({}, SEG, { id: 'slotSegPP', unitId: 'pp' });
  const r = rodar(Object.assign({}, base, { slots: [SEG, segPP], escalas: [feriado], feriados: { '2026-10-12': { date: '2026-10-12', name: 'N. Sra. Aparecida', type: 'national' } } }));
  assert.ok(!r.ids.includes('slotSeg_20261012'), 'na unidade da escala, a grade não vale no feriado');
  assert.ok(r.ids.includes('slotSegPP_20261012'), 'na outra unidade, sem escala, a aula nasce');
  const i = r.ids.indexOf('slotSegPP_20261012');
  assert.deepStrictEqual({ h: r.extras[i].isHoliday, n: r.extras[i].holidayName, t: r.extras[i].specialScaleType },
    { h: true, n: 'N. Sra. Aparecida', t: 'feriado' }, 'e nasce marcada como feriado');
  assert.ok(r.ids.includes('slotSeg_20261019'), 'a segunda seguinte volta ao normal');
  passou('feriado com escala: pula a unidade escalada, marca o feriado na outra, e segue');
}

/* ── 4. Férias e aula de hoje que já acabou continuam sendo puladas ── */
{
  const r = rodar(Object.assign({}, base, { slots: [TER, SEG], ferias: { thaynara: ['2026-10-13', '2026-10-20'] }, agoraHHMM: '13:00' }));
  assert.ok(!r.ids.includes('dHGe_20261013') && !r.ids.includes('dHGe_20261020') && r.ids.includes('dHGe_20261027'), 'dia de férias não gera aula');
  assert.strictEqual(r.feriasPuladas, 2);
  assert.ok(!r.ids.includes('slotSeg_20261005'), 'a aula de hoje das 07:00 já acabou às 13:00: não nasce');
  assert.strictEqual(r.hojePuladas, 1);
  assert.ok(r.ids.includes('slotSeg_20261012'));
  passou('férias e aula de hoje já encerrada continuam fora, sem travar');
}

/* ── 5. Tudo junto, como em produção: muitos horários, escala toda semana ── */
{
  const slots = [];
  for (let wd = 1; wd <= 6; wd++) for (let h = 6; h < 21; h++) slots.push({ id: `s${wd}_${h}`, weekday: wd, startTime: `${String(h).padStart(2, '0')}:00`, endTime: `${String(h + 1).padStart(2, '0')}:00`, unitId: wd % 2 ? 'cp' : 'pp', teacherId: 't' + (h % 5), modalityId: 'hiit' });
  const sabados = ['2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31', '2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28'];
  const escalas = sabados.map(d => ({ id: 'e' + d, data: { tipo: 'sabado', status: 'consolidada', date: d, slots: [{ unitId: 'cp' }, { unitId: 'pp' }] } }));
  const r = rodar(Object.assign({}, base, { slots, escalas }));
  assert.strictEqual(r.ids.filter(i => /^s6_/.test(i)).length, 0, 'nenhuma aula da grade em sábado escalado');
  assert.strictEqual(r.ids.length, 5 * 15 * 8 + 15, '5 dias úteis × 15 horários × 8 semanas (+ a segunda que fecha a janela)');
  assert.strictEqual(new Set(r.ids).size, r.ids.length, 'sem identificador repetido');
  passou('grade cheia com escala em todos os sábados: termina e gera só os dias úteis');
}

/* ── 6. A Function usa este laço (e não um `while` próprio) ────────── */
{
  const fs = require('fs');
  const fn = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
  assert.ok(/classCandidates\.comporCandidatos\(/.test(fn), 'functions/index.js chama o laço testado');
  assert.ok(!/while \(cursorMs <= endBR\.getTime\(\)\)/.test(fn), 'e não carrega mais o `while` que travava');
  const mod = fs.readFileSync(path.join(__dirname, '..', 'functions', 'class-candidates.js'), 'utf8');
  assert.ok(!/\bwhile\s*\(/.test(mod), 'o laço dos dias é um `for`: avançar o dia não depende de lembrar de fazê-lo antes de cada `continue`');
  passou('a Function usa o laço testado, escrito de um jeito que não tem como esquecer de avançar o dia');
}

/* ── 7. Se o gerador parar de novo, a gestão fica sabendo ──────────── */
{
  // Cinco semanas travado e ninguém viu, porque a agenda já estava cheia até
  // 19/10. A tela inicial da gestão passa a avisar quando não há aula da grade
  // daqui a três semanas — com o gerador saudável sempre há (ele enche 8).
  const fs = require('fs');
  const vm = require('vm');
  const sandbox = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Promise, String, Array, Object };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'professores-home.js'), 'utf8'), sandbox, { filename: 'professores-home.js' });
  const acabando = vm.runInContext('homeAgendaAcabando', sandbox);
  assert.strictEqual(acabando([{ slotId: 'a' }, { specialScaleId: 'x' }]), false, 'há aula da grade lá na frente: tudo certo');
  assert.strictEqual(acabando([{ specialScaleId: 'x' }, { generatedBy: 'horas-do-mes' }]), true, 'só aula de escala lá na frente: a GRADE parou de ser gerada');
  assert.strictEqual(acabando([]), true, 'nada lá na frente: avisa');
  assert.strictEqual(acabando(null), false, 'não deu pra consultar: não inventa alarme');
  const home = fs.readFileSync(path.join(__dirname, '..', 'professores-home.js'), 'utf8');
  assert.ok(/homeAgendaAcabando\(/.test(home.split('function homeAgendaAcabando')[1]) || /homeAgendaAcabando\(fut/.test(home), 'a tela inicial da gestão usa a checagem');
  assert.ok(/navigateTo\('agenda'\)/.test(home), 'e o aviso leva à Grade de Horários, onde está o botão de gerar');
  passou('a tela inicial da gestão avisa quando a agenda está acabando (gerador parado)');
}

console.log(`\n${ok} verificações ✓`);
