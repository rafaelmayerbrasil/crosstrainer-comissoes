'use strict';
// Roda: node scripts/smoke-pacto-sombra-tela.js
//
// A tela do modo sombra carrega e FUNCIONA como <script>, não só como require().
// Lição de 01/09/2026 (smoke-modulos-no-browser.js): `const` no topo de um
// script clássico não vira `window.X`, e um teste em Node com require() não vê
// isso. Aqui os arquivos rodam num sandbox, na ordem do pacto-sombra.html, e as
// funções são CHAMADAS com dados inventados.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'pacto-sombra.html'), 'utf8');

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

/* 1. a página carrega os módulos, na ordem de dependência, com cache-buster */
const nossos = [...html.matchAll(/<script src="([a-z0-9-]+\.js)\?v=(\d{8})"><\/script>/g)].map(m => ({ f: m[1], v: m[2] }));
{
  const ordem = nossos.map(x => x.f);
  const esperado = ['firebase-config.js', 'pacto-adapter.js', 'commission.js', 'pacto-api-linhas.js', 'pacto-sombra-comparacao.js', 'pacto-sombra.js'];
  assert.deepStrictEqual(ordem, esperado, 'ordem dos scripts: ' + ordem.join(', '));
  assert.ok(nossos.every(x => x.v === nossos[0].v), 'todos com o mesmo ?v=');
  assert.ok(/vendor\/xlsx\.full\.min\.js/.test(html), 'a leitura do export precisa do SheetJS local');
  assert.ok(/firebase-functions-compat\.js/.test(html), 'o botão "Buscar agora" precisa do SDK de functions');
  ok('pacto-sombra.html carrega os módulos na ordem certa, com o mesmo ?v=');
}

/* 2. roda como <script> num sandbox (sem firebase-config, que exige o SDK) */
const sandbox = { console: { log() {}, error() {}, warn() {} }, Intl, Date, JSON, Math, Map, Set };
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const { f } of nossos.filter(x => x.f !== 'firebase-config.js')) {
  vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8'), sandbox, { filename: f });
}
{
  // `const` no topo não vira propriedade de window: busca pelo escopo global léxico
  const tem = nome => vm.runInContext(`typeof ${nome} !== 'undefined'`, sandbox);
  ['PactoAdapter', 'CommissionEngine', 'PactoApiLinhas', 'PactoSombraComparacao'].forEach(nm => assert.ok(tem(nm), nm + ' não carregou'));
  assert.ok(sandbox.PactoSombraTela, 'a tela expõe PactoSombraTela em window');
  assert.ok(sandbox.PactoSombraComparacao, 'a comparação está em window (a tela lê de lá)');
  ok('os arquivos rodam como <script> e expõem o que a tela usa');
}

