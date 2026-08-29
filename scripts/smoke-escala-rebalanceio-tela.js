'use strict';
// Roda: node scripts/smoke-escala-rebalanceio-tela.js
//
// Task 20 (28/08/2026): o botão "Ajustar" do painel de Equilíbrio — a TELA do
// rebalanceio. `scale-rebalance.js` (motor) e `ScaleService.aplicarRebalanceamento`
// (serviço) já estavam prontos e testados; esta task é o clique, a prévia e o
// aviso, que é o que a gestão realmente usa.
//
// Duas cicatrizes deste projeto que este arquivo existe para não repetir:
//
// 1) A "prévia antes de publicar" de 24/08 nunca rodou em produção — chamava
//    uma função inexistente e passou por 12 verificações porque todas liam o
//    TEXTO do arquivo. Aqui: carrega professores-escala-smart.js DE VERDADE
//    num sandbox `vm` e CHAMA `abrirAjusteFrequencia`/`aplicarAjusteFrequencia`
//    de ponta a ponta — nunca regex sobre o arquivo pra provar comportamento.
//
// 2) `NotifyService.resolveManagementUserIds` devolve `{success:false, data:[]}`
//    em erro — igual a "não tem gestão cadastrada". Ignorar o `success` faz
//    "falha ao consultar" virar "ninguém pra avisar", em silêncio. Um bloco
//    inteiro abaixo prova que a falha aparece pro operador, não desaparece.
process.env.TZ = 'America/Sao_Paulo';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SS = require('../scale-service.js');
const ScaleRebalanceReal = require('../scale-rebalance.js');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

const src = fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8');

// Objeto criado DENTRO do sandbox `vm` tem prototype de outro realm —
// `assert.deepStrictEqual` cru falha contra literal do host mesmo com valores
// idênticos. Normaliza pro realm do host antes de comparar.
const plano = (o) => JSON.parse(JSON.stringify(o));

/**
 * Sandbox novo por bloco. `ScaleRebalance.planejar` é um ESPIÃO em cima do
 * motor REAL (não um dublê que devolve um plano fixo): é a única forma de
 * provar que "Aplicar" usa o MESMO objeto que a prévia mostrou — se o motor
 * fosse dublê, a igualdade dos dois "planos" seria trivial e não provaria nada
 * sobre o código de professores-escala-smart.js.
 */
