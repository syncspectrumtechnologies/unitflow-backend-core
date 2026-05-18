const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");
const accountingController = require("../controllers/accountingController");

router.use(authMiddleware);

router.get(
  "/vouchers",
  permissionMiddleware(["accounting.view"]),
  accountingController.getVouchers
);

router.get(
  "/vouchers/:id",
  permissionMiddleware(["accounting.view"]),
  accountingController.getVoucherById
);

router.post(
  "/vouchers",
  permissionMiddleware(["accounting.create"]),
  accountingController.createVoucher
);

router.post(
  "/notes",
  permissionMiddleware(["accounting.create"]),
  accountingController.createNote
);

router.get(
  "/vouchers/:id/pdf",
  permissionMiddleware(["accounting.view"]),
  accountingController.getVoucherPdf
);


router.get(
  "/ledger/clients/:clientId/month-delete-preview",
  permissionMiddleware(["accounting.view"]),
  accountingController.getClientLedgerMonthDeletePreview
);

router.post(
  "/ledger/clients/:clientId/month-delete",
  permissionMiddleware(["accounting.view"]),
  accountingController.deleteClientLedgerMonthData
);

router.get(
  "/ledger/clients/:clientId",
  permissionMiddleware(["accounting.view"]),
  accountingController.getClientLedger
);

router.get(
  "/ledger/clients/:clientId/pdf",
  permissionMiddleware(["accounting.view"]),
  accountingController.getClientLedgerPdf
);

module.exports = router;
