'use strict';
// Publica o SITE (hospedagem do Firebase) a partir de uma cópia limpa do commit.
//
//   node scripts/publicar-site.js                                  → ensaio no staging (não publica)
//   node scripts/publicar-site.js --apply                          → publica no staging
//   node scripts/publicar-site.js --project production --apply     → publica em produção
//
// Por que existe: `firebase.json` tem `"public": "."` — o `firebase deploy` sobe a
// pasta do DISCO, e a pasta de trabalho tem `backups/`, `scratchpad/` e relatórios
// com dado real de produção. O `.gitignore` não protege a hospedagem. Aqui o que
// sobe é `git archive HEAD`: só o que está gravado no commit.
//
// Produção só sai do `main`, sem alteração pendente e igual ao `origin/main`
// (o GitHub Pages ainda serve o endereço antigo — os dois têm que estar iguais).
// Regras e Functions NÃO passam por aqui: seguem em `firebase deploy --only ...`.
//
// Teste: scripts/smoke-publicar-site.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SITES = {
  staging: ['https://crosstrainer-comissoes-staging.web.app'],
  production: ['https://crosstrainer-comissoes.web.app'],
};
const OBRIGATORIOS = ['index.html', 'professores.html', 'firebase-config.js', 'firebase.json'];
const PROIBIDOS = [
  [/^backups\//i, 'backups/'],
  [/^scratchpad\//i, 'scratchpad/'],
  [/^relatorios pacto\//i, 'relatorios pacto/'],
  [/(^|\/)serviceAccount[^/]*\.json$/i, 'serviceAccount*.json'],
  [/credencial/i, 'arquivo de credencial'],
  [/(^|\/)\.env(\.|$)/i, '.env'],
];
const CONFERIR_NO_AR = ['firebase-config.js', 'index.html', 'professores.html'];

// Pura: pode publicar este estado do repositório neste projeto?
function podePublicar({ projeto, branch, sujo, igualOrigin }) {
  if (!SITES[projeto]) return { ok: false, motivo: `Projeto desconhecido: "${projeto}". Use staging ou production.` };
  if (sujo) return { ok: false, motivo: 'Há alteração não gravada em arquivo do repositório. O que vai ao ar é o commit, não o disco — grave ou desfaça antes.' };
  if (projeto === 'production') {
    if (branch !== 'main') return { ok: false, motivo: `Produção só sai do main (você está em "${branch}").` };
    if (!igualOrigin) return { ok: false, motivo: 'O main local está diferente do origin/main. Envie ou atualize antes: os dois endereços têm que servir a mesma versão.' };
  }
  return { ok: true, motivo: '' };
}

// Pura: a lista de arquivos que vai ao ar está completa e sem nada sensível?
function conferirPasta(arquivos) {
  const lista = arquivos.map(f => f.replace(/\\/g, '/'));
  const problemas = [];
  OBRIGATORIOS.filter(f => !lista.includes(f)).forEach(f => problemas.push(`falta ${f}`));
  PROIBIDOS.forEach(([re, nome]) => {
    const achados = lista.filter(f => re.test(f));
    if (achados.length) problemas.push(`${nome} não pode ir ao ar (${achados.slice(0, 3).join(', ')}${achados.length > 3 ? '…' : ''})`);
  });
  return { ok: problemas.length === 0, problemas };
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
}

function listarArquivos(dir, base = '') {
  return fs.readdirSync(path.join(dir, base), { withFileTypes: true }).flatMap(e => {
    const rel = base ? base + '/' + e.name : e.name;
    return e.isDirectory() ? listarArquivos(dir, rel) : [rel];
  });
}

const semFimDeLinha = s => s.replace(/\r\n/g, '\n');

async function conferirNoAr(sites, pasta) {
  let ok = true;
  for (const site of sites) {
    for (const f of CONFERIR_NO_AR) {
      const local = semFimDeLinha(fs.readFileSync(path.join(pasta, f), 'utf8'));
      const r = await fetch(`${site}/${f}?t=${Date.now()}`, { cache: 'no-store' });
      const noAr = semFimDeLinha(await r.text());
      const igual = r.ok && noAr === local;
      if (!igual) ok = false;
      console.log(`  ${igual ? '✓' : '✗'} ${site}/${f}${igual ? '' : '  ← DIFERENTE do commit'}`);
    }
  }
  return ok;
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--project');
  const projeto = i >= 0 ? args[i + 1] : 'staging';
  const aplicar = args.includes('--apply');
  const raiz = path.join(__dirname, '..');

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], raiz);
  const commit = git(['rev-parse', '--short', 'HEAD'], raiz);
  // só arquivos rastreados: o que não está no git não vai ao ar de qualquer jeito
  const sujo = git(['status', '--porcelain', '--untracked-files=no'], raiz) !== '';
  let igualOrigin = false;
  if (projeto === 'production') {
    git(['fetch', 'origin', 'main', '--quiet'], raiz);
    igualOrigin = git(['rev-parse', 'HEAD'], raiz) === git(['rev-parse', 'origin/main'], raiz);
  }

  console.log(`Projeto: ${projeto} · branch: ${branch} · commit: ${commit}`);
  const pode = podePublicar({ projeto, branch, sujo, igualOrigin });
  if (!pode.ok) { console.error('✗ ' + pode.motivo); process.exit(1); }

  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-site-'));
  try {
    // nomes relativos, com cwd na pasta-mãe: o tar do Git Bash lê "C:\..." como host remoto
    const mae = path.dirname(pasta);
    const tar = path.basename(pasta) + '.tar';
    git(['archive', '--format=tar', '-o', path.join(mae, tar), 'HEAD'], raiz);
    execFileSync('tar', ['-xf', tar, '-C', path.basename(pasta)], { cwd: mae, stdio: 'inherit' });
    fs.rmSync(path.join(mae, tar), { force: true });

    const arquivos = listarArquivos(pasta);
    const conf = conferirPasta(arquivos);
    if (!conf.ok) { console.error('✗ A cópia não pode ir ao ar:\n  - ' + conf.problemas.join('\n  - ')); process.exit(1); }
    console.log(`Cópia limpa do commit: ${arquivos.length} arquivos (o firebase.json ainda tira scripts, functions e .md).`);

    if (!aplicar) { console.log('\nEnsaio: nada foi publicado. Para publicar, repita com --apply.'); return; }

    const r = spawnSync('firebase', ['deploy', '--only', 'hosting', '--project', projeto], { cwd: pasta, stdio: 'inherit', shell: true });
    if (r.status !== 0) { console.error('✗ O firebase deploy falhou.'); process.exit(r.status || 1); }

    console.log('\nConferindo o que está no ar contra o commit:');
    const igual = await conferirNoAr(SITES[projeto], pasta);
    if (!igual) { console.error('✗ O que está no ar não bate com o commit.'); process.exit(1); }
    console.log(`\n✓ Site publicado em ${projeto}, commit ${commit}.`);
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

module.exports = { podePublicar, conferirPasta };

if (require.main === module) main().catch(e => { console.error('✗ ' + e.message); process.exit(1); });
