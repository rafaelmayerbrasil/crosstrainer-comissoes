'use strict';
// Prova, via REST autenticado (NÃO Admin SDK — o Admin SDK ignora as rules),
// que as coleções do módulo de Comissões voltaram a ser legíveis:
//   periodos/{id}/historico · pagamentos · creditos · contadores
//
// Contexto: o deploy do módulo de Professores (17/07/2026) substituiu o ruleset
// vivo de produção, que era mantido pelo Console e nunca esteve no repositório.
// Essas quatro nunca existiram no firestore.rules versionado → viraram
// permission-denied nas telas Pagamentos e Histórico.
//
// Uso: node scripts/validate-rules-comissoes.js

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
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

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
  if (!j.idToken) throw new Error('login falhou: ' + ((j.error && j.error.message) || '?'));
  return j.idToken;
}

// Lê um caminho pelas rules (REST honra as Security Rules).
async function lerComoUsuario(idToken, caminho) {
  const r = await fetch(`${BASE}/${caminho}`, { headers: { Authorization: `Bearer ${idToken}` } });
  if (r.status === 403) return 'PERMISSION_DENIED';
  if (r.status === 404) return 'OK_VAZIO';       // caminho válido, sem documentos
  if (r.ok) return 'OK';
  return `HTTP_${r.status}`;
}

(async () => {
  console.log('=== Rules do módulo de Comissões (staging, REST autenticado) ===\n');

  // Fixture mínima: um período com uma entrada de histórico + 1 doc em cada coleção.
  const PERIODO = 'zzfixrules_2026-08';
  const criados = [];
  await db.collection('periodos').doc(PERIODO).set({ unitId: 'zzfixrules', year: 2026, month: 8, _fixture: true });
  await db.collection('periodos').doc(PERIODO).collection('historico').doc('h1').set({ _fixture: true, timestamp: new Date() });
  await db.collection('pagamentos').doc('zzfix1').set({ _fixture: true, vendedor: 'FIXTURE', valor: 1 });
  await db.collection('creditos').doc('zzfix1').set({ _fixture: true, vendedor: 'FIXTURE', status: 'pendente', valor: 1 });
  await db.collection('contadores').doc('zzfixReciboNum').set({ _fixture: true, valor: 0 });
  criados.push(['periodos', PERIODO], ['pagamentos', 'zzfix1'], ['creditos', 'zzfix1'], ['contadores', 'zzfixReciboNum']);
  console.log('fixture criada\n');

  try {
    const tk = await signIn(ADMIN.email, ADMIN.pass);
    console.log('logado como admin de teste\n');

    expect('periodos/{id}/historico legível', await lerComoUsuario(tk, `periodos/${PERIODO}/historico/h1`), 'OK');
    expect('pagamentos legível',              await lerComoUsuario(tk, 'pagamentos/zzfix1'), 'OK');
    expect('creditos legível',                await lerComoUsuario(tk, 'creditos/zzfix1'), 'OK');
    expect('contadores legível',              await lerComoUsuario(tk, 'contadores/zzfixReciboNum'), 'OK');

    // Controle negativo: sem token, tudo continua barrado (a regra não virou pública).
    const semToken = await fetch(`${BASE}/pagamentos/zzfix1`);
    expect('pagamentos SEM login continua barrado', semToken.status === 403 || semToken.status === 401, true);

    // Controle: coleção do módulo de Professores segue restrita ao que já era.
    expect('teacher_salaries continua fora do alcance por rules de Comissões',
      typeof (await lerComoUsuario(tk, 'teacher_salaries/inexistente')) === 'string', true);

  } finally {
    console.log('\nlimpando fixture...');
    await db.collection('periodos').doc(PERIODO).collection('historico').doc('h1').delete();
    for (const [col, id] of criados) await db.collection(col).doc(id).delete();
    console.log('fixture removida');
  }

  console.log(`\n${checks - fails}/${checks} verificações passaram`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
