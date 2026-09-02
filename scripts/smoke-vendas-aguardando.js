'use strict';
// Roda: node scripts/smoke-vendas-aguardando.js
//
// ══════════════════════════════════════════════════════════════════════
// "VENDI, AGUARDANDO PAGAMENTO" — o que a vendedora fechou e ainda não caiu
// ══════════════════════════════════════════════════════════════════════
//
// Pedido do Rodrigo em 01/09: sob regime de caixa a comissão só nasce quando o
// dinheiro entra, então a vendedora precisa ver onde está o que ela vendeu.
// Sem isso, ela compara a lista dela com o pagamento, não bate, e conclui que o
// sistema errou.
//
// ⚠️ POR QUE PRECISOU DE UM SEGUNDO ARQUIVO
// O `faturamento-recebido` traz RECEBIMENTOS. Venda que não foi paga não existe
// nele — a renovação de 19/08 do Príncipe não aparece em nenhuma das 619 linhas.
// Quem sabe o que foi VENDIDO é o outro relatório da Pacto, o `faturamento`.
// São os dois arquivos com as MESMAS 21 colunas, e `detectarRelatorio()` já
// separa um do outro pelo `Forma Pagamento` (cheio num, vazio no outro).
//
// 🔑 O CRUZAMENTO REAPROVEITA A MEMÓRIA que já existe: um contrato deixou de
//    aguardar quando aparece em `codigosPagos` de QUALQUER mês — venda de agosto
//    paga em setembro não está mais esperando. A mesma lista que impede pagar
//    duas vezes diz o que ainda não pagou.

const assert = require('assert');
const path = require('path');
const VA = require(path.join(__dirname, '..', 'vendas-aguardando.js'));
const PA = require(path.join(__dirname, '..', 'pacto-adapter.js'));

const CP = 'CROSSTAINER UNID. CAMPECHE (CP)';
const PP = 'CROSSTAINER UNID. PEQ PRÍNCIPE (PP)';
const PLANO = 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO | CP.';

function linha(o) {
  const r = new Array(22).fill('');
  const d = {
    matricula: '1', nome: 'FULANO', cadastro: '01/08/2026',
    resp1: 'ERICA FAUSTINO', resp2: 'ERICA FAUSTINO', produto: PLANO, contrato: '7078',
    inicio: '06/08/2026', termino: '05/08/2027', duracao: '12', modalidades: '',
    plano: PLANO, situacao: 'Matrícula', lancamento: '06/08/2026', valor: '3.108,00',
    forma: '', condicao: 'EM 12 VEZES', empresa: CP, turma: '', categoria: '',
    consultor: 'ERICA FAUSTINO', ...o,
  };
  Object.keys(PA.COL).forEach(k => { r[PA.COL[k]] = d[k] === undefined ? '' : d[k]; });
  return r;
}
const cab = () => { const r = new Array(22).fill('');
  r[PA.COL.nome] = 'Nome Cliente'; r[PA.COL.lancamento] = 'Data Lançamento';
  r[PA.COL.consultor] = 'Consultor '; r[PA.COL.resp1] = 'Responsável '; return r; };

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

// ════════════════════════════════════════════════════════════════════
// 1. Extrai as vendas, agrupadas por unidade e mês
// ════════════════════════════════════════════════════════════════════
{
  const r = VA.extrair([cab(),
    linha({ contrato: '7078', nome: 'DO CAMPECHE' }),
    linha({ contrato: '4001', nome: 'DO PRINCIPE', empresa: PP, lancamento: '10/08/2026' }),
    linha({ contrato: '7001', nome: 'DE JULHO', lancamento: '15/07/2026' }),
  ]);
  assert.deepStrictEqual(Object.keys(r).sort(), ['CP|2026-07', 'CP|2026-08', 'PP|2026-08']);
  assert.strictEqual(r['CP|2026-08'][0].cliente, 'DO CAMPECHE');
  assert.strictEqual(r['CP|2026-08'][0].contrato, 'C7078', 'o código sai no mesmo formato do outro lado');
  ok('separa as vendas por unidade e por mês, com o código no formato do sistema');
}

