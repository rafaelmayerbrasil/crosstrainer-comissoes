'use strict';
// ═══════════════════════════════════════════════════════════════════════
// A rotina das 4h (busca da Pacto + termômetro + comissão automática), AGORA
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/rodar-rotina-pacto-agora.js --project staging
//   node scripts/rodar-rotina-pacto-agora.js --project production --apply [--unidade CP]
//
// Faz daqui exatamente o que `rodarSombra` faz na Cloud Function `buscarPactoSombra`
// (functions/index.js), com os MESMOS módulos de functions/ e os mesmos dias
// (`diasDaRotina`: do dia 1º do mês até ontem; até o dia 10, desde o dia 1º do mês
// anterior), o mesmo limite de consultas da noite, o termômetro e o cálculo automático
// do mês das comissões. Serve para conferir uma regra recém-publicada sem esperar a
// madrugada e sem entrar na conta de ninguém (a conta de serviço não pode disparar o
// agendador da nuvem).
//
// Lê a Pacto com as credenciais de `pacto-credencial*.txt` (só leitura na Pacto) e
// GRAVA no Firestore o que a rotina grava. Produção exige --apply. Imprime contagens,
// nunca aluno, CPF ou credencial. Não rodar junto com outra coisa que use a Pacto.

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const fn = p => path.join(RAIZ, 'functions', p);
const admin = require(fn('node_modules/firebase-admin'));

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const projeto = arg('--project');
if (projeto !== 'staging' && projeto !== 'production') { console.error('Diga --project staging ou --project production.'); process.exit(1); }
if (projeto === 'production' && !process.argv.includes('--apply')) { console.error('Produção: confirme com --apply.'); process.exit(1); }

const S = require(fn('pacto-sombra.js'));
const A = require(fn('comissoes-automatico.js'));
const { criarCliente } = require(fn('pacto-api-cliente.js'));
const { criarClienteGateway } = require(fn('pacto-gateway-cliente.js'));

admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))) });
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;
const cred = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').trim();
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const unidades = arg('--unidade') ? [arg('--unidade')] : ['CP', 'PP'];
const agora = () => FieldValue.serverTimestamp();

(async () => {
  const dias = S.diasDaRotina(hoje);
  console.log(`${projeto.toUpperCase()} · rotina da madrugada agora · hoje = ${hoje} · dias ${dias[0]} a ${dias[dias.length - 1]} (${dias.length}) · ${unidades.join(', ')}`);
  const cliente = criarCliente({ fetch, credencial: cred('pacto-credencial.txt') });
  const clientesGw = {};
  unidades.forEach(u => { clientesGw[u] = criarClienteGateway({ fetch, credencial: cred(`pacto-credencial-${u.toLowerCase()}.txt`) }); });
  const t0 = Date.now();
  const r = await S.buscar({ db, cliente, clientesGw, dias, unidades, agora });
  const cont = {};
  r.resultados.forEach(x => { cont[x.unidade + ' ' + x.situacao] = (cont[x.unidade + ' ' + x.situacao] || 0) + 1; });
  console.log(`busca: ${Math.round((Date.now() - t0) / 1000)} s · ${JSON.stringify(cont)}${r.parouPor ? ' · PAROU POR: ' + r.parouPor : ''} · consultas ao núcleo ${cliente.chamadas} · ao gateway ${unidades.map(u => u + ' ' + clientesGw[u].chamadas).join(', ')} · sobra do limite da noite ${r.consultasGwRestantes}`);
  r.resultados.filter(x => x.situacao !== 'buscado').forEach(x => console.log(`   ${x.unidade} ${x.dia}: ${x.situacao}`));

  const meses = [...new Set(dias.map(d => d.slice(0, 7)))];
  const feitos = await S.atualizarTermometro({ db, unidades, meses, hoje, agora });
  console.log('termômetro: ' + feitos.map(f => f.id).join(', '));

  if (r.parouPor) { console.log('a busca parou: o cálculo automático não roda (como na rotina).'); process.exit(0); }
  for (const unidade of unidades) {
    for (const mes of meses) {
      const a = await A.atualizarMesAutomatico({ db, FieldValue, Timestamp, sigla: unidade, mes, hoje, log: { info() {}, warn: console.warn, error: console.error } });
      console.log(`automático ${unidade} ${mes}: ${a.situacao}` + (a.situacao === 'atualizado' ? ` · ativações ${a.ativacoes} · novos ${a.novos} · removidos ${a.removidos} · dados até ${a.dadosAte}` : '') + (a.motivo ? ' · ' + a.motivo : '')
        + (a.diasProblema ? ' · dias com problema: ' + a.diasProblema.map(d => d.dia + ' ' + d.situacao).join(', ') : ''));
    }
  }
  process.exit(0);
})().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
