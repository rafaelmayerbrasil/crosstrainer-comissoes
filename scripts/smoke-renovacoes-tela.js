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

/* 7. o atalho no menu de Comissões (autorizado pelo Rafael em 30/09/2026) */
{
  const idx = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
  assert.strictEqual((idx.match(/href="renovacoes\.html"/g) || []).length, 2, 'no menu da gestão e no da vendedora');
  assert.ok(/<span class="icon">🔁<\/span>Renovações/.test(idx));
  ok('atalho "Renovações" no menu lateral da gestão e da vendedora');
}

/* 8. "Classificar como" com texto legível; o valor gravado não muda (homologação de 30/09/2026) */
{
  const fg = T.formHtml(LISTA.blocos.verificar[0], null, 'verificar', LISTA, 'gestao', H);
  assert.ok(fg.includes('<option value="renovacao">Renovação do mês</option>'), 'renovação legível');
  assert.ok(fg.includes('<option value="degustacao">Voucher — Mês Degustação</option>'), 'degustação legível');
  assert.ok(fg.includes('<option value="excluir">Tirar da lista</option>'), 'excluir legível');
  assert.ok(!/>renovacao · degustacao · excluir/.test(fg), 'sem os códigos crus na dica');
  const marcado = T.formHtml(LISTA.blocos.verificar[0], { blocoGestao: 'excluir' }, 'verificar', LISTA, 'gestao', H);
  assert.ok(marcado.includes('<option value="excluir" selected>Tirar da lista</option>'), 'a escolha gravada volta marcada');
  ok('"Classificar como": rótulos legíveis, valores gravados iguais');
}

/* 9. 01/10/2026: a renovação com data, "antes do mês", o aviso do vínculo e o que não foi conferido na Pacto */
{
  const L2 = { ...LISTA, leitura: { total: 10, relidos: 10, daReserva: 0, semLeitura: 0, motivo: '', consultasGateway: 22 },
    blocos: { ...LISTA.blocos, renovacoes: [
      linha({ codigoContrato: '701', nome: 'RENOVOU EM AGOSTO', renovouSistema: true, renovadoEm: '2026-08-28', renovouAntesDoMes: true, notas: ['Renovou em 28/08/2026, antes de o mês da lista começar'] }),
      linha({ codigoContrato: '702', nome: 'RENOVOU EM OUTUBRO', renovouSistema: true, renovadoEm: '2026-10-01', renovouAntesDoMes: false, n: 2 }),
      linha({ codigoContrato: '703', nome: 'SEM DATA', renovouSistema: true, n: 3 }),
      linha({ codigoContrato: '704', nome: 'DO SOCIO', consultora: null, consultoraOrigem: null, n: 4,
        notas: ['Na Pacto o aluno está vinculado a RODRIGO ROJAIS, que não é consultora da lista: a gestão atribui'] }),
    ] } };
  const linhas = T.blocoHtml(T.BLOCOS[0], L2.blocos.renovacoes, {}, { hoje: H }).split('<tr data-contrato').slice(1);
  assert.strictEqual(linhas.length, 4);
  assert.ok(lido(linhas[0]).includes('pela Pacto em 28/08/2026') && lido(linhas[0]).includes('antes do mês'), lido(linhas[0]));
  assert.ok(lido(linhas[1]).includes('pela Pacto em 01/10/2026') && !lido(linhas[1]).includes('antes do mês'));
  assert.ok(/pela Pacto\s*(?!em)/.test(lido(linhas[2])) && !lido(linhas[2]).includes('pela Pacto em'), 'sem data, só "pela Pacto"');
  assert.ok(lido(linhas[3]).includes('Sem consultora') && lido(linhas[3]).includes('vinculado a RODRIGO ROJAIS'), 'a gestão vê por que está sem consultora');

  const g = lido(T.painelHtml(L2, {}, 'CP', 'gestao', H));
  assert.ok(g.includes('Dos renovados: antes de o mês começar · dentro do mês 1 · 2'), g.slice(0, 400));
  assert.ok(g.includes('Contratos conferidos na Pacto nesta atualização') && g.includes('10 de 10'));
  assert.ok(!g.includes('não puderam ser conferidos'), 'tudo relido: sem aviso');
  const parcial = { ...L2, leitura: { total: 10, relidos: 6, daReserva: 4, semLeitura: 0, motivo: 'limite', consultasGateway: 14 } };
  const gp = lido(T.painelHtml(parcial, {}, 'CP', 'gestao', H));
  assert.ok(gp.includes('4 de 10 contrato(s) não puderam ser conferidos na Pacto nesta atualização (a Pacto recusou por excesso de consultas)'), gp.slice(0, 400));
  assert.ok(gp.includes('valem o plano, o vencimento e a consultora da última leitura'));
  const ep = lido(T.painelHtml(parcial, {}, 'CP', 'equipe', H));
  assert.ok(!ep.includes('não puderam ser conferidos'), 'o aviso da leitura é da gestão');
  assert.ok(ep.includes('Dos renovados: antes de o mês começar · dentro do mês 1 · 2'), 'a consultora vê a divisão dos renovados');
  assert.strictEqual(T.leituraHtml(LISTA), '', 'lista antiga, sem o campo: nada quebra');
  ok('renovado com a data e a marca "antes do mês"; painel separa antes × dentro do mês; aviso do que a Pacto não devolveu (só gestão)');
}