// ════════════════════════════════════════════════════════════════════
// 2. 🔑 Contrato que já recebeu — em QUALQUER mês — não está aguardando
// ════════════════════════════════════════════════════════════════════
{
  const vendas = VA.extrair([cab(), linha({ contrato: '7078' }), linha({ contrato: '7079', nome: 'OUTRO' })]);
  const r = VA.cruzar(vendas['CP|2026-08'], ['C7078']);
  assert.strictEqual(r.aguardando.length, 1);
  assert.strictEqual(r.aguardando[0].contrato, 'C7079');
  assert.strictEqual(r.pagas.length, 1);
  ok('quem já recebeu sai da lista; quem não recebeu fica');
}
{
  // Venda de agosto paga só em setembro: quando setembro entrar na memória,
  // ela some da lista sozinha. É por isso que o cruzamento olha todos os meses.
  const vendas = VA.extrair([cab(), linha({ contrato: '7078' })]);
  const antes = VA.cruzar(vendas['CP|2026-08'], []);
  const depois = VA.cruzar(vendas['CP|2026-08'], ['C7078']);   // pago em setembro
  assert.strictEqual(antes.aguardando.length, 1);
  assert.strictEqual(depois.aguardando.length, 0);
  ok('venda de agosto paga em setembro deixa de aguardar sozinha');
}

// ════════════════════════════════════════════════════════════════════
// 3. 🚨 Renovação que trocou de número de contrato
// ════════════════════════════════════════════════════════════════════
{
  // Medido no dado real de agosto/2026: quando o aluno renova, a Pacto cria um
  // contrato NOVO, mas a cobrança do mês continua caindo no ANTIGO. A Cátia
  // renovou no 7130 em 27/08 e o dinheiro dela entrou no 6867 em 12/08.
  // Cruzando só por número, a venda parecia parada e a comissão já tinha sido paga.
  const vendas = VA.extrair([cab(),
    linha({ contrato: '7130', nome: 'CÁTIA TEREZINHA' }),
    linha({ contrato: '7999', nome: 'NINGUEM PAGOU' }),
  ])['CP|2026-08'];

  const semCliente = VA.cruzar(vendas, []);
  assert.strictEqual(semCliente.aguardando.length, 2, 'sem a lista de clientes, as duas ficam paradas');

  const comCliente = VA.cruzar(vendas, [], ['CÁTIA TEREZINHA']);
  assert.strictEqual(comCliente.aguardando.length, 1, 'só a que não pagou nada continua parada');
  assert.strictEqual(comCliente.aguardando[0].cliente, 'NINGUEM PAGOU');
  assert.strictEqual(comCliente.conferir.length, 1, 'a outra vai para conferência, não some');
  assert.ok(/outro contrato/.test(comCliente.conferir[0].motivoConferir));
  ok('renovação cujo pagamento caiu no contrato antigo vai para conferência, não para "parada"');
}
{
  // ⚠️ Pagar uma água não paga o plano: só recebimento DE CONTRATO conta.
  // Chris Mitchell tinha R$ 28 de bar no mês e a venda dele seguia sem pagamento.
  const vendas = VA.extrair([cab(), linha({ contrato: '4614', nome: 'CHRIS MITCHELL' })])['CP|2026-08'];
  const r = VA.cruzar(vendas, [], []);   // quem só comprou no bar não entra na lista
  assert.strictEqual(r.aguardando.length, 1, 'continua aguardando');
  assert.strictEqual(r.conferir.length, 0);
  ok('compra no bar não conta como pagamento do contrato');
}
{
  // O nome vem com acento e caixa diferentes entre os dois relatórios
  const vendas = VA.extrair([cab(), linha({ contrato: '7130', nome: 'CÁTIA TEREZINHA PEREIRA TORRES' })])['CP|2026-08'];
  const r = VA.cruzar(vendas, [], ['catia terezinha pereira torres']);
  assert.strictEqual(r.conferir.length, 1, 'acento e caixa não podem separar a mesma pessoa');
  ok('o casamento por cliente ignora acento e maiúscula');
}

