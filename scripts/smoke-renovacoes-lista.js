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

/* 4. datas e períodos */
{
  assert.strictEqual(RL.iso('20/10/2026'), '2026-10-20');
  assert.strictEqual(RL.iso('2026-10-20T00:00:00'), '2026-10-20');
  assert.strictEqual(RL.iso(Date.UTC(2026, 9, 20, 3)), '2026-10-20', 'milissegundos: dia em São Paulo');
  assert.strictEqual(RL.iso(''), '');
  assert.strictEqual(RL.iso(null), '');
  assert.deepStrictEqual(RL.periodos('2026-10'), {
    mes: { de: '2026-10-01', ate: '2026-10-31' }, antecipacao: { de: '2026-11-01', ate: '2026-11-15' } });
  assert.deepStrictEqual(RL.periodos('2026-12'), {
    mes: { de: '2026-12-01', ate: '2026-12-31' }, antecipacao: { de: '2027-01-01', ate: '2027-01-15' } }, 'virada de ano');
  assert.strictEqual(RL.periodos('2027-02').mes.ate, '2027-02-28');
  assert.deepStrictEqual(RL.mesesParaManter('2026-10-24'), ['2026-10']);
  assert.deepStrictEqual(RL.mesesParaManter('2026-10-25'), ['2026-10', '2026-11'], 'do dia 25 em diante, o mês seguinte também');
  assert.strictEqual(RL.diasEntre('2026-10-05', '2026-10-09'), 4);
  assert.strictEqual(RL.diasEntre('2026-10-05', '2026-09-20'), -15);
  ok('datas: formatos da Pacto, períodos (mês + 1 a 15 do seguinte), meses mantidos, diferença em dias');
}

/* 5. CPF nunca vira matrícula */
{
  assert.strictEqual(RL.pareceCpf('52998224725'), true);
  assert.strictEqual(RL.pareceCpf('529.982.247-25'), true);
  assert.strictEqual(RL.pareceCpf('52998224724'), false, 'dígito errado');
  assert.strictEqual(RL.pareceCpf('11111111111'), false);
  assert.strictEqual(RL.pareceCpf('5001'), false);
  assert.strictEqual(RL.pareceCpf(null), false);
  ok('CPF reconhecido pelos dígitos verificadores');
}

/* 6. histórico: plano original da IMPORTAÇÃO, consultora e planos recentes */
const HIST = [
  { cliente: 'Edu Importado', item: 'IMPORTAÇÃO [PLANO PRESUMIDO]', data: '05/08/2026', vendedor: 'RODRIGO', codigo: 'C900', isContract: true },
  { cliente: 'EDU IMPORTADO', item: 'SEMESTRAL, TREINO LIVRE (01/04/2025 - 30/09/2025)', data: '10/04/2025', vendedor: 'BARBARA', codigo: 'C500', isContract: true },
  { cliente: 'EDU IMPORTADO', item: 'ÁGUA SEM GÁS', data: '11/04/2025', vendedor: 'ERICA', codigo: 'A77', isContract: false },
  { cliente: 'LIA', item: 'ANUAL, ACESSO ILIMITADO (01/09/2026 - 31/08/2027)', data: '01/09/2026', vendedor: 'KALI', codigo: 'C700', isContract: true },
  { cliente: 'KIKA HIST', item: 'MÊS DEGUSTAÇÃO LIVRE (13/10/2026 - 12/11/2026)', data: '13/10/2026', vendedor: 'ERICA', codigo: 'C301',
    isContract: true, isDegustacao: true, planStartDate: '13/10/2026', planEndDate: '12/11/2026' },
];
{
  assert.strictEqual(RL.planoOriginal('edu importado', HIST), 'SEMESTRAL, TREINO LIVRE', 'ignora a IMPORTAÇÃO e tira as datas');
  assert.strictEqual(RL.planoOriginal('NINGUEM', HIST), null);
  assert.strictEqual(RL.consultoraDoHistorico('EDU IMPORTADO', HIST), 'BARBARA', 'RODRIGO não é consultora da lista');
  assert.strictEqual(RL.consultoraDoHistorico('NINGUEM', HIST), null);
  assert.deepStrictEqual(RL.planosRecentes(HIST, '2026-10-05'), ['ANUAL, ACESSO ILIMITADO'], 'últimos 90 dias, sem degustação nem importação');
  const d = RL.degustacoesDoHistorico(HIST, RL.periodos('2026-10'));
  assert.deepStrictEqual(d, [{ codigoContrato: '301', codigoCliente: null, matriculaCliente: null, nomeCliente: 'KIKA HIST',
    plano: 'MÊS DEGUSTAÇÃO LIVRE', inicio: '2026-10-13', vencimento: '2026-11-12', consultora: 'ERICA' }]);
  assert.deepStrictEqual(RL.degustacoesDoHistorico(HIST, RL.periodos('2026-08')), [], 'fim fora do período');
  ok('histórico: plano original da importação, consultora (sem sócio), planos dos últimos 90 dias, degustações');
}

console.log('\n✅ smoke-renovacoes-lista: ' + n);
