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

console.log('✓ smoke-pessoas-model: todos os casos passaram');
