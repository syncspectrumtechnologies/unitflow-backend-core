const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const prisma = require("../../config/db");

const THEME = (process.env.PDF_THEME_COLOR || "#5d309d  ").trim();

function resolveLogoPath() {
  const p = process.env.INVOICE_LOGO_PATH || "src/assets/logo.png";
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

async function fetchInvoice(company_id, factory_id, invoiceId) {
  return prisma.invoice.findFirst({
    where: { id: invoiceId, company_id, factory_id, is_active: true },
    include: {
      client: true,
      items: { include: { product: { include: { category: true } } } },
      charges: true,
      factory: true,
      company: true,
      sales_company: true
    }
  });
}

function money(v) {
  if (v === null || v === undefined) return "0.00";
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

function safeText(v) {
  return v ? String(v) : "";
}

function completionStatusFromInvoiceStatus(status) {
  const s = String(status || "").toUpperCase();
  if (s === "PAID") return "COMPLETED";
  if (s === "VOID") return "VOID";
  return "PENDING";
}


function drawWatermark(doc, text) {
  // Single large diagonal transparent watermark centered on the page.
  // Drawn after the content so the document stays one page and readable.
  const page = doc.page;
  const w = page.width;
  const h = page.height;
  const cx = w / 2;
  const cy = h / 2;

  doc.save();
  doc.fillColor("#9ca3af");
  doc.fillOpacity(0.14);
  doc.font("Helvetica-Bold");
  doc.fontSize(118);
  doc.rotate(-35, { origin: [cx, cy] });
  doc.text(text, -40, cy - 55, {
    width: w + 80,
    align: "center",
    lineBreak: false
  });
  doc.restore();
}

function drawHeader(doc, inv) {
  const pageWidth = doc.page.width;
  const left = doc.page.margins.left;
  const right = doc.page.margins.right;
  const contentWidth = pageWidth - left - right;

  // Header strip sizing
  const headerH = 130;
  const padY = 14;
  const padX = 14;

  // Draw header strip
  doc.save();
  doc.rect(0, 0, pageWidth, headerH).fill(THEME);
  doc.restore();

  // Logo card (square to match logo)
  const logoBoxW = 130;
  const logoBoxH = 42;
  const logoBoxX = left;
  const logoBoxY = (headerH - logoBoxH) / 2;

  doc.save();
  doc.roundedRect(logoBoxX, logoBoxY, logoBoxW, logoBoxH, 8).fill("#5d309d  ");
  doc.restore();

  const logoPath = resolveLogoPath();
  try {
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, logoBoxX + 4, logoBoxY + 4, {
        fit: [logoBoxW - 8, logoBoxH - 8],
        align: "center",
        valign: "center"
      });
    } else {
      doc.fillColor(THEME).font("Helvetica-Bold").fontSize(12).text("BABANAMAK", logoBoxX + 10, logoBoxY + 14);
    }
  } catch (e) {
    doc.fillColor(THEME).font("Helvetica-Bold").fontSize(12).text("BABANAMAK", logoBoxX + 10, logoBoxY + 14);
  }

  // Right column area (everything must fit inside headerH)
  const rightColX = logoBoxX + logoBoxW + 18;
  const rightColW = left + contentWidth - rightColX;

  // Title
  doc.fillColor("#ffffff");
  doc.font("Helvetica-Bold").fontSize(18).text(
    inv.kind === "PROFORMA" ? "PROFORMA INVOICE" : "INVOICE",
    rightColX,
    padY,
    { width: rightColW, align: "right" }
  );

  // Meta lines - constrained to header, smaller font, tighter leading
  doc.font("Helvetica").fontSize(10).fillColor("#eaf6fb");
  doc.lineGap(1);

  const metaLines = [
    `Invoice No: ${safeText(inv.invoice_no)}`,
    `Status: ${safeText(inv.status)}`,
    `Payment: ${completionStatusFromInvoiceStatus(inv.status)}`,
    `Issue Date: ${new Date(inv.issue_date).toLocaleDateString()}`,
    inv.due_date ? `Due Date: ${new Date(inv.due_date).toLocaleDateString()}` : null,
    inv.order_id ? `Order Ref: ${safeText(inv.order_id)}` : null,
    `Factory: ${safeText(inv.factory?.name || inv.factory_id)}`
  ].filter(Boolean);

  // Place meta from bottom up so it never overflows header strip
  const metaLineH = 12;
  const maxLines = Math.floor((headerH - 34) / metaLineH); // reserve for title
  const safeMeta = metaLines.slice(0, maxLines);

  // Align meta block to bottom of header strip
  const metaStartY = headerH - padY - safeMeta.length * metaLineH;

  safeMeta.forEach((line, i) => {
    doc.text(line, rightColX, metaStartY + i * metaLineH, {
      width: rightColW,
      align: "right"
    });
  });

  // Reset cursor below header strip with proper margin
  doc.y = headerH + 18;
}


