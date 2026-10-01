'use strict';
// Roda: node scripts/smoke-avisos-professor-gestao.js
process.env.TZ = 'America/Sao_Paulo';
//
// "O que o professor envia não chega a ninguém" (achado em 01/10/2026, a partir
// do botão do Theo). Em produção: 21 avisos de professor parados desde 26/08 —
// 11 de atraso/hora extra, 10 de "a aula não aconteceu" — e NENHUM atendido. O
// botão dizia "Enviar para a gestão", mas a gestão não era avisada e não tinha
// lista: só via abrindo aula por aula. E como a aula vira `realizada` sozinha
// de madrugada, "não aconteceu" sem resposta seria paga no fechamento.
//
// Quatro peças: a lista com a decisão num clique, o aviso no sino da gestão, o
// alerta na tela inicial e a trava no fechamento.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const makeFakeDb = require('./_fake-firestore.js');
const CA = require('../class-avisos.js');

const raiz = path.join(__dirname, '..');
let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };
const ts = (y, m, d, h, mi) => ({ toDate: () => new Date(y, m - 1, d, h || 8, mi || 0) });
const plano = (o) => JSON.parse(JSON.stringify(o));

const aula = (extra) => Object.assign({
  id: 'c1', teacherId: 'edu', originalTeacherId: 'edu', unitId: 'cp', modalityId: 'hiit',
  scheduledDate: ts(2026, 9, 9, 7), startTime: '07:00', endTime: '08:00', durationMinutes: 60,
  status: 'realizada', registroAutomatico: true, monthClosingId: null,
  atrasoMinutos: 0, saidaAntecipadaMinutos: 0, horaExtraMinutos: 0, faltaTipo: null,
}, extra || {});
const ocorr = (m) => ({ tipo: 'ocorrencia', atrasoMinutos: 0, saidaAntecipadaMinutos: 0, horaExtraMinutos: 0, nota: null, por: 'u_edu', ...m });
const naoAconteceu = (nota) => ({ tipo: 'nao_aconteceu', nota: nota || null, por: 'u_edu' });

