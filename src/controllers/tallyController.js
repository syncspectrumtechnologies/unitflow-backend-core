const prisma = require("../config/db");
const logActivity = require("../utils/activityLogger");
const {
  SOURCE_TYPES,
  text,
  normalizeLimit,
  cleanStatus,
  hashConnectorToken,
  createConnectorToken,
  ensureIntegration,
  serializeIntegration,
  normalizeSettingsPayload,
  buildSyncPlan
} = require("../services/tallyService");
const { processInboundSnapshot, safeClientPatchFromLedger } = require("../services/tallyInboundService");

function publicApiBaseUrl(req) {
  return String(
    process.env.PUBLIC_CORE_API_BASE_URL ||
      process.env.NEXT_PUBLIC_CORE_API_BASE_URL ||
      `${req.protocol}://${req.get("host")}`
  ).replace(/\/+$/, "");
}

function safeMeta(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  for (const [key, raw] of Object.entries(value).slice(0, 20)) {
    if (/token|secret|password|authorization/i.test(key)) continue;
    if (raw === null || ["string", "number", "boolean"].includes(typeof raw)) out[key] = raw;
  }
  return Object.keys(out).length ? out : null;
}

exports.getSettings = async (req, res) => {
  try {
    const integration = await ensureIntegration(req.user.company_id, req.user.id);
    return res.json({
      integration: serializeIntegration(integration),
      connector: {
        core_api_base_url: publicApiBaseUrl(req),
        tally_http_url: integration.tally_url_hint || "http://localhost:9000",
        sync_plan_endpoint: "/tally/connector/sync-plan",
        sync_result_endpoint: "/tally/connector/sync-result",
        inbound_snapshot_endpoint: "/tally/connector/inbound-snapshot"
      }
    });
  } catch (error) {
    console.error("getTallySettings error:", error);
    return res.status(500).json({ message: "Unable to load Tally settings" });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const existing = await ensureIntegration(company_id, req.user.id);
    const data = normalizeSettingsPayload(req.body || {}, existing);

    const updated = await prisma.tallyIntegration.update({
      where: { company_id },
      data
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "TALLY_SETTINGS_UPDATED",
      entity_type: "tally_integration",
      entity_id: updated.id,
      meta: {
        enabled: updated.enabled,
        sync_ledgers: updated.sync_ledgers,
        sync_invoices: updated.sync_invoices,
        sync_payments: updated.sync_payments,
        sync_vouchers: updated.sync_vouchers,
        allow_tally_import: updated.allow_tally_import,
        conflict_strategy: updated.conflict_strategy
      }
    });

    return res.json({ integration: serializeIntegration(updated) });
  } catch (error) {
    console.error("updateTallySettings error:", error);
    return res.status(500).json({ message: "Unable to save Tally settings" });
  }
};

exports.rotateConnectorToken = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const integration = await ensureIntegration(company_id, req.user.id);
    const token = createConnectorToken();
    const updated = await prisma.tallyIntegration.update({
      where: { company_id },
      data: {
        connector_token_hash: hashConnectorToken(token),
        connector_token_last4: token.slice(-4),
        status: integration.enabled ? "DISCONNECTED" : "DISABLED",
        last_error: null
      }
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "TALLY_CONNECTOR_TOKEN_ROTATED",
      entity_type: "tally_integration",
      entity_id: updated.id,
      meta: { connector_token_last4: updated.connector_token_last4 }
    });

    return res.json({
      connector_token: token,
      connector_token_last4: updated.connector_token_last4,
      integration: serializeIntegration(updated)
    });
  } catch (error) {
    console.error("rotateTallyConnectorToken error:", error);
    return res.status(500).json({ message: "Unable to create connector token" });
  }
};

exports.getLedgerLinks = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const q = text(req.query.q, 80);
    const limit = normalizeLimit(req.query.limit, 100);
    const rows = await prisma.tallyLedgerLink.findMany({
      where: {
        company_id,
        ...(q ? {
          OR: [
            { tally_ledger_name: { contains: q, mode: "insensitive" } },
            { client: { is: { company_name: { contains: q, mode: "insensitive" } } } }
          ]
        } : {})
      },
      orderBy: { updated_at: "desc" },
      take: limit,
      include: { client: { select: { id: true, company_name: true, email: true, phone: true, mobile_no: true } } }
    });
    return res.json({ count: rows.length, rows });
  } catch (error) {
    console.error("getTallyLedgerLinks error:", error);
    return res.status(500).json({ message: "Unable to load ledger links" });
  }
};

