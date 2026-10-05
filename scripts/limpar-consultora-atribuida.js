'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Lista de renovações: desfaz a consultora atribuída À MÃO que contraria a Pacto
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/limpar-consultora-atribuida.js --project staging|production --unidade PP --mes 2026-10 [--apply]
//
// A gestão pode atribuir uma consultora à mão a uma linha da lista, e a atribuição
// vale mais que o vínculo do aluno na Pacto. Em 30/09 e 01/10/2026 foram feitas 13
// na PP, quando a lista ainda não lia o vínculo; depois que passou a ler (01/10 à
// noite), 11 ficaram contrariando a carteira da Pacto. O Rodrigo estranhou (05/10) e
// o Rafael mandou apagar, para a lista seguir a Pacto.
//
// Apaga SÓ o campo `consultoraAtribuida` dos acompanhamentos de contratos que estão na
// lista do mês e cuja atribuição é diferente do vínculo lido na Pacto
// (`renovacoes_leituras`). O resto do acompanhamento (contato, situação, observações)
// fica. Com --apply grava, com cópia em backups/ e registro no audit_log; a lista
// mostra a consultora da Pacto na montagem seguinte (5h, botão ou
// `montar-renovacoes-agora.js`). Imprime números de contrato e CONSULTORAS, nunca alunos.

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const admin = require(path.join(RAIZ, 'functions', 'node_modules', 'firebase-admin'));
const RL = require(path.join(RAIZ, 'renovacoes-lista.js'));

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const projeto = arg('--project');
const U = arg('--unidade');
const MES = arg('--mes');
const APPLY = process.argv.includes('--apply');
if (!['staging', 'production'].includes(projeto) || !['CP', 'PP'].includes(U) || !/^\d{4}-\d{2}$/.test(MES || '')) {
  console.error('uso: node scripts/limpar-consultora-atribuida.js --project staging|production --unidade CP|PP --mes AAAA-MM [--apply]');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))) });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

(async () => {
  console.log(`${projeto.toUpperCase()} · ${U} · lista de ${MES} · ${APPLY ? 'GRAVANDO' : 'ensaio (nada é gravado)'}`);
  const lista = (await db.collection('renovacoes_lista').doc(U + '_' + MES).get()).data();
  if (!lista) { console.log('a lista do mês não existe.'); process.exit(0); }
  const naLista = new Set(Object.values(lista.blocos || {}).flat().map(l => String(l.codigoContrato)));
  const acomps = (await db.collection('renovacoes_acompanhamento').where('unidade', '==', U).get()).docs;
  const alvo = [];
  let iguais = 0, semLeitura = 0;
  for (const d of acomps) {
    const x = d.data();
    if (!x.consultoraAtribuida || !naLista.has(String(x.codigoContrato))) continue;
    const lei = (await db.collection('renovacoes_leituras').doc(U + '_' + x.codigoContrato).get()).data();
    if (!lei || !lei.alunoConsultado) { semLeitura++; continue; }       // sem o vínculo lido não há com o que comparar
    const pacto = lei.consultorAluno ? RL.nomeCanonico(lei.consultorAluno) : '';
    if (RL.nomeCanonico(x.consultoraAtribuida) === pacto) { iguais++; continue; }
    alvo.push({ ref: d.ref, id: d.id, dados: x, pacto: pacto || '(sem consultora na Pacto)' });
  }
  console.log(`atribuições à mão na lista: ${alvo.length + iguais + semLeitura} · iguais à Pacto: ${iguais} · sem vínculo lido (ficam): ${semLeitura} · contrariam a Pacto: ${alvo.length}`);
  const pares = {};
  alvo.forEach(a => { const k = `${RL.nomeCanonico(a.dados.consultoraAtribuida)} (à mão) × ${a.pacto} (Pacto)`; pares[k] = (pares[k] || 0) + 1; });
  Object.keys(pares).sort().forEach(k => console.log(`   ${pares[k]} × ${k}`));
  alvo.forEach(a => console.log(`   contrato ${a.dados.codigoContrato} · gravado por ${a.dados.atualizadoPor || '?'}`));
  if (!APPLY || !alvo.length) process.exit(0);

  const pasta = path.join(RAIZ, 'backups');
  if (!fs.existsSync(pasta)) fs.mkdirSync(pasta);
  const arq = path.join(pasta, `consultora-atribuida-${projeto}-${U}_${MES}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(arq, JSON.stringify(alvo.map(a => ({ id: a.id, pacto: a.pacto, dados: a.dados })), null, 2));
  console.log(`cópia: backups/${path.basename(arq)}`);
  const batch = db.batch();
  // Só o campo: `atualizadoPor`/`atualizadoEm` continuam sendo de quem preencheu o acompanhamento
  alvo.forEach(a => batch.update(a.ref, { consultoraAtribuida: '' }));
  await batch.commit();
  await db.collection('audit_log').add({ type: 'settings_change', userId: 'sistema', userName: 'Sistema (lista de renovações)', timestamp: FieldValue.serverTimestamp(),
    details: `Lista de renovações ${U}_${MES}: ${alvo.length} consultora(s) atribuída(s) à mão que contrariavam a carteira da Pacto foram desfeitas (contratos ${alvo.map(a => a.dados.codigoContrato).sort().join(', ')}) — a lista volta a mostrar o vínculo da Pacto` });
  console.log(`feito: ${alvo.length} atribuição(ões) desfeita(s). A lista mostra a consultora da Pacto na próxima montagem.`);
  process.exit(0);
})().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
