'use strict';
// Roda: node scripts/smoke-endereco-novo.js
//
// ══════════════════════════════════════════════════════════════════════
// O endereço novo (sistema.crosstainer.com.br) e o aviso no endereço antigo
// ══════════════════════════════════════════════════════════════════════
//
// `firebase-config.js` decide, pelo host, se a página fala com PRODUÇÃO ou com
// STAGING. Errar aqui é grave nos dois sentidos: o endereço novo caindo em
// staging mostraria dado de teste para a academia; um host qualquer caindo em
// produção deixaria desenvolvimento local mexer em dado real.
//
// Este smoke NÃO lê o texto do arquivo: executa `firebase-config.js` como
// <script> num sandbox, com cada host, e olha o que ele FEZ.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'firebase-config.js'), 'utf8');
const NOVO = 'sistema.crosstainer.com.br';
const ANTIGO = 'rafaelmayerbrasil.github.io';

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

// ─── DOM de mentira, o mínimo que a faixa usa ───
function elemento(tag) {
  const el = {
    tag, filhos: [], pai: null, style: {}, atributos: {}, ouvintes: {}, textContent: '',
    setAttribute(k, v) { this.atributos[k] = String(v); },
    getAttribute(k) { return this.atributos[k]; },
    appendChild(f) { f.pai = this; this.filhos.push(f); return f; },
    insertBefore(f) { f.pai = this; this.filhos.unshift(f); return f; },
    get firstChild() { return this.filhos[0] || null; },
    addEventListener(ev, fn) { this.ouvintes[ev] = fn; },
    remove() { if (this.pai) this.pai.filhos = this.pai.filhos.filter(x => x !== this); },
  };
  return el;
}
const achar = (el, teste) => {
  if (teste(el)) return el;
  for (const f of el.filhos) { const r = achar(f, teste); if (r) return r; }
  return null;
};
const textoDe = el => el.textContent + el.filhos.map(textoDe).join(' ');

