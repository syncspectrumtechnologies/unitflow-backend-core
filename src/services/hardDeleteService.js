const { applyBalanceDeltaTx, movementDelta } = require('./inventoryLedgerService');
const { recomputeInvoiceStatusTx } = require('./orderInvoiceService');

function toNumber(v) {
  const n = typeof v === 'string' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

async function deleteActivityLogsTx(tx, company_id, refs = []) {
  const filters = (Array.isArray(refs) ? refs : [])
    .filter((row) => row && row.entity_type && row.entity_id)
    .map((row) => ({ company_id, entity_type: row.entity_type, entity_id: row.entity_id }));
  if (!filters.length) return;
  await tx.activityLog.deleteMany({ where: { OR: filters } });
}

async function deleteInventoryMovementsTx(tx, company_id, movements = []) {
  const rows = Array.isArray(movements) ? movements : [];
  if (!rows.length) return 0;

  for (const movement of rows) {
    const delta = -movementDelta(movement.type, movement.quantity);
    await applyBalanceDeltaTx(tx, {
      company_id,
      factory_id: movement.factory_id,
      product_id: movement.product_id,
      delta,
      allowNegative: true
    });
  }

  await tx.inventoryMovement.deleteMany({ where: { company_id, id: { in: rows.map((row) => row.id) } } });
  return rows.length;
}

async function deleteAccountingVouchersHardTx(tx, { company_id, voucherIds = [] }) {
  const ids = unique(voucherIds);
  if (!ids.length) return { deleted_vouchers: 0, deleted_stock_movements: 0 };

  const stockMovements = await tx.inventoryMovement.findMany({
    where: {
      company_id,
      source_type: 'RETURN',
      source_id: { in: ids }
    },
    select: {
      id: true,
      factory_id: true,
      product_id: true,
      type: true,
      quantity: true
    }
  });

  const deletedStockMovements = await deleteInventoryMovementsTx(tx, company_id, stockMovements);
  await tx.accountingVoucherLine.deleteMany({ where: { company_id, voucher_id: { in: ids } } });
  await deleteActivityLogsTx(tx, company_id, ids.map((id) => ({ entity_type: 'accounting_voucher', entity_id: id })));
  await tx.accountingVoucher.deleteMany({ where: { company_id, id: { in: ids } } });

  return { deleted_vouchers: ids.length, deleted_stock_movements: deletedStockMovements };
}

async function hardDeletePaymentTx(tx, { company_id, payment_id, user_id = null }) {
  const payment = await tx.payment.findFirst({
    where: { id: payment_id, company_id },
    include: {
      allocations: { where: { is_active: true }, select: { id: true, invoice_id: true } }
    }
  });
  if (!payment) {
    const err = new Error('PAYMENT_NOT_FOUND');
    err.statusCode = 404;
    throw err;
  }

  const invoiceIds = unique(payment.allocations.map((row) => row.invoice_id));
  await tx.paymentAllocation.deleteMany({ where: { company_id, payment_id } });
  await deleteActivityLogsTx(tx, company_id, [{ entity_type: 'payment', entity_id: payment.id }]);
  await tx.payment.delete({ where: { id: payment.id } });

  const recomputed = [];
  for (const invoice_id of invoiceIds) {
    const next = await recomputeInvoiceStatusTx(tx, { company_id, invoice_id, user_id });
    if (next) recomputed.push({ invoice_id, ...next });
  }

  return {
    deleted_payment_id: payment.id,
    deleted_allocation_count: payment.allocations.length,
    recomputed_invoices: recomputed
  };
}

async function hardDeletePurchaseTx(tx, { company_id, purchase_id }) {
  const purchase = await tx.purchase.findFirst({
    where: { id: purchase_id, company_id },
    include: {
      payments: true,
      accounting_vouchers: { select: { id: true } }
    }
  });
  if (!purchase) {
    const err = new Error('PURCHASE_NOT_FOUND');
    err.statusCode = 404;
    throw err;
  }

  for (const payment of purchase.payments || []) {
    if (payment.source_kind === 'ADVANCE_APPLIED' && payment.advance_id && payment.status === 'RECORDED') {
      await tx.purchaseAdvance.update({
        where: { id: payment.advance_id },
        data: { remaining_amount: { increment: payment.amount } }
      });
    }
  }

  const voucherIds = unique((purchase.accounting_vouchers || []).map((row) => row.id));
  const voucherResult = await deleteAccountingVouchersHardTx(tx, { company_id, voucherIds });

  await deleteActivityLogsTx(tx, company_id, [
    { entity_type: 'purchase', entity_id: purchase.id },
    ...((purchase.payments || []).map((row) => ({ entity_type: 'purchase_payment', entity_id: row.id })))
  ]);

  await tx.purchasePayment.deleteMany({ where: { company_id, purchase_id: purchase.id } });
  await tx.purchaseStatusHistory.deleteMany({ where: { company_id, purchase_id: purchase.id } });
  await tx.purchaseItem.deleteMany({ where: { company_id, purchase_id: purchase.id } });
  await tx.purchaseCharge.deleteMany({ where: { company_id, purchase_id: purchase.id } });
  await tx.purchase.delete({ where: { id: purchase.id } });

  return {
    deleted_purchase_id: purchase.id,
    restored_purchase_balance_count: (purchase.payments || []).filter((row) => row.source_kind === 'ADVANCE_APPLIED' && row.status === 'RECORDED' && row.advance_id).length,
    deleted_purchase_payment_count: (purchase.payments || []).length,
    ...voucherResult
  };
}

async function hardDeleteOrderTx(tx, { company_id, order_id }) {
  const order = await tx.order.findFirst({
    where: { id: order_id, company_id },
    include: {
      fulfillments: { select: { id: true } },
      invoices: { select: { id: true } }
    }
  });
  if (!order) {
    const err = new Error('ORDER_NOT_FOUND');
    err.statusCode = 404;
    throw err;
  }

  const invoiceIds = unique((order.invoices || []).map((row) => row.id));
  const fulfillmentIds = unique((order.fulfillments || []).map((row) => row.id));

  const linkedVouchers = invoiceIds.length
    ? await tx.accountingVoucher.findMany({
        where: { company_id, invoice_id: { in: invoiceIds } },
        select: { id: true }
      })
    : [];
  const voucherIds = unique(linkedVouchers.map((row) => row.id));
  const voucherResult = await deleteAccountingVouchersHardTx(tx, { company_id, voucherIds });

  const linkedPayments = invoiceIds.length
    ? await tx.payment.findMany({
        where: {
          company_id,
          OR: [
            { order_id: order.id },
            { allocations: { some: { is_active: true, invoice_id: { in: invoiceIds } } } }
          ]
        },
        include: {
          allocations: { where: { is_active: true }, select: { id: true, invoice_id: true } }
        }
      })
    : await tx.payment.findMany({
        where: { company_id, order_id: order.id },
        include: { allocations: { where: { is_active: true }, select: { id: true, invoice_id: true } } }
      });

  const paymentsToDelete = [];
  const paymentIdsToDetach = [];
  const allocationIdsToDelete = [];
  const paymentIdsToNullOrder = [];

  for (const payment of linkedPayments) {
    const allocationsForDeletedInvoices = (payment.allocations || []).filter((row) => invoiceIds.includes(row.invoice_id));
    const otherAllocations = (payment.allocations || []).filter((row) => !invoiceIds.includes(row.invoice_id));

    if (payment.order_id === order.id && otherAllocations.length === 0) {
      paymentsToDelete.push(payment.id);
      continue;
    }

    if (allocationsForDeletedInvoices.length) {
      allocationIdsToDelete.push(...allocationsForDeletedInvoices.map((row) => row.id));
      paymentIdsToDetach.push(payment.id);
    }

    if (payment.order_id === order.id) {
      paymentIdsToNullOrder.push(payment.id);
    }
  }

  if (allocationIdsToDelete.length) {
    await tx.paymentAllocation.deleteMany({ where: { company_id, id: { in: unique(allocationIdsToDelete) } } });
  }

  if (paymentIdsToNullOrder.length) {
    await tx.payment.updateMany({
      where: { company_id, id: { in: unique(paymentIdsToNullOrder) } },
      data: { order_id: null }
    });
  }

  if (paymentsToDelete.length) {
    await tx.paymentAllocation.deleteMany({ where: { company_id, payment_id: { in: unique(paymentsToDelete) } } });
    await deleteActivityLogsTx(tx, company_id, unique(paymentsToDelete).map((id) => ({ entity_type: 'payment', entity_id: id })));
    await tx.payment.deleteMany({ where: { company_id, id: { in: unique(paymentsToDelete) } } });
  }

  const orderMovementFilters = [];
  orderMovementFilters.push({ source_type: 'ORDER', source_id: order.id });
  if (fulfillmentIds.length) orderMovementFilters.push({ source_type: 'ORDER', source_id: { in: fulfillmentIds } });
  orderMovementFilters.push({ source_type: 'RETURN', source_id: order.id });

  const inventoryMovements = await tx.inventoryMovement.findMany({
    where: {
      company_id,
      OR: orderMovementFilters
    },
    select: {
      id: true,
      factory_id: true,
      product_id: true,
      type: true,
      quantity: true
    }
  });
  const deletedStockMovements = await deleteInventoryMovementsTx(tx, company_id, inventoryMovements);

  await deleteActivityLogsTx(tx, company_id, [
    { entity_type: 'order', entity_id: order.id },
    ...invoiceIds.map((id) => ({ entity_type: 'invoice', entity_id: id }))
  ]);

  if (invoiceIds.length) {
    await tx.invoiceStatusHistory.deleteMany({ where: { company_id, invoice_id: { in: invoiceIds } } });
    await tx.invoiceItem.deleteMany({ where: { company_id, invoice_id: { in: invoiceIds } } });
    await tx.invoiceCharge.deleteMany({ where: { company_id, invoice_id: { in: invoiceIds } } });
    await tx.paymentAllocation.deleteMany({ where: { company_id, invoice_id: { in: invoiceIds } } });
    await tx.invoice.deleteMany({ where: { company_id, id: { in: invoiceIds } } });
  }

  await tx.orderStatusHistory.deleteMany({ where: { company_id, order_id: order.id } });
  await tx.orderItem.deleteMany({ where: { company_id, order_id: order.id } });
  await tx.orderCharge.deleteMany({ where: { company_id, order_id: order.id } });
  await tx.orderFulfillment.deleteMany({ where: { company_id, order_id: order.id } });
  await tx.order.delete({ where: { id: order.id } });

  return {
    deleted_order_id: order.id,
    deleted_invoice_count: invoiceIds.length,
    deleted_payment_count: unique(paymentsToDelete).length,
    detached_payment_allocation_count: unique(allocationIdsToDelete).length,
    detached_payment_count: unique(paymentIdsToDetach).length,
    deleted_stock_movements: deletedStockMovements,
    ...voucherResult
  };
}

module.exports = {
  hardDeletePaymentTx,
  hardDeletePurchaseTx,
  hardDeleteOrderTx
};
