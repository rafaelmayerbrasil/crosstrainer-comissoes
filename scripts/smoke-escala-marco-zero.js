'use strict';
// Roda: node scripts/smoke-escala-marco-zero.js
//
// O marco zero é a resposta do Rafael (28/08/2026) ao pedido 3 do Rodrigo:
// "ignorar o histórico de papel, contar a partir de agora". Ele é um PISO da
// janela de 12 meses móveis, não um substituto: quando 01/09/2027 chegar, os
// 12 meses já são mais restritivos e o marco para de importar sozinho.
const assert = require('assert');
const SS = require('../scale-service.js');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

// ── dataDeCorte (puro) ──
{
  assert.strictEqual(SS.dataDeCorte('2026-10-17', null), '2025-10-17',
    'sem marco zero, vale a janela de 12 meses');
  assert.strictEqual(SS.dataDeCorte('2026-10-17', '2026-09-01'), '2026-09-01',
    'marco zero mais recente que os 12 meses manda');
  assert.strictEqual(SS.dataDeCorte('2027-10-17', '2026-09-01'), '2026-10-17',
    'quando os 12 meses passam do marco, o marco para de importar sozinho');
  assert.strictEqual(SS.dataDeCorte('2026-10-17', ''), '2025-10-17',
    'marco vazio é o mesmo que não ter marco');
  passou('dataDeCorte escolhe sempre o corte mais recente dos dois');
}

const makeFakeDb = require('./_fake-firestore.js');
const SE = require('../scale-engine.js');