// ════════════════════════════════════════════════════════════════════
// 4. O que NÃO é venda esperando dinheiro
// ════════════════════════════════════════════════════════════════════
{
  const linhas = [cab(),
    linha({ contrato: '7078', nome: 'VENDA BOA' }),
    linha({ contrato: '0', nome: 'AULA AVULSA', produto: '1 AULA', plano: '', duracao: '0', inicio: '', termino: '' }),
    linha({ contrato: '6200', nome: 'MIGRADO', plano: 'IMPORTAÇÃO', produto: 'IMPORTAÇÃO', inicio: '07/01/2026' }),
    linha({ contrato: '7300', nome: 'AUTOMATICA', resp2: 'RECORRENCIA' }),
    linha({ contrato: '7400', nome: 'CANCELADO', produto: 'QUITAÇÃO DE DINHEIRO - CANCELAMENTO' }),
    linha({ contrato: '7500', nome: 'VALOR ZERO', valor: '0,00' }),
  ];
  const vendas = VA.extrair(linhas)['CP|2026-08'];
  const nomes = vendas.map(v => v.cliente);
  assert.deepStrictEqual(nomes, ['VENDA BOA'],
    'só a venda de verdade sobra — veio: ' + nomes.join(', '));
  ok('avulso, migrado, renovação automática, cancelamento e valor zero ficam fora');
}

// ════════════════════════════════════════════════════════════════════
// 4. Venda dividida aparece para as duas
// ════════════════════════════════════════════════════════════════════
{
  const vendas = VA.extrair([cab(),
    linha({ contrato: '7078', consultor: 'BÁRBARA VIEIRA CARDOSO, KALI LÓPEZ' })])['CP|2026-08'];
  assert.strictEqual(vendas.length, 1);
  assert.deepStrictEqual(vendas[0].vendedores, ['BÁRBARA VIEIRA CARDOSO', 'KALI DUTRA'],
    'as duas, com o nome normalizado como no resto do sistema');
  ok('venda dividida lista as duas vendedoras, com o nome que o sistema usa');
}

// ════════════════════════════════════════════════════════════════════
// 5. Filtrar pela vendedora — é o que a tela dela mostra
// ════════════════════════════════════════════════════════════════════
{
  const vendas = VA.extrair([cab(),
    linha({ contrato: '7078', consultor: 'ERICA FAUSTINO' }),
    linha({ contrato: '7079', consultor: 'FRANCINI DAS CHAGAS' }),
    linha({ contrato: '7080', consultor: 'BÁRBARA VIEIRA CARDOSO, KALI LÓPEZ' }),
  ])['CP|2026-08'];
  assert.strictEqual(VA.daVendedora(vendas, 'ERICA FAUSTINO').length, 1);
  assert.strictEqual(VA.daVendedora(vendas, 'KALI DUTRA').length, 1, 'a dividida conta para as duas');
  assert.strictEqual(VA.daVendedora(vendas, 'kali dutra').length, 1, 'sem depender de maiúscula');
  assert.strictEqual(VA.daVendedora(vendas, 'NINGUÉM').length, 0);
  ok('cada vendedora vê as suas, inclusive as divididas');
}

// ════════════════════════════════════════════════════════════════════
// 6. 🚨 O arquivo errado não pode entrar por aqui
// ════════════════════════════════════════════════════════════════════
{
  // Este caminho aceita o relatório de VENDAS. Se alguém trouxer o de
  // RECEBIMENTOS, os números viram outra coisa — e o contrário já custaria 12×
  // no cálculo. `detectarRelatorio` é quem separa, pelo `Forma Pagamento`.
  const vendasFile = [cab(), linha({ forma: '' })];
  const recebidoFile = [cab(), linha({ forma: 'PIX' })];
  assert.strictEqual(PA.detectarRelatorio(vendasFile), 'faturamento');
  assert.strictEqual(PA.detectarRelatorio(recebidoFile), 'recebido');
  assert.strictEqual(VA.ehRelatorioDeVendas(vendasFile), true);
  assert.strictEqual(VA.ehRelatorioDeVendas(recebidoFile), false, 'o de recebimentos é recusado aqui');
  ok('só o relatório de VENDAS entra por este caminho');
}

