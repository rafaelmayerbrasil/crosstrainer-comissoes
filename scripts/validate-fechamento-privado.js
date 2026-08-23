'use strict';
// Valida que o documento do fechamento parou de ser legível por professor.
//
// O furo (achado em 11/08/2026, corrigido em 22/08): a regra de
// `monthly_closings` era `allow read: if isAuth() && hasProfModule()`, e
// `hasProfModule()` inclui `professor`. O documento traz, POR COLEGA,
// `hourlyRate`, `valorHoras`, `valorTotal` e o banco de horas. Ou seja:
// qualquer professor logado descobria quanto cada colega ganha — sem tela,
// direto pela conexão do app. Conflita com a regra inviolável nº 6 do projeto
// ("dados salariais: apenas Admin").
//
// Era inofensivo só por acidente: nenhum mês tinha sido fechado ainda, então
// não existia documento pra vazar. No primeiro fechamento vira real.
//
// O Firestore não filtra campos dentro de um documento — ou lê tudo, ou nada.
// Por isso a correção é fechar a coleção e o professor passar a ver o dinheiro
// dele pelo RECIBO, que já tem a regra certa (cada um só enxerga o próprio).
// Este teste prova as duas metades: fechou o vazamento E não quebrou o recibo.
//
// Autentica por token temporário gerado pelo Admin SDK — sem senha no arquivo.
// Roda (depois de deployar as rules no staging):
//   node scripts/validate-fechamento-privado.js
const admin = require('firebase-admin');

const API_KEY = 'AIzaSyC5wqYNNyrJBPXbBPK8gRxQxOPHTIW7TFo'; // staging (chave pública por natureza)
const PID = 'crosstrainer-comissoes-staging';
const BASE = `https://firestore.googleapis.com/v1/projects/${PID}/databases/(default)/documents`;

const UID_ADMIN = 'syZANHXh6MO1xw4UXpxGVTyFDcp1';   // dono.teste@
const UID_PROF  = 'MLjF8pMsSEeZkE2m8BvjwdR5RDF2';   // professor.teste@ (Marcos)
const PROF_TEACHER_ID = 'PhpOUDSxQzhFvn4WnXNB';     // cadastro do Marcos
const OUTRO_TEACHER_ID = 'o5soxgeWy1l0dintKzM2';    // Bruna

const FECHAMENTO_ID = 'TESTE_PRIVACIDADE_2026-99';
const RECIBO_MEU    = 'TESTE_PRIVACIDADE_recibo_meu';
const RECIBO_ALHEIO = 'TESTE_PRIVACIDADE_recibo_alheio';

admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-staging.json')) });
const db = admin.firestore();

let passou = 0, falhou = 0;
function checa(nome, real, esperado) {
  if (real === esperado) { passou++; console.log(`  ✓ ${nome} (HTTP ${real})`); }
  else { falhou++; console.log(`  ✗ ${nome} — esperava ${esperado}, veio ${real}`); }
}

/** Token de usuário sem senha: custom token do Admin SDK trocado por idToken. */
async function tokenDe(uid) {
  const custom = await admin.auth().createCustomToken(uid);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }) });
  const j = await r.json();
  if (!j.idToken) throw new Error('nao consegui token pra ' + uid + ': ' + JSON.stringify(j));
  return j.idToken;
}

const H = (t) => ({ Authorization: 'Bearer ' + t });

async function getDoc(colecao, id, token) {
  const r = await fetch(`${BASE}/${colecao}/${id}`, { headers: H(token) });
  return r.status;
}
async function listar(colecao, token) {
  const r = await fetch(`${BASE}/${colecao}?pageSize=1`, { headers: H(token) });
  return r.status;
}

(async () => {
  console.log('Preparando fixture no staging...\n');

  // Um fechamento com dado salarial de dois professores — o formato real.
  await db.collection('monthly_closings').doc(FECHAMENTO_ID).set({
    unitId: 'TESTE', year: 2026, month: 99, status: 'fechado',
    teachers: [
      { teacherId: PROF_TEACHER_ID,  teacherName: 'Marcos', hourlyRate: 50, totalHoras: 100, valorTotal: 5000 },
      { teacherId: OUTRO_TEACHER_ID, teacherName: 'Bruna',  hourlyRate: 80, totalHoras: 120, valorTotal: 9600 },
    ],
    totals: { classesRealizadas: 0, totalValor: 14600 },
  });
  await db.collection('receipts').doc(RECIBO_MEU).set({
    closingId: FECHAMENTO_ID, teacherId: PROF_TEACHER_ID, teacherName: 'Marcos', valorTotal: 5000,
  });
  await db.collection('receipts').doc(RECIBO_ALHEIO).set({
    closingId: FECHAMENTO_ID, teacherId: OUTRO_TEACHER_ID, teacherName: 'Bruna', valorTotal: 9600,
  });

  try {
    const tAdmin = await tokenDe(UID_ADMIN);
    const tProf  = await tokenDe(UID_PROF);

    console.log('O vazamento:');
    checa('professor NÃO lê o fechamento (o furo que existia)', await getDoc('monthly_closings', FECHAMENTO_ID, tProf), 403);
    checa('professor NÃO lista fechamentos', await listar('monthly_closings', tProf), 403);

    console.log('\nA gestão continua trabalhando:');
    checa('admin lê o fechamento', await getDoc('monthly_closings', FECHAMENTO_ID, tAdmin), 200);
    checa('admin lista fechamentos', await listar('monthly_closings', tAdmin), 200);

    console.log('\nO professor não perdeu o dinheiro dele:');
    checa('professor lê o PRÓPRIO recibo', await getDoc('receipts', RECIBO_MEU, tProf), 200);
    checa('professor NÃO lê o recibo do colega', await getDoc('receipts', RECIBO_ALHEIO, tProf), 403);
  } finally {
    await db.collection('monthly_closings').doc(FECHAMENTO_ID).delete();
    await db.collection('receipts').doc(RECIBO_MEU).delete();
    await db.collection('receipts').doc(RECIBO_ALHEIO).delete();
    const sobrou = await db.collection('monthly_closings').doc(FECHAMENTO_ID).get();
    console.log(`\nlimpeza: fixture removida (sobrou? ${sobrou.exists})`);
    console.log(falhou === 0 ? `\n✅ ${passou} passaram, 0 falharam` : `\n❌ ${passou} passaram, ${falhou} falharam`);
    process.exit(falhou === 0 ? 0 : 1);
  }
})().catch(e => { console.error('FALHA:', e.message); process.exit(1); });
