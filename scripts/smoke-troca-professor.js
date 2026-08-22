'use strict';
// Roda: node scripts/smoke-troca-professor.js
//
// "as aulas que já passaram eu não consigo fazer a troca" (Camila, 21/08/2026).
// Ela não era a titular da aula, e só o titular tinha o botão. A gestão também
// não tinha. Agora qualquer um dos dois lados registra, o outro confirma, e a
// gestão homologa — e só a homologação move a aula.

const assert = require('assert');
const SF = require('../substitution-flow.js');

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

/* ── 1b. Checagens opcionais de podeRegistrar ────────────────────── */
// Continuam opcionais: sem opções, o comportamento de cima não muda.
assert.strictEqual(SF.podeRegistrar(aula, { teacherId: 'theo' }).ok, true,
  'sem opcoes, comportamento inalterado');

assert.strictEqual(
  SF.podeRegistrar(aula, { teacherId: 'theo' }, { subsDaAula: [{ status: 'pending' }] }).ok,
  false,
  'já tem pedido em aberto pra esta aula → barra'
);
assert.strictEqual(
  SF.podeRegistrar(aula, { teacherId: 'theo' }, { subsDaAula: [{ status: 'rejected' }] }).ok,
  true,
  'pedido recusado não conta como aberto'
);
assert.strictEqual(
  SF.podeRegistrar(aula, { teacherId: 'theo' }, { alvoTeacherId: 'theo' }).ok,
  false,
  'o alvo já é o titular da aula → nada a trocar'
);
assert.strictEqual(
  SF.podeRegistrar(aula, { teacherId: 'theo' }, { alvoTeacherId: 'camila' }).ok,
  true,
  'alvo diferente do titular → segue liberado'
);
console.log('✓ checagens opcionais de podeRegistrar');

/* ── 2. Quem confirma depende de quem registrou ──────────────────── */
const doTitular = { requestingTeacherId: 'theo', substituteTeacherId: 'camila', registradoPor: 'titular' };
const doSubstituto = { requestingTeacherId: 'theo', substituteTeacherId: 'camila', registradoPor: 'substituto' };
const daGestao = { requestingTeacherId: 'theo', substituteTeacherId: 'camila', registradoPor: 'gestao' };

assert.strictEqual(SF.quemConfirma(doTitular), 'camila', 'registrou o titular → confirma quem cobriu');
assert.strictEqual(SF.quemConfirma(doSubstituto), 'theo', 'registrou quem cobriu → confirma o titular');
assert.strictEqual(SF.quemConfirma({ requestingTeacherId: 'theo', substituteTeacherId: 'camila' }), 'camila',
  'pedido antigo sem o campo é lido como registrado pelo titular');

// Registro pela gestão: quem confirma é sempre o titular — é ele quem perde a
// aula e as horas, então é ele quem tem que checar a afirmação da gestão.
assert.strictEqual(SF.quemConfirma(daGestao), 'theo',
  'registrou a gestão → confirma o titular, não quem supostamente cobriu');
assert.strictEqual(SF.quemRegistrou(daGestao), null,
  'registrou a gestão → nenhum professor registrou, logo nenhum professor cancela');

// quemRegistrou no caso 'substituto', testado direto (antes só indiretamente via cancelar).
assert.strictEqual(SF.quemRegistrou(doSubstituto), 'camila',
  'registrou quem cobriu → é ela quem pode cancelar');
assert.strictEqual(SF.quemRegistrou(doTitular), 'theo',
  'registrou o titular → é ele quem pode cancelar');
console.log('✓ quem confirma');

/* ── 3. As transições ────────────────────────────────────────────── */
const t = (status, acao, ator) => SF.transicao({ status, ...doTitular }, acao, ator);

let r = t('pending', 'confirmar', { teacherId: 'camila' });
assert.strictEqual(r.ok, true, 'camila confirma o pedido do titular');
assert.strictEqual(r.status, 'aguardando_gestao', 'confirmar NÃO aceita — manda pra gestão');

r = t('pending', 'confirmar', { teacherId: 'theo' });
assert.strictEqual(r.ok, false, 'quem registrou não confirma o próprio pedido');

r = t('aguardando_gestao', 'homologar', { isGestao: true });
assert.strictEqual(r.ok, true, 'gestão homologa pedido já confirmado pelo colega');
assert.strictEqual(r.status, 'accepted', 'a gestão homologa e aí sim vira aceita');

r = t('aguardando_gestao', 'homologar', { teacherId: 'camila' });
assert.strictEqual(r.ok, false, 'professor não homologa — era a brecha das rules');

