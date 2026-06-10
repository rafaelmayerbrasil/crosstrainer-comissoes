// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Modelo de usuário (derivação pura)
// Fonte única da derivação profiles[] → { moduleAccess, role }.
// Usado por index.html (form de Usuários) e professores.js (migração inline),
// pra evitar divergência de regra entre os dois.
// Browser: window.UserModel · Node: require('./user-model.js')
// ═══════════════════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UserModel = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const PROFILE_LABELS = {
    admin:                'Administrador',
    admin_gestao:         'Admin/Gestão',
    supervisao:           'Supervisão',
    professor:            'Professor',
    professor_estagiario: 'Professor (Estagiário)',
    vendedor:             'Vendedor(a)',
  };

  // Ordem canônica de exibição/seleção dos perfis no form.
  const PROFILE_ORDER = ['admin', 'admin_gestao', 'supervisao', 'professor', 'professor_estagiario', 'vendedor'];

  const COMISSOES_PROFILES   = ['admin', 'vendedor'];
  const PROFESSORES_PROFILES = ['admin', 'admin_gestao', 'supervisao', 'professor', 'professor_estagiario'];
  const TEACHER_PROFILES     = ['professor', 'professor_estagiario'];

  // profiles[] → { moduleAccess, role }. role primário mantém compat com o Comissões.
  function deriveUserModel(profiles) {
    const ps = Array.isArray(profiles) ? profiles : (profiles ? [profiles] : []);
    const has = (...want) => ps.some(p => want.includes(p));
    const moduleAccess = {
      comissoes:   has(...COMISSOES_PROFILES),
      professores: has(...PROFESSORES_PROFILES),
    };
    const role = ps.includes('admin') ? 'admin'
               : ps.includes('vendedor') ? 'vendedor'
               : (ps[0] || 'vendedor');
    return { moduleAccess, role };
  }

  function isTeacherProfile(profiles) {
    const ps = Array.isArray(profiles) ? profiles : (profiles ? [profiles] : []);
    return ps.some(p => TEACHER_PROFILES.includes(p));
  }

  return { PROFILE_LABELS, PROFILE_ORDER, TEACHER_PROFILES, deriveUserModel, isTeacherProfile };
});
