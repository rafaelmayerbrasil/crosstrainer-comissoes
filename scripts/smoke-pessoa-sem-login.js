'use strict';
// Guarda contra "ficha de usuário = login" no Hub Pessoas (17/08/2026).
//
// Por que existe: o upload das comissões cria ficha para toda vendedora nova que
// aparece na planilha (`autoRegisterVendors` grava `email:''` + `status:'pendente'`).
// O hub tratava "tem doc em /users" como "tem acesso", então essas pessoas
// apareciam com o selo verde "● Com acesso" sem NUNCA terem tido login — e, como
// o hub achava que já tinham acesso, escondia o botão de criar acesso. Resultado:
// não existia caminho na interface para dar login a uma vendedora. O Rodrigo
// travou nisso tentando liberar o acesso da Kali.
//
// O bug é silencioso: nada quebra, a tela só mente e esconde o botão.
//
// Roda: node scripts/smoke-pessoa-sem-login.js

const assert = require('assert');
const path = require('path');
const PessoasModel = require(path.join(__dirname, '..', 'pessoas-model.js'));

let ok = 0;
const teste = (nome, fn) => { fn(); ok++; console.log('  ✔ ' + nome); };

console.log('\nHub Pessoas — ficha sem login não pode contar como acesso\n');

// ── A ficha-fantasma que o upload das comissões cria ────────────────────
const FANTASMA = {
  id: 'uid-fantasma', name: 'KALI DUTRA', email: '',
  role: 'vendedor', status: 'pendente', autoCreated: true,
  allowedUnits: ['pp'], unitId: 'pp',
};
const COM_LOGIN = {
  id: 'uid-real', name: 'ERICA FAUSTINO', email: 'erica@crosstainer.com.br',
  role: 'vendedor', status: 'ativo', allowedUnits: ['cp'], unitId: 'cp',
};

teste('vendedora vinda do Excel (sem e-mail) aparece SEM acesso', () => {
  const [p] = PessoasModel.buildPeople([FANTASMA], []);
  assert.strictEqual(p.hasAccess, false, 'ficha sem e-mail não é login');
  assert.strictEqual(p.uid, 'uid-fantasma', 'o uid da ficha continua acessível para poder apagá-la depois');
  assert.strictEqual(p.teacherId, null);
});

teste('vendedora com e-mail de verdade aparece COM acesso', () => {
  const [p] = PessoasModel.buildPeople([COM_LOGIN], []);
  assert.strictEqual(p.hasAccess, true);
});

teste('professor sem login nenhum segue sem acesso', () => {
  const [p] = PessoasModel.buildPeople([], [{ id: 't1', name: 'MARCOS', type: 'efetivo' }]);
  assert.strictEqual(p.hasAccess, false);
  assert.strictEqual(p.teacherId, 't1');
});

teste('professor vinculado a ficha SEM e-mail também não tem acesso', () => {
  const fantasmaProf = { id: 'uid-x', name: 'BRUNA', email: '', professorId: 't2', status: 'pendente' };
  const [p] = PessoasModel.buildPeople([fantasmaProf], [{ id: 't2', name: 'BRUNA', type: 'efetivo' }]);
  assert.strictEqual(p.hasAccess, false, 'vínculo existe, login não');
  assert.strictEqual(p.uid, 'uid-x', 'precisa do uid para apagar a ficha antiga');
});

teste('professor com login de verdade tem acesso', () => {
  const real = { id: 'uid-y', name: 'MARCOS', email: 'marcos@x.com', professorId: 't3' };
  const [p] = PessoasModel.buildPeople([real], [{ id: 't3', name: 'MARCOS', type: 'efetivo' }]);
  assert.strictEqual(p.hasAccess, true);
});

teste('e-mail só com espaço não vale como login', () => {
  const [p] = PessoasModel.buildPeople([{ ...FANTASMA, email: '   ' }], []);
  assert.strictEqual(p.hasAccess, false);
});

teste('filtro "sem-acesso" passa a encontrar a vendedora do Excel', () => {
  const pessoas = PessoasModel.buildPeople([FANTASMA, COM_LOGIN], []);
  const semAcesso = PessoasModel.filterPeople(pessoas, { profile: 'sem-acesso' });
  assert.strictEqual(semAcesso.length, 1);
  assert.strictEqual(semAcesso[0].name, 'KALI DUTRA');
});

teste('temLoginReal é exportado e trata nulo', () => {
  assert.strictEqual(typeof PessoasModel.temLoginReal, 'function');
  assert.strictEqual(PessoasModel.temLoginReal(null), false);
  assert.strictEqual(PessoasModel.temLoginReal(undefined), false);
  assert.strictEqual(PessoasModel.temLoginReal({}), false);
  assert.strictEqual(PessoasModel.temLoginReal({ email: 'a@b.c' }), true);
});

// ── A tela: o botão não pode mais sair calado para quem não é professor ──
const fs = require('fs');
const ui = fs.readFileSync(path.join(__dirname, '..', 'professores-pessoas.js'), 'utf8');

teste('pessoaCriarAcesso não exige mais teacherId', () => {
  const fn = ui.match(/function pessoaCriarAcesso\([\s\S]*?\n}/)[0];
  assert.ok(!/if \(!p \|\| !p\.teacherId\) return;/.test(fn),
    'a guarda antiga saía calada para vendedora');
  assert.ok(/placeholderUid/.test(fn), 'precisa levar o uid da ficha-fantasma');
});

teste('a ficha-fantasma é apagada depois de criar o login', () => {
  assert.ok(/ctx\.placeholderUid && ctx\.placeholderUid !== newUid/.test(ui),
    'sem isso a pessoa aparece duas vezes no hub');
  assert.ok(/collection\('users'\)\.doc\(ctx\.placeholderUid\)\.delete\(\)/.test(ui));
});

console.log(`\n${ok} verificações OK\n`);
