'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Monta a lista de renovações AGORA, da máquina — o mesmo que o botão
// "Atualizar agora" e a rotina das 5h fazem (functions/renovacoes-montar.js),
// para quando não há ninguém logado como admin para clicar.
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/montar-renovacoes-agora.js --project staging
//   node scripts/montar-renovacoes-agora.js --project production --apply [--unidade CP]
//
// Lê a Pacto com as credenciais dos arquivos `pacto-credencial*.txt` (só leitura
// na Pacto) e GRAVA no Firestore `renovacoes_lista`, `renovacoes_leituras` e, no
// caminho de reserva, o caderninho `pacto_contratos` — exatamente o que a Function
// grava. Produção exige `--apply`. Imprime SÓ contagens: nenhum nome, matrícula ou CPF.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const projeto = arg('--project');
if (projeto !== 'staging' && projeto !== 'production') { console.error('Diga --project staging ou --project production.'); process.exit(1); }
if (projeto === 'production' && !process.argv.includes('--apply')) { console.error('Produção: confirme com --apply.'); process.exit(1); }

const RAIZ = path.join(__dirname, '..');
const M = require(path.join(RAIZ, 'functions', 'renovacoes-montar.js'));
const CR = require(path.join(RAIZ, 'functions', 'pacto-renovacao-cliente.js'));
const CG = require(path.join(RAIZ, 'functions', 'pacto-gateway-cliente.js'));
const CN = require(path.join(RAIZ, 'functions', 'pacto-api-cliente.js'));

admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))) });
const db = admin.firestore();
const cred = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').trim();
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const unidades = arg('--unidade') ? [arg('--unidade')] : ['CP', 'PP'];

(async () => {
  const clientesGw = {}, clientesContratos = {};
  unidades.forEach(u => {
    const k = cred(`pacto-credencial-${u.toLowerCase()}.txt`);
    clientesGw[u] = CR.criarClienteRenovacao({ fetch, credencial: k });
    clientesContratos[u] = CG.criarClienteGateway({ fetch, credencial: k });
  });
  const clienteNucleo = CN.criarCliente({ fetch, credencial: cred('pacto-credencial.txt') });
  console.log(`Montando a lista de renovações em ${projeto.toUpperCase()} (${unidades.join(', ')}), hoje = ${hoje}…`);
  const resultados = await M.montarTudo({
    db, clientesGw, clienteNucleo, clientesContratos, unidades, hoje,
    agora: () => admin.firestore.FieldValue.serverTimestamp(),
  });
  for (const r of resultados) {
    const d = (await db.collection(M.COL_LISTA).doc(r.id).get()).data() || {};
    const b = d.blocos || {};
    const n = k => (b[k] || []).length;
    console.log(`${r.id}: ${r.situacao}` + (r.situacao === 'ok'
      ? ` · renovações ${n('renovacoes')} · antecipação ${n('antecipacao')} · vouchers ${n('degustacoes')} · verificar ${n('verificar')}`
        + ` · conferência ${d.conferencia && d.conferencia.bate ? 'bate' : 'NÃO BATE'} (${d.conferencia ? d.conferencia.totalPacto : '?'})`
        + (d.leitura ? ` · conferidos na Pacto ${d.leitura.relidos}/${d.leitura.total}${d.leitura.motivo ? ' — ' + d.leitura.motivo : ''}` : '')
      : ''));
  }
  process.exit(0);
})().catch(e => { console.error(String(e && e.message || e)); process.exit(1); });