/* 10. "Plano fechado" só no Sim, "Motivo" só no Não (pedido do Rafael, 02/10/2026) */
{
  const campo = (html, so) => { const m = html.match(new RegExp('<label data-so="' + so + '"( hidden)?>')); assert.ok(m, 'campo data-so=' + so + ' sumiu'); return !m[1]; };
  const f = (acomp, bloco) => T.formHtml(LISTA.blocos[bloco || 'renovacoes'][0], acomp, bloco || 'renovacoes', LISTA, 'equipe', H);
  assert.deepStrictEqual([campo(f(null), 'sim'), campo(f(null), 'nao')], [false, false], 'Pendente: nenhum dos dois');
  assert.deepStrictEqual([campo(f({ renovou: 'negociacao' }), 'sim'), campo(f({ renovou: 'negociacao' }), 'nao')], [false, false], 'Em negociação: nenhum dos dois');
  assert.deepStrictEqual([campo(f({ renovou: 'sim' }), 'sim'), campo(f({ renovou: 'sim' }), 'nao')], [true, false], 'Sim: só o plano fechado');
  assert.deepStrictEqual([campo(f({ renovou: 'nao' }), 'sim'), campo(f({ renovou: 'nao' }), 'nao')], [false, true], 'Não: só o motivo');
  assert.deepStrictEqual([campo(f({ renovou: 'sim' }, 'degustacoes'), 'sim'), campo(f({ renovou: 'nao' }, 'degustacoes'), 'nao')], [true, true], 'vale para a degustação');
  assert.ok(/data-so="sim"[^>]*>Plano fechado/.test(f(null)) && /data-so="nao"[^>]*>Motivo de não ter renovado/.test(f(null)));
  assert.ok(/Motivo de não ter convertido/.test(f(null, 'degustacoes')));

  // trocar a situação no formulário aberto mostra e esconde na hora (a mesma função que o onchange chama)
  const falsoForm = situacao => {
    const campos = [{ dataset: { so: 'sim' }, hidden: false }, { dataset: { so: 'nao' }, hidden: false }];
    return { elements: { renovou: { value: situacao } }, querySelectorAll: () => campos, campos };
  };
  const visiveis = s => { const fm = falsoForm(s); T.aplicarSituacao(fm); return fm.campos.filter(c => !c.hidden).map(c => c.dataset.so); };
  assert.deepStrictEqual(visiveis('pendente'), []); assert.deepStrictEqual(visiveis('negociacao'), []);
  assert.deepStrictEqual(visiveis('sim'), ['sim']); assert.deepStrictEqual(visiveis('nao'), ['nao']);
  const js = fs.readFileSync(path.join(raiz, 'renovacoes.js'), 'utf8');
  assert.ok(/form\.elements\.renovou\.onchange = \(\) => aplicarSituacao\(form\)/.test(js), 'a troca da situação está ligada ao formulário');

  // campo escondido não é gravado: mudar de Sim para Não não deixa o plano para trás (nem o contrário)
  const d = { planoAlvo: 'A', dataContato: '2026-10-01', observacoes: 'x', planoFechado: 'ANUAL', motivo: 'Outro' };
  const sd = x => JSON.parse(JSON.stringify(T.soDaSituacao(x)));   // o objeto nasce no sandbox
  assert.deepStrictEqual(sd({ ...d, renovou: 'nao' }), { ...d, renovou: 'nao', planoFechado: '' });
  assert.deepStrictEqual(sd({ ...d, renovou: 'sim' }), { ...d, renovou: 'sim', motivo: '' });
  assert.deepStrictEqual(sd({ ...d, renovou: 'pendente' }), { ...d, renovou: 'pendente', planoFechado: '', motivo: '' });
  assert.ok(/const dados = soDaSituacao\(\{/.test(js), 'o que é gravado passa pelo filtro');
  assert.deepStrictEqual([...RL.validar(T.soDaSituacao({ ...d, renovou: 'sim', planoFechado: '' }), H)], ['Informe o plano fechado.'], 'as travas continuam valendo');
  ok('"Plano fechado" só aparece no Sim e "Motivo" só no Não; troca na hora; campo escondido não é gravado');
}

/* 11. a vendedora chega na lista pelo celular (Rodrigo, 02/10/2026): no celular a barra lateral
       some e só existe a barra de baixo — e ela não tinha Renovações, então só a gestão (no
       computador) achava a lista. A barra é montada de verdade, não procurada no texto. */
{
  const idx = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
  const fonteMob = idx.match(/function buildMobileNav\(\) \{[\s\S]*?\n\s*function mobileNavTo\(/);
  assert.ok(fonteMob, 'não achei buildMobileNav no index.html');
  const barraDe = perfil => {
    const nav = { innerHTML: '' };
    const sb = { document: { getElementById: id => (id === 'mobileNav' ? nav : null) }, userProfile: perfil };
    vm.createContext(sb);
    vm.runInContext(fonteMob[0].replace(/function mobileNavTo\($/, '') + '\nbuildMobileNav();', sb);
    return nav.innerHTML;
  };
  const vend = barraDe({ role: 'vendedor' });
  assert.ok(/location\.href='renovacoes\.html'/.test(vend), 'barra do celular da vendedora leva à lista de renovações');
  assert.ok(/Renova/.test(lido(vend)), 'com o nome na tela');
  assert.ok(vend.indexOf('renovacoes.html') > vend.indexOf('termometro.html'), 'depois do termômetro');
  ok('barra do celular da vendedora tem Renovações (no celular a barra lateral não aparece)');
}

/* 12. respostas do Rodrigo de 04/10/2026: o bloco dos recorrentes que não renovaram sozinhos */
{
  const def = T.BLOCOS.find(b => b.id === 'recorrentes');
  assert.ok(def && !def.soGestao, 'a consultora vê o bloco: é ela quem vai atrás do aluno');
  assert.deepStrictEqual([...T.BLOCOS.map(b => b.id)], ['renovacoes', 'antecipacao', 'degustacoes', 'recorrentes', 'verificar']);
  const rec = linha({ codigoContrato: '811', nome: 'NICO RECORRENTE', plano: 'ACESSO LIVRE | RECORRENTE | FLEX | 3X | PADRÃO', vencimento: '2026-10-03', consultora: 'ERICA', n: 1,
    notas: ['Plano recorrente: venceu em 03/10/2026 e a Pacto não registra a renovação automática'] });
  const L3 = { ...LISTA, blocos: { ...LISTA.blocos, recorrentes: [rec] } };
  const ids = (lista, perfil) => [...T.blocosVisiveis(lista, perfil)].map(b => b.id);
  assert.deepStrictEqual(ids(L3, 'equipe'), ['renovacoes', 'antecipacao', 'degustacoes', 'recorrentes']);
  assert.deepStrictEqual(ids(L3, 'gestao'), ['renovacoes', 'antecipacao', 'degustacoes', 'recorrentes', 'verificar']);
  assert.deepStrictEqual(ids(LISTA, 'equipe'), ['renovacoes', 'antecipacao', 'degustacoes'], 'sem ninguém apontado (ou lista antiga, sem o bloco), ele não aparece');
  assert.deepStrictEqual(ids({ ...L3, blocos: { ...L3.blocos, recorrentes: [] } }, 'gestao'), ['renovacoes', 'antecipacao', 'degustacoes', 'verificar']);
  const b = lido(T.blocoHtml(def, L3.blocos.recorrentes, {}, { hoje: H }));
  assert.ok(b.includes('Recorrentes que não renovaram sozinhos (1)'), b.slice(0, 120));
  assert.ok(b.includes('Não entram no total a renovar'), 'a explicação do bloco aparece');
  assert.ok(b.includes('NICO RECORRENTE') && b.includes('a Pacto não registra a renovação automática') && b.includes('ERICA'));
  const f = T.formHtml(rec, null, 'recorrentes', L3, 'equipe', H);
  assert.ok(f.includes('Renovou?') && f.includes('name="planoAlvo"') && f.includes('name="dataContato"'), 'o mesmo formulário das renovações');
  const p = lido(T.painelHtml(L3, {}, 'CP', 'equipe', H));
  assert.ok(p.includes('Recorrentes que não renovaram sozinhos: em aberto · resolvidos 1 · 0'), p.slice(0, 600));
  assert.ok(p.includes('3 Total a renovar no mês'), 'o total a renovar continua sendo o Bloco 1: ' + p.slice(0, 200));
  assert.ok(!lido(T.painelHtml(LISTA, {}, 'CP', 'equipe', H)).includes('Recorrentes que não renovaram'), 'sem apontados, o painel não fala deles');
  const js = fs.readFileSync(path.join(raiz, 'renovacoes.js'), 'utf8');
  assert.ok(js.includes('blocosVisiveis(l, estado.perfil).forEach('), 'a página desenha os blocos por blocosVisiveis');
  // a etiqueta do Econômico vale para o "Horário Especial" (a lista já vem com economico: true)
  const esp = lido(T.blocoHtml(T.BLOCOS[0], [linha({ plano: 'IMPORTAÇÃO', planoOriginal: 'ANUAL, HORÁRIO ESPECIAL , 9 -16H', economico: true })], {}, { hoje: H }));
  assert.ok(esp.includes('Sem desconto de renovação'));
  ok('bloco "Recorrentes que não renovaram sozinhos": só aparece com alguém apontado, a consultora vê e preenche; painel resume');
}

console.log('\n✅ smoke-renovacoes-tela: ' + n);
