const prisma = require("../config/db");

exports.getFactories = async (req, res) => {
  // Admin → all factories
  if (req.user.is_admin) {
    const factories = await prisma.factory.findMany({
      where: {
        company_id: req.user.company_id
      }
    });
    return res.json(factories);
  }

  // Staff → assigned factories only
  const factories = await prisma.userFactoryMap.findMany({
    where: {
      user_id: req.user.id,
      company_id: req.user.company_id
    },
    include: {
      factory: true
    }
  });

  return res.json(factories.map(f => f.factory));
};

// POST /factories
exports.createFactory = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { name, code, address } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "name is required" });
    }

    const created = await prisma.factory.create({
      data: {
        company_id,
        name: String(name).trim(),
        code: code !== undefined ? (code ? String(code).trim() : null) : null,
        address: address !== undefined ? (address ? String(address).trim() : null) : null
      }
    });

    return res.status(201).json(created);
  } catch (err) {
    console.error("createFactory error:", err);
    // Unique constraint for name
    if (err?.code === "P2002") {
      return res.status(409).json({ message: "Factory with same name already exists" });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

// PUT /factories/:id
exports.updateFactory = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;
    const { name, code, address, is_active } = req.body || {};

    const existing = await prisma.factory.findFirst({ where: { id, company_id } });
    if (!existing) return res.status(404).json({ message: "Factory not found" });

    const updated = await prisma.factory.update({
      where: { id },
      data: {
        name: name !== undefined ? String(name).trim() : undefined,
        code: code !== undefined ? (code ? String(code).trim() : null) : undefined,
        address: address !== undefined ? (address ? String(address).trim() : null) : undefined,
        is_active: is_active !== undefined ? Boolean(is_active) : undefined
      }
    });

    return res.json(updated);
  } catch (err) {
    console.error("updateFactory error:", err);
    if (err?.code === "P2002") {
      return res.status(409).json({ message: "Factory with same name already exists" });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};


// DELETE /factories/:id
exports.deleteFactory = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;

    const existing = await prisma.factory.findFirst({ where: { id, company_id } });
    if (!existing) return res.status(404).json({ message: "Factory not found" });
    if (!existing.is_active) {
      return res.json({ message: "Factory already deleted", factory: existing });
    }

    const updated = await prisma.factory.update({
      where: { id },
      data: { is_active: false }
    });

    return res.json({ message: "Factory deleted successfully", factory: updated });
  } catch (err) {
    console.error("deleteFactory error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
