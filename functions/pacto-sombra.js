'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Modo sombra — a busca de um dia (e de vários) na API da Pacto
// ═══════════════════════════════════════════════════════════════════════
//
// Desenho: docs/superpowers/specs/2026-09-13-pacto-api-modo-sombra-design.md
//
// Grava em `pacto_sombra_dias/{CP|PP}_{AAAA-MM-DD}` e mantém o caderninho
// `pacto_contratos/{CP|PP}_{codigo}` (+ `pacto_consultoras`, a consultora do dia
// em que o contrato foi lançado). Nada aqui toca em `periodos`, comissão
// ou folha: o arquivo exportado continua sendo o oficial.
//
// Regras que o desenho fixou e os testes guardam:
//  • dia que falhou nunca vira dia sem venda (`situacao` sempre gravada);
//  • rebuscar SUBSTITUI o dia, nunca soma;
//  • `credencial_recusada` e `limite` param a busca inteira na hora;
//  • o dia corrente nunca é buscado;
//  • o caderninho evita perguntar à Pacto de novo pelo mesmo contrato.

const L = require('./pacto-api-linhas.js');

const PACTO_UNIDADES = {
  CP: 'c7b092b1fe873e29436873a01cdfe829',
  PP: '9d4721a873dd9fe621aeed5093b791f8',
};
const COL_DIAS = 'pacto_sombra_dias';
const COL_CONTRATOS = 'pacto_contratos';
const COL_CONSULTORAS = 'pacto_consultoras';
const COL_TERMOMETRO = 'pacto_termometro';
const MAX_DIAS = 62;
const PARA_TUDO = ['credencial_recusada', 'limite'];

function somarDias(dia, n) {
  const d = new Date(dia + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Dias a buscar, em ordem. Nunca inclui `hoje` nem dia futuro.
 * `{hoje, ultimos}` → os N dias anteriores; `{hoje, de, ate}` → intervalo cortado em ontem.
 */
function diasParaBuscar({ hoje, de, ate, ultimos }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(hoje))) throw new Error('diasParaBuscar: hoje inválido');
  const ontem = somarDias(hoje, -1);
  let ini, fim;
  if (ultimos) {
    ini = somarDias(hoje, -Number(ultimos));
    fim = ontem;
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(de))) throw new Error('diasParaBuscar: "de" inválido');
    ini = de;
    fim = ate && ate < ontem ? ate : ontem;
  }
  const dias = [];
  for (let d = ini; d <= fim; d = somarDias(d, 1)) {
    dias.push(d);
    if (dias.length > MAX_DIAS) throw new Error('diasParaBuscar: no máximo ' + MAX_DIAS + ' dias por vez');
  }
  return dias;
}

/**
 * Dias que a busca das 4h relê: do dia 1º do mês até ontem; até o dia 10, do
 * dia 1º do mês ANTERIOR. A Pacto lança a cobrança recorrente dias depois, com
 * a data antiga — relendo só os 3 dias anteriores, o CP perdeu 17 pagamentos
 * (R$ 4.284,00) em set/2026. Pior caso: 31 + 9 = 40 dias, dentro de MAX_DIAS.
 */
function diasDaRotina(hoje) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(hoje))) throw new Error('diasDaRotina: hoje inválido');
  let ini = hoje.slice(0, 8) + '01';
  if (Number(hoje.slice(8)) <= 10) ini = somarDias(ini, -1).slice(0, 8) + '01';
  return diasParaBuscar({ hoje, de: ini });
}

async function gravarDia(db, unidade, dia, doc) {
  // `set` sem merge: o dia rebuscado substitui o anterior inteiro
  await db.collection(COL_DIAS).doc(unidade + '_' + dia).set({ unidade, dia, ...doc });
}

/**
 * Busca um dia de uma unidade e grava.
 * @returns {{situacao, consultas}}
 */
