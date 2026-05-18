// Central role-based access control.
// We intentionally keep this separate from the legacy DB permissions tables.
// Access is determined by ROLE NAMES assigned to a user (UserRoleMap).

const CAP = {
  ADMIN: "ADMIN_ACCESS",

  CLIENTS_VIEW: "CLIENTS_VIEW",
  CLIENTS_MANAGE: "CLIENTS_MANAGE",

  FACTORIES_VIEW: "FACTORIES_VIEW",
  FACTORIES_MANAGE: "FACTORIES_MANAGE",

  CATALOG_VIEW: "CATALOG_VIEW",
  CATALOG_MANAGE: "CATALOG_MANAGE",

  ORDERS_VIEW: "ORDERS_VIEW",
  ORDERS_MANAGE: "ORDERS_MANAGE",

  INVOICES_VIEW: "INVOICES_VIEW",
  INVOICES_MANAGE: "INVOICES_MANAGE",

  PAYMENTS_VIEW: "PAYMENTS_VIEW",
  PAYMENTS_MANAGE: "PAYMENTS_MANAGE",

  PRODUCTION_VIEW: "PRODUCTION_VIEW",
  PRODUCTION_MANAGE: "PRODUCTION_MANAGE",

  INVENTORY_VIEW: "INVENTORY_VIEW",
  INVENTORY_MANAGE: "INVENTORY_MANAGE",

  PURCHASES_VIEW: "PURCHASES_VIEW",
  PURCHASES_MANAGE: "PURCHASES_MANAGE",

  MESSAGING_USE: "MESSAGING_USE",
  STATS_VIEW: "STATS_VIEW",
  ACCOUNTING_VIEW: "ACCOUNTING_VIEW",
  ACCOUNTING_MANAGE: "ACCOUNTING_MANAGE"
};

// Predefined roles (users can have multiple; union of capabilities).
// Admin users also bypass via `user.is_admin`.
const ROLE_CAPS = {
  ADMIN: Object.values(CAP),

  MANAGER: [
    CAP.CLIENTS_VIEW,
    CAP.CLIENTS_MANAGE,
    CAP.FACTORIES_VIEW,
    CAP.CATALOG_VIEW,
    CAP.CATALOG_MANAGE,
    CAP.ORDERS_VIEW,
    CAP.ORDERS_MANAGE,
    CAP.INVOICES_VIEW,
    CAP.INVOICES_MANAGE,
    CAP.PAYMENTS_VIEW,
    CAP.PAYMENTS_MANAGE,
    CAP.PRODUCTION_VIEW,
    CAP.PRODUCTION_MANAGE,
    CAP.INVENTORY_VIEW,
    CAP.INVENTORY_MANAGE,
    CAP.PURCHASES_VIEW,
    CAP.PURCHASES_MANAGE,
    CAP.MESSAGING_USE,
    CAP.STATS_VIEW,
    CAP.ACCOUNTING_VIEW,
    CAP.ACCOUNTING_MANAGE
  ],

  // Regular staff can operate core flows but should not manage master data.
  STAFF: [
    CAP.CATALOG_VIEW,
    CAP.ORDERS_VIEW,
    CAP.ORDERS_MANAGE,
    CAP.INVOICES_VIEW,
    CAP.PAYMENTS_VIEW,
    CAP.PAYMENTS_MANAGE,
    CAP.PRODUCTION_VIEW,
    CAP.PRODUCTION_MANAGE,
    CAP.INVENTORY_VIEW,
    CAP.INVENTORY_MANAGE,
    CAP.PURCHASES_VIEW,
    CAP.PURCHASES_MANAGE
  ],

  SALES: [
    CAP.CLIENTS_VIEW,
    CAP.CLIENTS_MANAGE,
    CAP.CATALOG_VIEW,
    CAP.CATALOG_MANAGE,
    CAP.ORDERS_VIEW,
    CAP.ORDERS_MANAGE,
    CAP.INVOICES_VIEW,
    CAP.MESSAGING_USE
  ],

  FINANCE: [
    CAP.CLIENTS_VIEW,
    CAP.FACTORIES_VIEW,
    CAP.CATALOG_VIEW,
    CAP.INVOICES_VIEW,
    CAP.INVOICES_MANAGE,
    CAP.PAYMENTS_VIEW,
    CAP.PAYMENTS_MANAGE,
    CAP.PURCHASES_VIEW,
    CAP.STATS_VIEW,
    CAP.MESSAGING_USE,
    CAP.ACCOUNTING_VIEW,
    CAP.ACCOUNTING_MANAGE
  ],

  // Dedicated accounting role that can be layered on top of operational roles.
  // Grants full access to accounting pages plus the minimal read-only lookups
  // those pages commonly need (clients, invoices, purchases, products, factories).
  ACCOUNTS: [
    CAP.CLIENTS_VIEW,
    CAP.FACTORIES_VIEW,
    CAP.CATALOG_VIEW,
    CAP.INVOICES_VIEW,
    CAP.PURCHASES_VIEW,
    CAP.ACCOUNTING_VIEW,
    CAP.ACCOUNTING_MANAGE
  ],

  // Alias support in case some environments create the role with a slightly
  // different name manually.
  ACCOUNTING: [
    CAP.CLIENTS_VIEW,
    CAP.FACTORIES_VIEW,
    CAP.CATALOG_VIEW,
    CAP.INVOICES_VIEW,
    CAP.PURCHASES_VIEW,
    CAP.ACCOUNTING_VIEW,
    CAP.ACCOUNTING_MANAGE
  ],

  INVENTORY: [
    CAP.CATALOG_VIEW,
    CAP.INVENTORY_VIEW,
    CAP.INVENTORY_MANAGE,
    CAP.PURCHASES_VIEW
  ],

  PRODUCTION: [
    CAP.PRODUCTION_VIEW,
    CAP.PRODUCTION_MANAGE,
    CAP.INVENTORY_VIEW
  ],

  PROCUREMENT: [
    CAP.PURCHASES_VIEW,
    CAP.PURCHASES_MANAGE,
    CAP.INVENTORY_VIEW
  ],

  MESSAGING: [CAP.MESSAGING_USE]
};

