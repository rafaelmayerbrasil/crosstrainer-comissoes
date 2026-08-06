'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Move para SÁBADO os 3 slots de 08:00–12:00 que nasceram na SEGUNDA.
//
// Contexto: o formulário de novo slot marcava Segunda sozinho a cada abertura.
// Ao montar a manhã de sábado (4 slots em 73s), só o 1º ficou no sábado; os
// outros 3 foram gravados na segunda sem o admin perceber. Corrigido em
// professores-agenda.js; este script arruma os dados que já entraram.
//
// Também apaga as aulas de SEGUNDA geradas a partir desses slots (estão no dia
// errado). Aborta se alguma já tiver uso real. Depois é preciso regerar.
//
// Uso: node scripts/fix-slots-sabado.js --project production [--dry-run]
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

const SEGUNDA = 1, SABADO = 6;
const INICIO = '08:00', FIM = '12:00';

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
  if (!j.access_token) throw new Error('sem token');
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
const ref = (coll, id) => `projects/${PROJECT}/databases/(default)/documents/${coll}/${id}`;
const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

(async () => {
  TOKEN = await getToken();
  console.log(`\nProjeto: ${PROJECT}${DRY_RUN ? '  [DRY-RUN]' : ''}\n`);

  const [slots, classes, teachers, mods] = await Promise.all(
    ['schedule_slots', 'classes', 'teachers', 'modalities'].map(listAll));
  const tn = id => (teachers.find(t => t.id === id) || {}).name || id;
  const mn = id => (mods.find(m => m.id === id) || {}).name || '—';

  // Os slots afetados: bloco 08:00–12:00 na segunda, criados pela tela
  const alvos = slots.filter(s => s.weekday === SEGUNDA && s.startTime === INICIO
    && s.endTime === FIM && !s.seedSource && s.isActive !== false);

  console.log(`── ${alvos.length} slot(s) a mover para SÁBADO ──`);
  alvos.forEach(s => console.log(`  ${s.unitId.toUpperCase()} ${s.startTime}-${s.endTime} · ${mn(s.modalityId)} · ${tn(s.teacherId)}`));
  if (!alvos.length) return console.log('\nNada a fazer.');

  // Conflito no destino: mesmo professor sobreposto no sábado (D6)
  console.log('\n── Confere conflito no sábado ──');
  const noSabado = slots.filter(s => s.weekday === SABADO && s.isActive !== false);
  let conflito = false;
  alvos.forEach(a => {
    const outros = noSabado.concat(alvos.filter(x => x.id !== a.id));
    outros.forEach(b => {
      if (b.teacherId !== a.teacherId) return;
      if (Math.max(toMin(a.startTime), toMin(b.startTime)) >= Math.min(toMin(a.endTime), toMin(b.endTime))) return;
      conflito = true;
      console.log(`  ✗ ${tn(a.teacherId)} ficaria com duas aulas sobrepostas no sábado`);
    });
  });
  if (conflito) { console.error('\n✗ ABORTADO: mover criaria conflito de professor.'); process.exit(1); }
  console.log('  ✓ nenhum conflito');

  // Aulas de segunda geradas por esses slots — estão no dia errado
  const ids = new Set(alvos.map(s => s.id));
  const aulasErradas = classes.filter(c => ids.has(c.slotId));
  const comUso = aulasErradas.filter(c =>
    (c.status && c.status !== 'prevista') || c.monthClosingId || c.adjustedAt);
  console.log(`\n── ${aulasErradas.length} aula(s) de segunda geradas por esses slots ──`);
  if (comUso.length) {
    console.error(`✗ ABORTADO: ${comUso.length} já têm uso real (marcada/substituída/mês fechado).`);
    comUso.slice(0, 5).forEach(c => console.error(`    ${String(c.scheduledDate).slice(0, 10)} status=${c.status}`));
    process.exit(1);
  }
  console.log('  ✓ nenhuma com uso real — podem ser removidas');

  const writes = [];
  const agora = new Date();
  aulasErradas.forEach(c => writes.push({ delete: ref('classes', c.id) }));
  alvos.forEach(s => writes.push({
    update: { name: ref('schedule_slots', s.id), fields: { weekday: enc(SABADO), updatedAt: enc(agora) } },
    updateMask: { fieldPaths: ['weekday', 'updatedAt'] },
  }));

  console.log(`\nEscritas: ${writes.length} (${aulasErradas.length} aulas apagadas + ${alvos.length} slots movidos)`);
  if (DRY_RUN) return console.log('[dry-run] nada gravado.');
  await commit(writes);
  console.log('✓ aplicado');

  const depois = (await listAll('schedule_slots')).filter(s => s.weekday === SABADO && s.isActive !== false);
  console.log(`\nSábado agora tem ${depois.length} slot(s):`);
  depois.forEach(s => console.log(`  ${s.unitId.toUpperCase()} ${s.startTime}-${s.endTime} · ${mn(s.modalityId)} · ${tn(s.teacherId)}`));
  console.log('\n⚠ Falta REGERAR as aulas para o sábado aparecer na agenda.');
})().catch(e => { console.error('\n✗ ERRO: ' + e.message); process.exit(1); });
