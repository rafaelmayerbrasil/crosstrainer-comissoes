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

/* 7–11. montar(): o mês de outubro inventado */
const K = (codigoContrato, codigoCliente, nomeCliente, matriculaCliente) => ({ codigoContrato, codigoCliente, nomeCliente, matriculaCliente: matriculaCliente || String(5000 + Number(codigoCliente)) });
const C = (nomePlano, vigenciaDe, vigenciaAte, consultor) => ({ nomePlano, vigenciaDe, vigenciaAte, consultor: consultor || null });
const PREVISAO = {
  mes: {
    contratos: [
      K('101', '11', 'ANA ANUAL'),
      K('102', '12', 'BETO RECORRENTE'),
      K('103', '13', 'CAIO CREDITO'),
      K('104', '14', 'DORA DEGUSTA'),
      K('105', '15', 'EDU IMPORTADO'),
      K('106', '16', 'FABI SEMDADOS'),
      K('107', '17', 'GUGA CPF', '52998224725'),
      K('108', '11', 'ANA ANUAL'),
      K('109', '18', 'HELO ECONOMICO'),
    ],
    renovados: ['101'],
  },
  antecipacao: {
    contratos: [K('201', '21', 'IVO ANTECIPA'), K('202', '22', 'JU FORA'), K('101', '11', 'ANA ANUAL')],
    renovados: [],
  },
};
const CONTRATOS = {
  101: C('ANUAL, ACESSO ILIMITADO', '01/10/2025', '20/10/2026', 'KALI'),
  102: C('ACESSO LIVRE | RECORRENTE | FLEX | 3X | PADRÃO', '15/09/2026', '15/10/2026'),
  103: C('CRÉDITO DE 2 OU MAIS AULAS', '01/09/2026', '08/10/2026'),
  104: C('MÊS DEGUSTAÇÃO LIVRE', '10/09/2026', '10/10/2026'),
  105: C('IMPORTAÇÃO', '01/10/2025', '05/10/2026'),
  107: C('HIIT/MAROMBINHA | MENSAL | CP | 3X | PADRÃO', '01/10/2026', '31/10/2026'),
  108: C('ANUAL, ACESSO ILIMITADO', '28/10/2025', '28/10/2026'),
  109: C('PLANO ECONÔMICO MENSAL', '12/09/2026', '12/10/2026'),
  201: C('SEMESTRAL, TREINO LIVRE', '10/05/2026', '10/11/2026'),
  202: C('ANUAL', '20/11/2025', '20/11/2026'),
};
const LISTA = RL.montar({ mes: '2026-10', hoje: '2026-10-05', previsao: PREVISAO, contratos: CONTRATOS, historico: HIST,
  gestao: { 106: { consultoraAtribuida: 'FRANCINI' } }, desdeAnterior: { 202: '2026-09-30' } });
