'use strict';
// Roda: node scripts/smoke-diferido-e-registro-de-teste.js
//
// ══════════════════════════════════════════════════════════════════════
// DOIS DEFEITOS ACHADOS EM 08/09/2026, cruzando o pedido do Rodrigo
// ══════════════════════════════════════════════════════════════════════
//
// O Rodrigo pediu: "cruze as vendas de agosto e confirme quais foram pagas".
// Fazendo o cruzamento contra os arquivos reais, a conta bateu com a tela —
// e sobraram duas coisas erradas.
//
// ── 1. A VENDA DIFERIDA APARECE COMO "SEM PAGAMENTO" ──
//
// `codigosDeContrato` (index.html) derivava a lista de contratos pagos só dos
// itens `processed`. O item DIFERIDO ficava de fora — e diferido é uma venda
// PAGA cuja comissão foi empurrada para o mês em que o plano começa.
//
// Em produção, hoje, a aba "A receber" do Príncipe diz "12 vendas arrastando —
// são estas que merecem conversa" e duas delas já pagaram:
//
//   JULIANA COSTA        C4652  R$ 3.150,00 pagos em 28/08  (plano começa 15/10)
//   JAQUELINE FREIBERGER C4636  R$   199,00 pagos em 24/08  (plano começa 13/11)
//
// A tela manda cobrar quem pagou. E há o outro lado, que ainda não aconteceu:
// como o código diferido não entra em `codigosPagos`, se o contrato reaparecer
// no relatório do mês em que o plano começa, o regime de caixa não o reconhece
// e paga comissão DE NOVO, por cima da diferida já agendada.
//
// ⚠️ `excluded` NÃO entra, de propósito: item excluído não gerou comissão
//    nenhuma, e bloqueá-lo negaria em silêncio uma comissão devida.
//
// ── 2. REGISTRO DE TESTE DENTRO DO CÁLCULO ──
//
// `VendasAguardando.ehTeste` tirou o `TESTE ENDEREÇO TECNOFIT` da tela de
// vendas em 07/09 (`a72a24a`), e ficou registrado que não havia efeito em
// dinheiro — verdade para AQUELE caminho: `commission.js` não conhece
// `vendasDoMes`.
//
// Só que o mesmo cliente-fantasma também aparece no relatório de RECEBIDOS, e
// esse alimenta o cálculo. Medido no arquivo real de setembro (01–08/09):
//
//   TESTE ENDEREÇO TECNOFIT · C4688 R$ 100 + C4688-2 R$ 668
//   → Príncipe com +1 ativação e +R$ 768,00 de caixa
//
// É a causa do aviso "registros sem vendedor identificado" na tela do PP. E
// pesa agora porque é sobre esse número que a meta do mês vai ser calibrada.
//
// ⚠️ A regra mora num lugar SÓ (`PactoAdapter.ehRegistroDeTeste`). Duas cópias
//    da mesma regra é como a folha de pagamento duplicou bolsa por dois meses
//    (ver closing-payroll.js).

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const PA = require(path.join(__dirname, '..', 'pacto-adapter.js'));
const VA = require(path.join(__dirname, '..', 'vendas-aguardando.js'));
const CE = require(path.join(__dirname, '..', 'commission.js'));

let n = 0;
const ok = m => { n++; console.log('  ✔ ' + m); };

// ─── Linha crua da Pacto, por POSIÇÃO ───
const COL = {
  matricula: 1, nome: 2, cadastro: 3, resp1: 4, resp2: 5, produto: 6, contrato: 7,
  inicio: 8, termino: 9, duracao: 10, modalidades: 11, plano: 12, situacao: 13,
  lancamento: 14, valor: 15, forma: 16, condicao: 17, empresa: 18, turma: 19,
  categoria: 20, consultor: 21,
};
const PP = 'CROSSTAINER UNID. PRINCIPE (PP)';
function linha(o) {
  const r = [];
  for (let i = 0; i <= 21; i++) r[i] = '';
  const d = {
    nome: 'FULANO DE TAL', matricula: '1', cadastro: '01/09/2026',
    resp1: 'KALI DUTRA', resp2: 'KALI DUTRA', contrato: '0',
    inicio: '', termino: '', duracao: '0', modalidades: '', plano: '',
    situacao: 'Matrícula', lancamento: '05/09/2026', valor: '100,00',
    forma: 'CARTÃO DE CRÉDITO', condicao: '1X', empresa: PP,
    turma: '', categoria: '', produto: '', consultor: 'KALI DUTRA',
    ...o,
  };
  Object.keys(COL).forEach(k => { r[COL[k]] = d[k] === undefined ? '' : d[k]; });
  return r;
}
const CABECALHO = linha({ nome: 'Nome Cliente' });
const traduz = (linhas, opts) => PA.traduzir([CABECALHO, ...linhas], { mes: '2026-09', ...opts });

