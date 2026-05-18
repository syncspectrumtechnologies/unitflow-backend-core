const prisma = require("../config/db");
const logActivity = require("../utils/activityLogger");
const { makeOrderNoTx } = require("../utils/numbering");
const { requireSingleFactory } = require("../utils/factoryScope");
const { orderVisibilityWhere } = require("../utils/factoryVisibility");
const { ensureInvoiceForOrderTx, syncInvoiceFromOrderTx } = require("../services/orderInvoiceService");
const { hardDeleteOrderTx } = require("../services/hardDeleteService");
const { getPagination, buildPaginationMeta } = require("../utils/pagination");
const { getBalanceTx, createMovementTx } = require("../services/inventoryLedgerService");
const { resolveSender, getRequestedSenderKey } = require("../services/messageSenderService");
const { normalizeChargeInput } = require("../utils/chargeInput");

function parseDateOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toNumber(v) {
  const n = typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function normalizeString(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s || null;
}

function serializeLogisticsInput(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  try {
    return JSON.stringify(value);
  } catch (_err) {
    return String(value);
  }
}

async function validateOrderEditFactoryAccessTx(tx, { company_id, user, factory_id }) {
  const factory = await tx.factory.findFirst({
    where: { id: factory_id, company_id, is_active: true },
    select: { id: true }
  });
  if (!factory) {
    const err = new Error("FACTORY_NOT_FOUND");
    err.statusCode = 404;
    throw err;
  }
  if (!user.is_admin) {
    const access = await tx.userFactoryMap.findFirst({
      where: { company_id, user_id: user.id, factory_id }
    });
    if (!access) {
      const err = new Error("UNAUTHORIZED_FACTORY_ACCESS");
      err.statusCode = 403;
      throw err;
    }
  }
}

// NOTE: This uses scalar FK filters. If your InventoryMovement model also moved to "relations-only",
// then this function must be updated too (tell me if you see "Unknown argument company_id" in aggregate filters).
async function getStockTx(tx, company_id, factory_id, product_id) {
  return getBalanceTx(tx, company_id, factory_id, product_id);
}

function calcLineTotal(qty, price, discount) {
  const d = discount ? Number(discount) : 0;
  return qty * price - d;
}

function sumCharges(charges = []) {
  return charges.reduce((acc, c) => acc + Number(c.amount || 0), 0);
}

const ORDER_TRANSACTION_OPTIONS = { maxWait: 10000, timeout: 30000 };

const ORDER_STATUS_VALUES = new Set([
  "DRAFT",
  "CONFIRMED",
  "PROCESSING",
  "DISPATCHED",
  "COMPLETED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "CLOSED"
]);

const DISPATCH_TRIGGER_STATUSES = new Set(["DISPATCHED", "COMPLETED", "SHIPPED", "DELIVERED"]);

function normalizeOrderStatusInput(value) {
  const raw = (value || "").toString().trim().toUpperCase();
  if (!raw) return null;

  const aliasMap = {
    DISPATCH: "DISPATCHED",
    COMPLETE: "COMPLETED"
  };

  const normalized = aliasMap[raw] || raw;
  return ORDER_STATUS_VALUES.has(normalized) ? normalized : null;
}

function isDispatchTriggerStatus(status) {
  return DISPATCH_TRIGGER_STATUSES.has(String(status || "").toUpperCase());
}

function hasCommittedInventory(order) {
  return Boolean(order?.fulfillments?.some((f) => f.is_active !== false));
}

function aggregateOrderQtyByProduct(items = []) {
  const map = new Map();
  for (const item of items) {
    const productId = String(item.product_id);
    map.set(productId, (map.get(productId) || 0) + Number(item.quantity || 0));
  }
  return map;
}

function buildDispatchAllocationRows(order, payload, fallbackFactoryId) {
  const orderedQtyByProduct = aggregateOrderQtyByProduct(order.items || []);
  const orderProductIds = [...orderedQtyByProduct.keys()];
  const singleProductId = orderProductIds.length === 1 ? orderProductIds[0] : null;

  const normalizeProductId = (value) => {
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    return singleProductId;
  };

  let sourceRows = [];
  const topLevelRows = Array.isArray(payload?.allocations)
    ? payload.allocations
    : (Array.isArray(payload?.fulfillments) ? payload.fulfillments : null);

  const hasItemLevelAllocations = Array.isArray(payload?.items)
    && payload.items.some((it) => Array.isArray(it?.allocations) || Array.isArray(it?.fulfillments));

  if (topLevelRows && topLevelRows.length) {
    sourceRows = topLevelRows.map((row) => ({
      product_id: normalizeProductId(row.product_id),
      factory_id: row.factory_id,
      quantity: row.quantity
    }));
  } else if (hasItemLevelAllocations) {
    for (const item of payload.items) {
      const rows = Array.isArray(item?.allocations) ? item.allocations : (Array.isArray(item?.fulfillments) ? item.fulfillments : []);
      const productId = normalizeProductId(item?.product_id);
      for (const row of rows) {
        sourceRows.push({
          product_id: normalizeProductId(row.product_id) || productId,
          factory_id: row.factory_id,
          quantity: row.quantity
        });
      }
    }
  } else if (Array.isArray(order.fulfillments) && order.fulfillments.length) {
    sourceRows = order.fulfillments.map((row) => ({
      product_id: row.product_id,
      factory_id: row.factory_id,
      quantity: row.quantity
    }));
  } else {
    sourceRows = orderProductIds.map((product_id) => ({
      product_id,
      factory_id: fallbackFactoryId,
      quantity: orderedQtyByProduct.get(product_id)
    }));
  }

  const aggregated = new Map();
  for (const row of sourceRows) {
    const product_id = normalizeProductId(row.product_id);
    const factory_id = row.factory_id ? String(row.factory_id).trim() : "";
    const quantity = Number(row.quantity);

    if (!product_id) {
      const err = new Error("DISPATCH_ALLOCATIONS_INVALID");
      err.statusCode = 400;
      err.meta = { reason: "product_id is required for each allocation when the order has multiple products" };
      throw err;
    }
    if (!orderedQtyByProduct.has(product_id)) {
      const err = new Error("DISPATCH_ALLOCATIONS_INVALID");
      err.statusCode = 400;
      err.meta = { reason: "allocation contains a product that is not part of the order", product_id };
      throw err;
    }
    if (!factory_id) {
      const err = new Error("DISPATCH_ALLOCATIONS_INVALID");
      err.statusCode = 400;
      err.meta = { reason: "factory_id is required for each dispatch allocation", product_id };
      throw err;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      const err = new Error("DISPATCH_ALLOCATIONS_INVALID");
      err.statusCode = 400;
      err.meta = { reason: "allocation quantity must be > 0", product_id, factory_id, quantity: row.quantity };
      throw err;
    }

    const key = `${factory_id}|${product_id}`;
    aggregated.set(key, {
      product_id,
      factory_id,
      quantity: (aggregated.get(key)?.quantity || 0) + quantity
    });
  }

  const allocationRows = [...aggregated.values()];
  const allocatedQtyByProduct = new Map();
  for (const row of allocationRows) {
    allocatedQtyByProduct.set(row.product_id, (allocatedQtyByProduct.get(row.product_id) || 0) + Number(row.quantity));
  }

  const missingProducts = orderProductIds.filter((product_id) => !allocatedQtyByProduct.has(product_id));
  if (missingProducts.length) {
    const err = new Error("DISPATCH_ALLOCATIONS_INVALID");
    err.statusCode = 400;
    err.meta = { reason: "dispatch allocations are missing one or more ordered products", missing_product_ids: missingProducts };
    throw err;
  }

  for (const product_id of orderProductIds) {
    const orderedQty = Number(orderedQtyByProduct.get(product_id) || 0);
    const allocatedQty = Number(allocatedQtyByProduct.get(product_id) || 0);
    if (Math.abs(orderedQty - allocatedQty) > 1e-9) {
      const err = new Error("DISPATCH_ALLOCATIONS_INVALID");
      err.statusCode = 400;
      err.meta = {
        reason: "dispatch allocation quantity must match ordered quantity",
        product_id,
        ordered_quantity: orderedQty,
        allocated_quantity: allocatedQty
      };
      throw err;
    }
  }

  return allocationRows;
}

function buildInsufficientStockMessage(shortages = []) {
  const factories = [...new Set(shortages.map((row) => row.factory_name || row.factory_id))];
  if (!factories.length) return "Insufficient stock for one or more items";
  if (factories.length === 1) return `Insufficient stock in ${factories[0]}`;
  return `Insufficient stock in ${factories.join(", ")}`;
}

function getRequestedFactoryFilter(req) {
  const q = (req.query.factory_id || "").toString().trim();
  const h = (req.headers["x-factory-id"] || "").toString().trim();

  const requested = q || h;
  if (!requested || requested.toLowerCase() === "all") return null;

  return requested;
}

async function validateDispatchAllocationsTx(tx, { company_id, user, order, allocationRows, checkStock = true }) {
  const factoryIds = [...new Set(allocationRows.map((row) => row.factory_id))];
  const productIds = [...new Set(allocationRows.map((row) => row.product_id))];

  const [factories, products] = await Promise.all([
    tx.factory.findMany({
      where: { company_id, id: { in: factoryIds }, is_active: true },
      select: { id: true, name: true }
    }),
    tx.product.findMany({
      where: { company_id, id: { in: productIds }, is_active: true },
      select: { id: true, name: true }
    })
  ]);

  if (factories.length !== factoryIds.length) {
    const found = new Set(factories.map((f) => f.id));
    const missing = factoryIds.filter((id) => !found.has(id));
    const err = new Error("FACTORY_NOT_FOUND");
    err.statusCode = 404;
    err.meta = { missing_factory_ids: missing };
    throw err;
  }

  if (products.length !== productIds.length) {
    const found = new Set(products.map((p) => p.id));
    const missing = productIds.filter((id) => !found.has(id));
    const err = new Error("PRODUCT_NOT_FOUND");
    err.statusCode = 404;
    err.meta = { missing_product_ids: missing };
    throw err;
  }

  if (!user.is_admin) {
    const access = await tx.userFactoryMap.findMany({
      where: { company_id, user_id: user.id, factory_id: { in: factoryIds } },
      select: { factory_id: true }
    });
    if (access.length !== factoryIds.length) {
      const allowed = new Set(access.map((row) => row.factory_id));
      const missing = factoryIds.filter((id) => !allowed.has(id));
      const err = new Error("UNAUTHORIZED_FACTORY_ACCESS");
      err.statusCode = 403;
      err.meta = { missing_factory_ids: missing };
      throw err;
    }
  }

  const factoryNameById = new Map(factories.map((row) => [row.id, row.name]));
  const productNameById = new Map(products.map((row) => [row.id, row.name]));

  if (checkStock) {
    const shortages = [];
    for (const row of allocationRows) {
      const available = await getStockTx(tx, company_id, row.factory_id, row.product_id);
      const required = Number(row.quantity || 0);
      if (available < required) {
        shortages.push({
          factory_id: row.factory_id,
          factory_name: factoryNameById.get(row.factory_id) || row.factory_id,
          product_id: row.product_id,
          product_name: productNameById.get(row.product_id) || row.product_id,
          available_stock: available,
          required_stock: required,
          short_by: required - available
        });
      }
    }

    if (shortages.length) {
      const err = new Error("INSUFFICIENT_STOCK");
      err.statusCode = 400;
      err.meta = {
        shortages,
        shortage_factories: [...new Set(shortages.map((row) => row.factory_id))],
        shortage_factory_names: [...new Set(shortages.map((row) => row.factory_name))],
        details: buildInsufficientStockMessage(shortages)
      };
      throw err;
    }
  }

  return { factoryNameById, productNameById };
}

async function getCommittedOrderMovementsTx(tx, { company_id, order_id, fulfillment_ids = [] }) {
  return tx.inventoryMovement.findMany({
    where: {
      company_id,
      source_type: "ORDER",
      type: "OUT",
      OR: [
        ...(fulfillment_ids.length ? [{ source_id: { in: fulfillment_ids } }] : []),
        { source_id: order_id }
      ]
    },
    select: { id: true, factory_id: true, product_id: true, quantity: true }
  });
}

async function commitOrderInventoryTx(tx, { company_id, order, allocationRows, user_id, now = new Date() }) {
  const activeFulfillments = Array.isArray(order.fulfillments) ? order.fulfillments.filter((row) => row.is_active !== false) : [];
  const fulfillmentByKey = new Map(activeFulfillments.map((row) => [`${row.factory_id}|${row.product_id}`, row]));
  const movementRows = [];
  let fulfillments_created = 0;

  for (const allocation of allocationRows) {
    const key = `${allocation.factory_id}|${allocation.product_id}`;
    let fulfillment = fulfillmentByKey.get(key);

    if (!fulfillment) {
      fulfillment = await tx.orderFulfillment.create({
        data: {
          company_id,
          order_id: order.id,
          factory_id: allocation.factory_id,
          product_id: allocation.product_id,
          quantity: Number(allocation.quantity),
          is_active: true,
          created_by: user_id
        }
      });
      fulfillmentByKey.set(key, fulfillment);
      fulfillments_created += 1;
    }

    movementRows.push({ fulfillment, allocation });
  }

  for (const row of movementRows) {
    await createMovementTx(tx, {
      company_id,
      factory_id: row.fulfillment.factory_id,
      product_id: row.fulfillment.product_id,
      type: "OUT",
      source_type: "ORDER",
      source_id: row.fulfillment.id,
      date: now,
      quantity: Number(row.allocation.quantity),
      remarks: `Order ${order.order_no} dispatched - inventory deducted`,
      created_by: user_id
    });
  }

  return {
    fulfillments_created,
    inventory_movements_created: movementRows.length
  };
}

async function cancelOrderTx(tx, { company_id, order, note, user_id, now = new Date() }) {
  const fulfillments = Array.isArray(order.fulfillments) ? order.fulfillments : [];
  const fulfillmentIds = fulfillments.map((f) => f.id);
  const committedOrderMovements = await getCommittedOrderMovementsTx(tx, {
    company_id,
    order_id: order.id,
    fulfillment_ids: fulfillmentIds
  });

  for (const movement of committedOrderMovements) {
    await createMovementTx(tx, {
      company_id,
      factory_id: movement.factory_id,
      product_id: movement.product_id,
      type: "IN",
      source_type: "RETURN",
      source_id: order.id,
      date: now,
      quantity: Number(movement.quantity),
      remarks: `Order ${order.order_no} cancelled - stock returned`,
      created_by: user_id
    });
  }

  if (order.invoices.length) {
    const invoiceIds = order.invoices.map((i) => i.id);

    await tx.paymentAllocation.updateMany({
      where: { company_id, invoice_id: { in: invoiceIds }, is_active: true },
      data: { is_active: false }
    });

    await tx.invoice.updateMany({
      where: { company_id, order_id: order.id, id: { in: invoiceIds } },
      data: { status: "VOID" }
    });

    await tx.invoiceStatusHistory.createMany({
      data: invoiceIds.map((invId) => ({
        company_id,
        invoice_id: invId,
        status: "VOID",
        note: `Auto-voided due to order cancellation${note ? `: ${String(note)}` : ""}`,
        created_by: user_id
      }))
    });
  }

  const updated = await tx.order.update({
    where: { id: order.id },
    data: { status: "CANCELLED" }
  });

  await tx.orderStatusHistory.create({
    data: {
      company_id,
      order_id: order.id,
      status: "CANCELLED",
      note: note?.toString() || "Order cancelled",
      created_by: user_id
    }
  });

  return updated;
}

async function cancelOrderAction(req, { orderId, note, request_factory_id }) {
  const company_id = req.user.company_id;
  const existing = await prisma.order.findFirst({
    where: { AND: [{ id: orderId, company_id, is_active: true }, orderVisibilityWhere(req)] },
    include: {
      items: true,
      fulfillments: { where: { is_active: true } },
      invoices: { select: { id: true, status: true } }
    }
  });
  if (!existing) {
    const err = new Error("ORDER_NOT_FOUND");
    err.statusCode = 404;
    throw err;
  }

  if (existing.status === "CANCELLED") {
    const err = new Error("ORDER_ALREADY_CANCELLED");
    err.statusCode = 400;
    throw err;
  }
  if (["COMPLETED", "DELIVERED", "CLOSED"].includes(existing.status)) {
    const err = new Error("ORDER_CANCELLATION_BLOCKED");
    err.statusCode = 400;
    throw err;
  }

  const updated = await prisma.$transaction((tx) => cancelOrderTx(tx, {
    company_id,
    order: existing,
    note,
    user_id: req.user.id,
    now: new Date()
  }), ORDER_TRANSACTION_OPTIONS);

  await logActivity({
    company_id,
    factory_id: request_factory_id,
    user_id: req.user.id,
    action: "ORDER_CANCELLED",
    entity_type: "order",
    entity_id: orderId,
    meta: { note: note || null }
  });

  return updated;
}
function buildRequestedFactoryOrderFilter(requestedFactoryId) {
  if (!requestedFactoryId) return null;

  return {
    OR: [
      // Non-dispatched / pre-commit orders should filter only by primary factory
      {
        status: { in: ["DRAFT", "CONFIRMED", "PROCESSING"] },
        factory_id: requestedFactoryId
      },

      // Dispatched / committed orders should prefer fulfillment-based matching
      {
        status: { in: ["DISPATCHED", "COMPLETED", "SHIPPED", "DELIVERED", "CANCELLED", "CLOSED"] },
        OR: [
          { fulfillments: { some: { factory_id: requestedFactoryId, is_active: true } } },

          // fallback for older records with no fulfillments
          {
            AND: [
              { fulfillments: { none: { is_active: true } } },
              { factory_id: requestedFactoryId }
            ]
          }
        ]
      }
    ]
  };
}

exports.getOrders = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = orderVisibilityWhere(req);
    const requestedFactoryId = getRequestedFactoryFilter(req);

    const client_id = (req.query.client_id || "").toString().trim();
    const sales_company_id = (req.query.sales_company_id || "").toString().trim();
    const rawStatus = (req.query.status || "").toString().trim();
    const status = rawStatus ? normalizeOrderStatusInput(rawStatus) : null;
    const date_from = parseDateOrNull(req.query.date_from);
    const date_to = parseDateOrNull(req.query.date_to);

    if (rawStatus && !status) {
      return res.status(400).json({ message: "Invalid order status" });
    }

    const where = {
      company_id,
      is_active: true,
      AND: [
        fw
      ]
    };

    const requestedFactoryFilter = buildRequestedFactoryOrderFilter(requestedFactoryId);
    if (requestedFactoryFilter) {
      where.AND.push(requestedFactoryFilter);
    }

    if (client_id) where.client_id = client_id;
    if (sales_company_id) where.sales_company_id = sales_company_id;
    if (status) where.status = status;
    if (date_from || date_to) {
      where.order_date = {};
      if (date_from) where.order_date.gte = date_from;
      if (date_to) where.order_date.lte = date_to;
    }

    const pagination = getPagination(req, { defaultPageSize: 25, maxPageSize: 100 });
    const query = {
      where,
      orderBy: [{ order_date: "desc" }, { id: "desc" }],
      include: {
        client: { select: { id: true, company_name: true } },
        factory: { select: { id: true, name: true } },
        sales_company: { select: { id: true, name: true } },
        _count: { select: { items: true, invoices: true } }
      }
    };

    if (pagination.enabled) {
      query.skip = pagination.skip;
      query.take = pagination.take;
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany(query),
      pagination.enabled && pagination.include_total ? prisma.order.count({ where }) : Promise.resolve(null)
    ]);

    if (!pagination.enabled) return res.json(orders);

    return res.json({
      items: orders,
      pagination: buildPaginationMeta({
        page: pagination.page,
        page_size: pagination.page_size,
        total: total ?? orders.length
      })
    });
  } catch (err) {
    console.error("getOrders error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// GET /orders/recent?limit=3
// Lightweight list for home dashboard widgets.
exports.getRecentOrders = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = orderVisibilityWhere(req);
    const requestedFactoryId = getRequestedFactoryFilter(req);

    const rawLimit = Number(req.query.limit || 3);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(20, rawLimit)) : 3;

    const where = { company_id, ...fw, is_active: true };

    if (requestedFactoryId) {
      where.OR = [
        { factory_id: requestedFactoryId },
        { fulfillments: { some: { factory_id: requestedFactoryId, is_active: true } } }
      ];
    }

    const rows = await prisma.order.findMany({
      where,
      orderBy: { order_date: "desc" },
      take: limit,
      select: {
        id: true,
        order_no: true,
        order_date: true,
        total: true,
        client: { select: { company_name: true } }
      }
    });

    const out = rows.map((o) => ({
      id: o.id,
      order_no: o.order_no,
      client_name: o.client?.company_name || null,
      total: o.total,
      order_date: o.order_date
    }));

    return res.json(out);
  } catch (err) {
    console.error("getRecentOrders error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getPendingOrders = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = orderVisibilityWhere(req);
    const requestedFactoryId = getRequestedFactoryFilter(req);

    const client_id = (req.query.client_id || "").toString().trim();
    const sales_company_id = (req.query.sales_company_id || "").toString().trim();
    const date_from = parseDateOrNull(req.query.date_from);
    const date_to = parseDateOrNull(req.query.date_to);

    const where = {
      company_id,
      is_active: true,
      status: "CONFIRMED",
      AND: [fw]
    };

    if (requestedFactoryId) {
      where.factory_id = requestedFactoryId;
    }

    if (client_id) where.client_id = client_id;
    if (sales_company_id) where.sales_company_id = sales_company_id;
    if (date_from || date_to) {
      where.order_date = {};
      if (date_from) where.order_date.gte = date_from;
      if (date_to) where.order_date.lte = date_to;
    }

    const pagination = getPagination(req, { defaultPageSize: 25, maxPageSize: 100 });
    const query = {
      where,
      orderBy: [
        { required_by: "asc" },
        { order_date: "asc" },
        { id: "asc" }
      ],
      include: {
        client: { select: { id: true, company_name: true } },
        factory: { select: { id: true, name: true } },
        sales_company: { select: { id: true, name: true } },
        _count: { select: { items: true, invoices: true } }
      }
    };

    if (pagination.enabled) {
      query.skip = pagination.skip;
      query.take = pagination.take;
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany(query),
      pagination.enabled && pagination.include_total ? prisma.order.count({ where }) : Promise.resolve(null)
    ]);

    if (!pagination.enabled) return res.json(orders);

    return res.json({
      items: orders,
      pagination: buildPaginationMeta({
        page: pagination.page,
        page_size: pagination.page_size,
        total: total ?? orders.length
      })
    });
  } catch (err) {
    console.error("getPendingOrders error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = orderVisibilityWhere(req);
    const { id } = req.params;

    const order = await prisma.order.findFirst({
      where: { id, company_id, ...fw },
      include: {
        client: true,
        factory: true,
        sales_company: true,
        items: { include: { product: { include: { category: true } } } },
        charges: true,
        fulfillments: {
          where: { is_active: true },
          include: { factory: { select: { id: true, name: true } }, product: { select: { id: true, name: true } } }
        },
        status_history: { orderBy: { created_at: "desc" } },
        invoices: { select: { id: true, invoice_no: true, kind: true, status: true, issue_date: true, total: true } }
      }
    });

    if (!order) return res.status(404).json({ message: "Order not found" });

    // Attach a payment timeline for the order.
    // We compute paid amounts from invoice allocations (source of truth) and also include
    // all payments linked to this order (if populated).
    const invoice = await prisma.invoice.findFirst({
      where: { company_id, order_id: order.id, is_active: true },
      include: {
        allocations: {
          where: { is_active: true },
          include: {
            payment: { select: { id: true, payment_no: true, method: true, paid_at: true, amount: true, status: true } }
          }
        }
      }
    });

    const allocations = (invoice?.allocations || []).filter((a) => a.payment && a.payment.status === "RECORDED");
    const timeline = allocations
      .map((a) => ({
        payment_id: a.payment.id,
        payment_no: a.payment.payment_no || null,
        method: a.payment.method,
        paid_at: a.payment.paid_at,
        payment_amount: a.payment.amount,
        allocated_amount: a.amount
      }))
      .sort((x, y) => new Date(x.paid_at).getTime() - new Date(y.paid_at).getTime());

    const orderTotal = Number(order.total);
    const paidTotal = timeline.reduce((acc, p) => acc + Number(p.allocated_amount || 0), 0);
    const remaining = Math.max(0, orderTotal - paidTotal);

    let running = 0;
    const timelineWithBalance = timeline.map((p) => {
      running += Number(p.allocated_amount || 0);
      return {
        ...p,
        running_paid: running,
        remaining_after: Math.max(0, orderTotal - running)
      };
    });

    return res.json({
      ...order,
      invoice: invoice ? { id: invoice.id, invoice_no: invoice.invoice_no, status: invoice.status, total: invoice.total } : null,
      payments_timeline: timelineWithBalance,
      payment_summary: {
        order_total: order.total,
        paid_total: paidTotal,
        remaining_total: remaining
      }
    });
  } catch (err) {
    console.error("getOrderById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// POST /orders
exports.createOrder = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const primary_factory_id = requireSingleFactory(req);

    const {
      client_id,
      sales_company_id,
      logistics,
      order_date,
      orderDate,
      required_by,
      notes,
      internal_notes,
      items,
      charges
    } = req.body;

    if (!client_id) return res.status(400).json({ message: "client_id is required" });
    if (!sales_company_id) return res.status(400).json({ message: "sales_company_id is required" });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "items array is required" });
    }

    // Validate base item fields. unit_price is optional (auto-fetched).
    for (const it of items) {
      if (!it.product_id) return res.status(400).json({ message: "Each item requires product_id" });
      const q = Number(it.quantity);
      if (!Number.isFinite(q) || q <= 0) return res.status(400).json({ message: "Item quantity must be > 0" });
      if (it.discount !== undefined && it.discount !== null && Number(it.discount) < 0) {
        return res.status(400).json({ message: "Item discount must be >= 0" });
      }

    }

    const parsedOrderDate = parseDateOrNull(order_date || orderDate);
    if ((order_date !== undefined || orderDate !== undefined) && !parsedOrderDate) {
      return res.status(400).json({ message: "Invalid order_date" });
    }
    const parsedRequiredBy = parseDateOrNull(required_by);
    if (required_by !== undefined && required_by !== null && required_by !== "" && !parsedRequiredBy) {
      return res.status(400).json({ message: "Invalid required_by" });
    }
    const od = parsedOrderDate || new Date();
    const rb = parsedRequiredBy || null;

    const created = await prisma.$transaction(async (tx) => {
      // Sales company (legal entity) must exist (added once by backend ops).
      const salesCompany = await tx.salesCompany.findFirst({
        where: { id: sales_company_id, company_id, is_active: true },
        select: { id: true }
      });
      if (!salesCompany) {
        const err = new Error("SALES_COMPANY_NOT_FOUND");
        err.statusCode = 404;
        throw err;
      }

      const client = await tx.client.findFirst({
        where: { id: client_id, company_id, is_active: true },
        select: { id: true }
      });
      if (!client) {
        const err = new Error("CLIENT_NOT_FOUND");
        err.statusCode = 404;
        throw err;
      }

      // Fetch products with pricing. unit_price is auto-fetched from:
      // 1) ClientProduct.default_price (if present)
      // 2) Product.price
      const productIds = [...new Set(items.map((i) => i.product_id))];
      const products = await tx.product.findMany({
        where: { company_id, id: { in: productIds }, is_active: true },
        select: { id: true, price: true, category_id: true }
      });
      if (products.length !== productIds.length) {
        const err = new Error("PRODUCT_NOT_FOUND");
        err.statusCode = 404;
        throw err;
      }
      const productPrice = new Map(products.map((p) => [p.id, Number(p.price || 0)]));

      const clientProductRows = await tx.clientProduct.findMany({
        where: { company_id, client_id, product_id: { in: productIds } },
        select: { product_id: true, default_price: true, is_active: true }
      });
      const clientDefaultPrice = new Map(
        clientProductRows
          .filter((r) => r.default_price !== null && r.default_price !== undefined)
          .map((r) => [r.product_id, Number(r.default_price)])
      );

      // Auto-map ordered products and categories to the client.
      const orderedCategoryIds = [...new Set(products.map((p) => p.category_id).filter(Boolean))];
      for (const pid of productIds) {
        await tx.clientProduct.upsert({
          where: { company_id_client_id_product_id: { company_id, client_id, product_id: pid } },
          create: { company_id, client_id, product_id: pid, is_active: true },
          update: { is_active: true }
        });
      }
      for (const category_id of orderedCategoryIds) {
        await tx.clientCategory.upsert({
          where: { company_id_client_id_category_id: { company_id, client_id, category_id } },
          create: { company_id, client_id, category_id, is_active: true },
          update: { is_active: true }
        });
      }

      // Dispatch allocations are no longer captured at order creation time.
      // Orders stay in CONFIRMED state first, and stock is deducted only when the
      // order is dispatched/completed later.

      // Build nested creates for items (unit_price auto-fetched if missing).
      const computedItems = items.map((it) => {
        const qty = Number(it.quantity);
        const disc = it.discount !== undefined && it.discount !== null ? Number(it.discount) : 0;

        const supplied = it.unit_price !== undefined && it.unit_price !== null && it.unit_price !== "" ? Number(it.unit_price) : null;
        const fallback = clientDefaultPrice.get(it.product_id) ?? productPrice.get(it.product_id) ?? 0;
        const price = supplied !== null && Number.isFinite(supplied) ? supplied : Number(fallback);

        if (!Number.isFinite(price) || price < 0) {
          const err = new Error("INVALID_PRICE");
          err.statusCode = 400;
          err.meta = { product_id: it.product_id, unit_price: price };
          throw err;
        }

        const line_total = calcLineTotal(qty, price, disc);

        return {
          company: { connect: { id: company_id } },
          product: { connect: { id: it.product_id } },
          quantity: qty,
          unit_price: price,
          discount: disc || null,
          line_total,
          remarks: it.remarks?.toString() || null
        };
      });

      const subtotal = computedItems.reduce((acc, it) => acc + Number(it.line_total), 0);

      const chargesArr = Array.isArray(charges) ? charges : [];
      const computedCharges = normalizeChargeInput(chargesArr).map((c) => ({
        company: { connect: { id: company_id } },
        ...c
      }));

      const total_charges = computedCharges.reduce((acc, c) => acc + Number(c.amount || 0), 0);
      const total = Number(subtotal) + Number(total_charges);

      // Create order (primary factory stays required for backward compatibility)
      const order = await tx.order.create({
        data: {
          company: { connect: { id: company_id } },
          factory: { connect: { id: primary_factory_id } },
          client: { connect: { id: client_id } },

          sales_company: { connect: { id: sales_company_id } },
          logistics: logistics !== undefined ? serializeLogisticsInput(logistics) : null,

          order_no: await makeOrderNoTx(tx, company_id, od),
          status: "CONFIRMED",
          order_date: od,
          required_by: rb,

          subtotal,
          total_charges,
          total,

          notes: notes?.toString() || null,
          internal_notes: internal_notes?.toString() || null,
          is_active: true,
          created_by: req.user.id,

          items: { create: computedItems },
          charges: { create: computedCharges },

          status_history: {
            create: {
              company: { connect: { id: company_id } },
              status: "CONFIRMED",
              note: "Order created",
              created_by: req.user.id
            }
          }
        }
      });

      // Auto-create a 1:1 invoice for this order (new invariant).
      await ensureInvoiceForOrderTx(tx, { company_id, order_id: order.id, user_id: req.user.id });

      // Return order with related data (including fulfillments) for UI consumption.
      const full = await tx.order.findFirst({
        where: { id: order.id },
        include: {
          client: { select: { id: true, company_name: true } },
          factory: { select: { id: true, name: true } },
          sales_company: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, name: true, unit: true, pack_size: true } } } },
          charges: true,
          fulfillments: {
            where: { is_active: true },
            include: { factory: { select: { id: true, name: true } }, product: { select: { id: true, name: true } } }
          }
        }
      });

      return full;
    }, ORDER_TRANSACTION_OPTIONS);

    await logActivity({
      company_id,
      factory_id: primary_factory_id,
      user_id: req.user.id,
      action: "ORDER_CREATED",
      entity_type: "order",
      entity_id: created.id,
      new_value: created
    });

    return res.status(201).json(created);
  } catch (err) {
    if (err && err.message === "SALES_COMPANY_NOT_FOUND") {
      return res.status(404).json({ message: "Sales company not found" });
    }
    if (err && err.message === "CLIENT_NOT_FOUND") {
      return res.status(404).json({ message: "Client not found" });
    }
    if (err && err.message === "PRODUCT_NOT_FOUND") {
      return res.status(404).json({ message: "One or more products not found" });
    }
    if (err && err.message === "FACTORY_NOT_FOUND") {
      return res.status(404).json({ message: "One or more factories not found" });
    }
    if (err && err.message === "UNAUTHORIZED_FACTORY_ACCESS") {
      return res.status(403).json({ message: "Unauthorized factory access", ...err.meta });
    }
    if (err && err.message === "ALLOCATIONS_MISMATCH") {
      return res.status(400).json({ message: "Allocation quantity must match item quantity", ...err.meta });
    }
    if (err && err.message === "INSUFFICIENT_STOCK") {
      return res.status(400).json({ message: "Insufficient stock for one or more items", ...err.meta });
    }
    if (err && err.message === "INVALID_PRICE") {
      return res.status(400).json({ message: "Invalid unit price", ...err.meta });
    }

    console.error("createOrder error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// PUT /orders/:id (editable)
exports.updateOrder = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const request_factory_id = requireSingleFactory(req);
    const { id } = req.params;

    const existing = await prisma.order.findFirst({
      where: { AND: [{ id, company_id, is_active: true }, orderVisibilityWhere(req)] },
      include: {
        items: true,
        charges: true,
        fulfillments: { where: { is_active: true }, select: { id: true } }
      }
    });
    if (!existing) return res.status(404).json({ message: "Order not found" });

    const body = req.body || {};
    if (body.client_id !== undefined && normalizeString(body.client_id) !== normalizeString(existing.client_id)) {
      return res.status(400).json({ message: "client_id cannot be changed for an existing order" });
    }
    if (body.items !== undefined && (!Array.isArray(body.items) || body.items.length === 0)) {
      return res.status(400).json({ message: "items array is required" });
    }
    if (body.charges !== undefined && !Array.isArray(body.charges)) {
      return res.status(400).json({ message: "charges must be an array" });
    }

    const {
      order_date,
      orderDate,
      required_by,
      notes,
      internal_notes,
      logistics,
      items,
      charges,
      factory_id,
      sales_company_id
    } = body;

    const parsedOrderDateUpdate = order_date !== undefined || orderDate !== undefined ? parseDateOrNull(order_date || orderDate) : undefined;
    if ((order_date !== undefined || orderDate !== undefined) && !parsedOrderDateUpdate) {
      return res.status(400).json({ message: "Invalid order_date" });
    }
    const parsedRequiredByUpdate = required_by !== undefined ? parseDateOrNull(required_by) : undefined;
    if (required_by !== undefined && required_by !== null && required_by !== "" && !parsedRequiredByUpdate) {
      return res.status(400).json({ message: "Invalid required_by" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const nextFactoryId = factory_id !== undefined ? normalizeString(factory_id) : existing.factory_id;
      const nextSalesCompanyId = sales_company_id !== undefined ? normalizeString(sales_company_id) : existing.sales_company_id;
      const nextOrderDate = order_date !== undefined || orderDate !== undefined ? parsedOrderDateUpdate : existing.order_date;
      const nextRequiredBy = required_by !== undefined ? (parsedRequiredByUpdate || null) : existing.required_by;

      await validateOrderEditFactoryAccessTx(tx, { company_id, user: req.user, factory_id: nextFactoryId });

      if (!nextSalesCompanyId) {
        const err = new Error("SALES_COMPANY_REQUIRED");
        err.statusCode = 400;
        throw err;
      }
      const salesCompany = await tx.salesCompany.findFirst({
        where: { id: nextSalesCompanyId, company_id, is_active: true },
        select: { id: true }
      });
      if (!salesCompany) {
        const err = new Error("SALES_COMPANY_NOT_FOUND");
        err.statusCode = 404;
        throw err;
      }

      const itemsInput = items === undefined ? existing.items : items;
      const productIds = [...new Set((itemsInput || []).map((it) => it.product_id).filter(Boolean))];
      if (productIds.length === 0) {
        const err = new Error("PRODUCT_NOT_FOUND");
        err.statusCode = 404;
        throw err;
      }

      const products = await tx.product.findMany({
        where: { company_id, id: { in: productIds }, is_active: true },
        select: { id: true, price: true, category_id: true }
      });
      if (products.length !== productIds.length) {
        const err = new Error("PRODUCT_NOT_FOUND");
        err.statusCode = 404;
        throw err;
      }
      const productPrice = new Map(products.map((p) => [p.id, Number(p.price || 0)]));
      const clientProductRows = await tx.clientProduct.findMany({
        where: { company_id, client_id: existing.client_id, product_id: { in: productIds } },
        select: { product_id: true, default_price: true }
      });
      const clientDefaultPrice = new Map(clientProductRows.filter((r) => r.default_price !== null && r.default_price !== undefined).map((r) => [r.product_id, Number(r.default_price)]));

      const computedItems = itemsInput.map((it) => {
        if (!it.product_id) {
          const err = new Error("PRODUCT_NOT_FOUND");
          err.statusCode = 404;
          throw err;
        }
        const qty = Number(it.quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
          const err = new Error("INVALID_QUANTITY");
          err.statusCode = 400;
          throw err;
        }
        const disc = it.discount !== undefined && it.discount !== null ? Number(it.discount) : 0;
        if (!Number.isFinite(disc) || disc < 0) {
          const err = new Error("INVALID_DISCOUNT");
          err.statusCode = 400;
          throw err;
        }
        const supplied = it.unit_price !== undefined && it.unit_price !== null && it.unit_price !== "" ? Number(it.unit_price) : null;
        const fallback = clientDefaultPrice.get(it.product_id) ?? productPrice.get(it.product_id) ?? 0;
        const price = supplied !== null && Number.isFinite(supplied) ? supplied : Number(fallback);
        if (!Number.isFinite(price) || price < 0) {
          const err = new Error("INVALID_PRICE");
          err.statusCode = 400;
          err.meta = { product_id: it.product_id, unit_price: price };
          throw err;
        }
        return {
          company_id,
          order_id: id,
          product_id: it.product_id,
          quantity: qty,
          unit_price: price,
          discount: disc || null,
          line_total: calcLineTotal(qty, price, disc),
          remarks: it.remarks?.toString() || null
        };
      });

      const normalizedCharges = charges === undefined
        ? existing.charges.map((c) => ({ type: c.type, title: c.title, amount: Number(c.amount || 0), meta: c.meta || null }))
        : normalizeChargeInput(charges);

      const subtotal = computedItems.reduce((acc, it) => acc + Number(it.line_total), 0);
      const total_charges = normalizedCharges.reduce((acc, c) => acc + Number(c.amount || 0), 0);
      const total = subtotal + total_charges;

      if (items !== undefined) {
        await tx.orderItem.deleteMany({ where: { company_id, order_id: id } });
        await tx.orderItem.createMany({ data: computedItems });

        const orderedCategoryIds = [...new Set(products.map((p) => p.category_id).filter(Boolean))];
        for (const pid of productIds) {
          await tx.clientProduct.upsert({
            where: { company_id_client_id_product_id: { company_id, client_id: existing.client_id, product_id: pid } },
            create: { company_id, client_id: existing.client_id, product_id: pid, is_active: true },
            update: { is_active: true }
          });
        }
        for (const categoryId of orderedCategoryIds) {
          await tx.clientCategory.upsert({
            where: { company_id_client_id_category_id: { company_id, client_id: existing.client_id, category_id: categoryId } },
            create: { company_id, client_id: existing.client_id, category_id: categoryId, is_active: true },
            update: { is_active: true }
          });
        }
      }

      if (charges !== undefined) {
        await tx.orderCharge.deleteMany({ where: { company_id, order_id: id } });
        if (normalizedCharges.length) {
          await tx.orderCharge.createMany({
            data: normalizedCharges.map((c) => ({ company_id, order_id: id, type: c.type, title: c.title, amount: c.amount, meta: c.meta }))
          });
        }
      }

      if ((items !== undefined || factory_id !== undefined) && (isDispatchTriggerStatus(existing.status) || existing.fulfillments?.length)) {
        const err = new Error("ORDER_COMMITTED_EDIT_BLOCKED");
        err.statusCode = 400;
        throw err;
      }

      await tx.order.update({
        where: { id },
        data: {
          factory_id: nextFactoryId,
          sales_company_id: nextSalesCompanyId,
          order_date: nextOrderDate,
          required_by: nextRequiredBy,
          notes: notes !== undefined ? (notes?.toString() || null) : existing.notes,
          internal_notes: internal_notes !== undefined ? (internal_notes?.toString() || null) : existing.internal_notes,
          logistics: logistics !== undefined ? serializeLogisticsInput(logistics) : existing.logistics,
          subtotal,
          total_charges,
          total
        }
      });

      await syncInvoiceFromOrderTx(tx, {
        company_id,
        order_id: id,
        user_id: req.user.id
      });

      return tx.order.findFirst({
        where: { id },
        include: {
          client: { select: { id: true, company_name: true } },
          factory: { select: { id: true, name: true } },
          sales_company: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, name: true, unit: true, pack_size: true } } } },
          charges: true,
          fulfillments: {
            where: { is_active: true },
            include: { factory: { select: { id: true, name: true } }, product: { select: { id: true, name: true } } }
          }
        }
      });
    });

    await logActivity({
      company_id,
      factory_id: request_factory_id,
      user_id: req.user.id,
      action: "ORDER_UPDATED",
      entity_type: "order",
      entity_id: id,
      old_value: existing,
      new_value: updated
    });

    return res.json(updated);
  } catch (err) {
    if (err && err.message === "SALES_COMPANY_REQUIRED") {
      return res.status(400).json({ message: "sales_company_id is required" });
    }
    if (err && err.message === "SALES_COMPANY_NOT_FOUND") {
      return res.status(404).json({ message: "Sales company not found" });
    }
    if (err && err.message === "PRODUCT_NOT_FOUND") {
      return res.status(404).json({ message: "One or more products not found" });
    }
    if (err && err.message === "FACTORY_NOT_FOUND") {
      return res.status(404).json({ message: "Factory not found" });
    }
    if (err && err.message === "UNAUTHORIZED_FACTORY_ACCESS") {
      return res.status(403).json({ message: "Unauthorized factory access", ...err.meta });
    }
    if (err && err.message === "INVALID_QUANTITY") {
      return res.status(400).json({ message: "Item quantity must be > 0" });
    }
    if (err && err.message === "INVALID_DISCOUNT") {
      return res.status(400).json({ message: "Item discount must be >= 0" });
    }
    if (err && err.message === "INVALID_PRICE") {
      return res.status(400).json({ message: "Invalid unit price", ...err.meta });
    }
    if (err && err.message === "ORDER_COMMITTED_EDIT_BLOCKED") {
      return res.status(400).json({ message: "Items or primary factory cannot be changed after order dispatch." });
    }
    if (err && err.message === "ORDER_EDIT_NOTES_CONFLICT") {
      return res.status(400).json({
        message: "Order cannot be edited because existing debit/credit notes would become inconsistent.",
        ...err.meta
      });
    }

    console.error("updateOrder error:", err);
    return res.status(err.statusCode || 500).json({ message: "Internal server error" });
  }
};

