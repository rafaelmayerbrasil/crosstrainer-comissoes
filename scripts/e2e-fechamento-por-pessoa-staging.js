'use strict';
// Roda: node scripts/e2e-fechamento-por-pessoa-staging.js [--mes 2026-08]
//
// ══════════════════════════════════════════════════════════════════════
// FECHA UM MÊS DE VERDADE no staging e confere o que ficou gravado
// ══════════════════════════════════════════════════════════════════════
//
// Chama a Cloud Function `closeMonth` como a tela chama (token de admin real,
// HTTP de verdade) e compara o documento gravado com o que `closing-payroll.js`
// diz que deveria ser. É a única forma de provar que os dois caminhos — o
// módulo puro e a transação da CF — dão o mesmo número; a duplicação de bolsa
// de agosto/2026 morava exatamente entre duas cópias da mesma conta.
//
// Faz e DESFAZ: no fim apaga o fechamento, devolve `monthClosingId` das aulas
// ao que era, e restaura saldos e movimentos do banco de horas.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const Folha = require('../closing-payroll.js');

const PROJECT = 'crosstrainer-comissoes-staging';
const REGION = 'us-central1';
const args = process.argv.slice(2);
const mesArg = args.includes('--mes') ? args[args.indexOf('--mes') + 1] : '2026-08';
const [ANO, MES] = mesArg.split('-').map(Number);

const svc = path.join(__dirname, 'serviceAccount-staging.json');
if (!fs.existsSync(svc)) { console.error('Falta scripts/serviceAccount-staging.json'); process.exit(1); }
const cfg = fs.readFileSync(path.join(__dirname, '..', 'firebase-config.js'), 'utf8');
const apiKey = (cfg.match(/apiKey:\s*['"]([^'"]+)['"][\s\S]{0,120}?crosstrainer-comissoes-staging/) || [])[1];
if (!apiKey) { console.error('não achei a apiKey do staging em firebase-config.js'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(require(svc)), projectId: PROJECT });
const db = admin.firestore();

const ADMIN = { email: 'dono.teste@crosstainer.com', pass: 'crosstainer2026' };
const CLOSING_ID = `${ANO}-${String(MES).padStart(2, '0')}`;

let checks = 0, fails = 0;
function ok(desc, cond, detalhe) {
  checks++; if (!cond) fails++;
  console.log(`${cond ? '✓' : '✗'} ${desc}${detalhe ? ' — ' + detalhe : ''}`);
}
const fmt = n => 'R$ ' + (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');

async function tokenDoAdmin() {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN.email, password: ADMIN.pass, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('login do admin de demo falhou: ' + JSON.stringify(j.error || j));
  return j.idToken;
}

async function chamarCloseMonth(idToken, payload) {
  const r = await fetch(`https://${REGION}-${PROJECT}.cloudfunctions.net/closeMonth`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: payload }),
  });
  const txt = await r.text();
  let json = null; try { json = JSON.parse(txt); } catch (_) {}
  return { status: r.status, json, txt: txt.slice(0, 400) };
}

