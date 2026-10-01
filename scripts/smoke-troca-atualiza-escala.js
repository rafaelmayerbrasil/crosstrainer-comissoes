'use strict';
// Roda: node scripts/smoke-troca-atualiza-escala.js
process.env.TZ = 'America/Sao_Paulo';
//
// Achado de 01/10/2026, conferindo a reclamação do Vagner: quando uma troca de
// AULA DE ESCALA era confirmada, a aula mudava de nome e a ESCALA não. Em
// produção, a escala de 26/09 ainda mostrava o Thiago — quem deu a aula foi o
// Vagner. Tudo o que lê a escala ficava com o nome antigo:
//   · a contagem do rodízio (o Thiago levava um sábado que não trabalhou, o
//     Vagner trabalhava um que não contava — e o motor decide por essa conta);
//   · a "equipe do dia" que o professor vê;
//   · o texto da escala pro WhatsApp;
//   · e republicar a escala DESFAZIA a troca, recriando a aula no nome antigo.
//
// A vaga agora acompanha a aula, no mesmo gatilho que troca o professor.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const makeFakeDb = require('./_fake-firestore.js');
const T = require('../functions/escala-troca.js');
const SS = require('../scale-service.js');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

const escala26 = () => ({
  date: '2026-09-26', tipo: 'sabado', published: true,
  slots: [
    { id: 'cp_TOI', unitId: 'cp', requiredModalityName: 'TOI', assignedPersonId: 'thiago', reason: 'justica', explain: [{ personId: 'thiago' }] },
    { id: 'cp_HIIT', unitId: 'cp', requiredModalityName: 'Hiit', assignedPersonId: 'karin', reason: 'merito', explain: [] },
  ],
  historico: [{ ts: '2026-08-31T11:33:46.324Z', uid: 'u_rod', nome: 'RODRIGO', acao: 'publicada', detalhe: '4 aula(s) na agenda' }],
});
const quem = { paraId: 'vagner', deNome: 'THIAGO VALENTIM', paraNome: 'VAGNER TEIXEIRA', uid: 'u_rr', nome: 'Rafael Rojais', agoraISO: '2026-09-14T13:50:00.000Z' };

