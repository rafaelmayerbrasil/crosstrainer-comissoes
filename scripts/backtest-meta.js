'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Backtest das fórmulas de meta — SÓ LEITURA na produção
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/backtest-meta.js [--ate 2026-08]
//
// Parte B da spec docs/superpowers/specs/2026-09-29-renovacoes-metas-bonus-design.md §4.2.
// Para prever o mês M usa SÓ meses anteriores a M (walk-forward) e compara com
// as ativações que de fato aconteceram em M. Réguas:
//   • media6   — média dos 6 meses anteriores disponíveis (a de hoje, desenho de 10/09);
//   • rodrigo  — 50% mês anterior + 25% média dos 3 anteriores + 15% mesmo mês do
//                ano anterior, reescalado pelos 90% (os 10% de "ajuste" são a
//                revisão da gestão, que não é conta);
//   • rodrigoSemAno — a mesma sem o mesmo mês do ano anterior (50/25 → reescalado).
// Só compara meses em que TODAS as réguas conseguem calcular — senão uma ganha
// por ter errado menos meses. Não imprime nada além de números por unidade/mês.

const path = require('path');
const admin = require('firebase-admin');

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const ATE = arg('--ate') || '2026-08';     // último mês fechado a prever

function mesMenos(mes, n) {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 - n, 1)).toISOString().slice(0, 7);
}
const media = xs => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Réguas puras: `serie` = { 'AAAA-MM': ativações } só com meses ANTERIORES a `mes`. */
const REGUAS = {
  media6(serie, mes) {
    const anteriores = Object.keys(serie).filter(m => m < mes).sort().slice(-6);
    return anteriores.length === 6 ? media(anteriores.map(m => serie[m])) : null;
  },
  rodrigo(serie, mes) {
    const m1 = serie[mesMenos(mes, 1)], m2 = serie[mesMenos(mes, 2)], m3 = serie[mesMenos(mes, 3)], a1 = serie[mesMenos(mes, 12)];
    if ([m1, m2, m3, a1].some(x => x == null)) return null;
    return (0.5 * m1 + 0.25 * media([m1, m2, m3]) + 0.15 * a1) / 0.9;
  },
  rodrigoSemAno(serie, mes) {
    const m1 = serie[mesMenos(mes, 1)], m2 = serie[mesMenos(mes, 2)], m3 = serie[mesMenos(mes, 3)];
    if ([m1, m2, m3].some(x => x == null)) return null;
    return (0.5 * m1 + 0.25 * media([m1, m2, m3])) / 0.75;
  },
};

function backtest(serie, ate) {
  const linhas = [];
  Object.keys(serie).sort().filter(m => m <= ate).forEach(mes => {
    const anteriores = Object.fromEntries(Object.entries(serie).filter(([m]) => m < mes));
    const prev = Object.fromEntries(Object.keys(REGUAS).map(r => [r, REGUAS[r](anteriores, mes)]));
    if (Object.values(prev).some(v => v == null)) return;
    linhas.push({ mes, real: serie[mes], ...prev });
  });
  const erro = r => linhas.length ? media(linhas.map(l => Math.abs(l[r] - l.real))) : null;
  return { linhas, erros: Object.fromEntries(Object.keys(REGUAS).map(r => [r, erro(r)])) };
}

module.exports = { REGUAS, backtest, mesMenos };

if (require.main === module) {
  admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccount-production.json'))) });
  (async () => {
    const snap = await admin.firestore().collection('periodos').get();
    const series = { cp: {}, pp: {} };
    snap.docs.forEach(d => {
      const m = d.id.match(/^(cp|pp)_(\d{4}-\d{2})$/);
      const t = d.data().totals;
      if (m && t && typeof t.unitAtivacoes === 'number') series[m[1]][m[2]] = Math.round(t.unitAtivacoes);
    });
    for (const u of ['cp', 'pp']) {
      const r = backtest(series[u], ATE);
      console.log(`\n=== ${u.toUpperCase()} — ${r.linhas.length} meses comparáveis (até ${ATE})`);
      console.log('mês      real  media6  rodrigo  semAno');
      r.linhas.forEach(l => console.log(`${l.mes}  ${String(l.real).padStart(4)}  ${l.media6.toFixed(1).padStart(6)}  ${l.rodrigo.toFixed(1).padStart(7)}  ${l.rodrigoSemAno.toFixed(1).padStart(6)}`));
      console.log('erro médio (ativações):', Object.entries(r.erros).map(([k, v]) => `${k} ${v == null ? '—' : v.toFixed(1)}`).join(' · '));
      console.log('meses na série:', Object.keys(series[u]).sort().join(' '));
    }
    process.exit(0);
  })().catch(e => { console.error(e.message); process.exit(1); });
}
