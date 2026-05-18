const prisma = require("../config/db");

exports.userHasPermission = async (userId, permissionKey) => {
  const roles = await prisma.userRoleMap.findMany({
    where: { user_id: userId },
    include: { role: true }
  });

  if (!roles.length) return false;

  const permissions = await prisma.permission.findMany({
    where: {
      key: permissionKey,
      company_id: roles[0].company_id
    }
  });

  return permissions.length > 0;
};
