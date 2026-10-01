'use strict';
// Roda: node scripts/smoke-aviso-professor-horario.js
//
// "O Rodrigo falou que esse botão não tá funcionando" (01/10/2026, print do
// iPhone do Theo Rosa: campo "Fiquei além" com **14:05**, botão "Enviar para a
// gestão").
//
// O botão funcionava — 11 avisos de atraso/hora extra já tinham sido gravados
// em produção. O que o Theo fez foi digitar o HORÁRIO em que saiu num campo que
// pedia MINUTOS. Três coisas empilhadas:
//   1. A tela pedia a conta pronta ("quantos minutos além"), e as pessoas pensam
//      em horário — é como o próprio Theo manda as horas do mês: "9:30 às 12:36".
//   2. O campo era <input type="number">. No iPhone ele deixa digitar "14:05",
//      mas entrega valor VAZIO pra página. O código lia zero.
//   3. O erro ("Preencha ao menos um dos campos") saía num aviso flutuante que
//      fica ATRÁS da janela aberta (z-index 200 contra 1000). Nada aparecia.
//
// Agora o professor informa a hora em que chegou e a hora em que saiu, e o
// sistema faz a conta. O que vai pro banco continua sendo minutos.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };
const html = fs.readFileSync(path.join(raiz, 'professores.html'), 'utf8');

function novoSandbox() {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) els.set(id, { id, innerHTML: '', textContent: '', value: '', disabled: false, style: {}, dataset: {},
      classList: { add() {}, remove() {} }, querySelector: () => null, appendChild() {} });
    return els.get(id);
  };
  const state = { toasts: [], confirms: [], confirmReturn: true, enviados: [], recarregou: 0 };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: () => el('tmp'), addEventListener() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    toast: (msg, type) => { state.toasts.push({ msg, type }); },
    confirm: (msg) => { state.confirms.push(msg); return state.confirmReturn; },
    escapeHtml: (s) => String(s),
    firebase: { firestore: () => ({}) }, db: {},
    ProfHelpers: {
      WEEKDAY_LABEL: ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'],
      WEEKDAY_LABEL_SHORT: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
      minutesBetween: () => 60, timeToMinutes: () => 0, detectSlotConflict: () => [],
      classEffectiveMinutes: (c) => c.durationMinutes || 0, classCountsForPay: () => true,
    },
    isAdminGestao: () => false, isSupervisao: () => false,
    getCurrentProfessorId: () => 'theo',
    UnitService: {}, ModalityService: {}, TeacherService: {}, ScheduleSlotService: {}, ScheduleTemplateService: {},
    ClassService: {
      avisarOcorrencia: async (id, dados) => { state.enviados.push({ id, dados: JSON.parse(JSON.stringify(dados)) }); return { success: true }; },
    },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(raiz, 'professores-agenda.js'), 'utf8'), sandbox, { filename: 'professores-agenda.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  // A aula do print: 12:30–13:30, a última do turno da manhã do Theo em 01/10.
  sandbox.__aula = { id: 'c1', teacherId: 'theo', originalTeacherId: 'theo', startTime: '12:30', endTime: '13:30', durationMinutes: 60, status: 'prevista' };
  run('MinhaAgendaState.classes = [__aula]; MinhaAgendaState.selectedClassId = "c1";');
  sandbox.recarregarAgendaAtual = async () => { state.recarregou++; };
  return { sandbox, state, el, run };
}
const conta = (sb, aula, chegada, saida) => JSON.parse(JSON.stringify(sb.ocorrenciaPorHorario(aula, chegada, saida)));
const AULA = { startTime: '12:30', endTime: '13:30' };

