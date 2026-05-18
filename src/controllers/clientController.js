const prisma = require("../config/db");
const logActivity = require("../utils/activityLogger");
const { factoryWhere } = require("../utils/factoryScope");
const { orderVisibilityWhere } = require("../utils/factoryVisibility");
const { PassThrough } = require("stream");
const PDFDocument = require("pdfkit");
const { generateClientLetterPdfToStream, renderClientLetterPage } = require("../services/pdf/clientLetterPdf");
const { generateClientSlipPdfToStream, getClientSlipData, addClientSlipPage } = require("../services/pdf/clientSlipPdf");
const { logQueued, sendTransactionalEmail } = require("../services/messageDispatchService");
const { getPagination, buildPaginationMeta } = require("../utils/pagination");
const { resolveSender, getRequestedSenderKey } = require("../services/messageSenderService");
const {
  normalizeString: normalizeAdvanceString,
  parseDateOrNull: parseAdvanceDateOrNull,
  listPurchaseAdvancesTx,
  createPurchaseAdvanceTx,
  reversePurchaseAdvanceTx,
  getPurchaseAdvanceSummaryTx,
  getSalesAdvanceSummaryTx,
  autoAllocatePurchaseBalancesForClientTx,
  getPurchaseNoteEffectByIdsTx,
  toNumber: toAdvanceNumber
} = require("../services/clientAdvanceService");


function getDefaultLetterBody(title) {
  return (
    "Date: {{today}}\n\nTo,\n{{client_company}}\n{{client_address}}\n{{client_city}}, {{client_state}} {{client_pincode}}\n\nSubject: " +
    (title || "") +
    "\n\nDear {{client_name}},\n\n" +
    "(Write your content here...)\n\n" +
    "Sincerely,\n"
  );
}

function buildClientLetterCtx(client) {
  const primaryContact = Array.isArray(client.contacts) ? client.contacts[0] : null;
  return {
    client_company: client.company_name,
    client_name: primaryContact?.name || client.company_name,
    client_address: client.address || "",
    client_city: client.city || "",
    client_state: client.state || "",
    client_pincode: client.pincode || "",
    client_phone: primaryContact?.phone || client.phone || "",
    client_email: primaryContact?.email || client.email || ""
  };
}

async function loadActiveClientsByIds(company_id, clientIds, { includeContacts = false } = {}) {
  const ids = Array.isArray(clientIds) ? clientIds : [];
  const uniqueIds = [...new Set(ids.map((v) => String(v || '').trim()).filter(Boolean))];
  if (!uniqueIds.length) {
    const err = new Error('CLIENT_IDS_REQUIRED');
    err.statusCode = 400;
    throw err;
  }

  const clients = await prisma.client.findMany({
    where: { company_id, id: { in: uniqueIds }, is_active: true },
    include: includeContacts ? { contacts: { where: { is_active: true }, orderBy: { created_at: 'asc' } } } : undefined,
    orderBy: { company_name: 'asc' }
  });
  if (clients.length !== uniqueIds.length) {
    const found = new Set(clients.map((c) => c.id));
    const missing = uniqueIds.filter((id) => !found.has(id));
    const err = new Error('CLIENT_NOT_FOUND');
    err.statusCode = 404;
    err.meta = { missing_client_ids: missing };
    throw err;
  }
  const byId = new Map(clients.map((c) => [c.id, c]));
  return uniqueIds.map((id) => byId.get(id));
}

