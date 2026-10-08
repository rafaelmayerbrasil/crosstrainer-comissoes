'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Acerto à mão num mês JÁ CALCULADO e ainda NÃO PAGO, decidido pela gestão
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/acertar-comissao-do-mes.js --project staging|production --periodo cp_2026-09
//        [--adiadas-de cp_2026-07] [--vendedora C7162="ERICA FAUSTINO"] [--apply]
//
// Faz duas coisas, as duas pedidas pela Erica em 07/10/2026 e autorizadas pelo Rafael:
//
//   --adiadas-de <período de origem>
//       Paga no mês do `--periodo` as comissões que a regra antiga dos 30 dias ADIOU
//       para ele e que nunca voltaram (nada lê `comissoes_diferidas` — commission.js,
//       FIM_DO_DIFERIMENTO). Entra um lançamento por comissão, só com o P1 e o P2 que
//       tinham sido calculados na origem: valor de caixa ZERO, não conta ativação nem
//       renovação e não entra na base do bônus da unidade — o dinheiro entrou no mês
//       de origem; aqui só se devolve o que ficou para trás, sem mexer na faixa nem
//       na parte das outras vendedoras.
//
//   --vendedora C<contrato>="NOME" (pode repetir)
//       Passa o lançamento do contrato para outra vendedora — o mesmo que
//       Lançamentos → Editar → vendedor faz na tela. O nome tem que ser de alguém
//       que já vendeu no mês (não cria vendedora nova por erro de digitação).
//
// Depois recalcula o mês pela MESMA conta da tela e do servidor (`comissoes-mes.js`),
// com cópia em backups/, histórico e audit_log.
//
// Sem --apply não grava nada: mostra o que faria e o resultado previsto.
// Para se o mês já tiver pagamento registrado. Imprime contratos e VENDEDORAS, nunca alunos.
//
// ⚠️ Os lançamentos de comissão adiada não existem no arquivo da Pacto: se alguém subir
//    de novo o arquivo do mês, eles saem ("apaga o que saiu da fonte") — é só rodar de novo.

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const admin = require(path.join(RAIZ, 'functions', 'node_modules', 'firebase-admin'));
const PA = require(path.join(RAIZ, 'pacto-adapter.js'));
const CE = require(path.join(RAIZ, 'commission.js'));
const CM = require(path.join(RAIZ, 'comissoes-mes.js'));
const JC = require(path.join(RAIZ, 'jornada-comercial.js'));
const MS = require(path.join(RAIZ, 'metas-sugeridas.js'));

const args = process.argv.slice(2);
const arg = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const todos = k => args.map((a, i) => (a === k ? args[i + 1] : null)).filter(Boolean);
const projeto = arg('--project');
const PERIODO = arg('--periodo');
const ORIGEM = arg('--adiadas-de');
const TROCAS = todos('--vendedora').map(t => { const m = String(t).match(/^C?(\d+)=(.+)$/i); return m ? { contrato: m[1], para: m[2].trim().toUpperCase() } : null; });
const APPLY = args.includes('--apply');
if (!['staging', 'production'].includes(projeto) || !/_\d{4}-\d{2}$/.test(PERIODO || '') || TROCAS.includes(null) || (!ORIGEM && !TROCAS.length)) {
  console.error('uso: node scripts/acertar-comissao-do-mes.js --project staging|production --periodo <unidade>_AAAA-MM [--adiadas-de <unidade>_AAAA-MM] [--vendedora C1234="NOME"] [--apply]');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, `serviceAccount-${projeto}.json`))) });
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;
const AUTOR = { uid: 'script-manutencao', email: 'script-manutencao', name: 'Manutenção (Claude, autorizado pelo Rafael)' };
const brl = v => 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');
const total = v => (Number(v.p1) || 0) + (Number(v.p2) || 0) + (Number(v.p3) || 0) + (Number(v.p4i) || 0) + (Number(v.p4p) || 0);
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** O lançamento que devolve uma comissão adiada: só P1 e P2, sem caixa, sem contagem, fora do bônus */
function lancamentoDaAdiada(o, origemId, itemId, mes, uploadId) {
  const [aaaa, mm] = mes.split('-');
  const inicio = String(o.planStartDate || '');
  const noMes = inicio.slice(3) === mm + '/' + aaaa;
  const mesOrigem = CM.mesDoPeriodoId(origemId).split('-').reverse().join('/');
  return {
    vendedor: o.vendedor, cliente: o.cliente || '',
    data: noMes ? inicio : '01/' + mm + '/' + aaaa,
    // Sem o nome do plano de propósito: "MENSAL", "ANUAL"… fariam o motor contar uma ativação
    item: `COMISSÃO ADIADA DE ${mesOrigem} — pagamento de ${o.data || '?'}, plano de ${inicio || '?'} a ${o.planEndDate || '?'}`,
    itemOriginal: o.item || '', valorCaixaOriginal: Number(o.valorCaixa) || 0,
    valorCaixa: 0, tipoVenda: '', category: 'outro', label: 'Comissão adiada', origem: 'Acerto manual',
    type: 'processed', codigo: '',
    manualP1: Number(o.p1valor) || 0, manualP2: Number(o.p2bonus) || 0,
    isActivation: false, isContract: false, isEligibleP3: false, isDegustacao: false,
    excluded: false, excludeReason: '', periodicidade: null, abrangencia: null, canceladoSemEstorno: false,
    uploadId: uploadId || null,
    comissaoAdiadaDe: { periodo: origemId, itemId, codigo: o.codigo || null },
  };
}

