// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Migração de users existentes para profiles[] e moduleAccess{}
//
// Lê todos os documentos de `users` e adiciona os campos novos:
//   - profiles[]:        derivado do role atual
//   - moduleAccess{}:    derivado do role atual
//
// Idempotente: documentos que já têm os campos novos são ignorados.
//
// Uso:
//   node scripts/migrate-users-to-profiles.js --project staging
//   node scripts/migrate-users-to-profiles.js --project production
//
// Pré-requisito: ter feito `firebase login` e ter um service account
//   - Baixar em: Firebase Console → Project Settings → Service Accounts
//   - Salvar como: scripts/serviceAccount-{project}.json (em .gitignore)
// ═══════════════════════════════════════════════════════════════════════

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

// ─── Parsing de args ─────────────────────────────────────────────────
const args = process.argv.slice(2);
const projectArg = args.find(a => a.startsWith('--project='))
  || (args.includes('--project') ? args[args.indexOf('--project') + 1] : null);

if (!projectArg) {
  console.error('❌ Uso: node migrate-users-to-profiles.js --project <staging|production>');
  process.exit(1);
}

const projectId = projectArg === 'production'
  ? 'crosstrainer-comissoes'
  : 'crosstrainer-comissoes-staging';

const serviceAccountPath = path.join(__dirname, `serviceAccount-${projectArg}.json`);

if (!fs.existsSync(serviceAccountPath)) {
  console.error(`❌ Arquivo de credenciais não encontrado: ${serviceAccountPath}`);
  console.error('   Baixar em: Firebase Console → Settings → Service Accounts → Generate new key');
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: projectId
});

const db = admin.firestore();

// ─── Lógica de inferência de profiles e moduleAccess ──────────────────
function inferFromRole(role) {
  switch (role) {
    case 'admin':
      return {
        profiles: ['admin'],
        moduleAccess: { comissoes: true, professores: true }
      };
    case 'vendedor':
      return {
        profiles: ['vendedor'],
        moduleAccess: { comissoes: true, professores: false }
      };
    default:
      return {
        profiles: [role],
        moduleAccess: { comissoes: false, professores: false }
      };
  }
}

// ─── Migração ─────────────────────────────────────────────────────────
async function migrate() {
  console.log(`🔍 Conectando ao projeto: ${projectId}`);
  const snapshot = await db.collection('users').get();

  if (snapshot.empty) {
    console.log('ℹ️  Coleção users está vazia. Nada a fazer.');
    return;
  }

  let migrated = 0;
  let skipped  = 0;
  let errored  = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    if (data.profiles && data.moduleAccess) {
      console.log(`⏭️  ${doc.id} já migrado, pulando.`);
      skipped++;
      continue;
    }

    if (!data.role) {
      console.warn(`⚠️  ${doc.id} sem campo role — pulando.`);
      errored++;
      continue;
    }

    try {
      const inferred = inferFromRole(data.role);
      await doc.ref.update({
        profiles: inferred.profiles,
        moduleAccess: inferred.moduleAccess,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log(`✅ ${doc.id} (${data.role}) → profiles=${JSON.stringify(inferred.profiles)}`);
      migrated++;
    } catch (err) {
      console.error(`❌ Erro ao migrar ${doc.id}:`, err.message);
      errored++;
    }
  }

  console.log('');
  console.log('═════════════════════════════════════════');
  console.log(`Migração concluída no projeto: ${projectId}`);
  console.log(`✅ Migrados: ${migrated}`);
  console.log(`⏭️  Pulados (já migrados): ${skipped}`);
  console.log(`❌ Erros: ${errored}`);
  console.log('═════════════════════════════════════════');

  process.exit(errored > 0 ? 1 : 0);
}

migrate().catch(err => {
  console.error('❌ Falha catastrófica:', err);
  process.exit(1);
});
