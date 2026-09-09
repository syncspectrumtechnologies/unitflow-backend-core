// src/controllers/adminController.js
const prisma = require("../config/db");
const logActivity = require("../utils/activityLogger");
const { hashPassword } = require("../utils/password");
const { getPagination, buildPaginationMeta } = require("../utils/pagination");
const { redact } = require("../utils/redact");

function textFilter(value, max = 120) {
  const text = String(value || "").trim();
  return text ? text.slice(0, max) : "";
}

function parseDate(value) {
  const text = textFilter(value, 40);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeLoginId(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(text)) return "";
  return text;
}

function syntheticLoginEmail(companyId, loginId) {
  return `${loginId}@${companyId}.unitflow.local`;
}

function resolveLoginIdentity({ companyId, email, login_id }) {
  const raw = String(login_id || email || "").trim();
  if (!raw) return null;
  if (raw.includes("@")) {
    return { email: raw.toLowerCase(), login_id: raw.toLowerCase(), uses_email_login: true };
  }
  const loginId = normalizeLoginId(raw);
  if (!loginId) return null;
  return { email: syntheticLoginEmail(companyId, loginId), login_id: loginId, uses_email_login: false };
}

function publicLoginId(email, companyId) {
  const normalized = String(email || "").trim().toLowerCase();
  const suffix = `@${companyId}.unitflow.local`;
  if (normalized.endsWith(suffix)) return normalized.slice(0, -suffix.length);
  return normalized;
}

function serializeUser(row, companyId = row?.company_id) {
  if (!row) return row;
  return {
    ...row,
    login_id: publicLoginId(row.email, companyId),
    uses_email_login: !String(row.email || "").endsWith(`@${companyId}.unitflow.local`)
  };
}

function serializeActivityLog(row, factoryNameById = new Map()) {
  return {
    id: row.id,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    factory_id: row.factory_id,
    factory_name: row.factory_id ? factoryNameById.get(row.factory_id) || null : null,
    user_id: row.user_id,
    user: row.user ? {
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
      is_admin: row.user.is_admin
    } : null,
    meta: redact(row.meta || {}),
    created_at: row.created_at
  };
}

const EXPORT_GROUPS = {
  masters: 1,
  operations: 2,
  full: 3
};

const DEFAULT_EXPORT_LIMIT = 5000;
const MAX_EXPORT_LIMIT = 20000;

const USER_EXPORT_SELECT = {
  id: true,
  company_id: true,
  email: true,
  phone: true,
  name: true,
  provider: true,
  status: true,
  is_admin: true,
  last_login_at: true,
  created_at: true,
  updated_at: true
};

