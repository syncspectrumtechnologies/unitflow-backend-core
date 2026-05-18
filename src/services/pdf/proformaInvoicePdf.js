const prisma = require("../../config/db");
const { generateInvoicePdfFromData } = require("./invoicePdf");

function toNumber(v) {
  const n = typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sumCharges(charges = []) {
  return charges.reduce((acc, c) => acc + toNumber(c.amount || 0), 0);
}

async function fetchOrder(company_id, factory_id, orderId) {
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

function buildProformaInvBase({ company_id, factory_id, client, sales_company, items, charges, issue_date, notes, invoice_no, order_ref }) {
  const subtotal = (items || []).reduce((acc, it) => acc + toNumber(it.line_total), 0);
  const total_charges = sumCharges(charges || []);
  const total = subtotal + total_charges;

  return {
    kind: "PROFORMA",
    invoice_no,
    status: "DRAFT", // ✅ as your system wants
    issue_date: issue_date || new Date(),
    due_date: null,
    order_id: order_ref || null,
    notes: notes || "Proforma invoice (for demo / quotation purposes).",

    company_id,
    factory_id,

    // invoicePdf prefers sales_company when present
    company: null,
    sales_company,
    factory: null,
    client,

    items,
    charges,

    subtotal,
    total_charges,
    total
  };
}

function buildProformaFromOrder(order) {
  const items = (order.items || []).map((it) => ({
    quantity: it.quantity,
    unit_price: it.unit_price,
    line_total: it.line_total,
    product: it.product
  }));

  const charges = order.charges || [];

  return buildProformaInvBase({
    company_id: order.company_id,
    factory_id: order.factory_id,
    client: order.client,
    sales_company: order.sales_company,
    items,
    charges,
    issue_date: new Date(),
    notes: order.notes || "Proforma invoice (for demo / quotation purposes).",
    invoice_no: `PF-${order.order_no || order.id}`,
    order_ref: order.order_no || order.id
  });
}

async function generateProformaInvoicePdfToFile({ company_id, factory_id, orderId, outPath }) {
  const order = await fetchOrder(company_id, factory_id, orderId);
  if (!order) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }

  const inv = buildProformaFromOrder(order);
  await generateInvoicePdfFromData({ inv, outPath });
  return inv;
}

// ✅ NEW: payload-based preview (NO DB order)
async function generateProformaPreviewPdfToFile({
  company_id,
  factory_id,
  client,
  sales_company,
  items,
  charges,
  issue_date,
  notes,
  outPath
}) {
  const inv = buildProformaInvBase({
    company_id,
    factory_id,
    client,
    sales_company,
    items,
    charges,
    issue_date: issue_date ? new Date(issue_date) : new Date(),
    notes: notes || "Proforma invoice (preview).",
    invoice_no: `PF-PREVIEW-${Date.now()}`,
    order_ref: null
  });

  await generateInvoicePdfFromData({ inv, outPath });
  return inv;
}

module.exports = {
  generateProformaInvoicePdfToFile,
  generateProformaPreviewPdfToFile
};