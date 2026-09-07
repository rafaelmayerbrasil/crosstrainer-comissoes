'use strict';
// ===================================================================
// Grava as metas de agosto/2026 aprovadas pelo Rodrigo em 07/09
// ===================================================================
//
//   node scripts/metas-agosto-2026.js --project staging             (so mostra)
//   node scripts/metas-agosto-2026.js --project production --apply  (grava)
//
// Escreve `metasMensais` no documento do periodo — o MESMO campo que a tela
// "Configurar Metas do Mes" grava (index.html#saveMetasMes). O calculo le
// { defaultConfig, ...unitConfig, ...metasMensais }, entao isto vale so para
// agosto e nao encosta na configuracao permanente da unidade.
//
// ⚠️ EXCECAO: `minAtivacoesIndivP3` NAO existe na tela de metas do mes — so na
//    config da unidade, que vale para sempre. O Rodrigo aprovou o minimo 7 no
//    Principe como excecao de agosto (a base migrada esta no meio do contrato).
//    Sem isso a Barbara, com 7 ativacoes, fica fora do rateio do P3: a folha do
//    PP e a mesma R$ 1.612,47, mas R$ 293,11 saem dela e vao para a Kali.
//    **VOLTAR PARA 10 DEPOIS DE FECHAR AGOSTO** — ou levar o campo para a tela.
//
// ⚠️ ORDEM: rodar ANTES de re-subir o arquivo de agosto. O upload termina
//    chamando `recalculatePeriod`, que le `metasMensais` do periodo — entao a
//    meta ja tem que estar gravada quando o arquivo sobe.
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const PROJETO = arg('--project');
const APLICAR = process.argv.includes('--apply');
if (!['staging', 'production'].includes(PROJETO)) {
  console.error('Uso: node scripts/metas-agosto-2026.js --project staging|production [--apply]');
  process.exit(1);
}

// Campeche: a escada de julho, confirmada pelo Rodrigo ("Sim, pode manter")
// Principe: opcao A — reconhece agosto como o mes da migracao
const METAS = {
  CP: { meta: 50, superMeta: 57, metaGold: 65, minNovos: 18, minRenov: 13, minVoucher: 6,
        metaFixo: 300, superFixo: 600, goldFixo: 900 },
  PP: { meta: 28, superMeta: 32, metaGold: 37, minNovos: 15, minRenov: 9, minVoucher: 4,
        metaFixo: 300, superFixo: 600, goldFixo: 900 },
};
const MIN_INDIV_PP = 7;

admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-' + PROJETO + '.json')) });
const db = admin.firestore();
const sigla = id => /pp/i.test(String(id)) ? 'PP' : 'CP';

(async () => {
  console.log('projeto: ' + PROJETO + (APLICAR ? '   MODO: GRAVANDO' : '   MODO: so leitura (use --apply)'));
  const backupDir = path.join(__dirname, '..', 'backups');
  if (APLICAR && !fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const hoje = new Date().toISOString().slice(0, 10);

  // ── 1. metasMensais de agosto ──
  const snap = await db.collection('periodos').get();
  const agosto = [];
  snap.forEach(d => { if (/2026-08$/.test(d.id)) agosto.push({ id: d.id, ...d.data() }); });
  if (!agosto.length) console.log('\nNenhum periodo 2026-08 neste projeto.');

  for (const p of agosto) {
    const s = sigla(p.unitId || p.id);
    console.log('\n--- ' + p.id + ' (' + s + ') ---');
    console.log('    antes: ' + JSON.stringify(p.metasMensais || null));
    console.log('    novo : ' + JSON.stringify(METAS[s]));
    if (!APLICAR) continue;
    fs.writeFileSync(path.join(backupDir, 'metasMensais-' + p.id + '-' + hoje + '.json'),
      JSON.stringify({ periodo: p.id, metasMensais: p.metasMensais || null }, null, 2));
    await db.collection('periodos').doc(p.id).set({ metasMensais: METAS[s] }, { merge: true });
    await db.collection('audit_log').add({
      module: 'comissoes', action: 'settings_change',
      description: 'Metas de agosto/2026 em ' + p.id + ': ' + METAS[s].meta + '/' + METAS[s].superMeta +
        '/' + METAS[s].metaGold + ' (aprovadas pelo Rodrigo em 07/09/2026)',
      userEmail: 'script:metas-agosto-2026', createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('    gravado');
  }

  // ── 2. minimo individual do P3 no Principe ──
  const units = await db.collection('units').get();
  for (const d of units.docs) {
    if (sigla(d.id) !== 'PP') continue;
    const cfg = (d.data() || {}).config || {};
    console.log('\n--- units/' + d.id + '.config.minAtivacoesIndivP3 ---');
    console.log('    antes: ' + (cfg.minAtivacoesIndivP3 === undefined ? '(nao definido → padrao 10)' : cfg.minAtivacoesIndivP3));
    console.log('    novo : ' + MIN_INDIV_PP + '   ⚠️ excecao de agosto — voltar para 10 depois de fechar');
    if (!APLICAR) continue;
    fs.writeFileSync(path.join(backupDir, 'unitConfig-' + d.id + '-' + hoje + '.json'),
      JSON.stringify({ unit: d.id, config: cfg }, null, 2));
    await db.collection('units').doc(d.id).set({ config: { ...cfg, minAtivacoesIndivP3: MIN_INDIV_PP } }, { merge: true });
    await db.collection('audit_log').add({
      module: 'comissoes', action: 'settings_change',
      description: 'units/' + d.id + ' minAtivacoesIndivP3: ' +
        (cfg.minAtivacoesIndivP3 === undefined ? 'padrao 10' : cfg.minAtivacoesIndivP3) + ' -> ' + MIN_INDIV_PP +
        ' (excecao de agosto/2026 aprovada pelo Rodrigo — voltar para 10 depois de fechar)',
      userEmail: 'script:metas-agosto-2026', createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('    gravado');
  }

  console.log('\nDepois disto, re-subir o arquivo de agosto pela tela, uma vez em cada unidade.');
  process.exit(0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
