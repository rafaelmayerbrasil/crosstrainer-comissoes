'use strict';
// ===================================================================
// Homologa o painel "vendido x pago" contra o Firestore de verdade
// ===================================================================
//
//   node scripts/homologar-vendido-x-pago.js --project production
//   node scripts/homologar-vendido-x-pago.js --project staging
//
// SOMENTE LEITURA. Nao escreve nada.
//
// POR QUE EXISTE: os smokes rodam as funcoes puras contra fixture. Isso prova
// a regra, nao o dado. Este script refaz o MESMO caminho que
// `carregarVendidoXPago` e `carregarArrastoAnterior` fazem no navegador, so
// que contra o banco real, e compara com os numeros que o plano registrou.
// Se divergir, ou a implementacao mudou ou o banco mudou - as duas coisas
// merecem os olhos de alguem antes de publicar.
//
// A leitura e deliberadamente uma REIMPLEMENTACAO das duas funcoes do
// index.html, nao um import: se as duas fossem o mesmo codigo, o script
// concordaria com um defeito em vez de denuncia-lo. O que ele compartilha com
// a tela e o modulo puro `vendas-aguardando.js`, que e onde mora a REGRA.

const path = require('path');
const admin = require('firebase-admin');
const VA = require(path.join(__dirname, '..', 'vendas-aguardando.js'));
const CE = require(path.join(__dirname, '..', 'commission.js'));

