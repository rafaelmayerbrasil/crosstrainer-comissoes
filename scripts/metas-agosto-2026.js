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
// `minAtivacoesIndivP3` (o corte individual do P3) entra junto: desde 07/09/2026
// ele existe na tela de metas do mes, entao a excecao fica presa a agosto em vez
// de virar config permanente da unidade. O Rodrigo aprovou o minimo 7 no
// Principe (a base migrada esta no meio do contrato). Sem isso a Barbara, com 7
// ativacoes, fica fora do rateio: a folha do PP e a mesma R$ 1.612,47, mas
// R$ 293,11 saem dela e vao para a Kali.
//
// Este script TAMBEM limpa `units/{pp}.config.minAtivacoesIndivP3`, que foi
// gravado antes de o campo existir na tela. Deixa-lo la faria a excecao de
// agosto valer para setembro, outubro e sempre — calada.
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
        metaFixo: 300, superFixo: 600, goldFixo: 900, minAtivacoesIndivP3: 10 },
  PP: { meta: 28, superMeta: 32, metaGold: 37, minNovos: 15, minRenov: 9, minVoucher: 4,
        metaFixo: 300, superFixo: 600, goldFixo: 900, minAtivacoesIndivP3: 7 },
};

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

  // ── 2. tirar o corte individual da config PERMANENTE da unidade ──
  // Ele foi gravado la em 07/09 porque a tela ainda nao tinha o campo. Agora
  // tem, e o valor de agosto vai em `metasMensais` — deixar a config apontando
  // 7 faria a excecao de um mes valer para sempre, sem ninguem ter decidido.
  const units = await db.collection('units').get();
  for (const d of units.docs) {
    const cfg = (d.data() || {}).config || {};
    if (cfg.minAtivacoesIndivP3 === undefined) continue;
    console.log('\n--- units/' + d.id + '.config.minAtivacoesIndivP3 ---');
    console.log('    hoje: ' + cfg.minAtivacoesIndivP3 + '  (vale para TODOS os meses)');
    console.log('    acao: apagar — agora quem manda e a meta do mes');
    if (!APLICAR) continue;
    fs.writeFileSync(path.join(backupDir, 'unitConfig-' + d.id + '-' + hoje + '.json'),
      JSON.stringify({ unit: d.id, config: cfg }, null, 2));
    await db.collection('units').doc(d.id).update({
      'config.minAtivacoesIndivP3': admin.firestore.FieldValue.delete(),
    });
    await db.collection('audit_log').add({
      module: 'comissoes', action: 'settings_change',
      description: 'units/' + d.id + ': config.minAtivacoesIndivP3 (' + cfg.minAtivacoesIndivP3 +
        ') removido — o corte individual passou a ser por mes, na tela de Metas do Mes',
      userEmail: 'script:metas-agosto-2026', createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('    apagado');
  }

  console.log('\nDepois disto, re-subir o arquivo de agosto pela tela, uma vez em cada unidade.');
  process.exit(0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
