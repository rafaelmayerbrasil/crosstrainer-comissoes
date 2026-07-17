'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Remove a unidade FICTÍCIA "unit-norte" do STAGING (na vida real só há CP e PP).
// Por padrão roda em DRY-RUN (só reporta). Para efetivar: --apply
//   node scripts/remove-unit-norte.js            (dry-run / relatório)
//   node scripts/remove-unit-norte.js --apply    (apaga de fato)
// ═══════════════════════════════════════════════════════════════════════
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-staging.json')) });
const db = admin.firestore();

const TARGET = 'unit-norte';
const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`\n=== ${APPLY ? 'APLICANDO REMOÇÃO' : 'DRY-RUN (só relatório)'} — unidade "${TARGET}" ===\n`);

  // 0) doc da unidade
  const unitRef = db.collection('units').doc(TARGET);
  const unitSnap = await unitRef.get();
  console.log(`units/${TARGET}: ${unitSnap.exists ? 'EXISTE (' + (unitSnap.data().name || '?') + ')' : 'não existe'}`);

  // 1) classes com unitId == target
  const cls = await db.collection('classes').where('unitId', '==', TARGET).get();
  console.log(`classes com unitId=${TARGET}: ${cls.size}`);

  // 2) teachers com unitIds array-contains target
  const teachers = await db.collection('teachers').where('unitIds', 'array-contains', TARGET).get();
  console.log(`teachers com a unidade: ${teachers.size}`);
  teachers.forEach(d => console.log(`   - ${d.id} ${d.data().name || ''} (primary=${d.data().primaryUnitId})`));

  // 3) users com allowedUnits array-contains target
  const users = await db.collection('users').where('allowedUnits', 'array-contains', TARGET).get();
  console.log(`users com allowedUnits incluindo a unidade: ${users.size}`);
  users.forEach(d => console.log(`   - ${d.id} ${d.data().email || ''} (unitId=${d.data().unitId})`));

  // 4) outras coleções referenciando por unitId
  for (const col of ['vacation_requests', 'special_scales']) {
    const s = await db.collection(col).where('unitId', '==', TARGET).get();
    console.log(`${col} com unitId=${TARGET}: ${s.size}`);
  }

  // 5) monthly_closings por prefixo do id
  const mc = await db.collection('monthly_closings').get();
  const mcHits = mc.docs.filter(d => d.id.startsWith(TARGET + '_'));
  console.log(`monthly_closings com id ${TARGET}_*: ${mcHits.length}`);

  // 6) special_scales com slot apontando pra unidade (slots = array no doc)
  const ss = await db.collection('special_scales').get();
  const ssHits = ss.docs.filter(d => Array.isArray(d.data().slots) && d.data().slots.some(sl => sl.unitId === TARGET));
  console.log(`special_scales com slot na unidade: ${ssHits.length}`);

  if (!APPLY) {
    console.log('\n>>> DRY-RUN. Nada foi alterado. Rode com --apply pra efetivar.\n');
    return;
  }

  console.log('\n--- aplicando ---');
  // a) apaga o doc da unidade
  if (unitSnap.exists) { await unitRef.delete(); console.log('✓ units/' + TARGET + ' apagada'); }

  // b) tira a unidade do allowedUnits/unitId de cada user
  for (const d of users.docs) {
    const data = d.data();
    const allowed = (data.allowedUnits || []).filter(u => u !== TARGET);
    const patch = { allowedUnits: allowed };
    if (data.unitId === TARGET) patch.unitId = allowed[0] || null;
    await d.ref.update(patch);
    console.log(`✓ user ${data.email} → allowedUnits=${JSON.stringify(allowed)}`);
  }

  // c) tira a unidade dos teachers
  for (const d of teachers.docs) {
    const data = d.data();
    const ids = (data.unitIds || []).filter(u => u !== TARGET);
    const patch = { unitIds: ids };
    if (data.primaryUnitId === TARGET) patch.primaryUnitId = ids[0] || null;
    await d.ref.update(patch);
    console.log(`✓ teacher ${data.name} → unitIds=${JSON.stringify(ids)}`);
  }

  // d) tira os slots da unidade das escalas demo (mantém CP/PP)
  for (const d of ssHits) {
    const slots = d.data().slots.filter(sl => sl.unitId !== TARGET);
    await d.ref.update({ slots });
    console.log(`✓ special_scales/${d.id} → ${slots.length} slots (Norte removida)`);
  }

  console.log('\n✓ Remoção concluída. (classes/fechamentos NÃO foram tocados; veja o relatório acima.)\n');
}

main().then(() => process.exit()).catch(e => { console.error(e); process.exit(1); });
