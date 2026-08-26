'use strict';
// ⛔ OBSOLETO (26/08/2026) — NÃO RODAR.
//
// Este script monta o `ctx` do `consolidate` nas linhas ~126-129 e NÃO passa
// `scalesDoAno`. Desde a mudança de 26/08/2026 o rodízio é CONTADO das
// escalas via `scalesDoAno` (era um contador guardado em `fairness_counter`,
// que não existe mais) — sem essa chave, `contarPorPessoa` conta 0 pra todo
// mundo, todo mundo empata no rodízio, e quem decide as 11 datas é o
// `merito`, que é fixo. Ou seja: este script reproduz, e REPUBLICA em
// produção, exatamente o bug que o branch `escala-contador-derivado` existe
// pra matar (Bruno Claudino e Karin nos 11 sábados).
//
// O caminho certo pra refazer uma janela de escalas é o botão "Refazer a
// janela" no app (tela Escala Inteligente) — ele já monta o `ctx` completo,
// com `scalesDoAno` realimentado a cada consolidação do lote (ver JSDoc de
// `consolidate` em scale-service.js).
//
// Ficou aqui por registro histórico (foi o script que corrigiu os 11 sábados
// em 24/08/2026, antes do contador virar derivado). Se algum dia for
// atualizado pra passar `scalesDoAno` corretamente, tire esta trava — até lá,
// só roda com `--eu-sei-o-que-estou-fazendo`.
//
// Ensaio:    node scripts/refazer-escalas-com-rodizio.js --project production
// Pra valer: node scripts/refazer-escalas-com-rodizio.js --project production --executar
//
// Refaz as escalas já consolidadas usando o motor corrigido em 24/08/2026.
//
// Por quê: até então o rodízio só valia ABAIXO do piso (`diasTrabalhados <
// minMes`, minMes=1). Como todo mundo já tinha 1 dia, ninguém ficava no piso e
// o motor decidia por MÉRITO, que é fixo — as 44 vagas das 11 primeiras
// escalas saíram todas por mérito, "justiça" zero vezes. Bruno Claudino e
// Karin pegaram os 11 sábados; onze pessoas ficaram com 1 dia.
//
// Decisão do Rafael: "rodízio com mérito como desempate" e "refaz as 11".
//
// Usa os MESMOS serviços da tela (scale-service + scale-engine +
// engagement-service), com as dependências injetadas — não reimplementa regra.
//
// Sempre: backup antes, e nunca toca em aula de mês fechado (o próprio
// unpublishFromAgenda recusa).
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const SS = require('../scale-service.js');
const SE = require('../scale-engine.js');
const ES = require('../engagement-service.js');
const PE = require('../points-engine.js');
const EC = require('../engagement-config.js');

const args = process.argv.slice(2);
const projeto = args.includes('--project') ? args[args.indexOf('--project') + 1] : null;
const executar = args.includes('--executar');
if (!args.includes('--eu-sei-o-que-estou-fazendo')) {
  console.error('\n⛔ OBSOLETO — este script não realimenta `scalesDoAno` no ctx do consolidate.');
  console.error('   Desde 26/08/2026 isso zera o rodízio pra todo mundo e decide as datas só');
  console.error('   por mérito — o bug que ele mesmo foi escrito pra corrigir, republicado em');
  console.error('   produção. Use o botão "Refazer a janela" no app (Escala Inteligente).');
  console.error('   Se você sabe o que está fazendo, rode de novo com --eu-sei-o-que-estou-fazendo.\n');
  process.exit(1);
}
if (!projeto) { console.error('Faltou --project <staging|production>'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))) });
const db = admin.firestore();
const BR = 3;

const deps = { db, ts: () => admin.firestore.FieldValue.serverTimestamp(), uid: () => 'script:refaz-escala-24-08', SE };
// EC junto: sem ele o EngagementService estoura no getConfig, devolve mérito 0
// pra todo mundo e o desempate vira aleatório — sem avisar. Foi o que aconteceu
// na primeira execução deste script.
const depsEng = { db, PE, EC };

