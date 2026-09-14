'use strict';
// Roda: node scripts/smoke-pacto-sombra-ponta-a-ponta.js
//
// Linhas montadas a partir da API atravessam o tradutor e o motor REAIS —
// `pacto-adapter.js` e `commission.js`, sem alteração nenhuma. Se algo aqui
// quebrar, a correção é no conversor (`pacto-api-linhas.js`), nunca no adapter:
// o caminho A do desenho existe justamente para não haver duas regras.
//
// Dados INVENTADOS — o repositório é público.

const assert = require('assert');
const path = require('path');

const raiz = path.join(__dirname, '..');
const L = require(path.join(raiz, 'pacto-api-linhas.js'));
const PA = require(path.join(raiz, 'pacto-adapter.js'));
const CE = require(path.join(raiz, 'commission.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);

const aluno = (codigo, nome) => ({ codigo, nome, cpf: '000.000.000-00' });
const pag = (codigo, alunoObj, resp, forma, parcelas) => ({
  codigo, data: '12/08/2026 09:00:00', responsavelLancamento: resp, aluno: alunoObj,
  formas: [{ formaPagamento: forma, valor: parcelas.reduce((s, p) => s + p.valor, 0) }],
  parcelasPagas: parcelas,
});

const resumo = {
  contratosLancados: [
    { codigo: 8001, consultor: 'CONSULTORA TESTE UM' },
    { codigo: 8002, consultor: 'CONSULTORA TESTE UM' },
  ],
  pagamentos: [
    // venda nova anual, começou no mês
    pag(1, aluno(1, 'CLIENTE FICTICIO NOVO'), 'CONSULTORA TESTE UM', 'PIX',
      [{ codigo: 101, codigoContrato: 8001, descricao: 'PARCELA 1', valor: 339 }]),
    // renovação cobrada pelo robô do cartão recorrente
    pag(2, aluno(2, 'CLIENTE FICTICIO RENOVA'), 'RECORRENCIA', 'CARTÃO RECORRENTE',
      [{ codigo: 102, codigoContrato: 8002, descricao: 'PARCELA 1', valor: 309 }]),
    // contrato migrado do TecnoFit, começou em 2025
    pag(3, aluno(3, 'CLIENTE FICTICIO MIGRADO'), 'PACTO - MÉTODO DE GESTÃO', 'CARTÃO DE CRÉDITO',
      [{ codigo: 103, codigoContrato: 8003, descricao: 'PARCELA 7', valor: 259 }]),
    // água no balcão
    pag(4, aluno(4, 'CLIENTE FICTICIO AGUA'), 'CONSULTORA TESTE UM', 'PIX',
      [{ codigo: 104, codigoContrato: null, descricao: 'VENDA AVULSA', valor: 5 }]),
  ],
  vendaAvulsa: [{ codigo: 9, produto: 'ÁGUA SEM GÁS', totalFinal: 5, vendaAvulsaParcela: [{ codigo: 104, situacao: 'PG' }] }],
};

const lancados = L.consultoresLancados(resumo);
const contratos = new Map([
  ['8001', L.limparContrato({ codigo: 8001, situacaoContrato: 'Matrícula', nomePlano: 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO.',
    vigenciaDe: '12/08/2026', vigenciaAteAjustada: '11/08/2027', numeroMeses: 12 }, 'PP', lancados.get('8001'))],
  ['8002', L.limparContrato({ codigo: 8002, situacaoContrato: 'Renovação', nomePlano: 'HIIT/MAROMBINHA | RECORRENTE | 3X | PADRÃO.',
    vigenciaDe: '10/08/2026', vigenciaAteAjustada: '09/09/2026', numeroMeses: 1 }, 'PP', lancados.get('8002'))],
  ['8003', L.limparContrato({ codigo: 8003, situacaoContrato: 'Rematrícula', nomePlano: 'IMPORTAÇÃO',
    vigenciaDe: '10/01/2026', vigenciaAteAjustada: '09/01/2027', numeroMeses: 12 }, 'PP', null)],
]);

const m = L.montar({ resumo, contratos, unidade: 'PP', dia: '2026-08-12' });
const entrada = L.comCabecalho(m.linhas);

// ─── o tradutor real ───
assert.ok(PA.ehExportPacto(entrada), 'o tradutor reconhece as linhas como export da Pacto');
assert.strictEqual(PA.detectarRelatorio(entrada), 'recebido', 'e como o relatório CERTO (recebido, não faturamento)');
const t = PA.traduzir(entrada, { mes: '2026-08' });
ok('o tradutor real reconhece as linhas da API como export da Pacto');

assert.strictEqual(t.migrados.length, 1, 'o contrato IMPORTAÇÃO com início antigo é migrado');
assert.strictEqual(t.migrados[0].cliente, 'CLIENTE FICTICIO MIGRADO');
ok('contrato migrado sai pela regra que já existe');

assert.ok(t.avisos.some(a => /cart[ãa]o recorrente/i.test(a.motivo) && a.cliente === 'CLIENTE FICTICIO RENOVA'),
  'a cobrança pelo robô vira aviso');
ok('cobrança pelo cartão recorrente vira aviso, como no arquivo');

// ─── o motor real ───
const rows = CE.cleanRawData([PA.CABECALHO_SAIDA, ...PA.paraPlanilha(t.porUnidade.PP)]);
assert.strictEqual(rows.length, t.porUnidade.PP.length, 'nenhuma linha some no cleanRawData');
const { processed } = CE.processRows(rows, CE.defaultConfig, {});
const ativ = processed.filter(p => p.isActivation);
assert.strictEqual(ativ.length, 2, 'novo + renovação = 2 ativações: ' + ativ.map(a => a.cliente + '/' + a.category).join(', '));
assert.deepStrictEqual(ativ.map(a => a.category).sort(), ['novo', 'renovacao']);
ok('o motor real conta 2 ativações: a venda nova e a renovação');

const agua = processed.find(p => p.cliente === 'CLIENTE FICTICIO AGUA');
assert.ok(agua && !agua.isActivation, 'água não é ativação');
ok('a água passa, mas não é ativação');

const res = CE.calculate(rows, CE.defaultConfig, {});
assert.ok(!Object.keys(res.vendorData).some(k => /RECORRENCIA|ADMINISTRADOR|PACTO -/i.test(k)),
  'rótulo de sistema virou vendedora: ' + Object.keys(res.vendorData).join(', '));
ok('nenhum rótulo de sistema vira vendedora');

console.log('\n✅ smoke-pacto-sombra-ponta-a-ponta: ' + n + '/6');
