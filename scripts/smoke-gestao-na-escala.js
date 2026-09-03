'use strict';
// Roda: node scripts/smoke-gestao-na-escala.js
//
// ══════════════════════════════════════════════════════════════════════
// A gestão que dá aula também entra na escala
// ══════════════════════════════════════════════════════════════════════
//
// Rafael Rojais, no grupo, 03/09/2026 09h43: "O Will e nem eu ainda podemos
// entrar na escala dos professores".
//
// Eram TRÊS bloqueios empilhados, conferidos na base de produção:
//   1. nenhum dos dois tem ficha em `teachers` — e a escala sorteia entre as
//      fichas, não entre os perfis de /users;
//   2. não existia caminho na tela pra dar ficha a quem JÁ tem login (a ficha
//      só nascia pelo assistente "Nova pessoa", que cria ficha + login juntos);
//   3. quem é admin ou supervisão sempre caía na visão de gestão da Escala
//      Inteligente — os botões "Prefiro / Pode ser / Não posso" não tinham
//      como aparecer.
//
// As duas decisões viraram função pura, em módulo requerível, justamente pra
// este arquivo poder CHAMÁ-LAS.

const assert = require('assert');
const SS = require('../scale-service.js');
const PM = require('../pessoas-model.js');

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);
const ids = arr => arr.map(t => t.id);

// ═══ Peça B — quem vê "Minhas datas" na Escala Inteligente ═══════════

// 1. Gestão COM ficha de professor ganha a aba
{
  const abas = SS.abasDaEscala({ gestao: true, temFicha: true });
  assert.ok(ids(abas).includes('minhas'),
    'gestão com ficha de professor precisa da aba "Minhas datas"');
  assert.strictEqual(ids(abas)[ids(abas).length - 1], 'minhas',
    'a aba nova entra no fim, sem empurrar as que a gestão já conhece');
  assert.ok(ids(abas).includes('pessoa'),
    'a visão de gestão continua inteira — a aba é acréscimo, não troca');
  ok('gestão com ficha de professor ganha a aba "Minhas datas"');
}

// 2. Gestão SEM ficha não vê nada de novo (Rodrigo, Benny)
{
  const abas = SS.abasDaEscala({ gestao: true, temFicha: false });
  assert.ok(!ids(abas).includes('minhas'),
    'gestão sem ficha não tem onde se candidatar — a aba mentiria');
  assert.deepStrictEqual(ids(abas),
    ['sabado', 'feriado', 'evento', 'fim_de_ano', 'escola_interna', 'pessoa'],
    'as abas da gestão continuam exatamente as de hoje');
  ok('gestão sem ficha de professor não vê a aba nova');
}

// 3. Professor não vê "Por pessoa" nem "Minhas datas"
// "Por pessoa" é o painel de equilíbrio da gestão. Ele aparecia na barra do
// professor e caía em Escola Interna, porque a rota nem existe do lado dele.
// E "Minhas datas" seria redundante: a tela inteira dele já é isso.
{
  const abas = SS.abasDaEscala({ gestao: false, temFicha: true });
  assert.ok(!ids(abas).includes('pessoa'),
    '"Por pessoa" é ferramenta de gestão — no professor levava pra tela errada');
  assert.ok(!ids(abas).includes('minhas'),
    'a tela do professor já é "minhas datas" inteira');
  assert.deepStrictEqual(ids(abas),
    ['sabado', 'feriado', 'evento', 'fim_de_ano', 'escola_interna'],
    'o professor fica com as cinco abas que fazem sentido pra ele');
  ok('professor não vê "Por pessoa" nem "Minhas datas"');
}

// 4. Toda aba tem rótulo — barra com botão vazio não é clicável de propósito
{
  [{ gestao: true, temFicha: true }, { gestao: false, temFicha: false }].forEach(ctx => {
    SS.abasDaEscala(ctx).forEach(t => {
      assert.ok(t.label && t.label.trim(), 'aba sem rótulo: ' + JSON.stringify(t));
    });
  });
  ok('toda aba tem rótulo nos dois públicos');
}

// ═══ Peça A — dar ficha de professor a quem já tem login ═════════════

const comFicha = {
  key: 'T:t1', teacherId: 't1', uid: 'u1', name: 'Karin',
  teacher: { id: 't1', name: 'Karin', type: 'efetivo' }, user: { id: 'u1' },
};
const soLogin = {
  key: 'U:u2', teacherId: null, uid: 'u2', name: 'Rafael Rojais',
  teacher: null, user: { id: 'u2', profiles: ['admin', 'professor'] },
};

// 5. Quem só tem login ganha a aba Professor — é por ela que a ficha nasce
{
  const abas = PM.tabsFor(soLogin, { admin: true, salario: true });
  assert.ok(ids(abas).includes('professor'),
    'sem essa aba não existe caminho na tela pra dar ficha a quem já tem login');
  assert.ok(!ids(abas).includes('salarial'),
    'salário depende da ficha — sem ficha não há o que mostrar');
  ok('pessoa só com login ganha a aba Professor (onde a ficha é criada)');
}

// 6. Quem já tem ficha continua com as quatro abas de sempre
{
  const abas = PM.tabsFor(comFicha, { admin: true, salario: true });
  assert.deepStrictEqual(ids(abas), ['identidade', 'professor', 'salarial', 'acesso'],
    'a ficha de quem já é professor não pode mudar');
  ok('quem já tem ficha continua com identidade, professor, salário e acesso');
}

// 7. Criar ficha é só de admin
{
  const abas = PM.tabsFor(soLogin, { admin: false, salario: true });
  assert.ok(!ids(abas).includes('professor'),
    'quem não é admin não pode criar ficha de professor pra ninguém');
  assert.ok(!ids(abas).includes('acesso'), 'a aba Acesso já era só de admin');
  assert.deepStrictEqual(ids(abas), ['identidade'], 'sobra só Identidade');
  ok('só admin vê a aba Professor de quem ainda não tem ficha');
}

// 8. Sem direito a salário, a aba de salário não aparece nem com ficha
{
  const abas = PM.tabsFor(comFicha, { admin: false, salario: false });
  assert.ok(!ids(abas).includes('salarial'), 'dado salarial é só de admin');
  assert.ok(ids(abas).includes('professor'), 'a aba Professor de quem TEM ficha segue visível');
  ok('sem direito a salário a aba 🔒 Salário não aparece');
}

console.log(`\n${n}/${n} — a gestão que dá aula entra na escala ✅`);
