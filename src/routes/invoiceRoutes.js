const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const factoryAccessMiddleware = require("../middlewares/factoryAccessMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");

const invoiceController = require("../controllers/invoiceController");

router.use(authMiddleware);
router.use(factoryAccessMiddleware);

// List invoices
router.get(
  "/",
  permissionMiddleware(["invoices.view"]),
  invoiceController.getInvoices
);

// Invoice detail
router.get(
  "/:id",
  permissionMiddleware(["invoices.view"]),
  invoiceController.getInvoiceById
);

// Create invoice (manual OR from order)
router.post(
  "/",
  permissionMiddleware(["invoices.create"]),
  invoiceController.createInvoice
);

// Update invoice (items/charges/notes)
router.put(
  "/:id",
  permissionMiddleware(["invoices.update"]),
  invoiceController.updateInvoice
);

// Change status (timeline)
router.put(
  "/:id/status",
  permissionMiddleware(["invoices.status"]),
  invoiceController.updateInvoiceStatus
);

router.delete(
  "/:id",
  permissionMiddleware(["invoices.delete"]),
  invoiceController.deleteInvoice
);

// Phase 6 additions:
router.get(
  "/:id/pdf",
  permissionMiddleware(["invoices.pdf.view"]),
  invoiceController.getInvoicePdf
);

router.post(
  "/:id/send",
  permissionMiddleware(["invoices.pdf.send"]),
  invoiceController.sendInvoicePdf
);

// Reminder (email / whatsapp) - supports custom message and optional PDF attachment
router.post(
  "/:id/remind",
  permissionMiddleware(["invoices.remind"]),
  invoiceController.sendInvoiceReminder
);

module.exports = router;
