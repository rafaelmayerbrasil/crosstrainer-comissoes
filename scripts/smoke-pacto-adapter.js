'use strict';
// Roda: node scripts/smoke-pacto-adapter.js
//
// O TecnoFit acabou no fim de julho/2026. De agosto em diante a única entrada
// de dados do módulo de Comissões é o export `faturamento-recebido` da Pacto,
// que tem as mesmas informações em outra ordem e com outros nomes.
//
// `pacto-adapter.js` traduz "linha da Pacto" → "venda que o motor já entende",
// sem tocar em `commission.js` nem no `index.html`.
//
// Metade dos casos aqui é COMPORTAMENTAL: pega a saída do tradutor e joga no
// `CommissionEngine` de verdade, provando que o motor classifica como esperado.
// É o que importa — traduzir "certo" e o motor entender errado não vale nada.
// A outra metade guarda as regras que saíram de medição no dado real
// (ver docs/superpowers/specs/2026-08-19-tradutor-pacto-comissoes-design.md).

const assert = require('assert');
const path = require('path');
const PA = require(path.join(__dirname, '..', 'pacto-adapter.js'));
const CE = require(path.join(__dirname, '..', 'commission.js'));

// ─── Monta uma linha crua da Pacto por POSIÇÃO ───
// O cabeçalho do export tem `Responsável` DUPLICADO (posições 4 e 5), então ler
// por nome perde uma das duas colunas. Por isso tudo aqui é por posição.
const COL = {
  matricula: 1, nome: 2, cadastro: 3, resp1: 4, resp2: 5, produto: 6, contrato: 7,
  inicio: 8, termino: 9, duracao: 10, modalidades: 11, plano: 12, situacao: 13,
  lancamento: 14, valor: 15, forma: 16, condicao: 17, empresa: 18, turma: 19,
  categoria: 20, consultor: 21,
};
const CP = 'CROSSTAINER UNID. CAMPECHE (CP)';
const PP = 'CROSSTAINER UNID. PEQ PRÍNCIPE (PP)';

function linha(o) {
  const r = [];
  for (let i = 0; i <= 21; i++) r[i] = '';
  const d = {
    nome: 'FULANO DE TAL', matricula: '1', cadastro: '01/08/2026',
    resp1: 'ERICA FAUSTINO', resp2: 'ERICA FAUSTINO', contrato: '0',
    inicio: '', termino: '', duracao: '0', modalidades: '', plano: '',
    situacao: '', lancamento: '05/08/2026', valor: '100,00',
    forma: 'CARTÃO DE CRÉDITO', condicao: '1X', empresa: CP,
    turma: '', categoria: '', produto: '', consultor: 'ERICA FAUSTINO',
    ...o,
  };
  Object.keys(COL).forEach(k => { r[COL[k]] = d[k] === undefined ? '' : d[k]; });
  return r;
}
const CABECALHO = linha({ nome: 'Nome Cliente' }); // linha 1 do arquivo, ignorada

// Contrato anual LOCAL bem-comportado — o caso feliz, referência dos outros
const ANUAL_LOCAL = {
  nome: 'ANA PAULA', contrato: '7078', duracao: '12',
  inicio: '03/08/2026', termino: '02/08/2027',
  produto: 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO | CP.',
  plano: 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO | CP.',
  situacao: 'Matrícula', valor: '259,00', consultor: 'ERICA FAUSTINO',
};

const traduz = (linhas, opts) => PA.traduzir([CABECALHO, ...linhas], { mes: '2026-08', ...opts });
const soUma = (l, opts) => { const r = traduz([linha(l)], opts); return r.vendas[0]; };

// Roda a venda traduzida pelo motor REAL — é isso que prova a tradução
const classifica = venda => CE.classifyRow(venda);

let n = 0;
const ok = msg => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + msg);

// ════════════════════════════════════════════════════════════════════
// 1. O caso feliz: contrato anual LOCAL atravessa inteiro
// ════════════════════════════════════════════════════════════════════
{
  const v = soUma(ANUAL_LOCAL);
  assert.strictEqual(v['Cliente'], 'ANA PAULA');
  assert.strictEqual(v['Data'], '05/08/2026', 'Data vem de Data Lançamento');
  assert.strictEqual(v['Valor Quitado/Recibo'], 259, 'valor "259,00" vira número');
  assert.strictEqual(v['Tipo de Venda'], 'Novo Contrato', 'Situação Matrícula = venda nova');
  assert.strictEqual(v['Origem'], 'Balcão');
  assert.strictEqual(v['Vendedor'], 'ERICA FAUSTINO', 'vendedora sai de Consultor');

  const c = classifica(v);
  assert.strictEqual(c.periodicidade, 'ANUAL');
  assert.strictEqual(c.abrangencia, 'LOCAL');
  assert.strictEqual(c.isActivation, true);
  assert.strictEqual(c.category, 'novo');
  assert.strictEqual(CE.getP2Bonus(c.periodicidade, c.abrangencia, CE.defaultConfig), 30);
  ok('contrato anual LOCAL: motor lê ANUAL/LOCAL, ativação, P2 R$ 30');
}

