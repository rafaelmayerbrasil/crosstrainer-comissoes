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
  assert.strictEqual(edu.consultora, null, 'quem vendeu em abr/2025 e não vende há mais de 120 dias saiu da equipe: não herda o aluno');
  assert.strictEqual(edu.consultoraOrigem, null);
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
  ok('importação pelo plano original, consultora (gestão › Pacto; ex-vendedora não herda), renovado pela Pacto, motivo do verificar');
}
{
  const guga = LISTA.blocos.renovacoes.find(l => l.codigoContrato === '107');
  assert.strictEqual(guga.matricula, null, 'CPF não vira matrícula');
  assert.strictEqual(guga.codigoCliente, '17');
  assert.ok(!JSON.stringify(LISTA).includes('52998224725'), 'o CPF não está em lugar nenhum da lista');
  assert.strictEqual(LISTA.blocos.renovacoes.find(l => l.codigoContrato === '109').economico, true);
  assert.strictEqual(LISTA.blocos.degustacoes.find(l => l.codigoContrato === '301').origem, 'historico');
  assert.deepStrictEqual(LISTA.planosRecentes, ['ANUAL, ACESSO ILIMITADO']);
  assert.deepStrictEqual(LISTA.consultoras, ['ERICA', 'FRANCINI', 'KALI']);
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

/* 11c. nome da Pacto → nome do cadastro, e robô do sistema não é consultora (homologação de 30/09/2026) */
{
  const PA = require(path.join(__dirname, '..', 'pacto-adapter.js'));
  Object.entries(PA.APELIDOS).forEach(([pacto, cadastro]) =>
    assert.strictEqual(RL.nomeCanonico(pacto), RL.norm(cadastro), 'apelido do tradutor faltando na lista: ' + pacto));
  assert.strictEqual(RL.nomeCanonico('Kali  López'), 'KALI DUTRA');
  assert.strictEqual(RL.nomeCanonico('ERICA FAUSTINO'), 'ERICA FAUSTINO');
  assert.ok(RL.ehNaoConsultora('PACTO - MÉTODO DE GESTÃO'), 'o robô da migração');
  assert.ok(RL.ehNaoConsultora('RECORRÊNCIA') && RL.ehNaoConsultora('ADMINISTRADOR'));
  assert.ok(!RL.ehNaoConsultora('PATRICIA PACTOLO'), 'PACTO só como palavra inicial');
  const CT = Object.assign({}, CONTRATOS, {
    101: Object.assign({}, CONTRATOS[101], { consultor: 'KALI LÓPEZ' }),
    109: Object.assign({}, CONTRATOS[109], { consultor: 'PACTO - METODO DE GESTAO' }),
  });
  const L4 = RL.montar({ mes: '2026-10', hoje: '2026-10-05', previsao: PREVISAO, contratos: CT, historico: HIST });
  const de = c => L4.blocos.renovacoes.find(l => l.codigoContrato === c);
  assert.strictEqual(de('101').consultora, 'KALI DUTRA', 'o nome do cadastro, o mesmo das comissões e do "só as minhas"');
  assert.notStrictEqual(de('109').consultoraOrigem, 'pacto', 'o robô não vira consultora');
  assert.ok(!L4.consultoras.some(c => /PACTO/.test(c)), 'nem na lista de consultoras');
  ok('Kali López vira Kali Dutra (mesmos apelidos do tradutor); "PACTO - MÉTODO DE GESTÃO" não é consultora');
}
{
  // A Pacto escreve BARBARA, o cadastro (e as comissões) BÁRBARA: vale a grafia do histórico,
  // senão o painel "Por consultora" mostra duas pessoas (visto no staging em 30/09/2026)
  const H2 = HIST.concat([{ cliente: 'OUTRO ALUNO', item: 'PLANO X', data: '01/09/2026', vendedor: 'BÁRBARA VIEIRA CARDOSO', codigo: 'C9', isContract: true }]);
  const CT = Object.assign({}, CONTRATOS, { 101: Object.assign({}, CONTRATOS[101], { consultor: 'BARBARA VIEIRA CARDOSO' }) });
  const L5 = RL.montar({ mes: '2026-10', hoje: '2026-10-05', previsao: PREVISAO, contratos: CT, historico: H2 });
  assert.strictEqual(L5.blocos.renovacoes.find(l => l.codigoContrato === '101').consultora, 'BÁRBARA VIEIRA CARDOSO');
  const semAcento = L5.consultoras.map(RL.norm.bind(RL));
  assert.strictEqual(new Set(semAcento).size, semAcento.length, 'a mesma pessoa uma vez só: ' + L5.consultoras.join(', '));
  ok('a grafia do cadastro vence a da Pacto (BÁRBARA × BARBARA); cada consultora aparece uma vez');
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
  assert.deepStrictEqual(p.porBloco.renovacoes, { total: 4, sim: 2, nao: 1, negociacao: 1, pendente: 0, simAntes: 0 }, '101 conta como Sim pela Pacto');
  assert.deepStrictEqual(p.porBloco.antecipacao, { total: 1, sim: 0, nao: 0, negociacao: 0, pendente: 1, simAntes: 0 });
  assert.deepStrictEqual(p.porBloco.degustacoes, { total: 2, sim: 1, nao: 0, negociacao: 0, pendente: 1, simAntes: 0 });
  assert.strictEqual(p.totalARenovar, 4);
  assert.strictEqual(p.taxaRenovacao, 50);
  assert.strictEqual(p.conversaoDegustacao, 50);
  assert.deepStrictEqual(p.porConsultora.ERICA, { total: 2, renovados: 1 });
  assert.deepStrictEqual(p.porConsultora['Sem consultora'], { total: 4, renovados: 1 }, '105 (Sim), 109, 107 e 201');
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

/* 18–21. Os quatro pontos que o Rodrigo conferiu contra a Pacto em 01/10/2026 */
const PREV1 = lista => ({ mes: { contratos: lista, renovados: [] }, antecipacao: { contratos: [], renovados: [] } });
{
  // 18. o plano de antes da migração vem da OBSERVAÇÃO do contrato; o histórico é reserva
  const contratos = {
    501: Object.assign(C('IMPORTAÇÃO', '01/10/2025', '05/10/2026'), { planoOriginal: 'ANUAL, ACESSO ILIMITADO' }),     // histórico diz SEMESTRAL
    502: Object.assign(C('IMPORTAÇÃO', '13/07/2026', '13/10/2026'), { planoOriginal: 'PERMUTA DIVULGAÇÃO' }),
    503: Object.assign(C('IMPORTAÇÃO', '26/09/2026', '25/10/2026'), { planoOriginal: 'PERSONAL AVULSO' }),
    504: Object.assign(C('IMPORTAÇÃO', '21/10/2025', '21/10/2026'), { planoOriginal: 'ANUAL, TREINO HIIT/MAROMBINHA ACESSO LIVRE' }),  // sem histórico nenhum
    505: C('IMPORTAÇÃO', '21/10/2025', '22/10/2026'),                                                                // sem observação e sem histórico
    506: Object.assign(C('IMPORTAÇÃO', '10/09/2026', '10/10/2026'), { planoOriginal: 'MÊS DEGUSTAÇÃO LIVRE' }),
  };
  const L = RL.montar({ mes: '2026-10', hoje: '2026-10-01', historico: HIST, contratos,
    previsao: PREV1([K('501', '15', 'EDU IMPORTADO'), K('502', '52', 'PERMUTA P'), K('503', '53', 'PERSONAL P'), K('504', '54', 'SEM HISTORICO'), K('505', '55', 'SEM NADA'), K('506', '56', 'DEGUSTA IMPORTADA')]) });
  const de = c => Object.values(L.blocos).flat().find(l => l.codigoContrato === c);
  assert.strictEqual(de('501').planoOriginal, 'ANUAL, ACESSO ILIMITADO', 'a observação da Pacto vence o histórico por nome');
  assert.deepStrictEqual(L.blocos.renovacoes.map(l => l.codigoContrato), ['501', '504'], 'o 504 saiu do Verificar sem precisar de histórico');
  assert.deepStrictEqual(L.excluidos, { permuta: 1, avulso: 1 }, 'importação de permuta e de avulso sai da lista');
  assert.deepStrictEqual(L.blocos.verificar.map(l => l.codigoContrato), ['505']);
  assert.strictEqual(de('505').motivoVerificar, 'Importação sem plano original identificado');
  assert.deepStrictEqual(L.blocos.degustacoes.map(l => l.codigoContrato), ['506', '301'], 'a importada e a do histórico (KIKA)');
  assert.strictEqual(L.conferencia.bate, true);
  ok('importação: o plano original vem da observação do contrato; permuta e avulso saem; sem observação nem histórico, Verificar');
}
{
  // 19. consultora = o vínculo de HOJE; sem vínculo de consultora, a gestão atribui — nunca a ex-vendedora
  const H = HIST.concat([
    { cliente: 'ALUNO DA THAY', item: 'ANUAL, ACESSO ILIMITADO (15/10/2025 - 15/10/2026)', data: '15/10/2025', vendedor: 'THAY SILVA', codigo: 'C601', isContract: true },
    { cliente: 'ALUNO DA KALI', item: 'ANUAL, ACESSO ILIMITADO (16/10/2025 - 16/10/2026)', data: '16/10/2025', vendedor: 'KALI', codigo: 'C602', isContract: true },
  ]);
  const base = C('ANUAL, ACESSO ILIMITADO', '15/10/2025', '15/10/2026');
  const contratos = {
    601: Object.assign({}, base, { alunoConsultado: true, consultorAluno: 'RODRIGO ROJAIS', consultoresAluno: ['RODRIGO ROJAIS'] }),
    602: Object.assign({}, base, { alunoConsultado: true, consultorAluno: null, consultoresAluno: [] }),
    603: Object.assign({}, base),                                              // vínculo não lido, quem vendeu saiu
    604: Object.assign({}, base),                                              // vínculo não lido, quem vendeu segue na equipe
    605: Object.assign({}, base, { alunoConsultado: true, consultorAluno: 'ERICA', consultoresAluno: ['ERICA', 'FRANCINI'] }),
    606: Object.assign({}, base, { alunoConsultado: true, consultorAluno: 'RODRIGO ROJAIS', consultoresAluno: ['RODRIGO ROJAIS', 'KALI LÓPEZ'] }),
    607: Object.assign({}, base, { alunoConsultado: true, consultorAluno: 'RODRIGO ROJAIS', consultoresAluno: ['RODRIGO ROJAIS'] }),
  };
  const prev = PREV1([K('601', '61', 'ALUNO DA THAY'), K('602', '62', 'ALUNO DA KALI'), K('603', '63', 'ALUNO DA THAY'), K('604', '64', 'ALUNO DA KALI'),
    K('605', '65', 'DOIS VINCULOS'), K('606', '66', 'SOCIO E CONSULTORA'), K('607', '67', 'ATRIBUIDO')]);
  // 601 e 603 são o mesmo nome, alunos diferentes (codigoCliente) — ficam as duas linhas
  const L = RL.montar({ mes: '2026-10', hoje: '2026-10-01', historico: H, contratos, previsao: prev, gestao: { 607: { consultoraAtribuida: 'ISABELA' } } });
  const de = c => L.blocos.renovacoes.find(l => l.codigoContrato === c);
  assert.strictEqual(de('601').consultora, null, 'vínculo do sócio: não cai em quem vendeu no TecnoFit');
  assert.ok(de('601').notas.some(t => /vinculado a RODRIGO ROJAIS.*gestão atribui/.test(t)), JSON.stringify(de('601').notas));
  assert.strictEqual(de('602').consultora, null, 'vínculo vazio, mesmo com a vendedora ainda na equipe');
  assert.ok(de('602').notas.some(t => /sem consultora vinculada/i.test(t)));
  assert.strictEqual(de('603').consultora, null, 'vínculo não lido e quem vendeu saiu: Sem consultora');
  assert.strictEqual(de('604').consultora, 'KALI', 'vínculo não lido e quem vendeu segue vendendo: reserva');
  assert.strictEqual(de('604').consultoraOrigem, 'historico');
  assert.strictEqual(de('605').consultora, 'ERICA');
  assert.ok(de('605').notas.some(t => t === 'Dois vínculos de consultora na Pacto: ERICA e FRANCINI'), JSON.stringify(de('605').notas));
  assert.strictEqual(de('606').consultora, 'KALI DUTRA', 'o sócio vem primeiro, mas há uma consultora entre os vínculos');
  assert.strictEqual(de('606').consultoraOrigem, 'pacto');
  assert.strictEqual(de('607').consultora, 'ISABELA'); assert.strictEqual(de('607').notas.length, 0, 'atribuído pela gestão: sem cobrança');
  assert.ok(!L.consultoras.includes('THAY SILVA'), 'ex-vendedora nem aparece na lista de consultoras');
  assert.ok(!/"_/.test(JSON.stringify(L)), 'nenhum campo interno gravado');
  assert.ok(RL.ativasNoHistorico(H, '2026-10-01').has('KALI') && !RL.ativasNoHistorico(H, '2026-10-01').has('THAY SILVA'));
  ok('consultora: vínculo de hoje; sócio ou vazio = Sem consultora com aviso; ex-vendedora não herda; dois vínculos avisados');
}
{
  // 20. quem já renovou: o dia vem do contrato; antes do mês é outra coisa que dentro do mês
  const base = C('ANUAL, ACESSO ILIMITADO', '15/10/2025', '15/10/2026', 'KALI');
  const contratos = {
    701: Object.assign({}, base, { renovadoEm: '28/08/2026', contratoNovo: '4652' }),
    702: Object.assign({}, base, { renovadoEm: '01/10/2026', contratoNovo: '4752' }),
    703: Object.assign({}, base, { renovadoEm: '25/10/2026', contratoNovo: '4408' }),   // data no futuro: sobra da migração
    704: Object.assign({}, base),                                                       // só a Previsão diz que renovou
    705: Object.assign({}, base),
  };
  const prev = PREV1([K('701', '71', 'A'), K('702', '72', 'B'), K('703', '73', 'C'), K('704', '74', 'D'), K('705', '75', 'E')]);
  prev.mes.renovados = ['704'];
  const L = RL.montar({ mes: '2026-10', hoje: '2026-10-02', historico: [], contratos, previsao: prev });
  const de = c => L.blocos.renovacoes.find(l => l.codigoContrato === c);
  assert.deepStrictEqual([de('701').renovouSistema, de('701').renovadoEm, de('701').renovouAntesDoMes], [true, '2026-08-28', true], 'vale mesmo sem estar nos "renovados" da Previsão');
  assert.ok(de('701').notas.includes('Renovou em 28/08/2026, antes de o mês da lista começar'), JSON.stringify(de('701').notas));
  assert.deepStrictEqual([de('702').renovouSistema, de('702').renovadoEm, de('702').renovouAntesDoMes], [true, '2026-10-01', false]);
  assert.ok(de('702').notas.includes('Renovou em 01/10/2026'));
  assert.deepStrictEqual([de('703').renovouSistema, de('703').renovadoEm], [false, null], 'renovação "no futuro" não vale');
  assert.deepStrictEqual([de('704').renovouSistema, de('704').renovadoEm, de('704').renovouAntesDoMes], [true, null, false]);
  assert.ok(de('704').notas.includes('A Pacto já registra a renovação'), 'sem data, a frase de sempre');
  const p = RL.painel(L, { 705: { renovou: 'sim' } }, '2026-10-02');
  assert.deepStrictEqual(p.porBloco.renovacoes, { total: 5, sim: 4, nao: 0, negociacao: 0, pendente: 1, simAntes: 1 });
  assert.deepStrictEqual([p.totalARenovar, p.renovadosAntes, p.renovadosNoMes, p.aNegociar], [5, 1, 3, 4]);
  assert.strictEqual(p.taxaRenovacao, 80, 'a taxa segue sendo Sim ÷ Bloco 1 (documento do Rodrigo, seção 7)');
  ok('renovado: dia da renovação pelo contrato; "antes do mês" separado no painel; data futura da migração ignorada');
}

/* 21–23. As respostas do Rodrigo de 04/10/2026 */
{
  // 21. "Horário Especial" do TecnoFit é o Econômico: leva a etiqueta "Sem desconto de renovação"
  assert.deepStrictEqual(RL.classificarPlano('ANUAL, HORÁRIO ESPECIAL (06H, 09H-12H, 13:30-16H/20H-21:30H) ATÉ 3X/SEMANA'), { tipo: 'renovacao', economico: true });
  assert.deepStrictEqual(RL.classificarPlano('ANUAL, HORÁRIO ESPECIAL , 9 -16H, 20 - 21:30 ILIMITADO'), { tipo: 'renovacao', economico: true });
  assert.deepStrictEqual(RL.classificarPlano('ANUAL, HORÁRIO LIVRE'), { tipo: 'renovacao', economico: false }, 'só "horário" não basta');
  assert.deepStrictEqual(RL.classificarPlano('ANUAL, PROMOÇÃO ESPECIAL'), { tipo: 'renovacao', economico: false }, 'só "especial" não basta');
  const contratos = { 901: Object.assign(C('IMPORTAÇÃO', '10/10/2025', '10/10/2026', 'KALI'), { planoOriginal: 'ANUAL, HORÁRIO ESPECIAL , 9 -16H, 20 - 21:30 ILIMITADO' }) };
  const L = RL.montar({ mes: '2026-10', hoje: '2026-10-05', historico: [], contratos, previsao: PREV1([K('901', '91', 'IMPORTADO ESPECIAL')]) });
  assert.strictEqual(L.blocos.renovacoes[0].economico, true, 'a importação herda a etiqueta do plano original');
  ok('Horário Especial = Econômico: ganha a etiqueta, inclusive pelo plano original da importação');
}
{
  // 22. Mensal que a Pacto cobra em recorrência renova sozinho: sai da lista como o "RECORRENTE".
  // A marca de recorrência sozinha não serve: toda degustação a tem, e o anual no cartão também pode ter.
  const rec = (plano, de, ate, extra) => Object.assign(C(plano, de, ate, 'ERICA'), { recorrencia: true }, extra || {});
  const contratos = {
    801: rec('HIIT/MAROMBINHA | MENSAL | ILIMITADO | PADRÃO.', '20/09/2026', '20/10/2026'),
    802: C('HIIT/MAROMBINHA | MENSAL | ILIMITADO | PADRÃO.', '20/09/2026', '21/10/2026', 'ERICA'),      // mensal SEM recorrência
    803: rec('ACESSO LIVRE | ANUAL | FLEX | ILIMITADO | PADRÃO.', '22/10/2025', '22/10/2026'),          // anual no cartão
    804: rec('PLANO VOUCHER DEGUSTAÇÃO', '23/09/2026', '23/10/2026'),
    805: rec('IMPORTAÇÃO', '24/09/2026', '24/10/2026', { planoOriginal: 'MENSAL, TREINO LIVRE' }),
    806: C('TOI KIDS MENSAL', '25/09/2026', '25/10/2026', 'KALI'),
    807: rec('ACESSO LIVRE | MENSAL | FLEX | ILIMITADO | PADRÃO.', '02/10/2026', '02/11/2026'),        // antecipação
  };
  const prev = PREV1([K('801', '81', 'A'), K('802', '82', 'B'), K('803', '83', 'C'), K('804', '84', 'D'), K('805', '85', 'E'), K('806', '86', 'F')]);
  prev.antecipacao.contratos = [K('807', '87', 'G')];
  const L = RL.montar({ mes: '2026-10', hoje: '2026-10-05', historico: [], contratos, previsao: prev });
  assert.deepStrictEqual(L.blocos.renovacoes.map(l => l.codigoContrato), ['802', '803', '806'], 'mensal sem recorrência, anual em recorrência e TOI Kids ficam');
  assert.deepStrictEqual(L.blocos.antecipacao, [], 'mensal em recorrência também sai da antecipação');
  assert.deepStrictEqual(L.blocos.degustacoes.map(l => l.codigoContrato), ['804'], 'degustação em recorrência continua degustação');
  assert.deepStrictEqual(L.excluidos, { recorrente: 3 });
  assert.deepStrictEqual(L.blocos.recorrentes, [], 'ninguém venceu ainda: nada a apontar');
  assert.strictEqual(L.conferencia.bate, true);
  assert.strictEqual(RL.ehMensalEmRecorrencia('ACESSO LIVRE | MENSAL | FLEX', true), true);
  assert.strictEqual(RL.ehMensalEmRecorrencia('ACESSO LIVRE | MENSAL | FLEX', false), false);
  assert.strictEqual(RL.ehMensalEmRecorrencia('ACESSO LIVRE | SEMESTRAL | FLEX', true), false);
  ok('mensal em recorrência sai como recorrente; anual no cartão, degustação, mensal comum e TOI Kids ficam');
}
{
  // 23. "Renova sozinho, mas vale a conferência": recorrente vencido há 1 dia ou mais sem
  // contrato novo na Pacto é apontado num bloco próprio — fora do Bloco 1, que é o número oficial.
  const R = 'ACESSO LIVRE | RECORRENTE | FLEX | 3X | PADRÃO';
  // `lidoEm`: o dia em que o gateway da Pacto respondeu por este contrato (renovacoes_leituras)
  const rec = (plano, ate, extra) => Object.assign(C(plano, '01/09/2026', ate), { recorrencia: true, lidoEm: '2026-10-05',
    alunoConsultado: true, consultorAluno: 'ERICA', consultoresAluno: ['ERICA'] }, extra || {});
  const contratos = {
    811: rec(R, '04/10/2026'),                                                            // venceu ontem, nada na Pacto
    812: rec(R, '05/10/2026'),                                                            // vence hoje: ainda não é hora
    813: rec(R, '02/10/2026', { renovadoEm: '02/10/2026', contratoNovo: '9001' }),          // renovou sozinho
    814: rec('HIIT/MAROMBINHA | MENSAL | ILIMITADO | PADRÃO.', '02/10/2026'),               // mensal em recorrência, não renovou
    815: rec(R, '03/10/2026'),                                                            // só a Previsão diz que renovou
    816: rec('PERSONAL EXTERNO RECORRENTE', '01/10/2026'),                                // não é aluno de plano
    817: rec(R, '01/10/2026', { renovadoEm: '03/10/2026', contratoNovo: '9002' }),          // já estava apontado e renovou depois
    818: rec(R, '20/09/2026'),                                                            // vencido há mais de 7 dias
    819: C('ANUAL, ACESSO ILIMITADO', '10/10/2025', '10/10/2026', 'KALI'),
  };
  const prev = PREV1(['811', '812', '813', '814', '815', '816', '817', '818', '819'].map((c, i) => K(c, String(800 + i), 'ALUNO ' + c)));
  prev.mes.renovados = ['815'];
  const arg = { mes: '2026-10', hoje: '2026-10-05', historico: [], contratos, previsao: prev };
  const L = RL.montar(Object.assign({ apontadosAntes: ['817'] }, arg));
  const rc = L.blocos.recorrentes;
  assert.deepStrictEqual(rc.map(l => l.codigoContrato), ['818', '817', '814', '811'], 'por vencimento');
  assert.deepStrictEqual(rc.map(l => l.n), [1, 2, 3, 4], 'numeração própria');
  assert.deepStrictEqual(L.blocos.renovacoes.map(l => l.codigoContrato), ['819'], 'o Bloco 1 (número oficial) não muda');
  assert.deepStrictEqual(L.excluidos, { recorrente: 3, personal_externo: 1 }, '812 (vence hoje), 813 e 815 (renovaram) seguem excluídos');
  assert.deepStrictEqual(L.conferencia, { totalPacto: 9, naLista: 5, excluidos: 4, bate: true, diferenca: 0 });
  const de = c => rc.find(l => l.codigoContrato === c);
  assert.strictEqual(de('811').consultora, 'ERICA', 'a consultora é a do vínculo do aluno');
  assert.ok(de('811').notas.includes('Plano recorrente: venceu em 04/10/2026 e a Pacto não registra a renovação automática'), JSON.stringify(de('811').notas));
  assert.strictEqual(de('811').renovouSistema, false);
  assert.deepStrictEqual([de('817').renovouSistema, de('817').renovadoEm], [true, '2026-10-03'], 'quem foi apontado e renovou depois continua na lista, como Sim');
  assert.ok(de('817').notas.includes('Renovou em 03/10/2026'), JSON.stringify(de('817').notas));
  // sem a memória da lista anterior, quem renovou não aparece
  assert.deepStrictEqual(RL.montar(arg).blocos.recorrentes.map(l => l.codigoContrato), ['818', '814', '811']);
  // Só se afirma "não renovou" com uma leitura da Pacto feita DEPOIS do vencimento:
  // leitura do próprio dia (a Pacto fora do ar hoje → vale a de ontem) ainda não prova nada…
  const lidoNoDia = Object.assign({}, contratos, { 811: rec(R, '04/10/2026', { lidoEm: '2026-10-04' }) });
  assert.ok(!RL.montar(Object.assign({}, arg, { contratos: lidoNoDia })).blocos.recorrentes.some(l => l.codigoContrato === '811'), 'lido no dia do vencimento: ainda não');
  // …e contrato que veio do caminho antigo (caderninho/núcleo) não traz a renovação: não é apontado
  const semLeitura = Object.assign({}, contratos, { 811: Object.assign(rec(R, '04/10/2026'), { lidoEm: undefined }) });
  const LS = RL.montar(Object.assign({}, arg, { contratos: semLeitura }));
  assert.ok(!LS.blocos.recorrentes.some(l => l.codigoContrato === '811'), 'sem leitura do gateway não se afirma nada');
  assert.strictEqual(LS.excluidos.recorrente, 5, 'segue como recorrente excluído (812, 813, 815, 817 e agora o 811)');
  assert.strictEqual(RL.naoRenovouSozinho({ vencimento: '2026-10-04', renovado: false, lidoEm: '2026-10-05' }), true);
  assert.strictEqual(RL.naoRenovouSozinho({ vencimento: '2026-10-05', renovado: false, lidoEm: '2026-10-05' }), false);
  assert.strictEqual(RL.naoRenovouSozinho({ vencimento: '2026-10-01', renovado: true, lidoEm: '2026-10-05' }), false);
  assert.strictEqual(RL.naoRenovouSozinho({ vencimento: '', renovado: false, lidoEm: '2026-10-05' }), false, 'sem vencimento não há o que conferir');
  assert.strictEqual(RL.naoRenovouSozinho({ vencimento: '2026-10-01', renovado: false, lidoEm: '' }), false);

  const p = RL.painel(L, { 814: { renovou: 'negociacao', dataContato: '2026-10-03' } }, '2026-10-05');
  assert.deepStrictEqual(p.porBloco.recorrentes, { total: 4, sim: 1, nao: 0, negociacao: 1, pendente: 2, simAntes: 0 });
  assert.strictEqual(p.recorrentesEmAberto, 3);
  assert.strictEqual(p.totalARenovar, 1, 'os recorrentes apontados não entram no total a renovar');
  assert.strictEqual(p.taxaRenovacao, 0, 'nem na taxa de renovação');
  assert.deepStrictEqual(p.porConsultora, { KALI: { total: 1, renovados: 0 } }, 'nem no placar por consultora');
  assert.ok(RL.alertas(de('818'), null, 'recorrentes', '2026-10-05').some(a => a.codigo === 'vencido' && a.nivel === 'vermelho'), 'vencido há mais de 7 dias: alerta vermelho');
  assert.ok(!/"_/.test(JSON.stringify(L)), 'nenhum campo interno gravado');
  // lista gravada antes desta mudança (sem o bloco): o painel não quebra
  const antiga = JSON.parse(JSON.stringify(L)); delete antiga.blocos.recorrentes;
  assert.deepStrictEqual(RL.painel(antiga, {}, '2026-10-05').porBloco.recorrentes, { total: 0, sim: 0, nao: 0, negociacao: 0, pendente: 0, simAntes: 0 });
  ok('recorrente que não renovou sozinho: apontado 1 dia depois do vencimento, em bloco próprio, fora do número oficial');
}
{
  // 24. o último dia do mês só pode ser conferido no dia 1 — a lista do mês que acabou é refeita nos dias 1 e 2
  assert.deepStrictEqual(RL.mesesParaManter('2026-11-01'), ['2026-11', '2026-10'], 'o mês corrente primeiro: se a Pacto cortar as consultas, é ele que não pode faltar');
  assert.deepStrictEqual(RL.mesesParaManter('2026-11-02'), ['2026-11', '2026-10']);
  assert.deepStrictEqual(RL.mesesParaManter('2026-11-03'), ['2026-11']);
  assert.deepStrictEqual(RL.mesesParaManter('2027-01-01'), ['2027-01', '2026-12'], 'virada de ano');
  assert.strictEqual(RL.mesAnterior('2026-03'), '2026-02');
  ok('nos dias 1 e 2 a lista do mês anterior é refeita (confere quem venceu no último dia)');
}

/* 16. a cópia de functions/ é idêntica à da raiz */
{
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'functions', 'renovacoes-lista.js'), 'utf8'),
    fs.readFileSync(path.join(raiz, 'renovacoes-lista.js'), 'utf8'), 'functions/renovacoes-lista.js divergiu da raiz');
  ok('functions/renovacoes-lista.js idêntico ao da raiz');
}

console.log('\n✅ smoke-renovacoes-lista: ' + n);
