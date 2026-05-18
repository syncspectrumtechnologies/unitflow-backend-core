const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const factoryAccessMiddleware = require("../middlewares/factoryAccessMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");

const paymentController = require("../controllers/paymentController");

router.use(authMiddleware);
router.use(factoryAccessMiddleware);

// List payments (factory view)
router.get(
  "/",
  permissionMiddleware(["payments.view"]),
  paymentController.getPayments
);

// Create payment with allocations (partial supported)
router.post(
  "/",
  permissionMiddleware(["payments.create"]),
  paymentController.createPayment
);

router.delete(
  "/:id",
  permissionMiddleware(["payments.delete"]),
  paymentController.deletePayment
);

module.exports = router;
