'use strict';
// ═══════════════════════════════════════════════════════════════
// Traduz o export da Pacto para as planilhas que o módulo já ingere
// ═══════════════════════════════════════════════════════════════
//
//   node scripts/traduzir-export-pacto.js "relatorios pacto/faturamento-recebido_....xls" 2026-08
//
// Sem o mês, usa o mais recente do arquivo. `--saida <pasta>` muda onde grava
// (padrão: a mesma pasta do arquivo de entrada).
//
// Gera `PACTO-<mês>-CP.xlsx` e `PACTO-<mês>-PP.xlsx` para subir na tela de
// Comissões (Upload), uma por unidade — as metas são por unidade.
//
// Não fala com o Firebase e não escreve nada no sistema: gera arquivo e
// relatório. A conferência acontece ANTES de subir.
//
// ⚠️ USAR O `faturamento-recebido`, não o "Faturamento por Período": os dois
//    têm as MESMAS colunas, mas o segundo traz o contrato inteiro (12× num
//    anual). O script recusa o errado sozinho.
// ⚠️ Rodar `node scripts/medir-export-pacto.js <arquivo>` antes: a qualidade do
//    relatório muda mês a mês conforme a base migrada do TecnoFit rola.

const fs = require('fs');
const path = require('path');
const { readXlsx } = require(path.join(__dirname, 'lib-xlsx-min.js'));
const { escreverXlsx } = require(path.join(__dirname, 'lib-xlsx-write.js'));
const PA = require(path.join(__dirname, '..', 'pacto-adapter.js'));
const CE = require(path.join(__dirname, '..', 'commission.js'));

const args = process.argv.slice(2);
const posicionais = args.filter(a => !a.startsWith('--'));
const arquivo = posicionais[0];
const mes = posicionais[1];
const iSaida = args.indexOf('--saida');
if (!arquivo) {
  console.error('uso: node scripts/traduzir-export-pacto.js <export.xls> [AAAA-MM] [--saida <pasta>] [--pagar-migrados] [--forcar]');
  process.exit(1);
}
const pastaSaida = iSaida >= 0 ? args[iSaida + 1] : path.dirname(arquivo);

const brl = n => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const titulo = t => console.log('\n' + t + '\n' + '─'.repeat(t.length));

// ─── 1. Ler o export (apesar do .xls, é zip/xlsx de verdade) ───
const wb = readXlsx(arquivo);
const aba = wb.sheet(wb.sheetNames[0]);
const linhas = Object.keys(aba).map(Number).sort((a, b) => a - b).map(k => aba[k]);

// ─── 2. Traduzir ───
const pagarMigrados = args.includes('--pagar-migrados');
const r = PA.traduzir(linhas, { mes, pagarMigrados });

console.log('ARQUIVO : ' + path.basename(arquivo));

// ⚠️ A Pacto tem DOIS relatórios com as MESMAS 21 colunas nas mesmas posições.
// Só o `faturamento-recebido` serve: o outro traz o contrato inteiro em vez da
// parcela que entrou (12× num anual), e o motor paga 5% sobre esse valor.
if (r.relatorio !== 'recebido' && !args.includes('--forcar')) {
  console.error('\n🛑 ARQUIVO ERRADO — este parece ser o "Relatório Faturamento por Período".');
  console.error('   Ele tem as mesmas colunas do certo, mas o valor é o CONTRATO INTEIRO,');
  console.error('   não a parcela que entrou: num plano anual dá 12× a mais. Como a comissão');
  console.error('   é 5% do valor quitado, subir este arquivo pagaria R$ 155 em vez de R$ 12,95');
  console.error('   por contrato anual — e nada na tela acusaria o erro.');
  console.error('\n   Como reconheci: a coluna "Forma Pagamento" veio vazia em todas as linhas.');
  console.error('\n   ✅ Use o relatório "Faturamento Recebido" (arquivo faturamento-recebido_*.xls).');
  console.error('   (--forcar ignora este bloqueio, se você souber o que está fazendo.)\n');
  process.exit(1);
}
console.log('RELATÓRIO: ' + r.relatorio + (r.relatorio === 'recebido' ? ' ✅' : ' ⚠️ FORÇADO'));
console.log('MESES   : ' + JSON.stringify(r.meses));
console.log('MÊS     : ' + r.mes + '  →  ' + r.vendas.length + ' linhas traduzidas');
if (!r.vendas.length) { console.error('\nNada para traduzir nesse mês.'); process.exit(1); }