(async () => {
  const MES = CM.mesDoPeriodoId(PERIODO);
  const ref = db.collection('periodos').doc(PERIODO);
  const p = (await ref.get()).data();
  if (!p) { console.error('🛑 O período ' + PERIODO + ' não existe.'); process.exit(1); }
  console.log(`${projeto.toUpperCase()} · ${PERIODO} · ${APPLY ? 'GRAVANDO' : 'ensaio (nada é gravado)'}`);

  const pags = await db.collection('pagamentos').where('periodId', '==', PERIODO).get();
  if (!pags.empty) { console.error(`🛑 O mês já tem ${pags.size} pagamento(s) registrado(s) — não mexo. Nada foi feito.`); process.exit(1); }

  const itensSnap = await ref.collection('itens').get();
  const processados = itensSnap.docs.filter(d => d.data().type === 'processed');
  const antes = p.vendorSummary || {};
  const nomesDoMes = Object.keys(antes);

  // 1. trocas de vendedora
  const trocas = [];
  for (const t of TROCAS) {
    const alvo = processados.filter(d => { const m = String(d.data().codigo || '').match(/^C(\d+)(-\d+)?$/); return !!m && m[1] === t.contrato; });
    const para = nomesDoMes.find(n => norm(n) === norm(t.para));
    if (!alvo.length) { console.error(`🛑 Contrato ${t.contrato}: nenhum lançamento no mês. Nada foi feito.`); process.exit(1); }
    if (!para) { console.error(`🛑 "${t.para}" não vendeu neste mês (${nomesDoMes.join(', ')}). Nada foi feito.`); process.exit(1); }
    if (alvo.some(d => d.data().originalSplitId || String(d.data().item || '').includes('(Split:'))) { console.error(`🛑 Contrato ${t.contrato}: lançamento dividido — acertar pela tela. Nada foi feito.`); process.exit(1); }
    alvo.forEach(d => {
      const x = d.data();
      if (norm(x.vendedor) === norm(para)) { console.log(`   contrato ${t.contrato}: já está com ${para} — nada a trocar.`); return; }
      trocas.push({ ref: d.ref, id: d.id, de: x.vendedor, para, contrato: t.contrato, antes: x });
      console.log(`   ⇄ C${t.contrato} · ${x.data} · ${x.label} · P1+P2 ${brl((x.p1valor || 0) + (x.p2bonus || 0))} · ${x.vendedor} → ${para}`);
    });
  }

  // 2. comissões adiadas para este mês
  const novos = [];
  let diferidas = [];
  if (ORIGEM) {
    const og = await db.collection('periodos').doc(ORIGEM).collection('itens').where('type', '==', 'deferred').get();
    const paraCa = og.docs.filter(d => d.data().deferToMonth === MES);
    console.log(`   adiadas de ${ORIGEM} para ${MES}: ${paraCa.length}`);
    for (const d of paraCa) {
      const o = d.data();
      const id = 'adiada_' + d.id;
      if (itensSnap.docs.some(x => x.id === id)) { console.log(`   + ${o.vendedor} · pago em ${o.data} · ${brl(o.totalP1P2)} — já lançada, pulo.`); continue; }
      const item = lancamentoDaAdiada(o, ORIGEM, d.id, MES, p.uploadId);
      novos.push({ id, item, valorOrigem: Number(o.totalP1P2) || 0 });
      console.log(`   + ${o.vendedor} · pago em ${o.data} · começa em ${o.planStartDate} · ${o.label} · ${brl(o.totalP1P2)}`);
    }
    const dif = await db.collection('comissoes_diferidas').where('sourcePeriodId', '==', ORIGEM).get();
    diferidas = dif.docs.filter(d => d.data().deferToMonth === MES);
  }
  if (!trocas.length && !novos.length) { console.log('\nNada a fazer.'); process.exit(0); }

  // 3. a conta, pela mesma configuração do recálculo
  const ops = CM.criar({ db, FieldValue, Timestamp, Engine: CE, Adapter: PA, Jornada: JC, Metas: MS, autor: AUTOR, log: console });
  const cfgU = await ops.configDaUnidade(p.unitId);
  const minimos = await ops.minimosDoPeriodo(MES, cfgU, p);
  const adiadasContagem = await ops.ativacoesAdiadasPara(p.unitId, MES);
  const cfg = CE.configDoMes({ unitConfig: cfgU, metasMensais: p.metasMensais, mes: MES, minimosPorPessoa: minimos, ativacoesAdiadas: adiadasContagem });
  const conta = lista => {
    const vd = CE.buildVendorData(lista, {}, cfg);
    const c = CE.contagensDaUnidade(lista, cfg.ativacoesAdiadas);
    CE.applyP3Pool(vd, c.unitAtivacoes, c.unitNovosRetorno, c.unitRenovacoes, c.unitVouchers, cfg);
    return { vd, c };
  };
  const totalPrevisto = (vd, nome) => { const d = vd[nome], a = antes[nome] || {}; return d ? (d.p1total || 0) + (d.p2total || 0) + (d.p3 || 0) + (Number(a.p4i) || 0) + (Number(a.p4p) || 0) : 0; };

  // a conta daqui tem que reproduzir o que está gravado, senão a previsão não vale
  const base = conta(processados.map(d => ({ ...d.data() })));
  const fora = nomesDoMes.filter(n => !antes[n].isNaoCom && Math.abs(totalPrevisto(base.vd, n) - total(antes[n])) > 0.01);
  if (fora.length) { console.error(`🛑 A conta do script não reproduz o gravado para: ${fora.join(', ')}. Nada foi feito.`); process.exit(1); }

  const trocaPorId = new Map(trocas.map(t => [t.id, t]));
  const depoisLista = processados.map(d => {
    const x = { ...d.data() };
    if (trocaPorId.has(d.id)) { x.vendedor = trocaPorId.get(d.id).para; CE.applyCommissionsToItem(x, cfg); }
    return x;
  });
  for (const n of novos) {
    CE.applyCommissionsToItem(n.item, cfg);
    if (n.item.isActivation || n.item.isContract || Math.abs(n.item.totalP1P2 - n.valorOrigem) > 0.005) {
      console.error('🛑 O lançamento da comissão adiada contaria ativação ou sairia com outro valor. Nada foi feito.'); process.exit(1);
    }
    depoisLista.push({ ...n.item });
  }
  const prev = conta(depoisLista);
  const r = CE.arredondaContagem.bind(CE);
  const tot = p.totals || {};
  console.log(`\n   hoje:     ativações ${tot.unitAtivacoes} · novos+retorno ${tot.unitNovosRetorno} · renovações ${tot.unitRenovacoes} · vouchers ${tot.unitVouchers} (faixas ${cfg.meta}/${cfg.superMeta}/${cfg.metaGold})`);
  console.log(`   previsto: ativações ${r(prev.c.unitAtivacoes)} · novos+retorno ${r(prev.c.unitNovosRetorno)} · renovações ${r(prev.c.unitRenovacoes)} · vouchers ${r(prev.c.unitVouchers)}`);
  const previsto = {};
  nomesDoMes.sort().forEach(nome => {
    if (antes[nome].isNaoCom) return;
    previsto[nome] = totalPrevisto(prev.vd, nome);
    console.log(`     ${nome.padEnd(28)} ${brl(total(antes[nome]))} → ${brl(previsto[nome])} (${brl(previsto[nome] - total(antes[nome]))})`);
  });
  if (!APPLY) { console.log('\nEnsaio: nada foi gravado. Com --apply, grava.'); process.exit(0); }

  // 4. cópia
  const pasta = path.join(RAIZ, 'backups');
  if (!fs.existsSync(pasta)) fs.mkdirSync(pasta);
  const arq = path.join(pasta, `acerto-comissao-${projeto}-${PERIODO}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(arq, JSON.stringify({ periodId: PERIODO, quando: new Date().toISOString(),
    periodo: { totals: p.totals, vendorSummary: p.vendorSummary, codigosPagos: p.codigosPagos || [], p4result: p.p4result || null },
    trocas: trocas.map(t => ({ id: t.id, de: t.de, para: t.para, antes: t.antes })),
    novos: novos.map(n => ({ id: n.id, item: n.item })),
    diferidas: diferidas.map(d => ({ id: d.id, data: d.data() })) }, null, 2));
  console.log(`\n   cópia: backups/${path.basename(arq)}`);

  // 5. grava e recalcula pela conta de sempre
  const batch = db.batch();
  trocas.forEach(t => batch.update(t.ref, { vendedor: t.para, vendedorAntes: t.de }));
  novos.forEach(n => batch.set(ref.collection('itens').doc(n.id), { ...n.item, criadoPor: AUTOR.uid, criadoEm: FieldValue.serverTimestamp() }));
  diferidas.forEach(d => batch.update(d.ref, { status: 'paga', pagoNoPeriodo: PERIODO, pagoEm: FieldValue.serverTimestamp() }));
  await batch.commit();

  const partes = [];
  if (novos.length) partes.push(`${novos.length} comissão(ões) adiada(s) de ${ORIGEM} paga(s) (${brl(novos.reduce((s, n) => s + n.valorOrigem, 0))}, para ${[...new Set(novos.map(n => n.item.vendedor))].join(', ')})`);
  if (trocas.length) partes.push('vendedora trocada: ' + trocas.map(t => `C${t.contrato} ${t.de} → ${t.para}`).join('; '));
  const resumo = partes.join(' · ');
  const itens = await ops.recalcularPeriodo(PERIODO, { type: 'item_edit', label: 'Acerto manual: ' + resumo });
  await ops.gravarCodigosPagos(PERIODO, itens);
  await db.collection('audit_log').add({ type: 'record_edit', unitId: p.unitId, userId: AUTOR.uid, userName: AUTOR.name, timestamp: FieldValue.serverTimestamp(),
    details: `${PERIODO}: ${resumo} — mês recalculado` });

  // 6. confere o que ficou gravado contra o previsto
  const d2 = (await ref.get()).data();
  const t2 = d2.totals || {};
  console.log(`   depois:   ativações ${t2.unitAtivacoes} · novos+retorno ${t2.unitNovosRetorno} · renovações ${t2.unitRenovacoes} · vouchers ${t2.unitVouchers}`);
  let ok = true;
  Object.keys(d2.vendorSummary || {}).sort().forEach(nome => {
    const d = d2.vendorSummary[nome], a = antes[nome] || {};
    if (d.isNaoCom) return;
    const bate = previsto[nome] !== undefined && Math.abs(total(d) - previsto[nome]) <= 0.01;
    if (!bate) ok = false;
    console.log(`     ${nome.padEnd(28)} ${brl(total(a))} → ${brl(total(d))} (${brl(total(d) - total(a))}) · faixa ${d.p3Tier || '-'} ${bate ? '✓' : '✗ diferente do previsto'}`);
  });
  console.log(ok ? '\n✅ Gravado, e igual ao previsto.' : '\n⚠️ Gravado, mas diferente do previsto — conferir (a cópia está em backups/).');
  process.exit(0);
})().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