function buildSalesCompanyInvoiceLines(company) {
  const lines = [];

  const officeAddress = safeText(company.office_address || company.address);
  if (officeAddress) {
    lines.push(`Office: ${officeAddress}`);
  }

  const secondaryLabel = safeText(company.secondary_address_label || "Factory");
  const secondaryAddress = safeText(company.secondary_address);
  if (secondaryAddress) {
    lines.push(`${secondaryLabel}: ${secondaryAddress}`);
  }

  const tertiaryLabel = safeText(company.tertiary_address_label || "Branch");
  const tertiaryAddress = safeText(company.tertiary_address);
  if (tertiaryAddress) {
    lines.push(`${tertiaryLabel}: ${tertiaryAddress}`);
  }

  if (company.fssai_no) {
    lines.push(`FSSAI No.: ${company.fssai_no}`);
  }

  if (company.gstin) {
    lines.push(`GSTIN/UIN: ${company.gstin}`);
  } else if (lines.length) {
    lines.push("GSTIN/UIN: ____________");
  }

  if (company.state_name || company.state_code) {
    const stateParts = [];
    if (company.state_name) stateParts.push(`State Name: ${company.state_name}`);
    if (company.state_code) stateParts.push(`Code: ${company.state_code}`);
    lines.push(stateParts.join(", "));
  }

  if (!lines.length) {
    return [
      safeText(company.address || "Company address line (placeholder)"),
      company.gstin ? `GSTIN/UIN: ${company.gstin}` : "GSTIN/UIN: ____________",
      company.phone ? `Phone: ${company.phone}` : "Phone: ____________",
      company.email ? `Email: ${company.email}` : "Email: ____________"
    ];
  }

  return lines;
}

function drawCompanyAndClientBlocks(doc, inv) {
  // Prefer the order/invoice-level sales company (legal entity) when present.
  const company = inv.sales_company || inv.company || {};
  const client = inv.client || {};

  const margin = doc.page.margins.left;
  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - doc.page.margins.left - doc.page.margins.right;

  const blockGap = 14;
  const blockW = (contentWidth - blockGap) / 2;
  const topY = doc.y;
  const padX = 12;
  const padTop = 10;
  const padBottom = 12;
  const innerW = blockW - padX * 2;
  const labelGap = 4;
  const nameGap = 6;

  const companyName = safeText(company.name || company.legal_name || "Babanamak");
  const clientName = safeText(client.company_name || "Client Name");

  const fromLines = buildSalesCompanyInvoiceLines(company);

  const cityLine = [client.city, client.state, client.pincode].filter(Boolean).join(", ");
  const billLines = [
    safeText(client.address || "Client address line (placeholder)"),
    cityLine || "City, State, Pincode",
    client.phone ? `Phone: ${client.phone}` : "Phone: ____________",
    client.gstin ? `GSTIN: ${client.gstin}` : "GSTIN: ____________"
  ];

  // Measure the height a block needs so the border wraps all content
  function measureBlock(name, lines) {
    let h = padTop;
    doc.font("Helvetica-Bold").fontSize(11);
    h += doc.heightOfString("Label", { width: innerW }) + labelGap;
    doc.font("Helvetica-Bold").fontSize(12);
    h += doc.heightOfString(name, { width: innerW }) + nameGap;
    doc.font("Helvetica").fontSize(10);
    lines.forEach(l => {
      h += Math.max(doc.heightOfString(l, { width: innerW }), 14);
    });
    h += padBottom;
    return h;
  }

  const blockH = Math.max(measureBlock(companyName, fromLines), measureBlock(clientName, billLines));

  // --- Company (From) block ---
  doc.save();
  doc.roundedRect(margin, topY, blockW, blockH, 10).strokeColor("#d9d9d9").lineWidth(1).stroke();
  doc.restore();

  let y = topY + padTop;
  doc.fillColor(THEME).font("Helvetica-Bold").fontSize(11);
  doc.text("From", margin + padX, y, { width: innerW });
  y += doc.heightOfString("From", { width: innerW }) + labelGap;

  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(12);
  doc.text(companyName, margin + padX, y, { width: innerW });
  y += doc.heightOfString(companyName, { width: innerW }) + nameGap;

  doc.font("Helvetica").fontSize(10).fillColor("#374151");
  fromLines.forEach(l => {
    const lh = Math.max(doc.heightOfString(l, { width: innerW }), 14);
    doc.text(l, margin + padX, y, { width: innerW });
    y += lh;
  });

  // --- Client (Bill To) block ---
  const x2 = margin + blockW + blockGap;
  doc.save();
  doc.roundedRect(x2, topY, blockW, blockH, 10).strokeColor("#d9d9d9").lineWidth(1).stroke();
  doc.restore();

  y = topY + padTop;
  doc.fillColor(THEME).font("Helvetica-Bold").fontSize(11);
  doc.text("Bill To", x2 + padX, y, { width: innerW });
  y += doc.heightOfString("Bill To", { width: innerW }) + labelGap;

  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(12);
  doc.text(clientName, x2 + padX, y, { width: innerW });
  y += doc.heightOfString(clientName, { width: innerW }) + nameGap;

  doc.font("Helvetica").fontSize(10).fillColor("#374151");
  billLines.forEach(l => {
    const lh = Math.max(doc.heightOfString(l, { width: innerW }), 14);
    doc.text(l, x2 + padX, y, { width: innerW });
    y += lh;
  });

  doc.y = topY + blockH + 12;
}

