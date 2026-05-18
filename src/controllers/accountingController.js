const prisma = require("../config/db");
const logActivity = require("../utils/activityLogger");
const { makeVoucherNoTx } = require("../utils/numbering");
const { buildTempPdfPath } = require("../utils/fileStorage");
const { streamPdfAndDelete } = require("../utils/pdfResponse");
const { createMovementTx, applyBalanceDeltaTx, movementDelta } = require("../services/inventoryLedgerService");
const { generateVoucherPdfToFile } = require("../services/pdf/voucherPdf");
const { generateClientLedgerPdfToFile } = require("../services/pdf/clientLedgerPdf");
const { buildClientLedger } = require("../services/ledgerService");
const { getPagination, buildPaginationMeta } = require("../utils/pagination");
const { parseDateOrNull, resolveDateRangeFromQuery, parseMonthKey, getCalendarMonthRange } = require("../utils/fiscalYear");
const { recomputeInvoiceStatusTx: sharedRecomputeInvoiceStatusTx } = require("../services/orderInvoiceService");

function normalizeString(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s || null;
}

function toNumber(v) {
  const n = typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function oppositeSide(side) {
  return String(side || "").toUpperCase() === "DEBIT" ? "CREDIT" : "DEBIT";
}

function noteMovementType(voucherType, businessSide) {
  const vt = String(voucherType || "").toUpperCase();
  const bs = String(businessSide || "").toUpperCase();
  if (bs === "SALES" && vt === "CREDIT_NOTE") return "IN";
  if (bs === "SALES" && vt === "DEBIT_NOTE") return "OUT";
  if (bs === "PURCHASE" && vt === "DEBIT_NOTE") return "OUT";
  if (bs === "PURCHASE" && vt === "CREDIT_NOTE") return "IN";
  return null;
}

function noteCounterLabel(voucherType, businessSide) {
  const vt = String(voucherType || "").toUpperCase();
  const bs = String(businessSide || "").toUpperCase();
  if (bs === "SALES" && vt === "CREDIT_NOTE") return "Sales Return Adjustment";
  if (bs === "SALES" && vt === "DEBIT_NOTE") return "Sales Debit Adjustment";
  if (bs === "PURCHASE" && vt === "DEBIT_NOTE") return "Purchase Return Adjustment";
  if (bs === "PURCHASE" && vt === "CREDIT_NOTE") return "Purchase Credit Adjustment";
  return "Adjustment";
}


async function recomputeInvoiceStatusTx(tx, company_id, invoice_id, user_id) {
  return sharedRecomputeInvoiceStatusTx(tx, { company_id, invoice_id, user_id });
}

async function syncPurchasePaymentSnapshotTx(tx, company_id, purchase_id) {
  const payments = await tx.purchasePayment.findMany({
    where: { company_id, purchase_id, status: "RECORDED" },
    orderBy: [{ paid_at: "desc" }, { created_at: "desc" }]
  });

  const totalPaid = payments.reduce((acc, payment) => acc + toNumber(payment.amount), 0);
  const latestPayment = payments[0] || null;

  await tx.purchase.update({
    where: { id: purchase_id },
    data: {
      paid_amount: totalPaid,
      payment_method: latestPayment?.method ?? null,
      paid_at: latestPayment?.paid_at ?? null,
      payment_reference: latestPayment?.reference ?? null,
      payment_notes: latestPayment?.notes ?? null
    }
  });

  return { total_paid_amount: totalPaid, latest_payment_id: latestPayment?.id || null };
}

function dedupeById(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function buildMonthDeleteFactoryFilter(factory_id) {
  if (!factory_id) return {};
  const normalized = String(factory_id).trim();
  if (!normalized || ["all", "ALL", "*", "bhikam", "BHIKAM"].includes(normalized)) return {};
  return { factory_id: normalized };
}

function requireMonthRange(input) {
  const parsed = parseMonthKey(input);
  if (!parsed) {
    const err = new Error("INVALID_MONTH_KEY");
    err.statusCode = 400;
    throw err;
  }
  return getCalendarMonthRange(parsed);
}

async function loadLedgerMonthDeleteScope(db, { company_id, clientId, month_key, factory_id = null }) {
  const month = requireMonthRange(month_key);
  const client = await db.client.findFirst({
    where: { id: clientId, company_id, is_active: true },
    select: { id: true, company_name: true }
  });
  if (!client) {
    const err = new Error("CLIENT_NOT_FOUND");
    err.statusCode = 404;
    throw err;
  }

  const commonFactory = buildMonthDeleteFactoryFilter(factory_id);
  const monthRange = { gte: month.start, lte: month.end };

  const directInvoices = await db.invoice.findMany({
    where: {
      company_id,
      client_id: clientId,
      is_active: true,
      kind: { not: "PROFORMA" },
      issue_date: monthRange,
      ...commonFactory
    },
    select: { id: true, invoice_no: true, issue_date: true, total: true, status: true, factory_id: true }
  });

  const directPayments = await db.payment.findMany({
    where: {
      company_id,
      client_id: clientId,
      status: "RECORDED",
      paid_at: monthRange,
      ...commonFactory
    },
    select: {
      id: true,
      payment_no: true,
      paid_at: true,
      amount: true,
      method: true,
      reference: true,
      remarks: true,
      factory_id: true,
      status: true,
      allocations: { where: { is_active: true }, select: { id: true, invoice_id: true } }
    }
  });

  const directPurchases = await db.purchase.findMany({
    where: {
      company_id,
      client_id: clientId,
      is_active: true,
      purchase_date: monthRange,
      ...commonFactory
    },
    select: { id: true, purchase_no: true, purchase_date: true, total: true, status: true, factory_id: true }
  });

  const directPurchasePayments = await db.purchasePayment.findMany({
    where: {
      company_id,
      status: "RECORDED",
      paid_at: monthRange,
      purchase: {
        client_id: clientId,
        is_active: true,
        ...commonFactory
      }
    },
    select: { id: true, payment_no: true, purchase_id: true, paid_at: true, amount: true, method: true, reference: true, source_kind: true, advance_id: true }
  });

  const directPurchaseAdvances = await db.purchaseAdvance.findMany({
    where: {
      company_id,
      client_id: clientId,
      status: "RECORDED",
      paid_at: monthRange,
      ...commonFactory
    },
    select: { id: true, advance_no: true, paid_at: true, amount: true, method: true, reference: true, factory_id: true }
  });

  const directVoucherCandidates = await db.accountingVoucher.findMany({
    where: {
      company_id,
      is_active: true,
      voucher_date: monthRange,
      ...commonFactory,
      OR: [{ client_id: clientId }, { lines: { some: { client_id: clientId } } }]
    },
    select: {
      id: true,
      voucher_no: true,
      voucher_type: true,
      voucher_date: true,
      total_amount: true,
      invoice_id: true,
      purchase_id: true,
      factory_id: true
    }
  });

  const directInvoiceIds = directInvoices.map((row) => row.id);
  const directPurchaseIds = directPurchases.map((row) => row.id);

  const cascadedPurchasePayments = directPurchaseIds.length
    ? await db.purchasePayment.findMany({
        where: {
          company_id,
          purchase_id: { in: directPurchaseIds },
          status: "RECORDED",
          id: { notIn: directPurchasePayments.map((row) => row.id) }
        },
        select: { id: true, payment_no: true, purchase_id: true, paid_at: true, amount: true, method: true, reference: true, source_kind: true, advance_id: true }
      })
    : [];

  const cascadedLinkedVouchers = directInvoiceIds.length || directPurchaseIds.length
    ? await db.accountingVoucher.findMany({
        where: {
          company_id,
          is_active: true,
          OR: [
            ...(directInvoiceIds.length ? [{ invoice_id: { in: directInvoiceIds } }] : []),
            ...(directPurchaseIds.length ? [{ purchase_id: { in: directPurchaseIds } }] : [])
          ],
          id: { notIn: directVoucherCandidates.map((row) => row.id) }
        },
        select: {
          id: true,
          voucher_no: true,
          voucher_type: true,
          voucher_date: true,
          total_amount: true,
          invoice_id: true,
          purchase_id: true,
          factory_id: true
        }
      })
    : [];

  const vouchers = dedupeById([...directVoucherCandidates, ...cascadedLinkedVouchers]);
  const purchasePayments = dedupeById([...directPurchasePayments, ...cascadedPurchasePayments]);

  const voucherIds = vouchers.map((row) => row.id);
  const stockMovements = voucherIds.length
    ? await db.inventoryMovement.findMany({
        where: {
          company_id,
          source_type: "RETURN",
          source_id: { in: voucherIds }
        },
        select: {
          id: true,
          factory_id: true,
          product_id: true,
          type: true,
          quantity: true,
          source_id: true,
          date: true,
          remarks: true
        }
      })
    : [];

  const directPaymentIds = directPayments.map((row) => row.id);
  const directPaymentExtraAllocations = directPaymentIds.length
    ? await db.paymentAllocation.findMany({
        where: {
          company_id,
          payment_id: { in: directPaymentIds },
          is_active: true
        },
        select: { id: true, payment_id: true, invoice_id: true }
      })
    : [];

  const invoiceAllocationDetaches = directInvoiceIds.length
    ? await db.paymentAllocation.findMany({
        where: {
          company_id,
          invoice_id: { in: directInvoiceIds },
          is_active: true,
          payment: { status: "RECORDED", id: { notIn: directPaymentIds } }
        },
        select: { id: true, payment_id: true, invoice_id: true }
      })
    : [];

  return {
    client,
    month_key: month.month_key,
    date_from: month.start,
    date_to: month.end,
    factory_id: factory_id || null,
    direct: {
      invoices: directInvoices,
      payments: directPayments,
      purchases: directPurchases,
      purchase_payments: directPurchasePayments,
      purchase_advances: directPurchaseAdvances,
      vouchers: directVoucherCandidates
    },
    cascaded: {
      purchase_payments: cascadedPurchasePayments,
      vouchers: cascadedLinkedVouchers,
      detached_allocations: invoiceAllocationDetaches
    },
    targets: {
      invoices: directInvoices,
      payments: directPayments,
      purchases: directPurchases,
      purchase_payments: purchasePayments,
      purchase_advances: directPurchaseAdvances,
      vouchers,
      stock_movements: stockMovements,
      payment_allocations_for_reversed_payments: directPaymentExtraAllocations,
      payment_allocations_to_detach: invoiceAllocationDetaches
    }
  };
}

function serializeMonthDeletePreview(scope) {
  return {
    client: scope.client,
    filters: {
      month_key: scope.month_key,
      date_from: scope.date_from.toISOString(),
      date_to: scope.date_to.toISOString(),
      factory_id: scope.factory_id
    },
    direct_counts: {
      invoices: scope.direct.invoices.length,
      payments: scope.direct.payments.length,
      purchases: scope.direct.purchases.length,
      purchase_payments: scope.direct.purchase_payments.length,
      purchase_advances: scope.direct.purchase_advances.length,
      vouchers: scope.direct.vouchers.length
    },
    cascade_counts: {
      purchase_payments: scope.cascaded.purchase_payments.length,
      vouchers: scope.cascaded.vouchers.length,
      detached_allocations: scope.cascaded.detached_allocations.length
    },
    affected_inventory_movements_count: scope.targets.stock_movements.length,
    records: {
      direct: scope.direct,
      cascaded: scope.cascaded
    }
  };
}

async function resolveOptionalClient(company_id, client_id) {
  if (!client_id) return null;
  const client = await prisma.client.findFirst({
    where: { id: client_id, company_id, is_active: true },
    select: { id: true, company_name: true }
  });
  if (!client) throw new Error("CLIENT_NOT_FOUND");
  return client;
}

exports.getVouchers = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const voucher_type = normalizeString(req.query.voucher_type);
    const business_side = normalizeString(req.query.business_side);
    const client_id = normalizeString(req.query.client_id);
    const purchase_id = normalizeString(req.query.purchase_id);
    const invoice_id = normalizeString(req.query.invoice_id);
    const { date_from, date_to, fiscal_year } = resolveDateRangeFromQuery(req.query);

    const where = { company_id, is_active: true };
    if (voucher_type) where.voucher_type = voucher_type;
    if (business_side) where.business_side = business_side;
    if (client_id) where.client_id = client_id;
    if (purchase_id) where.purchase_id = purchase_id;
    if (invoice_id) where.invoice_id = invoice_id;
    if (date_from || date_to) {
      where.voucher_date = {};
      if (date_from) where.voucher_date.gte = date_from;
      if (date_to) where.voucher_date.lte = date_to;
    }

    const pagination = getPagination(req, { defaultPageSize: 25, maxPageSize: 100 });
    const query = {
      where,
      orderBy: [{ voucher_date: "desc" }, { created_at: "desc" }],
      include: {
        client: { select: { id: true, company_name: true } },
        factory: { select: { id: true, name: true } },
        purchase: { select: { id: true, purchase_no: true } },
        invoice: { select: { id: true, invoice_no: true } },
        _count: { select: { lines: true } }
      }
    };
    if (pagination.enabled) {
      query.skip = pagination.skip;
      query.take = pagination.take;
    }

    const [items, total] = await Promise.all([
      prisma.accountingVoucher.findMany(query),
      pagination.enabled && pagination.include_total ? prisma.accountingVoucher.count({ where }) : Promise.resolve(null)
    ]);

    if (!pagination.enabled) return res.json(items);

    return res.json({
      fiscal_year,
      items,
      pagination: buildPaginationMeta({ page: pagination.page, page_size: pagination.page_size, total: total ?? items.length })
    });
  } catch (err) {
    console.error("getVouchers error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getVoucherById = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;
    const voucher = await prisma.accountingVoucher.findFirst({
      where: { id, company_id, is_active: true },
      include: {
        client: { select: { id: true, company_name: true } },
        factory: { select: { id: true, name: true } },
        purchase: { select: { id: true, purchase_no: true } },
        invoice: { select: { id: true, invoice_no: true } },
        lines: {
          orderBy: [{ sort_order: "asc" }, { created_at: "asc" }],
          include: {
            client: { select: { id: true, company_name: true } },
            product: { select: { id: true, name: true, unit: true } }
          }
        }
      }
    });
    if (!voucher) return res.status(404).json({ message: "Voucher not found" });
    return res.json(voucher);
  } catch (err) {
    console.error("getVoucherById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.createVoucher = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const body = req.body || {};
    const voucher_type = normalizeString(body.voucher_type || "GENERAL") || "GENERAL";
    const voucher_date = parseDateOrNull(body.voucher_date) || new Date();
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length) return res.status(400).json({ message: "lines must be a non-empty array" });

    let totalDebit = 0;
    let totalCredit = 0;
    const normalizedLines = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] || {};
      const entry_type = normalizeString(line.entry_type)?.toUpperCase();
      if (!["DEBIT", "CREDIT"].includes(entry_type)) return res.status(400).json({ message: `Invalid entry_type at line ${i + 1}` });
      const amount = toNumber(line.amount);
      if (amount <= 0) return res.status(400).json({ message: `Line ${i + 1} amount must be > 0` });
      const account_name = normalizeString(line.account_name || line.description);
      if (!account_name) return res.status(400).json({ message: `Line ${i + 1} account_name is required` });
      totalDebit += entry_type === "DEBIT" ? amount : 0;
      totalCredit += entry_type === "CREDIT" ? amount : 0;
      normalizedLines.push({
        entry_type,
        account_name,
        description: normalizeString(line.description),
        client_id: normalizeString(line.client_id),
        product_id: normalizeString(line.product_id),
        quantity: line.quantity !== undefined && line.quantity !== null ? toNumber(line.quantity) : null,
        unit_price: line.unit_price !== undefined && line.unit_price !== null ? toNumber(line.unit_price) : null,
        amount,
        remarks: normalizeString(line.remarks),
        sort_order: i
      });
    }

    if (Math.abs(totalDebit - totalCredit) > 0.0001) {
      return res.status(400).json({ message: "Voucher must be balanced: total debit must equal total credit" });
    }

    const headerClient = await resolveOptionalClient(company_id, normalizeString(body.client_id));
    for (const line of normalizedLines) {
      if (line.client_id) await resolveOptionalClient(company_id, line.client_id);
    }

    const hasExplicitClientLine = normalizedLines.some((line) => Boolean(line.client_id));
    const linesForCreate = normalizedLines.map((line, index) => ({
      ...line,
      client_id: line.client_id || (!hasExplicitClientLine && headerClient?.id && index === 0 ? headerClient.id : null)
    }));

    const created = await prisma.$transaction(async (tx) => {
      const voucher = await tx.accountingVoucher.create({
        data: {
          company_id,
          factory_id: normalizeString(body.factory_id),
          client_id: headerClient?.id || null,
          purchase_id: normalizeString(body.purchase_id),
          invoice_id: normalizeString(body.invoice_id),
          voucher_no: normalizeString(body.voucher_no) || await makeVoucherNoTx(tx, company_id, voucher_type, voucher_date),
          voucher_type,
          business_side: normalizeString(body.business_side),
          voucher_date,
          narration: normalizeString(body.narration),
          particulars: normalizeString(body.particulars),
          total_amount: totalDebit,
          total_debit: totalDebit,
          total_credit: totalCredit,
          created_by: req.user.id
        }
      });

      await tx.accountingVoucherLine.createMany({
        data: linesForCreate.map((line) => ({
          company_id,
          voucher_id: voucher.id,
          client_id: line.client_id || null,
          product_id: line.product_id || null,
          entry_type: line.entry_type,
          account_name: line.account_name,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unit_price,
          amount: line.amount,
          remarks: line.remarks,
          sort_order: line.sort_order
        }))
      });

      return tx.accountingVoucher.findUnique({
        where: { id: voucher.id },
        include: { lines: true, client: { select: { id: true, company_name: true } } }
      });
    });

    await logActivity({
      company_id,
      factory_id: created.factory_id || null,
      user_id: req.user.id,
      action: "ACCOUNTING_VOUCHER_CREATED",
      entity_type: "accounting_voucher",
      entity_id: created.id,
      meta: { voucher_type: created.voucher_type }
    });

    return res.status(201).json(created);
  } catch (err) {
    if (err.message === "CLIENT_NOT_FOUND") return res.status(404).json({ message: "Client not found" });
    console.error("createVoucher error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.createNote = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const body = req.body || {};
    const voucher_type = normalizeString(body.voucher_type)?.toUpperCase();
    const business_side = normalizeString(body.business_side)?.toUpperCase();
    if (!["DEBIT_NOTE", "CREDIT_NOTE"].includes(voucher_type)) {
      return res.status(400).json({ message: "voucher_type must be DEBIT_NOTE or CREDIT_NOTE" });
    }
    if (!["SALES", "PURCHASE"].includes(business_side)) {
      return res.status(400).json({ message: "business_side must be SALES or PURCHASE" });
    }

    const voucherDate = parseDateOrNull(body.voucher_date) || new Date();
    const items = Array.isArray(body.items) ? body.items : [];
    const charges = Array.isArray(body.charges) ? body.charges : [];
    if (!items.length && !charges.length) {
      return res.status(400).json({ message: "At least one item or charge is required" });
    }

    let linkedInvoice = null;
    let linkedPurchase = null;
    let linkedClient = null;

    if (body.invoice_id) {
      linkedInvoice = await prisma.invoice.findFirst({
        where: { id: body.invoice_id, company_id, is_active: true },
        select: { id: true, invoice_no: true, client_id: true, factory_id: true }
      });
      if (!linkedInvoice) return res.status(404).json({ message: "Invoice not found" });
    }

    if (body.purchase_id) {
      linkedPurchase = await prisma.purchase.findFirst({
        where: { id: body.purchase_id, company_id, is_active: true },
        select: { id: true, purchase_no: true, client_id: true, factory_id: true, vendor_name: true }
      });
      if (!linkedPurchase) return res.status(404).json({ message: "Purchase not found" });
    }

    const resolvedClientId = normalizeString(body.client_id) || linkedInvoice?.client_id || linkedPurchase?.client_id || null;
    linkedClient = await resolveOptionalClient(company_id, resolvedClientId);
    const resolvedFactoryId = normalizeString(body.factory_id) || linkedInvoice?.factory_id || linkedPurchase?.factory_id || null;

    const detailRows = [];
    let totalAmount = 0;
    for (const [idx, item] of items.entries()) {
      const description = normalizeString(item.description || item.label || `Item ${idx + 1}`);
      const quantity = item.quantity !== undefined && item.quantity !== null ? toNumber(item.quantity) : null;
      const unit_price = item.unit_price !== undefined && item.unit_price !== null ? toNumber(item.unit_price) : null;
      const amount = item.amount !== undefined && item.amount !== null ? toNumber(item.amount) : ((quantity || 0) * (unit_price || 0));
      if (amount <= 0) return res.status(400).json({ message: `Item ${idx + 1} amount must be > 0` });
      detailRows.push({
        product_id: normalizeString(item.product_id),
        description,
        quantity,
        unit_price,
        amount,
        remarks: normalizeString(item.remarks)
      });
      totalAmount += amount;
    }
    for (const charge of charges) {
      const amount = toNumber(charge.amount);
      if (amount <= 0) continue;
      detailRows.push({
        product_id: null,
        description: normalizeString(charge.label) || "Charge",
        quantity: null,
        unit_price: null,
        amount,
        remarks: normalizeString(charge.remarks)
      });
      totalAmount += amount;
    }
    if (totalAmount <= 0) return res.status(400).json({ message: "Total note amount must be > 0" });

    const stockProductIds = [...new Set(detailRows.filter((row) => row.product_id).map((row) => row.product_id))];
    if (body.apply_stock) {
      for (const row of detailRows) {
        if (!row.product_id) continue;
        if (!row.quantity || row.quantity <= 0) {
          return res.status(400).json({ message: "Stock-applied note items require product_id and quantity > 0" });
        }
      }
    }
    if (stockProductIds.length) {
      const products = await prisma.product.findMany({ where: { company_id, id: { in: stockProductIds }, is_active: true }, select: { id: true } });
      if (products.length !== stockProductIds.length) {
        return res.status(404).json({ message: "One or more note products were not found" });
      }
    }

    const partySide = voucher_type === "DEBIT_NOTE" ? "DEBIT" : "CREDIT";
    const counterSide = oppositeSide(partySide);
    const counterLabel = noteCounterLabel(voucher_type, business_side);
    const movementType = noteMovementType(voucher_type, business_side);

    const created = await prisma.$transaction(async (tx) => {
      const voucher = await tx.accountingVoucher.create({
        data: {
          company_id,
          factory_id: resolvedFactoryId,
          client_id: linkedClient?.id || null,
          purchase_id: linkedPurchase?.id || null,
          invoice_id: linkedInvoice?.id || null,
          voucher_no: normalizeString(body.voucher_no) || await makeVoucherNoTx(tx, company_id, voucher_type, voucherDate),
          voucher_type,
          business_side,
          voucher_date: voucherDate,
          narration: normalizeString(body.narration),
          particulars: normalizeString(body.particulars),
          total_amount: totalAmount,
          total_debit: totalAmount,
          total_credit: totalAmount,
          created_by: req.user.id
        }
      });

      const lines = [
        {
          company_id,
          voucher_id: voucher.id,
          client_id: linkedClient?.id || null,
          product_id: null,
          entry_type: partySide,
          account_name: linkedClient?.company_name || linkedPurchase?.vendor_name || "Party",
          description: normalizeString(body.particulars) || normalizeString(body.narration) || voucher_type.replace(/_/g, " "),
          quantity: null,
          unit_price: null,
          amount: totalAmount,
          remarks: null,
          sort_order: 0
        },
        ...detailRows.map((row, idx) => ({
          company_id,
          voucher_id: voucher.id,
          client_id: null,
          product_id: row.product_id,
          entry_type: counterSide,
          account_name: counterLabel,
          description: row.description,
          quantity: row.quantity,
          unit_price: row.unit_price,
          amount: row.amount,
          remarks: row.remarks,
          sort_order: idx + 1
        }))
      ];

      await tx.accountingVoucherLine.createMany({ data: lines });

      if (body.apply_stock && movementType) {
        if (!resolvedFactoryId) throw new Error("FACTORY_REQUIRED_FOR_STOCK");
        for (const row of detailRows) {
          if (!row.product_id || !row.quantity || row.quantity <= 0) continue;
          await createMovementTx(tx, {
            company_id,
            factory_id: resolvedFactoryId,
            product_id: row.product_id,
            type: movementType,
            source_type: "RETURN",
            source_id: voucher.id,
            date: voucherDate,
            quantity: row.quantity,
            remarks: `${voucher_type.replace(/_/g, " ")} - ${row.description}`,
            created_by: req.user.id
          });
        }
      }

      return tx.accountingVoucher.findUnique({
        where: { id: voucher.id },
        include: {
          client: { select: { id: true, company_name: true } },
          invoice: { select: { id: true, invoice_no: true } },
          purchase: { select: { id: true, purchase_no: true } },
          lines: { orderBy: [{ sort_order: "asc" }, { created_at: "asc" }] }
        }
      });
    });

    await logActivity({
      company_id,
      factory_id: created.factory_id || null,
      user_id: req.user.id,
      action: `${voucher_type}_CREATED`,
      entity_type: "accounting_voucher",
      entity_id: created.id,
      meta: { business_side }
    });

    return res.status(201).json(created);
  } catch (err) {
    if (err.message === "CLIENT_NOT_FOUND") return res.status(404).json({ message: "Client not found" });
    if (err.message === "FACTORY_REQUIRED_FOR_STOCK") return res.status(400).json({ message: "factory_id is required when apply_stock=true and stock items are present" });
    console.error("createNote error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};


exports.getClientLedgerMonthDeletePreview = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId } = req.params;
    const month_key = normalizeString(req.query.month_key || req.body?.month_key);
    const factory_id = normalizeString(req.query.factory_id || req.body?.factory_id);

    const scope = await loadLedgerMonthDeleteScope(prisma, {
      company_id,
      clientId,
      month_key,
      factory_id
    });

    return res.json(serializeMonthDeletePreview(scope));
  } catch (err) {
    if (err.message === 'CLIENT_NOT_FOUND') return res.status(404).json({ message: 'Client not found' });
    if (err.message === 'INVALID_MONTH_KEY') return res.status(400).json({ message: 'month_key must be in YYYY-MM format' });
    console.error('getClientLedgerMonthDeletePreview error:', err);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Internal server error' });
  }
};

