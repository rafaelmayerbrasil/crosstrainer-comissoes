'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Conserta o vínculo que faz o pedido de substituição achar o substituto.
//
// PROBLEMA: o elo pessoa↔login só existe em `users.professorId`. Mas /users só
// é legível pelo próprio dono ou por admin — um PROFESSOR não consegue
// descobrir o login de um colega. O pedido de substituição precisa disso pra
// gravar `substituteUserId` (é por ele que a caixa de pedidos do substituto
// filtra, e por ele que a notificação é enviada). Sem o espelho em
// `teachers.userId` (legível por todo o módulo), TODO pedido nascia órfão:
// ninguém era notificado e o substituto nunca via o pedido.
//
// O QUE FAZ:
//   1. espelha users.professorId → teachers.userId (idempotente)
//   2. repara pedidos pendentes com substituteUserId nulo, agora que dá pra resolver
//
// Uso:
//   node scripts/fix-vinculo-substituicao.js --project staging    [--dry-run]
//   node scripts/fix-vinculo-substituicao.js --project production [--dry-run]
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const i = argv.indexOf('--project');
const ALIAS = i >= 0 ? argv[i + 1] : null;
const PROJECTS = { staging: 'crosstrainer-comissoes-staging', production: 'crosstrainer-comissoes' };
const PROJECT = PROJECTS[ALIAS];
if (!PROJECT) { console.error('Use --project staging | --project production'); process.exit(1); }

const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';
const DB = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)`;
let TOKEN = null;

function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
}
function dec(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return decF(v.mapValue.fields || {});
  return null;
}
const decF = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, dec(v)]));

async function getToken() {
  const store = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  const refresh = JSON.parse(fs.readFileSync(store, 'utf8')).tokens.refresh_token;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('sem access token: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

async function listAll(coll) {
  let out = [], pt = '';
  do {
    const r = await fetch(`${DB}/documents/${coll}?pageSize=300${pt ? '&pageToken=' + pt : ''}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) throw new Error(`GET ${coll}: ${r.status}`);
    const j = await r.json();
    (j.documents || []).forEach(d => out.push({ id: d.name.split('/').pop(), ...decF(d.fields || {}) }));
    pt = j.nextPageToken || '';
  } while (pt);
  return out;
}

async function commit(writes) {
  for (let k = 0; k < writes.length; k += 400) {
    const r = await fetch(`${DB}/documents:commit`, {
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes: writes.slice(k, k + 400) }),
    });
    if (!r.ok) throw new Error(`commit: ${r.status} ${(await r.text()).slice(0, 300)}`);
  }
}
const wPatch = (coll, id, fields) => ({
  update: { name: `projects/${PROJECT}/databases/(default)/documents/${coll}/${id}`, fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, enc(v)])) },
  updateMask: { fieldPaths: Object.keys(fields) },
});

(async () => {
  TOKEN = await getToken();
  console.log(`\n${'═'.repeat(70)}\nProjeto: ${PROJECT}${DRY_RUN ? '  [DRY-RUN]' : ''}\n${'═'.repeat(70)}\n`);

  const [teachers, users, subs] = await Promise.all([listAll('teachers'), listAll('users'), listAll('substitutions')]);
  const writes = [];
  const agora = new Date();

  // ── 1. espelhar o vínculo ──
  console.log('── Vínculo professor → login ──');
  let jaOk = 0, semUser = 0;
  const corrigidos = [];
  for (const t of teachers) {
    const u = users.find(x => x.professorId === t.id);
    if (!u) { semUser++; continue; }
    if (t.userId === u.id) { jaOk++; continue; }
    corrigidos.push(`${t.name} → ${u.email || u.id}`);
    writes.push(wPatch('teachers', t.id, { userId: u.id, updatedAt: agora }));
  }
  console.log(`  já corretos: ${jaOk} · sem login: ${semUser} · a corrigir: ${corrigidos.length}`);
  corrigidos.forEach(c => console.log(`    ✎ ${c}`));

  // ── 2. reparar pedidos pendentes órfãos ──
  console.log('\n── Pedidos de substituição pendentes sem destinatário ──');
  const orfaos = subs.filter(s => s.status === 'pending' && !s.substituteUserId);
  if (!orfaos.length) console.log('  nenhum');
  for (const s of orfaos) {
    const u = users.find(x => x.professorId === s.substituteTeacherId);
    const t = teachers.find(x => x.id === s.substituteTeacherId);
    if (!u) { console.log(`  ⚠ ${s.id}: substituto "${t ? t.name : s.substituteTeacherId}" não tem login — deixa como está`); continue; }
    console.log(`  ✎ ${s.id}: agora aponta para ${t ? t.name : ''} <${u.email || u.id}>`);
    writes.push(wPatch('substitutions', s.id, { substituteUserId: u.id, updatedAt: agora }));
  }

  console.log(`\nTotal de escritas: ${writes.length}`);
  if (!writes.length) return console.log('Nada a fazer.');
  if (DRY_RUN) return console.log('[dry-run] nada gravado.');
  await commit(writes);
  console.log('✓ aplicado');

  // ── conferência ──
  const t2 = await listAll('teachers');
  const u2 = await listAll('users');
  const faltando = t2.filter(t => u2.find(x => x.professorId === t.id) && !t.userId);
  const s2 = (await listAll('substitutions')).filter(s => s.status === 'pending' && !s.substituteUserId);
  console.log(`\nConferência: ${faltando.length} professor(es) ainda sem vínculo · ${s2.length} pedido(s) ainda órfão(s)`);
  if (faltando.length || s2.length) process.exit(1);
})().catch(e => { console.error('\n✗ ERRO: ' + e.message); process.exit(1); });
