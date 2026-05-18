const prisma = require("../config/db");

// GET /sales-companies
// Lists legal entities / billing companies configured for this tenant.
// Note: There is intentionally no public "create" endpoint; these are added by backend ops.
exports.getSalesCompanies = async (req, res) => {
  try {
    const company_id = req.user.company_id;

    const rows = await prisma.salesCompany.findMany({
      where: { company_id, is_active: true },
      orderBy: { name: "asc" }
    });

    return res.json({ count: rows.length, rows });
  } catch (err) {
    console.error("getSalesCompanies error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
