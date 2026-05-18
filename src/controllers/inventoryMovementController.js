const prisma = require("../config/db");
const logActivity = require("../utils/activityLogger");
const stockService = require("../services/stockService");
const { createMovementTx } = require("../services/inventoryLedgerService");
const { getPagination, buildPaginationMeta } = require("../utils/pagination");
const { factoryWhere, requireSingleFactory } = require("../utils/factoryScope");
const { buildTempPdfPath } = require("../utils/fileStorage");
const { streamPdfAndDelete } = require("../utils/pdfResponse");
const { generateStockSummaryPdfToFile, generateProductInventoryMonthlyPdfToFile } = require("../services/pdf/stockPdf");
const { parseDateOrNull, resolveDateRangeFromQuery, getCurrentIndiaFiscalYearBoundaryDate, getCalendarMonthRange } = require("../utils/fiscalYear");

function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s || null;
}

function validateQtyPositive(quantity) {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0) return null;
  return q;
}

function parseBoolean(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function parseQueryDateBoundary(value, endOfDay = false) {
  const raw = normalizeString(value);
  if (!raw) return null;

  const calendarMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (calendarMatch) {
    const year = Number(calendarMatch[1]);
    const month = Number(calendarMatch[2]);
    const day = Number(calendarMatch[3]);
    return endOfDay
      ? new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
      : new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  }

  const parsed = parseDateOrNull(raw);
  if (!parsed) return null;
  const d = new Date(parsed);
  if (endOfDay) d.setUTCHours(23, 59, 59, 999);
  else d.setUTCHours(0, 0, 0, 0);
  return d;
}

function resolveStockWindow(query = {}) {
  const explicitFrom = parseQueryDateBoundary(query.date_from, false);
  const explicitTo = parseQueryDateBoundary(query.date_to, true);
  const month_key = normalizeString(query.month_key);

  if (explicitFrom || explicitTo) {
    return {
      date_from: explicitFrom,
      date_to: explicitTo,
      fiscal_year: null,
      source: "EXPLICIT_RANGE",
      month_key: null
    };
  }

  const resolved = resolveDateRangeFromQuery(query);
  if (resolved.date_from || resolved.date_to || resolved.fiscal_year) {
    return { ...resolved, month_key: null };
  }

  if (month_key) {
    const month = getCalendarMonthRange(month_key);
    if (!month) {
      const err = new Error("INVALID_MONTH_KEY");
      err.statusCode = 400;
      throw err;
    }
    return {
      date_from: month.start,
      date_to: month.end,
      fiscal_year: null,
      source: "MONTH_KEY",
      month_key: month.month_key
    };
  }

  return { ...resolved, month_key: null };
}

function resolveDailyBreakdownWindow(window) {
  if (window?.month_key) {
    return { date_from: window.date_from, date_to: window.date_to };
  }
  if (window?.date_from && window?.date_to) {
    return { date_from: window.date_from, date_to: window.date_to };
  }
  return null;
}

function currentMonthWindow() {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return getCalendarMonthRange(monthKey);
}

function buildFilterLines({ report = null, product = null, category_id = null, product_id = null, as_of = null, window = {} } = {}) {
  const lines = [];
  if (window?.month_key) {
    lines.push(`Month: ${window.month_key}`);
  } else if (window?.date_from || window?.date_to) {
    lines.push(`Date Range: ${window.date_from ? new Date(window.date_from).toLocaleDateString() : "Start"} to ${window.date_to ? new Date(window.date_to).toLocaleDateString() : "Today"}`);
  } else if (window?.fiscal_year) {
    lines.push(`Fiscal Year: ${window.fiscal_year}`);
  }

  if (as_of) {
    lines.push(`As Of: ${new Date(as_of).toLocaleDateString()}`);
  }

  const derivedProductName = product?.name || report?.rows?.[0]?.product?.name || null;
  if (derivedProductName) {
    lines.push(`Product: ${derivedProductName}`);
  } else if (product_id) {
    lines.push(`Product ID: ${product_id}`);
  }

  const derivedCategoryName = product?.category?.name || report?.rows?.[0]?.product?.category?.name || null;
  if (derivedCategoryName) {
    lines.push(`Category: ${derivedCategoryName}`);
  } else if (category_id) {
    lines.push(`Category ID: ${category_id}`);
  }

  return lines;
}

async function resolveFactoryLabel(company_id, factory_id, factory_ids = []) {
  if (factory_id) {
    const factory = await prisma.factory.findFirst({
      where: { id: factory_id, company_id },
      select: { name: true }
    });
    return factory?.name || factory_id;
  }

  if (Array.isArray(factory_ids) && factory_ids.length) {
    const factories = await prisma.factory.findMany({
      where: { company_id, id: { in: factory_ids } },
      select: { name: true },
      orderBy: { name: "asc" }
    });
    if (!factories.length) return "All Accessible Factories";
    if (factories.length === 1) return factories[0].name;
    return `${factories.length} factories`;
  }

  return "All Factories";
}

async function fetchCompanyName(company_id) {
  const company = await prisma.company.findUnique({
    where: { id: company_id },
    select: { name: true }
  });
  return company?.name || "Company";
}

async function ensureProductsExist(company_id, productIds) {
  const ids = [...new Set((productIds || []).filter(Boolean))];
  if (!ids.length) return;
  const products = await prisma.product.findMany({
    where: { company_id, is_active: true, id: { in: ids } },
    select: { id: true }
  });
  if (products.length !== ids.length) {
    const err = new Error("One or more products were not found");
    err.statusCode = 404;
    throw err;
  }
}

function buildStockDeletionEntries(body) {
  const sharedDate = parseDateOrNull(body.date) || new Date();
  const sharedRemarks = normalizeString(body.remarks);

  if (Array.isArray(body.entries) && body.entries.length > 0) {
    return body.entries.map((entry, index) => ({
      row_index: index,
      product_id: normalizeString(entry.product_id),
      quantity: entry.quantity,
      date: parseDateOrNull(entry.date) || sharedDate,
      remarks: entry.remarks !== undefined ? normalizeString(entry.remarks) : sharedRemarks
    }));
  }

  return [{
    row_index: 0,
    product_id: normalizeString(body.product_id),
    quantity: body.quantity,
    date: sharedDate,
    remarks: sharedRemarks
  }];
}

async function createDeleteMovements(req, res, entries, factory_id, company_id) {
  await ensureProductsExist(company_id, entries.map((entry) => entry.product_id));

  let createdEntries;
  try {
    createdEntries = await prisma.$transaction(async (tx) => {
      const rows = [];
      for (const entry of entries) {
        const { movement } = await createMovementTx(tx, {
          company_id,
          factory_id,
          product_id: entry.product_id,
          type: "DELETE",
          source_type: "MANUAL",
          source_id: null,
          date: entry.date,
          quantity: entry.quantity,
          remarks: entry.remarks || "Manual stock delete",
          created_by: req.user.id
        });
        rows.push(movement);
      }
      return rows;
    });
  } catch (err) {
    if (err?.message === "INSUFFICIENT_STOCK") {
      return res.status(400).json({ message: "Insufficient stock", ...err.meta });
    }
    throw err;
  }

  for (const movement of createdEntries) {
    await logActivity({
      company_id,
      factory_id,
      user_id: req.user.id,
      action: "INVENTORY_DELETE_CREATED",
      entity_type: "inventory_movement",
      entity_id: movement.id,
      new_value: movement
    });
  }

  if (createdEntries.length === 1 && !(Array.isArray(req.body.entries) && req.body.entries.length > 0)) {
    return res.status(201).json(createdEntries[0]);
  }

  return res.status(201).json({
    count: createdEntries.length,
    items: createdEntries
  });
}

exports.createIn = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);

    const { product_id, quantity, date, remarks, unit_cost } = req.body;

    if (!product_id) return res.status(400).json({ message: "product_id is required" });

    const qty = validateQtyPositive(quantity);
    if (!qty) return res.status(400).json({ message: "quantity must be a number > 0" });

    const movementDate = parseDateOrNull(date) || new Date();

    const product = await prisma.product.findFirst({
      where: { id: product_id, company_id, is_active: true },
      select: { id: true }
    });
    if (!product) return res.status(404).json({ message: "Product not found" });

    const { movement } = await prisma.$transaction((tx) => createMovementTx(tx, {
      company_id,
      factory_id,
      product_id,
      type: "IN",
      source_type: "MANUAL",
      source_id: null,
      date: movementDate,
      quantity: qty,
      unit_cost: unit_cost !== undefined && unit_cost !== null ? unit_cost : null,
      remarks: remarks?.toString() || null,
      created_by: req.user.id
    }));

    await logActivity({
      company_id,
      factory_id,
      user_id: req.user.id,
      action: "INVENTORY_IN_CREATED",
      entity_type: "inventory_movement",
      entity_id: movement.id,
      new_value: movement
    });

    return res.status(201).json(movement);
  } catch (err) {
    console.error("createIn error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.createOut = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);

    const { product_id, quantity, date, remarks } = req.body;

    if (!product_id) return res.status(400).json({ message: "product_id is required" });

    const qty = validateQtyPositive(quantity);
    if (!qty) return res.status(400).json({ message: "quantity must be a number > 0" });

    const movementDate = parseDateOrNull(date) || new Date();

    const product = await prisma.product.findFirst({
      where: { id: product_id, company_id, is_active: true },
      select: { id: true }
    });
    if (!product) return res.status(404).json({ message: "Product not found" });

    let movement;
    try {
      ({ movement } = await prisma.$transaction((tx) => createMovementTx(tx, {
        company_id,
        factory_id,
        product_id,
        type: "OUT",
        source_type: "MANUAL",
        source_id: null,
        date: movementDate,
        quantity: qty,
        remarks: remarks?.toString() || null,
        created_by: req.user.id
      })));
    } catch (err) {
      if (err?.message === "INSUFFICIENT_STOCK") {
        return res.status(400).json({ message: "Insufficient stock", ...err.meta });
      }
      throw err;
    }

    await logActivity({
      company_id,
      factory_id,
      user_id: req.user.id,
      action: "INVENTORY_OUT_CREATED",
      entity_type: "inventory_movement",
      entity_id: movement.id,
      new_value: movement
    });

    return res.status(201).json(movement);
  } catch (err) {
    console.error("createOut error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.createDelete = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);
    const entries = buildStockDeletionEntries(req.body || {});

    if (!entries.length) return res.status(400).json({ message: "Stock delete entries are required" });

    for (const entry of entries) {
      if (!entry.product_id) {
        return res.status(400).json({ message: `product_id is required for entry ${entry.row_index + 1}` });
      }
      const qty = validateQtyPositive(entry.quantity);
      if (!qty) {
        return res.status(400).json({ message: `quantity must be a number > 0 for entry ${entry.row_index + 1}` });
      }
      entry.quantity = qty;
    }

    return await createDeleteMovements(req, res, entries, factory_id, company_id);
  } catch (err) {
    console.error("createDelete error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.createAdjustment = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);

    const { product_id, quantity, date, remarks } = req.body;

    if (!product_id) return res.status(400).json({ message: "product_id is required" });

    const q = Number(quantity);
    if (!Number.isFinite(q) || q === 0) {
      return res.status(400).json({ message: "quantity must be a non-zero number (can be negative)" });
    }

    const movementDate = parseDateOrNull(date) || new Date();

    const product = await prisma.product.findFirst({
      where: { id: product_id, company_id, is_active: true },
      select: { id: true }
    });
    if (!product) return res.status(404).json({ message: "Product not found" });

    let movement;
    try {
      ({ movement } = await prisma.$transaction((tx) => createMovementTx(tx, {
        company_id,
        factory_id,
        product_id,
        type: "ADJUSTMENT",
        source_type: "MANUAL",
        source_id: null,
        date: movementDate,
        quantity: q,
        remarks: remarks?.toString() || null,
        created_by: req.user.id
      }, { allowNegativeAdjustment: true })));
    } catch (err) {
      if (err?.message === "INSUFFICIENT_STOCK") {
        return res.status(400).json({ message: "Insufficient stock", ...err.meta });
      }
      throw err;
    }

    await logActivity({
      company_id,
      factory_id,
      user_id: req.user.id,
      action: "INVENTORY_ADJUSTMENT_CREATED",
      entity_type: "inventory_movement",
      entity_id: movement.id,
      new_value: movement
    });

    return res.status(201).json(movement);
  } catch (err) {
    console.error("createAdjustment error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.createOpeningStock = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = requireSingleFactory(req);
    const body = req.body || {};
    const sharedDate = parseDateOrNull(body.date) || getCurrentIndiaFiscalYearBoundaryDate();
    const sharedRemarks = normalizeString(body.remarks);

    let entries = [];
    if (Array.isArray(body.entries) && body.entries.length > 0) {
      entries = body.entries.map((entry, index) => ({
        row_index: index,
        product_id: normalizeString(entry.product_id),
        quantity: entry.quantity,
        date: parseDateOrNull(entry.date) || sharedDate,
        remarks: entry.remarks !== undefined ? normalizeString(entry.remarks) : sharedRemarks,
        unit_cost: entry.unit_cost !== undefined && entry.unit_cost !== null ? Number(entry.unit_cost) : null
      }));
    } else {
      entries = [{
        row_index: 0,
        product_id: normalizeString(body.product_id),
        quantity: body.quantity,
        date: sharedDate,
        remarks: sharedRemarks,
        unit_cost: body.unit_cost !== undefined && body.unit_cost !== null ? Number(body.unit_cost) : null
      }];
    }

    if (!entries.length) return res.status(400).json({ message: "Opening stock entries are required" });

    for (const entry of entries) {
      if (!entry.product_id) {
        return res.status(400).json({ message: `product_id is required for entry ${entry.row_index + 1}` });
      }
      const qty = validateQtyPositive(entry.quantity);
      if (!qty) {
        return res.status(400).json({ message: `quantity must be a number > 0 for entry ${entry.row_index + 1}` });
      }
      entry.quantity = qty;
    }

    await ensureProductsExist(company_id, entries.map((entry) => entry.product_id));

    const createdEntries = await prisma.$transaction(async (tx) => {
      const rows = [];
      for (const entry of entries) {
        const { movement } = await createMovementTx(tx, {
          company_id,
          factory_id,
          product_id: entry.product_id,
          type: "IN",
          source_type: "OPENING",
          source_id: null,
          date: entry.date,
          quantity: entry.quantity,
          unit_cost: entry.unit_cost,
          remarks: entry.remarks || "Opening stock",
          created_by: req.user.id
        });
        rows.push(movement);
      }
      return rows;
    });

    for (const movement of createdEntries) {
      await logActivity({
        company_id,
        factory_id,
        user_id: req.user.id,
        action: "OPENING_STOCK_CREATED",
        entity_type: "inventory_movement",
        entity_id: movement.id,
        new_value: movement
      });
    }

    if (createdEntries.length === 1 && !(Array.isArray(body.entries) && body.entries.length > 0)) {
      return res.status(201).json(createdEntries[0]);
    }

    return res.status(201).json({
      count: createdEntries.length,
      items: createdEntries
    });
  } catch (err) {
    console.error("createOpeningStock error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.getMovements = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = factoryWhere(req);

    const product_id = normalizeString(req.query.product_id);
    const type = normalizeString(req.query.type);
    const source_type = normalizeString(req.query.source_type);
    const { date_from, date_to, fiscal_year, month_key } = resolveStockWindow(req.query);

    const where = { company_id, ...fw };

    if (product_id) where.product_id = product_id;
    if (type) where.type = type;
    if (source_type) where.source_type = source_type;

    if (date_from || date_to) {
      where.date = {};
      if (date_from) where.date.gte = date_from;
      if (date_to) where.date.lte = date_to;
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

    const [rows, total] = await Promise.all([
      prisma.inventoryMovement.findMany(query),
      pagination.enabled && pagination.include_total ? prisma.inventoryMovement.count({ where }) : Promise.resolve(null)
    ]);

    if (!pagination.enabled) return res.json(rows);

    return res.json({
      fiscal_year,
      month_key,
      items: rows,
      pagination: buildPaginationMeta({ page: pagination.page, page_size: pagination.page_size, total: total ?? rows.length })
    });
  } catch (err) {
    if (err.message === "INVALID_MONTH_KEY") {
      return res.status(400).json({ message: "month_key must be in YYYY-MM format" });
    }
    console.error("getMovements error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getStockSummary = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = req.factory_id;

    const product_id = normalizeString(req.query.product_id);
    const window = resolveStockWindow(req.query);
    const { date_from, date_to, fiscal_year, month_key } = window;
    const as_of = parseDateOrNull(req.query.as_of);

    if (!product_id) {
      return res.status(400).json({ message: "product_id is required" });
    }

    if ((date_from || date_to || month_key) && as_of) {
      return res.status(400).json({ message: "Use either date filters or as_of, not both" });
    }

    let summary;
    if (!factory_id && Array.isArray(req.factory_ids) && req.factory_ids.length) {
      summary = await stockService.getFactoriesProductSummary(company_id, req.factory_ids, product_id, {
        date_from,
        date_to,
        as_of
      });
    } else {
      summary = await stockService.getFactoryProductSummary(company_id, factory_id, product_id, {
        date_from,
        date_to,
        as_of
      });
    }

    if (!summary) return res.status(404).json({ message: "Product not found" });

    let daily_breakdown = null;
    const dailyWindow = resolveDailyBreakdownWindow(window);
    if (dailyWindow) {
      daily_breakdown = !factory_id && Array.isArray(req.factory_ids) && req.factory_ids.length
        ? await stockService.getFactoriesProductDailyBreakdown(company_id, req.factory_ids, product_id, dailyWindow)
        : await stockService.getFactoryProductDailyBreakdown(company_id, factory_id, product_id, dailyWindow);
    }

    return res.json({ fiscal_year, month_key, ...summary, daily_breakdown });
  } catch (err) {
    if (err.message === "INVALID_MONTH_KEY") {
      return res.status(400).json({ message: "month_key must be in YYYY-MM format" });
    }
    console.error("getStockSummary error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getStock = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = req.factory_id;

    const category_id = normalizeString(req.query.category_id);
    const product_id = normalizeString(req.query.product_id);
    const include_totals = parseBoolean(req.query.include_totals);
    const as_of = parseDateOrNull(req.query.as_of);
    const window = resolveStockWindow(req.query);
    const { date_from, date_to, fiscal_year, month_key } = window;

    if ((date_from || date_to || month_key) && as_of) {
      return res.status(400).json({ message: "Use either date filters or as_of, not both" });
    }

    if (include_totals) {
      if (!product_id) {
        return res.status(400).json({
          message: "product_id is required when include_totals=true. Use /inventory/stock for list view and /inventory/stock-summary for product summary."
        });
      }

      let summary;
      if (!factory_id && Array.isArray(req.factory_ids) && req.factory_ids.length) {
        summary = await stockService.getFactoriesProductSummary(company_id, req.factory_ids, product_id, {
          date_from,
          date_to,
          as_of
        });
      } else {
        summary = await stockService.getFactoryProductSummary(company_id, factory_id, product_id, {
          date_from,
          date_to,
          as_of
        });
      }
      if (!summary) return res.status(404).json({ message: "Product not found" });
      return res.json({ fiscal_year, month_key, ...summary });
    }

    let report;
    if (!factory_id && Array.isArray(req.factory_ids) && req.factory_ids.length) {
      const factory_ids = req.factory_ids;
      if (date_from || date_to) {
        report = await stockService.getFactoriesStockPeriod(company_id, factory_ids, {
          category_id: category_id || undefined,
          product_id: product_id || undefined,
          date_from,
          date_to
        });
      } else if (as_of) {
        report = await stockService.getFactoriesStockAsOf(company_id, factory_ids, {
          category_id: category_id || undefined,
          product_id: product_id || undefined,
          as_of
        });
      } else {
        report = await stockService.getFactoriesStock(company_id, factory_ids, {
          category_id,
          product_id
        });
      }
    } else if (date_from || date_to) {
      report = await stockService.getFactoryStockPeriod(company_id, factory_id, {
        category_id: category_id || undefined,
        product_id: product_id || undefined,
        date_from,
        date_to
      });
    } else if (as_of) {
      report = await stockService.getFactoryStockAsOf(company_id, factory_id, {
        category_id: category_id || undefined,
        product_id: product_id || undefined,
        as_of
      });
    } else {
      report = await stockService.getFactoryStock(company_id, factory_id, {
        category_id,
        product_id
      });
    }

    return res.json({ fiscal_year, month_key, ...report });
  } catch (err) {
    if (err.message === "INVALID_MONTH_KEY") {
      return res.status(400).json({ message: "month_key must be in YYYY-MM format" });
    }
    console.error("getStock error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getStockSummaryPdf = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = req.factory_id;
    const factory_ids = req.factory_ids;

    const category_id = normalizeString(req.query.category_id);
    const product_id = normalizeString(req.query.product_id);
    const as_of = parseDateOrNull(req.query.as_of);
    const window = resolveStockWindow(req.query);
    const { date_from, date_to, month_key } = window;

    if ((date_from || date_to || month_key) && as_of) {
      return res.status(400).json({ message: "Use either date filters or as_of, not both" });
    }

    let report;
    if (!factory_id && Array.isArray(factory_ids) && factory_ids.length) {
      if (date_from || date_to) {
        report = await stockService.getFactoriesStockPeriod(company_id, factory_ids, {
          category_id: category_id || undefined,
          product_id: product_id || undefined,
          date_from,
          date_to
        });
      } else if (as_of) {
        report = await stockService.getFactoriesStockAsOf(company_id, factory_ids, {
          category_id: category_id || undefined,
          product_id: product_id || undefined,
          as_of
        });
      } else {
        report = await stockService.getFactoriesStock(company_id, factory_ids, {
          category_id,
          product_id
        });
      }
    } else if (date_from || date_to) {
      report = await stockService.getFactoryStockPeriod(company_id, factory_id, {
        category_id: category_id || undefined,
        product_id: product_id || undefined,
        date_from,
        date_to
      });
    } else if (as_of) {
      report = await stockService.getFactoryStockAsOf(company_id, factory_id, {
        category_id: category_id || undefined,
        product_id: product_id || undefined,
        as_of
      });
    } else {
      report = await stockService.getFactoryStock(company_id, factory_id, {
        category_id,
        product_id
      });
    }

    const [company_name, factory_label] = await Promise.all([
      fetchCompanyName(company_id),
      resolveFactoryLabel(company_id, factory_id, factory_ids)
    ]);

    const outPath = buildTempPdfPath("stock-summary", company_id, factory_id || "all", product_id || "all");
    await generateStockSummaryPdfToFile({
      company_name,
      factory_label,
      report,
      filter_lines: buildFilterLines({ report, category_id, product_id, as_of, window }),
      outPath
    });

    return streamPdfAndDelete({
      res,
      filePath: outPath,
      filename: `stock-summary-${product_id || "all"}.pdf`,
      inline: true
    });
  } catch (err) {
    if (err.message === "INVALID_MONTH_KEY") {
      return res.status(400).json({ message: "month_key must be in YYYY-MM format" });
    }
    console.error("getStockSummaryPdf error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.getProductInventoryMonthlyPdf = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id = req.factory_id;
    const factory_ids = req.factory_ids;
    const product_id = normalizeString(req.params.productId || req.query.product_id);

    if (!product_id) {
      return res.status(400).json({ message: "product_id is required" });
    }

    const window = resolveStockWindow(req.query);
    const monthWindow = window.date_from && window.date_to
      ? window
      : (() => {
          const currentMonth = currentMonthWindow();
          return {
            date_from: currentMonth.start,
            date_to: currentMonth.end,
            fiscal_year: null,
            source: "DEFAULT_MONTH",
            month_key: currentMonth.month_key
          };
        })();

    const summary = !factory_id && Array.isArray(factory_ids) && factory_ids.length
      ? await stockService.getFactoriesProductSummary(company_id, factory_ids, product_id, {
          date_from: monthWindow.date_from,
          date_to: monthWindow.date_to
        })
      : await stockService.getFactoryProductSummary(company_id, factory_id, product_id, {
          date_from: monthWindow.date_from,
          date_to: monthWindow.date_to
        });

    if (!summary) return res.status(404).json({ message: "Product not found" });

    const daily_breakdown = !factory_id && Array.isArray(factory_ids) && factory_ids.length
      ? await stockService.getFactoriesProductDailyBreakdown(company_id, factory_ids, product_id, {
          date_from: monthWindow.date_from,
          date_to: monthWindow.date_to
        })
      : await stockService.getFactoryProductDailyBreakdown(company_id, factory_id, product_id, {
          date_from: monthWindow.date_from,
          date_to: monthWindow.date_to
        });

    const [company_name, factory_label] = await Promise.all([
      fetchCompanyName(company_id),
      resolveFactoryLabel(company_id, factory_id, factory_ids)
    ]);

    const outPath = buildTempPdfPath("product-inventory-monthly", company_id, factory_id || "all", product_id);
    await generateProductInventoryMonthlyPdfToFile({
      company_name,
      factory_label,
      summary,
      daily_breakdown,
      filter_lines: buildFilterLines({ product: summary.product, product_id, window: monthWindow }),
      outPath
    });

    return streamPdfAndDelete({
      res,
      filePath: outPath,
      filename: `product-inventory-${product_id}-${monthWindow.month_key || "summary"}.pdf`,
      inline: true
    });
  } catch (err) {
    if (err.message === "INVALID_MONTH_KEY") {
      return res.status(400).json({ message: "month_key must be in YYYY-MM format" });
    }
    console.error("getProductInventoryMonthlyPdf error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};
