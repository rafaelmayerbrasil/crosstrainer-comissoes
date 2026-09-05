// closing-payroll.js — a folha do mês, uma linha por PESSOA (05/09/2026)
// GEMEO: functions/closing-payroll.js — o deploy das Functions só leva a pasta
// functions/, então existe uma cópia lá. smoke-folha-por-pessoa.js compara as
// duas e falha se divergirem.
//
// ── Por que este arquivo existe ──────────────────────────────────────
// O fechamento era POR UNIDADE, e a mesma conta vivia copiada em dois lugares
// (`professores-shared.js` pra prévia e `functions/index.js` pro fechamento).
// Quem dava aula na CP e na PP entrava nos dois fechamentos, e o valor MENSAL —
// bolsa de estágio, VR, VT, Outros — saía inteiro em cada um. Só o excedente de
// hora do estagiário estava protegido, porque o movimento do banco de horas é
// por pessoa+mês.
//
// Medido na produção em 05/09/2026, agosto: folha certa R$ 24.971,20 × soma dos
// dois fechamentos R$ 32.552,04 → R$ 7.580,84 a mais, em 8 pessoas. Nada tinha
// sido pago errado porque nenhum mês jamais foi fechado.
//
// A regra que este módulo guarda:
//
//   > Cada pessoa aparece UMA vez na folha do mês, e o valor mensal entra UMA
//   > vez, não importa em quantas unidades ela deu aula. A hora, essa sim,
//   > soma — e a divisão por unidade continua registrada em `porUnidade`.
(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('./intern-hour-bank.js') : root.InternHourBank
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ClosingPayroll = api;
})(typeof window !== 'undefined' ? window : globalThis, function (InternHourBank) {
  'use strict';

  const STATUS_QUE_PAGAM = ['realizada', 'substituida'];

  /** Mapa ou objeto simples — quem chama vem de lugares diferentes. */
  function pega(mapaOuObj, chave) {
    if (!mapaOuObj) return null;
    if (typeof mapaOuObj.get === 'function') return mapaOuObj.get(chave) || null;
    return mapaOuObj[chave] || null;
  }
  function tem(mapaOuObj, chave) {
    if (!mapaOuObj) return false;
    if (typeof mapaOuObj.has === 'function') return mapaOuObj.has(chave);
    return Object.prototype.hasOwnProperty.call(mapaOuObj, chave);
  }

  /**
   * Quem recebe pela regra da BOLSA: bolsa cheia no mês + proporcional do que
   * passar do contrato, com banco de horas.
   *
   * Quem decide é o CADASTRO SALARIAL, não o tipo da ficha. Até 05/09/2026 a
   * regra exigia `type === 'estagiario'`, e o Thiago Valentim — ficha
   * 'eventual', salário de bolsa — caía na conta por hora: 88 aulas, 76,25h,
   * R$ 0,00, sem uma palavra na tela. Decisão do Rafael: eventual com bolsa
   * segue a mesma regra do estagiário.
   *
   * `efetivo` fica de fora de propósito: bolsa numa ficha de efetivo é erro de
   * cadastro, e cair no aviso 'sem_valor_hora' é melhor do que pagar em silêncio
   * por uma regra que não é a dele.
   */
  function ehBolsista(teacher, salary) {
    if (!teacher || !salary) return false;
    if (salary.remunerationType === 'hora_aula') return false;
    return teacher.type === 'estagiario' || teacher.type === 'eventual';
  }

  /**
   * Avisos de cadastro de uma linha da folha — o que faz a pessoa receber
   * errado e hoje passava calado.
   *
   * Mora aqui, e não em quem monta a folha, porque o fechamento (Cloud Function)
   * e a prévia (tela) precisam responder igual: foi a divergência entre duas
   * cópias da conta que deixou passar R$ 7.580,84 em agosto/2026.
   *
   * `sem_salario` e `sem_valor_hora` TRAVAM o fechamento; `sem_contrato_horas`
   * e `duas_unidades` são informativos.
   */
  function avisosDaLinha(p) {
    const o = p || {};
    const avisos = [];
    if (!o.temSalario) avisos.push('sem_salario');
    else if (!o.isIntern && !(o.hourlyRate > 0) && o.horas > 0) avisos.push('sem_valor_hora');
    if (o.isIntern && o.semContrato) avisos.push('sem_contrato_horas');
    if (o.qtdUnidades > 1) avisos.push('duas_unidades');
    return avisos;
  }

  /** Aula que não paga: marcada como não remunerada, ou Escola Interna. */
  function contaParaPagamento(c) {
    if (!c) return false;
    if (c.remunerada === false) return false;
    if (c.specialScaleType === 'escola_interna') return false;
    return true;
  }

  /**
   * Minutos que a aula realmente vale, depois das ocorrências.
   *   duração − atraso − saída antecipada + hora extra
   * Falta zera: se não deu a aula, não recebe por ela (decisão do Rodrigo, 07/08).
   */
  function minutosEfetivos(c) {
    if (!c) return 0;
    if (c.faltaTipo) return 0;
    const base = (typeof c.durationMinutes === 'number' && c.durationMinutes > 0) ? c.durationMinutes : 0;
    const n = v => (typeof v === 'number' && v > 0) ? v : 0;
    return Math.max(0, base - n(c.atrasoMinutos) - n(c.saidaAntecipadaMinutos) + n(c.horaExtraMinutos));
  }

  /** Horas de um conjunto de aulas, já com o peso do tipo de escala (P02). */
  function horasDasAulas(classes, scaleTypes) {
    if (!Array.isArray(classes) || classes.length === 0) return 0;
    let minutos = 0;
    for (const c of classes) {
      if (!contaParaPagamento(c)) continue;
      let peso = 1;
      if (c.specialScaleType && tem(scaleTypes, c.specialScaleType)) {
        peso = pega(scaleTypes, c.specialScaleType).weight || 1;
      } else if (c.isHoliday === true) {
        peso = 2;  // fallback retrocompat (P02)
      }
      minutos += minutosEfetivos(c) * peso;
    }
    return minutos / 60;
  }

  /**
   * Valores salariais vigentes numa data: começa nos valores atuais e rebobina
   * as mudanças com effectiveDate depois da data-alvo.
   */
  function salarioVigenteEm(salary, date) {
    if (!salary) return {};
    const r = Object.assign({}, salary);
    if (!Array.isArray(salary.salaryHistory) || salary.salaryHistory.length === 0) return r;
    const ms = e => (e && e.effectiveDate && e.effectiveDate.toMillis) ? e.effectiveDate.toMillis() : 0;
    const alvo = date instanceof Date ? date.getTime() : 0;
    const ordenado = salary.salaryHistory.slice().sort((a, b) => ms(b) - ms(a));
    for (const e of ordenado) if (ms(e) > alvo) r[e.field] = e.previousValue;
    return r;
  }

  /**
   * Quanto uma pessoa recebe pelas horas do mês, mais os benefícios.
   *
   * Estagiário com bolsa: bolsa fixa + proporcional do que passar do contrato.
   * Todo o resto: horas × R$/h.
   *
   * O ajuste fino do estagiário (banco de horas, férias, saldo devedor) é feito
   * depois, em montarFolha — aqui fica só o retrato do cadastro.
   */
  function valorDoProfessor(teacher, salary, hours, ultimoDiaDoMes) {
    const vazio = {
      total: 0, valorHoras: 0, mealAllowance: 0, transportAllowance: 0,
      otherBenefits: [], totalOutros: 0, hourlyRate: 0,
      isInternProportional: false, internStipendUsed: null,
      internExcessHours: null, internExcessValue: null,
      // null e não undefined: o Firestore recusa undefined
      isIntern: false, internLimitHours: null, internPropRate: null,
    };
    if (!salary) return vazio;

    const eff = salarioVigenteEm(salary, ultimoDiaDoMes);
    const hourlyRate = (typeof eff.hourlyRate === 'number' && eff.hourlyRate > 0) ? eff.hourlyRate : 0;
    const meal = (typeof eff.mealAllowance === 'number') ? eff.mealAllowance : 0;
    const transport = (typeof eff.transportAllowance === 'number') ? eff.transportAllowance : 0;
    const otherBenefits = Array.isArray(eff.otherBenefits) ? eff.otherBenefits : [];
    const totalOutros = otherBenefits.reduce((s, b) => s + ((b && typeof b.valor === 'number') ? b.valor : 0), 0);

    let valorHoras = 0, isInternProportional = false;
    let internStipendUsed = null, internExcessHours = null, internExcessValue = null;
    let internLimitHours = null, internPropRate = null;

    const isIntern = ehBolsista(teacher, salary);

    if (isIntern) {
      const limitMinutes = (typeof eff.internMonthlyLimitMinutes === 'number' && eff.internMonthlyLimitMinutes > 0)
        ? eff.internMonthlyLimitMinutes
        : ((typeof eff.internMonthlyLimitHours === 'number') ? eff.internMonthlyLimitHours * 60 : 0);
      internLimitHours = limitMinutes / 60;
      internStipendUsed = (typeof eff.internMonthlyStipend === 'number') ? eff.internMonthlyStipend : 0;
      internPropRate = (typeof eff.internProportionalHourlyRate === 'number') ? eff.internProportionalHourlyRate : 0;

      if (hours <= internLimitHours) {
        valorHoras = internStipendUsed;
      } else {
        internExcessHours = hours - internLimitHours;
        internExcessValue = internExcessHours * internPropRate;
        valorHoras = internStipendUsed + internExcessValue;
        isInternProportional = true;
      }
    } else {
      valorHoras = hours * hourlyRate;
    }

    return {
      total: valorHoras + meal + transport + totalOutros,
      valorHoras, mealAllowance: meal, transportAllowance: transport,
      otherBenefits, totalOutros, hourlyRate,
      isInternProportional, internStipendUsed, internExcessHours, internExcessValue,
      isIntern, internLimitHours, internPropRate,
    };
  }

  const r2 = n => Math.round(n * 100) / 100;

  /**
   * A folha do mês inteiro, uma linha por pessoa.
   *
   * @param {{
   *   classes:  aulas do mês, de TODAS as unidades
   *   teachers: Map|obj teacherId → ficha
   *   salaries: Map|obj teacherId → teacher_salaries
   *   scaleTypes: Map|obj tipo → { weight }
   *   ano, mes, ultimoDiaDoMes
   *   bancos: obj teacherId → { saldo, movimento, diasAfastado } (só estagiário)
   * }} p
   */
  function montarFolha(p) {
    const o = p || {};
    const scaleTypes = o.scaleTypes || new Map();
    const ultimoDiaDoMes = o.ultimoDiaDoMes || new Date(o.ano, o.mes, 0, 23, 59, 59, 999);
    const diasNoMes = new Date(o.ano, o.mes, 0).getDate();
    const bancos = o.bancos || {};

    // 1) só o que paga, e nunca quem dá aula sem receber
    const validas = (o.classes || []).filter(c =>
      c && STATUS_QUE_PAGAM.indexOf(c.status) !== -1 && c.teacherId);

    // 2) agrupa por PESSOA — é aqui que as unidades deixam de se separar
    const porPessoa = new Map();
    for (const c of validas) {
      const ficha = pega(o.teachers, c.teacherId);
      if (ficha && ficha.naoRemunerado === true) continue;
      if (!porPessoa.has(c.teacherId)) porPessoa.set(c.teacherId, []);
      porPessoa.get(c.teacherId).push(c);
    }

    const pessoas = [];
    const unidades = new Set();

    for (const [teacherId, aulas] of porPessoa) {
      const ficha = pega(o.teachers, teacherId) || { id: teacherId, name: '(desconhecido)', type: 'efetivo' };
      const salary = pega(o.salaries, teacherId);
      const horas = horasDasAulas(aulas, scaleTypes);
      const valor = valorDoProfessor(ficha, salary, horas, ultimoDiaDoMes);

      // divisão por unidade: o custo por unidade não pode se perder só porque
      // o pagamento passou a ser um só
      const mapaUn = new Map();
      for (const c of aulas) {
        const u = c.unitId || '(sem unidade)';
        unidades.add(u);
        if (!mapaUn.has(u)) mapaUn.set(u, []);
        mapaUn.get(u).push(c);
      }
      const porUnidade = [...mapaUn.entries()].map(([unitId, cs]) => ({
        unitId,
        unitName: (pega(o.units, unitId) || {}).name || unitId,
        classesCount: cs.length,
        horas: r2(horasDasAulas(cs, scaleTypes)),
      })).sort((a, b) => b.horas - a.horas);

      const linha = {
        teacherId,
        teacherName: ficha.name || '(desconhecido)',
        teacherType: ficha.type || 'efetivo',
        classesCount: aulas.length,
        totalHoras: horas,
        hourlyRate: valor.hourlyRate || 0,
        valorHoras: valor.valorHoras,
        mealAllowance: valor.mealAllowance,
        transportAllowance: valor.transportAllowance,
        otherBenefits: valor.otherBenefits,
        totalOutros: valor.totalOutros,
        valorTotal: valor.total,
        isInternProportional: valor.isInternProportional,
        internStipendUsed: valor.internStipendUsed,
        internExcessHours: valor.internExcessHours,
        internExcessValue: valor.internExcessValue,
        isIntern: valor.isIntern === true,
        internLimitHours: valor.internLimitHours,
        internPropRate: valor.internPropRate,
        porUnidade,
        avisos: [],
      };

      // 3) estagiário: banco de horas sobre o mês INTEIRO
      if (linha.isIntern) {
        const b = bancos[teacherId] || {};
        const conta = InternHourBank.calcularMesEstagiario({
          horas,
          limiteHoras: linha.internLimitHours,
          stipend: linha.internStipendUsed || 0,
          propRate: linha.internPropRate,
          diasNoMes,
          diasAfastado: b.diasAfastado || 0,
          movimento: b.movimento || null,
          saldoAtual: b.saldo || 0,
        });
        linha.valorHoras = conta.valorHoras;
        linha.valorTotal = r2(conta.valorHoras + linha.mealAllowance
          + linha.transportAllowance + linha.totalOutros);
        linha.isInternProportional = conta.valorExtra > 0;
        linha.internExcessHours = conta.horasPagasAgora;
        linha.internExcessValue = conta.valorExtra;
        linha.internContratoMes = conta.contratoMes;
        linha.internHorasNoMes = conta.horasTrabalhadas;
        linha.internSaldoAnterior = conta.saldoAnterior;
        linha.internHorasQuitadas = conta.horasQuitadas;
        linha.internSaldoFinal = conta.saldoFinal;
        linha.internSemContrato = conta.semContrato;
        linha.internExplicacao = conta.explicacao;
      }

      // 4) avisos: erro de cadastro que hoje passa calado e paga a menos
      linha.avisos = avisosDaLinha({
        temSalario: !!salary, isIntern: linha.isIntern, hourlyRate: linha.hourlyRate,
        horas, semContrato: linha.internSemContrato === true, qtdUnidades: porUnidade.length,
      });

      pessoas.push(linha);
    }

    pessoas.sort((a, b) => String(a.teacherName).localeCompare(String(b.teacherName), 'pt-BR'));

    return {
      pessoas,
      totais: {
        classesRealizadas: pessoas.reduce((s, t) => s + t.classesCount, 0),
        totalHoras: r2(pessoas.reduce((s, t) => s + t.totalHoras, 0)),
        totalValor: r2(pessoas.reduce((s, t) => s + t.valorTotal, 0)),
        unitIds: [...unidades].sort(),
      },
    };
  }

  return {
    STATUS_QUE_PAGAM,
    contaParaPagamento, minutosEfetivos, horasDasAulas, ehBolsista, avisosDaLinha,
    salarioVigenteEm, valorDoProfessor, montarFolha,
  };
});
