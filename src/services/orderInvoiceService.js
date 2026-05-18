const { makeInvoiceNoTx } = require("../utils/numbering");

function toNum(v) {
  const n = typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function calcLineTotal(qty, price, discount) {
  const d = discount ? Number(discount) : 0;
  return qty * price - d;
}

async function getInvoiceNoteEffectByIdsTx(tx, { company_id, invoice_ids }) {
  if (!Array.isArray(invoice_ids) || invoice_ids.length === 0) return new Map();
  const vouchers = await tx.accountingVoucher.findMany({
    where: {
      company_id,
      invoice_id: { in: invoice_ids },
      is_active: true,
      voucher_type: { in: ["DEBIT_NOTE", "CREDIT_NOTE"] }
    },
    select: { invoice_id: true, voucher_type: true, total_amount: true }
  });
  const map = new Map();
  for (const voucher of vouchers) {
    const key = voucher.invoice_id;
    if (!key) continue;
    const current = map.get(key) || { debit_note_total: 0, credit_note_total: 0, net_effect: 0 };
    const amount = toNum(voucher.total_amount);
    if (voucher.voucher_type === "DEBIT_NOTE") current.debit_note_total += amount;
    if (voucher.voucher_type === "CREDIT_NOTE") current.credit_note_total += amount;
    current.net_effect = current.debit_note_total - current.credit_note_total;
    map.set(key, current);
  }
  return map;
}

async function recomputeInvoiceStatusTx(tx, { company_id, invoice_id, user_id }) {
  const inv = await tx.invoice.findFirst({
    where: { id: invoice_id, company_id, is_active: true },
    select: { id: true, total: true, status: true }
  });
  if (!inv) return null;

  const [paidAgg, noteEffects] = await Promise.all([
    tx.paymentAllocation.aggregate({
      where: {
        company_id,
        invoice_id,
        is_active: true,
        payment: { status: 'RECORDED' }
      },
      _sum: { amount: true }
    }),
    getInvoiceNoteEffectByIdsTx(tx, { company_id, invoice_ids: [invoice_id] })
  ]);

  const paid = toNum(paidAgg?._sum?.amount || 0);
  const total = toNum(inv.total) + toNum(noteEffects.get(invoice_id)?.net_effect || 0);

  let nextStatus = inv.status;
  if (paid <= 0) {
    if (inv.status === 'PARTIALLY_PAID' || inv.status === 'PAID') nextStatus = 'PENDING';
  } else if (paid < total) {
    nextStatus = 'PARTIALLY_PAID';
  } else {
    nextStatus = 'PAID';
  }

  if (nextStatus !== inv.status) {
    await tx.invoice.update({ where: { id: invoice_id }, data: { status: nextStatus } });
    await tx.invoiceStatusHistory.create({
      data: {
        company_id,
        invoice_id,
        status: nextStatus,
        note: 'Auto-updated by payment auto-allocation',
        created_by: user_id || null
      }
    });
  }

  return { paid, total, status: nextStatus };
}

async function autoAllocatePaymentsForClientTx(tx, { company_id, client_id, user_id }) {
  if (!client_id) return { applied_total: 0, allocations_created: 0, affected_invoice_ids: [] };

  const [invoices, allocationAggs, payments, paymentAllocAggs] = await Promise.all([
    tx.invoice.findMany({
      where: { company_id, client_id, is_active: true, kind: { not: 'PROFORMA' }, status: { not: 'VOID' } },
      select: { id: true, total: true, issue_date: true, created_at: true },
      orderBy: [{ issue_date: 'asc' }, { created_at: 'asc' }, { id: 'asc' }]
    }),
    tx.paymentAllocation.groupBy({
      by: ['invoice_id'],
      where: { company_id, is_active: true, payment: { company_id, client_id, status: 'RECORDED' } },
      _sum: { amount: true }
    }),
    tx.payment.findMany({
      where: { company_id, client_id, status: 'RECORDED' },
      select: { id: true, amount: true, paid_at: true, created_at: true },
      orderBy: [{ paid_at: 'asc' }, { created_at: 'asc' }, { id: 'asc' }]
    }),
    tx.paymentAllocation.groupBy({
      by: ['payment_id'],
      where: { company_id, is_active: true, payment: { company_id, client_id, status: 'RECORDED' } },
      _sum: { amount: true }
    })
  ]);

  if (!invoices.length || !payments.length) return { applied_total: 0, allocations_created: 0, affected_invoice_ids: [] };

  const noteEffects = await getInvoiceNoteEffectByIdsTx(tx, { company_id, invoice_ids: invoices.map((inv) => inv.id) });
  const invoicePaidMap = new Map(allocationAggs.map((row) => [row.invoice_id, toNum(row?._sum?.amount || 0)]));
  const paymentAvailMap = new Map(payments.map((payment) => {
    const allocated = toNum(paymentAllocAggs.find((row) => row.payment_id === payment.id)?._sum?.amount || 0);
    return [payment.id, Math.max(0, toNum(payment.amount) - allocated)];
  }));

  let applied_total = 0;
  let allocations_created = 0;
  const affected = new Set();

  for (const invoice of invoices) {
    const summary = noteEffects.get(invoice.id) || { net_effect: 0 };
    const targetTotal = toNum(invoice.total) + toNum(summary.net_effect || 0);
    let remainingDue = targetTotal - toNum(invoicePaidMap.get(invoice.id) || 0);
    if (remainingDue <= 0.0001) continue;

    for (const payment of payments) {
      if (remainingDue <= 0.0001) break;
      const available = toNum(paymentAvailMap.get(payment.id) || 0);
      if (available <= 0.0001) continue;

      const applyAmount = Math.min(available, remainingDue);
      await tx.paymentAllocation.upsert({
        where: { company_id_payment_id_invoice_id: { company_id, payment_id: payment.id, invoice_id: invoice.id } },
        create: {
          company_id,
          payment_id: payment.id,
          invoice_id: invoice.id,
          amount: applyAmount,
          is_active: true
        },
        update: {
          amount: { increment: applyAmount },
          is_active: true
        }
      });

      paymentAvailMap.set(payment.id, available - applyAmount);
      invoicePaidMap.set(invoice.id, toNum(invoicePaidMap.get(invoice.id) || 0) + applyAmount);
      remainingDue -= applyAmount;
      applied_total += applyAmount;
      allocations_created += 1;
      affected.add(invoice.id);
    }
  }

  for (const invoice_id of affected) {
    await recomputeInvoiceStatusTx(tx, { company_id, invoice_id, user_id });
  }

  return { applied_total, allocations_created, affected_invoice_ids: Array.from(affected) };
}

async function autoApplyAvailablePaymentsToInvoiceTx(tx, { company_id, client_id, invoice_id, user_id }) {
  const result = await autoAllocatePaymentsForClientTx(tx, { company_id, client_id, user_id });
  return {
    applied_total: result.applied_total,
    allocations_created: result.allocations_created,
    affected_invoice_ids: result.affected_invoice_ids,
    requested_invoice_id: invoice_id || null
  };
}


async function reconcileInvoiceFinancialsTx(tx, { company_id, client_id, invoice_id, user_id, target_total }) {
  const activeAllocations = await tx.paymentAllocation.findMany({
    where: { company_id, invoice_id, is_active: true, payment: { status: 'RECORDED' } },
    select: { id: true, amount: true },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }]
  });

  let allocated = activeAllocations.reduce((acc, row) => acc + toNum(row.amount), 0);
  let excess = allocated - toNum(target_total);
  const touchedPaymentIds = new Set();

  if (excess > 0.0001) {
    const allocationsToRelease = await tx.paymentAllocation.findMany({
      where: { company_id, invoice_id, is_active: true, payment: { status: 'RECORDED' } },
      include: { payment: { select: { id: true, paid_at: true, created_at: true, status: true } } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }]
    });
    allocationsToRelease.sort((a, b) => {
      const ap = new Date(a.payment?.paid_at || a.payment?.created_at || 0).getTime();
      const bp = new Date(b.payment?.paid_at || b.payment?.created_at || 0).getTime();
      if (bp !== ap) return bp - ap;
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });

    for (const row of allocationsToRelease) {
      if (excess <= 0.0001) break;
      const rowAmount = toNum(row.amount);
      if (rowAmount <= 0.0001) continue;
      const releaseAmount = Math.min(rowAmount, excess);

      if (releaseAmount >= rowAmount - 0.0001) {
        await tx.paymentAllocation.update({ where: { id: row.id }, data: { is_active: false } });
      } else {
        await tx.paymentAllocation.update({ where: { id: row.id }, data: { amount: { decrement: releaseAmount } } });
      }
      if (row.payment_id) touchedPaymentIds.add(row.payment_id);
      excess -= releaseAmount;
    }
  }

  await recomputeInvoiceStatusTx(tx, { company_id, invoice_id, user_id });
  const autoApplied = await autoAllocatePaymentsForClientTx(tx, { company_id, client_id, user_id });
  if ((autoApplied.affected_invoice_ids || []).length && !autoApplied.affected_invoice_ids.includes(invoice_id)) {
    await recomputeInvoiceStatusTx(tx, { company_id, invoice_id, user_id });
  }
  return {
    released_amount: Math.max(0, allocated - toNum(target_total)),
    auto_applied_amount: autoApplied.applied_total || 0,
    affected_invoice_ids: autoApplied.affected_invoice_ids || []
  };
}

