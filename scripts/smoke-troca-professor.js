'use strict';
// Roda: node scripts/smoke-troca-professor.js
//
// "as aulas que já passaram eu não consigo fazer a troca" (Camila, 21/08/2026).
// Ela não era a titular da aula, e só o titular tinha o botão. A gestão também
// não tinha. Agora qualquer um dos dois lados registra, o outro confirma, e a
// gestão homologa — e só a homologação move a aula.

const assert = require('assert');
const SF = require('../substitution-flow.js');

(async () => {
  /* ── 1. Quem pode registrar ──────────────────────────────────────── */
  const aula = { teacherId: 'theo', status: 'realizada', monthClosingId: null };

  assert.strictEqual(SF.podeRegistrar(aula, { teacherId: 'theo' }).ok, true,
    'o titular registra que passou a aula');
  assert.strictEqual(SF.podeRegistrar(aula, { teacherId: 'camila' }).ok, true,
    'quem deu a aula registra que foi ela — o caso da Camila');
  assert.strictEqual(SF.podeRegistrar(aula, { teacherId: null, isGestao: true }).ok, true,
    'a gestão registra sem ser professora');
  assert.strictEqual(SF.podeRegistrar(aula, { teacherId: null }).ok, false,
    'quem não é professor nem gestão não registra');

  const fechada = { teacherId: 'theo', status: 'realizada', monthClosingId: 'fech1' };
  const rFechada = SF.podeRegistrar(fechada, { teacherId: 'theo' });
  assert.strictEqual(rFechada.ok, false, 'mês fechado barra');
  assert.ok(/fechad/i.test(rFechada.motivo), 'e diz que é por causa do mês fechado');

  const cancelada = { teacherId: 'theo', status: 'cancelada', monthClosingId: null };
  assert.strictEqual(SF.podeRegistrar(cancelada, { teacherId: 'theo' }).ok, false,
    'aula cancelada não tem quem trocar');

  const jaTrocada = { teacherId: 'thaynara', status: 'substituida', monthClosingId: null };
  assert.strictEqual(SF.podeRegistrar(jaTrocada, { teacherId: 'thaynara' }).ok, true,
    'aula já trocada uma vez aceita nova troca — errar o nome tinha que ter conserto');
  console.log('✓ quem pode registrar');

  /* ── 2. Quem confirma depende de quem registrou ──────────────────── */
  const doTitular = { requestingTeacherId: 'theo', substituteTeacherId: 'camila', registradoPor: 'titular' };
  const doSubstituto = { requestingTeacherId: 'theo', substituteTeacherId: 'camila', registradoPor: 'substituto' };
  assert.strictEqual(SF.quemConfirma(doTitular), 'camila', 'registrou o titular → confirma quem cobriu');
  assert.strictEqual(SF.quemConfirma(doSubstituto), 'theo', 'registrou quem cobriu → confirma o titular');
  assert.strictEqual(SF.quemConfirma({ requestingTeacherId: 'theo', substituteTeacherId: 'camila' }), 'camila',
    'pedido antigo sem o campo é lido como registrado pelo titular');
  console.log('✓ quem confirma');

  /* ── 3. As transições ────────────────────────────────────────────── */
  const t = (status, acao, ator) => SF.transicao({ status, ...doTitular }, acao, ator);

  let r = t('pending', 'confirmar', { teacherId: 'camila' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.status, 'aguardando_gestao', 'confirmar NÃO aceita — manda pra gestão');

  r = t('pending', 'confirmar', { teacherId: 'theo' });
  assert.strictEqual(r.ok, false, 'quem registrou não confirma o próprio pedido');

  r = t('aguardando_gestao', 'homologar', { isGestao: true });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.status, 'accepted', 'a gestão homologa e aí sim vira aceita');

  r = t('aguardando_gestao', 'homologar', { teacherId: 'camila' });
  assert.strictEqual(r.ok, false, 'professor não homologa — era a brecha das rules');

  r = t('pending', 'homologar', { isGestao: true });
  assert.strictEqual(r.ok, true, 'a gestão homologa mesmo sem a resposta do professor (o caso do afastado)');
  assert.strictEqual(r.status, 'accepted');
  assert.strictEqual(r.semConfirmacaoDoProfessor, true, 'e isso fica marcado');

  r = t('accepted', 'homologar', { isGestao: true });
  assert.strictEqual(r.ok, false, 'pedido já resolvido não se mexe');

  r = t('pending', 'recusar', { teacherId: 'camila' });
  assert.strictEqual(r.status, 'rejected', 'o outro lado pode recusar');

  r = t('aguardando_gestao', 'recusar', { isGestao: true });
  assert.strictEqual(r.status, 'rejected', 'a gestão pode recusar');

  r = t('pending', 'cancelar', { teacherId: 'theo' });
  assert.strictEqual(r.status, 'cancelled', 'quem registrou desiste');

  r = t('pending', 'cancelar', { teacherId: 'camila' });
  assert.strictEqual(r.ok, false, 'o outro lado não cancela — ele recusa');
  console.log('✓ transições');

  /* ── 3b. Pedido duplicado ────────────────────────────────────────── */
  // O Theo pediu a mesma troca duas vezes em 04/08 porque achou que não tinha
  // funcionado, e o sistema aceitou as duas.
  assert.strictEqual(SF.jaTemPedidoAberto([{ status: 'pending' }]), true,
    'já existe pedido esperando resposta');
  assert.strictEqual(SF.jaTemPedidoAberto([{ status: 'aguardando_gestao' }]), true,
    'já existe pedido esperando a gestão');
  assert.strictEqual(SF.jaTemPedidoAberto([{ status: 'rejected' }, { status: 'cancelled' }]), false,
    'pedido recusado ou cancelado não impede tentar de novo');
  assert.strictEqual(SF.jaTemPedidoAberto([]), false, 'aula sem pedido nenhum');
  console.log('✓ duplicata barrada');

  /* ── 4. Pendências no fechamento ─────────────────────────────────── */
  const p = SF.pendenciasDoFechamento([
    { id: 'a', status: 'aguardando_gestao' },
    { id: 'b', status: 'pending' },
    { id: 'c', status: 'accepted' },
    { id: 'd', status: 'rejected' },
  ]);
  assert.deepStrictEqual(p.travam.map(x => x.id), ['a'], 'o que espera a gestão trava o fechamento');
  assert.deepStrictEqual(p.avisam.map(x => x.id), ['b'], 'o que espera professor só avisa');
  console.log('✓ pendências do fechamento');

  console.log('\n✅ smoke-troca-professor: módulo puro OK');
})().catch(e => { console.error('✗', e.message); process.exit(1); });
