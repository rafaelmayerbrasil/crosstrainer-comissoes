'use strict';
// ═══════════════════════════════════════════════════════════════════
// Homologa a regra "cada contrato paga comissão uma vez só" no STAGING
// ═══════════════════════════════════════════════════════════════════
//
//   node scripts/homologar-codigos-pagos.js
//
// ⚠️ ESCREVE no Firestore de staging — só o campo `codigosPagos` dos períodos,
//    que é exatamente o que o upload gravaria. Nunca aponte para produção.
//
// As funções testadas são EXTRAÍDAS do `index.html`, não reescritas aqui: um
// teste que reimplementa o que quer provar não prova nada. É a lição da prévia
// da escala, que passou por 12 testes verdes sem nunca ter rodado.
//
// O que cobre: reconstrução a partir dos itens · idempotência · o recorte por
// mês (que é o que deixa re-subir o mesmo mês) · isolamento entre unidades ·
// e o arquivo real, subido de novo e depois como se fosse o mês seguinte.
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-staging.json')) });
const db = admin.firestore();
const PA = require('../pacto-adapter.js');
const { readXlsx } = require('./lib-xlsx-min.js');

// ─── as funções da tela, extraídas do index.html (nada reescrito à mão) ───
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
// ⚠️ Âncora na ASSINATURA, não no comentário: ancorar no JSDoc quebrou este
// script em 08/09/2026, quando o texto foi reescrito e o código não mudou.
const ini = html.indexOf('    function codigosDeContrato(');
const fim = html.indexOf('    function handleFile(file) {');
if (ini < 0 || fim < ini) { console.error('bloco não encontrado no index.html'); process.exit(1); }
const tela = new Function('db', 'window', 'console', html.slice(ini, fim) +
  '\n return { codigosDeContrato, gravarCodigosPagos, reconstruirCodigosPagos, carregarCodigosPagosAnteriores };'
)(db, {}, console);

const ARQ = '../relatorios pacto/faturamento-recebido_6d85c17be56a3354e9142649a1c0a830_20260901_213346.xls';
const brl = n => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
let passos = 0, falhas = 0;
const ok = (m) => { passos++; console.log('  ✅ ' + m); };
const nok = (m) => { falhas++; console.log('  ❌ ' + m); };

