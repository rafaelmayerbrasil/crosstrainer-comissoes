'use strict';
// Smoke do bloco 3 (histórico de substituição): a aula substituída tem que
// continuar aparecendo pros DOIS lados.
//
// O problema: ao aceitar, a CF troca `classes.teacherId` pelo substituto. Como a
// agenda busca "aulas onde eu sou o professor", a aula SOME da lista do titular
// — daí o "sumiu, não sei se deu certo" que os professores reclamam.
// `originalTeacherId` é preservado, então dá pra resolver na exibição.
//
// Carrega professores-shared.js REAL num sandbox — não reimplementa a regra.
// Roda: node scripts/smoke-substituicao-visivel.js

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
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'professores-shared.js'), 'utf8'), sandbox, { filename: 'professores-shared.js' });

const papel = vm.runInContext('classSubstitutionRole', sandbox);

const TITULAR = 'theo', SUBSTITUTO = 'thaynara', ESTRANHO = 'outro';

// ════════════ aula sem substituição ════════════
{
  assert.strictEqual(papel({ teacherId: TITULAR, originalTeacherId: TITULAR }, TITULAR), null);
  console.log('✓ aula normal não ganha etiqueta de substituição');
}

// ════════════ o titular: a aula NÃO some mais ════════════
{
  const cls = { teacherId: SUBSTITUTO, originalTeacherId: TITULAR, status: 'substituida' };
  const r = papel(cls, TITULAR);
  assert.strictEqual(r.role, 'substituida', 'pro titular, a aula está substituída');
  assert.strictEqual(r.outroId, SUBSTITUTO, 'e ele precisa saber POR QUEM');
  console.log('✓ titular continua vendo a aula, com quem ficou no lugar dele');
}

// ════════════ o substituto: está cobrindo ════════════
{
  const cls = { teacherId: SUBSTITUTO, originalTeacherId: TITULAR, status: 'substituida' };
  const r = papel(cls, SUBSTITUTO);
  assert.strictEqual(r.role, 'cobrindo');
  assert.strictEqual(r.outroId, TITULAR, 'de quem ele está cobrindo');
  console.log('✓ substituto vê que está cobrindo, e de quem');
}

// ════════════ aula de terceiros ════════════
{
  const cls = { teacherId: SUBSTITUTO, originalTeacherId: TITULAR, status: 'substituida' };
  assert.strictEqual(papel(cls, ESTRANHO), null, 'quem não é parte não recebe etiqueta');
  console.log('✓ aula entre outros dois não vira etiqueta pra um terceiro');
}

// ════════════ dado legado e entrada torta ════════════
// Aulas antigas podem não ter originalTeacherId — não podem quebrar a agenda.
{
  assert.strictEqual(papel({ teacherId: SUBSTITUTO }, SUBSTITUTO), null, 'sem originalTeacherId não dá pra afirmar nada');
  assert.strictEqual(papel({ originalTeacherId: TITULAR }, TITULAR), null);
  assert.strictEqual(papel(null, TITULAR), null);
  assert.strictEqual(papel({ teacherId: SUBSTITUTO, originalTeacherId: TITULAR }, null), null);
  console.log('✓ aula legada, nula ou sem professor não quebra');
}

// ════════════ a lista da agenda: junta as duas consultas ════════════
// A agenda passa a fazer 2 consultas (sou o professor · sou o titular original).
// Uma aula que eu cobri APARECE nas duas quando eu sou os dois — não pode duplicar.
{
  const mesclar = vm.runInContext('mergeClassesById', sandbox);
  const a = { id: 'c1', teacherId: TITULAR, scheduledDate: { toDate: () => new Date(2026, 7, 10) } };
  const b = { id: 'c2', teacherId: SUBSTITUTO, originalTeacherId: TITULAR, scheduledDate: { toDate: () => new Date(2026, 7, 8) } };

  const juntas = mesclar([a, b], [b]);
  assert.strictEqual(juntas.length, 2, 'a aula repetida entra uma vez só');
  assert.deepStrictEqual(juntas.map(c => c.id), ['c2', 'c1'], 'e sai ordenado por data');
  console.log('✓ as duas consultas viram uma lista só, sem repetir e em ordem');
}

console.log('\n✅ smoke-substituicao-visivel OK');
