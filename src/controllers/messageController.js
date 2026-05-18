const prisma = require("../config/db");
const { dispatchCampaign, enqueueCampaignDispatch } = require("../services/messageDispatchService");
const { getPagination, buildPaginationMeta } = require("../utils/pagination");
const {
  normalizeSelection,
  ensureTemplate,
  resolveClientsFromSelection,
  resolveRecipientsFromClients
} = require("../services/campaignService");
const { getSenderCatalog, resolveSender, getRequestedSenderKey } = require("../services/messageSenderService");

function normalizeChannel(channel) {
  return String(channel || "").trim().toUpperCase();
}

function normalizeDispatchOptions(body = {}, query = {}) {
  const dispatchNow = body.dispatch_now !== undefined ? body.dispatch_now !== false : body.send_now !== false;
  const asyncMode = query.async === "true" || body.async === true;
  return { dispatchNow, asyncMode };
}

function normalizeProvidedRecipients(company_id, campaign_id, recipients = []) {
  return (Array.isArray(recipients) ? recipients : [])
    .map((recipient) => ({
      company_id,
      campaign_id,
      client_id: recipient.client_id || null,
      contact_id: recipient.contact_id || null,
      to_email: recipient.to_email || recipient.email || null,
      to_phone: recipient.to_phone || recipient.phone || null,
      payload: recipient.payload || null
    }))
    .filter((recipient) => recipient.to_email || recipient.to_phone);
}

async function createCampaignRecord({ company_id, user_id, name, channel, templateId, purpose, factory_id, meta }) {
  return prisma.messageCampaign.create({
    data: {
      company_id,
      name,
      channel,
      template_id: templateId || null,
      purpose: purpose || null,
      factory_id: factory_id || null,
      created_by: user_id,
      meta: meta || undefined
    }
  });
}

async function finalizeCampaignCreation({ req, company_id, campaign, recipients, skippedRecipients }) {
  if (!recipients.length) {
    return {
      campaign,
      recipients_count: 0,
      skipped_recipients: skippedRecipients,
      message: "No deliverable recipients found for this campaign"
    };
  }

  await prisma.messageRecipient.createMany({ data: recipients });

  const { dispatchNow, asyncMode } = normalizeDispatchOptions(req.body, req.query);
  if (!dispatchNow) {
    return {
      campaign,
      recipients_count: recipients.length,
      skipped_recipients: skippedRecipients,
      dispatched: false
    };
  }

  if (asyncMode) {
    const job = await enqueueCampaignDispatch({ company_id, campaignId: campaign.id, user_id: req.user.id });
    return {
      campaign,
      recipients_count: recipients.length,
      skipped_recipients: skippedRecipients,
      dispatched: true,
      queued: true,
      job
    };
  }

  const result = await dispatchCampaign({ company_id, campaignId: campaign.id, user_id: req.user.id });
  return {
    campaign,
    recipients_count: recipients.length,
    skipped_recipients: skippedRecipients,
    dispatched: true,
    queued: false,
    result
  };
}

function buildCampaignMeta({ selection, filter, directRecipientsLength, sender }) {
  return {
    ...(selection ? { selection } : {}),
    ...(filter ? { filter } : {}),
    has_direct_recipients: directRecipientsLength > 0,
    has_filter: !!filter,
    sender: sender.public
  };
}

