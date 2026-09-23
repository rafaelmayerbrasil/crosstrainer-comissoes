'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Carga (ou recarga) do modo sombra rodando o código da função AQUI, não na nuvem
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/carregar-pacto-sombra-local.js --project production --de 2026-07-01 --ate 2026-09-21 [--unidade PP]
//
// Mesmo código da Cloud Function (functions/pacto-sombra.js + pacto-api-cliente.js),
// gravando pelo Admin SDK no projeto escolhido. Serve para a carga inicial de um
// projeto novo sem entrar na conta de ninguém (o homologar-pacto-sombra.js chama a
// função como um admin — em produção isso é a conta de uma pessoa de verdade).
//
// • Em ordem cronológica e em blocos de 7 dias: a consultora vem no dia em que o
//   contrato é LANÇADO, então o mês de antes precisa passar primeiro.
// • Credencial: pacto-credencial.txt na raiz (fora do git e do hosting). Nunca vai
//   para log nem para a tela.
// • No fim, recalcula o termômetro dos meses tocados.
// • Para na primeira credencial recusada ou limite de uso — e não insiste.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const ALVO = arg('--project');
const de = arg('--de'), ate = arg('--ate');
const unidades = arg('--unidade') ? [arg('--unidade')] : ['CP', 'PP'];
if (!['staging', 'production'].includes(ALVO) || !/^\d{4}-\d{2}-\d{2}$/.test(de || '') || !/^\d{4}-\d{2}-\d{2}$/.test(ate || '')) {
  console.error('Uso: node scripts/carregar-pacto-sombra-local.js --project staging|production --de AAAA-MM-DD --ate AAAA-MM-DD [--unidade CP|PP]');
  process.exit(1);
}

const raiz = path.join(__dirname, '..');
const S = require(path.join(raiz, 'functions', 'pacto-sombra.js'));
const { criarCliente } = require(path.join(raiz, 'functions', 'pacto-api-cliente.js'));
const credencial = fs.readFileSync(path.join(raiz, 'pacto-credencial.txt'), 'utf8').trim();

admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${ALVO}.json`))) });
const db = admin.firestore();
const agora = () => admin.firestore.FieldValue.serverTimestamp();
const hojeSP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

(async () => {
  const dias = S.diasParaBuscar({ hoje: hojeSP, de, ate: ate });   // corta em ontem
  console.log(`${ALVO} · ${dias.length} dia(s) · ${unidades.join('+')}`);
  const cliente = criarCliente({ fetch, credencial });
  let parou = null;
  for (let i = 0; i < dias.length && !parou; i += 7) {
    const bloco = dias.slice(i, i + 7);
    const t0 = Date.now();
    const r = await S.buscar({ db, cliente, unidades, dias: bloco, agora });
    const cont = {};
    r.resultados.forEach(x => { cont[x.situacao] = (cont[x.situacao] || 0) + 1; });
    console.log(`${bloco[0]} → ${bloco[bloco.length - 1]} … ${Math.round((Date.now() - t0) / 1000)}s · ${JSON.stringify(cont)}${r.parouPor ? ' · PAROU: ' + r.parouPor : ''}`);
    parou = r.parouPor || null;
  }
  const meses = [...new Set(dias.map(d => d.slice(0, 7)))];
  const feitos = await S.atualizarTermometro({ db, unidades, meses, hoje: hojeSP, agora });
  console.log(`termômetro: ${feitos.map(f => f.id).join(', ')} · chamadas à Pacto: ${cliente.chamadas}`);
  process.exit(parou ? 2 : 0);
})().catch(e => { console.error('ERRO:', String(e.message || e).split(credencial).join('<credencial>')); process.exit(1); });