// PUT /orders/:id/status
exports.updateOrderStatus = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);
    const { id } = req.params;

    const normalizedStatus = normalizeOrderStatusInput(req.body?.status);
    const note = req.body?.note;

    if (!normalizedStatus) {
      return res.status(400).json({ message: "Invalid order status" });
    }

    if (normalizedStatus === "CANCELLED") {
      const updated = await cancelOrderAction(req, {
        orderId: id,
        note: note?.toString() || "Order cancelled via status update",
        request_factory_id: factory_id
      });
      return res.json(updated);
    }

    const existing = await prisma.order.findFirst({
      where: { AND: [{ id, company_id, is_active: true }, orderVisibilityWhere(req)] },
      include: {
        items: { select: { product_id: true, quantity: true } },
        fulfillments: { where: { is_active: true }, select: { id: true, product_id: true, factory_id: true, quantity: true, is_active: true } },
        factory: { select: { id: true } }
      }
    });
    if (!existing) return res.status(404).json({ message: "Order not found" });

    if (existing.status === "CANCELLED") {
      return res.status(400).json({ message: "Cancelled orders cannot change status" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      let statusMeta = null;
      let inventoryCommittedNow = false;
      let fulfillmentsCreatedNow = false;

      if (isDispatchTriggerStatus(normalizedStatus)) {
        const allocationRows = buildDispatchAllocationRows(existing, req.body || {}, existing.factory_id || factory_id);
        const committedMovements = await getCommittedOrderMovementsTx(tx, {
          company_id,
          order_id: existing.id,
          fulfillment_ids: (existing.fulfillments || []).map((row) => row.id)
        });

        if (!committedMovements.length) {
          await validateDispatchAllocationsTx(tx, {
            company_id,
            user: req.user,
            order: existing,
            allocationRows,
            checkStock: true
          });

          const committed = await commitOrderInventoryTx(tx, {
            company_id,
            order: existing,
            allocationRows,
            user_id: req.user.id,
            now: new Date()
          });

          inventoryCommittedNow = committed.inventory_movements_created > 0;
          fulfillmentsCreatedNow = committed.fulfillments_created > 0;
          statusMeta = {
            dispatched_now: fulfillmentsCreatedNow,
            inventory_committed_now: inventoryCommittedNow
          };
        }
      }

      const data = { status: normalizedStatus };
      if (["COMPLETED", "DELIVERED"].includes(normalizedStatus)) {
        data.delivered_at = existing.delivered_at || new Date();
      }

      const orderRecord = await tx.order.update({
        where: { id },
        data
      });

      await tx.orderStatusHistory.create({
        data: {
          company_id,
          order_id: id,
          status: normalizedStatus,
          note: note?.toString() || null,
          created_by: req.user.id,
          meta: statusMeta
        }
      });

      return { orderRecord, inventoryCommittedNow, fulfillmentsCreatedNow };
    }, ORDER_TRANSACTION_OPTIONS);

    await logActivity({
      company_id,
      factory_id,
      user_id: req.user.id,
      action: updated.inventoryCommittedNow || updated.fulfillmentsCreatedNow ? "ORDER_DISPATCHED" : "ORDER_STATUS_CHANGED",
      entity_type: "order",
      entity_id: id,
      meta: {
        from: existing.status,
        to: normalizedStatus,
        note: note || null,
        inventory_committed_now: updated.inventoryCommittedNow,
        fulfillments_created_now: updated.fulfillmentsCreatedNow
      }
    });

    return res.json(updated.orderRecord);
  } catch (err) {
    if (err && err.message === "ORDER_NOT_FOUND") {
      return res.status(404).json({ message: "Order not found" });
    }
    if (err && err.message === "ORDER_ALREADY_CANCELLED") {
      return res.status(400).json({ message: "Order already cancelled" });
    }
    if (err && err.message === "ORDER_CANCELLATION_BLOCKED") {
      return res.status(400).json({ message: "Completed/delivered/closed orders cannot be cancelled" });
    }
    if (err && err.message === "DISPATCH_ALLOCATIONS_INVALID") {
      return res.status(400).json({ message: "Invalid dispatch factory split", ...err.meta });
    }
    if (err && err.message === "FACTORY_NOT_FOUND") {
      return res.status(404).json({ message: "One or more factories not found", ...err.meta });
    }
    if (err && err.message === "PRODUCT_NOT_FOUND") {
      return res.status(404).json({ message: "One or more products not found", ...err.meta });
    }
    if (err && err.message === "UNAUTHORIZED_FACTORY_ACCESS") {
      return res.status(403).json({ message: "Unauthorized factory access", ...err.meta });
    }
    if (err && err.message === "INSUFFICIENT_STOCK") {
      return res.status(400).json({
        message: err.meta?.details || "Insufficient stock for one or more items",
        ...err.meta
      });
    }

    console.error("updateOrderStatus error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// DELETE /orders/:id (hard delete)
exports.deleteOrder = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);
    const { id } = req.params;

    const deleted = await prisma.$transaction((tx) =>
      hardDeleteOrderTx(tx, { company_id, order_id: id })
    );

    return res.json({ message: "Order deleted permanently", deleted });
  } catch (err) {
    if (err && err.message === "ORDER_NOT_FOUND") {
      return res.status(404).json({ message: "Order not found" });
    }
    console.error("deleteOrder error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

// PUT /orders/:id/cancel
// Cancels an order and reverses its inventory OUT movements by creating RETURN (IN) movements.
// Notes:
// - We do NOT hard-delete records (soft-delete philosophy). We keep the order with status CANCELLED.
// - If invoices exist and are already paid/partially paid/sent/overdue, cancellation is blocked.
exports.cancelOrder = async (req, res) => {
  try {
    const request_factory_id = requireSingleFactory(req);
    const { id } = req.params;
    const { note } = req.body || {};

    const updated = await cancelOrderAction(req, {
      orderId: id,
      note,
      request_factory_id
    });

    return res.json(updated);
  } catch (err) {
    if (err && err.message === "ORDER_NOT_FOUND") {
      return res.status(404).json({ message: "Order not found" });
    }
    if (err && err.message === "ORDER_ALREADY_CANCELLED") {
      return res.status(400).json({ message: "Order already cancelled" });
    }
    if (err && err.message === "ORDER_CANCELLATION_BLOCKED") {
      return res.status(400).json({ message: "Completed/delivered/closed orders cannot be cancelled" });
    }
    console.error("cancelOrder error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const fs = require("fs");
const { buildTempPdfPath } = require("../utils/fileStorage");
const { streamPdfAndDelete, safeUnlink } = require("../utils/pdfResponse");
const { generateOrderLabelPdfToFile } = require("../services/pdf/orderLabelPdf");
const { generateProformaInvoicePdfToFile } = require("../services/pdf/proformaInvoicePdf");
const { generateProformaPreviewPdfToFile } = require("../services/pdf/proformaInvoicePdf");
const {
  logQueued,
  sendTransactionalEmailPdf,
  sendTransactionalWhatsAppPdf
} = require("../services/messageDispatchService");

exports.getOrderLabelPdf = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = orderVisibilityWhere(req);
    const { id } = req.params;

    const order = await prisma.order.findFirst({
      where: { id, company_id, ...fw, is_active: true },
      select: { id: true, factory_id: true, updated_at: true }
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const factory_id = order.factory_id;

    const outPath = buildTempPdfPath("order-label", company_id, factory_id, id);
    await generateOrderLabelPdfToFile({ company_id, factory_id, orderId: id, outPath });

    return streamPdfAndDelete({
      res,
      filePath: outPath,
      filename: `order-label-${id}.pdf`,
      inline: true
    });
  } catch (err) {
    console.error("getOrderLabelPdf error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.getOrderProformaPdf = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = orderVisibilityWhere(req);
    const { id } = req.params;

    const order = await prisma.order.findFirst({
      where: { id, company_id, ...fw, is_active: true },
      select: { id: true, factory_id: true, updated_at: true }
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const factory_id = order.factory_id;

    const outPath = buildTempPdfPath("proforma-invoice", company_id, factory_id, id);
    await generateProformaInvoicePdfToFile({ company_id, factory_id, orderId: id, outPath });

    return streamPdfAndDelete({
      res,
      filePath: outPath,
      filename: `proforma-${id}.pdf`,
      inline: true
    });
  } catch (err) {
    console.error("getOrderProformaPdf error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};


exports.sendOrderLabel = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = orderVisibilityWhere(req);
    const { id } = req.params;

    const { channel, to_email, to_phone, subject, message } = req.body;

    if (!channel || !["EMAIL", "WHATSAPP"].includes(channel)) {
      return res.status(400).json({ message: "channel must be EMAIL or WHATSAPP" });
    }

    const sender = resolveSender(channel, getRequestedSenderKey(req.body, channel));

    const order = await prisma.order.findFirst({
      where: { id, company_id, ...fw, is_active: true },
      include: { client: true }
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const factory_id = order.factory_id;

    const outPath = buildTempPdfPath("order-label", company_id, factory_id, id);
    await generateOrderLabelPdfToFile({ company_id, factory_id, orderId: id, outPath });

    const defaultSubject = `Order Label - ${order.order_no}`;
    const defaultMsg = `Order label for ${order.client.company_name} (${order.order_no}).`;

    if (channel === "EMAIL") {
      if (!to_email) return res.status(400).json({ message: "to_email is required" });

      const log = await logQueued({
        company_id,
        channel: "EMAIL",
        to: to_email,
        created_by: req.user.id,
        factory_id,
        client_id: order.client_id,
        order_id: id,
        payload: { order_no: order.order_no, sender: sender.public }
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

    // WHATSAPP
    if (!to_phone) return res.status(400).json({ message: "to_phone is required" });

    const log = await logQueued({
      company_id,
      channel: "WHATSAPP",
      to: to_phone,
      created_by: req.user.id,
      factory_id,
      client_id: order.client_id,
      order_id: id,
      payload: { order_no: order.order_no, sender: sender.public }
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
    console.error("sendOrderLabel error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.proformaPreviewFromPayload = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);

    const payload = req.body || {};
    const { client_id, sales_company_id, items, charges, notes, order_date } = payload;

    if (!client_id) return res.status(400).json({ message: "client_id is required" });
    if (!sales_company_id) return res.status(400).json({ message: "sales_company_id is required" });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "items array is required" });
    }

    for (const it of items) {
      if (!it.product_id) return res.status(400).json({ message: "Each item requires product_id" });
      const q = Number(it.quantity);
      if (!Number.isFinite(q) || q <= 0) return res.status(400).json({ message: "Item quantity must be > 0" });
    }

    const [client, sales_company] = await Promise.all([
      prisma.client.findFirst({ where: { id: client_id, company_id, is_active: true } }),
      prisma.salesCompany.findFirst({ where: { id: sales_company_id, company_id, is_active: true } })
    ]);

    if (!client) return res.status(404).json({ message: "Client not found" });
    if (!sales_company) return res.status(404).json({ message: "Sales company not found" });

    // Resolve products (need product object for invoicePdf table)
    const productIds = [...new Set(items.map((i) => i.product_id))];

    const products = await prisma.product.findMany({
      where: { company_id, id: { in: productIds }, is_active: true },
      include: { category: true }
    });
    if (products.length !== productIds.length) {
      return res.status(404).json({ message: "One or more products not found" });
    }
    const productMap = new Map(products.map((p) => [p.id, p]));

    // ClientProduct default price (optional)
    const clientPrices = await prisma.clientProduct.findMany({
      where: { company_id, client_id, product_id: { in: productIds }, is_active: true },
      select: { product_id: true, default_price: true }
    });
    const clientPriceMap = new Map(clientPrices.map((cp) => [cp.product_id, cp.default_price]));

    const normalizedItems = items.map((it) => {
      const p = productMap.get(it.product_id);

      const qty = Number(it.quantity);
      const discount = toNumber(it.discount || 0);

      const resolvedUnitPrice =
        it.unit_price !== undefined && it.unit_price !== null && it.unit_price !== ""
          ? toNumber(it.unit_price)
          : toNumber(clientPriceMap.get(it.product_id) ?? p.price);

      const line_total = Math.max(qty * resolvedUnitPrice - discount, 0);

      return {
        quantity: qty,
        unit_price: resolvedUnitPrice,
        line_total,
        product: p
      };
    });

    const normalizedCharges = Array.isArray(charges)
      ? charges.map((c) => ({
          type: c.type || "OTHER",
          title: c.title?.toString() || "Charge",
          amount: toNumber(c.amount || 0),
          meta: c.meta || null
        }))
      : [];

    const outPath = buildTempPdfPath("proforma-preview", company_id, factory_id, "preview");
    await generateProformaPreviewPdfToFile({
      company_id,
      factory_id,
      client,
      sales_company,
      items: normalizedItems,
      charges: normalizedCharges,
      issue_date: order_date || new Date(),
      notes: notes || null,
      outPath
    });

    return streamPdfAndDelete({
      res,
      filePath: outPath,
      filename: `proforma-preview.pdf`,
      inline: true
    });
  } catch (err) {
    console.error("proformaPreviewFromPayload error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};
