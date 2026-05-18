
const prisma = require("../config/db");
const logActivity = require("../utils/activityLogger");
const { factoryWhere, requireSingleFactory } = require("../utils/factoryScope");
const { createMovementTx, updateMovementTx, applyBalanceDeltaTx, movementDelta } = require("../services/inventoryLedgerService");
const { getPagination, buildPaginationMeta } = require("../utils/pagination");
const {
  resolveDateRangeFromQuery,
  parseDateOrNull,
  normalizeFiscalYearLabel,
  getCurrentIndiaFiscalYearLabel,
  getFiscalYearLabelForMonthKey
} = require("../utils/fiscalYear");

function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s || null;
}


function getFiscalMonthBuckets(fiscalYearLabel) {
  const match = String(fiscalYearLabel || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return [];
  const startYear = Number(match[1]);
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const months = [];
  for (let offset = 0; offset < 12; offset += 1) {
    const monthIndex = (3 + offset) % 12; // Apr to Mar
    const year = monthIndex >= 3 ? startYear : startYear + 1;
    const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));
    months.push({
      key: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
      year,
      month: monthIndex + 1,
      month_name: monthNames[monthIndex],
      label: `${monthNames[monthIndex]} ${year}`,
      start,
      end
    });
  }
  return months;
}

function monthKeyFromDate(value) {
  const d = new Date(value);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}


function normalizeProductionEntries(body = {}) {
  const sharedDate = parseDateOrNull(body.date) || new Date();
  const sharedRemarks = normalizeString(body.remarks);

  if (Array.isArray(body.entries) && body.entries.length > 0) {
    return body.entries.map((entry, index) => ({
      product_id: normalizeString(entry.product_id),
      quantity: entry.quantity,
      date: parseDateOrNull(entry.date) || sharedDate,
      remarks: entry.remarks !== undefined ? normalizeString(entry.remarks) : sharedRemarks,
      row_index: index
    }));
  }

  return [{
    product_id: normalizeString(body.product_id),
    quantity: body.quantity,
    date: sharedDate,
    remarks: sharedRemarks,
    row_index: 0
  }];
}

function validateNormalizedEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    const err = new Error("Production entries are required");
    err.statusCode = 400;
    throw err;
  }

  for (const entry of entries) {
    if (!entry.product_id) {
      const err = new Error(`product_id is required for entry ${entry.row_index + 1}`);
      err.statusCode = 400;
      throw err;
    }
    const qty = Number(entry.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      const err = new Error(`quantity must be a number > 0 for entry ${entry.row_index + 1}`);
      err.statusCode = 400;
      throw err;
    }
    entry.quantity = qty;
  }

  return entries;
}

