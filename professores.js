// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Módulo Professores · Entry Point
//
// Responsabilidades nesta Etapa 1:
//   1. Inicialização Firebase (via firebase-config.js)
//   2. Auth flow: login, logout, onAuthStateChanged
//   3. Migração inline de profiles[] e moduleAccess{} (backward compat)
//   4. Bloqueio de quem não tem moduleAccess.professores
//   5. Build da sidebar conforme perfis do usuário
//   6. Roteamento simples entre páginas
//   7. Toggle de tema (claro/escuro)
//   8. Menu mobile
//
// Próximas etapas adicionam:
//   - Services (Etapa 2 → professores-shared.js)
//   - Telas de Modalidades e Professores (Etapas 3-7 → professores-cadastro.js)
// ═══════════════════════════════════════════════════════════════════════

'use strict';

/* ─── State global ──────────────────────────────────────────────── */
const AppState = {
  currentUser: null,
  userProfile: null,
  currentPage: 'home',
};

/* ─── Configuração de páginas por perfil ────────────────────────── */
const PROF_PAGES = {
  admin:                ['home', 'modalidades', 'professores', 'agenda', 'agenda-geral', 'minha-agenda', 'fechamento', 'pagamentos', 'escalas', 'ferias', 'saldos-gestao'],
  admin_gestao:         ['home', 'modalidades', 'professores', 'agenda', 'agenda-geral', 'minha-agenda', 'fechamento', 'escalas', 'ferias', 'saldos-gestao'],
  supervisao:           ['home', 'professores', 'agenda', 'agenda-geral', 'minha-agenda', 'escalas', 'ferias', 'saldos-gestao'],
  professor:            ['home', 'agenda-geral', 'minha-agenda', 'meus-pagamentos', 'ferias', 'meu-saldo'],
  professor_estagiario: ['home', 'agenda-geral', 'minha-agenda', 'meus-pagamentos', 'ferias', 'meu-saldo'],
};

const PAGE_DEFINITIONS = [
  { id: 'home',          label: 'Início',         icon: '🏠', section: null },
  { id: 'modalidades',   label: 'Modalidades',    icon: '🏷️', section: 'Cadastros' },
  { id: 'professores',   label: 'Professores',    icon: '👥', section: 'Cadastros' },
  { id: 'agenda',        label: 'Agenda',         icon: '📅', section: 'Operação' },
  { id: 'agenda-geral',  label: 'Agenda Geral',   icon: '🌐', section: 'Operação' },
  { id: 'minha-agenda',  label: 'Minha Agenda',   icon: '📅', section: 'Minhas aulas' },
  { id: 'fechamento',   label: 'Fechamento',     icon: '💰', section: 'Financeiro' },
  { id: 'pagamentos',      label: 'Pagamentos',      icon: '💳', section: 'Financeiro' },
  { id: 'meus-pagamentos', label: 'Meus Pagamentos', icon: '💳', section: 'Financeiro' },
  { id: 'escalas',        label: 'Escalas Especiais', icon: '🎯', section: 'Operação' },
  { id: 'ferias',         label: 'Férias e Recesso',  icon: '🏖️', section: 'Operação' },
  { id: 'meu-saldo',      label: 'Meu Saldo',          icon: '📊', section: 'Minhas aulas' },
  { id: 'saldos-gestao',  label: 'Saldos de Férias',   icon: '📊', section: 'Financeiro' },
];

/* ─── Helpers de perfil ─────────────────────────────────────────── */
function hasProfile(p) {
  if (!AppState.userProfile) return false;
  const profiles = AppState.userProfile.profiles || [AppState.userProfile.role];
  return profiles.includes(p);
}
function isAdminGestao() { return hasProfile('admin') || hasProfile('admin_gestao'); }
function isSupervisao()  { return hasProfile('supervisao'); }
function isProfessor()   { return hasProfile('professor') || hasProfile('professor_estagiario'); }
function canSeeSalary()  { return hasProfile('admin') || hasProfile('admin_gestao'); }
function isStrictAdmin() { return hasProfile('admin'); }  // Sprint 4a — apenas admin pode fechar mês (D1)

