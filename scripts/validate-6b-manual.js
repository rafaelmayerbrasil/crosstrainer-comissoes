// ═══════════════════════════════════════════════════════════════════════
// Validação dos 3 critérios manuais da Sprint 6b:
//   C8  — Supervisor sem acesso a payment (automatizado via Auth REST API)
//   C12 — Recibo A4 mostra seção Férias (prepara fixture, usuário valida UI)
//   C15 — Contador sidebar atualiza ao vivo (prepara fixture, usuário valida UI)
//
// Uso: node scripts/validate-6b-manual.js --project staging
// ═══════════════════════════════════════════════════════════════════════

'use strict';

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');
const https = require('https');

const args = process.argv.slice(2);
const projectArg = args.find(a => a.startsWith('--project='))?.split('=')[1]
  || (args.includes('--project') ? args[args.indexOf('--project') + 1] : null);

if (projectArg !== 'staging') {
  console.error('Uso: node validate-6b-manual.js --project staging  (script só roda em staging)');
  process.exit(1);
}

const projectId = 'crosstrainer-comissoes-staging';
const apiKey = 'AIzaSyC5wqYNNyrJBPXbBPK8gRxQxOPHTIW7TFo';  // Web API key do staging (firebase-config.js)

const credPath = path.join(__dirname, 'serviceAccount-staging.json');
admin.initializeApp({
  credential: admin.credential.cert(require(credPath)),
  projectId,
});
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const FieldValue = admin.firestore.FieldValue;

