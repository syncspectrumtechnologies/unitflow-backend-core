const prisma = require("../config/db");

function asNumberDecimal(v) {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function sumMovement(company_id, factory_id, whereExtra, field = "quantity") {
  const agg = await prisma.inventoryMovement.aggregate({
    where: { company_id, factory_id, ...whereExtra },
    _sum: { [field]: true }
  });
  return asNumberDecimal(agg._sum[field]);
}

function factoryWhereFromIds(factory_ids) {
  if (!Array.isArray(factory_ids) || !factory_ids.length) return {};
  return { factory_id: { in: factory_ids } };
}

function normalizeMovementTypeSums(rows) {
  let in_qty = 0;
  let out_qty = 0;
  let delete_qty = 0;
  let adjustment_qty = 0;

  for (const row of rows || []) {
    const qty = asNumberDecimal(row?._sum?.quantity);
    if (row.type === "IN") in_qty = qty;
    else if (row.type === "OUT") out_qty = qty;
    else if (row.type === "DELETE") delete_qty = qty;
    else if (row.type === "ADJUSTMENT") adjustment_qty = qty;
  }

  return { in_qty, out_qty, delete_qty, adjustment_qty };
}

async function getProductMeta(company_id, product_id) {
  return prisma.product.findFirst({
    where: { id: product_id, company_id, is_active: true },
    select: {
      id: true,
      name: true,
      unit: true,
      pack_size: true,
      category: { select: { id: true, name: true } }
    }
  });
}

async function getMovementTotals(where) {
  const grouped = await prisma.inventoryMovement.groupBy({
    by: ["type"],
    where,
    _sum: { quantity: true }
  });

  return normalizeMovementTypeSums(grouped);
}

function stockFromTotals(totals) {
  return asNumberDecimal(totals.in_qty) - asNumberDecimal(totals.out_qty) - asNumberDecimal(totals.delete_qty) + asNumberDecimal(totals.adjustment_qty);
}

function startOfDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function formatDayKey(date) {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayLabel(date) {
  return formatDayKey(date);
}

exports.getProductStock = async (company_id, factory_id, product_id) => {
  const balance = await prisma.stockBalance.findUnique({
    where: { company_id_factory_id_product_id: { company_id, factory_id, product_id } },
    select: { quantity: true }
  });
  if (balance) return asNumberDecimal(balance.quantity);

  const inSum = await sumMovement(company_id, factory_id, { product_id, type: "IN" });
  const outSum = await sumMovement(company_id, factory_id, { product_id, type: "OUT" });
  const deleteSum = await sumMovement(company_id, factory_id, { product_id, type: "DELETE" });
  const adjSum = await sumMovement(company_id, factory_id, { product_id, type: "ADJUSTMENT" });
  return inSum - outSum - deleteSum + adjSum;
};

exports.getFactoryStock = async (company_id, factory_id, { category_id, product_id } = {}) => {
  const productWhere = {
    company_id,
    is_active: true,
    ...(product_id ? { id: product_id } : {}),
    ...(category_id ? { category_id } : {})
  };

  const products = await prisma.product.findMany({
    where: productWhere,
    select: {
      id: true,
      name: true,
      unit: true,
      pack_size: true,
      category: { select: { id: true, name: true } }
    },
    orderBy: { updated_at: "desc" }
  });

  const productIds = products.map((p) => p.id);
  const balances = productIds.length
    ? await prisma.stockBalance.findMany({
        where: { company_id, factory_id, product_id: { in: productIds } },
        select: { product_id: true, quantity: true }
      })
    : [];

  const balMap = new Map(balances.map((r) => [r.product_id, asNumberDecimal(r.quantity)]));

  const rows = products.map((p) => {
    const stock_qty = balMap.get(p.id) || 0;
    return {
      product: p,
      stock_qty,
      totals: {
        in_qty: 0,
        out_qty: 0,
        delete_qty: 0,
        adjustment_qty: 0,
        stock_qty
      }
    };
  });

  return {
    company_id,
    factory_id,
    count: rows.length,
    rows
  };
};

exports.getFactoriesStock = async (company_id, factory_ids, { category_id, product_id } = {}) => {
  const productWhere = {
    company_id,
    is_active: true,
    ...(product_id ? { id: product_id } : {}),
    ...(category_id ? { category_id } : {})
  };

  const products = await prisma.product.findMany({
    where: productWhere,
    select: {
      id: true,
      name: true,
      unit: true,
      pack_size: true,
      category: { select: { id: true, name: true } }
    },
    orderBy: { updated_at: "desc" }
  });

  const productIds = products.map((p) => p.id);
  const fWhere = factoryWhereFromIds(factory_ids);

  const balances = productIds.length
    ? await prisma.stockBalance.groupBy({
        by: ["product_id"],
        where: { company_id, ...fWhere, product_id: { in: productIds } },
        _sum: { quantity: true }
      })
    : [];

  const balMap = new Map(balances.map((r) => [r.product_id, asNumberDecimal(r._sum.quantity)]));

  const rows = products.map((p) => {
    const stock_qty = balMap.get(p.id) || 0;
    return {
      product: p,
      stock_qty,
      totals: {
        in_qty: 0,
        out_qty: 0,
        delete_qty: 0,
        adjustment_qty: 0,
        stock_qty
      }
    };
  });

  return { company_id, factory_id: null, factory_ids, count: rows.length, rows };
};

exports.getFactoryStockAsOf = async (company_id, factory_id, { category_id, product_id, as_of } = {}) => {
  const dateFilter = as_of ? { lte: as_of } : undefined;
  const baseWhere = { company_id, factory_id, ...(dateFilter ? { date: dateFilter } : {}) };

  const productWhere = {
    company_id,
    is_active: true,
    ...(product_id ? { id: product_id } : {}),
    ...(category_id ? { category_id } : {})
  };

  const products = await prisma.product.findMany({
    where: productWhere,
    select: {
      id: true,
      name: true,
      unit: true,
      pack_size: true,
      category: { select: { id: true, name: true } }
    },
    orderBy: { updated_at: "desc" }
  });

  const [ins, outs, deletes, adjs] = await Promise.all([
    prisma.inventoryMovement.groupBy({
      by: ["product_id"],
      where: { ...baseWhere, type: "IN" },
      _sum: { quantity: true }
    }),
    prisma.inventoryMovement.groupBy({
      by: ["product_id"],
      where: { ...baseWhere, type: "OUT" },
      _sum: { quantity: true }
    }),
    prisma.inventoryMovement.groupBy({
      by: ["product_id"],
      where: { ...baseWhere, type: "DELETE" },
      _sum: { quantity: true }
    }),
    prisma.inventoryMovement.groupBy({
      by: ["product_id"],
      where: { ...baseWhere, type: "ADJUSTMENT" },
      _sum: { quantity: true }
    })
  ]);

  const inMap = new Map(ins.map((r) => [r.product_id, asNumberDecimal(r._sum.quantity)]));
  const outMap = new Map(outs.map((r) => [r.product_id, asNumberDecimal(r._sum.quantity)]));
  const deleteMap = new Map(deletes.map((r) => [r.product_id, asNumberDecimal(r._sum.quantity)]));
  const adjMap = new Map(adjs.map((r) => [r.product_id, asNumberDecimal(r._sum.quantity)]));

  const rows = products.map((p) => {
    const inQty = inMap.get(p.id) || 0;
    const outQty = outMap.get(p.id) || 0;
    const deleteQty = deleteMap.get(p.id) || 0;
    const adjQty = adjMap.get(p.id) || 0;
    const stock = inQty - outQty - deleteQty + adjQty;
    return {
      product: p,
      stock_qty: stock,
      totals: { in_qty: inQty, out_qty: outQty, delete_qty: deleteQty, adjustment_qty: adjQty, stock_qty: stock }
    };
  });

  return { company_id, factory_id, as_of: as_of || null, count: rows.length, rows };
};

exports.getFactoriesStockAsOf = async (company_id, factory_ids, { category_id, product_id, as_of } = {}) => {
  const dateFilter = as_of ? { lte: as_of } : undefined;
  const baseWhere = { company_id, ...factoryWhereFromIds(factory_ids), ...(dateFilter ? { date: dateFilter } : {}) };

  const productWhere = {
    company_id,
    is_active: true,
    ...(product_id ? { id: product_id } : {}),
    ...(category_id ? { category_id } : {})
  };

  const products = await prisma.product.findMany({
    where: productWhere,
    select: {
      id: true,
      name: true,
      unit: true,
      pack_size: true,
      category: { select: { id: true, name: true } }
    },
    orderBy: { updated_at: "desc" }
  });

  const [ins, outs, deletes, adjs] = await Promise.all([
    prisma.inventoryMovement.groupBy({ by: ["product_id"], where: { ...baseWhere, type: "IN" }, _sum: { quantity: true } }),
    prisma.inventoryMovement.groupBy({ by: ["product_id"], where: { ...baseWhere, type: "OUT" }, _sum: { quantity: true } }),
    prisma.inventoryMovement.groupBy({ by: ["product_id"], where: { ...baseWhere, type: "DELETE" }, _sum: { quantity: true } }),
    prisma.inventoryMovement.groupBy({ by: ["product_id"], where: { ...baseWhere, type: "ADJUSTMENT" }, _sum: { quantity: true } })
  ]);

  const inMap = new Map(ins.map((r) => [r.product_id, asNumberDecimal(r._sum.quantity)]));
  const outMap = new Map(outs.map((r) => [r.product_id, asNumberDecimal(r._sum.quantity)]));
  const deleteMap = new Map(deletes.map((r) => [r.product_id, asNumberDecimal(r._sum.quantity)]));
  const adjMap = new Map(adjs.map((r) => [r.product_id, asNumberDecimal(r._sum.quantity)]));

  const rows = products.map((p) => {
    const inQty = inMap.get(p.id) || 0;
    const outQty = outMap.get(p.id) || 0;
    const deleteQty = deleteMap.get(p.id) || 0;
    const adjQty = adjMap.get(p.id) || 0;
    const stock = inQty - outQty - deleteQty + adjQty;
    return {
      product: p,
      stock_qty: stock,
      totals: { in_qty: inQty, out_qty: outQty, delete_qty: deleteQty, adjustment_qty: adjQty, stock_qty: stock }
    };
  });

  return { company_id, factory_id: null, factory_ids, as_of: as_of || null, count: rows.length, rows };
};

exports.getFactoryStockPeriod = async (company_id, factory_id, { category_id, product_id, date_from, date_to } = {}) => {
  const from = date_from ? new Date(date_from) : null;
  const to = date_to ? new Date(date_to) : null;

  const openingAsOf = from ? new Date(from.getTime() - 1) : null;
  const [opening, closing] = await Promise.all([
    exports.getFactoryStockAsOf(company_id, factory_id, { category_id, product_id, as_of: openingAsOf }),
    exports.getFactoryStockAsOf(company_id, factory_id, { category_id, product_id, as_of: to })
  ]);

  const movementWhere = {
    company_id,
    factory_id,
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {})
  };

  const [ins, outs, deletes, adjs] = await Promise.all([
    prisma.inventoryMovement.groupBy({ by: ["product_id"], where: { ...movementWhere, type: "IN" }, _sum: { quantity: true } }),
    prisma.inventoryMovement.groupBy({ by: ["product_id"], where: { ...movementWhere, type: "OUT" }, _sum: { quantity: true } }),
    prisma.inventoryMovement.groupBy({ by: ["product_id"], where: { ...movementWhere, type: "DELETE" }, _sum: { quantity: true } }),
    prisma.inventoryMovement.groupBy({ by: ["product_id"], where: { ...movementWhere, type: "ADJUSTMENT" }, _sum: { quantity: true } })
  ]);
  const inMap = new Map(ins.map((r) => [r.product_id, asNumberDecimal(r._sum.quantity)]));
  const outMap = new Map(outs.map((r) => [r.product_id, asNumberDecimal(r._sum.quantity)]));
  const deleteMap = new Map(deletes.map((r) => [r.product_id, asNumberDecimal(r._sum.quantity)]));
  const adjMap = new Map(adjs.map((r) => [r.product_id, asNumberDecimal(r._sum.quantity)]));

  const openMap = new Map(opening.rows.map((r) => [r.product.id, r.totals.stock_qty]));
  const closeMap = new Map(closing.rows.map((r) => [r.product.id, r.totals.stock_qty]));

  const products = closing.rows.map((r) => r.product);
  const rows = products.map((p) => {
    const opening_qty = openMap.get(p.id) || 0;
    const in_qty = inMap.get(p.id) || 0;
    const out_qty = outMap.get(p.id) || 0;
    const delete_qty = deleteMap.get(p.id) || 0;
    const adjustment_qty = adjMap.get(p.id) || 0;
    const movement_qty = in_qty - out_qty - delete_qty + adjustment_qty;
    const closing_qty = closeMap.get(p.id) || 0;
    return { product: p, opening_qty, in_qty, out_qty, delete_qty, adjustment_qty, movement_qty, closing_qty, stock_qty: closing_qty };
  });

  return { company_id, factory_id, date_from: from, date_to: to, count: rows.length, rows };
};

exports.getFactoriesStockPeriod = async (company_id, factory_ids, { category_id, product_id, date_from, date_to } = {}) => {
  const from = date_from ? new Date(date_from) : null;
  const to = date_to ? new Date(date_to) : null;

  const openingAsOf = from ? new Date(from.getTime() - 1) : null;
  const [opening, closing] = await Promise.all([
    exports.getFactoriesStockAsOf(company_id, factory_ids, { category_id, product_id, as_of: openingAsOf }),
    exports.getFactoriesStockAsOf(company_id, factory_ids, { category_id, product_id, as_of: to })
  ]);

  const movementWhere = {
    company_id,
    ...factoryWhereFromIds(factory_ids),
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {})
  };

  const [ins, outs, deletes, adjs] = await Promise.all([
    prisma.inventoryMovement.groupBy({ by: ["product_id"], where: { ...movementWhere, type: "IN" }, _sum: { quantity: true } }),
    prisma.inventoryMovement.groupBy({ by: ["product_id"], where: { ...movementWhere, type: "OUT" }, _sum: { quantity: true } }),
    prisma.inventoryMovement.groupBy({ by: ["product_id"], where: { ...movementWhere, type: "DELETE" }, _sum: { quantity: true } }),
    prisma.inventoryMovement.groupBy({ by: ["product_id"], where: { ...movementWhere, type: "ADJUSTMENT" }, _sum: { quantity: true } })
  ]);

  const inMap = new Map(ins.map((r) => [r.product_id, asNumberDecimal(r._sum.quantity)]));
  const outMap = new Map(outs.map((r) => [r.product_id, asNumberDecimal(r._sum.quantity)]));
  const deleteMap = new Map(deletes.map((r) => [r.product_id, asNumberDecimal(r._sum.quantity)]));
  const adjMap = new Map(adjs.map((r) => [r.product_id, asNumberDecimal(r._sum.quantity)]));

  const openMap = new Map(opening.rows.map((r) => [r.product.id, r.totals.stock_qty]));
  const closeMap = new Map(closing.rows.map((r) => [r.product.id, r.totals.stock_qty]));

  const products = closing.rows.map((r) => r.product);
  const rows = products.map((p) => {
    const opening_qty = openMap.get(p.id) || 0;
    const in_qty = inMap.get(p.id) || 0;
    const out_qty = outMap.get(p.id) || 0;
    const delete_qty = deleteMap.get(p.id) || 0;
    const adjustment_qty = adjMap.get(p.id) || 0;
    const movement_qty = in_qty - out_qty - delete_qty + adjustment_qty;
    const closing_qty = closeMap.get(p.id) || 0;
    return { product: p, opening_qty, in_qty, out_qty, delete_qty, adjustment_qty, movement_qty, closing_qty, stock_qty: closing_qty };
  });

  return { company_id, factory_id: null, factory_ids, date_from: from, date_to: to, count: rows.length, rows };
};

