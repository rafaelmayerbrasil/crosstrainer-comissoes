'use strict';
// Prova, via REST autenticado (NÃO Admin SDK — o Admin SDK ignora as Security
// Rules; um teste que escreve por ele passa mesmo com a regra errada), que a
// regra da coleção vendas_conferencia faz o que o dono decidiu:
//   - SÓ ADMIN ESCREVE (create/update/delete)
//   - QUEM TEM ACESSO AO MÓDULO DE COMISSÕES LÊ (a vendedora vê o desfecho
//     das vendas dela)
//
// Regra deployada em firestore.rules (staging):
//   match /vendas_conferencia/{id} {
//     allow read:  if isAuth() && hasProfile() && hasComModule();
//     allow write: if isAuth() && hasProfile() && isAdmin();
//   }
//
// ⚠️ Esconder o botão na tela NÃO basta — link direto existe. Foi assim que o
// vazamento de salário do fechamento aconteceu nesta base (ver
// vazamento-salario-fechamento.md). A trava tem que estar no servidor, e a
// única forma de provar isso de fora é bater na REST do Firestore com o
// token de um usuário real e ler o código HTTP que a regra devolve.
//
// Uso: node scripts/validate-rules-conferencia.js

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// ─── Guarda: NUNCA produção ────────────────────────────────────────────
// Hardcoded de propósito (não lê de env nem de argv) para que não haja como
// disparar isso sem editar o arquivo — e mesmo editando, a checagem abaixo
// recusa qualquer projectId que não termine em "-staging".
const PROJECT = 'crosstrainer-comissoes-staging';
if (!PROJECT.endsWith('-staging')) {
  console.error('RECUSADO: este script só roda contra staging. PROJECT atual: ' + PROJECT);
  process.exit(1);
}

const svcPath = path.join(__dirname, 'serviceAccount-staging.json');
if (!fs.existsSync(svcPath)) { console.error('Falta scripts/serviceAccount-staging.json'); process.exit(1); }

const cfg = fs.readFileSync(path.join(__dirname, '..', 'firebase-config.js'), 'utf8');
const apiKey = (cfg.match(/apiKey:\s*['"]([^'"]+)['"][\s\S]{0,120}?crosstrainer-comissoes-staging/) || [])[1];
if (!apiKey) { console.error('não achei a apiKey do staging'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(require(svcPath)), projectId: PROJECT });
const db = admin.firestore();

const ADMIN = { email: 'dono.teste@crosstainer.com', pass: 'crosstainer2026' };
// Fixture descartável: vendedora sem perfil admin, mas COM acesso ao módulo
// de Comissões (role: 'vendedor' — é o que hasComModule() aceita além de
// moduleAccess.comissoes == true). Nenhuma das 3 contas de demo do staging
// serve pra provar o lado da leitura: nenhuma é vendedora.
const VENDEDORA = { email: `zz.fix.conferencia.${Date.now()}@teste.com`, pass: 'fixconferencia123' };
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

