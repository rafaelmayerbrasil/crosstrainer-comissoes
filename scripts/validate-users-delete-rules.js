'use strict';
// Valida a regra de DELETE em /users via REST (auth real — Admin SDK bypassa rules).
// Regra sob teste (firestore.rules):
//   allow delete: if isAuth() && isAdmin() && resource.data.status == 'pendente';
//
// Contexto: o `delete: if false` (deployado 17/07) quebrou dois fluxos do index.html —
// deleteUser() do placeholder PENDENTE e a limpeza no fim do activateUser().
// Placeholder pendente não tem conta no Auth, então deletá-lo é seguro; usuário com
// Auth real segue intocável (usa-se Desligar / CF setPersonAccess).
//
// Uso (staging):  node scripts/validate-users-delete-rules.js
// Fixture é criada e removida pelo próprio script (cleanup completo obrigatório).

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const projectId = 'crosstrainer-comissoes-staging';
const svcPath = path.join(__dirname, 'serviceAccount-staging.json');
if (!fs.existsSync(svcPath)) { console.error('Falta scripts/serviceAccount-staging.json'); process.exit(1); }

// apiKey do bloco STAGING (firebase-config.js tem prod E staging — a 1ª é a de prod!)
const cfg = fs.readFileSync(path.join(__dirname, '..', 'firebase-config.js'), 'utf8');
const apiKey = (cfg.match(/apiKey:\s*['"]([^'"]+)['"][\s\S]{0,120}?crosstrainer-comissoes-staging/) || [])[1];
if (!apiKey) { console.error('Não achei a apiKey do staging em firebase-config.js'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(require(svcPath)), projectId });
const db = admin.firestore();

const ADMIN = { email: 'dono.teste@crosstainer.com', pass: 'crosstainer2026' };
const PROF  = { email: 'professor.teste@crosstainer.com', pass: 'crosstainer2026' };
const FS = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

// ids da fixture — prefixo zz-fix pra nunca colidir com uid real do Auth
const ID_PENDENTE   = 'zz-fix-del-pendente';
const ID_ATIVO      = 'zz-fix-del-ativo';
const ID_SEM_STATUS = 'zz-fix-del-sem-status';
const ID_PEND_PROF  = 'zz-fix-del-pendente-prof';
const ALL_IDS = [ID_PENDENTE, ID_ATIVO, ID_SEM_STATUS, ID_PEND_PROF];

async function signIn(email, password) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('signIn falhou p/ ' + email + ': ' + JSON.stringify(j));
  return j.idToken;
}

async function del(token, id) {
  const r = await fetch(`${FS}/users/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  return r.status;
}

let fails = 0;
let checks = 0;
function expect(desc, got, want) {
  const ok = got === want;
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? '✓' : '✗'} ${desc} — esperado ${want}, veio ${got}`);
}

async function criarFixture() {
  await db.collection('users').doc(ID_PENDENTE).set({
    name: 'FIXTURE pendente (apagar)', email: '', role: 'vendedor',
    status: 'pendente', autoCreated: true,
  });
  await db.collection('users').doc(ID_PEND_PROF).set({
    name: 'FIXTURE pendente p/ teste de professor', email: '', role: 'vendedor',
    status: 'pendente', autoCreated: true,
  });
  await db.collection('users').doc(ID_ATIVO).set({
    name: 'FIXTURE ativo (apagar)', email: 'zz.fix.ativo@teste.com', role: 'vendedor',
    status: 'ativo',
  });
  await db.collection('users').doc(ID_SEM_STATUS).set({
    name: 'FIXTURE sem campo status (apagar)', email: '', role: 'vendedor',
  });
  console.log('✓ fixture criada (4 docs em /users)');
}

async function cleanup() {
  for (const id of ALL_IDS) {
    try { await db.collection('users').doc(id).delete(); } catch (e) { console.warn('cleanup ' + id + ': ' + e.message); }
  }
  const restantes = [];
  for (const id of ALL_IDS) if ((await db.collection('users').doc(id).get()).exists) restantes.push(id);
  console.log(restantes.length ? '✗ CLEANUP INCOMPLETO: ' + restantes.join(', ') : '✓ cleanup completo (nenhum doc de fixture restou)');
  if (restantes.length) fails++;
}

(async () => {
  try {
    await criarFixture();
    const tAdmin = await signIn(ADMIN.email, ADMIN.pass);
    const tProf  = await signIn(PROF.email, PROF.pass);

    console.log('\n── O que a regra deve PERMITIR ──');
    expect('admin DELETA placeholder pendente (destrava deleteUser + activateUser)',
      await del(tAdmin, ID_PENDENTE), 200);

    console.log('\n── O que a regra deve BLOQUEAR ──');
    expect('admin NÃO deleta usuário ativo (usa Desligar)',
      await del(tAdmin, ID_ATIVO), 403);
    expect('admin NÃO deleta doc sem campo status (fail-safe)',
      await del(tAdmin, ID_SEM_STATUS), 403);
    expect('admin NÃO deleta doc inexistente (resource nulo)',
      await del(tAdmin, 'zz-fix-nao-existe'), 403);
    expect('professor (não-admin) NÃO deleta nem pendente',
      await del(tProf, ID_PEND_PROF), 403);

    console.log('\n── Efeito colateral: o pendente saiu mesmo do banco? ──');
    const aindaExiste = (await db.collection('users').doc(ID_PENDENTE).get()).exists;
    expect('placeholder pendente removido de fato', aindaExiste, false);
    const ativoIntacto = (await db.collection('users').doc(ID_ATIVO).get()).exists;
    expect('usuário ativo permaneceu intacto', ativoIntacto, true);
  } catch (e) {
    console.error('✗ ERRO na validação: ' + e.message);
    fails++;
  } finally {
    console.log('\n── Cleanup ──');
    await cleanup();
    console.log(fails ? `\n✗ VALIDAÇÃO COM ${fails} FALHA(S) de ${checks}` : `\n✓ VALIDAÇÃO PASSOU (${checks}/${checks})`);
    process.exit(fails ? 1 : 0);
  }
})();
