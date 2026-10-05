'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Completa no caderninho de contratos DE QUE CONTRATO cada renovação veio
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/completar-contrato-anterior.js --project staging|production --mes 2026-09 [--apply]
//
// A regra "a mensalidade seguinte do mesmo plano recorrente não é venda" (05/10/2026)
// precisa saber o contrato anterior da renovação — a Pacto informa
// (`contratoBaseadoRenovacao`), e a busca das 4h passou a guardar em
// `pacto_contratos.anterior`. Os contratos lidos ANTES disso ficaram sem a resposta;
// a busca completa sozinha os dos dias que ela relê, e este script completa os de um
// mês já calculado (os lançamentos de contrato do período), para o mês poder ser
// acertado sem esperar.
//
// Só LÊ a Pacto (credencial da unidade em `pacto-credencial-*.txt`) e, com --apply,
// grava o campo `anterior` no caderninho — nada mais. Imprime números de contrato,
// nunca aluno, CPF ou credencial. Não rodar junto com outra coisa que use a Pacto.

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const admin = require(path.join(RAIZ, 'functions', 'node_modules', 'firebase-admin'));
const PA = require(path.join(RAIZ, 'pacto-adapter.js'));
const S = require(path.join(RAIZ, 'functions', 'pacto-sombra.js'));
const { criarClienteGateway } = require(path.join(RAIZ, 'functions', 'pacto-gateway-cliente.js'));

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const projeto = arg('--project');
const MES = arg('--mes');
const APPLY = process.argv.includes('--apply');
if (!['staging', 'production'].includes(projeto) || !/^\d{4}-\d{2}$/.test(MES || '')) {
  console.error('uso: node scripts/completar-contrato-anterior.js --project staging|production --mes AAAA-MM [--apply]');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))) });
const db = admin.firestore();

(async () => {
  console.log(`${projeto.toUpperCase()} · ${MES} · ${APPLY ? 'GRAVANDO o campo "anterior"' : 'ensaio (nada é gravado)'}`);
  const units = (await db.collection('units').get()).docs;
  for (const sigla of ['CP', 'PP']) {
    const u = units.find(d => PA.siglaDaUnidade(d.id, [sigla]) === sigla);
    if (!u) { console.log(`\n${sigla}: unidade não encontrada`); continue; }
    const itens = await db.collection('periodos').doc(u.id + '_' + MES).collection('itens').where('type', '==', 'processed').get();
    const contratos = [...new Set(itens.docs.map(d => (String(d.data().codigo || '').match(/^C(\d+)/) || [])[1]).filter(Boolean))].sort();
    const faltam = [];
    for (const n of contratos) {
      const c = (await db.collection('pacto_contratos').doc(sigla + '_' + n).get()).data();
      if (c && S.precisaDoAnterior(c, MES + '-01')) faltam.push(n);
    }
    console.log(`\n=== ${sigla} · contratos com lançamento no mês: ${contratos.length} · renovação de plano recorrente sem a resposta: ${faltam.length}`);
    if (!faltam.length) continue;
    const gw = criarClienteGateway({ fetch, credencial: fs.readFileSync(path.join(RAIZ, `pacto-credencial-${sigla.toLowerCase()}.txt`), 'utf8').trim() });
    for (const n of faltam) {
      const r = await gw.contrato(n);
      if (r.situacao !== 'ok' || !r.dados) { console.log(`   ${n}: a Pacto não respondeu (${r.situacao}) — fica para depois`); continue; }
      const anterior = r.dados.anterior || null;
      const base = anterior ? (await db.collection('pacto_contratos').doc(sigla + '_' + anterior).get()).data() : null;
      console.log(`   ${n}: veio do contrato ${anterior || '—'}` + (anterior ? (base ? ` (no caderninho: ${PA.chavePlanoRecorrente(base.nomePlano) ? 'plano recorrente' : 'outro plano'})` : ' (fora do caderninho)') : ''));
      if (APPLY) await db.collection('pacto_contratos').doc(sigla + '_' + n).set({ anterior }, { merge: true });
    }
  }
  process.exit(0);
})().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
