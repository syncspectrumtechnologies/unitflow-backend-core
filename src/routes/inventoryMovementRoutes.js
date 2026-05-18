const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");
const factoryAccessMiddleware = require("../middlewares/factoryAccessMiddleware");
const inventoryMovementController = require("../controllers/inventoryMovementController");

router.use(authMiddleware);
router.use(factoryAccessMiddleware);

router.get(
  "/stock",
  permissionMiddleware(["inventory.view"]),
  inventoryMovementController.getStock
);

router.get(
  "/stock-summary",
  permissionMiddleware(["inventory.view"]),
  inventoryMovementController.getStockSummary
);

router.get(
  "/stock-summary/pdf",
  permissionMiddleware(["inventory.view"]),
  inventoryMovementController.getStockSummaryPdf
);

router.get(
  "/stock-summary/:productId/monthly.pdf",
  permissionMiddleware(["inventory.view"]),
  inventoryMovementController.getProductInventoryMonthlyPdf
);

router.get(
  "/movements",
  permissionMiddleware(["inventory.view"]),
  inventoryMovementController.getMovements
);

router.post(
  "/movements/in",
  permissionMiddleware(["inventory.create"]),
  inventoryMovementController.createIn
);

router.post(
  "/movements/out",
  permissionMiddleware(["inventory.create"]),
  inventoryMovementController.createOut
);

router.post(
  "/movements/delete",
  permissionMiddleware(["inventory.create"]),
  inventoryMovementController.createDelete
);

router.post(
  "/movements/adjustment",
  permissionMiddleware(["inventory.adjust"]),
  inventoryMovementController.createAdjustment
);

router.post(
  "/opening-stock",
  permissionMiddleware(["inventory.create"]),
  inventoryMovementController.createOpeningStock
);

module.exports = router;
