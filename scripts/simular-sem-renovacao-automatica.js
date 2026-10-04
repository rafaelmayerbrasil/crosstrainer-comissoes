'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Renovação automática do plano recorrente fora da comissão — SÓ LEITURA
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/simular-sem-renovacao-automatica.js [--meses 2026-09,2026-10] [--project production]
//
// O robô da Pacto (`lancou = RECORRENCIA` no caderninho `pacto_contratos`) lança um
// contrato NOVO a cada mês para o plano recorrente, e ele entra na comissão como
// "Renovação" da consultora do aluno. Decisão do Rafael (04/10/2026): não conta.
// Este script recalcula o mês com o motor (a mesma conta do recálculo da tela) com
// e sem esses contratos, para ver o efeito antes de mexer em qualquer coisa.
// Imprime nomes das VENDEDORAS (equipe interna), nunca de alunos.

const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const CE = require(path.join(__dirname, '..', 'commission.js'));

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const MESES = (arg('--meses') || '2026-09,2026-10').split(',');
const projeto = arg('--project') || 'production';
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))) });
const db = admin.firestore();
const brl = v => 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');

function conta(processed, cfg) {
  const vendorData = CE.buildVendorData(processed, {}, cfg);
  const c = CE.contagensDaUnidade(processed, cfg.ativacoesAdiadas);
  CE.applyP3Pool(vendorData, c.unitAtivacoes, c.unitNovosRetorno, c.unitRenovacoes, c.unitVouchers, cfg);
  return { vendorData, c };
}
const faixa = (ativ, cfg) => (ativ >= cfg.metaGold ? 'Gold' : ativ >= cfg.superMeta ? 'Super' : ativ >= cfg.meta ? 'Meta' : 'abaixo da meta');

(async () => {
  const units = (await db.collection('units').get()).docs;
  for (const u of units) {
    const sigla = (u.id.toUpperCase().match(/(CP|PP)$/) || [])[1];
    if (!sigla) continue;
    const unitConfig = (u.data() || {}).config || {};
    for (const mes of MESES) {
      const pDoc = await db.collection('periodos').doc(u.id + '_' + mes).get();
      if (!pDoc.exists) continue;
      const p = pDoc.data();
      const processed = (await db.collection('periodos').doc(pDoc.id).collection('itens').where('type', '==', 'processed').get()).docs.map(d => d.data());
      // quem lançou cada contrato
      const robos = new Set();
      for (const x of processed) {
        const m = String(x.codigo || '').match(/^C(\d+)/);
        if (!m || !x.isContract || x.category !== 'renovacao') continue;
        const cad = (await db.collection('pacto_contratos').doc(sigla + '_' + m[1]).get()).data() || {};
        if (String(cad.lancou || '').trim().toUpperCase() === 'RECORRENCIA') robos.add(m[1]);
      }
      const ehRobo = x => { const m = String(x.codigo || '').match(/^C(\d+)/); return !!m && robos.has(m[1]); };
      const cfg = CE.configDoMes({ unitConfig, metasMensais: p.metasMensais, mes, minimosPorPessoa: p.minimosPorPessoa });
      const antes = conta(processed, cfg);
      const depois = conta(processed.filter(x => !ehRobo(x)), cfg);
      const linhasRobo = processed.filter(ehRobo);
      console.log(`\n=== ${sigla} ${mes} — contratos lançados pelo robô: ${robos.size} (${linhasRobo.length} linha(s))`
        + ` · faixas ${cfg.meta}/${cfg.superMeta}/${cfg.metaGold} · mínimos novos ${cfg.minNovos} · renov ${cfg.minRenov} · vouchers ${cfg.minVoucher}`);
      const f = r => `ativações ${CE.arredondaContagem(r.c.unitAtivacoes)} (${faixa(r.c.unitAtivacoes, cfg)}) · novos+retorno ${CE.arredondaContagem(r.c.unitNovosRetorno)} · renovações ${CE.arredondaContagem(r.c.unitRenovacoes)} · vouchers ${CE.arredondaContagem(r.c.unitVouchers)}`;
      console.log('  hoje:            ' + f(antes));
      console.log('  sem automáticas: ' + f(depois));
      const vs = p.vendorSummary || {};
      const nomes = [...new Set([...Object.keys(antes.vendorData), ...Object.keys(depois.vendorData)])].sort();
      let tA = 0, tD = 0;
      nomes.forEach(nome => {
        const a = antes.vendorData[nome] || {}, d = depois.vendorData[nome] || {};
        if (a.isNaoCom || d.isNaoCom) return;
        // P1 + P2 + P3 (o P4, da conversão de voucher, é calculado em outra etapa e não muda aqui)
        const tot = v => (Number(v.p1total) || 0) + (Number(v.p2total) || 0) + (Number(v.p3) || 0);
        const gravado = vs[nome] ? (Number(vs[nome].p1) || 0) + (Number(vs[nome].p2) || 0) + (Number(vs[nome].p3) || 0) : null;
        tA += tot(a); tD += tot(d);
        console.log(`  ${nome.padEnd(28)} ativ ${String(CE.arredondaContagem(a.ativacoes || 0)).padStart(5)} → ${String(CE.arredondaContagem(d.ativacoes || 0)).padStart(5)}`
          + ` · P1 ${brl(a.p1total)} → ${brl(d.p1total)} · P2 ${brl(a.p2total)} → ${brl(d.p2total)} · P3 ${brl(a.p3)} → ${brl(d.p3)}`
          + ` · total ${brl(tot(a))} → ${brl(tot(d))} (${brl(tot(d) - tot(a))})` + (gravado == null ? '' : ` · gravado (P1+P2+P3) ${brl(gravado)}`));
      });
      console.log(`  UNIDADE: ${brl(tA)} → ${brl(tD)} (${brl(tD - tA)})`);
    }
  }
  process.exit(0);
})().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
