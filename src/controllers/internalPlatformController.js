const bcrypt = require('bcrypt');
const prisma = require('../config/db');
const adminController = require('./adminController');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeColor(value, fallback = '#1F6FEB') {
  const candidate = String(value || '').trim();
  return /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/.test(candidate) ? candidate : fallback;
}

function sanitizeString(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const str = String(value).trim();
  return str.length ? str : fallback;
}

function sanitizeBoolean(value, fallback = undefined) {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizePositiveInt(value, fallback = null) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_ENABLED_MODULES = [
  'dashboard',
  'orders',
  'inventory',
  'production',
  'purchases',
  'clients',
  'products',
  'categories',
  'invoices',
  'payments',
  'accounting',
  'tally',
  'chat',
  'broadcast',
  'messages',
  'factories'
];

const DEFAULT_FEATURE_FLAGS = {
  auto_deduct_inventory_on_dispatch: true,
  keyboard_shortcuts: true,
  simple_mode: true,
  low_stock_suggestions: true,
  order_shortage_warnings: true
};

function normalizeEnabledModules(value, fallback = DEFAULT_ENABLED_MODULES) {
  const allowed = new Set(DEFAULT_ENABLED_MODULES);
  const source = Array.isArray(value) ? value : fallback;
  const modules = source
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item) => allowed.has(item));
  return [...new Set(modules.length ? modules : fallback)];
}

function normalizeFeatureFlags(value, fallback = DEFAULT_FEATURE_FLAGS) {
  const incoming = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const flags = { ...fallback };
  for (const key of Object.keys(DEFAULT_FEATURE_FLAGS)) {
    if (typeof incoming[key] === 'boolean') flags[key] = incoming[key];
  }
  return flags;
}


async function syncSalesCompanies(tx, companyId, salesCompanies = [], companyPayload = {}) {
  const normalized = (Array.isArray(salesCompanies) && salesCompanies.length ? salesCompanies : [{
    name: companyPayload.name,
    legal_name: companyPayload.legal_name || companyPayload.name,
    gstin: companyPayload.gstin,
    phone: companyPayload.phone,
    email: companyPayload.email,
    address: companyPayload.address,
    state: companyPayload.state,
    state_code: companyPayload.state_code,
    is_gst_enabled: companyPayload.is_gst_enabled,
    is_active: true
  }]).map((item) => ({
    name: sanitizeString(item.name),
    legal_name: sanitizeString(item.legal_name),
    gstin: sanitizeString(item.gstin),
    phone: sanitizeString(item.phone),
    email: sanitizeString(item.email),
    address: sanitizeString(item.address),
    state_name: sanitizeString(item.state || item.state_name),
    state_code: sanitizeString(item.state_code),
    is_gst_enabled: typeof item.is_gst_enabled === 'boolean' ? item.is_gst_enabled : sanitizeBoolean(companyPayload.is_gst_enabled, true),
    is_active: item.is_active !== false
  })).filter((item) => item.name);

  if (!normalized.length) {
    throw new Error('At least one sales company is required for tenant provisioning');
  }

  const incomingNames = normalized.map((item) => item.name);
  for (const item of normalized) {
    await tx.salesCompany.upsert({
      where: { company_id_name: { company_id: companyId, name: item.name } },
      update: {
        legal_name: item.legal_name,
        gstin: item.gstin,
        phone: item.phone,
        email: item.email,
        address: item.address,
        state_name: item.state_name,
        state_code: item.state_code,
        is_gst_enabled: item.is_gst_enabled,
        is_active: item.is_active !== false
      },
      create: {
        company_id: companyId,
        name: item.name,
        legal_name: item.legal_name,
        gstin: item.gstin,
        phone: item.phone,
        email: item.email,
        address: item.address,
        state_name: item.state_name,
        state_code: item.state_code,
        is_gst_enabled: item.is_gst_enabled,
        is_active: item.is_active !== false
      }
    });
  }

  await tx.salesCompany.updateMany({
    where: {
      company_id: companyId,
      name: { notIn: incomingNames }
    },
    data: { is_active: false }
  });
}

