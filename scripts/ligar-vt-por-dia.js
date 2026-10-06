'use strict';
// Roda: node scripts/ligar-vt-por-dia.js --project staging            (só mostra)
//       node scripts/ligar-vt-por-dia.js --project staging --apply    (grava)
//
// Liga o VALE-TRANSPORTE POR DIA TRABALHADO para quem recebe pela bolsa e hoje
// tem VT fixo no cadastro, e cadastra o valor da passagem.
//
// Pedido da Benny (06/10/2026): "o valor é 6,20 por passagem... dias úteis do
// mês + sábado/feriados que trabalharem". Decisão do Rafael: o valor fixo de
// R$ 250 dos bolsistas é substituído pelo cálculo, a partir de setembro/2026.
//
// O que grava (com --apply), guardando antes uma cópia em backups/:
//   · teacher_salaries/{id}: vtPorDia=true, vtPassagensPorDia=2 — o valor fixo
//     (transportAllowance) NÃO é apagado: é para onde se volta se a marca sair;
//   · payroll_config/vale_transporte: { tarifas: [{ desde, valor }] }, só se
//     ainda não houver tarifa cadastrada.
// Depois disso a gestão muda tudo pela tela (cadastro salarial e Fechamento).
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const P = require('../closing-payroll.js');

const args = process.argv.slice(2);
const arg = (n, padrao) => (args.includes(n) ? args[args.indexOf(n) + 1] : padrao);
const projeto = arg('--project', null);
const aplicar = args.includes('--apply');
const valor = Number(arg('--valor', '6.20'));
const desde = arg('--desde', '2026-09');
if (!projeto) { console.error('Faltou --project <staging|production>'); process.exit(1); }
if (!(valor > 0) || !/^\d{4}-\d{2}$/.test(desde)) { console.error('--valor ou --desde inválido'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))) });
const db = admin.firestore();

(async () => {
  const [tSnap, sSnap, cfgDoc] = await Promise.all([
    db.collection('teachers').get(), db.collection('teacher_salaries').get(),
    db.collection('payroll_config').doc('vale_transporte').get(),
  ]);
  const fichas = new Map(tSnap.docs.map(d => [d.id, d.data()]));
  const alvo = [];
  sSnap.docs.forEach(d => {
    const s = d.data(), t = fichas.get(d.id);
    if (!t || t.isActive === false) return;
    if (!P.ehBolsista(t, s)) return;                       // só quem recebe pela bolsa
    if (!(s.transportAllowance > 0) && s.vtPorDia !== true) return;   // quem não tem VT continua sem
    alvo.push({ id: d.id, nome: t.name || d.id, fixo: s.transportAllowance || 0, jaTem: s.vtPorDia === true, antes: s });
  });
  alvo.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  console.log(`\nProjeto: ${projeto} · ${aplicar ? 'GRAVANDO' : 'só mostrando (use --apply para gravar)'}\n`);
  console.log('Quem passa a receber o VT por dia trabalhado (2 passagens por dia):');
  alvo.forEach(a => console.log(`  ${a.jaTem ? '=' : '+'} ${a.nome.padEnd(36)} VT fixo hoje: R$ ${a.fixo.toFixed(2)}${a.jaTem ? '  (já estava ligado)' : ''}`));
  const temTarifa = cfgDoc.exists && (cfgDoc.data().tarifas || []).length > 0;
  console.log(`\nValor da passagem: ${temTarifa ? 'já cadastrado → ' + JSON.stringify(cfgDoc.data().tarifas) + ' (não mexo)' : `R$ ${valor.toFixed(2)} a partir de ${desde}`}`);

  const mudar = alvo.filter(a => !a.jaTem);
  if (!aplicar) { console.log(`\n${mudar.length} cadastro(s) seriam alterados. Nada foi gravado.`); process.exit(0); }

  const dir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const arq = path.join(dir, `vt-por-dia-${projeto}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(arq, JSON.stringify({ projeto, salarios: mudar.map(a => ({ id: a.id, nome: a.nome, antes: a.antes })),
    tarifaAntes: cfgDoc.exists ? cfgDoc.data() : null }, null, 2));
  console.log('\nCópia de antes em', arq);

  const lote = db.batch();
  const agora = admin.firestore.FieldValue.serverTimestamp();
  mudar.forEach(a => lote.update(db.collection('teacher_salaries').doc(a.id), { vtPorDia: true, vtPassagensPorDia: P.PASSAGENS_PADRAO, updatedAt: agora }));
  if (!temTarifa) lote.set(db.collection('payroll_config').doc('vale_transporte'), { tarifas: [{ desde, valor }], updatedAt: agora, updatedBy: 'script:ligar-vt-por-dia' }, { merge: true });
  lote.set(db.collection('audit_log').doc(), {
    type: 'vt_por_dia_ligado', module: 'fechamento', entityType: 'teacher_salaries', entityId: 'lote',
    details: `Vale-transporte por dia trabalhado ligado para ${mudar.length} pessoa(s)${temTarifa ? '' : `; passagem a R$ ${valor.toFixed(2)} desde ${desde}`} (script)`,
    userId: 'script:ligar-vt-por-dia', userName: 'Script (pedido da gestão, 06/10/2026)', timestamp: agora, createdAt: agora,
  });
  await lote.commit();
  console.log(`Gravado: ${mudar.length} cadastro(s)${temTarifa ? '' : ' + valor da passagem'}.`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
