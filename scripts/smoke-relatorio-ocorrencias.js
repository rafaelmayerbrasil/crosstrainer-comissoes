'use strict';
// Smoke do relatório de ocorrências (R5, bloco 2).
// Carrega professores-shared.js REAL num sandbox — não reimplementa a regra.
//
// Este relatório é a base pra conferir com o relógio de ponto quando ele entrar,
// e é o contrapeso do registro automático: mostra quanta aula foi confirmada
// sozinha e quanta passou por gente.
//
// Roda: node scripts/smoke-relatorio-ocorrencias.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const noop = () => {};
const chain = () => new Proxy(function () {}, { get: () => chain(), apply: () => chain() });
const sandbox = {
  console: { log: noop, warn: noop, error: noop },
  window: {}, document: { addEventListener: noop, getElementById: () => null },
  firebase: { firestore: Object.assign(chain(), { FieldValue: { serverTimestamp: noop }, Timestamp: { now: noop } }), auth: chain, apps: [] },
  db: chain(), auth: chain(),
  setTimeout, clearTimeout, Map, Set, Date, Math, JSON, String, Number, Array, Object, Boolean, RegExp, Promise, Error,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'substitution-flow.js'), 'utf8'), sandbox, { filename: 'substitution-flow.js' });
// SubstitutionFlow entra pendurado em window (estilo UMD/browser); professores-shared.js
// lê o identificador solto — precisa estar no escopo do contexto antes de carregar.
sandbox.SubstitutionFlow = sandbox.window.SubstitutionFlow;
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'professores-shared.js'), 'utf8'), sandbox, { filename: 'professores-shared.js' });

const agrupar = vm.runInContext('buildOcorrenciasGroups', sandbox);

const professores = {
  t1: { id: 't1', name: 'Eduarda', type: 'estagiario' },
  t2: { id: 't2', name: 'Theo', type: 'efetivo' },
};
// O relatório lê scheduledDate como Timestamp do Firestore
const dia = (d) => ({ toDate: () => new Date(2026, 7, d, 19, 0, 0) });
const aula = (o) => Object.assign({
  teacherId: 't1', durationMinutes: 60, status: 'realizada', scheduledDate: dia(3), startTime: '19:00',
}, o);

// ════════════ automático x conferido ════════════
// A pergunta que a gestão vai fazer: "quanto disso ninguém olhou?"
{
  const g = agrupar([
    aula({ registroAutomatico: true }),
    aula({ registroAutomatico: true }),
    aula({ registroAutomatico: false }),
  ], professores).t1;

  assert.strictEqual(g.aulas, 3);
  assert.strictEqual(g.automaticas, 2, 'duas confirmadas sozinhas');
  assert.strictEqual(g.conferidas, 1, 'uma passou por gente');
  assert.strictEqual(g.details.length, 0, 'aula sem ocorrência não vira linha de detalhe');
  console.log('✓ separa o que foi confirmado sozinho do que alguém conferiu');
}

// ════════════ falta tira a aula do pagamento ════════════
{
  const g = agrupar([
    aula({ faltaTipo: 'sem_aviso', status: 'nao_realizada' }),
    aula({ faltaTipo: 'justificada', status: 'nao_realizada' }),
    aula({}),
  ], professores).t1;

  assert.strictEqual(g.faltasSemAviso, 1);
  assert.strictEqual(g.faltasAvisadas, 1);
  assert.strictEqual(g.minutosEfetivos, 60, 'só a aula dada é paga');
  assert.strictEqual(g.minutosPrevistos, 180, 'as três estavam previstas');
  assert.strictEqual(g.details.length, 2, 'as duas faltas aparecem no detalhe');
  console.log('✓ falta zera o pagamento da aula e aparece no detalhamento');
}

// ════════════ atraso, saída antecipada e hora extra ════════════
{
  const g = agrupar([
    aula({ atrasoMinutos: 15 }),
    aula({ saidaAntecipadaMinutos: 10 }),
    aula({ horaExtraMinutos: 20 }),
  ], professores).t1;

  assert.strictEqual(g.atrasos, 1);
  assert.strictEqual(g.atrasoMin, 15);
  assert.strictEqual(g.saidaMin, 10);
  assert.strictEqual(g.extraMin, 20);
  assert.strictEqual(g.minutosEfetivos, 45 + 50 + 80, 'desconta atraso e saída, soma a extra');
  console.log('✓ soma minutos de atraso, saída antecipada e hora extra');
}

// ════════════ Escola Interna não entra na conta de horas ════════════
// Ela vira aula normal em `classes`; sem esse corte, entraria na folha.
{
  const g = agrupar([
    aula({ specialScaleType: 'escola_interna' }),
    aula({}),
  ], professores).t1;

  assert.strictEqual(g.aulas, 2, 'aparece na contagem de aulas');
  assert.strictEqual(g.minutosPrevistos, 60, 'mas não na conta de horas');
  assert.strictEqual(g.minutosEfetivos, 60);
  console.log('✓ Escola Interna conta como aula, não como hora paga');
}

// ════════════ aviso do professor ════════════
// Sinalizador, não muda pagamento — mas a gestão precisa VER.
{
  const g = agrupar([
    aula({ avisoProfessor: { tipo: 'nao_aconteceu', nota: 'ninguém apareceu' } }),
  ], professores).t1;

  assert.strictEqual(g.avisosProfessor, 1);
  assert.strictEqual(g.minutosEfetivos, 60, 'o aviso sozinho não tira o pagamento');
  assert.strictEqual(g.details.length, 1, 'mas fica visível no detalhamento');
  console.log('✓ aviso do professor aparece sem mexer no pagamento');
}

// ════════════ separa por professor ════════════
{
  const g = agrupar([
    aula({ teacherId: 't1', faltaTipo: 'sem_aviso' }),
    aula({ teacherId: 't2' }),
    aula({ teacherId: 't2', atrasoMinutos: 5 }),
  ], professores);

  assert.strictEqual(g.t1.faltasSemAviso, 1);
  assert.strictEqual(g.t1.teacherName, 'Eduarda');
  assert.strictEqual(g.t2.faltasSemAviso, 0);
  assert.strictEqual(g.t2.atrasoMin, 5);
  assert.strictEqual(g.t2.teacherType, 'efetivo');
  console.log('✓ agrupa por professor e resolve nome e tipo');
}

// ════════════ professor sem cadastro não quebra ════════════
{
  const g = agrupar([aula({ teacherId: 'fantasma' })], professores).fantasma;
  assert.strictEqual(g.teacherName, 'Desconhecido');
  console.log('✓ aula de professor sem cadastro não quebra o relatório');
}

console.log('\n✅ smoke-relatorio-ocorrencias OK');
