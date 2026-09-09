'use strict';
// Roda: node scripts/smoke-conferencia-pelo-pagamento.js
//
// ══════════════════════════════════════════════════════════════════════
// A CONFERÊNCIA PASSOU A PARTIR DO PAGAMENTO
// ══════════════════════════════════════════════════════════════════════
//
// A tela de 07/09 perguntava sobre a VENDA ("esta venda foi paga?"), com três
// botões: Já foi paga · Ainda a receber · Não vamos cobrar. O Rafael olhou em
// uso e corrigiu a direção:
//
//   · "não vamos cobrar" não existe na prática — o que existe é o CLIENTE
//     DESISTIR;
//   · "ainda a receber" é o estado em que a venda JÁ está, o botão repetia o
//     óbvio;
//   · "já foi paga" tem que sair sozinho quando o sistema casa o contrato — e
//     quando não casa, precisa APONTAR UM PAGAMENTO REAL do relatório.
//
// A última é a que mais muda: sem dinheiro real por trás, não há o que apontar.
// Isso elimina a marcação no vazio.
//
// ⚠️ MARCAÇÃO NUNCA GERA COMISSÃO. Ela explica a venda; quem paga é o dinheiro
//    que apareceu no relatório. `commission.js` não conhece `vendasDoMes`.
//
// Desenho: docs/superpowers/specs/2026-09-09-conferencia-parte-do-pagamento-design.md

const assert = require('assert');
const path = require('path');
const VA = require(path.join(__dirname, '..', 'vendas-aguardando.js'));

let n = 0;
const ok = m => { n++; console.log('  ✔ ' + m); };

/** O caso real: a Cátia renovou no C7130 e existe um pagamento no C6867. */
const VENDA_CATIA = {
  contrato: 'C7130', cliente: 'CÁTIA TEREZINHA PEREIRA TORRES', valorContrato: 2388,
  vendedores: ['FRANCINI DAS CHAGAS'], situacao: 'Renovação', data: '27/08/2026',
  inicio: '02/09/2026', mes: '2026-08', unidade: 'PP',
};
const PGTO_CATIA = {
  cliente: 'CÁTIA TEREZINHA PEREIRA TORRES', codigo: 'C6867',
  valor: 199, data: '12/08/2026', vendedor: 'FRANCINI DAS CHAGAS',
};

console.log('\n=== 1. O que o sistema resolve sozinho ===\n');

// 1. contrato bateu → sai da fila, sem pergunta nenhuma
{
  const r = VA.cruzar([VENDA_CATIA], ['C7130'], []);
  assert.strictEqual(r.pagas.length, 1);
  assert.strictEqual(r.aguardando.length + r.conferir.length, 0,
    'contrato que bateu não pode gerar pergunta para ninguém');
  ok('contrato bateu: a venda sai da fila sozinha');
}

// 2. nome bateu e contrato não → vira dúvida, com o pagamento junto
{
  const r = VA.cruzar([VENDA_CATIA], [], [PGTO_CATIA]);
  assert.strictEqual(r.conferir.length, 1, 'mesmo nome, outro contrato = dúvida');
  assert.strictEqual(r.conferir[0].pagamentoQueBateu.codigo, 'C6867',
    'a dúvida carrega o pagamento que a levantou — a tela pergunta a partir dele');
  ok('nome bateu, contrato não: vira dúvida carregando o pagamento');
}

console.log('\n=== 2. A pergunta parte do PAGAMENTO ===\n');

// 3. a tela precisa da lista invertida: um pagamento, as vendas candidatas
{
  assert.strictEqual(typeof VA.duvidasPorPagamento, 'function',
    'a tela pergunta "este pagamento é de qual venda?" — precisa da lista por pagamento');
  const r = VA.cruzar([VENDA_CATIA], [], [PGTO_CATIA]);
  const d = VA.duvidasPorPagamento(r);
  assert.strictEqual(d.length, 1, 'um pagamento em dúvida');
  assert.strictEqual(d[0].pagamento.codigo, 'C6867');
  assert.strictEqual(d[0].candidatas.length, 1);
  assert.strictEqual(d[0].candidatas[0].contrato, 'C7130');
  ok('duvidasPorPagamento devolve o pagamento e as vendas candidatas');
}

