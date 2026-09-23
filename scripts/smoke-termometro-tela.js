'use strict';
// Roda: node scripts/smoke-termometro-tela.js
//
// A página do termômetro (termometro.html) roda como <script> num sandbox e as
// funções que desenham são CHAMADAS com um documento inventado — verificar que
// o arquivo carrega não basta (lição de 01/09/2026).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'termometro.html'), 'utf8');
const js = fs.readFileSync(path.join(raiz, 'termometro.js'), 'utf8');

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

/* 1. a página carrega o que precisa, com o mesmo ?v= */
{
  const nossos = [...html.matchAll(/<script src="([a-z0-9-]+\.js)\?v=(\d{8})"><\/script>/g)].map(m => ({ f: m[1], v: m[2] }));
  assert.deepStrictEqual(nossos.map(x => x.f), ['firebase-config.js', 'termometro.js']);
  assert.ok(nossos.every(x => x.v === nossos[0].v), 'todos com o mesmo ?v=');
  assert.ok(/firebase-firestore-compat\.js/.test(html) && /firebase-auth-compat\.js/.test(html));
  assert.ok(/<meta name="viewport"/.test(html), 'celular');
  assert.ok(/prévia automática/i.test(html) && /arquivo exportado/i.test(html), 'a página diz que não é o oficial');
  ok('termometro.html: firebase-config e termometro.js com o mesmo ?v=, e o aviso de prévia');
}

/* 2. roda como <script> e expõe as funções que desenham */
const sandbox = { console: { log() {}, error() {}, warn() {} }, Intl, Date, JSON, Math, Number, String };
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(js, sandbox, { filename: 'termometro.js' });
const T = sandbox.TermometroTela;
const lido = x => x.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');   // o que a pessoa lê, sem as marcações
{
  assert.ok(T && typeof T.cartao === 'function' && typeof T.ehGestao === 'function' && typeof T.mesPadrao === 'function');
  ok('termometro.js roda como <script> e expõe TermometroTela');
}

/* 3. quem entra: admin e supervisão; vendedora e professor não */
{
  assert.strictEqual(T.ehGestao({ profiles: ['admin'] }), true);
  assert.strictEqual(T.ehGestao({ profiles: ['supervisao', 'professor'] }), true);
  assert.strictEqual(T.ehGestao({ role: 'admin' }), true, 'perfil antigo (role)');
  assert.strictEqual(T.ehGestao({ role: 'vendedor', profiles: ['vendedor'] }), false);
  assert.strictEqual(T.ehGestao({ profiles: ['professor'] }), false);
  assert.strictEqual(T.ehGestao(null), false);
  ok('só admin e supervisão entram');
}

/* 4. mês padrão: o de ontem (no dia 1º, o mês que acabou) */
{
  assert.strictEqual(T.mesPadrao('2026-09-22'), '2026-09');
  assert.strictEqual(T.mesPadrao('2026-10-01'), '2026-09');
  ok('mês padrão é o de ontem');
}

/* 5. o cartão da unidade */
const doc = {
  unidade: 'PP', mes: '2026-09', recebido: 45993.13,
  ativacoes: { total: 52, novo: 25, renovacao: 18, retorno: 6, voucher: 3, novosRetorno: 31 },
  faixas: { meta: 50, superMeta: 57, metaGold: 65, minNovos: 18, minRenov: 25, minVoucher: 7, multFalhaRenov: 0.7, multFalhaVoucher: 0.85 },
  faixaAtual: 'meta', faltaPara: { meta: 0, superMeta: 5, metaGold: 13 }, metaDoMes: false, jaPagos: 40,
  dias: { esperados: 21, ateDia: '2026-09-21', problemas: [{ dia: '2026-09-05', situacao: 'falhou' }, { dia: '2026-09-06', situacao: 'vazio_conferir' }] },
  atualizadoEm: { toDate: () => new Date('2026-09-22T07:03:00Z') },
};
{
  const h = T.cartao(doc);
  assert.ok(/Pequeno Príncipe/.test(h), 'nome da unidade');
  assert.ok(/>52</.test(h), 'total de ativações');
  assert.ok(/Meta batida/.test(h), 'faixa atual');
  assert.ok(/Faltam 5 para a Super Meta/.test(lido(h)), 'quanto falta para a próxima faixa: ' + lido(h));
  // as faixas numa linha própria: embaixo de cada marca elas se atropelavam no celular
  assert.ok(/Meta 50 · Super Meta 57 · Meta Gold 65/.test(lido(h)), 'legenda das faixas');
  assert.ok(!/class="marca"[^>]*>\s*<i>/.test(h), 'rótulo solto embaixo da marca');
  assert.ok(/31\s*\/\s*18/.test(h), 'novos+retorno contra o mínimo');
  assert.ok(/18\s*\/\s*25/.test(h) && /prêmio da unidade cai 30%/.test(h), 'renovações abaixo do mínimo e quanto o prêmio cai');
  assert.ok(/3\s*\/\s*7/.test(h) && /prêmio da unidade cai 15%/.test(h), 'vouchers abaixo do mínimo');
  assert.ok(/45\.993,13/.test(h), 'dinheiro recebido');
  assert.ok(/21\/09/.test(h), 'até que dia há dado');
  assert.ok(/meta deste mês ainda não foi configurada/i.test(h), 'avisa quando vale o padrão da unidade');
  assert.ok(/05/.test(h) && /sem resposta da Pacto/i.test(h), 'dia que falhou');
  assert.ok(/sem nenhum pagamento/i.test(h), 'dia vazio');
  ok('cartão: ativações, faixa, quanto falta, travas com o efeito no prêmio, dinheiro, até quando e os avisos');

  const gold = T.cartao({ ...doc, ativacoes: { ...doc.ativacoes, total: 70 }, faixaAtual: 'gold', faltaPara: { meta: 0, superMeta: 0, metaGold: 0 }, metaDoMes: true, dias: { esperados: 21, ateDia: '2026-09-21', problemas: [] } });
  assert.ok(/Meta Gold/.test(gold) && !/Faltam/.test(lido(gold)), 'gold não fala em faltar');
  assert.ok(!/ainda não foi configurada/.test(gold));
  const abaixo = T.cartao({ ...doc, ativacoes: { ...doc.ativacoes, total: 10, novosRetorno: 5 }, faixaAtual: null, faltaPara: { meta: 40, superMeta: 47, metaGold: 55 } });
  assert.ok(/Faltam 40 para a Meta\./.test(lido(abaixo)), lido(abaixo));
  assert.ok(/sem isto não há prêmio/i.test(abaixo), 'a regra de ouro dos novos');
  ok('cartão: Meta Gold, abaixo da meta e a regra de ouro dos novos');
}

