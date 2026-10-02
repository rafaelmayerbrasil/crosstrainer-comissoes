'use strict';
// Repõe as aulas que o gerador semanal deixou de criar enquanto esteve travado
// (31/08 a 01/10/2026 — ver functions/class-candidates.js).
//
// Faz o que a Function faria, pelo MESMO laço e com o MESMO formato de aula
// (functions/class-candidates.js), numa janela que começa no passado:
//   · de --de (padrão 2026-09-01) até hoje: as aulas que deveriam existir e não
//     existem (em produção, as terças e quintas 13:30 da Thaynara);
//   · de hoje até 8 semanas à frente: a agenda que não foi gerada.
// Só cria o que FALTA: a identidade da aula é `{horário}_{AAAAMMDD}`, e o que
// já existe não é tocado.
//
// As aulas nascem PREVISTAS, como sempre. As que já passaram viram "realizada"
// na rotina das 3h da manhã (autoConfirmarAulas), pelo caminho normal.
//
// Agosto fica de fora de propósito (decisão do Rafael, 01/10/2026: "agosto ainda
// não entrou pra valer; começa em setembro").
//
// Uso:
//   node scripts/repor-aulas-nao-geradas.js --project staging            (só mostra)
//   node scripts/repor-aulas-nao-geradas.js --project production         (só mostra)
//   node scripts/repor-aulas-nao-geradas.js --project production --apply (grava)
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const C = require('../functions/class-candidates.js');
const escalaDia = require('../functions/escala-dia.js');

const arg = (nome, padrao) => { const i = process.argv.indexOf('--' + nome); return i === -1 ? padrao : process.argv[i + 1]; };
const projeto = arg('project', null);
const aplicar = process.argv.includes('--apply');
const de = arg('de', '2026-09-01');
const semanas = Number(arg('semanas', 8));
if (projeto !== 'staging' && projeto !== 'production') { console.error('Diga o projeto: --project staging | production'); process.exit(1); }
if (!/^\d{4}-\d{2}-\d{2}$/.test(de)) { console.error('--de no formato AAAA-MM-DD'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(require(`./serviceAccount-${projeto}.json`)) });
const db = admin.firestore();
const MARCA = 'gerador-travado-2026-10-01';   // para achar (e desfazer) o que este script criou
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