const DATA_EXPORT_TABLES = [
  {
    key: "company",
    model: "company",
    group: "masters",
    single: true,
    where: (company_id) => ({ id: company_id }),
    select: {
      id: true,
      name: true,
      legal_name: true,
      gstin: true,
      phone: true,
      email: true,
      address: true,
      state: true,
      state_code: true,
      is_gst_enabled: true,
      is_active: true,
      created_at: true,
      updated_at: true
    }
  },
  { key: "platform_config", model: "companyPlatformConfig", group: "masters", single: true, where: (company_id) => ({ company_id }) },
  { key: "sales_companies", model: "salesCompany", group: "masters" },
  { key: "factories", model: "factory", group: "masters" },
  { key: "users", model: "user", group: "masters", select: USER_EXPORT_SELECT },
  { key: "roles", model: "role", group: "masters" },
  { key: "permissions", model: "permission", group: "masters" },
  { key: "user_role_maps", model: "userRoleMap", group: "masters" },
  { key: "role_permission_maps", model: "rolePermissionMap", group: "masters" },
  { key: "user_permission_maps", model: "userPermissionMap", group: "masters" },
  { key: "user_factory_maps", model: "userFactoryMap", group: "masters" },
  { key: "number_sequences", model: "numberSequence", group: "masters" },
  { key: "product_categories", model: "productCategory", group: "masters" },
  { key: "products", model: "product", group: "masters" },
  { key: "clients", model: "client", group: "masters" },
  { key: "client_contacts", model: "clientContact", group: "masters" },
  { key: "client_products", model: "clientProduct", group: "masters" },
  { key: "client_categories", model: "clientCategory", group: "masters" },

  { key: "production_logs", model: "productionLog", group: "operations" },
  { key: "inventory_movements", model: "inventoryMovement", group: "operations" },
  { key: "stock_snapshots", model: "stockSnapshot", group: "operations" },
  { key: "stock_balances", model: "stockBalance", group: "operations" },
  { key: "orders", model: "order", group: "operations" },
  { key: "order_items", model: "orderItem", group: "operations" },
  { key: "order_charges", model: "orderCharge", group: "operations" },
  { key: "order_status_history", model: "orderStatusHistory", group: "operations" },
  { key: "order_fulfillments", model: "orderFulfillment", group: "operations" },
  { key: "invoices", model: "invoice", group: "operations" },
  { key: "invoice_items", model: "invoiceItem", group: "operations" },
  { key: "invoice_charges", model: "invoiceCharge", group: "operations" },
  { key: "invoice_status_history", model: "invoiceStatusHistory", group: "operations" },
  { key: "payments", model: "payment", group: "operations" },
  { key: "payment_allocations", model: "paymentAllocation", group: "operations" },
  { key: "purchases", model: "purchase", group: "operations" },
  { key: "purchase_advances", model: "purchaseAdvance", group: "operations" },
  { key: "purchase_payments", model: "purchasePayment", group: "operations" },
  { key: "purchase_items", model: "purchaseItem", group: "operations" },
  { key: "purchase_charges", model: "purchaseCharge", group: "operations" },
  { key: "purchase_status_history", model: "purchaseStatusHistory", group: "operations" },
  { key: "accounting_vouchers", model: "accountingVoucher", group: "operations" },
  { key: "accounting_voucher_lines", model: "accountingVoucherLine", group: "operations" },
  { key: "compliance_reports", model: "complianceReport", group: "operations" },

  { key: "message_templates", model: "messageTemplate", group: "full" },
  { key: "message_campaigns", model: "messageCampaign", group: "full" },
  { key: "message_recipients", model: "messageRecipient", group: "full" },
  { key: "message_logs", model: "messageLog", group: "full" },
  { key: "message_dispatch_jobs", model: "messageDispatchJob", group: "full" },
  { key: "conversations", model: "conversation", group: "full" },
  { key: "conversation_members", model: "conversationMember", group: "full" },
  { key: "chat_messages", model: "chatMessage", group: "full" },
  { key: "broadcast_messages", model: "broadcastMessage", group: "full" },
  { key: "broadcast_recipients", model: "broadcastRecipient", group: "full" },
  { key: "activity_logs", model: "activityLog", group: "full" }
];

function parseExportScope(value) {
  const scope = String(value || "operations").trim().toLowerCase();
  return EXPORT_GROUPS[scope] ? scope : "operations";
}

function parseExportLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_EXPORT_LIMIT;
  return Math.min(parsed, MAX_EXPORT_LIMIT);
}

function safeJson(value) {
  if (value === null || value === undefined) return value;
  return redact(JSON.parse(JSON.stringify(value)));
}

function buildExportFindArgs(def, company_id, limit) {
  const args = {
    where: def.where ? def.where(company_id) : { company_id },
    ...(def.select ? { select: def.select } : {})
  };
  if (!def.single) {
    args.orderBy = [{ created_at: "asc" }, { id: "asc" }];
    args.take = limit;
  }
  return args;
}

async function readExportTable(def, company_id, limit) {
  const model = prisma[def.model];
  if (!model) throw new Error(`Unsupported export model: ${def.model}`);

  const args = buildExportFindArgs(def, company_id, limit);
  if (def.single) {
    const row = await model.findUnique(args);
    return {
      value: safeJson(row),
      count: row ? 1 : 0,
      total: row ? 1 : 0,
      truncated: false
    };
  }

  const [rows, total] = await Promise.all([
    model.findMany(args),
    model.count({ where: args.where })
  ]);

  return {
    value: rows.map((row) => safeJson(row)),
    count: rows.length,
    total,
    truncated: total > rows.length
  };
}

