'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Prova, via REST autenticado, as regras das coleções do modo sombra
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/validar-regras-pacto-sombra.js [--project staging]
//
// REST e não Admin SDK: o Admin SDK ignora as Security Rules. O login é por
// TOKEN TEMPORÁRIO gerado pelo Admin SDK para um usuário existente — nenhuma
// senha é usada. Cria uma fixture `zzfix...` e apaga ao final.
//
// O que prova:
//  • admin LÊ pacto_sombra_dias e pacto_contratos;
//  • professor (não admin) NÃO lê;
//  • ninguém grava pelo navegador, nem admin;
//  • sem login, nada;
//  • termômetro (só totais): admin e SUPERVISÃO leem; professor e vendedora não;
//  • pacto_consultoras não tem regra: ninguém lê pelo navegador, nem admin.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const ALVO = arg('--project') || 'staging';
if (ALVO !== 'staging') { console.error('Este validador só roda no staging.'); process.exit(1); }
const PROJECT = 'crosstrainer-comissoes-staging';

const svcPath = path.join(__dirname, 'serviceAccount-staging.json');
if (!fs.existsSync(svcPath)) { console.error('Falta scripts/serviceAccount-staging.json'); process.exit(1); }
const cfg = fs.readFileSync(path.join(__dirname, '..', 'firebase-config.js'), 'utf8');
const apiKey = (cfg.match(/apiKey:\s*['"]([^'"]+)['"][\s\S]{0,120}?crosstrainer-comissoes-staging/) || [])[1];
if (!apiKey) { console.error('não achei a apiKey do staging'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(require(svcPath)), projectId: PROJECT });
const db = admin.firestore();
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

let fails = 0, checks = 0;
function expect(desc, got, want) {
  const ok = got === want; checks++; if (!ok) fails++;
  console.log(`${ok ? '✓' : '✗'} ${desc} — esperado ${want}, veio ${got}`);
}

async function tokenDe(uid) {
  const custom = await admin.auth().createCustomToken(uid);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('token falhou: ' + ((j.error && j.error.message) || '?'));
  return j.idToken;
}

const status = r => (r.status === 403 ? 'NEGADO' : r.ok ? 'OK' : 'HTTP_' + r.status);
const ler = (tk, caminho) => fetch(`${BASE}/${caminho}`, { headers: tk ? { Authorization: `Bearer ${tk}` } : {} }).then(status);
const gravar = (tk, caminho) => fetch(`${BASE}/${caminho}?updateMask.fieldPaths=invasao`, {
  method: 'PATCH', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: { invasao: { stringValue: 'x' } } }),
}).then(status);

async function usuarioComPerfil(perfil, semPerfil) {
  const snap = await db.collection('users').get();
  const d = snap.docs.find(x => {
    const u = x.data(); const p = u.profiles || (u.role ? [u.role] : []);
    return p.includes(perfil) && !(semPerfil || []).some(s => p.includes(s)) && u.status !== 'pendente';
  });
  return d ? d.id : null;
}

