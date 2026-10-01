'use strict';
// Roda: node scripts/smoke-horas-do-mes-tela.js
process.env.TZ = 'America/Sao_Paulo';
//
// "Minhas horas do mês" — as TELAS e o serviço, contra um banco de mentira.
//
// Rafael, 01/10/2026: "eu acho que o professor poderia corrigir e colocar pra
// gestão validar, achei que seria assim". O caminho inteiro, com o setembro
// real do Theo: ele abre o mês, corrige os dias que foram diferentes, envia; a
// gestão vê só a diferença, valida — e as AULAS mudam, de forma que a folha
// (closing-payroll.js de verdade) passa a pagar o que foi validado.
//
// Carrega professores-horas.js num sandbox `vm` e CHAMA as funções que os
// botões chamam. Nada aqui lê o texto do arquivo.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const makeFakeDb = require('./_fake-firestore.js');
const H = require('../hour-declaration.js');
const Payroll = require('../closing-payroll.js');

const raiz = path.join(__dirname, '..');
let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };
const D = (n) => `2026-09-${String(n).padStart(2, '0')}`;
const plano = (o) => JSON.parse(JSON.stringify(o));

/* ── A agenda do Theo em setembro, gravada no banco como a produção grava ── */
async function semear(db) {
  let seq = 0;
  const grava = async (teacherId, dia, inicio, fim, extra) => {
    const id = `c${++seq}`;
    await db.collection('classes').doc(id).set(Object.assign({
      teacherId, originalTeacherId: teacherId, unitId: 'cp', modalityId: 'hiit',
      scheduledDate: new Date(dia + 'T00:00:00'), startTime: inicio, endTime: fim,
      durationMinutes: H.paraMin(fim) - H.paraMin(inicio), status: 'realizada', registroAutomatico: true,
      atrasoMinutos: 0, saidaAntecipadaMinutos: 0, horaExtraMinutos: 0, faltaTipo: null, monthClosingId: null,
    }, extra || {}));
  };
  const bloco = async (tid, dia, inicio, fim) => {
    let a = H.paraMin(inicio); const f = H.paraMin(fim);
    while (a < f) { const b = Math.min(a + 60, f); await grava(tid, dia, H.paraHHMM(a), H.paraHHMM(b)); a = b; }
  };
  for (const n of [1, 3, 8, 10, 15, 17, 22, 24, 29]) { await bloco('theo', D(n), '09:30', '13:30'); await bloco('theo', D(n), '18:00', '21:30'); }
  for (const n of [2, 9, 14, 16, 21, 23, 28, 30]) await bloco('theo', D(n), '09:30', '12:30');
  for (const n of [4, 11, 18, 25]) { await bloco('theo', D(n), '06:00', '12:30'); await bloco('theo', D(n), '18:00', '21:30'); }
  for (const n of [5, 26]) await grava('theo', D(n), '08:00', '12:00', { specialScaleType: 'sabado', generatedBy: 'escala-smart' });
  // outra pessoa, com aula em setembro e sem nada a corrigir
  for (const n of [1, 2, 3]) await bloco('bia', D(n), '07:00', '09:00');
  await grava('theo', '2026-10-01', '09:30', '10:30');   // outubro: não entra em setembro
  // Avisos que o professor já tinha mandado pela janela da aula e ninguém respondeu
  const comAviso = async (dia, inicio, aviso) => {
    const s = await db.collection('classes').where('teacherId', '==', 'theo').get();
    const c = s.docs.find(d => H.diaISO(d.data().scheduledDate) === dia && d.data().startTime === inicio);
    await db.collection('classes').doc(c.id).update({ avisoProfessor: aviso });
  };
  await comAviso(D(15), '21:00', { tipo: 'ocorrencia', horaExtraMinutos: 14, nota: 'aluno ficou' });
  await comAviso(D(2), '09:30', { tipo: 'ocorrencia', atrasoMinutos: 10 });
  await db.collection('teachers').doc('theo').set({ name: 'THEO ROSA', userId: 'u_theo', isActive: true, primaryUnitId: 'cp', modalityIds: ['hiit'] });
  await db.collection('teachers').doc('bia').set({ name: 'BIA LIMA', userId: 'u_bia', isActive: true, primaryUnitId: 'pp', modalityIds: ['hiit'] });
  await db.collection('teachers').doc('vagner').set({ name: 'VAGNER TEIXEIRA', userId: 'u_vag', isActive: true, primaryUnitId: 'pp', modalityIds: ['hiit'] });
}

