'use strict';
// Ensaio:    node scripts/zerar-ajustes-partida.js --project staging
// Pra valer: node scripts/zerar-ajustes-partida.js --project staging --executar
//
// O "ajuste de partida" (fairness_counter.ajuste) foi aposentado em 28/08/2026:
// era um segundo caminho para o contador de justiça, e foi por ele que a Heloísa
// saiu de 4 para 7 sábados. Zerar aqui NÃO mexe em escala nenhuma — muda o
// número, não a escala. Nenhuma data é remontada, nenhuma aula sai da agenda,
// ninguém é reavisado (Rafael, 28/08: "não mexa em nada").
//
// Sem --executar, só mostra o que faria.
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const projeto = args.includes('--project') ? args[args.indexOf('--project') + 1] : null;
const executar = args.includes('--executar');
if (!projeto || (projeto !== 'staging' && projeto !== 'production')) {
  console.error('Faltou --project <staging|production>');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))),
});
const db = admin.firestore();

(async () => {
  const [snap, teachSnap] = await Promise.all([
    db.collection('fairness_counter').get(),
    db.collection('teachers').get(),
  ]);
  const nomes = {};
  teachSnap.docs.forEach(d => { nomes[d.id] = (d.data() || {}).name || d.id; });

  const aZerar = snap.docs
    .map(d => ({ id: (d.data() || {}).personId || d.id, ajuste: Number((d.data() || {}).ajuste) || 0 }))
    .filter(x => x.ajuste !== 0);

  console.log(`Projeto: ${projeto}`);
  if (!aZerar.length) { console.log('Nada a zerar: nenhum ajuste diferente de zero.'); process.exit(0); }

  console.log('Pessoa                          antes → depois');
  aZerar.forEach(x => console.log(`${(nomes[x.id] || x.id).padEnd(30)}  ${String(x.ajuste).padStart(3)} → 0`));
  console.log(`\n${aZerar.length} pessoa(s).`);

  if (!executar) {
    console.log('\n🔍 ENSAIO — nada foi gravado. Repita com --executar para valer.');
    process.exit(0);
  }

  // ─── Backup ANTES de gravar ────────────────────────────────────────────
  const dir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const arquivo = path.join(dir, `fairness-ajustes-${projeto}-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(arquivo, JSON.stringify(aZerar, null, 2), 'utf8');
  console.log(`💾 Backup salvo: ${arquivo}\n`);

  // ─── Zerar ──────────────────────────────────────────────────────────────
  for (const x of aZerar) {
    await db.collection('fairness_counter').doc(x.id)
      .set({ ajuste: 0, zeradoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
  console.log(`\n✅ ${aZerar.length} ajuste(s) zerado(s).`);

  // ─── Conferência ──────────────────────────────────────────────────────
  const conf = (await db.collection('fairness_counter').get()).docs
    .map(d => Number((d.data() || {}).ajuste) || 0)
    .filter(v => v !== 0);
  console.log(`\n✅ Conferência: restam ${conf.length} ajuste(s) diferente(s) de zero (esperado: 0)`);
  process.exit(conf.length === 0 ? 0 : 1);
})().catch(e => { console.error('FALHA:', e.message); process.exit(1); });
