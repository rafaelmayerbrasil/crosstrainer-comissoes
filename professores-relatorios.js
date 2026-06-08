// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Módulo Professores · Relatórios e Exportações
// Sprint 8
// ═══════════════════════════════════════════════════════════════════════

'use strict';

/* ─── Helpers ───────────────────────────────────────────────────────── */

function formatCell(value, type) {
  if (value == null || value === '') return '—';
  if (type === 'currency') {
    return 'R$ ' + Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (type === 'number') {
    return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  return String(value);
}

/**
 * Sprint 9 fix: formatRowCell considera flags do row inteiro.
 * Se row.noSalaryData && col.type === 'currency' → "—" (não R$ 0,00).
 */
function formatRowCell(row, col) {
  if (row && row.noSalaryData && col.type === 'currency') {
    return '—';
  }
  return formatCell(row[col.key], col.type);
}

function formatFilters(filters) {
  if (!filters) return '';
  return Object.entries(filters)
    .filter(function(e) { return e[1] != null && e[1] !== ''; })
    .map(function(e) { return e[0] + ': ' + e[1]; })
    .join(' · ');
}

function sanitize(s) {
  return String(s || '').replace(/[^a-z0-9\-_]/gi, '_');
}

function downloadBlob(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 100);
}

/* ─── Export ────────────────────────────────────────────────────────── */

async function exportToExcel(report, fileName) {
  if (!window.XLSX) { toast('Biblioteca XLSX não carregou ainda.', 'error'); return; }

  var ws_data = [];

  // Linha 1: título
  ws_data.push([report.title]);
  // Linha 2: filtros aplicados
  ws_data.push([formatFilters(report.filters)]);
  // Linha 3: data de geração
  ws_data.push(['Gerado em ' + report.generatedAt.toLocaleString('pt-BR')]);
  // Linha 4: vazia
  ws_data.push([]);
  // Linha 5: cabeçalhos
  var cols = (report.columns || report.summaryColumns);
  ws_data.push(cols.map(function(c) { return c.label; }));
  // Linhas 6+: dados
  for (var i = 0; i < report.rows.length; i++) {
    var r = report.rows[i];
    ws_data.push(cols.map(function(c) {
      // Sprint 9 fix: noSalaryData → string "Sem cadastro" em vez do número 0
      if (r.noSalaryData && c.type === 'currency') return 'Sem cadastro';
      return r[c.key];
    }));
  }
  // Linha final: totais
  if (report.summary) {
    ws_data.push([]);
    var summaryRow = ['TOTAIS'];
    Object.values(report.summary).forEach(function(v) { summaryRow.push(v); });
    ws_data.push(summaryRow);
  }

  var ws = XLSX.utils.aoa_to_sheet(ws_data);

  // Aplicar formatação de moeda nas colunas marcadas
  cols.forEach(function(c, idx) {
    if (c.type === 'currency') {
      var colLetter = XLSX.utils.encode_col(idx);
      for (var r = 5; r < ws_data.length; r++) {
        var cellRef = colLetter + (r + 1);
        if (ws[cellRef]) ws[cellRef].z = '"R$ "#,##0.00';
      }
    }
    // Negrito nas colunas marcadas bold
    if (c.bold && report.rows.length > 0) {
      var colL = XLSX.utils.encode_col(idx);
      var lastRow = 5 + report.rows.length;
      var cellR = colL + lastRow;
      if (ws[cellR] && ws[cellR].v != null) {
        if (!ws[cellR].s) ws[cellR].s = {};
        ws[cellR].s.font = { bold: true };
      }
    }
  });

  // Larguras de coluna
  ws['!cols'] = cols.map(function(c) { return { wch: c.width || 15 }; });

  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dados');

  // Se tiver details (R3), adiciona sheet de detalhamento
  if (report.details) {
    var detailRows = [['Professor', 'Data', 'Modalidade', 'Horário', 'Minutos', 'Horas', 'Valor', 'Substituição']];
    Object.values(report.details).forEach(function(g) {
      g.details.forEach(function(d) {
        detailRows.push([
          g.teacherName, d.date, d.modalityName, d.startTime,
          d.durationMin, d.horas, d.valor, d.isSubstitution ? 'Sim' : 'Não'
        ]);
      });
    });
    var ws2 = XLSX.utils.aoa_to_sheet(detailRows);
    ws2['!cols'] = [{wch:30},{wch:14},{wch:20},{wch:8},{wch:10},{wch:8},{wch:14},{wch:12}];
    XLSX.utils.book_append_sheet(wb, ws2, 'Detalhamento');
  }

  XLSX.writeFile(wb, fileName || ('relatorio-' + Date.now() + '.xlsx'));

  await AuditService.log({
    type: 'report_exported',
    module: 'relatorios',
    details: 'Excel · ' + report.title + ' · ' + report.rows.length + ' linhas',
    after: { format: 'xlsx', filters: report.filters, rowCount: report.rows.length },
  });
}

async function exportToPdf(report, fileName) {
  if (!window.jspdf) { toast('Biblioteca PDF não carregou ainda.', 'error'); return; }
  var jsPDF = window.jspdf.jsPDF;

  var orientation = report.columns && report.columns.length > 8 ? 'landscape' : 'portrait';
  var doc = new jsPDF({ orientation: orientation, unit: 'mm', format: 'a4' });

  // Header CrossTainer ELITE
  doc.setFontSize(16); doc.setFont(undefined, 'bold');
  doc.text('CrossTainer ELITE', 14, 15);
  doc.setFontSize(10); doc.setFont(undefined, 'normal');
  doc.text('Módulo Professores · Relatório', 14, 21);

  // Título do relatório
  doc.setFontSize(13); doc.setFont(undefined, 'bold');
  doc.text(report.title, 14, 32);

  // Filtros aplicados + data
  doc.setFontSize(9); doc.setFont(undefined, 'normal');
  doc.text(formatFilters(report.filters), 14, 38);
  doc.text('Gerado em ' + report.generatedAt.toLocaleString('pt-BR'), 14, 43);

  // Colunas
  var cols = (report.columns || report.summaryColumns);
  // Tabela
  doc.autoTable({
    startY: 50,
    head: [cols.map(function(c) { return c.label; })],
    body: report.rows.map(function(r) {
      return cols.map(function(c) { return formatRowCell(r, c); });
    }),
    headStyles: { fillColor: [216, 124, 28], textColor: 255 },
    bodyStyles: { fontSize: 8 },
    styles: { cellPadding: 1.5, overflow: 'linebreak' },
    didDrawPage: function(data) {
      var pageHeight = doc.internal.pageSize.height;
      doc.setFontSize(8);
      doc.text('Página ' + data.pageNumber, 14, pageHeight - 5);
    },
  });

  // Resumo no rodapé
  if (report.summary) {
    var finalY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(10); doc.setFont(undefined, 'bold');
    doc.text('Totais:', 14, finalY);
    doc.setFont(undefined, 'normal');
    var keys = Object.keys(report.summary);
    keys.forEach(function(k, i) {
      var v = report.summary[k];
      // Sprint 8 fix: campos cujo nome começa com 'totalValor', 'totalGeral', 'totalVacationValue'
      // ou termina em 'Value' são monetários. Caso contrário, número simples (contagens, dias, horas).
      var isCurrency = /^total(Valor|Geral|VacationValue)|Value$/.test(k);
      var formatted;
      if (typeof v === 'number') {
        formatted = isCurrency ? formatCell(v, 'currency') : formatCell(v, 'number');
      } else {
        formatted = v;
      }
      doc.text(k + ': ' + formatted, 14, finalY + 6 + i * 5);
    });
  }

  doc.save(fileName || ('relatorio-' + Date.now() + '.pdf'));

  await AuditService.log({
    type: 'report_exported',
    module: 'relatorios',
    details: 'PDF · ' + report.title + ' · ' + report.rows.length + ' linhas',
    after: { format: 'pdf', filters: report.filters, rowCount: report.rows.length },
  });
}

/* ─── R4: Recibos em Lote (Sprint 9 fix: html2canvas pra paridade visual) ── */

async function exportRecibosLote(closingId, format, onProgress) {
  var dataRes = await ReportService.getRecibosLoteData(closingId);
  if (!dataRes.success) { toast(dataRes.error, 'error'); return; }
  var d = dataRes.data;
  var profs = d.profs;
  var closing = d.closing;

  // Sprint 9: usar html2canvas se disponível, fallback pro jsPDF programático
  var useHtml2canvas = !!window.html2canvas;
  if (!useHtml2canvas) {
    console.warn('[Sprint 9] html2canvas não disponível — usando jsPDF programático');
  }

  if (format === 'pdf-unico') {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    for (var i = 0; i < profs.length; i++) {
      if (i > 0) doc.addPage();
      if (useHtml2canvas) {
        var imgData = await renderReciboFromHtml(profs[i], closing);
        // A4 = 210x297mm. Imagem ocupa página inteira preservando margem
        doc.addImage(imgData, 'PNG', 0, 0, 210, 297);
      } else {
        renderReciboInPdf(doc, profs[i], closing);
      }
      if (onProgress) onProgress((i + 1) / profs.length, 'Gerando recibo ' + (i + 1) + '/' + profs.length);
      // Yield pro UI thread a cada 3 (html2canvas é mais pesado)
      if (i % 3 === 0) await sleep(0);
    }

    doc.save('recibos-' + closingId + '.pdf');
  } else if (format === 'zip') {
    var zip = new JSZip();

    for (var i = 0; i < profs.length; i++) {
      var jsPDF = window.jspdf.jsPDF;
      var doc2 = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      if (useHtml2canvas) {
        var imgData2 = await renderReciboFromHtml(profs[i], closing);
        doc2.addImage(imgData2, 'PNG', 0, 0, 210, 297);
      } else {
        renderReciboInPdf(doc2, profs[i], closing);
      }
      var blob = doc2.output('blob');
      zip.file(sanitize(profs[i].teacherName) + '-' + closingId + '.pdf', blob);
      if (onProgress) onProgress((i + 1) / profs.length, 'Empacotando recibo ' + (i + 1) + '/' + profs.length);
      if (i % 3 === 0) await sleep(0);
    }

    var zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, 'recibos-' + closingId + '.zip');
  }

  await AuditService.log({
    type: 'report_exported',
    module: 'relatorios',
    details: 'Recibos em lote · ' + profs.length + ' recibos · formato ' + format,
    after: { format: format, closingId: closingId, count: profs.length },
  });
}

