// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — De quem é o dia: da grade normal ou de uma escala especial
//
// Puro (sem Firestore). Só a Cloud Function usa hoje, por isso vive em
// functions/ e não tem gêmeo na raiz.
//
// Por que existe (22/08/2026): o gerador de aulas procurava escala com
// `.where('isActive','==',true)` + `unitIds` — o formato das Escalas Especiais
// da Sprint 5a. A Escala Inteligente, construída depois, grava outro formato:
// `status: 'consolidada'` e a unidade dentro de cada vaga. Em produção havia
// 24 escalas, ZERO com `isActive` e ZERO com `unitIds`: a consulta voltava
// vazia, e pro gerador escala nenhuma jamais existiu.
//
// E mesmo se enxergasse, ele só usava a escala como etiqueta — nunca deixava
// de gerar a grade. Os dois defeitos somados puseram 78 aulas de segunda-feira
// comum em cada feriado nacional e 2 professores por modalidade em cada
// sábado: 184 aulas, 259 horas que entrariam no fechamento.
// ═══════════════════════════════════════════════════════════════════════
'use strict';

/**
 * Tipos de escala que SUBSTITUEM a grade do dia.
 *
 * `escola_interna` e `evento` ficam de fora de propósito: elas acontecem
 * ALÉM do expediente normal, não no lugar dele. Tratá-las como donas do dia
 * apagaria dias úteis inteiros — agosto/2026 tem 12 escolas internas em dias
 * de semana comuns.
 *
 * `fim_de_ano` também fica de fora até alguém decidir: não existe nenhuma em
 * produção e o comportamento nunca foi combinado com a gestão.
 */
const ESCALA_DONA_DO_DIA = ['sabado', 'feriado', 'domingo_especial'];

/** A escala manda no dia, ou só acontece nele? */
function ehDonaDoDia(scale) {
  return !!scale && ESCALA_DONA_DO_DIA.indexOf(scale.tipo) !== -1;
}

/** 'YYYY-MM-DD' a partir de string ou Timestamp do Firestore, em horário BR. */
function ymdDe(date) {
  if (!date) return null;
  if (typeof date === 'string') return date.slice(0, 10);
  const d = date.toDate ? date.toDate() : new Date(date);
  if (isNaN(d.getTime())) return null;
  // BR é UTC-3: desloca antes de ler os componentes, senão 21h vira o dia seguinte
  const br = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return `${br.getUTCFullYear()}-${String(br.getUTCMonth() + 1).padStart(2, '0')}-${String(br.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Normaliza um documento de special_scales, nos dois formatos.
 * @returns {{id,tipo,name,status,ymd,unidades}|null} null = não vale pro dia.
 */
function normalizarEscala(id, s) {
  if (!s) return null;

  // Só a escala JÁ DECIDIDA manda no dia. Rascunho pode nem acontecer.
  const valeNova = s.status === 'consolidada' || s.status === 'publicada';
  const valeAntiga = s.isActive === true;
  if (!valeNova && !valeAntiga) return null;

  const ymd = ymdDe(s.date);
  if (!ymd) return null;

  const unidades = Array.isArray(s.unitIds) && s.unitIds.length
    ? s.unitIds.slice()
    : [...new Set((s.slots || []).map(sl => sl && sl.unitId).filter(Boolean))];
  if (!unidades.length) return null;

  const tipo = s.tipo || s.scaleTypeId || null;
  return {
    id,
    tipo,
    name: s.name || '',
    status: s.status || null,
    ymd,
    unidades,
    scaleTypeId: tipo,   // compat: parte do código antigo lê por este nome
  };
}

/**
 * Mapa 'YYYY-MM-DD_unitId' → escala normalizada.
 * @param {Array<{id:string,data:object}>} docs
 */
function montarMapa(docs) {
  const mapa = new Map();
  (docs || []).forEach(d => {
    const n = normalizarEscala(d.id, d.data);
    if (!n) return;
    n.unidades.forEach(uid => mapa.set(`${n.ymd}_${uid}`, n));
  });
  return mapa;
}

module.exports = { ESCALA_DONA_DO_DIA, ehDonaDoDia, ymdDe, normalizarEscala, montarMapa };
