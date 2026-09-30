'use strict';
// Roda: node scripts/smoke-upload-pela-api.js
//
// "Atualizar pela Pacto" (30/09/2026): o módulo puro que monta o mês a partir
// dos dias buscados, e os ganchos no index.html (o botão chama o MESMO caminho
// do arquivo; em trava, não chama). Dados INVENTADOS.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const U = require(path.join(raiz, 'upload-pela-api.js'));
const L = require(path.join(raiz, 'pacto-api-linhas.js'));
const PA = require(path.join(raiz, 'pacto-adapter.js'));
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);

function linha(contrato, dia, valor, plano) {
  const l = new Array(L.TAMANHO_LINHA).fill('');
  l[L.COL.nome] = 'CLIENTE FICTICIO ' + contrato; l[L.COL.contrato] = contrato; l[L.COL.lancamento] = dia;
  l[L.COL.valor] = valor; l[L.COL.forma] = 'PIX'; l[L.COL.empresa] = L.EMPRESA.PP;
  l[L.COL.plano] = plano || 'HIIT/MAROMBINHA | ANUAL | LOCAL'; l[L.COL.produto] = l[L.COL.plano];
  l[L.COL.situacao] = 'Matrícula'; l[L.COL.consultor] = 'CONSULTORA TESTE';
  return l;
}
const dia = (d, situacao, linhas, extra) => ({ dia: d, unidade: 'PP', situacao, linhas: JSON.stringify(linhas || []), buscadoEm: '2026-09-04T07:0' + d.slice(9) + ':00Z', ...(extra || {}) });

