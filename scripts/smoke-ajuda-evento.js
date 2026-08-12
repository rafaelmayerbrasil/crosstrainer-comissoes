'use strict';
// Roda: node scripts/smoke-ajuda-evento.js
//
// Cobre as mudanças de 12/08/2026:
//  · Ajuda no app (item de menu + botão "?" + mapa tela→seção do manual)
//  · Pré-marcação da chamada a partir do "Vou" do evento
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const Nav = require('../professores-nav.js');

const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'tester' });

/* ─── Carrega professores-ajuda.js num sandbox com AppState stubado ─── */
function loadAjuda(profiles, currentPage) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'professores-ajuda.js'), 'utf8');
  const sandbox = { AppState: { userProfile: { profiles }, currentPage } };
  const fn = new Function('AppState', `${src}; return { ajudaUrl, ajudaBtn, ajudaPerfil, AJUDA_MAP, AJUDA_BLURBS };`);
  return fn(sandbox.AppState);
}

(async () => {
  /* ── 1. Item "Ajuda" aparece pra todo perfil ───────────────────── */
  ['admin', 'supervisao', 'professor', 'professor_estagiario'].forEach(p => {
    const model = Nav.buildSidebarModel([p], { hasProfessorLink: true, moduleAccess: { professores: true } });
    assert.ok(model.helpItem, `helpItem presente para ${p}`);
    assert.strictEqual(model.helpItem.id, 'ajuda');
    assert.strictEqual(model.helpItem.label, 'Ajuda');
  });
  console.log('✓ menu Ajuda presente nos 4 perfis');

  /* ── 2. Manual certo por perfil, âncora certa por tela ─────────── */
  const admin = loadAjuda(['admin'], 'engaj-chamada');
  assert.strictEqual(admin.ajudaPerfil(), 'admin');
  assert.strictEqual(admin.ajudaUrl('engaj-chamada'), 'manual-admin.html#engajamento');
  assert.strictEqual(admin.ajudaUrl('escala-smart'), 'manual-admin.html#escala');
  assert.strictEqual(admin.ajudaUrl('fechamento'), 'manual-admin.html#fechamento');

  const superv = loadAjuda(['supervisao'], 'escala-smart');
  assert.strictEqual(superv.ajudaPerfil(), 'admin', 'supervisão lê o manual de gestão');

  const prof = loadAjuda(['professor'], 'minha-agenda');
  assert.strictEqual(prof.ajudaPerfil(), 'prof');
  assert.strictEqual(prof.ajudaUrl('minha-agenda'), 'manual-professores.html#agenda');
  assert.strictEqual(prof.ajudaUrl('escala-smart'), 'manual-professores.html#escala');
  // Tela sem seção equivalente no manual do professor → cai no topo, não em "#null"
  assert.strictEqual(prof.ajudaUrl('fechamento'), 'manual-professores.html');
  assert.strictEqual(prof.ajudaUrl('pessoas'), 'manual-professores.html');
  console.log('✓ ajudaUrl resolve manual + âncora por perfil');

  /* ── 3. Toda âncora do mapa existe mesmo no manual ─────────────── */
  const manualAdmin = fs.readFileSync(path.join(__dirname, '..', 'manual-admin.html'), 'utf8');
  const manualProf  = fs.readFileSync(path.join(__dirname, '..', 'manual-professores.html'), 'utf8');
  Object.entries(admin.AJUDA_MAP).forEach(([page, entry]) => {
    if (entry.admin) assert.ok(manualAdmin.includes(`id="${entry.admin}"`), `âncora #${entry.admin} existe no manual-admin (tela ${page})`);
    if (entry.prof)  assert.ok(manualProf.includes(`id="${entry.prof}"`),  `âncora #${entry.prof} existe no manual-professores (tela ${page})`);
  });
  console.log('✓ todas as âncoras do mapa existem nos manuais');

  /* ── 4. Botão "?" só onde há texto escrito ─────────────────────── */
  assert.strictEqual(admin.ajudaBtn('pagina-inexistente'), '', 'sem blurb, sem botão');
  assert.ok(admin.ajudaBtn('engaj-chamada').includes('toggleAjuda'), 'botão chama toggleAjuda');
  console.log('✓ ajudaBtn degrada em silêncio quando não há texto');

  /* ── 5. Pré-marcação: quem respondeu "Vou" vira presente ───────── */
  const db = makeFakeDb();
  const d = deps(db);
  const ev = (await SS.createScale({ date: '2026-08-20', tipo: 'evento', name: 'Reunião do staff 20/08', slots: [], eventKind: 'interno' }, d)).data;
  await SS.setEventStaff(ev.id, ['p1', 'p2'], ['p3', 'p4'], d); // obrigatórios nascem "Vou"
  await SS.setRsvp(ev.id, 'p3', true, d);   // opcional confirma
  await SS.setRsvp(ev.id, 'p2', false, d);  // obrigatório avisa que não vai
  // p4 fica sem responder

  const rsvp = (await SS.listEventRsvp(ev.id, d)).data;
  const resumo = SS.summarizeRsvp(rsvp);
  assert.deepStrictEqual(resumo.vao.sort(), ['p1', 'p3'], 'vão = obrigatório que não recusou + opcional que aceitou');
  assert.deepStrictEqual(resumo.naoVao, ['p2']);
  assert.deepStrictEqual(resumo.semResposta, ['p4']);

  // Espelha o que aplicarPlanejado() faz com esse resumo
  const marks = {};
  resumo.vao.forEach(pid => { if (!marks[pid]) marks[pid] = { status: 'presente' }; });
  assert.deepStrictEqual(Object.keys(marks).sort(), ['p1', 'p3'], 'só os "Vou" entram pré-marcados');
  assert.ok(!marks.p2, 'quem recusou NÃO vem marcado');
  assert.ok(!marks.p4, 'quem não respondeu NÃO vem marcado');

  // Marcação feita à mão pela gestão não é sobrescrita pela pré-marcação
  const marks2 = { p1: { status: 'faltou' } };
  resumo.vao.forEach(pid => { if (!marks2[pid]) marks2[pid] = { status: 'presente' }; });
  assert.strictEqual(marks2.p1.status, 'faltou', 'pré-marcação respeita o que a gestão já marcou');
  console.log('✓ pré-marcação do "Vou" OK (e não atropela a gestão)');

  /* ── 6. O evento aparece pro seletor da chamada só na data certa ─ */
  await SS.createScale({ date: '2026-08-21', tipo: 'evento', name: 'Beach games', slots: [] }, d);
  await SS.createScale({ date: '2026-08-20', tipo: 'sabado', name: 'Sábado', slots: [] }, d);
  const todas = (await SS.listScales(d)).data;
  const doDia = todas.filter(s => s.tipo === 'evento' && s.date === '2026-08-20');
  assert.strictEqual(doDia.length, 1, 'só o evento daquela data');
  assert.strictEqual(doDia[0].name, 'Reunião do staff 20/08');
  console.log('✓ seletor de evento filtra por tipo + data');

  console.log('\n✓ smoke-ajuda-evento: todos os casos passaram');
})().catch(e => { console.error('✗ FALHOU:', e.message); process.exit(1); });
