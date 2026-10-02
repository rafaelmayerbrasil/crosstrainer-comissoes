'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Prova, via REST autenticado, as regras da lista de renovações
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/validar-regras-renovacoes.js [--project staging]
//
// REST e não Admin SDK: o Admin SDK ignora as Security Rules. Login por TOKEN
// TEMPORÁRIO para usuários de fixture `zzfix-*`, apagados ao final.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
if ((arg('--project') || 'staging') !== 'staging') { console.error('Este validador só roda no staging.'); process.exit(1); }
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
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('token falhou: ' + ((j.error && j.error.message) || '?'));
  return j.idToken;
}
const status = r => (r.status === 403 ? 'NEGADO' : r.ok ? 'OK' : 'HTTP_' + r.status);
const ler = (tk, caminho) => fetch(`${BASE}/${caminho}`, { headers: tk ? { Authorization: `Bearer ${tk}` } : {} }).then(status);
const campos = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { stringValue: String(v) }]));
// PATCH com updateMask = grava só esses campos (cria o doc se não existir)
const gravar = (tk, caminho, obj) => {
  const mask = Object.keys(obj).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  return fetch(`${BASE}/${caminho}?${mask}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: campos(obj) }),
  }).then(status);
};
const apagar = (tk, caminho) => fetch(`${BASE}/${caminho}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tk}` } }).then(status);

async function usuarioComPerfil(perfil, semPerfil) {
  const snap = await db.collection('users').get();
  const d = snap.docs.find(x => {
    const u = x.data(); const p = u.profiles || (u.role ? [u.role] : []);
    return p.includes(perfil) && !(semPerfil || []).some(s => p.includes(s)) && u.status !== 'pendente';
  });
  return d ? d.id : null;
}

(async () => {
  console.log(`=== Regras da lista de renovações (${PROJECT}, REST autenticado) ===\n`);
  const LISTA = 'CP_zzfix-2026-10', A1 = 'CP_zzfix1', A2 = 'CP_zzfix2', A3 = 'PP_zzfix3';
  const SUP = 'zzfix-supervisao', VCP = 'zzfix-vendedora-cp', VPP = 'zzfix-vendedora-pp';
  // Cadastro antigo, como o da Erica e da Francini em produção (02/10/2026): só `role`, sem
  // `profiles`, e as unidades com o id de produção (`cp`/`pp`, sem o "unit-").
  const VANT = 'zzfix-vendedora-antiga';
  await db.collection('renovacoes_lista').doc(LISTA).set({ _fixture: true, unidade: 'CP', mes: '2026-10' });
  try {
    await db.collection('users').doc(SUP).set({ _fixture: true, name: 'ZZ FIXTURE SUPERVISAO', profiles: ['supervisao'], status: 'ativo' });
    await db.collection('users').doc(VCP).set({ _fixture: true, name: 'ZZ FIXTURE CP', role: 'vendedor', profiles: ['vendedor'], allowedUnits: ['unit-cp'], unitId: 'unit-cp', status: 'ativo' });
    await db.collection('users').doc(VPP).set({ _fixture: true, name: 'ZZ FIXTURE PP', role: 'vendedor', profiles: ['vendedor'], allowedUnits: ['unit-pp'], unitId: 'unit-pp', status: 'ativo' });
    await db.collection('users').doc(VANT).set({ _fixture: true, name: 'ZZ FIXTURE ANTIGA', role: 'vendedor', allowedUnits: ['cp', 'pp'], unitId: 'cp', status: 'ativo' });
    const uidAdmin = await usuarioComPerfil('admin');
    const uidProf = await usuarioComPerfil('professor', ['admin', 'supervisao']);
    if (!uidAdmin || !uidProf) throw new Error('faltou usuário de teste');
    const [tkAdmin, tkProf, tkSup, tkCP, tkPP, tkAnt] = await Promise.all([uidAdmin, uidProf, SUP, VCP, VPP, VANT].map(tokenDe));

    expect('vendedora de cadastro antigo (só role, unidade "cp") lê a lista do CP', await ler(tkAnt, `renovacoes_lista/${LISTA}`), 'OK');
    // A tela busca o acompanhamento em LISTA (where unidade == X), não documento a documento
    const consultar = (tk, unidade) => fetch(`${BASE}:runQuery`, {
      method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'renovacoes_acompanhamento' }],
        where: { fieldFilter: { field: { fieldPath: 'unidade' }, op: 'EQUAL', value: { stringValue: unidade } } } } }),
    }).then(status);
    expect('vendedora de cadastro antigo consulta o acompanhamento do CP (como a tela)', await consultar(tkAnt, 'CP'), 'OK');
    expect('vendedora do CP consulta o acompanhamento do CP (como a tela)', await consultar(tkCP, 'CP'), 'OK');
    expect('vendedora do PP NÃO consulta o acompanhamento do CP', await consultar(tkPP, 'CP'), 'NEGADO');

    expect('admin lê a lista', await ler(tkAdmin, `renovacoes_lista/${LISTA}`), 'OK');
    expect('supervisão lê a lista', await ler(tkSup, `renovacoes_lista/${LISTA}`), 'OK');
    expect('vendedora do CP lê a lista do CP', await ler(tkCP, `renovacoes_lista/${LISTA}`), 'OK');
    expect('vendedora do PP NÃO lê a lista do CP', await ler(tkPP, `renovacoes_lista/${LISTA}`), 'NEGADO');
    expect('professor NÃO lê a lista', await ler(tkProf, `renovacoes_lista/${LISTA}`), 'NEGADO');
    expect('sem login NÃO lê a lista', await ler(null, `renovacoes_lista/${LISTA}`), 'NEGADO');
    expect('admin NÃO grava a lista pelo navegador', await gravar(tkAdmin, `renovacoes_lista/${LISTA}`, { unidade: 'CP', invasao: 'x' }), 'NEGADO');

    const dela = { unidade: 'CP', codigoContrato: 'zzfix1', renovou: 'negociacao', dataContato: '2026-10-01' };
    expect('vendedora do CP cria o acompanhamento', await gravar(tkCP, `renovacoes_acompanhamento/${A1}`, dela), 'OK');
    expect('vendedora do CP lê o acompanhamento', await ler(tkCP, `renovacoes_acompanhamento/${A1}`), 'OK');
    expect('vendedora do CP muda a situação', await gravar(tkCP, `renovacoes_acompanhamento/${A1}`, { unidade: 'CP', codigoContrato: 'zzfix1', renovou: 'sim', planoFechado: 'ANUAL' }), 'OK');
    expect('vendedora NÃO atribui consultora', await gravar(tkCP, `renovacoes_acompanhamento/${A1}`, { unidade: 'CP', codigoContrato: 'zzfix1', consultoraAtribuida: 'EU' }), 'NEGADO');
    expect('vendedora NÃO classifica o verificar', await gravar(tkCP, `renovacoes_acompanhamento/${A1}`, { unidade: 'CP', codigoContrato: 'zzfix1', blocoGestao: 'excluir' }), 'NEGADO');
    expect('vendedora NÃO grava campo fora da lista', await gravar(tkCP, `renovacoes_acompanhamento/${A1}`, { unidade: 'CP', codigoContrato: 'zzfix1', invasao: 'x' }), 'NEGADO');
    expect('vendedora do PP NÃO grava no CP', await gravar(tkPP, `renovacoes_acompanhamento/${A2}`, { unidade: 'CP', codigoContrato: 'zzfix2', renovou: 'sim' }), 'NEGADO');
    expect('vendedora do PP NÃO lê o acompanhamento do CP', await ler(tkPP, `renovacoes_acompanhamento/${A1}`), 'NEGADO');
    expect('id que não bate com unidade+contrato é recusado', await gravar(tkCP, `renovacoes_acompanhamento/${A2}`, { unidade: 'CP', codigoContrato: 'outro', renovou: 'sim' }), 'NEGADO');
    expect('unidade inventada é recusada', await gravar(tkAdmin, `renovacoes_acompanhamento/XX_zzfix9`, { unidade: 'XX', codigoContrato: 'zzfix9', renovou: 'sim' }), 'NEGADO');
    expect('supervisão atribui consultora', await gravar(tkSup, `renovacoes_acompanhamento/${A1}`, { unidade: 'CP', codigoContrato: 'zzfix1', consultoraAtribuida: 'FRANCINI' }), 'OK');
    expect('admin classifica o verificar', await gravar(tkAdmin, `renovacoes_acompanhamento/${A2}`, { unidade: 'CP', codigoContrato: 'zzfix2', blocoGestao: 'renovacao' }), 'OK');
    expect('vendedora do PP grava no PP', await gravar(tkPP, `renovacoes_acompanhamento/${A3}`, { unidade: 'PP', codigoContrato: 'zzfix3', renovou: 'pendente' }), 'OK');
    expect('professor NÃO grava', await gravar(tkProf, `renovacoes_acompanhamento/${A1}`, { unidade: 'CP', codigoContrato: 'zzfix1', renovou: 'nao' }), 'NEGADO');
    expect('ninguém apaga, nem admin', await apagar(tkAdmin, `renovacoes_acompanhamento/${A1}`), 'NEGADO');
    const depois = (await db.collection('renovacoes_acompanhamento').doc(A1).get()).data();
    expect('o que a vendedora não podia não entrou', depois.blocoGestao === undefined && depois.invasao === undefined, true);
  } finally {
    await db.collection('renovacoes_lista').doc(LISTA).delete();
    for (const a of [A1, A2, A3]) await db.collection('renovacoes_acompanhamento').doc(a).delete();
    for (const uid of [SUP, VCP, VPP, VANT]) {
      await db.collection('users').doc(uid).delete();
      await admin.auth().deleteUser(uid).catch(() => {});
    }
    console.log('\nfixture removida');
  }
  console.log(`\n${checks - fails}/${checks} verificações passaram`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
