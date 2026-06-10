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
check(['admin_gestao'],          { comissoes: false, professores: true  }, 'admin_gestao');
check(['supervisao'],            { comissoes: false, professores: true  }, 'supervisao');
check(['professor'],             { comissoes: false, professores: true  }, 'professor');
check(['professor_estagiario'],  { comissoes: false, professores: true  }, 'professor_estagiario');
check(['admin', 'professor'],    { comissoes: true,  professores: true  }, 'admin');     // admin domina o role
check(['vendedor', 'supervisao'],{ comissoes: true,  professores: true  }, 'vendedor');  // vendedor domina admin sobre o primeiro

// Rótulos existem pros 6 perfis
['admin', 'admin_gestao', 'supervisao', 'professor', 'professor_estagiario', 'vendedor']
  .forEach(p => assert.ok(UM.PROFILE_LABELS[p], 'falta label p/ ' + p));

console.log('✓ smoke-user-model: todos os casos passaram');
