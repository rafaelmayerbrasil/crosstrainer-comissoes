'use strict';
// Roda: node scripts/smoke-scale-rebalance.js
//
// Pedido 2 do Rodrigo (28/08/2026): "ajustar a frequência de uma pessoa deve
// rebalancear os outros". Regra confirmada pelo Rafael no mesmo dia: tira de
// quem tem MAIS, empate desempata pela PONTUAÇÃO, empate de novo SORTEIA.
//
// Motor PURO: nada de mock de Firebase aqui, as funções são chamadas de
// verdade. Ler o texto do arquivo não prova nada ([[previa-nunca-rodou]]).
const assert = require('assert');
const RB = require('../scale-rebalance.js');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

const vaga = (id, mod, pid) => ({ id, unitId: 'cp', requiredModalityId: mod, requiredModalityName: mod, assignedPersonId: pid || null });
const data = (date, slots, published) => ({ scaleId: `sc_${date}`, date, published: !!published, slots });

// rng determinístico: sempre o primeiro da lista de empatados
const rngZero = () => 0;

// ── reduzir: sai de um dia e entra quem tem MENOS ──
{
  const datas = [
    data('2026-09-05', [vaga('v1', 'TOI', 'hel'), vaga('v2', 'HIIT', 'bru')]),
    data('2026-10-17', [vaga('v1', 'TOI', 'hel'), vaga('v2', 'HIIT', 'bru')]),
  ];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 10, dias: 2 },
    { id: 'bru', modalityIds: ['HIIT'], merito: 10, dias: 2 },
    { id: 'car', modalityIds: ['TOI'], merito: 5, dias: 0 },
    { id: 'duda', modalityIds: ['TOI'], merito: 9, dias: 1 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 1, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.atual, 2, 'ela tem 2 dias hoje');
  assert.ok(p.atingiu, 'chegou no alvo');
  assert.strictEqual(p.movimentos.length, 1, 'um movimento só');
  assert.strictEqual(p.movimentos[0].date, '2026-10-17', 'a data mais distante sai primeiro');
  assert.strictEqual(p.movimentos[0].saiId, 'hel');
  assert.strictEqual(p.movimentos[0].entraId, 'car', 'entra quem tem MENOS dias');
  passou('reduzir tira do dia mais distante e chama quem tem menos dias');
}

// ── empate no rodízio desempata pela pontuação ──
{
  const datas = [data('2026-10-17', [vaga('v1', 'TOI', 'hel')])];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 10, dias: 1 },
    { id: 'car', modalityIds: ['TOI'], merito: 5, dias: 0 },
    { id: 'duda', modalityIds: ['TOI'], merito: 9, dias: 0 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos[0].entraId, 'duda', 'empatados em 0 dias, ganha a maior pontuação');
  passou('empate no rodízio desempata pela pontuação');
}

// ── empate na pontuação sorteia ──
{
  const datas = [data('2026-10-17', [vaga('v1', 'TOI', 'hel')])];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 10, dias: 1 },
    { id: 'aaa', modalityIds: ['TOI'], merito: 5, dias: 0 },
    { id: 'zzz', modalityIds: ['TOI'], merito: 5, dias: 0 },
  ];
  const primeiro = RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos, rng: () => 0 });
  const segundo = RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos, rng: () => 0.99 });
  assert.strictEqual(primeiro.movimentos[0].entraId, 'aaa');
  assert.strictEqual(segundo.movimentos[0].entraId, 'zzz');
  passou('empate na pontuação vai pro sorteio');
}

// ── não deixa vaga aberta ──
{
  const datas = [data('2026-10-17', [vaga('v1', 'TOI', 'hel')])];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 10, dias: 1 },
    { id: 'bru', modalityIds: ['HIIT'], merito: 1, dias: 0 },   // não dá TOI
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos.length, 0, 'não mexeu');
  assert.strictEqual(p.atingiu, false, 'e diz que não chegou no alvo');
  assert.ok(/17\/10/.test(p.avisos.join(' ')), 'o aviso nomeia o dia que ficou como estava');
  passou('sem quem entrar, o dia fica como está e o aviso explica');
}

