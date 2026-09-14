'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Prova do modo sombra contra um mês REAL — dados fora do git
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/conferir-sombra-agosto.js <pasta-com-respostas> "<export faturamento-recebido>" [AAAA-MM]
//
// A pasta tem as respostas do `resumoPeriodo` do mês inteiro de cada unidade,
// salvas na pesquisa de 13/09/2026 (nomes contendo a chave da unidade e
// `01_MM_AAAA_fim_DD_MM_AAAA`). Elas trazem CPF: NUNCA copiar para o repositório.
//
// O que prova: o conversor (`pacto-api-linhas.js`) e a comparação
// (`pacto-sombra-comparacao.js`) reproduzem, sobre o dado real, a conta feita à
// mão na sessão de 13/09 — PP 283 grupos / 253 batem / +R$ 84,66 e
// CP 280 / 265 / −R$ 170,50, que é o −R$ 96,14 da conta à mão menos os
// R$ 74,36 pagos com crédito em conta (o conversor tira; a conta à mão não tirava).
// Resultado de 13/09/2026: bateu nas duas unidades, causa por causa.
//
// Sem o caderninho de contratos (a pesquisa não consultou todos), as linhas de
// contrato saem sem plano: a prova é de DINHEIRO por cliente+dia. As ativações
// impressas aqui não valem — quem prova ativação é a homologação no staging.

const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const L = require(path.join(raiz, 'pacto-api-linhas.js'));
const C = require(path.join(raiz, 'pacto-sombra-comparacao.js'));
const PA = require(path.join(raiz, 'pacto-adapter.js'));
const CE = require(path.join(raiz, 'commission.js'));
const { readXlsx } = require(path.join(__dirname, 'lib-xlsx-min.js'));

const [pasta, exportPath, mesArg] = process.argv.slice(2);
if (!pasta || !exportPath) {
  console.error('Uso: node scripts/conferir-sombra-agosto.js <pasta-respostas> "<export.xls>" [AAAA-MM]');
  process.exit(1);
}
const mes = mesArg || '2026-08';
const [ano, mm] = mes.split('-');
const CHAVES = { PP: '9d4721a873dd9fe621aeed5093b791f8', CP: 'c7b092b1fe873e29436873a01cdfe829' };

const wb = readXlsx(exportPath);
const linhasArquivo = Object.values(wb.sheet(wb.sheetNames ? wb.sheetNames[0] : 'Sheet1'));
const brl = v => (v < 0 ? '−' : '+') + 'R$ ' + Math.abs(v).toFixed(2).replace('.', ',');

for (const unidade of ['PP', 'CP']) {
  const arquivo = fs.readdirSync(pasta).find(f =>
    f.includes('resumoPeriodo') && f.includes(CHAVES[unidade]) && f.includes(`01_${mm}_${ano}_fim_`) && /_\d{2}_\d{2}_\d{4}_e-\.txt$/.test(f)
    && !/fim_(0\d|1[0-5])_/.test(f));
  if (!arquivo) { console.log(`\n${unidade}: resposta do mês inteiro não encontrada em ${pasta}`); continue; }
  let t = fs.readFileSync(path.join(pasta, arquivo), 'utf8');
  const resumo = JSON.parse(t.slice(t.indexOf('{')));

  const m = L.montar({ resumo, contratos: new Map(), unidade, dia: mes });
  const r = C.comparar({ linhasApi: m.linhas, linhasArquivo, mes, unidade, foraApi: m.foraDeProposito, Adapter: PA, Engine: CE, ApiLinhas: L });

  // A conta à mão de 13/09 somou as FORMAS de todos os recibos; o conversor
  // soma as PARCELAS e tira o crédito em conta. Mostra as duas para a
  // diferença ficar explicada, nunca escondida.
  const somaFormas = Math.round(resumo.pagamentos.reduce((s, p) => s + p.formas.reduce((a, f) => a + f.valor, 0), 0) * 100) / 100;
  const credito = m.foraDeProposito.filter(f => /crédito da conta/.test(f.motivo)).reduce((s, f) => s + f.valor, 0);

  console.log(`\n═══ ${unidade} · ${mes} ═══`);
  console.log(`API (parcelas)  R$ ${r.api.recebido.toFixed(2)}   |  soma das formas R$ ${somaFormas.toFixed(2)}  |  crédito em conta tirado R$ ${credito.toFixed(2)}`);
  console.log(`arquivo         R$ ${r.arquivo.recebido.toFixed(2)}`);
  console.log(`grupos cliente+dia ${r.grupos} · batem ${r.batem} · divergem ${r.divergencias.length} · diferença ${brl(r.diferenca)}`);
  console.log(`se o crédito em conta ficasse na API: diferença ${brl(Math.round((r.diferenca + credito) * 100) / 100)}`);
  console.log('por causa:');
  Object.entries(r.porCausa).forEach(([causa, x]) => console.log(`   ${causa.padEnd(40)} ${String(x.qtd).padStart(3)}  ${brl(x.valor)}`));
  console.log(`estornos: ${m.totais.estornos.qtd} recibos R$ ${m.totais.estornos.valor.toFixed(2)} · ${m.totais.estornosContrato.qtd} contratos R$ ${m.totais.estornosContrato.valor.toFixed(2)}`);
}
