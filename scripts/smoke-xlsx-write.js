'use strict';
// Roda: node scripts/smoke-xlsx-write.js
//
// `lib-xlsx-min.js` só LÊ planilha. O tradutor da Pacto precisa ESCREVER, porque
// a tela de Comissões aceita `.xlsx,.xls` e lê com SheetJS — CSV não serve.
// `lib-xlsx-write.js` é o escritor mínimo (zip sem compressão + inline strings).
//
// O teste é ida-e-volta: escreve e lê de volta com o leitor que já existe. Se as
// duas pontas concordarem, o arquivo é um xlsx de verdade — e não uma coisa que
// só o meu próprio código entende.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { escreverXlsx } = require(path.join(__dirname, 'lib-xlsx-write.js'));
const { readXlsx } = require(path.join(__dirname, 'lib-xlsx-min.js'));

const tmp = path.join(os.tmpdir(), 'smoke-xlsx-write-' + process.pid + '.xlsx');
let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);

try {
  const linhas = [
    ['Código', 'Cliente', 'Valor Quitado/Recibo', 'Itens'],
    ['C7078', 'ANA PAULA', 259, 'HIIT/MAROMBINHA | ANUAL | LOCAL (03/08/2026 - 02/08/2027)'],
    ['C6735-2', 'JOÃO "ZÉ" & CIA <LTDA>', 1234.56, 'PLANO IMPORTADO | ANUAL | LOCAL [PLANO PRESUMIDO]'],
    ['A99', 'MARIA', 0, 'ÁGUA SEM GÁS'],
  ];
  escreverXlsx(tmp, 'Vendas', linhas);

  const wb = readXlsx(tmp);
  assert.deepStrictEqual(wb.sheetNames, ['Vendas'], 'nome da aba');
  ok('escreve e o leitor reconhece a aba');

  const sh = wb.sheet('Vendas');
  const ks = Object.keys(sh).map(Number).sort((a, b) => a - b);
  assert.deepStrictEqual(ks, [1, 2, 3, 4], 'quatro linhas, numeradas de 1');
  assert.deepStrictEqual(sh[1], linhas[0], 'cabeçalho volta igual');
  ok('todas as linhas voltam, na ordem');

  assert.strictEqual(sh[2][1], 'ANA PAULA');
  assert.strictEqual(Number(sh[2][2]), 259, 'número volta como número');
  assert.strictEqual(Number(sh[3][2]), 1234.56, 'decimal não se perde');
  assert.strictEqual(Number(sh[4][2]), 0, 'zero é zero, não vazio');
  ok('valores numéricos sobrevivem à ida e volta');

  assert.strictEqual(sh[3][1], 'JOÃO "ZÉ" & CIA <LTDA>', 'aspas, & e <> escapados certo');
  assert.strictEqual(sh[2][3], linhas[1][3], 'acento e parênteses do Itens intactos');
  assert.strictEqual(sh[4][3], 'ÁGUA SEM GÁS');
  ok('texto com acento e caractere de XML volta idêntico');

  console.log('\n' + n + '/' + n + ' casos passaram.');
} finally {
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
}