// ════════════════════════════════════════════════════════════════════
// 2. O período do plano viaja junto — o motor usa pra adiar venda futura
// ════════════════════════════════════════════════════════════════════
// No TecnoFit o `Itens` terminava em "(03/08/2026 - 02/08/2027)" e
// `parseStartDate` lê dali. A Pacto guarda isso em Data Início / Data Término,
// em colunas separadas — sem remontar, plano vendido em agosto pra começar em
// setembro deixaria de ser adiado.
{
  const v = soUma(ANUAL_LOCAL);
  assert.ok(v['Itens'].includes('(03/08/2026 - 02/08/2027)'), 'período colado no Itens: ' + v['Itens']);
  const d = CE.parseStartDate(v['Itens']);
  assert.ok(d && d.startStr === '03/08/2026' && d.endStr === '02/08/2027');
  ok('período do contrato remontado no Itens (motor consegue adiar venda futura)');
}

// ════════════════════════════════════════════════════════════════════
// 3. Situação Contrato → Tipo de Venda
// ════════════════════════════════════════════════════════════════════
{
  assert.strictEqual(soUma({ ...ANUAL_LOCAL, situacao: 'Matrícula' })['Tipo de Venda'], 'Novo Contrato');
  assert.strictEqual(soUma({ ...ANUAL_LOCAL, situacao: 'Rematrícula' })['Tipo de Venda'], 'Retorno');
  assert.strictEqual(soUma({ ...ANUAL_LOCAL, situacao: 'Renovação' })['Tipo de Venda'], 'Renovação');
  assert.strictEqual(classifica(soUma({ ...ANUAL_LOCAL, situacao: 'Renovação' })).category, 'renovacao');
  ok('Matrícula→Novo · Rematrícula→Retorno · Renovação→Renovação');
}

// ════════════════════════════════════════════════════════════════════
// 4. Renovação automática = Responsável#2 diz RECORRENCIA
// ════════════════════════════════════════════════════════════════════
// Medido: as 13 linhas RECORRENCIA são subconjunto exato das 34 pagas em
// CARTÃO RECORRENTE. Usar a forma de pagamento como sinal cortaria 21 vendas
// legítimas — cartão recorrente é só cartão salvo, gente vendeu do mesmo jeito.
{
  const auto = soUma({ ...ANUAL_LOCAL, resp2: 'RECORRENCIA', situacao: 'Renovação' });
  assert.strictEqual(auto['Origem'], 'Renovação automática');
  assert.strictEqual(classifica(auto).excluded, true, 'motor exclui renovação automática');

  const mao = soUma({ ...ANUAL_LOCAL, forma: 'CARTÃO RECORRENTE', situacao: 'Renovação' });
  assert.strictEqual(mao['Origem'], 'Balcão', 'cartão recorrente sozinho NÃO é automática');
  assert.strictEqual(classifica(mao).excluded, false, 'venda trabalhada continua pagando');
  ok('RECORRENCIA vira renovação automática; cartão recorrente sozinho não');
}

// ════════════════════════════════════════════════════════════════════
// 5. RECEBIMENTO TECNOFIT: é FORMA DE PAGAMENTO, não carimbo de data
// ════════════════════════════════════════════════════════════════════
// `CARTÃO DE CRÉDITO - RECEBIMENTO TECNOFIT` quer dizer que a cobrança do
// cartão ainda passa pelo gateway antigo — a migração do meio de pagamento não
// terminou. Descartar tudo que traz esse rótulo derrubava, no export de 25/08,
// **10 contratos que começaram em agosto** (R$ 2.960), com plano escrito por
// extenso e vendedora identificada: um deles com matrícula em 03/08,
// `ECONÔMICO | RECORRENTE | FLEX`, vendida pela Erica.
//
// O que diz se é dinheiro velho é a `Data Início`, igual aos migrados — não a
// forma de pagamento.
{
  const antigo = traduz([linha({ ...ANUAL_LOCAL, ...{ inicio: '07/01/2026', termino: '06/01/2027' },
                                forma: 'CARTÃO DE CRÉDITO - RECEBIMENTO TECNOFIT' })]);
  assert.strictEqual(antigo.vendas.length, 0, 'contrato antigo cobrado pelo gateway velho sai');
  assert.strictEqual(antigo.descartadas.length, 1);
  assert.ok(/TECNOFIT/i.test(antigo.descartadas[0].motivo));

  const novo = traduz([linha({ ...ANUAL_LOCAL, forma: 'CARTÃO DE CRÉDITO - RECEBIMENTO TECNOFIT' })]);
  assert.strictEqual(novo.descartadas.length, 0, 'venda DO MÊS não sai só por causa do gateway');
  assert.strictEqual(novo.vendas.length, 1);
  assert.strictEqual(classifica(novo.vendas[0]).isActivation, true, 'e continua valendo ativação');
  ok('RECEBIMENTO TECNOFIT só descarta contrato que começou em outro mês');
}
{
  // Balcão pago pelo gateway antigo não tem Data Início — e é venda de hoje
  const r = traduz([linha({ produto: 'ÁGUA SEM GÁS', contrato: '0', valor: '3,50',
                            forma: 'PIX - RECEBIMENTO TECNOFIT' })]);
  assert.strictEqual(r.vendas.length, 1, 'produto de balcão não tem contrato nem início');
  assert.strictEqual(r.descartadas.length, 0);
  ok('produto de balcão pago pelo gateway antigo continua contando');
}