async function getAccessPolicy(company_id) {
  const [config, activeUserCount] = await Promise.all([
    prisma.companyPlatformConfig.findUnique({
      where: { company_id },
      select: {
        plan_code: true,
        billing_cycle: true,
        subscription_status: true,
        seat_limit: true,
        platform_last_synced_at: true
      }
    }).catch(() => null),
    prisma.user.count({ where: { company_id, status: "ACTIVE" } })
  ]);

  const planCode = String(config?.plan_code || "").toUpperCase();
  const syncedSeatLimit = Number(config?.seat_limit || 0);
  const userLimit = planCode === "SINGLE_USER" ? 1 : syncedSeatLimit > 0 ? syncedSeatLimit : null;

  return {
    plan_code: config?.plan_code || null,
    billing_cycle: config?.billing_cycle || null,
    subscription_status: config?.subscription_status || null,
    seat_limit: syncedSeatLimit || null,
    user_limit: userLimit,
    active_user_count: activeUserCount,
    remaining_users: userLimit ? Math.max(userLimit - activeUserCount, 0) : null,
    platform_last_synced_at: config?.platform_last_synced_at || null
  };
}

async function assertCanActivateUser(company_id, targetUserId = null) {
  const policy = await getAccessPolicy(company_id);
  if (!policy.user_limit) return { allowed: true, policy };

  const activeUsersExcludingTarget = await prisma.user.count({
    where: {
      company_id,
      status: "ACTIVE",
      ...(targetUserId ? { id: { not: targetUserId } } : {})
    }
  });

  if (activeUsersExcludingTarget >= policy.user_limit) {
    return { allowed: false, policy: { ...policy, active_user_count: activeUsersExcludingTarget } };
  }
  return { allowed: true, policy };
}

// -------------------------
// USERS
// -------------------------