function novoSandbox() {
  const modal = { innerHTML: '', style: {} };
  const overlay = { style: {}, innerHTML: '' };
  const state = {
    toastCalls: [], promptCalls: [], promptReturn: '0',
    planejarCalls: [], aplicarCalls: [], notifySendCalls: [],
    resolveManagementCalls: 0, resolveManagementReturn: { success: true, data: ['u_admin'] },
    aplicarRebalanceamentoReturn: null,   // setado por teste; default abaixo
    consoleErrors: [], loadBaseCalls: 0, renderCalls: 0,
  };

  // "Não posso" por data, e o interruptor pra simular a leitura falhando.
  let prefsPorEscala = {};
  let prefsFalham = false;
  const setPrefs = (m) => { prefsPorEscala = m || {}; };
  const setPrefsFalham = (v) => { prefsFalham = !!v; };

  const sandbox = {
    console: { log() {}, warn() {}, error: (...a) => { state.consoleErrors.push(a); } },
    document: {
      getElementById: (id) => (id === 'escalaModal' ? modal : id === 'escalaModalOverlay' ? overlay : { style: {}, innerHTML: '' }),
    },
    setTimeout, clearTimeout, Date, Math, JSON, Promise, Set, Map, Array, Object, String, Number,
    toast: (msg, type) => { state.toastCalls.push({ msg, type }); },
    prompt: (msg, def) => { state.promptCalls.push({ msg, def }); return state.promptReturn; },
    ajudaBtn: () => '',
    AppState: { userProfile: {} },
    EngagementService: {
      listCycles: async () => ({ success: true, data: [{ id: 'c', inicio: '2026-01-01', fim: '2026-12-31' }] }),
      currentCycle: (cs) => cs[0],
      scoreboard: async () => ({ success: true, data: { total: 10 } }),
    },
    ScaleService: {
      tiposIrmaos: SS.tiposIrmaos,
      contarPorPessoa: SS.contarPorPessoa,
      fmtDataLonga: SS.fmtDataLonga,
      personsOnVacation: () => new Set(),
      listWindowQuotas: async () => ({ success: true, data: {} }),
      // Respostas "não posso" por data. O teste sobrescreve `prefsPorEscala`
      // para provar que o rebalanceio respeita a recusa.
      listPreferences: async (scaleId) => (prefsFalham
        ? { success: false, error: 'boom' }
        : { success: true, data: (prefsPorEscala[scaleId] || []) }),
      aplicarRebalanceamento: async (args, deps) => {
        state.aplicarCalls.push({ args, deps });
        if (state.aplicarRebalanceamentoReturn) return state.aplicarRebalanceamentoReturn(args);
        // default: espelha o comportamento REAL (Task 19) — só avisa quem
        // estava numa data JÁ PUBLICADA.
        const avisar = (args.movimentos || []).filter(m => m.published);
        return { success: true, data: { aplicados: (args.movimentos || []).length, movimentos: args.movimentos, avisar, republicadas: 0 } };
      },
    },
    ScaleRebalance: {
      planejar: (args) => { state.planejarCalls.push(plano(args)); return ScaleRebalanceReal.planejar(args); },
    },
    NotifyService: {
      send: async (args) => { state.notifySendCalls.push(args); return { success: true, data: { inapp: (args.recipients || []).length } }; },
      resolveManagementUserIds: async () => { state.resolveManagementCalls++; return state.resolveManagementReturn; },
    },
    UnitService: { list: async () => ({ success: true, data: [] }) },
    ModalityService: { list: async () => ({ success: true, data: [] }) },
    TeacherService: { list: async () => ({ success: true, data: [] }) },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'professores-escala-smart.js' });
  vm.runInContext('this.EscalaSmartState = EscalaSmartState;', sandbox);
  // Sobrescreve DEPOIS de rodar o script (mesmo truque de
  // smoke-escala-historico-tela.js): escalaLoadBase/renderEscalaGestao também
  // são function-declarations e um espião posto ANTES seria clobbered.
  sandbox.escalaLoadBase = async () => { state.loadBaseCalls++; };
  sandbox.renderEscalaGestao = () => { state.renderCalls++; };
  // "Hoje" FIXO. O ajuste ignora data que já passou, e sem fixar isto a suíte
  // viraria bomba-relógio: as fixtures de setembro/outubro de 2026 passariam a
  // ser "passado" na virada e os testes quebrariam sozinhos, num dia qualquer,
  // sem ninguém ter mexido em nada.
  sandbox.escalaTodayISO = () => '2026-08-29';
  return { sandbox, state, modal, setPrefs, setPrefsFalham };
}

// Vaga TOI numa unidade; slots de duas pessoas viram um cenário de rebalanceio.
const vaga = (id, pid) => ({ id, unitId: 'cp', requiredModalityId: 'TOI', requiredModalityName: 'TOI', assignedPersonId: pid || null });
const escala = (id, date, pid, batchId, published) => ({
  id, date, tipo: 'sabado', windowBatchId: batchId, published: !!published,
  slots: [vaga(`v_${id}`, pid)],
});

function teachers3() {
  return new Map([
    ['hel', { id: 'hel', name: 'Heloísa', userId: 'u_hel', isActive: true, modalityIds: ['TOI'] }],
    ['car', { id: 'car', name: 'Carla', userId: 'u_car', isActive: true, modalityIds: ['TOI'] }],
    ['bru', { id: 'bru', name: 'Bruno', userId: 'u_bru', isActive: true, modalityIds: ['TOI'] }],
  ]);
}

function baseState(sandbox, scales, loteId) {
  sandbox.EscalaSmartState.teacherMap = teachers3();
  sandbox.EscalaSmartState.units = [{ id: 'cp', name: 'CrossTainer CP' }];
  sandbox.EscalaSmartState.year = 2026;
  sandbox.EscalaSmartState.tab = 'sabado';
  sandbox.EscalaSmartState.config = {};
  sandbox.EscalaSmartState.scales = scales;
  sandbox.EscalaSmartState.janelaPorTipo = { sabado: { id: loteId, aberta: true } };
}