function drawItemsTable(doc, inv) {
  const margin = doc.page.margins.left;
  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - doc.page.margins.left - doc.page.margins.right;

  const col = {
    no: 30,
    product: contentWidth - (30 + 60 + 70 + 80), // flexible
    qty: 60,
    rate: 70,
    total: 80
  };

  const rowH = 20;
  const startX = margin;
  let y = doc.y;

  // Section title
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(12).text("Items", startX, y);
  y += 8;

  // Header background
  doc.save();
  doc.rect(startX, y + 8, contentWidth, rowH).fill(THEME);
  doc.restore();

  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10);
  doc.text("No", startX + 8, y + 14, { width: col.no - 8 });
  doc.text("Product", startX + col.no + 8, y + 14, { width: col.product - 16 });
  doc.text("Qty", startX + col.no + col.product, y + 14, { width: col.qty, align: "right" });
  doc.text("Rate", startX + col.no + col.product + col.qty, y + 14, { width: col.rate, align: "right" });
  doc.text("Total", startX + col.no + col.product + col.qty + col.rate, y + 14, { width: col.total, align: "right" });

  y += rowH + 10;

  // Rows
  doc.font("Helvetica").fontSize(10).fillColor("#111827");
  inv.items.forEach((it, idx) => {
    const bg = idx % 2 === 0 ? "#f7fbfe" : "#ffffff";
    doc.save();
    doc.rect(startX, y, contentWidth, rowH).fill(bg);
    doc.restore();

    const p = it.product || {};
    const name = `${safeText(p.name)}${p.pack_size ? ` (${p.pack_size})` : ""}`;

    doc.fillColor("#111827").text(String(idx + 1), startX + 8, y + 6, { width: col.no - 8 });
    doc.text(name, startX + col.no + 8, y + 6, { width: col.product - 16, ellipsis: true });
    doc.text(String(it.quantity), startX + col.no + col.product, y + 6, { width: col.qty, align: "right" });
    doc.text(money(it.unit_price), startX + col.no + col.product + col.qty, y + 6, { width: col.rate, align: "right" });
    doc.text(money(it.line_total), startX + col.no + col.product + col.qty + col.rate, y + 6, { width: col.total, align: "right" });

    y += rowH;
  });

  doc.y = y + 12;
}