// ── o motor respeita o marco zero ──
(async () => {
  const db = makeFakeDb();
  const d = { db, ts: () => 'TS', uid: () => 'tester', SE };

  const vaga = (id) => ({ id, unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: null, startTime: '08:00', endTime: '12:00' });
  const nova = async (date) => (await SS.createScale({ date, tipo: 'sabado', slots: [vaga('v1')] }, d)).data.id;

  // Histórico ANTES do marco: a ana pegou 3 sábados de agosto.
  const antigas = ['2026-08-01', '2026-08-08', '2026-08-15'].map(date => ({
    id: `old_${date}`, date, tipo: 'sabado',
    slots: [{ id: 'v1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: 'ana' }],
  }));

  const teachers = [
    { id: 'ana', modalityIds: ['TOI'] },
    { id: 'bru', modalityIds: ['TOI'] },
  ];
  const ctxBase = { teachers, meritoById: { ana: 100, bru: 0 }, scalesDoAno: antigas, opts: { minMes: 1 } };

  // SEM marco zero: os 3 sábados de agosto contam, a ana está atrás no rodízio.
  const semMarco = await nova('2026-09-05');
  await SS.consolidate(semMarco, Object.assign({}, ctxBase, { marcoZero: null }), d);
  const r1 = await SS.getScale(semMarco, d);
  assert.strictEqual(r1.data.slots[0].assignedPersonId, 'bru',
    'sem marco zero, agosto conta e a ana cede a vez');
  passou('sem marco zero, o histórico anterior pesa no rodízio');

  // COM marco zero em 01/09: agosto some da conta, empatam em 0, decide o mérito.
  const comMarco = await nova('2026-09-12');
  await SS.consolidate(comMarco, Object.assign({}, ctxBase, { marcoZero: '2026-09-01' }), d);
  const r2 = await SS.getScale(comMarco, d);
  assert.strictEqual(r2.data.slots[0].assignedPersonId, 'ana',
    'com marco zero, agosto não conta: empatam em 0 e o mérito desempata');
  passou('marco zero apaga o histórico anterior para o motor');

  // Sem ctx.marcoZero, lê da config — e a config manda.
  await SS.ScaleConfigService.save({ marcoZero: '2026-09-01' }, d);
  const daConfig = await nova('2026-09-19');
  await SS.consolidate(daConfig, ctxBase, d);
  const r3 = await SS.getScale(daConfig, d);
  assert.strictEqual(r3.data.slots[0].assignedPersonId, 'ana',
    'quem não passa ctx.marcoZero recebe o valor da config, não zero');
  passou('consolidate lê o marco zero da config quando o ctx não manda');

  // Marco zero corrompido na config (ex.: um Timestamp virado string, ou
  // qualquer coisa fora de YYYY-MM-DD): cai pra null, com aviso — nunca em
  // silêncio, mas também nunca derrubando a consolidação.
  await SS.ScaleConfigService.save({ marcoZero: 'nao-e-uma-data' }, d);
  const avisos = [];
  const warnOriginal = console.warn;
  console.warn = (...args) => avisos.push(args.join(' '));
  const configInvalida = await nova('2026-09-26');
  await SS.consolidate(configInvalida, ctxBase, d);
  console.warn = warnOriginal;
  const r4 = await SS.getScale(configInvalida, d);
  assert.strictEqual(r4.data.slots[0].assignedPersonId, 'bru',
    'marco zero inválido na config é ignorado — agosto volta a contar e a ana cede a vez');
  assert.ok(avisos.some(a => /marco zero/i.test(a)),
    'e um aviso avisa que o valor configurado foi ignorado');
  passou('marco zero inválido na config cai pra null, com aviso, sem derrubar a consolidação');

  console.log(`\n${ok}/5 blocos OK`);
})().then(rodarTestesDaTela).catch(e => { console.error('❌', e.message); process.exit(1); });

// ── a TELA respeita o marco zero (chama de verdade, não só lê o texto) ──
//
// A cicatriz deste projeto: "a prévia antes de publicar" chamava uma função
// inexistente e foi pra produção assim porque doze verificações liam o texto
// do arquivo, nenhuma chamava a função (ver `smoke-escala-contagem.js`, bloco
// "a prévia RODA e desenha"). Este bloco segue o mesmo molde: carrega
// professores-escala-smart.js num sandbox com os globais dublados e CHAMA
// escalaContagens, renderConfigEscalaHtml e salvarMarcoZero de verdade.
async function rodarTestesDaTela() {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  let okTela = 0;
  const passouTela = (m) => { console.log('✓ ' + m); okTela++; };

  const src = fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8');

  // Espiões compartilhados pelos três grupos de teste — resetados entre cenários.
  let saveCalls = 0, savedPatch = null, saveShouldFail = false;
  let auditCalls = [];
  let loadBaseCalls = 0, renderCalls = 0;
  let toastCalls = [];
  let confirmReturn = true, confirmCalls = 0;
  let adminReturn = true;
  const inputEl = { value: '' };

  const sandbox = {
    console,
    ScaleService: {
      tiposIrmaos: SS.tiposIrmaos,
      contarPorPessoa: SS.contarPorPessoa,
      ScaleConfigService: {
        save: async (patch) => {
          saveCalls++; savedPatch = patch;
          return saveShouldFail ? { success: false, error: 'falha simulada' } : { success: true };
        },
      },
    },
    isAdminGestao: () => adminReturn,
    isSupervisao: () => false,
    ajudaBtn: () => '',
    toast: (msg, type) => { toastCalls.push({ msg, type }); },
    confirm: () => { confirmCalls++; return confirmReturn; },
    document: {
      getElementById: (id) => (id === 'escalaMarcoZero' ? inputEl : null),
    },
    AuditService: {
      log: async (params) => { auditCalls.push(params); return { success: true }; },
    },
    AppState: { userProfile: null },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'professores-escala-smart.js' });
  // `const`/`let` de topo de arquivo (EscalaSmartState) não viram propriedade
  // do sandbox — só `function`/`var` viram. Ponte explícita.
  vm.runInContext('this.EscalaSmartState = EscalaSmartState;', sandbox);
  // Sobrescreve DEPOIS de rodar o script: `function escalaLoadBase(){}` e
  // `function renderEscalaGestao(){}` também são var-like e teriam clobbered
  // um espião posto ANTES da execução.
  sandbox.escalaLoadBase = async () => { loadBaseCalls++; };
  sandbox.renderEscalaGestao = () => { renderCalls++; };

  const resetEspioes = () => {
    saveCalls = 0; savedPatch = null; saveShouldFail = false;
    auditCalls = []; loadBaseCalls = 0; renderCalls = 0; toastCalls = [];
    confirmReturn = true; confirmCalls = 0;
  };

  // ── escalaContagens: os Important 1–3 da revisão moram aqui ──
  {
    sandbox.EscalaSmartState.year = 2026;
    sandbox.EscalaSmartState.scales = [
      { id: 's_antes', date: '2026-08-01', tipo: 'sabado', windowBatchId: null, status: 'consolidada',
        slots: [{ id: 'v1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: 'ana' }] },
      { id: 's_depois', date: '2026-09-05', tipo: 'sabado', windowBatchId: null, status: 'consolidada',
        slots: [{ id: 'v1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: 'ana' }] },
    ];
    sandbox.EscalaSmartState.janelaPorTipo = {};

    // Com marco: o sábado de antes do corte não entra no "ano".
    sandbox.EscalaSmartState.config = { marcoZero: '2026-09-01', horarios: {} };
    const c1 = sandbox.escalaContagens('sabado');
    assert.strictEqual(c1.marco, '2026-09-01', 'marco lido da config');
    assert.strictEqual(c1.deAno, '2026-09-01', 'deAno usa o marco (mais recente que 1º/jan)');
    assert.strictEqual(c1.ano.ana, 1, 'só o sábado de depois do marco conta no ano');
    passouTela('escalaContagens corta o "ano" pelo marco quando ele é mais recente que 1º de janeiro');

    // Sem marco: volta a valer o ano civil inteiro.
    sandbox.EscalaSmartState.config = { horarios: {} };
    const c2 = sandbox.escalaContagens('sabado');
    assert.strictEqual(c2.marco, null, 'sem marco na config, marco é null');
    assert.strictEqual(c2.deAno, '2026-01-01', 'sem marco, deAno cai pro 1º de janeiro');
    assert.strictEqual(c2.ano.ana, 2, 'sem marco, os dois sábados contam');
    passouTela('escalaContagens sem marco volta a contar o ano civil inteiro');

    // Ano ANTERIOR ao ano do marco: o marco (2026-09-01) é maior que
    // 2025-12-31 — a janela do ano fecha vazia, sem estourar nada.
    sandbox.EscalaSmartState.config = { marcoZero: '2026-09-01', horarios: {} };
    sandbox.EscalaSmartState.year = 2025;
    const c3 = sandbox.escalaContagens('sabado');
    assert.strictEqual(c3.deAno, '2026-09-01', 'deAno ainda é o marco, mesmo sendo posterior ao próprio ano pedido');
    assert.strictEqual(c3.ano.ana || 0, 0, 'ano anterior ao marco: ninguém conta, mas não estoura');
    passouTela('escalaContagens num ano anterior ao marco dá zero sem quebrar');

    // Marco malformado na config: mesma blindagem do scale-service.js —
    // cai pra null, com aviso, sem derrubar o render (Important 3 da revisão).
    sandbox.EscalaSmartState.year = 2026;
    sandbox.EscalaSmartState.config = { marcoZero: 'nao-e-uma-data', horarios: {} };
    const avisos = [];
    const warnOriginal = console.warn;
    console.warn = (...args) => avisos.push(args.join(' '));
    const c4 = sandbox.escalaContagens('sabado');
    console.warn = warnOriginal;
    assert.strictEqual(c4.marco, null, 'marco inválido cai pra null');
    assert.strictEqual(c4.deAno, '2026-01-01', 'sem marco válido, deAno é o 1º de janeiro');
    assert.strictEqual(c4.ano.ana, 2, 'marco ignorado: os dois sábados voltam a contar');
    assert.ok(avisos.some(a => /marco zero/i.test(a)), 'e um aviso avisa que o valor configurado foi ignorado');
    passouTela('escalaContagens com marco malformado ignora o valor e avisa, sem estourar o render');
  }

  // ── renderConfigEscalaHtml: gate de permissão — só prova quem CHAMA ──
  {
    sandbox.EscalaSmartState.config = { marcoZero: '2026-09-01', horarios: {} };
    adminReturn = true;
    const htmlAdmin = sandbox.renderConfigEscalaHtml();
    assert.ok(/id="escalaMarcoZero"/.test(htmlAdmin), 'Admin vê o campo de configuração');
    assert.ok(/value="2026-09-01"/.test(htmlAdmin), 'campo vem preenchido com o marco atual');

    adminReturn = false;
    const htmlNaoAdmin = sandbox.renderConfigEscalaHtml();
    assert.strictEqual(htmlNaoAdmin, '', 'sem ser Admin, o bloco não existe na tela — regex não provaria isso, só a chamada');
    adminReturn = true;
    passouTela('renderConfigEscalaHtml só mostra o bloco pra quem a rule realmente deixa gravar');
  }

  // ── salvarMarcoZero: a única com efeito colateral real ──
  {
    // Caminho feliz.
    resetEspioes();
    sandbox.EscalaSmartState.config = { marcoZero: null, horarios: {} };
    inputEl.value = '2026-09-01';
    await sandbox.salvarMarcoZero();
    assert.strictEqual(saveCalls, 1, 'chamou save uma vez');
    assert.strictEqual(savedPatch.marcoZero, '2026-09-01', 'gravou o valor do campo');
    assert.strictEqual(auditCalls.length, 1, 'gravou 1 entry de audit');
    assert.strictEqual(auditCalls[0].type, 'scale_marco_zero', 'tipo do audit correto');
    assert.strictEqual(auditCalls[0].module, 'agenda', 'module = agenda, não professores');
    assert.strictEqual(auditCalls[0].before.marcoZero, null, 'audit registra o valor de antes');
    assert.strictEqual(auditCalls[0].after.marcoZero, '2026-09-01', 'audit registra o valor de depois');
    assert.strictEqual(loadBaseCalls, 1, 'recarregou o estado');
    assert.strictEqual(renderCalls, 1, 're-renderizou a tela');
    assert.ok(toastCalls.some(t => /salvo/i.test(t.msg)), 'avisou sucesso');
    passouTela('salvarMarcoZero (caminho feliz): salva, audita, recarrega e avisa');

    // Caminho de erro: save falha → toast de erro, NÃO audita, NÃO recarrega.
    resetEspioes();
    saveShouldFail = true;
    sandbox.EscalaSmartState.config = { marcoZero: null, horarios: {} };
    inputEl.value = '2026-10-01';
    await sandbox.salvarMarcoZero();
    assert.strictEqual(saveCalls, 1, 'tentou salvar');
    assert.strictEqual(auditCalls.length, 0, 'save falhou: NÃO audita');
    assert.strictEqual(loadBaseCalls, 0, 'save falhou: NÃO recarrega');
    assert.strictEqual(renderCalls, 0, 'save falhou: NÃO re-renderiza');
    assert.ok(toastCalls.some(t => t.type === 'error'), 'avisou o erro');
    passouTela('salvarMarcoZero (caminho de erro): falha de save não finge sucesso');

    // Confirm recusado: nem chega a salvar.
    resetEspioes();
    confirmReturn = false;
    sandbox.EscalaSmartState.config = { marcoZero: null, horarios: {} };
    inputEl.value = '2026-11-01';
    await sandbox.salvarMarcoZero();
    assert.strictEqual(confirmCalls, 1, 'perguntou antes de gravar');
    assert.strictEqual(saveCalls, 0, 'recusado no confirm: não salva');
    assert.strictEqual(auditCalls.length, 0, 'recusado no confirm: não audita');
    passouTela('salvarMarcoZero (confirm recusado): desiste sem gravar nada');

    // No-op: valor igual ao atual não chama confirm nem save.
    resetEspioes();
    sandbox.EscalaSmartState.config = { marcoZero: '2026-09-01', horarios: {} };
    inputEl.value = '2026-09-01';
    await sandbox.salvarMarcoZero();
    assert.strictEqual(confirmCalls, 0, 'nada mudou: nem pergunta');
    assert.strictEqual(saveCalls, 0, 'nada mudou: não salva');
    assert.ok(toastCalls.some(t => /nada mudou/i.test(t.msg)), 'avisou que nada mudou');
    passouTela('salvarMarcoZero (no-op): valor igual ao atual não faz nada');
  }

  console.log(`\n${okTela}/9 verificações da tela OK`);
}
