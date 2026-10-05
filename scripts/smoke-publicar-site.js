'use strict';
// Roda: node scripts/smoke-publicar-site.js
//
// A hospedagem do Firebase publica a PASTA DO DISCO (`public: "."`), e a pasta de
// trabalho tem backups e rascunhos com dado real de produção. `publicar-site.js`
// publica de uma cópia limpa do commit; este smoke guarda as duas travas dele.

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const { podePublicar, conferirPasta } = require('./publicar-site.js');

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

// 1. Produção: só do main, limpo e igual ao GitHub
{
  const base = { projeto: 'production', branch: 'main', sujo: false, igualOrigin: true };
  assert.strictEqual(podePublicar(base).ok, true);
  assert.strictEqual(podePublicar({ ...base, branch: 'endereco-sistema' }).ok, false);
  assert.strictEqual(podePublicar({ ...base, igualOrigin: false }).ok, false);
  assert.strictEqual(podePublicar({ ...base, sujo: true }).ok, false);
  [{ ...base, branch: 'x' }, { ...base, igualOrigin: false }, { ...base, sujo: true }]
    .forEach(c => assert.ok(podePublicar(c).motivo.length > 10, 'a recusa explica o motivo'));
  ok('produção só sai do main, sem alteração pendente e igual ao origin/main');
}

// 2. Staging: qualquer branch, mas o que sai é o commit
{
  const base = { projeto: 'staging', branch: 'endereco-sistema', sujo: false, igualOrigin: false };
  assert.strictEqual(podePublicar(base).ok, true);
  assert.strictEqual(podePublicar({ ...base, sujo: true }).ok, false);
  assert.strictEqual(podePublicar({ ...base, projeto: 'outro' }).ok, false);
  ok('staging aceita qualquer branch, recusa alteração não gravada e projeto desconhecido');
}

// 3. A pasta que vai ao ar
{
  const raiz = path.join(__dirname, '..');
  const reais = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n').filter(Boolean);
  const r = conferirPasta(reais);
  assert.strictEqual(r.ok, true, 'os arquivos do repositório deveriam passar: ' + r.problemas.join(' | '));

  const recusa = lista => { const x = conferirPasta(lista); assert.strictEqual(x.ok, false); return x.problemas.join(' | '); };
  assert.ok(/backups/.test(recusa([...reais, 'backups/cp_2026-09.json'])));
  assert.ok(/scratchpad/.test(recusa([...reais, 'scratchpad/diag.js'])));
  assert.ok(/serviceAccount/.test(recusa([...reais, 'serviceAccount-production.json'])));
  assert.ok(/credencial/.test(recusa([...reais, 'pacto-credencial-cp.txt'])));
  assert.ok(/relatorios pacto/.test(recusa([...reais, 'relatorios pacto/setembro.xls'])));
  assert.ok(/\.env/.test(recusa([...reais, 'functions/.env.production'])));
  assert.ok(/index\.html/.test(recusa(reais.filter(f => f !== 'index.html'))));
  assert.ok(/firebase\.json/.test(recusa(reais.filter(f => f !== 'firebase.json'))));
  ok(`os ${reais.length} arquivos do repositório passam; backup, rascunho, credencial ou falta de página barram`);
}

console.log(`\n${n} verificações ✓`);
