'use strict';
// Roda: node scripts/smoke-pacto-ponta-a-ponta.js
//
// O `smoke-pacto-adapter.js` prova a tradução; este prova a CORRENTE INTEIRA,
// com as mesmas peças que rodam na tela:
//
//   linha da Pacto → pacto-adapter → lib-xlsx-write → **SheetJS de verdade**
//   (vendor/xlsx.full.min.js, o mesmo do index.html:4173) → CommissionEngine
//
// Existe porque cada elo sozinho pode estar certo e a corrente arrebentar na
// junta: um .xlsx que só o meu próprio leitor entende, um `Código` vazio que o
// `cleanRawData` descarta em silêncio, uma data que o motor não sabe ler. O
// prejuízo aparece como "sumiu venda" depois de subir, sem erro nenhum.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const raiz = path.join(__dirname, '..');
const PA = require(path.join(raiz, 'pacto-adapter.js'));
const CE = require(path.join(raiz, 'commission.js'));
const { escreverXlsx } = require(path.join(__dirname, 'lib-xlsx-write.js'));

// SheetJS é publicado pro navegador; estes três stubs bastam pra ele carregar no Node
global.window = global; global.self = global;
global.document = global.document || { createElement: () => ({}) };
const XLSX = require(path.join(raiz, 'vendor', 'xlsx.full.min.js')) || global.XLSX;

// ─── uma linha crua da Pacto, por posição ───
const CP = 'CROSSTAINER UNID. CAMPECHE (CP)';
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

const PLANO = 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO | CP.';
const entrada = [
  linha({ nome: 'Nome Cliente' }),                                                   // cabeçalho
  // contrato anual: taxa em uma linha, plano em outra — 2 linhas de caixa, 1 ativação
  linha({ nome: 'ANA PAULA', contrato: '7078', duracao: '12', inicio: '03/08/2026', termino: '02/08/2027',
          produto: 'MATRÍCULA', plano: PLANO, situacao: 'Matrícula', valor: '100,00' }),
  linha({ nome: 'ANA PAULA', contrato: '7078', duracao: '12', inicio: '03/08/2026', termino: '02/08/2027',
          produto: PLANO, plano: PLANO, situacao: 'Matrícula', valor: '259,00' }),
  // contrato importado que começou este mês: plano presumido, ativação vale
  linha({ nome: 'BRUNO LIMA', contrato: '7100', duracao: '24', inicio: '06/08/2026', termino: '05/08/2028',
          produto: 'IMPORTAÇÃO', plano: 'IMPORTAÇÃO', situacao: 'Matrícula', valor: '299,00' }),
  // contrato importado que começou em janeiro: migração, fica de fora
  linha({ nome: 'CARLA DIAS', contrato: '6200', duracao: '12', inicio: '07/01/2026', termino: '06/01/2027',
          produto: 'IMPORTAÇÃO', plano: 'IMPORTAÇÃO', situacao: 'Rematrícula', valor: '269,00' }),
  // renovação automática: o robô lançou, não paga
  linha({ nome: 'DÉBORA REIS', contrato: '7101', duracao: '1', inicio: '08/08/2026', termino: '07/09/2026',
          produto: 'HIIT/MAROMBINHA | RECORRENTE | 3X | PADRÃO.', plano: 'HIIT/MAROMBINHA | RECORRENTE | 3X | PADRÃO.',
          situacao: 'Renovação', valor: '309,00', resp2: 'RECORRENCIA', forma: 'CARTÃO RECORRENTE' }),
  // contrato ANTIGO cobrado pelo gateway velho: é recebimento, sai fora
  linha({ nome: 'EDU SANTOS', contrato: '7102', duracao: '12', inicio: '09/02/2026', termino: '08/02/2027',
          produto: PLANO, plano: PLANO, situacao: 'Matrícula', valor: '259,00',
          forma: 'CARTÃO DE CRÉDITO - RECEBIMENTO TECNOFIT' }),
  // contrato NOVO cobrado pelo mesmo gateway velho: é venda de agosto, FICA
  // (a forma de pagamento não é carimbo de data — a migração do meio de
  //  pagamento não terminou, então venda nova também vem marcada assim)
  linha({ nome: 'HELENA COSTA', contrato: '7104', duracao: '12', inicio: '11/08/2026', termino: '10/08/2027',
          produto: PLANO, plano: PLANO, situacao: 'Matrícula', valor: '199,00',
          forma: 'CARTÃO DE CRÉDITO - RECEBIMENTO TECNOFIT' }),
  // balcão: água sem Consultor, 5% pra quem lançou, nenhuma ativação
  linha({ nome: 'FLÁVIA NUNES', matricula: '9911', produto: 'ÁGUA SEM GÁS', valor: '3,50',
          consultor: '', resp1: 'KALI LÓPEZ', resp2: 'KALI LÓPEZ' }),
  // mês anterior: não é deste fechamento
  linha({ nome: 'GUSTAVO SÁ', contrato: '7103', duracao: '12', inicio: '10/07/2026', termino: '09/07/2027',
          produto: PLANO, plano: PLANO, situacao: 'Matrícula', valor: '259,00', lancamento: '10/07/2026' }),
];

