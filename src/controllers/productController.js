const prisma = require("../config/db");
const logActivity = require("../utils/activityLogger");
const { getPagination, buildPaginationMeta } = require("../utils/pagination");

// Helpers
function toStrOrNull(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function toPriceOrUndefined(v) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return NaN;
  return n;
}

const IMPORT_ROW_LIMIT = 500;
const IMPORT_TEXT_LIMIT = 1_000_000;
const HEADER_ALIASES = {
  product_name: "name",
  item_name: "name",
  category: "category_name",
  category_id: "category_id",
  uom: "unit",
  selling_price: "price",
  mrp: "price",
  pack: "pack_size",
  packsize: "pack_size",
  active: "is_active"
};

function normalizeHeader(value) {
  const key = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return HEADER_ALIASES[key] || key;
}

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell);
      if (row.some((item) => String(item || "").trim() !== "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  row.push(cell);
  if (row.some((item) => String(item || "").trim() !== "")) rows.push(row);
  if (quoted) {
    const err = new Error("CSV has an unclosed quoted cell");
    err.statusCode = 400;
    throw err;
  }
  return rows;
}

function csvRowsToObjects(csvText) {
  const rows = parseCsvText(csvText);
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((cells, index) => {
    const item = { row_number: index + 2 };
    headers.forEach((header, cellIndex) => {
      if (header) item[header] = String(cells[cellIndex] || "").trim();
    });
    return item;
  });
}

function productImportKey(name, packSize) {
  return `${String(name || "").trim().toLowerCase()}::${String(packSize || "").trim().toLowerCase()}`;
}

function parseOptionalBoolean(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return undefined;
  if (["true", "yes", "y", "1", "active"].includes(text)) return true;
  if (["false", "no", "n", "0", "inactive"].includes(text)) return false;
  return null;
}

function normalizeImportText(value, max = 160) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

exports.importProductsCsv = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const {
      csv_text,
      dry_run = false,
      update_existing = true,
      create_missing_categories = true
    } = req.body || {};

    const csvText = String(csv_text || "");
    if (!csvText.trim()) return res.status(400).json({ message: "csv_text is required" });
    if (csvText.length > IMPORT_TEXT_LIMIT) return res.status(413).json({ message: "CSV file is too large" });

    const rawRows = csvRowsToObjects(csvText);
    if (rawRows.length === 0) return res.status(400).json({ message: "CSV must include a header and at least one row" });
    if (rawRows.length > IMPORT_ROW_LIMIT) return res.status(400).json({ message: `Import supports up to ${IMPORT_ROW_LIMIT} rows at a time` });

    const categories = await prisma.productCategory.findMany({
      where: { company_id, is_active: true },
      select: { id: true, name: true }
    });
    const categoriesById = new Map(categories.map((category) => [category.id, category]));
    const categoriesByName = new Map(categories.map((category) => [category.name.toLowerCase(), category]));
    const seen = new Set();
    const errors = [];
    const normalizedRows = [];
    const missingCategoryNames = new Set();

    rawRows.forEach((row) => {
      const name = normalizeImportText(row.name || row.product, 220);
      const sku = normalizeImportText(row.sku, 80);
      const categoryId = normalizeImportText(row.category_id, 80);
      const categoryName = normalizeImportText(row.category_name, 160);
      const unit = normalizeImportText(row.unit, 40);
      const packSize = normalizeImportText(row.pack_size, 80);
      const description = normalizeImportText(row.description, 800);
      const price = toPriceOrUndefined(row.price);
      const isActive = parseOptionalBoolean(row.is_active);
      const key = productImportKey(name, packSize);
      let resolvedCategoryId = categoryId || null;

      if (!name) errors.push({ row_number: row.row_number, message: "name is required" });
      if (!unit) errors.push({ row_number: row.row_number, message: "unit is required" });
      if (Number.isNaN(price) || price < 0) errors.push({ row_number: row.row_number, message: "price must be zero or more" });
      if (isActive === null) errors.push({ row_number: row.row_number, message: "is_active must be true or false" });
      if (seen.has(key)) errors.push({ row_number: row.row_number, message: "duplicate product name and pack size in this CSV" });
      seen.add(key);

      if (resolvedCategoryId && !categoriesById.has(resolvedCategoryId)) {
        errors.push({ row_number: row.row_number, message: "category_id was not found" });
      } else if (!resolvedCategoryId) {
        const category = categoryName ? categoriesByName.get(categoryName.toLowerCase()) : null;
        if (category) resolvedCategoryId = category.id;
        else if (categoryName && create_missing_categories) missingCategoryNames.add(categoryName);
        else errors.push({ row_number: row.row_number, message: "category_name or category_id is required" });
      }

      normalizedRows.push({
        row_number: row.row_number,
        name,
        sku,
        category_id: resolvedCategoryId,
        category_name: categoryName,
        unit,
        pack_size: packSize,
        price: price === undefined ? 0 : price,
        description,
        is_active: isActive === undefined ? true : isActive
      });
    });

    if (errors.length) {
      return res.status(422).json({ ok: false, message: "CSV has validation errors", errors });
    }

    if (dry_run) {
      return res.json({
        ok: true,
        dry_run: true,
        summary: {
          valid_rows: normalizedRows.length,
          categories_to_create: missingCategoryNames.size,
          update_existing: Boolean(update_existing)
        }
      });
    }

    const summary = await prisma.$transaction(async (tx) => {
      const categoryMap = new Map(categoriesByName);
      let categoriesCreated = 0;
      for (const categoryName of missingCategoryNames) {
        const category = await tx.productCategory.upsert({
          where: { company_id_name: { company_id, name: categoryName } },
          update: { is_active: true },
          create: { company_id, name: categoryName, is_active: true },
          select: { id: true, name: true }
        });
        categoryMap.set(category.name.toLowerCase(), category);
        categoriesCreated += 1;
      }

      let created = 0;
      let updated = 0;
      let skipped = 0;
      for (const row of normalizedRows) {
        const category = row.category_id ? { id: row.category_id } : categoryMap.get(String(row.category_name || "").toLowerCase());
        const existing = await tx.product.findFirst({
          where: { company_id, name: row.name, pack_size: row.pack_size }
        });

        if (existing) {
          if (!update_existing) {
            skipped += 1;
            continue;
          }
          await tx.product.update({
            where: { id: existing.id },
            data: {
              category_id: category.id,
              sku: row.sku,
              unit: row.unit,
              price: row.price,
              description: row.description,
              is_active: row.is_active
            }
          });
          updated += 1;
        } else {
          await tx.product.create({
            data: {
              company_id,
              category_id: category.id,
              name: row.name,
              sku: row.sku,
              unit: row.unit,
              pack_size: row.pack_size,
              price: row.price,
              description: row.description,
              is_active: row.is_active
            }
          });
          created += 1;
        }
      }

      return { rows: normalizedRows.length, created, updated, skipped, categories_created: categoriesCreated };
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "PRODUCTS_IMPORTED",
      entity_type: "product_import",
      meta: { summary }
    });

    return res.json({ ok: true, summary });
  } catch (err) {
    console.error("importProductsCsv error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.createProduct = async (req, res) => {
  try {
    const company_id = req.user.company_id;

    const { category_id, name, sku, unit, pack_size, description, price } = req.body;

    if (!category_id) return res.status(400).json({ message: "category_id is required" });
    if (!name || !String(name).trim()) return res.status(400).json({ message: "name is required" });
    if (!unit || !String(unit).trim()) return res.status(400).json({ message: "unit is required" });

    const priceValue = toPriceOrUndefined(price);
    if (priceValue !== undefined) {
      if (Number.isNaN(priceValue)) return res.status(400).json({ message: "price is invalid" });
      if (priceValue < 0) return res.status(400).json({ message: "price cannot be negative" });
    }

    // Validate category exists
    const category = await prisma.productCategory.findFirst({
      where: { id: category_id, company_id, is_active: true }
    });
    if (!category) return res.status(404).json({ message: "Category not found" });

    const trimmedName = String(name).trim();
    const trimmedPack = toStrOrNull(pack_size);
    const trimmedSku = toStrOrNull(sku);

    // uniqueness by (company_id, name, pack_size)
    const existing = await prisma.product.findFirst({
      where: { company_id, name: trimmedName, pack_size: trimmedPack }
    });

    if (existing) {
      if (!existing.is_active) {
        const updated = await prisma.product.update({
          where: { id: existing.id },
          data: {
            is_active: true,
            category_id,
            sku: trimmedSku,
            unit: String(unit).trim(),
            price: priceValue !== undefined ? priceValue : undefined,
            description: toStrOrNull(description)
          },
          include: { category: { select: { id: true, name: true } } }
        });

        await logActivity({
          company_id,
          user_id: req.user.id,
          action: "PRODUCT_REACTIVATED",
          entity_type: "product",
          entity_id: updated.id,
          old_value: existing,
          new_value: updated
        });

        return res.status(200).json(updated);
      }

      return res.status(409).json({ message: "Product already exists" });
    }

    const product = await prisma.product.create({
      data: {
        company_id,
        category_id,
        name: trimmedName,
        sku: trimmedSku,
        unit: String(unit).trim(),
        pack_size: trimmedPack,
        price: priceValue !== undefined ? priceValue : undefined,
        description: toStrOrNull(description),
        is_active: true
      },
      include: { category: { select: { id: true, name: true } } }
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "PRODUCT_CREATED",
      entity_type: "product",
      entity_id: product.id,
      new_value: product
    });

    return res.status(201).json(product);
  } catch (err) {
    console.error("createProduct error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getProducts = async (req, res) => {
  try {
    const company_id = req.user.company_id;

    const q = (req.query.q || "").toString().trim();
    const category_id = (req.query.category_id || "").toString().trim();
    const is_active_param = (req.query.is_active || "").toString().trim();

    const is_active =
      is_active_param === "" ? true :
      is_active_param === "true" ? true :
      is_active_param === "false" ? false :
      true;

    const where = { company_id, is_active };

    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } },
        { pack_size: { contains: q, mode: "insensitive" } }
      ];
    }

    if (category_id) where.category_id = category_id;

    const pagination = getPagination(req, { defaultPageSize: 25, maxPageSize: 100 });
    const query = {
      where,
      orderBy: [{ updated_at: "desc" }, { id: "desc" }],
      include: { category: { select: { id: true, name: true } } }
    };
    if (pagination.enabled) {
      query.skip = pagination.skip;
      query.take = pagination.take;
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany(query),
      pagination.enabled && pagination.include_total ? prisma.product.count({ where }) : Promise.resolve(null)
    ]);

    if (!pagination.enabled) return res.json(products);

    return res.json({
      items: products,
      pagination: buildPaginationMeta({ page: pagination.page, page_size: pagination.page_size, total: total ?? products.length })
    });
  } catch (err) {
    console.error("getProducts error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getProductById = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;

    const product = await prisma.product.findFirst({
      where: { id, company_id },
      include: {
        category: { select: { id: true, name: true } },
        client_products: {
          where: { is_active: true },
          include: {
            client: { select: { id: true, company_name: true } }
          }
        }
      }
    });

    if (!product) return res.status(404).json({ message: "Product not found" });
    return res.json(product);
  } catch (err) {
    console.error("getProductById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;

    const existing = await prisma.product.findFirst({
      where: { id, company_id }
    });
    if (!existing) return res.status(404).json({ message: "Product not found" });

    const { category_id, name, sku, unit, pack_size, description, price, is_active } = req.body;

    if (name !== undefined && (!name || !String(name).trim())) {
      return res.status(400).json({ message: "name cannot be empty" });
    }
    if (unit !== undefined && (!unit || !String(unit).trim())) {
      return res.status(400).json({ message: "unit cannot be empty" });
    }

    const priceValue = toPriceOrUndefined(price);
    if (priceValue !== undefined) {
      if (Number.isNaN(priceValue)) return res.status(400).json({ message: "price is invalid" });
      if (priceValue < 0) return res.status(400).json({ message: "price cannot be negative" });
    }

    if (category_id) {
      const cat = await prisma.productCategory.findFirst({
        where: { id: category_id, company_id, is_active: true }
      });
      if (!cat) return res.status(404).json({ message: "Category not found" });
    }

    const nextName = name ? String(name).trim() : existing.name;
    const nextPack = pack_size !== undefined ? toStrOrNull(pack_size) : existing.pack_size;

    // Check uniqueness if name/pack changes
    if (
      (name && nextName !== existing.name) ||
      (pack_size !== undefined && nextPack !== existing.pack_size)
    ) {
      const dup = await prisma.product.findFirst({
        where: {
          company_id,
          name: nextName,
          pack_size: nextPack,
          id: { not: id }
        }
      });
      if (dup) {
        return res.status(409).json({ message: "Another product with same name and pack size exists" });
      }
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        category_id: category_id || undefined,
        name: name ? String(name).trim() : undefined,
        sku: sku !== undefined ? toStrOrNull(sku) : undefined,
        unit: unit ? String(unit).trim() : undefined,
        pack_size: pack_size !== undefined ? toStrOrNull(pack_size) : undefined,
        price: priceValue !== undefined ? priceValue : undefined,
        description: description !== undefined ? toStrOrNull(description) : undefined,
        is_active: typeof is_active === "boolean" ? is_active : undefined
      },
      include: { category: { select: { id: true, name: true } } }
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "PRODUCT_UPDATED",
      entity_type: "product",
      entity_id: id,
      old_value: existing,
      new_value: updated
    });

    return res.json(updated);
  } catch (err) {
    console.error("updateProduct error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;

    const existing = await prisma.product.findFirst({
      where: { id, company_id }
    });
    if (!existing) return res.status(404).json({ message: "Product not found" });

    const updated = await prisma.product.update({
      where: { id },
      data: { is_active: false }
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "PRODUCT_DELETED",
      entity_type: "product",
      entity_id: id,
      old_value: { is_active: existing.is_active },
      new_value: { is_active: false }
    });

    return res.json({ message: "Product disabled (soft deleted)" });
  } catch (err) {
    console.error("deleteProduct error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
