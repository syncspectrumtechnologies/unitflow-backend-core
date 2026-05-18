const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");
const broadcastController = require("../controllers/broadcastController");

const router = express.Router();

// List broadcasts relevant to current user (with seen status)
router.get("/", authMiddleware, broadcastController.listForMe);

// Admin recent broadcasts widget
router.get(
  "/admin/recent",
  authMiddleware,
  permissionMiddleware("admin.access"),
  broadcastController.listRecentForAdmin
);

// Admin creates a broadcast
router.post(
  "/",
  authMiddleware,
  permissionMiddleware("admin.access"),
  broadcastController.create
);

// Employee marks broadcast as seen
router.post("/:broadcastId/seen", authMiddleware, broadcastController.markSeen);

router.delete(
  "/:broadcastId",
  authMiddleware,
  permissionMiddleware("admin.access"),
  broadcastController.deleteBroadcast
);

module.exports = router;
