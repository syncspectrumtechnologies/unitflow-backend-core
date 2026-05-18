const fs = require("fs");
const PDFDocument = require("pdfkit");
const prisma = require("../../config/db");

function safe(value) {
  return value === undefined || value === null ? "" : String(value);
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function voucherTitle(voucher) {
  const type = String(voucher?.voucher_type || '').toUpperCase();
  if (type === 'GENERAL') return 'JOURNAL VOUCHER';
  if (type === 'DEBIT_NOTE') return 'DEBIT NOTE';
  if (type === 'CREDIT_NOTE') return 'CREDIT NOTE';
  if (type === 'OPENING') return 'OPENING VOUCHER';
  return safe(voucher?.voucher_type).replace(/_/g, ' ');
}

async function generateVoucherPdfToFile({ company_id, voucherId, outPath }) {
  const voucher = await prisma.accountingVoucher.findFirst({
    where: { id: voucherId, company_id, is_active: true },
    include: {
      client: { select: { company_name: true } },
      lines: { orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }] },
      factory: { select: { name: true } },
      invoice: { select: { invoice_no: true } },
      purchase: { select: { purchase_no: true } }
    }
  });
  if (!voucher) {
    const err = new Error("Voucher not found");
    err.statusCode = 404;
    throw err;
  }

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);

    doc.fontSize(18).font("Helvetica-Bold").text(voucherTitle(voucher), { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).font("Helvetica");
    doc.text(`Voucher No: ${safe(voucher.voucher_no)}`);
    doc.text(`Date: ${new Date(voucher.voucher_date).toLocaleDateString()}`);
    if (voucher.client?.company_name) doc.text(`Party: ${voucher.client.company_name}`);
    if (voucher.factory?.name) doc.text(`Factory: ${voucher.factory.name}`);
    if (voucher.invoice?.invoice_no) doc.text(`Invoice Ref: ${voucher.invoice.invoice_no}`);
    if (voucher.purchase?.purchase_no) doc.text(`Purchase Ref: ${voucher.purchase.purchase_no}`);
    if (voucher.particulars) doc.text(`Particulars: ${voucher.particulars}`);
    if (voucher.narration) doc.text(`Narration: ${voucher.narration}`);
    doc.moveDown();

    const startX = 40;
    let y = doc.y;
    const widths = [35, 180, 80, 70, 70, 70];
    const headers = ["#", "Account / Description", "Qty", "Rate", "Debit", "Credit"];
    let x = startX;
    doc.font("Helvetica-Bold").fontSize(10);
    headers.forEach((h, idx) => {
      doc.text(h, x, y, { width: widths[idx], align: idx >= 2 ? "right" : "left" });
      x += widths[idx];
    });
    y += 18;
    doc.moveTo(startX, y).lineTo(startX + widths.reduce((a, b) => a + b, 0), y).stroke();
    y += 6;

    doc.font("Helvetica").fontSize(9);
    voucher.lines.forEach((line, idx) => {
      const rowHeight = 18;
      let rx = startX;
      doc.text(String(idx + 1), rx, y, { width: widths[0] });
      rx += widths[0];
      doc.text(`${safe(line.account_name)}${line.description ? `\n${safe(line.description)}` : ""}`, rx, y, { width: widths[1] });
      rx += widths[1];
      doc.text(line.quantity != null ? money(line.quantity) : "", rx, y, { width: widths[2], align: "right" });
      rx += widths[2];
      doc.text(line.unit_price != null ? money(line.unit_price) : "", rx, y, { width: widths[3], align: "right" });
      rx += widths[3];
      doc.text(line.entry_type === "DEBIT" ? money(line.amount) : "", rx, y, { width: widths[4], align: "right" });
      rx += widths[4];
      doc.text(line.entry_type === "CREDIT" ? money(line.amount) : "", rx, y, { width: widths[5], align: "right" });
      y += rowHeight + (line.description ? 10 : 0);
      if (y > 740) {
        doc.addPage();
        y = 40;
      }
    });

    doc.moveDown();
    doc.font("Helvetica-Bold").fontSize(10).text(`Total Amount: ${money(voucher.total_amount)}`, { align: "right" });
    doc.text(`Total Debit: ${money(voucher.total_debit)}   Total Credit: ${money(voucher.total_credit)}`, { align: "right" });

    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return voucher;
}

module.exports = { generateVoucherPdfToFile };
