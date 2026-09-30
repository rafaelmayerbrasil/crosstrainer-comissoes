'use strict';
// Roda: node scripts/smoke-jornada-comercial.js
//
// Jornada da vendedora no cadastro → mínimo individual do mês (spec 2026-09-29 §5.2).
// Decisão do Rafael (29/09): fica no cadastro porque o time muda com o tempo;
// os números (18 integral, 12 para 30h, adaptação 50%) são da configuração da unidade.

const assert = require('assert');
const path = require('path');
const JC = require(path.join(__dirname, '..', 'jornada-comercial.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);
const CFG = { minIndivIntegral: 18, minIndiv30h: 12, pctAdaptacao: 50 };

/* 1. a entrada que vale num mês: a mais recente com "desde" até o mês */
{
  const j = [{ desde: '2026-12', tipo: 'integral' }, { desde: '2026-10', tipo: 'adaptacao' }, { desde: '2026-11', tipo: '30h' }];
  assert.strictEqual(JC.entradaDoMes(j, '2026-09'), null, 'antes da primeira');
  assert.strictEqual(JC.entradaDoMes(j, '2026-10').tipo, 'adaptacao');
  assert.strictEqual(JC.entradaDoMes(j, '2026-11').tipo, '30h');
  assert.strictEqual(JC.entradaDoMes(j, '2027-03').tipo, 'integral');
  assert.strictEqual(JC.entradaDoMes(null, '2026-10'), null);
  ok('a entrada do mês é a mais recente com "a partir de" até ele — meses passados não mudam');
}

/* 2. o mínimo de cada tipo */
{
  assert.strictEqual(JC.minimoDoMes([{ desde: '2026-10', tipo: 'integral' }], '2026-10', CFG), 18);
  assert.strictEqual(JC.minimoDoMes([{ desde: '2026-10', tipo: '30h' }], '2026-10', CFG), 12);
  assert.strictEqual(JC.minimoDoMes([{ desde: '2026-10', tipo: 'adaptacao' }], '2026-10', CFG), 9, '50% de 18');
  assert.strictEqual(JC.minimoDoMes([{ desde: '2026-10', tipo: 'adaptacao' }], '2026-10', { ...CFG, pctAdaptacao: 70 }), 13, '70% de 18, para cima');
  assert.strictEqual(JC.minimoDoMes([{ desde: '2026-10', tipo: 'integral' }], '2026-10', {}), 18, 'sem configuração: os números do Rodrigo');
  assert.strictEqual(JC.minimoDoMes([], '2026-10', CFG), null);
  ok('integral 18 · 30h 12 · adaptação % do integral (para cima) · sem jornada: nada');
}

/* 3. o mapa do mês a partir dos cadastros */
{
  const users = [
    { name: 'ERICA FAUSTINO', profiles: ['vendedor'], jornadasComerciais: [{ desde: '2026-10', tipo: 'integral' }] },
    { name: 'Francini das Chagas', role: 'vendedor', jornadasComerciais: [{ desde: '2026-10', tipo: '30h' }] },
    { name: 'KALI DUTRA', profiles: ['vendedor'] },
    { name: 'PROFESSOR X', profiles: ['professor'], jornadasComerciais: [{ desde: '2026-10', tipo: 'integral' }] },
    { name: 'ISABELA', profiles: ['vendedor'], jornadasComerciais: [{ desde: '2026-11', tipo: '30h' }] },
  ];
  assert.deepStrictEqual(JC.minimosDoMes(users, '2026-10', CFG), { 'ERICA FAUSTINO': 18, 'Francini das Chagas': 12 });
  assert.deepStrictEqual(JC.minimosDoMes(users, '2026-11', CFG), { 'ERICA FAUSTINO': 18, 'Francini das Chagas': 12, ISABELA: 12 });
  ok('mapa do mês: só vendedoras com jornada valendo naquele mês');
}

/* 4. validação da entrada que a gestão digita */
{
  assert.deepStrictEqual(JC.validarEntrada({ desde: '2026-10', tipo: 'integral' }), []);
  assert.deepStrictEqual(JC.validarEntrada({ desde: '10/2026', tipo: 'integral' }), ['Informe o mês no formato AAAA-MM.']);
  assert.deepStrictEqual(JC.validarEntrada({ desde: '2026-10', tipo: 'meio' }), ['Jornada inválida.']);
  assert.deepStrictEqual(JC.validarEntrada({ desde: '2026-10', tipo: '30h' }, [{ desde: '2026-10', tipo: 'integral' }]), ['Já existe uma jornada a partir deste mês — remova a outra antes.']);
  ok('validação: mês AAAA-MM, tipo conhecido, um só por mês');
}

console.log('\n✅ smoke-jornada-comercial: ' + n);
