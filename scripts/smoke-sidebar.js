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
assert.deepStrictEqual(secs, ['Agenda', 'Engajamento', 'PLR', 'Cadastros', 'Férias', 'Financeiro'], 'Admin: ordem/grupos errados');
assert.ok(!ids(m).includes('minha-agenda'), 'Admin sem vínculo não deve ver Minha Agenda');
assert.ok(!ids(m).includes('home'), 'Início não entra em grupo (é item solto)');

// 1c) Tela legada Escalas Especiais fora do menu (01/07/2026); Escala Inteligente presente
assert.ok(!ids(m).includes('escalas'), 'Escalas Especiais (legada) não pode aparecer no menu');
assert.ok(ids(m).includes('escala-smart'), 'Escala Inteligente deve aparecer no menu do admin');

// 1b) Hub Pessoas (D11/D14): 'pessoas' em Cadastros, 'professores' NÃO existe mais
assert.ok(ids(m).includes('pessoas'), 'Admin deve ver Pessoas');
assert.ok(!ids(m).includes('professores'), 'Entrada Professores foi absorvida pelo hub (D11)');
const cadastros = m.groups.find(g => g.section === 'Cadastros');
assert.ok(cadastros.items.some(i => i.id === 'pessoas'), 'Pessoas fica na seção Cadastros (D14)');

// 2) Admin COM vínculo: ganha grupo "Minhas aulas" com minha-agenda
m = Nav.buildSidebarModel(['admin'], { hasProfessorLink: true, moduleAccess: { professores: true } });
assert.ok(sections(m).includes('Minhas aulas'), 'Admin com vínculo deve ver Minhas aulas');
assert.ok(ids(m).includes('minha-agenda'), 'Admin com vínculo deve ver Minha Agenda');

// 2b) admin_gestao DROPADO (D2): não existe em PROF_PAGES
assert.ok(!Nav.PROF_PAGES.admin_gestao, 'admin_gestao não pode existir em PROF_PAGES');

// 2c) Supervisão: vê Pessoas, mas NÃO vê fechamento/pagamentos/relatórios/modalidades
const sup = Nav.buildSidebarModel(['supervisao'], { hasProfessorLink: false, moduleAccess: { professores: true } });
const supIds = ids(sup);
assert.ok(supIds.includes('pessoas'), 'Supervisão deve ver Pessoas (D5)');
['fechamento', 'pagamentos', 'relatorios', 'modalidades'].forEach(id =>
  assert.ok(!supIds.includes(id), `Supervisão não pode ver ${id}`));
assert.strictEqual(sup.systemSection, null, 'Supervisão NÃO tem seção de sistema');

// 3) Seção de sistema só pra admin — e SEM o link de Usuários (virou o hub — D14)
assert.ok(m.systemSection && m.systemSection.items.map(i => i.id).join(',') === 'units,audit',
  'Admin deve ter Administração apenas com units,audit');
const prof = Nav.buildSidebarModel(['professor'], { hasProfessorLink: true, moduleAccess: { professores: true } });
assert.strictEqual(prof.systemSection, null, 'Professor NÃO pode ter seção de sistema');

// 4) Professor: itens corretos, sem cadastros/fechamento/pessoas
const pIds = ids(prof);
assert.ok(pIds.includes('agenda-geral') && pIds.includes('minha-agenda') && pIds.includes('meus-pagamentos')
  && pIds.includes('ferias') && pIds.includes('meu-saldo'), 'Professor: itens faltando');
assert.ok(!pIds.includes('fechamento') && !pIds.includes('pessoas') && !pIds.includes('modalidades'),
  'Professor não pode ver itens de gestão');

// 5) Seletor de módulo: aparece só com 2+ módulos
const one = Nav.buildModuleSwitcher({ professores: true }, 'professores');
assert.strictEqual(one.show, false, '1 módulo → sem seletor');
const two = Nav.buildModuleSwitcher({ professores: true, comissoes: true }, 'professores');
assert.strictEqual(two.show, true, '2 módulos → com seletor');
assert.ok(two.modules.find(x => x.id === 'comissoes').href === 'index.html', 'Comissões aponta pro index.html');

// 6) Barra inferior mobile — só professor; 5 itens na ordem, com labels curtos
const bnProf = Nav.buildBottomNavModel(['professor']);
assert.deepStrictEqual(bnProf.map(i => i.id),
  ['home', 'minha-agenda', 'escala-smart', 'engaj-placar', 'meus-pagamentos'],
  'Barra: ids/ordem errados p/ professor');
assert.deepStrictEqual(bnProf.map(i => i.label),
  ['Início', 'Agenda', 'Escala', 'Placar', 'Pagar'], 'Barra: labels curtos errados');
assert.ok(bnProf.every(i => i.icon), 'Barra: todo item tem ícone');
assert.deepStrictEqual(Nav.buildBottomNavModel(['professor_estagiario']).map(i => i.id),
  ['home', 'minha-agenda', 'escala-smart', 'engaj-placar', 'meus-pagamentos'],
  'Barra: estagiário deve ter os mesmos 5');
assert.deepStrictEqual(Nav.buildBottomNavModel(['admin']), [], 'Barra: admin não tem barra');
assert.deepStrictEqual(Nav.buildBottomNavModel(['supervisao']), [], 'Barra: supervisão não tem barra');
assert.deepStrictEqual(Nav.buildBottomNavModel(['admin', 'professor']), [],
  'Barra: gestão+professor usa o drawer (sem barra)');
assert.deepStrictEqual(Nav.buildBottomNavModel([]), [], 'Barra: vazio → sem barra');
console.log('✓ smoke-sidebar: buildBottomNavModel OK');
console.log('✓ smoke-sidebar: todos os casos passaram');
