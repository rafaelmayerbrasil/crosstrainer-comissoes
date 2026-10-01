'use strict';
// Roda: node scripts/smoke-troca-avisa-escala-colada.js
process.env.TZ = 'America/Sao_Paulo';
//
// O caso do Vagner (reclamação no grupo, 01/10/2026): escalado em 19/09, 03/10
// e 17/10, trocou o 19/09 pelo 26/09 com o Thiago ("Troquei com o Vaguinho,
// irei trabalhar no dia 19"). A gestão confirmou. Resultado: 26/09 e 03/10
// seguidos — e em nenhuma das duas telas (a de quem registra e a de quem
// confirma) havia uma linha dizendo isso.
//
// RODA as telas num sandbox `vm` — `renderSubstituicoesPage` inteiro e o
// `saveSubstitution` da agenda — e confere o que sai. As contas são as do
// scale-service.js real.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SS = require('../scale-service.js');

const raiz = path.join(__dirname, '..');
let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

const sab = (date, pid) => ({ id: 's' + date, date, tipo: 'sabado', published: true,
  slots: [{ id: 'v', unitId: 'pp', requiredModalityId: 'toi', assignedPersonId: pid }] });
const ESCALAS = [sab('2026-09-19', 'vagner'), sab('2026-09-26', 'thiago'), sab('2026-10-03', 'vagner'), sab('2026-10-17', 'vagner')];
const PROFS = new Map([
  ['thiago', { id: 'thiago', name: 'THIAGO VALENTIM', userId: 'u_thiago', isActive: true, modalityIds: ['toi'] }],
  ['vagner', { id: 'vagner', name: 'VAGNER TEIXEIRA', userId: 'u_vagner', isActive: true, modalityIds: ['toi'] }],
  ['livre',  { id: 'livre',  name: 'FULANO LIVRE',    userId: 'u_livre',  isActive: true, modalityIds: ['toi'] }],
]);
const ts = (y, m, d, h) => ({ toDate: () => new Date(y, m - 1, d, h || 8, 0) });
const pedido = (id, dia, de, para, status) => ({
  id, status: status || 'pending', requestingTeacherId: de, substituteTeacherId: para,
  registradoPor: 'titular', classDate: ts(2026, dia[1], dia[0]), classStartTime: '08:00', classModalityId: 'toi',
});

function novoSandbox({ subs, escalasFalham, config, professor, escalas } = {}) {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) els.set(id, { id, innerHTML: '', textContent: '', value: '', disabled: false, style: {}, dataset: {},
      classList: { add() {}, remove() {} }, querySelector: () => null, appendChild() {} });
    return els.get(id);
  };
  const state = { confirms: [], confirmReturn: true, criadas: [], homologadas: [], toasts: [] };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: () => el('tmp'), addEventListener() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    toast: (msg, type) => { state.toasts.push({ msg, type }); },
    confirm: (msg) => { state.confirms.push(msg); return state.confirmReturn; },
    prompt: () => '',
    escapeHtml: (s) => String(s),
    firebase: { firestore: () => ({}) }, db: {},
    ProfHelpers: {
      WEEKDAY_LABEL: ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'],
      WEEKDAY_LABEL_SHORT: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
      minutesBetween: () => 60, timeToMinutes: () => 0, detectSlotConflict: () => [],
      classEffectiveMinutes: (c) => c.durationMinutes || 0, classCountsForPay: () => true,
      formatDateBR: () => '26/09/2026',
    },
    isAdminGestao: () => !professor, isSupervisao: () => false,
    getCurrentProfessorId: () => 'thiago',
    UnitService: {}, ModalityService: {}, TeacherService: {}, ScheduleSlotService: {}, ClassService: {}, ScheduleTemplateService: {},
    SubstitutionService: {
      listAll: async () => ({ success: true, data: subs || [] }),
      create: async (o) => { state.criadas.push(JSON.parse(JSON.stringify(o))); return { success: true, data: { id: 'novo', substituteUserId: 'u' } }; },
      homologar: async (id) => { state.homologadas.push(id); return { success: true }; },
    },
    ScaleService: Object.assign({}, SS, {
      listScales: async () => (escalasFalham ? { success: false, error: 'boom' } : { success: true, data: escalas || ESCALAS }),
      ScaleConfigService: { get: async () => ({ success: true, data: config || {} }) },
    }),
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['substitution-flow.js', 'professores-agenda.js', 'professores-substituicoes.js']) {
    vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8'), sandbox, { filename: f });
  }
  const run = (code) => vm.runInContext(code, sandbox);
  sandbox.__profs = PROFS;
  run('AgendaState.teachersMap = __profs; AgendaState.modalitiesMap = new Map([["toi", { id: "toi", name: "TOI" }]]);');
  sandbox.subsHojeISO = () => '2026-09-11';   // o dia em que o Thiago registrou a troca
  return { sandbox, state, el, run };
}