// ════════════════════════════════════════════════════════════════════
// 6. Grafia quebrada: "MENSA L" mata o word boundary do motor
// ════════════════════════════════════════════════════════════════════
{
  const cru = 'HIIT/MAROMBINHA | MENSA L | ILIMITADO | PADRÃO.';
  assert.strictEqual(CE.detectPeriodicidade(cru, CE.defaultConfig), null, 'cru o motor não acha');
  const v = soUma({ ...ANUAL_LOCAL, produto: cru, plano: cru, duracao: '1' });
  assert.strictEqual(classifica(v).periodicidade, 'MENSAL', 'depois de normalizar ele acha');
  ok('"MENSA L" normalizado para MENSAL (senão o plano não vira ativação)');
}

// ════════════════════════════════════════════════════════════════════
// 7-9. IMPORTAÇÃO: a Duração recupera a periodicidade
// ════════════════════════════════════════════════════════════════════
// 66 dos 121 contratos de agosto vieram com Plano/Produto/Modalidades =
// "IMPORTAÇÃO" — migrados do TecnoFit, perderam o nome do plano.
const IMP = { ...ANUAL_LOCAL, produto: 'IMPORTAÇÃO', plano: 'IMPORTAÇÃO', modalidades: 'IMPORTAÇÃO' };
{
  const v = soUma({ ...IMP, duracao: '12' });
  const c = classifica(v);
  assert.strictEqual(c.periodicidade, 'ANUAL');
  assert.strictEqual(c.abrangencia, 'LOCAL', 'decisão do Rafael: assumir LOCAL');
  assert.strictEqual(c.isActivation, true);
  ok('IMPORTAÇÃO duração 12 → ANUAL LOCAL (ativação vale)');
}
{
  assert.strictEqual(classifica(soUma({ ...IMP, duracao: '24' })).periodicidade, 'BIANUAL');
  // 13 e 14 são anuais com período de brinde (ex.: 20/12/2025 → 30/01/2027)
  assert.strictEqual(classifica(soUma({ ...IMP, duracao: '13' })).periodicidade, 'ANUAL');
  assert.strictEqual(classifica(soUma({ ...IMP, duracao: '14' })).periodicidade, 'ANUAL');
  ok('duração 24 → BIANUAL · 13 e 14 → ANUAL (anual com brinde)');
}
{
  const rec = soUma({ ...IMP, duracao: '1', forma: 'CARTÃO RECORRENTE', situacao: 'Renovação' });
  assert.strictEqual(classifica(rec).periodicidade, 'RECORRENTE');
  const men = soUma({ ...IMP, duracao: '1', forma: 'PIX' });
  assert.strictEqual(classifica(men).periodicidade, 'MENSAL');
  ok('duração 1 → RECORRENTE no cartão recorrente, MENSAL fora dele');
}