(async () => {
  /* ── 1. A conta: do horário pros minutos ──────────────────────────── */
  {
    const { sandbox } = novoSandbox();
    const c = (chegada, saida) => conta(sandbox, AULA, chegada, saida);
    assert.deepStrictEqual(c('', '14:05'), { atrasoMinutos: 0, saidaAntecipadaMinutos: 0, horaExtraMinutos: 35, erro: '' },
      'o caso do Theo: saiu 14:05 de uma aula que acabava 13:30 → 35 min além');
    assert.deepStrictEqual(c('12:45', ''), { atrasoMinutos: 15, saidaAntecipadaMinutos: 0, horaExtraMinutos: 0, erro: '' }, 'chegou 12:45 → 15 min de atraso');
    assert.deepStrictEqual(c('', '13:10'), { atrasoMinutos: 0, saidaAntecipadaMinutos: 20, horaExtraMinutos: 0, erro: '' }, 'saiu 13:10 → 20 min antes');
    assert.deepStrictEqual(c('12:40', '13:50'), { atrasoMinutos: 10, saidaAntecipadaMinutos: 0, horaExtraMinutos: 20, erro: '' }, 'atrasou e ficou além, os dois juntos');
    assert.deepStrictEqual(c('12:30', '13:30'), { atrasoMinutos: 0, saidaAntecipadaMinutos: 0, horaExtraMinutos: 0, erro: '' }, 'igual ao horário da aula: nada a informar');
    assert.deepStrictEqual(c('12:00', ''), { atrasoMinutos: 0, saidaAntecipadaMinutos: 0, horaExtraMinutos: 0, erro: '' }, 'chegar antes não é atraso nem hora extra');
    passou('ocorrenciaPorHorario transforma a hora de chegada e de saída em minutos');

    assert.ok(/depois do fim/.test(c('13:45', '').erro), 'chegou depois do fim da aula: não é atraso, a aula não aconteceu');
    assert.ok(/antes de come/.test(c('', '12:10').erro), 'saiu antes de a aula começar: idem');
    assert.ok(/saída.*chegada|chegada.*saída/i.test(c('13:20', '13:00').erro), 'saída antes da chegada é erro de digitação');
    assert.ok(c('', '99:99').erro, 'horário inválido é recusado');
    assert.ok(c('', '14h05').erro, 'texto que não é hora é recusado, não lido como zero');
    passou('horários impossíveis viram mensagem, nunca um zero calado');
  }

  /* ── 2. O clique do Theo: saiu 14:05, envia ───────────────────────── */
  {
    const { sandbox, state, el } = novoSandbox();
    el('classProfSaiu').value = '14:05';
    el('classProfNota').value = 'aluno ficou depois';
    await sandbox.professorAvisaOcorrencia();
    assert.strictEqual(state.enviados.length, 1, 'o aviso foi enviado');
    assert.deepStrictEqual(state.enviados[0], { id: 'c1', dados: { atrasoMinutos: 0, saidaAntecipadaMinutos: 0, horaExtraMinutos: 35, nota: 'aluno ficou depois' } },
      'vai pro banco em MINUTOS, como sempre foi — a gestão e a folha não mudam');
    assert.ok(/35 min/.test(state.confirms[0]) && /14:05/.test(state.confirms[0]), 'a confirmação mostra a hora digitada e a conta feita: ' + state.confirms[0]);
    passou('informar a hora de saída envia os minutos calculados');
  }

  /* ── 3. Nada preenchido ou horário impossível: o erro aparece NA JANELA ── */
  {
    const { sandbox, state, el } = novoSandbox();
    await sandbox.professorAvisaOcorrencia();
    assert.strictEqual(state.enviados.length, 0);
    assert.ok(el('classProfErro').textContent.length > 10, 'a mensagem vai pra dentro da janela, onde a pessoa está olhando');
    passou('sem nada preenchido, o motivo aparece dentro da janela');

    el('classProfChegou').value = '13:45';
    await sandbox.professorAvisaOcorrencia();
    assert.strictEqual(state.enviados.length, 0, 'chegou depois do fim: não envia');
    assert.ok(/não aconteceu/i.test(el('classProfErro').textContent), 'e aponta o botão certo: ' + el('classProfErro').textContent);
    passou('horário impossível não é enviado e a janela diz o que fazer');

    el('classProfChegou').value = ''; el('classProfSaiu').value = '13:30';
    await sandbox.professorAvisaOcorrencia();
    assert.strictEqual(state.enviados.length, 0, 'saiu na hora certa: não há o que avisar');
    assert.ok(/iguais ao da aula/i.test(el('classProfErro').textContent), el('classProfErro').textContent);
    passou('horário igual ao da aula não gera aviso vazio');
  }

  /* ── 4. A prévia mostra a conta antes de enviar ───────────────────── */
  {
    const { sandbox, el } = novoSandbox();
    el('classProfSaiu').value = '14:05';
    sandbox.atualizarPreviaProfessor();
    assert.ok(/35 min/.test(el('classProfPrevia').textContent), 'a pessoa vê "35 min além" antes de clicar: ' + el('classProfPrevia').textContent);
    el('classProfSaiu').value = '';
    sandbox.atualizarPreviaProfessor();
    assert.strictEqual(el('classProfPrevia').textContent, '', 'sem horário, sem prévia');
    passou('a conta aparece na tela enquanto a pessoa preenche');
  }

  /* ── 5. A página: campos de hora, erro dentro da janela, aviso por cima ── */
  {
    const bloco = html.slice(html.indexOf('id="classProfBlock"'), html.indexOf('id="classModalReadOnlyHint"'));
    assert.ok(/<input type="time" id="classProfChegou"/.test(bloco) && /<input type="time" id="classProfSaiu"/.test(bloco),
      'os dois campos são de HORA (relógio do celular), não de número');
    assert.ok(!/type="number"/.test(bloco), 'nenhum campo de número sobrou no bloco do professor — era ele que engolia o "14:05"');
    assert.ok(/id="classProfErro"/.test(bloco) && /id="classProfPrevia"/.test(bloco), 'erro e prévia moram dentro do bloco');
    assert.ok(/onclick="professorAvisaOcorrencia\(\)"/.test(bloco), 'o botão continua chamando a mesma função');
    passou('a página tem os campos de hora, a prévia e o lugar do erro');

    const z = (seletor) => {
      const i = html.indexOf(seletor + ' {');
      assert.ok(i !== -1, 'regra CSS ' + seletor + ' existe');
      const m = html.slice(i, html.indexOf('}', i)).match(/z-index:\s*(\d+)/);
      assert.ok(m, seletor + ' tem z-index');
      return Number(m[1]);
    };
    assert.ok(z('.toast-container') > z('.modal'),
      `o aviso flutuante (${z('.toast-container')}) tem que ficar POR CIMA da janela (${z('.modal')}) — atrás dela, ninguém lê`);
    assert.ok(z('.toast-container') > z('.modal-overlay + .modal'), 'e por cima do outro tipo de janela também');
    passou('o aviso flutuante aparece por cima de qualquer janela aberta');
  }

  console.log(`\n${ok} verificações ✓`);
})().catch(e => { console.error('✗', e.stack || e.message); process.exit(1); });
