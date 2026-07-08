// notify-service.js — camada de notificação (in-app hoje; e-mail é ponto de extensão)
// Grava no shape da coleção `notifications` que o sino (NotificationService) já lê.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NotifyService = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function rdb(deps) { if (deps && deps.db) return deps.db; return (typeof db !== 'undefined') ? db : null; }
  function rts(deps) { if (deps && deps.ts) return deps.ts(); return (typeof serverTs === 'function') ? serverTs() : new Date().toISOString(); }

  // PURO: monta os docs de notificação (1 por destinatário) no shape do sino.
  function buildNotifDocs({ recipients, type, title, body, link }) {
    return (recipients || []).map(uid => ({
      recipientUserId: uid,
      type: type || 'geral',
      title: title || 'Notificação',
      body: body || '',
      link: link || null,
      isRead: false,
      readAt: null,
    }));
  }

  // Resolve professores ativos → userIds (via teacher.userId OU users.professorId).
  async function resolveActiveTeacherUserIds(deps) {
    try {
      const database = rdb(deps);
      const snap = await database.collection('teachers').where('isActive', '==', true).get();
      const out = [];
      for (const doc of snap.docs) {
        const t = doc.data();
        let uid = t.userId || null;
        if (!uid) {
          const us = await database.collection('users').where('professorId', '==', doc.id).get();
          if (us.docs.length) uid = us.docs[0].id;
        }
        if (uid) out.push(uid);
      }
      return { success: true, data: out };
    } catch (err) { console.error('[NotifyService.resolveActiveTeacherUserIds]', err); return { success: false, error: err.message }; }
  }

  // Dispara para os canais pedidos. channels default ['inapp'].
  // 'email' é stub declarado: assinatura pronta, sem envio nesta fase.
  async function send({ recipients, type, title, body, link, channels }, deps) {
    try {
      const chs = channels && channels.length ? channels : ['inapp'];
      const result = { inapp: 0, email: 0 };
      if (chs.includes('inapp')) {
        const docs = buildNotifDocs({ recipients, type, title, body, link });
        const database = rdb(deps);
        for (const nd of docs) {
          await database.collection('notifications').add(Object.assign({}, nd, { createdAt: rts(deps) }));
          result.inapp++;
        }
      }
      // 'email': ponto de extensão — quando a infra de e-mail entrar, enfileirar aqui.
      return { success: true, data: result };
    } catch (err) { console.error('[NotifyService.send]', err); return { success: false, error: err.message }; }
  }

  return { buildNotifDocs, resolveActiveTeacherUserIds, send };
});