(async () => {
  const agora = new Date();
  const hoje = C.brComponents(agora);
  const hojeBR = C.brMidnightUTC(hoje.year, hoje.month, hoje.day);
  const hojeISO = C.ymdISOFromDateBR(agora);
  const [a, m, d] = de.split('-').map(Number);
  const inicio = C.brMidnightUTC(a, m - 1, d);
  const fim = C.fimDaJanela(hojeBR, semanas);
  console.log(`projeto: ${projeto} · janela: ${de} → ${C.ymdISOFromDateBR(fim)} · ${aplicar ? 'GRAVANDO' : 'só mostrando (sem --apply)'}\n`);

  // Os mesmos insumos que a Function lê
  const slots = (await db.collection('schedule_slots').where('isActive', '==', true).get()).docs.map(x => Object.assign({ id: x.id }, x.data()));
  const scalesByDate = escalaDia.montarMapa((await db.collection('special_scales').get()).docs.map(x => ({ id: x.id, data: x.data() })));
  const vacationDatesByTeacher = new Map();
  (await db.collection('vacation_requests').where('status', '==', 'aprovada').get()).docs.forEach(x => {
    const v = x.data();
    if (!v.teacherId || !Array.isArray(v.periods)) return;
    if (!vacationDatesByTeacher.has(v.teacherId)) vacationDatesByTeacher.set(v.teacherId, new Set());
    v.periods.forEach(p => {
      for (let t = p.startDate.toDate().getTime(); t <= p.endDate.toDate().getTime(); t += C.ONE_DAY_MS) {
        vacationDatesByTeacher.get(v.teacherId).add(C.ymdISOFromDateBR(new Date(t)));
      }
    });
  });
  const feriadosByDate = new Map();
  for (const ano of new Set([a, C.brComponents(fim).year])) {
    const cache = await db.collection('meta').doc(`holidays_cache_${ano}`).get();
    if (!cache.exists || !Array.isArray(cache.data().feriados)) { console.error(`Sem a lista de feriados de ${ano} no banco — não dá para marcar feriado direito. Parando.`); process.exit(1); }
    cache.data().feriados.forEach(f => feriadosByDate.set(f.date, f));
  }

  // O mesmo laço da Function. Sem o corte "aula de hoje que já acabou": aqui o
  // objetivo é justamente repor o que já passou.
  const r = C.comporCandidatos({ slots, inicio, fim, feriadosByDate, scalesByDate, vacationDatesByTeacher, hojeISO: null, agoraHHMM: null });

  const existentes = new Set();
  for (let i = 0; i < r.candidates.length; i += 300) {
    const refs = r.candidates.slice(i, i + 300).map(c => db.collection('classes').doc(c.classId));
    (await db.getAll(...refs)).forEach(s => { if (s.exists) existentes.add(s.id); });
  }
  const faltam = r.candidates.filter(c => !existentes.has(c.classId));
  const iso = (c) => C.ymdISOFromDateBR(c.date);
  const passadas = faltam.filter(c => iso(c) <= hojeISO);
  const futuras = faltam.filter(c => iso(c) > hojeISO);

  const nome = new Map((await db.collection('teachers').get()).docs.map(x => [x.id, x.data().name]));
  console.log(`horários ativos na grade: ${slots.length}`);
  console.log(`aulas que deveriam existir na janela: ${r.candidates.length} · já existem: ${existentes.size} · FALTAM: ${faltam.length}`);
  console.log(`(fora da conta — férias: ${r.vacationSkipped} · dia que é da escala: ${r.escalaSkipped})\n`);

  console.log(`ATRASADAS (até hoje, ${hojeISO}): ${passadas.length}`);
  passadas.sort((x, y) => iso(x).localeCompare(iso(y)) || x.slot.startTime.localeCompare(y.slot.startTime))
    .forEach(c => console.log(`   ${iso(c)} ${DIAS[C.brComponents(c.date).weekday]} ${c.slot.startTime}-${c.slot.endTime} · ${nome.get(c.slot.teacherId) || c.slot.teacherId} · ${c.slot.unitId}${c.extras.isHoliday ? ' · FERIADO ' + c.extras.holidayName : ''}`));

  const porSemana = {};
  futuras.forEach(c => { const t = new Date(c.date.getTime()); const wd = C.brComponents(t).weekday; t.setTime(t.getTime() - ((wd + 6) % 7) * C.ONE_DAY_MS); const k = C.ymdISOFromDateBR(t); porSemana[k] = (porSemana[k] || 0) + 1; });
  console.log(`\nFUTURAS (a agenda que não foi gerada): ${futuras.length}`);
  Object.keys(porSemana).sort().forEach(k => console.log(`   semana de ${k}: ${porSemana[k]}`));
  const feriadosFuturos = futuras.filter(c => c.extras.isHoliday);
  if (feriadosFuturos.length) console.log(`   das quais em feriado (marcadas, pagam em dobro): ${feriadosFuturos.length} — ${[...new Set(feriadosFuturos.map(c => iso(c) + ' ' + c.extras.holidayName))].join(' · ')}`);

  if (!aplicar) { console.log('\nNada foi gravado. Para gravar: --apply'); process.exit(0); }

  // cópia do que será criado, antes de gravar
  const pasta = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(pasta)) fs.mkdirSync(pasta);
  const arq = path.join(pasta, `aulas-repostas-${projeto}-${hojeISO}.json`);
  fs.writeFileSync(arq, JSON.stringify(faltam.map(c => ({ id: c.classId, dia: iso(c), inicio: c.slot.startTime, professor: c.slot.teacherId, unidade: c.slot.unitId })), null, 1));

  let gravadas = 0;
  for (let i = 0; i < faltam.length; i += 400) {
    const lote = db.batch();
    faltam.slice(i, i + 400).forEach(c => lote.create(db.collection('classes').doc(c.classId), Object.assign(C.dadosDaAula(c, 'script-reposicao'), {
      scheduledDate: admin.firestore.Timestamp.fromDate(c.date),
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      reposicao: MARCA,
    })));
    await lote.commit();   // `create` falha se a aula já existir: nunca sobrescreve
    gravadas += Math.min(400, faltam.length - i);
    console.log(`   gravadas ${gravadas}/${faltam.length}`);
  }
  console.log(`\n✓ ${gravadas} aulas criadas (marca reposicao='${MARCA}'). Lista em ${path.relative(process.cwd(), arq)}`);
  console.log('As que já passaram viram "realizada" na rotina das 3h da manhã.');
  process.exit(0);
})().catch(e => { console.error('ERRO', e.message); process.exit(1); });
