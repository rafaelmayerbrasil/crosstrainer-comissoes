'use strict';
// ===================================================================
// Apaga os itens sobrando com motivo "Renovacao automatica"
// ===================================================================
//
//   node scripts/limpar-excluidos-renovacao-automatica.js --project staging
//   node scripts/limpar-excluidos-renovacao-automatica.js --project production --apply
//
// POR QUE EXISTE (07/09/2026)
//
// A regra que excluia linha por `Responsavel 2 = RECORRENCIA` foi aposentada —
// ver `pacto-adapter.js#ehCobrancaRecorrente`. Depois de re-subir agosto, as
// vendas de verdade voltaram como `processed`, mas os documentos ANTIGOS das
// cobrancas de robo continuaram gravados como `type: 'excluded'` com
// `excludeReason: 'Renovacao automatica'`. O dedup do upload so apaga item que
// ERA ativo e deixou de ser — item ja inativo fica onde esta.
//
// Eles nao entram em conta nenhuma (`recalculatePeriod` so toca em `processed`,
// e o `vendorSummary` vem do motor), mas aparecem na lista com o motivo de uma
// regra que nao existe mais. O motivo certo hoje seria "contrato ja pagou
// antes" — que e o que o tradutor escreve agora, no balde `jaPagos`.
//
// ⚠️ IRREVERSIVEL. Grava o conteudo inteiro de cada documento em `backups/`
//    antes de apagar, e registra no `audit_log`.
// ⚠️ Nao voltam num re-upload: o tradutor derruba essas linhas antes de virarem
//    venda, entao nao ha documento novo para recriar.
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const PROJETO = arg('--project');
const APLICAR = process.argv.includes('--apply');
if (!['staging', 'production'].includes(PROJETO)) {
  console.error('Uso: node scripts/limpar-excluidos-renovacao-automatica.js --project staging|production [--apply]');
  process.exit(1);
}

const MOTIVO = 'Renovação automática';

admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-' + PROJETO + '.json')) });
const db = admin.firestore();

(async () => {
  console.log('projeto: ' + PROJETO + (APLICAR ? '   MODO: APAGANDO' : '   MODO: so leitura (use --apply)'));

  const periodos = [];
  (await db.collection('periodos').get()).forEach(d => { if (/2026-08$/.test(d.id)) periodos.push(d.id); });

  const backupDir = path.join(__dirname, '..', 'backups');
  if (APLICAR && !fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const hoje = new Date().toISOString().slice(0, 10);
  let total = 0;

  for (const pid of periodos) {
    const ref = db.collection('periodos').doc(pid).collection('itens');
    const snap = await ref.get();
    const alvo = [];
    snap.forEach(d => {
      const x = d.data();
      if ((x.type || 'processed') === 'excluded' && String(x.excludeReason || '') === MOTIVO) {
        alvo.push({ id: d.id, ...x });
      }
    });

    console.log('\n--- ' + pid + ' ---');
    if (!alvo.length) { console.log('    nada a apagar'); continue; }
    alvo.forEach(a => console.log('    ' + a.id + '  ' + String(a.cliente).padEnd(36).slice(0, 36) +
      'R$ ' + String(a.valorCaixa).padStart(8) + '  ' + a.excludeReason));
    total += alvo.length;
    if (!APLICAR) continue;

    const arq = path.join(backupDir, 'itens-renovacao-automatica-' + pid + '-' + hoje + '.json');
    fs.writeFileSync(arq, JSON.stringify({ periodo: pid, itens: alvo }, null, 2));
    console.log('    backup: ' + path.relative(path.join(__dirname, '..'), arq));

    const batch = db.batch();
    alvo.forEach(a => batch.delete(ref.doc(a.id)));
    await batch.commit();

    await db.collection('audit_log').add({
      module: 'comissoes', action: 'settings_change',
      description: 'Apagados ' + alvo.length + ' itens de ' + pid + ' com excludeReason "' + MOTIVO +
        '" — sobra da regra aposentada em 07/09/2026 (ver pacto-adapter#ehCobrancaRecorrente). ' +
        'Clientes: ' + alvo.map(a => a.cliente).join(', ') + '. Backup em backups/.',
      userEmail: 'script:limpar-excluidos-renovacao-automatica',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('    apagados: ' + alvo.length);
  }

  console.log('\ntotal: ' + total + ' documentos' + (APLICAR ? ' apagados' : ' seriam apagados'));
  process.exit(0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
