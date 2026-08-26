'use strict';
// Roda: node scripts/smoke-ajustes-escala-2508.js
//
// Os ajustes pedidos no grupo da gestão em 25/08/2026 (Rafael Rojais e
// Rodrigo). Cada seção guarda UM comportamento que estava errado, junto com o
// relato que o originou — pra quem ler daqui a seis meses saber por que a
// regra existe.
//
// Metade comportamental (roda o serviço/motor real contra o firestore falso),
// metade estrutural (guarda a ligação na tela, que é onde as correções
// anteriores se perderam).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');

let ok = 0;
const passou = (msg) => { console.log('✓ ' + msg); ok++; };

(async () => {

  // ═══ 1. A home conta a fila da GESTÃO ═════════════════════════════
  // Rodrigo, 25/08 8h53: "Abrindo a pág inicial, clicando nas substituições
  // pendentes, não acontece nada". Em produção havia 5 trocas 'pending' (=
  // esperando o colega confirmar) e ZERO 'aguardando_gestao'. A caixa estava
  // certa ao dizer que não havia nada; quem mentia era o aviso.
  {
    const src = ler('professores-home.js');

    assert.ok(/aguardando_gestao/.test(src),
      'a home precisa contar aguardando_gestao (o que é da gestão)');

    // O bloco "Precisam de você" não pode mais ser alimentado por 'pending'.
    const blocoChips = src.slice(src.indexOf('const chips = []'), src.indexOf('const pend ='));
    assert.ok(!/'pending'/.test(blocoChips),
      "'pending' não pode gerar chip em 'Precisam de você' — é fila do professor");

    passou('home conta aguardando_gestao e tirou pending de "Precisam de você"');
  }

  // ═══ 2. Inverter TOI <-> Hiit ═════════════════════════════════════
  // Rafael, 25/08 7h22: "Podemos trocar quem da TOI e quem da Hiit na prévia?"
  // Pelos dois selects não dá: o 1º passo esbarra em "Essa pessoa já está em
  // outra vaga desta escala" e a escala fica exatamente como estava.
  {
    const makeFakeDb = require('./_fake-firestore.js');
    const SS = require('../scale-service.js');
    const SE = require('../scale-engine.js');
    const db = makeFakeDb();
    const d = { db, ts: () => 'TS', uid: () => 'tester', SE };

    const sab = (await SS.createScale({
      date: '2026-10-10', tipo: 'sabado', name: 'Sábado 10/10',
      slots: [
        { id: 'toi',  unitId: 'cp', requiredModalityId: 'TOI',  assignedPersonId: 'ana', startTime: '08:00', endTime: '12:00' },
        { id: 'hiit', unitId: 'cp', requiredModalityId: 'HIIT', assignedPersonId: 'bia', startTime: '08:00', endTime: '12:00' },
      ],
    }, d)).data;

    // O caminho antigo segue barrado — é a regra que impede a mesma pessoa em
    // duas aulas ao mesmo tempo. Certa; só torna a troca A↔B impossível a passo.
    const porFora = await SS.reassignSlot(sab.id, 'toi', 'bia', d);
    assert.strictEqual(porFora.success, false, 'trocar de um em um segue barrado (correto)');

    const r = await SS.swapSlots(sab.id, 'toi', 'hiit', d);
    assert.strictEqual(r.success, true, 'swapSlots inverte as duas de uma vez');

    const fim = (await SS.getScale(sab.id, d)).data;
    const byId = {};
    fim.slots.forEach(s => { byId[s.id] = s; });
    assert.strictEqual(byId.toi.assignedPersonId, 'bia', 'TOI virou bia');
    assert.strictEqual(byId.hiit.assignedPersonId, 'ana', 'Hiit virou ana');
    assert.strictEqual(byId.toi.reason, 'manual', 'vira escolha da gestão');

    // Inverter não é escalar mais ninguém: a conta do dia continua a mesma.
    // (Desde 26/08/2026 não há contador guardado — conta-se das escalas.)
    const contagem = SS.contarPorPessoa((await SS.listScales(d)).data, { tipos: ['sabado'] });
    assert.strictEqual(contagem.ana, 1, 'ana segue com 1 dia depois de inverter');
    assert.strictEqual(contagem.bia, 1, 'bia segue com 1 dia depois de inverter');

    passou('swapSlots inverte TOI <-> Hiit sem mudar quantos dias cada um tem');
  }

  {
    const ui = ler('professores-escala-smart.js');
    assert.ok(/ScaleService\.swapSlots\(/.test(ui), 'a tela chama swapSlots');
    assert.ok(/window\.inverterVagasEscala\s*=/.test(ui), 'o botão está registrado no window');
    assert.ok(/inverterVagasEscala\('\$\{scale\.id\}'/.test(ui), 'o botão ⇄ Inverter está desenhado');
    passou('tela ligada ao swapSlots');
  }

  // ═══ 3. Equilíbrio do ciclo com nomes e sem falso alarme ══════════
  // Rodrigo, 25/08 9h05: "em 'equilíbrio do ciclo' mostrar quem são as pessoas".
  // Em produção os 3 'abaixo do mínimo' eram Yasmin (TOI Mobility), Patrícia
  // (Yoga) e Louiz Lume (TOI Combate) — nenhum dá TOI nem Hiit, que é o que a
  // vaga de sábado exige. O alerta vermelho cobrava algo sem solução.
  //
  // E Rafael, 25/08: "o que passou eles tem como ajustar manualmente?" — não
  // tinham. Agosto inteiro os sábados foram das mesmas 4 pessoas e a dívida
  // ficaria travada esperando alguém mexer no banco.
  {
    const ui = ler('professores-escala-smart.js');
    const painel = ui.slice(ui.indexOf('function renderEquilibrioPainel'), ui.indexOf('function whyTableHtml'));

    assert.ok(/participaDoRodizio/.test(ui),
      'o painel precisa separar quem participa do rodízio de sábado');
    assert.ok(/<details/.test(painel),
      'os chips precisam abrir a lista de nomes');
    assert.ok(/window\.ajustarContadorJustica\s*=/.test(ui),
      'precisa de um jeito de corrigir o contador na mão');
    assert.ok(/ScaleService\.saveAjustePartida\(/.test(ui),
      'a correção precisa gravar de verdade (desde 26/08 como ajuste de partida)');
    passou('equilíbrio mostra nomes, separa quem não participa e permite corrigir');
  }

  // Quem não dá TOI nem Hiit fica fora da conta do rodízio — comportamental.
  {
    const ui = ler('professores-escala-smart.js');
    const fn = ui.slice(ui.indexOf('function participaDoRodizio'), ui.indexOf('function renderEquilibrioPainel'));
    // Reconstitui a função pura num escopo controlado, com o estado que a tela usa.
    const EscalaSmartState = { modToi: { id: 'mTOI' }, modHiit: { id: 'mHIIT' } };
    // eslint-disable-next-line no-new-func
    const participa = new Function('EscalaSmartState', fn + '; return participaDoRodizio;')(EscalaSmartState);

    assert.strictEqual(participa({ modalityIds: ['mTOI'] }), true, 'quem dá TOI participa');
    assert.strictEqual(participa({ modalityIds: ['mHIIT'] }), true, 'quem dá Hiit participa');
    assert.strictEqual(participa({ modalityIds: ['mYOGA'] }), false, 'Patrícia (Yoga) não participa');
    assert.strictEqual(participa({ modalityIds: [] }), false, 'sem modalidade não participa');
    passou('participaDoRodizio tira do alerta quem nunca seria escalado');
  }

  // ═══ 4. Reconsolidar/Despublicar explicados e sem divergir ════════
  // Rodrigo, 25/08 9h10: "Explicar melhor o comportamento qdo clicar em
  // Reconsolidar e Despublicar".
  //
  // Junto veio um defeito que ninguém tinha visto: trocar alguém pelo select
  // republica a agenda; RECONSOLIDAR não republicava. A escala mostraria o nome
  // novo e a agenda seguiria com o antigo, em silêncio. Conferido em produção
  // em 25/08: as 11 escalas publicadas batiam — dá pra fechar antes de doer.
  {
    const ui = ler('professores-escala-smart.js');
    const fn = ui.slice(ui.indexOf('async function consolidarEscala'), ui.indexOf('// ─── Revisão de fechamento'));
    assert.ok(/confirm\(/.test(fn), 'Reconsolidar precisa explicar antes de refazer');
    assert.ok(/ajustes feitos na mão/i.test(fn), 'o texto precisa avisar que perde o ajuste manual');
    assert.ok(/publishToAgenda/.test(fn), 'reconsolidar escala publicada precisa republicar a agenda');

    const desp = ui.slice(ui.indexOf('async function despublicarEscala'), ui.indexOf('/* ─── COLABORADOR'));
    assert.ok(/avisad|notificad/i.test(desp), 'Despublicar precisa avisar que quem foi notificado não é desavisado');
    passou('Reconsolidar e Despublicar explicam o que fazem; reconsolidar republica');
  }

  // Pego na homologação do staging em 25/08: `published` vinha de
  // EscalaSmartState, que envelhece. Com o estado velho o aviso não aparecia e
  // a agenda NÃO era republicada — ou seja, o conserto não consertava nada.
  // Tem que ler do banco.
  {
    const ui = ler('professores-escala-smart.js');
    const fn = ui.slice(ui.indexOf('async function consolidarEscala'), ui.indexOf('// ─── Revisão de fechamento'));
    assert.ok(/ScaleService\.getScale\(id\)/.test(fn),
      'consolidarEscala lê a escala do banco, não do estado em memória');
    const antesDoIf = fn.slice(0, fn.indexOf("if (jaFeita.status === 'consolidada')"));
    assert.ok(/getScale/.test(antesDoIf),
      'a leitura fresca vem ANTES de decidir se avisa e se republica');

    const gar = ui.slice(ui.indexOf('async function escalaGarantirFeriadoNaData'), ui.indexOf('async function publicarEscala'));
    assert.ok(/ScaleService\.getScale\(scaleId\)/.test(gar),
      'a etiqueta de feriado também lê do banco — estado velho não acharia a escala');
    passou('estado de publicação vem do banco, não da memória');
  }

  // ═══ 5. Dá aula e não recebe ══════════════════════════════════════
  // Rafael, 25/08: "o rafa não recebe pois é um dos donos da cross, mas ele dá
  // aula tb, e a parte dele na gestão".
  //
  // type:'eventual' NÃO resolve — eventual é pago, só perde direito a férias.
  // E ficha sem teacher_salaries cai no ramo noSalaryData: aparece no
  // fechamento com as horas e o aviso "Sem cadastro salarial", virando uma
  // pendência mensal que convida alguém a "consertar" pagando um sócio.
  {
    const shared = ler('professores-shared.js');
    assert.ok(/naoRemunerado/.test(shared), 'a ficha precisa da marca naoRemunerado');

    const criar = shared.slice(shared.indexOf('async create(teacherData)'), shared.indexOf('async update(id, updates)'));
    assert.ok(/naoRemunerado:/.test(criar), 'create grava a marca');

    // O fechamento tem que pular quem não recebe, senão a ficha vira linha de
    // pendência todo mês.
    const agrupa = shared.slice(shared.indexOf('// 7) Agrupa classes por teacherId'), shared.indexOf('// 8) Calcula por professor'));
    assert.ok(/naoRemunerado/.test(agrupa), 'o fechamento pula quem não recebe por aula');

    const html = ler('professores.html');
    assert.ok(/teacherNaoRemunerado/.test(html), 'o formulário tem o campo');

    const cad = ler('professores-cadastro.js');
    assert.ok(/naoRemunerado:/.test(cad), 'saveTeacher manda a marca');
    passou('marca "não recebe por aula" existe na ficha, no form e no fechamento');
  }

  // ═══ 6. Sábado que é feriado paga em dobro ════════════════════════
  // Rafael, 25/08 9h13: "quando um feriado cai em um sabado ele nao entra como
  // feriado". Rodrigo confirmou a regra: "é pago em dobro como feriado normal".
  //
  // A aula nascia com isHoliday = (tipo === 'feriado'), então sábado montado
  // pela aba Sábados que também era feriado saía com peso 1. Nenhum feriado
  // nacional de 2026 cai em sábado (conferido), mas 2027 tem 20/11 e 25/12 —
  // e feriado municipal criado no "+ Data especial" já morde hoje.
  {
    const makeFakeDb = require('./_fake-firestore.js');
    const SS = require('../scale-service.js');
    const SE = require('../scale-engine.js');
    const db = makeFakeDb();
    const d = { db, ts: () => 'TS', uid: () => 'tester', SE };

    const sab = (await SS.createScale({
      date: '2027-11-20', tipo: 'sabado', name: 'Sábado 20/11',
      feriadoNaData: 'Consciência Negra',
      slots: [{ id: 's1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: 'ana',
                startTime: '08:00', endTime: '12:00' }],
    }, d)).data;

    const pub = await SS.publishToAgenda(sab.id, d);
    assert.strictEqual(pub.success, true, 'publicou');

    const aulas = await db.collection('classes').where('specialScaleId', '==', sab.id).get();
    assert.strictEqual(aulas.docs.length, 1, 'criou a aula');
    assert.strictEqual(aulas.docs[0].data().isHoliday, true,
      'sábado que é feriado tem que pagar em dobro');
    assert.strictEqual(aulas.docs[0].data().holidayName, 'Consciência Negra',
      'guarda o nome do feriado');

    // Sábado comum segue com peso de sábado — a correção não pode vazar.
    const comum = (await SS.createScale({
      date: '2027-11-27', tipo: 'sabado', name: 'Sábado 27/11',
      slots: [{ id: 's1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: 'ana',
                startTime: '08:00', endTime: '12:00' }],
    }, d)).data;
    await SS.publishToAgenda(comum.id, d);
    const a2 = await db.collection('classes').where('specialScaleId', '==', comum.id).get();
    assert.strictEqual(a2.docs[0].data().isHoliday, false, 'sábado comum não é feriado');

    passou('sábado que é feriado nasce em dobro; sábado comum não');
  }

  // Escala de sábado criada ANTES desta correção não tem o campo. Publicar sem
  // etiquetar de novo pagaria errado e ninguém veria até o fechamento.
  {
    const makeFakeDb = require('./_fake-firestore.js');
    const SS = require('../scale-service.js');
    const db = makeFakeDb();
    const d = { db, ts: () => 'TS', uid: () => 'tester' };

    const antiga = (await SS.createScale({
      date: '2027-11-20', tipo: 'sabado', name: 'Sábado 20/11',
      slots: [{ id: 's1', unitId: 'cp', assignedPersonId: 'ana', startTime: '08:00', endTime: '12:00' }],
    }, d)).data;

    const up = await SS.updateScale(antiga.id, { feriadoNaData: 'Consciência Negra' }, d);
    assert.strictEqual(up.success, true, 'updateScale aceita etiquetar o feriado');
    const depois = (await SS.getScale(antiga.id, d)).data;
    assert.strictEqual(depois.feriadoNaData, 'Consciência Negra', 'a etiqueta ficou gravada');

    const ui = ler('professores-escala-smart.js');
    assert.ok(/escalaGarantirFeriadoNaData\(/.test(ui), 'a tela etiqueta antes de publicar');
    assert.ok(/feriadoNaData/.test(ui), 'a criação passa o feriado da data');
    passou('escala de sábado antiga é etiquetada antes de publicar');
  }

  // ═══ 7. Dois sábados seguidos, não ════════════════════════════════
  // Rafael, 25/08 17h04: "Para o professor não trabalhar em um sábado de
  // feriado na sequência de um sábado normal".
  //
  // O sábado que é feriado é montado pela aba Feriados — escala separada,
  // consolidada em outro momento — e por isso escapava do rodízio dos sábados.
  // Vale SÓ entre sábados: Escola Interna e evento ficam de fora ("só pra
  // sábado mesmo", Rafael).
  {
    const SE = require('../scale-engine.js');
    const slots = [{ id: 's1', unitId: 'cp', requiredModalityId: 'TOI' }];

    // Ana tem mais mérito e menos dias — ganharia. Mas trabalhou no sábado
    // vizinho; Bia não.
    const r = SE.consolidate(slots, [
      { id: 'ana', modalityIds: ['TOI'], merito: 100, diasTrabalhados: 1, trabalhouSabadoVizinho: true },
      { id: 'bia', modalityIds: ['TOI'], merito: 0,   diasTrabalhados: 2, trabalhouSabadoVizinho: false },
    ], { minMes: 1 });
    assert.strictEqual(r.assignments[0].personId, 'bia',
      'quem trabalhou no sábado vizinho cede a vez');

    // Teto MACIO: sobrando só a Ana, ela é escalada mesmo assim. Vaga aberta
    // vira aula que não existe (decisão do Rafael, 25/08).
    const r2 = SE.consolidate(slots, [
      { id: 'ana', modalityIds: ['TOI'], merito: 100, diasTrabalhados: 1, trabalhouSabadoVizinho: true },
    ], { minMes: 1 });
    assert.strictEqual(r2.assignments[0].personId, 'ana',
      'sobrando só uma pessoa habilitada, escala assim mesmo');

    passou('sábados seguidos: cede a vez, mas não deixa a vaga aberta');
  }

  // O serviço precisa descobrir sozinho quem são os vizinhos.
  {
    const makeFakeDb = require('./_fake-firestore.js');
    const SS = require('../scale-service.js');
    const SE = require('../scale-engine.js');
    const db = makeFakeDb();
    const d = { db, ts: () => 'TS', uid: () => 'tester', SE };

    // 14/11/2026 é sábado; 21/11/2026 é o sábado seguinte.
    const anterior = (await SS.createScale({
      date: '2026-11-14', tipo: 'sabado', name: 'Sábado 14/11',
      slots: [{ id: 's1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: 'ana',
                startTime: '08:00', endTime: '12:00' }],
    }, d)).data;

    const seguinte = (await SS.createScale({
      date: '2026-11-21', tipo: 'sabado', name: 'Sábado 21/11',
      slots: [{ id: 's1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: null,
                startTime: '08:00', endTime: '12:00' }],
    }, d)).data;

    const ctx = {
      teachers: [
        { id: 'ana', name: 'Ana', modalityIds: ['TOI'], primaryUnitId: 'cp' },
        { id: 'bia', name: 'Bia', modalityIds: ['TOI'], primaryUnitId: 'cp' },
      ],
      meritoById: { ana: 100, bia: 0 },   // Ana ganharia no mérito
      opts: { minMes: 1 },
      scalesDoAno: [anterior, seguinte],
    };

    await SS.consolidate(seguinte.id, ctx, d);
    const fim = (await SS.getScale(seguinte.id, d)).data;
    assert.strictEqual(fim.slots[0].assignedPersonId, 'bia',
      'Ana trabalhou no sábado anterior, então o seguinte foi pra Bia');

    // A função pura, direto: sábado-feriado do lado conta como sábado.
    const vizinhos = SS.personsOnNearbyScale(
      [{ date: '2026-11-14', tipo: 'feriado', slots: [{ assignedPersonId: 'ana' }] }],
      '2026-11-21');
    assert.ok(vizinhos.has('ana'), 'sábado que é feriado conta como sábado vizinho');

    // Escola Interna e evento ficam de fora — "só pra sábado mesmo".
    const fora = SS.personsOnNearbyScale(
      [{ date: '2026-11-14', tipo: 'escola_interna', slots: [{ assignedPersonId: 'ana' }] }],
      '2026-11-21');
    assert.strictEqual(fora.size, 0, 'Escola Interna não entra na regra');

    passou('serviço enxerga o sábado vizinho e não repete a pessoa');
  }

  // A prévia em lote monta vários sábados numa volta só. Se ela não for
  // acumulando o que acabou de montar, a regra só pegaria sábado de rodada
  // anterior — que é o caso mais raro.
  {
    const ui = ler('professores-escala-smart.js');
    const fn = ui.slice(ui.indexOf('async function gerarPreviaLote'), ui.indexOf('function renderPreviaLote'));
    assert.ok(/ctx\.scalesDoAno = montadas/.test(fn),
      'a prévia em lote atualiza o que já montou antes da próxima data');
    assert.ok(/registrar\(s, cons\.data\.assignments\)/.test(fn),
      'cada data consolidada entra na lista que a próxima consulta');
    passou('prévia em lote acumula os sábados que acabou de montar');
  }

  console.log(`\n${ok} verificação(ões) passando.`);
})().catch(e => { console.error('\n✗ FALHOU: ' + e.message); process.exit(1); });
