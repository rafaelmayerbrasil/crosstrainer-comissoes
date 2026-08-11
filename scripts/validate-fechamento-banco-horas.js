'use strict';
// E2E do fechamento com banco de horas (bloco 2) no STAGING.
//
// Roda a Cloud Function closeMonth de verdade e confere o que ela gravou. É o
// único jeito de saber se a conta do estagiário fecha — os smokes cobrem a
// regra pura, mas não a fiação (transação, leitura do saldo, gravação).
//
// O caso que importa é o segundo: o fechamento é POR UNIDADE, e quem dá aula
// nas duas tem o mesmo mês fechado duas vezes. Cada fechamento sozinho vê
// metade das horas e compararia meia grade com o contrato inteiro.
//
// Usa unidade e mês de teste (nada de dado real é tocado) e limpa tudo no fim.
//
// Roda: node scripts/validate-fechamento-banco-horas.js
const path = require('path');
const admin = require('firebase-admin');

const API_KEY = 'AIzaSyC5wqYNNyrJBPXbBPK8gRxQxOPHTIW7TFo'; // staging
const PID = 'crosstrainer-comissoes-staging';
const ADMIN = { email: 'dono.teste@crosstainer.com', password: 'crosstainer2026' };
const CF = `https://us-central1-${PID}.cloudfunctions.net/closeMonth`;

// Unidade e competência de teste — não existem de verdade.
const UNIT_A = '__rt_bh_unit_a';
const UNIT_B = '__rt_bh_unit_b';
const YEAR = 2025, MONTH = 3;
const TEACHER = '__rt_bh_estagiario';

// Contrato: 105h/mês · bolsa R$ 1.200 · hora extra R$ 12
const CONTRATO_H = 105, BOLSA = 1200, PROP = 12;

