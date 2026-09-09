const prisma = require("../config/db");

// Seed permission keys used by admin screens and custom role grants.

const DEFAULT_PERMISSION_KEYS = [
  // Admin
  "admin.access",

  // Factories
  "factories.view",
  "factories.create",
  "factories.update",
  "factories.manage",
  "factories.delete",

  // Users / roles / permissions
  "users.view",
  "users.create",
  "users.update",
  "users.disable",
  "roles.view",
  "roles.create",
  "roles.permissions",
  "users.roles",
  "users.factories",
  "users.permissions",
  "permissions.view",
  "admin.view.permissions",

  // Categories
  "categories.view",
  "categories.create",
  "categories.update",
  "categories.delete",

  // Products
  "products.view",
  "products.create",
  "products.update",
  "products.delete",

  // Clients
  "clients.view",
  "clients.create",
  "clients.update",
  "clients.delete",
  "clients.letter",
  "clients.reengage",

  // Client contacts/products
  "client_contacts.view",
  "client_contacts.create",
  "client_contacts.update",
  "client_contacts.delete",
  "client_products.view",
  "client_products.create",
  "client_products.delete",

  // Production
  "production.view",
  "production.create",
  "production.update",
  "production.delete",

  // Inventory
  "inventory.view",
  "inventory.create",
  "inventory.adjust",
  "inventory.movements.view",
  "inventory.movements.create",

  // Orders
  "orders.view",
  "orders.create",
  "orders.update",
  "orders.status",
  "orders.delete",
  "orders.cancel",
  "orders.label.view",
  "orders.label.send",

  // Invoices
  "invoices.view",
  "invoices.create",
  "invoices.update",
  "invoices.status",
  "invoices.delete",
  "invoices.pdf",
  "invoices.pdf.view",
  "invoices.pdf.send",
  "invoices.remind",

  // Payments
  "payments.view",
  "payments.create",
  "payments.delete",

  // Messaging
  "messages.templates",
  "messages.campaigns",
  "messages.campaigns.create",
  "messages.campaigns.dispatch",
  "messages.campaigns.delete",
  "messages.outbox.view",
  "messages.send",

  // Stats
  "stats.view",
  "stats.delete",

  // Purchases
  "purchases.view",
  "purchases.create",
  "purchases.update",
  "purchases.delete",
  "purchases.status",
  "purchases.pdf",

  // Accounting
  "accounting.view",
  "accounting.create",

  // Tally integration
  "tally.view",
  "tally.manage",
  "tally.sync",
  "tally.export",
  "tally.import"
];

async function ensureDefaultPermissions() {
  const companies = await prisma.company.findMany({ select: { id: true } });
  for (const c of companies) {
    // existing keys
    const existing = await prisma.permission.findMany({
      where: { company_id: c.id },
      select: { key: true }
    });
    const existingSet = new Set(existing.map((e) => e.key));

    const toCreate = DEFAULT_PERMISSION_KEYS.filter((k) => !existingSet.has(k));
    if (!toCreate.length) continue;

    await prisma.permission.createMany({
      data: toCreate.map((k) => ({
        company_id: c.id,
        key: k,
        description: k,
        is_active: true
      })),
      skipDuplicates: true
    });
  }
}

// Predefined roles used by the role-based access control layer.
const SYSTEM_ROLES = [
  { name: "ADMIN", description: "Full access" },
  { name: "MANAGER", description: "Operational manager" },
  { name: "STAFF", description: "Core operations" },
  { name: "SALES", description: "Clients, orders, catalog" },
  { name: "FINANCE", description: "Invoices, payments, stats" },
  { name: "ACCOUNTS", description: "Accounting pages, ledgers, notes, and vouchers" },
  { name: "TALLY", description: "Tally integration setup, sync, and ledger mapping" },
  { name: "INVENTORY", description: "Inventory operations" },
  { name: "PRODUCTION", description: "Production operations" },
  { name: "PROCUREMENT", description: "Purchases" },
  { name: "MESSAGING", description: "Messaging campaigns" }
];

async function ensureSystemRoles() {
  const companies = await prisma.company.findMany({ select: { id: true } });
  for (const c of companies) {
    const existing = await prisma.role.findMany({
      where: { company_id: c.id },
      select: { name: true }
    });
    const set = new Set(existing.map((r) => (r.name || "").toUpperCase()));

    const toCreate = SYSTEM_ROLES.filter((r) => !set.has(r.name));
    if (!toCreate.length) continue;

    await prisma.role.createMany({
      data: toCreate.map((r) => ({
        company_id: c.id,
        name: r.name,
        description: r.description,
        is_system: true,
        is_active: true
      })),
      skipDuplicates: true
    });
  }
}

module.exports = { ensureDefaultPermissions, ensureSystemRoles, DEFAULT_PERMISSION_KEYS };
