'use strict';
// Roda: node scripts/smoke-escala-data-formatada.js
//
// Pedido 8 do Rodrigo (28/08/2026): o cartão da escala imprimia `2026-11-20`
// cru. Duas partes aqui: (1) a função de formatar, testada de verdade — chamada,
// não lida; (2) uma varredura que QUEBRA se alguém voltar a interpolar data crua
// num pedaço de HTML, com lista de exceções explícita para os casos legítimos.
const assert = require('assert');
const fs = require('fs');
const SS = require('../scale-service.js');

let ok = 0;
const passou = (m) => { console.log('✓ ' + m); ok++; };

// ── fmtDataLonga (puro) ──
{
  assert.strictEqual(SS.fmtDataLonga('2026-11-20'), 'sexta-feira, 20/11/2026');
  assert.strictEqual(SS.fmtDataLonga('2026-09-05'), 'sábado, 05/09/2026');
  assert.strictEqual(SS.fmtDataLonga('2026-11-02'), 'segunda-feira, 02/11/2026');
  assert.strictEqual(SS.fmtDataLonga('2027-01-01'), 'sexta-feira, 01/01/2027', 'vira o ano sem escorregar');
  assert.strictEqual(SS.fmtDataLonga('2026-03-01'), 'domingo, 01/03/2026', 'primeiro dia do mês não volta pro anterior');
  assert.strictEqual(SS.fmtDataLonga(''), '', 'entrada vazia não quebra');
  assert.strictEqual(SS.fmtDataLonga('20/11/2026'), '20/11/2026', 'entrada fora do formato volta como veio');
  assert.strictEqual(SS.fmtDataLonga(null), '', 'null não quebra');
  passou('fmtDataLonga escreve o dia da semana e a data em português');
}

// ── varredura: data crua em HTML ──
{
  const arquivo = `${__dirname}/../professores-escala-smart.js`;
  const linhas = fs.readFileSync(arquivo, 'utf8').split('\n');

  // Interpolações de data que PODEM ser ISO cru, com o motivo:
  //  - value="${...}" de <input type="date">: o input exige ISO
  //  - argumento de onclick/função: id/chave, não texto pra humano
  //  - comparação/atribuição em JS puro (fora de template de HTML)
  // ⚠️ A exceção "linha sem HTML nenhum" já deu falso negativo uma vez: as três
  // chamadas de `profDateRow(s, `${s.date} · …`, …)` montavam o texto num
  // template literal SEM `<` na mesma linha, e só viravam HTML lá dentro — a
  // data ISO crua chegava à tela DO PROFESSOR e a varredura dizia que estava
  // tudo bem. Por isso a linha sem HTML só é legítima se também não estiver
  // entregando o texto como argumento para uma função que desenha.
  const entregaPraRender = (l) => /\b(profDateRow|escalaCardDoc|render[A-Z]\w*|\w+Html)\s*\(/.test(l);
  const legitima = (l) =>
    /value="\$\{/.test(l) ||          // input type=date
    /onclick=|onchange=/.test(l) ||   // argumento de handler
    (!/</.test(l) && !entregaPraRender(l));

  const suspeitas = linhas
    .map((l, i) => ({ n: i + 1, l }))
    .filter(x => /\$\{[^}]*\.date\}/.test(x.l) || /\$\{[^}]*\bday\}/.test(x.l))
    .filter(x => !legitima(x.l));

  assert.deepStrictEqual(suspeitas.map(x => x.n), [],
    'data crua em HTML — use ScaleService.fmtDataLonga ou escalaFmtBR:\n' +
    suspeitas.map(x => `  linha ${x.n}: ${x.l.trim().slice(0, 120)}`).join('\n'));
  passou('nenhuma data crua sobrou na tela da escala');
}

console.log(`\n${ok}/2 blocos OK`);
