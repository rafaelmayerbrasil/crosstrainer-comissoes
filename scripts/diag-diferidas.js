'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Tudo que está diferido hoje — quem, quanto, para quando
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/diag-diferidas.js --project production
//
// ⚠️ SOMENTE LEITURA.
//
// A regra do diferimento (commission.js): venda de ATIVAÇÃO cujo plano começa
// mais de 30 dias depois do pagamento não paga comissão no mês do pagamento —
// ela é empurrada para o mês em que o plano começa.
//
// A pergunta do Rafael em 09/09/2026: isso nasceu quando a comissão era do mês
// da VENDA. Sob regime de CAIXA, o dinheiro entrou — e a comissão é do mês em
// que ele entrou, paga no dia 15 do mês seguinte. Este script existe para a
// decisão ser tomada com o tamanho real do problema na mesa.
const admin = require('firebase-admin');

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const PROJETO = arg('--project');
if (!['staging', 'production'].includes(PROJETO)) {
  console.error('Uso: node scripts/diag-diferidas.js --project staging|production');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-' + PROJETO + '.json')) });
const db = admin.firestore();

const brl = n => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');

(async () => {
  console.log('\n=== Comissões diferidas — ' + PROJETO + ' (só leitura) ===\n');
  const snap = await db.collection('comissoes_diferidas').get();
  if (snap.empty) { console.log('nenhuma.\n'); process.exit(0); }

  const linhas = [];
  snap.forEach(d => linhas.push({ id: d.id, ...d.data() }));
  linhas.sort((a, b) => String(a.deferToMonth).localeCompare(String(b.deferToMonth)));

  let total = 0;
  const porMes = {}, porVendedor = {};
  linhas.forEach(l => {
    const c = Number(l.totalP1P2 || 0);
    total += c;
    porMes[l.deferToMonth] = (porMes[l.deferToMonth] || 0) + c;
    porVendedor[l.vendedor || '?'] = (porVendedor[l.vendedor || '?'] || 0) + c;
    console.log('  ' + String(l.deferToMonth).padEnd(9) + ' · ' + String(l.codigo || '').padEnd(9)
      + ' · ' + String(l.cliente || '?').padEnd(34).slice(0, 34)
      + ' · pago ' + String(l.data || '?').padEnd(11)
      + ' · comissão ' + brl(c).padStart(11)
      + ' · ' + (l.vendedor || '?')
      + ' · ' + (l.sourcePeriodId || '?'));
    if (l.deferReason) console.log('              ' + l.deferReason);
  });

  console.log('\n  ' + linhas.length + ' comissão(ões) diferida(s) · total ' + brl(total));
  console.log('\n  por mês de destino:');
  Object.keys(porMes).sort().forEach(m => console.log('    ' + m + ': ' + brl(porMes[m])));
  console.log('\n  por vendedora:');
  Object.entries(porVendedor).sort((a, b) => b[1] - a[1])
    .forEach(([v, c]) => console.log('    ' + v.padEnd(28) + brl(c)));

  // Quanto o diferimento adia hoje, em meses
  const hoje = new Date().toISOString().slice(0, 7);
  const futuras = linhas.filter(l => String(l.deferToMonth) > hoje);
  console.log('\n  ' + futuras.length + ' ainda no futuro (depois de ' + hoje + ')');
  console.log('');
  process.exit(0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
