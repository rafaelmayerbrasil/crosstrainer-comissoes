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
// `comGateway: true` = o dia foi buscado com a credencial da unidade (traz a vendedora)
const dia = (d, situacao, linhas, extra) => ({ dia: d, unidade: 'PP', situacao, comGateway: true, linhas: JSON.stringify(linhas || []), buscadoEm: '2026-09-04T07:0' + d.slice(9) + ':00Z', ...(extra || {}) });

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
  // Dia buscado SEM a vendedora trava o mês (30/09/2026, antes do deploy): em produção o
  // setembro do CP tinha 264 linhas de contrato, todas sem consultora, e o botão calcularia
  // o mês inteiro como "Sem vendedor" — foi o que aconteceu no staging.
  const semGw = (d, extra) => { const x = dia(d, 'buscado', [linha('4001', '01/09/2026', '100,00')], extra); delete x.comGateway; return x; };
  // (a) formato antigo: gravado antes da credencial por unidade (sem `comGateway` nem `linhasBalcao`)
  const antigo = U.montar({ docs: [semGw('2026-09-01'), dia('2026-09-02', 'buscado')], mes: '2026-09', hoje: '2026-09-03', ApiLinhas: L });
  assert.strictEqual(antigo.trava, true);
  assert.deepStrictEqual(antigo.diasProblema.map(d => d.dia + ' ' + d.situacao), ['2026-09-01 sem_vendedora']);
  // (b) dia novo gravado sem o gateway (credencial faltando na Function): também trava
  const semCred = U.montar({ docs: [dia('2026-09-01', 'buscado', [], { comGateway: false, linhasBalcao: '[]' }), dia('2026-09-02', 'buscado')], mes: '2026-09', hoje: '2026-09-03', ApiLinhas: L });
  assert.deepStrictEqual(semCred.diasProblema.map(d => d.situacao), ['sem_vendedora']);
  // (c) dia gravado pelo código de 30/09 (tem `linhasBalcao`, ainda sem a marca): vale
  const transicao = U.montar({ docs: [semGw('2026-09-01', { linhasBalcao: '[]' }), dia('2026-09-02', 'buscado')], mes: '2026-09', hoje: '2026-09-03', ApiLinhas: L });
  assert.strictEqual(transicao.trava, false);
  // (d) a vendedora ficou incompleta: limite de consultas da noite, ou o gateway caiu no meio
  for (const motivo of ['consultora a completar na próxima busca (limite de consultas da noite)',
    'gateway: falhou — consultora não completada neste dia', 'gateway: limite — consultora do aluno não completada neste dia']) {
    const inc = U.montar({ docs: [dia('2026-09-01', 'buscado', [], { avisos: [{ motivo, contrato: '4001' }] }), dia('2026-09-02', 'buscado')], mes: '2026-09', hoje: '2026-09-03', ApiLinhas: L });
    assert.deepStrictEqual(inc.diasProblema.map(d => d.dia + ' ' + d.situacao), ['2026-09-01 vendedora_incompleta'], motivo);
  }
  // (e) aviso que NÃO trava: aluno sem vínculo (decide quem lançou) e balcão que não veio (não paga comissão)
  const okAvisos = U.montar({ docs: [dia('2026-09-01', 'buscado', [], { avisos: [{ motivo: 'sem consultora conhecida para o contrato', contrato: '4002' }, { motivo: 'vendas de balcão: falhou HTTP 502' }] }), dia('2026-09-02', 'buscado')], mes: '2026-09', hoje: '2026-09-03', ApiLinhas: L });
  assert.strictEqual(okAvisos.trava, false);
  assert.ok(U.ROTULO.sem_vendedora && U.ROTULO.vendedora_incompleta, 'os dois têm rótulo para a tela');
  ok('dia buscado sem a vendedora (formato antigo, sem credencial ou incompleto) trava o mês; aviso de balcão e de aluno sem vínculo não');
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
  assert.strictEqual(r.json[1][L.COL.valor], '100,00', 'só o primeiro pagamento do contrato (sessão 79)');
  assert.deepStrictEqual(r.parcelasDepois, [{ contrato: '4001', dia: '03/09/2026', valor: 50 }], 'a parcela de outro dia fica listada');
  assert.strictEqual(r.dadosAte, '2026-09-03');
  assert.strictEqual(r.buscadoEm, '2026-09-04T07:01:00Z', 'a busca mais antiga do mês');
  assert.strictEqual(r.avisos[0].dia, '2026-09-03');
  // o tradutor reconhece como o relatório de RECEBIDOS
  const t = PA.traduzir(r.json, {});
  assert.strictEqual(t.relatorio, 'recebido');
  assert.strictEqual(t.mes, '2026-09');
  ok('mês montado por contrato (só o 1º pagamento), com cabeçalho do export; o tradutor lê como recebidos');
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

