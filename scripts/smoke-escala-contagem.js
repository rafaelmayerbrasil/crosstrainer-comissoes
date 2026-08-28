'use strict';
// Roda: node scripts/smoke-escala-contagem.js
//
// O contador de justiça deixou de ser um número guardado e passou a ser CONTADO
// das escalas. Motivo (25/08/2026): em produção 9 das 16 pessoas estavam com o
// contador errado — a Karin marcava 1 e tinha 3 sábados — porque o número só se
// mexia na primeira montagem de cada data, e remontar a prévia troca as pessoas
// sem refazer a conta. Pior: esse número é o insumo do motor, então o contador
// travado da Karin foi o que a fez pegar 3 sábados.

const assert = require('assert');
const SS = require('../scale-service.js');

let ok = 0;
const passou = (msg) => { console.log('✓ ' + msg); ok++; };

const vaga = (id, pid) => ({ id, unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: pid || null });
const escala = (date, tipo, pessoas, batchId) => ({
  id: `sc_${date}_${tipo}`, date, tipo, windowBatchId: batchId || null,
  slots: pessoas.map((p, i) => vaga(`v${i}`, p)),
});

const ESCALAS = [
  escala('2026-09-05', 'sabado',  ['karin', 'bruno'], 'b1'),
  escala('2026-09-07', 'feriado', ['bruno', 'thay'],  'b2'),
  escala('2026-09-19', 'sabado',  ['karin', null],    'b1'),
  escala('2026-10-17', 'sabado',  ['karin'],          'b1'),
  escala('2026-11-14', 'evento',  ['karin']),
  escala('2025-09-06', 'sabado',  ['karin']),
];

// ── por tipo ──
{
  const sab = SS.contarPorPessoa(ESCALAS, { tipos: ['sabado'] });
  assert.strictEqual(sab.karin, 4, 'karin tem 3 sábados em 2026 + 1 em 2025');
  assert.strictEqual(sab.bruno, 1, 'bruno tem 1 sábado');
  assert.strictEqual(sab.thay, undefined, 'thay não tem sábado nenhum');
  assert.strictEqual(sab.evento, undefined, 'evento não é sábado');
  passou('conta por tipo e ignora os outros tipos');
}

// ── feriado NÃO soma sábado (pedido 4 do Rodrigo) ──
{
  const fer = SS.contarPorPessoa(ESCALAS, { tipos: ['feriado', 'domingo_especial'] });
  assert.strictEqual(fer.bruno, 1, 'bruno tem 1 feriado');
  assert.strictEqual(fer.karin, undefined, 'os 3 sábados da karin não entram em feriados');
  passou('feriado conta só feriado');
}

// ── por ano ──
{
  const ano = SS.contarPorPessoa(ESCALAS, { tipos: ['sabado'], de: '2026-01-01', ate: '2026-12-31' });
  assert.strictEqual(ano.karin, 3, 'o sábado de 2025 fica fora do ano de 2026');
  passou('recorta por período');
}

// ── por janela ──
{
  const j = SS.contarPorPessoa(ESCALAS, { tipos: ['sabado'], batchId: 'b1' });
  assert.strictEqual(j.karin, 3, 'karin tem 3 datas no lote b1');
  assert.strictEqual(j.bruno, 1, 'bruno tem 1');
  const j2 = SS.contarPorPessoa(ESCALAS, { tipos: ['feriado'], batchId: 'b1' });
  assert.deepStrictEqual(j2, {}, 'o lote b1 não tem feriado');
  passou('recorta por janela (lote)');
}

// ── excluirDatas: o coração do "refazer a janela" ──
// Ao remontar, as datas que ainda carregam a escala ANTIGA não podem entrar na
// conta — senão a escala velha empurra as pessoas erradas na escala nova.
{
  const c = SS.contarPorPessoa(ESCALAS, { tipos: ['sabado'], excluirDatas: ['2026-09-19', '2026-10-17'] });
  assert.strictEqual(c.karin, 2, 'sobram 05/09 e o de 2025');
  const cSet = SS.contarPorPessoa(ESCALAS, { tipos: ['sabado'], excluirDatas: new Set(['2026-09-19']) });
  assert.strictEqual(cSet.karin, 3, 'aceita Set do mesmo jeito que array');
  passou('excluirDatas tira as datas que estão sendo remontadas');
}