{
  assert.deepStrictEqual(U.mesesOferecidos('2026-10-05'), ['2026-10', '2026-09']);
  assert.deepStrictEqual(U.mesesOferecidos('2026-10-10'), ['2026-10', '2026-09']);
  assert.deepStrictEqual(U.mesesOferecidos('2026-10-11'), ['2026-10']);
  assert.deepStrictEqual(U.mesesOferecidos('2027-01-03'), ['2027-01', '2026-12']);
  assert.strictEqual(U.diaCurto('2026-09-29'), '29/09');
  ok('meses oferecidos: o corrente e, até o dia 10, o anterior (vira o ano)');
}
{
  const docs = [dia('2026-09-01', 'buscado', [linha('4001', '01/09/2026', '100,00')]), dia('2026-09-02', 'buscado'),
    dia('2026-09-03', 'falhou', [], { motivo: 'HTTP 503' })];
  const r = U.montar({ docs, mes: '2026-09', hoje: '2026-09-04', ApiLinhas: L });
  assert.strictEqual(r.trava, true);
  assert.deepStrictEqual(r.diasProblema, [{ dia: '2026-09-03', situacao: 'falhou', motivo: 'HTTP 503' }]);
  const faltando = U.montar({ docs: docs.filter(d => d.dia !== '2026-09-02').slice(0, 1), mes: '2026-09', hoje: '2026-09-03', ApiLinhas: L });
  assert.deepStrictEqual(faltando.diasProblema.map(d => d.dia + ' ' + d.situacao), ['2026-09-02 nao_buscado']);
  ok('dia que falhou ou não foi buscado trava o mês');
}
{
  // o mesmo contrato pago em dois dias vira UMA linha (uma ativação)
  const docs = [dia('2026-09-01', 'buscado', [linha('4001', '01/09/2026', '100,00')]),
    dia('2026-09-02', 'vazio_conferir'),
    dia('2026-09-03', 'buscado', [linha('4001', '03/09/2026', '50,00'), linha('0', '03/09/2026', '5,00', '')], { avisos: [{ motivo: 'sem consultora conhecida para o contrato', contrato: '4002' }] })];
  const r = U.montar({ docs, mes: '2026-09', hoje: '2026-09-04', ApiLinhas: L });
  assert.strictEqual(r.trava, false);
  assert.deepStrictEqual(r.vazios, ['2026-09-02'], 'dia vazio não trava, mas aparece');
  assert.deepStrictEqual(r.json[0], L.CABECALHO);
  const contratos = r.json.slice(1).map(l => l[L.COL.contrato]);
  assert.deepStrictEqual(contratos, ['4001', '0']);
  assert.strictEqual(r.json[1][L.COL.valor], '150,00');
  assert.strictEqual(r.dadosAte, '2026-09-03');
  assert.strictEqual(r.buscadoEm, '2026-09-04T07:01:00Z', 'a busca mais antiga do mês');
  assert.strictEqual(r.avisos[0].dia, '2026-09-03');
  // o tradutor reconhece como o relatório de RECEBIDOS
  const t = PA.traduzir(r.json, {});
  assert.strictEqual(t.relatorio, 'recebido');
  assert.strictEqual(t.mes, '2026-09');
  ok('mês montado por contrato, com cabeçalho do export; o tradutor lê como relatório de recebidos');
}
{
  // mês passado inteiro: vai até o último dia dele, não entra dia do mês seguinte
  const docs = [];
  for (let d = 1; d <= 30; d++) docs.push(dia('2026-09-' + String(d).padStart(2, '0'), 'buscado'));
  docs.push(dia('2026-10-01', 'buscado', [linha('4009', '01/10/2026', '10,00')]));
  const degs = [{ unidade: 'PP', mes: '2026-09', contrato: '4638', degustacao: { codigo: 'C4638', contrato: '4638' } },
    { unidade: 'PP', mes: '2026-08', contrato: '4600', degustacao: { codigo: 'C4600', contrato: '4600' } }];
  const r = U.montar({ docs, degustacoes: degs, mes: '2026-09', hoje: '2026-10-05', ApiLinhas: L });
  assert.strictEqual(r.trava, false);
  assert.strictEqual(r.dadosAte, '2026-09-30');
  assert.strictEqual(r.json.length, 1, 'nenhuma linha de outubro');
  assert.deepStrictEqual(r.degustacoes.map(d => d.codigo), ['C4638'], 'só a degustação do mês');
  ok('mês passado vai até o dia 30; degustação só a do mês');
}
{
  const recorta = (ini, fim) => { const a = html.indexOf(ini); const b = html.indexOf(fim, a + ini.length); assert.ok(a > 0 && b > a, 'não achei ' + ini); return html.slice(a, b); };
  assert.ok(/<script src="upload-pela-api\.js\?v=\d{8}"><\/script>/.test(html), 'carrega upload-pela-api.js');
  assert.ok(/<script src="pacto-api-linhas\.js\?v=\d{8}"><\/script>/.test(html), 'carrega pacto-api-linhas.js');
  const fn = recorta('async function atualizarPelaPacto(', 'function handleFile(file)');
  assert.ok(/renderUploadApi\(\);/.test(recorta('function initUpload()', 'function pactoResumoHtml(')), 'abrir o Upload preenche os meses');
  assert.ok(/UploadPelaApi\.montar\(/.test(fn), 'monta pelo módulo');
  assert.ok(/processarPlanilha\(m\.json, [\s\S]{0,120}?\{ origem: 'api', dadosAte: m\.dadosAte, degustacoes: m\.degustacoes \}\)/.test(fn), 'entrega ao caminho comum');
  const iTrava = fn.indexOf('if (m.trava)');
  assert.ok(iTrava > 0, 'decide a trava');
  const ramoTrava = fn.slice(iTrava, fn.indexOf('return;', iTrava) + 7);
  assert.ok(!/processarPlanilha/.test(ramoTrava), 'em trava NÃO processa');
  assert.ok(/buscarPactoSombraManual/.test(fn), 'oferece buscar de novo');
  assert.ok(/pacto_sombra_dias/.test(fn) && /pacto_degustacoes/.test(fn), 'lê os dias e as degustações');
  const pagina = recorta('<div class="page" id="page-upload">', '<!-- ADMIN: USERS -->');
  assert.ok(/id="uploadApi"/.test(pagina) && /onclick="atualizarPelaPacto\(\)"/.test(pagina), 'o botão está na tela de Upload');
  const det = recorta('<details id="uploadPlanilhaB"', '</details>');
  assert.ok(/id="uploadZone"/.test(det), 'a área do arquivo fica dentro do plano B');
  assert.ok(!/id="uploadPreview"/.test(det), 'a prévia fica fora (serve aos dois)');
  assert.ok(pagina.indexOf('id="uploadApi"') < pagina.indexOf('<details id="uploadPlanilhaB"'), 'API primeiro, planilha depois');
  assert.strictEqual((html.match(/<\/html>/g) || []).length, 1, 'index.html com um único </html>');
  ok('index.html: botão na tela de Upload, trava sem processar, planilha recolhida como plano B');
}

console.log('\n✅ smoke-upload-pela-api: ' + n);
