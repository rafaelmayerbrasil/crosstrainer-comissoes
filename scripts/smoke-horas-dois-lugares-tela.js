'use strict';
// Roda: node scripts/smoke-horas-dois-lugares-tela.js
process.env.TZ = 'America/Sao_Paulo';
//
// Horas do mês — as TELAS depois das mensagens do grupo de 06/10/2026:
//   Theo:   "to arrumando aqui, entrei às 6:30 neste dia, aí quando confirmo
//            fica assim" (−3h45 num dia de 11h) · "não apareceu as horas que fiz
//            pro Bruninho, e nem o feriado que fiz pra Carlinha" · "o feriado é
//            o dobro né?"
//   Benny:  "como eu vejo todos os dias que a Carla trabalhou em setembro?" ·
//           "como eu confiro se ela fez de fato as 29h?"
//
// Este teste RODA as telas (professores-horas.js, e o checklist do fechamento)
// contra um banco falso, chamando as mesmas funções que os botões chamam.
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
const texto = (html) => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

/* ── O setembro que estava em produção, resumido ───────────────────── */
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
    return id;
  };
  const bloco = async (tid, dia, inicio, fim, extra) => {
    let a = H.paraMin(inicio); const f = H.paraMin(fim);
    while (a < f) { const b = Math.min(a + 60, f); await grava(tid, dia, H.paraHHMM(a), H.paraHHMM(b), extra); a = b; }
  };
  // Theo, sexta 04/09: manhã na CP, à noite cobriu o Bruno na CP (troca
  // confirmada) e as aulas dele mesmo na PP continuaram na agenda.
  await bloco('theo', D(4), '06:00', '12:30');
  for (const [i, f] of [['16:30', '17:30'], ['17:30', '18:30'], ['18:30', '19:30'], ['19:30', '20:30'], ['20:30', '21:15']]) {
    await grava('theo', D(4), i, f, { status: 'substituida', originalTeacherId: 'bruno' });
  }
  await bloco('theo', D(4), '18:00', '21:30', { unitId: 'pp' });
  await bloco('theo', D(8), '09:30', '12:30');
  // Carla: três almoços e o feriado de 07/09 (que o Theo diz ter feito)
  for (const n of [1, 2, 3]) await grava('carla', D(n), '12:30', '13:30');
  const feriado = { specialScaleType: 'feriado', isHoliday: true, holidayName: 'Independência', generatedBy: 'escala-smart' };
  const idFeriadoCarla = await grava('carla', D(7), '08:00', '12:00', feriado);
  await grava('edu', D(7), '08:00', '12:00', Object.assign({ unitId: 'pp' }, feriado));
  await bloco('bia', D(9), '07:00', '09:00', { unitId: 'pp' });
  for (const [id, nome] of [['theo', 'THEO ROSA'], ['carla', 'CARLA FANTI'], ['bruno', 'BRUNO CLAUDINO'], ['bia', 'BIA LIMA'], ['edu', 'EDUARDA SANTOS']]) {
    await db.collection('teachers').doc(id).set({ name: nome, userId: 'u_' + id, isActive: true, primaryUnitId: 'cp', modalityIds: ['hiit'] });
  }
  return { idFeriadoCarla };
}

