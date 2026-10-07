'use strict';
// Roda: node scripts/smoke-falta-do-dia-tela.js
process.env.TZ = 'America/Sao_Paulo';
//
// A janela "Lançar falta do dia" de verdade (pedido da gestão, 07/10/2026):
// carrega os ARQUIVOS REAIS (serviço, agenda e a tela) contra um banco de
// mentira, desenha, clica e confere o que ficou gravado. A falta passa pelo
// ClassService.updateStatus de produção; a troca de professor é simulada como
// nos outros smokes (registra, confirma, e a "Function" move a aula na hora).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const makeFakeDb = require('./_fake-firestore.js');
const H = require('../hour-declaration.js');
const F = require('../falta-do-dia.js');

const raiz = path.join(__dirname, '..');
let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };
const texto = (html) => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const DIA = '2026-10-06';

async function semear(db) {
  const aula = (id, teacherId, unitId, ini, fim, extra) => {
    const [h, mi] = ini.split(':').map(Number);
    return db.collection('classes').doc(id).set(Object.assign({
      teacherId, originalTeacherId: teacherId, unitId, modalityId: 'hiit',
      scheduledDate: new Date(2026, 9, 6, h, mi), startTime: ini, endTime: fim, durationMinutes: 60,
      status: 'realizada', registroAutomatico: true, monthClosingId: null, faltaTipo: null,
      atrasoMinutos: 0, saidaAntecipadaMinutos: 0, horaExtraMinutos: 0,
    }, extra || {}));
  };
  // A Eduarda: três aulas na CP de manhã, uma na PP à noite, uma cancelada.
  await aula('e1', 'edu', 'cp', '07:00', '08:00');
  await aula('e2', 'edu', 'cp', '08:00', '09:00', { avisoProfessor: { tipo: 'nao_aconteceu', nota: 'passei mal', por: 'u_edu' } });
  await aula('e3', 'edu', 'cp', '09:00', '10:00');
  await aula('e4', 'edu', 'pp', '18:00', '19:00');
  await aula('e5', 'edu', 'pp', '19:00', '20:00', { status: 'cancelada' });
  // A Bia tem aula às 18:00 na CP (choque se assumir a e4); o Theo está livre.
  await aula('b1', 'bia', 'cp', '18:00', '19:00');
  await aula('t1', 'theo', 'cp', '06:00', '07:00');
  // Outro dia: não pode aparecer.
  await db.collection('classes').doc('ontem').set({ teacherId: 'edu', unitId: 'cp', scheduledDate: new Date(2026, 9, 5, 7), startTime: '07:00', endTime: '08:00', status: 'realizada', monthClosingId: null });
}

