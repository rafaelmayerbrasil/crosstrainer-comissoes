'use strict';
// Roda: node scripts/e2e-vale-transporte-staging.js [--mes 2026-08]
//
// ══════════════════════════════════════════════════════════════════════
// VALE-TRANSPORTE POR DIA TRABALHADO, de ponta a ponta no staging
// ══════════════════════════════════════════════════════════════════════
//
// Fecha um mês DE VERDADE pela Cloud Function `closeMonth` (token de admin
// real) e confere que o vale-transporte gravado é o que `closing-payroll.js`
// calcula; e prova, com token de usuário real (o Admin SDK ignora as regras),
// que o valor da passagem e as correções são só do Admin e que mês fechado
// não aceita mais correção.
//
// Faz e DESFAZ: no fim apaga o fechamento, devolve as aulas, o banco de horas,
// os cadastros salariais, o valor da passagem e as correções ao que eram.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const Folha = require('../closing-payroll.js');

const PROJECT = 'crosstrainer-comissoes-staging';
const REGION = 'us-central1';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const args = process.argv.slice(2);
const mesArg = args.includes('--mes') ? args[args.indexOf('--mes') + 1] : '2026-08';
const [ANO, MES] = mesArg.split('-').map(Number);
const CLOSING_ID = `${ANO}-${String(MES).padStart(2, '0')}`;
const TARIFA = 6.20;

const UID_ADMIN = 'syZANHXh6MO1xw4UXpxGVTyFDcp1';   // dono.teste@
const UID_PROF  = 'MLjF8pMsSEeZkE2m8BvjwdR5RDF2';   // professor.teste@ (Marcos)

const svc = path.join(__dirname, 'serviceAccount-staging.json');
if (!fs.existsSync(svc)) { console.error('Falta scripts/serviceAccount-staging.json'); process.exit(1); }
const cfg = fs.readFileSync(path.join(__dirname, '..', 'firebase-config.js'), 'utf8');
const apiKey = (cfg.match(/apiKey:\s*['"]([^'"]+)['"][\s\S]{0,120}?crosstrainer-comissoes-staging/) || [])[1];
if (!apiKey) { console.error('não achei a apiKey do staging em firebase-config.js'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(require(svc)), projectId: PROJECT });
const db = admin.firestore();

let checks = 0, fails = 0;
function ok(desc, cond, detalhe) {
  checks++; if (!cond) fails++;
  console.log(`${cond ? '✓' : '✗'} ${desc}${detalhe ? ' — ' + detalhe : ''}`);
}
const fmt = n => 'R$ ' + (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');

/** Token de usuário sem senha: custom token do Admin SDK trocado por idToken. */
async function tokenDe(uid) {
  const custom = await admin.auth().createCustomToken(uid);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }) });
  const j = await r.json();
  if (!j.idToken) throw new Error('não consegui token para ' + uid + ': ' + JSON.stringify(j));
  return j.idToken;
}
const H = t => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });
const ler = async (caminho, t) => (await fetch(`${BASE}/${caminho}`, { headers: H(t) })).status;
const gravar = async (caminho, campos, t) =>
  (await fetch(`${BASE}/${caminho}`, { method: 'PATCH', headers: H(t), body: JSON.stringify({ fields: campos }) })).status;
const apagar = async (caminho, t) => (await fetch(`${BASE}/${caminho}`, { method: 'DELETE', headers: H(t) })).status;

// o mesmo formato que a tela grava (PayrollVtService)
const camposTarifa = (desde, valor) => ({ tarifas: { arrayValue: { values: [
  { mapValue: { fields: { desde: { stringValue: desde }, valor: { doubleValue: valor } } } }] } } });
const camposAjuste = (mes, teacherId, valor, motivo) => ({
  mes: { stringValue: mes },
  vt: { mapValue: { fields: { [teacherId]: { mapValue: { fields: {
    valor: { doubleValue: valor }, motivo: { stringValue: motivo } } } } } } },
});

async function chamarCloseMonth(idToken, payload) {
  const r = await fetch(`https://${REGION}-${PROJECT}.cloudfunctions.net/closeMonth`, {
    method: 'POST', headers: H(idToken), body: JSON.stringify({ data: payload }),
  });
  const txt = await r.text();
  let json = null; try { json = JSON.parse(txt); } catch (_) {}
  return { status: r.status, json, txt: txt.slice(0, 400) };
}

