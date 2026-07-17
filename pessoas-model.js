// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Hub Pessoas · Modelo puro da junção (D12)
// Pessoa = teachers ⊕ users via users.professorId. Três estados válidos:
//   só teacher (professor sem acesso) · só user (login) · vinculados.
// Identidade da pessoa vinculada vem do teacher doc (fonte da verdade, §3).
// Browser: window.PessoasModel · Node: require('./pessoas-model.js')
// Spec: docs/superpowers/specs/2026-06-11-hub-pessoas-design.md
// ═══════════════════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PessoasModel = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function profilesOf(user) {
    if (!user) return [];
    if (Array.isArray(user.profiles) && user.profiles.length) return user.profiles;
    return user.role ? [user.role] : [];
  }

  // Perfil implícito de um teacher sem login (type → perfil)
  function implicitProfiles(teacher) {
    return [teacher.type === 'estagiario' ? 'professor_estagiario' : 'professor'];
  }

  function buildPeople(users, teachers) {
    users = users || []; teachers = teachers || [];
    const teacherIds = new Set(teachers.map(t => t.id));
    const userByTeacher = new Map();
    users.forEach(u => {
      if (u.professorId && teacherIds.has(u.professorId) && !userByTeacher.has(u.professorId)) {
        userByTeacher.set(u.professorId, u);
      }
    });
    const mergedUids = new Set(Array.from(userByTeacher.values()).map(u => u.id));

    const people = teachers.map(t => {
      const u = userByTeacher.get(t.id) || null;
      return {
        key: 'T:' + t.id,
        teacherId: t.id,
        uid: u ? u.id : null,
        name: t.name || (u && u.name) || '',
        email: t.email || (u && u.email) || '',
        profiles: u ? profilesOf(u) : implicitProfiles(t),
        hasAccess: !!u,
        teacher: t,
        user: u,
      };
    });

    users.filter(u => !mergedUids.has(u.id)).forEach(u => {
      people.push({
        key: 'U:' + u.id,
        teacherId: null,
        uid: u.id,
        name: u.name || '',
        email: u.email || '',
        profiles: profilesOf(u),
        hasAccess: true,
        teacher: null,
        user: u,
      });
    });

    people.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
    return people;
  }

  function filterPeople(people, filters) {
    const q = ((filters && filters.search) || '').trim().toLowerCase();
    const prof = (filters && filters.profile) || 'all';
    return (people || []).filter(p => {
      if (q) {
        const inName = (p.name || '').toLowerCase().includes(q);
        const inEmail = (p.email || '').toLowerCase().includes(q);
        if (!inName && !inEmail) return false;
      }
      if (prof !== 'all') {
        if (prof === 'sem-acesso') return !p.hasAccess;
        if (!p.profiles.includes(prof)) return false;
      }
      return true;
    });
  }

  return { buildPeople, filterPeople, profilesOf, implicitProfiles };
});
