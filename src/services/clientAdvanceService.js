const { makePurchaseAdvanceNoTx, makePurchasePaymentNoTx } = require('../utils/numbering');
const { parseDateOrNull } = require('../utils/fiscalYear');

function toNumber(v) {
  const n = typeof v === 'string' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeString(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s || null;
}

async function listPurchaseAdvancesTx(tx, { company_id, client_id }) {
  return tx.purchaseAdvance.findMany({
    where: { company_id, client_id },
    orderBy: [{ paid_at: 'desc' }, { created_at: 'desc' }]
  });
}

async function createPurchaseAdvanceTx(tx, {
  company_id,
  client_id,
  factory_id = null,
  amount,
  paid_at,
  method,
  reference,
  notes,
  user_id
}) {
  const when = paid_at || new Date();
  return tx.purchaseAdvance.create({
    data: {
      company_id,
      client_id,
      factory_id: factory_id || null,
      advance_no: await makePurchaseAdvanceNoTx(tx, company_id, when),
      amount,
      remaining_amount: amount,
      paid_at: when,
      method: method || null,
      reference: normalizeString(reference),
      notes: normalizeString(notes),
      created_by: user_id || null,
      status: 'RECORDED',
      side: 'PURCHASE'
    }
  });
}

async function reversePurchaseAdvanceTx(tx, { company_id, advance_id, user_id, reversal_note }) {
  const advance = await tx.purchaseAdvance.findFirst({
    where: { id: advance_id, company_id }
  });
  if (!advance) {
    const err = new Error('PURCHASE_ADVANCE_NOT_FOUND');
    err.statusCode = 404;
    throw err;
  }
  if (advance.status === 'REVERSED') {
    const err = new Error('PURCHASE_ADVANCE_ALREADY_REVERSED');
    err.statusCode = 400;
    throw err;
  }

  const recordedAppliedAgg = await tx.purchasePayment.aggregate({
    where: { company_id, advance_id, status: 'RECORDED' },
    _sum: { amount: true }
  });
  const appliedAmount = toNumber(recordedAppliedAgg?._sum?.amount || 0);
  if (appliedAmount > 0.0001) {
    const err = new Error('PURCHASE_ADVANCE_HAS_APPLIED_PAYMENTS');
    err.statusCode = 400;
    throw err;
  }

  return tx.purchaseAdvance.update({
    where: { id: advance_id },
    data: {
      status: 'REVERSED',
      reversed_at: new Date(),
      reversed_by: user_id || null,
      reversal_note: normalizeString(reversal_note)
    }
  });
}

async function getPurchaseAdvanceSummaryTx(tx, { company_id, client_id }) {
  const [advanceAgg, remainingAgg] = await Promise.all([
    tx.purchaseAdvance.aggregate({
      where: { company_id, client_id, status: 'RECORDED' },
      _sum: { amount: true }
    }),
    tx.purchaseAdvance.aggregate({
      where: { company_id, client_id, status: 'RECORDED' },
      _sum: { remaining_amount: true }
    })
  ]);

  const total_paid = toNumber(advanceAgg?._sum?.amount || 0);
  const available_advance = toNumber(remainingAgg?._sum?.remaining_amount || 0);
  const applied_advance = total_paid - available_advance;
  return { total_paid, applied_advance, available_advance };
}

async function getSalesAdvanceSummaryTx(tx, { company_id, client_id }) {
  const [paymentAgg, allocationAgg] = await Promise.all([
    tx.payment.aggregate({
      where: { company_id, client_id, status: 'RECORDED' },
      _sum: { amount: true }
    }),
    tx.paymentAllocation.aggregate({
      where: { company_id, is_active: true, payment: { company_id, client_id, status: 'RECORDED' } },
      _sum: { amount: true }
    })
  ]);

  const total_received = toNumber(paymentAgg?._sum?.amount || 0);
  const allocated_amount = toNumber(allocationAgg?._sum?.amount || 0);
  const available_advance = total_received - allocated_amount;
  return { total_received, allocated_amount, available_advance };
}


async function syncPurchasePaymentSnapshotTx(tx, company_id, purchase_id) {
  const payments = await tx.purchasePayment.findMany({
    where: { company_id, purchase_id, status: 'RECORDED' },
    orderBy: [{ paid_at: 'desc' }, { created_at: 'desc' }]
  });
  const totalPaid = payments.reduce((acc, payment) => acc + toNumber(payment.amount), 0);
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
}

async function getPurchaseNoteEffectByIdsTx(tx, { company_id, purchase_ids }) {
  if (!Array.isArray(purchase_ids) || purchase_ids.length === 0) return new Map();
  const vouchers = await tx.accountingVoucher.findMany({
    where: {
      company_id,
      purchase_id: { in: purchase_ids },
      is_active: true,
      voucher_type: { in: ['DEBIT_NOTE', 'CREDIT_NOTE'] }
    },
    select: { purchase_id: true, voucher_type: true, total_amount: true }
  });

  const map = new Map();
  for (const voucher of vouchers) {
    const key = voucher.purchase_id;
    if (!key) continue;
    const current = map.get(key) || { debit_note_total: 0, credit_note_total: 0, net_effect: 0 };
    const amount = toNumber(voucher.total_amount);
    if (voucher.voucher_type === 'DEBIT_NOTE') current.debit_note_total += amount;
    if (voucher.voucher_type === 'CREDIT_NOTE') current.credit_note_total += amount;
    current.net_effect = current.credit_note_total - current.debit_note_total;
    map.set(key, current);
  }
  return map;
}

async function autoAllocatePurchaseBalancesForClientTx(tx, { company_id, client_id, user_id }) {
  if (!client_id) return { applied_total: 0, payments_created: 0, affected_purchase_ids: [] };

  const [purchases, paymentAggs, advances] = await Promise.all([
    tx.purchase.findMany({
      where: { company_id, client_id, is_active: true },
      select: { id: true, total: true, purchase_date: true, created_at: true },
      orderBy: [{ purchase_date: 'asc' }, { created_at: 'asc' }, { id: 'asc' }]
    }),
    tx.purchasePayment.groupBy({
      by: ['purchase_id'],
      where: {
        company_id,
        status: 'RECORDED',
        purchase: { client_id, is_active: true }
      },
      _sum: { amount: true }
    }),
    tx.purchaseAdvance.findMany({
      where: { company_id, client_id, status: 'RECORDED', remaining_amount: { gt: 0 } },
      orderBy: [{ paid_at: 'asc' }, { created_at: 'asc' }, { id: 'asc' }]
    })
  ]);

  if (!purchases.length || !advances.length) return { applied_total: 0, payments_created: 0, affected_purchase_ids: [] };

  const noteEffects = await getPurchaseNoteEffectByIdsTx(tx, { company_id, purchase_ids: purchases.map((p) => p.id) });
  const paidMap = new Map(paymentAggs.map((row) => [row.purchase_id, toNumber(row?._sum?.amount || 0)]));
  const advanceState = advances.map((advance) => ({ ...advance, remaining_amount: toNumber(advance.remaining_amount) }));

  let applied_total = 0;
  let payments_created = 0;
  const affected = new Set();

  for (const purchase of purchases) {
    const summary = noteEffects.get(purchase.id) || { net_effect: 0 };
    const targetTotal = toNumber(purchase.total) + toNumber(summary.net_effect || 0);
    let remainingDue = targetTotal - toNumber(paidMap.get(purchase.id) || 0);
    if (remainingDue <= 0.0001) continue;

    for (const advance of advanceState) {
      if (remainingDue <= 0.0001) break;
      const available = toNumber(advance.remaining_amount);
      if (available <= 0.0001) continue;

      const applyAmount = Math.min(available, remainingDue);
      await tx.purchasePayment.create({
        data: {
          company_id,
          purchase_id: purchase.id,
          advance_id: advance.id,
          payment_no: await makePurchasePaymentNoTx(tx, company_id, advance.paid_at || purchase.purchase_date || new Date()),
          status: 'RECORDED',
          source_kind: 'ADVANCE_APPLIED',
          amount: applyAmount,
          paid_at: advance.paid_at || purchase.purchase_date || new Date(),
          method: advance.method || null,
          reference: normalizeString(advance.reference || advance.advance_no),
          notes: normalizeString(`Auto-applied from client payment ${advance.advance_no}${advance.notes ? ` - ${advance.notes}` : ''}`),
          created_by: user_id || null
        }
      });

      await tx.purchaseAdvance.update({
        where: { id: advance.id },
        data: { remaining_amount: { decrement: applyAmount } }
      });

      advance.remaining_amount = available - applyAmount;
      paidMap.set(purchase.id, toNumber(paidMap.get(purchase.id) || 0) + applyAmount);
      remainingDue -= applyAmount;
      applied_total += applyAmount;
      payments_created += 1;
      affected.add(purchase.id);
    }
  }

  for (const purchase_id of affected) {
    await syncPurchasePaymentSnapshotTx(tx, company_id, purchase_id);
  }

  return { applied_total, payments_created, affected_purchase_ids: Array.from(affected) };
}

async function autoApplyPurchaseAdvancesToPurchaseTx(tx, { company_id, purchase_id, client_id, user_id }) {
  const result = await autoAllocatePurchaseBalancesForClientTx(tx, { company_id, client_id, user_id });
  return {
    applied_total: result.applied_total,
    payments_created: result.payments_created,
    affected_purchase_ids: result.affected_purchase_ids,
    requested_purchase_id: purchase_id || null
  };
}

module.exports = {
  toNumber,
  normalizeString,
  parseDateOrNull,
  listPurchaseAdvancesTx,
  createPurchaseAdvanceTx,
  reversePurchaseAdvanceTx,
  getPurchaseAdvanceSummaryTx,
  getSalesAdvanceSummaryTx,
  autoApplyPurchaseAdvancesToPurchaseTx,
  autoAllocatePurchaseBalancesForClientTx,
  getPurchaseNoteEffectByIdsTx
};
