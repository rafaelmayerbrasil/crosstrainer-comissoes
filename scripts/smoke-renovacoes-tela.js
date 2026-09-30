'use strict';
// Roda: node scripts/smoke-renovacoes-tela.js
//
// A tela da lista de renovações roda como <script> num sandbox (com o módulo
// puro carregado antes, como na página) e as funções que desenham são CHAMADAS.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);
const lido = x => x.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const sandbox = { console: { log() {}, error() {}, warn() {} }, Intl, Date, JSON, Math, Number, String, RegExp, Set, Map };
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(raiz, 'renovacoes-lista.js'), 'utf8'), sandbox, { filename: 'renovacoes-lista.js' });
vm.runInContext(fs.readFileSync(path.join(raiz, 'renovacoes.js'), 'utf8'), sandbox, { filename: 'renovacoes.js' });
const T = sandbox.RenovacoesTela;
const RL = sandbox.RenovacoesLista;

const linha = o => ({ codigoContrato: '101', codigoCliente: '11', matricula: '5011', nome: 'ANA ANUAL', plano: 'ANUAL, ACESSO ILIMITADO',
  planoOriginal: null, economico: false, inicio: '2025-10-01', vencimento: '2026-10-09', consultora: 'KALI', consultoraOrigem: 'pacto',
  renovouSistema: false, notas: [], desde: '2026-10-01', origem: 'pacto', n: 1, ...o });
const LISTA = {
  unidade: 'CP', mes: '2026-10', situacao: 'ok', atualizadoEm: null,
  blocos: {
    renovacoes: [linha(), linha({ codigoContrato: '105', nome: 'EDU IMPORTADO', plano: 'IMPORTAÇÃO', planoOriginal: 'SEMESTRAL, TREINO LIVRE', consultora: 'BARBARA', vencimento: '2026-10-20', n: 2 }),
      linha({ codigoContrato: '109', nome: 'HELO ECONOMICO', economico: true, consultora: null, matricula: null, vencimento: '2026-10-25', n: 3 })],
    antecipacao: [linha({ codigoContrato: '201', nome: 'IVO ANTECIPA', vencimento: '2026-11-10', n: 4 })],
    degustacoes: [linha({ codigoContrato: '104', nome: 'DORA DEGUSTA', plano: 'MÊS DEGUSTAÇÃO LIVRE', inicio: '2026-09-20', vencimento: '2026-10-20', n: 1 })],
    verificar: [linha({ codigoContrato: '106', nome: 'FABI SEMDADOS', motivoVerificar: 'A Pacto não devolveu os dados deste contrato', n: null })],
  },
  excluidos: { recorrente: 3, duplicado: 1 },
  conferencia: { totalPacto: 10, naLista: 6, excluidos: 4, bate: true, diferenca: 0 },
  planosRecentes: ['ANUAL, ACESSO ILIMITADO', 'SEMESTRAL, TREINO LIVRE'],
  consultoras: ['BARBARA', 'KALI'],
  metas: null,
};
const H = '2026-10-05';

/* 1. a página carrega o que precisa, na ordem, com o mesmo ?v= */
{
  const html = fs.readFileSync(path.join(raiz, 'renovacoes.html'), 'utf8');
  const nossos = [...html.matchAll(/<script src="([a-z0-9-]+\.js)\?v=(\d{8})"><\/script>/g)].map(m => ({ f: m[1], v: m[2] }));
  assert.deepStrictEqual(nossos.map(x => x.f), ['firebase-config.js', 'renovacoes-lista.js', 'renovacoes.js']);
  assert.ok(nossos.every(x => x.v === nossos[0].v), 'todos com o mesmo ?v=');
  assert.ok(/firebase-functions-compat\.js/.test(html) && /firebase-firestore-compat\.js/.test(html) && /firebase-auth-compat\.js/.test(html));
  assert.ok(/<meta name="viewport"/.test(html), 'celular');
  assert.ok(/CrossTainer/.test(html) && !/CrossTrainer/.test(html), 'marca certa');
  ok('renovacoes.html: firebase-config, módulo e tela com o mesmo ?v=, SDK de functions, marca CrossTainer');
}

