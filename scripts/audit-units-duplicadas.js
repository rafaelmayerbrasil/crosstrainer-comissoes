'use strict';
// Inventário das units do staging: quais são referenciadas (users/teachers/periodos)
// e quais são cascas órfãs criadas pelo auto-create do loadUnitConfig (index.html:3705).
// Roda:  node scripts/audit-units-duplicadas.js             (só relatório)
//        node scripts/audit-units-duplicadas.js --delete    (apaga as órfãs seguras)
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-staging.json')) });
const db = admin.firestore();

(async () => {
  const [units, users, teachers, periodos] = await Promise.all([
    db.collection('units').get(),
    db.collection('users').get(),
    db.collection('teachers').get(),
    db.collection('periodos').get(),
  ]);

  // Referências de unit ids em todo lugar relevante
  const refs = new Map(); // unitId → [de onde]
  const addRef = (id, origem) => {
    if (!id) return;
    if (!refs.has(id)) refs.set(id, []);
    refs.get(id).push(origem);
  };
  users.forEach(d => {
    const u = d.data();
    (u.allowedUnits || []).forEach(id => addRef(id, 'users/' + (u.email || d.id) + '.allowedUnits'));
    addRef(u.unitId, 'users/' + (u.email || d.id) + '.unitId');
  });
  teachers.forEach(d => {
    const t = d.data();
    (t.unitIds || []).forEach(id => addRef(id, 'teachers/' + (t.name || d.id)));
    addRef(t.primaryUnitId, 'teachers/' + (t.name || d.id) + '.primary');
  });
  periodos.forEach(d => addRef(d.data().unitId, 'periodos/' + d.id));

  const rows = [];
  const orfas = [];
  units.forEach(d => {
    const u = d.data();
    const referencias = refs.get(d.id) || [];
    const casca = (u.name === 'CrossTainer CP') && u.isActive === undefined && !u.cnpj && !u.razaoSocial;
    const segura = casca && referencias.length === 0;
    rows.push({ id: d.id, name: u.name, isActive: u.isActive === undefined ? '(sem campo)' : u.isActive, refs: referencias.length, casca, apagavel: segura });
    if (segura) orfas.push(d.id);
  });
  console.table(rows);
  console.log('\nReferências detalhadas das units NÃO apagáveis com refs:');
  rows.filter(r => r.refs > 0).forEach(r => console.log(' ', r.id, '→', (refs.get(r.id) || []).slice(0, 5).join(' · ')));

  if (process.argv.includes('--delete')) {
    for (const id of orfas) {
      await db.collection('units').doc(id).delete();
      console.log('🗑️ apagada:', id);
    }
    console.log(`✓ ${orfas.length} casca(s) órfã(s) removida(s)`);
  } else {
    console.log(`\n${orfas.length} casca(s) órfã(s) apagável(is) com segurança. Rode com --delete pra remover.`);
  }
  process.exit();
})();
