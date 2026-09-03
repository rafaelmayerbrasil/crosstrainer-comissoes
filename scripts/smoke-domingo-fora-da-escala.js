'use strict';
// Roda: node scripts/smoke-domingo-fora-da-escala.js
//
// ══════════════════════════════════════════════════════════════════════
// Domingo não entra na escala
// ══════════════════════════════════════════════════════════════════════
//
// Rafael Rojais, no grupo, 03/09/2026 09h44: "ele esta abrindo escala de
// feriados aos domingos, pode tirar os domingos da escala". A régua veio na
// sequência: DOMINGO A ACADEMIA NÃO ABRE — e com isso não existe feriado em
// domingo.
//
// Em produção havia mesmo um rascunho de escala em 2026-11-15, domingo,
// "Proclamação da República". A aba Feriados sugeria tudo o que a BrasilAPI
// devolve, e a BrasilAPI devolve Páscoa e qualquer feriado que caia em domingo.
//
// A regra mora no SERVIÇO, não na tela: é por lá que passa todo caminho de
// criação (aba Feriados, aba Sábados, "+ Data especial", Escola Interna de um
// dia só) — inclusive os que ainda não foram escritos.
//
// Estes casos CHAMAM as funções contra o firestore falso. Teste que só lê o
// texto do arquivo já nos deixou publicar uma prévia que nunca rodou (24/08).

const assert = require('assert');
const makeFakeDb = require('./_fake-firestore.js');
const SS = require('../scale-service.js');
const SE = require('../scale-engine.js');

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

const vaga = (id) => ({ id, unitId: 'cp', requiredModalityId: 'TOI',
  assignedPersonId: null, startTime: '08:00', endTime: '12:00' });

