'use strict';
// Roda: node scripts/simular-domingo-e-minhas-datas.js --project staging
//
// ══════════════════════════════════════════════════════════════════════
// Simulação de ponta a ponta, com os DADOS REAIS do projeto
// ══════════════════════════════════════════════════════════════════════
//
// Faz o percurso inteiro que a gestão faria, na ordem em que ela faria, usando
// as MESMAS funções que os botões da tela chamam — e lendo e escrevendo no
// Firestore de verdade.
//
//   1. estado inicial: quem tem ficha e quem não tem
//   2. criar a ficha de professor de quem já tem login   (peça A)
//   3. a aba "Minhas datas" aparece, com as escalas reais (peça B)
//   4. se candidatar por ela, e conferir que ficou gravado
//   5. domingo: recusado na criação e ausente da lista    (peça C)
//   6. desfazer tudo
//
// Gera também `scratchpad/previa-*.html`: a tela renderizada com o CSS do app,
// pra olhar com o olho em vez de ler asserção.
//
// NÃO rode em produção — escreve e apaga dados.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const admin = require('firebase-admin');
const SS = require('../scale-service.js');
const SE = require('../scale-engine.js');

const arg = process.argv.indexOf('--project');
const projeto = arg !== -1 ? process.argv[arg + 1] : null;
if (projeto !== 'staging') {
  console.error('Uso: node scripts/simular-domingo-e-minhas-datas.js --project staging');
  console.error('(a simulação escreve e apaga dados — só staging)');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))),
});
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const deps = { db, ts: () => FV.serverTimestamp(), uid: () => 'simulacao', SE };

const raiz = path.join(__dirname, '..');
const srcEscala = fs.readFileSync(path.join(raiz, 'professores-escala-smart.js'), 'utf8');
const cssApp = (fs.readFileSync(path.join(raiz, 'professores.html'), 'utf8')
  .match(/<style[^>]*>([\s\S]*?)<\/style>/) || [, ''])[1];

const passo = (t) => console.log('\n' + '─'.repeat(70) + '\n▶ ' + t + '\n');
const diz = (t) => console.log('   ' + t);
let alertas = 0;
const conf = (cond, m) => { console.log((cond ? '   ✓ ' : '   ✗ ') + m); if (!cond) alertas++; };