// ── férias e vizinhança ──
{
  const datas = [
    data('2026-10-10', [vaga('v1', 'TOI', 'car')]),
    data('2026-10-17', [vaga('v1', 'TOI', 'hel')]),
  ];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 10, dias: 1 },
    { id: 'car', modalityIds: ['TOI'], merito: 9, dias: 1 },   // pegou 10/10, vizinha de 17/10
    { id: 'duda', modalityIds: ['TOI'], merito: 1, dias: 0, indisponivel: ['2026-10-17'] },
    { id: 'edu', modalityIds: ['TOI'], merito: 1, dias: 5 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos[0].entraId, 'edu',
    'car está a 7 dias e duda de férias: sobra edu, mesmo com 5 dias');
  passou('respeita férias e a regra de não pegar dois sábados seguidos');
}

// ── vizinhança é PREFERÊNCIA, não proibição (Rafael, 28/08) ──────────────
// "Preferencialmente não pegar dois sábados seguidos". Quando não sobra mais
// ninguém, é melhor usar quem está no sábado vizinho do que devolver
// "não consegui" e deixar a gestão travada — o dia continua com professor.
{
  const datas = [
    data('2026-10-10', [vaga('v1', 'TOI', 'car')]),
    data('2026-10-17', [vaga('v1', 'TOI', 'hel')]),
  ];
  // Só a car é elegível, e ela está no sábado vizinho (10/10).
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 10, dias: 1 },
    { id: 'car', modalityIds: ['TOI'], merito: 9, dias: 1 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos.length, 1, 'com regra dura isto devolveria zero movimento');
  assert.strictEqual(p.movimentos[0].entraId, 'car', 'usa a vizinha quando ela é a única saída');
  passou('vizinhança é preferência: sem alternativa, escala a vizinha em vez de recusar');
}

// ── e aumentar segue a mesma preferência ─────────────────────────────────
{
  const datas = [
    data('2026-10-17', [vaga('v1', 'TOI', 'hel')]),   // ela já está aqui
    data('2026-10-10', [vaga('v1', 'TOI', 'car')]),   // vizinha de 17/10, e é a ÚNICA outra
  ];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 1, dias: 1 },
    { id: 'car', modalityIds: ['TOI'], merito: 9, dias: 5 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 2, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos.length, 1, 'com regra dura isto devolveria zero movimento');
  assert.strictEqual(p.movimentos[0].date, '2026-10-10', 'sem outro dia livre, usa o vizinho');
  passou('aumentar também trata a vizinhança como preferência, não como muro');
}

// ── nada a fazer ──
{
  const datas = [data('2026-10-17', [vaga('v1', 'TOI', 'hel')])];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 1, datas, candidatos: [{ id: 'hel', modalityIds: ['TOI'], merito: 1, dias: 1 }], rng: rngZero });
  assert.deepStrictEqual(p.movimentos, [], 'alvo igual ao atual não move nada');
  assert.ok(p.atingiu);
  passou('alvo igual ao atual não mexe em nada');
}