function drawChargesAndTotals(doc, inv) {
  const margin = doc.page.margins.left;
  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - doc.page.margins.left - doc.page.margins.right;

  const leftW = Math.floor(contentWidth * 0.55);
  const rightW = contentWidth - leftW;

  const startY = doc.y;

  // Charges (left)
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(11).text("Charges / Notes", margin, startY);

  doc.font("Helvetica").fontSize(10).fillColor("#374151");
  let y = startY + 16;

  if (inv.charges && inv.charges.length) {
    inv.charges.forEach((c) => {
      doc.text(`• ${c.title} (${c.type}) : ₹ ${money(c.amount)}`, margin, y, { width: leftW - 10 });
      y += 12;
    });
  } else {
    doc.text("• No additional charges.", margin, y, { width: leftW - 10 });
    y += 12;
  }

  y += 6;
  if (inv.notes) {
    doc.text(`Notes: ${inv.notes}`, margin, y, { width: leftW - 10 });
  } else {
    doc.text("Notes: ____________", margin, y, { width: leftW - 10 });
  }

  // Totals box (right)
  const boxX = margin + leftW;
  const boxY = startY;
  const boxH = 96;

  doc.save();
  doc.roundedRect(boxX, boxY, rightW, boxH, 10).strokeColor("#d9d9d9").lineWidth(1).stroke();
  doc.restore();

  doc.fillColor(THEME).font("Helvetica-Bold").fontSize(11).text("Total Summary", boxX + 12, boxY + 10);

  doc.font("Helvetica").fontSize(10).fillColor("#111827");
  const rows = [
    ["Subtotal", `₹ ${money(inv.subtotal)}`],
    ["Charges", `₹ ${money(inv.total_charges)}`],
    ["Total", `₹ ${money(inv.total)}`]
  ];

  let ry = boxY + 30;
  rows.forEach(([k, v], i) => {
    const isTotal = k === "Total";
    doc.font(isTotal ? "Helvetica-Bold" : "Helvetica").fontSize(isTotal ? 12 : 10);
    doc.text(k, boxX + 12, ry, { width: rightW - 24, align: "left" });
    doc.text(v, boxX + 12, ry, { width: rightW - 24, align: "right" });
    ry += isTotal ? 20 : 16;
  });

  doc.y = Math.max(y + 20, boxY + boxH + 14);
}

function drawFooter(doc) {
  const margin = doc.page.margins.left;
  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - doc.page.margins.left - doc.page.margins.right;
  const bottomY = doc.page.height - doc.page.margins.bottom - 70;

  doc.save();
  doc.strokeColor("#e5e7eb").lineWidth(1);
  doc.moveTo(margin, bottomY).lineTo(margin + contentWidth, bottomY).stroke();
  doc.restore();

  doc.fillColor("#6b7280").font("Helvetica").fontSize(9);
  doc.text("Payment Details (placeholder): UPI / Bank details can go here.", margin, bottomY + 10, { width: contentWidth });
  doc.text("Terms (placeholder): Goods once sold will not be taken back. Subject to jurisdiction.", margin, bottomY + 24, {
    width: contentWidth
  });

  doc.fillColor("#9ca3af").fontSize(9).text("This is a system-generated document.", margin, bottomY + 42, {
    width: contentWidth
  });
}

function renderInvoice(doc, inv) {
  // Draw all content first, then overlay watermark
  drawHeader(doc, inv);
  drawCompanyAndClientBlocks(doc, inv);
  drawItemsTable(doc, inv);
  drawChargesAndTotals(doc, inv);
  drawFooter(doc);
  // Watermark drawn LAST using raw PDF operators — no extra pages
  if (inv.kind === 'PROFORMA') {
    drawWatermark(doc, 'PROFORMA');
  }
}

async function generateInvoicePdfFromData({ inv, outPath }) {
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const stream = fs.createWriteStream(outPath);

    doc.pipe(stream);
    renderInvoice(doc, inv);
    doc.end();

    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return inv;
}

async function generateInvoicePdfToFile({ company_id, factory_id, invoiceId, outPath }) {
  const inv = await fetchInvoice(company_id, factory_id, invoiceId);
  if (!inv) {
    const err = new Error("Invoice not found");
    err.statusCode = 404;
    throw err;
  }

  await generateInvoicePdfFromData({ inv, outPath });
  return inv;
}

module.exports = {
  generateInvoicePdfToFile,
  generateInvoicePdfFromData
};