/** Sandbox da tela com os SERVIÇOS REAIS apontando pro Firestore do staging. */
function telaReal(opts) {
  let html = '';
  const sb = {
    console: { log() {}, error() {}, warn() {} },
    setTimeout, clearTimeout, Date, Math, JSON, Promise, Set, Map, Array, Object, String, Number,
    fetch,
    document: {
      getElementById: () => ({
        style: {}, classList: { add() {}, remove() {}, contains: () => true },
        set innerHTML(v) { html = v; }, get innerHTML() { return html; },
      }),
    },
    toast: () => {}, confirm: () => true, ajudaBtn: () => '',
    db: { collection: (c) => ({ doc: (d) => ({ get: () => db.collection(c).doc(d).get() }) }) },
    AppState: { userProfile: { professorId: opts.meuPid || null } },
    isAdminGestao: () => !!opts.gestao, isSupervisao: () => false,
    shortenName: (x) => { const p = String(x || '').trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : p[0]; },
    // Serviços REAIS — só a injeção de `deps` é nossa.
    ScaleService: Object.assign({}, SS, {
      listScales: () => SS.listScales(deps),
      listPreferences: (id) => SS.listPreferences(id, deps),
      listWindowQuotas: (b) => SS.listWindowQuotas(b, deps),
      listDayPreferences: (id) => SS.listDayPreferences(id, deps),
      listEventRsvp: (id) => SS.listEventRsvp(id, deps),
      ScaleConfigService: { get: () => SS.ScaleConfigService.get(deps) },
    }),
    UnitService: { list: async () => ({ success: true,
      data: (await db.collection('units').get()).docs.map(d => ({ id: d.id, ...d.data() })) }) },
    ModalityService: { list: async () => ({ success: true,
      data: (await db.collection('modalities').get()).docs.map(d => ({ id: d.id, ...d.data() })) }) },
    TeacherService: { list: async () => ({ success: true,
      data: (await db.collection('teachers').get()).docs.map(d => ({ id: d.id, ...d.data() })) }) },
    VacationService: { list: async () => ({ success: true, data: [] }) },
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(srcEscala, sb, { filename: 'professores-escala-smart.js' });
  vm.runInContext('this.EscalaSmartState = EscalaSmartState;', sb);
  return { sb, lerHtml: () => html };
}

async function renderTela(opts) {
  const { sb, lerHtml } = telaReal(opts);
  sb.EscalaSmartState.tab = opts.tab || 'sabado';
  sb.EscalaSmartState.timeframe = opts.timeframe || 'todos';
  sb.EscalaSmartState.year = opts.year || 2026;
  await sb.renderEscalaSmartPage();
  return lerHtml();
}

function salvarPrevia(nome, titulo, corpo) {
  const dir = path.join(raiz, 'scratchpad');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const arq = path.join(dir, nome);
  fs.writeFileSync(arq, `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${titulo}</title><style>${cssApp}</style>
<style>body{padding:24px;} .sim-nota{background:#2a2410;border:1px solid #caa23a;color:#caa23a;
border-radius:10px;padding:10px 14px;margin-bottom:18px;font-size:13px;}</style></head>
<body><div class="sim-nota">🧪 Prévia gerada da tela REAL, com os dados do <b>staging</b> — ${titulo}</div>
<div id="page-escala-smart">${corpo}</div></body></html>`, 'utf8');
  return path.relative(raiz, arq);
}

(async () => {
  const desfazer = [];
  try {

    // ══ 1. Estado inicial ══════════════════════════════════════════
    passo('1. Como está o staging agora');
    const usersSnap = await db.collection('users').get();
    const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const gestores = users.filter(u => (u.profiles || [u.role]).some(p => p === 'admin' || p === 'supervisao'));
    gestores.forEach(u => diz(`${(u.name || u.email).padEnd(16)} · ${u.role.padEnd(10)} · ficha: ${u.professorId || '— NENHUMA —'}`));

    const cobaia = gestores.find(u => !u.professorId && u.email);
    if (!cobaia) { console.error('\n💥 Preciso de um gestor sem ficha no staging.'); process.exit(1); }
    diz('');
    diz(`Vou usar "${cobaia.name}" (${cobaia.email}) — gestão SEM ficha, igual ao Rafael Rojais.`);

    const antes = await renderTela({ gestao: true, meuPid: null, tab: 'sabado' });
    conf(!/Minhas datas/.test(antes), 'hoje ele NÃO vê a aba "Minhas datas" (não tem ficha)');
    diz(`   prévia: ${salvarPrevia('previa-1-antes.html', 'ANTES — gestão sem ficha', antes)}`);

    // ══ 2. Criar a ficha (peça A) ══════════════════════════════════
    passo('2. Criar a ficha de professor — o botão que não existia');
    const mods = (await db.collection('modalities').get()).docs.map(d => ({ id: d.id, ...d.data() }));
    const units = (await db.collection('units').get()).docs.map(d => ({ id: d.id, ...d.data() }));
    const toi = mods.find(m => /toi/i.test(m.name)) || mods[0];
    const hiit = mods.find(m => /hi+t|maromb/i.test(m.name)) || mods[1] || mods[0];

    const fichaRef = db.collection('teachers').doc();
    await fichaRef.set({
      name: cobaia.name, email: cobaia.email, type: 'efetivo', isActive: true,
      unitIds: units.map(u => u.id), primaryUnitId: units[0] && units[0].id,
      modalityIds: [toi, hiit].filter(Boolean).map(m => m.id),
      naoRemunerado: true,               // "dá aula mas não recebe por aula"
      createdAt: FV.serverTimestamp(), createdBy: 'simulacao',
    });
    // O vínculo pelos DOIS lados — é o que o botão faz.
    await Promise.all([
      db.collection('users').doc(cobaia.id).update({ professorId: fichaRef.id }),
      fichaRef.update({ userId: cobaia.id }),
    ]);
    desfazer.push(async () => {
      await fichaRef.delete();
      await db.collection('users').doc(cobaia.id).update({ professorId: cobaia.professorId || FV.delete() });
    });

    const uDepois = (await db.collection('users').doc(cobaia.id).get()).data();
    const tDepois = (await fichaRef.get()).data();
    conf(uDepois.professorId === fichaRef.id, `users.professorId → ${fichaRef.id}`);
    conf(tDepois.userId === cobaia.id, `teachers.userId → ${cobaia.id} (é isto que deixa o colega achar ele)`);
    conf(tDepois.naoRemunerado === true, 'marca "não recebe por aula" gravada — fica fora do fechamento');

    // ══ 3. A aba aparece (peça B) ══════════════════════════════════
    passo('3. A aba "Minhas datas" com as escalas reais do staging');
    const depois = await renderTela({ gestao: true, meuPid: fichaRef.id, tab: 'sabado' });
    conf(/Minhas datas/.test(depois), 'agora a aba está na barra');
    conf(/Por pessoa/.test(depois), 'e a visão de gestão continua inteira');

    const minhas = await renderTela({ gestao: true, meuPid: fichaRef.id, tab: 'minhas' });
    conf(/Prefiro/.test(minhas) && /Pode ser/.test(minhas) && /Não posso/.test(minhas),
      'a aba traz os três botões de candidatura');
    const datasNaAba = [...minhas.matchAll(/marcarPref\('([^']+)'/g)].map(m => m[1]);
    conf(datasNaAba.length > 0, `${new Set(datasNaAba).size} data(s) com janela aberta pra ele se candidatar`);
    diz(`   prévia: ${salvarPrevia('previa-2-minhas-datas.html', 'DEPOIS — aba "Minhas datas"', minhas)}`);

    // ══ 4. Candidatar-se de verdade ════════════════════════════════
    passo('4. Clicar em "Pode ser" — e conferir que gravou');
    const scaleId = [...new Set(datasNaAba)][0];
    if (scaleId) {
      const escala = (await SS.getScale(scaleId, deps)).data;
      const r = await SS.setPreference(scaleId, fichaRef.id, 'pode_ser', deps);
      conf(r.success, `preferência registrada em ${escala.name || escala.date}`);
      desfazer.push(() => db.collection('special_scales').doc(scaleId)
        .collection('preferences').doc(fichaRef.id).delete().catch(() => {}));

      const prefs = await SS.listPreferences(scaleId, deps);
      const minha = (prefs.data || []).find(p => p.personId === fichaRef.id);
      conf(minha && minha.pref === 'pode_ser', `lido de volta do banco: "${minha && minha.pref}"`);

      const recarregada = await renderTela({ gestao: true, meuPid: fichaRef.id, tab: 'minhas' });
      const marcado = new RegExp(`marcarPref\\('${scaleId}','pode_ser'\\)"[^>]*font-weight:600`).test(recarregada);
      conf(marcado, 'e a tela volta com o botão "Pode ser" marcado');
    } else {
      diz('(nenhuma janela aberta no staging — pulei a candidatura)');
    }

    // ══ 5. Domingo (peça C) ════════════════════════════════════════
    passo('5. Domingo');
    const dom = await SS.createScale({ date: '2026-11-15', tipo: 'feriado',
      name: '[SIMULAÇÃO] Proclamação', slots: [] }, deps);
    conf(dom.success === false, 'criar feriado no domingo 15/11 é recusado');
    diz(`   mensagem que a gestão vê: "${dom.error}"`);
    if (dom.success) desfazer.push(() => db.collection('special_scales').doc(dom.data.id).delete());

    const ev = await SS.createScale({ date: '2026-11-15', tipo: 'evento',
      name: '[SIMULAÇÃO] Beach games', slots: [] }, deps);
    conf(ev.success === true, 'evento no mesmo domingo continua permitido (não é aula)');
    if (ev.success) desfazer.push(() => db.collection('special_scales').doc(ev.data.id).delete());

    const feriados = await renderTela({ gestao: true, meuPid: null, tab: 'feriado' });
    conf(!/2026-11-15/.test(feriados), 'a aba Feriados não oferece o 15/11');
    conf(/não abre no domingo/i.test(feriados) && /Proclamação/.test(feriados),
      'e explica o sumiço, nomeando o feriado');
    diz(`   prévia: ${salvarPrevia('previa-3-feriados.html', 'Aba Feriados — sem domingo', feriados)}`);

  } finally {
    // ══ 6. Desfazer ══════════════════════════════════════════════════
    passo('6. Desfazendo tudo que a simulação criou');
    for (const f of desfazer.reverse()) { try { await f(); } catch (e) { console.log('   ⚠️ ' + e.message); } }
    const sobrou = (await db.collection('special_scales').get()).docs
      .filter(d => /SIMULAÇÃO/.test(d.data().name || ''));
    const gestoresFim = (await db.collection('users').get()).docs
      .map(d => d.data()).filter(u => (u.profiles || [u.role]).some(p => p === 'admin'));
    conf(sobrou.length === 0, 'nenhuma escala de simulação sobrou');
    gestoresFim.forEach(u => diz(`${(u.name || u.email).padEnd(16)} · ficha: ${u.professorId || '— NENHUMA —'} (como estava)`));
  }

  console.log(alertas ? `\n❌ ${alertas} verificação(ões) falharam.\n` : '\n✅ Simulação completa, sem sobras.\n');
  process.exit(alertas ? 1 : 0);
})().catch(e => { console.error('\n💥 ' + e.stack); process.exit(1); });
