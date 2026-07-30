'use strict';
// Leitor mínimo de .xlsx (zip + SpreadsheetML) sem dependência externa.
// Existe porque vendor/xlsx.full.min.js é browser-only e quebra no Node,
// e não vale trazer um pacote novo só pra ler 3 abas de uma planilha de carga.
// Cobre o que a carga precisa: sharedStrings, nomes das abas, células de texto/número.

const fs = require('fs');
const zlib = require('zlib');

// ─── zip ────────────────────────────────────────────────────────────────
/** Descompacta um .zip em memória → Map<nomeArquivo, Buffer>. */
function unzip(buf) {
  const out = new Map();
  // acha o End Of Central Directory (assinatura 0x06054b50), varrendo do fim
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip inválido: EOCD não encontrado');

  const totalEntries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // offset do central directory

  for (let n = 0; n < totalEntries; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip inválido: entrada do CD em ' + p);
    const method     = buf.readUInt16LE(p + 10);
    const compSize   = buf.readUInt32LE(p + 20);
    const nameLen    = buf.readUInt16LE(p + 28);
    const extraLen   = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff   = buf.readUInt32LE(p + 42);
    const name       = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // cabeçalho local: 30 bytes fixos + nome + extra (o extra local pode diferir do central)
    if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('zip inválido: header local de ' + name);
    const lNameLen  = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);

    out.set(name, method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ─── xml ────────────────────────────────────────────────────────────────
const unescapeXml = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&amp;/g, '&'); // por último, senão desfaz os anteriores

/** Coluna 'BC12' → índice 0-based (28). */
function colIndex(ref) {
  let n = 0;
  for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Lê um .xlsx.
 * @returns { sheetNames: string[], sheet(nome) → { [numeroDaLinha]: célula[] } }
 */
function readXlsx(filePath) {
  const files = unzip(fs.readFileSync(filePath));
  const txt = name => {
    const b = files.get(name);
    if (!b) throw new Error('parte ausente no xlsx: ' + name);
    return b.toString('utf8');
  };

  // sharedStrings: cada <si> pode ter vários <t> (rich text) — concatena
  const shared = [];
  if (files.has('xl/sharedStrings.xml')) {
    for (const si of txt('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      let s = '';
      for (const t of si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += t[1];
      shared.push(unescapeXml(s));
    }
  }

  // abas: nome → arquivo (via rels)
  const rels = {};
  for (const m of txt('xl/_rels/workbook.xml.rels').matchAll(/Id="(rId\d+)"[^>]*Target="([^"]*)"/g)) {
    rels[m[1]] = m[2].replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  const sheets = [];
  for (const m of txt('xl/workbook.xml').matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="(rId\d+)"/g)) {
    sheets.push({ name: unescapeXml(m[1]), file: rels[m[2]] });
  }

  function sheet(name) {
    const meta = sheets.find(s => s.name === name);
    if (!meta) throw new Error(`aba "${name}" não existe (existem: ${sheets.map(s => s.name).join(', ')})`);
    const xml = txt('xl/' + meta.file);
    const rows = {};
    for (const rm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const cm of rm[2].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[2] || '', inner = cm[3] || '';
        const type = (attrs.match(/t="([^"]*)"/) || [])[1];
        let v = '';
        if (type === 's') {
          v = shared[Number((inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1])] ?? '';
        } else if (type === 'inlineStr') {
          v = unescapeXml([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
        } else {
          const raw = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          v = raw === undefined ? '' : unescapeXml(raw);
        }
        cells[colIndex(cm[1])] = v;
      }
      rows[Number(rm[1])] = cells;
    }
    return rows;
  }

  return { sheetNames: sheets.map(s => s.name), sheet };
}

module.exports = { readXlsx, unzip };