exports.deleteClientLedgerMonthData = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId } = req.params;
    const month_key = normalizeString(req.body?.month_key || req.query.month_key);
    const factory_id = normalizeString(req.body?.factory_id || req.query.factory_id);
    const reason = normalizeString(req.body?.reason || req.body?.note);

    // Keep the interactive transaction focused on mutations so Prisma's timeout
    // budget is not spent on the preview/scope discovery queries.
    const scope = await loadLedgerMonthDeleteScope(prisma, {
      company_id,
      clientId,
      month_key,
      factory_id
    });

    const result = await prisma.$transaction(async (tx) => {

      const targetInvoiceIds = scope.targets.invoices.map((row) => row.id);
      const targetPaymentIds = scope.targets.payments.map((row) => row.id);
      const targetPurchaseIds = scope.targets.purchases.map((row) => row.id);
      const targetPurchasePaymentIds = scope.targets.purchase_payments.map((row) => row.id);
      const targetPurchaseAdvanceIds = scope.targets.purchase_advances.map((row) => row.id);
      const targetVoucherIds = scope.targets.vouchers.map((row) => row.id);
      const affectedInvoiceIdsForRecompute = new Set();

      for (const movement of scope.targets.stock_movements) {
        const reverseDelta = -movementDelta(movement.type, movement.quantity);
        await applyBalanceDeltaTx(tx, {
          company_id,
          factory_id: movement.factory_id,
          product_id: movement.product_id,
          delta: reverseDelta,
          allowNegative: false
        });
        await tx.inventoryMovement.delete({ where: { id: movement.id } });
      }

      if (targetVoucherIds.length) {
        await tx.accountingVoucher.updateMany({
          where: { company_id, id: { in: targetVoucherIds }, is_active: true },
          data: { is_active: false }
        });
      }

      if (targetPurchaseAdvanceIds.length) {
        const appliedAdvanceAgg = await tx.purchasePayment.groupBy({
          by: ['advance_id'],
          where: { company_id, advance_id: { in: targetPurchaseAdvanceIds }, status: 'RECORDED', id: { notIn: targetPurchasePaymentIds } },
          _sum: { amount: true }
        });
        const blockedAdvanceIds = appliedAdvanceAgg.filter((row) => Number(row._sum?.amount || 0) > 0).map((row) => row.advance_id).filter(Boolean);
        if (blockedAdvanceIds.length) {
          const err = new Error('PURCHASE_ADVANCE_ALREADY_APPLIED');
          err.statusCode = 400;
          err.meta = { blocked_advance_ids: blockedAdvanceIds };
          throw err;
        }

        await tx.purchaseAdvance.updateMany({
          where: { company_id, id: { in: targetPurchaseAdvanceIds }, status: 'RECORDED' },
          data: {
            status: 'REVERSED',
            reversed_at: new Date(),
            reversed_by: req.user.id,
            reversal_note: reason || `Ledger month cleanup ${scope.month_key}`
          }
        });
      }

      if (targetPurchasePaymentIds.length) {
        const advanceRestores = new Map();
        for (const payment of scope.targets.purchase_payments) {
          if (payment.source_kind === 'ADVANCE_APPLIED' && payment.advance_id) {
            advanceRestores.set(payment.advance_id, (advanceRestores.get(payment.advance_id) || 0) + Number(payment.amount || 0));
          }
        }

        await tx.purchasePayment.updateMany({
          where: { company_id, id: { in: targetPurchasePaymentIds }, status: 'RECORDED' },
          data: {
            status: 'REVERSED',
            reversed_at: new Date(),
            reversed_by: req.user.id,
            reversal_note: reason || `Ledger month cleanup ${scope.month_key}`
          }
        });

        for (const [advance_id, amount] of advanceRestores.entries()) {
          await tx.purchaseAdvance.update({
            where: { id: advance_id },
            data: { remaining_amount: { increment: amount } }
          });
        }
      }

      if (targetPurchaseIds.length) {
        await tx.purchase.updateMany({
          where: { company_id, id: { in: targetPurchaseIds }, is_active: true },
          data: { is_active: false }
        });
      }

      const affectedPurchaseIdsForSync = [...new Set(scope.targets.purchase_payments.map((row) => row.purchase_id).filter(Boolean))];
      for (const purchaseId of [...new Set([...targetPurchaseIds, ...affectedPurchaseIdsForSync])]) {
        await syncPurchasePaymentSnapshotTx(tx, company_id, purchaseId);
      }

      if (scope.targets.payment_allocations_to_detach.length) {
        await tx.paymentAllocation.updateMany({
          where: {
            company_id,
            id: { in: scope.targets.payment_allocations_to_detach.map((row) => row.id) },
            is_active: true
          },
          data: { is_active: false }
        });
      }

      if (targetPaymentIds.length) {
        for (const payment of scope.targets.payments) {
          if (payment.status === 'REVERSED') continue;
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: 'REVERSED',
              remarks: reason
                ? `${payment.remarks ? `${payment.remarks}
` : ''}[Ledger Month Cleanup] ${reason}`
                : (payment.remarks ? `${payment.remarks}
[Ledger Month Cleanup]` : '[Ledger Month Cleanup]')
            }
          });
        }

        if (scope.targets.payment_allocations_for_reversed_payments.length) {
          await tx.paymentAllocation.updateMany({
            where: {
              company_id,
              id: { in: scope.targets.payment_allocations_for_reversed_payments.map((row) => row.id) },
              is_active: true
            },
            data: { is_active: false }
          });
        }

        for (const alloc of scope.targets.payment_allocations_for_reversed_payments) {
          if (alloc.invoice_id && !targetInvoiceIds.includes(alloc.invoice_id)) {
            affectedInvoiceIdsForRecompute.add(alloc.invoice_id);
          }
        }
      }

      if (targetInvoiceIds.length) {
        await tx.invoice.updateMany({
          where: { company_id, id: { in: targetInvoiceIds }, is_active: true },
          data: { is_active: false, status: 'VOID' }
        });

        await tx.invoiceStatusHistory.createMany({
          data: targetInvoiceIds.map((invoice_id) => ({
            company_id,
            invoice_id,
            status: 'VOID',
            note: reason ? `Invoice voided by ledger month cleanup: ${reason}` : 'Invoice voided by ledger month cleanup',
            created_by: req.user.id
          }))
        });
      }

      for (const invoiceId of affectedInvoiceIdsForRecompute) {
        await recomputeInvoiceStatusTx(tx, company_id, invoiceId, req.user.id);
      }

      return {
        scope: serializeMonthDeletePreview(scope),
        deleted: {
          vouchers_deactivated: targetVoucherIds.length,
          payments_reversed: targetPaymentIds.length,
          purchases_deactivated: targetPurchaseIds.length,
          purchase_payments_reversed: targetPurchasePaymentIds.length,
          purchase_advances_reversed: targetPurchaseAdvanceIds.length,
          invoices_voided: targetInvoiceIds.length,
          payment_allocations_detached:
            scope.targets.payment_allocations_to_detach.length +
            scope.targets.payment_allocations_for_reversed_payments.length,
          stock_movements_deleted: scope.targets.stock_movements.length
        }
      };
    }, { maxWait: 5000, timeout: 20000 });

    await logActivity({
      company_id,
      factory_id: factory_id || null,
      user_id: req.user.id,
      action: 'CLIENT_LEDGER_MONTH_DELETED',
      entity_type: 'client_ledger_month',
      entity_id: `${clientId}:${month_key}`,
      meta: {
        client_id: clientId,
        month_key,
        factory_id: factory_id || null,
        reason: reason || null,
        deleted: result.deleted
      }
    });

    return res.json({
      message: 'Ledger month data reversed/deactivated successfully',
      ...result
    });
  } catch (err) {
    if (err.message === 'CLIENT_NOT_FOUND') return res.status(404).json({ message: 'Client not found' });
    if (err.message === 'INVALID_MONTH_KEY') return res.status(400).json({ message: 'month_key must be in YYYY-MM format' });
    if (err?.message === 'INSUFFICIENT_STOCK') {
      return res.status(400).json({
        message: 'Cannot remove this month because stock from linked voucher adjustments has already been consumed',
        meta: err.meta || null
      });
    }
    console.error('deleteClientLedgerMonthData error:', err);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Internal server error' });
  }
};