(async () => {
  const teachersAll = (await db.collection('teachers').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const nome = id => (teachersAll.find(t => t.id === id) || {}).name || '—';
  const ativos = teachersAll.filter(t => t.isActive !== false);

  const scales = (await db.collection('special_scales').get()).docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(s => s.status === 'consolidada')
    .sort((a, b) => a.date.localeCompare(b.date));

  console.log(`Projeto: ${projeto}`);
  console.log(`Escalas consolidadas a refazer: ${scales.length}\n`);

  console.log('=== COMO ESTÁ HOJE ===');
  const hoje = {};
  scales.forEach(s => (s.slots || []).forEach(sl => { if (sl.assignedPersonId) hoje[sl.assignedPersonId] = (hoje[sl.assignedPersonId] || 0) + 1; }));
  Object.entries(hoje).sort((a, b) => b[1] - a[1]).forEach(([id, n]) => console.log(`  ${String(n).padStart(2)}x  ${nome(id)}`));

  if (!executar) {
    console.log('\n🔍 ENSAIO — nada alterado. Repita com --executar para valer.');
    console.log('   (a simulação do resultado já foi mostrada antes; aqui o efeito real depende do mérito do ciclo)');
    process.exit(0);
  }

  // ─── Backup ───────────────────────────────────────────────────────────
  const dir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fair = (await db.collection('fairness_counter').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const aulas = [];
  for (const s of scales) {
    const cls = (await db.collection('classes').where('specialScaleId', '==', s.id).get()).docs;
    cls.forEach(c => {
      const dd = c.data();
      // Aguenta os dois formatos: Timestamp (o certo) e string crua (as aulas
      // que nasceram com o defeito do publishToAgenda fora do navegador).
      const sd = dd.scheduledDate;
      const iso = sd && typeof sd.toDate === 'function' ? sd.toDate().toISOString() : String(sd);
      aulas.push({ id: c.id, ...dd, scheduledDate: iso });
    });
  }
  fs.writeFileSync(path.join(dir, `escalas-antes-do-rodizio-${projeto}.json`),
    JSON.stringify({ scales, fairness: fair, aulas }, null, 2), 'utf8');
  console.log(`\n💾 Backup: escalas-antes-do-rodizio-${projeto}.json (${scales.length} escalas, ${fair.length} contadores, ${aulas.length} aulas)`);

  // ─── Zera o rodízio ───────────────────────────────────────────────────
  // Os contadores atuais vieram justamente destas 11 escalas. Refazendo-as, o
  // histórico tem que recomeçar do zero, senão o rodízio parte de um passado
  // que deixou de existir.
  const loteZero = db.batch();
  fair.forEach(f => loteZero.set(db.collection('fairness_counter').doc(f.id),
    { personId: f.id, diasTrabalhados: 0, divida: f.divida || 0, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }));
  await loteZero.commit();
  console.log(`🔄 ${fair.length} contadores de rodízio zerados.`);

  // ─── Contexto igual ao da tela ────────────────────────────────────────
  const cyclesRes = await ES.listCycles(depsEng);
  const cycles = (cyclesRes.success && cyclesRes.data.length) ? cyclesRes.data
    : [{ id: '_all', inicio: '1900-01-01', fim: new Date().toISOString().slice(0, 10) }];
  const cycle = (typeof ES.currentCycle === 'function'
    ? ES.currentCycle(cycles, new Date().toISOString().slice(0, 10)) : null) || cycles[0];

  const meritoById = {};
  const semMerito = [];
  for (const t of ativos) {
    const hire = (t.hireDate && t.hireDate.toDate) ? t.hireDate.toDate().toISOString().slice(0, 10) : null;
    const sb = await ES.scoreboard(t.id, hire, cycle, depsEng);
    if (!sb.success) { semMerito.push(t.name); continue; }
    meritoById[t.id] = sb.data.total;
  }
  // Mérito é o desempate do rodízio. Se não vier, o desempate cai em critérios
  // arbitrários e ninguém percebe — a primeira execução deste script fez
  // exatamente isso (faltava injetar EngagementConfig). Melhor parar.
  if (semMerito.length) {
    console.error(`\n⛔ Não consegui calcular o mérito de ${semMerito.length} pessoa(s): ${semMerito.join(', ')}`);
    console.error('   Abortando: refazer a escala com mérito zerado desempata no escuro.');
    process.exit(1);
  }
  const totalMerito = Object.values(meritoById).reduce((s, v) => s + v, 0);
  console.log(`\n📊 Mérito carregado de ${Object.keys(meritoById).length} pessoas (soma ${totalMerito})`);
  const vacs = (await db.collection('vacation_requests').where('status', '==', 'aprovada').get()).docs.map(d => d.data());

  const ctx = {
    teachers: ativos.map(t => ({ id: t.id, name: t.name, modalityIds: t.modalityIds || [], primaryUnitId: t.primaryUnitId })),
    meritoById, opts: { minMes: 1 }, vacations: vacs,
  };

  // ─── Refaz, em ordem de data ──────────────────────────────────────────
  console.log('\n=== REFAZENDO ===');
  const falhas = [];
  for (const s of scales) {
    const un = await SS.unpublishFromAgenda(s.id, deps);
    if (!un.success) { falhas.push(`${s.date}: ${un.error}`); console.log(`  ✗ ${s.date} — ${un.error}`); continue; }

    // volta pro estado anterior à consolidação, senão o motor não recontabiliza
    await db.collection('special_scales').doc(s.id)
      .set({ status: 'rascunho', fairnessApplied: false }, { merge: true });

    const cons = await SS.consolidate(s.id, ctx, deps);
    if (!cons.success) { falhas.push(`${s.date}: ${cons.error}`); console.log(`  ✗ ${s.date} — ${cons.error}`); continue; }

    const pub = await SS.publishToAgenda(s.id, deps);
    if (!pub.success) { falhas.push(`${s.date}: ${pub.error}`); console.log(`  ✗ ${s.date} — ${pub.error}`); continue; }

    const quem = cons.data.assignments.map(a => `${(nome(a.personId) || '').split(' ')[0]}(${a.reason === 'justica' ? 'rodízio' : 'mérito'})`);
    console.log(`  ✓ ${s.date} · ${un.data.removed} removidas → ${(pub.data && pub.data.created) || 0} criadas · ${quem.join(', ')}`);
  }

  // ─── Conferência ──────────────────────────────────────────────────────
  const depois = (await db.collection('special_scales').get()).docs
    .map(d => d.data()).filter(s => s.status === 'consolidada');
  const dist = {};
  depois.forEach(s => (s.slots || []).forEach(sl => { if (sl.assignedPersonId) dist[sl.assignedPersonId] = (dist[sl.assignedPersonId] || 0) + 1; }));
  console.log('\n=== COMO FICOU ===');
  Object.entries(dist).sort((a, b) => b[1] - a[1]).forEach(([id, n]) => console.log(`  ${String(n).padStart(2)}x  ${nome(id)}`));
  console.log(`\n  ${Object.keys(dist).length} pessoas diferentes (eram ${Object.keys(hoje).length})`);
  if (falhas.length) { console.log(`\n⚠ ${falhas.length} falha(s):`); falhas.forEach(f => console.log('   ' + f)); }
  process.exit(falhas.length ? 1 : 0);
})().catch(e => { console.error('FALHA:', e.message); process.exit(1); });
