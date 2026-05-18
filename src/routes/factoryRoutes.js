const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");

const factoryController = require("../controllers/factoryController");

router.use(authMiddleware);

// LIST factories
router.get(
  "/",
  permissionMiddleware(["factories.view", "admin.access"]),
  factoryController.getFactories
);

// CREATE factory (admin)
router.post(
  "/",
  permissionMiddleware(["factories.manage", "admin.access"]),
  factoryController.createFactory
);

// UPDATE factory (admin)
router.put(
  "/:id",
  permissionMiddleware(["factories.manage", "admin.access"]),
  factoryController.updateFactory
);

// DELETE factory (soft delete)
router.delete(
  "/:id",
  permissionMiddleware(["factories.delete", "admin.access"]),
  factoryController.deleteFactory
);

module.exports = router;