function novoSandbox({ db, gestao, professorId, hoje }) {
  const els = new Map();
  const el = (id) => { if (!els.has(id)) els.set(id, { id, innerHTML: '', textContent: '', value: '', style: {} }); return els.get(id); };
  const st = { toasts: [], confirms: [], confirmReturn: true, promptReturn: 'falta o dia 12', sends: [], audits: [], navegou: [] };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document: { getElementById: el },
    db, firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
    HourDeclaration: H,
    toast: (msg, type) => st.toasts.push({ msg, type }),
    confirm: (m) => { st.confirms.push(m); return st.confirmReturn; },
    prompt: (m) => { st.confirms.push('[prompt] ' + m); return st.promptReturn; },
    escapeHtml: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    isAdminGestao: () => !!gestao, isSupervisao: () => false,
    getCurrentProfessorId: () => professorId || null,
    currentUserId: () => (gestao ? 'u_gestora' : 'u_' + professorId),
    navigateTo: (p) => st.navegou.push(p),
    AuditService: { log: async (o) => { st.audits.push(o.type); } },
    NotifyService: { send: async (o) => { st.sends.push(plano(o)); return { success: true }; } },
    AgendaState: { teachersMap: new Map(), modalitiesMap: new Map([['hiit', { id: 'hiit', name: 'Hiit' }]]), units: [{ id: 'cp', name: 'CrossTainer CP' }, { id: 'pp', name: 'CrossTainer PP' }] },
    TeacherService: { list: async () => { const s = await db.collection('teachers').get(); return { success: true, data: s.docs.map(d => Object.assign({ id: d.id }, d.data())) }; } },
    ModalityService: { list: async () => ({ success: true, data: [] }) }, UnitService: { list: async () => ({ success: true, data: [] }) },
    setTimeout, Date, Math, JSON, Promise, Map, Set, Array, Object, String, Number,
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(raiz, 'professores-horas.js'), 'utf8'), sandbox, { filename: 'professores-horas.js' });
  sandbox.horasHojeISO = () => hoje || '2026-10-01';
  const estado = () => vm.runInContext('HorasState', sandbox);
  return { sandbox, st, el, estado };
}
const decl = async (db, tid, mes) => { const d = await db.collection('hour_declarations').doc(`${tid}_${mes}`).get(); return d.exists ? d.data() : null; };
const aulasDe = async (db, tid) => (await db.collection('classes').where('teacherId', '==', tid).get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
const horasDaFolha = (aulas) => Math.round(Payroll.horasDasAulas(aulas.filter(c =>
  Payroll.STATUS_QUE_PAGAM.indexOf(c.status) !== -1 && String(H.diaISO(c.scheduledDate)).startsWith('2026-09')), new Map()) * 60);

(async () => {
  const db = makeFakeDb();
  await semear(db);

  /* ═══ PROFESSOR ═══════════════════════════════════════════════════ */
  const prof = novoSandbox({ db, professorId: 'theo' });
  const S = prof.sandbox;
  const tela = () => prof.el('page-minhas-horas').innerHTML;

  /* ── 1. Abre no mês que acabou de terminar, com a agenda em turnos ── */
  {
    await S.renderMinhasHorasPage();
    assert.strictEqual(prof.estado().mes, 9, 'no dia 01/10 a tela abre em SETEMBRO — é o mês que falta conferir');
    assert.ok(/139h30/.test(tela()), 'o total da agenda aparece');
    assert.ok(/09:30[–-]13:30/.test(tela()) && /18:00[–-]21:30/.test(tela()), 'os dias aparecem em turnos, não aula por aula');
    assert.ok((tela().match(/horasAbrirDia\('2026-09-/g) || []).length === 23, 'um botão de corrigir por dia de aula (23)');
    assert.ok(!/2026-10-01/.test(tela()), 'outubro não se mistura');
    assert.ok(/igual à agenda/i.test(tela()));
    passou('o professor abre o mês anterior já preenchido pela agenda, em turnos');
  }

  /* ── 2. Corrige um dia: o editor nasce com o que a agenda diz ──────── */
  {
    S.horasAbrirDia(D(3));
    assert.deepStrictEqual(plano(prof.estado().editor.turnos), [{ inicio: '09:30', fim: '13:30' }, { inicio: '18:00', fim: '21:30' }], 'o editor abre com os turnos da agenda — ele só mexe no que foi diferente');
    assert.ok(/type="time"/.test(tela()), 'campos de HORA (o iPhone engole horário digitado em campo de número)');

    S.horasSetTurno(1, 'inicio', '22:30');           // saída antes da entrada
    await S.horasConfirmarDia();
    assert.ok(/depois da entrada/.test(tela()), 'erro de digitação aparece na tela');
    assert.strictEqual(await decl(db, 'theo', '2026-09'), null, 'e nada é gravado');

    S.horasSetTurno(1, 'inicio', '19:30');
    await S.horasConfirmarDia();
    const d = await decl(db, 'theo', '2026-09');
    assert.strictEqual(d.status, 'rascunho', 'cada dia corrigido é guardado como rascunho — fechar o app não perde');
    assert.deepStrictEqual(d.dias[D(3)].turnos[1], { inicio: '19:30', fim: '21:30' });
    assert.ok(/−1h30/.test(tela()), 'a linha do dia mostra a diferença');
    passou('corrigir um dia: editor pré-preenchido, erro na tela, rascunho gravado');
  }

  /* ── 3. Não trabalhei · turno a mais · voltar ao da agenda ─────────── */
  {
    S.horasAbrirDia(D(5)); S.horasNaoTrabalhei(); await S.horasConfirmarDia();
    assert.strictEqual((await decl(db, 'theo', '2026-09')).dias[D(5)].naoTrabalhei, true);

    S.horasAbrirDia(D(9)); S.horasAddTurno(); S.horasSetTurno(1, 'inicio', '16:30'); S.horasSetTurno(1, 'fim', '21:30'); await S.horasConfirmarDia();
    assert.strictEqual((await decl(db, 'theo', '2026-09')).dias[D(9)].turnos.length, 2, 'dá pra acrescentar um turno que a agenda não tem');
    assert.ok(/\+5h00/.test(tela()));

    S.horasAbrirDia(D(1)); S.horasSetTurno(0, 'fim', '13:00'); await S.horasConfirmarDia();
    assert.ok((await decl(db, 'theo', '2026-09')).dias[D(1)]);
    await S.horasVoltarAgenda(D(1));
    assert.strictEqual((await decl(db, 'theo', '2026-09')).dias[D(1)], undefined, '"voltar ao da agenda" tira o dia da declaração');

    S.horasAbrirDia(D(2)); await S.horasConfirmarDia();   // abriu e confirmou sem mudar nada
    assert.strictEqual((await decl(db, 'theo', '2026-09')).dias[D(2)], undefined, 'dia igual à agenda não é gravado como diferença');
    passou('"não trabalhei", turno a mais, voltar ao da agenda, e dia sem mudança não vira diferença');
  }

  /* ── 4. Dia que não está na agenda ─────────────────────────────────── */
  {
    S.horasNovoDia('2026-10-05');
    assert.ok(prof.st.toasts.some(t => /setembro|deste mês/i.test(t.msg)), 'dia de outro mês é recusado');
    S.horasNovoDia(D(3));
    assert.ok(prof.st.toasts.some(t => /já está na lista/i.test(t.msg)), 'dia que já tem aula se corrige na própria linha');

    S.horasNovoDia(D(7));
    S.horasSetTurno(0, 'inicio', '08:00'); S.horasSetTurno(0, 'fim', '12:00');
    await S.horasConfirmarDia();
    assert.ok(/no lugar de|turno a mais/i.test(tela()) && !(await decl(db, 'theo', '2026-09')).dias[D(7)],
      'dia fora da agenda exige dizer se foi no lugar de alguém ou turno a mais');
    S.horasSetFora('no_lugar_de'); S.horasSetNoLugarDe('vagner');
    await S.horasConfirmarDia();
    assert.deepStrictEqual(plano((await decl(db, 'theo', '2026-09')).dias[D(7)]),
      { turnos: [{ inicio: '08:00', fim: '12:00' }], naoTrabalhei: false, foraDaAgenda: 'no_lugar_de', noLugarDe: 'vagner', obs: '' });
    assert.ok(/VAGNER TEIXEIRA/.test(tela()), 'a linha mostra no lugar de quem');
    passou('dia fora da agenda: só do mês, e dizendo se foi no lugar de alguém');
  }

  /* ── 5. Enviar para a gestão ───────────────────────────────────────── */
  {
    // o resto da lista dele, direto no estado (o caminho do clique já foi provado acima)
    const t = (...p) => ({ turnos: p.map(x => ({ inicio: x[0], fim: x[1] })), naoTrabalhei: false, foraDaAgenda: null, noLugarDe: null, obs: '' });
    const resto = {
      [D(4)]: t(['06:30', '12:30'], ['16:30', '21:30']), [D(8)]: t(['09:30', '13:30'], ['16:30', '21:30']),
      [D(10)]: t(['09:30', '13:30'], ['16:30', '21:30']), [D(11)]: t(['08:00', '13:00'], ['16:30', '21:30']),
      [D(14)]: t(['09:30', '12:30'], ['16:30', '21:30']), [D(15)]: t(['09:30', '13:30'], ['16:30', '21:44']),
      [D(16)]: t(['09:30', '12:30'], ['16:30', '21:30']), [D(17)]: t(['09:30', '13:30'], ['16:30', '21:30']),
      [D(18)]: t(['07:30', '12:30'], ['16:30', '21:30']),
      [D(19)]: Object.assign(t(['08:00', '12:50']), { foraDaAgenda: 'no_lugar_de' }),
      [D(21)]: t(['09:30', '12:36'], ['16:30', '21:30']), [D(22)]: t(['09:30', '13:35'], ['16:30', '21:30']),
      [D(23)]: t(['09:30', '12:30'], ['16:30', '21:30']), [D(25)]: t(['06:30', '12:30']),
      [D(26)]: { turnos: [], naoTrabalhei: true, foraDaAgenda: null, noLugarDe: null, obs: '' },
      [D(29)]: t(['09:30', '13:30'], ['17:00', '19:00']),
    };
    Object.assign(prof.estado().dias, resto);
    prof.st.confirms.length = 0;
    await S.horasEnviar();
    assert.ok(/167h15/.test(prof.st.confirms[0]) && /139h30/.test(prof.st.confirms[0]) && /\+27h45/.test(prof.st.confirms[0]), 'a confirmação mostra agenda, informado e diferença: ' + prof.st.confirms[0]);
    const d = await decl(db, 'theo', '2026-09');
    assert.strictEqual(d.status, 'enviada');
    assert.deepStrictEqual(plano(d.resumo), { minutosAgenda: 8370, minutosInformados: 10035, diasDiferentes: 18 }, 'o resumo vai gravado, pra lista da gestão não ter que recalcular pra mostrar');
    assert.strictEqual(d.teacherId, 'theo'); assert.strictEqual(d.mes, '2026-09');
    assert.ok(/Esperando a gestão/i.test(tela()), 'a tela passa a dizer em que pé está');
    assert.strictEqual(horasDaFolha(await aulasDe(db, 'theo')), 8370, 'NADA mudou nas aulas ainda — enviar não é valer');
    passou('enviar grava a declaração com o resumo, e não mexe em aula nenhuma');
  }

  /* ── 6. "Está tudo igual à agenda" ─────────────────────────────────── */
  {
    const bia = novoSandbox({ db, professorId: 'bia' });
    await bia.sandbox.renderMinhasHorasPage();
    await bia.sandbox.horasConfirmarIgual();
    const d = await decl(db, 'bia', '2026-09');
    assert.deepStrictEqual({ s: d.status, i: d.semDiferenca, n: Object.keys(d.dias || {}).length }, { s: 'enviada', i: true, n: 0 });
    assert.ok(/conferid/i.test(bia.el('page-minhas-horas').innerHTML), 'a tela confirma que o mês está conferido');
    // quem TEM diferença não pode dizer "tudo igual" por engano
    prof.st.toasts.length = 0;
    await S.horasConfirmarIgual();
    assert.ok(prof.st.toasts.some(t => t.type === 'error') && (await decl(db, 'theo', '2026-09')).semDiferenca !== true, '"tudo igual" com dia corrigido é recusado');
    passou('"tudo igual à agenda" confere o mês num toque; com diferença, é recusado');
  }

  /* ── 6b. Mês em andamento: dá pra corrigir, não dá pra enviar ──────── */
  {
    const dbm = makeFakeDb(); await semear(dbm);
    const meio = novoSandbox({ db: dbm, professorId: 'theo', hoje: '2026-09-16' });
    await meio.sandbox.renderMinhasHorasPage();
    const html = () => meio.el('page-minhas-horas').innerHTML;
    assert.strictEqual(meio.estado().mes, 9, 'depois do dia 10 a tela abre no mês corrente');
    assert.strictEqual((html().match(/horasAbrirDia\('2026-09-/g) || []).length, 12, 'só os dias que já passaram (12 até 16/09)');
    assert.ok(!/horasEnviar\(\)|horasConfirmarIgual\(\)/.test(html()) && /última aula/.test(html()), 'sem botão de enviar, e dizendo quando abre');
    meio.sandbox.horasNovoDia(D(20));
    assert.ok(meio.st.toasts.some(t => /ainda não chegou/.test(t.msg)), 'dia futuro não se declara');
    meio.sandbox.horasAbrirDia(D(9)); meio.sandbox.horasAddTurno(); meio.sandbox.horasSetTurno(1, 'inicio', '16:30'); meio.sandbox.horasSetTurno(1, 'fim', '21:30');
    await meio.sandbox.horasConfirmarDia();
    assert.strictEqual((await decl(dbm, 'theo', '2026-09')).status, 'rascunho', 'o dia corrigido fica guardado');
    await meio.sandbox.horasEnviar();
    assert.strictEqual((await decl(dbm, 'theo', '2026-09')).status, 'rascunho', 'e o envio é recusado até o mês acabar');
    assert.ok(meio.st.toasts.some(t => t.type === 'error' && /última aula/.test(t.msg)));
    passou('mês em andamento: corrige dia a dia, mas só envia depois da última aula');
  }

  /* ── 6c. Vale o que está NO CAMPO, mesmo sem o evento de mudança ───── */
  {
    // Achado clicando no staging (01/10/2026): o horário foi trocado no campo e
    // o evento "change" não chegou — a tela confirmou o dia com o horário velho.
    // É o mesmo defeito do "Enviar para a gestão" do iPhone: confiar no evento
    // em vez de ler o que a pessoa está vendo.
    const dbc = makeFakeDb(); await semear(dbc);
    const c = novoSandbox({ db: dbc, professorId: 'theo' });
    await c.sandbox.renderMinhasHorasPage();
    c.sandbox.horasAbrirDia(D(2));
    const campo = (valor, turno, qual) => ({ value: valor, getAttribute: (a) => ({ 'data-turno': String(turno), 'data-campo': qual }[a]) });
    c.sandbox.document.querySelectorAll = (sel) => (/horas-editor/.test(sel) ? [campo('09:30', 0, 'inicio'), campo('13:10', 0, 'fim')] : []);
    await c.sandbox.horasConfirmarDia();
    const d = await decl(dbc, 'theo', '2026-09');
    assert.ok(d && d.dias[D(2)], 'o dia foi gravado como diferente da agenda');
    assert.deepStrictEqual(plano(d.dias[D(2)].turnos), [{ inicio: '09:30', fim: '13:10' }], 'com o horário que está no campo');
    passou('confirmar o dia lê o que está no campo, não só o que o evento avisou');
  }

  /* ═══ GESTÃO ══════════════════════════════════════════════════════ */
  const ges =novoSandbox({ db, gestao: true });
  const G = ges.sandbox;
  const telaG = () => ges.el('page-horas-do-mes').innerHTML;

  /* ── 7. A lista: quem enviou, quem conferiu, quem não conferiu ─────── */
  {
    await G.renderHorasGestaoPage();
    const html = telaG();
    assert.ok(/THEO ROSA/.test(html) && /\+27h45/.test(html) && /Esperando a gestão/.test(html), 'o Theo aparece com a diferença e esperando o OK');
    assert.ok(/BIA LIMA/.test(html) && /tudo igual/i.test(html), 'a Bia aparece como conferida, sem pedir OK');
    assert.ok(/horasGestaoValidar\('theo'\)/.test(html) && !/horasGestaoValidar\('bia'\)/.test(html), 'só quem tem diferença tem botão de validar');
    assert.ok(/horasGestaoValidarTodas\(\)/.test(html) && /1 pessoa/.test(html), 'e existe o OK geral, dizendo quantas');
    passou('a gestão vê a lista do mês: diferença de cada um e o OK geral');
  }

  /* ── 8. Ver o que muda antes de validar ────────────────────────────── */
  {
    await G.horasGestaoVer('theo');
    const html = telaG();
    assert.ok(/16:30[–-]21:30/.test(html) && /turno novo/i.test(html), 'mostra os turnos que não existiam na agenda');
    assert.ok(/não realizada/i.test(html), 'as aulas que ele não deu');
    assert.ok(/no lugar de/i.test(html) && /VAGNER TEIXEIRA/.test(html), 'e o que não vira hora: trabalhou no lugar de alguém → registrar a troca');
    assert.ok(/\+18h55/.test(html), 'e quanto entra na folha se validar (o resto espera a troca)');
    passou('antes de validar, a gestão vê dia a dia o que muda nas aulas');
  }

  /* ── 9. Validar: as aulas mudam e a folha acompanha ────────────────── */
  {
    ges.st.confirms.length = 0;
    await G.horasGestaoValidar('theo');
    assert.ok(/THEO ROSA/.test(ges.st.confirms[0]) && /18h55/.test(ges.st.confirms[0]), 'a confirmação diz de quem e quanto entra: ' + ges.st.confirms[0]);
    const aulas = await aulasDe(db, 'theo');
    assert.strictEqual(horasDaFolha(aulas), 8370 + 1135, 'a FOLHA (closing-payroll.js) passa a contar 158h25: agenda + o que foi validado');
    const novas = aulas.filter(c => c.generatedBy === 'horas-do-mes');
    assert.strictEqual(novas.length, 5, 'cinco turnos novos: as noites de segunda e quarta');
    assert.ok(novas.every(c => c.status === 'realizada' && c.unitId === 'cp' && c.horasDeclaracaoId === 'theo_2026-09' && c.adjustedBy === 'u_gestora'), 'com a origem e quem validou');
    const noite3 = aulas.find(c => H.diaISO(c.scheduledDate) === D(3) && c.startTime === '18:00');
    assert.deepStrictEqual({ s: noite3.status, f: noite3.faltaTipo, a: noite3.registroAutomatico }, { s: 'nao_realizada', f: null, a: false }, 'a aula que ele não deu sai da folha, sem virar falta');
    const d = await decl(db, 'theo', '2026-09');
    assert.deepStrictEqual({ s: d.status, por: d.validadaPor, delta: d.aplicado.deltaMinutos, pend: d.aplicado.minutosPendentes },
      { s: 'validada', por: 'u_gestora', delta: 1135, pend: 530 });
    assert.ok(ges.st.sends.some(s => s.recipients[0] === 'u_theo' && s.type === 'horas_validadas' && /18h55/.test(s.body)), 'o professor é avisado do que entrou');
    assert.ok(ges.st.sends.some(s => /no lugar de/i.test(s.body)), 'e de que os dias "no lugar de alguém" dependem da troca');
    assert.ok(ges.st.audits.indexOf('horas_validadas') !== -1, 'fica na auditoria');
    passou('validar aplica o plano nas aulas: a folha paga 158h25 e o professor é avisado');

    const a15 = aulas.find(c => H.diaISO(c.scheduledDate) === D(15) && c.startTime === '21:00');
    assert.strictEqual(a15.avisoProfessor, null, 'o aviso da aula de um dia DECLARADO deixa de ficar pendente');
    assert.deepStrictEqual({ d: a15.avisoProfessorAtendido.decisao, x: a15.horaExtraMinutos, n: a15.avisoProfessorAtendido.nota },
      { d: 'horas_do_mes', x: 14, n: 'aluno ficou' }, 'fica registrado como respondido pelas horas do mês, e vale o horário informado');
    const a2 = aulas.find(c => H.diaISO(c.scheduledDate) === D(2) && c.startTime === '09:30');
    assert.ok(a2.avisoProfessor && a2.avisoProfessor.atrasoMinutos === 10 && !a2.avisoProfessorAtendido,
      'aviso de dia que ele NÃO declarou continua esperando a gestão');
    assert.strictEqual(d.aplicado.avisosAbsorvidos, 1);
    passou('o aviso já mandado num dia declarado fica respondido; o de outro dia continua pendente');

    // de novo: não duplica
    await G.horasGestaoValidar('theo');
    const de_novo = await aulasDe(db, 'theo');
    assert.strictEqual(horasDaFolha(de_novo), 8370 + 1135, 'validar duas vezes não soma duas vezes');
    assert.strictEqual(de_novo.filter(c => c.generatedBy === 'horas-do-mes').length, 5, 'nem cria turno repetido');
    passou('validar de novo a mesma declaração não muda mais nada');
  }

  /* ── 10. Depois de validada, o professor só lê ─────────────────────── */
  {
    await S.renderMinhasHorasPage();
    assert.ok(/Validada/i.test(tela()) && !/horasAbrirDia\(/.test(tela()), 'mês validado: sem botão de corrigir');
    assert.ok(/158h25/.test(tela()), 'e a agenda dele já mostra as horas validadas');
    passou('mês validado fica só para leitura na tela do professor');
  }

  /* ── 11. Devolver, fechar valendo a agenda, corrigir por ele ───────── */
  {
    const db2 = makeFakeDb(); await semear(db2);
    const p2 = novoSandbox({ db: db2, professorId: 'theo' });
    await p2.sandbox.renderMinhasHorasPage();
    p2.sandbox.horasAbrirDia(D(9)); p2.sandbox.horasAddTurno(); p2.sandbox.horasSetTurno(1, 'inicio', '16:30'); p2.sandbox.horasSetTurno(1, 'fim', '21:30');
    await p2.sandbox.horasConfirmarDia(); await p2.sandbox.horasEnviar();
    const g2 = novoSandbox({ db: db2, gestao: true });
    await g2.sandbox.renderHorasGestaoPage();

    await g2.sandbox.horasGestaoDevolver('theo');
    let d = await decl(db2, 'theo', '2026-09');
    assert.deepStrictEqual({ s: d.status, m: d.devolvidaMotivo }, { s: 'devolvida', m: 'falta o dia 12' });
    assert.ok(g2.st.sends.some(s => s.type === 'horas_devolvidas' && /falta o dia 12/.test(s.body)), 'o professor recebe o motivo');
    await p2.sandbox.renderMinhasHorasPage();
    assert.ok(/falta o dia 12/.test(p2.el('page-minhas-horas').innerHTML) && /horasAbrirDia\(/.test(p2.el('page-minhas-horas').innerHTML), 'e volta a poder corrigir, vendo o motivo');
    passou('devolver: o professor recebe o motivo e pode corrigir de novo');

    await g2.sandbox.horasGestaoDispensar('bia');
    d = await decl(db2, 'bia', '2026-09');
    assert.deepStrictEqual({ s: d.status, por: d.dispensadaPor }, { s: 'dispensada', por: 'u_gestora' }, '"fechar valendo a agenda" fica registrado, com quem decidiu');
    assert.ok(/BIA LIMA/.test(g2.st.confirms[g2.st.confirms.length - 1]), 'e pede confirmação dizendo de quem');
    passou('"fechar valendo a agenda" registra a decisão da gestão');

    // A gestão lança pelas horas de alguém (foi o que o Theo fez: mandou a lista pelo WhatsApp)
    await g2.sandbox.horasGestaoCorrigir('theo');
    assert.strictEqual(g2.estado().alvo, 'theo');
    assert.ok(/THEO ROSA/.test(g2.el('page-horas-do-mes').innerHTML) && /horasAbrirDia\(/.test(g2.el('page-horas-do-mes').innerHTML), 'a gestão abre o mesmo editor, no nome dele');
    g2.sandbox.horasAbrirDia(D(14)); g2.sandbox.horasAddTurno(); g2.sandbox.horasSetTurno(1, 'inicio', '16:30'); g2.sandbox.horasSetTurno(1, 'fim', '21:30');
    await g2.sandbox.horasConfirmarDia(); await g2.sandbox.horasEnviar();
    d = await decl(db2, 'theo', '2026-09');
    assert.deepStrictEqual({ s: d.status, g: d.lancadaPelaGestao, n: Object.keys(d.dias).length }, { s: 'enviada', g: true, n: 2 }, 'fica marcado que foi a gestão que lançou');
    passou('a gestão consegue lançar as horas por alguém (lista que chegou por WhatsApp)');

    await g2.sandbox.renderHorasGestaoPage();
    await g2.sandbox.horasGestaoValidarTodas();
    assert.strictEqual((await decl(db2, 'theo', '2026-09')).status, 'validada', 'o OK geral valida quem estava esperando');
    assert.strictEqual(horasDaFolha(await aulasDe(db2, 'theo')), 8370 + 600);
    passou('OK geral valida todas as enviadas de uma vez');

    // mês fechado: nem a gestão valida
    const db3 = makeFakeDb(); await semear(db3);
    const p3 = novoSandbox({ db: db3, professorId: 'theo' });
    await p3.sandbox.renderMinhasHorasPage();
    p3.sandbox.horasAbrirDia(D(5)); p3.sandbox.horasNaoTrabalhei(); await p3.sandbox.horasConfirmarDia(); await p3.sandbox.horasEnviar();
    const todas = await aulasDe(db3, 'theo');
    await db3.collection('classes').doc(todas[0].id).update({ monthClosingId: '2026-09' });
    const g3 = novoSandbox({ db: db3, gestao: true });
    await g3.sandbox.renderHorasGestaoPage(); await g3.sandbox.horasGestaoValidar('theo');
    assert.strictEqual((await decl(db3, 'theo', '2026-09')).status, 'enviada', 'mês fechado não se mexe');
    assert.ok(g3.st.toasts.some(t => t.type === 'error' && /fechado/i.test(t.msg)));
    passou('mês já fechado: validação recusada');

    const fora = novoSandbox({ db: db2, professorId: 'theo' });
    await fora.sandbox.renderHorasGestaoPage();
    assert.ok(!/horasGestaoValidar/.test(fora.el('page-horas-do-mes').innerHTML), 'professor não vê a tela da gestão');
    passou('a tela da gestão é só da gestão');
  }

  console.log(`\n${ok} verificações ✓`);
})().catch(e => { console.error('✗', e.stack || e.message); process.exit(1); });
