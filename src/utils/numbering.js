function pad2(n) {
  return n.toString().padStart(2, "0");
}

function formatDateStamp(date = new Date()) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function formatNumber(prefix, date, sequence) {
  return `${prefix}-${formatDateStamp(date)}-${String(sequence).padStart(5, "0")}`;
}

async function nextSequenceValueTx(tx, company_id, key) {
  const row = await tx.numberSequence.upsert({
    where: { company_id_key: { company_id, key } },
    create: { company_id, key, last_value: 1 },
    update: { last_value: { increment: 1 } }
  });
  return row.last_value;
}

async function makeScopedNumberTx(tx, company_id, type, prefix, date = new Date()) {
  const dayKey = formatDateStamp(date);
  const sequence = await nextSequenceValueTx(tx, company_id, `${type}:${dayKey}`);
  return formatNumber(prefix, date, sequence);
}

async function makeOrderNoTx(tx, company_id, date = new Date()) {
  return makeScopedNumberTx(tx, company_id, "ORDER", "ORD", date);
}

async function makeInvoiceNoTx(tx, company_id, date = new Date()) {
  return makeScopedNumberTx(tx, company_id, "INVOICE", "INV", date);
}

async function makePaymentNoTx(tx, company_id, date = new Date()) {
  return makeScopedNumberTx(tx, company_id, "PAYMENT", "PAY", date);
}

async function makePurchaseNoTx(tx, company_id, date = new Date()) {
  return makeScopedNumberTx(tx, company_id, "PURCHASE", "PUR", date);
}

async function makePurchasePaymentNoTx(tx, company_id, date = new Date()) {
  return makeScopedNumberTx(tx, company_id, "PURCHASE_PAYMENT", "PPAY", date);
}

async function makePurchaseAdvanceNoTx(tx, company_id, date = new Date()) {
  return makeScopedNumberTx(tx, company_id, "PURCHASE_ADVANCE", "PADV", date);
}

async function makeVoucherNoTx(tx, company_id, voucherType = "GENERAL", date = new Date()) {
  const normalized = String(voucherType || "GENERAL").toUpperCase();
  const prefix = normalized === "DEBIT_NOTE" ? "DN" : normalized === "CREDIT_NOTE" ? "CN" : normalized === "OPENING" ? "OPN" : "VCH";
  return makeScopedNumberTx(tx, company_id, `VOUCHER:${normalized}`, prefix, date);
}

function legacyFallback(prefix) {
  const d = new Date();
  const timePart = `${d.getHours().toString().padStart(2, "0")}${d.getMinutes().toString().padStart(2, "0")}${d.getSeconds().toString().padStart(2, "0")}`;
  return `${prefix}-${formatDateStamp(d)}-${timePart}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
}

exports.makeOrderNo = () => legacyFallback("ORD");
exports.makeInvoiceNo = () => legacyFallback("INV");
exports.makePaymentNo = () => legacyFallback("PAY");
exports.makePurchaseNo = () => legacyFallback("PUR");
exports.makePurchasePaymentNo = () => legacyFallback("PPAY");
exports.makePurchaseAdvanceNo = () => legacyFallback("PADV");
exports.makeVoucherNo = () => legacyFallback("VCH");
exports.makeOrderNoTx = makeOrderNoTx;
exports.makeInvoiceNoTx = makeInvoiceNoTx;
exports.makePaymentNoTx = makePaymentNoTx;
exports.makePurchaseNoTx = makePurchaseNoTx;
exports.makePurchasePaymentNoTx = makePurchasePaymentNoTx;
exports.makePurchaseAdvanceNoTx = makePurchaseAdvanceNoTx;
exports.makeVoucherNoTx = makeVoucherNoTx;