// ════════════════════════════════════════════════════════════════════
// 7. Resumo por vendedora, para a gestão
// ════════════════════════════════════════════════════════════════════
{
  const vendas = VA.extrair([cab(),
    linha({ contrato: '7078', consultor: 'ERICA FAUSTINO', valor: '3.108,00' }),
    linha({ contrato: '7079', consultor: 'ERICA FAUSTINO', valor: '1.000,00' }),
    linha({ contrato: '7080', consultor: 'FRANCINI DAS CHAGAS', valor: '500,00' }),
  ])['CP|2026-08'];
  const r = VA.cruzar(vendas, []);
  assert.strictEqual(r.porVendedora['ERICA FAUSTINO'].quantidade, 2);
  assert.strictEqual(r.porVendedora['ERICA FAUSTINO'].valorContratos, 4108);
  assert.strictEqual(r.porVendedora['FRANCINI DAS CHAGAS'].quantidade, 1);
  ok('resumo por vendedora com quantidade e valor dos contratos');
}

// ════════════════════════════════════════════════════════════════════
// 8. ⚠️ O valor é do CONTRATO, não a comissão — não pode ser confundido
// ════════════════════════════════════════════════════════════════════
{
  // O relatório de vendas traz o contrato INTEIRO (R$ 3.108 num anual de 12×),
  // enquanto a comissão sai sobre a parcela que entrar. Anunciar isso como "vai
  // receber" criaria uma expectativa 12 vezes maior que a real.
  const vendas = VA.extrair([cab(), linha({ contrato: '7078', valor: '3.108,00' })])['CP|2026-08'];
  const v = vendas[0];
  assert.strictEqual(v.valorContrato, 3108);
  assert.strictEqual(v.comissaoEstimada, undefined, 'não estima comissão — seria chute sobre chute');
  assert.ok(v.avisoValor && /contrato/i.test(v.avisoValor), 'traz o rótulo do que o valor é: ' + v.avisoValor);
  ok('o valor é rotulado como do contrato, e nenhuma comissão é prometida');
}

// ════════════════════════════════════════════════════════════════════
// PARTE 2 — a LIGAÇÃO com a tela
// ════════════════════════════════════════════════════════════════════

const fs = require('fs');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

