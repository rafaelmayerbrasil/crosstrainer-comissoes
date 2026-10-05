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

  // Detecta ambiente pelo hostname — defensivo: SOMENTE os dois endereços oficiais
  // de produção apontam para o projeto de produção. Qualquer outra coisa (file://,
  // localhost, preview do editor, IP local, staging subdomain) → STAGING.
  // Isso garante que desenvolvimento local NUNCA toca acidentalmente em produção.
  const ENDERECO_NOVO = 'sistema.crosstainer.com.br';     // hospedagem do Firebase (desde out/2026)
  const ENDERECO_ANTIGO = 'rafaelmayerbrasil.github.io';  // GitHub Pages
  const PREFIXO_ANTIGO = '/crosstrainer-comissoes';       // a pasta do repositório no GitHub Pages
  const PRODUCTION_HOSTS = [ENDERECO_ANTIGO, ENDERECO_NOVO];
  // ⚠️ `crosstrainer-comissoes.web.app` fica FORA de propósito: é a mesma hospedagem
  // do endereço novo, mas quem chega por ele cai em staging, como sempre caiu.

  // Mudança de endereço — o que acontece com quem chega pelo endereço ANTIGO:
  //   'nenhuma'      → nada (o endereço novo ainda não responde)
  //   'aviso'        → faixa no topo com o endereço novo
  //   'redirecionar' → leva sozinho para a mesma tela no endereço novo
  // Cada troca de fase é uma publicação. Teste: scripts/smoke-endereco-novo.js
  const FASE_MUDANCA = 'nenhuma';

  // Pura: recebe o endereço da página e a fase, devolve o ambiente e o que fazer.
  function decidirEndereco(loc, fase) {
    const host = (loc && loc.hostname) || '';
    const env = PRODUCTION_HOSTS.includes(host) ? 'production' : 'staging';
    if (host !== ENDERECO_ANTIGO) return { env: env, destino: null, acao: null };

    let caminho = loc.pathname || '/';
    if (caminho === PREFIXO_ANTIGO) caminho = '/';
    else if (caminho.indexOf(PREFIXO_ANTIGO + '/') === 0) caminho = caminho.slice(PREFIXO_ANTIGO.length);
    const destino = 'https://' + ENDERECO_NOVO + caminho + (loc.search || '') + (loc.hash || '');
    const acao = (fase === 'aviso' || fase === 'redirecionar') ? fase : null;
    return { env: env, destino: destino, acao: acao };
  }

  // Faixa "mudamos de endereço". Estilos próprios, sem variável de tema: ela
  // aparece em seis páginas com temas diferentes (e some na impressão do recibo).
  const ID_AVISO = 'ct-endereco-novo';
  const CHAVE_AVISO_FECHADO = 'ct-endereco-novo-fechado';

  function mostrarAviso(destino) {
    try { if (window.sessionStorage.getItem(CHAVE_AVISO_FECHADO) === '1') return; } catch (e) { /* aba privada */ }
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', function () { mostrarAviso(destino); });
      return;
    }
    if (document.getElementById(ID_AVISO)) return;

    const estilo = document.createElement('style');
    estilo.textContent =
      '#' + ID_AVISO + '{position:fixed;top:0;left:0;right:0;z-index:2147483000;display:flex;flex-wrap:wrap;' +
      'align-items:center;justify-content:center;gap:8px 12px;padding:10px 44px 10px 12px;background:#1f2937;' +
      'color:#fff;font:14px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.35)}' +
      '#' + ID_AVISO + ' a{background:#f59e0b;color:#111827;font-weight:700;text-decoration:none;' +
      'padding:6px 12px;border-radius:6px;white-space:nowrap}' +
      '#' + ID_AVISO + ' button{position:absolute;top:4px;right:4px;width:36px;height:36px;border:0;' +
      'background:transparent;color:#fff;font-size:22px;line-height:1;cursor:pointer}' +
      '@media print{#' + ID_AVISO + '{display:none}}';
    document.head.appendChild(estilo);

    const faixa = document.createElement('div');
    faixa.setAttribute('id', ID_AVISO);
    faixa.setAttribute('role', 'status');

    const texto = document.createElement('span');
    texto.textContent = '📍 O sistema mudou de endereço: ' + ENDERECO_NOVO + '. Entre lá com o mesmo e-mail e senha.';
    faixa.appendChild(texto);

    const link = document.createElement('a');
    link.setAttribute('href', destino);
    link.textContent = 'Ir para o endereço novo';
    faixa.appendChild(link);

    const fechar = document.createElement('button');
    fechar.setAttribute('type', 'button');
    fechar.setAttribute('aria-label', 'Fechar o aviso');
    fechar.textContent = '×';
    fechar.addEventListener('click', function () {
      try { window.sessionStorage.setItem(CHAVE_AVISO_FECHADO, '1'); } catch (e) { /* aba privada */ }
      faixa.remove();
    });
    faixa.appendChild(fechar);

    document.body.appendChild(faixa);
  }

  // Exposto para o teste e para conferência pelo console
  window.CT_ENDERECO = { fase: FASE_MUDANCA, novo: ENDERECO_NOVO, decidir: decidirEndereco, mostrarAviso: mostrarAviso };

  const endereco = decidirEndereco(window.location, FASE_MUDANCA);
  window.FIREBASE_ENV = endereco.env;

  // Quem chegou pelo endereço antigo na fase "redirecionar" sai daqui sem inicializar nada
  if (endereco.acao === 'redirecionar') {
    window.location.replace(endereco.destino);
    return;
  }
  if (endereco.acao === 'aviso') mostrarAviso(endereco.destino);

  const firebaseConfig = endereco.env === 'production' ? PRODUCTION : STAGING;
  // Exposto p/ apps secundários por ambiente (ex.: index.html cria usuário via app 'secondary')
  window.FIREBASE_CONFIG = firebaseConfig;

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
