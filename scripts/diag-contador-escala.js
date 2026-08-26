'use strict';
// Roda: node scripts/diag-contador-escala.js --project production
//
// SOMENTE LEITURA. Mostra, por pessoa, quantos sábados e feriados ela tem —
// contando com a MESMA função que o motor usa pra decidir (`contarPorPessoa`),
// e não com uma contagem paralela escrita aqui. Uma segunda implementação
// poderia concordar com a realidade e discordar do motor, que é justamente o
// tipo de divergência silenciosa que este script existe pra detectar.
//
// Foi com esta leitura que o bug de 25/08/2026 foi provado: 9 das 16 pessoas
// com o contador errado, a Karin marcando 1 e tendo 3 sábados. Depois do
// conserto, serve pra conferir o antes e o depois de refazer uma janela.
const admin = require('firebase-admin');
const path = require('path');
const SS = require('../scale-service.js');

const args = process.argv.slice(2);
const projeto = args.includes('--project') ? args[args.indexOf('--project') + 1] : null;
if (!projeto) {
  console.error('Faltou --project <staging|production>');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))) });
const db = admin.firestore();

(async () => {
  const [scalesSnap, ajusteSnap, teachSnap] = await Promise.all([
    db.collection('special_scales').get(),
    db.collection('fairness_counter').get(),
    db.collection('teachers').get(),
  ]);

  const nome = new Map(teachSnap.docs.map(d => [d.id, (d.data() || {}).name || d.id]));
  const ajuste = {};
  ajusteSnap.docs.forEach(d => {
    const v = d.data() || {};
    ajuste[v.personId || d.id] = Math.max(0, Number(v.ajuste) || 0);
  });

  const scales = scalesSnap.docs
    .map(d => Object.assign({ id: d.id }, d.data()))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  console.log('=== ESCALAS DE SÁBADO E FERIADO ===');
  scales
    .filter(s => ['sabado', 'feriado', 'domingo_especial'].indexOf(s.tipo) !== -1)
    .forEach(s => {
      const quem = (s.slots || [])
        .filter(x => x.assignedPersonId)
        .map(x => nome.get(x.assignedPersonId) || x.assignedPersonId);
      console.log(
        `${s.date} ${String(s.tipo).padEnd(16)} status=${String(s.status).padEnd(13)} `
        + `pub=${!!s.published} lote=${s.windowBatchId || '-'} => ${quem.join(', ') || '(vazio)'}`);
    });

  const sab = SS.contarPorPessoa(scales, { tipos: ['sabado'] });
  const fer = SS.contarPorPessoa(scales, { tipos: ['feriado'] });

  console.log('\n=== POR PESSOA (contado das escalas, como o motor faz) ===');
  const ids = {};
  [sab, fer, ajuste].forEach(m => Object.keys(m).forEach(k => { ids[k] = true; }));
  Object.keys(ids)
    .map(pid => ({
      n: nome.get(pid) || pid,
      s: sab[pid] || 0,
      f: fer[pid] || 0,
      a: ajuste[pid] || 0,
    }))
    .sort((a, b) => a.n.localeCompare(b.n))
    .forEach(l => console.log(
      `${l.n.padEnd(32)} sábados=${String(l.s).padStart(2)}  `
      + `feriados=${String(l.f).padStart(2)}  lançado na mão=${l.a}`));

  // Quem está no rodízio e ainda não pegou nada é o que a gestão precisa ver:
  // é dessa lista que sai a próxima escala.
  const semNada = Object.keys(ids).filter(pid => !sab[pid] && !fer[pid] && !ajuste[pid]);
  if (semNada.length) {
    console.log(`\nSem nenhuma escala no período: ${semNada.map(p => nome.get(p) || p).join(' · ')}`);
  }

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
