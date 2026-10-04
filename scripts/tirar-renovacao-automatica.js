'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Tira de um mês JÁ CALCULADO as renovações automáticas do plano recorrente
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/tirar-renovacao-automatica.js --project staging|production --mes 2026-09
//        --arquivo "relatorios pacto/faturamento-recebido_01 a 300926.xls" [--apply]
//
// Decisão do Rafael (04/10/2026): o contrato que o robô da Pacto lança todo mês para
// o plano recorrente não é venda, de setembro/2026 em diante. O tradutor já não deixa
// essas linhas entrarem (`PactoAdapter.ehRenovacaoAutomatica`); este script acerta o
// mês que foi calculado ANTES da regra, sem reenviar o arquivo inteiro:
//
//   1. descobre os contratos pela REGRA (o export do mês passado pelo tradutor) e
//      exige que a API diga o mesmo (`pacto_contratos.lancou = RECORRENCIA`);
//   2. apaga só os lançamentos desses contratos (é o que o envio do arquivo faria:
//      "apaga o que saiu da fonte"), com cópia em backups/;
//   3. recalcula o mês pela MESMA conta da tela e do servidor (`comissoes-mes.js`),
//      regrava os contratos já comissionados e registra no histórico e no audit_log.
//
// Sem --apply não grava nada: só mostra o que faria e o resultado previsto.
// Para se o mês já tiver pagamento registrado. Imprime contratos e VENDEDORAS, nunca alunos.

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const admin = require(path.join(RAIZ, 'functions', 'node_modules', 'firebase-admin'));
const { readXlsx } = require(path.join(__dirname, 'lib-xlsx-min.js'));
const PA = require(path.join(RAIZ, 'pacto-adapter.js'));
const CE = require(path.join(RAIZ, 'commission.js'));
const CM = require(path.join(RAIZ, 'comissoes-mes.js'));
const JC = require(path.join(RAIZ, 'jornada-comercial.js'));
const MS = require(path.join(RAIZ, 'metas-sugeridas.js'));

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const projeto = arg('--project');
const MES = arg('--mes');
const ARQUIVO = arg('--arquivo');
const APPLY = process.argv.includes('--apply');
if (!['staging', 'production'].includes(projeto) || !/^\d{4}-\d{2}$/.test(MES || '') || !ARQUIVO) {
  console.error('uso: node scripts/tirar-renovacao-automatica.js --project staging|production --mes AAAA-MM --arquivo "<faturamento-recebido>.xls" [--apply]');
  process.exit(1);
}
if (MES < PA.INICIO_RENOVACAO_AUTOMATICA) { console.error('A regra só vale de ' + PA.INICIO_RENOVACAO_AUTOMATICA + ' em diante.'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))) });
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;
const AUTOR = { uid: 'sistema', email: 'sistema', name: 'Sistema (renovação automática fora da comissão)' };
const brl = v => 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');
const total = v => (Number(v.p1) || 0) + (Number(v.p2) || 0) + (Number(v.p3) || 0) + (Number(v.p4i) || 0) + (Number(v.p4p) || 0);

