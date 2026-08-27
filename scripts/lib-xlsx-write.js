'use strict';
// Escritor mínimo de .xlsx, par do `lib-xlsx-min.js` (que só lê).
// Existe porque a tela de Comissões aceita `.xlsx,.xls` e lê com SheetJS —
// CSV não passa pelo seletor de arquivo — e não vale trazer um pacote novo só
// pra escrever uma aba de umas centenas de linhas.
//
// Grava o zip SEM compressão (método 0): dispensa deflate e o arquivo de uma
// planilha destas fica em dezenas de KB. Strings vão inline (`inlineStr`), sem
// sharedStrings — mais simples e o leitor dos dois lados entende.
//
// Teste: node scripts/smoke-xlsx-write.js

const fs = require('fs');

// ─── crc32 (tabela padrão do zip) ───
const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ─── zip (tudo armazenado, sem compressão) ───
/** @param {Array<{nome: string, dados: Buffer}>} entradas */
function zipar(entradas) {
  const pedacos = [], central = [];
  let offset = 0;

  entradas.forEach(({ nome, dados }) => {
    const nomeBuf = Buffer.from(nome, 'utf8');
    const crc = crc32(dados);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // versão necessária
    local.writeUInt16LE(0, 6);             // flags
    local.writeUInt16LE(0, 8);             // método 0 = armazenado
    local.writeUInt16LE(0, 10);            // hora
    local.writeUInt16LE(0x21, 12);         // data (1980-01-01: fixa, pra saída determinística)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26);
    local.writeUInt16LE(0, 28);
    pedacos.push(local, nomeBuf, dados);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);               // versão de quem gerou
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(dados.length, 20);
    cd.writeUInt32LE(dados.length, 24);
    cd.writeUInt16LE(nomeBuf.length, 28);
    cd.writeUInt16LE(0, 30);               // extra
    cd.writeUInt16LE(0, 32);               // comentário
    cd.writeUInt16LE(0, 34);               // disco
    cd.writeUInt16LE(0, 36);               // atributos internos
    cd.writeUInt32LE(0, 38);               // atributos externos
    cd.writeUInt32LE(offset, 42);          // onde começa o header local
    central.push(cd, nomeBuf);

    offset += local.length + nomeBuf.length + dados.length;
  });

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entradas.length, 8);
  eocd.writeUInt16LE(entradas.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...pedacos, cdBuf, eocd]);
}

// ─── xml ───
const escaparXml = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); // caractere de controle invalida o xml

/** índice 0-based → 'A', 'Z', 'AA'… */
function letraColuna(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const ehNumero = v => typeof v === 'number' && isFinite(v);

function montarAba(linhas) {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetData>',
  ];
  linhas.forEach((linha, li) => {
    const r = li + 1;
    xml.push('<row r="' + r + '">');
    (linha || []).forEach((valor, ci) => {
      if (valor === undefined || valor === null || valor === '') return;
      const ref = letraColuna(ci) + r;
      if (ehNumero(valor)) xml.push('<c r="' + ref + '"><v>' + valor + '</v></c>');
      else xml.push('<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + escaparXml(valor) + '</t></is></c>');
    });
    xml.push('</row>');
  });
  xml.push('</sheetData></worksheet>');
  return xml.join('');
}

/**
 * Escreve um .xlsx de uma aba só.
 * @param {string} caminho  arquivo de saída
 * @param {string} nomeAba
 * @param {Array<Array<string|number>>} linhas  primeira linha = cabeçalho
 */
function escreverXlsx(caminho, nomeAba, linhas) {
  const buf = (s) => Buffer.from(s, 'utf8');
  const aba = escaparXml(nomeAba).slice(0, 31);

  const entradas = [
    {
      nome: '[Content_Types].xml',
      dados: buf('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + '</Types>'),
    },
    {
      nome: '_rels/.rels',
      dados: buf('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + '</Relationships>'),
    },
    {
      // ⚠️ o leitor casa name="…" ANTES de r:id="…" — não trocar a ordem
      nome: 'xl/workbook.xml',
      dados: buf('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + '<sheets><sheet name="' + aba + '" sheetId="1" r:id="rId1"/></sheets>'
        + '</workbook>'),
    },
    {
      nome: 'xl/_rels/workbook.xml.rels',
      dados: buf('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        + '</Relationships>'),
    },
    {
      nome: 'xl/styles.xml',
      dados: buf('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
        + '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
        + '<borders count="1"><border/></borders>'
        + '<cellStyleXfs count="1"><xf/></cellStyleXfs>'
        + '<cellXfs count="1"><xf xfId="0"/></cellXfs>'
        + '</styleSheet>'),
    },
    { nome: 'xl/worksheets/sheet1.xml', dados: buf(montarAba(linhas)) },
  ];

  fs.writeFileSync(caminho, zipar(entradas));
  return caminho;
}

module.exports = { escreverXlsx, zipar, crc32 };
