const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const factoryAccessMiddleware = require("../middlewares/factoryAccessMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");

const orderController = require("../controllers/orderController");

router.use(authMiddleware);
router.use(factoryAccessMiddleware);

// List orders
router.get(
  "/",
  permissionMiddleware(["orders.view"]),
  orderController.getOrders
);

// Recent orders (lightweight for home widget)
// GET /orders/recent?limit=3
router.get(
  "/recent",
  permissionMiddleware(["orders.view"]),
  orderController.getRecentOrders
);

// Pending orders (confirmed but not yet dispatched)
router.get(
  "/pending",
  permissionMiddleware(["orders.view"]),
  orderController.getPendingOrders
);

// Order detail
router.get(
  "/:id",
  permissionMiddleware(["orders.view"]),
  orderController.getOrderById
);

// Create order (stock is deducted later at dispatch time)
router.post(
  "/",
  permissionMiddleware(["orders.create"]),
  orderController.createOrder
);

// Update order (editable)
router.put(
  "/:id",
  permissionMiddleware(["orders.update"]),
  orderController.updateOrder
);

// Update status timeline
router.put(
  "/:id/status",
  permissionMiddleware(["orders.status"]),
  orderController.updateOrderStatus
);

// Hard delete order (removes invoice/payment traces and restores client balances where needed)
router.delete(
  "/:id",
  permissionMiddleware(["orders.delete"]),
  orderController.deleteOrder
);

// Cancel order (stock return + void draft invoices)
router.put(
  "/:id/cancel",
  permissionMiddleware(["orders.cancel"]),
  orderController.cancelOrder
);

// Phase 6 additions:
router.get(
  "/:id/label",
  permissionMiddleware(["orders.label.view"]),
  orderController.getOrderLabelPdf
);

router.get(
  "/:id/proforma",
  permissionMiddleware(["orders.view"]),
  orderController.getOrderProformaPdf
);

router.get(
  "/:id/proforma.pdf",
  permissionMiddleware(["orders.view"]),
  orderController.getOrderProformaPdf
);

// Proforma preview from form data (no DB write)
router.post(
  "/proforma/preview",
  permissionMiddleware(["orders.view"]),
  orderController.proformaPreviewFromPayload
);

router.post(
  "/proforma/preview.pdf",
  permissionMiddleware(["orders.view"]),
  orderController.proformaPreviewFromPayload
);

router.get(
  "/:id/label.pdf",
  permissionMiddleware(["orders.label.view"]),
  orderController.getOrderLabelPdf
);

router.post(
  "/:id/send-label",
  permissionMiddleware(["orders.label.send"]),
  orderController.sendOrderLabel
);


module.exports = router;
