import { XMLParser } from "fast-xml-parser";

const CORE_API_BASE_URL = String(process.env.UNITFLOW_CORE_API_BASE_URL || "").replace(/\/+$/, "");
const CONNECTOR_TOKEN = String(process.env.UNITFLOW_TALLY_CONNECTOR_TOKEN || "");
const TALLY_HTTP_URL = String(process.env.TALLY_HTTP_URL || "http://localhost:9000").replace(/\/+$/, "");
const LIMIT = Math.min(500, Math.max(1, Number(process.env.TALLY_SYNC_LIMIT || 250)));
const SYNC_VOUCHERS = String(process.env.TALLY_SYNC_VOUCHERS || "true").toLowerCase() !== "false";
const PULL_INBOUND = String(process.env.TALLY_PULL_INBOUND || "true").toLowerCase() !== "false";
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: true });

function required(name, value) {
  if (!value) throw new Error(`${name} is required`);
}

function xml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function tallyDate(date) {
  if (!date) return "";
  return String(date).slice(0, 10).replace(/-/g, "");
}

function envelope(reportName, body) {
  return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>${xml(reportName)}</REPORTNAME></REQUESTDESC><REQUESTDATA>${body}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

function collectionExportEnvelope(collectionName, typeName, fetchFields) {
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>${xml(collectionName)}</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="${xml(collectionName)}" ISMODIFY="No"><TYPE>${xml(typeName)}</TYPE><FETCH>${xml(fetchFields.join(","))}</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
}

function ledgerEnvelope(row) {
  const opening = Number(row.opening_balance || 0);
  const signedOpening = String(row.opening_balance_type || "").toUpperCase() === "CREDIT" ? opening : -opening;
  return envelope("All Masters", `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${xml(row.ledger_name)}" ACTION="Create"><NAME>${xml(row.ledger_name)}</NAME><PARENT>${xml(row.group || "Sundry Debtors")}</PARENT><ISBILLWISEON>Yes</ISBILLWISEON><OPENINGBALANCE>${signedOpening}</OPENINGBALANCE>${row.gstin ? `<GSTIN>${xml(row.gstin)}</GSTIN>` : ""}${row.email ? `<EMAIL>${xml(row.email)}</EMAIL>` : ""}${row.phone ? `<LEDGERPHONE>${xml(row.phone)}</LEDGERPHONE>` : ""}${row.address ? `<ADDRESS.LIST><ADDRESS>${xml(row.address)}</ADDRESS></ADDRESS.LIST>` : ""}</LEDGER></TALLYMESSAGE>`);
}

function voucherLedgerLines(record) {
  const amount = Math.abs(Number(record.amount || 0));
  const party = record.party_ledger_name || "Suspense";
  const type = String(record.voucher_type || "").toLowerCase();
  if (type.includes("receipt")) {
    return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${amount}</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(party)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${amount}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
  }
  if (type.includes("purchase")) {
    return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>Purchase Accounts</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${amount}</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(party)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${amount}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
  }
  if (Array.isArray(record.lines) && record.lines.length >= 2) {
    return record.lines.map((line) => {
      const debit = String(line.entry_type || "").toUpperCase() === "DEBIT";
      const lineAmount = Math.abs(Number(line.amount || 0));
      return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(line.account_name || "Suspense")}</LEDGERNAME><ISDEEMEDPOSITIVE>${debit ? "Yes" : "No"}</ISDEEMEDPOSITIVE><AMOUNT>${debit ? "-" : ""}${lineAmount}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
    }).join("");
  }
  return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(party)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${amount}</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales Accounts</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${amount}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
}

function voucherEnvelope(record) {
  const type = record.voucher_type || "Journal";
  const number = record.voucher_no || record.source_id;
  return envelope("Vouchers", `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${xml(type)}" ACTION="Create"><DATE>${tallyDate(record.date)}</DATE><VOUCHERTYPENAME>${xml(type)}</VOUCHERTYPENAME><VOUCHERNUMBER>${xml(number)}</VOUCHERNUMBER><PARTYLEDGERNAME>${xml(record.party_ledger_name || "")}</PARTYLEDGERNAME><NARRATION>${xml(record.narration || `UnitFlow ${record.source_type} ${number}`)}</NARRATION>${voucherLedgerLines(record)}</VOUCHER></TALLYMESSAGE>`);
}

