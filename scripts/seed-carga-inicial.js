'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Carga inicial do módulo Professores a partir da planilha-modelo preenchida.
// Cria: modalities faltantes · schedule_templates faltantes · schedule_slots.
// NÃO cria teachers em produção (o Rodrigo já cadastrou pelo hub) — só casa por nome.
//
// Uso:
//   node scripts/seed-carga-inicial.js --project staging    --dry-run
//   node scripts/seed-carga-inicial.js --project staging    --allow-create-teachers
//   node scripts/seed-carga-inicial.js --project production --dry-run
//   node scripts/seed-carga-inicial.js --project production
//   node scripts/seed-carga-inicial.js --project staging    --cleanup
//
// Autenticação: usa a credencial da CLI Firebase já logada (refresh_token do
// configstore) → access token OAuth → Firestore REST. Nível owner, então
// BYPASSA as security rules — por isso validar em staging antes da produção.
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx } = require('./lib-xlsx-min');

// ─── argumentos ──────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = f => argv.includes(f);
const opt = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const PROJECT_ALIAS = opt('--project');
const DRY_RUN = flag('--dry-run');
const CLEANUP = flag('--cleanup');
const ALLOW_CREATE_TEACHERS = flag('--allow-create-teachers');

const PROJECTS = { staging: 'crosstrainer-comissoes-staging', production: 'crosstrainer-comissoes' };
const PROJECT = PROJECTS[PROJECT_ALIAS];
if (!PROJECT) {
  console.error('Use --project staging | --project production');
  process.exit(1);
}
if (PROJECT_ALIAS === 'production' && ALLOW_CREATE_TEACHERS) {
  console.error('✗ --allow-create-teachers é proibido em produção (professores vêm do hub).');
  process.exit(1);
}

const PLANILHA = path.join(__dirname, '..', '..', '..', '..', 'carga professores agenda', 'modelo-carga-inicial.xlsx');
const SEED_TAG = 'carga-inicial-2026-07-29'; // marca tudo que a carga criou → rollback/cleanup
const AUTOR = 'seed-carga-inicial';          // rastreável no audit; não finge ser um usuário

// Correções de grafia aplicadas AO CADASTRO antes de casar os nomes.
// THAYNARA: produção tem "SILA" (typo, falta o V); email thaynaraslva@outlook.com confirma SILVA.
// Decidido com o usuário em 29/07/2026.
const CORRECOES_NOME_TEACHER = { 'THAYNARA SILA': 'THAYNARA SILVA' };

// ─── auth ────────────────────────────────────────────────────────────────
const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi'; // client público do firebase-tools

async function getToken() {
  const store = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(store)) throw new Error('CLI Firebase não logada (rode: firebase login)');
  const refresh = JSON.parse(fs.readFileSync(store, 'utf8')).tokens?.refresh_token;
  if (!refresh) throw new Error('sem refresh_token no configstore da CLI');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('não consegui access token: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

// ─── firestore REST ──────────────────────────────────────────────────────
const DB = p => `https://firestore.googleapis.com/v1/projects/${p}/databases/(default)`;
let TOKEN = null;

function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === 'object') return { mapValue: { fields: encFields(v) } };
  throw new Error('tipo não suportado: ' + typeof v);
}
const encFields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)]));

function dec(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return decFields(v.mapValue.fields || {});
  return null;
}
const decFields = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, dec(v)]));

