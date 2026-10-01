// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — A vaga da escala acompanha a troca de professor da aula
//
// Quando a gestão confirma uma troca de aula, `processSubstitutionAcceptance`
// passa a AULA pro nome de quem assumiu. Se a aula veio de uma escala (sábado,
// feriado, fim de ano, Escola Interna), a VAGA em `special_scales` tem que
// mudar junto — senão a escala fica com o nome de quem não trabalhou.
//
// Achado em 01/10/2026 (reclamação do Vagner): a escala de 26/09 mostrava o
// Thiago, e quem deu a aula foi o Vagner. Com isso:
//   · o rodízio contava o sábado pro Thiago (o motor decide por essa conta);
//   · a "equipe do dia" e o texto pro WhatsApp saíam com o nome antigo;
//   · republicar a escala desfazia a troca, recriando a aula no nome antigo.
//
// Só existe em `functions/` (não tem gêmeo na raiz): quem troca o professor da
// aula é a Function, então é ela que acerta a vaga.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

const HISTORICO_MAX = 50;   // mesmo teto do histórico em scale-service.js

/**
 * PURO: como ficam as vagas e o histórico da escala depois da troca.
 * Devolve cópia — não altera a entrada. `null` quando não há o que gravar
 * (vaga não existe, sem substituto, ou a vaga já está no nome certo).
 *
 * @param {Object} scale documento de special_scales
 * @param {{slotId:string, paraId:string, deNome:string, paraNome:string,
 *          uid:string, nome:string, agoraISO:string}} p
 * @returns {{slots:Array, historico:Array}|null}
 */
function vagaDepoisDaTroca(scale, p) {
  if (!scale || !p || !p.slotId || !p.paraId) return null;
  const slots = Array.isArray(scale.slots) ? scale.slots : [];
  const vaga = slots.find(s => s && s.id === p.slotId);
  if (!vaga || vaga.assignedPersonId === p.paraId) return null;

  const novos = slots.map(s => (s && s.id === p.slotId)
    // `reason:'troca'` e `explain:[]`: a tela não pode seguir alegando
    // "justiça" ou "mérito" numa vaga que mudou de dono por troca.
    ? Object.assign({}, s, { assignedPersonId: p.paraId, reason: 'troca', explain: [] })
    : s);

  const mod = vaga.requiredModalityName ? ` (${vaga.requiredModalityName})` : '';
  const entrada = {
    ts: p.agoraISO || new Date().toISOString(),
    uid: p.uid || null,
    nome: p.nome || null,
    acao: 'troca_de_aula',
    detalhe: `troca entre professores confirmada: saiu ${p.deNome || vaga.assignedPersonId || '—'}, entrou ${p.paraNome || p.paraId}${mod}`,
  };
  const hist = (Array.isArray(scale.historico) ? scale.historico.slice() : []).concat([entrada]);
  return { slots: novos, historico: hist.length > HISTORICO_MAX ? hist.slice(hist.length - HISTORICO_MAX) : hist };
}

/**
 * Acerta a vaga da escala depois que a aula trocou de professor.
 * Nunca lança: a troca da aula já está gravada e vale; se isto falhar, perde-se
 * só a sincronia da escala (e o motivo volta em `motivo` pra ir pro log).
 *
 * @param {Object} firestore Firestore do Admin SDK (ou o fake dos testes)
 * @param {{cls:Object, sub:Object, agoraISO:string, carimbo:*}} p
 *   `cls` é a aula como estava ANTES da troca; `carimbo` é o serverTimestamp.
 * @returns {Promise<{mudou:boolean, motivo:string}>}
 */
async function sincronizarEscalaComTroca(firestore, p) {
  try {
    const cls = (p && p.cls) || {};
    const sub = (p && p.sub) || {};
    if (!cls.specialScaleId || !cls.specialScaleSlotId) return { mudou: false, motivo: 'a aula não veio de uma escala' };
    if (!sub.substituteTeacherId) return { mudou: false, motivo: 'troca sem substituto' };

    const ref = firestore.collection('special_scales').doc(cls.specialScaleId);
    const doc = await ref.get();
    if (!doc.exists) return { mudou: false, motivo: 'a escala não existe mais' };

    const nomeDe = async (col, id, campos) => {
      if (!id) return null;
      const d = await firestore.collection(col).doc(id).get();
      if (!d.exists) return null;
      const x = d.data() || {};
      for (const c of campos) if (x[c]) return x[c];
      return null;
    };
    const quemConfirmou = sub.homologadoPor || sub.updatedBy || null;
    const novo = vagaDepoisDaTroca(doc.data(), {
      slotId: cls.specialScaleSlotId,
      paraId: sub.substituteTeacherId,
      deNome: await nomeDe('teachers', cls.teacherId || sub.requestingTeacherId, ['name']),
      paraNome: await nomeDe('teachers', sub.substituteTeacherId, ['name']),
      uid: quemConfirmou,
      nome: (await nomeDe('users', quemConfirmou, ['name', 'nome', 'email'])) || 'gestão',
      agoraISO: p.agoraISO,
    });
    if (!novo) return { mudou: false, motivo: 'a vaga já estava no nome certo (ou não existe na escala)' };

    await ref.update({ slots: novo.slots, historico: novo.historico, updatedAt: p.carimbo || null });
    return { mudou: true, motivo: '' };
  } catch (err) {
    return { mudou: false, motivo: 'falhou: ' + (err && err.message ? err.message : String(err)) };
  }
}

module.exports = { vagaDepoisDaTroca, sincronizarEscalaComTroca, HISTORICO_MAX };