// ── o sorteio é reproduzível SEM rng injetado ──
// Sem isto a prévia mostraria um plano e o "Aplicar" gravaria outro. O motor
// não pode chamar Math.random(): a semente sai das próprias entradas.
{
  const datas = [data('2026-10-17', [vaga('v1', 'TOI', 'hel')])];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 10, dias: 1 },
    { id: 'aaa', modalityIds: ['TOI'], merito: 5, dias: 0 },
    { id: 'zzz', modalityIds: ['TOI'], merito: 5, dias: 0 },
  ];
  const a = RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos });
  const b = RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos });
  const c = RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos });
  assert.deepStrictEqual(a, b, 'mesma entrada, mesmo plano');
  assert.deepStrictEqual(a, c, 'e de novo');
  assert.strictEqual(a.movimentos[0].motivo, 'sorteio', 'e foi mesmo pelo sorteio');
  // a ORDEM da lista de candidatos não pode mudar o resultado
  const invertido = RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos: candidatos.slice().reverse() });
  assert.strictEqual(invertido.movimentos[0].entraId, a.movimentos[0].entraId,
    'trocar a ordem da lista não muda o sorteio');
  // e é sorteio de verdade: semente diferente troca o vencedor
  const vencedores = new Set();
  for (let i = 0; i < 30; i++) {
    vencedores.add(RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos, semente: 's' + i }).movimentos[0].entraId);
  }
  assert.deepStrictEqual(Array.from(vencedores).sort(), ['aaa', 'zzz'],
    'o sorteio sorteia mesmo — não favorece quem tem nome no começo do alfabeto');
  passou('sorteio reproduzível: mesma entrada = mesmo plano, e ainda é sorteio');
}

// ── ninguém em duas vagas do MESMO DIA, mesmo com duas escalas na data ──
{
  const datas = [
    Object.assign(data('2026-10-17', [vaga('v1', 'TOI', 'hel')]), { scaleId: 'sc_a' }),
    Object.assign(data('2026-10-17', [vaga('v2', 'TOI', 'car')]), { scaleId: 'sc_b' }),
  ];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 10, dias: 2 },
    { id: 'car', modalityIds: ['TOI'], merito: 9, dias: 0 },   // já trabalha nesse dia, na outra escala
    { id: 'edu', modalityIds: ['TOI'], merito: 1, dias: 5 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos.length, 1);
  assert.strictEqual(p.movimentos[0].entraId, 'edu',
    'car já está numa vaga desse dia — não pode pegar a segunda');
  passou('duas escalas na mesma data não geram dupla escalação');
}

// ── alvo inválido não esvazia a escala ──
{
  const datas = [data('2026-10-17', [vaga('v1', 'TOI', 'hel')])];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 10, dias: 1 },
    { id: 'car', modalityIds: ['TOI'], merito: 5, dias: 0 },
  ];
  ['', null, undefined, 'abc', NaN, -1, 1.5].forEach(alvo => {
    const p = RB.planejar({ pessoaId: 'hel', alvo, datas, candidatos, rng: rngZero });
    assert.deepStrictEqual(p.movimentos, [], 'alvo ' + String(alvo) + ' não pode mover nada');
    assert.strictEqual(p.atingiu, false);
    assert.ok(/inv[áa]lido/i.test(p.avisos.join(' ')), 'e diz que o alvo é inválido');
  });
  passou('alvo inválido não vira 0 nem esvazia a escala');
}

// ── quem bloqueou o dia não é chamado ──
{
  const datas = [data('2026-10-17', [vaga('v1', 'TOI', 'hel')])];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 10, dias: 3 },
    { id: 'car', modalityIds: ['TOI'], merito: 9, dias: 0, pref: 'nao_posso' },
    { id: 'edu', modalityIds: ['TOI'], merito: 1, dias: 4 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos[0].entraId, 'edu', 'car disse que não pode nesse dia');
  passou('quem marcou "não posso" não é escalado pelo rebalanceio');
}

// ── cota é teto MACIO ──
{
  const datas = [data('2026-10-17', [vaga('v1', 'TOI', 'hel')])];
  const base = [
    { id: 'hel', modalityIds: ['TOI'], merito: 10, dias: 3 },
    { id: 'car', modalityIds: ['TOI'], merito: 9, dias: 0, cota: 0 },   // já bateu a própria cota
    { id: 'edu', modalityIds: ['TOI'], merito: 1, dias: 4 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos: base, rng: rngZero });
  assert.strictEqual(p.movimentos[0].entraId, 'edu',
    'quem bateu a cota vai pro fim da fila, mesmo tendo menos dias');
  // …mas se ela for a única, entra assim mesmo — vaga aberta é aula que não existe
  const so = RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos: base.slice(0, 2), rng: rngZero });
  assert.strictEqual(so.movimentos[0].entraId, 'car', 'teto macio: sozinha, ela entra');
  passou('cota é teto macio — fim da fila, nunca vaga aberta');
}

