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
//  • falha não apaga o dia que já tinha resposta boa (guarda `ultimaFalha`);
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
const COL_TERMOMETRO_EQUIPE = 'pacto_termometro_equipe';
const COL_SEQ = 'pacto_contratos_seq';
const COL_DEGUSTACOES = 'pacto_degustacoes';
const MAX_DIAS = 62;
const PARA_TUDO = ['credencial_recusada', 'limite'];
// Varredura dos números de contrato (30/09/2026): o maior buraco medido na
// numeração foi de 18 números (PP, set/2026). Sem marca, volta ~1 mês.
const FOLGA_VARREDURA = 30;
const JANELA_INICIAL = 150;
// Consultas ao gateway por busca (1,25 s cada ≈ 15 min): a primeira carga é grande
// e a função da madrugada tem 30 min. O que faltar completa na busca seguinte.
const LIMITE_GW_POR_BUSCA = 700;

/** Ano corrente em São Paulo — o relatório de vendas do gateway não aceita ano */
function anoSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(new Date());
}

function hojeSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

// ─── Reler o vínculo do aluno (01/10/2026) ───
// A consultora que paga a comissão é a VINCULADA AO ALUNO, e ela era lida uma vez
// só. A gestão troca vínculo depois do lançamento (CP 7269 e 7196: lidos como
// "Rodrigo" em 30/09, no dia seguinte já eram Erica e Francini) — e o arquivo
// exportado no fechamento mostraria o vínculo NOVO. Então o vínculo dos contratos
// que pagam comissão no mês é relido de tempos em tempos, até o mês fechar.
const INICIO_RELEITURA = '2026-10';     // o 1º mês calculado pela API; antes, vale a planilha
const DIAS_RELER_VINCULO = 3;           // relê quem foi lido há 3 dias ou mais
const JANELA_CONTRATO_NOVO = 45;        // contrato que começa até 45 dias antes do pagamento (ou depois dele)
const RESERVA_RELEITURA = 150;          // consultas da noite que a releitura nunca toma do resto da busca

