'use strict';
// Smoke do user-model (derivação pura). Roda: node scripts/smoke-user-model.js
const assert = require('assert');
const UM = require('../user-model.js');

function check(profiles, expModule, expRole) {
  const { moduleAccess, role } = UM.deriveUserModel(profiles);
  assert.deepStrictEqual(moduleAccess, expModule, 'moduleAccess errado p/ ' + JSON.stringify(profiles));
  assert.strictEqual(role, expRole, 'role errado p/ ' + JSON.stringify(profiles));
}

check(['admin'],                 { comissoes: true,  professores: true  }, 'admin');
check(['vendedor'],              { comissoes: true,  professores: false }, 'vendedor');
check(['supervisao'],            { comissoes: false, professores: true  }, 'supervisao');
check(['professor'],             { comissoes: false, professores: true  }, 'professor');
check(['professor_estagiario'],  { comissoes: false, professores: true  }, 'professor_estagiario');
check(['admin', 'professor'],    { comissoes: true,  professores: true  }, 'admin');     // admin domina o role
check(['vendedor', 'supervisao'],{ comissoes: true,  professores: true  }, 'vendedor');  // vendedor domina sobre o primeiro

// admin_gestao foi DROPADO (D2 do hub Pessoas) — não pode existir no modelo
assert.ok(!UM.PROFILE_LABELS.admin_gestao, 'admin_gestao não pode ter label');
assert.ok(!UM.PROFILE_ORDER.includes('admin_gestao'), 'admin_gestao não pode estar em PROFILE_ORDER');

// Rótulos existem pros 5 perfis
['admin', 'supervisao', 'professor', 'professor_estagiario', 'vendedor']
  .forEach(p => assert.ok(UM.PROFILE_LABELS[p], 'falta label p/ ' + p));

console.log('✓ smoke-user-model: todos os casos passaram');
