'use strict';
// Roda: node scripts/smoke-aba-comercial.js
//
// Aba 💼 Comercial do Hub Pessoas (29/09/2026): as funções são recortadas de
// professores-pessoas.js (por assinatura) e CHAMADAS com banco falso.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(raiz, 'professores-pessoas.js'), 'utf8');
let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);
function recorta(ini, fim) {
  const a = js.indexOf(ini); const b = js.indexOf(fim, a + ini.length);
  assert.ok(a >= 0 && b > a, 'não achei ' + ini);
  return js.slice(a, b);
}

(async () => {
  const fonte = recorta('function mesCorrenteSP()', '// Abre o teacherModal a partir do hub');
  const gravados = [], toasts = [];
  const pessoa = { key: 'U:v1', uid: 'v1', name: 'KALI DUTRA', user: { id: 'v1', role: 'vendedor',
    jornadasComerciais: [{ desde: '2026-10', tipo: 'integral' }, { desde: '2020-01', tipo: '30h' }] } };
  const sandbox = {
    Intl, Date, console: { log() {}, error() {} },
    JornadaComercial: require(path.join(raiz, 'jornada-comercial.js')),
    escapeHtml: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    PessoasState: { people: [pessoa], activeTab: 'identidade' },
    document: { getElementById: id => ({ jcDesde: { value: '2030-01' }, jcTipo: { value: '30h' } }[id]) },
    db: { collection: () => ({ doc: id => ({ update: async obj => { gravados.push({ id, obj }); } }) }) },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
    toast: m => toasts.push(m), confirm: () => true, renderPessoasPage: async () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(fonte, sandbox);

  /* 1. a aba mostra as jornadas, qual vale, e só deixa remover do mês corrente em diante */
  {
    const html = vm.runInContext('renderPessoaTabComercial', sandbox)(pessoa);
    const t = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.ok(/10\/2026/.test(t) && /Integral/.test(t) && /01\/2020/.test(t) && /30 horas/.test(t));
    assert.ok(/outubro\/2026/.test(t) && /Comissões → Regras/.test(t));
    assert.strictEqual((html.match(/pessoaRemoverJornada\(/g) || []).length, 1, 'jornada de 2020 não se remove');
    assert.ok(/type="month" id="jcDesde"/.test(html) && /id="jcTipo"/.test(html));
    ok('aba: lista as jornadas, explica a regra, e só remove do mês corrente em diante');
  }

  /* 2. acrescentar grava a lista inteira de volta, com a entrada nova */
  {
    await vm.runInContext('pessoaAddJornada', sandbox)('U:v1');
    assert.strictEqual(gravados.length, 1);
    assert.strictEqual(JSON.stringify(gravados[0].obj.jornadasComerciais.map(j => j.desde + ' ' + j.tipo)), JSON.stringify(['2026-10 integral', '2020-01 30h', '2030-01 30h']));
    assert.strictEqual(sandbox.PessoasState.activeTab, 'comercial', 'volta para a mesma aba');
    ok('acrescentar grava a entrada nova sem apagar as antigas');
  }

  /* 3. não deixa mexer em mês que já passou, nem remover */
  {
    sandbox.document.getElementById = id => ({ jcDesde: { value: '2025-01' }, jcTipo: { value: 'integral' } }[id]);
    await vm.runInContext('pessoaAddJornada', sandbox)('U:v1');
    assert.strictEqual(gravados.length, 1, 'nada gravado');
    assert.ok(/já passou/.test(toasts[toasts.length - 1]));
    await vm.runInContext('pessoaRemoverJornada', sandbox)('U:v1', '2020-01');
    assert.strictEqual(gravados.length, 1, 'nada removido');
    await vm.runInContext('pessoaRemoverJornada', sandbox)('U:v1', '2026-10');
    assert.strictEqual(JSON.stringify(gravados[1].obj.jornadasComerciais.map(j => j.desde)), JSON.stringify(['2020-01']));
    ok('mês passado não entra nem sai; do mês corrente em diante remove');
  }

  /* 4. o script da jornada está carregado na página, antes do Hub */
  {
    const html = fs.readFileSync(path.join(raiz, 'professores.html'), 'utf8');
    const iJ = html.indexOf('jornada-comercial.js?v='), iP = html.indexOf('professores-pessoas.js?v=');
    assert.ok(iJ > 0 && iP > iJ, 'jornada-comercial.js antes de professores-pessoas.js');
    ok('professores.html carrega jornada-comercial.js antes do Hub');
  }

  console.log('\n✅ smoke-aba-comercial: ' + n);
})().catch(e => { console.error(e); process.exit(1); });
