const DEFAULT_TALLY_MAPPING_RULES = Object.freeze({
  version: "2026-09-12",
  ledgers: {
    sales: "UnitFlow Sales",
    purchase: "UnitFlow Purchases",
    cash: "UnitFlow Cash",
    bank: "UnitFlow Bank",
    round_off: "UnitFlow Round Off",
    output_cgst: "UnitFlow Output CGST",
    output_sgst: "UnitFlow Output SGST",
    output_igst: "UnitFlow Output IGST",
    input_cgst: "UnitFlow Input CGST",
    input_sgst: "UnitFlow Input SGST",
    input_igst: "UnitFlow Input IGST",
    freight_outward: "UnitFlow Freight Outward",
    freight_inward: "UnitFlow Freight Inward",
    discount_allowed: "UnitFlow Discount Allowed",
    discount_received: "UnitFlow Discount Received",
    other_income: "UnitFlow Other Income",
    other_expense: "UnitFlow Other Expense"
  },
  groups: {
    sales: "Sales Accounts",
    purchase: "Purchase Accounts",
    cash: "Cash-in-Hand",
    bank: "Bank Accounts",
    tax: "Duties & Taxes",
    income: "Indirect Incomes",
    expense: "Indirect Expenses",
    debtor: "Sundry Debtors",
    creditor: "Sundry Creditors"
  },
  inventory: {
    enabled: true,
    create_stock_items: true,
    default_unit: "PCS",
    default_stock_group: "Primary"
  },
  gst: {
    enabled: true,
    source: "stored_invoice_purchase_charges",
    generic_gst_split: true,
    tolerance: 1
  },
  vouchers: {
    invoice: "Sales",
    receipt: "Receipt",
    purchase: "Purchase",
    accounting_default: "Journal"
  }
});

function text(value, max = 160) {
  const out = String(value ?? "").trim();
  return out ? out.slice(0, max) : "";
}

