'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Conferência do modo sombra com o que ESTÁ GRAVADO no banco
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/conferir-sombra-staging.js "<export faturamento-recebido>" [AAAA-MM] [--project staging]
//
// Lê `pacto_sombra_dias` do banco (o que a Cloud Function gravou de verdade),
// abre o export com o MESMO SheetJS da tela (vendor/xlsx.full.min.js, com as
// mesmas opções do `lerExport`) e roda a mesma comparação. É o número que a
// tela tem que mostrar quando o export for arrastado.
//
// Diferente de `conferir-sombra-agosto.js`: lá as linhas vinham das respostas
// salvas na pesquisa, sem caderninho de contratos; aqui vêm do banco, com o
// plano e a situação de cada contrato — então as ATIVAÇÕES valem.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const raiz = path.join(__dirname, '..');
global.window = global; global.self = global;
global.document = global.document || { createElement: () => ({}) };
const XLSX = require(path.join(raiz, 'vendor', 'xlsx.full.min.js')) || global.XLSX;
const PA = require(path.join(raiz, 'pacto-adapter.js'));
const CE = require(path.join(raiz, 'commission.js'));
const C = require(path.join(raiz, 'pacto-sombra-comparacao.js'));
const L = require(path.join(raiz, 'pacto-api-linhas.js'));

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const [exportPath, mesArg] = args;
const ALVO = (process.argv.indexOf('--project') > 0 ? process.argv[process.argv.indexOf('--project') + 1] : 'staging');
if (!exportPath) { console.error('Uso: node scripts/conferir-sombra-staging.js "<export.xls>" [AAAA-MM] [--project staging]'); process.exit(1); }
const mes = mesArg || '2026-08';

admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${ALVO}.json`))) });
const db = admin.firestore();
const brl = v => (v < 0 ? '−' : '+') + 'R$ ' + Math.abs(v).toFixed(2).replace('.', ',');

(async () => {
  // mesmas opções do lerExport da tela
  const wb = XLSX.read(new Uint8Array(fs.readFileSync(exportPath)), { type: 'array', cellDates: false });
  const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
  if (!PA.ehExportPacto(json) || PA.detectarRelatorio(json) !== 'recebido') throw new Error('não é o faturamento-recebido');

  for (const unidade of ['PP', 'CP']) {
    const snap = await db.collection('pacto_sombra_dias').where('unidade', '==', unidade).get();
    const docs = snap.docs.map(d => d.data()).filter(d => String(d.dia).slice(0, 7) === mes).sort((a, b) => a.dia.localeCompare(b.dia));
    const linhasApi = docs.flatMap(d => (d.linhas ? JSON.parse(d.linhas) : []));
    const foraApi = docs.flatMap(d => d.foraDeProposito || []);
    const avisos = docs.flatMap(d => d.avisos || []);
    const r = C.comparar({ linhasApi, linhasArquivo: json, mes, unidade, foraApi, Adapter: PA, Engine: CE, ApiLinhas: L });
    const sit = {};
    docs.forEach(d => { sit[d.situacao] = (sit[d.situacao] || 0) + 1; });

    console.log(`\n═══ ${unidade} · ${mes} · ${docs.length} dias ${JSON.stringify(sit)} ═══`);
    console.log(`recebido  API R$ ${r.api.recebido.toFixed(2)}  ·  arquivo R$ ${r.arquivo.recebido.toFixed(2)}  ·  diferença ${brl(r.diferenca)}`);
    console.log(`cliente+dia ${r.grupos} · batem ${r.batem} · divergem ${r.divergencias.length}`);
    console.log(`ativações API ${JSON.stringify(r.api.ativacoes)}`);
    console.log(`ativações arq ${JSON.stringify(r.arquivo.ativacoes)}`);
    console.log('por causa:');
    Object.entries(r.porCausa).forEach(([c, x]) => console.log(`   ${c.padEnd(40)} ${String(x.qtd).padStart(3)}  ${brl(x.valor)}`));
    const tipos = {};
    avisos.forEach(a => { tipos[a.motivo] = (tipos[a.motivo] || 0) + 1; });
    console.log('avisos:', JSON.stringify(tipos));
    if (r.compararVendedora) {
      const nomes = [...new Set([...Object.keys(r.api.porVendedora), ...Object.keys(r.arquivo.porVendedora)])].sort();
      console.log('ativações por vendedora (API × arquivo):');
      nomes.forEach(nm => console.log(`   ${nm.padEnd(28)} ${String(r.api.porVendedora[nm] || 0).padStart(5)} × ${r.arquivo.porVendedora[nm] || 0}`));
    }
  }
  process.exit(0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
