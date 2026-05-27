const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");

const statsController = require("../controllers/statsController");

router.use(authMiddleware);

router.get(
  "/",
  permissionMiddleware(["stats.view"]),
  statsController.getCompanyStats
);
router.delete(
  "/",
  permissionMiddleware(["stats.delete"]),
  statsController.deleteStats
);

module.exports = router;
