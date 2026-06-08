// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Migration audit_log: module 'professores' → 'agenda'
// Sprint 9 — Tech debt (Sprint 2/3a/3b entries legacy)
//
// Uso:
//   node scripts/migrate-audit-module.js --project staging [--apply]
//   node scripts/migrate-audit-module.js --project production [--apply]
//
// Sem --apply: modo dry-run (lista o que faria sem executar)
// ═══════════════════════════════════════════════════════════════════════

'use strict';

const admin = require('firebase-admin');
const path = require('path');

const args = process.argv.slice(2);
const projectArg = args.find(a => a.startsWith('--project='))?.split('=')[1]
  || (args.includes('--project') ? args[args.indexOf('--project') + 1] : null);
const apply = args.includes('--apply');

if (!projectArg) {
  console.error('Uso: node scripts/migrate-audit-module.js --project staging|production [--apply]');
  process.exit(1);
}

const projectId = projectArg === 'production'
  ? 'crosstrainer-comissoes'
  : 'crosstrainer-comissoes-staging';

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
    const snap = await db.collection('audit_log').where('module', '==', 'professores').get();
    console.log(`\nEncontradas ${snap.size} entries com module='professores' em ${projectId}`);

    if (snap.size === 0) {
      console.log('Nada a migrar.\n');
      await admin.app().delete();
      return;
    }

    if (!apply) {
      console.log('DRY-RUN — mostrando amostra das primeiras 5 entries:\n');
      snap.docs.slice(0, 5).forEach(d => {
        const a = d.data();
        const ts = a.timestamp ? a.timestamp.toDate().toISOString().slice(0, 19) : '?';
        console.log(`  [${ts}] ${a.type}: ${(a.details || '').slice(0, 100)}`);
      });
      console.log(`\nPasse --apply para executar a migration de ${snap.size} entries.\n`);
      await admin.app().delete();
      return;
    }

    // Batch updates (500 por batch)
    const BATCH_LIMIT = 500;
    let migrated = 0;
    for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      const chunk = snap.docs.slice(i, i + BATCH_LIMIT);
      for (const doc of chunk) {
        batch.update(doc.ref, { module: 'agenda' });
      }
      await batch.commit();
      migrated += chunk.length;
      console.log(`  ${migrated}/${snap.size} migrated`);
    }

    console.log(`\n✅ Migration completa: ${migrated} entries atualizadas de 'professores' → 'agenda'\n`);
  } catch (err) {
    console.error('❌ Erro:', err.message);
    process.exit(1);
  } finally {
    await admin.app().delete();
  }
})();