/** 'DD/MM/AAAA' → 'AAAA-MM-DD' ('' se não for data) */
function isoDeBR(br) {
  const m = String(br || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

/**
 * O vínculo deste contrato precisa ser relido? Só o de contrato NOVO em relação ao
 * dia do pagamento — parcela de contrato antigo não paga comissão (uma vez por contrato).
 */
function precisaRelerVinculo(c, dia, hoje) {
  if (!c || !c.pessoa || !c.alunoConsultado) return false;
  if (String(dia).slice(0, 7) < INICIO_RELEITURA) return false;
  const inicio = isoDeBR(c.vigenciaDe);
  if (!inicio || inicio < somarDias(dia, -JANELA_CONTRATO_NOVO)) return false;
  return !c.vinculoDia || c.vinculoDia <= somarDias(hoje, -DIAS_RELER_VINCULO);
}

// De quando vale a regra "mensalidade seguinte do mesmo plano recorrente não é venda"
const INICIO_ANTERIOR = '2026-09';

/**
 * Este contrato já foi lido no gateway, mas antes de o caderninho guardar de que contrato
 * ele veio (`anterior` ausente; `null` já é resposta)? Só interessa a renovação de plano
 * recorrente paga de set/2026 em diante.
 */
function precisaDoAnterior(c, dia) {
  if (!c || !c.gw || c.anterior !== undefined) return false;
  if (String(dia).slice(0, 7) < INICIO_ANTERIOR) return false;
  if (!/renov/i.test(String(c.situacaoContrato || ''))) return false;
  return /(^|[^A-Z0-9])RECORRENTE([^A-Z0-9]|$)/.test(String(c.nomePlano || '').toUpperCase());
}

/** Grava no caderninho sem apagar consultora/quem lançou que já estejam lá */
async function gravarContrato(db, unidade, codigo, c) {
  await db.collection(COL_CONTRATOS).doc(unidade + '_' + codigo).set(L.soPreenchidos(c), { merge: true });
}

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

const COM_RESPOSTA = ['buscado', 'vazio_conferir', 'parcial'];

/**
 * Falha NÃO apaga o dia que já tinha resposta da Pacto (22/09/2026): com a
 * madrugada relendo o mês inteiro, uma falha passageira zerava dias bons e
 * derrubava o termômetro até a noite seguinte. O dia bom fica como estava e
 * ganha `ultimaFalha`; a próxima busca boa substitui tudo e a marca some.
 * Dia sem resposta anterior grava a falha — nunca vira "dia sem venda".
 */
async function gravarFalha(db, unidade, dia, situacao, motivo, quando) {
  const ref = db.collection(COL_DIAS).doc(unidade + '_' + dia);
  const atual = await ref.get();
  if (atual.exists && COM_RESPOSTA.includes(atual.data().situacao)) {
    await ref.set({ ultimaFalha: { situacao, motivo: motivo || '', em: quando } }, { merge: true });
    return;
  }
  await gravarDia(db, unidade, dia, { situacao, motivo: motivo || '', buscadoEm: quando });
}

/**
 * Busca um dia de uma unidade e grava.
 * `gw` (opcional): cliente do gateway com a credencial DA UNIDADE — completa a
 * consultora (o Campeche só tem por ali) e traz o balcão do relatório de vendas.
 * @returns {{situacao, consultas, maiorContrato}}
 */
async function buscarDia({ db, cliente, gw, unidade, dia, agora, anoCorrente, orcamento, hoje }) {
  const chave = PACTO_UNIDADES[unidade];
  if (!chave) throw new Error('buscarDia: unidade desconhecida ' + unidade);
  const quando = agora ? agora() : new Date().toISOString();
  const hojeSP = hoje || hojeSaoPaulo();

  const r = await cliente.resumoDoDia(chave, dia);
  if (r.situacao !== 'ok') {
    await gravarFalha(db, unidade, dia, r.situacao, r.motivo, quando);
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
          await gravarContrato(db, unidade, codigo, c);
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
      await gravarFalha(db, unidade, dia, rc.situacao, rc.motivo, quando);
      return { situacao: rc.situacao, consultas };
    }
    if (rc.situacao !== 'ok') continue;                 // o contrato fica sem dados → aviso no conversor
    for (const bruto of rc.dados) {
      if (bruto == null || bruto.codigo == null) continue;
      const codigo = String(bruto.codigo);
      const g = await doLancamento(codigo);
      const limpo = { ...L.limparContrato(bruto, unidade, g.consultor, g.lancou), atualizadoEm: quando };
      await gravarContrato(db, unidade, codigo, limpo);
      // merge: o que o caderninho já sabia (consultora do gateway) continua valendo
      const antes = (await db.collection(COL_CONTRATOS).doc(unidade + '_' + codigo).get()).data();
      contratos.set(codigo, antes || limpo);
    }
  }

  // Consultora pelo GATEWAY (30/09/2026). Duas perguntas, uma vez só por contrato:
  //  • o contrato (`gw`): quem lançou, a consultora do contrato e o código da pessoa;
  //  • o aluno (`alunoConsultado`): a consultora VINCULADA a ele — é ela que a
  //    coluna "Consultor" do export mostra e que decide a comissão.
  // `orcamento` limita as consultas da noite: a primeira carga é grande e a
  // função tem teto de tempo; o que faltar completa na busca seguinte, com aviso.
  const avisosGw = [];
  if (gw) {
    for (const [codigo, c0] of contratos) {
      let c = c0;
      // De que contrato esta renovação veio (05/10/2026). Contrato lido ANTES de o
      // caderninho guardar isso é perguntado mais uma vez — só renovação de plano
      // recorrente, que é onde a resposta decide ("mensalidade seguinte não é venda").
      // Falhar aqui não deixa o dia incompleto: fica sem a resposta até a próxima busca.
      if (precisaDoAnterior(c, dia) && !(orcamento && orcamento.restante <= RESERVA_RELEITURA)) {
        const r = await gw.contrato(codigo);
        if (orcamento) orcamento.restante--;
        if (r.situacao === 'ok' && r.dados) {
          c = { ...c, anterior: r.dados.anterior || null };
          await gravarContrato(db, unidade, codigo, c);
          contratos.set(codigo, c);
        }
      }
      if (c.gw && c.alunoConsultado) {
        // Já lido: relê o vínculo do contrato novo de tempos em tempos (01/10/2026).
        // Falhar aqui NUNCA deixa o dia incompleto: fica o vínculo que já havia.
        if (!precisaRelerVinculo(c, dia, hojeSP)) continue;
        if (orcamento && (orcamento.semReleitura || orcamento.restante <= RESERVA_RELEITURA)) continue;
        const a = await gw.consultorDoAluno(c.pessoa);
        if (orcamento) orcamento.restante -= 2;
        if (PARA_TUDO.includes(a.situacao)) { if (orcamento) orcamento.semReleitura = true; continue; }
        if (a.situacao !== 'ok') continue;
        c = { ...c, consultorAluno: a.dados.consultor || null, vinculoDia: hojeSP };
        await gravarContrato(db, unidade, codigo, c);
        contratos.set(codigo, c);
        continue;
      }
      if (orcamento && orcamento.restante <= 0) {
        avisosGw.push({ motivo: 'consultora a completar na próxima busca (limite de consultas da noite)', contrato: codigo });
        continue;
      }
      if (!c.gw) {
        const r = await gw.contrato(codigo);
        if (orcamento) orcamento.restante--;
        if (PARA_TUDO.includes(r.situacao)) {
          avisosGw.push({ motivo: 'gateway: ' + r.situacao + ' — consultora não completada neste dia', contrato: codigo });
          break;
        }
        if (r.situacao !== 'ok') continue;
        c = { ...c, gw: true };
        if (r.dados) {
          c.consultor = c.consultor || r.dados.consultor || null;
          c.lancou = c.lancou || r.dados.lancou || null;
          c.pessoa = r.dados.cliente && r.dados.cliente.codigo ? r.dados.cliente.codigo : null;
          c.anterior = r.dados.anterior || null;
        }
      }
      if (!c.alunoConsultado && c.pessoa) {
        const a = await gw.consultorDoAluno(c.pessoa);
        if (orcamento) orcamento.restante -= 2;
        if (PARA_TUDO.includes(a.situacao)) {
          avisosGw.push({ motivo: 'gateway: ' + a.situacao + ' — consultora do aluno não completada neste dia', contrato: codigo });
          await gravarContrato(db, unidade, codigo, c);
          contratos.set(codigo, c);
          break;
        }
        if (a.situacao === 'ok') c = { ...c, alunoConsultado: true, consultorAluno: a.dados.consultor || null, vinculoDia: hojeSP };
      }
      await gravarContrato(db, unidade, codigo, c);
      contratos.set(codigo, c);
    }
  }

  const m = L.montar({ resumo, contratos, unidade, dia });

  // Balcão pelo relatório de vendas do gateway: não vem nos pagamentos do núcleo.
  // A rota não aceita ano — dia de outro ano (dezembro relido em janeiro) fica sem.
  // Fica À PARTE (`linhasBalcao`): conta no dinheiro recebido, mas NÃO paga
  // comissão — o relatório não diz quem vendeu, e o Rafael decidiu (30/09/2026)
  // que o valor não vale o esforço. Para pagar um dia, basta juntar às linhas.
  let balcao = 0;
  let linhasBalcao = [];
  if (gw) {
    const ano = anoCorrente || anoSaoPaulo();
    if (dia.slice(0, 4) !== String(ano)) {
      avisosGw.push({ motivo: 'balcão não buscado: o relatório de vendas da Pacto só aceita o ano corrente' });
    } else {
      const v = await gw.vendasDoDia(dia);
      if (v.situacao !== 'ok') {
        avisosGw.push({ motivo: 'vendas de balcão: ' + v.situacao + ' ' + (v.motivo || '') });
      } else {
        const b = L.linhasDeBalcao({ vendas: v.dados, linhas: m.linhas, unidade });
        linhasBalcao = b.linhas;
        b.linhas.forEach(l => { balcao += L._valor(l[L.COL.valor]); });
      }
    }
  }
  balcao = Math.round(balcao * 100) / 100;
  m.totais.recebido = Math.round((m.totais.recebido + balcao) * 100) / 100;
  m.totais.balcao = balcao;
  m.avisos.push(...avisosGw);

  const situacao = L.situacaoDoDia({ resumo, avisos: m.avisos });
  await gravarDia(db, unidade, dia, {
    situacao,
    motivo: '',
    linhas: JSON.stringify(m.linhas),          // Firestore não aceita array de arrays
    linhasBalcao: JSON.stringify(linhasBalcao),
    // Com a credencial da unidade o dia traz a vendedora; sem ela, o mês das
    // comissões NÃO é calculado com este dia (UploadPelaApi._semVendedora)
    comGateway: !!gw,
    foraDeProposito: m.foraDeProposito,
    avisos: m.avisos,
    totais: m.totais,
    contratosConsultados: consultas,
    buscadoEm: quando,
  });
  const numeros = [...alunoDoContrato.keys()].map(Number).filter(x => x > 0);
  return { situacao, consultas, maiorContrato: numeros.length ? Math.max(...numeros) : null };
}

/**
 * Consulta pelo gateway os números de contrato desde o último varrido até `ate`
 * (30/09/2026). Os contratos são numerados em sequência por unidade, então é
 * assim que aparece o contrato que não tem pagamento — a degustação grátis.
 * Contrato achado → caderninho (com a consultora). Degustação grátis (a regra
 * do `PactoAdapter.degustacoesGratis`) → `pacto_degustacoes`.
 * A marca fica no MAIOR NÚMERO QUE EXISTE: o número ainda livre pode nascer amanhã.
 */
/**
 * Contrato de valor zero lido do gateway → registro em `pacto_degustacoes`, se for
 * degustação grátis (a regra é do `PactoAdapter.degustacoesGratis`). A vendedora é
 * a do caderninho `c` — a vinculada ao aluno. @returns {boolean} gravou?
 */
async function gravarDegustacaoSeFor({ db, unidade, dados, c, quando }) {
  const PA = require('./pacto-adapter.js');
  if (!dados || dados.valor !== 0) return false;
  const linha = L.linhaDeDegustacao({ ...dados, consultor: L.consultoraDoContrato(c) || null }, unidade);
  const lista = Object.values(PA.degustacoesGratis(L.comCabecalho([linha]))).flat();
  if (!lista.length) return false;                   // valor zero que não é degustação (plano de crédito)
  const [dd, mm, aa] = dados.lancamento.split('/');
  await db.collection(COL_DEGUSTACOES).doc(unidade + '_' + dados.codigo).set({
    unidade, contrato: String(dados.codigo), mes: aa + '-' + mm, dia: aa + '-' + mm + '-' + dd,
    degustacao: lista[0], atualizadoEm: quando,
  });
  return true;
}

/**
 * Relê o vínculo do aluno das degustações grátis dos meses em cálculo (01/10/2026):
 * o registro nasce na varredura com a vendedora daquele dia, e o voucher também
 * paga comissão. Vínculo que mudou → o registro é refeito pela mesma regra.
 * Falha não muda nada: fica o registro como estava.
 */
async function relerVinculoDasDegustacoes({ db, gw, unidade, meses, hoje, agora, orcamento }) {
  const quando = agora ? agora() : new Date().toISOString();
  const hojeSP = hoje || hojeSaoPaulo();
  let relidas = 0, mudaram = 0;
  const docs = (await db.collection(COL_DEGUSTACOES).where('unidade', '==', unidade).get()).docs.map(d => d.data());
  for (const x of docs) {
    if (!x || !meses.includes(x.mes) || x.mes < INICIO_RELEITURA) continue;
    const snap = await db.collection(COL_CONTRATOS).doc(unidade + '_' + x.contrato).get();
    const c = snap.exists ? snap.data() : null;
    if (!c || !c.pessoa || !c.alunoConsultado) continue;
    if (c.vinculoDia && c.vinculoDia > somarDias(hojeSP, -DIAS_RELER_VINCULO)) continue;
    if (orcamento && (orcamento.semReleitura || orcamento.restante <= RESERVA_RELEITURA)) break;
    const a = await gw.consultorDoAluno(c.pessoa);
    if (orcamento) orcamento.restante -= 2;
    if (PARA_TUDO.includes(a.situacao)) { if (orcamento) orcamento.semReleitura = true; break; }
    if (a.situacao !== 'ok') continue;
    relidas++;
    const novo = a.dados.consultor || null;
    const mudou = novo !== (c.consultorAluno || null);
    const c2 = { ...c, consultorAluno: novo, vinculoDia: hojeSP };
    await gravarContrato(db, unidade, String(x.contrato), c2);
    if (!mudou) continue;
    const r = await gw.contrato(x.contrato);
    if (orcamento) orcamento.restante--;
    if (PARA_TUDO.includes(r.situacao)) { if (orcamento) orcamento.semReleitura = true; break; }
    if (r.situacao !== 'ok' || !r.dados) continue;
    if (await gravarDegustacaoSeFor({ db, unidade, dados: r.dados, c: c2, quando })) mudaram++;
  }
  return { relidas, mudaram };
}

async function varrerContratosNovos({ db, gw, unidade, ate, desde, agora, orcamento, hoje }) {
  const quando = agora ? agora() : new Date().toISOString();
  const hojeSP = hoje || hojeSaoPaulo();
  const ref = db.collection(COL_SEQ).doc(unidade);
  const s = await ref.get();
  let ultimo = s.exists ? s.data().ultimo : null;
  let n = desde != null ? Number(desde) : (ultimo != null ? ultimo + 1 : ate - JANELA_INICIAL);
  let achados = 0, degustacoes = 0, parouPor = null;
  for (; n <= ate; n++) {
    if (orcamento && orcamento.restante <= 0) { parouPor = 'limite_da_busca'; break; }
    const r = await gw.contrato(n);
    if (orcamento) orcamento.restante--;
    if (PARA_TUDO.includes(r.situacao)) { parouPor = r.situacao; break; }
    if (r.situacao !== 'ok' || !r.dados) continue;
    achados++;
    ultimo = Math.max(ultimo || 0, n);
    const c = { ...L.contratoDoGateway(r.dados, unidade), atualizadoEm: quando };
    // a consultora que vale é a do aluno (como a coluna do export)
    if (c.pessoa) {
      const a = await gw.consultorDoAluno(c.pessoa);
      if (orcamento) orcamento.restante -= 2;
      if (a.situacao === 'ok') { c.alunoConsultado = true; c.consultorAluno = a.dados.consultor || null; c.vinculoDia = hojeSP; }
    }
    await gravarContrato(db, unidade, String(n), c);
    if (await gravarDegustacaoSeFor({ db, unidade, dados: r.dados, c, quando })) degustacoes++;
  }
  if (ultimo != null) await ref.set({ ultimo, atualizadoEm: quando }, { merge: true });
  return { achados, degustacoes, ultimo, parouPor };
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
  const CM = require('./comissoes-mes.js');
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
      // Contratos pagos antes que começam neste mês (out/2026+): a ativação conta aqui
      const ativacoesAdiadas = [];
      if (mes >= CE.INICIO_REGRA_MINIMOS) {
        const [a, m] = mes.split('-').map(Number);
        const desde = new Date(Date.UTC(a, m - 14, 1)).toISOString().slice(0, 7);
        for (const p of periodos) {
          const pm = (String(p.id).match(/(\d{4}-\d{2})$/) || [])[1];
          if (!pm || pm >= mes || pm < desde) continue;
          const it = await db.collection('periodos').doc(p.id).collection('itens').where('ativacaoAdiadaPara', '==', mes).get();
          it.docs.forEach(d => { const x = d.data(); if (x.type === 'processed') ativacoesAdiadas.push(x); });
        }
      }
      // Mês anterior: as degustações dele reconhecem a conversão como venda nova (out/2026+)
      let anteriores = [];
      if (mes >= CE.INICIO_REGRA_MINIMOS && unitId) {
        const [ay, am] = mes.split('-').map(Number);
        const mesAnt = new Date(Date.UTC(ay, am - 2, 1)).toISOString().slice(0, 7);
        const ant = await db.collection('periodos').doc(unitId + '_' + mesAnt).collection('itens').where('type', '==', 'processed').get();
        anteriores = ant.docs.map(d => d.data()).filter(x => x.isDegustacao);
      }
      // Mensalidade seguinte do mesmo plano recorrente não é venda (05/10/2026) — a mesma
      // leitura do caderninho que o cálculo das comissões faz. Se falhar, o termômetro sai
      // sem ela (pode contar a mais), mas sai.
      let mensalidadesSeguintes = [];
      try {
        const linhasDoMes = docs.filter(d => String(d.dia || '').slice(0, 7) === mes).flatMap(d => (d.linhas ? JSON.parse(d.linhas) : []));
        mensalidadesSeguintes = await CM.mensalidadesSeguintes({ db, Adapter: PA, linhas: linhasDoMes, mes });
      } catch (e) { /* fica sem */ }
      const r = T.calcularMes({
        docs, mes, unidade, hoje, codigosPagos, mensalidadesSeguintes,
        config: { ...unitConfig, ...(metasMensais || {}), ativacoesAdiadas }, metaDoMes, anteriores,
        Adapter: PA, Engine: CE, ApiLinhas: L,
      });
      const id = unidade + '_' + mes;
      const doc = { ...r, unitId, hoje, atualizadoEm: quando };
      await db.collection(COL_TERMOMETRO).doc(id).set(doc);
      // Cópia da EQUIPE (vendedoras leem, 22/09/2026): sem o dinheiro recebido,
      // que é o faturamento da unidade. Regra do Firestore não esconde campo —
      // o dinheiro não pode estar no documento que elas leem.
      const { recebido, ...semDinheiro } = doc;
      await db.collection(COL_TERMOMETRO_EQUIPE).doc(id).set(semDinheiro);
      feitos.push({ id });
    }
  }
  return feitos;
}

