'use strict';
// Guarda contra variável de CSS usada sem existir (13/08/2026).
//
// Por que existe: `.chip.chip-active` usava `background:var(--accent)` com
// `--accent` NUNCA definida. Quando o navegador não acha a variável, a
// propriedade vira inválida e cai no valor inicial — fundo transparente. Como
// a regra também fixava `color:#fff`, no tema CLARO sobrava texto branco em
// fundo branco: os chips de Unidade da Agenda Geral sumiam da tela, e o
// cabeçalho do card expandido de Pagamentos também. No tema escuro passava
// despercebido, porque texto branco em fundo escuro se lê.
//
// O bug é silencioso: não gera erro de console e nenhum teste de JS pega.
//
// Roda: node scripts/smoke-css-vars.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');

// Variáveis que o navegador resolve sozinho ou que vêm de fora do arquivo.
const IGNORAR = new Set();

/** Tira comentários /* … *\/ — comentário que CITA uma variável não é uso dela. */
function semComentarios(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function analisar(arquivo) {
  const css = semComentarios(fs.readFileSync(path.join(raiz, arquivo), 'utf8'));

  // Definições: "--nome:" (dentro de :root, html.light, etc.)
  const definidas = new Set();
  for (const m of css.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) definidas.add(m[1]);

  // Usos: "var(--nome)" ou "var(--nome, fallback)" — com fallback não quebra.
  const usadasSemFallback = new Map();  // nome → nº de ocorrências
  for (const m of css.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)\s*([,)])/g)) {
    const nome = m[1];
    const temFallback = m[2] === ',';
    if (temFallback || IGNORAR.has(nome)) continue;
    usadasSemFallback.set(nome, (usadasSemFallback.get(nome) || 0) + 1);
  }

  const orfas = [];
  for (const [nome, vezes] of usadasSemFallback) {
    if (!definidas.has(nome)) orfas.push({ nome, vezes });
  }
  return { definidas, usadas: usadasSemFallback, orfas };
}

// ════════════════ 1. professores.html não pode ter variável órfã ════════════════
{
  const r = analisar('professores.html');
  const descricao = r.orfas.map(o => `${o.nome} (${o.vezes}x)`).join(', ');
  assert.strictEqual(r.orfas.length, 0,
    `variável de CSS usada sem ser definida em professores.html: ${descricao}. ` +
    `Sem definição o navegador zera a propriedade — no tema claro isso costuma ` +
    `virar texto branco invisível.`);
  console.log(`✓ professores.html: ${r.usadas.size} variáveis usadas, todas definidas`);
}

// ════════════════ 2. --accent precisa existir nos DOIS temas ════════════════
// Não basta estar definida uma vez: se só o tema escuro tiver, o claro herda o
// valor errado. Este é o par que causou o bug.
{
  const css = fs.readFileSync(path.join(raiz, 'professores.html'), 'utf8');

  const blocoRoot = css.match(/:root\s*\{([\s\S]*?)\}/);
  const blocoLight = css.match(/html\.light\s*\{([\s\S]*?)\}/);
  assert.ok(blocoRoot, 'bloco :root não encontrado');
  assert.ok(blocoLight, 'bloco html.light não encontrado');

  ['--accent', '--orange', '--orange-glow', '--text', '--bg', '--border'].forEach(v => {
    assert.ok(blocoRoot[1].includes(`${v}:`), `${v} precisa estar no tema escuro (:root)`);
    assert.ok(blocoLight[1].includes(`${v}:`), `${v} precisa estar no tema claro (html.light)`);
  });
  console.log('✓ tokens de cor essenciais definidos nos dois temas');
}

// ════════════════ 3. chip selecionado não pode ser branco-no-branco ════════════════
// Trava específica do bug: a regra do chip ativo não pode voltar a fixar
// cor branca, que só funciona se o fundo for escuro — e o fundo é temático.
{
  const css = fs.readFileSync(path.join(raiz, 'professores.html'), 'utf8');
  const regra = css.match(/\.chip\.chip-active\s*\{([\s\S]*?)\}/g) || [];
  assert.ok(regra.length > 0, '.chip.chip-active precisa existir');

  regra.forEach(bloco => {
    assert.ok(!/color\s*:\s*#fff/i.test(bloco) && !/color\s*:\s*white/i.test(bloco),
      `chip selecionado não pode ter cor branca fixa (só se lê em fundo escuro): ${bloco.trim()}`);
  });
  console.log(`✓ chip selecionado usa cor temática em ${regra.length} regra(s), não branco fixo`);
}

console.log('\n✅ smoke-css-vars OK');