exports.getSenders = async (_req, res) => {
  try {
    return res.json(getSenderCatalog());
  } catch (err) {
    console.error("getSenders error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.createCampaign = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const channel = normalizeChannel(req.body?.channel);
    const {
      name,
      template_id,
      purpose,
      factory_id,
      recipients,
      filter,
      subject,
      body,
      message
    } = req.body || {};

    if (!name) return res.status(400).json({ message: "name is required" });
    if (!["EMAIL", "WHATSAPP"].includes(channel)) {
      return res.status(400).json({ message: "channel must be EMAIL or WHATSAPP" });
    }

    const sender = resolveSender(channel, getRequestedSenderKey(req.body, channel));
    const directRecipients = normalizeProvidedRecipients(company_id, "__pending__", recipients);
    const selection = normalizeSelection(req.body);

    let templateId = template_id || null;
    if (templateId || subject || body || message) {
      const ensured = await ensureTemplate({
        company_id,
        channel,
        template_id: templateId,
        subject: subject || name,
        body: body || message || `<p>Hello {{client_name}},</p><p>${name}</p>`,
        created_by: req.user.id,
        baseName: "campaign"
      });
      templateId = ensured.templateId;
    }

    const campaign = await createCampaignRecord({
      company_id,
      user_id: req.user.id,
      name,
      channel,
      templateId,
      purpose,
      factory_id,
      meta: buildCampaignMeta({
        selection,
        filter,
        directRecipientsLength: directRecipients.length,
        sender
      })
    });

    let resolvedRecipients = [];
    let skippedRecipients = [];

    if (directRecipients.length) {
      resolvedRecipients = directRecipients.map((recipient) => ({ ...recipient, campaign_id: campaign.id }));
    } else {
      const clients = await resolveClientsFromSelection({
        company_id,
        selection,
        filter,
        factory_id
      });

      if (!clients.length) {
        return res.status(400).json({ message: "No recipients match the provided selection" });
      }

      const resolved = resolveRecipientsFromClients({ company_id, campaign_id: campaign.id, channel, clients });
      resolvedRecipients = resolved.recipients;
      skippedRecipients = resolved.skipped;
    }

    const response = await finalizeCampaignCreation({
      req,
      company_id,
      campaign,
      recipients: resolvedRecipients,
      skippedRecipients
    });

    return res.status(201).json(response);
  } catch (err) {
    console.error("createCampaign error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.dispatchCampaign = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;

    const asyncMode = req.query.async === "true" || req.body?.async === true;
    if (asyncMode) {
      const job = await enqueueCampaignDispatch({ company_id, campaignId: id, user_id: req.user.id });
      return res.status(202).json({ queued: true, job });
    }

    const result = await dispatchCampaign({ company_id, campaignId: id, user_id: req.user.id });
    return res.json(result);
  } catch (err) {
    console.error("dispatchCampaign error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.getCampaignStatus = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;

    const campaign = await prisma.messageCampaign.findFirst({
      where: { id, company_id },
      include: { template: true }
    });
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });

    const [counts, latestJob, recipientsCount] = await Promise.all([
      prisma.messageLog.groupBy({
        by: ["status"],
        where: { company_id, messageCampaignId: id },
        _count: { status: true }
      }),
      prisma.messageDispatchJob.findFirst({
        where: { company_id, campaign_id: id },
        orderBy: { created_at: "desc" }
      }),
      prisma.messageRecipient.count({ where: { company_id, campaign_id: id } })
    ]);

    return res.json({ campaign, counts, recipients_count: recipientsCount, latest_job: latestJob });
  } catch (err) {
    console.error("getCampaignStatus error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getOutbox = async (req, res) => {
  try {
    const company_id = req.user.company_id;

    const channel = (req.query.channel || "").toString().trim();
    const status = (req.query.status || "").toString().trim();
    const campaignId = (req.query.campaign_id || "").toString().trim();

    const where = { company_id };
    if (channel) where.channel = channel;
    if (status) where.status = status;
    if (campaignId) where.messageCampaignId = campaignId;

    const pagination = getPagination(req, { defaultPageSize: 50, maxPageSize: 200 });
    const query = {
      where,
      orderBy: [{ created_at: "desc" }, { id: "desc" }]
    };
    if (pagination.enabled) {
      query.skip = pagination.skip;
      query.take = pagination.take;
    } else {
      query.take = 200;
    }

    const [logs, total] = await Promise.all([
      prisma.messageLog.findMany(query),
      pagination.enabled && pagination.include_total ? prisma.messageLog.count({ where }) : Promise.resolve(null)
    ]);

    if (!pagination.enabled) return res.json(logs);

    return res.json({
      items: logs,
      pagination: buildPaginationMeta({ page: pagination.page, page_size: pagination.page_size, total: total ?? logs.length })
    });
  } catch (err) {
    console.error("getOutbox error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.createCampaignFromFilter = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const channel = normalizeChannel(req.body?.channel);
    const { name, template_id, purpose, factory_id, filter, subject, body, message } = req.body || {};

    if (!name) return res.status(400).json({ message: "name is required" });
    if (!["EMAIL", "WHATSAPP"].includes(channel)) {
      return res.status(400).json({ message: "channel must be EMAIL or WHATSAPP" });
    }

    const sender = resolveSender(channel, getRequestedSenderKey(req.body, channel));
    const clients = await resolveClientsFromSelection({ company_id, selection: null, filter, factory_id });
    if (!clients.length) {
      return res.status(400).json({ message: "No recipients match the provided filter" });
    }

    const ensured = await ensureTemplate({
      company_id,
      channel,
      template_id,
      subject: subject || name,
      body: body || message || `Hello {{client_name}},\n\nThis is a message regarding ${name}.`,
      created_by: req.user.id,
      baseName: "filter-campaign"
    });

    const campaign = await createCampaignRecord({
      company_id,
      user_id: req.user.id,
      name,
      channel,
      templateId: ensured.templateId,
      purpose,
      factory_id,
      meta: buildCampaignMeta({ filter, directRecipientsLength: 0, sender })
    });

    const resolved = resolveRecipientsFromClients({ company_id, campaign_id: campaign.id, channel, clients });
    const response = await finalizeCampaignCreation({
      req,
      company_id,
      campaign,
      recipients: resolved.recipients,
      skippedRecipients: resolved.skipped
    });

    return res.status(201).json(response);
  } catch (err) {
    console.error("createCampaignFromFilter error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.createPromotionalCampaign = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const channel = normalizeChannel(req.body?.channel);
    const {
      name,
      template_id,
      purpose,
      subject,
      body,
      message,
      selection
    } = req.body || {};

    if (!name) return res.status(400).json({ message: "name is required" });
    if (!["EMAIL", "WHATSAPP"].includes(channel)) {
      return res.status(400).json({ message: "channel must be EMAIL or WHATSAPP" });
    }

    const sender = resolveSender(channel, getRequestedSenderKey(req.body, channel));
    const normalizedSelection = normalizeSelection({ ...req.body, selection });
    if (!normalizedSelection) {
      return res.status(400).json({ message: "selection must target all clients, specific client(s), or product(s)" });
    }

    const clients = await resolveClientsFromSelection({ company_id, selection: normalizedSelection });
    if (!clients.length) {
      return res.status(400).json({ message: "No clients found for the selected criteria" });
    }

    const ensured = await ensureTemplate({
      company_id,
      channel,
      template_id,
      subject: subject || name,
      body: body || message || `<p>Hello {{client_name}},</p><p>We have an update for you from ${name}.</p>`,
      created_by: req.user.id,
      baseName: "promo"
    });

    const campaign = await createCampaignRecord({
      company_id,
      user_id: req.user.id,
      name,
      channel,
      templateId: ensured.templateId,
      purpose: purpose || "PROMOTIONAL",
      factory_id: null,
      meta: buildCampaignMeta({ selection: normalizedSelection, directRecipientsLength: 0, sender })
    });

    const resolved = resolveRecipientsFromClients({ company_id, campaign_id: campaign.id, channel, clients });
    const response = await finalizeCampaignCreation({
      req,
      company_id,
      campaign,
      recipients: resolved.recipients,
      skippedRecipients: resolved.skipped
    });

    return res.status(201).json(response);
  } catch (err) {
    console.error("createPromotionalCampaign error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

exports.deleteCampaign = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { id } = req.params;

    const campaign = await prisma.messageCampaign.findFirst({ where: { id, company_id } });
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });

    const runningJob = await prisma.messageDispatchJob.findFirst({
      where: { company_id, campaign_id: id, status: { in: ["QUEUED", "RUNNING"] } }
    });
    if (runningJob) {
      return res.status(400).json({ message: "Cannot delete campaign while dispatch job is queued or running" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.messageDispatchJob.deleteMany({ where: { company_id, campaign_id: id } });
      await tx.messageRecipient.deleteMany({ where: { company_id, campaign_id: id } });
      await tx.messageLog.deleteMany({ where: { company_id, OR: [{ messageCampaignId: id }, { campaign_id: id }] } });
      await tx.messageCampaign.delete({ where: { id } });
    });

    return res.json({ message: "Campaign deleted successfully" });
  } catch (err) {
    console.error("deleteCampaign error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
