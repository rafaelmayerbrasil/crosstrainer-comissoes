'use strict';
// Ensaio:      node scripts/marcar-julho-realizada.js --project production
// Pra valer:   node scripts/marcar-julho-realizada.js --project production --executar
//
// As aulas de 29–31/07/2026 nasceram na carga inicial e ficaram paradas em
// 'prevista': o robô que confirma aula só age a partir de AUTO_CONFIRM_DESDE
// ('2026-08-01', functions/index.js) e o fechamento só conta 'realizada' ou
// 'substituida'. Ou seja, essa ponta de julho não entra em fechamento nenhum.
//
// A academia rodou normal em julho — o sistema é que entrou depois (carga
// inicial em 29/07). Decisão do Rafael em 21/08/2026: são aulas dadas.
//
// Sem --executar o script não grava nada: só mostra o que mexeria.
const admin = require('firebase-admin');
const path = require('path');

const args = process.argv.slice(2);
const projeto = args.includes('--project') ? args[args.indexOf('--project') + 1] : null;
const executar = args.includes('--executar');
if (!projeto) {
  console.error('Faltou --project <staging|production>');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))),
});
const db = admin.firestore();
const BR = 3; // BR é UTC-3, sem horário de verão desde 2019

(async () => {
  const de = new Date(Date.UTC(2026, 6, 1, BR, 0, 0));
  const ate = new Date(Date.UTC(2026, 7, 1, BR - 1, 59, 59));
  const snap = await db.collection('classes')
    .where('scheduledDate', '>=', de).where('scheduledDate', '<=', ate).get();

  const alvo = snap.docs.filter(d => d.data().status === 'prevista');
  const outros = snap.docs.length - alvo.length;
  console.log(`Projeto: ${projeto}`);
  console.log(`Julho/2026: ${snap.docs.length} aulas · ${alvo.length} em "prevista" · ${outros} em outro status (não serão tocadas)`);
  if (alvo.length === 0) { console.log('Nada a fazer.'); process.exit(0); }

  const porDia = {};
  const porProf = {};
  alvo.forEach(d => {
    const c = d.data();
    const dia = c.scheduledDate.toDate().toLocaleDateString('pt-BR');
    porDia[dia] = (porDia[dia] || 0) + 1;
    porProf[c.teacherId] = (porProf[c.teacherId] || 0) + 1;
  });
  console.log('Por dia:', JSON.stringify(porDia));

  // Nomes, pra conferência humana: quem vai passar a ter aula contada em julho.
  const profs = new Map((await db.collection('teachers').get()).docs.map(d => [d.id, d.data().name]));
  console.log('Por professor:');
  Object.entries(porProf).sort((a, b) => b[1] - a[1])
    .forEach(([id, n]) => console.log(`   ${String(n).padStart(3)} aulas · ${profs.get(id) || id}`));

  // Trava de segurança: aula já congelada num fechamento não se toca.
  const congeladas = alvo.filter(d => d.data().monthClosingId);
  if (congeladas.length) {
    console.error(`\n⛔ ${congeladas.length} aula(s) já estão em mês fechado. Abortando — fechamento é irreversível.`);
    process.exit(1);
  }

  if (!executar) {
    console.log('\n🔍 ENSAIO — nada foi gravado. Repita com --executar para valer.');
    process.exit(0);
  }

  let n = 0;
  for (let i = 0; i < alvo.length; i += 400) {
    const lote = db.batch();
    alvo.slice(i, i + 400).forEach(d => {
      lote.update(d.ref, {
        status: 'realizada',
        adjustmentNote: 'Confirmada em lote: julho anterior à entrada do sistema (decisão de 21/08/2026)',
        adjustedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      n++;
    });
    await lote.commit();
  }
  console.log(`\n✅ ${n} aulas de julho marcadas como realizadas.`);
  process.exit(0);
})().catch(e => { console.error('FALHA:', e.message); process.exit(1); });
