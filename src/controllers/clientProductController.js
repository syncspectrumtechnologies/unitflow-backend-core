const prisma = require("../config/db");
const logActivity = require("../utils/activityLogger");

// POST /clients/:clientId/products
exports.addClientProduct = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId } = req.params;
    const { product_id, default_price, notes } = req.body;

    if (!product_id) return res.status(400).json({ message: "product_id is required" });

    const client = await prisma.client.findFirst({
      where: { id: clientId, company_id, is_active: true },
      select: { id: true }
    });
    if (!client) return res.status(404).json({ message: "Client not found" });

    const product = await prisma.product.findFirst({
      where: { id: product_id, company_id, is_active: true },
      select: { id: true, category_id: true }
    });
    if (!product) return res.status(404).json({ message: "Product not found" });

    // Avoid duplicates (soft delete safe)
    const existing = await prisma.clientProduct.findFirst({
      where: { company_id, client_id: clientId, product_id }
    });

    let row;
    if (existing) {
      row = await prisma.clientProduct.update({
        where: { id: existing.id },
        data: {
          is_active: true,
          default_price: default_price !== undefined ? Number(default_price) : existing.default_price,
          notes: notes !== undefined ? (notes?.toString() || null) : existing.notes
        }
      });
    } else {
      row = await prisma.clientProduct.create({
        data: {
          company_id,
          client_id: clientId,
          product_id,
          default_price: default_price !== undefined && default_price !== null ? Number(default_price) : null,
          notes: notes?.toString() || null,
          is_active: true
        }
      });
    }

    await prisma.clientCategory.upsert({
      where: { company_id_client_id_category_id: { company_id, client_id: clientId, category_id: product.category_id } },
      create: { company_id, client_id: clientId, category_id: product.category_id, is_active: true },
      update: { is_active: true }
    });

    await logActivity({
      company_id,
      factory_id: null,
      user_id: req.user.id,
      action: "CLIENT_PRODUCT_ADDED",
      entity_type: "client_product",
      entity_id: row.id,
      new_value: row
    });

    return res.status(201).json(row);
  } catch (err) {
    console.error("addClientProduct error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// DELETE /clients/:clientId/products/:productId
exports.removeClientProduct = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId, productId } = req.params;

    const existing = await prisma.clientProduct.findFirst({
      where: { company_id, client_id: clientId, product_id: productId, is_active: true }
    });
    if (!existing) return res.status(404).json({ message: "Client product mapping not found" });

    await prisma.clientProduct.update({
      where: { id: existing.id },
      data: { is_active: false }
    });

    await logActivity({
      company_id,
      factory_id: null,
      user_id: req.user.id,
      action: "CLIENT_PRODUCT_REMOVED",
      entity_type: "client_product",
      entity_id: existing.id,
      old_value: existing,
      new_value: { ...existing, is_active: false }
    });

    return res.json({ message: "Client product removed" });
  } catch (err) {
    console.error("removeClientProduct error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
