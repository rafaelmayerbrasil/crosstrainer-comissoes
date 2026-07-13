// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Módulo Professores · Configuração e modelo de navegação
// Puro (sem DOM). Usável no browser (window.ProfNav) e no Node (require).
// ═══════════════════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProfNav = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // admin_gestao dropado + 'professores' absorvido pelo hub 'pessoas' (D2/D11 — 11/06/2026)
  const PROF_PAGES = {
    // 'escalas' (tela legada Escalas Especiais) fora do menu em 01/07/2026 — Escala Inteligente (4 abas) assume; rota preservada p/ rollback
    admin:                ['home', 'modalidades', 'pessoas', 'agenda', 'agenda-geral', 'minha-agenda', 'fechamento', 'pagamentos', 'escala-smart', 'ferias', 'saldos-gestao', 'relatorios', 'engaj-config', 'engaj-chamada', 'engaj-placar', 'plr-config', 'plr-avaliacao', 'plr-resultado'],
    supervisao:           ['home', 'pessoas', 'agenda', 'agenda-geral', 'minha-agenda', 'escala-smart', 'ferias', 'saldos-gestao', 'engaj-chamada', 'engaj-placar', 'plr-avaliacao', 'plr-resultado'],
    professor:            ['home', 'agenda-geral', 'minha-agenda', 'escala-smart', 'meus-pagamentos', 'ferias', 'meu-saldo', 'engaj-placar'],
    professor_estagiario: ['home', 'agenda-geral', 'minha-agenda', 'escala-smart', 'meus-pagamentos', 'ferias', 'meu-saldo', 'engaj-placar'],
  };

  // section agora reflete o agrupamento por DOMÍNIO (decisão D3 do design).
  const PAGE_DEFINITIONS = [
    { id: 'home',           label: 'Início',            icon: '🏠', section: null },
    { id: 'agenda',         label: 'Agenda',            icon: '📅', section: 'Agenda' },
    { id: 'agenda-geral',   label: 'Agenda Geral',      icon: '🌐', section: 'Agenda' },
    { id: 'escalas',        label: 'Escalas Especiais', icon: '🎯', section: 'Agenda' },
    { id: 'escala-smart',   label: 'Escala Inteligente',icon: '🗓️', section: 'Agenda' },
    { id: 'pessoas',        label: 'Pessoas',           icon: '👥', section: 'Cadastros' },
    { id: 'modalidades',    label: 'Modalidades',       icon: '🏷️', section: 'Cadastros' },
    { id: 'ferias',         label: 'Férias e Recesso',  icon: '🏖️', section: 'Férias' },
    { id: 'saldos-gestao',  label: 'Saldos de Férias',  icon: '📊', section: 'Férias' },
    { id: 'meu-saldo',      label: 'Meu Saldo',         icon: '📊', section: 'Férias' },
    { id: 'fechamento',     label: 'Fechamento',        icon: '💰', section: 'Financeiro' },
    { id: 'pagamentos',     label: 'Pagamentos',        icon: '💳', section: 'Financeiro' },
    { id: 'meus-pagamentos',label: 'Meus Pagamentos',   icon: '💳', section: 'Financeiro' },
    { id: 'relatorios',     label: 'Relatórios',        icon: '📈', section: 'Financeiro' },
    { id: 'minha-agenda',   label: 'Minha Agenda',      icon: '📅', section: 'Agenda' },
    { id: 'engaj-config',   label: 'Config. Pontos',    icon: '⚙️', section: 'Engajamento' },
    { id: 'engaj-chamada',  label: 'Confirmar Presença', icon: '✅', section: 'Engajamento' },
    { id: 'engaj-placar',   label: 'Placar',            icon: '🏆', section: 'Engajamento' },
    { id: 'plr-config',     label: 'PLR · Config',      icon: '⚙️', section: 'PLR' },
    { id: 'plr-avaliacao',  label: 'PLR · Avaliação',   icon: '📝', section: 'PLR' },
    { id: 'plr-resultado',  label: 'PLR · Resultado',   icon: '🏅', section: 'PLR' },
  ];

  const SECTION_ORDER = ['Agenda', 'Engajamento', 'PLR', 'Cadastros', 'Férias', 'Financeiro'];

  // Seção de sistema (cross-módulo). Links apontam pro Comissões com ?page=
  // (deep-link só funciona após o Plano B; antes disso cai na home do Comissões).
  const SYSTEM_SECTION = {
    label: 'Administração · sistema',
    // "Usuários e Perfis" saiu — virou o próprio hub Pessoas (D14).
    items: [
      { id: 'units', label: 'Unidades',  icon: '🏢', href: 'index.html?page=units' },
      { id: 'audit', label: 'Auditoria', icon: '📜', href: 'index.html?page=audit' },
    ],
  };

  const MODULE_LABELS = { comissoes: 'Comissões', professores: 'Professores' };
  const MODULE_HREF   = { comissoes: 'index.html', professores: 'professores.html' };

  function allowedPagesFor(profiles) {
    const all = (profiles || []).flatMap(p => PROF_PAGES[p] || []);
    return [...new Set(all)];
  }

  function isManagement(profiles) {
    return (profiles || []).some(p => ['admin', 'supervisao'].includes(p));
  }
  function isAdmin(profiles) {
    return (profiles || []).some(p => p === 'admin');
  }

  // Modelo puro da barra inferior mobile. Só pro papel professor (não gestão).
  // Retorna os 5 destinos fixos com label CURTO p/ caber na barra; [] pra gestão/desconhecido.
  const BOTTOM_NAV_IDS = ['home', 'minha-agenda', 'escala-smart', 'engaj-placar', 'meus-pagamentos'];
  const BOTTOM_NAV_LABELS = {
    'home': 'Início', 'minha-agenda': 'Agenda', 'escala-smart': 'Escala',
    'engaj-placar': 'Placar', 'meus-pagamentos': 'Pagar',
  };
  function buildBottomNavModel(profiles) {
    if (isManagement(profiles)) return [];
    const isProf = (profiles || []).some(p => p === 'professor' || p === 'professor_estagiario');
    if (!isProf) return [];
    return BOTTOM_NAV_IDS.map(id => {
      const def = PAGE_DEFINITIONS.find(d => d.id === id);
      return { id, label: BOTTOM_NAV_LABELS[id], icon: def ? def.icon : '' };
    });
  }

  // Modelo puro da sidebar. ctx: { hasProfessorLink, moduleAccess }
  function buildSidebarModel(profiles, ctx) {
    ctx = ctx || {};
    let allowed = allowedPagesFor(profiles);

    // "Minha Agenda" pra perfil de gestão só com vínculo de professor (D refinamento).
    if (isManagement(profiles) && !ctx.hasProfessorLink) {
      allowed = allowed.filter(id => id !== 'minha-agenda');
    }

    const defs = PAGE_DEFINITIONS.filter(d => allowed.includes(d.id));

    const groups = [];
    SECTION_ORDER.forEach(section => {
      const items = defs.filter(d => d.section === section)
                        .map(d => ({ id: d.id, label: d.label, icon: d.icon }));
      if (items.length) groups.push({ section, items });
    });

    const home = defs.find(d => d.section === null) || null;
    const systemSection = isAdmin(profiles) ? SYSTEM_SECTION : null;
    const moduleSwitcher = buildModuleSwitcher(ctx.moduleAccess, 'professores');

    return { home, groups, systemSection, moduleSwitcher };
  }

  function buildModuleSwitcher(moduleAccess, activeId) {
    const ids = Object.keys(moduleAccess || {}).filter(k => moduleAccess[k]);
    if (ids.length < 2) return { show: false, modules: [] };
    const modules = ids.map(id => ({
      id, label: MODULE_LABELS[id] || id, href: MODULE_HREF[id] || '#', active: id === activeId,
    }));
    return { show: true, modules };
  }

  return { PROF_PAGES, PAGE_DEFINITIONS, SECTION_ORDER, SYSTEM_SECTION,
           allowedPagesFor, buildSidebarModel, buildModuleSwitcher, buildBottomNavModel };
});