// ════════════════════════════════════════════════════════════════════
// 10. A marca do plano presumido não pode confundir o motor
// ════════════════════════════════════════════════════════════════════
// Assumir LOCAL erra em ~7% dos anuais (R$ 15 cada). A linha vai marcada pra
// dar pra auditar — mas a marca passa pelo `classifyRow`, que decide tudo por
// palavra-chave no texto. Se a marca casar com AULA/TAXA/FLEX/DEGUSTAÇÃO, ela
// muda a comissão. Este teste existe pra isso não passar despercebido.
{
  const v = soUma({ ...IMP, duracao: '12' });
  assert.ok(v['Itens'].includes(PA.MARCA_PRESUMIDO), 'linha marcada: ' + v['Itens']);

  const c = classifica(v);
  assert.strictEqual(c.category, 'novo', 'a marca não desviou a categoria');
  assert.strictEqual(c.abrangencia, 'LOCAL', 'a marca não contém FLEX');
  assert.strictEqual(c.periodicidade, 'ANUAL', 'a marca não contém outra periodicidade');
  assert.strictEqual(CE.mapCategory(v['Itens'], v['Tipo de Venda']), 'novo');

  const r = traduz([linha({ ...IMP, duracao: '12' }), linha(ANUAL_LOCAL)]);
  assert.strictEqual(r.marcadas.length, 1, 'só a importada entra na lista de conferência');
  assert.strictEqual(r.marcadas[0]['Cliente'], 'ANA PAULA');
  ok('marca do plano presumido é inerte pro motor e a linha fica listada');
}

// ════════════════════════════════════════════════════════════════════
// 10b-d. Contrato migrado do TecnoFit não é venda do mês
// ════════════════════════════════════════════════════════════════════
// O relatório da Pacto é `faturamento-recebido`, e a migração do TecnoFit foi
// entrando aos poucos: cada contrato que já existia apareceu com `Data
// Lançamento` no dia em que foi carregado e `Data Início` lá atrás.
//
// Em agosto são 49 linhas assim, R$ 13.203 — mais dinheiro do que todo o resto
// junto. Sem separar, um contrato que começou em janeiro pagaria ativação e
// bônus de anual em agosto, e a conta do mês dobrava (foi o que aconteceu ao
// rodar julho: R$ 6.641 contra os R$ 3.381 realmente pagos).
//
// O que separa os dois casos é a combinação: plano "IMPORTAÇÃO" (a marca da
// migração) **e** início fora do mês. Sozinho, nenhum dos dois serve.
const INICIO_ANTIGO = { inicio: '07/01/2026', termino: '06/01/2027' };
{
  const r = traduz([linha({ ...IMP, ...INICIO_ANTIGO, duracao: '12' })]);
  assert.strictEqual(r.vendas.length, 0, 'fica fora da planilha');
  assert.strictEqual(r.migrados.length, 1);
  assert.ok(/migra/i.test(r.migrados[0].motivo), r.migrados[0].motivo);
  ok('contrato importado que começou em outro mês não entra como venda do mês');
}
{
  // Vendida no fim de julho, dinheiro entrou em agosto: é venda de verdade e o
  // plano está escrito por extenso. Não pode cair na mesma peneira.
  const r = traduz([linha({ ...ANUAL_LOCAL, inicio: '31/07/2026', termino: '30/07/2027' })]);
  assert.strictEqual(r.vendas.length, 1);
  assert.strictEqual(r.migrados.length, 0);
  assert.strictEqual(classifica(r.vendas[0]).isActivation, true);
  ok('venda do fim do mês passado paga em agosto continua valendo');
}
{
  // Contrato criado já na Pacto em agosto, mas com o campo de plano em branco
  const r = traduz([linha({ ...IMP, duracao: '12' })]);
  assert.strictEqual(r.vendas.length, 1);
  assert.strictEqual(r.migrados.length, 0);
  ok('importado que COMEÇOU no mês continua sendo venda do mês');
}
{
  const r = traduz([linha({ ...IMP, ...INICIO_ANTIGO, duracao: '12' })], { pagarMigrados: true });
  assert.strictEqual(r.vendas.length, 1, 'dá pra incluir se o Rodrigo disser que é dinheiro novo');
  assert.strictEqual(r.migrados.length, 1, 'e mesmo incluído continua listado');
  ok('--pagar-migrados inclui os migrados sem esconder a lista');
}

// ════════════════════════════════════════════════════════════════════
// 11. Contrato com taxa em linha separada não pode virar 2 ativações
// ════════════════════════════════════════════════════════════════════
// Contrato 7036 real: MATRÍCULA R$ 100 + plano R$ 259, mesmo número de
// contrato. As duas linhas repetem o mesmo `Plano`, então traduzir cada uma
// pelo `Plano` daria duas ativações e dois bônus P2 — pagaria dobrado.
{
  const r = traduz([
    linha({ ...ANUAL_LOCAL, produto: 'MATRÍCULA', valor: '100,00' }),
    linha({ ...ANUAL_LOCAL, produto: ANUAL_LOCAL.plano, valor: '259,00' }),
  ]);
  assert.strictEqual(r.vendas.length, 2, 'as duas linhas continuam existindo (o caixa é real)');
  const cats = r.vendas.map(v => classifica(v));
  assert.strictEqual(cats.filter(c => c.isActivation).length, 1, 'só UMA ativação');
  const taxa = r.vendas.find(v => v['Valor Quitado/Recibo'] === 100);
  assert.strictEqual(classifica(taxa).category, 'matricula', 'a taxa é taxa');
  assert.strictEqual(classifica(taxa).isActivation, false);
  ok('taxa + plano no mesmo contrato = 2 linhas de caixa, 1 ativação');
}