// ── vaga aberta não conta ──
{
  const c = SS.contarPorPessoa([escala('2026-09-26', 'sabado', [null, null])], { tipos: ['sabado'] });
  assert.deepStrictEqual(c, {}, 'vaga sem ninguém não conta pra ninguém');
  passou('vaga aberta não conta');
}

// ── sem filtro: conta tudo; entrada vazia não estoura ──
{
  assert.deepStrictEqual(SS.contarPorPessoa([], {}), {}, 'lista vazia devolve objeto vazio');
  assert.deepStrictEqual(SS.contarPorPessoa(null, null), {}, 'null não estoura');
  passou('entrada vazia é segura');
}

// ── tiposIrmaos ──
{
  assert.deepStrictEqual(SS.tiposIrmaos('sabado'), ['sabado']);
  assert.deepStrictEqual(SS.tiposIrmaos('feriado'), ['feriado', 'domingo_especial']);
  assert.deepStrictEqual(SS.tiposIrmaos('domingo_especial'), ['feriado', 'domingo_especial']);
  passou('feriado e domingo especial contam juntos');
}

// ── contarPorPessoa expande tipos por dentro, sozinha ──
// Quem escreve o pedido natural `{ tipos: ['feriado'] }` — sem lembrar de passar
// por tiposIrmaos — não pode ficar contando errado. Isso seria a mesma
// divergência silenciosa que esta função inteira existe pra matar. A expansão
// tem que ser idempotente: pedir já-expandido dá o mesmo resultado.
{
  const comDomingoEspecial = ESCALAS.concat([
    escala('2026-12-25', 'domingo_especial', ['bruno']),
  ]);
  const pedidoCurto = SS.contarPorPessoa(comDomingoEspecial, { tipos: ['feriado'] });
  const pedidoExpandido = SS.contarPorPessoa(comDomingoEspecial, { tipos: ['feriado', 'domingo_especial'] });
  assert.deepStrictEqual(pedidoCurto, pedidoExpandido, '["feriado"] sozinho já dá o mesmo resultado que ["feriado","domingo_especial"]');
  assert.strictEqual(pedidoCurto.bruno, 2, 'bruno soma o feriado de 07/09 com o domingo especial de 25/12');
  passou('contarPorPessoa expande tipos internamente e é idempotente');
}

// ── sem filtro de tipos: tudo soma junto ──
// O ramal `tipos = null` até agora só era testado com entrada vazia. Com dados
// de verdade e sem filtro, sábado e evento da mesma pessoa têm que somar.
{
  const tudo = SS.contarPorPessoa(ESCALAS, {});
  assert.strictEqual(tudo.karin, 5, 'karin: 4 sábados (05/09, 19/09, 17/10, 06/09/2025) + 1 evento (14/11)');
  passou('sem filtro de tipos, todos os tipos contam juntos');
}

