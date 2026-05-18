const prisma = require("../config/db");

exports.getPermissions = async (req, res) => {
  const mappings = await prisma.userRoleMap.findMany({
    where: {
      company_id: req.user.company_id
    },
    include: {
      user: { select: { email: true } },
      role: { select: { name: true } }
    }
  });

  const result = mappings.map(m => ({
    id: m.id,
    user_name: m.user.email,
    role: m.role.name
  }));

  res.json(result);
};
