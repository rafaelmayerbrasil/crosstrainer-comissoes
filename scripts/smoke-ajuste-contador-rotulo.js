'use strict';
// Roda: node scripts/smoke-ajuste-contador-rotulo.js
//
// O Rodrigo usou o botão de ajuste achando que era outra coisa (26/08/2026).
//
// No painel "Equilíbrio da janela" cada pessoa aparece como "4 nesta janela · 4
// no ano" com um ✏️ do lado. Ele leu isso como "editar esse número": queria
// baixar a Heloísa de 4 para 3, digitou 3 — e o que o campo faz é REGISTRAR
// dias trabalhados FORA do sistema. Ela foi de 4 para 4+3 = 7. O contrário.
//
// Não deu estrago porque ele clicou em Refazer logo depois, mas o dado de
// justiça ficou sujo e a próxima pessoa cairia igual.
//
// Este smoke guarda o RÓTULO e o TEXTO — que é onde o erro nasce. Não dá pra
// testar "o usuário entendeu", mas dá pra impedir que volte a ser um ✏️ mudo.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const arq = path.join(__dirname, '..', 'professores-escala-smart.js');
const src = fs.readFileSync(arq, 'utf8');

let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);

// ─── o botão no painel de equilíbrio ───
const botao = (src.match(/<button[^>]*ajustarContadorJustica[\s\S]{0,400}?<\/button>/) || [''])[0];
assert.ok(botao, 'o botão de ajuste tem que existir no painel de equilíbrio');

{
  assert.ok(!/>\s*✏️\s*<\/button>/.test(botao),
    'o botão NÃO pode ser só um lápis mudo — foi assim que o Rodrigo leu como "editar este número"');
  assert.ok(/fora/i.test(botao), 'o rótulo precisa dizer que é sobre dias FORA do sistema: ' + botao);
  ok('o botão diz o que faz, em vez de ser um lápis mudo');
}
{
  const title = (botao.match(/title="([^"]+)"/) || [])[1] || '';
  assert.ok(/n[ãa]o (muda|mexe|altera)/i.test(title),
    'o title precisa avisar que NÃO muda a escala. Está: "' + title + '"');
  ok('passar o mouse avisa que isto não mexe na escala');
}

// ─── o texto da caixa de pergunta ───
const fn = (src.match(/async function ajustarContadorJustica[\s\S]*?\n}/) || [''])[0];
assert.ok(fn, 'a função de ajuste tem que existir');

{
  assert.ok(/n[ãa]o (muda|mexe|altera)/i.test(fn),
    'a caixa precisa dizer, em texto, que isto não muda a escala de ninguém');
  ok('a caixa de pergunta avisa que não redistribui');
}
{
  assert.ok(/Refazer/i.test(fn),
    'e precisa dizer qual é o caminho certo para mudar a escala (Refazer / trocar na vaga)');
  ok('a caixa aponta o caminho certo para quem quer mudar a escala');
}
{
  // O valor é SUBSTITUÍDO, não somado — quem digita 3 fica com 3 de ajuste, não
  // com ajuste+3. Se um dia isso virar soma, o número dobra em silêncio.
  assert.ok(/saveAjustePartida\(personId,\s*novo\)/.test(fn),
    'o ajuste grava o valor digitado, não soma no que já havia');
  assert.ok(/String\(atual\)/.test(fn),
    'e a caixa vem preenchida com o valor atual, pra pessoa ver o que já existe');
  ok('o campo substitui o ajuste e mostra o valor atual');
}
{
  // Mexer no insumo do rodízio sem rastro é o tipo de coisa que ninguém
  // consegue explicar depois.
  assert.ok(/AuditService\.log/.test(fn) && /fairness_adjusted/.test(fn),
    'todo ajuste tem que ir pra auditoria');
  ok('o ajuste fica registrado na auditoria');
}

console.log('\n' + n + '/' + n + ' casos passaram.');
