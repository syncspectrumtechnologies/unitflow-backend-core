const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");
const broadcastController = require("../controllers/broadcastController");

const router = express.Router();

router.use(authMiddleware);
router.use(permissionMiddleware(["im.broadcast.view"]));

// List broadcasts relevant to current user (with seen status)
router.get("/", broadcastController.listForMe);

// Admin recent broadcasts widget
router.get(
  "/admin/recent",
  permissionMiddleware("admin.access"),
  broadcastController.listRecentForAdmin
);

// Admin creates a broadcast
router.post(
  "/",
  permissionMiddleware("admin.access"),
  broadcastController.create
);

// Employee marks broadcast as seen
router.post("/:broadcastId/seen", broadcastController.markSeen);

router.delete(
  "/:broadcastId",
  permissionMiddleware("admin.access"),
  broadcastController.deleteBroadcast
);

module.exports = router;
