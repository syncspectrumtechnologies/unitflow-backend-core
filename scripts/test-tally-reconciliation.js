const assert = require("node:assert/strict");
const { reconcileSnapshots } = require("../src/services/tallyReconciliationService");

const unitflowSnapshot = {
  ledgers: [
    { source_type: "CLIENT", source_id: "client-a", ledger_name: "Apex Components", gstin: "27ABCDE1234F1Z5", email: "accounts@apex.test", phone: "9999999999", closing_balance: 45000 },
    { source_type: "CLIENT", source_id: "client-b", ledger_name: "Bright Traders", closing_balance: 12000 }
  ],
  sales_invoices: [
    { source_type: "INVOICE", source_id: "inv-001", voucher_type: "Sales", voucher_no: "UF-INV-001", date: "2026-08-01", amount: 45000 },
    { source_type: "INVOICE", source_id: "inv-002", voucher_type: "Sales", voucher_no: "UF-INV-002", date: "2026-08-02", amount: 12000 }
  ],
  receipts: [
    { source_type: "PAYMENT", source_id: "pay-001", voucher_type: "Receipt", voucher_no: "UF-PAY-001", date: "2026-08-05", amount: 10000 }
  ],
  purchases: [],
  accounting_vouchers: []
};

const tallySnapshot = {
  ledgers: [
    { ledger_name: "Apex Components", gstin: "27ABCDE1234F1Z5", email: "accounts@apex.test", phone: "9999999999", closing_balance: 45000 },
    { ledger_name: "Bright Traders", closing_balance: 9000 },
    { ledger_name: "Tally Only Client", closing_balance: 500 }
  ],
  vouchers: [
    { source_type: "INVOICE", source_id: "inv-001", voucher_type: "Sales", voucher_no: "UF-INV-001", date: "2026-08-01", amount: 45000 },
    { source_type: "INVOICE", source_id: "inv-002", voucher_type: "Sales", voucher_no: "UF-INV-002", date: "2026-08-02", amount: 12500 },
    { voucher_type: "Receipt", voucher_no: "TALLY-RCPT-ONLY", date: "2026-08-06", amount: 7000 }
  ]
};

const report = reconcileSnapshots({ unitflowSnapshot, tallySnapshot, tolerance: 1 });

assert.equal(report.status, "NEEDS_ATTENTION");
assert.equal(report.matched_count, 1);
assert.equal(report.mismatch_count, 1);
assert.equal(report.missing_in_tally_count, 1);
assert.equal(report.missing_in_unitflow_count, 2);
assert.equal(report.ledger_conflict_count, 2);
assert.ok(report.conflicts.some((row) => row.conflict_type === "AMOUNT_MISMATCH" && row.difference === 500));
assert.ok(report.conflicts.some((row) => row.conflict_type === "MISSING_IN_TALLY"));
assert.ok(report.conflicts.some((row) => row.conflict_type === "LEDGER_FIELD_MISMATCH" && row.difference === 3000));

console.log("Tally reconciliation fixture passed");