{
  // aviso do painel: a situação que a madrugada gravou em periodos/{id}.automatico
  assert.strictEqual(U.automaticoHtml(null), '');
  assert.strictEqual(U.automaticoHtml({}), '');
  assert.strictEqual(U.automaticoHtml({ automatico: {} }), '', 'sem situação, nada');
  assert.strictEqual(U.automaticoHtml({ automatico: { situacao: 'desconhecida' } }), '', 'situação que não conheço, nada');
  const em = { toDate: () => new Date('2026-10-05T07:12:00Z') };   // 04:12 em São Paulo
  const at = U.automaticoHtml({ automatico: { situacao: 'atualizado', em, dadosAte: '2026-10-04' } });
  assert.ok(/Atualizado automaticamente pela Pacto em 05\/10 às 04:12/.test(at), at);
  assert.ok(/dados até 04\/10/.test(at));
  assert.ok(!/<div style="background/.test(at), 'atualizado é uma linha discreta, sem caixa');
  const tr = U.automaticoHtml({ automatico: { situacao: 'travado', em: '2026-10-05T07:12:00Z', diasProblema: [{ dia: '2026-10-02' }, { dia: '2026-10-03' }] } });
  assert.ok(/parou/.test(tr) && /02\/10, 03\/10/.test(tr) && /var\(--red\)/.test(tr), 'travado diz quais dias faltam, em vermelho');
  assert.ok(/Atualizar pela Pacto/.test(tr) && /planilha/.test(tr), 'e o caminho para resolver');
  const cg = U.automaticoHtml({ automatico: { situacao: 'congelado' } });
  assert.ok(/congelado/.test(cg) && /recibos/.test(cg) && /confirmação/.test(cg), 'congelado explica o porquê e o caminho');
  const er = U.automaticoHtml({ automatico: { situacao: 'erro', motivo: '<script>x</script>' } });
  assert.ok(/deu erro/.test(er) && /&lt;script&gt;/.test(er) && !/<script>/.test(er), 'o motivo do erro sai escapado');
  ok('aviso do painel: atualizado (linha), travado com os dias, congelado, erro escapado; o resto não aparece');
}
{
  const recorta = (ini, fim) => { const a = html.indexOf(ini); const b = html.indexOf(fim, a + ini.length); assert.ok(a > 0 && b > a, 'não achei ' + ini); return html.slice(a, b); };
  const fn = recorta('async function atualizarPelaPacto(', 'function handleFile(file)');
  const iConf = fn.indexOf('Os recibos deste mês já foram emitidos');
  const iProc = fn.indexOf('processarPlanilha(m.json');
  assert.ok(iConf > 0 && iConf < iProc, 'confirma ANTES de processar');
  const bloco = fn.slice(fn.lastIndexOf("db.collection('pagamentos')", iConf), iProc);
  assert.ok(/where\('periodId', '==', `\$\{currentUnitId\}_\$\{mes\}`\)/.test(bloco), 'procura o recibo do mês e da unidade');
  assert.ok(/!== 'cancelado'/.test(bloco), 'recibo cancelado não conta');
  assert.ok(/!confirm\(/.test(bloco) && /return;/.test(bloco), 'quem não confirma para ali');
  assert.ok(/UploadPelaApi\.automaticoHtml\(data\)/.test(html), 'o painel mostra o aviso da madrugada');
  ok('botão: mês com recibo (não cancelado) pede confirmação antes de processar; painel mostra o aviso');
}

console.log('\n✅ smoke-upload-pela-api: ' + n);