function num(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round(value) {
  return Math.round(num(value) * 100) / 100;
}

function cleanCode(value) {
  const out = text(value, 16).replace(/\D/g, "");
  return out.slice(0, 2);
}

function stateCodeFromGstin(value) {
  return cleanCode(text(value, 32).slice(0, 2));
}

function deepMerge(base, custom) {
  if (!custom || typeof custom !== "object" || Array.isArray(custom)) return { ...base };
  const out = { ...base };
  for (const [key, value] of Object.entries(custom)) {
    if (!(key in base)) continue;
    if (base[key] && typeof base[key] === "object" && !Array.isArray(base[key])) out[key] = deepMerge(base[key], value);
    else if (["string", "number", "boolean"].includes(typeof value)) out[key] = value;
  }
  return out;
}

function normalizeMappingRules(custom) {
  const merged = deepMerge(DEFAULT_TALLY_MAPPING_RULES, custom);
  merged.version = DEFAULT_TALLY_MAPPING_RULES.version;
  return merged;
}

function ledgerEntry(ledger_name, value, role, extra = {}) {
  const amount = round(value);
  return {
    ledger_name,
    amount,
    is_deemed_positive: amount < 0 ? "Yes" : "No",
    role,
    ...extra
  };
}

function isTaxCharge(charge = {}) {
  return String(charge.type || "").toUpperCase() === "TAX" || /\b(cgst|sgst|igst|gst)\b/i.test(String(charge.title || charge.label || ""));
}

function taxKind(charge = {}) {
  const label = String(charge.title || charge.label || "").toUpperCase();
  if (label.includes("CGST")) return "CGST";
  if (label.includes("SGST")) return "SGST";
  if (label.includes("IGST")) return "IGST";
  return "GST";
}

function isInterState(context = {}) {
  const seller = cleanCode(context.seller_state_code) || stateCodeFromGstin(context.seller_gstin);
  const party = cleanCode(context.party_state_code) || stateCodeFromGstin(context.party_gstin);
  if (!seller || !party) return false;
  return seller !== party;
}

function taxLedgerKey(kind, direction) {
  const side = direction === "PURCHASE" ? "input" : "output";
  return `${side}_${String(kind || "GST").toLowerCase()}`;
}

function splitTaxCharge(charge, direction, rules, context) {
  const amount = round(charge.amount);
  if (!amount) return [];
  const sign = direction === "PURCHASE" ? -1 : 1;
  const kind = taxKind(charge);

  if (kind === "GST" && rules.gst.generic_gst_split && !isInterState(context)) {
    const half = round(amount / 2);
    const rest = round(amount - half);
    return [
      ledgerEntry(rules.ledgers[taxLedgerKey("CGST", direction)], sign * half, "TAX", { tax_kind: "CGST", source_charge_title: charge.title || charge.label }),
      ledgerEntry(rules.ledgers[taxLedgerKey("SGST", direction)], sign * rest, "TAX", { tax_kind: "SGST", source_charge_title: charge.title || charge.label })
    ];
  }

  const mappedKind = kind === "GST" ? "IGST" : kind;
  return [
    ledgerEntry(rules.ledgers[taxLedgerKey(mappedKind, direction)], sign * amount, "TAX", {
      tax_kind: mappedKind,
      source_charge_title: charge.title || charge.label
    })
  ];
}

function chargeLedger(charge, direction, rules) {
  const label = String(charge.title || charge.label || "").toLowerCase();
  if (label.includes("freight") || label.includes("shipping")) {
    return direction === "PURCHASE" ? rules.ledgers.freight_inward : rules.ledgers.freight_outward;
  }
  if (label.includes("discount")) {
    return direction === "PURCHASE" ? rules.ledgers.discount_received : rules.ledgers.discount_allowed;
  }
  return direction === "PURCHASE" ? rules.ledgers.other_expense : rules.ledgers.other_income;
}

function chargeEntries(charges = [], direction, rules, context) {
  const rows = [];
  for (const charge of charges || []) {
    if (isTaxCharge(charge)) rows.push(...splitTaxCharge(charge, direction, rules, context));
    else {
      const signed = direction === "PURCHASE" ? -round(charge.amount) : round(charge.amount);
      if (signed) rows.push(ledgerEntry(chargeLedger(charge, direction, rules), signed, "CHARGE", { source_charge_title: charge.title || charge.label }));
    }
  }
  return rows;
}

function itemName(item = {}) {
  return text(item.name || item.sku || item.description || item.product_name || "Item", 180);
}

function inventoryEntries(items = [], rules) {
  if (!rules.inventory.enabled) return [];
  return (items || []).map((item) => ({
    stock_item_name: itemName(item),
    product_id: item.product_id || null,
    quantity: round(item.quantity),
    unit: text(item.unit, 24) || rules.inventory.default_unit,
    rate: round(item.unit_price),
    amount: round(item.line_total)
  })).filter((row) => row.stock_item_name && row.quantity);
}

function paymentLedger(method, rules) {
  return /cash/i.test(String(method || "")) ? rules.ledgers.cash : rules.ledgers.bank;
}

function mapVoucherRecord(record, context = {}, customRules = null) {
  const rules = normalizeMappingRules(customRules);
  const type = String(record.source_type || "").toUpperCase();
  const total = round(record.amount);
  let ledger_entries = [];

  if (type === "INVOICE") {
    ledger_entries = [
      ledgerEntry(record.party_ledger_name || "Suspense", -total, "PARTY"),
      ledgerEntry(rules.ledgers.sales, round(record.subtotal || total), "SALES"),
      ...chargeEntries(record.charges || [], "SALES", rules, context)
    ];
  } else if (type === "PURCHASE") {
    ledger_entries = [
      ledgerEntry(rules.ledgers.purchase, -round(record.subtotal || total), "PURCHASE"),
      ...chargeEntries(record.charges || [], "PURCHASE", rules, context),
      ledgerEntry(record.party_ledger_name || "Suspense", total, "PARTY")
    ];
  } else if (type === "PAYMENT") {
    ledger_entries = [
      ledgerEntry(paymentLedger(record.method, rules), total, "RECEIPT_MODE"),
      ledgerEntry(record.party_ledger_name || "Suspense", -total, "PARTY")
    ];
  } else if (Array.isArray(record.lines) && record.lines.length >= 2) {
    ledger_entries = record.lines.map((line) => {
      const debit = String(line.entry_type || "").toUpperCase() === "DEBIT";
      return ledgerEntry(line.account_name || "Suspense", debit ? -round(line.amount) : round(line.amount), "ACCOUNTING_LINE", {
        source_line_description: line.description || null
      });
    });
  } else {
    ledger_entries = [
      ledgerEntry(record.party_ledger_name || "Suspense", -total, "PARTY"),
      ledgerEntry(rules.ledgers.sales, total, "SALES")
    ];
  }

  return {
    ...record,
    voucher_type: type === "INVOICE" ? rules.vouchers.invoice : type === "PURCHASE" ? rules.vouchers.purchase : type === "PAYMENT" ? rules.vouchers.receipt : record.voucher_type || rules.vouchers.accounting_default,
    ledger_entries: ledger_entries.filter((row) => row.ledger_name && row.amount !== 0),
    inventory_entries: inventoryEntries(record.items || [], rules),
    gst_context: {
      seller_gstin: context.seller_gstin || null,
      seller_state_code: cleanCode(context.seller_state_code) || stateCodeFromGstin(context.seller_gstin) || null,
      party_gstin: context.party_gstin || null,
      party_state_code: cleanCode(context.party_state_code) || stateCodeFromGstin(context.party_gstin) || null,
      place_of_supply: isInterState(context) ? "INTER_STATE" : "INTRA_STATE_OR_UNKNOWN"
    },
    mapping_version: rules.version
  };
}

function systemLedgers(customRules = null) {
  const rules = normalizeMappingRules(customRules);
  const rows = [
    [rules.ledgers.sales, rules.groups.sales],
    [rules.ledgers.purchase, rules.groups.purchase],
    [rules.ledgers.cash, rules.groups.cash],
    [rules.ledgers.bank, rules.groups.bank],
    [rules.ledgers.output_cgst, rules.groups.tax],
    [rules.ledgers.output_sgst, rules.groups.tax],
    [rules.ledgers.output_igst, rules.groups.tax],
    [rules.ledgers.input_cgst, rules.groups.tax],
    [rules.ledgers.input_sgst, rules.groups.tax],
    [rules.ledgers.input_igst, rules.groups.tax],
    [rules.ledgers.freight_outward, rules.groups.expense],
    [rules.ledgers.freight_inward, rules.groups.expense],
    [rules.ledgers.discount_allowed, rules.groups.expense],
    [rules.ledgers.discount_received, rules.groups.income],
    [rules.ledgers.other_income, rules.groups.income],
    [rules.ledgers.other_expense, rules.groups.expense],
    [rules.ledgers.round_off, rules.groups.expense]
  ];
  return [...new Map(rows.filter(([name]) => name).map(([ledger_name, group]) => [ledger_name, {
    source_type: "SYSTEM_LEDGER",
    source_id: ledger_name,
    ledger_name,
    group,
    opening_balance: 0,
    opening_balance_type: "DEBIT"
  }])).values()];
}

function stockItemsFromVouchers(vouchers = [], customRules = null) {
  const rules = normalizeMappingRules(customRules);
  if (!rules.inventory.create_stock_items) return [];
  const map = new Map();
  for (const voucher of vouchers) {
    for (const row of voucher.inventory_entries || []) {
      if (!row.stock_item_name) continue;
      map.set(row.stock_item_name, {
        stock_item_name: row.stock_item_name,
        product_id: row.product_id || null,
        unit: row.unit || rules.inventory.default_unit,
        group: rules.inventory.default_stock_group
      });
    }
  }
  return [...map.values()];
}

module.exports = {
  DEFAULT_TALLY_MAPPING_RULES,
  normalizeMappingRules,
  mapVoucherRecord,
  stockItemsFromVouchers,
  systemLedgers
};
