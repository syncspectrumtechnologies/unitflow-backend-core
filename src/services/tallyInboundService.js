const prisma = require("../config/db");
const { buildSyncPlan, text, normalizeLimit } = require("./tallyService");
const { amount, reconcileSnapshots } = require("./tallyReconciliationService");

const STRATEGIES = new Set(["REVIEW", "UNITFLOW_WINS", "TALLY_WINS"]);

function dateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sanitizeStrategy(value) {
  const strategy = text(value, 32).toUpperCase();
  return STRATEGIES.has(strategy) ? strategy : "REVIEW";
}

function normalizeSnapshot(body = {}) {
  return {
    from_date: dateOrNull(body.from_date || body.fromDate),
    to_date: dateOrNull(body.to_date || body.toDate),
    ledgers: Array.isArray(body.ledgers) ? body.ledgers.slice(0, 5000) : [],
    ledger_balances: Array.isArray(body.ledger_balances) ? body.ledger_balances.slice(0, 5000) : [],
    vouchers: Array.isArray(body.vouchers) ? body.vouchers.slice(0, 10000) : [],
    source: text(body.source, 80) || "connector",
    raw_counts: {
      ledgers: Array.isArray(body.ledgers) ? body.ledgers.length : 0,
      ledger_balances: Array.isArray(body.ledger_balances) ? body.ledger_balances.length : 0,
      vouchers: Array.isArray(body.vouchers) ? body.vouchers.length : 0
    }
  };
}

async function upsertOpenConflict(tx, company_id, integration_id, item) {
  const where = {
    company_id,
    integration_id,
    status: "OPEN",
    entity_type: item.entity_type,
    conflict_type: item.conflict_type,
    source_type: item.source_type || null,
    source_id: item.source_id || null,
    tally_guid: item.tally_guid || null,
    tally_name: item.tally_name || null
  };
  const existing = await tx.tallyConflict.findFirst({ where, select: { id: true } });
  const data = {
    severity: item.severity || "MEDIUM",
    unitflow_snapshot: item.unitflow_snapshot || null,
    tally_snapshot: item.tally_snapshot || null,
    difference: item.difference === undefined ? null : amount(item.difference)
  };
  if (existing) return tx.tallyConflict.update({ where: { id: existing.id }, data });
  return tx.tallyConflict.create({ data: { ...where, ...data } });
}

function safeClientPatchFromLedger(ledger = {}) {
  const snap = ledger.tally_snapshot || ledger;
  const data = {};
  const name = text(snap.ledger_name || snap.tally_ledger_name || snap.name, 160);
  const email = text(snap.email, 160);
  const phone = text(snap.phone, 40);
  const gstin = text(snap.gstin, 32);
  const address = text(snap.address, 500);
  if (name) data.company_name = name;
  if (email) data.email = email;
  if (phone) data.mobile_no = phone;
  if (gstin) data.gstin = gstin;
  if (address) data.address = address;
  if (snap.opening_balance !== undefined && snap.opening_balance !== null) {
    data.opening_balance_amount = amount(snap.opening_balance);
  }
  return data;
}

async function applyTallyLedgerWins(tx, company_id, conflicts, actor) {
  let applied = 0;
  for (const conflict of conflicts) {
    if (conflict.entity_type !== "LEDGER" || conflict.source_type !== "CLIENT" || !conflict.source_id || !conflict.tally_snapshot) continue;
    const data = safeClientPatchFromLedger(conflict);
    if (Object.keys(data).length === 0) continue;

    if (data.company_name) {
      const duplicate = await tx.client.findFirst({
        where: {
          company_id,
          company_name: data.company_name,
          id: { not: conflict.source_id }
        },
        select: { id: true }
      });
      if (duplicate) continue;
    }

    const updated = await tx.client.updateMany({
      where: { id: conflict.source_id, company_id, is_active: true },
      data
    });
    if (updated.count) {
      applied += 1;
      await tx.tallySyncLog.create({
        data: {
          company_id,
          integration_id: conflict.integration_id,
          direction: "INBOUND",
          entity_type: "CLIENT_LEDGER",
          entity_id: conflict.source_id,
          action: "TALLY_WINS_APPLIED",
          status: "SYNCED",
          message: "Safe Tally ledger fields applied to client",
          created_by: actor,
          completed_at: new Date()
        }
      });
    }
  }
  return applied;
}

async function processInboundSnapshot({ company_id, integration, body, actor = "tally-connector" }) {
  const snapshot = normalizeSnapshot(body);
  const tolerance = amount(body?.tolerance ?? integration.reconciliation_tolerance ?? 1);
  const unitflowSnapshot = await buildSyncPlan(company_id, {
    from_date: snapshot.from_date,
    to_date: snapshot.to_date,
    limit: normalizeLimit(body?.limit, 5000, 10000)
  });
  const report = reconcileSnapshots({ unitflowSnapshot, tallySnapshot: snapshot, tolerance });
  const strategy = sanitizeStrategy(body?.conflict_strategy || integration.conflict_strategy);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const run = await tx.tallyReconciliationRun.create({
      data: {
        company_id,
        integration_id: integration.id,
        status: report.status,
        from_date: snapshot.from_date,
        to_date: snapshot.to_date,
        matched_count: report.matched_count,
        mismatch_count: report.mismatch_count,
        missing_in_tally_count: report.missing_in_tally_count,
        missing_in_unitflow_count: report.missing_in_unitflow_count,
        ledger_conflict_count: report.ledger_conflict_count,
        unitflow_total: report.unitflow_total,
        tally_total: report.tally_total,
        total_difference: report.total_difference,
        tolerance,
        source: snapshot.source,
        created_by: actor,
        meta: {
          raw_counts: snapshot.raw_counts,
          conflict_strategy: strategy,
          conflict_count: report.conflicts.length
        },
        completed_at: now
      }
    });

    const openConflicts = [];
    for (const item of report.conflicts) {
      const saved = await upsertOpenConflict(tx, company_id, integration.id, item);
      openConflicts.push(saved);
    }

    let applied = 0;
    if (integration.allow_tally_import && strategy === "TALLY_WINS") {
      applied = await applyTallyLedgerWins(tx, company_id, openConflicts, actor);
      if (applied) {
        await tx.tallyConflict.updateMany({
          where: {
            id: { in: openConflicts.filter((row) => row.entity_type === "LEDGER").map((row) => row.id) }
          },
          data: {
            status: "RESOLVED",
            resolution: "AUTO_APPLIED_TALLY_WINS",
            resolved_by: actor,
            resolved_at: now
          }
        });
      }
    }

    await tx.tallyIntegration.update({
      where: { id: integration.id },
      data: {
        status: report.status === "OK" ? "SYNCED" : "NEEDS_ATTENTION",
        connector_last_seen_at: now,
        last_inbound_sync_at: now,
        last_sync_completed_at: now,
        last_error: report.status === "OK" ? null : `${report.conflicts.length} reconciliation issue(s)`
      }
    });

    await tx.tallySyncLog.create({
      data: {
        company_id,
        integration_id: integration.id,
        direction: "INBOUND",
        entity_type: "RECONCILIATION",
        entity_id: run.id,
        action: "TALLY_SNAPSHOT_RECONCILED",
        status: report.status,
        message: `${report.conflicts.length} issue(s), ${applied} auto-applied`,
        created_by: actor,
        completed_at: now
      }
    });

    return { run, report: { ...report, auto_applied_count: applied } };
  });
}

module.exports = {
  normalizeSnapshot,
  sanitizeStrategy,
  safeClientPatchFromLedger,
  processInboundSnapshot
};
