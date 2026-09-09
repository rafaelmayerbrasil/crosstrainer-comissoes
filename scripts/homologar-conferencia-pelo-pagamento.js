'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Homologa "a conferência parte do pagamento" contra o Firestore de verdade
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/homologar-conferencia-pelo-pagamento.js
//
// ⚠️ SÓ STAGING, e o projeto é hardcoded — este script ESCREVE. Ele monta
//    estado de propósito (marcações da gestão), confere o efeito e devolve o
//    banco ao que era. Rodar em produção inventaria decisão de gestão.
//
// POR QUE EXISTE: os smokes rodam as funções puras contra fixture montada à
// mão. Isso prova a REGRA, não o DADO. Aqui o caminho é o mesmo que o
// navegador faz — ler `periodos`, ler `vendas_conferencia`, cruzar, aplicar —
// só que contra o banco real do staging, que tem os dois casos que deram
// origem ao desenho: a AMANDHA e a CÁTIA.
//
// A leitura é uma REIMPLEMENTAÇÃO do caminho do index.html, não um import: se
// fossem o mesmo código, o script concordaria com um defeito em vez de
// denunciá-lo. O que ele compartilha com a tela é `vendas-aguardando.js`, que
// é onde mora a regra.
//
// Desenho: docs/superpowers/specs/2026-09-09-conferencia-parte-do-pagamento-design.md

const path = require('path');
const admin = require('firebase-admin');
const VA = require(path.join(__dirname, '..', 'vendas-aguardando.js'));

// ─── Guarda: NUNCA produção ───────────────────────────────────────────
// Hardcoded (não lê argv nem env) porque este script escreve em
// `vendas_conferencia`. Em produção isso seria decisão de gestão inventada.
const svc = require('./serviceAccount-staging.json');
if (!String(svc.project_id || '').endsWith('-staging')) {
  console.error('RECUSADO: só staging. project_id = ' + svc.project_id);
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(svc) });
const db = admin.firestore();

let ok = 0, falhas = 0;
const conferir = (cond, msg) => {
  ok++;
  if (cond) console.log('  OK    ' + msg);
  else { falhas++; console.log('  FALHA ' + msg); }
};

const MES = '2026-08';

// ══════════════════════════════════════════════════════════════════════
// O caminho de leitura do navegador, reimplementado
// ══════════════════════════════════════════════════════════════════════

/** o mesmo que `carregarVendidoXPago` faz no index.html */
async function carregar(unitId) {
  const pDoc = await db.collection('periodos').doc(unitId + '_' + MES).get();
  if (!pDoc.exists) return null;
  const vendas = pDoc.data().vendasDoMes || [];

  // `pagos` carrega o MÊS de cada código: sob caixa o contrato paga uma vez
  // só, e é esse mês que a tela mostra como "Pago em".
  const snap = await db.collection('periodos').where('unitId', '==', unitId).get();
  const pagos = [];
  snap.forEach(d => {
    const m = String(d.id).match(/(\d{4}-\d{2})$/);
    (d.data().codigosPagos || []).forEach(c => pagos.push({ codigo: c, mes: m ? m[1] : null, data: null }));
  });

  // A prova ao lado da pergunta: quem pagou o quê, no mês.
  const itens = await db.collection('periodos').doc(unitId + '_' + MES).collection('itens').get();
  const clientesPagantes = [];
  itens.forEach(d => {
    const it = d.data();
    if ((it.type || 'processed') !== 'processed') return;
    if (!/^C\d+/i.test(String(it.codigo || ''))) return;
    if (it.cliente) clientesPagantes.push({
      cliente: it.cliente, codigo: it.codigo, valor: it.valorCaixa || 0, data: it.data || null,
      // Quem RECEBEU o dinheiro. A tela mostra este nome quando ele difere de
      // quem vendeu — sinal de que o pagamento pode ser do plano anterior.
      vendedor: it.vendedor || '',
    });
  });

  // Dois tipos de registro na mesma coleção: decisão sobre uma VENDA
  // (tem `contrato`) e descarte de um PAGAMENTO (`tipo: 'pagamento'`).
  const confSnap = await db.collection('vendas_conferencia').where('unitId', '==', unitId).get();
  const conferencias = {}, descartes = {};
  confSnap.forEach(d => {
    const x = d.data();
    if (x.tipo === 'pagamento' && x.pagamento) descartes[x.pagamento] = x;
    else if (x.contrato) conferencias[x.contrato] = x;
  });

  const cruzado = VA.aplicarConferencias(VA.cruzar(vendas, pagos, clientesPagantes), conferencias, descartes);
  return { cruzado, conferencias, descartes, duvidas: VA.duvidasPorPagamento(cruzado) };
}

