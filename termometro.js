// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Termômetro do mês: a página
// ═══════════════════════════════════════════════════════════════════════
//
// Desenho: docs/superpowers/specs/2026-09-22-termometro-do-mes-design.md
//
// Gestão (admin e supervisão) lê `pacto_termometro`; vendedora (22/09/2026)
// lê `pacto_termometro_equipe`, a mesma coisa SEM o dinheiro da unidade. A
// Cloud Function grava os dois depois de cada busca na API da Pacto — nenhuma
// conta mora aqui. É prévia: o cálculo oficial da comissão continua sendo o arquivo.
//
// As funções que desenham ficam em `window.TermometroTela` para o smoke
// chamá-las num sandbox.

(function () {
  'use strict';

  const NOMES = { CP: 'Campeche', PP: 'Pequeno Príncipe' };
  const FAIXA_BATIDA = { meta: 'Meta batida', super: 'Super Meta batida', gold: 'Meta Gold batida' };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = v => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // multiplicador da config (0,70) → o que a gestão entende ("30%")
  const queda = mult => Math.round((1 - Number(mult)) * 100) + '%';
  const diaMes = iso => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '');

  function somarDias(dia, n) {
    const d = new Date(dia + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function hojeSP() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  }

  const COLECAO = { gestao: 'pacto_termometro', equipe: 'pacto_termometro_equipe' };

  /** 'gestao' (admin, supervisão) · 'equipe' (vendedora) · null — as mesmas portas das regras. */
  function perfilDe(u) {
    if (!u) return null;
    const perfis = [].concat(u.profiles || [], u.role ? [u.role] : []);
    if (perfis.indexOf('admin') >= 0 || perfis.indexOf('supervisao') >= 0) return 'gestao';
    if (perfis.indexOf('vendedor') >= 0) return 'equipe';
    return null;
  }

  /** O mês de ontem: no dia 1º ainda não há dia do mês novo. */
  function mesPadrao(hoje) { return somarDias(hoje, -1).slice(0, 7); }

  function quando(ts) {
    if (!ts) return '';
    const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
    if (isNaN(d)) return '';
    const f = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return f.format(d).replace(',', ' às');
  }

  function proximaFaixa(t) {
    const f = t.faltaPara || {};
    if (!t.faixaAtual) return { nome: 'Meta', falta: f.meta };
    if (t.faixaAtual === 'meta') return { nome: 'Super Meta', falta: f.superMeta };
    if (t.faixaAtual === 'super') return { nome: 'Meta Gold', falta: f.metaGold };
    return null;
  }

  function barra(t) {
    const fx = t.faixas || {};
    const topo = Math.max(fx.metaGold || 0, t.ativacoes.total || 0, 1);
    const pos = v => Math.min(100, Math.round((v / topo) * 1000) / 10);
    // Só o tracinho na barra; os nomes vão numa linha própria — embaixo de cada
    // marca eles se atropelavam no celular (as faixas ficam a poucas ativações).
    const marca = (v, rot) => `<span class="marca" style="left:${pos(v)}%" title="${esc(rot)}: ${esc(v)}"></span>`;
    return `<div class="barra" role="img" aria-label="${esc(t.ativacoes.total)} ativações de ${esc(fx.metaGold)} da Meta Gold">
        <div class="cheio ${t.faixaAtual ? 'ok' : ''}" style="width:${pos(t.ativacoes.total)}%"></div>
        ${marca(fx.meta, 'Meta')}${marca(fx.superMeta, 'Super Meta')}${marca(fx.metaGold, 'Meta Gold')}
      </div>
      <div class="muted pequeno">Meta ${esc(fx.meta)} · Super Meta ${esc(fx.superMeta)} · Meta Gold ${esc(fx.metaGold)}</div>`;
  }

  function trava(rotulo, valor, minimo, abaixo) {
    const okMin = valor >= minimo;
    return `<div class="trava ${okMin ? 'ok' : 'nao'}">
        <span>${esc(rotulo)}</span>
        <span class="v">${esc(valor)} / ${esc(minimo)}</span>
        <span class="efeito">${okMin ? '✓ no mínimo' : esc(abaixo)}</span>
      </div>`;
  }

  function avisosDosDias(t) {
    const probs = (t.dias && t.dias.problemas) || [];
    const de = sit => probs.filter(p => p.situacao === sit || (sit === 'erro' && ['falhou', 'credencial_recusada', 'limite'].indexOf(p.situacao) >= 0));
    const lista = ps => ps.map(p => diaMes(p.dia)).join(', ');
    const out = [];
    const erro = de('erro');
    if (erro.length) out.push(`<div class="erro">${erro.length} dia(s) sem resposta da Pacto (${esc(lista(erro))}) — os números podem estar abaixo do real.</div>`);
    const vazio = de('vazio_conferir');
    if (vazio.length) out.push(`<div class="aviso">${vazio.length} dia(s) em que a Pacto respondeu sem nenhum pagamento (${esc(lista(vazio))}) — conferir.</div>`);
    const nao = de('nao_buscado');
    if (nao.length) out.push(`<div class="aviso">${nao.length} dia(s) ainda não buscados (${esc(lista(nao))}).</div>`);
    return out.join('');
  }

  /** Cartão de uma unidade. `t` nulo = ainda não calculado (nunca vira zero). */
  function cartao(t, sigla) {
    const unidade = (t && t.unidade) || sigla || '';
    const nome = NOMES[unidade] ? `${NOMES[unidade]} (${unidade})` : unidade;
    if (!t) {
      return `<section class="card unidade"><h2>${esc(nome)}</h2>
        <p class="muted">Ainda não há termômetro deste mês. Ele é calculado toda madrugada, depois da busca na Pacto.</p></section>`;
    }
    const a = t.ativacoes || {};
    const fx = t.faixas || {};
    const prox = proximaFaixa(t);
    const cabeca = t.faixaAtual
      ? `<span class="faixa ok">${esc(FAIXA_BATIDA[t.faixaAtual] || t.faixaAtual)}</span>`
      : '<span class="faixa">abaixo da meta</span>';
    const falta = prox && prox.falta > 0 ? `<p class="falta">Faltam <b>${esc(prox.falta)}</b> para a ${esc(prox.nome)}.</p>` : '';
    const semNovos = a.novosRetorno < fx.minNovos;
    // a cópia da equipe não tem o dinheiro (é o faturamento da unidade)
    const comDinheiro = typeof t.recebido === 'number';

    return `<section class="card unidade">
      <h2>${esc(nome)}</h2>
      <p class="muted">Dados até ${esc(diaMes(t.dias && t.dias.ateDia) || '—')} · atualizado ${esc(quando(t.atualizadoEm) || '—')}</p>
      ${t.metaDoMes ? '' : '<div class="aviso">A meta deste mês ainda não foi configurada — valendo o padrão da unidade.</div>'}
      <div class="topo">
        <div><div class="num">${esc(a.total)}</div><div class="muted">ativações no mês</div></div>
        ${cabeca}
      </div>
      ${barra(t)}
      ${falta}
      <div class="travas">
        ${trava('Novos + retorno', a.novosRetorno, fx.minNovos, 'abaixo do mínimo: sem isto não há prêmio da unidade')}
        ${trava('Renovações', a.renovacao, fx.minRenov, `abaixo do mínimo: o prêmio da unidade cai ${queda(fx.multFalhaRenov)}`)}
        ${trava('Vouchers', a.voucher, fx.minVoucher, `abaixo do mínimo: o prêmio da unidade cai ${queda(fx.multFalhaVoucher)}`)}
      </div>
      ${semNovos && t.faixaAtual ? '<div class="erro">A faixa foi batida, mas sem o mínimo de novos + retorno o prêmio da unidade não sai.</div>' : ''}
      <div class="kv">
        <span>Novos</span><span>${esc(a.novo)}</span>
        <span>Retornos</span><span>${esc(a.retorno)}</span>
        <span>Renovações</span><span>${esc(a.renovacao)}</span>
        <span>Vouchers</span><span>${esc(a.voucher)}</span>
        ${comDinheiro ? `<span>Dinheiro recebido</span><span>${esc(brl(t.recebido))}</span>` : ''}
      </div>
      ${comDinheiro ? '<p class="muted pequeno">O dinheiro não inclui a vendinha de balcão (água, lanche), que a Pacto não entrega pela API.</p>' : ''}
      ${avisosDosDias(t)}
    </section>`;
  }

  window.TermometroTela = { cartao, perfilDe, mesPadrao, COLECAO };

  // ─── A página ───
  if (typeof document === 'undefined' || !document.getElementById || !document.getElementById('app')) return;

  const $ = id => document.getElementById(id);
  let perfil = null;

  function mostrar(qual) {
    ['telaLogin', 'telaRestrita', 'app'].forEach(id => { $(id).hidden = id !== qual; });
  }

  async function carregar() {
    const mes = $('mes').value;
    $('cartoes').innerHTML = '<p class="muted">Carregando…</p>';
    try {
      const col = firebase.firestore().collection(COLECAO[perfil]);
      const [cp, pp] = await Promise.all(['CP', 'PP'].map(u => col.doc(u + '_' + mes).get()));
      $('cartoes').innerHTML = cartao(cp.exists ? cp.data() : null, 'CP') + cartao(pp.exists ? pp.data() : null, 'PP');
    } catch (err) {
      $('cartoes').innerHTML = `<div class="erro">Não foi possível carregar: ${esc(err.message)}</div>`;
    }
  }

  function mudarMes(delta) {
    const [a, m] = $('mes').value.split('-').map(Number);
    const d = new Date(Date.UTC(a, m - 1 + delta, 1));
    $('mes').value = d.toISOString().slice(0, 7);
    carregar();
  }

  function iniciar() {
    const env = window.FIREBASE_ENV || 'staging';
    $('ambiente').textContent = env === 'production' ? 'PRODUÇÃO' : 'STAGING';
    $('ambiente').className = 'badge ' + env;
    $('mes').value = mesPadrao(hojeSP());
    $('mes').onchange = carregar;
    $('anterior').onclick = () => mudarMes(-1);
    $('seguinte').onclick = () => mudarMes(1);

    $('entrar').onclick = async () => {
      $('loginErro').hidden = true;
      try {
        await firebase.auth().signInWithEmailAndPassword($('loginEmail').value.trim(), $('loginSenha').value);
      } catch (err) {
        $('loginErro').textContent = 'Não foi possível entrar: ' + err.message;
        $('loginErro').hidden = false;
      }
    };
    $('sair').onclick = () => firebase.auth().signOut();

    firebase.auth().onAuthStateChanged(async user => {
      $('sair').hidden = !user;
      $('usuario').textContent = user ? user.email : '';
      if (!user) { mostrar('telaLogin'); return; }
      try {
        const snap = await firebase.firestore().collection('users').doc(user.uid).get();
        perfil = perfilDe(snap.exists ? snap.data() : null);
        if (!perfil) { mostrar('telaRestrita'); return; }
      } catch (err) { mostrar('telaRestrita'); return; }
      mostrar('app');
      carregar();
    });
  }

  iniciar();
})();