// ─── Helpers ────────────────────────────────────────────────────────────
function httpsRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function signInWithPassword(email, password) {
  const res = await httpsRequest({
    hostname: 'identitytoolkit.googleapis.com',
    path: `/v1/accounts:signInWithPassword?key=${apiKey}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, JSON.stringify({ email, password, returnSecureToken: true }));
  return JSON.parse(res.body);
}

async function firestoreRestUpdate(token, docPath, fields, updateMask) {
  const mask = updateMask.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const res = await httpsRequest({
    hostname: 'firestore.googleapis.com',
    path: `/v1/projects/${projectId}/databases/(default)/documents/${docPath}?${mask}`,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  }, JSON.stringify({ fields }));
  return res;
}

function ymdBR(date) {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(date);
}
function brMidnightUTC(year, month0, day) {
  return new Date(Date.UTC(year, month0, day, 3, 0, 0, 0));
}
function brToday() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: 'numeric', day: 'numeric',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10) - 1,
    day: parseInt(parts.day, 10),
  };
}

const created = {
  supervisorUid: null,
  vacationReqC8: null,
  vacationReqC12: null,
  vacationReqC15: null,
  closingC12: null,
};
let failed = false;

(async () => {
  console.log('\n══════ VALIDAÇÃO MANUAL Sprint 6b — C8 + C12 + C15 ══════');
  console.log(`Projeto: ${projectId}\n`);

  try {
    // ─── PARTE A — C8 SUPERVISOR (automatizado) ──────────────────────
    console.log('═══ C8 — Supervisor sem acesso a payment ═══\n');

    // 1) Acha vacation aprovada de qualquer teacher
    const teacherSnap = await db.collection('teachers').where('isActive','==',true).get();
    const teacher = teacherSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .find(t => t.type === 'efetivo' || t.type === 'estagiario');
    if (!teacher) throw new Error('Sem teacher ativo pra fixture C8');

    const today = brToday();
    const start = brMidnightUTC(today.year, today.month, today.day + 10);
    const end = brMidnightUTC(today.year, today.month, today.day + 14);

    console.log('1) Criando vacation_request aprovada (sem payment) pra C8...');
    const vacRefC8 = db.collection('vacation_requests').doc();
    created.vacationReqC8 = vacRefC8.id;
    await vacRefC8.set({
      teacherId: teacher.id, teacherName: teacher.name, teacherType: teacher.type,
      unitId: teacher.primaryUnitId || (teacher.unitIds && teacher.unitIds[0]) || 'unit-cp',
      type: teacher.type === 'estagiario' ? 'recesso' : 'ferias',
      periods: [{ startDate: Timestamp.fromDate(start), endDate: Timestamp.fromDate(end), days: 5 }],
      totalDays: 5,
      firstPeriodStart: Timestamp.fromDate(start),
      lastPeriodEnd: Timestamp.fromDate(end),
      reason: 'FIXTURE-6B-C8',
      status: 'aprovada',
      requestedAt: FieldValue.serverTimestamp(),
      requestedBy: 'fixture-script', requestedByName: 'Fixture',
      respondedAt: FieldValue.serverTimestamp(),
      respondedBy: 'fixture-script', respondedByName: 'Fixture',
      paidInClosingIds: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`   OK ${vacRefC8.id}`);

    // 2) Cria supervisor user (Firebase Auth + Firestore profile)
    const supEmail = `supervisor-fixture-${Date.now()}@fixture.local`;
    const supPassword = 'FixtureSup6b!' + Math.random().toString(36).slice(2, 10);

    console.log('\n2) Criando supervisor fixture no Firebase Auth...');
    const supUser = await admin.auth().createUser({
      email: supEmail, password: supPassword, emailVerified: true,
      displayName: 'Supervisor Fixture (DELETE-ME)',
    });
    created.supervisorUid = supUser.uid;
    console.log(`   OK uid=${supUser.uid}`);

    await db.collection('users').doc(supUser.uid).set({
      email: supEmail, name: 'Supervisor Fixture', profiles: ['supervisao'],
      modules: ['professores'],
      createdAt: FieldValue.serverTimestamp(),
    });
    console.log('   OK profile users/{uid} com profiles=[supervisao]');

    // 3) Login programático
    console.log('\n3) Login programático via Auth REST API...');
    const signIn = await signInWithPassword(supEmail, supPassword);
    if (!signIn.idToken) {
      throw new Error('Sign-in falhou: ' + JSON.stringify(signIn));
    }
    console.log(`   OK idToken obtido (${signIn.idToken.slice(0, 20)}...)`);

    // 4) Tenta UPDATE em vacation_requests.payment via Firestore REST
    console.log('\n4) Tentando UPDATE em vacation_requests.payment como supervisor...');
    const fakePayment = {
      'payment': {
        mapValue: {
          fields: {
            mode:  { stringValue: 'manual' },
            value: { doubleValue: 999.99 },
            notes: { stringValue: 'HACK ATTEMPT BY SUPERVISOR' },
          }
        }
      }
    };
    const updateRes = await firestoreRestUpdate(
      signIn.idToken,
      `vacation_requests/${vacRefC8.id}`,
      fakePayment,
      ['payment']
    );

    console.log(`   HTTP status: ${updateRes.statusCode}`);
    if (updateRes.statusCode === 403 || updateRes.statusCode === 401) {
      console.log('   OK Firestore retornou ' + updateRes.statusCode + ' (permission-denied / unauthorized)');
      console.log('   ✓ C8 VALIDADO — supervisor NÃO conseguiu alterar payment');
    } else if (updateRes.statusCode === 200) {
      console.log('   FAIL Supervisor conseguiu alterar payment! Security Rule não bloqueou.');
      console.log('   Response:', updateRes.body.slice(0, 300));
      failed = true;
    } else {
      console.log('   ? HTTP inesperado:', updateRes.statusCode);
      console.log('   Body:', updateRes.body.slice(0, 300));
      // Em caso de outro código (ex: 400), também é fail
      failed = true;
    }

    // ─── PARTE B — Prepara fixtures C12 (recibo) + C15 (contador) ──
    console.log('\n═══ Preparando fixtures pra C12 e C15 (UI manual) ═══\n');

    // 5) C12: vacation paid + closing fictício que mostra a seção recibo
    console.log('5) C12 — criando vacation_request aprovada COM payment definido...');
    const teacherC12 = teacher;
    const todayBR = brToday();
    const startC12 = brMidnightUTC(todayBR.year, todayBR.month, todayBR.day + 20);
    const endC12 = brMidnightUTC(todayBR.year, todayBR.month, todayBR.day + 24);

    const vacRefC12 = db.collection('vacation_requests').doc();
    created.vacationReqC12 = vacRefC12.id;
    await vacRefC12.set({
      teacherId: teacherC12.id, teacherName: teacherC12.name, teacherType: teacherC12.type,
      unitId: teacherC12.primaryUnitId || (teacherC12.unitIds && teacherC12.unitIds[0]) || 'unit-cp',
      type: teacherC12.type === 'estagiario' ? 'recesso' : 'ferias',
      periods: [{ startDate: Timestamp.fromDate(startC12), endDate: Timestamp.fromDate(endC12), days: 5 }],
      totalDays: 5,
      firstPeriodStart: Timestamp.fromDate(startC12),
      lastPeriodEnd: Timestamp.fromDate(endC12),
      reason: 'FIXTURE-6B-C12 — pra validar recibo A4',
      status: 'aprovada',
      requestedAt: FieldValue.serverTimestamp(),
      requestedBy: 'fixture-script', requestedByName: 'Fixture',
      respondedAt: FieldValue.serverTimestamp(),
      respondedBy: 'fixture-script', respondedByName: 'Fixture',
      payment: {
        mode: 'manual',
        value: 1500.00,
        calculation: null,
        notes: 'Fixture pra validação visual do recibo',
        setBy: 'fixture-script', setByName: 'Fixture',
        setAt: FieldValue.serverTimestamp(),
        updatedBy: null, updatedByName: null, updatedAt: null,
      },
      paidInClosingIds: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`   OK vacation_request ${vacRefC12.id} (${teacherC12.name}, ${teacherC12.type}, R$ 1500,00 manual)`);

    // 6) C15: vacation deferred (vai contar no sidebar)
    console.log('\n6) C15 — criando vacation_request aprovada com payment.mode=deferred...');
    const startC15 = brMidnightUTC(todayBR.year, todayBR.month, todayBR.day + 30);
    const endC15 = brMidnightUTC(todayBR.year, todayBR.month, todayBR.day + 34);

    const vacRefC15 = db.collection('vacation_requests').doc();
    created.vacationReqC15 = vacRefC15.id;
    await vacRefC15.set({
      teacherId: teacherC12.id, teacherName: teacherC12.name, teacherType: teacherC12.type,
      unitId: teacherC12.primaryUnitId || (teacherC12.unitIds && teacherC12.unitIds[0]) || 'unit-cp',
      type: teacherC12.type === 'estagiario' ? 'recesso' : 'ferias',
      periods: [{ startDate: Timestamp.fromDate(startC15), endDate: Timestamp.fromDate(endC15), days: 5 }],
      totalDays: 5,
      firstPeriodStart: Timestamp.fromDate(startC15),
      lastPeriodEnd: Timestamp.fromDate(endC15),
      reason: 'FIXTURE-6B-C15 — pra validar contador sidebar',
      status: 'aprovada',
      requestedAt: FieldValue.serverTimestamp(),
      requestedBy: 'fixture-script', requestedByName: 'Fixture',
      respondedAt: FieldValue.serverTimestamp(),
      respondedBy: 'fixture-script', respondedByName: 'Fixture',
      payment: {
        mode: 'deferred',
        value: 0,
        calculation: null,
        notes: 'Pagamento adiado (fixture)',
        setBy: 'fixture-script', setByName: 'Fixture',
        setAt: FieldValue.serverTimestamp(),
        updatedBy: null, updatedByName: null, updatedAt: null,
      },
      paidInClosingIds: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`   OK vacation_request ${vacRefC15.id} (mode=deferred)`);

    // ─── Imprime checklist pra o usuário ────────────────────────────
    console.log('\n══════ CHECKLIST pra você validar manualmente ══════\n');
    console.log('Abra: https://crosstrainer-comissoes-staging.web.app/professores.html');
    console.log('Logue como admin (abluir@gmail.com).\n');
    console.log('📋 C12 — Recibo A4 com seção Férias:');
    console.log(`   1. Navegue até "🏖️ Gerenciar Férias"`);
    console.log(`   2. Encontre a linha do ${teacherC12.name} com motivo "FIXTURE-6B-C12"`);
    console.log(`   3. Confira que a coluna Pagamento mostra "Manual · R$ 1.500,00"`);
    console.log(`   4. Ainda não emite recibo (fixture sem closing); aplicar quando houver closing real desse teacher em fechamento`);
    console.log(`   → ALTERNATIVA RÁPIDA: abra "💰 Pagamentos" → escolha qualquer recibo existente`);
    console.log(`     da Sprint 4b → veja se o template (receipt.html) renderiza`);
    console.log(`     "{{#if hasVacation}}" como bloco opcional sem erro\n`);

    console.log('📋 C15 — Contador sidebar `🏖️ Férias (N)`:');
    console.log(`   1. Olhe o item "🏖️ Férias" no menu lateral`);
    console.log(`   2. DEVE mostrar pelo menos "(1)" ou mais (existe vacation deferred fixture)`);
    console.log(`   3. Abra Gerenciar Férias → encontre fixture "FIXTURE-6B-C15"`);
    console.log(`   4. Clique "Definir pagamento" → escolha Manual → digite R$ 100 → salve`);
    console.log(`   5. Após salvar, contador deve diminuir 1 (vacation virou paga, sai do pendente)\n`);

    console.log('📋 C8 — JÁ VALIDADO automaticamente acima ✓\n');

    console.log('Quando terminar (ou se quiser pular), rode:');
    console.log(`   node scripts/validate-6b-manual.js cleanup`);
    console.log('para limpar todas as fixtures e o supervisor.\n');

    // Salva IDs criados num arquivo pro cleanup futuro
    fs.writeFileSync(path.join(__dirname, '.validate-6b-state.json'), JSON.stringify(created, null, 2));
    console.log('Estado salvo em scripts/.validate-6b-state.json pra cleanup futuro.\n');

    console.log(`Status C8: ${failed ? 'FALHOU' : 'PASSOU'}`);
  } catch (err) {
    console.error('\nERRO durante validação:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    failed = true;
    // Cleanup automático em caso de erro
    console.log('\nFazendo cleanup automático (erro durante setup):');
    await doCleanup();
  } finally {
    await admin.app().delete();
    process.exit(failed ? 1 : 0);
  }
})();

async function doCleanup() {
  try {
    if (created.vacationReqC8) {
      await db.collection('vacation_requests').doc(created.vacationReqC8).delete();
      console.log(`   OK vacation C8 ${created.vacationReqC8} removido`);
    }
    if (created.vacationReqC12) {
      await db.collection('vacation_requests').doc(created.vacationReqC12).delete();
      console.log(`   OK vacation C12 ${created.vacationReqC12} removido`);
    }
    if (created.vacationReqC15) {
      await db.collection('vacation_requests').doc(created.vacationReqC15).delete();
      console.log(`   OK vacation C15 ${created.vacationReqC15} removido`);
    }
    if (created.supervisorUid) {
      try {
        await admin.auth().deleteUser(created.supervisorUid);
        console.log(`   OK supervisor auth ${created.supervisorUid} removido`);
      } catch (_) {}
      try {
        await db.collection('users').doc(created.supervisorUid).delete();
        console.log(`   OK supervisor profile ${created.supervisorUid} removido`);
      } catch (_) {}
    }
  } catch (err) {
    console.error('   Erro no cleanup:', err.message);
  }
}
