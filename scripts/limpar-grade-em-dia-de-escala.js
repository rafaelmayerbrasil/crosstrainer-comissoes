'use strict';
// Ensaio:    node scripts/limpar-grade-em-dia-de-escala.js --project production
// Pra valer: node scripts/limpar-grade-em-dia-de-escala.js --project production --executar
//
// Tira da agenda as aulas da GRADE normal que caíram em dias que pertencem a
// uma escala (sábado / feriado / domingo especial).
//
// Por que existiam: o gerador de aulas nunca enxergou a Escala Inteligente
// (procurava `isActive`+`unitIds`, formato que ela não grava) e, mesmo se
// enxergasse, só usava a escala como etiqueta — nunca deixou de gerar a grade.
// Em produção isso pôs 78 aulas de segunda-feira comum em cada feriado
// nacional e 2 professores por modalidade em cada sábado.
//
// Decisão do Rafael em 22/08/2026: "feriado só a escala e sábado tira da
// grade". As vagas fixas de sábado saem da grade por outro script
// (--desativar-sabados aqui embaixo); este limpa as aulas já geradas.
//
// NUNCA toca em aula de mês fechado, nem em aula que veio da própria escala.
// Sempre grava backup antes de apagar.
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const escalaDia = require('../functions/escala-dia.js');

const args = process.argv.slice(2);
const projeto = args.includes('--project') ? args[args.indexOf('--project') + 1] : null;
const executar = args.includes('--executar');
const desativarSabados = args.includes('--desativar-sabados');
if (!projeto) { console.error('Faltou --project <staging|production>'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))) });
const db = admin.firestore();
const BR = 3;

(async () => {
  const teachers = new Map((await db.collection('teachers').get()).docs.map(d => [d.id, d.data().name]));
  const nome = id => teachers.get(id) || '—';

  // 1) Quais dias pertencem a uma escala
  const snap = await db.collection('special_scales').get();
  const mapa = escalaDia.montarMapa(snap.docs.map(d => ({ id: d.id, data: d.data() })));
  const donos = [...mapa.entries()].filter(([, e]) => escalaDia.ehDonaDoDia(e));

  console.log(`Projeto: ${projeto}`);
  console.log(`Escalas lidas: ${snap.size} · pares dia+unidade que são DA ESCALA: ${donos.length}`);
  const porDia = {};
  donos.forEach(([k, e]) => {
    const [ymd, unit] = k.split('_');
    (porDia[ymd] = porDia[ymd] || { tipo: e.tipo, unidades: [] }).unidades.push(unit);
  });
  Object.entries(porDia).sort().forEach(([ymd, v]) =>
    console.log(`   ${ymd} (${v.tipo}) → ${v.unidades.join(', ')}`));

  // 2) Aulas da grade nesses dias
  const aApagar = [];
  for (const [ymd, v] of Object.entries(porDia)) {
    const [y, m, d] = ymd.split('-').map(Number);
    const de = new Date(Date.UTC(y, m - 1, d, BR, 0, 0));
    const ate = new Date(Date.UTC(y, m - 1, d, 23 + BR, 59, 59));
    const cls = (await db.collection('classes').where('scheduledDate', '>=', de).where('scheduledDate', '<=', ate).get()).docs;
    cls.forEach(doc => {
      const c = doc.data();
      if (c.specialScaleId) return;                    // veio da escala: fica
      if (!v.unidades.includes(c.unitId)) return;      // unidade sem escala: fica
      if (c.monthClosingId) return;                    // mês fechado: intocável
      aApagar.push({ ref: doc.ref, id: doc.id, ymd, tipo: v.tipo, c });
    });
  }

  const min = aApagar.reduce((s, x) => s + (x.c.durationMinutes || 0), 0);
  console.log(`\n=== AULAS DA GRADE A REMOVER: ${aApagar.length} (${(min / 60).toFixed(1)}h) ===`);
  const resumo = {};
  aApagar.forEach(x => { resumo[`${x.ymd} (${x.tipo})`] = (resumo[`${x.ymd} (${x.tipo})`] || 0) + 1; });
  Object.entries(resumo).sort().forEach(([k, n]) => console.log(`   ${String(n).padStart(3)} aulas · ${k}`));

  const congeladas = aApagar.filter(x => x.c.monthClosingId).length;
  if (congeladas) { console.error(`\n⛔ ${congeladas} em mês fechado. Abortando.`); process.exit(1); }

  // 3) Vagas fixas de sábado na grade
  const slots = (await db.collection('schedule_slots').get()).docs
    .filter(d => d.data().weekday === 6 && d.data().isActive !== false);
  console.log(`\n=== VAGAS DE SÁBADO NA GRADE (weekday 6, ativas): ${slots.length} ===`);
  slots.forEach(d => {
    const s = d.data();
    console.log(`   ${s.unitId} ${s.startTime}-${s.endTime} → ${nome(s.teacherId)} | id=${d.id}`);
  });
  if (slots.length && !desativarSabados) {
    console.log('   (rode com --desativar-sabados pra tirá-las da grade — sábado passa a ser só pela escala)');
  }

  if (!executar) {
    console.log('\n🔍 ENSAIO — nada foi gravado nem apagado. Repita com --executar para valer.');
    process.exit(0);
  }

  // 4) Backup e execução
  const dir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const arquivo = path.join(dir, `grade-em-dia-de-escala-${projeto}.json`);
  fs.writeFileSync(arquivo, JSON.stringify(aApagar.map(x => ({
    id: x.id, ymd: x.ymd, tipoEscala: x.tipo, ...x.c,
    scheduledDate: x.c.scheduledDate && x.c.scheduledDate.toDate ? x.c.scheduledDate.toDate().toISOString() : x.c.scheduledDate,
  })), null, 2), 'utf8');
  console.log(`\n💾 Backup: ${arquivo} (${aApagar.length} aulas)`);

  let n = 0;
  for (let i = 0; i < aApagar.length; i += 400) {
    const lote = db.batch();
    aApagar.slice(i, i + 400).forEach(x => { lote.delete(x.ref); n++; });
    await lote.commit();
  }
  console.log(`🗑️  ${n} aulas da grade removidas.`);

  if (desativarSabados && slots.length) {
    const lote = db.batch();
    slots.forEach(d => lote.update(d.ref, {
      isActive: false,
      inactivatedReason: 'Sábado passou a ser definido pela Escala Inteligente (decisão de 22/08/2026)',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }));
    await lote.commit();
    console.log(`🚫 ${slots.length} vagas fixas de sábado desativadas na grade.`);
  }

  process.exit(0);
})().catch(e => { console.error('FALHA:', e.message); process.exit(1); });