exports.getFactoryProductSummary = async (company_id, factory_id, product_id, { date_from, date_to, as_of } = {}) => {
  const product = await getProductMeta(company_id, product_id);
  if (!product) return null;

  if (date_from || date_to) {
    const period = await exports.getFactoryStockPeriod(company_id, factory_id, {
      product_id,
      date_from,
      date_to
    });

    const row = period.rows[0] || {
      opening_qty: 0,
      in_qty: 0,
      out_qty: 0,
      delete_qty: 0,
      adjustment_qty: 0,
      movement_qty: 0,
      closing_qty: 0,
      stock_qty: 0
    };

    return {
      company_id,
      factory_id,
      product,
      date_from: period.date_from,
      date_to: period.date_to,
      stock_qty: row.stock_qty,
      opening_qty: row.opening_qty,
      movement_totals: {
        in_qty: row.in_qty,
        out_qty: row.out_qty,
        delete_qty: row.delete_qty,
        adjustment_qty: row.adjustment_qty
      },
      movement_qty: row.movement_qty,
      closing_qty: row.closing_qty
    };
  }

  if (as_of) {
    const totals = await getMovementTotals({
      company_id,
      factory_id,
      product_id,
      date: { lte: as_of }
    });

    const stock_qty = stockFromTotals(totals);

    return {
      company_id,
      factory_id,
      product,
      as_of,
      stock_qty,
      movement_totals: totals
    };
  }

  const [stock_qty, totals] = await Promise.all([
    exports.getProductStock(company_id, factory_id, product_id),
    getMovementTotals({ company_id, factory_id, product_id })
  ]);

  return {
    company_id,
    factory_id,
    product,
    stock_qty,
    movement_totals: totals
  };
};

