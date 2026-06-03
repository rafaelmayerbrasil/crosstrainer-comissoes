// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Seed da coleção special_scale_types
//
// Cria os 4 tipos de escala especial pré-definidos da spec:
//   1. sabado            (peso 1)
//   2. feriado           (peso 2)
//   3. domingo_especial  (peso 3)
//   4. evento_especial   (peso 3)
//
// Idempotente: usa set() com merge — documentos existentes são atualizados.
//
// Uso:
//   node scripts/seed-special-scale-types.js --project staging
//   node scripts/seed-special-scale-types.js --project production
// ═══════════════════════════════════════════════════════════════════════

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

const args = process.argv.slice(2);
const projectArg = args.find(a => a.startsWith('--project='))
  || (args.includes('--project') ? args[args.indexOf('--project') + 1] : null);

if (!projectArg) {
  console.error('❌ Uso: node seed-special-scale-types.js --project <staging|production>');
  process.exit(1);
}

const projectId = projectArg === 'production'
  ? 'crosstrainer-comissoes'
  : 'crosstrainer-comissoes-staging';

const serviceAccountPath = path.join(__dirname, `serviceAccount-${projectArg}.json`);

if (!fs.existsSync(serviceAccountPath)) {
  console.error(`❌ Arquivo de credenciais não encontrado: ${serviceAccountPath}`);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
  projectId: projectId
});

const db = admin.firestore();

const SEED_DATA = [
  {
    id: 'sabado',
    name: 'Sábado',
    weight: 1,
    description: 'Sábados comuns — operação reduzida'
  },
  {
    id: 'feriado',
    name: 'Feriado',
    weight: 2,
    description: 'Feriados municipais, estaduais e nacionais'
  },
  {
    id: 'domingo_especial',
    name: 'Domingo Especial',
    weight: 3,
    description: 'Domingos com operação especial autorizada'
  },
  {
    id: 'evento_especial',
    name: 'Evento Especial',
    weight: 3,
    description: 'Eventos com operação especial autorizada'
  }
];

async function seed() {
  console.log(`🌱 Iniciando seed no projeto: ${projectId}`);

  const batch = db.batch();
  const colRef = db.collection('special_scale_types');

  SEED_DATA.forEach(item => {
    const ref = colRef.doc(item.id);
    batch.set(ref, {
      ...item,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });

  await batch.commit();

  console.log('✅ Seed concluído. Documentos criados/atualizados:');
  SEED_DATA.forEach(d => console.log(`   - ${d.id} (peso ${d.weight}) — ${d.name}`));

  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Falha no seed:', err);
  process.exit(1);
});
