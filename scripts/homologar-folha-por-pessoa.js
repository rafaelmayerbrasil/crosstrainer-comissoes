'use strict';
// Roda: node scripts/homologar-folha-por-pessoa.js --project production --mes 2026-08
//
// SOMENTE LEITURA. Roda `closing-payroll.js` — o mesmo módulo que a Cloud
// Function e a prévia da tela usam — contra o Firestore de verdade, e confere:
//
//   1. cada pessoa aparece UMA vez;
//   2. a soma das horas por unidade fecha com o total da pessoa;
//   3. quem dá aula nas duas unidades leva bolsa/VR/VT UMA vez;
//   4. o total do mês bate com a soma das linhas.
//
// Existe porque a conta certa só é conta certa contra o dado real: em agosto de
// 2026 o fechamento por unidade daria R$ 32.552,04 numa folha de R$ 24.971,20.

const admin = require('firebase-admin');
const path = require('path');
const assert = require('assert');
const Folha = require('../closing-payroll.js');

const args = process.argv.slice(2);
const projeto = args.includes('--project') ? args[args.indexOf('--project') + 1] : null;
const mesArg = args.includes('--mes') ? args[args.indexOf('--mes') + 1] : null;
if (!projeto || !mesArg) {
  console.error('Uso: node scripts/homologar-folha-por-pessoa.js --project <staging|production> --mes AAAA-MM');
  process.exit(1);
}
const [ANO, MES] = mesArg.split('-').map(Number);

admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))) });
const db = admin.firestore();

const fmt = n => 'R$ ' + (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
const h = n => (Math.round(n * 100) / 100).toString().replace('.', ',') + 'h';

(async () => {
  const inicio = new Date(ANO, MES - 1, 1, 0, 0, 0);
  const fim = new Date(ANO, MES, 0, 23, 59, 59, 999);

  const [unitsSnap, teachSnap, salSnap, stSnap, balSnap, movSnap] = await Promise.all([
    db.collection('units').get(),
    db.collection('teachers').get(),
    db.collection('teacher_salaries').get(),
    db.collection('special_scale_types').get(),
    db.collection('intern_hour_balances').get(),
    db.collection('intern_hour_movements').get(),
  ]);
  const clsSnap = await db.collection('classes')
    .where('scheduledDate', '>=', inicio).where('scheduledDate', '<=', fim).get();

  const units = new Map(unitsSnap.docs.map(d => [d.id, d.data()]));
  const teachers = new Map(teachSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
  const salaries = new Map(salSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
  const scaleTypes = new Map(stSnap.docs.map(d => [d.id, d.data()]));
  const classes = clsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const bancos = {};
  balSnap.docs.forEach(d => { bancos[d.id] = { saldo: d.data().saldoHoras || 0, movimento: null, diasAfastado: 0 }; });
  movSnap.docs.forEach(d => {
    const m = d.data();
    if (m.mes !== `${ANO}-${String(MES).padStart(2, '0')}`) return;
    bancos[m.teacherId] = Object.assign(bancos[m.teacherId] || { saldo: 0, diasAfastado: 0 }, { movimento: m });
  });

  const folha = Folha.montarFolha({
    classes, teachers, salaries, scaleTypes, units,
    ano: ANO, mes: MES, ultimoDiaDoMes: fim, bancos,
  });

  console.log(`\n═════ FOLHA DE ${mesArg} · ${projeto} · ${folha.totais.unitIds.length} unidade(s) ═════\n`);
  console.log('PESSOA                          TIPO         AULAS   HORAS   R$HORAS    VR+VT+O     TOTAL  UNIDADES');
  for (const p of folha.pessoas) {
    const bene = p.mealAllowance + p.transportAllowance + p.totalOutros;
    console.log(
      p.teacherName.padEnd(31).slice(0, 31) + ' ' +
      String(p.teacherType).padEnd(11) + ' ' +
      String(p.classesCount).padStart(5) + ' ' +
      h(p.totalHoras).padStart(7) + ' ' +
      fmt(p.valorHoras).padStart(10) + ' ' +
      fmt(bene).padStart(10) + ' ' +
      fmt(p.valorTotal).padStart(10) + '  ' +
      p.porUnidade.map(u => `${((units.get(u.unitId) || {}).name || u.unitId).replace(/^CrossTainer /, '')} ${h(u.horas)}`).join(' + ') +
      (p.avisos.length ? '   ⚠️ ' + p.avisos.join(', ') : ''));
  }
  console.log(`\nTOTAL: ${folha.pessoas.length} pessoas · ${folha.totais.classesRealizadas} aulas · ` +
    `${h(folha.totais.totalHoras)} · ${fmt(folha.totais.totalValor)}`);

  // ── as travas ──────────────────────────────────────────────────────
  console.log('\n───── conferências ─────');

  const ids = folha.pessoas.map(p => p.teacherId);
  assert.strictEqual(new Set(ids).size, ids.length, 'alguém apareceu duas vezes na folha');
  console.log(`✓ ${ids.length} pessoas, nenhuma repetida`);

  for (const p of folha.pessoas) {
    const somaUn = p.porUnidade.reduce((s, u) => s + u.horas, 0);
    assert.ok(Math.abs(somaUn - p.totalHoras) < 0.02,
      `${p.teacherName}: soma das unidades ${somaUn} ≠ total ${p.totalHoras}`);
    const somaAulas = p.porUnidade.reduce((s, u) => s + u.classesCount, 0);
    assert.strictEqual(somaAulas, p.classesCount, `${p.teacherName}: contagem de aulas não fecha`);
  }
  console.log('✓ a divisão por unidade fecha com o total de cada pessoa');

  const soma = folha.pessoas.reduce((s, p) => s + p.valorTotal, 0);
  assert.ok(Math.abs(soma - folha.totais.totalValor) < 0.02, 'o total do mês não é a soma das linhas');
  console.log('✓ o total do mês é a soma das linhas');

  const duas = folha.pessoas.filter(p => p.porUnidade.length > 1);
  console.log(`\n───── as ${duas.length} pessoas que dão aula nas duas unidades ─────`);
  console.log('(era exatamente quem levava bolsa/VR/VT em dobro)');
  let evitado = 0;
  for (const p of duas) {
    const mensal = (p.isIntern ? (p.internStipendUsed || 0) : 0)
      + p.mealAllowance + p.transportAllowance + p.totalOutros;
    evitado += mensal;
    console.log(`  ${p.teacherName.padEnd(32)} valor mensal ${fmt(mensal).padStart(11)} — pago 1×, não ${p.porUnidade.length}×`);
  }
  console.log(`\n  → ${fmt(evitado)} que sairiam a mais se o fechamento continuasse por unidade.`);

  const comAviso = folha.pessoas.filter(p => p.avisos.some(a => a === 'sem_salario' || a === 'sem_valor_hora'));
  if (comAviso.length) {
    console.log('\n───── ⚠️ erro de cadastro (hoje passaria calado) ─────');
    for (const p of comAviso) {
      console.log(`  ${p.teacherName}: ${p.classesCount} aulas, ${h(p.totalHoras)} → ${fmt(p.valorHoras)} de horas [${p.avisos.join(', ')}]`);
    }
  }

  console.log('\n✅ homologação OK');
  process.exit(0);
})().catch(e => { console.error('\n✗ FALHOU:', e.message); process.exit(1); });
