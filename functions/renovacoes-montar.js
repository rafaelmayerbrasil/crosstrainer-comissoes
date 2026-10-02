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
//  • grava SÓ em renovacoes_lista, renovacoes_leituras e no caderninho — o que a
//    consultora preenche mora em renovacoes_acompanhamento e esta Function só LÊ de lá;
//  • falha nunca apaga a lista boa (guarda `ultimaFalha`);
//  • resposta vazia com "sucesso" quando antes havia contratos é falha;
//  • credencial recusada ou limite param a unidade na hora.
//
// 01/10/2026 — O CONTRATO E O VÍNCULO SÃO RELIDOS A CADA MONTAGEM. O Rodrigo
// conferiu outubro contra a Pacto: o caderninho guardava o contrato para sempre
// (vencimento de 14/10 que a Pacto já tinha mudado para 13/11) e o vínculo do
// aluno era o da primeira leitura, ou nem tinha sido lido (25 linhas com a
// consultora errada). Agora cada contrato da Previsão é perguntado ao gateway da
// unidade (`clienteContratos`), e o aluno de cada linha que fica na lista também.
// A última leitura boa fica em `renovacoes_leituras` — é a reserva da noite em
// que a Pacto falhar; o caderninho das comissões não é tocado por esta leitura.

const RL = require('./renovacoes-lista.js');
const L = require('./pacto-api-linhas.js');
const PA = require('./pacto-adapter.js');
const { PACTO_UNIDADES, COL_CONTRATOS, COL_CONSULTORAS } = require('./pacto-sombra.js');

const COL_LISTA = 'renovacoes_lista';
const COL_ACOMP = 'renovacoes_acompanhamento';
const COL_LEITURAS = 'renovacoes_leituras';
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

/** O contrato fica na lista (e por isso vale perguntar pela consultora do aluno)? */
function ficaNaLista(nomePlano, planoOriginal) {
  let cls = RL.classificarPlano(nomePlano);
  if (cls.tipo === 'importacao' && planoOriginal) cls = RL.classificarPlano(planoOriginal);
  return cls.tipo !== 'excluir';
}

/**
 * Cada contrato da Previsão, lido AGORA no gateway da unidade: plano, vencimento
 * já com atestado/trancamento, plano original da importação, renovação lançada e
 * o vínculo de consultora do aluno.
 *
 * Reserva, nesta ordem, para o contrato que a Pacto não devolver hoje: a última
 * leitura boa (`renovacoes_leituras`) e, quem nunca foi lido, o caminho antigo
 * (caderninho → núcleo), que fica com quem chama. Credencial recusada ou limite
 * param as consultas ao gateway, mas NÃO derrubam a lista: o resto sai da reserva
 * e a lista diz quantos contratos ficaram sem releitura.
 *
 * `memo` (opcional): do dia 25 em diante a lista do mês seguinte repete os
 * contratos da antecipação — não se pergunta duas vezes na mesma rodada.
 *
 * SEGUNDA TENTATIVA: o gateway às vezes devolve o contrato VAZIO e sem erro por
 * alguns minutos (ensaio de 01/10/2026 no Campeche: 35 de 91 vazios; minutos
 * depois, os mesmos 20 conferidos responderam). A Previsão diz que o contrato
 * existe, então vazio é falha: quem não veio na primeira passada é perguntado de
 * novo no fim, depois de uma pausa.
 * @returns {{mapa, semLeitura: Array, relidos, daReserva, parouPor, consultas, segundaTentativa}}
 */
