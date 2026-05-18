// Legacy name kept for backward compatibility with existing route files.
// The project now enforces access via ROLE NAMES (UserRoleMap) instead of
// per-permission DB mappings.

const {
  capabilitiesForRoles,
  requiredCapsFromPermissionKeys,
  hasRequiredCapabilities
} = require("../utils/roleAccess");

// Supports being called as:
//   permissionMiddleware(["orders.view"])
//   permissionMiddleware("admin.access")
module.exports = (required = []) => {
  const requiredCaps = requiredCapsFromPermissionKeys(required);

  return (req, res, next) => {
    try {
      // Admin bypass (both legacy is_admin and role ADMIN)
      if (req.user?.is_admin) return next();

      const roles = req.user?.roles || [];
      const userCaps = capabilitiesForRoles(roles);

      // Allow ADMIN role as global bypass
      if (userCaps.has("ADMIN_ACCESS")) return next();

      if (!hasRequiredCapabilities(userCaps, requiredCaps)) {
        return res.status(403).json({ message: "Access denied" });
      }

      return next();
    } catch (err) {
      console.error("role permissionMiddleware error:", err);
      return res.status(500).json({ message: "Access check failed" });
    }
  };
};
