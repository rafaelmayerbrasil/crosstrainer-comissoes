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
  { nome: 'listAllPending / listAguardandoGestao',    campos: ['status', 'requestedAt'] },
  { nome: 'listPendingForTeacher (lado substituto)',  campos: ['substituteTeacherId', 'status'] },
  { nome: 'listPendingForTeacher (lado titular)',     campos: ['requestingTeacherId', 'status'] },
  { nome: 'listPendingForSubstitute',                 campos: ['substituteUserId', 'status', 'requestedAt'] },
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

// Tripwire: `consultas` acima é mantida à mão, e nada obriga quem adiciona uma
// query nova sobre `substitutions` a lembrar de também adicioná-la aqui — o
// próprio bug que este arquivo existe pra pegar. Contar as ocorrências de
// `.collection('substitutions')` em professores-shared.js e travar o número
// não prova que toda query nova tem índice, mas garante que ninguém mexe
// nesse conjunto de queries sem esbarrar neste teste e ser obrigado a olhar
// pra `consultas` — falha alto e cedo em vez de silenciosamente.
const shared = fs.readFileSync(path.join(raiz, 'professores-shared.js'), 'utf8');
const OCORRENCIAS_CONHECIDAS = 12;
const ocorrencias = (shared.match(/\.collection\('substitutions'\)/g) || []).length;
assert.strictEqual(ocorrencias, OCORRENCIAS_CONHECIDAS,
  `professores-shared.js tem ${ocorrencias} usos de .collection('substitutions'), esperava ${OCORRENCIAS_CONHECIDAS}. `
  + `Se você adicionou (ou removeu) uma consulta, atualize OCORRENCIAS_CONHECIDAS aqui E, se for uma `
  + `query nova com where()/orderBy(), adicione-a à lista \`consultas\` acima e confira o índice em firestore.indexes.json.`);
console.log('✓ nenhuma consulta nova sobre substitutions passou batido da lista `consultas`');

console.log('\n✅ smoke-indices-substituicoes: firestore.indexes.json cobre as consultas de substituição');