(async () => {
  /* ── 1. A conta pura: a vaga passa pra quem assumiu ────────────────── */
  {
    const antes = escala26();
    const r = T.vagaDepoisDaTroca(antes, Object.assign({ slotId: 'cp_TOI' }, quem));
    assert.ok(r, 'há mudança a gravar');
    const vaga = r.slots.find(s => s.id === 'cp_TOI');
    assert.strictEqual(vaga.assignedPersonId, 'vagner', 'a vaga agora é de quem deu a aula');
    assert.strictEqual(vaga.reason, 'troca', 'e o motivo deixa de ser "justiça": foi uma troca entre professores');
    assert.deepStrictEqual(vaga.explain, [], 'a tabela do "porquê" não fica explicando a escolha de outra pessoa');
    assert.deepStrictEqual(r.slots.find(s => s.id === 'cp_HIIT'), antes.slots[1], 'a outra vaga do dia não é tocada');
    assert.strictEqual(antes.slots[0].assignedPersonId, 'thiago', 'a entrada não é alterada (devolve cópia)');
    const h = r.historico[r.historico.length - 1];
    assert.strictEqual(h.acao, 'troca_de_aula');
    assert.ok(/THIAGO VALENTIM/.test(h.detalhe) && /VAGNER TEIXEIRA/.test(h.detalhe) && /TOI/.test(h.detalhe), 'o histórico diz quem saiu e quem entrou: ' + h.detalhe);
    assert.strictEqual(h.nome, 'Rafael Rojais', 'e quem confirmou');
    assert.strictEqual(r.historico.length, 2, 'o histórico anterior é preservado');
    passou('vagaDepoisDaTroca passa a vaga pra quem assumiu e registra no histórico');

    assert.strictEqual(T.vagaDepoisDaTroca(antes, Object.assign({ slotId: 'nao_existe' }, quem)), null, 'vaga que não existe: nada a fazer');
    assert.strictEqual(T.vagaDepoisDaTroca(antes, Object.assign({ slotId: 'cp_TOI' }, quem, { paraId: 'thiago' })), null, 'vaga que já está no nome certo: nada a fazer');
    assert.strictEqual(T.vagaDepoisDaTroca(null, Object.assign({ slotId: 'cp_TOI' }, quem)), null, 'escala ausente não estoura');
    assert.strictEqual(T.vagaDepoisDaTroca(antes, { slotId: 'cp_TOI' }), null, 'sem substituto não mexe');
    passou('sem vaga, sem substituto ou já certo: não grava nada');

    const cheio = escala26();
    cheio.historico = Array.from({ length: 50 }, (_, i) => ({ ts: `2026-08-01T00:${String(i).padStart(2, '0')}:00.000Z`, acao: 'publicada', detalhe: 'n' + i }));
    const rc = T.vagaDepoisDaTroca(cheio, Object.assign({ slotId: 'cp_TOI' }, quem));
    assert.strictEqual(rc.historico.length, 50, 'o histórico continua com teto de 50');
    assert.strictEqual(rc.historico[49].acao, 'troca_de_aula', 'a entrada nova entra; a mais velha sai');
    assert.strictEqual(rc.historico[0].detalhe, 'n1');
    passou('o histórico respeita o teto de 50 linhas');
  }

  /* ── 2. O passo completo, contra um banco de mentira ───────────────── */
  {
    const db = makeFakeDb();
    await db.collection('special_scales').doc('esc26').set(escala26());
    await db.collection('teachers').doc('thiago').set({ name: 'THIAGO VALENTIM' });
    await db.collection('teachers').doc('vagner').set({ name: 'VAGNER TEIXEIRA' });
    await db.collection('users').doc('u_rr').set({ name: 'Rafael Rojais' });
    const cls = { teacherId: 'thiago', specialScaleId: 'esc26', specialScaleSlotId: 'cp_TOI' };
    const sub = { substituteTeacherId: 'vagner', requestingTeacherId: 'thiago', homologadoPor: 'u_rr' };

    const r = await T.sincronizarEscalaComTroca(db, { cls, sub, agoraISO: '2026-09-14T13:50:00.000Z', carimbo: 'TS' });
    assert.strictEqual(r.mudou, true, 'gravou: ' + r.motivo);
    const gravada = (await db.collection('special_scales').doc('esc26').get()).data();
    assert.strictEqual(gravada.slots[0].assignedPersonId, 'vagner', 'a escala no banco mostra o Vagner');
    assert.strictEqual(gravada.published, true, 'o resto do documento fica como estava');
    assert.ok(/Rafael Rojais/.test(gravada.historico[1].nome), 'o nome de quem confirmou veio do cadastro');

    // É disso que se trata: o rodízio passa a contar quem trabalhou.
    const conta = SS.contarPorPessoa([Object.assign({ id: 'esc26' }, gravada)], { tipos: ['sabado'] });
    assert.strictEqual(conta.vagner, 1, 'o sábado conta pro Vagner, que trabalhou');
    assert.strictEqual(conta.thiago || 0, 0, 'e deixa de contar pro Thiago');
    passou('a escala gravada acompanha a troca, e o rodízio conta quem trabalhou');

    const de_novo = await T.sincronizarEscalaComTroca(db, { cls, sub, agoraISO: '2026-09-14T13:51:00.000Z', carimbo: 'TS' });
    assert.strictEqual(de_novo.mudou, false, 'rodar duas vezes não duplica nada (gatilho pode repetir)');
    assert.strictEqual((await db.collection('special_scales').doc('esc26').get()).data().historico.length, 2);
    passou('repetir o gatilho não duplica o histórico');

    const grade = await T.sincronizarEscalaComTroca(db, { cls: { teacherId: 'thiago' }, sub, agoraISO: 'x', carimbo: 'TS' });
    assert.strictEqual(grade.mudou, false, 'aula de grade comum não tem escala pra atualizar');
    const sumiu = await T.sincronizarEscalaComTroca(db, { cls: { specialScaleId: 'apagada', specialScaleSlotId: 'v' }, sub, agoraISO: 'x', carimbo: 'TS' });
    assert.strictEqual(sumiu.mudou, false, 'escala que não existe mais: segue sem erro');
    passou('aula de grade e escala inexistente passam sem erro e sem gravar');
  }

  /* ── 3. O gatilho de produção chama o passo ────────────────────────── */
  {
    const idx = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
    const ini = idx.indexOf('exports.processSubstitutionAcceptance');
    const corpo = idx.slice(ini, idx.indexOf('\n});', ini));
    assert.ok(/escalaTroca\.sincronizarEscalaComTroca\(/.test(corpo), 'o gatilho que troca o professor da aula também atualiza a escala');
    assert.ok(corpo.indexOf('sincronizarEscalaComTroca') > corpo.indexOf('runTransaction'), 'depois de a aula mudar de nome, não antes');
    passou('processSubstitutionAcceptance chama a sincronização depois de trocar a aula');
  }

  /* ── 4. A tela sabe mostrar a ação e o motivo novos ────────────────── */
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8');
    const sandbox = { console: { log() {} }, document: { getElementById: () => ({ style: {}, innerHTML: '' }) }, setTimeout, Date, Math, JSON, Promise, Set, Map, Array, Object, String, Number,
      AppState: { userProfile: {} }, ajudaBtn: () => '', ScaleService: SS };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: 'professores-escala-smart.js' });
    vm.runInContext('this.EscalaSmartState = EscalaSmartState;', sandbox);
    const rot = sandbox.escalaHistoricoAcaoLabel('troca_de_aula');
    assert.ok(rot && rot !== 'troca_de_aula' && /[Tt]roca/.test(rot), 'o histórico mostra um rótulo legível, não o código cru: ' + rot);
    sandbox.EscalaSmartState.units = [{ id: 'cp', name: 'CrossTainer CP' }];
    sandbox.EscalaSmartState.teacherMap = new Map([['vagner', { id: 'vagner', name: 'VAGNER', isActive: true, modalityIds: [] }]]);
    const html = sandbox.renderEscalaDetail({ id: 'e', date: '2026-09-26', tipo: 'sabado', status: 'consolidada', published: true,
      slots: [{ id: 'cp_TOI', unitId: 'cp', requiredModalityName: 'TOI', assignedPersonId: 'vagner', reason: 'troca', explain: [] }] });
    assert.ok(/Troca entre professores/.test(html), 'a vaga mostra que o nome veio de uma troca entre professores');
    passou('a tela mostra "Troca entre professores" na vaga e no histórico');
  }

  console.log(`\n${ok} verificações ✓`);
})().catch(e => { console.error('✗', e.stack || e.message); process.exit(1); });
