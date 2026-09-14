'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Varre as coleções do modo sombra procurando dado pessoal que não deveria estar lá
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/varrer-cpf-sombra.js --project staging|production
//
// Só leitura. Procura, em `pacto_sombra_dias` e `pacto_contratos`:
//  • chaves proibidas (cpf, dataNascimento, telefone, email, rg...);
//  • valores com cara de CPF (000.000.000-00 ou 11 dígitos seguidos).
// Imprime só a localização (coleção/doc/campo), nunca o valor achado.
// Sai com código 1 se achar qualquer coisa.

const path = require('path');
const admin = require('firebase-admin');

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const ALVO = arg('--project');
if (!['staging', 'production'].includes(ALVO)) { console.error('Uso: --project staging|production'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${ALVO}.json`))) });
const db = admin.firestore();

const CHAVES = /^(cpf|cpfResponsavel|dataNascimento|matriculaSesc|telefone|telCelular|telResidencial|email|rg)$/i;
const CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|(?<!\d)\d{11}(?!\d)/;

function varrer(obj, caminho, achados) {
  if (Array.isArray(obj)) return obj.forEach((v, i) => varrer(v, caminho + '[' + i + ']', achados));
  if (obj && typeof obj === 'object') {
    return Object.entries(obj).forEach(([k, v]) => {
      if (CHAVES.test(k)) achados.push(caminho + '.' + k + ' (chave proibida)');
      varrer(v, caminho + '.' + k, achados);
    });
  }
  if (typeof obj === 'string') {
    if (CPF.test(obj)) achados.push(caminho + ' (valor com cara de CPF)');
    // `linhas` é JSON gravado como texto: abrir e varrer por dentro
    if (/^\[\[/.test(obj)) { try { varrer(JSON.parse(obj), caminho + '<json>', achados); } catch (e) { /* não era JSON */ } }
  }
}

(async () => {
  let docs = 0;
  const achados = [];
  for (const col of ['pacto_sombra_dias', 'pacto_contratos']) {
    const snap = await db.collection(col).get();
    snap.forEach(d => { docs++; varrer(d.data(), col + '/' + d.id, achados); });
  }
  console.log(`${docs} documentos varridos em ${ALVO}`);
  if (achados.length) {
    console.log(`✗ ${achados.length} achado(s):`);
    achados.slice(0, 50).forEach(a => console.log('   ' + a));
    process.exit(1);
  }
  console.log('✓ nenhum CPF, nascimento, telefone ou e-mail');
  process.exit(0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
