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

// ── Modo a seco com o histórico da PRODUÇÃO ──────────────────────────
//   node scripts/homologar-renovacoes.js --seco-producao [--mes 2026-10]
// O staging só tem vendas de jul–set/2026; o plano original das IMPORTAÇÕES está
// no histórico do TecnoFit, que só a produção tem (desde jan/2025). Este modo lê
// a Pacto e o histórico da produção e NÃO GRAVA NADA em lugar nenhum.
async function aSecoComProducao(mes) {
  const prod = admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccount-production.json'))) }, 'producao').firestore();
  const L = require(path.join(RAIZ, 'functions', 'pacto-api-linhas.js'));
  const { PACTO_UNIDADES } = require(path.join(RAIZ, 'functions', 'pacto-sombra.js'));
  const clienteNucleo = CN.criarCliente({ fetch, credencial: cred('pacto-credencial.txt') });
  const per = RL.periodos(mes);
  for (const U of ['CP', 'PP']) {
    const gw = CR.criarClienteRenovacao({ fetch, credencial: cred(`pacto-credencial-${U.toLowerCase()}.txt`) });
    const r1 = await gw.previsao(per.mes.de, per.mes.ate);
    const r2 = await gw.previsao(per.antecipacao.de, per.antecipacao.ate);
    if (r1.situacao !== 'ok' || r2.situacao !== 'ok') { console.log(U, 'Pacto:', r1.situacao, r2.situacao); continue; }
    const brutos = [...r1.dados.contratos, ...r2.dados.contratos];
    // contratos: o caderninho da PRODUÇÃO (só leitura) e, o que faltar, direto do núcleo, sem gravar
    const contratos = {};
    const faltam = new Set();
    for (const b of brutos) {
      const s = await prod.collection('pacto_contratos').doc(U + '_' + b.codigoContrato).get();
      if (s.exists) contratos[b.codigoContrato] = s.data(); else if (b.codigoCliente) faltam.add(b.codigoCliente);
    }
    for (const cli of faltam) {
      const r = await clienteNucleo.contratosDoCliente(PACTO_UNIDADES[U], cli);
      if (r.situacao === 'ok') r.dados.forEach(x => { if (x && x.codigo != null) contratos[String(x.codigo)] = L.limparContrato(x, U, null, null); });
    }
    const unitId = U.toLowerCase();
    const historico = await M.carregarHistorico(prod, unitId);
    const lista = RL.montar({ mes, hoje, previsao: { mes: r1.dados, antecipacao: r2.dados }, contratos, historico });
    const b = lista.blocos;
    const todas = Object.values(b).flat();
    console.log(`\n=== ${U} ${mes} (a seco, histórico da produção: ${historico.length} itens; ${faltam.size} clientes consultados no núcleo)`);
    console.log(`Bloco 1 ${b.renovacoes.length} · Bloco 2 ${b.antecipacao.length} · Bloco 3 ${b.degustacoes.length} (do histórico ${b.degustacoes.filter(l => l.origem === 'historico').length}) · Bloco 4 ${b.verificar.length}`);
    console.log('excluídos:', JSON.stringify(lista.excluidos), '· conferência:', JSON.stringify(lista.conferencia));
    console.log(`importações resolvidas pelo histórico: ${todas.filter(l => l.planoOriginal).length} · com consultora: ${todas.filter(l => l.consultora).length} de ${todas.length}`);
    const motivos = {};
    b.verificar.forEach(l => { const k = l.motivoVerificar.replace(/\(.*\)/, '(…)'); motivos[k] = (motivos[k] || 0) + 1; });
    console.log('verificar por motivo:', JSON.stringify(motivos));
    if (process.argv.includes('--planos')) { const cont = {}; b.renovacoes.forEach(l => { const k = (l.planoOriginal ? 'IMP→ ' + l.planoOriginal : l.plano).slice(0, 70); cont[k] = (cont[k] || 0) + 1; }); console.log('Bloco 1 por plano:'); Object.entries(cont).sort((x, y) => y[1] - x[1]).forEach(([k, q]) => console.log('  ' + q + '× ' + k)); }
  }
}

(async () => {
  if (process.argv.includes('--seco-producao')) {
    await aSecoComProducao(arg('--mes') || hoje.slice(0, 7));
    process.exit(0);
  }
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
