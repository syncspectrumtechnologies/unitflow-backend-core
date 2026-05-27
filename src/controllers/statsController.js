const prisma = require("../config/db");
const { orderVisibilityWhere, invoiceVisibilityWhere, paymentVisibilityWhere } = require("../utils/factoryVisibility");
const { resolveDateRangeFromQuery } = require("../utils/fiscalYear");

function toISO(d) {
  return d ? new Date(d).toISOString() : null;
}

function toNumber(value) {
  return Number(value || 0);
}

function safePercent(numerator, denominator) {
  const denom = Number(denominator || 0);
  if (!denom) return 0;
  return Number(((Number(numerator || 0) / denom) * 100).toFixed(2));
}

function monthKey(value) {
  const date = new Date(value);
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
}

function buildMonthKeys(startDate, endDate) {
  const keys = [];
  const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));

  while (cursor <= end) {
    keys.push(monthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return keys;
}

function initializeSeries(keys) {
  return keys.map((key) => ({
    month: key,
    label: key,
    value: 0
  }));
}

function accumulateIntoSeries(series, key, amount) {
  const entry = series.find((item) => item.month === key);
  if (entry) entry.value += Number(amount || 0);
}

async function resolveFactoryScope(req, companyId, factoryIdRaw) {
  if (!factoryIdRaw) {
    throw { statusCode: 400, message: "factory_id is required" };
  }

  if (["all", "ALL", "*"].includes(factoryIdRaw)) {
    let rows = [];
    if (req.user.is_admin) {
      rows = await prisma.factory.findMany({
        where: { company_id: companyId, is_active: true },
        select: { id: true, name: true }
      });
    } else {
      rows = await prisma.userFactoryMap.findMany({
        where: { company_id: companyId, user_id: req.user.id },
        include: { factory: { select: { id: true, name: true, is_active: true } } }
      });
      rows = rows.map((row) => row.factory).filter((row) => row?.is_active);
    }

    if (!rows.length) {
      throw { statusCode: 403, message: "No factory access" };
    }

    return {
      requested: "all",
      ids: rows.map((row) => row.id),
      factories: rows.map((row) => ({ id: row.id, name: row.name }))
    };
  }

  const factory = req.user.is_admin
    ? await prisma.factory.findFirst({
        where: { id: factoryIdRaw, company_id: companyId, is_active: true },
        select: { id: true, name: true }
      })
    : await prisma.userFactoryMap.findFirst({
        where: { company_id: companyId, user_id: req.user.id, factory_id: factoryIdRaw },
        include: { factory: { select: { id: true, name: true, is_active: true } } }
      });

  const resolvedFactory = req.user.is_admin ? factory : factory?.factory;
  if (!resolvedFactory?.id || resolvedFactory.is_active === false) {
    throw { statusCode: 403, message: "No factory access" };
  }

  return {
    requested: resolvedFactory.id,
    ids: [resolvedFactory.id],
    factories: [{ id: resolvedFactory.id, name: resolvedFactory.name }]
  };
}

function buildFactoryScopedWhere(companyId, factoryIds, field = "factory_id") {
  return {
    company_id: companyId,
    [field]: factoryIds.length === 1 ? factoryIds[0] : { in: factoryIds }
  };
}

// GET /stats?factory_id=...&date_from=...&date_to=...
exports.getCompanyStats = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const factory_id_raw = (req.query.factory_id || req.factory_id || "").toString().trim();
    const { date_from, date_to, fiscal_year } = resolveDateRangeFromQuery(req.query);
    const now = new Date();

    const factoryScope = await resolveFactoryScope(req, company_id, factory_id_raw);
    const scopeReq = factoryScope.ids.length === 1
      ? { factory_id: factoryScope.ids[0] }
      : { factory_ids: factoryScope.ids };

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

    const productionWhere = {
      ...buildFactoryScopedWhere(company_id, factoryScope.ids),
      ...(date_from || date_to
        ? {
            date: {
              ...(date_from ? { gte: date_from } : {}),
              ...(date_to ? { lte: date_to } : {})
            }
          }
        : {})
    };

    const purchaseWhere = {
      ...buildFactoryScopedWhere(company_id, factoryScope.ids),
      is_active: true,
      ...(date_from || date_to
        ? {
            purchase_date: {
              ...(date_from ? { gte: date_from } : {}),
              ...(date_to ? { lte: date_to } : {})
            }
          }
        : {})
    };

    const inventoryMovementWhere = {
      ...buildFactoryScopedWhere(company_id, factoryScope.ids),
      ...(date_from || date_to
        ? {
            date: {
              ...(date_from ? { gte: date_from } : {}),
              ...(date_to ? { lte: date_to } : {})
            }
          }
        : {})
    };

    const stockBalanceWhere = buildFactoryScopedWhere(company_id, factoryScope.ids);

    const [
      orderAgg,
      invoiceAgg,
      paymentAgg,
      purchaseAgg,
      productionAgg,
      stockAgg,
      ordersByStatus,
      topClientGroups,
      topProductGroups,
      invoices,
      activeClientsCount,
      activeProductsCount,
      stockRows,
      productionByFactory,
      ordersByFactory,
      invoicesByFactory,
      paymentsByFactory,
      purchasesByFactory,
      movementTypeBreakdown
    ] = await Promise.all([
      prisma.order.aggregate({ where: orderWhere, _count: { id: true }, _sum: { total: true } }),
      prisma.invoice.aggregate({ where: invoiceWhere, _count: { id: true }, _sum: { total: true } }),
      prisma.payment.aggregate({ where: paymentWhere, _count: { id: true }, _sum: { amount: true } }),
      prisma.purchase.aggregate({ where: purchaseWhere, _count: { id: true }, _sum: { total: true, paid_amount: true } }),
      prisma.productionLog.aggregate({ where: productionWhere, _count: { id: true }, _sum: { quantity: true } }),
      prisma.stockBalance.aggregate({ where: stockBalanceWhere, _count: { id: true }, _sum: { quantity: true } }),
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
        _sum: { line_total: true, quantity: true },
        orderBy: { _sum: { line_total: "desc" } },
        take: 10
      }),
      prisma.invoice.findMany({
        where: invoiceWhere,
        select: {
          id: true,
          status: true,
          total: true,
          due_date: true,
          issue_date: true,
          client_id: true,
          factory_id: true
        }
      }),
      prisma.client.count({ where: { company_id, is_active: true } }),
      prisma.product.count({ where: { company_id, is_active: true } }),
      prisma.stockBalance.findMany({
        where: stockBalanceWhere,
        include: { product: { select: { id: true, name: true, unit: true, price: true } }, factory: { select: { id: true, name: true } } },
        orderBy: { quantity: "desc" },
        take: 10
      }),
      prisma.productionLog.groupBy({
        by: ["factory_id"],
        where: productionWhere,
        _sum: { quantity: true },
        _count: { id: true }
      }),
      prisma.order.groupBy({
        by: ["factory_id"],
        where: {
          company_id,
          factory_id: factoryScope.ids.length === 1 ? factoryScope.ids[0] : { in: factoryScope.ids },
          is_active: true,
          ...(date_from || date_to
            ? {
                order_date: {
                  ...(date_from ? { gte: date_from } : {}),
                  ...(date_to ? { lte: date_to } : {})
                }
              }
            : {})
        },
        _sum: { total: true },
        _count: { id: true }
      }),
      prisma.invoice.groupBy({
        by: ["factory_id"],
        where: {
          company_id,
          factory_id: factoryScope.ids.length === 1 ? factoryScope.ids[0] : { in: factoryScope.ids },
          is_active: true,
          ...(date_from || date_to
            ? {
                issue_date: {
                  ...(date_from ? { gte: date_from } : {}),
                  ...(date_to ? { lte: date_to } : {})
                }
              }
            : {})
        },
        _sum: { total: true },
        _count: { id: true }
      }),
      prisma.payment.groupBy({
        by: ["factory_id"],
        where: {
          company_id,
          factory_id: factoryScope.ids.length === 1 ? factoryScope.ids[0] : { in: factoryScope.ids },
          ...(date_from || date_to
            ? {
                paid_at: {
                  ...(date_from ? { gte: date_from } : {}),
                  ...(date_to ? { lte: date_to } : {})
                }
              }
            : {})
        },
        _sum: { amount: true },
        _count: { id: true }
      }),
      prisma.purchase.groupBy({
        by: ["factory_id"],
        where: purchaseWhere,
        _sum: { total: true, paid_amount: true },
        _count: { id: true }
      }),
      prisma.inventoryMovement.groupBy({
        by: ["type"],
        where: inventoryMovementWhere,
        _sum: { quantity: true },
        _count: { id: true }
      })
    ]);

    const invoiceIds = invoices.map((invoice) => invoice.id);
    const [allocationGroups, trendOrders, trendInvoices, trendPayments, trendPurchases, trendProduction, clientRows, productRows] = await Promise.all([
      invoiceIds.length
        ? prisma.paymentAllocation.groupBy({
            by: ["invoice_id"],
            where: {
              company_id,
              is_active: true,
              invoice_id: { in: invoiceIds },
              payment: { status: "RECORDED" }
            },
            _sum: { amount: true }
          })
        : Promise.resolve([]),
      prisma.order.findMany({
        where: orderWhere,
        select: { order_date: true, total: true }
      }),
      prisma.invoice.findMany({
        where: invoiceWhere,
        select: { issue_date: true, total: true }
      }),
      prisma.payment.findMany({
        where: paymentWhere,
        select: { paid_at: true, amount: true }
      }),
      prisma.purchase.findMany({
        where: purchaseWhere,
        select: { purchase_date: true, total: true }
      }),
      prisma.productionLog.findMany({
        where: productionWhere,
        select: { date: true, quantity: true }
      }),
      topClientGroups.length
        ? prisma.client.findMany({
            where: { id: { in: topClientGroups.map((row) => row.client_id) } },
            select: { id: true, company_name: true }
          })
        : Promise.resolve([]),
      topProductGroups.length
        ? prisma.product.findMany({
            where: { id: { in: topProductGroups.map((row) => row.product_id) } },
            select: { id: true, name: true, unit: true }
          })
        : Promise.resolve([])
    ]);

    const allocationByInvoice = new Map(
      allocationGroups.map((group) => [group.invoice_id, toNumber(group._sum.amount)])
    );
    const clientNameById = new Map(clientRows.map((row) => [row.id, row.company_name]));
    const productById = new Map(productRows.map((row) => [row.id, row]));

    const invoiceByStatus = {};
    const receivableInvoices = [];
    for (const invoice of invoices) {
      const paid = allocationByInvoice.get(invoice.id) || 0;
      const total = toNumber(invoice.total);
      const balance_due = total - paid;
      const statusKey = invoice.status;
      if (!invoiceByStatus[statusKey]) {
        invoiceByStatus[statusKey] = { count: 0, total: 0, paid: 0, balance_due: 0 };
      }
      invoiceByStatus[statusKey].count += 1;
      invoiceByStatus[statusKey].total += total;
      invoiceByStatus[statusKey].paid += paid;
      invoiceByStatus[statusKey].balance_due += balance_due;

      if (balance_due > 0) {
        const overdueDays = invoice.due_date
          ? Math.max(0, Math.floor((now.getTime() - new Date(invoice.due_date).getTime()) / (24 * 60 * 60 * 1000)))
          : 0;
        receivableInvoices.push({
          ...invoice,
          paid,
          balance_due,
          overdue_days: overdueDays
        });
      }
    }

    const totalAllocated = [...allocationByInvoice.values()].reduce((sum, amount) => sum + Number(amount || 0), 0);
    const overdueReceivables = receivableInvoices.filter((invoice) => invoice.overdue_days > 0);
    const aging = {
      current: { count: 0, amount: 0 },
      due_1_30_days: { count: 0, amount: 0 },
      due_31_60_days: { count: 0, amount: 0 },
      due_61_90_days: { count: 0, amount: 0 },
      due_90_plus_days: { count: 0, amount: 0 }
    };

    for (const invoice of receivableInvoices) {
      const amount = invoice.balance_due;
      if (!invoice.overdue_days) {
        aging.current.count += 1;
        aging.current.amount += amount;
      } else if (invoice.overdue_days <= 30) {
        aging.due_1_30_days.count += 1;
        aging.due_1_30_days.amount += amount;
      } else if (invoice.overdue_days <= 60) {
        aging.due_31_60_days.count += 1;
        aging.due_31_60_days.amount += amount;
      } else if (invoice.overdue_days <= 90) {
        aging.due_61_90_days.count += 1;
        aging.due_61_90_days.amount += amount;
      } else {
        aging.due_90_plus_days.count += 1;
        aging.due_90_plus_days.amount += amount;
      }
    }

    const trendStart = date_from || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
    const trendEnd = date_to || now;
    const trendKeys = buildMonthKeys(trendStart, trendEnd);
    const salesSeries = initializeSeries(trendKeys);
    const invoiceSeries = initializeSeries(trendKeys);
    const collectionsSeries = initializeSeries(trendKeys);
    const purchaseSeries = initializeSeries(trendKeys);
    const productionSeries = initializeSeries(trendKeys);

    trendOrders.forEach((row) => accumulateIntoSeries(salesSeries, monthKey(row.order_date), row.total));
    trendInvoices.forEach((row) => accumulateIntoSeries(invoiceSeries, monthKey(row.issue_date), row.total));
    trendPayments.forEach((row) => accumulateIntoSeries(collectionsSeries, monthKey(row.paid_at), row.amount));
    trendPurchases.forEach((row) => accumulateIntoSeries(purchaseSeries, monthKey(row.purchase_date), row.total));
    trendProduction.forEach((row) => accumulateIntoSeries(productionSeries, monthKey(row.date), row.quantity));

    const factoryMetricMap = new Map(factoryScope.factories.map((factory) => [factory.id, {
      factory_id: factory.id,
      factory_name: factory.name,
      orders_count: 0,
      orders_total: 0,
      invoices_count: 0,
      invoices_total: 0,
      collections_count: 0,
      collections_total: 0,
      production_entries: 0,
      production_quantity: 0,
      purchases_count: 0,
      purchases_total: 0,
      purchase_paid_total: 0
    }]));

    for (const row of ordersByFactory) {
      const entry = factoryMetricMap.get(row.factory_id);
      if (!entry) continue;
      entry.orders_count = Number(row._count.id || 0);
      entry.orders_total = toNumber(row._sum.total);
    }
    for (const row of invoicesByFactory) {
      const entry = factoryMetricMap.get(row.factory_id);
      if (!entry) continue;
      entry.invoices_count = Number(row._count.id || 0);
      entry.invoices_total = toNumber(row._sum.total);
    }
    for (const row of paymentsByFactory) {
      const entry = factoryMetricMap.get(row.factory_id);
      if (!entry) continue;
      entry.collections_count = Number(row._count.id || 0);
      entry.collections_total = toNumber(row._sum.amount);
    }
    for (const row of productionByFactory) {
      const entry = factoryMetricMap.get(row.factory_id);
      if (!entry) continue;
      entry.production_entries = Number(row._count.id || 0);
      entry.production_quantity = toNumber(row._sum.quantity);
    }
    for (const row of purchasesByFactory) {
      const entry = factoryMetricMap.get(row.factory_id);
      if (!entry) continue;
      entry.purchases_count = Number(row._count.id || 0);
      entry.purchases_total = toNumber(row._sum.total);
      entry.purchase_paid_total = toNumber(row._sum.paid_amount);
    }

    const topClients = topClientGroups.map((row) => ({
      client_id: row.client_id,
      client_name: clientNameById.get(row.client_id) || "Unknown Client",
      total: toNumber(row._sum.total)
    }));

    const topProducts = topProductGroups.map((row) => ({
      product_id: row.product_id,
      product_name: productById.get(row.product_id)?.name || "Unknown Product",
      unit: productById.get(row.product_id)?.unit || null,
      total: toNumber(row._sum.line_total),
      quantity: toNumber(row._sum.quantity)
    }));

    const currentStockUnits = toNumber(stockAgg?._sum?.quantity);
    const lowOrNegativeStockCount = await prisma.stockBalance.count({
      where: {
        ...stockBalanceWhere,
        quantity: { lte: 0 }
      }
    });

    return res.json({
      meta: {
        company_id,
        factory_id: factoryScope.requested,
        factory_ids: factoryScope.ids,
        factories: factoryScope.factories,
        date_from: toISO(date_from),
        date_to: toISO(date_to),
        fiscal_year: fiscal_year || null
      },
      totals: {
        orders: {
          count: Number(orderAgg?._count?.id || 0),
          total: toNumber(orderAgg?._sum?.total)
        },
        invoices: {
          count: Number(invoiceAgg?._count?.id || 0),
          total: toNumber(invoiceAgg?._sum?.total),
          paid_via_allocations: Number(totalAllocated || 0),
          balance_due_estimated: Number((toNumber(invoiceAgg?._sum?.total) - totalAllocated) || 0)
        },
        payments: {
          count: Number(paymentAgg?._count?.id || 0),
          total: toNumber(paymentAgg?._sum?.amount)
        }
      },
      breakdowns: {
        orders_by_status: ordersByStatus,
        invoices_by_status: invoiceByStatus
      },
      top: {
        clients_by_invoice_total: topClients,
        products_by_invoice_item_total: topProducts
      },
      overview: {
        active_clients_count: activeClientsCount,
        active_products_count: activeProductsCount,
        order_count: Number(orderAgg?._count?.id || 0),
        sales_total: toNumber(orderAgg?._sum?.total),
        invoice_total: toNumber(invoiceAgg?._sum?.total),
        collections_total: toNumber(paymentAgg?._sum?.amount),
        purchases_total: toNumber(purchaseAgg?._sum?.total),
        purchases_paid_total: toNumber(purchaseAgg?._sum?.paid_amount),
        production_quantity_total: toNumber(productionAgg?._sum?.quantity),
        current_stock_units: currentStockUnits,
        overdue_receivables_total: overdueReceivables.reduce((sum, row) => sum + row.balance_due, 0)
      },
      health: {
        collection_efficiency_pct: safePercent(totalAllocated, invoiceAgg?._sum?.total),
        invoice_to_order_ratio_pct: safePercent(invoiceAgg?._count?.id, orderAgg?._count?.id),
        overdue_invoice_count: overdueReceivables.length,
        low_or_negative_stock_count: lowOrNegativeStockCount
      },
      receivables: {
        outstanding_total: receivableInvoices.reduce((sum, row) => sum + row.balance_due, 0),
        overdue_total: overdueReceivables.reduce((sum, row) => sum + row.balance_due, 0),
        overdue_count: overdueReceivables.length,
        aging,
        top_overdue_invoices: overdueReceivables
          .sort((a, b) => b.balance_due - a.balance_due)
          .slice(0, 10)
          .map((row) => ({
            invoice_id: row.id,
            client_id: row.client_id,
            client_name: clientNameById.get(row.client_id) || "Unknown Client",
            balance_due: row.balance_due,
            overdue_days: row.overdue_days,
            due_date: row.due_date,
            issue_date: row.issue_date
          }))
      },
      inventory: {
        current_stock_units: currentStockUnits,
        sku_count_in_stock: Number(stockAgg?._count?.id || 0),
        low_or_negative_stock_count: lowOrNegativeStockCount,
        stock_snapshot: stockRows.map((row) => ({
          product_id: row.product.id,
          product_name: row.product.name,
          unit: row.product.unit,
          factory_id: row.factory.id,
          factory_name: row.factory.name,
          quantity: toNumber(row.quantity),
          default_price: toNumber(row.product.price)
        })),
        movement_breakdown: movementTypeBreakdown.map((row) => ({
          type: row.type,
          entries: Number(row._count.id || 0),
          quantity: toNumber(row._sum.quantity)
        }))
      },
      production: {
        entry_count: Number(productionAgg?._count?.id || 0),
        quantity_total: toNumber(productionAgg?._sum?.quantity),
        by_factory: productionByFactory.map((row) => ({
          factory_id: row.factory_id,
          factory_name: factoryMetricMap.get(row.factory_id)?.factory_name || row.factory_id,
          entries: Number(row._count.id || 0),
          quantity: toNumber(row._sum.quantity)
        }))
      },
      purchases: {
        purchase_count: Number(purchaseAgg?._count?.id || 0),
        total: toNumber(purchaseAgg?._sum?.total),
        paid_total: toNumber(purchaseAgg?._sum?.paid_amount),
        unpaid_total: Math.max(toNumber(purchaseAgg?._sum?.total) - toNumber(purchaseAgg?._sum?.paid_amount), 0)
      },
      factories: {
        summary: [...factoryMetricMap.values()]
      },
      trends: {
        sales: salesSeries,
        invoicing: invoiceSeries,
        collections: collectionsSeries,
        purchases: purchaseSeries,
        production: productionSeries
      },
      explainers: [
        {
          key: "collections_total",
          label: "Money received from customers",
          description: "This shows the amount already collected against customer bills."
        },
        {
          key: "outstanding_total",
          label: "Money customers still owe",
          description: "This is the unpaid value left on invoices after recorded collections."
        },
        {
          key: "current_stock_units",
          label: "Current stock on hand",
          description: "This is the current item quantity available across the selected factory scope."
        }
      ]
    });
  } catch (err) {
    const statusCode = err?.statusCode || 500;
    if (statusCode >= 500) {
      console.error("getCompanyStats error:", err);
    }
    return res.status(statusCode).json({ message: err?.message || "Internal server error" });
  }
};

// DELETE /stats
// Stats are computed from underlying records and cannot be deleted directly.
exports.deleteStats = async (_req, res) => {
  return res.status(400).json({
    message: "Stats are computed from underlying records and cannot be deleted directly. Delete or update the source records instead."
  });
};
