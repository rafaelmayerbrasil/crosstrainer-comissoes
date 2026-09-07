'use strict';
// Roda: node scripts/smoke-gestao-confirma-troca-parada.js
//
// ══════════════════════════════════════════════════════════════════════
// A gestão precisa conseguir confirmar troca que o professor não respondeu
// ══════════════════════════════════════════════════════════════════════
//
// Achado na produção em 05/09/2026: 23 trocas abertas, TODAS em 'pending',
// nenhuma em 'aguardando_gestao'. `substitution-flow.js` sempre deixou a gestão
// homologar direto do 'pending' ("a saída para férias, folga, desligamento e
// para quem simplesmente não abre o app") e as rules liberam admin/supervisão —
// mas a tela só desenhava os botões quando o status era 'aguardando_gestao'.
// A Benny via 23 tarjas laranja e nenhum botão, e a folha de agosto ficou parada
// esperando 3 professores que nunca abriram o app (31 notificações não lidas).
//
// Este smoke NÃO lê o texto do arquivo: ele RODA `renderSubCard` num sandbox e
// confere o HTML que sai. Conferir que a string existe no arquivo já deixou
// passar defeito antes ([[previa-nunca-rodou]]).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);

/* ── sandbox parecido com a página ───────────────────────────────── */
function montarTela({ ehGestao }) {
  const sandbox = {
    console: { log() {}, error() {}, warn() {} },
    AgendaState: {
      teachersMap: new Map([
        ['thay', { id: 'thay', name: 'THAYNARA SILVA' }],
        ['theo', { id: 'theo', name: 'THEO ROSA' }],
      ]),
      modalitiesMap: new Map([['hiit', { id: 'hiit', name: 'Hiit/Marombinha' }]]),
    },
    isAdminGestao: () => ehGestao,
    isSupervisao: () => false,
    getCurrentProfessorId: () => (ehGestao ? null : 'thay'),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['substitution-flow.js', 'professores-substituicoes.js']) {
    vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

const pedido = (status) => ({
  id: 'sub1', status,
  requestingTeacherId: 'thay', substituteTeacherId: 'theo',
  registradoPor: 'substituto', wasRetroactive: true,
  classDate: { toDate: () => new Date(2026, 7, 28, 14, 30) },
  classStartTime: '14:30', classModalityId: 'hiit',
});

/* ── 1. gestão: 'pending' tem botão de confirmar ─────────────────── */
{
  const t = montarTela({ ehGestao: true });
  const html = t.renderSubCard(pedido('pending'), 'gestao');
  assert.ok(/subsHomologar\('sub1'/.test(html),
    'troca parada no professor precisa de botão de confirmar pra gestão — era o buraco da Benny');
  assert.ok(/subsRecusar\('sub1'/.test(html),
    'e de botão de recusar: confirmar não pode ser a única saída');
  ok("gestão consegue agir numa troca em 'pending'");
}

/* ── 2. e a tela avisa que o professor não respondeu ──────────────── */
{
  const t = montarTela({ ehGestao: true });
  const html = t.renderSubCard(pedido('pending'), 'gestao');
  assert.ok(/ainda não respondeu/i.test(html),
    'confirmar sem a resposta do professor é diferente de homologar o que ele já confirmou — a tela tem que dizer');
  assert.ok(/THAYNARA SILVA/.test(html),
    'e dizer QUEM não respondeu, senão a gestão não sabe pra quem cobrar');
  ok('a tela distingue "ninguém respondeu" de "já confirmado pelo colega"');
}

/* ── 3. 'aguardando_gestao' continua como era ─────────────────────── */
{
  const t = montarTela({ ehGestao: true });
  const html = t.renderSubCard(pedido('aguardando_gestao'), 'gestao');
  assert.ok(/subsHomologar\('sub1'/.test(html), 'o degrau que já existia não pode sumir');
  assert.ok(!/ainda não respondeu/i.test(html),
    'aqui o professor JÁ respondeu — o aviso de "não respondeu" mentiria');
  ok("'aguardando_gestao' segue funcionando, sem o aviso");
}

/* ── 4. status resolvido não ganha botão nenhum ───────────────────── */
{
  const t = montarTela({ ehGestao: true });
  for (const s of ['accepted', 'rejected', 'cancelled']) {
    const html = t.renderSubCard(pedido(s), 'gestao');
    assert.ok(!/subsHomologar/.test(html), `troca ${s} não pode oferecer confirmar de novo`);
  }
  ok('troca já resolvida não oferece botão');
}

/* ── 5. professor NÃO ganha o botão da gestão ────────────────────── */
{
  const t = montarTela({ ehGestao: false });
  const html = t.renderSubCard(pedido('pending'), 'pedi');
  assert.ok(!/subsHomologar/.test(html),
    'professor não homologa a própria troca — seria furo de segurança na tela');
  ok('professor não vê o botão da gestão');
}

/* ── 6. o serviço aceita mesmo: a regra sempre deixou ─────────────── */
{
  const SF = require('../substitution-flow.js');
  const r = SF.transicao(pedido('pending'), 'homologar', { isGestao: true });
  assert.strictEqual(r.ok, true, 'a máquina de estados sempre deixou a gestão homologar do pending');
  assert.strictEqual(r.status, 'accepted', 'e vai direto pro accepted, que é o que move a aula');
  assert.strictEqual(r.semConfirmacaoDoProfessor, true,
    'e marca que foi sem a resposta do professor — o registro tem que distinguir');
  ok('o serviço confirma que o botão novo não força nada que a regra não permitisse');
}

/* ── 7. o bloqueio do fechamento diz onde resolver ────────────────── */
{
  // A tela desenhada é exercitada em smoke-conferencia-fechamento.js; aqui a
  // pergunta é só se o texto do modal ensina a saída. Avisar sem dizer onde
  // resolver foi o que deixou a gestão parada por 10 dias.
  const fech = fs.readFileSync(path.join(raiz, 'professores-fechamento.js'), 'utf8');
  const bloco = fech.match(/const bloqueio = p\.travam[\s\S]{0,1600}?: '';/);
  assert.ok(bloco, 'o bloco que trava o fechamento por troca aberta precisa existir');
  assert.ok(/Substitui/.test(bloco[0]), 'e apontar a tela onde se resolve');
  assert.ok(/Confirmar mesmo assim/.test(bloco[0]),
    'e nomear o botão que resolve quem não respondeu — senão a gestão fica esperando de novo');
  assert.ok(/semRespostaDoProfessor/.test(bloco[0]),
    'separando quem não respondeu de quem já confirmou: a saída é diferente');
  ok('o bloqueio do fechamento aponta o caminho');
}

console.log('\n✅ smoke-gestao-confirma-troca-parada: ' + n + '/7');
