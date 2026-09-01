'use strict';
// Roda: node scripts/diag-emails-acesso.js --project production
//
// SOMENTE LEITURA. Cruza os três lugares onde o e-mail de uma pessoa mora e
// aponta onde eles discordam:
//
//   1. teachers.email  — o e-mail da FICHA (contato)
//   2. users.email     — o que a tela mostra como "e-mail de acesso"
//   3. Firebase Auth   — o que REALMENTE deixa a pessoa entrar e recuperar senha
//
// Por que isso importa: o "esqueci minha senha" só funciona pelo endereço do
// Auth, e o Firebase responde "enviamos" mesmo quando o endereço não existe —
// então um e-mail de acesso errado não dá erro nenhum, só nunca chega. Quem
// tem o endereço errado nas mãos ainda pode redefinir a senha e entrar no lugar
// da pessoa.
//
// Achado que originou o script (31/08/2026, produção): 3 fichas de 19
// divergentes; a do BRUNO CLAUDINO tinha como acesso um endereço que não é
// dele, e ele nunca tinha conseguido entrar. Corrigir virou botão na tela
// (aba Acesso → "Alterar e-mail de acesso", CF `changeLoginEmail`); este
// script é a varredura que diz QUEM precisa de conserto.
const admin = require('firebase-admin');
const path = require('path');

const args = process.argv.slice(2);
const projeto = args.includes('--project') ? args[args.indexOf('--project') + 1] : null;
if (!projeto) {
  console.error('Faltou --project <staging|production>');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))) });
const db = admin.firestore();

const norm = (e) => String(e || '').trim().toLowerCase();

(async () => {
  const [teachSnap, usersSnap, authList] = await Promise.all([
    db.collection('teachers').get(),
    db.collection('users').get(),
    admin.auth().listUsers(1000),
  ]);

  const userByProf = new Map();
  usersSnap.docs.forEach(d => {
    const u = d.data();
    if (u.professorId) userByProf.set(u.professorId, { uid: d.id, ...u });
  });
  const authByUid = new Map(authList.users.map(u => [u.uid, u]));

  const linhas = [];
  teachSnap.docs.forEach(d => {
    const t = d.data();
    const u = userByProf.get(d.id);
    const a = u ? authByUid.get(u.uid) : null;
    const eFicha = norm(t.email), eDoc = norm(u && u.email), eAuth = norm(a && a.email);

    const problemas = [];
    if (!u) problemas.push('SEM LOGIN');
    if (eFicha && eDoc && eFicha !== eDoc) problemas.push('ficha ≠ acesso');
    // Este é o grave: a tela mostra um e-mail e o login é outro.
    if (eDoc && eAuth && eDoc !== eAuth) problemas.push('🔴 ficha de acesso ≠ Auth (a tela MENTE)');
    if (!problemas.length) return;

    // lastSignIn igual ao creationTime = a conta nunca foi usada de fato: o
    // único "login" registrado é o do próprio momento da criação.
    const nuncaEntrou = a && a.metadata.lastSignInTime === a.metadata.creationTime;
    linhas.push({
      nome: t.name, ficha: t.email || '—', acesso: (u && u.email) || 'SEM LOGIN',
      auth: (a && a.email) || '—', nuncaEntrou: a ? (nuncaEntrou ? 'NUNCA ENTROU' : 'já entrou') : '—',
      ativo: t.isActive !== false, problemas: problemas.join(' · '),
    });
  });

  console.log(`\nProjeto: ${projeto} · ${teachSnap.size} fichas de professor · ${linhas.length} com pendência\n`);
  linhas.forEach(l => {
    console.log(`${l.ativo ? '●' : '○'} ${l.nome}`);
    console.log(`   ficha (contato) : ${l.ficha}`);
    console.log(`   acesso (users)  : ${l.acesso}`);
    console.log(`   login (Auth)    : ${l.auth}   [${l.nuncaEntrou}]`);
    console.log(`   ⚠️  ${l.problemas}\n`);
  });
  if (!linhas.length) console.log('Nada divergente. Todo mundo entra pelo endereço que a tela mostra.\n');

  console.log('Conserto: Pessoas → abrir a ficha → aba Acesso → "Alterar e-mail de acesso" (admin).');
  process.exit(0);
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