function novoSandbox({ db, gestao, professorId }) {
  const els = new Map();
  const el = (id) => { if (!els.has(id)) els.set(id, { id, innerHTML: '', textContent: '', value: '', style: {} }); return els.get(id); };
  const st = { toasts: [], confirms: [], confirmReturn: true, sends: [], audits: [], navegou: [], trocas: [] };
  // A troca de professor de verdade: registra, a gestão confirma e a Function
  // move a aula. Aqui a "Function" age na hora.
  const SubstitutionService = {
    async create(p) { st.trocas.push(Object.assign({ passo: 'create' }, p)); return { success: true, data: { id: 's' + st.trocas.length, classId: p.classId, para: p.substituteTeacherId } }; },
    async homologar(subId) {
      const t = st.trocas[Number(subId.slice(1)) - 1];
      st.trocas.push({ passo: 'homologar', subId });
      await db.collection('classes').doc(t.classId).update({ teacherId: t.substituteTeacherId, status: 'substituida' });
      return { success: true };
    },
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document: { getElementById: el, querySelectorAll: () => [] },
    db, firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
    HourDeclaration: H, SubstitutionService,
    toast: (msg, type) => st.toasts.push({ msg, type }),
    confirm: (m) => { st.confirms.push(m); return st.confirmReturn; },
    prompt: () => 'x',
    escapeHtml: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    isAdminGestao: () => !!gestao, isSupervisao: () => false,
    getCurrentProfessorId: () => professorId || null,
    currentUserId: () => (gestao ? 'u_gestora' : 'u_' + professorId),
    navigateTo: (p) => st.navegou.push(p),
    AuditService: { log: async (o) => { st.audits.push(o.type); } },
    NotifyService: { send: async (o) => { st.sends.push(JSON.parse(JSON.stringify(o))); return { success: true }; } },
    AgendaState: { teachersMap: new Map(), modalitiesMap: new Map([['hiit', { id: 'hiit', name: 'Hiit' }]]), units: [{ id: 'cp', name: 'CrossTainer CP' }, { id: 'pp', name: 'CrossTainer PP' }] },
    TeacherService: { list: async () => { const s = await db.collection('teachers').get(); return { success: true, data: s.docs.map(d => Object.assign({ id: d.id }, d.data())) }; } },
    ModalityService: { list: async () => ({ success: true, data: [] }) }, UnitService: { list: async () => ({ success: true, data: [] }) },
    setTimeout, Date, Math, JSON, Promise, Map, Set, Array, Object, String, Number,
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(raiz, 'professores-horas.js'), 'utf8'), sandbox, { filename: 'professores-horas.js' });
  sandbox.horasHojeISO = () => '2026-10-06';
  vm.runInContext('horasHojeISO = () => "2026-10-06"; horasEsperar = async () => {};', sandbox);
  const estado = () => vm.runInContext('HorasState', sandbox);
  return { sandbox, st, el, estado };
}
const decl = async (db, tid) => { const d = await db.collection('hour_declarations').doc(`${tid}_2026-09`).get(); return d.exists ? d.data() : null; };
const aulasDe = async (db, tid) => (await db.collection('classes').where('teacherId', '==', tid).get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
const folha = (aulas, dia) => Math.round(Payroll.horasDasAulas(aulas.filter(c =>
  Payroll.STATUS_QUE_PAGAM.indexOf(c.status) !== -1 && (!dia || H.diaISO(c.scheduledDate) === dia)), new Map()) * 60);

(async () => {
  const db = makeFakeDb();
  const { idFeriadoCarla } = await semear(db);

  /* ═══ PROFESSOR (o Theo) ═══════════════════════════════════════════ */
  const prof = novoSandbox({ db, professorId: 'theo' });
  const S = prof.sandbox;
  const tela = () => prof.el('page-minhas-horas').innerHTML;

  /* ── 1. O dia em dois lugares aparece explicado ────────────────────── */
  {
    await S.renderMinhasHorasPage();
    const t = texto(tela());
    assert.ok(/14h45/.test(t), 'a linha de 04/09 continua mostrando o que a agenda soma');
    assert.ok(/dois lugares ao mesmo tempo/.test(t) && /das 18:00 às 21:15/.test(t) && /3h15 em dobro/.test(t), 'e agora diz POR QUÊ: dois lugares, das 18:00 às 21:15, 3h15 em dobro');
    assert.ok(/\(CP e PP\)/.test(t), 'dizendo as unidades');
    assert.ok(/Corrigir/.test(t) && /confirme os horários deste dia/.test(t), 'e o que fazer');
    assert.strictEqual((tela().match(/horas-alerta/g) || []).length, 1, 'só o dia com choque leva o aviso');
    passou('professor: o dia de 14h45 explica que a agenda conta 3h15 em dobro');
  }

  /* ── 2. Corrigindo: a prévia não parece punição ────────────────────── */
  {
    S.horasAbrirDia(D(4));
    assert.ok(/em dobro/.test(tela()) && /vale uma vez só/.test(tela()), 'a prévia do editor explica a diferença antes de ele mexer');
    S.horasSetTurno(0, 'inicio', '06:30');
    await S.horasConfirmarDia();
    const d = await decl(db, 'theo');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(d.dias[D(4)].turnos)), [{ inicio: '06:30', fim: '12:30' }, { inicio: '16:30', fim: '21:30' }]);
    const t = texto(tela());
    assert.ok(/−3h45/.test(t) && /já conta uma vez só/.test(t), 'a linha mostra −3h45 COM a explicação ao lado');
    passou('professor: corrige a entrada para 06:30 e a tela explica os −3h45');
  }

  /* ── 3. Confirmar os mesmos horários também vale como correção ─────── */
  {
    await S.horasVoltarAgenda(D(4));
    assert.ok(!(await decl(db, 'theo')).dias[D(4)]);
    prof.st.toasts.length = 0;
    await S.horasConfirmarIgual();
    assert.ok(prof.st.toasts.some(x => x.type === 'error' && /dois lugares/.test(x.msg) && /04\/09/.test(x.msg)), '"Está tudo igual à agenda" é recusado: tem dia contado em dobro');
    assert.notStrictEqual((await decl(db, 'theo')).status, 'enviada');
    S.horasAbrirDia(D(4));
    await S.horasConfirmarDia();                       // sem mexer em nada
    assert.ok((await decl(db, 'theo')).dias[D(4)], 'confirmar o dia como está JÁ grava a correção');
    assert.ok(/−3h15/.test(texto(tela())), 'e saem só as 3h15 em dobro');
    // volta para o que o Theo informou de verdade
    S.horasAbrirDia(D(4)); S.horasSetTurno(0, 'inicio', '06:30'); await S.horasConfirmarDia();
    passou('professor: "tudo igual" não passa por cima do dia em dobro; confirmar o dia resolve');
  }

  /* ── 4. Feriado no lugar da Carla: reconhecido sem botão ───────────── */
  {
    S.horasNovoDia(D(7));
    await new Promise(r => setTimeout(r, 20));          // a consulta do feriado do dia
    S.horasSetFora('no_lugar_de'); S.horasSetNoLugarDe('carla');
    S.horasSetTurno(0, 'inicio', '08:00'); S.horasSetTurno(0, 'fim', '12:00');
    assert.ok(/feriado: na folha conta 8h00/.test(prof.el('horasPrevia').textContent || S.horasPreviaTexto()), 'a prévia já avisa que o dia é feriado e vale 8h');
    await S.horasConfirmarDia();
    await S.renderMinhasHorasPage();                    // como quem abre a tela de novo
    const t = texto(tela());
    assert.ok(/no lugar de CARLA FANTI/.test(t) && /feriado · conta em dobro/.test(t), 'a linha do dia incluído mostra "feriado · conta em dobro"');
    assert.ok(/quando a gestão registrar a troca com CARLA FANTI/.test(t) && /não precisa fazer mais nada/.test(t), 'e responde o "tem que adicionar é isso?": sim, e o resto é com a gestão');
    assert.ok(/Para pagamento/.test(t), 'aparece o total para pagamento');
    passou('professor: dia de feriado incluído é reconhecido sozinho e vale em dobro');
  }

  /* ── 5. A Carla vê o próprio feriado em dobro ──────────────────────── */
  {
    const c = novoSandbox({ db, professorId: 'carla' });
    await c.sandbox.renderMinhasHorasPage();
    const t = texto(c.el('page-minhas-horas').innerHTML);
    assert.ok(/7h00/.test(t) && /Para pagamento 11h00/.test(t), 'pela agenda 7h trabalhadas; para pagamento 11h');
    assert.ok(/feriado · conta em dobro/.test(t));
    passou('professor: quem trabalhou no feriado vê as horas trabalhadas e as de pagamento');
  }

  /* ═══ GESTÃO ══════════════════════════════════════════════════════ */
  prof.st.confirms.length = 0;
  await S.horasEnviar();
  assert.strictEqual((await decl(db, 'theo')).status, 'enviada');

  const ges = novoSandbox({ db, gestao: true });
  const G = ges.sandbox;
  const telaG = () => ges.el('page-horas-do-mes').innerHTML;

  /* ── 6. "Como eu confiro as 29h da Carla?" ─────────────────────────── */
  {
    G.horasGestaoAbrirMes(2026, 9, 'carla');            // o atalho que vem do fechamento
    assert.deepStrictEqual(ges.st.navegou, ['horas-do-mes']);
    await G.renderHorasGestaoPage();
    const t = texto(telaG());
    assert.ok(/agenda: 7h00 · para pagamento: 11h00/.test(t), 'na linha da pessoa: trabalhadas e para pagamento');
    assert.ok(/Trabalhadas: 7h00/.test(t) && /Para pagamento: 11h00/.test(t) && /07\/09, feriado, conta em dobro/.test(t), 'o detalhe abre direto e explica de onde vem a diferença');
    assert.ok(/08:00–12:00 · CP · 4h00/.test(t) && /na folha: 8h00/.test(t), 'cada dia com horário, unidade e horas');
    passou('gestão: "Ver as horas" mostra dia, unidade, feriado e o total para pagamento');
  }

  /* ── 7. O que muda nas horas do Theo — e o botão da troca ──────────── */
  {
    await G.horasGestaoVer('carla'); await G.horasGestaoVer('theo');
    const html = telaG(), t = texto(html);
    assert.ok(/sai da conta/.test(t) && /no mesmo horário a pessoa estava em outra aula/.test(t), 'a aula da PP que sai vem com o motivo');
    assert.ok(/−3h45/.test(t), 'e o dia perde 3h45, como o professor viu');
    assert.ok(/Se validar: −3h45/.test(t), 'a validação faz exatamente isso (antes tirava só 30 min)');
    assert.ok(/CARLA FANTI tem: 08:00–12:00 · CP · feriado/.test(t), 'no dia "no lugar de": a aula da Carla que está na agenda');
    assert.ok(/horasGestaoPassarAulas\('theo','2026-09-07'\)/.test(html) && /Passar para THEO ROSA/.test(t), 'com o botão que passa a aula para ele');
    passou('gestão: vê a aula que sai por estar em dobro e o botão para passar a aula do colega');
  }

  /* ── 8. Passar a aula: é a troca de professor de sempre ────────────── */
  {
    ges.st.confirms.length = 0;
    await G.horasGestaoPassarAulas('theo', D(7));
    assert.ok(/CARLA FANTI/.test(ges.st.confirms[0]) && /THEO ROSA/.test(ges.st.confirms[0]) && /feriado \(conta em dobro\)/.test(ges.st.confirms[0]), 'pergunta antes, dizendo de quem para quem e que é feriado');
    assert.deepStrictEqual(ges.st.trocas.map(x => x.passo), ['create', 'homologar'], 'registra a troca e confirma como gestão');
    assert.deepStrictEqual({ c: ges.st.trocas[0].classId, p: ges.st.trocas[0].substituteTeacherId, r: ges.st.trocas[0].registradoPor },
      { c: idFeriadoCarla, p: 'theo', r: 'gestao' });
    assert.ok(/Minhas horas do mês/.test(ges.st.trocas[0].reason), 'com a origem no motivo');
    const t = texto(telaG());
    assert.ok(!/Passar para THEO ROSA/.test(t), 'feita a troca, o botão some');
    assert.ok(!/só entra quando a aula passar/.test(t), 'e o dia deixa de ser pendência');
    assert.ok(/Se validar: −3h45/.test(t), 'a aula já está na agenda dele: validar não soma de novo');
    assert.strictEqual(folha(await aulasDe(db, 'carla'), D(7)), 0, 'a Carla não recebe mais pelo feriado');
    assert.strictEqual(folha(await aulasDe(db, 'theo'), D(7)), 480, 'o Theo recebe as 8h');
    passou('gestão: um clique passa a aula do colega; a folha acompanha');

    ges.st.confirmReturn = false; ges.st.trocas.length = 0;
    await G.horasGestaoPassarAulas('theo', D(7));
    assert.strictEqual(ges.st.trocas.length, 0, 'sem aula para passar, nada é registrado');
    ges.st.confirmReturn = true;
  }

  /* ── 9. Validar: o dia em dobro fica com as horas trabalhadas ──────── */
  {
    await G.horasGestaoValidar('theo');
    const aulas = await aulasDe(db, 'theo');
    assert.strictEqual(folha(aulas, D(4)), 660, 'a folha paga 11h00 em 04/09 (eram 14h45)');
    const pp = aulas.filter(c => H.diaISO(c.scheduledDate) === D(4) && c.unitId === 'pp');
    assert.deepStrictEqual(pp.map(c => c.status).sort(), ['nao_realizada', 'nao_realizada', 'nao_realizada', 'realizada'], 'as três aulas da PP no horário da troca saem; a última fica com 15 min');
    assert.ok(aulas.filter(c => c.originalTeacherId === 'bruno').every(c => c.status === 'substituida' && !c.atrasoMinutos), 'as aulas da troca do Bruno ficam inteiras');
    await G.renderHorasGestaoPage();
    assert.ok(!/em dois lugares/.test(texto(telaG())), 'e ninguém mais aparece em dois lugares');
    passou('gestão: validar deixa 04/09 com 11h00 e some o aviso de dois lugares');
  }

  /* ── 10. Turno a mais num feriado nasce como feriado ───────────────── */
  {
    await db.collection('hour_declarations').doc('bia_2026-09').set({ teacherId: 'bia', mes: '2026-09', status: 'enviada', semDiferenca: false,
      dias: { [D(7)]: { turnos: [{ inicio: '08:00', fim: '10:00' }], naoTrabalhei: false, foraDaAgenda: 'turno_extra', noLugarDe: null, obs: '' } } });
    await G.renderHorasGestaoPage();
    await G.horasGestaoValidar('bia');
    const nova = (await aulasDe(db, 'bia')).find(c => c.generatedBy === 'horas-do-mes');
    assert.ok(nova && nova.isHoliday === true && nova.holidayName === 'Independência', 'a aula avulsa do feriado nasce marcada');
    assert.strictEqual(folha([nova]), 240, '2h trabalhadas, 4h na folha');
    passou('gestão: turno a mais validado num feriado é pago em dobro');
  }

  /* ── 11. Enquanto ninguém corrige, a lista da gestão avisa ─────────── */
  {
    const db2 = makeFakeDb(); await semear(db2);
    const g2 = novoSandbox({ db: db2, gestao: true });
    await g2.sandbox.renderHorasGestaoPage();
    const t = texto(g2.el('page-horas-do-mes').innerHTML);
    assert.ok(/1 pessoa em dois lugares ao mesmo tempo: THEO ROSA/.test(t) && /trava o fechamento/.test(t), 'no topo, com o nome e dizendo que trava');
    assert.ok(/em dois lugares: 04\/09/.test(t), 'e na linha da pessoa, com o dia');
    passou('gestão: quem está em dois lugares aparece na lista antes de qualquer conferência');

    /* ── 12. O fechamento trava ──────────────────────────────────────── */
    const noop = () => {};
    const sb = {
      console: { log: noop, warn: noop, error: noop },
      Map, Set, Date, Math, JSON, String, Number, Array, Object, Boolean, RegExp, Promise, Error,
      document: { getElementById: () => null, addEventListener: noop },
      escapeHtml: (s) => String(s == null ? '' : s),
      fmt: (v) => String(v), ajudaBtn: () => '', isStrictAdmin: () => true, canSeeSalary: () => true,
      isAdminGestao: () => true, isSupervisao: () => false, navigateTo: noop, toast: noop,
      AgendaState: { teachersMap: new Map() }, UnitService: { list: async () => ({ success: true, data: [] }) },
      HourDeclaration: H, HourDeclarationService: g2.sandbox.HourDeclarationService,
    };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    for (const f of ['substitution-flow.js', 'intern-hour-bank.js', 'closing-payroll.js']) vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8'), sb, { filename: f });
    sb.SubstitutionFlow = sb.window.SubstitutionFlow; sb.InternHourBank = sb.window.InternHourBank; sb.ClosingPayroll = sb.window.ClosingPayroll;
    vm.runInContext(fs.readFileSync(path.join(raiz, 'professores-fechamento.js'), 'utf8'), sb, { filename: 'professores-fechamento.js' });
    const previa = { conferencia: { aulasNoMes: 10, aulasQuePagam: 10, statusAulas: {}, ocorrencias: 0, ferias: [] },
      teachers: [{ teacherId: 'theo', teacherName: 'THEO ROSA', classesCount: 20, avisos: [], porUnidade: [] }] };
    const checklist = async (svc) => {
      if (svc) sb.HourDeclarationService = svc;
      const fs_ = vm.runInContext('FechamentoState', sb);
      Object.assign(fs_, { previewData: previa, selectedYear: 2026, selectedMonth: 9, trocasAbertas: [], trocasErro: null, avisosPendentes: [], avisosErro: null });
      await vm.runInContext('carregarDoisLugares', sb)();
      return JSON.parse(JSON.stringify(vm.runInContext('montarChecklist', sb)(previa)));
    };
    let item = (await checklist()).find(i => /dois lugares/.test(i.titulo));
    assert.ok(item && item.nivel === 'bloqueia' && /THEO ROSA \(04\/09 · 3h15 em dobro\)/.test(item.situacao), 'o fechamento trava, com o nome, o dia e quanto: ' + (item && item.situacao));
    assert.strictEqual(item.acao.fn, 'horasGestaoAbrirMes(2026,9)', 'e o botão leva para onde se acerta');
    item = (await checklist(ges.sandbox.HourDeclarationService)).find(i => /mesmo horário|dois lugares/.test(i.titulo));
    assert.ok(item && item.nivel === 'ok', 'depois de validado (o banco da gestão acima), não trava mais');
    item = (await checklist({ aulasDoMes: async () => { throw new Error('sem permissão'); }, tiposDeEscala: async () => new Map() })).find(i => /dois lugares/.test(i.titulo));
    assert.ok(item && item.nivel === 'bloqueia' && /Não consegui verificar/.test(item.situacao), 'se não deu para checar, não fecha');
    const linha = vm.runInContext('renderTeacherTable', sb)([{ teacherId: 'theo', teacherName: 'THEO ROSA', teacherType: 'efetivo', classesCount: 20, totalHoras: 11, valorHoras: 0, valorTotal: 0, avisos: [], porUnidade: [] }], {}, false);
    assert.ok(/horasGestaoAbrirMes/.test(linha) === (typeof sb.horasGestaoAbrirMes === 'function'), 'o atalho por pessoa só aparece quando a tela das horas está carregada');
    sb.horasGestaoAbrirMes = noop;
    assert.ok(/horasGestaoAbrirMes\(2026,9,'theo'\)/.test(vm.runInContext('renderTeacherTable', sb)([{ teacherId: 'theo', teacherName: 'THEO ROSA', teacherType: 'efetivo', classesCount: 20, totalHoras: 11, valorHoras: 0, valorTotal: 0, avisos: [], porUnidade: [] }], {}, false)),
      'na folha, cada pessoa tem "ver os dias e as horas"');
    passou('fechamento: pessoa em dois lugares trava (falha fechada) e a folha tem o atalho por pessoa');
  }

  /* ── 13. Aviso ao confirmar a troca que cria o choque ──────────────── */
  {
    const db3 = makeFakeDb(); await semear(db3);
    const sb = {
      console: { log() {}, warn() {}, error() {} }, db: db3, HourDeclaration: H,
      AgendaState: { teachersMap: new Map([['theo', { id: 'theo', name: 'THEO ROSA' }]]), modalitiesMap: new Map(), units: [{ id: 'pp', name: 'CrossTainer PP' }, { id: 'cp', name: 'CrossTainer CP' }] },
      document: { getElementById: () => null }, SubstitutionFlow: { STATUS_ABERTO: ['pending', 'aguardando_gestao'] },
      Date, Math, JSON, Promise, Map, Set, Array, Object, String, Number,
    };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(raiz, 'professores-substituicoes.js'), 'utf8'), sb, { filename: 'professores-substituicoes.js' });
    const aviso = vm.runInContext('subsAvisoDoisLugares', sb);
    const aulaDoBruno = (inicio, fim) => ({ id: 'nova', teacherId: 'bruno', unitId: 'cp', status: 'prevista', scheduledDate: { toDate: () => new Date(2026, 8, 8) }, startTime: inicio, endTime: fim });
    const msg = await aviso(aulaDoBruno('10:00', '11:00'), 'theo');
    assert.ok(/THEO ROSA já tem aula nesse mesmo horário: 09:30–10:30 \(CP\), 10:30–11:30 \(CP\)/.test(msg) && /em dobro/.test(msg), 'avisa quais aulas ele já tem: ' + msg);
    assert.strictEqual(await aviso(aulaDoBruno('14:00', '15:00'), 'theo'), '', 'horário livre: silêncio');
    assert.strictEqual(await aviso(null, 'theo'), '');
    passou('troca: antes de confirmar, avisa se quem assume já tem aula no mesmo horário');
  }

  console.log(`\n${ok} verificações ✓`);
})().catch(e => { console.error('✗', e.stack || e.message); process.exit(1); });
