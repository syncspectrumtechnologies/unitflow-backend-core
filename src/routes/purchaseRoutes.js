
const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const factoryAccessMiddleware = require("../middlewares/factoryAccessMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");

const purchaseController = require("../controllers/purchaseController");

router.use(authMiddleware);
router.use(factoryAccessMiddleware);

// List purchases
router.get(
  "/",
  permissionMiddleware(["purchases.view"]),
  purchaseController.getPurchases
);

// Purchase detail
router.get(
  "/:id",
  permissionMiddleware(["purchases.view"]),
  purchaseController.getPurchaseById
);

router.get(
  "/:id/payments",
  permissionMiddleware(["purchases.view"]),
  purchaseController.getPurchasePayments
);

router.post(
  "/:id/payments",
  permissionMiddleware(["purchases.update"]),
  purchaseController.createPurchasePayment
);

router.post(
  "/:id/payments/:paymentId/reverse",
  permissionMiddleware(["purchases.update"]),
  purchaseController.reversePurchasePayment
);

// Create purchase
router.post(
  "/",
  permissionMiddleware(["purchases.create"]),
  purchaseController.createPurchase
);

// Update purchase
router.put(
  "/:id",
  permissionMiddleware(["purchases.update"]),
  purchaseController.updatePurchase
);

router.delete(
  "/:id",
  permissionMiddleware(["purchases.delete"]),
  purchaseController.deletePurchase
);

// Update status timeline
router.put(
  "/:id/status",
  permissionMiddleware(["purchases.status"]),
  purchaseController.updatePurchaseStatus
);

// Purchase slip PDF
router.get(
  "/:id/pdf",
  permissionMiddleware(["purchases.pdf"]),
  purchaseController.getPurchasePdf
);

module.exports = router;
