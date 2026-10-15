'use strict';
// Roda: node scripts/ligar-nome-nas-comissoes.js --project staging|production [--apply]
//
// Preenche `users/{uid}.nomeNasComissoes` das vendedoras que ainda não têm a
// ligação, com o nome exato com que cada uma aparece nas comissões dos últimos
// meses (as duas unidades). Desenho: vendedora-nome.js.
//
// Por quê: em 14/10/2026 o cadastro da Francini foi encurtado de "FRANCINI DAS
// CHAGAS" para "FRANCINI CHAGAS" e o painel dela ficou preto — a tela ligava o
// login às comissões pelo nome de exibição. Com o campo preenchido, mudar o nome
// do cadastro não quebra mais nada.
//
// Só liga quando o nome do cadastro casa com UM nome das comissões (igual, ou as
// palavras inteiras na ordem). Duas candidatas ou nenhuma: fica de fora e aparece
// na lista, para a gestão ligar pela aba Comercial do cadastro.
//
// Sem --apply não grava nada. Com --apply: cópia em backups/, grava só o campo
// novo (e updatedAt) e deixa uma linha no audit_log.

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const admin = require(path.join(RAIZ, 'functions', 'node_modules', 'firebase-admin'));
const VN = require(path.join(RAIZ, 'vendedora-nome.js'));

const args = process.argv.slice(2);
const arg = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const projeto = arg('--project');
const APPLY = args.includes('--apply');
const MESES = 6;
if (!['staging', 'production'].includes(projeto)) {
  console.error('uso: node scripts/ligar-nome-nas-comissoes.js --project staging|production [--apply]');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))) });
const db = admin.firestore();
const { FieldValue } = admin.firestore;
const AUTOR = { uid: 'script-manutencao', name: 'Manutenção (Claude, autorizado pelo Rafael)' };

const ehVendedora = u => [].concat(u.profiles || [], u.role ? [u.role] : []).includes('vendedor');

(async () => {
  console.log(`\n${projeto.toUpperCase()} · ${APPLY ? 'GRAVANDO' : 'ensaio (nada é gravado)'}\n`);

  const agora = new Date();
  const corte = agora.getFullYear() * 12 + agora.getMonth() - (MESES - 1);
  const nomes = new Set();
  (await db.collection('periodos').get()).forEach(d => {
    const x = d.data();
    if (typeof x.year !== 'number' || (x.year * 12 + (x.month - 1)) < corte) return;
    Object.keys(x.vendorSummary || {}).forEach(n => nomes.add(n));
  });
  const lista = [...nomes].sort();
  console.log(`Nomes nas comissões dos últimos ${MESES} meses: ${lista.join(' · ') || '(nenhum)'}\n`);

  const users = (await db.collection('users').get()).docs.map(d => ({ uid: d.id, ...d.data() })).filter(ehVendedora);
  const ligar = [];
  for (const u of users) {
    const status = u.status || '—';
    if (u.nomeNasComissoes) { console.log(`  já ligada  ${u.name} [${status}] → ${u.nomeNasComissoes}`); continue; }
    const s = VN.sugerir(u, lista);
    if (s) { ligar.push({ u, nome: s }); console.log(`  LIGAR      ${u.name} [${status}] → ${s}`); }
    else console.log(`  sem par    ${u.name} [${status}] (nenhum nome único nas comissões — ligar pela aba Comercial se ela vender)`);
  }

  if (!ligar.length) { console.log('\nNada a gravar.'); process.exit(0); }
  if (!APPLY) { console.log(`\n${ligar.length} a ligar. Para gravar, repita com --apply.`); process.exit(0); }

  const pasta = path.join(RAIZ, 'backups');
  if (!fs.existsSync(pasta)) fs.mkdirSync(pasta);
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
  const arq = path.join(pasta, `users-antes-de-ligar-nome-nas-comissoes-${projeto}-${carimbo}.json`);
  fs.writeFileSync(arq, JSON.stringify(ligar.map(({ u }) => u), null, 1));
  console.log(`\n   cópia: backups/${path.basename(arq)}`);

  const lote = db.batch();
  ligar.forEach(({ u, nome }) => lote.update(db.collection('users').doc(u.uid), { nomeNasComissoes: nome, updatedAt: FieldValue.serverTimestamp() }));
  await lote.commit();
  await db.collection('audit_log').add({
    type: 'record_edit', userId: AUTOR.uid, userName: AUTOR.name, timestamp: FieldValue.serverTimestamp(),
    details: 'Nome nas comissões ligado no cadastro: ' + ligar.map(({ u, nome }) => `${u.name} → ${nome}`).join(' · '),
  });

  let ok = true;
  for (const { u, nome } of ligar) {
    const d = (await db.collection('users').doc(u.uid).get()).data();
    if (d.nomeNasComissoes !== nome || d.name !== u.name) { ok = false; console.log(`  ⚠️ ${u.name}: gravado ${d.nomeNasComissoes}`); }
  }
  console.log(ok ? `\n✅ ${ligar.length} ligada(s); o nome de exibição não foi mexido.` : '\n⚠️ Conferir (a cópia está em backups/).');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