/**
 * Sprint 9: renderiza recibo via HTML + html2canvas pra paridade visual com receipt.html.
 * Cria iframe oculto, injeta HTML estilizado, captura como imagem base64.
 */
async function renderReciboFromHtml(prof, closing) {
  if (!window.html2canvas) throw new Error('html2canvas não carregada');

  var iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:800px;height:1130px;border:none;background:#fff;';
  document.body.appendChild(iframe);

  var html = buildReceiptHtmlForExport(prof, closing);
  iframe.contentDocument.open();
  iframe.contentDocument.write(html);
  iframe.contentDocument.close();

  // Aguarda render
  await new Promise(function(resolve) { setTimeout(resolve, 150); });

  var canvas;
  try {
    canvas = await window.html2canvas(iframe.contentDocument.body, {
      scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff',
      width: 800, height: 1130,
    });
  } finally {
    document.body.removeChild(iframe);
  }

  return canvas.toDataURL('image/png');
}

/**
 * Monta HTML do recibo idêntico ao receipt.html (Sprint 4b), mas usando dados
 * do closing.teachers[] (não do receipts emitidos). CSS inline pra renderizar
 * em iframe isolado.
 */
function buildReceiptHtmlForExport(prof, closing) {
  var monthNames = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  var periodo = (monthNames[closing.month] || closing.month) + ' de ' + closing.year;
  var typeLabel = { efetivo: 'Efetivo(a)', estagiario: 'Estagiário(a)', eventual: 'Eventual' }[prof.teacherType] || (prof.teacherType || '');

  var horas = (prof.totalHoras || 0).toFixed(1);
  var valorHoras = Number(prof.valorHoras || 0).toFixed(2);
  var valorTotalFechamento = Number(prof.valorTotal || 0).toFixed(2);

  // Seção férias (Sprint 6b — se houver)
  var vacationHtml = '';
  if ((prof.vacationValue || 0) > 0 && Array.isArray(prof.vacationDetails) && prof.vacationDetails.length > 0) {
    var vacLines = prof.vacationDetails.map(function(vd) {
      var pStart = vd.periodStart && vd.periodStart.toDate ? vd.periodStart.toDate().toLocaleDateString('pt-BR') : '';
      var pEnd = vd.periodEnd && vd.periodEnd.toDate ? vd.periodEnd.toDate().toLocaleDateString('pt-BR') : '';
      var isAuto = vd.paymentMode === 'auto';
      var calcDetail = isAuto
        ? '<div style="font-size:11px;color:#475569;margin:2px 0 4px 0;">Base mensal: R$ ' + Number(vd.baseMonthly || 0).toFixed(2) +
          '<br>Proporcional: R$ ' + Number(vd.proportionalBase || 0).toFixed(2) + ' (' + vd.daysInMonth + '/30)' +
          '<br>1/3 constitucional: R$ ' + Number(vd.oneThirdValue || 0).toFixed(2) + '</div>'
        : '';
      return '<div style="margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #e0e0e0;">' +
        '<div style="font-weight:600;font-size:12px;">Período: ' + pStart + ' a ' + pEnd + ' (' + vd.daysInMonth + ' dias)</div>' +
        calcDetail +
        '<div style="text-align:right;font-weight:700;font-size:13px;">R$ ' + Number(vd.proportionalValue || 0).toFixed(2) + '</div>' +
        '</div>';
    }).join('');
    vacationHtml = '<section style="background:#f0f9ff;padding:10px 12px;border-left:3px solid #3b82f6;margin-bottom:16px;border-radius:2px;">' +
      '<h3 style="font-size:13px;font-weight:700;margin-bottom:6px;">🏖️ Férias</h3>' +
      vacLines +
      (prof.isVacationOnly ? '<p style="font-size:11px;color:#94a3b8;margin-top:8px;">Período sem aulas — pagamento exclusivo de férias</p>' : '') +
      '</section>';
  }

  // Total = valorTotal do fechamento + vacationValue
  var valorLiquido = (prof.valorTotal || 0) + (prof.vacationValue || 0);
  var extenso = numeroExtensoSimples(valorLiquido);

  var unitName = (closing.unitName || closing.unitId || '').toString();

  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Recibo</title>' +
    '<style>' +
    '* { box-sizing: border-box; margin: 0; padding: 0; }' +
    'body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; color: #111; background: #fff; font-size: 13px; line-height: 1.5; padding: 30px; }' +
    '.header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 24px; }' +
    '.header h1 { margin: 0; font-size: 26px; letter-spacing: 1px; font-weight: 800; }' +
    '.header .sub { font-size: 13px; color: #444; margin-top: 4px; text-transform: uppercase; letter-spacing: 2px; }' +
    '.header .number { font-size: 15px; color: #000; margin-top: 4px; font-weight: 700; }' +
    '.info { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }' +
    '.info-block { padding: 10px 12px; background: #f5f5f5; border-radius: 4px; }' +
    '.info-label { font-size: 9px; text-transform: uppercase; color: #888; letter-spacing: 0.5px; }' +
    '.info-value { font-weight: 600; font-size: 13px; margin-top: 2px; }' +
    'table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }' +
    'table th, table td { border-bottom: 1px solid #e0e0e0; padding: 10px 8px; text-align: left; font-size: 12px; }' +
    'table th { background: #f0f0f0; font-weight: 700; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }' +
    '.text-right { text-align: right; }' +
    '.total { font-size: 22px; font-weight: 800; text-align: right; padding: 12px 16px; background: #000; color: #fff; border-radius: 4px; margin-top: 4px; }' +
    '.extenso { font-size: 11px; font-style: italic; color: #666; margin-top: 4px; text-align: right; }' +
    '.sig { margin-top: 60px; display: flex; justify-content: space-between; }' +
    '.sig-line { width: 260px; border-top: 1px solid #000; padding-top: 6px; text-align: center; font-size: 12px; }' +
    '.sig-line small { color: #888; font-size: 10px; }' +
    '.footer { text-align: center; font-size: 10px; color: #aaa; margin-top: 30px; }' +
    '</style></head><body>' +
    '<div class="header">' +
    '<h1>CrossTainer</h1>' +
    '<div class="sub">Recibo de Pagamento</div>' +
    '<div class="number">PRÉVIA · ' + periodo + '</div>' +
    '</div>' +
    '<div class="info">' +
    '<div class="info-block"><div class="info-label">Professor(a)</div><div class="info-value">' + (prof.teacherName || '') + '</div></div>' +
    '<div class="info-block"><div class="info-label">Tipo de vínculo</div><div class="info-value">' + typeLabel + '</div></div>' +
    '<div class="info-block"><div class="info-label">CPF</div><div class="info-value">' + (prof.teacherCpf || '—') + '</div></div>' +
    '<div class="info-block"><div class="info-label">Unidade</div><div class="info-value">' + unitName + '</div></div>' +
    '</div>' +
    '<table>' +
    '<thead><tr><th>Descrição</th><th class="text-right">Valor (R$)</th></tr></thead>' +
    '<tbody>' +
    '<tr><td>Horas trabalhadas (' + horas + 'h)</td><td class="text-right">' + valorHoras + '</td></tr>' +
    ((prof.mealAllowance || 0) > 0 ? '<tr><td>Vale Refeição (VR)</td><td class="text-right">' + Number(prof.mealAllowance).toFixed(2) + '</td></tr>' : '') +
    ((prof.transportAllowance || 0) > 0 ? '<tr><td>Vale Transporte (VT)</td><td class="text-right">' + Number(prof.transportAllowance).toFixed(2) + '</td></tr>' : '') +
    ((prof.otherBenefits || 0) > 0 ? '<tr><td>Outros Benefícios</td><td class="text-right">' + Number(prof.otherBenefits).toFixed(2) + '</td></tr>' : '') +
    '<tr><td><strong>Total bruto do fechamento</strong></td><td class="text-right"><strong>' + valorTotalFechamento + '</strong></td></tr>' +
    '</tbody>' +
    '</table>' +
    vacationHtml +
    '<div class="total">VALOR LÍQUIDO: R$ ' + valorLiquido.toFixed(2) + '</div>' +
    '<div class="extenso">' + extenso + '</div>' +
    '<div class="sig">' +
    '<div class="sig-line">' + (prof.teacherName || '') + '<br><small>Professor(a)</small></div>' +
    '<div class="sig-line">Administração<br><small>Emitido por</small></div>' +
    '</div>' +
    '<div class="footer">Gerado em ' + new Date().toLocaleString('pt-BR') + ' · CrossTainer Sistema de Gestão · PRÉVIA — não substitui recibo emitido</div>' +
    '</body></html>';
}

