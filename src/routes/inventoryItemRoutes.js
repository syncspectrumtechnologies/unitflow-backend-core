const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const inventoryItemController = require("../controllers/inventoryItemController");

router.use(authMiddleware);

// Deprecated routes — kept only to avoid breaking older frontend
router.post("/items", inventoryItemController.deprecated);
router.get("/items", inventoryItemController.deprecated);
router.put("/items/:id", inventoryItemController.deprecated);
router.delete("/items/:id", inventoryItemController.deprecated);

module.exports = router;
