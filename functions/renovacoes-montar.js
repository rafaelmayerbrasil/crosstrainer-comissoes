'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Lista de renovações — a montagem diária (Cloud Function)
// ═══════════════════════════════════════════════════════════════════════
//
// Desenho: docs/superpowers/specs/2026-09-29-renovacoes-metas-bonus-design.md §3
//
// Previsão de Renovação (gateway, credencial da unidade) → contratos completos
// pelo núcleo (caderninho `pacto_contratos`, o mesmo da busca diária) →
// histórico de `periodos` → renovacoes-lista.js → `renovacoes_lista/{UN}_{mês}`.
//
// Regras que os testes guardam:
//  • grava SÓ em renovacoes_lista e no caderninho — o que a consultora preenche
//    mora em renovacoes_acompanhamento e esta Function só LÊ de lá;
//  • falha nunca apaga a lista boa (guarda `ultimaFalha`);
//  • resposta vazia com "sucesso" quando antes havia contratos é falha;
//  • credencial recusada ou limite param a unidade na hora.

const RL = require('./renovacoes-lista.js');
const L = require('./pacto-api-linhas.js');
const PA = require('./pacto-adapter.js');
const { PACTO_UNIDADES, COL_CONTRATOS, COL_CONSULTORAS } = require('./pacto-sombra.js');

const COL_LISTA = 'renovacoes_lista';
const COL_ACOMP = 'renovacoes_acompanhamento';
const PARA_TUDO = ['credencial_recusada', 'limite'];

/** 'CP' → id da unidade neste ambiente (`cp` em produção, `unit-cp` no staging) */
async function unidadeDoBanco(db, unidade) {
  const units = (await db.collection('units').get()).docs;
  const u = units.find(d => PA.siglaDaUnidade(d.id, [unidade]) === unidade);
  return u ? u.id : null;
}

/** Itens processados de todos os períodos da unidade, só com os campos que a lista usa. */
async function carregarHistorico(db, unitId) {
  if (!unitId) return [];
  const periodos = (await db.collection('periodos').where('unitId', '==', unitId).get()).docs;
  const out = [];
  for (const p of periodos) {
    const itens = (await db.collection('periodos').doc(p.id).collection('itens').where('type', '==', 'processed').get()).docs;
    itens.forEach(d => {
      const x = d.data();
      out.push({
        cliente: x.cliente || '', item: x.item || '', data: x.data || '', vendedor: x.vendedor || '', codigo: x.codigo || '',
        isContract: !!x.isContract, isDegustacao: !!x.isDegustacao, planStartDate: x.planStartDate || '', planEndDate: x.planEndDate || '',
      });
    });
  }
  return out;
}

/** Plano e vigência de cada contrato: do caderninho, ou uma consulta por cliente ao núcleo. */
async function completarContratos({ db, clienteNucleo, unidade, brutos }) {
  const chave = PACTO_UNIDADES[unidade];
  const mapa = {};
  const faltam = new Map();
  for (const b of brutos) {
    if (mapa[b.codigoContrato]) continue;
    const s = await db.collection(COL_CONTRATOS).doc(unidade + '_' + b.codigoContrato).get();
    if (s.exists) mapa[b.codigoContrato] = s.data();
    else if (b.codigoCliente) {
      if (!faltam.has(b.codigoCliente)) faltam.set(b.codigoCliente, []);
      faltam.get(b.codigoCliente).push(b.codigoContrato);
    }
  }
  let consultas = 0;
  for (const cliente of faltam.keys()) {
    const r = await clienteNucleo.contratosDoCliente(chave, cliente);
    consultas++;
    if (PARA_TUDO.includes(r.situacao)) return { mapa, consultas, parouPor: r.situacao };
    if (r.situacao !== 'ok') continue;               // o contrato fica sem dados → Bloco 4
    for (const bruto of r.dados || []) {
      if (!bruto || bruto.codigo == null) continue;
      const codigo = String(bruto.codigo);
      let consultor = null, lancou = null;
      const g = await db.collection(COL_CONSULTORAS).doc(unidade + '_' + codigo).get();
      if (g.exists) { consultor = g.data().consultor || null; lancou = g.data().lancou || null; }
      const limpo = L.limparContrato(bruto, unidade, consultor, lancou);
      // merge e sem campos vazios: o núcleo regrava TODOS os contratos do aluno, e
      // não pode apagar a consultora que a busca diária trouxe do gateway (30/09/2026)
      const ref = db.collection(COL_CONTRATOS).doc(unidade + '_' + codigo);
      await ref.set(L.soPreenchidos(limpo), { merge: true });
      mapa[codigo] = (await ref.get()).data();
    }
  }
  return { mapa, consultas };
}