(async () => {
  /* ── 1. O que o professor disse, em uma linha ──────────────────────── */
  assert.strictEqual(CA.resumo(ocorr({ atrasoMinutos: 60 })), 'chegou 60 min atrasado');
  assert.strictEqual(CA.resumo(ocorr({ saidaAntecipadaMinutos: 20, horaExtraMinutos: 0 })), 'saiu 20 min antes');
  assert.strictEqual(CA.resumo(ocorr({ atrasoMinutos: 10, horaExtraMinutos: 35 })), 'chegou 10 min atrasado · ficou 35 min além do horário');
  assert.strictEqual(CA.resumo(naoAconteceu()), 'avisou que a aula não aconteceu');
  assert.strictEqual(CA.resumo(null), '');
  passou('o aviso vira uma linha que a gestão lê sem abrir a aula');

  /* ── 2. Cada decisão da gestão vira os campos certos ───────────────── */
  {
    const c = aula({ avisoProfessor: ocorr({ atrasoMinutos: 60, horaExtraMinutos: 99999 }) });
    const r = CA.camposDaDecisao(c, 'aceitar');
    assert.ok(r.ok, r.erro);
    assert.deepStrictEqual(r.campos, { atrasoMinutos: 60, saidaAntecipadaMinutos: 0, horaExtraMinutos: 600, faltaTipo: null },
      'aceitar passa os minutos pro lugar oficial (com o teto de 10h) e NÃO mexe no status');
    assert.deepStrictEqual(CA.camposDaDecisao(c, 'dispensar').campos, {}, 'dispensar não muda nada na aula');
    assert.ok(!CA.camposDaDecisao(c, 'cancelar').ok, '"cancelar a aula" não é resposta pra aviso de atraso');

    const n = aula({ avisoProfessor: naoAconteceu() });
    assert.deepStrictEqual(CA.camposDaDecisao(n, 'cancelar').campos,
      { status: 'cancelada', faltaTipo: null, atrasoMinutos: 0, saidaAntecipadaMinutos: 0, horaExtraMinutos: 0 }, 'aula cancelada: sai da folha, sem falta pra ninguém');
    assert.deepStrictEqual(CA.camposDaDecisao(n, 'falta_justificada').campos,
      { status: 'nao_realizada', faltaTipo: 'justificada', atrasoMinutos: 0, saidaAntecipadaMinutos: 0, horaExtraMinutos: 0 });
    assert.strictEqual(CA.camposDaDecisao(n, 'falta_sem_aviso').campos.faltaTipo, 'sem_aviso');
    assert.deepStrictEqual(CA.camposDaDecisao(n, 'dispensar').campos, {}, 'a aula aconteceu: fica como estava');
    assert.ok(!CA.camposDaDecisao(n, 'aceitar').ok, '"aceitar os minutos" não existe pra "não aconteceu"');

    assert.ok(/fechado/i.test(CA.camposDaDecisao(aula({ avisoProfessor: naoAconteceu(), monthClosingId: 'm' }), 'cancelar').erro), 'mês fechado não se mexe');
    assert.ok(!CA.camposDaDecisao(aula(), 'aceitar').ok, 'aula sem aviso não tem o que decidir');
    assert.ok(!CA.camposDaDecisao(n, 'inventada').ok, 'decisão desconhecida é recusada');
    passou('camposDaDecisao: aceitar, cancelar, falta, dispensar — e recusa o que não cabe');
  }

  /* ── 3. Quais estão pendentes, e de qual mês ───────────────────────── */
  {
    const lista = [
      aula({ id: 'set2', scheduledDate: ts(2026, 9, 9, 9), startTime: '09:00', avisoProfessor: ocorr({ atrasoMinutos: 60 }) }),
      aula({ id: 'ago', scheduledDate: ts(2026, 8, 26, 11, 30), avisoProfessor: naoAconteceu() }),
      aula({ id: 'set1', scheduledDate: ts(2026, 9, 9, 7), avisoProfessor: ocorr({ atrasoMinutos: 60 }) }),
      aula({ id: 'semAviso' }),
      aula({ id: 'fechada', avisoProfessor: naoAconteceu(), monthClosingId: 'x' }),
    ];
    assert.deepStrictEqual(CA.pendentes(lista).map(c => c.id), ['ago', 'set1', 'set2'], 'só as com aviso e mês aberto, da mais antiga pra mais nova');
    assert.deepStrictEqual(CA.doMes(lista, 2026, 9).map(c => c.id), ['set1', 'set2'], 'e o recorte do mês que está sendo fechado');
    assert.deepStrictEqual(CA.doMes(lista, 2026, 10), []);
    passou('pendentes e doMes separam o que ainda espera a gestão');
  }

  /* ── 4. A cópia das Functions é idêntica (o gatilho usa a mesma frase) ── */
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'functions', 'class-avisos.js'), 'utf8').replace(/\r\n/g, '\n'),
    fs.readFileSync(path.join(raiz, 'class-avisos.js'), 'utf8').replace(/\r\n/g, '\n'), 'functions/class-avisos.js tem que ser gêmeo do da raiz');
  passou('class-avisos.js e o gêmeo de functions/ são iguais');

  /* ── 5. O serviço de verdade, contra um banco de mentira ───────────── */
  function servico() {
    const db = makeFakeDb();
    const noop = () => {};
    const chain = () => new Proxy(function () {}, { get: () => chain(), apply: () => chain() });
    const sandbox = {
      console: { log: noop, warn: noop, error: noop },
      window: {}, document: { addEventListener: noop, getElementById: () => null },
      firebase: { firestore: Object.assign(chain(), { FieldValue: { serverTimestamp: () => 'TS' }, Timestamp: { now: noop } }), auth: chain, apps: [] },
      db, auth: chain(), ClassAvisos: CA,
      AppState: { currentUser: { uid: 'u_gestora' }, userProfile: { name: 'Benny' } },
      setTimeout, clearTimeout, Map, Set, Date, Math, JSON, String, Number, Array, Object, Boolean, RegExp, Promise, Error,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    for (const f of ['substitution-flow.js', 'professores-shared.js']) {
      if (f === 'professores-shared.js') sandbox.SubstitutionFlow = sandbox.window.SubstitutionFlow;
      vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8'), sandbox, { filename: f });
    }
    return { db, ClassService: vm.runInContext('ClassService', sandbox) };
  }
  {
    const { db, ClassService } = servico();
    const grava = (c) => db.collection('classes').doc(c.id).set(Object.assign({}, c, { scheduledDate: 'data' }));
    await grava(aula({ id: 'atraso', avisoProfessor: ocorr({ atrasoMinutos: 60 }) }));
    await grava(aula({ id: 'nao', avisoProfessor: naoAconteceu('sem alunos') }));
    await grava(aula({ id: 'fora', avisoProfessor: ocorr({ horaExtraMinutos: 15 }) }));
    await grava(aula({ id: 'limpa' }));
    await grava(aula({ id: 'fechada', avisoProfessor: naoAconteceu(), monthClosingId: 'ago' }));

    const lista = await ClassService.listAvisosPendentes();
    assert.ok(lista.success, lista.error);
    assert.deepStrictEqual(plano(lista.data.map(c => c.id)).sort(), ['atraso', 'fora', 'nao'], 'a lista traz os dois tipos de aviso e deixa de fora mês fechado');

    let r = await ClassService.atenderAviso('atraso', 'aceitar');
    assert.ok(r.success, r.error);
    let c = (await db.collection('classes').doc('atraso').get()).data();
    assert.strictEqual(c.atrasoMinutos, 60, 'o atraso passou pro campo que o fechamento lê');
    assert.strictEqual(c.status, 'realizada', 'o status ficou como estava');
    assert.strictEqual(c.avisoProfessor, null, 'o aviso saiu da fila');
    assert.deepStrictEqual({ d: c.avisoProfessorAtendido.decisao, por: c.avisoProfessorAtendido.atendidoPor, m: c.avisoProfessorAtendido.atrasoMinutos },
      { d: 'aceitar', por: 'u_gestora', m: 60 }, 'fica o rastro: o que foi informado, a decisão e quem decidiu');
    assert.strictEqual(c.registroAutomatico, false, 'mão humana passou: deixa de ser "confirmada automaticamente"');

    r = await ClassService.atenderAviso('nao', 'cancelar', 'conferido com o professor');
    assert.ok(r.success, r.error);
    c = (await db.collection('classes').doc('nao').get()).data();
    assert.strictEqual(c.status, 'cancelada', 'a aula que não aconteceu sai da folha');
    assert.strictEqual(c.avisoProfessorAtendido.decisao, 'cancelar');
    assert.strictEqual(c.adjustmentNote, 'conferido com o professor');

    r = await ClassService.atenderAviso('fora', 'dispensar', 'não ficou além');
    assert.ok(r.success, r.error);
    c = (await db.collection('classes').doc('fora').get()).data();
    assert.strictEqual(c.horaExtraMinutos, 0, 'dispensado: nada entrou na folha');
    assert.strictEqual(c.avisoProfessor, null, 'mas a pendência some');
    assert.strictEqual(c.avisoProfessorAtendido.decisao, 'dispensar');

    assert.ok(!(await ClassService.atenderAviso('limpa', 'aceitar')).success, 'aula sem aviso: recusa');
    assert.ok(!(await ClassService.atenderAviso('fechada', 'cancelar')).success, 'mês fechado: recusa');
    assert.ok(!(await ClassService.atenderAviso('nao', 'cancelar')).success, 'aviso já atendido não é atendido duas vezes');
    assert.strictEqual(plano((await ClassService.listAvisosPendentes()).data).length, 0, 'fila zerada');
    const audit = Object.values(db._dump().audit_log || {}).filter(a => a.type === 'class_aviso_atendido');
    assert.strictEqual(audit.length, 3, 'cada decisão fica na auditoria');
    passou('ClassService.atenderAviso grava a decisão, guarda o rastro e esvazia a fila');
  }

  /* ── 6. A tela da gestão: lista, botões por tipo, decisão ──────────── */
  function tela({ pendentes, confirmReturn = true, gestao = true }) {
    const els = new Map();
    const el = (id) => { if (!els.has(id)) els.set(id, { id, innerHTML: '', textContent: '', value: '', style: {} }); return els.get(id); };
    const st = { atendidos: [], sends: [], toasts: [], confirms: [], prompts: [] };
    const sandbox = {
      console: { log() {}, warn() {}, error() {} },
      document: { getElementById: el },
      toast: (msg, type) => st.toasts.push({ msg, type }),
      confirm: (m) => { st.confirms.push(m); return confirmReturn; },
      prompt: (m) => { st.prompts.push(m); return 'motivo digitado'; },
      escapeHtml: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      isAdminGestao: () => gestao, isSupervisao: () => false,
      ClassAvisos: CA,
      AgendaState: {
        teachersMap: new Map([['edu', { id: 'edu', name: 'EDUARDA SANTOS', userId: 'u_edu' }], ['alan', { id: 'alan', name: 'ALAN BRITO', userId: null }]]),
        modalitiesMap: new Map([['hiit', { id: 'hiit', name: 'Hiit/Marombinha' }]]),
        units: [{ id: 'cp', name: 'CrossTainer CP' }],
      },
      ClassService: {
        listAvisosPendentes: async () => ({ success: true, data: pendentes }),
        atenderAviso: async (id, decisao, nota) => { st.atendidos.push({ id, decisao, nota: nota || '' }); return { success: true }; },
      },
      NotifyService: { send: async (o) => { st.sends.push(plano(o)); return { success: true }; } },
      ModalityService: { list: async () => ({ success: true, data: [] }) }, TeacherService: { list: async () => ({ success: true, data: [] }) },
      UnitService: { list: async () => ({ success: true, data: [] }) },
      setTimeout, Date, Math, JSON, Promise, Map, Set, Array, Object, String, Number,
    };
    sandbox.window = sandbox; sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(raiz, 'professores-avisos.js'), 'utf8'), sandbox, { filename: 'professores-avisos.js' });
    return { sandbox, st, el };
  }
  {
    const pend = [
      aula({ id: 'a1', avisoProfessor: ocorr({ atrasoMinutos: 60, nota: 'trânsito' }) }),
      aula({ id: 'a2', teacherId: 'alan', scheduledDate: ts(2026, 8, 26, 11, 30), startTime: '11:30', avisoProfessor: naoAconteceu() }),
    ];
    const { sandbox, st, el } = tela({ pendentes: pend });
    await sandbox.renderAvisosProfessoresPage();
    const html = el('page-avisos-professores').innerHTML;
    assert.ok(/2 avisos? esperando/i.test(html), 'o topo diz quantos esperam');
    assert.ok(/EDUARDA SANTOS/.test(html) && /chegou 60 min atrasado/.test(html) && /trânsito/.test(html) && /09\/09/.test(html), 'a linha diz quem, o quê, a nota e o dia');
    assert.ok(/ALAN BRITO/.test(html) && /não aconteceu/.test(html) && /26\/08/.test(html));
    assert.ok(html.indexOf('ALAN BRITO') < html.indexOf('EDUARDA SANTOS'), 'o mais antigo vem primeiro — é o que mais atrasa o fechamento');
    const botoes = (id) => (html.match(new RegExp(`avisoDecidir\\('${id}','([a-z_]+)'\\)`, 'g')) || []).map(s => s.match(/,'([a-z_]+)'/)[1]);
    assert.deepStrictEqual(botoes('a1'), ['aceitar', 'dispensar'], 'atraso/hora extra: aceitar ou dispensar');
    assert.deepStrictEqual(botoes('a2'), ['cancelar', 'falta_justificada', 'falta_sem_aviso', 'dispensar'], '"não aconteceu": cancelar, falta avisada, falta sem aviso, ou a aula aconteceu');
    passou('a lista mostra cada aviso com os botões que cabem ao tipo');

    await sandbox.avisoDecidir('a1', 'aceitar');
    assert.deepStrictEqual(st.atendidos[0], { id: 'a1', decisao: 'aceitar', nota: '' });
    assert.strictEqual(st.sends.length, 1, 'o professor é avisado da resposta');
    assert.deepStrictEqual({ para: st.sends[0].recipients, tipo: st.sends[0].type }, { para: ['u_edu'], tipo: 'class_aviso_respondido' });
    assert.ok(/aceit/i.test(st.sends[0].body) && /09\/09/.test(st.sends[0].body), 'e fica sabendo o que foi decidido: ' + st.sends[0].body);

    await sandbox.avisoDecidir('a2', 'falta_sem_aviso');
    assert.ok(/falta/i.test(st.confirms[st.confirms.length - 1]) && /ALAN BRITO/.test(st.confirms[st.confirms.length - 1]), 'decisão que tira dinheiro pede confirmação, dizendo de quem');
    assert.strictEqual(st.atendidos[1].decisao, 'falta_sem_aviso');
    assert.strictEqual(st.sends.length, 1, 'quem não tem login não recebe aviso (e a tela não quebra)');
    passou('decidir grava, avisa o professor e pede confirmação quando mexe em pagamento');

    const cancelou = tela({ pendentes: pend, confirmReturn: false });
    await cancelou.sandbox.renderAvisosProfessoresPage();
    await cancelou.sandbox.avisoDecidir('a2', 'cancelar');
    assert.strictEqual(cancelou.st.atendidos.length, 0, 'desistiu na confirmação: nada gravado');
    await cancelou.sandbox.avisoDecidir('a1', 'dispensar');
    assert.strictEqual(cancelou.st.prompts.length, 1, 'dispensar pede o motivo');
    assert.deepStrictEqual(cancelou.st.atendidos[0], { id: 'a1', decisao: 'dispensar', nota: 'motivo digitado' });
    passou('cancelar a confirmação não grava; dispensar leva o motivo');

    const vazia = tela({ pendentes: [] });
    await vazia.sandbox.renderAvisosProfessoresPage();
    assert.ok(/Nenhum aviso/i.test(vazia.el('page-avisos-professores').innerHTML), 'sem pendência, a tela diz isso');
    const prof = tela({ pendentes: pend, gestao: false });
    await prof.sandbox.renderAvisosProfessoresPage();
    assert.ok(!/avisoDecidir/.test(prof.el('page-avisos-professores').innerHTML), 'quem não é gestão não vê botão nenhum');
    passou('lista vazia e acesso de quem não é gestão');
  }

  /* ── 7. O menu, o sino, a tela inicial e o fechamento conhecem a tela ── */
  {
    const Nav = require('../professores-nav.js');
    assert.ok(Nav.allowedPagesFor(['admin']).includes('avisos-professores') && Nav.allowedPagesFor(['supervisao']).includes('avisos-professores'), 'admin e supervisão têm a tela');
    assert.ok(!Nav.allowedPagesFor(['professor']).includes('avisos-professores'), 'professor não');
    const html = fs.readFileSync(path.join(raiz, 'professores.html'), 'utf8');
    assert.ok(/id="page-avisos-professores"/.test(html) && /class-avisos\.js\?v=/.test(html) && /professores-avisos\.js\?v=/.test(html), 'a página carrega a tela e o módulo');
    assert.ok(html.indexOf('class-avisos.js') < html.indexOf('professores-shared.js'), 'o módulo puro vem antes do serviço que o usa');
    const js = fs.readFileSync(path.join(raiz, 'professores.js'), 'utf8');
    assert.ok(/pageId === 'avisos-professores'/.test(js), 'navigateTo desenha a tela');
    assert.ok(/link\.type === 'avisos-professores'/.test(js), 'clicar no aviso do sino leva pra lista');
    const fn = fs.readFileSync(path.join(raiz, 'functions', 'index.js'), 'utf8');
    assert.ok(/exports\.onClassAvisoProfessor\s*=\s*onDocumentUpdated/.test(fn), 'existe o gatilho que avisa a gestão');
    assert.ok(/class_aviso_professor:/.test(fn), 'com título próprio no sino');
    passou('menu, página, sino e gatilho apontam pra lista de avisos');
  }

  /* ── 8. O gatilho só fala quando o aviso NASCE ─────────────────────── */
  {
    const F = require('../functions/class-avisos.js');
    assert.strictEqual(F.avisoNovo({ avisoProfessor: null }, { avisoProfessor: ocorr({ atrasoMinutos: 5 }) }), true, 'sem aviso → com aviso: avisa a gestão');
    assert.strictEqual(F.avisoNovo({}, { avisoProfessor: naoAconteceu() }), true);
    assert.strictEqual(F.avisoNovo({ avisoProfessor: naoAconteceu() }, { avisoProfessor: naoAconteceu() }), false, 'aviso que já existia: outra alteração da aula não repete o aviso');
    assert.strictEqual(F.avisoNovo({ avisoProfessor: naoAconteceu() }, { avisoProfessor: null }), false, 'gestão atendeu: não é aviso novo');
    assert.strictEqual(F.avisoNovo({}, {}), false, 'a confirmação automática da madrugada (75 aulas por dia) não dispara nada');
    passou('o gatilho da gestão dispara só quando o aviso nasce');
  }

  /* ── 9. A tela inicial da gestão cobra os avisos ───────────────────── */
  {
    async function home(avisos) {
      const body = { innerHTML: '' };
      const vazio = { get: async () => ({ size: 0 }) };
      const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        document: { getElementById: (id) => (id === 'home-body' ? body : null) },
        db: { collection: () => ({ where: () => vazio }) },
        ClassService: { listAvisosPendentes: avisos === 'erro' ? (async () => ({ success: false, error: 'x' })) : (async () => ({ success: true, data: avisos })) },
        isAdminGestao: () => true, isSupervisao: () => false,
        Date, Math, JSON, Promise, Array, Object, String, Number,
      };
      sandbox.window = sandbox;
      vm.createContext(sandbox);
      vm.runInContext(fs.readFileSync(path.join(raiz, 'professores-home.js'), 'utf8'), sandbox, { filename: 'professores-home.js' });
      await sandbox._renderHomeAdmin();
      return body.innerHTML;
    }
    const com = await home([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    assert.ok(/<b>3<\/b> avisos de professores a responder/.test(com) && /navigateTo\('avisos-professores'\)/.test(com), 'o chip diz quantos e leva pra lista: ' + com.slice(0, 300));
    assert.ok(/Precisam de você/.test(com), 'dentro do bloco "Precisam de você"');
    assert.ok(/<b>1<\/b> aviso de professor a responder/.test(await home([{ id: 'a' }])), 'no singular quando é um só');
    assert.ok(/Tudo em dia/.test(await home([])), 'sem aviso, a home continua dizendo que está tudo em dia');
    assert.ok(/Tudo em dia/.test(await home('erro')), 'se a consulta falhar, a home não quebra (o chip só não aparece)');
    passou('a tela inicial da gestão mostra quantos avisos esperam resposta');
  }

  console.log(`\n${ok} verificações ✓`);
})().catch(e => { console.error('✗', e.stack || e.message); process.exit(1); });
