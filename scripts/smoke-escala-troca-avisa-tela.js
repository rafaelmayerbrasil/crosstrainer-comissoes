'use strict';
// Roda: node scripts/smoke-escala-troca-avisa-tela.js
process.env.TZ = 'America/Sao_Paulo';
//
// A TELA da troca na mão (grupo da gestão, 01/10/2026). Em set/out de 2026 a
// gestão pôs três vezes numa vaga alguém que tinha marcado "Não posso" — a
// lista mostrava todo mundo igual — e nenhuma das pessoas trocadas foi avisada:
// "Última vez que olhei, eu tava escalado pro dia 26. Quando preenchi,
// coloquei lá que não podia dia 12."
//
// Carrega professores-escala-smart.js DE VERDADE num sandbox `vm` e CHAMA as
// funções (cicatriz da "prévia que nunca rodou", 24/08/2026). As contas puras
// são as do scale-service.js real — só o que fala com o banco é espião.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SS = require('../scale-service.js');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };
const src = fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8');

function novoSandbox() {
  const els = {};
  const el = (id) => (els[id] = els[id] || { style: {}, innerHTML: '', value: '' });
  const state = {
    toasts: [], confirms: [], confirmReturn: true,
    reassign: [], swap: [], publish: [], sends: [], saves: [], audits: [],
    prefs: {}, prefsFalham: false, published: false,
    loadBase: 0, render: 0,
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document: { getElementById: el },
    setTimeout, clearTimeout, Date, Math, JSON, Promise, Set, Map, Array, Object, String, Number,
    toast: (msg, type) => { state.toasts.push({ msg, type }); },
    confirm: (msg) => { state.confirms.push(msg); return state.confirmReturn; },
    ajudaBtn: () => '',
    isAdminGestao: () => true,
    AppState: { userProfile: {} },
    AuditService: { log: async (o) => { state.audits.push(o); } },
    ScaleService: Object.assign({}, SS, {
      listPreferences: async (scaleId) => (state.prefsFalham
        ? { success: false, error: 'boom' }
        : { success: true, data: Object.keys(state.prefs[scaleId] || {}).map(pid => ({ personId: pid, pref: state.prefs[scaleId][pid] })) }),
      reassignSlot: async (...a) => { state.reassign.push(JSON.parse(JSON.stringify(a))); return { success: true, data: { changed: true, published: state.published } }; },
      swapSlots: async (...a) => { state.swap.push(a); return { success: true, data: { published: state.published } }; },
      publishToAgenda: async (id) => { state.publish.push(id); return { success: true, data: { created: 4 } }; },
      ScaleConfigService: {
        get: async () => ({ success: true, data: { horarios: {} } }),
        save: async (p) => { state.saves.push(JSON.parse(JSON.stringify(p))); return { success: true }; },
      },
    }),
    NotifyService: { send: async (o) => { state.sends.push(JSON.parse(JSON.stringify(o))); return { success: true }; } },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'professores-escala-smart.js' });
  vm.runInContext('this.EscalaSmartState = EscalaSmartState;', sandbox);
  sandbox.escalaLoadBase = async () => { state.loadBase++; };
  sandbox.renderEscalaGestao = () => { state.render++; };
  sandbox.escalaTodayISO = () => '2026-08-31';   // "hoje" fixo: as datas de setembro são futuro
  return { sandbox, state, els };
}

