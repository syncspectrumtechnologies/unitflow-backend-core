const prisma = require("../config/db");

module.exports = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const factoryIdRaw =
      req.params?.factoryId ||
      req.query?.factory_id ||
      req.query?.factoryId ||
      req.body?.factory_id ||
      req.headers["x-factory-id"];

    if (!factoryIdRaw) {
      return res.status(400).json({ message: "factory_id is required" });
    }

    const factoryId = String(factoryIdRaw).trim();

    // Special mode: "all" factories (read-only views).
    // Frontend can pass ?factory_id=all to list/inspect data across all factories
    // the user has access to.
    if (["all", "ALL", "*", "bhikam", "BHIKAM"].includes(factoryId)) {
      // Only allow safe read requests.
      if (req.method !== "GET") {
        return res.status(400).json({ message: "factory_id must be a specific factory for write operations" });
      }

      let ids = [];
      if (req.user.is_admin) {
        const rows = await prisma.factory.findMany({
          where: { company_id: req.user.company_id, is_active: true },
          select: { id: true }
        });
        ids = rows.map((r) => r.id);
      } else {
        const rows = await prisma.userFactoryMap.findMany({
          where: { company_id: req.user.company_id, user_id: req.user.id },
          select: { factory_id: true }
        });
        ids = rows.map((r) => r.factory_id);
      }

      if (!ids.length) {
        return res.status(403).json({ message: "No factory access" });
      }

      req.factory_id = null;
      req.factory_ids = ids;
      req.factory_scope = "ALL";
      return next();
    }

    const factory = await prisma.factory.findFirst({
      where: {
        id: factoryId,
        company_id: req.user.company_id,
        is_active: true
      },
      select: { id: true }
    });

    if (!factory) {
      return res.status(404).json({ message: "Factory not found" });
    }

    if (req.user.is_admin) {
      req.factory_id = factoryId;
      req.factory_ids = [factoryId];
      req.factory_scope = "ONE";
      return next();
    }

    const access = await prisma.userFactoryMap.findFirst({
      where: {
        user_id: req.user.id,
        factory_id: factoryId,
        company_id: req.user.company_id
      }
    });

    if (!access) {
      return res.status(403).json({ message: "Unauthorized factory access" });
    }

    req.factory_id = factoryId;
    req.factory_ids = [factoryId];
    req.factory_scope = "ONE";
    next();
  } catch (err) {
    console.error("Factory middleware error:", err);
    return res.status(500).json({ message: "Factory access check failed" });
  }
};
