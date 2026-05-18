const prisma = require("../config/db");

function toNumber(value) {
  const n = typeof value === "string" ? Number(value) : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function balanceViewFromValue(value) {
  if (value > 0) return { side: "DEBIT", amount: value };
  if (value < 0) return { side: "CREDIT", amount: Math.abs(value) };
  return { side: "BALANCED", amount: 0 };
}

async function buildClientLedger({ company_id, clientId, factory_id = null, date_from = null, date_to = null }) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, company_id },
    select: {
      id: true,
      company_name: true,
      phone: true,
      mobile_no: true,
      email: true,
      address: true,
      gstin: true,
      opening_balance_amount: true,
      opening_balance_type: true,
      opening_balance_date: true
    }
  });
  if (!client) {
    const err = new Error("CLIENT_NOT_FOUND");
    err.statusCode = 404;
    throw err;
  }

  const endDateWhere = {};
  if (date_to) endDateWhere.lte = date_to;
  const hasEndDateFilter = Object.keys(endDateWhere).length > 0;

  const entries = [];

  const openingAmount = toNumber(client.opening_balance_amount);
  const openingDate = client.opening_balance_date || null;
  if (openingAmount > 0 && (!hasEndDateFilter || !openingDate || (endDateWhere.lte ? openingDate <= endDateWhere.lte : true))) {
    entries.push({
      source_type: "OPENING_BALANCE",
      source_id: client.id,
      date: openingDate || new Date(0),
      reference_no: null,
      particulars: "Opening Balance",
      debit: client.opening_balance_type === "DEBIT" ? openingAmount : 0,
      credit: client.opening_balance_type === "CREDIT" ? openingAmount : 0,
      meta: {}
    });
  }

  const invoiceWhere = { company_id, client_id: clientId, is_active: true, kind: { not: "PROFORMA" }, ...(factory_id ? { factory_id } : {}) };
  if (hasEndDateFilter) invoiceWhere.issue_date = endDateWhere;
  const invoices = await prisma.invoice.findMany({
    where: invoiceWhere,
    select: { id: true, invoice_no: true, kind: true, issue_date: true, total: true, status: true }
  });
  for (const inv of invoices) {
    const amt = toNumber(inv.total);
    const credit = inv.kind === "CREDIT_NOTE" ? amt : 0;
    const debit = inv.kind === "CREDIT_NOTE" ? 0 : amt;
    entries.push({
      source_type: "INVOICE",
      source_id: inv.id,
      date: inv.issue_date,
      reference_no: inv.invoice_no,
      particulars: inv.kind === "DEBIT_NOTE" ? "Sales Debit Note" : inv.kind === "CREDIT_NOTE" ? "Sales Credit Note" : "Sales Invoice",
      debit,
      credit,
      meta: { status: inv.status, kind: inv.kind }
    });
  }

  const paymentWhere = { company_id, client_id: clientId, status: "RECORDED", ...(factory_id ? { factory_id } : {}) };
  if (hasEndDateFilter) paymentWhere.paid_at = endDateWhere;
  const payments = await prisma.payment.findMany({
    where: paymentWhere,
    select: { id: true, payment_no: true, paid_at: true, amount: true, method: true, reference: true }
  });
  for (const pay of payments) {
    entries.push({
      source_type: "PAYMENT_RECEIVED",
      source_id: pay.id,
      date: pay.paid_at,
      reference_no: pay.payment_no || pay.reference || pay.id,
      particulars: `Payment Received${pay.method ? ` (${pay.method})` : ""}`,
      debit: 0,
      credit: toNumber(pay.amount),
      meta: { method: pay.method, reference: pay.reference }
    });
  }


const purchaseWhere = { company_id, client_id: clientId, is_active: true, ...(factory_id ? { factory_id } : {}) };
if (hasEndDateFilter) purchaseWhere.purchase_date = endDateWhere;
const purchases = await prisma.purchase.findMany({
  where: purchaseWhere,
  select: {
    id: true,
    purchase_no: true,
    purchase_date: true,
    total: true,
    payments: {
      where: { company_id, status: "RECORDED", source_kind: "DIRECT", ...(hasEndDateFilter ? { paid_at: endDateWhere } : {}) },
      select: { id: true, payment_no: true, paid_at: true, amount: true, method: true, reference: true }
    }
  }
});
for (const p of purchases) {
  entries.push({
    source_type: "PURCHASE",
    source_id: p.id,
    date: p.purchase_date,
    reference_no: p.purchase_no,
    particulars: "Purchase",
    debit: 0,
    credit: toNumber(p.total),
    meta: {}
  });
  for (const payment of p.payments || []) {
    entries.push({
      source_type: "PURCHASE_PAYMENT",
      source_id: payment.id,
      date: payment.paid_at,
      reference_no: payment.payment_no || payment.reference || payment.id,
      particulars: `Purchase Payment${payment.method ? ` (${payment.method})` : ""}`,
      debit: toNumber(payment.amount),
      credit: 0,
      meta: { method: payment.method, reference: payment.reference, purchase_id: p.id }
    });
  }
}

  const purchaseAdvanceWhere = { company_id, client_id: clientId, status: 'RECORDED', ...(factory_id ? { factory_id } : {}) };
  if (hasEndDateFilter) purchaseAdvanceWhere.paid_at = endDateWhere;
  const purchaseAdvances = await prisma.purchaseAdvance.findMany({
    where: purchaseAdvanceWhere,
    select: { id: true, advance_no: true, paid_at: true, amount: true, method: true, reference: true, notes: true }
  });
  for (const adv of purchaseAdvances) {
    entries.push({
      source_type: 'PURCHASE_ADVANCE',
      source_id: adv.id,
      date: adv.paid_at,
      reference_no: adv.advance_no || adv.reference || adv.id,
      particulars: `Client Payment Sent${adv.method ? ` (${adv.method})` : ''}`,
      debit: toNumber(adv.amount),
      credit: 0,
      meta: { method: adv.method, reference: adv.reference, notes: adv.notes }
    });
  }

