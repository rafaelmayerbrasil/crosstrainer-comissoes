'use strict';
// Roda: node scripts/smoke-escala-por-que.js
process.env.TZ = 'America/Sao_Paulo';
//
// Rafael Rojais, grupo da gestão, 01/10/2026: "Sabe dizer porque o Vaguinho
// ficou com 2 sábados em outubro? Teria como o sistema explicar o porquê a
// pessoa está naquele dia!? … Normalmente era 1 sábado por mês."
//
// O motivo de cada vaga já era guardado (`reason` + `explain`), mas só a gestão
// via — numa tabela de pontos e contagens que não responde à pergunta. O
// professor não via nada. Aqui o motivo vira FRASE, e a frase vem com a conta
// do mês: quantas vagas existem pra quantas pessoas habilitadas. É essa conta
// que responde "por que 2 e não 1".
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SS = require('../scale-service.js');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

const nomePorId = { vag: 'VAGNER TEIXEIRA', thi: 'THIAGO VALENTIM', bru: 'BRUNO CLAUDINO' };
const vaga = (extra) => Object.assign({ id: 'pp_TOI', unitId: 'pp', requiredModalityId: 'TOI', requiredModalityName: 'TOI', assignedPersonId: 'vag' }, extra || {});
const escala = (extra) => Object.assign({ id: 'e1', date: '2026-10-03', tipo: 'sabado', published: true, slots: [], historico: [] }, extra || {});
const exp = (slot, scale, voce) => SS.explicarVaga({ scale: scale || escala(), slot, nomePorId, voce: voce !== false });

/* ── 1. Cada motivo vira uma frase ─────────────────────────────────── */
{
  const r = exp(vaga({ reason: 'justica', explain: [{ personId: 'vag', diasTrabalhados: 1 }, { personId: 'thi', diasTrabalhados: 3 }] }));
  assert.strictEqual(r.motivo, 'rodizio');
  assert.ok(/rodízio/i.test(r.texto) && /você/.test(r.texto) && /\b1\b/.test(r.texto) && /\b3\b/.test(r.texto),
    'rodízio: diz que foi a vez da pessoa e mostra os dois números: ' + r.texto);
  assert.ok(!/THIAGO/.test(r.texto), 'sem citar o nome de quem ficou atrás — a frase é sobre a pessoa, não sobre o colega');

  const semConta = exp(vaga({ reason: 'justica', explain: [] }));
  assert.ok(/rodízio/i.test(semConta.texto) && !/undefined|NaN/.test(semConta.texto), 'sem os números guardados, a frase não inventa nem quebra: ' + semConta.texto);
  passou('rodízio: "era a sua vez", com os números quando existem');

  const m = exp(vaga({ reason: 'merito', explain: [{ personId: 'vag', diasTrabalhados: 2, merito: 40 }, { personId: 'thi', diasTrabalhados: 2, merito: 10 }] }));
  assert.strictEqual(m.motivo, 'desempate');
  assert.ok(/empat/i.test(m.texto) && /pontos/i.test(m.texto) && /\b2\b/.test(m.texto), 'desempate: empate no rodízio, decidido pelos pontos: ' + m.texto);
  passou('desempate por pontos é dito como desempate, não como "mérito"');

  const c = exp(vaga({ reason: 'cota', explain: [] }));
  assert.strictEqual(c.motivo, 'cota');
  assert.ok(/já tinha|atingi|pediu/i.test(c.texto), 'cota: quem estava na frente já tinha o que pediu: ' + c.texto);
  passou('cota: a vaga veio porque quem estava na frente já tinha o que pediu');
}

