'use strict';
// Fixture do hub Pessoas (staging): 3 estados da junção + usuária de supervisão p/ validação REST.
// Roda:  node scripts/fixture-pessoas.js            (cria)
//        node scripts/fixture-pessoas.js --cleanup  (remove tudo)
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-staging.json')) });
const db = admin.firestore();
const auth = admin.auth();

const FIX = {
  teacherSemAcesso: { name: 'Fixture Pessoas SemAcesso', email: 'fix.pessoas.semacesso@teste.com' },
  teacherVinculado: { name: 'Fixture Pessoas Vinculado', email: 'fix.pessoas.prof@teste.com', pass: 'fixprof123' },
  supervisao:       { name: 'Fixture Pessoas Supervisao', email: 'fix.pessoas.superv@teste.com', pass: 'fixsuperv123' },
};

async function firstIds() {
  const mods = await db.collection('modalities').limit(1).get();
  const units = await db.collection('units').limit(1).get();
  if (mods.empty || units.empty) throw new Error('Staging precisa de >=1 modality e >=1 unit');
  return { modalityId: mods.docs[0].id, unitId: units.docs[0].id };
}

function teacherDoc(name, email, ids) {
  return {
    name, email, phone: '', cpf: '***.***.***-00', type: 'efetivo',
    unitIds: [ids.unitId], primaryUnitId: ids.unitId, modalityIds: [ids.modalityId],
    hireDate: admin.firestore.Timestamp.now(), isActive: true,
    notes: 'FIXTURE pessoas — pode apagar', createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: 'fixture',
  };
}

async function ensureAuthUser(email, pass, name) {
  try { const u = await auth.getUserByEmail(email); return u.uid; }
  catch { const u = await auth.createUser({ email, password: pass, displayName: name }); return u.uid; }
}

async function create() {
  const ids = await firstIds();
  // 1) teacher sem acesso
  const t1 = await db.collection('teachers').add(teacherDoc(FIX.teacherSemAcesso.name, FIX.teacherSemAcesso.email, ids));
  // 2) teacher + user vinculados
  const t2 = await db.collection('teachers').add(teacherDoc(FIX.teacherVinculado.name, FIX.teacherVinculado.email, ids));
  const profUid = await ensureAuthUser(FIX.teacherVinculado.email, FIX.teacherVinculado.pass, FIX.teacherVinculado.name);
  await db.collection('users').doc(profUid).set({
    name: FIX.teacherVinculado.name, email: FIX.teacherVinculado.email,
    role: 'professor', profiles: ['professor'],
    moduleAccess: { comissoes: false, professores: true },
    professorId: t2.id, status: 'ativo',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  // 3) supervisão (user-only)
  const supUid = await ensureAuthUser(FIX.supervisao.email, FIX.supervisao.pass, FIX.supervisao.name);
  await db.collection('users').doc(supUid).set({
    name: FIX.supervisao.name, email: FIX.supervisao.email,
    role: 'supervisao', profiles: ['supervisao'],
    moduleAccess: { comissoes: false, professores: true },
    professorId: null, status: 'ativo',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(JSON.stringify({
    teacherSemAcessoId: t1.id, teacherVinculadoId: t2.id,
    profUid, supUid,
    supervEmail: FIX.supervisao.email, supervPass: FIX.supervisao.pass,
    profEmail: FIX.teacherVinculado.email, profPass: FIX.teacherVinculado.pass,
  }, null, 2));
}

async function cleanup() {
  for (const f of [FIX.teacherSemAcesso, FIX.teacherVinculado, FIX.supervisao]) {
    try {
      const u = await auth.getUserByEmail(f.email);
      await auth.deleteUser(u.uid);
      await db.collection('users').doc(u.uid).delete();
      console.log('auth+user removido:', f.email);
    } catch {}
  }
  const snap = await db.collection('teachers').where('notes', '==', 'FIXTURE pessoas — pode apagar').get();
  for (const d of snap.docs) { await d.ref.delete(); console.log('teacher removido:', d.id); }
  console.log('✓ cleanup completo');
}

(process.argv.includes('--cleanup') ? cleanup() : create()).then(() => process.exit());
