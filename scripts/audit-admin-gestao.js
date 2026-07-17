'use strict';
// Audita users com admin_gestao (role ou profiles) ANTES do deploy de rules.
// Roda: node scripts/audit-admin-gestao.js   (staging via serviceAccount-staging.json)
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-staging.json')) });

(async () => {
  const snap = await admin.firestore().collection('users').get();
  const hits = [];
  snap.forEach(d => {
    const u = d.data();
    const ps = Array.isArray(u.profiles) ? u.profiles : [];
    if (u.role === 'admin_gestao' || ps.includes('admin_gestao')) {
      hits.push({ id: d.id, email: u.email || '—', role: u.role || '—', profiles: ps.join(',') });
    }
  });
  if (hits.length === 0) {
    console.log('✓ Nenhum usuário com admin_gestao — remoção das rules é segura.');
  } else {
    console.log('⚠ Usuários com admin_gestao encontrados — DECIDIR migração com o cliente antes do deploy de rules:');
    console.table(hits);
    process.exitCode = 1;
  }
  process.exit();
})();