// ════════════════════════════════════════════════════════════════════
// 12. Duas linhas IMPORTAÇÃO no mesmo contrato: a maior é o plano
// ════════════════════════════════════════════════════════════════════
// Contrato 6735 real: R$ 20 + R$ 195, ambas "IMPORTAÇÃO". Nada no dado diz
// qual é o plano, então vale a de maior valor; a outra vira taxa.
{
  const r = traduz([
    linha({ ...IMP, contrato: '6735', valor: '20,00' }),
    linha({ ...IMP, contrato: '6735', valor: '195,00' }),
  ]);
  const ativ = r.vendas.filter(v => classifica(v).isActivation);
  assert.strictEqual(ativ.length, 1);
  assert.strictEqual(ativ[0]['Valor Quitado/Recibo'], 195, 'a de maior valor é o plano');
  ok('contrato com 2 linhas importadas: a de maior valor vira o plano');
}

// ════════════════════════════════════════════════════════════════════
// 13. Quitação de cancelamento não é venda nova
// ════════════════════════════════════════════════════════════════════
// 5 linhas em agosto, R$ 1.001,68. É acerto de contrato cancelado. Sem tratar,
// com Plano=IMPORTAÇÃO e Duração=12 viraria 5 ativações anuais + 5 × R$ 30.
{
  const v = soUma({ ...IMP, produto: 'QUITAÇÃO DE DINHEIRO - CANCELAMENTO', valor: '175,86' });
  const c = classifica(v);
  assert.strictEqual(c.excluded, true, 'motor exclui: ' + JSON.stringify(c));
  assert.strictEqual(c.isActivation, false);
  ok('QUITAÇÃO DE CANCELAMENTO não vira ativação nem comissão');
}

// ════════════════════════════════════════════════════════════════════
// 14. Bar e loja: quem lançou é quem vendeu
// ════════════════════════════════════════════════════════════════════
// 40 das 75 linhas sem contrato são água, paçoca, Monster, camiseta — e vêm
// SEM Consultor. No TecnoFit essas linhas tinham vendedora e pagavam 5%.
// Pra produto de balcão não existe "quem lançou ≠ quem vendeu": é a mesma
// pessoa. Sem isso, R$ 1.953 de agosto não pagariam ninguém.
{
  const v = soUma({ produto: 'ÁGUA SEM GÁS', contrato: '0', consultor: '', resp1: 'KALI LÓPEZ', resp2: 'KALI LÓPEZ', valor: '3,50' });
  assert.strictEqual(v['Itens'], 'ÁGUA SEM GÁS');
  assert.strictEqual(v['Vendedor'], 'KALI DUTRA', 'cai no Responsável (e o nome é normalizado)');
  const c = classifica(v);
  assert.strictEqual(c.isActivation, false, 'água não é ativação');
  assert.strictEqual(c.isContract, false);
  ok('produto de balcão sem Consultor cai no Responsável e não vira ativação');
}

// ════════════════════════════════════════════════════════════════════
// 15-16. Contrato sem Consultor: só cai no Responsável se for inequívoco
// ════════════════════════════════════════════════════════════════════
// Consultor e Responsável concordam em só 46% — um é quem vendeu, o outro quem
// lançou. Como reserva geral pagaria a pessoa errada em mais da metade. Mas
// quando as DUAS colunas de Responsável trazem a mesma pessoa, não há conflito.
{
  const v = soUma({ ...ANUAL_LOCAL, consultor: '', resp1: 'KALI LÓPEZ', resp2: 'KALI LÓPEZ' });
  assert.strictEqual(v['Vendedor'], 'KALI DUTRA');
  ok('contrato sem Consultor mas com Responsável inequívoco: usa o Responsável');
}
{
  const r = traduz([linha({ ...ANUAL_LOCAL, consultor: '', resp1: 'ERICA FAUSTINO', resp2: 'FRANCINI DAS CHAGAS' })]);
  assert.strictEqual(r.vendas[0]['Vendedor'], '', 'não chuta entre duas pessoas diferentes');
  assert.ok(r.avisos.some(a => /vendedora/i.test(a.motivo || a)), 'e avisa: ' + JSON.stringify(r.avisos));
  ok('contrato sem Consultor e com Responsáveis divergentes: fica sem vendedora e avisa');
}

