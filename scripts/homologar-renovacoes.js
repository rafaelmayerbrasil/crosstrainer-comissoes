'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Homologação da lista de renovações contra o STAGING, com a Pacto de verdade
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/homologar-renovacoes.js --project staging [--hoje 2026-10-01]
//
// Roda a MESMA montagem da Cloud Function (functions/renovacoes-montar.js) na
// máquina, com as credenciais dos arquivos `pacto-credencial*.txt`, e grava no
// Firestore do staging. Imprime SÓ contagens — nenhum nome, matrícula ou CPF.
// Confere: soma com a Pacto, CPF ausente, acompanhamentos intactos.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
if ((arg('--project') || 'staging') !== 'staging') { console.error('Só no staging.'); process.exit(1); }
const RAIZ = path.join(__dirname, '..');
const RL = require(path.join(RAIZ, 'renovacoes-lista.js'));
const M = require(path.join(RAIZ, 'functions', 'renovacoes-montar.js'));
const CR = require(path.join(RAIZ, 'functions', 'pacto-renovacao-cliente.js'));
const CN = require(path.join(RAIZ, 'functions', 'pacto-api-cliente.js'));

admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccount-staging.json'))), projectId: 'crosstrainer-comissoes-staging' });
const db = admin.firestore();
const cred = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').trim();
const hoje = arg('--hoje') || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

(async () => {
  const antes = (await db.collection('renovacoes_acompanhamento').get()).docs.map(d => d.id + JSON.stringify(d.data())).sort().join('|');
  const clientesGw = {
    CP: CR.criarClienteRenovacao({ fetch, credencial: cred('pacto-credencial-cp.txt') }),
    PP: CR.criarClienteRenovacao({ fetch, credencial: cred('pacto-credencial-pp.txt') }),
  };
  const clienteNucleo = CN.criarCliente({ fetch, credencial: cred('pacto-credencial.txt') });
  console.log(`Montando (hoje = ${hoje})… a primeira vez consulta um cliente por vez no núcleo, com 2 s de pausa.`);
  const res = await M.montarTudo({ db, clientesGw, clienteNucleo, hoje, agora: () => admin.firestore.FieldValue.serverTimestamp() });
  let falhas = 0;
  for (const r of res) {
    const d = (await db.collection('renovacoes_lista').doc(r.id).get()).data();
    console.log(`\n=== ${r.id}: ${r.situacao}${r.consultas != null ? ' · ' + r.consultas + ' consultas ao núcleo' : ''}`);
    if (r.situacao !== 'ok') { falhas++; continue; }
    const b = d.blocos;
    console.log(`Bloco 1 renovações ${b.renovacoes.length} · Bloco 2 antecipação ${b.antecipacao.length} · Bloco 3 degustações ${b.degustacoes.length} (do histórico ${b.degustacoes.filter(l => l.origem === 'historico').length}) · Bloco 4 verificar ${b.verificar.length}`);
    console.log('excluídos:', JSON.stringify(d.excluidos));
    console.log('conferência:', JSON.stringify(d.conferencia));
    const todas = Object.values(b).flat();
    console.log(`com consultora: ${todas.filter(l => l.consultora).length} de ${todas.length} · pela Pacto ${todas.filter(l => l.consultoraOrigem === 'pacto').length} · pelo histórico ${todas.filter(l => l.consultoraOrigem === 'historico').length}`);
    console.log(`importações com plano original: ${todas.filter(l => l.planoOriginal).length} · já renovados pela Pacto: ${todas.filter(l => l.renovouSistema).length}`);
    const motivos = {};
    b.verificar.forEach(l => { const k = l.motivoVerificar.replace(/\(.*\)/, '(…)'); motivos[k] = (motivos[k] || 0) + 1; });
    console.log('verificar por motivo:', JSON.stringify(motivos));
    if (!d.conferencia.bate) { falhas++; console.log('✗ a conferência NÃO bate'); }
    const cpf = JSON.stringify(d).match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g) || [];
    if (cpf.some(x => RL.pareceCpf(x))) { falhas++; console.log('✗ há CPF no documento'); } else console.log('✓ nenhum CPF no documento');
  }
  const depois = (await db.collection('renovacoes_acompanhamento').get()).docs.map(d => d.id + JSON.stringify(d.data())).sort().join('|');
  if (antes !== depois) { falhas++; console.log('\n✗ a montagem alterou acompanhamentos'); } else console.log('\n✓ acompanhamentos intactos');
  console.log(falhas ? `\n${falhas} problema(s)` : '\n✅ homologação sem problemas');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
