const fs = require("fs");
const PDFDocument = require("pdfkit");

function safeText(value) {
  return value === undefined || value === null ? "" : String(value);
}

function money(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0.00";
  return numeric.toFixed(2);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString();
}

function drawTitle(doc, title, subtitle) {
  doc.font("Helvetica-Bold").fontSize(18).fillColor("#111827").text(title, { align: "center" });
  if (subtitle) {
    doc.moveDown(0.25);
    doc.font("Helvetica").fontSize(10).fillColor("#4b5563").text(subtitle, { align: "center" });
  }
  doc.moveDown(1);
}

function drawMetaBlock(doc, lines = []) {
  const cleanLines = (lines || []).filter(Boolean);
  if (!cleanLines.length) return;
  doc.font("Helvetica").fontSize(10).fillColor("#374151");
  cleanLines.forEach((line) => doc.text(line));
  doc.moveDown(0.75);
}

function ensureTableHeader(doc, { title, columns, widths, startX, startY, rowHeight }) {
  if (title) {
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827").text(title, startX, startY);
  }
  const headerY = title ? startY + 18 : startY;
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);

  doc.save();
  doc.rect(startX, headerY, totalWidth, rowHeight).fill("#1f2937");
  doc.restore();

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff");
  let x = startX;
  columns.forEach((column, index) => {
    doc.text(column.label, x + 6, headerY + 7, {
      width: widths[index] - 12,
      align: column.align || "left"
    });
    x += widths[index];
  });

  return headerY + rowHeight;
}

function ensurePageCapacity(doc, y, neededHeight, drawHeader) {
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  if (y + neededHeight <= bottomLimit) return y;
  doc.addPage();
  return drawHeader(doc.page.margins.top);
}

function drawTable(doc, { title = "", columns, widths, rows }) {
  const startX = doc.page.margins.left;
  const rowHeight = 22;
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);

  const drawHeader = (top) => ensureTableHeader(doc, {
    title,
    columns,
    widths,
    startX,
    startY: top,
    rowHeight
  });

  let y = drawHeader(doc.y);
  doc.font("Helvetica").fontSize(9).fillColor("#111827");

  rows.forEach((row, index) => {
    y = ensurePageCapacity(doc, y, rowHeight + 4, (top) => ensureTableHeader(doc, {
      title: "",
      columns,
      widths,
      startX,
      startY: top,
      rowHeight
    }));

    doc.save();
    doc.rect(startX, y, totalWidth, rowHeight).fill(index % 2 === 0 ? "#f9fafb" : "#ffffff");
    doc.restore();

    let x = startX;
    columns.forEach((column, colIndex) => {
      const value = row[column.key] === undefined || row[column.key] === null ? "" : row[column.key];
      doc.text(String(value), x + 6, y + 7, {
        width: widths[colIndex] - 12,
        align: column.align || "left",
        ellipsis: true
      });
      x += widths[colIndex];
    });

    y += rowHeight;
  });

  doc.moveDown(1);
  doc.y = y + 10;
}

function buildSummaryRows(report) {
  const hasPeriod = Boolean(report?.date_from || report?.date_to);
  const hasAsOf = Boolean(report?.as_of);

  if (hasPeriod) {
    return {
      columns: [
        { key: "product", label: "Product" },
        { key: "category", label: "Category" },
        { key: "unit", label: "Unit" },
        { key: "opening_qty", label: "Opening", align: "right" },
        { key: "in_qty", label: "In", align: "right" },
        { key: "out_qty", label: "Out", align: "right" },
        { key: "delete_qty", label: "Delete", align: "right" },
        { key: "adjustment_qty", label: "Adj", align: "right" },
        { key: "closing_qty", label: "Closing", align: "right" }
      ],
      widths: [130, 80, 45, 55, 45, 45, 45, 45, 55],
      rows: (report.rows || []).map((row) => ({
        product: safeText(row.product?.name),
        category: safeText(row.product?.category?.name),
        unit: safeText(row.product?.unit),
        opening_qty: money(row.opening_qty),
        in_qty: money(row.in_qty),
        out_qty: money(row.out_qty),
        delete_qty: money(row.delete_qty),
        adjustment_qty: money(row.adjustment_qty),
        closing_qty: money(row.closing_qty)
      }))
    };
  }

  if (hasAsOf) {
    return {
      columns: [
        { key: "product", label: "Product" },
        { key: "category", label: "Category" },
        { key: "unit", label: "Unit" },
        { key: "in_qty", label: "In", align: "right" },
        { key: "out_qty", label: "Out", align: "right" },
        { key: "delete_qty", label: "Delete", align: "right" },
        { key: "adjustment_qty", label: "Adj", align: "right" },
        { key: "stock_qty", label: "Stock", align: "right" }
      ],
      widths: [150, 90, 50, 50, 50, 50, 50, 60],
      rows: (report.rows || []).map((row) => ({
        product: safeText(row.product?.name),
        category: safeText(row.product?.category?.name),
        unit: safeText(row.product?.unit),
        in_qty: money(row.totals?.in_qty),
        out_qty: money(row.totals?.out_qty),
        delete_qty: money(row.totals?.delete_qty),
        adjustment_qty: money(row.totals?.adjustment_qty),
        stock_qty: money(row.stock_qty)
      }))
    };
  }

  return {
    columns: [
      { key: "product", label: "Product" },
      { key: "category", label: "Category" },
      { key: "unit", label: "Unit" },
      { key: "stock_qty", label: "Stock", align: "right" }
    ],
    widths: [220, 120, 70, 80],
    rows: (report.rows || []).map((row) => ({
      product: safeText(row.product?.name),
      category: safeText(row.product?.category?.name),
      unit: safeText(row.product?.unit),
      stock_qty: money(row.stock_qty)
    }))
  };
}