exports.getFactoriesProductSummary = async (company_id, factory_ids, product_id, { date_from, date_to, as_of } = {}) => {
  const product = await getProductMeta(company_id, product_id);
  if (!product) return null;

  if (date_from || date_to) {
    const period = await exports.getFactoriesStockPeriod(company_id, factory_ids, {
      product_id,
      date_from,
      date_to
    });

    const row = period.rows[0] || {
      opening_qty: 0,
      in_qty: 0,
      out_qty: 0,
      delete_qty: 0,
      adjustment_qty: 0,
      movement_qty: 0,
      closing_qty: 0,
      stock_qty: 0
    };

    return {
      company_id,
      factory_id: null,
      factory_ids,
      product,
      date_from: period.date_from,
      date_to: period.date_to,
      stock_qty: row.stock_qty,
      opening_qty: row.opening_qty,
      movement_totals: {
        in_qty: row.in_qty,
        out_qty: row.out_qty,
        delete_qty: row.delete_qty,
        adjustment_qty: row.adjustment_qty
      },
      movement_qty: row.movement_qty,
      closing_qty: row.closing_qty
    };
  }

  if (as_of) {
    const totals = await getMovementTotals({
      company_id,
      ...factoryWhereFromIds(factory_ids),
      product_id,
      date: { lte: as_of }
    });

    const stock_qty = stockFromTotals(totals);

    return {
      company_id,
      factory_id: null,
      factory_ids,
      product,
      as_of,
      stock_qty,
      movement_totals: totals
    };
  }

  const [balanceRows, totals] = await Promise.all([
    prisma.stockBalance.groupBy({
      by: ["product_id"],
      where: {
        company_id,
        ...factoryWhereFromIds(factory_ids),
        product_id
      },
      _sum: { quantity: true }
    }),
    getMovementTotals({
      company_id,
      ...factoryWhereFromIds(factory_ids),
      product_id
    })
  ]);

  const stock_qty = balanceRows.length ? asNumberDecimal(balanceRows[0]._sum.quantity) : 0;

  return {
    company_id,
    factory_id: null,
    factory_ids,
    product,
    stock_qty,
    movement_totals: totals
  };
};

