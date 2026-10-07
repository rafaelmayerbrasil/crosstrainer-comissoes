'use strict';
// Roda: node scripts/smoke-falta-do-dia.js
process.env.TZ = 'America/Sao_Paulo';
//
// "Falta do dia" (pedido da gestão, 07/10/2026): lançar a falta de uma pessoa
// em todas as aulas do dia — ou em algumas — sem abrir aula por aula. Na mesma
// tela, a aula que um colega deu no lugar vira a troca de professor de sempre.
//
// Aqui: as regras (o que pode ser marcado, o que o plano exige, os textos) e o
// serviço de troca sem o pedido de confirmação ao titular. A tela está em
// smoke-falta-do-dia-tela.js.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const makeFakeDb = require('./_fake-firestore.js');
const F = require('../falta-do-dia.js');

const raiz = path.join(__dirname, '..');
let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };
const ts = (y, m, d, h, mi) => ({ toDate: () => new Date(y, m - 1, d, h || 8, mi || 0) });

const aula = (id, ini, fim, extra) => {
  const [h, mi] = ini.split(':').map(Number);
  return Object.assign({
    id, teacherId: 'edu', originalTeacherId: 'edu', unitId: 'cp', modalityId: 'hiit',
    scheduledDate: ts(2026, 10, 6, h, mi), startTime: ini, endTime: fim, durationMinutes: 60,
    status: 'realizada', monthClosingId: null, faltaTipo: null,
  }, extra || {});
};
const DIA = '2026-10-06';
const AGORA = new Date(2026, 9, 7, 10, 0);   // 07/10, 10h: o dia 06 já passou inteiro