// ── o plano não toca na entrada ──
{
  const datas = [
    data('2026-09-05', [vaga('v1', 'TOI', 'hel')]),
    data('2026-10-17', [vaga('v1', 'TOI', 'hel')]),
  ];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 10, dias: 2 },
    { id: 'car', modalityIds: ['TOI'], merito: 5, dias: 0 },
    { id: 'edu', modalityIds: ['TOI'], merito: 5, dias: 1 },
  ];
  const antes = JSON.stringify({ datas, candidatos });
  const p = RB.planejar({ pessoaId: 'hel', alvo: 0, datas, candidatos, rng: rngZero });
  assert.ok(p.movimentos.length >= 1);
  assert.strictEqual(JSON.stringify({ datas, candidatos }), antes,
    'planejar é prévia: não pode alterar a escala que a tela está mostrando');
  passou('planejar não muta a entrada — é plano, não efeito');
}

// ── data já publicada só é mexida depois da não publicada ──
{
  const datas = [
    data('2026-09-05', [vaga('v1', 'TOI', 'hel')], true),    // publicada, mais distante
    data('2026-09-26', [vaga('v1', 'TOI', 'hel')], false),
  ];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 10, dias: 2 },
    { id: 'car', modalityIds: ['TOI'], merito: 5, dias: 0 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 1, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos.length, 1);
  assert.strictEqual(p.movimentos[0].date, '2026-09-26', 'mexe primeiro na que ninguém viu ainda');
  assert.strictEqual(p.movimentos[0].published, false, 'e o serviço sabe que não precisa avisar');
  passou('publicada pode ser mexida, mas só depois da não publicada');
}

// ── aumentar: tira de quem tem MAIS dias ──
{
  const datas = [
    data('2026-09-05', [vaga('v1', 'TOI', 'bru')]),
    data('2026-10-17', [vaga('v1', 'TOI', 'edu')]),
  ];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 5, dias: 0 },
    { id: 'bru', modalityIds: ['TOI'], merito: 5, dias: 4 },
    { id: 'edu', modalityIds: ['TOI'], merito: 5, dias: 1 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 1, datas, candidatos, rng: rngZero });
  assert.ok(p.atingiu, 'chegou no alvo');
  assert.strictEqual(p.movimentos.length, 1);
  assert.strictEqual(p.movimentos[0].entraId, 'hel');
  assert.strictEqual(p.movimentos[0].saiId, 'bru', 'sai quem tem MAIS dias');
  assert.strictEqual(p.movimentos[0].date, '2026-09-05', 'a data mais próxima entra primeiro');
  passou('aumentar tira de quem tem mais dias');
}

// ── aumentar: empate em dias desempata pela MENOR pontuação ──
{
  const datas = [
    data('2026-09-05', [vaga('v1', 'TOI', 'bru')]),
    data('2026-09-26', [vaga('v1', 'TOI', 'edu')]),
  ];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 5, dias: 0 },
    { id: 'bru', modalityIds: ['TOI'], merito: 9, dias: 3 },
    { id: 'edu', modalityIds: ['TOI'], merito: 2, dias: 3 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 1, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos[0].saiId, 'edu',
    'empatados em 3 dias, quem sai é quem tem a MENOR pontuação');
  passou('aumentar: empate em dias sai o de menor pontuação');
}

// ── aumentar: ninguém tem mais dias que ela ──
{
  const datas = [data('2026-09-05', [vaga('v1', 'TOI', 'bru')])];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 5, dias: 3 },
    { id: 'bru', modalityIds: ['TOI'], merito: 5, dias: 1 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 4, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos.length, 0, 'não tira de quem já tem menos que ela');
  assert.strictEqual(p.atingiu, false);
  assert.ok(/05\/09/.test(p.avisos.join(' ')), 'o aviso nomeia o dia');
  passou('aumentar não tira de quem já tem menos dias que ela');
}