// ════════════════════════════════════════════════════════════════════
// 16b-d. Rótulo de sistema não é nome de gente
// ════════════════════════════════════════════════════════════════════
// `PACTO - MÉTODO DE GESTÃO` assina 221 linhas do Responsável#1 — é o robô da
// migração, não uma vendedora. `ADMINISTRADOR` e `RECORRENCIA` idem. Quando o
// rótulo ocupa uma das colunas, sobra UMA pessoa e não há conflito nenhum:
// tratar isso como "dois nomes diferentes" deixava 6 contratos (R$ 1.495) sem
// vendedora, e o robô ainda aparecia como vendedor no relatório.
{
  const v = soUma({ ...ANUAL_LOCAL, consultor: '', resp1: 'PACTO - MÉTODO DE GESTÃO', resp2: 'KALI LÓPEZ' });
  assert.strictEqual(v['Vendedor'], 'KALI DUTRA', 'robô no #1, gente no #2');
  ok('Responsável#1 = rótulo do sistema: vale o #2');
}
{
  const v = soUma({ ...ANUAL_LOCAL, consultor: '', resp1: 'RODRIGO ROJAIS', resp2: 'ADMINISTRADOR' });
  assert.strictEqual(v['Vendedor'], 'RODRIGO ROJAIS', 'ADMINISTRADOR não disputa com gente');
  ok('Responsável#2 = ADMINISTRADOR: vale o #1');
}
{
  const v = soUma({ ...ANUAL_LOCAL, consultor: 'PACTO - MÉTODO DE GESTÃO', resp1: 'ERICA FAUSTINO', resp2: 'ERICA FAUSTINO' });
  assert.strictEqual(v['Vendedor'], 'ERICA FAUSTINO', 'o robô no Consultor não trava a busca');
  ok('Consultor = rótulo do sistema: cai no Responsável');
}

// ════════════════════════════════════════════════════════════════════
// 16e. Venda dividida: a Pacto já traz as duas vendedoras
// ════════════════════════════════════════════════════════════════════
// 9 linhas trazem `Consultor` = "ERICA FAUSTINO, FRANCINI DAS CHAGAS". Isso é
// ganho em relação ao TecnoFit, onde a divisão era declarada à mão (julho
// precisou de 8 divisões aplicadas na tela). A divisão em si só existe na tela
// de Comissões, então aqui a venda fica com a PRIMEIRA e sai avisada — o nome
// composto viraria uma vendedora fantasma no ranking e nas metas.
{
  const r = traduz([linha({ ...ANUAL_LOCAL, consultor: 'ERICA FAUSTINO, FRANCINI DAS CHAGAS' })]);
  assert.strictEqual(r.vendas[0]['Vendedor'], 'ERICA FAUSTINO');
  const aviso = r.avisos.find(a => /divid/i.test(a.motivo));
  assert.ok(aviso, 'avisa que é dividida: ' + JSON.stringify(r.avisos));
  assert.strictEqual(aviso.comQuem, 'FRANCINI DAS CHAGAS', 'e diz com quem dividir');
  ok('venda dividida fica com a primeira vendedora e sai na lista pra dividir na tela');
}

// ════════════════════════════════════════════════════════════════════
// 17. KALI LÓPEZ e KALI DUTRA são a mesma pessoa
// ════════════════════════════════════════════════════════════════════
// Sem unificar, o histórico dela racha em duas vendedoras e as metas e o P3
// passam a contar cada metade separada.
{
  const v = soUma({ ...ANUAL_LOCAL, consultor: 'KALI LÓPEZ' });
  assert.strictEqual(v['Vendedor'], 'KALI DUTRA');
  ok('KALI LÓPEZ → KALI DUTRA (senão o histórico dela racha em duas)');
}

// ════════════════════════════════════════════════════════════════════
// 18. Unidade sai da Empresa, separada
// ════════════════════════════════════════════════════════════════════
// As metas são por unidade — CP e PP têm que sair em planilhas diferentes.
{
  const r = traduz([linha({ ...ANUAL_LOCAL, empresa: CP }), linha({ ...ANUAL_LOCAL, contrato: '9', empresa: PP })]);
  assert.strictEqual(r.porUnidade.CP.length, 1);
  assert.strictEqual(r.porUnidade.PP.length, 1);
  ok('CP e PP saem separados (as metas são por unidade)');
}

// ════════════════════════════════════════════════════════════════════
// 19. Só o mês pedido
// ════════════════════════════════════════════════════════════════════
// O mesmo arquivo traz mais de um mês, e dois exports do mesmo dia podem trazer
// períodos diferentes conforme o filtro marcado na hora de gerar.
{
  const r = traduz([
    linha({ ...ANUAL_LOCAL, lancamento: '05/08/2026' }),
    linha({ ...ANUAL_LOCAL, contrato: '9', lancamento: '28/07/2026' }),
  ]);
  assert.strictEqual(r.vendas.length, 1);
  assert.strictEqual(r.vendas[0]['Data'], '05/08/2026');
  ok('filtra pelo mês pedido (o arquivo traz mais de um)');
}