(async () => {
  /* ── 1. As aulas da pessoa no dia, nas duas unidades, em ordem ─────── */
  {
    const classes = [
      aula('c3', '18:00', '19:00', { unitId: 'pp' }),
      aula('c1', '07:00', '08:00'),
      aula('c2', '08:00', '09:00'),
      aula('outro', '07:00', '08:00', { teacherId: 'bia' }),
      aula('ontem', '07:00', '08:00', { scheduledDate: ts(2026, 10, 5, 7) }),
    ];
    const itens = F.aulasDoDia(classes, 'edu', DIA);
    assert.deepStrictEqual(itens.map(i => i.id), ['c1', 'c2', 'c3'], 'só as dela, só do dia, por horário');
    assert.ok(itens.every(i => i.pode && i.podeColega && i.padrao === 'falta'), 'aula comum nasce marcada como falta — é o pedido: o dia inteiro num clique');
    assert.deepStrictEqual(F.pessoasComAula(classes, DIA), ['bia', 'edu'], 'e a lista de pessoas do dia traz quem tem aula nele');
    passou('aulasDoDia: as aulas da pessoa no dia, das duas unidades, já marcadas');
  }

  /* ── 2. O que NÃO pode ser marcado diz o motivo ────────────────────── */
  {
    const classes = [
      aula('fechada', '07:00', '08:00', { monthClosingId: '2026-10' }),
      aula('cancelada', '08:00', '09:00', { status: 'cancelada' }),
      aula('troca', '09:00', '10:00'),
      aula('escola', '13:00', '14:00', { specialScaleType: 'escola_interna' }),
      aula('jaFalta', '18:00', '19:00', { status: 'nao_realizada', faltaTipo: 'sem_aviso' }),
      aula('naoReal', '19:00', '20:00', { status: 'nao_realizada' }),
      aula('cobrindo', '20:00', '21:00', { originalTeacherId: 'bia', status: 'substituida' }),
    ];
    const itens = F.aulasDoDia(classes, 'edu', DIA, { subsAbertas: [{ classId: 'troca', status: 'pending' }, { classId: 'cobrindo', status: 'accepted' }] });
    const de = (id) => itens.find(i => i.id === id);
    assert.ok(!de('fechada').pode && /fechado/i.test(de('fechada').motivo), 'mês fechado não se mexe');
    assert.ok(!de('cancelada').pode && /cancelada/i.test(de('cancelada').motivo), 'aula cancelada não tem falta');
    assert.ok(!de('troca').pode && /Substituições/.test(de('troca').motivo), 'troca esperando confirmação: resolve lá primeiro (senão ela fica aberta e trava o fechamento)');
    assert.ok(!de('escola').pode && /Escola Interna/.test(de('escola').motivo), 'Escola Interna não conta horas: a presença é do Engajamento');
    assert.ok(de('jaFalta').pode && de('jaFalta').padrao === 'nada' && /sem aviso/i.test(de('jaFalta').nota), 'falta já lançada aparece como está e não é remarcada sozinha');
    assert.ok(!de('jaFalta').podeColega && !de('naoReal').podeColega, 'aula que não aconteceu não tem como "um colega deu"');
    assert.strictEqual(de('naoReal').padrao, 'nada', 'não realizada sem falta também não é remarcada sozinha');
    assert.ok(de('cobrindo').pode && de('cobrindo').padrao === 'falta' && de('cobrindo').noLugarDe === 'bia', 'aula que ela pegou de um colega entra, com a marca "no lugar de" (a troca já confirmada não bloqueia)');
    passou('aulasDoDia: mês fechado, cancelada, troca em aberto e Escola Interna ficam de fora, com o motivo');
  }

  /* ── 3. O plano: faltas, trocas e o que falta preencher ────────────── */
  const classes3 = [aula('c1', '07:00', '08:00'), aula('c2', '08:00', '09:00'), aula('c3', '18:00', '19:00', { unitId: 'pp' }),
    aula('x', '19:00', '20:00', { status: 'cancelada' })];
  const itens3 = F.aulasDoDia(classes3, 'edu', DIA);
  {
    const p = F.plano(itens3, F.escolhasPadrao(itens3), { teacherId: 'edu', faltaTipo: 'sem_aviso', agora: AGORA });
    assert.ok(p.ok, p.erro);
    assert.deepStrictEqual(p.faltas.map(c => c.id), ['c1', 'c2', 'c3'], 'o padrão é o dia inteiro, menos o que não pode');
    assert.strictEqual(p.trocas.length, 0);

    const misto = F.plano(itens3, { c1: { tipo: 'falta' }, c2: { tipo: 'nada' }, c3: { tipo: 'colega', colegaId: 'bia' } }, { teacherId: 'edu', faltaTipo: 'justificada', agora: AGORA });
    assert.ok(misto.ok, misto.erro);
    assert.deepStrictEqual({ f: misto.faltas.map(c => c.id), t: misto.trocas.map(t => [t.cls.id, t.colegaId]) }, { f: ['c1'], t: [['c3', 'bia']] },
      'algumas aulas: uma falta, uma ela deu, uma o colega deu');

    const soTroca = F.plano(itens3, { c1: { tipo: 'colega', colegaId: 'bia' }, c2: { tipo: 'nada' }, c3: { tipo: 'nada' } }, { teacherId: 'edu', faltaTipo: '', agora: AGORA });
    assert.ok(soTroca.ok, 'só troca não exige o tipo da falta: ' + soTroca.erro);

    const erro = (escolhas, opt) => F.plano(itens3, escolhas, Object.assign({ teacherId: 'edu', faltaTipo: 'justificada', agora: AGORA }, opt || {})).erro;
    assert.ok(/nada/i.test(erro({ c1: { tipo: 'nada' }, c2: { tipo: 'nada' }, c3: { tipo: 'nada' } })), 'nada marcado: não há o que lançar');
    assert.ok(/avisada ou sem aviso/i.test(erro(F.escolhasPadrao(itens3), { faltaTipo: '' })), 'falta sem dizer o tipo: pede o tipo');
    assert.ok(/quem deu/i.test(erro({ c1: { tipo: 'colega' } })) && /07:00/.test(erro({ c1: { tipo: 'colega' } })), 'colega sem nome: diz de qual aula');
    assert.ok(/própria pessoa/i.test(erro({ c1: { tipo: 'colega', colegaId: 'edu' } })), 'a pessoa não cobre a si mesma');
    assert.ok(/não pode/i.test(erro({ x: { tipo: 'falta' } })), 'aula bloqueada não entra nem forçando');
    passou('plano: dia inteiro, algumas aulas, só troca — e os erros que a tela mostra');
  }

  /* ── 4. Aula que ainda não começou só aceita falta avisada ─────────── */
  {
    const cedo = new Date(2026, 9, 6, 7, 30);   // 06/10, 07:30: a das 07:00 começou, as outras não
    const semAviso = F.plano(itens3, F.escolhasPadrao(itens3), { teacherId: 'edu', faltaTipo: 'sem_aviso', agora: cedo });
    assert.ok(!semAviso.ok && /ainda não começ/i.test(semAviso.erro) && /08:00/.test(semAviso.erro), 'não existe "sem aviso" de aula que não começou: ' + semAviso.erro);
    assert.ok(F.plano(itens3, F.escolhasPadrao(itens3), { teacherId: 'edu', faltaTipo: 'justificada', agora: cedo }).ok, 'avisada pode (a pessoa avisou que não vem)');
    assert.ok(F.plano(itens3, { c1: { tipo: 'falta' }, c2: { tipo: 'nada' }, c3: { tipo: 'nada' } }, { teacherId: 'edu', faltaTipo: 'sem_aviso', agora: cedo }).ok, 'e a que já começou aceita sem aviso');
    assert.strictEqual(F.temAulaFutura(itens3, cedo), true);
    assert.strictEqual(F.temAulaFutura(itens3, AGORA), false);
    passou('aula que ainda não começou só aceita "falta avisada"');
  }

  /* ── 5. Os textos: a pergunta de confirmação e o aviso ao professor ── */
  {
    const p = F.plano(itens3, { c1: { tipo: 'falta' }, c2: { tipo: 'falta' }, c3: { tipo: 'colega', colegaId: 'bia' } }, { teacherId: 'edu', faltaTipo: 'sem_aviso', agora: AGORA });
    const nomes = { edu: 'EDUARDA SANTOS', bia: 'BIA LIMA' };
    const t = F.resumo(p, { nome: 'EDUARDA SANTOS', nomeDe: (id) => nomes[id], dia: DIA });
    assert.ok(/EDUARDA SANTOS/.test(t) && /06\/10/.test(t), 'diz de quem e de que dia: ' + t);
    assert.ok(/2 faltas sem aviso/.test(t) && /07:00/.test(t) && /08:00/.test(t), 'quantas faltas, de que tipo e em que horários');
    assert.ok(/BIA LIMA/.test(t) && /18:00/.test(t), 'e qual aula passa para qual colega');
    assert.ok(/saem das horas pagas/i.test(t), 'e o efeito no pagamento');
    assert.ok(/EDUARDA SANTOS recebe um aviso no sino/.test(t) && !/avisad[oa]/.test(t), 'sem adivinhar o gênero de quem faltou ("é avisada" saiu para o Marcos no staging)');

    const msg = F.mensagemParaOProfessor(p, DIA);
    assert.ok(/falta sem aviso/.test(msg) && /2 aulas/.test(msg) && /06\/10/.test(msg) && /07:00/.test(msg) && /gestão/.test(msg), 'o professor fica sabendo o que foi lançado: ' + msg);
    assert.ok(!/BIA/.test(msg), 'da troca ele é avisado pelo caminho de sempre, não por aqui');
    const uma = F.plano(itens3, { c1: { tipo: 'falta' }, c2: { tipo: 'nada' }, c3: { tipo: 'nada' } }, { teacherId: 'edu', faltaTipo: 'justificada', agora: AGORA });
    assert.ok(/1 falta avisada/.test(F.resumo(uma, { nome: 'X', nomeDe: () => '', dia: DIA })) && /na sua aula/.test(F.mensagemParaOProfessor(uma, DIA)), 'no singular quando é uma só');
    assert.strictEqual(F.mensagemParaOProfessor(soTrocaDe(itens3), DIA), '', 'sem falta, não há aviso de falta');
    passou('resumo para confirmar e aviso ao professor dizem o que foi lançado');
  }
  function soTrocaDe(itens) { return F.plano(itens, { c1: { tipo: 'colega', colegaId: 'bia' }, c2: { tipo: 'nada' }, c3: { tipo: 'nada' } }, { teacherId: 'edu', faltaTipo: '', agora: AGORA }); }

  /* ── 6. O serviço de troca: a gestão que já confirma não pede confirmação ── */
  {
    const db = makeFakeDb();
    const noop = () => {};
    const chain = () => new Proxy(function () {}, { get: () => chain(), apply: () => chain() });
    const notifs = [];
    const sandbox = {
      console: { log: noop, warn: noop, error: noop },
      window: {}, document: { addEventListener: noop, getElementById: () => null },
      firebase: { firestore: Object.assign(chain(), { FieldValue: { serverTimestamp: () => 'TS' }, Timestamp: { now: noop } }), auth: chain, apps: [] },
      db, auth: chain(), ClassAvisos: require('../class-avisos.js'),
      AppState: { currentUser: { uid: 'u_gestora' }, userProfile: { name: 'Benny' } },
      isAdminGestao: () => true, isSupervisao: () => false, getCurrentProfessorId: () => null,
      setTimeout, clearTimeout, Map, Set, Date, Math, JSON, String, Number, Array, Object, Boolean, RegExp, Promise, Error,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    for (const f of ['substitution-flow.js', 'professores-shared.js']) {
      if (f === 'professores-shared.js') sandbox.SubstitutionFlow = sandbox.window.SubstitutionFlow;
      vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8'), sandbox, { filename: f });
    }
    vm.runInContext('NotificationService.create = async (o) => { __notifs.push(o); return { success: true }; };', Object.assign(sandbox, { __notifs: notifs }));
    const Subs = vm.runInContext('SubstitutionService', sandbox);
    for (const id of ['a', 'b']) {
      await db.collection('classes').doc(id).set({ teacherId: 'edu', status: 'realizada', scheduledDate: new Date(2026, 9, 6, 7).toISOString(), startTime: '07:00', endTime: '08:00', modalityId: 'hiit', monthClosingId: null });
    }
    await db.collection('teachers').doc('edu').set({ name: 'EDUARDA', userId: 'u_edu' });
    await db.collection('teachers').doc('bia').set({ name: 'BIA', userId: 'u_bia' });

    const normal = await Subs.create({ classId: 'a', substituteTeacherId: 'bia', reason: 'x', registradoPor: 'gestao' });
    assert.ok(normal.success, normal.error);
    assert.strictEqual(notifs.filter(n => n.type === 'substitution_requested').length, 1, 'o caminho de sempre continua avisando quem confirma');

    const semPedido = await Subs.create({ classId: 'b', substituteTeacherId: 'bia', reason: 'x', registradoPor: 'gestao', avisarQuemConfirma: false });
    assert.ok(semPedido.success, semPedido.error);
    assert.strictEqual(notifs.filter(n => n.type === 'substitution_requested').length, 1,
      'lançando o dia, a gestão confirma na sequência: o titular não recebe N pedidos (e N e-mails) de "uma troca espera você"');
    assert.strictEqual(semPedido.data.status, 'pending', 'o pedido nasce como sempre — quem move a aula é a confirmação');
    passou('SubstitutionService.create aceita não pedir confirmação quando a gestão já confirma');
  }

  /* ── 7. A página carrega o módulo antes da tela ────────────────────── */
  {
    const html = fs.readFileSync(path.join(raiz, 'professores.html'), 'utf8');
    assert.ok(/falta-do-dia\.js\?v=/.test(html) && /professores-falta-dia\.js\?v=/.test(html), 'a página carrega o módulo e a tela');
    assert.ok(html.indexOf('src="falta-do-dia.js') < html.indexOf('src="professores-falta-dia.js'), 'o módulo puro vem antes da tela');
    assert.ok(html.indexOf('src="falta-do-dia.js') < html.indexOf('src="professores-shared.js'), 'e antes do serviço, como os outros módulos de regra');
    assert.ok(html.indexOf('src="professores-agenda.js') < html.indexOf('src="professores-falta-dia.js'), 'a tela vem depois da agenda, de quem ela usa o estado');
    assert.ok(/id="faltaDiaModal"/.test(html) && /id="faltaDiaBody"/.test(html), 'e tem a janela');
    passou('professores.html carrega falta-do-dia.js, a tela e a janela');
  }

  console.log(`\n${ok} verificações ✓`);
})().catch(e => { console.error('✗', e.stack || e.message); process.exit(1); });
