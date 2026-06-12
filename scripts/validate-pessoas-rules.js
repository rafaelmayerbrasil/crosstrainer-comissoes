'use strict';
// Valida as rules do hub Pessoas via REST (auth real — Admin SDK bypassa rules).
// Pré-req: node scripts/fixture-pessoas.js (passar os ids/uids impressos como env):
//   TEACHER_ID=<teacherVinculadoId> PROF_UID=<profUid> node scripts/validate-pessoas-rules.js
// A API key do staging vem do firebase-config.js (não é segredo).
const fs = require('fs');

const cfg = fs.readFileSync(require('path').join(__dirname, '..', 'firebase-config.js'), 'utf8');
// apiKey do bloco STAGING (o arquivo tem prod E staging — a primeira é a de prod!)
const apiKey = (cfg.match(/apiKey:\s*['"]([^'"]+)['"][\s\S]{0,120}?crosstrainer-comissoes-staging/) || [])[1];
const projectId = 'crosstrainer-comissoes-staging';
const TEACHER_ID = process.env.TEACHER_ID;
const PROF_UID = process.env.PROF_UID;
if (!apiKey || !TEACHER_ID || !PROF_UID) { console.error('Faltam apiKey/TEACHER_ID/PROF_UID'); process.exit(1); }

const SUP = { email: 'fix.pessoas.superv@teste.com', pass: 'fixsuperv123' };
const PROF = { email: 'fix.pessoas.prof@teste.com', pass: 'fixprof123' };
const FS = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

async function signIn(email, password) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('signIn falhou p/ ' + email + ': ' + JSON.stringify(j));
  return j.idToken;
}

async function call(token, method, path, body) {
  const r = await fetch(`${FS}/${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.status;
}

function expect(desc, got, want) {
  const ok = got === want;
  console.log(`${ok ? '✓' : '✗'} ${desc} — esperado ${want}, veio ${got}`);
  if (!ok) process.exitCode = 1;
}

(async () => {
  const sup = await signIn(SUP.email, SUP.pass);
  const prof = await signIn(PROF.email, PROF.pass);

  // Supervisão
  expect('supervisão LÊ teacher', await call(sup, 'GET', `teachers/${TEACHER_ID}`), 200);
  expect('supervisão NÃO lê teacher_salaries (regra #6)', await call(sup, 'GET', `teacher_salaries/${TEACHER_ID}`), 403);
  expect('supervisão ATUALIZA teacher (D5)', await call(sup, 'PATCH',
    `teachers/${TEACHER_ID}?updateMask.fieldPaths=notes`,
    { fields: { notes: { stringValue: 'FIXTURE pessoas — pode apagar' } } }), 200);
  expect('supervisão NÃO cria users (D9)', await call(sup, 'POST',
    `users?documentId=fix-superv-tenta-criar`,
    { fields: { name: { stringValue: 'x' } } }), 403);
  expect('supervisão NÃO lê users de outro', await call(sup, 'GET', `users/${PROF_UID}`), 403);

  // Professor
  expect('professor NÃO lê users de outro', await call(prof, 'GET', 'users/uid-de-outra-pessoa-qualquer'), 403);
  expect('professor NÃO atualiza teacher', await call(prof, 'PATCH',
    `teachers/${TEACHER_ID}?updateMask.fieldPaths=notes`,
    { fields: { notes: { stringValue: 'hack' } } }), 403);
  expect('professor NÃO lê teacher_salaries', await call(prof, 'GET', `teacher_salaries/${TEACHER_ID}`), 403);

  console.log(process.exitCode ? '✗ validação REST com FALHAS' : '✓ validação REST passou');
  process.exit();
})();