// ─── Carrega o arquivo como a página carrega ───
function carregar({ hostname, pathname = '/', search = '', hash = '', sessao = {} }) {
  const inicializados = [];
  const trocas = [];
  const body = elemento('body');
  const head = elemento('head');
  const sandbox = {
    console: { log() {}, error() {}, warn() {} },
    location: { hostname, pathname, search, hash, replace(u) { trocas.push(u); } },
    sessionStorage: {
      getItem: k => (k in sessao ? sessao[k] : null),
      setItem: (k, v) => { sessao[k] = String(v); },
    },
    document: {
      body, head, createElement: elemento, addEventListener() {},
      getElementById: id => achar(body, el => el.atributos.id === id),
    },
    firebase: {
      apps: [],
      initializeApp(cfg) { inicializados.push(cfg); this.apps.push(cfg); },
      auth: () => ({}), firestore: () => ({}),
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fonte, sandbox, { filename: 'firebase-config.js' });
  return { w: sandbox, inicializados, trocas, body, head, sessao };
}

// 1. O endereço novo é produção
{
  const { w, inicializados } = carregar({ hostname: NOVO });
  assert.strictEqual(w.FIREBASE_ENV, 'production');
  assert.strictEqual(inicializados.length, 1);
  assert.strictEqual(inicializados[0].projectId, 'crosstrainer-comissoes');
  assert.strictEqual(w.FIREBASE_CONFIG.projectId, 'crosstrainer-comissoes');
  ok('sistema.crosstainer.com.br fala com o projeto de produção');
}

// 2. O endereço antigo continua sendo produção
{
  const { w } = carregar({ hostname: ANTIGO, pathname: '/crosstrainer-comissoes/' });
  // na fase "redirecionar" o Firebase nem é inicializado — a decisão continua valendo
  assert.strictEqual(w.CT_ENDERECO.decidir({ hostname: ANTIGO, pathname: '/' }, 'nenhuma').env, 'production');
  ok('rafaelmayerbrasil.github.io continua sendo produção');
}

// 3. Qualquer outro host é staging — inclusive a hospedagem do Firebase de produção
{
  const outros = ['crosstrainer-comissoes.web.app', 'crosstrainer-comissoes.firebaseapp.com',
    'crosstrainer-comissoes-staging.web.app', 'localhost', '127.0.0.1', '',
    'sistema.crosstainer.com.br.evil.com', 'xsistema.crosstainer.com.br', 'crosstainer.com.br'];
  outros.forEach(h => {
    const { w, inicializados } = carregar({ hostname: h });
    assert.strictEqual(w.FIREBASE_ENV, 'staging', `"${h}" tem que cair em staging`);
    assert.strictEqual(inicializados[0].projectId, 'crosstrainer-comissoes-staging', `"${h}" inicializou o projeto errado`);
  });
  ok(`${outros.length} outros hosts caem em staging (web.app de produção, localhost, parecidos com o novo)`);
}

// 4. Para onde o endereço antigo leva: a mesma tela, no endereço novo
{
  const { w } = carregar({ hostname: 'localhost' });
  const d = (pathname, search = '', hash = '') => w.CT_ENDERECO.decidir({ hostname: ANTIGO, pathname, search, hash }, 'aviso').destino;
  assert.strictEqual(d('/crosstrainer-comissoes/professores.html', '?x=1', '#agenda'), `https://${NOVO}/professores.html?x=1#agenda`);
  assert.strictEqual(d('/crosstrainer-comissoes/'), `https://${NOVO}/`);
  assert.strictEqual(d('/crosstrainer-comissoes'), `https://${NOVO}/`);
  assert.strictEqual(d('/crosstrainer-comissoes/index.html'), `https://${NOVO}/index.html`);
  assert.strictEqual(d('/'), `https://${NOVO}/`);
  // um caminho que só COMEÇA parecido não perde pedaço
  assert.strictEqual(d('/crosstrainer-comissoes-x/a.html'), `https://${NOVO}/crosstrainer-comissoes-x/a.html`);
  assert.strictEqual(w.CT_ENDERECO.novo, NOVO);
  ok('o destino preserva a tela, o "?" e o "#", sem o prefixo do GitHub Pages');
}

// 5. As três fases
{
  const { w } = carregar({ hostname: 'localhost' });
  const antigo = { hostname: ANTIGO, pathname: '/crosstrainer-comissoes/' };
  assert.strictEqual(w.CT_ENDERECO.decidir(antigo, 'nenhuma').acao, null);
  assert.strictEqual(w.CT_ENDERECO.decidir(antigo, 'aviso').acao, 'aviso');
  assert.strictEqual(w.CT_ENDERECO.decidir(antigo, 'redirecionar').acao, 'redirecionar');
  // fase desconhecida não faz nada (não redireciona por engano)
  assert.strictEqual(w.CT_ENDERECO.decidir(antigo, 'qualquer-coisa').acao, null);
  [NOVO, 'localhost', 'crosstrainer-comissoes.web.app'].forEach(h => ['nenhuma', 'aviso', 'redirecionar'].forEach(f => {
    const r = w.CT_ENDERECO.decidir({ hostname: h, pathname: '/' }, f);
    assert.strictEqual(r.acao, null, `${h} na fase ${f} não pode ter ação`);
    assert.strictEqual(r.destino, null);
  }));
  ok('nenhuma / aviso / redirecionar — e só o endereço antigo tem ação');
}

// 6. De ponta a ponta no endereço antigo: o arquivo faz o que a fase gravada manda
{
  const r = carregar({ hostname: ANTIGO, pathname: '/crosstrainer-comissoes/professores.html', hash: '#agenda' });
  const fase = r.w.CT_ENDERECO.fase;
  assert.ok(['nenhuma', 'aviso', 'redirecionar'].includes(fase), 'fase gravada inválida: ' + fase);
  const faixa = achar(r.body, el => el.atributos.id === 'ct-endereco-novo');
  if (fase === 'nenhuma') {
    assert.strictEqual(r.trocas.length, 0); assert.strictEqual(faixa, null); assert.strictEqual(r.inicializados.length, 1);
  } else if (fase === 'aviso') {
    assert.strictEqual(r.trocas.length, 0); assert.ok(faixa, 'a faixa tem que aparecer'); assert.strictEqual(r.inicializados.length, 1);
  } else {
    assert.deepStrictEqual(r.trocas, [`https://${NOVO}/professores.html#agenda`]);
    assert.strictEqual(r.inicializados.length, 0, 'quem vai ser redirecionado não inicializa o Firebase');
  }
  // e no endereço novo nunca há faixa nem troca
  const novo = carregar({ hostname: NOVO });
  assert.strictEqual(novo.trocas.length, 0);
  assert.strictEqual(achar(novo.body, el => el.atributos.id === 'ct-endereco-novo'), null);
  ok(`fase gravada = "${fase}", e o carregamento no endereço antigo faz exatamente isso`);
}

// 7. A faixa
{
  const r = carregar({ hostname: 'localhost' });
  const destino = `https://${NOVO}/professores.html#agenda`;
  r.w.CT_ENDERECO.mostrarAviso(destino);
  const faixa = achar(r.body, el => el.atributos.id === 'ct-endereco-novo');
  assert.ok(faixa, 'a faixa entra no body');
  const link = achar(faixa, el => el.tag === 'a');
  assert.strictEqual(link.atributos.href, destino);
  const texto = textoDe(faixa);
  assert.ok(texto.includes(NOVO), 'a faixa diz o endereço novo');
  assert.ok(/mesmo e-mail e senha/i.test(texto), 'a faixa diz que o login é o mesmo');
  assert.ok(!/crosstrainer/i.test(texto), 'a grafia errada da marca não aparece na faixa');
  // some na impressão (receipt.html é impresso)
  const estilo = achar(r.head, el => el.tag === 'style');
  assert.ok(estilo && /@media print/.test(estilo.textContent) && /display:\s*none/.test(estilo.textContent));
  // o × fecha e lembra até o fim da sessão
  const fechar = achar(faixa, el => el.tag === 'button');
  assert.ok(fechar.atributos['aria-label'], 'o × tem nome para leitor de tela');
  fechar.ouvintes.click();
  assert.strictEqual(achar(r.body, el => el.atributos.id === 'ct-endereco-novo'), null);
  assert.strictEqual(r.sessao['ct-endereco-novo-fechado'], '1');
  // chamar duas vezes não empilha
  const r2 = carregar({ hostname: 'localhost' });
  r2.w.CT_ENDERECO.mostrarAviso(destino); r2.w.CT_ENDERECO.mostrarAviso(destino);
  assert.strictEqual(r2.body.filhos.filter(el => el.atributos.id === 'ct-endereco-novo').length, 1);
  ok('a faixa leva ao destino, diz o endereço e o login, some na impressão e o × fecha');
}

// 8. Fechada na sessão, não volta
{
  const r = carregar({ hostname: 'localhost', sessao: { 'ct-endereco-novo-fechado': '1' } });
  r.w.CT_ENDERECO.mostrarAviso(`https://${NOVO}/`);
  assert.strictEqual(achar(r.body, el => el.atributos.id === 'ct-endereco-novo'), null);
  // sessionStorage que estoura (aba privada) não derruba a página: mostra a faixa
  const r2 = carregar({ hostname: 'localhost' });
  r2.w.sessionStorage.getItem = () => { throw new Error('bloqueado'); };
  r2.w.sessionStorage.setItem = () => { throw new Error('bloqueado'); };
  r2.w.CT_ENDERECO.mostrarAviso(`https://${NOVO}/`);
  const faixa = achar(r2.body, el => el.atributos.id === 'ct-endereco-novo');
  assert.ok(faixa);
  achar(faixa, el => el.tag === 'button').ouvintes.click();
  assert.strictEqual(achar(r2.body, el => el.atributos.id === 'ct-endereco-novo'), null);
  ok('faixa fechada não volta na mesma sessão; armazenamento bloqueado não derruba a página');
}

console.log(`\n${n} verificações ✓`);
