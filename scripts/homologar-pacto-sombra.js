'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Homologação do modo sombra no STAGING — chama a busca manual e resume
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/homologar-pacto-sombra.js --de 2026-08-01 --ate 2026-09-12 [--semana 7] [--unidade PP] [--so-resumo]
//
// Chama `buscarPactoSombraManual` como um admin de verdade (token temporário
// gerado pelo Admin SDK, sem senha), em blocos de N dias — a primeira carga
// consulta cada cliente novo na Pacto, com 2 s de pausa, e um mês inteiro de
// uma vez passaria do tempo da função. Para no primeiro bloco que parar por
// credencial recusada ou limite. No fim, lista a situação de cada dia gravado.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const PROJECT = 'crosstrainer-comissoes-staging';
const REGIAO = 'us-central1';
const de = arg('--de'), ate = arg('--ate');
// 3 dias por chamada: o `fetch` do Node desiste de esperar a resposta em 300 s
// (visto em 13/09 — a semana 08→14/08 passou disso). A função no servidor
// termina mesmo assim, mas o script perde o resultado.
const bloco = Number(arg('--semana') || 3);
const soResumo = process.argv.includes('--so-resumo');
if (!soResumo && (!/^\d{4}-\d{2}-\d{2}$/.test(de || '') || !/^\d{4}-\d{2}-\d{2}$/.test(ate || ''))) {
  console.error('Uso: node scripts/homologar-pacto-sombra.js --de AAAA-MM-DD --ate AAAA-MM-DD [--semana 3] [--so-resumo]');
  process.exit(1);
}

const svc = path.join(__dirname, 'serviceAccount-staging.json');
const cfg = fs.readFileSync(path.join(__dirname, '..', 'firebase-config.js'), 'utf8');
const apiKey = (cfg.match(/apiKey:\s*['"]([^'"]+)['"][\s\S]{0,120}?crosstrainer-comissoes-staging/) || [])[1];
admin.initializeApp({ credential: admin.credential.cert(require(svc)), projectId: PROJECT });
const db = admin.firestore();

const somar = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

async function tokenAdmin() {
  const snap = await db.collection('users').get();
  const u = snap.docs.find(x => { const d = x.data(); return (d.profiles || [d.role]).includes('admin') && d.status !== 'pendente'; });
  if (!u) throw new Error('nenhum admin no staging');
  const custom = await admin.auth().createCustomToken(u.id);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('token: ' + JSON.stringify(j.error || j));
  return j.idToken;
}

async function chamar(tk, deBloco, ateBloco) {
  const t0 = Date.now();
  const r = await fetch(`https://${REGIAO}-${PROJECT}.cloudfunctions.net/buscarPactoSombraManual`, {
    method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { de: deBloco, ate: ateBloco, ...(arg('--unidade') ? { unidades: [arg('--unidade')] } : {}) } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`HTTP ${r.status} ${JSON.stringify(j.error || j).slice(0, 300)}`);
  return { ...j.result, segundos: Math.round((Date.now() - t0) / 1000) };
}

(async () => {
  if (!soResumo) {
    let tk = await tokenAdmin();
    let tokenEm = Date.now();
    for (let ini = de; ini <= ate; ini = somar(ini, bloco)) {
      const fim = somar(ini, bloco - 1) < ate ? somar(ini, bloco - 1) : ate;
      if (Date.now() - tokenEm > 40 * 60 * 1000) { tk = await tokenAdmin(); tokenEm = Date.now(); }   // token vale 1h
      process.stdout.write(`${ini} → ${fim} … `);
      const r = await chamar(tk, ini, fim);
      const cont = {};
      (r.resultados || []).forEach(x => { cont[x.situacao] = (cont[x.situacao] || 0) + 1; });
      console.log(`${r.segundos}s · ${JSON.stringify(cont)}${r.parouPor ? ' · PAROU: ' + r.parouPor : ''}`);
      if (r.parouPor) break;
    }
  }

  const snap = await db.collection('pacto_sombra_dias').get();
  const docs = snap.docs.map(d => d.data()).filter(d => !d._fixture).sort((a, b) => (a.unidade + a.dia).localeCompare(b.unidade + b.dia));
  console.log('\n=== dias gravados ===');
  for (const u of ['CP', 'PP']) {
    const lista = docs.filter(d => d.unidade === u);
    const cont = {};
    lista.forEach(d => { cont[d.situacao] = (cont[d.situacao] || 0) + 1; });
    console.log(`${u}: ${lista.length} dias ${JSON.stringify(cont)}`);
    lista.filter(d => d.situacao !== 'buscado').forEach(d =>
      console.log(`   ${d.dia} ${d.situacao}${d.motivo ? ' — ' + d.motivo : ''}${d.avisos ? ' · avisos ' + d.avisos.length : ''}`));
    const porMes = {};
    lista.forEach(d => { const m = d.dia.slice(0, 7); porMes[m] = Math.round(((porMes[m] || 0) + ((d.totais && d.totais.recebido) || 0)) * 100) / 100; });
    console.log(`   recebido por mês: ${JSON.stringify(porMes)}`);
  }
  const contratos = await db.collection('pacto_contratos').get();
  console.log(`caderninho: ${contratos.size} contratos`);
  process.exit(0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
