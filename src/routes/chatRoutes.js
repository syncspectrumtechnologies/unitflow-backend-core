const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const permissionMiddleware = require("../middlewares/permissionMiddleware");
const chatController = require("../controllers/chatController");

const router = express.Router();

router.use(authMiddleware);
router.use(permissionMiddleware(["im.chat.view"]));

// List conversations for current user (with last message + unread count)
router.get("/conversations", chatController.listConversations);

// Create or find a direct conversation (admin ↔ employee)
router.post("/direct/:userId", chatController.createOrFindDirect);

// Paginated message history
router.get(
  "/conversations/:conversationId/messages",
  chatController.getMessages
);

// Send a message in an existing conversation
router.post(
  "/conversations/:conversationId/messages",
  chatController.sendMessage
);

// Optional: mark conversation as read (updates last_read_at)
router.post(
  "/conversations/:conversationId/read",
  chatController.markConversationRead
);

module.exports = router;


router.delete(
  "/conversations/:conversationId/messages/:messageId",
  chatController.deleteMessage
);

router.delete(
  "/conversations/:conversationId",
  chatController.deleteConversation
);