const vaga = (id, unitId, mod, pid) => ({ id, unitId, requiredModalityId: 'TOI', requiredModalityName: mod, assignedPersonId: pid || null, startTime: '08:00', endTime: '12:00' });
const sab = (id, date, pid) => ({ id, date, tipo: 'sabado', status: 'consolidada', published: true, slots: [vaga('pp_TOI', 'pp', 'TOI', pid)] });
function cenario(sandbox) {
  const dia12 = { id: 'd12', date: '2026-09-12', tipo: 'sabado', status: 'consolidada', published: true,
    slots: [vaga('pp_TOI', 'pp', 'TOI', 'joao'), vaga('cp_TOI', 'cp', 'TOI', 'carla')] };
  const st = sandbox.EscalaSmartState;
  st.scales = [dia12, sab('d05', '2026-09-05', 'theo'), sab('d19', '2026-09-19', 'bruno'), sab('d26', '2026-09-26', 'alan')];
  st.units = [{ id: 'pp', name: 'CrossTainer Príncipe' }, { id: 'cp', name: 'CrossTainer Campeche' }];
  st.modToi = { id: 'TOI', name: 'TOI' }; st.modHiit = { id: 'HIIT', name: 'Hiit' };
  st.config = {};
  const t = (id, name, userId) => [id, { id, name, userId: userId === undefined ? 'u_' + id : userId, isActive: true, modalityIds: ['TOI'] }];
  st.teacherMap = new Map([t('joao', 'João Vitor'), t('carla', 'Carla Fanti'), t('alan', 'Alan Brito'),
    t('theo', 'Theo Rosa'), t('bruno', 'Bruno Claudino'), t('livre', 'Fulano Livre'), t('semlogin', 'Sem Login', null)]);
  return dia12;
}
const PREFS = { d12: { alan: 'nao_posso', bruno: 'prefiro' } };
/** O texto da <option> desta pessoa dentro do seletor desta vaga. */
function opcao(html, slotId, pid) {
  const ini = html.indexOf(`trocarPessoaEscala('d12','${slotId}'`);
  assert.ok(ini !== -1, `seletor da vaga ${slotId} não foi desenhado`);
  const sel = html.slice(ini, html.indexOf('</select>', ini));
  const m = sel.match(new RegExp(`<option value="${pid}"[^>]*>([^<]*)</option>`));
  assert.ok(m, `opção de ${pid} não está no seletor de ${slotId}`);
  return { texto: m[1], pos: sel.indexOf(`<option value="${pid}"`) };
}

