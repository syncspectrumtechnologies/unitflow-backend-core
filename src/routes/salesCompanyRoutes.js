const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");

const salesCompanyController = require("../controllers/salesCompanyController");

router.use(authMiddleware);

// Used by order creation UI dropdown.
router.get(
  "/",
  permissionMiddleware(["orders.create", "orders.view", "orders.update"]),
  salesCompanyController.getSalesCompanies
);

module.exports = router;