/** Recorta uma função do index.html contando chaves — nunca por marcador de texto.
 *  (o arquivo é CRLF: um marcador com \n puro não casa e recorta o arquivo inteiro) */
function recortar(html, nome) {
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

console.log('\n=== 1. A venda diferida conta como paga ===\n');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(recortar(html, 'function codigosDeContrato('), sandbox);
// ⚠️ O array devolvido nasce DENTRO do sandbox, num realm diferente: seu
// protótipo não é o `Array.prototype` daqui, e `deepStrictEqual` reprova mesmo
// com o conteúdo idêntico. O spread traz os valores para este realm.
const codigosDeContrato = itens => [...sandbox.codigosDeContrato(itens)];

// 1. o diferido entra
{
  const r = codigosDeContrato([
    { codigo: 'C4700', type: 'processed' },
    { codigo: 'C4652', type: 'deferred' },   // Juliana Costa: pagou, comissão em outubro
  ]);
  assert.deepStrictEqual(r, ['C4652', 'C4700'],
    'o contrato DIFERIDO tem que entrar: o dinheiro entrou, a comissão só foi adiada');
  ok('contrato diferido entra em codigosPagos');
}

// 2. o excluído continua fora
{
  const r = codigosDeContrato([
    { codigo: 'C4700', type: 'processed' },
    { codigo: 'C4801', type: 'excluded' },
  ]);
  assert.deepStrictEqual(r, ['C4700'],
    'excluído NÃO entra: não gerou comissão, e bloqueá-lo negaria uma comissão devida');
  ok('contrato excluído segue fora de codigosPagos');
}

// 3. o efeito na tela: a venda diferida sai da lista de "merecem conversa"
{
  const venda = {
    contrato: 'C4652', cliente: 'JULIANA COSTA', valorContrato: 3150,
    vendedores: ['RODRIGO', 'KALI DUTRA'], situacao: 'Renovação',
    data: '28/08/2026', inicio: '15/10/2026', mes: '2026-08', unidade: 'PP',
  };
  const semDiferido = VA.cruzar([venda], ['C4700'], []);
  assert.strictEqual(semDiferido.aguardando.length, 1, 'antes: a tela cobrava quem pagou');

  const comDiferido = VA.cruzar([venda], codigosDeContrato([
    { codigo: 'C4652', type: 'deferred' },
  ]), []);
  assert.strictEqual(comDiferido.aguardando.length, 0,
    'depois: quem pagou não aparece mais como venda a cobrar');
  assert.strictEqual(comDiferido.pagas.length, 1);
  ok('a Juliana Costa (R$ 3.150 pagos em 28/08) sai da lista de cobrança');
}

console.log('\n=== 2. Registro de teste não é venda, nem no cálculo ===\n');

// 4. a regra existe no PactoAdapter — o lugar por onde o dinheiro passa
{
  assert.strictEqual(typeof PA.ehRegistroDeTeste, 'function',
    'a regra tem que morar no PactoAdapter: é ele que alimenta o commission.js');
  assert.ok(PA.ehRegistroDeTeste(linha({ nome: 'TESTE ENDEREÇO TECNOFIT' })));
  assert.ok(!PA.ehRegistroDeTeste(linha({ nome: 'KARIN SILVA' })));
  ok('PactoAdapter.ehRegistroDeTeste reconhece o registro de teste');
}

// 5. ⚠️ PALAVRA INTEIRA — existe uma cliente de verdade chamada ESTEFANE.
//    Casamento por pedaço já apagou dado real neste repo (BIANUAL lido como
//    ANUAL, `6f0a15b`). Aqui um falso positivo apaga a venda de alguém.
{
  ['ESTEFANE COUTINHO CAMPOS', 'ERNESTES ALVES', 'TESTEMUNHA DA SILVA'].forEach(nome => {
    assert.ok(!PA.ehRegistroDeTeste(linha({ nome })),
      nome + ' é gente de verdade e não pode ser confundida com registro de teste');
  });
  ok('cliente real com "teste" dentro do nome não é apagada');
}

// 6. a linha de teste não chega ao cálculo — e sai LISTADA, não em silêncio
{
  const r = traduz([
    linha({ nome: 'TESTE ENDEREÇO TECNOFIT', contrato: '4688', valor: '668,00', situacao: 'Novo Contrato', plano: 'MENSAL' }),
    linha({ nome: 'KARIN SILVA', contrato: '4689', valor: '250,00', plano: 'MENSAL' }),
  ]);
  const nomes = (r.porUnidade.PP || []).map(v => v.Cliente);
  assert.deepStrictEqual(nomes, ['KARIN SILVA'], 'o registro de teste não entra no cálculo');
  assert.strictEqual((r.testes || []).length, 1,
    'e sai no balde `testes`, para a tela poder DIZER que tirou');
  ok('a linha de teste fica fora do cálculo e aparece no balde `testes`');
}

// 7. o efeito medido: 1 ativação e R$ 768 a menos no Príncipe
{
  const linhas = [
    linha({ nome: 'TESTE ENDEREÇO TECNOFIT', contrato: '4688', valor: '100,00', plano: 'MENSAL' }),
    linha({ nome: 'TESTE ENDEREÇO TECNOFIT', contrato: '4688', valor: '668,00', situacao: 'Novo Contrato', plano: 'MENSAL' }),
    linha({ nome: 'KARIN SILVA', contrato: '4689', valor: '250,00', plano: 'MENSAL' }),
  ];
  const puro = v => { const o = {}; PA.CABECALHO_SAIDA.forEach(h => o[h] = v[h]); return o; };
  const vendas = (traduz(linhas).porUnidade.PP || []).map(puro);
  const res = CE.calculate(vendas, { ...CE.defaultConfig }, {});
  assert.strictEqual(res.unitTotals.unitCaixa, 250,
    'os R$ 768 do registro de teste não podem entrar no caixa da unidade');
  ok('o caixa do Príncipe não carrega mais o registro de teste');
}

// 8. a prévia do upload DIZ que tirou — sumir calado é o defeito irmão
{
  const sb = { console, fmt: n => Number(n || 0).toFixed(2) };
  vm.createContext(sb);
  vm.runInContext(recortar(html, 'function pactoResumoHtml('), sb);
  const out = sb.pactoResumoHtml({
    mes: '2026-09', meses: { '2026-09': 1 },
    testes: [{ cliente: 'TESTE ENDEREÇO TECNOFIT', valor: 768, unidade: 'PP' }],
  }, 'PP');
  assert.ok(/TESTE ENDEREÇO TECNOFIT/.test(out),
    'a prévia tem que listar o registro de teste que ficou de fora');
  assert.ok(/768/.test(out), 'com o valor, para a gestão bater com a conta dela');
  ok('a prévia do upload mostra o registro de teste descartado');
}

// 9. uma regra só: a tela de vendas usa a MESMA função
{
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'vendas-aguardando.js'), 'utf8');
  assert.ok(/ehNomeDeTeste/.test(fonte),
    'VendasAguardando.ehTeste tem que delegar — duas cópias da regra divergem um dia');
  assert.ok(VA.ehTeste({ cliente: 'TESTE ENDEREÇO TECNOFIT' }));
  assert.ok(!VA.ehTeste({ cliente: 'ESTEFANE COUTINHO CAMPOS' }));
  ok('a regra de "é teste" existe num lugar só');
}

console.log('\n' + n + '/' + n + ' ✅\n');
