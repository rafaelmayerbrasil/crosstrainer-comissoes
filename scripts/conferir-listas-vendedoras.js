'use strict';
// ===================================================================
// Confere as listas manuais das vendedoras contra o fechamento
// ===================================================================
//
//   node scripts/conferir-listas-vendedoras.js
//
// SOMENTE LEITURA. Nao toca no Firestore. Le o export `faturamento-recebido`
// da Pacto (agosto/2026 fechado).
//
// POR QUE EXISTE (07/09/2026): o Rodrigo mandou as listas de ativacoes que a
// Barbara e a Kali anotaram na mao, para bater com o fechamento de agosto. O
// cruzamento achou um defeito no tradutor:
//
//   `PactoAdapter.ehAutomatica` marcava "renovacao automatica" quando a coluna
//   `Responsavel 2` dizia RECORRENCIA. Na Pacto isso significa "a cobranca saiu
//   no cartao recorrente" — NAO significa "ninguem vendeu". Em agosto a regra
//   jogou fora 22 linhas de contrato; conferindo uma a uma contra as planilhas
//   de julho (que tem a coluna `Origem` de verdade), 15 sao venda humana e so
//   7 sao cobranca do robo.
//
// A lista ROBO abaixo e o resultado dessa conferencia manual — vale para
// AGOSTO/2026 e so. Nao e a regra nova: e o remendo que permite fechar o mes.
const path = require('path');
const { readXlsx } = require(path.join(__dirname, 'lib-xlsx-min.js'));
const PA = require(path.join(__dirname, '..', 'pacto-adapter.js'));
const CE = require(path.join(__dirname, '..', 'commission.js'));

const RAIZ = path.join(__dirname, '..');
const EXPORT_AGOSTO = path.join(RAIZ, 'relatorios pacto',
  'faturamento-recebido_6d85c17be56a3354e9142649a1c0a830_20260901_213346.xls');

const brl = n => 'R$ ' + Number(n || 0).toFixed(2);

// Metas de agosto aprovadas pelo Rodrigo em 07/09/2026 (respostas 1 e 2)
const METAS = {
  CP: { meta: 50, superMeta: 57, metaGold: 65, minNovos: 18, minRenov: 13, minVoucher: 6 },
  PP: { meta: 28, superMeta: 32, metaGold: 37, minNovos: 15, minRenov: 9, minVoucher: 4, minAtivacoesIndivP3: 7 },
};

// Cobranca do robo DE VERDADE em agosto — confirmado contra as planilhas de julho
const ROBO = [
  ['PEDRO HENRIQUE SCHONARTH', '309'], // julho pagou o mesmo recorrente
  ['FLÁVIA LOCKS', '329'],             // julho ja veio com Origem = Renovacao automatica
  ['CAROLINE MULLER', '379'],          // idem
  ['JAIR COIMBRA', '199'],             // 2a parcela do anual vendido em julho
  ['ANA CAROLINA SILVA', '199'],       // mesmo contrato ja pago em julho
  ['MARTHA HELENA', '199'],            // idem
  ['DANIELE DA CUNHA', '199'],         // idem
];
const ehRoboDeVerdade = l => {
  const nome = String(l[2] || '').toUpperCase();
  return ROBO.some(([n, v]) => nome.includes(n) && String(l[15]).startsWith(v));
};

// Vendas que estao no nome do RODRIGO na Pacto e que a Kali/Barbara reivindicam
const REATRIBUIR = {
  'ANTHONY ENGEL': 'KALI DUTRA', 'JOSE PINHEIRO LEMOS': 'KALI DUTRA',
  'FLÁVIA DEL CAMPO': 'KALI DUTRA', 'KIRILL SOBOLEV': 'KALI DUTRA',
  'JACQUELINE COSTA': 'KALI DUTRA', 'HUGO SIEDLER DIAS': 'KALI DUTRA',
  'ANTÚRIO PAIVA RODRIGUES': 'KALI DUTRA',
  'WILLIAM CASAGRANDE': 'BÁRBARA VIEIRA CARDOSO', 'FELIPE AUGUSTO ZAGO': 'BÁRBARA VIEIRA CARDOSO',
};

const wb = readXlsx(EXPORT_AGOSTO);
const aba = wb.sheet(wb.sheetNames[0]);
const LINHAS = Object.keys(aba).map(Number).sort((a, b) => a - b).map(k => aba[k]);

// A regra ANTIGA nao existe mais no tradutor (foi o defeito). Para poder
// mostrar o "antes", ela e reconstruida AQUI, a partir do arquivo cru — assim
// esta conferencia nao depende de como o adapter esta hoje.
const chave = l => [String(l[2] || '').trim().toUpperCase(), String(l[14] || ''), String(l[15] || '')].join('|');
const chaveVenda = v => [String(v['Cliente'] || '').trim().toUpperCase(), String(v['Data'] || ''),
  Number(v['Valor Quitado/Recibo'] || 0).toFixed(2).replace('.', ',')].join('|');
const RECORRENTES = new Set(LINHAS.filter(l => l && String(l[5] || '').toUpperCase() === 'RECORRENCIA').map(chave));
const ROBO_CHAVES = new Set(LINHAS.filter(l => l && ehRoboDeVerdade(l)).map(chave));

/**
 * Roda o mes inteiro.
 * modo: 'hoje'    = como era antes da correcao (toda RECORRENCIA fora)
 *       'so-robo' = so as 7 cobrancas de robo conferidas ficam fora
 */
