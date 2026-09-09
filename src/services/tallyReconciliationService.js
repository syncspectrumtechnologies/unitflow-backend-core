function text(value, max = 255) {
  const out = String(value ?? "").trim();
  return out ? out.slice(0, max) : "";
}

function amount(value) {
  const n = Number(String(value ?? 0).replace(/,/g, ""));
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function absDiff(a, b) {
  return Number(Math.abs(amount(a) - amount(b)).toFixed(2));
}

function dateKey(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw.slice(0, 10) : date.toISOString().slice(0, 10);
}

function norm(value) {
  return text(value, 200).toLowerCase().replace(/\s+/g, " ");
}

function voucherKey(row = {}) {
  const sourceType = text(row.source_type, 60).toUpperCase();
  const sourceId = text(row.source_id, 160);
  if (sourceType && sourceId) return `${sourceType}:${sourceId}`;
  const type = norm(row.voucher_type || row.tally_voucher_type);
  const no = norm(row.voucher_no || row.voucher_number || row.tally_voucher_number);
  return type && no ? `${type}:${no}` : "";
}

function ledgerKey(row = {}) {
  return norm(row.ledger_name || row.tally_ledger_name || row.name);
}

function normalizeUnitflowVouchers(snapshot = {}) {
  return [
    ...(snapshot.sales_invoices || []),
    ...(snapshot.receipts || []),
    ...(snapshot.purchases || []),
    ...(snapshot.accounting_vouchers || [])
  ].map((row) => ({
    ...row,
    key: voucherKey(row),
    voucher_no: row.voucher_no || row.payment_no || row.purchase_no || row.id,
    voucher_type: row.voucher_type || row.source_type,
    date: dateKey(row.date),
    amount: amount(row.amount)
  })).filter((row) => row.key);
}

function normalizeTallyVouchers(snapshot = {}) {
  const rows = Array.isArray(snapshot.vouchers) ? snapshot.vouchers : [];
  return rows.map((row) => ({
    ...row,
    key: voucherKey(row),
    voucher_no: row.voucher_no || row.voucher_number || row.tally_voucher_number,
    voucher_type: row.voucher_type || row.tally_voucher_type,
    date: dateKey(row.date || row.voucher_date),
    amount: amount(row.amount)
  })).filter((row) => row.key);
}

function normalizeUnitflowLedgers(snapshot = {}) {
  return (snapshot.ledgers || []).map((row) => ({
    ...row,
    key: ledgerKey(row),
    ledger_name: row.ledger_name || row.tally_ledger_name || row.name,
    opening_balance: amount(row.opening_balance),
    closing_balance: amount(row.closing_balance),
    gstin: text(row.gstin, 32),
    email: text(row.email, 160),
    phone: text(row.phone, 40)
  })).filter((row) => row.key);
}

function normalizeTallyLedgers(snapshot = {}) {
  const rows = Array.isArray(snapshot.ledgers) ? snapshot.ledgers : Array.isArray(snapshot.ledger_balances) ? snapshot.ledger_balances : [];
  return rows.map((row) => ({
    ...row,
    key: ledgerKey(row),
    ledger_name: row.ledger_name || row.tally_ledger_name || row.name,
    opening_balance: amount(row.opening_balance),
    closing_balance: amount(row.closing_balance),
    gstin: text(row.gstin, 32),
    email: text(row.email, 160),
    phone: text(row.phone, 40)
  })).filter((row) => row.key);
}

function summarize(row) {
  if (!row) return null;
  return {
    source_type: row.source_type || null,
    source_id: row.source_id || null,
    voucher_no: row.voucher_no || row.voucher_number || null,
    voucher_type: row.voucher_type || null,
    ledger_name: row.ledger_name || row.tally_ledger_name || row.name || null,
    date: row.date || row.voucher_date || null,
    amount: row.amount === undefined ? null : amount(row.amount),
    closing_balance: row.closing_balance === undefined ? null : amount(row.closing_balance),
    gstin: row.gstin || null,
    email: row.email || null,
    phone: row.phone || null
  };
}

function conflict(base) {
  return {
    severity: base.severity || "MEDIUM",
    status: "OPEN",
    ...base
  };
}

function reconcileSnapshots({ unitflowSnapshot = {}, tallySnapshot = {}, tolerance = 1 }) {
  const limit = Math.max(0, amount(tolerance));
  const ufVouchers = normalizeUnitflowVouchers(unitflowSnapshot);
  const tallyVouchers = normalizeTallyVouchers(tallySnapshot);
  const ufLedgers = normalizeUnitflowLedgers(unitflowSnapshot);
  const tallyLedgers = normalizeTallyLedgers(tallySnapshot);
  const tallyVoucherByKey = new Map(tallyVouchers.map((row) => [row.key, row]));
  const ufVoucherByKey = new Map(ufVouchers.map((row) => [row.key, row]));
  const tallyLedgerByKey = new Map(tallyLedgers.map((row) => [row.key, row]));
  const ufLedgerByKey = new Map(ufLedgers.map((row) => [row.key, row]));
  const conflicts = [];
  let matched = 0;

  for (const row of ufVouchers) {
    const tally = tallyVoucherByKey.get(row.key);
    if (!tally) {
      conflicts.push(conflict({
        entity_type: "VOUCHER",
        source_type: row.source_type,
        source_id: row.source_id,
        conflict_type: "MISSING_IN_TALLY",
        severity: "HIGH",
        unitflow_snapshot: summarize(row),
        tally_snapshot: null
      }));
      continue;
    }
    const diff = absDiff(row.amount, tally.amount);
    if (diff > limit || (row.date && tally.date && row.date !== tally.date)) {
      conflicts.push(conflict({
        entity_type: "VOUCHER",
        source_type: row.source_type,
        source_id: row.source_id,
        tally_guid: tally.guid || tally.tally_guid || null,
        tally_name: tally.voucher_no || tally.voucher_number || null,
        conflict_type: diff > limit ? "AMOUNT_MISMATCH" : "DATE_MISMATCH",
        severity: "HIGH",
        difference: diff,
        unitflow_snapshot: summarize(row),
        tally_snapshot: summarize(tally)
      }));
    } else {
      matched += 1;
    }
  }

  for (const row of tallyVouchers) {
    if (ufVoucherByKey.has(row.key)) continue;
    conflicts.push(conflict({
      entity_type: "VOUCHER",
      source_type: row.source_type || null,
      source_id: row.source_id || null,
      tally_guid: row.guid || row.tally_guid || null,
      tally_name: row.voucher_no || row.voucher_number || null,
      conflict_type: "MISSING_IN_UNITFLOW",
      severity: "HIGH",
      unitflow_snapshot: null,
      tally_snapshot: summarize(row)
    }));
  }

  for (const row of ufLedgers) {
    const tally = tallyLedgerByKey.get(row.key);
    if (!tally) {
      conflicts.push(conflict({
        entity_type: "LEDGER",
        source_type: "CLIENT",
        source_id: row.source_id,
        conflict_type: "LEDGER_MISSING_IN_TALLY",
        severity: "MEDIUM",
        unitflow_snapshot: summarize(row),
        tally_snapshot: null
      }));
      continue;
    }
    const diff = absDiff(row.closing_balance, tally.closing_balance);
    const changedFields = [];
    if (diff > limit) changedFields.push("closing_balance");
    if (row.gstin && tally.gstin && norm(row.gstin) !== norm(tally.gstin)) changedFields.push("gstin");
    if (row.email && tally.email && norm(row.email) !== norm(tally.email)) changedFields.push("email");
    if (row.phone && tally.phone && norm(row.phone) !== norm(tally.phone)) changedFields.push("phone");
    if (changedFields.length) {
      conflicts.push(conflict({
        entity_type: "LEDGER",
        source_type: "CLIENT",
        source_id: row.source_id,
        tally_guid: tally.guid || tally.tally_guid || null,
        tally_name: tally.ledger_name,
        conflict_type: "LEDGER_FIELD_MISMATCH",
        severity: diff > limit ? "HIGH" : "MEDIUM",
        difference: diff,
        unitflow_snapshot: { ...summarize(row), changed_fields: changedFields },
        tally_snapshot: { ...summarize(tally), changed_fields: changedFields }
      }));
    }
  }

  for (const row of tallyLedgers) {
    if (ufLedgerByKey.has(row.key)) continue;
    conflicts.push(conflict({
      entity_type: "LEDGER",
      source_type: "CLIENT",
      source_id: null,
      tally_guid: row.guid || row.tally_guid || null,
      tally_name: row.ledger_name,
      conflict_type: "LEDGER_MISSING_IN_UNITFLOW",
      severity: "MEDIUM",
      unitflow_snapshot: null,
      tally_snapshot: summarize(row)
    }));
  }

  const unitflowTotal = amount(ufVouchers.reduce((sum, row) => sum + amount(row.amount), 0));
  const tallyTotal = amount(tallyVouchers.reduce((sum, row) => sum + amount(row.amount), 0));
  const mismatchCount = conflicts.filter((row) => ["AMOUNT_MISMATCH", "DATE_MISMATCH"].includes(row.conflict_type)).length;
  const missingInTally = conflicts.filter((row) => row.conflict_type.endsWith("MISSING_IN_TALLY") || row.conflict_type === "MISSING_IN_TALLY").length;
  const missingInUnitflow = conflicts.filter((row) => row.conflict_type.endsWith("MISSING_IN_UNITFLOW") || row.conflict_type === "MISSING_IN_UNITFLOW").length;
  const ledgerConflictCount = conflicts.filter((row) => row.entity_type === "LEDGER").length;

  return {
    status: conflicts.some((row) => row.severity === "HIGH") ? "NEEDS_ATTENTION" : "OK",
    tolerance: limit,
    matched_count: matched,
    mismatch_count: mismatchCount,
    missing_in_tally_count: missingInTally,
    missing_in_unitflow_count: missingInUnitflow,
    ledger_conflict_count: ledgerConflictCount,
    unitflow_total: unitflowTotal,
    tally_total: tallyTotal,
    total_difference: absDiff(unitflowTotal, tallyTotal),
    conflicts
  };
}

module.exports = {
  amount,
  dateKey,
  voucherKey,
  ledgerKey,
  reconcileSnapshots
};
