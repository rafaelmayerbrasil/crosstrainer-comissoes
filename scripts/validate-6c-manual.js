// ═══════════════════════════════════════════════════════════════════════
// Validação manual dos 3 itens visuais da Sprint 6c:
//   C5  — Painel professor "📊 Meu Saldo"  (login professor@teste.com)
//   C9  — Card vermelho de vencidas         (login admin)
//   Bal — Balance warning no modal admin    (login admin)
//
// Uso:    node scripts/validate-6c-manual.js --project staging
// Cleanup: node scripts/validate-6c-manual.js --project staging cleanup
// ═══════════════════════════════════════════════════════════════════════

'use strict';

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

const args = process.argv.slice(2);
const projectArg = args.find(a => a.startsWith('--project='))?.split('=')[1]
  || (args.includes('--project') ? args[args.indexOf('--project') + 1] : null);

if (projectArg !== 'staging') {
  console.error('Uso: node validate-6c-manual.js --project staging  [cleanup]');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccount-staging.json'))),
  projectId: 'crosstrainer-comissoes-staging',
});

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const FieldValue = admin.firestore.FieldValue;
const stateFile = path.join(__dirname, '.validate-6c-state.json');

const isCleanup = args.includes('cleanup');

(async () => {
  try {
    if (isCleanup) {
      await doCleanup();
    } else {
      await doSetup();
    }
  } catch (err) {
    console.error('\nERRO:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  } finally {
    await admin.app().delete();
  }
})();

async function doSetup() {
  console.log('\n══════ VALIDAÇÃO MANUAL Sprint 6c — C5 + C9 + Balance Admin ══════\n');

  const created = {
    overdueTeacherId: null,
    activeVacationIds: [],
    professorTeacherId: 'BWtYS5l6kNtkAMpTtBVw',  // Nome de teste (já existe)
    tempPassword: null,
  };

  // ─── 1) Reseta senha do professor@teste.com ──────────────────────
  console.log('1) Resetando senha temporária do professor@teste.com...');
  let userRecord;
  try {
    userRecord = await admin.auth().getUserByEmail('professor@teste.com');
  } catch (_) {
    throw new Error('Usuário professor@teste.com não existe no Auth. Crie manualmente no Firebase Console.');
  }
  const tempPassword = 'Valida6C' + Math.random().toString(36).slice(2, 8) + '!';
  await admin.auth().updateUser(userRecord.uid, { password: tempPassword });
  created.tempPassword = tempPassword;
  console.log(`   OK senha temporária definida: ${tempPassword}`);
  console.log(`   (será removida no cleanup — você precisa redefinir uma nova depois)`);

  // ─── 2) Cria 1 vacation aprovada de 25 dias pro "Nome de teste" ─
  // hireDate = 2025-10-01 → 1º período aquisitivo: 01/10/2025 - 30/09/2026
  // 25 dias aprovados → daysRemaining=5 (mostra saldo apertado na UI)
  console.log('\n2) Criando vacation aprovada de 25 dias pro "Nome de teste" (saldo=5)...');
  const teacherRef = await db.collection('teachers').doc(created.professorTeacherId).get();
  if (!teacherRef.exists) throw new Error('Teacher BWtYS5l6kNtkAMpTtBVw não encontrado');
  const teacher = teacherRef.data();

  const vacStart = new Date(2026, 7, 3);   // 03/08/2026
  const vacEnd = new Date(2026, 7, 27);    // 27/08/2026 — 25 dias inclusivo
  const vacRef = db.collection('vacation_requests').doc();
  created.activeVacationIds.push(vacRef.id);
  await vacRef.set({
    teacherId: created.professorTeacherId,
    teacherName: teacher.name,
    teacherType: 'efetivo',
    unitId: teacher.primaryUnitId || 'unit-cp',
    type: 'ferias',
    periods: [{
      startDate: Timestamp.fromDate(vacStart),
      endDate: Timestamp.fromDate(vacEnd),
      days: 25,
    }],
    totalDays: 25,
    firstPeriodStart: Timestamp.fromDate(vacStart),
    lastPeriodEnd: Timestamp.fromDate(vacEnd),
    reason: 'FIXTURE-6C-C5',
    status: 'aprovada',
    requestedAt: FieldValue.serverTimestamp(),
    requestedBy: 'fixture',
    respondedAt: FieldValue.serverTimestamp(),
    respondedBy: 'fixture',
    paidInClosingIds: [],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`   OK vacation ${vacRef.id} criada (25 dias no período aquisitivo atual)`);

  // ─── 3) Cria teacher FIXTURE OVERDUE (hireDate 01/01/2020) ──────
  console.log('\n3) Criando teacher fixture OVERDUE (hireDate=01/01/2020)...');
  const overdueRef = db.collection('teachers').doc();
  created.overdueTeacherId = overdueRef.id;
  await overdueRef.set({
    name: 'FIXTURE-6C Overdue Vencidão',
    type: 'efetivo',
    isActive: true,
    hireDate: Timestamp.fromDate(new Date(2020, 0, 1)),
    primaryUnitId: 'unit-cp',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`   OK teacher ${overdueRef.id} criado (1º período venceu em 01/01/2021, concessivo expirou em 01/01/2022)`);

  fs.writeFileSync(stateFile, JSON.stringify(created, null, 2));
  console.log(`\nEstado salvo em ${stateFile}\n`);

  // ─── Checklist ─────────────────────────────────────────────────
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('  CHECKLIST DE VALIDAÇÃO — Sprint 6c (3 itens cosméticos)');
  console.log('═════════════════════════════════════════════════════════════════\n');

  console.log('🌐 URL: https://crosstrainer-comissoes-staging.web.app/professores.html\n');

  console.log('📋 PARTE A — Logado como ADMIN (abluir@gmail.com)\n');
  console.log('  C9 — Card vermelho de vencidas:');
  console.log('    1. Sidebar → "📊 Saldos de Férias" (ou similar)');
  console.log('    2. Deve aparecer card 🚨 ATENÇÃO no topo: "1 professor(es) com férias vencidas"');
  console.log('    3. Nome do prof: "FIXTURE-6C Overdue Vencidão"');
  console.log('    4. Mensagem: "CLT exige pagamento dobrado..."');
  console.log('    5. Na tabela abaixo, badge 🔴 VENCIDA na linha desse prof\n');

  console.log('  BAL — Balance warning no modal admin:');
  console.log('    1. Sidebar → "🏖️ Gerenciar Férias"');
  console.log('    2. Botão "+ Nova solicitação (admin)" no topo');
  console.log('    3. No select de professor, escolha "Nome de teste"');
  console.log('    4. Deve aparecer bloco saldo: "📊 Seu saldo atual" com já tirou=25, restam=5');
  console.log('    5. Preenche datas: 10/09/2026 até 19/09/2026 (10 dias)');
  console.log('    6. Após preencher, deve aparecer ⚠️ "excede o saldo em 5 dias"');
  console.log('    7. Campo "Justificativa (obrigatória)" deve aparecer');
  console.log('    8. Clica "Enviar" SEM justificativa → erro de validação');
  console.log('    9. Digita uma justificativa qualquer e envia → sucesso\n');

  console.log('📋 PARTE B — Logado como PROFESSOR\n');
  console.log(`  Login:    professor@teste.com`);
  console.log(`  Senha:    ${tempPassword}`);
  console.log('  (senha temporária — vai sumir no cleanup)\n');
  console.log('  C5 — Painel "📊 Meu Saldo":');
  console.log('    1. Sidebar → "📊 Meu Saldo" (ou nome similar)');
  console.log('    2. Card grande no topo deve mostrar:');
  console.log('       "Você tem 5 dias disponíveis até DD/MM/AAAA"');
  console.log('    3. Tabela de histórico (ainda vazia se for o 1º período)');
  console.log('    4. Botão "Solicitar férias agora"\n');

  console.log('  💡 Para abrir o modal de solicitação como prof:');
  console.log('    1. Clica "Solicitar férias agora" OU vai em "🏖️ Minhas Férias"');
  console.log('    2. Modal deve mostrar bloco de saldo também (já existia, validação extra)');
  console.log('    3. Preenche datas excedendo → mostra ⚠️ + pede justificativa\n');

  console.log('Após validar tudo, rode CLEANUP:');
  console.log('   node scripts/validate-6c-manual.js --project staging cleanup\n');
  console.log('Isso remove:');
  console.log('  - vacation_request fixture do "Nome de teste"');
  console.log('  - teacher fixture "Overdue Vencidão"');
  console.log('  - Senha do professor@teste.com (você redefine via Console)\n');
}

async function doCleanup() {
  if (!fs.existsSync(stateFile)) {
    console.log('Sem arquivo de estado — nada a limpar.');
    return;
  }
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  console.log('\n🧹 Cleanup de fixtures Sprint 6c:\n');

  for (const vid of state.activeVacationIds || []) {
    await db.collection('vacation_requests').doc(vid).delete();
    console.log(`  OK vacation ${vid} removida`);
  }
  if (state.overdueTeacherId) {
    await db.collection('teachers').doc(state.overdueTeacherId).delete();
    console.log(`  OK teacher overdue ${state.overdueTeacherId} removido`);
  }

  // Remove senha do professor@teste.com (gera uma random irrecuperável)
  try {
    const userRecord = await admin.auth().getUserByEmail('professor@teste.com');
    const randomLost = require('crypto').randomBytes(16).toString('hex') + 'Z!';
    await admin.auth().updateUser(userRecord.uid, { password: randomLost });
    console.log(`  OK senha de professor@teste.com invalidada (você precisa redefinir no Console)`);
  } catch (e) {
    console.log(`  (skip auth reset: ${e.message})`);
  }

  fs.unlinkSync(stateFile);
  console.log(`  OK ${stateFile} removido`);
  console.log('\nCleanup completo.\n');
}
