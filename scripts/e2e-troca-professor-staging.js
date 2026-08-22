'use strict';
// Roda: node scripts/e2e-troca-professor-staging.js
//
// Prova que a Cloud Function processSubstitutionAcceptance funciona DE VERDADE
// com o degrau novo da gestão — não que o código está escrito certo, mas que ele
// dispara e faz o que promete. Os smokes são estruturais; este acompanha o dado.
//
// O que verifica, em ordem:
//   1. pending → aguardando_gestao NÃO move a aula (o degrau existe mesmo)
//   2. ...e avisa a gestão (a CF encontra os admins pelo servidor)
//   3. aguardando_gestao → accepted MOVE a aula e preserva originalTeacherId
//   4. ...e avisa os DOIS professores
//   5. a marca de "homologada sem a resposta do professor" chega na aula
//
// Cria a própria fixture e apaga tudo no fim, inclusive se falhar.
const admin = require('firebase-admin');

admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-staging.json')) });
const db = admin.firestore();

const PREFIXO = 'e2etroca';
const criados = { classes: [], substitutions: [], notifications: [] };
let falhas = 0;

const ok = (nome) => console.log(`  ✓ ${nome}`);
const erro = (nome, detalhe) => { falhas++; console.log(`  ✗ ${nome} — ${detalhe}`); };

/** A CF é assíncrona: espera a condição virar verdade, ou desiste. */
async function esperar(descricao, condicao, tentativas = 30) {
  for (let i = 0; i < tentativas; i++) {
    if (await condicao()) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`     (esgotou a espera por: ${descricao})`);
  return false;
}

async function notifsDoPedido(subId) {
  const snap = await db.collection('notifications').where('link.id', '==', subId).get();
  snap.docs.forEach(d => { if (!criados.notifications.includes(d.id)) criados.notifications.push(d.id); });
  return snap.docs.map(d => d.data());
}

async function notifsDaAula(classId) {
  const snap = await db.collection('notifications').where('link.id', '==', classId).get();
  snap.docs.forEach(d => { if (!criados.notifications.includes(d.id)) criados.notifications.push(d.id); });
  return snap.docs.map(d => d.data());
}