function buildInvoiceItemsFromOrder({ company_id, order }) {
  return (order.items || []).map((it) => ({
    company_id,
    product_id: it.product_id,
    quantity: toNum(it.quantity),
    unit_price: toNum(it.unit_price),
    discount: it.discount !== null && it.discount !== undefined ? toNum(it.discount) : null,
    line_total: it.line_total !== null && it.line_total !== undefined
      ? toNum(it.line_total)
      : calcLineTotal(toNum(it.quantity), toNum(it.unit_price), it.discount ? toNum(it.discount) : 0),
    remarks: it.remarks || null
  }));
}

function buildInvoiceChargesFromOrder({ company_id, order }) {
  return (order.charges || []).map((c) => ({
    company_id,
    type: c.type,
    title: c.title,
    amount: toNum(c.amount),
    meta: c.meta || null
  }));
}

async function ensureInvoiceForOrderTx(tx, { company_id, order_id, user_id }) {
  const order = await tx.order.findFirst({
    where: { id: order_id, company_id, is_active: true },
    include: { items: true, charges: true }
  });
  if (!order) {
    const err = new Error("ORDER_NOT_FOUND");
    err.statusCode = 404;
    throw err;
  }

  const existing = await tx.invoice.findFirst({
    where: { company_id, order_id, is_active: true }
  });
  if (existing) return { order, invoice: existing, created: false };

  const items = buildInvoiceItemsFromOrder({ company_id, order });
  const charges = buildInvoiceChargesFromOrder({ company_id, order });
  const subtotal = items.reduce((acc, it) => acc + toNum(it.line_total), 0);
  const total_charges = charges.reduce((acc, c) => acc + toNum(c.amount), 0);
  const total = subtotal + total_charges;

  const inv = await tx.invoice.create({
    data: {
      company_id,
      factory_id: order.factory_id,
      client_id: order.client_id,
      sales_company_id: order.sales_company_id || null,
      order_id: order.id,
      invoice_no: await makeInvoiceNoTx(tx, company_id, order.order_date || new Date()),
      kind: "TAX_INVOICE",
      status: "PENDING",
      issue_date: order.order_date || new Date(),
      due_date: null,
      subtotal,
      total_charges,
      total,
      notes: order.notes || null,
      created_by: user_id || null,
      items: { createMany: { data: items } },
      charges: { createMany: { data: charges } },
      status_history: {
        create: {
          company_id,
          status: "PENDING",
          note: "Invoice auto-created from order",
          created_by: user_id || null
        }
      }
    }
  });

  const noteSummary = getInvoiceNoteEffectByIdsTx ? (await getInvoiceNoteEffectByIdsTx(tx, { company_id, invoice_ids: [inv.id] })).get(inv.id) : null;
  const adjustedTotal = total + toNum(noteSummary?.net_effect || 0);
  if (adjustedTotal < -0.0001) {
    const err = new Error("ORDER_EDIT_NOTES_CONFLICT");
    err.statusCode = 400;
    err.meta = { adjusted_total: adjustedTotal, invoice_id: inv.id };
    throw err;
  }

  await reconcileInvoiceFinancialsTx(tx, {
    company_id,
    client_id: order.client_id,
    invoice_id: inv.id,
    user_id,
    target_total: adjustedTotal
  });

  return { order, invoice: await tx.invoice.findUnique({ where: { id: inv.id } }) };
}