// ══════════════════════════════════════════════════════════════════════
// A escrita — a MESMA forma de documento que `registrarConferencia` grava
// ══════════════════════════════════════════════════════════════════════

const criados = [];
async function marcarVenda(unitId, contrato, desfecho, pagamento, cliente) {
  const id = unitId + '_' + contrato;
  await db.collection('vendas_conferencia').doc(id).set({
    unitId, contrato, cliente: cliente || '', mesDaVenda: MES,
    desfecho, observacao: 'HOMOLOGACAO (apagar)', _fixture: true,
    ...(pagamento ? {
      pagamentoApontado: {
        codigo: pagamento.codigo || '', valor: pagamento.valor || 0,
        data: pagamento.data || '', vendedor: pagamento.vendedor || '',
        cliente: pagamento.cliente || '',
      },
    } : {}),
    por: 'homologacao', porUid: '', em: new Date().toLocaleDateString('pt-BR'),
  });
  criados.push(id);
}

async function descartarPagamento(unitId, codigo, cliente) {
  const id = unitId + '_pg-' + codigo;
  await db.collection('vendas_conferencia').doc(id).set({
    unitId, tipo: 'pagamento', pagamento: codigo, cliente: cliente || '',
    desfecho: 'sem_venda', observacao: 'HOMOLOGACAO (apagar)', _fixture: true,
    por: 'homologacao', porUid: '', em: new Date().toLocaleDateString('pt-BR'),
  });
  criados.push(id);
}

