const prisma = require("../config/db");
const { orderVisibilityWhere, invoiceVisibilityWhere } = require("../utils/factoryVisibility");

function uniqueValues(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function normalizeSelection(body = {}) {
  const selection = body.selection || body.target || {};
  const explicitType = String(selection.type || body.target_type || body.recipient_type || "").trim().toUpperCase();

  const clientIds = uniqueValues([
    ...(Array.isArray(selection.client_ids) ? selection.client_ids : []),
    ...(Array.isArray(body.client_ids) ? body.client_ids : []),
    selection.client_id,
    body.client_id
  ]);

  const productIds = uniqueValues([
    ...(Array.isArray(selection.product_ids) ? selection.product_ids : []),
    ...(Array.isArray(body.product_ids) ? body.product_ids : []),
    selection.product_id,
    body.product_id
  ]);

  const sendAll =
    selection.all === true ||
    body.all === true ||
    body.send_all === true ||
    explicitType === "ALL" ||
    explicitType === "ALL_CLIENTS";

  if (sendAll) {
    return { type: "ALL_CLIENTS" };
  }

  if (productIds.length) {
    return { type: "PRODUCT", product_ids: productIds };
  }

  if (clientIds.length) {
    return { type: clientIds.length === 1 ? "CLIENT" : "CLIENT_IDS", client_ids: clientIds };
  }

  if (["CLIENT", "CLIENT_IDS", "PRODUCT"].includes(explicitType)) {
    return {
      type: explicitType,
      client_ids: clientIds,
      product_ids: productIds
    };
  }

  return null;
}

async function resolveFilteredClientIds({ company_id, factory_id, filter = {} }) {
  const invoiceStatuses = Array.isArray(filter.invoice_statuses) ? uniqueValues(filter.invoice_statuses) : [];
  const orderStatuses = Array.isArray(filter.order_statuses) ? uniqueValues(filter.order_statuses) : [];
  const inactiveDays = Number(filter.inactive_days || 0);

  const clientIds = new Set();

  if (invoiceStatuses.length) {
    const rows = await prisma.invoice.findMany({
      where: {
        company_id,
        is_active: true,
        ...(factory_id ? invoiceVisibilityWhere({ factory_id }) : {}),
        status: { in: invoiceStatuses }
      },
      select: { client_id: true }
    });
    rows.forEach((row) => row.client_id && clientIds.add(row.client_id));
  }

  if (orderStatuses.length) {
    const rows = await prisma.order.findMany({
      where: {
        company_id,
        is_active: true,
        ...(factory_id ? orderVisibilityWhere({ factory_id }) : {}),
        status: { in: orderStatuses }
      },
      select: { client_id: true }
    });
    rows.forEach((row) => row.client_id && clientIds.add(row.client_id));
  }

  if (inactiveDays > 0) {
    const cutoff = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);
    const clients = await prisma.client.findMany({
      where: { company_id, is_active: true },
      select: { id: true }
    });

    const lastOrders = await prisma.order.groupBy({
      by: ["client_id"],
      where: {
        company_id,
        is_active: true,
        ...(factory_id ? orderVisibilityWhere({ factory_id }) : {})
      },
      _max: { order_date: true }
    });

    const lastOrderMap = new Map(lastOrders.map((row) => [row.client_id, row._max.order_date]));
    for (const client of clients) {
      const lastDate = lastOrderMap.get(client.id);
      if (!lastDate || new Date(lastDate) < cutoff) {
        clientIds.add(client.id);
      }
    }
  }

  return Array.from(clientIds);
}

async function resolveClientsFromSelection({ company_id, selection, filter, factory_id }) {
  let clientIds = [];

  if (selection) {
    if (selection.type === "ALL_CLIENTS") {
      const clients = await prisma.client.findMany({ where: { company_id, is_active: true }, select: { id: true } });
      clientIds = clients.map((client) => client.id);
    } else if (selection.type === "CLIENT" || selection.type === "CLIENT_IDS") {
      clientIds = uniqueValues(selection.client_ids || []);
    } else if (selection.type === "PRODUCT") {
      const rows = await prisma.clientProduct.findMany({
        where: {
          company_id,
          is_active: true,
          product_id: { in: uniqueValues(selection.product_ids || []) },
          client: { is_active: true }
        },
        select: { client_id: true }
      });
      clientIds = uniqueValues(rows.map((row) => row.client_id));
    }
  } else if (filter) {
    clientIds = await resolveFilteredClientIds({ company_id, factory_id, filter });
  }

  if (!clientIds.length) return [];

  return prisma.client.findMany({
    where: { company_id, id: { in: clientIds }, is_active: true },
    include: {
      contacts: {
        where: { is_active: true },
        orderBy: [{ created_at: "asc" }, { updated_at: "desc" }]
      }
    }
  });
}

function resolveRecipientsFromClients({ company_id, campaign_id, channel, clients }) {
  const recipients = [];
  const skipped = [];

  for (const client of clients || []) {
    const emailContact = (client.contacts || []).find((contact) => contact.email);
    const phoneContact = (client.contacts || []).find((contact) => contact.phone);
    const resolvedEmail = emailContact?.email || client.email || null;
    const resolvedPhone = phoneContact?.phone || client.mobile_no || client.phone || null;
    const resolvedContactId = emailContact?.id || phoneContact?.id || client.contacts?.[0]?.id || null;

    if (channel === "EMAIL" && !resolvedEmail) {
      skipped.push({ client_id: client.id, company_name: client.company_name, reason: "No email found" });
      continue;
    }
    if (channel === "WHATSAPP" && !resolvedPhone) {
      skipped.push({ client_id: client.id, company_name: client.company_name, reason: "No phone found" });
      continue;
    }

    recipients.push({
      company_id,
      campaign_id,
      client_id: client.id,
      contact_id: resolvedContactId,
      to_email: resolvedEmail,
      to_phone: resolvedPhone,
      payload: {
        client_id: client.id,
        client_name: client.company_name,
        client_company: client.company_name,
        client_email: resolvedEmail,
        client_phone: resolvedPhone,
        contact_name: emailContact?.name || phoneContact?.name || null,
        contact_email: emailContact?.email || null,
        contact_phone: phoneContact?.phone || null,
        city: client.city || null,
        state: client.state || null,
        address: client.address || null
      }
    });
  }

  return { recipients, skipped };
}

async function ensureTemplate({ company_id, channel, template_id, subject, body, created_by, baseName = "campaign" }) {
  if (template_id) {
    const template = await prisma.messageTemplate.findFirst({
      where: { id: template_id, company_id, channel, is_active: true }
    });
    if (!template) {
      const err = new Error("Active template not found for the selected channel");
      err.statusCode = 404;
      throw err;
    }
    return { templateId: template.id, template };
  }

  if (channel === "EMAIL" && !String(subject || "").trim()) {
    const err = new Error("subject is required for EMAIL when template_id is not provided");
    err.statusCode = 400;
    throw err;
  }
  if (!String(body || "").trim()) {
    const err = new Error("body is required when template_id is not provided");
    err.statusCode = 400;
    throw err;
  }

  const template = await prisma.messageTemplate.create({
    data: {
      company_id,
      name: `${baseName}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      channel,
      subject: channel === "EMAIL" ? String(subject) : null,
      body: String(body),
      is_active: true,
      created_by: created_by || null
    }
  });

  return { templateId: template.id, template };
}

module.exports = {
  normalizeSelection,
  ensureTemplate,
  resolveClientsFromSelection,
  resolveRecipientsFromClients,
  resolveFilteredClientIds
};
