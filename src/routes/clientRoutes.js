const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");
const factoryAccessMiddleware = require("../middlewares/factoryAccessMiddleware");

const clientController = require("../controllers/clientController");
const clientCategoryController = require("../controllers/clientCategoryController");

router.use(authMiddleware);

// CREATE client
router.post(
  "/",
  permissionMiddleware(["clients.create"]),
  clientController.createClient
);

// LIST clients (company-wide)
router.get(
  "/",
  permissionMiddleware(["clients.view"]),
  clientController.getClients
);

// Lightweight client search for dropdowns/autocomplete
router.get(
  "/search-dropdown",
  permissionMiddleware(["clients.view"]),
  clientController.searchClientOptions
);

// Inactive clients list (no orders in last N days)
router.get(
  "/inactive",
  permissionMiddleware(["clients.view"]),
  clientController.getInactiveClients
);

// Client order history (must be before /:clientId)
router.get(
  "/:clientId/orders",
  permissionMiddleware(["clients.view"]),
  factoryAccessMiddleware,
  clientController.getClientOrderHistory
);

// Client advance summary
router.get(
  "/:clientId/advance-summary",
  permissionMiddleware(["clients.view"]),
  clientController.getClientAdvanceSummary
);

// Purchase advances for a client
router.get(
  "/:clientId/purchase-advances",
  permissionMiddleware(["clients.view"]),
  clientController.getClientPurchaseAdvances
);

router.post(
  "/:clientId/purchase-advances",
  permissionMiddleware(["purchases.update"]),
  clientController.createClientPurchaseAdvance
);

router.post(
  "/:clientId/purchase-advances/:advanceId/reverse",
  permissionMiddleware(["purchases.update"]),
  clientController.reverseClientPurchaseAdvance
);

// Bulk client slips (combined PDF)
router.post(
  "/slips.pdf",
  permissionMiddleware(["clients.view"]),
  clientController.getBulkClientSlipPdf
);

// Bulk client letters (combined PDF)
router.post(
  "/letters.pdf",
  permissionMiddleware(["clients.letter"]),
  clientController.generateBulkClientLetterPdf
);

// GET client detail
router.get(
  "/:clientId",
  permissionMiddleware(["clients.view"]),
  clientController.getClientById
);

// UPDATE client
router.put(
  "/:clientId",
  permissionMiddleware(["clients.update"]),
  clientController.updateClient
);

// SOFT DELETE client
router.delete(
  "/:clientId",
  permissionMiddleware(["clients.delete"]),
  clientController.deleteClient
);

// Client categories mapping
router.get(
  "/:clientId/categories",
  permissionMiddleware(["clients.view"]),
  clientCategoryController.getClientCategories
);
router.post(
  "/:clientId/categories",
  permissionMiddleware(["clients.update"]),
  clientCategoryController.addClientCategory
);
router.delete(
  "/:clientId/categories/:categoryId",
  permissionMiddleware(["clients.update"]),
  clientCategoryController.removeClientCategory
);

// inside clientRoutes.js
router.get(
  "/:clientId/products",
  permissionMiddleware(["clients.view"]),
  clientController.getClientProducts
);

// Client slip (PDF) for printing/label pasting
router.get(
  "/:clientId/slip.pdf",
  permissionMiddleware(["clients.view"]),
  clientController.getClientSlipPdf
);

// Custom letter (PDF) for client detail page
router.post(
  "/:clientId/letter.pdf",
  permissionMiddleware(["clients.letter"]),
  clientController.generateClientLetterPdf
);

// Re-engage automation: draft/send email if no orders in last 45 days
router.post(
  "/:clientId/re-engage",
  permissionMiddleware(["clients.reengage"]),
  clientController.reEngageClient
);
module.exports = router;
