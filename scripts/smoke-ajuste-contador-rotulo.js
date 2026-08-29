'use strict';
// Roda: node scripts/smoke-ajuste-contador-rotulo.js
//
// O "+ dias fora" ACABOU em 28/08/2026 (pedido 1 do Rodrigo, aprovado pelo
// Rafael): a contagem vem só das escalas. Este arquivo virou a trava contra a
// volta dele — se alguém reintroduzir o caminho manual, quebra aqui.
const assert = require('assert');
const fs = require('fs');

const ui = fs.readFileSync(`${__dirname}/../professores-escala-smart.js`, 'utf8');
const svc = fs.readFileSync(`${__dirname}/../scale-service.js`, 'utf8');

assert.ok(!/ajustarContadorJustica/.test(ui), 'a função do ajuste manual não existe mais na tela');
assert.ok(!/ajusteMap/.test(ui), 'o mapa de ajustes saiu do estado da tela');
assert.ok(!/ajusteById/.test(ui), 'a tela não manda mais ajuste pro motor');
assert.ok(!/\+ dias fora/.test(ui), 'o botão "+ dias fora" saiu da tela');
assert.ok(!/saveAjustePartida|listAjustes|getFairness/.test(svc), 'o serviço não tem mais ajuste de partida');
assert.ok(!/ajusteById/.test(svc), 'o motor não lê mais ajuste de partida');

console.log('✓ smoke-ajuste-contador-rotulo: o ajuste manual não voltou (6/6)');