(async () => {
  /* ── 1. A lista de troca mostra a situação de cada um ──────────────── */
  {
    const { sandbox } = novoSandbox();
    const dia12 = cenario(sandbox);
    sandbox.EscalaSmartState.prefsSel = { scaleId: 'd12', prefById: PREFS.d12 };
    const html = sandbox.renderEscalaDetail(dia12);
    assert.ok(/marcou Não posso/.test(opcao(html, 'pp_TOI', 'alan').texto), 'Alan aparece como quem marcou "Não posso"');
    assert.ok(/05\/09/.test(opcao(html, 'pp_TOI', 'theo').texto), 'Theo: trabalhou o sábado anterior (05/09)');
    assert.ok(/19\/09/.test(opcao(html, 'pp_TOI', 'bruno').texto), 'Bruno: trabalha o sábado seguinte (19/09)');
    assert.ok(/outra vaga/.test(opcao(html, 'pp_TOI', 'carla').texto), 'Carla já está em outra vaga do dia');
    assert.strictEqual(opcao(html, 'pp_TOI', 'livre').texto, 'Fulano Livre', 'quem está livre aparece só com o nome');
    assert.strictEqual(opcao(html, 'pp_TOI', 'joao').texto, 'João Vitor', 'quem já está NESTA vaga não ganha aviso');
    assert.ok(!/26\/09/.test(opcao(html, 'pp_TOI', 'alan').texto), 'com 1 sábado de folga, o 26/09 do Alan (14 dias) não é aviso');
    const pos = (pid) => opcao(html, 'pp_TOI', pid).pos;
    assert.ok(pos('livre') < pos('theo') && pos('theo') < pos('alan'),
      'ordem: quem está livre primeiro, quem tem aviso depois, quem marcou "Não posso" por último');
    passou('a lista de troca mostra quem marcou "Não posso", quem trabalha perto e quem já está no dia');

    sandbox.EscalaSmartState.config = { folgaMinimaSabados: 2 };
    assert.ok(/26\/09/.test(opcao(sandbox.renderEscalaDetail(dia12), 'pp_TOI', 'alan').texto),
      'com folga de 2 sábados, o 26/09 do Alan passa a aparecer');
    passou('a lista obedece a folga configurada');

    // Respostas de OUTRA escala não podem vazar para esta.
    sandbox.EscalaSmartState.prefsSel = { scaleId: 'outra', prefById: { livre: 'nao_posso' } };
    assert.strictEqual(opcao(sandbox.renderEscalaDetail(dia12), 'pp_TOI', 'livre').texto, 'Fulano Livre',
      '"Não posso" carregado de outra escala não marca ninguém nesta');
    passou('respostas de outra escala não vazam para a lista');
  }

  /* ── 2. Escolher quem marcou "Não posso" pergunta antes ────────────── */
  {
    const { sandbox, state } = novoSandbox();
    cenario(sandbox); state.prefs = PREFS; state.confirmReturn = false;
    await sandbox.trocarPessoaEscala('d12', 'pp_TOI', 'alan');
    assert.strictEqual(state.confirms.length, 1, 'perguntou uma vez');
    assert.ok(/Alan Brito/.test(state.confirms[0]) && /Não posso/.test(state.confirms[0]), 'a pergunta diz quem e por quê: ' + state.confirms[0]);
    assert.strictEqual(state.reassign.length, 0, 'gestão desistiu: a vaga NÃO foi trocada');
    assert.strictEqual(state.sends.length, 0, 'e ninguém foi avisado de nada');
    assert.ok(state.render >= 1, 'a tela é redesenhada, senão o seletor fica mostrando o Alan');
    passou('"Não posso" + cancelar: nada muda');
  }
  {
    const { sandbox, state } = novoSandbox();
    cenario(sandbox); state.prefs = PREFS; state.confirmReturn = true;
    await sandbox.trocarPessoaEscala('d12', 'pp_TOI', 'alan');
    assert.strictEqual(state.reassign.length, 1, 'gestão confirmou (combinou por fora): troca feita');
    assert.deepStrictEqual(state.reassign[0].slice(0, 3), ['d12', 'pp_TOI', 'alan']);
    passou('"Não posso" + confirmar: a troca acontece');
  }

  /* ── 3. Data vizinha também pergunta; quem está livre, não ─────────── */
  {
    const { sandbox, state } = novoSandbox();
    cenario(sandbox); state.prefs = PREFS; state.confirmReturn = false;
    await sandbox.trocarPessoaEscala('d12', 'pp_TOI', 'theo');
    assert.strictEqual(state.confirms.length, 1);
    assert.ok(/Theo Rosa/.test(state.confirms[0]) && /05\/09/.test(state.confirms[0]), 'diz com qual data fica seguido: ' + state.confirms[0]);
    assert.strictEqual(state.reassign.length, 0);

    await sandbox.trocarPessoaEscala('d12', 'pp_TOI', 'livre');
    assert.strictEqual(state.confirms.length, 1, 'pessoa livre: nenhuma pergunta nova');
    assert.strictEqual(state.reassign.length, 1, 'e a troca vai direto');

    await sandbox.trocarPessoaEscala('d12', 'pp_TOI', '');
    assert.strictEqual(state.confirms.length, 1, 'esvaziar a vaga não pergunta nada');
    assert.strictEqual(state.reassign.length, 2);
    passou('data vizinha pergunta; pessoa livre e vaga esvaziada passam direto');
  }
  {
    const { sandbox, state } = novoSandbox();
    cenario(sandbox); state.prefs = PREFS; state.confirmReturn = false;
    sandbox.EscalaSmartState.config = { folgaMinimaSabados: 2 };
    await sandbox.trocarPessoaEscala('d12', 'pp_TOI', 'alan');
    assert.ok(/Não posso/.test(state.confirms[0]) && /26\/09/.test(state.confirms[0]),
      'os dois motivos na MESMA pergunta (uma só, não duas): ' + state.confirms[0]);
    assert.strictEqual(state.confirms.length, 1);
    passou('dois motivos viram uma pergunta só, e a folga configurada vale aqui também');
  }

  /* ── 4. Sem conseguir ler as respostas, não troca ──────────────────── */
  {
    const { sandbox, state } = novoSandbox();
    cenario(sandbox); state.prefsFalham = true;
    await sandbox.trocarPessoaEscala('d12', 'pp_TOI', 'livre');
    assert.strictEqual(state.reassign.length, 0, 'falhar em silêncio escalaria quem disse que não podia');
    assert.ok(state.toasts.some(t => t.type === 'error'), 'e a gestão fica sabendo por quê');
    passou('leitura das respostas falhou: a troca é cancelada com aviso');
  }

  /* ── 5. Escala publicada: quem entrou e quem saiu são avisados ─────── */
  {
    const { sandbox, state } = novoSandbox();
    cenario(sandbox); state.prefs = PREFS; state.published = true;
    await sandbox.trocarPessoaEscala('d12', 'pp_TOI', 'livre');
    assert.deepStrictEqual(state.publish, ['d12'], 'a agenda é republicada, como sempre foi');
    assert.strictEqual(state.sends.length, 2, 'dois avisos: um pra quem entrou, um pra quem saiu');
    const entrou = state.sends.find(s => s.recipients[0] === 'u_livre');
    const saiu = state.sends.find(s => s.recipients[0] === 'u_joao');
    assert.ok(entrou && saiu, 'cada aviso vai pro login certo');
    assert.strictEqual(entrou.type, 'scale_confirmed', 'tipo que também vira e-mail');
    assert.ok(/12\/09\/2026/.test(entrou.body) && /Príncipe/.test(entrou.body) && /08:00/.test(entrou.body) && /TOI/.test(entrou.body),
      'quem entrou recebe data, unidade, horário e modalidade: ' + entrou.body);
    assert.ok(!/CrossTainer/.test(entrou.body), 'a unidade vai sem o prefixo da marca');
    assert.ok(/12\/09\/2026/.test(saiu.body) && /Fulano Livre/.test(saiu.body), 'quem saiu sabe de que dia e quem entrou: ' + saiu.body);
    assert.ok(state.toasts.some(t => /2 aviso/.test(t.msg)), 'a gestão vê que os avisos saíram');
    passou('troca em escala publicada avisa quem entrou e quem saiu');
  }
  {
    const { sandbox, state } = novoSandbox();
    cenario(sandbox); state.prefs = PREFS; state.published = false;
    await sandbox.trocarPessoaEscala('d12', 'pp_TOI', 'livre');
    assert.strictEqual(state.sends.length, 0, 'antes de publicar o professor não vê a escala — avisar seria vazar a prévia');
    passou('escala não publicada: nenhum aviso');
  }
  {
    const { sandbox, state } = novoSandbox();
    cenario(sandbox); state.prefs = PREFS; state.published = true;
    sandbox.escalaTodayISO = () => '2026-09-20';   // o dia 12 já passou
    await sandbox.trocarPessoaEscala('d12', 'pp_TOI', 'livre');
    assert.strictEqual(state.sends.length, 0, 'corrigir o registro de um dia que já aconteceu não manda e-mail pra ninguém');
    passou('data que já passou: nenhum aviso');
  }
  {
    const { sandbox, state } = novoSandbox();
    cenario(sandbox); state.prefs = PREFS; state.published = true;
    await sandbox.trocarPessoaEscala('d12', 'pp_TOI', 'semlogin');
    assert.strictEqual(state.sends.length, 1, 'só quem tem login recebe (o João, que saiu)');
    assert.ok(state.toasts.some(t => /Sem Login/.test(t.msg) && /por fora/.test(t.msg)),
      'e a gestão é avisada de que precisa falar com a pessoa sem login por fora');
    passou('pessoa sem login: a gestão fica sabendo que tem que avisar por fora');
  }

  /* ── 6. Inverter duas vagas publicadas avisa os dois do novo posto ─── */
  {
    const { sandbox, state } = novoSandbox();
    cenario(sandbox); state.published = true;
    await sandbox.inverterVagasEscala('d12', 'pp_TOI', 'cp_TOI');
    assert.strictEqual(state.swap.length, 1);
    assert.strictEqual(state.sends.length, 2, 'os dois mudaram de unidade: os dois são avisados');
    const joao = state.sends.find(s => s.recipients[0] === 'u_joao');
    const carla = state.sends.find(s => s.recipients[0] === 'u_carla');
    assert.ok(/Campeche/.test(joao.body), 'João estava no Príncipe, vai pro Campeche: ' + joao.body);
    assert.ok(/Príncipe/.test(carla.body), 'Carla estava no Campeche, vai pro Príncipe: ' + carla.body);
    passou('inverter vagas em escala publicada avisa os dois do posto novo');
  }

  /* ── 7. Folga mínima na configuração ───────────────────────────────── */
  {
    const { sandbox, state } = novoSandbox();
    cenario(sandbox);
    sandbox.EscalaSmartState.config = { folgaMinimaSabados: 2 };
    const html = sandbox.renderConfigEscalaHtml();
    assert.ok(/id="escalaFolgaMinima"/.test(html), 'o campo existe');
    assert.ok(/<option value="2" selected>/.test(html), 'e abre no valor gravado');
    sandbox.EscalaSmartState.config = {};
    assert.ok(/<option value="1" selected>/.test(sandbox.renderConfigEscalaHtml()), 'sem configuração, mostra 1 (o comportamento de sempre)');

    sandbox.document.getElementById('escalaFolgaMinima').value = '3';
    state.confirmReturn = true;
    await sandbox.salvarFolgaMinima();
    assert.deepStrictEqual(state.saves, [{ folgaMinimaSabados: 3 }], 'grava o número, não o texto do <select>');
    assert.strictEqual(state.audits.length, 1, 'e fica no registro de auditoria');
    assert.ok(/3/.test(state.confirms[0]), 'a confirmação diz o que muda');

    sandbox.document.getElementById('escalaFolgaMinima').value = '9';
    await sandbox.salvarFolgaMinima();
    assert.strictEqual(state.saves.length, 1, 'valor fora de 1–3 não é gravado');
    passou('folga mínima: campo na configuração, salva número válido e registra');
  }

  console.log(`\n${ok} verificações ✓`);
})().catch(e => { console.error('✗', e.stack || e.message); process.exit(1); });