/** Valor por extenso simplificado para o recibo lote (espelha receipt.html). */
function numeroExtensoSimples(valor) {
  if (!valor || valor === 0) return 'Zero reais';
  var inteiro = Math.floor(valor);
  var centavos = Math.round((valor - inteiro) * 100);
  var u = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
    'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  var d = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  var c = ['', 'cem', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  function centena(n) {
    if (n === 0) return '';
    if (n === 100) return 'cem';
    if (n < 20) return u[n];
    if (n < 100) { var dz = Math.floor(n / 10), uu = n % 10; return d[dz] + (uu ? ' e ' + u[uu] : ''); }
    var ct = Math.floor(n / 100), resto = n % 100; var r = c[ct]; if (resto === 0) return r; return r + ' e ' + centena(resto);
  }
  function milhar(n) {
    if (n < 1000) return centena(n);
    var m = Math.floor(n / 1000), resto = n % 1000;
    var mMil = m === 1 ? 'mil' : centena(m) + ' mil';
    if (resto === 0) return mMil;
    return mMil + (resto < 100 ? ' e ' : ' ') + centena(resto);
  }
  var ext = milhar(inteiro);
  ext = ext.charAt(0).toUpperCase() + ext.slice(1);
  ext += inteiro === 1 ? ' real' : ' reais';
  if (centavos > 0) ext += ' e ' + centena(centavos) + (centavos === 1 ? ' centavo' : ' centavos');
  return ext;
}

