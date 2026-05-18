const express = require("express");
const router = express.Router({ mergeParams: true });

const authMiddleware = require("../middlewares/authMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");

const clientProductController = require("../controllers/clientProductController");

router.use(authMiddleware);

// POST /clients/:clientId/products
router.post(
  "/:clientId/products",
  permissionMiddleware(["clients.update"]),
  clientProductController.addClientProduct
);

// DELETE /clients/:clientId/products/:productId
router.delete(
  "/:clientId/products/:productId",
  permissionMiddleware(["clients.update"]),
  clientProductController.removeClientProduct
);

module.exports = router;