// ════════════════════════════════════════════════════════════════════
// 20. Valor em português vira número
// ════════════════════════════════════════════════════════════════════
{
  assert.strictEqual(soUma({ ...ANUAL_LOCAL, valor: '1.234,56' })['Valor Quitado/Recibo'], 1234.56);
  assert.strictEqual(soUma({ ...ANUAL_LOCAL, valor: '0,00' })['Valor Quitado/Recibo'], 0);
  ok('"1.234,56" vira 1234.56');
}

// ════════════════════════════════════════════════════════════════════
// 21. Voucher degustação continua sendo voucher
// ════════════════════════════════════════════════════════════════════
{
  const v = soUma({ ...ANUAL_LOCAL, produto: 'PLANO VOUCHER DEGUSTAÇÃO', plano: 'PLANO VOUCHER DEGUSTAÇÃO', duracao: '0' });
  const c = classifica(v);
  assert.strictEqual(c.category, 'voucher');
  assert.strictEqual(c.isEligibleP3, false);
  ok('PLANO VOUCHER DEGUSTAÇÃO cai em voucher (P1 fixo, fora do P3)');
}

// ════════════════════════════════════════════════════════════════════
// 22. Data " - " não vira período quebrado no Itens
// ════════════════════════════════════════════════════════════════════
// O "Relatório Faturamento por Período" grava " - " em Data Início/Término
// quando não há data. Sem tratar, o Itens sairia com "( -  -  - )" colado.
{
  const v = soUma({ ...ANUAL_LOCAL, inicio: ' - ', termino: ' - ' });
  assert.ok(!v['Itens'].includes('-  - '), 'sem período quebrado: ' + v['Itens']);
  assert.strictEqual(classifica(v).periodicidade, 'ANUAL', 'e o plano continua legível');
  ok('Data Início " - " não vira período quebrado no Itens');
}

// ════════════════════════════════════════════════════════════════════
// 23-24. A Pacto tem DOIS relatórios parecidos, e o errado paga 12× a mais
// ════════════════════════════════════════════════════════════════════
// `Relatório Faturamento por Período` tem exatamente as mesmas 21 colunas nas
// mesmas posições do `faturamento-recebido` — o tradutor engole os dois sem
// reclamar. Mas o valor é outro: o faturamento traz o contrato INTEIRO e o
// recebido traz a parcela que entrou. Medido no mesmo contrato 7078 (ERIKA
// ALMEIDA): R$ 259,00 no recebido, R$ 3.108,00 no faturamento — 12× exato.
// Como o motor paga 5% sobre o valor quitado, subir o arquivo errado pagaria
// R$ 155 em vez de R$ 12,95 em CADA contrato anual, sem erro nenhum na tela.
//
// O que separa os dois: `Forma Pagamento` vem 100% preenchida no recebido e
// 100% vazia no faturamento (386/386 contra 0/715 nos arquivos reais).
{
  const l = linha(ANUAL_LOCAL);
  assert.strictEqual(PA.detectarRelatorio([CABECALHO, l]), 'recebido');
  ok('reconhece o relatório certo (faturamento-recebido) pela forma de pagamento');
}
{
  const semForma = linha({ ...ANUAL_LOCAL, forma: '' });
  assert.strictEqual(PA.detectarRelatorio([CABECALHO, semForma]), 'faturamento');
  const r = traduz([semForma]);
  assert.strictEqual(r.relatorio, 'faturamento', 'e a tradução carrega o aviso junto');
  ok('reconhece o relatório errado (faturamento) — é ele que pagaria 12× a mais');
}