// ─── 3. Gravar uma planilha por unidade ───
titulo('PLANILHAS GERADAS');
const gerados = [];
['CP', 'PP'].forEach(u => {
  const vendas = r.porUnidade[u] || [];
  if (!vendas.length) { console.log('  ' + u + ': nenhuma linha'); return; }
  const destino = path.join(pastaSaida, 'PACTO-' + r.mes + '-' + u + '.xlsx');
  escreverXlsx(destino, 'Vendas ' + u, [PA.CABECALHO_SAIDA, ...PA.paraPlanilha(vendas)]);
  gerados.push(destino);
  console.log('  ' + u + ': ' + vendas.length + ' linhas → ' + destino);
});
if ((r.porUnidade[''] || []).length) {
  console.log('  ⚠️ ' + r.porUnidade[''].length + ' linhas SEM unidade reconhecida ficaram de fora das planilhas');
}

// ─── 4. Simular no motor real, pra conferir antes de subir ───
// Usa a configuração padrão. Metas, super-meta e não-comissionáveis de cada
// unidade moram no sistema (`units/{id}`) — então P3 e P4 aqui são só indicativos.
// P1 e P2 não dependem de meta e valem como conferência de verdade.
titulo('SIMULAÇÃO (P1 + P2, configuração padrão)');
let totalGeral = 0;
['CP', 'PP'].forEach(u => {
  const vendas = (r.porUnidade[u] || []).map(v => {
    const o = {}; PA.CABECALHO_SAIDA.forEach(h => o[h] = v[h]); return o;
  });
  if (!vendas.length) return;
  const res = CE.calculate(vendas, CE.defaultConfig, {});
  const linhasVend = Object.entries(res.vendorData)
    .map(([nome, d]) => ({ nome, p1: d.p1total, p2: d.p2total, ativ: d.ativacoes, naoCom: d.isNaoCom }))
    .filter(x => x.p1 || x.p2 || x.ativ)
    .sort((a, b) => (b.p1 + b.p2) - (a.p1 + a.p2));

  console.log('\n  ' + u + ' — ' + res.processed.length + ' vendas contadas, '
    + res.excluded.length + ' excluídas pelo motor');
  console.log('  ' + 'VENDEDORA'.padEnd(28) + 'ATIV'.padStart(6) + 'P1'.padStart(13) + 'P2'.padStart(13) + 'TOTAL'.padStart(14));
  let sub = 0;
  linhasVend.forEach(x => {
    const t = x.p1 + x.p2; sub += t;
    console.log('  ' + (x.nome + (x.naoCom ? ' (não com.)' : '')).padEnd(28)
      + String(x.ativ).padStart(6) + brl(x.p1).padStart(13) + brl(x.p2).padStart(13) + brl(t).padStart(14));
  });
  console.log('  ' + ''.padEnd(28) + ''.padStart(6) + ''.padStart(13) + 'SUBTOTAL'.padStart(13) + brl(sub).padStart(14));
  totalGeral += sub;

  // Por que o motor excluiu cada linha — é aqui que se vê renovação automática
  const motivos = {};
  res.excluded.forEach(e => { const m = e.excludeReason || e.reason || '?'; motivos[m] = (motivos[m] || 0) + 1; });
  Object.entries(motivos).sort((a, b) => b[1] - a[1])
    .forEach(([m, q]) => console.log('    excluídas · ' + m + ': ' + q));
});
console.log('\n  TOTAL P1+P2 (CP+PP): ' + brl(totalGeral));

