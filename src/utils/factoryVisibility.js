// Helpers to apply factory-scoped visibility for records that are no longer strictly
// tied to a single factory row (e.g., multi-factory Order fulfillments).

function scopeIds(req) {
  if (req.factory_id) return { ids: [req.factory_id], mode: "ONE" };
  if (Array.isArray(req.factory_ids) && req.factory_ids.length) return { ids: req.factory_ids, mode: "MANY" };
  return { ids: [], mode: "NONE" };
}

// Orders are visible to a factory if there exists at least one active fulfillment row
// for that factory. For legacy orders without fulfillments, fall back to order.factory_id.
function orderVisibilityWhere(req) {
  const { ids, mode } = scopeIds(req);
  if (!ids.length) return {};
  const idFilter = mode === "ONE" ? ids[0] : { in: ids };
  return {
    OR: [
      { fulfillments: { some: { is_active: true, factory_id: idFilter } } },
      { factory_id: idFilter, fulfillments: { none: {} } }
    ]
  };
}

// Invoices: 
// - If linked to an order, visibility follows the order's fulfillments (or legacy order.factory_id).
// - If manual (order_id = null), visibility is invoice.factory_id.
function invoiceVisibilityWhere(req) {
  const { ids, mode } = scopeIds(req);
  if (!ids.length) return {};
  const idFilter = mode === "ONE" ? ids[0] : { in: ids };
  return {
    OR: [
      { order: { is: { fulfillments: { some: { is_active: true, factory_id: idFilter } } } } },
      { order: { is: { fulfillments: { none: {} } } }, factory_id: idFilter },
      { order_id: null, factory_id: idFilter }
    ]
  };
}

// Payments:
// - If linked to an order, visibility follows the order's fulfillments (or legacy order.factory_id).
// - Otherwise, fall back to payment.factory_id.
function paymentVisibilityWhere(req) {
  const { ids, mode } = scopeIds(req);
  if (!ids.length) return {};
  const idFilter = mode === "ONE" ? ids[0] : { in: ids };
  return {
    OR: [
      { order: { is: { fulfillments: { some: { is_active: true, factory_id: idFilter } } } } },
      { order: { is: { fulfillments: { none: {} } } }, factory_id: idFilter },
      { order_id: null, factory_id: idFilter }
    ]
  };
}

module.exports = {
  scopeIds,
  orderVisibilityWhere,
  invoiceVisibilityWhere,
  paymentVisibilityWhere
};
