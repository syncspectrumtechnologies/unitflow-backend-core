const crypto = require("crypto");
const prisma = require("../config/db");

const SOURCE_TYPES = new Set(["CLIENT", "INVOICE", "PAYMENT", "PURCHASE", "ACCOUNTING_VOUCHER"]);
const RESULT_STATUSES = new Set(["SYNCED", "FAILED", "SKIPPED", "PENDING"]);

function text(value, max = 255) {
  const out = String(value ?? "").trim();
  return out ? out.slice(0, max) : "";
}

function bool(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function intRange(value, fallback, min, max) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function number(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function dateOnly(date) {
  if (!date) return null;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseSince(value) {
  const raw = text(value, 40);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeLimit(value, fallback = 250, max = 500) {
  return intRange(value, fallback, 1, max);
}

function dateRange(from, to) {
  const start = from instanceof Date ? from : parseSince(from);
  const end = to instanceof Date ? to : parseSince(to);
  if (!start && !end) return null;
  return {
    ...(start ? { gte: start } : {}),
    ...(end ? { lte: end } : {})
  };
}

function tokenPepper() {
  return process.env.TALLY_CONNECTOR_TOKEN_PEPPER || process.env.JWT_SECRET || process.env.PLATFORM_INTERNAL_API_KEY || "";
}

function hashConnectorToken(token) {
  return crypto.createHash("sha256").update(`${tokenPepper()}:${String(token || "")}`).digest("hex");
}

function createConnectorToken() {
  return `uf_tally_${crypto.randomBytes(32).toString("base64url")}`;
}

async function ensureIntegration(company_id, created_by = null) {
  return prisma.tallyIntegration.upsert({
    where: { company_id },
    update: {},
    create: { company_id, created_by }
  });
}

function serializeIntegration(row) {
  if (!row) return null;
  return {
    id: row.id,
    company_id: row.company_id,
    enabled: row.enabled,
    status: row.status,
    tally_company_name: row.tally_company_name,
    tally_url_hint: row.tally_url_hint,
    sync_ledgers: row.sync_ledgers,
    sync_vouchers: row.sync_vouchers,
    sync_invoices: row.sync_invoices,
    sync_payments: row.sync_payments,
    auto_sync: row.auto_sync,
    sync_interval_minutes: row.sync_interval_minutes,
    allow_tally_import: row.allow_tally_import,
    conflict_strategy: row.conflict_strategy,
    reconciliation_tolerance: number(row.reconciliation_tolerance),
    connector_token_last4: row.connector_token_last4,
    connector_ready: Boolean(row.connector_token_hash),
    connector_last_seen_at: row.connector_last_seen_at,
    last_sync_started_at: row.last_sync_started_at,
    last_sync_completed_at: row.last_sync_completed_at,
    last_inbound_sync_at: row.last_inbound_sync_at,
    last_error: row.last_error,
    updated_at: row.updated_at
  };
}

function normalizeSettingsPayload(body = {}, existing = {}) {
  return {
    enabled: bool(body.enabled, existing.enabled || false),
    status: bool(body.enabled, existing.enabled || false) ? existing.status || "DISCONNECTED" : "DISABLED",
    tally_company_name: text(body.tally_company_name, 160) || null,
    tally_url_hint: text(body.tally_url_hint, 220) || "http://localhost:9000",
    sync_ledgers: bool(body.sync_ledgers, existing.sync_ledgers !== false),
    sync_vouchers: bool(body.sync_vouchers, existing.sync_vouchers !== false),
    sync_invoices: bool(body.sync_invoices, existing.sync_invoices !== false),
    sync_payments: bool(body.sync_payments, existing.sync_payments !== false),
    auto_sync: bool(body.auto_sync, existing.auto_sync || false),
    sync_interval_minutes: intRange(body.sync_interval_minutes, existing.sync_interval_minutes || 15, 5, 1440),
    allow_tally_import: bool(body.allow_tally_import, existing.allow_tally_import || false),
    conflict_strategy: ["REVIEW", "UNITFLOW_WINS", "TALLY_WINS"].includes(text(body.conflict_strategy, 32).toUpperCase())
      ? text(body.conflict_strategy, 32).toUpperCase()
      : existing.conflict_strategy || "REVIEW",
    reconciliation_tolerance: number(body.reconciliation_tolerance ?? existing.reconciliation_tolerance ?? 1)
  };
}

function cleanStatus(value) {
  const status = text(value, 24).toUpperCase();
  return RESULT_STATUSES.has(status) ? status : "PENDING";
}

function linkMap(rows) {
  const map = new Map();
  for (const row of rows || []) map.set(`${row.source_type}:${row.source_id}`, row);
  return map;
}

function ledgerNameForClient(client) {
  return text(client.company_name, 160) || `Client ${client.id}`;
}

function partyAddress(client) {
  return [client.address, client.city, client.state, client.pincode, client.country].map((v) => text(v, 80)).filter(Boolean).join(", ");
}

async function buildSyncPlan(company_id, options = {}) {
  const integration = await ensureIntegration(company_id);
  const limit = normalizeLimit(options.limit, 250, 5000);
  const since = parseSince(options.since);
  const changed = since ? { updated_at: { gte: since } } : {};
  const range = dateRange(options.from_date, options.to_date);

  const voucherLinks = await prisma.tallyVoucherLink.findMany({
    where: { company_id },
    select: {
      source_type: true,
      source_id: true,
      status: true,
      tally_voucher_guid: true,
      tally_voucher_number: true,
      tally_voucher_type: true,
      last_synced_at: true,
      last_error: true
    }
  });
  const voucherLinkBySource = linkMap(voucherLinks);

  const [clients, invoices, payments, purchases, vouchers] = await Promise.all([
    integration.sync_ledgers
      ? prisma.client.findMany({
          where: { company_id, is_active: true, ...changed },
          orderBy: { updated_at: "asc" },
          take: limit,
          include: { tally_ledger_links: true }
        })
      : [],
    integration.sync_invoices
      ? prisma.invoice.findMany({
          where: { company_id, is_active: true, kind: { not: "PROFORMA" }, ...(range ? { issue_date: range } : {}), ...changed },
          orderBy: { updated_at: "asc" },
          take: limit,
          include: {
            client: { select: { id: true, company_name: true } },
            items: { include: { product: { select: { id: true, name: true, sku: true } } } },
            charges: true
          }
        })
      : [],
    integration.sync_payments
      ? prisma.payment.findMany({
          where: { company_id, status: "RECORDED", ...(range ? { paid_at: range } : since ? { paid_at: { gte: since } } : {}) },
          orderBy: { paid_at: "asc" },
          take: limit,
          include: { client: { select: { id: true, company_name: true } }, allocations: true }
        })
      : [],
    integration.sync_vouchers
      ? prisma.purchase.findMany({
          where: { company_id, is_active: true, ...(range ? { purchase_date: range } : {}), ...changed },
          orderBy: { updated_at: "asc" },
          take: limit,
          include: { client: { select: { id: true, company_name: true } }, items: true, charges: true }
        })
      : [],
    integration.sync_vouchers
      ? prisma.accountingVoucher.findMany({
          where: { company_id, is_active: true, ...(range ? { voucher_date: range } : {}), ...changed },
          orderBy: { updated_at: "asc" },
          take: limit,
          include: { client: { select: { id: true, company_name: true } }, lines: true }
        })
      : []
  ]);

  const ledgers = clients.map((client) => {
    const link = client.tally_ledger_links?.[0] || null;
    return {
      source_type: "CLIENT",
      source_id: client.id,
      ledger_name: link?.tally_ledger_name || ledgerNameForClient(client),
      group: "Sundry Debtors",
      email: client.email || null,
      phone: client.mobile_no || client.phone || null,
      gstin: client.gstin || null,
      address: partyAddress(client) || null,
      opening_balance: number(client.opening_balance_amount),
      opening_balance_type: client.opening_balance_type,
      tally_guid: link?.tally_guid || null,
      tally_master_id: link?.tally_master_id || null,
      last_synced_at: link?.last_synced_at || null
    };
  });

  return {
    generated_at: new Date().toISOString(),
    since: since ? since.toISOString() : null,
    integration: serializeIntegration(integration),
    counts: {
      ledgers: ledgers.length,
      sales_invoices: invoices.length,
      receipts: payments.length,
      purchases: purchases.length,
      accounting_vouchers: vouchers.length
    },
    ledgers,
    sales_invoices: invoices.map((invoice) => ({
      source_type: "INVOICE",
      source_id: invoice.id,
      voucher_type: "Sales",
      voucher_no: invoice.invoice_no,
      date: dateOnly(invoice.issue_date),
      due_date: dateOnly(invoice.due_date),
      client_id: invoice.client_id,
      party_ledger_name: ledgerNameForClient(invoice.client),
      amount: number(invoice.total),
      subtotal: number(invoice.subtotal),
      charges: invoice.charges.map((charge) => ({ title: charge.title, amount: number(charge.amount), type: charge.type })),
      items: invoice.items.map((item) => ({
        product_id: item.product_id,
        name: item.product?.name || item.product?.sku || "Item",
        quantity: number(item.quantity),
        unit_price: number(item.unit_price),
        line_total: number(item.line_total)
      })),
      status: invoice.status,
      tally: voucherLinkBySource.get(`INVOICE:${invoice.id}`) || null
    })),
    receipts: payments.map((payment) => ({
      source_type: "PAYMENT",
      source_id: payment.id,
      voucher_type: "Receipt",
      voucher_no: payment.payment_no || payment.id,
      date: dateOnly(payment.paid_at),
      client_id: payment.client_id,
      party_ledger_name: ledgerNameForClient(payment.client),
      amount: number(payment.amount),
      method: payment.method,
      reference: payment.reference,
      allocations: payment.allocations.map((row) => ({ invoice_id: row.invoice_id, amount: number(row.amount) })),
      tally: voucherLinkBySource.get(`PAYMENT:${payment.id}`) || null
    })),
    purchases: purchases.map((purchase) => ({
      source_type: "PURCHASE",
      source_id: purchase.id,
      voucher_type: "Purchase",
      voucher_no: purchase.purchase_no,
      date: dateOnly(purchase.purchase_date),
      client_id: purchase.client_id,
      party_ledger_name: purchase.client ? ledgerNameForClient(purchase.client) : text(purchase.vendor_name, 160),
      amount: number(purchase.total),
      items: purchase.items.map((item) => ({
        description: item.description,
        quantity: number(item.quantity),
        unit_price: number(item.unit_price),
        line_total: number(item.line_total)
      })),
      charges: purchase.charges.map((charge) => ({ title: charge.label, amount: number(charge.amount) })),
      tally: voucherLinkBySource.get(`PURCHASE:${purchase.id}`) || null
    })),
    accounting_vouchers: vouchers.map((voucher) => ({
      source_type: "ACCOUNTING_VOUCHER",
      source_id: voucher.id,
      voucher_type: String(voucher.voucher_type || "GENERAL").replace(/_/g, " "),
      voucher_no: voucher.voucher_no,
      date: dateOnly(voucher.voucher_date),
      client_id: voucher.client_id,
      party_ledger_name: voucher.client ? ledgerNameForClient(voucher.client) : null,
      amount: number(voucher.total_amount),
      narration: voucher.narration || voucher.particulars || null,
      lines: voucher.lines.map((line) => ({
        account_name: line.account_name,
        entry_type: line.entry_type,
        amount: number(line.amount),
        description: line.description,
        client_id: line.client_id,
        product_id: line.product_id
      })),
      tally: voucherLinkBySource.get(`ACCOUNTING_VOUCHER:${voucher.id}`) || null
    }))
  };
}

module.exports = {
  SOURCE_TYPES,
  RESULT_STATUSES,
  text,
  bool,
  intRange,
  normalizeLimit,
  cleanStatus,
  parseSince,
  hashConnectorToken,
  createConnectorToken,
  ensureIntegration,
  serializeIntegration,
  normalizeSettingsPayload,
  buildSyncPlan
};
