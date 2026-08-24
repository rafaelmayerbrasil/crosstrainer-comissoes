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

  // Ter doc em /users NÃO é ter login. O upload das comissões cria ficha-fantasma
  // para vendedora que aparece na planilha (`autoRegisterVendors`, email:'' +
  // status:'pendente') — a pessoa existe no sistema mas nunca teve conta no Auth.
  // Como o Auth exige e-mail, e-mail vazio prova que não há login por trás.
  // Sem esta checagem o hub mostrava "● Com acesso" para quem não consegue entrar,
  // e escondia o botão de criar acesso (achado com a Kali em 17/08/2026).
  function temLoginReal(user) {
    return !!(user && String(user.email || '').trim());
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
      // O e-mail que a tela mostra é o de ACESSO quando existe login, e só cai
      // pro da ficha quando a pessoa ainda não tem acesso (cadastrada pela
      // planilha, login vem depois).
      //
      // Era o contrário — `t.email` vinha primeiro — e isso travou a Eduarda
      // fora do sistema em 22/08/2026: a ficha dela diz um endereço, o login é
      // outro, e ela pedia "esqueci minha senha" pelo da ficha. O Firebase não
      // avisa quando o e-mail não existe (de propósito, pra ninguém descobrir
      // quem está cadastrado): responde "enviamos" e não manda nada. A gestão
      // olhava o Hub, via o endereço errado e repassava. Eram 4 professores
      // nessa situação.
      const emailAcesso = (u && u.email) ? u.email : '';
      const emailContato = t.email || '';
      return {
        key: 'T:' + t.id,
        teacherId: t.id,
        uid: u ? u.id : null,
        name: t.name || (u && u.name) || '',
        email: emailAcesso || emailContato,
        emailContato,
        emailDivergente: !!(emailAcesso && emailContato
          && emailAcesso.trim().toLowerCase() !== emailContato.trim().toLowerCase()),
        profiles: u ? profilesOf(u) : implicitProfiles(t),
        hasAccess: temLoginReal(u),
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
        emailContato: '',        // pessoa sem ficha de professor: só existe o de acesso
        emailDivergente: false,
        profiles: profilesOf(u),
        hasAccess: temLoginReal(u),
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
        // Procura pelos DOIS endereços: quem está buscando pode ter em mãos o
        // de contato (que é o que costuma circular) ou o de acesso.
        const inEmail = (p.email || '').toLowerCase().includes(q)
                     || (p.emailContato || '').toLowerCase().includes(q);
        if (!inName && !inEmail) return false;
      }
      if (prof !== 'all') {
        if (prof === 'sem-acesso') return !p.hasAccess;
        if (!p.profiles.includes(prof)) return false;
      }
      return true;
    });
  }

  return { buildPeople, filterPeople, profilesOf, implicitProfiles, temLoginReal };
});