exports.getClientLedger = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId } = req.params;
    const { date_from, date_to, fiscal_year } = resolveDateRangeFromQuery(req.query);
    const ledger = await buildClientLedger({
      company_id,
      clientId,
      factory_id: normalizeString(req.query.factory_id),
      date_from,
      date_to
    });
    ledger.filters.fiscal_year = fiscal_year;
    return res.json(ledger);
  } catch (err) {
    if (err.message === "CLIENT_NOT_FOUND") return res.status(404).json({ message: "Client not found" });
    console.error("getClientLedger error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.getVoucherPdf = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;
    const outPath = buildTempPdfPath("voucher", company_id, "all", id);
    await generateVoucherPdfToFile({ company_id, voucherId: id, outPath });
    return streamPdfAndDelete({
      res,
      filePath: outPath,
      filename: `voucher-${id}.pdf`,
      inline: true
    });
  } catch (err) {
    console.error("getVoucherPdf error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.getClientLedgerPdf = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId } = req.params;
    const { date_from, date_to, fiscal_year } = resolveDateRangeFromQuery(req.query);
    const ledger = await buildClientLedger({
      company_id,
      clientId,
      factory_id: normalizeString(req.query.factory_id),
      date_from,
      date_to
    });
    ledger.filters.fiscal_year = fiscal_year;
    const outPath = buildTempPdfPath("ledger", company_id, "all", clientId);
    await generateClientLedgerPdfToFile({ ledger, outPath });
    return streamPdfAndDelete({
      res,
      filePath: outPath,
      filename: `client-ledger-${clientId}.pdf`,
      inline: true
    });
  } catch (err) {
    if (err.message === "CLIENT_NOT_FOUND") return res.status(404).json({ message: "Client not found" });
    console.error("getClientLedgerPdf error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};