(async () => {
  // 1. os contratos, pela regra, a partir do arquivo oficial do mês
  const wb = readXlsx(path.isAbsolute(ARQUIVO) ? ARQUIVO : path.join(RAIZ, ARQUIVO));
  const aba = wb.sheet(wb.sheetNames[0]);
  const linhas = Object.keys(aba).map(Number).sort((a, b) => a - b).map(k => aba[k]);
  const t = PA.traduzir(linhas, { mes: MES });
  if (t.relatorio !== 'recebido') { console.error('🛑 O arquivo não é o faturamento-recebido.'); process.exit(1); }
  const auto = t.descartadas.filter(d => d.automatica);
  console.log(`${projeto.toUpperCase()} · ${MES} · ${APPLY ? 'GRAVANDO' : 'ensaio (nada é gravado)'}`);
  console.log(`arquivo: ${path.basename(ARQUIVO)} · renovações automáticas pela regra: ${auto.length} linha(s)`);

  const units = (await db.collection('units').get()).docs;
  for (const sigla of ['CP', 'PP']) {
    const u = units.find(d => PA.siglaDaUnidade(d.id, [sigla]) === sigla);
    if (!u) { console.log(`\n${sigla}: unidade não encontrada`); continue; }
    const periodId = u.id + '_' + MES;
    const ref = db.collection('periodos').doc(periodId);
    const p = (await ref.get()).data();
    if (!p) { console.log(`\n${sigla}: o período ${periodId} não existe`); continue; }
    const contratos = [...new Set(auto.filter(d => d.unidade === sigla).map(d => String(d.contrato)))].sort();
    console.log(`\n=== ${sigla} · ${periodId} · último envio: ${p.fileName || '?'} · contratos pela regra: ${contratos.length}`);

    // a API tem que dizer o mesmo
    const pelaApi = [];
    const itensSnap = await ref.collection('itens').get();
    const processados = itensSnap.docs.filter(d => d.data().type === 'processed');
    for (const d of processados) {
      const x = d.data();
      const m = String(x.codigo || '').match(/^C(\d+)/);
      if (!m || !x.isContract || x.category !== 'renovacao') continue;
      const cad = (await db.collection('pacto_contratos').doc(sigla + '_' + m[1]).get()).data() || {};
      if (String(cad.lancou || '').trim().toUpperCase() === 'RECORRENCIA' && !pelaApi.includes(m[1])) pelaApi.push(m[1]);
    }
    pelaApi.sort();
    const alvo = processados.filter(d => { const m = String(d.data().codigo || '').match(/^C(\d+)(-\d+)?$/); return !!m && contratos.includes(m[1]); });
    const noBanco = [...new Set(alvo.map(d => String(d.data().codigo).match(/^C(\d+)/)[1]))].sort();
    console.log(`   lançamentos a tirar: ${alvo.length} (contratos ${noBanco.join(', ') || '-'})`);
    if (JSON.stringify(noBanco) !== JSON.stringify(pelaApi)) {
      console.log(`   🛑 a regra e a API não dizem o mesmo — nada foi feito nesta unidade. Pela API: ${pelaApi.join(', ') || '-'}`);
      continue;
    }
    if (!alvo.length) { console.log('   nada a fazer.'); continue; }
    const estranhos = alvo.filter(d => { const x = d.data(); return x.originalSplitId || String(x.item || '').includes('(Split:') || x.category !== 'renovacao'; });
    if (estranhos.length) { console.log(`   🛑 ${estranhos.length} lançamento(s) dividido(s) ou fora da categoria renovação — conferir à mão. Nada foi feito.`); continue; }
    const pags = await db.collection('pagamentos').where('periodId', '==', periodId).get();
    if (!pags.empty) { console.log(`   🛑 o mês já tem ${pags.size} pagamento(s) registrado(s) — não mexo. Nada foi feito.`); continue; }

    const antes = p.vendorSummary || {};
    const tot = p.totals || {};
    console.log(`   hoje: ativações ${tot.unitAtivacoes} · novos+retorno ${tot.unitNovosRetorno} · renovações ${tot.unitRenovacoes} · vouchers ${tot.unitVouchers}`);
    alvo.forEach(d => { const x = d.data(); console.log(`     − ${x.codigo} · ${x.data} · ${String(x.item).slice(0, 44)} · ${x.vendedor} · P1+P2 ${brl((x.p1valor || 0) + (x.p2bonus || 0))}`); });

    if (!APPLY) {
      // previsão pela mesma conta (sem gravar): os processados menos os que saem
      const ops0 = CM.criar({ db, FieldValue, Timestamp, Engine: CE, Adapter: PA, Jornada: JC, Metas: MS, autor: AUTOR });
      const cfgU = await ops0.configDaUnidade(u.id);
      const minimos = await ops0.minimosDoPeriodo(MES, cfgU, p);
      const adiadas = await ops0.ativacoesAdiadasPara(u.id, MES);
      const cfg = CE.configDoMes({ unitConfig: cfgU, metasMensais: p.metasMensais, mes: MES, minimosPorPessoa: minimos, ativacoesAdiadas: adiadas });
      const ids = new Set(alvo.map(d => d.id));
      const fica = processados.filter(d => !ids.has(d.id)).map(d => ({ ...d.data() }));
      const vd = CE.buildVendorData(fica, {}, cfg);
      const c = CE.contagensDaUnidade(fica, cfg.ativacoesAdiadas);
      CE.applyP3Pool(vd, c.unitAtivacoes, c.unitNovosRetorno, c.unitRenovacoes, c.unitVouchers, cfg);
      console.log(`   previsto: ativações ${CE.arredondaContagem(c.unitAtivacoes)} · novos+retorno ${CE.arredondaContagem(c.unitNovosRetorno)} · renovações ${CE.arredondaContagem(c.unitRenovacoes)} · vouchers ${CE.arredondaContagem(c.unitVouchers)} (faixas ${cfg.meta}/${cfg.superMeta}/${cfg.metaGold})`);
      Object.keys(antes).sort().forEach(nome => {
        const a = antes[nome], d = vd[nome];
        if (a.isNaoCom) return;
        const dep = d ? (d.p1total || 0) + (d.p2total || 0) + (d.p3 || 0) + (Number(a.p4i) || 0) + (Number(a.p4p) || 0) : 0;
        console.log(`     ${nome.padEnd(28)} ${brl(total(a))} → ${brl(dep)} (${brl(dep - total(a))})`);
      });
      continue;
    }

    // 2. cópia e remoção
    const pasta = path.join(RAIZ, 'backups');
    if (!fs.existsSync(pasta)) fs.mkdirSync(pasta);
    const arq = path.join(pasta, `renovacao-automatica-${projeto}-${periodId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(arq, JSON.stringify({ periodId, quando: new Date().toISOString(), periodo: { totals: p.totals, vendorSummary: p.vendorSummary, codigosPagos: p.codigosPagos || [], p4result: p.p4result || null },
      itens: alvo.map(d => ({ id: d.id, data: d.data() })) }, null, 2));
    console.log(`   cópia: backups/${path.basename(arq)}`);
    const batch = db.batch();
    alvo.forEach(d => batch.delete(d.ref));
    await batch.commit();

    // 3. recálculo pela conta de sempre, contratos já comissionados e registro
    const ops = CM.criar({ db, FieldValue, Timestamp, Engine: CE, Adapter: PA, Jornada: JC, Metas: MS, autor: AUTOR, log: console });
    const itens = await ops.recalcularPeriodo(periodId, { type: 'config_change', label: 'Renovação automática do plano recorrente fora da comissão' });
    await ops.gravarCodigosPagos(periodId, itens);
    await db.collection('audit_log').add({ type: 'upload', unitId: u.id, userId: AUTOR.uid, userName: AUTOR.name, timestamp: FieldValue.serverTimestamp(),
      details: `${periodId}: ${alvo.length} renovação(ões) automática(s) do plano recorrente tirada(s) da comissão (contratos ${noBanco.join(', ')}) e mês recalculado` });

    const d2 = (await ref.get()).data();
    const t2 = d2.totals || {};
    console.log(`   depois: ativações ${t2.unitAtivacoes} · novos+retorno ${t2.unitNovosRetorno} · renovações ${t2.unitRenovacoes} · vouchers ${t2.unitVouchers}`);
    const dps = d2.vendorSummary || {};
    [...new Set([...Object.keys(antes), ...Object.keys(dps)])].sort().forEach(nome => {
      const a = antes[nome] || {}, d = dps[nome] || {};
      if (a.isNaoCom || d.isNaoCom) return;
      console.log(`     ${nome.padEnd(28)} ${brl(total(a))} → ${brl(total(d))} (${brl(total(d) - total(a))}) · faixa ${d.p3Tier || '-'}`);
    });
  }
  process.exit(0);
})().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