r = t('pending', 'homologar', { isGestao: true });
assert.strictEqual(r.ok, true, 'a gestão homologa mesmo sem a resposta do professor (o caso do afastado)');
assert.strictEqual(r.status, 'accepted', 'homologação direta também vira aceita');
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

/* ── 3b. Registro pela gestão muda quem cancela ──────────────────── */
const tGestao = (status, acao, ator) => SF.transicao({ status, ...daGestao }, acao, ator);

r = tGestao('pending', 'cancelar', { teacherId: 'theo' });
assert.strictEqual(r.ok, false,
  'o titular não cancela o que a gestão registrou — só a gestão recusa');
console.log('✓ cancelamento respeita quem registrou (inclusive gestão)');

/* ── 3c. Ator sem teacherId não confirma ─────────────────────────── */
r = SF.transicao({ status: 'pending', requestingTeacherId: 'theo' }, 'confirmar', {});
assert.strictEqual(r.ok, false, 'ator sem teacherId não pode confirmar em nome de ninguém');
console.log('✓ ator sem teacherId barrado na confirmação');

// Mesmo buraco existia em recusar: sub sem substituteTeacherId faz quemConfirma
// devolver undefined, e um ator sem isGestao nem teacherId também é undefined —
// undefined === undefined não pode virar "pode recusar".
r = SF.transicao({ status: 'pending', requestingTeacherId: 'theo' }, 'recusar', {});
assert.strictEqual(r.ok, false, 'ator sem isGestao nem teacherId não pode recusar em nome de ninguém');
console.log('✓ ator sem identidade barrado na recusa');

/* ── 3d. atorEhParte distingue "não respondeu" de "era o interessado" */
r = t('pending', 'homologar', { isGestao: true, teacherId: 'theo' });
assert.strictEqual(r.atorEhParte, true,
  'a supervisora que homologa é o titular da aula — ela é parte, registra-se isso');

r = t('pending', 'homologar', { isGestao: true, teacherId: 'camila' });
assert.strictEqual(r.atorEhParte, true,
  'a supervisora que homologa é quem cobriu a aula — também é parte');

r = t('pending', 'homologar', { isGestao: true, teacherId: 'rodrigo' });
assert.strictEqual(r.atorEhParte, false,
  'supervisor de fora da troca — não é parte');

r = t('pending', 'homologar', { isGestao: true });
assert.strictEqual(r.atorEhParte, false,
  'gestão sem teacherId (perfil administrativo puro) não é parte');

// O caso mais conflituoso: a gestão registra a troca EM FAVOR de alguém (o
// substituto ganha a aula e as horas) e essa mesma pessoa, sendo supervisora,
// homologa. quemConfirma/quemRegistrou no caminho 'gestao' dão {titular, null}
// — nenhum dos dois é o substituto — por isso atorEhParte tem que comparar
// contra requestingTeacherId/substituteTeacherId direto, não contra essas funções.
r = tGestao('pending', 'homologar', { isGestao: true, teacherId: 'camila' });
assert.strictEqual(r.atorEhParte, true,
  'registro pela gestão em favor da própria supervisora — ela é a beneficiária, é parte');
console.log('✓ atorEhParte');

/* ── 3e. Pedido duplicado ─────────────────────────────────────────── */
// O Theo pediu a mesma troca duas vezes em 04/08 porque achou que não tinha
// funcionado, e o sistema aceitou as duas.
assert.strictEqual(SF.jaTemPedidoAberto([{ status: 'pending' }]), true,
  'já existe pedido esperando resposta');
assert.strictEqual(SF.jaTemPedidoAberto([{ status: 'aguardando_gestao' }]), true,
  'já existe pedido esperando a gestão');
assert.strictEqual(SF.jaTemPedidoAberto([{ status: 'rejected' }, { status: 'cancelled' }]), false,
  'pedido recusado ou cancelado não impede tentar de novo');
assert.strictEqual(SF.jaTemPedidoAberto([]), false, 'aula sem pedido nenhum');
assert.strictEqual(SF.jaTemPedidoAberto([null, { status: 'pending' }]), true,
  'elemento nulo na lista não quebra a checagem');
console.log('✓ duplicata barrada');

