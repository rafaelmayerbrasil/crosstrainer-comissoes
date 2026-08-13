'use strict';
// Prova em STAGING, contra dados reais no Firestore, que a regra de "aula
// intocada" separa certo o que a troca de dia pode mover do que não pode.
// Fixture própria, cleanup completo. Uso: node scripts/smoke-grade-horarios.js
//
// Este smoke cobre a REGRA. Quem cobre a FUNÇÃO no ar (sem duplicata, não-admin
// recusado) é scripts/validate-move-slot-classes.js, que roda depois do deploy.
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const CP = require('../class-propagation.js');

const PROJECT = 'crosstrainer-comissoes-staging';
const svcPath = path.join(__dirname, 'serviceAccount-staging.json');
if (!fs.existsSync(svcPath)) { console.error('Falta scripts/serviceAccount-staging.json'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(svcPath)), projectId: PROJECT });
const db = admin.firestore();

let fails = 0, checks = 0;
const expect = (desc, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want); checks++; if (!ok) fails++;
  console.log(`${ok ? '✓' : '✗'} ${desc} — esperado ${JSON.stringify(want)}, veio ${JSON.stringify(got)}`);
};

const SLOT = 'zzgrade_slot';
const criados = [];

(async () => {
  const hoje = new Date();
  const d = n => { const x = new Date(hoje); x.setDate(x.getDate() + n); return x; };

  await db.collection('schedule_slots').doc(SLOT).set({
    unitId: 'zzgrade_unit', weekday: 2, startTime: '07:00', endTime: '08:00',
    teacherId: 'zzgrade_t', modalityId: 'zzgrade_m', isActive: true, _fixture: true,
  });

  const aulas = [
    ['zzgrade_c1', 'prevista',    null,         d(7)],   // intocada → move
    ['zzgrade_c2', 'prevista',    null,         d(14)],  // intocada → move
    ['zzgrade_c3', 'substituida', null,         d(7)],   // fica
    ['zzgrade_c4', 'cancelada',   null,         d(14)],  // fica
    ['zzgrade_c5', 'prevista',    'zz_2026-08', d(7)],   // mês fechado → fica
    ['zzgrade_c6', 'prevista',    null,         d(-7)],  // passada → fica
    ['zzgrade_c7', 'realizada',   null,         d(3)],   // realizada → fica
  ];
  for (const [id, status, closing, data] of aulas) {
    await db.collection('classes').doc(id).set({
      slotId: SLOT, status, monthClosingId: closing, scheduledDate: data,
      unitId: 'zzgrade_unit', teacherId: 'zzgrade_t', _fixture: true,
    });
    criados.push(id);
  }
  console.log('fixture criada (1 slot + 7 aulas)\n');

  try {
    // Espelha exatamente o que a CF faz: mesma leitura, mesmo predicado.
    const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const snap = await db.collection('classes').where('slotId', '==', SLOT).get();
    const intocadas = [], mantidas = [];
    snap.docs.forEach(doc => {
      const c = doc.data();
      const dt = c.scheduledDate.toDate ? c.scheduledDate.toDate() : new Date(c.scheduledDate);
      const alvo = {
        status: c.status,
        monthClosingId: c.monthClosingId || null,
        dateISO: dt.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }),
      };
      (CP.isUntouchedClass(alvo, hojeISO) ? intocadas : mantidas).push(doc.id);
    });

    expect('só as 2 intocadas seriam movidas', intocadas.sort(), ['zzgrade_c1', 'zzgrade_c2']);
    expect('as outras 5 ficam onde estão', mantidas.sort(),
      ['zzgrade_c3', 'zzgrade_c4', 'zzgrade_c5', 'zzgrade_c6', 'zzgrade_c7']);
    expect('a fixture inteira foi lida', snap.size, 7);
  } finally {
    console.log('\nlimpando fixture...');
    for (const id of criados) await db.collection('classes').doc(id).delete();
    await db.collection('schedule_slots').doc(SLOT).delete();
    console.log('fixture removida');
  }

  console.log(`\n${checks - fails}/${checks} verificações passaram`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