// ── aumentar: respeita férias (indisponibilidade) ──
{
  const datas = [
    data('2026-09-05', [vaga('v1', 'TOI', 'zzz')]),   // mais próxima, mas hel está de férias
    data('2026-10-17', [vaga('v1', 'TOI', 'edu')]),
  ];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 1, dias: 0, indisponivel: ['2026-09-05'] },
    { id: 'zzz', modalityIds: ['TOI'], merito: 9, dias: 5 },
    { id: 'edu', modalityIds: ['TOI'], merito: 9, dias: 5 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 1, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos.length, 1);
  assert.strictEqual(p.movimentos[0].date, '2026-10-17', 'pulou 05/09 — ela está de férias nesse dia');
  assert.strictEqual(p.movimentos[0].saiId, 'edu');
  passou('aumentar respeita férias — não entra em data que ela marcou indisponível');
}

// ── aumentar: "não posso" da PRÓPRIA pessoa é restrição dura ──────────────
// O ramo de reduzir já barra candidato com `nao_posso`. Aumentar por cima do
// "não posso" dela seria o sistema escalando alguém contra o que a própria
// pessoa respondeu — e "não posso" nunca foi negociável neste sistema.
{
  const datas = [
    data('2026-10-17', [vaga('v1', 'TOI', 'hel')]),
    data('2026-10-31', [vaga('v1', 'TOI', 'edu')]),
  ];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 1, dias: 1, pref: 'nao_posso' },
    { id: 'edu', modalityIds: ['TOI'], merito: 9, dias: 5 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 2, datas, candidatos, rng: rngZero });
  assert.deepStrictEqual(p.movimentos, [], 'quem disse "não posso" não ganha dia por rebalanceio');
  assert.ok(p.avisos.some(a => /não posso/.test(a)), 'e a gestão fica sabendo por quê');
  assert.strictEqual(p.atingiu, false, 'não finge que atingiu o alvo');
  passou('aumentar não passa por cima do "não posso" da própria pessoa');
}

// ── aumentar: mesma pessoa não pega dois sábados seguidos (vizinhança) ──
{
  const datas = [
    data('2026-10-17', [vaga('v1', 'TOI', 'hel')]),        // ela já está aqui
    data('2026-10-10', [vaga('v1', 'TOI', 'car')]),        // a 7 dias de 17/10 — vizinha, não pode
    data('2026-10-31', [vaga('v1', 'TOI', 'edu')]),        // a 14 dias — livre
  ];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 1, dias: 1 },
    { id: 'car', modalityIds: ['TOI'], merito: 9, dias: 5 },
    { id: 'edu', modalityIds: ['TOI'], merito: 9, dias: 5 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 2, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos.length, 1);
  assert.strictEqual(p.movimentos[0].date, '2026-10-31', '10/10 é vizinha de um dia que ela já pegou');
  assert.strictEqual(p.movimentos[0].saiId, 'edu');
  passou('aumentar respeita a vizinhança — não pega dois sábados seguidos');
}

// ── aumentar: só entra em vaga de modalidade que ela dá ──
{
  const datas = [
    data('2026-09-05', [vaga('v1', 'HIIT', 'bru')]),   // mais próxima, mas ela não dá HIIT
    data('2026-09-26', [vaga('v1', 'TOI', 'edu')]),
  ];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 1, dias: 0 },
    { id: 'bru', modalityIds: ['HIIT'], merito: 9, dias: 5 },
    { id: 'edu', modalityIds: ['TOI'], merito: 9, dias: 5 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 1, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos.length, 1);
  assert.strictEqual(p.movimentos[0].date, '2026-09-26', 'pulou 05/09 — vaga de HIIT, ela só dá TOI');
  assert.ok(/05\/09/.test(p.avisos.join(' ')), 'e avisou sobre o dia pulado');
  passou('aumentar só entra em vaga de modalidade que ela dá');
}