(async () => {
  console.log(`=== Regras do modo sombra (${PROJECT}, REST autenticado) ===\n`);
  const DIA = 'zzfix_2026-08-01', CONTRATO = 'zzfix_1';
  await db.collection('pacto_sombra_dias').doc(DIA).set({ _fixture: true, unidade: 'zz', dia: '2026-08-01', situacao: 'buscado' });
  await db.collection('pacto_contratos').doc(CONTRATO).set({ _fixture: true, codigo: '1' });
  const TERMO = 'zzfix_2026-08', CONSULTORA = 'zzfix_1', SUP = 'zzfix-supervisao', VEND = 'zzfix-vendedora';
  await db.collection('pacto_termometro').doc(TERMO).set({ _fixture: true, unidade: 'zz', mes: '2026-08' });
  await db.collection('pacto_consultoras').doc(CONSULTORA).set({ _fixture: true, codigo: '1' });
  try {
    const uidAdmin = await usuarioComPerfil('admin');
    const uidProf = await usuarioComPerfil('professor', ['admin', 'supervisao']);
    if (!uidAdmin || !uidProf) throw new Error('faltou usuário de teste (admin: ' + uidAdmin + ', professor: ' + uidProf + ')');
    const tkAdmin = await tokenDe(uidAdmin);
    const tkProf = await tokenDe(uidProf);

    expect('admin lê pacto_sombra_dias', await ler(tkAdmin, `pacto_sombra_dias/${DIA}`), 'OK');
    expect('admin lê pacto_contratos', await ler(tkAdmin, `pacto_contratos/${CONTRATO}`), 'OK');
    expect('professor NÃO lê pacto_sombra_dias', await ler(tkProf, `pacto_sombra_dias/${DIA}`), 'NEGADO');
    expect('professor NÃO lê pacto_contratos', await ler(tkProf, `pacto_contratos/${CONTRATO}`), 'NEGADO');
    expect('admin NÃO grava pacto_sombra_dias pelo navegador', await gravar(tkAdmin, `pacto_sombra_dias/${DIA}`), 'NEGADO');
    expect('admin NÃO grava pacto_contratos pelo navegador', await gravar(tkAdmin, `pacto_contratos/${CONTRATO}`), 'NEGADO');
    expect('sem login NÃO lê', await ler(null, `pacto_sombra_dias/${DIA}`), 'NEGADO');
    // Staging não tem usuário SÓ de supervisão nem só vendedora: fixtures, apagadas no fim
    await db.collection('users').doc(SUP).set({ _fixture: true, name: 'ZZ FIXTURE SUPERVISAO', profiles: ['supervisao'], status: 'ativo' });
    await db.collection('users').doc(VEND).set({ _fixture: true, name: 'ZZ FIXTURE VENDEDORA', role: 'vendedor', profiles: ['vendedor'], status: 'ativo' });
    const tkSup = await tokenDe(SUP);
    const uidVend = VEND;
    expect('admin lê pacto_termometro', await ler(tkAdmin, `pacto_termometro/${TERMO}`), 'OK');
    expect('supervisão lê pacto_termometro', await ler(tkSup, `pacto_termometro/${TERMO}`), 'OK');
    expect('supervisão NÃO lê pacto_sombra_dias (tem nome de cliente)', await ler(tkSup, `pacto_sombra_dias/${DIA}`), 'NEGADO');
    expect('professor NÃO lê pacto_termometro', await ler(tkProf, `pacto_termometro/${TERMO}`), 'NEGADO');
    if (uidVend) expect('vendedora NÃO lê pacto_termometro', await ler(await tokenDe(uidVend), `pacto_termometro/${TERMO}`), 'NEGADO');
    expect('admin NÃO grava pacto_termometro pelo navegador', await gravar(tkAdmin, `pacto_termometro/${TERMO}`), 'NEGADO');
    expect('supervisão NÃO grava pacto_termometro', await gravar(tkSup, `pacto_termometro/${TERMO}`), 'NEGADO');
    expect('admin NÃO lê pacto_consultoras pelo navegador', await ler(tkAdmin, `pacto_consultoras/${CONSULTORA}`), 'NEGADO');
    const intacto = (await db.collection('pacto_sombra_dias').doc(DIA).get()).data();
    expect('a tentativa de gravação não alterou o documento', intacto.invasao === undefined, true);
  } finally {
    await db.collection('pacto_sombra_dias').doc(DIA).delete();
    await db.collection('pacto_contratos').doc(CONTRATO).delete();
    await db.collection('pacto_termometro').doc(TERMO).delete();
    await db.collection('pacto_consultoras').doc(CONSULTORA).delete();
    for (const uid of [SUP, VEND]) {
      await db.collection('users').doc(uid).delete();
      await admin.auth().deleteUser(uid).catch(() => {});   // o login por token cria a conta no Auth
    }
    console.log('\nfixture removida');
  }
  console.log(`\n${checks - fails}/${checks} verificações passaram`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
