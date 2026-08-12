'use strict';
// Roda: node scripts/smoke-excluir-evento.js
//
// Gestão criou 2 eventos pro mesmo sábado e ficou presa: não havia como excluir
// (Rodrigo, 12/08/2026). Agora dá — mas SÓ evento. Sábado/feriado continuam
// intocáveis: a consolidação já mexeu no contador de justiça, e apagar
// corromperia a rotação de quem trabalha.
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'tester' });

(async () => {
  const d = deps(makeFakeDb());

  /* ── 1. Evento com staff: some ele e os RSVPs ────────────────────── */
  const ev = (await SS.createScale({ date: '2026-08-15', tipo: 'evento', name: 'Curso duplicado', slots: [] }, d)).data;
  await SS.setEventStaff(ev.id, ['p1', 'p2'], ['p3'], d);
  assert.strictEqual((await SS.listEventRsvp(ev.id, d)).data.length, 3, 'staff gravado');

  const res = await SS.deleteEvent(ev.id, d);
  assert.ok(res.success, 'exclusão respondeu ok');
  assert.strictEqual(res.data.rsvpsRemovidos, 3, 'diz quantos convites foram junto');
  assert.strictEqual((await SS.listEventRsvp(ev.id, d)).data.length, 0, 'nenhum RSVP órfão sobrou');
  assert.ok(!(await SS.getScale(ev.id, d)).success, 'o evento sumiu');
  console.log('✓ evento excluído junto com os convites — sem RSVP órfão');

  /* ── 2. Sábado NÃO pode ser excluído ─────────────────────────────── */
  const sab = (await SS.createScale({
    date: '2026-08-22', tipo: 'sabado', name: 'Sábado 22/08',
    slots: [{ id: 's1', unitId: 'u1', requiredModalityId: 'TOI', assignedPersonId: null }],
  }, d)).data;
  const negado = await SS.deleteEvent(sab.id, d);
  assert.ok(!negado.success, 'sábado é recusado');
  assert.ok(/só evento/i.test(negado.error), `a mensagem explica o porquê: "${negado.error}"`);
  assert.ok((await SS.getScale(sab.id, d)).success, 'o sábado continua lá');
  console.log('✓ sábado/feriado seguem protegidos (o fairness já foi aplicado neles)');

  /* ── 3. Evento sem staff nenhum ──────────────────────────────────── */
  const vazio = (await SS.createScale({ date: '2026-08-15', tipo: 'evento', name: 'Sem ninguém', slots: [] }, d)).data;
  const r3 = await SS.deleteEvent(vazio.id, d);
  assert.ok(r3.success && r3.data.rsvpsRemovidos === 0, 'evento sem convidados sai limpo');
  console.log('✓ evento sem convidados também sai');

  /* ── 4. Evento inexistente não explode ───────────────────────────── */
  const r4 = await SS.deleteEvent('nao_existe', d);
  assert.ok(!r4.success, 'id inexistente devolve erro em vez de estourar');
  console.log('✓ id inexistente tratado');

  console.log('\n✓ smoke-excluir-evento: todos os casos passaram');
})().catch(e => { console.error('✗ FALHOU:', e.message); process.exit(1); });