(async () => {
  // ── 1. a prévia DESENHA, do clique ao HTML, com o motivo visível ────────
  // Heloísa tem 2 sábados no lote (05/09 e 19/09); Bruno tem 1 (03/10); Carla
  // 0. Baixar Heloísa de 2 pra 1: só Carla e Bruno são elegíveis pro dia que
  // sai, e Carla tem MENOS dias — vence sozinha, critério "rodizio".
  let planoMovs, mv1SlotId;
  {
    const scales = [
      escala('s1', '2026-09-05', 'hel', 'lote1', false),
      escala('s2', '2026-09-19', 'hel', 'lote1', false),
      escala('s3', '2026-10-03', 'bru', 'lote1', false),
    ];
    const { sandbox, state, modal } = novoSandbox();
    baseState(sandbox, scales, 'lote1');
    state.promptReturn = '1';   // alvo = 1

    await sandbox.abrirAjusteFrequencia('hel');

    assert.strictEqual(state.aplicarCalls.length, 0, 'abrir a prévia NÃO chama aplicarRebalanceamento — só monta e desenha');
    assert.strictEqual(state.notifySendCalls.length, 0, 'abrir a prévia NÃO manda aviso nenhum');
    assert.strictEqual(state.loadBaseCalls, 0, 'abrir a prévia NÃO recarrega a base — nada mudou ainda');
    passou('a prévia NÃO grava, NÃO avisa e NÃO recarrega — só monta e desenha');

    assert.strictEqual(state.planejarCalls.length, 1, 'ScaleRebalance.planejar foi chamado exatamente 1 vez');
    const st = sandbox.EscalaSmartState._planoAjuste;
    assert.ok(st && st.plano, 'o plano ficou guardado em EscalaSmartState._planoAjuste');
    assert.strictEqual(st.plano.movimentos.length, 1, 'o motor real achou 1 movimento (Carla entra no lugar de Heloísa)');
    assert.strictEqual(st.plano.movimentos[0].entraId, 'car', 'quem entra é Carla — tem menos dias que Bruno');
    assert.strictEqual(st.plano.movimentos[0].motivo, 'rodizio', 'o critério que decidiu foi o rodízio (dias), não único candidato');
    planoMovs = st.plano.movimentos;
    mv1SlotId = st.plano.movimentos[0].slotId;

    assert.ok(/Heloísa/.test(modal.innerHTML), 'a prévia mostra o nome de quem está sendo ajustada');
    assert.ok(/sai .*Heloísa/.test(modal.innerHTML.replace(/\n/g, ' ')) || /Heloísa/.test(modal.innerHTML), 'mostra quem sai');
    assert.ok(/Carla/.test(modal.innerHTML), 'mostra quem entra (Carla)');
    assert.ok(/rodízio \(dias\)/.test(modal.innerHTML), 'o MOTIVO do movimento aparece na prévia — "por que essa pessoa?"');
    assert.ok(!/2026-09-19/.test(modal.innerHTML), 'a data não aparece crua (ISO) — passou por fmtDataLonga');
    assert.ok(/19 de setembro|19\/09/.test(modal.innerHTML) || /setembro/i.test(modal.innerHTML), 'a data aparece formatada por extenso');
    assert.ok(/Aplicar estas mudanças/.test(modal.innerHTML), 'o botão de aplicar está na prévia');
    passou('a prévia desenha do clique ao HTML, com o motivo de cada movimento visível');
  }

  // ── 2. aplicar usa o MESMO plano — nunca uma segunda montagem ───────────
  {
    const scales = [
      escala('s1', '2026-09-05', 'hel', 'lote1', false),
      escala('s2', '2026-09-19', 'hel', 'lote1', false),
      escala('s3', '2026-10-03', 'bru', 'lote1', false),
    ];
    const { sandbox, state } = novoSandbox();
    baseState(sandbox, scales, 'lote1');
    state.promptReturn = '1';

    await sandbox.abrirAjusteFrequencia('hel');
    const movsDaPrevia = plano(sandbox.EscalaSmartState._planoAjuste.plano.movimentos);
    assert.strictEqual(state.planejarCalls.length, 1, 'planejar rodou 1 vez ao abrir a prévia');

    await sandbox.aplicarAjusteFrequencia();

    assert.strictEqual(state.planejarCalls.length, 1,
      'planejar CONTINUA em 1 chamada depois de aplicar — "Aplicar" não remontou o plano');
    assert.strictEqual(state.aplicarCalls.length, 1, 'ScaleService.aplicarRebalanceamento foi chamado 1 vez');
    assert.deepStrictEqual(plano(state.aplicarCalls[0].args.movimentos), movsDaPrevia,
      'os movimentos mandados pro serviço são BYTE A BYTE os mesmos que a prévia desenhou');
    assert.strictEqual(state.aplicarCalls[0].args.pessoaId, 'hel', 'pessoaId correto');
    assert.strictEqual(state.aplicarCalls[0].args.de, 2, 'de=2 (o valor antes do ajuste)');
    assert.strictEqual(state.aplicarCalls[0].args.para, 1, 'para=1 (o alvo digitado)');
    assert.strictEqual(state.loadBaseCalls, 1, 'depois de aplicar, a base é recarregada');
    assert.strictEqual(state.renderCalls, 1, 'depois de aplicar, a tela é redesenhada');
    assert.strictEqual(sandbox.EscalaSmartState._planoAjuste, null, 'o plano guardado é limpo depois de aplicar');
    passou('aplicar usa o MESMO plano da prévia — não existe segunda montagem que possa divergir');
  }

  // ── 3. data NÃO publicada: aplicados mas ninguém do time é avisado ──────
  // (avisar só carrega quem estava em data JÁ publicada — Task 19). A gestão
  // é avisada de qualquer forma, porque algo mudou.
  {
    const scales = [
      escala('s1', '2026-09-05', 'hel', 'lote1', false),
      escala('s2', '2026-09-19', 'hel', 'lote1', false),
      escala('s3', '2026-10-03', 'bru', 'lote1', false),
    ];
    const { sandbox, state } = novoSandbox();
    baseState(sandbox, scales, 'lote1');
    state.promptReturn = '1';

    await sandbox.abrirAjusteFrequencia('hel');
    await sandbox.aplicarAjusteFrequencia();

    const paraParticipantes = state.notifySendCalls.filter(c => c.recipients.some(r => r === 'u_hel' || r === 'u_car'));
    assert.strictEqual(paraParticipantes.length, 0, 'data não publicada: Heloísa e Carla NÃO recebem aviso (ainda não podiam ver a escala)');
    const paraGestao = state.notifySendCalls.filter(c => c.recipients.includes('u_admin'));
    assert.strictEqual(paraGestao.length, 1, 'mesmo sem data publicada, a GESTÃO é avisada — algo mudou de verdade');
    assert.strictEqual(state.resolveManagementCalls, 1, 'resolveManagementUserIds foi consultado');
    passou('data não publicada: só a gestão é avisada, o time fica de fora (não podia ver mesmo)');
  }

  // ── 4. data PUBLICADA: os dois envolvidos E a gestão são avisados ───────
  {
    const scales = [escala('sp', '2026-09-05', 'hel', 'loteP', true)];
    const { sandbox, state } = novoSandbox();
    baseState(sandbox, scales, 'loteP');
    state.promptReturn = '0';   // alvo = 0: tira Heloísa do único sábado

    await sandbox.abrirAjusteFrequencia('hel');
    const st = sandbox.EscalaSmartState._planoAjuste;
    assert.strictEqual(st.plano.movimentos.length, 1, 'achou 1 movimento (Carla ou Bruno entra)');
    assert.strictEqual(st.plano.movimentos[0].published, true, 'o movimento é numa data JÁ publicada');

    await sandbox.aplicarAjusteFrequencia();

    const saiu = state.notifySendCalls.find(c => /saiu de um dia/.test(c.title));
    const entrou = state.notifySendCalls.find(c => /entrou em um dia/.test(c.title));
    assert.ok(saiu && saiu.recipients.includes('u_hel'), 'Heloísa (quem saiu) recebe o aviso');
    assert.ok(entrou, 'quem entrou recebe o aviso');
    const paraGestao = state.notifySendCalls.filter(c => c.recipients.includes('u_admin'));
    assert.strictEqual(paraGestao.length, 1, 'a gestão também é avisada');
    assert.ok(/em data já publicada/.test(paraGestao[0].body), 'o aviso da gestão MENCIONA que foi em data já publicada');
    assert.strictEqual(state.notifySendCalls.length, 3, 'exatamente 3 avisos: quem saiu, quem entrou, a gestão');
    passou('data já publicada: quem sai, quem entra E a gestão são avisados — decisão do Rafael honrada');
  }

  // ── 5. falha de resolveManagementUserIds NÃO vira silêncio ──────────────
  {
    const scales = [
      escala('s1', '2026-09-05', 'hel', 'lote1', false),
      escala('s2', '2026-09-19', 'hel', 'lote1', false),
      escala('s3', '2026-10-03', 'bru', 'lote1', false),
    ];
    const { sandbox, state } = novoSandbox();
    baseState(sandbox, scales, 'lote1');
    state.promptReturn = '1';
    state.resolveManagementReturn = { success: false, error: 'Firestore explodiu', data: [] };

    await sandbox.abrirAjusteFrequencia('hel');
    await sandbox.aplicarAjusteFrequencia();

    assert.strictEqual(state.resolveManagementCalls, 1, 'resolveManagementUserIds foi chamado');
    const paraGestao = state.notifySendCalls.filter(c => (c.recipients || []).length && c.title === 'Escala ajustada');
    assert.strictEqual(paraGestao.length, 0, 'sem saber quem é a gestão, NINGUÉM da gestão recebe notificação (não inventa destinatário)');
    assert.ok(state.consoleErrors.length > 0, 'a falha foi logada — não desapareceu silenciosamente');
    const ultimoToast = state.toastCalls[state.toastCalls.length - 1];
    assert.strictEqual(ultimoToast.type, 'error', 'o toast final avisa que algo falhou, não "sucesso"');
    assert.ok(/gest/i.test(ultimoToast.msg), 'o toast MENCIONA que a gestão não pôde ser avisada — o operador fica sabendo');
    passou('resolveManagementUserIds falhando NÃO vira "gestão sem ninguém" em silêncio — loga e avisa o operador');
  }

  // ── 6. alvo inválido não faz nada ────────────────────────────────────────
  {
    const scales = [escala('s1', '2026-09-05', 'hel', 'lote1', false)];
    const casos = ['-1', 'abc', '', '  '];
    for (const entrada of casos) {
      const { sandbox, state } = novoSandbox();
      baseState(sandbox, scales, 'lote1');
      state.promptReturn = entrada;

      await sandbox.abrirAjusteFrequencia('hel');

      assert.strictEqual(state.planejarCalls.length, 0, `alvo "${entrada}": ScaleRebalance.planejar NUNCA foi chamado`);
      assert.strictEqual(sandbox.EscalaSmartState._planoAjuste, undefined, `alvo "${entrada}": nenhum plano ficou guardado`);
      const ultimo = state.toastCalls[state.toastCalls.length - 1];
      assert.ok(ultimo && ultimo.type === 'error', `alvo "${entrada}": toast de erro`);
    }
    passou('alvo inválido (negativo, texto, vazio) não monta plano nenhum — só avisa e para');

    // cancelar o prompt (Escape/Cancelar = null) também não faz nada
    const { sandbox, state } = novoSandbox();
    baseState(sandbox, scales, 'lote1');
    state.promptReturn = null;
    await sandbox.abrirAjusteFrequencia('hel');
    assert.strictEqual(state.planejarCalls.length, 0, 'cancelar o prompt não monta plano nenhum');
    passou('cancelar o prompt (null) sai sem montar nada');
  }

  // ── 7. sem janela aberta, nem chega a perguntar o alvo ───────────────────
  {
    const { sandbox, state } = novoSandbox();
    baseState(sandbox, [], null);   // janelaPorTipo.sabado.id = null

    await sandbox.abrirAjusteFrequencia('hel');

    assert.strictEqual(state.promptCalls.length, 0, 'sem janela, nem pergunta o alvo — nem chega no prompt');
    assert.strictEqual(state.planejarCalls.length, 0, 'sem janela, planejar não roda');
    const ultimo = state.toastCalls[state.toastCalls.length - 1];
    assert.ok(ultimo && /janela/i.test(ultimo.msg) && ultimo.type === 'error', 'toast explica que falta abrir uma janela');
    passou('sem janela aberta, avisa e para antes de perguntar o alvo');
  }

  // ── 7a2. sábado que JÁ ACONTECEU não entra no ajuste ─────────────────────
  // Achado clicando no staging em 29/08/2026: o rebalanceio propunha trocar o
  // professor do sábado 15/08 — duas semanas depois de a aula ter sido dada.
  // Republicar recria as aulas, e uma já realizada voltaria pra prevista.
  // E o "Hoje: X" tem que contar as MESMAS datas que o motor vê, senão a tela
  // diz 2 e o motor trabalha com 1.
  {
    const scales = [
      escala('sPass', '2026-08-15', 'hel', 'lote1', false),   // já passou
      escala('sFut', '2026-09-05', 'hel', 'lote1', false),    // ainda vem
    ];
    const { sandbox, state } = novoSandbox();
    baseState(sandbox, scales, 'lote1');
    state.promptReturn = '0';

    await sandbox.abrirAjusteFrequencia('hel');

    const datas = state.planejarCalls[0].datas.map(d => d.date);
    assert.deepStrictEqual(datas, ['2026-09-05'], 'a data que já passou não é oferecida ao motor');
    assert.ok(/Hoje: 1/.test(state.promptCalls[0].msg),
      'e o "Hoje" conta só o que ainda não aconteceu — mesmo número que o motor usa');
    passou('sábado que já aconteceu fica de fora do ajuste, e a conta bate com o motor');
  }

  // ── 7a3. janela inteira no passado: avisa e para ─────────────────────────
  {
    const scales = [escala('sPass', '2026-08-15', 'hel', 'lote1', false)];
    const { sandbox, state } = novoSandbox();
    baseState(sandbox, scales, 'lote1');
    state.promptReturn = '0';

    await sandbox.abrirAjusteFrequencia('hel');

    assert.strictEqual(state.promptCalls.length, 0, 'nem chega a perguntar o alvo');
    assert.strictEqual(state.planejarCalls.length, 0, 'e não monta plano nenhum');
    const ultimo = state.toastCalls[state.toastCalls.length - 1];
    assert.ok(ultimo && /já aconteceram/.test(ultimo.msg) && ultimo.type === 'error', 'explica o porquê');
    passou('janela toda no passado avisa e para, em vez de montar plano vazio');
  }

  // ── 7b. "não posso" é restrição DURA e chega ao motor ────────────────────
  // O motor já tinha o filtro, mas a tela nunca preenchia o campo — a regra
  // existia e não valia. Aqui a prova é ponta a ponta: quem respondeu
  // "não posso" numa data entra como INDISPONÍVEL naquela data, junto com
  // férias, e o motor não o escala.
  {
    const scales = [
      escala('s1', '2026-09-05', 'hel', 'lote1', false),
      escala('s2', '2026-09-19', 'car', 'lote1', false),
      escala('s3', '2026-10-03', 'bru', 'lote1', false),
    ];
    const { sandbox, state, setPrefs } = novoSandbox();
    baseState(sandbox, scales, 'lote1');
    state.promptReturn = '2';
    setPrefs({ [scales[0].id]: [{ personId: 'car', pref: 'nao_posso' }] });

    await sandbox.abrirAjusteFrequencia('hel');

    const cands = state.planejarCalls[0].candidatos;
    const car = cands.find(c => c.id === 'car');
    assert.ok(car.indisponivel.indexOf(scales[0].date) !== -1,
      'quem respondeu "não posso" naquela data vai como indisponível NELA');
    const outra = scales[1] && scales[1].date;
    if (outra) assert.ok(car.indisponivel.indexOf(outra) === -1,
      'e continua disponível nas outras datas — "não posso no dia 12" não barra o dia 26');
    passou('"não posso" chega ao motor como indisponibilidade por data');
  }

  // ── 7c. falha ao ler as respostas cancela, não escala às cegas ───────────
  {
    const scales = [escala('s1', '2026-09-05', 'hel', 'lote1', false)];
    const { sandbox, state, setPrefsFalham } = novoSandbox();
    baseState(sandbox, scales, 'lote1');
    state.promptReturn = '2';
    setPrefsFalham(true);

    await sandbox.abrirAjusteFrequencia('hel');

    assert.strictEqual(state.planejarCalls.length, 0,
      'não dá pra montar plano sem saber quem disse que não podia');
    const ultimo = state.toastCalls[state.toastCalls.length - 1];
    assert.ok(ultimo && ultimo.type === 'error', 'e a gestão é avisada, em vez de receber uma escala silenciosamente errada');
    passou('falha ao ler as respostas cancela o ajuste, não escala às cegas');
  }

  // ── 8. renderEquilibrioPainel e renderTabPorPessoa têm o botão pendurado ──
  {
    const scales = [escala('s1', '2026-09-05', 'hel', 'lote1', false)];
    const { sandbox } = novoSandbox();
    baseState(sandbox, scales, 'lote1');
    sandbox.EscalaSmartState.modToi = { id: 'TOI' };
    sandbox.EscalaSmartState.modHiit = { id: 'HIIT' };

    const htmlPainel = sandbox.renderEquilibrioPainel();
    assert.ok(/onclick="abrirAjusteFrequencia\('hel'\)"/.test(htmlPainel), 'o painel de Equilíbrio tem o botão Ajustar por pessoa, chamando abrirAjusteFrequencia');
    passou('renderEquilibrioPainel pendura o botão Ajustar em cada linha');

    sandbox.EscalaSmartState.pessoaSel = 'hel';
    const htmlPessoa = sandbox.renderTabPorPessoa();
    // Um botão por cartão, com o tipo EXPLÍCITO: nesta aba `tab` não vale
    // 'sabado' nem 'feriado', então um botão só cairia no default e ajustaria
    // sábados mesmo quem estivesse olhando o cartão de feriados.
    assert.ok(/onclick="abrirAjusteFrequencia\('hel', 'sabado'\)"/.test(htmlPessoa), 'o cartão de sábados ajusta SÁBADOS');
    assert.ok(/onclick="abrirAjusteFrequencia\('hel', 'feriado'\)"/.test(htmlPessoa), 'o cartão de feriados ajusta FERIADOS');
    passou('cada cartão da aba Por pessoa ajusta a sua própria fila');
  }

  // ── 9. Fim de ano: o rebalanceio enxerga o período (Task 22) ────────────
  // Uma escala de fim de ano é UM documento com vários dias — nada de
  // windowBatchId, nada de `c.janela`. `abrirAjusteFrequencia` precisa contar
  // e montar `datas` a partir do PRÓPRIO documento quando `tab==='fim_de_ano'`.
  {
    const fda = {
      id: 'fda1', tipo: 'fim_de_ano', status: 'consolidada', published: false,
      slots: [
        { id: 's_20_m', day: '2026-12-20', shift: 'manha', unitId: 'cp', requiredModalityId: null, assignedPersonId: 'hel' },
        { id: 's_27_m', day: '2026-12-27', shift: 'manha', unitId: 'cp', requiredModalityId: null, assignedPersonId: 'hel' },
      ],
    };
    // Lote de SÁBADO aberto, com cota pra Heloísa — sem nenhuma relação com o
    // fim de ano. Prova que essa cota não vaza pro rebalanceio do período.
    const { sandbox, state } = novoSandbox();
    sandbox.ScaleService.listWindowQuotas = async () => ({ success: true, data: { hel: 0 } });
    baseState(sandbox, [fda], 'lote_sabado_alheio');
    sandbox.EscalaSmartState.tab = 'fim_de_ano';
    sandbox.EscalaSmartState.selectedId = 'fda1';
    state.promptReturn = '1';   // Heloísa tem 2 dias no período; alvo 1

    await sandbox.abrirAjusteFrequencia('hel');

    assert.strictEqual(state.promptCalls[0].def, '2', 'o prompt mostra 2 (contado do PERÍODO, não de c.janela — que é 0)');
    assert.strictEqual(state.planejarCalls.length, 1, 'planejar rodou com os dados do período');
    const args = state.planejarCalls[0];
    assert.strictEqual(args.datas.length, 2, 'as duas datas do período entraram, uma por dia');
    assert.ok(args.datas.every(d => d.scaleId === 'fda1'), 'todas as datas apontam pro MESMO documento (o período)');
    const helCand = args.candidatos.find(c => c.id === 'hel');
    assert.strictEqual(helCand.dias, 2, 'a contagem de dias de Heloísa vem do período (2), não de c.janela (0)');
    // A cota `hel: 0` só existe no mock de `listWindowQuotas` do lote de
    // sábado alheio — se o guard da cota falhasse, ela vazaria pro fim de ano
    // e barraria Heloísa (cota 0 = não pode mais nenhum dia).
    assert.strictEqual(helCand.cota, null, 'a cota do lote de sábado alheio NÃO vaza pro fim de ano');

    const st = sandbox.EscalaSmartState._planoAjuste;
    assert.ok(st && st.plano.movimentos.length >= 1, 'achou pelo menos 1 movimento pra baixar Heloísa de 2 para 1');
    assert.ok(st.plano.movimentos.every(mv => mv.scaleId === 'fda1'), 'o(s) movimento(s) ficam DENTRO do período de fim de ano');
    passou('fim de ano: datas e contagem vêm do período inteiro, e a cota de um lote alheio não vaza');
  }

  // ── 9b. Fim de ano sem período selecionado: avisa e para ────────────────
  {
    const { sandbox, state } = novoSandbox();
    baseState(sandbox, [], null);   // nem lote de sábado, nem escala de fim de ano nenhuma
    sandbox.EscalaSmartState.tab = 'fim_de_ano';
    sandbox.EscalaSmartState.selectedId = null;

    await sandbox.abrirAjusteFrequencia('hel');

    assert.strictEqual(state.promptCalls.length, 0, 'sem período selecionado, nem chega a perguntar o alvo');
    assert.strictEqual(state.planejarCalls.length, 0, 'planejar não roda');
    const ultimo = state.toastCalls[state.toastCalls.length - 1];
    assert.ok(ultimo && /período/i.test(ultimo.msg) && ultimo.type === 'error', 'toast pede pra selecionar o período primeiro');
    passou('fim de ano sem período selecionado: avisa e para antes do prompt');
  }

  // ── 9c. renderFimDeAnoDetail: a barra "ainda não publicado" (Task 22) ────
  {
    const { sandbox } = novoSandbox();
    const base = {
      id: 'fda1', name: 'Fim de ano 2026',
      slots: [{ id: 's1', day: '2026-12-20', shift: 'manha', unitId: 'cp', requiredModalityId: null, assignedPersonId: null }],
    };
    sandbox.EscalaSmartState.units = [{ id: 'cp', name: 'CrossTainer CP' }];
    sandbox.EscalaSmartState.teacherMap = teachers3();

    const rascunho = sandbox.renderFimDeAnoDetail(Object.assign({}, base, { status: 'rascunho', published: false }));
    assert.ok(!/ainda não publicado/.test(rascunho), 'rascunho: sem barra amarela (nada foi consolidado ainda)');
    assert.ok(!/Publicar/.test(rascunho), 'rascunho: sem botão de publicar nenhum');
    passou('renderFimDeAnoDetail: rascunho não mostra barra nem botão de publicar');

    const montado = sandbox.renderFimDeAnoDetail(Object.assign({}, base, { status: 'consolidada', published: false }));
    assert.ok(/ainda não publicado/.test(montado), 'consolidada e não publicada: mostra a barra amarela');
    assert.ok(/Publicar os 1 dias na agenda/.test(montado), 'a barra mostra a contagem certa de dias e o botão');
    assert.ok(/onclick="publicarEscala\('fda1'\)"/.test(montado), 'o botão da barra chama publicarEscala com o id certo');
    passou('renderFimDeAnoDetail: consolidada e não publicada mostra a barra com o número de dias');

    const publicada = sandbox.renderFimDeAnoDetail(Object.assign({}, base, { status: 'consolidada', published: true }));
    assert.ok(!/ainda não publicado/.test(publicada), 'já publicada: some a barra amarela');
    assert.ok(/publicada na agenda/.test(publicada), 'já publicada: mostra o selo de publicada');
    assert.ok(/onclick="despublicarEscala\('fda1'\)"/.test(publicada), 'já publicada: mostra o botão de despublicar');
    passou('renderFimDeAnoDetail: já publicada esconde a barra e mostra despublicar');
  }

  console.log(`\n${ok} blocos OK`);
  console.log('\n✓ smoke-escala-rebalanceio-tela: todas as seções OK');
})().catch(e => { console.error('❌', e.message, '\n', e.stack); process.exit(1); });