function rodar(un, cfgMeta, modo, reatribuir) {
  const r = PA.traduzir(LINHAS, { mes: '2026-08' });
  const vendas = (r.porUnidade[un] || []).map(v => {
    const o = {}; PA.CABECALHO_SAIDA.forEach(h => o[h] = v[h]);
    const k = chaveVenda(v);
    const fora = modo === 'hoje' ? RECORRENTES.has(k) : ROBO_CHAVES.has(k);
    if (fora) o['Origem'] = 'Renovação automática';
    if (reatribuir) {
      const nv = REATRIBUIR[String(o['Cliente']).toUpperCase()];
      if (nv && o['Vendedor'] === 'RODRIGO') o['Vendedor'] = nv;
    }
    return o;
  });
  return CE.calculate(vendas, { ...CE.defaultConfig, ...(cfgMeta || {}) }, {});
}

function tabela(rot, usaMeta, modo, reatribuir) {
  console.log('\n=== ' + rot + ' ===');
  const porPessoa = {}; let total = 0;
  for (const un of ['CP', 'PP']) {
    const res = rodar(un, usaMeta ? METAS[un] : null, modo, reatribuir);
    const ut = res.unitTotals;
    console.log('  ' + un + ': ' + ut.unitAtivacoes + ' ativacoes (novos/ret ' + ut.unitNovosRetorno +
      ' · renov ' + ut.unitRenovacoes + ' · voucher ' + ut.unitVouchers + ') · caixa ' + brl(ut.unitCaixa));
    Object.entries(res.vendorData).forEach(([n, v]) => {
      if (v.isNaoCom) return;
      const t = v.p1total + v.p2total + v.p3 + (v.p4individual || 0) + (v.p4pool || 0);
      porPessoa[n] = (porPessoa[n] || 0) + t; total += t;
    });
  }
  Object.keys(porPessoa).sort().forEach(n => console.log('     ' + n.padEnd(24) + brl(porPessoa[n]).padStart(12)));
  console.log('     ' + 'FOLHA'.padEnd(24) + brl(total).padStart(12));
  return { porPessoa, total };
}

console.log('AGOSTO/2026 — as quatro leituras do mesmo mes');
const A = tabela('A) como esta no sistema hoje (meta padrao)', false, 'hoje', false);
const B = tabela('B) + as metas que o Rodrigo aprovou em 07/09', true, 'hoje', false);
const C = tabela('C) + so a cobranca do robo fica de fora (corrige o defeito)', true, 'so-robo', false);
const D = tabela('D) + reatribuir o que a Kali e a Barbara reivindicam', true, 'so-robo', true);

console.log('\n=== o que cada correcao vale, por pessoa ===');
const nomes = [...new Set([...Object.keys(B.porPessoa), ...Object.keys(D.porPessoa)])].sort();
console.log('  ' + 'pessoa'.padEnd(24) + 'A (hoje)'.padStart(13) + 'B (metas)'.padStart(14) + 'C (corrigido)'.padStart(15) + 'D (+reatrib)'.padStart(14));
nomes.forEach(n => console.log('  ' + n.padEnd(24) + brl(A.porPessoa[n] || 0).padStart(13) +
  brl(B.porPessoa[n] || 0).padStart(14) + brl(C.porPessoa[n] || 0).padStart(15) + brl(D.porPessoa[n] || 0).padStart(14)));
console.log('  ' + 'FOLHA'.padEnd(24) + brl(A.total).padStart(13) + brl(B.total).padStart(14) +
  brl(C.total).padStart(15) + brl(D.total).padStart(14));

console.log('\n=== as linhas que a regra ANTIGA jogava fora em agosto ===');
for (const un of ['CP', 'PP']) {
  const res = rodar(un, METAS[un], 'hoje', false);
  res.excluded.filter(i => i.excludeReason === 'Renovação automática').forEach(i => {
    const robo = ROBO_CHAVES.has(chaveVenda({ Cliente: i.cliente, Data: i.data, 'Valor Quitado/Recibo': i.valorCaixa }));
    console.log('  ' + un + ' ' + i.data + ' ' + String(i.cliente).padEnd(34).slice(0, 34) +
      brl(i.valorCaixa).padStart(11) + '  ' + (robo ? 'robo — fica fora' : 'VENDA DE VERDADE — deve entrar') + '  (' + i.vendedor + ')');
  });
}

console.log('\n=== os 7 contratos que precisam entrar em codigosPagos de JULHO ===');
LINHAS.filter(l => l && ehRoboDeVerdade(l) && String(l[5] || '').toUpperCase() === 'RECORRENCIA').forEach(l => {
  console.log('  C' + l[7] + '  ' + String(l[2]).padEnd(34).slice(0, 34) +
    (String(l[18]).includes('(CP)') ? 'CP' : 'PP') + '  ' + l[14] + '  R$ ' + l[15]);
});

console.log('\n=== ativacoes no nome do RODRIGO (nao pagam comissao a ninguem) ===');
for (const un of ['CP', 'PP']) {
  const res = rodar(un, METAS[un], 'so-robo', false);
  res.processed.filter(i => i.isActivation && i.vendedor === 'RODRIGO').forEach(i => {
    const q = REATRIBUIR[String(i.cliente).toUpperCase()];
    console.log('  ' + un + ' ' + i.data + ' ' + String(i.cliente).padEnd(36).slice(0, 36) +
      String(i.tipoVenda).padEnd(14) + brl(i.valorCaixa).padStart(11) + (q ? '   <- ' + q + ' reivindica' : ''));
  });
}
