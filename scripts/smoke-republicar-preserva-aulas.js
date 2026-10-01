'use strict';
// Roda: node scripts/smoke-republicar-preserva-aulas.js
process.env.TZ = 'America/Sao_Paulo';
//
// Achado homologando no staging em 01/10/2026 — e já estava em produção.
//
// Trocar UMA pessoa (ou inverter duas vagas) numa escala publicada republicava a
// agenda. E republicar apagava e recriava TODAS as aulas da escala. No teste,
// inverter as duas vagas de Hiit do sábado 03/10:
//   · apagou os 35 min de tempo além que a gestão tinha aceitado do Marcos;
//   · apagou a falta sem aviso registrada na aula da Bruna (voltou a "prevista");
//   · desfez o status "substituída" da troca confirmada do Pedro;
//   · deixou uma troca pendente apontando pra uma aula que não existia mais.
// Tudo isso em vagas que ninguém tinha mexido.
//
// Era a "regra de operação" de 25/08 ("só reconsolide sábado que ainda não
// aconteceu") — uma regra que a gestão tinha que lembrar pra o sistema não
// estragar o que ela mesma tinha lançado. Agora republicar só mexe na aula da
// vaga que MUDOU: aula que já está certa fica onde está, com tudo o que tem.
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const SE = require('../scale-engine.js');
const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'gestora', SE });

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };
const vaga = (id, unitId, pid, extra) => Object.assign({ id, unitId, requiredModalityId: 'TOI', requiredModalityName: 'TOI', assignedPersonId: pid, startTime: '08:00', endTime: '12:00' }, extra || {});

async function cenario() {
  const d = deps(makeFakeDb());
  const esc = (await SS.createScale({ date: '2026-10-03', tipo: 'sabado', name: 'Sábado 03/10',
    slots: [vaga('cp', 'cp', 'marcos'), vaga('pp', 'pp', 'bruna'), vaga('cp2', 'cp', 'pedro')] }, d)).data;
  const pub = await SS.publishToAgenda(esc.id, d);
  assert.ok(pub.success, pub.error);
  return { d, id: esc.id, pub };
}
const aulas = async (d, id) => {
  const s = await d.db.collection('classes').where('specialScaleId', '==', id).get();
  const m = {};
  s.docs.forEach(x => { m[x.data().specialScaleSlotId] = Object.assign({ _id: x.id }, x.data()); });
  return m;
};