exports.createClient = async (req, res) => {
  try {
    const company_id = req.user.company_id;

    const {
      company_name,
      gstin,
      registration_type,
      pan_it_no,
      phone,
      mobile_no,
      email,
      address,
      city,
      state,
      country,
      pincode,
      opening_balance_amount,
      opening_balance_type,
      opening_balance_date
    } = req.body;

    if (!company_name) {
      return res.status(400).json({ message: "company_name is required" });
    }

    const existing = await prisma.client.findFirst({
      where: {
        company_id,
        company_name: company_name.trim(),
        is_active: true
      }
    });

    if (existing) {
      return res.status(409).json({ message: "Client already exists" });
    }

    const client = await prisma.client.create({
      data: {
        company_id,
        company_name: company_name.trim(),
        gstin: gstin?.trim() || null,
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        address: address?.trim() || null,
        city: city?.trim() || null,
        state: state?.trim() || null,
        pincode: pincode?.trim() || null,
        registration_type: registration_type?.trim() || null,
        pan_it_no: pan_it_no?.trim() || null,
        mobile_no: mobile_no?.trim() || null,
        country: country?.trim() || null,
        opening_balance_amount: opening_balance_amount !== undefined && opening_balance_amount !== null ? Number(opening_balance_amount) : 0,
        opening_balance_type: opening_balance_type || "DEBIT",
        opening_balance_date: opening_balance_date ? new Date(opening_balance_date) : null,
        is_active: true
      }
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "CLIENT_CREATED",
      entity_type: "client",
      entity_id: client.id,
      new_value: client,
      ip: req.ip,
      user_agent: req.headers["user-agent"]
    });

    return res.status(201).json(client);
  } catch (err) {
    console.error("createClient error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getClients = async (req, res) => {
  try {
    const company_id = req.user.company_id;

    const q = (req.query.q || "").toString().trim();
    const product_id = (req.query.product_id || "").toString().trim();
    const category_id = (req.query.category_id || "").toString().trim();

    const where = { company_id, is_active: true };

    if (q) {
      where.OR = [
        { company_name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { mobile_no: { contains: q, mode: "insensitive" } },
        { registration_type: { contains: q, mode: "insensitive" } },
        { pan_it_no: { contains: q, mode: "insensitive" } },
        { country: { contains: q, mode: "insensitive" } },
        { gstin: { contains: q, mode: "insensitive" } }
      ];
    }

    // Filter clients by linked products and/or categories.
    if (product_id) {
      where.products = {
        some: {
          is_active: true,
          product_id
        }
      };
    }

    if (category_id) {
      where.categories = {
        some: {
          is_active: true,
          category_id
        }
      };
    }

    const pagination = getPagination(req, { defaultPageSize: 25, maxPageSize: 100 });
    const query = {
      where,
      orderBy: [{ updated_at: "desc" }, { id: "desc" }],
      select: {
        id: true,
        company_name: true,
        gstin: true,
        registration_type: true,
        pan_it_no: true,
        phone: true,
        mobile_no: true,
        email: true,
        address: true,
        city: true,
        state: true,
        country: true,
        pincode: true,
        opening_balance_amount: true,
        opening_balance_type: true,
        opening_balance_date: true,
        is_active: true,
        created_at: true,
        updated_at: true,
        _count: {
          select: { contacts: true, products: true, categories: true, orders: true, invoices: true, purchases: true }
        }
      }
    };
    if (pagination.enabled) {
      query.skip = pagination.skip;
      query.take = pagination.take;
    }

    const [clients, total] = await Promise.all([
      prisma.client.findMany(query),
      pagination.enabled && pagination.include_total ? prisma.client.count({ where }) : Promise.resolve(null)
    ]);

    if (!pagination.enabled) return res.json(clients);

    return res.json({
      items: clients,
      pagination: buildPaginationMeta({ page: pagination.page, page_size: pagination.page_size, total: total ?? clients.length })
    });
  } catch (err) {
    console.error("getClients error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};


exports.searchClientOptions = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const q = (req.query.q || "").toString().trim();
    const rawLimit = Number(req.query.limit || 100);
    const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 100, 100));

    const where = { company_id, is_active: true };
    if (q) {
      where.OR = [
        { company_name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
        { mobile_no: { contains: q, mode: "insensitive" } },
        { gstin: { contains: q, mode: "insensitive" } }
      ];
    }

    const rows = await prisma.client.findMany({
      where,
      select: {
        id: true,
        company_name: true
      },
      orderBy: q ? [{ company_name: "asc" }, { id: "asc" }] : [{ updated_at: "desc" }, { id: "desc" }],
      take: limit + 1
    });

    return res.json({
      items: rows.slice(0, limit),
      q,
      limit,
      has_more: rows.length > limit
    });
  } catch (err) {
    console.error("searchClientOptions error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getClientById = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId } = req.params;

    const client = await prisma.client.findFirst({
      where: { id: clientId, company_id },
      include: {
        contacts: {
          orderBy: { updated_at: "desc" }
        },
        products: {
          where: { is_active: true },
          include: {
            product: {
              select: {
                id: true,
                name: true,
                unit: true,
                pack_size: true,
                category: { select: { id: true, name: true } }
              }
            }
          }
        },
        categories: {
          where: { is_active: true },
          include: {
            category: {
              select: { id: true, name: true, description: true, is_active: true }
            }
          }
        },
        orders: {
          orderBy: { created_at: "desc" },
          take: 25,
          select: {
            id: true,
            order_no: true,
            status: true,
            order_date: true,
            total: true,
            factory_id: true
          }
        },
        invoices: {
          orderBy: { created_at: "desc" },
          take: 25,
          select: {
            id: true,
            invoice_no: true,
            kind: true,
            status: true,
            issue_date: true,
            total: true,
            factory_id: true
          }
        },
        purchases: {
          orderBy: { created_at: "desc" },
          take: 25,
          select: {
            id: true,
            purchase_no: true,
            status: true,
            purchase_date: true,
            total: true,
            paid_amount: true,
            factory_id: true
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    return res.json(client);
  } catch (err) {
    console.error("getClientById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.updateClient = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId } = req.params;

    const existing = await prisma.client.findFirst({
      where: { id: clientId, company_id }
    });

    if (!existing) {
      return res.status(404).json({ message: "Client not found" });
    }

    const {
      company_name,
      gstin,
      registration_type,
      pan_it_no,
      phone,
      mobile_no,
      email,
      address,
      city,
      state,
      country,
      pincode,
      opening_balance_amount,
      opening_balance_type,
      opening_balance_date,
      is_active
    } = req.body;

    if (company_name && company_name.trim().length === 0) {
      return res.status(400).json({ message: "company_name cannot be empty" });
    }

    // if company_name changed, ensure uniqueness
    if (company_name && company_name.trim() !== existing.company_name) {
      const dup = await prisma.client.findFirst({
        where: {
          company_id,
          company_name: company_name.trim(),
          id: { not: clientId }
        }
      });
      if (dup) {
        return res.status(409).json({ message: "Another client with same name exists" });
      }
    }

    const updated = await prisma.client.update({
      where: { id: clientId },
      data: {
        company_name: company_name ? company_name.trim() : undefined,
        gstin: gstin !== undefined ? (gstin?.trim() || null) : undefined,
        phone: phone !== undefined ? (phone?.trim() || null) : undefined,
        email: email !== undefined ? (email?.trim() || null) : undefined,
        address: address !== undefined ? (address?.trim() || null) : undefined,
        city: city !== undefined ? (city?.trim() || null) : undefined,
        state: state !== undefined ? (state?.trim() || null) : undefined,
        pincode: pincode !== undefined ? (pincode?.trim() || null) : undefined,
        is_active: typeof is_active === "boolean" ? is_active : undefined,
        registration_type: registration_type !== undefined ? (registration_type?.trim() || null) : undefined,
        pan_it_no: pan_it_no !== undefined ? (pan_it_no?.trim() || null) : undefined,
        mobile_no: mobile_no !== undefined ? (mobile_no?.trim() || null) : undefined,
        country: country !== undefined ? (country?.trim() || null) : undefined,
        opening_balance_amount: opening_balance_amount !== undefined ? Number(opening_balance_amount || 0) : undefined,
        opening_balance_type: opening_balance_type !== undefined ? (opening_balance_type || "DEBIT") : undefined,
        opening_balance_date: opening_balance_date !== undefined ? (opening_balance_date ? new Date(opening_balance_date) : null) : undefined
      }
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "CLIENT_UPDATED",
      entity_type: "client",
      entity_id: clientId,
      old_value: existing,
      new_value: updated,
      ip: req.ip,
      user_agent: req.headers["user-agent"]
    });

    return res.json(updated);
  } catch (err) {
    console.error("updateClient error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.deleteClient = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId } = req.params;

    const existing = await prisma.client.findFirst({
      where: { id: clientId, company_id }
    });

    if (!existing) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Soft delete
    const updated = await prisma.client.update({
      where: { id: clientId },
      data: { is_active: false }
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "CLIENT_DELETED",
      entity_type: "client",
      entity_id: clientId,
      old_value: { is_active: existing.is_active },
      new_value: { is_active: false },
      ip: req.ip,
      user_agent: req.headers["user-agent"]
    });

    return res.json({ message: "Client disabled (soft deleted)" });
  } catch (err) {
    console.error("deleteClient error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getClientProducts = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId } = req.params;

    const client = await prisma.client.findFirst({
      where: { id: clientId, company_id, is_active: true },
      select: { id: true }
    });

    if (!client) return res.status(404).json({ message: "Client not found" });

    const products = await prisma.clientProduct.findMany({
      where: { company_id, client_id: clientId, is_active: true },
      orderBy: { updated_at: "desc" },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            unit: true,
            pack_size: true,
            sku: true,
            category: { select: { id: true, name: true } }
          }
        }
      }
    });

    return res.json(products);
  } catch (err) {
    console.error("getClientProducts error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// GET /clients/:clientId/orders
// Returns complete order history for a client (factory-scoped view) including items, charges and linked invoices.
exports.getClientOrderHistory = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const fw = orderVisibilityWhere(req);
    // factoryAccessMiddleware guarantees a factory scope (single or ALL) for this endpoint.
    const { clientId } = req.params;

    const client = await prisma.client.findFirst({
      where: { id: clientId, company_id, is_active: true },
      select: { id: true, company_name: true }
    });
    if (!client) return res.status(404).json({ message: "Client not found" });

    const orders = await prisma.order.findMany({
      where: { company_id, ...fw, client_id: clientId, is_active: true },
      orderBy: { order_date: "desc" },
      include: {
        items: true,
        charges: true,
        status_history: { orderBy: { created_at: "asc" } },
        factory: { select: { id: true, name: true } },
        invoices: {
          where: { is_active: true },
          include: {
            items: true,
            charges: true,
            status_history: { orderBy: { created_at: "asc" } }
          }
        }
      }
    });

    const purchases = await prisma.purchase.findMany({
      where: { company_id, client_id: clientId, is_active: true, ...(fw.factory_id ? { factory_id: fw.factory_id } : {}) },
      orderBy: { purchase_date: "desc" },
      include: {
        items: true,
        charges: true,
        timeline: { orderBy: { created_at: "asc" } },
        factory: { select: { id: true, name: true } }
      }
    });

    return res.json({ client, count: orders.length, orders, purchase_count: purchases.length, purchases });
  } catch (err) {
    console.error("getClientOrderHistory error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// GET /clients/inactive?days=45
// Lists clients (company-wide) with no orders in the given period (factory optional via ?factory_id).
exports.getInactiveClients = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const days = Math.max(1, Number(req.query.days || 45));
    const factory_id = (req.query.factory_id || "").toString().trim() || null;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const pagination = getPagination(req, { defaultPageSize: 25, maxPageSize: 100 });

    const clients = await prisma.client.findMany({
      where: { company_id, is_active: true },
      select: { id: true, company_name: true, email: true, phone: true }
    });

    const ordersWhere = {
      company_id,
      is_active: true,
      ...(factory_id ? orderVisibilityWhere({ factory_id }) : {})
    };

    const lastOrderDates = await prisma.order.groupBy({
      by: ["client_id"],
      where: ordersWhere,
      _max: { order_date: true }
    });

    const lastOrderMap = new Map(lastOrderDates.map((row) => [row.client_id, row._max.order_date]));

    const lastOrderRows = lastOrderDates.length
      ? await prisma.order.findMany({
          where: {
            company_id,
            is_active: true,
            client_id: { in: lastOrderDates.map((row) => row.client_id) }
          },
          distinct: ["client_id"],
          orderBy: [{ client_id: "asc" }, { order_date: "desc" }],
          select: { client_id: true, order_date: true, order_no: true, factory_id: true }
        })
      : [];

    const lastOrderDetailMap = new Map(lastOrderRows.map((row) => [row.client_id, row]));

    const results = clients
      .map((c) => {
        const lastDate = lastOrderMap.get(c.id) || null;
        if (lastDate && new Date(lastDate) >= cutoff) return null;
        const lastOrder = lastOrderDetailMap.get(c.id) || null;
        const daysSince = lastDate ? Math.floor((Date.now() - new Date(lastDate).getTime()) / (24 * 3600 * 1000)) : null;
        return {
          client_id: c.id,
          company_name: c.company_name,
          last_order_date: lastDate,
          last_order_no: lastOrder?.order_no || null,
          last_order_factory_id: lastOrder?.factory_id || null,
          days_since_last_order: daysSince,
          eligible: true
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const aTime = a.last_order_date ? new Date(a.last_order_date).getTime() : 0;
        const bTime = b.last_order_date ? new Date(b.last_order_date).getTime() : 0;
        return aTime - bTime;
      });

    if (!pagination.enabled) {
      return res.json({ days, factory_id, count: results.length, clients: results });
    }

    const startIdx = pagination.skip;
    const items = results.slice(startIdx, startIdx + pagination.take);
    return res.json({
      days,
      factory_id,
      count: results.length,
      clients: items,
      pagination: buildPaginationMeta({ page: pagination.page, page_size: pagination.page_size, total: results.length })
    });
  } catch (err) {
    console.error("getInactiveClients error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// POST /clients/:clientId/re-engage
// If no orders in last 45 days, generates (and optionally sends) a draft email.
exports.reEngageClient = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId } = req.params;
    const { send = false, subject, message, to_email } = req.body || {};
    const sender = resolveSender("EMAIL", getRequestedSenderKey(req.body, "EMAIL"));

    const client = await prisma.client.findFirst({
      where: { id: clientId, company_id, is_active: true },
      include: {
        contacts: { where: { is_active: true }, orderBy: { created_at: "asc" } },
        orders: { orderBy: { order_date: "desc" }, take: 1, select: { order_date: true, order_no: true } }
      }
    });
    if (!client) return res.status(404).json({ message: "Client not found" });

    const lastOrderDate = client.orders?.[0]?.order_date || null;
    const daysSince = lastOrderDate ? Math.floor((Date.now() - new Date(lastOrderDate).getTime()) / (24 * 3600 * 1000)) : null;
    const eligible = !lastOrderDate || daysSince >= 45;

    const draftedSubject = subject || `Quick check-in - ${process.env.BRAND_NAME || "Babanamak"}`;
    const draftedMessage =
      message ||
      `Hello ${client.company_name},\n\nWe noticed we haven't received an order from you in the last ${daysSince ?? "few"} days.` +
        `${lastOrderDate ? ` Your last order was on ${new Date(lastOrderDate).toLocaleDateString()}.` : ""}` +
        "\n\nIf you need any assistance, updated pricing, or want to place a new order, just reply to this email and we'll help immediately.\n\nThanks,\n" +
        (process.env.BRAND_NAME || "Babanamak");

    const defaultEmail = client.contacts?.find(c => c.email)?.email || client.email || null;
    const email = to_email || defaultEmail;

    if (!send) {
      return res.json({
        eligible,
        days_since_last_order: daysSince,
        to_email: email,
        subject: draftedSubject,
        message: draftedMessage,
        sender: sender.public
      });
    }

    if (!eligible) {
      return res.status(400).json({ message: "Client has ordered within last 45 days", days_since_last_order: daysSince });
    }
    if (!email) {
      return res.status(400).json({ message: "No client email found. Provide to_email." });
    }

    const log = await logQueued({
      company_id,
      channel: "EMAIL",
      to: email,
      created_by: req.user.id,
      client_id: clientId,
      payload: { reason: "RE_ENGAGE", days_since_last_order: daysSince, sender: sender.public }
    });

    const resp = await sendTransactionalEmail({
      toEmail: email,
      toName: null,
      subject: draftedSubject,
      html: `<pre style="font-family:inherit">${draftedMessage}</pre>`,
      logId: log.id,
      senderKey: sender.key
    });

    return res.json({ ok: true, eligible, log_id: log.id, provider: resp, sender: sender.public });
  } catch (err) {
    console.error("reEngageClient error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

// POST /clients/:clientId/letter.pdf
// Generate a custom letter PDF with client placeholders auto-filled.
exports.generateClientLetterPdf = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId } = req.params;
    const { title, body } = req.body || {};

    const client = await prisma.client.findFirst({
      where: { id: clientId, company_id, is_active: true },
      include: { contacts: { where: { is_active: true }, orderBy: { created_at: "asc" } } }
    });
    if (!client) return res.status(404).json({ message: "Client not found" });

    const stream = new PassThrough();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="letter-${client.company_name.replace(/\s+/g, "-")}.pdf"`);
    stream.pipe(res);

    await generateClientLetterPdfToStream({
      stream,
      branding: {
        companyName: process.env.PDF_BRAND_NAME || process.env.BRAND_NAME || "Babanamak",
        companyAddress: process.env.PDF_BRAND_ADDRESS || process.env.BRAND_ADDRESS || "",
        themeColor: process.env.PDF_THEME_COLOR || process.env.PDF_THEME || "#5d309d"
      },
      title: title || "Letter",
      body: (body || getDefaultLetterBody(title)).toString(),
      ctx: buildClientLetterCtx(client)
    });
  } catch (err) {
    console.error("generateClientLetterPdf error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.generateBulkClientLetterPdf = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { client_ids, title, body } = req.body || {};
    const clients = await loadActiveClientsByIds(company_id, client_ids, { includeContacts: true });

    const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', margin: 50 });
    const stream = new PassThrough();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="client-letters-bulk.pdf"');
    stream.pipe(res);
    doc.pipe(stream);

    const finalTitle = title || 'Letter';
    const finalBody = (body || getDefaultLetterBody(finalTitle)).toString();
    const branding = {
      companyName: process.env.PDF_BRAND_NAME || process.env.BRAND_NAME || 'Babanamak',
      companyAddress: process.env.PDF_BRAND_ADDRESS || process.env.BRAND_ADDRESS || '',
      themeColor: process.env.PDF_THEME_COLOR || process.env.PDF_THEME || '#5d309d'
    };

    clients.forEach((client) => {
      doc.addPage({ size: 'A4', margin: 50 });
      renderClientLetterPage(doc, {
        branding,
        title: finalTitle,
        body: finalBody,
        ctx: buildClientLetterCtx(client),
        includeGeneratedStamp: true
      });
    });

    doc.end();
  } catch (err) {
    console.error('generateBulkClientLetterPdf error:', err);
    return res.status(err.statusCode || 500).json({
      message:
        err.message === 'CLIENT_IDS_REQUIRED'
          ? 'client_ids is required'
          : err.message === 'CLIENT_NOT_FOUND'
            ? 'One or more clients not found'
            : 'Internal server error',
      ...(err.meta || {})
    });
  }
};

// GET /clients/:clientId/slip.pdf
// Small slip with only client name + address (for printing & pasting on orders).
exports.getClientSlipPdf = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId } = req.params;

    const stream = new PassThrough();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="client-slip-${clientId}.pdf"`);
    stream.pipe(res);

    await generateClientSlipPdfToStream({ company_id, clientId, stream });
  } catch (err) {
    console.error("getClientSlipPdf error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.getBulkClientSlipPdf = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { client_ids } = req.body || {};
    const clients = await loadActiveClientsByIds(company_id, client_ids);
    const slipData = await Promise.all(clients.map((client) => getClientSlipData(company_id, client.id)));

    const doc = new PDFDocument({ autoFirstPage: false });
    const stream = new PassThrough();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="client-slips-bulk.pdf"');
    stream.pipe(res);
    doc.pipe(stream);

    slipData.forEach((client) => addClientSlipPage(doc, client));

    doc.end();
  } catch (err) {
    console.error('getBulkClientSlipPdf error:', err);
    return res.status(err.statusCode || 500).json({
      message:
        err.message === 'CLIENT_IDS_REQUIRED'
          ? 'client_ids is required'
          : err.message === 'CLIENT_NOT_FOUND'
            ? 'One or more clients not found'
            : err.message || 'Internal server error',
      ...(err.meta || {})
    });
  }
};

// POST /clients/:clientId/re-engage
// If client has no orders in last 45 days, returns a draft email and can send it.


async function ensureOptionalFactory(company_id, factory_id) {
  if (!factory_id) return null;
  const normalized = String(factory_id).trim();
  if (!normalized || ['all', 'ALL', '*', 'bhikam', 'BHIKAM'].includes(normalized)) return null;
  const factory = await prisma.factory.findFirst({
    where: { id: normalized, company_id, is_active: true },
    select: { id: true, name: true }
  });
  if (!factory) {
    const err = new Error('FACTORY_NOT_FOUND');
    err.statusCode = 404;
    throw err;
  }
  return factory;
}

async function computeSalesOutstandingEstimated(company_id, client_id) {
  const invoices = await prisma.invoice.findMany({
    where: { company_id, client_id, is_active: true, kind: { not: 'PROFORMA' }, status: { not: 'VOID' } },
    select: { id: true, total: true }
  });
  if (!invoices.length) return 0;
  const voucherRows = await prisma.accountingVoucher.findMany({
    where: { company_id, invoice_id: { in: invoices.map((row) => row.id) }, is_active: true, voucher_type: { in: ['DEBIT_NOTE', 'CREDIT_NOTE'] } },
    select: { invoice_id: true, voucher_type: true, total_amount: true }
  });
  const noteMap = new Map();
  for (const row of voucherRows) {
    const current = noteMap.get(row.invoice_id) || { debit: 0, credit: 0 };
    const amount = toAdvanceNumber(row.total_amount || 0);
    if (row.voucher_type === 'DEBIT_NOTE') current.debit += amount;
    if (row.voucher_type === 'CREDIT_NOTE') current.credit += amount;
    noteMap.set(row.invoice_id, current);
  }
  const allocationAgg = await prisma.paymentAllocation.groupBy({
    by: ['invoice_id'],
    where: { company_id, invoice_id: { in: invoices.map((row) => row.id) }, is_active: true, payment: { status: 'RECORDED' } },
    _sum: { amount: true }
  });
  const allocationMap = new Map(allocationAgg.map((row) => [row.invoice_id, toAdvanceNumber(row?._sum?.amount || 0)]));
  return invoices.reduce((acc, invoice) => {
    const note = noteMap.get(invoice.id) || { debit: 0, credit: 0 };
    const adjustedTotal = toAdvanceNumber(invoice.total || 0) + note.debit - note.credit;
    const remaining = adjustedTotal - toAdvanceNumber(allocationMap.get(invoice.id) || 0);
    return acc + Math.max(0, remaining);
  }, 0);
}

async function computePurchaseOutstandingEstimated(company_id, client_id) {
  const purchases = await prisma.purchase.findMany({
    where: { company_id, client_id, is_active: true },
    select: { id: true, total: true }
  });
  if (!purchases.length) return 0;
  const noteMap = await getPurchaseNoteEffectByIdsTx(prisma, { company_id, purchase_ids: purchases.map((row) => row.id) });
  const paymentAgg = await prisma.purchasePayment.groupBy({
    by: ['purchase_id'],
    where: { company_id, purchase_id: { in: purchases.map((row) => row.id) }, status: 'RECORDED' },
    _sum: { amount: true }
  });
  const paymentMap = new Map(paymentAgg.map((row) => [row.purchase_id, toAdvanceNumber(row?._sum?.amount || 0)]));
  return purchases.reduce((acc, purchase) => {
    const note = noteMap.get(purchase.id) || { net_effect: 0 };
    const adjustedTotal = toAdvanceNumber(purchase.total || 0) + toAdvanceNumber(note.net_effect || 0);
    const remaining = adjustedTotal - toAdvanceNumber(paymentMap.get(purchase.id) || 0);
    return acc + Math.max(0, remaining);
  }, 0);
}

exports.getClientAdvanceSummary = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId } = req.params;
    const client = await prisma.client.findFirst({
      where: { id: clientId, company_id, is_active: true },
      select: { id: true, company_name: true }
    });
    if (!client) return res.status(404).json({ message: 'Client not found' });

    const [sales, purchase, salesOutstandingEstimated, purchaseOutstandingEstimated] = await Promise.all([
      getSalesAdvanceSummaryTx(prisma, { company_id, client_id: clientId }),
      getPurchaseAdvanceSummaryTx(prisma, { company_id, client_id: clientId }),
      computeSalesOutstandingEstimated(company_id, clientId),
      computePurchaseOutstandingEstimated(company_id, clientId)
    ]);

    return res.json({
      client,
      sales: {
        total_received: sales.total_received,
        allocated_amount: sales.allocated_amount,
        available_advance: sales.available_advance,
        outstanding_estimated: salesOutstandingEstimated,
        net_position: sales.available_advance - salesOutstandingEstimated
      },
      purchase: {
        total_paid: purchase.total_paid,
        applied_advance: purchase.applied_advance,
        available_advance: purchase.available_advance,
        outstanding_estimated: purchaseOutstandingEstimated,
        net_position: purchase.available_advance - purchaseOutstandingEstimated
      }
    });
  } catch (err) {
    console.error('getClientAdvanceSummary error:', err);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Internal server error' });
  }
};

exports.getClientPurchaseAdvances = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId } = req.params;
    const client = await prisma.client.findFirst({ where: { id: clientId, company_id, is_active: true }, select: { id: true, company_name: true } });
    if (!client) return res.status(404).json({ message: 'Client not found' });
    const rows = await listPurchaseAdvancesTx(prisma, { company_id, client_id: clientId });
    return res.json({ client, count: rows.length, rows });
  } catch (err) {
    console.error('getClientPurchaseAdvances error:', err);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Internal server error' });
  }
};

exports.createClientPurchaseAdvance = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId } = req.params;
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ message: 'amount must be > 0' });

    const client = await prisma.client.findFirst({ where: { id: clientId, company_id, is_active: true }, select: { id: true, company_name: true } });
    if (!client) return res.status(404).json({ message: 'Client not found' });

    const factory = await ensureOptionalFactory(company_id, req.body?.factory_id || req.query?.factory_id);
    const created = await prisma.$transaction(async (tx) => {
      const advance = await createPurchaseAdvanceTx(tx, {
        company_id,
        client_id: clientId,
        factory_id: factory?.id || null,
        amount,
        paid_at: parseAdvanceDateOrNull(req.body?.paid_at) || new Date(),
        method: req.body?.method || req.body?.payment_method || null,
        reference: req.body?.reference || req.body?.payment_reference || null,
        notes: req.body?.notes || req.body?.payment_notes || null,
        user_id: req.user.id
      });
      await autoAllocatePurchaseBalancesForClientTx(tx, { company_id, client_id: clientId, user_id: req.user.id });
      return tx.purchaseAdvance.findUnique({ where: { id: advance.id } });
    });

    await logActivity({
      company_id,
      factory_id: factory?.id || null,
      user_id: req.user.id,
      action: 'PURCHASE_ADVANCE_CREATED',
      entity_type: 'purchase_advance',
      entity_id: created.id,
      meta: { client_id: clientId }
    });

    return res.status(201).json(created);
  } catch (err) {
    if (err.message === 'FACTORY_NOT_FOUND') return res.status(404).json({ message: 'Factory not found' });
    console.error('createClientPurchaseAdvance error:', err);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Internal server error' });
  }
};

exports.reverseClientPurchaseAdvance = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { clientId, advanceId } = req.params;
    const client = await prisma.client.findFirst({ where: { id: clientId, company_id, is_active: true }, select: { id: true } });
    if (!client) return res.status(404).json({ message: 'Client not found' });

    const reversed = await prisma.$transaction(async (tx) => {
      const advance = await tx.purchaseAdvance.findFirst({ where: { id: advanceId, company_id, client_id: clientId } });
      if (!advance) {
        const err = new Error('PURCHASE_ADVANCE_NOT_FOUND');
        err.statusCode = 404;
        throw err;
      }
      return reversePurchaseAdvanceTx(tx, {
        company_id,
        advance_id: advanceId,
        user_id: req.user.id,
        reversal_note: req.body?.reversal_note || req.body?.note
      });
    });

    await logActivity({
      company_id,
      factory_id: reversed.factory_id || null,
      user_id: req.user.id,
      action: 'PURCHASE_ADVANCE_REVERSED',
      entity_type: 'purchase_advance',
      entity_id: reversed.id,
      meta: { client_id: clientId }
    });

    return res.json(reversed);
  } catch (err) {
    if (err.message === 'PURCHASE_ADVANCE_NOT_FOUND') return res.status(404).json({ message: 'Purchase advance not found' });
    if (err.message === 'PURCHASE_ADVANCE_ALREADY_REVERSED') return res.status(400).json({ message: 'Purchase advance is already reversed' });
    if (err.message === 'PURCHASE_ADVANCE_HAS_APPLIED_PAYMENTS') return res.status(400).json({ message: 'Purchase advance has already been applied to purchases and cannot be reversed directly' });
    console.error('reverseClientPurchaseAdvance error:', err);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Internal server error' });
  }
};