exports.upsertLedgerLink = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const integration = await ensureIntegration(company_id, req.user.id);
    const client_id = text(req.body?.client_id, 128) || null;
    const tally_ledger_name = text(req.body?.tally_ledger_name, 160);
    if (!tally_ledger_name) return res.status(400).json({ message: "tally_ledger_name is required" });

    if (client_id) {
      const client = await prisma.client.findFirst({ where: { id: client_id, company_id, is_active: true }, select: { id: true } });
      if (!client) return res.status(404).json({ message: "Client not found" });
    }

    const existing = await prisma.tallyLedgerLink.findFirst({
      where: {
        company_id,
        OR: [
          ...(client_id ? [{ client_id }] : []),
          { tally_ledger_name }
        ]
      }
    });

    const data = {
      integration_id: integration.id,
      client_id,
      tally_ledger_name,
      tally_guid: text(req.body?.tally_guid, 160) || null,
      tally_master_id: text(req.body?.tally_master_id, 80) || null,
      meta: safeMeta(req.body?.meta)
    };

    const row = existing
      ? await prisma.tallyLedgerLink.update({ where: { id: existing.id }, data })
      : await prisma.tallyLedgerLink.create({ data: { company_id, ...data } });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "TALLY_LEDGER_LINK_SAVED",
      entity_type: "tally_ledger_link",
      entity_id: row.id,
      meta: { client_id: row.client_id, tally_ledger_name: row.tally_ledger_name }
    });

    return res.json({ row });
  } catch (error) {
    console.error("upsertTallyLedgerLink error:", error);
    if (error?.code === "P2002") return res.status(409).json({ message: "Ledger mapping already exists" });
    return res.status(500).json({ message: "Unable to save ledger link" });
  }
};

exports.getSyncLogs = async (req, res) => {
  try {
    const limit = normalizeLimit(req.query.limit, 50);
    const rows = await prisma.tallySyncLog.findMany({
      where: { company_id: req.user.company_id },
      orderBy: { created_at: "desc" },
      take: limit
    });
    return res.json({ count: rows.length, rows });
  } catch (error) {
    console.error("getTallySyncLogs error:", error);
    return res.status(500).json({ message: "Unable to load Tally sync logs" });
  }
};

exports.previewSyncPlan = async (req, res) => {
  try {
    const plan = await buildSyncPlan(req.user.company_id, {
      since: req.query.since,
      limit: req.query.limit
    });
    return res.json(plan);
  } catch (error) {
    console.error("previewTallySyncPlan error:", error);
    return res.status(500).json({ message: "Unable to prepare Tally sync preview" });
  }
};

exports.getConflicts = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const status = text(req.query.status, 32).toUpperCase() || "OPEN";
    const limit = normalizeLimit(req.query.limit, 50);
    const rows = await prisma.tallyConflict.findMany({
      where: {
        company_id,
        ...(status === "ALL" ? {} : { status })
      },
      orderBy: [{ severity: "asc" }, { updated_at: "desc" }],
      take: limit
    });
    return res.json({ count: rows.length, rows });
  } catch (error) {
    console.error("getTallyConflicts error:", error);
    return res.status(500).json({ message: "Unable to load Tally conflicts" });
  }
};