/* 2. quem entra e quais unidades vê */
{
  assert.ok(T && typeof T.painelHtml === 'function' && typeof T.blocoHtml === 'function' && typeof T.formHtml === 'function');
  assert.strictEqual(T.perfilDe({ profiles: ['admin'] }), 'gestao');
  assert.strictEqual(T.perfilDe({ profiles: ['supervisao'] }), 'gestao');
  assert.strictEqual(T.perfilDe({ role: 'vendedor', profiles: ['vendedor'] }), 'equipe');
  assert.strictEqual(T.perfilDe({ profiles: ['professor'] }), null);
  assert.deepStrictEqual([...T.unidadesDe({ profiles: ['admin'] }, 'gestao')], ['CP', 'PP']);
  assert.deepStrictEqual([...T.unidadesDe({ allowedUnits: ['unit-cp'] }, 'equipe')], ['CP']);
  assert.deepStrictEqual([...T.unidadesDe({ allowedUnits: ['pp'] }, 'equipe')], ['PP'], 'id de produção');
  assert.deepStrictEqual([...T.unidadesDe({ unitId: 'unit-pp' }, 'equipe')], ['PP'], 'cadastro antigo com unitId');
  ok('gestão (admin, supervisão) e equipe (vendedora); a vendedora só vê as unidades dela');
}

/* 3. blocos: o que a consultora vê em cada linha */
{
  const b = T.blocoHtml(T.BLOCOS[0], LISTA.blocos.renovacoes, {}, { hoje: H });
  const t = lido(b);
  assert.ok(/Renovações do mês \(3\)/.test(t), t.slice(0, 80));
  assert.ok(t.includes('IMPORTAÇÃO → SEMESTRAL, TREINO LIVRE'));
  assert.ok(t.includes('Sem desconto de renovação'));
  assert.ok(t.includes('Sem consultora'));
  assert.ok(t.includes('09/10/2026'), 'datas no formato brasileiro');
  assert.ok(t.includes('Vence em 4 dia(s) e ainda não houve contato'), 'o alerta aparece');
  assert.ok(t.includes('cód. 11') || t.includes('5011'), 'matrícula (ou o código do cliente)');
  const soMinhas = lido(T.blocoHtml(T.BLOCOS[0], LISTA.blocos.renovacoes, {}, { hoje: H, soMinhas: true, meuNome: 'kali' }));
  assert.ok(/\(1\)/.test(soMinhas) && soMinhas.includes('ANA ANUAL') && !soMinhas.includes('EDU IMPORTADO'), 'filtro "só as minhas"');
  const deg = lido(T.blocoHtml(T.BLOCOS[2], LISTA.blocos.degustacoes, {}, { hoje: H }));
  assert.ok(deg.includes('Converteu?') && deg.includes('Sem acompanhamento registrado nesta semana'));
  const html = T.blocoHtml(T.BLOCOS[0], [linha({ nome: '<img src=x onerror=alert(1)>' })], {}, { hoje: H });
  assert.ok(!html.includes('<img'), 'nome de aluno é escapado');
  ok('blocos: importação, Econômico, sem consultora, datas, alertas, "só as minhas", degustação, escape');
}

/* 4. painel: a gestão vê a conferência e as exclusões; a consultora não */
{
  const g = lido(T.painelHtml(LISTA, {}, 'CP', 'gestao', H));
  assert.ok(g.includes('Total a renovar no mês') && g.includes('3'));
  assert.ok(g.includes('Conferência com a Pacto') && g.includes('Recorrente (renova sozinho)') && g.includes('Aluno repetido na Previsão'));
  assert.ok(g.includes('Meta do mês ainda não definida'), 'nunca inventa meta');
  const e = lido(T.painelHtml(LISTA, {}, 'CP', 'equipe', H));
  assert.ok(e.includes('Total a renovar no mês'));
  assert.ok(!e.includes('Conferência com a Pacto') && !e.includes('Recorrente (renova sozinho)'), 'a consultora não vê a conferência nem as exclusões');
  const comMeta = lido(T.painelHtml({ ...LISTA, metas: { meta: 55, superMeta: 63, metaGold: 72, minNovos: 19, minRenov: 16, minVoucher: 5 } }, {}, 'CP', 'equipe', H));
  assert.ok(comMeta.includes('55 · 63 · 72') && comMeta.includes('16'));
  const falhou = lido(T.painelHtml({ ...LISTA, ultimaFalha: { situacao: 'falhou', motivo: 'HTTP 500' } }, {}, 'CP', 'gestao', H));
  assert.ok(falhou.includes('A última atualização falhou'));
  assert.ok(lido(T.painelHtml(null, {}, 'PP', 'equipe', H)).includes('ainda não foi montada'));
  const naoBate = lido(T.painelHtml({ ...LISTA, conferencia: { totalPacto: 11, naLista: 6, excluidos: 4, bate: false, diferenca: 1 } }, {}, 'CP', 'gestao', H));
  assert.ok(naoBate.includes('não bate') && naoBate.includes('1'));
  ok('painel: números, metas (sem inventar), falha visível; conferência e exclusões só para a gestão');
}

