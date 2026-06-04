// scripts/backfill-vacation-denorm.js
// Popula firstPeriodStart/lastPeriodEnd em vacation_requests legados do 6a.
// Idempotente: pula docs já preenchidos.
// Uso: node scripts/backfill-vacation-denorm.js --project staging

'use strict';
const admin = require('firebase-admin');
const path = require('path');

const args = process.argv.slice(2);
const projectArg = args.find(a => a.startsWith('--project='))?.split('=')[1]
  || (args.includes('--project') ? args[args.indexOf('--project') + 1] : null);

if (!projectArg || !['staging', 'production'].includes(projectArg)) {
  console.error('ERRO: informe --project staging ou --project production');
  process.exit(1);
}

const projectId = projectArg === 'production' ? 'crosstrainer-comissoes' : 'crosstrainer-comissoes-staging';
const credPath = path.join(__dirname, `serviceAccount-${projectArg}.json`);

admin.initializeApp({
  credential: admin.credential.cert(require(credPath)),
  projectId,
});

const db = admin.firestore();

(async () => {
  const snap = await db.collection('vacation_requests').get();
  let updated = 0, skipped = 0, errors = 0;

  for (const doc of snap.docs) {
    const d = doc.data();

    if (d.firstPeriodStart && d.lastPeriodEnd) {
      skipped++;
      continue;
    }
    if (!Array.isArray(d.periods) || d.periods.length === 0) {
      skipped++;
      continue;
    }

    try {
      const firstStart = d.periods.reduce((min, p) => {
        const ts = p.startDate;
        return (!min || ts.toMillis() < min.toMillis()) ? ts : min;
      }, null);
      const lastEnd = d.periods.reduce((max, p) => {
        const ts = p.endDate;
        return (!max || ts.toMillis() > max.toMillis()) ? ts : max;
      }, null);

      await doc.ref.update({
        firstPeriodStart: firstStart,
        lastPeriodEnd: lastEnd,
      });
      updated++;
      console.log(`  ✓ ${doc.id}: ${d.teacherName} · ${d.totalDays} dias`);
    } catch (err) {
      errors++;
      console.error(`  ✗ ${doc.id}: ${err.message}`);
    }
  }

  console.log(`\nBackfill concluído: ${updated} atualizados · ${skipped} pulados · ${errors} erros`);
  await admin.app().delete();
})();