function normalizeRoleName(name) {
  return String(name || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function capabilitiesForRoles(roleNames) {
  const caps = new Set();
  (Array.isArray(roleNames) ? roleNames : [])
    .map(normalizeRoleName)
    .forEach((r) => {
      const c = ROLE_CAPS[r];
      if (Array.isArray(c)) c.forEach((x) => caps.add(x));
    });
  return caps;
}

// Convert legacy permission keys used in routes into our capability model.
// Example keys: clients.view, clients.create, invoices.pdf.view, admin.access
function requiredCapsFromPermissionKeys(keys) {
  const reqCaps = new Set();
  const arr = Array.isArray(keys) ? keys : [keys];

  for (const raw of arr) {
    const key = String(raw || "").trim();
    if (!key) continue;

    if (key.startsWith("admin.")) {
      reqCaps.add(CAP.ADMIN);
      continue;
    }

    const parts = key.split(".");
    const mod = (parts[0] || "").toLowerCase();
    const action = (parts[1] || "").toLowerCase();

    const isView =
      action === "view" ||
      action === "list" ||
      action === "get" ||
      action === "me" ||
      key.endsWith(".view") ||
      key.includes(".view.") ||
      key.includes(".pdf.view");

    const isManage = !isView;

    switch (mod) {
      case "clients":
      case "client_contacts":
      case "client_products":
        reqCaps.add(isManage ? CAP.CLIENTS_MANAGE : CAP.CLIENTS_VIEW);
        break;
      case "factories":
        reqCaps.add(isManage ? CAP.FACTORIES_MANAGE : CAP.FACTORIES_VIEW);
        break;
      case "categories":
      case "products":
        reqCaps.add(isManage ? CAP.CATALOG_MANAGE : CAP.CATALOG_VIEW);
        break;
      case "orders":
        reqCaps.add(isManage ? CAP.ORDERS_MANAGE : CAP.ORDERS_VIEW);
        break;
      case "invoices":
        reqCaps.add(isManage ? CAP.INVOICES_MANAGE : CAP.INVOICES_VIEW);
        break;
      case "payments":
        reqCaps.add(isManage ? CAP.PAYMENTS_MANAGE : CAP.PAYMENTS_VIEW);
        break;
      case "production":
        reqCaps.add(isManage ? CAP.PRODUCTION_MANAGE : CAP.PRODUCTION_VIEW);
        break;
      case "inventory":
        reqCaps.add(isManage ? CAP.INVENTORY_MANAGE : CAP.INVENTORY_VIEW);
        break;
      case "purchases":
        reqCaps.add(isManage ? CAP.PURCHASES_MANAGE : CAP.PURCHASES_VIEW);
        break;
      case "messages":
        reqCaps.add(CAP.MESSAGING_USE);
        break;
      case "stats":
        reqCaps.add(CAP.STATS_VIEW);
        break;
      case "accounting":
        reqCaps.add(isManage ? CAP.ACCOUNTING_MANAGE : CAP.ACCOUNTING_VIEW);
        break;
      case "permissions":
        // legacy only
        reqCaps.add(CAP.ADMIN);
        break;
      default:
        // Unknown module: safest default is admin-only
        reqCaps.add(CAP.ADMIN);
        break;
    }
  }

  return reqCaps;
}

function hasRequiredCapabilities(userCaps, requiredCaps) {
  if (!requiredCaps || requiredCaps.size === 0) return false;
  for (const cap of requiredCaps) {
    if (userCaps.has(cap)) return true;
  }
  return false;
}

module.exports = {
  CAP,
  ROLE_CAPS,
  normalizeRoleName,
  capabilitiesForRoles,
  requiredCapsFromPermissionKeys,
  hasRequiredCapabilities
};
