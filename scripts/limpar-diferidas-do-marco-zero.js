'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Tira de `comissoes_diferidas` o que nasceu no marco zero ou depois
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/limpar-diferidas-do-marco-zero.js --project staging
//   node scripts/limpar-diferidas-do-marco-zero.js --project production --aplicar
//
// SEM `--aplicar` não apaga nada: mostra o que sairia e sai.
//
// O diferimento foi encerrado em agosto/2026 (`CommissionEngine.FIM_DO_DIFERIMENTO`).
// Quando agosto for reprocessado, os contratos que estavam diferidos viram item
// normal e pagam comissão no mês do pagamento — como manda o regime de caixa.
//
// Os registros diferidos daquele mês precisam sair junto: senão o mesmo contrato
// fica com um item PAGO e um registro dizendo que foi ADIADO, dois documentos se
// contradizendo sobre o mesmo dinheiro.
//
// ⚠️ SÓ do marco zero em diante. Os registros anteriores FICAM — são o histórico
//    de uma regra que de fato valeu, em meses que já foram pagos, e o Rafael
//    decidiu em 09/09/2026 que o que ficou para trás não se mexe.
//
// Tudo que sair vai para `backups/` antes.
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const CE = require(path.join(__dirname, '..', 'commission.js'));

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const PROJETO = arg('--project');
const APLICAR = process.argv.includes('--aplicar');
if (!['staging', 'production'].includes(PROJETO)) {
  console.error('Uso: node scripts/limpar-diferidas-do-marco-zero.js --project staging|production [--aplicar]');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-' + PROJETO + '.json')) });
const db = admin.firestore();

const MARCO = CE.FIM_DO_DIFERIMENTO;   // '2026-08' — lido do motor, nunca redigitado aqui
const brl = n => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');
/** 'cp_2026-08' → '2026-08' */
const mesDe = periodId => (String(periodId || '').match(/(\d{4}-\d{2})$/) || [])[1] || '';

(async () => {
  console.log('\n=== Diferidas a partir de ' + MARCO + ' — ' + PROJETO
    + (APLICAR ? ' (APAGANDO)' : ' (simulação, nada será apagado)') + ' ===\n');

  const snap = await db.collection('comissoes_diferidas').get();
  const sair = [], ficam = [];
  snap.forEach(d => {
    const x = { _docId: d.id, ...d.data() };
    (mesDe(x.sourcePeriodId) >= MARCO ? sair : ficam).push(x);
  });

  console.log('  ' + ficam.length + ' registro(s) anteriores ao marco — ficam como histórico');
  if (!sair.length) { console.log('  nada a apagar.\n'); process.exit(0); }

  console.log('  ' + sair.length + ' registro(s) do marco em diante:\n');
  sair.forEach(x => console.log('   − ' + String(x.codigo || '?').padEnd(10)
    + ' · ' + String(x.cliente || '?').padEnd(34).slice(0, 34)
    + ' · pago ' + String(x.data || '?')
    + ' · comissão ' + brl(x.totalP1P2).padStart(11)
    + ' · ' + (x.vendedor || '?') + ' · ' + (x.sourcePeriodId || '?')));

  if (!APLICAR) {
    console.log('\n  Rode de novo com --aplicar para apagar.\n');
    process.exit(0);
  }

  const dir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const arquivo = path.join(dir, 'diferidas-apagadas-' + PROJETO + '-' + new Date().toISOString().slice(0, 10) + '.json');
  fs.writeFileSync(arquivo, JSON.stringify(sair, null, 2));
  console.log('\n  backup: ' + path.relative(path.join(__dirname, '..'), arquivo));

  for (const x of sair) {
    await db.collection('comissoes_diferidas').doc(x._docId).delete();
  }
  console.log('  ✅ ' + sair.length + ' registro(s) apagado(s).\n');
  process.exit(0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
