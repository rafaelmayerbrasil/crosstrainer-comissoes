// scripts/preview-recibo-html.js
// Gera o HTML do recibo R4 (Sprint 9) replicando buildReceiptHtmlForExport
// em Node, pra preview visual sem precisar do browser. Lê do FIXTURE8.

'use strict';

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

admin.initializeApp({
  credential: admin.credential.cert(require('./serviceAccount-staging.json')),
  projectId: 'crosstrainer-comissoes-staging',
});

const db = admin.firestore();

// Replicação fiel de buildReceiptHtmlForExport (professores-relatorios.js)
function buildReceiptHtml(prof, closing) {
  const monthNames = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const periodo = (monthNames[closing.month] || closing.month) + ' de ' + closing.year;
  const typeLabel = { efetivo: 'Efetivo(a)', estagiario: 'Estagiário(a)', eventual: 'Eventual' }[prof.teacherType] || (prof.teacherType || '');

  const horas = (prof.totalHoras || 0).toFixed(1);
  const valorHoras = Number(prof.valorHoras || 0).toFixed(2);
  const valorTotalFechamento = Number(prof.valorTotal || 0).toFixed(2);

  let vacationHtml = '';
  if ((prof.vacationValue || 0) > 0 && Array.isArray(prof.vacationDetails) && prof.vacationDetails.length > 0) {
    const vacLines = prof.vacationDetails.map(vd => {
      const pStart = vd.periodStart && vd.periodStart.toDate ? vd.periodStart.toDate().toLocaleDateString('pt-BR') : '';
      const pEnd = vd.periodEnd && vd.periodEnd.toDate ? vd.periodEnd.toDate().toLocaleDateString('pt-BR') : '';
      const isAuto = vd.paymentMode === 'auto';
      const calcDetail = isAuto
        ? `<div style="font-size:11px;color:#475569;margin:2px 0 4px 0;">Base mensal: R$ ${Number(vd.baseMonthly || 0).toFixed(2)}<br>Proporcional: R$ ${Number(vd.proportionalBase || 0).toFixed(2)} (${vd.daysInMonth}/30)<br>1/3 constitucional: R$ ${Number(vd.oneThirdValue || 0).toFixed(2)}</div>`
        : '';
      return `<div style="margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #e0e0e0;">
        <div style="font-weight:600;font-size:12px;">Período: ${pStart} a ${pEnd} (${vd.daysInMonth} dias)</div>
        ${calcDetail}
        <div style="text-align:right;font-weight:700;font-size:13px;">R$ ${Number(vd.proportionalValue || 0).toFixed(2)}</div>
      </div>`;
    }).join('');
    vacationHtml = `<section style="background:#f0f9ff;padding:10px 12px;border-left:3px solid #3b82f6;margin-bottom:16px;border-radius:2px;">
      <h3 style="font-size:13px;font-weight:700;margin-bottom:6px;">🏖️ Férias</h3>
      ${vacLines}
      ${prof.isVacationOnly ? '<p style="font-size:11px;color:#94a3b8;margin-top:8px;">Período sem aulas — pagamento exclusivo de férias</p>' : ''}
    </section>`;
  }

  const valorLiquido = (prof.valorTotal || 0) + (prof.vacationValue || 0);
  const unitName = (closing.unitName || closing.unitId || '').toString();

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Recibo</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; color: #111; background: #fff; font-size: 13px; line-height: 1.5; padding: 30px; max-width: 800px; margin: 0 auto; }
.header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 24px; }
.header h1 { margin: 0; font-size: 26px; letter-spacing: 1px; font-weight: 800; }
.header .sub { font-size: 13px; color: #444; margin-top: 4px; text-transform: uppercase; letter-spacing: 2px; }
.header .number { font-size: 15px; color: #000; margin-top: 4px; font-weight: 700; }
.info { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
.info-block { padding: 10px 12px; background: #f5f5f5; border-radius: 4px; }
.info-label { font-size: 9px; text-transform: uppercase; color: #888; letter-spacing: 0.5px; }
.info-value { font-weight: 600; font-size: 13px; margin-top: 2px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
table th, table td { border-bottom: 1px solid #e0e0e0; padding: 10px 8px; text-align: left; font-size: 12px; }
table th { background: #f0f0f0; font-weight: 700; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }
.text-right { text-align: right; }
.total { font-size: 22px; font-weight: 800; text-align: right; padding: 12px 16px; background: #000; color: #fff; border-radius: 4px; margin-top: 4px; }
.extenso { font-size: 11px; font-style: italic; color: #666; margin-top: 4px; text-align: right; }
.sig { margin-top: 60px; display: flex; justify-content: space-between; }
.sig-line { width: 260px; border-top: 1px solid #000; padding-top: 6px; text-align: center; font-size: 12px; }
.sig-line small { color: #888; font-size: 10px; }
.footer { text-align: center; font-size: 10px; color: #aaa; margin-top: 30px; }
</style></head><body>
<div class="header">
<h1>CrossTainer</h1>
<div class="sub">Recibo de Pagamento</div>
<div class="number">PRÉVIA · ${periodo}</div>
</div>
<div class="info">
<div class="info-block"><div class="info-label">Professor(a)</div><div class="info-value">${prof.teacherName || ''}</div></div>
<div class="info-block"><div class="info-label">Tipo de vínculo</div><div class="info-value">${typeLabel}</div></div>
<div class="info-block"><div class="info-label">CPF</div><div class="info-value">${prof.teacherCpf || '—'}</div></div>
<div class="info-block"><div class="info-label">Unidade</div><div class="info-value">${unitName}</div></div>
</div>
<table>
<thead><tr><th>Descrição</th><th class="text-right">Valor (R$)</th></tr></thead>
<tbody>
<tr><td>Horas trabalhadas (${horas}h)</td><td class="text-right">${valorHoras}</td></tr>
${(prof.mealAllowance || 0) > 0 ? `<tr><td>Vale Refeição (VR)</td><td class="text-right">${Number(prof.mealAllowance).toFixed(2)}</td></tr>` : ''}
${(prof.transportAllowance || 0) > 0 ? `<tr><td>Vale Transporte (VT)</td><td class="text-right">${Number(prof.transportAllowance).toFixed(2)}</td></tr>` : ''}
${(prof.otherBenefits || 0) > 0 ? `<tr><td>Outros Benefícios</td><td class="text-right">${Number(prof.otherBenefits).toFixed(2)}</td></tr>` : ''}
<tr><td><strong>Total bruto do fechamento</strong></td><td class="text-right"><strong>${valorTotalFechamento}</strong></td></tr>
</tbody>
</table>
${vacationHtml}
<div class="total">VALOR LÍQUIDO: R$ ${valorLiquido.toFixed(2)}</div>
<div class="sig">
<div class="sig-line">${prof.teacherName || ''}<br><small>Professor(a)</small></div>
<div class="sig-line">Administração<br><small>Emitido por</small></div>
</div>
<div class="footer">Gerado em ${new Date().toLocaleString('pt-BR')} · CrossTainer Sistema de Gestão · PRÉVIA — não substitui recibo emitido</div>
</body></html>`;
}

(async () => {
  const closingId = 'FIXTURE8_unit-cp_2026-04';
  const doc = await db.collection('monthly_closings').doc(closingId).get();
  if (!doc.exists) { console.log('Closing fixture não existe — rode fixture-8 antes.'); process.exit(1); }
  const closing = doc.data();

  const outDir = path.join(__dirname, '..', 'tmp-preview-recibos');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  closing.teachers.forEach((prof, i) => {
    const html = buildReceiptHtml(prof, closing);
    const fname = path.join(outDir, `recibo-${i + 1}-${prof.teacherName.replace(/\s+/g, '_')}.html`);
    fs.writeFileSync(fname, html);
    console.log(`OK ${fname}`);
  });

  console.log(`\n${closing.teachers.length} recibos HTML gerados em ${outDir}`);
  console.log('Abra o primeiro (recibo-1-...) no browser pra ver como vai ficar o PDF.');

  await admin.app().delete();
})();
