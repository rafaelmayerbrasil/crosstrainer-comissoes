'use strict';
// Roda: node scripts/smoke-renovacoes-lista.js
//
// Lista de renovações (desenho: docs/superpowers/specs/2026-09-29-renovacoes-metas-bonus-design.md, parte A).
// Chama as funções do módulo puro com dados INVENTADOS.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const RL = require(path.join(raiz, 'renovacoes-lista.js'));

let n = 0;
const ok = m => console.log('✓ ' + (++n).toString().padStart(2) + '. ' + m);

/* 1. exclusões: cada palavra do documento do Rodrigo, por palavra inteira */
{
  const casos = [
    ['ACESSO LIVRE | RECORRENTE | FLEX | 3X | PADRÃO', 'recorrente'],
    ['PLANO MENSAL RECORRENTE PERSONAL', 'recorrente'],
    ['PERSONAL EXTERNO RECORRENTE', 'personal_externo'],
    ['CRÉDITO DE 1 AULA', 'credito'],
    ['CRÉDITO DE 2 OU MAIS AULAS', 'credito'],
    ['PACOTE 10 AULAS', 'avulso'],
    ['AULA AVULSA', 'avulso'],
    ['DIÁRIA', 'avulso'],
    ['PERMUTA 3 MESES', 'permuta'],
    ['CORTESIA', 'permuta'],
    ['PLANO COLABORADOR', 'permuta'],
    ['FUNCIONÁRIO', 'permuta'],
    ['TESTE PACTO NÃO USAR', 'teste'],
    ['WELLHUB', 'agregador'],
    ['GYMPASS SILVER', 'agregador'],
    ['TOTALPASS', 'agregador'],
  ];
  casos.forEach(([nome, motivo]) => assert.deepStrictEqual(RL.classificarPlano(nome), { tipo: 'excluir', motivo }, nome));
  ok('exclusões: recorrente, personal externo, crédito, avulso/pacote/diária, permuta/cortesia/colaborador, teste, agregador');
}

/* 2. o que NÃO é excluído */
{
  assert.deepStrictEqual(RL.classificarPlano('ACESSO LIVRE | MENSAL | FLEX | 3X | PADRÃO'), { tipo: 'renovacao', economico: false }, 'MENSAL sem RECORRENTE fica');
  assert.deepStrictEqual(RL.classificarPlano('ANUAL 15 MESES, BLACK FRIDAY HIIT MAROMBINHA [NOV-24]'), { tipo: 'renovacao', economico: false });
  assert.deepStrictEqual(RL.classificarPlano('ANUAL, ESTEFANE TESTEMUNHA'), { tipo: 'renovacao', economico: false }, 'TESTE dentro de outra palavra não exclui');
  assert.deepStrictEqual(RL.classificarPlano('PLANO ECONÔMICO MENSAL'), { tipo: 'renovacao', economico: true });
  ok('MENSAL sem RECORRENTE, promocionais e palavra dentro de outra ficam; Econômico ganha a etiqueta');
}

/* 3. degustação, importação e plano vazio */
{
  assert.deepStrictEqual(RL.classificarPlano('MÊS DEGUSTAÇÃO LIVRE'), { tipo: 'degustacao' });
  assert.deepStrictEqual(RL.classificarPlano('IMPORTAÇÃO'), { tipo: 'importacao' });
  assert.deepStrictEqual(RL.classificarPlano('  '), { tipo: 'verificar', motivo: 'Contrato sem nome de plano na Pacto' });
  assert.deepStrictEqual(RL.classificarPlano(null), { tipo: 'verificar', motivo: 'Contrato sem nome de plano na Pacto' });
  ok('degustação, importação e plano sem nome');
}

console.log('\n✅ smoke-renovacoes-lista: ' + n);
