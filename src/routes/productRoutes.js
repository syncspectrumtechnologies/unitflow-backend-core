const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");

const productController = require("../controllers/productController");

// DEBUG safety checks (remove later)
if (typeof permissionMiddleware !== "function") {
  throw new Error("permissionMiddleware export is not a function. Check ../middlewares/permissionMiddleware");
}
if (!productController || typeof productController.createProduct !== "function") {
  throw new Error("productController.createProduct is not a function. Check ../controllers/productController exports.");
}

router.use(authMiddleware);

// Create
router.post(
  "/",
  permissionMiddleware(["products.create"]),
  productController.createProduct
);

// List
router.get(
  "/",
  permissionMiddleware(["products.view"]),
  productController.getProducts
);

// Detail
router.get(
  "/:id",
  permissionMiddleware(["products.view"]),
  productController.getProductById
);

// Update
router.put(
  "/:id",
  permissionMiddleware(["products.update"]),
  productController.updateProduct
);

// Delete
router.delete(
  "/:id",
  permissionMiddleware(["products.delete"]),
  productController.deleteProduct
);

module.exports = router;
