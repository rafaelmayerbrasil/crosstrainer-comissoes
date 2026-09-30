'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Proposta de meta de um mês, com os dados de verdade — SÓ LEITURA
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/propor-meta.js --mes 2026-10 [--project production|staging]
//        [--renov-cp 20 --renov-pp 13] [--formula rodrigo|media6]
//
// Monta a série dos meses da unidade (totais do período + "mês completo" pelo
// maior dia dos itens) e chama o mesmo metas-sugeridas.js que a tela usa. Sem
// --renov-XX, lê a lista de renovações do mês (Bloco 1), se existir. Não grava nada.

const path = require('path');
const admin = require('firebase-admin');
const MS = require(path.join(__dirname, '..', 'metas-sugeridas.js'));

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const MES = arg('--mes') || '2026-10';
const PROJ = arg('--project') || 'production';
const svc = require(path.join(__dirname, PROJ === 'staging' ? 'serviceAccount-staging.json' : 'serviceAccount-production.json'));
admin.initializeApp({ credential: admin.credential.cert(svc) });
const db = admin.firestore();

(async () => {
  const units = (await db.collection('units').get()).docs.map(d => d.id);
  for (const sigla of ['CP', 'PP']) {
    const unitId = units.find(id => id.toUpperCase().replace(/[^A-Z]/g, '').endsWith(sigla));
    const periodos = (await db.collection('periodos').where('unitId', '==', unitId).get()).docs;
    const serie = {}, metas = {};
    for (const p of periodos) {
      const m = p.id.match(/(\d{4}-\d{2})$/); if (!m || m[1] >= MES) continue;
      const d = p.data(); const t = d.totals || {};
      if (d.metasMensais && Object.keys(d.metasMensais).length) metas[m[1]] = d.metasMensais;
      if (typeof t.unitAtivacoes !== 'number') continue;
      const itens = (await db.collection('periodos').doc(p.id).collection('itens').where('type', '==', 'processed').get()).docs.map(x => x.data().data);
      const maior = MS.maiorData(itens);
      serie[m[1]] = { ativacoes: t.unitAtivacoes, novosRetorno: t.unitNovosRetorno || 0, renovacoes: t.unitRenovacoes || 0,
        vouchers: t.unitVouchers || 0, completo: MS.mesCompleto(m[1], maior), ate: maior };
    }
    let base = arg('--renov-' + sigla.toLowerCase());
    base = base != null ? Number(base) : null;
    if (base == null) {
      const l = await db.collection('renovacoes_lista').doc(sigla + '_' + MES).get();
      if (l.exists && l.data().situacao === 'ok') base = l.data().blocos.renovacoes.length;
    }
    const r = MS.sugerir({ mes: MES, serie, metasAnteriores: metas, renovacaoBase: base, formula: arg('--formula') || undefined });
    console.log(`\n=== ${sigla} ${MES} (${PROJ}) — renovações que vencem: ${base == null ? 'sem lista' : base}`);
    console.log('meses:', Object.keys(serie).sort().map(m => `${m}${serie[m].completo ? '' : '(parcial até ' + serie[m].ate + ')'}=${Math.round(serie[m].ativacoes)}`).join(' '));
    if (!r.confiavel) { console.log('NÃO PROPÕE:', r.porque.geral); continue; }
    Object.entries(r.campos).forEach(([k, v]) => console.log(`  ${k.padEnd(20)} ${String(v).padStart(4)}  — ${r.porque[k] || ''}`));
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