async function buscarDia({ db, cliente, unidade, dia, agora }) {
  const chave = PACTO_UNIDADES[unidade];
  if (!chave) throw new Error('buscarDia: unidade desconhecida ' + unidade);
  const quando = agora ? agora() : new Date().toISOString();

  const r = await cliente.resumoDoDia(chave, dia);
  if (r.situacao !== 'ok') {
    await gravarDia(db, unidade, dia, { situacao: r.situacao, motivo: r.motivo || '', buscadoEm: quando });
    return { situacao: r.situacao, consultas: 0 };
  }
  const resumo = r.dados || {};
  const lancados = L.lancadosDoDia(resumo);

  // A consultora (e quem lançou o contrato) só vem na lista de LANÇADOS do dia
  // em que o contrato nasce, e o pagamento costuma cair em outro dia. Guarda
  // todos os do dia (número, consultora, quem lançou e dia — nada do aluno)
  // para o pagamento que vier depois. Set/2026 no PP: 25 de 52 ativações
  // ficavam sem consultora sem isto.
  if (unidade !== 'CP') {
    for (const [codigo, x] of lancados) {
      await db.collection(COL_CONSULTORAS).doc(unidade + '_' + codigo).set({ codigo, unidade, ...x, dia });
    }
  }
  const nada = { consultor: null, lancou: null };
  const doLancamento = async codigo => {
    if (unidade === 'CP') return nada;
    if (lancados.has(codigo)) return lancados.get(codigo);
    const s = await db.collection(COL_CONSULTORAS).doc(unidade + '_' + codigo).get();
    return s.exists ? { consultor: s.data().consultor || null, lancou: s.data().lancou || null } : nada;
  };

  // Contratos das parcelas pagas: o que o caderninho já tem e o que falta
  const alunoDoContrato = new Map();
  (resumo.pagamentos || []).forEach(p => (p.parcelasPagas || []).forEach(x => {
    if (x.codigoContrato) alunoDoContrato.set(String(x.codigoContrato), p.aluno && p.aluno.codigo);
  }));

  const contratos = new Map();
  const faltam = new Map();          // aluno → [contratos]
  for (const [codigo, aluno] of alunoDoContrato) {
    const snap = await db.collection(COL_CONTRATOS).doc(unidade + '_' + codigo).get();
    if (snap.exists) {
      let c = snap.data();
      if (!c.consultor || !c.lancou) {                 // consultora apareceu depois
        const g = await doLancamento(codigo);
        const novo = { ...c, consultor: c.consultor || g.consultor, lancou: c.lancou || g.lancou || null };
        if (novo.consultor !== c.consultor || novo.lancou !== (c.lancou || null)) {
          c = novo;
          await db.collection(COL_CONTRATOS).doc(unidade + '_' + codigo).set(c);
        }
      }
      contratos.set(codigo, c);
    } else if (aluno != null) {
      if (!faltam.has(aluno)) faltam.set(aluno, []);
      faltam.get(aluno).push(codigo);
    }
  }

  let consultas = 0;
  for (const aluno of faltam.keys()) {                  // uma consulta por cliente
    const rc = await cliente.contratosDoCliente(chave, aluno);
    consultas++;
    if (PARA_TUDO.includes(rc.situacao)) {
      await gravarDia(db, unidade, dia, { situacao: rc.situacao, motivo: rc.motivo || '', buscadoEm: quando });
      return { situacao: rc.situacao, consultas };
    }
    if (rc.situacao !== 'ok') continue;                 // o contrato fica sem dados → aviso no conversor
    for (const bruto of rc.dados) {
      if (bruto == null || bruto.codigo == null) continue;
      const codigo = String(bruto.codigo);
      const g = await doLancamento(codigo);
      const limpo = { ...L.limparContrato(bruto, unidade, g.consultor, g.lancou), atualizadoEm: quando };
      await db.collection(COL_CONTRATOS).doc(unidade + '_' + codigo).set(limpo);
      contratos.set(codigo, limpo);
    }
  }

  const m = L.montar({ resumo, contratos, unidade, dia });
  const situacao = L.situacaoDoDia({ resumo, avisos: m.avisos });
  await gravarDia(db, unidade, dia, {
    situacao,
    motivo: '',
    linhas: JSON.stringify(m.linhas),          // Firestore não aceita array de arrays
    foraDeProposito: m.foraDeProposito,
    avisos: m.avisos,
    totais: m.totais,
    contratosConsultados: consultas,
    buscadoEm: quando,
  });
  return { situacao, consultas };
}

/**
 * Termômetro do mês: grava `pacto_termometro/{CP|PP}_{AAAA-MM}` só com totais
 * da unidade (lido pela supervisão — nenhum nome). Mesma configuração que o
 * `index.html` soma: padrão do motor + `units/{id}.config` + `metasMensais` do
 * período do mês; e os contratos comissionados nos meses ANTERIORES (o recorte
 * é o mesmo do upload: os códigos do próprio mês não barram as próprias linhas).
 * Desenho: docs/superpowers/specs/2026-09-22-termometro-do-mes-design.md
 */
async function atualizarTermometro({ db, unidades = ['CP', 'PP'], meses, hoje, agora }) {
  const PA = require('./pacto-adapter.js');
  const CE = require('./commission.js');
  const T = require('./pacto-termometro.js');
  const quando = agora ? agora() : new Date().toISOString();
  const units = (await db.collection('units').get()).docs;
  const feitos = [];
  for (const unidade of unidades) {
    const u = units.find(d => PA.siglaDaUnidade(d.id, [unidade]) === unidade);
    const unitId = u ? u.id : null;
    const unitConfig = (u && u.data().config) || {};
    const periodos = unitId ? (await db.collection('periodos').where('unitId', '==', unitId).get()).docs : [];
    const docs = (await db.collection(COL_DIAS).where('unidade', '==', unidade).get()).docs.map(d => d.data());
    for (const mes of meses) {
      const codigosPagos = [];
      let metasMensais = null;
      periodos.forEach(p => {
        const m = String(p.id).match(/(\d{4}-\d{2})$/);
        if (!m) return;
        if (m[1] < mes) (p.data().codigosPagos || []).forEach(c => codigosPagos.push(c));
        if (p.id === unitId + '_' + mes) metasMensais = p.data().metasMensais || null;
      });
      const metaDoMes = !!(metasMensais && Object.keys(metasMensais).length);
      const r = T.calcularMes({
        docs, mes, unidade, hoje, codigosPagos,
        config: { ...unitConfig, ...(metasMensais || {}) }, metaDoMes,
        Adapter: PA, Engine: CE, ApiLinhas: L,
      });
      const id = unidade + '_' + mes;
      await db.collection(COL_TERMOMETRO).doc(id).set({ ...r, unitId, hoje, atualizadoEm: quando });
      feitos.push({ id });
    }
  }
  return feitos;
}

/** Percorre dias × unidades; para tudo na primeira credencial recusada ou limite. */
async function buscar({ db, cliente, unidades = ['CP', 'PP'], dias, agora }) {
  const resultados = [];
  for (const dia of dias) {
    for (const unidade of unidades) {
      const r = await buscarDia({ db, cliente, unidade, dia, agora });
      resultados.push({ unidade, dia, situacao: r.situacao });
      if (PARA_TUDO.includes(r.situacao)) return { resultados, parouPor: r.situacao };
    }
  }
  return { resultados };
}

module.exports = { PACTO_UNIDADES, COL_DIAS, COL_CONTRATOS, COL_CONSULTORAS, COL_TERMOMETRO, MAX_DIAS, diasParaBuscar, diasDaRotina, buscarDia, buscar, somarDias, atualizarTermometro };