// 4. mesmo cliente com DUAS vendas em aberto: o pagamento oferece as duas
{
  const outra = { ...VENDA_CATIA, contrato: 'C7999', valorContrato: 199, data: '29/08/2026' };
  const r = VA.cruzar([VENDA_CATIA, outra], [], [PGTO_CATIA]);
  const d = VA.duvidasPorPagamento(r);
  assert.strictEqual(d.length, 1, 'é UM pagamento, não dois — a pergunta é uma só');
  assert.deepStrictEqual(d[0].candidatas.map(v => v.contrato).sort(), ['C7130', 'C7999'],
    'e ele oferece as duas vendas em aberto daquela pessoa');
  ok('um pagamento com duas vendas candidatas vira UMA pergunta com duas opções');
}

console.log('\n=== 3. Os desfechos novos ===\n');

// 5. apontar o pagamento: a venda sai da fila e guarda QUAL dinheiro era
{
  const r = VA.cruzar([VENDA_CATIA], [], [PGTO_CATIA]);
  const marcado = VA.aplicarConferencias(r, {
    C7130: { desfecho: 'paga', pagamentoApontado: PGTO_CATIA, por: 'Rafael', em: '09/09/2026' },
  });
  assert.strictEqual(marcado.pagas.length, 1);
  assert.strictEqual(marcado.conferir.length, 0, 'e para de perguntar');
  assert.strictEqual(marcado.pagas[0].conferencia.pagamentoApontado.codigo, 'C6867',
    'a venda carrega qual pagamento a explicou — senão a decisão morre na cabeça de quem decidiu');
  ok('"paga" com pagamento apontado tira a venda da fila e registra o dinheiro');
}

// 6. cliente desistiu: some da fila
{
  const r = VA.cruzar([VENDA_CATIA], [], []);
  const marcado = VA.aplicarConferencias(r, {
    C7130: { desfecho: 'cancelada', observacao: 'desistiu antes de começar', por: 'Rafael' },
  });
  assert.strictEqual(marcado.aguardando.length, 0);
  assert.strictEqual((marcado.canceladas || []).length, 1,
    'a venda cancelada tem grupo próprio — ela não é "paga" nem "aguardando"');
  ok('"cancelada" (cliente desistiu) tira a venda da fila');
}

// 7. "de nenhuma delas": o sistema para de perguntar POR AQUELE PAGAMENTO
{
  const r = VA.cruzar([VENDA_CATIA], [], [PGTO_CATIA]);
  const marcado = VA.aplicarConferencias(r, {}, { 'C6867': { desfecho: 'sem_venda', por: 'Rafael' } });
  assert.strictEqual(VA.duvidasPorPagamento(marcado).length, 0,
    'o pagamento descartado não pode voltar a perguntar amanhã');
  assert.strictEqual(marcado.aguardando.length, 1,
    'e a venda continua na fila — ela não foi paga, só não foi por AQUELE dinheiro');
  ok('"de nenhuma delas" cala a pergunta e deixa a venda na fila');
}

console.log('\n=== 4. As travas ===\n');

// 8. um pagamento explica UMA venda só
{
  assert.strictEqual(typeof VA.pagamentoJaApontado, 'function');
  const conferencias = {
    C7130: { desfecho: 'paga', pagamentoApontado: { codigo: 'C6867' }, cliente: 'CÁTIA' },
  };
  const usado = VA.pagamentoJaApontado(conferencias, 'C6867', 'C7999');
  assert.ok(usado, 'tem que recusar: o mesmo dinheiro não explica dois contratos');
  assert.strictEqual(usado.contrato, 'C7130', 'e dizer em qual venda ele já está');
  assert.strictEqual(VA.pagamentoJaApontado(conferencias, 'C6867', 'C7130'), null,
    'mas a própria venda pode reapontar o mesmo pagamento — não é conflito');
  assert.strictEqual(VA.pagamentoJaApontado(conferencias, 'C0001', 'C7999'), null);
  ok('um pagamento não pode explicar duas vendas');
}

