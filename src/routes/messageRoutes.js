const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");

const messageController = require("../controllers/messageController");

router.use(authMiddleware);

router.get(
  "/senders",
  messageController.getSenders
);

router.post(
  "/campaigns",
  permissionMiddleware(["messages.campaigns.create"]),
  messageController.createCampaign
);

router.post(
  "/campaigns/from-filter",
  permissionMiddleware(["messages.campaigns.create"]),
  messageController.createCampaignFromFilter
);

// Promotional / offers / announcements (all clients or selected)
router.post(
  "/campaigns/promotional",
  permissionMiddleware(["messages.campaigns.create"]),
  messageController.createPromotionalCampaign
);

router.post(
  "/campaigns/:id/dispatch",
  permissionMiddleware(["messages.campaigns.dispatch"]),
  messageController.dispatchCampaign
);

router.delete(
  "/campaigns/:id",
  permissionMiddleware(["messages.campaigns.delete"]),
  messageController.deleteCampaign
);

router.get(
  "/campaigns/:id/status",
  permissionMiddleware(["messages.outbox.view"]),
  messageController.getCampaignStatus
);

router.get(
  "/outbox",
  permissionMiddleware(["messages.outbox.view"]),
  messageController.getOutbox
);

module.exports = router;
