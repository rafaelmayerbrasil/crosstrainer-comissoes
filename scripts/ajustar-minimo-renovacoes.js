'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Meta do mês: muda SÓ o mínimo de renovações de um período, e recalcula
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/ajustar-minimo-renovacoes.js --project staging|production --periodo pp_2026-10 --min-renov 8 [--apply]
//
// O mesmo que a gestão faz na janela "Configurar Metas do Mês" mudando um campo: grava
// `metasMensais.minRenov`, recalcula o período pela conta de sempre (`comissoes-mes.js`)
// e registra no audit_log. Existe porque a janela regrava TODOS os campos da meta de uma
// vez — por script muda-se um só, com cópia em backups/.
//
// 05/10/2026: a PP de outubro estava com 10 (65% de 14, antes de descontar quem já tinha
// renovado); pela conta do Rodrigo, com o Mensal de volta na lista, é 8 (65% de 14 − 3).
// Para se o mês já tiver recibo emitido ou pago.

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const admin = require(path.join(RAIZ, 'functions', 'node_modules', 'firebase-admin'));
const PA = require(path.join(RAIZ, 'pacto-adapter.js'));
const CE = require(path.join(RAIZ, 'commission.js'));
const CM = require(path.join(RAIZ, 'comissoes-mes.js'));
const JC = require(path.join(RAIZ, 'jornada-comercial.js'));
const MS = require(path.join(RAIZ, 'metas-sugeridas.js'));

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const projeto = arg('--project');
const PERIODO = arg('--periodo');
const NOVO = Number(arg('--min-renov'));
const APPLY = process.argv.includes('--apply');
if (!['staging', 'production'].includes(projeto) || !/_\d{4}-\d{2}$/.test(PERIODO || '') || !Number.isInteger(NOVO) || NOVO < 0) {
  console.error('uso: node scripts/ajustar-minimo-renovacoes.js --project staging|production --periodo <unidade>_AAAA-MM --min-renov N [--apply]');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))) });
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;
const AUTOR = { uid: 'sistema', email: 'sistema', name: 'Sistema (mínimo de renovações do mês)' };

(async () => {
  console.log(`${projeto.toUpperCase()} · ${PERIODO} · ${APPLY ? 'GRAVANDO' : 'ensaio (nada é gravado)'}`);
  const ref = db.collection('periodos').doc(PERIODO);
  const p = (await ref.get()).data();
  if (!p) { console.log('o período não existe.'); process.exit(1); }
  const mm = p.metasMensais;
  if (!mm || !Object.keys(mm).length) { console.log('🛑 o período não tem meta do mês gravada — configure pela janela de metas.'); process.exit(1); }
  const pags = await db.collection('pagamentos').where('periodId', '==', PERIODO).get();
  if (pags.docs.some(d => (d.data().status || '') !== 'cancelado')) { console.log('🛑 o mês já tem recibo emitido ou pago — não mexo.'); process.exit(1); }
  console.log(`meta do mês: ${mm.meta}/${mm.superMeta}/${mm.metaGold} · novos ${mm.minNovos} · renovações ${mm.minRenov} → ${NOVO} · vouchers ${mm.minVoucher}`);
  console.log(`hoje: ${JSON.stringify(p.totals || {})}`);
  if (mm.minRenov === NOVO) { console.log('já está nesse valor: nada a fazer.'); process.exit(0); }
  if (!APPLY) process.exit(0);

  const pasta = path.join(RAIZ, 'backups');
  if (!fs.existsSync(pasta)) fs.mkdirSync(pasta);
  const arq = path.join(pasta, `metasMensais-${projeto}-${PERIODO}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(arq, JSON.stringify({ periodId: PERIODO, metasMensais: mm, metaSugerida: p.metaSugerida || null, vendorSummary: p.vendorSummary || null, totals: p.totals || null }, null, 2));
  console.log(`cópia: backups/${path.basename(arq)}`);
  await ref.update({ 'metasMensais.minRenov': NOVO });
  const ops = CM.criar({ db, FieldValue, Timestamp, Engine: CE, Adapter: PA, Jornada: JC, Metas: MS, autor: AUTOR, log: console });
  await ops.recalcularPeriodo(PERIODO, { type: 'config_change', label: 'Metas mensais atualizadas' });
  await db.collection('audit_log').add({ type: 'settings_change', unitId: p.unitId || null, userId: AUTOR.uid, userName: AUTOR.name, timestamp: FieldValue.serverTimestamp(),
    details: `Metas mensais alteradas para o período ${PERIODO}: mínimo de renovações ${mm.minRenov} → ${NOVO} (o resto da meta não mudou)` });
  const d = (await ref.get()).data();
  console.log(`depois: mínimo de renovações ${d.metasMensais.minRenov} · ${JSON.stringify(d.totals || {})}`);
  process.exit(0);
})().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