/**
 * Percorre dias × unidades; para tudo na primeira credencial recusada ou limite.
 * Com `clientesGw` ({CP, PP}), cada unidade usa o seu gateway e, no fim, varre os
 * números de contrato até o maior pago + FOLGA_VARREDURA (a degustação grátis).
 */
async function buscar({ db, cliente, clientesGw, unidades = ['CP', 'PP'], dias, agora, varrerDesde, anoCorrente, limiteGw, hoje }) {
  const resultados = [];
  const maior = {};
  const orcamento = { restante: limiteGw != null ? limiteGw : LIMITE_GW_POR_BUSCA };
  for (const dia of dias) {
    for (const unidade of unidades) {
      const gw = clientesGw && clientesGw[unidade];
      const r = await buscarDia({ db, cliente, gw, unidade, dia, agora, anoCorrente, orcamento, hoje });
      resultados.push({ unidade, dia, situacao: r.situacao });
      if (r.maiorContrato) maior[unidade] = Math.max(maior[unidade] || 0, r.maiorContrato);
      if (PARA_TUDO.includes(r.situacao)) return { resultados, parouPor: r.situacao };
    }
  }
  const varredura = {};
  for (const unidade of unidades) {
    const gw = clientesGw && clientesGw[unidade];
    if (!gw || !maior[unidade]) continue;
    const desde = varrerDesde && varrerDesde[unidade] != null ? varrerDesde[unidade] : undefined;
    varredura[unidade] = await varrerContratosNovos({ db, gw, unidade, ate: maior[unidade] + FOLGA_VARREDURA, desde, agora, orcamento, hoje });
  }
  // Por último, com o que sobrou das consultas da noite: o vínculo das degustações grátis
  const vinculos = {};
  const meses = [...new Set(dias.map(d => d.slice(0, 7)))];
  for (const unidade of unidades) {
    const gw = clientesGw && clientesGw[unidade];
    if (!gw) continue;
    try {
      vinculos[unidade] = await relerVinculoDasDegustacoes({ db, gw, unidade, meses, hoje, agora, orcamento });
    } catch (e) {
      vinculos[unidade] = { erro: String(e && e.message || e) };   // nunca derruba a busca, que já gravou os dias
    }
  }
  return { resultados, varredura, vinculos, consultasGwRestantes: orcamento.restante };
}

module.exports = { PACTO_UNIDADES, COL_DIAS, COL_CONTRATOS, COL_CONSULTORAS, COL_TERMOMETRO, COL_TERMOMETRO_EQUIPE, COL_SEQ, COL_DEGUSTACOES, MAX_DIAS, FOLGA_VARREDURA, LIMITE_GW_POR_BUSCA,
  INICIO_RELEITURA, DIAS_RELER_VINCULO, JANELA_CONTRATO_NOVO, RESERVA_RELEITURA, precisaRelerVinculo, precisaDoAnterior, relerVinculoDasDegustacoes,
  diasParaBuscar, diasDaRotina, buscarDia, buscar, varrerContratosNovos, somarDias, atualizarTermometro };
