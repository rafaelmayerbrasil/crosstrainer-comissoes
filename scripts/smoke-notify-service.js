'use strict';
// Roda: node scripts/smoke-notify-service.js
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const NS = require('../notify-service.js');
const deps = (db) => ({ db, ts: () => 'TS' });

(async () => {
  // ── buildNotifDocs (puro) ──
  const docs = NS.buildNotifDocs({
    recipients: ['u1', 'u2'],
    type: 'scale_window_open',
    title: 'Janela aberta',
    body: 'Candidate-se até 20/07',
    link: { type: 'escala', id: 'b1' },
  });
  assert.strictEqual(docs.length, 2, 'um doc por destinatário');
  assert.strictEqual(docs[0].recipientUserId, 'u1');
  assert.strictEqual(docs[0].isRead, false, 'nasce não-lido');
  assert.strictEqual(docs[0].type, 'scale_window_open');
  assert.deepStrictEqual(docs[1].link, { type: 'escala', id: 'b1' });
  assert.deepStrictEqual(NS.buildNotifDocs({ recipients: [], type: 't' }), [], 'sem destinatário = vazio');
  console.log('✓ buildNotifDocs OK');

  // ── send inapp grava N docs em notifications ──
  const db = makeFakeDb();
  const d = deps(db);
  const r = await NS.send({ recipients: ['u1', 'u2'], type: 'scale_window_open', title: 'T', body: 'B', channels: ['inapp'] }, d);
  assert.ok(r.success && r.data.inapp === 2, 'gravou 2 notificações in-app');
  const all = await db.collection('notifications').get();
  assert.strictEqual(all.docs.length, 2, 'coleção notifications tem 2');
  assert.strictEqual(all.docs[0].data().isRead, false);
  console.log('✓ send inapp OK');

  // ── email é stub (não grava, não quebra) ──
  const r2 = await NS.send({ recipients: ['u1'], type: 't', channels: ['email'] }, d);
  assert.ok(r2.success && r2.data.email === 0, 'email é no-op nesta fase');
  console.log('✓ send email stub OK');

  // ── resolveActiveTeacherUserIds: teachers ativos → userIds ──
  await db.collection('teachers').doc('t1').set({ name: 'Ana', isActive: true, userId: 'uAna' });
  await db.collection('teachers').doc('t2').set({ name: 'Bia', isActive: true }); // sem userId → busca em users
  await db.collection('teachers').doc('t3').set({ name: 'Ex', isActive: false });  // inativo → fora
  await db.collection('users').doc('uBia').set({ professorId: 't2' });
  const ids = await NS.resolveActiveTeacherUserIds(d);
  assert.deepStrictEqual(ids.data.sort(), ['uAna', 'uBia'], 'resolve ativos com/sem userId, ignora inativo');
  console.log('✓ resolveActiveTeacherUserIds OK');

  // ── resolveManagementUserIds: admin/supervisao → userIds (Task 18, 28/08/2026) ──
  // Cobre os DOIS formatos reais achados em staging: `profiles[]` (canônico) e
  // `role` legado (singular, sem `profiles`) — os 12 docs de staging eram todos
  // do formato legado. `roles`/`perfil`/`admin_gestao` NÃO existem no schema
  // real; não são testados de propósito (apagados do código também).
  await db.collection('users').doc('uAdminNovo').set({ profiles: ['admin'], role: 'admin' });
  await db.collection('users').doc('uSuperNovo').set({ profiles: ['supervisao', 'professor'] });
  await db.collection('users').doc('uAdminLegado').set({ role: 'admin' }); // sem profiles[]
  await db.collection('users').doc('uProfessor').set({ role: 'professor' });
  await db.collection('users').doc('uVendedor').set({ role: 'vendedor' });
  const mgmt = await NS.resolveManagementUserIds(d);
  assert.ok(mgmt.success, 'resolveu com sucesso');
  assert.deepStrictEqual(mgmt.data.sort(), ['uAdminLegado', 'uAdminNovo', 'uSuperNovo'].sort(),
    'pega admin/supervisao nos dois formatos, ignora professor e vendedor');
  console.log('✓ resolveManagementUserIds OK');

  console.log('\n✅ smoke-notify-service: tudo OK');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
