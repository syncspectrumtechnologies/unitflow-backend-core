const CHARGE_TYPE_ALIASES = new Map([
  ["TAX", "TAX"],
  ["GST", "TAX"],
  ["VAT", "TAX"],
  ["SHIPPING", "SHIPPING"],
  ["FREIGHT", "SHIPPING"],
  ["DELIVERY", "SHIPPING"],
  ["DISCOUNT", "DISCOUNT"],
  ["REBATE", "DISCOUNT"],
  ["ROUND_OFF", "OTHER"],
  ["ROUNDOFF", "OTHER"],
  ["PACKING", "OTHER"],
  ["HANDLING", "OTHER"],
  ["OTHER", "OTHER"],
  ["MISC", "OTHER"],
  ["MISCELLANEOUS", "OTHER"],
  ["CHARGE", "OTHER"]
]);

function normalizeChargeType(value) {
  const raw = (value || "").toString().trim().toUpperCase();
  if (!raw) return "OTHER";
  const normalized = CHARGE_TYPE_ALIASES.get(raw);
  if (!normalized) {
    const err = new Error("INVALID_CHARGE_TYPE");
    err.statusCode = 400;
    err.meta = {
      received: value,
      allowed_types: ["TAX", "SHIPPING", "DISCOUNT", "OTHER"],
      accepted_aliases: Array.from(CHARGE_TYPE_ALIASES.keys()).sort()
    };
    throw err;
  }
  return normalized;
}

function normalizeChargeInput(charges = []) {
  return (charges || []).map((c) => ({
    type: normalizeChargeType(c.type),
    title: (c.title ?? c.label)?.toString().trim() || "Charge",
    amount: Number(c.amount || 0),
    meta: c.meta || null
  }));
}

module.exports = {
  normalizeChargeType,
  normalizeChargeInput
};
