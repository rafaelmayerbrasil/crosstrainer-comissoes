'use strict';
// Smoke do pessoas-model (junção pura users⊕teachers — D12). Roda: node scripts/smoke-pessoas-model.js
const assert = require('assert');
const PM = require('../pessoas-model.js');

const teachers = [
  { id: 't1', name: 'Bruno Sem Acesso', email: 'bruno@ct.com', type: 'efetivo' },
  { id: 't2', name: 'Ana Vinculada',    email: 'ana@ct.com',   type: 'estagiario' },
];
const users = [
  { id: 'u1', name: 'Carla Vendedora', email: 'carla@ct.com', profiles: ['vendedor'] },
  { id: 'u2', name: 'Ana Vinculada',   email: 'ana@ct.com',   profiles: ['professor_estagiario'], professorId: 't2' },
  { id: 'u3', name: 'Dono Admin',      email: 'dono@ct.com',  role: 'admin' }, // legado: sem profiles[]
];

const people = PM.buildPeople(users, teachers);

// 1) 4 pessoas: t1 (só teacher), t2+u2 (vinculados = 1), u1, u3
assert.strictEqual(people.length, 4, 'junção deve dar 4 pessoas');

// 2) Professor sem acesso: perfil implícito do type + hasAccess false
const bruno = people.find(p => p.key === 'T:t1');
assert.ok(bruno && !bruno.hasAccess && !bruno.uid, 'Bruno = teacher sem users doc');
assert.deepStrictEqual(bruno.profiles, ['professor'], 'perfil implícito pelo type efetivo');

// 3) Vinculada: merge — identidade do teacher (fonte da verdade, §3) + uid do user
const ana = people.find(p => p.key === 'T:t2');
assert.ok(ana && ana.hasAccess && ana.uid === 'u2' && ana.teacherId === 't2', 'Ana = vinculada');
assert.deepStrictEqual(ana.profiles, ['professor_estagiario']);
assert.ok(!people.find(p => p.key === 'U:u2'), 'user vinculado não duplica na lista');

// 4) Só de login: legado role → profiles
const dono = people.find(p => p.key === 'U:u3');
assert.deepStrictEqual(dono.profiles, ['admin'], 'role legado vira profiles');
assert.ok(dono.hasAccess && !dono.teacher, 'user-only não tem entidade teacher');

// 5) Ordenação por nome
assert.deepStrictEqual(people.map(p => p.name),
  ['Ana Vinculada', 'Bruno Sem Acesso', 'Carla Vendedora', 'Dono Admin'], 'ordenado por nome');

// 6) Filtros
assert.strictEqual(PM.filterPeople(people, { search: 'ana' }).length, 1, 'busca por nome');
assert.strictEqual(PM.filterPeople(people, { search: 'carla@ct.com' }).length, 1, 'busca por email');
assert.strictEqual(PM.filterPeople(people, { profile: 'professor' }).length, 1, 'filtro perfil implícito');
assert.strictEqual(PM.filterPeople(people, { profile: 'sem-acesso' }).length, 1, 'filtro sem-acesso');
assert.strictEqual(PM.filterPeople(people, {}).length, 4, 'sem filtro = todos');

// 7) professorId apontando pra teacher inexistente → pessoa user-only (vínculo quebrado não some)
const broken = PM.buildPeople([{ id: 'u9', name: 'Zé Quebrado', profiles: ['professor'], professorId: 'tX' }], teachers);
assert.ok(broken.find(p => p.key === 'U:u9'), 'vínculo quebrado vira user-only, não desaparece');

// 8) E-MAIL: a tela tem que mostrar o que serve pra ENTRAR
//
// Caso real (22/08/2026): a Eduarda não conseguia redefinir a senha "de jeito
// nenhum". O e-mail da ficha dela é eduarda.s.velez@gmail.com, mas o login é
// mariaeduarddasantoss@gmail.com. O Hub mostrava o da ficha (`t.email` vinha
// primeiro), o Benny passou esse endereço pra ela, e o Firebase — que de
// propósito não avisa quando o e-mail não existe — respondia "enviamos" e não
// mandava nada. Quatro professores estavam nessa situação.
const comDivergencia = PM.buildPeople(
  [{ id: 'uE', name: 'Eduarda', profiles: ['professor_estagiario'], professorId: 'tE', email: 'login@gmail.com' }],
  [{ id: 'tE', name: 'Eduarda', email: 'contato@gmail.com', isActive: true }]
);
const eduarda = comDivergencia.find(p => p.teacherId === 'tE');
assert.strictEqual(eduarda.email, 'login@gmail.com',
  'com login, a pessoa é identificada pelo e-mail de ACESSO — é ele que redefine senha');
assert.strictEqual(eduarda.emailContato, 'contato@gmail.com', 'o de contato continua disponível');
assert.strictEqual(eduarda.emailDivergente, true, 'e a divergência fica marcada, pra tela poder avisar');

// Sem login ainda (cadastrado pela planilha, acesso vem depois): vale o da ficha
const semLogin = PM.buildPeople([], [{ id: 'tS', name: 'Só ficha', email: 'ficha@gmail.com', isActive: true }]);
assert.strictEqual(semLogin[0].email, 'ficha@gmail.com',
  'sem login, o e-mail da ficha é o único que existe — é por ele que a pessoa é convidada');
assert.strictEqual(semLogin[0].emailDivergente, false, 'sem login não há o que divergir');

// Iguais: nada a avisar
const iguais = PM.buildPeople(
  [{ id: 'uI', name: 'Igual', profiles: ['professor'], professorId: 'tI', email: 'mesmo@gmail.com' }],
  [{ id: 'tI', name: 'Igual', email: 'MESMO@gmail.com', isActive: true }]
);
assert.strictEqual(iguais[0].emailDivergente, false, 'diferença só de maiúscula não é divergência');

// A busca tem que achar pelos DOIS endereços — quem procura pode ter qualquer um
assert.strictEqual(PM.filterPeople(comDivergencia, { search: 'contato@gmail.com' }).length, 1,
  'busca acha pelo e-mail de contato');
assert.strictEqual(PM.filterPeople(comDivergencia, { search: 'login@gmail.com' }).length, 1,
  'e pelo de acesso');
console.log('✓ e-mail: a tela mostra o que serve pra entrar');

console.log('✓ smoke-pessoas-model: todos os casos passaram');
