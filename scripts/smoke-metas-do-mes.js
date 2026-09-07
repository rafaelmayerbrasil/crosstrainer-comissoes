'use strict';
// Roda: node scripts/smoke-metas-do-mes.js
//
// A tela "Configurar Metas do Mês" grava `periodos/{id}.metasMensais`, e o
// cálculo lê { defaultConfig, ...units/{id}.config, ...metasMensais }. Tudo que
// muda de mês para mês tem que caber ali — senão vira config PERMANENTE da
// unidade, decidida uma vez e esquecida.
//
// Foi o que aconteceu com `minAtivacoesIndivP3` em 07/09/2026: o Rodrigo
// aprovou o mínimo 7 no Príncipe como exceção de agosto, e o único lugar onde
// dava para escrever isso era a config da unidade, que vale para sempre.
//
// PARTE 1 é estrutural: o campo existe na tela, é lido ao abrir, é gravado ao
// salvar, e o nome gravado é o mesmo que o motor lê.
// PARTE 2 é comportamental: prova, no motor de verdade, o que o campo faz.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const CE = require(path.join(raiz, 'commission.js'));
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

let n = 0;
const ok = m => console.log('✓ ' + (++n) + '. ' + m);

const trecho = (nome) => {
  const i = html.indexOf('function ' + nome + '(');
  assert.ok(i > 0, 'função ' + nome + ' não existe');
  return html.slice(i, i + 2600);
};

// ════════════════════════════════════════════════════════════════════
// PARTE 1 — o campo existe, abre preenchido e salva
// ════════════════════════════════════════════════════════════════════
const CAMPOS = [
  ['mm_meta', 'meta'], ['mm_metaFixo', 'metaFixo'],
  ['mm_superMeta', 'superMeta'], ['mm_superFixo', 'superFixo'],
  ['mm_metaGold', 'metaGold'], ['mm_goldFixo', 'goldFixo'],
  ['mm_minNovos', 'minNovos'], ['mm_minRenov', 'minRenov'], ['mm_minVoucher', 'minVoucher'],
  ['mm_minAtivIndiv', 'minAtivacoesIndivP3'],
];

{
  const modal = html.slice(html.indexOf('id="metasMesModal"'), html.indexOf('id="metasMesModal"') + 6000);
  CAMPOS.forEach(([id]) => assert.ok(modal.includes('id="' + id + '"'), id + ' não está no modal de metas do mês'));
  ok('os ' + CAMPOS.length + ' campos existem na tela de Metas do Mês');
}
{
  // Abrir tem que preencher TODOS — campo que abre vazio some no salvar,
  // porque `parseInt('') || 0` grava zero sem ninguém perceber.
  const abrir = trecho('openMetasMesModal');
  CAMPOS.forEach(([id]) => assert.ok(abrir.includes("getElementById('" + id + "')"),
    id + ' não é preenchido ao abrir o modal'));
  ok('abrir o modal preenche todos os campos com o valor em vigor');
}
{
  const salvar = trecho('saveMetasMes');
  CAMPOS.forEach(([id, chave]) => {
    assert.ok(salvar.includes("getElementById('" + id + "')"), id + ' não é lido ao salvar');
    assert.ok(new RegExp(chave + '\\s*:').test(salvar), chave + ' não é gravado em metasMensais');
  });
  ok('salvar grava os ' + CAMPOS.length + ' em metasMensais, com o nome que o motor lê');
}
{
  // O nome gravado tem que ser o mesmo que o motor consulta. Um typo aqui
  // grava um campo que ninguém lê, e a tela mente sem dar erro.
  const motor = fs.readFileSync(path.join(raiz, 'commission.js'), 'utf8');
  CAMPOS.forEach(([, chave]) => assert.ok(motor.includes(chave),
    'commission.js não conhece "' + chave + '" — a tela gravaria no vazio'));
  ok('todo campo gravado pela tela é um campo que o commission.js consulta');
}

// ════════════════════════════════════════════════════════════════════
// PARTE 2 — o que o mínimo individual faz com o dinheiro
// ════════════════════════════════════════════════════════════════════
// Duas vendedoras, mesma unidade: uma com 7 ativações, outra com 10.
// O prêmio da unidade (P3) é um bolo só, dividido proporcional ao caixa entre
// quem passou do mínimo. Quem fica abaixo NÃO encolhe o bolo — ela ajudou a
// formar, e o que seria dela é redividido.
function vendas(qtdA, qtdB) {
  const linha = (vend, i, valor) => ({
    'Código': 'C' + (7000 + i), 'Cliente': 'CLIENTE ' + i, 'Data': '05/08/2026',
    'Itens': 'HIIT/MAROMBINHA | ANUAL | LOCAL | ILIMITADO | PADRÃO (05/08/2026 - 04/08/2027)',
    'Valor Venda': valor, 'Desconto Venda': '-', 'Desconto Recebimento': '-',
    'Valor Final': valor, 'Valor Quitado/Recibo': valor, 'Origem': 'Balcão',
    'Tipo de Venda': 'Novo Contrato', 'Vendedor': vend,
  });
  const out = [];
  for (let i = 0; i < qtdA; i++) out.push(linha('ANA', i, 300));
  for (let i = 0; i < qtdB; i++) out.push(linha('BIA', 100 + i, 300));
  return out;
}
const cfgBase = { meta: 10, superMeta: 14, metaGold: 20, minNovos: 0, minRenov: 0, minVoucher: 0 };
const roda = min => CE.calculate(vendas(7, 10), { ...CE.defaultConfig, ...cfgBase, minAtivacoesIndivP3: min }, {});

{
  const com7 = roda(7), com10 = roda(10);
  const p3 = r => Object.fromEntries(Object.entries(r.vendorData).map(([k, v]) => [k, v.p3]));
  const a = p3(com7), b = p3(com10);

  assert.ok(a.ANA > 0, 'com mínimo 7, quem fez 7 entra na divisão');
  assert.strictEqual(b.ANA, 0, 'com mínimo 10, quem fez 7 fica fora');
  assert.ok(b.BIA > a.BIA, 'e o que seria dela vai para quem passou');

  const total = r => Object.values(r.vendorData).reduce((s, v) => s + v.p3, 0);
  assert.strictEqual(Math.round(total(com7) * 100), Math.round(total(com10) * 100),
    'o bolo da unidade não muda — só muda quem come dele');
  ok('mínimo individual decide QUEM divide o P3, não o tamanho do prêmio');
}
{
  // A venda de quem ficou de fora continua contando para a unidade bater a meta
  const com10 = roda(10);
  assert.strictEqual(com10.unitTotals.unitAtivacoes, 17, 'as 7 dela contam para a unidade');
  assert.ok(com10.vendorData.ANA.p3detail.motivos.some(m => /m[ií]nimo individual/i.test(m)),
    'e a tela diz por que ela ficou sem: ' + JSON.stringify(com10.vendorData.ANA.p3detail.motivos));
  ok('a venda de quem ficou fora ainda conta para a meta, e o motivo é explicado');
}
{
  // Sem nada configurado o padrão continua 10 — não pode mudar por acidente
  assert.strictEqual(CE.defaultConfig.minAtivacoesIndivP3, 10);
  const semNada = CE.calculate(vendas(7, 10), { ...CE.defaultConfig, ...cfgBase }, {});
  assert.strictEqual(semNada.vendorData.ANA.p3, 0, 'o padrão de 10 continua valendo');
  ok('sem configurar nada, o padrão segue 10');
}

console.log('\n' + n + '/' + n + ' casos passaram.');
