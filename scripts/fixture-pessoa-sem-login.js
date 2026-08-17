'use strict';
// Fixture do bug "ficha do Excel não é login" (staging).
// Reproduz EXATAMENTE o que o upload das comissões cria quando aparece uma
// vendedora nova na planilha: doc em /users com e-mail VAZIO e status 'pendente',
// sem nenhuma conta no Auth por trás (`autoRegisterVendors`, index.html ~4327).
//
// Existe porque o staging não tem esse cenário — as pessoas de lá foram todas
// criadas com login de verdade. Sem esta fixture, clicar no staging não prova nada.
//
// Roda:  node scripts/fixture-pessoa-sem-login.js            (cria)
//        node scripts/fixture-pessoa-sem-login.js --cleanup  (remove)

const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-staging.json')) });
const db = admin.firestore();
const auth = admin.auth();

const DOC_ID = 'fixture-vendedora-sem-login';
const NOME = 'Fixture Vendedora SemLogin';

async function unidade() {
  const u = await db.collection('units').limit(1).get();
  if (u.empty) throw new Error('Staging precisa de pelo menos 1 unidade');
  return u.docs[0].id;
}

async function criar() {
  const unitId = await unidade();
  // espelho fiel do que autoRegisterVendors grava
  await db.collection('users').doc(DOC_ID).set({
    name: NOME,
    email: '',                    // ← o coração do bug
    role: 'vendedor',
    unitId,
    allowedUnits: [unitId],
    status: 'pendente',
    autoCreated: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`\n✔ ficha-fantasma criada em /users/${DOC_ID}`);
  console.log(`   nome: ${NOME}`);
  console.log(`   e-mail: (vazio)  ·  status: pendente  ·  unidade: ${unitId}`);
  console.log(`   conta no Auth: nenhuma — é esse o ponto\n`);
  console.log('Agora, no staging (Professores → Pessoas):');
  console.log('  1. a pessoa tem que aparecer como "Sem acesso" (antes da correção aparecia "● Com acesso")');
  console.log('  2. abrir a ficha → aviso amarelo "Esta pessoa não tem acesso ao sistema"');
  console.log('  3. aba 🔑 Acesso → botão "Criar acesso" (antes o botão nem existia)');
  console.log('  4. nome já preenchido; informar e-mail + senha e salvar');
  console.log('  5. conferir que ela vira "● Com acesso" e aparece UMA vez só na lista');
  console.log(`\nDepois: node scripts/fixture-pessoa-sem-login.js --cleanup\n`);
}

async function limpar() {
  // apaga a ficha-fantasma, se ainda existir
  const ref = db.collection('users').doc(DOC_ID);
  if ((await ref.get()).exists) { await ref.delete(); console.log(`✔ /users/${DOC_ID} removido`); }
  else console.log(`· /users/${DOC_ID} não existe (a validação já deve tê-lo consumido)`);

  // e qualquer conta/doc que a validação tenha criado com esse nome
  let achou = 0, pageToken;
  do {
    const r = await auth.listUsers(1000, pageToken);
    for (const u of r.users) {
      if ((u.displayName || '') === NOME) { await auth.deleteUser(u.uid); achou++; }
    }
    pageToken = r.pageToken;
  } while (pageToken);

  const snap = await db.collection('users').where('name', '==', NOME).get();
  for (const d of snap.docs) {
    if (d.id !== DOC_ID) { await auth.deleteUser(d.id).catch(() => {}); await d.ref.delete(); achou++; }
  }
  console.log(achou ? `✔ ${achou} resíduo(s) da validação removido(s)` : '· nenhum resíduo da validação');
  console.log('');
}

const acao = process.argv.includes('--cleanup') ? limpar : criar;
acao().then(() => process.exit(0)).catch(e => { console.error('ERRO: ' + e.message); process.exit(1); });
