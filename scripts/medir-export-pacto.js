'use strict';
// ═══════════════════════════════════════════════════════════════
// Medidor do export `faturamento-recebido` da Pacto
// ═══════════════════════════════════════════════════════════════
// Produziu TODOS os números do desenho do tradutor
// (docs/superpowers/specs/2026-08-19-tradutor-pacto-comissoes-design.md).
// Existe pra poder repetir a medição num export novo antes de confiar nele —
// o relatório muda de qualidade mês a mês conforme a base migrada rola.
//
//   node scripts/medir-export-pacto.js "carga nova comissoes/faturamento-recebido_....xls" [AAAA-MM]
//
// Sem o mês, mede o mês mais recente que o arquivo contiver.
//
// ⚠️ Apesar da extensão `.xls`, os arquivos da Pacto são zip/xlsx de verdade.
// ⚠️ `sheet()` do lib-xlsx-min devolve OBJETO indexado por linha, não array.
// ⚠️ O cabeçalho tem `Responsável` DUPLICADO (posições 4 e 5) — ler por posição,
//    nunca por nome, senão uma das duas colunas some.

const path = require('path');
const { readXlsx } = require(path.join(__dirname, 'lib-xlsx-min.js'));

// Posições no export (o arquivo tem uma coluna vazia na frente, por isso começa em 1)
const P = {
  matricula: 1, nome: 2, cadastro: 3,
  resp1: 4,        // quem LANÇOU no sistema
  resp2: 5,        // quem GEROU o lançamento — `RECORRENCIA` = o robô, sem gente
  produto: 6, contrato: 7, inicio: 8, termino: 9, duracao: 10,
  modalidades: 11, plano: 12, situacao: 13, lancamento: 14,
  valor: 15, forma: 16, condicao: 17, empresa: 18,
  turma: 19, categoria: 20,
  consultor: 21,   // quem VENDEU — é este que vale pra comissão
};

const g = (r, k) => String(r[P[k]] || '').trim();
const mesDe = d => (String(d || '').match(/^\d{2}\/(\d{2})\/(\d{4})/) || []).slice(1).reverse().join('-');
const contar = arr => arr.reduce((a, x) => (a[x || '(vazio)'] = (a[x || '(vazio)'] || 0) + 1, a), {});
const pct = (n, total) => total ? Math.round((100 * n) / total) + '%' : '—';

// Predicados que o tradutor vai usar — a definição mora aqui e no adapter
const ehImportacao   = r => g(r, 'plano').toUpperCase().includes('IMPORTA');
const ehAutomatica   = r => g(r, 'resp2').toUpperCase() === 'RECORRENCIA';
const ehCartaoRecorr = r => g(r, 'forma').toUpperCase().includes('RECORRENTE');
const ehRecebTecnofit= r => g(r, 'forma').toUpperCase().includes('TECNOFIT');
const ehContrato     = r => g(r, 'contrato') && g(r, 'contrato') !== '0';

