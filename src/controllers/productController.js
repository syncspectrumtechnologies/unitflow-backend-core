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
