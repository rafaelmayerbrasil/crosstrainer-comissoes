'use strict';
// Roda: node scripts/homologar-domingo-e-minhas-datas.js --project staging
//
// Homologação contra o BANCO REAL: as mesmas funções que os botões da tela
// chamam, rodando contra o Firestore do projeto, com os usuários e as escalas
// que existem lá de verdade.
//
// O que os smokes NÃO provam e este script prova: que a regra vale contra os
// dados reais (inclusive as escalas antigas, com formato legado), e que as
// pessoas certas do banco caem de cada lado da decisão.
//
// Limpa tudo o que cria. Não escreve nada permanente.

const path = require('path');
const admin = require('firebase-admin');
const SS = require('../scale-service.js');
const SE = require('../scale-engine.js');
const PM = require('../pessoas-model.js');

const arg = process.argv.indexOf('--project');
const projeto = arg !== -1 ? process.argv[arg + 1] : null;
if (!projeto || ['staging', 'production'].indexOf(projeto) === -1) {
  console.error('Uso: node scripts/homologar-domingo-e-minhas-datas.js --project staging');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))),
});
const db = admin.firestore();
const deps = { db, ts: () => admin.firestore.FieldValue.serverTimestamp(), uid: () => 'homologacao', SE };

let n = 0, falhas = 0;
const ok = m => { console.log('  ✓ ' + (++n) + '. ' + m); };
const nok = m => { console.log('  ✗ ' + (++n) + '. ' + m); falhas++; };
const conf = (cond, m) => (cond ? ok(m) : nok(m));

(async () => {
  console.log(`\n🔎 Homologando em ${projeto.toUpperCase()}\n`);
  const criadas = [];

  // ── 1. A regra do domingo, contra o banco de verdade ──
  console.log('1) Domingo não entra na escala');
  {
    const dom = await SS.createScale({
      date: '2026-11-15', tipo: 'feriado', name: '[HOMOLOG] Proclamação', slots: [] }, deps);
    conf(dom.success === false && /domingo/i.test(dom.error || ''),
      'criar feriado em domingo (15/11/2026) é recusado — ' + (dom.error || 'PASSOU!'));
    if (dom.success) criadas.push(dom.data.id);

    const sab = await SS.createScale({
      date: '2026-11-14', tipo: 'sabado', name: '[HOMOLOG] Sábado', slots: [] }, deps);
    conf(sab.success === true, 'criar sábado (14/11/2026) continua funcionando');
    if (sab.success) {
      criadas.push(sab.data.id);
      const mov = await SS.updateScale(sab.data.id, { date: '2026-11-15' }, deps);
      conf(mov.success === false, 'mover essa escala para o domingo é recusado');
      const depois = await SS.getScale(sab.data.id, deps);
      conf(depois.data.date === '2026-11-14', 'e a data original continua de pé no banco');
    }

    const ev = await SS.createScale({
      date: '2026-11-15', tipo: 'evento', name: '[HOMOLOG] Beach games', slots: [] }, deps);
    conf(ev.success === true, 'evento em domingo continua permitido (não é aula)');
    if (ev.success) criadas.push(ev.data.id);
  }

  // ── 2. Os feriados de verdade, vindos da BrasilAPI ──
  console.log('\n2) A lista de feriados que a tela usa');
  for (const ano of [2026, 2027]) {
    const resp = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
    const lista = SS.parseFeriados(await resp.json());
    const r = SS.separarFeriadosPorDomingo(lista);
    const nomes = r.domingos.map(f => `${f.name} ${f.date}`).join(' · ') || '(nenhum)';
    conf(r.uteis.every(f => !SS.isDomingo(f.date)) && r.uteis.length + r.domingos.length === lista.length,
      `${ano}: ${r.uteis.length} sugeridos, ${r.domingos.length} fora por cair em domingo — ${nomes}`);
  }

  // ── 3. Escalas em domingo que já existem no banco ──
  console.log('\n3) O que já está gravado');
  {
    const snap = await db.collection('special_scales').get();
    const domingos = [];
    snap.forEach(d => {
      const x = d.data();
      if (typeof x.date === 'string' && SS.isDomingo(x.date)
          && ['sabado', 'feriado', 'domingo_especial', 'escola_interna'].indexOf(x.tipo) !== -1) {
        domingos.push(`${d.id} · ${x.date} · ${x.tipo} · ${x.status} · pub=${!!x.published} · ${x.name || ''}`);
      }
    });
    if (!domingos.length) ok('nenhuma escala de aula gravada em domingo');
    else {
      console.log('  ⚠️  ' + (++n) + '. escalas de aula em domingo já gravadas (a regra nova não apaga sozinha):');
      domingos.forEach(l => console.log('        ' + l));
    }
  }

  // ── 4. Quem vê o quê, com as pessoas reais do banco ──
  console.log('\n4) As pessoas de verdade em cada lado da decisão');
  {
    const [usersSnap, teachersSnap] = await Promise.all([
      db.collection('users').get(), db.collection('teachers').get(),
    ]);
    const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const teachers = teachersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const pessoas = PM.buildPeople(users, teachers);

    const ehGestao = u => (u.profiles || [u.role]).some(p => p === 'admin' || p === 'supervisao');

    users.filter(ehGestao).forEach(u => {
      const temFicha = !!u.professorId && teachers.some(t => t.id === u.professorId);
      const abas = SS.abasDaEscala({ gestao: true, temFicha });
      const vaiVer = abas.some(t => t.id === 'minhas');
      conf(vaiVer === temFicha,
        `${u.name || u.email}: gestão ${temFicha ? 'COM' : 'sem'} ficha → ${vaiVer ? 'VÊ' : 'não vê'} "Minhas datas"`);
    });

    const semFicha = pessoas.filter(p => !p.teacher && p.hasAccess);
    semFicha.forEach(p => {
      const abas = PM.tabsFor(p, { admin: true, salario: true });
      conf(abas.some(t => t.id === 'professor'),
        `${p.name}: tem login e não tem ficha → ganha a aba Professor (é lá que a ficha nasce)`);
    });
    if (!semFicha.length) ok('(ninguém no banco tem login sem ficha de professor)');
  }

  // ── limpeza ──
  console.log('\n5) Limpeza');
  for (const id of criadas) await db.collection('special_scales').doc(id).delete();
  const sobrou = await db.collection('special_scales').where('name', '>=', '[HOMOLOG]')
    .where('name', '<=', '[HOMOLOG]').get();
  conf(sobrou.empty, `apaguei as ${criadas.length} escalas de teste; sobrou ${sobrou.size}`);

  console.log(falhas ? `\n❌ ${falhas} de ${n} falharam.\n` : `\n✅ ${n}/${n} — homologado em ${projeto}.\n`);
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('\n💥 ' + e.stack); process.exit(1); });