async function unitflow(path, options = {}) {
  const res = await fetch(`${CORE_API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${CONNECTOR_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.message || `UnitFlow request failed: ${res.status}`);
  return payload;
}

async function postTally(body) {
  const res = await fetch(TALLY_HTTP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body
  });
  const responseText = await res.text();
  if (!res.ok || /<LINEERROR>/i.test(responseText)) {
    throw new Error(responseText.replace(/\s+/g, " ").slice(0, 300) || `Tally HTTP ${res.status}`);
  }
  return responseText;
}

async function exportTally(body) {
  const res = await fetch(TALLY_HTTP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body
  });
  const responseText = await res.text();
  if (!res.ok) throw new Error(responseText.slice(0, 300) || `Tally HTTP ${res.status}`);
  return parser.parse(responseText);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") || "";
}

function findNodes(root, key, out = []) {
  if (!root || typeof root !== "object") return out;
  for (const [k, value] of Object.entries(root)) {
    if (k === key) out.push(...asArray(value));
    if (value && typeof value === "object") findNodes(value, key, out);
  }
  return out;
}

function parseMoney(value) {
  const raw = String(value ?? "0").replace(/,/g, "").trim();
  const n = Number(raw.match(/-?\d+(\.\d+)?/)?.[0] || 0);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function addressOf(row) {
  const list = row["ADDRESS.LIST"] || row.ADDRESSLIST || {};
  return asArray(list.ADDRESS || row.ADDRESS).map((line) => String(line || "").trim()).filter(Boolean).join(", ");
}

async function fetchTallyInboundSnapshot() {
  const ledgersXml = collectionExportEnvelope("UnitFlowLedgers", "Ledger", [
    "Name", "Guid", "Parent", "OpeningBalance", "ClosingBalance", "GSTIN", "Email", "LedgerPhone", "Address"
  ]);
  const vouchersXml = collectionExportEnvelope("UnitFlowVouchers", "Voucher", [
    "Date", "Guid", "VoucherTypeName", "VoucherNumber", "PartyLedgerName", "Amount", "AllLedgerEntries"
  ]);

  const [ledgerTree, voucherTree] = await Promise.all([exportTally(ledgersXml), exportTally(vouchersXml)]);
  const ledgers = findNodes(ledgerTree, "LEDGER").map((row) => ({
    ledger_name: first(row.NAME, row["@_NAME"]),
    tally_guid: first(row.GUID, row["@_GUID"]),
    group: first(row.PARENT),
    opening_balance: parseMoney(row.OPENINGBALANCE),
    closing_balance: parseMoney(row.CLOSINGBALANCE),
    gstin: first(row.GSTIN, row.PARTYGSTIN, row.GSTREGISTRATIONNUMBER),
    email: first(row.EMAIL),
    phone: first(row.LEDGERPHONE, row.PHONE),
    address: addressOf(row)
  })).filter((row) => row.ledger_name);

  const vouchers = findNodes(voucherTree, "VOUCHER").map((row) => {
    const entries = asArray(row["ALLLEDGERENTRIES.LIST"]);
    const entryAmounts = entries.map((entry) => parseMoney(entry.AMOUNT)).filter(Boolean);
    return {
      voucher_no: first(row.VOUCHERNUMBER, row["@_VCHKEY"]),
      voucher_type: first(row.VOUCHERTYPENAME, row["@_VCHTYPE"]),
      guid: first(row.GUID, row["@_GUID"]),
      party_ledger_name: first(row.PARTYLEDGERNAME),
      date: first(row.DATE),
      amount: entryAmounts.length ? Math.max(...entryAmounts) : parseMoney(row.AMOUNT)
    };
  }).filter((row) => row.voucher_no || row.guid);

  return { source: "tally-connector", ledgers, vouchers };
}

async function syncRows(rows, buildEnvelope) {
  const results = [];
  for (const row of rows) {
    try {
      await postTally(buildEnvelope(row));
      results.push({ ...row, status: "SYNCED" });
    } catch (error) {
      results.push({ ...row, status: "FAILED", message: error.message });
    }
  }
  return results;
}

async function main() {
  required("UNITFLOW_CORE_API_BASE_URL", CORE_API_BASE_URL);
  required("UNITFLOW_TALLY_CONNECTOR_TOKEN", CONNECTOR_TOKEN);

  const plan = await unitflow(`/tally/connector/sync-plan?limit=${LIMIT}`);
  const ledgerResults = await syncRows(plan.ledgers || [], ledgerEnvelope);
  const voucherRecords = SYNC_VOUCHERS
    ? [
        ...(plan.sales_invoices || []),
        ...(plan.receipts || []),
        ...(plan.purchases || []),
        ...(plan.accounting_vouchers || [])
      ]
    : [];
  const voucherResults = await syncRows(voucherRecords, voucherEnvelope);

  await unitflow("/tally/connector/sync-result", {
    method: "POST",
    body: JSON.stringify({
      ledgers: ledgerResults.map((row) => ({
        client_id: row.source_id,
        tally_ledger_name: row.ledger_name,
        status: row.status,
        message: row.message
      })),
      vouchers: voucherResults.map((row) => ({
        source_type: row.source_type,
        source_id: row.source_id,
        tally_voucher_number: row.voucher_no,
        tally_voucher_type: row.voucher_type,
        status: row.status,
        message: row.message
      }))
    })
  });

  if (PULL_INBOUND) {
    const snapshot = await fetchTallyInboundSnapshot();
    await unitflow("/tally/connector/inbound-snapshot", {
      method: "POST",
      body: JSON.stringify(snapshot)
    });
    console.log(`UnitFlow inbound reconciliation submitted: ${snapshot.ledgers.length} ledgers, ${snapshot.vouchers.length} vouchers`);
  }

  console.log(`UnitFlow Tally sync completed: ${ledgerResults.length} ledgers, ${voucherResults.length} vouchers`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
