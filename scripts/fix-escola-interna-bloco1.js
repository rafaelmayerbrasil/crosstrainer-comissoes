'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Bloco 1 — acerta os dados da Escola Interna que já estão em produção.
//
// 1) Remove a vaga de líder da unidade que não é a da sessão. A Escola Interna
//    acontece em UMA unidade por dia (Rafael, 04/08) — a vaga sobrando ficava
//    eternamente "sem líder". Só remove se estiver VAGA e sem aula gerada.
//
// 2) Marca as aulas de Escola Interna como NÃO remuneradas.
//    Necessário: `publishToAgenda` gravava `specialScaleType: null`, então a
//    regra de corte por tipo não pega as aulas antigas — sem esta migração elas
//    entrariam na folha (1h por sessão, por professor).
//
// Uso: node scripts/fix-escola-interna-bloco1.js --project staging|production [--dry-run]
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
const wPatch = (coll, id, fields) => ({
  update: { name: ref(coll, id), fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, enc(v)])) },
  updateMask: { fieldPaths: Object.keys(fields) },
});

(async () => {
  TOKEN = await getToken();
  console.log(`\nProjeto: ${PROJECT}${DRY_RUN ? '  [DRY-RUN]' : ''}\n`);

  const [scales, classes, teachers] = await Promise.all(['special_scales', 'classes', 'teachers'].map(listAll));
  const tn = id => (teachers.find(t => t.id === id) || {}).name || id;
  const ei = scales.filter(s => s.tipo === 'escola_interna').sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const writes = [];
  const agora = new Date();

  // ── 1) vaga sobrando de outra unidade ──
  console.log('── Vagas de líder em unidade que não é a da sessão ──');
  let removidas = 0, mantidas = 0;
  for (const s of ei) {
    const slots = s.slots || [];
    if (slots.length <= 1) { mantidas++; continue; }

    // A unidade real é a que tem líder escalado; sem ninguém, fica a PP (padrão).
    const comLider = slots.filter(x => x.assignedPersonId);
    const unidadeReal = comLider.length ? comLider[0].unitId
      : (slots.find(x => /pp$/i.test(x.unitId)) || slots[0]).unitId;

    const sobrando = slots.filter(x => x.unitId !== unidadeReal);
    const problema = sobrando.filter(x =>
      x.assignedPersonId || classes.some(c => c.specialScaleId === s.id && c.specialScaleSlotId === x.id));
    if (problema.length) {
      console.log(`  ⚠ ${s.date}: a vaga de ${problema.map(x => x.unitId.toUpperCase()).join(', ')} tem líder ou aula — NÃO removo, decida na tela`);
      continue;
    }

    const novos = slots.filter(x => x.unitId === unidadeReal);
    console.log(`  ✎ ${s.date}: mantém ${unidadeReal.toUpperCase()}, remove ${sobrando.map(x => x.unitId.toUpperCase()).join(', ')} (vaga vazia, sem aula)`);
    writes.push(wPatch('special_scales', s.id, { slots: novos, updatedAt: agora }));
    removidas += sobrando.length;
  }
  console.log(`  ${removidas} vaga(s) a remover · ${mantidas} sessão(ões) já corretas`);

  // ── 2) marcar as aulas como não remuneradas ──
  console.log('\n── Aulas de Escola Interna: marcar como NÃO remuneradas ──');
  const idsEI = new Set(ei.map(s => s.id));
  const aulasEI = classes.filter(c => idsEI.has(c.specialScaleId));
  const faltando = aulasEI.filter(c => c.remunerada !== false || c.specialScaleType !== 'escola_interna');
  console.log(`  ${aulasEI.length} aula(s) de Escola Interna · ${faltando.length} sem a marca correta`);
  faltando.forEach(c => {
    console.log(`    ✎ ${String(c.scheduledDate).slice(0, 10)} ${c.startTime} ${tn(c.teacherId)}`);
    writes.push(wPatch('classes', c.id, {
      remunerada: false, specialScaleType: 'escola_interna', updatedAt: agora,
    }));
  });

  // Nenhuma pode estar em mês fechado — seria alterar folha já paga
  const travadas = faltando.filter(c => c.monthClosingId);
  if (travadas.length) {
    console.error(`\n✗ ABORTADO: ${travadas.length} aula(s) em mês fechado.`);
    process.exit(1);
  }

  console.log(`\nEscritas: ${writes.length}`);
  if (!writes.length) return console.log('Nada a fazer.');
  if (DRY_RUN) return console.log('[dry-run] nada gravado.');
  await commit(writes);
  console.log('✓ aplicado');

  // ── conferência ──
  const s2 = (await listAll('special_scales')).filter(x => x.tipo === 'escola_interna');
  const c2 = (await listAll('classes')).filter(c => s2.some(x => x.id === c.specialScaleId));
  const multi = s2.filter(x => (x.slots || []).length > 1);
  const semMarca = c2.filter(c => c.remunerada !== false);
  console.log(`\nConferência: ${multi.length} sessão(ões) ainda com mais de uma vaga · ${semMarca.length} aula(s) ainda sem a marca`);
  if (multi.length || semMarca.length) process.exit(1);
  console.log('✓ Escola Interna: uma vaga por sessão e nenhuma aula contando hora');
})().catch(e => { console.error('\n✗ ERRO: ' + e.message); process.exit(1); });
