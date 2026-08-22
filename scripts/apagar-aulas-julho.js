'use strict';
// Ensaio:    node scripts/apagar-aulas-julho.js --project production
// Pra valer: node scripts/apagar-aulas-julho.js --project production --executar
//
// As 74 aulas de 31/07/2026 ficaram paradas em 'prevista': o robô que confirma
// aula só age a partir de AUTO_CONFIRM_DESDE ('2026-08-01') e o fechamento só
// conta 'realizada'/'substituida'. A academia rodou normal em julho — o sistema
// é que entrou depois.
//
// Decisão do Rafael em 22/08/2026: apagar, não marcar. Marcar como "cancelada"
// registraria uma mentira (as aulas aconteceram); apagar diz "o sistema não tem
// registro desse dia", que é a verdade. E tira de vez o risco de alguém fechar
// julho e pagar de novo o que já foi pago por fora.
//
// Verificado antes de apagar: nenhum aviso de professor, nenhuma ocorrência,
// nenhuma substituição, notificação ou entrada de auditoria aponta pra elas.
// O robô de geração só cria pra frente, então não voltam sozinhas.
//
// Sempre grava o backup antes de apagar. Apagar no Firestore é definitivo.
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

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

  console.log(`Projeto: ${projeto}`);
  console.log(`Aulas de julho/2026 encontradas: ${snap.size}`);
  if (snap.empty) { console.log('Nada a fazer.'); process.exit(0); }

  const porDia = {};
  snap.docs.forEach(d => {
    const dia = d.data().scheduledDate.toDate().toLocaleDateString('pt-BR');
    porDia[dia] = (porDia[dia] || 0) + 1;
  });
  console.log('Por dia:', JSON.stringify(porDia));

  // Trava: aula congelada num fechamento não se toca, nem pra apagar.
  const congeladas = snap.docs.filter(d => d.data().monthClosingId);
  if (congeladas.length) {
    console.error(`\n⛔ ${congeladas.length} aula(s) estão em mês fechado. Abortando.`);
    process.exit(1);
  }

  if (!executar) {
    console.log('\n🔍 ENSAIO — nada foi gravado nem apagado. Repita com --executar para valer.');
    process.exit(0);
  }

  // ─── Backup ANTES de apagar ───────────────────────────────────────────
  const dir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const arquivo = path.join(dir, `julho-2026-aulas-apagadas-${projeto}.json`);
  const dump = snap.docs.map(d => {
    const c = d.data();
    return {
      id: d.id,
      ...c,
      // Timestamps do Firestore não sobrevivem ao JSON — guarda legível também.
      scheduledDate: c.scheduledDate && c.scheduledDate.toDate ? c.scheduledDate.toDate().toISOString() : c.scheduledDate,
    };
  });
  fs.writeFileSync(arquivo, JSON.stringify(dump, null, 2), 'utf8');
  console.log(`\n💾 Backup salvo: ${arquivo} (${dump.length} aulas)`);

  // ─── Apagar ───────────────────────────────────────────────────────────
  let n = 0;
  for (let i = 0; i < snap.docs.length; i += 400) {
    const lote = db.batch();
    snap.docs.slice(i, i + 400).forEach(d => { lote.delete(d.ref); n++; });
    await lote.commit();
  }
  console.log(`🗑️  ${n} aulas apagadas.`);

  // ─── Conferência ──────────────────────────────────────────────────────
  const conf = await db.collection('classes')
    .where('scheduledDate', '>=', de).where('scheduledDate', '<=', ate).get();
  console.log(`\n✅ Conferência: restam ${conf.size} aulas em julho/2026 (esperado: 0)`);
  process.exit(conf.size === 0 ? 0 : 1);
})().catch(e => { console.error('FALHA:', e.message); process.exit(1); });