exports.resolveConflict = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const status = text(req.body?.status, 24).toUpperCase() === "IGNORED" ? "IGNORED" : "RESOLVED";
    const resolution = text(req.body?.resolution || req.body?.action, 120) || status;
    const conflict = await prisma.tallyConflict.findFirst({
      where: { id: req.params.conflictId, company_id, status: "OPEN" }
    });
    if (!conflict) return res.status(404).json({ message: "Open conflict not found" });

    if (resolution === "APPLY_TALLY_LEDGER" && conflict.entity_type === "LEDGER" && conflict.source_id) {
      const data = safeClientPatchFromLedger(conflict);
      if (data.company_name) {
        const duplicate = await prisma.client.findFirst({
          where: { company_id, company_name: data.company_name, id: { not: conflict.source_id } },
          select: { id: true }
        });
        if (duplicate) return res.status(409).json({ message: "Another client already uses that Tally ledger name" });
      }
      if (Object.keys(data).length) {
        await prisma.client.updateMany({
          where: { id: conflict.source_id, company_id, is_active: true },
          data
        });
      }
    }

    const updated = await prisma.tallyConflict.update({
      where: { id: conflict.id },
      data: {
        status,
        resolution,
        resolved_by: req.user.id,
        resolved_at: new Date()
      }
    });

    await logActivity({
      company_id,
      user_id: req.user.id,
      action: "TALLY_CONFLICT_RESOLVED",
      entity_type: "tally_conflict",
      entity_id: updated.id,
      meta: { status, resolution }
    });

    return res.json({ conflict: updated });
  } catch (error) {
    console.error("resolveTallyConflict error:", error);
    return res.status(500).json({ message: "Unable to resolve Tally conflict" });
  }
};

exports.getReconciliationRuns = async (req, res) => {
  try {
    const rows = await prisma.tallyReconciliationRun.findMany({
      where: { company_id: req.user.company_id },
      orderBy: { started_at: "desc" },
      take: normalizeLimit(req.query.limit, 25)
    });
    return res.json({ count: rows.length, rows });
  } catch (error) {
    console.error("getTallyReconciliationRuns error:", error);
    return res.status(500).json({ message: "Unable to load reconciliation runs" });
  }
};

exports.reconcileSnapshot = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const integration = await ensureIntegration(company_id, req.user.id);
    const result = await processInboundSnapshot({
      company_id,
      integration,
      body: { ...(req.body || {}), source: req.body?.source || "manual-upload" },
      actor: req.user.id
    });
    return res.json(result);
  } catch (error) {
    console.error("reconcileTallySnapshot error:", error);
    return res.status(500).json({ message: "Unable to reconcile Tally snapshot" });
  }
};

exports.connectorSyncPlan = async (req, res) => {
  try {
    const integration = req.tallyIntegration;
    const now = new Date();
    await prisma.tallyIntegration.update({
      where: { id: integration.id },
      data: {
        status: "CONNECTED",
        connector_last_seen_at: now,
        last_sync_started_at: now,
        last_error: null
      }
    });
    await prisma.tallySyncLog.create({
      data: {
        company_id: integration.company_id,
        integration_id: integration.id,
        direction: "OUTBOUND",
        entity_type: "SYNC_PLAN",
        action: "CONNECTOR_PULL",
        status: "SENT",
        created_by: "tally-connector"
      }
    });
    const plan = await buildSyncPlan(integration.company_id, {
      since: req.query.since,
      limit: req.query.limit
    });
    return res.json(plan);
  } catch (error) {
    console.error("connectorTallySyncPlan error:", error);
    return res.status(500).json({ message: "Unable to prepare connector sync plan" });
  }
};

