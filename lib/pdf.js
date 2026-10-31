const PDFDocument = require('pdfkit');

// A single, reusable "report" renderer so every PDF in the app (finance,
// attendance, membership...) looks and behaves the same way rather than
// each route hand-rolling its own layout. Streams straight to the response
// - nothing is ever written to disk.
//
//   renderTableReport(res, {
//     title, subtitle, generatedBy,
//     columns: [{ key, label, width, align }],
//     rows: [{...}],
//     summary: [{ label, value }],   // optional totals block under the table
//     filename
//   })
function renderTableReport(res, opts) {
  const { title, subtitle, columns, rows, summary, filename, generatedBy } = opts;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename || 'report.pdf'}"`);

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(res);

  doc.fontSize(18).fillColor('#07102A').text(title || 'ACONSU Report', { align: 'left' });
  if (subtitle) doc.fontSize(10).fillColor('#3B486D').text(subtitle);
  doc.fontSize(8).fillColor('#6B7590').text(
    `Generated ${new Date().toLocaleString('en-GB')}${generatedBy ? ` by ${generatedBy}` : ''}`
  );
  doc.moveDown(1);

  const tableTop = doc.y;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const cols = columns || [];
  const totalWeight = cols.reduce((s, c) => s + (c.width || 1), 0) || 1;
  const colWidths = cols.map((c) => (pageWidth * (c.width || 1)) / totalWeight);

  function drawRow(y, cells, opts2) {
    const isHeader = !!(opts2 && opts2.header);
    doc.fontSize(isHeader ? 9 : 9).fillColor(isHeader ? '#ffffff' : '#090D16');
    if (isHeader) {
      doc.rect(doc.page.margins.left, y - 3, pageWidth, 20).fill('#0B1A43');
      doc.fillColor('#ffffff');
    }
    let x = doc.page.margins.left;
    cells.forEach((text, i) => {
      doc.text(String(text === undefined || text === null ? '' : text), x + 4, y, {
        width: colWidths[i] - 8,
        align: (cols[i] && cols[i].align) || 'left'
      });
      x += colWidths[i];
    });
  }

  let y = tableTop;
  drawRow(y, cols.map((c) => c.label), { header: true });
  y += 20;

  (rows || []).forEach((row, i) => {
    if (y > doc.page.height - doc.page.margins.bottom - 60) {
      doc.addPage();
      y = doc.page.margins.top;
      drawRow(y, cols.map((c) => c.label), { header: true });
      y += 20;
    }
    if (i % 2 === 1) {
      doc.rect(doc.page.margins.left, y - 3, pageWidth, 18).fill('#F3F5FB');
    }
    drawRow(y, cols.map((c) => row[c.key]));
    y += 18;
  });

  if (!rows || !rows.length) {
    doc.fontSize(10).fillColor('#6B7590').text('No records for this report.', doc.page.margins.left, y + 6);
    y += 24;
  }

  if (summary && summary.length) {
    y += 14;
    doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).strokeColor('#E5E9F3').stroke();
    y += 10;
    summary.forEach((s) => {
      doc.fontSize(10).fillColor('#090D16').text(`${s.label}: `, doc.page.margins.left, y, { continued: true })
        .fillColor('#0B1A43').text(String(s.value));
      y += 16;
    });
  }

  doc.end();
}

module.exports = { renderTableReport };
