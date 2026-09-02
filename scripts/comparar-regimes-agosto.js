// ═══════════════════════════════════════════════════════════════
// Agosto/2026 nos DOIS regimes, sobre o mesmo arquivo — a comparação
// que o Rodrigo pediu em 01/09 para apresentar ao time comercial
// ═══════════════════════════════════════════════════════════════
//
//   node scripts/comparar-regimes-agosto.js
//
// SOMENTE LEITURA. Não fala com o Firebase e não escreve planilha.
//
// COMO SIMULA A COMPETÊNCIA: troca a Data Lançamento (recebimento) pela Data
// Início (venda) e roda o mesmo tradutor. Efeito colateral esperado e correto:
// migrado e RECEBIMENTO TECNOFIT saem sozinhos, porque a data de início deles é
// antiga e o filtro de mês já os exclui — não é falha do filtro.
//
// ⚠️ P1 e P2 só. P3 e P4 dependem da meta da unidade no mês (metasMensais), que
//    mora no sistema — a config padrão daqui NÃO vale para eles.
//
'use strict';
// Compara o fechamento de agosto nos dois regimes, sobre o MESMO arquivo.
//   CAIXA       = mês do recebimento (Data Lançamento)   → regra nova
//   COMPETENCIA = mês da venda (Data Início do contrato) → regra antiga
const { readXlsx } = require('./lib-xlsx-min.js');
const PA = require('../pacto-adapter.js');
const CE = require('../commission.js');

const ARQ = 'relatorios pacto/faturamento-recebido_6d85c17be56a3354e9142649a1c0a830_20260901_213346.xls';
const MES = '2026-08';
const brl = n => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const wb = readXlsx(ARQ);
const aba = wb.sheet(wb.sheetNames[0]);
const linhas = Object.keys(aba).map(Number).sort((a,b)=>a-b).map(k => aba[k]);

// COMPETÊNCIA: troca Data Lançamento (col 14) pela Data Início (col 8).
// Avulso/bar/loja não tem início — a competência dele É o recebimento.
const comoCompetencia = ls => ls.map((l,i) => {
  if (i === 0) return l;
  const c = l.slice();
  if (/\d{2}\/\d{2}\/\d{4}/.test(String(c[8]||''))) c[14] = c[8];
  return c;
});

function rodar(ls) {
  const r = PA.traduzir(ls, { mes: MES });
  const out = { un: {}, total: 0, ativ: 0, migrados: (r.migrados||[]).length, descartadas: (r.descartadas||[]).length };
  ['CP','PP'].forEach(u => {
    const vendas = (r.porUnidade[u]||[]).map(v => { const o={}; PA.CABECALHO_SAIDA.forEach(h=>o[h]=v[h]); return o; });
    if (!vendas.length) return;
    const res = CE.calculate(vendas, CE.defaultConfig, {});
    const porV = {}; let tot=0, ativ=0;
    Object.entries(res.vendorData).forEach(([nome,d]) => {
      if (d.isNaoCom) return;
      const t = (d.p1total||0)+(d.p2total||0);
      if (!t && !d.ativacoes) return;
      porV[nome] = { p1:d.p1total||0, p2:d.p2total||0, ativ:d.ativacoes||0, t };
      tot += t; ativ += d.ativacoes||0;
    });
    out.un[u] = { porV, tot, ativ, linhas: vendas.length, contadas: res.processed.length, excluidas: res.excluded.length };
    out.total += tot; out.ativ += ativ;
  });
  return out;
}

const A = rodar(linhas);                    // caixa
const B = rodar(comoCompetencia(linhas));   // competência

[['CAIXA — regra nova', A], ['COMPETÊNCIA — regra antiga', B]].forEach(([rot, r]) => {
  console.log(`\n═══ ${rot} ═══  ${brl(r.total)} · ${r.ativ} ativações · migrados fora ${r.migrados} · descartadas ${r.descartadas}`);
  Object.entries(r.un).forEach(([u,d]) => {
    console.log(`  ${u}: ${brl(d.tot)} · ${d.ativ} ativações · ${d.contadas} contadas / ${d.excluidas} excluídas`);
    Object.entries(d.porV).sort((a,b)=>b[1].t-a[1].t).forEach(([n,x])=>
      console.log(`      ${n.padEnd(26)} ${String(x.ativ).padStart(3)} ativ  P1 ${brl(x.p1).padStart(11)}  P2 ${brl(x.p2).padStart(10)}  = ${brl(x.t)}`));
  });
});

console.log('\n═══ DIFERENÇA POR VENDEDORA (caixa − competência) ═══');
['CP','PP'].forEach(u => {
  const nomes = new Set([...Object.keys(A.un[u]?.porV||{}), ...Object.keys(B.un[u]?.porV||{})]);
  if (!nomes.size) return;
  console.log(`  -- ${u} --`);
  [...nomes].sort().forEach(n => {
    const a = A.un[u]?.porV[n] || {t:0,ativ:0}, b = B.un[u]?.porV[n] || {t:0,ativ:0};
    const d = a.t - b.t, da = a.ativ - b.ativ;
    console.log(`     ${n.padEnd(26)} caixa ${brl(a.t).padStart(11)} (${String(a.ativ).padStart(2)})  ×  comp ${brl(b.t).padStart(11)} (${String(b.ativ).padStart(2)})   ${d>=0?'+':'−'}${brl(Math.abs(d))}  ${da>=0?'+':'−'}${Math.abs(da)} ativ`);
  });
});
console.log(`\n  TOTAL  caixa ${brl(A.total)} (${A.ativ} ativ)  ×  competência ${brl(B.total)} (${B.ativ} ativ)`);
console.log(`  DIFERENÇA: ${A.total-B.total>=0?'+':'−'}${brl(Math.abs(A.total-B.total))}  ·  ${A.ativ-B.ativ>=0?'+':'−'}${Math.abs(A.ativ-B.ativ)} ativações`);