/* ── 2. Escolha da gestão: diz QUEM e QUANDO, se o histórico souber ── */
{
  const comHist = escala({ historico: [
    { ts: '2026-08-31T11:29:16.852Z', nome: 'RODRIGO', acao: 'vaga_trocada', detalhe: 'saiu THEO ROSA, entrou THAYNARA SILVA (Hiit)' },
    { ts: '2026-09-03T12:37:40.551Z', nome: 'Rafael Rojais', acao: 'vaga_trocada', detalhe: 'saiu JOAO VITOR, entrou VAGNER TEIXEIRA (TOI)' },
  ] });
  const r = exp(vaga({ reason: 'manual' }), comHist);
  assert.strictEqual(r.motivo, 'gestao');
  assert.ok(/gestão/i.test(r.texto) && /Rafael Rojais/.test(r.texto) && /03\/09\/2026/.test(r.texto), 'diz quem trocou e em que dia: ' + r.texto);
  assert.ok(/não.*rodízio/i.test(r.texto), 'e deixa claro que não foi o rodízio');

  const semHist = exp(vaga({ reason: 'manual' }), escala());
  assert.ok(/gestão/i.test(semHist.texto) && !/undefined|null/.test(semHist.texto), 'troca antiga, sem histórico: diz que foi a gestão, sem inventar nome: ' + semHist.texto);

  const ajuste = exp(vaga({ reason: 'manual' }), escala({ historico: [
    { ts: '2026-09-10T15:00:00.000Z', nome: 'Benny', acao: 'rebalanceada', detalhe: 'LOUISE 3 → 2: saiu LOUISE, entrou VAGNER TEIXEIRA (TOI)' }] }));
  assert.ok(/ajust/i.test(ajuste.texto) && /Benny/.test(ajuste.texto), 'veio do botão Ajustar: ' + ajuste.texto);
  passou('escolha da gestão: quem, quando e por qual caminho — ou só "a gestão", sem inventar');

  const t = exp(vaga({ reason: 'troca' }), escala({ historico: [
    { ts: '2026-09-14T13:50:00.000Z', nome: 'Rafael Rojais', acao: 'troca_de_aula', detalhe: 'troca entre professores confirmada: saiu THIAGO VALENTIM, entrou VAGNER TEIXEIRA (TOI)' }] }));
  assert.strictEqual(t.motivo, 'troca');
  assert.ok(/troca entre professores/i.test(t.texto) && /THIAGO VALENTIM/.test(t.texto) && /14\/09\/2026/.test(t.texto), 'troca: com quem e quando foi confirmada: ' + t.texto);
  passou('troca entre professores: com quem e quando');

  const nada = exp(vaga({ reason: null }));
  assert.strictEqual(nada.motivo, 'desconhecido');
  assert.ok(nada.texto.length > 10 && !/undefined|null/.test(nada.texto), 'sem motivo guardado, diz isso: ' + nada.texto);
  passou('vaga sem motivo guardado diz que não há registro');

  const gestao = exp(vaga({ reason: 'justica', explain: [{ personId: 'vag', diasTrabalhados: 1 }, { personId: 'thi', diasTrabalhados: 3 }] }), escala(), false);
  assert.ok(/VAGNER TEIXEIRA/.test(gestao.texto) && !/você/i.test(gestao.texto), 'na tela da gestão a frase fala da pessoa pelo nome: ' + gestao.texto);
  passou('a mesma frase serve pra gestão, com o nome no lugar de "você"');
}

/* ── 3. A conta do mês: por que 2 e não 1 ──────────────────────────── */
{
  const toi = (id) => ({ id, name: id, isActive: true, modalityIds: ['TOI'] });
  const hiit = (id) => ({ id, name: id, isActive: true, modalityIds: ['HIIT'] });
  const pessoas = ['vag', 'thi', 'bru', 'a', 'b', 'c', 'd', 'e', 'f'].map(toi).concat(['x', 'h2'].map(hiit))
    .concat([{ id: 'yoga', name: 'y', isActive: true, modalityIds: ['YOGA'] }, Object.assign(toi('saiu'), { isActive: false })]);
  const sab = (date, cp, pp) => ({ id: 's' + date, date, tipo: 'sabado', published: true, slots: [
    { id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: cp }, { id: 'pp_TOI', unitId: 'pp', requiredModalityId: 'TOI', assignedPersonId: pp },
    { id: 'cp_HIIT', unitId: 'cp', requiredModalityId: 'HIIT', assignedPersonId: 'x' }] });
  const outubro = [sab('2026-10-03', 'bru', 'vag'), sab('2026-10-10', 'a', 'b'), sab('2026-10-17', 'thi', 'vag'), sab('2026-10-24', 'c', 'bru'), sab('2026-10-31', 'd', 'e'),
    sab('2026-11-07', 'vag', 'f'),
    { id: 'fer', date: '2026-10-12', tipo: 'feriado', published: true, slots: [{ id: 'cp_TOI', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: 'vag' }] }];
  // A conta é do MÊS INTEIRO, não só da modalidade da vaga: quem dá TOI também
  // ocupa vaga de Hiit, então contar só "vagas de TOI × habilitados em TOI"
  // dizia "nem todo mundo entra" num mês em que, somando tudo, faltava gente
  // (outubro/2026 real: 10 vagas de TOI pra 13 habilitados, mas 20 vagas no
  // total pra 16 pessoas — 4 delas pegam dois sábados de qualquer jeito).
  const r = SS.contaDoMes({ scales: outubro, scale: outubro[0], slot: outubro[0].slots[1], teachers: pessoas, personId: 'vag' });
  assert.deepStrictEqual({ vagas: r.vagas, pessoas: r.pessoas, meus: r.meus }, { vagas: 15, pessoas: 11, meus: 2 },
    '5 sábados × 3 vagas = 15; 11 pessoas no rodízio (9 de TOI + 2 de Hiit; yoga e desligado fora); Vagner em 2 — novembro e o feriado não entram');
  assert.ok(/15 vagas/.test(r.texto) && /11 pessoas/.test(r.texto) && /outubro/i.test(r.texto), r.texto);
  assert.ok(/não dá uma/i.test(r.texto) && /4 pessoas pegam mais de uma/.test(r.texto), 'diz que a conta não fecha em 1 por pessoa, e por quanto: ' + r.texto);
  assert.ok(/você está em 2/i.test(r.texto), 'e quantos a pessoa tem: ' + r.texto);
  passou('a conta do mês explica por que alguém pega mais de um sábado');

  const folgado = SS.contaDoMes({ scales: [outubro[0]], scale: outubro[0], slot: outubro[0].slots[1], teachers: pessoas, personId: 'vag' });
  assert.ok(/3 vagas/.test(folgado.texto) && !/não dá uma/i.test(folgado.texto), 'com menos vagas que pessoas, não diz que falta: ' + folgado.texto);
  const terceiro = SS.contaDoMes({ scales: outubro, scale: outubro[0], slot: outubro[0].slots[1], teachers: pessoas, personId: 'bru', voce: false, nomePorId: { bru: 'BRUNO CLAUDINO' } });
  assert.ok(/BRUNO CLAUDINO está em 2/.test(terceiro.texto), 'pra gestão, com o nome: ' + terceiro.texto);
  assert.strictEqual(SS.contaDoMes({ scales: [], scale: null, slot: null, teachers: [] }).texto, '', 'sem dados não estoura nem escreve nada');
  passou('conta do mês: sem falta quando sobra gente, com nome pra gestão, vazia sem dados');
}

