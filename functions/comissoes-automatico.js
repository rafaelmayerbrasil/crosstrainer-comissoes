'use strict';
// ═══════════════════════════════════════════════════════════════════════
// O mês das comissões atualizado SOZINHO, toda madrugada
// ═══════════════════════════════════════════════════════════════════════
//
// Desenho: docs/superpowers/specs/2026-09-30-api-pacto-oficial-design.md §7
// Decisão do Rafael (30/09/2026): "não quero ter que clicar; clicar fica como um
// gatilho pontual para atualizar na hora, e subir a carga manual só em último caso".
//
// Roda logo depois da busca das 4h. Para cada unidade e mês relido pela busca:
//   • só a partir de out/2026 (setembro fecha como está);
//   • CONGELADO — recibo emitido ou pago daquele mês — não mexe (só o botão);
//   • dia faltando na Pacto — não mexe; o mês fica com o último cálculo bom;
//   • senão, monta o mês pelos MESMOS módulos do botão (UploadPelaApi +
//     ComissoesMes) e grava; mês sem meta ganha a proposta do sistema.
// Todo resultado fica em `periodos/{id}.automatico` (o painel mostra) e no audit_log.

const CM = require('./comissoes-mes.js');
const CE = require('./commission.js');
const PA = require('./pacto-adapter.js');
const JC = require('./jornada-comercial.js');
const MS = require('./metas-sugeridas.js');
const U = require('./upload-pela-api.js');
const L = require('./pacto-api-linhas.js');

const INICIO_AUTOMATICO = '2026-10';
const AUTOR = { uid: 'sistema', email: 'sistema', name: 'Sistema (Pacto, madrugada)' };

/** Recibo emitido ou pago daquele período (cancelado não conta) */
async function congelado(db, periodId) {
  const s = await db.collection('pagamentos').where('periodId', '==', periodId).get();
  return s.docs.some(d => (d.data().status || '') !== 'cancelado');
}

/**
 * @param {Object} a
 * @param {Object} a.db, a.FieldValue, a.Timestamp   Admin SDK (ou os falsos do teste)
 * @param {string} a.sigla  'CP' | 'PP'
 * @param {string} a.mes    'AAAA-MM'
 * @param {string} a.hoje   'AAAA-MM-DD' em São Paulo
 * @returns {{ situacao: 'fora'|'congelado'|'travado'|'sem_dados'|'atualizado'|'erro', ... }}
 */
async function atualizarMesAutomatico({ db, FieldValue, Timestamp, sigla, mes, hoje, log }) {
  log = log || { info() {}, warn() {}, error() {} };
  if (mes < INICIO_AUTOMATICO) return { situacao: 'fora' };
  const units = (await db.collection('units').get()).docs;
  const u = units.find(d => PA.siglaDaUnidade(d.id, [sigla]) === sigla);
  if (!u) return { situacao: 'erro', motivo: 'unidade ' + sigla + ' não encontrada' };
  const unitId = u.id;
  const periodId = unitId + '_' + mes;
  const ref = db.collection('periodos').doc(periodId);
  const [ano, mm] = mes.split('-').map(Number);
  const registrar = async (o) => {
    // unitId/ano/mês junto: o mês que só ganhou o status continua aparecendo na lista da unidade
    await ref.set({ unitId, year: ano, month: mm, automatico: { ...o, em: FieldValue.serverTimestamp() } }, { merge: true });
    return o;
  };
  const auditar = async (details) => {
    try {
      await db.collection('audit_log').add({ type: 'upload', details, userId: AUTOR.uid, userName: AUTOR.name,
        unitId, timestamp: FieldValue.serverTimestamp() });
    } catch (e) { log.warn('audit_log falhou:', e.message); }
  };

  try {
    if (await congelado(db, periodId)) return await registrar({ situacao: 'congelado' });

    const docs = (await db.collection('pacto_sombra_dias').where('unidade', '==', sigla).get()).docs
      .map(d => d.data()).filter(d => String(d.dia || '').slice(0, 7) === mes);
    const degustacoes = (await db.collection('pacto_degustacoes').where('unidade', '==', sigla).get()).docs.map(d => d.data());
    const m = U.montar({ docs, degustacoes, mes, hoje, ApiLinhas: L });
    if (m.trava) {
      await auditar(`Automático: ${periodId} NÃO atualizado — faltam dados da Pacto em ${m.diasProblema.map(d => U.diaCurto(d.dia)).join(', ')}`);
      return await registrar({ situacao: 'travado', dadosAte: m.dadosAte,
        diasProblema: m.diasProblema.map(d => ({ dia: d.dia, situacao: d.situacao })) });
    }

    const ops = CM.criar({ db, FieldValue, Timestamp, Engine: CE, Adapter: PA, Jornada: JC, Metas: MS, autor: AUTOR, log });
    const prep = await ops.preparar(m.json, { unitId, opcoes: { origem: 'api', dadosAte: m.dadosAte, degustacoes: m.degustacoes } });
    if (prep.tipo === 'vazio' || prep.tipo === 'outraUnidade') return await registrar({ situacao: 'sem_dados', dadosAte: m.dadosAte });
    if (prep.tipo !== 'ok') return await registrar({ situacao: 'erro', motivo: 'o mês não pôde ser montado (' + prep.tipo + ')', dadosAte: m.dadosAte });

    const fonte = 'Pacto (automático) · dados até ' + U.diaCurto(m.dadosAte);
    const r = await ops.gravar(prep, { unitId, mes, fileName: fonte, origem: 'api', dadosAte: m.dadosAte });

    // Mês sem meta: o sistema propõe (aguardando a revisão da gestão; o recibo trava até lá)
    const pm = await ops.proporMeta(periodId, (await ref.get()).data(), { ehAdmin: true });
    if (pm.proposto) await ops.recalcularPeriodo(periodId, { type: 'config_change', label: 'Meta do mês calculada pelo sistema' });

    const tot = ((await ref.get()).data() || {}).totals || {};
    await auditar(`Automático: ${fonte} · ${prep.result.processed.length} processados · ${r.added} novos, ${r.removidos} removidos · ` +
      `Ativações: ${tot.unitAtivacoes || 0}${pm.proposto ? ' · meta do mês proposta pelo sistema (aguardando revisão)' : ''}`);
    return await registrar({ situacao: 'atualizado', dadosAte: m.dadosAte, ativacoes: tot.unitAtivacoes || 0,
      novos: r.added, removidos: r.removidos, metaProposta: !!pm.proposto,
      parcelasDepois: m.parcelasDepois.length, diasVazios: m.vazios });
  } catch (e) {
    log.error('automático ' + periodId + ':', e);
    try { return await registrar({ situacao: 'erro', motivo: String(e && e.message || e).slice(0, 300) }); } catch (_) { return { situacao: 'erro', motivo: String(e && e.message || e) }; }
  }
}

module.exports = { atualizarMesAutomatico, congelado, INICIO_AUTOMATICO, AUTOR };
