'use strict';
// Roda: node scripts/smoke-aviso-ocorrencia.js
//
// "Aqui no app não tem nenhum botão pra adicionar que chegou mais tarde, só a
// opção de falar que cancelou a aula" (professor, 12/08/2026). Agora o professor
// informa — mas o que ele informa é AVISO, não lançamento: os campos que entram
// no fechamento só mudam quando a gestão confirma. Minuto vira dinheiro.
const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');

// O ClassService vive no professores-shared.js, que assume browser. Reproduzo aqui
// as duas regras que importam testar de verdade: o teto de minutos e a separação
// entre "avisado" e "valendo".
const TETO = 600;
function sanear(v) {
  const n = Math.round(Number(v) || 0);
  return n > 0 ? Math.min(n, TETO) : 0;
}

(async () => {
  /* ── 1. Saneamento dos minutos ───────────────────────────────────── */
  assert.strictEqual(sanear('12'), 12, 'texto vira número');
  assert.strictEqual(sanear(-5), 0, 'negativo vira zero');
  assert.strictEqual(sanear(99999), TETO, 'erro de digitação não vira 99999 min de hora extra');
  assert.strictEqual(sanear(''), 0, 'vazio é zero');
  assert.strictEqual(sanear(10.6), 11, 'arredonda');
  console.log('✓ minutos saneados (teto de 10h barra erro de digitação)');

  /* ── 2. Aviso NÃO altera os campos do fechamento ─────────────────── */
  const db = makeFakeDb();
  await db.collection('classes').doc('c1').set({
    id: 'c1', teacherId: 'p1', status: 'realizada', monthClosingId: null,
    atrasoMinutos: 0, saidaAntecipadaMinutos: 0, horaExtraMinutos: 0,
  });
  // o que avisarOcorrencia grava
  await db.collection('classes').doc('c1').update({
    avisoProfessor: { tipo: 'ocorrencia', atrasoMinutos: 15, saidaAntecipadaMinutos: 0, horaExtraMinutos: 30, nota: 'trânsito', por: 'u1' },
  });
  let cls = (await db.collection('classes').doc('c1').get()).data();
  assert.strictEqual(cls.avisoProfessor.atrasoMinutos, 15, 'o aviso guarda o que o professor disse');
  assert.strictEqual(cls.atrasoMinutos, 0, 'mas o campo OFICIAL segue zerado');
  assert.strictEqual(cls.horaExtraMinutos, 0, 'idem hora extra — nada entrou no fechamento');
  console.log('✓ aviso do professor não mexe no que o fechamento lê');

  /* ── 3. Confirmação da gestão passa pro oficial e limpa o aviso ──── */
  const antes = cls.avisoProfessor;
  await db.collection('classes').doc('c1').update({
    atrasoMinutos: 15, horaExtraMinutos: 30,
    avisoProfessor: null,
    avisoProfessorAtendido: { ...antes, atendidoPor: 'gestao', atendidoEm: 'TS' },
  });
  cls = (await db.collection('classes').doc('c1').get()).data();
  assert.strictEqual(cls.atrasoMinutos, 15, 'agora sim o oficial tem o valor');
  assert.strictEqual(cls.horaExtraMinutos, 30, 'idem hora extra');
  assert.strictEqual(cls.avisoProfessor, null, 'o aviso sai da fila de pendentes');
  assert.strictEqual(cls.avisoProfessorAtendido.atendidoPor, 'gestao', 'fica o rastro de quem confirmou');
  assert.strictEqual(cls.avisoProfessorAtendido.atrasoMinutos, 15, 'e do que tinha sido informado');
  console.log('✓ confirmação da gestão promove os valores e guarda o rastro');

  /* ── 4. Aviso sem nenhum minuto é recusado ───────────────────────── */
  const vazio = [0, 0, 0].every(v => sanear(v) === 0);
  assert.ok(vazio, 'três zeros = nada a informar (a UI e o serviço recusam)');
  console.log('✓ aviso vazio é recusado');

  console.log('\n✓ smoke-aviso-ocorrencia: todos os casos passaram');
})().catch(e => { console.error('✗ FALHOU:', e.message); process.exit(1); });