/* ── 4. Pendências no fechamento ─────────────────────────────────── */
const p = SF.pendenciasDoFechamento([
  { id: 'a', status: 'aguardando_gestao' },
  { id: 'b', status: 'pending' },
  { id: 'c', status: 'accepted' },
  { id: 'd', status: 'rejected' },
  null,
]);
assert.deepStrictEqual(p.travam.map(x => x.id), ['a'], 'o que espera a gestão trava o fechamento');
assert.deepStrictEqual(p.avisam.map(x => x.id), ['b'], 'o que espera professor só avisa');
console.log('✓ pendências do fechamento (elemento nulo não quebra)');

/* ── 5. motivoSemBotao ────────────────────────────────────────────── */
assert.strictEqual(SF.motivoSemBotao(aula, { teacherId: 'theo' }), '',
  'liberado → motivo vazio, botão aparece');
assert.notStrictEqual(SF.motivoSemBotao(fechada, { teacherId: 'theo' }), '',
  'bloqueado → motivo não vazio, explica por quê');
console.log('✓ motivoSemBotao');

/* ── 6. Nenhum status sem rótulo ─────────────────────────────────── */
// Guarda contra "adicionei um status e esqueci o rótulo" — texto pra usuário
// nunca deve virar "undefined" na tela.
Object.keys(SF.STATUS).forEach((chave) => {
  const valor = SF.STATUS[chave];
  assert.ok(SF.STATUS_LABEL[valor], 'status "' + valor + '" sem rótulo em STATUS_LABEL');
});
console.log('✓ todo STATUS tem STATUS_LABEL');

/* ── 7. REGISTRADO_POR não é só string literal solta nos testes ─── */
// O resto do arquivo compara com 'titular'/'substituto'/'gestao' escritos à
// mão — sem isso, um typo na constante exportada passaria batido.
assert.deepStrictEqual(
  [SF.REGISTRADO_POR.TITULAR, SF.REGISTRADO_POR.SUBSTITUTO, SF.REGISTRADO_POR.GESTAO],
  ['titular', 'substituto', 'gestao'],
  'REGISTRADO_POR tem que bater com os valores usados no resto do arquivo'
);
console.log('✓ REGISTRADO_POR');

/* ── 5. A cola do navegador está ligada no módulo ────────────────── */
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const shared = fs.readFileSync(path.join(raiz, 'professores-shared.js'), 'utf8');

assert.ok(/SubstitutionFlow/.test(shared),
  'professores-shared.js precisa consultar o módulo em vez de decidir sozinho');
assert.ok(/homologar\s*\(/.test(shared),
  'SubstitutionService precisa do método homologar');
assert.ok(!/_respond\(subId,\s*'accepted'/.test(shared),
  'aceitar não pode mais mandar direto pra accepted — falta a gestão');
assert.ok(/registradoPor/.test(shared),
  'o pedido precisa gravar de que lado veio');
assert.ok(!/Só pedidos pendentes podem ser cancelados/.test(shared),
  'cancelar também passa pelo módulo — antes não checava QUEM estava cancelando');
console.log('✓ professores-shared.js ligado no módulo');

/* ── 6. Professor não homologa a própria troca ───────────────────── */
const rules = fs.readFileSync(path.join(raiz, 'firestore.rules'), 'utf8');
const blocoSub = rules.slice(rules.indexOf('match /substitutions/'),
                            rules.indexOf('match /coverage_applications/'));
assert.ok(/aguardando_gestao/.test(blocoSub),
  'a regra precisa conhecer o estado intermediário');
assert.ok(/request\.resource\.data\.status\s*!=\s*'accepted'/.test(blocoSub),
  'professor não pode escrever accepted — senão homologa a si mesmo pelo console e move a hora paga');
console.log('✓ rules de substitutions apertadas');

/* ── 7. A gestão é avisada pelo servidor ─────────────────────────── */
const cf = fs.readFileSync(path.join(raiz, 'functions/index.js'), 'utf8');
assert.ok(/aguardando_gestao/.test(cf),
  'a CF precisa reagir ao estado que espera a gestão');
assert.ok(/listAdminUserIds\(\)[\s\S]{0,900}substitution_aguardando_gestao/.test(cf),
  'o aviso pra gestão tem que sair do servidor: o professor não pode varrer /users (foi o que quebrou o pedido de férias)');
console.log('✓ CF avisa a gestão');

const listaAdmins = cf.match(/async function listAdminUserIds[\s\S]{0,600}?\n}/);
assert.ok(listaAdmins, 'listAdminUserIds precisa existir');
assert.ok(/'supervisao'/.test(listaAdmins[0]),
  'supervisão homologa troca e aprova férias — tem que estar na lista de quem é avisado');
console.log('✓ supervisão está na lista de quem a gestão avisa');

console.log('\n✅ smoke-troca-professor: módulo puro OK');
