const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const chatController = require("../controllers/chatController");

const router = express.Router();

// List conversations for current user (with last message + unread count)
router.get("/conversations", authMiddleware, chatController.listConversations);

// Create or find a direct conversation (admin ↔ employee)
router.post("/direct/:userId", authMiddleware, chatController.createOrFindDirect);

// Paginated message history
router.get(
  "/conversations/:conversationId/messages",
  authMiddleware,
  chatController.getMessages
);

// Send a message in an existing conversation
router.post(
  "/conversations/:conversationId/messages",
  authMiddleware,
  chatController.sendMessage
);

// Optional: mark conversation as read (updates last_read_at)
router.post(
  "/conversations/:conversationId/read",
  authMiddleware,
  chatController.markConversationRead
);

module.exports = router;


router.delete(
  "/conversations/:conversationId/messages/:messageId",
  authMiddleware,
  chatController.deleteMessage
);

router.delete(
  "/conversations/:conversationId",
  authMiddleware,
  chatController.deleteConversation
);
