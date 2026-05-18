// src/routes/adminRoutes.js
const express = require("express");
const router = express.Router();

const adminController = require("../controllers/adminController");

// ✅ your actual middleware files (per your screenshot)
const authMod = require("../middlewares/authMiddleware");
const permMod = require("../middlewares/permissionMiddleware");

// -------------------------
// Resolve middleware exports safely
// -------------------------

function pickFn(mod, candidates, label) {
  for (const k of candidates) {
    if (typeof mod?.[k] === "function") return mod[k];
  }
  if (typeof mod === "function") return mod;
  throw new Error(`${label}: could not resolve function export. Available keys: ${Object.keys(mod || {}).join(", ")}`);
}

// Auth middleware is usually exported as `authMiddleware` (or sometimes `requireAuth`)
const requireAuth = pickFn(authMod, ["requireAuth", "authMiddleware", "auth"], "authMiddleware");

// Permission middleware: we need a factory like requirePermission("admin.access")
let requirePermission = null;

// common patterns:
// - module.exports = (key) => (req,res,next)=>{}
// - module.exports.requirePermission = (key) => ...
// - module.exports.permissionMiddleware = (key) => ...
if (typeof permMod === "function") {
  // could be either (req,res,next) OR (key)=>middleware
  // if it's 3-arg style, it won't help us; we need the factory.
  // we detect by arity: factory usually has 1 param, middleware has 3.
  if (permMod.length <= 1) requirePermission = permMod;
} else {
  requirePermission =
    (typeof permMod.requirePermission === "function" && permMod.requirePermission) ||
    (typeof permMod.permissionMiddleware === "function" && permMod.permissionMiddleware) ||
    null;
}

if (typeof requirePermission !== "function") {
  throw new Error(
    `permissionMiddleware: expected a permission factory function (like requirePermission("admin.access")). ` +
      `Exports found: ${Object.keys(permMod || {}).join(", ")}`
  );
}

// -------------------------
// Fail fast if handlers missing
// -------------------------

function assertFn(fn, name) {
  if (typeof fn !== "function") {
    throw new Error(`adminRoutes: handler "${name}" is not a function (got ${typeof fn})`);
  }
}

assertFn(adminController.getUsers, "adminController.getUsers");
assertFn(adminController.getUserAssignments, "adminController.getUserAssignments");
assertFn(adminController.createUser, "adminController.createUser");
assertFn(adminController.disableUser, "adminController.disableUser");
assertFn(adminController.enableUser, "adminController.enableUser");
assertFn(adminController.getOnlineUsers, "adminController.getOnlineUsers");
assertFn(adminController.resetUserPassword, "adminController.resetUserPassword");

assertFn(adminController.getRoles, "adminController.getRoles");
assertFn(adminController.createRole, "adminController.createRole");
assertFn(adminController.deleteRole, "adminController.deleteRole");

assertFn(adminController.assignRole, "adminController.assignRole");
assertFn(adminController.removeRole, "adminController.removeRole");

assertFn(adminController.assignFactory, "adminController.assignFactory");
assertFn(adminController.removeFactory, "adminController.removeFactory");

assertFn(adminController.getUserRoles, "adminController.getUserRoles");
assertFn(adminController.getUserFactories, "adminController.getUserFactories");

assertFn(adminController.grantUserPermissions, "adminController.grantUserPermissions");
assertFn(adminController.revokeUserPermission, "adminController.revokeUserPermission");

assertFn(adminController.grantRolePermissions, "adminController.grantRolePermissions");
assertFn(adminController.revokeRolePermission, "adminController.revokeRolePermission");

// -------------------------
// USERS
// -------------------------

router.get(
  "/users",
  requireAuth,
  requirePermission("admin.access"),
  adminController.getUsers
);

router.get(
  "/users/assignments",
  requireAuth,
  requirePermission("admin.access"),
  adminController.getUserAssignments
);

router.post(
  "/users",
  requireAuth,
  requirePermission("admin.access"),
  adminController.createUser
);

router.put(
  "/users/:userId/disable",
  requireAuth,
  requirePermission("admin.access"),
  adminController.disableUser
);

router.put(
  "/users/:userId/enable",
  requireAuth,
  requirePermission("admin.access"),
  adminController.enableUser
);

router.put(
  "/users/:userId/password",
  requireAuth,
  requirePermission("admin.access"),
  adminController.resetUserPassword
);

router.get(
  "/users/online",
  requireAuth,
  requirePermission("admin.access"),
  adminController.getOnlineUsers
);

// -------------------------
// ROLES
// -------------------------

router.get(
  "/roles",
  requireAuth,
  requirePermission("admin.access"),
  adminController.getRoles
);

router.post(
  "/roles",
  requireAuth,
  requirePermission("admin.access"),
  adminController.createRole
);

router.delete(
  "/roles/:roleId",
  requireAuth,
  requirePermission("admin.access"),
  adminController.deleteRole
);

router.get(
  "/users/:userId/roles",
  requireAuth,
  requirePermission("admin.access"),
  adminController.getUserRoles
);

router.post(
  "/users/:userId/roles",
  requireAuth,
  requirePermission("admin.access"),
  adminController.assignRole
);

router.delete(
  "/users/:userId/roles/:roleId",
  requireAuth,
  requirePermission("admin.access"),
  adminController.removeRole
);

router.post(
  "/roles/:roleId/permissions",
  requireAuth,
  requirePermission("admin.access"),
  adminController.grantRolePermissions
);

router.delete(
  "/roles/:roleId/permissions/:permissionKey",
  requireAuth,
  requirePermission("admin.access"),
  adminController.revokeRolePermission
);

// -------------------------
// FACTORY ACCESS (USER ↔ FACTORY)
// -------------------------

router.get(
  "/users/:userId/factories",
  requireAuth,
  requirePermission("admin.access"),
  adminController.getUserFactories
);

router.post(
  "/users/:userId/factories",
  requireAuth,
  requirePermission("admin.access"),
  adminController.assignFactory
);

router.delete(
  "/users/:userId/factories/:factoryId",
  requireAuth,
  requirePermission("admin.access"),
  adminController.removeFactory
);

// -------------------------
// USER DIRECT PERMISSIONS
// -------------------------

router.post(
  "/users/:userId/permissions",
  requireAuth,
  requirePermission("admin.access"),
  adminController.grantUserPermissions
);

router.delete(
  "/users/:userId/permissions/:permissionKey",
  requireAuth,
  requirePermission("admin.access"),
  adminController.revokeUserPermission
);

module.exports = router;