async function lerDaPacto({ db, gw, unidade, brutos, hoje, memo, pausaRepescagemMs = 5000, dormir }) {
  const esperar = dormir || (ms => new Promise(r => setTimeout(r, ms)));
  const mapa = {};
  const semLeitura = [];
  const visto = new Set();
  let relidos = 0, daReserva = 0, consultas = 0, parouPor = null;

  /** Uma leitura do contrato (e do vínculo, se ele fica na lista). `null` = a Pacto não devolveu. */
  async function ler(codigo, reserva) {
    if (parouPor) return null;
    const r = await gw.contrato(codigo);
    consultas++;
    if (PARA_TUDO.includes(r.situacao)) { parouPor = r.situacao; return null; }
    if (r.situacao !== 'ok' || !r.dados) return null;
    const d = r.dados;
    const lido = {
      codigo, unidade, nomePlano: d.plano || '', vigenciaDe: d.vigenciaDe || '', vigenciaAte: d.vigenciaAte || '',
      planoOriginal: d.planoOriginal || '', recorrencia: !!d.recorrencia,
      renovadoEm: d.renovadoEm || '', contratoNovo: d.contratoNovo || null,
      consultor: d.consultor || null, lancou: d.lancou || null,
      alunoConsultado: false, consultorAluno: null, consultoresAluno: [], vinculoLidoEm: null, lidoEm: hoje,
    };
    const pessoa = d.cliente && d.cliente.codigo;
    if (!pessoa || !ficaNaLista(lido.nomePlano, lido.planoOriginal)) return lido;
    const a = await gw.consultorDoAluno(pessoa);
    consultas += 2;
    if (PARA_TUDO.includes(a.situacao)) parouPor = a.situacao;
    if (a.situacao === 'ok') {
      const cos = (a.dados.consultores || (a.dados.consultor ? [a.dados.consultor] : [])).slice();
      Object.assign(lido, { alunoConsultado: true, consultorAluno: cos[0] || null, consultoresAluno: cos, vinculoLidoEm: hoje });
    } else if (reserva && reserva.alunoConsultado) {
      // o vínculo não veio hoje: vale o da última leitura boa
      Object.assign(lido, { alunoConsultado: true, consultorAluno: reserva.consultorAluno || null,
        consultoresAluno: reserva.consultoresAluno || [], vinculoLidoEm: reserva.vinculoLidoEm || null });
    } else {
      // nunca lido por aqui: o que a busca das comissões já souber do aluno
      const cad = await db.collection(COL_CONTRATOS).doc(unidade + '_' + codigo).get();
      if (cad.exists && cad.data().alunoConsultado) {
        const v = cad.data().consultorAluno || null;
        Object.assign(lido, { alunoConsultado: true, consultorAluno: v, consultoresAluno: v ? [v] : [] });
      }
    }
    return lido;
  }
  async function guardar(p, lido) {
    await p.ref.set(lido);
    mapa[p.codigo] = lido; relidos++;
    if (memo) memo.set(p.codigo, lido);
  }

  const pendentes = [];
  for (const b of brutos) {
    const codigo = String(b.codigoContrato);
    if (visto.has(codigo)) continue;
    visto.add(codigo);
    if (memo && memo.has(codigo)) { mapa[codigo] = memo.get(codigo); relidos++; continue; }
    const ref = db.collection(COL_LEITURAS).doc(unidade + '_' + codigo);
    const antes = await ref.get();
    const p = { b, codigo, ref, reserva: antes.exists ? antes.data() : null };
    const lido = await ler(codigo, p.reserva);
    if (lido) await guardar(p, lido); else pendentes.push(p);
  }

  const segundaTentativa = { tentados: 0, vieram: 0 };
  if (pendentes.length && !parouPor) await esperar(pausaRepescagemMs);
  for (const p of pendentes) {
    let lido = null;
    if (!parouPor) { segundaTentativa.tentados++; lido = await ler(p.codigo, p.reserva); }
    if (lido) { segundaTentativa.vieram++; await guardar(p, lido); }
    else if (p.reserva) { mapa[p.codigo] = p.reserva; daReserva++; }
    else semLeitura.push(p.b);
  }
  return { mapa, semLeitura, relidos, daReserva, parouPor, consultas, segundaTentativa };
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

/**
 * `clienteContratos` (opcional): o gateway da unidade para o contrato e o vínculo
 * (pacto-gateway-cliente.js). Sem ele vale só o caminho antigo, do caderninho.
 */
async function montarUnidadeMes({ db, clienteGw, clienteNucleo, clienteContratos, unidade, mes, hoje, agora, memo, dormir }) {
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

  // 1º o gateway (dado de hoje); o que ele não devolver e nunca tiver sido lido vai pelo caminho antigo
  let leitura = null;
  let paraOCaderninho = brutos;
  if (clienteContratos) {
    const p = await lerDaPacto({ db, gw: clienteContratos, unidade, brutos, hoje, memo, dormir });
    paraOCaderninho = p.semLeitura;
    const total = new Set(brutos.map(b => String(b.codigoContrato))).size;
    leitura = { total, relidos: p.relidos, daReserva: p.daReserva, semLeitura: p.semLeitura.length,
      motivo: p.parouPor || (p.relidos < total ? 'a Pacto não devolveu parte dos contratos' : ''), consultasGateway: p.consultas,
      segundaTentativa: p.segundaTentativa, mapa: p.mapa };
  }
  const c = await completarContratos({ db, clienteNucleo, unidade, brutos: paraOCaderninho });
  if (c.parouPor) { await gravarFalha(db, id, base, c.parouPor, 'ao completar os contratos no núcleo', quando); return { id, situacao: c.parouPor }; }
  if (leitura) { Object.assign(c.mapa, leitura.mapa); delete leitura.mapa; }

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
    ...base, ...lista, metas, unitId, situacao: 'ok', motivo: '', hoje, contratosConsultados: c.consultas, leitura, atualizadoEm: quando,
  });
  return { id, situacao: 'ok', consultas: c.consultas, leitura };
}

/**
 * As duas unidades, nos meses que a lista mantém (o corrente; do dia 25, também o seguinte).
 * `clientesContratos` ({CP, PP}, opcional): o gateway de cada unidade para reler contrato e vínculo.
 */
async function montarTudo({ db, clientesGw, clienteNucleo, clientesContratos, unidades = ['CP', 'PP'], hoje, agora, dormir }) {
  const resultados = [];
  for (const unidade of unidades) {
    const memo = new Map();
    for (const mes of RL.mesesParaManter(hoje)) {
      const r = await montarUnidadeMes({ db, clienteGw: clientesGw[unidade], clienteNucleo,
        clienteContratos: clientesContratos && clientesContratos[unidade], unidade, mes, hoje, agora, memo, dormir });
      resultados.push(r);
      if (PARA_TUDO.includes(r.situacao)) break;     // esta unidade para; a outra segue
    }
  }
  return resultados;
}

module.exports = { COL_LISTA, COL_ACOMP, COL_LEITURAS, montarUnidadeMes, montarTudo, carregarHistorico, completarContratos, lerDaPacto, ficaNaLista, unidadeDoBanco };
