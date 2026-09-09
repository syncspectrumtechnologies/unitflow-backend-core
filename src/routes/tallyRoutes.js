const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");
const connectorAuth = require("../middlewares/tallyConnectorAuthMiddleware");
const tallyController = require("../controllers/tallyController");

router.get(
  "/connector/sync-plan",
  connectorAuth,
  tallyController.connectorSyncPlan
);

router.post(
  "/connector/sync-result",
  connectorAuth,
  tallyController.connectorSyncResult
);

router.post(
  "/connector/inbound-snapshot",
  connectorAuth,
  tallyController.connectorInboundSnapshot
);

router.use(authMiddleware);

router.get(
  "/settings",
  permissionMiddleware(["tally.view"]),
  tallyController.getSettings
);

router.put(
  "/settings",
  permissionMiddleware(["tally.manage"]),
  tallyController.updateSettings
);

router.post(
  "/connector-token",
  permissionMiddleware(["tally.manage"]),
  tallyController.rotateConnectorToken
);

router.get(
  "/ledger-links",
  permissionMiddleware(["tally.view"]),
  tallyController.getLedgerLinks
);

router.post(
  "/ledger-links",
  permissionMiddleware(["tally.manage"]),
  tallyController.upsertLedgerLink
);

router.get(
  "/sync-logs",
  permissionMiddleware(["tally.view"]),
  tallyController.getSyncLogs
);

router.get(
  "/sync-plan",
  permissionMiddleware(["tally.view"]),
  tallyController.previewSyncPlan
);

router.get(
  "/conflicts",
  permissionMiddleware(["tally.view"]),
  tallyController.getConflicts
);

router.post(
  "/conflicts/:conflictId/resolve",
  permissionMiddleware(["tally.manage"]),
  tallyController.resolveConflict
);

router.get(
  "/reconciliation-runs",
  permissionMiddleware(["tally.view"]),
  tallyController.getReconciliationRuns
);

router.post(
  "/reconcile",
  permissionMiddleware(["tally.import", "tally.manage"]),
  tallyController.reconcileSnapshot
);

module.exports = router;