const voucherLines = await prisma.accountingVoucherLine.findMany({
    where: {
      company_id,
      client_id: clientId,
      voucher: {
        is_active: true,
        ...(factory_id ? { factory_id } : {}),
        ...(hasEndDateFilter ? { voucher_date: endDateWhere } : {})
      }
    },
    orderBy: [{ voucher: { voucher_date: "asc" } }, { sort_order: "asc" }, { created_at: "asc" }],
    include: {
      voucher: {
        select: {
          id: true,
          voucher_no: true,
          voucher_type: true,
          business_side: true,
          voucher_date: true,
          narration: true,
          particulars: true
        }
      }
    }
  });

  const fallbackVouchers = await prisma.accountingVoucher.findMany({
    where: {
      company_id,
      client_id: clientId,
      is_active: true,
      ...(factory_id ? { factory_id } : {}),
      ...(hasEndDateFilter ? { voucher_date: endDateWhere } : {}),
      lines: { none: { client_id: clientId } }
    },
    orderBy: [{ voucher_date: "asc" }, { created_at: "asc" }],
    include: {
      lines: {
        where: { client_id: null },
        orderBy: [{ sort_order: "asc" }, { created_at: "asc" }],
        take: 1
      }
    }
  });

  const voucherEntryRows = [];
  for (const line of voucherLines) {
    voucherEntryRows.push({
      voucher: line.voucher,
      amount: line.amount,
      entry_type: line.entry_type,
      account_name: line.account_name,
      description: line.description,
      voucher_id: line.voucher_id
    });
  }
  for (const voucher of fallbackVouchers) {
    const firstLine = Array.isArray(voucher.lines) ? voucher.lines[0] : null;
    if (!firstLine) continue;
    voucherEntryRows.push({
      voucher,
      amount: firstLine.amount,
      entry_type: firstLine.entry_type,
      account_name: firstLine.account_name,
      description: firstLine.description,
      voucher_id: voucher.id
    });
  }

  for (const line of voucherEntryRows) {
    entries.push({
      source_type: "VOUCHER",
      source_id: line.voucher_id,
      date: line.voucher.voucher_date,
      reference_no: line.voucher.voucher_no,
      particulars:
        line.voucher.particulars ||
        line.voucher.narration ||
        (line.voucher.voucher_type === "DEBIT_NOTE" ? "Debit Note" : line.voucher.voucher_type === "CREDIT_NOTE" ? "Credit Note" : line.account_name),
      debit: line.entry_type === "DEBIT" ? toNumber(line.amount) : 0,
      credit: line.entry_type === "CREDIT" ? toNumber(line.amount) : 0,
      meta: {
        voucher_type: line.voucher.voucher_type,
        business_side: line.voucher.business_side,
        account_name: line.account_name,
        description: line.description
      }
    });
  }

  entries.sort((a, b) => {
    const at = new Date(a.date).getTime();
    const bt = new Date(b.date).getTime();
    if (at !== bt) return at - bt;
    return String(a.reference_no || a.source_id).localeCompare(String(b.reference_no || b.source_id));
  });

  let broughtForward = 0;
  const visibleEntries = [];
  for (const entry of entries) {
    const delta = toNumber(entry.debit) - toNumber(entry.credit);
    if (date_from && new Date(entry.date) < date_from) {
      broughtForward += delta;
      continue;
    }
    visibleEntries.push(entry);
  }

  if (date_from && Math.abs(broughtForward) > 0.0001) {
    visibleEntries.unshift({
      source_type: "BROUGHT_FORWARD",
      source_id: client.id,
      date: date_from,
      reference_no: null,
      particulars: "B/F Opening Balance",
      debit: broughtForward > 0 ? broughtForward : 0,
      credit: broughtForward < 0 ? Math.abs(broughtForward) : 0,
      meta: {}
    });
  }

  let running = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  const normalizedEntries = visibleEntries.map((entry) => {
    const debit = toNumber(entry.debit);
    const credit = toNumber(entry.credit);
    totalDebit += debit;
    totalCredit += credit;
    running += debit - credit;
    const balance = balanceViewFromValue(running);
    return {
      ...entry,
      debit,
      credit,
      running_balance_value: running,
      running_balance_side: balance.side,
      running_balance_amount: balance.amount
    };
  });

  const closing = balanceViewFromValue(running);

  return {
    client,
    filters: {
      factory_id: factory_id || null,
      date_from: date_from ? date_from.toISOString() : null,
      date_to: date_to ? date_to.toISOString() : null
    },
    totals: {
      opening_balance_side: balanceViewFromValue(broughtForward).side,
      opening_balance_amount: balanceViewFromValue(broughtForward).amount,
      total_debit: totalDebit,
      total_credit: totalCredit,
      closing_balance_side: closing.side,
      closing_balance_amount: closing.amount,
      closing_balance_value: running
    },
    entries: normalizedEntries
  };
}

module.exports = {
  buildClientLedger,
  toNumber,
  balanceViewFromValue
};
