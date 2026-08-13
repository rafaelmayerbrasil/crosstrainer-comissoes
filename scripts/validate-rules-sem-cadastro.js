'use strict';
// Prova que estar AUTENTICADO não basta para ler /units nem escrever no
// /audit_log — é preciso ter cadastro em /users.
//
// Por que isso importa: a apiKey do Firebase é pública (vai no JS do site) e o
// cadastro livre do Auth está aberto, então qualquer pessoa consegue uma sessão
// autenticada sem ser ninguém no sistema. Até 13/08/2026 essa sessão lia a
// config de comissões (/units) e escrevia na auditoria.
//
// COMO TESTA, sem criar conta nenhuma: usa uma conta de teste que já existe e
// remove TEMPORARIAMENTE o cadastro dela em /users, simulando exatamente o
// estranho — sessão válida, sem perfil. Restaura no finally, sempre.
// Testa as regras REAIS publicadas no staging, via REST (o Admin SDK ignoraria).
//
// Uso: node scripts/validate-rules-sem-cadastro.js
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

const CONTA = { email: 'professor.teste@crosstainer.com', pass: 'crosstainer2026' };
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

let fails = 0, checks = 0;
const expect = (desc, got, want) => {
  const ok = got === want; checks++; if (!ok) fails++;
  console.log(`${ok ? '✓' : '✗'} ${desc} — esperado ${want}, veio ${got}`);
};

async function signIn(email, password) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const j = await r.json();
  if (!j.idToken) throw new Error('login falhou: ' + ((j.error && j.error.message) || '?'));
  return { idToken: j.idToken, uid: j.localId };
}
const lerUnit = (tk, id) => fetch(`${BASE}/units/${id}`, { headers: { Authorization: `Bearer ${tk}` } })
  .then(r => r.status);
const escreverAudit = (tk) => fetch(`${BASE}/audit_log?documentId=zzprobe_${Date.now()}`, {
  method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: { acao: { stringValue: 'probe' } } }),
}).then(r => r.status);

(async () => {
  const { idToken, uid } = await signIn(CONTA.email, CONTA.pass);
  const unitsSnap = await db.collection('units').limit(1).get();
  if (unitsSnap.empty) { console.error('staging sem nenhuma unidade — não dá pra testar'); process.exit(1); }
  const unitId = unitsSnap.docs[0].id;

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) { console.error(`a conta ${CONTA.email} não tem doc em /users — abortando`); process.exit(1); }
  const backup = userSnap.data();
  let removido = false;
  const auditsCriados = [];

  try {
    // ── COM cadastro: tudo normal ──────────────────────────────────────
    expect('com cadastro: lê units', await lerUnit(idToken, unitId), 200);
    const stAudit = await escreverAudit(idToken);
    expect('com cadastro: escreve no audit_log', stAudit, 200);

    // ── SEM cadastro: é o estranho que se cadastrou sozinho ────────────
    await userRef.delete();
    removido = true;
    // rules propagam em segundos; dá uma folga antes de medir
    await new Promise(r => setTimeout(r, 8000));

    expect('SEM cadastro: units barrado', await lerUnit(idToken, unitId), 403);
    expect('SEM cadastro: audit_log barrado', await escreverAudit(idToken), 403);
  } finally {
    if (removido) {
      await userRef.set(backup);
      const conferindo = await userRef.get();
      console.log(`\ncadastro de ${CONTA.email} restaurado: ${conferindo.exists ? 'OK' : 'FALHOU — RESTAURE À MÃO'}`);
    }
    // limpa qualquer audit_log que o teste tenha criado
    const lixo = await db.collection('audit_log').where('acao', '==', 'probe').get();
    for (const d of lixo.docs) await d.ref.delete();
    if (lixo.size) console.log(`${lixo.size} entrada(s) de teste removida(s) do audit_log`);
  }

  console.log(`\n${checks - fails}/${checks} verificações passaram`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