let fails = 0, checks = 0;
function expect(desc, got, want) {
  const ok = got === want; checks++; if (!ok) fails++;
  console.log(`${ok ? '✓' : '✗'} ${desc} — esperado ${want}, veio ${got}`);
  return ok;
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

// Lê um caminho pelas rules (REST honra as Security Rules; o Admin SDK não).
async function lerComoUsuario(idToken, caminho) {
  const headers = idToken ? { Authorization: `Bearer ${idToken}` } : {};
  const r = await fetch(`${BASE}/${caminho}`, { headers });
  if (r.status === 403) return 'PERMISSION_DENIED';
  if (r.status === 401) return 'UNAUTHENTICATED';
  if (r.status === 404) return 'OK_VAZIO'; // caminho válido, sem documento
  if (r.ok) return 'OK';
  return `HTTP_${r.status}`;
}

// Escreve (create/update — PATCH faz upsert na REST do Firestore) pelas rules.
async function escreverComoUsuario(idToken, caminho, campos) {
  const headers = { 'Content-Type': 'application/json' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const r = await fetch(`${BASE}/${caminho}`, { method: 'PATCH', headers, body: JSON.stringify({ fields: campos }) });
  if (r.status === 403) return 'PERMISSION_DENIED';
  if (r.status === 401) return 'UNAUTHENTICATED';
  if (r.ok) return 'OK';
  const txt = await r.text().catch(() => '');
  return `HTTP_${r.status}:${txt.slice(0, 120)}`;
}

// Apaga pelas rules.
async function apagarComoUsuario(idToken, caminho) {
  const headers = idToken ? { Authorization: `Bearer ${idToken}` } : {};
  const r = await fetch(`${BASE}/${caminho}`, { method: 'DELETE', headers });
  if (r.status === 403) return 'PERMISSION_DENIED';
  if (r.status === 401) return 'UNAUTHENTICATED';
  if (r.ok) return 'OK';
  return `HTTP_${r.status}`;
}

(async () => {
  console.log('=== Rules de vendas_conferencia (staging, REST autenticado) ===\n');
  console.log('Por que REST e não Admin SDK: o Admin SDK ignora Security Rules — um');
  console.log('teste escrito com ele passaria mesmo se a regra estivesse aberta pra');
  console.log('qualquer um. Só um token de usuário real batendo na REST prova algo.\n');

  const FIXTURE_ID = `zzfixconf_${Date.now()}`;
  const DOC = `vendas_conferencia/${FIXTURE_ID}`;
  let vendedoraUid = null;
  let escritaCriticaFalhou = false;

  try {
    // ── Fixture: vendedora descartável (Auth + /users), criada via Admin SDK.
    // Isto NÃO é o que está sendo testado — é só a massa de dados. O que prova
    // a regra é sempre a chamada REST logo abaixo, com o token dela.
    const u = await admin.auth().createUser({ email: VENDEDORA.email, password: VENDEDORA.pass, displayName: 'FIXTURE Conferência (apagar)' });
    vendedoraUid = u.uid;
    await db.collection('users').doc(vendedoraUid).set({
      name: 'FIXTURE Conferência (apagar)', email: VENDEDORA.email,
      role: 'vendedor', profiles: ['vendedor'], status: 'ativo', _fixture: true,
    });
    console.log(`fixture da vendedora criada (uid=${vendedoraUid.slice(0, 8)}…)\n`);

    const tkAdmin = await signIn(ADMIN.email, ADMIN.pass);
    const tkVend = await signIn(VENDEDORA.email, VENDEDORA.pass);
    console.log('logado como admin de teste e como vendedora fixture\n');

    console.log('── 1) Admin escreve ──');
    const r1 = expect('admin CRIA em vendas_conferencia', await escreverComoUsuario(tkAdmin, DOC, {
      motivo: { stringValue: 'FIXTURE validate-rules-conferencia (apagar)' },
      status: { stringValue: 'conferir' },
      _fixture: { booleanValue: true },
    }), 'OK');
    if (!r1) throw new Error('sem o documento criado pelo admin, os testes seguintes não têm o que ler/barrar — abortando');

    console.log('\n── 2) Admin lê o que escreveu ──');
    expect('admin LÊ o documento', await lerComoUsuario(tkAdmin, DOC), 'OK');

    console.log('\n── 3) Não-admin NÃO escreve (update no doc existente) ──');
    const r3 = await escreverComoUsuario(tkVend, DOC, { status: { stringValue: 'HACK vendedora tentou mudar' } });
    if (!expect('vendedora é BARRADA ao tentar escrever', r3, 'PERMISSION_DENIED')) escritaCriticaFalhou = true;

    console.log('\n── 4) Não-admin COM acesso a Comissões LÊ ──');
    expect('vendedora LÊ o desfecho da venda', await lerComoUsuario(tkVend, DOC), 'OK');

    console.log('\n── 5) Não-admin NÃO apaga ──');
    const r5 = await apagarComoUsuario(tkVend, DOC);
    if (!expect('vendedora é BARRADA ao tentar apagar', r5, 'PERMISSION_DENIED')) escritaCriticaFalhou = true;
    // Confirma que o documento sobreviveu à tentativa de delete acima.
    expect('documento continua existindo (delete não colou)', await lerComoUsuario(tkAdmin, DOC), 'OK');

    console.log('\n── 6) Sem token nenhum (requisição anônima) ──');
    const semTokenLeitura = await lerComoUsuario(null, DOC);
    expect('leitura anônima é barrada', semTokenLeitura === 'PERMISSION_DENIED' || semTokenLeitura === 'UNAUTHENTICATED', true);
    const semTokenEscrita = await escreverComoUsuario(null, `vendas_conferencia/${FIXTURE_ID}_anon`, { x: { booleanValue: true } });
    if (!expect('escrita anônima é barrada', semTokenEscrita === 'PERMISSION_DENIED' || semTokenEscrita === 'UNAUTHENTICATED', true)) escritaCriticaFalhou = true;

  } finally {
    console.log('\n── Limpeza ──');
    // Documento de teste — apagado pelo Admin SDK (aqui não estamos provando
    // rules, só arrumando a casa; usar REST de novo seria redundante e mais
    // frágil se algum passo acima tiver falhado).
    try {
      await db.collection('vendas_conferencia').doc(FIXTURE_ID).delete();
      console.log(`  vendas_conferencia/${FIXTURE_ID} removido`);
    } catch (e) { console.warn('  vendas_conferencia: ' + e.message); }
    try {
      await db.collection('vendas_conferencia').doc(`${FIXTURE_ID}_anon`).delete();
    } catch (e) { /* pode nem ter sido criado — é o esperado */ }
    if (vendedoraUid) {
      try { await admin.auth().deleteUser(vendedoraUid); console.log('  usuário Auth da vendedora fixture removido'); }
      catch (e) { console.warn('  auth: ' + e.message); }
      try { await db.collection('users').doc(vendedoraUid).delete(); console.log('  users/' + vendedoraUid.slice(0, 8) + '… removido'); }
      catch (e) { console.warn('  users: ' + e.message); }
    }

    // Checagem explícita de que não sobrou nada da fixture no staging.
    const docSobrou = await db.collection('vendas_conferencia').doc(FIXTURE_ID).get();
    const userSobrou = vendedoraUid ? await db.collection('users').doc(vendedoraUid).get() : { exists: false };
    let authSobrou = false;
    if (vendedoraUid) {
      try { await admin.auth().getUser(vendedoraUid); authSobrou = true; } catch (e) { authSobrou = false; }
    }
    console.log(`  checagem pós-limpeza: doc=${docSobrou.exists ? 'AINDA EXISTE ✗' : 'removido ✓'} · users=${userSobrou.exists ? 'AINDA EXISTE ✗' : 'removido ✓'} · auth=${authSobrou ? 'AINDA EXISTE ✗' : 'removido ✓'}`);
    if (docSobrou.exists || userSobrou.exists || authSobrou) { fails++; checks++; }
  }

  if (escritaCriticaFalhou) {
    console.log('\n🚨🚨🚨 CRÍTICO: um usuário NÃO-ADMIN conseguiu escrever/apagar em vendas_conferencia. 🚨🚨🚨');
    console.log('A regra NÃO está protegendo. NÃO subir isto pra produção. Pare e reporte.');
  }

  console.log(`\n${checks - fails}/${checks} verificações passaram`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