// ── aumentar: não entra numa segunda vaga do mesmo dia ──
{
  const datas = [
    data('2026-09-05', [vaga('v1', 'TOI', 'hel'), vaga('v2', 'HIIT', 'bru')]),  // ela já está nesse dia
    data('2026-09-26', [vaga('v1', 'TOI', 'edu')]),
  ];
  // hel habilitada em TOI e HIIT de propósito — se a vaga v2 de 05/09 fosse
  // elegível por modalidade, o teste não provaria nada sobre "mesmo dia".
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI', 'HIIT'], merito: 1, dias: 1 },
    { id: 'bru', modalityIds: ['HIIT'], merito: 9, dias: 5 },
    { id: 'edu', modalityIds: ['TOI'], merito: 9, dias: 5 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 2, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos.length, 1);
  assert.strictEqual(p.movimentos[0].date, '2026-09-26',
    '05/09 ela já está escalada (v1) — não pode entrar de novo na v2 do mesmo dia');
  assert.strictEqual(p.movimentos[0].saiId, 'edu');
  passou('aumentar não bota a mesma pessoa em duas vagas do mesmo dia');
}

// ── aumentar: cota é teto MACIO (não impede a ENTRADA de quem bateu cota) ──
// Cota decide quem entra no ramo de reduzir; no ramo de aumentar quem "entra"
// é a própria pessoa ajustada — a cota dela não pode travar o pedido da gestão.
{
  const datas = [data('2026-09-05', [vaga('v1', 'TOI', 'bru')])];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 5, dias: 0, cota: 0 },   // já bateu a própria cota
    { id: 'bru', modalityIds: ['TOI'], merito: 5, dias: 3 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 1, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos.length, 1, 'a cota da própria hel não bloqueia o pedido de aumento');
  assert.strictEqual(p.movimentos[0].entraId, 'hel');
  passou('aumentar: cota da pessoa ajustada não impede o rebalanceio a favor dela');
}

// ── aumentar: data já publicada só é mexida depois da não publicada ──
{
  const datas = [
    data('2026-09-05', [vaga('v1', 'TOI', 'bru')], true),     // publicada, mais próxima
    data('2026-09-26', [vaga('v1', 'TOI', 'edu')], false),
  ];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 5, dias: 0 },
    { id: 'bru', modalityIds: ['TOI'], merito: 5, dias: 3 },
    { id: 'edu', modalityIds: ['TOI'], merito: 5, dias: 3 },
  ];
  const p = RB.planejar({ pessoaId: 'hel', alvo: 1, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos.length, 1);
  assert.strictEqual(p.movimentos[0].date, '2026-09-26', 'mexe primeiro na que ninguém viu ainda');
  assert.strictEqual(p.movimentos[0].published, false, 'e o serviço sabe que não precisa avisar');
  passou('aumentar: publicada pode ser mexida, mas só depois da não publicada');
}

// ── aumentar: plano não muta a entrada ──
{
  const datas = [data('2026-09-05', [vaga('v1', 'TOI', 'bru')])];
  const candidatos = [
    { id: 'hel', modalityIds: ['TOI'], merito: 5, dias: 0 },
    { id: 'bru', modalityIds: ['TOI'], merito: 5, dias: 3 },
  ];
  const antes = JSON.stringify({ datas, candidatos });
  const p = RB.planejar({ pessoaId: 'hel', alvo: 1, datas, candidatos, rng: rngZero });
  assert.strictEqual(p.movimentos.length, 1);
  assert.strictEqual(JSON.stringify({ datas, candidatos }), antes,
    'planejar é prévia: não pode alterar a escala que a tela está mostrando, também no ramo de aumentar');
  passou('aumentar: planejar não muta a entrada');
}

const TOTAL = 26;
assert.strictEqual(ok, TOTAL, `esperava ${TOTAL} blocos, rodaram ${ok}`);
console.log(`\n${ok}/${TOTAL} blocos OK`);
