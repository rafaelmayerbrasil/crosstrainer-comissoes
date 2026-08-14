'use strict';
// Roda: node scripts/smoke-escala-confirma-publica.js
//
// Dois relatos reais do grupo da gestão em 14/08/2026, mesma raiz: a tela
// contava uma história diferente do que o sistema tinha feito.
//
//  (1) Professora: "qnd vou em 'minha agenda' não tem sábado. qnd vou em
//      'escala' aparece sábado (15/08) - não escalado". A escala estava em
//      RASCUNHO — janela nunca aberta, ninguém escalado, nenhuma aula criada.
//      Mas a tela do professor dizia "Rascunho · Não escalado", que ele lê como
//      "não fui escolhido" em vez de "ainda nem começou".
//
//  (2) O lote "✅ Confirmar escala e avisar todos" fechava a eleição e
//      consolidava, mas NÃO publicava. As aulas só nasciam se alguém abrisse
//      cada sábado e clicasse "📅 Publicar na agenda". E mesmo assim o aviso já
//      tinha ido pro time dizendo "Confira sua agenda" — apontando pra tela
//      vazia. Com 2 meses de sábados de uma vez, esquecer era garantido.
//
// A parte 1 do teste é COMPORTAMENTAL (roda o serviço de verdade contra o
// firestore falso). A parte 2 é ESTRUTURAL: guarda a ligação na tela, que é
// justamente o que faltava — não reimplementa a lógica.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const SE = require('../scale-engine.js');

const raiz = path.join(__dirname, '..');
const deps = (db) => ({ db, ts: () => 'TS', uid: () => 'tester', SE });

const teachers = [
  { id: 'p1', name: 'Ana',   modalityIds: ['TOI'], primaryUnitId: 'u1' },
  { id: 'p2', name: 'Bruno', modalityIds: ['TOI'], primaryUnitId: 'u1' },
];
const ctx = { teachers, meritoById: { p1: 100, p2: 0 }, opts: { minMes: 1 } };

(async () => {
  // ════════ 1. consolidar SEM publicar deixa a agenda vazia ════════
  // É exatamente o estado em que a professora ficou: escala resolvida, agenda
  // vazia. Se algum dia isso deixar de ser verdade, o teste avisa.
  {
    const db = makeFakeDb(); const d = deps(db);
    const sab = (await SS.createScale({
      date: '2026-08-15', tipo: 'sabado', name: 'Sábado 15/08',
      slots: [{ id: 's1', unitId: 'u1', requiredModalityId: 'TOI', assignedPersonId: null,
                startTime: '08:00', endTime: '12:00' }],
    }, d)).data;

    await SS.consolidate(sab.id, ctx, d);
    const depois = await SS.getScale(sab.id, d);
    assert.strictEqual(depois.data.status, 'consolidada', 'consolidou');
    assert.ok(depois.data.slots[0].assignedPersonId, 'alguém foi escalado');

    const aulas = await db.collection('classes').where('specialScaleId', '==', sab.id).get();
    assert.strictEqual(aulas.docs.length, 0,
      'consolidar sozinho NÃO cria aula — por isso o confirmar precisa publicar');
    console.log('✓ consolidar sozinho deixa a agenda vazia (o bug relatado)');

    // ════════ 2. publicar é o passo que faz a aula existir ════════
    const pub = await SS.publishToAgenda(sab.id, d);
    assert.ok(pub.success, 'publicou');
    assert.strictEqual(pub.data.created, 1, 'criou a aula do sábado');
    const aulas2 = await db.collection('classes').where('specialScaleId', '==', sab.id).get();
    assert.strictEqual(aulas2.docs.length, 1, 'agora a aula existe na agenda');
    assert.strictEqual(aulas2.docs[0].data().specialScaleType, 'sabado', 'nasce marcada como sábado');
    console.log('✓ publicar cria a aula e ela chega na agenda');

    // ════════ 3. publicar 2× no lote não duplica ════════
    // O confirmar passou a publicar sempre; se a gestão reconfirmar o lote, não
    // pode nascer aula repetida (a folha de pagamento conta por aula).
    const pub2 = await SS.publishToAgenda(sab.id, d);
    assert.ok(pub2.success, 'republicou');
    const aulas3 = await db.collection('classes').where('specialScaleId', '==', sab.id).get();
    assert.strictEqual(aulas3.docs.length, 1, 'reconfirmar o lote NÃO duplica a aula');
    console.log('✓ reconfirmar o lote não duplica aula');
  }

  // ════════ 4. o confirmar do lote TEM que publicar ════════
  // Guarda a ligação na tela: é o passo que faltava.
  {
    const src = fs.readFileSync(path.join(raiz, 'professores-escala-smart.js'), 'utf8');
    const m = src.match(/async function confirmarEAvisar[\s\S]*?\n}\n/);
    assert.ok(m, 'confirmarEAvisar precisa existir');
    const corpo = m[0];

    assert.ok(/publishToAgenda/.test(corpo),
      'confirmarEAvisar TEM que publicar na agenda — sem isso o aviso "Confira sua '
      + 'agenda" manda o professor pra uma tela vazia');
    assert.ok(/consolidate/.test(corpo), 'e seguir consolidando antes de publicar');
    console.log('✓ "Confirmar e avisar" publica na agenda');

    // O aviso não pode sair pra data que falhou — seria repetir o bug.
    assert.ok(/falhas/.test(corpo),
      'confirmarEAvisar precisa rastrear falhas por data em vez de assumir sucesso');
    console.log('✓ falha por data é rastreada, não engolida');
  }

  // ════════ 5. o professor não pode ler "Não escalado" antes da eleição ════════
  {
    const src = fs.readFileSync(path.join(raiz, 'professores-escala-smart.js'), 'utf8');
    const m = src.match(/async function renderProfSabadosFeriados[\s\S]*?\n}\n/);
    assert.ok(m, 'renderProfSabadosFeriados precisa existir');
    const corpo = m[0];

    assert.ok(/status !== 'consolidada'/.test(corpo),
      'a tela do professor precisa separar "ainda não abriram" de "não fui escolhido"');
    assert.ok(!/ESCALA_STATUS_LABEL/.test(corpo),
      '"Rascunho"/"Consolidada" é vocabulário interno — não mostrar pro professor');
    console.log('✓ antes da eleição a tela diz que ainda não abriu, não "não escalado"');
  }

  console.log('\n✅ smoke-escala-confirma-publica OK');
})().catch(e => { console.error('\n❌', e.message); process.exit(1); });