exports.getAccessPolicy = async (req, res) => {
  try {
    const policy = await getAccessPolicy(req.user.company_id);
    return res.json({ ok: true, access_policy: policy });
  } catch (err) {
    console.error("getAccessPolicy error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getActivityLogs = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const pagination = getPagination(req, { defaultPageSize: 25, maxPageSize: 100 });
    const action = textFilter(req.query.action);
    const entityType = textFilter(req.query.entity_type || req.query.entityType);
    const userId = textFilter(req.query.user_id || req.query.userId);
    const factoryId = textFilter(req.query.factory_id || req.query.factoryId);
    const search = textFilter(req.query.q, 80);
    const dateFrom = parseDate(req.query.date_from || req.query.dateFrom);
    const dateTo = parseDate(req.query.date_to || req.query.dateTo);

    const where = {
      company_id,
      ...(action ? { action: { contains: action, mode: "insensitive" } } : {}),
      ...(entityType ? { entity_type: entityType } : {}),
      ...(userId ? { user_id: userId } : {}),
      ...(factoryId ? { factory_id: factoryId } : {}),
      ...(dateFrom || dateTo ? {
        created_at: {
          ...(dateFrom ? { gte: dateFrom } : {}),
          ...(dateTo ? { lte: dateTo } : {})
        }
      } : {}),
      ...(search ? {
        OR: [
          { action: { contains: search, mode: "insensitive" } },
          { entity_type: { contains: search, mode: "insensitive" } },
          { entity_id: { contains: search, mode: "insensitive" } },
          { user: { is: { email: { contains: search, mode: "insensitive" } } } },
          { user: { is: { name: { contains: search, mode: "insensitive" } } } }
        ]
      } : {})
    };

    const [logs, total, actionSummary] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        skip: pagination.skip,
        take: pagination.take,
        include: {
          user: { select: { id: true, name: true, email: true, is_admin: true } }
        }
      }),
      pagination.include_total ? prisma.activityLog.count({ where }) : Promise.resolve(null),
      prisma.activityLog.groupBy({
        by: ["action"],
        where: { company_id },
        _count: { action: true }
      })
    ]);
    const factoryIds = [...new Set(logs.map((row) => row.factory_id).filter(Boolean))];
    const factories = factoryIds.length
      ? await prisma.factory.findMany({
          where: { company_id, id: { in: factoryIds } },
          select: { id: true, name: true }
        })
      : [];
    const factoryNameById = new Map(factories.map((factory) => [factory.id, factory.name]));

    return res.json({
      items: logs.map((row) => serializeActivityLog(row, factoryNameById)),
      pagination: buildPaginationMeta({
        page: pagination.page,
        page_size: pagination.page_size,
        total: total ?? logs.length
      }),
      summary: {
        top_actions: actionSummary
          .map((row) => ({ action: row.action, count: row._count.action || 0 }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 12)
      }
    });
  } catch (err) {
    console.error("getActivityLogs error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getDataExport = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const scope = parseExportScope(req.query.scope);
    const limit = parseExportLimit(req.query.limit);
    const maxGroup = EXPORT_GROUPS[scope];
    const selectedTables = DATA_EXPORT_TABLES.filter((table) => EXPORT_GROUPS[table.group] <= maxGroup);
    const data = {};
    const counts = {};
    const truncated = [];

    for (const table of selectedTables) {
      const result = await readExportTable(table, company_id, limit);
      data[table.key] = result.value;
      counts[table.key] = {
        exported: result.count,
        total: result.total,
        truncated: result.truncated
      };
      if (result.truncated) truncated.push(table.key);
    }

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "DATA_EXPORT_CREATED",
      entity_type: "admin_data_export",
      meta: {
        scope,
        table_count: selectedTables.length,
        row_limit: limit,
        truncated
      },
      ip: req.ip,
      user_agent: req.headers["user-agent"]
    });

    return res.json({
      ok: true,
      exported_at: new Date().toISOString(),
      company_id,
      scope,
      row_limit: limit,
      table_count: selectedTables.length,
      truncated_tables: truncated,
      counts,
      data
    });
  } catch (err) {
    console.error("getDataExport error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// GET /admin/users
exports.getUsers = async (req, res) => {
  try {
    const company_id = req.user.company_id;

    const pagination = getPagination(req, { defaultPageSize: 25, maxPageSize: 100 });
    const where = { company_id };
    const query = {
      where,
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        is_admin: true,
        created_at: true,
      },
    };
    if (pagination.enabled) {
      query.skip = pagination.skip;
      query.take = pagination.take;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany(query),
      pagination.enabled && pagination.include_total ? prisma.user.count({ where }) : Promise.resolve(null)
    ]);

    const out = users.map((user) => serializeUser(user, company_id));

    if (!pagination.enabled) return res.json(out);

    return res.json({
      items: out,
      pagination: buildPaginationMeta({ page: pagination.page, page_size: pagination.page_size, total: total ?? out.length })
    });
  } catch (err) {
    console.error("getUsers error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// GET /admin/users/assignments
// Returns every user with currently assigned roles + factories.
// Used by role/factory assignment UI so admin doesn't need each user's token.
exports.getUserAssignments = async (req, res) => {
  try {
    const company_id = req.user.company_id;

    const pagination = getPagination(req, { defaultPageSize: 25, maxPageSize: 100 });
    const where = { company_id };
    const query = {
      where,
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        is_admin: true,
        created_at: true,

        roles_map: {
          select: {
            role: { select: { id: true, name: true } }
          }
        },
        factories_map: {
          select: {
            factory: { select: { id: true, name: true, is_active: true } }
          }
        }
      }
    };
    if (pagination.enabled) {
      query.skip = pagination.skip;
      query.take = pagination.take;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany(query),
      pagination.enabled && pagination.include_total ? prisma.user.count({ where }) : Promise.resolve(null)
    ]);

    const out = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      login_id: publicLoginId(u.email, company_id),
      uses_email_login: !String(u.email || "").endsWith(`@${company_id}.unitflow.local`),
      status: u.status,
      is_admin: u.is_admin,
      created_at: u.created_at,
      roles: (u.roles_map || []).map((r) => r.role).filter(Boolean),
      factories: (u.factories_map || []).map((f) => f.factory).filter((x) => x && x.is_active)
    }));

    if (!pagination.enabled) return res.json(out);

    return res.json({
      items: out,
      pagination: buildPaginationMeta({ page: pagination.page, page_size: pagination.page_size, total: total ?? out.length })
    });
  } catch (err) {
    console.error("getUserAssignments error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
// GET /admin/users/:userId/roles
exports.getUserRoles = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { userId } = req.params;

    const user = await prisma.user.findFirst({
      where: { id: userId, company_id },
      select: { id: true, name: true, email: true, status: true, is_admin: true }
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const roles = await prisma.userRoleMap.findMany({
      where: { company_id, user_id: userId },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      select: {
        created_at: true,
        role: {
          select: {
            id: true,
            name: true,
            description: true,
            is_system: true,
            is_active: true,
            created_at: true,
            updated_at: true
          }
        }
      }
    });

    return res.json({
      user,
      count: roles.length,
      roles: roles.map((row) => row.role).filter(Boolean)
    });
  } catch (err) {
    console.error("getUserRoles error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// GET /admin/users/:userId/factories
exports.getUserFactories = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { userId } = req.params;

    const user = await prisma.user.findFirst({
      where: { id: userId, company_id },
      select: { id: true, name: true, email: true, status: true, is_admin: true }
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const factories = await prisma.userFactoryMap.findMany({
      where: { company_id, user_id: userId },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      select: {
        created_at: true,
        factory: {
          select: {
            id: true,
            name: true,
            code: true,
            address: true,
            is_active: true,
            created_at: true,
            updated_at: true
          }
        }
      }
    });

    return res.json({
      user,
      count: factories.length,
      factories: factories.map((row) => row.factory).filter(Boolean)
    });
  } catch (err) {
    console.error("getUserFactories error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
// POST /admin/users
exports.createUser = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { name, email, login_id, password, is_admin } = req.body || {};

    if (!name || !String(name).trim())
      return res.status(400).json({ message: "name is required" });
    const identity = resolveLoginIdentity({ companyId: company_id, email, login_id });
    if (!identity) {
      return res.status(400).json({ message: "login_id is required and must use 3-40 letters, numbers, dot, dash, or underscore" });
    }
    if (!password || String(password).length < 8 || String(password).length > 128)
      return res
        .status(400)
        .json({ message: "password must be between 8 and 128 characters" });

    const exists = await prisma.user.findFirst({
      where: { company_id, email: identity.email },
      select: { id: true },
    });
    if (exists)
      return res.status(409).json({ message: "User with this login ID already exists" });

    const limitCheck = await assertCanActivateUser(company_id);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        code: "PLAN_USER_LIMIT_REACHED",
        message: "Active user limit reached for this subscription",
        access_policy: limitCheck.policy
      });
    }

    const password_hash = await hashPassword(String(password));

    const created = await prisma.user.create({
      data: {
        company_id,
        name: String(name).trim(),
        email: identity.email,
        password_hash,
        status: "ACTIVE",
        is_admin: Boolean(is_admin),
      },
      select: { id: true, name: true, email: true, status: true, is_admin: true },
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "USER_CREATED",
      entity_type: "user",
      entity_id: created.id,
      new_value: { login_id: publicLoginId(created.email, company_id), name: created.name, is_admin: created.is_admin },
    });

    return res.status(201).json(serializeUser(created, company_id));
  } catch (err) {
    console.error("createUser error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Enable/Disable user via status enum
 * Used by disableUser + enableUser wrappers.
 */
exports.toggleUserStatus = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { userId } = req.params;
    const { status } = req.body || {};

    const user = await prisma.user.findFirst({ where: { id: userId, company_id } });
    if (!user) return res.status(404).json({ message: "User not found" });

    const nextStatus = status === "DISABLED" ? "DISABLED" : "ACTIVE";

    if (nextStatus === "ACTIVE" && user.status !== "ACTIVE") {
      const limitCheck = await assertCanActivateUser(company_id, userId);
      if (!limitCheck.allowed) {
        return res.status(403).json({
          code: "PLAN_USER_LIMIT_REACHED",
          message: "Active user limit reached for this subscription",
          access_policy: limitCheck.policy
        });
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: { status: nextStatus },
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: nextStatus === "ACTIVE" ? "USER_ENABLED" : "USER_DISABLED",
      entity_type: "user",
      entity_id: userId,
      old_value: { status: user.status },
      new_value: { status: nextStatus },
    });

    return res.json({ message: "User status updated" });
  } catch (err) {
    console.error("toggleUserStatus error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// PUT /admin/users/:userId/disable
exports.disableUser = async (req, res) => {
  req.body = { ...(req.body || {}), status: "DISABLED" };
  return exports.toggleUserStatus(req, res);
};

// PUT /admin/users/:userId/enable
exports.enableUser = async (req, res) => {
  req.body = { ...(req.body || {}), status: "ACTIVE" };
  return exports.toggleUserStatus(req, res);
};

// PUT /admin/users/:userId/password
exports.resetUserPassword = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { userId } = req.params;
    const new_password = String(req.body?.new_password || req.body?.password || "");

    if (new_password.length < 8 || new_password.length > 128) {
      return res.status(400).json({ message: "new_password must be between 8 and 128 characters" });
    }

    const user = await prisma.user.findFirst({
      where: { id: userId, company_id },
      select: { id: true, email: true, name: true, is_admin: true }
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    const password_hash = await hashPassword(new_password);

    const revoked = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { password_hash }
      });

      return tx.userSession.updateMany({
        where: {
          company_id,
          user_id: userId,
          revoked_at: null
        },
        data: { revoked_at: new Date() }
      });
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "USER_PASSWORD_RESET_BY_ADMIN",
      entity_type: "user",
      entity_id: userId,
      meta: {
        target_email: user.email,
        revoked_session_count: revoked.count || 0
      }
    });

    return res.json({ message: "User password reset successful" });
  } catch (err) {
    console.error("resetUserPassword error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Admin: who is online
 * Online = not revoked, not expired, last_seen within last 5 minutes
 */
exports.getOnlineUsers = async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);

    const sessions = await prisma.userSession.findMany({
      where: {
        company_id: req.user.company_id,
        revoked_at: null,
        last_seen_at: { gte: cutoff },
      },
      distinct: ["user_id"],
      orderBy: [{ user_id: "asc" }, { last_seen_at: "desc" }],
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            is_admin: true,
          },
        },
      },
    });

    const users = sessions
      .filter((s) => s.user)
      .map((s) => ({
        user: s.user,
        last_seen_at: s.last_seen_at,
        ip: s.ip,
        user_agent: s.user_agent,
      }))
      .sort((a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime());

    return res.json({
      count: users.length,
      users,
    });
  } catch (err) {
    console.error("getOnlineUsers error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// -------------------------
// ROLES
// -------------------------

// GET /admin/roles
exports.getRoles = async (req, res) => {
  try {
    const company_id = req.user.company_id;

    const roles = await prisma.role.findMany({
      where: { company_id, is_active: true },
      orderBy: { created_at: "desc" },
      include: {
        role_permissions: {
          include: { permission: { select: { id: true, key: true, description: true } } },
          orderBy: { created_at: "desc" }
        }
      }
    });

    return res.json(roles.map(({ role_permissions = [], ...role }) => ({
      ...role,
      permissions: role_permissions
        .map((row) => row.permission)
        .filter(Boolean)
        .map((permission) => ({
          id: permission.id,
          key: permission.key,
          name: permission.description || permission.key
        }))
    })));
  } catch (err) {
    console.error("getRoles error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// POST /admin/roles
exports.createRole = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { name, description } = req.body || {};

    if (!name || !String(name).trim())
      return res.status(400).json({ message: "name is required" });

    const created = await prisma.role.create({
      data: {
        company_id,
        name: String(name).trim(),
        description: description ? String(description).trim() : null,
      },
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "ROLE_CREATED",
      entity_type: "role",
      entity_id: created.id,
      new_value: { name: created.name },
    });

    return res.status(201).json(created);
  } catch (err) {
    console.error("createRole error:", err);
    if (err?.code === "P2002") {
      return res.status(409).json({ message: "Role with same name already exists" });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

// DELETE /admin/roles/:roleId
exports.deleteRole = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { roleId } = req.params;

    const existing = await prisma.role.findFirst({
      where: { id: roleId, company_id }
    });
    if (!existing) return res.status(404).json({ message: "Role not found" });
    if (!existing.is_active) return res.json({ message: "Role already deleted", role: existing });

    const deleted = await prisma.role.update({
      where: { id: roleId },
      data: { is_active: false }
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "ROLE_DELETED",
      entity_type: "role",
      entity_id: roleId,
      old_value: existing,
      new_value: { is_active: false }
    });

    return res.json({ message: "Role deleted successfully", role: deleted });
  } catch (err) {
    console.error("deleteRole error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// -------------------------
// USER ↔ ROLE / FACTORY MAPPING
// -------------------------

// POST /admin/users/:userId/roles  Body: { role_id }
exports.assignRole = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { userId } = req.params;
    const { role_id } = req.body || {};

    if (!role_id) return res.status(400).json({ message: "role_id is required" });

    const user = await prisma.user.findFirst({
      where: { id: userId, company_id },
      select: { id: true },
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    const role = await prisma.role.findFirst({
      where: { id: role_id, company_id, is_active: true },
      select: { id: true },
    });
    if (!role) return res.status(404).json({ message: "Role not found" });

    const exists = await prisma.userRoleMap.findFirst({
      where: { company_id, user_id: userId, role_id },
    });
    if (exists) return res.json({ message: "Role already assigned" });

    await prisma.userRoleMap.create({
      data: {
        company_id,
        user_id: userId,
        role_id,
        created_by: req.user.id,
      },
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "ROLE_ASSIGNED",
      entity_type: "user",
      entity_id: userId,
      new_value: { role_id },
    });

    return res.json({ message: "Role assigned" });
  } catch (err) {
    console.error("assignRole error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// DELETE /admin/users/:userId/roles/:roleId
exports.removeRole = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { userId, roleId } = req.params;

    await prisma.userRoleMap.deleteMany({
      where: { company_id, user_id: userId, role_id: roleId },
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "ROLE_REMOVED",
      entity_type: "user",
      entity_id: userId,
      old_value: { role_id: roleId },
    });

    return res.json({ message: "Role removed" });
  } catch (err) {
    console.error("removeRole error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// POST /admin/users/:userId/factories  Body: { factory_id }
exports.assignFactory = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { userId } = req.params;
    const { factory_id } = req.body || {};

    if (!factory_id) return res.status(400).json({ message: "factory_id is required" });

    const user = await prisma.user.findFirst({
      where: { id: userId, company_id },
      select: { id: true },
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    const factory = await prisma.factory.findFirst({
      where: { id: factory_id, company_id, is_active: true },
      select: { id: true },
    });
    if (!factory) return res.status(404).json({ message: "Factory not found" });

    const exists = await prisma.userFactoryMap.findFirst({
      where: { company_id, user_id: userId, factory_id },
    });
    if (exists) return res.json({ message: "Factory already assigned" });

    await prisma.userFactoryMap.create({
      data: {
        company_id,
        user_id: userId,
        factory_id,
        created_by: req.user.id,
      },
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "FACTORY_ASSIGNED",
      entity_type: "user",
      entity_id: userId,
      new_value: { factory_id },
    });

    return res.json({ message: "Factory assigned" });
  } catch (err) {
    console.error("assignFactory error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// DELETE /admin/users/:userId/factories/:factoryId
exports.removeFactory = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { userId, factoryId } = req.params;

    await prisma.userFactoryMap.deleteMany({
      where: { company_id, user_id: userId, factory_id: factoryId },
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "FACTORY_REMOVED",
      entity_type: "user",
      entity_id: userId,
      old_value: { factory_id: factoryId },
    });

    return res.json({ message: "Factory removed" });
  } catch (err) {
    console.error("removeFactory error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// -------------------------
// PERMISSIONS (USER + ROLE)
// -------------------------

// POST /admin/users/:userId/permissions  Body: { permission_keys: string[] }
exports.grantUserPermissions = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { userId } = req.params;
    const { permission_keys } = req.body || {};

    if (!Array.isArray(permission_keys) || permission_keys.length === 0) {
      return res.status(400).json({ message: "permission_keys must be a non-empty array" });
    }

    const user = await prisma.user.findFirst({ where: { id: userId, company_id }, select: { id: true } });
    if (!user) return res.status(404).json({ message: "User not found" });

    const perms = await prisma.permission.findMany({
      where: { company_id, key: { in: permission_keys }, is_active: true },
      select: { id: true, key: true },
    });

    if (perms.length !== permission_keys.length) {
      return res.status(404).json({ message: "One or more permission keys not found" });
    }

    await prisma.userPermissionMap.createMany({
      data: perms.map((p) => ({
        company_id,
        user_id: userId,
        permission_id: p.id,
        created_by: req.user.id,
      })),
      skipDuplicates: true,
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "USER_PERMISSIONS_GRANTED",
      entity_type: "user",
      entity_id: userId,
      meta: { permission_keys },
    });

    return res.json({ ok: true, granted: permission_keys });
  } catch (err) {
    console.error("grantUserPermissions error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// DELETE /admin/users/:userId/permissions/:permissionKey
exports.revokeUserPermission = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { userId, permissionKey } = req.params;

    const perm = await prisma.permission.findFirst({
      where: { company_id, key: permissionKey },
      select: { id: true },
    });
    if (!perm) return res.status(404).json({ message: "Permission not found" });

    await prisma.userPermissionMap.deleteMany({
      where: { company_id, user_id: userId, permission_id: perm.id },
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "USER_PERMISSION_REVOKED",
      entity_type: "user",
      entity_id: userId,
      meta: { permission_key: permissionKey },
    });

    return res.json({ ok: true, revoked: permissionKey });
  } catch (err) {
    console.error("revokeUserPermission error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// POST /admin/roles/:roleId/permissions  Body: { permission_keys: string[] }
exports.grantRolePermissions = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { roleId } = req.params;
    const { permission_keys } = req.body || {};

    if (!Array.isArray(permission_keys) || permission_keys.length === 0) {
      return res.status(400).json({ message: "permission_keys must be a non-empty array" });
    }

    const role = await prisma.role.findFirst({
      where: { id: roleId, company_id, is_active: true },
      select: { id: true },
    });
    if (!role) return res.status(404).json({ message: "Role not found" });

    const perms = await prisma.permission.findMany({
      where: { company_id, key: { in: permission_keys }, is_active: true },
      select: { id: true, key: true },
    });
    if (perms.length !== permission_keys.length) {
      return res.status(404).json({ message: "One or more permission keys not found" });
    }

    await prisma.rolePermissionMap.createMany({
      data: perms.map((p) => ({
        company_id,
        role_id: roleId,
        permission_id: p.id,
        created_by: req.user.id,
      })),
      skipDuplicates: true,
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "ROLE_PERMISSIONS_GRANTED",
      entity_type: "role",
      entity_id: roleId,
      meta: { permission_keys },
    });

    return res.json({ ok: true, granted: permission_keys });
  } catch (err) {
    console.error("grantRolePermissions error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// DELETE /admin/roles/:roleId/permissions/:permissionKey
exports.revokeRolePermission = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { roleId, permissionKey } = req.params;

    const perm = await prisma.permission.findFirst({
      where: { company_id, key: permissionKey },
      select: { id: true },
    });
    if (!perm) return res.status(404).json({ message: "Permission not found" });

    await prisma.rolePermissionMap.deleteMany({
      where: { company_id, role_id: roleId, permission_id: perm.id },
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "ROLE_PERMISSION_REVOKED",
      entity_type: "role",
      entity_id: roleId,
      meta: { permission_key: permissionKey },
    });

    return res.json({ ok: true, revoked: permissionKey });
  } catch (err) {
    console.error("revokeRolePermission error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
