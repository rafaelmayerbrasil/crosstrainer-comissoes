'use strict';
// Smoke do modelo de sidebar (lógica pura, sem DOM). Roda: node scripts/smoke-sidebar.js
const assert = require('assert');
const Nav = require('../professores-nav.js');

function sections(model) { return model.groups.map(g => g.section); }
function ids(model) { return model.groups.flatMap(g => g.items.map(i => i.id)); }

// 1) Admin SEM vínculo de professor: nenhuma seção repetida + ordem por domínio + sem "Minha Agenda"
let m = Nav.buildSidebarModel(['admin'], { hasProfessorLink: false, moduleAccess: { professores: true } });
const secs = sections(m);
assert.deepStrictEqual(secs, [...new Set(secs)], 'Admin: seção repetida na sidebar');
assert.deepStrictEqual(secs, ['Agenda', 'Cadastros', 'Férias', 'Financeiro'], 'Admin: ordem/grupos errados');
assert.ok(!ids(m).includes('minha-agenda'), 'Admin sem vínculo não deve ver Minha Agenda');
assert.ok(!ids(m).includes('home'), 'Início não entra em grupo (é item solto)');

// 2) Admin COM vínculo: ganha grupo "Minhas aulas" com minha-agenda
m = Nav.buildSidebarModel(['admin'], { hasProfessorLink: true, moduleAccess: { professores: true } });
assert.ok(sections(m).includes('Minhas aulas'), 'Admin com vínculo deve ver Minhas aulas');
assert.ok(ids(m).includes('minha-agenda'), 'Admin com vínculo deve ver Minha Agenda');

// 2b) Paridade de permissões: admin_gestao NÃO tem 'pagamentos', e o conjunto de
// páginas renderizadas bate exatamente com PROF_PAGES (nada de novo acesso na reorg).
const ag = Nav.buildSidebarModel(['admin_gestao'], { hasProfessorLink: true, moduleAccess: { professores: true } });
const agIds = ids(ag).concat(ag.home ? ['home'] : []);
assert.ok(!agIds.includes('pagamentos'), 'admin_gestao não deve ter Pagamentos (paridade de permissões)');
assert.deepStrictEqual([...agIds].sort(), [...Nav.allowedPagesFor(['admin_gestao'])].sort(),
  'admin_gestao: páginas renderizadas devem bater com PROF_PAGES');

// 3) Seção de sistema só pra admin
assert.ok(m.systemSection && m.systemSection.items.map(i => i.id).join(',') === 'users,units,audit',
  'Admin deve ter Administração com users,units,audit');
const prof = Nav.buildSidebarModel(['professor'], { hasProfessorLink: true, moduleAccess: { professores: true } });
assert.strictEqual(prof.systemSection, null, 'Professor NÃO pode ter seção de sistema');

// 4) Professor: itens corretos, sem cadastros/fechamento
const pIds = ids(prof);
assert.ok(pIds.includes('agenda-geral') && pIds.includes('minha-agenda') && pIds.includes('meus-pagamentos')
  && pIds.includes('ferias') && pIds.includes('meu-saldo'), 'Professor: itens faltando');
assert.ok(!pIds.includes('fechamento') && !pIds.includes('professores') && !pIds.includes('modalidades'),
  'Professor não pode ver itens de gestão');

// 5) Seletor de módulo: aparece só com 2+ módulos
const one = Nav.buildModuleSwitcher({ professores: true }, 'professores');
assert.strictEqual(one.show, false, '1 módulo → sem seletor');
const two = Nav.buildModuleSwitcher({ professores: true, comissoes: true }, 'professores');
assert.strictEqual(two.show, true, '2 módulos → com seletor');
assert.ok(two.modules.find(x => x.id === 'comissoes').href === 'index.html', 'Comissões aponta pro index.html');

console.log('✓ smoke-sidebar: todos os casos passaram');
