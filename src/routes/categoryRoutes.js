const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");

const categoryController = require("../controllers/categoryController");

router.use(authMiddleware);

// Create
router.post(
  "/",
  permissionMiddleware(["categories.create"]),
  categoryController.createCategory
);

// List
router.get(
  "/",
  permissionMiddleware(["categories.view"]),
  categoryController.getCategories
);

// Detail
router.get(
  "/:id",
  permissionMiddleware(["categories.view"]),
  categoryController.getCategoryById
);

// Update
router.put(
  "/:id",
  permissionMiddleware(["categories.update"]),
  categoryController.updateCategory
);

// Delete (soft)
router.delete(
  "/:id",
  permissionMiddleware(["categories.delete"]),
  categoryController.deleteCategory
);

module.exports = router;