const cods = b => LISTA.blocos[b].map(l => l.codigoContrato);
{
  assert.deepStrictEqual(cods('renovacoes'), ['105', '109', '101', '107'], 'ordem de vencimento');
  assert.deepStrictEqual(LISTA.blocos.renovacoes.map(l => l.n), [1, 2, 3, 4]);
  assert.deepStrictEqual(cods('antecipacao'), ['201']);
  assert.deepStrictEqual(LISTA.blocos.antecipacao.map(l => l.n), [5], 'a antecipação continua a numeração');
  assert.deepStrictEqual(cods('degustacoes'), ['104', '301'], 'a degustação do histórico entra depois, por vencimento');
  assert.deepStrictEqual(LISTA.blocos.degustacoes.map(l => l.n), [1, 2], 'degustação tem numeração própria');
  assert.deepStrictEqual(cods('verificar'), ['106', '202']);
  assert.deepStrictEqual(LISTA.blocos.verificar.map(l => l.n), [null, null]);
  ok('blocos e numeração: renovações 1–4, antecipação 5, degustações 1–2, verificar sem número');
}
{
  assert.deepStrictEqual(LISTA.excluidos, { duplicado: 2, recorrente: 1, credito: 1 });
  assert.deepStrictEqual(LISTA.conferencia, { totalPacto: 12, naLista: 8, excluidos: 4, bate: true, diferenca: 0 });
  const ana = LISTA.blocos.renovacoes.find(l => l.codigoContrato === '101');
  assert.strictEqual(ana.vencimento, '2026-10-20', 'fica o vencimento mais próximo');
  assert.ok(ana.notas.some(t => /repetid/i.test(t)), 'com nota');
  ok('exclusões por motivo, duplicados (mesmo contrato nas duas consultas e mesmo aluno) e conferência que bate');
}
{
  const edu = LISTA.blocos.renovacoes.find(l => l.codigoContrato === '105');
  assert.strictEqual(edu.plano, 'IMPORTAÇÃO');
  assert.strictEqual(edu.planoOriginal, 'SEMESTRAL, TREINO LIVRE');
  assert.strictEqual(edu.consultora, 'BARBARA'); assert.strictEqual(edu.consultoraOrigem, 'historico');
  const ana = LISTA.blocos.renovacoes.find(l => l.codigoContrato === '101');
  assert.strictEqual(ana.consultora, 'KALI'); assert.strictEqual(ana.consultoraOrigem, 'pacto');
  assert.strictEqual(ana.renovouSistema, true);
  assert.ok(ana.notas.some(t => /Pacto já registra a renovação/.test(t)));
  const fabi = LISTA.blocos.verificar.find(l => l.codigoContrato === '106');
  assert.strictEqual(fabi.consultora, 'FRANCINI'); assert.strictEqual(fabi.consultoraOrigem, 'gestao');
  assert.strictEqual(fabi.motivoVerificar, 'A Pacto não devolveu os dados deste contrato');
  const ju = LISTA.blocos.verificar.find(l => l.codigoContrato === '202');
  assert.strictEqual(ju.motivoVerificar, 'Vencimento fora do período (20/11/2026)');
  assert.strictEqual(ju.desde, '2026-09-30', 'guarda desde quando está no verificar');
  assert.strictEqual(fabi.desde, '2026-10-05');
  ok('importação pelo plano original, consultora (gestão › Pacto › histórico), renovado pela Pacto, motivo do verificar');
}
{
  const guga = LISTA.blocos.renovacoes.find(l => l.codigoContrato === '107');
  assert.strictEqual(guga.matricula, null, 'CPF não vira matrícula');
  assert.strictEqual(guga.codigoCliente, '17');
  assert.ok(!JSON.stringify(LISTA).includes('52998224725'), 'o CPF não está em lugar nenhum da lista');
  assert.strictEqual(LISTA.blocos.renovacoes.find(l => l.codigoContrato === '109').economico, true);
  assert.strictEqual(LISTA.blocos.degustacoes.find(l => l.codigoContrato === '301').origem, 'historico');
  assert.deepStrictEqual(LISTA.planosRecentes, ['ANUAL, ACESSO ILIMITADO']);
  assert.deepStrictEqual(LISTA.consultoras, ['BARBARA', 'ERICA', 'FRANCINI', 'KALI']);
  assert.ok(!JSON.stringify(LISTA).includes('undefined') && !/"_cls"/.test(JSON.stringify(LISTA)), 'nada de undefined nem campo interno');
  ok('CPF fora, Econômico marcado, degustação do histórico marcada, planos e consultoras para as listas suspensas');
}
{
  const L2 = RL.montar({ mes: '2026-10', hoje: '2026-10-05', previsao: PREVISAO, contratos: CONTRATOS, historico: HIST,
    gestao: { 106: { blocoGestao: 'excluir' }, 202: { blocoGestao: 'renovacao' } } });
  assert.deepStrictEqual(L2.blocos.verificar.map(l => l.codigoContrato), ['202'], 'fora do período continua no verificar mesmo classificado');
  assert.strictEqual(L2.excluidos.gestao, 1);
  assert.strictEqual(L2.conferencia.bate, true);
  const vazia = RL.montar({ mes: '2026-10', hoje: '2026-10-05', previsao: { mes: { contratos: [], renovados: [] }, antecipacao: { contratos: [], renovados: [] } }, contratos: {}, historico: [] });
  assert.deepStrictEqual(vazia.conferencia, { totalPacto: 0, naLista: 0, excluidos: 0, bate: true, diferenca: 0 });
  ok('a classificação da gestão tira do verificar; lista vazia não quebra');
}