(async () => {
  /* ── 1. Trocar uma vaga não toca nas aulas das outras ──────────────── */
  {
    const { d, id, pub } = await cenario();
    assert.strictEqual(pub.data.created, 3, 'primeira publicação cria as 3 aulas');
    const antes = await aulas(d, id);
    // O que a gestão e os professores registraram nas aulas do dia:
    await d.db.collection('classes').doc(antes.cp._id).update({ horaExtraMinutos: 35, avisoProfessorAtendido: { decisao: 'aceitar' } });
    await d.db.collection('classes').doc(antes.pp._id).update({ status: 'nao_realizada', faltaTipo: 'sem_aviso' });

    // A gestão troca só a pessoa da terceira vaga.
    const r = await SS.reassignSlot(id, 'cp2', 'lucas', d);
    assert.ok(r.success && r.data.changed);
    const pub2 = await SS.publishToAgenda(id, d);
    assert.ok(pub2.success, pub2.error);

    const depois = await aulas(d, id);
    assert.strictEqual(depois.cp._id, antes.cp._id, 'a aula do Marcos é A MESMA (não foi apagada e recriada)');
    assert.strictEqual(depois.cp.horaExtraMinutos, 35, 'os 35 min aceitos continuam lá');
    assert.strictEqual(depois.pp._id, antes.pp._id, 'a aula da Bruna também');
    assert.strictEqual(depois.pp.faltaTipo, 'sem_aviso', 'a falta registrada continua');
    assert.strictEqual(depois.pp.status, 'nao_realizada', 'e não voltou a "prevista"');
    assert.notStrictEqual(depois.cp2._id, antes.cp2._id, 'só a aula da vaga trocada é refeita');
    assert.strictEqual(depois.cp2.teacherId, 'lucas', 'no nome de quem entrou');
    assert.strictEqual(depois.cp2.status, 'prevista');
    assert.strictEqual(Object.keys(depois).length, 3, 'e continuam sendo 3 aulas — nenhuma duplicada');
    assert.deepStrictEqual({ total: pub2.data.created, mantidas: pub2.data.mantidas }, { total: 3, mantidas: 2 }, 'o resultado diz quantas ficaram como estavam');
    passou('trocar uma vaga refaz só a aula dela; as outras ficam com tudo o que tinham');
  }

  /* ── 2. Republicar sem mudar nada não mexe em aula nenhuma ─────────── */
  {
    const { d, id } = await cenario();
    const antes = await aulas(d, id);
    await d.db.collection('classes').doc(antes.cp._id).update({ status: 'realizada', registroAutomatico: true });
    const pub2 = await SS.publishToAgenda(id, d);
    const depois = await aulas(d, id);
    assert.deepStrictEqual(Object.keys(depois).map(k => depois[k]._id).sort(), Object.keys(antes).map(k => antes[k]._id).sort(), 'as mesmas três aulas');
    assert.strictEqual(depois.cp.status, 'realizada', 'aula já realizada NÃO volta pra prevista — a regra de operação de 25/08 deixa de ser necessária');
    assert.strictEqual(pub2.data.mantidas, 3);
    passou('republicar sem mudança não toca em nada: aula realizada continua realizada');
  }

  /* ── 3. Troca confirmada entre professores não é desfeita ──────────── */
  {
    const { d, id } = await cenario();
    const antes = await aulas(d, id);
    // Escala antiga, de antes de a vaga acompanhar a troca: a vaga diz Marcos,
    // a aula está com o Vagner (substituída). É o caso de 26/09 em produção.
    await d.db.collection('classes').doc(antes.cp._id).update({ teacherId: 'vagner', status: 'substituida' });
    await SS.publishToAgenda(id, d);
    const depois = await aulas(d, id);
    assert.strictEqual(depois.cp._id, antes.cp._id, 'a aula substituída fica');
    assert.deepStrictEqual({ prof: depois.cp.teacherId, original: depois.cp.originalTeacherId, status: depois.cp.status },
      { prof: 'vagner', original: 'marcos', status: 'substituida' }, 'com quem deu a aula, e marcada como substituída');
    passou('republicar não desfaz uma troca de professor já confirmada');
  }

  /* ── 4. Mudou o horário, a unidade ou esvaziou a vaga: a aula acompanha ── */
  {
    const { d, id } = await cenario();
    const antes = await aulas(d, id);
    const sc = (await SS.getScale(id, d)).data;
    await d.db.collection('special_scales').doc(id).set({ slots: sc.slots.map(s =>
      s.id === 'cp' ? Object.assign({}, s, { startTime: '09:00' })
        : s.id === 'pp' ? Object.assign({}, s, { assignedPersonId: null })
          : s) }, { merge: true });
    const pub2 = await SS.publishToAgenda(id, d);
    const depois = await aulas(d, id);
    assert.notStrictEqual(depois.cp._id, antes.cp._id, 'horário mudou: a aula é refeita');
    assert.strictEqual(depois.cp.startTime, '09:00');
    assert.strictEqual(depois.pp, undefined, 'vaga esvaziada: a aula sai da agenda');
    assert.strictEqual(depois.cp2._id, antes.cp2._id, 'a que não mudou fica');
    assert.deepStrictEqual(pub2.data.vagasAbertas, ['pp'], 'e a vaga aberta continua sendo avisada');
    passou('horário alterado refaz a aula; vaga esvaziada tira a aula; o resto fica');
  }

  /* ── 5. O que vem da ESCALA é atualizado mesmo na aula que fica ────── */
  {
    const { d, id } = await cenario();
    const antes = await aulas(d, id);
    await d.db.collection('classes').doc(antes.cp._id).update({ horaExtraMinutos: 10 });
    assert.strictEqual(antes.cp.isHoliday, false);
    // O sábado passa a ser reconhecido como feriado (paga em dobro).
    await d.db.collection('special_scales').doc(id).set({ feriadoNaData: 'Feriado municipal' }, { merge: true });
    await SS.publishToAgenda(id, d);
    const depois = await aulas(d, id);
    assert.strictEqual(depois.cp._id, antes.cp._id, 'a aula é a mesma');
    assert.strictEqual(depois.cp.isHoliday, true, 'mas passou a pagar como feriado');
    assert.strictEqual(depois.cp.holidayName, 'Feriado municipal');
    assert.strictEqual(depois.cp.horaExtraMinutos, 10, 'sem perder o que foi lançado nela');
    passou('aula mantida recebe o que mudou na escala (feriado), sem perder o que tinha');
  }

  /* ── 6. Mês fechado continua intocável ─────────────────────────────── */
  {
    const { d, id } = await cenario();
    const antes = await aulas(d, id);
    await d.db.collection('classes').doc(antes.cp._id).update({ monthClosingId: '2026-10' });
    await SS.reassignSlot(id, 'cp', 'lucas', d);
    const pub2 = await SS.publishToAgenda(id, d);
    const depois = await aulas(d, id);
    assert.strictEqual(depois.cp._id, antes.cp._id, 'aula de mês fechado não é apagada');
    assert.strictEqual(depois.cp.teacherId, 'marcos', 'nem reescrita, mesmo com a vaga trocada');
    assert.strictEqual(Object.keys(depois).length, 3, 'e não nasce uma segunda aula pra mesma vaga');
    assert.strictEqual(pub2.data.jaCongelados, 1);
    passou('aula de mês fechado não é tocada nem duplicada');
  }

  /* ── 7. Despublicar continua tirando tudo ──────────────────────────── */
  {
    const { d, id } = await cenario();
    const r = await SS.unpublishFromAgenda(id, d);
    assert.ok(r.success && r.data.removed === 3, 'despublicar remove as 3 aulas');
    assert.strictEqual(Object.keys(await aulas(d, id)).length, 0);
    passou('despublicar segue removendo todas as aulas da escala');
  }

  console.log(`\n${ok} verificações ✓`);
})().catch(e => { console.error('✗', e.stack || e.message); process.exit(1); });