(async () => {
  /* ── 1. Gestão: o cartão da troca diz o que ela provoca ───────────── */
  {
    const subs = [pedido('s26', [26, 9], 'thiago', 'vagner'), pedido('sQua', [23, 9], 'thiago', 'livre')];
    const { sandbox, el } = novoSandbox({ subs });
    await sandbox.renderSubstituicoesPage();
    const html = el('page-substituicoes').innerHTML;
    const cartao = (id) => { const i = html.indexOf(`subsHomologar('${id}'`); assert.ok(i !== -1, `cartão ${id} com botão`); return html.slice(html.lastIndexOf('class="class-card"', i), i + 200); };
    assert.ok(/VAGNER TEIXEIRA/.test(cartao('s26')) && /19\/09 e 03\/10/.test(cartao('s26')) && /escalas? seguidas|coladas|próximas/.test(cartao('s26')),
      'o cartão do 26/09 avisa: o Vagner fica com 19/09, 26/09 e 03/10 colados');
    assert.ok(!/03\/10/.test(cartao('sQua')), 'troca de aula comum de quarta-feira não ganha aviso');
    passou('gestão vê no cartão que a troca deixa o Vagner com escalas coladas');

    /* ── 2. …e a confirmação repete o aviso ──────────────────────────── */
    const { sandbox: sb2, state: st2 } = novoSandbox({ subs });
    await sb2.renderSubstituicoesPage();
    st2.confirmReturn = false;
    await sb2.subsHomologar('s26', true);
    assert.ok(/VAGNER TEIXEIRA/.test(st2.confirms[0]) && /03\/10/.test(st2.confirms[0]), 'a pergunta de confirmação traz o aviso: ' + st2.confirms[0]);
    assert.strictEqual(st2.homologadas.length, 0, 'gestão desistiu: nada confirmado');
    await sb2.subsHomologar('sQua', true);
    assert.ok(!/03\/10/.test(st2.confirms[1]), 'troca sem conflito: a pergunta de sempre, sem aviso');
    passou('a confirmação da gestão repete o aviso, e só quando há conflito');
  }

  /* ── 3. Troca casada: o dia de que a pessoa está saindo não conta ──── */
  {
    const subs = [pedido('s26', [26, 9], 'thiago', 'vagner'), pedido('s19', [19, 9], 'vagner', 'thiago')];
    const { sandbox } = novoSandbox({ subs });
    await sandbox.renderSubstituicoesPage();
    assert.deepStrictEqual(Array.from(sandbox.subsDatasColadas(subs[0])), ['2026-10-03'],
      'o Vagner está saindo do 19/09 (troca casada): sobra só o 03/10');
    assert.deepStrictEqual(Array.from(sandbox.subsDatasColadas(subs[1])), [],
      'o Thiago assume o 19/09 e sai do 26/09: nenhum conflito');
    passou('troca casada: o dia que a pessoa passou adiante não entra no aviso');
  }

  /* ── 4. Aula que já aconteceu, troca resolvida e escala fora do ar ─── */
  {
    const subs = [pedido('s26', [26, 9], 'thiago', 'vagner'), pedido('sOk', [26, 9], 'thiago', 'vagner', 'accepted')];
    const { sandbox } = novoSandbox({ subs });
    await sandbox.renderSubstituicoesPage();
    assert.deepStrictEqual(Array.from(sandbox.subsDatasColadas(subs[1])), [], 'troca já confirmada: não há mais o que avisar');
    sandbox.subsHojeISO = () => '2026-09-27';
    assert.deepStrictEqual(Array.from(sandbox.subsDatasColadas(subs[0])), [], 'registrar depois que a aula aconteceu é anotar um fato: sem aviso');
    passou('aula passada e troca já resolvida não ganham aviso');

    const { sandbox: sb, el } = novoSandbox({ subs: [subs[0]], escalasFalham: true });
    await sb.renderSubstituicoesPage();
    assert.ok(/subsHomologar\('s26'/.test(el('page-substituicoes').innerHTML), 'sem conseguir ler as escalas, a tela de trocas continua funcionando');
    assert.deepStrictEqual(Array.from(sb.subsDatasColadas(subs[0])), [], 'só não tem o aviso');
    passou('escalas fora do ar não derrubam a tela de trocas');
  }

  /* ── 5. A folga configurada vale aqui também ─────────────────────── */
  {
    const subs = [pedido('s26', [26, 9], 'thiago', 'vagner')];
    const { sandbox } = novoSandbox({ subs, config: { folgaMinimaSabados: 3 } });
    await sandbox.renderSubstituicoesPage();
    assert.deepStrictEqual(Array.from(sandbox.subsDatasColadas(subs[0])), ['2026-09-19', '2026-10-03', '2026-10-17'], 'com 3 sábados de folga o 17/10 também entra');
    passou('o aviso da troca usa a folga mínima configurada');
  }

  /* ── 6. Quem registra a troca é avisado antes de enviar ──────────── */
  const aula = (dia, extra) => Object.assign({ id: 'c1', teacherId: 'thiago', modalityId: 'toi',
    scheduledDate: ts(2026, dia[1], dia[0]), specialScaleType: 'sabado', generatedBy: 'escala-smart' }, extra || {});
  async function registrar({ cls, confirmReturn, lado, professor, escalas }) {
    const t = novoSandbox({ professor, escalas });
    t.sandbox.findClassAnywhere = () => cls;
    t.run(`SubstitutionFormState.classId = 'c1'; SubstitutionFormState.lado = '${lado || 'titular'}';`);
    t.el('substituteSelect').value = 'vagner';
    t.state.confirmReturn = confirmReturn;
    await t.sandbox.saveSubstitution();
    return t;
  }
  {
    let t = await registrar({ cls: aula([26, 9]), confirmReturn: false });
    assert.strictEqual(t.state.confirms.length, 1, 'perguntou antes de enviar');
    assert.ok(/VAGNER TEIXEIRA/.test(t.state.confirms[0]) && /19\/09 e 03\/10/.test(t.state.confirms[0]), 'diz quem e com quais dias: ' + t.state.confirms[0]);
    assert.strictEqual(t.state.criadas.length, 0, 'desistiu: a troca não foi registrada');
    assert.strictEqual(t.el('substitutionSaveBtn').disabled, false, 'o botão volta a funcionar pra escolher outra pessoa');

    t = await registrar({ cls: aula([26, 9]), confirmReturn: true });
    assert.strictEqual(t.state.criadas.length, 1, 'confirmou: a troca é registrada normalmente');
    assert.strictEqual(t.state.criadas[0].substituteTeacherId, 'vagner');
    passou('quem registra a troca de uma aula de escala é avisado e pode desistir');

    t = await registrar({ cls: aula([23, 9], { specialScaleType: null, generatedBy: 'cron' }), confirmReturn: false });
    assert.strictEqual(t.state.confirms.length, 0, 'aula comum: nenhuma pergunta');
    assert.strictEqual(t.state.criadas.length, 1);
    passou('aula comum de grade segue sem pergunta nenhuma');

    // Professor não vê escala antes de publicar ("nada aparece pro professor
    // antes de publicar", 26/08). O aviso não pode ser a porta dos fundos.
    const comPrevia = ESCALAS.map(e => (e.date === '2026-10-03' ? Object.assign({}, e, { published: false }) : e));
    t = await registrar({ cls: aula([26, 9]), confirmReturn: false, professor: true, escalas: comPrevia });
    assert.strictEqual(t.state.confirms.length, 1, 'ainda avisa do 19/09, que está publicado');
    assert.ok(/19\/09/.test(t.state.confirms[0]) && !/03\/10/.test(t.state.confirms[0]),
      'mas o 03/10, ainda não publicado, não aparece pro professor: ' + t.state.confirms[0]);
    t = await registrar({ cls: aula([26, 9]), confirmReturn: false, professor: false, escalas: comPrevia });
    assert.ok(/03\/10/.test(t.state.confirms[0]), 'a gestão, registrando, vê tudo');
    passou('o aviso pro professor só usa escala publicada');
  }

  console.log(`\n${ok} verificações ✓`);
})().catch(e => { console.error('✗', e.stack || e.message); process.exit(1); });
