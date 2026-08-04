'use strict';
// Smoke da edição de Escola Interna (04/08): updateScale preserva quem lidera,
// aplica o horário em todas as unidades, ajusta a data no nome e deleteScale apaga.
// Usa o ScaleService REAL com um Firestore de mentira injetado via deps.
//
// Roda: node scripts/smoke-escola-interna-editar.js

const assert = require('assert');
const ScaleService = require('../scale-service.js');

// ── Firestore de mentira: só o que updateScale/deleteScale tocam ──
function fakeDb(docs) {
  const store = new Map(Object.entries(docs));
  return {
    _store: store,
    collection(nome) {
      assert.strictEqual(nome, 'special_scales', 'só mexe em special_scales');
      return {
        doc(id) {
          return {
            get: async () => ({ exists: store.has(id), data: () => JSON.parse(JSON.stringify(store.get(id))) }),
            update: async (patch) => {
              if (!store.has(id)) throw new Error('doc inexistente');
              store.set(id, Object.assign({}, store.get(id), patch));
            },
            delete: async () => { store.delete(id); },
          };
        },
      };
    },
  };
}

const baseScale = () => ({
  date: '2026-08-10',
  name: 'Escola Interna 10/08/2026',
  tipo: 'escola_interna',
  status: 'rascunho',
  published: true,
  slots: [
    { id: 'cp_LIDER', unitId: 'cp', role: 'lider', assignedPersonId: null,      startTime: '14:30', endTime: '15:30' },
    { id: 'pp_LIDER', unitId: 'pp', role: 'lider', assignedPersonId: 'prof-99', startTime: '14:30', endTime: '15:30' },
  ],
});

const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'admin-1' });

(async () => {
  // ── 1. muda só o horário ──
  {
    const db = fakeDb({ s1: baseScale() });
    const res = await ScaleService.updateScale('s1', { startTime: '15:00', endTime: '16:00' }, deps(db));
    assert.ok(res.success, 'updateScale deveria dar certo');
    const s = db._store.get('s1');
    assert.deepStrictEqual(s.slots.map(x => [x.startTime, x.endTime]),
      [['15:00', '16:00'], ['15:00', '16:00']], 'horário vale para TODAS as unidades');
    console.log('✓ novo horário aplicado nas duas unidades');

    assert.strictEqual(s.slots[1].assignedPersonId, 'prof-99',
      'mudar horário não pode desescalar quem já lidera');
    assert.strictEqual(s.slots[0].assignedPersonId, null);
    console.log('✓ quem já liderava continua escalado');

    assert.strictEqual(s.date, '2026-08-10', 'sem data no patch, a data não muda');
    console.log('✓ data intacta quando só o horário muda');
  }

  // ── 2. muda a data e o nome acompanha ──
  {
    const db = fakeDb({ s1: baseScale() });
    await ScaleService.updateScale('s1', { date: '2026-08-12' }, deps(db));
    const s = db._store.get('s1');
    assert.strictEqual(s.date, '2026-08-12');
    assert.strictEqual(s.name, 'Escola Interna 12/08/2026', 'o nome mostra a data — precisa acompanhar');
    console.log('✓ data alterada e nome sincronizado');

    assert.deepStrictEqual(s.slots.map(x => x.startTime), ['14:30', '14:30'],
      'sem horário no patch, os horários ficam como estavam');
    console.log('✓ horário intacto quando só a data muda');
  }

  // ── 3. nome sem data no texto não é corrompido ──
  {
    const db = fakeDb({ s1: Object.assign(baseScale(), { name: 'Treino técnico especial' }) });
    await ScaleService.updateScale('s1', { date: '2026-09-01' }, deps(db));
    assert.strictEqual(db._store.get('s1').name, 'Treino técnico especial');
    console.log('✓ nome sem data no texto fica intacto');
  }

  // ── 4. escala inexistente ──
  {
    const db = fakeDb({});
    const res = await ScaleService.updateScale('nao-existe', { date: '2026-08-20' }, deps(db));
    assert.strictEqual(res.success, false);
    assert.match(res.error, /não encontrada/i);
    console.log('✓ recusa editar escala inexistente');
  }

  // ── 5. exclusão ──
  {
    const db = fakeDb({ s1: baseScale(), s2: baseScale() });
    const res = await ScaleService.deleteScale('s1', deps(db));
    assert.ok(res.success);
    assert.strictEqual(db._store.has('s1'), false, 's1 tem que sumir');
    assert.strictEqual(db._store.has('s2'), true, 'não pode levar as outras junto');
    console.log('✓ exclui só a sessão pedida');
  }

  // ── 6. auditoria de quem mexeu ──
  {
    const db = fakeDb({ s1: baseScale() });
    await ScaleService.updateScale('s1', { startTime: '16:00' }, deps(db));
    const s = db._store.get('s1');
    assert.strictEqual(s.updatedBy, 'admin-1');
    assert.strictEqual(s.updatedAt, 'TS');
    console.log('✓ grava quem alterou e quando');
  }

  console.log('\n✅ smoke-escola-interna-editar OK');
})().catch(e => { console.error('✗ ' + e.message); process.exit(1); });