/* 3. a cadeia inteira no sandbox: API → linhas → comparação com adapter e motor */
{
  const T = sandbox.PactoSombraTela;
  const L = sandbox.PactoApiLinhas;
  const resumo = {
    contratosLancados: [{ codigo: 50, consultor: 'CONSULTORA TESTE UM' }],
    pagamentos: [{ codigo: 1, data: '04/08/2026 10:00:00', responsavelLancamento: 'CONSULTORA TESTE UM',
      aluno: { codigo: 9, nome: 'CLIENTE FICTICIO TELA' }, formas: [{ formaPagamento: 'PIX', valor: 259 }],
      parcelasPagas: [{ codigo: 10, codigoContrato: 50, descricao: 'PARCELA 1', valor: 259 }] }],
  };
  const contratos = new Map([['50', L.limparContrato({ codigo: 50, situacaoContrato: 'Matrícula',
    nomePlano: 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO.', vigenciaDe: '04/08/2026',
    vigenciaAteAjustada: '03/08/2027', numeroMeses: 12 }, 'PP', 'CONSULTORA TESTE UM')]]);
  const m = L.montar({ resumo, contratos, unidade: 'PP', dia: '2026-08-04' });
  const docs = [
    { unidade: 'PP', dia: '2026-08-04', situacao: 'buscado', linhas: JSON.stringify(m.linhas), foraDeProposito: m.foraDeProposito, avisos: m.avisos, totais: m.totais },
    { unidade: 'PP', dia: '2026-08-02', situacao: 'falhou', motivo: 'HTTP 500' },
    { unidade: 'PP', dia: '2026-08-03', situacao: 'vazio_conferir', totais: { recebido: 0 } },
  ];

  const linhas = T.linhasDosDias(docs);
  assert.strictEqual(linhas.length, 1);
  const PA = vm.runInContext('PactoAdapter', sandbox);
  const CE = vm.runInContext('CommissionEngine', sandbox);
  const arquivo = L.comCabecalho(linhas.map(l => l.slice()));
  const r = sandbox.PactoSombraComparacao.comparar({ linhasApi: linhas, linhasArquivo: arquivo, mes: '2026-08', unidade: 'PP',
    foraApi: T.foraDosDias(docs), Adapter: PA, Engine: CE, ApiLinhas: L });
  assert.strictEqual(r.api.recebido, 259);
  assert.strictEqual(r.api.ativacoes.total, 1, 'o motor carregado como <script> conta a ativação');
  assert.strictEqual(r.divergencias.length, 0);
  assert.strictEqual(r.api.porVendedora['CONSULTORA TESTE UM'], 1);
  ok('no sandbox: linhas dos dias → comparação com o adapter e o motor carregados como <script>');

  // arrays do sandbox têm outro Array.prototype: comparar o conteúdo, não o objeto
  const puro = x => JSON.parse(JSON.stringify(x));
  const dias = puro(T.resumirDias(docs, '2026-08', '2026-08-06'));
  assert.deepStrictEqual(dias.map(d => d.dia), ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'], 'até ontem');
  assert.deepStrictEqual(dias.map(d => d.situacao), ['nao_buscado', 'falhou', 'vazio_conferir', 'buscado', 'nao_buscado']);
  assert.strictEqual(dias[1].motivo, 'HTTP 500');
  ok('a grade vai até ontem e dia sem documento aparece como "não buscado", nunca como zero');

  const alertas = T.alertasDosDias(dias, '2026-08-10');
  // A madrugada relê o mês inteiro (e o anterior até o dia 10): falha dentro dessa
  // janela ela refaz sozinha; só a de antes precisa do botão.
  assert.ok(alertas.some(a => a.tipo === 'aviso' && /madrugada tenta de novo/.test(a.texto) && /02/.test(a.texto)), 'falha dentro da releitura: aviso');
  assert.ok(!alertas.some(a => a.tipo === 'erro'), 'falha dentro da releitura não é erro');
  const fora = T.alertasDosDias([{ dia: '2026-08-02', situacao: 'falhou' }], '2026-09-15');
  assert.ok(fora.some(a => a.tipo === 'erro' && /não relê mais/.test(a.texto) && /02/.test(a.texto)), 'falha fora da releitura vira erro');
  assert.ok(T.alertasDosDias([{ dia: '2026-08-02', situacao: 'falhou' }], '2026-09-10').every(a => a.tipo !== 'erro'), 'até o dia 10 o mês anterior ainda é relido');
  assert.ok(alertas.some(a => /sem nenhum pagamento/.test(a.texto) && /03/.test(a.texto)), 'vazio vira alerta');
  const cred = T.alertasDosDias([{ dia: '2026-08-09', situacao: 'credencial_recusada' }], '2026-08-10');
  assert.ok(cred.some(a => /recusou a credencial/.test(a.texto)));
  assert.strictEqual(T.alertasDosDias([{ dia: '2026-08-09', situacao: 'buscado' }], '2026-08-10').length, 0);
  // dia bom cuja última busca falhou (22/09/2026): os números valem, mas avisa;
  // e credencial recusada continua gritando mesmo com o dia preservado
  const dFalha = puro(T.resumirDias([{ dia: '2026-08-09', situacao: 'buscado', ultimaFalha: { situacao: 'credencial_recusada', motivo: 'HTTP 401' } }], '2026-08', '2026-08-10'));
  assert.strictEqual(dFalha[8].ultimaFalha.situacao, 'credencial_recusada', 'o resumo do dia carrega a falha');
  const aF = T.alertasDosDias(dFalha, '2026-08-10');
  assert.ok(aF.some(a => /recusou a credencial/.test(a.texto)), 'credencial recusada na última busca alerta');
  assert.ok(aF.some(a => a.tipo === 'aviso' && /não atualizado/.test(a.texto) && /09/.test(a.texto)), 'dia não atualizado avisa');
  ok('alertas: falha fora da releitura da madrugada, dia vazio e credencial recusada; dia bom não alerta');
}

/* 4. a tela só escreve por um caminho: a função manual da sombra */
{
  const js = fs.readFileSync(path.join(raiz, 'pacto-sombra.js'), 'utf8');
  // escrita no Firestore; `classList.add/remove` é só estilo e fica de fora
  // pega `doc(x).update(` também, não só `ref.update(` — a mutação de 13/09 escapou assim
  const escritas = [...js.matchAll(/([\w)\]]+)\s*\.\s*(set|add|update|delete)\s*\(/g)]
    .filter(m => !/classList$/.test(m[1])).map(m => m[0]);
  assert.deepStrictEqual(escritas, [], 'pacto-sombra.js não pode gravar: ' + escritas.join(', '));
  for (const proibido of ['batch(', 'runTransaction']) assert.ok(!js.includes(proibido), 'pacto-sombra.js não pode chamar ' + proibido);
  const callables = [...js.matchAll(/httpsCallable\('([^']+)'/g)].map(m => m[1]);
  assert.deepStrictEqual(callables, ['buscarPactoSombraManual'], 'única função chamada: ' + callables.join(', '));
  const colecoes = [...js.matchAll(/collection\('([^']+)'\)/g)].map(m => m[1]).sort();
  assert.deepStrictEqual([...new Set(colecoes)], ['pacto_sombra_dias', 'users'], 'coleções lidas: ' + colecoes.join(', '));
  ok('a tela não grava no banco; só chama buscarPactoSombraManual e só lê a sombra e o próprio perfil');
}

console.log('\n✅ smoke-pacto-sombra-tela: ' + n + '/6');