/* 11b. a consultora da Pacto é a VINCULADA AO ALUNO, como nas comissões (30/09/2026) */
{
  const vinc = (c, extra) => Object.assign({}, c, extra);
  const CT = Object.assign({}, CONTRATOS, {
    101: vinc(CONTRATOS[101], { alunoConsultado: true, consultorAluno: 'ISABELA' }),   // contrato KALI, aluno ISABELA
    107: vinc(CONTRATOS[107], { alunoConsultado: true, consultorAluno: null }),         // aluno sem vínculo → histórico
    109: vinc(CONTRATOS[109], { consultor: 'ERICA' }),                                  // aluno ainda não consultado
  });
  const L3 = RL.montar({ mes: '2026-10', hoje: '2026-10-05', previsao: PREVISAO, contratos: CT, historico: HIST });
  const de = c => L3.blocos.renovacoes.find(l => l.codigoContrato === c);
  assert.strictEqual(de('101').consultora, 'ISABELA', 'o vínculo do aluno vale sobre o contrato');
  assert.strictEqual(de('101').consultoraOrigem, 'pacto');
  assert.notStrictEqual(de('107').consultoraOrigem, 'pacto', 'aluno consultado sem vínculo não usa a do contrato');
  assert.strictEqual(de('109').consultora, 'ERICA', 'sem consulta ao aluno, fica a do contrato');
  ok('consultora da Pacto = vínculo do aluno quando consultado (a mesma regra das comissões)');
}

/* 12. situação: a da consultora, ou Sim quando a Pacto já registra */
{
  assert.strictEqual(RL.statusEfetivo({ renovouSistema: false }, null), 'pendente');
  assert.strictEqual(RL.statusEfetivo({ renovouSistema: false }, { renovou: 'negociacao' }), 'negociacao');
  assert.strictEqual(RL.statusEfetivo({ renovouSistema: true }, { renovou: 'nao' }), 'sim');
  assert.strictEqual(RL.statusEfetivo({ renovouSistema: false }, { renovou: 'lixo' }), 'pendente');
  assert.strictEqual(RL.consultoraDaLinha({ consultora: 'KALI' }, { consultoraAtribuida: 'ERICA' }), 'ERICA', 'a atribuição vale na hora, antes da próxima montagem');
  assert.strictEqual(RL.consultoraDaLinha({ consultora: null }, null), null);
  ok('situação efetiva e consultora da linha');
}

/* 13. validações do documento (seção 5) */
{
  const H = '2026-10-05';
  assert.deepStrictEqual(RL.validar({ renovou: 'pendente' }, H), []);
  assert.deepStrictEqual(RL.validar({ renovou: 'negociacao' }, H), ['Informe a data do 1º contato.']);
  assert.deepStrictEqual(RL.validar({ renovou: 'sim', dataContato: '2026-10-01' }, H), ['Informe o plano fechado.']);
  assert.deepStrictEqual(RL.validar({ renovou: 'nao', dataContato: '2026-10-01' }, H), ['Informe o motivo.']);
  assert.deepStrictEqual(RL.validar({ renovou: 'nao', dataContato: '2026-10-01', motivo: 'Outro' }, H), ['Motivo "Outro" exige observação.']);
  assert.deepStrictEqual(RL.validar({ renovou: 'nao', dataContato: '2026-10-01', motivo: 'Outro', observacoes: 'viajou' }, H), []);
  assert.deepStrictEqual(RL.validar({ renovou: 'nao', dataContato: '2026-10-01', motivo: 'Inventado' }, H), ['Motivo fora da lista.']);
  assert.deepStrictEqual(RL.validar({ renovou: 'pendente', dataContato: '2026-10-06' }, H), ['A data do 1º contato não pode ser no futuro.']);
  assert.deepStrictEqual(RL.validar({ renovou: 'sim', dataContato: '2026-10-01', planoFechado: 'ACESSO LIVRE | RECORRENTE' }, H), [], 'renovar para recorrente conta como Sim');
  assert.deepStrictEqual(RL.validar({ semanas: ['2026-10-01', '', '2026-10-09', ''] }, H), ['A data da semana 3 não pode ser no futuro.']);
  ok('validações: contato obrigatório fora do Pendente, plano no Sim, motivo no Não, observação no Outro, nada no futuro');
}