let pass = 0, fail = 0;
const check = (label, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label} — veio: ${JSON.stringify(got)}`); }
};
const perto = (a, b) => Math.abs((a || 0) - b) < 0.01;

async function signIn(c) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...c, returnSecureToken: true }) });
  const j = await r.json();
  if (!j.idToken) throw new Error('login falhou: ' + JSON.stringify(j));
  return j.idToken;
}

async function fecharMes(token, unitId) {
  const r = await fetch(CF, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { unitId, year: YEAR, month: MONTH } }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`closeMonth(${unitId}) falhou: ${JSON.stringify(j.error)}`);
  return j.result;
}

(async () => {
  admin.initializeApp({
    credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccount-staging.json'))),
    projectId: PID,
  });
  const db = admin.firestore();

  const closingA = `${UNIT_A}_${YEAR}-${String(MONTH).padStart(2, '0')}`;
  const closingB = `${UNIT_B}_${YEAR}-${String(MONTH).padStart(2, '0')}`;
  const movId = `${TEACHER}_${YEAR}-${String(MONTH).padStart(2, '0')}`;

  async function limpar() {
    const cls = await db.collection('classes').where('teacherId', '==', TEACHER).get();
    for (const d of cls.docs) await d.ref.delete();
    await db.collection('teachers').doc(TEACHER).delete();
    await db.collection('teacher_salaries').doc(TEACHER).delete();
    await db.collection('intern_hour_balances').doc(TEACHER).delete();
    await db.collection('intern_hour_movements').doc(movId).delete();
    await db.collection('monthly_closings').doc(closingA).delete();
    await db.collection('monthly_closings').doc(closingB).delete();
  }

  try {
    await limpar();  // resto de rodada anterior

    // ── Fixture ────────────────────────────────────────────────────────
    await db.collection('teachers').doc(TEACHER).set({
      name: '[TESTE] Estagiário Banco de Horas', type: 'estagiario', isActive: true,
      unitIds: [UNIT_A, UNIT_B], primaryUnitId: UNIT_A,
    });
    await db.collection('teacher_salaries').doc(TEACHER).set({
      teacherId: TEACHER,
      internMonthlyStipend: BOLSA,
      internMonthlyLimitMinutes: CONTRATO_H * 60,
      internProportionalHourlyRate: PROP,
      mealAllowance: 0, transportAllowance: 0, otherBenefits: [], salaryHistory: [],
    });

    // Aulas longas de propósito: 60h em 2 aulas em vez de 60 aulas de 1h.
    const criarAulas = async (unitId, totalHoras, qtd) => {
      for (let i = 0; i < qtd; i++) {
        await db.collection('classes').add({
          teacherId: TEACHER, unitId, status: 'realizada',
          scheduledDate: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(YEAR, MONTH - 1, 10 + i, 15, 0, 0))),
          startTime: '12:00', endTime: '13:00',
          durationMinutes: (totalHoras * 60) / qtd,
        });
      }
    };
    await criarAulas(UNIT_A, 60, 2);   // metade do contrato
    await criarAulas(UNIT_B, 60, 2);   // a outra metade, na outra unidade

    const token = await signIn(ADMIN);
    console.log('Fixture pronta · login admin OK\n');

    // ── 1) Fecha a unidade A: sozinha, ela vê só 60h de 105 ────────────
    console.log('1) Fechamento da unidade A (60h de um contrato de 105h)');
    await fecharMes(token, UNIT_A);

    let cA = (await db.collection('monthly_closings').doc(closingA).get()).data();
    let tA = (cA.teachers || []).find(t => t.teacherId === TEACHER);
    check('marcou como estagiário', tA && tA.isIntern === true, tA && tA.isIntern);
    check('contrato do mês = 105h', perto(tA.internContratoMes, 105), tA.internContratoMes);
    check('bolsa CHEIA mesmo trabalhando a menos (R$ 1.200)', perto(tA.valorHoras, BOLSA), tA.valorHoras);
    check('nada pago de hora extra', perto(tA.internExcessValue, 0), tA.internExcessValue);
    check('as 45h que faltaram viraram saldo negativo', perto(tA.internSaldoFinal, -45), tA.internSaldoFinal);
    check('a conta aberta foi pro fechamento', typeof tA.internExplicacao === 'string' && tA.internExplicacao.length > 10, tA.internExplicacao);
    check('contrato e valor/hora NÃO vazaram pro doc', tA.internLimitHours === undefined && tA.internPropRate === undefined,
      { limite: tA.internLimitHours, prop: tA.internPropRate });

    let saldo = (await db.collection('intern_hour_balances').doc(TEACHER).get()).data();
    check('saldo gravado = −45h', saldo && perto(saldo.saldoHoras, -45), saldo);
    let mov = (await db.collection('intern_hour_movements').doc(movId).get()).data();
    check('movimento do mês gravado com o saldo de onde partiu', mov && perto(mov.saldoAnterior, 0) && perto(mov.horasTrabalhadas, 60), mov);

    // ── 2) Fecha a unidade B: o mês inteiro passa a ter 120h ───────────
    console.log('\n2) Fechamento da unidade B — o MESMO mês, a outra metade das horas');
    await fecharMes(token, UNIT_B);

    let cB = (await db.collection('monthly_closings').doc(closingB).get()).data();
    let tB = (cB.teachers || []).find(t => t.teacherId === TEACHER);
    check('o mês passou a somar as duas unidades (120h)', perto(tB.internHorasNoMes, 120), tB.internHorasNoMes);
    check('as 15h acima do contrato foram pagas (R$ 180)', perto(tB.internExcessValue, 15 * PROP), tB.internExcessValue);
    check('valor = bolsa + extras (R$ 1.380)', perto(tB.valorHoras, BOLSA + 15 * PROP), tB.valorHoras);
    check('a dívida do 1º fechamento foi DESFEITA, não somada', perto(tB.internSaldoFinal, 0), tB.internSaldoFinal);

    saldo = (await db.collection('intern_hour_balances').doc(TEACHER).get()).data();
    check('saldo final zerado (o mês cumpriu o contrato)', perto(saldo.saldoHoras, 0), saldo);
    mov = (await db.collection('intern_hour_movements').doc(movId).get()).data();
    check('movimento acumulou as 120h do mês', perto(mov.horasTrabalhadas, 120), mov.horasTrabalhadas);
    check('movimento registra os dois fechamentos', (mov.closingIds || []).length === 2, mov.closingIds);
    check('não pagou a mesma hora duas vezes (15h no total do mês)', perto(mov.horasPagas, 15), mov.horasPagas);

    const pagoTotal = (tA.internExcessValue || 0) + (tB.internExcessValue || 0);
    check(`soma paga de extra nos 2 fechamentos = R$ ${15 * PROP} (não R$ ${2 * 15 * PROP})`,
      perto(pagoTotal, 15 * PROP), pagoTotal);

  } finally {
    await limpar();
    const sobrou = (await db.collection('intern_hour_balances').doc(TEACHER).get()).exists
      || (await db.collection('monthly_closings').doc(closingA).get()).exists;
    check('cleanup completo', !sobrou, sobrou);
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('\n💥', e.message || e); process.exit(1); });