function medir(arquivo, mesAlvo) {
  const wb = readXlsx(arquivo);
  const sheet = wb.sheet(wb.sheetNames[0]);
  const linhas = Object.keys(sheet).map(Number).sort((a, b) => a - b);
  const todas = linhas.slice(1).map(k => sheet[k]).filter(r => r && g(r, 'nome'));

  const porMes = contar(todas.map(r => mesDe(g(r, 'lancamento'))));
  const mes = mesAlvo || Object.keys(porMes).filter(m => m !== '(vazio)').sort().pop();
  const rows = todas.filter(r => mesDe(g(r, 'lancamento')) === mes);

  console.log('ARQUIVO :', path.basename(arquivo));
  console.log('LINHAS  :', todas.length, '| por mês de Data Lançamento:', JSON.stringify(porMes));
  console.log('MEDINDO :', mes, '→', rows.length, 'linhas\n');
  if (!rows.length) return;

  // ── Qual dos dois relatórios é este? ──
  // `faturamento` e `faturamento-recebido` têm as MESMAS 21 colunas nas mesmas
  // posições, mas o primeiro traz o contrato inteiro (12× num anual). O sinal é
  // a Forma Pagamento: 100% preenchida no recebido, 100% vazia no faturamento.
  const comForma = rows.filter(r => g(r, 'forma')).length;
  console.log('── QUAL RELATÓRIO ──');
  console.log('  Forma Pagamento preenchida:', comForma, 'de', rows.length,
    comForma ? '→ faturamento-RECEBIDO ✅ (é este que serve)'
             : '→ 🛑 "Faturamento por Período": valor é o CONTRATO INTEIRO, NÃO usar pra comissão');

  // ── Lacuna 1: a vendedora ──
  const semConsultor = rows.filter(r => !g(r, 'consultor'));
  const ambos = rows.filter(r => g(r, 'consultor') && g(r, 'resp1'));
  const concordam = ambos.filter(r => g(r, 'consultor').toUpperCase() === g(r, 'resp1').toUpperCase());
  console.log('\n── VENDEDORA ──');
  console.log('  Consultor vazio :', semConsultor.length, pct(semConsultor.length, rows.length));
  console.log('    desses, bar/loja+avulso (Contrato=0):', semConsultor.filter(r => !ehContrato(r)).length);
  console.log('    desses, IMPORTAÇÃO                  :', semConsultor.filter(ehImportacao).length);
  console.log('    → contratos REALMENTE órfãos        :', semConsultor.filter(r => ehContrato(r) && !ehImportacao(r)).length);
  console.log('  Consultor × Responsável#1 concordam:', concordam.length, 'de', ambos.length, pct(concordam.length, ambos.length),
              '← se for baixo, Responsável NÃO serve de reserva');

  // ── Lacuna 2: automática × trabalhada (renovação automática não paga) ──
  const auto = rows.filter(ehAutomatica);
  const cartao = rows.filter(ehCartaoRecorr);
  console.log('\n── AUTOMÁTICA × TRABALHADA ──');
  console.log('  Responsável#2 = RECORRENCIA :', auto.length, '← este é o sinal bom');
  console.log('  Forma = CARTÃO RECORRENTE   :', cartao.length, '← cartão salvo, NÃO é o sinal');
  console.log('  RECORRENCIA fora do cartão  :', rows.filter(r => ehAutomatica(r) && !ehCartaoRecorr(r)).length,
              '(esperado 0 — RECORRENCIA deve ser subconjunto)');
  console.log('  vendas que se perderiam usando a forma de pagamento:',
              rows.filter(r => !ehAutomatica(r) && ehCartaoRecorr(r)).length);

  // ── Lacuna 3: o nome do plano ──
  const contratos = rows.filter(ehContrato);
  const imp = contratos.filter(ehImportacao);
  console.log('\n── NOME DO PLANO ──');
  console.log('  linhas de contrato :', contratos.length, '| avulso/produto:', rows.length - contratos.length);
  console.log('  IMPORTAÇÃO         :', imp.length, 'de', contratos.length, 'contratos', pct(imp.length, contratos.length),
              '← perdem LOCAL × FLEX (R$ 15 de P2 cada)');
  console.log('  Duração dos IMPORTAÇÃO:', JSON.stringify(contar(imp.map(r => g(r, 'duracao')))),
              '(12=anual 24=bianual 1=mensal/recorrente; 13/14 = anual com brinde)');
  console.log('  desses, começaram FORA do mês (migração):',
              imp.filter(r => mesDe(g(r, 'inicio')) && mesDe(g(r, 'inicio')) !== mes).length,
              '← não são venda do mês');

  // ── Agrupamento: a taxa de matrícula vem em linha separada do plano ──
  const porContrato = contratos.reduce((a, r) => ((a[g(r, 'contrato')] = a[g(r, 'contrato')] || []).push(r), a), {});
  const multi = Object.values(porContrato).filter(v => v.length > 1).length;
  console.log('\n── AGRUPAMENTO ──');
  console.log('  contratos distintos:', Object.keys(porContrato).length, '| com mais de uma linha:', multi,
              '← sem agrupar viram ativações duplicadas');

  // ── Lixo a descartar ──
  console.log('\n── DESCARTAR ──');
  console.log('  RECEBIMENTO TECNOFIT:', rows.filter(ehRecebTecnofit).length, '← recebimento antigo, não é venda nova');
  console.log('  QUITAÇÃO DE CANCELAMENTO:', rows.filter(r => /QUITA/i.test(g(r, 'produto')) && /CANCELAMENTO/i.test(g(r, 'produto'))).length,
              '← acerto de contrato cancelado');

  // ── Grafia quebrada: mata o word boundary do detectPeriodicidade() ──
  const suspeitos = [...new Set(contratos.map(r => g(r, 'plano')))]
    .filter(p => p && !p.toUpperCase().includes('IMPORTA') && /MENSA\s+L|\.\-|\s{2,}/.test(p));
  console.log('\n── GRAFIA QUEBRADA (quebra detectPeriodicidade) ──');
  suspeitos.length ? suspeitos.forEach(p => console.log('  "' + p + '"')) : console.log('  nenhuma');

  console.log('\n── UNIDADE ──');
  console.log(' ', JSON.stringify(contar(rows.map(r => g(r, 'empresa')))));
}

const arquivo = process.argv[2];
if (!arquivo) {
  console.error('uso: node scripts/medir-export-pacto.js <export.xls> [AAAA-MM]');
  process.exit(1);
}
medir(arquivo, process.argv[3]);
