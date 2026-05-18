const prisma = require("../config/db");
const logActivity = require("../utils/activityLogger");
const { makeInvoiceNoTx } = require("../utils/numbering");
const { requireSingleFactory } = require("../utils/factoryScope");
const { invoiceVisibilityWhere } = require("../utils/factoryVisibility");
const { syncInvoiceFromOrderTx, getInvoiceNoteEffectByIdsTx, autoAllocatePaymentsForClientTx } = require("../services/orderInvoiceService");
const { getPagination, buildPaginationMeta } = require("../utils/pagination");
const { resolveSender, getRequestedSenderKey } = require("../services/messageSenderService");
const { normalizeChargeInput } = require("../utils/chargeInput");

function parseDateOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function calcLineTotal(qty, price, discount) {
  const d = discount ? Number(discount) : 0;
  return qty * price - d;
}

function sumCharges(charges = []) {
  return charges.reduce((acc, c) => acc + Number(c.amount || 0), 0);
}

function completionStatusFromInvoiceStatus(status) {
  const s = String(status || "").toUpperCase();
  if (s === "PAID") return "COMPLETED";
  if (s === "VOID") return "VOID";
  return "PENDING";
}

function deriveInvoiceAdjustmentStatus(total, summary) {
  const totalValue = Number(total || 0);
  const creditReversal = Number(summary?.credit_note_total || 0);
  const debitAdjustment = Number(summary?.debit_note_total || 0);
  if (creditReversal > 0.0001) {
    return creditReversal >= totalValue - 0.0001 ? 'FULLY_REVERSED' : 'PARTIALLY_REVERSED';
  }
  if (debitAdjustment > 0.0001) return 'ADJUSTED';
  return 'NONE';
}

function humanInvoicePaymentStatus(status) {
  if (status === 'PAID') return 'COMPLETE';
  if (status === 'PARTIALLY_PAID') return 'PARTIALLY PAID';
  if (status === 'VOID') return 'VOID';
  return 'PENDING';
}

function humanAdjustmentStatus(status) {
  if (status === 'PARTIALLY_REVERSED') return 'PARTIALLY REVERSED';
  if (status === 'FULLY_REVERSED') return 'FULLY REVERSED';
  if (status === 'ADJUSTED') return 'ADJUSTED';
  return null;
}

function attachInvoiceDerivedFields(invoice, note_summary = null) {
  const summary = note_summary || invoice.note_summary || { debit_note_total: 0, credit_note_total: 0, net_effect: 0, vouchers: [] };
  const net_total_after_notes = Number(invoice.total || 0) + Number(summary.net_effect || 0);
  const adjustment_status = deriveInvoiceAdjustmentStatus(invoice.total, summary);
  const display_status = `${humanInvoicePaymentStatus(invoice.status)}${adjustment_status !== 'NONE' ? ` • ${humanAdjustmentStatus(adjustment_status)}` : ''}`;
  return {
    ...invoice,
    completion_status: completionStatusFromInvoiceStatus(invoice.status),
    note_summary: summary,
    adjustment_status,
    display_status,
    net_total_after_notes
  };
}

function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  return v || null;
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) return normalized;
  }
  return null;
}


async function fetchInvoiceNoteSummary(company_id, invoice_id) {
  const vouchers = await prisma.accountingVoucher.findMany({
    where: { company_id, invoice_id, is_active: true, voucher_type: { in: ["DEBIT_NOTE", "CREDIT_NOTE"] } },
    select: { voucher_type: true, total_amount: true, id: true, voucher_no: true, voucher_date: true, narration: true }
  });
  const summary = {
    debit_note_total: 0,
    credit_note_total: 0,
    net_effect: 0,
    vouchers
  };
  for (const v of vouchers) {
    const amt = Number(v.total_amount || 0);
    if (v.voucher_type === "DEBIT_NOTE") summary.debit_note_total += amt;
    if (v.voucher_type === "CREDIT_NOTE") summary.credit_note_total += amt;
  }
  summary.net_effect = summary.debit_note_total - summary.credit_note_total;
  return summary;
}

