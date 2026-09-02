'use strict';
// Roda: node scripts/smoke-modulos-no-browser.js
//
// ══════════════════════════════════════════════════════════════════════
// Os módulos carregam e FUNCIONAM como <script>, não só como require()
// ══════════════════════════════════════════════════════════════════════
//
// Existe por causa de um bug real, pego pelo Rafael no staging em 01/09/2026:
// o upload do relatório de vendas morria com
//
//     Cannot read properties of undefined (reading 'campo')
//
// A causa: `pacto-adapter.js` declara `const PactoAdapter = {...}` no topo do
// arquivo, e **`const` em script clássico não vira `window.PactoAdapter`** —
// fica só no escopo global léxico. `vendas-aguardando.js` procurava o adapter em
// `window` e recebia undefined. Nos testes em Node nada disso aparece, porque lá
// o caminho é `require()`.
//
// Então este smoke NÃO usa require: monta um sandbox com `window`, executa os
// arquivos na ordem em que o `index.html` os carrega, e EXERCITA as funções —
// não basta conferir que o objeto existe, tem que rodar com dado de verdade.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

// ─── Sandbox parecido com a página ───
// Stubs mínimos: alguns arquivos da página leem location/navigator ao carregar.
const sandbox = {
  console: { log() {}, error() {}, warn() {} },
  location: { hostname: 'localhost', origin: 'http://localhost', href: 'http://localhost/' },
  navigator: { userAgent: 'node' },
  document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// A ordem é a do index.html: quem depende vem depois
const nossos = [...html.matchAll(/<script src="([a-z0-9-]+\.js)"><\/script>/g)].map(m => m[1]);
const alvo = ['pacto-adapter.js', 'estorno-comissao.js', 'vendas-aguardando.js', 'commission.js'];

{
  alvo.forEach(f => assert.ok(nossos.includes(f), `${f} precisa estar no index.html`));
  const iPacto = nossos.indexOf('pacto-adapter.js');
  const iVendas = nossos.indexOf('vendas-aguardando.js');
  assert.ok(iVendas > iPacto, 'vendas-aguardando depende do adapter e tem que vir depois dele');
  ok('os módulos estão no index.html, na ordem em que dependem uns dos outros');
}

// Executa cada arquivo como <script>, na ordem da página. Alguns precisam de
// DOM de verdade para carregar — esses são pulados; os `alvo` NÃO podem falhar.
const pulados = [];
nossos.filter(f => fs.existsSync(path.join(raiz, f))).forEach(f => {
  try { vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8'), sandbox, { filename: f }); }
  catch (e) {
    if (alvo.includes(f)) { console.error('✗ ' + f + ' nem carrega: ' + e.message); process.exit(1); }
    pulados.push(f);
  }
});
ok('os módulos de cálculo carregam como <script>' + (pulados.length ? ' (pulados, precisam de DOM: ' + pulados.join(', ') + ')' : ''));

// ─── Agora EXERCITA, que é onde o bug estava ───
const run = expr => vm.runInContext(expr, sandbox);

{
  assert.strictEqual(run('typeof PactoAdapter'), 'object');
  assert.strictEqual(run('typeof VendasAguardando'), 'object');
  assert.strictEqual(run('typeof EstornoComissao'), 'object');
  assert.strictEqual(run('typeof CommissionEngine'), 'object');
  ok('os quatro objetos existem no escopo da página');
}
{
  // 🚨 O caso que quebrou: `const` no topo do arquivo não vira propriedade de
  // window. Guardar o sintoma, para a próxima pessoa não repetir a suposição.
  assert.strictEqual(run('typeof window.PactoAdapter'), 'undefined',
    'PactoAdapter continua fora de window — é `const` no topo do arquivo');
  assert.strictEqual(run('typeof window.VendasAguardando'), 'object',
    'quem usa o wrapper UMD se registra em window normalmente');
  ok('o adapter NÃO está em window (é const) e mesmo assim é encontrado');
}
{
  // O bug de verdade: chamar `extrair` com uma linha de relatório de vendas.
  const linha = `(() => {
    const r = new Array(22).fill('');
    const d = { matricula:'1', nome:'FULANO', cadastro:'01/08/2026',
      resp1:'ERICA FAUSTINO', resp2:'ERICA FAUSTINO',
      produto:'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO | CP.',
      contrato:'7078', inicio:'06/08/2026', termino:'05/08/2027', duracao:'12',
      modalidades:'', plano:'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO | CP.',
      situacao:'Matrícula', lancamento:'06/08/2026', valor:'3.108,00', forma:'',
      condicao:'EM 12 VEZES', empresa:'CROSSTAINER UNID. CAMPECHE (CP)',
      turma:'', categoria:'', consultor:'ERICA FAUSTINO' };
    Object.keys(PactoAdapter.COL).forEach(k => r[PactoAdapter.COL[k]] = d[k] === undefined ? '' : d[k]);
    return r;
  })()`;
  const cab = `(() => { const r = new Array(22).fill('');
    r[PactoAdapter.COL.nome]='Nome Cliente'; r[PactoAdapter.COL.lancamento]='Data Lançamento';
    r[PactoAdapter.COL.consultor]='Consultor '; r[PactoAdapter.COL.resp1]='Responsável '; return r; })()`;

  const res = run(`JSON.stringify(VendasAguardando.extrair([${cab}, ${linha}]))`);
  const grupos = JSON.parse(res);
  assert.deepStrictEqual(Object.keys(grupos), ['CP|2026-08']);
  assert.strictEqual(grupos['CP|2026-08'][0].contrato, 'C7078');
  ok('VendasAguardando.extrair RODA no ambiente da página (era aqui que quebrava)');
}
{
  const r = run(`JSON.stringify(VendasAguardando.cruzar(
    [{contrato:'C7078', cliente:'X', vendedores:['ERICA FAUSTINO'], valorContrato:3108}], ['C7078']))`);
  assert.strictEqual(JSON.parse(r).aguardando.length, 0);
  ok('o cruzamento com a memória também roda na página');
}
{
  const r = run(`JSON.stringify(PactoAdapter.traduzir([${cabSimples()}], { mes:'2026-08', codigosPagos:['C1'] }))`);
  assert.ok(JSON.parse(r).jaPagos !== undefined, 'o balde novo do adapter existe na página');
  ok('o tradutor com a memória de contratos roda na página');
}
function cabSimples() {
  return `(() => { const r = new Array(22).fill('');
    r[PactoAdapter.COL.nome]='Nome Cliente'; r[PactoAdapter.COL.lancamento]='Data Lançamento'; return r; })()`;
}
{
  const r = run(`JSON.stringify(EstornoComissao.comissaoDoContrato(
    [{type:'processed',codigo:'C7078',vendedor:'ERICA FAUSTINO',cliente:'X',p1valor:12.95,p2bonus:15}],'C7078'))`);
  assert.strictEqual(JSON.parse(r).total, 27.95);
  ok('o cálculo do estorno roda na página');
}

console.log('\n' + n + '/' + n + ' casos passaram.');
