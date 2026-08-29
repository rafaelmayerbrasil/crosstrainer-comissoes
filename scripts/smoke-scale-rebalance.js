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

const TOTAL = 13;
assert.strictEqual(ok, TOTAL, `esperava ${TOTAL} blocos, rodaram ${ok}`);
console.log(`\n${ok}/${TOTAL} blocos OK`);