/* 14. alertas (seção 7) */
{
  const H = '2026-10-05';
  const cod = (l, a, b) => RL.alertas(l, a, b, H).map(x => x.codigo);
  assert.deepStrictEqual(cod({ vencimento: '2026-10-09' }, null, 'renovacoes'), ['vence_sem_contato']);
  assert.deepStrictEqual(cod({ vencimento: '2026-10-09' }, { renovou: 'negociacao', dataContato: '2026-10-01' }, 'renovacoes'), []);
  assert.deepStrictEqual(cod({ vencimento: '2026-10-20' }, null, 'renovacoes'), [], 'mais de 7 dias: ainda não');
  assert.deepStrictEqual(cod({ vencimento: '2026-09-20' }, { renovou: 'pendente' }, 'renovacoes'), ['vencido']);
  assert.deepStrictEqual(cod({ vencimento: '2026-09-20' }, { renovou: 'nao', dataContato: '2026-09-18', motivo: 'Lesão ou saúde' }, 'renovacoes'), [], 'com desfecho, sem alerta');
  assert.deepStrictEqual(cod({ inicio: '2026-09-20', vencimento: '2026-10-20' }, { semanas: ['2026-09-25'] }, 'degustacoes'), ['degustacao_sem_acompanhamento']);
  assert.deepStrictEqual(cod({ inicio: '2026-09-20', vencimento: '2026-10-20' }, { semanas: ['2026-10-01'] }, 'degustacoes'), []);
  assert.deepStrictEqual(cod({ desde: '2026-09-30' }, null, 'verificar'), ['verificar_parado']);
  assert.deepStrictEqual(cod({ desde: '2026-10-03' }, null, 'verificar'), []);
  assert.deepStrictEqual(cod({ vencimento: '2026-10-20', renovouSistema: true }, { renovou: 'nao' }, 'renovacoes'), ['divergencia']);
  const v = RL.alertas({ vencimento: '2026-10-09' }, null, 'renovacoes', H)[0];
  assert.strictEqual(v.nivel, 'vermelho'); assert.strictEqual(v.texto, 'Vence em 4 dia(s) e ainda não houve contato');
  ok('alertas: vence em 7 dias sem contato, vencido há +7 dias, degustação sem acompanhamento, verificar parado, divergência');
}

/* 15. painel */
{
  const acomps = { 105: { renovou: 'sim' }, 109: { renovou: 'nao' }, 107: { renovou: 'negociacao' }, 104: { renovou: 'sim', consultoraAtribuida: 'ERICA' } };
  const p = RL.painel(LISTA, acomps, '2026-10-05');
  assert.deepStrictEqual(p.porBloco.renovacoes, { total: 4, sim: 2, nao: 1, negociacao: 1, pendente: 0 }, '101 conta como Sim pela Pacto');
  assert.deepStrictEqual(p.porBloco.antecipacao, { total: 1, sim: 0, nao: 0, negociacao: 0, pendente: 1 });
  assert.deepStrictEqual(p.porBloco.degustacoes, { total: 2, sim: 1, nao: 0, negociacao: 0, pendente: 1 });
  assert.strictEqual(p.totalARenovar, 4);
  assert.strictEqual(p.taxaRenovacao, 50);
  assert.strictEqual(p.conversaoDegustacao, 50);
  assert.deepStrictEqual(p.porConsultora.ERICA, { total: 2, renovados: 1 });
  assert.deepStrictEqual(p.porConsultora['Sem consultora'], { total: 3, renovados: 0 }, '109, 107 e 201');
  assert.deepStrictEqual(p.alertas, { vermelho: 0, laranja: 1 }, 'só o 202, parado no verificar desde 30/09');
  ok('painel: por bloco, taxa de renovação (Sim ÷ Bloco 1), conversão, por consultora, total de alertas');
}

