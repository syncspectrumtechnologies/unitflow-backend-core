const prisma = require("../config/db");
const logActivity = require("../utils/activityLogger");
const { makePaymentNoTx } = require("../utils/numbering");
const { requireSingleFactory } = require("../utils/factoryScope");
const { paymentVisibilityWhere, orderVisibilityWhere } = require("../utils/factoryVisibility");
const { getPagination, buildPaginationMeta } = require("../utils/pagination");
const { recomputeInvoiceStatusTx: sharedRecomputeInvoiceStatusTx, autoAllocatePaymentsForClientTx } = require("../services/orderInvoiceService");
const { hardDeletePaymentTx } = require("../services/hardDeleteService");

function parseDateOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toNum(v) {
  const n = typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function recomputeInvoiceStatusTx(tx, company_id, invoice_id, user_id) {
  return sharedRecomputeInvoiceStatusTx(tx, { company_id, invoice_id, user_id });
}

exports.getPayments = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = paymentVisibilityWhere(req);

    const client_id = (req.query.client_id || "").toString().trim();
    const date_from = parseDateOrNull(req.query.date_from);
    const date_to = parseDateOrNull(req.query.date_to);

    const where = {
      company_id,
      // keep payments in current factory view, but allow "all factories" aggregation
      ...fw
    };

    if (client_id) where.client_id = client_id;

    if (date_from || date_to) {
      where.paid_at = {};
      if (date_from) where.paid_at.gte = date_from;
      if (date_to) where.paid_at.lte = date_to;
    }

    const pagination = getPagination(req, { defaultPageSize: 25, maxPageSize: 100 });
    const query = {
      where,
      orderBy: [{ paid_at: "desc" }, { id: "desc" }],
      include: {
        client: { select: { id: true, company_name: true } },
        factory: { select: { id: true, name: true } },
        order: { select: { id: true, order_no: true, total: true } },
        sales_company: { select: { id: true, name: true } },
        allocations: {
          where: { is_active: true },
          include: {
            invoice: { select: { id: true, invoice_no: true, status: true, total: true } }
          }
        }
      }
    };
    if (pagination.enabled) {
      query.skip = pagination.skip;
      query.take = pagination.take;
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany(query),
      pagination.enabled && pagination.include_total ? prisma.payment.count({ where }) : Promise.resolve(null)
    ]);

    if (!pagination.enabled) return res.json(payments);

    return res.json({
      items: payments,
      pagination: buildPaginationMeta({ page: pagination.page, page_size: pagination.page_size, total: total ?? payments.length })
    });
  } catch (err) {
    console.error("getPayments error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// POST /payments
exports.createPayment = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);

    const {
      client_id,
      order_id,
      method,
      mode,
      amount,
      paid_at,
      reference,
      remarks,
      allocations // [{ invoice_id, amount }]
    } = req.body;

    const payMethod = method || mode;

    if (!client_id) return res.status(400).json({ message: "client_id is required" });
    if (!payMethod) return res.status(400).json({ message: "method is required" });
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ message: "amount must be > 0" });
    }

    const paidAt = parseDateOrNull(paid_at) || new Date();

    const client = await prisma.client.findFirst({
      where: { id: client_id, company_id, is_active: true }
    });
    if (!client) return res.status(404).json({ message: "Client not found" });

    let allocArr = Array.isArray(allocations) ? allocations : [];

    // If order_id is provided and allocations are not, auto-allocate to the order's (single) invoice.
    let resolvedOrderId = order_id || null;
    let resolvedSalesCompanyId = null;

    if (order_id) {
      const ord = await prisma.order.findFirst({
        where: { AND: [ { id: order_id, company_id, is_active: true }, orderVisibilityWhere(req) ] },
        select: { id: true, client_id: true, sales_company_id: true, total: true }
      });
      if (!ord) return res.status(404).json({ message: "Order not found" });
      if (ord.client_id !== client_id) {
        return res.status(400).json({ message: "order_id must belong to the same client" });
      }
      resolvedSalesCompanyId = ord.sales_company_id || null;

      const inv = await prisma.invoice.findFirst({
        where: { company_id, order_id: ord.id, is_active: true },
        select: { id: true, total: true }
      });
      if (!inv) return res.status(404).json({ message: "Order invoice not found" });

      // If caller didn't specify allocations, auto-allocate up to remaining.
      if (!allocArr.length) {
        const paidAgg = await prisma.paymentAllocation.aggregate({
          where: {
            company_id,
            invoice_id: inv.id,
            is_active: true,
            payment: { status: "RECORDED" }
          },
          _sum: { amount: true }
        });
        const alreadyPaid = toNum(paidAgg._sum.amount);
        const remaining = Math.max(0, toNum(inv.total) - alreadyPaid);
        const autoAlloc = Math.min(amt, remaining);
        if (autoAlloc > 0) {
          allocArr = [{ invoice_id: inv.id, amount: autoAlloc }];
        }
      } else {
        // Validate that all allocations are for the order's invoice
        const invoiceIds = [...new Set(allocArr.map((a) => a.invoice_id).filter(Boolean))];
        if (invoiceIds.length !== 1 || invoiceIds[0] !== inv.id) {
          return res.status(400).json({ message: "For order-linked payments, allocations must reference the order's invoice only" });
        }
      }
    }

    // Validate invoice ownership (same company + same factory view)
    const invoiceIds = [...new Set(allocArr.map(a => a.invoice_id).filter(Boolean))];
    if (invoiceIds.length > 0) {
      const invoices = await prisma.invoice.findMany({
        where: { id: { in: invoiceIds }, company_id, is_active: true },
        select: { id: true, client_id: true, order_id: true, sales_company_id: true }
      });
      if (invoices.length !== invoiceIds.length) {
        return res.status(404).json({ message: "One or more invoices not found" });
      }
      for (const inv of invoices) {
        if (inv.client_id !== client_id) {
          return res.status(400).json({ message: "All allocated invoices must belong to the same client" });
        }
      }

      // If order_id wasn't supplied, infer it from invoices (1:1 order invoice).
      if (!resolvedOrderId) {
        const orderIds = [...new Set(invoices.map((i) => i.order_id).filter(Boolean))];
        if (orderIds.length === 1) resolvedOrderId = orderIds[0];
      }

      // Infer sales_company_id if consistent.
      if (!resolvedSalesCompanyId) {
        const scIds = [...new Set(invoices.map((i) => i.sales_company_id).filter(Boolean))];
        if (scIds.length === 1) resolvedSalesCompanyId = scIds[0];
      }
    }

    const allocSum = allocArr.reduce((acc, a) => acc + Number(a.amount || 0), 0);
    if (allocSum > amt) {
      return res.status(400).json({ message: "Sum of allocations cannot exceed payment amount" });
    }

    const created = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          company_id,
          factory_id,
          client_id,
          order_id: resolvedOrderId,
          sales_company_id: resolvedSalesCompanyId,
          payment_no: await makePaymentNoTx(tx, company_id, paidAt),
          // Prisma schema requires field name `method` (enum PaymentMethod).
          // Accept both `method` and legacy `mode` from API, but always persist to `method`.
          method: payMethod,
          status: "RECORDED",
          amount: amt,
          paid_at: paidAt,
          reference: reference?.toString() || null,
          remarks: remarks?.toString() || null,
          created_by: req.user.id
        }
      });

      if (allocArr.length > 0) {
        await tx.paymentAllocation.createMany({
          data: allocArr.map(a => ({
            company_id,
            payment_id: payment.id,
            invoice_id: a.invoice_id,
            amount: Number(a.amount || 0)
          }))
        });
      }

      const recomputedMap = new Map();
      for (const invId of invoiceIds) {
        const r = await recomputeInvoiceStatusTx(tx, company_id, invId, req.user.id);
        if (r) recomputedMap.set(invId, r);
      }

      const autoApplied = await autoAllocatePaymentsForClientTx(tx, {
        company_id,
        client_id,
        user_id: req.user.id
      });
      for (const invId of autoApplied.affected_invoice_ids || []) {
        const r = await recomputeInvoiceStatusTx(tx, company_id, invId, req.user.id);
        if (r) recomputedMap.set(invId, r);
      }

      const recomputed = Array.from(recomputedMap.values());
      const full = await tx.payment.findFirst({
        where: { id: payment.id },
        include: {
          allocations: { include: { invoice: { select: { id: true, invoice_no: true, status: true, total: true } } } }
        }
      });

      return { payment: full, invoice_updates: recomputed };
    });

    await logActivity({
      company_id,
      factory_id,
      user_id: req.user.id,
      action: "PAYMENT_CREATED",
      entity_type: "payment",
      entity_id: created.payment.id,
      meta: { invoice_updates: created.invoice_updates }
    });

    return res.status(201).json(created);
  } catch (err) {
    console.error("createPayment error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};


// DELETE /payments/:id (hard delete)
exports.deletePayment = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);
    const { id } = req.params;

    const deleted = await prisma.$transaction((tx) =>
      hardDeletePaymentTx(tx, { company_id, payment_id: id, user_id: req.user.id })
    );

    return res.json({ message: "Payment deleted permanently", deleted });
  } catch (err) {
    if (err && err.message === "PAYMENT_NOT_FOUND") {
      return res.status(404).json({ message: "Payment not found" });
    }
    console.error("deletePayment error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};