const arg = nome => {
  const i = process.argv.indexOf(nome);
  return i > 0 ? process.argv[i + 1] : null;
};
const PROJETO = arg('--project');
if (!PROJETO || !['staging', 'production'].includes(PROJETO)) {
  console.error('Uso: node scripts/homologar-vendido-x-pago.js --project staging|production');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccount-' + PROJETO + '.json')) });
const db = admin.firestore();

let ok = 0, falhas = 0;
const conferir = (condicao, msg) => {
  if (condicao) { ok++; console.log('  OK   ' + msg); }
  else { falhas++; console.log('  FALHA ' + msg); }
};

// O primeiro mes que o arrasto enxerga - antes disso a numeracao era do
// TecnoFit e `codigosPagos` nao tem codigo da Pacto. Tem que bater com a
// constante do index.html.
const PRIMEIRO_MES = '2026-08';

/** o mesmo caminho de `carregarVendidoXPago` no index.html */
async function carregar(periodId) {
  const pDoc = await db.collection('periodos').doc(periodId).get();
  if (!pDoc.exists) return null;
  const pData = pDoc.data();
  const vendas = pData.vendasDoMes || [];
  const unitId = pData.unitId;
  if (!vendas.length) return { unitId, year: pData.year, month: pData.month, temLista: false };

  // `pagos` carrega o MES de cada codigo, nao so o codigo: sob regime de
  // caixa o contrato paga uma vez so, no primeiro mes que pagou, e e esse
  // mes que `cruzar` usa para dizer `pagoEm`. Achatar numa lista so era o
  // que fazia a venda de agosto paga em setembro sumir calada.
  const snap = await db.collection('periodos').where('unitId', '==', unitId).get();
  const pagos = [];
  const mesesQuePagaram = new Set();
  snap.forEach(d => {
    const m = String(d.id).match(/(\d{4}-\d{2})$/);
    const mes = m ? m[1] : null;
    (d.data().codigosPagos || []).forEach(c => {
      pagos.push({ codigo: c, mes, data: null });
      if (mes) mesesQuePagaram.add(mes);
    });
  });

  // A data exata do pagamento sai do lancamento, no mes em que ele caiu.
  // Sao poucas leituras a mais: uma por mes da unidade que tenha recebimento.
  for (const mes of mesesQuePagaram) {
    const itens = await db.collection('periodos').doc(unitId + '_' + mes).collection('itens').get();
    const porCodigo = {};
    itens.forEach(d => {
      const it = d.data();
      if ((it.type || 'processed') !== 'processed') return;
      if (it.data) porCodigo[String(it.codigo || '').replace(/-\d+$/, '')] = it.data;
    });
    pagos.forEach(p => { if (p.mes === mes && porCodigo[p.codigo]) p.data = porCodigo[p.codigo]; });
  }

  // Quem pagou algo DE CONTRATO no mes vai INTEIRO, nao so o nome: e o
  // lancamento que `opiniao()` usa para comparar data e valor contra a venda.
  const itensSnap = await db.collection('periodos').doc(periodId).collection('itens').get();
  const clientesPagantes = [];
  itensSnap.forEach(d => {
    const it = d.data();
    if ((it.type || 'processed') !== 'processed') return;
    if (!/^C\d+/i.test(String(it.codigo || ''))) return;
    if (it.cliente) clientesPagantes.push({
      cliente: it.cliente, codigo: it.codigo,
      valor: it.valorCaixa || 0, data: it.data || null,
    });
  });

  const uDoc = await db.collection('units').doc(unitId).get();
  const unitConfig = (uDoc.exists && uDoc.data().config) || {};
  const cfg = { ...CE.defaultConfig, ...unitConfig };

  const confSnap = await db.collection('vendas_conferencia').where('unitId', '==', unitId).get();
  const conferencias = {};
  confSnap.forEach(d => { const x = d.data(); if (x.contrato) conferencias[x.contrato] = x; });
  const cruzado = VA.aplicarConferencias(VA.cruzar(vendas, pagos, clientesPagantes), conferencias);
  return {
    unitId, year: pData.year, month: pData.month, temLista: true, cruzado,
    resumo: VA.resumo(cruzado),
    porVendedora: VA.contarPorVendedora(cruzado, cfg.naoComissionaveis),
    fechado: VA.mesFechado(pData.year, pData.month),
  };
}

/** o mesmo caminho de `carregarArrastoAnterior` no index.html */
async function arrasto(unitId, mesAtual) {
  const snap = await db.collection('periodos').where('unitId', '==', unitId).get();
  const docs = [], pagos = [];
  snap.forEach(d => {
    const m = String(d.id).match(/(\d{4}-\d{2})$/);
    (d.data().codigosPagos || []).forEach(c => pagos.push(c));
    if (m && m[1] >= PRIMEIRO_MES && m[1] < mesAtual) docs.push({ mes: m[1], ...d.data() });
  });
  const fora = [];
  docs.sort((a, b) => a.mes.localeCompare(b.mes)).forEach(pr => {
    const r = VA.cruzar(pr.vendasDoMes || [], pagos, []);
    r.aguardando.forEach(v => fora.push({ ...v, _mes: pr.mes }));
  });
  return fora;
}

// Os numeros medidos contra a producao. Se o banco mudar (upload novo,
// estorno), o esperado muda junto - por isso a divergencia e para LER, nao
// para "consertar" no automatico.
//
// O Campeche de agosto caiu de 74/4 para 73/3 em 07/09: `TESTE ENDERECO
// TECNOFIT` (contrato C7117, R$ 150, no nome do Rodrigo) e registro de teste
// e passou a sair da conta em `cruzar`. Nao mexeu em dinheiro nenhum - ele
// nunca gerou item de comissao, e o Rodrigo e nao comissionado.
const ESPERADO = {
  '2026-08': { cp: { vendidas: 73, pagas: 68, aguardando: 3, conferir: 2 },
               pp: { vendidas: 59, pagas: 43, aguardando: 16, conferir: 0 } },
  '2026-09': { cp: { vendidas: 14, pagas: 0, aguardando: 14, conferir: 0 },
               pp: { vendidas: 11, pagas: 0, aguardando: 11, conferir: 0 } },
};

// Nenhum registro de teste pode sobrar em grupo nenhum, em periodo nenhum.
const SEM_TESTE_EM_LUGAR_NENHUM = true;

// Os dois casos reais que provaram por que `opiniao()` existe (07/09/2026).
// Marca quem foi achado, para o final do script exigir os dois - se nenhum
// aparecer mais em "conferir", o achado se resolveu sozinho ou o dado mudou,
// e as duas coisas merecem os olhos de alguem, nao um teste calado.
const CASOS_OPINIAO = { '7070': { apelido: 'Amandha', achado: false }, '7130': { apelido: 'Catia', achado: false } };

(async () => {
  console.log('\n=== Painel vendido x pago - ' + PROJETO + ' ===\n');

  // Descobre os ids reais: nao chutar o prefixo da unidade.
  const todos = await db.collection('periodos').get();
  const ids = [];
  todos.forEach(d => { if (/2026-(08|09)$/.test(d.id)) ids.push(d.id); });
  ids.sort();
  console.log('periodos encontrados: ' + ids.join(', ') + '\n');

  for (const periodId of ids) {
    const d = await carregar(periodId);
    console.log('--- ' + periodId + ' ---');
    if (!d) { console.log('  (nao existe)'); continue; }
    if (!d.temLista) {
      console.log('  sem lista de vendas (a tela mostra "nao sei", nunca zero)');
      continue;
    }

    const r = d.resumo;
    console.log('  vendidas ' + r.vendidas + ' | pagas ' + r.pagas
      + ' | aguardando ' + r.aguardando + ' | conferir ' + r.conferir
      + (d.fechado ? '  (mes fechado, converteu ' + Math.round(r.pagas / r.vendidas * 100) + '%)' : '  (mes corrente)'));

    const mes = d.year + '-' + String(d.month).padStart(2, '0');
    const sigla = periodId.replace(/_.*/, '').replace(/^unit-/, '');
    const esp = (ESPERADO[mes] || {})[sigla];
    if (esp) {
      conferir(r.vendidas === esp.vendidas && r.pagas === esp.pagas
        && r.aguardando === esp.aguardando && r.conferir === esp.conferir,
        periodId + ' bate com o plano (esperado ' + JSON.stringify(esp) + ', veio ' + JSON.stringify(r) + ')');
    }

    if (SEM_TESTE_EM_LUGAR_NENHUM) {
      const vazou = [...d.cruzado.pagas, ...d.cruzado.aguardando, ...d.cruzado.conferir]
        .filter(v => VA.ehTeste(v));
      conferir(vazou.length === 0,
        periodId + ': nenhum registro de teste nos tres grupos'
        + (vazou.length ? ' (vazaram: ' + vazou.map(v => v.cliente).join(', ') + ')' : ''));
      if (d.cruzado.testes.length) {
        console.log('  fora da conta por ser teste: '
          + d.cruzado.testes.map(v => v.cliente + '/' + v.contrato).join(', '));
      }
    }

    // 🚨 Nenhuma marcacao humana pode ter escondido um pagamento real.
    const escondidos = (d.cruzado.naoCobrar || []).filter(v => v.pagoEm);
    conferir(escondidos.length === 0,
      periodId + ': nenhuma marcacao escondendo pagamento real'
      + (escondidos.length ? ' (' + escondidos.map(v => v.cliente).join(', ') + ')' : ''));

    const r2 = d.resumo;
    conferir(r2.vendidas === r2.pagas + r2.aguardando + r2.conferir + (r2.naoCobrar || 0),
      periodId + ': vendidas = pagas + aguardando + conferir + naoCobrar');

    if ((d.cruzado.naoCobrar || []).length) {
      console.log('  nao serao cobradas: '
        + d.cruzado.naoCobrar.map(v => v.cliente + ' (' + (v.conferencia?.por || '?') + ')').join(', '));
    }

    // A soma da tabela por vendedora e MAIOR que o total quando ha venda
    // dividida. E de proposito, e o teste guarda os dois lados.
    const somaTabela = Object.values(d.porVendedora).reduce((s, v) => s + v.vendidas, 0);
    conferir(somaTabela >= r.vendidas,
      periodId + ': a tabela por vendedora soma ' + somaTabela + ' >= ' + r.vendidas + ' do mes');

    Object.entries(d.porVendedora).sort((a, b) => b[1].vendidas - a[1].vendidas).forEach(([nome, v]) => {
      const pct = v.naoComissionado ? '(nao comissionado)'
        : (d.fechado ? Math.round(v.pagas / v.vendidas * 100) + '%' : '');
      console.log('    ' + nome.padEnd(28) + String(v.vendidas).padStart(3)
        + ' vendidas · ' + String(v.pagas).padStart(3) + ' pagas  ' + pct);
    });

    // A opiniao do sistema sobre cada venda "a conferir" - e o motivo pelo
    // qual `opiniao()` existe: dar a gestao um palpite sem decidir por ela.
    if (d.cruzado.conferir.length) {
      console.log('  a conferir, com a opiniao do sistema:');
      d.cruzado.conferir.forEach(v => {
        const op = VA.opiniao(v, v.pagamentoQueBateu);
        console.log('    ' + v.cliente + ' (' + v.contrato + '): ' + op.suspeita);
      });
    }

    // 🚨 O achado que justificou o recurso inteiro (07/09/2026): a Amandha
    // (C7070) e a Catia (C7130) pagaram ANTES de a venda existir - R$ 239 em
    // 04/08 e R$ 199 em 12/08, contra contratos anuais de R$ 2.388,00. Se a
    // opiniao delas mudar de `provavelmente_nao_paga`, ou a regra quebrou ou
    // o dado mudou - as duas merecem os olhos de alguem antes de publicar.
    const normalizaContrato = c => String(c || '').replace(/^C/i, '').toUpperCase();
    Object.entries(CASOS_OPINIAO).forEach(([num, caso]) => {
      const v = d.cruzado.conferir.find(x => normalizaContrato(x.contrato) === num);
      if (!v) return; // pode nao estar neste periodo/unidade - cada uma so existe em um
      caso.achado = true;
      const op = VA.opiniao(v, v.pagamentoQueBateu);
      conferir(op.suspeita === 'provavelmente_nao_paga',
        periodId + ': opiniao de ' + caso.apelido + '/C' + num + ' (' + v.cliente + ') e provavelmente_nao_paga'
        + ' (veio ' + op.suspeita + ')');
    });

    const velhas = await arrasto(d.unitId, mes);
    console.log('  arrasto de meses anteriores: ' + velhas.length
      + (velhas.length ? ' (' + velhas.map(v => v.cliente + '/' + v._mes).join(', ') + ')' : ''));

    // O mes de agosto nao pode ter arrasto: e o primeiro mes que o painel le.
    if (mes === PRIMEIRO_MES) {
      conferir(velhas.length === 0,
        periodId + ': agosto nao pode arrastar nada, e o primeiro mes com numeracao da Pacto');
    }
    console.log('');
  }

  // Os dois casos reais tem que ter aparecido em ALGUM periodo. Se nenhum
  // apareceu, o achado sumiu do banco (venda paga, ou marcada) e o teste
  // acima nunca rodou de verdade - silenciosamente inutil e pior que FALHA.
  Object.entries(CASOS_OPINIAO).forEach(([num, caso]) => {
    conferir(caso.achado, 'caso real de opiniao C' + num + ' (' + caso.apelido + ') apareceu em "conferir" em algum periodo');
  });

  console.log('=== ' + ok + '/' + (ok + falhas) + ' ===');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
