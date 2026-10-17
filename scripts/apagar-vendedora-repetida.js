'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Apaga o cadastro REPETIDO que o cálculo do mês criou para uma vendedora já ligada
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/apagar-vendedora-repetida.js --project staging|production [--apply]
//
// Até 16/10/2026 a preparação do mês (comissoes-mes.js) procurava a vendedora só
// pelo nome do cadastro. Quem teve o cadastro encurtado e foi ligada às comissões
// por `nomeNasComissoes` ("FRANCINI CHAGAS" → "FRANCINI DAS CHAGAS") virava
// "vendedora nova", e a rodada das 4h de 15/10 criou um cadastro pendente repetido.
//
// Repetido, para este script, é o cadastro que tem TUDO isto:
//   • foi criado sozinho pelo cálculo (`autoCreated`), está `pendente` e sem login (sem e-mail);
//   • o nome dele é o `nomeNasComissoes` de OUTRO cadastro.
// Nada mais é tocado. Sem --apply só mostra. Com --apply guarda cópia em backups/,
// apaga e registra no audit_log. Imprime nomes de vendedoras, nunca de alunos.

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const admin = require(path.join(RAIZ, 'functions', 'node_modules', 'firebase-admin'));

const args = process.argv.slice(2);
const arg = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const projeto = arg('--project');
const APPLY = args.includes('--apply');
if (!['staging', 'production'].includes(projeto)) {
  console.error('uso: node scripts/apagar-vendedora-repetida.js --project staging|production [--apply]');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))) });
const db = admin.firestore();
const { FieldValue } = admin.firestore;
const AUTOR = { uid: 'script-manutencao', name: 'Manutenção (Claude, autorizado pelo Rafael)' };
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

(async () => {
  const users = (await db.collection('users').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const ligadas = users.filter(u => norm(u.nomeNasComissoes));
  const repetidos = [];
  for (const u of users) {
    if (!u.autoCreated || u.status !== 'pendente' || u.email) continue;
    const dona = ligadas.find(l => l.id !== u.id && norm(l.nomeNasComissoes) === norm(u.name));
    if (dona) repetidos.push({ u, dona });
  }

  console.log(`${projeto}: ${users.length} cadastros, ${repetidos.length} repetido(s)`);
  for (const { u, dona } of repetidos) {
    const criado = u.createdAt && u.createdAt.toDate ? u.createdAt.toDate().toISOString() : '?';
    console.log(`  • "${u.name}" (${u.id}, ${(u.allowedUnits || []).join(',')}, criado ${criado})`
      + ` → já é o cadastro "${dona.name}" (${dona.id}, ${(dona.allowedUnits || []).join(',')})`);
    const faltam = (u.allowedUnits || []).filter(x => !(dona.allowedUnits || []).includes(x));
    if (faltam.length) console.log(`    ⚠️ o cadastro ligado não tem a unidade ${faltam.join(',')} — confira antes`);
  }
  if (!repetidos.length) return;
  if (!APPLY) { console.log('\nEnsaio: nada apagado. Rode com --apply para apagar.'); return; }

  const pasta = path.join(RAIZ, 'backups');
  if (!fs.existsSync(pasta)) fs.mkdirSync(pasta);
  const arq = path.join(pasta, `vendedora-repetida-${projeto}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(arq, JSON.stringify(repetidos.map(r => r.u), null, 1));
  console.log('\ncópia em ' + path.relative(RAIZ, arq));

  const batch = db.batch();
  repetidos.forEach(({ u }) => batch.delete(db.collection('users').doc(u.id)));
  batch.set(db.collection('audit_log').doc(), {
    type: 'record_edit', userId: AUTOR.uid, userName: AUTOR.name, timestamp: FieldValue.serverTimestamp(),
    details: 'Cadastros repetidos de vendedora apagados (criados pelo cálculo do mês antes de ele ler o nomeNasComissoes): '
      + repetidos.map(r => `${r.u.name} (${r.u.id}) → ${r.dona.name}`).join('; '),
  });
  await batch.commit();
  console.log(`✅ ${repetidos.length} cadastro(s) repetido(s) apagado(s)`);
})().catch(e => { console.error(e); process.exit(1); });