async function listAll(coll) {
  let out = [], pageToken = '';
  do {
    const url = `${DB(PROJECT)}/documents/${coll}?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) throw new Error(`GET ${coll}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    (j.documents || []).forEach(d => out.push({ id: d.name.split('/').pop(), ...decFields(d.fields || {}) }));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}

/** Commit em lote (máx 500 writes por chamada — quebramos em 400). */
async function commit(writes) {
  const CHUNK = 400;
  for (let i = 0; i < writes.length; i += CHUNK) {
    const lote = writes.slice(i, i + CHUNK);
    const r = await fetch(`${DB(PROJECT)}/documents:commit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes: lote }),
    });
    if (!r.ok) throw new Error(`commit falhou: ${r.status} ${(await r.text()).slice(0, 400)}`);
    process.stdout.write(`    …${Math.min(i + CHUNK, writes.length)}/${writes.length}\r`);
  }
  process.stdout.write('\n');
}

const docPath = (coll, id) => `projects/${PROJECT}/databases/(default)/documents/${coll}/${id}`;
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const autoId = () => Array.from({ length: 20 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
const wSet = (coll, id, fields) => ({ update: { name: docPath(coll, id), fields: encFields(fields) } });
const wPatch = (coll, id, fields) => ({ update: { name: docPath(coll, id), fields: encFields(fields) }, updateMask: { fieldPaths: Object.keys(fields) } });
const wDel = (coll, id) => ({ delete: docPath(coll, id) });

// ─── helpers de domínio ──────────────────────────────────────────────────
const norm = s => (s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '');
const ehExemplo = s => /exemplo/i.test(s || '');
const WEEKDAY = { DOMINGO: 0, SEGUNDA: 1, TERCA: 2, QUARTA: 3, QUINTA: 4, SEXTA: 5, SABADO: 6 };

/** Horário da planilha → 'HH:MM'. Aceita texto 'HH:MM' e fração de dia do Excel (0,25 = 06:00). */
function parseHora(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return String(h).padStart(2, '0') + ':' + m[2];
  }
  const n = Number(s.replace(',', '.'));
  if (isNaN(n) || n < 0 || n >= 1) return null;
  const mins = Math.round(n * 24 * 60);
  return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** Resolve a sigla de unidade da planilha (CP/PP) para o id real do projeto. */
function resolveUnidade(sigla, units) {
  const alvo = norm(sigla);
  return units.find(u => norm(u.id) === alvo)
      || units.find(u => norm(u.id).replace(/^UNIT/, '') === alvo)
      || units.find(u => norm(u.name || '').endsWith(alvo))
      || null;
}

// ─── leitura da planilha ─────────────────────────────────────────────────
function lerPlanilha() {
  if (!fs.existsSync(PLANILHA)) throw new Error('planilha não encontrada: ' + PLANILHA);
  const wb = readXlsx(PLANILHA);

  const abaMod = wb.sheetNames.find(n => norm(n).startsWith('MODALIDADE'));
  const abaGrade = wb.sheetNames.find(n => norm(n).startsWith('GRADE'));
  if (!abaMod || !abaGrade) throw new Error('abas esperadas não encontradas: ' + wb.sheetNames.join(', '));

  const mod = wb.sheet(abaMod);
  const modalidades = [];
  for (const r of Object.keys(mod).map(Number).sort((a, b) => a - b)) {
    if (r <= 3) continue; // 1-2 = instruções, 3 = cabeçalho
    const v = (mod[r][0] || '').trim();
    if (!v || ehExemplo(v)) continue;
    modalidades.push(v);
  }

  const gr = wb.sheet(abaGrade);
  const aulas = [];
  for (const r of Object.keys(gr).map(Number).sort((a, b) => a - b)) {
    if (r <= 3) continue;
    const c = gr[r];
    const professor = (c[1] || '').trim();
    if (!professor || ehExemplo(professor)) continue;
    aulas.push({
      linha: r,
      unidade: (c[0] || '').trim(),
      professor,
      dia: (c[2] || '').trim(),
      weekday: WEEKDAY[norm(c[2])],
      startTime: parseHora(c[3]),
      endTime: parseHora(c[4]),
      modalidade: (c[5] || '').trim(),
    });
  }
  return { modalidades, aulas };
}

// ─── cleanup ─────────────────────────────────────────────────────────────
async function cleanup() {
  console.log(`\n⚠️  CLEANUP em ${PROJECT} — removendo tudo com seedSource="${SEED_TAG}"\n`);
  const writes = [];

  // As aulas NÃO têm seedSource (a CF que as gera não conhece a carga), então
  // removemos as que apontam para os slots da carga — senão sobram aulas órfãs
  // apontando pra slot/professor inexistente.
  const slotsDaCarga = (await listAll('schedule_slots')).filter(d => d.seedSource === SEED_TAG);
  const idsDosSlots = new Set(slotsDaCarga.map(s => s.id));
  const aulasOrfas = (await listAll('classes')).filter(c => idsDosSlots.has(c.slotId));
  aulasOrfas.forEach(c => writes.push(wDel('classes', c.id)));
  console.log(`  classes (geradas a partir desses slots): ${aulasOrfas.length} doc(s) a remover`);

  for (const coll of ['schedule_slots', 'schedule_templates', 'modalities', 'teachers']) {
    const docs = (await listAll(coll)).filter(d => d.seedSource === SEED_TAG);
    docs.forEach(d => writes.push(wDel(coll, d.id)));
    console.log(`  ${coll}: ${docs.length} doc(s) a remover`);
  }
  if (!writes.length) return console.log('\nNada pra remover.');
  if (DRY_RUN) return console.log('\n[dry-run] nada removido.');
  await commit(writes);
  console.log(`✓ cleanup completo (${writes.length} docs removidos)`);

  const sobrou = (await listAll('schedule_slots')).filter(d => d.seedSource === SEED_TAG).length;
  console.log(sobrou ? `✗ ainda sobraram ${sobrou} slots` : '✓ conferido: nenhum slot da carga restou');
}

// ─── carga ───────────────────────────────────────────────────────────────
async function carga() {
  const { modalidades, aulas } = lerPlanilha();
  console.log(`Planilha: ${modalidades.length} modalidades · ${aulas.length} aulas na grade\n`);

  const [units, modsProd, teachersProd, templatesProd, slotsProd] = await Promise.all(
    ['units', 'modalities', 'teachers', 'schedule_templates', 'schedule_slots'].map(listAll));
  console.log(`Produção/staging atual: ${units.length} units · ${modsProd.length} modalities · `
    + `${teachersProd.length} teachers · ${templatesProd.length} templates · ${slotsProd.length} slots\n`);

  const writes = [];
  const erros = [];
  const agora = new Date();

  // ── 0. correções de nome no cadastro ──
  const teachers = teachersProd.map(t => ({ ...t }));
  for (const [errado, certo] of Object.entries(CORRECOES_NOME_TEACHER)) {
    const t = teachers.find(x => x.name === errado);
    if (t) {
      console.log(`✎ corrigindo nome do cadastro: "${errado}" → "${certo}"`);
      writes.push(wPatch('teachers', t.id, { name: certo, updatedAt: agora }));
      t.name = certo;
    }
  }

  // ── 1. modalidades ──
  const modalityIdPorNome = new Map();
  modsProd.forEach(m => modalityIdPorNome.set(norm(m.name), m.id));
  const modsCriar = modalidades.filter(m => !modalityIdPorNome.has(norm(m)));
  modsCriar.forEach(nome => {
    const id = autoId();
    modalityIdPorNome.set(norm(nome), id);
    writes.push(wSet('modalities', id, {
      name: nome, description: '', isActive: true,
      createdAt: agora, createdBy: AUTOR, seedSource: SEED_TAG,
    }));
  });
  console.log(`Modalidades: ${modsProd.length} já existiam · ${modsCriar.length} a criar${modsCriar.length ? ' → ' + modsCriar.map(m => `"${m}"`).join(', ') : ''}`);

  // ── 2. templates por unidade ──
  const unidadesUsadas = [...new Set(aulas.map(a => a.unidade))];
  const templateIdPorUnit = new Map();
  const unitIdPorSigla = new Map();
  for (const sigla of unidadesUsadas) {
    const unit = resolveUnidade(sigla, units);
    if (!unit) { erros.push(`unidade "${sigla}" da planilha não existe (existem: ${units.map(u => u.id).join(', ')})`); continue; }
    unitIdPorSigla.set(sigla, unit.id);
    const existente = templatesProd.find(t => t.unitId === unit.id && t.isActive !== false);
    if (existente) { templateIdPorUnit.set(unit.id, existente.id); continue; }
    const id = autoId();
    templateIdPorUnit.set(unit.id, id);
    writes.push(wSet('schedule_templates', id, {
      unitId: unit.id, name: `Grade Padrão ${unit.name || unit.id}`, isActive: true,
      validFrom: agora, validTo: null,
      createdAt: agora, createdBy: AUTOR, updatedAt: agora, updatedBy: AUTOR, seedSource: SEED_TAG,
    }));
    console.log(`  template criado para unidade "${unit.id}"`);
  }

  // ── 3. professores: casar por nome (criar só se autorizado, p/ ensaio em staging) ──
  const teacherIdPorNome = new Map();
  teachers.forEach(t => teacherIdPorNome.set(norm(t.name), t.id));
  const nomesGrade = [...new Set(aulas.map(a => a.professor))];
  const criados = [];
  for (const nome of nomesGrade) {
    if (teacherIdPorNome.has(norm(nome))) continue;
    if (!ALLOW_CREATE_TEACHERS) {
      const qtd = aulas.filter(a => a.professor === nome).length;
      erros.push(`professor "${nome}" (${qtd} aulas) não existe no cadastro — cadastre pelo hub Pessoas antes`);
      continue;
    }
    const id = autoId();
    teacherIdPorNome.set(norm(nome), id);
    const unidadesDele = [...new Set(aulas.filter(a => a.professor === nome).map(a => unitIdPorSigla.get(a.unidade)).filter(Boolean))];
    criados.push(nome);
    writes.push(wSet('teachers', id, {
      name: nome, email: '', phone: '', cpf: '', type: 'efetivo',
      unitIds: unidadesDele, primaryUnitId: unidadesDele[0] || null,
      modalityIds: [], userId: null, isActive: true, notes: 'criado pelo ensaio da carga inicial',
      hireDate: null, internshipStartDate: null, contractEndDate: null,
      createdAt: agora, createdBy: AUTOR, seedSource: SEED_TAG,
    }));
  }
  if (criados.length) console.log(`Professores: ${criados.length} criados p/ ensaio → ${criados.join(', ')}`);
  else console.log(`Professores: ${nomesGrade.length} nomes da grade, todos casados com o cadastro`);

  // ── 4. slots ──
  const slots = [];
  for (const a of aulas) {
    const ctx = `linha ${a.linha} (${a.professor} · ${a.dia} ${a.startTime}-${a.endTime})`;
    const unitId = unitIdPorSigla.get(a.unidade);
    const templateId = unitId ? templateIdPorUnit.get(unitId) : null;
    const teacherId = teacherIdPorNome.get(norm(a.professor));
    const modalityId = modalityIdPorNome.get(norm(a.modalidade));

    if (!unitId) continue; // erro já registrado
    if (!templateId) { erros.push(`${ctx}: sem template para a unidade ${unitId}`); continue; }
    if (!teacherId) continue; // erro já registrado
    if (!modalityId) { erros.push(`${ctx}: modalidade "${a.modalidade}" não resolvida`); continue; }
    if (typeof a.weekday !== 'number') { erros.push(`${ctx}: dia da semana "${a.dia}" inválido`); continue; }
    if (!a.startTime || !a.endTime) { erros.push(`${ctx}: horário inválido`); continue; }

    const ini = toMin(a.startTime), fim = toMin(a.endTime);
    if (fim <= ini) { erros.push(`${ctx}: fim <= início`); continue; }
    if (fim - ini < 15) { erros.push(`${ctx}: duração menor que 15 min`); continue; }

    slots.push({ id: autoId(), unitId, templateId, teacherId, modalityId,
      weekday: a.weekday, startTime: a.startTime, endTime: a.endTime,
      durationMinutes: fim - ini, linha: a.linha, professor: a.professor });
  }

  // ── 5. regra D6: mesmo professor com horário sobreposto BLOQUEIA ──
  // Vale contra os slots novos E contra os que já existem no banco.
  const todos = [
    ...slotsProd.filter(s => s.isActive !== false).map(s => ({ ...s, existente: true })),
    ...slots,
  ];
  for (let i = 0; i < todos.length; i++) {
    for (let j = i + 1; j < todos.length; j++) {
      const a = todos[i], b = todos[j];
      if (a.teacherId !== b.teacherId || a.weekday !== b.weekday) continue;
      if (Math.max(toMin(a.startTime), toMin(b.startTime)) < Math.min(toMin(a.endTime), toMin(b.endTime))) {
        if (a.existente && b.existente) continue;
        erros.push(`conflito D6 (mesmo professor sobreposto): ${a.professor || a.teacherId} `
          + `${a.existente ? '[já no banco]' : 'linha ' + a.linha} ${a.startTime}-${a.endTime}`
          + ` × ${b.existente ? '[já no banco]' : 'linha ' + b.linha} ${b.startTime}-${b.endTime}`);
      }
    }
  }

  slots.forEach(s => writes.push(wSet('schedule_slots', s.id, {
    templateId: s.templateId, unitId: s.unitId, weekday: s.weekday,
    startTime: s.startTime, endTime: s.endTime, durationMinutes: s.durationMinutes,
    modalityId: s.modalityId, teacherId: s.teacherId, isActive: true, notes: '',
    createdAt: agora, createdBy: AUTOR, updatedAt: agora, updatedBy: AUTOR, seedSource: SEED_TAG,
  })));
  console.log(`Slots: ${slots.length} de ${aulas.length} linhas prontos`);

  // ── 6. veredito ──
  if (erros.length) {
    console.log(`\n✗ ${erros.length} PROBLEMA(S) — nada foi gravado:\n`);
    erros.forEach(e => console.log('  • ' + e));
    process.exit(1);
  }
  if (slotsProd.length) {
    console.log(`\n⚠️  já existem ${slotsProd.length} slots no banco — a carga vai SOMAR, não substituir.`);
    console.log(`   Se a intenção é recarregar, rode --cleanup primeiro.`);
  }

  console.log(`\nTotal de escritas: ${writes.length}`);
  if (DRY_RUN) {
    console.log('\n[dry-run] nada foi gravado. Rode sem --dry-run para aplicar.');
    return;
  }
  console.log(`\nGravando em ${PROJECT}…`);
  await commit(writes);
  console.log('✓ carga concluída');

  const depois = await listAll('schedule_slots');
  console.log(`\nConferência: schedule_slots agora tem ${depois.length} docs`);
  console.log('\nPróximo passo: forçar a geração de aulas (generateClassesManual) — a agenda');
  console.log('dos professores só aparece depois disso.');
}

// ─── main ────────────────────────────────────────────────────────────────
(async () => {
  TOKEN = await getToken();
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`Projeto: ${PROJECT}${DRY_RUN ? '  [DRY-RUN]' : ''}${CLEANUP ? '  [CLEANUP]' : ''}`);
  console.log(`${'═'.repeat(72)}\n`);
  if (CLEANUP) await cleanup();
  else await carga();
})().catch(e => { console.error('\n✗ ERRO: ' + e.message); process.exit(1); });