(async () => {
  console.log('\n═══ 1. Estado antes ═══');
  for (const pid of ['unit-cp_2026-08', 'unit-pp_2026-08']) {
    const d = await db.collection('periodos').doc(pid).get();
    const itens = await db.collection('periodos').doc(pid).collection('itens').get();
    console.log(`  ${pid}: ${itens.size} itens · codigosPagos ${d.data().codigosPagos ? d.data().codigosPagos.length : '(ausente)'}`);
  }

  console.log('\n═══ 2. Reconstruir a lista a partir dos itens reais ═══');
  const antes = {};
  for (const pid of ['unit-cp_2026-08', 'unit-pp_2026-08']) {
    const cods = await tela.reconstruirCodigosPagos(pid);
    antes[pid] = cods;
    const doc = await db.collection('periodos').doc(pid).get();
    const gravado = doc.data().codigosPagos || [];
    if (JSON.stringify(gravado) === JSON.stringify(cods) && cods.length) ok(`${pid}: ${cods.length} contratos gravados e conferidos`);
    else nok(`${pid}: gravou ${gravado.length}, esperava ${cods.length}`);
    if (cods.some(c => !/^C\d+$/.test(c))) nok(`${pid}: código fora do formato C<num> — ${cods.filter(c=>!/^C\d+$/.test(c))[0]}`);
  }

  console.log('\n═══ 3. Idempotência — reconstruir de novo dá o mesmo ═══');
  for (const pid of ['unit-cp_2026-08', 'unit-pp_2026-08']) {
    const de_novo = await tela.reconstruirCodigosPagos(pid);
    if (JSON.stringify(de_novo) === JSON.stringify(antes[pid])) ok(`${pid}: mesma lista na 2ª vez`);
    else nok(`${pid}: divergiu ao refazer`);
  }

  console.log('\n═══ 4. O recorte por mês ═══');
  const paraSet = await tela.carregarCodigosPagosAnteriores('unit-cp', '2026-09');
  const paraAgo = await tela.carregarCodigosPagosAnteriores('unit-cp', '2026-08');
  // ⚠️ O que importa é a RELAÇÃO entre as listas, não o tamanho delas. Contar
  // assumia um staging onde só existe agosto — e como julho tem códigos lá, o
  // script reprovava um comportamento correto (agosto DEVE enxergar julho).
  // Gritar lobo é pior que não avisar: ensina a ignorar o vermelho.
  const deAgosto = new Set(antes['unit-cp_2026-08']);
  const faltouEmSet = [...deAgosto].filter(c => !paraSet.includes(c));
  if (!faltouEmSet.length) ok(`setembro enxerga os ${deAgosto.size} contratos de agosto (e mais ${paraSet.length - deAgosto.size} de meses anteriores)`);
  else nok(`setembro não viu ${faltouEmSet.length} contrato(s) de agosto: ${faltouEmSet.slice(0, 5).join(', ')}`);

  const proprios = paraAgo.filter(c => deAgosto.has(c));
  if (!proprios.length) ok(`agosto NÃO enxerga os próprios códigos (re-upload seguro) — só os ${paraAgo.length} de meses anteriores`);
  else nok(`agosto viu ${proprios.length} códigos dele mesmo — re-upload barraria as próprias linhas`);
  const pp = await tela.carregarCodigosPagosAnteriores('unit-pp', '2026-09');
  const cruzou = pp.filter(c => paraSet.includes(c));
  if (!cruzou.length) ok('uma unidade não enxerga os contratos da outra');
  else nok(`${cruzou.length} códigos vazaram entre unidades`);

  console.log('\n═══ 5. O arquivo real de agosto, subido de novo (mesmo mês) ═══');
  const wb = readXlsx(path.join(__dirname, ARQ));
  const aba = wb.sheet(wb.sheetNames[0]);
  const linhas = Object.keys(aba).map(Number).sort((a, b) => a - b).map(k => aba[k]);
  const rAgo = PA.traduzir(linhas, { mes: '2026-08', codigosPagos: paraAgo });
  const somaCP = (rAgo.porUnidade['CP'] || []).reduce((s, v) => s + (v['Valor Quitado/Recibo'] || 0), 0);
  // Barrar contrato que pagou em JULHO está certo — é a regra funcionando. O
  // que não pode acontecer é agosto barrar linha por causa de um código que ele
  // mesmo gravou: aí re-subir o arquivo zeraria o próprio mês.
  const barradasDeAgosto = (rAgo.jaPagos || []).filter(j => deAgosto.has('C' + j.contrato));
  if (!barradasDeAgosto.length) ok(`re-upload de agosto: nenhuma linha barrada por código do próprio mês · ${(rAgo.jaPagos || []).length} barrada(s) por meses anteriores · CP segue com ${(rAgo.porUnidade['CP']||[]).length} linhas, ${brl(somaCP)}`);
  else nok(`re-upload de agosto barrou ${barradasDeAgosto.length} linha(s) com código do próprio mês`);

  console.log('\n═══ 6. O mesmo arquivo como se fosse setembro ═══');
  // Empurra as datas de lançamento para setembro: simula as parcelas voltando.
  const comoSetembro = linhas.map((l, i) => {
    if (i === 0) return l;
    const c = l.slice();
    c[PA.COL.lancamento] = String(c[PA.COL.lancamento]).replace(/^(\d{2})\/08\//, '$1/09/');
    return c;
  });
  const semMemoria = PA.traduzir(comoSetembro, { mes: '2026-09' });
  const comMemoria = PA.traduzir(comoSetembro, { mes: '2026-09', codigosPagos: [...paraSet, ...pp] });
  const barradas = (comMemoria.jaPagos || []).length;
  console.log(`  sem a memória: ${semMemoria.vendas.length} vendas · com a memória: ${comMemoria.vendas.length} vendas · barradas: ${barradas}`);
  if (barradas > 0 && comMemoria.vendas.length < semMemoria.vendas.length) ok(`a memória barra ${barradas} parcelas que pagariam de novo`);
  else nok('a memória não barrou nada — a ligação com o banco não está valendo');
  if ((comMemoria.jaPagos || []).every(j => j.motivo && j.contrato)) ok('cada linha barrada traz contrato e motivo (nada some calado)');
  else nok('linha barrada sem motivo');

  console.log(`\n${passos} verificações passaram, ${falhas} falharam.`);
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('\nERRO:', e.message, '\n', e.stack); process.exit(1); });