async function upsertCompanyConfig(tx, companyId, payload = {}) {
  const updateData = {
    platform_last_synced_at: new Date()
  };

  const optionalStringFields = [
    'tenant_slug',
    'app_title',
    'theme_color',
    'logo_url',
    'locale',
    'timezone',
    'invoice_header',
    'invoice_footer',
    'plan_code',
    'billing_cycle',
    'subscription_status'
  ];

  for (const field of optionalStringFields) {
    if (Object.prototype.hasOwnProperty.call(payload, field) && payload[field] !== undefined) {
      updateData[field] = field === 'theme_color'
        ? normalizeColor(payload[field])
        : sanitizeString(payload[field]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'trial_ends_at') && payload.trial_ends_at !== undefined) {
    updateData.trial_ends_at = payload.trial_ends_at ? new Date(payload.trial_ends_at) : null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'active_until') && payload.active_until !== undefined) {
    updateData.active_until = payload.active_until ? new Date(payload.active_until) : null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'seat_limit') && payload.seat_limit !== undefined) {
    updateData.seat_limit = sanitizePositiveInt(payload.seat_limit);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'enabled_modules') && payload.enabled_modules !== undefined) {
    updateData.enabled_modules_json = normalizeEnabledModules(payload.enabled_modules);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'feature_flags') && payload.feature_flags !== undefined) {
    updateData.feature_flags_json = normalizeFeatureFlags(payload.feature_flags);
  }

  return tx.companyPlatformConfig.upsert({
    where: { company_id: companyId },
    update: updateData,
    create: {
      company_id: companyId,
      tenant_slug: sanitizeString(payload.tenant_slug),
      app_title: sanitizeString(payload.app_title, 'UnitFlow'),
      theme_color: normalizeColor(payload.theme_color),
      logo_url: sanitizeString(payload.logo_url),
      locale: sanitizeString(payload.locale, 'en-IN'),
      timezone: sanitizeString(payload.timezone, 'Asia/Kolkata'),
      invoice_header: sanitizeString(payload.invoice_header),
      invoice_footer: sanitizeString(payload.invoice_footer),
      plan_code: sanitizeString(payload.plan_code),
      billing_cycle: sanitizeString(payload.billing_cycle),
      subscription_status: sanitizeString(payload.subscription_status, 'pending'),
      seat_limit: sanitizePositiveInt(payload.seat_limit),
      enabled_modules_json: normalizeEnabledModules(payload.enabled_modules),
      feature_flags_json: normalizeFeatureFlags(payload.feature_flags),
      trial_ends_at: payload.trial_ends_at ? new Date(payload.trial_ends_at) : null,
      active_until: payload.active_until ? new Date(payload.active_until) : null,
      platform_last_synced_at: new Date()
    }
  });
}


const { comparePassword } = require('../utils/password');
const { getUserRoles, getUserPermissionKeys } = require('../services/authSessionService');

function normalizeLoginId(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(text)) return '';
  return text;
}

function resolveRuntimeEmail({ tenantId, email, loginId }) {
  const raw = String(loginId || email || '').trim();
  if (!raw) return '';
  if (raw.includes('@')) return raw.toLowerCase();
  const normalized = normalizeLoginId(raw);
  return normalized ? `${normalized}@${tenantId}.unitflow.local` : '';
}

function publicLoginId(email, companyId) {
  const normalized = String(email || '').trim().toLowerCase();
  const suffix = `@${companyId}.unitflow.local`;
  if (normalized.endsWith(suffix)) return normalized.slice(0, -suffix.length);
  return normalized;
}