// ─── 5. O que precisa de olho humano ───
titulo('CONFERIR — planos presumidos (' + r.marcadas.length + ')');
if (!r.marcadas.length) console.log('  nenhum');
else {
  console.log('  Contratos migrados do TecnoFit que perderam o nome do plano.');
  console.log('  A periodicidade veio da Duração; LOCAL foi assumido (decisão de 25/08).');
  console.log('  Erra em ~7% dos anuais, R$ 15 de bônus cada. Marcados com '
    + PA.MARCA_PRESUMIDO + ' na planilha.\n');
  console.log('  ' + 'CLIENTE'.padEnd(34) + 'VENDEDORA'.padEnd(24) + 'VALOR'.padStart(12) + '  PLANO PRESUMIDO');
  r.marcadas.forEach(v => console.log('  ' + v['Cliente'].slice(0, 33).padEnd(34)
    + (v['Vendedor'] || '—').slice(0, 23).padEnd(24)
    + brl(v['Valor Quitado/Recibo']).padStart(12) + '  '
    + v['Itens'].replace(' ' + PA.MARCA_PRESUMIDO, '').replace(/\s*\(.*\)$/, '')));
}

titulo('⚠️ CONTRATOS MIGRADOS DO TECNOFIT (' + r.migrados.length + ')'
  + (pagarMigrados ? ' — INCLUÍDOS por --pagar-migrados' : ' — FORA da planilha'));
if (!r.migrados.length) console.log('  nenhum');
else {
  const soma = r.migrados.reduce((s, m) => s + m.valor, 0);
  const bonus = r.migrados.reduce((s, m) => {
    const d = parseInt(m.duracao, 10);
    return s + (d === 24 ? 80 : d >= 12 ? 30 : d === 1 ? 20 : 0);
  }, 0);
  console.log('  Contratos que já existiam e só entraram na Pacto agora: a data de');
  console.log('  lançamento é o dia da carga, mas o contrato começou lá atrás.');
  console.log('  Se contassem como venda do mês, pagariam ativação e bônus de novo.');
  console.log('  ✅ Confirmado em 25/08 cruzando com o "Faturamento por Período":');
  console.log('     dos 62 migrados, 50 nem aparecem lá e os 12 restantes são');
  console.log('     cancelamento ou ajuste de R$ 0,00 — nenhum é venda do mês.\n');
  r.migrados.slice(0, 60).forEach(m => console.log('  ' + m.cliente.slice(0, 33).padEnd(34)
    + brl(m.valor).padStart(12) + '   começou em ' + m.inicio + '   dur ' + m.duracao));
  if (r.migrados.length > 60) console.log('  … e mais ' + (r.migrados.length - 60));
  console.log('\n  soma: ' + brl(soma) + '   → em jogo: ~' + brl(bonus) + ' de bônus + '
    + brl(soma * 0.05) + ' de 5% = ~' + brl(bonus + soma * 0.05));
  console.log('  (--pagar-migrados inclui, se o Rodrigo disser que é dinheiro novo)');
}

titulo('DESCARTADAS (' + r.descartadas.length + ')');
if (!r.descartadas.length) console.log('  nenhuma');
else {
  const soma = r.descartadas.reduce((s, d) => s + d.valor, 0);
  r.descartadas.slice(0, 30).forEach(d =>
    console.log('  ' + d.cliente.slice(0, 33).padEnd(34) + brl(d.valor).padStart(12) + '  ' + d.motivo));
  if (r.descartadas.length > 30) console.log('  … e mais ' + (r.descartadas.length - 30));
  console.log('  soma: ' + brl(soma));
}

titulo('AVISOS (' + r.avisos.length + ')');
if (!r.avisos.length) console.log('  nenhum');
else {
  const porMotivo = {};
  r.avisos.forEach(a => (porMotivo[a.motivo] = porMotivo[a.motivo] || []).push(a));
  Object.entries(porMotivo).forEach(([m, lista]) => {
    console.log('\n  ' + m + ' (' + lista.length + ')');
    lista.slice(0, 15).forEach(a => console.log('    · ' + (a.cliente || '').slice(0, 33).padEnd(34)
      + (a.valor !== undefined ? brl(a.valor).padStart(12) : '')
      + (a.comQuem ? '  → dividir com ' + a.comQuem : '')
      + (a.produto ? '  ' + a.produto : '') + (a.resp1 ? '  [resp: ' + a.resp1 + ' / ' + a.resp2 + ']' : '')
      + (a.empresa ? '  [' + a.empresa + ']' : '')));
    if (lista.length > 15) console.log('    … e mais ' + (lista.length - 15));
  });
}

titulo('PRÓXIMO PASSO');
gerados.forEach(g => console.log('  subir em Comissões → Upload: ' + path.basename(g)));
console.log('  (conferir antes a lista de planos presumidos acima)');
