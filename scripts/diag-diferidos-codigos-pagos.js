'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Quanto do estrago do "diferido fora de codigosPagos" está no banco HOJE
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/diag-diferidos-codigos-pagos.js --project production
//   node scripts/diag-diferidos-codigos-pagos.js --project staging
//
// ⚠️ SOMENTE LEITURA. Não grava nada, em projeto nenhum.
//
// Corrigir `codigosDeContrato` (08/09/2026) conserta o que for gravado daqui
// para a frente. O que já está no banco continua errado até alguém re-subir o
// arquivo do mês ou rodar `reconstruirCodigosPagos` — e é a lista gravada que a
// aba "A receber" lê para decidir quem "ainda não pagou".
//
// Este script mostra, período a período: quantos contratos DIFERIDOS existem
// nos itens, quantos deles faltam na lista gravada, e QUEM são — para a decisão
// de regravar ser tomada olhando nome e valor, não um número solto.
const admin = require('firebase-admin');

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const PROJETO = arg('--project');
if (!['staging', 'production'].includes(PROJETO)) {
  console.error('Uso: node scripts/diag-diferidos-codigos-pagos.js --project staging|production');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-' + PROJETO + '.json')) });
const db = admin.firestore();

const brl = n => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');

(async () => {
  console.log('\n=== Diferidos ausentes de `codigosPagos` — ' + PROJETO + ' (só leitura) ===\n');
  const periodos = await db.collection('periodos').get();
  const ordenados = periodos.docs.sort((a, b) => a.id.localeCompare(b.id));
  let totalFaltando = 0;

  for (const p of ordenados) {
    const gravados = new Set((p.data().codigosPagos || []).map(c => String(c).toUpperCase()));
    const itens = await db.collection('periodos').doc(p.id).collection('itens').get();

    const diferidos = [];
    itens.forEach(d => {
      const it = d.data();
      if (it.type !== 'deferred') return;
      const m = String(it.codigo || '').trim().match(/^C\d+/i);
      if (m) diferidos.push({ codigo: m[0].toUpperCase(), it });
    });
    if (!diferidos.length) continue;

    const faltando = diferidos.filter(d => !gravados.has(d.codigo));
    console.log(p.id + ': ' + itens.size + ' itens · ' + gravados.size + ' códigos gravados · '
      + diferidos.length + ' diferido(s), ' + faltando.length + ' fora da lista');
    faltando.forEach(({ codigo, it }) => {
      totalFaltando++;
      console.log('   ⚠️ ' + codigo + ' · ' + (it.cliente || '(sem nome)')
        + ' · ' + brl(it.valorQuitado || it.valor || 0)
        + ' · vendedor ' + (it.vendedor || '—')
        + (it.deferToMonth ? ' · comissão agendada para ' + it.deferToMonth : '')
        + (it.deferReason ? ' · ' + it.deferReason : ''));
    });
  }

  console.log('\n' + (totalFaltando
    ? totalFaltando + ' contrato(s) pago(s) que a tela ainda trata como "sem pagamento".\n'
      + 'Para corrigir, rode `reconstruirCodigosPagos(<periodId>)` — refaz a lista a partir\n'
      + 'dos itens, que são a fonte. Não recalcula comissão nem toca em pagamento.'
    : 'Nada a corrigir: nenhum diferido está fora da lista.') + '\n');
  process.exit(0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