exports.authenticateRuntimeUser = async (req, res, next) => {
  try {
    const tenantId = sanitizeString(req.body?.tenant_id || req.body?.company_id);
    const rawEmail = resolveRuntimeEmail({
      tenantId,
      email: req.body?.email,
      loginId: req.body?.login_id || req.body?.identifier || req.body?.username
    });
    const password = String(req.body?.password || '');

    if (!tenantId) {
      return res.status(400).json({ message: 'tenant_id is required' });
    }
    if (!rawEmail || !password) {
      return res.status(400).json({ message: 'login_id and password are required' });
    }

    const user = await prisma.user.findFirst({
      where: {
        company_id: tenantId,
        email: rawEmail,
        status: 'ACTIVE',
        company: { is: { is_active: true } }
      },
      include: {
        company: { select: { id: true, name: true, is_active: true } }
      }
    });

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const [roles, permissionKeys] = await Promise.all([
      getUserRoles(user.company_id, user),
      getUserPermissionKeys(user.company_id, user.id)
    ]);
    const role = user.is_admin ? 'ADMIN' : (roles[0] || 'STAFF');

    return res.json({
      ok: true,
      user: {
        id: user.id,
        company_id: user.company_id,
        email: user.email,
        login_id: publicLoginId(user.email, user.company_id),
        name: user.name,
        is_admin: user.is_admin,
        roles,
        permission_keys: permissionKeys,
        permissions: permissionKeys,
        role
      },
      company: {
        id: user.company.id,
        name: user.company.name,
        is_active: user.company.is_active
      }
    });
  } catch (error) {
    return next(error);
  }
};

function bindPlatformAdmin(req, res, handler) {
  const tenantId = sanitizeString(req.params?.tenantId || req.body?.tenant_id || req.query?.tenant_id);
  if (!tenantId) return res.status(400).json({ message: 'tenant_id is required' });
  req.user = {
    id: sanitizeString(req.body?.actor_user_id || req.query?.actor_user_id),
    company_id: tenantId,
    is_admin: true
  };
  return handler(req, res);
}

exports.listTenantUsers = (req, res) => {
  req.query = { page_size: '100', ...(req.query || {}) };
  return bindPlatformAdmin(req, res, adminController.getUserAssignments);
};

exports.createTenantUser = (req, res) => bindPlatformAdmin(req, res, adminController.createUser);

exports.listTenantRoles = (req, res) => bindPlatformAdmin(req, res, adminController.getRoles);

exports.createTenantRole = (req, res) => bindPlatformAdmin(req, res, adminController.createRole);

exports.assignTenantUserRole = (req, res) => bindPlatformAdmin(req, res, adminController.assignRole);

exports.attachTenantRolePermissions = (req, res) => bindPlatformAdmin(req, res, adminController.grantRolePermissions);

exports.listTenantPermissions = async (req, res, next) => {
  try {
    const tenantId = sanitizeString(req.params?.tenantId);
    if (!tenantId) return res.status(400).json({ message: 'tenant_id is required' });
    const rows = await prisma.permission.findMany({
      where: { company_id: tenantId, is_active: true },
      orderBy: { key: 'asc' },
      select: { id: true, key: true, description: true }
    });
    return res.json(rows.map((row) => ({ id: row.id, key: row.key, name: row.description || row.key })));
  } catch (error) {
    return next(error);
  }
};