// ── descanso: quem trabalhou perto não pega a próxima ────────────────
// Rodrigo, 25/08/2026: "se o colaborador foi escalado sábado passado ou seguinte
// ao feriado em questão, preferencialmente não deverá escalado em sábados
// próximos imediatamente anterior ou posterior ao feriado".
const VIZINHAS = [
  escala('2026-09-05', 'sabado',  ['ana']),
  escala('2026-09-07', 'feriado', ['bia']),
  escala('2026-09-12', 'sabado',  ['ceu']),
  escala('2026-09-26', 'sabado',  ['dri']),
  escala('2026-09-19', 'evento',  ['edu']),
  escala('2026-09-13', 'domingo_especial', ['fef']),
];
{
  // feriado de SEGUNDA enxerga os dois sábados ao lado — o pedido do Rodrigo
  const v = SS.personsOnNearbyScale(VIZINHAS, '2026-09-07');
  assert.ok(v.has('ana'), 'quem pegou o sábado 2 dias antes conta');
  assert.ok(v.has('ceu'), 'quem pegou o sábado 5 dias depois conta');
  assert.ok(!v.has('bia'), 'a própria data não conta contra si mesma');
  assert.ok(!v.has('dri'), 'sábado a 19 dias não conta');
  passou('feriado de meio de semana enxerga os sábados vizinhos');
}
{
  // e o caminho inverso: montando o sábado, quem pegou o feriado ao lado cede
  const v = SS.personsOnNearbyScale(VIZINHAS, '2026-09-05');
  assert.ok(v.has('bia'), 'quem pegou o feriado 2 dias depois cede a vez no sábado');
  passou('sábado enxerga o feriado vizinho');
}
{
  // o comportamento antigo (sábado com sábado a ±7) segue igual
  const v = SS.personsOnNearbyScale(VIZINHAS, '2026-09-12');
  assert.ok(v.has('ana'), 'sábado anterior (7 dias) conta — comportamento de sempre');
  assert.ok(!v.has('dri'), 'sábado a 14 dias não conta');
  passou('sábado com sábado a ±7 preservado');
}
{
  // domingo especial entra igual feriado (tiposIrmaos, Task 1) — sem esta
  // asserção, apagar 'domingo_especial' do filtro de tipos em
  // personsOnNearbyScale passaria a suíte inteira em silêncio.
  const v = SS.personsOnNearbyScale(VIZINHAS, '2026-09-12');
  assert.ok(v.has('fef'), 'domingo especial vizinho (13/09, 1 dia depois) conta igual feriado');
  passou('domingo especial entra na regra do descanso');
}
{
  // evento e escola interna ficam de fora ("só pra sábado mesmo", Rafael 25/08)
  const v = SS.personsOnNearbyScale(VIZINHAS, '2026-09-26');
  assert.ok(!v.has('edu'), 'evento não entra na regra do descanso');
  passou('evento fica de fora');
}
{
  assert.strictEqual(SS.personsOnNearbyScale(VIZINHAS, null).size, 0, 'sem data devolve vazio');
  assert.strictEqual(SS.personsOnNearbyScale(null, '2026-09-05').size, 0, 'sem escalas devolve vazio');
  passou('entrada vazia é segura no descanso');
}