(async () => {
  const inicio = new Date(ANO, MES - 1, 1, 0, 0, 0);
  const fim = new Date(ANO, MES, 0, 23, 59, 59, 999);

  // ── 0) estado anterior, pra desfazer tudo no fim ────────────────────
  const antesClosing = await db.collection('monthly_closings').doc(CLOSING_ID).get();
  if (antesClosing.exists) {
    console.error(`✗ já existe monthly_closings/${CLOSING_ID} no staging. Apague antes de rodar.`);
    process.exit(1);
  }
  const clsSnap = await db.collection('classes')
    .where('scheduledDate', '>=', inicio).where('scheduledDate', '<=', fim).get();
  const classesAntes = clsSnap.docs.map(d => ({ id: d.id, monthClosingId: d.data().monthClosingId || null }));
  const balAntes = (await db.collection('intern_hour_balances').get()).docs.map(d => ({ id: d.id, data: d.data() }));
  const movAntes = (await db.collection('intern_hour_movements').get()).docs.map(d => ({ id: d.id, data: d.data() }));
  console.log(`estado guardado: ${classesAntes.length} aulas · ${balAntes.length} saldos · ${movAntes.length} movimentos\n`);

  let fechou = false;
  let aulaFixture = null;   // a aula que criamos pra forçar o caso caro
  try {
    // ── 0b) fixture: um BOLSISTA com aula nas DUAS unidades ───────────
    // É o caso que custava caro (bolsa inteira em cada fechamento) e o staging
    // não tinha nenhum. Sem forçar, o teste passaria sem tocar no que importa.
    const salMap = new Map((await db.collection('teacher_salaries').get()).docs.map(d => [d.id, d.data()]));
    const teachMap = new Map((await db.collection('teachers').get()).docs.map(d => [d.id, { id: d.id, ...d.data() }]));
    const doMes = clsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.status === 'realizada' || c.status === 'substituida');
    const bolsista = [...new Set(doMes.map(c => c.teacherId))]
      .map(id => teachMap.get(id))
      .find(t => t && Folha.ehBolsista(t, salMap.get(t.id)));

    if (bolsista) {
      const dele = doMes.filter(c => c.teacherId === bolsista.id);
      const unidadesDele = new Set(dele.map(c => c.unitId));
      const outra = ['unit-cp', 'unit-pp'].find(u => !unidadesDele.has(u));
      if (outra) {
        // cópia de uma aula real dele, na outra unidade. `id` sai do objeto —
        // o Firestore recusa `undefined` como valor de campo.
        const base = Object.assign({}, dele[0]);
        delete base.id;
        const ref = db.collection('classes').doc();
        await ref.set(Object.assign(base, {
          unitId: outra,
          status: 'realizada',
          monthClosingId: null,
          _fixtureE2E: true,
        }));
        aulaFixture = { id: ref.id, teacherId: bolsista.id, nome: bolsista.name, unidade: outra };
        console.log(`fixture: ${bolsista.name} ganhou 1 aula em ${outra} — agora dá aula nas duas
`);
      }
    }

    // ── 1) o que a conta pura diz que tem que sair ────────────────────
    const [unitsSnap, teachSnap, salSnap, stSnap] = await Promise.all([
      db.collection('units').get(), db.collection('teachers').get(),
      db.collection('teacher_salaries').get(), db.collection('special_scale_types').get(),
    ]);
    // relê as aulas: a fixture acima acrescentou uma, e comparar a conta pura
    // com o que a CF vai ver exige que as duas olhem o MESMO conjunto
    const clsAgora = await db.collection('classes')
      .where('scheduledDate', '>=', inicio).where('scheduledDate', '<=', fim).get();
    const esperado = Folha.montarFolha({
      classes: clsAgora.docs.map(d => ({ id: d.id, ...d.data() })),
      teachers: new Map(teachSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }])),
      salaries: new Map(salSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }])),
      scaleTypes: new Map(stSnap.docs.map(d => [d.id, d.data()])),
      units: new Map(unitsSnap.docs.map(d => [d.id, d.data()])),
      ano: ANO, mes: MES, ultimoDiaDoMes: fim, bancos: {},
    });
    console.log(`o módulo puro diz: ${esperado.pessoas.length} pessoas · ${fmt(esperado.totais.totalValor)}\n`);

    // ── 2) fecha de verdade, pela CF, com token de admin ──────────────
    const tok = await tokenDoAdmin();

    const semAno = await chamarCloseMonth(tok, { month: MES });
    ok('sem o ano, a CF recusa', semAno.status >= 400, 'HTTP ' + semAno.status);

    const r = await chamarCloseMonth(tok, { year: ANO, month: MES });
    ok('closeMonth respondeu OK', r.status === 200 && r.json && r.json.result && r.json.result.success,
      'HTTP ' + r.status + (r.status !== 200 ? ' · ' + r.txt : ''));
    if (r.status !== 200) throw new Error('closeMonth falhou: ' + r.txt);
    fechou = true;

    ok('o id do fechamento é o do MÊS, sem unidade',
      r.json.result.closingId === CLOSING_ID, r.json.result.closingId);

    // ── 3) o que ficou gravado ───────────────────────────────────────
    const doc = await db.collection('monthly_closings').doc(CLOSING_ID).get();
    ok('o documento do fechamento existe', doc.exists);
    const d = doc.data();
    const gravadas = d.teachers || [];

    ok('status fechado', d.status === 'fechado', d.status);
    ok('guarda as unidades que cobriu (unitIds, não unitId)',
      Array.isArray(d.unitIds) && d.unitIds.length > 0 && d.unitId === undefined,
      JSON.stringify(d.unitIds));

    const ids = gravadas.map(t => t.teacherId);
    ok('ninguém aparece duas vezes', new Set(ids).size === ids.length, ids.length + ' linhas');

    ok('mesma gente que o módulo puro',
      JSON.stringify(ids.slice().sort()) === JSON.stringify(esperado.pessoas.map(p => p.teacherId).sort()),
      gravadas.length + ' × ' + esperado.pessoas.length);

    // o teste que importa: cada valor gravado bate com a conta pura
    let divergiram = [];
    for (const p of esperado.pessoas) {
      const g = gravadas.find(x => x.teacherId === p.teacherId);
      if (!g) { divergiram.push(p.teacherName + ' (não gravado)'); continue; }
      const cmp = [
        ['horas', p.totalHoras, g.totalHoras],
        ['valorHoras', p.valorHoras, g.valorHoras],
        ['VR', p.mealAllowance, g.mealAllowance],
        ['VT', p.transportAllowance, g.transportAllowance],
        ['aulas', p.classesCount, g.classesCount],
      ];
      for (const [campo, a, b] of cmp) {
        if (Math.abs((a || 0) - (b || 0)) > 0.02) divergiram.push(`${p.teacherName}: ${campo} ${a} ≠ ${b}`);
      }
    }
    ok('cada valor gravado bate com o módulo puro', divergiram.length === 0,
      divergiram.length ? divergiram.slice(0, 5).join(' | ') : 'todos conferem');

    ok('a divisão por unidade foi gravada',
      gravadas.every(t => Array.isArray(t.porUnidade)) && gravadas.some(t => t.porUnidade.length > 0));
    ok('a soma das unidades fecha com o total de cada pessoa',
      gravadas.every(t => Math.abs(t.porUnidade.reduce((s, u) => s + u.horas, 0) - t.totalHoras) < 0.02));
    ok('os avisos de cadastro foram gravados', gravadas.every(t => Array.isArray(t.avisos)));

    // ── o caso que custava R$ 7.580,84: bolsista nas duas unidades ────
    if (aulaFixture) {
      const linhas = gravadas.filter(t => t.teacherId === aulaFixture.teacherId);
      ok('o bolsista das duas unidades tem UMA linha só', linhas.length === 1, linhas.length + ' linha(s)');
      const g = linhas[0] || {};
      ok('e a linha mostra as duas unidades', (g.porUnidade || []).length === 2,
        (g.porUnidade || []).map(u => u.unitId).join('+'));
      const bolsa = g.internStipendUsed || 0;
      ok('a bolsa entrou UMA vez, não uma por unidade',
        bolsa > 0 && g.valorHoras >= bolsa && g.valorHoras < bolsa * 2,
        'bolsa ' + fmt(bolsa) + ' · pago ' + fmt(g.valorHoras));
      const bene = (g.mealAllowance || 0) + (g.transportAllowance || 0) + (g.totalOutros || 0);
      const esperadoDele = esperado.pessoas.find(p => p.teacherId === aulaFixture.teacherId) || {};
      ok('e os benefícios também',
        Math.abs(bene - ((esperadoDele.mealAllowance || 0) + (esperadoDele.transportAllowance || 0)
          + (esperadoDele.totalOutros || 0))) < 0.02, fmt(bene));
    }

    ok('o total do mês é a soma das linhas',
      Math.abs(gravadas.reduce((s, t) => s + (t.valorTotal || 0), 0) - d.totals.totalValor) < 0.02,
      fmt(d.totals.totalValor));

    // ── 4) as aulas foram congeladas ─────────────────────────────────
    const depoisCls = await db.collection('classes')
      .where('scheduledDate', '>=', inicio).where('scheduledDate', '<=', fim).get();
    const congeladas = depoisCls.docs.filter(x => x.data().monthClosingId === CLOSING_ID).length;
    ok('as aulas do mês ficaram congeladas com o id novo',
      congeladas === depoisCls.size, congeladas + '/' + depoisCls.size);

    // ── 5) fechar duas vezes tem que falhar ──────────────────────────
    const r2 = await chamarCloseMonth(tok, { year: ANO, month: MES });
    ok('fechar o mesmo mês duas vezes é recusado', r2.status >= 400, 'HTTP ' + r2.status);

    // ── 6) banco de horas dos bolsistas ──────────────────────────────
    const bolsistas = gravadas.filter(t => t.isIntern);
    if (bolsistas.length) {
      const movs = await db.collection('intern_hour_movements')
        .where('mes', '==', CLOSING_ID).get();
      ok('cada bolsista ganhou um movimento do mês',
        movs.size >= bolsistas.filter(t => !t.internSemContrato).length,
        movs.size + ' movimento(s) para ' + bolsistas.length + ' bolsista(s)');
      const semUnidade = movs.docs.filter(m => !Array.isArray(m.data().unitIds));
      ok('o movimento registra as unidades cobertas', semUnidade.length === 0);
    } else {
      console.log('· nenhum bolsista com aula no mês — banco de horas não exercitado');
    }

  } catch (err) {
    fails++;
    console.error('\n✗ ERRO:', err.message);
  } finally {
    // ── 7) desfaz TUDO ────────────────────────────────────────────────
    console.log('\n── desfazendo ──');
    // ORDEM IMPORTA: primeiro devolve o monthClosingId das aulas de verdade,
    // DEPOIS apaga as de fixture. Ao contrário, o batch tenta atualizar um
    // documento que acabou de ser apagado, estoura no meio, e as 43 aulas
    // reais ficam congeladas apontando pra um fechamento que não existe mais —
    // foi exatamente o que aconteceu em 05/09/2026, e deu trabalho desfazer.
    const idsFixture = new Set();
    if (aulaFixture) idsFixture.add(aulaFixture.id);
    const sobras = await db.collection('classes').where('_fixtureE2E', '==', true).get();
    sobras.docs.forEach(d => idsFixture.add(d.id));

    const paraRestaurar = classesAntes.filter(c => !idsFixture.has(c.id));
    let lote = db.batch(), n = 0;
    for (const c of paraRestaurar) {
      lote.update(db.collection('classes').doc(c.id), { monthClosingId: c.monthClosingId });
      if (++n % 400 === 0) { await lote.commit(); lote = db.batch(); }
    }
    if (n % 400 !== 0) await lote.commit();
    console.log(`· monthClosingId de ${paraRestaurar.length} aulas devolvido ao que era`);

    for (const id of idsFixture) {
      await db.collection('classes').doc(id).delete();
    }
    if (idsFixture.size) console.log(`· ${idsFixture.size} aula(s) de fixture apagada(s)`);

    if (fechou) {
      await db.collection('monthly_closings').doc(CLOSING_ID).delete();
      console.log('· fechamento apagado');
    }

    // saldo e movimento do banco de horas voltam ao que eram: o fechamento
    // escreve neles, e deixar sujo envenena a próxima rodada
    const balDepois = await db.collection('intern_hour_balances').get();
    for (const doc of balDepois.docs) {
      const antes = balAntes.find(b => b.id === doc.id);
      if (antes) await doc.ref.set(antes.data); else await doc.ref.delete();
    }
    const movDepois = await db.collection('intern_hour_movements').get();
    for (const doc of movDepois.docs) {
      const antes = movAntes.find(m => m.id === doc.id);
      if (antes) await doc.ref.set(antes.data); else await doc.ref.delete();
    }
    console.log(`· banco de horas restaurado (${balAntes.length} saldo(s), ${movAntes.length} movimento(s))`);

    const conf = await db.collection('monthly_closings').doc(CLOSING_ID).get();
    console.log(conf.exists ? '✗ o fechamento NÃO foi apagado — confira à mão' : '· staging limpo');
  }

  console.log(`\n${fails === 0 ? '✅' : '❌'} ${checks - fails}/${checks} verificações`);
  process.exit(fails === 0 ? 0 : 1);
})();