exports.provisionTenant = async (req, res, next) => {
  try {
    const {
      tenant_id,
      company = {},
      branding = {},
      locations = [],
      admin_account = {},
      subscription = {},
      sales_companies = []
    } = req.body || {};

    if (!tenant_id) {
      return res.status(400).json({ message: 'tenant_id is required' });
    }
    if (!company.name) {
      return res.status(400).json({ message: 'company.name is required' });
    }
    if (!admin_account.email || (!admin_account.password && !admin_account.password_hash) || !admin_account.name) {
      return res.status(400).json({ message: 'admin_account email, name, and password or password_hash are required' });
    }

    const normalizedAdminEmail = String(admin_account.email).trim().toLowerCase();
    const passwordHash = admin_account.password_hash || (admin_account.password ? await bcrypt.hash(String(admin_account.password), 10) : null);

    const result = await prisma.$transaction(async (tx) => {
      const existingCompany = await tx.company.findUnique({ where: { id: tenant_id } });

      const companyRecord = existingCompany
        ? await tx.company.update({
            where: { id: tenant_id },
            data: {
              name: company.name,
              legal_name: sanitizeString(company.legal_name),
              gstin: sanitizeString(company.gstin),
              phone: sanitizeString(company.phone),
              email: sanitizeString(company.email),
              address: sanitizeString(company.address),
              state: sanitizeString(company.state),
              state_code: sanitizeString(company.state_code),
              is_gst_enabled: sanitizeBoolean(company.is_gst_enabled, true),
              is_active: true
            }
          })
        : await tx.company.create({
            data: {
              id: tenant_id,
              name: company.name,
              legal_name: sanitizeString(company.legal_name),
              gstin: sanitizeString(company.gstin),
              phone: sanitizeString(company.phone),
              email: sanitizeString(company.email),
              address: sanitizeString(company.address),
              state: sanitizeString(company.state),
              state_code: sanitizeString(company.state_code),
              is_gst_enabled: sanitizeBoolean(company.is_gst_enabled, true),
              is_active: true
            }
          });

      await upsertCompanyConfig(tx, companyRecord.id, {
        tenant_slug: sanitizeString(branding.tenant_slug),
        app_title: sanitizeString(branding.app_title, company.name),
        theme_color: normalizeColor(branding.theme_color),
        logo_url: sanitizeString(branding.logo_url),
        locale: sanitizeString(branding.locale, 'en-IN'),
        timezone: sanitizeString(branding.timezone, 'Asia/Kolkata'),
        invoice_header: sanitizeString(branding.invoice_header),
        invoice_footer: sanitizeString(branding.invoice_footer),
        plan_code: sanitizeString(subscription.plan_code),
        billing_cycle: sanitizeString(subscription.billing_cycle),
        subscription_status: sanitizeString(subscription.status, 'active'),
        seat_limit: sanitizePositiveInt(subscription.seat_limit),
        enabled_modules: branding.enabled_modules,
        feature_flags: branding.feature_flags,
        trial_ends_at: subscription.trial_ends_at,
        active_until: subscription.active_until
      });

      await tx.factory.deleteMany({ where: { company_id: companyRecord.id } });
      for (const item of asArray(locations)) {
        await tx.factory.create({
          data: {
            company_id: companyRecord.id,
            name: item.name,
            code: sanitizeString(item.code),
            address: sanitizeString(item.address),
            is_active: item.is_active !== false
          }
        });
      }

      await syncSalesCompanies(tx, companyRecord.id, sales_companies, company);

      const existingUser = await tx.user.findFirst({
        where: {
          company_id: companyRecord.id,
          email: normalizedAdminEmail
        }
      });

      const adminUser = existingUser
        ? await tx.user.update({
            where: { id: existingUser.id },
            data: {
              name: admin_account.name,
              phone: sanitizeString(admin_account.phone),
              password_hash: passwordHash,
              status: 'ACTIVE',
              is_admin: true,
              provider: 'LOCAL'
            }
          })
        : await tx.user.create({
            data: {
              company_id: companyRecord.id,
              email: normalizedAdminEmail,
              phone: sanitizeString(admin_account.phone),
              name: admin_account.name,
              password_hash: passwordHash,
              status: 'ACTIVE',
              is_admin: true,
              provider: 'LOCAL'
            }
          });

      return {
        company_id: companyRecord.id,
        admin_user_id: adminUser.id
      };
    });

    return res.status(201).json({ ok: true, provisioned: true, ...result });
  } catch (error) {
    return next(error);
  }
};