(async () => {
  const makeFakeDb = require('./_fake-firestore.js');
  const SE = require('../scale-engine.js');
  const db = makeFakeDb();
  const d = { db, ts: () => 'TS', uid: () => 'tester', SE };

  // ── o motor decide pela CONTAGEM, não pelo número guardado ──────────
  // É o cerne do conserto: remontar duas vezes tem que dar o mesmo resultado.
  {
    const slots = [
      { id: 'v1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: null },
    ];
    await SS.createScale({ date: '2026-12-05', tipo: 'sabado', name: 'Sáb 05/12', slots }, d);
    const idNovo = (await SS.listScales(d)).data.find(s => s.date === '2026-12-05').id;

    // Cida já pegou 2 sábados do ano; Duda nenhum. O rodízio tem que dar pra Duda,
    // mesmo com a Cida tendo mais mérito.
    const historico = [
      { id: 'h1', date: '2026-11-07', tipo: 'sabado', slots: [{ id: 'a', assignedPersonId: 'cida' }] },
      { id: 'h2', date: '2026-11-21', tipo: 'sabado', slots: [{ id: 'a', assignedPersonId: 'cida' }] },
    ];
    const ctx = {
      teachers: [
        { id: 'cida', modalityIds: ['TOI'], primaryUnitId: 'cp' },
        { id: 'duda', modalityIds: ['TOI'], primaryUnitId: 'cp' },
      ],
      meritoById: { cida: 99, duda: 1 },
      opts: { minMes: 1 },
      scalesDoAno: historico,
    };
    const r1 = await SS.consolidate(idNovo, ctx, d);
    assert.strictEqual(r1.success, true, 'consolidou');
    assert.strictEqual(r1.data.assignments[0].personId, 'duda', 'quem trabalhou menos no ano vem antes do mérito');

    // Reconsolidar não pode mudar a resposta — era exatamente aqui que o contador
    // antigo travava e a escala saía torta.
    ctx.scalesDoAno = historico.concat((await SS.listScales(d)).data.filter(s => s.date === '2026-12-05'));
    const r2 = await SS.consolidate(idNovo, ctx, d);
    assert.strictEqual(r2.data.assignments[0].personId, 'duda', 'remontar dá o mesmo resultado');
    console.log('✓ o motor decide pela contagem e remontar não muda a resposta');
  }

  // ── janela de 12 meses móveis, não ano civil ─────────────────────────
  // Revisão de 26/08/2026: ano civil zerava o rodízio em 1º de janeiro (e com
  // `divida` sempre 0, o comparador caía direto no mérito fixo — o mesmo
  // defeito que este branch existe pra matar) e fatiava um lote que atravessa
  // o ano em dois universos diferentes.
  {
    const vaga = () => [{ id: 'v1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: null }];

    // 14 meses atrás fica FORA da janela (janela = 12 meses até a data da escala).
    await SS.createScale({ date: '2027-04-10', tipo: 'sabado', name: 'Sáb 10/04', slots: vaga() }, d);
    const idA = (await SS.listScales(d)).data.find(s => s.date === '2027-04-10').id;
    const histA = [{ id: 'ha', date: '2026-02-10', tipo: 'sabado', slots: [{ id: 'a', assignedPersonId: 'nina' }] }];
    const rA = await SS.consolidate(idA, {
      teachers: [
        { id: 'nina', modalityIds: ['TOI'], primaryUnitId: 'cp' },
        { id: 'oto', modalityIds: ['TOI'], primaryUnitId: 'cp' },
      ],
      meritoById: { nina: 50, oto: 5 },
      opts: { minMes: 1 },
      scalesDoAno: histA,
    }, d);
    assert.strictEqual(rA.success, true, 'consolidou (14 meses)');
    assert.strictEqual(rA.data.assignments[0].personId, 'nina', '14 meses atrás não conta — decide por mérito, como se a nina não tivesse histórico');

    // 10 meses atrás entra na janela.
    await SS.createScale({ date: '2027-04-17', tipo: 'sabado', name: 'Sáb 17/04', slots: vaga() }, d);
    const idB = (await SS.listScales(d)).data.find(s => s.date === '2027-04-17').id;
    const histB = [{ id: 'hb', date: '2026-06-17', tipo: 'sabado', slots: [{ id: 'a', assignedPersonId: 'paty' }] }];
    const rB = await SS.consolidate(idB, {
      teachers: [
        { id: 'paty', modalityIds: ['TOI'], primaryUnitId: 'cp' },
        { id: 'quel', modalityIds: ['TOI'], primaryUnitId: 'cp' },
      ],
      meritoById: { paty: 50, quel: 5 },
      opts: { minMes: 1 },
      scalesDoAno: histB,
    }, d);
    assert.strictEqual(rB.data.assignments[0].personId, 'quel', '10 meses atrás conta — a paty já trabalhou, a quel vem antes mesmo com menos mérito');

    // Lote atravessando o ano-novo: dezembro e janeiro precisam enxergar o
    // MESMO histórico de novembro. Com ano civil, o alvo de janeiro cairia
    // num ano-janela diferente e perderia o registro de novembro do ano
    // anterior — era exatamente essa a virada que zerava o rodízio.
    await SS.createScale({ date: '2026-12-19', tipo: 'sabado', name: 'Sáb 19/12', slots: vaga() }, d);
    await SS.createScale({ date: '2027-01-16', tipo: 'sabado', name: 'Sáb 16/01', slots: vaga() }, d);
    const idDez = (await SS.listScales(d)).data.find(s => s.date === '2026-12-19').id;
    const idJan = (await SS.listScales(d)).data.find(s => s.date === '2027-01-16').id;
    const histC = [{ id: 'hc', date: '2026-11-20', tipo: 'sabado', slots: [{ id: 'a', assignedPersonId: 'rita' }] }];
    const ctxC = {
      teachers: [
        { id: 'rita', modalityIds: ['TOI'], primaryUnitId: 'cp' },
        { id: 'sam', modalityIds: ['TOI'], primaryUnitId: 'cp' },
      ],
      meritoById: { rita: 50, sam: 5 },
      opts: { minMes: 1 },
      scalesDoAno: histC,
    };
    const rDez = await SS.consolidate(idDez, ctxC, d);
    const rJan = await SS.consolidate(idJan, ctxC, d);
    assert.strictEqual(rDez.data.assignments[0].personId, 'sam', 'dezembro enxerga o sábado de novembro (a rita já trabalhou)');
    assert.strictEqual(rJan.data.assignments[0].personId, 'sam', 'janeiro enxerga o MESMO sábado de novembro — ano civil cortaria isso na virada');
    console.log('✓ janela de 12 meses móveis: 14 meses fora, 10 meses dentro, ano-novo não corta o histórico');
  }

  // ── data malformada recusa, não zera a contagem em silêncio ──────────
  {
    const criada = await SS.createScale({ date: '', tipo: 'sabado', name: 'Sem data', slots: [{ id: 'v1', unitId: 'cp', requiredModalityId: 'TOI', assignedPersonId: null }] }, d);
    const rSemData = await SS.consolidate(criada.data.id, { teachers: [{ id: 'tici', modalityIds: ['TOI'], primaryUnitId: 'cp' }], scalesDoAno: [] }, d);
    assert.strictEqual(rSemData.success, false, 'data vazia recusa, não monta escala com rodízio cego');
    assert.ok(/data.*inválid/i.test(rSemData.error || ''), 'erro explica o motivo');
    console.log('✓ data malformada recusa em vez de zerar a contagem em silêncio');
  }

  // ── a tela está ligada na contagem, não no contador velho ───────────
  {
    const fs = require('fs');
    const path = require('path');
    const ui = fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8');
    assert.ok(!/fairnessMap/.test(ui), 'a tela não pode mais guardar fairnessMap');
    assert.ok(!/saveFairness|applyFairnessDelta/.test(ui), 'a tela não chama mais a API aposentada');
    assert.ok(/ScaleService\.contarPorPessoa\(/.test(ui), 'a tela conta pelas escalas');
    const painel = ui.slice(ui.indexOf('function renderEquilibrioPainel'), ui.indexOf('function whyTableHtml'));
    assert.ok(/no ano/.test(painel), 'o painel mostra o número do ano ao lado do da janela');
    console.log('✓ a tela usa a contagem derivada');
  }

  // ── nada aparece pro professor antes de publicar ─────────────────────
  //
  // Rodrigo, 25/08/2026: "A publicação para os colaboradores, ou seja, envio de
  // e-mail, deve ocorrer somente depois que a janela em questão de fato for
  // fechada e publicada pela gestão".
  //
  // O e-mail já estava certo — só sai no publicar. O vazamento era outro: a
  // PRÉVIA grava `status: 'consolidada'` e PARA, de propósito, pra gestão
  // conferir e ajustar antes. Como a tela do professor liberava a partir de
  // 'consolidada', o time inteiro via "✓ Você está escalado" numa escala que
  // ainda ia mudar.
  {
    const fs = require('fs');
    const path = require('path');
    const ui = fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8');
    const vista = ui.slice(
      ui.indexOf('async function renderProfSabadosFeriados'),
      ui.indexOf('function profDateRow'));
    assert.ok(vista.length > 100, 'achou a vista do professor');
    assert.ok(!/status !== 'consolidada'/.test(vista),
      'a vista do professor não pode mais liberar por status consolidada');
    assert.ok(/!s\.published/.test(vista),
      'quem manda é a publicação, não a consolidação');
    assert.ok(/montando a escala/.test(vista),
      'e enquanto isso ele lê que a gestão ainda está montando');
    console.log('✓ o professor só vê a escala depois de publicada');
  }

  // ── inverter vale entre unidades, não só dentro ──────────────────────
  //
  // Rodrigo, 25/08/2026: "trouxe a possibilidade de inverter somente os
  // colaboradores dentro da unidade. Mas traga tbm a possibilidade de inverter
  // as unidades... um prof do TOI da PP ser invertido para o Hiit da CP".
  //
  // `swapSlots` JÁ aceitava qualquer par de vagas do mesmo dia — quem limitava
  // era a tela, que só oferecia o par TOI/Hiit da mesma unidade. Um mecanismo
  // só: o botão de um clique sai, o seletor por vaga entra.
  {
    const fs = require('fs');
    const path = require('path');
    const ui = fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8');
    assert.ok(/Inverter com…/.test(ui), 'cada vaga oferece inverter com outra vaga do dia');
    assert.ok(/Outra unidade/.test(ui), 'as vagas de outra unidade aparecem no seletor');
    assert.ok(!/⇄ Inverter<\/button>/.test(ui), 'o botão antigo do par TOI/Hiit sai — um mecanismo só');
    const fn = ui.slice(ui.indexOf('async function inverterVagasEscala'),
                        ui.indexOf('async function atribuirLider'));
    assert.ok(/habilitad/i.test(fn),
      'inverter entre unidades pode pôr alguém numa modalidade que não é dele — tem que avisar');
    assert.ok(/if \(!slotBId\) return;/.test(fn),
      'voltar pro rótulo do seletor não pode disparar troca nenhuma');
    console.log('✓ inverter vale entre unidades, com aviso de não habilitado');
  }

  // ── aba "Por pessoa" + histórico do ano ──────────────────────────────
  //
  // Pedido 1 do Rodrigo (25/08/2026): "Deveria existir um filtro escolhendo
  // qual professor / estagiário e mostrando aonde e qdo ele(a) está escalado".
  // Pedido 8: "Qdo for aberta a próxima janela, trazer o histórico da qtidade
  // das últimas escalas no ano por prof/estag" — por isso o histórico aparece
  // TAMBÉM no modal de abrir janela, que é onde a gestão decide.
  {
    const fs = require('fs');
    const path = require('path');
    const ui = fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8');
    assert.ok(/id: 'pessoa'/.test(ui), 'existe a aba pessoa');
    assert.ok(/function renderTabPorPessoa/.test(ui), 'existe a tela da aba');
    assert.ok(/window\.escalaSetPessoa\s*=/.test(ui), 'o seletor de pessoa está registrado no window');
    assert.ok(/function escalaHistoricoAnoHtml/.test(ui), 'existe o histórico do ano');
    // 4 = a definição + 2 usos na aba + 1 no modal de abrir janela
    assert.strictEqual((ui.match(/escalaHistoricoAnoHtml\(\)/g) || []).length, 4,
      'o histórico do ano aparece na aba E no modal de abrir janela');
    const aba = ui.slice(ui.indexOf('function renderTabPorPessoa'), ui.indexOf('function escalaHistoricoAnoHtml'));
    assert.ok(/publicada/.test(aba), 'a lista diz se a data já está publicada');
    console.log('✓ aba Por pessoa e histórico do ano ligados');
  }

  // ── refazer a janela ─────────────────────────────────────────────────
  //
  // Setembro e outubro de 2026 foram montados com o contador travado, então
  // saíram tortos e JÁ estão publicados. Refazer é decisão da gestão. O detalhe
  // que decide se funciona: ao remontar, as datas do lote que ainda carregam a
  // escala ANTIGA precisam sair da conta — senão a escala velha empurra as
  // pessoas erradas na escala nova, que é o problema que este branch resolve.
  {
    const fs = require('fs');
    const path = require('path');
    const ui = fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8');
    const previa = ui.slice(ui.indexOf('async function gerarPreviaLote'),
                            ui.indexOf('function renderPreviaLote'));
    assert.ok(/aRemontar/.test(previa), 'a prévia tira do bolo as datas que ainda vão ser remontadas');
    assert.ok(/ctx\.excluirDatas = Array\.from\(aRemontar\)/.test(previa), 'e passa isso pro serviço');
    assert.ok(/aRemontar\.delete\(s\.date\)/.test(previa), 'cada data volta a contar assim que é remontada');
    assert.ok(/window\.refazerJanela\s*=/.test(ui), 'o botão de refazer está registrado');
    const refazer = ui.slice(ui.indexOf('async function refazerJanela'), ui.indexOf('async function gerarPreviaLote'));
    assert.ok(/já aconteceram/.test(refazer),
      'refazer recusa data passada — republicar traria aula realizada de volta pra prevista');
    // Ancorado NO AVISO, não no arquivo inteiro: "escala MUDOU" também aparece
    // no confirm() do próprio botão, então uma busca solta passaria sem que o
    // aviso ao professor existisse.
    const avisar = ui.slice(ui.indexOf('async function confirmarEAvisar'));
    assert.ok(/foi refeita e o aviso anterior não vale mais/.test(avisar),
      'quem já foi avisado precisa saber que o recado anterior caducou');
    assert.ok(/EscalaSmartState\.remontando === batchId/.test(avisar),
      'e isso só vale quando a janela foi remontada');
    assert.ok(/EscalaSmartState\.remontando = null/.test(avisar),
      'a marca de remontagem é limpa no fim');
    // Despublicar antes de montar: sem isso a agenda fica com os nomes velhos
    // enquanto a escala já tem os novos, e o professor vê a lista nova como se
    // valesse. Estado visivelmente incompleto é melhor que silenciosamente errado.
    assert.ok(/unpublishFromAgenda/.test(refazer),
      'refazer tira as datas da agenda antes de remontar');
    console.log('✓ refazer a janela existe e não conta a escala velha');
  }

  // ── a prévia RODA e desenha ──────────────────────────────────────────
  //
  // Este teste existe por causa de um vexame: `gerarPreviaLote` terminava
  // chamando `carregarEscalas()`, uma função que nunca existiu no frontend.
  // Entrou com a prévia em 24/08/2026 e foi pra produção assim — o botão
  // anunciado pro Rodrigo como "monta e PARA pra você conferir" consolidava o
  // lote inteiro no banco e estourava ReferenceError antes de desenhar nada.
  //
  // Passou por doze verificações automatizadas porque TODAS liam o texto do
  // arquivo. Nenhuma chamava a função. Esta chama: carrega a tela num sandbox
  // com os serviços dublados e confere que a prévia foi desenhada.
  {
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');

    const modal = { innerHTML: '' };
    const escalas = [
      { id: 'e1', date: '2026-12-05', tipo: 'sabado', status: 'consolidada', windowBatchId: 'lote',
        slots: [{ id: 'v1', unitId: 'u1', requiredModalityId: 'TOI', assignedPersonId: 'ana' }] },
    ];
    const chamou = { closeElection: 0, consolidate: 0 };

    const sandbox = {
      console: { log() {}, warn() {}, error() {} },
      document: { getElementById: (id) => (id === 'escalaModal' ? modal : { style: {}, innerHTML: '' }) },
      setTimeout, clearTimeout, Date, Math, JSON, Promise, Set, Map, Array, Object, String, Number,
      toast() {},
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
        listScalesByBatch: async () => ({ success: true, data: escalas }),
        closeElection: async () => { chamou.closeElection++; return { success: true }; },
        consolidate: async () => {
          chamou.consolidate++;
          return { success: true, data: { assignments: [{ slotId: 'v1', personId: 'ana', reason: 'justica' }] } };
        },
        listWindowQuotas: async () => ({ success: true, data: {} }),
        listScales: async () => ({ success: true, data: escalas }),
        ScaleConfigService: { get: async () => ({ success: true, data: { horarios: {} } }) },
      },
      UnitService: { list: async () => ({ success: true, data: [{ id: 'u1', name: 'CrossTainer CP' }] }) },
      ModalityService: { list: async () => ({ success: true, data: [{ id: 'TOI', name: 'TOI' }, { id: 'HIIT', name: 'Hiit' }] }) },
      TeacherService: { list: async () => ({ success: true, data: [{ id: 'ana', name: 'Ana', isActive: true, modalityIds: ['TOI'] }] }) },
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8'),
      sandbox, { filename: 'professores-escala-smart.js' });

    await sandbox.gerarPreviaLote('lote');

    assert.ok(chamou.consolidate > 0, 'a prévia consolidou o lote');
    assert.ok(/Prévia da escala/.test(modal.innerHTML),
      'a prévia PRECISA ter sido desenhada — era exatamente isso que não acontecia');
    assert.ok(/Ana/.test(modal.innerHTML), 'e mostra quem foi escalado');
    assert.ok(/Nada foi publicado/.test(modal.innerHTML), 'deixando claro que ainda não vale');
    console.log('✓ a prévia roda até o fim e desenha a tela');

    // Task 13 (28/08/2026): o botão de publicar ganhou o número real e passou
    // a aparecer também no TOPO da prévia, não só no rodapé — o Rodrigo não
    // achava o botão. `escalas` tem 1 data de tipo 'sabado' neste lote.
    {
      const rotulo = '✅ Publicar 1 data de sábado na agenda e avisar';
      const ocorrencias = (modal.innerHTML.match(new RegExp(rotulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      assert.strictEqual(ocorrencias, 2, 'o botão de publicar aparece 2x: topo e rodapé da prévia');
    }
    console.log('✓ o botão de publicar tem o número real e mora no topo e no rodapé');

    // escalaLoadBase é quem chamava ScaleService.listAjustes() (removida na
    // Task 5). Chamar de verdade, no mesmo sandbox, prova que a tela não
    // estoura mais — a mesma classe de falha que passou por 12 verificações
    // de texto em 24/08 (a prévia que nunca rodou).
    await sandbox.escalaLoadBase(); // não lança: prova que não sobrou listAjustes() pendurado
    console.log('✓ escalaLoadBase roda de verdade sem chamar listAjustes');
  }

  // ── a janela é por tipo, não uma só pro app inteiro ──────────────────
  //
  // Em produção (26/08/2026) rodam duas janelas ao mesmo tempo: sábados
  // (batch_1786921932940, 9 datas) e feriados (batch_1786921982328, 07/09 e
  // 12/10). Com um lote global, a aba perdedora mostrava ZERO pra todo mundo
  // sob o título "Equilíbrio da janela aberta" — a mentira silenciosa que este
  // branch existe pra matar. Testado de verdade, não por regex: a regra de
  // escolha já provou que erra sozinha.
  {
    const fs = require('fs');
    const path = require('path');
    const ui = fs.readFileSync(path.join(__dirname, '..', 'professores-escala-smart.js'), 'utf8');
    const ini = ui.indexOf('function escalaJanelasPorTipo(');
    const fim = ui.indexOf('function escalaJanelaDoTipo(', ini);
    assert.ok(ini !== -1, 'a escolha da janela mora numa função pura com nome próprio');
    assert.ok(fim > ini, 'e o delimitador dela está onde se espera');
    const escalaJanelasPorTipo = new Function(
      'ScaleService', ui.slice(ini, fim) + ' return escalaJanelasPorTipo;')(SS);

    const duas = escalaJanelasPorTipo([
      { date: '2026-09-05', tipo: 'sabado',  status: 'janela_aberta', windowBatchId: 'lote_sab' },
      { date: '2026-09-12', tipo: 'sabado',  status: 'janela_aberta', windowBatchId: 'lote_sab' },
      { date: '2026-09-07', tipo: 'feriado', status: 'janela_aberta', windowBatchId: 'lote_fer' },
      { date: '2026-10-12', tipo: 'domingo_especial', status: 'rascunho', windowBatchId: 'lote_fer' },
      { date: '2026-03-14', tipo: 'sabado',  status: 'consolidada', windowBatchId: 'lote_velho' },
    ]);
    assert.strictEqual(duas.sabado.id, 'lote_sab', 'sábado enxerga a janela de sábado');
    assert.strictEqual(duas.feriado.id, 'lote_fer', 'feriado enxerga a SUA janela — com uma janela global, uma das duas abas zerava');
    assert.strictEqual(duas.sabado.aberta, true, 'a janela de sábado está aberta');
    assert.strictEqual(duas.feriado.aberta, true, 'domingo especial cai no mesmo balde do feriado');

    const fechadas = escalaJanelasPorTipo([
      { date: '2026-03-14', tipo: 'sabado',  status: 'consolidada', windowBatchId: 'sab_mar' },
      { date: '2026-07-11', tipo: 'sabado',  status: 'consolidada', windowBatchId: 'sab_jul' },
      { date: '2026-04-21', tipo: 'feriado', status: 'consolidada', windowBatchId: 'fer_abr' },
    ]);
    assert.strictEqual(fechadas.sabado.id, 'sab_jul', 'sem janela aberta, vale a última por data');
    assert.strictEqual(fechadas.sabado.aberta, false, 'e ela não é anunciada como aberta');
    assert.strictEqual(fechadas.feriado.id, 'fer_abr', 'a última de feriado não é a última de sábado');

    assert.deepStrictEqual(escalaJanelasPorTipo([]), {}, 'entrada vazia é segura');
    assert.deepStrictEqual(
      escalaJanelasPorTipo([{ date: '2026-05-02', tipo: 'sabado', status: 'rascunho' }]), {},
      'escala fora de janela nenhuma não inventa lote');
    console.log('✓ a janela é por tipo: sábado e feriado não roubam a janela um do outro');
  }

  console.log('\n✓ smoke-escala-contagem: todas as seções OK');
})();