const tmp = path.join(os.tmpdir(), 'smoke-pacto-e2e-' + process.pid + '.xlsx');
let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);

try {
  // ─── 1. traduzir e gravar ───
  const r = PA.traduzir(entrada, { mes: '2026-08' });
  assert.strictEqual(r.relatorio, 'recebido', 'é o relatório certo');
  assert.strictEqual(r.migrados.length, 1, 'CARLA DIAS separada como migração');
  assert.strictEqual(r.descartadas.length, 1, 'EDU SANTOS descartado (recebimento TecnoFit)');
  escreverXlsx(tmp, 'Vendas CP', [PA.CABECALHO_SAIDA, ...PA.paraPlanilha(r.porUnidade.CP)]);
  ok('traduz e grava a planilha');

  // ─── 2. abrir com o SheetJS da tela, do mesmo jeito que o index.html abre ───
  const wb = XLSX.read(new Uint8Array(fs.readFileSync(tmp)), { type: 'array', cellDates: true });
  const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  assert.deepStrictEqual(json[0], PA.CABECALHO_SAIDA, 'cabeçalho chega inteiro no SheetJS');
  ok('o SheetJS de verdade abre o arquivo gerado');

  // ─── 3. o motor tem que reconhecer as linhas ───
  // `cleanRawData` descarta em SILÊNCIO linha com Código vazio e para na palavra
  // "Total" — é aqui que venda some sem ninguém perceber.
  const rows = CE.cleanRawData(json);
  assert.strictEqual(rows.length, r.porUnidade.CP.length,
    'nenhuma linha caiu no cleanRawData (' + rows.length + ' de ' + r.porUnidade.CP.length + ')');
  ok('o motor aceita todas as linhas, sem descarte silencioso');

  assert.deepStrictEqual(CE.detectMonths(rows), { '2026-08': rows.length },
    'as datas foram lidas e caem todas em agosto');
  ok('as datas atravessam a planilha legíveis pro motor');

  // ─── 4. o dinheiro no fim da corrente ───
  const res = CE.calculate(rows, CE.defaultConfig, {});

  assert.strictEqual(res.excluded.length, 1, 'só a renovação automática foi excluída');
  assert.ok(/autom/i.test(res.excluded[0].excludeReason || ''), res.excluded[0].excludeReason);
  ok('renovação automática chega excluída no fim da corrente');

  const erica = res.vendorData['ERICA FAUSTINO'];
  const kali = res.vendorData['KALI DUTRA'];
  assert.ok(erica, 'ERICA FAUSTINO existe no resultado');
  assert.strictEqual(erica.ativacoes, 3, 'ANA PAULA + BRUNO + HELENA = 3 ativações (a taxa não conta)');
  assert.strictEqual(erica.p2total, CE.defaultConfig.bonusAnualLocal * 2 + CE.defaultConfig.bonusBianual,
    'P2 = 2 × R$ 30 de anual LOCAL + R$ 80 do bianual presumido');
  // P1 = 5% de 100 (taxa) + 259 (plano) + 299 (importado) + 199 (gateway velho, venda nova)
  assert.strictEqual(Math.round(erica.p1total * 100) / 100, Math.round((100 + 259 + 299 + 199) * 0.05 * 100) / 100);
  ok('ativações, P1 e P2 batem no fim da corrente');

  assert.ok(kali, 'a água pagou a KALI (nome já unificado)');
  assert.strictEqual(kali.ativacoes, 0, 'água não é ativação');
  assert.strictEqual(Math.round(kali.p1total * 100) / 100, 0.18, '5% de R$ 3,50');
  ok('produto de balcão paga 5% a quem lançou e não vira ativação');

  assert.ok(!res.vendorData['Sem Vendedor'], 'ninguém ficou órfão');
  assert.ok(!Object.keys(res.vendorData).some(k => /IMPORTA|PACTO -|ADMINISTRADOR|RECORRENCIA/i.test(k)),
    'nenhum rótulo de sistema virou vendedora: ' + Object.keys(res.vendorData).join(', '));
  ok('nenhuma vendedora fantasma no resultado');

  console.log('\n' + n + '/' + n + ' casos passaram.');
} finally {
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
}