// Sprint 3a — vínculo user logado → teacher
// Setado manualmente em users/{uid}.professorId (decisão D7).
// Retorna null se não houver vínculo (UI mostra empty state explicativo).
function getCurrentProfessorId() {
  return (AppState.userProfile && AppState.userProfile.professorId) || null;
}

function getAllowedPages() {
  const profiles = AppState.userProfile.profiles || [AppState.userProfile.role];
  const all = profiles.flatMap(p => PROF_PAGES[p] || []);
  return [...new Set(all)];
}

/* ─── Toast ─────────────────────────────────────────────────────── */
function toast(msg, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

/* ─── Auth: Login form handlers ─────────────────────────────────── */
async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');

  errEl.textContent = '';

  // Diagnóstico defensivo — captura caso firebase-config.js não tenha rodado
  if (typeof auth === 'undefined' || auth === null) {
    errEl.textContent = 'Erro: Firebase não inicializado. Recarregue a página.';
    console.error('[doLogin] auth está undefined. firebase-config.js falhou.');
    return;
  }

  if (!email || !pass) {
    errEl.textContent = 'Informe email e senha.';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Entrando...';

  try {
    console.log('[doLogin] Tentando login em ambiente:', window.FIREBASE_ENV);
    await auth.signInWithEmailAndPassword(email, pass);
    console.log('[doLogin] signIn OK — aguardando onAuthStateChanged');
    // onAuthStateChanged cuida do resto
  } catch (err) {
    console.error('[doLogin] Falha:', err.code, err.message, err);
    errEl.textContent = mapAuthError(err.code) || ('Erro: ' + (err.code || err.message));
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

function mapAuthError(code) {
  const map = {
    'auth/invalid-email':       'Email inválido.',
    'auth/user-disabled':       'Usuário desativado.',
    'auth/user-not-found':      'Usuário não encontrado.',
    'auth/wrong-password':      'Senha incorreta.',
    'auth/invalid-credential':  'Email ou senha incorretos.',
    'auth/too-many-requests':   'Muitas tentativas. Tente novamente em alguns minutos.',
    'auth/network-request-failed': 'Erro de conexão. Verifique sua internet.',
  };
  return map[code];
}

async function doLogout() {
  try {
    await auth.signOut();
    toast('Sessão encerrada.', 'info');
  } catch (err) {
    toast('Erro ao sair: ' + err.message, 'error');
  }
}

/* ─── Auth: state listener ─────────────────────────────────────── */
auth.onAuthStateChanged(async (user) => {
  const loginPage = document.getElementById('loginPage');
  const deniedPage = document.getElementById('deniedPage');
  const appShell = document.getElementById('appShell');

  // Atualiza badge de ambiente
  updateEnvBadges();

  // Reset UI
  loginPage.style.display = 'none';
  deniedPage.style.display = 'none';
  appShell.style.display = 'none';

  if (!user) {
    // Não autenticado → tela de login
    loginPage.style.display = 'flex';
    const btn = document.getElementById('loginBtn');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
    AppState.currentUser = null;
    AppState.userProfile = null;
    return;
  }

  // Autenticado → carrega profile do Firestore
  try {
    const doc = await db.collection('users').doc(user.uid).get();
    if (!doc.exists) {
      console.warn('users/' + user.uid + ' não existe no Firestore.');
      await auth.signOut();
      toast('Conta sem perfil configurado. Contate o administrador.', 'error', 6000);
      return;
    }

    let profile = doc.data();

    // Migração inline (backward compatible com índex.html antigo)
    if (!profile.profiles || !profile.moduleAccess) {
      profile = migrateUserProfile(profile);
      db.collection('users').doc(user.uid).update({
        profiles: profile.profiles,
        moduleAccess: profile.moduleAccess,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }).catch(err => console.warn('Erro ao gravar migração inline:', err));
    }

    // Bloqueia quem não tem acesso ao módulo de Professores
    if (!profile.moduleAccess || profile.moduleAccess.professores !== true) {
      deniedPage.style.display = 'flex';
      AppState.currentUser = user;
      AppState.userProfile = profile;
      return;
    }

    // OK — entra no app
    AppState.currentUser = user;
    AppState.userProfile = profile;
    showApp();
  } catch (err) {
    console.error('Erro ao carregar perfil:', err);
    toast('Erro ao carregar seu perfil: ' + err.message, 'error', 6000);
    await auth.signOut();
  }
});

function migrateUserProfile(profile) {
  const role = profile.role;
  return {
    ...profile,
    profiles: profile.profiles || [role],
    moduleAccess: profile.moduleAccess || {
      comissoes:   ['admin', 'vendedor'].includes(role),
      professores: role === 'admin',
    },
  };
}

/* ─── Show app ─────────────────────────────────────────────────── */
function showApp() {
  document.getElementById('appShell').style.display = 'flex';

  // Header de usuário
  document.getElementById('userName').textContent = AppState.userProfile.name || AppState.userProfile.email;
  document.getElementById('userRole').textContent = formatRoleLabel();

  // Build sidebar
  buildSidebar();

  // Carrega tema preferido
  loadTheme();

  // Sprint 3b — sino de notificações
  setupNotificationsBell();

  // Sprint 6b — contador de férias pendentes (admin/gestão)
  setupVacationCounter();

  // Roteamento inicial — sempre 'home' por enquanto
  navigateTo('home');
}

/* ─── Sprint 3b — Sino de notificações in-app ────────────────────── */
const NotifState = {
  unread: [],
  refreshInterval: null,
};

function setupNotificationsBell() {
  if (!AppState.currentUser) return;

  // Carrega não-lidas imediatamente
  refreshNotifBell();

  // Auto-refresh a cada 60s (light polling, sem snapshot listener pra economizar leituras)
  if (NotifState.refreshInterval) clearInterval(NotifState.refreshInterval);
  NotifState.refreshInterval = setInterval(refreshNotifBell, 60000);

  // Click fora do dropdown fecha
  document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.notif-bell-wrap');
    const dropdown = document.getElementById('notifDropdown');
    if (!wrap || !dropdown) return;
    if (!wrap.contains(e.target) && dropdown.style.display === 'block') {
      dropdown.style.display = 'none';
    }
  });
}

async function refreshNotifBell() {
  if (!AppState.currentUser) return;
  const res = await NotificationService.listUnread(AppState.currentUser.uid, 10);
  if (!res.success) return;
  NotifState.unread = res.data;
  updateNotifBellBadge();
  // Se dropdown está aberto, atualiza o conteúdo
  const dropdown = document.getElementById('notifDropdown');
  if (dropdown && dropdown.style.display === 'block') renderNotifDropdownList();
}

function updateNotifBellBadge() {
  const badge = document.getElementById('notifBellBadge');
  if (!badge) return;
  const n = NotifState.unread.length;
  if (n === 0) {
    badge.style.display = 'none';
  } else {
    badge.style.display = 'inline-block';
    badge.textContent = n > 9 ? '9+' : String(n);
  }
}

function toggleNotifDropdown() {
  const dropdown = document.getElementById('notifDropdown');
  if (!dropdown) return;
  if (dropdown.style.display === 'block') {
    dropdown.style.display = 'none';
  } else {
    renderNotifDropdownList();
    dropdown.style.display = 'block';
  }
}

function renderNotifDropdownList() {
  const list = document.getElementById('notifDropdownList');
  if (!list) return;
  if (NotifState.unread.length === 0) {
    list.innerHTML = '<div class="notif-empty">Nenhuma notificação não lida.</div>';
    return;
  }
  list.innerHTML = NotifState.unread.map(n => {
    const meta = (ProfHelpers.NOTIF_TYPE_META && ProfHelpers.NOTIF_TYPE_META[n.type]) || { icon: '🔔', title: 'Notificação' };
    const ts = n.createdAt && n.createdAt.toDate ? n.createdAt.toDate() : null;
    const ago = ts ? formatRelativeTime(ts) : '';
    return `
      <div class="notif-item" onclick="handleNotifClick('${n.id}', ${JSON.stringify(n.link).replace(/"/g, '&quot;')})">
        <div class="notif-icon">${meta.icon}</div>
        <div class="notif-text">
          <div class="notif-title">${escapeNotif(n.title || meta.title)}</div>
          <div class="notif-body">${escapeNotif(n.body || '')}</div>
          <div class="notif-time">${ago}</div>
        </div>
      </div>
    `;
  }).join('');
}

function escapeNotif(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatRelativeTime(date) {
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} dia${d > 1 ? 's' : ''} atrás`;
  return date.toLocaleDateString('pt-BR');
}

async function handleNotifClick(notifId, link) {
  await NotificationService.markAsRead(notifId);
  await refreshNotifBell();
  // Navegação contextual (link pode ser {type, id})
  if (link && link.type) {
    if (link.type === 'class' && typeof navigateTo === 'function') {
      navigateTo('minha-agenda');
      // tentativa de abrir modal da aula via timeout (página precisa renderizar primeiro)
      setTimeout(() => {
        if (typeof openClassModal === 'function') openClassModal(link.id);
      }, 200);
    } else if (link.type === 'substitution' || link.type === 'coverage') {
      if (typeof openInboxModal === 'function') openInboxModal();
    }
  }
  // Fecha dropdown
  const dropdown = document.getElementById('notifDropdown');
  if (dropdown) dropdown.style.display = 'none';
}

async function markAllNotifsAsRead() {
  if (!AppState.currentUser) return;
  const res = await NotificationService.markAllAsRead(AppState.currentUser.uid);
  if (res.success) {
    toast(`${res.count} notificação${res.count !== 1 ? 'ões' : ''} marcada${res.count !== 1 ? 's' : ''} como lida${res.count !== 1 ? 's' : ''}.`, 'success');
    await refreshNotifBell();
  }
}

function formatRoleLabel() {
  const profiles = AppState.userProfile.profiles || [AppState.userProfile.role];
  const labels = {
    'admin':                'Administrador',
    'admin_gestao':         'Gestão',
    'supervisao':           'Supervisão',
    'professor':            'Professor',
    'professor_estagiario': 'Estagiário',
    'vendedor':             'Vendedor',
  };
  return profiles.map(p => labels[p] || p).join(' · ');
}

/* ─── Sidebar ─────────────────────────────────────────────────── */
function buildSidebar() {
  const nav = document.getElementById('sidebarNav');
  const allowed = getAllowedPages();
  const items = PAGE_DEFINITIONS.filter(p => allowed.includes(p.id));

  // Agrupa por section
  let html = '';
  let lastSection = undefined;
  items.forEach(item => {
    if (item.section !== lastSection) {
      if (item.section) {
        html += `<div class="sb-section">${item.section}</div>`;
      }
      lastSection = item.section;
    }
    const activeClass = item.id === AppState.currentPage ? 'active' : '';
    html += `<div class="sb-item ${activeClass}" onclick="navigateTo('${item.id}')">
               <span class="icon">${item.icon}</span>${item.label}
             </div>`;
  });

  nav.innerHTML = html;
}

/* ─── Roteamento ──────────────────────────────────────────────── */
function navigateTo(pageId) {
  const allowed = getAllowedPages();
  if (!allowed.includes(pageId)) {
    toast('Você não tem acesso a essa seção.', 'error');
    pageId = allowed[0] || 'home';
  }

  AppState.currentPage = pageId;

  // Esconde todas as páginas
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  // Mostra a página atual
  const pageEl = document.getElementById('page-' + pageId);
  if (pageEl) {
    pageEl.classList.add('active');
  } else {
    console.warn('Página não encontrada:', pageId);
  }

  // Atualiza item ativo na sidebar
  document.querySelectorAll('.sb-item').forEach(el => el.classList.remove('active'));
  buildSidebar();

  // Sprint 6b — reaplica badge de férias após rebuild da sidebar
  applyVacationBadge();

  // Renderiza conteúdo conforme página (delegado para módulos específicos)
  if (pageId === 'modalidades' && typeof renderModalidadesPage === 'function') {
    renderModalidadesPage();
  } else if (pageId === 'professores' && typeof renderProfessoresPage === 'function') {
    renderProfessoresPage();
  } else if (pageId === 'agenda' && typeof renderAgendaPage === 'function') {
    renderAgendaPage();
  } else if (pageId === 'minha-agenda' && typeof renderMinhaAgendaPage === 'function') {
    renderMinhaAgendaPage();
  } else if (pageId === 'agenda-geral' && typeof renderAgendaGeralPage === 'function') {
    renderAgendaGeralPage();
  } else if (pageId === 'fechamento' && typeof renderFechamentoPage === 'function') {
    renderFechamentoPage();
  } else if (pageId === 'pagamentos' && typeof renderPagamentosPage === 'function') {
    renderPagamentosPage();
  } else if (pageId === 'meus-pagamentos' && typeof renderMeusPagamentosPage === 'function') {
    renderMeusPagamentosPage();
  } else if (pageId === 'escalas' && typeof renderEscalasPage === 'function') {
    renderEscalasPage();
  } else if (pageId === 'ferias' && typeof renderFeriasGestaoPage === 'function' && typeof renderMinhasFeriasPage === 'function') {
    // Admin/Gestão/Supervisão veem tela de gestão; Professor vê "Minhas Férias"
    if (isAdminGestao() || isSupervisao()) {
      renderFeriasGestaoPage();
    } else {
      renderMinhasFeriasPage();
    }
  } else if (pageId === 'meu-saldo' && typeof renderMeuSaldoPage === 'function') {
    renderMeuSaldoPage();
  } else if (pageId === 'saldos-gestao' && typeof renderSaldosGestaoPage === 'function') {
    renderSaldosGestaoPage();
  }

  // Fecha menu mobile se estiver aberto
  document.getElementById('sidebar').classList.remove('open');
}

/* ─── Tema (claro/escuro) ─────────────────────────────────────── */
function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light');
  localStorage.setItem('ct_theme', isLight ? 'light' : 'dark');
  updateThemeKnob(isLight);
}

function loadTheme() {
  const saved = localStorage.getItem('ct_theme');
  const isLight = saved === 'light';
  if (isLight) document.documentElement.classList.add('light');
  document.getElementById('themeToggle').checked = isLight;
  updateThemeKnob(isLight);
}

function updateThemeKnob(isLight) {
  const knob = document.getElementById('themeKnob');
  if (!knob) return;
  if (isLight) {
    knob.style.left = '18px';
    knob.style.background = 'var(--yellow)';
  } else {
    knob.style.left = '2px';
    knob.style.background = 'var(--orange)';
  }
}

/* ─── Menu mobile ─────────────────────────────────────────────── */
function toggleMenu() {
  document.getElementById('sidebar').classList.toggle('open');
}

/* ─── Env badge (staging vs production) ───────────────────────── */
function updateEnvBadges() {
  const env = window.FIREBASE_ENV || 'unknown';
  const badges = ['envBadgeLogin', 'envBadgeApp'];
  badges.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (env === 'staging') {
      el.className = 'env-badge staging';
      el.textContent = 'staging';
      el.style.display = 'inline-block';
    } else {
      el.style.display = 'none';
    }
  });
}

// ─── Sprint 6b — Contador de férias pendentes (sidebar) ─────────────

let _vacationPendingCount = 0;

function setupVacationCounter() {
  if (!isAdminGestao()) return;

  db.collection('vacation_requests')
    .where('status', '==', 'aprovada')
    .onSnapshot(snap => {
      _vacationPendingCount = 0;
      snap.docs.forEach(d => {
        const payment = d.data().payment;
        if (!payment || payment.mode === 'deferred') _vacationPendingCount++;
      });
      applyVacationBadge();
    }, err => {
      console.warn('[vacationCounter]', err);
    });
}

function applyVacationBadge() {
  const count = _vacationPendingCount;
  const badge = document.getElementById('vacationPendingBadge');
  if (!badge && count > 0) {
    const items = document.querySelectorAll('.sb-item');
    for (const item of items) {
      if (item.textContent.includes('Férias') || item.textContent.includes('Ferias')) {
        const span = document.createElement('span');
        span.id = 'vacationPendingBadge';
        span.className = 'sidebar-counter';
        span.textContent = count;
        item.appendChild(span);
        break;
      }
    }
  } else if (badge) {
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }
}

/* ─── Init ────────────────────────────────────────────────────── */
document.addEventListener('keydown', (e) => {
  // Enter no campo de senha submete o login
  if (e.key === 'Enter' && document.activeElement?.id === 'loginPass') {
    doLogin();
  }
});

// Atualiza badges de ambiente IMEDIATAMENTE (antes mesmo do auth resolver)
document.addEventListener('DOMContentLoaded', () => {
  updateEnvBadges();
});

console.log('[CrossTainer Professores] Módulo carregado · ambiente:', window.FIREBASE_ENV);