/** Falha NÃO apaga a lista boa: ela fica e ganha `ultimaFalha`. */
async function gravarFalha(db, id, base, situacao, motivo, quando) {
  const ref = db.collection(COL_LISTA).doc(id);
  const atual = await ref.get();
  if (atual.exists && atual.data().situacao === 'ok') {
    await ref.set({ ultimaFalha: { situacao, motivo: motivo || '', em: quando } }, { merge: true });
    return;
  }
  await ref.set({ ...base, situacao, motivo: motivo || '', atualizadoEm: quando });
}

async function montarUnidadeMes({ db, clienteGw, clienteNucleo, unidade, mes, hoje, agora }) {
  const quando = agora ? agora() : new Date().toISOString();
  const id = unidade + '_' + mes;
  const base = { unidade, mes };
  const per = RL.periodos(mes);

  const r1 = await clienteGw.previsao(per.mes.de, per.mes.ate);
  if (r1.situacao !== 'ok') { await gravarFalha(db, id, base, r1.situacao, r1.motivo, quando); return { id, situacao: r1.situacao }; }
  const r2 = await clienteGw.previsao(per.antecipacao.de, per.antecipacao.ate);
  if (r2.situacao !== 'ok') { await gravarFalha(db, id, base, r2.situacao, r2.motivo, quando); return { id, situacao: r2.situacao }; }

  const anteriorSnap = await db.collection(COL_LISTA).doc(id).get();
  const anterior = anteriorSnap.exists ? anteriorSnap.data() : null;
  const brutos = [...r1.dados.contratos, ...r2.dados.contratos];
  const antesHavia = !!(anterior && anterior.conferencia && anterior.conferencia.totalPacto > 0);
  if (!brutos.length && antesHavia) {
    await gravarFalha(db, id, base, 'vazio_suspeito', 'a Pacto respondeu sem nenhum contrato, e antes havia', quando);
    return { id, situacao: 'vazio_suspeito' };
  }

  const c = await completarContratos({ db, clienteNucleo, unidade, brutos });
  if (c.parouPor) { await gravarFalha(db, id, base, c.parouPor, 'ao completar os contratos no núcleo', quando); return { id, situacao: c.parouPor }; }

  const unitId = await unidadeDoBanco(db, unidade);
  const historico = await carregarHistorico(db, unitId);
  const gestao = {};
  (await db.collection(COL_ACOMP).where('unidade', '==', unidade).get()).docs.forEach(d => {
    const x = d.data();
    gestao[String(x.codigoContrato)] = { blocoGestao: x.blocoGestao || null, consultoraAtribuida: x.consultoraAtribuida || null };
  });
  const desdeAnterior = {};
  if (anterior && anterior.blocos) {
    Object.values(anterior.blocos).forEach(ls => (ls || []).forEach(l => { if (l.desde) desdeAnterior[l.codigoContrato] = l.desde; }));
  }
  let metas = null;
  if (unitId) {
    const p = await db.collection('periodos').doc(unitId + '_' + mes).get();
    const m = p.exists ? p.data().metasMensais : null;
    metas = m && Object.keys(m).length ? m : null;
  }

  const lista = RL.montar({ mes, hoje, previsao: { mes: r1.dados, antecipacao: r2.dados }, contratos: c.mapa, historico, gestao, desdeAnterior });
  // `set` sem merge: a lista do dia substitui a anterior inteira (e some a ultimaFalha)
  await db.collection(COL_LISTA).doc(id).set({
    ...base, ...lista, metas, unitId, situacao: 'ok', motivo: '', hoje, contratosConsultados: c.consultas, atualizadoEm: quando,
  });
  return { id, situacao: 'ok', consultas: c.consultas };
}

/** As duas unidades, nos meses que a lista mantém (o corrente; do dia 25, também o seguinte). */
async function montarTudo({ db, clientesGw, clienteNucleo, unidades = ['CP', 'PP'], hoje, agora }) {
  const resultados = [];
  for (const unidade of unidades) {
    for (const mes of RL.mesesParaManter(hoje)) {
      const r = await montarUnidadeMes({ db, clienteGw: clientesGw[unidade], clienteNucleo, unidade, mes, hoje, agora });
      resultados.push(r);
      if (PARA_TUDO.includes(r.situacao)) break;     // esta unidade para; a outra segue
    }
  }
  return resultados;
}

module.exports = { COL_LISTA, COL_ACOMP, montarUnidadeMes, montarTudo, carregarHistorico, completarContratos, unidadeDoBanco };