exports.createProduction = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);

    const entries = validateNormalizedEntries(normalizeProductionEntries(req.body || {}));
    const productIds = [...new Set(entries.map((entry) => entry.product_id))];

    const products = await prisma.product.findMany({
      where: { company_id, is_active: true, id: { in: productIds } },
      select: { id: true }
    });
    if (products.length !== productIds.length) {
      return res.status(404).json({ message: "One or more products were not found" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const createdEntries = [];
      for (const entry of entries) {
        const productionLog = await tx.productionLog.create({
          data: {
            company_id,
            factory_id,
            product_id: entry.product_id,
            date: entry.date,
            quantity: entry.quantity,
            remarks: entry.remarks || null,
            created_by: req.user.id
          }
        });

        const { movement } = await createMovementTx(tx, {
          company_id,
          factory_id,
          product_id: entry.product_id,
          type: "IN",
          source_type: "PRODUCTION",
          source_id: productionLog.id,
          date: entry.date,
          quantity: entry.quantity,
          remarks: entry.remarks || null,
          created_by: req.user.id
        });

        createdEntries.push({ productionLog, movement });
      }
      return createdEntries;
    });

    for (const row of result) {
      await logActivity({
        company_id,
        factory_id,
        user_id: req.user.id,
        action: "PRODUCTION_CREATED",
        entity_type: "production_log",
        entity_id: row.productionLog.id,
        meta: { inventory_movement_id: row.movement.id },
        new_value: row.productionLog
      });
    }

    if (entries.length === 1 && !(Array.isArray(req.body?.entries) && req.body.entries.length > 0)) {
      return res.status(201).json(result[0]);
    }

    return res.status(201).json({
      count: result.length,
      items: result
    });
  } catch (err) {
    console.error("createProduction error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.getProduction = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = factoryWhere(req);

    const product_id = normalizeString(req.query.product_id);
    const category_id = normalizeString(req.query.category_id);
    const { date_from, date_to, fiscal_year } = resolveDateRangeFromQuery(req.query);

    const where = { company_id, ...fw };

    if (product_id) where.product_id = product_id;

    if (date_from || date_to) {
      where.date = {};
      if (date_from) where.date.gte = date_from;
      if (date_to) where.date.lte = date_to;
    }

    if (category_id) {
      where.product = { category_id };
    }

    const pagination = getPagination(req, { defaultPageSize: 50, maxPageSize: 200 });
    const query = {
      where,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      include: {
        factory: { select: { id: true, name: true } },
        product: {
          select: {
            id: true,
            name: true,
            unit: true,
            pack_size: true,
            category: { select: { id: true, name: true } }
          }
        }
      }
    };
    if (pagination.enabled) {
      query.skip = pagination.skip;
      query.take = pagination.take;
    }

    const [logs, total] = await Promise.all([
      prisma.productionLog.findMany(query),
      pagination.enabled && pagination.include_total ? prisma.productionLog.count({ where }) : Promise.resolve(null)
    ]);

    if (!pagination.enabled) return res.json(logs);

    return res.json({
      fiscal_year,
      items: logs,
      pagination: buildPaginationMeta({ page: pagination.page, page_size: pagination.page_size, total: total ?? logs.length })
    });
  } catch (err) {
    console.error("getProduction error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getProductionSummary = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = factoryWhere(req);
    const { date_from, date_to, fiscal_year } = resolveDateRangeFromQuery(req.query);
    const product_id = normalizeString(req.query.product_id);

    const where = { company_id, ...fw };
    if (product_id) where.product_id = product_id;
    if (date_from || date_to) {
      where.date = {};
      if (date_from) where.date.gte = date_from;
      if (date_to) where.date.lte = date_to;
    }

    const logs = await prisma.productionLog.findMany({
      where,
      orderBy: [{ date: "asc" }, { created_at: "asc" }],
      include: {
        factory: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, unit: true } }
      }
    });

    const byDate = new Map();
    const byDateProduct = new Map();
    const byDateFactoryProduct = new Map();

    for (const log of logs) {
      const dateKey = new Date(log.date).toISOString().slice(0, 10);
      const qty = Number(log.quantity || 0);

      if (!byDate.has(dateKey)) {
        byDate.set(dateKey, { date: dateKey, total_quantity: 0, entry_count: 0 });
      }
      const d = byDate.get(dateKey);
      d.total_quantity += qty;
      d.entry_count += 1;

      const dpKey = `${dateKey}::${log.product_id}`;
      if (!byDateProduct.has(dpKey)) {
        byDateProduct.set(dpKey, {
          date: dateKey,
          product_id: log.product_id,
          product_name: log.product?.name || null,
          unit: log.product?.unit || null,
          total_quantity: 0,
          entry_count: 0
        });
      }
      const dp = byDateProduct.get(dpKey);
      dp.total_quantity += qty;
      dp.entry_count += 1;

      const dfpKey = `${dateKey}::${log.factory_id}::${log.product_id}`;
      if (!byDateFactoryProduct.has(dfpKey)) {
        byDateFactoryProduct.set(dfpKey, {
          date: dateKey,
          factory_id: log.factory_id,
          factory_name: log.factory?.name || null,
          product_id: log.product_id,
          product_name: log.product?.name || null,
          unit: log.product?.unit || null,
          total_quantity: 0,
          entry_count: 0
        });
      }
      const dfp = byDateFactoryProduct.get(dfpKey);
      dfp.total_quantity += qty;
      dfp.entry_count += 1;
    }

    return res.json({
      filters: {
        date_from: date_from ? date_from.toISOString() : null,
        date_to: date_to ? date_to.toISOString() : null,
        fiscal_year,
        product_id: product_id || null,
        factory_scope: req.factoryScope || null
      },
      totals_by_date: Array.from(byDate.values()),
      totals_by_date_product: Array.from(byDateProduct.values()),
      totals_by_date_factory_product: Array.from(byDateFactoryProduct.values())
    });
  } catch (err) {
    console.error("getProductionSummary error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};


exports.getProductMonthlyStats = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = factoryWhere(req);
    const { productId } = req.params;
    const rawFiscalYear = normalizeString(req.query.fiscal_year || req.query.fy || req.query.financial_year);
    const fiscal_year = rawFiscalYear ? normalizeFiscalYearLabel(rawFiscalYear) : getCurrentIndiaFiscalYearLabel();

    if (rawFiscalYear && !fiscal_year) {
      return res.status(400).json({ message: "Invalid fiscal_year" });
    }

    const product = await prisma.product.findFirst({
      where: { id: productId, company_id, is_active: true },
      select: { id: true, name: true, unit: true, pack_size: true }
    });
    if (!product) return res.status(404).json({ message: "Product not found" });

    const months = getFiscalMonthBuckets(fiscal_year);
    const date_from = months[0]?.start || null;
    const date_to = months[months.length - 1]?.end || null;
    const movements = await prisma.inventoryMovement.findMany({
      where: {
        company_id,
        ...fw,
        product_id: productId,
        ...(date_from || date_to ? {
          date: {
            ...(date_from ? { gte: date_from } : {}),
            ...(date_to ? { lte: date_to } : {})
          }
        } : {})
      },
      orderBy: [{ date: 'asc' }, { created_at: 'asc' }],
      include: { factory: { select: { id: true, name: true } } }
    });

    const monthMap = new Map(months.map((m) => [m.key, {
      month_key: m.key,
      month: m.month,
      year: m.year,
      month_name: m.month_name,
      label: m.label,
      start_date: m.start.toISOString(),
      end_date: m.end.toISOString(),
      total_quantity: 0,
      entry_count: 0,
      factories: []
    }]));

    const factoryAggByMonth = new Map();
    for (const movement of movements) {
      const key = monthKeyFromDate(movement.date);
      if (!monthMap.has(key)) continue;
      const row = monthMap.get(key);
      const qty = movementDelta(movement.type, movement.quantity);
      row.total_quantity += qty;
      row.entry_count += 1;
      const fkey = `${key}::${movement.factory_id}`;
      if (!factoryAggByMonth.has(fkey)) {
        factoryAggByMonth.set(fkey, {
          month_key: key,
          factory_id: movement.factory_id,
          factory_name: movement.factory?.name || null,
          total_quantity: 0,
          entry_count: 0
        });
      }
      const frow = factoryAggByMonth.get(fkey);
      frow.total_quantity += qty;
      frow.entry_count += 1;
    }

    for (const item of factoryAggByMonth.values()) {
      const monthRow = monthMap.get(item.month_key);
      if (monthRow) monthRow.factories.push(item);
    }

    return res.json({
      product,
      filters: {
        fiscal_year,
        date_from: date_from ? date_from.toISOString() : null,
        date_to: date_to ? date_to.toISOString() : null,
        factory_scope: req.factoryScope || null
      },
      months: months.map((m) => monthMap.get(m.key))
    });
  } catch (err) {
    console.error('getProductMonthlyStats error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getProductMonthDetail = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = factoryWhere(req);
    const { productId } = req.params;
    const monthKey = normalizeString(req.query.month_key || req.query.month);
    const rawFiscalYear = normalizeString(req.query.fiscal_year || req.query.fy || req.query.financial_year);
    const fiscal_year = rawFiscalYear
      ? normalizeFiscalYearLabel(rawFiscalYear)
      : getFiscalYearLabelForMonthKey(monthKey);

    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
      return res.status(400).json({ message: 'month_key (YYYY-MM) is required' });
    }
    if (rawFiscalYear && !fiscal_year) return res.status(400).json({ message: 'Invalid fiscal_year' });

    const product = await prisma.product.findFirst({
      where: { id: productId, company_id, is_active: true },
      select: { id: true, name: true, unit: true, pack_size: true }
    });
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const months = getFiscalMonthBuckets(fiscal_year);
    const target = months.find((m) => m.key === monthKey);
    if (!target) return res.status(400).json({ message: 'month_key is outside the requested fiscal year' });

    const movements = await prisma.inventoryMovement.findMany({
      where: {
        company_id,
        ...fw,
        product_id: productId,
        date: { gte: target.start, lte: target.end }
      },
      orderBy: [{ date: 'asc' }, { created_at: 'asc' }],
      include: { factory: { select: { id: true, name: true } } }
    });

    const byDate = new Map();
    const byDateFactory = new Map();
    for (const movement of movements) {
      const dateKey = new Date(movement.date).toISOString().slice(0, 10);
      const qty = movementDelta(movement.type, movement.quantity);
      if (!byDate.has(dateKey)) {
        byDate.set(dateKey, { date: dateKey, total_quantity: 0, entry_count: 0 });
      }
      const d = byDate.get(dateKey);
      d.total_quantity += qty;
      d.entry_count += 1;

      const key = `${dateKey}::${movement.factory_id}`;
      if (!byDateFactory.has(key)) {
        byDateFactory.set(key, {
          date: dateKey,
          factory_id: movement.factory_id,
          factory_name: movement.factory?.name || null,
          total_quantity: 0,
          entry_count: 0
        });
      }
      const df = byDateFactory.get(key);
      df.total_quantity += qty;
      df.entry_count += 1;
    }

    const normalizedEntries = movements.map((movement) => ({
      id: movement.id,
      company_id: movement.company_id,
      factory_id: movement.factory_id,
      factory: movement.factory,
      product_id: movement.product_id,
      date: movement.date,
      quantity: String(movementDelta(movement.type, movement.quantity)),
      remarks: movement.remarks,
      type: movement.type,
      source_type: movement.source_type,
      source_id: movement.source_id,
      unit_cost: movement.unit_cost,
      created_by: movement.created_by,
      created_at: movement.created_at
    }));

    return res.json({
      product,
      filters: {
        fiscal_year,
        month_key: target.key,
        month_name: target.month_name,
        year: target.year,
        month: target.month,
        start_date: target.start.toISOString(),
        end_date: target.end.toISOString(),
        factory_scope: req.factoryScope || null
      },
      summary: {
        total_quantity: normalizedEntries.reduce((acc, row) => acc + Number(row.quantity || 0), 0),
        entry_count: normalizedEntries.length
      },
      totals_by_date: Array.from(byDate.values()),
      totals_by_date_factory: Array.from(byDateFactory.values()),
      entries: normalizedEntries
    });
  } catch (err) {
    console.error('getProductMonthDetail error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateProduction = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);
    const { id } = req.params;

    const existing = await prisma.productionLog.findFirst({
      where: { id, company_id, factory_id }
    });
    if (!existing) return res.status(404).json({ message: "Production log not found" });

    const { product_id, date, quantity, remarks } = req.body;

    let nextQty = existing.quantity;
    if (quantity !== undefined && quantity !== null) {
      const q = Number(quantity);
      if (!Number.isFinite(q) || q <= 0) {
        return res.status(400).json({ message: "quantity must be a number > 0" });
      }
      nextQty = q;
    }

    let nextDate = existing.date;
    if (date !== undefined) {
      const d = parseDateOrNull(date);
      if (!d) return res.status(400).json({ message: "Invalid date format" });
      nextDate = d;
    }

    let nextProductId = existing.product_id;
    if (product_id !== undefined) {
      const product = await prisma.product.findFirst({
        where: { id: product_id, company_id, is_active: true },
        select: { id: true }
      });
      if (!product) return res.status(404).json({ message: "Product not found" });
      nextProductId = product_id;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const prod = await tx.productionLog.update({
        where: { id },
        data: {
          product_id: product_id !== undefined ? nextProductId : undefined,
          date: date !== undefined ? nextDate : undefined,
          quantity: quantity !== undefined ? nextQty : undefined,
          remarks: remarks !== undefined ? (remarks?.toString() || null) : undefined
        }
      });

      const movement = await tx.inventoryMovement.findFirst({
        where: {
          company_id,
          factory_id,
          source_type: "PRODUCTION",
          source_id: id,
          type: "IN"
        }
      });

      if (!movement) {
        await createMovementTx(tx, {
          company_id,
          factory_id,
          product_id: nextProductId,
          type: "IN",
          source_type: "PRODUCTION",
          source_id: id,
          date: nextDate,
          quantity: nextQty,
          remarks: remarks?.toString() || prod.remarks || null,
          created_by: req.user.id
        });
      } else {
        await updateMovementTx(tx, movement, {
          product_id: nextProductId,
          date: nextDate,
          quantity: nextQty,
          remarks: remarks !== undefined ? (remarks?.toString() || null) : movement.remarks
        });
      }

      return prod;
    });

    await logActivity({
      company_id,
      factory_id,
      user_id: req.user.id,
      action: "PRODUCTION_UPDATED",
      entity_type: "production_log",
      entity_id: id,
      old_value: existing,
      new_value: updated
    });

    return res.json(updated);
  } catch (err) {
    console.error("updateProduction error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.deleteProduction = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);
    const { id } = req.params;

    const existing = await prisma.productionLog.findFirst({
      where: { id, company_id, factory_id },
      include: { product: { select: { id: true, name: true } } }
    });
    if (!existing) return res.status(404).json({ message: "Production log not found" });

    const movement = await prisma.inventoryMovement.findFirst({
      where: { company_id, factory_id, source_type: "PRODUCTION", source_id: id }
    });
    if (!movement) {
      return res.status(400).json({ message: "Linked inventory movement not found for this production log" });
    }

    await prisma.$transaction(async (tx) => {
      const reverseDelta = -movementDelta(movement.type, movement.quantity);
      await applyBalanceDeltaTx(tx, {
        company_id,
        factory_id: movement.factory_id,
        product_id: movement.product_id,
        delta: reverseDelta,
        allowNegative: false
      });

      await tx.inventoryMovement.delete({ where: { id: movement.id } });
      await tx.productionLog.delete({ where: { id } });
    });

    await logActivity({
      company_id,
      factory_id,
      user_id: req.user.id,
      action: "PRODUCTION_DELETED",
      entity_type: "production_log",
      entity_id: id,
      old_value: existing,
      meta: { inventory_movement_id: movement.id }
    });

    return res.json({ message: "Production log deleted successfully" });
  } catch (err) {
    console.error("deleteProduction error:", err);
    if (err?.message === "INSUFFICIENT_STOCK") {
      return res.status(400).json({
        message: "Cannot delete this production log because its stock has already been consumed",
        meta: err.meta || null
      });
    }
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};
