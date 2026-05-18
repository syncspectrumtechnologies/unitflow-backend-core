const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const prisma = require("../../config/db");

const THEME = (process.env.PDF_THEME_COLOR || "#5d309d").trim();

function resolveLogoPath() {
  const p = process.env.INVOICE_LOGO_PATH || "src/assets/babanamak-logo.jpeg";
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

async function fetchOrderForLabel(company_id, factory_id, orderId) {
  return prisma.order.findFirst({
    where: { id: orderId, company_id, factory_id, is_active: true },
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

function renderLabel(doc, order) {
  const pageWidth = doc.page.width;
  const left = doc.page.margins.left;
  const contentWidth = pageWidth - left - doc.page.margins.right;

  // ── Compact themed header for A6 ──
  const headerH = 50;

  doc.save();
  doc.rect(0, 0, pageWidth, headerH).fill(THEME);
  doc.restore();

  // Logo card (square to match logo)
  const logoBoxW = 80;
  const logoBoxH = 32;
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

  // Right side – title & order meta
  const rightColX = logoBoxX + logoBoxW + 8;
  const rightColW = left + contentWidth - rightColX;

  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(11);
  doc.text("ORDER LABEL", rightColX, 10, { width: rightColW, align: "right" });

  doc.font("Helvetica").fontSize(7).fillColor("#eaf6fb");
  doc.text(`Order: ${order.order_no}  |  ${new Date(order.order_date).toLocaleDateString()}`, rightColX, 26, {
    width: rightColW,
    align: "right"
  });
  doc.text(`Factory: ${order.factory?.name || order.factory_id}`, rightColX, 36, {
    width: rightColW,
    align: "right"
  });

  // ── Body below header ──
  doc.y = headerH + 8;

  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(10);
  doc.text(order.sales_company?.name || order.company?.name || "Company", left, doc.y, { width: contentWidth });
  doc.moveDown(0.4);

  // Ship To
  doc.fillColor(THEME).font("Helvetica-Bold").fontSize(9).text("Ship To:");
  doc.font("Helvetica").fontSize(9).fillColor("#111827");
  doc.text(order.client.company_name);
  if (order.client.address) doc.text(order.client.address);
  const cityLine = [order.client.city, order.client.state, order.client.pincode].filter(Boolean).join(", ");
  if (cityLine) doc.text(cityLine);
  if (order.client.phone) doc.text(`Phone: ${order.client.phone}`);
  if (order.client.gstin) doc.text(`GSTIN: ${order.client.gstin}`);
  doc.moveDown(0.4);

  // Items
  doc.fillColor(THEME).font("Helvetica-Bold").fontSize(9).text("Items:");
  doc.font("Helvetica").fontSize(8).fillColor("#111827");

  order.items.forEach((it, idx) => {
    const p = it.product;
    const pack = p.pack_size ? ` (${p.pack_size})` : "";
    doc.text(`${idx + 1}. ${p.name}${pack}  x ${it.quantity}`);
  });

  doc.moveDown(0.4);
  doc.fontSize(8).fillColor("#6b7280").text("Handle with care. Thank you!", { align: "left" });
}

async function generateOrderLabelPdfToFile({ company_id, factory_id, orderId, outPath }) {
  const order = await fetchOrderForLabel(company_id, factory_id, orderId);
  if (!order) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A6", margin: 18 });
    const stream = fs.createWriteStream(outPath);

    doc.pipe(stream);
    renderLabel(doc, order);
    doc.end();

    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return order;
}

module.exports = {
  generateOrderLabelPdfToFile
};
