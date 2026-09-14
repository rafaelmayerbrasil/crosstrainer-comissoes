'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Modo sombra — a busca de um dia (e de vários) na API da Pacto
// ═══════════════════════════════════════════════════════════════════════
//
// Desenho: docs/superpowers/specs/2026-09-13-pacto-api-modo-sombra-design.md
//
// Grava em `pacto_sombra_dias/{CP|PP}_{AAAA-MM-DD}` e mantém o caderninho
// `pacto_contratos/{CP|PP}_{codigo}`. Nada aqui toca em `periodos`, comissão
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
  const lancados = L.consultoresLancados(resumo);

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
      const doLancado = unidade !== 'CP' ? lancados.get(codigo) : null;
      if (doLancado && !c.consultor) {                 // consultora apareceu depois
        c = { ...c, consultor: doLancado };
        await db.collection(COL_CONTRATOS).doc(unidade + '_' + codigo).set(c);
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
      const consultor = unidade !== 'CP' ? (lancados.get(codigo) || null) : null;
      const limpo = { ...L.limparContrato(bruto, unidade, consultor), atualizadoEm: quando };
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

module.exports = { PACTO_UNIDADES, COL_DIAS, COL_CONTRATOS, MAX_DIAS, diasParaBuscar, buscarDia, buscar, somarDias };
