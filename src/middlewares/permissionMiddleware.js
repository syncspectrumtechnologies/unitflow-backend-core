// Legacy name kept for backward compatibility with existing route files.
// Access uses ROLE NAMES for system defaults and DB permission maps for custom
// workspace grants created from the Platform role screen.

const prisma = require("../config/db");
const {
  capabilitiesForRoles,
  requiredCapsFromPermissionKeys,
  hasRequiredCapabilities
} = require("../utils/roleAccess");

const MODULE_BY_PERMISSION_PREFIX = {
  clients: "clients",
  client_contacts: "clients",
  client_products: "clients",
  factories: "factories",
  categories: "categories",
  products: "products",
  orders: "orders",
  invoices: "invoices",
  payments: "payments",
  production: "production",
  inventory: "inventory",
  purchases: "purchases",
  messages: "messages",
  stats: "dashboard",
  accounting: "accounting",
  tally: "tally",
  im: "chat"
};

function requiredPermissionKeys(required) {
  const keys = Array.isArray(required) ? required : [required];
  return keys.map((key) => String(key || "").trim()).filter(Boolean);
}

function normalizeEnabledModules(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  return new Set(value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean));
}

async function hasMappedPermission(user, keys) {
  const company_id = user?.company_id;
  const user_id = user?.id;
  if (!company_id || !user_id || keys.length === 0) return false;

  const [direct, viaRole] = await Promise.all([
    prisma.userPermissionMap.findFirst({
      where: {
        company_id,
        user_id,
        permission: { is: { key: { in: keys }, is_active: true } }
      },
      select: { id: true }
    }),
    prisma.rolePermissionMap.findFirst({
      where: {
        company_id,
        permission: { is: { key: { in: keys }, is_active: true } },
        role: {
          is: {
            is_active: true,
            user_map: { some: { company_id, user_id } }
          }
        }
      },
      select: { id: true }
    })
  ]);

  return Boolean(direct || viaRole);
}

function disabledModuleFromPermissionKeys(required, user) {
  const enabled = normalizeEnabledModules(user?.enabled_modules);
  if (!enabled || enabled.has("all") || enabled.has("core_erp")) return null;

  const keys = Array.isArray(required) ? required : [required];
  for (const raw of keys) {
    const parts = String(raw || "").trim().split(".");
    const prefix = parts[0]?.toLowerCase();
    const submodule = parts[1]?.toLowerCase();
    const moduleKey = prefix === "im" && submodule === "broadcast"
      ? "broadcast"
      : MODULE_BY_PERMISSION_PREFIX[prefix];
    if (moduleKey && !enabled.has(moduleKey)) return moduleKey;
  }

  return null;
}

// Supports being called as:
//   permissionMiddleware(["orders.view"])
//   permissionMiddleware("admin.access")
module.exports = (required = []) => {
  const requiredCaps = requiredCapsFromPermissionKeys(required);
  const permissionKeys = requiredPermissionKeys(required);

  return async (req, res, next) => {
    try {
      const disabledModule = disabledModuleFromPermissionKeys(required, req.user);
      if (disabledModule) {
        return res.status(403).json({
          message: "This ERP module is disabled for the workspace",
          code: "ERP_MODULE_DISABLED",
          module: disabledModule
        });
      }

      // Admin bypass (both legacy is_admin and role ADMIN)
      if (req.user?.is_admin) return next();

      const roles = req.user?.roles || [];
      const userCaps = capabilitiesForRoles(roles);

      // Allow ADMIN role as global bypass
      if (userCaps.has("ADMIN_ACCESS")) return next();

      if (!hasRequiredCapabilities(userCaps, requiredCaps)) {
        const mapped = await hasMappedPermission(req.user, permissionKeys);
        if (!mapped) return res.status(403).json({ message: "Access denied" });
      }

      return next();
    } catch (err) {
      console.error("role permissionMiddleware error:", err);
      return res.status(500).json({ message: "Access check failed" });
    }
  };
};
