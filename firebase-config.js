// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Firebase Config compartilhado
// Usado por: index.html (Comissões) e professores.html (Professores)
// Detecta automaticamente staging vs produção pelo hostname
// ═══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // Configs por ambiente
  const PRODUCTION = {
    apiKey: 'AIzaSyCILbVvHuOgEaFsK-OrXCN7_NmJeMB5GKI',
    authDomain: 'crosstrainer-comissoes.firebaseapp.com',
    projectId: 'crosstrainer-comissoes',
    storageBucket: 'crosstrainer-comissoes.firebasestorage.app',
    messagingSenderId: '909536955760',
    appId: '1:909536955760:web:36a4d166aa747f5f9653b5'
  };

  // Credenciais reais do projeto staging — atualizadas em 08/05/2026
  const STAGING = {
    apiKey: 'AIzaSyC5wqYNNyrJBPXbBPK8gRxQxOPHTIW7TFo',
    authDomain: 'crosstrainer-comissoes-staging.firebaseapp.com',
    projectId: 'crosstrainer-comissoes-staging',
    storageBucket: 'crosstrainer-comissoes-staging.firebasestorage.app',
    messagingSenderId: '909308167932',
    appId: '1:909308167932:web:be97cf28b5c0169f7ef979',
    measurementId: 'G-9WXPTLJH3Y'
  };

  // Detecta ambiente pelo hostname — defensivo: SOMENTE o domínio oficial de
  // produção aponta para o projeto de produção. Qualquer outra coisa (file://,
  // localhost, preview do editor, IP local, staging subdomain) → STAGING.
  // Isso garante que desenvolvimento local NUNCA toca acidentalmente em produção.
  const PRODUCTION_HOSTS = [
    'rafaelmayerbrasil.github.io',     // GitHub Pages
    // adicionar aqui outros domínios de produção se houver
  ];

  function pickConfig() {
    const host = window.location.hostname;
    if (PRODUCTION_HOSTS.includes(host)) {
      return { env: 'production', config: PRODUCTION };
    }
    return { env: 'staging', config: STAGING };
  }

  const picked = pickConfig();
  const firebaseConfig = picked.config;
  window.FIREBASE_ENV = picked.env;

  // Inicializa Firebase apenas uma vez (compartilhado entre páginas)
  if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  // Expor referências globais para retrocompatibilidade com index.html
  window.auth    = firebase.auth();
  window.db      = firebase.firestore();
  // window.storage só inicializa se o SDK estiver carregado
  if (firebase.storage) {
    window.storage = firebase.storage();
  }

  // Log explícito do ambiente — facilita debug
  console.log(
    '%c[Firebase] Ambiente: ' + window.FIREBASE_ENV.toUpperCase() +
    ' · Projeto: ' + firebaseConfig.projectId,
    'background: ' + (window.FIREBASE_ENV === 'production' ? '#c0392b' : '#d4a017') +
    '; color: #fff; padding: 4px 8px; border-radius: 4px; font-weight: bold;'
  );
})();
