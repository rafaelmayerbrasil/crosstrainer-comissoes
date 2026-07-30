'use strict';
// E2E da CF setPersonAccess em STAGING: prova que Desligar realmente BLOQUEIA o login
// e que Religar libera de volta. Usa um usuário descartável, criado e removido aqui.
//
// Uso: node scripts/validate-desligar-pessoa.js
//
// A prova de fogo é tentar autenticar: conta desabilitada no Firebase Auth
// responde USER_DISABLED. Nenhum mock — é o Auth real do staging respondendo.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const PROJECT = 'crosstrainer-comissoes-staging';
const svcPath = path.join(__dirname, 'serviceAccount-staging.json');
if (!fs.existsSync(svcPath)) { console.error('Falta scripts/serviceAccount-staging.json'); process.exit(1); }

const cfg = fs.readFileSync(path.join(__dirname, '..', 'firebase-config.js'), 'utf8');
const apiKey = (cfg.match(/apiKey:\s*['"]([^'"]+)['"][\s\S]{0,120}?crosstrainer-comissoes-staging/) || [])[1];
if (!apiKey) { console.error('não achei a apiKey do staging'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(require(svcPath)), projectId: PROJECT });
const db = admin.firestore();

const ADMIN = { email: 'dono.teste@crosstainer.com', pass: 'crosstainer2026' };
const ALVO = { email: `zz.fix.desligar.${Date.now()}@teste.com`, pass: 'fixdesligar123' };
const REGION = 'us-central1';

let fails = 0, checks = 0;
function expect(desc, got, want) {
  const ok = got === want; checks++; if (!ok) fails++;
  console.log(`${ok ? '✓' : '✗'} ${desc} — esperado ${want}, veio ${got}`);
}

async function signIn(email, password) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await r.json();
  return j.idToken ? { ok: true, idToken: j.idToken } : { ok: false, erro: (j.error && j.error.message) || 'desconhecido' };
}

async function chamarCF(idToken, payload) {
  const r = await fetch(`https://${REGION}-${PROJECT}.cloudfunctions.net/setPersonAccess`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: payload }),
  });
  const txt = await r.text();
  return { status: r.status, body: txt.slice(0, 300) };
}

(async () => {
  let uid = null, teacherId = null;
  try {
    // ── fixture: professor + login descartáveis ──
    const u = await admin.auth().createUser({ email: ALVO.email, password: ALVO.pass, displayName: 'FIXTURE Desligar' });
    uid = u.uid;
    const tRef = db.collection('teachers').doc();
    teacherId = tRef.id;
    await tRef.set({ name: 'FIXTURE Desligar (apagar)', type: 'efetivo', unitIds: ['unit-cp'], isActive: true, email: ALVO.email });
    await db.collection('users').doc(uid).set({
      name: 'FIXTURE Desligar', email: ALVO.email, role: 'professor', profiles: ['professor'],
      professorId: teacherId, status: 'ativo',
    });
    console.log(`✓ fixture criada (uid=${uid.slice(0, 8)}… teacher=${teacherId.slice(0, 8)}…)\n`);

    const adminTok = (await signIn(ADMIN.email, ADMIN.pass)).idToken;
    if (!adminTok) throw new Error('não consegui autenticar o admin de demo');

    console.log('── Antes de desligar ──');
    expect('a pessoa consegue entrar', (await signIn(ALVO.email, ALVO.pass)).ok, true);

    console.log('\n── Desligando (active: false) ──');
    const off = await chamarCF(adminTok, { uid, teacherId, active: false });
    expect('a função respondeu OK', off.status, 200);

    const login = await signIn(ALVO.email, ALVO.pass);
    expect('o login foi BLOQUEADO', login.ok, false);
    expect('motivo do bloqueio é conta desabilitada', login.erro, 'USER_DISABLED');
    expect('professor saiu da agenda (isActive=false)', (await db.collection('teachers').doc(teacherId).get()).data().isActive, false);
    expect("perfil marcado como inativo", (await db.collection('users').doc(uid).get()).data().status, 'inativo');
    expect('conta desabilitada no Auth', (await admin.auth().getUser(uid)).disabled, true);

    console.log('\n── Religando (active: true) ──');
    const on = await chamarCF(adminTok, { uid, teacherId, active: true });
    expect('a função respondeu OK', on.status, 200);
    expect('a pessoa consegue entrar de novo', (await signIn(ALVO.email, ALVO.pass)).ok, true);
    expect('professor voltou pra agenda', (await db.collection('teachers').doc(teacherId).get()).data().isActive, true);
    expect('perfil voltou a ativo', (await db.collection('users').doc(uid).get()).data().status, 'ativo');

    console.log('\n── Guardas de segurança ──');
    const eu = await chamarCF(adminTok, { uid: (await admin.auth().getUserByEmail(ADMIN.email)).uid, active: false });
    expect('admin NÃO consegue desligar a própria conta', eu.status, 400);
    const semAuth = await chamarCF(null, { uid, active: false });
    expect('sem autenticação a função recusa', semAuth.status, 401);

    console.log('\n── Registro no histórico ──');
    const aud = await db.collection('audit_log')
      .where('type', 'in', ['person_deactivated', 'person_reactivated'])
      .where('entityId', '==', teacherId).get();
    expect('gravou as 2 entradas no histórico', aud.size, 2);
  } catch (e) {
    console.error('✗ ERRO: ' + e.message);
    fails++;
  } finally {
    console.log('\n── Limpeza ──');
    try { if (uid) await admin.auth().deleteUser(uid); } catch (e) { console.warn('  auth: ' + e.message); }
    try { if (uid) await db.collection('users').doc(uid).delete(); } catch (e) { console.warn('  users: ' + e.message); }
    try { if (teacherId) await db.collection('teachers').doc(teacherId).delete(); } catch (e) { console.warn('  teachers: ' + e.message); }
    if (teacherId) {
      const aud = await db.collection('audit_log').where('entityId', '==', teacherId).get();
      for (const d of aud.docs) await d.ref.delete();
      console.log(`  ${aud.size} entrada(s) de histórico da fixture removida(s)`);
    }
    let sobrou = false;
    if (uid) { try { await admin.auth().getUser(uid); sobrou = true; } catch { /* removido, ok */ } }
    if (teacherId && (await db.collection('teachers').doc(teacherId).get()).exists) sobrou = true;
    console.log(sobrou ? '✗ CLEANUP INCOMPLETO' : '✓ cleanup completo (nada da fixture restou)');
    if (sobrou) fails++;
    console.log(fails ? `\n✗ ${fails} FALHA(S) de ${checks}` : `\n✓ VALIDAÇÃO PASSOU (${checks}/${checks})`);
    process.exit(fails ? 1 : 0);
  }
})();
