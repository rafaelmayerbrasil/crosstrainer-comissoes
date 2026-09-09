'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Regrava `codigosPagos` dos períodos, agora contando o item DIFERIDO
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/corrigir-codigos-pagos-diferidos.js --project staging
//   node scripts/corrigir-codigos-pagos-diferidos.js --project production --aplicar
//
// SEM `--aplicar` não grava nada: mostra o que mudaria e sai.
//
// POR QUE EXISTE: `codigosDeContrato` foi corrigida em 08/09/2026 para contar o
// item `deferred` — venda PAGA cuja comissão foi empurrada para o mês em que o
// plano começa. A correção vale para o que for gravado dali em diante; o que já
// está no banco continua errado até alguém re-subir o arquivo do mês.
//
// E é a lista GRAVADA que a aba "A receber" lê. Enquanto não for regravada, a
// tela segue mandando cobrar quem já pagou.
//
// ⚠️ NÃO recalcula comissão, não cria nem apaga item, não toca em pagamento.
//    Só reescreve o campo `codigosPagos`, derivado dos itens, que são a fonte —
//    é exatamente o que o upload do mês gravaria.
//
// A lista antiga vai para `backups/` antes de qualquer escrita.
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const PROJETO = arg('--project');
const APLICAR = process.argv.includes('--aplicar');
if (!['staging', 'production'].includes(PROJETO)) {
  console.error('Uso: node scripts/corrigir-codigos-pagos-diferidos.js --project staging|production [--aplicar]');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-' + PROJETO + '.json')) });
const db = admin.firestore();

/** A MESMA função da tela, extraída do index.html — nada reescrito aqui.
 *  Reimplementar o que se quer provar concorda com o defeito em vez de denunciá-lo. */
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const ini = html.indexOf('    function codigosDeContrato(');
const fim = html.indexOf('    async function gravarCodigosPagos(');
if (ini < 0 || fim < ini) { console.error('não achei codigosDeContrato no index.html'); process.exit(1); }
const codigosDeContrato = new Function(html.slice(ini, fim) + '\n return codigosDeContrato;')();

(async () => {
  console.log('\n=== Regravar codigosPagos com os diferidos — ' + PROJETO
    + (APLICAR ? ' (GRAVANDO)' : ' (simulação, nada será gravado)') + ' ===\n');

  const periodos = await db.collection('periodos').get();
  const mudancas = [];

  for (const p of periodos.docs.sort((a, b) => a.id.localeCompare(b.id))) {
    const atual = (p.data().codigosPagos || []).map(c => String(c).toUpperCase()).sort();
    const snap = await db.collection('periodos').doc(p.id).collection('itens').get();
    const itens = []; snap.forEach(d => itens.push(d.data()));
    if (!itens.length) continue;

    const derivado = codigosDeContrato(itens);
    const entram = derivado.filter(c => !atual.includes(c));

    // ⚠️ ADITIVO, NUNCA SUBSTITUTO — e isto foi descoberto rodando a simulação
    // contra a produção em 08/09/2026. Um `set` com a lista derivada apagaria 7
    // códigos de JULHO (2 no CP, 5 no PP) que NÃO saem dos itens: foram postos
    // por script, de propósito, para segurar cobranças automáticas que voltariam
    // a pagar comissão. Trocar a lista pela derivada soltaria as sete.
    //
    // Só entra o que falta. O que já está gravado fica, e o que a derivação não
    // explica sai LISTADO abaixo, para os olhos de alguém — nunca apagado por
    // um script cuja tarefa era outra.
    const semExplicacao = atual.filter(c => !derivado.includes(c));
    const novo = [...new Set([...atual, ...derivado])].sort();
    if (!entram.length) {
      if (semExplicacao.length) {
        console.log(p.id + ': nada a acrescentar · ' + semExplicacao.length
          + ' código(s) gravado(s) que os itens não explicam (mantidos): ' + semExplicacao.join(', '));
      }
      continue;
    }

    mudancas.push({ id: p.id, atual, novo, entram, semExplicacao });
    console.log(p.id + ': ' + atual.length + ' → ' + novo.length + ' códigos');
    entram.forEach(c => {
      const it = itens.find(i => String(i.codigo || '').toUpperCase().startsWith(c)) || {};
      console.log('   + ' + c + ' · ' + (it.cliente || '?') + ' · ' + (it.type || '?')
        + (it.deferToMonth ? ' · comissão agendada para ' + it.deferToMonth : ''));
    });
    semExplicacao.forEach(c => console.log('   = ' + c + ' mantido (gravado por fora dos itens)'));
  }

  if (!mudancas.length) { console.log('Nada a mudar: as listas já estão certas.\n'); process.exit(0); }

  if (!APLICAR) {
    console.log('\n' + mudancas.length + ' período(s) mudariam. Rode de novo com --aplicar para gravar.\n');
    process.exit(0);
  }

  const dir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const arquivo = path.join(dir, 'codigosPagos-antes-' + PROJETO + '-' + new Date().toISOString().slice(0, 10) + '.json');
  fs.writeFileSync(arquivo, JSON.stringify(mudancas, null, 2));
  console.log('\nbackup da lista anterior: ' + path.relative(path.join(__dirname, '..'), arquivo));

  for (const m of mudancas) {
    await db.collection('periodos').doc(m.id).set({ codigosPagos: m.novo }, { merge: true });
    console.log('  ✅ ' + m.id + ' regravado (' + m.novo.length + ' códigos)');
  }
  console.log('\nPronto. A aba "A receber" já lê a lista nova na próxima abertura.\n');
  process.exit(0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
