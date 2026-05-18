const fs = require('fs');
const PDFDocument = require('pdfkit');

function money(value) {
  return Number(value || 0).toFixed(2);
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function deriveVoucherType(entry) {
  if (entry.source_type === 'OPENING_BALANCE' || entry.source_type === 'BROUGHT_FORWARD') return 'OPEN';
  if (entry.source_type === 'INVOICE') return entry.meta?.kind === 'CREDIT_NOTE' ? 'CN' : entry.meta?.kind === 'DEBIT_NOTE' ? 'DN' : 'INV';
  if (entry.source_type === 'PAYMENT_RECEIVED') return entry.meta?.method ? `${String(entry.meta.method).slice(0, 3)}`.toUpperCase() : 'PAY';
  if (entry.source_type === 'PURCHASE') return 'PUR';
  if (entry.source_type === 'PURCHASE_PAYMENT') return entry.meta?.method ? `${String(entry.meta.method).slice(0, 3)}`.toUpperCase() : 'PPY';
  if (entry.source_type === 'PURCHASE_ADVANCE') return 'ADV';
  if (entry.source_type === 'VOUCHER') {
    const vt = String(entry.meta?.voucher_type || '').toUpperCase();
    if (vt === 'GENERAL') return 'JV';
    if (vt === 'DEBIT_NOTE') return 'DN';
    if (vt === 'CREDIT_NOTE') return 'CN';
    if (vt === 'OPENING') return 'OPN';
    return vt || 'VCH';
  }
  return String(entry.source_type || '').slice(0, 4).toUpperCase();
}

function deriveRemark(entry) {
  if (entry.source_type === 'OPENING_BALANCE' || entry.source_type === 'BROUGHT_FORWARD') return 'OPENING BALANCE';
  return entry.meta?.description || entry.meta?.reference || entry.meta?.account_name || '';
}

function drawTableHeader(doc, x, y, widths) {
  const headers = ['Date', 'Particulars', 'Vch-Type', 'Vch-No.', 'Remark', 'Debit', 'Credit', 'Closing Balance'];
  doc.save();
  doc.rect(x, y, widths.reduce((a, b) => a + b, 0), 20).fill('#eef5e5').stroke('#9ab36f');
  doc.restore();
  let cx = x;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#243b1a');
  headers.forEach((header, idx) => {
    doc.text(header, cx + 3, y + 6, {
      width: widths[idx] - 6,
      align: idx >= 5 ? 'right' : 'left'
    });
    cx += widths[idx];
    if (idx < headers.length - 1) {
      doc.moveTo(cx, y).lineTo(cx, y + 20).strokeColor('#b7c99a').stroke();
    }
  });
  return y + 20;
}

function drawLedgerPageHeader(doc, ledger, pageNo) {
  const title = 'Ledger Detail';
  const partyLine = `A/c ${ledger.client.company_name || ''}`;
  const from = ledger.filters?.date_from ? formatDate(ledger.filters.date_from) : '';
  const to = ledger.filters?.date_to ? formatDate(ledger.filters.date_to) : '';
  const periodLine = from && to ? `${from} To ${to}` : '';

  doc.font('Helvetica-Bold').fontSize(16).fillColor('#244b84').text(title, 0, 20, { align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor('#111');
  doc.text(partyLine, 28, 28, { width: 280, align: 'left' });
  if (periodLine) doc.text(periodLine, doc.page.width - doc.page.margins.right - 220, 28, { width: 220, align: 'right' });

  const clientInfo = [];
  if (ledger.client.gstin) clientInfo.push(`GSTIN: ${ledger.client.gstin}`);
  if (ledger.client.address) clientInfo.push(`Address: ${ledger.client.address}`);
  if (clientInfo.length) {
    doc.font('Helvetica').fontSize(8.5).fillColor('#333');
    doc.text(clientInfo.join('  |  '), 28, 46, { width: doc.page.width - 56, align: 'left' });
  }

  doc.strokeColor('#8faadc').lineWidth(1);
  doc.moveTo(28, 60).lineTo(doc.page.width - 28, 60).stroke();
  doc.font('Helvetica').fontSize(8).fillColor('#666').text(`Page ${pageNo}`, doc.page.width - 80, 66, { width: 52, align: 'right' });

  return 82;
}

async function generateClientLedgerPdfToFile({ ledger, outPath }) {
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);

    const x = 28;
    const widths = [58, 170, 56, 72, 145, 78, 78, 95];
    const tableWidth = widths.reduce((a, b) => a + b, 0);
    let pageNo = 1;
    let y = drawLedgerPageHeader(doc, ledger, pageNo);
    y = drawTableHeader(doc, x, y, widths) + 2;

    const ensureSpace = (requiredHeight) => {
      const bottomY = doc.page.height - doc.page.margins.bottom - 18;
      if (y + requiredHeight <= bottomY) return;
      doc.addPage({ size: 'A4', layout: 'landscape', margin: 28 });
      pageNo += 1;
      y = drawLedgerPageHeader(doc, ledger, pageNo);
      y = drawTableHeader(doc, x, y, widths) + 2;
    };

    const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
    doc.fontSize(8.5).font('Helvetica');

    for (const entry of entries) {
      const cells = [
        formatDate(entry.date),
        entry.particulars || entry.source_type || '',
        deriveVoucherType(entry),
        entry.reference_no || '',
        deriveRemark(entry),
        entry.debit ? money(entry.debit) : '',
        entry.credit ? money(entry.credit) : '',
        `${money(entry.running_balance_amount)}${entry.running_balance_side && entry.running_balance_side !== 'BALANCED' ? ` ${entry.running_balance_side}` : ''}`.trim()
      ];

      const rowHeight = Math.max(
        20,
        doc.heightOfString(cells[1], { width: widths[1] - 6 }) + 6,
        doc.heightOfString(cells[4], { width: widths[4] - 6 }) + 6
      );
      ensureSpace(rowHeight + 2);

      const isOpening = entry.source_type === 'OPENING_BALANCE' || entry.source_type === 'BROUGHT_FORWARD';
      if (isOpening) {
        doc.save();
        doc.rect(x, y - 1, tableWidth, rowHeight + 2).fill('#f3f8ff');
        doc.restore();
      }

      let cx = x;
      const aligns = ['left', 'left', 'left', 'left', 'left', 'right', 'right', 'right'];
      for (let i = 0; i < widths.length; i += 1) {
        doc.fillColor(isOpening && i === 1 ? '#234a8b' : '#111')
          .font(isOpening && i === 1 ? 'Helvetica-Bold' : 'Helvetica')
          .text(cells[i], cx + 3, y + 4, { width: widths[i] - 6, align: aligns[i] });
        doc.moveTo(cx, y).lineTo(cx, y + rowHeight).strokeColor('#e1e7ef').stroke();
        cx += widths[i];
      }
      doc.moveTo(x + tableWidth, y).lineTo(x + tableWidth, y + rowHeight).strokeColor('#e1e7ef').stroke();
      doc.moveTo(x, y + rowHeight).lineTo(x + tableWidth, y + rowHeight).strokeColor('#e1e7ef').stroke();
      y += rowHeight;
    }

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

module.exports = { generateClientLedgerPdfToFile };
