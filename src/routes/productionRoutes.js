const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const factoryAccessMiddleware = require("../middlewares/factoryAccessMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");

const productionController = require("../controllers/productionController");

router.use(authMiddleware);
router.use(factoryAccessMiddleware);

router.post(
  "/",
  permissionMiddleware(["production.create"]),
  productionController.createProduction
);

router.get(
  "/",
  permissionMiddleware(["production.view"]),
  productionController.getProduction
);

router.get(
  "/summary",
  permissionMiddleware(["production.view"]),
  productionController.getProductionSummary
);


router.get(
  "/products/:productId/monthly-stats",
  permissionMiddleware(["production.view"]),
  productionController.getProductMonthlyStats
);

router.get(
  "/products/:productId/month-detail",
  permissionMiddleware(["production.view"]),
  productionController.getProductMonthDetail
);

router.put(
  "/:id",
  permissionMiddleware(["production.update"]),
  productionController.updateProduction
);

router.delete(
  "/:id",
  permissionMiddleware(["production.delete"]),
  productionController.deleteProduction
);

module.exports = router;