(async () => {

  // ═══ 1. Criar escala em domingo é recusado ════════════════════════
  {
    const db = makeFakeDb();
    const d = { db, ts: () => 'TS', uid: () => 'tester', SE };

    // 15/11/2026 é domingo — o caso real que apareceu em produção.
    const res = await SS.createScale({
      date: '2026-11-15', tipo: 'feriado', name: 'Proclamação da República',
      slots: [vaga('s1')],
    }, d);

    assert.strictEqual(res.success, false, 'criar escala em domingo tem que falhar');
    assert.ok(/domingo/i.test(res.error || ''),
      'o erro precisa dizer que é domingo, senão ninguém entende: ' + res.error);

    const lista = await SS.listScales(d);
    assert.strictEqual((lista.data || []).length, 0,
      'a escala recusada não pode ter sido gravada');

    ok('criar escala em domingo é recusado e nada é gravado');
  }

  // ═══ 2. Sábado e dia de semana continuam passando ═════════════════
  // A regra é só domingo. Se ela pegar sábado, a escala inteira morre.
  {
    const db = makeFakeDb();
    const d = { db, ts: () => 'TS', uid: () => 'tester', SE };

    const sab = await SS.createScale({
      date: '2026-11-14', tipo: 'sabado', name: 'Sábado 14/11', slots: [vaga('s1')] }, d);
    const seg = await SS.createScale({
      date: '2026-11-02', tipo: 'feriado', name: 'Finados', slots: [vaga('s2')] }, d);

    assert.strictEqual(sab.success, true, 'sábado tem que continuar passando: ' + sab.error);
    assert.strictEqual(seg.success, true, 'feriado em segunda tem que continuar passando: ' + seg.error);

    ok('sábado e feriado em dia de semana continuam passando');
  }

  // ═══ 2b. A regra pega o que vira AULA, e só isso ══════════════════
  // Achado pelos testes que já existiam, quando a primeira versão da regra
  // barrou tudo. Duas exceções legítimas:
  //
  //  · FIM DE ANO: a `date` da escala é o começo do PERÍODO, um marco — não um
  //    dia de trabalho. Os domingos de dentro do período já são pulados na
  //    geração das vagas (caso 4). Barrar o marco impediria a gestão de abrir o
  //    período num domingo sem nenhum ganho.
  //  · EVENTO: não é aula e não precisa da academia aberta — trilha, beach
  //    games e campeonato em domingo são o normal, não a exceção.
  {
    const db = makeFakeDb();
    const d = { db, ts: () => 'TS', uid: () => 'tester', SE };

    // 20/12/2026 é domingo.
    const fe = await SS.createScale({
      date: '2026-12-20', tipo: 'fim_de_ano', name: 'Fim de ano 2026', slots: [] }, d);
    assert.strictEqual(fe.success, true,
      'o começo do período de fim de ano pode cair em domingo: ' + fe.error);

    const ev = await SS.createScale({
      date: '2026-11-15', tipo: 'evento', name: 'Beach games', slots: [] }, d);
    assert.strictEqual(ev.success, true,
      'evento em domingo é legítimo — não é aula: ' + ev.error);

    const ei = await SS.createScale({
      date: '2026-11-15', tipo: 'escola_interna', name: 'Escola Interna', slots: [vaga('s1')] }, d);
    assert.strictEqual(ei.success, false, 'escola interna é aula — domingo não');

    ok('a regra pega o que vira aula; fim de ano e evento seguem livres');
  }

  // ═══ 3. Editar a data para um domingo é recusado ══════════════════
  // Sem isto a regra tem porta dos fundos: cria em sábado, arrasta pro domingo.
  {
    const db = makeFakeDb();
    const d = { db, ts: () => 'TS', uid: () => 'tester', SE };

    const criada = (await SS.createScale({
      date: '2026-11-14', tipo: 'sabado', name: 'Sábado 14/11/2026', slots: [vaga('s1')] }, d)).data;

    const res = await SS.updateScale(criada.id, { date: '2026-11-15' }, d);
    assert.strictEqual(res.success, false, 'mover uma escala para domingo tem que falhar');
    assert.ok(/domingo/i.test(res.error || ''), 'o erro precisa dizer domingo: ' + res.error);

    const depois = await SS.getScale(criada.id, d);
    assert.strictEqual(depois.data.date, '2026-11-14',
      'a data velha tem que continuar de pé depois da recusa');

    ok('editar a data para domingo é recusado e a data velha fica');
  }

  // ═══ 4. Fim de ano pula os domingos sozinho ═══════════════════════
  // Aqui estava o segundo vazamento: closedDays cobria só 24, 25, 31/12 e
  // 01/01, então os domingos do período viravam vaga normal.
  {
    // 21/12/2026 (segunda) → 04/01/2027 (segunda). Domingos no meio:
    // 27/12/2026 e 03/01/2027.
    const slots = SS.templateSlotsFimDeAno(
      { start: '2026-12-21', end: '2027-01-04', closedDays: ['2026-12-25', '2027-01-01'] },
      [{ id: 'cp' }],
      [{ id: 'manha', startTime: '08:00', endTime: '12:00' }],
      1
    );
    const dias = new Set(slots.map(s => s.day));

    assert.ok(!dias.has('2026-12-27'), 'domingo 27/12 não pode virar vaga');
    assert.ok(!dias.has('2027-01-03'), 'domingo 03/01 não pode virar vaga');
    assert.ok(dias.has('2026-12-28'), 'a segunda seguinte tem que continuar lá');
    assert.ok(!dias.has('2026-12-25'), 'o Natal fechado à mão continua fechado');

    ok('fim de ano pula os domingos sem a gestão precisar marcar');
  }

  // ═══ 5. A lista de feriados separa os domingos ════════════════════
  // A aba Feriados precisa das duas metades: o que sugerir, e quantos ficaram
  // de fora — pra dizer POR QUE o 15/11 sumiu, em vez de sumir calado.
  {
    const feriados = [
      { date: '2026-04-05', name: 'Páscoa' },                    // domingo
      { date: '2026-09-07', name: 'Independência do Brasil' },   // segunda
      { date: '2026-11-15', name: 'Proclamação da República' },  // domingo
      { date: '2026-11-20', name: 'Dia da consciência negra' },  // sexta
    ];
    const r = SS.separarFeriadosPorDomingo(feriados);

    assert.deepStrictEqual(r.uteis.map(f => f.date), ['2026-09-07', '2026-11-20'],
      'só os feriados fora de domingo podem virar sugestão');
    assert.deepStrictEqual(r.domingos.map(f => f.date), ['2026-04-05', '2026-11-15'],
      'os domingos ficam à parte, pra tela poder explicar o sumiço');

    ok('a lista de feriados separa os que caem em domingo');
  }

  // ═══ 6. isDomingo não escorrega de fuso ═══════════════════════════
  // A data chega como 'YYYY-MM-DD' e é lida no meio do dia de propósito:
  // à meia-noite, qualquer fuso negativo joga a data pro dia anterior.
  {
    assert.strictEqual(SS.isDomingo('2026-11-15'), true,  '15/11/2026 é domingo');
    assert.strictEqual(SS.isDomingo('2026-11-14'), false, '14/11/2026 é sábado');
    assert.strictEqual(SS.isDomingo('2026-11-16'), false, '16/11/2026 é segunda');
    assert.strictEqual(SS.isDomingo(''), false, 'string vazia não é domingo');
    assert.strictEqual(SS.isDomingo(null), false, 'nulo não é domingo');

    ok('isDomingo acerta o dia da semana e aguenta lixo na entrada');
  }

  console.log(`\n${n}/${n} — domingo fora da escala ✅`);
})().catch(e => { console.error('\n❌ ' + e.message); process.exit(1); });