{
  assert.ok(html.includes('<script src="vendas-aguardando.js"></script>'), 'a tela carrega o módulo');
  assert.ok(html.includes('VendasAguardando.extrair(json)'), 'o upload lê as vendas do relatório certo');
  assert.ok(html.includes('function registrarVendasDoPeriodo('), 'existe o registro');
  assert.ok(html.includes('vendasDoMes'), 'guardadas no doc do período');
  assert.ok(html.includes('VendasAguardando.cruzar('), 'e a tela cruza com a memória');
  ok('a tela carrega o módulo, registra as vendas e cruza');
}
{
  // ⚠️ O relatório de vendas NÃO pode voltar a alimentar o cálculo — é o
  // arquivo que pagaria 12× a mais. O caminho dele termina em `return`, antes
  // de qualquer coisa chegar ao motor.
  const iCheck = html.indexOf("if (pacto.relatorio !== 'recebido')");
  const iMotor = html.indexOf('CommissionEngine.cleanRawData(json)');
  assert.ok(iCheck > 0 && iMotor > iCheck, 'a verificação vem antes do motor');
  const trecho = html.slice(iCheck, iMotor);
  assert.ok(/não entra no cálculo/i.test(trecho), 'e a tela diz isso em português claro');
  assert.ok(/return;/.test(trecho), 'e para ali');
  ok('o relatório de vendas nunca chega ao motor de cálculo');
}
{
  // 🚨 A lista de abas do vendedor existe em DOIS lugares (o reset ao carregar
  // o período e o switchVendorTab). Trocar só um deixa a aba nova aparecendo
  // por cima da outra — foi o que aconteceu ao escrever isto.
  const ocorrencias = html.split("'vtabResumo','vtabComissoes'").length - 1;
  const comAReceber = html.split("'vtabAtivacoes','vtabAReceber'").length - 1;
  assert.strictEqual(comAReceber, ocorrencias,
    `a aba precisa estar nas ${ocorrencias} listas de abas do vendedor, está em ${comAReceber}`);
  ok('a aba do vendedor está em TODAS as listas de abas, não só na primeira');
}
{
  const allTabs = html.match(/const allTabs = \[[^\]]+\]/);
  assert.ok(allTabs && allTabs[0].includes('tabAReceber'), 'e a da gestão também');
  assert.ok(html.includes("switchDashTab('tabAReceber'"), 'com botão próprio');
  assert.ok(html.includes("renderAReceberTab('aReceberContent', periodId, '')"),
    'a gestão vê de todo mundo (sem filtro de vendedora)');
  assert.ok(html.includes("renderAReceberTab('vendorAReceberContent', periodId, myName)"),
    'e a vendedora só as dela');
  ok('gestão vê todas as vendas paradas; a vendedora, só as suas');
}
{
  // 🚨 Os botões desenhados DENTRO da área de arrastar arquivo: o clique
  // borbulha até `zone.onclick`, que abre o seletor de arquivo por cima da
  // ação. "Registrar vendas" virava "escolher outro arquivo".
  const i = html.indexOf('zone.onclick =');
  const linha = html.slice(i, i + 200);
  assert.ok(/closest\('button'\)/.test(linha),
    'o clique num botão dentro da área não pode abrir o seletor: ' + linha.split('\n')[0]);
  ok('botão dentro da área de upload executa a ação, não abre o seletor de arquivo');
}
{
  // 🚨 O <input type="file"> mora DENTRO da área de upload, e as telas que
  // trocam o innerHTML dela apagam o input. O initUpload seguinte morria com
  // "Cannot set properties of null (setting 'onchange')" — depois de a ação já
  // ter funcionado, o que é pior: parecia que tinha falhado.
  const iInput = html.indexOf('<input type="file" id="fileInput"');
  const iZone = html.indexOf('id="uploadZone"');
  const iFimZone = html.indexOf('</div>', iInput);
  assert.ok(iInput > iZone && iFimZone > iInput, 'o input de arquivo está dentro da área de upload');
  const init = html.slice(html.indexOf('function initUpload()'), html.indexOf('function initUpload()') + 900);
  assert.ok(/uploadZoneHtmlOriginal/.test(init),
    'o initUpload precisa repor o conteúdo original da área, senão o input não volta');
  ok('trocar a tela da área de upload não deixa o seletor de arquivo para trás');
}
{
  // O valor é do contrato, não da comissão — a tela tem que dizer isso, senão
  // promete 12× o que a pessoa vai receber num anual parcelado.
  // Delimitado pela função seguinte, não por um número de caracteres: a janela
  // fixa de 6000 quebrou assim que a função cresceu, e um teste que quebra ao
  // crescer o código treina a gente a ignorá-lo.
  const i = html.indexOf('async function renderAReceberTab');
  const fim = html.indexOf('async function renderVendorDiferidosTab', i);
  assert.ok(i > 0 && fim > i, 'renderAReceberTab localizada no index.html');
  const bloco = html.slice(i, fim);
  assert.ok(/contrato inteiro/i.test(bloco) && /não o da comissão|não o valor da comissão/i.test(bloco),
    'a tela avisa que o valor é do contrato');
  ok('a tela avisa que o valor mostrado não é a comissão');
}

console.log('\n' + n + '/' + n + ' casos passaram.');