(async () => {
  console.log('=== Conferência pelo pagamento — Firestore real do staging ===\n');
  console.log('Escreve marcação de verdade, confere o efeito e devolve o banco.\n');

  const sujoAntes = await db.collection('vendas_conferencia').get();
  if (sujoAntes.size) {
    console.log('⚠️  vendas_conferencia já tinha ' + sujoAntes.size + ' documento(s) antes de começar.');
    console.log('   As contagens partem deste estado; nada dele será apagado.\n');
  }

  try {
    // ───────────────────────────────────────────────────────────────
    console.log('── 1) Leitura: as dúvidas reais aparecem do lado do DINHEIRO ──');
    const cp = await carregar('unit-cp');
    conferir(!!cp, 'unit-cp_' + MES + ' existe no staging');

    const porCodigo = Object.fromEntries(cp.duvidas.map(d => [d.pagamento.codigo, d]));
    conferir(cp.duvidas.length === 2, 'o Campeche tem 2 dúvidas (veio ' + cp.duvidas.length + ')');
    conferir(!!porCodigo.C6867, 'a dúvida da CÁTIA aparece pelo pagamento C6867');
    conferir(!!porCodigo.C5044, 'a dúvida da AMANDHA aparece pelo pagamento C5044');
    if (porCodigo.C6867) {
      const d = porCodigo.C6867;
      conferir(d.candidatas.length === 1 && d.candidatas[0].contrato === 'C7130',
        'a pergunta da Cátia oferece a venda C7130 — uma pergunta, não duas');
      conferir(Number(d.pagamento.valor) === 199,
        'o pagamento mostrado é o de R$ 199 de verdade (veio R$ ' + d.pagamento.valor + ')');
    }

    // Quem recebeu o dinheiro tem que chegar até a tela. O campo existe no
    // item do mês, e era ele que estava sendo perdido no caminho — gravando
    // `pagamentoApontado.vendedor` vazio para sempre (achado em 09/09/2026,
    // conferindo o que o primeiro clique humano gravou no staging).
    conferir(cp.duvidas.every(d => String(d.pagamento.vendedor || '').trim()),
      'o pagamento de cada dúvida carrega QUEM RECEBEU o dinheiro');
    // Nos dois casos reais do staging é a mesma pessoa dos dois lados, então a
    // tela tem que ficar CALADA — mostrar o nome repetido seria ruído.
    conferir(cp.duvidas.every(d => d.candidatas.every(v =>
      (v.vendedores || []).map(x => x.trim().toUpperCase())
        .includes(String(d.pagamento.vendedor).trim().toUpperCase()))),
      'e aqui é a mesma vendedora dos dois lados — a tela não tem nome novo a mostrar');

    const pp = await carregar('unit-pp');
    conferir(pp.duvidas.length === 0, 'o Príncipe não tem dúvida nenhuma — a tela não inventa pergunta');
    conferir((cp.cruzado.testes || []).length === 1, 'o registro de teste do Campeche fica fora dos grupos');

    console.log('        (Campeche: pagas=' + cp.cruzado.pagas.length
      + ' aguardando=' + cp.cruzado.aguardando.length
      + ' conferir=' + cp.cruzado.conferir.length
      + ' canceladas=' + (cp.cruzado.canceladas || []).length + ')');

    // ───────────────────────────────────────────────────────────────
    console.log('\n── 2) Escrita: apontar o pagamento resolve a dúvida da Cátia ──');
    const pgCatia = porCodigo.C6867.pagamento;
    await marcarVenda('unit-cp', 'C7130', 'paga', pgCatia, 'CÁTIA TEREZINHA PEREIRA TORRES');
    const d2 = await carregar('unit-cp');
    const catiaPaga = d2.cruzado.pagas.find(v => v.contrato === 'C7130');
    conferir(!!catiaPaga, 'a venda da Cátia passou para o grupo das PAGAS');
    conferir(!!(catiaPaga && catiaPaga.conferencia), 'e carrega o registro de quem decidiu');
    conferir(!!(catiaPaga && catiaPaga.conferencia && catiaPaga.conferencia.pagamentoApontado
      && catiaPaga.conferencia.pagamentoApontado.codigo === 'C6867'),
      'guardando QUAL dinheiro explicou a venda (C6867)');
    conferir(d2.duvidas.length === 1, 'a pergunta dela sumiu — sobrou 1 dúvida (veio ' + d2.duvidas.length + ')');
    conferir(!d2.cruzado.conferir.some(v => v.contrato === 'C7130'), 'e ela não está mais na fila de conferir');

    // ───────────────────────────────────────────────────────────────
    console.log('\n── 3) A trava: o mesmo dinheiro não explica duas vendas ──');
    const conflito = VA.pagamentoJaApontado(d2.conferencias, 'C6867', 'C9999');
    conferir(!!conflito && conflito.contrato === 'C7130',
      'apontar C6867 numa segunda venda é recusado, dizendo em qual venda ele já está');
    conferir(VA.pagamentoJaApontado(d2.conferencias, 'C6867', 'C7130') === null,
      'e a própria venda reapontando o mesmo pagamento não é conflito');

    // ───────────────────────────────────────────────────────────────
    console.log('\n── 4) "Não é este pagamento" cala a pergunta e MANTÉM a venda na fila ──');
    await descartarPagamento('unit-cp', 'C5044', 'AMANDHA MARCELA PEREIRA GERN TORRES');
    const d3 = await carregar('unit-cp');
    conferir(d3.duvidas.length === 0, 'nenhuma pergunta sobrou (veio ' + d3.duvidas.length + ')');
    const amandha = [].concat(d3.cruzado.aguardando, d3.cruzado.conferir).find(v => v.contrato === 'C7070');
    conferir(!!amandha, 'a venda da Amandha CONTINUA na fila — ela não foi paga, só não foi por aquele dinheiro');
    conferir(!d3.cruzado.pagas.some(v => v.contrato === 'C7070'), 'e não foi para as pagas por engano');

    // ───────────────────────────────────────────────────────────────
    console.log('\n── 5) "Cliente desistiu" tira a venda da fila ──');
    const alvo = pp.cruzado.aguardando[0];
    await marcarVenda('unit-pp', alvo.contrato, 'cancelada', null, alvo.cliente);
    const d4 = await carregar('unit-pp');
    conferir((d4.cruzado.canceladas || []).some(v => v.contrato === alvo.contrato),
      'a venda ' + alvo.contrato + ' (' + alvo.cliente + ') foi para o grupo das canceladas');
    conferir(!d4.cruzado.aguardando.some(v => v.contrato === alvo.contrato),
      'e saiu da lista de quem ainda se cobra');
    conferir(d4.cruzado.aguardando.length === pp.cruzado.aguardando.length - 1,
      'a fila do Príncipe caiu de ' + pp.cruzado.aguardando.length + ' para ' + d4.cruzado.aguardando.length);

    // ───────────────────────────────────────────────────────────────
    console.log('\n── 6) 🚨 O DINHEIRO SEMPRE GANHA da marcação ──');
    const jaPaga = pp.cruzado.pagas.find(v => v.contrato && v.contrato !== alvo.contrato);
    await marcarVenda('unit-pp', jaPaga.contrato, 'cancelada', null, jaPaga.cliente);
    const d5 = await carregar('unit-pp');
    const aindaPaga = d5.cruzado.pagas.find(v => v.contrato === jaPaga.contrato);
    conferir(!!aindaPaga,
      jaPaga.contrato + ' foi marcada "desistiu", mas o recebimento manda: continua PAGA');
    conferir(!!(aindaPaga && aindaPaga.marcacaoIgnorada),
      'e a tela tem o que dizer — carrega o aviso de que havia marcação em contrário');
    conferir(!(d5.cruzado.canceladas || []).some(v => v.contrato === jaPaga.contrato),
      'ela não aparece como cancelada em lugar nenhum');

    // ───────────────────────────────────────────────────────────────
    console.log('\n── 7) Marcação não move um centavo ──');
    const periodo = await db.collection('periodos').doc('unit-pp_' + MES).get();
    conferir(!!periodo.data().totals, 'os totais do período seguem intactos (marcação não escreve em `periodos`)');
    const codigosDepois = (periodo.data().codigosPagos || []).length;
    conferir(codigosDepois === 39,
      'codigosPagos do Príncipe continua 39 (veio ' + codigosDepois + ') — nada de dinheiro nasceu daqui');

  } finally {
    // ───────────────────────────────────────────────────────────────
    console.log('\n── Limpeza: devolvendo o staging ao que era ──');
    for (const id of criados) {
      try { await db.collection('vendas_conferencia').doc(id).delete(); console.log('  removido ' + id); }
      catch (e) { console.warn('  FALHA ao remover ' + id + ': ' + e.message); }
    }
    const sobrou = await db.collection('vendas_conferencia').get();
    const meus = [];
    sobrou.forEach(d => { if (d.data()._fixture) meus.push(d.id); });
    ok++;
    if (meus.length || sobrou.size !== sujoAntes.size) {
      falhas++;
      console.log('  FALHA sobrou coisa: fixtures=[' + meus.join(', ') + '] '
        + 'total=' + sobrou.size + ' (antes ' + sujoAntes.size + ')');
    } else {
      console.log('  checagem pós-limpeza: 0 fixture no banco · vendas_conferencia com '
        + sobrou.size + ' doc(s), os mesmos de antes ✓');
    }
  }

  console.log('\n' + (ok - falhas) + '/' + ok + ' verificações passaram');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, '\n', e.stack); process.exit(1); });