// 9. 🚨 O DINHEIRO SEMPRE GANHA — de qualquer marcação
{
  const r = VA.cruzar([VENDA_CATIA], ['C7130'], []);
  const marcado = VA.aplicarConferencias(r, {
    C7130: { desfecho: 'cancelada', por: 'Rafael', observacao: 'achei que tinha desistido' },
  });
  assert.strictEqual(marcado.pagas.length, 1, 'o pagamento vale mais que a marcação');
  assert.strictEqual((marcado.canceladas || []).length, 0);
  assert.ok(marcado.pagas[0].marcacaoIgnorada,
    'e a tela TEM que dizer que havia marcação em contrário, senão parece que o sistema esqueceu');
  ok('dinheiro que entrou vence "cliente desistiu", e a tela diz que venceu');
}

// 10. desfecho desconhecido não move nada (defesa contra dado velho ou digitado)
{
  const r = VA.cruzar([VENDA_CATIA], [], []);
  const marcado = VA.aplicarConferencias(r, { C7130: { desfecho: 'sei_la' } });
  assert.strictEqual(marcado.aguardando.length, 1, 'na dúvida, a venda fica onde estava');
  assert.strictEqual((marcado.canceladas || []).length, 0);
  ok('desfecho desconhecido não move a venda de lugar');
}

console.log('\n=== 5. A contagem e o resumo acompanham ===\n');

// 11. `canceladas` entra na contagem por vendedora e no resumo
{
  const r = VA.cruzar([VENDA_CATIA], [], []);
  const marcado = VA.aplicarConferencias(r, { C7130: { desfecho: 'cancelada' } });
  const porV = VA.contarPorVendedora(marcado, []);
  const f = porV['FRANCINI DAS CHAGAS'];
  assert.ok(f, 'a vendedora tem que aparecer mesmo com a venda cancelada');
  assert.strictEqual(f.canceladas, 1);
  assert.strictEqual(f.vendidas, 1, 'ela vendeu — o cliente é que desistiu');
  const res = VA.resumo(marcado);
  assert.strictEqual(res.canceladas, 1);
  assert.strictEqual(res.vendidas, res.pagas + res.aguardando + res.conferir + res.canceladas,
    'a conta do mês tem que fechar, senão a tabela por pessoa soma menos que o total');
  ok('canceladas entra na contagem por vendedora e fecha a conta do mês');
}

console.log('\n=== 6. A tela, RODANDO ===\n');

// Ler o texto do arquivo não prova nada — é como a prévia da escala passou por
// 12 testes sem nunca ter rodado. Aqui as funções são recortadas do index.html
// pela ASSINATURA (nunca por texto de comentário, que já quebrou dois scripts
// em 08/09) e chamadas de verdade.
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function recortar(nome) {
  const ini = html.indexOf(nome);
  assert.ok(ini > 0, nome + ' não existe no index.html');
  let nivel = 0, fim = -1;
  for (let j = html.indexOf('{', ini); j < html.length; j++) {
    if (html[j] === '{') nivel++;
    else if (html[j] === '}') { nivel--; if (!nivel) { fim = j + 1; break; } }
  }
  assert.ok(fim > ini, 'não achei o fim de ' + nome);
  return html.slice(ini, fim);
}
const sb = { console, VendasAguardando: VA };
vm.createContext(sb);
vm.runInContext(recortar('function mesPorExtenso('), sb);
vm.runInContext(recortar('function linhaConferencia('), sb);

// 12. o título diz DE QUE MÊS é a lista — era a confusão entre os dois blocos
{
  assert.strictEqual(sb.mesPorExtenso(2026, 9), 'setembro de 2026');
  assert.strictEqual(sb.mesPorExtenso(2026, 8), 'agosto de 2026');
  assert.strictEqual(sb.mesPorExtenso(2026, 3), 'março de 2026');
  ok('o mês sai por extenso, para o título dizer de qual lista se trata');
}