function novaTela({ db, gestao = true, confirma = true }) {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) {
      const classes = new Set();
      els.set(id, { id, innerHTML: '', textContent: '', value: '', style: {},
        classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) } });
    }
    return els.get(id);
  };
  const st = { toasts: [], confirms: [], confirma, sends: [], trocas: [], recarregou: 0, falharFaltaEm: null };
  const noop = () => {};
  const chain = () => new Proxy(function () {}, { get: () => chain(), apply: () => chain() });
  const sandbox = {
    console: { log: noop, warn: noop, error: noop },
    window: {}, document: { addEventListener: noop, getElementById: el, querySelector: () => null },
    firebase: { firestore: Object.assign(chain(), { FieldValue: { serverTimestamp: () => 'TS' }, Timestamp: { now: noop, fromDate: (d) => d } }), auth: chain, apps: [] },
    db, auth: chain(), ClassAvisos: require('../class-avisos.js'), HourDeclaration: H, FaltaDoDia: F,
    AppState: { currentUser: { uid: 'u_gestora' }, userProfile: { name: 'Benny' }, currentPage: 'agenda-geral' },
    isAdminGestao: () => gestao, isSupervisao: () => false, getCurrentProfessorId: () => (gestao ? null : 'edu'),
    toast: (msg, type) => st.toasts.push({ msg, type }),
    confirm: (m) => { st.confirms.push(m); return st.confirma; },
    NotifyService: { send: async (o) => { st.sends.push(JSON.parse(JSON.stringify(o))); return { success: true }; } },
    __st: st,
    setTimeout, clearTimeout, Map, Set, Date, Math, JSON, String, Number, Array, Object, Boolean, RegExp, Promise, Error,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const carregar = (f) => vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8'), sandbox, { filename: f });
  carregar('substitution-flow.js');
  sandbox.SubstitutionFlow = sandbox.window.SubstitutionFlow;
  carregar('professores-shared.js');
  sandbox.ProfHelpers = sandbox.ProfHelpers || sandbox.window.ProfHelpers;
  carregar('professores-agenda.js');
  carregar('professores-falta-dia.js');

  // A troca de professor: registra, a gestão confirma, e a "Function" move a aula na hora.
  sandbox.__subs = {
    async create(p) { st.trocas.push(Object.assign({ passo: 'create' }, p)); return { success: true, data: { id: 's' + st.trocas.length, classId: p.classId } }; },
    async homologar(subId) {
      const t = st.trocas[Number(subId.slice(1)) - 1];
      st.trocas.push({ passo: 'homologar', subId });
      await db.collection('classes').doc(t.classId).update({ teacherId: t.substituteTeacherId, status: 'substituida' });
      return { success: true };
    },
    async listAbertasNoPeriodo() { return { success: true, data: st.subsAbertas || [] }; },
  };
  vm.runInContext(`
    Object.assign(SubstitutionService, __subs);
    faltaDiaAgora = () => new Date(2026, 9, 7, 10, 0);   // 07/10, 10h: o dia 06 já passou
    faltaDiaEsperar = async () => {};
    recarregarAgendaAtual = async () => { __st.recarregou++; };
    const __updateDeVerdade = ClassService.updateStatus.bind(ClassService);
    ClassService.updateStatus = async (id, ...resto) => (__st.falharFaltaEm === id
      ? { success: false, error: 'Aula em mês fechado não pode ser alterada.' } : __updateDeVerdade(id, ...resto));
    AgendaState.units = [{ id: 'cp', name: 'CrossTainer CP' }, { id: 'pp', name: 'CrossTainer PP' }];
    AgendaState.modalitiesMap = new Map([['hiit', { id: 'hiit', name: 'Hiit' }]]);
    AgendaState.teachersMap = new Map([
      ['edu', { id: 'edu', name: 'EDUARDA SANTOS', userId: 'u_edu', isActive: true }],
      ['bia', { id: 'bia', name: 'BIA LIMA', userId: 'u_bia', isActive: true }],
      ['theo', { id: 'theo', name: 'THEO ROSA', userId: 'u_theo', isActive: true }],
      ['fora', { id: 'fora', name: 'ALAN BRITO', userId: null, isActive: true }],
      ['saiu', { id: 'saiu', name: 'EX PROFESSOR', userId: null, isActive: false }],
    ]);
  `, sandbox);
  const S = () => vm.runInContext('FaltaDiaState', sandbox);
  const agendaGeral = () => vm.runInContext('AgendaGeralState', sandbox);
  return { sandbox, st, el, S, agendaGeral, corpo: () => el('faltaDiaBody').innerHTML };
}
const aulaNoBanco = async (db, id) => (await db.collection('classes').doc(id).get()).data();

