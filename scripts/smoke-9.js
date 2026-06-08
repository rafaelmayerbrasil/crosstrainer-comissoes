// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Smoke test Sprint 9 (Polimentos Finais)
//
// Uso:
//   node scripts/smoke-9.js --project staging
// ═══════════════════════════════════════════════════════════════════════

'use strict';

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const projectArg = args.find(a => a.startsWith('--project='))?.split('=')[1]
  || (args.includes('--project') ? args[args.indexOf('--project') + 1] : null);

if (!projectArg) {
  console.error('Uso: node scripts/smoke-9.js --project staging');
  process.exit(1);
}

const projectId = projectArg === 'production'
  ? 'crosstrainer-comissoes'
  : 'crosstrainer-comissoes-staging';

const saPath = path.join(__dirname, `serviceAccount-${projectArg}.json`);
admin.initializeApp({
  credential: admin.credential.cert(require(saPath)),
  projectId,
});
const db = admin.firestore();

(async () => {
  console.log('\n══════ SMOKE TEST Sprint 9 — Polimentos Finais ══════\n');

  // C2: audit_log com module='professores' → deve ter 0 (após migration)
  const auditLegacy = await db.collection('audit_log').where('module', '==', 'professores').limit(5).get();
  console.log(`C2: audit_log module='professores': ${auditLegacy.size} entries ${auditLegacy.size === 0 ? '✅' : '⚠️ (rodar migrate-audit-module.js --apply)'}`);

  // C4: vendor/ tem 5 arquivos
  const vendorDir = path.join(__dirname, '..', 'vendor');
  const vendorFiles = fs.existsSync(vendorDir) ? fs.readdirSync(vendorDir).filter(f => f.endsWith('.js')) : [];
  const expectedLibs = ['xlsx.full.min.js', 'jspdf.umd.min.js', 'jspdf.plugin.autotable.min.js', 'jszip.min.js', 'html2canvas.min.js'];
  const missingLibs = expectedLibs.filter(f => !vendorFiles.includes(f));
  console.log(`C4: vendor/ tem ${vendorFiles.length} arquivos .js ${missingLibs.length === 0 ? '✅' : '❌ Faltando: ' + missingLibs.join(', ')}`);

  // C3: classes com scheduledDate UTC midnight (em staging, deve ser 0 após migration)
  const classSnap = await db.collection('classes').limit(200).get();
  const utcMidnightCount = classSnap.docs.filter(d => {
    const sd = d.data().scheduledDate;
    return sd && sd.toDate && sd.toDate().getUTCHours() === 0;
  }).length;
  console.log(`C3: classes UTC midnight (amostra 200): ${utcMidnightCount} ${utcMidnightCount === 0 ? '✅' : '⚠️ (rodar migrate-classes-utc.js --apply)'}`);

  // C7: empty state — verifica se teachers e vacation_requests são acessíveis
  const tSnap = await db.collection('teachers').where('isActive', '==', true).get();
  const vSnap = await db.collection('vacation_requests').get();
  console.log(`C7: collections acessíveis: teachers=${tSnap.size} · vacation_requests=${vSnap.size} ✅`);

  console.log('\n══════ FIM SMOKE TEST Sprint 9 ══════');
  console.log('Validação completa requer browser: recibo R4, acentos, empty states, branding, CDN fallback\n');

  await admin.app().delete();
})().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
