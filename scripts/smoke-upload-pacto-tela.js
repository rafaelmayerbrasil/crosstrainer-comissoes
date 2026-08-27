'use strict';
// Roda: node scripts/smoke-upload-pacto-tela.js
//
// O tradutor da Pacto foi plugado na tela de Upload do `index.html` (26/08/2026).
// Este smoke guarda a LIGAÇÃO — que é justamente o que os outros testes não
// cobrem: `pacto-adapter.js` pode estar perfeito e a tela nunca chamar ele.
// Foi exatamente esse buraco que deixou a "Prévia antes de publicar" da escala
// nunca rodar em produção (24/08), com 12 testes passando por cima.
//
// Parte 1 é ESTRUTURAL: confere que a tela carrega e chama o tradutor.
// Parte 2 é COMPORTAMENTAL: refaz o caminho exato que o `handleFile` percorre,
// com as mesmas funções, e prova que o motor recebe só a unidade certa.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const PA = require(path.join(raiz, 'pacto-adapter.js'));
const CE = require(path.join(raiz, 'commission.js'));
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);

// ════════════════════════════════════════════════════════════════════
// PARTE 1 — a tela realmente chama o tradutor
// ════════════════════════════════════════════════════════════════════
{
  assert.ok(html.includes('<script src="pacto-adapter.js"></script>'),
    'index.html precisa carregar o pacto-adapter.js');
  const iAdapter = html.indexOf('<script src="pacto-adapter.js">');
  const iEngine = html.indexOf('<script src="commission.js">');
  assert.ok(iEngine >= 0 && iAdapter > iEngine, 'o adapter carrega depois do motor');
  ok('index.html carrega o pacto-adapter.js');
}
{
  assert.ok(html.includes('PactoAdapter.ehExportPacto(json)'),
    'o upload precisa perguntar se o arquivo é da Pacto');
  assert.ok(html.includes('PactoAdapter.traduzir(json'), 'e traduzir quando for');
  assert.ok(html.includes('PactoAdapter.paraPlanilha('), 'e entregar no formato do motor');
  // a tradução tem que acontecer ANTES do cleanRawData, senão não adianta nada
  assert.ok(html.indexOf('PactoAdapter.paraPlanilha(') < html.indexOf('CommissionEngine.cleanRawData(json)'),
    'traduzir ANTES de entregar ao motor');
  ok('o upload traduz o arquivo da Pacto antes de entregar ao motor');
}
{
  assert.ok(html.includes("pacto.relatorio !== 'recebido'"),
    'a tela precisa barrar o "Faturamento por Período"');
  assert.ok(/Faturamento Recebido/.test(html), 'e dizer qual é o certo');
  ok('a tela barra o relatório errado (o que pagaria 12× a mais)');
}
{
  assert.ok(html.includes('function pactoResumoHtml('), 'resumo do que ficou de fora existe');
  assert.ok(html.includes('pactoResumoHtml(pacto,'), 'e é chamado na pré-visualização');
  // ⚠️ Tem que receber a SIGLA, não o id cru da unidade. Passando `UNIT-CP` o
  // filtro por unidade nunca casa e o bloco aparece vazio — foi o que aconteceu
  // no 1º teste do Rafael: R$ 79 mil de descarte sumiram da tela em silêncio.
  assert.ok(/pactoResumoHtml\(pacto,\s*PactoAdapter\.siglaDaUnidade\(/.test(html),
    'o resumo recebe a sigla traduzida, não o currentUnitId cru');
  assert.ok(html.includes('pacto.migrados') || html.includes('pacto.descartadas'),
    'o resumo mostra o que foi descartado');
  ok('a pré-visualização mostra o que o tradutor deixou de fora');
}
{
  // O motor não pode ter sido tocado — é a regra nº 1 do projeto
  const motor = fs.readFileSync(path.join(raiz, 'commission.js'), 'utf8');
  assert.ok(!/PactoAdapter/.test(motor), 'commission.js NÃO pode conhecer o adapter');
  ok('commission.js continua sem saber que a Pacto existe');
}

// ════════════════════════════════════════════════════════════════════
// PARTE 2 — o caminho do handleFile, refeito com as mesmas funções
// ════════════════════════════════════════════════════════════════════
const CP = 'CROSSTAINER UNID. CAMPECHE (CP)';
const PP = 'CROSSTAINER UNID. PEQ PRÍNCIPE (PP)';
function linha(o) {
  const r = new Array(22).fill('');
  const d = {
    matricula: '1', nome: 'FULANO', cadastro: '01/08/2026',
    resp1: 'ERICA FAUSTINO', resp2: 'ERICA FAUSTINO', produto: '', contrato: '0',
    inicio: '', termino: '', duracao: '0', modalidades: '', plano: '', situacao: '',
    lancamento: '05/08/2026', valor: '100,00', forma: 'CARTÃO DE CRÉDITO',
    condicao: 'A VISTA', empresa: CP, turma: '', categoria: '',
    consultor: 'ERICA FAUSTINO', ...o,
  };
  Object.keys(PA.COL).forEach(k => { r[PA.COL[k]] = d[k] === undefined ? '' : d[k]; });
  return r;
}
const cabecalho = () => {
  const r = new Array(22).fill('');
  r[PA.COL.nome] = 'Nome Cliente'; r[PA.COL.lancamento] = 'Data Lançamento';
  r[PA.COL.consultor] = 'Consultor '; r[PA.COL.resp1] = 'Responsável ';
  return r;
};
const PLANO = 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO | CP.';

// o que o SheetJS entregaria ao handleFile
const arquivo = [
  cabecalho(),
  linha({ nome: 'DO CAMPECHE', contrato: '7078', duracao: '12', inicio: '03/08/2026',
          termino: '02/08/2027', produto: PLANO, plano: PLANO, situacao: 'Matrícula',
          valor: '259,00', empresa: CP, consultor: 'ERICA FAUSTINO' }),
  linha({ nome: 'DO PRINCIPE', contrato: '9001', duracao: '12', inicio: '05/08/2026',
          termino: '04/08/2027', produto: PLANO, plano: PLANO, situacao: 'Matrícula',
          valor: '199,00', empresa: PP, consultor: 'KALI LÓPEZ' }),
  linha({ nome: 'MIGRADO DO PRINCIPE', contrato: '6200', duracao: '12', inicio: '07/01/2026',
          termino: '06/01/2027', produto: 'IMPORTAÇÃO', plano: 'IMPORTAÇÃO',
          situacao: 'Rematrícula', valor: '269,00', empresa: PP, consultor: 'KALI LÓPEZ' }),
];

/** Refaz o que o handleFile faz, para uma unidade. */
function subir(json, currentUnitId) {
  if (!PA.ehExportPacto(json)) return { pacto: null, rows: CE.cleanRawData(json) };
  const pacto = PA.traduzir(json, {});
  const sigla = PA.siglaDaUnidade(currentUnitId, Object.keys(pacto.porUnidade).filter(k => k));
  if (pacto.relatorio !== 'recebido') return { bloqueado: true, pacto };
  const vendas = pacto.porUnidade[sigla] || [];
  if (!vendas.length) return { semLinhas: true, pacto };
  return { pacto, rows: CE.cleanRawData([PA.CABECALHO_SAIDA, ...PA.paraPlanilha(vendas)]) };
}

{
  const cp = subir(arquivo, 'cp');
  const pp = subir(arquivo, 'pp');
  assert.strictEqual(cp.rows.length, 1, 'Campeche recebe 1 linha');
  assert.strictEqual(cp.rows[0]['Cliente'], 'DO CAMPECHE');
  assert.strictEqual(pp.rows.length, 1, 'Príncipe recebe 1 (o migrado fica fora)');
  assert.strictEqual(pp.rows[0]['Cliente'], 'DO PRINCIPE');
  ok('mesmo arquivo, duas subidas: cada unidade recebe só o que é dela');
}
{
  // No staging as unidades são `unit-cp`/`unit-pp`; em produção `cp`/`pp`.
  // Os dois caminhos têm que dar o mesmo resultado.
  const a = subir(arquivo, 'unit-cp'), b = subir(arquivo, 'cp');
  assert.strictEqual(a.rows.length, 1);
  assert.deepStrictEqual(a.rows, b.rows, 'unit-cp e cp levam às mesmas linhas');
  ok('id de unidade do staging (unit-cp) e de produção (cp) dão o mesmo');
}
{
  const cp = subir(arquivo, 'cp');
  const res = CE.calculate(cp.rows, CE.defaultConfig, {});
  assert.strictEqual(res.unitTotals.unitAtivacoes, 1);
  assert.strictEqual(res.vendorData['ERICA FAUSTINO'].p2total, CE.defaultConfig.bonusAnualLocal);
  ok('o motor calcula normalmente em cima do que a tela traduziu');
}
{
  // O resumo da tela filtra por unidade: quem sobe o Campeche não pode ver
  // os migrados do Príncipe na lista de conferência.
  const { pacto } = subir(arquivo, 'pp');
  const doCP = pacto.migrados.filter(m => m.unidade === 'CP');
  const doPP = pacto.migrados.filter(m => m.unidade === 'PP');
  assert.strictEqual(doCP.length, 0);
  assert.deepStrictEqual(doPP.map(m => m.cliente), ['MIGRADO DO PRINCIPE']);
  ok('o resumo do que ficou de fora é por unidade');
}
{
  // Arquivo do formato antigo tem que continuar passando direto
  const tecnofit = [
    ['Código', 'Cliente', 'Data', 'Itens', 'Valor Venda', 'Desconto Venda',
     'Desconto Recebimento', 'Valor Final', 'Valor Quitado/Recibo', 'Origem',
     'Tipo de Venda', 'Vendedor'],
    ['317541', 'CLIENTE ANTIGO', '05/07/2026', 'HIIT | ANUAL | LOCAL | PADRÃO',
     259, '-', '-', 259, 259, 'Balcão', 'Novo Contrato', 'ERICA FAUSTINO'],
  ];
  const r = subir(tecnofit, 'cp');
  assert.strictEqual(r.pacto, null, 'não tentou traduzir');
  assert.strictEqual(r.rows.length, 1, 'e o motor recebeu a linha igual a sempre');
  assert.strictEqual(CE.classifyRow(r.rows[0]).periodicidade, 'ANUAL');
  ok('arquivo do formato antigo continua funcionando, sem passar pelo tradutor');
}
{
  const semForma = arquivo.map((l, i) => {
    if (i === 0) return l;
    const c = l.slice(); c[PA.COL.forma] = ''; return c;
  });
  const r = subir(semForma, 'cp');
  assert.strictEqual(r.bloqueado, true, 'o relatório errado é barrado antes de calcular');
  assert.strictEqual(r.rows, undefined, 'e nada chega ao motor');
  ok('o relatório errado é barrado antes de qualquer cálculo');
}

console.log('\n' + n + '/' + n + ' casos passaram.');