/* ── 4. As telas mostram a explicação ──────────────────────────────── */
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8');
  const sandbox = { console: { log() {} }, document: { getElementById: () => ({ style: {}, innerHTML: '' }) }, setTimeout, Date, Math, JSON, Promise, Set, Map, Array, Object, String, Number,
    AppState: { userProfile: { professorId: 'vag' } }, ajudaBtn: () => '', ScaleService: SS };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'professores-escala-smart.js' });
  vm.runInContext('this.EscalaSmartState = EscalaSmartState;', sandbox);
  const st = sandbox.EscalaSmartState;
  st.units = [{ id: 'pp', name: 'CrossTainer PP' }];
  st.modToi = { id: 'TOI', name: 'TOI' };
  st.teacherMap = new Map(Object.keys(nomePorId).map(id => [id, { id, name: nomePorId[id], isActive: true, modalityIds: ['TOI'] }]));
  const publicada = escala({ slots: [vaga({ reason: 'manual', explain: [] })], historico: [
    { ts: '2026-09-03T12:37:40.551Z', nome: 'Rafael Rojais', acao: 'vaga_trocada', detalhe: 'saiu JOAO VITOR, entrou VAGNER TEIXEIRA (TOI)' }] });
  st.scales = [publicada];

  const prof = sandbox.escalaEquipeHtml(publicada, 'vag');
  assert.ok(/Por que estou neste dia\?/.test(prof), 'o professor escalado vê a pergunta na própria linha do dia');
  assert.ok(/Rafael Rojais/.test(prof) && /gestão/i.test(prof), 'e a resposta: foi a gestão, quem e quando');
  assert.ok(/1 vaga/.test(prof), 'com a conta do mês junto');
  assert.ok(!/Por que estou/.test(sandbox.escalaEquipeHtml(publicada, 'thi')), 'quem NÃO está escalado no dia não vê a pergunta');
  assert.strictEqual(sandbox.escalaEquipeHtml(Object.assign({}, publicada, { published: false }), 'vag'), '', 'antes de publicar continua não aparecendo nada');
  passou('o professor vê "Por que estou neste dia?" na escala publicada, e só na dele');

  const gest = sandbox.renderEscalaDetail(Object.assign({}, publicada, { status: 'consolidada' }));
  assert.ok(/por quê\?/.test(gest) && /Rafael Rojais/.test(gest) && /VAGNER TEIXEIRA/.test(gest),
    'a gestão vê a frase também quando a vaga foi trocada na mão (antes o "por quê?" sumia nesse caso)');
  passou('a gestão vê a frase em toda vaga preenchida, inclusive as trocadas na mão');
}

console.log(`\n${ok} verificações ✓`);