// 13. sem pagamento na mesa, só a desistência — nada de marcar "paga" no vazio
{
  const semPgto = sb.linhaConferencia({ contrato: 'C4606', cliente: 'DJEINI' }, true);
  const d = [...semPgto.matchAll(/data-desfecho="([^"]*)"/g)].map(m => m[1]);
  assert.deepStrictEqual(d, ['cancelada'],
    'sem dinheiro para apontar, "já foi paga" não pode nem aparecer');
  ok('venda sem pagamento oferece só "cliente desistiu"');
}

// 14. com pagamento, a pergunta de verdade: é este, ou não é?
{
  const comPgto = sb.linhaConferencia({ ...VENDA_CATIA, pagamentoQueBateu: PGTO_CATIA }, true);
  const d = [...comPgto.matchAll(/data-desfecho="([^"]*)"/g)].map(m => m[1]);
  assert.deepStrictEqual(d, ['paga', 'sem_venda', 'cancelada']);
  assert.ok(/C6867/.test(comPgto), 'a prova (o pagamento) tem que aparecer junto da pergunta');
  ok('venda com pagamento em dúvida oferece os três, com a prova ao lado');
}

// 15. a proteção contra injeção vale para os botões novos
{
  const venenosa = { contrato: "C7130'+alert(1)+'", cliente: 'FULANA',
                     pagamentoQueBateu: PGTO_CATIA };
  const out = sb.linhaConferencia(venenosa, true);
  for (const oc of [...out.matchAll(/onclick="([^"]*)"/g)].map(m => m[1])) {
    assert.strictEqual(oc, 'registrarConferencia(this.dataset.contrato, this.dataset.desfecho)',
      'nada de dado interpolado no onclick — o valor vai por data-, lido do dataset');
  }
  ok('contrato com aspas simples continua sem injetar JS nos botões novos');
}

// 16. quem não é Admin não ganha botão nenhum, com ou sem pagamento
{
  assert.ok(!/<button/i.test(sb.linhaConferencia({ ...VENDA_CATIA, pagamentoQueBateu: PGTO_CATIA }, false)));
  assert.ok(!/<button/i.test(sb.linhaConferencia({ contrato: 'C1', cliente: 'X' }, false)));
  ok('a decisão continua só do Admin');
}

// 17. depois de decidir, a linha diz o que foi decidido EM PORTUGUÊS.
//     A tela guarda `paga`/`cancelada`, mas quem lê é gente: se o rótulo não
//     for traduzido, a confirmação do clique sai como "✓ paga" — código cru na
//     cara da gestão, no exato momento em que ela quer conferir se acertou.
{
  const paga = sb.linhaConferencia({ ...VENDA_CATIA, pagamentoQueBateu: PGTO_CATIA,
    conferencia: { desfecho: 'paga', por: 'Rafael', em: '09/09/2026' } }, true);
  assert.ok(/✓ <strong>É este pagamento<\/strong>/.test(paga),
    'venda apontada tem que confirmar "É este pagamento", não o código `paga`');

  const desistiu = sb.linhaConferencia({ contrato: 'C4606', cliente: 'DJEINI',
    conferencia: { desfecho: 'cancelada', por: 'Rafael', em: '09/09/2026' } }, true);
  assert.ok(/✓ <strong>Cliente desistiu<\/strong>/.test(desistiu),
    'venda desistida tem que confirmar "Cliente desistiu", não o código `cancelada`');

  // E o vocabulário velho não pode sobreviver em canto nenhum da tela: os
  // desfechos `paga_outro_contrato` / `a_receber` / `nao_cobrar` deixaram de
  // ser gravados em 09/09, e "Não vamos cobrar" foi justamente o rótulo que o
  // Rafael mandou tirar — a academia não decide parar de cobrar.
  assert.ok(!/Não vamos cobrar|Ainda a receber/.test(paga + desistiu),
    'rótulo do desenho antigo não pode aparecer na tela nova');
  ok('a linha da venda já conferida fala português, sem sobra do desenho antigo');
}

console.log('\n' + n + '/' + n + ' ✅\n');