(async () => {
  try {
    // ─── Fixture ──────────────────────────────────────────────────────
    const titular = { teacherId: `${PREFIXO}_theo`, userId: `${PREFIXO}_uidtheo` };
    const cobriu = { teacherId: `${PREFIXO}_camila`, userId: `${PREFIXO}_uidcamila` };

    const classId = `${PREFIXO}_aula_${Date.now()}`;
    await db.collection('classes').doc(classId).set({
      teacherId: titular.teacherId,
      originalTeacherId: titular.teacherId,
      scheduledDate: new Date(Date.UTC(2026, 7, 20, 21, 0, 0)),
      startTime: '18:00', endTime: '19:00', durationMinutes: 60,
      modalityId: `${PREFIXO}_mod`, unitId: `${PREFIXO}_unidade`,
      status: 'realizada', monthClosingId: null,
    });
    criados.classes.push(classId);

    const subRef = db.collection('substitutions').doc(`${PREFIXO}_sub_${Date.now()}`);
    await subRef.set({
      classId,
      classDate: new Date(Date.UTC(2026, 7, 20, 21, 0, 0)),
      classStartTime: '18:00', classEndTime: '19:00',
      requestingTeacherId: titular.teacherId, requestingUserId: titular.userId,
      substituteTeacherId: cobriu.teacherId, substituteUserId: cobriu.userId,
      registradoPor: 'substituto',
      reason: 'E2E automatizado',
      status: 'pending', wasRetroactive: true, isOfficial: false,
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      semConfirmacaoDoProfessor: false, atorEhParte: false,
    });
    criados.substitutions.push(subRef.id);
    console.log(`Fixture criada (aula ${classId})\n`);

    // ─── 1. O titular confirma: NÃO pode mover a aula ─────────────────
    await subRef.update({ status: 'aguardando_gestao', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    await new Promise(r => setTimeout(r, 8000)); // dá tempo da CF rodar, se fosse rodar

    let cls = (await db.collection('classes').doc(classId).get()).data();
    if (cls.teacherId === titular.teacherId && cls.status === 'realizada') {
      ok('confirmar NÃO move a aula — o degrau da gestão existe de verdade');
    } else {
      erro('confirmar NÃO move a aula', `a aula virou teacherId=${cls.teacherId} status=${cls.status}`);
    }

    // ─── 2. ...mas avisa a gestão ─────────────────────────────────────
    const achouAviso = await esperar('aviso pra gestão', async () => {
      const ns = await notifsDoPedido(subRef.id);
      return ns.some(n => n.type === 'substitution_aguardando_gestao');
    });
    if (achouAviso) {
      const ns = await notifsDoPedido(subRef.id);
      const avisos = ns.filter(n => n.type === 'substitution_aguardando_gestao');
      const titulos = [...new Set(avisos.map(n => n.title))];
      ok(`gestão avisada pelo servidor (${avisos.length} destinatário(s), título "${titulos.join('/')}")`);
      if (titulos.includes('Notificação')) {
        erro('título da notificação', 'saiu genérico — NOTIF_TYPE_TITLES não conhece o tipo novo');
      }
    } else {
      erro('gestão avisada', 'nenhuma notificação substitution_aguardando_gestao apareceu');
    }

    // ─── 3. A gestão homologa: AGORA move ─────────────────────────────
    await subRef.update({
      status: 'accepted',
      isOfficial: true,
      homologadoPor: `${PREFIXO}_uidadmin`,
      homologadoEm: admin.firestore.FieldValue.serverTimestamp(),
      semConfirmacaoDoProfessor: false,
      updatedBy: `${PREFIXO}_uidadmin`,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const moveu = await esperar('aula trocar de dono', async () => {
      const c = (await db.collection('classes').doc(classId).get()).data();
      return c.teacherId === cobriu.teacherId;
    });
    cls = (await db.collection('classes').doc(classId).get()).data();
    if (moveu) {
      ok(`homologar move a aula (agora é de ${cls.teacherId}, status=${cls.status})`);
    } else {
      erro('homologar move a aula', `continuou com teacherId=${cls.teacherId}`);
    }
    if (cls.originalTeacherId === titular.teacherId) {
      ok('originalTeacherId preservado — o titular não some do histórico');
    } else {
      erro('originalTeacherId preservado', `virou ${cls.originalTeacherId}`);
    }
    if (/gestão/i.test(cls.adjustmentNote || '')) {
      ok(`a aula registra como foi decidido: "${cls.adjustmentNote}"`);
    } else {
      erro('adjustmentNote', `veio "${cls.adjustmentNote}"`);
    }

    // ─── 4. Os dois professores avisados ──────────────────────────────
    await esperar('avisos do aceite', async () => {
      const ns = await notifsDaAula(classId);
      return ns.filter(n => n.type === 'substitution_accepted').length >= 2;
    });
    const nsAula = await notifsDaAula(classId);
    const aceites = nsAula.filter(n => n.type === 'substitution_accepted');
    const destinos = [...new Set(aceites.map(n => n.recipientUserId))].sort();
    if (destinos.includes(titular.userId) && destinos.includes(cobriu.userId)) {
      ok('os DOIS professores avisados da confirmação');
    } else {
      erro('os dois avisados', `foram avisados: ${JSON.stringify(destinos)}`);
    }

  } catch (e) {
    falhas++;
    console.error('  ✗ EXPLODIU:', e.message);
  } finally {
    // ─── Limpeza ──────────────────────────────────────────────────────
    for (const id of criados.substitutions) await db.collection('substitutions').doc(id).delete();
    for (const id of criados.classes) await db.collection('classes').doc(id).delete();
    for (const id of criados.notifications) await db.collection('notifications').doc(id).delete();
    // Varredura extra: notificação que a CF criou depois da última leitura
    for (const subId of criados.substitutions) {
      const s = await db.collection('notifications').where('link.id', '==', subId).get();
      for (const d of s.docs) await d.ref.delete();
    }
    for (const cid of criados.classes) {
      const s = await db.collection('notifications').where('link.id', '==', cid).get();
      for (const d of s.docs) await d.ref.delete();
    }
    console.log(`\nLimpeza: ${criados.substitutions.length} pedido(s), ${criados.classes.length} aula(s), notificações removidas`);
    console.log(falhas === 0 ? '\n✅ E2E passou — a CF faz o que promete' : `\n❌ ${falhas} falha(s)`);
    process.exit(falhas === 0 ? 0 : 1);
  }
})();
