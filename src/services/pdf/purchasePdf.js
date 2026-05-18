const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const prisma = require("../../config/db");

const THEME = (process.env.PDF_THEME_COLOR || "#5d309d").trim();

function resolveLogoPath() {
  const p = process.env.INVOICE_LOGO_PATH || "src/assets/babanamak-logo.jpeg";
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

function safeText(v) {
  return v ? String(v) : "";
}

async function generatePurchasePdfToFile({ company_id, factory_id, purchaseId, outPath }) {
  const purchase = await prisma.purchase.findFirst({
    where: { id: purchaseId, company_id, factory_id, is_active: true },
    include: { items: true, charges: true, factory: { select: { name: true, address: true } } }
  });
  if (!purchase) {
    const err = new Error("Purchase not found");
    err.statusCode = 404;
    throw err;
  }

  await new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const stream = fs.createWriteStream(outPath);
      doc.pipe(stream);

      const left = doc.page.margins.left;
      const right = doc.page.margins.right;
      const pageWidth = doc.page.width;
      const contentWidth = pageWidth - left - right;

      // ── Styled header ──
      const headerH = 100;
      const padY = 14;

      doc.save();
      doc.rect(0, 0, pageWidth, headerH).fill(THEME);
      doc.restore();

      // Logo card (square to match logo)
      const logoBoxW = 100;
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

      // Right column – title & meta
      const rightColX = logoBoxX + logoBoxW + 18;
      const rightColW = left + contentWidth - rightColX;

      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(18);
      doc.text("PURCHASE ORDER", rightColX, padY, { width: rightColW, align: "right" });

      doc.font("Helvetica").fontSize(10).fillColor("#eaf6fb");
      doc.lineGap(1);

      const metaLines = [
        `PO No: ${purchase.purchase_no}`,
        `Date: ${new Date(purchase.purchase_date).toLocaleDateString()}`,
        `Status: ${purchase.status}`,
        `Factory: ${safeText(purchase.factory?.name)}`
      ];

      const metaLineH = 12;
      const metaStartY = headerH - padY - metaLines.length * metaLineH;
      metaLines.forEach((line, i) => {
        doc.text(line, rightColX, metaStartY + i * metaLineH, { width: rightColW, align: "right" });
      });

      doc.y = headerH + 18;

      // ── Vendor block (styled with responsive border) ──
      const vendorPadX = 12;
      const vendorPadY = 10;
      const vendorInner = contentWidth - vendorPadX * 2;
      const vendorTopY = doc.y;

      const vendorLines = [
        purchase.vendor_name,
        purchase.vendor_gstin ? `GSTIN: ${purchase.vendor_gstin}` : null,
        purchase.vendor_phone ? `Phone: ${purchase.vendor_phone}` : null,
        purchase.vendor_email ? `Email: ${purchase.vendor_email}` : null,
        purchase.vendor_address ? `Address: ${purchase.vendor_address}` : null
      ].filter(Boolean);

      // Measure height
      doc.font("Helvetica-Bold").fontSize(11);
      let vendorH = vendorPadY + doc.heightOfString("Vendor", { width: vendorInner }) + 6;
      doc.font("Helvetica").fontSize(10);
      vendorLines.forEach(l => {
        vendorH += Math.max(doc.heightOfString(l, { width: vendorInner }), 14);
      });
      vendorH += vendorPadY;

      doc.save();
      doc.roundedRect(left, vendorTopY, contentWidth, vendorH, 10).strokeColor("#d9d9d9").lineWidth(1).stroke();
      doc.restore();

      let vy = vendorTopY + vendorPadY;
      doc.fillColor(THEME).font("Helvetica-Bold").fontSize(11);
      doc.text("Vendor", left + vendorPadX, vy, { width: vendorInner });
      vy += doc.heightOfString("Vendor", { width: vendorInner }) + 6;

      doc.font("Helvetica").fontSize(10).fillColor("#374151");
      vendorLines.forEach(l => {
        const lh = Math.max(doc.heightOfString(l, { width: vendorInner }), 14);
        doc.text(l, left + vendorPadX, vy, { width: vendorInner });
        vy += lh;
      });

      doc.y = vendorTopY + vendorH + 14;

      // ── Items table (styled) ──
      const col = {
        no: 30,
        desc: contentWidth - (30 + 60 + 70 + 80),
        qty: 60,
        rate: 70,
        total: 80
      };

      const rowH = 20;
      const startX = left;
      let y = doc.y;

      doc.fillColor("#111827").font("Helvetica-Bold").fontSize(12).text("Items", startX, y);
      y += 8;

      // Table header row
      doc.save();
      doc.rect(startX, y + 8, contentWidth, rowH).fill(THEME);
      doc.restore();

      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10);
      doc.text("No", startX + 8, y + 14, { width: col.no - 8 });
      doc.text("Description", startX + col.no + 8, y + 14, { width: col.desc - 16 });
      doc.text("Qty", startX + col.no + col.desc, y + 14, { width: col.qty, align: "right" });
      doc.text("Rate", startX + col.no + col.desc + col.qty, y + 14, { width: col.rate, align: "right" });
      doc.text("Amount", startX + col.no + col.desc + col.qty + col.rate, y + 14, { width: col.total, align: "right" });

      y += rowH + 10;

      // Item rows with alternating backgrounds
      doc.font("Helvetica").fontSize(10).fillColor("#111827");
      for (const [idx, it] of purchase.items.entries()) {
        const bg = idx % 2 === 0 ? "#f7fbfe" : "#ffffff";
        doc.save();
        doc.rect(startX, y, contentWidth, rowH).fill(bg);
        doc.restore();

        doc.fillColor("#111827");
        doc.text(String(idx + 1), startX + 8, y + 6, { width: col.no - 8 });
        doc.text(safeText(it.description), startX + col.no + 8, y + 6, { width: col.desc - 16, ellipsis: true });
        doc.text(String(it.quantity), startX + col.no + col.desc, y + 6, { width: col.qty, align: "right" });
        doc.text(String(it.unit_price), startX + col.no + col.desc + col.qty, y + 6, { width: col.rate, align: "right" });
        doc.text(String(it.line_total), startX + col.no + col.desc + col.qty + col.rate, y + 6, { width: col.total, align: "right" });

        y += rowH;
      }

      doc.y = y + 12;

      // ── Charges ──
      if (purchase.charges.length) {
        doc.fillColor("#111827").font("Helvetica-Bold").fontSize(11).text("Charges");
        doc.font("Helvetica").fontSize(10).fillColor("#374151");
        for (const c of purchase.charges) {
          doc.text(`• ${c.label}: ${c.amount}`);
        }
        doc.moveDown(0.5);
      }

      // ── Total ──
      doc.fillColor("#111827").font("Helvetica-Bold").fontSize(12).text(`Total: ${purchase.total}`, { align: "right" });

      // ── Notes ──
      if (purchase.notes) {
        doc.moveDown(1);
        doc.fontSize(9).fillColor("#6b7280").text(`Notes: ${purchase.notes}`);
      }

      doc.end();
      stream.on("finish", resolve);
      stream.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });

  return { purchase };
}

module.exports = {
  generatePurchasePdfToFile
};