async function generateStockSummaryPdfToFile({ company_name, factory_label, report, filter_lines = [], outPath }) {
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);

    drawTitle(doc, "Stock Summary", safeText(company_name));
    drawMetaBlock(doc, [
      factory_label ? `Factory Scope: ${factory_label}` : null,
      ...filter_lines,
      `Generated On: ${new Date().toLocaleString()}`
    ]);

    const table = buildSummaryRows(report || { rows: [] });
    drawTable(doc, {
      title: `Products (${(report?.rows || []).length})`,
      columns: table.columns,
      widths: table.widths,
      rows: table.rows
    });

    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

async function generateProductInventoryMonthlyPdfToFile({
  company_name,
  factory_label,
  summary,
  daily_breakdown,
  filter_lines = [],
  outPath
}) {
  const productName = safeText(summary?.product?.name || "Product");
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);

    drawTitle(doc, "Product Inventory Summary", `${safeText(company_name)}${productName ? ` • ${productName}` : ""}`);
    drawMetaBlock(doc, [
      factory_label ? `Factory Scope: ${factory_label}` : null,
      summary?.product?.category?.name ? `Category: ${summary.product.category.name}` : null,
      summary?.product?.unit ? `Unit: ${summary.product.unit}` : null,
      ...filter_lines,
      `Generated On: ${new Date().toLocaleString()}`
    ]);

    const snapshotRows = [
      { label: "Opening Qty", value: money(summary?.opening_qty) },
      { label: "In Qty", value: money(summary?.movement_totals?.in_qty) },
      { label: "Out Qty", value: money(summary?.movement_totals?.out_qty) },
      { label: "Delete Qty", value: money(summary?.movement_totals?.delete_qty) },
      { label: "Adjustment Qty", value: money(summary?.movement_totals?.adjustment_qty) },
      { label: "Closing Qty", value: money(summary?.closing_qty ?? summary?.stock_qty) }
    ];

    drawTable(doc, {
      title: "Summary",
      columns: [
        { key: "label", label: "Metric" },
        { key: "value", label: "Value", align: "right" }
      ],
      widths: [320, 180],
      rows: snapshotRows
    });

    drawTable(doc, {
      title: `Daily Breakdown (${daily_breakdown?.count || 0} days)`,
      columns: [
        { key: "date", label: "Date" },
        { key: "opening_qty", label: "Opening", align: "right" },
        { key: "in_qty", label: "In", align: "right" },
        { key: "out_qty", label: "Out", align: "right" },
        { key: "delete_qty", label: "Delete", align: "right" },
        { key: "adjustment_qty", label: "Adj", align: "right" },
        { key: "closing_qty", label: "Closing", align: "right" }
      ],
      widths: [90, 70, 55, 55, 60, 55, 85],
      rows: (daily_breakdown?.rows || []).map((row) => ({
        date: safeText(row.date),
        opening_qty: money(row.opening_qty),
        in_qty: money(row.in_qty),
        out_qty: money(row.out_qty),
        delete_qty: money(row.delete_qty),
        adjustment_qty: money(row.adjustment_qty),
        closing_qty: money(row.closing_qty)
      }))
    });

    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

module.exports = {
  generateStockSummaryPdfToFile,
  generateProductInventoryMonthlyPdfToFile
};