exports.updateTenantStatus = async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { is_active, subscription_status, plan_code, billing_cycle, trial_ends_at, active_until, seat_limit } = req.body || {};

    await prisma.$transaction(async (tx) => {
      if (typeof is_active === 'boolean') {
        await tx.company.update({ where: { id: tenantId }, data: { is_active } });
      }
      await upsertCompanyConfig(tx, tenantId, {
        subscription_status,
        plan_code,
        billing_cycle,
        trial_ends_at,
        active_until,
        seat_limit
      });
    });

    return res.json({ ok: true, tenant_id: tenantId });
  } catch (error) {
    return next(error);
  }
};

exports.syncTenantConfig = async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { company = {}, branding = {}, locations, sales_companies } = req.body || {};

    await prisma.$transaction(async (tx) => {
      if (Object.keys(company).length) {
        await tx.company.update({
          where: { id: tenantId },
          data: {
            name: company.name || undefined,
            legal_name: company.legal_name !== undefined ? sanitizeString(company.legal_name) : undefined,
            gstin: company.gstin !== undefined ? sanitizeString(company.gstin) : undefined,
            phone: company.phone !== undefined ? sanitizeString(company.phone) : undefined,
            email: company.email !== undefined ? sanitizeString(company.email) : undefined,
            address: company.address !== undefined ? sanitizeString(company.address) : undefined,
            state: company.state !== undefined ? sanitizeString(company.state) : undefined,
            state_code: company.state_code !== undefined ? sanitizeString(company.state_code) : undefined,
            is_gst_enabled: company.is_gst_enabled !== undefined ? sanitizeBoolean(company.is_gst_enabled) : undefined
          }
        });
      }

      await upsertCompanyConfig(tx, tenantId, {
        tenant_slug: branding.tenant_slug,
        app_title: branding.app_title,
        theme_color: branding.theme_color,
        logo_url: branding.logo_url,
        locale: branding.locale,
        timezone: branding.timezone,
        invoice_header: branding.invoice_header,
        invoice_footer: branding.invoice_footer,
        plan_code: branding.plan_code,
        billing_cycle: branding.billing_cycle,
        subscription_status: branding.subscription_status,
        enabled_modules: branding.enabled_modules,
        feature_flags: branding.feature_flags,
        trial_ends_at: branding.trial_ends_at,
        active_until: branding.active_until
      });

      if (Array.isArray(locations)) {
        await tx.factory.deleteMany({ where: { company_id: tenantId } });
        for (const item of locations) {
          await tx.factory.create({
            data: {
              company_id: tenantId,
              name: item.name,
              code: sanitizeString(item.code),
              address: sanitizeString(item.address),
              is_active: item.is_active !== false
            }
          });
        }
      }

      if (Array.isArray(sales_companies)) {
        await syncSalesCompanies(tx, tenantId, sales_companies, company);
      }
    });

    return res.json({ ok: true, synced: true, tenant_id: tenantId });
  } catch (error) {
    return next(error);
  }
};

exports.getTenantSnapshot = async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const company = await prisma.company.findUnique({
      where: { id: tenantId },
      include: {
        factories: { select: { id: true, name: true, code: true, address: true, is_active: true } },
        sales_companies: { select: { id: true, name: true, legal_name: true, gstin: true, phone: true, email: true, address: true, state_name: true, state_code: true, is_gst_enabled: true, is_active: true } },
        platform_config: true,
        users: { where: { is_admin: true }, select: { id: true, email: true, name: true, status: true } }
      }
    });

    if (!company) {
      return res.status(404).json({ message: 'Tenant not found in core runtime' });
    }

    const tenant = {
      ...company,
      sales_companies: company.sales_companies.map((item) => ({
        ...item,
        state: item.state_name
      }))
    };

    return res.json({ ok: true, tenant });
  } catch (error) {
    return next(error);
  }
};