async function getProductOpeningQty(company_id, factory_id, factory_ids, product_id, rangeStart) {
  if (!rangeStart) return 0;

  const openingWhere = {
    company_id,
    product_id,
    ...(factory_id ? { factory_id } : factoryWhereFromIds(factory_ids)),
    date: { lt: startOfDay(rangeStart) }
  };
  const totals = await getMovementTotals(openingWhere);
  return stockFromTotals(totals);
}

async function getProductDailyBreakdown(company_id, { factory_id = null, factory_ids = null, product_id, date_from, date_to } = {}) {
  if (!product_id || !date_from || !date_to) {
    return {
      company_id,
      factory_id: factory_id || null,
      factory_ids: Array.isArray(factory_ids) ? factory_ids : null,
      product: null,
      date_from: date_from || null,
      date_to: date_to || null,
      opening_qty: 0,
      count: 0,
      rows: []
    };
  }

  const product = await getProductMeta(company_id, product_id);
  if (!product) return null;

  const rangeStart = startOfDay(date_from);
  const rangeEnd = endOfDay(date_to);
  const opening_qty = await getProductOpeningQty(company_id, factory_id, factory_ids, product_id, rangeStart);

  const rows = await prisma.inventoryMovement.findMany({
    where: {
      company_id,
      product_id,
      ...(factory_id ? { factory_id } : factoryWhereFromIds(factory_ids)),
      date: {
        gte: rangeStart,
        lte: rangeEnd
      }
    },
    select: {
      id: true,
      date: true,
      type: true,
      quantity: true
    },
    orderBy: [{ date: "asc" }, { id: "asc" }]
  });

  const byDay = new Map();
  for (const movement of rows) {
    const key = formatDayKey(movement.date);
    const current = byDay.get(key) || {
      date: key,
      in_qty: 0,
      out_qty: 0,
      delete_qty: 0,
      adjustment_qty: 0
    };
    const qty = asNumberDecimal(movement.quantity);
    if (movement.type === "IN") current.in_qty += qty;
    if (movement.type === "OUT") current.out_qty += qty;
    if (movement.type === "DELETE") current.delete_qty += qty;
    if (movement.type === "ADJUSTMENT") current.adjustment_qty += qty;
    byDay.set(key, current);
  }

  const dailyRows = [];
  let runningStock = opening_qty;
  for (let cursor = new Date(rangeStart); cursor.getTime() <= rangeEnd.getTime(); cursor = addDays(cursor, 1)) {
    const key = formatDayKey(cursor);
    const movement = byDay.get(key) || {
      date: key,
      in_qty: 0,
      out_qty: 0,
      delete_qty: 0,
      adjustment_qty: 0
    };
    const opening_day_qty = runningStock;
    const net_movement = movement.in_qty - movement.out_qty - movement.delete_qty + movement.adjustment_qty;
    runningStock = opening_day_qty + net_movement;

    dailyRows.push({
      date: key,
      label: dayLabel(cursor),
      opening_qty: opening_day_qty,
      in_qty: movement.in_qty,
      out_qty: movement.out_qty,
      delete_qty: movement.delete_qty,
      adjustment_qty: movement.adjustment_qty,
      net_movement,
      closing_qty: runningStock
    });
  }

  return {
    company_id,
    factory_id: factory_id || null,
    factory_ids: Array.isArray(factory_ids) ? factory_ids : null,
    product,
    date_from: rangeStart,
    date_to: rangeEnd,
    opening_qty,
    count: dailyRows.length,
    rows: dailyRows
  };
}

exports.getFactoryProductDailyBreakdown = async (company_id, factory_id, product_id, { date_from, date_to } = {}) => {
  return getProductDailyBreakdown(company_id, { factory_id, product_id, date_from, date_to });
};

exports.getFactoriesProductDailyBreakdown = async (company_id, factory_ids, product_id, { date_from, date_to } = {}) => {
  return getProductDailyBreakdown(company_id, { factory_ids, product_id, date_from, date_to });
};