exports.getInvoices = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = invoiceVisibilityWhere(req);

    const client_id = (req.query.client_id || "").toString().trim();
    const status = (req.query.status || "").toString().trim();
    const kind = (req.query.kind || "").toString().trim();
    const date_from = parseDateOrNull(req.query.date_from);
    const date_to = parseDateOrNull(req.query.date_to);

    const where = { company_id, ...fw, is_active: true };

    if (client_id) where.client_id = client_id;
    if (status) where.status = status;
    if (kind) where.kind = kind;

    if (date_from || date_to) {
      where.issue_date = {};
      if (date_from) where.issue_date.gte = date_from;
      if (date_to) where.issue_date.lte = date_to;
    }

    const pagination = getPagination(req, { defaultPageSize: 25, maxPageSize: 100 });
    const query = {
      where,
      orderBy: [{ issue_date: "desc" }, { id: "desc" }],
      include: {
        client: { select: { id: true, company_name: true } },
        order: { select: { id: true, order_no: true } },
        factory: { select: { id: true, name: true } },
        sales_company: { select: { id: true, name: true } }
      }
    };
    if (pagination.enabled) {
      query.skip = pagination.skip;
      query.take = pagination.take;
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany(query),
      pagination.enabled && pagination.include_total ? prisma.invoice.count({ where }) : Promise.resolve(null)
    ]);

    const noteMap = await getInvoiceNoteEffectByIdsTx(prisma, { company_id, invoice_ids: invoices.map((inv) => inv.id) });
    const withCompletion = invoices.map((inv) => {
      const summary = noteMap.get(inv.id) || { debit_note_total: 0, credit_note_total: 0, net_effect: 0, vouchers: [] };
      return attachInvoiceDerivedFields(inv, summary);
    });

    if (!pagination.enabled) return res.json(withCompletion);

    return res.json({
      items: withCompletion,
      pagination: buildPaginationMeta({ page: pagination.page, page_size: pagination.page_size, total: total ?? withCompletion.length })
    });
  } catch (err) {
    console.error("getInvoices error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getInvoiceById = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = invoiceVisibilityWhere(req);
    const { id } = req.params;

    const invoice = await prisma.invoice.findFirst({
      where: { id, company_id, ...fw },
      include: {
        client: true,
        factory: true,
        sales_company: true,
        order: {
          select: {
            id: true,
            order_no: true,
            order_date: true,
            status: true
          }
        },
        items: { include: { product: { include: { category: true } } } },
        charges: true,
        status_history: { orderBy: { created_at: "desc" } },
        allocations: {
          include: {
            payment: { select: { id: true, method: true, paid_at: true, amount: true, status: true } }
          }
        }
      }
    });

    if (!invoice) return res.status(404).json({ message: "Invoice not found" });
    const note_summary = await fetchInvoiceNoteSummary(company_id, id);
    return res.json(attachInvoiceDerivedFields(invoice, note_summary));
  } catch (err) {
    console.error("getInvoiceById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// POST /invoices
exports.createInvoice = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);

    const {
      client_id,
      order_id,     // optional: generate from order
      kind,         // PROFORMA / TAX_INVOICE
      issue_date,
      due_date,
      notes,
      items,
      charges
    } = req.body;

    const issue = parseDateOrNull(issue_date) || new Date();
    const due = due_date !== undefined ? (parseDateOrNull(due_date) || null) : null;

    const invoiceKind = kind || "TAX_INVOICE";
    // Default statuses:
    // - TAX_INVOICE: PENDING
    // - PROFORMA: DRAFT
    const initialStatus = String(invoiceKind).toUpperCase() === "PROFORMA" ? "DRAFT" : "PENDING";

    let finalClientId = client_id;

    // If this is an order-linked invoice, enforce the 1:1 invariant.
    // Older frontends may still call "generate invoice" for an order; we treat it as "ensure + return".
    let orderInvoiceAlreadyExisted = false;
    if (order_id) {
      const existing = await prisma.invoice.findFirst({
        where: { company_id, order_id, is_active: true },
        select: { id: true }
      });
      orderInvoiceAlreadyExisted = !!existing;
    }

    const created = await prisma.$transaction(async (tx) => {
      let computedItems = [];
      let computedCharges = [];

      if (order_id) {
        // Order-based invoice is a 1:1 derived document.
        // If it already exists, just return it. If it doesn't, create it and keep it in sync.
        await syncInvoiceFromOrderTx(tx, { company_id, order_id, user_id: req.user.id });

        const existing = await tx.invoice.findFirst({
          where: { company_id, order_id, is_active: true },
          include: { items: true, charges: true }
        });
        if (!existing) throw new Error("ORDER_NOT_FOUND");

        return existing;
      } else {
        // manual creation must provide client_id + items
        if (!finalClientId) throw new Error("CLIENT_REQUIRED");
        if (!Array.isArray(items) || items.length === 0) throw new Error("ITEMS_REQUIRED");

        // validate products exist
        const productIds = [...new Set(items.map(i => i.product_id))];
        const products = await tx.product.findMany({
          where: { company_id, id: { in: productIds }, is_active: true },
          select: { id: true }
        });
        if (products.length !== productIds.length) throw new Error("PRODUCT_NOT_FOUND");

        // ✅ FIX: use product connect + company connect
        computedItems = items.map(it => {
          const qty = Number(it.quantity);
          const price = Number(it.unit_price);
          const disc = it.discount !== undefined && it.discount !== null ? Number(it.discount) : 0;
          if (!it.product_id) throw new Error("PRODUCT_REQUIRED");
          if (!Number.isFinite(qty) || qty <= 0) throw new Error("INVALID_QTY");
          if (!Number.isFinite(price) || price < 0) throw new Error("INVALID_PRICE");

          return {
            company: { connect: { id: company_id } },
            product: { connect: { id: it.product_id } },
            quantity: qty,
            unit_price: price,
            discount: disc || null,
            line_total: calcLineTotal(qty, price, disc),
            remarks: it.remarks?.toString() || null
          };
        });

        // ✅ FIX: add company connect to charges
        computedCharges = Array.isArray(charges)
          ? normalizeChargeInput(charges).map(c => ({
              company: { connect: { id: company_id } },
              ...c
            }))
          : [];
      }

      // client check
      const client = await tx.client.findFirst({
        where: { id: finalClientId, company_id, is_active: true }
      });
      if (!client) throw new Error("CLIENT_NOT_FOUND");

      const subtotal = computedItems.reduce((acc, it) => acc + Number(it.line_total), 0);
      const total_charges = sumCharges(computedCharges.map(c => ({ amount: c.amount })));
      const total = subtotal + total_charges;

      const invoice = await tx.invoice.create({
        data: {
          // keep these scalars as-is (do NOT change unnecessarily)
          company_id,
          factory_id,
          client_id: finalClientId,
          order_id: order_id || null,

          invoice_no: await makeInvoiceNoTx(tx, company_id, issue),
          kind: invoiceKind,
          status: initialStatus,
          issue_date: issue,
          due_date: due,
          subtotal,
          total_charges,
          total,
          notes: notes?.toString() || null,
          is_active: true,
          created_by: req.user.id,

          items: { create: computedItems },
          charges: { create: computedCharges },

          status_history: {
            create: {
              company: { connect: { id: company_id } },
              status: initialStatus,
              note: order_id ? "Invoice created from order" : "Invoice created manually",
              created_by: req.user.id
            }
          }
        },
        include: { items: true, charges: true }
      });

      await autoAllocatePaymentsForClientTx(tx, { company_id, client_id: finalClientId, user_id: req.user.id });
      return tx.invoice.findUnique({ where: { id: invoice.id }, include: { items: true, charges: true } });
    });

    if (!orderInvoiceAlreadyExisted) {
      await logActivity({
        company_id,
        factory_id,
        user_id: req.user.id,
        action: "INVOICE_CREATED",
        entity_type: "invoice",
        entity_id: created.id,
        new_value: created
      });
    }

    // If invoice was requested from an order and it already existed, return 200 (idempotent "ensure").
    return res.status(order_id && orderInvoiceAlreadyExisted ? 200 : 201).json(created);
  } catch (err) {
    if (err.message === "ORDER_NOT_FOUND") return res.status(404).json({ message: "Order not found" });
    if (err.message === "CLIENT_REQUIRED") return res.status(400).json({ message: "client_id is required for manual invoice" });
    if (err.message === "ITEMS_REQUIRED") return res.status(400).json({ message: "items are required for manual invoice" });
    if (err.message === "PRODUCT_NOT_FOUND") return res.status(404).json({ message: "One or more products not found" });
    if (err.message === "CLIENT_NOT_FOUND") return res.status(404).json({ message: "Client not found" });
    if (err.message === "PRODUCT_REQUIRED") return res.status(400).json({ message: "product_id required in invoice item" });
    if (err.message === "INVALID_QTY") return res.status(400).json({ message: "Invalid item quantity" });
    if (err.message === "INVALID_PRICE") return res.status(400).json({ message: "Invalid item unit_price" });

    console.error("createInvoice error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// PUT /invoices/:id
exports.updateInvoice = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);
    const { id } = req.params;

    const existing = await prisma.invoice.findFirst({
      where: { id, company_id, factory_id, is_active: true },
      include: { items: true, charges: true }
    });
    if (!existing) return res.status(404).json({ message: "Invoice not found" });

    const { due_date, notes, items, charges } = req.body;

    // Order-linked invoices are derived documents.
    // To avoid drift, items/charges updates must go through the Order (which auto-syncs the invoice).
    if (existing.order_id && (items !== undefined || charges !== undefined)) {
      return res.status(400).json({
        message: "This invoice is linked to an order. Update the order to change items/charges; the invoice will sync automatically."
      });
    }

    const due = due_date !== undefined ? (parseDateOrNull(due_date) || null) : undefined;

    const updated = await prisma.$transaction(async (tx) => {
      let computedItems = null;
      let computedCharges = null;

      if (items !== undefined) {
        if (!Array.isArray(items) || items.length === 0) throw new Error("ITEMS_REQUIRED");

        const productIds = [...new Set(items.map(i => i.product_id))];
        const products = await tx.product.findMany({
          where: { company_id, id: { in: productIds }, is_active: true },
          select: { id: true }
        });
        if (products.length !== productIds.length) throw new Error("PRODUCT_NOT_FOUND");

        computedItems = items.map(it => {
          const qty = Number(it.quantity);
          const price = Number(it.unit_price);
          const disc = it.discount !== undefined && it.discount !== null ? Number(it.discount) : 0;
          if (!it.product_id) throw new Error("PRODUCT_REQUIRED");
          if (!Number.isFinite(qty) || qty <= 0) throw new Error("INVALID_QTY");
          if (!Number.isFinite(price) || price < 0) throw new Error("INVALID_PRICE");
          return {
            product_id: it.product_id,
            quantity: qty,
            unit_price: price,
            discount: disc || null,
            line_total: calcLineTotal(qty, price, disc),
            remarks: it.remarks?.toString() || null
          };
        });
      }

      if (charges !== undefined) {
        computedCharges = Array.isArray(charges)
          ? normalizeChargeInput(charges)
          : [];
      }

      // replace items
      if (computedItems) {
        await tx.invoiceItem.deleteMany({ where: { company_id, invoice_id: id } });
        await tx.invoiceItem.createMany({
          data: computedItems.map(it => ({ company_id, invoice_id: id, ...it }))
        });
      }

      // replace charges
      if (computedCharges !== null) {
        await tx.invoiceCharge.deleteMany({ where: { company_id, invoice_id: id } });
        if (computedCharges.length > 0) {
          await tx.invoiceCharge.createMany({
            data: computedCharges.map(c => ({ company_id, invoice_id: id, ...c }))
          });
        }
      }

      // recompute totals from DB (source of truth)
      const dbItems = await tx.invoiceItem.findMany({ where: { company_id, invoice_id: id } });
      const dbCharges = await tx.invoiceCharge.findMany({ where: { company_id, invoice_id: id } });

      const subtotal = dbItems.reduce((acc, it) => acc + Number(it.line_total), 0);
      const total_charges = dbCharges.reduce((acc, c) => acc + Number(c.amount), 0);
      const total = subtotal + total_charges;

      const inv = await tx.invoice.update({
        where: { id },
        data: {
          due_date: due,
          notes: notes !== undefined ? (notes?.toString() || null) : undefined,
          subtotal,
          total_charges,
          total
        },
        include: { items: true, charges: true }
      });

      await autoAllocatePaymentsForClientTx(tx, { company_id, client_id: existing.client_id, user_id: req.user.id });
      return tx.invoice.findUnique({ where: { id }, include: { items: true, charges: true } });
    });

    await logActivity({
      company_id,
      factory_id,
      user_id: req.user.id,
      action: "INVOICE_UPDATED",
      entity_type: "invoice",
      entity_id: id,
      old_value: existing,
      new_value: updated
    });

    return res.json(updated);
  } catch (err) {
    if (err.message === "ITEMS_REQUIRED") return res.status(400).json({ message: "items required" });
    if (err.message === "PRODUCT_NOT_FOUND") return res.status(404).json({ message: "One or more products not found" });
    if (err.message === "PRODUCT_REQUIRED") return res.status(400).json({ message: "product_id required in invoice item" });
    if (err.message === "INVALID_QTY") return res.status(400).json({ message: "Invalid item quantity" });
    if (err.message === "INVALID_PRICE") return res.status(400).json({ message: "Invalid item unit_price" });

    console.error("updateInvoice error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// PUT /invoices/:id/status
exports.updateInvoiceStatus = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);
    const { id } = req.params;

    const { status, note } = req.body;
    if (!status) return res.status(400).json({ message: "status is required" });

    const existing = await prisma.invoice.findFirst({
      where: { id, company_id, factory_id }
    });
    if (!existing) return res.status(404).json({ message: "Invoice not found" });

    const updated = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.update({
        where: { id },
        data: { status }
      });

      await tx.invoiceStatusHistory.create({
        data: {
          company_id,
          invoice_id: id,
          status,
          note: note?.toString() || null,
          created_by: req.user.id
        }
      });

      return inv;
    });

    await logActivity({
      company_id,
      factory_id,
      user_id: req.user.id,
      action: "INVOICE_STATUS_CHANGED",
      entity_type: "invoice",
      entity_id: id,
      meta: { from: existing.status, to: status, note: note || null }
    });

    return res.json(updated);
  } catch (err) {
    console.error("updateInvoiceStatus error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const fs = require("fs");
const { buildTempPdfPath } = require("../utils/fileStorage");
const { streamPdfAndDelete, safeUnlink } = require("../utils/pdfResponse");
const { generateInvoicePdfToFile } = require("../services/pdf/invoicePdf");
const {
  logQueued,
  sendTransactionalEmail,
  sendTransactionalEmailPdf,
  sendTransactionalWhatsAppPdf
} = require("../services/messageDispatchService");

exports.getInvoicePdf = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = invoiceVisibilityWhere(req);
    const { id } = req.params;

    const invMeta = await prisma.invoice.findFirst({
      where: { id, company_id, ...fw, is_active: true },
      select: { id: true, factory_id: true, updated_at: true }
    });
    if (!invMeta) return res.status(404).json({ message: "Invoice not found" });

    const factory_id = invMeta.factory_id;

    const outPath = buildTempPdfPath("invoice", company_id, factory_id, id);
    await generateInvoicePdfToFile({ company_id, factory_id, invoiceId: id, outPath });

    return streamPdfAndDelete({
      res,
      filePath: outPath,
      filename: `invoice-${id}.pdf`,
      inline: true
    });
  } catch (err) {
    console.error("getInvoicePdf error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.sendInvoicePdf = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = invoiceVisibilityWhere(req);
    const { id } = req.params;

    const { channel, to_email, to_phone, subject, message } = req.body;

    if (!channel || !["EMAIL", "WHATSAPP"].includes(channel)) {
      return res.status(400).json({ message: "channel must be EMAIL or WHATSAPP" });
    }

    const sender = resolveSender(channel, getRequestedSenderKey(req.body, channel));

    const invoice = await prisma.invoice.findFirst({
      where: { id, company_id, ...fw, is_active: true },
      include: { client: true }
    });
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const factory_id = invoice.factory_id;

    const outPath = buildTempPdfPath("invoice", company_id, factory_id, id);
    await generateInvoicePdfToFile({ company_id, factory_id, invoiceId: id, outPath });

    const defaultSubject = `Invoice - ${invoice.invoice_no}`;
    const defaultMsg = `Invoice for ${invoice.client.company_name} (${invoice.invoice_no}).`;

    if (channel === "EMAIL") {
      if (!to_email) return res.status(400).json({ message: "to_email is required" });

      const log = await logQueued({
        company_id,
        channel: "EMAIL",
        to: to_email,
        created_by: req.user.id,
        factory_id,
        client_id: invoice.client_id,
        invoice_id: id,
        payload: { invoice_no: invoice.invoice_no, sender: sender.public }
      });

      const resp = await sendTransactionalEmailPdf({
        req,
        company_id,
        toEmail: to_email,
        toName: null,
        subject: subject || defaultSubject,
        html: `<p>${message || defaultMsg}</p>`,
        pdfPath: outPath,
        logId: log.id,
        senderKey: sender.key
      });

      safeUnlink(outPath);
      return res.json({ ok: true, log_id: log.id, provider: resp, sender: sender.public });
    }

    if (!to_phone) return res.status(400).json({ message: "to_phone is required" });

    const log = await logQueued({
      company_id,
      channel: "WHATSAPP",
      to: to_phone,
      created_by: req.user.id,
      factory_id,
      client_id: invoice.client_id,
      invoice_id: id,
      payload: { invoice_no: invoice.invoice_no, sender: sender.public }
    });

    const resp = await sendTransactionalWhatsAppPdf({
      req,
      company_id,
      toPhone: to_phone,
      caption: message || defaultMsg,
      pdfPath: outPath,
      logId: log.id,
      senderKey: sender.key
    });

    safeUnlink(outPath);
    return res.json({ ok: true, log_id: log.id, provider: resp, sender: sender.public });
  } catch (err) {
    console.error("sendInvoicePdf error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

// POST /invoices/:id/remind
// Sends a reminder to a client/contact. Supports EMAIL (default) and WHATSAPP (doc) reminders.
// Body:
// { channel: 'EMAIL'|'WHATSAPP', to_email?, to_phone?, subject?, message?, include_pdf?: boolean }
exports.sendInvoiceReminder = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = invoiceVisibilityWhere(req);
    const { id } = req.params;

    const body = req.body || {};

    const channel = normalizeString(body.channel)?.toUpperCase() || "EMAIL";
    const to_email = pickFirstNonEmpty(
      body.to_email,
      body.toEmail,
      body.email,
      body.recipient_email,
      body.recipientEmail
    );
    const to_phone = pickFirstNonEmpty(
      body.to_phone,
      body.toPhone,
      body.phone,
      body.recipient_phone,
      body.recipientPhone
    );
    const subject = normalizeString(body.subject);
    const message = normalizeString(body.message);
    const include_pdf = body.include_pdf;

    if (!["EMAIL", "WHATSAPP"].includes(channel)) {
      return res.status(400).json({ message: "channel must be EMAIL or WHATSAPP" });
}

    const sender = resolveSender(channel, getRequestedSenderKey(req.body, channel));

    const invoice = await prisma.invoice.findFirst({
      where: { id, company_id, ...fw, is_active: true },
      include: { client: { include: { contacts: { where: { is_active: true }, orderBy: { created_at: "asc" } } } } }
    });
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const factory_id = invoice.factory_id;

    // Auto-pick first active contact if not provided
   const defaultEmail = pickFirstNonEmpty(
      invoice.client?.contacts?.find(c => c.email)?.email,
      invoice.client?.email
    );

    const defaultPhone = pickFirstNonEmpty(
      invoice.client?.contacts?.find(c => c.phone)?.phone,
      invoice.client?.mobile_no,
      invoice.client?.phone
    );
    const outPath = include_pdf ? buildTempPdfPath("invoice", company_id, factory_id, id) : null;
    if (include_pdf) {
      await generateInvoicePdfToFile({ company_id, factory_id, invoiceId: id, outPath });
    }
    const defaultSubject = `Invoice Reminder - ${invoice.invoice_no}`;
    const defaultMsg = `Reminder for invoice ${invoice.invoice_no} (Status: ${invoice.status}).`;

    if (channel === "EMAIL") {
      const email = to_email || defaultEmail;
      if (!email) return res.status(400).json({ message: "to_email is required (no client email found)" });

      const log = await logQueued({
        company_id,
        channel: "EMAIL",
        to: email,
        created_by: req.user.id,
        factory_id,
        client_id: invoice.client_id,
        invoice_id: id,
        payload: { invoice_no: invoice.invoice_no, status: invoice.status, include_pdf: !!include_pdf, sender: sender.public }
      });

      const html = `<p>${message || defaultMsg}</p>`;
      if (include_pdf) {
        const resp = await sendTransactionalEmailPdf({
          req,
          company_id,
          toEmail: email,
          toName: null,
          subject: subject || defaultSubject,
          html,
          pdfPath: outPath,
          logId: log.id,
          senderKey: sender.key
        });
        safeUnlink(outPath);
        return res.json({ ok: true, log_id: log.id, provider: resp, sender: sender.public });
      }

      const resp = await sendTransactionalEmail({
        toEmail: email,
        toName: null,
        subject: subject || defaultSubject,
        html,
        logId: log.id,
        senderKey: sender.key
      });
      return res.json({ ok: true, log_id: log.id, provider: resp, sender: sender.public });
    }

    // WHATSAPP (document send only in this backend)
    const phone = to_phone || defaultPhone;
    if (!phone) return res.status(400).json({ message: "to_phone is required (no client phone found)" });
    if (!include_pdf) {
      return res.status(400).json({ message: "WHATSAPP reminders require include_pdf: true" });
    }

    const log = await logQueued({
      company_id,
      channel: "WHATSAPP",
      to: phone,
      created_by: req.user.id,
      factory_id,
      client_id: invoice.client_id,
      invoice_id: id,
      payload: { invoice_no: invoice.invoice_no, status: invoice.status, include_pdf: true, sender: sender.public }
    });

    const resp = await sendTransactionalWhatsAppPdf({
      req,
      company_id,
      toPhone: phone,
      caption: message || defaultMsg,
      pdfPath: outPath,
      logId: log.id,
      senderKey: sender.key
    });

    safeUnlink(outPath);
    return res.json({ ok: true, log_id: log.id, provider: resp, sender: sender.public });
  } catch (err) {
    console.error("sendInvoiceReminder error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};


// DELETE /invoices/:id
exports.deleteInvoice = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);
    const { id } = req.params;

    const existing = await prisma.invoice.findFirst({
      where: { id, company_id, factory_id, is_active: true },
      include: { allocations: { where: { is_active: true }, include: { payment: { select: { status: true } } } } }
    });
    if (!existing) return res.status(404).json({ message: "Invoice not found" });

    const activeRecordedAllocations = (existing.allocations || []).filter((a) => a.payment?.status === "RECORDED");
    if (activeRecordedAllocations.length) {
      return res.status(400).json({ message: "Cannot delete invoice with active recorded payment allocations" });
    }

    const deleted = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.update({
        where: { id },
        data: { is_active: false, status: "VOID" }
      });

      await tx.invoiceStatusHistory.create({
        data: {
          company_id,
          invoice_id: id,
          status: "VOID",
          note: "Invoice deleted (soft delete)",
          created_by: req.user.id
        }
      });

      return inv;
    });

    await logActivity({
      company_id,
      factory_id,
      user_id: req.user.id,
      action: "INVOICE_DELETED",
      entity_type: "invoice",
      entity_id: id,
      old_value: existing,
      new_value: { is_active: false, status: "VOID" }
    });

    return res.json({ message: "Invoice deleted successfully", invoice: deleted });
  } catch (err) {
    console.error("deleteInvoice error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
