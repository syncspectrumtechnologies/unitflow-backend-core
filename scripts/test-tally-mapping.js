const assert = require("node:assert/strict");
const { mapVoucherRecord, normalizeMappingRules, stockItemsFromVouchers, systemLedgers } = require("../src/services/tallyMappingRules");

const rules = normalizeMappingRules();

const sameStateInvoice = mapVoucherRecord({
  source_type: "INVOICE",
  voucher_no: "UF-INV-100",
  party_ledger_name: "Apex Components",
  amount: 1180,
  subtotal: 1000,
  charges: [{ type: "TAX", title: "GST 18%", amount: 180 }],
  items: [{ product_id: "p1", name: "Gear Box", unit: "PCS", quantity: 2, unit_price: 500, line_total: 1000 }]
}, {
  seller_gstin: "27ABCDE1234F1Z5",
  party_gstin: "27AAAAA0000A1Z5"
}, rules);

assert.equal(sameStateInvoice.voucher_type, "Sales");
assert.ok(sameStateInvoice.ledger_entries.some((row) => row.ledger_name === rules.ledgers.output_cgst && row.amount === 90));
assert.ok(sameStateInvoice.ledger_entries.some((row) => row.ledger_name === rules.ledgers.output_sgst && row.amount === 90));
assert.equal(sameStateInvoice.inventory_entries[0].stock_item_name, "Gear Box");
assert.equal(sameStateInvoice.inventory_entries[0].unit, "PCS");

const interStateInvoice = mapVoucherRecord({
  source_type: "INVOICE",
  party_ledger_name: "Delhi Buyer",
  amount: 1180,
  subtotal: 1000,
  charges: [{ type: "TAX", title: "GST 18%", amount: 180 }]
}, {
  seller_gstin: "27ABCDE1234F1Z5",
  party_gstin: "07AAAAA0000A1Z5"
}, rules);

assert.ok(interStateInvoice.ledger_entries.some((row) => row.ledger_name === rules.ledgers.output_igst && row.amount === 180));

const purchase = mapVoucherRecord({
  source_type: "PURCHASE",
  party_ledger_name: "Supplier One",
  amount: 590,
  subtotal: 500,
  charges: [{ type: "TAX", title: "IGST 18%", amount: 90 }]
}, {}, rules);

assert.ok(purchase.ledger_entries.some((row) => row.ledger_name === rules.ledgers.input_igst && row.amount === -90));
assert.ok(stockItemsFromVouchers([sameStateInvoice], rules).some((row) => row.stock_item_name === "Gear Box"));
assert.ok(systemLedgers(rules).some((row) => row.ledger_name === rules.ledgers.sales));

console.log("Tally mapping rules fixture passed");
