const prisma = require("../config/db");
const { hashConnectorToken, text } = require("../services/tallyService");

function readToken(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return text(req.headers["x-tally-connector-token"], 256);
}

module.exports = async (req, res, next) => {
  try {
    const token = readToken(req);
    if (!token || token.length < 24) {
      return res.status(401).json({ message: "Connector authentication required" });
    }

    const integration = await prisma.tallyIntegration.findFirst({
      where: {
        connector_token_hash: hashConnectorToken(token),
        enabled: true
      },
      select: {
        id: true,
        company_id: true,
        enabled: true,
        status: true,
        tally_company_name: true,
        sync_ledgers: true,
        sync_vouchers: true,
        sync_invoices: true,
        sync_payments: true,
        auto_sync: true,
        sync_interval_minutes: true,
        allow_tally_import: true,
        conflict_strategy: true,
        reconciliation_tolerance: true
      }
    });

    if (!integration) {
      return res.status(401).json({ message: "Invalid connector token" });
    }

    req.tallyIntegration = integration;
    req.user = {
      id: "tally-connector",
      company_id: integration.company_id,
      is_admin: false,
      roles: ["TALLY_CONNECTOR"]
    };
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Connector authentication failed" });
  }
};