/* 17. importação: o plano original é o do contrato do TecnoFit com a MESMA vigência
       (achado ao medir maio/2026: pegar só o último contrato do aluno virava a
       degustação dele em "renovação" e escondia as 8 degustações do PDF do Rodrigo) */
{
  const H2 = [
    { cliente: 'OLGA', item: 'ANUAL, ACESSO ILIMITADO (01/05/2024 - 30/04/2025)', data: '01/05/2024', vendedor: 'ERICA', codigo: 'T1', isContract: true },
    // no histórico do TecnoFit a degustação NÃO vem marcada como contrato (medido em produção, abr/2026)
    { cliente: 'OLGA', item: 'MÊS DEGUSTAÇÃO LIVRE (10/04/2026 - 09/05/2026)', data: '10/04/2026', vendedor: 'ERICA', codigo: 'T2', isContract: false, isDegustacao: true },
    { cliente: 'PEDRO', item: 'SEMESTRAL, TREINO LIVRE', data: '05/11/2025', vendedor: 'KALI', codigo: 'T3', isContract: true,
      planStartDate: '05/11/2025', planEndDate: '04/05/2026' },
  ];
  assert.strictEqual(RL.planoOriginal('OLGA', H2, { vencimento: '2026-05-09' }), 'MÊS DEGUSTAÇÃO LIVRE', 'mesma data de fim');
  assert.strictEqual(RL.planoOriginal('OLGA', H2, { vencimento: '2025-04-30' }), 'ANUAL, ACESSO ILIMITADO');
  assert.strictEqual(RL.planoOriginal('OLGA', H2, { vencimento: '2027-01-01', inicio: '2026-04-10' }), 'MÊS DEGUSTAÇÃO LIVRE', 'mesma data de início');
  assert.strictEqual(RL.planoOriginal('OLGA', H2, { vencimento: '2027-01-01' }), 'ANUAL, ACESSO ILIMITADO', 'sem data igual: o último que não é degustação, como antes');
  assert.strictEqual(RL.planoOriginal('PEDRO', H2, { vencimento: '2026-05-04' }), 'SEMESTRAL, TREINO LIVRE', 'datas dos campos do item');
  assert.strictEqual(RL.limparNomePlano('HIIT/MAROMBINHA | MENSAL | CP | 3X | PADRÃO (Split: 50 %)'), 'HIIT/MAROMBINHA | MENSAL | CP | 3X | PADRÃO', 'tira a marca da divisão');

  const L3 = RL.montar({ mes: '2026-05', hoje: '2026-05-02',
    previsao: { mes: { contratos: [K('401', '41', 'OLGA')], renovados: [] }, antecipacao: { contratos: [], renovados: [] } },
    contratos: { 401: C('IMPORTAÇÃO', '10/04/2026', '09/05/2026') }, historico: H2 });
  assert.deepStrictEqual(L3.blocos.degustacoes.map(l => l.codigoContrato), ['401'], 'a importação de uma degustação vai para o Bloco 3');
  assert.strictEqual(L3.blocos.degustacoes[0].planoOriginal, 'MÊS DEGUSTAÇÃO LIVRE');
  assert.strictEqual(L3.blocos.renovacoes.length, 0);
  ok('importação: plano original pelo contrato com a mesma vigência; a degustação importada cai no Bloco 3');
}

/* 16. a cópia de functions/ é idêntica à da raiz */
{
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'functions', 'renovacoes-lista.js'), 'utf8'),
    fs.readFileSync(path.join(raiz, 'renovacoes-lista.js'), 'utf8'), 'functions/renovacoes-lista.js divergiu da raiz');
  ok('functions/renovacoes-lista.js idêntico ao da raiz');
}

console.log('\n✅ smoke-renovacoes-lista: ' + n);
