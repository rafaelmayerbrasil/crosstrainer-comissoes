'use strict';
// Valida a correção do "ficha do Excel não é login" contra os dados REAIS do staging.
// Lê /users e /teachers pelo Admin SDK e roda o modelo em cima, mostrando quem muda
// de estado. Não escreve nada — só leitura.
//
// Roda: node scripts/validate-pessoa-sem-login.js

const path = require('path');
const admin = require('firebase-admin');
const PessoasModel = require(path.join(__dirname, '..', 'pessoas-model.js'));

const sa = require(path.join(__dirname, 'serviceAccount-staging.json'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const auth = admin.auth();

// como era ANTES da correção
function hasAccessAntigo(p) {
  return p.teacherId ? !!p.uid : true;
}

(async () => {
  const [usersSnap, teachersSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('teachers').get(),
  ]);
  const users = [];
  usersSnap.forEach(d => users.push({ id: d.id, ...d.data() }));
  const teachers = [];
  teachersSnap.forEach(d => teachers.push({ id: d.id, ...d.data() }));

  console.log(`\nSTAGING — ${users.length} fichas em /users · ${teachers.length} em /teachers\n`);

  const people = PessoasModel.buildPeople(users, teachers);

  // quem realmente tem conta no Auth? é a prova independente
  const comAuth = new Set();
  let pageToken;
  do {
    const r = await auth.listUsers(1000, pageToken);
    r.users.forEach(u => comAuth.add(u.uid));
    pageToken = r.pageToken;
  } while (pageToken);
  console.log(`Contas de verdade no Firebase Auth: ${comAuth.size}\n`);

  const mudaram = [], acertos = [], erros = [];
  people.forEach(p => {
    const antes = hasAccessAntigo(p);
    const agora = p.hasAccess;
    const real = !!(p.uid && comAuth.has(p.uid));   // verdade独立 do modelo
    if (antes !== agora) mudaram.push({ p, antes, agora, real });
    (agora === real ? acertos : erros).push({ p, agora, real });
  });

  console.log('='.repeat(88));
  console.log(`  PESSOAS QUE MUDAM DE ESTADO COM A CORREÇÃO: ${mudaram.length}`);
  console.log('='.repeat(88));
  mudaram.forEach(({ p, antes, agora, real }) => {
    const ok = agora === real ? '✔' : '✘';
    console.log(`  ${ok} ${String(p.name || '(sem nome)').slice(0, 30).padEnd(31)} | e-mail: ${String(p.email || '(vazio)').slice(0, 28).padEnd(29)}` +
      ` | antes: ${antes ? 'com acesso' : 'sem acesso'} -> agora: ${agora ? 'com acesso' : 'sem acesso'} | tem login de verdade? ${real ? 'SIM' : 'NÃO'}`);
  });

  console.log('\n' + '='.repeat(88));
  console.log(`  CONFERÊNCIA contra o Firebase Auth: ${acertos.length} certas · ${erros.length} erradas`);
  console.log('='.repeat(88));
  if (erros.length) {
    erros.forEach(({ p, agora, real }) =>
      console.log(`  ✘ ${String(p.name).slice(0, 30).padEnd(31)} | modelo diz ${agora ? 'com' : 'sem'} acesso, Auth diz ${real ? 'com' : 'sem'}`));
  } else {
    console.log('  Nenhuma divergência — o modelo bate 100% com quem realmente consegue entrar.');
  }

  // o botão "Criar acesso" agora alcança quem?
  const semAcesso = people.filter(p => !p.hasAccess);
  const naoProfessor = semAcesso.filter(p => !p.teacherId);
  console.log('\n' + '='.repeat(88));
  console.log(`  QUEM PASSA A PODER GANHAR LOGIN PELO HUB`);
  console.log('='.repeat(88));
  console.log(`  sem acesso no total: ${semAcesso.length}  ·  desses, NÃO são professores: ${naoProfessor.length}`);
  console.log(`  (os ${naoProfessor.length} eram exatamente os que o botão ignorava calado)\n`);
  naoProfessor.forEach(p => {
    const st = (p.user && p.user.status) || '—';
    const podeApagar = st === 'pendente' ? 'sim' : 'NÃO — rule só apaga pendente';
    console.log(`   ${String(p.name).slice(0, 30).padEnd(31)} | status: ${String(st).padEnd(10)} | ficha antiga pode ser apagada? ${podeApagar}`);
  });

  console.log('');
  process.exit(erros.length ? 1 : 0);
})().catch(e => { console.error('ERRO: ' + e.message); process.exit(1); });
