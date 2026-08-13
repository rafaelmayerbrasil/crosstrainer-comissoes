'use strict';
// Testa, sem navegador e sem login, os dois consertos do modal de aula
// relatados pelo Rafael em 13/08/2026:
//
//   1. a prévia "quanto a aula vale" não achava a aula quando o modal era
//      aberto pela Agenda Geral → sobrava uma caixa cinza VAZIA com borda,
//      que parecia campo quebrado;
//   2. ao marcar falta, os campos de atraso/saída/hora extra travavam sem
//      explicação nenhuma — pareciam defeito.
//
// Uso: node scripts/smoke-aula-ocorrencias-ui.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'professores-agenda.js'), 'utf8');

const elementos = new Map();
function fakeEl(id) {
  if (!elementos.has(id)) {
    elementos.set(id, {
      id, innerHTML: '', textContent: '', value: '', disabled: false,
      style: {}, dataset: {}, classList: { add() {}, remove() {} },
    });
  }
  return elementos.get(id);
}
const sandbox = {
  console,
  document: {
    getElementById: id => fakeEl(id),
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => fakeEl('tmp'), addEventListener() {},
  },
  window: {}, setTimeout, clearTimeout, setInterval, clearInterval,
  toast() {}, escapeHtml: s => String(s),
  firebase: { firestore: () => ({}) }, db: {},
  ProfHelpers: {
    WEEKDAY_LABEL: ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'],
    WEEKDAY_LABEL_SHORT: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
    minutesBetween: () => 60, timeToMinutes: () => 0, detectSlotConflict: () => [],
    // 60 min cheios, menos atraso e saída antecipada, mais hora extra
    classEffectiveMinutes: c => (c.faltaTipo ? 0
      : (c.durationMinutes || 0) - (c.atrasoMinutos || 0) - (c.saidaAntecipadaMinutos || 0) + (c.horaExtraMinutos || 0)),
    classCountsForPay: c => c.countsForPay !== false,
  },
  isAdminGestao: () => true, isSupervisao: () => false,
  UnitService: {}, ModalityService: {}, TeacherService: {},
  ScheduleSlotService: {}, ClassService: {}, ScheduleTemplateService: {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'professores-agenda.js' });
const run = code => vm.runInContext(code, sandbox);

const previa = () => fakeEl('classHorasPreview');
const hintFalta = () => fakeEl('classFaltaHint');
const campo = id => fakeEl(id);

let checks = 0, fails = 0;
const expect = (desc, got, want) => {
  const ok = got === want; checks++; if (!ok) fails++;
  console.log(`${ok ? '✓' : '✗'} ${desc}${ok ? '' : ` — esperado ${JSON.stringify(want)}, veio ${JSON.stringify(got)}`}`);
};

// ════════ 1. Prévia de horas aberta pela AGENDA GERAL ════════
// A aula existe SÓ em AgendaGeralState — era exatamente o caso que falhava.
run(`
  MinhaAgendaState.classes = [];
  MinhaAgendaState.selectedClassId = 'aula-1';
  AgendaGeralState.classes = [{ id: 'aula-1', durationMinutes: 60 }];
  document.getElementById('classFaltaTipo').value = '';
  document.getElementById('classAtraso').value = '';
  document.getElementById('classSaidaAntecipada').value = '';
  document.getElementById('classHoraExtra').value = '';
  atualizarPreviewHoras();
`);
expect('prévia aparece quando aberta pela Agenda Geral', previa().style.display, '');
expect('prévia diz a duração cheia', /Vale <strong>60 min<\/strong>/.test(previa().innerHTML), true);

// com atraso, o valor muda
run(`document.getElementById('classAtraso').value = '15'; atualizarPreviewHoras();`);
expect('prévia recalcula com atraso', /Vale <strong>45 min<\/strong> em vez de 60/.test(previa().innerHTML), true);

// ════════ 2. Sem aula selecionada, a caixa SOME (não fica cinza vazia) ════════
run(`
  MinhaAgendaState.classes = []; AgendaGeralState.classes = [];
  MinhaAgendaState.selectedClassId = 'nao-existe';
  atualizarPreviewHoras();
`);
expect('sem aula: caixa escondida', previa().style.display, 'none');
expect('sem aula: caixa vazia de verdade', previa().innerHTML, '');

// ════════ 3. Falta trava os campos E explica o porquê ════════
run(`
  MinhaAgendaState.classes = [];
  MinhaAgendaState.selectedClassId = 'aula-1';
  AgendaGeralState.classes = [{ id: 'aula-1', durationMinutes: 60 }];
  document.getElementById('classFaltaTipo').value = 'sem_aviso';
  onClassFaltaChange();
`);
expect('falta trava o atraso', campo('classAtraso').disabled, true);
expect('falta trava a saída antecipada', campo('classSaidaAntecipada').disabled, true);
expect('falta trava a hora extra', campo('classHoraExtra').disabled, true);
expect('e agora EXPLICA por que travou', hintFalta().style.display, '');
expect('a explicação diz como liberar', /mude Falta para "Não faltou"/.test(hintFalta().textContent), true);

// ════════ 4. Voltar para "Não faltou" libera e some a explicação ════════
run(`
  document.getElementById('classFaltaTipo').value = '';
  onClassFaltaChange();
`);
expect('sem falta: atraso liberado', campo('classAtraso').disabled, false);
expect('sem falta: hora extra liberada', campo('classHoraExtra').disabled, false);
expect('sem falta: explicação some', hintFalta().style.display, 'none');
expect('sem falta: prévia volta a aparecer', previa().style.display, '');

console.log(`\n${checks - fails}/${checks} verificações passaram`);
process.exit(fails ? 1 : 0);