(async () => {
  const inicio = new Date(ANO, MES - 1, 1, 0, 0, 0);
  const fim = new Date(ANO, MES, 0, 23, 59, 59, 999);

  // ── 0) estado anterior, para desfazer tudo no fim ───────────────────
  if ((await db.collection('monthly_closings').doc(CLOSING_ID).get()).exists) {
    console.error(`✗ já existe monthly_closings/${CLOSING_ID} no staging. Apague antes de rodar.`);
    process.exit(1);
  }
  const clsSnap = await db.collection('classes')
    .where('scheduledDate', '>=', inicio).where('scheduledDate', '<=', fim).get();
  const classes = clsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const classesAntes = classes.map(c => ({ id: c.id, monthClosingId: c.monthClosingId || null }));
  const balAntes = (await db.collection('intern_hour_balances').get()).docs.map(d => ({ id: d.id, data: d.data() }));
  const movAntes = (await db.collection('intern_hour_movements').get()).docs.map(d => ({ id: d.id, data: d.data() }));
  const cfgAntes = await db.collection('payroll_config').doc('vale_transporte').get();
  const ajAntes = await db.collection('payroll_adjustments').doc(CLOSING_ID).get();
  const salSnap0 = await db.collection('teacher_salaries').get();
  const salAntes = new Map(salSnap0.docs.map(d => [d.id, d.data()]));
  console.log(`estado guardado: ${classes.length} aulas · ${salAntes.size} cadastros salariais · passagem ${cfgAntes.exists ? 'cadastrada' : 'sem cadastro'}\n`);

  let fechou = false;
  const salMexidos = [];
  try {
    // ── 1) quem entra no cenário ──────────────────────────────────────
    const teachSnap = await db.collection('teachers').get();
    const teachers = new Map(teachSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
    const comAula = [...new Set(classes.filter(c => Folha.STATUS_QUE_PAGAM.includes(c.status)).map(c => c.teacherId))]
      .filter(id => teachers.has(id) && salAntes.has(id) && teachers.get(id).naoRemunerado !== true);
    // A: por dia, 2 passagens · B: por dia, 3 passagens e corrigido no mês · C: continua no fixo
    const fixo = comAula.find(id => (salAntes.get(id).transportAllowance || 0) > 0);
    const outros = comAula.filter(id => id !== fixo);
    const [A, B] = outros;
    if (!A || !B || !fixo) throw new Error('o staging não tem 3 pessoas com aula e cadastro salarial em ' + mesArg);
    const nome = id => teachers.get(id).name;
    console.log(`cenário: ${nome(A)} (por dia, 2 passagens) · ${nome(B)} (por dia, 3 passagens, corrigido) · ${nome(fixo)} (fixo de ${fmt(salAntes.get(fixo).transportAllowance)})\n`);

    await db.collection('teacher_salaries').doc(A).update({ vtPorDia: true, vtPassagensPorDia: 2 }); salMexidos.push(A);
    await db.collection('teacher_salaries').doc(B).update({ vtPorDia: true, vtPassagensPorDia: 3 }); salMexidos.push(B);
    await db.collection('payroll_config').doc('vale_transporte').delete();
    await db.collection('payroll_adjustments').doc(CLOSING_ID).delete();

    const tAdmin = await tokenDe(UID_ADMIN);
    const tProf = await tokenDe(UID_PROF);

    // ── 2) sem o valor da passagem, o fechamento é recusado ───────────
    const semTarifa = await chamarCloseMonth(tAdmin, { year: ANO, month: MES });
    ok('sem o valor da passagem, a Function recusa fechar',
      semTarifa.status >= 400 && /passagem/i.test(semTarifa.txt), 'HTTP ' + semTarifa.status + ' · ' + semTarifa.txt.slice(0, 160));
    ok('e nada ficou gravado', !(await db.collection('monthly_closings').doc(CLOSING_ID).get()).exists);

    // ── 3) regras: só o Admin ─────────────────────────────────────────
    ok('professor NÃO grava o valor da passagem',
      (await gravar('payroll_config/vale_transporte', camposTarifa(CLOSING_ID, 0.01), tProf)) === 403);
    ok('professor NÃO corrige o VT do mês',
      (await gravar(`payroll_adjustments/${CLOSING_ID}`, camposAjuste(CLOSING_ID, A, 9999, 'x'), tProf)) === 403);
    ok('Admin grava o valor da passagem',
      (await gravar('payroll_config/vale_transporte', camposTarifa(CLOSING_ID, TARIFA), tAdmin)) === 200);
    ok('Admin corrige o VT de uma pessoa no mês',
      (await gravar(`payroll_adjustments/${CLOSING_ID}`, camposAjuste(CLOSING_ID, B, 123.45, 'E2E: faltou dois dias sem aviso'), tAdmin)) === 200);
    ok('professor NÃO lê o valor da passagem', (await ler('payroll_config/vale_transporte', tProf)) === 403);
    ok('professor NÃO lê as correções do mês', (await ler(`payroll_adjustments/${CLOSING_ID}`, tProf)) === 403);
    ok('nem o Admin apaga a correção', (await apagar(`payroll_adjustments/${CLOSING_ID}`, tAdmin)) === 403);

    // ── 4) o que a conta pura diz que tem que sair ────────────────────
    const [unitsSnap, salSnap, stSnap, cfgDoc, ajDoc] = await Promise.all([
      db.collection('units').get(), db.collection('teacher_salaries').get(),
      db.collection('special_scale_types').get(),
      db.collection('payroll_config').doc('vale_transporte').get(),
      db.collection('payroll_adjustments').doc(CLOSING_ID).get(),
    ]);
    const esperado = Folha.montarFolha({
      classes, teachers,
      salaries: new Map(salSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }])),
      scaleTypes: new Map(stSnap.docs.map(d => [d.id, d.data()])),
      units: new Map(unitsSnap.docs.map(d => [d.id, d.data()])),
      ano: ANO, mes: MES, ultimoDiaDoMes: fim, bancos: {},
      vtConfig: cfgDoc.data(), ajustesVt: ajDoc.data().vt,
    });
    const esp = id => esperado.pessoas.find(p => p.teacherId === id);
    const diasA = Folha.diasTrabalhados(classes.filter(c => c.teacherId === A)).dias;
    ok('a conta pura: dias × 2 × 6,20', esp(A).vt.modo === 'por_dia' && diasA > 0
      && Math.abs(esp(A).vt.valor - diasA * 2 * TARIFA) < 0.005, `${nome(A)}: ${diasA} dias → ${fmt(esp(A).vt.valor)}`);

    // ── 5) fecha de verdade ───────────────────────────────────────────
    const r = await chamarCloseMonth(tAdmin, { year: ANO, month: MES });
    ok('com a passagem cadastrada, closeMonth fecha', r.status === 200 && r.json && r.json.result && r.json.result.success,
      'HTTP ' + r.status + (r.status !== 200 ? ' · ' + r.txt : ''));
    if (r.status !== 200) throw new Error('closeMonth falhou: ' + r.txt);
    fechou = true;

    const gravadas = (await db.collection('monthly_closings').doc(CLOSING_ID).get()).data().teachers || [];
    const g = id => gravadas.find(x => x.teacherId === id) || {};

    const gA = g(A);
    ok('A: gravado por dia trabalhado, com a conta aberta',
      gA.vt && gA.vt.modo === 'por_dia' && gA.vt.dias === diasA && gA.vt.passagensPorDia === 2 && gA.vt.valorPassagem === TARIFA,
      JSON.stringify(gA.vt && { dias: gA.vt.dias, uteis: gA.vt.uteis, sab: gA.vt.fimDeSemana, fer: gA.vt.feriados, pass: gA.vt.passagensPorDia, tarifa: gA.vt.valorPassagem }));
    ok('A: o VT pago é o calculado', Math.abs((gA.transportAllowance || 0) - diasA * 2 * TARIFA) < 0.005, fmt(gA.transportAllowance || 0));

    const gB = g(B);
    ok('B: vale o valor corrigido, e o calculado fica guardado ao lado',
      gB.vt && gB.vt.ajustado === true && gB.transportAllowance === 123.45
      && Math.abs(gB.vt.calculado - esp(B).vt.calculado) < 0.005 && gB.vt.passagensPorDia === 3 && /E2E/.test(gB.vt.motivo || ''),
      `pago ${fmt(gB.transportAllowance || 0)} · calculado ${fmt((gB.vt && gB.vt.calculado) || 0)} · "${gB.vt && gB.vt.motivo}"`);

    const gC = g(fixo);
    ok('C: sem a marca, continua o valor fixo do cadastro',
      gC.vt && gC.vt.modo === 'fixo' && gC.transportAllowance === salAntes.get(fixo).transportAllowance, fmt(gC.transportAllowance || 0));

    const diverg = [];
    for (const p of esperado.pessoas) {
      const x = g(p.teacherId);
      if (Math.abs((p.transportAllowance || 0) - (x.transportAllowance || 0)) > 0.005) diverg.push(`${p.teacherName}: VT ${p.transportAllowance} ≠ ${x.transportAllowance}`);
      if (Math.abs((p.valorTotal || 0) - (x.valorTotal || 0)) > 0.02 && !p.isIntern) diverg.push(`${p.teacherName}: total ${p.valorTotal} ≠ ${x.valorTotal}`);
    }
    ok('todo VT gravado bate com o módulo puro (e o total de quem não é bolsista)', diverg.length === 0,
      diverg.length ? diverg.join(' | ') : gravadas.length + ' pessoas');
    ok('o VT entra no total da pessoa',
      Math.abs(gA.valorTotal - (gA.valorHoras + (gA.mealAllowance || 0) + gA.transportAllowance + (gA.totalOutros || 0))) < 0.02
      || gA.isIntern === true, fmt(gA.valorTotal || 0));

    // ── 6) mês fechado não aceita mais correção ───────────────────────
    ok('depois de fechado, nem o Admin corrige o VT daquele mês',
      (await gravar(`payroll_adjustments/${CLOSING_ID}`, camposAjuste(CLOSING_ID, A, 1, 'depois de fechado'), tAdmin)) === 403);
    const ajDepois = (await db.collection('payroll_adjustments').doc(CLOSING_ID).get()).data();
    ok('e a correção gravada continua a mesma', ajDepois.vt[B].valor === 123.45 && !ajDepois.vt[A]);

  } catch (err) {
    fails++;
    console.error('\n✗ ERRO:', err.message);
  } finally {
    // ── 7) desfaz TUDO ────────────────────────────────────────────────
    console.log('\n── desfazendo ──');
    let lote = db.batch(), n = 0;
    for (const c of classesAntes) {
      lote.update(db.collection('classes').doc(c.id), { monthClosingId: c.monthClosingId });
      if (++n % 400 === 0) { await lote.commit(); lote = db.batch(); }
    }
    if (n % 400 !== 0) await lote.commit();
    console.log(`· monthClosingId de ${classesAntes.length} aulas devolvido ao que era`);

    if (fechou) { await db.collection('monthly_closings').doc(CLOSING_ID).delete(); console.log('· fechamento apagado'); }

    for (const doc of (await db.collection('intern_hour_balances').get()).docs) {
      const antes = balAntes.find(b => b.id === doc.id);
      if (antes) await doc.ref.set(antes.data); else await doc.ref.delete();
    }
    for (const doc of (await db.collection('intern_hour_movements').get()).docs) {
      const antes = movAntes.find(m => m.id === doc.id);
      if (antes) await doc.ref.set(antes.data); else await doc.ref.delete();
    }
    console.log(`· banco de horas restaurado (${balAntes.length} saldo(s), ${movAntes.length} movimento(s))`);

    for (const id of salMexidos) await db.collection('teacher_salaries').doc(id).set(salAntes.get(id));
    console.log(`· ${salMexidos.length} cadastro(s) salarial(is) devolvido(s) ao que era(m)`);

    const refCfg = db.collection('payroll_config').doc('vale_transporte');
    if (cfgAntes.exists) await refCfg.set(cfgAntes.data()); else await refCfg.delete();
    const refAj = db.collection('payroll_adjustments').doc(CLOSING_ID);
    if (ajAntes.exists) await refAj.set(ajAntes.data()); else await refAj.delete();
    console.log('· valor da passagem e correções do mês devolvidos ao que eram');

    // recibos que o fechamento possa ter criado
    const rec = await db.collection('receipts').where('closingId', '==', CLOSING_ID).get();
    for (const d of rec.docs) await d.ref.delete();
    if (rec.size) console.log(`· ${rec.size} recibo(s) do fechamento de teste apagado(s)`);

    const conf = await db.collection('monthly_closings').doc(CLOSING_ID).get();
    console.log(conf.exists ? '✗ o fechamento NÃO foi apagado — confira à mão' : '· staging limpo');
  }

  console.log(`\n${fails === 0 ? '✅' : '❌'} ${checks - fails}/${checks} verificações`);
  process.exit(fails === 0 ? 0 : 1);
})();