/* 6. sem documento: diz que ainda não há, nunca mostra zero */
{
  const h = T.cartao(null, 'CP');
  assert.ok(/Campeche/.test(h) && /ainda não/i.test(h));
  assert.ok(!/>0</.test(h), 'nada de zero no lugar de "não sei"');
  ok('unidade sem termômetro: "ainda não calculado", nunca zero');
}

/* 7. nada de HTML injetado a partir do documento */
{
  const h = T.cartao({ ...doc, unidade: '<img src=x onerror=alert(1)>' });
  assert.ok(!/<img/.test(h));
  ok('texto do documento é escapado');
}

/* 8. a página só LÊ: nenhuma escrita no banco nem chamada de Function */
{
  assert.ok(!/\.(set|update|add|delete)\(/.test(js.replace(/classList\.add\(|\.delete\(\s*\)\s*\/\/ ?Map/g, '')), 'a página grava algo');
  assert.ok(!/httpsCallable/.test(js));
  assert.ok(/collection\('pacto_termometro'\)/.test(js) && !/pacto_sombra_dias/.test(js), 'só lê o termômetro');
  ok('a página só lê pacto_termometro');
}

/* 9. o atalho no menu de Comissões: a função REAL do index.html, chamada com
      admin e com vendedora (recorte por regex, não por '\n    }\n' — o arquivo
      pode estar em CRLF) */
{
  const idx = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
  const fonte = idx.match(/function buildSidebar\(\) \{[\s\S]*?\n\s*function sbItem\([\s\S]*?\n\s*\}\r?\n/);
  assert.ok(fonte, 'não achei buildSidebar + sbItem no index.html');
  const menuDe = perfil => {
    const nav = { innerHTML: '' };
    const sb = {
      document: { getElementById: id => (id === 'sidebarNav' ? nav : null) },
      userProfile: perfil, currentUser: { email: 'x@x' }, currentPage: 'dashboard',
      isOwner: () => false, UserModel: { deriveUserModel: () => ({ moduleAccess: { comissoes: true } }) },
    };
    vm.createContext(sb);
    vm.runInContext(fonte[0] + '\nbuildSidebar();', sb);
    return nav.innerHTML;
  };
  const admin = menuDe({ role: 'admin', profiles: ['admin'] });
  assert.ok(/href="termometro\.html"/.test(admin), 'admin vê o atalho');
  assert.ok(admin.indexOf('termometro.html') > admin.indexOf("'upload'") && admin.indexOf('termometro.html') < admin.indexOf('sb-section">Admin'),
    'o atalho fica na seção Gestão, depois do Upload');
  assert.ok(!/termometro/.test(menuDe({ role: 'vendedor', profiles: ['vendedor'] })), 'vendedora não vê');
  assert.ok(/href="index\.html"/.test(html), 'o termômetro tem o caminho de volta para Comissões');
  ok('menu de Comissões: atalho para o termômetro só na gestão; e o termômetro volta para Comissões');
}

console.log('\n✅ smoke-termometro-tela: ' + n + '/10');
