const prisma = require("../config/db");
const logActivity = require("../utils/activityLogger");

// POST /categories
exports.createCategory = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { name, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "name is required" });
    }

    const trimmed = name.trim();

    const existing = await prisma.productCategory.findFirst({
      where: { company_id, name: trimmed }
    });

    if (existing) {
      // If exists but inactive, you may want to reactivate
      if (!existing.is_active) {
        const updated = await prisma.productCategory.update({
          where: { id: existing.id },
          data: { is_active: true, description: description?.trim() || null }
        });

        await logActivity({
          company_id,
          user_id: req.user.id,
          action: "CATEGORY_REACTIVATED",
          entity_type: "product_category",
          entity_id: updated.id,
          old_value: existing,
          new_value: updated
        });

        return res.status(200).json(updated);
      }

      return res.status(409).json({ message: "Category already exists" });
    }

    const category = await prisma.productCategory.create({
      data: {
        company_id,
        name: trimmed,
        description: description?.trim() || null,
        is_active: true
      }
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "CATEGORY_CREATED",
      entity_type: "product_category",
      entity_id: category.id,
      new_value: category
    });

    return res.status(201).json(category);
  } catch (err) {
    console.error("createCategory error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// GET /categories
exports.getCategories = async (req, res) => {
  try {
    const company_id = req.user.company_id;

    const q = (req.query.q || "").toString().trim();
    const is_active_param = (req.query.is_active || "").toString().trim();

    const is_active =
      is_active_param === "" ? true :
      is_active_param === "true" ? true :
      is_active_param === "false" ? false :
      true;

    const where = { company_id, is_active };

    if (q) {
      where.name = { contains: q, mode: "insensitive" };
    }

    const categories = await prisma.productCategory.findMany({
      where,
      orderBy: { updated_at: "desc" },
      include: {
        _count: { select: { products: true } }
      }
    });

    return res.json(categories);
  } catch (err) {
    console.error("getCategories error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// GET /categories/:id
exports.getCategoryById = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;

    const category = await prisma.productCategory.findFirst({
      where: { id, company_id },
      include: {
        products: {
          where: { is_active: true },
          orderBy: { updated_at: "desc" },
          select: {
            id: true,
            name: true,
            unit: true,
            sku: true,
            pack_size: true,
            is_active: true
          }
        }
      }
    });

    if (!category) return res.status(404).json({ message: "Category not found" });
    return res.json(category);
  } catch (err) {
    console.error("getCategoryById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// PUT /categories/:id
exports.updateCategory = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;

    const existing = await prisma.productCategory.findFirst({
      where: { id, company_id }
    });
    if (!existing) return res.status(404).json({ message: "Category not found" });

    const { name, description, is_active } = req.body;

    if (name !== undefined && (!name || !name.trim())) {
      return res.status(400).json({ message: "name cannot be empty" });
    }

    if (name && name.trim() !== existing.name) {
      const dup = await prisma.productCategory.findFirst({
        where: {
          company_id,
          name: name.trim(),
          id: { not: id }
        }
      });
      if (dup) return res.status(409).json({ message: "Another category with same name exists" });
    }

    const updated = await prisma.productCategory.update({
      where: { id },
      data: {
        name: name ? name.trim() : undefined,
        description: description !== undefined ? (description?.trim() || null) : undefined,
        is_active: typeof is_active === "boolean" ? is_active : undefined
      }
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "CATEGORY_UPDATED",
      entity_type: "product_category",
      entity_id: id,
      old_value: existing,
      new_value: updated
    });

    return res.json(updated);
  } catch (err) {
    console.error("updateCategory error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// DELETE /categories/:id (soft delete)
exports.deleteCategory = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;

    const existing = await prisma.productCategory.findFirst({
      where: { id, company_id }
    });
    if (!existing) return res.status(404).json({ message: "Category not found" });

    // Soft delete category
    const updated = await prisma.productCategory.update({
      where: { id },
      data: { is_active: false }
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "CATEGORY_DELETED",
      entity_type: "product_category",
      entity_id: id,
      old_value: { is_active: existing.is_active },
      new_value: { is_active: false }
    });

    return res.json({ message: "Category disabled (soft deleted)" });
  } catch (err) {
    console.error("deleteCategory error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
