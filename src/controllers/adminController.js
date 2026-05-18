// src/controllers/adminController.js
const prisma = require("../config/db");
const logActivity = require("../utils/activityLogger");
const { hashPassword } = require("../utils/password");
const { getPagination, buildPaginationMeta } = require("../utils/pagination");

// -------------------------
// USERS
// -------------------------

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

    if (!pagination.enabled) return res.json(users);

    return res.json({
      items: users,
      pagination: buildPaginationMeta({ page: pagination.page, page_size: pagination.page_size, total: total ?? users.length })
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
    const { name, email, password, is_admin } = req.body || {};

    if (!name || !String(name).trim())
      return res.status(400).json({ message: "name is required" });
    if (!email || !String(email).trim())
      return res.status(400).json({ message: "email is required" });
    if (!password || String(password).length < 6)
      return res
        .status(400)
        .json({ message: "password must be at least 6 characters" });

    const normEmail = String(email).trim().toLowerCase();

    const exists = await prisma.user.findFirst({
      where: { company_id, email: normEmail },
      select: { id: true },
    });
    if (exists)
      return res.status(409).json({ message: "User with this email already exists" });

    const password_hash = await hashPassword(String(password));

    const created = await prisma.user.create({
      data: {
        company_id,
        name: String(name).trim(),
        email: normEmail,
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
      new_value: { email: created.email, name: created.name, is_admin: created.is_admin },
    });

    return res.status(201).json(created);
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

    if (new_password.length < 6) {
      return res.status(400).json({ message: "new_password must be at least 6 characters" });
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
    });

    return res.json(roles);
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