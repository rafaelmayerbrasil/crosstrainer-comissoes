'use strict';
// ═══════════════════════════════════════════════════════════════════
// Confere, item a item, o que o APP gravou contra o que o motor produz
// aqui a partir do MESMO arquivo
// ═══════════════════════════════════════════════════════════════════
//
//   node scripts/conferir-upload-gravado.js [--project staging|production]
//
// SOMENTE LEITURA. Nao escreve nada, em nenhum ambiente.
//
// Serve para responder "os dados que subiram estao certos?" com o dado, e nao
// com a impressao da tela. Foi o que fechou, em 01/09/2026, a "diferenca
// sistematica de uns reais, sempre para menos no app" que estava registrada
// como NAO EXPLICADA desde a migracao:
//
//   sao vendas de BAR repetidas — mesmo cliente generico ("PASSANTE",
//   "CLIENTE EXTERNO"), mesmo dia, mesmo valor. O `generateStableId` do
//   index.html e o hash de vendedor|cliente|data|item|valor e NAO usa o
//   `Codigo`, entao tres aguas de R$ 5 vendidas no mesmo dia colidem no mesmo
//   id e viram UMA no banco. Em agosto/2026: 7 linhas no CP e 10 no PP,
//   R$ 6,31 de comissao a menos no mes.
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-production.json')) });
const db = admin.firestore();
const path = require('path');
const { readXlsx } = require('./lib-xlsx-min.js');
const PA = require('../pacto-adapter.js');
const CE = require('../commission.js');
const brl = n => 'R$ ' + Number(n||0).toFixed(2);

const ARQ = path.join(__dirname, '..', 'relatorios pacto',
  'faturamento-recebido_6d85c17be56a3354e9142649a1c0a830_20260901_213346.xls');

(async () => {
  const wb = readXlsx(ARQ);
  const aba = wb.sheet(wb.sheetNames[0]);
  const linhas = Object.keys(aba).map(Number).sort((a,b)=>a-b).map(k => aba[k]);
  const r = PA.traduzir(linhas, { mes: '2026-08' });

  for (const [sigla, pid] of [['CP','cp_2026-08'], ['PP','pp_2026-08']]) {
    const vendas = (r.porUnidade[sigla]||[]).map(v => { const o={}; PA.CABECALHO_SAIDA.forEach(h=>o[h]=v[h]); return o; });
    const meu = CE.calculate(vendas, CE.defaultConfig, {});
    const snap = await db.collection('periodos').doc(pid).collection('itens').get();
    const app = []; snap.forEach(s => { const d = s.data(); if ((d.type||'processed')==='processed') app.push(d); });

    const chave = i => [String(i.cliente||'').trim().toUpperCase(), String(i.data||'').replace(/\//g,''), Number(i.valorCaixa||0).toFixed(2)].join('|');
    const mapApp = new Map(); app.forEach(i => { const k=chave(i); mapApp.set(k, (mapApp.get(k)||[]).concat([i])); });

    let dif = 0; const linhasDif = [];
    meu.processed.forEach(i => {
      const cand = mapApp.get(chave(i)) || [];
      const a = cand.shift();
      if (!a) { linhasDif.push(['SO NO MEU', i.cliente, i.item, i.valorCaixa, (i.p1valor||0)+(i.p2bonus||0)]); dif += (i.p1valor||0)+(i.p2bonus||0); return; }
      const meuT = (i.p1valor||0)+(i.p2bonus||0), appT = (a.p1valor||0)+(a.p2bonus||0);
      if (Math.abs(meuT-appT) > 0.005) { linhasDif.push(['DIFERE', i.cliente, String(i.item).slice(0,40), i.valorCaixa, meuT.toFixed(2)+' x '+appT.toFixed(2)]); dif += meuT-appT; }
    });
    console.log(`\n### ${sigla} — meu ${meu.processed.length} linhas x app ${app.length} · divergencias: ${linhasDif.length} · soma ${brl(dif)}`);
    linhasDif.slice(0,15).forEach(l => console.log('   ', l.join(' | ')));
  }
  process.exit(0);
})().catch(e => { console.error('ERRO', e.message, e.stack); process.exit(1); });