exports.connectorSyncResult = async (req, res) => {
  try {
    const integration = req.tallyIntegration;
    const company_id = integration.company_id;
    const ledgers = Array.isArray(req.body?.ledgers) ? req.body.ledgers.slice(0, 500) : [];
    const vouchers = Array.isArray(req.body?.vouchers) ? req.body.vouchers.slice(0, 500) : [];
    const now = new Date();
    const logRows = [];

    await prisma.$transaction(async (tx) => {
      for (const item of ledgers) {
        const tally_ledger_name = text(item.tally_ledger_name || item.ledger_name, 160);
        if (!tally_ledger_name) continue;
        const client_id = text(item.client_id || item.source_id, 128) || null;
        const status = cleanStatus(item.status);
        const existing = await tx.tallyLedgerLink.findFirst({
          where: {
            company_id,
            OR: [
              ...(client_id ? [{ client_id }] : []),
              { tally_ledger_name }
            ]
          },
          select: { id: true }
        });
        const data = {
          integration_id: integration.id,
          client_id,
          tally_ledger_name,
          tally_guid: text(item.tally_guid || item.guid, 160) || null,
          tally_master_id: text(item.tally_master_id || item.master_id, 80) || null,
          opening_balance: item.opening_balance === undefined ? undefined : numberOrNull(item.opening_balance),
          closing_balance: item.closing_balance === undefined ? undefined : numberOrNull(item.closing_balance),
          last_synced_at: status === "SYNCED" ? now : undefined,
          meta: safeMeta(item.meta)
        };
        if (existing) await tx.tallyLedgerLink.update({ where: { id: existing.id }, data });
        else await tx.tallyLedgerLink.create({ data: { company_id, ...data } });
        logRows.push({
          company_id,
          integration_id: integration.id,
          direction: "INBOUND",
          entity_type: "CLIENT_LEDGER",
          entity_id: client_id,
          action: "SYNC_RESULT",
          status,
          source_ref: tally_ledger_name,
          target_ref: text(item.tally_guid || item.guid, 160) || null,
          message: text(item.error || item.message, 300) || null,
          created_by: "tally-connector",
          completed_at: now
        });
      }

      for (const item of vouchers) {
        const source_type = text(item.source_type, 40).toUpperCase();
        const source_id = text(item.source_id, 128);
        if (!SOURCE_TYPES.has(source_type) || source_type === "CLIENT" || !source_id) continue;
        const status = cleanStatus(item.status);
        await tx.tallyVoucherLink.upsert({
          where: { company_id_source_type_source_id: { company_id, source_type, source_id } },
          update: {
            integration_id: integration.id,
            tally_voucher_guid: text(item.tally_voucher_guid || item.guid, 160) || null,
            tally_voucher_number: text(item.tally_voucher_number || item.voucher_number, 80) || null,
            tally_voucher_type: text(item.tally_voucher_type || item.voucher_type, 80) || null,
            status,
            last_synced_at: status === "SYNCED" ? now : undefined,
            last_error: status === "FAILED" ? text(item.error || item.message, 300) || "Sync failed" : null,
            meta: safeMeta(item.meta)
          },
          create: {
            company_id,
            integration_id: integration.id,
            source_type,
            source_id,
            tally_voucher_guid: text(item.tally_voucher_guid || item.guid, 160) || null,
            tally_voucher_number: text(item.tally_voucher_number || item.voucher_number, 80) || null,
            tally_voucher_type: text(item.tally_voucher_type || item.voucher_type, 80) || null,
            status,
            last_synced_at: status === "SYNCED" ? now : null,
            last_error: status === "FAILED" ? text(item.error || item.message, 300) || "Sync failed" : null,
            meta: safeMeta(item.meta)
          }
        });
        logRows.push({
          company_id,
          integration_id: integration.id,
          direction: "INBOUND",
          entity_type: source_type,
          entity_id: source_id,
          action: "SYNC_RESULT",
          status,
          source_ref: text(item.voucher_number || item.tally_voucher_number, 80) || null,
          target_ref: text(item.guid || item.tally_voucher_guid, 160) || null,
          message: text(item.error || item.message, 300) || null,
          created_by: "tally-connector",
          completed_at: now
        });
      }

      if (logRows.length) await tx.tallySyncLog.createMany({ data: logRows });

      await tx.tallyIntegration.update({
        where: { id: integration.id },
        data: {
          status: logRows.some((row) => row.status === "FAILED") ? "NEEDS_ATTENTION" : "SYNCED",
          connector_last_seen_at: now,
          last_sync_completed_at: now,
          last_error: logRows.find((row) => row.status === "FAILED")?.message || null
        }
      });
    });

    return res.json({ ok: true, received: { ledgers: ledgers.length, vouchers: vouchers.length } });
  } catch (error) {
    console.error("connectorTallySyncResult error:", error);
    return res.status(500).json({ message: "Unable to save connector sync result" });
  }
};

exports.connectorInboundSnapshot = async (req, res) => {
  try {
    const integration = req.tallyIntegration;
    const result = await processInboundSnapshot({
      company_id: integration.company_id,
      integration,
      body: { ...(req.body || {}), source: req.body?.source || "tally-connector" },
      actor: "tally-connector"
    });
    return res.json({
      ok: true,
      run: result.run,
      summary: {
        status: result.report.status,
        matched_count: result.report.matched_count,
        conflict_count: result.report.conflicts.length,
        auto_applied_count: result.report.auto_applied_count
      }
    });
  } catch (error) {
    console.error("connectorTallyInboundSnapshot error:", error);
    return res.status(500).json({ message: "Unable to process Tally inbound snapshot" });
  }
};

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