function renderReciboInPdf(doc, prof, closing) {
  var monthLabel = String(closing.month).padStart(2, '0') + '/' + closing.year;

  // Header
  doc.setFontSize(14); doc.setFont(undefined, 'bold');
  doc.text('Recibo de Pagamento', 14, 20);
  doc.setFontSize(10); doc.setFont(undefined, 'normal');
  doc.text('CrossTainer ELITE — Módulo Professores', 14, 28);
  doc.text('Competência: ' + monthLabel, 14, 36);
  doc.text('Unidade: ' + (closing.unitId || '—'), 14, 42);

  // Linha separadora
  doc.setDrawColor(216, 124, 28);
  doc.line(14, 46, 196, 46);

  // Dados do professor
  doc.setFontSize(12); doc.setFont(undefined, 'bold');
  doc.text(prof.teacherName || '—', 14, 54);
  doc.setFontSize(10); doc.setFont(undefined, 'normal');
  doc.text('Tipo: ' + (prof.teacherType || '—'), 14, 60);
  doc.text('Aulas: ' + (prof.classesCount || 0) + ' · Horas: ' + (prof.totalHoras || 0).toFixed(1), 14, 66);

  // Tabela de valores
  var rows = [];
  if (prof.valorHoras > 0) rows.push(['Valor Horas', formatCell(prof.valorHoras, 'currency')]);
  if (prof.mealAllowance > 0) rows.push(['Vale Refeição (VR)', formatCell(prof.mealAllowance, 'currency')]);
  if (prof.transportAllowance > 0) rows.push(['Vale Transporte (VT)', formatCell(prof.transportAllowance, 'currency')]);
  if (prof.otherBenefits > 0) rows.push(['Outros Benefícios', formatCell(prof.otherBenefits, 'currency')]);
  if (prof.vacationValue > 0) rows.push(['Férias (1/3)', formatCell(prof.vacationValue, 'currency')]);

  if (rows.length > 0) {
    doc.autoTable({
      startY: 72,
      body: rows,
      headStyles: {},
      bodyStyles: { fontSize: 10 },
      styles: { cellPadding: 2 },
      columnStyles: { 0: { cellWidth: 60, fontStyle: 'bold' }, 1: { cellWidth: 40, halign: 'right' } },
    });
  }

  // Total
  var finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : 80;
  doc.setFontSize(12); doc.setFont(undefined, 'bold');
  var total = (prof.valorTotal || 0) + (prof.vacationValue || 0);
  doc.text('Total: ' + formatCell(total, 'currency'), 14, finalY);

  // Data e assinatura
  doc.setFontSize(9); doc.setFont(undefined, 'normal');
  var pageHeight = doc.internal.pageSize.height;
  doc.text('Gerado em ' + new Date().toLocaleDateString('pt-BR'), 14, pageHeight - 30);
  doc.line(14, pageHeight - 15, 80, pageHeight - 15);
  doc.text('Assinatura', 14, pageHeight - 10);
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

/* ─── Renderização da Página ─────────────────────────────────────────── */

var _filtrosState = {};

async function renderRelatoriosPage() {
  var container = document.getElementById('page-relatorios');
  if (!container) return;

  // Garante lazy loading das bibliotecas
  var libsReady = await ensureReportLibsLoaded();
  if (!libsReady) {
    container.innerHTML = '<div class="error">Falha ao carregar bibliotecas de exportação. Recarregue a página.</div>';
    return;
  }

  container.innerHTML = `
    <div class="page-hdr">
      <h1>📊 Relatórios e Exportações</h1>
      <p>Exporte dados do módulo Professores em Excel (.xlsx) ou PDF.</p>
    </div>

    <div class="report-grid">
      ${renderReportCard('R1', '💰 Fechamentos Mensais',
        'Consolidado financeiro por unidade e período. Inclui horas, benefícios e férias.', renderFechamentosSection)}
      ${renderReportCard('R2', '🏖️ Saldos de Férias',
        'Saldo de férias por professor, período aquisitivo CLT, status e dias restantes.', renderSaldosFeriasSection)}
      ${renderReportCard('R3', '⏱️ Horas por Professor',
        'Detalhamento de aulas, horas e valores por professor em um período customizado.', renderHorasProfessorSection)}
      ${renderReportCard('R4', '📋 Recibos em Lote',
        'Exporta recibos de um fechamento completo em PDF único ou ZIP com PDFs individuais.', renderRecibosLoteSection)}
    </div>
  `;

  // Renderiza cada seção de filtro
  await renderFechamentosSection();
  await renderSaldosFeriasSection();
  await renderHorasProfessorSection();
  await renderRecibosLoteSection();
}

function renderReportCard(id, title, desc, renderFn) {
  return `
    <div class="report-card" id="report-card-${id}">
      <h3>${title}</h3>
      <p>${desc}</p>
      <div class="report-filters" id="report-filters-${id}"></div>
      <div class="report-preview" id="report-preview-${id}"></div>
    </div>
  `;
}

/* ─── R1: Fechamentos Mensais ────────────────────────────────────────── */

async function renderFechamentosSection() {
  var filtersDiv = document.getElementById('report-filters-R1');
  if (!filtersDiv) return;

  var unitsSnap = await db.collection('units').get();
  var units = unitsSnap.docs.map(function(d) { return { id: d.id, name: d.data().name || d.id }; });

  var now = new Date();
  var currentYear = now.getFullYear();
  var currentMonth = now.getMonth() + 1;

  filtersDiv.innerHTML = `
    <div class="filter-row">
      <div class="filter-group">
        <label>Unidade</label>
        <select id="r1-unit" class="input">${units.map(function(u) { return '<option value="' + u.id + '">' + escapeHtml(u.name) + '</option>'; }).join('')}</select>
      </div>
      <div class="filter-group">
        <label>Ano Início</label>
        <select id="r1-yearMin" class="input" style="width:100px;">
          ${[2024,2025,2026,2027,2028].map(function(y) { return '<option ' + (y === currentYear ? 'selected' : '') + '>' + y + '</option>'; }).join('')}
        </select>
      </div>
      <div class="filter-group">
        <label>Mês Início</label>
        <select id="r1-monthMin" class="input" style="width:80px;">
          ${['Todos',1,2,3,4,5,6,7,8,9,10,11,12].map(function(m) { return '<option value="' + (m === 'Todos' ? '' : m) + '">' + (m === 'Todos' ? 'Todos' : String(m).padStart(2,'0')) + '</option>'; }).join('')}
        </select>
      </div>
      <div class="filter-group">
        <label>Ano Fim</label>
        <select id="r1-yearMax" class="input" style="width:100px;">
          ${[2024,2025,2026,2027,2028].map(function(y) { return '<option ' + (y === currentYear ? 'selected' : '') + '>' + y + '</option>'; }).join('')}
        </select>
      </div>
      <div class="filter-group">
        <label>Mês Fim</label>
        <select id="r1-monthMax" class="input" style="width:80px;">
          ${['Todos',1,2,3,4,5,6,7,8,9,10,11,12].map(function(m) { return '<option value="' + (m === 'Todos' ? '' : m) + '">' + (m === 'Todos' ? 'Todos' : String(m).padStart(2,'0')) + '</option>'; }).join('')}
        </select>
      </div>
      <button class="btn-primary" onclick="executarRelatorio('R1')" style="align-self:flex-end;">🔍 Buscar</button>
    </div>
  `;
}

/* ─── R2: Saldos de Férias ───────────────────────────────────────────── */

async function renderSaldosFeriasSection() {
  var filtersDiv = document.getElementById('report-filters-R2');
  if (!filtersDiv) return;

  var unitsSnap = await db.collection('units').get();
  var units = unitsSnap.docs.map(function(d) { return { id: d.id, name: d.data().name || d.id }; });

  filtersDiv.innerHTML = `
    <div class="filter-row">
      <div class="filter-group">
        <label>Unidade</label>
        <select id="r2-unit" class="input">
          <option value="">Todas</option>
          ${units.map(function(u) { return '<option value="' + u.id + '">' + escapeHtml(u.name) + '</option>'; }).join('')}
        </select>
      </div>
      <div class="filter-group">
        <label>Tipo</label>
        <select id="r2-type" class="input">
          <option value="">Todos</option>
          <option value="efetivo">Efetivo</option>
          <option value="estagiario">Estagiário</option>
        </select>
      </div>
      <div class="filter-group">
        <label>Status</label>
        <select id="r2-status" class="input">
          <option value="todos">Todos</option>
          <option value="ok">OK</option>
          <option value="warning">Vencendo</option>
          <option value="overdue">VENCIDA</option>
        </select>
      </div>
      <button class="btn-primary" onclick="executarRelatorio('R2')" style="align-self:flex-end;">🔍 Buscar</button>
    </div>
  `;
}

/* ─── R3: Horas por Professor ────────────────────────────────────────── */

async function renderHorasProfessorSection() {
  var filtersDiv = document.getElementById('report-filters-R3');
  if (!filtersDiv) return;

  var unitsSnap = await db.collection('units').get();
  var units = unitsSnap.docs.map(function(d) { return { id: d.id, name: d.data().name || d.id }; });
  var teachersSnap = await db.collection('teachers').where('isActive', '==', true).get();
  var teachers = teachersSnap.docs.map(function(d) { return { id: d.id, name: d.data().name, type: d.data().type }; });

  filtersDiv.innerHTML = `
    <div class="filter-row">
      <div class="filter-group">
        <label>Unidade</label>
        <select id="r3-unit" class="input">
          <option value="">Todas</option>
          ${units.map(function(u) { return '<option value="' + u.id + '">' + escapeHtml(u.name) + '</option>'; }).join('')}
        </select>
      </div>
      <div class="filter-group">
        <label>Professor</label>
        <select id="r3-teacher" class="input">
          <option value="">Todos</option>
          ${teachers.filter(function(t) { return t.type !== 'eventual'; }).map(function(t) { return '<option value="' + t.id + '">' + escapeHtml(t.name) + ' (' + t.type + ')</option>'; }).join('')}
        </select>
      </div>
      <div class="filter-group">
        <label>Data Início</label>
        <input type="date" id="r3-dateStart" class="input" style="width:140px;" value="${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-01">
      </div>
      <div class="filter-group">
        <label>Data Fim</label>
        <input type="date" id="r3-dateEnd" class="input" style="width:140px;" value="${new Date().toISOString().slice(0,10)}">
      </div>
      <button class="btn-primary" onclick="executarRelatorio('R3')" style="align-self:flex-end;">🔍 Buscar</button>
    </div>
  `;
}

/* ─── R4: Recibos em Lote ────────────────────────────────────────────── */

async function renderRecibosLoteSection() {
  var filtersDiv = document.getElementById('report-filters-R4');
  if (!filtersDiv) return;

  var closingsSnap = await db.collection('monthly_closings').where('status', '==', 'fechado').limit(50).get();
  var closings = closingsSnap.docs.map(function(d) {
    var c = d.data();
    return { id: d.id, unitId: c.unitId, month: c.month, year: c.year,
      label: (c.unitId || '?') + ' — ' + String(c.month).padStart(2,'0') + '/' + c.year + ' (' + (c.teachers || []).length + ' profs)' };
  }).sort(function(a, b) { return (b.year*12+b.month) - (a.year*12+a.month); });

  filtersDiv.innerHTML = `
    <div class="filter-row">
      <div class="filter-group" style="flex:2;">
        <label>Fechamento</label>
        <select id="r4-closing" class="input">
          <option value="">Selecione um fechamento...</option>
          ${closings.map(function(c) { return '<option value="' + c.id + '">' + escapeHtml(c.label) + '</option>'; }).join('')}
        </select>
      </div>
      <button class="btn-primary" onclick="executarRelatorio('R4')" style="align-self:flex-end;">🔍 Buscar</button>
    </div>
  `;
}

/* ─── Executar relatório ─────────────────────────────────────────────── */

async function executarRelatorio(relId) {
  var previewDiv = document.getElementById('report-preview-' + relId);
  if (!previewDiv) return;

  previewDiv.innerHTML = '<div class="preview-loader">Carregando...</div>';

  var report;
  if (relId === 'R1') {
    var filters = {
      unitId: getVal('r1-unit'),
      yearMin: parseInt(getVal('r1-yearMin')) || new Date().getFullYear(),
      monthMin: parseInt(getVal('r1-monthMin')) || undefined,
      yearMax: parseInt(getVal('r1-yearMax')) || undefined,
      monthMax: parseInt(getVal('r1-monthMax')) || undefined,
    };
    report = await ReportService.getFechamentosReport(filters);
    _filtrosState.R1 = filters;
  } else if (relId === 'R2') {
    var filters = {
      unitId: getVal('r2-unit') || undefined,
      teacherType: getVal('r2-type') || undefined,
      statusFilter: getVal('r2-status') || 'todos',
    };
    report = await ReportService.getSaldosFeriasReport(filters);
    _filtrosState.R2 = filters;
  } else if (relId === 'R3') {
    var filters = {
      unitId: getVal('r3-unit') || undefined,
      teacherId: getVal('r3-teacher') || undefined,
      dateStart: getVal('r3-dateStart'),
      dateEnd: getVal('r3-dateEnd'),
    };
    report = await ReportService.getHorasPorProfessorReport(filters);
    _filtrosState.R3 = filters;
  } else if (relId === 'R4') {
    var closingId = getVal('r4-closing');
    if (!closingId) {
      previewDiv.innerHTML = '<div class="error">Selecione um fechamento.</div>';
      return;
    }
    report = await ReportService.getRecibosLoteData(closingId);
    _filtrosState.R4 = { closingId: closingId };
  }

  if (!report || !report.success) {
    previewDiv.innerHTML = '<div class="error">' + escapeHtml((report && report.error) || 'Erro desconhecido') + '</div>';
    return;
  }

  var d = report.data;
  var cols = (d.columns || d.summaryColumns);
  var rowCount = d.rows.length;

  // Limite de tamanho
  var sizeWarning = '';
  if (rowCount > 5000) {
    sizeWarning = '<div class="alert-warning-card">⚠️ Relatório grande (' + rowCount + ' linhas) — exportação pode demorar.</div>';
  }

  var tableHtml = '';
  if (rowCount > 0) {
    tableHtml = `
      <div class="table-wrap" style="max-height:400px;overflow:auto;">
        <table>
          <thead><tr>${cols.map(function(c) { return '<th>' + c.label + '</th>'; }).join('')}</tr></thead>
          <tbody>
            ${d.rows.slice(0, 100).map(function(r) {
              return '<tr>' + cols.map(function(c) {
                var formatted = formatRowCell(r, c);
                var title = (r.noSalaryData && c.type === 'currency') ? ' title="Cadastro salarial incompleto"' : '';
                return '<td' + title + '>' + formatted + '</td>';
              }).join('') + '</tr>';
            }).join('')}
            ${rowCount > 100 ? '<tr><td colspan="' + cols.length + '" style="text-align:center;color:var(--text2);">+ ' + (rowCount - 100) + ' linhas (exporte pra ver tudo)</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    `;
  }

  // Botões específicos pra R4
  var botoes = '';
  if (relId === 'R4') {
    botoes = `
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="btn-primary" onclick="exportarRecibosLote('pdf-unico')">📄 PDF único</button>
        <button class="btn-primary" onclick="exportarRecibosLote('zip')">📦 ZIP</button>
      </div>
      <div id="r4-progress" style="margin-top:8px;"></div>
    `;
  } else {
    botoes = `
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="btn-primary" onclick="exportarRelatorio('${relId}', 'xlsx')">📥 Excel</button>
        <button class="btn-primary" onclick="exportarRelatorio('${relId}', 'pdf')">📄 PDF</button>
      </div>
    `;
  }

  previewDiv.innerHTML = `
    ${sizeWarning}
    <div style="font-size:13px;color:var(--text2);margin-bottom:8px;">
      ${d.title} · ${rowCount} linhas · ${d.generatedAt.toLocaleString('pt-BR')}
    </div>
    ${tableHtml}
    ${botoes}
  `;

  // Guarda report data pra exportação
  window['_reportData_' + relId] = d;
}

/* ─── Exportação a partir dos botões ─────────────────────────────────── */

async function exportarRelatorio(relId, format) {
  var data = window['_reportData_' + relId];
  if (!data) { toast('Execute a busca primeiro.', 'error'); return; }
  var filtroMap = { R1: 'fechamentos', R2: 'saldos-ferias', R3: 'horas-professor', R4: 'recibos' };
  var name = (filtroMap[relId] || 'relatorio') + '-' + Date.now();
  if (format === 'xlsx') {
    await exportToExcel(data, name + '.xlsx');
  } else {
    await exportToPdf(data, name + '.pdf');
  }
}

async function exportarRecibosLote(format) {
  var closingId = getVal('r4-closing');
  if (!closingId) { toast('Selecione um fechamento.', 'error'); return; }

  var progressDiv = document.getElementById('r4-progress');
  await exportRecibosLote(closingId, format, function(prog, msg) {
    if (progressDiv) {
      progressDiv.innerHTML = '<div class="progress-bar"><div class="progress-fill" style="width:' + Math.round(prog * 100) + '%;"></div></div><div style="font-size:12px;color:var(--text2);">' + msg + '</div>';
    }
  });
  if (progressDiv) progressDiv.innerHTML = '';
  toast('Exportação concluída!', 'success');
}

function getVal(id) {
  var el = document.getElementById(id);
  return el ? el.value : null;
}

/* ─── Lazy loading ───────────────────────────────────────────────────── */

async function ensureReportLibsLoaded() {
  // Sprint 9: tenta local (vendor/) primeiro, CDN como fallback.
  // jspdf-autotable depende de jsPDF — carrega após jsPDF estar pronto.

  function loadScript(url) {
    return new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      script.src = url;
      script.onload = resolve;
      script.onerror = function() { reject(new Error('Falha ao carregar: ' + url)); };
      document.head.appendChild(script);
    });
  }

  async function loadWithFallback(localPath, cdnUrl, sentinel) {
    if (sentinel && window[sentinel]) return true;
    try {
      await loadScript(localPath);
      if (sentinel && window[sentinel]) return true;
    } catch (e) {
      console.warn('[Sprint 9] Local falhou (' + localPath + '), tentando CDN...');
    }
    try {
      await loadScript(cdnUrl);
      return true;
    } catch (e2) {
      console.error('[Sprint 9] CDN também falhou: ' + cdnUrl);
      return false;
    }
  }

  try {
    // Grupo 1: jsPDF + XLSX + JSZip em paralelo (local → CDN)
    var ok1 = true;
    if (!window.jspdf) ok1 = await loadWithFallback('vendor/jspdf.umd.min.js', 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js', null) && ok1;
    if (!window.XLSX)  ok1 = await loadWithFallback('vendor/xlsx.full.min.js', 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', 'XLSX') && ok1;
    if (!window.JSZip) ok1 = await loadWithFallback('vendor/jszip.min.js', 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'JSZip') && ok1;
    if (!window.html2canvas) ok1 = await loadWithFallback('vendor/html2canvas.min.js', 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js', 'html2canvas') && ok1;

    // Grupo 2: autotable APÓS jsPDF (depende dele)
    if (ok1 && window.jspdf && window.jspdf.jsPDF && !window.jspdf.jsPDF.API.autoTable) {
      ok1 = await loadWithFallback('vendor/jspdf.plugin.autotable.min.js', 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.0/dist/jspdf.plugin.autotable.min.js', null) && ok1;
    }

    // Sanity check final
    var ok = !!(window.jspdf && window.jspdf.jsPDF && window.XLSX && window.JSZip && window.html2canvas);
    var hasAutotable = window.jspdf && window.jspdf.jsPDF && typeof window.jspdf.jsPDF.API.autoTable === 'function';
    if (!ok || !hasAutotable) {
      console.error('[Sprint 9] Libs não carregadas:', {
        jspdf: !!window.jspdf, xlsx: !!window.XLSX, jszip: !!window.JSZip,
        html2canvas: !!window.html2canvas, autotable: hasAutotable,
      });
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Sprint 9]', err);
    return false;
  }
}

// Expor globalmente
window.renderRelatoriosPage = renderRelatoriosPage;
window.executarRelatorio = executarRelatorio;
window.exportarRelatorio = exportarRelatorio;
window.exportarRecibosLote = exportarRecibosLote;
window.exportToExcel = exportToExcel;
window.exportToPdf = exportToPdf;
window.ensureReportLibsLoaded = ensureReportLibsLoaded;

console.log('[CrossTainer Professores] professores-relatorios.js carregado · Sprint 8');
