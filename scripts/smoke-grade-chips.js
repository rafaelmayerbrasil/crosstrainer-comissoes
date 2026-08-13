'use strict';
// Testa o COMPORTAMENTO DA TELA da Grade de Horários sem navegador e sem login:
// carrega professores-agenda.js num sandbox com DOM falso e inspeciona o HTML
// que renderSlotWeekdayChips produz, além do texto de ajuda abaixo dos chips.
//
// Cobre o que antes só dava pra ver clicando: em edição os dias ficam clicáveis
// (até 13/08/2026 eram travados) e o aviso de troca de dia aparece.
//
// Uso: node scripts/smoke-grade-chips.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'professores-agenda.js'), 'utf8');

// ── DOM falso: só o suficiente pro arquivo carregar e pros chips renderizarem ──
const elementos = new Map();
function fakeEl(id) {
  if (!elementos.has(id)) elementos.set(id, { id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, classList: { add() {}, remove() {} } });
  return elementos.get(id);
}
const sandbox = {
  console,
  document: {
    getElementById: id => fakeEl(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => fakeEl('tmp'),
    addEventListener() {},
  },
  window: {},
  setTimeout, clearTimeout, setInterval, clearInterval,
  toast() {}, escapeHtml: s => String(s),
  firebase: { firestore: () => ({}) },
  db: {},
  ProfHelpers: {
    WEEKDAY_LABEL: ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'],
    WEEKDAY_LABEL_SHORT: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
    minutesBetween: () => 60, timeToMinutes: () => 0, detectSlotConflict: () => [],
  },
  isAdminGestao: () => true, isSupervisao: () => false,
  UnitService: {}, ModalityService: {}, TeacherService: {},
  ScheduleSlotService: {}, ClassService: {}, ScheduleTemplateService: {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'professores-agenda.js' });

// `const` no topo do arquivo fica no escopo léxico do contexto, não vira
// propriedade do sandbox — por isso o acesso é via runInContext.
const run = code => vm.runInContext(code, sandbox);

const chips = () => fakeEl('slotWeekdayChips').innerHTML;
const hint  = () => fakeEl('slotWeekdayHint').textContent;

let checks = 0, fails = 0;
const expect = (desc, got, want) => {
  const ok = got === want; checks++; if (!ok) fails++;
  console.log(`${ok ? '✓' : '✗'} ${desc}${ok ? '' : ` — esperado ${want}, veio ${got}`}`);
};

// ════════ CRIAÇÃO: multi-seleção continua funcionando ════════
run('SlotFormState.editingId = null; SlotFormState.weekdays = [1,3]; SlotFormState.originalWeekday = null; renderSlotWeekdayChips();');
expect('criação: 7 dias clicáveis', (chips().match(/onclick="setSlotWeekday\(/g) || []).length, 7);
expect('criação: 2 dias marcados', (chips().match(/selected/g) || []).length, 2);
expect('criação: avisa que cria em lote', /Serão criados 2 slots/.test(hint()), true);

// ════════ EDIÇÃO: dias clicáveis (a regressão que queremos travar) ════════
run("SlotFormState.editingId = 'slot-x'; SlotFormState.weekdays = [2]; SlotFormState.originalWeekday = 2; renderSlotWeekdayChips();");
expect('edição: os 7 dias são clicáveis', (chips().match(/onclick="setSlotWeekday\(/g) || []).length, 7);
expect('edição: nenhum dia travado', /chip-disabled/.test(chips()), false);
expect('edição: sumiu o aviso de "dia fixo"', /dia da semana fixo/.test(hint()), false);
expect('edição: mostra o dia atual', /Dia atual: TERÇA/.test(hint()), true);

// ════════ EDIÇÃO: clicar em outro dia troca (seleção única) ════════
run('setSlotWeekday(4);');
expect('clicar em outro dia troca, não acumula', run('JSON.stringify(SlotFormState.weekdays)'), '[4]');
expect('só 1 dia marcado', (chips().match(/selected/g) || []).length, 1);
expect('avisa a troca de TERÇA para QUINTA', /de TERÇA para QUINTA/.test(hint()), true);
expect('avisa que as aulas acompanham', /aulas futuras acompanham/.test(hint()), true);
expect('avisa que confirma antes', /confirma antes/.test(hint()), true);

// ════════ voltar pro dia original limpa o aviso ════════
run('setSlotWeekday(2);');
expect('voltar ao dia original volta ao texto neutro', /Dia atual: TERÇA/.test(hint()), true);
expect('e não fala mais em troca', /Vai mudar de/.test(hint()), false);

console.log(`\n${checks - fails}/${checks} verificações passaram`);
process.exit(fails ? 1 : 0);