async function syncInvoiceFromOrderTx(tx, { company_id, order_id, user_id }) {
  const order = await tx.order.findFirst({
    where: { id: order_id, company_id, is_active: true },
    include: { items: true, charges: true }
  });
  if (!order) {
    const err = new Error("ORDER_NOT_FOUND");
    err.statusCode = 404;
    throw err;
  }

  const ensured = await ensureInvoiceForOrderTx(tx, { company_id, order_id: order.id, user_id });
  const inv = ensured.invoice;

  if (inv.status === "VOID") return { order, invoice: inv, synced: false };

  const items = buildInvoiceItemsFromOrder({ company_id, order });
  const charges = buildInvoiceChargesFromOrder({ company_id, order });

  await tx.invoiceItem.deleteMany({ where: { company_id, invoice_id: inv.id } });
  if (items.length) {
    await tx.invoiceItem.createMany({ data: items.map((it) => ({ ...it, invoice_id: inv.id })) });
  }

  await tx.invoiceCharge.deleteMany({ where: { company_id, invoice_id: inv.id } });
  if (charges.length) {
    await tx.invoiceCharge.createMany({ data: charges.map((c) => ({ ...c, invoice_id: inv.id })) });
  }

  const subtotal = items.reduce((acc, it) => acc + toNum(it.line_total), 0);
  const total_charges = charges.reduce((acc, c) => acc + toNum(c.amount), 0);
  const total = subtotal + total_charges;

  const updated = await tx.invoice.update({
    where: { id: inv.id },
    data: {
      factory_id: order.factory_id,
      client_id: order.client_id,
      sales_company_id: order.sales_company_id || null,
      issue_date: order.order_date,
      subtotal,
      total_charges,
      total,
      notes: order.notes || null
    }
  });

  const noteSummary = (await getInvoiceNoteEffectByIdsTx(tx, { company_id, invoice_ids: [updated.id] })).get(updated.id) || { net_effect: 0 };
  const adjustedTotal = total + toNum(noteSummary.net_effect || 0);
  if (adjustedTotal < -0.0001) {
    const err = new Error("ORDER_EDIT_NOTES_CONFLICT");
    err.statusCode = 400;
    err.meta = { adjusted_total: adjustedTotal, invoice_id: updated.id };
    throw err;
  }

  await reconcileInvoiceFinancialsTx(tx, {
    company_id,
    client_id: order.client_id,
    invoice_id: updated.id,
    user_id,
    target_total: adjustedTotal
  });

  const refreshed = await tx.invoice.findUnique({ where: { id: updated.id } });
  return { order, invoice: refreshed, synced: true };
}

module.exports = {
  ensureInvoiceForOrderTx,
  syncInvoiceFromOrderTx,
  recomputeInvoiceStatusTx,
  autoApplyAvailablePaymentsToInvoiceTx,
  autoAllocatePaymentsForClientTx,
  getInvoiceNoteEffectByIdsTx,
  reconcileInvoiceFinancialsTx
};