/* 5. o formulário: campos da consultora; gestão também atribui e classifica */
{
  const f = T.formHtml(LISTA.blocos.renovacoes[0], { renovou: 'nao', motivo: 'Lesão ou saúde' }, 'renovacoes', LISTA, 'equipe', H);
  assert.ok(f.includes('name="renovou"') && f.includes('name="dataContato"') && f.includes('name="planoAlvo"') && f.includes('name="planoFechado"')
    && f.includes('name="motivo"') && f.includes('name="observacoes"'));
  assert.ok(f.includes('max="2026-10-05"'), 'data não pode ser no futuro');
  assert.ok(RL.MOTIVOS_NAO_RENOVOU.every(m => f.includes(m)), 'os 10 motivos');
  assert.ok(/<option value="Lesão ou saúde" selected>/.test(f), 'mostra o que já foi preenchido');
  assert.ok(f.includes('SEMESTRAL, TREINO LIVRE'), 'planos recentes na lista suspensa');
  assert.ok(!f.includes('name="consultoraAtribuida"') && !f.includes('name="blocoGestao"'), 'a consultora não atribui nem classifica');
  const fd = T.formHtml(LISTA.blocos.degustacoes[0], null, 'degustacoes', LISTA, 'equipe', H);
  assert.ok((fd.match(/name="semana\d"/g) || []).length === 4 && fd.includes('Converteu?'));
  const fg = T.formHtml(LISTA.blocos.verificar[0], null, 'verificar', LISTA, 'gestao', H);
  assert.ok(fg.includes('name="consultoraAtribuida"') && fg.includes('name="blocoGestao"'));
  const fg2 = T.formHtml(LISTA.blocos.renovacoes[0], null, 'renovacoes', LISTA, 'gestao', H);
  assert.ok(fg2.includes('name="consultoraAtribuida"') && !fg2.includes('name="blocoGestao"'), 'classificar só no verificar');
  ok('formulário: campos da consultora, 10 motivos, planos recentes, 4 semanas na degustação; gestão atribui e classifica');
}

/* 6. o motivo da falha em português, nunca o HTML da página de erro da Pacto (visto em 29/09/2026) */
{
  assert.strictEqual(T.motivoLegivel('HTTP 503 <html>\n<head><title>503 Service Temporarily Unavailable</title></head>'), 'a Pacto estava fora do ar (erro 503)');
  assert.strictEqual(T.motivoLegivel('HTTP 429 Rate limit excedido'), 'a Pacto recusou por excesso de consultas');
  assert.strictEqual(T.motivoLegivel('HTTP 401'), 'a Pacto recusou a credencial (erro 401)');
  assert.strictEqual(T.motivoLegivel('a Pacto respondeu sem nenhum contrato, e antes havia'), 'a Pacto respondeu sem nenhum contrato, e antes havia');
  const p = lido(T.painelHtml({ ...LISTA, ultimaFalha: { situacao: 'falhou', motivo: 'HTTP 503 <html><head><title>503</title></head>' } }, {}, 'CP', 'gestao', H));
  assert.ok(p.includes('fora do ar') && !/html|head/i.test(p), p.slice(0, 200));
  ok('motivo da falha legível, sem o HTML da Pacto');
}

console.log('\n✅ smoke-renovacoes-tela: ' + n);
