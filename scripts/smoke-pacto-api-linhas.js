'use strict';
// Roda: node scripts/smoke-pacto-api-linhas.js
//
// O conversor da API da Pacto → linhas no formato do export `faturamento-recebido`.
// Desenho: docs/superpowers/specs/2026-09-13-pacto-api-modo-sombra-design.md
//
// Todos os dados aqui são INVENTADOS — o repositório é público.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const L = require(path.join(raiz, 'pacto-api-linhas.js'));
const PA = require(path.join(raiz, 'pacto-adapter.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

const CPF = '123.456.789-00';
const NASC = '02/12/1981';
const aluno = (codigo, nome) => ({ codigo, nome, cpf: CPF, dataNascimento: NASC, matriculaSesc: null,
  responsavel: '', cpfResponsavel: CPF });

function resumoBase() {
  return {
    contratosLancados: [
      { codigo: 9001, inicio: '05/08/2026', fim: '04/08/2027', duracao: 12, consultor: 'CONSULTORA TESTE UM',
        aluno: aluno(501, 'CLIENTE FICTICIO A') },
    ],
    pagamentos: [
      { codigo: 1, data: '05/08/2026 10:11:12', responsavelLancamento: 'CONSULTORA TESTE UM', unidadeCodigo: 1,
        aluno: aluno(501, 'CLIENTE FICTICIO A'), formas: [{ formaPagamento: 'PIX', valor: 239 }],
        parcelasPagas: [{ codigo: 11, codigoContrato: 9001, descricao: 'PARCELA 1', valor: 239, valorJuro: 0, valorMulta: 0 }] },
      { codigo: 2, data: '05/08/2026', responsavelLancamento: 'RECORRENCIA', unidadeCodigo: 1,
        aluno: aluno(502, 'CLIENTE FICTICIO B'), formas: [{ formaPagamento: 'CARTÃO DE CRÉDITO', valor: 398 }],
        parcelasPagas: [
          { codigo: 21, codigoContrato: 9002, descricao: 'PARCELA 3', valor: 199, valorJuro: 0, valorMulta: 0 },
          { codigo: 22, codigoContrato: 9002, descricao: 'PARCELA 4', valor: 199, valorJuro: 0, valorMulta: 0 },
        ] },
      { codigo: 3, data: '05/08/2026', responsavelLancamento: 'CONSULTORA TESTE DOIS', unidadeCodigo: 1,
        aluno: aluno(503, 'CLIENTE FICTICIO C'), formas: [{ formaPagamento: 'PIX', valor: 5 }],
        parcelasPagas: [{ codigo: 555, codigoContrato: null, descricao: 'VENDA AVULSA', valor: 5, valorJuro: 0, valorMulta: 0 }] },
      { codigo: 4, data: '05/08/2026', responsavelLancamento: 'CONSULTORA TESTE DOIS', unidadeCodigo: 1,
        aluno: aluno(504, 'CLIENTE FICTICIO D'), formas: [{ formaPagamento: 'CREDITO CONTA CLIENTE', valor: 74.36 }],
        parcelasPagas: [{ codigo: 41, codigoContrato: 9004, descricao: 'PARCELA RENEGOCIADA', valor: 74.36, valorJuro: 0, valorMulta: 0 }] },
    ],
    vendaAvulsa: [
      { codigo: 70, produto: 'ÁGUA SEM GÁS', totalFinal: 5, consultor: 'CONSULTORA TESTE DOIS',
        vendaAvulsaParcela: [{ codigo: 555, situacao: 'PG', valor: 5 }], aluno: aluno(503, 'CLIENTE FICTICIO C') },
      { codigo: 71, produto: 'SOFT BAR', totalFinal: 12, consultor: 'CONSULTORA TESTE DOIS',
        vendaAvulsaParcela: [{ codigo: 777, situacao: 'PG', valor: 12 }], aluno: aluno(505, 'PASSANTE') },
      { codigo: 72, produto: 'CAMISETA', totalFinal: 90, consultor: 'CONSULTORA TESTE DOIS',
        vendaAvulsaParcela: [{ codigo: 778, situacao: 'EA', valor: 90 }], aluno: aluno(506, 'CLIENTE FICTICIO E') },
    ],
    estornos: [{ codigoRecibo: 99, pgtoEstornado: 50 }],
    estornosContrato: [{ codigoContrato: 9010, valorPagoEstornado: 120.5 }],
  };
}

function caderninho() {
  return new Map([
    ['9001', L.limparContrato({ codigo: 9001, situacaoContrato: 'Matrícula', nomePlano: 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO.',
      codigoPlano: 7, vigenciaDe: '05/08/2026', vigenciaAteAjustada: '04/08/2027', numeroMeses: 12, cpf: CPF }, 'PP', 'CONSULTORA TESTE UM')],
    ['9002', L.limparContrato({ codigo: 9002, situacaoContrato: 'Renovação', nomePlano: 'HIIT/MAROMBINHA | RECORRENTE | 3X | PADRÃO.',
      codigoPlano: 8, vigenciaDe: '01/06/2026', vigenciaAteAjustada: '30/06/2027', numeroMeses: 1 }, 'PP', null)],
    ['9004', L.limparContrato({ codigo: 9004, situacaoContrato: 'Renovação', nomePlano: 'HIIT/MAROMBINHA | ANUAL | LOCAL | 3X | PADRÃO.',
      codigoPlano: 9, vigenciaDe: '01/01/2026', vigenciaAteAjustada: '31/12/2026', numeroMeses: 12 }, 'PP', null)],
  ]);
}

const campo = (linha, k) => linha[L.COL[k]];

/* 1. o que vira linha e o que fica de fora */
const pp = L.montar({ resumo: resumoBase(), contratos: caderninho(), unidade: 'PP', dia: '2026-08-05' });
{
  assert.strictEqual(pp.linhas.length, 4, 'A (1) + B (2) + C (1) = 4 linhas: ' + pp.linhas.length);
  assert.ok(pp.foraDeProposito.some(f => f.recibo === 4 && /crédito da conta/.test(f.motivo)),
    'recibo pago só com crédito em conta fica de fora');
  assert.ok(pp.foraDeProposito.some(f => /balcão sem recibo/.test(f.motivo) && f.valor === 12),
    'vendinha paga sem recibo fica de fora');
  assert.ok(!pp.foraDeProposito.some(f => f.valor === 90), 'venda em aberto (EA) não é vendinha paga');
  assert.deepStrictEqual(pp.totais.vendinhasSemRecibo, { qtd: 1, valor: 12 });
  ok('quatro linhas; crédito em conta e vendinha sem recibo ficam de fora, com motivo');
}

/* 2. a linha de contrato tem o que o tradutor precisa */
{
  const a = pp.linhas.find(l => campo(l, 'contrato') === '9001');
  assert.ok(a, 'linha do contrato 9001');
  assert.strictEqual(a.length, 22, 'mesmo tamanho da linha do export');
  assert.strictEqual(campo(a, 'nome'), 'CLIENTE FICTICIO A');
  assert.strictEqual(campo(a, 'situacao'), 'Matrícula');
  assert.strictEqual(campo(a, 'plano'), 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO.');
  assert.strictEqual(campo(a, 'produto'), campo(a, 'plano'));
  assert.strictEqual(campo(a, 'duracao'), '12');
  assert.strictEqual(campo(a, 'inicio'), '05/08/2026');
  assert.strictEqual(campo(a, 'termino'), '04/08/2027');
  assert.strictEqual(campo(a, 'valor'), '239,00');
  assert.strictEqual(campo(a, 'lancamento'), '05/08/2026', 'data sem hora');
  assert.strictEqual(campo(a, 'empresa'), 'CROSSTAINER UNID. PEQ PRÍNCIPE (PP)');
  assert.strictEqual(campo(a, 'consultor'), 'CONSULTORA TESTE UM');
  assert.strictEqual(campo(a, 'resp1'), 'CONSULTORA TESTE UM');
  assert.strictEqual(campo(a, 'forma'), 'PIX');
  assert.strictEqual(PA.unidadeDe(a), 'PP', 'o tradutor reconhece a unidade da linha');
  ok('linha de contrato carrega plano, situação, datas, valor, unidade e consultora');
}

/* 3. avulsa leva o nome do produto */
{
  const c = pp.linhas.find(l => campo(l, 'nome') === 'CLIENTE FICTICIO C');
  assert.strictEqual(campo(c, 'contrato'), '0');
  assert.strictEqual(campo(c, 'produto'), 'ÁGUA SEM GÁS');
  assert.strictEqual(campo(c, 'valor'), '5,00');
  assert.ok(!PA.ehLinhaDeContrato(c), 'o tradutor trata como avulsa');
  ok('parcela de venda avulsa leva o nome do produto vendido');
}

/* 4. Campeche: consultora vazia e sem aviso de consultora */
{
  const cp = L.montar({ resumo: resumoBase(), contratos: caderninho(), unidade: 'CP', dia: '2026-08-05' });
  assert.ok(cp.linhas.every(l => campo(l, 'consultor') === ''), 'CP nunca preenche consultora');
  assert.ok(cp.linhas.every(l => campo(l, 'empresa') === 'CROSSTAINER UNID. CAMPECHE (CP)'));
  assert.ok(!cp.avisos.some(a => /consultora/.test(a.motivo)), 'no CP a falta é conhecida, não vira aviso');
  ok('no Campeche a consultora fica vazia e não usa quem lançou o pagamento');
}

/* 5. contrato fora do caderninho: aviso e dia parcial */
{
  const r = resumoBase();
  r.pagamentos[0].parcelasPagas[0].codigoContrato = 9003;
  const s = L.montar({ resumo: r, contratos: caderninho(), unidade: 'PP', dia: '2026-08-05' });
  const linha = s.linhas.find(l => campo(l, 'contrato') === '9003');
  assert.ok(linha, 'a linha entra mesmo sem dados');
  assert.strictEqual(campo(linha, 'plano'), '');
  assert.strictEqual(campo(linha, 'situacao'), '');
  assert.ok(s.avisos.some(a => a.contrato === '9003' && /sem dados/.test(a.motivo)));
  assert.strictEqual(L.situacaoDoDia({ resumo: r, avisos: s.avisos }), 'parcial');
  ok('contrato que a Pacto não devolveu entra sem plano, com aviso, e o dia fica parcial');
}

/* 6. nada de CPF ou nascimento em lugar nenhum */
{
  const tudo = JSON.stringify(pp) + JSON.stringify([...caderninho().values()]);
  assert.ok(!tudo.includes(CPF), 'CPF vazou');
  assert.ok(!tudo.includes(NASC), 'data de nascimento vazou');
  for (const k of L.CAMPOS_PROIBIDOS) assert.ok(!tudo.includes('"' + k + '"'), 'chave proibida na saída: ' + k);
  ok('nenhum CPF, nascimento ou campo pessoal sai do conversor');
}

/* 7. situação do dia */
{
  assert.strictEqual(L.situacaoDoDia({ resumo: { pagamentos: [] }, avisos: [] }), 'vazio_conferir');
  assert.strictEqual(L.situacaoDoDia({ resumo: {}, avisos: [] }), 'vazio_conferir');
  assert.strictEqual(L.situacaoDoDia({ erro: { situacao: 'limite' } }), 'limite');
  assert.strictEqual(L.situacaoDoDia({ erro: { situacao: 'credencial_recusada' } }), 'credencial_recusada');
  assert.strictEqual(L.situacaoDoDia({ resumo: resumoBase(), avisos: [] }), 'buscado');
  ok('zero pagamentos é "vazio, conferir", nunca "buscado"');
}

/* 8. totais */
{
  assert.strictEqual(pp.totais.recebido, 642, '239 + 398 + 5 (crédito em conta fora)');
  assert.strictEqual(pp.totais.pagamentos, 3);
  assert.strictEqual(pp.totais.parcelas, 4);
  assert.deepStrictEqual(pp.totais.estornos, { qtd: 1, valor: 50 });
  assert.deepStrictEqual(pp.totais.estornosContrato, { qtd: 1, valor: 120.5 });
  ok('totais de recebido, estornos e contagens');
}

/* 9. a cópia das Functions é idêntica e dá o mesmo resultado */
{
  const LF = require(path.join(raiz, 'functions', 'pacto-api-linhas.js'));
  const args = () => ({ resumo: resumoBase(), contratos: caderninho(), unidade: 'PP', dia: '2026-08-05' });
  assert.deepStrictEqual(LF.montar(args()), L.montar(args()));
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'functions', 'pacto-api-linhas.js'), 'utf8'),
    fs.readFileSync(path.join(raiz, 'pacto-api-linhas.js'), 'utf8'),
    'as duas cópias divergiram — o deploy de Functions só leva functions/');
  ok('a cópia de functions/ é idêntica à da raiz');
}

/* 10. consultores dos contratos lançados */
{
  const m = L.consultoresLancados(resumoBase());
  assert.strictEqual(m.get('9001'), 'CONSULTORA TESTE UM');
  assert.strictEqual(L.consultoresLancados({}).size, 0);
  ok('consultora sai dos contratos lançados, indexada pelo número do contrato');
}

console.log('\n✅ smoke-pacto-api-linhas: ' + n + '/10');
