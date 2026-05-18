const prisma = require("../config/db");
const { orderVisibilityWhere, invoiceVisibilityWhere, paymentVisibilityWhere } = require("../utils/factoryVisibility");
const { resolveDateRangeFromQuery } = require("../utils/fiscalYear");

function toISO(d) {
  return d ? new Date(d).toISOString() : null;
}

// GET /stats?factory_id=...&date_from=...&date_to=...
exports.getCompanyStats = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id_raw = (req.query.factory_id || req.factory_id || "").toString().trim();

    if (!factory_id_raw) {
      return res.status(400).json({ message: "factory_id is required" });
    }

    // Support factory_id=all aggregation
    let factory_ids = null;
    if (["all", "ALL", "*"].includes(factory_id_raw)) {
      if (req.user.is_admin) {
        const rows = await prisma.factory.findMany({
          where: { company_id, is_active: true },
          select: { id: true }
        });
        factory_ids = rows.map((r) => r.id);
      } else {
        const rows = await prisma.userFactoryMap.findMany({
          where: { company_id, user_id: req.user.id },
          select: { factory_id: true }
        });
        factory_ids = rows.map((r) => r.factory_id);
      }

      if (!factory_ids || !factory_ids.length) {
        return res.status(403).json({ message: "No factory access" });
      }

    }


    const scopeReq = factory_ids && factory_ids.length
      ? { factory_ids }
      : { factory_id: factory_id_raw };
    const { date_from, date_to, fiscal_year } = resolveDateRangeFromQuery(req.query);

    const orderWhere = {
      company_id,
      ...orderVisibilityWhere(scopeReq),
      is_active: true,
      ...(date_from || date_to
        ? {
            order_date: {
              ...(date_from ? { gte: date_from } : {}),
              ...(date_to ? { lte: date_to } : {})
            }
          }
        : {})
    };

    const invoiceWhere = {
      company_id,
      ...invoiceVisibilityWhere(scopeReq),
      is_active: true,
      ...(date_from || date_to
        ? {
            issue_date: {
              ...(date_from ? { gte: date_from } : {}),
              ...(date_to ? { lte: date_to } : {})
            }
          }
        : {})
    };

    const paymentWhere = {
      company_id,
      ...paymentVisibilityWhere(scopeReq),
      ...(date_from || date_to
        ? {
            paid_at: {
              ...(date_from ? { gte: date_from } : {}),
              ...(date_to ? { lte: date_to } : {})
            }
          }
        : {})
    };

    // Core aggregates
    const [
      orderAgg,
      invoiceAgg,
      paymentAgg,
      ordersByStatus,
      topClients,
      topProducts,
      invoices
    ] = await Promise.all([
      prisma.order.aggregate({ where: orderWhere, _count: { id: true }, _sum: { total: true } }),
      prisma.invoice.aggregate({ where: invoiceWhere, _count: { id: true }, _sum: { total: true } }),
      prisma.payment.aggregate({ where: paymentWhere, _count: { id: true }, _sum: { amount: true } }),
      prisma.order.groupBy({ by: ["status"], where: orderWhere, _count: { status: true } }),
      prisma.invoice.groupBy({
        by: ["client_id"],
        where: invoiceWhere,
        _sum: { total: true },
        orderBy: { _sum: { total: "desc" } },
        take: 10
      }),
      prisma.invoiceItem.groupBy({
        by: ["product_id"],
        where: {
          company_id,
          invoice: invoiceWhere
        },
        _sum: { line_total: true },
        orderBy: { _sum: { line_total: "desc" } },
        take: 10
      }),
      prisma.invoice.findMany({
        where: invoiceWhere,
        select: { id: true, status: true, total: true }
      })
    ]);

    const invoiceIds = invoices.map((i) => i.id);

    // Allocation sums by invoice_id
    let allocByInvoice = new Map();
    if (invoiceIds.length) {
      const allocGroups = await prisma.paymentAllocation.groupBy({
        by: ["invoice_id"],
        where: {
          company_id,
          is_active: true,
          invoice_id: { in: invoiceIds }
        },
        _sum: { amount: true }
      });
      allocByInvoice = new Map(
        allocGroups.map((g) => [g.invoice_id, Number(g._sum.amount || 0)])
      );
    }

    // Invoice status breakdown including computed balance_due
    const invoiceByStatus = {};
    for (const inv of invoices) {
      const paid = allocByInvoice.get(inv.id) || 0;
      const total = Number(inv.total || 0);
      const balance_due = total - paid;
      const key = inv.status;
      if (!invoiceByStatus[key]) {
        invoiceByStatus[key] = { count: 0, total: 0, paid: 0, balance_due: 0 };
      }
      invoiceByStatus[key].count += 1;
      invoiceByStatus[key].total += total;
      invoiceByStatus[key].paid += paid;
      invoiceByStatus[key].balance_due += balance_due;
    }

    const totalAllocated = [...allocByInvoice.values()].reduce((a, b) => a + b, 0);

    return res.json({
      meta: {
        company_id,
        factory_id: ["all", "ALL", "*"].includes(factory_id_raw) ? "all" : factory_id_raw,
        factory_ids: factory_ids || undefined,
        date_from: toISO(date_from),
        date_to: toISO(date_to),
        fiscal_year: fiscal_year || null
      },
      totals: {
        orders: {
          count: Number(orderAgg?._count?.id || 0),
          total: Number(orderAgg?._sum?.total || 0)
        },
        invoices: {
          count: Number(invoiceAgg?._count?.id || 0),
          total: Number(invoiceAgg?._sum?.total || 0),
          paid_via_allocations: Number(totalAllocated || 0),
          balance_due_estimated: Number((Number(invoiceAgg?._sum?.total || 0) - totalAllocated) || 0)
        },
        payments: {
          count: Number(paymentAgg?._count?.id || 0),
          total: Number(paymentAgg?._sum?.amount || 0)
        }
      },
      breakdowns: {
        orders_by_status: ordersByStatus,
        invoices_by_status: invoiceByStatus
      },
      top: {
        clients_by_invoice_total: topClients,
        products_by_invoice_item_total: topProducts
      }
    });
  } catch (err) {
    console.error("getCompanyStats error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};


// DELETE /stats
// Stats are computed from underlying records and cannot be deleted directly.
exports.deleteStats = async (req, res) => {
  return res.status(400).json({
    message: "Stats are computed from underlying records and cannot be deleted directly. Delete or update the source records instead."
  });
};