// ════════════════════════════════════════════════════════════════════
// 25-27. Reconhecer o arquivo da Pacto na tela de Upload
// ════════════════════════════════════════════════════════════════════
// Plugado no `index.html`, o tradutor precisa decidir sozinho se o arquivo que
// a pessoa arrastou é da Pacto ou é o formato antigo — porque o formato antigo
// ainda pode aparecer (arquivo guardado, re-upload de mês fechado) e não pode
// quebrar. O cabeçalho da Pacto tem `Nome Cliente` na posição 2 e
// `Data Lançamento` na 14; o do TecnoFit começa em `Código | Cliente | Data`.
{
  const cabecalhoPacto = [];
  for (let i = 0; i <= 21; i++) cabecalhoPacto[i] = '';
  cabecalhoPacto[2] = 'Nome Cliente'; cabecalhoPacto[4] = 'Responsável ';
  cabecalhoPacto[5] = 'Responsável '; cabecalhoPacto[14] = 'Data Lançamento';
  cabecalhoPacto[21] = 'Consultor ';
  assert.strictEqual(PA.ehExportPacto([cabecalhoPacto, linha(ANUAL_LOCAL)]), true);
  ok('reconhece o arquivo da Pacto pelo cabeçalho');
}
{
  // O formato antigo do TecnoFit, que a tela sempre aceitou
  const tecnofit = [
    ['Código', 'Cliente', 'Data', 'Itens', 'Valor Venda', 'Desconto Venda',
     'Desconto Recebimento', 'Valor Final', 'Valor Quitado/Recibo', 'Origem',
     'Tipo de Venda', 'Vendedor'],
    ['31754166587', 'FULANO', '46204', 'ACESSO LIVRE | RECORRENTE | FLEX', '419',
     '-', '-', '419', '419', 'Balcão', 'Renovação', 'ERICA FAUSTINO'],
  ];
  assert.strictEqual(PA.ehExportPacto(tecnofit), false, 'não pode confundir com o formato antigo');
  ok('NÃO confunde o formato antigo do TecnoFit com o da Pacto');
}
{
  assert.strictEqual(PA.ehExportPacto([]), false, 'arquivo vazio');
  assert.strictEqual(PA.ehExportPacto([['qualquer', 'coisa']]), false, 'planilha aleatória');
  ok('arquivo vazio ou de outro assunto não passa por export da Pacto');
}

// ════════════════════════════════════════════════════════════════════
// 28. Uma unidade por vez: o arquivo traz CP e PP juntos
// ════════════════════════════════════════════════════════════════════
// A tela sobe uma unidade por vez (`currentUnitId`), mas o export da Pacto vem
// com as duas. Subir o mesmo arquivo nas duas unidades tem que dar, em cada
// uma, só as linhas dela — senão o Campeche paga a comissão do Príncipe.
{
  const r = traduz([
    linha({ ...ANUAL_LOCAL, empresa: CP, consultor: 'ERICA FAUSTINO' }),
    linha({ ...ANUAL_LOCAL, contrato: '9001', empresa: PP, consultor: 'KALI LÓPEZ' }),
    linha({ ...ANUAL_LOCAL, contrato: '9002', empresa: PP, consultor: 'KALI LÓPEZ' }),
  ]);
  assert.deepStrictEqual(r.porUnidade.CP.map(v => v['Vendedor']), ['ERICA FAUSTINO']);
  assert.deepStrictEqual(r.porUnidade.PP.map(v => v['Vendedor']), ['KALI DUTRA', 'KALI DUTRA']);

  // É assim que a tela monta o que entrega ao motor
  const planilhaPP = [PA.CABECALHO_SAIDA, ...PA.paraPlanilha(r.porUnidade.PP)];
  const rows = CE.cleanRawData(planilhaPP);
  assert.strictEqual(rows.length, 2, 'o motor recebe só as 2 do Príncipe');
  assert.ok(rows.every(x => x['Vendedor'] === 'KALI DUTRA'));
  ok('mesmo arquivo, uma unidade por vez: cada upload leva só as linhas da sua');
}

// ════════════════════════════════════════════════════════════════════
// 29. O que ficou de fora também é por unidade
// ════════════════════════════════════════════════════════════════════
// Subindo o Campeche, a tela não pode listar os contratos migrados do Príncipe
// — a pessoa conferindo CP ficaria procurando nomes que não são dela.
{
  const r = traduz([
    linha({ ...IMP, ...{ inicio: '07/01/2026', termino: '06/01/2027' }, empresa: CP, nome: 'DO CAMPECHE' }),
    linha({ ...IMP, ...{ inicio: '07/01/2026', termino: '06/01/2027' }, contrato: '9003', empresa: PP, nome: 'DO PRINCIPE' }),
    linha({ ...ANUAL_LOCAL, contrato: '9004', empresa: PP, nome: 'OUTRO DO PRINCIPE',
            inicio: '07/01/2026', termino: '06/01/2027', forma: 'PIX - RECEBIMENTO TECNOFIT' }),
  ]);
  assert.strictEqual(r.migrados.length, 2);
  assert.deepStrictEqual(r.migrados.filter(m => m.unidade === 'CP').map(m => m.cliente), ['DO CAMPECHE']);
  assert.deepStrictEqual(r.migrados.filter(m => m.unidade === 'PP').map(m => m.cliente), ['DO PRINCIPE']);
  assert.strictEqual(r.descartadas[0].unidade, 'PP', 'descartada também sabe a unidade');
  ok('migrados e descartadas carregam a unidade, pra tela filtrar');
}

console.log('\n' + n + '/' + n + ' casos passaram.');
