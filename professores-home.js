// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Módulo Professores · Home "Centro de Pendências" (Plano C)
// Renderiza o painel inicial por perfil. Cada contador é uma query em
// try/catch — se falhar, o chip é omitido e a home nunca quebra.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

function _homeEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function _homeFirstName(profile) {
  const n = (profile && profile.name ? String(profile.name) : '').trim();
  return n ? n.split(/\s+/)[0] : '';
}

function _homeHoje() {
  return new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}

async function _homeSafeCount(factory) {
  try { const snap = await factory(); return snap.size; }
  catch (e) { console.warn('[home count]', e && e.message); return null; }
}

function _homeChip(n, label, onclick) {
  return `<button class="home-chip" onclick="${onclick}"><b>${n}</b> ${_homeEsc(label)}</button>`;
}

function _homeAtalhos(items) {
  return `<div class="home-atalhos-label">Atalhos</div>
    <div class="home-atalhos">${items.map(([ic, label, page]) =>
      `<button class="home-atalho" onclick="navigateTo('${page}')"><span class="ic">${ic}</span>${_homeEsc(label)}</button>`
    ).join('')}</div>`;
}

async function renderHomePage() {
  const el = document.getElementById('page-home');
  if (!el) return;
  const profile = (typeof AppState !== 'undefined' && AppState.userProfile) || {};
  const nome = _homeEsc(_homeFirstName(profile) || 'bem-vindo');
  const isMgmt = (typeof isAdminGestao === 'function' && isAdminGestao())
              || (typeof isSupervisao === 'function' && isSupervisao());

  el.innerHTML = `
    <div class="home-wrap">
      <div class="home-greet">Olá, ${nome} 👋 <span class="home-date">${_homeEsc(_homeHoje())}</span></div>
      <div id="home-body"><div class="home-loading">Carregando…</div></div>
    </div>`;

  try {
    if (isMgmt) await _renderHomeAdmin();
    else await _renderHomeProfessor();
  } catch (err) {
    console.error('[renderHomePage]', err);
    const body = document.getElementById('home-body');
    if (body) body.innerHTML = '<div class="home-empty">Não foi possível carregar o painel agora.</div>';
  }
}

async function _renderHomeAdmin() {
  const body = document.getElementById('home-body');
  if (!body) return;

  const ferias = await _homeSafeCount(() =>
    db.collection('vacation_requests').where('status', '==', 'pendente').get());
  const subs = await _homeSafeCount(() =>
    db.collection('substitutions').where('status', '==', 'pending').get());

  const chips = [];
  if (ferias) chips.push(_homeChip(ferias, ferias === 1 ? 'pedido de férias a aprovar' : 'pedidos de férias a aprovar', "navigateTo('ferias')"));
  if (subs) chips.push(_homeChip(subs, subs === 1 ? 'substituição pendente' : 'substituições pendentes', "navigateTo('agenda-geral')"));

  const pend = chips.length
    ? `<div class="home-card home-pend">
         <div class="home-pt">⚠ Precisam de você</div>
         <div class="home-chips">${chips.join('')}</div>
       </div>`
    : `<div class="home-card home-ok">✅ Tudo em dia — nenhuma pendência no momento.</div>`;

  body.innerHTML = pend + _homeAtalhos([
    ['📅', 'Agenda', 'agenda'],
    ['💰', 'Fechamento', 'fechamento'],
    ['📈', 'Relatórios', 'relatorios'],
  ]);
}

async function _renderHomeProfessor() {
  const body = document.getElementById('home-body');
  if (!body) return;
  const pid = (typeof getCurrentProfessorId === 'function') ? getCurrentProfessorId() : null;

  if (!pid) {
    body.innerHTML = `<div class="home-card home-empty">Seu login ainda não está vinculado a um cadastro de professor. Fale com a administração.</div>`
      + _homeAtalhos([['🌐', 'Agenda Geral', 'agenda-geral']]);
    return;
  }

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  let aulas = [];
  try {
    const res = await ClassService.listByTeacher(pid, { from: start, to: end });
    aulas = (res && res.success ? res.data : []).filter(c => ['prevista', 'realizada', 'substituida'].includes(c.status));
  } catch (e) { console.warn('[home aulas]', e && e.message); }

  const modMap = {};
  try {
    const ms = await db.collection('modalities').get();
    ms.forEach(d => { modMap[d.id] = (d.data().name || '—'); });
  } catch (e) { /* nomes ficam genéricos */ }

  let pendingSubs = 0;
  try {
    const uid = (typeof AppState !== 'undefined' && AppState.currentUser) ? AppState.currentUser.uid : null;
    if (uid && typeof SubstitutionService !== 'undefined') {
      const sr = await SubstitutionService.listPendingForSubstitute(uid);
      pendingSubs = (sr && sr.success) ? sr.data.length : 0;
    }
  } catch (e) { console.warn('[home subs]', e && e.message); }

  const aulasHtml = aulas.length
    ? `<div class="home-chips">${aulas.map(c =>
        `<span class="home-chip home-chip-static">${_homeEsc(c.startTime || '—')} · ${_homeEsc(modMap[c.modalityId] || 'Aula')}</span>`
      ).join('')}</div>`
    : `<div class="home-empty-inline">Nenhuma aula sua hoje.</div>`;

  let html = `<div class="home-card">
      <div class="home-pt">📅 Suas aulas de hoje</div>
      ${aulasHtml}
    </div>`;

  if (pendingSubs) {
    html += `<div class="home-card home-pend">
      <div class="home-pt">🔄 Substituições</div>
      <div class="home-chips">${_homeChip(pendingSubs, pendingSubs === 1 ? 'pedido a responder' : 'pedidos a responder', "navigateTo('agenda-geral')")}</div>
    </div>`;
  }

  body.innerHTML = html + _homeAtalhos([
    ['📅', 'Minha Agenda', 'minha-agenda'],
    ['💳', 'Meus Pagamentos', 'meus-pagamentos'],
    ['🏖️', 'Férias', 'ferias'],
  ]);
}
