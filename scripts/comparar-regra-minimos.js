'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Prova da regra nova do bônus contra a PRODUÇÃO — SÓ LEITURA
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/comparar-regra-minimos.js [--meses 2026-07,2026-08,2026-09]
//        [--minimos "ERICA=18,FRANCINI=12,KALI=18,ISA=12"]
//
// 1. Recalcula cada mês com o motor ATUAL (mesma conta do recalculatePeriod do
//    index.html) e compara o P3 de cada vendedora com o gravado: tem que dar
//    igual — a regra nova não pode mexer em mês passado.
// 2. Mostra como o mesmo mês teria ficado com a regra nova (100/50/0) e os
//    mínimos por pessoa — só para o Rafael e o Rodrigo verem em reais.
// Imprime nomes das VENDEDORAS (equipe interna), nunca de alunos.

const path = require('path');
const admin = require('firebase-admin');
const CE = require(path.join(__dirname, '..', 'commission.js'));

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const MESES = (arg('--meses') || '2026-07,2026-08,2026-09').split(',');
const MINIMOS = Object.fromEntries((arg('--minimos') || 'ERICA=18,FRANCINI=12,KALI=18,ISA=12').split(',').map(x => { const [k, v] = x.split('='); return [k.trim(), Number(v)]; }));
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccount-production.json'))) });
const db = admin.firestore();
const brl = v => 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');

/** A mesma conta do recalculatePeriod (index.html): vendorData + totais da unidade + rateio do P3. */
function p3DoMes(processed, cfg) {
  const vendorData = CE.buildVendorData(processed, {}, cfg);
  const c = CE.contagensDaUnidade(processed, cfg.ativacoesAdiadas);   // a mesma soma do recálculo
  const u = { ativ: c.unitAtivacoes, novos: c.unitNovosRetorno, renov: c.unitRenovacoes, vouch: c.unitVouchers };
  CE.applyP3Pool(vendorData, u.ativ, u.novos, u.renov, u.vouch, cfg);
  return { vendorData, u };
}

(async () => {
  let diferencas = 0;
  for (const unit of ['cp', 'pp']) {
    const unitConfig = ((await db.collection('units').doc(unit).get()).data() || {}).config || {};
    for (const mes of MESES) {
      const pDoc = await db.collection('periodos').doc(unit + '_' + mes).get();
      if (!pDoc.exists) continue;
      const p = pDoc.data();
      const processed = (await db.collection('periodos').doc(pDoc.id).collection('itens').where('type', '==', 'processed').get()).docs.map(d => d.data());
      const cfgHoje = CE.configDoMes({ unitConfig, metasMensais: p.metasMensais, mes });
      const hoje = p3DoMes(processed, cfgHoje);
      const cfgNova = CE.configDoMes({ unitConfig, metasMensais: p.metasMensais, mes: '2026-10', minimosPorPessoa: MINIMOS });
      const nova = p3DoMes(processed, cfgNova);
      const vs = p.vendorSummary || {};
      console.log(`\n=== ${unit.toUpperCase()} ${mes} — ativações ${hoje.u.ativ} · novos ${hoje.u.novos} · renov ${hoje.u.renov} · vouchers ${hoje.u.vouch}` +
        ` (mínimos ${cfgHoje.minNovos}/${cfgHoje.minRenov}/${cfgHoje.minVoucher}; faixas ${cfgHoje.meta}/${cfgHoje.superMeta}/${cfgHoje.metaGold})`);
      const anyV = Object.values(nova.vendorData).find(v => !v.isNaoCom && v.p3detail);
      if (anyV) console.log('  regra nova diria:', (anyV.p3detail.motivos || []).filter(m => !/individual/.test(m)).join(' | ') || 'todos os mínimos batidos');
      Object.entries(hoje.vendorData).filter(([, v]) => !v.isNaoCom).sort().forEach(([nome, v]) => {
        const gravado = vs[nome] ? vs[nome].p3 : null;
        const igual = gravado != null && Math.abs((gravado || 0) - v.p3) < 0.01;
        if (!igual) diferencas++;
        const n = nova.vendorData[nome];
        console.log(`  ${nome.padEnd(28)} ${String(CE.arredondaContagem(v.ativacoes)).padStart(6)} ativ · P3 gravado ${brl(gravado)} · recalculado hoje ${brl(v.p3)} ${igual ? '✓' : '✗ DIFERENTE'} · com a regra nova ${brl(n.p3)} (mín. ${CE.minimoIndividual(nome, cfgNova)})`);
      });
    }
  }
  console.log(diferencas ? `\n✗ ${diferencas} vendedora(s) com P3 recalculado diferente do gravado` : '\n✅ os meses passados recalculam igual ao gravado');
  process.exit(diferencas ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
