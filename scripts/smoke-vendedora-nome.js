'use strict';
// Roda: node scripts/smoke-vendedora-nome.js
//
// ══════════════════════════════════════════════════════════════════════
// O login da vendedora acha a comissão dela mesmo quando o nome muda
// ══════════════════════════════════════════════════════════════════════
//
// Existe por causa de 14/10/2026: o cadastro da Francini passou de
// "FRANCINI DAS CHAGAS" para "FRANCINI CHAGAS" na tela Pessoas, e o painel dela
// ficou preto — a tela procurava o nome do cadastro DENTRO do nome da venda.
// O mesmo nome ligava o "só as minhas" das Renovações e o mínimo individual do
// bônus (jornada), que cairia no padrão da unidade no recálculo seguinte.
//
// Agora o cadastro guarda `nomeNasComissoes` (o nome exato das comissões e da
// Pacto) e o nome de exibição pode mudar à vontade. Sem o campo, vale a busca
// pelas palavras inteiras — e, se der mais de uma pessoa, NINGUÉM: nunca mostrar
// a comissão de uma colega.

const assert = require('assert');
const path = require('path');
const VN = require(path.join(__dirname, '..', 'vendedora-nome.js'));
const JC = require(path.join(__dirname, '..', 'jornada-comercial.js'));
const JCf = require(path.join(__dirname, '..', 'functions', 'jornada-comercial.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

// Os nomes de outubro/2026 em produção (CP e PP juntos)
const MES = ['FRANCINI DAS CHAGAS', 'ERICA FAUSTINO', 'RODRIGO', 'BENNY ELAND',
  'ISABELA MARINHO DA ROCHA', 'KALI DUTRA', 'BÁRBARA VIEIRA CARDOSO'];

/* 1. o caso que quebrou */
{
  assert.strictEqual(VN.achar({ name: 'FRANCINI CHAGAS' }, MES), 'FRANCINI DAS CHAGAS');
  assert.strictEqual(VN.achar({ name: 'ISABELA MARINHO' }, MES), 'ISABELA MARINHO DA ROCHA');
  assert.strictEqual(VN.achar({ name: 'Francini das Chagas' }, MES), 'FRANCINI DAS CHAGAS');
  assert.strictEqual(VN.achar({ name: 'Barbara Vieira' }, MES), 'BÁRBARA VIEIRA CARDOSO', 'sem acento e encurtado');
  ok('nome encurtado ou sem acento ainda acha a vendedora (Francini, Isabela, Bárbara)');
}

/* 2. a ligação fixa manda — o nome de exibição não importa */
{
  const fran = { name: 'Fran', nomeNasComissoes: 'FRANCINI DAS CHAGAS' };
  assert.strictEqual(VN.achar(fran, MES), 'FRANCINI DAS CHAGAS');
  assert.strictEqual(VN.achar({ name: 'FRANCINI DAS CHAGAS', nomeNasComissoes: 'Francini das Chagas ' }, MES), 'FRANCINI DAS CHAGAS', 'caixa e espaço não importam');
  assert.strictEqual(VN.achar({ name: 'ERICA FAUSTINO', nomeNasComissoes: 'FRANCINI DAS CHAGAS' }, MES), 'FRANCINI DAS CHAGAS', 'a ligação vence o nome');
  assert.strictEqual(VN.achar(fran, ['ERICA FAUSTINO']), null, 'mês sem venda dela: nada (não cai na busca pelo nome)');
  ok('com "nome nas comissões" no cadastro, só ele vale; renomear não quebra mais');
}

/* 3. nunca a comissão de uma colega */
{
  assert.strictEqual(VN.achar({ name: 'ANA' }, ['JULIANA SOUZA']), null, 'pedaço de palavra não conta');
  assert.strictEqual(VN.achar({ name: 'ANA' }, ['ANA PAULA', 'ANA CLARA']), null, 'duas candidatas: nenhuma');
  assert.strictEqual(VN.achar({ name: 'ANA' }, ['ANA', 'ANA CLARA']), 'ANA', 'a igual vence as parecidas');
  assert.strictEqual(VN.achar({ name: 'CHAGAS FRANCINI' }, MES), null, 'fora de ordem não casa');
  assert.strictEqual(VN.achar({ name: '' }, MES), null);
  assert.strictEqual(VN.achar(null, MES), null);
  assert.strictEqual(VN.achar({ name: 'DAS' }, MES), null, 'só conectivo não é nome');
  ok('pedaço de palavra, duas candidatas, ordem trocada ou nome vazio: não mostra nada');
}

/* 4. a mesma regra para uma linha só (o "só as minhas" das Renovações) */
{
  assert.strictEqual(VN.ehDela('FRANCINI DAS CHAGAS', { name: 'FRANCINI CHAGAS' }), true);
  assert.strictEqual(VN.ehDela('ERICA FAUSTINO', { name: 'FRANCINI CHAGAS' }), false);
  assert.strictEqual(VN.ehDela('FRANCINI DAS CHAGAS', { name: 'X', nomeNasComissoes: 'FRANCINI DAS CHAGAS' }), true);
  assert.strictEqual(VN.ehDela('FRANCINI DAS CHAGAS', { name: 'FRANCINI', nomeNasComissoes: 'FRANCINI SOUZA' }), false, 'com ligação, só ela');
  ok('uma linha da lista: é dela pela ligação fixa ou, sem ela, pelas palavras do nome');
}

/* 5. o mínimo individual do bônus segue a ligação, não o nome de exibição */
{
  const users = [
    { name: 'FRANCINI CHAGAS', nomeNasComissoes: 'FRANCINI DAS CHAGAS', role: 'vendedor', jornadasComerciais: [{ desde: '2026-10', tipo: '30h' }] },
    { name: 'ERICA FAUSTINO', profiles: ['vendedor'], jornadasComerciais: [{ desde: '2026-10', tipo: 'integral' }] },
  ];
  const cfg = { minIndivIntegral: 18, minIndiv30h: 12, pctAdaptacao: 50 };
  assert.deepStrictEqual(JC.minimosDoMes(users, '2026-10', cfg), { 'FRANCINI DAS CHAGAS': 12, 'ERICA FAUSTINO': 18 });
  assert.deepStrictEqual(JCf.minimosDoMes(users, '2026-10', cfg), { 'FRANCINI DAS CHAGAS': 12, 'ERICA FAUSTINO': 18 }, 'a cópia do servidor também');
  ok('jornada: o mínimo fica no nome das comissões (tela e atualização automática)');
}

/* 6. sugestão para quem ainda não tem a ligação (script e aba Comercial) */
{
  assert.strictEqual(VN.sugerir({ name: 'FRANCINI CHAGAS' }, MES), 'FRANCINI DAS CHAGAS');
  assert.strictEqual(VN.sugerir({ name: 'FRANCINI CHAGAS', nomeNasComissoes: 'OUTRA' }, MES), 'FRANCINI DAS CHAGAS', 'sugere pelo nome, ignorando a ligação');
  assert.strictEqual(VN.sugerir({ name: 'ANA' }, ['ANA PAULA', 'ANA CLARA']), null);
  ok('sugestão: o único nome das comissões que casa com o do cadastro');
}

console.log('\n✅ smoke-vendedora-nome: ' + n);