(async () => {
  /* ── 1. O botão está na Agenda Geral, só para a gestão ─────────────── */
  {
    const db = makeFakeDb(); await semear(db);
    const g = novaTela({ db });
    g.agendaGeral().unitIds = ['cp', 'pp'];
    g.agendaGeral().classes = [];
    g.sandbox.renderAgendaGeralContent();
    assert.ok(/abrirFaltaDoDia\(\)/.test(g.el('page-agenda-geral').innerHTML) && /Lançar falta do dia/.test(g.el('page-agenda-geral').innerHTML),
      'a gestão vê o botão "Lançar falta do dia" na Agenda Geral');

    const p = novaTela({ db, gestao: false });
    p.agendaGeral().unitIds = ['cp', 'pp'];
    p.sandbox.renderAgendaGeralContent();
    assert.ok(!/abrirFaltaDoDia/.test(p.el('page-agenda-geral').innerHTML), 'professor não vê o botão');
    await p.sandbox.abrirFaltaDoDia({ teacherId: 'edu', dia: DIA });
    assert.ok(!p.el('faltaDiaModal').classList.contains('open'), 'e chamar a função pelo console não abre nada');
    passou('o botão fica na Agenda Geral e é só da gestão');
  }

  /* ── 2. A janela abre com o dia e a pessoa que a Agenda Geral mostra ── */
  const db = makeFakeDb(); await semear(db);
  const t = novaTela({ db });
  {
    Object.assign(t.agendaGeral(), { viewMode: 'day', selectedDate: new Date(2026, 9, 6), teacherId: 'edu' });
    await t.sandbox.abrirFaltaDoDia();
    assert.ok(t.el('faltaDiaModal').classList.contains('open'), 'a janela abre');
    assert.deepStrictEqual({ dia: t.S().dia, quem: t.S().teacherId }, { dia: DIA, quem: 'edu' }, 'já no dia e na pessoa do filtro');
    const html = t.corpo(), txt = texto(html);
    assert.ok(/07:00–08:00/.test(txt) && /08:00–09:00/.test(txt) && /09:00–10:00/.test(txt) && /18:00–19:00/.test(txt), 'as aulas dela no dia: ' + txt.slice(0, 400));
    assert.ok(/CP/.test(txt) && /PP/.test(txt), 'das duas unidades');
    assert.ok(!/06:00–07:00/.test(txt), 'sem as aulas dos outros');
    assert.ok(/19:00–20:00/.test(txt) && /Aula cancelada/.test(txt), 'a cancelada aparece com o motivo, sem botão');
    assert.strictEqual((html.match(/faltaDiaEscolher\('e5'/g) || []).length, 0);
    assert.strictEqual((html.match(/falta-dia-op-falta/g) || []).length, 4, 'as quatro aulas marcáveis nascem como falta');
    const opcoes = html.slice(html.indexOf('faltaDiaSetPessoa'), html.indexOf('</select>', html.indexOf('faltaDiaSetPessoa')));
    assert.ok(/EDUARDA SANTOS/.test(opcoes) && /BIA LIMA/.test(opcoes) && /THEO ROSA/.test(opcoes) && !/ALAN BRITO/.test(opcoes), '"Quem faltou" lista só quem tem aula no dia');
    assert.ok(/4 aulas como falta/.test(txt) && /sai das horas pagas/.test(txt), 'e o resumo diz quantas e o efeito');
    passou('abre com as aulas da pessoa no dia, das duas unidades, já marcadas como falta');
  }

  /* ── 3. Sem dizer o tipo da falta, não lança ───────────────────────── */
  {
    await t.sandbox.faltaDiaLancar();
    assert.ok(/avisada ou sem aviso/i.test(t.corpo()), 'a janela pede o tipo: ' + texto(t.corpo()).slice(-300));
    assert.strictEqual(t.st.confirms.length, 0, 'nem chega a perguntar');
    assert.strictEqual((await aulaNoBanco(db, 'e1')).status, 'realizada', 'nada gravado');
    passou('falta sem tipo: a janela pede e não grava nada');
  }

  /* ── 4. Algumas aulas: duas faltas, uma ela deu, uma o colega deu ──── */
  {
    t.sandbox.faltaDiaSetTipo('sem_aviso');
    t.sandbox.faltaDiaEscolher('e3', 'nada');
    t.sandbox.faltaDiaEscolher('e4', 'colega');
    assert.ok(/quem deu a aula\?/.test(t.corpo()), 'escolher "um colega deu" abre a lista de colegas');
    const lista = t.corpo().slice(t.corpo().indexOf("faltaDiaSetColega('e4'"));
    assert.ok(/BIA LIMA — já tem aula nesse horário/.test(lista) && /THEO ROSA</.test(lista) && /ALAN BRITO/.test(lista), 'todo mundo ativo, com a marca de quem já tem aula no horário');
    assert.ok(!/EDUARDA SANTOS/.test(lista.slice(0, lista.indexOf('</select>'))) && !/EX PROFESSOR/.test(lista), 'menos a própria pessoa e quem está desligado');

    t.sandbox.faltaDiaSetColega('e4', 'bia');
    assert.ok(/BIA LIMA já tem aula nesse horário: 18:00–19:00 \(CP\)/.test(texto(t.corpo())) && /hora conta em dobro/.test(t.corpo()), 'escolhida a Bia, a linha avisa do choque');
    t.sandbox.faltaDiaSetNota('não apareceu nem avisou');
    assert.ok(/2 aulas como falta · 1 aula passa para um colega/.test(texto(t.corpo())), 'resumo: ' + texto(t.corpo()).slice(-400));

    t.st.confirma = false;
    await t.sandbox.faltaDiaLancar();
    const pergunta = t.st.confirms[0];
    assert.ok(/EDUARDA SANTOS/.test(pergunta) && /06\/10/.test(pergunta) && /2 faltas sem aviso \(07:00, 08:00\)/.test(pergunta), 'a pergunta diz o que vai ser lançado: ' + pergunta);
    assert.ok(/18:00 passa para BIA LIMA/.test(pergunta) && /Atenção/.test(pergunta) && /já tem aula nesse horário/.test(pergunta), 'a troca e o aviso do choque');
    assert.strictEqual((await aulaNoBanco(db, 'e1')).status, 'realizada', 'desistiu na confirmação: nada gravado');
    assert.strictEqual(t.st.trocas.length, 0);

    t.sandbox.faltaDiaSetColega('e4', 'theo');
    t.st.confirma = true;
    await t.sandbox.faltaDiaLancar();

    const e1 = await aulaNoBanco(db, 'e1'), e2 = await aulaNoBanco(db, 'e2'), e3 = await aulaNoBanco(db, 'e3'), e4 = await aulaNoBanco(db, 'e4');
    assert.deepStrictEqual({ s: e1.status, f: e1.faltaTipo, auto: e1.registroAutomatico, nota: e1.adjustmentNote, por: e1.adjustedBy },
      { s: 'nao_realizada', f: 'sem_aviso', auto: false, nota: 'não apareceu nem avisou', por: 'u_gestora' }, 'a falta fica igual à lançada pela janela da aula');
    assert.deepStrictEqual({ s: e2.status, f: e2.faltaTipo, aviso: e2.avisoProfessor, atendido: e2.avisoProfessorAtendido && e2.avisoProfessorAtendido.atendidoPor },
      { s: 'nao_realizada', f: 'sem_aviso', aviso: null, atendido: 'u_gestora' }, 'e o aviso que o professor tinha mandado fica respondido');
    assert.deepStrictEqual({ s: e3.status, f: e3.faltaTipo }, { s: 'realizada', f: null }, 'a aula que ela deu não é tocada');
    assert.deepStrictEqual({ quem: e4.teacherId, s: e4.status, f: e4.faltaTipo }, { quem: 'theo', s: 'substituida', f: null }, 'a aula que o colega deu troca de nome, sem falta');

    const criada = t.st.trocas.find(x => x.passo === 'create');
    assert.deepStrictEqual({ aula: criada.classId, para: criada.substituteTeacherId, por: criada.registradoPor, avisa: criada.avisarQuemConfirma, motivo: criada.reason },
      { aula: 'e4', para: 'theo', por: 'gestao', avisa: false, motivo: 'não apareceu nem avisou' }, 'a troca é a de sempre, registrada pela gestão e sem pedido de confirmação');
    assert.ok(t.st.trocas.some(x => x.passo === 'homologar'), 'e confirmada na sequência');

    assert.strictEqual(t.st.sends.length, 1, 'o professor recebe UM aviso, não um por aula');
    assert.deepStrictEqual({ para: t.st.sends[0].recipients, tipo: t.st.sends[0].type, canais: t.st.sends[0].channels }, { para: ['u_edu'], tipo: 'falta_lancada', canais: ['inapp'] });
    assert.ok(/falta sem aviso em 2 aulas suas de 06\/10 \(07:00, 08:00\)/.test(t.st.sends[0].body), t.st.sends[0].body);

    const audit = Object.values(db._dump().audit_log || {}).filter(a => a.type === 'class_status_changed');
    assert.strictEqual(audit.length, 2, 'cada falta fica na auditoria');
    assert.ok(!t.el('faltaDiaModal').classList.contains('open'), 'deu tudo certo: a janela fecha');
    assert.ok(t.st.toasts.some(x => x.type === 'success' && /2 faltas lançadas · 1 aula passada para colega/.test(x.msg)), JSON.stringify(t.st.toasts));
    assert.strictEqual(t.st.recarregou, 1, 'e a agenda por trás é recarregada');
    passou('algumas aulas: duas faltas, uma que ela deu e uma que o colega deu — tudo num lançamento');
  }

  /* ── 5. Reabrindo: o que foi lançado aparece como está ─────────────── */
  {
    await t.sandbox.abrirFaltaDoDia({ teacherId: 'edu', dia: DIA });
    const txt = texto(t.corpo());
    assert.ok(/Já lançada como falta sem aviso/.test(txt), 'as faltas aparecem como lançadas');
    assert.ok(!/18:00–19:00/.test(txt), 'a aula que passou para o Theo não é mais dela');
    assert.strictEqual((t.corpo().match(/falta-dia-op-falta/g) || []).length, 1, 'só a que ela tinha dado (09:00) nasce marcada; as já lançadas ficam em "não mexer"');
    assert.ok(/Não mexer/.test(txt));
    t.sandbox.faltaDiaTodas('nada');
    await t.sandbox.faltaDiaLancar();
    assert.ok(/Nada marcado/.test(texto(t.corpo())), 'sem nada marcado, não há o que lançar');
    passou('reabrir mostra o que já foi lançado e não remarca sozinho');
  }

  /* ── 6. Os atalhos: todas faltou, todas deu, um colega deu todas ───── */
  {
    const db2 = makeFakeDb(); await semear(db2);
    const a = novaTela({ db: db2 });
    await a.sandbox.abrirFaltaDoDia({ teacherId: 'edu', dia: DIA });
    assert.ok(/Faltou em todas/.test(a.corpo()) && /Deu todas/.test(a.corpo()) && /Um colega deu todas/.test(a.corpo()));
    a.sandbox.faltaDiaTodas('nada');
    assert.strictEqual((a.corpo().match(/falta-dia-op-nada/g) || []).length, 4);
    assert.ok(/Nada marcado ainda/.test(a.corpo()));
    a.sandbox.faltaDiaColegaTodas('theo');
    assert.strictEqual((a.corpo().match(/falta-dia-op-colega/g) || []).length, 4, 'o colega entra nas quatro');
    assert.ok(/4 aulas passam para um colega/.test(texto(a.corpo())));
    assert.ok(!/A falta foi/.test(texto(a.corpo())), 'sem falta marcada, não pede o tipo da falta');
    await a.sandbox.faltaDiaLancar();
    for (const id of ['e1', 'e2', 'e3', 'e4']) assert.strictEqual((await aulaNoBanco(db2, id)).teacherId, 'theo', id + ' passou para o Theo');
    assert.strictEqual(a.st.sends.length, 0, 'sem falta, não há aviso de falta (a troca avisa pelo caminho de sempre)');
    assert.ok(a.st.trocas.filter(x => x.passo === 'create').every(x => x.avisarQuemConfirma === false), 'e nenhum pedido de confirmação sai para a Eduarda');
    passou('atalhos: "faltou em todas", "deu todas" e "um colega deu todas"');
  }

  /* ── 7. Quando uma falha, a janela fica aberta e diz qual ──────────── */
  {
    const db3 = makeFakeDb(); await semear(db3);
    const f = novaTela({ db: db3 });
    await f.sandbox.abrirFaltaDoDia({ teacherId: 'edu', dia: DIA });
    f.sandbox.faltaDiaSetTipo('justificada');
    f.st.falharFaltaEm = 'e3';
    await f.sandbox.faltaDiaLancar();
    assert.strictEqual((await aulaNoBanco(db3, 'e1')).faltaTipo, 'justificada', 'as outras foram lançadas');
    assert.strictEqual((await aulaNoBanco(db3, 'e3')).faltaTipo, null);
    assert.ok(f.el('faltaDiaModal').classList.contains('open'), 'a janela fica aberta');
    const erro = f.st.toasts.find(x => x.type === 'error');
    assert.ok(erro && /3 faltas lançadas/.test(erro.msg) && /09:00/.test(erro.msg) && /mês fechado/.test(erro.msg), 'diz o que entrou e qual falhou: ' + JSON.stringify(f.st.toasts));
    assert.ok(/falta avisada em 3 aulas/.test(f.st.sends[0].body), 'o aviso ao professor fala só do que foi gravado');
    assert.ok(/Já lançada como falta avisada/.test(texto(f.corpo())), 'e a lista é relida do banco');
    passou('falha em uma aula: as outras entram, a janela fica aberta e diz qual falhou');
  }

  /* ── 8. Troca em aberto bloqueia; dia futuro só aceita falta avisada ── */
  {
    const db4 = makeFakeDb(); await semear(db4);
    const b = novaTela({ db: db4 });
    b.st.subsAbertas = [{ classId: 'e1', status: 'pending' }];
    await b.sandbox.abrirFaltaDoDia({ teacherId: 'edu', dia: DIA });
    assert.ok(/troca de professor esperando confirmação/.test(texto(b.corpo())) && !/faltaDiaEscolher\('e1'/.test(b.corpo()), 'aula com troca em aberto fica sem botão, com o motivo');

    vm.runInContext('faltaDiaAgora = () => new Date(2026, 9, 5, 20, 0);', b.sandbox);   // véspera
    await b.sandbox.abrirFaltaDoDia({ teacherId: 'edu', dia: DIA });
    assert.ok(/só aceita "avisada antes"/.test(texto(b.corpo())), 'a janela avisa antes');
    b.sandbox.faltaDiaSetTipo('sem_aviso');
    await b.sandbox.faltaDiaLancar();
    assert.ok(/ainda não começou/.test(texto(b.corpo())), 'e recusa "sem aviso" em aula que não começou');
    assert.strictEqual((await aulaNoBanco(db4, 'e2')).status, 'realizada');
    b.sandbox.faltaDiaSetTipo('justificada');
    await b.sandbox.faltaDiaLancar();
    assert.strictEqual((await aulaNoBanco(db4, 'e2')).faltaTipo, 'justificada', 'avisada entra');
    passou('troca em aberto fica de fora; aula que não começou só aceita falta avisada');
  }

  /* ── 9. O atalho de dentro da aula, trocar a pessoa e o dia ────────── */
  {
    const db5 = makeFakeDb(); await semear(db5);
    const m = novaTela({ db: db5 });
    m.agendaGeral().classes = [{ id: 'b1', teacherId: 'bia', scheduledDate: new Date(2026, 9, 6, 18), startTime: '18:00' }];
    vm.runInContext('MinhaAgendaState.selectedClassId = "b1";', m.sandbox);
    m.sandbox.abrirFaltaDoDiaDaAula();
    await new Promise(r => setTimeout(r, 20));
    assert.deepStrictEqual({ dia: m.S().dia, quem: m.S().teacherId }, { dia: DIA, quem: 'bia' }, 'abre na pessoa e no dia da aula que estava aberta');
    assert.ok(/18:00–19:00/.test(texto(m.corpo())));

    m.sandbox.faltaDiaSetPessoa('theo');
    assert.ok(/06:00–07:00/.test(texto(m.corpo())) && !/18:00–19:00/.test(texto(m.corpo())), 'trocar a pessoa troca a lista');
    assert.ok(!/Faltou em todas/.test(m.corpo()), 'com uma aula só, os atalhos de "todas" não aparecem');

    m.sandbox.faltaDiaSetDia('2026-10-05');
    await new Promise(r => setTimeout(r, 20));
    assert.ok(/THEO ROSA/.test(m.corpo()) && /sem aula neste dia/.test(m.corpo()) && /não tem aula nesse dia/.test(texto(m.corpo())), 'trocar o dia relê a agenda e diz quando a pessoa não tem aula');
    m.sandbox.faltaDiaSetPessoa('edu');
    assert.ok(/07:00–08:00/.test(texto(m.corpo())), 'e traz quem tem');
    m.sandbox.fecharFaltaDoDia();
    assert.ok(!m.el('faltaDiaModal').classList.contains('open'));
    passou('atalho da janela da aula, troca de pessoa e de dia');
  }

  /* ── 10. A janela da aula tem o atalho, e o sino conhece o aviso ───── */
  {
    const html = fs.readFileSync(path.join(raiz, 'professores.html'), 'utf8');
    const bloco = html.slice(html.indexOf('id="classFaltaTipo"'), html.indexOf('id="classAtraso"'));
    assert.ok(/abrirFaltaDoDiaDaAula\(\)/.test(bloco) && /Lançar o dia de uma vez/.test(bloco), 'o atalho fica junto do campo Falta, dentro do bloco que só a gestão vê');
    assert.ok(html.indexOf('id="classModalEditBlock"') < html.indexOf('abrirFaltaDoDiaDaAula()'), 'dentro do bloco de edição');
    const shared = fs.readFileSync(path.join(raiz, 'professores-shared.js'), 'utf8');
    assert.ok(/falta_lancada:\s*\{[^}]*title:/.test(shared), 'o sino tem título para o aviso de falta');
    const email = fs.readFileSync(path.join(raiz, 'functions', 'email-config.js'), 'utf8');
    assert.ok(!/falta_lancada/.test(email), 'e ele NÃO vira e-mail');
    passou('atalho na janela da aula; aviso de falta só no sino');
  }

  console.log(`\n${ok} verificações ✓`);
})().catch(e => { console.error('✗', e.stack || e.message); process.exit(1); });
