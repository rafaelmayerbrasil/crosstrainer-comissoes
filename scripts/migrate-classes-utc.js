// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Migration classes UTC midnight → BR midnight
// Sprint 9 — Tech debt (classes pré bug D fix, apenas staging)
//
// Uso:
//   node scripts/migrate-classes-utc.js --project staging [--apply]
//
// ABORTA se --project=production (produção nunca teve esse bug).
// ═══════════════════════════════════════════════════════════════════════

'use strict';

const admin = require('firebase-admin');
const path = require('path');

const args = process.argv.slice(2);
const projectArg = args.find(a => a.startsWith('--project='))?.split('=')[1]
  || (args.includes('--project') ? args[args.indexOf('--project') + 1] : null);
const apply = args.includes('--apply');

if (!projectArg) {
  console.error('Uso: node scripts/migrate-classes-utc.js --project staging [--apply]');
  process.exit(1);
}

if (projectArg === 'production') {
  console.error('❌ ABORTADO: Esta migration só se aplica a staging.');
  console.error('   Em produção as classes sempre foram geradas em horário BR (bug D fix estava ativo desde o início).');
  process.exit(1);
}

const projectId = 'crosstrainer-comissoes-staging';
const saPath = path.join(__dirname, `serviceAccount-${projectArg}.json`);
if (!require('fs').existsSync(saPath)) {
  console.error(`Service account não encontrado: ${saPath}`);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(saPath)),
  projectId,
});
const db = admin.firestore();

(async () => {
  try {
    // Busca classes com scheduledDate (pode levar tempo em staging com muitos dados)
    console.log('\nBuscando classes...');
    const snap = await db.collection('classes').get();
    const utcMidnight = snap.docs.filter(d => {
      const sd = d.data().scheduledDate;
      if (!sd || !sd.toDate) return false;
      const date = sd.toDate();
      return date.getUTCHours() === 0 && date.getUTCMinutes() === 0;
    });

    console.log(`Total classes: ${snap.size}`);
    console.log(`Classes com scheduledDate UTC midnight: ${utcMidnight.length}`);

    if (utcMidnight.length === 0) {
      console.log('Nada a migrar.\n');
      await admin.app().delete();
      return;
    }

    if (!apply) {
      console.log('DRY-RUN — mostrando amostra das primeiras 5:\n');
      utcMidnight.slice(0, 5).forEach(d => {
        const c = d.data();
        const oldDate = c.scheduledDate.toDate();
        const newDate = new Date(oldDate.getTime() + 3 * 60 * 60 * 1000);
        console.log(`  ${d.id}: ${oldDate.toISOString()} → ${newDate.toISOString()} (${c.teacherName || '?'} · ${c.modalityName || '?'})`);
      });
      console.log(`\nPasse --apply para migrar ${utcMidnight.length} classes.\n`);
      await admin.app().delete();
      return;
    }

    // Batch updates
    const BATCH_LIMIT = 500;
    let migrated = 0;
    for (let i = 0; i < utcMidnight.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      const chunk = utcMidnight.slice(i, i + BATCH_LIMIT);
      for (const doc of chunk) {
        const oldDate = doc.data().scheduledDate.toDate();
        const newDate = new Date(oldDate.getTime() + 3 * 60 * 60 * 1000);
        batch.update(doc.ref, { scheduledDate: admin.firestore.Timestamp.fromDate(newDate) });
      }
      await batch.commit();
      migrated += chunk.length;
      console.log(`  ${migrated}/${utcMidnight.length} migrated`);
    }

    console.log(`\n✅ Migration completa: ${migrated} classes atualizadas (UTC midnight → +3h)\n`);
  } catch (err) {
    console.error('❌ Erro:', err.message);
    process.exit(1);
  } finally {
    await admin.app().delete();
  }
})();
