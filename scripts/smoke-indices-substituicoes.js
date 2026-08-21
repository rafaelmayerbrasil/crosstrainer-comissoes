'use strict';
// Roda: node scripts/smoke-indices-substituicoes.js
//
// Uma query do Firestore sem o índice composto certo não derruba a tela: ela
// devolve um erro que o SubstitutionService transforma em `success: false`, e
// quem chamou (a caixa de pedidos da gestão) trata isso como lista vazia.
// Foi exatamente isso que aconteceu em produção — `listAllPending` (status ==
// 'pending' + orderBy requestedAt) não tinha índice, e a tela mostrava
// "Nenhum pedido de substituição pendente na academia" por semanas. Ninguém
// conseguia diferenciar "não tem pedido" de "a consulta está quebrada".
//
// Este smoke não fala com o Firestore — ele lê firestore.indexes.json e
// confere que toda combinação de campos que o SubstitutionService realmente
// consulta (em query, não em memória) tem um índice composto declarado. Se
// alguém adicionar uma consulta nova sem o índice, este teste tem que barrar
// antes que ela chegue em produção do mesmo jeito.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const indexes = JSON.parse(fs.readFileSync(path.join(raiz, 'firestore.indexes.json'), 'utf8'));

const indicesSubstitutions = indexes.indexes.filter(i => i.collectionGroup === 'substitutions');

/**
 * Combinações de campos que o SubstitutionService usa em `.where(...).where(...)`
 * ou `.where(...).orderBy(...)` sobre `substitutions` — na ordem em que aparecem
 * na query, que é a ordem que o Firestore exige no índice composto.
 *
 * `create`'s duplicate check (`where('classId', '==', classId)`) fica de fora
 * de propósito: é filtro de um campo só, e um índice de campo único o
 * Firestore cria sozinho — não precisa (e não pode) entrar aqui.
 */
const consultas = [
  { nome: 'listAllPending / listAguardandoGestao', campos: ['status', 'requestedAt'] },
  { nome: 'listPendingForUser (lado substituto)',  campos: ['substituteTeacherId', 'status'] },
  { nome: 'listPendingForUser (lado titular)',     campos: ['requestingTeacherId', 'status'] },
  { nome: 'listPendingForSubstitute',              campos: ['substituteUserId', 'status', 'requestedAt'] },
];

function temIndice(campos) {
  return indicesSubstitutions.some(idx => {
    const fieldPaths = idx.fields.map(f => f.fieldPath);
    if (fieldPaths.length < campos.length) return false;
    return campos.every((campo, i) => fieldPaths[i] === campo);
  });
}

consultas.forEach(({ nome, campos }) => {
  assert.ok(temIndice(campos),
    `falta índice composto em "substitutions" para [${campos.join(', ')}] — precisa pra ${nome}`);
});
console.log('✓ toda consulta conhecida de SubstitutionService tem índice composto');

console.log('\n✅ smoke-indices-substituicoes: firestore.indexes.json cobre as consultas de substituição');
