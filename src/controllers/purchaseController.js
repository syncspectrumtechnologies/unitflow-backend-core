
const prisma = require("../config/db");
const logActivity = require("../utils/activityLogger");
const { buildTempPdfPath } = require("../utils/fileStorage");
const { streamPdfAndDelete } = require("../utils/pdfResponse");
const { generatePurchasePdfToFile } = require("../services/pdf/purchasePdf");
const { factoryWhere, requireSingleFactory } = require("../utils/factoryScope");
const { getPagination, buildPaginationMeta } = require("../utils/pagination");
const { makePurchaseNoTx, makePurchasePaymentNoTx } = require("../utils/numbering");
const { parseDateOrNull } = require("../utils/fiscalYear");
const { autoApplyPurchaseAdvancesToPurchaseTx, autoAllocatePurchaseBalancesForClientTx, getPurchaseNoteEffectByIdsTx, createPurchaseAdvanceTx } = require("../services/clientAdvanceService");
const { hardDeletePurchaseTx } = require("../services/hardDeleteService");

function normalizeString(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s || null;
}

function toNumber(v) {
  const n = typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sumCharges(charges = []) {
  return charges.reduce((acc, c) => acc + toNumber(c.amount || 0), 0);
}

function buildComputedItems(items = []) {
  return items.map((it) => {
    const description = normalizeString(it.description || it.item_name);
    const quantity = toNumber(it.quantity ?? it.qty);
    const unit_price = toNumber(it.unit_price);
    if (!description) throw new Error("ITEM_DESCRIPTION_REQUIRED");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("INVALID_ITEM_QUANTITY");
    if (!Number.isFinite(unit_price) || unit_price < 0) throw new Error("INVALID_ITEM_PRICE");
    return {
      description,
      quantity,
      unit_price,
      line_total: quantity * unit_price
    };
  });
}

function getRecordedPayments(payments = []) {
  return (payments || []).filter((payment) => payment.status === "RECORDED");
}

function getLatestRecordedPayment(payments = []) {
  const recorded = getRecordedPayments(payments);
  if (!recorded.length) return null;
  return [...recorded].sort((a, b) => {
    const at = new Date(a.paid_at || a.created_at).getTime();
    const bt = new Date(b.paid_at || b.created_at).getTime();
    return bt - at;
  })[0];
}

function sumRecordedPayments(payments = []) {
  return getRecordedPayments(payments).reduce((acc, payment) => acc + toNumber(payment.amount), 0);
}

function derivePurchaseAdjustmentStatus(total, summary) {
  const totalValue = toNumber(total);
  const debitReversal = toNumber(summary?.debit_note_total || 0);
  const creditAdjustment = toNumber(summary?.credit_note_total || 0);
  if (debitReversal > 0.0001) {
    return debitReversal >= totalValue - 0.0001 ? "FULLY_REVERSED" : "PARTIALLY_REVERSED";
  }
  if (creditAdjustment > 0.0001) return "ADJUSTED";
  return "NONE";
}

function humanPurchasePaymentStatus(status) {
  if (status === "PAID") return "COMPLETE";
  if (status === "PARTIALLY_PAID") return "PARTIALLY PAID";
  return "UNPAID";
}

function humanAdjustmentStatus(status) {
  if (status === "PARTIALLY_REVERSED") return "PARTIALLY REVERSED";
  if (status === "FULLY_REVERSED") return "FULLY REVERSED";
  if (status === "ADJUSTED") return "ADJUSTED";
  return null;
}

function attachPurchaseDerivedFields(purchase, noteSummary = null) {
  if (!purchase) return purchase;
  const totalPaid = Array.isArray(purchase.payments) ? sumRecordedPayments(purchase.payments) : toNumber(purchase.paid_amount);
  const total = toNumber(purchase.total);
  const summary = noteSummary || purchase.note_summary || null;
  const netTotalAfterNotes = summary ? total + toNumber(summary.net_effect) : total;
  const outstanding = Math.max(0, netTotalAfterNotes - totalPaid);
  const latestPayment = Array.isArray(purchase.payments) ? getLatestRecordedPayment(purchase.payments) : null;
  const paymentStatus = totalPaid <= 0 ? "UNPAID" : totalPaid >= netTotalAfterNotes ? "PAID" : "PARTIALLY_PAID";
  const adjustmentStatus = derivePurchaseAdjustmentStatus(total, summary);
  const displayStatus = `${humanPurchasePaymentStatus(paymentStatus)}${adjustmentStatus !== "NONE" ? ` • ${humanAdjustmentStatus(adjustmentStatus)}` : ""}`;

  return {
    ...purchase,
    paid_amount: totalPaid,
    payment_method: latestPayment?.method ?? purchase.payment_method ?? null,
    paid_at: latestPayment?.paid_at ?? purchase.paid_at ?? null,
    payment_reference: latestPayment?.reference ?? purchase.payment_reference ?? null,
    payment_notes: latestPayment?.notes ?? purchase.payment_notes ?? null,
    total_paid_amount: totalPaid,
    payment_status: paymentStatus,
    adjustment_status: adjustmentStatus,
    display_status: displayStatus,
    net_total_after_notes: netTotalAfterNotes,
    outstanding_amount: outstanding,
    note_summary: summary || undefined
  };
}

async function fetchPurchaseNoteSummary(db, company_id, purchase_id) {
  const vouchers = await db.accountingVoucher.findMany({
    where: { company_id, purchase_id, is_active: true, voucher_type: { in: ["DEBIT_NOTE", "CREDIT_NOTE"] } },
    select: { id: true, voucher_no: true, voucher_type: true, voucher_date: true, total_amount: true, narration: true }
  });

  const summary = {
    debit_note_total: 0,
    credit_note_total: 0,
    net_effect: 0,
    vouchers
  };

  for (const v of vouchers) {
    const amt = toNumber(v.total_amount);
    if (v.voucher_type === "DEBIT_NOTE") summary.debit_note_total += amt;
    if (v.voucher_type === "CREDIT_NOTE") summary.credit_note_total += amt;
  }

  summary.net_effect = summary.credit_note_total - summary.debit_note_total;
  return summary;
}

async function getRecordedPurchasePaymentTotalTx(tx, company_id, purchase_id) {
  const agg = await tx.purchasePayment.aggregate({
    where: { company_id, purchase_id, status: "RECORDED" },
    _sum: { amount: true }
  });
  return toNumber(agg?._sum?.amount || 0);
}

async function syncPurchasePaymentSnapshotTx(tx, company_id, purchase_id) {
  const payments = await tx.purchasePayment.findMany({
    where: { company_id, purchase_id, status: "RECORDED" },
    orderBy: [{ paid_at: "desc" }, { created_at: "desc" }]
  });

  const totalPaid = sumRecordedPayments(payments);
  const latest = payments[0] || null;

  await tx.purchase.update({
    where: { id: purchase_id },
    data: {
      paid_amount: totalPaid,
      paid_at: latest?.paid_at || null,
      payment_method: latest?.method || null,
      payment_reference: latest?.reference || null,
      payment_notes: latest?.notes || null
    }
  });

  return { totalPaid, latest };
}

async function resolveLinkedClientTx(tx, company_id, client_id) {
  if (!client_id) return null;
  const linkedClient = await tx.client.findFirst({
    where: { id: client_id, company_id, is_active: true },
    select: { id: true, company_name: true, gstin: true, phone: true, mobile_no: true, email: true, address: true }
  });
  if (!linkedClient) throw new Error("CLIENT_NOT_FOUND");
  return linkedClient;
}

async function createPurchasePaymentTx(tx, {
  company_id,
  purchase,
  amount,
  paid_at,
  method,
  reference,
  notes,
  user_id,
  payment_no,
  source_kind = "DIRECT",
  advance_id = null
}) {
  return tx.purchasePayment.create({
    data: {
      company_id,
      purchase_id: purchase.id,
      advance_id: advance_id || null,
      payment_no: payment_no || await makePurchasePaymentNoTx(tx, company_id, paid_at || new Date()),
      status: "RECORDED",
      source_kind,
      amount,
      paid_at: paid_at || new Date(),
      method: method || null,
      reference: normalizeString(reference),
      notes: normalizeString(notes),
      created_by: user_id
    }
  });
}

async function validatePurchaseEditContextTx(tx, { company_id, existing, req, nextFactoryId, nextTotal }) {
  if (!nextFactoryId) {
    const err = new Error("FACTORY_REQUIRED");
    err.statusCode = 400;
    throw err;
  }

  const factory = await tx.factory.findFirst({
    where: { id: nextFactoryId, company_id, is_active: true },
    select: { id: true }
  });
  if (!factory) {
    const err = new Error("FACTORY_NOT_FOUND");
    err.statusCode = 404;
    throw err;
  }

  if (!req.user.is_admin && nextFactoryId !== existing.factory_id) {
    const access = await tx.userFactoryMap.findFirst({
      where: { company_id, user_id: req.user.id, factory_id: nextFactoryId }
    });
    if (!access) {
      const err = new Error("UNAUTHORIZED_FACTORY_ACCESS");
      err.statusCode = 403;
      throw err;
    }
  }

  const summary = await fetchPurchaseNoteSummary(tx, company_id, existing.id);
  const netTotalAfterNotes = toNumber(nextTotal) + toNumber(summary.net_effect || 0);
  if (netTotalAfterNotes < -0.0001) {
    const err = new Error("PURCHASE_EDIT_NOTES_CONFLICT");
    err.statusCode = 400;
    err.meta = {
      net_total_after_notes: netTotalAfterNotes,
      debit_note_total: toNumber(summary.debit_note_total || 0),
      credit_note_total: toNumber(summary.credit_note_total || 0)
    };
    throw err;
  }

  return { noteSummary: summary, netTotalAfterNotes };
}

async function releasePurchasePaymentExcessToBalanceTx(tx, {
  company_id,
  purchase,
  user_id,
  target_total,
  client_id,
  factory_id
}) {
  const recordedPayments = await tx.purchasePayment.findMany({
    where: { company_id, purchase_id: purchase.id, status: "RECORDED" },
    orderBy: [{ paid_at: "desc" }, { created_at: "desc" }, { id: "desc" }]
  });

  let totalPaid = recordedPayments.reduce((acc, row) => acc + toNumber(row.amount), 0);
  let excess = totalPaid - toNumber(target_total);
  if (excess <= 0.0001) return { released_total: 0 };

  let releasedTotal = 0;
  for (const payment of recordedPayments) {
    if (excess <= 0.0001) break;
    const rowAmount = toNumber(payment.amount);
    if (rowAmount <= 0.0001) continue;
    const releaseAmount = Math.min(rowAmount, excess);

    if (payment.source_kind === "ADVANCE_APPLIED" && payment.advance_id) {
      if (releaseAmount >= rowAmount - 0.0001) {
        await tx.purchasePayment.update({
          where: { id: payment.id },
          data: {
            status: "REVERSED",
            reversed_at: new Date(),
            reversed_by: user_id,
            reversal_note: "Auto-released due to purchase edit"
          }
        });
      } else {
        await tx.purchasePayment.update({
          where: { id: payment.id },
          data: { amount: { decrement: releaseAmount } }
        });
      }
      await tx.purchaseAdvance.update({
        where: { id: payment.advance_id },
        data: { remaining_amount: { increment: releaseAmount } }
      });
    } else {
      if (!client_id) {
        const err = new Error("PURCHASE_BALANCE_RELEASE_REQUIRES_CLIENT");
        err.statusCode = 400;
        throw err;
      }
      await createPurchaseAdvanceTx(tx, {
        company_id,
        client_id,
        factory_id,
        amount: releaseAmount,
        paid_at: payment.paid_at || new Date(),
        method: payment.method,
        reference: payment.reference,
        notes: `Auto-released from purchase ${purchase.purchase_no || purchase.id} after edit${payment.notes ? ` - ${payment.notes}` : ""}`,
        user_id
      });

      if (releaseAmount >= rowAmount - 0.0001) {
        await tx.purchasePayment.update({
          where: { id: payment.id },
          data: {
            status: "REVERSED",
            reversed_at: new Date(),
            reversed_by: user_id,
            reversal_note: "Auto-released due to purchase edit"
          }
        });
      } else {
        await tx.purchasePayment.update({
          where: { id: payment.id },
          data: { amount: { decrement: releaseAmount } }
        });
      }
    }

    excess -= releaseAmount;
    releasedTotal += releaseAmount;
  }

  return { released_total: releasedTotal };
}

exports.getPurchases = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = factoryWhere(req);

    const q = normalizeString(req.query.q) || "";
    const status = normalizeString(req.query.status);
    const client_id = normalizeString(req.query.client_id);
    const date_from = parseDateOrNull(req.query.date_from);
    const date_to = parseDateOrNull(req.query.date_to);

    const where = { company_id, ...fw, is_active: true };
    if (q) {
      where.OR = [
        { purchase_no: { contains: q, mode: "insensitive" } },
        { vendor_name: { contains: q, mode: "insensitive" } },
        { vendor_phone: { contains: q, mode: "insensitive" } },
        { vendor_email: { contains: q, mode: "insensitive" } },
        { client: { company_name: { contains: q, mode: "insensitive" } } }
      ];
    }
    if (status) where.status = status;
    if (client_id) where.client_id = client_id;
    if (date_from || date_to) {
      where.purchase_date = { ...(date_from ? { gte: date_from } : {}), ...(date_to ? { lte: date_to } : {}) };
    }

    const pagination = getPagination(req, { defaultPageSize: 25, maxPageSize: 100 });
    const query = {
      where,
      orderBy: [{ purchase_date: "desc" }, { updated_at: "desc" }, { id: "desc" }],
      include: {
        factory: { select: { id: true, name: true } },
        client: { select: { id: true, company_name: true } },
        _count: { select: { items: true, charges: true, accounting_vouchers: true, payments: true } }
      }
    };
    if (pagination.enabled) {
      query.skip = pagination.skip;
      query.take = pagination.take;
    }

    const [rows, total] = await Promise.all([
      prisma.purchase.findMany(query),
      pagination.enabled && pagination.include_total ? prisma.purchase.count({ where }) : Promise.resolve(null)
    ]);

    const noteMap = await getPurchaseNoteEffectByIdsTx(prisma, { company_id, purchase_ids: rows.map((row) => row.id) });
    const mapped = rows.map((row) => attachPurchaseDerivedFields(row, noteMap.get(row.id) || null));

    if (!pagination.enabled) return res.json({ count: mapped.length, rows: mapped });

    return res.json({
      count: total ?? mapped.length,
      rows: mapped,
      pagination: buildPaginationMeta({ page: pagination.page, page_size: pagination.page_size, total: total ?? mapped.length })
    });
  } catch (err) {
    console.error("getPurchases error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getPurchaseById = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = factoryWhere(req);
    const { id } = req.params;

    const purchase = await prisma.purchase.findFirst({
      where: { id, company_id, ...fw, is_active: true },
      include: {
        client: { select: { id: true, company_name: true, phone: true, mobile_no: true, email: true } },
        items: true,
        charges: true,
        payments: {
          orderBy: [{ paid_at: "desc" }, { created_at: "desc" }],
          include: { advance: { select: { id: true, advance_no: true, method: true, reference: true } } }
        },
        factory: { select: { id: true, name: true } },
        timeline: { orderBy: { created_at: "asc" } },
        accounting_vouchers: {
          where: { is_active: true },
          select: { id: true, voucher_no: true, voucher_type: true, voucher_date: true, total_amount: true, narration: true },
          orderBy: { voucher_date: "desc" }
        }
      }
    });

    if (!purchase) return res.status(404).json({ message: "Purchase not found" });
    const noteSummary = await fetchPurchaseNoteSummary(prisma, company_id, id);
    return res.json(attachPurchaseDerivedFields(purchase, noteSummary));
  } catch (err) {
    console.error("getPurchaseById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getPurchasePayments = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);
    const { id } = req.params;

    const purchase = await prisma.purchase.findFirst({
      where: { id, company_id, factory_id, is_active: true },
      select: { id: true, purchase_no: true, total: true }
    });
    if (!purchase) return res.status(404).json({ message: "Purchase not found" });

    const [payments, noteSummary] = await Promise.all([
      prisma.purchasePayment.findMany({
        where: { company_id, purchase_id: id },
        orderBy: [{ paid_at: "desc" }, { created_at: "desc" }],
        include: { advance: { select: { id: true, advance_no: true, method: true, reference: true } } }
      }),
      fetchPurchaseNoteSummary(prisma, company_id, id)
    ]);

    const totalPaid = sumRecordedPayments(payments);
    const netTotalAfterNotes = toNumber(purchase.total) + toNumber(noteSummary.net_effect);
    const outstanding = Math.max(0, netTotalAfterNotes - totalPaid);

    const payment_status = totalPaid <= 0 ? "UNPAID" : totalPaid >= netTotalAfterNotes ? "PAID" : "PARTIALLY_PAID";
    const adjustment_status = derivePurchaseAdjustmentStatus(toNumber(purchase.total), noteSummary);
    const display_status = `${humanPurchasePaymentStatus(payment_status)}${adjustment_status !== "NONE" ? ` • ${humanAdjustmentStatus(adjustment_status)}` : ""}`;

    return res.json({
      purchase: {
        id: purchase.id,
        purchase_no: purchase.purchase_no,
        total: toNumber(purchase.total),
        net_total_after_notes: netTotalAfterNotes
      },
      summary: {
        total_paid_amount: totalPaid,
        payment_status,
        adjustment_status,
        display_status,
        outstanding_amount: outstanding
      },
      payments
    });
  } catch (err) {
    console.error("getPurchasePayments error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.createPurchase = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);

    const {
      purchase_no,
      purchase_date,
      client_id,
      vendor_name,
      vendor_gstin,
      vendor_phone,
      vendor_email,
      vendor_address,
      payment_method,
      paid_amount,
      paid_at,
      payment_reference,
      payment_notes,
      notes,
      items = [],
      charges = []
    } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ message: "items must be a non-empty array" });
    if (!Array.isArray(charges)) return res.status(400).json({ message: "charges must be an array" });

    const computedItems = buildComputedItems(items);
    const subtotal = computedItems.reduce((a, b) => a + toNumber(b.line_total), 0);
    const chargeTotal = sumCharges(charges);
    const total = subtotal + chargeTotal;
    const purchaseDate = parseDateOrNull(purchase_date) || new Date();
    const initialPaidAmount = paid_amount === undefined || paid_amount === null ? 0 : toNumber(paid_amount);
    if (initialPaidAmount < 0) return res.status(400).json({ message: "paid_amount cannot be negative" });
    if (initialPaidAmount - total > 0.0001) return res.status(400).json({ message: "Initial paid amount cannot exceed purchase total" });

    const created = await prisma.$transaction(async (tx) => {
      const linkedClient = await resolveLinkedClientTx(tx, company_id, normalizeString(client_id));

      const po = await tx.purchase.create({
        data: {
          company_id,
          factory_id,
          purchase_no: normalizeString(purchase_no) || await makePurchaseNoTx(tx, company_id, purchaseDate),
          purchase_date: purchaseDate,
          client_id: linkedClient?.id || null,
          vendor_name: normalizeString(vendor_name) || linkedClient?.company_name || null,
          vendor_gstin: normalizeString(vendor_gstin) || linkedClient?.gstin || null,
          vendor_phone: normalizeString(vendor_phone) || linkedClient?.mobile_no || linkedClient?.phone || null,
          vendor_email: normalizeString(vendor_email) || linkedClient?.email || null,
          vendor_address: normalizeString(vendor_address) || linkedClient?.address || null,
          payment_method: null,
          paid_amount: 0,
          paid_at: null,
          payment_reference: null,
          payment_notes: null,
          notes: notes?.toString() || null,
          subtotal,
          total,
          created_by: req.user.id,
          is_active: true,
          status: "ORDERED"
        }
      });

      await tx.purchaseItem.createMany({
        data: computedItems.map((it) => ({ company_id, purchase_id: po.id, ...it }))
      });

      if (charges.length) {
        await tx.purchaseCharge.createMany({
          data: charges.map((c) => ({
            company_id,
            purchase_id: po.id,
            label: normalizeString(c.label) || "Charge",
            amount: toNumber(c.amount)
          }))
        });
      }

      await tx.purchaseStatusHistory.create({
        data: {
          company_id,
          purchase_id: po.id,
          status: "ORDERED",
          note: "Created",
          created_by: req.user.id
        }
      });

      if (initialPaidAmount > 0) {
        await createPurchasePaymentTx(tx, {
          company_id,
          purchase: po,
          amount: initialPaidAmount,
          paid_at: parseDateOrNull(paid_at) || purchaseDate,
          method: payment_method,
          reference: payment_reference,
          notes: payment_notes,
          user_id: req.user.id
        });
      }

      await autoApplyPurchaseAdvancesToPurchaseTx(tx, {
        company_id,
        purchase_id: po.id,
        client_id: linkedClient?.id || null,
        user_id: req.user.id,
        effective_date: purchaseDate,
        net_total_after_notes: total
      });
      await syncPurchasePaymentSnapshotTx(tx, company_id, po.id);

      return tx.purchase.findUnique({
        where: { id: po.id },
        include: {
          client: { select: { id: true, company_name: true } },
          items: true,
          charges: true,
          payments: {
            orderBy: [{ paid_at: "desc" }, { created_at: "desc" }],
            include: { advance: { select: { id: true, advance_no: true, method: true, reference: true } } }
          }
        }
      });
    });

    await logActivity({
      company_id,
      factory_id,
      user_id: req.user.id,
      action: "PURCHASE_CREATED",
      entity_type: "purchase",
      entity_id: created.id
    });

    const noteSummary = await fetchPurchaseNoteSummary(prisma, company_id, created.id);
    return res.status(201).json(attachPurchaseDerivedFields(created, noteSummary));
  } catch (err) {
    if (err.message === "CLIENT_NOT_FOUND") return res.status(404).json({ message: "Linked client not found" });
    if (err.message === "ITEM_DESCRIPTION_REQUIRED") return res.status(400).json({ message: "Each item requires description" });
    if (err.message === "INVALID_ITEM_QUANTITY") return res.status(400).json({ message: "Each item quantity must be > 0" });
    if (err.message === "INVALID_ITEM_PRICE") return res.status(400).json({ message: "Each item unit_price must be >= 0" });
    console.error("createPurchase error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.updatePurchase = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const request_factory_id = requireSingleFactory(req);
    const { id } = req.params;

    const existing = await prisma.purchase.findFirst({
      where: { id, company_id, ...factoryWhere(req), is_active: true },
      include: { items: true, charges: true, payments: { where: { status: "RECORDED" } } }
    });
    if (!existing) return res.status(404).json({ message: "Purchase not found" });

    const body = req.body || {};
    if (body.client_id !== undefined && normalizeString(body.client_id) !== normalizeString(existing.client_id)) {
      return res.status(400).json({ message: "client_id cannot be changed for an existing purchase" });
    }
    if (body.items !== undefined && (!Array.isArray(body.items) || body.items.length === 0)) {
      return res.status(400).json({ message: "items must be a non-empty array" });
    }
    if (body.charges !== undefined && !Array.isArray(body.charges)) {
      return res.status(400).json({ message: "charges must be an array" });
    }

    const itemsToUse = body.items === undefined
      ? existing.items.map((it) => ({ description: it.description, quantity: toNumber(it.quantity), unit_price: toNumber(it.unit_price), line_total: toNumber(it.line_total) }))
      : buildComputedItems(body.items);
    const chargesToUse = body.charges === undefined
      ? existing.charges.map((c) => ({ label: c.label, amount: toNumber(c.amount) }))
      : body.charges.map((c) => ({ label: normalizeString(c.label) || "Charge", amount: toNumber(c.amount) }));

    const subtotal = itemsToUse.reduce((acc, it) => acc + toNumber(it.line_total), 0);
    const total = subtotal + sumCharges(chargesToUse);

    const updated = await prisma.$transaction(async (tx) => {
      const nextFactoryId = body.factory_id !== undefined ? normalizeString(body.factory_id) : existing.factory_id;
      const { noteSummary, netTotalAfterNotes } = await validatePurchaseEditContextTx(tx, {
        company_id,
        existing,
        req,
        nextFactoryId,
        nextTotal: total
      });

      const linkedClient = await resolveLinkedClientTx(tx, company_id, existing.client_id);
      const purchaseDate = body.purchase_date !== undefined ? (parseDateOrNull(body.purchase_date) || existing.purchase_date) : existing.purchase_date;
      const wantsLegacyPaymentUpdate =
        body.paid_amount !== undefined ||
        body.payment_method !== undefined ||
        body.payment_reference !== undefined ||
        body.payment_notes !== undefined ||
        body.paid_at !== undefined;

      if (body.items !== undefined) {
        await tx.purchaseItem.deleteMany({ where: { purchase_id: id, company_id } });
        await tx.purchaseItem.createMany({
          data: itemsToUse.map((it) => ({ company_id, purchase_id: id, ...it }))
        });
      }

      if (body.charges !== undefined) {
        await tx.purchaseCharge.deleteMany({ where: { purchase_id: id, company_id } });
        if (chargesToUse.length > 0) {
          await tx.purchaseCharge.createMany({
            data: chargesToUse.map((c) => ({ company_id, purchase_id: id, label: c.label, amount: toNumber(c.amount) }))
          });
        }
      }

      await tx.purchase.update({
        where: { id },
        data: {
          factory_id: nextFactoryId,
          vendor_name: body.vendor_name !== undefined ? normalizeString(body.vendor_name) : (linkedClient?.company_name || existing.vendor_name),
          vendor_phone: body.vendor_phone !== undefined ? normalizeString(body.vendor_phone) : (linkedClient?.mobile_no || linkedClient?.phone || existing.vendor_phone),
          vendor_gstin: body.vendor_gstin !== undefined ? normalizeString(body.vendor_gstin) : (linkedClient?.gstin || existing.vendor_gstin),
          vendor_email: body.vendor_email !== undefined ? normalizeString(body.vendor_email) : (linkedClient?.email || existing.vendor_email),
          vendor_address: body.vendor_address !== undefined ? normalizeString(body.vendor_address) : (linkedClient?.address || existing.vendor_address),
          purchase_date: purchaseDate,
          notes: body.notes !== undefined ? (body.notes ? String(body.notes) : null) : existing.notes,
          subtotal,
          total
        }
      });

      const currentPaidTotal = await getRecordedPurchasePaymentTotalTx(tx, company_id, id);
      if (wantsLegacyPaymentUpdate) {
        const desiredTotalPaid = body.paid_amount !== undefined ? toNumber(body.paid_amount) : currentPaidTotal;
        if (desiredTotalPaid < currentPaidTotal - 0.0001) {
          throw Object.assign(new Error("PAID_AMOUNT_CANNOT_BE_REDUCED"), { statusCode: 400 });
        }
        if (desiredTotalPaid - netTotalAfterNotes > 0.0001) {
          throw Object.assign(new Error("PURCHASE_PAYMENT_EXCEEDS_TOTAL"), { statusCode: 400 });
        }
        const additionalPayment = desiredTotalPaid - currentPaidTotal;
        if (additionalPayment > 0.0001) {
          await createPurchasePaymentTx(tx, {
            company_id,
            purchase: { id },
            amount: additionalPayment,
            paid_at: body.paid_at !== undefined ? (parseDateOrNull(body.paid_at) || new Date()) : new Date(),
            method: body.payment_method,
            reference: body.payment_reference,
            notes: body.payment_notes,
            user_id: req.user.id
          });
        }
      }

      await releasePurchasePaymentExcessToBalanceTx(tx, {
        company_id,
        purchase: { id, purchase_no: existing.purchase_no },
        user_id: req.user.id,
        target_total: netTotalAfterNotes,
        client_id: existing.client_id,
        factory_id: nextFactoryId
      });

      await autoApplyPurchaseAdvancesToPurchaseTx(tx, {
        company_id,
        purchase_id: id,
        client_id: existing.client_id || null,
        user_id: req.user.id,
        effective_date: purchaseDate,
        net_total_after_notes: netTotalAfterNotes
      });
      await syncPurchasePaymentSnapshotTx(tx, company_id, id);

      return tx.purchase.findUnique({
        where: { id },
        include: {
          client: { select: { id: true, company_name: true } },
          items: true,
          charges: true,
          payments: {
            orderBy: [{ paid_at: "desc" }, { created_at: "desc" }],
            include: { advance: { select: { id: true, advance_no: true, method: true, reference: true } } }
          }
        }
      });
    });

    const noteSummary = await fetchPurchaseNoteSummary(prisma, company_id, id);
    return res.json(attachPurchaseDerivedFields(updated, noteSummary));
  } catch (err) {
    if (err.message === "CLIENT_NOT_FOUND") return res.status(404).json({ message: "Linked client not found" });
    if (err.message === "ITEM_DESCRIPTION_REQUIRED") return res.status(400).json({ message: "Each item requires description" });
    if (err.message === "INVALID_ITEM_QUANTITY") return res.status(400).json({ message: "Each item quantity must be > 0" });
    if (err.message === "INVALID_ITEM_PRICE") return res.status(400).json({ message: "Each item unit_price must be >= 0" });
    if (err.message === "FACTORY_NOT_FOUND") return res.status(404).json({ message: "Factory not found" });
    if (err.message === "UNAUTHORIZED_FACTORY_ACCESS") return res.status(403).json({ message: "Unauthorized factory access" });
    if (err.message === "PURCHASE_EDIT_NOTES_CONFLICT") {
      return res.status(400).json({
        message: "Purchase cannot be edited because existing debit/credit notes would become inconsistent.",
        ...err.meta
      });
    }
    if (err.message === "PAID_AMOUNT_CANNOT_BE_REDUCED") return res.status(400).json({ message: "paid_amount cannot be reduced through purchase update. Excess released from total reduction is handled automatically." });
    if (err.message === "PURCHASE_PAYMENT_EXCEEDS_TOTAL") return res.status(400).json({ message: "Total purchase payments cannot exceed net purchase total" });
    if (err.message === "PURCHASE_BALANCE_RELEASE_REQUIRES_CLIENT") return res.status(400).json({ message: "Purchase cannot release excess paid amount to client balance because it is not linked to a client" });
    console.error("updatePurchase error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.createPurchasePayment = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);
    const { id } = req.params;
    const body = req.body || {};
    const amount = toNumber(body.amount);
    if (amount <= 0) return res.status(400).json({ message: "amount must be > 0" });

    const created = await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findFirst({
        where: { id, company_id, factory_id, is_active: true },
        select: { id: true, total: true, purchase_no: true }
      });
      if (!purchase) {
        const err = new Error("PURCHASE_NOT_FOUND");
        err.statusCode = 404;
        throw err;
      }

      const [currentPaidTotal, noteSummary] = await Promise.all([
        getRecordedPurchasePaymentTotalTx(tx, company_id, id),
        fetchPurchaseNoteSummary(tx, company_id, id)
      ]);
      const netTotalAfterNotes = toNumber(purchase.total) + toNumber(noteSummary.net_effect);

      if (currentPaidTotal + amount - netTotalAfterNotes > 0.0001) {
        const err = new Error("PURCHASE_PAYMENT_EXCEEDS_TOTAL");
        err.statusCode = 400;
        throw err;
      }

      const payment = await createPurchasePaymentTx(tx, {
        company_id,
        purchase,
        amount,
        paid_at: parseDateOrNull(body.paid_at) || new Date(),
        method: body.method || body.payment_method,
        reference: body.reference || body.payment_reference,
        notes: body.notes || body.payment_notes,
        user_id: req.user.id
      });

      await syncPurchasePaymentSnapshotTx(tx, company_id, id);

      return payment;
    });

    await logActivity({
      company_id,
      factory_id,
      user_id: req.user.id,
      action: "PURCHASE_PAYMENT_CREATED",
      entity_type: "purchase_payment",
      entity_id: created.id,
      meta: { purchase_id: id }
    });

    return res.status(201).json(created);
  } catch (err) {
    if (err.message === "PURCHASE_NOT_FOUND") return res.status(404).json({ message: "Purchase not found" });
    if (err.message === "PURCHASE_PAYMENT_EXCEEDS_TOTAL") return res.status(400).json({ message: "Total purchase payments cannot exceed net purchase total" });
    console.error("createPurchasePayment error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.reversePurchasePayment = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);
    const { id, paymentId } = req.params;
    const reversal_note = normalizeString(req.body?.reversal_note || req.body?.note);

    const reversed = await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findFirst({
        where: { id, company_id, factory_id, is_active: true },
        select: { id: true }
      });
      if (!purchase) {
        const err = new Error("PURCHASE_NOT_FOUND");
        err.statusCode = 404;
        throw err;
      }

      const payment = await tx.purchasePayment.findFirst({
        where: { id: paymentId, company_id, purchase_id: id }
      });
      if (!payment) {
        const err = new Error("PURCHASE_PAYMENT_NOT_FOUND");
        err.statusCode = 404;
        throw err;
      }
      if (payment.status === "REVERSED") {
        const err = new Error("PURCHASE_PAYMENT_ALREADY_REVERSED");
        err.statusCode = 400;
        throw err;
      }

      const updated = await tx.purchasePayment.update({
        where: { id: paymentId },
        data: {
          status: "REVERSED",
          reversed_at: new Date(),
          reversed_by: req.user.id,
          reversal_note
        }
      });

      if (payment.source_kind === "ADVANCE_APPLIED" && payment.advance_id) {
        await tx.purchaseAdvance.update({
          where: { id: payment.advance_id },
          data: { remaining_amount: { increment: payment.amount } }
        });
      }

      await syncPurchasePaymentSnapshotTx(tx, company_id, id);
      return tx.purchasePayment.findUnique({
        where: { id: paymentId },
        include: { advance: { select: { id: true, advance_no: true, method: true, reference: true } } }
      });
    });

    await logActivity({
      company_id,
      factory_id,
      user_id: req.user.id,
      action: "PURCHASE_PAYMENT_REVERSED",
      entity_type: "purchase_payment",
      entity_id: reversed.id,
      meta: { purchase_id: id }
    });

    return res.json(reversed);
  } catch (err) {
    if (err.message === "PURCHASE_NOT_FOUND") return res.status(404).json({ message: "Purchase not found" });
    if (err.message === "PURCHASE_PAYMENT_NOT_FOUND") return res.status(404).json({ message: "Purchase payment not found" });
    if (err.message === "PURCHASE_PAYMENT_ALREADY_REVERSED") return res.status(400).json({ message: "Purchase payment is already reversed" });
    console.error("reversePurchasePayment error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.updatePurchaseStatus = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);
    const { id } = req.params;
    const { status, note } = req.body || {};

    if (!status) return res.status(400).json({ message: "status is required" });

    const existing = await prisma.purchase.findFirst({ where: { id, company_id, factory_id, is_active: true } });
    if (!existing) return res.status(404).json({ message: "Purchase not found" });

    const updated = await prisma.$transaction(async (tx) => {
      const po = await tx.purchase.update({ where: { id }, data: { status } });
      await tx.purchaseStatusHistory.create({
        data: { company_id, purchase_id: id, status, note: note?.toString() || null, created_by: req.user.id }
      });
      return po;
    });

    return res.json(updated);
  } catch (err) {
    console.error("updatePurchaseStatus error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getPurchasePdf = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = factoryWhere(req);
    const { id } = req.params;

    const po = await prisma.purchase.findFirst({
      where: { id, company_id, ...fw, is_active: true },
      select: { id: true, factory_id: true }
    });
    if (!po) return res.status(404).json({ message: "Purchase not found" });

    const outPath = buildTempPdfPath("purchase", company_id, po.factory_id, id);
    await generatePurchasePdfToFile({ company_id, factory_id: po.factory_id, purchaseId: id, outPath });

    return streamPdfAndDelete({
      res,
      filePath: outPath,
      filename: `purchase-${id}.pdf`,
      inline: true
    });
  } catch (err) {
    console.error("getPurchasePdf error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.deletePurchase = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);
    const { id } = req.params;

    const deleted = await prisma.$transaction((tx) =>
      hardDeletePurchaseTx(tx, { company_id, purchase_id: id })
    );

    return res.json({ message: "Purchase deleted permanently", deleted });
  } catch (err) {
    if (err && err.message === "PURCHASE_NOT_FOUND") {
      return res.status(404).json({ message: "Purchase not found" });
    }
    console.error("deletePurchase error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};
